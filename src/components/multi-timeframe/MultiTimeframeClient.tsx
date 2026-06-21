'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Columns3,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Loader2,
  Search,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ArrowUp,
  ArrowDown,
  Info,
  AlertTriangle,
  CircleSlash,
  Layers,
  Target,
  Crosshair,
  Shield,
  ExternalLink,
  ChevronsUpDown,
  Calculator,
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
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { ApiResult, Kline, TechnicalIndicators, Ticker } from '@/lib/types';
import type {
  ConfluenceResult,
  Insight,
  InsightType,
  EntrySuggestion,
  TimeframeAnalysis,
  TimeframeKey,
  Verdict,
  CellSignal,
  AgreementMatrixRow,
} from '@/lib/analysis/multi-timeframe';
import { TIMEFRAME_ORDER, TIMEFRAME_LABELS } from '@/lib/analysis/multi-timeframe';

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------
interface MultiTimeframeResponse {
  symbol: string;
  price: number;
  changePct: number;
  timeframes: TimeframeAnalysis[];
  confluence: ConfluenceResult;
  agreementMatrix: AgreementMatrixRow[];
  insights: Insight[];
  suggestion: EntrySuggestion | null;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const QUICK_PILLS = [
  { symbol: 'BTCUSDT', label: 'BTC' },
  { symbol: 'ETHUSDT', label: 'ETH' },
  { symbol: 'SOLUSDT', label: 'SOL' },
  { symbol: 'BNBUSDT', label: 'BNB' },
  { symbol: 'XRPUSDT', label: 'XRP' },
  { symbol: 'ADAUSDT', label: 'ADA' },
  { symbol: 'DOGEUSDT', label: 'DOGE' },
  { symbol: 'AVAXUSDT', label: 'AVAX' },
];

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
async function fetchMultiTimeframe(symbol: string): Promise<MultiTimeframeResponse> {
  const r = await fetch(`/api/multi-timeframe?symbol=${encodeURIComponent(symbol)}`);
  const j: ApiResult<MultiTimeframeResponse> = await r.json();
  if (!j.success || !j.data) throw new Error(j.error || 'Failed to load multi-timeframe analysis');
  return j.data;
}

async function fetchPrices(): Promise<Ticker[]> {
  const r = await fetch('/api/crypto/prices');
  const j: ApiResult<Ticker[]> = await r.json();
  if (!j.success || !j.data) throw new Error(j.error || 'Failed to load prices');
  return j.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function cleanSymbol(s: string): string {
  return s.replace(/USDT$/, '').replace(/USDC$/, '');
}

function fmtPrice(p: number): string {
  if (!isFinite(p) || p === 0) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtPct(p: number): string {
  if (!isFinite(p)) return '—';
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

function verdictColor(v: Verdict): string {
  switch (v) {
    case 'STRONG_BULLISH':
      return 'emerald';
    case 'BULLISH':
      return 'emerald';
    case 'NEUTRAL':
      return 'amber';
    case 'BEARISH':
      return 'rose';
    case 'STRONG_BEARISH':
      return 'rose';
  }
}

function verdictTextClass(v: Verdict): string {
  switch (v) {
    case 'STRONG_BULLISH':
      return 'text-emerald-400';
    case 'BULLISH':
      return 'text-emerald-400';
    case 'NEUTRAL':
      return 'text-amber-400';
    case 'BEARISH':
      return 'text-rose-400';
    case 'STRONG_BEARISH':
      return 'text-rose-400';
  }
}

function signalBadgeClass(s: CellSignal): string {
  switch (s) {
    case 'bullish':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 ring-1 ring-emerald-500/20';
    case 'bearish':
      return 'bg-rose-500/10 text-rose-400 border-rose-500/30 ring-1 ring-rose-500/20';
    case 'neutral':
      return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30 ring-1 ring-zinc-500/20';
  }
}

function signalLabel(s: CellSignal): string {
  return s === 'bullish' ? 'Bull' : s === 'bearish' ? 'Bear' : 'Neutral';
}

function insightAccent(type: InsightType): { border: string; bg: string; text: string; iconBg: string } {
  switch (type) {
    case 'opportunity':
      return {
        border: 'border-l-emerald-500',
        bg: 'bg-emerald-500/[0.04]',
        text: 'text-emerald-400',
        iconBg: 'bg-emerald-500/15 text-emerald-400',
      };
    case 'caution':
      return {
        border: 'border-l-amber-500',
        bg: 'bg-amber-500/[0.04]',
        text: 'text-amber-400',
        iconBg: 'bg-amber-500/15 text-amber-400',
      };
    case 'warning':
      return {
        border: 'border-l-rose-500',
        bg: 'bg-rose-500/[0.04]',
        text: 'text-rose-400',
        iconBg: 'bg-rose-500/15 text-rose-400',
      };
    case 'info':
      return {
        border: 'border-l-zinc-500',
        bg: 'bg-zinc-500/[0.04]',
        text: 'text-zinc-300',
        iconBg: 'bg-zinc-500/15 text-zinc-300',
      };
  }
}

// Static icon lookup map (kept at module scope so the rule about components
// created during render is satisfied — values are existing component refs,
// not new component definitions).
const INSIGHT_ICONS: Record<string, typeof TrendingUp> = {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Layers,
  CircleSlash,
  Info,
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function MultiTimeframeClient() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>('BTCUSDT');
  const [search, setSearch] = useState('');
  const [comboOpen, setComboOpen] = useState(false);

  // Prices list for the searchable dropdown
  const pricesQ = useQuery({
    queryKey: ['crypto-prices-list'],
    queryFn: fetchPrices,
    staleTime: 60_000,
  });

  // Multi-timeframe analysis
  const mtQ = useQuery({
    queryKey: ['multi-timeframe', selected],
    queryFn: () => fetchMultiTimeframe(selected),
    staleTime: 60_000,
  });

  const refresh = useCallback(async () => {
    toast.info('Refreshing multi-timeframe analysis…');
    try {
      await queryClient.invalidateQueries({ queryKey: ['multi-timeframe', selected] });
      await queryClient.invalidateQueries({ queryKey: ['crypto-prices-list'] });
      toast.success('Analysis refreshed');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Refresh failed';
      toast.error('Refresh failed', { description: msg });
    }
  }, [queryClient, selected]);

  // Prices lookup for the top bar live price display
  const liveTicker = useMemo(() => {
    const list = pricesQ.data ?? [];
    return list.find((t) => t.symbol === selected) ?? null;
  }, [pricesQ.data, selected]);

  const data = mtQ.data;

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
                <Columns3 className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                Multi-Timeframe Analysis
              </h1>
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              One asset across 1H · 4H · 1D · 1W — confluence score, agreement matrix, and entry/exit suggestions
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Activity className="h-3 w-3 animate-pulse text-emerald-500" /> Auto-refresh 1 min
              {mtQ.isFetching && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
            </span>
            <Button variant="outline" size="sm" onClick={refresh} disabled={mtQ.isFetching}>
              <RefreshCw className={cn('h-3.5 w-3.5', mtQ.isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </motion.div>

        {/* Asset selector + live price */}
        <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
          <CardContent className="py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
                Quick Select:
              </span>
              {QUICK_PILLS.map((p) => (
                <button
                  key={p.symbol}
                  onClick={() => setSelected(p.symbol)}
                  className={cn(
                    'relative inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                    selected === p.symbol
                      ? 'border-emerald-500/50 bg-gradient-to-r from-emerald-500/20 to-teal-500/15 text-emerald-500 shadow-md shadow-emerald-500/20'
                      : 'border-border/60 bg-muted/40 text-muted-foreground hover:border-emerald-500/30 hover:text-emerald-500 hover:translate-y-[-1px]',
                  )}
                >
                  {selected === p.symbol && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />
                  )}
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              {/* Searchable combo for full asset list */}
              <Popover open={comboOpen} onOpenChange={setComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 min-w-[180px] justify-between font-mono"
                  >
                    <span className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5" />
                      {selected}
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-0" align="end">
                  <Command>
                    <CommandInput
                      placeholder="Search symbol…"
                      value={search}
                      onValueChange={setSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No symbols found.</CommandEmpty>
                      <CommandGroup>
                        {(pricesQ.data ?? [])
                          .filter((t) =>
                            search.trim()
                              ? t.symbol
                                  .toLowerCase()
                                  .includes(search.trim().toLowerCase())
                              : true,
                          )
                          .slice(0, 200)
                          .map((t) => (
                            <CommandItem
                              key={t.symbol}
                              value={t.symbol}
                              onSelect={(v) => {
                                setSelected(v);
                                setComboOpen(false);
                                setSearch('');
                              }}
                              className="flex items-center justify-between"
                            >
                              <span className="font-mono text-xs">{t.symbol}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">
                                ${fmtPrice(t.price)}
                              </span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Live price */}
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-border/60 bg-muted/30">
                <div className="flex flex-col leading-tight">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Price
                  </span>
                  <span className="font-mono tabular-nums text-sm font-semibold">
                    ${fmtPrice(liveTicker?.price ?? data?.price ?? 0)}
                  </span>
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    24h
                  </span>
                  <span
                    className={cn(
                      'font-mono tabular-nums text-sm font-semibold',
                      (liveTicker?.changePct ?? data?.changePct ?? 0) >= 0
                        ? 'text-emerald-500'
                        : 'text-rose-500',
                    )}
                  >
                    {fmtPct(liveTicker?.changePct ?? data?.changePct ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Confluence Score Hero + Entry Suggestion sidebar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="grid grid-cols-1 gap-4 lg:grid-cols-3"
        >
          <Card className="lg:col-span-2 border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-emerald-500" />
                Confluence Score
              </CardTitle>
              <CardDescription className="text-xs">
                Weighted average of all 4 timeframes — higher timeframes count more
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mtQ.isLoading ? (
                <ConfluenceHeroSkeleton />
              ) : mtQ.isError ? (
                <ErrorBlock
                  message={mtQ.error?.message ?? 'Failed to load analysis'}
                  onRetry={() => mtQ.refetch()}
                />
              ) : data ? (
                <ConfluenceHero confluence={data.confluence} />
              ) : null}
            </CardContent>
          </Card>

          {/* Entry / exit suggestion */}
          <Card className="border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Crosshair className="h-4 w-4 text-emerald-500" />
                Entry / Exit Suggestion
              </CardTitle>
              <CardDescription className="text-xs">
                Auto-derived from confluence + nearest S/R
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mtQ.isLoading ? (
                <Skeleton className="h-44 w-full rounded-lg" />
              ) : mtQ.isError ? (
                <Skeleton className="h-44 w-full rounded-lg" />
              ) : data ? (
                <EntrySuggestionPanel suggestion={data.suggestion} symbol={selected} />
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        {/* 4 Timeframe Cards (2x2 grid) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {TIMEFRAME_ORDER.map((tfKey, idx) => {
            const tf = data?.timeframes.find((t) => t.interval === tfKey);
            return (
              <motion.div
                key={tfKey}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.08 * (idx + 1) }}
              >
                <TimeframeCard
                  tf={tf}
                  interval={tfKey}
                  isLoading={mtQ.isLoading}
                  isError={mtQ.isError}
                />
              </motion.div>
            );
          })}
        </div>

        {/* Timeframe Agreement Matrix */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.42 }}
        >
          <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-emerald-500" />
                Timeframe Agreement Matrix
              </CardTitle>
              <CardDescription className="text-xs">
                Spot divergences instantly — when a row mixes colors, timeframes disagree
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mtQ.isLoading ? (
                <Skeleton className="h-56 w-full rounded-lg" />
              ) : mtQ.isError ? (
                <ErrorBlock
                  message={mtQ.error?.message ?? 'Failed to load matrix'}
                  onRetry={() => mtQ.refetch()}
                />
              ) : data ? (
                <AgreementMatrix rows={data.agreementMatrix} />
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        {/* Confluence Signals (insights) */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.5 }}
        >
          <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-emerald-500" />
                Confluence Signals
              </CardTitle>
              <CardDescription className="text-xs">
                Rule-based insights derived from the multi-timeframe analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mtQ.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              ) : mtQ.isError ? (
                <ErrorBlock
                  message={mtQ.error?.message ?? 'Failed to load insights'}
                  onRetry={() => mtQ.refetch()}
                />
              ) : data && data.insights.length > 0 ? (
                <div className="space-y-2.5">
                  <AnimatePresence mode="popLayout">
                    {data.insights.map((ins, i) => (
                      <motion.div
                        key={ins.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 8 }}
                        transition={{ duration: 0.25, delay: i * 0.04 }}
                      >
                        <InsightCard insight={ins} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-8">
                  No insights — analysis neutral.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <div className="text-center text-[11px] text-muted-foreground pb-2">
          <Activity className="inline h-3 w-3 mr-1" />
          Multi-timeframe confluence scoring · weights 1H 0.15 · 4H 0.25 · 1D 0.35 · 1W 0.25 ·
          data from Binance · auto-refresh 60s
        </div>
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Confluence Hero (circular gauge + verdict + agreement bar)
// ---------------------------------------------------------------------------
function ConfluenceHero({ confluence }: { confluence: ConfluenceResult }) {
  const { score, verdict, agreementCount, agreementBar, agreementDirection } = confluence;
  const color = verdictColor(verdict);
  const textCls = verdictTextClass(verdict);

  // Gauge geometry — semi-circular arc
  const size = 220;
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // Map score (-100..100) to angle (-90..90 degrees for semi-circle)
  const angle = (score / 100) * 90;
  const rad = (angle * Math.PI) / 180;
  const x = cx + radius * Math.sin(rad);
  const y = cy - radius * Math.cos(rad);

  // Build an arc path between two angles (in degrees, -90..90).
  // Sweep flag is 1 (clockwise) when going to higher angles (bull side),
  // 0 (counterclockwise) when going to lower angles (bear side).
  const arcPath = (a1: number, a2: number) => {
    const r1 = (a1 * Math.PI) / 180;
    const r2 = (a2 * Math.PI) / 180;
    const x1 = cx + radius * Math.sin(r1);
    const y1 = cy - radius * Math.cos(r1);
    const x2 = cx + radius * Math.sin(r2);
    const y2 = cy - radius * Math.cos(r2);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    const sweep = a2 >= a1 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} ${sweep} ${x2} ${y2}`;
  };

  // Glow color class
  const glowClass =
    color === 'emerald'
      ? 'drop-shadow-[0_0_18px_rgba(16,185,129,0.55)]'
      : color === 'rose'
        ? 'drop-shadow-[0_0_18px_rgba(244,63,94,0.55)]'
        : 'drop-shadow-[0_0_18px_rgba(245,158,11,0.5)]';

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-between">
      {/* Gauge */}
      <div className="relative flex-shrink-0">
        <svg
          width={size}
          height={size / 2 + 64}
          viewBox={`0 0 ${size} ${size / 2 + 64}`}
          className="overflow-visible"
        >
          <defs>
            <linearGradient id="cf-bg-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f43f5e" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <linearGradient id="cf-fg-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f43f5e" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
          {/* Background arc (rose → amber → emerald) */}
          <path
            d={arcPath(-90, 90)}
            fill="none"
            stroke="url(#cf-bg-grad)"
            strokeWidth={stroke}
            strokeLinecap="round"
            opacity={0.18}
          />
          {/* Tick marks at 0 / ±30 / ±50 / ±100 */}
          {[-90, -50, -30, 0, 30, 50, 90].map((deg) => {
            const rr = (deg * Math.PI) / 180;
            const ix = cx + (radius - stroke / 2 - 4) * Math.sin(rr);
            const iy = cy - (radius - stroke / 2 - 4) * Math.cos(rr);
            const ox = cx + (radius + stroke / 2 + 4) * Math.sin(rr);
            const oy = cy - (radius + stroke / 2 + 4) * Math.cos(rr);
            return (
              <line
                key={deg}
                x1={ix}
                y1={iy}
                x2={ox}
                y2={oy}
                stroke="currentColor"
                strokeWidth={1}
                className="text-muted-foreground/40"
              />
            );
          })}
          {/* Animated fill: from 0 deg to score angle */}
          <motion.path
            d={arcPath(0, angle)}
            fill="none"
            stroke="url(#cf-fg-grad)"
            strokeWidth={stroke}
            strokeLinecap="round"
            className={glowClass}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
          {/* Needle */}
          <motion.line
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            className={cn(
              color === 'emerald'
                ? 'text-emerald-400'
                : color === 'rose'
                  ? 'text-rose-400'
                  : 'text-amber-400',
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.5 }}
          />
          <circle cx={cx} cy={cy} r={5} className="fill-foreground" />
          {/* Endpoint dot */}
          <motion.circle
            cx={x}
            cy={y}
            r={6}
            className={cn(
              'fill-current',
              color === 'emerald'
                ? 'text-emerald-400'
                : color === 'rose'
                  ? 'text-rose-400'
                  : 'text-amber-400',
            )}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3, delay: 1 }}
          />
        </svg>
        {/* Score number centered */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pointer-events-none">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className={cn('font-mono tabular-nums text-4xl font-bold', textCls)}
          >
            {score > 0 ? '+' : ''}
            {score}
          </motion.div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground -mt-1">
            Confluence
          </div>
        </div>
      </div>

      {/* Verdict + agreement bar */}
      <div className="flex flex-col gap-3 flex-1 w-full">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Verdict
          </span>
          <span className={cn('text-xl font-bold tracking-tight', textCls)}>
            {verdict.replace('_', ' ')}
          </span>
          <span className="text-xs text-muted-foreground">
            {agreementCount} of 4 timeframes agree on{' '}
            <span className={cn('font-semibold', signalBadgeClass(agreementDirection))}>
              {agreementDirection === 'bullish'
                ? 'BULLISH'
                : agreementDirection === 'bearish'
                  ? 'BEARISH'
                  : 'NEUTRAL'}
            </span>{' '}
            direction
          </span>
        </div>

        {/* Agreement bar */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Timeframe votes
          </div>
          <div className="flex gap-1.5">
            {agreementBar.map((b) => {
              const isBull = b.vote === 'bullish';
              const isBear = b.vote === 'bearish';
              return (
                <Tooltip key={b.interval}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'flex-1 flex flex-col items-center justify-center py-2 rounded-md border text-[11px] font-semibold transition-all',
                        isBull
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          : isBear
                            ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                            : 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400',
                      )}
                    >
                      <span className="font-mono">{TIMEFRAME_LABELS[b.interval]}</span>
                      <span className="text-[9px] opacity-70 mt-0.5">
                        {b.score > 0 ? '+' : ''}
                        {b.score}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {TIMEFRAME_LABELS[b.interval]}: {signalLabel(b.vote)} (score {b.score}, weight{' '}
                    {(b.weight * 100).toFixed(0)}%)
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confluence hero skeleton
// ---------------------------------------------------------------------------
function ConfluenceHeroSkeleton() {
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-between">
      <Skeleton className="h-[140px] w-[220px] rounded-full" />
      <div className="space-y-2 flex-1 w-full">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry Suggestion Panel
// ---------------------------------------------------------------------------
function EntrySuggestionPanel({
  suggestion,
  symbol,
}: {
  suggestion: EntrySuggestion | null;
  symbol: string;
}) {
  if (!suggestion) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
          <Shield className="h-5 w-5" />
        </div>
        <div className="text-sm font-semibold text-amber-400">No high-confidence setup</div>
        <div className="text-[11px] text-muted-foreground max-w-[240px]">
          Confluence is neutral — wait for timeframe alignment before entering.
        </div>
      </div>
    );
  }

  const isLong = suggestion.direction === 'long';
  const accent = isLong ? 'emerald' : 'rose';

  // R/R visual bar
  const risk = Math.abs(suggestion.entry - suggestion.stop);
  const reward = Math.abs(suggestion.target - suggestion.entry);
  const total = risk + reward;
  const riskPct = total > 0 ? (risk / total) * 100 : 50;
  const rewardPct = 100 - riskPct;

  const riskCalcHref = `/risk-calculator?symbol=${encodeURIComponent(symbol)}&entry=${suggestion.entry}&stop=${suggestion.stop}&target=${suggestion.target}&direction=${suggestion.direction}`;

  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-3',
        isLong
          ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
          : 'border-rose-500/30 bg-rose-500/[0.04]',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLong ? (
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          ) : (
            <TrendingDown className="h-4 w-4 text-rose-400" />
          )}
          <span
            className={cn(
              'text-sm font-bold uppercase tracking-wider',
              isLong ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {suggestion.direction} setup
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'font-mono tabular-nums',
            isLong
              ? 'border-emerald-500/30 text-emerald-400'
              : 'border-rose-500/30 text-rose-400',
          )}
        >
          R/R {suggestion.rr.toFixed(2)}
        </Badge>
      </div>

      {/* Prices */}
      <div className="grid grid-cols-3 gap-2">
        <SuggestionPrice
          label="Entry"
          value={suggestion.entry}
          color="text-foreground"
          icon={<Crosshair className="h-3 w-3" />}
        />
        <SuggestionPrice
          label="Stop"
          value={suggestion.stop}
          color="text-rose-400"
          icon={<ArrowDown className="h-3 w-3" />}
          sub={suggestion.stopSource.toUpperCase()}
        />
        <SuggestionPrice
          label="Target"
          value={suggestion.target}
          color="text-emerald-400"
          icon={<Target className="h-3 w-3" />}
          sub={suggestion.targetSource.toUpperCase()}
        />
      </div>

      {/* R/R visual bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Risk {riskPct.toFixed(0)}%</span>
          <span>Reward {rewardPct.toFixed(0)}%</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full', accent === 'emerald' ? 'bg-rose-500/70' : 'bg-rose-500/70')}
            style={{ width: `${riskPct}%` }}
          />
          <div
            className={cn(
              'h-full',
              accent === 'emerald' ? 'bg-emerald-500/70' : 'bg-emerald-500/70',
            )}
            style={{ width: `${rewardPct}%` }}
          />
        </div>
      </div>

      {/* CTA */}
      <Button
        asChild
        size="sm"
        className={cn(
          'w-full h-8 text-xs',
          isLong
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25',
        )}
        variant="outline"
      >
        <Link href={riskCalcHref}>
          <Calculator className="h-3 w-3 mr-1" />
          Open in Risk Calculator
          <ExternalLink className="h-3 w-3 ml-1" />
        </Link>
      </Button>
    </div>
  );
}

function SuggestionPrice({
  label,
  value,
  color,
  icon,
  sub,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
        {sub && <span className="text-[8px] opacity-70 ml-auto">[{sub}]</span>}
      </div>
      <div className={cn('font-mono tabular-nums text-xs font-semibold', color)}>
        ${fmtPrice(value)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeframe card (full analysis for one timeframe)
// ---------------------------------------------------------------------------
function TimeframeCard({
  tf,
  interval,
  isLoading,
  isError,
}: {
  tf: TimeframeAnalysis | undefined;
  interval: TimeframeKey;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return <TimeframeCardSkeleton interval={interval} />;
  }
  if (isError || !tf) {
    return (
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
        <CardContent>
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 mr-2 text-rose-500" />
            Failed to load {TIMEFRAME_LABELS[interval]} data
          </div>
        </CardContent>
      </Card>
    );
  }

  const ind = tf.indicators;
  const trend = ind.trend;
  const vote =
    ind.summary.score > 10 ? 'bullish' : ind.summary.score < -10 ? 'bearish' : 'neutral';
  const lastPrice = tf.klines[tf.klines.length - 1]?.close ?? 0;

  const accentClass =
    trend === 'bullish'
      ? 'from-emerald-500/80 to-teal-500/80'
      : trend === 'bearish'
        ? 'from-rose-500/80 to-rose-600/80'
        : 'from-zinc-500/60 to-zinc-600/60';

  // RSI zone
  const rsiZone: CellSignal =
    ind.rsi < 30 ? 'bullish' : ind.rsi > 70 ? 'bearish' : 'neutral';
  const rsiZoneLabel =
    ind.rsi < 30 ? 'Oversold' : ind.rsi > 70 ? 'Overbought' : 'Neutral';

  // MACD direction
  const macdRising = ind.macd.histogram > 0;

  // EMA20 vs EMA50
  const emaCross: CellSignal = ind.ema20 > ind.ema50 ? 'bullish' : 'bearish';
  // Price vs EMA200
  const priceEma200: CellSignal = lastPrice > ind.ema200 ? 'bullish' : 'bearish';
  // Bollinger position
  const bbPos =
    lastPrice > ind.bollinger.upper
      ? 'Upper'
      : lastPrice < ind.bollinger.lower
        ? 'Lower'
        : 'Middle';
  const bbSignal: CellSignal =
    bbPos === 'Lower' ? 'bullish' : bbPos === 'Upper' ? 'bearish' : 'neutral';
  // VWAP
  const vwapSig: CellSignal = lastPrice > ind.vwap ? 'bullish' : 'bearish';

  // Nearest support / resistance
  const nearestSupport =
    [...(ind.support ?? [])].filter((s) => s < lastPrice).sort((a, b) => b - a)[0] ??
    ind.support?.[0] ??
    null;
  const nearestResistance =
    [...(ind.resistance ?? [])].filter((r) => r > lastPrice).sort((a, b) => a - b)[0] ??
    ind.resistance?.[0] ??
    null;

  // Signal strength bar
  const summaryScore = ind.summary.score; // -100..100
  const sigPct = ((summaryScore + 100) / 200) * 100;

  return (
    <Card className="relative border-border/50 bg-card/50 backdrop-blur-sm p-5 rounded-xl gap-4 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/5 hover:-translate-y-0.5 overflow-hidden">
      {/* Top accent bar */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r',
          accentClass,
        )}
      />
      <div className="px-1 pt-1 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold tracking-tight">
                {TIMEFRAME_LABELS[interval]}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'h-5 text-[10px] font-semibold',
                  trend === 'bullish'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : trend === 'bearish'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                      : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
                )}
              >
                {trend === 'bullish' && <TrendingUp className="h-2.5 w-2.5 mr-1" />}
                {trend === 'bearish' && <TrendingDown className="h-2.5 w-2.5 mr-1" />}
                {trend === 'neutral' && <Minus className="h-2.5 w-2.5 mr-1" />}
                {trend}
              </Badge>
            </div>
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {tf.klines.length} candles
            </span>
          </div>
          <div className="flex flex-col items-end">
            <Badge
              variant="outline"
              className={cn(
                'h-5 text-[10px] font-semibold uppercase',
                vote === 'bullish'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : vote === 'bearish'
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
              )}
            >
              {vote === 'bullish' ? 'Buy' : vote === 'bearish' ? 'Sell' : 'Neutral'}
            </Badge>
            <span className="font-mono tabular-nums text-xs mt-1">
              ${fmtPrice(lastPrice)}
            </span>
          </div>
        </div>

        {/* Mini chart */}
        <MiniPriceChart klines={tf.klines} ind={ind} interval={interval} />

        {/* Signal strength bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="uppercase tracking-wider text-muted-foreground">
              Signal strength
            </span>
            <span
              className={cn(
                'font-mono tabular-nums font-semibold',
                summaryScore > 10
                  ? 'text-emerald-400'
                  : summaryScore < -10
                    ? 'text-rose-400'
                    : 'text-amber-400',
              )}
            >
              {summaryScore > 0 ? '+' : ''}
              {summaryScore}
            </span>
          </div>
          <SignalStrengthBar pct={sigPct} score={summaryScore} />
        </div>

        {/* Indicator grid */}
        <div className="grid grid-cols-2 gap-1.5">
          <IndicatorChip
            label="RSI (14)"
            value={ind.rsi.toFixed(1)}
            badge={rsiZoneLabel}
            signal={rsiZone}
            hint="Relative Strength Index — <30 oversold, >70 overbought."
          />
          <IndicatorChip
            label="MACD"
            value={ind.macd.histogram.toFixed(4)}
            badge={macdRising ? 'Rising' : 'Falling'}
            signal={macdRising ? 'bullish' : 'bearish'}
            hint="MACD histogram — positive & rising = bullish momentum."
            badgeIcon={
              macdRising ? (
                <ArrowUp className="h-2.5 w-2.5" />
              ) : (
                <ArrowDown className="h-2.5 w-2.5" />
              )
            }
          />
          <IndicatorChip
            label="EMA20/50"
            value={ind.ema20 > ind.ema50 ? 'Above' : 'Below'}
            badge={ind.ema20 > ind.ema50 ? 'Bull' : 'Bear'}
            signal={emaCross}
            hint="EMA20 above EMA50 = bullish short-term momentum."
          />
          <IndicatorChip
            label="Price/EMA200"
            value={lastPrice > ind.ema200 ? 'Above' : 'Below'}
            badge={lastPrice > ind.ema200 ? 'Bull' : 'Bear'}
            signal={priceEma200}
            hint="Price above 200-EMA = bullish regime, below = bearish regime."
          />
          <IndicatorChip
            label="Bollinger"
            value={bbPos}
            badge={bbPos === 'Upper' ? 'Overbought' : bbPos === 'Lower' ? 'Oversold' : 'Mid'}
            signal={bbSignal}
            hint="Position within Bollinger Bands — upper = overbought, lower = oversold."
          />
          <IndicatorChip
            label="VWAP"
            value={lastPrice > ind.vwap ? 'Above' : 'Below'}
            badge={lastPrice > ind.vwap ? 'Bull' : 'Bear'}
            signal={vwapSig}
            hint="Volume-Weighted Average Price — institutional fair-value reference."
          />
          <IndicatorChip
            label="ATR (14)"
            value={ind.atr.toFixed(2)}
            badge="Volatility"
            signal="neutral"
            hint="Average True Range — measures volatility. Higher = choppier."
          />
          <IndicatorChip
            label="S/R nearest"
            value={
              nearestSupport != null && nearestResistance != null
                ? `${fmtPrice(nearestSupport)} → ${fmtPrice(nearestResistance)}`
                : '—'
            }
            badge="Levels"
            signal="neutral"
            hint="Nearest support (below) and resistance (above) from local extrema."
          />
        </div>
      </div>
    </Card>
  );
}

function TimeframeCardSkeleton({ interval }: { interval: TimeframeKey }) {
  return (
    <Card className="relative border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-zinc-500/30 animate-pulse" />
      <CardContent className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="h-[120px] w-full rounded-md" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="grid grid-cols-2 gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
        <span className="sr-only">Loading {TIMEFRAME_LABELS[interval]}</span>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mini price chart (recharts AreaChart + EMA20/EMA50 overlays)
// ---------------------------------------------------------------------------
function MiniPriceChart({
  klines,
  ind,
  interval,
}: {
  klines: Kline[];
  ind: TechnicalIndicators;
  interval: TimeframeKey;
}) {
  if (klines.length === 0) {
    return (
      <div className="h-[120px] flex items-center justify-center text-[11px] text-muted-foreground">
        No data
      </div>
    );
  }

  // Compute EMA20 / EMA50 series client-side for the chart overlay
  const closes = klines.map((k) => k.close);
  const ema20Series = computeEmaSeries(closes, 20);
  const ema50Series = computeEmaSeries(closes, 50);

  const data = klines.map((k, i) => ({
    i,
    close: k.close,
    ema20: ema20Series[i],
    ema50: ema50Series[i],
  }));

  const lastPrice = closes[closes.length - 1];
  const isBull = lastPrice >= ind.ema50;

  const gradId = `mini-grad-${interval}`;
  const color = isBull ? '#10b981' : '#f43f5e';

  return (
    <div className="h-[120px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted-foreground/15" />
          <XAxis dataKey="i" hide />
          <YAxis domain={['dataMin', 'dataMax']} hide />
          <Area
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            isAnimationActive
            animationDuration={600}
          />
          <Line
            type="monotone"
            dataKey="ema20"
            stroke="#10b981"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
            opacity={0.85}
          />
          <Line
            type="monotone"
            dataKey="ema50"
            stroke="#14b8a6"
            strokeWidth={1}
            strokeDasharray="3 2"
            dot={false}
            isAnimationActive={false}
            opacity={0.85}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function computeEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

// ---------------------------------------------------------------------------
// Indicator chip (compact cell with label + value + colored badge)
// ---------------------------------------------------------------------------
function IndicatorChip({
  label,
  value,
  badge,
  signal,
  hint,
  badgeIcon,
}: {
  label: string;
  value: string;
  badge: string;
  signal: CellSignal;
  hint: string;
  badgeIcon?: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5 cursor-help transition-colors hover:border-border/80 hover:bg-muted/40">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
            <Info className="h-2.5 w-2.5 opacity-50" />
            {label}
          </div>
          <div className="font-mono tabular-nums text-xs font-semibold truncate">
            {value}
          </div>
          <div
            className={cn(
              'inline-flex w-fit items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase',
              signalBadgeClass(signal),
            )}
          >
            {badgeIcon}
            {badge}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px]">{hint}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Signal strength bar (horizontal gradient bar, center marker)
// ---------------------------------------------------------------------------
function SignalStrengthBar({ pct, score }: { pct: number; score: number }) {
  // The fill grows from center (50%) toward the score side
  // pct is 0..100 where 50 = neutral
  const isBull = score > 0;
  const isBear = score < 0;
  const fillPct = Math.abs(pct - 50); // 0..50
  return (
    <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-rose-500/30 via-amber-500/20 to-emerald-500/30 overflow-hidden">
      {/* Center marker */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-px bg-foreground/60" />
      {/* Fill */}
      {isBull && (
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${fillPct * 2}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="absolute left-1/2 top-0 h-full bg-gradient-to-r from-emerald-500/60 to-emerald-400"
        />
      )}
      {isBear && (
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${fillPct * 2}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="absolute right-1/2 top-0 h-full bg-gradient-to-l from-rose-500/60 to-rose-400"
        />
      )}
      {!isBull && !isBear && (
        <div className="absolute left-1/2 top-0 h-full w-px bg-amber-400/60" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agreement Matrix
// ---------------------------------------------------------------------------
function AgreementMatrix({ rows }: { rows: AgreementMatrixRow[] }) {
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border/60">
            <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold py-2 px-2">
              Indicator
            </th>
            {TIMEFRAME_ORDER.map((k) => (
              <th
                key={k}
                className="text-center text-[10px] uppercase tracking-wider text-muted-foreground font-semibold py-2 px-2 sticky top-0 bg-card"
              >
                {TIMEFRAME_LABELS[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.indicator}
              className="border-b border-border/30 transition-colors hover:bg-muted/30 group"
            >
              <td className="py-2 px-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 cursor-help">
                      <span className="text-xs font-semibold">{row.indicator}</span>
                      <Info className="h-2.5 w-2.5 text-muted-foreground/50 group-hover:text-emerald-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px]">{row.hint}</TooltipContent>
                </Tooltip>
              </td>
              {TIMEFRAME_ORDER.map((k) => {
                const v = row.values[k];
                return (
                  <td key={k} className="py-2 px-2">
                    <div className="flex justify-center">
                      <div
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase',
                          signalBadgeClass(v),
                        )}
                      >
                        {v === 'bullish' && <ArrowUp className="h-2.5 w-2.5" />}
                        {v === 'bearish' && <ArrowDown className="h-2.5 w-2.5" />}
                        {v === 'neutral' && <Minus className="h-2.5 w-2.5" />}
                        {signalLabel(v)}
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insight Card
// ---------------------------------------------------------------------------
function InsightCard({ insight }: { insight: Insight }) {
  const accent = insightAccent(insight.type);
  const Icon = INSIGHT_ICONS[insight.icon] ?? Info;

  return (
    <div
      className={cn(
        'rounded-lg border border-l-4 border-border/40 px-3 py-2.5 flex items-start gap-3 transition-all hover:shadow-md',
        accent.border,
        accent.bg,
      )}
    >
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-md flex-shrink-0', accent.iconBg)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight">{insight.title}</span>
            <span className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {insight.message}
            </span>
          </div>
          {/* Confidence dots */}
          <div className="flex items-center gap-0.5 mt-0.5 flex-shrink-0">
            {[1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  i <= insight.confidence
                    ? insight.type === 'opportunity'
                      ? 'bg-emerald-500'
                      : insight.type === 'warning'
                        ? 'bg-rose-500'
                        : insight.type === 'caution'
                          ? 'bg-amber-500'
                          : 'bg-zinc-400'
                    : 'bg-muted-foreground/20',
                )}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          {insight.timeframes.map((tf) => (
            <span
              key={tf}
              className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground"
            >
              {TIMEFRAME_LABELS[tf]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error block
// ---------------------------------------------------------------------------
function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="text-sm font-semibold text-rose-400">Failed to load</div>
      <div className="text-[11px] text-muted-foreground max-w-[260px]">{message}</div>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-2 h-8">
        <RefreshCw className="h-3 w-3 mr-1" />
        Retry
      </Button>
    </div>
  );
}
