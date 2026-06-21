'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  BrainCircuit,
  Pause,
  Play,
  RotateCcw,
  Zap,
  DatabaseZap,
  Eye,
  Ban,
  Gauge,
  Activity,
  Sparkles,
  History,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ThinkingIndicator } from './ThinkingIndicator';
import { TriggerBreakdown, type TriggerSegment } from './TriggerBreakdown';
import { Sparkline } from './Sparkline';
import { SavedAreaChart } from './SavedAreaChart';
import { EdgeSourcesCard } from './EdgeSourcesCard';
import { FreeSignalsCard } from './FreeSignalsCard';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types — mirror of the brain state.ts snapshot
// ---------------------------------------------------------------------------

interface BrainAction {
  ts: number;
  symbol: string;
  action: 'skip' | 'cache' | 'analyze' | 'alert' | 'trigger' | 'tune' | 'grade';
  reason: string;
  tier?: number;
  tokens?: number;
  source?: 'manual' | 'news' | 'cross-asset' | 'scheduler';
}

interface AssetWatch {
  symbol: string;
  lastAnalyzedAt: number;
  lastVerdict?: string;
  lastNoteworthiness: number;
  regime: 'trending' | 'ranging' | 'volatile';
  action: 'skip' | 'cache' | 'analyze';
  updatedAt: number;
  lastDataSig?: string;
}

interface TuneEvent {
  ts: number;
  field: string;
  from: number;
  to: number;
  reason: string;
  winRate: number;
  sampleSize: number;
}

interface BrainConfig {
  minNoteworthiness: number;
  highNoteworthiness: number;
  unanimousConviction: number;
  unanimousAgreement: number;
  cacheTtlMs: number;
  minReanalyzeMs: number;
  budgetCap: number;
  budgetWindowMs: number;
}

interface BrainSnapshot {
  running: boolean;
  mode: 'auto' | 'manual';
  config: BrainConfig;
  hydrated: boolean;
  budgetUsed: number;
  budgetWindowStart: number;
  budgetCap: number;
  budgetRemaining: number;
  budgetExhausted: boolean;
  llmCooldownUntil: number;
  llmInCooldown: boolean;
  llmConsecutiveFailures: number;
  thinking: boolean;
  tickStartTs: number;
  lastTickDurationMs: number;
  stats: {
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
  };
  watch: AssetWatch[];
  recentActions: BrainAction[];
  statsSamples: Array<{ ts: number; tokensUsed: number; tokensSaved: number; llmCalls: number; skips: number }>;
  tuneEvents: TuneEvent[];
  forceRunQueue: Array<[string, 'manual' | 'news' | 'cross-asset' | 'scheduler']>;
}

interface AnalyticsModelsResponse {
  models?: Array<{ model?: string; winRate?: number; totalGraded?: number }>;
  overall?: { overallAccuracy?: number; totalGraded?: number; bestModel?: string | null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function ago(ts: number | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function humanizeReason(reason: string): string {
  if (!reason) return '—';
  return reason
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function actionColor(action: AssetWatch['action']): string {
  switch (action) {
    case 'analyze':
      return 'text-sky-300 bg-sky-500/15';
    case 'cache':
      return 'text-violet-300 bg-violet-500/15';
    case 'skip':
      return 'text-muted-foreground bg-muted/40';
  }
  return 'text-muted-foreground bg-muted/40';
}

function tierLabel(tier?: number): string {
  if (tier === 1) return 'T1 · triage';
  if (tier === 2) return 'T2 · deep';
  return '—';
}

function actionIcon(action: AssetWatch['action']): React.ReactNode {
  switch (action) {
    case 'analyze':
      return <Zap className="h-3 w-3 text-sky-400" />;
    case 'cache':
      return <DatabaseZap className="h-3 w-3 text-violet-300" />;
    case 'skip':
      return <Eye className="h-3 w-3 text-muted-foreground" />;
  }
  return <Eye className="h-3 w-3 text-muted-foreground" />;
}

function regimeBadge(regime: AssetWatch['regime']): React.ReactNode {
  const map: Record<AssetWatch['regime'], { variant: 'success' | 'warning' | 'destructive'; label: string }> = {
    trending: { variant: 'success', label: 'trend' },
    ranging: { variant: 'warning', label: 'range' },
    volatile: { variant: 'destructive', label: 'vol' },
  };
  const m = map[regime];
  return <Badge variant={m.variant} className="text-[9px]">{m.label}</Badge>;
}

// ---------------------------------------------------------------------------
// CfgSlider — small reusable control
// ---------------------------------------------------------------------------

interface CfgSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  description?: string;
  onChange: (v: number) => void;
}

function CfgSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  description,
  onChange,
}: CfgSliderProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span className="font-mono text-[11px] text-emerald-300">
          {value.toLocaleString()}
          {unit ?? ''}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
      {description ? (
        <p className="text-[10px] text-muted-foreground/70">{description}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BrainPanel — the centerpiece
// ---------------------------------------------------------------------------

export function BrainPanel(): React.ReactElement {
  const qc = useQueryClient();

  const brainQ = useQuery<BrainSnapshot>({
    queryKey: ['brain'],
    queryFn: async () => {
      const res = await fetch('/api/brain');
      if (!res.ok) throw new Error('brain fetch failed');
      const json: { success?: boolean; data?: BrainSnapshot } = await res.json();
      if (!json.data) throw new Error('brain: missing data');
      return json.data;
    },
    refetchInterval: 4000,
    staleTime: 3000,
  });

  const analyticsQ = useQuery<AnalyticsModelsResponse>({
    queryKey: ['analytics-models'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/models');
      if (!res.ok) throw new Error('analytics fetch failed');
      const json: { success?: boolean; data?: AnalyticsModelsResponse } = await res.json();
      return json.data ?? {};
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const controlMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('brain control failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brain'] });
    },
  });

  const b = brainQ.data;
  const samples = b?.statsSamples ?? [];
  const stats = b?.stats;
  const watch = b?.watch ?? [];
  const actions = b?.recentActions ?? [];
  const tuneEvents = b?.tuneEvents ?? [];
  const config = b?.config;

  const tokensUsed = stats?.tokensUsed ?? 0;
  const tokensSaved = stats?.tokensSaved ?? 0;
  const gross = tokensUsed + tokensSaved;
  const savedPct = gross > 0 ? (tokensSaved / gross) * 100 : 0;
  const triggersTotal =
    (stats?.triggersNews ?? 0) +
    (stats?.triggersCrossAsset ?? 0) +
    (stats?.triggersManual ?? 0);

  const winRate = analyticsQ.data?.overall?.overallAccuracy ?? 0;

  // The brain API does not expose a single forceRunAll action — we iterate
  // the current watch list and queue each symbol as a manual force-run.
  const forceRunAll = React.useCallback(() => {
    if (!watch.length) return;
    for (const w of watch) {
      controlMut.mutate({ action: 'forceRun', symbol: w.symbol });
    }
  }, [watch, controlMut]);

  const isRunning = !!b?.running;
  const inCooldown = !!b?.llmInCooldown;
  const isManual = b?.mode === 'manual';

  const triggerSegments: TriggerSegment[] = [
    { key: 'news', label: 'News', count: stats?.triggersNews ?? 0, color: '' },
    { key: 'cross-asset', label: 'Cross-asset', count: stats?.triggersCrossAsset ?? 0, color: '' },
    { key: 'manual', label: 'Manual', count: stats?.triggersManual ?? 0, color: '' },
  ];

  const budgetPct = b && b.budgetCap > 0 ? (b.budgetUsed / b.budgetCap) * 100 : 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* ---------- Header ---------- */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-violet-950/40 via-card to-card p-5">
        <div
          className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-violet-500/20 blur-3xl ambient-glow"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/15">
              <BrainCircuit className="h-5 w-5 text-violet-300" />
              <span
                className={cn(
                  'absolute -right-0.5 -top-0.5 flex h-3 w-3',
                )}
              >
                <span
                  className={cn(
                    'absolute inline-flex h-full w-full animate-ping rounded-full opacity-70',
                    !isRunning ? 'bg-rose-500' : inCooldown ? 'bg-amber-400' : 'bg-emerald-400',
                  )}
                />
                <span
                  className={cn(
                    'relative inline-flex h-3 w-3 rounded-full',
                    !isRunning ? 'bg-rose-500' : inCooldown ? 'bg-amber-400' : 'bg-emerald-400',
                  )}
                />
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-gradient bg-gradient-to-r from-violet-300 via-fuchsia-300 to-emerald-300 text-2xl font-bold tracking-tight">
                The Lazy Brain
              </h1>
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{
                    boxShadow: isRunning
                      ? [
                          '0 0 0 0 oklch(0.72 0.18 160 / 0.6)',
                          '0 0 0 6px oklch(0.72 0.18 160 / 0)',
                        ]
                      : '0 0 0 0 oklch(0.65 0.22 25 / 0.6)',
                  }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                    !isRunning
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                      : inCooldown
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      !isRunning ? 'bg-rose-400' : inCooldown ? 'bg-amber-400' : 'bg-emerald-400',
                    )}
                  />
                  {isRunning ? (inCooldown ? 'Cooldown' : 'Autonomous') : 'Paused'}
                </motion.div>
                <Badge variant={isManual ? 'warning' : 'info'} className="text-[10px]">
                  {isManual ? 'manual' : 'auto'}
                </Badge>
                <ThinkingIndicator />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- LLM cooldown banner ---------- */}
      {inCooldown ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          <Ban className="h-3.5 w-3.5" />
          <span>
            LLM circuit-breaker tripped — cooldown until{' '}
            <span className="font-mono">
              {new Date(b?.llmCooldownUntil ?? 0).toLocaleTimeString()}
            </span>{' '}
            ({b?.llmConsecutiveFailures ?? 0} consecutive failures). Subsequent analyses fall back to deterministic consensus.
          </span>
        </div>
      ) : null}

      {/* ---------- Controls card ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-violet-300" />
            Brain Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button
            variant={isRunning ? 'destructive' : 'default'}
            size="sm"
            onClick={() => controlMut.mutate({ action: isRunning ? 'pause' : 'resume' })}
            disabled={controlMut.isPending}
          >
            {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {isRunning ? 'Pause' : 'Resume'}
          </Button>
          <div className="flex items-center gap-2">
            <Switch
              checked={isManual}
              onCheckedChange={(checked) =>
                controlMut.mutate({ action: 'setMode', mode: checked ? 'manual' : 'auto' })
              }
            />
            <span className="text-xs text-muted-foreground">Manual mode</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => controlMut.mutate({ action: 'resetBudget' })}
            disabled={controlMut.isPending}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Budget
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={forceRunAll}
            disabled={controlMut.isPending || !watch.length}
          >
            <Zap className="h-3.5 w-3.5" />
            Force-Run All
          </Button>
          <Separator orientation="vertical" className="hidden h-6 md:block" />
          <div className="text-[11px] text-muted-foreground">
            Last tick:{' '}
            <span className="font-mono text-foreground">
              {b?.tickStartTs ? ago(b.tickStartTs - (b.lastTickDurationMs ?? 0)) : 'never'}
            </span>
            {b?.lastTickDurationMs ? (
              <span className="ml-2 text-muted-foreground/70">
                · {b.lastTickDurationMs}ms
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ---------- Scoreboard ---------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <ScoreTile
          label="Tokens Used"
          value={fmt(tokensUsed)}
          icon={<Activity className="h-3.5 w-3.5 text-amber-400" />}
          accent="amber"
        />
        <ScoreTile
          label="Tokens Saved"
          value={fmt(tokensSaved)}
          sub={`${savedPct.toFixed(0)}% of gross`}
          icon={<Sparkles className="h-3.5 w-3.5 text-emerald-400" />}
          accent="emerald"
        />
        <ScoreTile
          label="Cache Hits"
          value={fmt(stats?.cacheHits ?? 0)}
          icon={<DatabaseZap className="h-3.5 w-3.5 text-violet-300" />}
          accent="violet"
        />
        <ScoreTile
          label="Skips"
          value={fmt(stats?.budgetSkips ?? 0)}
          icon={<Eye className="h-3.5 w-3.5 text-amber-400" />}
          accent="amber"
        />
        <ScoreTile
          label="Win Rate"
          value={winRate > 0 ? `${winRate.toFixed(1)}%` : '—'}
          icon={<Gauge className="h-3.5 w-3.5" />}
          accent={winRate >= 55 ? 'emerald' : winRate > 0 ? 'rose' : 'muted'}
        />
        <ScoreTile
          label="Triggers Fired"
          value={fmt(triggersTotal)}
          sub={`news ${stats?.triggersNews ?? 0} · xa ${stats?.triggersCrossAsset ?? 0} · man ${stats?.triggersManual ?? 0}`}
          icon={<Zap className="h-3.5 w-3.5 text-fuchsia-300" />}
          accent="fuchsia"
        />
      </div>

      {/* ---------- Trigger breakdown + Token economy + Cumulative saved ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Trigger Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <TriggerBreakdown segments={triggerSegments} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Token Economy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Budget used</span>
                <span className="font-mono text-foreground">
                  {fmt(b?.budgetUsed ?? 0)} / {fmt(b?.budgetCap ?? 0)}
                </span>
              </div>
              <Progress
                value={budgetPct}
                indicatorClassName={budgetPct > 85 ? 'bg-rose-500' : 'bg-amber-400'}
              />
            </div>
            <div className="flex items-center justify-center py-1">
              <Sparkline samples={samples} width={220} height={44} />
            </div>
            <div className="flex justify-center gap-4 text-[10px]">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-1.5 w-3 rounded bg-amber-400" />
                used
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-1.5 w-3 rounded bg-emerald-400" />
                saved
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cumulative Tokens Saved</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-emerald-300">{fmt(tokensSaved)}</span>
              <span className="text-xs text-muted-foreground">
                {savedPct.toFixed(0)}% of gross
              </span>
            </div>
            <div className="flex items-center justify-center">
              <SavedAreaChart samples={samples} width={300} height={70} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---------- Watch list + Action feed ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Watch List</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-3">
              <div className="space-y-1">
                {watch.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No assets in watch list — run a scan to populate.
                  </p>
                ) : (
                  watch.map((w) => {
                    const lastVerdict = w.lastVerdict ?? 'neutral';
                    const dir = lastVerdict.toLowerCase();
                    const conviction = Math.round(w.lastNoteworthiness);
                    return (
                      <div
                        key={w.symbol}
                        className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-xs transition-colors hover:border-border hover:bg-muted/30"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'flex h-6 w-6 items-center justify-center rounded',
                              actionColor(w.action),
                            )}
                          >
                            {actionIcon(w.action)}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            {w.lastNoteworthiness.toFixed(0)}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{w.symbol}</span>
                            {regimeBadge(w.regime)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {humanizeReason(w.action)} · {tierLabel(w.action === 'analyze' ? 1 : undefined)} · {ago(w.updatedAt)}
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={
                                dir === 'long'
                                  ? 'success'
                                  : dir === 'short'
                                    ? 'rose'
                                    : 'muted'
                              }
                              className="text-[9px]"
                            >
                              {dir}
                            </Badge>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {conviction}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => controlMut.mutate({ action: 'forceRun', symbol: w.symbol })}
                          disabled={controlMut.isPending}
                          title="Force-run analysis"
                        >
                          <Zap className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Action Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-3">
              <div className="space-y-1.5">
                {actions.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No recent actions. The brain is idle.
                  </p>
                ) : (
                  actions.slice().reverse().map((a, i) => {
                    const isAutonomy =
                      a.source === 'cross-asset' ||
                      a.source === 'news' ||
                      a.action === 'tune' ||
                      a.action === 'trigger';
                    return (
                      <div
                        key={`${a.ts}-${i}`}
                        className={cn(
                          'rounded-md border px-2 py-1.5 text-[11px]',
                          isAutonomy
                            ? 'border-violet-500/30 bg-violet-500/5'
                            : 'border-border bg-muted/20',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">
                            {a.symbol}
                            {a.source ? (
                              <span className="ml-1 text-[9px] uppercase tracking-wider text-violet-300">
                                {a.source}
                              </span>
                            ) : null}
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {ago(a.ts)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          <span className="font-mono text-foreground">{a.action}</span>
                          {a.tier ? <span className="ml-1">· T{a.tier}</span> : null}
                          {a.tokens ? (
                            <span className="ml-1 text-amber-300">· {fmt(a.tokens)} tok</span>
                          ) : null}
                        </div>
                        {a.reason ? (
                          <div className="mt-0.5 text-[10px] text-muted-foreground/80">
                            {humanizeReason(a.reason)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* ---------- Gate Configuration + Self-Tune History ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-violet-300" />
              Gate Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {config ? (
              <>
                <CfgSlider
                  label="Min Noteworthiness"
                  value={config.minNoteworthiness}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => controlMut.mutate({ action: 'setConfig', config: { minNoteworthiness: v } })}
                />
                <CfgSlider
                  label="High Noteworthiness"
                  value={config.highNoteworthiness}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => controlMut.mutate({ action: 'setConfig', config: { highNoteworthiness: v } })}
                />
                <CfgSlider
                  label="Unanimous Conviction"
                  value={config.unanimousConviction}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => controlMut.mutate({ action: 'setConfig', config: { unanimousConviction: v } })}
                />
                <CfgSlider
                  label="Budget Cap"
                  value={config.budgetCap}
                  min={5000}
                  max={500000}
                  step={5000}
                  onChange={(v) => controlMut.mutate({ action: 'setConfig', config: { budgetCap: v } })}
                />
                <CfgSlider
                  label="Cache TTL"
                  value={Math.round(config.cacheTtlMs / 60000)}
                  min={1}
                  max={120}
                  step={1}
                  unit="min"
                  onChange={(v) => controlMut.mutate({ action: 'setConfig', config: { cacheTtlMs: v * 60000 } })}
                />
                <CfgSlider
                  label="Min Reanalyze Gap"
                  value={Math.round(config.minReanalyzeMs / 60000)}
                  min={1}
                  max={120}
                  step={1}
                  unit="min"
                  onChange={(v) => controlMut.mutate({ action: 'setConfig', config: { minReanalyzeMs: v * 60000 } })}
                />
              </>
            ) : (
              <p className="col-span-2 text-xs text-muted-foreground">Loading configuration…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-emerald-300" />
              Self-Tune History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[260px] pr-3">
              {tuneEvents.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
                  <History className="h-6 w-6 text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">
                    No self-tune events yet.
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    The brain nudges gate thresholds as signal grades accumulate.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {tuneEvents.slice().reverse().map((e, i) => (
                    <div
                      key={`${e.ts}-${i}`}
                      className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium text-foreground">{e.field}</span>
                        <span className="text-[9px] text-muted-foreground">{ago(e.ts)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px]">
                        <span className="text-rose-300">{e.from}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-emerald-300">{e.to}</span>
                        <span className="ml-auto text-muted-foreground">
                          WR {(e.winRate * 100).toFixed(0)}% · n={e.sampleSize}
                        </span>
                      </div>
                      {e.reason ? (
                        <div className="mt-0.5 text-[10px] text-muted-foreground/70">{e.reason}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* ---------- Free Signals + Edge Sources ---------- */}
      <FreeSignalsCard />
      <EdgeSourcesCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreTile — small reusable tile
// ---------------------------------------------------------------------------

function ScoreTile({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: 'amber' | 'emerald' | 'violet' | 'fuchsia' | 'rose' | 'muted';
}): React.ReactElement {
  const accentMap: Record<typeof accent, string> = {
    amber: 'border-amber-500/30 bg-amber-500/5',
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    violet: 'border-violet-500/30 bg-violet-500/5',
    fuchsia: 'border-fuchsia-500/30 bg-fuchsia-500/5',
    rose: 'border-rose-500/30 bg-rose-500/5',
    muted: 'border-border bg-muted/20',
  };
  return (
    <div className={cn('rounded-lg border p-3', accentMap[accent])}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-1 text-xl font-bold text-foreground">{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
