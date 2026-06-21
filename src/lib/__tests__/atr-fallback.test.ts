import { describe, test, expect } from 'bun:test';

// Test the ATR fallback logic extracted from the tick route.
// The code at tick/route.ts:413-426 uses `if (stopLoss == null)` — it only
// fills ATR-based levels when consensus didn't provide them. It does NOT override.

function applyAtrFallback(
  consensusStopLoss: number | null,
  consensusTakeProfit: number | null,
  entryPrice: number,
  atr: number,
  direction: 'long' | 'short' | 'neutral',
): { stopLoss: number | null; takeProfit: number | null } {
  let stopLoss = consensusStopLoss;
  let takeProfit = consensusTakeProfit;
  if (entryPrice && atr > 0 && direction !== 'neutral') {
    if (stopLoss == null) {
      stopLoss = direction === 'long' ? entryPrice - 1.5 * atr : entryPrice + 1.5 * atr;
    }
    if (takeProfit == null) {
      takeProfit = direction === 'long' ? entryPrice + 2 * atr : entryPrice - 2 * atr;
    }
  }
  return { stopLoss, takeProfit };
}

describe('ATR stop/TP fallback', () => {
  test('does NOT override consensus-provided stopLoss', () => {
    expect(applyAtrFallback(64000, null, 65000, 500, 'long').stopLoss).toBe(64000);
  });
  test('does NOT override consensus-provided takeProfit', () => {
    expect(applyAtrFallback(null, 70000, 65000, 500, 'long').takeProfit).toBe(70000);
  });
  test('fills SL from ATR when null (long)', () => {
    expect(applyAtrFallback(null, null, 65000, 500, 'long').stopLoss).toBe(64250);
  });
  test('fills TP from ATR when null (long)', () => {
    expect(applyAtrFallback(null, null, 65000, 500, 'long').takeProfit).toBe(66000);
  });
  test('fills SL from ATR (short: above entry)', () => {
    expect(applyAtrFallback(null, null, 65000, 500, 'short').stopLoss).toBe(65750);
  });
  test('does not fill for neutral', () => {
    const r = applyAtrFallback(null, null, 65000, 500, 'neutral');
    expect(r.stopLoss).toBeNull();
    expect(r.takeProfit).toBeNull();
  });
  test('does not fill when ATR is 0', () => {
    const r = applyAtrFallback(null, null, 65000, 0, 'long');
    expect(r.stopLoss).toBeNull();
  });
  test('preserves both when both provided', () => {
    const r = applyAtrFallback(63000, 68000, 65000, 500, 'long');
    expect(r.stopLoss).toBe(63000);
    expect(r.takeProfit).toBe(68000);
  });
});
