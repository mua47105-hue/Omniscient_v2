'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Brain, Play, Pause, Zap, RefreshCw, Gauge, Database, TrendingDown, Coins,
  Activity, Crosshair, Clock, AlertTriangle, CheckCircle2, Radio, Sparkles, Target,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { FreeSignalsCard } from '@/components/brain/FreeSignalsCard';
import { Sparkline } from '@/components/brain/Sparkline';

// ---- Types mirroring src/lib/brain/state.ts ----
interface AssetWatch {
  symbol: string;
  lastPrice: number;
  lastAnalyzedAt: number;
  lastWatchedAt: number;
  lastVerdict?: { score: number; rationale: string; confidence: number; model: string; direction: string; conviction: number };
  lastNoteworthiness: number;
  lastRegime: 'trending' | 'ranging' | 'volatile';
  lastTier: number;
  lastAction: string;
  lastReason: string;
  updatedAt: number;
}
interface BrainStats {
  ticksTotal: number; llmCallsTotal: number; llmCallsSkipped: number; cacheHits: number;
  budgetSkips: number; tokensUsed: number; tokensSaved: number; alertsSent: number;
  lastTickAt: number | null; startedAt: number;
  triggersNews: number; triggersCrossAsset: number; triggersManual: number;
}
interface BrainConfig {
  minNoteworthiness: number; highNoteworthiness: number; unanimousConviction: number;
  unanimousAgreement: number; cacheTtlMs: number; minReanalyzeMs: number;
  budgetCap: number; budgetWindowMs: number;
}
interface BrainAction {
  ts: number; symbol: string; action: string; tier: number; reason: string;
  tokens?: number; conviction?: number; direction?: string;
}
interface BrainSnapshot {
  running: boolean;
  mode: 'auto' | 'manual';
  config: BrainConfig;
  budget: { cap: number; used: number; remaining: number; windowMs: number; windowStart: number };
  llm: { inCooldown: boolean; cooldownUntil: number; consecutiveFailures: number };
  stats: BrainStats;
  samples?: { ts: number; tokensUsed: number; tokensSaved: number }[];
  watch: AssetWatch[];
  recentActions: BrainAction[];
}

async function fetchBrain(): Promise<BrainSnapshot> {
  const r = await fetch('/api/brain', { cache: 'no-store' });
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'fetch failed');
  return j.data;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
function ago(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function regimeColor(r: string): string {
  return r === 'volatile' ? 'text-rose-400' : r === 'trending' ? 'text-emerald-400' : 'text-muted-foreground';
}
function actionColor(a: string): string {
  if (a === 'analyze') return 'text-sky-400';
  if (a === 'cache') return 'text-violet-400';
  if (a === 'skip' || a === 'paused') return 'text-muted-foreground';
  if (a === 'watch') return 'text-amber-400';
  return 'text-foreground';
}
function tierLabel(t: number): string {
  return t === 0 ? 'det' : t === 1 ? 'triage' : 'deep';
}
// Humanize internal reason codes → operator-friendly labels. The raw codes
// (llm-failed-fallback, calm-recently-analyzed, …) are useful for debugging
// but read as noise in the watch list. This maps them to clear English.
function humanizeReason(reason: string): string {
  const map: Record<string, string> = {
    'unanimous-deterministic': 'math agrees',
    'budget-exhausted': 'budget hit',
    'llm-cooldown': 'rate-limited',
    'llm-failed-fallback': 'rate-limited',
    'calm-recently-analyzed': 'calm',
    'data-unchanged': 'unchanged',
    'high-noteworthiness': 'hot',
    'noteworthy': 'active',
    'manual-force-run': 'manual',
    'brain-paused': 'paused',
    'no-llm': 'no llm',
  };
  return map[reason] ?? reason;
}

export function BrainPanel() {
  const qc = useQueryClient();
  const brain = useQuery({ queryKey: ['brain'], queryFn: fetchBrain, refetchInterval: 4000 });
  // Win-rate from the grading loop — powers the self-tuning feedback stat tile.
  // Slow refresh (60s) since grades only change when signals expire (24h).
  const winRateQ = useQuery({
    queryKey: ['brain-winrate'],
    queryFn: async () => {
      const r = await fetch('/api/analytics/models', { cache: 'no-store' });
      const j = await r.json();
      if (!j.success) return { totalGraded: 0, accuracy: 0 };
      return { totalGraded: j.data?.overall?.totalGraded ?? 0, accuracy: j.data?.overall?.overallAccuracy ?? 0 };
    },
    refetchInterval: 60000,
    retry: 1,
  });
  const [cfg, setCfg] = useState<Partial<BrainConfig> | null>(null);

  const snap = brain.data;
  const live = snap ? { ...snap.config, ...cfg } : snap?.config;

  const mutate = useMutation({
    mutationFn: async (body: any) => {
      const r = await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.success) throw new Error(j.error);
      return j.data as BrainSnapshot;
    },
    onSuccess: (data) => { qc.setQueryData(['brain'], data); setCfg(null); },
  });

  const running = snap?.running ?? false;
  const stats = snap?.stats;
  const budget = snap?.budget;
  const budgetPct = budget && budget.cap > 0 ? (budget.used / budget.cap) * 100 : 0;
  const savedPct = stats && stats.tokensUsed + stats.tokensSaved > 0
    ? (stats.tokensSaved / (stats.tokensUsed + stats.tokensSaved)) * 100 : 0;

  const commitCfg = (patch: Partial<BrainConfig>) => mutate.mutate({ action: 'setConfig', ...patch });

  return (
    <div className="space-y-6">
      {/* Header — elevated: gradient title with glow, animated status badge */}
      <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div aria-hidden className="absolute -left-2 -top-6 h-24 w-24 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/30 to-teal-500/10 ring-1 ring-inset ring-sky-500/25">
              <Brain className="h-5 w-5 text-sky-400" />
            </span>
            <span className="bg-gradient-to-r from-sky-300 via-sky-400 to-teal-300 bg-clip-text text-transparent">
              The Lazy Brain
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Autonomous orchestration · ponytail-token economy · manual override
          </p>
        </div>
        <div className="flex items-center gap-2">
          <motion.div
            animate={running ? { scale: [1, 1.04, 1] } : {}}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Badge variant={running ? 'default' : 'secondary'} className={cn('gap-1.5 px-2.5 py-1 text-xs font-semibold', running ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_12px_-2px_rgba(16,185,129,0.4)]' : 'bg-rose-500/15 text-rose-400 border-rose-500/30')}>
              <span className={cn('relative flex h-2 w-2', running && '')}>
                {running && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', running ? 'bg-emerald-400' : 'bg-rose-400')} />
              </span>
              {running ? 'AUTONOMOUS' : 'PAUSED'}
            </Badge>
          </motion.div>
          <Badge variant="outline" className="gap-1 capitalize px-2.5 py-1 text-xs">{snap?.mode ?? '—'} mode</Badge>
        </div>
      </div>

      {/* LLM circuit-breaker banner — shown when the global cooldown is active.
          Tells the operator WHY no LLM calls are happening (rate-limited) and
          when the brain will retry. */}
      {snap?.llm?.inCooldown && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-amber-300">LLM circuit-breaker active</span>
              <span className="text-xs text-amber-400/70 ml-2">
                Rate-limited {snap.llm.consecutiveFailures}× — using deterministic consensus. Retries in {Math.max(0, Math.ceil((snap.llm.cooldownUntil - Date.now()) / 1000))}s.
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Controls */}
      <Card className="border-border/60 ring-1 ring-inset ring-border/30">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          {running ? (
            <Button variant="destructive" size="sm" onClick={() => mutate.mutate({ action: 'pause' })} disabled={mutate.isPending}>
              <Pause className="h-4 w-4 mr-1.5" /> Pause Brain
            </Button>
          ) : (
            <Button size="sm" onClick={() => mutate.mutate({ action: 'resume' })} disabled={mutate.isPending} className="bg-emerald-600 hover:bg-emerald-700">
              <Play className="h-4 w-4 mr-1.5" /> Resume Brain
            </Button>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border/60 bg-muted/30">
            <Switch
              checked={snap?.mode === 'manual'}
              onCheckedChange={(v) => mutate.mutate({ action: 'setMode', mode: v ? 'manual' : 'auto' })}
              aria-label="Toggle manual mode"
            />
            <Label className="text-xs cursor-pointer">Manual mode {snap?.mode === 'manual' ? '(force-run only)' : '(auto-gated)'}</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => mutate.mutate({ action: 'resetBudget' })} disabled={mutate.isPending}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Reset Budget
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Force-run all currently watched symbols at once (manual sweep).
              snap?.watch.forEach((w) => mutate.mutate({ action: 'forceRun', symbol: w.symbol }));
            }}
            disabled={!snap?.watch.length || mutate.isPending}
          >
            <Crosshair className="h-4 w-4 mr-1.5" /> Force-Run All
          </Button>
          <div className="ml-auto text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> last tick {ago(stats?.lastTickAt ?? null)} · {stats?.ticksTotal ?? 0} total
          </div>
        </CardContent>
      </Card>

      {/* Token economy scoreboard */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <StatTile icon={<Coins className="h-4 w-4" />} label="Tokens Used" value={fmt(stats?.tokensUsed ?? 0)} accent="text-sky-400" sub={`${stats?.llmCallsTotal ?? 0} LLM calls`} />
        <StatTile icon={<TrendingDown className="h-4 w-4" />} label="Tokens Saved" value={fmt(stats?.tokensSaved ?? 0)} accent="text-emerald-400" sub={`${savedPct.toFixed(0)}% of gross`} />
        <StatTile icon={<Database className="h-4 w-4" />} label="Cache Hits" value={`${stats?.cacheHits ?? 0}`} accent="text-violet-400" sub="reused verdicts" />
        <StatTile icon={<Zap className="h-4 w-4" />} label="Skips" value={`${(stats?.llmCallsSkipped ?? 0) + (stats?.budgetSkips ?? 0)}`} accent="text-amber-400" sub="unanimous + budget" />
        <StatTile
          icon={<Target className="h-4 w-4" />}
          label="Win Rate"
          value={winRateQ.data?.totalGraded ? `${(winRateQ.data.accuracy * 100).toFixed(0)}%` : '—'}
          accent={winRateQ.data?.accuracy != null && winRateQ.data.accuracy >= 0.5 ? 'text-emerald-400' : 'text-rose-400'}
          sub={winRateQ.data?.totalGraded ? `${winRateQ.data.totalGraded} graded · self-tunes` : 'awaiting grades'}
        />
        {/* Trigger stats — autonomy volume. Sums news + cross-asset + manual
            triggers fired, with the breakdown in the subtext. */}
        <StatTile
          icon={<Sparkles className="h-4 w-4" />}
          label="Triggers Fired"
          value={`${(stats?.triggersNews ?? 0) + (stats?.triggersCrossAsset ?? 0) + (stats?.triggersManual ?? 0)}`}
          accent="text-fuchsia-400"
          sub={`${stats?.triggersNews ?? 0} news · ${stats?.triggersCrossAsset ?? 0} x-asset · ${stats?.triggersManual ?? 0} manual`}
        />
      </div>

      {/* Budget bar + token-economy timeline */}
      <Card className="border-border/60 ring-1 ring-inset ring-border/30">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Gauge className="h-4 w-4 text-sky-400" /> Token Economy <span className="text-[10px] font-normal text-muted-foreground ml-1">rolling {Math.round((snap?.config.budgetWindowMs ?? 0) / 60000)}min budget · cumulative savings</span></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[180px] space-y-1.5">
              <Progress value={budgetPct} className={cn('h-2.5', budgetPct > 90 ? '[&>div]:bg-rose-500' : budgetPct > 70 ? '[&>div]:bg-amber-500' : '[&>div]:bg-sky-500')} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{fmt(budget?.used ?? 0)} used</span>
                <span className={budgetPct > 90 ? 'text-rose-400 font-medium' : ''}>{fmt(budget?.remaining ?? 0)} remaining of {fmt(budget?.cap ?? 0)}</span>
              </div>
            </div>
            {/* Savings timeline sparkline — emerald area (saved) vs sky line (used).
                The gap between them IS the ponytail token-economy benefit, visible over time. */}
            <div className="flex flex-col items-end gap-0.5 text-emerald-400/80">
              <span className="text-[9px] uppercase tracking-wider opacity-60">used vs saved</span>
              <Sparkline samples={snap?.samples ?? []} width={220} height={44} />
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-amber-400" />used</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-emerald-400" />saved</span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            When the budget is exhausted the brain downshifts to deterministic-only mode (no LLM) until the window resets — the free-tier safety net. The gap between the two lines is real tokens not spent.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Watch list */}
        <Card className="lg:col-span-2 border-border/60 ring-1 ring-inset ring-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-sky-400" /> Asset Watch <span className="text-xs text-muted-foreground font-normal">({snap?.watch.length ?? 0})</span></CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[420px]">
              <div className="px-4 pb-4 space-y-1">
                {(snap?.watch ?? []).map((w) => (
                  <motion.div
                    key={w.symbol}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="group flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex flex-col items-center w-12 shrink-0">
                      <span className="text-[10px] text-muted-foreground">NOTE</span>
                      <span className={cn('text-sm font-bold tabular-nums', w.lastNoteworthiness >= 65 ? 'text-rose-400' : w.lastNoteworthiness >= 35 ? 'text-amber-400' : 'text-muted-foreground')}>{w.lastNoteworthiness}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{w.symbol.replace('USDT', '')}</span>
                        <Badge variant="outline" className={cn('text-[9px] capitalize', regimeColor(w.lastRegime))}>{w.lastRegime}</Badge>
                        <span className="text-xs text-muted-foreground tabular-nums">${w.lastPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span className={cn('font-medium', actionColor(w.lastAction))}>{w.lastAction}</span>
                        <span className="opacity-50">·</span>
                        <span className="font-mono text-[10px]">{tierLabel(w.lastTier)}</span>
                        <span className="opacity-50">·</span>
                        <span className="truncate">{humanizeReason(w.lastReason)}</span>
                      </div>
                    </div>
                    {w.lastVerdict && (
                      <div className="hidden sm:flex flex-col items-end w-20 shrink-0">
                        <span className={cn('text-sm font-bold tabular-nums', w.lastVerdict.direction === 'long' ? 'text-emerald-400' : w.lastVerdict.direction === 'short' ? 'text-rose-400' : 'text-muted-foreground')}>{w.lastVerdict.direction.toUpperCase()}</span>
                        <span className="text-[10px] text-muted-foreground">conv {w.lastVerdict.conviction}</span>
                      </div>
                    )}
                    <Button
                      variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0"
                      onClick={() => mutate.mutate({ action: 'forceRun', symbol: w.symbol })}
                      disabled={mutate.isPending}
                    >
                      <Crosshair className="h-3 w-3 mr-1" /> Run
                    </Button>
                  </motion.div>
                ))}
                {!snap?.watch.length && (
                  <div className="text-center text-sm text-muted-foreground py-12">
                    <Radio className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    Waiting for the first scheduler tick…
                    <div className="text-xs mt-1 opacity-70">The watch list populates as the brain scans assets.</div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Recent actions */}
        <Card className="border-border/60 ring-1 ring-inset ring-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-400" /> Action Feed <span className="text-[10px] font-normal text-muted-foreground ml-1">live</span></CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[420px]">
              <div className="px-4 pb-4 space-y-1.5">
                {(snap?.recentActions ?? []).map((a, i) => {
                  // Autonomy events (self-tune, triggers) get highlighted rows
                  // so the brain's higher-level reasoning is visible, not just
                  // the per-asset skip/analyze churn.
                  const isAutonomy = a.action === 'self-tune' || a.action === 'cross-asset' || a.action === 'news-event' || a.symbol.includes('TRIGGER') || a.symbol === 'SELF-TUNE';
                  return (
                    <div key={i} className={cn(
                      'flex items-start gap-2 text-xs rounded-md px-1.5 py-1 transition-colors',
                      isAutonomy && 'bg-violet-500/[0.07] ring-1 ring-inset ring-violet-500/20'
                    )}>
                      <span className={cn('mt-1 h-1.5 w-1.5 rounded-full shrink-0', isAutonomy ? 'bg-violet-400' : actionColor(a.action).replace('text-', 'bg-'))} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold">{a.symbol.replace('USDT', '')}</span>
                          {isAutonomy ? (
                            <Badge variant="outline" className="text-[9px] py-0 gap-0.5 bg-violet-500/15 text-violet-300 border-violet-500/30">
                              <Sparkles className="h-2.5 w-2.5" />{a.action}
                            </Badge>
                          ) : (
                            <span className={actionColor(a.action)}>{a.action}</span>
                          )}
                          {a.tokens != null && <Badge variant="outline" className="text-[9px] py-0">{a.tokens} tok</Badge>}
                          {a.direction && a.direction !== 'neutral' && (
                            <Badge variant="outline" className={cn('text-[9px] py-0', a.direction === 'long' ? 'text-emerald-400' : 'text-rose-400')}>{a.direction}</Badge>
                          )}
                          {a.conviction != null && isAutonomy && (
                            <Badge variant="outline" className="text-[9px] py-0 text-violet-300/80">{a.conviction}% win</Badge>
                          )}
                        </div>
                        <div className="text-muted-foreground/70 text-[10px] truncate">{humanizeReason(a.reason)} · {ago(a.ts)}</div>
                      </div>
                    </div>
                  );
                })}
                {!snap?.recentActions.length && (
                  <div className="text-center text-sm text-muted-foreground py-12 opacity-60">No actions yet.</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Gate config */}
      <Card className="border-border/60 ring-1 ring-inset ring-border/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Gauge className="h-4 w-4 text-sky-400" /> Gate Configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <CfgSlider label="Min Noteworthiness" hint="Below this + recently analyzed → skip" value={live?.minNoteworthiness ?? 35} min={0} max={100} step={5} onChange={(v) => setCfg((c) => ({ ...c, minNoteworthiness: v }))} onCommit={(v) => commitCfg({ minNoteworthiness: v })} />
          <CfgSlider label="High Noteworthiness" hint="At/above → eligible for deep tier" value={live?.highNoteworthiness ?? 65} min={0} max={100} step={5} onChange={(v) => setCfg((c) => ({ ...c, highNoteworthiness: v }))} onCommit={(v) => commitCfg({ highNoteworthiness: v })} />
          <CfgSlider label="Unanimous Conviction" hint="Deterministic conviction ≥ this → skip LLM" value={live?.unanimousConviction ?? 70} min={0} max={100} step={5} onChange={(v) => setCfg((c) => ({ ...c, unanimousConviction: v }))} onCommit={(v) => commitCfg({ unanimousConviction: v })} />
          <CfgSlider label="Budget Cap (tokens/window)" hint="Hard ceiling per rolling window" value={live?.budgetCap ?? 60000} min={5000} max={200000} step={5000} onChange={(v) => setCfg((c) => ({ ...c, budgetCap: v }))} onCommit={(v) => commitCfg({ budgetCap: v })} display={fmt(live?.budgetCap ?? 60000)} />
          <CfgSlider label="Cache TTL (min)" hint="Reuse verdict if data unchanged within this" value={Math.round((live?.cacheTtlMs ?? 1800000) / 60000)} min={5} max={120} step={5} onChange={(v) => setCfg((c) => ({ ...c, cacheTtlMs: v * 60000 }))} onCommit={(v) => commitCfg({ cacheTtlMs: v * 60000 })} />
          <CfgSlider label="Min Reanalyze Gap (min)" hint="Soonest to re-call the LLM for one asset" value={Math.round((live?.minReanalyzeMs ?? 600000) / 60000)} min={1} max={60} step={1} onChange={(v) => setCfg((c) => ({ ...c, minReanalyzeMs: v * 60000 }))} onCommit={(v) => commitCfg({ minReanalyzeMs: v * 60000 })} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground/60 text-center pb-2">
        The brain applies ponytail's ladder to every LLM call: skip when the math is unanimous, reuse when data is unchanged, spend only when it matters. Manual force-run works even when paused.
      </p>

      <FreeSignalsCard />
    </div>
  );
}

function StatTile({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="border-border/60 ring-1 ring-inset ring-border/30 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className={accent}>{icon}</span>
        </div>
        <div className={cn('text-2xl font-bold tabular-nums', accent)}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function CfgSlider({ label, hint, value, min, max, step, onChange, onCommit, display }: {
  label: string; hint: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; onCommit: (v: number) => void; display?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs font-mono tabular-nums text-sky-400">{display ?? value}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step}
        onValueChange={(v) => onChange(v[0])}
        onValueCommit={(v) => onCommit(v[0])}
        className="[&_[role=slider]]:h-[18px] [&_[role=slider]]:w-[18px] [&_[role=slider]]:border-2 [&_[role=slider]]:border-sky-300 [&_[role=slider]]:bg-sky-500 [&_[role=slider]]:shadow-md [&_[role=slider]]:shadow-sky-500/40 [&_[role=slider]]:ring-2 [&_[role=slider]]:ring-sky-400/20 [&_[role=slider]]:transition-transform [&_[role=slider]]:hover:scale-110 [&>span:first-child]:bg-sky-500/20"
      />
      <p className="text-[10px] text-muted-foreground/70">{hint}</p>
    </div>
  );
}
