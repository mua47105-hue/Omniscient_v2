# OMNISCIENT — Hugging Face Spaces Dockerfile
# Single-stage build — simple, reliable, no standalone server.js

# Cache-bust: forces HF to rebuild ALL layers, not use stale cache
ARG CACHE_BUST=1

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

# Set env
ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Generate Prisma + create DB + build + seed
RUN bunx prisma generate
RUN bunx prisma db push --skip-generate
RUN bun run build
RUN node seed.cjs

# Expose port
EXPOSE 7860

# Start the app — next start handles HOSTNAME and PORT correctly
CMD ["npx", "next", "start", "-p", "7860", "-H", "0.0.0.0"]
