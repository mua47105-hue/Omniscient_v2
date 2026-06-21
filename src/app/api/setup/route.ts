import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/setup — seeds the database with default providers, assets, and watchlists.
// Call this once after deploying to Vercel with DATABASE_URL set to Supabase.
export async function GET() {
  try {
    const results: string[] = [];

    // Check if already seeded
    const providerCount = await db.llmProvider.count();
    if (providerCount > 0) {
      return NextResponse.json<ApiResult<{ ok: boolean; message: string }>>({
        success: true,
        data: { ok: true, message: `Database already seeded (${providerCount} providers found).` },
      });
    }

    // Seed LLM providers
    const providers = [
      { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'PASTE_YOUR_GEMINI_API_KEY', notes: 'Google Gemini API', models: [{ modelId: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextWindow: 1048576, freeTierRpm: 10 }] },
      { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'PASTE_YOUR_GROQ_API_KEY', notes: 'Groq ultra-fast inference', models: [{ modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B', contextWindow: 128000, freeTierRpm: 30 }] },
      { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'PASTE_YOUR_NVIDIA_API_KEY', notes: 'NVIDIA NIM large models', models: [{ modelId: 'meta/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B', contextWindow: 128000, freeTierRpm: 40 }] },
      { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', apiKey: 'PASTE_YOUR_MISTRAL_API_KEY', notes: 'Mistral AI', models: [{ modelId: 'mistral-large-latest', displayName: 'Mistral Large', contextWindow: 128000, freeTierRpm: 10 }] },
      { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'PASTE_YOUR_OPENROUTER_API_KEY', notes: 'OpenRouter aggregates many providers', models: [{ modelId: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B', contextWindow: 128000, freeTierRpm: 50 }] },
      { name: 'Pollinations', baseUrl: 'https://text.pollinations.ai/openai', apiKey: 'free-no-key-needed', notes: 'Completely free, NO API key required', models: [{ modelId: 'openai-fast', displayName: 'GPT-OSS 20B Fast', contextWindow: 32000, freeTierRpm: 50 }] },
    ];

    for (const p of providers) {
      const created = await db.llmProvider.create({
        data: {
          name: p.name,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          isActive: true,
          notes: p.notes,
          models: { create: p.models.map(m => ({ ...m, isActive: true, capabilities: '["text","json"]' })) },
        },
      });
      results.push(`Provider: ${created.name}`);
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
      { symbol: 'POLUSDT', name: 'Polygon', assetClass: 'crypto', exchange: 'binance', meta: JSON.stringify({ coinId: 'matic-network' }) },
    ];
    for (const a of cryptoAssets) {
      await db.asset.upsert({ where: { symbol: a.symbol }, create: a, update: {} });
    }
    results.push(`Assets: ${cryptoAssets.length} crypto`);

    // Seed watchlist
    const existingWl = await db.watchlist.findUnique({ where: { name: 'Crypto Top 10' } });
    if (!existingWl) {
      await db.watchlist.create({
        data: { name: 'Crypto Top 10', assetClass: 'crypto', symbols: JSON.stringify(cryptoAssets.map(a => a.symbol)), isActive: true },
      });
      results.push('Watchlist: Crypto Top 10');
    }

    // Seed schedule jobs
    const jobs = [
      { moduleKey: 'crypto_technical', cronExpr: '*/15 * * * *' },
      { moduleKey: 'news_sentiment', cronExpr: '*/30 * * * *' },
      { moduleKey: 'macro_analysis', cronExpr: '0 * * * *' },
    ];
    for (const j of jobs) {
      await db.scheduleJob.upsert({ where: { moduleKey: j.moduleKey }, create: { ...j, enabled: false }, update: {} });
    }
    results.push(`Schedule jobs: ${jobs.length}`);

    // Seed default settings
    await db.setting.upsert({ where: { key: 'default_threshold' }, create: { key: 'default_threshold', value: JSON.stringify({ minConviction: 60, directions: ['long', 'short'] }) }, update: {} });
    results.push('Settings: default_threshold');

    return NextResponse.json<ApiResult<{ ok: boolean; results: string[] }>>({
      success: true,
      data: { ok: true, results },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
