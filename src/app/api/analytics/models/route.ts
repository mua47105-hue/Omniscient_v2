/**
 * Analytics — model accuracy dashboard API.
 *
 * GET /api/analytics/models
 *
 * Aggregates SignalOutcome rows by the parent signal's modelsUsed field.
 * Returns per-model {totalGraded, correct, partial, wrong, winRate,
 * avgPnlPct, totalPnl} + an overall summary block with bestModel/worstModel.
 *
 * The "model" key is the first entry of the signal's modelsUsed JSON array
 * (which is ['llm'] for LLM-assisted signals and ['deterministic'] for
 * consensus-only signals). Manual signals (['manual']) are excluded.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ModelAgg {
  model: string;
  totalGraded: number;
  correct: number;
  partial: number;
  wrong: number;
  totalPnl: number;
  pnlSamples: number;
}

export async function GET() {
  try {
    const outcomes = await db.signalOutcome.findMany({
      where: { grade: { not: null }, gradedAt: { not: null } },
      include: { signal: { select: { modelsUsed: true } } },
      take: 2000,
    });

    const byModel = new Map<string, ModelAgg>();

    const getModel = (modelsUsed: string | null | undefined): string | null => {
      if (!modelsUsed) return null;
      try {
        const arr = JSON.parse(modelsUsed);
        if (Array.isArray(arr) && arr.length > 0) {
          const m = String(arr[0]);
          // Exclude manual signals from the accuracy stats.
          if (m === 'manual') return null;
          return m;
        }
      } catch {
        /* ignore parse errors */
      }
      return null;
    };

    for (const o of outcomes) {
      const model = getModel(o.signal?.modelsUsed);
      if (!model) continue;

      let agg = byModel.get(model);
      if (!agg) {
        agg = {
          model,
          totalGraded: 0,
          correct: 0,
          partial: 0,
          wrong: 0,
          totalPnl: 0,
          pnlSamples: 0,
        };
        byModel.set(model, agg);
      }
      agg.totalGraded++;
      if (o.grade === 'correct') agg.correct++;
      else if (o.grade === 'partial') agg.partial++;
      else if (o.grade === 'wrong') agg.wrong++;
      if (typeof o.pnlPct === 'number' && Number.isFinite(o.pnlPct)) {
        agg.totalPnl += o.pnlPct;
        agg.pnlSamples++;
      }
    }

    const models = Array.from(byModel.values()).map((a) => {
      const winRate =
        a.totalGraded > 0 ? (a.correct + 0.5 * a.partial) / a.totalGraded : 0;
      const avgPnl = a.pnlSamples > 0 ? a.totalPnl / a.pnlSamples : 0;
      return {
        model: a.model,
        totalGraded: a.totalGraded,
        correct: a.correct,
        partial: a.partial,
        wrong: a.wrong,
        winRate: Math.round(winRate * 1000) / 10, // %
        totalPnl: Math.round(a.totalPnl * 100) / 100,
        avgPnlPerSignal: Math.round(avgPnl * 100) / 100,
      };
    });

    // Overall summary.
    const totalGraded = models.reduce((s, m) => s + m.totalGraded, 0);
    const totalCorrect = models.reduce((s, m) => s + m.correct, 0);
    const totalPartial = models.reduce((s, m) => s + m.partial, 0);
    const totalPnl = models.reduce((s, m) => s + m.totalPnl, 0);
    const pnlSamples = Array.from(byModel.values()).reduce(
      (s, m) => s + m.pnlSamples,
      0,
    );
    const overallAccuracy =
      totalGraded > 0 ? ((totalCorrect + 0.5 * totalPartial) / totalGraded) * 100 : 0;
    const avgPnlPerSignal = pnlSamples > 0 ? totalPnl / pnlSamples : 0;

    const sortedByWinRate = [...models].sort((a, b) => b.winRate - a.winRate);
    const bestModel = sortedByWinRate[0]?.model ?? null;
    const worstModel = sortedByWinRate[sortedByWinRate.length - 1]?.model ?? null;

    return NextResponse.json({
      success: true,
      data: {
        models,
        overall: {
          totalGraded,
          overallAccuracy: Math.round(overallAccuracy * 10) / 10,
          totalPnl: Math.round(totalPnl * 100) / 100,
          avgPnlPerSignal: Math.round(avgPnlPerSignal * 100) / 100,
          bestModel,
          worstModel,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
