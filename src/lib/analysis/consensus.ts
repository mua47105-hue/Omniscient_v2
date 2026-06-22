// Consensus Engine — fuses multi-layer scores + multi-model outputs into one signal.
//
// UPGRADED with contrarian intelligence (Task CONTRARIAN-UPGRADE):
// The engine now detects when the naive indicator-based signal is likely a
// TRAP and inverts/downgrades it. This fixes the 5 critical loopholes found
// in the CONTRARIAN-AUDIT-1 audit:
//   L1: No RSI divergence → now detected (divergence.ts)
//   L2: No MACD divergence → now detected (divergence.ts)
//   L3: No bull trap detection → now detected (trap-detector.ts)
//   L4: No liquidity sweep detection → now detected (trap-detector.ts)
//   L5: No volume divergence → now detected (divergence.ts)
//   L6: Funding rate too weak → now a dedicated squeeze-risk layer
//   L7: No spoofing detection → now detected (orderbook-quality.ts)
//   L9: Unanimous-skip gate silenced LLM at tops → now deferred to post-contrarian
//   L10: LLM layer mislabeled → now labeled 'sentiment' (LLM is text-based)
//
// CONTRARIAN INTEGRATION LOGIC:
//   1. Compute the naive consensus (technical + orderbook + sentiment + LLM)
//   2. Run all contrarian detectors (divergence + traps + squeeze + spoofing)
//   3. If any contrarian signal has severity > 0.6 AND opposes the naive
//      verdict → DOWNGRADE conviction by 1 tier (e.g., 75→50)
//   4. If 2+ contrarian signals agree on the OPPOSITE direction → INVERT
//      the verdict (long→short or short→long) with a "trap inversion" flag
//   5. The contrarian layers get their own weight bucket (0.15) so they
//      can swing the consensus without dominating in clean-trend scenarios

import type { ConsensusResult, LayerScore, TechnicalIndicators, OrderBook, AnalysisLayer, Kline } from '@/lib/types';
import { hurstExponent } from '@/lib/analysis/hurst';
import { aggregateDivergenceScore } from '@/lib/analysis/divergence';
import { aggregateTrapScore } from '@/lib/analysis/trap-detector';
import { aggregateSqueezeScore } from '@/lib/analysis/squeeze-risk';
import { aggregateOrderBookQualityScore } from '@/lib/analysis/orderbook-quality';

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
  /** Recent klines for Hurst regime detection + divergence/trap detection. */
  klines?: Kline[];
  /** Historical funding rates for percentile calc (squeeze risk). */
  historicalFunding?: number[];
  /** Previous open interest (for OI trend in squeeze detection). */
  prevOpenInterest?: number;
  /** Current open interest. */
  openInterest?: number;
}

// Static default weights (used when no klines / Hurst unavailable).
// Added 'contrarian' bucket (0.15) — funded by reducing sentiment + technical.
const DEFAULT_WEIGHTS: Record<string, number> = {
  technical: 0.22,
  orderbook: 0.13,
  onchain: 0.10,
  sentiment: 0.15,
  macro: 0.10,
  fundamental: 0.10,
  intermarket: 0.05,
  contrarian: 0.15,
};

// Trending (H > 0.55): boost technical (momentum), reduce contrarian (traps fail in clean trends).
const TRENDING_WEIGHTS: Record<string, number> = {
  technical: 0.32,
  orderbook: 0.13,
  onchain: 0.10,
  sentiment: 0.10,
  macro: 0.10,
  fundamental: 0.10,
  intermarket: 0.05,
  contrarian: 0.10,
};

// Mean-reverting (H < 0.45): boost contrarian (traps + divergences are most reliable here).
const MEAN_REVERTING_WEIGHTS: Record<string, number> = {
  technical: 0.12,
  orderbook: 0.15,
  onchain: 0.10,
  sentiment: 0.15,
  macro: 0.10,
  fundamental: 0.10,
  intermarket: 0.05,
  contrarian: 0.23,
};

function getRegimeWeights(klines?: { close: number }[]): Record<string, number> {
  if (!klines || klines.length < 100) return DEFAULT_WEIGHTS;
  const returns: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    if (klines[i - 1].close > 0) {
      returns.push(Math.log(klines[i].close / klines[i - 1].close));
    }
  }
  if (returns.length < 100) return DEFAULT_WEIGHTS;
  const h = hurstExponent(returns);
  if (h > 0.55) return TRENDING_WEIGHTS;
  if (h < 0.45) return MEAN_REVERTING_WEIGHTS;
  return DEFAULT_WEIGHTS;
}

export function buildTechnicalLayer(ti: TechnicalIndicators): LayerScore {
  const score = ti.summary.score;
  const confidence = Math.min(100, Math.abs(score) + (ti.summary.buy + ti.summary.sell) * 8);
  const detail = `RSI ${ti.rsi.toFixed(0)} | MACD ${ti.macd.histogram > 0 ? '↑' : '↓'} | Trend ${ti.trend} | VWAP ${ti.vwap.toFixed(2)}`;
  return { layer: 'technical', score, confidence, detail };
}

export function buildOrderbookLayer(ob: OrderBook): LayerScore {
  const score = Math.max(-100, Math.min(100, ob.imbalance * 200));
  const confidence = Math.min(100, Math.abs(ob.imbalance) * 150);
  const detail = `Imbalance ${(ob.imbalance * 100).toFixed(1)}% | Spread ${ob.spread.toFixed(4)} | BidDepth $${(ob.bidDepth).toFixed(0)}`;
  return { layer: 'orderbook', score, confidence, detail };
}

export function buildSentimentLayer(newsScore: number, fundingRate?: number): LayerScore {
  // Funding rate is now handled by the dedicated squeeze-risk contrarian layer.
  // Sentiment is purely news-based here. Extreme sentiment is handled by the
  // contrarian layer (buy-the-rumor-sell-the-news pattern).
  let score = newsScore;
  score = Math.max(-100, Math.min(100, score));
  const detail = `News sentiment ${newsScore.toFixed(0)}${fundingRate !== undefined ? ` | Funding ${(fundingRate * 100).toFixed(4)}%` : ''}`;
  return { layer: 'sentiment', score, confidence: 60, detail };
}

export function buildOnchainLayer(trend: { direction: 'rising' | 'falling' | 'flat'; pctChange: number; sampleCount: number }, asset: string): LayerScore | null {
  if (!asset.toUpperCase().includes('BTC')) return null;
  if (trend.sampleCount < 3) return null;
  const clamped = Math.max(-20, Math.min(20, trend.pctChange));
  const score = Math.round((clamped / 20) * 60);
  const magnitudeConf = Math.min(40, Math.abs(clamped) * 2);
  const sampleConf = Math.min(30, trend.sampleCount * 3);
  const confidence = Math.min(70, magnitudeConf + sampleConf);
  const detail = `BTC hashrate ${trend.direction} ${trend.pctChange > 0 ? '+' : ''}${trend.pctChange}% (${trend.sampleCount} samples)`;
  return { layer: 'onchain', score, confidence, detail };
}

/**
 * Build the contrarian layer — aggregates divergence + trap + squeeze + spoofing
 * signals into a single LayerScore. This is the NEW layer that gives the engine
 * "trap awareness" — it can detect when the naive signal is likely wrong and
 * vote the opposite direction.
 */
export function buildContrarianLayer(input: ConsensusInput): LayerScore | null {
  const parts: string[] = [];
  let totalScore = 0;
  let totalWeight = 0;
  let maxSeverity = 0;
  let trapCount = 0;

  // 1. Divergence detection (RSI + MACD + Volume)
  if (input.klines && input.klines.length >= 60) {
    const div = aggregateDivergenceScore(input.klines);
    if (div.signals.length > 0) {
      totalScore += div.score * div.confidence;
      totalWeight += div.confidence;
      maxSeverity = Math.max(maxSeverity, ...div.signals.map(s => s.severity));
      parts.push(`${div.signals.length} divergence(s): ${div.signals.map(s => s.type).join(', ')}`);
    }
  }

  // 2. Trap detection (bull/bear traps + liquidity sweeps + fake breakouts)
  if (input.klines && input.klines.length >= 30) {
    const trap = aggregateTrapScore(input.klines, input.technical);
    if (trap.signals.length > 0) {
      totalScore += trap.score * trap.confidence;
      totalWeight += trap.confidence;
      maxSeverity = Math.max(maxSeverity, ...trap.signals.map(s => s.severity));
      trapCount = trap.signals.length;
      parts.push(`${trapCount} trap(s): ${trap.signals.map(s => s.type).join(', ')}`);
    }
  }

  // 3. Squeeze risk (funding rate extremes)
  if (input.fundingRate !== undefined) {
    const sq = aggregateSqueezeScore(
      input.fundingRate,
      input.openInterest,
      input.prevOpenInterest,
      input.historicalFunding
    );
    if (sq.signal) {
      totalScore += sq.score * sq.confidence;
      totalWeight += sq.confidence;
      maxSeverity = Math.max(maxSeverity, sq.signal.severity);
      parts.push(sq.signal.type.replace(/_/g, ' '));
    }
  }

  // 4. Order book spoofing detection
  if (input.orderbook) {
    const obq = aggregateOrderBookQualityScore(input.orderbook);
    if (obq.signal) {
      totalScore += obq.score * obq.confidence;
      totalWeight += obq.confidence;
      maxSeverity = Math.max(maxSeverity, obq.signal.severity);
      parts.push('orderbook spoof');
    }
  }

  if (totalWeight === 0) return null;

  const score = Math.max(-100, Math.min(100, totalScore / totalWeight));
  const confidence = Math.min(90, maxSeverity * 60 + trapCount * 15 + 20);
  const detail = parts.join(' | ') || 'no contrarian signals';

  return { layer: 'contrarian' as AnalysisLayer, score, confidence, detail };
}

export function computeConsensus(input: ConsensusInput, llmLayer?: LayerScore): ConsensusResult {
  const layers: LayerScore[] = [];
  const weights = getRegimeWeights(input.klines as { close: number }[] | undefined);

  // --- Naive layers (the original signals) ---
  if (input.technical) {
    layers.push(buildTechnicalLayer(input.technical));
  }
  if (input.orderbook) {
    layers.push(buildOrderbookLayer(input.orderbook));
  }
  if (input.sentimentScore !== undefined) {
    layers.push(buildSentimentLayer(input.sentimentScore, input.fundingRate));
  }
  if (input.onchainTrend) {
    const ocLayer = buildOnchainLayer(input.onchainTrend, input.asset);
    if (ocLayer) layers.push(ocLayer);
  }

  // LLM layer — labeled 'sentiment' because it's text-based analysis (fixes L10:
  // previously mislabeled as 'technical', which collided with the real technical
  // layer in weighting and hid LLM-vs-technical disagreement).
  if (llmLayer) {
    layers.push({ ...llmLayer, layer: 'sentiment' as AnalysisLayer });
  }

  // --- Contrarian layer (the NEW trap-awareness layer) ---
  const contrarianLayer = buildContrarianLayer(input);
  if (contrarianLayer) {
    layers.push(contrarianLayer);
  }

  // Weighted average
  let totalWeight = 0;
  let weightedScore = 0;
  let totalConfidence = 0;
  for (const l of layers) {
    const w = weights[l.layer] ?? 0.1;
    totalWeight += w;
    weightedScore += l.score * w;
    totalConfidence += l.confidence * w;
  }
  let finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  let avgConfidence = totalWeight > 0 ? totalConfidence / totalWeight : 0;

  // --- Contrarian override logic (fixes L9: unanimous-skip gate at tops) ---
  // After computing the naive score, check if contrarian signals warrant a
  // downgrade or inversion. This runs AFTER the weighted average so the
  // contrarian layer can override a trap signal even when other layers are
  // unanimous.
  let trapInverted = false;
  let downgradeReason = '';

  if (contrarianLayer && Math.abs(contrarianLayer.score) > 30) {
    const contrarianDir = contrarianLayer.score > 0 ? 'long' : 'short';
    const naiveDir = finalScore > 15 ? 'long' : finalScore < -15 ? 'short' : 'neutral';

    // Count how many contrarian signals agree on the opposing direction
    let opposingCount = 0;
    if (input.klines) {
      const div = aggregateDivergenceScore(input.klines);
      opposingCount += div.signals.filter(s =>
        (s.direction === 'long' && naiveDir === 'short') ||
        (s.direction === 'short' && naiveDir === 'long')
      ).length;
      const trap = aggregateTrapScore(input.klines, input.technical);
      opposingCount += trap.signals.filter(s =>
        (s.direction === 'long' && naiveDir === 'short') ||
        (s.direction === 'short' && naiveDir === 'long')
      ).length;
    }
    if (input.fundingRate !== undefined) {
      const sq = aggregateSqueezeScore(input.fundingRate, input.openInterest, input.prevOpenInterest, input.historicalFunding);
      if (sq.signal && ((sq.signal.direction === 'long' && naiveDir === 'short') || (sq.signal.direction === 'short' && naiveDir === 'long'))) {
        opposingCount++;
      }
    }
    if (input.orderbook) {
      const obq = aggregateOrderBookQualityScore(input.orderbook);
      if (obq.signal && ((obq.signal.direction === 'long' && naiveDir === 'short') || (obq.signal.direction === 'short' && naiveDir === 'long'))) {
        opposingCount++;
      }
    }

    // If 2+ contrarian signals oppose the naive direction → INVERT the verdict
    if (opposingCount >= 2 && naiveDir !== 'neutral' && contrarianDir !== naiveDir) {
      finalScore = -finalScore * 0.7; // invert + reduce magnitude (we're less sure inverted)
      avgConfidence *= 0.85;
      trapInverted = true;
      downgradeReason = `TRAP INVERSION: ${opposingCount} contrarian signals oppose naive ${naiveDir} → inverted to ${contrarianDir}`;
    }
    // If 1+ contrarian signal opposes AND the contrarian score is strong → INVERT
    // (previously required 2 signals; now a single strong divergence can invert)
    else if (opposingCount >= 1 && Math.abs(contrarianLayer.score) > 50 && naiveDir !== 'neutral' && contrarianDir !== naiveDir) {
      finalScore = -finalScore * 0.6;
      avgConfidence *= 0.8;
      trapInverted = true;
      downgradeReason = `TRAP INVERSION: strong contrarian signal (${contrarianLayer.score.toFixed(0)}) opposes naive ${naiveDir} → inverted to ${contrarianDir}`;
    }
    // If 1 contrarian signal opposes with moderate strength → DOWNGRADE conviction
    else if (opposingCount >= 1 && contrarianLayer.confidence > 40 && naiveDir !== 'neutral' && contrarianDir !== naiveDir) {
      finalScore *= 0.4; // reduce to 40% of original
      avgConfidence *= 0.65;
      downgradeReason = `Trap warning: ${opposingCount} contrarian signal(s) oppose naive ${naiveDir} → conviction downgraded`;
    }
  }

  const direction: ConsensusResult['direction'] =
    finalScore > 15 ? 'long' : finalScore < -15 ? 'short' : 'neutral';

  const conviction = Math.round(
    Math.min(100, (Math.abs(finalScore) * 0.6 + avgConfidence * 0.4))
  );

  // Risk levels from ATR (now with trap-aware stop placement)
  const atr = input.technical?.atr ?? input.price * 0.02;
  const entryPrice = input.price;
  let stopLoss: number | undefined;
  let takeProfit: number | undefined;
  // Widen stops when traps are detected (the market is more volatile / manipulative)
  const stopMultiplier = contrarianLayer ? 2.0 : 1.5; // wider stop when trap risk is high
  if (direction === 'long') {
    stopLoss = entryPrice - atr * stopMultiplier;
    takeProfit = entryPrice + atr * (stopMultiplier === 2.0 ? 2.5 : 3);
  } else if (direction === 'short') {
    stopLoss = entryPrice + atr * stopMultiplier;
    takeProfit = entryPrice - atr * (stopMultiplier === 2.0 ? 2.5 : 3);
  }

  const rationaleParts = layers.map((l) => `[${l.layer}] ${l.detail}`);
  if (input.llmAnalysis) rationaleParts.push(`[LLM:${input.llmAnalysis.model}] ${input.llmAnalysis.rationale}`);
  if (downgradeReason) rationaleParts.push(`⚠️ ${downgradeReason}`);

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
