/**
 * Lazy Brain — self-tuning gate thresholds.
 *
 * Reads the most recent graded SignalOutcome rows (joined with their parent
 * Signal for conviction), splits them by conviction band, and nudges
 * `unanimousConviction` + `minNoteworthiness` toward better calibration.
 *
 * Conservative by design:
 *   - Auto-mode only (never tunes when the operator has set manual mode).
 *   - Needs ≥12 graded outcomes per band before nudging that band.
 *   - Max ±2 per run per field.
 *   - unanimousConviction bounded [55, 85].
 *   - minNoteworthiness bounded [20, 55].
 *
 * Every nudge is logged via `recordTuneEvent` so the /brain UI can render the
 * calibration history.
 */

import { db } from '@/lib/db';
import { getConfig, setConfig, recordTuneEvent, getMode } from './state';
import { clamp } from './config';

const RECENT_GRADES_LIMIT = 40;
const MIN_GRADES_PER_BAND = 12;
const MAX_NUDGE = 2;

const UC_LO = 55;
const UC_HI = 85;
const NW_LO = 20;
const NW_HI = 55;

// Win-rate thresholds (per band)
const HIGH_BAND_WINRATE_LOW = 0.6; // below this → over-confident → raise UC
const HIGH_BAND_WINRATE_HIGH = 0.8; // above this → well-calibrated → lower UC
const LOW_BAND_WINRATE_HIGH = 0.5; // above this → too pessimistic → lower NW
const LOW_BAND_WINRATE_LOW = 0.3; // below this → too noisy → raise NW

const HIGH_BAND_CONV = 60;
const LOW_BAND_CONV = 40;

interface GradedRow {
  conviction: number;
  grade: string | null;
}

export interface SelfTuneResult {
  ran: boolean;
  reason: string;
  highBand: { n: number; winRate: number };
  lowBand: { n: number; winRate: number };
  nudges: Array<{ field: string; from: number; to: number; reason: string }>;
}

/**
 * Run one self-tuning pass. Safe to call every tick — it short-circuits when
 * there isn't enough data or the brain is in manual mode.
 */
export async function selfTune(): Promise<SelfTuneResult> {
  const noop = (reason: string): SelfTuneResult => ({
    ran: false,
    reason,
    highBand: { n: 0, winRate: 0 },
    lowBand: { n: 0, winRate: 0 },
    nudges: [],
  });

  // Auto-mode only.
  if (getMode() !== 'auto') return noop('manual-mode');

  // Pull the 40 most-recent graded outcomes + parent signal conviction.
  let rows: GradedRow[] = [];
  try {
    rows = await db.signalOutcome.findMany({
      where: {
        grade: { not: null },
        gradedAt: { not: null },
      },
      orderBy: { gradedAt: 'desc' },
      take: RECENT_GRADES_LIMIT,
      select: {
        grade: true,
        signal: { select: { conviction: true } },
      },
    });
  } catch {
    return noop('db-unavailable');
  }

  // Normalise to {conviction, grade}
  const graded: GradedRow[] = rows.map((r: any) => ({
    conviction: r.signal?.conviction ?? 0,
    grade: r.grade,
  }));

  if (graded.length < MIN_GRADES_PER_BAND) {
    return noop(`insufficient-grades(${graded.length})`);
  }

  const high = graded.filter((g) => g.conviction >= HIGH_BAND_CONV);
  const low = graded.filter((g) => g.conviction < LOW_BAND_CONV);

  const cfg = getConfig();
  const nudges: SelfTuneResult['nudges'] = [];

  // --- High band → unanimousConviction -----------------------------------
  if (high.length >= MIN_GRADES_PER_BAND) {
    const wr = winRate(high);
    const from = cfg.unanimousConviction;
    let to = from;
    let reason = '';
    if (wr < HIGH_BAND_WINRATE_LOW) {
      to = clamp(from + MAX_NUDGE, UC_LO, UC_HI);
      reason = `high-band winRate ${(wr * 100).toFixed(1)}% < ${(HIGH_BAND_WINRATE_LOW * 100)}% — raise YAGNI bar`;
    } else if (wr > HIGH_BAND_WINRATE_HIGH) {
      to = clamp(from - MAX_NUDGE, UC_LO, UC_HI);
      reason = `high-band winRate ${(wr * 100).toFixed(1)}% > ${(HIGH_BAND_WINRATE_HIGH * 100)}% — lower YAGNI bar`;
    }
    if (to !== from) {
      setConfig({ unanimousConviction: to });
      recordTuneEvent({
        field: 'unanimousConviction',
        from,
        to,
        reason,
        winRate: wr,
        sampleSize: high.length,
      });
      nudges.push({ field: 'unanimousConviction', from, to, reason });
    }
  }

  // --- Low band → minNoteworthiness --------------------------------------
  if (low.length >= MIN_GRADES_PER_BAND) {
    const wr = winRate(low);
    const from = cfg.minNoteworthiness;
    let to = from;
    let reason = '';
    if (wr > LOW_BAND_WINRATE_HIGH) {
      to = clamp(from - MAX_NUDGE, NW_LO, NW_HI);
      reason = `low-band winRate ${(wr * 100).toFixed(1)}% > ${(LOW_BAND_WINRATE_HIGH * 100)}% — lower NW bar`;
    } else if (wr < LOW_BAND_WINRATE_LOW) {
      to = clamp(from + MAX_NUDGE, NW_LO, NW_HI);
      reason = `low-band winRate ${(wr * 100).toFixed(1)}% < ${(LOW_BAND_WINRATE_LOW * 100)}% — raise NW bar`;
    }
    if (to !== from) {
      setConfig({ minNoteworthiness: to });
      recordTuneEvent({
        field: 'minNoteworthiness',
        from,
        to,
        reason,
        winRate: wr,
        sampleSize: low.length,
      });
      nudges.push({ field: 'minNoteworthiness', from, to, reason });
    }
  }

  return {
    ran: nudges.length > 0,
    reason: nudges.length === 0 ? 'within-calibration' : 'nudged',
    highBand: {
      n: high.length,
      winRate: high.length > 0 ? winRate(high) : 0,
    },
    lowBand: {
      n: low.length,
      winRate: low.length > 0 ? winRate(low) : 0,
    },
    nudges,
  };
}

/**
 * Win rate where 'correct' = 1, 'partial' = 0.5, anything else = 0.
 */
function winRate(rows: GradedRow[]): number {
  if (rows.length === 0) return 0;
  let s = 0;
  for (const r of rows) {
    if (r.grade === 'correct') s += 1;
    else if (r.grade === 'partial') s += 0.5;
  }
  return s / rows.length;
}
