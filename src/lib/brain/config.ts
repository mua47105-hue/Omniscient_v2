/**
 * Default BrainConfig + small helpers. Kept in its own file so both state.ts
 * (initial state) and the brain API (POST setConfig) share a single source
 * of truth.
 */

import type { BrainConfig } from './types';

export function defaultBrainConfig(): BrainConfig {
  return {
    minNoteworthiness: 35,
    highNoteworthiness: 65,
    unanimousConviction: 70,
    unanimousAgreement: 0.8,
    cacheTtlMs: 30 * 60 * 1000, // 30 min
    minReanalyzeMs: 10 * 60 * 1000, // 10 min
    budgetCap: 60_000,
    budgetWindowMs: 60 * 60 * 1000, // 1 hr
  };
}

/** Clamp helper used by selftune + setConfig validation. */
export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
