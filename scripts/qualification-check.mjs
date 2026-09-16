/** Pemeriksaan aturan kualifikasi pemasok. */
import {
  QUALIFICATION_STATUS,
  canFillQualification,
  canViewQualification,
  ineligibilityReason,
  isComplete,
  isEligible,
  makeLine,
  QUALIFIABLE_STATUSES,
  meaningfulLines,
  summariseLines,
  validateLines,
} from '../src/qualification/qualificationRules.js';
import {
  COUNTRIES,
  UNSPSC_COMMODITIES,
  UNSPSC_SEGMENTS,
  commoditiesBySegment,
  findCommodity,
  findCountry,
  segmentNameOf,
} from '../src/qualification/data/referenceData.js';
import { ROLE, STATUS } from '../src/lib/constants.js';
import { SUBMISSIONS } from '../src/lib/mockData.js';

let failures = 0;
function check(label, actual, expected = true) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`}`);
}

/* ---------------- Data acuan ---------------- */
check('Q1 segmen UNSPSC tersedia', UNSPSC_SEGMENTS.length > 10, true);
check('Q2 komoditas tersedia', UNSPSC_COMMODITIES.length > 30, true);
check('Q3 kode komoditas delapan digit', UNSPSC_COMMODITIES.every((c) => /^\d{8}$/.test(c.code)), true);
check('Q4 kode komoditas unik', new Set(UNSPSC_COMMODITIES.map((c) => c.code)).size, UNSPSC_COMMODITIES.length);
check('Q5 dua digit pertama sesuai segmennya', UNSPSC_COMMODITIES.every((c) => c.code.slice(0, 2) === c.segment), true);
check('Q6 setiap segmen komoditas dikenal', UNSPSC_COMMODITIES.every((c) => UNSPSC_SEGMENTS.some((s) => s.code === c.segment)), true);
check('Q7 nama segmen dapat ditelusuri dari kode', segmentNameOf('12161500').length > 0, true);

check('Q8 daftar negara memadai', COUNTRIES.length > 100, true);
check('Q9 kode negara dua huruf kapital', COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c.code)), true);
check('Q10 kode negara unik', new Set(COUNTRIES.map((c) => c.code)).size, COUNTRIES.length);
check('Q11 negara terurut menurut nama', COUNTRIES[0].name.localeCompare(COUNTRIES[COUNTRIES.length - 1].name, 'id') < 0, true);
check('Q12 Indonesia dan Malaysia ada', Boolean(findCountry('ID') && findCountry('MY')), true);

const grouped = commoditiesBySegment();
check('Q13 pengelompokan tidak menyisakan segmen kosong', grouped.every((g) => g.commodities.length > 0), true);
check('Q14 pengelompokan memuat seluruh komoditas', grouped.reduce((sum, g) => sum + g.commodities.length, 0), UNSPSC_COMMODITIES.length);

/* ---------------- Hak akses ---------------- */
check('Q15 staf procurement boleh mengisi', canFillQualification({ role: ROLE.STAFF }), true);
check('Q16 admin procurement boleh mengisi', canFillQualification({ role: ROLE.ADMIN }), true);
check('Q17 manager tidak mengisi', canFillQualification({ role: ROLE.MANAGER }), false);
check('Q18 manager tetap boleh meninjau', canViewQualification({ role: ROLE.MANAGER }), true);
check('Q19 pemasok tidak punya akses', canViewQualification({ role: ROLE.SUPPLIER }), false);

/* ---------------- Kelayakan ---------------- */
const byStatus = (status) => SUBMISSIONS.find((s) => s.status === status);
const active = byStatus(STATUS.PREFERRED);
const pending = byStatus(STATUS.SUPPLIER_REQUEST);
const qualifying = byStatus(STATUS.QUALIFICATION);
const inRegistration = byStatus(STATUS.REGISTRATION);

check('Q20 preferred supplier tetap layak ditinjau', isEligible(active), true);
// Jalur A: kualifikasi terbuka begitu pemasok mengirim profil, tanpa menunggu
// verifikasi dokumen selesai.
check('Q21 tahap registrasi sudah layak meski dokumen belum lolos periksa', isEligible(inRegistration), true);
check('Q22 dokumen yang perlu diperbaiki tetap layak', isEligible({ status: STATUS.NEEDS_DOCUMENT_FIX }), true);
check('Q23 pendaftaran baru belum layak', isEligible(pending), false);
check('Q24 tahap qualification jelas layak', isEligible(qualifying), true);
check('Q25 profil yang belum selesai diisi belum layak', isEligible({ status: STATUS.ONBOARDING }), false);
check('Q26 pemasok ditolak tidak pernah layak', isEligible({ status: STATUS.REJECTED }), false);
check('Q27 alasan ketidaklayakan dijelaskan', ineligibilityReason(pending).length > 20, true);
check('Q28 pemasok layak tanpa alasan penolakan', ineligibilityReason(active), null);
check('Q29 lima status memenuhi syarat kualifikasi', QUALIFIABLE_STATUSES.length, 5);

/* ---------------- Baris ---------------- */
const good = [
  makeLine({ commodityCode: '12161500', countryCode: 'ID' }),
  makeLine({ commodityCode: '12161500', countryCode: 'MY' }),
];
check('Q34 komoditas sama dari negara berbeda diizinkan', Object.keys(validateLines(good)).length, 0);

const dup = [
  makeLine({ commodityCode: '12161500', countryCode: 'ID' }),
  makeLine({ commodityCode: '12161500', countryCode: 'ID' }),
];
check('Q35 pasangan berulang ditolak', Object.keys(validateLines(dup)).length, 1);

const blank = makeLine();
check('Q36 baris kosong diabaikan', Object.keys(validateLines([blank])).length, 0);
check('Q37 baris kosong tidak ikut disimpan', meaningfulLines([blank, good[0]]).length, 1);

const halfA = makeLine({ commodityCode: '12161500' });
check('Q38 negara wajib diisi', Boolean(validateLines([halfA])[halfA.id]?.countryCode), true);
const halfB = makeLine({ countryCode: 'ID' });
check('Q39 komoditas wajib diisi', Boolean(validateLines([halfB])[halfB.id]?.commodityCode), true);

const unknown = makeLine({ commodityCode: '99999999', countryCode: 'ZZ' });
const unknownErrors = validateLines([unknown])[unknown.id];
check('Q40 kode komoditas asing ditolak', Boolean(unknownErrors.commodityCode), true);
check('Q41 kode negara asing ditolak', Boolean(unknownErrors.countryCode), true);

check('Q42 kualifikasi tanpa baris belum selesai', isComplete([blank]), false);
check('Q43 kualifikasi dengan baris sah dianggap selesai', isComplete(good), true);
check('Q44 kualifikasi dengan duplikat belum selesai', isComplete(dup), false);

const summary = summariseLines(good);
check('Q45 ringkasan menghitung baris', summary.lines, 2);
check('Q46 ringkasan menghitung komoditas unik', summary.commodities, 1);
check('Q47 ringkasan menghitung negara unik', summary.countries, 2);
check('Q48 komoditas dapat ditemukan dari kodenya', findCommodity('12161500').name.length > 0, true);
check('Q49 status kualifikasi lengkap tersedia', Object.keys(QUALIFICATION_STATUS).length, 3);

console.log(`\n${failures === 0 ? 'Seluruh pemeriksaan kualifikasi lolos.' : `${failures} pemeriksaan gagal.`}`);
process.exit(failures === 0 ? 0 : 1);
