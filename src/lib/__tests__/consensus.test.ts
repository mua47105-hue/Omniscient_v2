// Characterization tests for src/lib/analysis/consensus.ts

import {
  computeConsensus,
  buildTechnicalLayer,
  buildOrderbookLayer,
  buildSentimentLayer,
  buildOnchainLayer,
  shouldAlert,
  type OnchainTrend,
} from '@/lib/analysis/consensus';
import type { TechnicalIndicators, OrderBook, NewsArticle } from '@/lib/types';
import { describe, test, expect } from 'bun:test';

const mockIndicators: TechnicalIndicators = {
  sma20: 102,
  ema12: 105,
  ema26: 100,
  rsi14: 65,
  macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
  bollinger: { upper: 110, middle: 100, lower: 90 },
  vwap: 103,
  atr14: 2.5,
  lastClose: 104,
  trend: 'up',
  votes: { rsi: 1, macd: 1, ema: 1, bollinger: 1, vwap: 0 },
  summaryScore: 60,
};

const mockOrderbook: OrderBook = {
  symbol: 'BTCUSDT',
  bids: [
    { price: 100, quantity: 5 },
    { price: 99, quantity: 3 },
  ],
  asks: [
    { price: 101, quantity: 2 },
    { price: 102, quantity: 4 },
  ],
  fetchedAt: Date.now(),
};

describe('buildTechnicalLayer', () => {
  test('returns score matching summaryScore', () => {
    const layer = buildTechnicalLayer(mockIndicators);
    expect(layer.layer).toBe('technical');
    expect(layer.score).toBe(60);
  });

  test('confidence is in [0, 1] and boosted by trend alignment', () => {
    const layer = buildTechnicalLayer(mockIndicators);
    expect(layer.confidence).toBeGreaterThanOrEqual(0);
    expect(layer.confidence).toBeLessThanOrEqual(1);
    // 4 non-zero votes → 0.8 base, trend up + direction long → +0.15 → 0.95
    expect(layer.confidence).toBeCloseTo(0.95, 2);
  });
});

describe('buildOrderbookLayer', () => {
  test('positive imbalance → positive score', () => {
    const layer = buildOrderbookLayer(mockOrderbook);
    expect(layer.score).toBeGreaterThan(0);
  });

  test('score is clamped to [-100, 100] when imbalance is extreme', () => {
    // All bid volume, no ask volume → imbalance = 1 → score = 100.
    const extremeOB: OrderBook = { ...mockOrderbook, asks: [] };
    const layer = buildOrderbookLayer(extremeOB);
    expect(layer.score).toBeLessThanOrEqual(100);
    expect(layer.score).toBe(100);
  });
});

describe('buildSentimentLayer', () => {
  test('positive news sentiment → positive layer score', () => {
    const news: NewsArticle[] = [
      { source: 'coindesk', title: 'BTC pumps', sentiment: 0.5, impact: 'medium', publishedAt: 0 },
    ];
    const layer = buildSentimentLayer(news);
    // avg = 0.5 (single medium article), score = 0.5 * 100 = 50.
    expect(layer.score).toBe(50);
  });

  test('no news → neutral direction with zero confidence', () => {
    const layer = buildSentimentLayer([]);
    expect(layer.direction).toBe('neutral');
    expect(layer.score).toBe(0);
    expect(layer.confidence).toBe(0);
  });

  test('high-impact articles count double in the weighted average', () => {
    const news: NewsArticle[] = [
      { source: 'a', title: 'x', sentiment: 1, impact: 'high', publishedAt: 0 }, // weight 2
      { source: 'b', title: 'y', sentiment: -1, impact: 'low', publishedAt: 0 }, // weight 1
    ];
    // weighted avg = (1*2 + -1*1) / 3 = 1/3 ≈ 0.333 → score ≈ 33.33
    const layer = buildSentimentLayer(news);
    expect(layer.score).toBeCloseTo(33.33, 0);
  });
});

describe('buildOnchainLayer', () => {
  test('returns null for non-BTC assets', () => {
    const trend: OnchainTrend = { asset: 'ETH', samples: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
    const layer = buildOnchainLayer(trend, 'ETHUSDT');
    expect(layer).toBeNull();
  });

  test('returns null for insufficient samples (<3)', () => {
    const trend: OnchainTrend = { asset: 'BTC', samples: [1, 2] };
    const layer = buildOnchainLayer(trend, 'BTCUSDT');
    expect(layer).toBeNull();
  });

  test('rising hashrate → positive score for BTC', () => {
    const trend: OnchainTrend = {
      asset: 'BTC',
      samples: [100, 110, 120, 130, 140, 150, 160, 170, 180, 190],
    };
    const layer = buildOnchainLayer(trend, 'BTCUSDT');
    expect(layer).not.toBeNull();
    expect(layer!.score).toBeGreaterThan(0);
  });

  test('falling hashrate → negative score for BTC', () => {
    const trend: OnchainTrend = {
      asset: 'BTC',
      samples: [190, 180, 170, 160, 150, 140, 130, 120, 110, 100],
    };
    const layer = buildOnchainLayer(trend, 'BTCUSDT');
    expect(layer).not.toBeNull();
    expect(layer!.score).toBeLessThan(0);
  });
});

describe('computeConsensus', () => {
  test('returns a valid ConsensusResult', () => {
    const technical = buildTechnicalLayer(mockIndicators);
    const orderbook = buildOrderbookLayer(mockOrderbook);
    const result = computeConsensus({
      symbol: 'BTCUSDT',
      technical,
      orderbook,
    });
    expect(result.symbol).toBe('BTCUSDT');
    expect(['long', 'short', 'neutral']).toContain(result.direction);
    expect(result.conviction).toBeGreaterThanOrEqual(0);
    expect(result.conviction).toBeLessThanOrEqual(100);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  test('high technical score + bullish orderbook → likely long', () => {
    const technical = buildTechnicalLayer(mockIndicators); // score = 60
    const orderbook = buildOrderbookLayer(mockOrderbook); // score = ~14
    const result = computeConsensus({
      symbol: 'BTCUSDT',
      technical,
      orderbook,
    });
    expect(['long', 'neutral']).toContain(result.direction);
  });

  test('rationale includes layer breakdowns', () => {
    const technical = buildTechnicalLayer(mockIndicators);
    const orderbook = buildOrderbookLayer(mockOrderbook);
    const result = computeConsensus({
      symbol: 'BTCUSDT',
      technical,
      orderbook,
    });
    expect(result.rationale).toContain('technical');
    expect(result.rationale).toContain('orderbook');
  });
});

describe('shouldAlert', () => {
  test('returns true for qualifying long signal', () => {
    const signal = { direction: 'long' as const, conviction: 70, summaryScore: 50 };
    expect(shouldAlert(signal, { longConviction: 60, minScore: 35 })).toBe(true);
  });

  test('returns false for neutral direction', () => {
    const signal = { direction: 'neutral' as const, conviction: 70, summaryScore: 50 };
    expect(shouldAlert(signal)).toBe(false);
  });

  test('returns false for conviction below threshold', () => {
    const signal = { direction: 'long' as const, conviction: 50, summaryScore: 50 };
    expect(shouldAlert(signal, { longConviction: 60 })).toBe(false);
  });

  test('returns false when |summaryScore| is below minScore', () => {
    const signal = { direction: 'long' as const, conviction: 70, summaryScore: 20 };
    expect(shouldAlert(signal, { minScore: 35 })).toBe(false);
  });
});
