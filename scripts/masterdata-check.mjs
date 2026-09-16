/** Pemeriksaan master data Data Umum dan pemetaan kodenya. */
import {
  CORPORATE_ENTITIES,
  ENTITY_TYPES,
  LEGAL_STATUSES,
  LEGAL_STATUS_ENTITY,
  OTV_STATUSES,
  TARGET_COMPANIES,
  VENDOR_DIRECT_TYPES,
  VENDOR_TYPES,
  VENDOR_TYPE_DETAILS,
  asOptions,
  corporateCodesFor,
  detailsForVendorType,
  labelOf,
  labelWithCode,
  LEGAL_DOCUMENTS,
  legalDocumentsOf,
  makeLegalDocuments,
  TAX_DOCUMENTS,
  TRANSACTION_TYPES,
  eInvoiceFor,
  isTaxDocumentTouched,
  makeTaxDocument,
  makeTaxDocuments,
  ACCOUNT_TYPES,
  AGREEMENT_RATE_OPTIONS,
  BANKS,
  FISCAL_POSITIONS,
  TERMS_OF_PAYMENT,
  findBank,
  isBankLineTouched,
  makeBankLine,
} from '../src/lib/masterData.js';
import { SUBMISSIONS } from '../src/lib/mockData.js';
import {
  validateBankLines,
  validateSection,
  validateTaxDocuments,
} from '../src/lib/profileRules.js';
import { validateFileName } from '../src/lib/validation.js';

let failures = 0;
function check(label, actual, expected = true) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`}`);
}

const LISTS = [
  ['status badan hukum', LEGAL_STATUSES, 2],
  ['bentuk badan usaha', ENTITY_TYPES, 28],
  ['jenis pasokan', VENDOR_TYPES, 3],
  ['rincian jenis pasokan', VENDOR_TYPE_DETAILS, 7],
  ['rencana kerja sama', OTV_STATUSES, 2],
  ['tipe vendor', VENDOR_DIRECT_TYPES, 2],
];

LISTS.forEach(([nama, list, jumlah]) => {
  check(`M01 jumlah ${nama}`, list.length, jumlah);
  check(`M02 ${nama} punya kode unik`, new Set(list.map((i) => i.code)).size, list.length);
  check(`M03 ${nama} punya nama lengkap`, list.every((i) => Boolean(i.name)), true);
});

check('M04 kode status badan hukum sesuai dokumen', LEGAL_STATUSES.map((i) => i.code).join(','), 'Z1,Z2');
check('M05 badan usaha memakai kode Z2', LEGAL_STATUS_ENTITY, 'Z2');
check('M06 rencana kerja sama memakai C1 dan C0', OTV_STATUSES.map((i) => i.code).join(','), 'C1,C0');
check('M07 tipe vendor memakai Z002 dan Z009', VENDOR_DIRECT_TYPES.map((i) => i.code).join(','), 'Z002,Z009');
check('M08 bentuk badan usaha bernomor urut 0001–0028',
  ENTITY_TYPES.every((item, index) => item.code === String(index + 1).padStart(4, '0')), true);

/* Rincian jenis pasokan terfilter */
check('M09 raw material punya satu rincian', detailsForVendorType('0001').length, 1);
check('M10 packaging material punya dua rincian', detailsForVendorType('0002').length, 2);
check('M11 indirect material punya empat rincian', detailsForVendorType('0003').length, 4);
check('M12 seluruh rincian menunjuk jenis pasokan yang ada',
  VENDOR_TYPE_DETAILS.every((d) => VENDOR_TYPES.some((v) => v.code === d.filterBy)), true);
check('M13 jenis pasokan tak dikenal tidak memberi rincian', detailsForVendorType('9999').length, 0);

/* Perusahaan Paragon */
check('M14 antarmuka hanya dua pilihan', TARGET_COMPANIES.length, 2);
check('M15 tujuh entitas korporat tersimpan', CORPORATE_ENTITIES.length, 7);
check('M16 memilih Indonesia mengirim enam kode korporat', corporateCodesFor(['Paragon Corp Indonesia']).length, 6);
check('M17 memilih Malaysia mengirim satu kode korporat', corporateCodesFor(['Paragon Corp Malaysia']).length, 1);
check('M18 memilih keduanya mengirim seluruh kode', corporateCodesFor(TARGET_COMPANIES).length, 7);
check('M19 tanpa pilihan tidak mengirim kode apa pun', corporateCodesFor([]).length, 0);

/* Pembantu tampilan */
check('M20 label diambil dari kode', labelOf(ENTITY_TYPES, '0004'), 'SDN. BHD.');
check('M21 kode tak dikenal ditampilkan apa adanya', labelOf(ENTITY_TYPES, '9999'), '9999');
check('M22 kode kosong menghasilkan teks kosong', labelOf(ENTITY_TYPES, ''), '');
check('M23 label dengan kode untuk layar tinjauan', labelWithCode(VENDOR_TYPES, '0002'), 'Packaging Material (0002)');
check('M24 opsi select berbentuk value dan label', asOptions(VENDOR_TYPES)[0].value, '0001');

/* Data contoh konsisten dengan master data */
let menyimpang = 0;
SUBMISSIONS.forEach((s) => {
  const g = s.general;
  if (!LEGAL_STATUSES.some((i) => i.code === g.legalStatus)) menyimpang += 1;
  if (!VENDOR_TYPES.some((i) => i.code === g.vendorType)) menyimpang += 1;
  if (!OTV_STATUSES.some((i) => i.code === g.otvStatus)) menyimpang += 1;
  if (!VENDOR_DIRECT_TYPES.some((i) => i.code === g.vendorDirectType)) menyimpang += 1;
  const detail = VENDOR_TYPE_DETAILS.find((i) => i.code === g.vendorTypeDetail);
  if (!detail || detail.filterBy !== g.vendorType) menyimpang += 1;
});
check('M25 data contoh memakai kode yang sah dan cocok filternya', menyimpang, 0);

/* Validasi formulir */
const lengkap = {
  legalStatus: 'Z2', entityType: '0001', vendorName: 'PT Uji', vendorType: '0002',
  vendorTypeDetail: '0001', vendorDirectType: 'Z009', targetCompanies: ['Paragon Corp Indonesia'],
  otvStatus: 'C1', companyEmail: 'a@b.co', mobilePhone: '081234567', officePhone: '',
};
check('M26 isian lengkap lolos validasi', Object.keys(validateSection('general', lengkap)).length, 0);
check('M27 tipe vendor wajib diisi',
  Boolean(validateSection('general', { ...lengkap, vendorDirectType: '' }).vendorDirectType), true);
check('M28 rincian jenis pasokan wajib diisi',
  Boolean(validateSection('general', { ...lengkap, vendorTypeDetail: '' }).vendorTypeDetail), true);
check('M29 bentuk badan usaha wajib bila berbadan hukum',
  Boolean(validateSection('general', { ...lengkap, entityType: '' }).entityType), true);
check('M30 perorangan tidak menuntut bentuk badan usaha',
  Boolean(validateSection('general', { ...lengkap, legalStatus: 'Z1', entityType: '' }).entityType), false);

/* ---------------- Data pajak ---------------- */
check('X01 empat transaction type', TRANSACTION_TYPES.length, 4);
check('X02 kode transaction type unik', new Set(TRANSACTION_TYPES.map((t) => t.code)).size, 4);
check('X03 e-invoice Yes untuk Goods', eInvoiceFor('T01'), 'Yes');
check('X04 e-invoice No untuk CSR Cash Money', eInvoiceFor('T02'), 'No');
check('X05 e-invoice No untuk Rent', eInvoiceFor('T03'), 'No');
check('X06 e-invoice No untuk Other', eInvoiceFor('T04'), 'No');
check('X07 e-invoice No bila belum dipilih', eInvoiceFor(''), 'No');

check('X08 enam dokumen perpajakan', TAX_DOCUMENTS.length, 6);
check('X09 hanya SIUP yang wajib', TAX_DOCUMENTS.filter((d) => d.required).map((d) => d.key).join(','), 'siup');
check('X10 dokumen kosong punya empat kolom', Object.keys(makeTaxDocument()).length, 4);
check('X11 seluruh dokumen terbentuk kosong', Object.keys(makeTaxDocuments()).length, 6);
check('X12 dokumen kosong belum tersentuh', isTaxDocumentTouched(makeTaxDocument()), false);
check('X13 satu kolom terisi dianggap tersentuh', isTaxDocumentTouched({ number: '1' }), true);

const pajakKosong = validateTaxDocuments(makeTaxDocuments());
check('X14 SIUP kosong ditolak', Boolean(pajakKosong['documents.siup.number']), true);
check('X15 dokumen opsional kosong tidak ditolak', Boolean(pajakKosong['documents.pkp.number']), false);

const pajakSebagian = makeTaxDocuments();
pajakSebagian.sbu.number = 'SBU-1';
const galatSebagian = validateTaxDocuments(pajakSebagian);
check('X16 dokumen opsional setengah terisi menuntut berkas', Boolean(galatSebagian['documents.sbu.file']), true);
check('X17 dan menuntut masa berlakunya', Boolean(galatSebagian['documents.sbu.validFrom']), true);

const terbalik = makeTaxDocuments();
terbalik.siup = { number: '1', file: { name: 'a.pdf' }, validFrom: '2030-01-01', validUntil: '2029-01-01' };
check('X18 tanggal akhir mendahului mulai ditolak', Boolean(validateTaxDocuments(terbalik)['documents.siup.validUntil']), true);

const kedaluwarsa = makeTaxDocuments();
kedaluwarsa.siup = { number: '1', file: { name: 'a.pdf' }, validFrom: '2020-01-01', validUntil: '2021-01-01' };
check('X19 dokumen kedaluwarsa ditolak', Boolean(validateTaxDocuments(kedaluwarsa)['documents.siup.validUntil']), true);

const berkasPajak = { name: 'a.pdf', size: 1000, type: 'application/pdf' };
const pajakLengkap = {
  taxName: 'PT Uji', taxAddress: 'Jl. Uji No. 1', nik: '3175094401900002',
  npwp: '0123456789012345', ktpDocument: berkasPajak, npwpDocument: berkasPajak,
  transactionType: 'T01', tin: 'TIN-1', tinDocument: berkasPajak, brn: 'BRN-1',
  brnDocument: berkasPajak, gstNumber: 'GST-1',
  documents: {
    ...makeTaxDocuments(),
    siup: { number: 'S-1', file: berkasPajak, validFrom: '2026-01-01', validUntil: '2030-01-01' },
  },
};
check('X20 data pajak lengkap lolos', Object.keys(validateSection('tax', pajakLengkap)).length, 0);
check('X21 tax name wajib', Boolean(validateSection('tax', { ...pajakLengkap, taxName: '' }).taxName), true);
check('X22 tax address wajib', Boolean(validateSection('tax', { ...pajakLengkap, taxAddress: '' }).taxAddress), true);
check('X23 transaction type wajib', Boolean(validateSection('tax', { ...pajakLengkap, transactionType: '' }).transactionType), true);
check('X24 transaction type asing ditolak', Boolean(validateSection('tax', { ...pajakLengkap, transactionType: 'T99' }).transactionType), true);
check('X25 unggahan NPWP wajib', Boolean(validateSection('tax', { ...pajakLengkap, npwpDocument: null }).npwpDocument), true);
check('X26 TIN wajib', Boolean(validateSection('tax', { ...pajakLengkap, tin: '' }).tin), true);
check('X27 dokumen TIN wajib', Boolean(validateSection('tax', { ...pajakLengkap, tinDocument: null }).tinDocument), true);
check('X28 BRN wajib', Boolean(validateSection('tax', { ...pajakLengkap, brn: '' }).brn), true);
check('X29 dokumen BRN wajib', Boolean(validateSection('tax', { ...pajakLengkap, brnDocument: null }).brnDocument), true);
check('X30 nomor GST wajib', Boolean(validateSection('tax', { ...pajakLengkap, gstNumber: '' }).gstNumber), true);

/* ---------------- Dokumen legalitas ---------------- */
check('L01 tiga belas dokumen legalitas', LEGAL_DOCUMENTS.length, 13);
check('L02 kunci dokumen unik', new Set(LEGAL_DOCUMENTS.map((d) => d.key)).size, LEGAL_DOCUMENTS.length);
check('L03 sembilan dokumen pada kelompok upload', legalDocumentsOf('upload').length, 9);
check('L04 empat dokumen pada kelompok other', legalDocumentsOf('other').length, 4);
check('L05 lima dokumen wajib',
  LEGAL_DOCUMENTS.filter((d) => d.required).map((d) => d.key).join(','),
  'aktaPendirian,skPendirian,nib,conflictOfInterest,businessLicense');
check('L06 dokumen kosong terbentuk lengkap', Object.keys(makeLegalDocuments()).length, 13);

const dokKosong = validateSection('documents', makeLegalDocuments());
check('L07 lima dokumen wajib ditagih', Object.keys(dokKosong).filter((k) => k !== 'reasonNoDoe').length, 5);
check('L08 alasan DoE ditagih saat DoE kosong', Boolean(dokKosong.reasonNoDoe), true);

const dokLengkap = {
  ...makeLegalDocuments(),
  aktaPendirian: { name: 'akta.pdf' },
  skPendirian: { name: 'sk.pdf' },
  nib: { name: 'nib.pdf' },
  conflictOfInterest: { name: 'coi.pdf' },
  businessLicense: { name: 'bl.pdf' },
  reasonNoDoe: 'Dokumen setara tercakup pada akta pendirian.',
};
check('L09 dokumen wajib lengkap lolos', Object.keys(validateSection('documents', dokLengkap)).length, 0);

const denganDoe = { ...dokLengkap, deedOfEstablishment: { name: 'doe.pdf' }, reasonNoDoe: '' };
check('L10 melampirkan DoE membatalkan kewajiban alasan',
  Object.keys(validateSection('documents', denganDoe)).length, 0);

const dokOpsionalBuruk = { ...dokLengkap, izinLokasi: { name: 'izin#1.pdf' } };
check('L11 nama berkas opsional tetap diperiksa',
  Boolean(validateSection('documents', dokOpsionalBuruk).izinLokasi), true);

/* Nama berkas */
check('L12 nama wajar diterima', validateFileName('Akta Pendirian (2026).pdf'), null);
check('L13 nama dengan garis bawah diterima', validateFileName('sk_pendirian-2026.PDF'), null);
check('L14 karakter tidak lazim ditolak', Boolean(validateFileName('akta#1.pdf')), true);
check('L15 emoji ditolak', Boolean(validateFileName('akta\u2705.pdf')), true);
check('L16 nama kosong ditolak', Boolean(validateFileName('')), true);

/* ---------------- Pembayaran dan tagihan ---------------- */
check('P01 tiga puluh bank tersedia', BANKS.length, 30);
check('P02 kode bank unik', new Set(BANKS.map((b) => b.code)).size, 30);
check('P03 kode BIC unik', new Set(BANKS.map((b) => b.bic)).size, 30);
check('P04 seluruh BIC delapan atau sebelas karakter',
  BANKS.every((b) => b.bic.length === 8 || b.bic.length === 11), true);
check('P05 seluruh bank menyebut negaranya', BANKS.every((b) => Boolean(b.country)), true);
check('P06 memilih bank mengisi BIC dan negara',
  `${findBank('BCA').bic}|${findBank('BCA').country}`, 'CENAIDJA|Indonesia');
check('P07 bank tak dikenal mengembalikan null', findBank('XXXX'), null);

check('P08 tujuh termin pembayaran', TERMS_OF_PAYMENT.length, 7);
check('P09 termin sesuai dokumen',
  TERMS_OF_PAYMENT.map((t) => t.name).join(', '),
  '7 Days, 14 Days, 15 Days, 45 Days, 60 Days, 90 Days, 120 Days');
check('P10 dua pilihan agreement rate', AGREEMENT_RATE_OPTIONS.length, 2);
check('P11 lima fiscal position', FISCAL_POSITIONS.length, 5);
check('P12 empat account type', ACCOUNT_TYPES.length, 4);
check('P13 account type sesuai dokumen',
  ACCOUNT_TYPES.map((a) => a.name).join(', '),
  'Virtual Account, Bank Account, Batch Upload, Billing ID');

check('P14 baris baru belum tersentuh', isBankLineTouched(makeBankLine()), false);
check('P15 satu kolom terisi dianggap tersentuh', isBankLineTouched(makeBankLine({ bankCode: 'BCA' })), true);

const barisSah = makeBankLine({
  accountType: 'AT02', bankCode: 'BMRI', accountNumber: '1370011223344',
  accountHolder: 'PT Uji', statement: { name: 'koran.pdf' },
});

const bankLengkap = {
  currency: 'IDR', setAgreementRate: 'active', termsOfPayment1: 'D014',
  termsOfPayment2: '', termsOfPayment3: '', fiscalPosition: 'FP04', lines: [barisSah],
};
check('P16 pembayaran lengkap lolos', Object.keys(validateSection('banking', bankLengkap)).length, 0);
check('P17 set agreement rate wajib',
  Boolean(validateSection('banking', { ...bankLengkap, setAgreementRate: '' }).setAgreementRate), true);
check('P18 termin pertama wajib',
  Boolean(validateSection('banking', { ...bankLengkap, termsOfPayment1: '' }).termsOfPayment1), true);
check('P19 termin kedua boleh kosong',
  Boolean(validateSection('banking', { ...bankLengkap, termsOfPayment2: '' }).termsOfPayment2), false);
check('P20 termin ketiga boleh kosong',
  Boolean(validateSection('banking', { ...bankLengkap, termsOfPayment3: '' }).termsOfPayment3), false);
check('P21 termin kedua sama dengan pertama ditolak',
  Boolean(validateSection('banking', { ...bankLengkap, termsOfPayment2: 'D014' }).termsOfPayment2), true);
check('P22 termin ketiga mengulang ditolak',
  Boolean(validateSection('banking', { ...bankLengkap, termsOfPayment2: 'D045', termsOfPayment3: 'D045' }).termsOfPayment3), true);
check('P23 fiscal position boleh kosong',
  Boolean(validateSection('banking', { ...bankLengkap, fiscalPosition: '' }).fiscalPosition), false);
check('P24 fiscal position asing ditolak',
  Boolean(validateSection('banking', { ...bankLengkap, fiscalPosition: 'FP99' }).fiscalPosition), true);

check('P25 tanpa rekening ditolak', Boolean(validateBankLines([makeBankLine()])['lines']), true);
const barisSebagian = makeBankLine({ bankCode: 'BCA' });
const galatBaris = validateBankLines([barisSebagian]);
check('P26 rekening setengah terisi menuntut account type',
  Boolean(galatBaris[`lines.${barisSebagian.id}.accountType`]), true);
check('P27 dan menuntut bank statement',
  Boolean(galatBaris[`lines.${barisSebagian.id}.statement`]), true);

const barisKedua = makeBankLine({
  accountType: 'AT01', bankCode: 'BCA', accountNumber: '0451122334',
  accountHolder: 'PT Uji', statement: { name: 'koran2.pdf' },
});
check('P28 beberapa rekening berbeda diizinkan',
  Object.keys(validateBankLines([barisSah, barisKedua])).length, 0);

const barisKembar = makeBankLine({
  accountType: 'AT02', bankCode: 'BMRI', accountNumber: '1370011223344',
  accountHolder: 'PT Uji', statement: { name: 'koran3.pdf' },
});
check('P29 rekening yang sama pada bank sama ditolak',
  Boolean(validateBankLines([barisSah, barisKembar])[`lines.${barisKembar.id}.accountNumber`]), true);

const namaBuruk = makeBankLine({
  accountType: 'AT02', bankCode: 'BNI', accountNumber: '999',
  accountHolder: 'PT Uji', statement: { name: 'koran#1.pdf' },
});
check('P30 nama berkas rekening diperiksa',
  Boolean(validateBankLines([namaBuruk])[`lines.${namaBuruk.id}.statement`]), true);

console.log(`\n${failures === 0 ? 'Seluruh pemeriksaan master data lolos.' : `${failures} pemeriksaan gagal.`}`);
process.exit(failures === 0 ? 0 : 1);
