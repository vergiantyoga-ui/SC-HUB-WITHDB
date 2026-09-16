-- =====================================================================
-- Uji RLS dan batasan struktural
-- =====================================================================
-- Sebagian besar isinya adalah uji NEGATIF: memastikan sesuatu GAGAL.
-- Kebijakan yang hanya diuji dari sisi "pemilik boleh membaca" tidak
-- membuktikan apa pun — yang perlu dibuktikan adalah orang lain tidak boleh.
--
-- Jalankan:
--   psql -d paragon -f supabase/tests/01_rls_test.sql
-- =====================================================================

\set ON_ERROR_STOP on
\set QUIET on
\t on
\pset format unaligned
\pset footer off

create schema if not exists t;

create or replace function t.ok(p_desc text, p_cond boolean)
returns void language plpgsql as $$
begin
  if p_cond then
    raise notice '  LULUS  %', p_desc;
  else
    raise exception 'GAGAL  %', p_desc;
  end if;
end $$;

-- Menjalankan sepotong SQL dan memastikan ia DITOLAK.
create or replace function t.must_fail(p_desc text, p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  LULUS  % (ditolak: %)', p_desc, left(sqlerrm, 60);
    return;
  end;
  raise exception 'GAGAL  % — seharusnya ditolak, ternyata berhasil', p_desc;
end $$;

create or replace function t.login(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function t.logout_to_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function t.try_edit_decision()
returns int language plpgsql as $$
declare n int;
begin
  update public.supplier_preferred_decision set note = 'DIUBAH'
   where superseded_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function t.try_hijack(p_supplier uuid)
returns int language plpgsql as $$
declare n int;
begin
  update public.supplier_tax set tax_name = 'DIBAJAK' where supplier_id = p_supplier;
  get diagnostics n = row_count;
  return n;
end $$;

-- Pembantu uji harus dapat dipanggil dari peran mana pun yang sedang diuji.
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Penyiapan (sebagai pemilik basis data / service_role)
-- ---------------------------------------------------------------------
\echo '== Penyiapan =='

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'staf@paragon.id',
   '{"role":"procurement_staff"}', '{"full_name":"Staf Satu"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@paragon.id',
   '{"role":"procurement_manager"}', '{"full_name":"Manager Satu"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'admin@paragon.id',
   '{"role":"procurement_admin"}', '{"full_name":"Admin Satu"}');

select t.ok('trigger auth.users mengisi app_user',
  (select count(*) = 3 from public.app_user where role <> 'supplier'));

-- Pendaftaran publik lewat RPC, dijalankan sebagai anon.
select t.logout_to_anon();
select register_supplier(jsonb_build_object(
  'general', jsonb_build_object(
     'vendorName','PT Kimia Nusantara','companyEmail','halo@kimianusantara.co.id',
     'legalStatus','Z2','entityType','0001','vendorType','0001',
     'targetCompanies', jsonb_build_array('Paragon Corp Indonesia')),
  'address', jsonb_build_object('city','Tangerang','country','Indonesia'),
  'contact', jsonb_build_object('name','Rani','email','rani@kimianusantara.co.id')
)) \gset reg_
reset role;

select register_supplier(jsonb_build_object(
  'general', jsonb_build_object(
     'vendorName','CV Sumber Kemasan','companyEmail','info@sumberkemasan.co.id',
     'legalStatus','Z1','vendorType','0002'),
  'address','{}'::jsonb,
  'contact', jsonb_build_object('name','Budi')
)) \gset reg2_

create temporary table ids as
select (:'reg_register_supplier'::jsonb ->> 'supplierId')::uuid  as sup_a,
       (:'reg2_register_supplier'::jsonb ->> 'supplierId')::uuid as sup_b;
grant select on ids to anon, authenticated;

select t.ok('pendaftaran anon membuat dua pemasok',
  (select count(*) = 2 from public.supplier));
select t.ok('nomor referensi terbentuk otomatis (SUP-YYYY-0000)',
  (select bool_and(reference ~ '^SUP-[0-9]{4}-[0-9]{4}$') from public.supplier));
select t.ok('tiga bagian profil registrasi ikut tercatat',
  (select count(*) = 6 from public.supplier_profile_section where completed));
select t.ok('target company diterjemahkan ke kode korporat',
  (select count(*) = 6 from public.supplier_target_company));
select t.ok('lini masa dan audit terisi',
  (select count(*) = 2 from public.supplier_timeline)
  and (select count(*) = 2 from public.audit_log where action = 'supplier.registered'));

-- Akun portal untuk pemasok A
select public.provision_supplier_account(sup_a) from ids \g /dev/null
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-0000000000b1', a.login_email,
       jsonb_build_object('role','supplier','supplier_id', a.supplier_id),
       '{"full_name":"Rani"}'
  from public.supplier_account a join ids on ids.sup_a = a.supplier_id;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-0000000000b2', 'sup-pac-0152@suppliers.paragon.id',
       jsonb_build_object('role','supplier','supplier_id', ids.sup_b),
       '{"full_name":"Budi"}' from ids;

update public.supplier set status = 'onboarding' where id in (select sup_a from ids);
update public.supplier set status = 'onboarding' where id in (select sup_b from ids);

-- ---------------------------------------------------------------------
\echo ''
\echo '== Anon =='
-- ---------------------------------------------------------------------
select t.logout_to_anon();

select t.ok('anon membaca master data',
  (select count(*) > 0 from public.md_vendor_type));
select t.must_fail('anon TIDAK dapat membaca tabel supplier',
  'select * from public.supplier');
select t.must_fail('anon TIDAK dapat membaca app_user',
  'select * from public.app_user');
select t.must_fail('anon TIDAK dapat memanggil approve_submission',
  'select public.approve_submission(gen_random_uuid())');
reset role;

-- ---------------------------------------------------------------------
\echo ''
\echo '== Pemasok A =='
-- ---------------------------------------------------------------------
select t.login('00000000-0000-0000-0000-0000000000b1');

select t.ok('pemasok hanya melihat barisnya sendiri',
  (select count(*) = 1 from public.supplier));
select t.ok('baris yang terlihat memang miliknya',
  (select vendor_name = 'PT Kimia Nusantara' from public.supplier));
select t.ok('pemasok tidak melihat pemasok lain di antrean',
  (select count(*) = 1 from public.v_supplier_queue));

select t.must_fail('pemasok TIDAK dapat mengubah statusnya sendiri',
  'update public.supplier set status = ''preferred''');
select t.must_fail('pemasok TIDAK dapat mengubah nomor referensinya',
  'update public.supplier set reference = ''SUP-2026-9999''');
select t.must_fail('pemasok TIDAK dapat menyetujui pendaftaran',
  'select public.approve_submission(id) from public.supplier');
select t.must_fail('pemasok TIDAK dapat memutuskan preferred',
  'select public.decide_preferred(id, ''approved'') from public.supplier');
-- RLS menyaring baris, bukan menolak kueri: yang benar adalah kosong,
-- bukan galat. Membedakan keduanya penting agar uji ini tidak lulus palsu.
select t.ok('pemasok TIDAK melihat satu pun baris audit',
  (select count(*) = 0 from public.audit_log));
select t.must_fail('pemasok TIDAK dapat menaikkan perannya sendiri',
  'update public.app_user set role = ''procurement_admin'' where id = auth.uid()');

-- Menyunting profilnya sendiri: diizinkan.
insert into public.supplier_tax (supplier_id, tax_name, npwp)
select id, 'PT Kimia Nusantara', '1234567890123456' from public.supplier;
select t.ok('pemasok menyunting data pajaknya sendiri',
  (select count(*) = 1 from public.supplier_tax));

select t.must_fail('NPWP bukan 16 digit ditolak',
  'update public.supplier_tax set npwp = ''123''');

insert into public.supplier_contact (supplier_id, name, email, is_primary)
select id, 'Rani', 'rani@kimianusantara.co.id', true from public.supplier;
select t.must_fail('kontak utama kedua ditolak',
  'insert into public.supplier_contact (supplier_id, name, email, is_primary)
   select id, ''Dedi'', ''dedi@x.co.id'', true from public.supplier');

select t.must_fail('dokumen pajak setengah terisi ditolak',
  'insert into public.supplier_tax_document (supplier_id, doc_key, number)
   select id, ''siup'', ''123'' from public.supplier');

select t.must_fail('termin pembayaran berulang ditolak',
  'insert into public.supplier_banking (supplier_id, term_of_payment_1, term_of_payment_2)
   select id, ''D014'', ''D014'' from public.supplier');

reset role;

-- ---------------------------------------------------------------------
\echo ''
\echo '== Pemasok B tidak dapat menyentuh data pemasok A =='
-- ---------------------------------------------------------------------
select t.login('00000000-0000-0000-0000-0000000000b2');

select t.ok('pemasok B tidak melihat data pajak pemasok A',
  (select count(*) = 0 from public.supplier_tax));
select t.ok('pemasok B tidak melihat kontak pemasok A',
  (select count(*) = 0 from public.supplier_contact));

-- Inilah serangan yang paling mungkin terjadi: menebak id pemasok lain.
-- Inilah perbedaan RLS dengan guard di kode: UPDATE-nya berhasil dijalankan,
-- tetapi tidak menemukan satu baris pun untuk disentuh.
select t.ok('menulis atas nama pemasok A tidak menyentuh satu baris pun',
  t.try_hijack((select sup_a from ids)) = 0);

select t.must_fail('menyisipkan baris atas nama pemasok A ditolak',
  'insert into public.supplier_legal_extra (supplier_id, reason_no_doe)
   select sup_a, ''x'' from ids');

reset role;

-- ---------------------------------------------------------------------
\echo ''
\echo '== Staf, manager, admin =='
-- ---------------------------------------------------------------------
select t.login('00000000-0000-0000-0000-0000000000a1');

select t.ok('staf melihat seluruh pemasok',
  (select count(*) = 2 from public.supplier));
select t.ok('staf melihat antrean lengkap',
  (select count(*) = 2 from public.v_supplier_queue));
select t.must_fail('staf TIDAK dapat memutuskan preferred',
  'select public.decide_preferred((select sup_a from ids), ''approved'')');

update public.supplier set status = 'supplier_request' where id = (select sup_b from ids);
select public.approve_submission((select sup_b from ids));
select t.ok('staf menyetujui pendaftaran',
  (select status = 'approved' from public.supplier where id = (select sup_b from ids)));
select t.must_fail('pendaftaran yang sudah diputuskan tidak dapat disetujui lagi',
  'select public.approve_submission((select sup_b from ids))');
select t.must_fail('penolakan tanpa alasan ditolak',
  'select public.reject_submission((select sup_a from ids), ''  '')');

select t.must_fail('audit log tidak dapat disunting',
  'update public.audit_log set action = ''palsu''');
select t.must_fail('lini masa tidak dapat dihapus',
  'delete from public.supplier_timeline');

reset role;

select t.login('00000000-0000-0000-0000-0000000000a2');
update public.supplier set status = 'awaiting_preferred' where id = (select sup_a from ids);
select public.decide_preferred((select sup_a from ids), 'approved', 'Lolos audit pabrik');
select t.ok('manager menetapkan preferred',
  (select status = 'preferred' from public.supplier where id = (select sup_a from ids)));
select t.ok('keputusan preferred tercatat sebagai berlaku',
  (select count(*) = 1 from public.supplier_preferred_decision
    where supplier_id = (select sup_a from ids) and superseded_at is null));
-- Keputusan preferred dijaga dua lapis, dan keduanya perlu diuji terpisah.
-- (1) RLS: manager tidak punya kebijakan tulis langsung ke tabel, jadi
--     UPDATE-nya berjalan tetapi tidak menemukan baris — bukan galat.
select t.ok('manager tidak menyentuh keputusan lewat tabel',
  t.try_edit_decision() = 0);
reset role;

-- (2) Trigger: bahkan pemilik basis data — dan service_role, yang melewati
--     RLS — tetap ditolak. Inilah yang membuat append-only menjadi sifat
--     tabelnya, bukan sifat kebijakannya.
select t.must_fail('keputusan preferred tidak dapat diubah, bahkan oleh pemilik',
  'update public.supplier_preferred_decision set note = ''DIUBAH''');
select t.must_fail('keputusan preferred tidak dapat dihapus',
  'delete from public.supplier_preferred_decision');

-- Keputusan kedua menggantikan yang pertama, tidak menimpanya.
select t.login('00000000-0000-0000-0000-0000000000a2');
select public.decide_preferred((select sup_a from ids), 'disqualified', 'Temuan baru');
select t.ok('keputusan lama ditandai tergantikan, riwayat utuh',
  (select count(*) = 2 from public.supplier_preferred_decision)
  and (select count(*) = 1 from public.supplier_preferred_decision where superseded_at is null));
reset role;

-- ---------------------------------------------------------------------
\echo ''
\echo '== Kuesioner =='
-- ---------------------------------------------------------------------
select t.login('00000000-0000-0000-0000-0000000000a1');

insert into public.questionnaire_template (id, code, name, type)
values ('00000000-0000-0000-0000-0000000000c1','QT-001','Animal Free Statement','compliance');

insert into public.questionnaire_version (id, template_id, version_label, status)
values ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1','v1.0','draft');

insert into public.questionnaire_section (id, version_id, name)
values ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000c2','Pernyataan');

insert into public.question (id, section_id, code, text, type_key, required)
values ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000c3',
        'Q1','Apakah bahan bebas turunan hewan?','yes_no', true);

select t.must_fail('versi draft tidak dapat ditugaskan',
  'insert into public.questionnaire_assignment
     (version_id, supplier_id, assigned_by, assigned_by_name)
   select ''00000000-0000-0000-0000-0000000000c2'', sup_a, auth.uid(), ''Staf Satu'' from ids');

update public.questionnaire_version
   set status = 'published', published_at = now(), published_by = auth.uid()
 where id = '00000000-0000-0000-0000-0000000000c2';

select t.must_fail('pertanyaan pada versi terbit tidak dapat diubah',
  'update public.question set text = ''Pertanyaan lain''
    where id = ''00000000-0000-0000-0000-0000000000c4''');
select t.must_fail('pertanyaan baru tidak dapat ditambahkan ke versi terbit',
  'insert into public.question (section_id, code, text, type_key)
   values (''00000000-0000-0000-0000-0000000000c3'',''Q2'',''Tambahan'',''yes_no'')');
select t.must_fail('bobot skoring versi terbit tidak dapat diubah',
  'update public.questionnaire_version set scoring_enabled = true, passing_score = 70
    where id = ''00000000-0000-0000-0000-0000000000c2''');
select t.must_fail('versi terbit tidak dapat dihapus',
  'delete from public.questionnaire_version where id = ''00000000-0000-0000-0000-0000000000c2''');

insert into public.questionnaire_assignment
  (id, version_id, supplier_id, material_name, assigned_by, assigned_by_name)
select '00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000c2',
       sup_a, 'Gliserin', auth.uid(), 'Staf Satu' from ids;

insert into public.questionnaire_response (id, assignment_id, status)
values ('00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-0000000000c5','in_progress');
reset role;

-- Pemasok B tidak ditugasi: tidak boleh melihat isi kuesionernya sama sekali.
select t.login('00000000-0000-0000-0000-0000000000b2');
select t.ok('pemasok tanpa penugasan tidak melihat template',
  (select count(*) = 0 from public.questionnaire_template));
select t.ok('pemasok tanpa penugasan tidak melihat pertanyaan',
  (select count(*) = 0 from public.question));
select t.ok('pemasok tanpa penugasan tidak melihat respons pemasok lain',
  (select count(*) = 0 from public.questionnaire_response));
reset role;

-- Pemasok A ditugasi: melihat versinya, mengisi jawabannya.
select t.login('00000000-0000-0000-0000-0000000000b1');
select t.ok('pemasok yang ditugasi melihat pertanyaannya',
  (select count(*) = 1 from public.question));
select t.ok('pemasok melihat penugasannya',
  (select count(*) = 1 from public.questionnaire_assignment));

insert into public.response_answer (response_id, question_id, value)
values ('00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-0000000000c4','"yes"');
select t.ok('pemasok mengisi jawaban',
  (select count(*) = 1 from public.response_answer));

select t.must_fail('pemasok TIDAK dapat meninjau kuesionernya sendiri',
  'select public.decide_review(''00000000-0000-0000-0000-0000000000c6'', ''approve'')');

select public.submit_response('00000000-0000-0000-0000-0000000000c6');
select t.ok('pengiriman membuat snapshot revisi',
  (select count(*) = 1 from public.response_revision
    where response_id = '00000000-0000-0000-0000-0000000000c6'));
select t.must_fail('jawaban terkunci setelah dikirim',
  'update public.response_answer set value = ''"no"''
    where response_id = ''00000000-0000-0000-0000-0000000000c6''');
select t.must_fail('snapshot revisi tidak dapat disunting',
  'update public.response_revision set score = 100');
reset role;

-- Tinjauan oleh staf.
select t.login('00000000-0000-0000-0000-0000000000a1');
select public.decide_review('00000000-0000-0000-0000-0000000000c6','request_revision','Lampiran kurang',
  jsonb_build_array(jsonb_build_object(
    'questionId','00000000-0000-0000-0000-0000000000c4','note','Sertakan sertifikat')));
select t.ok('permintaan revisi menaikkan nomor revisi',
  (select current_revision = 2 and status = 'revision_required'
     from public.questionnaire_response where id = '00000000-0000-0000-0000-0000000000c6'));
select t.must_fail('catatan tinjauan tidak dapat dihapus',
  'delete from public.questionnaire_review');
reset role;

-- Setelah diminta revisi, hanya jawaban yang ditandai yang boleh disunting.
select t.login('00000000-0000-0000-0000-0000000000b1');
update public.response_answer set value = '"no"'
 where response_id = '00000000-0000-0000-0000-0000000000c6' and needs_revision;
select t.ok('jawaban bertanda revisi dapat diperbaiki pemasok',
  (select value = '"no"'::jsonb from public.response_answer
    where response_id = '00000000-0000-0000-0000-0000000000c6'));
reset role;

-- ---------------------------------------------------------------------
\echo ''
\echo '== Append-only adalah sifat tabel, bukan sifat hak akses =='
-- ---------------------------------------------------------------------
-- Uji di atas berhenti pada "permission denied" — itu hanya membuktikan
-- hibah tabelnya benar. Yang perlu dibuktikan: pemilik basis data pun tidak
-- bisa, karena service_role dan Edge Function berjalan melewati RLS.
reset role;

select t.must_fail('audit_log tidak dapat disunting pemilik',
  'update public.audit_log set action = ''palsu''');
select t.must_fail('audit_log tidak dapat dihapus pemilik',
  'delete from public.audit_log');
select t.must_fail('supplier_timeline tidak dapat dihapus pemilik',
  'delete from public.supplier_timeline');
select t.must_fail('questionnaire_review tidak dapat dihapus pemilik',
  'delete from public.questionnaire_review');
select t.must_fail('response_revision tidak dapat disunting pemilik',
  'update public.response_revision set score = 100');

-- ---------------------------------------------------------------------
\echo ''
\echo '== View memakai security_invoker =='
-- ---------------------------------------------------------------------
select t.ok('setiap view public memakai security_invoker',
  (select bool_and(coalesce(c.reloptions::text, '') like '%security_invoker=on%')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'));

select t.ok('setiap tabel public menyalakan RLS',
  (select bool_and(c.relrowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'));

select t.ok('tidak ada fungsi SECURITY DEFINER tanpa search_path terkunci',
  (select count(*) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'))
                       as cfg where cfg like 'search_path=%')));

rollback;

\echo ''
\echo '======================================================'
\echo ' SELURUH UJI LULUS'
\echo '======================================================'
