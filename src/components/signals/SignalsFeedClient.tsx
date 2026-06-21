'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Search,
  Activity,
  AlertCircle,
  RefreshCw,
  Target,
  ShieldAlert,
  Trophy,
  Layers,
  Cpu,
  Clock,
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ApiResult, Direction, LayerScore } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types — mirror the Prisma Signal shape returned by /api/signals
// ---------------------------------------------------------------------------
interface SignalAsset {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
}

interface SignalOutcome {
  id: string;
  horizon: string;
  expected: string;
  actual: string | null;
  pnlPct: number | null;
  grade: string | null;
}

interface Signal {
  id: string;
  assetId: string;
  asset: SignalAsset;
  timestamp: string;
  direction: Direction;
  conviction: number;
  timeframe: string;
  layersSummary: string; // JSON string of LayerScore[]
  modelsUsed: string; // JSON string of string[]
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  rationale: string;
  status: string;
  expiresAt: string | null;
  outcomes: SignalOutcome[];
}

async function fetchSignals(): Promise<Signal[]> {
  const r = await fetch('/api/signals?limit=100', { cache: 'no-store' });
  const j: ApiResult<Signal[]> = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to load signals');
  return (j.data ?? []).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Direction helpers
// ---------------------------------------------------------------------------
const DIRECTION_STYLE: Record<
  Direction,
  {
    border: string;
    text: string;
    bg: string;
    bar: string;
    icon: typeof TrendingUp;
    arrow: typeof ArrowUp;
  }
> = {
  long: {
    border: 'border-l-emerald-500',
    text: 'text-emerald-500',
    bg: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
    bar: '[&>[data-slot=progress-indicator]]:bg-emerald-500',
    icon: TrendingUp,
    arrow: ArrowUp,
  },
  short: {
    border: 'border-l-rose-500',
    text: 'text-rose-500',
    bg: 'bg-rose-500/10 text-rose-500 border-rose-500/30',
    bar: '[&>[data-slot=progress-indicator]]:bg-rose-500',
    icon: TrendingDown,
    arrow: ArrowDown,
  },
  neutral: {
    border: 'border-l-zinc-500',
    text: 'text-zinc-500',
    bg: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30',
    bar: '[&>[data-slot=progress-indicator]]:bg-zinc-500',
    icon: Minus,
    arrow: ArrowRight,
  },
};

// Conviction gradient — rose (low) → amber (mid) → emerald (high).
function convictionGradient(v: number): string {
  // Continuous gradient with a hard color stop that shifts based on value.
  // We position the gradient so low conviction shows mostly rose, mid shows
  // amber, high shows emerald. The fill itself stops at v% of the bar.
  const stop = Math.max(10, Math.min(90, v));
  return `linear-gradient(90deg, #f43f5e 0%, #f59e0b ${stop * 0.6}%, #10b981 ${stop}%, #10b981 100%)`;
}

function formatPrice(p: number | null | undefined): string {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

// ---------------------------------------------------------------------------
// Layer badge — shows per-layer score from layersSummary JSON
// ---------------------------------------------------------------------------
function LayerBadges({ layersSummary }: { layersSummary: string }) {
  let layers: LayerScore[] = [];
  try {
    const parsed = JSON.parse(layersSummary);
    if (Array.isArray(parsed)) layers = parsed;
    else if (parsed && typeof parsed === 'object')
      layers = Object.values(parsed) as LayerScore[];
  } catch {
    return null;
  }
  if (!layers.length) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {layers.map((l) => {
        const score = typeof l.score === 'number' ? l.score : 0;
        const bullish = score > 5;
        const bearish = score < -5;
        const color = bullish
          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
          : bearish
            ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
            : 'bg-amber-500/10 text-amber-500 border-amber-500/20';
        return (
          <Badge
            key={l.layer}
            variant="outline"
            className={cn('px-1.5 py-0 text-[10px] font-medium capitalize', color)}
            title={l.detail || l.layer}
          >
            {l.layer}
            <span className="ml-1 tabular-nums opacity-80">
              {score > 0 ? '+' : ''}
              {Math.round(score)}
            </span>
          </Badge>
        );
      })}
    </div>
  );
}

function ModelsUsed({ modelsUsed }: { modelsUsed: string }) {
  let models: string[] = [];
  try {
    const parsed = JSON.parse(modelsUsed);
    if (Array.isArray(parsed)) models = parsed;
  } catch {
    /* noop */
  }
  if (!models.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Cpu className="h-3 w-3 text-muted-foreground" />
      {models.slice(0, 4).map((m, i) => (
        <Badge key={i} variant="secondary" className="px-1.5 py-0 text-[10px] font-mono">
          {m.length > 24 ? m.slice(0, 22) + '…' : m}
        </Badge>
      ))}
      {models.length > 4 && (
        <span className="text-[10px] text-muted-foreground">+{models.length - 4} more</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single signal card
// ---------------------------------------------------------------------------
function SignalCard({ signal, index }: { signal: Signal; index: number }) {
  const dir = DIRECTION_STYLE[signal.direction] ?? DIRECTION_STYLE.neutral;
  const Arrow = dir.arrow;
  const hasPrices =
    signal.entryPrice != null || signal.stopLoss != null || signal.takeProfit != null;
  const isClosed = signal.status === 'closed' || signal.status === 'expired';

  // Fresh-signal detection: pulse for the first 5 minutes after creation.
  const ageMs = Date.now() - new Date(signal.timestamp).getTime();
  const isFresh = !isClosed && ageMs > 0 && ageMs < 5 * 60 * 1000;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4), duration: 0.32, ease: 'easeOut' }}
      className="h-full"
    >
      <Card
        className={cn(
          'group relative border-l-4 border-border/60 ring-1 ring-inset ring-border/30 hover:border-border hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-200 ease-out overflow-hidden',
          dir.border,
          isFresh && 'animate-pulse',
        )}
      >
        {isFresh && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-emerald-500"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Fresh
          </span>
        )}
        <CardContent className="p-4 space-y-3">
          {/* Top row — identity */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/crypto/${encodeURIComponent(signal.asset.symbol)}`}
                  className="font-semibold tracking-tight hover:text-emerald-500 transition-colors duration-200"
                >
                  {signal.asset.symbol.replace('USDT', '')}
                </Link>
                <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                  {signal.asset.name}
                </span>
                {isClosed && (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] capitalize">
                    {signal.status}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(signal.timestamp), { addSuffix: true })}
                <span className="opacity-40">·</span>
                <span className="uppercase tracking-wide">{signal.timeframe}</span>
              </div>
            </div>
            <Badge className={cn('border gap-1 font-semibold capitalize transition-transform duration-200 group-hover:scale-105', dir.bg)}>
              <Arrow className="h-3 w-3" />
              {signal.direction}
            </Badge>
          </div>

          {/* Conviction — animated gradient progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Activity className="h-3 w-3" /> Conviction
              </span>
              <span className={cn('font-semibold tabular-nums', dir.text)}>
                {signal.conviction}/100
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border/30">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${Math.max(2, Math.min(100, signal.conviction))}%`,
                  backgroundImage: convictionGradient(signal.conviction),
                  boxShadow: '0 0 8px rgba(16,185,129,0.25)',
                }}
              />
            </div>
          </div>

          {/* Prices */}
          {hasPrices && (
            <div className="grid grid-cols-3 gap-2">
              <PriceCell
                icon={<Target className="h-3 w-3" />}
                label="Entry"
                value={formatPrice(signal.entryPrice)}
                tone="default"
              />
              <PriceCell
                icon={<ShieldAlert className="h-3 w-3" />}
                label="Stop"
                value={formatPrice(signal.stopLoss)}
                tone="rose"
              />
              <PriceCell
                icon={<Trophy className="h-3 w-3" />}
                label="Target"
                value={formatPrice(signal.takeProfit)}
                tone="emerald"
              />
            </div>
          )}

          {/* Rationale */}
          {signal.rationale && (
            <div
              className={cn(
                'max-h-32 overflow-y-auto pr-1 text-xs text-muted-foreground leading-relaxed',
                '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent',
              )}
            >
              {signal.rationale}
            </div>
          )}

          {/* Layers + models */}
          <div className="space-y-2 pt-1 border-t border-border/40">
            <LayerBadges layersSummary={signal.layersSummary} />
            <ModelsUsed modelsUsed={signal.modelsUsed} />
          </div>

          {/* Outcomes */}
          {signal.outcomes?.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {signal.outcomes.map((o) => {
                const grade = o.grade;
                const tone =
                  grade === 'correct'
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                    : grade === 'wrong'
                      ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                      : 'bg-amber-500/10 text-amber-500 border-amber-500/20';
                return (
                  <Badge
                    key={o.id}
                    variant="outline"
                    className={cn('px-1.5 py-0 text-[10px] capitalize', tone)}
                  >
                    {o.horizon}: {o.actual ?? 'pending'}
                    {o.pnlPct != null && (
                      <span className="ml-1 tabular-nums">
                        {o.pnlPct > 0 ? '+' : ''}
                        {o.pnlPct.toFixed(2)}%
                      </span>
                    )}
                  </Badge>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function PriceCell({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'default' | 'rose' | 'emerald';
}) {
  const toneCls =
    tone === 'rose'
      ? 'text-rose-500'
      : tone === 'emerald'
        ? 'text-emerald-500'
        : 'text-foreground';
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5 space-y-0.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn('text-xs font-semibold tabular-nums', toneCls)}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters bar
// ---------------------------------------------------------------------------
interface Filters {
  status: 'all' | 'open' | 'closed';
  direction: 'all' | Direction;
  minConviction: number;
  search: string;
}

function FiltersBar({
  filters,
  onChange,
  total,
  shown,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  total: number;
  shown: number;
}) {
  return (
    <Card className="border-border/60 ring-1 ring-inset ring-border/30">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={filters.status}
            onValueChange={(v) => onChange({ ...filters, status: v as Filters['status'] })}
          >
            <TabsList className="p-1 gap-0.5 bg-muted/60 backdrop-blur-sm">
              <TabsTrigger
                value="all"
                className="transition-all duration-200 ease-out data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400 data-[state=active]:shadow-sm hover:bg-muted"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="open"
                className="transition-all duration-200 ease-out data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400 data-[state=active]:shadow-sm hover:bg-muted"
              >
                Open
              </TabsTrigger>
              <TabsTrigger
                value="closed"
                className="transition-all duration-200 ease-out data-[state=active]:bg-zinc-500/15 data-[state=active]:text-zinc-600 dark:data-[state=active]:text-zinc-400 data-[state=active]:shadow-sm hover:bg-muted"
              >
                Closed
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-1.5 flex-wrap p-1 rounded-lg bg-muted/60 backdrop-blur-sm">
            {(['all', 'long', 'short', 'neutral'] as const).map((d) => {
              const isActive = filters.direction === d;
              const activeColor =
                d === 'long'
                  ? 'bg-emerald-500/15 text-emerald-500 shadow-sm'
                  : d === 'short'
                    ? 'bg-rose-500/15 text-rose-500 shadow-sm'
                    : d === 'neutral'
                      ? 'bg-zinc-500/15 text-zinc-500 shadow-sm'
                      : 'bg-emerald-500/15 text-emerald-500 shadow-sm';
              const Arrow =
                d === 'long' ? ArrowUp : d === 'short' ? ArrowDown : d === 'neutral' ? ArrowRight : null;
              return (
                <Button
                  key={d}
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-7 px-2.5 text-xs capitalize transition-all duration-200 ease-out hover:bg-muted',
                    isActive ? activeColor : 'text-muted-foreground',
                  )}
                  onClick={() => onChange({ ...filters, direction: d })}
                >
                  {Arrow && <Arrow className="h-3 w-3" />}
                  {d}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors duration-200 focus-within:text-emerald-500" />
            <Input
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              placeholder="Search by symbol (BTC, ETH…)"
              className="pl-8 h-9 transition-colors duration-200 focus-visible:border-emerald-500/40"
            />
          </div>
          <div className="flex items-center gap-3 min-w-[220px]">
            <div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
              <Layers className="h-3.5 w-3.5" />
              Min conviction
              <span className="text-emerald-500 font-semibold tabular-nums w-7 text-right">
                {filters.minConviction}
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[filters.minConviction]}
              onValueChange={([v]) => onChange({ ...filters, minConviction: v ?? 0 })}
              className="flex-1"
            />
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap md:ml-auto">
            Showing <span className="text-foreground font-semibold tabular-nums">{shown}</span> /{' '}
            <span className="tabular-nums">{total}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function SignalsSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="border-l-4 border-l-muted border-border/60">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-1.5 w-full" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
            <Skeleton className="h-16 w-full" />
            <div className="flex gap-1">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------
export function SignalsFeedClient() {
  const [filters, setFilters] = useState<Filters>({
    status: 'all',
    direction: 'all',
    minConviction: 0,
    search: '',
  });

  const signalsQ = useQuery({
    queryKey: ['signals-feed'],
    queryFn: fetchSignals,
    refetchInterval: 30_000,
  });

  const all = signalsQ.data ?? [];

  const filtered = useMemo(() => {
    return all.filter((s) => {
      if (filters.status === 'open' && s.status !== 'open') return false;
      if (filters.status === 'closed' && s.status !== 'closed' && s.status !== 'expired')
        return false;
      if (filters.direction !== 'all' && s.direction !== filters.direction) return false;
      if (filters.minConviction > 0 && s.conviction < filters.minConviction) return false;
      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        if (
          !s.asset.symbol.toLowerCase().includes(q) &&
          !s.asset.name.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [all, filters]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-start justify-between gap-3 flex-wrap"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2 text-balance">
            Signals Feed
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1 text-pretty">
            AI consensus trade signals · multi-model fusion · auto-refresh every 30s
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signalsQ.refetch()}
          disabled={signalsQ.isFetching}
          className="h-8 transition-all duration-200 hover:border-emerald-500/40 hover:text-emerald-500 hover:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', signalsQ.isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </motion.div>

      {/* Filters */}
      <FiltersBar
        filters={filters}
        onChange={setFilters}
        total={all.length}
        shown={filtered.length}
      />

      {/* Body */}
      {signalsQ.isLoading ? (
        <SignalsSkeleton />
      ) : signalsQ.error ? (
        <Card className="border-rose-500/30 bg-rose-500/[0.03]">
          <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-3">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <div>
              <p className="font-semibold text-rose-500">Failed to load signals</p>
              <p className="text-xs text-muted-foreground mt-1">
                {signalsQ.error instanceof Error ? signalsQ.error.message : 'Unknown error'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => signalsQ.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 flex flex-col items-center justify-center text-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
              <Activity className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">No signals yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                {all.length === 0
                  ? 'Run an analysis from the Crypto page to generate your first AI consensus signal.'
                  : 'No signals match the current filters. Try loosening the conviction slider or clearing the search.'}
              </p>
            </div>
            {all.length === 0 && (
              <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Link href="/crypto">
                  <Activity className="h-3.5 w-3.5" /> Go to Crypto
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((s, i) => (
            <SignalCard key={s.id} signal={s} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
