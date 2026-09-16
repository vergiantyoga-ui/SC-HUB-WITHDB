-- =====================================================================
-- seed.sql — data contoh untuk pengembangan lokal
-- =====================================================================
-- Dijalankan otomatis oleh `supabase db reset`. JANGAN dijalankan di
-- proyek produksi: berkas ini membuat pengguna berkata sandi yang tertulis
-- terang-terangan di bawah.
--
-- Master data dan data acuan TIDAK ada di sini — keduanya ikut migrasi,
-- karena produksi juga memerlukannya.
-- =====================================================================

-- Pengguna internal. Trigger handle_new_auth_user() mengisi app_user dari
-- app_metadata, jadi tidak ada insert manual ke app_user di sini.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111101', 'authenticated', 'authenticated',
   'staf@paragon.id', extensions.crypt('Paragon123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"],"role":"procurement_staff"}',
   '{"full_name":"Dina Larasati"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111102', 'authenticated', 'authenticated',
   'admin@paragon.id', extensions.crypt('Paragon123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"],"role":"procurement_admin"}',
   '{"full_name":"Rangga Pratama"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111103', 'authenticated', 'authenticated',
   'manager@paragon.id', extensions.crypt('Paragon123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"],"role":"procurement_manager"}',
   '{"full_name":"Sekar Ayu"}', now(), now())
on conflict (id) do nothing;

-- Identitas email bagi GoTrue. Tanpa baris ini, masuk dengan kata sandi
-- gagal pada Supabase versi baru.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at,
  created_at, updated_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.id in ('11111111-1111-1111-1111-111111111101',
                '11111111-1111-1111-1111-111111111102',
                '11111111-1111-1111-1111-111111111103')
on conflict do nothing;

-- Dua pendaftaran masuk, lewat pintu yang sama dengan pemasok sungguhan.
select public.register_supplier(jsonb_build_object(
  'general', jsonb_build_object(
    'vendorName','PT Kimia Nusantara Jaya',
    'companyEmail','procurement@kimianusantara.co.id',
    'legalStatus','Z2', 'entityType','0001',
    'vendorType','0001', 'vendorTypeDetail','0003',
    'otvStatus','C1', 'vendorDirectType','Z009',
    'officePhone','02155778899', 'website','https://kimianusantara.co.id',
    'targetCompanies', jsonb_build_array('Paragon Corp Indonesia')),
  'address', jsonb_build_object(
    'street','Kawasan Industri Jatake Blok F2', 'country','Indonesia',
    'province','Banten', 'city','Tangerang', 'district','Jatiuwung',
    'subdistrict','Manis Jaya', 'postalCode','15136'),
  'contact', jsonb_build_object(
    'name','Rani Kusuma', 'title','Miss', 'jobPosition','Sales',
    'email','rani@kimianusantara.co.id', 'mobile','081234567890')));

select public.register_supplier(jsonb_build_object(
  'general', jsonb_build_object(
    'vendorName','CV Sumber Kemasan Prima',
    'companyEmail','admin@sumberkemasan.co.id',
    'legalStatus','Z2', 'entityType','0002',
    'vendorType','0002', 'vendorTypeDetail','0001',
    'otvStatus','C1', 'vendorDirectType','Z002',
    'targetCompanies', jsonb_build_array('Paragon Corp Indonesia')),
  'address', jsonb_build_object(
    'street','Jl. Raya Bekasi KM 27', 'country','Indonesia',
    'province','Jawa Barat', 'city','Bekasi', 'postalCode','17132'),
  'contact', jsonb_build_object(
    'name','Budi Santoso', 'title','Mr', 'jobPosition','Finance',
    'email','budi@sumberkemasan.co.id', 'mobile','081298765432')));

-- Satu template kuesioner terbit, siap ditugaskan.
insert into public.questionnaire_template (id, code, name, type, description, owner_name)
values ('22222222-2222-2222-2222-222222222201', 'AFS-001',
        'Animal Free Statement', 'compliance',
        'Pernyataan bahan bebas turunan hewan.', 'Dina Larasati')
on conflict (code) do nothing;

insert into public.questionnaire_version
  (id, template_id, version_label, status, scoring_enabled,
   published_at, published_by, estimated_minutes)
values ('22222222-2222-2222-2222-222222222202',
        '22222222-2222-2222-2222-222222222201', 'v1.0', 'draft', false,
        null, null, 10)
on conflict do nothing;

insert into public.questionnaire_section (id, version_id, name, description, sort_order)
values ('22222222-2222-2222-2222-222222222203',
        '22222222-2222-2222-2222-222222222202',
        'Pernyataan bahan', 'Diisi oleh penanggung jawab mutu.', 1)
on conflict do nothing;

insert into public.question
  (section_id, code, text, type_key, required, sort_order, attachment_rule)
values
  ('22222222-2222-2222-2222-222222222203', 'Q1',
   'Apakah seluruh bahan yang dipasok bebas dari turunan hewan?',
   'yes_no', true, 1, null),
  ('22222222-2222-2222-2222-222222222203', 'Q2',
   'Lampirkan sertifikat pendukung.',
   'file_upload', true, 2,
   '{"required":true,"maxFiles":3,"maxFileSizeMb":2,
     "allowedTypes":["application/pdf","image/jpeg","image/png"],
     "expiryDateRequired":true,"expiryMinDays":30}'::jsonb),
  ('22222222-2222-2222-2222-222222222203', 'Q3',
   'Catatan tambahan.', 'long_text', false, 3, null)
on conflict do nothing;

-- Diterbitkan paling akhir: setelah ini isinya terkunci trigger.
update public.questionnaire_version
   set status = 'published', published_at = now(),
       published_by = '11111111-1111-1111-1111-111111111101'
 where id = '22222222-2222-2222-2222-222222222202';

-- ---------------------------------------------------------------------
-- Kata sandi seluruh pengguna contoh: Paragon123!
-- ---------------------------------------------------------------------
-- Akun pemasok TIDAK dibuat di sini. Alurnya memang: staf menyetujui
-- pendaftaran, lalu memanggil provision_supplier_account(), lalu Edge
-- Function membuat penggunanya. Membuat pintasan di seed hanya akan
-- menyembunyikan langkah yang paling perlu diuji.
