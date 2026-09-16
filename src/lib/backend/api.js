import { get, post, put, setToken, uploadFile } from './client.js';

/**
 * Permukaan API yang dipakai komponen.
 *
 * Nama fungsinya sengaja dijaga sama dengan aksi pada AppStore.jsx, supaya
 * penyambungan bertahap tidak menuntut komponen ditulis ulang. Satu perbedaan
 * yang berlaku di mana-mana: parameter `actor` hilang. Di prototipe, pelaku
 * sebuah tindakan adalah yang dikirim klien; sekarang ia diambil dari sesi di
 * server, dan tidak dapat dipalsukan dari peramban.
 */

/* ==================================================================== */
/* Sesi                                                                 */
/* ==================================================================== */

export async function signInInternal(email, password) {
  const { token, user } = await post('/api/auth/login', { email, password });
  setToken(token);
  return user;
}

/** Pemasok masuk memakai ID akun (mis. SUP-PAC-0131), bukan email. */
export async function signInSupplier(accountId, password) {
  const { token, user } = await post('/api/auth/login', { accountId, password });
  setToken(token);
  return user;
}

export async function signOut() {
  try { await post('/api/auth/logout'); } finally { setToken(null); }
}

/** Identitas, pemasok yang diwakili, dan jumlah notifikasi belum dibaca. */
export const loadCurrentUser = () => get('/api/auth/me').catch(() => null);

export const changePassword = (currentPassword, newPassword) =>
  post('/api/auth/password', { currentPassword, newPassword });

/* ==================================================================== */
/* Master data                                                          */
/* ==================================================================== */

/**
 * Dimuat sekali saat aplikasi mulai dan disimpan di memori. Isinya berubah
 * beberapa kali setahun; mengambilnya ulang di setiap formulir berarti
 * delapan belas permintaan untuk data yang sama.
 */
export const loadMasterData = () => get('/api/master-data');
export const loadQualificationReference = () => get('/api/master-data/qualification');

/** Rincian jenis pasokan yang berlaku bagi sebuah jenis pasokan. */
export const detailsForVendorType = (details, vendorTypeCode) =>
  details.filter((d) => d.vendor_type_code === vendorTypeCode);

/** Menerjemahkan nama antarmuka menjadi kode korporat untuk SAP. */
export const corporateCodesFor = (entities, interfaceNames) =>
  entities.filter((e) => interfaceNames.includes(e.interface_name)).map((e) => e.code);

/* ==================================================================== */
/* Pemasok                                                              */
/* ==================================================================== */

export const listSuppliers = (filters) => get('/api/suppliers', filters);
export const getSupplier = (id) => get(`/api/suppliers/${id}`);

export const registerSupplier = (payload) => post('/api/suppliers/register', payload);
export const approveSubmission = (id) => post(`/api/suppliers/${id}/approve`);
export const rejectSubmission = (id, reason) => post(`/api/suppliers/${id}/reject`, { reason });

/** Jalur A — undangan portal. */
export const inviteSupplier = (id) => post(`/api/suppliers/${id}/invite`, {});
export const resendInvite = (id) => post(`/api/suppliers/${id}/invite`, { resend: true });

/** Jalur B — registrasi internal. documentSource: 'email' | 'whatsapp' */
export const startInternalRegistration = (id, documentSource) =>
  post(`/api/suppliers/${id}/internal-registration`, { documentSource });

export const finishInternalRegistration = (id) => post(`/api/suppliers/${id}/finish-internal`);

/* ==================================================================== */
/* Profil                                                               */
/* ==================================================================== */

/**
 * Menyimpan satu bagian kelengkapan profil.
 *
 * Mengembalikan `{ completed, errors }`. Bagian yang belum lengkap TETAP
 * tersimpan — pemasok boleh berhenti di tengah dan melanjutkan nanti — dan
 * `errors` menyebutkan persis apa yang masih kurang.
 */
export const saveProfileSection = (supplierId, sectionId, values) =>
  put(`/api/suppliers/${supplierId}/profile/${sectionId}`, values);

/** Menyunting data pendaftaran: general, address, atau contact. */
export const updateRegistrationSection = (supplierId, sectionId, values) =>
  put(`/api/suppliers/${supplierId}/registration/${sectionId}`, values);

/**
 * Menyunting profil pemasok yang sudah aktif.
 *
 * Perubahan pada pajak, dokumen, lisensi, atau pembayaran memicu verifikasi
 * ulang; `reverificationTriggered` pada hasilnya dipakai antarmuka untuk
 * memberi tahu pemasok bahwa dokumennya akan diperiksa lagi.
 */
export const updateActiveProfile = (supplierId, sectionId, values) =>
  put(`/api/suppliers/${supplierId}/active-profile/${sectionId}`, values);

export const acceptConsent = (gtcVersion, acceptedBy) =>
  post('/api/suppliers/consent', { gtcVersion, acceptedBy });

export { uploadFile, fileUrl } from './client.js';

/* ==================================================================== */
/* Verifikasi dokumen                                                   */
/* ==================================================================== */

export const verifyDocuments = (id) => post(`/api/suppliers/${id}/verify`);

/** notes: [{ sectionId, note }] */
export const requestDocumentFix = (id, notes) =>
  post(`/api/suppliers/${id}/request-fix`, { notes });

export const resubmitDocuments = () => post('/api/suppliers/resubmit');

export const listExpiringDocuments = (withinDays = 60) =>
  get('/api/documents/expiring', { withinDays });

/* ==================================================================== */
/* Kualifikasi dan preferred supplier                                   */
/* ==================================================================== */

/** lines: [{ commodityCode, countryCode, notes }] */
export const saveQualification = (supplierId, lines, status = 'draft') =>
  put(`/api/suppliers/${supplierId}/qualification`, { lines, status });

export const submitForPreferred = (id) => post(`/api/suppliers/${id}/submit-preferred`);

export const approvePreferred = (id, note) =>
  post(`/api/suppliers/${id}/decide-preferred`, { decision: 'approved', note });

export const disqualifySupplier = (id, reason) =>
  post(`/api/suppliers/${id}/decide-preferred`, { decision: 'disqualified', note: reason });

export const reopenQualification = (id) => post(`/api/suppliers/${id}/reopen`);

/* ==================================================================== */
/* Questionnaire                                                        */
/* ==================================================================== */

export const listTemplates = (filters) => get('/api/questionnaires', filters);
export const getVersion = (versionId) => get(`/api/questionnaires/versions/${versionId}`);
export const createTemplate = (payload) => post('/api/questionnaires', payload);
export const publishVersion = (versionId) =>
  post(`/api/questionnaires/versions/${versionId}/publish`);

/**
 * Versi baru dari versi yang ada.
 *
 * Isinya disalin, termasuk pemetaan ulang acuan kondisi ke pertanyaan salinan.
 * v1.0 tetap utuh dan tetap melayani respons lama.
 */
export const createNewVersion = (sourceVersionId, versionLabel) =>
  post(`/api/questionnaires/versions/${sourceVersionId}/new-version`, { versionLabel });

export const createAssignment = (payload) => post('/api/assignments', payload);

export const listAssignments = (filters) => get('/api/responses', filters);
export const myQuestionnaires = () => get('/api/responses');
export const getResponse = (id) => get(`/api/responses/${id}`);

/** answers: { [questionId]: value } — simpan draf, sebagian. */
export const saveAnswers = (responseId, answers) =>
  put(`/api/responses/${responseId}/answers`, { answers });

/**
 * Prapemeriksaan sebelum kirim.
 *
 * Dipanggil layar konfirmasi supaya pemasok tahu persis apa yang kurang
 * sebelum menekan kirim, bukan setelah.
 */
export const precheckResponse = (responseId) => get(`/api/responses/${responseId}/precheck`);
export const submitResponse = (responseId) => post(`/api/responses/${responseId}/submit`);

export const claimReview = (responseId) => post(`/api/responses/${responseId}/claim`);

/** decision: 'approve' | 'reject' | 'request_revision'; flags: [{ questionId, note }] */
export const reviewResponse = (responseId, decision, summary, flags = []) =>
  post(`/api/responses/${responseId}/review`, { decision, summary, flags });

/** KPI dihitung di server, bukan dengan mengunduh seluruh respons. */
export const loadDashboard = () => get('/api/dashboard');

/* ==================================================================== */
/* Notifikasi dan jejak audit                                           */
/* ==================================================================== */

export const listNotifications = () => get('/api/notifications');
export const markNotificationRead = (id) => post(`/api/notifications/${id}/read`);
export const listAuditLog = () => get('/api/audit');

/**
 * Notifikasi tanpa langganan waktu nyata.
 *
 * Supabase Realtime hilang bersama Supabase. Penggantinya polling sederhana —
 * cukup untuk lencana notifikasi, dan tidak menuntut WebSocket yang harus
 * dijaga tetap hidup. Kalau kelak terasa kurang, ganti dengan Server-Sent
 * Events; perubahannya hanya di fungsi ini.
 */
export function pollNotifications(handler, intervalMs = 60_000) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try { handler(await listNotifications()); } catch { /* diam; coba lagi nanti */ }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}
