// Seed default configuration: LLM providers (templates), default crypto watchlist, schedule jobs.
// Run with: bun run src/lib/db/seed.ts

import { db } from '@/lib/db';

async function main() {
  console.log('🌱 Seeding default config...');

  const providers = [
    {
      // Pollinations — free, no API key, always available. Seeded ACTIVE so the
      // Lazy Brain can run LLM analysis out-of-the-box on a free stack with zero
      // configuration. OpenAI-compatible endpoint at /openai/chat/completions,
      // returns usage tokens (the brain tracks these for the budget guard).
      name: 'Pollinations',
      baseUrl: 'https://text.pollinations.ai/openai',
      apiKey: 'pollinations-free',
      notes: 'Pollinations — free LLM, NO API KEY needed. Always available. The default for the Lazy Brain. Model: openai (gpt-oss-20b, anonymous tier).',
      active: true,
      models: [
        { modelId: 'openai', displayName: 'OpenAI (gpt-oss-20b)', contextWindow: 128000, freeTierRpm: 60 },
      ],
    },
    {
      name: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'PASTE_YOUR_GEMINI_API_KEY',
      notes: 'Google Gemini API. Free tier ~10 RPM Flash models. Get key at https://aistudio.google.com/apikey',
      models: [
        { modelId: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextWindow: 1048576, freeTierRpm: 10 },
        { modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', contextWindow: 1048576, freeTierRpm: 10 },
        { modelId: 'gemini-flash-latest', displayName: 'Gemini Flash (latest)', contextWindow: 1048576, freeTierRpm: 10 },
      ],
    },
    {
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'PASTE_YOUR_GROQ_API_KEY',
      notes: 'Groq — ultra-fast inference. Free ~30 RPM. Get key at https://console.groq.com/keys',
      models: [
        { modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B', contextWindow: 128000, freeTierRpm: 30 },
        { modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', contextWindow: 128000, freeTierRpm: 30 },
      ],
    },
    {
      name: 'NVIDIA NIM',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'PASTE_YOUR_NVIDIA_API_KEY',
      notes: 'NVIDIA NIM — large models. Free ~40 RPM. Get key at https://build.nvidia.com',
      models: [
        { modelId: 'meta/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B (NIM)', contextWindow: 128000, freeTierRpm: 40 },
        { modelId: 'deepseek-ai/deepseek-r1', displayName: 'DeepSeek R1', contextWindow: 128000, freeTierRpm: 40 },
        { modelId: 'mistralai/mistral-nemotron', displayName: 'Mistral Nemotron', contextWindow: 128000, freeTierRpm: 40 },
      ],
    },
    {
      name: 'Mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey: 'PASTE_YOUR_MISTRAL_API_KEY',
      notes: 'Mistral AI. Free tier. Get key at https://console.mistral.ai/api-keys',
      models: [
        { modelId: 'mistral-large-latest', displayName: 'Mistral Large', contextWindow: 128000, freeTierRpm: 10 },
        { modelId: 'mistral-small-latest', displayName: 'Mistral Small', contextWindow: 32000, freeTierRpm: 30 },
        { modelId: 'open-mistral-nemo', displayName: 'Mistral Nemo', contextWindow: 128000, freeTierRpm: 30 },
      ],
    },
    {
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'PASTE_YOUR_OPENROUTER_API_KEY',
      notes: 'OpenRouter — aggregates many providers. Free models are often rate-limited; paid models like llama-3.3-70b are cheap + reliable. Get key at https://openrouter.ai/keys',
      models: [
        { modelId: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B (paid, fast)', contextWindow: 128000, freeTierRpm: 50 },
        { modelId: 'meta-llama/llama-3.3-70b-instruct:free', displayName: 'Llama 3.3 70B (free, rate-limited)', contextWindow: 128000, freeTierRpm: 20 },
        { modelId: 'google/gemini-2.0-flash-001', displayName: 'Gemini 2.0 Flash (paid)', contextWindow: 1048576, freeTierRpm: 50 },
      ],
    },
  ];

  for (const p of providers) {
    const existing = await db.llmProvider.findUnique({ where: { name: p.name } });
    if (existing) {
      console.log(`  ✓ Provider "${p.name}" exists, skipping`);
      continue;
    }
    await db.llmProvider.create({
      data: {
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        notes: p.notes,
        isActive: (p as any).active === true,
        models: { create: p.models },
      },
    });
    console.log(`  ✓ Created provider "${p.name}" with ${p.models.length} models${(p as any).active ? ' (ACTIVE)' : ''}`);
  }

  const cryptoAssets = [
    { symbol: 'BTCUSDT', name: 'Bitcoin', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'bitcoin' }) },
    { symbol: 'ETHUSDT', name: 'Ethereum', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'ethereum' }) },
    { symbol: 'SOLUSDT', name: 'Solana', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'solana' }) },
    { symbol: 'BNBUSDT', name: 'BNB', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'binancecoin' }) },
    { symbol: 'XRPUSDT', name: 'XRP', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'ripple' }) },
    { symbol: 'ADAUSDT', name: 'Cardano', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'cardano' }) },
    { symbol: 'DOGEUSDT', name: 'Dogecoin', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'dogecoin' }) },
    { symbol: 'AVAXUSDT', name: 'Avalanche', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'avalanche-2' }) },
    { symbol: 'LINKUSDT', name: 'Chainlink', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'chainlink' }) },
    { symbol: 'MATICUSDT', name: 'Polygon (Matic - delisted)', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'matic-network', delisted: true }) },
    { symbol: 'POLUSDT', name: 'Polygon', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'matic-network' }) },
  ];
  for (const a of cryptoAssets) {
    await db.asset.upsert({ where: { symbol: a.symbol }, create: a, update: {} });
  }
  console.log(`  ✓ ${cryptoAssets.length} crypto assets`);

  const existingWl = await db.watchlist.findUnique({ where: { name: 'Crypto Top 10' } });
  if (!existingWl) {
    await db.watchlist.create({
      data: {
        name: 'Crypto Top 10',
        assetClass: 'crypto',
        symbols: JSON.stringify(cryptoAssets.map((a) => a.symbol)),
      },
    });
    console.log('  ✓ Default watchlist "Crypto Top 10"');
  }

  await db.setting.upsert({
    where: { key: 'default_threshold' },
    create: { key: 'default_threshold', value: JSON.stringify({ minConviction: 60, directions: ['long', 'short'] }) },
    update: {},
  });
  await db.setting.upsert({
    where: { key: 'alert_thresholds' },
    create: { key: 'alert_thresholds', value: JSON.stringify({}) },
    update: {},
  });
  console.log('  ✓ Default alert thresholds');

  const jobs = [
    { moduleKey: 'crypto_technical', cronExpr: '*/15 * * * *' },
    { moduleKey: 'news_sentiment', cronExpr: '*/30 * * * *' },
    { moduleKey: 'macro_analysis', cronExpr: '0 * * * *' },
  ];
  for (const j of jobs) {
    // Enable crypto_technical by default so the Lazy Brain runs autonomously on
    // a free stack. Others stay off until the operator turns them on.
    const enabled = j.moduleKey === 'crypto_technical';
    await db.scheduleJob.upsert({ where: { moduleKey: j.moduleKey }, create: { ...j, enabled }, update: { enabled } });
  }
  console.log(`  ✓ ${jobs.length} schedule jobs (crypto_technical enabled by default)`);

  // Default module configs → wire the brain + news modules to Pollinations so
  // the whole stack works with ZERO API keys. The operator can rewire to a
  // stronger provider in Settings → Module Config later.
  const pollProvider = await db.llmProvider.findUnique({ where: { name: 'Pollinations' }, include: { models: true } });
  if (pollProvider && pollProvider.models.length > 0) {
    const m = pollProvider.models[0];
    const defaultConfigs = [
      { moduleKey: 'crypto_technical', layer: 'deep_reasoning' },
      { moduleKey: 'news_sentiment', layer: 'sentiment' },
      { moduleKey: 'macro_analysis', layer: 'macro' },
    ];
    for (const c of defaultConfigs) {
      await db.moduleModelConfig.upsert({
        where: { moduleKey_layer: { moduleKey: c.moduleKey, layer: c.layer } },
        create: { moduleKey: c.moduleKey, layer: c.layer, modelId: m.id, providerId: pollProvider.id, temperature: 0.3, enabled: true },
        update: {},
      });
    }
    console.log(`  ✓ Default module configs → Pollinations/${m.modelId} (crypto_technical, news_sentiment, macro_analysis)`);
  }

  console.log('\n✅ Seed complete. The Lazy Brain is ready: Pollinations (free, no key) is wired as the default LLM.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
