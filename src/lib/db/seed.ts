// Seed default config: Pollinations LLM (free, no key), crypto assets, schedule jobs.
import { db } from '@/lib/db';

async function main() {
  console.log('🌱 Seeding default config...');
  const pollName = 'Pollinations';
  const existingPoll = await db.llmProvider.findUnique({ where: { name: pollName } });
  if (!existingPoll) {
    const p = await db.llmProvider.create({
      data: {
        name: pollName, baseUrl: 'https://text.pollinations.ai/openai', apiKey: 'pollinations-free',
        notes: 'Pollinations — free LLM, NO API KEY needed. Model: openai (gpt-oss-20b).', isActive: true,
        models: { create: [{ modelId: 'openai', displayName: 'OpenAI (gpt-oss-20b)', contextWindow: 128000, freeTierRpm: 60 }] },
      },
    });
    console.log(`  ✓ Created provider "${pollName}" (ACTIVE)`);
    const m = await db.llmModel.findFirst({ where: { providerId: p.id } });
    if (m) {
      for (const c of [{ moduleKey: 'crypto_technical', layer: 'deep_reasoning' }, { moduleKey: 'news_sentiment', layer: 'sentiment' }, { moduleKey: 'macro_analysis', layer: 'macro' }]) {
        await db.moduleModelConfig.upsert({ where: { moduleKey_layer: { moduleKey: c.moduleKey, layer: c.layer } }, create: { ...c, modelId: m.id, providerId: p.id, temperature: 0.3, enabled: true }, update: {} });
      }
      console.log(`  ✓ Module configs → Pollinations/${m.modelId}`);
    }
  } else { console.log(`  ✓ Provider "${pollName}" exists`); }

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
    { symbol: 'MATICUSDT', name: 'Polygon', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'matic-network' }) },
    { symbol: 'POLUSDT', name: 'Polygon', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'matic-network' }) },
  ];
  for (const a of cryptoAssets) await db.asset.upsert({ where: { symbol: a.symbol }, create: a, update: {} });
  console.log(`  ✓ ${cryptoAssets.length} crypto assets`);

  const existingWl = await db.watchlist.findUnique({ where: { name: 'Crypto Top 10' } });
  if (!existingWl) { await db.watchlist.create({ data: { name: 'Crypto Top 10', assetClass: 'crypto', symbols: JSON.stringify(cryptoAssets.map(a => a.symbol)) } }); console.log('  ✓ Default watchlist'); }

  await db.setting.upsert({ where: { key: 'default_threshold' }, create: { key: 'default_threshold', value: JSON.stringify({ minConviction: 60, directions: ['long', 'short'] }) }, update: {} });
  await db.setting.upsert({ where: { key: 'alert_thresholds' }, create: { key: 'alert_thresholds', value: JSON.stringify({}) }, update: {} });

  for (const j of [{ moduleKey: 'crypto_technical', cronExpr: '*/15 * * * *', enabled: true }, { moduleKey: 'news_sentiment', cronExpr: '*/30 * * * *', enabled: false }, { moduleKey: 'macro_analysis', cronExpr: '0 * * * *', enabled: false }]) {
    await db.scheduleJob.upsert({ where: { moduleKey: j.moduleKey }, create: j, update: { enabled: j.enabled } });
  }
  console.log(`  ✓ 3 schedule jobs (crypto_technical enabled)`);
  console.log('\n✅ Seed complete. Pollinations (free, no key) is the default LLM.');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await db.$disconnect(); });
