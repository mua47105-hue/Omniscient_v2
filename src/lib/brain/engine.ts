// The Lazy Brain — pure decision logic.
//
// computeNoteworthiness: a free, deterministic 0-100 "is something happening
// here?" score. No LLM. This is the watch layer that runs on every asset on
// every tick for free, and it's what the gate uses to decide whether an LLM
// call is worth spending.
//
// classifyRegime: trending | ranging | volatile — drives adaptive cadence.
//
// dataSignature: a compact fingerprint of the market state. If it hasn't
// changed since the last LLM verdict, the verdict is still valid → cache hit.
//
// gateDecide: ponytail's ladder applied to the LLM call. Returns the first
// rung that holds: skip (YAGNI/budget/cadence), cache (unchanged), or analyze
// (tier 1 triage / tier 2 deep). Never silences a real signal — the
// deterministic consensus always runs; the gate only governs the LLM layer.

import type { TechnicalIndicators, OrderBook, Ticker, ConsensusResult } from '@/lib/types';
import type { BrainConfig, AssetWatch } from '@/lib/brain/state';

export type Regime = 'trending' | 'ranging' | 'volatile';

export interface GateInput {
  indicators: TechnicalIndicators;
  orderbook: OrderBook;
  fundingRate?: number;
  ticker: Ticker;
  deterministic: ConsensusResult; // consensus WITHOUT the LLM layer
  watch?: AssetWatch;
  config: BrainConfig;
  budgetExhausted: boolean;
  now: number;
}

export interface GateDecision {
  action: 'skip' | 'cache' | 'analyze';
  tier: 0 | 1 | 2; // 0 = no LLM, 1 = triage (compressed prompt), 2 = deep
  reason: string;
  noteworthiness: number;
  regime: Regime;
  dataSig: string;
  estimatedSavedTokens: number;
}

// A typical compressed-tick LLM round trip: ~120 prompt + ~150 completion.
// Used only for the "tokens saved" scoreboard — not for billing.
const ESTIMATED_CALL_TOKENS = 270;

/** Clamp a value to [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Noteworthiness — 0-100, pure math. Higher = more reason to consult the LLM.
 * Composed of independent signals, each capped, then summed and clamped.
 * Deliberately simple: this is a gate, not a predictor.
 */
export function computeNoteworthiness(
  ti: TechnicalIndicators,
  ob: OrderBook,
  fundingRate: number | undefined,
  ticker: Ticker,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const price = ti.ema20 || ticker.price; // ema20 ~ current price but smoother

  // 1) Volatility — ATR as a fraction of price. Crypto 4h typically 1-3%.
  //    High ATR = the market is moving enough that an LLM read could matter.
  const atrPct = price > 0 ? ti.atr / price : 0;
  score += clamp((atrPct / 0.03) * 25, 0, 25);
  if (atrPct > 0.03) reasons.push(`high volatility ${((atrPct) * 100).toFixed(1)}%`);

  // 2) 24h move magnitude — a big move is inherently noteworthy.
  const absChange = Math.abs(ticker.changePct);
  score += clamp((absChange / 5) * 20, 0, 20);
  if (absChange > 3) reasons.push(`${absChange.toFixed(1)}% 24h move`);

  // 3) RSI extreme — oversold/overbought = potential reversal zone.
  const rsiDist = Math.abs(ti.rsi - 50);
  score += rsiDist > 20 ? 15 : rsiDist > 15 ? 8 : 0;
  if (ti.rsi < 30) reasons.push(`RSI oversold ${ti.rsi.toFixed(0)}`);
  else if (ti.rsi > 70) reasons.push(`RSI overbought ${ti.rsi.toFixed(0)}`);

  // 4) Momentum vs trend divergence — MACD histogram sign disagrees with the
  //    EMA trend = momentum waning into a possible reversal. Noteworthy.
  const macdUp = ti.macd.histogram > 0;
  if (ti.trend === 'bullish' && !macdUp) { score += 12; reasons.push('bullish trend, MACD fading'); }
  else if (ti.trend === 'bearish' && macdUp) { score += 12; reasons.push('bearish trend, MACD rising'); }

  // 5) Funding-rate extreme — overcrowded positioning, squeeze risk.
  if (fundingRate !== undefined) {
    const fr = Math.abs(fundingRate);
    score += fr > 0.0005 ? 15 : fr > 0.0003 ? 8 : 0;
    if (fr > 0.0005) reasons.push(`extreme funding ${(fundingRate * 100).toFixed(4)}%`);
  }

  // 6) Order-book imbalance — one-sided book = directional pressure.
  const obAbs = Math.abs(ob.imbalance);
  score += obAbs > 0.3 ? 12 : obAbs > 0.15 ? 6 : 0;
  if (obAbs > 0.3) reasons.push(`OB imbalance ${(ob.imbalance * 100).toFixed(0)}%`);

  // 7) Decision boundary — price within 1 ATR of EMA50 (a mean-reversion /
  //    trend-decision zone). Adds weight when the market is at a crossroads.
  if (price > 0 && ti.atr > 0 && Math.abs(price - ti.ema50) < ti.atr) {
    score += 10;
    reasons.push('price at EMA50 boundary');
  }

  return { score: clamp(Math.round(score), 0, 100), reasons };
}

/** Regime from ATR level + trend strength. Drives adaptive cadence. */
export function classifyRegime(ti: TechnicalIndicators, ticker: Ticker): Regime {
  const price = ti.ema20 || ticker.price;
  const atrPct = price > 0 ? ti.atr / price : 0;
  if (atrPct > 0.025) return 'volatile';
  if (ti.trend !== 'neutral') return 'trending';
  return 'ranging';
}

/**
 * Data signature — a coarse fingerprint of the market state. If two ticks
 * produce the same signature, the LLM's verdict from the first still applies.
 * Buckets are chosen to be coarse enough that noise doesn't bust the cache,
 * fine enough that a real regime change does.
 */
export function dataSignature(
  ti: TechnicalIndicators,
  ob: OrderBook,
  fundingRate: number | undefined,
  ticker: Ticker,
): string {
  const price = ticker.price || ti.ema20;
  // Price bucket: log-scale, ~0.25% bands. Avoids busting on every tick.
  const priceBucket = price > 0 ? Math.round(Math.log(price) * 400) : 0;
  const rsiBucket = Math.round(ti.rsi / 2); // 50 buckets
  const macdSign = ti.macd.histogram > 0 ? 'u' : ti.macd.histogram < 0 ? 'd' : '0';
  const obBucket = Math.round(ob.imbalance * 10); // 0.1 buckets
  const frBucket = fundingRate !== undefined ? Math.round(fundingRate * 10000) : 0; // 0.01% buckets
  const scoreBucket = Math.round(ti.summary.score / 10); // 10 buckets
  const trend = ti.trend[0]; // b/n/t
  return `${priceBucket}|${rsiBucket}|${macdSign}|${trend}|${obBucket}|${frBucket}|${scoreBucket}`;
}

/**
 * The gate — ponytail's ladder. Returns the first rung that holds.
 * Order matters: cheapest, safest skips first; LLM call last.
 */
export function gateDecide(input: GateInput): GateDecision {
  const { indicators, orderbook, fundingRate, ticker, deterministic, watch, config, budgetExhausted, now } = input;
  const { score: noteworthiness } = computeNoteworthiness(indicators, orderbook, fundingRate, ticker);
  const regime = classifyRegime(indicators, ticker);
  const dataSig = dataSignature(indicators, orderbook, fundingRate, ticker);

  // Indicator agreement = how one-sided the 5-indicator vote is. 1.0 = all
  // agree, 0.2 = fully split. Used for the unanimous-skip rung.
  const votes = indicators.summary.buy + indicators.summary.sell + indicators.summary.neutral;
  const agreement = votes > 0 ? Math.max(indicators.summary.buy, indicators.summary.sell) / votes : 0;
  const detConviction = deterministic.conviction;

  // Rung 2 (budget): free-tier safety net. Downshift to deterministic-only.
  if (budgetExhausted) {
    return { action: 'skip', tier: 0, reason: 'budget-exhausted', noteworthiness, regime, dataSig, estimatedSavedTokens: ESTIMATED_CALL_TOKENS };
  }

  // Rung 1 (YAGNI): the deterministic layers already agree strongly and the
  // conviction is high. An LLM would just paraphrase the math. Skip it.
  if (detConviction >= config.unanimousConviction && agreement >= config.unanimousAgreement) {
    return { action: 'skip', tier: 0, reason: 'unanimous-deterministic', noteworthiness, regime, dataSig, estimatedSavedTokens: ESTIMATED_CALL_TOKENS };
  }

  // Rung 3 (cache): the market state fingerprint is unchanged since the last
  // LLM verdict, and that verdict is still fresh. Reuse it.
  if (watch?.lastVerdict && watch.lastDataSig === dataSig && (now - watch.lastAnalyzedAt) < config.cacheTtlMs) {
    return { action: 'cache', tier: 0, reason: 'data-unchanged', noteworthiness, regime, dataSig, estimatedSavedTokens: ESTIMATED_CALL_TOKENS };
  }

  // Rung 4 (cadence): nothing noteworthy is happening AND we analyzed recently.
  // Don't re-analyze a calm market. (Force-run clears lastAnalyzedAt, so a
  // manual override bypasses this rung — manual control preserved.)
  if (watch?.lastAnalyzedAt && (now - watch.lastAnalyzedAt) < config.minReanalyzeMs && noteworthiness < config.highNoteworthiness) {
    return { action: 'skip', tier: 0, reason: 'calm-recently-analyzed', noteworthiness, regime, dataSig, estimatedSavedTokens: ESTIMATED_CALL_TOKENS };
  }

  // Rung 5 (minimum): call the LLM. Tier by noteworthiness — high = deep,
  // otherwise triage (compressed prompt). Both reuse the same configured model;
  // the difference is prompt size, which is where the token savings live.
  const tier: 1 | 2 = noteworthiness >= config.highNoteworthiness ? 2 : 1;
  return { action: 'analyze', tier, reason: tier === 2 ? 'high-noteworthiness' : 'noteworthy', noteworthiness, regime, dataSig, estimatedSavedTokens: 0 };
}

/** Estimated tokens a skipped/cached call saves — for the scoreboard. */
export const ESTIMATED_SAVED_TOKENS = ESTIMATED_CALL_TOKENS;
