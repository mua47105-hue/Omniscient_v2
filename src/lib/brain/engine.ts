/**
 * Lazy Brain — pure logic core.
 *
 * No side effects, no DB, no globalThis. Every function here is a pure
 * transformation that the scheduler tick (`/api/scheduler/tick`) composes with
 * the state singleton in `./state.ts`. This separation makes the gate logic
 * unit-testable in isolation.
 *
 * The "ponytail's ladder" applied to token usage:
 *   1. Budget        — token window exhausted → skip LLM (free-tier safety net)
 *   2. YAGNI         — unanimous + high-conviction consensus → skip LLM
 *   3. Cache         — market-data fingerprint unchanged → reuse last verdict
 *   4. Cadence       — nothing noteworthy + recently analyzed → skip
 *   5. Minimum       — call the LLM (tier 1 triage or tier 2 deep)
 *
 * Order matters: the first rung that holds wins.
 */

import type {
  Ticker,
  OrderBook,
  TechnicalIndicators,
  ConsensusResult,
} from '@/lib/types';
import type { AssetWatch, BrainConfig, TriggerSource } from './types';
import {
  budgetExhausted,
  getConfig,
  getWatch,
  recordBudgetSkip,
  recordCacheHit,
  recordSkip,
} from './state';

// ---------------------------------------------------------------------------
// Regime classification
// ---------------------------------------------------------------------------

export type Regime = 'trending' | 'ranging' | 'volatile';

/**
 * Classify the price regime from indicators + ticker. Uses ATR% as the
 * volatility proxy and EMA12/EMA26 separation + RSI as the trend proxy.
 *
 *   - ATR% ≥ 4%           → volatile (regardless of trend)
 *   - |EMA12 − EMA26|/p ≥ 0.5% AND |RSI−50| ≥ 10 → trending
 *   - otherwise           → ranging
 */
export function classifyRegime(ti: TechnicalIndicators, ticker: Ticker): Regime {
  const price = ti.lastClose ?? ticker.lastPrice;
  if (!price || price <= 0) return 'ranging';

  const atr = ti.atr14 ?? 0;
  const atrPct = atr / price;
  if (atrPct >= 0.04) return 'volatile';

  const e12 = ti.ema12 ?? null;
  const e26 = ti.ema26 ?? null;
  const rsi = ti.rsi14 ?? null;

  if (e12 != null && e26 != null && rsi != null) {
    const sep = Math.abs(e12 - e26) / price;
    const rsiDev = Math.abs(rsi - 50);
    if (sep >= 0.005 && rsiDev >= 10) return 'trending';
  }
  return 'ranging';
}

// ---------------------------------------------------------------------------
// Noteworthiness (0..100)
// ---------------------------------------------------------------------------

interface SignalScore {
  name: string;
  pts: number;
  note?: string;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Compute a 0..100 noteworthiness score from 7 signals. Each signal
 * contributes up to ~15 points; the sum is clamped to 100.
 *
 *   1. ATR% (volatility)               — atr/close scaled to 4% = max
 *   2. 24h move                        — |priceChangePercent| scaled to 8% = max
 *   3. RSI extreme                     — distance from 50, scaled at |30|
 *   4. MACD-trend divergence           — price trend vs MACD histogram sign mismatch
 *   5. Funding-rate extreme            — |funding| scaled to 0.1% per 8h = max
 *   6. Order-book imbalance            — bid/ask volume ratio scaled at 1.5x
 *   7. EMA50 boundary (decision point) — price within 1 ATR of EMA50 (proxy: ema26)
 */
export function computeNoteworthiness(
  ti: TechnicalIndicators,
  ob: OrderBook,
  fundingRate: number,
  ticker: Ticker,
): { score: number; signals: SignalScore[] } {
  const price = ti.lastClose ?? ticker.lastPrice;
  const signals: SignalScore[] = [];

  // 1. ATR%
  const atr = ti.atr14 ?? 0;
  const atrPct = price > 0 ? atr / price : 0;
  signals.push({
    name: 'atrPct',
    pts: clamp01(atrPct / 0.04) * 15,
    note: `atr%=${(atrPct * 100).toFixed(2)}`,
  });

  // 2. 24h move
  const move24h = Math.abs(ticker.priceChangePercent ?? 0);
  signals.push({
    name: 'move24h',
    pts: clamp01(move24h / 0.08) * 15,
    note: `move=${move24h.toFixed(2)}%`,
  });

  // 3. RSI extreme
  const rsi = ti.rsi14 ?? 50;
  const rsiDev = Math.abs(rsi - 50);
  signals.push({
    name: 'rsiExtreme',
    pts: clamp01(rsiDev / 30) * 15,
    note: `rsi=${rsi.toFixed(1)}`,
  });

  // 4. MACD-trend divergence (price making new extremes while MACD fades)
  const macdHist = ti.macd?.histogram ?? 0;
  const trend = ti.trend;
  let divergencePts = 0;
  if (trend === 'up' && macdHist < 0) divergencePts = 10; // bearish divergence
  else if (trend === 'down' && macdHist > 0) divergencePts = 10; // bullish divergence
  signals.push({
    name: 'macdDivergence',
    pts: divergencePts,
    note: `trend=${trend}, hist=${macdHist.toFixed(3)}`,
  });

  // 5. Funding extreme (per 8h)
  const fundAbs = Math.abs(fundingRate ?? 0);
  signals.push({
    name: 'fundingExtreme',
    pts: clamp01(fundAbs / 0.001) * 15,
    note: `fund=${(fundAbs * 100).toFixed(4)}%`,
  });

  // 6. Order-book imbalance
  let bidVol = 0;
  let askVol = 0;
  for (const b of ob.bids ?? []) bidVol += b.quantity ?? 0;
  for (const a of ob.asks ?? []) askVol += a.quantity ?? 0;
  const ratio = askVol > 0 ? bidVol / askVol : 1;
  const imbDev = Math.abs(Math.log(ratio || 1e-9));
  signals.push({
    name: 'obImbalance',
    pts: clamp01(imbDev / Math.log(1.5)) * 15,
    note: `b/a=${ratio.toFixed(2)}`,
  });

  // 7. EMA50 boundary — using ema26 as the closest available proxy. If the
  // indicators module exposes ema50 (it may compute more than the type
  // declares), prefer it.
  const ema50 =
    (ti as unknown as { ema50?: number | null }).ema50 ?? ti.ema26 ?? null;
  let emaPts = 0;
  if (ema50 != null && atr > 0) {
    const dist = Math.abs(price - ema50) / atr;
    // Within 1 ATR = full points (decision point). Falls off to 0 at 4 ATR.
    emaPts = clamp01(1 - (dist - 1) / 3) * 10;
  }
  signals.push({
    name: 'emaBoundary',
    pts: emaPts,
    note: `price=${price.toFixed(2)}, ema=${ema50?.toFixed(2) ?? 'n/a'}`,
  });

  const score = Math.min(100, Math.round(signals.reduce((s, x) => s + x.pts, 0)));
  return { score, signals };
}

// ---------------------------------------------------------------------------
// Data signature — coarse fingerprint for the cache gate
// ---------------------------------------------------------------------------

function bucket(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / step) * step;
}

/**
 * Coarse fingerprint of the current market state. Two consecutive ticks with
 * the same signature are assumed to carry no new information → cache hit.
 *
 * Buckets are deliberately coarse: close to 0.5%, RSI to 5, MACD to sign,
 * ATR% to 0.5%, funding to 0.01%, OB imbalance to 0.1, EMA-distance to 0.5 ATR.
 */
export function dataSignature(
  ti: TechnicalIndicators,
  ob: OrderBook,
  fundingRate: number,
  ticker: Ticker,
): string {
  const price = ti.lastClose ?? ticker.lastPrice;
  const atr = ti.atr14 ?? 0;
  const atrPct = price > 0 ? atr / price : 0;
  const rsi = ti.rsi14 ?? 50;
  const macdHist = ti.macd?.histogram ?? 0;
  const macdSign = macdHist > 0.0001 ? '+' : macdHist < -0.0001 ? '-' : '0';

  let bidVol = 0;
  let askVol = 0;
  for (const b of ob.bids ?? []) bidVol += b.quantity ?? 0;
  for (const a of ob.asks ?? []) askVol += a.quantity ?? 0;
  const obRatio = askVol > 0 ? bidVol / askVol : 1;
  const obDev = Math.log(obRatio || 1e-9);

  const ema50 =
    (ti as unknown as { ema50?: number | null }).ema50 ?? ti.ema26 ?? null;
  const emaDist = ema50 && atr > 0 ? (price - ema50) / atr : 0;

  const parts = [
    `c${bucket(price, price * 0.005).toFixed(2)}`,
    `r${bucket(rsi, 5)}`,
    `m${macdSign}`,
    `a${bucket(atrPct * 100, 0.5).toFixed(1)}`,
    `f${bucket(fundingRate * 100, 0.01).toFixed(2)}`,
    `o${bucket(obDev, 0.1).toFixed(1)}`,
    `e${bucket(emaDist, 0.5).toFixed(1)}`,
  ];
  return parts.join('|');
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type GateAction = 'skip' | 'cache' | 'analyze';

export interface GateInput {
  symbol: string;
  ti: TechnicalIndicators;
  ob: OrderBook;
  fundingRate: number;
  ticker: Ticker;
  /** Deterministic consensus — used by the YAGNI gate. */
  consensus?: ConsensusResult | null;
  /** Per-layer agreement fraction (0..1). If absent, derived from `consensus.layers`. */
  agreement?: number;
  /** Override flag from the force-run queue. Bypasses YAGNI/cache/cadence. */
  forceRun?: TriggerSource | null;
  /** Injected clock for tests. */
  now?: number;
  /** Average tokens a tier-1 LLM call costs this asset (for savings estimates). */
  estimatedTierTokens?: number;
}

export interface GateDecision {
  action: GateAction;
  tier: 0 | 1 | 2;
  reason: string;
  noteworthiness: number;
  regime: Regime;
  dataSig: string;
  estimatedSavedTokens: number;
}

/**
 * The ponytail's ladder. Returns the first rung that holds.
 *
 * Force-run bypasses YAGNI/cache/cadence (the laziness gates) but still
 * respects budget — the free-tier safety net must hold even when a human
 * explicitly queues an asset. The LLM circuit-breaker (`llmInCooldown`) is
 * checked by the caller, NOT here — force-run bypasses that too.
 */
export function gateDecide(input: GateInput): GateDecision {
  const cfg: BrainConfig = getConfig();
  const now = input.now ?? Date.now();
  const { ti, ob, fundingRate, ticker, symbol } = input;

  const { score: noteworthiness } = computeNoteworthiness(ti, ob, fundingRate, ticker);
  const regime = classifyRegime(ti, ticker);
  const dataSig = dataSignature(ti, ob, fundingRate, ticker);
  const watch = getWatch(symbol);

  const tierTokens = input.estimatedTierTokens ?? 1500;

  // Helper for the "skip and credit savings" decisions.
  const skip = (reason: string, saved: number): GateDecision => ({
    action: 'skip',
    tier: 0,
    reason,
    noteworthiness,
    regime,
    dataSig,
    estimatedSavedTokens: saved,
  });

  // -------------------------------------------------------------------------
  // 1. Budget — the safety net. Always checked first, even for force-run.
  // -------------------------------------------------------------------------
  if (budgetExhausted()) {
    recordBudgetSkip();
    return skip('budget-exhausted', 0);
  }

  // -------------------------------------------------------------------------
  // Force-run short-circuit: bypass YAGNI/cache/cadence. Pick tier based on
  // noteworthiness (deep for high-noteworthiness, triage otherwise).
  // -------------------------------------------------------------------------
  if (input.forceRun) {
    const tier: 0 | 1 | 2 = noteworthiness >= cfg.highNoteworthiness ? 2 : 1;
    return {
      action: 'analyze',
      tier,
      reason: `force-run:${input.forceRun}`,
      noteworthiness,
      regime,
      dataSig,
      estimatedSavedTokens: 0,
    };
  }

  // -------------------------------------------------------------------------
  // 2. YAGNI — unanimous deterministic consensus with high conviction.
  // -------------------------------------------------------------------------
  if (input.consensus) {
    const agreement =
      input.agreement != null
        ? input.agreement
        : layerAgreement(input.consensus);
    const isUnanimous =
      agreement >= cfg.unanimousAgreement &&
      input.consensus.conviction >= cfg.unanimousConviction &&
      input.consensus.direction !== 'neutral';
    if (isUnanimous) {
      const saved = tierTokens;
      recordSkip(saved);
      return skip('yagni-unanimous', saved);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Cache — same data fingerprint AND verdict still fresh.
  // -------------------------------------------------------------------------
  if (watch && watch.lastDataSig === dataSig) {
    const ageMs = now - watch.lastAnalyzedAt;
    if (ageMs < cfg.cacheTtlMs) {
      const saved = tierTokens;
      recordCacheHit(saved);
      return {
        action: 'cache',
        tier: 0,
        reason: `cache-hit(age=${Math.round(ageMs / 1000)}s)`,
        noteworthiness,
        regime,
        dataSig,
        estimatedSavedTokens: saved,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 4. Cadence — quiet market + recently analyzed.
  // -------------------------------------------------------------------------
  if (noteworthiness < cfg.minNoteworthiness && watch) {
    const ageMs = now - watch.lastAnalyzedAt;
    if (ageMs < cfg.minReanalyzeMs) {
      const saved = tierTokens;
      recordSkip(saved);
      return skip(
        `cadence-quiet(age=${Math.round(ageMs / 1000)}s,nw=${noteworthiness})`,
        saved,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 5. Minimum — call the LLM. Tier 2 (deep) for high-noteworthiness, else 1.
  // -------------------------------------------------------------------------
  const tier: 0 | 1 | 2 = noteworthiness >= cfg.highNoteworthiness ? 2 : 1;
  return {
    action: 'analyze',
    tier,
    reason: `analyze-tier${tier}(nw=${noteworthiness},${regime})`,
    noteworthiness,
    regime,
    dataSig,
    estimatedSavedTokens: 0,
  };
}

/**
 * Fraction of consensus layers whose direction matches the overall direction.
 * Used by the YAGNI gate. Returns 1 for an empty layer list (degenerate).
 */
export function layerAgreement(c: ConsensusResult): number {
  const layers = c.layers ?? [];
  if (layers.length === 0) return 1;
  const same = layers.filter((l) => l.direction === c.direction).length;
  return same / layers.length;
}

// ---------------------------------------------------------------------------
// Convenience: build an AssetWatch from a gate decision + consensus
// ---------------------------------------------------------------------------

export function watchFromDecision(
  symbol: string,
  decision: GateDecision,
  consensus: ConsensusResult | null | undefined,
  now: number = Date.now(),
): AssetWatch {
  return {
    symbol,
    lastAnalyzedAt: decision.action === 'analyze' ? now : 0,
    lastDataSig: decision.dataSig,
    lastVerdict: consensus?.direction ?? decision.reason,
    lastNoteworthiness: decision.noteworthiness,
    regime: decision.regime,
    action: decision.action,
    updatedAt: now,
  };
}
