// Consensus Engine — fuses multi-layer scores + multi-model outputs into one signal.

import type { ConsensusResult, LayerScore, TechnicalIndicators, OrderBook } from '@/lib/types';

export interface ConsensusInput {
  asset: string;
  timeframe: string;
  price: number;
  technical?: TechnicalIndicators;
  orderbook?: OrderBook;
  fundingRate?: number;
  sentimentScore?: number; // -100..100 from news
  llmAnalysis?: { score: number; rationale: string; model: string };
  onchainTrend?: { direction: 'rising' | 'falling' | 'flat'; pctChange: number; sampleCount: number };
}

const LAYER_WEIGHTS: Record<string, number> = {
  technical: 0.25,
  orderbook: 0.15,
  onchain: 0.1,
  sentiment: 0.2,
  macro: 0.1,
  fundamental: 0.1,
  intermarket: 0.1,
};

export function buildTechnicalLayer(ti: TechnicalIndicators): LayerScore {
  const score = ti.summary.score; // -100..100
  const confidence = Math.min(100, Math.abs(score) + (ti.summary.buy + ti.summary.sell) * 8);
  const detail = `RSI ${ti.rsi.toFixed(0)} | MACD ${ti.macd.histogram > 0 ? '↑' : '↓'} | Trend ${ti.trend} | VWAP ${ti.vwap.toFixed(2)}`;
  return { layer: 'technical', score, confidence, detail };
}

export function buildOrderbookLayer(ob: OrderBook): LayerScore {
  // imbalance > 0 = more bids = bullish pressure
  const score = Math.max(-100, Math.min(100, ob.imbalance * 200));
  const confidence = Math.min(100, Math.abs(ob.imbalance) * 150);
  const detail = `Imbalance ${(ob.imbalance * 100).toFixed(1)}% | Spread ${ob.spread.toFixed(4)} | BidDepth $${(ob.bidDepth).toFixed(0)}`;
  return { layer: 'orderbook', score, confidence, detail };
}

export function buildSentimentLayer(newsScore: number, fundingRate?: number): LayerScore {
  // extreme positive funding = overcrowded longs = slight bearish
  let score = newsScore;
  if (fundingRate !== undefined) {
    if (fundingRate > 0.0005) score -= 15; // overheated longs
    if (fundingRate < -0.0005) score += 15; // overcrowded shorts
  }
  score = Math.max(-100, Math.min(100, score));
  const detail = `News sentiment ${newsScore.toFixed(0)}${fundingRate !== undefined ? ` | Funding ${(fundingRate * 100).toFixed(4)}%` : ''}`;
  return { layer: 'sentiment', score, confidence: 65, detail };
}

/**
 * On-chain fundamental layer — BTC hashrate trend as a miner-confidence signal.
 * Rising hashrate = miners committing capital = bullish on the network's future.
 * Falling = miners capitulating = bearish. Only applies to BTC (the hashrate
 * is BTC-specific); other assets get no on-chain layer. Confidence scales with
 * the magnitude of the trend + the sample count (more samples = more confident).
 */
export function buildOnchainLayer(trend: { direction: 'rising' | 'falling' | 'flat'; pctChange: number; sampleCount: number }, asset: string): LayerScore | null {
  // Only BTC has a meaningful hashrate trend in our data source.
  if (!asset.toUpperCase().includes('BTC')) return null;
  // Need at least 3 samples to call a direction; below that, no opinion.
  if (trend.sampleCount < 3) return null;

  // Map the % change to a -100..100 score. Cap the input at ±20% so a wild
  // outlier doesn't dominate. Rising = +, falling = −.
  const clamped = Math.max(-20, Math.min(20, trend.pctChange));
  const score = Math.round((clamped / 20) * 60); // ±60 max — a fundamental nudge, not a driver
  // Confidence grows with sample count (max ~70 at 12+ samples) + magnitude.
  const magnitudeConf = Math.min(40, Math.abs(clamped) * 2);
  const sampleConf = Math.min(30, trend.sampleCount * 3);
  const confidence = Math.min(70, magnitudeConf + sampleConf);
  const detail = `BTC hashrate ${trend.direction} ${trend.pctChange > 0 ? '+' : ''}${trend.pctChange}% (${trend.sampleCount} samples)`;
  return { layer: 'onchain', score, confidence, detail };
}

export function computeConsensus(input: ConsensusInput, llmLayer?: LayerScore): ConsensusResult {
  const layers: LayerScore[] = [];

  if (input.technical) {
    const tl = buildTechnicalLayer(input.technical);
    layers.push(tl);
  }
  if (input.orderbook) {
    layers.push(buildOrderbookLayer(input.orderbook));
  }
  if (input.sentimentScore !== undefined) {
    layers.push(buildSentimentLayer(input.sentimentScore, input.fundingRate));
  }
  // On-chain fundamental layer — BTC hashrate trend (miner confidence).
  // Only contributes for BTC + when there are enough hashrate samples.
  if (input.onchainTrend) {
    const ocLayer = buildOnchainLayer(input.onchainTrend, input.asset);
    if (ocLayer) layers.push(ocLayer);
  }
  if (llmLayer) {
    layers.push(llmLayer);
  }

  // weighted average
  let totalWeight = 0;
  let weightedScore = 0;
  let totalConfidence = 0;
  for (const l of layers) {
    const w = LAYER_WEIGHTS[l.layer] ?? 0.1;
    totalWeight += w;
    weightedScore += l.score * w;
    totalConfidence += l.confidence * w;
  }
  const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  const avgConfidence = totalWeight > 0 ? totalConfidence / totalWeight : 0;

  const direction: ConsensusResult['direction'] =
    finalScore > 15 ? 'long' : finalScore < -15 ? 'short' : 'neutral';

  // conviction = combine |score| and confidence, scaled to 0-100
  const conviction = Math.round(
    Math.min(100, (Math.abs(finalScore) * 0.6 + avgConfidence * 0.4))
  );

  // simple risk levels from ATR
  const atr = input.technical?.atr ?? input.price * 0.02;
  const entryPrice = input.price;
  let stopLoss: number | undefined;
  let takeProfit: number | undefined;
  if (direction === 'long') {
    stopLoss = entryPrice - atr * 1.5;
    takeProfit = entryPrice + atr * 3;
  } else if (direction === 'short') {
    stopLoss = entryPrice + atr * 1.5;
    takeProfit = entryPrice - atr * 3;
  }

  const rationaleParts = layers.map((l) => `[${l.layer}] ${l.detail}`);
  if (input.llmAnalysis) rationaleParts.push(`[LLM:${input.llmAnalysis.model}] ${input.llmAnalysis.rationale}`);

  return {
    asset: input.asset,
    direction,
    conviction,
    timeframe: input.timeframe,
    layers,
    modelsUsed: input.llmAnalysis ? [input.llmAnalysis.model] : [],
    entryPrice,
    stopLoss,
    takeProfit,
    rationale: rationaleParts.join('\n'),
  };
}

/** Check if a signal clears configurable thresholds */
export function shouldAlert(
  signal: ConsensusResult,
  thresholds: { minConviction: number; directions: string[] } = {
    minConviction: 60,
    directions: ['long', 'short'],
  }
): boolean {
  if (!thresholds.directions.includes(signal.direction)) return false;
  if (signal.direction === 'neutral') return false;
  return signal.conviction >= thresholds.minConviction;
}
