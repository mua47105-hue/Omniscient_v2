/**
 * Brain engine types. Kept separate from state.ts so pure-logic modules
 * (engine.ts, selftune.ts, triggers.ts, news-triggers.ts) can import the
 * shapes without pulling in the globalThis singleton.
 */

export type BrainMode = 'auto' | 'manual';

export type TriggerSource = 'manual' | 'news' | 'cross-asset' | 'scheduler';

/** Gate thresholds — persisted to Setting KV (`brain.config`). */
export interface BrainConfig {
  /** Below this noteworthiness, the LLM is not consulted (cadence gate). */
  minNoteworthiness: number; // default 35
  /** Above this, force a tier-2 deep analysis. */
  highNoteworthiness: number; // default 65
  /** Conviction above which a unanimous deterministic consensus skips the LLM (YAGNI). */
  unanimousConviction: number; // default 70
  /** Layer-agreement fraction (0..1) above which a consensus is "unanimous". */
  unanimousAgreement: number; // default 0.8
  /** How long a cached verdict remains valid. */
  cacheTtlMs: number; // default 30min
  /** Minimum gap between two full LLM analyses of the same asset. */
  minReanalyzeMs: number; // default 10min
  /** Rolling token-budget cap per `budgetWindowMs` window. */
  budgetCap: number; // default 60000
  /** Length of the rolling budget window. */
  budgetWindowMs: number; // default 1hr
}

export interface AssetWatch {
  symbol: string;
  lastAnalyzedAt: number;
  lastDataSig: string;
  lastVerdict?: string;
  lastNoteworthiness: number;
  regime: 'trending' | 'ranging' | 'volatile';
  action: 'skip' | 'cache' | 'analyze';
  updatedAt: number;
}

export interface BrainStats {
  ticksTotal: number;
  llmCallsTotal: number;
  tokensUsed: number;
  tokensSaved: number;
  cacheHits: number;
  budgetSkips: number;
  triggersNews: number;
  triggersCrossAsset: number;
  triggersManual: number;
  alertsSent: number;
}

export interface StatsSample {
  ts: number;
  tokensUsed: number;
  tokensSaved: number;
  llmCalls: number;
  skips: number;
}

export interface TuneEvent {
  ts: number;
  field: string;
  from: number;
  to: number;
  reason: string;
  winRate: number;
  sampleSize: number;
}

export interface BrainAction {
  ts: number;
  symbol: string;
  action: 'skip' | 'cache' | 'analyze' | 'alert' | 'trigger' | 'tune' | 'grade';
  reason: string;
  tier?: number;
  tokens?: number;
  source?: TriggerSource;
}
