-- =====================================================================
-- Skema SQLite — Paragon Supply Collaboration Hub
-- =====================================================================
-- Pemindahan dari PostgreSQL. Aturan bisnisnya tidak berubah sedikit pun;
-- yang berubah adalah di mana masing-masing ditegakkan.
--
-- Yang hilang bersama Postgres, dan ke mana perginya:
--   • ENUM          → CHECK (kolom IN (...)). Sama ketatnya, hanya lebih cerewet.
--   • JSONB         → TEXT + CHECK (json_valid(...)). SQLite punya json1, jadi
--                     json_extract dan kawan-kawannya tetap dapat dipakai.
--   • RLS           → dijaga lapisan akses di src/lib/access.js. Ini kehilangan
--                     yang paling serius; lihat catatan di README.
--   • plpgsql / RPC → services/*.js.
--   • citext        → COLLATE NOCASE pada kolom email.
--   • gen_random_uuid → crypto.randomUUID() di sisi aplikasi.
--   • timestamptz   → TEXT berisi ISO 8601 UTC. SQLite tidak punya tipe waktu;
--                     ISO 8601 dipilih karena urutan leksikografisnya sama
--                     dengan urutan kronologisnya, sehingga ORDER BY tetap benar.
--
-- Yang tetap ada: FOREIGN KEY, UNIQUE, CHECK, trigger, view, indeks parsial.
-- Itu cukup untuk menjaga sebagian besar aturan tetap struktural.
-- =====================================================================

pragma foreign_keys = on;

-- ---------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------
create table md_legal_status (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_entity_type (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_vendor_type (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_vendor_type_detail (
  code text primary key, name text not null,
  vendor_type_code text not null references md_vendor_type(code),
  sort_order integer not null default 0, active integer not null default 1
);
create table md_otv_status (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_vendor_direct_type (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);

create table md_corporate_entity (
  code text primary key, name text not null,
  interface_name text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create index idx_corporate_interface on md_corporate_entity(interface_name);

-- provides_einvoice menempel pada tipe transaksi, bukan pada pemasok.
-- Penanda e-invoice tidak pernah disalin ke baris pemasok; ia dibaca lewat
-- join setiap kali dibutuhkan. Lihat view v_supplier_tax.
create table md_transaction_type (
  code text primary key, name text not null,
  provides_einvoice integer not null default 0,
  sort_order integer not null default 0, active integer not null default 1
);

create table md_tax_document_type (
  key text primary key, label text not null,
  required integer not null default 0,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_legal_document_type (
  key text primary key, label text not null,
  doc_group text not null check (doc_group in ('upload','other')),
  required integer not null default 0,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_license_type (
  key text primary key, label text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_currency (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_term_of_payment (
  code text primary key, name text not null, days integer,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_fiscal_position (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_account_type (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);
create table md_agreement_rate (
  code text primary key, name text not null,
  sort_order integer not null default 0, active integer not null default 1
);

-- PERINGATAN: kode BIC di bawah kurasi awal dan BELUM dicocokkan dengan
-- direktori SWIFT resmi. Verifikasi sebelum dipakai untuk pembayaran.
create table md_bank (
  code text primary key, name text not null,
  bic text not null, country text not null,
  sort_order integer not null default 0, active integer not null default 1
);

create table md_unspsc_segment (
  code text primary key, name text not null, sort_order integer not null default 0
);
-- PERINGATAN: kode delapan digit BELUM dicocokkan dengan daftar UNSPSC resmi.
create table md_unspsc_commodity (
  code text primary key, name text not null,
  segment_code text not null references md_unspsc_segment(code),
  sort_order integer not null default 0, active integer not null default 1
);
create index idx_commodity_segment on md_unspsc_commodity(segment_code);

create table md_country (
  code text primary key, name text not null, active integer not null default 1
);

-- Registri tipe soal. Menambah tipe = menambah satu baris di sini.
create table md_question_type (
  key text primary key, label text not null,
  type_group text not null check (type_group in
    ('text','choice','number','date','file','rating','special')),
  has_options integer not null default 0,
  scorable integer not null default 0,
  value_kind text not null check (value_kind in
    ('text','number','date','boolean','array','object')),
  sort_order integer not null default 0, active integer not null default 1
);

-- ---------------------------------------------------------------------
-- Identitas
-- ---------------------------------------------------------------------
-- Tanpa Supabase Auth, kredensial menjadi urusan kita sendiri. password_hash
-- diisi argon2id; tidak pernah ada kata sandi dalam bentuk apa pun selain hash.
create table app_user (
  id            text primary key,
  role          text not null check (role in
                  ('supplier','procurement_staff','procurement_admin','procurement_manager')),
  full_name     text not null,
  email         text collate nocase unique,
  password_hash text,
  supplier_id   text references supplier(id) on delete cascade,
  is_active     integer not null default 1,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  -- Role supplier wajib menunjuk pemasok; role internal wajib tidak.
  check (
    (role = 'supplier' and supplier_id is not null)
    or (role <> 'supplier' and supplier_id is null)
  )
);
create index idx_app_user_role on app_user(role);
create index idx_app_user_supplier on app_user(supplier_id);

-- Sesi disimpan agar token dapat dicabut. JWT murni tanpa daftar sesi berarti
-- token yang bocor tetap berlaku sampai kedaluwarsa, dan tidak ada cara
-- mengeluarkan pengguna dari sesi yang sedang berjalan.
create table user_session (
  id          text primary key,
  user_id     text not null references app_user(id) on delete cascade,
  issued_at   text not null,
  expires_at  text not null,
  revoked_at  text,
  user_agent  text,
  ip_address  text
);
create index idx_session_user on user_session(user_id);

create table supplier_account (
  id                  text primary key,
  supplier_id         text not null unique references supplier(id) on delete cascade,
  account_id          text not null unique,
  auth_user_id        text references app_user(id) on delete set null,
  invite_token        text unique,
  email_sent_at       text,
  password_changed    integer not null default 0,
  password_changed_at text,
  created_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Pemasok
-- ---------------------------------------------------------------------
create table supplier (
  id        text primary key,
  reference text not null unique,
  status    text not null default 'supplier_request' check (status in (
    'supplier_request','rejected','approved','invited','internal_draft',
    'connected','onboarding','registration','needs_document_fix',
    'qualification','awaiting_preferred','preferred','disqualified')),

  legal_status_code       text references md_legal_status(code),
  entity_type_code        text references md_entity_type(code),
  vendor_name             text not null,
  vendor_type_code        text references md_vendor_type(code),
  vendor_type_detail_code text references md_vendor_type_detail(code),
  otv_status_code         text references md_otv_status(code),
  vendor_direct_type_code text references md_vendor_direct_type(code),
  company_email           text collate nocase not null,
  office_phone            text,
  mobile_phone            text,
  website                 text,

  address_street      text,
  address_country     text,
  address_province    text,
  address_city        text,
  address_district    text,
  address_subdistrict text,
  address_postal_code text,

  -- Potret orang yang mendaftar. Sengaja kolom, bukan baris di
  -- supplier_contact: ia tidak ikut berubah ketika daftar kontak disunting.
  contact_name         text,
  contact_title        text,
  contact_job_position text,
  contact_email        text collate nocase,
  contact_phone        text,
  contact_mobile       text,
  contact_notes        text,

  onboarding_path     text check (onboarding_path in ('invite','internal')),
  internal_doc_source text check (internal_doc_source in ('email','whatsapp')),

  submitted_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at             text,
  rejection_reason       text,
  registered_at          text,
  preferred_submitted_at text,
  preferred_submitted_by text references app_user(id),

  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  -- Bentuk badan usaha hanya berlaku bila status badan hukumnya "Badan".
  check (legal_status_code is not 'Z2' or entity_type_code is not null),
  -- Asal dokumen hanya relevan pada jalur internal.
  check (internal_doc_source is null or onboarding_path = 'internal')
);
create index idx_supplier_status on supplier(status);
create index idx_supplier_vendor_type on supplier(vendor_type_code);
create index idx_supplier_path on supplier(onboarding_path);

-- Penomoran referensi. SQLite tidak punya SEQUENCE; satu baris penghitung
-- yang dinaikkan di dalam transaksi memberi jaminan yang sama selama seluruh
-- penulisan lewat satu proses — dan pada SQLite memang begitu adanya, karena
-- penulisnya hanya boleh satu pada satu waktu.
create table counter (
  name  text primary key,
  value integer not null
);
insert into counter (name, value) values ('supplier_reference', 150);

create table supplier_target_company (
  supplier_id           text not null references supplier(id) on delete cascade,
  corporate_entity_code text not null references md_corporate_entity(code),
  primary key (supplier_id, corporate_entity_code)
);

-- Append-only. Lini masa yang bisa disunting bukan lini masa.
create table supplier_timeline (
  id          integer primary key autoincrement,
  supplier_id text not null references supplier(id) on delete cascade,
  at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  label       text not null,
  actor_id    text references app_user(id),
  actor_name  text not null,
  detail      text check (detail is null or json_valid(detail))
);
create index idx_timeline_supplier on supplier_timeline(supplier_id, at desc);

create trigger trg_timeline_no_update before update on supplier_timeline
begin select raise(abort, 'supplier_timeline bersifat append-only'); end;
create trigger trg_timeline_no_delete before delete on supplier_timeline
begin select raise(abort, 'supplier_timeline bersifat append-only'); end;

-- Dua kotak centang terpisah, keduanya wajib, masing-masing berwaktu sendiri.
create table supplier_consent (
  id                        text primary key,
  supplier_id               text not null references supplier(id) on delete cascade,
  gtc_accepted_at           text not null,
  data_accuracy_accepted_at text not null,
  accepted_by               text not null,
  accepted_by_user          text references app_user(id),
  gtc_version               text not null,
  path                      text not null check (path in ('invite','internal')),
  created_at                text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (supplier_id, gtc_version)
);

create table supplier_verification (
  id                   text primary key,
  supplier_id          text not null unique references supplier(id) on delete cascade,
  status               text not null default 'pending'
                         check (status in ('pending','verified','revision_requested')),
  verified_at          text,
  verified_by          text references app_user(id),
  requested_at         text,
  requested_by         text references app_user(id),
  triggered_by_section text,
  created_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table supplier_verification_note (
  id              text primary key,
  verification_id text not null references supplier_verification(id) on delete cascade,
  round           integer not null default 1,
  section_id      text,
  note            text not null,
  resolved        integer not null default 0,
  created_by      text references app_user(id),
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index idx_vnote_verification on supplier_verification_note(verification_id, round);

-- Append-only: diskualifikasi dapat dibuka kembali, dan riwayat keputusan
-- sebelumnya harus tetap terbaca.
create table supplier_preferred_decision (
  id              text primary key,
  supplier_id     text not null references supplier(id) on delete cascade,
  decision        text not null check (decision in ('approved','disqualified')),
  note            text,
  decided_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_by      text not null references app_user(id),
  decided_by_name text not null,
  superseded_at   text
);
create index idx_pref_supplier on supplier_preferred_decision(supplier_id, decided_at desc);

-- Satu-satunya perubahan yang diizinkan: menandai keputusan lama tergantikan.
create trigger trg_pref_immutable before update on supplier_preferred_decision
when new.decision is not old.decision
  or new.note is not old.note
  or new.decided_at is not old.decided_at
  or new.decided_by is not old.decided_by
begin select raise(abort, 'Keputusan preferred tidak dapat diubah setelah dicatat'); end;

create trigger trg_pref_no_delete before delete on supplier_preferred_decision
begin select raise(abort, 'Keputusan preferred tidak dapat dihapus'); end;

-- ---------------------------------------------------------------------
-- Berkas
-- ---------------------------------------------------------------------
-- Isi berkas ada di disk (storage/), tabel ini memegang metadatanya.
create table file_object (
  id           text primary key,
  bucket       text not null check (bucket in ('supplier-documents','questionnaire-attachments')),
  storage_path text not null,
  file_name    text not null,
  file_size    integer not null check (file_size > 0),
  mime_type    text not null,
  checksum     text,
  uploaded_by  text references app_user(id),
  uploaded_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (bucket, storage_path)
);

-- ---------------------------------------------------------------------
-- Profil pemasok
-- ---------------------------------------------------------------------
create table supplier_profile_section (
  supplier_id text not null references supplier(id) on delete cascade,
  section_id  text not null check (section_id in
    ('general','address','contact','tax','documents','licenses','banking','contacts')),
  completed   integer not null default 0,
  filled_by   text,
  filled_at   text,
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (supplier_id, section_id)
);

create table supplier_tax (
  supplier_id           text primary key references supplier(id) on delete cascade,
  tax_name              text,
  tax_address           text,
  -- NIK 16 digit; NPWP dinormalkan ke 16 digit sebelum disimpan.
  nik                   text check (nik is null or (length(nik) = 16 and nik glob '[0-9]*')),
  npwp                  text check (npwp is null or (length(npwp) = 16 and npwp glob '[0-9]*')),
  ktp_file_id           text references file_object(id),
  npwp_file_id          text references file_object(id),
  transaction_type_code text references md_transaction_type(code),
  tin                   text,
  tin_file_id           text references file_object(id),
  brn                   text,
  brn_file_id           text references file_object(id),
  gst_number            text,
  updated_at            text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table supplier_tax_document (
  id          text primary key,
  supplier_id text not null references supplier(id) on delete cascade,
  doc_key     text not null references md_tax_document_type(key),
  number      text,
  file_id     text references file_object(id),
  valid_from  text,
  valid_until text,
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (supplier_id, doc_key),
  check (valid_from is null or valid_until is null or valid_until >= valid_from),
  -- Sekali satu kolom diisi, seluruhnya wajib: nomor tanpa berkas, atau berkas
  -- tanpa masa berlaku, sama-sama tidak berguna saat verifikasi.
  check (
    (number is null and file_id is null and valid_from is null and valid_until is null)
    or (number is not null and file_id is not null
        and valid_from is not null and valid_until is not null)
  )
);
create index idx_taxdoc_supplier on supplier_tax_document(supplier_id);
create index idx_taxdoc_expiry on supplier_tax_document(valid_until);

create table supplier_legal_document (
  id          text primary key,
  supplier_id text not null references supplier(id) on delete cascade,
  doc_key     text not null references md_legal_document_type(key),
  file_id     text not null references file_object(id),
  uploaded_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (supplier_id, doc_key)
);

create table supplier_legal_extra (
  supplier_id   text primary key references supplier(id) on delete cascade,
  reason_no_doe text,
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table supplier_license (
  id             text primary key,
  supplier_id    text not null references supplier(id) on delete cascade,
  license_key    text not null references md_license_type(key),
  number         text,
  expiry_date    text,
  file_id        text references file_object(id),
  not_applicable integer not null default 0,
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (supplier_id, license_key),
  -- Ditandai tidak berlaku berarti tidak ada isian sama sekali.
  check (not_applicable = 0
         or (number is null and expiry_date is null and file_id is null))
);
create index idx_license_supplier on supplier_license(supplier_id);
create index idx_license_expiry on supplier_license(expiry_date) where not_applicable = 0;

create table supplier_banking (
  supplier_id          text primary key references supplier(id) on delete cascade,
  currency_code        text references md_currency(code),
  agreement_rate_code  text references md_agreement_rate(code),
  term_of_payment_1    text references md_term_of_payment(code),
  term_of_payment_2    text references md_term_of_payment(code),
  term_of_payment_3    text references md_term_of_payment(code),
  fiscal_position_code text references md_fiscal_position(code),
  updated_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  -- Termin tidak boleh mengulang; mendaftarkan termin sama dua kali tidak
  -- menambah keterangan apa pun.
  check (term_of_payment_2 is null or term_of_payment_2 is not term_of_payment_1),
  check (term_of_payment_3 is null
         or (term_of_payment_3 is not term_of_payment_1
             and term_of_payment_3 is not term_of_payment_2)),
  -- Termin 3 tanpa termin 2 berarti ada lubang di urutan.
  check (term_of_payment_3 is null or term_of_payment_2 is not null)
);

-- BIC dan negara TIDAK di sini; keduanya diturunkan dari bank_code lewat join.
create table supplier_bank_account (
  id                text primary key,
  supplier_id       text not null references supplier(id) on delete cascade,
  line_order        integer not null default 1,
  account_type_code text not null references md_account_type(code),
  bank_code         text not null references md_bank(code),
  account_number    text not null check (length(trim(account_number)) > 0),
  account_holder    text not null check (length(trim(account_holder)) > 0),
  statement_file_id text not null references file_object(id),
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Rekening dengan nomor sama pada bank yang sama ditolak.
  unique (supplier_id, bank_code, account_number)
);
create index idx_bank_supplier on supplier_bank_account(supplier_id, line_order);

create table supplier_contact (
  id           text primary key,
  supplier_id  text not null references supplier(id) on delete cascade,
  name         text not null,
  title        text,
  job_position text,
  email        text collate nocase not null,
  phone        text,
  mobile       text,
  notes        text,
  is_primary   integer not null default 0,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index idx_contact_supplier on supplier_contact(supplier_id);
-- Tepat satu kontak utama per pemasok.
create unique index idx_contact_one_primary
  on supplier_contact(supplier_id) where is_primary = 1;

-- ---------------------------------------------------------------------
-- Kualifikasi
-- ---------------------------------------------------------------------
create table supplier_qualification (
  supplier_id    text primary key references supplier(id) on delete cascade,
  status         text not null default 'not_started'
                   check (status in ('not_started','draft','completed')),
  filled_by      text references app_user(id),
  filled_by_name text,
  completed_at   text,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table supplier_qualification_line (
  id             text primary key,
  supplier_id    text not null references supplier_qualification(supplier_id) on delete cascade,
  commodity_code text not null references md_unspsc_commodity(code),
  country_code   text not null references md_country(code),
  notes          text,
  line_order     integer not null default 1,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Pasangan komoditas-negara yang berulang ditolak.
  unique (supplier_id, commodity_code, country_code)
);
create index idx_qline_supplier on supplier_qualification_line(supplier_id, line_order);

-- ---------------------------------------------------------------------
-- Questionnaire — definisi
-- ---------------------------------------------------------------------
create table questionnaire_template (
  id                   text primary key,
  code                 text not null unique,
  name                 text not null,
  type                 text not null,
  description          text,
  target_supplier_type text,
  material_type        text,
  owner_id             text references app_user(id),
  owner_name           text,
  archived             integer not null default 0,
  created_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table questionnaire_version (
  id                text primary key,
  template_id       text not null references questionnaire_template(id) on delete cascade,
  version_label     text not null,
  status            text not null default 'draft'
                      check (status in ('draft','published','unpublished','archived')),
  effective_date    text,
  expiry_date       text,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),

  -- Skoring adalah modul yang bisa dimatikan: Animal Free Statement memang
  -- tidak memakainya.
  scoring_enabled integer not null default 0,
  passing_score   real check (passing_score is null or (passing_score between 0 and 100)),
  risk_bands      text not null check (json_valid(risk_bands)) default '[
    {"id":"excellent","label":"Excellent","min":90,"max":100,"risk":"low"},
    {"id":"good","label":"Good","min":75,"max":89.99,"risk":"low"},
    {"id":"needs_improvement","label":"Needs Improvement","min":60,"max":74.99,"risk":"medium"},
    {"id":"high_risk","label":"High Risk","min":0,"max":59.99,"risk":"high"}
  ]',

  published_at   text,
  published_by   text references app_user(id),
  unpublished_at text,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  unique (template_id, version_label),
  check (effective_date is null or expiry_date is null or expiry_date >= effective_date),
  check (scoring_enabled = 0 or passing_score is not null),
  check (status <> 'published' or (published_at is not null and published_by is not null))
);
create index idx_version_template on questionnaire_version(template_id, status);

create table questionnaire_section (
  id              text primary key,
  version_id      text not null references questionnaire_version(id) on delete cascade,
  name            text not null,
  description     text,
  sort_order      integer not null default 0,
  mandatory       integer not null default 1,
  weight          real not null default 1 check (weight >= 0),
  library_item_id text,
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index idx_section_version on questionnaire_section(version_id, sort_order);

create table question (
  id            text primary key,
  section_id    text not null references questionnaire_section(id) on delete cascade,
  code          text not null,
  text          text not null,
  guidance      text,
  type_key      text not null references md_question_type(key),
  required      integer not null default 0,
  default_value text check (default_value is null or json_valid(default_value)),
  placeholder   text,
  help_text     text,
  weight        real not null default 1 check (weight >= 0),
  sort_order    integer not null default 0,

  -- Pohon kondisi tampil:
  --   {"all":[{"questionId":"…","operator":"equals","value":"yes"}]}
  -- Operator: equals notEquals in notIn answered notAnswered gt lt
  conditions text check (conditions is null or json_valid(conditions)),

  -- minLength maxLength min max minSelected maxSelected pattern
  validation text not null default '{}' check (json_valid(validation)),

  -- {"required":bool,"maxFiles":int,"maxFileSizeMb":num,
  --  "allowedTypes":[…],"expiryDateRequired":bool,"expiryMinDays":int|null}
  attachment_rule text check (attachment_rule is null or json_valid(attachment_rule)),

  library_item_id text,
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (section_id, code)
);
create index idx_question_section on question(section_id, sort_order);

create table question_option (
  id                   text primary key,
  question_id          text not null references question(id) on delete cascade,
  label                text not null,
  value                text not null,
  score                real not null default 0,
  -- Dipakai untuk pilihan N/A: ikut dijawab, tidak ikut dihitung.
  exclude_from_scoring integer not null default 0,
  sort_order           integer not null default 0,
  unique (question_id, value)
);
create index idx_option_question on question_option(question_id, sort_order);

-- Imutabilitas versi terbit, ditegakkan struktural.
-- Mengubah yang sudah terbit dilakukan dengan membuat versi baru — v1.0 tetap
-- utuh dan tetap melayani respons lama.
create trigger trg_section_frozen_ins before insert on questionnaire_section
when (select status from questionnaire_version where id = new.version_id) <> 'draft'
begin select raise(abort, 'Versi bukan draft; isinya tidak dapat diubah'); end;

create trigger trg_section_frozen_upd before update on questionnaire_section
when (select status from questionnaire_version where id = old.version_id) <> 'draft'
begin select raise(abort, 'Versi bukan draft; isinya tidak dapat diubah'); end;

create trigger trg_section_frozen_del before delete on questionnaire_section
when (select status from questionnaire_version where id = old.version_id) <> 'draft'
begin select raise(abort, 'Versi bukan draft; isinya tidak dapat diubah'); end;

create trigger trg_question_frozen_ins before insert on question
when (select v.status from questionnaire_version v
      join questionnaire_section s on s.version_id = v.id
      where s.id = new.section_id) <> 'draft'
begin select raise(abort, 'Versi bukan draft; isinya tidak dapat diubah'); end;

create trigger trg_question_frozen_upd before update on question
when (select v.status from questionnaire_version v
      join questionnaire_section s on s.version_id = v.id
      where s.id = old.section_id) <> 'draft'
begin select raise(abort, 'Versi bukan draft; isinya tidak dapat diubah'); end;

create trigger trg_question_frozen_del before delete on question
when (select v.status from questionnaire_version v
      join questionnaire_section s on s.version_id = v.id
      where s.id = old.section_id) <> 'draft'
begin select raise(abort, 'Versi bukan draft; isinya tidak dapat diubah'); end;

create trigger trg_option_frozen_ins before insert on question_option
when (select v.status from questionnaire_version v
      join questionnaire_section s on s.version_id = v.id
      join question q on q.section_id = s.id
      where q.id = new.question_id) <> 'draft'
begin select raise(abort, 'Versi bukan draft; isinya tidak dapat diubah'); end;

create trigger trg_option_frozen_upd before update on question_option
when (select v.status from questionnaire_version v
      join questionnaire_section s on s.version_id = v.id
      join question q on q.section_id = s.id
      where q.id = old.question_id) <> 'draft'
begin select raise(abort, 'Versi bukan draft; isinya tidak dapat diubah'); end;

-- Kolom versi yang boleh berubah setelah terbit hanyalah status dan waktunya.
create trigger trg_version_frozen before update on questionnaire_version
when old.status <> 'draft' and (
     new.version_label is not old.version_label
  or new.scoring_enabled is not old.scoring_enabled
  or new.passing_score is not old.passing_score
  or new.risk_bands is not old.risk_bands
  or new.template_id is not old.template_id)
begin select raise(abort, 'Isi versi terbit tidak dapat diubah; hanya statusnya'); end;

create trigger trg_version_no_delete before delete on questionnaire_version
when old.status <> 'draft'
begin select raise(abort, 'Versi terbit tidak dapat dihapus; gunakan archive'); end;

-- Pustaka. Tidak terhubung FK ke pertanyaan yang memakainya: butir pustaka
-- DISALIN nilainya saat ditambahkan, sehingga menyunting pustaka tidak
-- mengubah kuesioner yang sudah memakainya.
create table question_library_item (
  id              text primary key,
  category        text,
  code            text unique,
  text            text not null,
  guidance        text,
  type_key        text not null references md_question_type(key),
  required        integer not null default 0,
  weight          real not null default 1,
  options         text not null default '[]' check (json_valid(options)),
  validation      text not null default '{}' check (json_valid(validation)),
  attachment_rule text check (attachment_rule is null or json_valid(attachment_rule)),
  created_by      text references app_user(id),
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table section_library_item (
  id          text primary key,
  name        text not null,
  description text,
  payload     text not null check (json_valid(payload)),
  created_by  text references app_user(id),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Questionnaire — penugasan dan respons
-- ---------------------------------------------------------------------
create table questionnaire_assignment (
  id                text primary key,
  version_id        text not null references questionnaire_version(id),
  supplier_id       text not null references supplier(id) on delete cascade,
  supplier_site     text,
  material_category text,
  material_name     text,
  due_date          text,
  reviewer_id       text references app_user(id),
  priority          text not null default 'normal' check (priority in ('low','normal','high')),
  instructions      text,
  assigned_by       text not null references app_user(id),
  assigned_by_name  text not null,
  assigned_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  cancelled_at      text,
  -- Penugasan ganda hanya membuat dua antrian yang saling menimpa.
  unique (version_id, supplier_id, material_name)
);
create index idx_assign_supplier on questionnaire_assignment(supplier_id);
create index idx_assign_reviewer on questionnaire_assignment(reviewer_id);

-- Hanya versi terbit yang boleh ditugaskan. Menugaskan draf berarti pemasok
-- mengisi sesuatu yang masih bisa berubah di bawah kakinya.
create trigger trg_assign_published before insert on questionnaire_assignment
when (select status from questionnaire_version where id = new.version_id) <> 'published'
begin select raise(abort, 'Hanya versi published yang dapat ditugaskan'); end;

create table questionnaire_response (
  id                 text primary key,
  assignment_id      text not null unique references questionnaire_assignment(id) on delete cascade,
  status             text not null default 'not_started' check (status in
                       ('not_started','in_progress','submitted','under_review',
                        'revision_required','approved','rejected','expired')),
  started_at         text,
  submitted_at       text,
  completion_percent real not null default 0 check (completion_percent between 0 and 100),
  score              real,
  risk_level         text,
  current_revision   integer not null default 1 check (current_revision >= 1),
  created_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index idx_response_status on questionnaire_response(status);

-- `value` bertipe JSON karena bentuknya tidak diketahui sampai template
-- dibuat. Ini kebalikan dari profil pemasok, yang bentuknya tetap dan karena
-- itu dinormalkan.
create table response_answer (
  id             text primary key,
  response_id    text not null references questionnaire_response(id) on delete cascade,
  question_id    text not null references question(id),
  value          text check (value is null or json_valid(value)),
  skipped        integer not null default 0,
  -- Selama bernilai 1, pemasok boleh menyuntingnya; jawaban lain terkunci.
  needs_revision integer not null default 0,
  revision_note  text,
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (response_id, question_id)
);
create index idx_answer_response on response_answer(response_id);

create table answer_attachment (
  id          text primary key,
  answer_id   text not null references response_answer(id) on delete cascade,
  file_id     text not null references file_object(id),
  expiry_date text,
  uploaded_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  uploaded_by text references app_user(id)
);
create index idx_attach_answer on answer_attachment(answer_id);

create table questionnaire_review (
  id            text primary key,
  response_id   text not null references questionnaire_response(id) on delete cascade,
  revision      integer not null,
  decision      text not null check (decision in ('approve','reject','request_revision')),
  summary       text,
  reviewer_id   text not null references app_user(id),
  reviewer_name text not null,
  decided_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index idx_review_response on questionnaire_review(response_id, decided_at desc);

create trigger trg_review_no_update before update on questionnaire_review
begin select raise(abort, 'questionnaire_review bersifat append-only'); end;
create trigger trg_review_no_delete before delete on questionnaire_review
begin select raise(abort, 'questionnaire_review bersifat append-only'); end;

create table review_comment (
  id          text primary key,
  review_id   text references questionnaire_review(id) on delete cascade,
  response_id text not null references questionnaire_response(id) on delete cascade,
  question_id text references question(id),
  body        text not null,
  author_id   text references app_user(id),
  author_name text not null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index idx_comment_response on review_comment(response_id, question_id);

-- Setiap putaran pengiriman tersimpan utuh. Snapshot disimpan sebagai dokumen,
-- bukan baris jawaban terduplikasi: yang dibutuhkan kelak adalah "seperti apa
-- jawabannya waktu itu", bukan kueri per pertanyaan atas data lama.
create table response_revision (
  id           text primary key,
  response_id  text not null references questionnaire_response(id) on delete cascade,
  revision     integer not null,
  snapshot     text not null check (json_valid(snapshot)),
  score        real,
  risk_level   text,
  submitted_at text not null,
  submitted_by text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (response_id, revision)
);

create trigger trg_revision_no_update before update on response_revision
begin select raise(abort, 'response_revision bersifat append-only'); end;
create trigger trg_revision_no_delete before delete on response_revision
begin select raise(abort, 'response_revision bersifat append-only'); end;

-- ---------------------------------------------------------------------
-- Jejak audit dan notifikasi
-- ---------------------------------------------------------------------
-- Sengaja tanpa FK ke objeknya: audit log harus tetap terbaca setelah objek
-- yang dicatatnya dihapus. Itulah gunanya.
create table audit_log (
  id             integer primary key autoincrement,
  actor_id       text,
  actor_name     text not null,
  actor_role     text,
  action         text not null,
  object_type    text not null,
  object_id      text,
  previous_value text check (previous_value is null or json_valid(previous_value)),
  new_value      text check (new_value is null or json_valid(new_value)),
  at             text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ip_address     text,
  user_agent     text
);
create index idx_audit_object on audit_log(object_type, object_id, at desc);
create index idx_audit_at on audit_log(at desc);

create trigger trg_audit_no_update before update on audit_log
begin select raise(abort, 'audit_log bersifat append-only'); end;
create trigger trg_audit_no_delete before delete on audit_log
begin select raise(abort, 'audit_log bersifat append-only'); end;

create table notification (
  id            text primary key,
  event         text not null,
  audience      text not null check (audience in ('internal','supplier')),
  title         text not null,
  body          text,
  link          text,
  supplier_id   text references supplier(id) on delete cascade,
  recipient_id  text references app_user(id) on delete cascade,
  payload       text check (payload is null or json_valid(payload)),
  email_status  text not null default 'pending'
                  check (email_status in ('pending','sent','failed','skipped')),
  email_sent_at text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index idx_notif_audience on notification(audience, created_at desc);
create index idx_notif_supplier on notification(supplier_id, created_at desc);
create index idx_notif_pending on notification(email_status) where email_status = 'pending';

-- Penanda terbaca per orang: satu notifikasi internal dilihat banyak staf.
create table notification_read (
  notification_id text not null references notification(id) on delete cascade,
  user_id         text not null references app_user(id) on delete cascade,
  read_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (notification_id, user_id)
);

-- ---------------------------------------------------------------------
-- View — nilai turunan
-- ---------------------------------------------------------------------
-- Keputusan "jangan simpan nilai turunan" dipertahankan penuh. View inilah
-- yang membuatnya tidak membebani pemanggil.
create view v_supplier_tax as
select t.*,
       tt.name as transaction_type_name,
       coalesce(tt.provides_einvoice, 0) as e_invoice_provided
from supplier_tax t
left join md_transaction_type tt on tt.code = t.transaction_type_code;

create view v_supplier_bank_account as
select a.*,
       b.name    as bank_name,
       b.bic     as bank_identifier_code,
       b.country as bank_country,
       at.name   as account_type_name
from supplier_bank_account a
join md_bank b on b.code = a.bank_code
join md_account_type at on at.code = a.account_type_code;

create view v_supplier_expiring_documents as
select s.id as supplier_id, s.reference, s.vendor_name,
       'tax' as kind, td.doc_key, mdt.label as doc_label, td.number,
       td.valid_until as expires_on,
       cast(julianday(td.valid_until) - julianday('now') as integer) as days_left
from supplier_tax_document td
join supplier s on s.id = td.supplier_id
join md_tax_document_type mdt on mdt.key = td.doc_key
where td.valid_until is not null
union all
select s.id, s.reference, s.vendor_name,
       'license', l.license_key, ml.label, l.number, l.expiry_date,
       cast(julianday(l.expiry_date) - julianday('now') as integer)
from supplier_license l
join supplier s on s.id = l.supplier_id
join md_license_type ml on ml.key = l.license_key
where l.expiry_date is not null and l.not_applicable = 0;

create view v_supplier_queue as
select s.id, s.reference, s.status, s.vendor_name, s.company_email,
       vt.name as vendor_type_name, s.onboarding_path,
       s.submitted_at, s.decided_at, s.registered_at,
       acc.account_id, acc.password_changed, acc.email_sent_at,
       ver.status as verification_status,
       q.status   as qualification_status,
       (select count(*) from supplier_qualification_line l where l.supplier_id = s.id)
         as qualification_line_count,
       (select d.decision from supplier_preferred_decision d
         where d.supplier_id = s.id and d.superseded_at is null
         order by d.decided_at desc limit 1) as preferred_decision,
       (select count(*) from supplier_consent c where c.supplier_id = s.id) > 0
         as consent_accepted,
       (select count(*) from supplier_profile_section ps
         where ps.supplier_id = s.id and ps.completed = 1
           and ps.section_id in ('tax','documents','licenses','banking','contacts'))
         as completed_sections
from supplier s
left join md_vendor_type vt on vt.code = s.vendor_type_code
left join supplier_account acc on acc.supplier_id = s.id
left join supplier_verification ver on ver.supplier_id = s.id
left join supplier_qualification q on q.supplier_id = s.id;

create view v_response_overview as
select r.id as response_id, r.status, r.completion_percent, r.score,
       r.risk_level, r.current_revision, r.started_at, r.submitted_at,
       a.id as assignment_id, a.due_date, a.priority, a.material_category,
       a.material_name, a.supplier_site, a.reviewer_id,
       ru.full_name as reviewer_name,
       s.id as supplier_id, s.reference as supplier_reference,
       s.vendor_name as supplier_name,
       v.id as version_id, v.version_label, v.scoring_enabled,
       t.id as template_id, t.name as template_name, t.type as template_type,
       (a.due_date is not null and a.due_date < date('now')
        and r.status in ('not_started','in_progress','revision_required')) as overdue,
       (select count(*) from response_answer ra
         where ra.response_id = r.id and ra.needs_revision = 1) as flagged_count
from questionnaire_response r
join questionnaire_assignment a on a.id = r.assignment_id
join supplier s on s.id = a.supplier_id
join questionnaire_version v on v.id = a.version_id
join questionnaire_template t on t.id = v.template_id
left join app_user ru on ru.id = a.reviewer_id;

-- KPI dihitung di basis data, bukan dengan mengunduh seluruh respons lalu
-- menjumlahkannya di peramban.
create view v_questionnaire_kpi as
select
  (select count(*) from questionnaire_template where archived = 0) as templates_total,
  (select count(*) from questionnaire_version where status = 'published') as versions_published,
  (select count(*) from questionnaire_version where status = 'draft') as versions_draft,
  (select count(*) from questionnaire_assignment where cancelled_at is null) as assignments_total,
  sum(status = 'not_started')       as not_started,
  sum(status = 'in_progress')       as in_progress,
  sum(status = 'submitted')         as submitted,
  sum(status = 'under_review')      as under_review,
  sum(status = 'revision_required') as revision_required,
  sum(status = 'approved')          as approved,
  sum(status = 'rejected')          as rejected,
  sum(overdue)                      as overdue,
  round(avg(completion_percent), 2) as avg_completion,
  round(avg(score), 2)              as avg_score,
  case when count(*) = 0 then 0 else
    round(100.0 * sum(status in
      ('submitted','under_review','approved','rejected','revision_required'))
      / count(*), 2) end            as response_rate
from v_response_overview;

create view v_risk_distribution as
select coalesce(risk_level, 'unscored') as risk_level, count(*) as total
from v_response_overview group by 1;
