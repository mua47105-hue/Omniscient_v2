// Standalone seed script — no @/ path aliases, works with plain `node seed.cjs`
// Run AFTER prisma db push has created the SQLite database.
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding OMNISCIENT database...");

  // 1. Pollinations LLM provider (free, no API key)
  const existing = await db.llmProvider.findUnique({ where: { name: "Pollinations" } });
  if (!existing) {
    const p = await db.llmProvider.create({
      data: {
        name: "Pollinations",
        baseUrl: "https://text.pollinations.ai/openai",
        apiKey: "pollinations-free",
        notes: "Free LLM, NO API KEY needed. Model: openai (gpt-oss-20b).",
        isActive: true,
        models: {
          create: [{ modelId: "openai", displayName: "OpenAI (gpt-oss-20b)", contextWindow: 128000, freeTierRpm: 60 }],
        },
      },
    });
    console.log("  ✓ Pollinations provider created (ACTIVE)");

    // Wire module configs to Pollinations
    const m = await db.llmModel.findFirst({ where: { providerId: p.id } });
    if (m) {
      for (const c of [
        { moduleKey: "crypto_technical", layer: "deep_reasoning" },
        { moduleKey: "news_sentiment", layer: "sentiment" },
        { moduleKey: "macro_analysis", layer: "macro" },
      ]) {
        await db.moduleModelConfig.upsert({
          where: { moduleKey_layer: c },
          create: { ...c, modelId: m.id, providerId: p.id, temperature: 0.3, enabled: true },
          update: {},
        });
      }
      console.log("  ✓ Module configs wired to Pollinations/" + m.modelId);
    }
  } else {
    console.log("  ✓ Pollinations already exists");
  }

  // 2. Crypto assets
  const assets = [
    { symbol: "BTCUSDT", name: "Bitcoin", assetClass: "crypto", exchange: "binance" },
    { symbol: "ETHUSDT", name: "Ethereum", assetClass: "crypto", exchange: "binance" },
    { symbol: "SOLUSDT", name: "Solana", assetClass: "crypto", exchange: "binance" },
    { symbol: "BNBUSDT", name: "BNB", assetClass: "crypto", exchange: "binance" },
    { symbol: "XRPUSDT", name: "XRP", assetClass: "crypto", exchange: "binance" },
    { symbol: "ADAUSDT", name: "Cardano", assetClass: "crypto", exchange: "binance" },
    { symbol: "DOGEUSDT", name: "Dogecoin", assetClass: "crypto", exchange: "binance" },
    { symbol: "AVAXUSDT", name: "Avalanche", assetClass: "crypto", exchange: "binance" },
    { symbol: "LINKUSDT", name: "Chainlink", assetClass: "crypto", exchange: "binance" },
    { symbol: "MATICUSDT", name: "Polygon", assetClass: "crypto", exchange: "binance" },
    { symbol: "POLUSDT", name: "Polygon", assetClass: "crypto", exchange: "binance" },
  ];
  for (const a of assets) {
    await db.asset.upsert({ where: { symbol: a.symbol }, create: { ...a, meta: "{}" }, update: {} });
  }
  console.log("  ✓ " + assets.length + " crypto assets seeded");

  // 3. Default watchlist
  await db.watchlist.upsert({
    where: { name: "Crypto Top 10" },
    create: { name: "Crypto Top 10", assetClass: "crypto", symbols: JSON.stringify(assets.map(a => a.symbol)) },
    update: {},
  });
  console.log("  ✓ Default watchlist created");

  // 4. Settings
  await db.setting.upsert({
    where: { key: "default_threshold" },
    create: { key: "default_threshold", value: JSON.stringify({ minConviction: 60, directions: ["long", "short"] }) },
    update: {},
  });
  await db.setting.upsert({
    where: { key: "alert_thresholds" },
    create: { key: "alert_thresholds", value: "{}" },
    update: {},
  });
  console.log("  ✓ Default settings created");

  // 5. Schedule jobs
  for (const j of [
    { moduleKey: "crypto_technical", cronExpr: "*/15 * * * *", enabled: true },
    { moduleKey: "news_sentiment", cronExpr: "*/30 * * * *", enabled: false },
    { moduleKey: "macro_analysis", cronExpr: "0 * * * *", enabled: false },
  ]) {
    await db.scheduleJob.upsert({
      where: { moduleKey: j.moduleKey },
      create: j,
      update: { enabled: j.enabled },
    });
  }
  console.log("  ✓ 3 schedule jobs (crypto_technical enabled)");

  console.log("\n✅ Seed complete! Pollinations (free, no key) is the default LLM.");
}

main()
  .catch((e) => { console.error("❌ SEED FAILED:", e); process.exit(1); })
  .finally(() => db.$disconnect());
