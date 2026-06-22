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
ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"

# Generate Prisma client + create DB
RUN bunx prisma generate
RUN bunx prisma db push --skip-generate

# Build Next.js (standalone output)
RUN bun run build

# Seed the database using an inline script (avoids @/ path alias issues with bun run)
RUN bun -e "\
  const { PrismaClient } = require('@prisma/client'); \
  const db = new PrismaClient(); \
  async function main() { \
    console.log('Seeding...'); \
    const p = await db.llmProvider.create({ data: { name: 'Pollinations', baseUrl: 'https://text.pollinations.ai/openai', apiKey: 'pollinations-free', notes: 'Free LLM, no key', isActive: true, models: { create: [{ modelId: 'openai', displayName: 'OpenAI (gpt-oss-20b)', contextWindow: 128000, freeTierRpm: 60 }] } } }).catch(() => null); \
    if (p) { const m = await db.llmModel.findFirst({ where: { providerId: p.id } }); \
      if (m) { for (const c of [{ moduleKey: 'crypto_technical', layer: 'deep_reasoning' }, { moduleKey: 'news_sentiment', layer: 'sentiment' }, { moduleKey: 'macro_analysis', layer: 'macro' }]) { await db.moduleModelConfig.upsert({ where: { moduleKey_layer: c }, create: { ...c, modelId: m.id, providerId: p.id, temperature: 0.3, enabled: true }, update: {} }); } } \
    console.log('Pollinations seeded'); } \
    const assets = [{ symbol: 'BTCUSDT', name: 'Bitcoin', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'ETHUSDT', name: 'Ethereum', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'SOLUSDT', name: 'Solana', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'BNBUSDT', name: 'BNB', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'XRPUSDT', name: 'XRP', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'ADAUSDT', name: 'Cardano', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'DOGEUSDT', name: 'Dogecoin', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'AVAXUSDT', name: 'Avalanche', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'LINKUSDT', name: 'Chainlink', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'MATICUSDT', name: 'Polygon', assetClass: 'crypto', exchange: 'binance' }, { symbol: 'POLUSDT', name: 'Polygon', assetClass: 'crypto', exchange: 'binance' }]; \
    for (const a of assets) await db.asset.upsert({ where: { symbol: a.symbol }, create: { ...a, meta: '{}' }, update: {} }); \
    console.log(assets.length + ' assets seeded'); \
    await db.watchlist.upsert({ where: { name: 'Crypto Top 10' }, create: { name: 'Crypto Top 10', assetClass: 'crypto', symbols: JSON.stringify(assets.map(a => a.symbol)) }, update: {} }); \
    await db.setting.upsert({ where: { key: 'default_threshold' }, create: { key: 'default_threshold', value: JSON.stringify({ minConviction: 60, directions: ['long', 'short'] }) }, update: {} }); \
    await db.setting.upsert({ where: { key: 'alert_thresholds' }, create: { key: 'alert_thresholds', value: '{}' }, update: {} }); \
    for (const j of [{ moduleKey: 'crypto_technical', cronExpr: '*/15 * * * *', enabled: true }, { moduleKey: 'news_sentiment', cronExpr: '*/30 * * * *', enabled: false }, { moduleKey: 'macro_analysis', cronExpr: '0 * * * *', enabled: false }]) { await db.scheduleJob.upsert({ where: { moduleKey: j.moduleKey }, create: j, update: { enabled: j.enabled } }); } \
    console.log('Seed complete!'); \
  } \
  main().catch(e => { console.error(e); }).finally(() => db.\$disconnect()); \
"

# Copy Prisma client + DB to standalone
RUN cp -r node_modules/.prisma .next/standalone/node_modules/.prisma 2>/dev/null; true
RUN cp -r node_modules/@prisma .next/standalone/node_modules/@prisma 2>/dev/null; true
RUN cp -r db .next/standalone/db 2>/dev/null; true

# ─── Stage 3: runner ───
FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL="file:/app/db/custom.db"
ENV APP_PASSWORD="omniscient"

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/db ./db

EXPOSE 7860
CMD ["bun", "server.js"]
