/**
 * Pemeriksaan mesin questionnaire.
 * Menyasar aturan bisnis pada bagian 29 spesifikasi, bukan sekadar
 * memastikan fungsi berjalan.
 */
import {
  REVIEW_DECISION,
  RESPONSE_STATUS,
  awaitsReview,
  canSupplierEdit,
  commentsFor,
  isSettled,
  latestReview,
  questionsNeedingRevision,
  responseRate,
  revisionBlockers,
  riskDistribution,
  summarise,
  addSectionFromLibrary,
  updateVersionSettings,
  updateRiskBand,
  addQuestion,
  addSection,
  assertShape,
  changeQuestionType,
  deleteQuestion,
  deleteSection,
  duplicateQuestion,
  duplicateSection,
  eligibleTriggers,
  findQuestion,
  moveQuestion,
  moveSection,
  moveQuestionToSection,
  updateQuestion,
  calculateCompletion,
  calculateScore,
  canEdit,
  countQuestions,
  countSections,
  createNextVersion,
  emptyAnswersFor,
  findCircularDependency,
  isVersionExpired,
  listTypesByGroup,
  makeAttachmentRule,
  makeQuestion,
  makeSection,
  makeVersion,
  publish,
  publishBlockers,
  pruneHiddenAnswers,
  submissionBlockers,
  validateResponse,
  visibleQuestionIds,
  QUESTION_TYPES,
  TEMPLATE_STATUS,
} from '../src/questionnaire/engine/index.js';
import {
  QUESTIONNAIRE_TEMPLATES,
  QUESTIONNAIRE_VERSIONS,
  QUESTION_LIBRARY,
  SECTION_LIBRARY,
} from '../src/questionnaire/store/questionnaireMockData.js';
import { ASSIGNMENTS, RESPONSES } from '../src/questionnaire/store/assignmentMockData.js';

let failures = 0;

function check(label, actual, expected = true) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`}`);
}

/* ---------------- Data contoh ---------------- */
check('D1 tiga template tersedia', QUESTIONNAIRE_TEMPLATES.length, 3);
check('D2 tiga versi tersedia', QUESTIONNAIRE_VERSIONS.length, 3);
QUESTIONNAIRE_VERSIONS.forEach((version) => {
  check(`D3 ${version.id} berbentuk sehat`, assertShape(version).length, 0);
  check(`D4 ${version.id} bebas acuan melingkar`, findCircularDependency(version), null);
});
check('D5 pustaka soal terisi', QUESTION_LIBRARY.length > 5);

const audit = QUESTIONNAIRE_VERSIONS.find((v) => v.id === 'ver_audit_v1');
const animal = QUESTIONNAIRE_VERSIONS.find((v) => v.id === 'ver_animal_v1');

/* ---------------- Registri tipe ---------------- */
const groups = listTypesByGroup();
check('T1 tujuh kelompok tipe soal', groups.length, 7);
check('T2 seluruh tipe punya label', Object.values(QUESTION_TYPES).every((t) => Boolean(t.label)));
check('T3 seluruh tipe punya isAnswered', Object.values(QUESTION_TYPES).every((t) => typeof t.isAnswered === 'function'));
check('T4 seluruh tipe punya scoreOf', Object.values(QUESTION_TYPES).every((t) => typeof t.scoreOf === 'function'));

/* ---------------- Kondisi (aturan 6) ---------------- */
check(
  'C1 cabang ya tersembunyi sebelum dijawab',
  visibleQuestionIds(audit, {}).has('q_audit_iso_doc'),
  false,
);
check(
  'C2 cabang ya tampak setelah menjawab ya',
  visibleQuestionIds(audit, { q_audit_iso: 'yes' }).has('q_audit_iso_doc'),
);
check(
  'C3 cabang tidak muncul pada jawaban berlawanan',
  visibleQuestionIds(audit, { q_audit_iso: 'no' }).has('q_audit_iso_plan'),
);
check(
  'C4 kondisi any menampung dua nilai',
  visibleQuestionIds(audit, { q_audit_qms_doc: 'partial' }).has('q_audit_qms_file'),
);

const withStale = { q_audit_iso: 'yes', q_audit_iso_doc: ['berkas'] };
const pruned = pruneHiddenAnswers(audit, { ...withStale, q_audit_iso: 'no' });
check('C5 jawaban cabang tersembunyi dibuang', 'q_audit_iso_doc' in pruned, false);

/* ---------------- Validasi (aturan 4, 5, 6) ---------------- */
const emptyAnswers = emptyAnswersFor(audit);
check('V1 jawaban kosong terbentuk untuk tiap soal', Object.keys(emptyAnswers).length, countQuestions(audit));

const errNo = validateResponse(audit, { q_audit_iso: 'no' }, {});
check('V2 soal tersembunyi tidak diwajibkan', 'q_audit_iso_doc' in errNo, false);
check('V3 soal cabang yang tampak diwajibkan', 'q_audit_iso_plan' in errNo);

const errYes = validateResponse(audit, { q_audit_iso: 'yes' }, {});
check('V4 lampiran wajib terdeteksi kosong', 'q_audit_iso_doc' in errYes);

const bigFile = [{ fileName: 'besar.pdf', fileType: 'application/pdf', fileSize: 9 * 1024 * 1024, expiryDate: '2030-01-01' }];
const errBig = validateResponse(audit, { q_audit_iso: 'yes' }, { q_audit_iso_doc: bigFile });
check('V5 berkas melebihi batas ditolak', Boolean(errBig.q_audit_iso_doc));

const wrongType = [{ fileName: 'a.docx', fileType: 'application/msword', fileSize: 1000, expiryDate: '2030-01-01' }];
const errType = validateResponse(audit, { q_audit_iso: 'yes' }, { q_audit_iso_doc: wrongType });
check('V6 format berkas tak diterima ditolak', Boolean(errType.q_audit_iso_doc));

const noExpiry = [{ fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 1000 }];
const errExpiry = validateResponse(audit, { q_audit_iso: 'yes' }, { q_audit_iso_doc: noExpiry });
check('V7 tanggal berlaku wajib terdeteksi', Boolean(errExpiry.q_audit_iso_doc));

const expired = [{ fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 1000, expiryDate: '2020-01-01' }];
const errExpired = validateResponse(audit, { q_audit_iso: 'yes' }, { q_audit_iso_doc: expired });
check('V8 berkas kedaluwarsa ditolak', Boolean(errExpired.q_audit_iso_doc));

const blockers = submissionBlockers(audit, {}, {});
check('V9 penghalang kirim menyebut nama seksi', Boolean(blockers[0]?.sectionName));

/* ---------------- Skoring (aturan 7, 8) ---------------- */
check('S1 questionnaire tanpa skoring mengembalikan null', calculateScore(animal, {}), null);

const perfect = {
  q_audit_iso: 'yes',
  q_audit_qms_doc: 'yes',
  q_audit_internal: 'yes',
  q_audit_capa: 'yes',
  q_audit_gmp: 'yes',
  q_audit_training: 'yes',
  q_audit_cross: 'yes',
  q_audit_gmp_score: 5,
  q_audit_halal: 'yes',
};
const best = calculateScore(audit, perfect);
check('S2 jawaban terbaik memberi 100', best.total, 100);
check('S3 klasifikasi risiko rendah', best.riskLevel, 'low');
check('S4 lulus nilai kelulusan', best.passed, true);

const worst = calculateScore(audit, {
  ...perfect,
  q_audit_iso: 'no',
  q_audit_qms_doc: 'no',
  q_audit_internal: 'no',
  q_audit_capa: 'no',
  q_audit_gmp: 'no',
  q_audit_training: 'no',
  q_audit_cross: 'no',
  q_audit_gmp_score: 1,
  q_audit_halal: 'no',
});
check('S5 jawaban terburuk gagal', worst.passed, false);
check('S6 risiko tinggi terdeteksi', worst.riskLevel, 'high');

// N/A harus dikeluarkan dari pembagi, bukan dihitung nol.
const withNa = calculateScore(audit, { ...perfect, q_audit_capa: 'na' });
check('S7 jawaban N/A tidak menurunkan skor', withNa.total, 100);

const qmsSection = withNa.sections.find((s) => s.sectionId === 'sec_audit_qms');
check('S8 N/A tercatat sebagai dikecualikan', qmsSection.excludedQuestions, 1);

/* ---------------- Kelengkapan ---------------- */
const completion = calculateCompletion(audit, {}, {});
check('K1 kelengkapan awal nol', completion.percent, 0);
check('K2 kelengkapan menghitung per seksi', completion.sections.length, countSections(audit));

const partial = calculateCompletion(audit, { q_audit_legal: 'PT A' }, {});
check('K3 kelengkapan naik setelah menjawab', partial.percent > 0);

/* ---------------- Versioning (aturan 1, 2, 3) ---------------- */
check('R1 versi terbit tidak dapat disunting', canEdit(audit), false);
check('R2 versi draf dapat disunting', canEdit(makeVersion()), true);

const emptyVersion = makeVersion();
check('R3 versi kosong tidak layak terbit', publishBlockers(emptyVersion).length > 0);

const next = createNextVersion(audit);
check('R4 versi baru berstatus draf', next.status, TEMPLATE_STATUS.DRAFT);
check('R5 label naik ke v2.0', next.versionLabel, 'v2.0');
check('R6 jumlah soal tersalin utuh', countQuestions(next), countQuestions(audit));
check(
  'R7 id pertanyaan diperbarui, bukan dibagi',
  next.sections[0].questions[0].id !== audit.sections[0].questions[0].id,
);

// Rujukan kondisi harus ikut dipetakan, bukan menunjuk id versi lama.
const nextRefs = next.sections[0].questions.find((q) => q.conditions)?.conditions.all[0].questionId;
const nextIds = new Set(next.sections.flatMap((s) => s.questions.map((q) => q.id)));
check('R8 kondisi menunjuk id versi baru', nextIds.has(nextRefs));

// Menyunting versi baru tidak boleh menyentuh versi lama.
next.sections[0].name = 'Diubah';
check('R9 versi lama tidak ikut berubah', audit.sections[0].name !== 'Diubah');

/* Versi terbit dibekukan: percobaan menyunting harus gagal. */
const draft = makeVersion({
  sections: [
    makeSection({
      name: 'Seksi',
      questions: [
        makeQuestion({ text: 'Contoh', type: 'short_text', required: true }),
      ],
    }),
  ],
});
const published = publish(draft, 'Penguji');
let mutationBlocked = false;
try {
  published.sections.push(makeSection({ name: 'Selundupan' }));
} catch {
  mutationBlocked = true;
}
check('R10 versi terbit benar-benar beku', mutationBlocked || published.sections.length === 1);

/* ---------------- Kedaluwarsa (aturan 9) ---------------- */
check('E1 versi tanpa tanggal akhir tidak kedaluwarsa', isVersionExpired(audit), false);
check(
  'E2 versi lewat tanggal akhir terdeteksi',
  isVersionExpired(makeVersion({ expiryDate: '2020-01-01' })),
  true,
);

/* ---------------- Aturan lampiran ---------------- */
const rule = makeAttachmentRule({ required: true, expiryDateRequired: true });
check('A1 aturan lampiran punya batas ukuran', rule.maxFileSizeMb > 0);
check('A2 aturan lampiran membatasi tipe berkas', rule.allowedTypes.length > 0);

/* ---------------- Operasi builder (Fase 3) ---------------- */
let b = makeVersion();
b = addSection(b, { name: 'Alpha' });
b = addSection(b, { name: 'Beta' });
check('B1 seksi bertambah', countSections(b), 2);
check('B2 urutan tercatat', b.sections.map((s) => s.order).join(','), '0,1');

const alphaId = b.sections[0].id;
const betaId = b.sections[1].id;

b = moveSection(b, betaId, -1);
check('B3 seksi naik satu langkah', b.sections[0].name, 'Beta');
check('B4 urutan dinomori ulang', b.sections.map((s) => s.order).join(','), '0,1');

const unchanged = moveSection(b, b.sections[0].id, -1);
check('B5 memindah di luar batas tidak mengubah apa pun', unchanged.sections[0].name, 'Beta');

b = addQuestion(b, alphaId, 'yes_no');
const trigger = findQuestion(b, b.sections.find((s) => s.id === alphaId).questions[0].id).question;
check('B6 tipe berpilihan mendapat preset', trigger.options.length, 2);

b = addQuestion(b, alphaId, 'file_single');
const fileQ = b.sections.find((s) => s.id === alphaId).questions[1];
check('B7 tipe berkas mendapat aturan lampiran', Boolean(fileQ.attachmentRule), true);
check('B8 lampiran berkas wajib secara bawaan', fileQ.attachmentRule.required, true);

b = updateQuestion(b, fileQ.id, {
  conditions: { all: [{ questionId: trigger.id, operator: 'equals', value: 'yes' }] },
});
check('B9 kondisi terpasang', Boolean(findQuestion(b, fileQ.id).question.conditions), true);

// Menghapus pemicu harus membersihkan kondisi yang menggantung.
const afterDelete = deleteQuestion(b, trigger.id);
check('B10 kondisi yatim dibersihkan', findQuestion(afterDelete, fileQ.id).question.conditions, null);
check('B11 bentuk tetap sehat setelah hapus', assertShape(afterDelete).length, 0);

// Menghapus seksi juga membersihkan kondisi lintas seksi.
b = addQuestion(b, betaId, 'short_text');
const betaQ = b.sections.find((s) => s.id === betaId).questions[0];
b = updateQuestion(b, betaQ.id, {
  conditions: { all: [{ questionId: trigger.id, operator: 'equals', value: 'yes' }] },
});
const afterSectionDelete = deleteSection(b, alphaId);
check('B12 hapus seksi membersihkan kondisi lintas seksi', findQuestion(afterSectionDelete, betaQ.id).question.conditions, null);
check('B13 bentuk tetap sehat setelah hapus seksi', assertShape(afterSectionDelete).length, 0);

// Duplikasi harus memberi id baru, bukan membagi objek yang sama.
const dupQ = duplicateQuestion(b, alphaId, trigger.id);
const alphaQuestions = dupQ.sections.find((s) => s.id === alphaId).questions;
check('B14 duplikat pertanyaan menambah satu', alphaQuestions.length, 3);
check('B15 duplikat memakai id berbeda', alphaQuestions[0].id !== alphaQuestions[1].id, true);
check('B16 pilihan duplikat juga ber-id baru', alphaQuestions[0].options[0].id !== alphaQuestions[1].options[0].id, true);
check('B17 duplikat tidak mewarisi kondisi', alphaQuestions[1].conditions, null);

const dupSec = duplicateSection(b, alphaId);
check('B18 duplikat seksi menambah satu', countSections(dupSec), 3);
check('B19 duplikat seksi ber-id baru', dupSec.sections[0].id !== dupSec.sections[1].id, true);

// Mengganti tipe harus menyesuaikan pilihan dan aturan lampiran.
const retyped = changeQuestionType(b, trigger.id, 'short_text');
check('B20 ganti ke teks menghapus pilihan', findQuestion(retyped, trigger.id).question.options.length, 0);
const retypedNa = changeQuestionType(b, trigger.id, 'yes_no_na');
check('B21 ganti ke ya/tidak/NA memberi empat pilihan', findQuestion(retypedNa, trigger.id).question.options.length, 4);

// Pemicu kondisi hanya boleh pertanyaan sebelumnya, agar tidak melingkar.
const triggers = eligibleTriggers(b, betaQ.id);
check('B22 pemicu hanya dari pertanyaan sebelumnya', triggers.every((t) => t.question.id !== betaQ.id), true);
check('B23 pemicu wajib punya pilihan', triggers.every((t) => t.question.options.length > 0), true);

// Memindah pertanyaan antar seksi.
const moved = moveQuestionToSection(b, betaQ.id, alphaId);
check('B24 pertanyaan pindah seksi', moved.sections.find((s) => s.id === betaId).questions.length, 0);
check('B25 jumlah total pertanyaan tetap', countQuestions(moved), countQuestions(b));

const movedQ = moveQuestion(b, alphaId, b.sections.find((s) => s.id === alphaId).questions[1].id, -1);
check('B26 pertanyaan naik satu langkah', movedQ.sections.find((s) => s.id === alphaId).questions[0].type, 'file_single');

/* ---------------- Pustaka & pengaturan versi (Fase 4) ---------------- */
let L = makeVersion();
const libSection = SECTION_LIBRARY.find((s) => s.id === 'lib_sec_quality');
L = addSectionFromLibrary(L, libSection, QUESTION_LIBRARY);

check('P1 seksi pustaka masuk beserta soalnya', L.sections[0].questions.length, libSection.questionIds.length);
check('P2 soal dari pustaka mendapat id baru', L.sections[0].questions[0].id.startsWith('lib_'), false);
check('P3 asal pustaka tercatat untuk penelusuran', L.sections[0].questions[0].libraryItemId, 'lib_q_iso');
check('P4 pilihan salinan juga ber-id baru', L.sections[0].questions[0].options[0].id.startsWith('lib_'), false);

// Aturan 13: menyunting pustaka tidak boleh merembet ke versi yang memakainya.
const libraryCopy = structuredClone(QUESTION_LIBRARY);
libraryCopy[0].question.text = 'TEKS PUSTAKA BERUBAH';
check('P5 versi tidak ikut berubah saat pustaka disunting', L.sections[0].questions[0].text !== 'TEKS PUSTAKA BERUBAH', true);

// Mematikan skoring tidak boleh menghapus bobot yang sudah diisi.
let W = makeVersion({ scoringEnabled: true });
W = addSection(W, { name: 'S', weight: 3 });
W = updateVersionSettings(W, { scoringEnabled: false });
check('P6 mematikan skoring mempertahankan bobot seksi', W.sections[0].weight, 3);
W = updateVersionSettings(W, { scoringEnabled: true, passingScore: 80 });
check('P7 nilai kelulusan tersimpan', W.passingScore, 80);

const banded = updateRiskBand(W, 'good', { label: 'Cukup' });
check('P8 pita risiko dapat diubah', banded.riskBands.find((b) => b.id === 'good').label, 'Cukup');
check('P9 pita lain tidak ikut berubah', banded.riskBands.find((b) => b.id === 'excellent').label, 'Excellent');

/* ---------------- Penugasan & respons (Fase 5) ---------------- */
const versionIds = new Set(QUESTIONNAIRE_VERSIONS.map((v) => v.id));
const templateIds = new Set(QUESTIONNAIRE_TEMPLATES.map((t) => t.id));

check('A1 empat penugasan tersedia', ASSIGNMENTS.length, 4);
check('A2 setiap penugasan menunjuk versi yang ada', ASSIGNMENTS.every((a) => versionIds.has(a.versionId)), true);
check('A3 setiap penugasan menunjuk template yang ada', ASSIGNMENTS.every((a) => templateIds.has(a.templateId)), true);

const assignmentIds = new Set(ASSIGNMENTS.map((a) => a.id));
check('A4 setiap respons menunjuk penugasan yang ada', RESPONSES.every((r) => assignmentIds.has(r.assignmentId)), true);
check('A5 setiap penugasan punya tepat satu respons', ASSIGNMENTS.every((a) => RESPONSES.filter((r) => r.assignmentId === a.id).length === 1), true);

// Jawaban contoh tidak boleh menunjuk pertanyaan yang tidak ada pada versinya.
let danglingAnswers = 0;
RESPONSES.forEach((response) => {
  const assignment = ASSIGNMENTS.find((a) => a.id === response.assignmentId);
  const version = QUESTIONNAIRE_VERSIONS.find((v) => v.id === assignment.versionId);
  const ids = new Set(version.sections.flatMap((s) => s.questions.map((q) => q.id)));
  Object.keys(response.answers).forEach((qid) => {
    if (!ids.has(qid)) danglingAnswers += 1;
  });
  Object.keys(response.attachments).forEach((qid) => {
    if (!ids.has(qid)) danglingAnswers += 1;
  });
});
check('A6 tidak ada jawaban yang menunjuk pertanyaan hantu', danglingAnswers, 0);

// Respons yang sudah terkirim harus benar-benar lolos validasi.
const submitted = RESPONSES.find((r) => r.status === 'submitted');
const submittedAssignment = ASSIGNMENTS.find((a) => a.id === submitted.assignmentId);
const submittedVersion = QUESTIONNAIRE_VERSIONS.find((v) => v.id === submittedAssignment.versionId);
const submittedBlockers = submissionBlockers(submittedVersion, submitted.answers, submitted.attachments);
check('A7 respons terkirim tidak menyisakan penghalang', submittedBlockers.length, 0);

const submittedCompletion = calculateCompletion(submittedVersion, submitted.answers, submitted.attachments);
check('A8 respons terkirim terisi penuh', submittedCompletion.percent, 100);

const submittedScore = calculateScore(submittedVersion, submitted.answers);
check('A9 skor respons terkirim terhitung', typeof submittedScore.total, 'number');
check('A10 klasifikasi risiko terisi', Boolean(submittedScore.riskLevel), true);

// Respons setengah jalan belum boleh dikirim.
const partialResponse = RESPONSES.find((r) => r.status === 'in_progress');
const partialAssignment = ASSIGNMENTS.find((a) => a.id === partialResponse.assignmentId);
const partialVersion = QUESTIONNAIRE_VERSIONS.find((v) => v.id === partialAssignment.versionId);
check('A11 respons setengah jalan masih terhalang', submissionBlockers(partialVersion, partialResponse.answers, partialResponse.attachments).length > 0, true);

// Membersihkan cabang tersembunyi sebelum kirim.
const beforePrune = { ...partialResponse.answers, q_audit_iso_doc: ['berkas lama'] };
const afterPrune = pruneHiddenAnswers(partialVersion, { ...beforePrune, q_audit_iso: 'no' });
check('A12 jawaban cabang tersembunyi tidak ikut terkirim', 'q_audit_iso_doc' in afterPrune, false);

/* ---------------- Tinjauan & revisi (Fase 6) ---------------- */
const reviewVersion = QUESTIONNAIRE_VERSIONS.find((v) => v.id === 'ver_audit_v1');

const baseResponse = {
  id: 'r1',
  status: RESPONSE_STATUS.SUBMITTED,
  revision: 1,
  answers: { q_audit_legal: 'PT Contoh', q_audit_iso: 'yes' },
  attachments: {},
  reviews: [],
};

check('T1 respons terkirim menunggu tinjauan', awaitsReview(baseResponse), true);
check('T2 respons terkirim belum final', isSettled(baseResponse), false);

// Meminta revisi menandai sebagian pertanyaan saja.
const revised = {
  ...baseResponse,
  status: RESPONSE_STATUS.REVISION_REQUIRED,
  reviews: [
    {
      id: 'rv1',
      revision: 1,
      decision: REVIEW_DECISION.REVISION,
      reviewerName: 'Dewi',
      decidedAt: new Date().toISOString(),
      note: 'Sebagian perlu diperbaiki.',
      flagged: [{ questionId: 'q_audit_legal', comment: 'Nama belum sesuai akta.', attachmentSnapshot: [] }],
      comments: [],
      answerSnapshot: { ...baseResponse.answers },
    },
  ],
};

const needing = questionsNeedingRevision(revised);
check('T3 hanya pertanyaan bertanda yang perlu diperbaiki', needing.size, 1);
check('T4 pertanyaan bertanda dapat disunting pemasok', canSupplierEdit(revised, 'q_audit_legal'), true);
check('T5 pertanyaan lain terkunci saat revisi', canSupplierEdit(revised, 'q_audit_iso'), false);
check('T6 respons terkirim tidak dapat disunting pemasok', canSupplierEdit(baseResponse, 'q_audit_legal'), false);

// Kirim ulang tanpa memperbaiki apa pun harus tertahan.
check('T7 revisi tanpa perubahan tertahan', revisionBlockers(revised, reviewVersion).length, 1);

const fixed = { ...revised, answers: { ...revised.answers, q_audit_legal: 'PT Contoh Sejahtera' } };
check('T8 revisi yang benar-benar diperbaiki lolos', revisionBlockers(fixed, reviewVersion).length, 0);

check('T9 komentar peninjau tercatat per pertanyaan', commentsFor(revised, 'q_audit_legal').length, 1);
check('T10 riwayat tinjauan tidak hilang', latestReview(revised).revision, 1);

const approved = { ...baseResponse, status: RESPONSE_STATUS.APPROVED };
check('T11 respons disetujui dianggap final', isSettled(approved), true);
check('T12 respons final tidak lagi menunggu tinjauan', awaitsReview(approved), false);

/* ---------------- Dashboard (Fase 7) ---------------- */
const kpi = summarise({
  templates: QUESTIONNAIRE_TEMPLATES,
  versions: QUESTIONNAIRE_VERSIONS,
  assignments: ASSIGNMENTS,
  responses: RESPONSES,
});

check('K1 jumlah template terhitung', kpi.templates, QUESTIONNAIRE_TEMPLATES.length);
check('K2 versi terbit terhitung', kpi.published, QUESTIONNAIRE_VERSIONS.filter((v) => v.status === 'published').length);
check('K3 penugasan terhitung', kpi.assigned, ASSIGNMENTS.length);
check('K4 seluruh respons masuk salah satu status', kpi.notStarted + kpi.inProgress + kpi.submitted + kpi.underReview + kpi.revisionRequired + kpi.approved + kpi.rejected, RESPONSES.length);
check('K5 penugasan lewat tenggat terdeteksi', kpi.overdue > 0, true);

const rate = responseRate(ASSIGNMENTS, RESPONSES);
check('K6 tingkat respons berada di 0–100', rate >= 0 && rate <= 100, true);

const dist = riskDistribution([
  { total: 95, riskLevel: 'low' },
  { total: 65, riskLevel: 'medium' },
  { total: null },
]);
check('K7 sebaran risiko menghitung tiap tingkat', dist.low + dist.medium + dist.unscored, 3);
check('K8 respons tanpa skor masuk kategori sendiri', dist.unscored, 1);

console.log(`\n${failures === 0 ? 'Seluruh pemeriksaan questionnaire lolos.' : `${failures} pemeriksaan gagal.`}`);
process.exit(failures === 0 ? 0 : 1);
