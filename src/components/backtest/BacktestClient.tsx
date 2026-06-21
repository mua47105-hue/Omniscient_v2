'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  FlaskConical,
  Play,
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  Target,
  ShieldAlert,
  Gauge,
  ChevronDown,
  Check,
  Info,
  AlertCircle,
  ArrowUpDown,
  Trophy,
  Calendar,
  Clock,
  DollarSign,
  BarChart3,
  Sparkles,
  Settings2,
} from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import type { ApiResult, Kline, Ticker } from '@/lib/types';
import {
  ENTRY_RULES,
  EXIT_RULES,
  PRESET_STRATEGIES,
  runBacktest,
  type BacktestResult,
  type Trade,
  type Rule,
} from '@/lib/analysis/backtest';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Timeframe = '1d' | '4h' | '1h';
type Period = '3m' | '6m' | '1y';

interface PersistedState {
  symbol: string;
  timeframe: Timeframe;
  period: Period;
  initialCapital: number;
  positionSizePct: number;
  entryRules: string[];
  exitRules: string[];
  stopLossPct: number;
  takeProfitPct: number;
}

const STORAGE_KEY = 'omniscient.backtest.v1';

const DEFAULT_STATE: PersistedState = {
  symbol: 'BTCUSDT',
  timeframe: '1d',
  period: '6m',
  initialCapital: 10000,
  positionSizePct: 10,
  entryRules: ['rsi_lt_30', 'bb_lower_touch'],
  exitRules: ['rsi_gt_70', 'bb_upper_touch', 'stop_loss', 'take_profit'],
  stopLossPct: 5,
  takeProfitPct: 10,
};

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

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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
  // Sort by quote volume desc so the most liquid pairs are first.
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

// ---------------------------------------------------------------------------
// Persistence hook
// ---------------------------------------------------------------------------

function usePersistedState(): [PersistedState, (patch: Partial<PersistedState>) => void] {
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE);

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState({ ...DEFAULT_STATE, ...parsed });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const update = useCallback((patch: Partial<PersistedState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return [state, update];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtUsd(v: number, decimals = 2): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtNum(v: number, decimals = 2): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(v: number, decimals = 2): string {
  if (!isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)}%`;
}

function fmtPrice(v: number): string {
  if (!isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toFixed(6);
}

function fmtCompactUsd(v: number): string {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtDateShort(iso: string): string {
  // iso = "YYYY-MM-DD"
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTH_NAMES[m - 1]} ${d}`;
}

function fmtDateAxis(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return iso;
  return `${MONTH_NAMES[m - 1]} '${String(y).slice(2)}`;
}

function cleanSymbol(sym: string): string {
  return sym.replace(/USDT$/, '').replace(/=X$/, '').replace(/-USD$/, '');
}

// ---------------------------------------------------------------------------
// Rule chip (toggle)
// ---------------------------------------------------------------------------

function RuleChip({
  rule,
  active,
  onToggle,
  accent = 'emerald',
}: {
  rule: Rule;
  active: boolean;
  onToggle: () => void;
  accent?: 'emerald' | 'rose';
}) {
  const Icon = rule.icon;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={active}
            className={cn(
              'group relative flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all duration-200',
              'outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              active && accent === 'emerald'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.2),0_4px_12px_-4px_rgba(16,185,129,0.35)]'
                : active && accent === 'rose'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 shadow-[0_0_0_1px_rgba(244,63,94,0.2),0_4px_12px_-4px_rgba(244,63,94,0.35)]'
                  : 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:border-border hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
                active && accent === 'emerald'
                  ? 'bg-emerald-500/20 text-emerald-500'
                  : active && accent === 'rose'
                    ? 'bg-rose-500/20 text-rose-500'
                    : 'bg-background/60 text-muted-foreground group-hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="flex-1 truncate">{rule.label}</span>
            {active && (
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                  accent === 'emerald'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-rose-500 text-white',
                )}
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="max-w-[260px] text-xs leading-relaxed"
        >
          {rule.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

type StatAccent = 'emerald' | 'rose' | 'amber' | 'teal' | 'zinc';

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  delay = 0,
  loading = false,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: StatAccent;
  delay?: number;
  loading?: boolean;
}) {
  const accentMap: Record<StatAccent, { ring: string; icon: string; tint: string; glow: string }> = {
    emerald: {
      ring: 'hover:border-emerald-500/40',
      icon: 'bg-emerald-500/15 text-emerald-500',
      tint: 'from-emerald-500/[0.08] to-transparent',
      glow: 'hover:shadow-emerald-500/15',
    },
    rose: {
      ring: 'hover:border-rose-500/40',
      icon: 'bg-rose-500/15 text-rose-500',
      tint: 'from-rose-500/[0.08] to-transparent',
      glow: 'hover:shadow-rose-500/15',
    },
    amber: {
      ring: 'hover:border-amber-500/40',
      icon: 'bg-amber-500/15 text-amber-500',
      tint: 'from-amber-500/[0.08] to-transparent',
      glow: 'hover:shadow-amber-500/15',
    },
    teal: {
      ring: 'hover:border-teal-500/40',
      icon: 'bg-teal-500/15 text-teal-500',
      tint: 'from-teal-500/[0.08] to-transparent',
      glow: 'hover:shadow-teal-500/15',
    },
    zinc: {
      ring: 'hover:border-zinc-500/40',
      icon: 'bg-zinc-500/15 text-zinc-300',
      tint: 'from-zinc-500/[0.06] to-transparent',
      glow: 'hover:shadow-zinc-500/15',
    },
  };
  const a = accentMap[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-lg',
        a.ring,
        a.glow,
      )}
    >
      <div
        aria-hidden
        className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60', a.tint)}
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {value}
            </div>
          )}
          {sub && !loading && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
          )}
        </div>
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110',
            a.icon,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Equity curve chart
// ---------------------------------------------------------------------------

function EquityCurveChart({ result }: { result: BacktestResult }) {
  const profitable = result.metrics.totalReturnPct >= 0;
  const lineColor = profitable ? '#10b981' : '#f43f5e';

  // Merge equity + buy & hold by date for recharts
  const data = useMemo(() => {
    const map = new Map<string, { date: string; equity: number; buyHold: number }>();
    for (const p of result.equity) {
      map.set(p.date, { date: p.date, equity: p.value, buyHold: 0 });
    }
    for (const p of result.buyAndHold) {
      const cur = map.get(p.date);
      if (cur) cur.buyHold = p.value;
      else map.set(p.date, { date: p.date, equity: 0, buyHold: p.value });
    }
    return Array.from(map.values());
  }, [result]);

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
              <stop offset="60%" stopColor={lineColor} stopOpacity={0.12} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(113, 113, 122, 0.15)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDateAxis}
            tick={{ fill: 'rgb(161, 161, 170)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(113, 113, 122, 0.2)' }}
            minTickGap={32}
          />
          <YAxis
            tick={{ fill: 'rgb(161, 161, 170)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmtCompactUsd(v)}
            width={56}
            domain={['auto', 'auto']}
          />
          <RechartsTooltip
            content={({ active: a, payload }) => {
              if (!a || !payload || payload.length === 0) return null;
              const p = payload[0].payload as { date: string; equity: number; buyHold: number };
              const diff = p.equity - p.buyHold;
              const diffColor = diff >= 0 ? 'text-emerald-500' : 'text-rose-500';
              return (
                <div className="rounded-lg border border-border/70 bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm">
                  <div className="font-mono font-semibold text-foreground">{p.date}</div>
                  <Separator className="my-1.5" />
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: lineColor }}
                        />
                        Strategy
                      </span>
                      <span className="font-mono tabular-nums text-foreground">
                        {fmtUsd(p.equity)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" />
                        Buy &amp; Hold
                      </span>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {fmtUsd(p.buyHold)}
                      </span>
                    </div>
                    <Separator className="my-1" />
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Difference</span>
                      <span className={cn('font-mono tabular-nums font-semibold', diffColor)}>
                        {diff >= 0 ? '+' : ''}{fmtUsd(diff)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke={lineColor}
            strokeWidth={2}
            fill="url(#equityFill)"
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
            dot={false}
            activeDot={{ r: 4, fill: lineColor, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey="buyHold"
            stroke="rgb(161, 161, 170)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive
            animationDuration={900}
            opacity={0.7}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: lineColor }}
          />
          <span>Strategy Equity</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full bg-zinc-400" />
          <span>Buy &amp; Hold Benchmark</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawdown chart
// ---------------------------------------------------------------------------

function DrawdownChart({ result }: { result: BacktestResult }) {
  const data = useMemo(
    () => result.drawdown.map((d) => ({ date: d.date, drawdown: d.drawdownPct })),
    [result],
  );

  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.35} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(113, 113, 122, 0.15)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDateAxis}
            tick={{ fill: 'rgb(161, 161, 170)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(113, 113, 122, 0.2)' }}
            minTickGap={32}
          />
          <YAxis
            tick={{ fill: 'rgb(161, 161, 170)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            width={40}
          />
          <RechartsTooltip
            content={({ active: a, payload }) => {
              if (!a || !payload || payload.length === 0) return null;
              const p = payload[0].payload as { date: string; drawdown: number };
              return (
                <div className="rounded-lg border border-border/70 bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm">
                  <div className="font-mono font-semibold text-foreground">{p.date}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-muted-foreground">Drawdown</span>
                    <span className="font-mono tabular-nums font-semibold text-rose-500">
                      {p.drawdown.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="drawdown"
            stroke="#f43f5e"
            strokeWidth={1.5}
            fill="url(#ddFill)"
            isAnimationActive
            animationDuration={900}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly returns heatmap
// ---------------------------------------------------------------------------

function MonthlyHeatmap({ result }: { result: BacktestResult }) {
  // Group by year → array of 12 month cells (null if missing)
  const years = useMemo(() => {
    const byYear = new Map<number, Map<number, { returnPct: number; trades: number }>>();
    for (const m of result.monthlyReturns) {
      if (!byYear.has(m.year)) byYear.set(m.year, new Map());
      byYear.get(m.year)!.set(m.month, { returnPct: m.returnPct, trades: m.trades });
    }
    return Array.from(byYear.keys()).sort((a, b) => a - b).map((year) => ({
      year,
      months: byYear.get(year)!,
    }));
  }, [result]);

  function cellStyle(returnPct: number): React.CSSProperties {
    // Color intensity by magnitude.
    const clamped = Math.max(-15, Math.min(15, returnPct));
    const intensity = Math.min(Math.abs(clamped) / 10, 1); // 0..1 from 0..10%
    if (returnPct > 0) {
      // emerald
      return {
        backgroundColor: `rgba(16, 185, 129, ${0.12 + intensity * 0.55})`,
        color: intensity > 0.5 ? '#061410' : '#34d399',
      };
    } else if (returnPct < 0) {
      // rose
      return {
        backgroundColor: `rgba(244, 63, 94, ${0.12 + intensity * 0.55})`,
        color: intensity > 0.5 ? '#1a0509' : '#fb7185',
      };
    }
    return { backgroundColor: 'rgba(63, 63, 70, 0.18)', color: 'rgb(161, 161, 170)' };
  }

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="min-w-[640px]">
        {/* Header row: month names */}
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: '52px repeat(12, minmax(0, 1fr))' }}
        >
          <div />
          {MONTH_NAMES.map((m) => (
            <div
              key={m}
              className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {m}
            </div>
          ))}
        </div>
        {/* Year rows */}
        <div className="mt-1.5 space-y-1.5">
          {years.map(({ year, months }) => (
            <div
              key={year}
              className="grid gap-1.5"
              style={{ gridTemplateColumns: '52px repeat(12, minmax(0, 1fr))' }}
            >
              <div className="flex items-center justify-end pr-1 text-xs font-semibold tabular-nums text-muted-foreground">
                {year}
              </div>
              {Array.from({ length: 12 }, (_, m) => {
                const cell = months.get(m);
                if (!cell) {
                  return (
                    <div
                      key={m}
                      className="flex aspect-[2/1] items-center justify-center rounded-md border border-border/30 bg-muted/10 text-[10px] text-muted-foreground/30"
                    >
                      —
                    </div>
                  );
                }
                const style = cellStyle(cell.returnPct);
                return (
                  <TooltipProvider key={m} delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className="group relative flex aspect-[2/1] cursor-default items-center justify-center rounded-md border border-border/30 font-mono text-[10px] font-semibold tabular-nums transition-transform duration-150 hover:scale-105 hover:border-border/60"
                          style={style}
                        >
                          {cell.returnPct > 0 ? '+' : ''}
                          {cell.returnPct.toFixed(1)}%
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <div className="font-semibold">
                          {MONTH_NAMES_FULL[m]} {year}
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          Return:{' '}
                          <span
                            className={cn(
                              'font-mono font-semibold',
                              cell.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400',
                            )}
                          >
                            {cell.returnPct > 0 ? '+' : ''}
                            {cell.returnPct.toFixed(2)}%
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          Trades closed: <span className="font-mono">{cell.trades}</span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-6 rounded-sm"
              style={{ background: 'linear-gradient(90deg, rgba(244,63,94,0.18), rgba(244,63,94,0.7))' }}
            />
            Loss
          </span>
          <span className="flex items-center gap-1.5">
            Flat
            <span className="inline-block h-2.5 w-6 rounded-sm bg-muted/30" />
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-6 rounded-sm"
              style={{ background: 'linear-gradient(90deg, rgba(16,185,129,0.18), rgba(16,185,129,0.7))' }}
            />
            Gain
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trade table
// ---------------------------------------------------------------------------

type SortKey = 'entryDate' | 'pnl' | 'exitDate' | 'holdDays' | 'pnlPct';
type SortDir = 'asc' | 'desc';

function exitReasonBadge(reason: Trade['exitReason']) {
  switch (reason) {
    case 'Stop Loss':
      return (
        <Badge className="gap-1 border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20">
          <ShieldAlert className="h-3 w-3" />
          Stop Loss
        </Badge>
      );
    case 'Take Profit':
      return (
        <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">
          <Trophy className="h-3 w-3" />
          Take Profit
        </Badge>
      );
    case 'Signal Exit':
      return (
        <Badge className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20">
          <Activity className="h-3 w-3" />
          Signal
        </Badge>
      );
  }
}

function SortHeader({
  label,
  k,
  align = 'left',
  active,
  sortDir,
  onToggle,
}: {
  label: string;
  k: SortKey;
  align?: 'left' | 'right' | 'center';
  active: boolean;
  sortDir: SortDir;
  onToggle: (k: SortKey) => void;
}) {
  void sortDir;
  return (
    <button
      type="button"
      onClick={() => onToggle(k)}
      className={cn(
        'group inline-flex items-center gap-1 transition-colors hover:text-foreground',
        align === 'right' && 'flex-row-reverse',
        align === 'center' && 'justify-center',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
      <ArrowUpDown
        className={cn(
          'h-3 w-3 transition-opacity',
          active ? 'opacity-100 text-emerald-500' : 'opacity-30 group-hover:opacity-60',
        )}
      />
    </button>
  );
}

function TradeTable({ trades }: { trades: Trade[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('entryDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    const arr = [...trades];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'entryDate':
          cmp = a.entryDate.localeCompare(b.entryDate);
          break;
        case 'exitDate':
          cmp = a.exitDate.localeCompare(b.exitDate);
          break;
        case 'pnl':
          cmp = a.pnl - b.pnl;
          break;
        case 'pnlPct':
          cmp = a.pnlPct - b.pnlPct;
          break;
        case 'holdDays':
          cmp = a.holdDays - b.holdDays;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [trades, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'pnl' || k === 'pnlPct' ? 'desc' : 'asc');
    }
  }

  if (trades.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No trades were generated. Try adjusting your entry/exit rules.
      </div>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto scrollbar-thin rounded-lg border border-border/40">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide">
            <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">#</th>
            <th className="px-3 py-2.5 text-left font-semibold">
              <SortHeader label="Entry Date" k="entryDate" active={sortKey === 'entryDate'} sortDir={sortDir} onToggle={toggleSort} />
            </th>
            <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Entry Price</th>
            <th className="px-3 py-2.5 text-left font-semibold">
              <SortHeader label="Exit Date" k="exitDate" active={sortKey === 'exitDate'} sortDir={sortDir} onToggle={toggleSort} />
            </th>
            <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Exit Price</th>
            <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground">Side</th>
            <th className="px-3 py-2.5 text-right font-semibold">
              <SortHeader label="P&amp;L ($)" k="pnl" align="right" active={sortKey === 'pnl'} sortDir={sortDir} onToggle={toggleSort} />
            </th>
            <th className="px-3 py-2.5 text-right font-semibold">
              <SortHeader label="P&amp;L (%)" k="pnlPct" align="right" active={sortKey === 'pnlPct'} sortDir={sortDir} onToggle={toggleSort} />
            </th>
            <th className="px-3 py-2.5 text-right font-semibold">
              <SortHeader label="Hold" k="holdDays" align="right" active={sortKey === 'holdDays'} sortDir={sortDir} onToggle={toggleSort} />
            </th>
            <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground">Exit Reason</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, idx) => {
            const positive = t.pnl > 0;
            return (
              <tr
                key={t.id}
                className={cn(
                  'group border-b border-border/30 transition-colors hover:bg-emerald-500/[0.04]',
                  idx % 2 === 1 && 'bg-muted/20',
                )}
              >
                <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {t.id}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-foreground">
                  {t.entryDate}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-foreground">
                  ${fmtPrice(t.entryPrice)}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-foreground">
                  {t.exitDate}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-foreground">
                  ${fmtPrice(t.exitPrice)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/5 text-[10px] text-emerald-500"
                  >
                    LONG
                  </Badge>
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-right font-mono text-xs font-bold tabular-nums',
                    positive ? 'text-emerald-500' : 'text-rose-500',
                  )}
                >
                  {positive ? '+' : ''}{fmtUsd(t.pnl)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-right font-mono text-xs font-semibold tabular-nums',
                    positive ? 'text-emerald-500' : 'text-rose-500',
                  )}
                >
                  {positive ? '+' : ''}{t.pnlPct.toFixed(2)}%
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {t.holdDays}d
                </td>
                <td className="px-3 py-2.5 text-center">{exitReasonBadge(t.exitReason)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton stat row
// ---------------------------------------------------------------------------

function StatCardSkeletonRow() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="border-border/50 bg-card/50 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onPreset }: { onPreset: (key: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="relative overflow-hidden border-dashed border-border/60 bg-card/30 backdrop-blur-sm">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.08),transparent_60%)] pointer-events-none"
        />
        <CardContent className="relative flex flex-col items-center justify-center gap-5 px-6 py-16 text-center">
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-0 rounded-2xl bg-emerald-500/30 blur-xl"
            />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
              <FlaskConical className="h-8 w-8 text-emerald-500" />
            </div>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-semibold tracking-tight">
              Configure a strategy and run your first backtest
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Pick an asset, choose your entry &amp; exit rules, then click{' '}
              <span className="font-medium text-foreground">Run Backtest</span> to simulate the
              strategy against historical price data and see full performance metrics.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Quick start:
            </span>
            {PRESET_STRATEGIES.map((p) => (
              <Button
                key={p.key}
                variant="outline"
                size="sm"
                onClick={() => onPreset(p.key)}
                className="gap-1.5 border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-500 dark:text-emerald-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {p.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function BacktestClient() {
  const [state, update] = usePersistedState();
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lastConfig, setLastConfig] = useState<{
    symbol: string;
    timeframe: Timeframe;
    period: Period;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch asset list
  const assetsQ = useQuery({
    queryKey: ['backtest-assets'],
    queryFn: fetchAssets,
    staleTime: 5 * 60_000,
  });

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleRun = useCallback(async () => {
    if (state.entryRules.length === 0) {
      toast.error('Select at least 1 entry rule');
      return;
    }
    if (state.exitRules.length === 0) {
      toast.error('Select at least 1 exit rule');
      return;
    }
    if (!state.symbol) {
      toast.error('Select an asset');
      return;
    }
    if (!(state.initialCapital > 0)) {
      toast.error('Initial capital must be greater than 0');
      return;
    }

    setRunning(true);
    setElapsed(0);
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);

    try {
      const interval = TF_TO_INTERVAL[state.timeframe];
      const limit = PERIOD_LIMITS[state.period];
      const klines = await fetchKlines(state.symbol, interval, limit);
      if (klines.length < 30) {
        throw new Error(
          `Insufficient data (${klines.length} bars). Try a different asset or period.`,
        );
      }
      // Brief delay so the loading state is visible (UX nicety)
      await new Promise((r) => setTimeout(r, 200));
      const r = runBacktest({
        klines,
        entryRules: state.entryRules,
        exitRules: state.exitRules,
        stopLossPct: state.stopLossPct,
        takeProfitPct: state.takeProfitPct,
        initialCapital: state.initialCapital,
        positionSizePct: state.positionSizePct,
      });
      setResult(r);
      setLastConfig({
        symbol: state.symbol,
        timeframe: state.timeframe,
        period: state.period,
      });
      const ret = r.metrics.totalReturnPct;
      toast.success(
        `Backtest complete · ${r.metrics.totalTrades} trades · ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% return`,
        { description: `${state.symbol} · ${state.timeframe.toUpperCase()} · ${state.period.toUpperCase()}` },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Backtest failed');
      setResult(null);
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRunning(false);
    }
  }, [state]);

  const handlePreset = useCallback(
    (key: string) => {
      const preset = PRESET_STRATEGIES.find((p) => p.key === key);
      if (!preset) return;
      update({
        entryRules: preset.entryRules,
        exitRules: preset.exitRules,
        stopLossPct: preset.stopLossPct,
        takeProfitPct: preset.takeProfitPct,
        positionSizePct: preset.positionSizePct,
      });
      toast.success(`Loaded preset: ${preset.name}`, {
        description: preset.description.slice(0, 100) + '…',
      });
    },
    [update],
  );

  const toggleRule = useCallback(
    (kind: 'entry' | 'exit', ruleKey: string) => {
      const list = kind === 'entry' ? state.entryRules : state.exitRules;
      const next = list.includes(ruleKey)
        ? list.filter((k) => k !== ruleKey)
        : [...list, ruleKey];
      if (kind === 'entry') update({ entryRules: next });
      else update({ exitRules: next });
    },
    [state.entryRules, state.exitRules, update],
  );

  const hasSL = state.exitRules.includes('stop_loss');
  const hasTP = state.exitRules.includes('take_profit');

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-0 rounded-xl bg-emerald-500/30 blur-md"
            />
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-teal-500/10">
              <FlaskConical className="h-5 w-5 text-emerald-500" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Backtesting Engine</h1>
            <p className="text-sm text-muted-foreground">
              Test trading strategies against historical price data
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && lastConfig && (
            <Badge
              variant="outline"
              className="gap-1.5 border-border/60 bg-muted/30 font-mono text-xs"
            >
              <Activity className="h-3 w-3 text-emerald-500" />
              {cleanSymbol(lastConfig.symbol)} · {lastConfig.timeframe.toUpperCase()} · {lastConfig.period.toUpperCase()}
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Settings2 className="h-3.5 w-3.5" />
                Load Preset
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs">Preset Strategies</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PRESET_STRATEGIES.map((p) => (
                <DropdownMenuItem
                  key={p.key}
                  onClick={() => handlePreset(p.key)}
                  className="flex flex-col items-start gap-1 py-2"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-medium">{p.name}</span>
                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-500"
                    >
                      {p.entryRules.length}E / {p.exitRules.length}X
                    </Badge>
                  </div>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {p.description}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.div>

      {/* ---------------------------------------------------------------- Body */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* =========================================================== Config Panel */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="border-border/50 bg-card/50 p-6 backdrop-blur-sm">
            <div className="mb-5 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-emerald-500" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">
                Strategy Configuration
              </h2>
            </div>

            <div className="space-y-5">
              {/* Asset */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Asset
                </Label>
                <Select
                  value={state.symbol}
                  onValueChange={(v) => update({ symbol: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select asset" />
                  </SelectTrigger>
                  <SelectContent>
                    {assetsQ.isLoading && (
                      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading assets…
                      </div>
                    )}
                    {assetsQ.data?.map((a) => (
                      <SelectItem key={a.symbol} value={a.symbol}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono">{cleanSymbol(a.symbol)}</span>
                          <span className="text-xs text-muted-foreground">
                            ${fmtPrice(a.price)}
                          </span>
                          <span
                            className={cn(
                              'text-xs font-mono',
                              a.changePct >= 0 ? 'text-emerald-500' : 'text-rose-500',
                            )}
                          >
                            {a.changePct >= 0 ? '+' : ''}
                            {a.changePct.toFixed(2)}%
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Timeframe */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Timeframe
                </Label>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted/40 p-1">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.value}
                      type="button"
                      onClick={() => update({ timeframe: tf.value })}
                      className={cn(
                        'rounded-md py-1.5 text-xs font-semibold transition-all duration-200',
                        'outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                        state.timeframe === tf.value
                          ? 'bg-emerald-500 text-white shadow-[0_4px_12px_-4px_rgba(16,185,129,0.5)]'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Period */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Period
                </Label>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted/40 p-1">
                  {PERIODS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => update({ period: p.value })}
                      className={cn(
                        'flex flex-col items-center rounded-md py-1.5 transition-all duration-200',
                        'outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                        state.period === p.value
                          ? 'bg-emerald-500 text-white shadow-[0_4px_12px_-4px_rgba(16,185,129,0.5)]'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <span className="text-xs font-bold">{p.label}</span>
                      <span
                        className={cn(
                          'text-[9px]',
                          state.period === p.value ? 'text-emerald-100' : 'text-muted-foreground/60',
                        )}
                      >
                        {p.sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Initial Capital */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="initial-capital"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Initial Capital
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="initial-capital"
                    type="number"
                    min={1}
                    step={100}
                    value={state.initialCapital}
                    onChange={(e) =>
                      update({ initialCapital: parseFloat(e.target.value) || 0 })
                    }
                    className="pl-8 font-mono tabular-nums"
                  />
                </div>
              </div>

              {/* Position Size */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Position Size
                  </Label>
                  <Badge className="border-emerald-500/30 bg-emerald-500/10 font-mono text-xs text-emerald-500">
                    {state.positionSizePct}% / trade
                  </Badge>
                </div>
                <Slider
                  value={[state.positionSizePct]}
                  min={1}
                  max={25}
                  step={1}
                  onValueChange={(v) => update({ positionSizePct: v[0] })}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>1%</span>
                  <span>conservative</span>
                  <span>25%</span>
                </div>
              </div>

              <Separator className="bg-border/40" />

              {/* Entry Rules */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                    Entry Rules
                  </Label>
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-mono text-xs',
                      state.entryRules.length > 0
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-500',
                    )}
                  >
                    {state.entryRules.length} active
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Enter a position when <span className="font-medium text-foreground">any</span> of these rules trigger.
                </p>
                <div className="space-y-1.5">
                  {ENTRY_RULES.map((rule) => (
                    <RuleChip
                      key={rule.key}
                      rule={rule}
                      active={state.entryRules.includes(rule.key)}
                      onToggle={() => toggleRule('entry', rule.key)}
                      accent="emerald"
                    />
                  ))}
                </div>
              </div>

              <Separator className="bg-border/40" />

              {/* Exit Rules */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                    Exit Rules
                  </Label>
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-mono text-xs',
                      state.exitRules.length > 0
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-500'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-500',
                    )}
                  >
                    {state.exitRules.length} active
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Exit a position when <span className="font-medium text-foreground">any</span> of these rules trigger.
                </p>
                <div className="space-y-1.5">
                  {EXIT_RULES.map((rule) => (
                    <RuleChip
                      key={rule.key}
                      rule={rule}
                      active={state.exitRules.includes(rule.key)}
                      onToggle={() => toggleRule('exit', rule.key)}
                      accent="rose"
                    />
                  ))}
                </div>

                {/* Stop Loss slider (shown when stop_loss exit active) */}
                <AnimatePresence>
                  {hasSL && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 overflow-hidden pt-2"
                    >
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 text-xs font-medium text-rose-500">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          Stop Loss
                        </Label>
                        <Badge className="border-rose-500/30 bg-rose-500/10 font-mono text-xs text-rose-500">
                          -{state.stopLossPct}%
                        </Badge>
                      </div>
                      <Slider
                        value={[state.stopLossPct]}
                        min={1}
                        max={15}
                        step={0.5}
                        onValueChange={(v) => update({ stopLossPct: v[0] })}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Take Profit slider */}
                <AnimatePresence>
                  {hasTP && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 overflow-hidden pt-2"
                    >
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                          <Trophy className="h-3.5 w-3.5" />
                          Take Profit
                        </Label>
                        <Badge className="border-emerald-500/30 bg-emerald-500/10 font-mono text-xs text-emerald-500">
                          +{state.takeProfitPct}%
                        </Badge>
                      </div>
                      <Slider
                        value={[state.takeProfitPct]}
                        min={2}
                        max={30}
                        step={0.5}
                        onValueChange={(v) => update({ takeProfitPct: v[0] })}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Separator className="bg-border/40" />

              {/* Run button */}
              <Button
                onClick={handleRun}
                disabled={running}
                size="lg"
                className="group relative w-full gap-2 overflow-hidden bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 transition-all hover:shadow-xl hover:shadow-emerald-500/40 hover:brightness-105"
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running backtest…
                    {(elapsed / 1000).toFixed(1)}s
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 transition-transform group-hover:scale-110" />
                    Run Backtest
                  </>
                )}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                {PERIOD_LIMITS[state.period]} bars fetched · simulation runs locally
              </p>
            </div>
          </Card>
        </div>

        {/* =========================================================== Results */}
        <div className="space-y-4">
          {!result && !running && (
            <EmptyState onPreset={handlePreset} />
          )}

          {running && !result && (
            <>
              <StatCardSkeletonRow />
              <Card className="border-border/50 bg-card/50 p-6 backdrop-blur-sm">
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                  Running backtest… {(elapsed / 1000).toFixed(1)}s elapsed
                </div>
                <Skeleton className="h-[320px] w-full rounded-lg" />
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Skeleton className="h-[180px] w-full rounded-lg" />
                  <Skeleton className="h-[180px] w-full rounded-lg" />
                </div>
              </Card>
            </>
          )}

          {result && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  label="Total Return"
                  value={fmtPct(result.metrics.totalReturnPct)}
                  sub={`${fmtUsd(result.metrics.finalEquity - result.metrics.initialEquity)}`}
                  icon={result.metrics.totalReturnPct >= 0 ? TrendingUp : TrendingDown}
                  accent={result.metrics.totalReturnPct >= 0 ? 'emerald' : 'rose'}
                  delay={0}
                />
                <StatCard
                  label="Final Equity"
                  value={fmtUsd(result.metrics.finalEquity, 0)}
                  sub={`from ${fmtUsd(result.metrics.initialEquity, 0)}`}
                  icon={Wallet}
                  accent="teal"
                  delay={0.1}
                />
                <StatCard
                  label="Total Trades"
                  value={String(result.metrics.totalTrades)}
                  sub={`${result.trades.filter((t) => t.pnl > 0).length}W / ${result.trades.filter((t) => t.pnl <= 0).length}L`}
                  icon={BarChart3}
                  accent="zinc"
                  delay={0.2}
                />
                <StatCard
                  label="Win Rate"
                  value={`${result.metrics.winRate.toFixed(1)}%`}
                  sub={`avg ${result.metrics.avgHoldDays.toFixed(1)}d hold`}
                  icon={Target}
                  accent={result.metrics.winRate >= 50 ? 'emerald' : 'amber'}
                  delay={0.3}
                />
                <StatCard
                  label="Max Drawdown"
                  value={`-${result.metrics.maxDrawdownPct.toFixed(2)}%`}
                  sub="peak-to-trough"
                  icon={TrendingDown}
                  accent="rose"
                  delay={0.4}
                />
                <StatCard
                  label="Sharpe Ratio"
                  value={result.metrics.sharpeRatio.toFixed(2)}
                  sub={result.metrics.sharpeRatio >= 1 ? 'good' : result.metrics.sharpeRatio >= 0 ? 'acceptable' : 'poor'}
                  icon={Gauge}
                  accent={result.metrics.sharpeRatio >= 1 ? 'emerald' : result.metrics.sharpeRatio >= 0 ? 'amber' : 'rose'}
                  delay={0.5}
                />
              </div>

              {/* Equity curve */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.15 }}
              >
                <Card className="border-border/50 bg-card/50 p-6 backdrop-blur-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10">
                        <Activity className="h-4 w-4 text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Equity Curve</h3>
                        <p className="text-[11px] text-muted-foreground">
                          Strategy vs buy &amp; hold benchmark
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Best trade</span>
                        <span className="font-mono font-semibold text-emerald-500">
                          +{fmtUsd(result.metrics.bestTrade)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Worst</span>
                        <span className="font-mono font-semibold text-rose-500">
                          {fmtUsd(result.metrics.worstTrade)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <EquityCurveChart result={result} />
                </Card>
              </motion.div>

              {/* Drawdown + Monthly heatmap */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.25 }}
                >
                  <Card className="border-border/50 bg-card/50 p-6 backdrop-blur-sm">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/10">
                        <TrendingDown className="h-4 w-4 text-rose-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Drawdown</h3>
                        <p className="text-[11px] text-muted-foreground">
                          Peak-to-trough decline over time
                        </p>
                      </div>
                    </div>
                    <DrawdownChart result={result} />
                  </Card>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.35 }}
                >
                  <Card className="border-border/50 bg-card/50 p-6 backdrop-blur-sm">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10">
                        <Calendar className="h-4 w-4 text-amber-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Monthly Returns</h3>
                        <p className="text-[11px] text-muted-foreground">
                          Color intensity = magnitude of monthly P&amp;L
                        </p>
                      </div>
                    </div>
                    <MonthlyHeatmap result={result} />
                  </Card>
                </motion.div>
              </div>

              {/* Trade list */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.45 }}
              >
                <Card className="border-border/50 bg-card/50 p-6 backdrop-blur-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500/10">
                        <BarChart3 className="h-4 w-4 text-teal-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Trade History</h3>
                        <p className="text-[11px] text-muted-foreground">
                          {result.trades.length} trades · click column headers to sort
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Avg hold: <span className="font-mono text-foreground">{result.metrics.avgHoldDays.toFixed(1)}d</span>
                    </div>
                  </div>
                  <TradeTable trades={result.trades} />
                </Card>
              </motion.div>

              {/* Summary footer */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.55 }}
              >
                <Card className="border-border/50 bg-gradient-to-br from-emerald-500/[0.04] via-transparent to-teal-500/[0.04] p-5 backdrop-blur-sm">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                      <Info className="h-5 w-5 text-emerald-500" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="text-sm font-semibold">Backtest Summary</div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Over {result.equity.length} bars, this strategy generated{' '}
                        <span className="font-mono font-semibold text-foreground">
                          {result.metrics.totalTrades}
                        </span>{' '}
                        trades with a{' '}
                        <span
                          className={cn(
                            'font-mono font-semibold',
                            result.metrics.totalReturnPct >= 0 ? 'text-emerald-500' : 'text-rose-500',
                          )}
                        >
                          {fmtPct(result.metrics.totalReturnPct)}
                        </span>{' '}
                        total return ({fmtUsd(result.metrics.finalEquity, 0)} final equity), a{' '}
                        <span className="font-mono font-semibold text-rose-500">
                          -{result.metrics.maxDrawdownPct.toFixed(2)}%
                        </span>{' '}
                        maximum drawdown, and a Sharpe ratio of{' '}
                        <span className="font-mono font-semibold text-foreground">
                          {result.metrics.sharpeRatio.toFixed(2)}
                        </span>
                        . Win rate:{' '}
                        <span className="font-mono font-semibold text-foreground">
                          {result.metrics.winRate.toFixed(1)}%
                        </span>
                        . Position sizing: <span className="font-mono">{state.positionSizePct}%</span> of equity per trade.
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            </motion.div>
          )}

          {/* Footer disclaimer */}
          {!result && !running && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4 text-xs text-amber-600 dark:text-amber-400">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <span className="font-semibold">Disclaimer:</span>{' '}
                  Backtests assume perfect fills at close prices with no slippage or fees. Past
                  performance does not guarantee future results. Use results as a starting point
                  for further research, not as investment advice.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
