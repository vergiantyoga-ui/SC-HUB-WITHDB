/**
 * Uji end-to-end alur registrasi — tanpa database, tanpa peramban.
 *
 * Berbeda dari `flow-check.mjs` yang hanya memeriksa fungsi murni, berkas ini
 * menjalankan **store sungguhan**: reducer, aksi, dan transisi status yang
 * dipakai antarmuka. Yang dilakukan hanyalah memanggil aksi berurutan seperti
 * pengguna menekan tombolnya, lalu memeriksa keadaan setelah tiap langkah.
 *
 * Caranya: sebuah komponen kecil dipasang di dalam provider untuk merekam
 * `state` dan `actions`, lalu dirender dengan react-test-renderer yang tidak
 * memerlukan DOM. Karena seluruh data memang hidup di memori, tidak ada basis
 * data yang perlu disiapkan atau dibersihkan antar-uji.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  AppStoreProvider,
  useAppActions,
  useAppState,
} from '../src/store/AppStore.jsx';
import { PATH, STATUS } from '../src/lib/constants.js';
import { PROFILE_SECTIONS, REQUIRED_SECTION_IDS } from '../src/lib/constants.js';
import { passwordExpiryFrom } from '../src/lib/format.js';

let failures = 0;

function check(label, actual, expected = true) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`}`,
  );
}

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

/** Menjalankan store sungguhan dan mengembalikan cara membacanya. */
function mountStore() {
  const ref = { state: null, actions: null };

  function Probe() {
    ref.state = useAppState();
    ref.actions = useAppActions();
    return null;
  }

  act(() => {
    TestRenderer.create(
      React.createElement(AppStoreProvider, null, React.createElement(Probe)),
    );
  });

  return {
    /** Menjalankan satu aksi dan menunggu render berikutnya selesai. */
    run(fn) {
      let result;
      act(() => {
        result = fn(ref.actions, ref.state);
      });
      return result;
    },
    get state() {
      return ref.state;
    },
    supplier(id) {
      return ref.state.submissions.find((item) => item.id === id);
    },
  };
}

const STAFF = { id: 'usr-staff-1', name: 'Dewi Anggraini', role: 'procurement_staff' };
const MANAGER = { id: 'usr-manager-1', name: 'Lestari Handayani', role: 'procurement_manager' };

const registrationPayload = {
  general: {
    legalStatus: 'Z2',
    entityType: '0001',
    vendorName: 'PT Uji Alur Registrasi',
    vendorType: '0001',
    vendorTypeDetail: '0003',
    vendorDirectType: 'Z002',
    targetCompanies: ['Paragon Corp Indonesia'],
    otvStatus: 'C1',
    companyEmail: 'halo@ujialur.co.id',
    officePhone: '(021) 555-0000',
    mobilePhone: '+62 811-0000-0000',
    website: '',
  },
  address: {
    street: 'Jl. Uji No. 1',
    country: 'Indonesia',
    province: 'DKI Jakarta',
    city: 'Jakarta Selatan',
    district: '',
    subdistrict: '',
    postalCode: '12345',
  },
  contact: {
    name: 'Rara Penguji',
    title: 'Madam',
    jobPosition: 'Sales',
    email: 'rara@ujialur.co.id',
    phone: '',
    mobile: '+62 812-0000-0000',
    notes: '',
  },
  profile: {
    tax: { nik: '', npwp: '', ktpDocument: null, siupDocument: null },
    documents: { aktaPendirian: null, skPendirian: null, suratIzinUsaha: null },
    licenses: {
      gmp: { number: '', expiryDate: '', file: null, notApplicable: true },
      cpkb: { number: '', expiryDate: '', file: null, notApplicable: true },
      halal: { number: '', expiryDate: '', file: null, notApplicable: true },
    },
    banking: { bankName: '', accountNumber: '', accountHolder: '', currency: 'IDR', termsOfPayment: '' },
    contacts: [],
    completed: { tax: false, documents: false, licenses: false, banking: false, contacts: false },
  },
};

const berkas = { name: 'dokumen.pdf', size: 120_000, type: 'application/pdf' };

/* ------------------------------------------------------------------ */
/* Jalur A — undangan, dari pendaftaran sampai preferred               */
/* ------------------------------------------------------------------ */

console.log('\n── Jalur A: undangan pemasok ──');

const a = mountStore();
const jumlahAwal = a.state.submissions.length;

const idA = a.run((actions) => actions.registerSupplier(registrationPayload));
check('A01 pendaftaran menambah satu pengajuan', a.state.submissions.length, jumlahAwal + 1);
check('A02 status awal supplier request', a.supplier(idA).status, STATUS.SUPPLIER_REQUEST);
check('A03 riwayat mencatat pendaftaran', a.supplier(idA).timeline.length, 1);

a.run((actions) => actions.approveSubmission(idA, STAFF));
check('A04 disetujui staf', a.supplier(idA).status, STATUS.APPROVED);
check('A05 belum ada akun sebelum diundang', a.supplier(idA).account, null);

const akun = a.run((actions) => actions.inviteSupplier(idA, STAFF));
check('A06 undangan mengubah status', a.supplier(idA).status, STATUS.INVITED);
check('A07 jalur terkunci sebagai undangan', a.supplier(idA).onboardingPath, PATH.INVITE);
check('A08 id akun terbentuk', typeof akun.accountId, 'string');
check('A08b id akun memakai nama jenis pasokan, bukan kodenya', akun.accountId.includes('RAW'), true);
check('A09 kata sandi sementara terbit', typeof akun.temporaryPassword, 'string');

const kedaluwarsa = new Date(passwordExpiryFrom(akun.emailSentAt));
const selisihHari = Math.round((kedaluwarsa - new Date(akun.emailSentAt)) / 86_400_000);
check('A10 kata sandi berlaku 7 hari sejak email', selisihHari, 7);

// Pemasok masuk memakai id akun yang baru dibuat.
const masuk = a.run((actions) => actions.signInSupplier(akun.accountId));
check('A11 pemasok dapat masuk dengan id akun', masuk.ok, true);
check('A12 sesi menunjuk pengajuan yang benar', a.state.session.submissionId, idA);

a.run((actions) => actions.changePassword(idA));
check('A13 ganti sandi memindahkan ke pengisian profil', a.supplier(idA).status, STATUS.ONBOARDING);
// Ditulis sebagai perbandingan boolean: memberi `undefined` sebagai nilai
// harapan justru memicu nilai bawaan `true` pada helper check().
check('A14 kata sandi sementara dihapus', a.supplier(idA).account.temporaryPassword === undefined, true);

// Mengisi kelima bagian wajib.
const isian = {
  tax: {
    taxName: 'PT Uji Alur Registrasi',
    taxAddress: 'Jl. Uji No. 1, Jakarta Selatan',
    nik: '3175094401900002',
    npwp: '0123456789012345',
    ktpDocument: berkas,
    npwpDocument: berkas,
    transactionType: 'T01',
    tin: 'TIN-UJI-1',
    tinDocument: berkas,
    brn: 'BRN-UJI-1',
    brnDocument: berkas,
    gstNumber: 'GST-UJI-1',
    documents: {
      siup: { number: 'SIUP-1', file: berkas, validFrom: '2026-01-01', validUntil: '2030-01-01' },
      pkp: { number: '', file: null, validFrom: '', validUntil: '' },
      sbu: { number: '', file: null, validFrom: '', validUntil: '' },
      skb: { number: '', file: null, validFrom: '', validUntil: '' },
      suratKeteranganPp: { number: '', file: null, validFrom: '', validUntil: '' },
      codCor: { number: '', file: null, validFrom: '', validUntil: '' },
    },
  },
  documents: {
    aktaPendirian: berkas,
    skPendirian: berkas,
    nib: berkas,
    conflictOfInterest: berkas,
    businessLicense: berkas,
    reasonNoDoe: 'Dokumen setara sudah tercakup pada akta pendirian.',
  },
  licenses: {
    gmp: { number: '', expiryDate: '', file: null, notApplicable: true },
    cpkb: { number: '', expiryDate: '', file: null, notApplicable: true },
    halal: { number: '', expiryDate: '', file: null, notApplicable: true },
  },
  banking: {
    currency: 'IDR',
    setAgreementRate: 'active',
    termsOfPayment1: 'D014',
    termsOfPayment2: '',
    termsOfPayment3: '',
    fiscalPosition: 'FP04',
    lines: [
      {
        id: 'bank-uji-1',
        accountType: 'AT02',
        bankCode: 'BMRI',
        accountNumber: '1234567890',
        accountHolder: 'PT Uji Alur Registrasi',
        statement: berkas,
      },
    ],
  },
  contacts: [
    {
      id: 'ct-uji',
      name: 'Rara Penguji',
      title: 'Madam',
      jobPosition: 'Sales',
      email: 'rara@ujialur.co.id',
      phone: '',
      mobile: '+62 812-0000-0000',
      notes: '',
      isPrimary: true,
    },
  ],
};

REQUIRED_SECTION_IDS.forEach((sectionId) => {
  a.run((actions) => actions.saveProfileSection(idA, sectionId, isian[sectionId], 'supplier'));
});

const lengkap = REQUIRED_SECTION_IDS.every((id) => a.supplier(idA).profile.completed[id]);
check('A15 kelima bagian wajib tercatat lengkap', lengkap, true);
check('A16 pengisi tiap bagian tercatat', a.supplier(idA).profile.filledBy.tax, 'supplier');

a.run((actions) => actions.acceptConsent(idA, 'Rara Penguji', '2026.04.10', PATH.INVITE));
check('A17 persetujuan memindahkan ke tahap registrasi', a.supplier(idA).status, STATUS.REGISTRATION);
check('A18 kedua persetujuan tercatat', Boolean(
  a.supplier(idA).consent.gtcAcceptedAt && a.supplier(idA).consent.dataAccuracyAcceptedAt,
), true);

// Staf meminta perbaikan dokumen lebih dahulu.
a.run((actions) =>
  actions.requestDocumentFix(idA, [{ document: 'Scan KTP', reason: 'Tidak terbaca.' }], STAFF),
);
check('A19 permintaan perbaikan mengubah status', a.supplier(idA).status, STATUS.NEEDS_DOCUMENT_FIX);
check('A20 catatan perbaikan tersimpan', a.supplier(idA).verification.notes.length, 1);

a.run((actions) => actions.resubmitDocuments(idA, 'Rara Penguji'));
check('A21 pengiriman ulang kembali ke registrasi', a.supplier(idA).status, STATUS.REGISTRATION);

a.run((actions) => actions.verifyDocuments(idA, STAFF));
check('A22 dokumen lolos periksa menuju qualification', a.supplier(idA).status, STATUS.QUALIFICATION);
check('A23 tanggal registrasi tercatat', Boolean(a.supplier(idA).registeredAt), true);

// Staf mengisi kualifikasi, lalu mengajukan ke manager.
a.run((actions) =>
  actions.saveQualification(
    idA,
    [{ id: 'ql1', commodityCode: '12161500', countryCode: 'ID', notes: '' }],
    'completed',
    STAFF,
  ),
);
check('A24 kualifikasi tersimpan', a.state.qualifications[idA].lines.length, 1);
check('A25 status kualifikasi selesai', a.state.qualifications[idA].status, 'completed');

a.run((actions) => actions.submitForPreferred(idA, STAFF));
check('A26 diajukan sebagai preferred', a.supplier(idA).status, STATUS.AWAITING_PREFERRED);

a.run((actions) => actions.approvePreferred(idA, 'Rekam jejak baik.', MANAGER));
check('A27 manager menetapkan preferred', a.supplier(idA).status, STATUS.PREFERRED);
check('A28 keputusan mencatat pelakunya', a.supplier(idA).preferredDecision.decidedBy, MANAGER.name);

check('A29 riwayat menghimpun seluruh langkah', a.supplier(idA).timeline.length >= 8, true);

/* ------------------------------------------------------------------ */
/* Jalur B — registrasi internal, tanpa persetujuan manager            */
/* ------------------------------------------------------------------ */

console.log('\n── Jalur B: registrasi internal ──');

const b = mountStore();
const idB = b.run((actions) => actions.registerSupplier(registrationPayload));

b.run((actions) => actions.approveSubmission(idB, STAFF));
b.run((actions) => actions.startInternalRegistration(idB, 'whatsapp', STAFF));
check('B01 jalur internal terpilih', b.supplier(idB).status, STATUS.INTERNAL_DRAFT);
check('B02 asal dokumen tercatat', b.supplier(idB).documentSource, 'whatsapp');
check('B03 belum ada akun saat draf', b.supplier(idB).account, null);

REQUIRED_SECTION_IDS.forEach((sectionId) => {
  b.run((actions) => actions.saveProfileSection(idB, sectionId, isian[sectionId], 'staff'));
});
check('B04 pengisi tercatat sebagai staf', b.supplier(idB).profile.filledBy.banking, 'staff');
check('B05 status tidak berubah saat staf mengisi', b.supplier(idB).status, STATUS.INTERNAL_DRAFT);

// Persetujuan manager sudah dihapus: akun langsung terbit begitu staf selesai.
const akunB = b.run((actions) => actions.finishInternalRegistration(idB, STAFF));
check('B06 akun terbit tanpa persetujuan manager', Boolean(akunB.accountId), true);
check('B07 status langsung terhubung', b.supplier(idB).status, STATUS.CONNECTED);
check('B08 hak edit berpindah ke pemasok', Boolean(b.supplier(idB).editRightsTransferredAt), true);
check('B09 aksi persetujuan manager sudah tiada', typeof b.state && b.run((actions) => typeof actions.managerApprove), 'undefined');

b.run((actions) => actions.changePassword(idB));
b.run((actions) => actions.acceptConsent(idB, 'Rara Penguji', '2026.04.10', PATH.INTERNAL));
check('B10 jalur internal juga berujung ke registrasi', b.supplier(idB).status, STATUS.REGISTRATION);

/* ------------------------------------------------------------------ */
/* Jalur penolakan dan diskualifikasi                                  */
/* ------------------------------------------------------------------ */

console.log('\n── Jalur penolakan ──');

const c = mountStore();
const idC = c.run((actions) => actions.registerSupplier(registrationPayload));
c.run((actions) => actions.rejectSubmission(idC, 'Dokumen tidak sesuai nama pendaftar.', STAFF));
check('C01 penolakan mengubah status', c.supplier(idC).status, STATUS.REJECTED);
check('C02 alasan penolakan tersimpan', c.supplier(idC).rejectReason.length > 10, true);
check('C03 pemasok ditolak tidak punya akun', c.supplier(idC).account, null);

const d = mountStore();
const idD = d.run((actions) => actions.registerSupplier(registrationPayload));
d.run((actions) => actions.approveSubmission(idD, STAFF));
d.run((actions) => actions.inviteSupplier(idD, STAFF));
d.run((actions) => actions.changePassword(idD));
REQUIRED_SECTION_IDS.forEach((sectionId) => {
  d.run((actions) => actions.saveProfileSection(idD, sectionId, isian[sectionId], 'supplier'));
});
d.run((actions) => actions.acceptConsent(idD, 'Rara Penguji', '2026.04.10', PATH.INVITE));
d.run((actions) => actions.verifyDocuments(idD, STAFF));
d.run((actions) => actions.submitForPreferred(idD, STAFF));
d.run((actions) => actions.disqualifySupplier(idD, 'Kapasitas produksi belum memadai.', MANAGER));
check('D01 diskualifikasi mengubah status', d.supplier(idD).status, STATUS.DISQUALIFIED);
check('D02 alasan diskualifikasi tersimpan', Boolean(d.supplier(idD).preferredDecision.note), true);

d.run((actions) => actions.reopenQualification(idD, MANAGER));
check('D03 dapat dikembalikan ke qualification', d.supplier(idD).status, STATUS.QUALIFICATION);
check('D04 keputusan lama dibersihkan', d.supplier(idD).preferredDecision, null);

/* ------------------------------------------------------------------ */
/* Kemandirian antar-uji                                               */
/* ------------------------------------------------------------------ */

console.log('\n── Kemandirian data ──');

const e = mountStore();
check('E01 store baru tidak membawa pengajuan uji sebelumnya',
  e.state.submissions.some((item) => item.id === idA), false);
check('E02 store baru tidak membawa kualifikasi sebelumnya',
  Object.keys(e.state.qualifications).length, 0);
check('E03 tanpa basis data, tiap uji mulai dari data contoh yang sama',
  e.state.submissions.length, jumlahAwal);

console.log(
  `\n${failures === 0 ? 'Seluruh alur registrasi lolos, dijalankan lewat store sungguhan.' : `${failures} pemeriksaan gagal.`}`,
);
process.exit(failures === 0 ? 0 : 1);
