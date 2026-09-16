import {
  all, nextSupplierReference, now, one, parseJson, run, today, tx, uuid,
} from '../db/index.js';
import {
  addTimeline, assertSupplierAccess, badRequest, canProcess, conflict,
  corporateCodesFor, forbidden, isInternal, logAudit, notFound, notify,
  passwordExpired, passwordExpiresAt, requireRole, temporaryPassword,
} from '../lib/core.js';

/* ==================================================================== */
/* Membaca                                                              */
/* ==================================================================== */

export function listSuppliers(user, { status, search, path } = {}) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');

  const where = [];
  const params = [];

  if (status?.length) {
    where.push(`status in (${status.map(() => '?').join(',')})`);
    params.push(...status);
  }
  if (path) { where.push('onboarding_path = ?'); params.push(path); }
  if (search) { where.push('vendor_name like ?'); params.push(`%${search}%`); }

  const rows = all(
    `select * from v_supplier_queue
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by submitted_at desc`,
    ...params,
  );

  return rows.map((r) => ({
    ...r,
    password_changed: Boolean(r.password_changed),
    consent_accepted: Boolean(r.consent_accepted),
    qualification_blocked_reason: qualificationIneligibilityReason(r.id),
  }));
}

/** Detail pemasok beserta seluruh profilnya. */
export function getSupplier(user, supplierId) {
  assertSupplierAccess(user, supplierId);

  const supplier = one('select * from supplier where id = ?', supplierId);
  if (!supplier) throw notFound('Pemasok tidak ditemukan.');

  const account = one('select * from supplier_account where supplier_id = ?', supplierId);
  const verification = one('select * from supplier_verification where supplier_id = ?', supplierId);

  return {
    ...supplier,
    targetCompanies: all(
      `select distinct ce.interface_name from supplier_target_company stc
        join md_corporate_entity ce on ce.code = stc.corporate_entity_code
        where stc.supplier_id = ?`, supplierId,
    ).map((r) => r.interface_name),
    // Kode korporat untuk SAP, diturunkan — tidak disimpan di baris pemasok.
    sapCodes: all(
      `select corporate_entity_code from supplier_target_company where supplier_id = ?
        order by corporate_entity_code`, supplierId,
    ).map((r) => r.corporate_entity_code),
    account: account && {
      account_id: account.account_id,
      email_sent_at: account.email_sent_at,
      password_changed: Boolean(account.password_changed),
      password_expires_at: passwordExpiresAt(account),
      password_expired: passwordExpired(account),
    },
    consent: one('select * from supplier_consent where supplier_id = ?', supplierId) ?? null,
    verification: verification && {
      ...verification,
      notes: all(
        'select * from supplier_verification_note where verification_id = ? order by round, created_at',
        verification.id,
      ).map((n) => ({ ...n, resolved: Boolean(n.resolved) })),
    },
    sections: all('select * from supplier_profile_section where supplier_id = ?', supplierId)
      .map((s) => ({ ...s, completed: Boolean(s.completed) })),
    // View memasang kembali penanda e-invoice yang sengaja tidak disimpan.
    tax: one('select * from v_supplier_tax where supplier_id = ?', supplierId) ?? null,
    taxDocuments: all('select * from supplier_tax_document where supplier_id = ?', supplierId),
    legalDocuments: all(
      `select d.*, f.file_name, f.file_size, f.mime_type
         from supplier_legal_document d
         join file_object f on f.id = d.file_id
        where d.supplier_id = ?`, supplierId,
    ),
    legalExtra: one('select * from supplier_legal_extra where supplier_id = ?', supplierId) ?? null,
    licenses: all('select * from supplier_license where supplier_id = ?', supplierId)
      .map((l) => ({ ...l, not_applicable: Boolean(l.not_applicable) })),
    banking: one('select * from supplier_banking where supplier_id = ?', supplierId) ?? null,
    // BIC dan negara diturunkan dari bank_code lewat view.
    bankAccounts: all(
      'select * from v_supplier_bank_account where supplier_id = ? order by line_order', supplierId,
    ),
    contacts: all('select * from supplier_contact where supplier_id = ?', supplierId)
      .map((c) => ({ ...c, is_primary: Boolean(c.is_primary) })),
    qualification: isInternal(user)
      ? {
          ...(one('select * from supplier_qualification where supplier_id = ?', supplierId) ?? {}),
          lines: all(
            'select * from supplier_qualification_line where supplier_id = ? order by line_order',
            supplierId,
          ),
        }
      // Pemasok tidak perlu tahu kategori komoditas yang dicatat staf
      // tentang dirinya.
      : null,
    preferredDecisions: all(
      'select * from supplier_preferred_decision where supplier_id = ? order by decided_at desc',
      supplierId,
    ),
    timeline: all(
      'select * from supplier_timeline where supplier_id = ? order by at', supplierId,
    ).map((t) => ({ ...t, detail: parseJson(t.detail) })),
  };
}

/* ==================================================================== */
/* Pendaftaran                                                          */
/* ==================================================================== */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Pintu masuk publik. Satu-satunya aksi yang tidak menuntut sesi. */
export function registerSupplier(payload) {
  const general = payload.general ?? {};
  const address = payload.address ?? {};
  const contact = payload.contact ?? {};

  if (!general.vendorName?.trim()) throw badRequest('Nama perusahaan wajib diisi.');
  if (!EMAIL_RE.test(general.companyEmail ?? '')) throw badRequest('Email perusahaan tidak sah.');
  if (general.legalStatus === 'Z2' && !general.entityType) {
    throw badRequest('Bentuk badan usaha wajib dipilih untuk status badan hukum Badan.');
  }

  return tx(() => {
    const id = uuid();
    const reference = nextSupplierReference();

    run(
      `insert into supplier (
         id, reference, status,
         legal_status_code, entity_type_code, vendor_name,
         vendor_type_code, vendor_type_detail_code, otv_status_code, vendor_direct_type_code,
         company_email, office_phone, mobile_phone, website,
         address_street, address_country, address_province, address_city,
         address_district, address_subdistrict, address_postal_code,
         contact_name, contact_title, contact_job_position,
         contact_email, contact_phone, contact_mobile, contact_notes
       ) values (?,?,'supplier_request',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, reference,
      general.legalStatus ?? null, general.entityType || null, general.vendorName,
      general.vendorType || null, general.vendorTypeDetail || null,
      general.otvStatus || null, general.vendorDirectType || null,
      general.companyEmail, general.officePhone ?? null,
      general.mobilePhone ?? null, general.website ?? null,
      address.street ?? null, address.country ?? null, address.province ?? null,
      address.city ?? null, address.district ?? null, address.subdistrict ?? null,
      address.postalCode ?? null,
      contact.name ?? null, contact.title ?? null, contact.jobPosition ?? null,
      contact.email ?? null, contact.phone ?? null, contact.mobile ?? null,
      contact.notes ?? null,
    );

    // Nama antarmuka diterjemahkan menjadi kode korporat di sini, bukan di klien.
    for (const code of corporateCodesFor(general.targetCompanies ?? [])) {
      run('insert into supplier_target_company (supplier_id, corporate_entity_code) values (?,?)',
        id, code);
    }

    for (const section of ['general', 'address', 'contact']) {
      run(
        `insert into supplier_profile_section
           (supplier_id, section_id, completed, filled_by, filled_at) values (?,?,1,'supplier',?)`,
        id, section, now(),
      );
    }

    addTimeline(id, 'Registrasi dikirim pemasok', contact.name);
    logAudit(null, 'supplier.registered', 'supplier', id, null,
      { vendorName: general.vendorName });
    notify({
      event: 'supplier.registered', audience: 'internal',
      title: 'Pendaftaran pemasok baru',
      body: `${general.vendorName} menunggu ditinjau.`,
      link: '/internal/antrian', supplierId: id,
    });

    return { supplierId: id, reference };
  });
}

export function approveSubmission(user, supplierId) {
  requireRole(user, 'procurement_staff', 'procurement_admin');

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (!s) throw notFound('Pendaftaran tidak ditemukan.');
    if (s.status !== 'supplier_request') {
      throw conflict('Pendaftaran sudah diputuskan.');
    }

    run('update supplier set status = ?, decided_at = ?, rejection_reason = null, updated_at = ? where id = ?',
      'approved', now(), now(), supplierId);

    addTimeline(supplierId, 'Registrasi disetujui', null, null, user);
    logAudit(user, 'supplier.approved', 'supplier', supplierId);

    return one('select * from supplier where id = ?', supplierId);
  });
}

export function rejectSubmission(user, supplierId, reason) {
  requireRole(user, 'procurement_staff', 'procurement_admin');
  if (!reason?.trim()) throw badRequest('Alasan penolakan wajib diisi.');

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (!s) throw notFound('Pendaftaran tidak ditemukan.');
    if (s.status !== 'supplier_request') throw conflict('Pendaftaran sudah diputuskan.');

    run('update supplier set status = ?, decided_at = ?, rejection_reason = ?, updated_at = ? where id = ?',
      'rejected', now(), reason, now(), supplierId);

    addTimeline(supplierId, 'Registrasi ditolak', null, { reason }, user);
    logAudit(user, 'supplier.rejected', 'supplier', supplierId, null, { reason });

    return one('select * from supplier where id = ?', supplierId);
  });
}

/* ==================================================================== */
/* Onboarding                                                           */
/* ==================================================================== */

/** SUP-<tiga huruf jenis pasokan>-<empat digit terakhir referensi>. */
function buildAccountId(supplierId) {
  const row = one(
    `select s.reference, vt.name as vendor_type
       from supplier s left join md_vendor_type vt on vt.code = s.vendor_type_code
      where s.id = ?`, supplierId,
  );
  const prefix = (row.vendor_type ?? 'GEN').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  return `SUP-${prefix || 'GEN'}-${row.reference.slice(-4)}`;
}

/**
 * Jalur A — undangan portal.
 *
 * Mengembalikan kata sandi sementara supaya lapisan pemanggil dapat
 * mengirimkannya lewat email. Ia TIDAK pernah disimpan dalam bentuk terbaca;
 * yang masuk basis data hanya hash-nya.
 */
export function inviteSupplier(user, supplierId, { resend = false } = {}) {
  requireRole(user, 'procurement_staff', 'procurement_admin');

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (!s) throw notFound('Pemasok tidak ditemukan.');

    const existing = one('select * from supplier_account where supplier_id = ?', supplierId);

    if (!resend) {
      // Urutan pemeriksaan disengaja: akun yang sudah ada disebut lebih dulu,
      // karena itulah yang benar-benar terjadi ketika staf menekan "undang"
      // dua kali. Menyebut statusnya lebih dulu akan menyesatkan.
      if (existing) throw conflict('Pemasok ini sudah punya akun portal.');
      if (s.status !== 'approved') {
        throw conflict(
          `Undangan hanya dapat dikirim setelah pendaftaran disetujui (status kini: ${s.status}).`,
        );
      }
    } else if (!existing) {
      throw conflict('Pemasok ini belum punya akun portal.');
    }

    const accountId = existing?.account_id ?? buildAccountId(supplierId);
    const inviteToken = `pgn-inv-${uuid().replace(/-/g, '').slice(0, 16)}`;
    const password = temporaryPassword();

    if (existing) {
      run(`update supplier_account
              set invite_token = ?, email_sent_at = ?, password_changed = 0, updated_at = ?
            where supplier_id = ?`,
        inviteToken, now(), now(), supplierId);
    } else {
      run(`insert into supplier_account
             (id, supplier_id, account_id, invite_token, email_sent_at)
           values (?,?,?,?,?)`,
        uuid(), supplierId, accountId, inviteToken, now());

      run('update supplier set status = ?, onboarding_path = ?, updated_at = ? where id = ?',
        'invited', 'invite', now(), supplierId);
    }

    run(`insert into supplier_verification (id, supplier_id, status) values (?,?,'pending')
         on conflict(supplier_id) do nothing`, uuid(), supplierId);

    addTimeline(supplierId, resend ? 'Undangan portal dikirim ulang' : 'Undangan portal dikirim',
      null, null, user);
    logAudit(user, resend ? 'supplier.invite_resent' : 'supplier.invited',
      'supplier', supplierId, null, { accountId });

    return {
      accountId,
      inviteToken,
      temporaryPassword: password,
      email: s.contact_email ?? s.company_email,
      vendorName: s.vendor_name,
    };
  });
}

/** Jalur B — registrasi internal. */
export function startInternalRegistration(user, supplierId, documentSource) {
  requireRole(user, 'procurement_staff', 'procurement_admin');
  if (!['email', 'whatsapp'].includes(documentSource)) {
    throw badRequest('Asal dokumen harus email atau whatsapp.');
  }

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (!s) throw notFound('Pemasok tidak ditemukan.');
    // Jalur terkunci setelah dipilih.
    if (s.status !== 'approved' || s.onboarding_path !== null) {
      throw conflict(
        'Registrasi internal hanya dapat dimulai dari status approved yang belum memilih jalur.',
      );
    }

    run(`update supplier set status = 'internal_draft', onboarding_path = 'internal',
            internal_doc_source = ?, updated_at = ? where id = ?`,
      documentSource, now(), supplierId);

    addTimeline(supplierId, 'Jalur registrasi internal dipilih', null,
      { documentSource }, user);
    logAudit(user, 'supplier.internal_started', 'supplier', supplierId);

    return one('select * from supplier where id = ?', supplierId);
  });
}

/* ==================================================================== */
/* Penulis bagian profil                                                */
/* ==================================================================== */

const PROFILE_SECTIONS = ['tax', 'documents', 'licenses', 'banking', 'contacts'];

/** NPWP format lama 15 digit diberi awalan 0 supaya yang tersimpan satu bentuk. */
function normalizeNpwp(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 15 ? `0${digits}` : digits;
}

function writeTax(supplierId, v) {
  run(
    `insert into supplier_tax (
       supplier_id, tax_name, tax_address, nik, npwp, ktp_file_id, npwp_file_id,
       transaction_type_code, tin, tin_file_id, brn, brn_file_id, gst_number, updated_at
     ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     on conflict(supplier_id) do update set
       tax_name = excluded.tax_name, tax_address = excluded.tax_address,
       nik = excluded.nik, npwp = excluded.npwp,
       ktp_file_id = excluded.ktp_file_id, npwp_file_id = excluded.npwp_file_id,
       transaction_type_code = excluded.transaction_type_code,
       tin = excluded.tin, tin_file_id = excluded.tin_file_id,
       brn = excluded.brn, brn_file_id = excluded.brn_file_id,
       gst_number = excluded.gst_number, updated_at = excluded.updated_at`,
    supplierId, v.taxName ?? null, v.taxAddress ?? null,
    String(v.nik ?? '').replace(/\D/g, '') || null,
    normalizeNpwp(v.npwp),
    v.ktpFileId ?? null, v.npwpFileId ?? null, v.transactionType || null,
    v.tin ?? null, v.tinFileId ?? null, v.brn ?? null, v.brnFileId ?? null,
    v.gstNumber ?? null, now(),
  );

  // Yang seluruh kolomnya kosong dihapus, bukan disimpan sebagai baris hampa.
  for (const [key, doc] of Object.entries(v.documents ?? {})) {
    const empty = !doc?.number && !doc?.fileId && !doc?.validFrom && !doc?.validUntil;
    if (empty) {
      run('delete from supplier_tax_document where supplier_id = ? and doc_key = ?',
        supplierId, key);
      continue;
    }
    run(
      `insert into supplier_tax_document
         (id, supplier_id, doc_key, number, file_id, valid_from, valid_until, updated_at)
       values (?,?,?,?,?,?,?,?)
       on conflict(supplier_id, doc_key) do update set
         number = excluded.number, file_id = excluded.file_id,
         valid_from = excluded.valid_from, valid_until = excluded.valid_until,
         updated_at = excluded.updated_at`,
      uuid(), supplierId, key, doc.number || null, doc.fileId || null,
      doc.validFrom || null, doc.validUntil || null, now(),
    );
  }
}

function writeDocuments(supplierId, v) {
  for (const [key, fileId] of Object.entries(v.files ?? {})) {
    if (!fileId) {
      run('delete from supplier_legal_document where supplier_id = ? and doc_key = ?',
        supplierId, key);
      continue;
    }
    run(
      `insert into supplier_legal_document (id, supplier_id, doc_key, file_id)
       values (?,?,?,?)
       on conflict(supplier_id, doc_key) do update set
         file_id = excluded.file_id, uploaded_at = ?`,
      uuid(), supplierId, key, fileId, now(),
    );
  }

  run(
    `insert into supplier_legal_extra (supplier_id, reason_no_doe, updated_at) values (?,?,?)
     on conflict(supplier_id) do update set
       reason_no_doe = excluded.reason_no_doe, updated_at = excluded.updated_at`,
    supplierId, v.reasonNoDoe || null, now(),
  );
}

function writeLicenses(supplierId, v) {
  for (const [key, lic] of Object.entries(v ?? {})) {
    const na = Boolean(lic?.notApplicable);
    run(
      `insert into supplier_license
         (id, supplier_id, license_key, number, expiry_date, file_id, not_applicable, updated_at)
       values (?,?,?,?,?,?,?,?)
       on conflict(supplier_id, license_key) do update set
         number = excluded.number, expiry_date = excluded.expiry_date,
         file_id = excluded.file_id, not_applicable = excluded.not_applicable,
         updated_at = excluded.updated_at`,
      uuid(), supplierId, key,
      na ? null : (lic.number || null),
      na ? null : (lic.expiryDate || null),
      na ? null : (lic.fileId || null),
      na ? 1 : 0, now(),
    );
  }
}

function writeBanking(supplierId, v) {
  run(
    `insert into supplier_banking (
       supplier_id, currency_code, agreement_rate_code,
       term_of_payment_1, term_of_payment_2, term_of_payment_3,
       fiscal_position_code, updated_at
     ) values (?,?,?,?,?,?,?,?)
     on conflict(supplier_id) do update set
       currency_code = excluded.currency_code,
       agreement_rate_code = excluded.agreement_rate_code,
       term_of_payment_1 = excluded.term_of_payment_1,
       term_of_payment_2 = excluded.term_of_payment_2,
       term_of_payment_3 = excluded.term_of_payment_3,
       fiscal_position_code = excluded.fiscal_position_code,
       updated_at = excluded.updated_at`,
    supplierId, v.currency || null, v.setAgreementRate || null,
    v.termsOfPayment1 || null, v.termsOfPayment2 || null, v.termsOfPayment3 || null,
    v.fiscalPosition || null, now(),
  );

  const keep = [];
  let order = 0;

  for (const line of v.lines ?? []) {
    // Baris kosong di akhir tabel adalah hal biasa saat mengisi, bukan
    // kesalahan. Ia dibuang, bukan ditolak.
    const blank = !line.accountType && !line.bankCode
      && !String(line.accountNumber ?? '').trim()
      && !String(line.accountHolder ?? '').trim() && !line.statementFileId;
    if (blank) continue;

    order += 1;
    const existing = one(
      'select id from supplier_bank_account where supplier_id = ? and bank_code = ? and account_number = ?',
      supplierId, line.bankCode, String(line.accountNumber).trim(),
    );

    if (existing) {
      run(
        `update supplier_bank_account
            set line_order = ?, account_type_code = ?, account_holder = ?,
                statement_file_id = ?, updated_at = ?
          where id = ?`,
        order, line.accountType, String(line.accountHolder).trim(),
        line.statementFileId, now(), existing.id,
      );
      keep.push(existing.id);
    } else {
      const id = uuid();
      run(
        `insert into supplier_bank_account
           (id, supplier_id, line_order, account_type_code, bank_code,
            account_number, account_holder, statement_file_id)
         values (?,?,?,?,?,?,?,?)`,
        id, supplierId, order, line.accountType, line.bankCode,
        String(line.accountNumber).trim(), String(line.accountHolder).trim(),
        line.statementFileId,
      );
      keep.push(id);
    }
  }

  const marks = keep.map(() => '?').join(',') || "''";
  run(`delete from supplier_bank_account where supplier_id = ? and id not in (${marks})`,
    supplierId, ...keep);
}

function writeContacts(supplierId, list = []) {
  if (list.length > 10) throw badRequest('Maksimal 10 kontak per pemasok.');
  const primaries = list.filter((c) => c.isPrimary).length;
  if (list.length && primaries !== 1) {
    throw badRequest('Tepat satu kontak harus ditandai sebagai kontak utama.');
  }

  run('delete from supplier_contact where supplier_id = ?', supplierId);

  for (const c of list) {
    run(
      `insert into supplier_contact
         (id, supplier_id, name, title, job_position, email, phone, mobile, notes, is_primary)
       values (?,?,?,?,?,?,?,?,?,?)`,
      uuid(), supplierId, c.name, c.title ?? null, c.jobPosition ?? null,
      c.email, c.phone ?? null, c.mobile ?? null, c.notes ?? null,
      c.isPrimary ? 1 : 0,
    );
  }
}

/* ==================================================================== */
/* Validasi bagian                                                      */
/* ==================================================================== */

/**
 * Padanan profileRules.js, dan penentu apakah bagian boleh ditandai selesai.
 * Frontend tetap memvalidasi lebih dulu supaya galat tampil seketika; ini
 * yang memutuskan.
 */
export function validateSection(supplierId, section) {
  const errors = [];

  if (section === 'tax') {
    const t = one('select * from supplier_tax where supplier_id = ?', supplierId);
    if (!t) return ['Data pajak belum diisi.'];

    if (!t.tax_name) errors.push('Tax name wajib diisi.');
    if (!t.tax_address) errors.push('Tax address wajib diisi.');
    if (!t.nik) errors.push('NIK wajib 16 digit.');
    if (!t.npwp) errors.push('NPWP wajib 16 digit.');
    if (!t.ktp_file_id) errors.push('Unggahan KTP wajib.');
    if (!t.npwp_file_id) errors.push('Unggahan NPWP wajib.');
    if (!t.transaction_type_code) errors.push('Transaction type wajib dipilih.');
    // TIN, BRN, dan GST diwajibkan untuk semua pemasok sesuai permintaan. Bila
    // kelak hanya berlaku bagi pemasok luar negeri, ubah lima baris ini saja.
    if (!t.tin) errors.push('TIN wajib diisi.');
    if (!t.brn) errors.push('BRN wajib diisi.');
    if (!t.gst_number) errors.push('Nomor GST wajib diisi.');
    if (!t.tin_file_id) errors.push('Unggahan TIN wajib.');
    if (!t.brn_file_id) errors.push('Unggahan BRN wajib.');

    // Hanya SIUP yang wajib; lima dokumen lain tidak dimiliki setiap pemasok.
    const siup = one(
      "select 1 from supplier_tax_document where supplier_id = ? and doc_key = 'siup'", supplierId);
    if (!siup) errors.push('Dokumen SIUP wajib dilampirkan.');

    for (const d of all(
      `select mdt.label from supplier_tax_document d
         join md_tax_document_type mdt on mdt.key = d.doc_key
        where d.supplier_id = ? and d.valid_until < ?`, supplierId, today())) {
      errors.push(`${d.label} sudah kedaluwarsa.`);
    }
  }

  if (section === 'documents') {
    for (const m of all(
      `select label from md_legal_document_type m
        where m.required = 1 and m.active = 1
          and not exists (select 1 from supplier_legal_document d
                           where d.supplier_id = ? and d.doc_key = m.key)`, supplierId)) {
      errors.push(`${m.label} wajib diunggah.`);
    }

    // Alasan tanpa DoE hanya wajib selama DoE belum dilampirkan. Mewajibkannya
    // tanpa syarat akan memaksa pemasok yang SUDAH melampirkan DoE menjelaskan
    // mengapa ia tidak melampirkannya.
    const doe = one(
      "select 1 from supplier_legal_document where supplier_id = ? and doc_key = 'deedOfEstablishment'",
      supplierId);
    const extra = one('select reason_no_doe from supplier_legal_extra where supplier_id = ?',
      supplierId);
    if (!doe && !extra?.reason_no_doe) {
      errors.push('Alasan tanpa Deed of Establishment wajib diisi.');
    }
  }

  if (section === 'licenses') {
    for (const m of all(
      `select ml.label from md_license_type ml
         left join supplier_license l on l.supplier_id = ? and l.license_key = ml.key
        where ml.active = 1 and coalesce(l.not_applicable, 0) = 0
          and (l.number is null or l.expiry_date is null or l.file_id is null)`, supplierId)) {
      errors.push(`${m.label} belum lengkap (nomor, masa berlaku, dan berkas).`);
    }
    for (const m of all(
      `select ml.label from supplier_license l
         join md_license_type ml on ml.key = l.license_key
        where l.supplier_id = ? and l.not_applicable = 0 and l.expiry_date < ?`,
      supplierId, today())) {
      errors.push(`${m.label} sudah kedaluwarsa.`);
    }
  }

  if (section === 'banking') {
    const b = one('select * from supplier_banking where supplier_id = ?', supplierId);
    if (!b) return ['Data pembayaran belum diisi.'];
    if (!b.currency_code) errors.push('Mata uang transaksi wajib dipilih.');
    if (!b.agreement_rate_code) errors.push('Set agreement rate wajib dipilih.');
    if (!b.term_of_payment_1) errors.push('Termin pembayaran 1 wajib dipilih.');
    const acc = one('select 1 from supplier_bank_account where supplier_id = ?', supplierId);
    if (!acc) errors.push('Minimal satu rekening bank wajib didaftarkan.');
  }

  if (section === 'contacts') {
    const any = one('select 1 from supplier_contact where supplier_id = ?', supplierId);
    if (!any) errors.push('Minimal satu kontak perusahaan wajib diisi.');
    const primary = one(
      'select 1 from supplier_contact where supplier_id = ? and is_primary = 1', supplierId);
    if (any && !primary) errors.push('Satu kontak harus ditandai sebagai kontak utama.');
  }

  return errors;
}

/* ==================================================================== */
/* Menyimpan profil                                                     */
/* ==================================================================== */

export function saveProfileSection(user, supplierId, sectionId, values) {
  requireRole(user, 'supplier', 'procurement_staff', 'procurement_admin');
  assertSupplierAccess(user, supplierId);

  if (!PROFILE_SECTIONS.includes(sectionId)) {
    throw badRequest(`Bagian ${sectionId} bukan bagian kelengkapan profil.`);
  }

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (!s) throw notFound('Pemasok tidak ditemukan.');

    if (sectionId === 'tax') writeTax(supplierId, values);
    if (sectionId === 'documents') writeDocuments(supplierId, values);
    if (sectionId === 'licenses') writeLicenses(supplierId, values);
    if (sectionId === 'banking') writeBanking(supplierId, values);
    if (sectionId === 'contacts') writeContacts(supplierId, values);

    const errors = validateSection(supplierId, sectionId);
    const filledBy = user.role === 'supplier' ? 'supplier' : 'internal';

    run(
      `insert into supplier_profile_section
         (supplier_id, section_id, completed, filled_by, filled_at, updated_at)
       values (?,?,?,?,?,?)
       on conflict(supplier_id, section_id) do update set
         completed = excluded.completed, filled_by = excluded.filled_by,
         filled_at = excluded.filled_at, updated_at = excluded.updated_at`,
      supplierId, sectionId, errors.length === 0 ? 1 : 0, filledBy, now(), now(),
    );

    // Isian staf pada jalur internal TIDAK mengubah status: pemasok masih
    // harus meninjau dan mengirimkannya sendiri.
    if (user.role === 'supplier' && ['invited', 'connected'].includes(s.status)) {
      run("update supplier set status = 'onboarding', updated_at = ? where id = ?",
        now(), supplierId);
      addTimeline(supplierId, 'Pengisian profil dimulai', null, null, user);
    }

    logAudit(user, 'profile.section_saved', 'supplier', supplierId, null,
      { section: sectionId, completed: errors.length === 0 });

    return { completed: errors.length === 0, errors };
  });
}

export function updateRegistrationSection(user, supplierId, sectionId, v) {
  requireRole(user, 'supplier', 'procurement_staff', 'procurement_admin');
  assertSupplierAccess(user, supplierId);

  return tx(() => {
    if (sectionId === 'general') {
      run(
        `update supplier set
           legal_status_code = coalesce(?, legal_status_code),
           entity_type_code = ?, vendor_name = coalesce(?, vendor_name),
           vendor_type_code = ?, vendor_type_detail_code = ?,
           otv_status_code = ?, vendor_direct_type_code = ?,
           company_email = coalesce(?, company_email),
           office_phone = ?, mobile_phone = ?, website = ?, updated_at = ?
         where id = ?`,
        v.legalStatus || null, v.entityType || null, v.vendorName || null,
        v.vendorType || null, v.vendorTypeDetail || null,
        v.otvStatus || null, v.vendorDirectType || null,
        v.companyEmail || null, v.officePhone ?? null, v.mobilePhone ?? null,
        v.website ?? null, now(), supplierId,
      );

      if (Array.isArray(v.targetCompanies)) {
        run('delete from supplier_target_company where supplier_id = ?', supplierId);
        for (const code of corporateCodesFor(v.targetCompanies)) {
          run('insert into supplier_target_company (supplier_id, corporate_entity_code) values (?,?)',
            supplierId, code);
        }
      }
    } else if (sectionId === 'address') {
      run(
        `update supplier set address_street = ?, address_country = ?, address_province = ?,
           address_city = ?, address_district = ?, address_subdistrict = ?,
           address_postal_code = ?, updated_at = ? where id = ?`,
        v.street ?? null, v.country ?? null, v.province ?? null, v.city ?? null,
        v.district ?? null, v.subdistrict ?? null, v.postalCode ?? null, now(), supplierId,
      );
    } else if (sectionId === 'contact') {
      run(
        `update supplier set contact_name = ?, contact_title = ?, contact_job_position = ?,
           contact_email = ?, contact_phone = ?, contact_mobile = ?, contact_notes = ?,
           updated_at = ? where id = ?`,
        v.name ?? null, v.title ?? null, v.jobPosition ?? null, v.email ?? null,
        v.phone ?? null, v.mobile ?? null, v.notes ?? null, now(), supplierId,
      );
    } else {
      throw badRequest(`Bagian ${sectionId} bukan data pendaftaran.`);
    }

    addTimeline(supplierId, `Data pendaftaran diperbarui (${sectionId})`, null, null, user);
    logAudit(user, 'registration.section_updated', 'supplier', supplierId, null,
      { section: sectionId });

    return one('select * from supplier where id = ?', supplierId);
  });
}

/**
 * Merampungkan registrasi internal.
 *
 * Tidak ada persetujuan manager di tengah jalan: begitu staf merampungkan
 * profil, akun pemasok langsung dibuat dan undangannya dikirim.
 */
export function finishInternalRegistration(user, supplierId) {
  requireRole(user, 'procurement_staff', 'procurement_admin');

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (!s) throw notFound('Pemasok tidak ditemukan.');
    if (s.status !== 'internal_draft') {
      throw conflict('Pemasok ini tidak sedang dalam registrasi internal.');
    }

    // Kelima bagian harus lolos validasi sebelum akun dibuat. Mengirim akun
    // untuk profil yang belum lengkap hanya memindahkan pekerjaan ke pemasok.
    const missing = PROFILE_SECTIONS.filter((sec) => validateSection(supplierId, sec).length > 0);
    if (missing.length) {
      throw badRequest(`Bagian berikut belum lengkap: ${missing.join(', ')}`);
    }

    const accountId = buildAccountId(supplierId);
    const inviteToken = `pgn-inv-${uuid().replace(/-/g, '').slice(0, 16)}`;
    const password = temporaryPassword();

    run(
      `insert into supplier_account (id, supplier_id, account_id, invite_token, email_sent_at)
       values (?,?,?,?,?)
       on conflict(supplier_id) do update set
         invite_token = excluded.invite_token, email_sent_at = excluded.email_sent_at,
         password_changed = 0`,
      uuid(), supplierId, accountId, inviteToken, now(),
    );

    run("update supplier set status = 'connected', updated_at = ? where id = ?", now(), supplierId);
    run(`insert into supplier_verification (id, supplier_id, status) values (?,?,'pending')
         on conflict(supplier_id) do nothing`, uuid(), supplierId);

    addTimeline(supplierId, 'Registrasi internal selesai, akun dikirim ke pemasok',
      null, null, user);
    logAudit(user, 'supplier.internal_finished', 'supplier', supplierId);
    notify({
      event: 'supplier.account_created', audience: 'supplier',
      title: 'Akun portal Anda sudah aktif',
      body: `Masuk memakai ID akun ${accountId} untuk meninjau profil Anda.`,
      link: '/masuk', supplierId,
    });

    return {
      accountId, inviteToken, temporaryPassword: password,
      email: s.contact_email ?? s.company_email, vendorName: s.vendor_name,
    };
  });
}

export function acceptConsent(user, gtcVersion, acceptedBy) {
  requireRole(user, 'supplier');
  const supplierId = user.supplier_id;

  return tx(() => {
    const missing = PROFILE_SECTIONS.filter((sec) => validateSection(supplierId, sec).length > 0);
    if (missing.length) throw badRequest(`Profil belum lengkap: ${missing.join(', ')}`);

    const s = one('select * from supplier where id = ?', supplierId);

    run(
      `insert into supplier_consent
         (id, supplier_id, gtc_accepted_at, data_accuracy_accepted_at,
          accepted_by, accepted_by_user, gtc_version, path)
       values (?,?,?,?,?,?,?,?)
       on conflict(supplier_id, gtc_version) do nothing`,
      uuid(), supplierId, now(), now(), acceptedBy, user.id, gtcVersion,
      s.onboarding_path ?? 'invite',
    );

    run("update supplier set status = 'registration', registered_at = ?, updated_at = ? where id = ?",
      now(), now(), supplierId);

    run(`insert into supplier_verification (id, supplier_id, status) values (?,?,'pending')
         on conflict(supplier_id) do update set status = 'pending'`, uuid(), supplierId);

    addTimeline(supplierId, 'Persetujuan ditandatangani pemasok', acceptedBy, null, user);
    logAudit(user, 'supplier.consent_accepted', 'supplier', supplierId, null,
      { version: gtcVersion });
    notify({
      event: 'documents.awaiting_verification', audience: 'internal',
      title: 'Dokumen menunggu verifikasi',
      body: `${s.vendor_name} sudah menyetujui dan mengirim profilnya.`,
      link: '/internal/verifikasi-dokumen', supplierId,
    });

    return one('select * from supplier where id = ?', supplierId);
  });
}

/* ==================================================================== */
/* Verifikasi dokumen                                                   */
/* ==================================================================== */

export function verifyDocuments(user, supplierId) {
  requireRole(user, 'procurement_staff', 'procurement_admin');

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (!s) throw notFound('Pemasok tidak ditemukan.');

    run(
      `update supplier_verification
          set status = 'verified', verified_at = ?, verified_by = ?,
              triggered_by_section = null, updated_at = ?
        where supplier_id = ?`,
      now(), user.id, now(), supplierId,
    );

    run(
      `update supplier_verification_note set resolved = 1
        where verification_id in (select id from supplier_verification where supplier_id = ?)`,
      supplierId,
    );

    // Tahap ini tidak diberikan pada pemasok yang sudah lewat darinya, mis.
    // pemeriksaan ulang setelah profil disunting saat sudah preferred.
    if (['registration', 'needs_document_fix'].includes(s.status)) {
      run(`update supplier set status = 'qualification',
             registered_at = coalesce(registered_at, ?), updated_at = ? where id = ?`,
        now(), now(), supplierId);
    }

    run(`insert into supplier_qualification (supplier_id, status) values (?, 'not_started')
         on conflict(supplier_id) do nothing`, supplierId);

    addTimeline(supplierId, 'Dokumen lolos periksa, lanjut ke qualification', null, null, user);
    logAudit(user, 'documents.verified', 'supplier', supplierId);
    notify({
      event: 'documents.verified', audience: 'supplier',
      title: 'Dokumen Anda sudah lolos periksa',
      body: 'Profil Anda kini berada pada tahap qualification.',
      link: '/portal/status', supplierId,
    });

    return one('select * from supplier where id = ?', supplierId);
  });
}

/** notes: [{ sectionId, note }] */
export function requestDocumentFix(user, supplierId, notes) {
  requireRole(user, 'procurement_staff', 'procurement_admin');
  if (!Array.isArray(notes) || notes.length === 0) {
    throw badRequest('Permintaan perbaikan harus menyebutkan setidaknya satu catatan.');
  }

  return tx(() => {
    run(
      `insert into supplier_verification
         (id, supplier_id, status, requested_at, requested_by)
       values (?,?,'revision_requested',?,?)
       on conflict(supplier_id) do update set
         status = 'revision_requested', requested_at = excluded.requested_at,
         requested_by = excluded.requested_by, updated_at = ?`,
      uuid(), supplierId, now(), user.id, now(),
    );

    const v = one('select * from supplier_verification where supplier_id = ?', supplierId);
    const round = (one(
      'select coalesce(max(round), 0) as r from supplier_verification_note where verification_id = ?',
      v.id,
    ).r) + 1;

    for (const n of notes) {
      run(
        `insert into supplier_verification_note
           (id, verification_id, round, section_id, note, created_by)
         values (?,?,?,?,?,?)`,
        uuid(), v.id, round, n.sectionId ?? null, n.note, user.id,
      );
    }

    run("update supplier set status = 'needs_document_fix', updated_at = ? where id = ?",
      now(), supplierId);

    addTimeline(supplierId, 'Perbaikan dokumen diminta', null, notes, user);
    logAudit(user, 'documents.fix_requested', 'supplier', supplierId, null, { notes });
    notify({
      event: 'documents.fix_requested', audience: 'supplier',
      title: 'Dokumen perlu diperbaiki',
      body: `Ada ${notes.length} butir yang perlu Anda perbaiki.`,
      link: '/portal/profil', supplierId,
    });

    return one('select * from supplier where id = ?', supplierId);
  });
}

export function resubmitDocuments(user) {
  requireRole(user, 'supplier');
  const supplierId = user.supplier_id;

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (s.status !== 'needs_document_fix') {
      throw conflict('Tidak ada permintaan perbaikan yang menunggu.');
    }

    run(`update supplier_verification
            set status = 'pending', requested_at = null, requested_by = null, updated_at = ?
          where supplier_id = ?`, now(), supplierId);
    run("update supplier set status = 'registration', updated_at = ? where id = ?",
      now(), supplierId);

    addTimeline(supplierId, 'Dokumen perbaikan dikirim ulang', null, null, user);
    logAudit(user, 'documents.resubmitted', 'supplier', supplierId);
    notify({
      event: 'documents.resubmitted', audience: 'internal',
      title: 'Dokumen perbaikan dikirim ulang',
      body: `${s.vendor_name} sudah mengirim ulang dokumennya.`,
      link: '/internal/verifikasi-dokumen', supplierId,
    });

    return one('select * from supplier where id = ?', supplierId);
  });
}

/**
 * Perubahan dokumen setelah pemasok aktif memicu verifikasi ulang. Tanpa ini,
 * pemasok yang sudah lolos periksa dapat mengganti berkasnya tanpa siapa pun
 * memeriksanya lagi.
 */
export function updateActiveProfile(user, supplierId, sectionId, values) {
  const result = saveProfileSection(user, supplierId, sectionId, values);
  const reverify = ['tax', 'documents', 'licenses', 'banking'].includes(sectionId);

  if (reverify) {
    tx(() => {
      run(
        `insert into supplier_verification (id, supplier_id, status, triggered_by_section)
         values (?,?,'pending',?)
         on conflict(supplier_id) do update set
           status = 'pending', triggered_by_section = excluded.triggered_by_section,
           verified_at = null, verified_by = null, updated_at = ?`,
        uuid(), supplierId, sectionId, now(),
      );
      addTimeline(supplierId,
        `Profil disunting (${sectionId}), verifikasi ulang dipicu`, null, null, user);
      notify({
        event: 'documents.reverification', audience: 'internal',
        title: 'Verifikasi ulang diperlukan',
        body: `Bagian ${sectionId} diubah setelah pemasok aktif.`,
        link: '/internal/verifikasi-dokumen', supplierId,
      });
    });
  }

  return { ...result, reverificationTriggered: reverify };
}

/* ==================================================================== */
/* Kualifikasi                                                          */
/* ==================================================================== */

/** Padanan qualificationRules.js. */
export function qualificationIneligibilityReason(supplierId) {
  const s = one('select status from supplier where id = ?', supplierId);
  if (!s) return 'Pemasok tidak ditemukan.';

  if (['supplier_request', 'rejected', 'approved'].includes(s.status)) {
    return 'Pendaftaran belum masuk tahap onboarding.';
  }
  if (['invited', 'connected'].includes(s.status)) {
    return 'Pemasok belum mengirimkan profilnya.';
  }
  if (['internal_draft', 'onboarding'].includes(s.status)) {
    return 'Pengisian profil masih berjalan.';
  }
  if (s.status === 'disqualified') return 'Pemasok berstatus disqualification.';

  return null;
}

export function saveQualification(user, supplierId, lines, status = 'draft') {
  // Manager meninjau tanpa menyunting; hanya staf yang mengisi.
  requireRole(user, 'procurement_staff', 'procurement_admin');

  const reason = qualificationIneligibilityReason(supplierId);
  if (reason) throw conflict(`Pemasok belum layak dikualifikasi: ${reason}`);

  return tx(() => {
    run(
      `insert into supplier_qualification
         (supplier_id, status, filled_by, filled_by_name, completed_at, updated_at)
       values (?,?,?,?,?,?)
       on conflict(supplier_id) do update set
         status = excluded.status, filled_by = excluded.filled_by,
         filled_by_name = excluded.filled_by_name,
         completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
      supplierId, status, user.id, user.full_name,
      status === 'completed' ? now() : null, now(),
    );

    run('delete from supplier_qualification_line where supplier_id = ?', supplierId);

    const seen = new Set();
    let order = 0;

    for (const line of lines ?? []) {
      const blank = !line.commodityCode && !line.countryCode && !String(line.notes ?? '').trim();
      if (blank) continue;

      if (status === 'completed' && (!line.commodityCode || !line.countryCode)) {
        throw badRequest('Menyelesaikan kualifikasi menuntut seluruh baris terisi lengkap.');
      }
      // Baris tak lengkap boleh disimpan sebagai draf, tetapi tidak dapat
      // ditulis ke tabel yang kolomnya NOT NULL.
      if (!line.commodityCode || !line.countryCode) continue;

      const pair = `${line.commodityCode}|${line.countryCode}`;
      if (seen.has(pair)) {
        throw conflict(`Pasangan komoditas–negara ${pair} sudah terdaftar.`);
      }
      seen.add(pair);

      order += 1;
      run(
        `insert into supplier_qualification_line
           (id, supplier_id, commodity_code, country_code, notes, line_order)
         values (?,?,?,?,?,?)`,
        uuid(), supplierId, line.commodityCode, line.countryCode,
        String(line.notes ?? '').trim() || null, order,
      );
    }

    if (status === 'completed' && order === 0) {
      throw badRequest('Kualifikasi tidak dapat diselesaikan tanpa satu pun baris.');
    }

    addTimeline(supplierId,
      status === 'completed' ? 'Kualifikasi diselesaikan' : 'Draf kualifikasi disimpan',
      null, null, user);
    logAudit(user, 'qualification.saved', 'supplier', supplierId, null,
      { status, lines: order });

    return { status, lineCount: order };
  });
}

/* ==================================================================== */
/* Preferred supplier                                                   */
/* ==================================================================== */

export function submitForPreferred(user, supplierId) {
  requireRole(user, 'procurement_staff', 'procurement_admin');

  return tx(() => {
    const q = one('select status from supplier_qualification where supplier_id = ?', supplierId);
    // Pengajuan terkunci selama kualifikasi belum terisi, karena justru itu
    // yang dinilai manager.
    if (q?.status !== 'completed') {
      throw conflict('Kualifikasi komoditas harus selesai sebelum pengajuan preferred.');
    }

    const s = one('select * from supplier where id = ?', supplierId);
    if (s.status !== 'qualification') {
      throw conflict('Hanya pemasok pada tahap qualification yang dapat diajukan.');
    }

    run(
      `update supplier set status = 'awaiting_preferred',
         preferred_submitted_at = ?, preferred_submitted_by = ?, updated_at = ?
       where id = ?`,
      now(), user.id, now(), supplierId,
    );

    addTimeline(supplierId, 'Diajukan sebagai preferred supplier', null, null, user);
    logAudit(user, 'preferred.submitted', 'supplier', supplierId);
    notify({
      event: 'preferred.submitted', audience: 'internal',
      title: 'Pengajuan preferred supplier',
      body: `${s.vendor_name} menunggu keputusan manager.`,
      link: '/internal/persetujuan', supplierId,
    });

    return one('select * from supplier where id = ?', supplierId);
  });
}

export function decidePreferred(user, supplierId, decision, note) {
  // Hanya manager yang memutuskan.
  requireRole(user, 'procurement_manager');

  if (!['approved', 'disqualified'].includes(decision)) {
    throw badRequest('Keputusan harus approved atau disqualified.');
  }
  if (decision === 'disqualified' && !note?.trim()) {
    throw badRequest('Alasan diskualifikasi wajib diisi.');
  }

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (!s) throw notFound('Pemasok tidak ditemukan.');
    if (s.status !== 'awaiting_preferred') {
      throw conflict('Hanya pengajuan yang menunggu keputusan yang dapat diputuskan.');
    }

    run('update supplier set status = ?, updated_at = ? where id = ?',
      decision === 'approved' ? 'preferred' : 'disqualified', now(), supplierId);

    run(`update supplier_preferred_decision set superseded_at = ?
          where supplier_id = ? and superseded_at is null`, now(), supplierId);

    run(
      `insert into supplier_preferred_decision
         (id, supplier_id, decision, note, decided_by, decided_by_name)
       values (?,?,?,?,?,?)`,
      uuid(), supplierId, decision, note ?? null, user.id, user.full_name,
    );

    addTimeline(supplierId,
      decision === 'approved' ? 'Ditetapkan sebagai preferred supplier' : 'Pemasok didiskualifikasi',
      null, { note }, user);
    logAudit(user, `preferred.${decision}`, 'supplier', supplierId, null, { note });
    notify({
      event: `preferred.${decision}`, audience: 'supplier',
      title: decision === 'approved'
        ? 'Anda ditetapkan sebagai preferred supplier'
        : 'Pengajuan Anda tidak dilanjutkan',
      body: note, link: '/portal/status', supplierId,
    });

    return one('select * from supplier where id = ?', supplierId);
  });
}

/**
 * Diskualifikasi bukan jalan buntu: pemasok dapat dikembalikan ke tahap
 * qualification, dan keputusan lamanya tetap tersimpan sebagai riwayat.
 */
export function reopenQualification(user, supplierId) {
  requireRole(user, 'procurement_manager');

  return tx(() => {
    const s = one('select * from supplier where id = ?', supplierId);
    if (s?.status !== 'disqualified') {
      throw conflict('Hanya pemasok berstatus disqualification yang dapat dikembalikan.');
    }

    run(`update supplier set status = 'qualification', preferred_submitted_at = null,
           preferred_submitted_by = null, updated_at = ? where id = ?`, now(), supplierId);
    run(`update supplier_preferred_decision set superseded_at = ?
          where supplier_id = ? and superseded_at is null`, now(), supplierId);

    addTimeline(supplierId, 'Dikembalikan ke tahap qualification', null, null, user);
    logAudit(user, 'preferred.reopened', 'supplier', supplierId);

    return one('select * from supplier where id = ?', supplierId);
  });
}

export function listExpiringDocuments(user, withinDays = 60) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');
  return all(
    `select * from v_supplier_expiring_documents
      where days_left between 0 and ? order by days_left`, withinDays,
  );
}
