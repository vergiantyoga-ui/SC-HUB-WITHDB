import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let db;

/**
 * Membuka basis data.
 *
 * Empat pragma yang tidak boleh dilewatkan:
 *
 * `journal_mode = WAL` — tanpa ini, satu penulisan mengunci seluruh berkas dan
 * pembaca ikut terhenti. Dengan WAL, pembaca tidak pernah memblokir penulis
 * dan sebaliknya. Ini yang membuat SQLite layak melayani aplikasi web sama
 * sekali.
 *
 * `busy_timeout` — SQLite hanya mengizinkan satu penulis pada satu waktu.
 * Tanpa timeout, permintaan kedua langsung gagal dengan SQLITE_BUSY; dengan
 * timeout, ia menunggu giliran. Lima detik cukup longgar untuk beban kantor,
 * dan cukup pendek untuk tidak menggantung permintaan HTTP.
 *
 * `foreign_keys = on` — SQLite mematikan penegakan foreign key secara bawaan,
 * demi kompatibilitas mundur. Dibiarkan mati, seluruh REFERENCES di skema
 * hanya jadi dokumentasi.
 *
 * `synchronous = NORMAL` — aman dipakai bersama WAL, dan jauh lebih cepat
 * daripada FULL.
 */
export function openDatabase(file = process.env.DB_FILE ?? join(here, '../../data/paragon.db')) {
  mkdirSync(dirname(file), { recursive: true });

  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  return db;
}

export function getDb() {
  if (!db) openDatabase();
  return db;
}

export function closeDatabase() {
  if (db) { db.close(); db = undefined; }
}

/* ------------------------------------------------------------------ */
/* Migrasi                                                             */
/* ------------------------------------------------------------------ */

/**
 * Menjalankan berkas SQL di db/sql/ berurutan, sekali saja masing-masing.
 *
 * Tabel `schema_migration` mencatat yang sudah dijalankan. Ini pengganti
 * `supabase db push`: tidak ada CLI, tidak ada layanan — cukup jalankan
 * `npm run db:migrate` dan berkas basis data menyusul ke keadaan terbaru.
 */
export function migrate(target = getDb()) {
  target.exec(`
    create table if not exists schema_migration (
      name       text primary key,
      applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);

  const applied = new Set(
    target.prepare('select name from schema_migration').all().map((r) => r.name),
  );

  const dir = join(here, 'sql');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(dir, file), 'utf8');

    // Satu berkas = satu transaksi. Migrasi yang gagal di tengah tidak
    // meninggalkan skema separuh jadi.
    const run = target.transaction(() => {
      target.exec(sql);
      target.prepare('insert into schema_migration (name) values (?)').run(file);
    });

    run();
    ran.push(file);
  }

  return ran;
}

/* ------------------------------------------------------------------ */
/* Pembantu kueri                                                      */
/* ------------------------------------------------------------------ */

export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);

/** ISO 8601 beberapa hari dari sekarang. */
export function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Menjalankan fungsi di dalam transaksi.
 *
 * Ini pengganti jaminan yang dulu diberikan RPC di Postgres: satu transisi
 * status menyentuh status pemasok, lini masa, jejak audit, dan notifikasi —
 * dan keempatnya harus terjadi bersamaan atau tidak sama sekali.
 */
export function tx(fn) {
  return getDb().transaction(fn)();
}

export const one = (sql, ...params) => getDb().prepare(sql).get(...params);
export const all = (sql, ...params) => getDb().prepare(sql).all(...params);
export const run = (sql, ...params) => getDb().prepare(sql).run(...params);

/** Membaca kolom JSON menjadi objek JavaScript. */
export const parseJson = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

/** Menaikkan penghitung dan mengembalikan nilai barunya. */
export function nextCounter(name) {
  run('update counter set value = value + 1 where name = ?', name);
  return one('select value from counter where name = ?', name).value;
}

/** SUP-2026-0148 */
export function nextSupplierReference() {
  const n = nextCounter('supplier_reference');
  return `SUP-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
}

/**
 * SQLite menyimpan boolean sebagai 0/1. Mengubahnya kembali di batas API
 * supaya klien menerima true/false seperti dulu, dan tidak ada komponen React
 * yang perlu tahu bahwa basis datanya berganti.
 */
export function toBool(row, ...fields) {
  if (!row) return row;
  for (const f of fields) if (f in row) row[f] = Boolean(row[f]);
  return row;
}
