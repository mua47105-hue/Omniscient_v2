// Self-tuning — the brain learns from its own grading feedback.
//
// After each autonomous scan, we read the most recent graded signals
// (SignalOutcome rows) and check: are high-conviction signals actually
// winning? Are low-noteworthiness ones just noise? We nudge the gate
// thresholds in small steps toward better calibration.
//
// This is the closed loop the worklog called out: "self-tuning thresholds
// from grading feedback". It's deliberately conservative:
//   - needs >= 12 graded signals to tune (small sample → no opinion)
//   - max ±2 per run, clamped to safe bounds
//   - only tunes when the brain is in auto mode + running
//   - persists the tuned config so it survives restarts
//
// The signal:noise ratio improves over time without spending a single token —
// the grades already exist, we're just reading them.

import { db } from '@/lib/db';
import { getConfig, setConfig, getMode, isRunning, recordAction, type BrainConfig } from '@/lib/brain/state';

// Safe bounds for each tunable. The brain can't push a threshold outside these
// no matter what the feedback says — prevents a bad sample from wrecking the gate.
const BOUNDS: Record<'unanimousConviction' | 'minNoteworthiness' | 'highNoteworthiness', [number, number]> = {
  unanimousConviction: [55, 85],
  minNoteworthiness: [20, 55],
  highNoteworthiness: [50, 80],
};
const MAX_STEP = 2; // max nudge per run

interface TuneResult {
  tuned: boolean;
  reason: string;
  before: Partial<BrainConfig>;
  after: Partial<BrainConfig>;
  sampleSize: number;
  winRate: number;
}

function clamp(v: number, [lo, hi]: [number, number], step: number, current: number): number {
  const nudged = current + step;
  return Math.max(lo, Math.min(hi, nudged));
}

/**
 * Read recent graded signals, compute win-rate by conviction band, and nudge
 * the gate thresholds toward better calibration. Idempotent + conservative.
 */
export async function selfTune(): Promise<TuneResult> {
  const cfg = getConfig();
  const noop = (reason: string, sampleSize = 0, winRate = 0): TuneResult => ({
    tuned: false, reason, before: {}, after: {}, sampleSize, winRate,
  });

  // Only tune when autonomous — in manual mode the operator owns the thresholds.
  if (!isRunning() || getMode() !== 'auto') return noop('brain not in auto mode');

  // Pull the most recent 40 graded outcomes. 24h signal expiry × 11 assets →
  // up to ~11 grades/day, so 40 covers ~4 days of feedback.
  const recent = await db.signalOutcome.findMany({
    where: { grade: { not: null } },
    orderBy: { gradedAt: 'desc' },
    take: 40,
    include: { signal: { select: { conviction: true, layersSummary: true } } },
  });
  if (recent.length < 12) return noop('insufficient graded sample', recent.length, 0);

  const wins = recent.filter((r) => r.grade === 'correct').length;
  const winRate = wins / recent.length;
  const before = { unanimousConviction: cfg.unanimousConviction, minNoteworthiness: cfg.minNoteworthiness, highNoteworthiness: cfg.highNoteworthiness };

  // Split into conviction bands to see WHERE the brain is right/wrong.
  // High-conviction = the signals we trusted most. Low = the ones we doubted.
  const high = recent.filter((r) => (r.signal?.conviction ?? 0) >= 60);
  const low = recent.filter((r) => (r.signal?.conviction ?? 0) < 40);
  const highWinRate = high.length > 0 ? high.filter((r) => r.grade === 'correct').length / high.length : winRate;
  const lowWinRate = low.length > 0 ? low.filter((r) => r.grade === 'correct').length / low.length : winRate;

  const patch: Partial<BrainConfig> = {};
  const reasons: string[] = [];

  // If our HIGH-conviction calls are losing (<40% win rate), we're too eager —
  // raise the unanimous-skip bar so we demand stronger agreement before
  // trusting the deterministic consensus, and require higher noteworthiness to
  // even call the LLM. (We over-trusted; tighten.)
  if (high.length >= 6 && highWinRate < 0.4) {
    patch.unanimousConviction = clamp(cfg.unanimousConviction + MAX_STEP, BOUNDS.unanimousConviction, MAX_STEP, cfg.unanimousConviction);
    reasons.push(`high-conviction win rate ${(highWinRate * 100).toFixed(0)}% < 40% → raised unanimous bar`);
  }
  // If our HIGH-conviction calls are crushing it (>70%), we can afford to be
  // less restrictive — lower the bar so more signals get through.
  else if (high.length >= 6 && highWinRate > 0.7) {
    patch.unanimousConviction = clamp(cfg.unanimousConviction - 1, BOUNDS.unanimousConviction, -1, cfg.unanimousConviction);
    reasons.push(`high-conviction win rate ${(highWinRate * 100).toFixed(0)}% > 70% → eased unanimous bar`);
  }

  // If LOW-conviction calls are mostly wrong, they're noise — raise the min
  // noteworthiness so the brain spends fewer LLM calls on dead markets.
  if (low.length >= 6 && lowWinRate < 0.35) {
    patch.minNoteworthiness = clamp(cfg.minNoteworthiness + MAX_STEP, BOUNDS.minNoteworthiness, MAX_STEP, cfg.minNoteworthiness);
    reasons.push(`low-conviction win rate ${(lowWinRate * 100).toFixed(0)}% < 35% → raised min noteworthiness`);
  }
  // If LOW-conviction calls are surprisingly right, the bar is too high — lower it.
  else if (low.length >= 6 && lowWinRate > 0.6) {
    patch.minNoteworthiness = clamp(cfg.minNoteworthiness - 1, BOUNDS.minNoteworthiness, -1, cfg.minNoteworthiness);
    reasons.push(`low-conviction win rate ${(lowWinRate * 100).toFixed(0)}% > 60% → eased min noteworthiness`);
  }

  if (Object.keys(patch).length === 0) {
    return noop(`calibrated (win ${(winRate * 100).toFixed(0)}%, high ${(highWinRate * 100).toFixed(0)}%, low ${(lowWinRate * 100).toFixed(0)}%) — no nudge`, recent.length, winRate);
  }

  await setConfig(patch);
  recordAction({
    symbol: 'SELF-TUNE', action: 'self-tune', tier: 0,
    reason: reasons.join('; '),
    conviction: Math.round(winRate * 100),
  });

  return { tuned: true, reason: reasons.join('; '), before, after: patch, sampleSize: recent.length, winRate };
}
