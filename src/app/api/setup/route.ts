import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { PROVIDER_PRESETS } from '@/lib/llm/presets';
import { safeError } from '@/lib/security/redact';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/setup — seeds the database with default providers, assets, and watchlists.
// Query params:
//   ?force=1  — re-seed even if providers already exist (adds missing presets)
// Call this once after deploying, or whenever the DB is empty.
export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get('force') === '1';
    const results: string[] = [];

    const providerCount = await db.llmProvider.count();
    if (providerCount > 0 && !force) {
      return NextResponse.json<ApiResult<{ ok: boolean; message: string }>>({
        success: true,
        data: { ok: true, message: `Database already seeded (${providerCount} providers). Use ?force=1 to add missing presets.` },
      });
    }

    // Seed all provider presets from the catalog
    for (const preset of PROVIDER_PRESETS) {
      const existing = await db.llmProvider.findUnique({ where: { name: preset.name } });
      if (existing) {
        results.push(`Provider ${preset.name}: already exists`);
        continue;
      }
      const created = await db.llmProvider.create({
        data: {
          name: preset.name,
          baseUrl: preset.baseUrl,
          apiKey: preset.apiKeyPlaceholder,
          isActive: preset.free, // Pollinations is active by default (no key needed)
          notes: preset.notes,
          models: {
            create: preset.models.map(m => ({
              modelId: m.modelId,
              displayName: m.displayName,
              contextWindow: m.contextWindow,
              freeTierRpm: m.freeTierRpm,
              isActive: true,
              capabilities: '["text","json"]',
            })),
          },
        },
      });
      results.push(`Provider: ${created.name} (${preset.free ? 'active' : 'inactive'})`);
    }

    // Wire module configs to Pollinations (the default free provider)
    const pollinations = await db.llmProvider.findUnique({ where: { name: 'Pollinations' } });
    if (pollinations) {
      const m = await db.llmModel.findFirst({ where: { providerId: pollinations.id } });
      if (m) {
        for (const c of [
          { moduleKey: 'crypto_technical', layer: 'deep_reasoning' },
          { moduleKey: 'news_sentiment', layer: 'sentiment' },
          { moduleKey: 'macro_analysis', layer: 'macro' },
        ]) {
          await db.moduleModelConfig.upsert({
            where: { moduleKey_layer: c },
            create: { ...c, modelId: m.id, providerId: pollinations.id, temperature: 0.3, enabled: true },
            update: {},
          });
        }
        results.push('Module configs wired to Pollinations');
      }
    }

    // Seed crypto assets
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
    for (const a of cryptoAssets) {
      await db.asset.upsert({ where: { symbol: a.symbol }, create: a, update: {} });
    }
    results.push(`Assets: ${cryptoAssets.length} crypto`);

    // Seed watchlist
    await db.watchlist.upsert({
      where: { name: 'Crypto Top 10' },
      create: { name: 'Crypto Top 10', assetClass: 'crypto', symbols: JSON.stringify(cryptoAssets.map(a => a.symbol)), isActive: true },
      update: {},
    });
    results.push('Watchlist: Crypto Top 10');

    // Seed schedule jobs
    for (const j of [
      { moduleKey: 'crypto_technical', cronExpr: '*/15 * * * *', enabled: true },
      { moduleKey: 'news_sentiment', cronExpr: '*/30 * * * *', enabled: false },
      { moduleKey: 'macro_analysis', cronExpr: '0 * * * *', enabled: false },
    ]) {
      await db.scheduleJob.upsert({
        where: { moduleKey: j.moduleKey },
        create: j,
        update: {},
      });
    }
    results.push('Schedule jobs: 3');

    // Seed default settings
    await db.setting.upsert({ where: { key: 'default_threshold' }, create: { key: 'default_threshold', value: JSON.stringify({ minConviction: 60, directions: ['long', 'short'] }) }, update: {} });
    await db.setting.upsert({ where: { key: 'alert_thresholds' }, create: { key: 'alert_thresholds', value: '{}' }, update: {} });
    results.push('Settings: defaults');

    return NextResponse.json<ApiResult<{ ok: boolean; results: string[] }>>({
      success: true,
      data: { ok: true, results },
    });
  } catch (e) {
    const { status, error } = safeError(e, 'setup');
    return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
  }
}
