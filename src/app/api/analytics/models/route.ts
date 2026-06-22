// Model Accuracy Analytics — the centerpiece of the self-learning layer.
//
// Aggregates graded SignalOutcome rows per LLM model (parsed from
// Signal.modelsUsed JSON). Returns per-model accuracy, PnL, and direction
// breakdown, plus overall leaderboard stats (best/worst model).
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface DirectionStats {
  count: number;
  correct: number;
  accuracy: number; // 0..100
  pnlSum: number;
}

function newDirectionStats(): DirectionStats {
  return { count: 0, correct: 0, accuracy: 0, pnlSum: 0 };
}

interface ModelAgg {
  model: string;
  totalSignals: number;
  correctCount: number;
  wrongCount: number;
  partialCount: number;
  accuracyPct: number; // correct / total * 100
  avgPnlPct: number;
  pnlSum: number;
  byDirection: {
    long: DirectionStats;
    short: DirectionStats;
    neutral: DirectionStats;
  };
}

function newModelAgg(model: string): ModelAgg {
  return {
    model,
    totalSignals: 0,
    correctCount: 0,
    wrongCount: 0,
    partialCount: 0,
    accuracyPct: 0,
    avgPnlPct: 0,
    pnlSum: 0,
    byDirection: {
      long: newDirectionStats(),
      short: newDirectionStats(),
      neutral: newDirectionStats(),
    },
  };
}

function finalize(m: ModelAgg): ModelAgg {
  m.accuracyPct = m.totalSignals > 0 ? (m.correctCount / m.totalSignals) * 100 : 0;
  m.avgPnlPct = m.totalSignals > 0 ? m.pnlSum / m.totalSignals : 0;
  for (const dir of ['long', 'short', 'neutral'] as const) {
    const d = m.byDirection[dir];
    d.accuracy = d.count > 0 ? (d.correct / d.count) * 100 : 0;
  }
  return m;
}

export async function GET() {
  try {
    const outcomes = await db.signalOutcome.findMany({
      where: { grade: { not: null } },
      include: {
        signal: {
          select: { direction: true, modelsUsed: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500, // cap to prevent unbounded scan (per §5.2)
    });

    const byModel = new Map<string, ModelAgg>();

    let totalGraded = 0;
    let totalCorrect = 0;
    let totalPnl = 0;

    for (const o of outcomes) {
      totalGraded++;
      if (o.grade === 'correct') totalCorrect++;
      const pnl = o.pnlPct ?? 0;
      totalPnl += pnl;

      // Parse modelsUsed JSON string → string[]
      let models: string[] = [];
      try {
        const parsed = JSON.parse(o.signal.modelsUsed || '[]');
        if (Array.isArray(parsed)) {
          models = parsed.filter((m) => typeof m === 'string' && m.length > 0);
        }
      } catch {
        /* ignore parse errors */
      }
      // If a signal has no models attributed, still count it under "unknown"
      // so the leaderboard stays balanced.
      if (models.length === 0) models = ['unknown'];

      for (const modelKey of models) {
        let agg = byModel.get(modelKey);
        if (!agg) {
          agg = newModelAgg(modelKey);
          byModel.set(modelKey, agg);
        }
        agg.totalSignals++;
        if (o.grade === 'correct') agg.correctCount++;
        else if (o.grade === 'wrong') agg.wrongCount++;
        else if (o.grade === 'partial') agg.partialCount++;
        agg.pnlSum += pnl;

        const dir = (o.signal.direction as 'long' | 'short' | 'neutral') ?? 'neutral';
        if (!(dir in agg.byDirection)) continue;
        const ds = agg.byDirection[dir];
        ds.count++;
        ds.pnlSum += pnl;
        if (o.grade === 'correct') ds.correct++;
      }
    }

    const models = Array.from(byModel.values()).map(finalize).sort(
      (a, b) => b.totalSignals - a.totalSignals,
    );

    // Best/worst by accuracy (min 3 signals to qualify — noise dampener).
    const qualified = models.filter((m) => m.totalSignals >= 1);
    const ranked = [...qualified].sort((a, b) => b.accuracyPct - a.accuracyPct);
    const bestModel = ranked[0]?.model ?? null;
    const worstModel = ranked[ranked.length - 1]?.model ?? null;

    const overall = {
      totalGraded,
      overallAccuracy: totalGraded > 0 ? (totalCorrect / totalGraded) * 100 : 0,
      totalPnl,
      avgPnlPerSignal: totalGraded > 0 ? totalPnl / totalGraded : 0,
      bestModel,
      worstModel,
    };

    return NextResponse.json<ApiResult<{ models: ModelAgg[]; overall: typeof overall }>>(
      { success: true, data: { models, overall } },
    );
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e?.message ?? 'Analytics failed' },
      { status: 500 },
    );
  }
}
