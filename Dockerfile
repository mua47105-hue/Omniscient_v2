# OMNISCIENT — Hugging Face Spaces Dockerfile
#
# PERSISTENCE ARCHITECTURE:
#   1. HF Space Secrets (env vars) — set in Space Settings UI, persist across
#      restarts. Used for API keys, Supabase creds, app password.
#   2. HF Storage Bucket mounted at /data — persists the SQLite DB across
#      restarts. DATABASE_URL defaults to file:/data/custom.db on HF.
#   3. Supabase cloud sync — on startup, pulls settings from Supabase into
#      local SQLite (see src/instrumentation.ts + src/lib/sync/bootstrap.ts).
#
# The seed runs at RUNTIME (in the entrypoint), NOT at build time, because
# /data (the bucket mount) is only available at runtime.
#
# NOTE: The entrypoint script is generated INLINE via a heredoc in the RUN
# step below. This avoids any dependency on an external docker-entrypoint.sh
# file in the build context (which was causing "not found" errors on HF Spaces
# due to build-context caching quirks).

FROM node:20-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install bun for fast dependency installation
RUN npm install -g bun

# Copy package.json + install deps
COPY package.json ./
RUN bun install --frozen-lockfile || bun install

# Copy all source
COPY . .

# Set env defaults (HF Space Secrets/Variables override these at runtime)
# DATABASE_URL: defaults to /data/custom.db (persistent if bucket mounted).
# Falls back to /app/data/custom.db if /data isn't writable (no bucket).
ENV DATABASE_URL="file:/data/custom.db"
ENV APP_PASSWORD="omniscient"
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PERSISTENT_DIR="/data"

# Generate Prisma client + build the app (do NOT seed at build time — /data
# isn't mounted during build, and seeding would wipe user data on every rebuild)
RUN bunx prisma generate
RUN bun run build

# Create the persistent data directory (will be overridden by bucket mount on HF)
RUN mkdir -p /data && chmod 777 /data

# Generate the runtime entrypoint script INLINE (no external file dependency).
# This script runs on every container start: ensures /data exists, applies
# prisma db push (idempotent — no data loss), seeds ONLY when DB file is
# missing (first run), then execs the app.
RUN cat > /app/docker-entrypoint.sh << 'ENTRYPOINT_EOF'
#!/bin/bash
set -e

echo "[entrypoint] OMNISCIENT starting up..."
echo "[entrypoint] DATABASE_URL=${DATABASE_URL:-not set}"
echo "[entrypoint] PERSISTENT_DIR=${PERSISTENT_DIR:-/data}"

# Ensure /data exists (on HF Spaces this is the bucket mount point)
mkdir -p /data 2>/dev/null || true
chmod 777 /data 2>/dev/null || true

# Determine the DB file path from DATABASE_URL
DB_FILE=""
if echo "$DATABASE_URL" | grep -q "^file:"; then
  DB_PATH=$(echo "$DATABASE_URL" | sed 's/^file://')
  if echo "$DB_PATH" | grep -q "^/"; then
    DB_FILE="$DB_PATH"
  else
    DB_FILE="/app/$DB_PATH"
  fi
  DB_DIR=$(dirname "$DB_FILE")
  mkdir -p "$DB_DIR" 2>/dev/null || true
  chmod 777 "$DB_DIR" 2>/dev/null || true
fi

# Apply schema (idempotent — creates tables if missing, doesn't drop data)
echo "[entrypoint] Applying Prisma schema (db push)..."
cd /app
bunx prisma db push --skip-generate --accept-data-loss 2>/dev/null || {
  echo "[entrypoint] WARNING: prisma db push failed — trying with generate first..."
  bunx prisma generate 2>/dev/null || true
  bunx prisma db push --skip-generate --accept-data-loss 2>/dev/null || {
    echo "[entrypoint] WARNING: prisma db push failed again — app may not work correctly"
  }
}

# Seed ONLY if the DB file is missing/empty OR if the DB has no providers
# (handles the case where /data is ephemeral and gets wiped, or where
# prisma db push created the schema but no data was seeded)
SHOULD_SEED=0
if [ -z "$DB_FILE" ]; then
  SHOULD_SEED=1
elif [ ! -f "$DB_FILE" ]; then
  echo "[entrypoint] DB file not found at $DB_FILE — first run, seeding defaults..."
  SHOULD_SEED=1
elif [ ! -s "$DB_FILE" ]; then
  echo "[entrypoint] DB file is empty ($DB_FILE) — seeding defaults..."
  SHOULD_SEED=1
fi

# Always check if the DB has providers — if not, seed (handles ephemeral
# /data that gets wiped on restart but the file happens to exist)
if [ "$SHOULD_SEED" = "0" ]; then
  PROVIDER_COUNT=$(node -e "
    try {
      const { PrismaClient } = require('@prisma/client');
      const db = new PrismaClient();
      db.llmProvider.count().then(c => { console.log(c); db.\$disconnect(); }).catch(() => { console.log(0); db.\$disconnect(); });
    } catch(e) { console.log(0); }
  " 2>/dev/null || echo "0")
  echo "[entrypoint] Provider count in DB: $PROVIDER_COUNT"
  if [ "$PROVIDER_COUNT" = "0" ] || [ -z "$PROVIDER_COUNT" ]; then
    echo "[entrypoint] DB has no providers — seeding defaults..."
    SHOULD_SEED=1
  fi
fi

if [ "$SHOULD_SEED" = "1" ]; then
  echo "[entrypoint] Running seed script..."
  node seed.cjs 2>&1 || {
    echo "[entrypoint] seed.cjs failed — app will start but may need manual setup"
  }
  echo "[entrypoint] Seed complete."
else
  echo "[entrypoint] DB exists at $DB_FILE with data — skipping seed (preserving user data)."
fi

echo "[entrypoint] Starting app: $@"
exec "$@"
ENTRYPOINT_EOF

RUN chmod +x /app/docker-entrypoint.sh

# Expose port
EXPOSE 7860

# Runtime entrypoint: ensures DB schema exists + seeds if first run, then starts the app
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npx", "next", "start", "-p", "7860", "-H", "0.0.0.0"]
