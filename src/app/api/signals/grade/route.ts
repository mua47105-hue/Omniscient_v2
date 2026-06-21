// Signal grading endpoint.
//
// POST  — runs the grading engine over all expired open signals, persisting
//         SignalOutcome rows + flipping Signal.status to 'closed'.
// GET   — returns grading stats (counts, last graded, recent outcomes) for
//         the analytics dashboard.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { gradeExpiredSignals } from '@/lib/analysis/grading';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
  try {
    const summary = await gradeExpiredSignals();
    return NextResponse.json<ApiResult<typeof summary>>({
      success: true,
      data: summary,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e?.message ?? 'Grading failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  const now = new Date();
  const [totalGraded, totalOpen, totalExpired, recentOutcomes] = await Promise.all([
    db.signalOutcome.count({ where: { grade: { not: null } } }),
    db.signal.count({ where: { status: 'open' } }),
    db.signal.count({ where: { status: 'open', expiresAt: { lt: now } } }),
    db.signalOutcome.findMany({
      where: { grade: { not: null }, gradedAt: { not: null } },
      orderBy: { gradedAt: 'desc' },
      take: 10,
      include: { signal: { include: { asset: { select: { symbol: true } } } } },
    }),
  ]);

  // lastGradedAt = gradedAt of most-recent outcome (or null)
  const lastGradedAt = recentOutcomes[0]?.gradedAt ?? null;

  const recent = recentOutcomes.map((o) => ({
    signalId: o.signalId,
    symbol: o.signal.asset.symbol,
    expected: o.expected,
    actual: o.actual,
    grade: o.grade,
    pnlPct: o.pnlPct,
    gradedAt: o.gradedAt,
  }));

  const data = { totalGraded, totalOpen, totalExpired, lastGradedAt, recentGrades: recent };
  return NextResponse.json<ApiResult<typeof data>>({ success: true, data });
}
