-- =====================================================================
-- 14 — Perpindahan status yang dipicu pemasok
-- =====================================================================
-- Migrasi 04 menutup kolom `status` dari pemasok lewat trigger
-- guard_supplier_columns, dan itu benar: pemasok tidak boleh menaikkan
-- dirinya sendiri menjadi preferred.
--
-- Tetapi tiga perpindahan status memang DIPICU pemasok, dan ketiganya jadi
-- mustahil setelah kolom itu ditutup:
--
--   connected        → onboarding    saat mulai mengisi profil
--   onboarding       → registration  saat menyetujui GTC
--   needs_document_fix → registration  saat mengirim ulang perbaikan
--
-- Ketiganya pindah ke RPC. Bedanya dengan membuka kolom `status`: di sini
-- pemasok tidak memilih status tujuannya — ia hanya menyatakan sebuah
-- peristiwa, dan fungsi inilah yang menentukan akibatnya.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Menandai satu bagian profil selesai
-- ---------------------------------------------------------------------
-- Isinya sendiri ditulis langsung ke tabel oleh klien (RLS mengizinkannya);
-- fungsi ini hanya mencatat kelengkapannya dan memindahkan status pertama
-- kali pemasok mulai mengisi.
create or replace function public.mark_profile_section(
  p_section_id public.profile_section_id,
  p_completed  boolean default true)
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare
  v_supplier uuid := public.auth_supplier_id();
  s public.supplier;
begin
  if v_supplier is null then
    raise exception 'Hanya pemasok yang dapat menandai bagian profilnya'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.supplier_profile_section
    (supplier_id, section_id, completed, filled_by, filled_at)
  values (v_supplier, p_section_id, p_completed, 'supplier',
          case when p_completed then now() end)
  on conflict (supplier_id, section_id) do update
     set completed = excluded.completed,
         filled_by = excluded.filled_by,
         filled_at = excluded.filled_at;

  -- Pemasok yang baru menyentuh profilnya berpindah dari 'connected'.
  update public.supplier
     set status = 'onboarding'
   where id = v_supplier and status = 'connected';

  select * into s from public.supplier where id = v_supplier;
  return s;
end $$;

-- ---------------------------------------------------------------------
-- Persetujuan GTC
-- ---------------------------------------------------------------------
-- Dua kotak centang terpisah, keduanya wajib, masing-masing berwaktu
-- sendiri. Persetujuan inilah yang menutup tahap onboarding dan mengantre
-- pemasok untuk pemeriksaan dokumen.
create or replace function public.accept_consent(
  p_gtc_version text,
  p_accepted_by text)
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare
  v_supplier uuid := public.auth_supplier_id();
  v_path public.onboarding_path;
  v_missing text;
  s public.supplier;
begin
  if v_supplier is null then
    raise exception 'Hanya pemasok yang dapat menyetujui GTC'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_accepted_by),'') = '' then
    raise exception 'Nama penyetuju wajib diisi.' using errcode = 'check_violation';
  end if;

  -- Menyetujui GTC atas profil yang belum lengkap hanya memindahkan
  -- pekerjaan yang belum selesai ke antrean orang lain.
  select string_agg(x.section::text, ', ' order by x.section) into v_missing
    from unnest(array['tax','documents','licenses','banking','contacts']
                ::public.profile_section_id[]) as x(section)
   where not exists (
     select 1 from public.supplier_profile_section ps
      where ps.supplier_id = v_supplier and ps.section_id = x.section and ps.completed);

  if v_missing is not null then
    raise exception 'Bagian berikut belum lengkap: %', v_missing
      using errcode = 'check_violation';
  end if;

  select coalesce(onboarding_path, 'invite') into v_path
    from public.supplier where id = v_supplier;

  insert into public.supplier_consent
    (supplier_id, gtc_accepted_at, data_accuracy_accepted_at,
     accepted_by, accepted_by_user, gtc_version, path)
  values (v_supplier, now(), now(), btrim(p_accepted_by), auth.uid(),
          p_gtc_version, v_path)
  on conflict (supplier_id, gtc_version) do nothing;

  update public.supplier
     set status = 'registration', registered_at = coalesce(registered_at, now())
   where id = v_supplier and status in ('onboarding','connected');

  insert into public.supplier_verification (supplier_id, status)
  values (v_supplier, 'pending')
  on conflict (supplier_id) do update set status = 'pending';

  insert into public.supplier_timeline (supplier_id, label, actor_id, actor_name)
  values (v_supplier, 'Profil dikirim untuk pemeriksaan dokumen',
          auth.uid(), btrim(p_accepted_by));

  perform public.notify_event(
    'supplier.registered_profile', 'internal', 'Profil pemasok siap diperiksa',
    null, '/internal/verifikasi', v_supplier);

  select * into s from public.supplier where id = v_supplier;
  return s;
end $$;

-- ---------------------------------------------------------------------
-- Mengirim ulang setelah diminta perbaikan
-- ---------------------------------------------------------------------
create or replace function public.resubmit_documents()
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare
  v_supplier uuid := public.auth_supplier_id();
  s public.supplier;
begin
  if v_supplier is null then
    raise exception 'Hanya pemasok yang dapat mengirim ulang dokumennya'
      using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.supplier where id = v_supplier for update;
  if s.status <> 'needs_document_fix' then
    raise exception 'Tidak ada permintaan perbaikan yang menunggu.'
      using errcode = 'restrict_violation';
  end if;

  update public.supplier_verification
     set status = 'pending', requested_at = null, requested_by = null
   where supplier_id = v_supplier;

  -- Catatan perbaikan ditandai selesai, tidak dihapus: putaran berikutnya
  -- perlu dapat dibandingkan dengan putaran sebelumnya.
  update public.supplier_verification_note n
     set resolved = true
    from public.supplier_verification v
   where v.id = n.verification_id and v.supplier_id = v_supplier and not n.resolved;

  update public.supplier set status = 'registration' where id = v_supplier
  returning * into s;

  insert into public.supplier_timeline (supplier_id, label, actor_id, actor_name)
  select v_supplier, 'Dokumen perbaikan dikirim ulang', auth.uid(), u.full_name
    from public.app_user u where u.id = auth.uid();

  perform public.notify_event(
    'supplier.resubmitted', 'internal', 'Dokumen perbaikan dikirim ulang',
    null, '/internal/verifikasi', v_supplier);

  return s;
end $$;

-- ---------------------------------------------------------------------
-- Sisi internal
-- ---------------------------------------------------------------------
-- Staf boleh mengubah status lewat tabel, jadi fungsi berikut bukan soal
-- kewenangan melainkan soal keutuhan: masing-masing menyentuh tiga sampai
-- empat tabel yang harus berubah bersama-sama.

create or replace function public.verify_documents(p_supplier_id uuid)
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare s public.supplier;
begin
  if not public.can_process() then
    raise exception 'Hanya staf procurement yang dapat memverifikasi dokumen'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.supplier_verification
    (supplier_id, status, verified_at, verified_by)
  values (p_supplier_id, 'verified', now(), auth.uid())
  on conflict (supplier_id) do update
     set status = 'verified', verified_at = now(), verified_by = auth.uid(),
         requested_at = null, requested_by = null;

  update public.supplier_verification_note n
     set resolved = true
    from public.supplier_verification v
   where v.id = n.verification_id and v.supplier_id = p_supplier_id;

  update public.supplier
     set status = 'qualification'
   where id = p_supplier_id and status in ('registration','needs_document_fix')
  returning * into s;

  insert into public.supplier_qualification (supplier_id, status)
  values (p_supplier_id, 'not_started')
  on conflict (supplier_id) do nothing;

  insert into public.supplier_timeline (supplier_id, label, actor_id, actor_name)
  select p_supplier_id, 'Dokumen terverifikasi', auth.uid(), u.full_name
    from public.app_user u where u.id = auth.uid();

  perform public.log_audit('supplier.verified', 'supplier', p_supplier_id);
  perform public.notify_event(
    'supplier.verified', 'supplier', 'Dokumen Anda telah diverifikasi',
    null, '/supplier/status', p_supplier_id);

  if s.id is null then
    select * into s from public.supplier where id = p_supplier_id;
  end if;
  return s;
end $$;

-- p_notes: [{ "sectionId": "tax", "note": "NPWP tidak terbaca" }]
create or replace function public.request_document_fix(
  p_supplier_id uuid,
  p_notes jsonb)
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare
  s public.supplier;
  v_verification uuid;
  v_round int;
  item jsonb;
begin
  if not public.can_process() then
    raise exception 'Hanya staf procurement yang dapat meminta perbaikan'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(jsonb_array_length(p_notes), 0) = 0 then
    raise exception 'Permintaan perbaikan harus menyebutkan setidaknya satu catatan.'
      using errcode = 'check_violation';
  end if;

  insert into public.supplier_verification
    (supplier_id, status, requested_at, requested_by)
  values (p_supplier_id, 'revision_requested', now(), auth.uid())
  on conflict (supplier_id) do update
     set status = 'revision_requested', requested_at = now(), requested_by = auth.uid()
  returning id into v_verification;

  select coalesce(max(round), 0) + 1 into v_round
    from public.supplier_verification_note where verification_id = v_verification;

  for item in select * from jsonb_array_elements(p_notes) loop
    insert into public.supplier_verification_note
      (verification_id, round, section_id, note, created_by)
    values (v_verification, v_round,
            nullif(item ->> 'sectionId','')::public.profile_section_id,
            item ->> 'note', auth.uid());
  end loop;

  update public.supplier set status = 'needs_document_fix'
   where id = p_supplier_id returning * into s;

  insert into public.supplier_timeline (supplier_id, label, actor_id, actor_name, detail)
  select p_supplier_id, 'Perbaikan dokumen diminta', auth.uid(), u.full_name, p_notes
    from public.app_user u where u.id = auth.uid();

  perform public.log_audit('supplier.fix_requested', 'supplier', p_supplier_id,
                           null, p_notes);
  perform public.notify_event(
    'supplier.fix_requested', 'supplier', 'Dokumen Anda perlu diperbaiki',
    null, '/supplier/profil', p_supplier_id, p_notes);

  return s;
end $$;

create or replace function public.submit_for_preferred(p_supplier_id uuid)
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare s public.supplier;
begin
  if not public.can_process() then
    raise exception 'Hanya staf procurement yang dapat mengajukan preferred'
      using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.supplier where id = p_supplier_id for update;
  if s.status <> 'qualification' then
    raise exception 'Pemasok belum berada pada tahap kualifikasi.'
      using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from public.supplier_qualification
                  where supplier_id = p_supplier_id and status = 'completed') then
    raise exception 'Kualifikasi belum diselesaikan.' using errcode = 'restrict_violation';
  end if;

  update public.supplier
     set status = 'awaiting_preferred',
         preferred_submitted_at = now(), preferred_submitted_by = auth.uid()
   where id = p_supplier_id returning * into s;

  insert into public.supplier_timeline (supplier_id, label, actor_id, actor_name)
  select p_supplier_id, 'Diajukan sebagai preferred supplier', auth.uid(), u.full_name
    from public.app_user u where u.id = auth.uid();

  perform public.log_audit('supplier.submitted_preferred', 'supplier', p_supplier_id);
  perform public.notify_event(
    'supplier.submitted_preferred', 'internal', 'Persetujuan preferred menunggu',
    s.vendor_name || ' menunggu keputusan manager.', '/internal/preferred', p_supplier_id);

  return s;
end $$;

-- Diskualifikasi dapat dibuka kembali. Keputusan lamanya tetap tercatat —
-- itulah sebabnya supplier_preferred_decision append-only.
create or replace function public.reopen_qualification(p_supplier_id uuid)
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare s public.supplier;
begin
  if not public.can_process() then
    raise exception 'Hanya staf procurement yang dapat membuka kembali kualifikasi'
      using errcode = 'insufficient_privilege';
  end if;

  update public.supplier_preferred_decision
     set superseded_at = now()
   where supplier_id = p_supplier_id and superseded_at is null;

  update public.supplier set status = 'qualification'
   where id = p_supplier_id and status = 'disqualified'
  returning * into s;

  if s.id is null then
    raise exception 'Pemasok tidak sedang berstatus disqualified.'
      using errcode = 'restrict_violation';
  end if;

  insert into public.supplier_timeline (supplier_id, label, actor_id, actor_name)
  select p_supplier_id, 'Kualifikasi dibuka kembali', auth.uid(), u.full_name
    from public.app_user u where u.id = auth.uid();

  perform public.log_audit('supplier.reopened', 'supplier', p_supplier_id);
  return s;
end $$;

-- Jalur B: registrasi internal.
create or replace function public.start_internal_registration(
  p_supplier_id uuid,
  p_document_source public.internal_doc_source)
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare s public.supplier;
begin
  if not public.can_process() then
    raise exception 'Hanya staf procurement yang dapat memulai registrasi internal'
      using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.supplier where id = p_supplier_id for update;
  if s.status <> 'approved' then
    raise exception 'Registrasi internal hanya dapat dimulai setelah pendaftaran disetujui (status kini: %).', s.status
      using errcode = 'restrict_violation';
  end if;

  update public.supplier
     set status = 'internal_draft', onboarding_path = 'internal',
         internal_doc_source = p_document_source
   where id = p_supplier_id returning * into s;

  insert into public.supplier_timeline (supplier_id, label, actor_id, actor_name, detail)
  select p_supplier_id, 'Registrasi internal dimulai', auth.uid(), u.full_name,
         jsonb_build_object('documentSource', p_document_source)
    from public.app_user u where u.id = auth.uid();

  perform public.log_audit('supplier.internal_started', 'supplier', p_supplier_id);
  return s;
end $$;

create or replace function public.finish_internal_registration(p_supplier_id uuid)
returns public.supplier
language plpgsql security definer set search_path = public, auth as $$
declare
  s public.supplier;
  v_missing text;
begin
  if not public.can_process() then
    raise exception 'Hanya staf procurement yang dapat menyelesaikan registrasi internal'
      using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.supplier where id = p_supplier_id for update;
  if s.status <> 'internal_draft' then
    raise exception 'Pemasok ini tidak sedang dalam registrasi internal.'
      using errcode = 'restrict_violation';
  end if;

  select string_agg(x.section::text, ', ' order by x.section) into v_missing
    from unnest(array['tax','documents','licenses','banking','contacts']
                ::public.profile_section_id[]) as x(section)
   where not exists (
     select 1 from public.supplier_profile_section ps
      where ps.supplier_id = p_supplier_id and ps.section_id = x.section and ps.completed);

  if v_missing is not null then
    raise exception 'Bagian berikut belum lengkap: %', v_missing
      using errcode = 'check_violation';
  end if;

  update public.supplier set status = 'connected' where id = p_supplier_id
  returning * into s;

  insert into public.supplier_verification (supplier_id, status)
  values (p_supplier_id, 'pending')
  on conflict (supplier_id) do nothing;

  insert into public.supplier_timeline (supplier_id, label, actor_id, actor_name)
  select p_supplier_id, 'Registrasi internal selesai', auth.uid(), u.full_name
    from public.app_user u where u.id = auth.uid();

  perform public.log_audit('supplier.internal_finished', 'supplier', p_supplier_id);
  return s;
end $$;

-- ---------------------------------------------------------------------
-- Kualifikasi (diisi staf, bukan pemasok)
-- ---------------------------------------------------------------------
-- p_lines: [{ "commodityCode":"12141900", "countryCode":"ID", "notes":"" }]
create or replace function public.save_qualification(
  p_supplier_id uuid,
  p_lines jsonb,
  p_status public.qualification_status default 'draft')
returns public.supplier_qualification
language plpgsql security definer set search_path = public, auth as $$
declare
  q public.supplier_qualification;
  v_name text;
  item jsonb;
  i int := 0;
begin
  if not public.can_process() then
    raise exception 'Hanya staf procurement yang dapat mengisi kualifikasi'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'completed' and coalesce(jsonb_array_length(p_lines),0) = 0 then
    raise exception 'Kualifikasi tidak dapat diselesaikan tanpa satu pun baris komoditas.'
      using errcode = 'check_violation';
  end if;

  select full_name into v_name from public.app_user where id = auth.uid();

  insert into public.supplier_qualification
    (supplier_id, status, filled_by, filled_by_name, completed_at)
  values (p_supplier_id, p_status, auth.uid(), v_name,
          case when p_status = 'completed' then now() end)
  on conflict (supplier_id) do update
     set status = excluded.status, filled_by = excluded.filled_by,
         filled_by_name = excluded.filled_by_name,
         completed_at = case when excluded.status = 'completed'
                             then coalesce(public.supplier_qualification.completed_at, now())
                             else null end
  returning * into q;

  -- Baris ditulis ulang seluruhnya: daftar komoditas adalah satu kesatuan,
  -- dan menggabungkan per baris hanya menyisakan baris hantu dari sunting
  -- sebelumnya.
  delete from public.supplier_qualification_line where supplier_id = p_supplier_id;

  for item in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    i := i + 1;
    insert into public.supplier_qualification_line
      (supplier_id, commodity_code, country_code, notes, line_order)
    values (p_supplier_id, item ->> 'commodityCode', item ->> 'countryCode',
            nullif(item ->> 'notes',''), i);
  end loop;

  perform public.log_audit('supplier.qualification_saved', 'supplier', p_supplier_id,
                           null, jsonb_build_object('status', p_status, 'lines', i));
  return q;
end $$;

-- ---------------------------------------------------------------------
-- Hibah
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('mark_profile_section','accept_consent','resubmit_documents',
                         'verify_documents','request_document_fix','submit_for_preferred',
                         'reopen_qualification','start_internal_registration',
                         'finish_internal_registration','save_qualification')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
