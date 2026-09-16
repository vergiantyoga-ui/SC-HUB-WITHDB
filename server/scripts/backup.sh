#!/usr/bin/env bash
# =====================================================================
# Backup basis data dan unggahan
# =====================================================================
# Supabase mencadangkan otomatis. SQLite tidak — sejak pindah, ini tanggung
# jawab Anda, dan tidak ada yang akan mengingatkan bila terlewat.
#
# Memakai `sqlite3 .backup`, BUKAN cp. Dalam mode WAL sebagian data berada di
# berkas -wal yang terpisah, sehingga menyalin berkas .db saja selagi server
# berjalan menghasilkan salinan yang rusak — dan rusaknya baru ketahuan saat
# Anda benar-benar membutuhkannya.
#
# Jadwalkan harian, mis. lewat cron:
#   0 2 * * * /app/scripts/backup.sh >> /data/backup.log 2>&1
# =====================================================================
set -euo pipefail

DB_FILE="${DB_FILE:-/data/paragon.db}"
STORAGE_DIR="${STORAGE_DIR:-/data/storage}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

echo "[$stamp] mencadangkan basis data…"
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/paragon-$stamp.db'"

# Memeriksa hasilnya sebelum yang lama dihapus. Backup yang tidak pernah
# diverifikasi bukan backup, hanya berkas.
if ! sqlite3 "$BACKUP_DIR/paragon-$stamp.db" "pragma integrity_check;" | grep -q '^ok$'; then
  echo "[$stamp] GAGAL: salinan tidak lolos integrity_check" >&2
  rm -f "$BACKUP_DIR/paragon-$stamp.db"
  exit 1
fi

if [ -d "$STORAGE_DIR" ]; then
  echo "[$stamp] mencadangkan unggahan…"
  tar -czf "$BACKUP_DIR/storage-$stamp.tar.gz" -C "$(dirname "$STORAGE_DIR")" \
    "$(basename "$STORAGE_DIR")"
else
  # Belum ada unggahan sama sekali. Bukan galat; cukup dicatat supaya tidak
  # tampak seperti backup yang diam-diam melewatkan sesuatu.
  echo "[$stamp] $STORAGE_DIR belum ada; tidak ada unggahan untuk dicadangkan."
fi

# Menghapus yang lebih tua dari KEEP_DAYS, tetapi hanya SETELAH yang baru
# terbukti sah di atas.
find "$BACKUP_DIR" -name 'paragon-*.db'      -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz'  -mtime "+$KEEP_DAYS" -delete

echo "[$stamp] selesai. Tersimpan di $BACKUP_DIR"
ls -lh "$BACKUP_DIR" | tail -5
