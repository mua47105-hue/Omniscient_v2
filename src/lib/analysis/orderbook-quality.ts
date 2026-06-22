// Order book quality detector — spoofing + wall analysis.
//
// WHY THIS EXISTS:
// The audit (CONTRARIAN-AUDIT-1, loophole L7) found that the consensus engine
// treats order book imbalance as "real depth" with zero spoofing detection.
// A large bid wall near the current price makes the imbalance look bullish,
// but if that wall is a spoof (placed to trick traders, then pulled before
// execution), the bullish signal is fake.
//
// This module detects:
//   1. Wall concentration — is a single order disproportionately large vs
//      the rest of the book? (spoofing indicator)
//   2. Wall proximity — how close is the largest wall to the mid-price?
//      (closer = more likely to influence, but also more likely to be pulled)
//   3. Depth imbalance quality — is the imbalance driven by one huge wall
//      (suspicious) or distributed across many orders (genuine)?
//
// Detection logic from arXiv 2504.15908 (spoofing detection ~80-90% F1):
//   - Compute the Gini coefficient of order sizes within each side
//   - High Gini (>0.7) = one order dominates = spoofing risk
//   - A "spoof wall" is one that's >5× the median order size AND within 0.5%
//     of mid-price

import type { OrderBook } from '@/lib/types';

export interface OrderBookQualitySignal {
  type: 'spoof_wall_bid' | 'spoof_wall_ask' | 'genuine_imbalance';
  direction: 'long' | 'short';  // the CORRECTED direction (opposite of naive if spoofing)
  severity: number;             // 0..1
  description: string;
  adjustedImbalance: number;    // -1..1 — the imbalance AFTER removing suspected spoof walls
}

/**
 * Compute the Gini coefficient of a set of values (measures inequality).
 * 0 = perfectly equal distribution, 1 = one value dominates everything.
 */
function giniCoefficient(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  let cumulative = 0;
  for (let i = 0; i < n; i++) {
    cumulative += (i + 1) * sorted[i];
  }
  return (2 * cumulative) / (n * sum) - (n + 1) / n;
}

/**
 * Analyze order book quality and detect potential spoofing.
 *
 * @param ob - the order book snapshot (bids + asks as [price, qty] pairs)
 * @param midPrice - current mid-price for proximity calc (optional, defaults to best bid/ask mid)
 */
export function analyzeOrderBookQuality(ob: OrderBook, midPrice?: number): {
  signal: OrderBookQualitySignal | null;
  adjustedImbalance: number;  // imbalance after removing suspected spoof walls
  bidGini: number;
  askGini: number;
} {
  if (ob.bids.length === 0 || ob.asks.length === 0) {
    return { signal: null, adjustedImbalance: ob.imbalance, bidGini: 0, askGini: 0 };
  }

  const bestBid = ob.bids[0][0];
  const bestAsk = ob.asks[0][0];
  const mid = midPrice ?? (bestBid + bestAsk) / 2;

  const bidSizes = ob.bids.map((b) => b[1]);
  const askSizes = ob.asks.map((a) => a[1]);
  const bidGini = giniCoefficient(bidSizes);
  const askGini = giniCoefficient(askSizes);

  // Find the largest wall on each side
  const largestBid = ob.bids.reduce((max, b) => (b[1] > max[1] ? b : max), ob.bids[0]);
  const largestAsk = ob.asks.reduce((max, a) => (a[1] > max[1] ? a : max), ob.asks[0]);

  // Median order size for comparison
  const medianBid = [...bidSizes].sort((a, b) => a - b)[Math.floor(bidSizes.length / 2)] || 0;
  const medianAsk = [...askSizes].sort((a, b) => a - b)[Math.floor(askSizes.length / 2)] || 0;

  // Compute proximity of largest wall to mid-price (as % of mid)
  const bidWallProximity = Math.abs(largestBid[0] - mid) / mid;
  const askWallProximity = Math.abs(largestAsk[0] - mid) / mid;

  // --- Detect spoof walls ---
  // A spoof wall is: >5× median size AND within 0.5% of mid. The Gini check
  // is a secondary signal — the wall ratio alone is suspicious enough at this
  // proximity (real institutional orders are distributed, not concentrated
  // in a single huge wall at the touch).
  const bidWallRatio = medianBid > 0 ? largestBid[1] / medianBid : 1;
  const askWallRatio = medianAsk > 0 ? largestAsk[1] / medianAsk : 1;
  const bidSpoofRisk = bidWallRatio > 5 && bidWallProximity < 0.005;
  const askSpoofRisk = askWallRatio > 5 && askWallProximity < 0.005;

  // Compute adjusted imbalance: remove the suspected spoof wall from the calc
  let adjustedBidDepth = ob.bidDepth;
  let adjustedAskDepth = ob.askDepth;

  if (bidSpoofRisk) {
    adjustedBidDepth -= largestBid[0] * largestBid[1]; // remove the spoof wall's USD value
  }
  if (askSpoofRisk) {
    adjustedAskDepth -= largestAsk[0] * largestAsk[1];
  }

  const totalAdjusted = adjustedBidDepth + adjustedAskDepth;
  const adjustedImbalance = totalAdjusted > 0
    ? (adjustedBidDepth - adjustedAskDepth) / totalAdjusted
    : 0;

  // --- Generate signal ---
  if (bidSpoofRisk && !askSpoofRisk) {
    // Large bid wall is likely a spoof — the "bullish" imbalance is fake.
    // Fade the bullish signal → bearish contrarian.
    const wallDominance = largestBid[1] / (medianBid || 1);
    const severity = Math.min(1, (wallDominance / 10) * 0.5 + bidGini * 0.5);
    return {
      signal: {
        type: 'spoof_wall_bid',
        direction: 'short',
        severity,
        description: `Spoof wall detected on bid side: largest bid ${largestBid[1].toFixed(2)} units is ${wallDominance.toFixed(1)}× median, within ${(bidWallProximity * 100).toFixed(2)}% of mid — likely pulled before execution, imbalance is fake`,
        adjustedImbalance,
      },
      adjustedImbalance,
      bidGini,
      askGini,
    };
  }

  if (askSpoofRisk && !bidSpoofRisk) {
    // Large ask wall is likely a spoof — the "bearish" imbalance is fake.
    // Fade the bearish signal → bullish contrarian.
    const wallDominance = largestAsk[1] / (medianAsk || 1);
    const severity = Math.min(1, (wallDominance / 10) * 0.5 + askGini * 0.5);
    return {
      signal: {
        type: 'spoof_wall_ask',
        direction: 'long',
        severity,
        description: `Spoof wall detected on ask side: largest ask ${largestAsk[1].toFixed(2)} units is ${wallDominance.toFixed(1)}× median, within ${(askWallProximity * 100).toFixed(2)}% of mid — likely pulled before execution, imbalance is fake`,
        adjustedImbalance,
      },
      adjustedImbalance,
      bidGini,
      askGini,
    };
  }

  // No spoofing detected — the imbalance is genuine
  return {
    signal: null,
    adjustedImbalance: ob.imbalance, // original imbalance is genuine
    bidGini,
    askGini,
  };
}

/**
 * Aggregate order book quality into a contrarian score.
 * Only returns a non-zero score when spoofing is detected (fades the fake
 * imbalance). When the book is genuine, returns 0 (let the normal orderbook
 * layer handle it).
 */
export function aggregateOrderBookQualityScore(ob: OrderBook): {
  score: number;           // -100..100 — contrarian direction (0 = no spoofing)
  confidence: number;      // 0..100
  signal: OrderBookQualitySignal | null;
  adjustedImbalance: number;
} {
  const { signal, adjustedImbalance } = analyzeOrderBookQuality(ob);

  if (!signal) {
    return { score: 0, confidence: 0, signal: null, adjustedImbalance };
  }

  const score = signal.direction === 'long' ? 100 : -100;
  const confidence = Math.min(80, signal.severity * 80 + 15);

  return { score, confidence, signal, adjustedImbalance };
}
