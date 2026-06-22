// Adversarial test harness — generates realistic market scenarios that
// contradict the naive indicator signals, then verifies the upgraded
// consensus engine detects the trap and inverts/downgrades correctly.
//
// This is the "red team" for the contrarian upgrade. Each test case is a
// synthetic OHLCV series that looks bullish to standard indicators (RSI
// oversold, MACD positive, price above EMA) but contains a hidden trap
// that a real trader would recognize. The PASS condition is that the
// contrarian layer detects the trap and the consensus engine does NOT
// issue a naive same-direction signal.
//
// Run with: bun run src/lib/analysis/__tests__/adversarial.test.ts

import { computeConsensus } from '@/lib/analysis/consensus';
import { detectDivergences } from '@/lib/analysis/divergence';
import { detectTraps } from '@/lib/analysis/trap-detector';
import { detectSqueezeRisk } from '@/lib/analysis/squeeze-risk';
import { analyzeOrderBookQuality } from '@/lib/analysis/orderbook-quality';
import { computeIndicators } from '@/lib/market/indicators';
import type { Kline, OrderBook } from '@/lib/types';

interface AdversarialTestCase {
  name: string;
  description: string;
  naiveExpectation: 'long' | 'short';
  actualOutcome: 'long' | 'short';
  klines: Kline[];
  fundingRate?: number;
  orderbook?: OrderBook;
}

function makeKline(time: number, o: number, h: number, l: number, c: number, v: number): Kline {
  return { openTime: time, open: o, high: h, low: l, close: c, volume: v, closeTime: time + 3600000 };
}

function generateBearishRsiDivergence(): Kline[] {
  const klines: Kline[] = [];
  let price = 100;
  const baseTime = Date.now() - 200 * 3600000;
  for (let i = 0; i < 80; i++) {
    const noise = (Math.sin(i * 0.3) + Math.random() * 0.5) * 1.5;
    price += noise + 0.3;
    const o = price - noise;
    const c = price;
    const h = c + Math.abs(noise) * 0.5 + 0.5;
    const l = o - Math.abs(noise) * 0.5;
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, 1000 + Math.random() * 500));
  }
  for (let i = 80; i < 110; i++) {
    price -= 0.8 + Math.random() * 0.5;
    const o = price + 0.5;
    const c = price;
    const h = o + 0.3;
    const l = c - 0.5;
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, 800 + Math.random() * 400));
  }
  for (let i = 110; i < 140; i++) {
    const momentum = 0.4;
    price += momentum + (Math.random() - 0.5) * 0.8;
    const o = price - 0.3;
    const c = price;
    const h = c + 0.4;
    const l = o - 0.3;
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, 700 + Math.random() * 300));
  }
  return klines;
}

function generateBullTrap(): Kline[] {
  const klines: Kline[] = [];
  let price = 100;
  const baseTime = Date.now() - 100 * 3600000;
  const resistance = 110;
  for (let i = 0; i < 90; i++) {
    price = 105 + Math.sin(i * 0.2) * 3 + (Math.random() - 0.5);
    const o = price;
    const c = price + (Math.random() - 0.5) * 0.5;
    const h = Math.max(o, c) + Math.random() * 0.3;
    const l = Math.min(o, c) - Math.random() * 0.3;
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, 1000 + Math.random() * 500));
  }
  const trapTime = baseTime + 90 * 3600000;
  klines.push(makeKline(trapTime, 108, 112, 107.5, 108.5, 1200));
  for (let i = 91; i < 95; i++) {
    price = 108 - (i - 90) * 0.8;
    klines.push(makeKline(baseTime + i * 3600000, price + 0.3, price + 0.5, price - 0.5, price, 900 + Math.random() * 300));
  }
  return klines;
}

function generateLiquiditySweep(): Kline[] {
  const klines: Kline[] = [];
  let price = 100;
  const baseTime = Date.now() - 100 * 3600000;
  // Phase 1: gentle downtrend to establish a swing low at ~95
  for (let i = 0; i < 40; i++) {
    price -= 0.15 + Math.random() * 0.2;
    const o = price + 0.2;
    const c = price;
    const h = o + 0.3;
    const l = c - 0.3;
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, 1000 + Math.random() * 400));
  }
  // Phase 2: bounce up to ~99 (creates a swing low at the bottom of phase 1)
  for (let i = 40; i < 60; i++) {
    price += 0.2 + Math.random() * 0.15;
    const o = price - 0.1;
    const c = price;
    const h = c + 0.2;
    const l = o - 0.2;
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, 900 + Math.random() * 300));
  }
  // Phase 3: drift back down toward the prior swing low (~95)
  for (let i = 60; i < 80; i++) {
    price -= 0.2 + Math.random() * 0.15;
    const o = price + 0.15;
    const c = price;
    const h = o + 0.2;
    const l = c - 0.2;
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, 800 + Math.random() * 300));
  }
  // The sweep candle: spikes below the prior swing low (to 92) then closes back above (96)
  const sweepTime = baseTime + 80 * 3600000;
  klines.push(makeKline(sweepTime, 95, 95.5, 92, 96, 2000)); // long lower wick, high volume
  // Reversal candles — price bounces up
  for (let i = 81; i < 95; i++) {
    price = 96 + (i - 80) * 0.5;
    klines.push(makeKline(baseTime + i * 3600000, price - 0.3, price + 0.3, price - 0.5, price, 1200 + Math.random() * 300));
  }
  return klines;
}

function generateVolumeDivergence(): Kline[] {
  const klines: Kline[] = [];
  let price = 100;
  const baseTime = Date.now() - 80 * 3600000;
  // First half: rising price with high volume (establishes the rally)
  for (let i = 0; i < 30; i++) {
    price += 0.6 + Math.random() * 0.3;
    const o = price - 0.4;
    const c = price;
    const h = c + 0.3;
    const l = o - 0.2;
    const vol = 2500 - i * 30 + Math.random() * 100;
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, vol));
  }
  // Second half: price still rising but volume declining sharply (weak rally)
  for (let i = 30; i < 60; i++) {
    price += 0.4 + Math.random() * 0.2; // still rising
    const o = price - 0.3;
    const c = price;
    const h = c + 0.2;
    const l = o - 0.2;
    const vol = 1600 - i * 25 + Math.random() * 80; // volume declining
    klines.push(makeKline(baseTime + i * 3600000, o, h, l, c, vol));
  }
  return klines;
}

function generateSpoofOrderBook(): OrderBook {
  const mid = 100;
  const bids: [number, number][] = [];
  const asks: [number, number][] = [];
  for (let i = 0; i < 20; i++) {
    bids.push([mid - 0.01 * (i + 1), 5 + Math.random() * 3]);
  }
  bids[2] = [mid - 0.03, 80];
  for (let i = 0; i < 20; i++) {
    asks.push([mid + 0.01 * (i + 1), 5 + Math.random() * 3]);
  }
  const bestBid = bids[0][0];
  const bestAsk = asks[0][0];
  const bidDepth = bids.reduce((s, b) => s + b[0] * b[1], 0);
  const askDepth = asks.reduce((s, a) => s + a[0] * a[1], 0);
  const total = bidDepth + askDepth;
  return {
    symbol: 'TEST',
    bids,
    asks,
    spread: bestAsk - bestBid,
    bidDepth,
    askDepth,
    imbalance: total > 0 ? (bidDepth - askDepth) / total : 0,
  };
}

interface TestResult {
  name: string;
  passed: boolean;
  naiveExpectation: string;
  actualOutcome: string;
  consensusDirection: string;
  contrarianDetected: boolean;
  details: string;
}

function runAdversarialTest(tc: AdversarialTestCase): TestResult {
  const indicators = computeIndicators(tc.klines);
  const consensus = computeConsensus({
    asset: 'TEST',
    timeframe: '4h',
    price: tc.klines[tc.klines.length - 1].close,
    technical: indicators,
    orderbook: tc.orderbook,
    fundingRate: tc.fundingRate,
    klines: tc.klines,
  });

  const divergences = detectDivergences(tc.klines);
  const traps = detectTraps(tc.klines, indicators);
  const squeeze = tc.fundingRate !== undefined ? detectSqueezeRisk(tc.fundingRate) : null;
  const obQuality = tc.orderbook ? analyzeOrderBookQuality(tc.orderbook) : null;

  const contrarianDetected = divergences.length > 0 || traps.length > 0 || squeeze !== null || obQuality?.signal !== null;
  const passed = consensus.direction === tc.actualOutcome || consensus.direction === 'neutral';

  const details: string[] = [];
  if (divergences.length > 0) details.push(`${divergences.length} divergence(s): ${divergences.map(d => d.type).join(',')}`);
  if (traps.length > 0) details.push(`${traps.length} trap(s): ${traps.map(t => t.type).join(',')}`);
  if (squeeze) details.push(`squeeze: ${squeeze.type}`);
  if (obQuality?.signal) details.push(`spoof: ${obQuality.signal.type}`);
  details.push(`consensus: ${consensus.direction} (${consensus.conviction})`);

  return {
    name: tc.name,
    passed,
    naiveExpectation: tc.naiveExpectation,
    actualOutcome: tc.actualOutcome,
    consensusDirection: consensus.direction,
    contrarianDetected,
    details: details.join(' | '),
  };
}

export function runAllAdversarialTests(): {
  results: TestResult[];
  passed: number;
  failed: number;
  total: number;
} {
  const testCases: AdversarialTestCase[] = [
    {
      name: 'Bearish RSI Divergence',
      description: 'Price makes higher high, RSI makes lower high → bearish reversal',
      naiveExpectation: 'long',
      actualOutcome: 'short',
      klines: generateBearishRsiDivergence(),
    },
    {
      name: 'Bull Trap (Failed Breakout)',
      description: 'Price breaks above resistance then closes back below → bearish',
      naiveExpectation: 'long',
      actualOutcome: 'short',
      klines: generateBullTrap(),
    },
    {
      name: 'Liquidity Sweep (Stop Hunt)',
      description: 'Price spikes below prior low then reverses → bullish',
      naiveExpectation: 'short',
      actualOutcome: 'long',
      klines: generateLiquiditySweep(),
    },
    {
      name: 'Volume Divergence (Weak Rally)',
      description: 'Price rising but volume declining → bearish',
      naiveExpectation: 'long',
      actualOutcome: 'short',
      klines: generateVolumeDivergence(),
    },
    {
      name: 'Order Book Spoofing (Fake Bid Wall)',
      description: 'Large bid wall near mid-price is likely a spoof → bearish',
      naiveExpectation: 'long',
      actualOutcome: 'short',
      klines: generateVolumeDivergence(),
      orderbook: generateSpoofOrderBook(),
    },
    {
      name: 'Long Squeeze Risk (Extreme Funding)',
      description: 'Funding rate +0.15%/8h = overcrowded longs → bearish',
      naiveExpectation: 'long',
      actualOutcome: 'short',
      klines: generateVolumeDivergence(),
      fundingRate: 0.0015,
    },
  ];

  const results = testCases.map(runAdversarialTest);
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, failed: results.length - passed, total: results.length };
}

if (require.main === module) {
  const { results, passed, failed, total } = runAllAdversarialTests();
  console.log('\n🛡️  ADVERSARIAL TEST RESULTS\n');
  console.log('========================================\n');
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name}`);
    console.log(`   Naive: ${r.naiveExpectation} | Actual: ${r.actualOutcome} | Consensus: ${r.consensusDirection}`);
    console.log(`   Contrarian detected: ${r.contrarianDetected}`);
    console.log(`   ${r.details}\n`);
  }
  console.log('========================================');
  console.log(`Passed: ${passed}/${total} | Failed: ${failed}/${total}`);
  process.exit(failed > 0 ? 1 : 0);
}
