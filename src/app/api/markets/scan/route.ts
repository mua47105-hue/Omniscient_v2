// Deep analysis scan for ANY asset (forex, stock, index, commodity) — uses Yahoo Finance klines.
// Mirrors /api/crypto/scan but for non-crypto assets. Runs technical indicators + consensus engine.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getQuoteWithFallback } from '@/lib/market/macro';
import { computeIndicators } from '@/lib/market/indicators';
import { computeConsensus, shouldAlert, buildTechnicalLayer } from '@/lib/analysis/consensus';
import { resolveModel, completeWithAutoFallback } from '@/lib/llm/router';
import { MARKETS_ANALYSIS_SYSTEM } from '@/lib/llm/prompts';
import { extractJsonObject } from '@/lib/llm/json';
import { sendSignalAlert } from '@/lib/alerts/telegram';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';
import type { ApiResult, ConsensusResult, LayerScore } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { symbol, interval = '1d', sendAlert = false } = await req.json();
    if (!symbol) return NextResponse.json({ success: false, error: 'symbol required' }, { status: 400 });

    const asset = await db.asset.findUnique({ where: { symbol } });
    if (!asset) return NextResponse.json({ success: false, error: 'asset not in DB' }, { status: 404 });
    if (asset.assetClass === 'crypto') {
      return NextResponse.json({ success: false, error: 'Use /api/crypto/scan for crypto assets' }, { status: 400 });
    }

    // Get Yahoo symbol from meta
    let meta: any = {};
    try { meta = JSON.parse(asset.meta || '{}'); } catch {}
    const yahooSymbol = meta.yahooSymbol || asset.symbol;

    // Fetch klines (Yahoo daily candles, with Binance fallback for gold/BTC/ETH).
    // Yahoo intermittently 429s on shared datacenter IPs — retry once after a
    // short delay if the first attempt fails, so a transient blip doesn't crash
    // the scan.
    let quote;
    try {
      quote = await getQuoteWithFallback(yahooSymbol, '1y');
    } catch (firstErr: any) {
      const msg = firstErr?.message || '';
      if (msg.includes('429') || msg.includes('Yahoo')) {
        // Wait 1.5s and retry — Yahoo rate-limits are often very short-lived
        await new Promise((r) => setTimeout(r, 1500));
        try {
          quote = await getQuoteWithFallback(yahooSymbol, '1y');
        } catch {
          // Still failing — return a clear, actionable error instead of a 500.
          return NextResponse.json<ApiResult<never>>({
            success: false,
            error: 'Yahoo Finance is rate-limiting this server. Please try again in a minute or two.',
          }, { status: 503 });
        }
      } else {
        throw firstErr;
      }
    }
    const klines = quote.klines || [];

    if (klines.length < 50) {
      return NextResponse.json<ApiResult<never>>({
        success: false,
        error: `Insufficient historical data (${klines.length} candles). Need at least 50.`,
      }, { status: 422 });
    }

    const indicators = computeIndicators(klines);
    const price = quote.price;

    // Optional LLM layer
    let llmAnalysis: { score: number; rationale: string; model: string } | undefined;
    let llmLayer: LayerScore | undefined;
    const llmCfg = await resolveModel('macro_analysis', 'macro');
    if (llmCfg) {
      try {
        const techSummary = buildTechnicalLayer(indicators);
        const prompt = `You are a senior ${asset.assetClass} market analyst. Analyze ${asset.symbol} (${asset.name}).
Current price: ${price} (${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}% today).
Technical: RSI ${indicators.rsi.toFixed(0)}, MACD hist ${indicators.macd.histogram.toFixed(4)}, trend ${indicators.trend}, EMA20 ${indicators.ema20.toFixed(4)}, EMA50 ${indicators.ema50.toFixed(4)}, VWAP ${indicators.vwap.toFixed(4)}.
Support: ${indicators.support.join(', ')}. Resistance: ${indicators.resistance.join(', ')}.
Asset class: ${asset.assetClass}. Exchange: ${asset.exchange || 'N/A'}.

Give a concise trading read for the next week. Respond as JSON ONLY:
{"score": <number -100 to 100, negative=bearish>, "direction": "long"|"short"|"neutral", "rationale": "<2-3 sentences>", "confidence": <0-100>}`;
        const result = await completeWithAutoFallback({
          provider: llmCfg.providerName,
          model: llmCfg.modelId,
          messages: [
            { role: 'system', content: llmCfg.systemPrompt || MARKETS_ANALYSIS_SYSTEM },
            { role: 'user', content: prompt },
          ],
          temperature: llmCfg.temperature,
          jsonMode: true,
          maxTokens: 400,
          _module: 'macro_analysis',
          _asset: asset.symbol,
        } as any);
        // Robust JSON extraction — Pollinations (and other LLMs) often wrap
        // JSON in markdown fences or add preamble even with json_mode on.
        const parsed = extractJsonObject<{ score?: number; direction?: string; rationale?: string; confidence?: number }>(result.content);
        if (!parsed) {
          console.error('[markets/scan] LLM returned unparseable JSON, falling back to deterministic layer. Raw content (first 200 chars):', result.content.slice(0, 200));
          throw new Error('LLM JSON extraction failed');
        }
        llmAnalysis = {
          score: typeof parsed.score === 'number' ? parsed.score : techSummary.score,
          rationale: parsed.rationale || 'No rationale provided.',
          model: result.usedProvider ? `${result.usedProvider}/${result.usedModel}` : `${llmCfg.providerName}/${llmCfg.modelId}`,
        };
        llmLayer = {
          layer: 'technical',
          score: llmAnalysis.score,
          confidence: parsed.confidence ?? 70,
          detail: llmAnalysis.rationale.slice(0, 120),
          model: llmAnalysis.model,
        };
      } catch (e: any) {
        console.error('[markets/scan] LLM layer failed:', e.message);
      }
    }

    // Consensus (no orderbook/funding for non-crypto — technical + LLM + contrarian)
    const consensus = computeConsensus(
      {
        asset: asset.symbol,
        timeframe: interval,
        price,
        technical: indicators,
        llmAnalysis,
        // Pass klines so the contrarian layer can detect divergences + traps
        klines,
      },
      llmLayer
    );

    // Persist signal
    const created = await db.signal.create({
      data: {
        assetId: asset.id,
        direction: consensus.direction,
        conviction: consensus.conviction,
        timeframe: interval,
        layersSummary: JSON.stringify(consensus.layers),
        modelsUsed: JSON.stringify(consensus.modelsUsed),
        entryPrice: consensus.entryPrice,
        stopLoss: consensus.stopLoss,
        takeProfit: consensus.takeProfit,
        rationale: consensus.rationale,
        status: 'open',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7-day horizon for non-crypto
      },
    });

    // Alert if threshold cleared
    const thresholds = await getSetting(SETTING_KEYS.alertThresholds, {});
    const defaultThreshold = await getSetting(SETTING_KEYS.defaultThreshold, { minConviction: 60, directions: ['long', 'short'] });
    const assetThreshold = (thresholds as any)[asset.symbol] ?? defaultThreshold;
    let alerted = false;
    if (sendAlert && shouldAlert(consensus, assetThreshold)) {
      alerted = await sendSignalAlert(consensus);
    }

    return NextResponse.json<ApiResult<{ signalId: string; consensus: ConsensusResult; alerted: boolean; quote: typeof quote }>>({
      success: true,
      data: { signalId: created.id, consensus, alerted, quote },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
