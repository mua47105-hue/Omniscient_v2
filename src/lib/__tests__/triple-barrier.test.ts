import { describe, test, expect } from 'bun:test';
import { tripleBarrierLabel } from '@/lib/analysis/triple-barrier';
import type { Kline } from '@/lib/types';

// Config uses: takeProfitAtr, stopLossAtr, timeoutBars, side (not slMult/tpMult/holdingPeriod/direction)

function kl(o: number, h: number, l: number, c: number): Kline {
  return { openTime: 0, open: o, high: h, low: l, close: c, volume: 1000, closeTime: 0 };
}

describe('tripleBarrierLabel', () => {
  test('TP hit → label 1', () => {
    // Entry 100, ATR 2, TP=100+2*2=104. Bar with high=105 → TP hit.
    const klines = [kl(100, 101, 99, 100), kl(100, 105, 100, 104)];
    const r = tripleBarrierLabel(100, 2, klines, 0, { takeProfitAtr: 2, stopLossAtr: 1.5, timeoutBars: 3, side: 'long' });
    expect(r.label).toBe(1);
    expect(r.exitReason).toBe('take_profit');
  });
  test('SL hit → label -1 (conservative: SL first)', () => {
    // Entry 100, ATR 2, SL=100-1.5*2=97. Bar with low=94 → SL hit.
    const klines = [kl(100, 101, 99, 100), kl(100, 103, 94, 98)];
    const r = tripleBarrierLabel(100, 2, klines, 0, { takeProfitAtr: 2, stopLossAtr: 1.5, timeoutBars: 3, side: 'long' });
    expect(r.label).toBe(-1);
    expect(r.exitReason).toBe('stop_loss');
  });
  test('Timeout → label 0', () => {
    const klines = [kl(100, 100.5, 99.5, 100), kl(100, 100.5, 99.5, 100), kl(100, 100.5, 99.5, 100.5)];
    const r = tripleBarrierLabel(100, 2, klines, 0, { takeProfitAtr: 10, stopLossAtr: 10, timeoutBars: 2, side: 'long' });
    expect(r.label).toBe(0);
    expect(r.exitReason).toBe('timeout');
  });
  test('intra-window SL touch detected', () => {
    // Long, entry=100, SL=95 (stopLossAtr=1.0 with atr=5). Price dips to 94 at bar 2.
    const klines = [
      kl(100, 101, 99, 100),
      kl(100, 101, 99, 100),
      kl(100, 100.5, 94, 94.5),
      kl(94.5, 98, 94, 97),
      kl(97, 103, 97, 102),
    ];
    const r = tripleBarrierLabel(100, 5, klines, 0, { takeProfitAtr: 10, stopLossAtr: 1.0, timeoutBars: 5, side: 'long' });
    expect(r.label).toBe(-1);
    expect(r.exitBar).toBe(2);
  });
  test('short side: TP below entry', () => {
    const klines = [kl(100, 101, 99, 100), kl(100, 101, 95, 97)];
    const r = tripleBarrierLabel(100, 2, klines, 0, { takeProfitAtr: 2, stopLossAtr: 1.5, timeoutBars: 3, side: 'short' });
    expect(r.label).toBe(1);
  });
});
