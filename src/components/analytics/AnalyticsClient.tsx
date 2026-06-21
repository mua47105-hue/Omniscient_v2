'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Bot, Trophy, TrendingUp, TrendingDown, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shape (matches /api/analytics/models)
// ---------------------------------------------------------------------------

interface ModelStat {
  model: string;
  totalGraded: number;
  correct: number;
  partial: number;
  wrong: number;
  winRate: number; // %
  totalPnl: number;
  avgPnlPerSignal: number;
}

interface Overall {
  totalGraded: number;
  overallAccuracy: number;
  totalPnl: number;
  avgPnlPerSignal: number;
  bestModel: string | null;
  worstModel: string | null;
}

interface AnalyticsResponse {
  success?: boolean;
  data?: {
    models: ModelStat[];
    overall: Overall;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtPnl(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(2)}%`;
}

function winRateColor(v: number): string {
  if (v >= 60) return 'oklch(0.72 0.18 160)';
  if (v >= 50) return 'oklch(0.75 0.18 75)';
  if (v >= 40) return 'oklch(0.70 0.18 50)';
  return 'oklch(0.65 0.22 25)';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalyticsClient(): React.ReactElement {
  const q = useQuery<AnalyticsResponse>({
    queryKey: ['analytics-models'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/models');
      if (!res.ok) throw new Error('analytics fetch failed');
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const data = q.data?.data;
  const models = data?.models ?? [];
  const overall = data?.overall;

  // Calibration buckets — distribute the models into win-rate bins
  const calibration = React.useMemo(() => {
    const bins = [
      { range: '0–20%', min: 0, max: 20, count: 0 },
      { range: '20–40%', min: 20, max: 40, count: 0 },
      { range: '40–60%', min: 40, max: 60, count: 0 },
      { range: '60–80%', min: 60, max: 80, count: 0 },
      { range: '80–100%', min: 80, max: 100.01, count: 0 },
    ];
    for (const m of models) {
      const b = bins.find((b) => m.winRate >= b.min && m.winRate < b.max);
      if (b) b.count++;
    }
    return bins;
  }, [models]);

  // P&L distribution — bucket avg P&L per signal
  const pnlDistribution = React.useMemo(() => {
    const sorted = [...models].sort((a, b) => a.avgPnlPerSignal - b.avgPnlPerSignal);
    return sorted.map((m) => ({
      model: m.model,
      pnl: m.avgPnlPerSignal,
    }));
  }, [models]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Model Analytics</h1>
        <p className="text-xs text-muted-foreground">
          Per-model win rates, calibration, and P&amp;L distribution. Aggregated from graded
          SignalOutcome records.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Total Graded"
          value={overall?.totalGraded != null ? String(overall.totalGraded) : '—'}
          icon={<Target className="h-4 w-4 text-sky-300" />}
          accent="sky"
        />
        <SummaryCard
          label="Overall Accuracy"
          value={overall ? fmtPct(overall.overallAccuracy) : '—'}
          icon={<TrendingUp className="h-4 w-4 text-emerald-300" />}
          accent="emerald"
        />
        <SummaryCard
          label="Total P&L"
          value={overall ? fmtPnl(overall.totalPnl) : '—'}
          icon={(overall?.totalPnl ?? 0) >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-300" /> : <TrendingDown className="h-4 w-4 text-rose-300" />}
          accent={(overall?.totalPnl ?? 0) >= 0 ? 'emerald' : 'rose'}
        />
        <SummaryCard
          label="Avg P&L / Signal"
          value={overall ? fmtPnl(overall.avgPnlPerSignal) : '—'}
          icon={<Bot className="h-4 w-4 text-amber-300" />}
          accent="amber"
        />
      </div>

      {q.isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Loading analytics…
          </CardContent>
        </Card>
      ) : models.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              No graded signal outcomes yet. The brain&apos;s self-grading loop runs every scheduler
              tick — come back later.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Best / worst banner */}
          <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-950/20 to-card">
            <CardContent className="grid grid-cols-2 gap-4 p-4">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-amber-300" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Best Model
                  </div>
                  <div className="font-mono text-sm text-emerald-300">
                    {overall?.bestModel ?? '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-rose-300" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Worst Model
                  </div>
                  <div className="font-mono text-sm text-rose-300">
                    {overall?.worstModel ?? '—'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Win-rate bar chart */}
          <Card>
            <CardHeader>
              <CardTitle>Win Rate by Model</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={models} margin={{ top: 10, right: 10, bottom: 30, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.014 264 / 0.4)" />
                    <XAxis
                      dataKey="model"
                      tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                      stroke="oklch(0.30 0.014 264)"
                      angle={-25}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                      stroke="oklch(0.30 0.014 264)"
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'oklch(0.20 0.014 264)',
                        border: '1px solid oklch(0.30 0.014 264)',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [`${v.toFixed(1)}%`, 'Win rate']}
                    />
                    <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                      {models.map((m, i) => (
                        <Cell key={i} fill={winRateColor(m.winRate)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Calibration histogram */}
            <Card>
              <CardHeader>
                <CardTitle>Calibration Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={calibration} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.014 264 / 0.4)" />
                      <XAxis
                        dataKey="range"
                        tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                        stroke="oklch(0.30 0.014 264)"
                      />
                      <YAxis
                        tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                        stroke="oklch(0.30 0.014 264)"
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'oklch(0.20 0.014 264)',
                          border: '1px solid oklch(0.30 0.014 264)',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        formatter={(v: number) => [v, 'Models']}
                      />
                      <Bar dataKey="count" fill="oklch(0.65 0.18 256)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Bucket = win-rate range. Counts the number of models in each bucket.
                </p>
              </CardContent>
            </Card>

            {/* P&L distribution */}
            <Card>
              <CardHeader>
                <CardTitle>P&amp;L Distribution (avg / signal)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pnlDistribution} margin={{ top: 10, right: 10, bottom: 30, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.014 264 / 0.4)" />
                      <XAxis
                        dataKey="model"
                        tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                        stroke="oklch(0.30 0.014 264)"
                        angle={-25}
                        textAnchor="end"
                        height={50}
                      />
                      <YAxis
                        tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                        stroke="oklch(0.30 0.014 264)"
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'oklch(0.20 0.014 264)',
                          border: '1px solid oklch(0.30 0.014 264)',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        formatter={(v: number) => [`${v.toFixed(2)}%`, 'Avg P&L']}
                      />
                      <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                        {pnlDistribution.map((m, i) => (
                          <Cell
                            key={i}
                            fill={m.pnl >= 0 ? 'oklch(0.72 0.18 160)' : 'oklch(0.65 0.22 25)'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Per-model table */}
          <Card>
            <CardHeader>
              <CardTitle>Per-Model Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Graded</TableHead>
                    <TableHead className="text-right">Correct</TableHead>
                    <TableHead className="text-right">Partial</TableHead>
                    <TableHead className="text-right">Wrong</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Total P&amp;L</TableHead>
                    <TableHead className="text-right">Avg / Signal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((m) => (
                    <TableRow key={m.model}>
                      <TableCell className="font-mono text-xs">{m.model}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{m.totalGraded}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-400">{m.correct}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-amber-400">{m.partial}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-rose-400">{m.wrong}</TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={m.winRate >= 55 ? 'success' : m.winRate >= 45 ? 'warning' : 'rose'}
                          className="font-mono text-[10px]"
                        >
                          {fmtPct(m.winRate)}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono text-xs',
                          m.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400',
                        )}
                      >
                        {fmtPnl(m.totalPnl)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono text-xs',
                          m.avgPnlPerSignal >= 0 ? 'text-emerald-400' : 'text-rose-400',
                        )}
                      >
                        {fmtPnl(m.avgPnlPerSignal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: 'sky' | 'emerald' | 'rose' | 'amber';
}): React.ReactElement {
  const borderMap: Record<typeof accent, string> = {
    sky: 'border-sky-500/30',
    emerald: 'border-emerald-500/30',
    rose: 'border-rose-500/30',
    amber: 'border-amber-500/30',
  };
  return (
    <Card className={cn('p-4', borderMap[accent])}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
    </Card>
  );
}
