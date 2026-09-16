import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, createReadStream, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { all, getDb, now, one, parseJson, run, uuid } from './db/index.js';
import {
  AppError, assertProfileFile, assertSupplierAccess, badRequest, conflict,
  corporateCodesFor, forbidden, hashPassword, isInternal, issueToken, loadUser,
  logAudit, notFound, passwordExpired, passwordExpiresAt, requireRole, requireUser,
  revokeSession, unauthorized, verifyPassword, verifyToken,
} from './lib/core.js';
import * as suppliers from './services/suppliers.js';
import * as questionnaire from './services/questionnaire.js';

const here = dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = process.env.STORAGE_DIR ?? join(here, '../storage');

// Dibuat saat modul dimuat, bukan menunggu unggahan pertama. Di produksi ini
// juga memastikan volume benar-benar dapat ditulis — kegagalannya muncul saat
// server mulai, bukan berjam-jam kemudian saat pemasok pertama mengunggah.
mkdirSync(STORAGE_DIR, { recursive: true });

/* ==================================================================== */
/* Penyimpanan berkas                                                   */
/* ==================================================================== */
// Supabase Storage diganti folder di disk. Konvensi jalurnya dipertahankan:
//   <bucket>/<supplier_id>/<section>/<uuid>-<nama berkas>
//
// Berkas TIDAK dilayani sebagai berkas statis. Setiap unduhan lewat endpoint
// yang memeriksa kewenangan lebih dulu — inilah pengganti signed URL, dan
// alasannya sama: tautan ke KTP direktur tidak boleh dapat dibuka siapa pun
// yang menebak jalurnya.

function storeFile({ bucket, supplierId, section, fileName, mimeType, base64, user }) {
  const buffer = Buffer.from(base64, 'base64');
  assertProfileFile({ size: buffer.length, mimeType, fileName });

  const id = uuid();
  const relative = join(supplierId, section, `${id}-${fileName}`);
  const absolute = join(STORAGE_DIR, bucket, relative);

  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, buffer);

  run(
    `insert into file_object
       (id, bucket, storage_path, file_name, file_size, mime_type, checksum, uploaded_by)
     values (?,?,?,?,?,?,?,?)`,
    id, bucket, relative, fileName, buffer.length, mimeType,
    createHash('sha256').update(buffer).digest('hex'), user.id,
  );

  return one('select * from file_object where id = ?', id);
}

/* ==================================================================== */
/* Autentikasi                                                          */
/* ==================================================================== */

function login({ email, accountId, password }, meta) {
  let user;

  if (accountId) {
    // Pemasok menghafal ID akunnya, bukan email. Penukarannya terjadi di
    // server, tidak lewat endpoint terbuka yang dapat dipakai menguji
    // keberadaan sebuah ID akun.
    user = one(
      `select u.* from supplier_account sa
         join app_user u on u.id = sa.auth_user_id
        where sa.account_id = ? and u.is_active = 1`, accountId.trim(),
    );
  } else if (email) {
    user = one('select * from app_user where email = ? and is_active = 1', email.trim());
  }

  // Pesan sengaja sama untuk akun tidak ada dan kata sandi salah: membedakan
  // keduanya memberi tahu penyerang alamat mana yang terdaftar.
  const invalid = unauthorized('Kredensial tidak dikenali.');
  if (!user || !verifyPassword(password ?? '', user.password_hash)) throw invalid;

  if (user.role === 'supplier') {
    const account = one('select * from supplier_account where supplier_id = ?', user.supplier_id);
    if (passwordExpired(account)) {
      throw new AppError(
        'Kata sandi sementara Anda sudah kedaluwarsa. Minta tim procurement mengirim ulang undangan.',
        403, 'password_expired',
      );
    }
  }

  logAudit(user, 'auth.login', 'user', user.id);
  return { token: issueToken(user, meta), user: publicUser(user) };
}

function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.full_name,
    email: user.email,
    supplierId: user.supplier_id,
  };
}

/** Ringkasan diri: identitas, pemasok yang diwakili, jumlah notifikasi belum dibaca. */
function me(user) {
  const supplier = user.supplier_id
    ? one(
        `select s.id, s.reference, s.vendor_name, s.status, s.onboarding_path,
                sa.account_id, sa.password_changed, sa.email_sent_at
           from supplier s
           left join supplier_account sa on sa.supplier_id = s.id
          where s.id = ?`, user.supplier_id,
      )
    : null;

  const unread = one(
    `select count(*) as n from notification n
      where not exists (select 1 from notification_read nr
                         where nr.notification_id = n.id and nr.user_id = ?)
        and case when ? = 'supplier'
                 then n.audience = 'supplier' and n.supplier_id is ?
                 else n.audience = 'internal'
                      and (n.recipient_id is null or n.recipient_id = ?) end`,
    user.id, user.role, user.supplier_id, user.id,
  ).n;

  return {
    ...publicUser(user),
    supplier: supplier && {
      ...supplier,
      password_changed: Boolean(supplier.password_changed),
      password_expires_at: passwordExpiresAt(supplier),
    },
    unreadNotifications: unread,
  };
}

function changePassword(user, { currentPassword, newPassword }) {
  if (!newPassword || newPassword.length < 10) {
    throw badRequest('Kata sandi baru minimal 10 karakter.');
  }
  if (!verifyPassword(currentPassword ?? '', user.password_hash)) {
    throw unauthorized('Kata sandi saat ini tidak cocok.');
  }

  run('update app_user set password_hash = ?, updated_at = ? where id = ?',
    hashPassword(newPassword), now(), user.id);

  if (user.role === 'supplier') {
    run(`update supplier_account
            set password_changed = 1, password_changed_at = ?, invite_token = null, updated_at = ?
          where supplier_id = ?`, now(), now(), user.supplier_id);
    run("update supplier set status = 'onboarding', updated_at = ? where id = ? and status = 'invited'",
      now(), user.supplier_id);
  }

  logAudit(user, 'auth.password_changed', 'user', user.id);
  return { ok: true };
}

/**
 * Membuat akun portal untuk pemasok yang diundang.
 *
 * Dijalankan setelah invite: baris app_user dan kata sandi sementaranya dibuat
 * di sini, lalu dikirim pemanggil lewat email. Di Supabase ini pekerjaan Edge
 * Function karena menuntut service key; di sini ia cukup satu fungsi, karena
 * server memang sudah tepercaya.
 */
function provisionSupplierUser(supplierId, invite) {
  const supplier = one('select * from supplier where id = ?', supplierId);
  const email = supplier.contact_email ?? supplier.company_email;
  const existing = one('select * from app_user where supplier_id = ?', supplierId);

  if (existing) {
    run('update app_user set password_hash = ?, updated_at = ? where id = ?',
      hashPassword(invite.temporaryPassword), now(), existing.id);
    return existing.id;
  }

  const id = uuid();
  run(
    `insert into app_user (id, role, full_name, email, password_hash, supplier_id)
     values (?, 'supplier', ?, ?, ?, ?)`,
    id, supplier.contact_name ?? supplier.vendor_name, email,
    hashPassword(invite.temporaryPassword), supplierId,
  );
  run('update supplier_account set auth_user_id = ? where supplier_id = ?', id, supplierId);
  return id;
}

/* ==================================================================== */
/* Master data                                                          */
/* ==================================================================== */

const MASTER_TABLES = {
  legalStatuses: 'md_legal_status',
  entityTypes: 'md_entity_type',
  vendorTypes: 'md_vendor_type',
  vendorTypeDetails: 'md_vendor_type_detail',
  otvStatuses: 'md_otv_status',
  vendorDirectTypes: 'md_vendor_direct_type',
  corporateEntities: 'md_corporate_entity',
  transactionTypes: 'md_transaction_type',
  taxDocuments: 'md_tax_document_type',
  legalDocuments: 'md_legal_document_type',
  licenseTypes: 'md_license_type',
  currencies: 'md_currency',
  termsOfPayment: 'md_term_of_payment',
  fiscalPositions: 'md_fiscal_position',
  accountTypes: 'md_account_type',
  agreementRates: 'md_agreement_rate',
  banks: 'md_bank',
  questionTypes: 'md_question_type',
};

function masterData() {
  const data = {};
  for (const [key, table] of Object.entries(MASTER_TABLES)) {
    data[key] = all(`select * from ${table} where active = 1 order by sort_order`);
  }
  // Dua pilihan yang tampil di antarmuka, diturunkan dari entitas korporat —
  // tidak ada daftar terpisah yang bisa menyimpang.
  data.targetCompanies = [...new Set(data.corporateEntities.map((e) => e.interface_name))];
  return data;
}

function qualificationReference() {
  return {
    segments: all('select * from md_unspsc_segment order by code'),
    commodities: all('select * from md_unspsc_commodity where active = 1 order by sort_order'),
    countries: all('select * from md_country where active = 1 order by name'),
  };
}

/* ==================================================================== */
/* Tabel rute                                                           */
/* ==================================================================== */
// Bentuk: 'METHOD /path' → { auth, handler }
//   auth: false berarti terbuka tanpa sesi. HANYA tiga endpoint yang begitu,
//   dan ketiganya disebut namanya di sini supaya mudah diaudit sekali lihat.

const routes = {
  'POST /api/auth/login':    { auth: false, handler: (c) => login(c.body, c.meta) },
  'POST /api/auth/logout':   { handler: (c) => { revokeSession(c.sessionId); return { ok: true }; } },
  'GET  /api/auth/me':       { handler: (c) => me(c.user) },
  'POST /api/auth/password': { handler: (c) => changePassword(c.user, c.body) },

  'GET  /api/master-data':   { auth: false, handler: () => masterData() },
  'GET  /api/master-data/qualification': { handler: () => qualificationReference() },

  'POST /api/suppliers/register': { auth: false, handler: (c) => suppliers.registerSupplier(c.body) },
  'GET  /api/suppliers':          { handler: (c) => suppliers.listSuppliers(c.user, c.query) },
  'GET  /api/suppliers/:id':      { handler: (c) => suppliers.getSupplier(c.user, c.params.id) },

  'POST /api/suppliers/:id/approve': { handler: (c) => suppliers.approveSubmission(c.user, c.params.id) },
  'POST /api/suppliers/:id/reject':  { handler: (c) => suppliers.rejectSubmission(c.user, c.params.id, c.body.reason) },

  'POST /api/suppliers/:id/invite': {
    handler: (c) => {
      const invite = suppliers.inviteSupplier(c.user, c.params.id, { resend: c.body.resend });
      provisionSupplierUser(c.params.id, invite);
      // Kata sandi hanya dikembalikan bila SHOW_TEMP_PASSWORD disetel — untuk
      // lingkungan demo. Di produksi ia hanya boleh sampai lewat email.
      const show = process.env.SHOW_TEMP_PASSWORD === 'true';
      return {
        accountId: invite.accountId,
        email: invite.email,
        ...(show ? { temporaryPassword: invite.temporaryPassword } : {}),
      };
    },
  },

  'POST /api/suppliers/:id/internal-registration': {
    handler: (c) => suppliers.startInternalRegistration(c.user, c.params.id, c.body.documentSource),
  },
  'POST /api/suppliers/:id/finish-internal': {
    handler: (c) => {
      const invite = suppliers.finishInternalRegistration(c.user, c.params.id);
      provisionSupplierUser(c.params.id, invite);
      const show = process.env.SHOW_TEMP_PASSWORD === 'true';
      return {
        accountId: invite.accountId,
        email: invite.email,
        ...(show ? { temporaryPassword: invite.temporaryPassword } : {}),
      };
    },
  },

  'PUT  /api/suppliers/:id/registration/:section': {
    handler: (c) => suppliers.updateRegistrationSection(c.user, c.params.id, c.params.section, c.body),
  },
  'PUT  /api/suppliers/:id/profile/:section': {
    handler: (c) => suppliers.saveProfileSection(c.user, c.params.id, c.params.section, c.body),
  },
  'PUT  /api/suppliers/:id/active-profile/:section': {
    handler: (c) => suppliers.updateActiveProfile(c.user, c.params.id, c.params.section, c.body),
  },

  'POST /api/suppliers/consent':   { handler: (c) => suppliers.acceptConsent(c.user, c.body.gtcVersion, c.body.acceptedBy) },
  'POST /api/suppliers/:id/verify': { handler: (c) => suppliers.verifyDocuments(c.user, c.params.id) },
  'POST /api/suppliers/:id/request-fix': { handler: (c) => suppliers.requestDocumentFix(c.user, c.params.id, c.body.notes) },
  'POST /api/suppliers/resubmit':  { handler: (c) => suppliers.resubmitDocuments(c.user) },

  'PUT  /api/suppliers/:id/qualification': {
    handler: (c) => suppliers.saveQualification(c.user, c.params.id, c.body.lines, c.body.status),
  },
  'POST /api/suppliers/:id/submit-preferred': { handler: (c) => suppliers.submitForPreferred(c.user, c.params.id) },
  'POST /api/suppliers/:id/decide-preferred': {
    handler: (c) => suppliers.decidePreferred(c.user, c.params.id, c.body.decision, c.body.note),
  },
  'POST /api/suppliers/:id/reopen': { handler: (c) => suppliers.reopenQualification(c.user, c.params.id) },
  'GET  /api/documents/expiring':   { handler: (c) => suppliers.listExpiringDocuments(c.user, Number(c.query.withinDays ?? 60)) },

  'POST /api/files': {
    handler: (c) => {
      requireUser(c.user);
      const supplierId = c.body.supplierId ?? c.user.supplier_id;
      assertSupplierAccess(c.user, supplierId);
      return storeFile({
        bucket: c.body.bucket ?? 'supplier-documents',
        supplierId, section: c.body.section ?? 'misc',
        fileName: c.body.fileName, mimeType: c.body.mimeType,
        base64: c.body.content, user: c.user,
      });
    },
  },

  'GET  /api/questionnaires':            { handler: (c) => questionnaire.listTemplates(c.user, c.query) },
  'GET  /api/questionnaires/versions/:id': { handler: (c) => questionnaire.getVersion(c.user, c.params.id) },
  'POST /api/questionnaires':            { handler: (c) => questionnaire.createTemplate(c.user, c.body) },
  'POST /api/questionnaires/versions/:id/publish': { handler: (c) => questionnaire.publishVersion(c.user, c.params.id) },
  'POST /api/questionnaires/versions/:id/new-version': {
    handler: (c) => ({ versionId: questionnaire.createNewVersion(c.user, c.params.id, c.body.versionLabel) }),
  },

  'POST /api/assignments':      { handler: (c) => questionnaire.createAssignment(c.user, c.body) },
  'GET  /api/responses':        { handler: (c) => questionnaire.listResponses(c.user, c.query) },
  'GET  /api/responses/:id':    { handler: (c) => questionnaire.getResponse(c.user, c.params.id) },
  'PUT  /api/responses/:id/answers': { handler: (c) => questionnaire.saveAnswers(c.user, c.params.id, c.body.answers) },
  'GET  /api/responses/:id/precheck': { handler: (c) => questionnaire.precheckResponse(c.user, c.params.id) },
  'POST /api/responses/:id/submit':  { handler: (c) => questionnaire.submitResponse(c.user, c.params.id) },
  'POST /api/responses/:id/claim':   { handler: (c) => questionnaire.claimReview(c.user, c.params.id) },
  'POST /api/responses/:id/review':  {
    handler: (c) => questionnaire.reviewResponse(c.user, c.params.id, c.body.decision, c.body.summary, c.body.flags),
  },
  'GET  /api/dashboard':        { handler: (c) => questionnaire.dashboard(c.user) },

  'GET  /api/notifications': {
    handler: (c) => {
      requireUser(c.user);
      return all(
        `select n.*, (nr.user_id is not null) as is_read from notification n
           left join notification_read nr on nr.notification_id = n.id and nr.user_id = ?
          where case when ? = 'supplier'
                     then n.audience = 'supplier' and n.supplier_id is ?
                     else n.audience = 'internal'
                          and (n.recipient_id is null or n.recipient_id = ?) end
          order by n.created_at desc limit 50`,
        c.user.id, c.user.role, c.user.supplier_id, c.user.id,
      ).map((n) => ({ ...n, is_read: Boolean(n.is_read), payload: parseJson(n.payload) }));
    },
  },
  'POST /api/notifications/:id/read': {
    handler: (c) => {
      requireUser(c.user);
      run(`insert into notification_read (notification_id, user_id) values (?,?)
           on conflict do nothing`, c.params.id, c.user.id);
      return { ok: true };
    },
  },

  'GET  /api/audit': {
    handler: (c) => {
      requireRole(c.user, 'procurement_staff', 'procurement_admin', 'procurement_manager');
      return all('select * from audit_log order by at desc limit 200');
    },
  },

  'GET  /api/health': { auth: false, handler: () => ({ ok: true, at: now() }) },
};

/* ==================================================================== */
/* Pencocokan rute                                                      */
/* ==================================================================== */

const compiled = Object.entries(routes).map(([key, def]) => {
  const [method, path] = key.split(/\s+/);
  const names = [];
  const pattern = new RegExp(
    `^${path.replace(/:([A-Za-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`,
  );
  return { method, pattern, names, def };
});

function matchRoute(method, pathname) {
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = pattern_exec(r.pattern, pathname);
    if (!m) continue;
    const params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    return { def: r.def, params };
  }
  return null;
}

const pattern_exec = (re, s) => re.exec(s);

/* ==================================================================== */
/* Server                                                               */
/* ==================================================================== */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      // Batas 8 MB. Unggahan dikirim sebagai base64 di dalam JSON, dan base64
      // membengkakkan berkas sekitar 33% — jadi batas ini menampung berkas
      // 2 MB milik profil serta lampiran kuesioner yang lebih longgar.
      if (size > 8 * 1024 * 1024) reject(badRequest('Permintaan terlalu besar.'));
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(badRequest('Body bukan JSON yang sah.')); }
    });
    req.on('error', reject);
  });
}

function cors(res) {
  const origin = process.env.ALLOWED_ORIGIN ?? '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
}

export function createApp() {
  return createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // Unduhan berkas: jalur terpisah karena keluarannya biner, bukan JSON.
    if (req.method === 'GET' && pathname.startsWith('/api/files/')) {
      return serveFile(req, res, pathname.slice('/api/files/'.length));
    }

    const match = matchRoute(req.method, pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint tidak ditemukan.' }));
      return;
    }

    try {
      const { user, sessionId } = authenticate(req);
      if (match.def.auth !== false && !user) throw unauthorized();

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};

      const result = await match.def.handler({
        user, sessionId, body, params: match.params,
        query: Object.fromEntries(url.searchParams),
        meta: { userAgent: req.headers['user-agent'], ip: req.socket.remoteAddress },
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result ?? null));
    } catch (err) {
      sendError(res, err);
    }
  });
}

function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return { user: null, sessionId: null };
  return { user: loadUser(payload.sub), sessionId: payload.sid };
}

function serveFile(req, res, fileId) {
  try {
    const { user } = authenticate(req);
    requireUser(user);

    const file = one('select * from file_object where id = ?', fileId);
    if (!file) throw notFound('Berkas tidak ditemukan.');

    // Pemeriksaan kewenangan sebelum satu byte pun dikirim. Ini pengganti
    // signed URL: jalur berkas boleh ditebak, isinya tetap tidak terbuka.
    const owner = file.storage_path.split('/')[0];
    if (!isInternal(user) && user.supplier_id !== owner) {
      throw forbidden('Berkas ini bukan milik Anda.');
    }

    const absolute = join(STORAGE_DIR, file.bucket, file.storage_path);
    if (!existsSync(absolute)) throw notFound('Berkas hilang dari penyimpanan.');

    res.writeHead(200, {
      'Content-Type': file.mime_type,
      'Content-Length': file.file_size,
      'Content-Disposition': `inline; filename="${file.file_name}"`,
      'Cache-Control': 'private, no-store',
    });
    createReadStream(absolute).pipe(res);
  } catch (err) {
    sendError(res, err);
  }
}

function sendError(res, err) {
  const status = err instanceof AppError ? err.status : 500;

  // Galat tak terduga tidak pernah bocor ke klien: pesan SQLite dapat memuat
  // nama tabel dan isi baris. Yang lengkap masuk log server.
  if (status === 500) console.error('[error]', err);

  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: status === 500 ? 'Terjadi kesalahan pada server.' : err.message,
    code: err.code ?? 'internal_error',
  }));
}

export { provisionSupplierUser, storeFile, login };
