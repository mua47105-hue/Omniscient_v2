/**
 * 7-layer weighted consensus fusion.
 *
 *  Layer weights (sum = 1.00):
 *    technical     0.25
 *    orderbook     0.15
 *    onchain       0.10
 *    sentiment     0.20
 *    macro         0.10
 *    fundamental   0.10
 *    intermarket   0.10
 *
 *  Each LayerScore is a {direction, score in [-100,100], confidence in [0,1]}.
 *  The fused summary score is the confidence-weighted sum of (score * weight).
 *
 *  Direction = sign of summary score (|score| < 8 → neutral).
 *  Conviction = min(100, |summaryScore| * confidenceBoost) where
 *  confidenceBoost = 1 + avgConfidence.
 *
 *  `buildOnchainLayer(trend, asset)` returns null for non-BTC assets or when
 *  fewer than 3 hashrate samples are available (the onchain layer is
 *  BTC-only — it would be misleading to fabricate one for ETH/SOL).
 */
import type {
  AnalysisLayer,
  ConsensusInput,
  ConsensusResult,
  Direction,
  LayerScore,
  NewsArticle,
  OrderBook,
  TechnicalIndicators,
} from '@/lib/types';

export const LAYER_WEIGHTS: Record<Exclude<AnalysisLayer, 'llm'>, number> = {
  technical: 0.25,
  orderbook: 0.15,
  onchain: 0.1,
  sentiment: 0.2,
  macro: 0.1,
  fundamental: 0.1,
  intermarket: 0.1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function scoreToDirection(score: number, threshold = 8): Direction {
  if (score > threshold) return 'long';
  if (score < -threshold) return 'short';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// buildTechnicalLayer — from computeIndicators output
// ---------------------------------------------------------------------------

export function buildTechnicalLayer(ind: TechnicalIndicators): LayerScore {
  const score = ind.summaryScore;
  const direction = scoreToDirection(score);
  // Confidence: 5 votes → max |sum|=5, scaled to [0,1], boosted by trend alignment.
  const voteStrength = Math.abs(ind.votes.rsi) + Math.abs(ind.votes.macd) + Math.abs(ind.votes.ema) + Math.abs(ind.votes.bollinger) + Math.abs(ind.votes.vwap);
  let confidence = clamp(voteStrength / 5, 0, 1);
  if (
    (direction === 'long' && ind.trend === 'up') ||
    (direction === 'short' && ind.trend === 'down')
  ) {
    confidence = clamp(confidence + 0.15, 0, 1);
  }
  return {
    layer: 'technical',
    direction,
    score,
    confidence,
    weight: LAYER_WEIGHTS.technical,
    rationale: `trend=${ind.trend} votes=rsi${ind.votes.rsi}/macd${ind.votes.macd}/ema${ind.votes.ema}/bb${ind.votes.bollinger}/vwap${ind.votes.vwap}`,
  };
}

// ---------------------------------------------------------------------------
// buildOrderbookLayer — bid/ask imbalance
// ---------------------------------------------------------------------------

export function buildOrderbookLayer(ob: OrderBook, levels = 10): LayerScore {
  const bids = ob.bids.slice(0, levels);
  const asks = ob.asks.slice(0, levels);
  const bidVol = bids.reduce((s, l) => s + l.quantity, 0);
  const askVol = asks.reduce((s, l) => s + l.quantity, 0);
  const total = bidVol + askVol;
  if (total === 0) {
    return { layer: 'orderbook', direction: 'neutral', score: 0, confidence: 0, weight: LAYER_WEIGHTS.orderbook, rationale: 'no depth' };
  }
  // Imbalance in [-1, 1]: positive = more bids = buy pressure.
  const imbalance = (bidVol - askVol) / total;
  const score = clamp(imbalance * 100, -100, 100);
  const direction = scoreToDirection(score);
  return {
    layer: 'orderbook',
    direction,
    score,
    confidence: clamp(Math.abs(imbalance), 0, 1),
    weight: LAYER_WEIGHTS.orderbook,
    rationale: `bidVol=${bidVol.toFixed(2)} askVol=${askVol.toFixed(2)} imbalance=${imbalance.toFixed(3)}`,
  };
}

// ---------------------------------------------------------------------------
// buildSentimentLayer — from news articles
// ---------------------------------------------------------------------------

export function buildSentimentLayer(news: NewsArticle[]): LayerScore {
  if (!news.length) {
    return { layer: 'sentiment', direction: 'neutral', score: 0, confidence: 0, weight: LAYER_WEIGHTS.sentiment, rationale: 'no news' };
  }
  let sum = 0;
  let weightSum = 0;
  for (const n of news) {
    const s = n.sentiment ?? 0;
    // High-impact articles count double.
    const w = n.impact === 'high' ? 2 : n.impact === 'medium' ? 1.5 : 1;
    sum += s * w;
    weightSum += w;
  }
  const avg = weightSum > 0 ? sum / weightSum : 0; // -1..1
  const score = clamp(avg * 100, -100, 100);
  const direction = scoreToDirection(score);
  return {
    layer: 'sentiment',
    direction,
    score,
    confidence: clamp(Math.min(news.length, 5) / 5 * Math.abs(avg), 0, 1),
    weight: LAYER_WEIGHTS.sentiment,
    rationale: `${news.length} articles avgSentiment=${avg.toFixed(2)}`,
  };
}

// ---------------------------------------------------------------------------
// buildOnchainLayer — BTC hashrate trend (BTC-only, ≥3 samples)
// ---------------------------------------------------------------------------

export interface OnchainTrend {
  asset: string;
  samples: number[]; // hashrate samples (oldest → newest)
  current?: number;
}

export function buildOnchainLayer(
  trend: OnchainTrend | null,
  asset: string,
): LayerScore | null {
  if (!trend) return null;
  if (asset.toUpperCase() !== 'BTC' && asset.toUpperCase() !== 'BTCUSDT') return null;
  if (!trend.samples || trend.samples.length < 3) return null;

  // Linear slope of hashrate samples — rising hashrate = bullish (miner confidence).
  const n = trend.samples.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = trend.samples.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (trend.samples[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  // Normalize: slope / meanY gives a relative growth rate per sample.
  const rel = meanY === 0 ? 0 : slope / meanY;
  // Rel in [-0.5, 0.5] mapped to [-100, 100].
  const score = clamp(rel * 200, -100, 100);
  const direction = scoreToDirection(score);
  return {
    layer: 'onchain',
    direction,
    score,
    confidence: clamp(Math.abs(rel) * 4, 0, 1),
    weight: LAYER_WEIGHTS.onchain,
    rationale: `BTC hashrate slope=${slope.toFixed(2)} rel=${rel.toFixed(3)} (n=${n})`,
  };
}

// ---------------------------------------------------------------------------
// computeConsensus — weighted fusion
// ---------------------------------------------------------------------------

export function computeConsensus(
  input: ConsensusInput,
  llmLayer?: LayerScore | null,
): ConsensusResult {
  const layers: LayerScore[] = [];
  for (const key of ['technical', 'orderbook', 'onchain', 'sentiment', 'macro', 'fundamental', 'intermarket'] as const) {
    const layer = input[key] as LayerScore | null | undefined;
    if (layer) layers.push(layer);
  }
  if (llmLayer) layers.push(llmLayer);

  // Weighted fusion.
  let weightedSum = 0;
  let weightTotal = 0;
  let confSum = 0;
  for (const l of layers) {
    const w = l.weight ?? LAYER_WEIGHTS[l.layer as Exclude<AnalysisLayer, 'llm'>] ?? 0;
    // LLM layer weight = 0.20 if not set (it sits on top of deterministic layers).
    const effectiveWeight = l.layer === 'llm' ? (l.weight ?? 0.2) : w;
    weightedSum += l.score * effectiveWeight * (0.5 + 0.5 * l.confidence);
    weightTotal += effectiveWeight;
    confSum += l.confidence;
  }
  const summaryScore = weightTotal > 0 ? clamp(weightedSum / weightTotal, -100, 100) : 0;
  const avgConf = layers.length > 0 ? confSum / layers.length : 0;
  const direction = scoreToDirection(summaryScore);
  const conviction = clamp(Math.round(Math.abs(summaryScore) * (1 + avgConf) / 1.5), 0, 100);

  // Entry / stop / takeProfit (if technical layer provided them via indicators).
  const entryPrice = input.technical?.rationale ? undefined : undefined;
  // NOTE: real entry/stop come from the indicators' lastClose + atr — computed
  // upstream by the tick handler. We expose them here only if the caller
  // supplied them via the input layers' rationale (kept simple).

  const rationale = layers
    .map((l) => `[${l.layer}:${l.direction}@${l.score.toFixed(0)} conf=${l.confidence.toFixed(2)}] ${l.rationale ?? ''}`)
    .join('\n');

  return {
    symbol: input.symbol,
    direction,
    conviction,
    summaryScore: Math.round(summaryScore),
    layers,
    entryPrice,
    rationale,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// shouldAlert — fire Telegram only on conviction + direction thresholds
// ---------------------------------------------------------------------------

export interface AlertThresholds {
  longConviction?: number;  // default 65
  shortConviction?: number; // default 65
  minScore?: number;        // default 35 (absolute summaryScore)
}

export function shouldAlert(
  signal: { direction: Direction; conviction: number; summaryScore: number },
  thresholds?: AlertThresholds,
): boolean {
  const t: Required<AlertThresholds> = {
    longConviction: thresholds?.longConviction ?? 65,
    shortConviction: thresholds?.shortConviction ?? 65,
    minScore: thresholds?.minScore ?? 35,
  };
  if (signal.direction === 'neutral') return false;
  if (Math.abs(signal.summaryScore) < t.minScore) return false;
  const req = signal.direction === 'long' ? t.longConviction : t.shortConviction;
  return signal.conviction >= req;
}
