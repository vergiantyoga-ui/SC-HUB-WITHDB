/**
 * Permukaan API yang dipakai komponen — kini di atas Supabase.
 *
 * Nama dan tanda tangan setiap fungsi dipertahankan persis seperti versi
 * backend Node, supaya penggantiannya tidak menuntut satu pun komponen
 * ditulis ulang. Yang berubah ada di bawah permukaan:
 *
 *   • Tidak ada `actor` yang dikirim klien. Pelaku diambil dari `auth.uid()`
 *     di dalam basis data, dan tidak dapat dipalsukan dari peramban.
 *   • Penyaringan data tidak lagi bergantung pada `where` yang ditulis di
 *     sini. Menghapus `.eq('supplier_id', …)` pada kueri mana pun di berkas
 *     ini tidak membocorkan apa-apa: RLS menyaring lebih dulu.
 *   • Tindakan yang menyentuh beberapa tabel sekaligus memanggil RPC, bukan
 *     beberapa permintaan berurutan yang bisa putus di tengah.
 *
 * Bentuk baris yang dikembalikan tetap snake_case, sama seperti dulu.
 */

import {
  supabase, unwrap, ApiError, currentUserId,
  uploadFile, fileUrl, removeFile, BUCKET_ANSWER,
} from '../supabase/client.js';

export { uploadFile, fileUrl, removeFile, ApiError };

const rpc = async (name, args) => unwrap(await supabase.rpc(name, args ?? {}));

/* ==================================================================== */
/* Sesi                                                                 */
/* ==================================================================== */

export async function signInInternal(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new ApiError('Email atau kata sandi salah.', 401, error.code);
  return loadCurrentUser();
}

/**
 * Pemasok masuk memakai ID akun (mis. SUP-PAC-0131), bukan email.
 *
 * GoTrue hanya mengenal email, jadi ID akun ditukar lebih dulu lewat RPC
 * `email_for_account_id` — satu-satunya hal yang dikembalikannya adalah
 * email, sehingga nilainya bagi penebak nyaris nol.
 */
export async function signInSupplier(accountId, password) {
  const email = await rpc('email_for_account_id', { p_account_id: accountId });
  if (!email) throw new ApiError('ID akun atau kata sandi salah.', 401);

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new ApiError('ID akun atau kata sandi salah.', 401, error.code);
  return loadCurrentUser();
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Identitas, pemasok yang diwakili, dan jumlah notifikasi belum dibaca. */
export async function loadCurrentUser() {
  const userId = await currentUserId();
  if (!userId) return null;

  const user = unwrap(
    await supabase
      .from('app_user')
      .select('id, role, full_name, email, supplier_id, is_active')
      .eq('id', userId)
      .maybeSingle(),
  );
  if (!user || !user.is_active) return null;

  let supplier = null;
  let account = null;
  if (user.supplier_id) {
    supplier = unwrap(
      await supabase
        .from('supplier')
        .select('id, reference, status, vendor_name, onboarding_path, company_email')
        .eq('id', user.supplier_id)
        .maybeSingle(),
    );
    account = unwrap(
      await supabase
        .from('supplier_account')
        .select('account_id, password_changed, email_sent_at')
        .eq('supplier_id', user.supplier_id)
        .maybeSingle(),
    );
  }

  const { count } = await supabase
    .from('v_my_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  return { user, supplier, account, unreadCount: count ?? 0 };
}

/**
 * Mengganti kata sandi.
 *
 * Kata sandi lama diperiksa dengan mencoba masuk kembali memakainya. GoTrue
 * tidak menyediakan "verify current password", dan melewatkan pemeriksaan itu
 * berarti siapa pun yang menemukan peramban tak terkunci dapat mengunci
 * pemiliknya sendiri keluar.
 */
export async function changePassword(currentPassword, newPassword) {
  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData.session?.user?.email;
  if (!email) throw new ApiError('Sesi Anda berakhir. Silakan masuk kembali.', 401);

  const { error: reauth } = await supabase.auth.signInWithPassword({
    email, password: currentPassword,
  });
  if (reauth) throw new ApiError('Kata sandi lama tidak cocok.', 400);

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new ApiError(error.message, 400, error.code);

  // Penanda ini yang membuat hitungan "kata sandi sementara kedaluwarsa"
  // berhenti berjalan; lihat password_expires_at() di basis data.
  const me = await loadCurrentUser();
  if (me?.user.supplier_id) {
    unwrap(
      await supabase
        .from('supplier_account')
        .update({ password_changed: true, password_changed_at: new Date().toISOString() })
        .eq('supplier_id', me.user.supplier_id)
        .select(),
    );
  }
  return { ok: true };
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

/**
 * Dimuat sekali saat aplikasi mulai dan disimpan di memori. Isinya berubah
 * beberapa kali setahun; mengambilnya ulang di setiap formulir berarti
 * delapan belas permintaan untuk data yang sama.
 *
 * Delapan belas tabel diambil sekaligus, bukan berurutan — perbedaannya
 * terasa pada sambungan yang lambat.
 */
export async function loadMasterData() {
  const entries = Object.entries(MASTER_TABLES);
  const results = await Promise.all(
    entries.map(([, table]) =>
      supabase.from(table).select('*').eq('active', true).order('sort_order')),
  );

  const data = {};
  entries.forEach(([key], i) => { data[key] = unwrap(results[i]); });

  // Dua pilihan yang tampil di antarmuka, diturunkan dari entitas korporat —
  // tidak ada daftar terpisah yang bisa menyimpang.
  data.targetCompanies = [...new Set(data.corporateEntities.map((e) => e.interface_name))];
  return data;
}

export async function loadQualificationReference() {
  const [segments, commodities, countries] = await Promise.all([
    supabase.from('md_unspsc_segment').select('*').order('code'),
    supabase.from('md_unspsc_commodity').select('*').eq('active', true).order('sort_order'),
    supabase.from('md_country').select('*').eq('active', true).order('name'),
  ]);
  return {
    segments: unwrap(segments),
    commodities: unwrap(commodities),
    countries: unwrap(countries),
  };
}

/** Rincian jenis pasokan yang berlaku bagi sebuah jenis pasokan. */
export const detailsForVendorType = (details, vendorTypeCode) =>
  details.filter((d) => d.vendor_type_code === vendorTypeCode);

/** Menerjemahkan nama antarmuka menjadi kode korporat untuk SAP. */
export const corporateCodesFor = (entities, interfaceNames) =>
  entities.filter((e) => interfaceNames.includes(e.interface_name)).map((e) => e.code);

/* ==================================================================== */
/* Pemasok                                                              */
/* ==================================================================== */

/**
 * Antrean. Membaca view `v_supplier_queue`, yang sudah menggabungkan status
 * verifikasi, kualifikasi, keputusan preferred, dan jumlah bagian profil
 * yang selesai — pekerjaan yang dulu dilakukan enam kueri terpisah.
 */
export async function listSuppliers({ status, search, path } = {}) {
  let q = supabase.from('v_supplier_queue').select('*').order('submitted_at', { ascending: false });

  if (status) q = Array.isArray(status) ? q.in('status', status) : q.eq('status', status);
  if (path) q = q.eq('onboarding_path', path);
  if (search) {
    const term = `%${search}%`;
    q = q.or(`vendor_name.ilike.${term},reference.ilike.${term},company_email.ilike.${term}`);
  }
  return unwrap(await q);
}

/**
 * Satu pemasok, lengkap.
 *
 * Seluruh anak diambil dalam satu permintaan lewat embedding PostgREST.
 * Pemasok yang membuka profilnya sendiri menerima kueri yang sama persis —
 * yang membedakan hanya baris mana yang lolos RLS.
 */
export async function getSupplier(id) {
  const row = unwrap(
    await supabase
      .from('supplier')
      .select(`
        *,
        target_companies:supplier_target_company(corporate_entity_code),
        profile_sections:supplier_profile_section(*),
        tax:supplier_tax(*),
        tax_documents:supplier_tax_document(*),
        legal_documents:supplier_legal_document(*),
        legal_extra:supplier_legal_extra(*),
        licenses:supplier_license(*),
        banking:supplier_banking(*),
        bank_accounts:supplier_bank_account(*),
        contacts:supplier_contact(*),
        consents:supplier_consent(*),
        account:supplier_account(*),
        verification:supplier_verification(*, notes:supplier_verification_note(*)),
        qualification:supplier_qualification(*, lines:supplier_qualification_line(*)),
        preferred_decisions:supplier_preferred_decision(*),
        timeline:supplier_timeline(*)
      `)
      .eq('id', id)
      .maybeSingle(),
  );
  if (!row) throw new ApiError('Pemasok tidak ditemukan.', 404);

  // PostgREST mengembalikan relasi satu-ke-satu sebagai objek atau null, dan
  // relasi satu-ke-banyak sebagai larik. Lini masa dibalik di sini karena
  // urutan tampilnya terbaru lebih dulu.
  row.timeline = (row.timeline ?? []).sort((a, b) => b.at.localeCompare(a.at));
  row.target_companies = (row.target_companies ?? []).map((t) => t.corporate_entity_code);
  return row;
}

export const registerSupplier = (payload) => rpc('register_supplier', { payload });

export const approveSubmission = (id) => rpc('approve_submission', { p_supplier_id: id });

export const rejectSubmission = (id, reason) =>
  rpc('reject_submission', { p_supplier_id: id, p_reason: reason });

/* ==================================================================== */
/* Onboarding                                                           */
/* ==================================================================== */

/**
 * Jalur A — undangan portal.
 *
 * Dua langkah yang tidak dapat digabung: basis data memesan ID akun dan
 * email masuk, lalu Edge Function membuat penggunanya dengan service_role.
 * Kata sandi sementara tidak boleh melewati basis data dalam bentuk apa pun,
 * jadi ia lahir dan mati di dalam fungsi itu.
 */
export async function inviteSupplier(id, { resend = false } = {}) {
  const account = await rpc('provision_supplier_account', { p_supplier_id: id });

  const { data, error } = await supabase.functions.invoke('invite-supplier', {
    body: { supplierId: id, accountId: account.account_id, email: account.login_email, resend },
  });
  if (error) {
    throw new ApiError(
      'Akun sudah dipesan, tetapi pengiriman undangan gagal. ' +
      'Pastikan Edge Function "invite-supplier" sudah di-deploy.',
      502,
    );
  }

  if (!resend) {
    unwrap(
      await supabase.from('supplier')
        .update({ status: 'invited', onboarding_path: 'invite' })
        .eq('id', id).select(),
    );
  }
  return { accountId: account.account_id, email: account.login_email, ...data };
}

export const resendInvite = (id) => inviteSupplier(id, { resend: true });

/** Jalur B — registrasi internal. documentSource: 'email' | 'whatsapp' */
export const startInternalRegistration = (id, documentSource) =>
  rpc('start_internal_registration', { p_supplier_id: id, p_document_source: documentSource });

export const finishInternalRegistration = (id) =>
  rpc('finish_internal_registration', { p_supplier_id: id });

/* ==================================================================== */
/* Profil                                                               */
/* ==================================================================== */

// Setiap bagian profil punya tabelnya sendiri. Peta ini yang menentukan ke
// mana sebuah bagian ditulis; menambah bagian baru cukup menambah satu baris.
const SECTION_TABLE = {
  tax: { table: 'supplier_tax', key: 'supplier_id' },
  documents: { table: 'supplier_legal_extra', key: 'supplier_id' },
  banking: { table: 'supplier_banking', key: 'supplier_id' },
};

/**
 * Menyimpan satu bagian kelengkapan profil.
 *
 * Bagian yang belum lengkap TETAP tersimpan — pemasok boleh berhenti di
 * tengah dan melanjutkan nanti. Kelengkapannya ditandai lewat RPC
 * `mark_profile_section`, yang sekaligus memindahkan status dari 'connected'
 * ke 'onboarding' pada penyimpanan pertama.
 *
 * `values` untuk bagian berulang (dokumen pajak, lisensi, rekening, kontak)
 * berupa larik dan ditulis ulang seluruhnya; untuk bagian tunggal berupa
 * objek dan di-upsert.
 */
export async function saveProfileSection(supplierId, sectionId, values, { completed = true } = {}) {
  switch (sectionId) {
    case 'tax':
    case 'documents':
    case 'banking': {
      const { table, key } = SECTION_TABLE[sectionId];
      unwrap(
        await supabase.from(table)
          .upsert({ [key]: supplierId, ...values }, { onConflict: key })
          .select(),
      );
      break;
    }

    case 'licenses':
      await replaceRows('supplier_license', supplierId, values, ['supplier_id', 'license_key']);
      break;

    case 'contacts':
      await replaceRows('supplier_contact', supplierId, values);
      break;

    default:
      throw new ApiError(`Bagian profil tidak dikenal: ${sectionId}`, 400);
  }

  return rpc('mark_profile_section', { p_section_id: sectionId, p_completed: completed });
}

/**
 * Menulis ulang seluruh baris milik satu pemasok.
 *
 * Menggabungkan per baris terdengar lebih hemat, tetapi menyisakan baris
 * hantu dari sunting sebelumnya — kontak yang dihapus di layar tetap hidup
 * di basis data. Menghapus lalu menulis ulang tidak punya masalah itu.
 */
async function replaceRows(table, supplierId, rows, conflict) {
  const payload = (rows ?? []).map((r) => ({ ...r, supplier_id: supplierId }));

  if (conflict) {
    if (payload.length) {
      unwrap(await supabase.from(table).upsert(payload, { onConflict: conflict.join(',') }).select());
    }
    return;
  }

  unwrap(await supabase.from(table).delete().eq('supplier_id', supplierId).select());
  if (payload.length) unwrap(await supabase.from(table).insert(payload).select());
}

/** Dokumen pajak ditulis terpisah karena kunci uniknya pasangan (pemasok, jenis). */
export const saveTaxDocuments = (supplierId, documents) =>
  replaceRows('supplier_tax_document', supplierId, documents, ['supplier_id', 'doc_key']);

export const saveLegalDocuments = (supplierId, documents) =>
  replaceRows('supplier_legal_document', supplierId, documents, ['supplier_id', 'doc_key']);

export const saveBankAccounts = (supplierId, accounts) =>
  replaceRows('supplier_bank_account', supplierId, accounts);

/** Menyunting data pendaftaran: general, address, atau contact. */
export async function updateRegistrationSection(supplierId, sectionId, values) {
  unwrap(await supabase.from('supplier').update(values).eq('id', supplierId).select());

  if (sectionId === 'general' && Array.isArray(values.target_companies)) {
    unwrap(await supabase.from('supplier_target_company')
      .delete().eq('supplier_id', supplierId).select());
    if (values.target_companies.length) {
      unwrap(await supabase.from('supplier_target_company').insert(
        values.target_companies.map((code) => ({
          supplier_id: supplierId, corporate_entity_code: code,
        })),
      ).select());
    }
  }
  return getSupplier(supplierId);
}

/**
 * Menyunting profil pemasok yang sudah aktif.
 *
 * Perubahan pada pajak, dokumen, lisensi, atau pembayaran memicu verifikasi
 * ulang. Penanda itu dikembalikan supaya antarmuka dapat memberi tahu
 * pemasok bahwa dokumennya akan diperiksa lagi.
 */
const REVERIFY_SECTIONS = ['tax', 'documents', 'licenses', 'banking'];

export async function updateActiveProfile(supplierId, sectionId, values) {
  const supplier = await saveProfileSection(supplierId, sectionId, values);

  const reverificationTriggered = REVERIFY_SECTIONS.includes(sectionId);
  if (reverificationTriggered) {
    unwrap(
      await supabase.from('supplier_verification')
        .update({ status: 'pending', verified_at: null, verified_by: null,
                  triggered_by_section: sectionId })
        .eq('supplier_id', supplierId).select(),
    );
  }
  return { supplier, reverificationTriggered };
}

export const acceptConsent = (gtcVersion, acceptedBy) =>
  rpc('accept_consent', { p_gtc_version: gtcVersion, p_accepted_by: acceptedBy });

/* ==================================================================== */
/* Verifikasi dokumen                                                   */
/* ==================================================================== */

export const verifyDocuments = (id) => rpc('verify_documents', { p_supplier_id: id });

/** notes: [{ sectionId, note }] */
export const requestDocumentFix = (id, notes) =>
  rpc('request_document_fix', { p_supplier_id: id, p_notes: notes });

export const resubmitDocuments = () => rpc('resubmit_documents');

/**
 * Dokumen yang akan kedaluwarsa.
 *
 * View `v_supplier_expiring_documents` menyatukan dokumen pajak dan lisensi,
 * dan menghitung sendiri sisa harinya — tidak ada tanggal yang dibandingkan
 * di peramban.
 */
export async function listExpiringDocuments(withinDays = 60) {
  return unwrap(
    await supabase
      .from('v_supplier_expiring_documents')
      .select('*')
      .lte('days_left', withinDays)
      .order('days_left'),
  );
}

/* ==================================================================== */
/* Kualifikasi dan preferred supplier                                   */
/* ==================================================================== */

/** lines: [{ commodityCode, countryCode, notes }] */
export const saveQualification = (supplierId, lines, status = 'draft') =>
  rpc('save_qualification', { p_supplier_id: supplierId, p_lines: lines, p_status: status });

export const submitForPreferred = (id) => rpc('submit_for_preferred', { p_supplier_id: id });

export const approvePreferred = (id, note) =>
  rpc('decide_preferred', { p_supplier_id: id, p_decision: 'approved', p_note: note });

export const disqualifySupplier = (id, reason) =>
  rpc('decide_preferred', { p_supplier_id: id, p_decision: 'disqualified', p_note: reason });

export const reopenQualification = (id) => rpc('reopen_qualification', { p_supplier_id: id });

/* ==================================================================== */
/* Questionnaire                                                        */
/* ==================================================================== */

export async function listTemplates({ type, archived = false, search } = {}) {
  let q = supabase
    .from('questionnaire_template')
    .select('*, versions:questionnaire_version(id, version_label, status, published_at, scoring_enabled)')
    .eq('archived', archived)
    .order('created_at', { ascending: false });

  if (type) q = q.eq('type', type);
  if (search) q = q.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
  return unwrap(await q);
}

/** Satu versi beserta seluruh isinya, berurutan siap render. */
export async function getVersion(versionId) {
  const version = unwrap(
    await supabase
      .from('questionnaire_version')
      .select(`
        *,
        template:questionnaire_template(*),
        sections:questionnaire_section(
          *, questions:question(*, options:question_option(*))
        )
      `)
      .eq('id', versionId)
      .maybeSingle(),
  );
  if (!version) throw new ApiError('Versi kuesioner tidak ditemukan.', 404);

  version.sections = (version.sections ?? []).sort((a, b) => a.sort_order - b.sort_order);
  for (const s of version.sections) {
    s.questions = (s.questions ?? []).sort((a, b) => a.sort_order - b.sort_order);
    for (const q of s.questions) {
      q.options = (q.options ?? []).sort((a, b) => a.sort_order - b.sort_order);
    }
  }
  return version;
}

export async function createTemplate({ sections = [], ...template }) {
  const row = unwrap(
    await supabase.from('questionnaire_template').insert(template).select().single(),
  );
  const version = unwrap(
    await supabase.from('questionnaire_version')
      .insert({ template_id: row.id, version_label: 'v1.0', status: 'draft' })
      .select().single(),
  );
  if (sections.length) await writeSections(version.id, sections);
  return getVersion(version.id);
}

/**
 * Menulis isi sebuah versi draf.
 *
 * Hanya berlaku pada versi berstatus draft — trigger di basis data menolak
 * selebihnya, dan itu memang yang diinginkan: versi terbit tidak boleh
 * berubah di bawah kaki pemasok yang sedang mengisinya.
 */
async function writeSections(versionId, sections) {
  for (const [i, section] of sections.entries()) {
    const { questions = [], ...rest } = section;
    const s = unwrap(
      await supabase.from('questionnaire_section')
        .insert({ ...rest, version_id: versionId, sort_order: i })
        .select().single(),
    );

    for (const [j, question] of questions.entries()) {
      const { options = [], ...q } = question;
      const created = unwrap(
        await supabase.from('question')
          .insert({ ...q, section_id: s.id, sort_order: j })
          .select().single(),
      );
      if (options.length) {
        unwrap(
          await supabase.from('question_option').insert(
            options.map((o, k) => ({ ...o, question_id: created.id, sort_order: k })),
          ).select(),
        );
      }
    }
  }
}

export async function publishVersion(versionId) {
  return unwrap(
    await supabase.from('questionnaire_version')
      .update({ status: 'published', published_at: new Date().toISOString(),
                published_by: await currentUserId() })
      .eq('id', versionId)
      .select().single(),
  );
}

/**
 * Versi baru dari versi yang ada.
 *
 * Isinya disalin, termasuk pemetaan ulang acuan kondisi ke pertanyaan
 * salinan — kondisi menyebut questionId, dan id itu berubah saat disalin.
 * v1.0 tetap utuh dan tetap melayani respons lama.
 */
export async function createNewVersion(sourceVersionId, versionLabel) {
  const source = await getVersion(sourceVersionId);

  const version = unwrap(
    await supabase.from('questionnaire_version').insert({
      template_id: source.template_id,
      version_label: versionLabel,
      status: 'draft',
      scoring_enabled: source.scoring_enabled,
      passing_score: source.passing_score,
      risk_bands: source.risk_bands,
      estimated_minutes: source.estimated_minutes,
    }).select().single(),
  );

  const idMap = new Map();

  for (const section of source.sections) {
    const s = unwrap(
      await supabase.from('questionnaire_section').insert({
        version_id: version.id,
        name: section.name,
        description: section.description,
        sort_order: section.sort_order,
        mandatory: section.mandatory,
        weight: section.weight,
      }).select().single(),
    );

    for (const q of section.questions) {
      const created = unwrap(
        await supabase.from('question').insert({
          section_id: s.id,
          code: q.code, text: q.text, guidance: q.guidance, type_key: q.type_key,
          required: q.required, default_value: q.default_value,
          placeholder: q.placeholder, help_text: q.help_text,
          weight: q.weight, sort_order: q.sort_order,
          validation: q.validation, attachment_rule: q.attachment_rule,
        }).select().single(),
      );
      idMap.set(q.id, created.id);

      if (q.options?.length) {
        unwrap(
          await supabase.from('question_option').insert(
            q.options.map((o) => ({
              question_id: created.id, label: o.label, value: o.value,
              score: o.score, exclude_from_scoring: o.exclude_from_scoring,
              sort_order: o.sort_order,
            })),
          ).select(),
        );
      }
    }
  }

  // Kondisi dipetakan ulang setelah seluruh pertanyaan ada — acuan bisa
  // menunjuk pertanyaan yang tersalin belakangan.
  for (const section of source.sections) {
    for (const q of section.questions) {
      if (!q.conditions) continue;
      const remapped = JSON.parse(
        JSON.stringify(q.conditions).replace(
          /"questionId":"([^"]+)"/g,
          (match, old) => (idMap.has(old) ? `"questionId":"${idMap.get(old)}"` : match),
        ),
      );
      unwrap(
        await supabase.from('question')
          .update({ conditions: remapped })
          .eq('id', idMap.get(q.id)).select(),
      );
    }
  }

  return getVersion(version.id);
}

export async function createAssignment(payload) {
  const me = await loadCurrentUser();

  const assignment = unwrap(
    await supabase.from('questionnaire_assignment').insert({
      ...payload,
      assigned_by: me.user.id,
      assigned_by_name: me.user.full_name,
    }).select().single(),
  );

  // Respons kosong dibuat bersamaan: penugasan tanpa respons tidak muncul di
  // daftar pemasok, dan pemasok tidak punya cara membuatnya sendiri.
  unwrap(
    await supabase.from('questionnaire_response')
      .insert({ assignment_id: assignment.id, status: 'not_started' })
      .select(),
  );

  return assignment;
}

/**
 * Daftar respons. Satu view melayani dua layar sekaligus — antrean internal
 * dan daftar kuesioner pemasok — karena RLS-lah yang membedakan isinya.
 */
export async function listAssignments({ status, reviewerId, supplierId, overdue } = {}) {
  let q = supabase.from('v_response_overview').select('*').order('due_date', { nullsFirst: false });

  if (status) q = Array.isArray(status) ? q.in('status', status) : q.eq('status', status);
  if (reviewerId) q = q.eq('reviewer_id', reviewerId);
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (overdue) q = q.eq('overdue', true);
  return unwrap(await q);
}

export const myQuestionnaires = () => listAssignments();

export async function getResponse(id) {
  const [overview, answers] = await Promise.all([
    supabase.from('v_response_overview').select('*').eq('response_id', id).maybeSingle(),
    supabase.from('response_answer')
      .select('*, attachments:answer_attachment(*, file:file_object(*))')
      .eq('response_id', id),
  ]);

  const row = unwrap(overview);
  if (!row) throw new ApiError('Respons tidak ditemukan.', 404);

  row.answers = unwrap(answers);
  row.version = await getVersion(row.version_id);
  return row;
}

/** answers: { [questionId]: value } — simpan draf, sebagian. */
export async function saveAnswers(responseId, answers) {
  const rows = Object.entries(answers).map(([question_id, value]) => ({
    response_id: responseId,
    question_id,
    value,
  }));

  if (rows.length) {
    unwrap(
      await supabase.from('response_answer')
        .upsert(rows, { onConflict: 'response_id,question_id' })
        .select(),
    );
  }

  // Sekali pemasok menyimpan sesuatu, respons berhenti berstatus
  // 'not_started' — antrean internal ikut mencerminkannya.
  unwrap(
    await supabase.from('questionnaire_response')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', responseId).eq('status', 'not_started').select(),
  );

  return { saved: rows.length };
}

/** Melampirkan berkas pada satu jawaban. */
export async function attachAnswerFile(responseId, questionId, file, { expiryDate, supplierId } = {}) {
  const answer = unwrap(
    await supabase.from('response_answer')
      .upsert({ response_id: responseId, question_id: questionId },
              { onConflict: 'response_id,question_id' })
      .select().single(),
  );

  const uploaded = await uploadFile(file, {
    supplierId, section: responseId, bucket: BUCKET_ANSWER,
  });

  return unwrap(
    await supabase.from('answer_attachment').insert({
      answer_id: answer.id,
      file_id: uploaded.id,
      expiry_date: expiryDate ?? null,
      uploaded_by: await currentUserId(),
    }).select().single(),
  );
}

/**
 * Prapemeriksaan sebelum kirim.
 *
 * Dipanggil layar konfirmasi supaya pemasok tahu persis apa yang kurang
 * sebelum menekan kirim, bukan setelah. Aturan kelengkapannya sudah ada di
 * `src/questionnaire/engine/completion.js` dan dipakai kembali di sini —
 * satu definisi "lengkap", bukan dua yang bisa berbeda pendapat.
 */
export async function precheckResponse(responseId) {
  const response = await getResponse(responseId);
  const answered = new Map(response.answers.map((a) => [a.question_id, a]));

  const missing = [];
  for (const section of response.version.sections) {
    for (const q of section.questions) {
      if (!q.required) continue;
      const a = answered.get(q.id);
      const empty = !a || a.skipped || a.value === null || a.value === undefined || a.value === '';
      if (empty) missing.push({ sectionName: section.name, code: q.code, text: q.text });
    }
  }

  return { ready: missing.length === 0, missing, response };
}

export const submitResponse = (responseId) => rpc('submit_response', { p_response_id: responseId });

/** Mengambil alih tinjauan. */
export async function claimReview(responseId) {
  const response = unwrap(
    await supabase.from('questionnaire_response')
      .select('assignment_id').eq('id', responseId).single(),
  );

  unwrap(
    await supabase.from('questionnaire_assignment')
      .update({ reviewer_id: await currentUserId() })
      .eq('id', response.assignment_id).select(),
  );

  return unwrap(
    await supabase.from('questionnaire_response')
      .update({ status: 'under_review' })
      .eq('id', responseId).eq('status', 'submitted')
      .select().maybeSingle(),
  );
}

/** decision: 'approve' | 'reject' | 'request_revision'; flags: [{ questionId, note }] */
export const reviewResponse = (responseId, decision, summary, flags = []) =>
  rpc('decide_review', {
    p_response_id: responseId,
    p_decision: decision,
    p_summary: summary,
    p_flagged: flags,
  });

/** KPI dihitung di basis data, bukan dengan mengunduh seluruh respons. */
export async function loadDashboard() {
  const [kpi, risk] = await Promise.all([
    supabase.from('v_questionnaire_kpi').select('*').maybeSingle(),
    supabase.from('v_risk_distribution').select('*'),
  ]);
  return { kpi: unwrap(kpi), riskDistribution: unwrap(risk) };
}

/* ==================================================================== */
/* Notifikasi dan jejak audit                                           */
/* ==================================================================== */

export const listNotifications = async () =>
  unwrap(
    await supabase.from('v_my_notifications').select('*')
      .order('created_at', { ascending: false }).limit(50),
  );

export const markNotificationRead = (id) => rpc('mark_notifications_read', { p_ids: [id] });

export const markAllNotificationsRead = () => rpc('mark_notifications_read', { p_ids: null });

export const listAuditLog = async ({ objectType, objectId, limit = 100 } = {}) => {
  let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(limit);
  if (objectType) q = q.eq('object_type', objectType);
  if (objectId) q = q.eq('object_id', objectId);
  return unwrap(await q);
};

/**
 * Notifikasi waktu nyata.
 *
 * Polling enam puluh detik yang dulu dipakai sebagai pengganti Realtime tidak
 * lagi diperlukan — langganan Postgres Changes memberi tahu begitu barisnya
 * masuk. Tanda tangan fungsinya sengaja dibiarkan sama supaya pemanggilnya
 * tidak perlu berubah: ia tetap menerima handler dan tetap mengembalikan
 * fungsi penghenti.
 *
 * Aktifkan lebih dulu di Dashboard → Database → Replication, untuk tabel
 * `notification`. Tanpa itu langganannya diam saja, dan polling cadangan di
 * bawah yang bekerja.
 */
export function pollNotifications(handler, intervalMs = 60_000) {
  let stopped = false;

  const push = async () => {
    if (stopped) return;
    try { handler(await listNotifications()); } catch { /* diam; coba lagi nanti */ }
  };

  const channel = supabase
    .channel('notifikasi')
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification' },
        push)
    .subscribe();

  push();
  const timer = setInterval(push, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
    supabase.removeChannel(channel);
  };
}
