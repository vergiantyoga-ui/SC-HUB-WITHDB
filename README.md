# Paragon Supply Collaboration Hub

Portal pemasok dan konsol procurement Paragon, beserta backend-nya. Dibangun
dari dokumen *Flow: Registrasi, Review & Onboarding Supplier* v1.4 dan
spesifikasi *Modular Supplier Questionnaire Engine*.

Satu repositori memuat dua bagian yang saling bergantung:

| Bagian | Letak | Teknologi |
|---|---|---|
| **Front-end** | `src/`, `index.html`, `vite.config.js` | React 18 + Vite 5, JavaScript |
| **Backend** | `server/` | Node 20+ dan SQLite, tanpa kerangka kerja |
| **Jembatan** | `src/lib/backend/` | Klien HTTP yang menggantikan store di memori |

Keduanya sengaja tidak dipisah jadi dua repo. Lapisan `src/lib/backend/`
dipakai langsung oleh komponen React, dan keduanya dirilis bersama — memisahkan
repo berarti menyalin berkas bolak-balik setiap kali kontrak API berubah.

---

## Menjalankan

### Front-end saja

Berjalan tanpa backend sama sekali; seluruh data hidup di memori dan
menyegarkan halaman mengembalikannya ke kondisi awal. Ini cara tercepat
menelusuri alur atau meninjau perubahan antarmuka.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # lima rangkaian pemeriksaan, termasuk registrasi end-to-end
```

Butuh Node 18 atau lebih baru.

### Dengan backend

```bash
npm install -g supabase      # sekali saja
npm run db:start             # Postgres + Auth + Storage + Studio lokal
npm run db:reset             # menjalankan migrasi lalu seed.sql

cp .env.example .env         # isi VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY
                             # dari keluaran `npm run db:start`
npm run dev
```

| Perintah | Isi |
|---|---|
| `npm run db:start` / `db:stop` | Menyalakan dan mematikan tumpukan Supabase lokal |
| `npm run db:reset` | Menjalankan ulang seluruh migrasi lalu seed |
| `npm run db:test` | Uji alur end-to-end pada basis data |
| `npm run functions:serve` | Menjalankan Edge Function secara lokal |

Supabase Studio ada di `http://127.0.0.1:54323`.

---

## Akun contoh

Kata sandi seluruhnya `Paragon#2026`. Pada mode front-end saja, kata sandi
apa pun diterima — yang diperiksa hanya email atau ID akun.

**Konsol internal — `/internal/masuk`**

| Email | Role |
|---|---|
| `dewi.anggraini@paragon-corp.com` | Staf Procurement |
| `rangga.prasetyo@paragon-corp.com` | Staf Procurement Admin |
| `lestari.handayani@paragon-corp.com` | Manager Procurement |

**Portal pemasok — `/masuk`**

| ID akun | Kondisi |
|---|---|
| `SUP-PAC-0131` | Profil lengkap, menunggu verifikasi dokumen |
| `SUP-RAW-0118` | Pemasok aktif, sudah preferred |

---

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | Struktur berkas, bahasa antarmuka, bahasa visual, aturan dokumen yang tercermin di kode, rancangan modul questionnaire |
| [`docs/BACKEND.md`](docs/BACKEND.md) | Skema basis data, peta migrasi, RPC, RLS, keputusan rancangan, cara menyambungkan frontend |

Mulai dari `docs/FRONTEND.md` bila Anda akan mengubah antarmuka, dan dari
`docs/BACKEND.md` bila Anda akan menyentuh basis data atau alur kerjanya.

---

## Status penyambungan

Front-end masih membaca `src/lib/mockData.js`. Klien HTTP di
`src/lib/backend/` sudah lengkap dan backend-nya teruji, tetapi **belum
dipasang** ke komponen — pemasangannya dilakukan bertahap per modul supaya
setiap langkah dapat ditinjau, dan agar mode front-end saja tetap berfungsi
selama peralihan.

Urutan yang disarankan:

1. Master data — ganti impor dari `masterData.js` dengan `loadMasterData()`.
2. Autentikasi — `signInInternal()` dan `signInSupplier()`.
3. Antrian dan tinjauan pendaftaran.
4. Kelengkapan profil dan unggahan berkas.
5. Kualifikasi dan preferred supplier.
6. Questionnaire: builder, penugasan, pengisian, tinjauan.

Rinciannya ada di bagian "Menyambungkan frontend" pada `docs/BACKEND.md`.

---

## Yang masih menunggu keputusan di luar kode

Tiga hal ini sudah dicatat sejak tahap rancangan dan belum berubah. Semuanya
terkurung di satu tabel masing-masing, jadi memperbaikinya tidak menyentuh
kode sama sekali:

- **Pemetaan kode korporat ke struktur SAP belum didefinisikan** — menunggu tim
  integrasi. Yang pasti hanya kodenya tersimpan apa adanya (`md_corporate_entity`).
- **Kode BIC 30 bank belum dicocokkan dengan direktori SWIFT resmi**
  (`md_bank`). Verifikasi sebelum dipakai untuk pembayaran sungguhan.
- **Kode delapan digit UNSPSC belum dicocokkan dengan daftar resmi**
  (`md_unspsc_commodity`). Nomor inilah yang terbawa ke sistem pengadaan dan
  pelaporan.


---

## Catatan deployment

Front-end berjalan di Vercel tanpa masalah. **Backend tidak bisa** — SQLite
menyimpan datanya sebagai berkas, sementara fungsi serverless punya sistem
berkas sementara yang hilang setiap kali instance dimatikan.

`server/` perlu berjalan di tempat yang menyediakan disk permanen: Fly.io
dengan volume, Railway, Render, atau VPS biasa. Setelah punya alamat, setel
`VITE_API_URL` di Vercel ke alamat itu dan `ALLOWED_ORIGIN` di server ke domain
Vercel.

Backup juga menjadi tanggung jawab Anda sekarang. Rinciannya di
[`docs/BACKEND.md`](docs/BACKEND.md).
