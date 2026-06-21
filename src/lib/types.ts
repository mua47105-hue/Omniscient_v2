// Shared types for the OMNISCIENT market intelligence system

export type AssetClass = 'crypto' | 'forex' | 'commodity' | 'index' | 'stock';
export type Direction = 'long' | 'short' | 'neutral';
export type SignalStatus = 'open' | 'closed' | 'expired';
export type AnalysisLayer =
  | 'technical'
  | 'orderbook'
  | 'onchain'
  | 'sentiment'
  | 'macro'
  | 'fundamental'
  | 'intermarket';

export type ModuleKey =
  | 'crypto_technical'
  | 'crypto_onchain'
  | 'news_sentiment'
  | 'macro_analysis'
  | 'forex_analysis'
  | 'commodity_analysis'
  | 'index_analysis'
  | 'stock_analysis'
  | 'ipo_ico_analysis'
  | 'intermarket';

export interface Ticker {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  updatedAt: number;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface OrderBook {
  symbol: string;
  bids: [number, number][]; // [price, qty]
  asks: [number, number][];
  spread: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number; // -1..1, >0 = more bids
}

export interface TechnicalIndicators {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  ema20: number;
  ema50: number;
  ema200: number;
  sma20: number;
  bollinger: { upper: number; middle: number; lower: number };
  vwap: number;
  atr: number;
  support: number[];
  resistance: number[];
  trend: 'bullish' | 'bearish' | 'neutral';
  summary: {
    buy: number;
    neutral: number;
    sell: number;
    score: number; // -100..100
  };
}

export interface LayerScore {
  layer: AnalysisLayer;
  score: number; // -100..100, negative = bearish
  confidence: number; // 0..100
  detail: string;
  model?: string;
}

export interface ConsensusResult {
  asset: string;
  direction: Direction;
  conviction: number; // 0..100
  timeframe: string;
  layers: LayerScore[];
  modelsUsed: string[];
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  rationale: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  provider: string;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LlmCompletionResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
  latencyMs: number;
}

export interface NewsArticle {
  source: string;
  title: string;
  url?: string;
  body?: string;
  publishedAt: Date;
  sentiment?: number;
  impact?: 'low' | 'medium' | 'high';
  assetsTagged?: string[];
}

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ---------------------------------------------------------------------------
// NOTIFICATION CENTER — unified activity feed (aggregates PriceAlert,
// Signal, and Alert rows into one timeline).
// ---------------------------------------------------------------------------

export type NotificationType = 'price' | 'signal' | 'telegram' | 'system';
export type NotificationSeverity = 'critical' | 'warning' | 'info';

export interface NotificationMetadata {
  // Price-alert derived
  condition?: string; // above | below | crosses_up | crosses_down
  targetPrice?: number;
  triggeredPrice?: number | null;
  channel?: string; // dashboard | telegram | both
  note?: string | null;
  // Signal derived
  direction?: Direction;
  conviction?: number; // 0..100
  timeframe?: string;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  rationale?: string;
  layersSummary?: string; // JSON string
  modelsUsed?: string; // JSON string
  signalStatus?: string; // open | closed | expired
  // Telegram alert derived
  alertStatus?: string; // sent | failed | pending
  error?: string | null;
  // Asset linkage
  assetId?: string;
  signalId?: string | null;
}

export interface NotificationItem {
  /** Composite ID prefixed by type so it's unique across sources */
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  assetSymbol?: string;
  /** ISO timestamp of when the event happened */
  timestamp: string;
  metadata: NotificationMetadata;
}

export interface NotificationCounts {
  type: Record<NotificationType, number>;
  severity: Record<NotificationSeverity, number>;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  total: number;
  unread: number;
  counts: NotificationCounts;
  mostActiveAsset?: { symbol: string; count: number } | null;
}
