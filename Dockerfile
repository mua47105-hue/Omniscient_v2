# OMNISCIENT — Hugging Face Spaces Dockerfile
# Multi-stage build: install → build → seed → minimal runtime
# Runs on port 7860 (HF Spaces default)

# ─── Stage 1: deps ───
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --frozen-lockfile || bun install

# ─── Stage 2: builder ───
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Set env for build (SQLite path + standalone output)
ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"
# Generate Prisma client + push schema to create the DB file + build Next.js
RUN bunx prisma generate
RUN bunx prisma db push --skip-generate
# Build Next.js (standalone output)
RUN bun run build
# Seed the database (Pollinations provider + crypto assets + schedule jobs)
RUN bun run src/lib/db/seed.ts || true
# Copy standalone output + Prisma client + DB
RUN cp -r node_modules/.prisma .next/standalone/node_modules/.pristine 2>/dev/null; \
    cp -r node_modules/@prisma .next/standalone/node_modules/@prisma 2>/dev/null; \
    cp -r node_modules/.prisma .next/standalone/node_modules/.prisma 2>/dev/null; \
    true
RUN cp -r db .next/standalone/db 2>/dev/null; true

# ─── Stage 3: runner ───
FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Copy Prisma client + DB
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/db ./db

EXPOSE 7860
CMD ["bun", "server.js"]
