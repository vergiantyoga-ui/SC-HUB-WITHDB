/**
 * Uji alur end-to-end.
 *
 * Padanan `supabase/tests/01_flow_test.sql` pada versi Postgres, dan padanan
 * `scripts/registration-e2e.jsx` pada frontend: memanggil service berurutan
 * seperti pengguna menekan tombol, lalu memeriksa keadaan yang dihasilkan.
 *
 * Termasuk yang seharusnya GAGAL. Sejak RLS hilang bersama Postgres, seluruh
 * otorisasi bergantung pada guard di dalam kode — jadi pemeriksaan negatif di
 * sini bukan pelengkap, melainkan satu-satunya jaring yang tersisa.
 *
 *   npm test
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.JWT_SECRET ??= 'a'.repeat(64);
process.env.DB_FILE = join(tmpdir(), `paragon-test-${Date.now()}.db`);
process.env.DISABLE_JOBS = 'true';

const { closeDatabase, one, all, run } = await import('../src/db/index.js');
const { seed } = await import('../src/db/seed.js');
const suppliers = await import('../src/services/suppliers.js');
const q = await import('../src/services/questionnaire.js');
const { loadUser } = await import('../src/lib/core.js');

let staff; let admin; let manager; let supplierUser; let otherSupplier;

const byEmail = (email) => loadUser(one('select id from app_user where email = ?', email).id);

before(() => {
  seed();
  staff = byEmail('dewi.anggraini@paragon-corp.com');
  admin = byEmail('rangga.prasetyo@paragon-corp.com');
  manager = byEmail('lestari.handayani@paragon-corp.com');
  supplierUser = byEmail('hendra.w@kimiaprima.co.id');
  otherSupplier = byEmail('siti.a@kartonsejati.co.id');
});

after(() => {
  closeDatabase();
  rmSync(process.env.DB_FILE, { force: true });
  rmSync(`${process.env.DB_FILE}-wal`, { force: true });
  rmSync(`${process.env.DB_FILE}-shm`, { force: true });
});

const refId = (reference) => one('select id from supplier where reference = ?', reference).id;

describe('Jalur A — undangan', () => {
  let newId;

  it('pendaftaran mandiri membuat pemasok dengan referensi berformat', () => {
    const result = suppliers.registerSupplier({
      general: {
        vendorName: 'PT Uji Coba Mandiri', companyEmail: 'halo@ujicoba.co.id',
        legalStatus: 'Z2', entityType: '0001', vendorType: '0001',
        vendorTypeDetail: '0003', otvStatus: 'C1', vendorDirectType: 'Z002',
        targetCompanies: ['Paragon Corp Indonesia'],
      },
      address: { street: 'Jl. Uji No. 1', country: 'Indonesia', city: 'Jakarta' },
      contact: { name: 'Budi Santoso', email: 'budi@ujicoba.co.id' },
    });

    newId = result.supplierId;
    assert.match(result.reference, /^SUP-\d{4}-\d{4}$/);
  });

  it('Paragon Corp Indonesia menghasilkan enam kode korporat', () => {
    const n = one(
      'select count(*) as n from supplier_target_company where supplier_id = ?', newId).n;
    assert.equal(n, 6);
  });

  it('lini masa terisi sejak pendaftaran', () => {
    assert.ok(one('select 1 as x from supplier_timeline where supplier_id = ?', newId));
  });

  it('pemasok tidak dapat menyetujui pendaftaran', () => {
    assert.throws(() => suppliers.approveSubmission(supplierUser, newId), /tidak berwenang/i);
  });

  it('staf menyetujui lalu mengundang', () => {
    suppliers.approveSubmission(staff, newId);
    const invite = suppliers.inviteSupplier(staff, newId);

    assert.match(invite.accountId, /^SUP-[A-Z]{3}-\d{4}$/);
    assert.match(invite.inviteToken, /^pgn-inv-/);
    assert.equal(one('select status from supplier where id = ?', newId).status, 'invited');
  });

  it('kata sandi sementara berlaku tujuh hari', async () => {
    const { passwordExpiresAt } = await import('../src/lib/core.js');
    const acc = one('select * from supplier_account where supplier_id = ?', newId);
    const days = (new Date(passwordExpiresAt(acc)) - new Date(acc.email_sent_at)) / 86_400_000;
    assert.equal(days, 7);
  });

  it('jalur terkunci setelah dipilih', () => {
    assert.throws(
      () => suppliers.startInternalRegistration(staff, newId, 'email'),
      /hanya dapat dimulai dari status approved/i,
    );
  });

  it('undangan kedua ditolak', () => {
    assert.throws(() => suppliers.inviteSupplier(staff, newId), /sudah punya akun portal/i);
  });

  describe('kelengkapan profil', () => {
    it('bagian belum lengkap tetap tersimpan dan menyebutkan yang kurang', () => {
      const result = suppliers.saveProfileSection(staff, newId, 'tax', {
        taxName: 'PT Uji Coba Mandiri', taxAddress: 'Jl. Uji No. 1',
        nik: '3175094401900002', npwp: '012345678901234',
        transactionType: 'T01', tin: 'TIN-1', brn: 'BRN-1', gstNumber: 'GST-1',
      });

      assert.equal(result.completed, false);
      assert.ok(result.errors.some((e) => e.includes('SIUP')));
    });

    it('NPWP 15 digit dinormalkan menjadi 16', () => {
      assert.equal(one('select npwp from supplier_tax where supplier_id = ?', newId).npwp,
        '0012345678901234');
    });

    it('penanda e-invoice dihitung, tidak disimpan', () => {
      const row = one('select * from v_supplier_tax where supplier_id = ?', newId);
      assert.equal(row.e_invoice_provided, 1);
      assert.ok(!('e_invoice_provided' in
        one('select * from supplier_tax where supplier_id = ?', newId)));
    });

    it('alasan tanpa DoE diminta selama DoE belum ada', () => {
      const result = suppliers.saveProfileSection(staff, newId, 'documents',
        { files: {}, reasonNoDoe: '' });
      assert.ok(result.errors.some((e) => e.includes('Deed of Establishment')));
    });

    it('kontak tanpa penanda utama ditolak', () => {
      assert.throws(
        () => suppliers.saveProfileSection(staff, newId, 'contacts', [
          { name: 'A', email: 'a@x.co' }, { name: 'B', email: 'b@x.co' },
        ]),
        /kontak utama/i,
      );
    });

    it('lebih dari sepuluh kontak ditolak', () => {
      const many = Array.from({ length: 11 }, (_, i) => ({
        name: `Kontak ${i}`, email: `k${i}@x.co`, isPrimary: i === 0,
      }));
      assert.throws(() => suppliers.saveProfileSection(staff, newId, 'contacts', many),
        /maksimal 10 kontak/i);
    });
  });
});

describe('Verifikasi dokumen', () => {
  it('permintaan perbaikan memindahkan status dan mencatat butirnya', () => {
    const id = refId('SUP-2026-0131');
    suppliers.requestDocumentFix(staff, id, [
      { sectionId: 'documents', note: 'NIB tidak terbaca' },
    ]);

    assert.equal(one('select status from supplier where id = ?', id).status,
      'needs_document_fix');
    assert.equal(
      one(`select count(*) as n from supplier_verification_note n
             join supplier_verification v on v.id = n.verification_id
            where v.supplier_id = ?`, id).n,
      1,
    );
  });

  it('permintaan perbaikan tanpa catatan ditolak', () => {
    assert.throws(() => suppliers.requestDocumentFix(staff, refId('SUP-2026-0131'), []),
      /setidaknya satu catatan/i);
  });

  it('pemasok mengirim ulang dokumennya', () => {
    const user = loadUser(
      one('select id from app_user where supplier_id = ?', refId('SUP-2026-0131')).id);
    suppliers.resubmitDocuments(user);
    assert.equal(one('select status from supplier where reference = ?', 'SUP-2026-0131').status,
      'registration');
  });
});

describe('Kualifikasi', () => {
  it('pemasok yang belum mengirim profil belum layak dikualifikasi', () => {
    const pending = refId('SUP-2026-0148');
    assert.throws(() => suppliers.saveQualification(staff, pending, [], 'draft'),
      /belum layak dikualifikasi/i);
  });

  it('pasangan komoditas–negara berulang ditolak', () => {
    const id = refId('SUP-2026-0135');
    const code = one("select code from md_unspsc_commodity where segment_code = '12' limit 1").code;

    assert.throws(
      () => suppliers.saveQualification(staff, id, [
        { commodityCode: code, countryCode: 'ID' },
        { commodityCode: code, countryCode: 'ID' },
      ], 'completed'),
      /sudah terdaftar/i,
    );
  });

  it('menyimpan dua baris kualifikasi', () => {
    const id = refId('SUP-2026-0135');
    const codes = all("select code from md_unspsc_commodity where segment_code = '12' limit 2");

    const result = suppliers.saveQualification(staff, id, [
      { commodityCode: codes[0].code, countryCode: 'ID', notes: 'pasokan utama' },
      { commodityCode: codes[1].code, countryCode: 'MY' },
    ], 'completed');

    assert.equal(result.lineCount, 2);
  });

  it('kualifikasi tidak dapat diselesaikan tanpa satu pun baris', () => {
    assert.throws(() => suppliers.saveQualification(staff, refId('SUP-2026-0135'), [], 'completed'),
      /tanpa satu pun baris/i);
  });
});

describe('Preferred supplier', () => {
  const id = () => refId('SUP-2026-0135');

  it('pengajuan memindahkan status ke awaiting_preferred', () => {
    const codes = all("select code from md_unspsc_commodity where segment_code = '12' limit 2");
    suppliers.saveQualification(staff, id(), [
      { commodityCode: codes[0].code, countryCode: 'ID' },
    ], 'completed');

    suppliers.submitForPreferred(staff, id());
    assert.equal(one('select status from supplier where id = ?', id()).status,
      'awaiting_preferred');
  });

  it('staf tidak dapat memutuskan preferred', () => {
    assert.throws(() => suppliers.decidePreferred(staff, id(), 'approved', 'ok'),
      /tidak berwenang/i);
  });

  it('diskualifikasi tanpa alasan ditolak', () => {
    assert.throws(() => suppliers.decidePreferred(manager, id(), 'disqualified', '  '),
      /alasan diskualifikasi wajib/i);
  });

  it('manager mendiskualifikasi', () => {
    suppliers.decidePreferred(manager, id(), 'disqualified',
      'Kapasitas produksi belum memenuhi proyeksi kebutuhan.');
    assert.equal(one('select status from supplier where id = ?', id()).status, 'disqualified');
  });

  it('diskualifikasi bukan jalan buntu', () => {
    suppliers.reopenQualification(manager, id());
    assert.equal(one('select status from supplier where id = ?', id()).status, 'qualification');
  });

  it('keputusan lama tetap tersimpan sebagai riwayat', () => {
    const n = one('select count(*) as n from supplier_preferred_decision where supplier_id = ?',
      id()).n;
    assert.ok(n >= 1);
  });

  it('keputusan tidak dapat ditulis ulang', () => {
    const row = one('select * from supplier_preferred_decision where supplier_id = ?', id());
    assert.throws(
      () => run('update supplier_preferred_decision set note = ? where id = ?', 'diubah', row.id),
      /tidak dapat diubah/i,
    );
  });
});

describe('Questionnaire', () => {
  const responseId = () => one(
    `select r.id from questionnaire_response r
       join questionnaire_assignment a on a.id = r.assignment_id
       join questionnaire_version v on v.id = a.version_id
       join questionnaire_template t on t.id = v.template_id
      where t.code = 'QST-AUDIT'`).id;

  const questionByCode = (code) => one('select id from question where code = ?', code).id;

  it('pertanyaan bersyarat tersembunyi saat ISO dijawab ya', () => {
    const visible = q.visibleQuestions(responseId()).map((x) => x.code);
    assert.ok(!visible.includes('q_audit_iso_plan'));
  });

  it('pertanyaan bersyarat muncul saat ISO dijawab tidak', () => {
    q.saveAnswers(supplierUser, responseId(), { [questionByCode('q_audit_iso')]: 'no' });
    const visible = q.visibleQuestions(responseId()).map((x) => x.code);
    assert.ok(visible.includes('q_audit_iso_plan'));
  });

  it('prapemeriksaan menyebut pertanyaan yang kurang, bukan sekadar menolak', () => {
    const { ready, blockers } = q.precheckResponse(supplierUser, responseId());
    assert.equal(ready, false);
    assert.ok(blockers.some((b) => b.includes('belum dijawab')));
  });

  it('pengiriman tertahan sampai prapemeriksaan lolos', () => {
    assert.throws(() => q.submitResponse(supplierUser, responseId()),
      /belum dapat dikirim/i);
  });

  it('aturan lampiran per pertanyaan ditegakkan', () => {
    q.saveAnswers(supplierUser, responseId(), {
      [questionByCode('q_audit_iso')]: 'yes',
      [questionByCode('q_audit_qms_doc')]: 'yes',
      [questionByCode('q_audit_gmp_score')]: '5',
      [questionByCode('q_audit_halal')]: 'na',
    });

    const { blockers } = q.precheckResponse(supplierUser, responseId());
    assert.ok(blockers.some((b) => b.includes('lampiran wajib')));
  });

  it('jawaban sempurna dengan satu N/A tetap bernilai 100', () => {
    // N/A keluar dari pembilang MAUPUN penyebut; menjawab N/A tidak menghukum.
    assert.equal(q.computeScore(responseId()), 100);
  });

  it('skor turun saat jawaban memburuk', () => {
    q.saveAnswers(supplierUser, responseId(), { [questionByCode('q_audit_gmp_score')]: '1' });
    assert.ok(q.computeScore(responseId()) < 100);
  });

  it('kelengkapan hanya menghitung pertanyaan yang tampak', () => {
    const visible = q.visibleQuestions(responseId()).length;
    const total = one(
      `select count(*) as n from question qq
         join questionnaire_section s on s.id = qq.section_id
         join questionnaire_assignment a on a.version_id = s.version_id
         join questionnaire_response r on r.assignment_id = a.id
        where r.id = ?`, responseId()).n;

    assert.ok(visible < total, 'sebagian pertanyaan harus tersembunyi');
    assert.ok(q.computeCompletion(responseId()) <= 100);
  });

  it('pemasok lain tidak dapat menyunting kuesioner ini', () => {
    assert.throws(() => q.saveAnswers(otherSupplier, responseId(), {}),
      /data perusahaan Anda sendiri/i);
  });

  it('pemasok lain tidak dapat membacanya', () => {
    assert.throws(() => q.getResponse(otherSupplier, responseId()),
      /data perusahaan Anda sendiri/i);
  });

  it('pemasok tidak dapat meninjau kuesionernya sendiri', () => {
    assert.throws(() => q.reviewResponse(supplierUser, responseId(), 'approve'),
      /tidak berwenang/i);
  });

  it('isi versi terbit tidak dapat diubah', () => {
    assert.throws(
      () => run('update question set text = ? where code = ?', 'diubah', 'q_audit_legal'),
      /bukan draft/i,
    );
  });

  it('versi terbit tidak dapat dihapus', () => {
    const v = one("select id from questionnaire_version where status = 'published' limit 1");
    assert.throws(() => run('delete from questionnaire_version where id = ?', v.id),
      /tidak dapat dihapus/i);
  });

  it('versi baru menyalin isi dan memetakan ulang acuan kondisi', () => {
    const source = one(
      `select v.id from questionnaire_version v
         join questionnaire_template t on t.id = v.template_id
        where t.code = 'QST-AUDIT'`).id;

    const newVersion = q.createNewVersion(admin, source, 'v2.0');
    const copied = one(
      `select q.conditions from question q
         join questionnaire_section s on s.id = q.section_id
        where s.version_id = ? and q.code = 'q_audit_iso_plan'`, newVersion);

    const target = JSON.parse(copied.conditions).all[0].questionId;
    const belongsToNewVersion = one(
      `select 1 as x from question q join questionnaire_section s on s.id = q.section_id
        where q.id = ? and s.version_id = ?`, target, newVersion);

    assert.ok(belongsToNewVersion, 'acuan kondisi harus menunjuk pertanyaan versi baru');
  });

  it('versi draf tidak dapat ditugaskan', () => {
    const draft = one(
      `select v.id from questionnaire_version v
         join questionnaire_template t on t.id = v.template_id
        where t.code = 'QST-HALAL'`).id;

    assert.throws(
      () => q.createAssignment(staff, {
        versionId: draft, supplierId: refId('SUP-2026-0118'), materialName: 'X',
      }),
      /published/i,
    );
  });

  it('kuesioner tidak dapat ditugaskan sebelum pemasok lolos registrasi', () => {
    const published = one("select id from questionnaire_version where status = 'published' limit 1").id;
    assert.throws(
      () => q.createAssignment(staff, {
        versionId: published, supplierId: refId('SUP-2026-0148'), materialName: 'Y',
      }),
      /lolos registrasi/i,
    );
  });
});

describe('Jejak audit', () => {
  it('tindakan penting tercatat', () => {
    assert.ok(one('select count(*) as n from audit_log').n > 5);
  });

  it('jejak audit tidak dapat dihapus', () => {
    const row = one('select id from audit_log limit 1');
    assert.throws(() => run('delete from audit_log where id = ?', row.id), /append-only/i);
  });

  it('lini masa tidak dapat disunting', () => {
    const row = one('select id from supplier_timeline limit 1');
    assert.throws(() => run('update supplier_timeline set label = ? where id = ?', 'x', row.id),
      /append-only/i);
  });
});

describe('Kredensial', () => {
  it('kata sandi tidak pernah tersimpan dalam bentuk terbaca', () => {
    const rows = all('select password_hash from app_user where password_hash is not null');
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.match(r.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      assert.ok(!r.password_hash.includes('Paragon'));
    }
  });

  it('kata sandi benar dan salah dibedakan', async () => {
    const { verifyPassword } = await import('../src/lib/core.js');
    const row = one('select password_hash from app_user where email = ?',
      'dewi.anggraini@paragon-corp.com');

    assert.equal(verifyPassword('Paragon#2026', row.password_hash), true);
    assert.equal(verifyPassword('Paragon#2027', row.password_hash), false);
  });

  it('token dengan tanda tangan dipalsukan ditolak', async () => {
    const { issueToken, verifyToken } = await import('../src/lib/core.js');
    const token = issueToken(staff);

    assert.ok(verifyToken(token));

    const [h, p] = token.split('.');
    assert.equal(verifyToken(`${h}.${p}.tandaTanganPalsu`), null);

    // Celah klasik "alg: none": header diganti, tanda tangan dikosongkan.
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64url');
    assert.equal(verifyToken(`${noneHeader}.${p}.`), null);
  });
});
