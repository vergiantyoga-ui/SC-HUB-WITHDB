/**
 * Klien Supabase.
 *
 * Menggantikan klien HTTP ke backend Node. Perbedaan yang paling terasa:
 * tidak ada lagi 40 endpoint yang ditulis tangan. Komponen berbicara langsung
 * ke PostgREST, dan yang menahan mereka membaca data pemasok lain bukan lagi
 * sebuah `if` di server, melainkan kebijakan RLS pada tabelnya.
 *
 * Itu juga sebabnya menyusun kueri dari peramban kembali menjadi aman:
 * `.select().eq().order()` yang paling kreatif sekalipun tetap tersaring
 * kebijakan yang sama.
 */

import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !ANON_KEY) {
  throw new Error(
    'VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY belum diisi. ' +
    'Salin .env.example menjadi .env.local lalu isi keduanya.',
  );
}

/**
 * Kunci anon aman berada di peramban — ia memang dirancang untuk itu, dan
 * seluruh kewenangannya dibatasi RLS. Yang TIDAK boleh ikut ke sini adalah
 * service_role key: kunci itu melewati RLS sepenuhnya.
 */
export const supabase = createClient(URL, ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'paragon.auth',
  },
});

/* ==================================================================== */
/* Galat                                                                */
/* ==================================================================== */

/**
 * Bentuk galat dipertahankan sama dengan klien lama supaya komponen yang
 * membaca `err.userMessage` tidak perlu diubah.
 */
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.userMessage = message;
  }
}

/**
 * Menerjemahkan galat Postgres menjadi kalimat yang pantas dibaca pemasok.
 *
 * Pesan `raise exception` dari fungsi RPC sudah ditulis dalam bahasa
 * Indonesia dan memang ditujukan kepada pengguna; itu diteruskan apa adanya.
 * Sisanya — pelanggaran unik, RLS, FK — tidak, dan diganti.
 */
function translate(error) {
  const code = error?.code;
  const raw = error?.message ?? 'Terjadi kesalahan.';

  const byCode = {
    '23505': 'Data ini sudah ada.',
    '23503': 'Data acuan yang dipilih tidak ditemukan.',
    '23514': 'Isian tidak memenuhi aturan yang berlaku.',
    '42501': 'Anda tidak berwenang melakukan tindakan ini.',
    'PGRST301': 'Sesi Anda berakhir. Silakan masuk kembali.',
    // Kebijakan RLS menolak tulisan. Dari sudut pengguna ini sama saja
    // dengan tidak berwenang; menyebut "row-level security" hanya
    // membingungkan.
    '42P01': 'Sumber data tidak tersedia.',
  };

  if (raw.includes('row-level security')) {
    return new ApiError('Anda tidak berwenang mengubah data ini.', 403, code);
  }
  return new ApiError(byCode[code] ?? raw, error?.status ?? 400, code);
}

/** Membuka hasil `{ data, error }` dan melempar bila gagal. */
export function unwrap({ data, error }) {
  if (error) throw translate(error);
  return data;
}

/* ==================================================================== */
/* Sesi                                                                 */
/* ==================================================================== */

export async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Memberi tahu pemanggil setiap kali sesi berubah — termasuk ketika token
 * kedaluwarsa di tab lain. Dipakai AppStore untuk mengeluarkan pengguna
 * tanpa menunggu permintaan berikutnya gagal.
 */
export function onAuthChange(handler) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    handler(event, session);
  });
  return () => data.subscription.unsubscribe();
}

/* ==================================================================== */
/* Berkas                                                               */
/* ==================================================================== */

export const BUCKET_SUPPLIER = 'supplier-documents';
export const BUCKET_ANSWER = 'questionnaire-attachments';

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png'];

/**
 * Mengunggah satu berkas dan mencatat metadatanya.
 *
 * Jalurnya WAJIB berawalan supplier_id: kebijakan Storage membaca segmen
 * pertama untuk menentukan pemiliknya. Mengubah konvensi ini di sini saja
 * akan membuat setiap unggahan ditolak.
 *
 *   supplier-documents/<supplier_id>/<section>/<uuid>-<nama berkas>
 *
 * Batas 2 MB dan tiga tipe berkas diperiksa dua kali: sekali di sini supaya
 * pengguna tahu sebelum menunggu unggahan, sekali oleh Storage supaya
 * pemeriksaan pertama tidak dapat dilewati.
 */
export async function uploadFile(file, { supplierId, section = 'lainnya', bucket = BUCKET_SUPPLIER }) {
  if (!file) throw new ApiError('Tidak ada berkas yang dipilih.', 400);
  if (file.size > MAX_BYTES) {
    throw new ApiError('Ukuran berkas melebihi 2 MB.', 400);
  }
  if (!ACCEPTED.includes(file.type)) {
    throw new ApiError('Berkas harus berformat PDF, JPG, atau PNG.', 400);
  }
  if (!supplierId) throw new ApiError('supplierId wajib untuk mengunggah berkas.', 400);

  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${supplierId}/${section}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw translate(error);

  // Metadata dicatat setelah unggahan berhasil. Urutannya sengaja: baris
  // file_object yang menunjuk berkas tidak ada lebih menyesatkan daripada
  // berkas yang belum punya barisnya.
  const row = unwrap(
    await supabase
      .from('file_object')
      .insert({
        bucket,
        storage_path: path,
        supplier_id: supplierId,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: await currentUserId(),
      })
      .select()
      .single(),
  );

  return row; // { id, storage_path, file_name, … } — simpan `id` di kolom *_file_id
}

/**
 * URL bertanda tangan, berumur pendek.
 *
 * Bucket-nya privat; tidak ada URL publik yang dapat disimpan atau dibagikan.
 */
export async function fileUrl(fileId, expiresInSeconds = 300) {
  if (!fileId) return null;

  const row = unwrap(
    await supabase
      .from('file_object')
      .select('bucket, storage_path')
      .eq('id', fileId)
      .maybeSingle(),
  );
  if (!row) return null;

  const { data, error } = await supabase.storage
    .from(row.bucket)
    .createSignedUrl(row.storage_path, expiresInSeconds);
  if (error) throw translate(error);

  return data.signedUrl;
}

/** Menghapus berkas beserta metadatanya. Trigger di basis data ikut merapikan. */
export async function removeFile(fileId) {
  const row = unwrap(
    await supabase
      .from('file_object')
      .select('bucket, storage_path')
      .eq('id', fileId)
      .maybeSingle(),
  );
  if (!row) return;

  const { error } = await supabase.storage.from(row.bucket).remove([row.storage_path]);
  if (error) throw translate(error);
}
