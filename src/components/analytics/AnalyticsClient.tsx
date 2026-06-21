'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  BarChart3,
  Trophy,
  Target,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertCircle,
  Cpu,
  CheckCircle2,
  XCircle,
  CircleDot,
  Clock,
  Award,
  Flame,
  Activity,
  Sparkles,
  Loader2,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  LabelList,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { ApiResult, Direction } from '@/lib/types';
import { StatCard } from '@/components/dashboard/StatCard';

// ---------------------------------------------------------------------------
// Types — mirror what /api/analytics/models + /api/signals return
// ---------------------------------------------------------------------------
interface DirectionStats {
  count: number;
  correct: number;
  accuracy: number;
  pnlSum: number;
}

interface ModelAgg {
  model: string;
  totalSignals: number;
  correctCount: number;
  wrongCount: number;
  partialCount: number;
  accuracyPct: number;
  avgPnlPct: number;
  pnlSum: number;
  byDirection: {
    long: DirectionStats;
    short: DirectionStats;
    neutral: DirectionStats;
  };
}

interface OverallStats {
  totalGraded: number;
  overallAccuracy: number;
  totalPnl: number;
  avgPnlPerSignal: number;
  bestModel: string | null;
  worstModel: string | null;
}

interface AnalyticsData {
  models: ModelAgg[];
  overall: OverallStats;
}

interface GradeStats {
  totalGraded: number;
  totalOpen: number;
  totalExpired: number;
  lastGradedAt: string | null;
  recentGrades: {
    signalId: string;
    symbol: string;
    expected: string;
    actual: string | null;
    grade: string | null;
    pnlPct: number | null;
    gradedAt: string | null;
  }[];
}

interface SignalAsset {
  id: string;
  symbol: string;
  name: string;
}
interface SignalOutcome {
  id: string;
  horizon: string;
  expected: string;
  actual: string | null;
  pnlPct: number | null;
  grade: string | null;
  gradedAt: string | null;
}
interface ClosedSignal {
  id: string;
  asset: SignalAsset;
  timestamp: string;
  direction: Direction;
  conviction: number;
  timeframe: string;
  rationale: string;
  status: string;
  outcomes: SignalOutcome[];
}

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------
async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const j: ApiResult<T> = await r.json();
  if (!j.success) throw new Error(j.error || 'Request failed');
  return j.data as T;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
function accuracyTone(pct: number): 'emerald' | 'amber' | 'rose' {
  if (pct > 60) return 'emerald';
  if (pct >= 40) return 'amber';
  return 'rose';
}
function accuracyTextCls(pct: number): string {
  const t = accuracyTone(pct);
  return t === 'emerald'
    ? 'text-emerald-500'
    : t === 'amber'
      ? 'text-amber-500'
      : 'text-rose-500';
}
function accuracyBgCls(pct: number): string {
  const t = accuracyTone(pct);
  return t === 'emerald'
    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
    : t === 'amber'
      ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
      : 'bg-rose-500/10 text-rose-500 border-rose-500/30';
}
function accuracyBarColor(pct: number): string {
  const t = accuracyTone(pct);
  return t === 'emerald' ? '#10b981' : t === 'amber' ? '#f59e0b' : '#f43f5e';
}
function gradeBadgeCls(grade: string | null): string {
  if (grade === 'correct')
    return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
  if (grade === 'wrong')
    return 'bg-rose-500/10 text-rose-500 border-rose-500/30';
  if (grade === 'partial')
    return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
  return 'bg-muted text-muted-foreground border-border';
}
function gradeIcon(grade: string | null) {
  if (grade === 'correct') return <CheckCircle2 className="h-3 w-3" />;
  if (grade === 'wrong') return <XCircle className="h-3 w-3" />;
  if (grade === 'partial') return <CircleDot className="h-3 w-3" />;
  return null;
}
function pnlTextCls(p: number | null | undefined): string {
  if (p == null) return 'text-muted-foreground';
  if (p > 0) return 'text-emerald-500';
  if (p < 0) return 'text-rose-500';
  return 'text-muted-foreground';
}
function formatPct(p: number | null | undefined, digits = 2): string {
  if (p == null || Number.isNaN(p)) return '—';
  const sign = p > 0 ? '+' : '';
  return `${sign}${p.toFixed(digits)}%`;
}
function shortModel(m: string): string {
  // "Gemini/gemini-2.0-flash" → "gemini-2.0-flash" + provider chip
  if (m === 'unknown') return 'unknown';
  const slashIdx = m.indexOf('/');
  return slashIdx >= 0 ? m.slice(slashIdx + 1) : m;
}
function providerOf(m: string): string | null {
  if (m === 'unknown') return null;
  const slashIdx = m.indexOf('/');
  return slashIdx >= 0 ? m.slice(0, slashIdx) : null;
}

// ---------------------------------------------------------------------------
// Run grading button
// ---------------------------------------------------------------------------
function RunGradingButton({
  onRun,
  isGrading,
  expiredCount,
}: {
  onRun: () => void;
  isGrading: boolean;
  expiredCount: number;
}) {
  return (
    <Button
      onClick={onRun}
      disabled={isGrading}
      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
    >
      {isGrading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Zap className="h-4 w-4" />
      )}
      {isGrading ? 'Grading…' : 'Run Grading'}
      {!isGrading && expiredCount > 0 && (
        <Badge
          variant="secondary"
          className="ml-1 bg-emerald-500/20 text-emerald-100 border-emerald-400/30 px-1.5 py-0 tabular-nums"
        >
          {expiredCount}
        </Badge>
      )}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------
function StatStripSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ModelsTableSkeleton() {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-72" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Direction breakdown card
// ---------------------------------------------------------------------------
function DirectionCard({
  direction,
  count,
  accuracy,
  pnlSum,
}: {
  direction: 'long' | 'short' | 'neutral';
  count: number;
  accuracy: number;
  pnlSum: number;
}) {
  const meta = {
    long: {
      label: 'Long',
      icon: TrendingUp,
      ring: 'ring-emerald-500/30',
      bg: 'from-emerald-500/15 to-emerald-500/[0.03]',
      text: 'text-emerald-500',
    },
    short: {
      label: 'Short',
      icon: TrendingDown,
      ring: 'ring-rose-500/30',
      bg: 'from-rose-500/15 to-rose-500/[0.03]',
      text: 'text-rose-500',
    },
    neutral: {
      label: 'Neutral',
      icon: Minus,
      ring: 'ring-amber-500/30',
      bg: 'from-amber-500/15 to-amber-500/[0.03]',
      text: 'text-amber-500',
    },
  }[direction];
  const Icon = meta.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        className={cn(
          'relative overflow-hidden border-border/60 ring-1',
          meta.ring,
        )}
      >
        <div
          className={cn(
            'absolute inset-0 bg-gradient-to-br opacity-60 pointer-events-none',
            meta.bg,
          )}
        />
        <CardContent className="relative p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              {meta.label}
            </span>
            <Icon className={cn('h-4 w-4', meta.text)} />
          </div>
          <div className="space-y-0.5">
            <div className={cn('text-3xl font-bold tabular-nums', meta.text)}>
              {count > 0 ? `${accuracy.toFixed(0)}%` : '—'}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {count} signal{count === 1 ? '' : 's'} graded
            </div>
          </div>
          <Separator className="bg-border/40" />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Net PnL</span>
            <span className={cn('font-semibold tabular-nums', pnlTextCls(pnlSum))}>
              {formatPct(pnlSum)}
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Models table + bar chart
// ---------------------------------------------------------------------------
function ModelAccuracyPanel({ models }: { models: ModelAgg[] }) {
  const chartData = models
    .map((m) => ({
      model: shortModel(m.model),
      full: m.model,
      accuracy: Number(m.accuracyPct.toFixed(1)),
      signals: m.totalSignals,
      fill: accuracyBarColor(m.accuracyPct),
    }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 12); // cap chart to top 12 to stay readable

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-emerald-500" />
          Model Accuracy Leaderboard
        </CardTitle>
        <CardDescription className="text-xs">
          Per-LLM accuracy across all graded signals. Color: emerald &gt;60% · amber 40–60% · rose &lt;40%.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Bar chart */}
        {chartData.length > 0 && (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
                barCategoryGap={8}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickFormatter={(v) => `${v}%`}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="model"
                  width={140}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: string) => (v.length > 22 ? v.slice(0, 20) + '…' : v)}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, _name, item: any) => [
                    `${value.toFixed(1)}% (${item?.payload?.signals ?? 0} signals)`,
                    'Accuracy',
                  ]}
                />
                <Bar dataKey="accuracy" radius={[0, 4, 4, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                  <LabelList
                    dataKey="accuracy"
                    position="right"
                    formatter={(v: number) => `${v.toFixed(0)}%`}
                    style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-3">Model</TableHead>
                <TableHead className="text-right">Signals</TableHead>
                <TableHead className="text-right text-emerald-500">Correct</TableHead>
                <TableHead className="text-right text-rose-500">Wrong</TableHead>
                <TableHead className="text-right text-amber-500">Partial</TableHead>
                <TableHead className="text-right">Accuracy</TableHead>
                <TableHead className="text-right pr-3">Avg PnL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    No graded signals yet.
                  </TableCell>
                </TableRow>
              ) : (
                models.map((m) => {
                  const prov = providerOf(m.model);
                  return (
                    <TableRow key={m.model} className="text-xs">
                      <TableCell className="pl-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">
                            {shortModel(m.model)}
                          </span>
                          {prov && (
                            <Badge
                              variant="outline"
                              className="px-1.5 py-0 text-[10px] text-muted-foreground border-border/60"
                            >
                              {prov}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.totalSignals}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-500">
                        {m.correctCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-rose-500">
                        {m.wrongCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-500">
                        {m.partialCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                            accuracyBgCls(m.accuracyPct),
                          )}
                        >
                          {m.accuracyPct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right pr-3 tabular-nums font-medium',
                          pnlTextCls(m.avgPnlPct),
                        )}
                      >
                        {formatPct(m.avgPnlPct)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recent graded signals list
// ---------------------------------------------------------------------------
function RecentGradedSignals({ signals }: { signals: ClosedSignal[] }) {
  // Find the most recent graded outcome per signal
  const rows = signals
    .map((s) => {
      const o = [...(s.outcomes ?? [])].sort(
        (a, b) =>
          new Date(b.gradedAt ?? 0).getTime() - new Date(a.gradedAt ?? 0).getTime(),
      )[0];
      return { signal: s, outcome: o };
    })
    .filter((r) => r.outcome && r.outcome.grade);

  if (rows.length === 0) {
    return (
      <Card className="border-dashed border-border/60">
        <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-2">
          <Clock className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No recently graded signals.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-emerald-500" />
          Recently Graded Signals
        </CardTitle>
        <CardDescription className="text-xs">
          Last {rows.length} closed signals with their realized outcome.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="max-h-96 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
          {rows.map((r, i) => {
            const s = r.signal!;
            const o = r.outcome!;
            const dirIcon =
              s.direction === 'long' ? (
                <TrendingUp className="h-3 w-3" />
              ) : s.direction === 'short' ? (
                <TrendingDown className="h-3 w-3" />
              ) : (
                <Minus className="h-3 w-3" />
              );
            const dirCls =
              s.direction === 'long'
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                : s.direction === 'short'
                  ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                  : 'bg-amber-500/10 text-amber-500 border-amber-500/30';
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.25 }}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-[110px]">
                  <span className="font-semibold tracking-tight">
                    {s.asset.symbol.replace('USDT', '')}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'px-1.5 py-0 text-[10px] capitalize gap-0.5',
                      dirCls,
                    )}
                  >
                    {dirIcon}
                    {s.direction}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground hidden sm:block">
                  Conviction{' '}
                  <span className="text-foreground font-medium tabular-nums">
                    {s.conviction}
                  </span>
                </div>
                <div className="flex-1" />
                <Badge
                  variant="outline"
                  className={cn(
                    'px-1.5 py-0 text-[10px] capitalize gap-0.5',
                    gradeBadgeCls(o.grade),
                  )}
                >
                  {gradeIcon(o.grade)}
                  {o.grade}
                </Badge>
                <span
                  className={cn(
                    'text-xs font-semibold tabular-nums w-16 text-right',
                    pnlTextCls(o.pnlPct),
                  )}
                >
                  {formatPct(o.pnlPct)}
                </span>
                <span className="text-[11px] text-muted-foreground w-28 text-right hidden md:block">
                  {o.gradedAt
                    ? formatDistanceToNow(new Date(o.gradedAt), { addSuffix: true })
                    : '—'}
                </span>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyState({ onRun, isGrading }: { onRun: () => void; isGrading: boolean }) {
  return (
    <Card className="border-dashed border-border/60">
      <CardContent className="p-10 flex flex-col items-center justify-center text-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
          <Sparkles className="h-7 w-7" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <p className="font-semibold text-base">No graded signals yet</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Signals are graded automatically when they expire, or click{' '}
            <span className="text-foreground font-medium">“Run Grading”</span> to grade
            expired signals now. Graded outcomes power the per-model accuracy
            leaderboard on this page.
          </p>
        </div>
        <Button
          onClick={onRun}
          disabled={isGrading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          {isGrading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Zap className="h-4 w-4" />
          )}
          {isGrading ? 'Grading…' : 'Run Grading Now'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------
export function AnalyticsClient() {
  const qc = useQueryClient();
  const [isGrading, setIsGrading] = useState(false);

  const analyticsQ = useQuery<AnalyticsData>({
    queryKey: ['analytics-models'],
    queryFn: () => fetchJson<AnalyticsData>('/api/analytics/models'),
    refetchInterval: 60_000,
  });

  const gradeStatsQ = useQuery<GradeStats>({
    queryKey: ['grade-stats'],
    queryFn: () => fetchJson<GradeStats>('/api/signals/grade'),
    refetchInterval: 60_000,
  });

  const recentQ = useQuery<ClosedSignal[]>({
    queryKey: ['recent-graded-signals'],
    queryFn: () =>
      fetchJson<ClosedSignal[]>('/api/signals?status=closed&limit=20'),
    refetchInterval: 60_000,
  });

  async function handleRunGrading() {
    setIsGrading(true);
    try {
      const r = await fetch('/api/signals/grade', { method: 'POST' });
      const j: ApiResult<{ graded: number; skipped: number }> = await r.json();
      if (!j.success) throw new Error(j.error || 'Grading failed');
      const graded = j.data?.graded ?? 0;
      const skipped = j.data?.skipped ?? 0;
      if (graded > 0) {
        toast.success(`Graded ${graded} signal${graded === 1 ? '' : 's'}`, {
          description:
            skipped > 0 ? `${skipped} skipped (price unavailable).` : undefined,
        });
      } else {
        toast.info('No expired signals to grade', {
          description: 'All open signals are still within their horizon.',
        });
      }
      // Refresh all related queries so the dashboard updates immediately.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['analytics-models'] }),
        qc.invalidateQueries({ queryKey: ['grade-stats'] }),
        qc.invalidateQueries({ queryKey: ['recent-graded-signals'] }),
        qc.invalidateQueries({ queryKey: ['signals-feed'] }),
      ]);
    } catch (e) {
      toast.error('Grading failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setIsGrading(false);
    }
  }

  const overall = analyticsQ.data?.overall;
  const models = analyticsQ.data?.models ?? [];
  const recent = recentQ.data ?? [];
  const expiredCount = gradeStatsQ.data?.totalExpired ?? 0;
  const lastGradedAt = gradeStatsQ.data?.lastGradedAt;

  const directionAgg = (dir: 'long' | 'short' | 'neutral') => {
    let count = 0;
    let correct = 0;
    let pnlSum = 0;
    for (const m of models) {
      const d = m.byDirection[dir];
      count += d.count;
      correct += d.correct;
      pnlSum += d.pnlSum;
    }
    return {
      count,
      accuracy: count > 0 ? (correct / count) * 100 : 0,
      pnlSum,
    };
  };
  const longAgg = directionAgg('long');
  const shortAgg = directionAgg('short');
  const neutralAgg = directionAgg('neutral');

  const noGraded =
    !analyticsQ.isLoading &&
    !analyticsQ.error &&
    (overall?.totalGraded ?? 0) === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2">
            Model Accuracy Analytics
            <BarChart3 className="h-6 w-6 text-emerald-500" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            Self-learning performance review · per-LLM accuracy leaderboard
            {lastGradedAt && (
              <>
                <span className="opacity-40">·</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  last graded {formatDistanceToNow(new Date(lastGradedAt), { addSuffix: true })}
                </span>
              </>
            )}
          </p>
        </div>
        <RunGradingButton
          onRun={handleRunGrading}
          isGrading={isGrading}
          expiredCount={expiredCount}
        />
      </div>

      {/* Overall stats strip */}
      {analyticsQ.isLoading ? (
        <StatStripSkeleton />
      ) : analyticsQ.error ? (
        <Card className="border-rose-500/30 bg-rose-500/[0.03]">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-500" />
            <div className="text-sm">
              <p className="font-semibold text-rose-500">Failed to load analytics</p>
              <p className="text-xs text-muted-foreground">
                {analyticsQ.error instanceof Error
                  ? analyticsQ.error.message
                  : 'Unknown error'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => analyticsQ.refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="grid gap-4 grid-cols-2 lg:grid-cols-4"
        >
          <StatCard
            title="Signals Graded"
            value={overall ? String(overall.totalGraded) : '—'}
            icon={<Target className="h-4 w-4" />}
            subtitle="closed & reviewed"
            accent="emerald"
          />
          <StatCard
            title="Overall Accuracy"
            value={overall ? `${overall.overallAccuracy.toFixed(1)}%` : '—'}
            icon={<Trophy className="h-4 w-4" />}
            subtitle="correct calls"
            accent={accuracyTone(overall?.overallAccuracy ?? 0)}
          />
          <StatCard
            title="Avg PnL / Signal"
            value={overall ? formatPct(overall.avgPnlPerSignal) : '—'}
            icon={
              (overall?.avgPnlPerSignal ?? 0) >= 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )
            }
            subtitle={`net ${formatPct(overall?.totalPnl ?? 0)}`}
            accent={
              (overall?.avgPnlPerSignal ?? 0) >= 0
                ? 'emerald'
                : 'rose'
            }
          />
          <StatCard
            title="Best Model"
            value={overall?.bestModel ? shortModel(overall.bestModel) : '—'}
            icon={<Award className="h-4 w-4" />}
            subtitle={
              overall?.bestModel ? providerOf(overall.bestModel) ?? 'top performer' : 'needs ≥1 graded signal'
            }
            accent="emerald"
          />
        </motion.div>
      )}

      {/* Body */}
      {noGraded ? (
        <EmptyState onRun={handleRunGrading} isGrading={isGrading} />
      ) : analyticsQ.isLoading ? (
        <>
          <StatStripSkeleton />
          <ModelsTableSkeleton />
        </>
      ) : analyticsQ.error ? null : (
        <>
          {/* Direction breakdown */}
          <div className="grid gap-4 md:grid-cols-3">
            <DirectionCard
              direction="long"
              count={longAgg.count}
              accuracy={longAgg.accuracy}
              pnlSum={longAgg.pnlSum}
            />
            <DirectionCard
              direction="short"
              count={shortAgg.count}
              accuracy={shortAgg.accuracy}
              pnlSum={shortAgg.pnlSum}
            />
            <DirectionCard
              direction="neutral"
              count={neutralAgg.count}
              accuracy={neutralAgg.accuracy}
              pnlSum={neutralAgg.pnlSum}
            />
          </div>

          {/* Model accuracy table + chart */}
          <ModelAccuracyPanel models={models} />

          {/* Recent graded signals */}
          {recentQ.isLoading ? (
            <Card className="border-border/60">
              <CardHeader>
                <Skeleton className="h-5 w-48" />
              </CardHeader>
              <CardContent className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : recentQ.error ? (
            <Card className="border-rose-500/30 bg-rose-500/[0.03]">
              <CardContent className="p-6 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-rose-500" />
                <div className="text-sm">
                  <p className="font-semibold text-rose-500">
                    Failed to load recent graded signals
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {recentQ.error instanceof Error
                      ? recentQ.error.message
                      : 'Unknown error'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <RecentGradedSignals signals={recent} />
          )}
        </>
      )}

      {/* Footer hint */}
      <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground pt-2 pb-6">
        <Flame className="h-3 w-3 text-emerald-500/70" />
        Analytics auto-refresh every 60s · grading runs automatically inside the scheduler tick
      </div>
    </div>
  );
}
