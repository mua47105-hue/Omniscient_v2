// Deep analysis scan for a single asset — runs all enabled layers + consensus.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getKlines, getOrderBook, getFundingRate, getTicker24h } from '@/lib/market/binance';
import { computeIndicators } from '@/lib/market/indicators';
import { computeConsensus, shouldAlert, buildTechnicalLayer } from '@/lib/analysis/consensus';
import { resolveModel, completeWithAutoFallback } from '@/lib/llm/router';
import { CRYPTO_TECHNICAL_SYSTEM } from '@/lib/llm/prompts';
import { sendSignalAlert } from '@/lib/alerts/telegram';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';
import type { ApiResult, ConsensusResult, LayerScore } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { symbol, interval = '4h', sendAlert = false } = await req.json();
    if (!symbol) return NextResponse.json({ success: false, error: 'symbol required' }, { status: 400 });

    // Fetch asset
    const asset = await db.asset.findUnique({ where: { symbol } });
    if (!asset) return NextResponse.json({ success: false, error: 'asset not in DB' }, { status: 404 });

    // Gather numeric layers (tiered: always run numeric, run LLM if configured)
    const [klines, orderbook, funding, ticker] = await Promise.all([
      getKlines(symbol, interval, 200),
      getOrderBook(symbol, 50),
      getFundingRate(symbol).catch(() => null),
      getTicker24h(symbol),
    ]);
    const indicators = computeIndicators(klines);

    // Optional LLM layer (tiered — only if a model is configured for crypto_technical)
    let llmAnalysis: { score: number; rationale: string; model: string } | undefined;
    let llmLayer: LayerScore | undefined;
    const llmCfg = await resolveModel('crypto_technical', 'deep_reasoning');
    if (llmCfg) {
      try {
        const techSummary = buildTechnicalLayer(indicators);
        const prompt = `You are a senior crypto market analyst. Analyze ${symbol} (${asset.name}).
Current price: $${ticker.price} (24h ${ticker.changePct.toFixed(2)}%).
Technical: RSI ${indicators.rsi.toFixed(0)}, MACD hist ${indicators.macd.histogram.toFixed(2)}, trend ${indicators.trend}, EMA20 ${indicators.ema20.toFixed(2)}, EMA50 ${indicators.ema50.toFixed(2)}, VWAP ${indicators.vwap.toFixed(2)}.
Order book imbalance: ${(orderbook.imbalance * 100).toFixed(1)}% (positive=bullish).
Funding rate: ${funding ? (funding.rate * 100).toFixed(4) + '%' : 'N/A'}.
Support: ${indicators.support.join(', ')}. Resistance: ${indicators.resistance.join(', ')}.

Give a concise trading read for the next ${interval} timeframe. Respond as JSON ONLY:
{"score": <number -100 to 100, negative=bearish>, "direction": "long"|"short"|"neutral", "rationale": "<2-3 sentences>", "confidence": <0-100>}`;
        const result = await completeWithAutoFallback({
          provider: llmCfg.providerName,
          model: llmCfg.modelId,
          messages: [
            { role: 'system', content: llmCfg.systemPrompt || CRYPTO_TECHNICAL_SYSTEM },
            { role: 'user', content: prompt },
          ],
          temperature: llmCfg.temperature,
          jsonMode: true,
          maxTokens: 400,
        });
        const parsed = JSON.parse(result.content);
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
        // LLM layer is optional/tiered — continue without it
        console.error('LLM layer failed:', e.message);
      }
    }

    const consensus = computeConsensus(
      {
        asset: symbol,
        timeframe: interval,
        price: ticker.price,
        technical: indicators,
        orderbook,
        fundingRate: funding?.rate,
        llmAnalysis,
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
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Alert if threshold cleared
    const thresholds = await getSetting(SETTING_KEYS.alertThresholds, {});
    const defaultThreshold = await getSetting(SETTING_KEYS.defaultThreshold, { minConviction: 60, directions: ['long', 'short'] });
    const assetThreshold = (thresholds as any)[symbol] ?? defaultThreshold;
    let alerted = false;
    if (sendAlert && shouldAlert(consensus, assetThreshold)) {
      alerted = await sendSignalAlert(consensus);
    }

    return NextResponse.json<ApiResult<{ signalId: string; consensus: ConsensusResult; alerted: boolean }>>({
      success: true,
      data: { signalId: created.id, consensus, alerted },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
