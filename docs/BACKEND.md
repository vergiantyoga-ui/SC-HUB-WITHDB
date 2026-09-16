# Backend — Node + SQLite

Backend untuk `paragon-hub`. Sebelumnya dibangun di atas Supabase dan
PostgreSQL; kini SQLite, dengan server Node yang menyediakan sendiri hal-hal
yang dulu diberikan Supabase.

```
server/
├── package.json
├── src/
│   ├── index.js              titik masuk: migrasi, penjadwal, server
│   ├── app.js                rute HTTP, autentikasi, penyimpanan berkas
│   ├── jobs.js               pekerjaan terjadwal
│   ├── db/
│   │   ├── index.js          koneksi, pragma, migrasi, pembantu kueri
│   │   ├── seed.js           data contoh
│   │   └── sql/              001 skema, 002 master data, 003 data acuan
│   ├── lib/core.js           galat, kata sandi, token, guard otorisasi, audit
│   └── services/
│       ├── suppliers.js      pendaftaran, onboarding, profil, kualifikasi
│       └── questionnaire.js  mesin + template + respons + tinjauan
└── tests/flow.test.js        50 pemeriksaan alur end-to-end
```

---

## Menjalankan

```bash
npm run server:install

# JWT_SECRET wajib. Hasilkan sekali, simpan di server/.env:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run db:seed      # migrasi + data contoh
npm run server       # http://localhost:3001
```

Front-end di terminal lain:

```bash
npm run dev          # http://localhost:5173
```

| Perintah | Isi |
|---|---|
| `npm run db:migrate` | Menjalankan migrasi yang belum pernah dijalankan |
| `npm run db:seed` | Migrasi lalu isi data contoh |
| `npm run db:reset` | Hapus basis data dan unggahan, mulai dari kosong |
| `npm run server:test` | 50 pemeriksaan alur end-to-end |

Basis data adalah satu berkas di `server/data/paragon.db`. Menyalinnya berarti
menyalin seluruh keadaan aplikasi; menghapusnya berarti memulai dari nol.

---

## Apa yang berubah dari versi Supabase

Supabase bukan sekadar Postgres. Ia juga API, autentikasi, penyimpanan berkas,
penjadwal, dan — yang paling penting — Row Level Security. SQLite hanya
menyediakan basis data. Sisanya ditulis sendiri:

| Dulu | Sekarang |
|---|---|
| PostgREST (API otomatis) | `src/app.js` — 40 endpoint yang ditulis tangan |
| Supabase Auth | scrypt + JWT HS256 + tabel `user_session` |
| **Row Level Security** | **Guard di `lib/core.js`, dipanggil tiap service** |
| Fungsi RPC plpgsql | `services/*.js` |
| Supabase Storage + signed URL | Folder di disk + endpoint yang memeriksa kewenangan |
| Edge Functions | Fungsi biasa di dalam server |
| pg_cron | `setInterval` di `jobs.js` |
| Realtime | Polling tiap 60 detik |
| ENUM, JSONB, citext, uuid | CHECK, TEXT + `json_valid`, `COLLATE NOCASE`, `crypto.randomUUID` |

### Kehilangan yang paling serius: RLS

Ini perlu dibaca dengan kecurigaan yang sepadan.

Di Postgres, kebijakan RLS menempel pada **tabel**. Kueri dari arah mana pun —
lewat API, lewat psql, lewat endpoint baru yang ditulis besok — tetap
tersaring. Aturannya struktural.

Di sini, penyaringan menempel pada **kode**. Satu endpoint yang lupa memanggil
`assertSupplierAccess()` adalah lubang terbuka: pemasok mana pun dapat membaca
profil pemasok lain hanya dengan mengganti satu id di URL.

Tiga hal yang menahan risiko itu, dan tidak satu pun sekuat RLS:

1. **Seluruh akses melewati guard di `lib/core.js`.** Tidak ada service yang
   membaca `req.user` langsung; semuanya lewat `requireRole()` atau
   `assertSupplierAccess()`.
2. **Klien tidak dapat lagi menyusun kueri sendiri.** PostgREST dulu menerima
   `.select().eq().order()` dari peramban; sekarang hanya ada endpoint yang
   sudah ditentukan. Permukaan serangnya jauh lebih sempit.
3. **Uji negatif.** Dari 50 pemeriksaan di `tests/flow.test.js`, dua belas
   memastikan sesuatu **gagal** — pemasok membaca data pemasok lain, staf
   memutuskan preferred, pemasok meninjau kuesionernya sendiri. Setiap endpoint
   baru sebaiknya datang bersama uji negatifnya.

**Setiap penambahan endpoint wajib ditinjau dari sudut otorisasi.** Pada versi
Supabase, melupakan RLS berarti tabel baru tidak dapat dibaca siapa pun sampai
kebijakannya ditulis — gagal ke arah aman. Di sini kebalikannya: endpoint baru
terbuka sampai seseorang menutupnya.

### Yang tetap struktural

Tidak semuanya pindah ke kode. Ini masih dijaga basis data, dan tetap berlaku
walau ada bug di lapisan aplikasi:

- **Imutabilitas versi kuesioner terbit** — sembilan trigger `RAISE(ABORT)`.
- **Append-only** pada `audit_log`, `supplier_timeline`, `questionnaire_review`,
  `response_revision`, dan keputusan preferred.
- **Dokumen pajak: sekali satu kolom diisi, seluruhnya wajib** — CHECK.
- **Termin pembayaran tidak boleh mengulang** — CHECK.
- **Satu kontak utama per pemasok** — indeks unik parsial.
- **Pasangan komoditas–negara tidak berulang** — UNIQUE.
- **Hanya versi published yang dapat ditugaskan** — trigger.
- **NIK dan NPWP 16 digit** — CHECK.

### Nilai turunan tetap tidak disimpan

Keputusan ini bertahan utuh dari rancangan awal, dan alasannya tidak berubah:
menyimpan nilai turunan membuka peluang datanya menyimpang bila aturannya
berubah.

| Nilai | Sumbernya | Dibaca lewat |
|---|---|---|
| E-invoice provided | `md_transaction_type.provides_einvoice` | view `v_supplier_tax` |
| BIC dan negara bank | `md_bank` | view `v_supplier_bank_account` |
| Kode korporat SAP | `md_corporate_entity` | `corporateCodesFor()` |
| Masa berlaku kata sandi | `email_sent_at + 7 hari` | `passwordExpiresAt()` |

---

## Empat pragma yang tidak boleh dilewatkan

Ada di `db/index.js`, dan tanpanya SQLite tidak layak melayani aplikasi web:

- `journal_mode = WAL` — tanpa ini, satu penulisan mengunci seluruh berkas dan
  pembaca ikut berhenti.
- `busy_timeout = 5000` — SQLite hanya mengizinkan satu penulis pada satu
  waktu. Tanpa timeout, permintaan kedua langsung gagal `SQLITE_BUSY`.
- `foreign_keys = ON` — SQLite mematikannya secara bawaan demi kompatibilitas
  mundur. Dibiarkan mati, seluruh `REFERENCES` hanya jadi dokumentasi.
- `synchronous = NORMAL` — aman bersama WAL, jauh lebih cepat daripada FULL.

---

## Mesin questionnaire ada di dua tempat

Frontend tetap memerlukan mesinnya sendiri di `src/questionnaire/engine/`:
pertanyaan bersyarat harus muncul seketika, tanpa menunggu jaringan. Yang di
server bukan penggantinya melainkan penjaganya.

| Server (`services/questionnaire.js`) | Frontend |
|---|---|
| `evalCondition` | `engine/conditions.js` |
| `computeCompletion` | `engine/completion.js` |
| `computeScore`, `classifyRisk` | `engine/scoring.js` |
| `submissionBlockers` | `engine/answerValidation.js` |

Skor yang dihitung di peramban dapat diubah siapa pun yang membuka devtools;
yang dipercaya adalah yang dihitung saat `submitResponse`. **Keduanya harus
memberi hasil sama — bila berbeda, yang benar adalah versi server.**

Dua perilaku yang mudah salah dan karena itu diuji langsung:

- Pilihan bertanda `exclude_from_scoring` (N/A) dikeluarkan dari **pembilang
  maupun penyebut**. Menjawab N/A tidak menghukum pemasok.
- Pertanyaan yang tersembunyi tidak ikut dihitung sama sekali, termasuk dalam
  kelengkapan — yang kalau tidak begitu tidak akan pernah mencapai 100%.

---

## Deployment

**SQLite tidak dapat berjalan di Vercel.** Fungsi serverless punya sistem
berkas sementara: setiap permintaan dapat mendarat di instance berbeda, dan
tulisan ke disk hilang saat instance dimatikan. Basis data yang berupa berkas
tidak bisa hidup di situ.

Front-end tetap di Vercel. Yang pindah hanya `server/`, ke tempat yang
menyediakan **disk permanen**.

### Berkas yang sudah disiapkan

| Berkas | Isi |
|---|---|
| `server/Dockerfile` | Dua tahap; image akhir tanpa compiler, dengan `sqlite3` CLI untuk backup |
| `server/fly.toml` | Region Singapura, volume di `/data`, satu instance, health check |
| `server/.dockerignore` | Menahan `data/`, `storage/`, dan `.env` agar tidak ikut ke image |
| `server/scripts/backup.sh` | `sqlite3 .backup` + verifikasi + rotasi |

### Langkah di Fly.io

```bash
cd server
fly launch --no-deploy                          # membuat aplikasinya
fly volumes create paragon_data --size 1 --region sin

fly secrets set \
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  ALLOWED_ORIGIN="https://domain-anda.vercel.app"

fly deploy
fly ssh console -C "node src/db/seed.js"        # hanya bila ingin data contoh
```

Migrasi berjalan sendiri saat server mulai (`src/index.js` memanggil
`migrate()`), jadi tidak ada perintah rilis terpisah.

Setelah dapat alamat, setel `VITE_API_URL` di Vercel ke alamat itu lalu
redeploy front-end.

### Mengapa tepat satu instance

`min_machines_running = 1` dan `auto_stop_machines = false` bukan penghematan
melainkan syarat. Volume hanya dapat dipasang ke satu mesin, dan SQLite hanya
mengizinkan satu penulis. Dua mesin yang menunjuk volume sama akan saling
merusak. `auto_stop_machines` juga harus mati: mesin yang tidur berarti
permintaan pertama menunggu mesin bangun, dan penjadwal di `jobs.js` berhenti
berjalan tanpa pemberitahuan apa pun.

### Alternatif

| Pilihan | Catatan |
|---|---|
| Fly.io + volume | Volume 1 GB gratis; paling dekat dengan cara SQLite dirancang dipakai |
| Railway / Render + disk | Lebih sederhana, tanpa Docker; pilih region Singapura |
| VPS (Biznet, DigitalOcean) | Kendali penuh; Anda mengurus patch dan uptime sendiri |
| Turso | SQLite terkelola (libSQL); menuntut ganti driver dari `better-sqlite3` |

### Backup

Supabase mencadangkan otomatis. SQLite tidak, dan tidak ada yang akan
mengingatkan bila terlewat. Jadwalkan `scripts/backup.sh` harian:

```bash
fly ssh console -C "/app/scripts/backup.sh"      # sekali, untuk memastikan jalan
```

Skrip memakai `sqlite3 .backup`, **bukan** `cp`. Dalam mode WAL sebagian data
berada di berkas `-wal` terpisah, sehingga menyalin `.db` saja selagi server
berjalan menghasilkan salinan rusak — dan rusaknya baru ketahuan saat Anda
benar-benar membutuhkannya. Skrip juga menjalankan `pragma integrity_check`
pada hasilnya sebelum menghapus cadangan lama: backup yang tidak pernah
diverifikasi bukan backup, hanya berkas.

Salinan tersimpan di volume yang sama dengan basis datanya. Itu melindungi dari
kesalahan operasi, **bukan** dari kehilangan volume. Untuk itu, unduh berkasnya
keluar secara berkala:

```bash
fly ssh sftp get /data/backups/paragon-<stamp>.db ./backup-lokal.db
```

## Batas yang perlu diketahui

- **Satu penulis pada satu waktu.** Untuk beban kantor — puluhan staf, ratusan
  pemasok — ini tidak akan terasa. Untuk ribuan penulisan bersamaan, ini
  dinding.
- **Satu instance server saja.** Dua instance yang menunjuk berkas sama akan
  saling merusak, kecuali berbagi disk jaringan yang benar-benar mendukung
  penguncian. Kalau kelak diperlukan lebih dari satu, `DISABLE_JOBS=true` pada
  semua kecuali satu, dan pertimbangkan kembali ke Postgres.
- **Tidak ada replika baca.** Pelaporan berat berjalan di basis data yang sama
  dengan yang melayani pengguna.
- **Pengiriman email belum ada.** Notifikasi ditulis ke tabel `notification`
  dan berstatus `pending` selamanya sampai penyedia email dipilih. Titik
  sambungnya satu fungsi di `jobs.js`.

---

## Yang masih terbuka

Tiga peringatan dari rancangan awal masih berlaku, masing-masing terkurung di
satu tabel:

- ⚠️ **Pemetaan kode korporat ke struktur SAP belum didefinisikan**
  (`md_corporate_entity`).
- ⚠️ **Kode BIC 30 bank belum dicocokkan dengan direktori SWIFT resmi**
  (`md_bank`). Verifikasi sebelum dipakai untuk pembayaran sungguhan.
- ⚠️ **Kode delapan digit UNSPSC belum dicocokkan dengan daftar resmi**
  (`md_unspsc_commodity`).

Ditambah yang lahir dari perpindahan ini:

- **Token disimpan di localStorage.** Cookie `httpOnly` lebih tahan XSS tetapi
  menuntut frontend dan backend satu domain. Kalau kelak begitu, pindahkan —
  perubahannya hanya di `src/lib/backend/client.js`.
- **Unggahan dikirim sebagai base64 di dalam JSON**, bukan multipart. Untuk
  berkas 2 MB bedanya tidak terasa; untuk berkas besar ia boros memori.
- **Tanda tangan** masih kanvas gambar tangan. Keabsahan hukum menuntut
  penyedia pihak ketiga.
