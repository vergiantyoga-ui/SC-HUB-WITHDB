/**
 * Klien HTTP untuk backend Paragon.
 *
 * Menggantikan supabase-js. Perbedaan yang paling terasa: tidak ada lagi
 * pustaka yang menyusun kueri di peramban. Dulu komponen dapat menulis
 * `.select().eq().order()` dan PostgREST menerjemahkannya menjadi SQL; sekarang
 * setiap kebutuhan data punya endpoint-nya sendiri.
 *
 * Itu lebih banyak kode di server, tetapi juga alasan mengapa hilangnya RLS
 * tidak langsung menjadi lubang: klien tidak dapat lagi menyusun kueri yang
 * tidak diantisipasi siapa pun.
 */

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'paragon.token';

/* ------------------------------------------------------------------ */
/* Token                                                               */
/* ------------------------------------------------------------------ */
// Disimpan di localStorage. Cookie httpOnly lebih tahan XSS, tetapi menuntut
// backend dan frontend berbagi domain — dan selama frontend di Vercel
// sementara backend di tempat lain, itu belum berlaku. Kalau keduanya kelak
// satu domain, pindahkan ke cookie: perubahannya hanya di berkas ini.

let token = null;

export function getToken() {
  if (token === null) token = localStorage.getItem(TOKEN_KEY) ?? '';
  return token || null;
}

export function setToken(value) {
  token = value ?? '';
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

/* ------------------------------------------------------------------ */
/* Permintaan                                                          */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.userMessage = message;
  }
}

async function request(method, path, { body, query } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    // Filter berupa larik dikirim berulang: ?status=a&status=b
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
    else url.searchParams.set(k, v);
  }

  const headers = {};
  const auth = getToken();
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      'Tidak dapat menghubungi server. Periksa koneksi Anda.', 0, 'network_error');
  }

  if (res.status === 401) {
    // Token kedaluwarsa atau dicabut. Dibersihkan di sini supaya aplikasi tidak
    // terus mencoba memakai token mati pada setiap permintaan berikutnya.
    setToken(null);
    throw new ApiError('Sesi Anda berakhir. Silakan masuk kembali.', 401, 'unauthorized');
  }

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(payload.error ?? 'Terjadi kesalahan.', res.status, payload.code);
  }
  return payload;
}

export const get = (path, query) => request('GET', path, { query });
export const post = (path, body) => request('POST', path, { body });
export const put = (path, body) => request('PUT', path, { body });

/**
 * URL untuk membuka berkas.
 *
 * Bukan tautan publik: endpoint memeriksa kewenangan sebelum satu byte pun
 * dikirim. Karena token ada di header dan bukan di URL, berkas dibuka lewat
 * fetch lalu diubah menjadi blob URL sementara.
 */
export async function fileUrl(fileId) {
  const res = await fetch(`${BASE}/api/files/${fileId}`, {
    headers: { authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError('Berkas tidak dapat dibuka.', res.status, 'file_error');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  // Pemanggil wajib memanggil revoke() setelah selesai, atau blob menumpuk di
  // memori sampai tab ditutup.
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/**
 * Mengunggah berkas.
 *
 * Dikirim sebagai base64 di dalam JSON, bukan multipart. Untuk berkas 2 MB
 * bedanya tidak terasa, dan ia membuat seluruh API konsisten satu format —
 * tidak ada satu endpoint yang berperilaku lain dari yang lain.
 */
export async function uploadFile({ supplierId, section, file, bucket }) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new ApiError('Berkas gagal dibaca.', 0, 'file_read'));
    reader.readAsDataURL(file);
  });

  return post('/api/files', {
    supplierId, section, bucket,
    fileName: file.name, mimeType: file.type, content: base64,
  });
}
