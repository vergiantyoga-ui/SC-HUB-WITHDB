# Paragon Supply Collaboration Hub — Front-End

Antarmuka portal pemasok dan konsol procurement, dibangun dari dokumen
*Flow: Registrasi, Review & Onboarding Supplier* v1.4 dan spesifikasi
*Modular Supplier Questionnaire Engine*.

Aplikasi ini **front-end saja**. Tidak ada backend, tidak ada panggilan jaringan.
Seluruh data hidup di memori selama sesi berlangsung, sehingga menyegarkan
halaman akan mengembalikan data contoh ke kondisi awal.

Dokumen ini terbagi tiga bagian:

| Bagian | Isi | Untuk siapa |
|---|---|---|
| **A. Menjalankan** | Perintah, akun demo, cara menelusuri alur | Siapa pun yang baru membuka repo |
| **B. Cara kerja** | Struktur berkas, bahasa antarmuka, bahasa visual, aturan yang tercermin di kode | Developer yang akan mengubah kode |
| **C. Rancangan questionnaire** | Penilaian arsitektur, ERD, spesifikasi API, fase implementasi | Pengambil keputusan dan tim backend |

Bagian C memuat skema basis data dan spesifikasi API. Keduanya **artefak
rancangan**, bukan kode yang berjalan — proyek ini memang tanpa server.

## Daftar isi

**Bagian A — Menjalankan**
Perintah · Akun demo · Menelusuri kedua jalur

**Bagian B — Cara kerja**
Struktur berkas · Modul questionnaire · Bahasa antarmuka · Bahasa visual ·
Aturan yang tercermin di kode · Catatan implementasi

**Bagian C — Rancangan modul questionnaire**
Status pengerjaan · Keputusan yang sudah diambil · Penilaian arsitektur ·
Arsitektur yang disarankan · Model data (ERD) · Alur pengguna · Struktur rute ·
Struktur API · Struktur komponen · Fase implementasi

---

# Bagian A — Menjalankan

## Perintah

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # keluaran produksi ke dist/
npm run preview  # meninjau hasil build
npm test         # lima rangkaian pemeriksaan, termasuk registrasi end-to-end
```

Butuh Node 18 atau lebih baru.

## Menguji registrasi tanpa basis data

Seluruh data hidup di memori, jadi alur registrasi dapat diuji dari ujung ke
ujung tanpa menyiapkan basis data apa pun. Ada dua cara.

**Otomatis — `npm test`.** Rangkaian `scripts/registration-e2e.jsx` memasang
store sungguhan lewat react-test-renderer, lalu memanggil aksinya berurutan
seperti pengguna menekan tombol: mendaftar, menyetujui, mengundang, mengganti
sandi, mengisi lima bagian profil, menyetujui consent, meminta perbaikan
dokumen, mengirim ulang, meloloskan periksa, mengisi kualifikasi, mengajukan,
lalu menetapkan preferred. Jalur registrasi internal, penolakan, dan
diskualifikasi ikut diuji. Karena setiap pemasangan store dimulai dari data
contoh yang sama, tidak ada yang perlu dibersihkan antar-uji.

Bedanya dengan `flow-check.mjs`: berkas itu hanya menguji fungsi murni,
sedangkan berkas ini menjalankan reducer dan aksi yang benar-benar dipakai
antarmuka.

Bila terjadi galat saat render, layar tidak lagi kosong: sebuah penangkap galat
menampilkan pesan beserta rincian teknis yang dapat disalin dan dilampirkan saat
melaporkan masalah.

**Manual — `npm run dev`.** Telusuri kedua jalur mengikuti langkah pada bagian
berikutnya. Menyegarkan halaman mengembalikan seluruh data ke kondisi awal,
sehingga percobaan dapat diulang berkali-kali tanpa jejak.

## Akun demo

Kata sandi apa pun diterima; yang diperiksa hanya email atau ID akun.

**Konsol internal — `/internal/masuk`**

| Email | Role | Yang bisa dilakukan |
|---|---|---|
| `dewi.anggraini@paragon-corp.com` | Staf Procurement | Tinjau pendaftaran, kedua jalur onboarding, periksa dokumen, isi kualifikasi, ajukan preferred |
| `rangga.prasetyo@paragon-corp.com` | Staf Procurement Admin | Wewenang sama persis dengan Staf Procurement |
| `lestari.handayani@paragon-corp.com` | Manager Procurement | Menetapkan preferred supplier atau mendiskualifikasi |

**Portal pemasok — `/masuk`**

| ID akun | Kondisi |
|---|---|
| `SUP-PAC-0131` | Profil lengkap, menunggu verifikasi dokumen |
| `SUP-RAW-0118` | Pemasok aktif, bisa mengubah profil |

## Menelusuri kedua jalur

**Jalur A — undang pemasok**

1. Masuk sebagai Staf Procurement, buka antrian, pilih pengajuan berstatus menunggu.
2. Buka ketiga tab (tombol keputusan terkunci sampai semuanya dibuka), lalu setujui.
3. Tekan **Kirim undangan**. Salin ID akun dan kata sandi sementara dari dialog.
4. Keluar, masuk ke portal pemasok dengan ID akun tersebut, ganti kata sandi.
5. Isi kelima bagian profil, setujui kedua pernyataan pada layar persetujuan.
6. Masuk kembali sebagai staf, buka **Verifikasi dokumen**, setujui atau minta perbaikan.

**Jalur B — registrasi internal**

1. Masuk sebagai Staf Procurement atau Staf Procurement Admin — keduanya berwenang
   sama — lalu setujui sebuah pengajuan.
2. Pilih **Mulai registrasi internal**, tentukan asal dokumen (email atau WhatsApp).
3. Isi kelima bagian, lalu **Selesai dan kirim akun**. Tidak ada persetujuan
   manager di tengah jalan; akun pemasok langsung dibuat.
4. Masuk sebagai pemasok memakai ID akun tersebut untuk meninjau dan menyetujui.

**Menelusuri preferred supplier**

`SUP-2026-0135` sudah berada pada tahap qualification. Isi kualifikasinya lewat
menu **Kualifikasi**, ajukan dari menu **Preferred supplier**, lalu masuk sebagai
Manager Procurement untuk menilainya.


---

# Bagian B — Cara kerja

## Struktur

```
src/
  lib/          constants.js   status, role, enum, ambang teknis
                validation.js  aturan field generik
                profileRules.js validasi lima bagian profil (murni, teruji)
                format.js      tanggal, ID akun, masa berlaku
                mockData.js    data contoh mencakup setiap status
  store/        AppStore.jsx     reducer tunggal + seluruh aksi transisi status
                ThemeContext.jsx tema terang/gelap
  i18n/         dictionaries.js  kamus ID / EN / ZH
                LanguageContext.jsx, LanguageMenu.jsx
  components/
    ui/         primitif: Button, Field, PasswordField, FileField, Modal,
                Toast, Tabs, Card, StatusBadge, DataList, SectionRail,
                EmptyState, Icon, PageHeader, TileGrid
    layout/     AppShell (sidebar + bilah atas, dipakai dua portal),
                AuthShell, InternalLayout, SupplierLayout
    profile/    ProfileSectionForm (dipakai dua jalur), ProfileSummary
  pages/
    auth/       SupplierLogin, StaffLogin, ForgotPassword
    supplier/   RegisterWizard, ChangePassword, SupplierProfile,
                ConsentPage, SupplierStatus
    internal/   InternalHome, QueueDashboard, SubmissionReview,
                InternalRegistration, ManagerApprovals, DocumentVerification
  qualification/
    data/       referenceData.js  UNSPSC (subset) dan negara ISO 3166-1
    qualificationRules.js         kelayakan, hak akses, validasi baris
    pages/      QualificationList.jsx, QualificationForm.jsx
  questionnaire/
    engine/     schema.js        entitas, JSDoc typedef, pembekuan versi
                builderOps.js    operasi penyuntingan struktur (murni)
                reviewRules.js   tinjauan, revisi, ringkasan dashboard
                questionTypes.js registri 18 tipe soal
                conditions.js    percabangan pertanyaan
                answerValidation.js  wajib, format, aturan lampiran
                scoring.js       skor berbobot & klasifikasi risiko
                completion.js    persentase pengisian
                versioning.js    terbit, versi baru, salin dari pustaka
    store/      QuestionnaireStore.jsx, questionnaireMockData.js,
                assignmentMockData.js
    components/ builder/ (QuestionToolbox, SectionCard, QuestionCard,
                          PropertiesPanel, ConditionEditor,
                          AttachmentRulePanel, ScoringPanel, LibraryPicker)
                render/  (QuestionRenderer + lampiran & tanda tangan)
                shared/  (status, skor, bilah kemajuan, grafik SVG)
    pages/      internal/ (TemplateList, TemplateDetail, TemplateCreate,
                          QuestionnaireBuilder, AssignmentList,
                          AssignmentCreate, ReviewQueue, ReviewDetail,
                          QuestionnaireDashboard, NotificationList,
                          AuditTrail)
                supplier/ (MyQuestionnaires, ResponseWizard)
  styles/       global.css   token warna, tipografi, komponen dasar
                patterns.css pola tata letak lintas halaman
scripts/        flow-check.mjs — pemeriksaan transisi status
```

## Master data Data Umum dan integrasi SAP

Seluruh pilihan pada bagian Data Umum disimpan sebagai **kode**, bukan nama.
Nama hanya dipakai untuk ditampilkan, sehingga perubahan ejaan atau bahasa tidak
memengaruhi data yang sudah tersimpan. Definisinya ada di `src/lib/masterData.js`.

| Field | Kode | Catatan |
|---|---|---|
| Status badan hukum | `Z1` Perorangan, `Z2` Badan | Bentuk badan usaha hanya aktif bila `Z2` |
| Bentuk badan usaha | `0001`–`0028` | 28 bentuk, dari PT sampai S.L.U |
| Jenis pasokan | `0001` Raw, `0002` Packaging, `0003` Indirect | |
| Rincian jenis pasokan | `0001`–`0007` | **Dropdown terfilter** menurut jenis pasokan |
| Rencana kerja sama | `C1` Reguler, `C0` One Time | |
| Tipe vendor | `Z002` Direct Transaction, `Z009` Manufacturer | Field baru |

**Rincian jenis pasokan bersifat interaktif.** Memilih Packaging Material hanya
memunculkan Packaging Primer dan Packaging Sekunder; mengganti jenis pasokan
mengosongkan rincian yang sudah dipilih agar tidak tersimpan pasangan yang
tidak cocok.

### Perusahaan Paragon yang dituju

Antarmuka hanya menampilkan dua pilihan, sementara basis data menyimpan kode
korporatnya. Saat sebuah nama antarmuka dipilih, **seluruh kode korporat di
bawahnya dikirim ke SAP sebagai larik**:

| Kode korporat | Nama | Nama antarmuka |
|---|---|---|
| `ID01` | PT Paragon Universa Utama | Paragon Corp Indonesia |
| `ID02` | PT Paragon Technology And Innovation | Paragon Corp Indonesia |
| `ID03` | PT Parama Global Inspira | Paragon Corp Indonesia |
| `ID04` | PT Varcos Citra International | Paragon Corp Indonesia |
| `ID05` | PT Paranova Global Optima | Paragon Corp Indonesia |
| `ID06` | PT Alpha Global Medika | Paragon Corp Indonesia |
| `MY01` | PT Pharmacore Technology & Innovation | Paragon Corp Malaysia |

Memilih **Paragon Corp Indonesia** mengirim `["ID01","ID02","ID03","ID04","ID05","ID06"]`;
memilih **Paragon Corp Malaysia** mengirim `["MY01"]`. Fungsinya ada pada
`corporateCodesFor()`, dan hasilnya sudah ditampilkan pada layar tinjauan
pendaftaran sebagai baris "Kode korporat untuk SAP".

⚠️ Pemetaan kode-kode ini ke struktur SAP yang sebenarnya **belum didefinisikan**
dan menunggu keputusan tim integrasi. Yang sudah pasti hanyalah kodenya tersimpan
apa adanya di sisi aplikasi.

## Bagian Data Pajak

Bagian ini terbagi tiga kelompok dalam satu layar.

**Identitas pajak** — tax name, tax address, NIK, NPWP, transaction type,
penanda e-invoice, serta unggahan KTP dan NPWP.

**Dokumen perpajakan** — enam dokumen dengan bentuk yang sama: nomor, berkas,
tanggal mulai berlaku, dan tanggal akhir berlaku.

| Dokumen | Wajib |
|---|:---:|
| SIUP | ✅ |
| PKP, SBU, SKB, Surat Keterangan PP, COD/COR | Opsional |

Hanya SIUP yang diwajibkan. Lima dokumen lain tidak dimiliki setiap pemasok —
SBU misalnya khusus badan usaha jasa konstruksi — sehingga mewajibkan seluruhnya
akan mengunci pemasok yang sah. Namun **begitu satu kolom sebuah dokumen diisi,
seluruh kolomnya ikut diwajibkan**: nomor tanpa berkas, atau berkas tanpa masa
berlaku, sama-sama tidak berguna saat verifikasi.

**Identitas pajak lainnya** — TIN, BRN, nomor GST, beserta unggahan TIN dan BRN.

### Transaction type dan e-invoice

Transaction type disimpan sebagai kode, mengikuti pola master data Data Umum:

| Kode | Nama | E-invoice provided |
|---|---|---|
| `T01` | Goods | Yes |
| `T02` | CSR Cash Money | No |
| `T03` | Rent | No |
| `T04` | Other | No |

Penanda **e-invoice provided tidak disimpan**, melainkan dihitung dari
transaction type lewat `eInvoiceFor()` setiap kali dibutuhkan. Menyimpan nilai
turunan membuka peluang datanya menyimpang bila aturannya berubah kelak.
Di formulir, nilainya tampil sebagai kolom baca-saja yang ikut berubah begitu
transaction type diganti.

⚠️ Kode `T01`–`T04` adalah usulan; bila tim SAP sudah punya kode resminya,
cukup ganti nilai `code` pada `TRANSACTION_TYPES` di `masterData.js`.

### Aturan masa berlaku

Tanggal akhir tidak boleh mendahului tanggal mulai, dan dokumen yang sudah
kedaluwarsa ditolak saat diunggah — sejalan dengan aturan sertifikat pada
bagian Lisensi & Sertifikat.

### Catatan tentang TIN, BRN, dan GST

Ketiganya diwajibkan untuk semua pemasok sesuai permintaan. Perlu diketahui:
ketiganya adalah identitas pajak luar negeri — BRN dan GST lazim dipakai di
Malaysia — sehingga pemasok Indonesia yang hanya memiliki NPWP tidak akan punya
nomor untuk diisi dan profilnya tertahan di bagian ini. Bila kelak diputuskan
bahwa ketiganya hanya berlaku bagi pemasok luar negeri, aturannya cukup diubah
di satu tempat pada `validateSection('tax', …)`.

## Bagian Dokumen Legalitas

Terbagi dua kelompok, seluruhnya menerima PDF, JPG, atau PNG maksimal 2 MB.

**Document upload** — sembilan berkas:

| Dokumen | Wajib |
|---|:---:|
| Akta Pendirian | ✅ |
| SK Pendirian MENKUMHAM | ✅ |
| NIB | ✅ |
| Akta Perubahan SK/SP MENKUMHAM | Opsional |
| Akta Susunan Direksi dan Komisaris SK MENKUMHAM | Opsional |
| Surat Izin Usaha / Sertifikat Standar | Opsional |
| Izin Lokasi | Opsional |
| PKKPR | Opsional |
| Surat Kuasa | Opsional |

**Other documents** — empat berkas ditambah satu isian teks:

| Dokumen | Wajib |
|---|:---:|
| Conflict of Interest | ✅ |
| Business License | ✅ |
| Others documents (SPK, PU, dll) | Opsional |
| Deed of Establishment (DoE) | Opsional |
| Reason for No DOE attachment | Bersyarat |

### Alasan tanpa DoE bersifat bersyarat

Rancangan menandai kolom ini wajib tanpa syarat. Diterapkan begitu saja, pemasok
yang **sudah** melampirkan Deed of Establishment tetap harus menjelaskan mengapa
tidak melampirkannya. Karena itu kolomnya hanya diwajibkan selama DoE belum
diunggah, dan otomatis dinonaktifkan begitu berkasnya dilampirkan.

### Nama berkas

Rancangan mencantumkan pesan *"File names should not contain unusual
characters"* pada setiap kolom unggah. Pesan itu diterapkan sebagai **validasi
sungguhan**, bukan sekadar keterangan: nama berkas hanya boleh memuat huruf,
angka, spasi, titik, tanda hubung, garis bawah, dan tanda kurung. Nama yang
memuat karakter lain ditolak saat diunggah — kerusakannya baru terasa jauh
setelah berkas berpindah antar sistem, jadi lebih baik dicegah sejak awal.
Aturan ini berlaku untuk seluruh unggahan di aplikasi, termasuk yang opsional.

## Bagian Pembayaran & Tagihan

Terbagi dua tingkat: ketentuan yang berlaku menyeluruh, dan daftar rekening yang
dapat diisi lebih dari satu.

### Tingkat header

| Field | Wajib | Isi |
|---|:---:|---|
| Mata uang transaksi | ✅ | IDR, MYR, USD, SGD, EUR |
| Set agreement rate | ✅ | Active / Inactive |
| Termin pembayaran 1 | ✅ | 7, 14, 15, 45, 60, 90, atau 120 Days |
| Termin pembayaran 2 | Opsional | Pilihan sama |
| Termin pembayaran 3 | Opsional | Pilihan sama |
| Fiscal position | Opsional | Absolut (PRM), Absolut (PTI), Free Trade Zone, Has NPWP no PKP, Individual non NPWP |

Termin kedua dan ketiga tidak boleh mengulang termin yang sudah dipilih —
mendaftarkan termin yang sama dua kali tidak menambah keterangan apa pun.

### Tingkat baris — rekening bank

Satu baris mewakili satu rekening, dan pemasok dapat menambah baris untuk
mendaftarkan beberapa rekening sekaligus.

| Field | Wajib | Catatan |
|---|:---:|---|
| Account type | ✅ | Virtual Account, Bank Account, Batch Upload, Billing ID |
| Nama bank | ✅ | 30 bank |
| Bank identifier code | — | Terisi sendiri dari bank yang dipilih |
| Bank country | — | Terisi sendiri dari bank yang dipilih |
| Nomor rekening | ✅ | |
| Nama pemilik rekening | ✅ | |
| Bank account statement | ✅ | PDF, JPG, atau PNG — maks. 2 MB |

Rekening dengan nomor sama pada bank yang sama ditolak. Baris kedua dan
seterusnya boleh dikosongkan seluruhnya, tetapi begitu satu kolomnya diisi,
sisanya ikut diwajibkan — rekening setengah terisi tidak dapat dipakai membayar.

**Kode BIC dan negara tidak disimpan pada baris**, melainkan diturunkan dari bank
yang dipilih setiap kali ditampilkan. Alasannya sama dengan penanda e-invoice:
menyimpan nilai turunan membuka peluang datanya menyimpang bila daftar bank
diperbarui.

⚠️ Tiga puluh bank ini kurasi awal, dan **kode BIC-nya belum dicocokkan dengan
direktori SWIFT resmi**. Mintalah tim master data memverifikasinya sebelum
dipakai untuk pembayaran sungguhan.

## Tahapan pemasok

Perjalanan pemasok mengikuti lima langkah berurutan, ditampilkan pada ringkasan beranda:

```
Supplier request → Registrasi → Qualification → Menunggu preferred → Preferred supplier
                        ↘ Perlu perbaikan dokumen        ↘ Disqualification
```

| Tahap | Artinya |
|---|---|
| **Supplier request** | Pendaftaran baru masuk, menunggu ditinjau staf procurement |
| **Registrasi** | Profil sudah dikirim, dokumennya sedang diperiksa |
| **Qualification** | Staf mengisi kualifikasi komoditas, pemasok mengisi kuesioner |
| **Menunggu preferred** | Berkas diajukan staf, menunggu keputusan manager |
| **Preferred supplier** | Manager menetapkan pemasok sebagai preferred |
| **Disqualification** | Manager menolak; masih dapat dikembalikan ke tahap qualification |

Di antara Supplier request dan Registrasi terdapat tahap onboarding — pemilihan
jalur, pengiriman undangan, dan pengisian profil — yang tampil pada antrian
sebagai `Diundang`, `Registrasi internal`, `Terhubung`, dan `Melengkapi profil`.

## Modul Preferred Supplier

Manager procurement menilai empat berkas sekaligus sebelum menetapkan pemasok
sebagai preferred: **profil registrasi, dokumen legalitas, kualifikasi komoditas,
dan hasil kuesioner**. Tombol keputusan baru terbuka setelah keempat tab dibuka,
mengikuti pola yang sudah dipakai pada tinjauan pendaftaran.

- Staf procurement mengajukan pemasok yang berkasnya sudah lengkap. Pengajuan
  terkunci selama kualifikasi belum terisi, karena justru itu yang dinilai manager.
- Keputusan **Preferred** atau **Disqualification** dicatat beserta alasan dan pelakunya.
- Pemasok yang didiskualifikasi dapat dikembalikan ke tahap qualification, sehingga
  keputusan tidak menjadi jalan buntu.

## Modul Kualifikasi Pemasok

Setelah pemasok mengirimkan profilnya, staf procurement menentukan kategori
komoditas dan negara asal pasokannya.

- **Akses** — Staf Procurement dan Staf Procurement Admin memiliki wewenang yang
  sama dan keduanya dapat mengisi; Manager Procurement meninjau tanpa menyunting.
- **Kelayakan** — gerbangnya adalah **profil yang sudah dikirim pemasok**, bukan
  dokumen yang sudah diverifikasi, sehingga kualifikasi berjalan berdampingan
  dengan verifikasi dokumen alih-alih mengantre di belakangnya. Kedua jalur
  onboarding bertemu di titik ini: pada jalur undangan pemasok mengirim profilnya
  sendiri, sedangkan pada registrasi internal manager menyetujui isian admin
  lebih dahulu sebelum pemasok meninjau dan mengirimkannya. Status yang memenuhi
  syarat: `Registrasi`, `Perlu perbaikan dokumen`, `Qualification`,
  `Menunggu preferred`, dan `Preferred supplier`.
  Daftar menampilkan status onboarding tiap pemasok agar staf punya konteks, dan
  pemasok yang belum layak tetap menampilkan alasannya secara spesifik.
- **Baris ganda** — satu baris mewakili satu pasangan komoditas dan negara.
  Baris dapat ditambah satuan atau lima sekaligus, disalin untuk negara lain,
  dan dihapus. Pasangan komoditas–negara yang berulang ditolak.
- **Kategori komoditas** memakai dropdown bertingkat berdasarkan segmen UNSPSC;
  **negara pemasok** memakai daftar ISO 3166-1.
- Draf dapat disimpan tanpa kelengkapan; menyelesaikan kualifikasi menuntut
  seluruh baris terisi sah.

⚠️ **Daftar komoditas memuat 42 butir yang relevan bagi manufaktur kosmetik**,
dikurasi dari taksonomi UNSPSC — bukan salinan lengkapnya. Ini disengaja: daftar
resmi berisi lebih dari 150.000 kode yang sebagian besar tidak akan pernah dipakai
Paragon, sehingga menampilkan seluruhnya justru menyulitkan staf menemukan
kategori yang tepat.

Kode segmen dua digit mengikuti taksonomi resmi. Kode delapan digit tiap
komoditas **belum dicocokkan dengan daftar UNSPSC resmi** — nomor inilah yang
terbawa ke sistem pengadaan dan pelaporan, jadi mintalah tim master data
memverifikasinya sebelum dipakai di produksi. Menambah atau mengoreksi butir
cukup dilakukan pada `UNSPSC_COMMODITIES`.

## Modul Questionnaire (Fase 1–7)

Mesin kuesioner modular untuk audit pemasok, pernyataan kepatuhan, dan
asesmen lain. Tipe kuesioner tidak di-hardcode: menambah jenis baru cukup
membuat template lewat antarmuka.

Yang sudah berjalan:

- **Mesin** — kondisi bercabang, validasi jawaban dan lampiran, skoring
  berbobot dengan klasifikasi risiko, perhitungan kelengkapan, dan aturan versi.
  Seluruhnya JavaScript murni tanpa React, diuji langsung lewat `npm test`.
- **Registri tipe soal** — 18 tipe pada 7 kelompok. Menambah tipe berarti
  menambah satu entri di `engine/questionTypes.js`; tidak ada berkas lain yang berubah.
- **Aturan lampiran per pertanyaan** — wajib/opsional, jumlah berkas, ukuran
  maksimum, format yang diterima, tanggal berlaku, dan sisa masa berlaku minimum.
- **Data contoh** — tiga template: Supplier Audit (skoring aktif, 4 seksi,
  18 soal), Animal Free Statement (tanpa skoring, bercabang, tanda tangan),
  Halal Compliance (draf). Ditambah pustaka soal dan pustaka seksi.
- **Antarmuka** — daftar template dengan pencarian dan saringan, detail
  template beserta riwayat versi, dan formulir pembuatan template.
- **Builder** — kanvas tiga kolom: kotak perkakas, susunan seksi dan pertanyaan,
  serta panel properti. Menambah, menyunting, menggandakan, menghapus, dan
  menyusun ulang seksi maupun pertanyaan; mengganti tipe soal; menyunting daftar
  pilihan beserta skornya; mengatur batas isian. Versi terbit dibuka dalam mode
  baca. Penyusunan ulang memakai tombol naik/turun, tanpa dependensi baru.
- **Editor kondisi** — menyusun aturan tampil dengan penggabung "semua" atau
  "salah satu". Pemicu dibatasi pada pertanyaan sebelumnya, sehingga acuan
  melingkar tidak mungkin tersusun.
- **Aturan lampiran per pertanyaan** dapat disunting penuh: wajib atau tidak,
  jumlah berkas, ukuran maksimum, format yang diterima, tanggal berlaku, dan
  sisa masa berlaku minimum.
- **Pengaturan skoring** — sakelar per versi, nilai kelulusan, dan tabel
  klasifikasi risiko yang dapat diubah sebutan maupun rentangnya.
- **Pustaka soal dan seksi** — butir yang dipilih disalin nilainya, sehingga
  menyunting pustaka tidak mengubah kuesioner yang sudah memakainya.
- **Penugasan** — menugaskan versi terbit kepada pemasok aktif beserta material,
  tenggat, peninjau, prioritas, dan instruksi. Daftar penugasan memantau
  kemajuan pengisian dan menandai yang lewat tenggat.
- **Portal pemasok** — daftar kuesioner yang ditugaskan, dan wizard pengisian
  per seksi dengan simpan draf, pertanyaan bersyarat yang muncul seketika,
  unggahan dokumen sesuai aturan tiap soal, serta prapemeriksaan sebelum kirim
  yang menyebutkan persis apa yang masih kurang.

- **Tinjauan** — peninjau melihat jawaban per seksi beserta lampirannya, skor,
  dan kelengkapan; menandai pertanyaan yang perlu diperbaiki satu per satu
  dengan alasannya; lalu menyetujui, menolak, atau meminta revisi.
- **Revisi** — pemasok hanya dapat menyunting pertanyaan yang ditandai; jawaban
  lain tetap terkunci. Pengiriman ulang tertahan bila jawaban bertanda belum
  benar-benar berubah. Setiap putaran tersimpan sebagai riwayat yang tidak
  pernah dihapus.
- **Dashboard** — dua belas KPI, tingkat respons, sebaran risiko, sebaran tipe
  kuesioner, status pengisian, dan skor per respons. Grafik digambar dengan SVG
  sendiri, tanpa pustaka grafik tambahan, dan setiap grafik disertai tabel angka
  tersembunyi agar terbaca pembaca layar.
- **Notifikasi dalam aplikasi** untuk penugasan baru, pengiriman, dan keputusan
  tinjauan, dengan penanda belum dibaca pada menu samping.
- **Jejak audit** — setiap tindakan penting beserta pelaku, waktu, dan objeknya.

Seluruh tujuh fase selesai.

Rancangan lengkap termasuk skema basis data dan spesifikasi API ada pada
dokumen proposal terpisah; keduanya artefak rancangan untuk tim backend,
karena proyek ini tanpa server.

## Bahasa antarmuka

Tersedia **Bahasa Indonesia, English, dan 中文**, dapat diganti lewat tombol
globe pada bilah atas. Bahasa awal menebak dari pengaturan peramban dan kembali
ke Bahasa Indonesia bila tidak dikenali.

Kamus berada di `src/i18n/dictionaries.js` dengan Bahasa Indonesia sebagai acuan.
Kunci yang belum diterjemahkan otomatis jatuh kembali ke teks Indonesia, sehingga
antarmuka tidak pernah menampilkan kunci mentah. Cakupan saat ini menyasar
kerangka aplikasi, navigasi, status, label bagian, tombol, dan layar masuk;
sebagian teks penjelasan panjang di dalam formulir masih berbahasa Indonesia.
Pemeriksaan `npm test` menjaga agar kamus EN dan ZH tidak menyimpang dari acuan.

## Bahasa visual

Antarmuka mengikuti sistem desain konsol internal Paragon:

- **Sidebar berkelompok** — menu dibagi menjadi kelompok bertajuk (Beranda, Proses,
  Persetujuan) dengan pemisah tipis, dapat disempitkan menjadi ikon saja.
- **Aksen tunggal biru** — satu warna untuk keadaan aktif, tautan, dan tindakan utama.
  Tidak ada warna aksen kedua yang bersaing.
- **Bilah atas** — nomor pekan dan jam berjalan, tombol tema, lalu identitas pengguna.
- **Kepala halaman** — jejak navigasi, ikon berlatar biru muda, judul, lalu garis pemisah.
- **Kartu menu** — petak dengan ikon indigo padat, dipakai pada beranda sebagai
  jalan pintas ke tugas yang menunggu.
- **Isian kata sandi** — setiap isian kata sandi punya tombol lihat/sembunyikan
  yang dapat dicapai keyboard dan mengumumkan keadaannya lewat `aria-pressed`.
- **Mode gelap** — mengikuti preferensi sistem saat pertama dibuka, dapat diubah
  lewat tombol pada bilah atas.

Seluruh warna, jarak, dan radius berasal dari token pada `src/styles/global.css`,
sehingga penyesuaian merek cukup dilakukan di satu tempat.

## Aturan dari dokumen yang tercermin di kode

| Aturan | Letak |
|---|---|
| Tombol keputusan terkunci sampai ketiga tab dibuka | `SubmissionReview.jsx` |
| Jalur internal hanya untuk Procurement Admin | `AppStore.canUseInternalPath`, `SubmissionReview.jsx` |
| Jalur terkunci setelah dipilih | tidak ada aksi yang mengubah `onboardingPath` |
| Akun Jalur B baru dibuat setelah approval manager | `AppStore.managerApprove` |
| Kata sandi berlaku 7 hari sejak email terkirim | `format.passwordExpiryFrom`, diuji di `flow-check.mjs` |
| Dua kotak centang persetujuan, tidak pre-checked | `ConsentPage.jsx` |
| Verifikasi dokumen wajib sebelum aktif | `DocumentVerification.jsx` |
| NIK 16 digit, NPWP 16 digit dengan normalisasi 15→16 | `validation.js` |
| Unggahan PDF/JPG/PNG maksimal 2 MB | `validation.validateFile`, `FileField.jsx` |
| Termin pembayaran 7/15/30/45/60 Net Days | `constants.TERMS_OF_PAYMENT` |
| Maksimal 10 kontak, satu kontak utama | `ProfileSectionForm.jsx`, `profileRules.js` |
| Profil memuat data pendaftaran dan kelengkapan dalam satu halaman | `SupplierProfile.jsx`, `constants.PROFILE_SECTIONS` |
| Perubahan dokumen setelah aktif memicu verifikasi ulang | `ActiveProfile.jsx`, `AppStore.updateActiveProfile` |

## Catatan implementasi

- **Reminder otomatis** (bagian 4.9 dokumen) tidak dibuat karena penjadwalan
  email berada di sisi server. Yang tampak di antarmuka adalah peringatan masa
  berlaku kata sandi pada layar ganti kata sandi.
- **Berkas unggahan** hanya disimpan sebagai metadata (nama, ukuran, tipe).
  Validasi format dan ukuran tetap berjalan penuh.
- **Penyimpanan peramban** sengaja tidak dipakai agar demo selalu mulai dari
  kondisi yang sama dan tidak menahan data pribadi contoh di perangkat. Pilihan
  tema karena itu juga tidak bertahan setelah halaman disegarkan; nilai awalnya
  membaca preferensi sistem.
- **Aksesibilitas**: cincin fokus terlihat, galat field terhubung lewat
  `aria-describedby`, tab dinavigasi tombol panah, modal menahan fokus dan
  ditutup dengan Escape, notifikasi memakai live region, `prefers-reduced-motion`
  dihormati.


---

# Bagian C — Rancangan modul questionnaire

Bagian ini semula berdiri sebagai dokumen proposal terpisah. Isinya tetap
berlaku sebagai rujukan rancangan; status pengerjaannya diperbarui menurut
keadaan terkini.

## Status pengerjaan

| Fase | Isi | Status |
|---|---|---|
| 1 | Mesin, skema, registri tipe soal, pengujian | **Selesai** |
| 2 | Store, data contoh, daftar & detail template | **Selesai** |
| 3 | Builder: seksi, pertanyaan, panel properti | **Selesai** |
| 4 | Lampiran, kondisi, skoring, pustaka soal & seksi | **Selesai** |
| 5 | Penugasan dan portal pemasok | **Selesai** |
| 6 | Tinjauan, revisi, riwayat | **Selesai** |
| 7 | Dashboard, notifikasi | **Selesai** |

Yang masih terbuka setelah tujuh fase:

- **Tipe soal tabel/matriks** belum punya perender di sisi pengisian; pemasok
  melihat catatan yang mengarahkan memakai teks panjang atau lampiran.
- **Halaman kelola pustaka** soal dan seksi belum ada. Pustakanya sudah dapat
  dipakai di builder, tetapi isinya masih data tetap.
- **Pengiriman email** berada di sisi server. Yang tersedia hanya notifikasi
  dalam aplikasi beserta pemicunya.
- **Terjemahan** modul kuesioner masih Bahasa Indonesia; kunci EN dan ZH
  menyusul dengan pola fallback yang sudah ada.
- **Tanda tangan** berupa kanvas gambar tangan, bukan tanda tangan elektronik
  tersertifikasi.

## Keputusan yang sudah diambil

Enam pertanyaan terbuka pada proposal awal sudah dijawab:

| Pertanyaan | Keputusan |
|---|---|
| Persistensi data | Tetap di memori. Skema basis data dan API cukup berupa dokumen |
| Type safety | Menyesuaikan arsitektur yang ada: JSDoc `@typedef` + pemeriksaan bentuk pada batas data, tanpa migrasi TypeScript |
| Drag-and-drop | Diabaikan. Penyusunan ulang memakai tombol naik/turun, tanpa dependensi baru |
| Pembagian fase | Disetujui, dikerjakan bertahap |
| Cakupan bahasa | Indonesia dulu; kunci EN/ZH menyusul dengan pola fallback yang sudah ada |
| Tanda tangan | Kanvas gambar tangan. **Bukan** tanda tangan elektronik tersertifikasi — bila keabsahan hukum diperlukan, ini butuh penyedia pihak ketiga dan berada di luar jangkauan frontend |

### Penilaian Arsitektur yang Ada

Hasil pemeriksaan langsung atas repositori `paragon-hub` (6.629 baris, 57 berkas sumber).

| Aspek | Kondisi saat ini |
|---|---|
| Framework frontend | React 18 + Vite 5, **JavaScript murni** (bukan TypeScript) |
| Routing | react-router-dom 6, rute bersarang dengan layout guard |
| State | Satu `useReducer` di `AppStore.jsx`, 20 aksi, **seluruhnya di memori** |
| Backend | **Tidak ada.** Tanpa API, tanpa database, tanpa autentikasi nyata |
| Autentikasi | Simulasi: cocokkan email/ID akun dengan data contoh |
| Otorisasi | Berbasis role (`ROLE.STAFF/ADMIN/MANAGER/SUPPLIER`) + helper `canUseInternalPath()` |
| Entitas Supplier | Ada, sebagai `submission` (general, address, contact, profile 5 bagian) |
| Design system | Token CSS di `global.css`, 13 primitif UI, dua kerangka layout |
| i18n | ID/EN/ZH dengan fallback ke Indonesia, ~100 kunci |
| Dependensi | Hanya react, react-dom, react-router-dom. **Tidak ada state manager, form library, atau drag-and-drop** |
| Pengujian | Dua skrip: transisi status dan render/guard, 44 pemeriksaan |

#### Aset yang bisa dipakai ulang langsung

Ini menghemat pekerjaan besar dan harus dimanfaatkan, bukan dibuat ulang:

- `AppShell` — sidebar berkelompok, sudah mendukung penambahan kelompok menu baru.
- `PageHeader`, `Card`, `Modal`, `Toast`, `Tabs`, `EmptyState`, `StatusBadge`, `DataList`, `SectionRail`, `TileGrid`.
- `Field.jsx` — `TextField`, `SelectField`, `TextAreaField`, `Checkbox`, `CheckboxGroup` dengan ARIA lengkap.
- `FileField.jsx` — sudah memvalidasi PDF/JPG/PNG maks 2 MB. **Perlu digeneralisasi** untuk aturan lampiran per pertanyaan.
- `validation.js` + pola `collectErrors()` — cocok untuk validasi jawaban.
- `profileRules.js` — pola "aturan murni terpisah dari komponen" yang sudah terbukti bisa diuji tanpa React. Pola ini akan diulang untuk mesin questionnaire.

#### Empat kesenjangan antara spesifikasi dan bentuk proyek

Spesifikasi meminta hal-hal yang tidak dapat dipenuhi seutuhnya oleh proyek
tanpa backend. Keempatnya sudah diputuskan; catatan ini disimpan karena
konsekuensinya masih berlaku dan perlu diketahui siapa pun yang melanjutkan.

**1. Database, API, dan audit trail — proyek ini tanpa backend.**
Bagian 21, 22, dan 30 spesifikasi mensyaratkan persistensi. *Keputusan:* frontend
dibangun penuh dengan data contoh di memori; skema basis data dan spesifikasi API
tetap disusun sebagai artefak rancangan untuk tim backend.
*Konsekuensi yang masih berlaku:* menyegarkan halaman menghapus questionnaire yang
baru dibuat. Bila demo perlu bertahan antar sesi, pilihannya `localStorage` atau
menunggu backend. Audit log pun hanya hidup selama sesi.

**2. Type safety — proyek ini JavaScript.**
*Keputusan:* menyesuaikan arsitektur yang ada, tanpa migrasi TypeScript.
Bentuk entitas ditulis sebagai `@typedef` JSDoc di `engine/schema.js` sehingga editor
tetap memberi autocomplete, dan yang benar-benar menjaga data adalah `assertShape()`
yang dipanggil pada batas masuk data.
*Konsekuensi:* kesalahan tipe di dalam komponen tidak tertangkap saat kompilasi.
Penyeimbangnya ada pada pengujian mesin yang menjalankan aturan bisnisnya langsung.

**3. Drag-and-drop.**
*Keputusan:* diabaikan, tanpa dependensi baru. Penyusunan ulang seksi dan pertanyaan
akan memakai tombol naik/turun — lebih murah, tetap dapat diakses keyboard, dan tidak
menambah beban paket.

**4. Ukuran fitur melebihi seluruh aplikasi yang ada.**
Perkiraan awal 4.500–6.000 baris. Fase 1–2 yang sudah selesai berjumlah 2.888 baris,
jadi perkiraan itu terbukti wajar. *Keputusan:* dikerjakan bertahap per fase agar
setiap serahan dapat ditinjau.

---

### Arsitektur yang Disarankan

Prinsipnya: **mesin generik, definisi sebagai data.** Tidak ada tipe questionnaire
yang di-hardcode. Menambah "Sustainability Assessment" cukup membuat template baru
lewat antarmuka, tanpa menyentuh kode.

```
┌──────────────────────────────────────────────────────────────┐
│  Lapisan tampilan (React)                                    │
│  Builder · Portal pemasok · Konsol reviewer · Dashboard      │
└───────────────┬──────────────────────────────────────────────┘
                │ membaca definisi, mengirim aksi
┌───────────────▼──────────────────────────────────────────────┐
│  Lapisan mesin (JavaScript murni, tanpa React)               │
│                                                              │
│  questionnaireSchema.js   bentuk & nilai awal entitas        │
│  conditionEngine.js       menghitung pertanyaan yang tampak  │
│  answerValidation.js      wajib, format, lampiran            │
│  scoringEngine.js         skor, bobot, klasifikasi risiko    │
│  completionEngine.js      persentase per seksi & keseluruhan │
│  versioning.js            salin-beku versi, aturan imutabel  │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  Lapisan data (kini di memori, kelak API)                    │
│  QuestionnaireStore.jsx  ·  questionnaireMockData.js         │
└──────────────────────────────────────────────────────────────┘
```

Lapisan mesin sengaja bebas React. Alasannya sama seperti `profileRules.js`:
logika yang terkurung di dalam komponen tidak bisa diuji. Kelima berkas mesin ini
akan menjadi bagian yang paling padat pengujian.

#### Keputusan rancangan yang perlu Anda setujui

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Store questionnaire | Context terpisah, bukan menumpang `AppStore` | `AppStore` sudah 380 baris; menggabungkan akan menyulitkan penelusuran |
| Bentuk kondisi | Struktur data `{ all: [...] }` / `{ any: [...] }` | Dapat diserialisasi, diuji, dan kelak disimpan sebagai JSON di database |
| Imutabilitas versi | Versi terbit disalin-beku (deep freeze), bukan direferensikan | Menjamin aturan 3, 13, 14 secara struktural, bukan sekadar disiplin |
| Perpustakaan soal | Disalin nilainya saat ditambahkan | Aturan 13: perubahan pustaka tidak boleh mengubah versi terbit |
| Skoring | Modul terpisah yang bisa dimatikan | Aturan 7: Animal Free Statement tanpa skoring |

---

### Model Data (ERD)

```
Supplier ──┬──< QuestionnaireAssignment >──┬── QuestionnaireVersion
           │              │                │         │
           │              │ 1:1            │         │ 1:N
           │              ▼                │         ▼
           │    QuestionnaireResponse      │   QuestionnaireSection
           │              │ 1:N            │         │ 1:N
           │              ▼                │         ▼
           │    QuestionnaireAnswer        │      Question ──┬──< QuestionOption
           │              │ 1:N            │         │       ├──< QuestionCondition
           │              ▼                │         │       ├──< QuestionValidation
           │        AnswerAttachment       │         │       └──< AttachmentRule
           │                               │
           └──────────< AuditLog >─────────┘

QuestionnaireTemplate 1──N QuestionnaireVersion
QuestionnaireResponse 1──N QuestionnaireReview 1──N QuestionnaireComment
QuestionnaireResponse 1──N ResponseRevision   (riwayat, tidak pernah dihapus)
QuestionLibraryItem, SectionLibraryItem       (sumber salinan, tidak terhubung FK)
```

#### Entitas inti

**QuestionnaireTemplate** — identitas lintas versi.
`id, code, name, type, description, targetSupplierType, materialType, ownerId, status, createdAt, updatedAt`

**QuestionnaireVersion** — isi yang dibekukan saat terbit.
`id, templateId, versionLabel, status(draft|published|unpublished|archived), effectiveDate, expiryDate, estimatedMinutes, scoringEnabled, passingScore, riskBands[], publishedAt, publishedBy, sections[]`

**QuestionnaireSection**
`id, versionId, name, description, order, mandatory, weight`

**Question**
`id, sectionId, code, text, guidance, type, required, defaultValue, placeholder, helpText, weight, order, options[], conditions, validation, attachmentRule`

**QuestionOption**
`id, questionId, label, value, score, excludeFromScoring, order`

**QuestionCondition** — disimpan sebagai pohon, bukan baris datar:
```js
{ all: [ { questionId, operator: 'equals', value: 'yes' } ] }
{ any: [ { questionId, operator: 'in', value: ['A','B'] } ] }
```
Operator: `equals`, `notEquals`, `in`, `notIn`, `answered`, `notAnswered`, `gt`, `lt`.

**AttachmentRule** — inti dari permintaan Anda:
`required, maxFiles, maxFileSizeMb, allowedTypes[], expiryDateRequired, expiryMinDays`

**QuestionnaireAssignment**
`id, versionId, supplierId, supplierSiteId, materialCategory, materialId, dueDate, reviewerId, priority, instructions, assignedBy, assignedAt`

**QuestionnaireResponse**
`id, assignmentId, status, startedAt, submittedAt, completionPercent, score, riskLevel, currentRevision`

**QuestionnaireAnswer**
`id, responseId, questionId, value, skipped, attachments[], updatedAt`

**AnswerAttachment**
`id, answerId, fileName, fileSize, fileType, expiryDate, uploadedAt`

**AuditLog**
`id, actorId, action, objectType, objectId, previousValue, newValue, at`

---

### Alur Pengguna Utama

**A. Membuat dan menerbitkan template**
```
Admin → Questionnaires → Buat baru → isi informasi dasar
  → Builder: tambah seksi (baru / dari pustaka)
  → tambah pertanyaan (baru / dari pustaka) → atur tipe, wajib, lampiran
  → atur kondisi tampil → atur bobot & skor (opsional)
  → Pratinjau (mode pemasok) → Terbitkan
  → versi dibekukan, status Published
```

**B. Mengubah yang sudah terbit**
```
Admin → pilih template terbit → "Buat versi baru"
  → v1.0 disalin menjadi v2.0 berstatus Draft
  → v1.0 tetap utuh dan tetap melayani respons lama
```

**C. Penugasan**
```
Admin → Assignments → Buat penugasan
  → pilih questionnaire + versi + pemasok + material + tenggat + reviewer
  → notifikasi terkirim, status pemasok: Not Started
```

**D. Pengisian oleh pemasok**
```
Pemasok → My Questionnaires → Mulai
  → wizard per seksi, pertanyaan bersyarat muncul/hilang seketika
  → unggah lampiran sesuai aturan tiap pertanyaan
  → Simpan draf kapan saja, lanjut nanti
  → Kirim → prapemeriksaan wajib & lampiran → Submitted
```

**E. Tinjauan**
```
Reviewer → Reviews → pilih respons
  → lihat jawaban per seksi, buka lampiran, beri komentar per pertanyaan
  → Setujui / Tolak / Minta revisi
```

**F. Revisi**
```
Revision Required → pemasok hanya dapat mengubah pertanyaan yang ditandai
  → kirim ulang → revisi v2 tersimpan, v1 tetap ada → Submitted
```

---

### Struktur Rute

Menyambung ke `AppShell` yang ada, dengan kelompok menu baru.

```
/internal/questionnaires                     daftar template
/internal/questionnaires/baru                informasi dasar
/internal/questionnaires/:id                 ringkasan template & daftar versi
/internal/questionnaires/:id/v/:versionId    BUILDER
/internal/questionnaires/:id/v/:versionId/pratinjau
/internal/pustaka-soal                       Question Library
/internal/pustaka-seksi                      Section Library
/internal/penugasan                          daftar penugasan
/internal/penugasan/baru                     buat penugasan
/internal/tinjauan                           antrian tinjauan
/internal/tinjauan/:responseId               layar tinjauan
/internal/dashboard-questionnaire            KPI & grafik

/portal/questionnaires                       My Questionnaires
/portal/questionnaires/:responseId           wizard pengisian
/portal/questionnaires/:responseId/kirim     konfirmasi pengiriman
```

Menu sidebar bertambah kelompok **Questionnaire** (internal) dan satu butir
**Questionnaire** pada kelompok Perusahaan (pemasok).

---

### Struktur API (untuk tim backend)

Belum diimplementasikan; disusun agar frontend dapat menyambung tanpa perubahan struktur.

```
GET    /questionnaire-templates?type&status&owner&q
POST   /questionnaire-templates
GET    /questionnaire-templates/:id
PATCH  /questionnaire-templates/:id
POST   /questionnaire-templates/:id/versions          buat versi baru
GET    /questionnaire-versions/:id                    beserta seksi & pertanyaan
PATCH  /questionnaire-versions/:id                    hanya bila draft
POST   /questionnaire-versions/:id/publish
POST   /questionnaire-versions/:id/unpublish
POST   /questionnaire-versions/:id/archive

POST   /questionnaire-versions/:id/sections
PATCH  /sections/:id
DELETE /sections/:id
POST   /sections/reorder
POST   /sections/:id/questions
PATCH  /questions/:id
DELETE /questions/:id
POST   /questions/reorder

GET    /question-library?category&q
POST   /question-library
GET    /section-library?q
POST   /section-library

GET    /assignments?supplier&status&due&reviewer
POST   /assignments
GET    /assignments/:id

GET    /responses?supplier&questionnaire&status&risk
GET    /responses/:id
PATCH  /responses/:id/answers            simpan draf, sebagian
POST   /responses/:id/attachments
DELETE /attachments/:id
POST   /responses/:id/submit
POST   /responses/:id/reviews            approve | reject | request_revision
POST   /responses/:id/comments
GET    /responses/:id/revisions

GET    /questionnaire-dashboard/kpi
GET    /audit-logs?objectType&objectId
```

Aturan otorisasi ditegakkan di server, bukan hanya disembunyikan di antarmuka.

---

### Struktur Komponen

```
src/questionnaire/
  engine/
    schema.js            @typedef + pembuat entitas kosong
    conditions.js        evaluasi kondisi → daftar pertanyaan tampak
    validation.js        aturan wajib, format, lampiran
    scoring.js           skor mentah, terbobot, klasifikasi risiko
    completion.js        persentase per seksi dan keseluruhan
    versioning.js        salin-beku, aturan imutabel
    questionTypes.js     registri tipe soal (satu-satunya tempat menambah tipe)
  store/
    QuestionnaireStore.jsx
    questionnaireMockData.js
  components/
    builder/
      BuilderCanvas.jsx      SectionCard.jsx     QuestionCard.jsx
      QuestionToolbox.jsx    PropertiesPanel.jsx
      ConditionEditor.jsx    ScoringPanel.jsx    AttachmentRulePanel.jsx
      LibraryPicker.jsx
    render/
      QuestionRenderer.jsx   satu titik cabang tipe soal
      inputs/  ShortText · LongText · SingleChoice · MultiChoice · Dropdown
               YesNo · YesNoNa · NumberInput · Percentage · Currency
               DateInput · DateRange · FileUpload · Rating · Score
               Statement · Signature · Matrix
      AttachmentField.jsx    lampiran + tanggal kedaluwarsa
    shared/
      QuestionnaireStatusBadge.jsx  CompletionBar.jsx
      ScorePill.jsx                 RiskBadge.jsx
  pages/
    internal/  TemplateList · TemplateDetail · Builder · Preview
               QuestionLibrary · SectionLibrary
               AssignmentList · AssignmentCreate
               ReviewQueue · ReviewDetail · Dashboard
    supplier/  MyQuestionnaires · ResponseWizard · SubmitConfirm
```

**`questionTypes.js` adalah kunci sifat modular.** Satu registri berisi, untuk tiap
tipe: komponen input, komponen properti di builder, validator, dan pembaca skor.
Menambah tipe soal baru berarti menambah satu entri di registri — tidak ada berkas
lain yang perlu diubah. Inilah yang memenuhi bagian 30 spesifikasi.

---

### Fase Implementasi

Saya sarankan menyerahkan per fase agar dapat ditinjau bertahap, bukan sekaligus.

| Fase | Isi | Perkiraan |
|---|---|---|
| **1** | Mesin + skema + registri tipe soal + pengujian mesin. Tanpa UI. | ~900 baris |
| **2** | Store, data contoh (3 template dari bagian 25), daftar & detail template | ~700 |
| **3** | **Builder**: seksi, pertanyaan, panel properti, urutan naik/turun | ~1.300 |
| **4** | Lampiran, kondisi, skoring, pustaka soal & seksi | ~800 |
| **5** | Penugasan + portal pemasok (wizard, draf, kirim) | ~1.000 |
| **6** | Tinjauan, revisi, riwayat | ~700 |
| **7** | Dashboard, notifikasi, penyempurnaan i18n | ~600 |

Fase 1 dan 2 sebaiknya dikerjakan bersama karena tanpa data contoh mesin sulit dinilai.

---

