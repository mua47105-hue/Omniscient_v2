/**
 * Shared TypeScript types used across the OMNISCIENT core lib layer.
 * Plain server modules — no React, no 'use server'.
 */

// ---------------------------------------------------------------------------
// Enumerations (string-union types — JSON-friendly, schema-stable)
// ---------------------------------------------------------------------------

export type AssetClass =
  | 'crypto'
  | 'forex'
  | 'stocks'
  | 'indices'
  | 'commodities'
  | 'macro';

export type Direction = 'long' | 'short' | 'neutral';

export type SignalStatus = 'open' | 'closed' | 'expired';

export type AnalysisLayer =
  | 'technical'
  | 'orderbook'
  | 'onchain'
  | 'sentiment'
  | 'macro'
  | 'fundamental'
  | 'intermarket'
  | 'llm';

export type ModuleKey =
  | 'crypto_technical'
  | 'markets_analysis'
  | 'news_sentiment'
  | 'scheduler_tick'
  | 'macro_analysis';

// ---------------------------------------------------------------------------
// Market data shapes
// ---------------------------------------------------------------------------

export interface Ticker {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  openPrice?: number;
  closeTime?: number;
  fetchedAt: number;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades?: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  fetchedAt: number;
}

export interface FundingRate {
  symbol: string;
  fundingRate: number;
  fundingTime?: number;
  nextFundingTime?: number;
  markPrice?: number;
}

export interface OpenInterest {
  symbol: string;
  openInterest: number;
  openInterestValue?: number;
  time: number;
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

export interface TechnicalIndicators {
  sma20: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: { macd: number | null; signal: number | null; histogram: number | null };
  bollinger: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
  };
  vwap: number | null;
  atr14: number | null;
  lastClose: number | null;
  trend: 'up' | 'down' | 'sideways';
  // 5-indicator vote: each indicator votes +1 (bull) / -1 (bear) / 0 (neutral)
  votes: { rsi: number; macd: number; ema: number; bollinger: number; vwap: number };
  // Summary score in [-100, 100] = voteSum * 20
  summaryScore: number;
}

// ---------------------------------------------------------------------------
// Consensus
// ---------------------------------------------------------------------------

export interface LayerScore {
  layer: AnalysisLayer;
  direction: Direction;
  score: number; // -100..100
  confidence: number; // 0..1
  rationale?: string;
  weight?: number;
}

export interface ConsensusInput {
  symbol: string;
  assetClass?: AssetClass;
  technical?: LayerScore;
  orderbook?: LayerScore;
  onchain?: LayerScore | null;
  sentiment?: LayerScore;
  macro?: LayerScore;
  fundamental?: LayerScore;
  intermarket?: LayerScore;
  llm?: LayerScore;
}

export interface ConsensusResult {
  symbol: string;
  direction: Direction;
  conviction: number; // 0..100
  summaryScore: number; // -100..100
  layers: LayerScore[];
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  rationale: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  moduleKey?: ModuleKey;
  layer?: string;
  preferProvider?: string;
  signal?: AbortSignal;
}

export interface LlmCompletionResponse {
  text: string;
  provider: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

export interface NewsArticle {
  id?: string;
  source: string;
  url?: string;
  title: string;
  body?: string;
  publishedAt: string | number;
  sentiment?: number; // -1..1
  impact?: 'low' | 'medium' | 'high';
  assetsTagged?: string[];
}

// ---------------------------------------------------------------------------
// Generic API result envelope
// ---------------------------------------------------------------------------

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
