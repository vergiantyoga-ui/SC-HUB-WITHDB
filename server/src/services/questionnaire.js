import { all, now, one, parseJson, run, today, tx, uuid } from '../db/index.js';
import {
  assertSupplierAccess, badRequest, conflict, forbidden, isInternal, logAudit,
  notFound, notify, requireRole,
} from '../lib/core.js';

/* ==================================================================== */
/* MESIN                                                                */
/* ==================================================================== */
// Frontend punya mesinnya sendiri di src/questionnaire/engine/, dan itu tetap
// perlu: pertanyaan bersyarat harus muncul seketika, tanpa menunggu jaringan.
// Yang di sini bukan gantinya melainkan penjaganya. Skor dan kelengkapan yang
// dihitung di peramban dapat diubah siapa pun yang membuka devtools.
//
// Keduanya harus memberi hasil sama. Bila berbeda, yang benar adalah versi
// server — dan selisihnya adalah bug yang perlu diperbaiki di frontend.

/** Satu daun kondisi: { questionId, operator, value } */
function evalLeaf(leaf, answers) {
  const value = answers[leaf.questionId];
  const empty = value === undefined || value === null || value === '';

  if (empty) return leaf.operator === 'notAnswered';

  switch (leaf.operator) {
    case 'answered':    return true;
    case 'notAnswered': return false;
    case 'equals':      return String(value) === String(leaf.value);
    case 'notEquals':   return String(value) !== String(leaf.value);
    case 'in':          return (leaf.value ?? []).map(String).includes(String(value));
    case 'notIn':       return !(leaf.value ?? []).map(String).includes(String(value));
    case 'gt': {
      const a = Number(value), b = Number(leaf.value);
      // Perbandingan angka atas jawaban non-angka: kondisi dianggap tidak
      // terpenuhi, bukan melempar galat yang menggagalkan seluruh pengisian.
      return Number.isFinite(a) && Number.isFinite(b) && a > b;
    }
    case 'lt': {
      const a = Number(value), b = Number(leaf.value);
      return Number.isFinite(a) && Number.isFinite(b) && a < b;
    }
    default:
      throw badRequest(`Operator kondisi tidak dikenal: ${leaf.operator}`);
  }
}

/** Pohon kondisi: { all: [...] } atau { any: [...] }, boleh bersarang. */
export function evalCondition(node, answers) {
  if (!node) return true;   // tanpa kondisi = selalu tampak

  const evalChild = (child) =>
    (child.all || child.any) ? evalCondition(child, answers) : evalLeaf(child, answers);

  if (node.all) return node.all.every(evalChild);
  if (node.any) return node.any.some(evalChild);
  return true;
}

function answerMap(responseId) {
  const map = {};
  for (const a of all(
    'select question_id, value from response_answer where response_id = ? and value is not null',
    responseId,
  )) {
    map[a.question_id] = parseJson(a.value);
  }
  return map;
}

/** Pertanyaan yang TAMPAK bagi sebuah respons, sudah memperhitungkan kondisi. */
export function visibleQuestions(responseId) {
  const answers = answerMap(responseId);

  const questions = all(
    `select q.*, s.weight as section_weight
       from questionnaire_response r
       join questionnaire_assignment a on a.id = r.assignment_id
       join questionnaire_section s on s.version_id = a.version_id
       join question q on q.section_id = s.id
      where r.id = ?
      order by s.sort_order, q.sort_order`, responseId,
  );

  return questions
    .map((q) => ({
      ...q,
      conditions: parseJson(q.conditions),
      validation: parseJson(q.validation, {}),
      attachment_rule: parseJson(q.attachment_rule),
      required: Boolean(q.required),
    }))
    .filter((q) => evalCondition(q.conditions, answers));
}

/**
 * Kelengkapan, dihitung atas pertanyaan yang tampak saja. Menghitung yang
 * tersembunyi akan membuatnya tidak pernah mencapai 100%.
 */
export function computeCompletion(responseId) {
  const visible = visibleQuestions(responseId);
  if (visible.length === 0) return 0;

  const answered = visible.filter((q) => {
    const row = one(
      'select value, skipped from response_answer where response_id = ? and question_id = ?',
      responseId, q.id,
    );
    if (!row) return false;
    if (row.skipped) return true;
    const v = parseJson(row.value);
    return v !== null && v !== undefined && v !== '';
  }).length;

  return Math.round((10000 * answered) / visible.length) / 100;
}

/**
 * Skor berbobot.
 *
 * Tiap pertanyaan menyumbang (skor pilihan / skor maksimum) × bobot pertanyaan
 * × bobot seksi. Pilihan bertanda exclude_from_scoring (mis. N/A) dikeluarkan
 * dari pembilang MAUPUN penyebut, sehingga menjawab N/A tidak menghukum
 * pemasok.
 */
export function computeScore(responseId) {
  const version = one(
    `select v.* from questionnaire_response r
       join questionnaire_assignment a on a.id = r.assignment_id
       join questionnaire_version v on v.id = a.version_id
      where r.id = ?`, responseId,
  );
  if (!version?.scoring_enabled) return null;

  const answers = answerMap(responseId);
  let earned = 0;
  let possible = 0;

  for (const q of visibleQuestions(responseId)) {
    const type = one('select scorable from md_question_type where key = ?', q.type_key);
    if (!type?.scorable) continue;

    const options = all('select * from question_option where question_id = ?', q.id);
    const max = Math.max(
      0, ...options.filter((o) => !o.exclude_from_scoring).map((o) => o.score),
    );
    if (!max) continue;

    const weight = (q.section_weight ?? 1) * (q.weight ?? 1);
    const answer = answers[q.id];
    const chosen = options.find((o) => String(o.value) === String(answer));

    if (!chosen) {
      // Belum dijawab: tetap menambah penyebut, karena kekosongan memang
      // menurunkan skor.
      possible += weight;
      continue;
    }
    if (chosen.exclude_from_scoring) continue;   // N/A: keluar dari keduanya

    earned += (chosen.score / max) * weight;
    possible += weight;
  }

  if (possible === 0) return null;
  return Math.round((10000 * earned) / possible) / 100;
}

/** Klasifikasi risiko dibaca dari risk_bands milik versi, bukan daftar tetap. */
export function classifyRisk(responseId, score) {
  if (score === null || score === undefined) return null;

  const version = one(
    `select v.risk_bands from questionnaire_response r
       join questionnaire_assignment a on a.id = r.assignment_id
       join questionnaire_version v on v.id = a.version_id
      where r.id = ?`, responseId,
  );

  for (const band of parseJson(version?.risk_bands, [])) {
    if (score >= band.min && score <= band.max) return band.risk;
  }
  return null;
}

/**
 * Prapemeriksaan sebelum kirim.
 *
 * Menyebutkan persis apa yang kurang, bukan sekadar menolak. Pesan "ada yang
 * belum lengkap" memaksa pemasok menyisir ulang seluruh formulir.
 */
export function submissionBlockers(responseId) {
  const blockers = [];

  for (const q of visibleQuestions(responseId)) {
    const answer = one(
      'select * from response_answer where response_id = ? and question_id = ?',
      responseId, q.id,
    );
    const value = answer ? parseJson(answer.value) : null;
    const missing = value === null || value === undefined || value === '';

    if (q.required && !answer?.skipped && missing) {
      blockers.push(`${q.text} — belum dijawab.`);
      continue;
    }

    const v = q.validation ?? {};
    if (!missing && typeof value === 'string') {
      if (v.minLength && value.length < v.minLength) {
        blockers.push(`${q.text} — minimal ${v.minLength} karakter.`);
      }
      if (v.maxLength && value.length > v.maxLength) {
        blockers.push(`${q.text} — maksimal ${v.maxLength} karakter.`);
      }
    }
    if (Array.isArray(value) && v.minSelected && value.length < v.minSelected) {
      blockers.push(`${q.text} — pilih minimal ${v.minSelected} opsi.`);
    }

    const rule = q.attachment_rule;
    if (rule && answer) {
      const files = all('select * from answer_attachment where answer_id = ?', answer.id);

      if (rule.required && files.length === 0) blockers.push(`${q.text} — lampiran wajib.`);
      if (rule.maxFiles && files.length > rule.maxFiles) {
        blockers.push(`${q.text} — maksimal ${rule.maxFiles} berkas.`);
      }
      if (rule.expiryDateRequired && files.some((f) => !f.expiry_date)) {
        blockers.push(`${q.text} — tanggal berlaku lampiran wajib diisi.`);
      }
      if (rule.expiryMinDays != null) {
        const limit = new Date(Date.now() + rule.expiryMinDays * 86_400_000)
          .toISOString().slice(0, 10);
        if (files.some((f) => f.expiry_date && f.expiry_date < limit)) {
          blockers.push(
            `${q.text} — lampiran harus berlaku minimal ${rule.expiryMinDays} hari lagi.`);
        }
      }
    } else if (rule?.required && !answer) {
      blockers.push(`${q.text} — lampiran wajib.`);
    }
  }

  return blockers;
}

/* ==================================================================== */
/* Template dan versi                                                   */
/* ==================================================================== */

export function listTemplates(user, { type, search } = {}) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');

  const where = [];
  const params = [];
  if (type) { where.push('t.type = ?'); params.push(type); }
  if (search) { where.push('t.name like ?'); params.push(`%${search}%`); }

  return all(
    `select v.id, v.template_id, t.code as template_code, t.name as template_name,
            t.type as template_type, v.version_label, v.status, v.scoring_enabled,
            v.passing_score, v.effective_date, v.expiry_date, v.published_at,
            (select count(*) from questionnaire_section s where s.version_id = v.id) as section_count,
            (select count(*) from question q join questionnaire_section s on s.id = q.section_id
              where s.version_id = v.id) as question_count,
            (select count(*) from questionnaire_assignment a where a.version_id = v.id) as assignment_count
       from questionnaire_version v
       join questionnaire_template t on t.id = v.template_id
       ${where.length ? `where ${where.join(' and ')}` : ''}
       order by coalesce(v.published_at, v.created_at) desc`,
    ...params,
  ).map((r) => ({ ...r, scoring_enabled: Boolean(r.scoring_enabled) }));
}

/** Satu versi beserta seluruh seksi, pertanyaan, dan pilihannya. */
export function getVersion(user, versionId) {
  const version = one('select * from questionnaire_version where id = ?', versionId);
  if (!version) throw notFound('Versi tidak ditemukan.');

  // Pemasok hanya melihat versi yang ditugaskan kepadanya. Tanpa batas ini,
  // seluruh bank soal audit Paragon dapat diunduh siapa pun yang punya akun.
  if (!isInternal(user)) {
    const assigned = one(
      'select 1 from questionnaire_assignment where version_id = ? and supplier_id = ?',
      versionId, user.supplier_id,
    );
    if (!assigned) throw forbidden('Kuesioner ini tidak ditugaskan kepada Anda.');
  }

  const sections = all(
    'select * from questionnaire_section where version_id = ? order by sort_order', versionId,
  ).map((s) => ({
    ...s,
    mandatory: Boolean(s.mandatory),
    questions: all('select * from question where section_id = ? order by sort_order', s.id)
      .map((q) => ({
        ...q,
        required: Boolean(q.required),
        conditions: parseJson(q.conditions),
        validation: parseJson(q.validation, {}),
        attachment_rule: parseJson(q.attachment_rule),
        default_value: parseJson(q.default_value),
        options: all('select * from question_option where question_id = ? order by sort_order', q.id)
          .map((o) => ({ ...o, exclude_from_scoring: Boolean(o.exclude_from_scoring) })),
      })),
  }));

  return {
    ...version,
    scoring_enabled: Boolean(version.scoring_enabled),
    risk_bands: parseJson(version.risk_bands, []),
    template: one('select * from questionnaire_template where id = ?', version.template_id),
    sections,
  };
}

export function createTemplate(user, payload) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');

  return tx(() => {
    const templateId = uuid();
    const versionId = uuid();
    const scoring = Boolean(payload.scoringEnabled);

    run(
      `insert into questionnaire_template
         (id, code, name, type, description, target_supplier_type, material_type,
          owner_id, owner_name)
       values (?,?,?,?,?,?,?,?,?)`,
      templateId,
      payload.code || `QST-${uuid().slice(0, 6).toUpperCase()}`,
      payload.name, payload.type, payload.description ?? null,
      payload.targetSupplierType ?? null, payload.materialType ?? null,
      user.id, user.full_name,
    );

    run(
      `insert into questionnaire_version
         (id, template_id, version_label, status, scoring_enabled, passing_score)
       values (?,?,?, 'draft', ?, ?)`,
      versionId, templateId, payload.versionLabel || 'v1.0',
      scoring ? 1 : 0, scoring ? (payload.passingScore ?? 70) : null,
    );

    logAudit(user, 'questionnaire.created', 'template', templateId, null, payload);
    return { templateId, versionId };
  });
}

export function publishVersion(user, versionId) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');

  return tx(() => {
    const v = one('select * from questionnaire_version where id = ?', versionId);
    if (!v) throw notFound('Versi tidak ditemukan.');
    if (v.status !== 'draft') throw conflict('Hanya versi berstatus draft yang dapat diterbitkan.');

    const counts = one(
      `select (select count(*) from questionnaire_section where version_id = ?) as s,
              (select count(*) from question q join questionnaire_section s on s.id = q.section_id
                where s.version_id = ?) as q`, versionId, versionId,
    );
    if (!counts.s || !counts.q) {
      throw badRequest('Versi tanpa seksi atau tanpa pertanyaan tidak dapat diterbitkan.');
    }

    run(
      `update questionnaire_version
          set status = 'published', published_at = ?, published_by = ?, updated_at = ?
        where id = ?`,
      now(), user.id, now(), versionId,
    );

    logAudit(user, 'questionnaire.published', 'version', versionId);
    return one('select * from questionnaire_version where id = ?', versionId);
  });
}

/**
 * Versi baru dari versi yang ada.
 *
 * Isinya DISALIN, bukan dirujuk: v1.0 tetap utuh dan tetap melayani respons
 * lama, sementara v2.0 dapat disunting bebas.
 */
export function createNewVersion(user, sourceVersionId, versionLabel) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');

  return tx(() => {
    const src = one('select * from questionnaire_version where id = ?', sourceVersionId);
    if (!src) throw notFound('Versi sumber tidak ditemukan.');

    const newId = uuid();
    run(
      `insert into questionnaire_version
         (id, template_id, version_label, status, effective_date, expiry_date,
          estimated_minutes, scoring_enabled, passing_score, risk_bands)
       values (?,?,?, 'draft', ?,?,?,?,?,?)`,
      newId, src.template_id, versionLabel, src.effective_date, src.expiry_date,
      src.estimated_minutes, src.scoring_enabled, src.passing_score, src.risk_bands,
    );

    // Peta id lama → id baru, dipakai memetakan ulang acuan kondisi.
    const questionMap = new Map();

    for (const sec of all(
      'select * from questionnaire_section where version_id = ? order by sort_order',
      sourceVersionId,
    )) {
      const newSec = uuid();
      run(
        `insert into questionnaire_section
           (id, version_id, name, description, sort_order, mandatory, weight, library_item_id)
         values (?,?,?,?,?,?,?,?)`,
        newSec, newId, sec.name, sec.description, sec.sort_order,
        sec.mandatory, sec.weight, sec.library_item_id,
      );

      for (const q of all('select * from question where section_id = ? order by sort_order', sec.id)) {
        const newQ = uuid();
        questionMap.set(q.id, newQ);

        run(
          `insert into question
             (id, section_id, code, text, guidance, type_key, required, default_value,
              placeholder, help_text, weight, sort_order, conditions, validation,
              attachment_rule, library_item_id)
           values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          newQ, newSec, q.code, q.text, q.guidance, q.type_key, q.required,
          q.default_value, q.placeholder, q.help_text, q.weight, q.sort_order,
          q.conditions, q.validation, q.attachment_rule, q.library_item_id,
        );

        for (const o of all('select * from question_option where question_id = ?', q.id)) {
          run(
            `insert into question_option
               (id, question_id, label, value, score, exclude_from_scoring, sort_order)
             values (?,?,?,?,?,?,?)`,
            uuid(), newQ, o.label, o.value, o.score, o.exclude_from_scoring, o.sort_order,
          );
        }
      }
    }

    // Acuan kondisi menunjuk id pertanyaan versi lama. Tanpa pemetaan ini,
    // percabangan versi salinan akan menunjuk pertanyaan versi lama — tampak
    // benar sampai seseorang menyunting versi lamanya.
    const remap = (node) => {
      if (!node) return null;
      if (node.all) return { all: node.all.map(remap) };
      if (node.any) return { any: node.any.map(remap) };
      const mapped = questionMap.get(node.questionId);
      return mapped ? { ...node, questionId: mapped } : node;
    };

    for (const q of all(
      `select q.id, q.conditions from question q
         join questionnaire_section s on s.id = q.section_id
        where s.version_id = ? and q.conditions is not null`, newId,
    )) {
      run('update question set conditions = ? where id = ?',
        JSON.stringify(remap(parseJson(q.conditions))), q.id);
    }

    logAudit(user, 'questionnaire.version_created', 'version', newId,
      { from: sourceVersionId }, { label: versionLabel });
    return newId;
  });
}

/* ==================================================================== */
/* Penugasan                                                            */
/* ==================================================================== */

export function createAssignment(user, payload) {
  requireRole(user, 'procurement_staff', 'procurement_admin');

  return tx(() => {
    const s = one('select * from supplier where id = ?', payload.supplierId);
    if (!s) throw notFound('Pemasok tidak ditemukan.');

    // Kuesioner ditugaskan setelah profil tuntas dan dokumen lolos periksa;
    // lebih awal berarti meminta pemasok mengisi dua formulir sekaligus.
    if (!['qualification', 'awaiting_preferred', 'preferred'].includes(s.status)) {
      throw conflict(
        `Kuesioner hanya dapat ditugaskan kepada pemasok yang sudah lolos registrasi (status kini: ${s.status}).`,
      );
    }

    const id = uuid();
    run(
      `insert into questionnaire_assignment
         (id, version_id, supplier_id, supplier_site, material_category, material_name,
          due_date, reviewer_id, priority, instructions, assigned_by, assigned_by_name)
       values (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, payload.versionId, payload.supplierId, payload.supplierSite ?? null,
      payload.materialCategory ?? null, payload.materialName ?? null,
      payload.dueDate ?? null, payload.reviewerId ?? null,
      payload.priority ?? 'normal', payload.instructions ?? null,
      user.id, user.full_name,
    );

    // Respons dibuat bersama penugasan, berstatus Not Started.
    run('insert into questionnaire_response (id, assignment_id) values (?,?)', uuid(), id);

    logAudit(user, 'assignment.created', 'assignment', id, null, payload);
    notify({
      event: 'assignment.created', audience: 'supplier',
      title: 'Kuesioner baru ditugaskan',
      body: `Tenggat: ${payload.dueDate ?? 'tidak ditentukan'}`,
      link: '/portal/questionnaires', supplierId: payload.supplierId,
    });
    if (payload.reviewerId) {
      notify({
        event: 'assignment.reviewer_set', audience: 'internal',
        title: 'Anda ditunjuk sebagai peninjau',
        link: '/internal/tinjauan', supplierId: payload.supplierId,
        recipientId: payload.reviewerId,
      });
    }

    return one('select * from questionnaire_assignment where id = ?', id);
  });
}

export function listResponses(user, { supplierId, status, reviewerId, overdueOnly } = {}) {
  const where = [];
  const params = [];

  // Pemasok selalu dibatasi pada dirinya sendiri, apa pun filter yang dikirim.
  if (!isInternal(user)) {
    where.push('supplier_id = ?');
    params.push(user.supplier_id);
  } else if (supplierId) {
    where.push('supplier_id = ?');
    params.push(supplierId);
  }

  if (status?.length) {
    where.push(`status in (${status.map(() => '?').join(',')})`);
    params.push(...status);
  }
  if (reviewerId) { where.push('reviewer_id = ?'); params.push(reviewerId); }
  if (overdueOnly) where.push('overdue = 1');

  return all(
    `select * from v_response_overview
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by due_date is null, due_date`,
    ...params,
  ).map((r) => ({ ...r, overdue: Boolean(r.overdue), scoring_enabled: Boolean(r.scoring_enabled) }));
}

function loadResponseContext(user, responseId) {
  const ctx = one(
    `select r.*, a.supplier_id, a.reviewer_id, a.version_id
       from questionnaire_response r
       join questionnaire_assignment a on a.id = r.assignment_id
      where r.id = ?`, responseId,
  );
  if (!ctx) throw notFound('Kuesioner tidak ditemukan.');
  assertSupplierAccess(user, ctx.supplier_id);
  return ctx;
}

export function getResponse(user, responseId) {
  const ctx = loadResponseContext(user, responseId);

  return {
    ...ctx,
    answers: all('select * from response_answer where response_id = ?', responseId)
      .map((a) => ({
        ...a,
        value: parseJson(a.value),
        skipped: Boolean(a.skipped),
        needs_revision: Boolean(a.needs_revision),
        attachments: all(
          `select aa.*, f.file_name, f.file_size, f.mime_type
             from answer_attachment aa join file_object f on f.id = aa.file_id
            where aa.answer_id = ?`, a.id,
        ),
      })),
    reviews: all('select * from questionnaire_review where response_id = ? order by decided_at desc',
      responseId),
    comments: all('select * from review_comment where response_id = ? order by created_at',
      responseId),
    revisions: all(
      `select revision, score, risk_level, submitted_at, submitted_by
         from response_revision where response_id = ? order by revision desc`, responseId,
    ),
  };
}

/* ==================================================================== */
/* Pengisian                                                            */
/* ==================================================================== */

/** answers: { [questionId]: value } — simpan draf, sebagian. */
export function saveAnswers(user, responseId, answers) {
  requireRole(user, 'supplier');
  const ctx = loadResponseContext(user, responseId);

  if (!['not_started', 'in_progress', 'revision_required'].includes(ctx.status)) {
    throw conflict(`Kuesioner berstatus ${ctx.status} tidak dapat disunting.`);
  }

  return tx(() => {
    let saved = 0;

    for (const [questionId, value] of Object.entries(answers ?? {})) {
      // Saat revisi, pemasok HANYA dapat menyunting pertanyaan yang ditandai
      // peninjau. Jawaban lain terkunci.
      if (ctx.status === 'revision_required') {
        const flagged = one(
          `select 1 from response_answer
            where response_id = ? and question_id = ? and needs_revision = 1`,
          responseId, questionId,
        );
        if (!flagged) throw forbidden(`Pertanyaan ${questionId} tidak ditandai untuk direvisi.`);
      }

      run(
        `insert into response_answer (id, response_id, question_id, value, updated_at)
         values (?,?,?,?,?)
         on conflict(response_id, question_id) do update set
           value = excluded.value, skipped = 0, updated_at = excluded.updated_at`,
        uuid(), responseId, questionId, JSON.stringify(value ?? null), now(),
      );
      saved += 1;
    }

    run(
      `update questionnaire_response
          set status = case when status = 'not_started' then 'in_progress' else status end,
              started_at = coalesce(started_at, ?),
              completion_percent = ?, updated_at = ?
        where id = ?`,
      now(), computeCompletion(responseId), now(), responseId,
    );

    return { completionPercent: computeCompletion(responseId), saved };
  });
}

export function precheckResponse(user, responseId) {
  loadResponseContext(user, responseId);
  const blockers = submissionBlockers(responseId);
  return { ready: blockers.length === 0, blockers, completion: computeCompletion(responseId) };
}

export function submitResponse(user, responseId) {
  requireRole(user, 'supplier');
  const ctx = loadResponseContext(user, responseId);

  return tx(() => {
    // Pengiriman ulang tertahan bila jawaban bertanda belum benar-benar berubah.
    if (ctx.status === 'revision_required') {
      const lastReview = one(
        'select max(decided_at) as at from questionnaire_review where response_id = ?', responseId,
      );
      const changed = one(
        `select count(*) as n from response_answer
          where response_id = ? and needs_revision = 1 and updated_at > ?`,
        responseId, lastReview?.at ?? '',
      );
      if (!changed.n) {
        throw conflict('Belum ada jawaban bertanda yang diubah; tidak ada yang dikirim ulang.');
      }
    }

    const blockers = submissionBlockers(responseId);
    if (blockers.length) {
      throw badRequest(`Kuesioner belum dapat dikirim: ${blockers.join(' | ')}`);
    }

    const score = computeScore(responseId);
    const risk = classifyRisk(responseId, score);

    // Putaran ini disimpan sebagai riwayat sebelum statusnya berpindah.
    const snapshot = {
      answers: answerMap(responseId),
      attachments: Object.fromEntries(
        all('select * from response_answer where response_id = ?', responseId).map((a) => [
          a.question_id,
          all('select file_id, expiry_date from answer_attachment where answer_id = ?', a.id),
        ]).filter(([, list]) => list.length),
      ),
    };

    run(
      `insert into response_revision
         (id, response_id, revision, snapshot, score, risk_level, submitted_at, submitted_by)
       values (?,?,?,?,?,?,?,?)
       on conflict(response_id, revision) do nothing`,
      uuid(), responseId, ctx.current_revision, JSON.stringify(snapshot),
      score, risk, now(), user.full_name,
    );

    run(
      `update questionnaire_response
          set status = 'submitted', submitted_at = ?, completion_percent = ?,
              score = ?, risk_level = ?, updated_at = ?
        where id = ?`,
      now(), computeCompletion(responseId), score, risk, now(), responseId,
    );

    logAudit(user, 'response.submitted', 'response', responseId, null, { score, risk });
    notify({
      event: 'response.submitted', audience: 'internal',
      title: 'Kuesioner dikirim pemasok', body: 'Menunggu tinjauan.',
      link: '/internal/tinjauan', supplierId: ctx.supplier_id, recipientId: ctx.reviewer_id,
    });

    return one('select * from questionnaire_response where id = ?', responseId);
  });
}

/* ==================================================================== */
/* Tinjauan                                                             */
/* ==================================================================== */

export function claimReview(user, responseId) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');

  const r = one('select * from questionnaire_response where id = ?', responseId);
  if (r?.status !== 'submitted') throw conflict('Kuesioner ini tidak sedang menunggu tinjauan.');

  run("update questionnaire_response set status = 'under_review', updated_at = ? where id = ?",
    now(), responseId);
  logAudit(user, 'response.claimed', 'response', responseId);

  return one('select * from questionnaire_response where id = ?', responseId);
}

/** flags: [{ questionId, note }] — wajib untuk request_revision */
export function reviewResponse(user, responseId, decision, summary = null, flags = []) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');

  if (!['approve', 'reject', 'request_revision'].includes(decision)) {
    throw badRequest('Keputusan tidak dikenal.');
  }

  return tx(() => {
    const ctx = one(
      `select r.*, a.supplier_id from questionnaire_response r
         join questionnaire_assignment a on a.id = r.assignment_id where r.id = ?`, responseId,
    );
    if (!ctx) throw notFound('Kuesioner tidak ditemukan.');
    if (!['submitted', 'under_review'].includes(ctx.status)) {
      throw conflict('Hanya kuesioner yang sudah dikirim yang dapat ditinjau.');
    }
    if (decision === 'request_revision' && flags.length === 0) {
      throw badRequest('Permintaan revisi harus menandai setidaknya satu pertanyaan.');
    }

    const reviewId = uuid();
    run(
      `insert into questionnaire_review
         (id, response_id, revision, decision, summary, reviewer_id, reviewer_name)
       values (?,?,?,?,?,?,?)`,
      reviewId, responseId, ctx.current_revision, decision, summary, user.id, user.full_name,
    );

    // Tanda revisi lama dibersihkan lebih dulu supaya putaran sebelumnya tidak
    // membuka pertanyaan yang kali ini sudah diterima.
    run(`update response_answer set needs_revision = 0, revision_note = null
          where response_id = ?`, responseId);

    if (decision === 'request_revision') {
      for (const flag of flags) {
        run(
          `update response_answer set needs_revision = 1, revision_note = ?
            where response_id = ? and question_id = ?`,
          flag.note ?? null, responseId, flag.questionId,
        );
        run(
          `insert into review_comment
             (id, review_id, response_id, question_id, body, author_id, author_name)
           values (?,?,?,?,?,?,?)`,
          uuid(), reviewId, responseId, flag.questionId, flag.note ?? '',
          user.id, user.full_name,
        );
      }
    }

    const nextStatus = decision === 'approve' ? 'approved'
      : decision === 'reject' ? 'rejected' : 'revision_required';

    run(
      `update questionnaire_response
          set status = ?, current_revision = current_revision + ?, updated_at = ?
        where id = ?`,
      nextStatus, decision === 'request_revision' ? 1 : 0, now(), responseId,
    );

    logAudit(user, `response.${decision}`, 'response', responseId, null, { summary });
    notify({
      event: `response.${decision}`, audience: 'supplier',
      title: decision === 'approve' ? 'Kuesioner Anda disetujui'
        : decision === 'reject' ? 'Kuesioner Anda ditolak'
        : 'Kuesioner Anda perlu direvisi',
      body: summary, link: '/portal/questionnaires', supplierId: ctx.supplier_id,
    });

    return one('select * from questionnaire_response where id = ?', responseId);
  });
}

export function dashboard(user) {
  requireRole(user, 'procurement_staff', 'procurement_admin', 'procurement_manager');
  return {
    kpi: one('select * from v_questionnaire_kpi'),
    riskDistribution: all('select * from v_risk_distribution'),
  };
}

/** Menandai respons yang jauh lewat tenggat. Dipanggil penjadwal. */
export function expireOverdueResponses() {
  const limit = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const result = run(
    `update questionnaire_response
        set status = 'expired', updated_at = ?
      where status in ('not_started','in_progress')
        and assignment_id in (
          select id from questionnaire_assignment
           where due_date is not null and due_date < ?)`,
    now(), limit,
  );
  return result.changes;
}
