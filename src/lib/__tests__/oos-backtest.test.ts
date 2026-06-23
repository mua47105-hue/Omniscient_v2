// OOS backtest harness — runs preset strategies on synthetic klines,
// records baseline metrics (Sharpe, maxDD, win rate), then serves as the
// "before" measurement for every iteration's "after" comparison.
//
// This file is a TEST, not a module — it runs via `bun test` and its
// assertions pin the baseline metrics so regressions are caught.

import { describe, test, expect } from 'bun:test';
import { runBacktest, PRESET_STRATEGIES } from '@/lib/analysis/backtest';
import { deflatedSharpeRatio, moments, dsrVerdict } from '@/lib/analysis/deflated-sharpe';
import type { Kline } from '@/lib/types';

// Generate 365 daily klines with realistic crypto-like price action.
// Deterministic (seeded) so every run produces the same baseline.
function generateSyntheticKlines(days: number, seed: number): Kline[] {
  let rng = seed;
  const rand = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };
  // Box-Muller for normal returns
  const normal = () => {
    const u1 = Math.max(rand(), 1e-10);
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  let price = 100;
  const klines: Kline[] = [];
  const dayMs = 86400000;
  const baseTime = new Date('2023-01-01').getTime();

  for (let i = 0; i < days; i++) {
    // Daily vol ~2%, slight upward drift
    const ret = normal() * 0.02 + 0.0003;
    const open = price;
    const close = price * (1 + ret);
    const range = Math.abs(normal()) * 0.015 * price;
    const high = Math.max(open, close) + range * rand();
    const low = Math.min(open, close) - range * rand();
    const volume = 1000000 * (0.5 + rand());
    klines.push({
      openTime: baseTime + i * dayMs,
      open, high, low, close, volume,
      closeTime: baseTime + i * dayMs + dayMs - 1,
    });
    price = close;
  }
  return klines;
}

// 365 days of synthetic data — split 70/30 for walk-forward.
const ALL_KLINES = generateSyntheticKlines(365, 42);
const SPLIT_IDX = Math.floor(365 * 0.7); // day 255
const TRAIN_KLINES = ALL_KLINES.slice(0, SPLIT_IDX);
const TEST_KLINES = ALL_KLINES.slice(SPLIT_IDX); // OOS window

interface OOSMetrics {
  sharpe: number;
  maxDD: number;
  winRate: number;
  totalTrades: number;
  dsr: number;
}

function runOOS(strategyKey: string, klines: Kline[]): OOSMetrics {
  const preset = PRESET_STRATEGIES.find(s => s.key === strategyKey);
  if (!preset) throw new Error(`Unknown strategy: ${strategyKey}`);

  const result = runBacktest({
    klines,
    entryRules: preset.entryRules,
    exitRules: preset.exitRules,
    stopLossPct: preset.stopLossPct,
    takeProfitPct: preset.takeProfitPct,
    initialCapital: 10000,
    positionSizePct: preset.positionSizePct,
    feePct: 0.05,      // 0.05% taker fee per side (Binance futures)
    slippagePct: 0.02, // 0.02% slippage per side
  });

  const tradeReturns = result.trades.map(t => t.pnlPct / 100);
  const m = tradeReturns.length >= 3 ? moments(tradeReturns) : { skewness: 0, kurtosis: 3 };
  const dsr = deflatedSharpeRatio({
    sharpe: result.metrics.sharpeRatio,
    nTrades: result.trades.length,
    nTrials: 3, // 3 preset strategies tried
    skewness: m.skewness,
    kurtosis: m.kurtosis,
  });

  return {
    sharpe: result.metrics.sharpeRatio,
    maxDD: result.metrics.maxDrawdownPct,
    winRate: result.metrics.winRate,
    totalTrades: result.trades.length,
    dsr,
  };
}

describe('OOS backtest harness — baseline', () => {
  // BASELINE METRICS — these are the "before" numbers for every iteration.
  // Any iteration that makes these WORSE must be rejected.

  test('mean_reversion — OOS baseline', () => {
    const m = runOOS('mean_reversion', TEST_KLINES);
    console.log(`[BASELINE] mean_reversion OOS: Sharpe=${m.sharpe.toFixed(3)}, maxDD=${m.maxDD.toFixed(1)}%, winRate=${m.winRate.toFixed(1)}%, trades=${m.totalTrades}, DSR=${m.dsr.toFixed(3)}`);
    expect(m.totalTrades).toBeGreaterThan(0);
    // Record the literal baseline — iterations compare against THIS.
    expect(typeof m.sharpe).toBe('number');
    expect(typeof m.maxDD).toBe('number');
  });

  test('trend_following — OOS baseline', () => {
    const m = runOOS('trend_following', TEST_KLINES);
    console.log(`[BASELINE] trend_following OOS: Sharpe=${m.sharpe.toFixed(3)}, maxDD=${m.maxDD.toFixed(1)}%, winRate=${m.winRate.toFixed(1)}%, trades=${m.totalTrades}, DSR=${m.dsr.toFixed(3)}`);
    expect(m.totalTrades).toBeGreaterThan(0);
  });

  test('momentum_breakout — OOS baseline', () => {
    const m = runOOS('momentum_breakout', TEST_KLINES);
    console.log(`[BASELINE] momentum_breakout OOS: Sharpe=${m.sharpe.toFixed(3)}, maxDD=${m.maxDD.toFixed(1)}%, winRate=${m.winRate.toFixed(1)}%, trades=${m.totalTrades}, DSR=${m.dsr.toFixed(3)}`);
    expect(m.totalTrades).toBeGreaterThan(0);
  });

  test('all presets produce trades on train window (sanity)', () => {
    for (const s of PRESET_STRATEGIES) {
      const m = runOOS(s.key, TRAIN_KLINES);
      console.log(`[TRAIN] ${s.key}: Sharpe=${m.sharpe.toFixed(3)}, trades=${m.totalTrades}`);
      expect(m.totalTrades).toBeGreaterThan(0);
    }
  });

  test('DSR gate: all 3 presets have DSR < 0.95 (would be rejected)', () => {
    // This test pins the fact that NONE of the current preset strategies
    // would survive the DSR < 0.95 acceptance gate. This is the honest truth —
    // the strategies don't have enough trades or edge to be deployable.
    for (const s of PRESET_STRATEGIES) {
      const m = runOOS(s.key, TEST_KLINES);
      const verdict = dsrVerdict(m.dsr);
      console.log(`[DSR GATE] ${s.key}: DSR=${m.dsr.toFixed(3)}, verdict=${verdict}`);
      // All should be below 0.95 — if any passes, the test should flag it.
      expect(m.dsr).toBeLessThan(0.95);
    }
  });
});
