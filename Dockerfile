# OMNISCIENT — Hugging Face Spaces Dockerfile
#
# ROOT CAUSE of "stuck at starting":
#   Next.js standalone server.js was run with `bun server.js` or `node server.js`
#   but without HOSTNAME=0.0.0.0. Without it, the server binds to localhost
#   only, and HF Spaces' reverse proxy can't reach it → appears stuck.
#
#   Also: the standalone server.js needs the DB + Prisma client at the right
#   paths, and the start script must set all env vars BEFORE launching node.
#
# SOLUTION (inspired by HuggingMes pattern):
#   - Use a start.sh script that sets HOSTNAME=0.0.0.0 explicitly
#   - Use node:18-slim as runner (standalone is designed for Node.js)
#   - seed.cjs seeds the DB during build (not at runtime)
#   - No multi-stage complexity — simple, reliable, debuggable

# ─── Stage 1: Build with Bun (fast installs) ───
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json ./
RUN bun install --frozen-lockfile || bun install

COPY . .

ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"
ENV NEXT_TELEMETRY_DISABLED=1

# 1. Generate Prisma client
RUN bunx prisma generate

# 2. Create the SQLite database + tables
RUN bunx prisma db push --skip-generate

# 3. Build Next.js (standalone output)
RUN bun run build

# 4. Seed the database
RUN node seed.cjs

# 5. Copy Prisma client + DB + seed into standalone
RUN mkdir -p .next/standalone/node_modules/.prisma && \
    cp -r node_modules/.prisma/* .next/standalone/node_modules/.prisma/
RUN mkdir -p .next/standalone/node_modules/@prisma && \
    cp -r node_modules/@prisma/client .next/standalone/node_modules/@prisma/client
RUN mkdir -p .next/standalone/db && cp db/custom.db .next/standalone/db/custom.db
RUN cp seed.cjs .next/standalone/seed.cjs
RUN cp start.sh .next/standalone/start.sh
RUN chmod +x .next/standalone/start.sh

# ─── Stage 2: Runner with Node.js ───
FROM node:18-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"
ENV NEXT_TELEMETRY_DISABLED=1

# Copy everything from the standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 7860

# Use the start script that sets HOSTNAME=0.0.0.0 before launching node
CMD ["bash", "start.sh"]
