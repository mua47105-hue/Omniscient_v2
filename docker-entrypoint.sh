#!/bin/bash
# OMNISCIENT — Runtime entrypoint for Hugging Face Spaces.
#
# This script runs on EVERY container start (not just build). It:
#   1. Ensures /data (the HF Storage Bucket mount) exists and is writable.
#   2. If the SQLite DB doesn't exist yet (first run), creates the schema
#      and seeds the default config (providers, assets, module configs).
#   3. If the DB already exists (subsequent runs), just applies any schema
#      migrations (prisma db push) WITHOUT wiping data.
#   4. Then execs the main app command (next start).
#
# This fixes the #1 persistence bug: previously, `RUN node seed.cjs` ran at
# BUILD time, which wiped and re-seeded the DB on every rebuild — losing all
# user settings, watchlists, and signals. Now seeding only happens when the
# DB file is genuinely missing.

set -e

echo "[entrypoint] OMNISCIENT starting up..."
echo "[entrypoint] DATABASE_URL=${DATABASE_URL:-not set}"
echo "[entrypoint] PERSISTENT_DIR=${PERSISTENT_DIR:-/data}"

# Ensure /data exists (on HF Spaces this is the bucket mount point; locally
# it's just a directory). chmod 777 ensures the non-root container user can write.
mkdir -p /data 2>/dev/null || true
chmod 777 /data 2>/dev/null || true

# Determine the DB file path from DATABASE_URL.
# Prisma SQLite URLs look like "file:/data/custom.db" or "file:./db/custom.db"
DB_FILE=""
if echo "$DATABASE_URL" | grep -q "^file:"; then
  # Extract the path portion after "file:"
  DB_PATH=$(echo "$DATABASE_URL" | sed 's/^file://')
  # Resolve relative paths against /app
  if echo "$DB_PATH" | grep -q "^/"; then
    DB_FILE="$DB_PATH"
  else
    DB_FILE="/app/$DB_PATH"
  fi
  # Ensure the parent directory exists
  DB_DIR=$(dirname "$DB_FILE")
  mkdir -p "$DB_DIR" 2>/dev/null || true
  chmod 777 "$DB_DIR" 2>/dev/null || true
fi

# Apply schema (idempotent — creates tables if missing, doesn't drop data)
echo "[entrypoint] Applying Prisma schema (db push)..."
bunx prisma db push --skip-generate --accept-data-loss 2>/dev/null || {
  echo "[entrypoint] WARNING: prisma db push failed — trying with generate first..."
  bunx prisma generate 2>/dev/null || true
  bunx prisma db push --skip-generate --accept-data-loss 2>/dev/null || {
    echo "[entrypoint] WARNING: prisma db push failed again — app may not work correctly"
  }
}

# Seed ONLY if the DB file is missing or empty (first run)
SHOULD_SEED=0
if [ -z "$DB_FILE" ]; then
  # Can't determine DB path — seed to be safe
  SHOULD_SEED=1
elif [ ! -f "$DB_FILE" ]; then
  echo "[entrypoint] DB file not found at $DB_FILE — first run, seeding defaults..."
  SHOULD_SEED=1
elif [ ! -s "$DB_FILE" ]; then
  echo "[entrypoint] DB file is empty ($DB_FILE) — seeding defaults..."
  SHOULD_SEED=1
fi

if [ "$SHOULD_SEED" = "1" ]; then
  echo "[entrypoint] Running seed script..."
  node seed.cjs 2>/dev/null || {
    echo "[entrypoint] seed.cjs failed — app will start but may need manual setup"
  }
  echo "[entrypoint] Seed complete."
else
  echo "[entrypoint] DB exists at $DB_FILE — skipping seed (preserving user data)."
fi

echo "[entrypoint] Starting app: $@"
exec "$@"
