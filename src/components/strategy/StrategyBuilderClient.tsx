'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Workflow,
  Save,
  Play,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Search,
  Sparkles,
  Wand2,
  FlaskConical,
  Rocket,
  Target,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Trophy,
  Activity,
  Zap,
  Trash2,
  Copy,
  Plus,
  ChevronRight,
  Layers,
  Radio,
  BellRing,
  CircleSlash,
  CheckCheck,
  RefreshCw,
  Clock,
  X,
  Settings2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  TECHNICAL_FILTERS,
  FILTER_BY_KEY,
  FILTER_COLOR_CLASSES,
} from '@/lib/analysis/screener';
import { runBacktest, type BacktestResult } from '@/lib/analysis/backtest';
import {
  mapScreenerToBacktest,
  buildStrategySummary,
  loadStrategies,
  saveStrategies,
  createBlankStrategy,
  buildDeployPlan,
  DEFAULT_UNIVERSE,
  STRATEGIES_STORAGE_KEY,
  type StrategyDefinition,
} from '@/lib/analysis/strategy-builder';
import type { ApiResult, Kline, Ticker } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3;

type Timeframe = '1d' | '4h' | '1h';
type Period = '3m' | '6m' | '1y';

const PERIOD_LIMITS: Record<Period, number> = {
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

const TF_TO_INTERVAL: Record<Timeframe, string> = {
  '1d': '1d',
  '4h': '4h',
  '1h': '1h',
};

const TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: '1d', label: '1D' },
  { value: '4h', label: '4H' },
  { value: '1h', label: '1H' },
];

const PERIODS: Array<{ value: Period; label: string; sub: string }> = [
  { value: '3m', label: '3M', sub: '90 bars' },
  { value: '6m', label: '6M', sub: '180 bars' },
  { value: '1y', label: '1Y', sub: '365 bars' },
];

const STEPS: Array<{
  num: Step;
  label: string;
  desc: string;
  icon: typeof Wand2;
}> = [
  { num: 1, label: 'Define', desc: 'Strategy conditions', icon: Wand2 },
  { num: 2, label: 'Backtest', desc: 'Historical performance', icon: FlaskConical },
  { num: 3, label: 'Deploy', desc: 'Live alerts', icon: Rocket },
];

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchAssets(): Promise<Ticker[]> {
  const r = await fetch('/api/crypto/prices', { cache: 'no-store' });
  const j: ApiResult<Ticker[]> = await r.json();
  if (!j.success || !Array.isArray(j.data)) {
    throw new Error(j.error || 'Failed to load assets');
  }
  return [...j.data].sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));
}

async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Kline[]> {
  const url = `/api/crypto/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { cache: 'no-store' });
  const j: ApiResult<{ klines: Kline[] }> = await r.json();
  if (!j.success || !j.data?.klines) {
    throw new Error(j.error || 'Failed to load klines');
  }
  return j.data.klines;
}

interface ScanStats {
  scanned: number;
  candidates: number;
  matches: number;
  bullish: number;
  bearish: number;
  avgRsi: number;
  filterCounts: Record<string, number>;
}
interface ScanResponse {
  results: ScreenerMatch[];
  stats: ScanStats;
}
interface ScreenerMatch {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  quoteVolume: number;
  rsi: number;
  macdHistogram: number;
  ema20: number;
  ema50: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  matchedFilters: string[];
  conviction: number;
  supportDistPct: number;
  resistanceDistPct: number;
}

async function runScreenerScan(
  filters: string[],
  universe: string[],
): Promise<ScanResponse> {
  // Use the topN cap to cover the universe — most universes are ~10-30
  // assets, well under the default 80-deep-scan cap.
  const topN = Math.min(150, Math.max(20, universe.length + 20));
  const r = await fetch('/api/screener/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters,
      volumeMin: 500_000,
      direction: 'all',
      sortBy: 'conviction',
      topN,
      limit: 100,
    }),
    cache: 'no-store',
  });
  const j: ApiResult<ScanResponse> = await r.json();
  if (!j.success || !j.data) {
    throw new Error(j.error || 'Scan failed');
  }
  // Filter to the user's universe (the screener scans by volume rank, not
  // user-supplied symbol list — so intersect here).
  const set = new Set(universe);
  const filtered: ScreenerMatch[] = j.data.results.filter((m) =>
    set.has(m.symbol),
  );
  return { results: filtered, stats: j.data.stats };
}

interface CreateAlertResponse {
  id: string;
  assetSymbol: string;
  condition: string;
  targetPrice: number;
  channel: string;
  status: string;
}

async function createPriceAlert(
  body: {
    assetSymbol: string;
    condition: string;
    targetPrice: number;
    channel: string;
    note: string | null;
  },
): Promise<CreateAlertResponse> {
  const r = await fetch('/api/price-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const j: ApiResult<CreateAlertResponse> = await r.json();
  if (!j.success || !j.data) {
    throw new Error(j.error || 'Failed to create alert');
  }
  return j.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(p: number): string {
  if (!isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(4);
}

function formatUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatPct(v: number, withSign = true): string {
  if (!isFinite(v)) return '—';
  const s = withSign && v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

function convictionColor(score: number): {
  text: string;
  from: string;
  to: string;
} {
  if (score >= 60) return { text: 'text-emerald-400', from: 'from-emerald-500', to: 'to-teal-400' };
  if (score >= 30) return { text: 'text-amber-400', from: 'from-amber-500', to: 'to-orange-400' };
  return { text: 'text-rose-400', from: 'from-rose-500', to: 'to-rose-400' };
}

function cleanSymbol(sym: string): string {
  return sym.replace(/USDT$/, '');
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterChip({
  filterKey,
  active,
  onToggle,
  disabled,
}: {
  filterKey: string;
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const filter = FILTER_BY_KEY[filterKey];
  if (!filter) return null;
  const Icon = filter.icon;
  const c = FILTER_COLOR_CLASSES[filter.color];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={active}
          className={cn(
            'group relative flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            disabled && 'opacity-50 cursor-not-allowed',
            active
              ? cn(c.activeBg, c.activeBorder, c.activeText, c.glow)
              : cn(
                  c.bg,
                  c.border,
                  'text-muted-foreground hover:scale-[1.03] hover:brightness-125',
                ),
          )}
        >
          <Icon
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform',
              active && 'scale-110',
            )}
          />
          <span className="truncate">{filter.label}</span>
          {active && (
            <CheckCircle2 className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-left leading-snug">
        <div className="font-semibold">{filter.label}</div>
        <div className="text-[11px] text-muted-foreground">{filter.description}</div>
        <div className="mt-1 flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              'h-4 px-1 text-[9px] uppercase tracking-wide',
              filter.direction === 'bullish' && 'border-emerald-500/40 text-emerald-500',
              filter.direction === 'bearish' && 'border-rose-500/40 text-rose-500',
              filter.direction === 'neutral' && 'border-amber-500/40 text-amber-500',
            )}
          >
            {filter.direction}
          </Badge>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function SignalDots({ matched }: { matched: string[] }) {
  if (matched.length === 0) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-1 flex-wrap max-w-[140px]">
      {matched.map((key) => {
        const f = FILTER_BY_KEY[key];
        if (!f) return null;
        const c = FILTER_COLOR_CLASSES[f.color];
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'inline-block h-2 w-2 rounded-full ring-1 ring-inset ring-black/20',
                  c.dot,
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              <span className="font-semibold">{f.label}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ConvictionBar({ score }: { score: number }) {
  const c = convictionColor(score);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-[60px] overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border/30">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className={cn('h-full rounded-full bg-gradient-to-r', c.from, c.to)}
        />
      </div>
      <span className={cn('font-mono text-[11px] tabular-nums font-semibold', c.text)}>
        {score}
      </span>
    </div>
  );
}

function Stepper({
  current,
  onNavigate,
  canNavigate,
}: {
  current: Step;
  onNavigate: (s: Step) => void;
  canNavigate: (s: Step) => boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-0 select-none">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isDone = step.num < current;
        const isCurrent = step.num === current;
        const clickable = canNavigate(step.num);
        return (
          <div key={step.num} className="flex items-center">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onNavigate(step.num)}
              className={cn(
                'group relative flex flex-col items-center gap-1.5 rounded-lg px-3 py-2 transition-all',
                clickable ? 'cursor-pointer hover:bg-muted/40' : 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-full ring-2 transition-all duration-300',
                  isCurrent &&
                    'bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.55)]',
                  isDone &&
                    'bg-emerald-500/15 text-emerald-500 ring-emerald-500/40',
                  !isCurrent &&
                    !isDone &&
                    'bg-muted/40 text-muted-foreground ring-border/60',
                )}
              >
                {isCurrent && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full ring-2 ring-emerald-400/50 animate-ping"
                  />
                )}
                {isDone ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <Icon className="h-5 w-5" />
                )}
              </span>
              <div className="flex flex-col items-center leading-tight">
                <span
                  className={cn(
                    'text-[11px] font-bold uppercase tracking-wider',
                    isCurrent && 'text-emerald-500',
                    isDone && 'text-emerald-500/80',
                    !isCurrent && !isDone && 'text-muted-foreground',
                  )}
                >
                  {step.num}. {step.label}
                </span>
                <span className="text-[9px] text-muted-foreground hidden sm:block">
                  {step.desc}
                </span>
              </div>
            </button>
            {i < STEPS.length - 1 && (
              <div className="relative mx-1 mb-6 h-0.5 w-10 sm:w-16 overflow-hidden rounded-full bg-border/60">
                <motion.div
                  initial={false}
                  animate={{
                    width: step.num < current ? '100%' : '0%',
                  }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.5,
  icon: Icon,
  color = 'emerald',
  suffix = '%',
  description,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  icon: typeof Target;
  color?: 'emerald' | 'rose' | 'amber' | 'teal';
  suffix?: string;
  description?: string;
}) {
  const colorClass = {
    emerald: 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/30',
    rose: 'text-rose-500 bg-rose-500/10 ring-rose-500/30',
    amber: 'text-amber-500 bg-amber-500/10 ring-amber-500/30',
    teal: 'text-teal-500 bg-teal-500/10 ring-teal-500/30',
  }[color];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-inset',
              colorClass,
            )}
          >
            <Icon className="h-3 w-3" />
          </span>
          <Label className="text-xs font-semibold">{label}</Label>
          {description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px] max-w-[220px]">
                {description}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <span
          className={cn(
            'rounded-md px-2 py-0.5 font-mono text-xs tabular-nums font-bold ring-1 ring-inset',
            colorClass,
          )}
        >
          {value.toFixed(step < 1 ? 1 : 0)}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="py-1"
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: typeof TrendingUp;
  tone: 'emerald' | 'rose' | 'amber' | 'zinc';
}) {
  const toneClasses = {
    emerald: {
      bg: 'bg-emerald-500/10',
      ring: 'ring-emerald-500/30',
      text: 'text-emerald-500',
      glow: 'shadow-[0_0_18px_-4px_rgba(16,185,129,0.35)]',
    },
    rose: {
      bg: 'bg-rose-500/10',
      ring: 'ring-rose-500/30',
      text: 'text-rose-500',
      glow: 'shadow-[0_0_18px_-4px_rgba(244,63,94,0.35)]',
    },
    amber: {
      bg: 'bg-amber-500/10',
      ring: 'ring-amber-500/30',
      text: 'text-amber-500',
      glow: 'shadow-[0_0_18px_-4px_rgba(245,158,11,0.35)]',
    },
    zinc: {
      bg: 'bg-zinc-500/10',
      ring: 'ring-zinc-500/30',
      text: 'text-zinc-400',
      glow: '',
    },
  }[tone];
  return (
    <Card
      className={cn(
        'relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm',
        'transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg',
        toneClasses.glow,
      )}
    >
      <div
        aria-hidden
        className={cn('absolute inset-0 opacity-30 pointer-events-none', toneClasses.bg)}
      />
      <CardContent className="relative p-4">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </Label>
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset',
              toneClasses.bg,
              toneClasses.text,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-1.5 font-mono text-xl tabular-nums font-bold text-foreground">
          {value}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Universe Multi-Select
// ---------------------------------------------------------------------------

function UniverseSelector({
  universe,
  onChange,
  allAssets,
}: {
  universe: string[];
  onChange: (next: string[]) => void;
  allAssets: Ticker[];
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return allAssets.slice(0, 30);
    const q = search.toUpperCase();
    return allAssets
      .filter((t) => t.symbol.includes(q))
      .slice(0, 30);
  }, [search, allAssets]);

  const toggle = (sym: string) => {
    if (universe.includes(sym)) {
      onChange(universe.filter((s) => s !== sym));
    } else {
      onChange([...universe, sym]);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Asset Universe ({universe.length})
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] gap-1"
          onClick={() => onChange(allAssets.slice(0, 30).map((t) => t.symbol))}
        >
          <Layers className="h-3 w-3" /> Select top 30 crypto
        </Button>
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assets to add..."
          className="h-8 pl-8 text-xs"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto rounded-md border border-border/40 bg-card/30 p-2 scrollbar-thin">
        {universe.length === 0 && (
          <span className="text-[11px] text-muted-foreground px-1 py-0.5">
            No assets selected — default universe will be used.
          </span>
        )}
        {universe.map((sym) => {
          const t = allAssets.find((x) => x.symbol === sym);
          return (
            <button
              key={sym}
              type="button"
              onClick={() => toggle(sym)}
              className={cn(
                'group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all',
                'bg-emerald-500/10 border-emerald-500/40 text-emerald-500',
                'hover:bg-rose-500/10 hover:border-rose-500/40 hover:text-rose-500',
              )}
              title={`${sym} — ${t ? formatUsd(t.quoteVolume) : ''} vol`}
            >
              <span className="font-mono">{cleanSymbol(sym)}</span>
              <X className="h-2.5 w-2.5" />
            </button>
          );
        })}
      </div>
      {search.trim() && (
        <div className="rounded-md border border-border/40 bg-card/30 max-h-40 overflow-y-auto scrollbar-thin">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">No matches.</div>
          ) : (
            filtered.map((t) => {
              const inU = universe.includes(t.symbol);
              return (
                <button
                  key={t.symbol}
                  type="button"
                  onClick={() => toggle(t.symbol)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors',
                    'hover:bg-muted/40 border-b border-border/30 last:border-0',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{cleanSymbol(t.symbol)}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatUsd(t.quoteVolume)} vol
                    </span>
                  </span>
                  {inU ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Preview Card (Step 1)
// ---------------------------------------------------------------------------

function LivePreviewCard({
  strategy,
  unmappedCount,
}: {
  strategy: StrategyDefinition;
  unmappedCount: number;
}) {
  const summary = buildStrategySummary(strategy);
  const rrColor =
    summary.rrRatio >= 2
      ? 'text-emerald-500'
      : summary.rrRatio >= 1
      ? 'text-amber-500'
      : 'text-rose-500';
  const riskColor = {
    conservative: 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/30',
    balanced: 'text-teal-500 bg-teal-500/10 ring-teal-500/30',
    aggressive: 'text-rose-500 bg-rose-500/10 ring-rose-500/30',
  }[summary.riskLevel];

  return (
    <Card className="sticky top-4 border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_60%)] pointer-events-none"
      />
      <CardContent className="relative p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500/20 to-teal-500/10 ring-1 ring-inset ring-emerald-500/30">
              <Workflow className="h-4 w-4 text-emerald-500" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Live Preview
            </span>
          </div>
          {summary.valid ? (
            <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Valid
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-rose-500/40 bg-rose-500/15 text-rose-500 animate-pulse"
            >
              <AlertCircle className="h-3 w-3 mr-1" /> Invalid
            </Badge>
          )}
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            Name
          </div>
          <div className="font-semibold text-sm text-foreground truncate">
            {strategy.name || 'Untitled Strategy'}
          </div>
          {strategy.description && (
            <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
              {strategy.description}
            </div>
          )}
        </div>

        <Separator className="bg-border/40" />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Entries
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  'font-mono text-2xl tabular-nums font-bold',
                  summary.entryCount > 0 ? 'text-emerald-500' : 'text-rose-500',
                )}
              >
                {summary.entryCount}
              </span>
              <span className="text-[10px] text-muted-foreground">filters</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Exits
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  'font-mono text-2xl tabular-nums font-bold',
                  summary.exitCount > 0 ? 'text-emerald-500' : 'text-rose-500',
                )}
              >
                {summary.exitCount}
              </span>
              <span className="text-[10px] text-muted-foreground">filters</span>
            </div>
          </div>
        </div>

        <Separator className="bg-border/40" />

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
              Stop Loss
            </div>
            <span className="font-mono text-xs tabular-nums text-rose-500 font-bold">
              -{strategy.stopLossPct.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Target className="h-3.5 w-3.5 text-emerald-500" />
              Take Profit
            </div>
            <span className="font-mono text-xs tabular-nums text-emerald-500 font-bold">
              +{strategy.takeProfitPct.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Layers className="h-3.5 w-3.5 text-teal-500" />
              Position Size
            </div>
            <span className="font-mono text-xs tabular-nums text-foreground font-bold">
              {strategy.positionSizePct.toFixed(1)}%
            </span>
          </div>
        </div>

        <Separator className="bg-border/40" />

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border/40 bg-background/30 px-2.5 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Risk : Reward
            </div>
            <div className={cn('font-mono text-sm tabular-nums font-bold', rrColor)}>
              1 : {summary.rrRatio.toFixed(2)}
            </div>
          </div>
          <div className="rounded-md border border-border/40 bg-background/30 px-2.5 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Risk Level
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset',
                riskColor,
              )}
            >
              {summary.riskLevel}
            </span>
          </div>
        </div>

        {unmappedCount > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {unmappedCount} filter{unmappedCount > 1 ? 's' : ''} can&apos;t be
              mapped to backtest rules — will be skipped during backtest.
            </span>
          </div>
        )}

        {!summary.valid && (
          <div className="space-y-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2">
            {summary.errors.map((err, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[11px] text-rose-500">
                <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>{err}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Saved Strategies Drawer (top of page)
// ---------------------------------------------------------------------------

function SavedStrategiesBar({
  strategies,
  activeId,
  onLoad,
  onDelete,
  onNew,
}: {
  strategies: StrategyDefinition[];
  activeId: string | null;
  onLoad: (s: StrategyDefinition) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500/20 to-teal-500/10 ring-1 ring-inset ring-emerald-500/30">
              <Save className="h-3.5 w-3.5 text-emerald-500" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold flex items-center gap-2">
                Saved Strategies
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-mono">
                  {strategies.length}
                </Badge>
              </div>
              <div className="text-[10px] text-muted-foreground hidden sm:block">
                Persisted to your browser&apos;s localStorage.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {strategies.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setOpen((o) => !o)}
              >
                {open ? 'Hide' : 'Show'}
                <ChevronRight
                  className={cn(
                    'h-3 w-3 ml-1 transition-transform',
                    open && 'rotate-90',
                  )}
                />
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
              onClick={onNew}
            >
              <Plus className="h-3 w-3" /> New
            </Button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {open && strategies.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-border/40">
                {strategies.map((s) => {
                  const isActive = s.id === activeId;
                  const sum = buildStrategySummary(s);
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'group relative rounded-md border bg-card/40 px-3 py-2 transition-all hover:-translate-y-0.5 hover:shadow-md',
                        isActive
                          ? 'border-emerald-500/50 bg-emerald-500/5 shadow-[0_0_14px_-4px_rgba(16,185,129,0.4)]'
                          : 'border-border/40 hover:border-emerald-500/40',
                      )}
                    >
                      {isActive && (
                        <span className="absolute -top-1.5 -right-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 ring-1 ring-emerald-400/50 shadow-md">
                          <Check className="h-2.5 w-2.5" /> Active
                        </span>
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onLoad(s)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="text-xs font-semibold truncate">{s.name}</div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                            <span>{sum.entryCount}E / {sum.exitCount}X</span>
                            <span>•</span>
                            <span className="font-mono">SL {s.stopLossPct.toFixed(0)}%</span>
                            <span>•</span>
                            <span className="font-mono">TP {s.takeProfitPct.toFixed(0)}%</span>
                          </div>
                          {s.lastBacktest && (
                            <div className="text-[10px] mt-1 flex items-center gap-1.5">
                              <Trophy
                                className={cn(
                                  'h-2.5 w-2.5',
                                  s.lastBacktest.totalReturnPct >= 0
                                    ? 'text-emerald-500'
                                    : 'text-rose-500',
                                )}
                              />
                              <span
                                className={cn(
                                  'font-mono tabular-nums',
                                  s.lastBacktest.totalReturnPct >= 0
                                    ? 'text-emerald-500'
                                    : 'text-rose-500',
                                )}
                              >
                                {formatPct(s.lastBacktest.totalReturnPct)}
                              </span>
                              <span className="text-muted-foreground">
                                ({s.lastBacktest.totalTrades} trades)
                              </span>
                            </div>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(s.id)}
                          aria-label={`Delete ${s.name}`}
                          className="shrink-0 rounded-md p-1 text-muted-foreground/70 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Define Strategy
// ---------------------------------------------------------------------------

function StepDefine({
  strategy,
  setStrategy,
  onContinue,
  onSave,
  unmappedCount,
}: {
  strategy: StrategyDefinition;
  setStrategy: (updater: (s: StrategyDefinition) => StrategyDefinition) => void;
  onContinue: () => void;
  onSave: () => void;
  unmappedCount: number;
}) {
  const summary = buildStrategySummary(strategy);

  // Split screener filters into bullish (entries) and bearish (exits) defaults,
  // but allow all 14 in either list since some are neutral.
  const entryFilters = TECHNICAL_FILTERS.filter(
    (f) => f.direction !== 'bearish',
  );
  const exitFilters = TECHNICAL_FILTERS.filter(
    (f) => f.direction !== 'bullish',
  );

  const { data: allAssets, isLoading: assetsLoading } = useQuery<Ticker[]>({
    queryKey: ['strategy-builder-assets'],
    queryFn: fetchAssets,
    staleTime: 60_000,
  });

  const toggleEntry = (key: string) => {
    setStrategy((s) => ({
      ...s,
      entryConditions: s.entryConditions.includes(key)
        ? s.entryConditions.filter((k) => k !== key)
        : [...s.entryConditions, key],
      updatedAt: new Date().toISOString(),
    }));
  };
  const toggleExit = (key: string) => {
    setStrategy((s) => ({
      ...s,
      exitConditions: s.exitConditions.includes(key)
        ? s.exitConditions.filter((k) => k !== key)
        : [...s.exitConditions, key],
      updatedAt: new Date().toISOString(),
    }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
      {/* Left form */}
      <div className="space-y-4">
        {/* Basics */}
        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-emerald-500" />
              <h3 className="text-sm font-semibold">Strategy Basics</h3>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="strat-name" className="text-xs font-semibold">
                  Strategy Name
                </Label>
                <Input
                  id="strat-name"
                  value={strategy.name}
                  onChange={(e) =>
                    setStrategy((s) => ({ ...s, name: e.target.value }))
                  }
                  placeholder="e.g. RSI Reversal + Volume"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="strat-desc"
                  className="text-xs font-semibold flex items-center gap-1.5"
                >
                  Description
                  <span className="text-[10px] font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="strat-desc"
                  value={strategy.description}
                  onChange={(e) =>
                    setStrategy((s) => ({ ...s, description: e.target.value }))
                  }
                  placeholder="What's the thesis? When does this strategy work best?"
                  className="min-h-[60px] text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Universe */}
        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardContent className="p-5">
            {assetsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <UniverseSelector
                universe={strategy.universe}
                onChange={(u) =>
                  setStrategy((s) => ({ ...s, universe: u }))
                }
                allAssets={allAssets || []}
              />
            )}
          </CardContent>
        </Card>

        {/* Entry conditions */}
        <Card className="border-emerald-500/20 bg-card/40 backdrop-blur-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                </span>
                <h3 className="text-sm font-semibold">Entry Conditions</h3>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
                  {strategy.entryConditions.length} selected
                </Badge>
              </div>
              {strategy.entryConditions.length === 0 && (
                <span className="text-[10px] text-rose-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> At least 1 required
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {entryFilters.map((f) => (
                <FilterChip
                  key={f.key}
                  filterKey={f.key}
                  active={strategy.entryConditions.includes(f.key)}
                  onToggle={() => toggleEntry(f.key)}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Exit conditions */}
        <Card className="border-rose-500/20 bg-card/40 backdrop-blur-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/15 ring-1 ring-inset ring-rose-500/30">
                  <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                </span>
                <h3 className="text-sm font-semibold">Exit Conditions</h3>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
                  {strategy.exitConditions.length} selected
                </Badge>
              </div>
              {strategy.exitConditions.length === 0 && (
                <span className="text-[10px] text-rose-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> At least 1 required
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {exitFilters.map((f) => (
                <FilterChip
                  key={f.key}
                  filterKey={f.key}
                  active={strategy.exitConditions.includes(f.key)}
                  onToggle={() => toggleExit(f.key)}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Risk params */}
        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-teal-500" />
              <h3 className="text-sm font-semibold">Risk Parameters</h3>
            </div>
            <SliderRow
              label="Stop Loss"
              value={strategy.stopLossPct}
              onChange={(v) =>
                setStrategy((s) => ({ ...s, stopLossPct: v }))
              }
              min={1}
              max={15}
              step={0.5}
              icon={ShieldAlert}
              color="rose"
              description="Hard exit if price drops this % below entry."
            />
            <SliderRow
              label="Take Profit"
              value={strategy.takeProfitPct}
              onChange={(v) =>
                setStrategy((s) => ({ ...s, takeProfitPct: v }))
              }
              min={2}
              max={30}
              step={0.5}
              icon={Target}
              color="emerald"
              description="Hard exit if price rises this % above entry."
            />
            <SliderRow
              label="Position Size"
              value={strategy.positionSizePct}
              onChange={(v) =>
                setStrategy((s) => ({ ...s, positionSizePct: v }))
              }
              min={1}
              max={25}
              step={0.5}
              icon={Layers}
              color="teal"
              description="% of equity allocated per trade."
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onSave}
            className="sm:w-auto gap-2"
          >
            <Save className="h-4 w-4" /> Save Strategy
          </Button>
          <Button
            type="button"
            disabled={!summary.valid}
            onClick={onContinue}
            className={cn(
              'flex-1 sm:flex-none gap-2 font-semibold',
              summary.valid &&
                'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-[0_0_18px_-4px_rgba(16,185,129,0.55)] hover:shadow-[0_0_22px_-4px_rgba(16,185,129,0.7)] hover:scale-[1.02]',
            )}
          >
            Continue to Backtest
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Right preview */}
      <div>
        <LivePreviewCard strategy={strategy} unmappedCount={unmappedCount} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Backtest
// ---------------------------------------------------------------------------

interface BacktestState {
  symbol: string;
  timeframe: Timeframe;
  period: Period;
  result: BacktestResult | null;
  error: string | null;
}

function StepBacktest({
  strategy,
  onBack,
  onContinue,
  onResultSnapshot,
}: {
  strategy: StrategyDefinition;
  onBack: () => void;
  onContinue: () => void;
  onResultSnapshot: (snap: BacktestResult, symbol: string, tf: string, period: string) => void;
}) {
  const [state, setState] = useState<BacktestState>({
    symbol: strategy.universe[0] || 'BTCUSDT',
    timeframe: '1d',
    period: '6m',
    result: null,
    error: null,
  });

  // Pre-compute the rule mapping once.
  const mapping = useMemo(
    () => mapScreenerToBacktest(strategy.entryConditions, strategy.exitConditions),
    [strategy.entryConditions, strategy.exitConditions],
  );

  const runMutation = useMutation({
    mutationFn: async () => {
      const limit = PERIOD_LIMITS[state.period];
      const interval = TF_TO_INTERVAL[state.timeframe];
      const klines = await fetchKlines(state.symbol, interval, limit);
      if (klines.length < 30) {
        throw new Error(
          `Not enough historical data (${klines.length} bars). Try a longer timeframe or period.`,
        );
      }
      const result = runBacktest({
        klines,
        entryRules: mapping.entryRules,
        exitRules: mapping.exitRules,
        stopLossPct: strategy.stopLossPct,
        takeProfitPct: strategy.takeProfitPct,
        initialCapital: 10_000,
        positionSizePct: strategy.positionSizePct,
      });
      return result;
    },
    onSuccess: (result) => {
      setState((s) => ({ ...s, result, error: null }));
      onResultSnapshot(result, state.symbol, state.timeframe, state.period);
      toast.success('Backtest complete', {
        description: `${result.metrics.totalTrades} trades • ${formatPct(result.metrics.totalReturnPct)} return`,
      });
    },
    onError: (err: Error) => {
      setState((s) => ({ ...s, result: null, error: err.message }));
      toast.error('Backtest failed', { description: err.message });
    },
  });

  // Auto-run once on mount (so the user immediately sees results for the
  // default settings).
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    didAutoRun.current = true;
    runMutation.mutate();
  }, []);

  const equityData = useMemo(() => {
    if (!state.result) return [];
    return state.result.equity.map((p, i) => ({
      date: p.date,
      equity: p.value,
      buyHold: state.result!.buyAndHold[i]?.value ?? null,
    }));
  }, [state.result]);

  const isProfit = state.result ? state.result.metrics.totalReturnPct >= 0 : true;

  return (
    <div className="space-y-4">
      {/* Config bar */}
      <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex-1 space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Backtest Asset
            </Label>
            <select
              value={state.symbol}
              onChange={(e) => setState((s) => ({ ...s, symbol: e.target.value, result: null }))}
              className="w-full h-9 rounded-md border border-border/60 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {strategy.universe.length > 0 ? (
                strategy.universe.map((sym) => (
                  <option key={sym} value={sym}>
                    {cleanSymbol(sym)} ({sym})
                  </option>
                ))
              ) : (
                <option value="BTCUSDT">BTC (BTCUSDT)</option>
              )}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Timeframe
            </Label>
            <div className="flex gap-1 rounded-md border border-border/40 bg-background/30 p-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  type="button"
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      timeframe: tf.value,
                      result: null,
                    }))
                  }
                  className={cn(
                    'px-3 py-1.5 text-xs font-mono font-bold rounded transition-all',
                    state.timeframe === tf.value
                      ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-500 ring-1 ring-inset ring-emerald-500/30'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Period
            </Label>
            <div className="flex gap-1 rounded-md border border-border/40 bg-background/30 p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() =>
                    setState((s) => ({ ...s, period: p.value, result: null }))
                  }
                  className={cn(
                    'px-3 py-1.5 text-xs font-mono font-bold rounded transition-all flex flex-col items-center leading-none',
                    state.period === p.value
                      ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-500 ring-1 ring-inset ring-emerald-500/30'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span>{p.label}</span>
                  <span className="text-[8px] font-normal opacity-70 mt-0.5">{p.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-[0_0_16px_-4px_rgba(16,185,129,0.55)]"
          >
            {runMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Backtest
          </Button>
        </CardContent>
      </Card>

      {/* Mapping warning */}
      {mapping.unmapped.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Skipped in backtest:</span>{' '}
            {mapping.unmapped
              .map((k) => FILTER_BY_KEY[k]?.label || k)
              .join(', ')}
            <span className="block text-[10px] text-amber-500/80 mt-0.5">
              These filters don&apos;t have a direct backtest rule equivalent.
              They still apply during the live scan in Step 3.
            </span>
          </div>
        </div>
      )}

      {/* Results */}
      {runMutation.isPending && !state.result && (
        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
              Running backtest against {cleanSymbol(state.symbol)} •{' '}
              {state.timeframe.toUpperCase()} • {state.period.toUpperCase()}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-md" />
              ))}
            </div>
            <Skeleton className="h-[200px] w-full rounded-md" />
          </CardContent>
        </Card>
      )}

      {state.error && !runMutation.isPending && (
        <Card className="border-rose-500/30 bg-rose-500/5 backdrop-blur-sm">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="h-8 w-8 text-rose-500 mx-auto" />
            <div className="text-sm font-semibold text-rose-500">Backtest Error</div>
            <div className="text-xs text-muted-foreground">{state.error}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => runMutation.mutate()}
              className="gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {state.result && !runMutation.isPending && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="space-y-4"
        >
          {/* 4 metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Total Return"
              icon={TrendingUp}
              tone={state.result.metrics.totalReturnPct >= 0 ? 'emerald' : 'rose'}
              value={
                <span
                  className={
                    state.result.metrics.totalReturnPct >= 0
                      ? 'text-emerald-500'
                      : 'text-rose-500'
                  }
                >
                  {formatPct(state.result.metrics.totalReturnPct)}
                </span>
              }
              sub={`$${state.result.metrics.initialEquity.toLocaleString()} → $${state.result.metrics.finalEquity.toLocaleString(
                undefined,
                { maximumFractionDigits: 0 },
              )}`}
            />
            <MetricCard
              label="Win Rate"
              icon={Trophy}
              tone={state.result.metrics.winRate >= 50 ? 'emerald' : 'amber'}
              value={
                <span
                  className={
                    state.result.metrics.winRate >= 50
                      ? 'text-emerald-500'
                      : 'text-amber-500'
                  }
                >
                  {state.result.metrics.winRate.toFixed(1)}%
                </span>
              }
              sub={`${state.result.metrics.totalTrades} trades`}
            />
            <MetricCard
              label="Max Drawdown"
              icon={TrendingDown}
              tone="rose"
              value={
                <span className="text-rose-500">
                  -{state.result.metrics.maxDrawdownPct.toFixed(2)}%
                </span>
              }
              sub="peak-to-trough"
            />
            <MetricCard
              label="Sharpe Ratio"
              icon={Activity}
              tone={
                state.result.metrics.sharpeRatio >= 1
                  ? 'emerald'
                  : state.result.metrics.sharpeRatio >= 0
                  ? 'amber'
                  : 'rose'
              }
              value={
                <span
                  className={
                    state.result.metrics.sharpeRatio >= 1
                      ? 'text-emerald-500'
                      : state.result.metrics.sharpeRatio >= 0
                      ? 'text-amber-500'
                      : 'text-rose-500'
                  }
                >
                  {state.result.metrics.sharpeRatio.toFixed(2)}
                </span>
              }
              sub="annualized"
            />
          </div>

          {/* Equity curve */}
          <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold">Equity Curve</h3>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span
                      className={cn(
                        'inline-block h-2 w-3 rounded-sm',
                        isProfit ? 'bg-emerald-500' : 'bg-rose-500',
                      )}
                    />
                    Strategy
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-0.5 w-3 bg-zinc-400" />
                    Buy &amp; Hold
                  </span>
                </div>
              </div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor={isProfit ? '#10b981' : '#f43f5e'}
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="100%"
                          stopColor={isProfit ? '#10b981' : '#f43f5e'}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: '#71717a' }}
                      tickFormatter={(v) => shortDate(v)}
                      minTickGap={40}
                      stroke="rgba(255,255,255,0.1)"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: '#71717a' }}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                      width={40}
                      stroke="rgba(255,255,255,0.1)"
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'rgba(24, 24, 27, 0.95)',
                        border: '1px solid rgba(63, 63, 70, 0.5)',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      labelFormatter={(v) => shortDate(String(v))}
                      formatter={(value: number, name: string) => [
                        `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                        name === 'equity' ? 'Strategy' : 'Buy & Hold',
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke={isProfit ? '#10b981' : '#f43f5e'}
                      strokeWidth={2}
                      fill="url(#equityFill)"
                      isAnimationActive
                      animationDuration={700}
                    />
                    <Line
                      type="monotone"
                      dataKey="buyHold"
                      stroke="#a1a1aa"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive
                      animationDuration={700}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Trades
                  </div>
                  <div className="font-mono text-sm tabular-nums font-bold">
                    {state.result.metrics.totalTrades}
                  </div>
                </div>
                <div className="rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Avg Hold
                  </div>
                  <div className="font-mono text-sm tabular-nums font-bold">
                    {state.result.metrics.avgHoldDays.toFixed(1)}d
                  </div>
                </div>
                <div className="rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Best / Worst
                  </div>
                  <div className="font-mono text-sm tabular-nums font-bold">
                    <span className="text-emerald-500">
                      +${state.result.metrics.bestTrade.toFixed(0)}
                    </span>{' '}
                    /{' '}
                    <span className="text-rose-500">
                      ${state.result.metrics.worstTrade.toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Trade list (compact) */}
          {state.result.trades.length > 0 && (
            <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FlaskConical className="h-4 w-4 text-teal-500" />
                  <h3 className="text-sm font-semibold">Trade History</h3>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
                    {state.result.trades.length}
                  </Badge>
                </div>
                <div className="max-h-72 overflow-y-auto scrollbar-thin rounded-md border border-border/30">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
                      <tr className="border-b border-border/40">
                        <th className="px-3 py-1.5 text-left text-[9px] font-bold uppercase tracking-wider text-muted-foreground">#</th>
                        <th className="px-3 py-1.5 text-left text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Entry</th>
                        <th className="px-3 py-1.5 text-left text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Exit</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Entry $</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Exit $</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Hold</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-bold uppercase tracking-wider text-muted-foreground">P&amp;L</th>
                        <th className="px-3 py-1.5 text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.result.trades.map((t) => (
                        <tr
                          key={t.id}
                          className="border-b border-border/20 hover:bg-emerald-500/[0.04] transition-colors"
                        >
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{t.id}</td>
                          <td className="px-3 py-1.5 font-mono">{shortDate(t.entryDate)}</td>
                          <td className="px-3 py-1.5 font-mono">{shortDate(t.exitDate)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">${formatPrice(t.entryPrice)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">${formatPrice(t.exitPrice)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">{t.holdDays}d</td>
                          <td
                            className={cn(
                              'px-3 py-1.5 text-right font-mono tabular-nums font-bold',
                              t.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500',
                            )}
                          >
                            {formatPct(t.pnlPct)}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                'h-4 px-1 text-[9px]',
                                t.exitReason === 'Take Profit' &&
                                  'border-emerald-500/40 text-emerald-500',
                                t.exitReason === 'Stop Loss' &&
                                  'border-rose-500/40 text-rose-500',
                                t.exitReason === 'Signal Exit' &&
                                  'border-zinc-500/40 text-zinc-400',
                              )}
                            >
                              {t.exitReason}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back to Strategy
            </Button>
            <Button
              type="button"
              onClick={onContinue}
              className="flex-1 gap-2 font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-[0_0_18px_-4px_rgba(16,185,129,0.55)] hover:shadow-[0_0_22px_-4px_rgba(16,185,129,0.7)] hover:scale-[1.01]"
            >
              Continue to Deploy
              <Rocket className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Deploy
// ---------------------------------------------------------------------------

interface DeployedAlert {
  symbol: string;
  condition: 'above' | 'below';
  targetPrice: number;
  alertId?: string;
  status: 'pending' | 'success' | 'error';
  error?: string;
}

function StepDeploy({
  strategy,
  onBack,
  onFinish,
}: {
  strategy: StrategyDefinition;
  onBack: () => void;
  onFinish: () => void;
}) {
  const [scanRan, setScanRan] = useState(false);
  const [channel, setChannel] = useState<'dashboard' | 'telegram' | 'both'>('dashboard');
  const [note, setNote] = useState('');
  const [deployed, setDeployed] = useState<DeployedAlert[]>([]);
  const [perRowChannel, setPerRowChannel] = useState<Record<string, 'dashboard' | 'telegram' | 'both'>>({});

  const scanMutation = useMutation({
    mutationFn: () =>
      runScreenerScan(strategy.entryConditions, strategy.universe),
    onSuccess: () => {
      setScanRan(true);
      toast.success('Scan complete', {
        description: `${strategy.entryConditions.length} entry filters applied to ${strategy.universe.length} assets`,
      });
    },
    onError: (err: Error) => {
      toast.error('Scan failed', { description: err.message });
    },
  });

  const matches = scanMutation.data?.results ?? [];
  const stats = scanMutation.data?.stats;

  // Auto-run scan on mount.
  const didAutoScan = useRef(false);
  useEffect(() => {
    if (didAutoScan.current) return;
    didAutoScan.current = true;
    scanMutation.mutate();
  }, []);

  const deployOne = useCallback(
    async (m: ScreenerMatch): Promise<DeployedAlert[]> => {
      const plans = buildDeployPlan(
        m.symbol,
        m.price,
        strategy.stopLossPct,
        strategy.takeProfitPct,
        m.conviction,
        m.matchedFilters,
      );
      const ch = perRowChannel[m.symbol] || channel;
      const noteText = note.trim() || `${strategy.name} — ${m.matchedFilters
        .map((k) => FILTER_BY_KEY[k]?.label || k)
        .slice(0, 3)
        .join(', ')}`;
      const results: DeployedAlert[] = [];
      for (const p of plans) {
        try {
          const created = await createPriceAlert({
            assetSymbol: p.symbol,
            condition: p.condition,
            targetPrice: p.targetPrice,
            channel: ch,
            note: noteText,
          });
          results.push({
            symbol: p.symbol,
            condition: p.condition,
            targetPrice: p.targetPrice,
            alertId: created.id,
            status: 'success',
          });
        } catch (e) {
          results.push({
            symbol: p.symbol,
            condition: p.condition,
            targetPrice: p.targetPrice,
            status: 'error',
            error: e instanceof Error ? e.message : 'failed',
          });
        }
      }
      return results;
    },
    [perRowChannel, channel, note, strategy],
  );

  const deployOneMutation = useMutation({
    mutationFn: (m: ScreenerMatch) => deployOne(m),
    onSuccess: (results, m) => {
      setDeployed((prev) => {
        const filtered = prev.filter(
          (d) => !(d.symbol === m.symbol),
        );
        return [...filtered, ...results];
      });
      const okCount = results.filter((r) => r.status === 'success').length;
      if (okCount > 0) {
        toast.success(`Alert created for ${cleanSymbol(m.symbol)}`, {
          description: `${okCount} alert${okCount > 1 ? 's' : ''} • ${channel}`,
        });
      } else {
        toast.error(`Failed to deploy ${cleanSymbol(m.symbol)}`, {
          description: results[0]?.error || 'Unknown error',
        });
      }
    },
    onError: (err: Error) => {
      toast.error('Deploy failed', { description: err.message });
    },
  });

  const bulkDeployMutation = useMutation({
    mutationFn: async () => {
      const all: DeployedAlert[] = [];
      for (const m of matches) {
        const results = await deployOne(m);
        all.push(...results);
      }
      return all;
    },
    onSuccess: (all) => {
      setDeployed(all);
      const ok = all.filter((r) => r.status === 'success').length;
      const fail = all.filter((r) => r.status === 'error').length;
      if (fail === 0) {
        toast.success('Bulk deploy complete', {
          description: `${ok} alerts created across ${matches.length} assets.`,
        });
      } else {
        toast.warning('Bulk deploy partial', {
          description: `${ok} succeeded, ${fail} failed.`,
        });
      }
    },
    onError: (err: Error) => {
      toast.error('Bulk deploy failed', { description: err.message });
    },
  });

  const deployedCount = deployed.filter((d) => d.status === 'success').length;
  const deployedSymbols = new Set(deployed.filter((d) => d.status === 'success').map((d) => d.symbol));

  return (
    <div className="space-y-4">
      {/* Deploy config */}
      <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold">Deploy Configuration</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Default Channel
              </Label>
              <div className="flex gap-1 rounded-md border border-border/40 bg-background/30 p-1">
                {(['dashboard', 'telegram', 'both'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChannel(c)}
                    className={cn(
                      'flex-1 px-3 py-1.5 text-xs font-mono font-bold rounded transition-all capitalize',
                      channel === c
                        ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-500 ring-1 ring-inset ring-emerald-500/30'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="deploy-note"
                className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                Note (optional)
              </Label>
              <Input
                id="deploy-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={`Default: "<strategy name> — <matched filters>"`}
                className="h-9 text-xs"
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              className="gap-2"
            >
              {scanMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Scan Now
            </Button>
            <Button
              type="button"
              onClick={() => bulkDeployMutation.mutate()}
              disabled={
                bulkDeployMutation.isPending ||
                matches.length === 0
              }
              className="flex-1 gap-2 font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-[0_0_18px_-4px_rgba(16,185,129,0.55)] hover:shadow-[0_0_22px_-4px_rgba(16,185,129,0.7)] hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
            >
              {bulkDeployMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Create Alerts for All Matches ({matches.length})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Scan stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-md border border-border/40 bg-card/30 px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Scanned
            </div>
            <div className="font-mono text-sm font-bold">{stats.scanned}</div>
          </div>
          <div className="rounded-md border border-border/40 bg-card/30 px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Candidates
            </div>
            <div className="font-mono text-sm font-bold">{stats.candidates}</div>
          </div>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-500">
              Matches (Universe)
            </div>
            <div className="font-mono text-sm font-bold text-emerald-500">
              {matches.length}
            </div>
          </div>
          <div className="rounded-md border border-border/40 bg-card/30 px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Deployed
            </div>
            <div className="font-mono text-sm font-bold text-emerald-500">
              {deployedCount}
            </div>
          </div>
        </div>
      )}

      {/* Matching assets table */}
      <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
        <CardContent className="p-0">
          <div className="flex items-center justify-between p-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-500" />
              <h3 className="text-sm font-semibold">Matching Assets</h3>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
                {matches.length}
              </Badge>
            </div>
            {matches.length > 0 && (
              <div className="text-[10px] text-muted-foreground hidden sm:block">
                All entry conditions met • sorted by conviction
              </div>
            )}
          </div>

          {scanMutation.isPending && !scanMutation.data && (
            <div className="p-6 space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {!scanMutation.isPending && matches.length === 0 && scanRan && (
            <div className="p-8 text-center space-y-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 ring-1 ring-inset ring-amber-500/30">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
              </div>
              <div className="text-sm font-semibold">No assets match all entry conditions right now</div>
              <div className="text-xs text-muted-foreground max-w-md mx-auto">
                Try broadening your filters, expanding your universe, or scanning
                again later — the market changes constantly.
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => scanMutation.mutate()}
                className="gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Re-scan
              </Button>
            </div>
          )}

          {matches.length > 0 && (
            <div className="max-h-[480px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                  <tr className="border-b border-border/40">
                    <th className="px-3 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Asset
                    </th>
                    <th className="px-3 py-2 text-right text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Price
                    </th>
                    <th className="px-3 py-2 text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Matches
                    </th>
                    <th className="px-3 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Conviction
                    </th>
                    <th className="px-3 py-2 text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Channel
                    </th>
                    <th className="px-3 py-2 text-right text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => {
                    const isDeployed = deployedSymbols.has(m.symbol);
                    const ch = perRowChannel[m.symbol] || channel;
                    return (
                      <motion.tr
                        key={m.symbol}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.025, 0.5), duration: 0.3 }}
                        className={cn(
                          'group border-b border-border/30 transition-all',
                          'hover:bg-emerald-500/[0.04] hover:shadow-[inset_3px_0_0_0_rgba(16,185,129,0.6)]',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/crypto/${m.symbol}`}
                            className="flex items-center gap-2"
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 ring-1 ring-inset ring-emerald-500/20 text-[10px] font-bold text-emerald-500">
                              {m.symbol.slice(0, 2)}
                            </span>
                            <span className="flex flex-col leading-tight">
                              <span className="font-mono text-xs font-semibold text-foreground group-hover:text-emerald-500 transition-colors">
                                {cleanSymbol(m.symbol)}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {m.name}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="font-mono text-xs tabular-nums">
                            ${formatPrice(m.price)}
                          </div>
                          <div
                            className={cn(
                              'text-[10px] font-mono tabular-nums',
                              m.changePct >= 0 ? 'text-emerald-500' : 'text-rose-500',
                            )}
                          >
                            {formatPct(m.changePct)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-center">
                            <SignalDots matched={m.matchedFilters} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <ConvictionBar score={m.conviction} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-center">
                            <select
                              value={ch}
                              onChange={(e) =>
                                setPerRowChannel((prev) => ({
                                  ...prev,
                                  [m.symbol]: e.target.value as 'dashboard' | 'telegram' | 'both',
                                }))
                              }
                              className="h-7 rounded border border-border/40 bg-background/40 px-1.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            >
                              <option value="dashboard">dash</option>
                              <option value="telegram">tg</option>
                              <option value="both">both</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {isDeployed ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 h-6 gap-1"
                            >
                              <CheckCheck className="h-3 w-3" /> Deployed
                            </Badge>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={deployOneMutation.isPending}
                              onClick={() => deployOneMutation.mutate(m)}
                              className="h-7 text-[11px] gap-1 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                            >
                              {deployOneMutation.isPending &&
                              deployOneMutation.variables?.symbol === m.symbol ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <BellRing className="h-3 w-3" />
                              )}
                              Create
                            </Button>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deployed alerts summary */}
      {deployed.length > 0 && (
        <Card className="border-emerald-500/30 bg-emerald-500/[0.03] backdrop-blur-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <h3 className="text-sm font-semibold">Deployed Alerts</h3>
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] font-mono border-emerald-500/40 text-emerald-500"
              >
                {deployedCount} active
              </Badge>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
              {deployed.map((d, i) => (
                <div
                  key={`${d.symbol}-${d.condition}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-background/30 px-3 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{cleanSymbol(d.symbol)}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-4 px-1 text-[9px]',
                        d.condition === 'above'
                          ? 'border-emerald-500/40 text-emerald-500'
                          : 'border-rose-500/40 text-rose-500',
                      )}
                    >
                      {d.condition === 'above' ? 'TP' : 'SL'} @ ${formatPrice(d.targetPrice)}
                    </Badge>
                    {d.status === 'error' && (
                      <span className="text-[10px] text-rose-500">{d.error}</span>
                    )}
                  </div>
                  {d.alertId && (
                    <Check className="h-3 w-3 text-emerald-500" />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                <Link href="/notifications">
                  <BellRing className="h-3 w-3" /> View Notifications
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                <Link href="/price-alerts">
                  <Target className="h-3 w-3" /> Manage Price Alerts
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to Backtest
        </Button>
        <Button
          type="button"
          onClick={onFinish}
          className="flex-1 gap-2 font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-[0_0_18px_-4px_rgba(16,185,129,0.55)] hover:shadow-[0_0_22px_-4px_rgba(16,185,129,0.7)] hover:scale-[1.01]"
        >
          <Check className="h-4 w-4" /> Finish
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

export function StrategyBuilderClient() {
  const [step, setStep] = useState<Step>(1);
  const [strategy, setStrategyState] = useState<StrategyDefinition>(() =>
    createBlankStrategy(),
  );
  const [saved, setSaved] = useState<StrategyDefinition[]>(() => loadStrategies());
  const [direction, setDirection] = useState<1 | -1>(1);

  const setStrategy = useCallback(
    (updater: (s: StrategyDefinition) => StrategyDefinition) => {
      setStrategyState((prev) => updater(prev));
    },
    [],
  );

  // Persist to saved list whenever the strategy changes (debounced via effect).
  const saveStrategy = useCallback(() => {
    setSaved((prev) => {
      const idx = prev.findIndex((s) => s.id === strategy.id);
      const updated: StrategyDefinition = {
        ...strategy,
        updatedAt: new Date().toISOString(),
      };
      const next =
        idx >= 0
          ? [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          : [updated, ...prev];
      saveStrategies(next);
      return next;
    });
    toast.success('Strategy saved', {
      description: `"${strategy.name}" stored locally.`,
    });
  }, [strategy]);

  const persistSnapshot = useCallback(
    (
      result: BacktestResult,
      symbol: string,
      tf: string,
      period: string,
    ) => {
      setStrategyState((prev) => {
        const next: StrategyDefinition = {
          ...prev,
          lastBacktest: {
            symbol,
            timeframe: tf,
            period,
            totalReturnPct: result.metrics.totalReturnPct,
            winRate: result.metrics.winRate,
            maxDrawdownPct: result.metrics.maxDrawdownPct,
            sharpeRatio: result.metrics.sharpeRatio,
            totalTrades: result.metrics.totalTrades,
            avgHoldDays: result.metrics.avgHoldDays,
            ranAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
        // Also update saved list so the snapshot is preserved.
        setSaved((prevSaved) => {
          const idx = prevSaved.findIndex((s) => s.id === next.id);
          if (idx < 0) return prevSaved;
          const updated = [...prevSaved];
          updated[idx] = next;
          saveStrategies(updated);
          return updated;
        });
        return next;
      });
    },
    [],
  );

  const loadStrategy = useCallback((s: StrategyDefinition) => {
    setStrategyState(s);
    setStep(1);
    setDirection(1);
    toast.success(`Loaded "${s.name}"`, {
      description: `${s.entryConditions.length} entries • ${s.exitConditions.length} exits`,
    });
  }, []);

  const deleteStrategy = useCallback(
    (id: string) => {
      setSaved((prev) => {
        const next = prev.filter((s) => s.id !== id);
        saveStrategies(next);
        return next;
      });
      toast.success('Strategy deleted');
    },
    [],
  );

  const newStrategy = useCallback(() => {
    const blank = createBlankStrategy();
    setStrategyState(blank);
    setStep(1);
    setDirection(1);
    toast.success('New strategy', {
      description: 'Blank template ready to configure.',
    });
  }, []);

  const goToStep = useCallback(
    (s: Step) => {
      const summary = buildStrategySummary(strategy);
      // Step 2 + 3 require a valid strategy.
      if (s > 1 && !summary.valid) {
        toast.error('Strategy not valid', {
          description: summary.errors[0] || 'Fix the issues in Step 1.',
        });
        return;
      }
      setDirection(s > step ? 1 : -1);
      setStep(s);
    },
    [strategy, step],
  );

  const unmappedCount = useMemo(() => {
    const m = mapScreenerToBacktest(
      strategy.entryConditions,
      strategy.exitConditions,
    );
    return m.unmapped.length;
  }, [strategy.entryConditions, strategy.exitConditions]);

  const finish = useCallback(() => {
    // Save final state and offer to start a new strategy.
    saveStrategy();
    toast.success('Strategy workflow complete!', {
      description: 'Saved. You can start a new strategy or revisit later.',
      duration: 5000,
    });
  }, [saveStrategy]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-400/30">
              <span
                aria-hidden
                className="absolute inset-0 rounded-xl bg-emerald-400/40 blur-md opacity-50"
              />
              <Workflow className="relative h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                Strategy Builder
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 h-5 text-[10px]"
                >
                  <Sparkles className="h-2.5 w-2.5 mr-0.5" /> Workflow
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground">
                Define → Backtest → Deploy. Screener filters → historical performance → live alerts.
              </p>
            </div>
          </div>
        </div>

        {/* Saved strategies */}
        <SavedStrategiesBar
          strategies={saved}
          activeId={strategy.id}
          onLoad={loadStrategy}
          onDelete={deleteStrategy}
          onNew={newStrategy}
        />

        {/* Stepper */}
        <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-5">
            <Stepper
              current={step}
              onNavigate={goToStep}
              canNavigate={(s) => {
                if (s === 1) return true;
                return buildStrategySummary(strategy).valid;
              }}
            />
          </CardContent>
        </Card>

        {/* Step content */}
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            initial={{ opacity: 0, x: direction > 0 ? 24 : -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction > 0 ? -24 : 24 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            {step === 1 && (
              <StepDefine
                strategy={strategy}
                setStrategy={setStrategy}
                onContinue={() => goToStep(2)}
                onSave={saveStrategy}
                unmappedCount={unmappedCount}
              />
            )}
            {step === 2 && (
              <StepBacktest
                strategy={strategy}
                onBack={() => goToStep(1)}
                onContinue={() => goToStep(3)}
                onResultSnapshot={persistSnapshot}
              />
            )}
            {step === 3 && (
              <StepDeploy
                strategy={strategy}
                onBack={() => goToStep(2)}
                onFinish={finish}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}
