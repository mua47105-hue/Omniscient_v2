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

  // 1b. Other preset providers (with placeholder keys — users just paste their key)
  const presetProviders = [
    { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "PASTE_YOUR_OPENROUTER_API_KEY", notes: "Aggregates 100+ models. Get key: openrouter.ai/keys", models: [{ modelId: "meta-llama/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B", contextWindow: 128000, freeTierRpm: 50 }] },
    { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "PASTE_YOUR_GROQ_API_KEY", notes: "Ultra-fast inference (500+ tok/s). Get key: console.groq.com/keys", models: [{ modelId: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B Versatile", contextWindow: 128000, freeTierRpm: 30 }] },
    { name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "PASTE_YOUR_GEMINI_API_KEY", notes: "Google Gemini. Free tier: 15 RPM. Get key: aistudio.google.com/app/apikey", models: [{ modelId: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", contextWindow: 1048576, freeTierRpm: 15 }] },
    { name: "Mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: "PASTE_YOUR_MISTRAL_API_KEY", notes: "Mistral AI. Get key: console.mistral.ai/api-keys", models: [{ modelId: "mistral-large-latest", displayName: "Mistral Large", contextWindow: 128000, freeTierRpm: 1 }] },
    { name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "PASTE_YOUR_NVIDIA_API_KEY", notes: "NVIDIA NIM. Get key: build.nvidia.com", models: [{ modelId: "meta/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B", contextWindow: 128000, freeTierRpm: 40 }] },
    { name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", apiKey: "PASTE_YOUR_CEREBRAS_API_KEY", notes: "Fastest inference (2000+ tok/s). Get key: cloud.cerebras.ai", models: [{ modelId: "llama-3.3-70b", displayName: "Llama 3.3 70B", contextWindow: 128000, freeTierRpm: 20 }] },
    { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiKey: "PASTE_YOUR_DEEPSEEK_API_KEY", notes: "Very cheap ($0.27/M tokens). Get key: platform.deepseek.com/api_keys", models: [{ modelId: "deepseek-chat", displayName: "DeepSeek V3", contextWindow: 64000, freeTierRpm: 60 }] },
    { name: "xAI Grok", baseUrl: "https://api.x.ai/v1", apiKey: "PASTE_YOUR_XAI_API_KEY", notes: "Grok. $25 free credit/month. Get key: console.x.ai", models: [{ modelId: "grok-3", displayName: "Grok 3", contextWindow: 131072, freeTierRpm: 30 }] },
  ];
  let presetCount = 0;
  for (const p of presetProviders) {
    const ex = await db.llmProvider.findUnique({ where: { name: p.name } });
    if (!ex) {
      await db.llmProvider.create({
        data: {
          name: p.name,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          notes: p.notes,
          isActive: false, // inactive until user pastes a real key
          models: { create: p.models.map(m => ({ ...m, isActive: true, capabilities: '["text","json"]' })) },
        },
      });
      presetCount++;
    }
  }
  if (presetCount > 0) console.log("  ✓ " + presetCount + " preset providers added (paste API keys to activate)");

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
  // Data source API keys (placeholder — users paste real keys in Settings → Data Sources)
  for (const ds of [
    { key: "finnhub_api_key", val: "PASTE_YOUR_FINNHUB_API_KEY" },
    { key: "alpha_vantage_api_key", val: "PASTE_YOUR_ALPHA_VANTAGE_API_KEY" },
    { key: "twelvedata_api_key", val: "PASTE_YOUR_TWELVEDATA_API_KEY" },
    { key: "tiingo_api_key", val: "PASTE_YOUR_TIINGO_API_KEY" },
    { key: "coingecko_api_key", val: "PASTE_YOUR_COINGECKO_API_KEY" },
    { key: "fmp_api_key", val: "PASTE_YOUR_FMP_API_KEY" },
    { key: "news_api_key", val: "PASTE_YOUR_NEWS_API_KEY" },
  ]) {
    await db.setting.upsert({ where: { key: ds.key }, create: { key: ds.key, value: JSON.stringify(ds.val) }, update: {} });
  }
  console.log("  ✓ Default settings created (7 data source keys)");

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
