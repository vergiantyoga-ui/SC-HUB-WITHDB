import { all, now, one, run } from './db/index.js';
import { notify, passwordExpiresAt } from './lib/core.js';
import { expireOverdueResponses } from './services/questionnaire.js';

/**
 * Pekerjaan terjadwal.
 *
 * Di Supabase ini pg_cron. Di sini cukup setInterval di dalam proses server —
 * dan itu memang cukup selama servernya satu. Kalau kelak dijalankan lebih
 * dari satu instance, penjadwal ini harus dipisah ke satu proses tersendiri,
 * atau ketiga pekerjaan akan berjalan berkali-kali lipat.
 */
const HOUR = 60 * 60 * 1000;

export function notifyExpiringDocuments(days = 30) {
  let sent = 0;
  for (const row of all(
    `select * from v_supplier_expiring_documents where days_left between 0 and ?`, days,
  )) {
    // Tidak mengirim ulang notifikasi yang sama dalam tujuh hari terakhir.
    const recent = one(
      `select 1 from notification
        where event = 'document.expiring' and supplier_id = ?
          and json_extract(payload, '$.docKey') = ?
          and created_at > datetime('now', '-7 days')`,
      row.supplier_id, row.doc_key,
    );
    if (recent) continue;

    notify({
      event: 'document.expiring', audience: 'supplier',
      title: `${row.doc_label} akan kedaluwarsa`,
      body: `Masa berlaku berakhir ${row.expires_on} (${row.days_left} hari lagi).`,
      link: '/portal/profil', supplierId: row.supplier_id,
      payload: { docKey: row.doc_key, expiresOn: row.expires_on },
    });
    sent += 1;
  }
  return sent;
}

export function notifyPasswordExpiry() {
  let sent = 0;
  for (const acc of all('select * from supplier_account where password_changed = 0')) {
    const expiry = passwordExpiresAt(acc);
    if (!expiry) continue;
    const hoursLeft = (new Date(expiry) - Date.now()) / HOUR;
    if (hoursLeft < 0 || hoursLeft > 48) continue;

    notify({
      event: 'account.password_expiring', audience: 'supplier',
      title: 'Kata sandi sementara akan habis',
      body: `Segera ganti kata sandi untuk akun ${acc.account_id}.`,
      link: '/ganti-sandi', supplierId: acc.supplier_id,
    });
    sent += 1;
  }
  return sent;
}

/** Membersihkan sesi yang sudah lewat masa berlakunya. */
export function pruneSessions() {
  return run('delete from user_session where expires_at < ?', now()).changes;
}

export function runDailyJobs() {
  return {
    expired: expireOverdueResponses(),
    expiringDocuments: notifyExpiringDocuments(30),
    passwordExpiry: notifyPasswordExpiry(),
    prunedSessions: pruneSessions(),
  };
}

export function startScheduler() {
  if (process.env.DISABLE_JOBS === 'true') return;
  // Dijalankan sekali saat mulai, lalu tiap enam jam. Tidak perlu tepat waktu:
  // semuanya idempoten dan menahan pengiriman ulang sendiri.
  setTimeout(() => runDailyJobs(), 10_000);
  setInterval(() => runDailyJobs(), 6 * HOUR).unref?.();
}
