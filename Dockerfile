# OMNISCIENT — Hugging Face Spaces Dockerfile
#
# ROOT CAUSE of "stuck at starting":
#   The previous Dockerfile used `oven/bun:1` as the RUNNER image and ran
#   `bun server.js`. But Next.js standalone server.js is designed for Node.js.
#   Bun's compatibility mode doesn't properly bind the HTTP server to the port
#   — it prints "Ready in 0ms" (suspiciously fast) but never actually serves.
#
# FIX:
#   - Build stage: keep bun (fast installs + build)
#   - Runner stage: use node:18-slim (standalone server.js is designed for Node)
#   - Install openssl in runner (Prisma needs it for SQLite)
#   - Seed with a .cjs file (no @/ path aliases, works with plain node)
#   - Don't swallow seed errors (remove || true)

# ─── Stage 1: deps (bun for fast install) ───
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --frozen-lockfile || bun install

# ─── Stage 2: builder (bun for build) ───
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"
ENV NEXT_TELEMETRY_DISABLED=1

# 1. Generate Prisma client
RUN bunx prisma generate

# 2. Create the SQLite database + tables
RUN bunx prisma db push --skip-generate

# 3. Build Next.js (standalone output)
#    The build script runs swap-provider.cjs + prisma generate + next build + copies static
RUN bun run build

# 4. Seed the database — write a standalone .cjs file (no @/ aliases)
COPY seed.cjs ./seed.cjs
RUN node seed.cjs

# 5. Copy Prisma client into standalone output
RUN mkdir -p .next/standalone/node_modules/.prisma && \
    cp -r node_modules/.prisma/* .next/standalone/node_modules/.prisma/
RUN mkdir -p .next/standalone/node_modules/@prisma && \
    cp -r node_modules/@prisma/client .next/standalone/node_modules/@prisma/client

# 6. Copy the seeded DB into standalone output
RUN mkdir -p .next/standalone/db && cp db/custom.db .next/standalone/db/custom.db

# ─── Stage 3: runner (Node.js — standalone server.js needs Node, not Bun) ───
FROM node:18-slim AS runner
WORKDIR /app

# Install openssl (Prisma needs it even for SQLite)
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the standalone server (includes server.js + minimal node_modules)
COPY --from=builder /app/.next/standalone ./
# Copy static assets (not included in standalone by default)
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 7860

# Use node, NOT bun — Next.js standalone is designed for Node.js
CMD ["node", "server.js"]
