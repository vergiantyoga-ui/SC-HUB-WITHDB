/**
 * Data contoh — padanan mockData.js, questionnaireMockData.js, dan
 * assignmentMockData.js.
 *
 * Menyalakan setiap layar dengan isi sejak pertama dibuka, dan mewakili setiap
 * status lifecycle. JANGAN dijalankan di produksi: berkas ini membuat akun
 * dengan kata sandi yang tertulis di sini.
 *
 *   npm run seed     (atau npm run reset untuk memulai dari kosong)
 */
import { migrate, now, one, openDatabase, run, tx, uuid } from './index.js';
import { hashPassword } from '../lib/core.js';

const DEMO_PASSWORD = 'Paragon#2026';
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const dateIn = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function internalUser(role, fullName, email) {
  const id = uuid();
  run(
    `insert into app_user (id, role, full_name, email, password_hash) values (?,?,?,?,?)`,
    id, role, fullName, email, hashPassword(DEMO_PASSWORD),
  );
  return id;
}

export function seed() {
  openDatabase();
  migrate();

  if (one('select 1 as x from supplier limit 1')) {
    console.log('Basis data sudah berisi data; seed dilewati.');
    console.log('Jalankan `npm run reset` untuk memulai dari kosong.');
    return;
  }

  tx(() => {
    /* ---------------- Pengguna internal ---------------- */
    const dewi = internalUser('procurement_staff', 'Dewi Anggraini',
      'dewi.anggraini@paragon-corp.com');
    const rangga = internalUser('procurement_admin', 'Rangga Prasetyo',
      'rangga.prasetyo@paragon-corp.com');
    const lestari = internalUser('procurement_manager', 'Lestari Handayani',
      'lestari.handayani@paragon-corp.com');

    /* ---------------- Pemasok ---------------- */
    // Sengaja mencakup setiap tahap: dua pendaftaran baru, satu registrasi
    // internal, satu menunggu verifikasi dokumen, satu sudah preferred.
    const suppliers = [
      {
        reference: 'SUP-2026-0148', status: 'supplier_request',
        vendorName: 'PT Sumber Makmur Sejahtera', vendorType: '0001', detail: '0003',
        email: 'procurement@sumbermakmur.co.id', contact: 'Rina Wulandari',
        contactEmail: 'rina.w@sumbermakmur.co.id',
        city: 'Bekasi', province: 'Jawa Barat', path: null,
        submitted: daysAgo(2), decided: null, registered: null,
      },
      {
        reference: 'SUP-2026-0149', status: 'supplier_request',
        vendorName: 'CV Kemasan Nusantara', vendorType: '0002', detail: '0001',
        email: 'info@kemasannusantara.com', contact: 'Ahmad Fauzi',
        contactEmail: 'ahmad.f@kemasannusantara.com',
        city: 'Bandung', province: 'Jawa Barat', path: null,
        submitted: daysAgo(1), decided: null, registered: null,
      },
      {
        reference: 'SUP-2026-0135', status: 'qualification',
        vendorName: 'PT Aroma Esensia Nusantara', vendorType: '0001', detail: '0003',
        email: 'kontak@aromaesensia.co.id', contact: 'Sekar Ayu Pratiwi',
        contactEmail: 'sekar@aromaesensia.co.id',
        city: 'Malang', province: 'Jawa Timur', path: 'internal',
        submitted: daysAgo(14), decided: daysAgo(12), registered: daysAgo(2),
      },
      {
        reference: 'SUP-2026-0131', status: 'registration',
        vendorName: 'PT Karton Sejati Abadi', vendorType: '0002', detail: '0002',
        email: 'admin@kartonsejati.co.id', contact: 'Siti Aminah',
        contactEmail: 'siti.a@kartonsejati.co.id',
        city: 'Semarang', province: 'Jawa Tengah', path: 'invite',
        submitted: daysAgo(24), decided: daysAgo(22), registered: null,
      },
      {
        reference: 'SUP-2026-0118', status: 'preferred',
        vendorName: 'PT Kimia Prima Lestari', vendorType: '0001', detail: '0003',
        email: 'sales@kimiaprima.co.id', contact: 'Hendra Wijaya',
        contactEmail: 'hendra.w@kimiaprima.co.id',
        city: 'Jakarta Timur', province: 'DKI Jakarta', path: 'invite',
        submitted: daysAgo(60), decided: daysAgo(58), registered: daysAgo(40),
      },
    ];

    const ids = {};

    for (const s of suppliers) {
      const id = uuid();
      ids[s.reference] = id;

      run(
        `insert into supplier (
           id, reference, status, legal_status_code, entity_type_code, vendor_name,
           vendor_type_code, vendor_type_detail_code, otv_status_code, vendor_direct_type_code,
           company_email, office_phone, mobile_phone, website,
           address_street, address_country, address_province, address_city, address_postal_code,
           contact_name, contact_title, contact_job_position, contact_email, contact_phone,
           onboarding_path, internal_doc_source, submitted_at, decided_at, registered_at
         ) values (?,?,?,'Z2','0001',?,?,?,'C1','Z002',?,?,?,?,?,'Indonesia',?,?,?,?,'Madam','Sales',?,?,?,?,?,?,?)`,
        id, s.reference, s.status, s.vendorName, s.vendorType, s.detail,
        s.email, '(021) 555-2210', '+62 812-3456-7890',
        `https://www.${s.vendorName.toLowerCase().replace(/[^a-z]/g, '')}.co.id`,
        'Jl. Industri Raya No. 45', s.province, s.city, '17530',
        s.contact, s.contactEmail, '(021) 555-2211',
        s.path, s.path === 'internal' ? 'whatsapp' : null,
        s.submitted, s.decided, s.registered,
      );

      // Paragon Corp Indonesia → enam kode korporat.
      for (const row of [{ code: 'ID01' }, { code: 'ID02' }, { code: 'ID03' },
        { code: 'ID04' }, { code: 'ID05' }, { code: 'ID06' }]) {
        run('insert into supplier_target_company (supplier_id, corporate_entity_code) values (?,?)',
          id, row.code);
      }

      run(`insert into supplier_timeline (supplier_id, at, label, actor_name) values (?,?,?,?)`,
        id, s.submitted, 'Registrasi dikirim pemasok', s.contact);
      if (s.decided) {
        run(`insert into supplier_timeline (supplier_id, at, label, actor_name) values (?,?,?,?)`,
          id, s.decided, 'Registrasi disetujui', 'Dewi Anggraini');
      }
      if (s.registered) {
        run(`insert into supplier_timeline (supplier_id, at, label, actor_name) values (?,?,?,?)`,
          id, s.registered, 'Dokumen lolos periksa, lanjut ke qualification', 'Dewi Anggraini');
      }
    }

    /* ---------------- Profil lengkap untuk tiga pemasok ---------------- */
    const fileFor = (supplierId, section, name) => {
      const fid = uuid();
      run(
        `insert into file_object
           (id, bucket, storage_path, file_name, file_size, mime_type)
         values (?, 'supplier-documents', ?, ?, ?, 'application/pdf')`,
        fid, `${supplierId}/${section}/${fid}-${name}`, name, 640000,
      );
      return fid;
    };

    for (const ref of ['SUP-2026-0131', 'SUP-2026-0118', 'SUP-2026-0135']) {
      const id = ids[ref];
      const supplier = one('select * from supplier where id = ?', id);

      const ktp = fileFor(id, 'tax', 'ktp-direktur.pdf');
      const npwp = fileFor(id, 'tax', 'npwp-perusahaan.pdf');
      const siup = fileFor(id, 'tax', 'siup-2026.pdf');
      const statement = fileFor(id, 'banking', 'rekening-koran.pdf');

      run(
        `insert into supplier_tax (
           supplier_id, tax_name, tax_address, nik, npwp, ktp_file_id, npwp_file_id,
           transaction_type_code, tin, tin_file_id, brn, brn_file_id, gst_number
         ) values (?,?,?,?,?,?,?, 'T01', ?,?,?,?,?)`,
        id, supplier.vendor_name, 'Jl. Industri Raya No. 45, Bekasi 17530',
        '3175094401900002', '0123456789012345', ktp, npwp,
        'TIN-2026-004512', ktp, 'BRN-880231-K', npwp, 'GST-0099-2026',
      );

      run(
        `insert into supplier_tax_document
           (id, supplier_id, doc_key, number, file_id, valid_from, valid_until)
         values (?,?, 'siup', 'SIUP-503/2026', ?, '2026-01-01', '2029-12-31')`,
        uuid(), id, siup,
      );

      for (const doc of ['aktaPendirian', 'skPendirian', 'nib', 'conflictOfInterest',
        'businessLicense']) {
        run('insert into supplier_legal_document (id, supplier_id, doc_key, file_id) values (?,?,?,?)',
          uuid(), id, doc, fileFor(id, 'documents', `${doc}.pdf`));
      }

      run('insert into supplier_legal_extra (supplier_id, reason_no_doe) values (?,?)',
        id, 'Perusahaan berdiri sebelum ketentuan DoE berlaku; dokumen setara terlampir.');

      run(
        `insert into supplier_license
           (id, supplier_id, license_key, number, expiry_date, file_id) values (?,?,'gmp',?,?,?)`,
        uuid(), id, 'GMP-2025-8841', '2028-03-31', fileFor(id, 'licenses', 'gmp.pdf'),
      );
      // CPKB ditandai tidak berlaku — memastikan jalur "not applicable" terpakai.
      run(`insert into supplier_license (id, supplier_id, license_key, not_applicable)
           values (?,?, 'cpkb', 1)`, uuid(), id);
      run(
        `insert into supplier_license
           (id, supplier_id, license_key, number, expiry_date, file_id) values (?,?,'halal',?,?,?)`,
        uuid(), id, 'ID-HAL-77120', '2027-11-20', fileFor(id, 'licenses', 'halal.pdf'),
      );

      run(
        `insert into supplier_banking
           (supplier_id, currency_code, agreement_rate_code, term_of_payment_1, fiscal_position_code)
         values (?, 'IDR', 'active', 'D045', 'FP04')`, id,
      );
      run(
        `insert into supplier_bank_account
           (id, supplier_id, line_order, account_type_code, bank_code,
            account_number, account_holder, statement_file_id)
         values (?,?,1,'AT02','BMRI',?,?,?)`,
        uuid(), id, `13700112233${ref.slice(-1)}`, supplier.vendor_name, statement,
      );

      run(
        `insert into supplier_contact
           (id, supplier_id, name, title, job_position, email, phone, is_primary)
         values (?,?,?,'Madam','Sales',?,?,1)`,
        uuid(), id, supplier.contact_name, supplier.contact_email, '(021) 555-2211',
      );

      for (const section of ['general', 'address', 'contact', 'tax', 'documents',
        'licenses', 'banking', 'contacts']) {
        run(
          `insert into supplier_profile_section
             (supplier_id, section_id, completed, filled_by, filled_at) values (?,?,1,?,?)`,
          id, section, ref === 'SUP-2026-0135' ? 'internal' : 'supplier', daysAgo(5),
        );
      }
    }

    /* ---------------- Akun portal ---------------- */
    for (const [ref, accountId, name] of [
      ['SUP-2026-0131', 'SUP-PAC-0131', 'Siti Aminah'],
      ['SUP-2026-0118', 'SUP-RAW-0118', 'Hendra Wijaya'],
    ]) {
      const supplierId = ids[ref];
      const supplier = one('select * from supplier where id = ?', supplierId);
      const userId = uuid();

      run(
        `insert into app_user (id, role, full_name, email, password_hash, supplier_id)
         values (?, 'supplier', ?, ?, ?, ?)`,
        userId, name, supplier.contact_email, hashPassword(DEMO_PASSWORD), supplierId,
      );
      run(
        `insert into supplier_account
           (id, supplier_id, account_id, auth_user_id, email_sent_at,
            password_changed, password_changed_at)
         values (?,?,?,?,?,1,?)`,
        uuid(), supplierId, accountId, userId, daysAgo(18), daysAgo(17),
      );
    }

    /* ---------------- Persetujuan, verifikasi, kualifikasi ---------------- */
    for (const [ref, verification, verifiedAt] of [
      ['SUP-2026-0131', 'pending', null],
      ['SUP-2026-0118', 'verified', daysAgo(40)],
      ['SUP-2026-0135', 'verified', daysAgo(2)],
    ]) {
      const id = ids[ref];
      const supplier = one('select * from supplier where id = ?', id);

      run(
        `insert into supplier_consent
           (id, supplier_id, gtc_accepted_at, data_accuracy_accepted_at,
            accepted_by, gtc_version, path)
         values (?,?,?,?,?, '2026.04.10', ?)`,
        uuid(), id, daysAgo(3), daysAgo(3), supplier.contact_name,
        supplier.onboarding_path ?? 'invite',
      );
      run(
        `insert into supplier_verification (id, supplier_id, status, verified_at, verified_by)
         values (?,?,?,?,?)`,
        uuid(), id, verification, verifiedAt, verifiedAt ? dewi : null,
      );
    }

    run(
      `insert into supplier_qualification
         (supplier_id, status, filled_by, filled_by_name, completed_at)
       values (?, 'completed', ?, 'Dewi Anggraini', ?)`,
      ids['SUP-2026-0118'], dewi, daysAgo(25),
    );
    run(`insert into supplier_qualification (supplier_id, status) values (?, 'not_started')`,
      ids['SUP-2026-0135']);

    const commodities = one(
      "select group_concat(code) as codes from (select code from md_unspsc_commodity where segment_code = '12' limit 3)",
    ).codes.split(',');

    commodities.forEach((code, i) => {
      run(
        `insert into supplier_qualification_line
           (id, supplier_id, commodity_code, country_code, line_order) values (?,?,?, 'ID', ?)`,
        uuid(), ids['SUP-2026-0118'], code, i + 1,
      );
    });

    run(
      `insert into supplier_preferred_decision
         (id, supplier_id, decision, note, decided_at, decided_by, decided_by_name)
       values (?,?, 'approved', ?, ?, ?, 'Lestari Handayani')`,
      uuid(), ids['SUP-2026-0118'],
      'Rekam jejak mutu baik dan kualifikasi komoditas sesuai kebutuhan.',
      daysAgo(18), lestari,
    );
    run(
      `update supplier set preferred_submitted_at = ?, preferred_submitted_by = ? where id = ?`,
      daysAgo(20), dewi, ids['SUP-2026-0118'],
    );

    /* ---------------- Questionnaire ---------------- */
    seedQuestionnaires(dewi, rangga, ids['SUP-2026-0118']);
  });

  console.log('Seed selesai.');
  console.log(`  ${one('select count(*) as n from supplier').n} pemasok`);
  console.log(`  ${one('select count(*) as n from questionnaire_template').n} template kuesioner`);
  console.log(`  ${one('select count(*) as n from questionnaire_assignment').n} penugasan`);
  console.log(`Kata sandi seluruh akun contoh: ${DEMO_PASSWORD}`);
}

function seedQuestionnaires(dewi, rangga, supplier0118) {
  const section = (versionId, name, order, weight = 1) => {
    const id = uuid();
    run(
      `insert into questionnaire_section (id, version_id, name, sort_order, weight)
       values (?,?,?,?,?)`, id, versionId, name, order, weight,
    );
    return id;
  };

  const question = (sectionId, code, text, typeKey, opts = {}) => {
    const id = uuid();
    run(
      `insert into question
         (id, section_id, code, text, type_key, required, weight, sort_order,
          conditions, attachment_rule)
       values (?,?,?,?,?,?,?,?,?,?)`,
      id, sectionId, code, text, typeKey,
      opts.required ? 1 : 0, opts.weight ?? 1, opts.order ?? 1,
      opts.conditions ? JSON.stringify(opts.conditions) : null,
      opts.attachmentRule ? JSON.stringify(opts.attachmentRule) : null,
    );
    for (const [i, o] of (opts.options ?? []).entries()) {
      run(
        `insert into question_option
           (id, question_id, label, value, score, exclude_from_scoring, sort_order)
         values (?,?,?,?,?,?,?)`,
        uuid(), id, o.label, o.value, o.score ?? 0, o.exclude ? 1 : 0, i + 1,
      );
    }
    return id;
  };

  /* --- Template 1: Supplier Audit — skoring aktif, bercabang --- */
  const auditTemplate = uuid();
  const auditVersion = uuid();
  run(
    `insert into questionnaire_template
       (id, code, name, type, description, target_supplier_type, material_type, owner_id, owner_name)
     values (?, 'QST-AUDIT', 'Supplier Audit', 'Supplier Audit',
             'Audit mutu dan kepatuhan pemasok bahan baku.',
             'Manufacturer', 'Raw Material', ?, 'Dewi Anggraini')`,
    auditTemplate, dewi,
  );
  run(
    `insert into questionnaire_version
       (id, template_id, version_label, status, scoring_enabled, passing_score, estimated_minutes)
     values (?,?, 'v1.0', 'draft', 1, 70, 45)`,
    auditVersion, auditTemplate,
  );

  const s1 = section(auditVersion, 'Profil perusahaan', 1, 1);
  const s2 = section(auditVersion, 'Sistem manajemen mutu', 2, 2);
  const s3 = section(auditVersion, 'Praktik produksi', 3, 2);

  question(s1, 'q_audit_legal', 'Nama badan hukum perusahaan', 'short_text',
    { required: true, order: 1 });
  question(s1, 'q_audit_site', 'Alamat lokasi produksi', 'long_text',
    { required: true, order: 2 });
  question(s1, 'q_audit_employees', 'Jumlah karyawan', 'number',
    { required: true, order: 3 });

  const iso = question(s2, 'q_audit_iso',
    'Apakah perusahaan memiliki sertifikasi ISO 9001?', 'yes_no', {
      required: true, weight: 3, order: 1,
      options: [{ label: 'Ya', value: 'yes', score: 10 },
        { label: 'Tidak', value: 'no', score: 0 }],
    });

  // Pertanyaan bercabang: hanya muncul bila ISO dijawab "tidak".
  question(s2, 'q_audit_iso_plan',
    'Jelaskan rencana perusahaan untuk memperoleh sertifikasi tersebut.', 'long_text', {
      required: true, order: 2,
      conditions: { all: [{ questionId: iso, operator: 'equals', value: 'no' }] },
    });

  question(s2, 'q_audit_qms_doc', 'Apakah manual mutu terdokumentasi dan mutakhir?',
    'yes_no_na', {
      required: true, weight: 2, order: 3,
      attachmentRule: {
        required: true, maxFiles: 3, maxFileSizeMb: 5,
        allowedTypes: ['application/pdf'], expiryDateRequired: false, expiryMinDays: null,
      },
      options: [
        { label: 'Ya', value: 'yes', score: 10 },
        { label: 'Sebagian', value: 'partial', score: 5 },
        { label: 'Tidak', value: 'no', score: 0 },
        { label: 'N/A', value: 'na', score: 0, exclude: true },
      ],
    });

  question(s3, 'q_audit_gmp_score',
    'Nilai kesiapan GMP menurut asesmen internal (1–5)', 'rating', {
      required: true, weight: 2, order: 1,
      options: [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: String(n), score: n * 2 })),
    });

  question(s3, 'q_audit_halal', 'Apakah fasilitas bersertifikat halal?', 'yes_no_na', {
    weight: 1, order: 2,
    attachmentRule: {
      required: false, maxFiles: 1, maxFileSizeMb: 2,
      allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
      expiryDateRequired: true, expiryMinDays: 30,
    },
    options: [
      { label: 'Ya', value: 'yes', score: 10 },
      { label: 'Tidak', value: 'no', score: 0 },
      { label: 'N/A', value: 'na', score: 0, exclude: true },
    ],
  });

  /* --- Template 2: Animal Free Statement — tanpa skoring --- */
  const animalTemplate = uuid();
  const animalVersion = uuid();
  run(
    `insert into questionnaire_template
       (id, code, name, type, description, material_type, owner_id, owner_name)
     values (?, 'QST-ANIMAL', 'Animal Free Statement', 'Compliance Statement',
             'Pernyataan bahan bebas turunan hewani.', 'Raw Material', ?, 'Dewi Anggraini')`,
    animalTemplate, dewi,
  );
  run(
    `insert into questionnaire_version
       (id, template_id, version_label, status, scoring_enabled, estimated_minutes)
     values (?,?, 'v1.0', 'draft', 0, 10)`,
    animalVersion, animalTemplate,
  );

  const a1 = section(animalVersion, 'Pernyataan', 1);
  question(a1, 'q_animal_company', 'Nama perusahaan', 'short_text', { required: true, order: 1 });
  question(a1, 'q_animal_confirm',
    'Kami menyatakan bahan yang dipasok bebas dari turunan hewani.', 'statement',
    { required: true, order: 2 });
  question(a1, 'q_animal_sign', 'Tanda tangan penanggung jawab', 'signature',
    { required: true, order: 3 });

  /* --- Template 3: Halal Compliance — sengaja dibiarkan draf --- */
  const halalTemplate = uuid();
  const halalVersion = uuid();
  run(
    `insert into questionnaire_template (id, code, name, type, description, owner_id, owner_name)
     values (?, 'QST-HALAL', 'Halal Compliance', 'Regulatory Assessment',
             'Asesmen kepatuhan halal — masih disusun.', ?, 'Dewi Anggraini')`,
    halalTemplate, dewi,
  );
  run(
    `insert into questionnaire_version (id, template_id, version_label, status, scoring_enabled)
     values (?,?, 'v0.1', 'draft', 0)`, halalVersion, halalTemplate,
  );
  const h1 = section(halalVersion, 'Ruang lingkup', 1);
  question(h1, 'q_halal_scope', 'Produk apa saja yang tercakup sertifikat halal Anda?',
    'long_text', { required: true, order: 1 });

  /* --- Menerbitkan dua versi, lalu menugaskannya --- */
  for (const v of [auditVersion, animalVersion]) {
    run(
      `update questionnaire_version
          set status = 'published', published_at = ?, published_by = ? where id = ?`,
      daysAgo(30), dewi, v,
    );
  }

  const assignment1 = uuid();
  run(
    `insert into questionnaire_assignment
       (id, version_id, supplier_id, supplier_site, material_category, material_name,
        due_date, reviewer_id, priority, instructions, assigned_by, assigned_by_name, assigned_at)
     values (?,?,?,?,?,?,?,?,'normal',?,?,'Dewi Anggraini',?)`,
    assignment1, auditVersion, supplier0118, 'Pulogadung, Jakarta Timur',
    'Raw Material', 'Surfaktan dan emulsifier', dateIn(21), dewi,
    'Mohon lampirkan sertifikat yang masih berlaku minimal 30 hari sejak tanggal pengisian.',
    dewi, daysAgo(6),
  );
  const response1 = uuid();
  run(
    `insert into questionnaire_response (id, assignment_id, status, started_at)
     values (?,?, 'in_progress', ?)`, response1, assignment1, daysAgo(4),
  );

  const assignment2 = uuid();
  run(
    `insert into questionnaire_assignment
       (id, version_id, supplier_id, supplier_site, material_category, material_name,
        due_date, reviewer_id, priority, assigned_by, assigned_by_name, assigned_at)
     values (?,?,?,?,?,?,?,?, 'high', ?, 'Dewi Anggraini', ?)`,
    assignment2, animalVersion, supplier0118, 'Pulogadung, Jakarta Timur',
    'Raw Material', 'Surfaktan nabati', dateIn(5), rangga, dewi, daysAgo(10),
  );
  run('insert into questionnaire_response (id, assignment_id) values (?,?)', uuid(), assignment2);

  // Satu respons sedang diisi separuh, supaya portal pemasok dan antrian
  // tinjauan punya isi sejak pertama dibuka.
  const answers = {
    q_audit_legal: 'PT Kimia Prima Lestari',
    q_audit_site: 'Kawasan Industri Pulogadung Blok C No. 9, Jakarta Timur',
    q_audit_employees: '148',
    q_audit_iso: 'yes',
  };
  for (const [code, value] of Object.entries(answers)) {
    const q = one(
      `select q.id from question q join questionnaire_section s on s.id = q.section_id
        where s.version_id = ? and q.code = ?`, auditVersion, code,
    );
    run(
      `insert into response_answer (id, response_id, question_id, value) values (?,?,?,?)`,
      uuid(), response1, q.id, JSON.stringify(value),
    );
  }
}

// Dijalankan langsung: node src/db/seed.js
if (import.meta.url === `file://${process.argv[1]}`) seed();
