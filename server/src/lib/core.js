import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { all, daysFromNow, getDb, now, one, run, uuid } from '../db/index.js';

/* ==================================================================== */
/* Galat                                                                */
/* ==================================================================== */

/**
 * Satu kelas galat dengan kode status HTTP menempel padanya.
 *
 * Di Postgres, otorisasi dan aturan bisnis dilaporkan lewat SQLSTATE — 42501
 * untuk kewenangan, 23514 untuk CHECK. Kode itu hilang bersama pindahnya
 * logika ke JavaScript, jadi digantikan di sini secara eksplisit.
 */
export class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest   = (m) => new AppError(m, 400, 'bad_request');
export const unauthorized = (m = 'Tidak ada sesi aktif.') => new AppError(m, 401, 'unauthorized');
export const forbidden    = (m = 'Anda tidak berwenang melakukan tindakan ini.') =>
  new AppError(m, 403, 'forbidden');
export const notFound     = (m = 'Data tidak ditemukan.') => new AppError(m, 404, 'not_found');
export const conflict     = (m) => new AppError(m, 409, 'conflict');

/* ==================================================================== */
/* Kata sandi                                                           */
/* ==================================================================== */

/**
 * scrypt dari modul crypto bawaan Node.
 *
 * argon2id sebenarnya pilihan yang lebih baik, tetapi ia menuntut modul
 * native tambahan. scrypt memenuhi syarat sebagai fungsi turunan kata sandi
 * yang lambat dan berat memori — yang penting adalah ia BUKAN hash cepat
 * seperti SHA-256, yang dapat dicoba miliaran kali per detik.
 *
 * Salt 16 byte acak per kata sandi, disimpan bersama hash-nya.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;

  const candidate = scryptSync(plain, salt, SCRYPT.keylen, SCRYPT);
  const expected = Buffer.from(hash, 'hex');

  // Perbandingan berwaktu tetap. Perbandingan biasa berhenti pada byte
  // pertama yang berbeda, dan selisih waktunya dapat dipakai menebak hash.
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * Kata sandi sementara untuk undangan pemasok.
 *
 * Dari randomBytes, bukan Math.random: ia dikirim lewat email dan berlaku
 * tujuh hari. Karakter yang mudah tertukar saat dibaca — 0/O, 1/l/I —
 * dikeluarkan, karena kata sandi ini memang untuk diketik ulang orang.
 */
export function temporaryPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out}#`;
}

/** Masa berlaku kata sandi sementara: 7 hari sejak email terkirim. */
export const PASSWORD_VALID_DAYS = 7;

/**
 * Dihitung, tidak disimpan — alasan yang sama seperti penanda e-invoice dan
 * BIC bank. Menyimpan nilai turunan membuka peluang datanya menyimpang.
 */
export function passwordExpiresAt(account) {
  if (!account?.email_sent_at) return null;
  return new Date(
    new Date(account.email_sent_at).getTime() + PASSWORD_VALID_DAYS * 86_400_000,
  ).toISOString();
}

export function passwordExpired(account) {
  const expiry = passwordExpiresAt(account);
  return Boolean(expiry) && !account.password_changed && expiry < now();
}

/* ==================================================================== */
/* Token sesi                                                           */
/* ==================================================================== */

/**
 * JWT ringkas, ditandatangani HMAC-SHA256.
 *
 * Tidak memakai pustaka: yang dibutuhkan hanya tiga bagian base64url dan satu
 * tanda tangan, dan menuliskannya sendiri berarti tidak ada kejutan tentang
 * algoritma mana yang diterima. Khususnya, verifikasi di bawah menolak `alg`
 * apa pun selain HS256 — celah "alg: none" adalah cara klasik memalsukan
 * token pada pustaka yang terlalu akomodatif.
 *
 * Setiap token menunjuk satu baris user_session, sehingga sesi dapat dicabut.
 * JWT murni tanpa daftar sesi berarti token yang bocor tetap berlaku sampai
 * kedaluwarsa, dan tidak ada cara mengeluarkan pengguna yang sedang aktif.
 */
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'JWT_SECRET belum disetel atau terlalu pendek (minimal 32 karakter). ' +
      'Hasilkan dengan: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
  return s;
}

function sign(data) {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function issueToken(user, { userAgent, ip } = {}) {
  const sessionId = uuid();
  const expiresAt = daysFromNow(7);

  run(
    `insert into user_session (id, user_id, issued_at, expires_at, user_agent, ip_address)
     values (?, ?, ?, ?, ?, ?)`,
    sessionId, user.id, now(), expiresAt, userAgent ?? null, ip ?? null,
  );

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  // Role TIDAK disertakan dalam payload. Ia selalu dibaca ulang dari tabel
  // app_user saat permintaan datang, supaya perubahan role berlaku seketika
  // dan token lama tidak membawa kewenangan yang sudah dicabut.
  const payload = b64url(JSON.stringify({
    sub: user.id,
    sid: sessionId,
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
  }));

  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

export function verifyToken(token) {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let head, body;
  try {
    head = JSON.parse(Buffer.from(header, 'base64url').toString());
    body = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch { return null; }

  if (head.alg !== 'HS256') return null;
  if (body.exp * 1000 < Date.now()) return null;

  const session = one(
    'select * from user_session where id = ? and revoked_at is null',
    body.sid,
  );
  if (!session || session.expires_at < now()) return null;

  return body;
}

export function revokeSession(sessionId) {
  run('update user_session set revoked_at = ? where id = ?', now(), sessionId);
}

/* ==================================================================== */
/* Otorisasi                                                            */
/* ==================================================================== */
// Ini pengganti RLS, dan perlu dibaca dengan kecurigaan yang sepadan.
//
// Di Postgres, kebijakan RLS menempel pada TABEL: kueri apa pun dari arah
// mana pun tetap tersaring. Di sini penyaringan menempel pada KODE, jadi satu
// endpoint yang lupa memanggil guard adalah lubang terbuka. Karena itu
// seluruh akses melewati helper di bawah, dan tidak ada service yang membaca
// req.user secara langsung.

export const INTERNAL_ROLES = ['procurement_staff', 'procurement_admin', 'procurement_manager'];

export function requireUser(user) {
  if (!user) throw unauthorized();
  if (!user.is_active) throw forbidden('Akun Anda dinonaktifkan.');
  return user;
}

/** Melempar bila role pemanggil tidak termasuk yang diizinkan. */
export function requireRole(user, ...allowed) {
  requireUser(user);
  if (!allowed.includes(user.role)) {
    throw forbidden(`Role ${user.role} tidak berwenang melakukan tindakan ini.`);
  }
  return user;
}

export const isInternal = (user) => Boolean(user) && INTERNAL_ROLES.includes(user.role);
export const isSupplier = (user) => user?.role === 'supplier';

/** Staf dan Staf Admin berwenang sama persis; dokumen memisahkan keduanya
 *  hanya pada jalur registrasi internal. */
export const canProcess = (user) =>
  user?.role === 'procurement_staff' || user?.role === 'procurement_admin';

/**
 * Penjaga kepemilikan. Internal melihat semua pemasok; pemasok hanya dirinya.
 *
 * Dipanggil di SETIAP service yang menerima supplierId dari klien. Melewatkannya
 * satu kali berarti pemasok mana pun dapat membaca profil pemasok lain hanya
 * dengan mengganti satu id di URL.
 */
export function assertSupplierAccess(user, supplierId) {
  requireUser(user);
  if (isInternal(user)) return;
  if (user.supplier_id !== supplierId) {
    throw forbidden('Anda hanya dapat mengakses data perusahaan Anda sendiri.');
  }
}

/** Memuat pengguna lengkap dari id pada token. */
export function loadUser(userId) {
  const user = one('select * from app_user where id = ?', userId);
  if (!user) return null;
  user.is_active = Boolean(user.is_active);
  return user;
}

/* ==================================================================== */
/* Jejak audit dan notifikasi                                           */
/* ==================================================================== */

export function logAudit(user, action, objectType, objectId, previous = null, next = null) {
  run(
    `insert into audit_log
       (actor_id, actor_name, actor_role, action, object_type, object_id,
        previous_value, new_value)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    user?.id ?? null,
    user?.full_name ?? 'Sistem',
    user?.role ?? null,
    action, objectType, objectId,
    previous ? JSON.stringify(previous) : null,
    next ? JSON.stringify(next) : null,
  );
}

export function addTimeline(supplierId, label, actorName = null, detail = null, user = null) {
  run(
    `insert into supplier_timeline (supplier_id, label, actor_id, actor_name, detail)
     values (?, ?, ?, ?, ?)`,
    supplierId, label, user?.id ?? null,
    actorName ?? user?.full_name ?? 'Sistem',
    detail ? JSON.stringify(detail) : null,
  );
}

/**
 * Notifikasi dalam aplikasi dan email berbagi satu sumber: tabel ini.
 * Pengiriman emailnya dikerjakan jobs/notifications, yang membaca baris
 * berstatus `pending`. Pemicunya sama, salurannya berbeda.
 */
export function notify({
  event, audience, title, body = null, link = null,
  supplierId = null, recipientId = null, payload = null,
}) {
  const id = uuid();
  run(
    `insert into notification
       (id, event, audience, title, body, link, supplier_id, recipient_id, payload)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, event, audience, title, body, link, supplierId, recipientId,
    payload ? JSON.stringify(payload) : null,
  );
  return id;
}

/* ==================================================================== */
/* Validasi berkas                                                      */
/* ==================================================================== */

const SAFE_FILE_NAME = /^[A-Za-z0-9 ._()-]+$/;
export const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
export const PROFILE_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/**
 * Pesan "file names should not contain unusual characters" pada rancangan
 * diterapkan sebagai validasi sungguhan, bukan keterangan — kerusakan akibat
 * nama aneh baru terasa jauh setelah berkas berpindah antar sistem.
 */
export function assertSafeFileName(name) {
  if (!name || name.length > 255 || !SAFE_FILE_NAME.test(name)) {
    throw badRequest(
      `Nama berkas "${name}" memuat karakter yang tidak diizinkan. ` +
      'Gunakan huruf, angka, spasi, titik, hubung, garis bawah, atau kurung.',
    );
  }
}

export function assertProfileFile({ size, mimeType, fileName }) {
  assertSafeFileName(fileName);
  if (size > MAX_PROFILE_BYTES) throw badRequest(`Berkas ${fileName} melebihi 2 MB.`);
  if (!PROFILE_MIME_TYPES.includes(mimeType)) {
    throw badRequest(`Tipe ${mimeType} tidak diterima; gunakan PDF, JPG, atau PNG.`);
  }
}

/* ==================================================================== */
/* Master data                                                          */
/* ==================================================================== */

/** Paragon Corp Indonesia → ID01..ID06; Paragon Corp Malaysia → MY01. */
export function corporateCodesFor(interfaceNames = []) {
  if (!interfaceNames.length) return [];
  const marks = interfaceNames.map(() => '?').join(',');
  return all(
    `select code from md_corporate_entity
      where interface_name in (${marks}) and active = 1 order by sort_order`,
    ...interfaceNames,
  ).map((r) => r.code);
}
