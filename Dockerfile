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
# The seed runs at RUNTIME (in docker-entrypoint.sh), NOT at build time,
# because /data (the bucket mount) is only available at runtime.
#
# NOTE: docker-entrypoint.sh is copied via `COPY . .` (it lands at
# /app/docker-entrypoint.sh). We do NOT use a separate COPY for it — that
# was causing BuildKit cache context errors on HF Spaces ("not found").

FROM node:20-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install bun for fast dependency installation
RUN npm install -g bun

# Copy package.json + install deps
COPY package.json ./
RUN bun install --frozen-lockfile || bun install

# Copy all source (including docker-entrypoint.sh → /app/docker-entrypoint.sh)
COPY . .

# Make the runtime entrypoint executable (it's already at /app/docker-entrypoint.sh
# from the COPY . . above — no separate COPY needed)
RUN chmod +x /app/docker-entrypoint.sh

# Set env defaults (HF Space Secrets/Variables override these at runtime)
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

# Expose port
EXPOSE 7860

# Runtime entrypoint: ensures DB schema exists + seeds if first run, then starts the app.
# Uses /app/docker-entrypoint.sh (copied by COPY . ., not a separate COPY).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npx", "next", "start", "-p", "7860", "-H", "0.0.0.0"]
