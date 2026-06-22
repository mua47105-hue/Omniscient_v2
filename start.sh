#!/bin/bash
set -e

echo "============================================"
echo "  OMNISCIENT — Starting on Hugging Face"
echo "============================================"

# HF Spaces sets PORT=7860. The Next.js standalone server reads HOSTNAME
# and PORT env vars. We must set HOSTNAME=0.0.0.0 so it binds to all
# interfaces (HF Spaces reverse proxy needs to reach it).
export PORT="${PORT:-7860}"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"

# DATABASE_URL must point to the baked-in SQLite DB
export DATABASE_URL="${DATABASE_URL:-file:/app/db/custom.db}"
export APP_PASSWORD="${APP_PASSWORD:-omniscient}"

echo "Port:       $PORT"
echo "Hostname:   $HOSTNAME"
echo "Database:   $DATABASE_URL"
echo ""

# Check that the DB file exists
if [ ! -f /app/db/custom.db ]; then
  echo "WARNING: DB file not found at /app/db/custom.db"
  echo "Attempting to create it..."
  mkdir -p /app/db
  # Run prisma db push to create the schema
  npx prisma db push --skip-generate 2>/dev/null || true
  # Run the seed script
  node /app/seed.cjs 2>/dev/null || true
fi

# Check that server.js exists
if [ ! -f /app/server.js ]; then
  echo "ERROR: server.js not found at /app/server.js"
  echo "Contents of /app:"
  ls -la /app/ 2>/dev/null || echo "(empty)"
  exit 1
fi

echo "Starting Next.js standalone server..."
exec node server.js
