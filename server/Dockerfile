# =====================================================================
# Paragon backend — Node + SQLite
# =====================================================================
# Dua tahap. Tahap pertama memasang alat kompilasi yang dibutuhkan
# better-sqlite3 bila binary siap pakai tidak tersedia untuk arsitektur ini;
# tahap kedua hanya membawa hasilnya. Image akhir tidak memuat compiler —
# lebih kecil, dan lebih sedikit yang perlu ditambal saat ada CVE.
# =====================================================================

FROM node:22-bookworm-slim AS build

WORKDIR /app

# Alat kompilasi untuk modul native. Dibuang bersama tahap ini.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# package.json disalin lebih dulu supaya lapisan npm ci ter-cache dan tidak
# diulang setiap kali kode berubah.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# ---------------------------------------------------------------------

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# sqlite3 CLI dipakai skrip backup: `.backup` menangani mode WAL dengan benar,
# sedangkan cp biasa akan menghasilkan salinan rusak.
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY package.json ./
COPY scripts ./scripts

# Basis data dan unggahan HARUS berada di volume, bukan di dalam image.
# Berkas di dalam image hilang setiap kali kontainer dibuat ulang.
ENV DB_FILE=/data/paragon.db
ENV STORAGE_DIR=/data/storage
ENV PORT=8080

# Berjalan sebagai pengguna biasa. Kepemilikan /data disetel saat volume
# dipasang; user `node` bawaan image sudah ada dengan uid 1000.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8080

# Pemeriksaan kesehatan memakai endpoint yang memang sudah ada.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
