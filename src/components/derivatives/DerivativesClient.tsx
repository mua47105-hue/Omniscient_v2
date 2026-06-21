'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Layers,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Search,
  Activity,
  Clock,
  Zap,
  Flame,
  BarChart3,
  DollarSign,
  Percent,
  Sparkles,
  Info,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Radio,
  Filter,
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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Cell as RechartsCell,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { ApiResult } from '@/lib/types';
import {
  interpretFundingRate,
  interpretLongShortRatio,
  interpretTakerVolume,
  fundingRateColor,
  fmtFundingPct,
  fmtUsd,
  fmtCompact,
  fundingCountdown,
  type DerivativeSignal,
} from '@/lib/analysis/derivatives';

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------
interface FundingAllEntry {
  symbol: string;
  rate: number;
  nextFunding: number;
  openInterest: number;
  oiValue: number;
}

interface AssetDerivativesData {
  symbol: string;
  funding: { rate: number; nextFunding: number };
  openInterest: { current: number; value: number };
  oiHistory: { time: number; oi: number; value: number; price: number }[];
  lsRatio: {
    time: number;
    longShortRatio: number;
    longAccount: number;
    shortAccount: number;
  }[];
  takerVolume: { time: number; buyVol: number; sellVol: number; ratio: number }[];
  priceHistory: { time: number; price: number }[];
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
  { symbol: 'DOGEUSDT', label: 'DOGE' },
  { symbol: 'AVAXUSDT', label: 'AVAX' },
  { symbol: 'LINKUSDT', label: 'LINK' },
];

const SIGNAL_BADGE: Record<
  DerivativeSignal,
  { classes: string; icon: typeof TrendingUp }
> = {
  bullish: {
    classes:
      'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 ring-1 ring-emerald-500/20',
    icon: TrendingUp,
  },
  bearish: {
    classes:
      'bg-rose-500/10 text-rose-500 border-rose-500/30 ring-1 ring-rose-500/20',
    icon: TrendingDown,
  },
  neutral: {
    classes:
      'bg-zinc-500/10 text-zinc-400 border-zinc-500/30 ring-1 ring-zinc-500/20',
    icon: Minus,
  },
};

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
async function fetchFundingAll(): Promise<FundingAllEntry[]> {
  const r = await fetch('/api/derivatives/funding-all');
  const j: ApiResult<FundingAllEntry[]> = await r.json();
  if (!j.success || !j.data) throw new Error(j.error || 'Failed to load funding rates');
  return j.data;
}

async function fetchAssetDerivatives(symbol: string): Promise<AssetDerivativesData> {
  const r = await fetch(`/api/derivatives/asset/${encodeURIComponent(symbol)}`);
  const j: ApiResult<AssetDerivativesData> = await r.json();
  if (!j.success || !j.data) throw new Error(j.error || 'Failed to load asset derivatives');
  return j.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function cleanSymbol(s: string): string {
  return s.replace(/USDT$/, '').replace(/USDC$/, '');
}

function fmtTimeShort(t: number): string {
  return new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fmtHour(t: number): string {
  return new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function DerivativesClient() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>('BTCUSDT');
  const [search, setSearch] = useState('');
  const [extremeOnly, setExtremeOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'most-negative' | 'most-positive' | 'symbol'>(
    'most-negative'
  );

  // Funding-all query (auto-refresh 60s)
  const fundingQ = useQuery({
    queryKey: ['derivatives-funding-all'],
    queryFn: fetchFundingAll,
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  // Per-asset derivatives data (5 min stale)
  const assetQ = useQuery({
    queryKey: ['derivatives-asset', selected],
    queryFn: () => fetchAssetDerivatives(selected),
    staleTime: 5 * 60_000,
  });

  const refreshAll = useCallback(async () => {
    toast.info('Refreshing derivatives data…');
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['derivatives-funding-all'] }),
        queryClient.invalidateQueries({ queryKey: ['derivatives-asset'] }),
      ]);
      toast.success('Derivatives data refreshed');
    } catch (e: any) {
      toast.error('Refresh failed', { description: e.message });
    }
  }, [queryClient]);

  const fundingEntries = fundingQ.data ?? [];
  const fundingStats = useMemo(() => computeFundingStats(fundingEntries), [fundingEntries]);
  const filteredHeatmap = useMemo(
    () => filterAndSortFunding(fundingEntries, search, extremeOnly, sortMode),
    [fundingEntries, search, extremeOnly, sortMode]
  );

  return (
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
              <Layers className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Derivatives Analytics
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
            Funding rates · open interest · long/short · taker volume — futures market positioning
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Radio className="h-3 w-3 animate-pulse text-emerald-500" /> Auto-refresh 1 min
            {fundingQ.isFetching && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
          </span>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={fundingQ.isFetching}>
            <RefreshCw className={cn('h-3.5 w-3.5', fundingQ.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </motion.div>

      {/* Asset quick-select pills + search */}
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
                    : 'border-border/60 bg-muted/40 text-muted-foreground hover:border-emerald-500/30 hover:text-emerald-500 hover:translate-y-[-1px]'
                )}
              >
                {selected === p.symbol && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />
                )}
                {p.label}
              </button>
            ))}
          </div>
          <div className="relative w-full lg:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value.toUpperCase())}
              placeholder="Search symbol (e.g. AAVEUSDT)…"
              className="pl-8 h-9 text-xs font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* Funding rate heatmap (full width) */}
      <FundingHeatmapSection
        entries={filteredHeatmap}
        stats={fundingStats}
        isLoading={fundingQ.isLoading}
        isError={fundingQ.isError}
        error={fundingQ.error}
        search={search}
        setSearch={setSearch}
        extremeOnly={extremeOnly}
        setExtremeOnly={setExtremeOnly}
        sortMode={sortMode}
        setSortMode={setSortMode}
        onRetry={() => fundingQ.refetch()}
        onSelectAsset={setSelected}
        selected={selected}
      />

      {/* 3-column detail charts for the selected asset */}
      <AssetDetailSection
        symbol={selected}
        data={assetQ.data}
        isLoading={assetQ.isLoading}
        isError={assetQ.isError}
        error={assetQ.error}
        onRetry={() => assetQ.refetch()}
      />

      {/* Market-wide funding summary table */}
      <FundingSummaryTable
        entries={fundingEntries}
        isLoading={fundingQ.isLoading}
        selected={selected}
        onSelectAsset={setSelected}
      />

      <div className="text-center text-[11px] text-muted-foreground pb-2">
        <Activity className="inline h-3 w-3 mr-1" />
        Data from Binance Futures (fapi) · click any cell or row for deep analysis · auto-refresh
        every 60s · negative funding = shorts pay longs (bullish)
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funding stats
// ---------------------------------------------------------------------------
interface FundingStats {
  total: number;
  mostNegative: FundingAllEntry | null;
  mostPositive: FundingAllEntry | null;
  avg: number;
  pctNegative: number;
}

function computeFundingStats(entries: FundingAllEntry[]): FundingStats {
  if (entries.length === 0) {
    return { total: 0, mostNegative: null, mostPositive: null, avg: 0, pctNegative: 0 };
  }
  let sum = 0;
  let negCount = 0;
  let mostNeg: FundingAllEntry | null = null;
  let mostPos: FundingAllEntry | null = null;
  for (const e of entries) {
    sum += e.rate;
    if (e.rate < 0) negCount++;
    if (!mostNeg || e.rate < mostNeg.rate) mostNeg = e;
    if (!mostPos || e.rate > mostPos.rate) mostPos = e;
  }
  return {
    total: entries.length,
    mostNegative: mostNeg,
    mostPositive: mostPos,
    avg: sum / entries.length,
    pctNegative: (negCount / entries.length) * 100,
  };
}

function filterAndSortFunding(
  entries: FundingAllEntry[],
  search: string,
  extremeOnly: boolean,
  sortMode: 'most-negative' | 'most-positive' | 'symbol'
): FundingAllEntry[] {
  let out = entries.filter((e) => e.symbol.endsWith('USDT'));
  if (search.trim()) {
    const q = search.trim().toUpperCase();
    out = out.filter((e) => e.symbol.includes(q));
  }
  if (extremeOnly) {
    out = out.filter((e) => Math.abs(e.rate) > 0.0005);
  }
  // Filter out trivially broken symbols (e.g. tiny OI / weird tickers like 1000SHIB)
  // — keep them but they'll sort by magnitude naturally
  if (sortMode === 'most-negative') {
    out.sort((a, b) => a.rate - b.rate);
  } else if (sortMode === 'most-positive') {
    out.sort((a, b) => b.rate - a.rate);
  } else {
    out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Funding rate heatmap section
// ---------------------------------------------------------------------------
function FundingHeatmapSection({
  entries,
  stats,
  isLoading,
  isError,
  error,
  search,
  setSearch,
  extremeOnly,
  setExtremeOnly,
  sortMode,
  setSortMode,
  onRetry,
  onSelectAsset,
  selected,
}: {
  entries: FundingAllEntry[];
  stats: FundingStats;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  search: string;
  setSearch: (v: string) => void;
  extremeOnly: boolean;
  setExtremeOnly: (v: boolean) => void;
  sortMode: 'most-negative' | 'most-positive' | 'symbol';
  setSortMode: (v: 'most-negative' | 'most-positive' | 'symbol') => void;
  onRetry: () => void;
  onSelectAsset: (s: string) => void;
  selected: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 }}
      className="space-y-3"
    >
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <FundingStatTile
          label="Most Negative"
          value={stats.mostNegative ? fmtFundingPct(stats.mostNegative.rate) : '—'}
          sub={stats.mostNegative ? cleanSymbol(stats.mostNegative.symbol) : '—'}
          icon={<ArrowDown className="h-4 w-4" />}
          accent="emerald"
          hint="Most bullish funding — shorts are paying longs the most."
        />
        <FundingStatTile
          label="Most Positive"
          value={stats.mostPositive ? fmtFundingPct(stats.mostPositive.rate) : '—'}
          sub={stats.mostPositive ? cleanSymbol(stats.mostPositive.symbol) : '—'}
          icon={<ArrowUp className="h-4 w-4" />}
          accent="rose"
          hint="Most bearish funding — longs are paying shorts the most (overcrowded)."
        />
        <FundingStatTile
          label="Avg Funding"
          value={stats.total > 0 ? fmtFundingPct(stats.avg) : '—'}
          sub={`${stats.total} symbols`}
          icon={<Activity className="h-4 w-4" />}
          accent={stats.avg < 0 ? 'emerald' : stats.avg > 0 ? 'rose' : 'zinc'}
          hint="Mean funding rate across all USDT perpetuals."
        />
        <FundingStatTile
          label="% Negative"
          value={stats.total > 0 ? `${stats.pctNegative.toFixed(0)}%` : '—'}
          sub={`${stats.total - Math.round((stats.pctNegative / 100) * stats.total)} positive`}
          icon={<Percent className="h-4 w-4" />}
          accent={stats.pctNegative > 50 ? 'emerald' : 'rose'}
          hint="Share of symbols with negative funding (shorts paying longs)."
        />
        <FundingStatTile
          label="Total Symbols"
          value={String(stats.total)}
          sub="USDT perpetuals"
          icon={<Layers className="h-4 w-4" />}
          accent="teal"
          hint="Number of USDT perpetual contracts currently tracked."
        />
      </div>

      <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Flame className="h-4 w-4 text-orange-500" />
                Funding Rate Heatmap
                <InfoTip text="Funding rates show how much longs pay shorts (positive) or shorts pay longs (negative). Deep emerald = strong bullish (shorts paying), deep rose = strong bearish (longs paying), zinc = neutral." />
              </CardTitle>
              <CardDescription className="text-xs">
                {entries.length} symbols · click a cell for deep analysis
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Search inside the card */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value.toUpperCase())}
                  placeholder="Filter…"
                  className="pl-8 h-8 text-xs w-32 sm:w-40"
                />
              </div>
              {/* Sort mode */}
              <div className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5 text-xs">
                {(
                  [
                    ['most-negative', 'Most −'],
                    ['most-positive', 'Most +'],
                    ['symbol', 'A→Z'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setSortMode(mode)}
                    className={cn(
                      'px-2.5 py-1 rounded transition-colors',
                      sortMode === mode
                        ? 'bg-emerald-500/20 text-emerald-500'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Extreme only toggle */}
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                <Switch checked={extremeOnly} onCheckedChange={setExtremeOnly} />
                <span className="flex items-center gap-1">
                  Extreme
                  <InfoTip text="Show only symbols where |funding rate| > 0.05% — these are the most crowded trades." />
                </span>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1.5">
              {Array.from({ length: 60 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-md" />
              ))}
            </div>
          ) : isError ? (
            <ErrorBlock error={error} onRetry={onRetry} />
          ) : entries.length === 0 ? (
            <EmptyBlock message="No funding rate data available — try refreshing." />
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1.5">
              {entries.slice(0, 240).map((e, idx) => (
                <HeatmapCell
                  key={e.symbol}
                  entry={e}
                  index={idx}
                  isSelected={selected === e.symbol}
                  onClick={() => onSelectAsset(e.symbol)}
                />
              ))}
            </div>
          )}
          {/* Color legend */}
          <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Shorts paying longs (bullish)</span>
              <div className="h-2 w-32 rounded-full bg-gradient-to-r from-emerald-500 via-zinc-500 to-rose-500" />
              <span>Longs paying shorts (bearish)</span>
            </div>
            <span className="hidden sm:inline">{entries.length} shown</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function HeatmapCell({
  entry,
  index,
  isSelected,
  onClick,
}: {
  entry: FundingAllEntry;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const c = fundingRateColor(entry.rate);
  const interp = interpretFundingRate(entry.rate);
  const pctStr = fmtFundingPct(entry.rate, 4);
  const delay = Math.min(0.3, index * 0.003);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          onClick={onClick}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, delay }}
          whileHover={{ scale: 1.1, zIndex: 10 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            'relative aspect-square rounded-md flex flex-col items-center justify-center gap-0.5 p-1 transition-all duration-200 overflow-hidden',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
            isSelected && 'ring-2 ring-emerald-500 ring-offset-1 ring-offset-background'
          )}
          style={{ backgroundColor: c.rgba }}
        >
          {/* hover ring */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-md ring-2 ring-transparent group-hover:ring-emerald-400 transition-all"
          />
          <span className={cn('text-[9px] sm:text-[10px] font-bold leading-none truncate w-full text-center', c.text)}>
            {cleanSymbol(entry.symbol)}
          </span>
          <span
            className={cn(
              'text-[8px] sm:text-[9px] font-mono tabular-nums leading-none flex items-center gap-0.5',
              c.text
            )}
          >
            {entry.rate >= 0 ? <ArrowUp className="h-2 w-2" /> : <ArrowDown className="h-2 w-2" />}
            {pctStr.replace('+', '').replace('-', '')}
          </span>
          {isSelected && (
            <span className="absolute top-0.5 right-0.5 h-1 w-1 rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)]" />
          )}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-left">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 font-bold">
            <span>{entry.symbol}</span>
            <span className={cn('font-mono', interp.color)}>{fmtFundingPct(entry.rate)}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {interp.label} · <span className={interp.color}>{interp.signal.toUpperCase()}</span>
          </div>
          <div className="text-[10px] leading-snug">{interp.advice}</div>
          {entry.openInterest > 0 && (
            <div className="text-[10px] text-muted-foreground">
              OI: {fmtCompact(entry.openInterest)} · {fmtUsd(entry.oiValue)}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
            Click to load {cleanSymbol(entry.symbol)} charts →
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Asset detail section — 3 columns (OI / LS ratio / Taker volume)
// ---------------------------------------------------------------------------
function AssetDetailSection({
  symbol,
  data,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  symbol: string;
  data?: AssetDerivativesData;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1 }}
      className="grid grid-cols-1 lg:grid-cols-3 gap-4"
    >
      <OpenInterestPanel
        symbol={symbol}
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
      />
      <LongShortPanel
        symbol={symbol}
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
      />
      <TakerVolumePanel
        symbol={symbol}
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
      />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Open interest panel
// ---------------------------------------------------------------------------
function OpenInterestPanel({
  symbol,
  data,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  symbol: string;
  data?: AssetDerivativesData;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const oiHistory = data?.oiHistory ?? [];
  const current = data?.openInterest.current ?? 0;
  const oiChangePct = useMemo(() => {
    if (oiHistory.length < 2) return 0;
    const oldest = oiHistory[0].oi;
    if (oldest <= 0) return 0;
    return ((current - oldest) / oldest) * 100;
  }, [oiHistory, current]);

  // OI vs Price overlay data
  const overlayData = useMemo(
    () =>
      oiHistory.map((e) => ({
        time: e.time,
        oi: e.value, // use USDT value for nicer numbers
        price: e.price,
      })),
    [oiHistory]
  );

  // Detect OI trend vs price trend
  const trendLabel = useMemo(() => {
    if (oiHistory.length < 4) return null;
    const first = oiHistory[0];
    const last = oiHistory[oiHistory.length - 1];
    const oiUp = last.oi > first.oi;
    const priceUp = last.price > first.price;
    if (oiUp && priceUp) {
      return {
        text: 'OI Rising + Price Up = Strong Bullish Trend',
        signal: 'bullish' as DerivativeSignal,
      };
    }
    if (!oiUp && priceUp) {
      return {
        text: 'OI Falling + Price Up = Short Covering (Weak)',
        signal: 'neutral' as DerivativeSignal,
      };
    }
    if (oiUp && !priceUp) {
      return {
        text: 'OI Rising + Price Down = Strong Bearish Trend',
        signal: 'bearish' as DerivativeSignal,
      };
    }
    return {
      text: 'OI Falling + Price Down = Long Unwinding (Capitulation)',
      signal: 'bearish' as DerivativeSignal,
    };
  }, [oiHistory]);

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BarChart3 className="h-4 w-4 text-emerald-500" />
            Open Interest
            <InfoTip text="Open interest = total number of outstanding futures contracts. Rising OI = new positions opening (trend strength); falling OI = positions closing (trend exhaustion)." />
          </CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {cleanSymbol(symbol)} · 4h × 30
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <SkeletonPanel height={220} />
        ) : isError ? (
          <ErrorBlock error={error} onRetry={onRetry} />
        ) : !data ? (
          <EmptyBlock message="No OI data." />
        ) : (
          <>
            {/* Current OI value */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Current OI
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-500">
                  {fmtCompact(current)}
                </div>
                <div className="text-[10px] text-muted-foreground">contracts</div>
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  5d Change
                </div>
                <div
                  className={cn(
                    'text-xl font-bold font-mono tabular-nums flex items-center gap-1',
                    oiChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  )}
                >
                  {oiChangePct >= 0 ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                  {oiChangePct >= 0 ? '+' : ''}
                  {oiChangePct.toFixed(2)}%
                </div>
                <div className="text-[10px] text-muted-foreground">vs 5 days ago</div>
              </div>
            </div>

            {/* OI vs Price dual-axis chart */}
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={overlayData} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="oiGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border) / 0.3)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={fmtHour}
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    stroke="hsl(var(--border) / 0.5)"
                    minTickGap={40}
                  />
                  <YAxis
                    yAxisId="oi"
                    orientation="left"
                    tick={{ fontSize: 9, fill: '#10b981' }}
                    stroke="hsl(var(--border) / 0.5)"
                    tickFormatter={(v) => fmtCompact(v, 0)}
                    width={50}
                  />
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    tick={{ fontSize: 9, fill: '#a1a1aa' }}
                    stroke="hsl(var(--border) / 0.5)"
                    tickFormatter={(v) => fmtCompact(v, 0)}
                    width={50}
                  />
                  <RechartsTooltip
                    content={<DualAxisTooltip />}
                    cursor={{ stroke: 'hsl(var(--border) / 0.6)', strokeWidth: 1 }}
                  />
                  <Area
                    yAxisId="oi"
                    type="monotone"
                    dataKey="oi"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#oiGradient)"
                    name="OI ($)"
                    animationDuration={700}
                  />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="price"
                    stroke="#a1a1aa"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                    name="Price"
                    animationDuration={700}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Trend annotation */}
            {trendLabel && (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-md border p-2 text-xs',
                  trendLabel.signal === 'bullish'
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                    : trendLabel.signal === 'bearish'
                      ? 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400'
                      : 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400'
                )}
              >
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span className="leading-snug">{trendLabel.text}</span>
              </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm bg-emerald-500" /> Open Interest (USDT)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-0.5 w-3 bg-zinc-400" /> Price
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Long/Short ratio panel
// ---------------------------------------------------------------------------
function LongShortPanel({
  symbol,
  data,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  symbol: string;
  data?: AssetDerivativesData;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const lsHistory = data?.lsRatio ?? [];
  const latest = lsHistory[lsHistory.length - 1];
  const ratio = latest?.longShortRatio ?? 0;
  const interp = useMemo(() => (ratio > 0 ? interpretLongShortRatio(ratio) : null), [ratio]);
  const chartData = useMemo(
    () =>
      lsHistory.map((e) => ({
        time: e.time,
        ratio: e.longShortRatio,
        longPct: e.longAccount * 100,
        shortPct: e.shortAccount * 100,
      })),
    [lsHistory]
  );

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-teal-500" />
            Top Trader L/S Ratio
            <InfoTip text="Long/short position ratio of top traders on Binance Futures. Ratio > 1 = more longs, < 1 = more shorts. Often used as a smart-money positioning proxy." />
          </CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {cleanSymbol(symbol)} · 4h × 30
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <SkeletonPanel height={220} />
        ) : isError ? (
          <ErrorBlock error={error} onRetry={onRetry} />
        ) : !data || !interp ? (
          <EmptyBlock message="No L/S ratio data." />
        ) : (
          <>
            {/* Current ratio + badge */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Current Ratio
                </div>
                <div
                  className={cn(
                    'text-2xl font-bold font-mono tabular-nums',
                    interp.signal === 'bullish'
                      ? 'text-emerald-500'
                      : interp.signal === 'bearish'
                        ? 'text-rose-500'
                        : 'text-amber-500'
                  )}
                >
                  {ratio.toFixed(3)}
                </div>
              </div>
              <SignalBadge signal={interp.signal} label={interp.label} />
            </div>

            {/* Stacked bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="text-emerald-500 font-semibold">
                  LONG {interp.longPct.toFixed(1)}%
                </span>
                <span className="text-rose-500 font-semibold">
                  SHORT {interp.shortPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
                  style={{ width: `${interp.longPct}%` }}
                />
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-rose-500 transition-all duration-500"
                  style={{ width: `${interp.shortPct}%` }}
                />
              </div>
            </div>

            {/* Historical chart */}
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border) / 0.3)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={fmtHour}
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    stroke="hsl(var(--border) / 0.5)"
                    minTickGap={40}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    stroke="hsl(var(--border) / 0.5)"
                    width={36}
                    domain={['auto', 'auto']}
                  />
                  <ReferenceLine y={1} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                  <RechartsTooltip content={<LsRatioTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="ratio"
                    stroke="#14b8a6"
                    strokeWidth={2}
                    dot={false}
                    name="L/S Ratio"
                    animationDuration={700}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div
              className={cn(
                'flex items-start gap-2 rounded-md border p-2 text-xs',
                interp.signal === 'bullish'
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                  : interp.signal === 'bearish'
                    ? 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400'
                    : 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400'
              )}
            >
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="leading-snug">{interp.advice}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Taker volume panel
// ---------------------------------------------------------------------------
function TakerVolumePanel({
  symbol,
  data,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  symbol: string;
  data?: AssetDerivativesData;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const tvHistory = data?.takerVolume ?? [];
  const totals = useMemo(() => {
    let buy = 0;
    let sell = 0;
    for (const e of tvHistory) {
      buy += e.buyVol;
      sell += e.sellVol;
    }
    return { buy, sell };
  }, [tvHistory]);
  const interp = useMemo(
    () =>
      totals.buy + totals.sell > 0
        ? interpretTakerVolume(totals.buy, totals.sell)
        : null,
    [totals]
  );
  const latest = tvHistory[tvHistory.length - 1];
  const latestRatio = latest?.ratio ?? 0;
  const chartData = useMemo(
    () =>
      tvHistory.map((e) => ({
        time: e.time,
        buy: e.buyVol,
        sell: e.sellVol,
      })),
    [tvHistory]
  );

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-orange-500" />
            Taker Buy / Sell
            <InfoTip text="Volume of aggressive market orders (taker buys vs taker sells). Buy dominance = bullish pressure (takers lifting the ask); sell dominance = bearish pressure (takers hitting the bid)." />
          </CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {cleanSymbol(symbol)} · 4h × 30
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <SkeletonPanel height={220} />
        ) : isError ? (
          <ErrorBlock error={error} onRetry={onRetry} />
        ) : !data || !interp ? (
          <EmptyBlock message="No taker volume data." />
        ) : (
          <>
            {/* Current ratio + 24h totals */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Latest B/S Ratio
                </div>
                <div
                  className={cn(
                    'text-xl font-bold font-mono tabular-nums',
                    latestRatio >= 1 ? 'text-emerald-500' : 'text-rose-500'
                  )}
                >
                  {latestRatio.toFixed(3)}
                </div>
                <div className="text-[10px] text-muted-foreground">last 4h bar</div>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  5d Buy Vol
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-500">
                  {fmtCompact(totals.buy)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  vs {fmtCompact(totals.sell)} sell
                </div>
              </div>
            </div>

            {/* Bars chart */}
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border) / 0.3)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={fmtHour}
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    stroke="hsl(var(--border) / 0.5)"
                    minTickGap={40}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    stroke="hsl(var(--border) / 0.5)"
                    width={40}
                    tickFormatter={(v) => fmtCompact(v, 0)}
                  />
                  <RechartsTooltip content={<TakerTooltip />} cursor={{ fill: 'hsl(var(--border) / 0.2)' }} />
                  <Bar dataKey="buy" fill="#10b981" name="Buy Vol" radius={[3, 3, 0, 0]} animationDuration={700} />
                  <Bar dataKey="sell" fill="#f43f5e" name="Sell Vol" radius={[3, 3, 0, 0]} animationDuration={700} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Stacked % bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="text-emerald-500 font-semibold">
                  BUY {interp.buyPct.toFixed(1)}%
                </span>
                <span className="text-rose-500 font-semibold">
                  SELL {interp.sellPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${interp.buyPct}%` }}
                />
                <div
                  className="h-full bg-rose-500 transition-all duration-500"
                  style={{ width: `${interp.sellPct}%` }}
                />
              </div>
            </div>

            <div
              className={cn(
                'flex items-start gap-2 rounded-md border p-2 text-xs',
                interp.signal === 'bullish'
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                  : interp.signal === 'bearish'
                    ? 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400'
                    : 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400'
              )}
            >
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="leading-snug">{interp.advice}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Funding summary table (bottom)
// ---------------------------------------------------------------------------
type SortKey = 'rate' | 'symbol' | 'nextFunding' | 'oi';

function FundingSummaryTable({
  entries,
  isLoading,
  selected,
  onSelectAsset,
}: {
  entries: FundingAllEntry[];
  isLoading: boolean;
  selected: string;
  onSelectAsset: (s: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('rate');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const filtered = entries.filter((e) => e.symbol.endsWith('USDT'));
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'rate') cmp = a.rate - b.rate;
      else if (sortKey === 'symbol') cmp = a.symbol.localeCompare(b.symbol);
      else if (sortKey === 'nextFunding') cmp = a.nextFunding - b.nextFunding;
      else if (sortKey === 'oi') cmp = a.oiValue - b.oiValue;
      return sortAsc ? cmp : -cmp;
    });
    return arr.slice(0, 20);
  }, [entries, sortKey, sortAsc]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(!sortAsc);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.15 }}
    >
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-emerald-500" />
              Market-Wide Funding Summary
              <InfoTip text="Top 20 USDT perpetuals by absolute funding rate. Most extreme positioning first. Click a row to load its detail charts above." />
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">
              Top 20 by |rate|
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Sorted by {sortKey === 'rate' ? 'absolute funding rate' : sortKey}. Click any column to sort.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {isLoading ? (
            <div className="space-y-1 px-4 pb-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-card/80 backdrop-blur-sm z-10">
                <TableRow className="border-border/50 hover:bg-transparent">
                  <SortHeader
                    label="Symbol"
                    k="symbol"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={() => toggleSort('symbol')}
                  />
                  <SortHeader
                    label="Funding Rate"
                    k="rate"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={() => toggleSort('rate')}
                    align="right"
                  />
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <div className="inline-flex items-center gap-1">
                      Next Funding
                      <InfoTip text="Countdown to the next funding payment (typically every 8h on Binance)." />
                    </div>
                  </TableHead>
                  <SortHeader
                    label="OI ($)"
                    k="oi"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={() => toggleSort('oi')}
                    align="right"
                  />
                  <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Signal
                  </TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                      No funding data available.
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((e) => {
                    const interp = interpretFundingRate(e.rate);
                    const isSelected = selected === e.symbol;
                    return (
                      <TableRow
                        key={e.symbol}
                        onClick={() => onSelectAsset(e.symbol)}
                        className={cn(
                          'cursor-pointer transition-all group',
                          isSelected
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/15'
                            : 'hover:bg-emerald-500/[0.04] hover:translate-x-0.5'
                        )}
                      >
                        <TableCell className="font-mono text-xs font-semibold">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full transition-all',
                                isSelected
                                  ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]'
                                  : 'bg-muted-foreground/30 group-hover:bg-emerald-500/50'
                              )}
                            />
                            {cleanSymbol(e.symbol)}
                            <span className="text-[10px] text-muted-foreground">/USDT</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={cn(
                              'inline-flex items-center gap-0.5 font-mono text-xs font-bold tabular-nums',
                              e.rate >= 0 ? 'text-rose-500' : 'text-emerald-500'
                            )}
                          >
                            {e.rate >= 0 ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )}
                            {fmtFundingPct(e.rate)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <FundingCountdownPill nextFunding={e.nextFunding} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {e.oiValue > 0 ? (
                            fmtUsd(e.oiValue)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <SignalBadge signal={interp.signal} label={interp.label} compact />
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/crypto/${encodeURIComponent(e.symbol)}`}
                            onClick={(ev) => ev.stopPropagation()}
                            className="text-muted-foreground hover:text-emerald-500 transition-colors"
                            aria-label={`Open ${e.symbol} detail page`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Reusable bits
// ---------------------------------------------------------------------------
function SortHeader({
  label,
  k,
  sortKey,
  sortAsc,
  onSort,
  align = 'left',
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: () => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey === k;
  return (
    <TableHead
      onClick={onSort}
      className={cn(
        'cursor-pointer hover:text-foreground text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          align === 'right' && 'flex-row-reverse',
          active && 'text-emerald-500'
        )}
      >
        {label}
        {active ? (
          sortAsc ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <span className="h-3 w-3 opacity-30">·</span>
        )}
      </span>
    </TableHead>
  );
}

function FundingCountdownPill({ nextFunding }: { nextFunding: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const cd = fundingCountdown(nextFunding);
  const urgencyClass =
    cd.urgency === 'imminent'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-500'
      : cd.urgency === 'near'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
        urgencyClass
      )}
    >
      <span
        className={cn(
          'h-1 w-1 rounded-full',
          cd.urgency === 'imminent'
            ? 'bg-rose-500 animate-pulse'
            : cd.urgency === 'near'
              ? 'bg-amber-500 animate-pulse'
              : 'bg-emerald-500'
        )}
      />
      {cd.label}
    </span>
  );
}

function SignalBadge({
  signal,
  label,
  compact,
}: {
  signal: DerivativeSignal;
  label: string;
  compact?: boolean;
}) {
  const cfg = SIGNAL_BADGE[signal];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        cfg.classes
      )}
    >
      <Icon className={cn('h-3 w-3', compact && 'h-2.5 w-2.5')} />
      {!compact && label}
      {compact && signal}
    </span>
  );
}

function FundingStatTile({
  label,
  value,
  sub,
  icon,
  accent,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'rose' | 'amber' | 'teal' | 'zinc' | 'orange';
  hint?: string;
}) {
  const accentMap: Record<string, { border: string; bg: string; text: string }> = {
    emerald: { border: 'border-emerald-500/20', bg: 'from-emerald-500/10', text: 'text-emerald-500' },
    rose: { border: 'border-rose-500/20', bg: 'from-rose-500/10', text: 'text-rose-500' },
    amber: { border: 'border-amber-500/20', bg: 'from-amber-500/10', text: 'text-amber-500' },
    teal: { border: 'border-teal-500/20', bg: 'from-teal-500/10', text: 'text-teal-500' },
    zinc: { border: 'border-zinc-500/20', bg: 'from-zinc-500/10', text: 'text-zinc-400' },
    orange: { border: 'border-orange-500/20', bg: 'from-orange-500/10', text: 'text-orange-500' },
  };
  const a = accentMap[accent];
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-gradient-to-br to-transparent p-3 transition-all duration-200',
        a.border,
        a.bg
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className={cn('opacity-80', a.text)}>{icon}</span>
      </div>
      <div className={cn('mt-1 text-lg font-bold font-mono tabular-nums', a.text)}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      {hint && (
        <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <InfoTip text={hint} />
        </div>
      )}
    </motion.div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More information"
          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-left">{text}</TooltipContent>
    </Tooltip>
  );
}

function SkeletonPanel({ height = 200 }: { height?: number }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-[200px] w-full" style={{ height }} />
    </div>
  );
}

function ErrorBlock({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <AlertCircle className="h-7 w-7 text-rose-500" />
      <div className="text-sm text-rose-500">Failed to load data</div>
      <div className="text-xs text-muted-foreground max-w-md">{error?.message}</div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3 w-3" /> Retry
      </Button>
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <AlertTriangle className="h-7 w-7 text-amber-500" />
      <div className="text-xs text-muted-foreground">{message}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recharts custom tooltips
// ---------------------------------------------------------------------------
function DualAxisTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const time = payload[0]?.payload?.time;
  const oiRaw = payload.find((p: any) => p.dataKey === 'oi')?.value;
  const price = payload.find((p: any) => p.dataKey === 'price')?.value;
  return (
    <div className="rounded-md border border-border/60 bg-popover/95 backdrop-blur-sm p-2 text-xs shadow-lg">
      <div className="font-semibold text-foreground mb-1">{fmtTimeShort(time)}</div>
      <div className="space-y-0.5 font-mono">
        <div className="flex items-center justify-between gap-3">
          <span className="text-emerald-500">OI (USDT)</span>
          <span className="tabular-nums">{oiRaw != null ? fmtUsd(oiRaw) : '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-400">Price</span>
          <span className="tabular-nums">{price != null ? `$${fmtCompact(price)}` : '—'}</span>
        </div>
      </div>
    </div>
  );
}

function LsRatioTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const ratio = p.ratio;
  const interp = ratio > 0 ? interpretLongShortRatio(ratio) : null;
  return (
    <div className="rounded-md border border-border/60 bg-popover/95 backdrop-blur-sm p-2 text-xs shadow-lg max-w-[260px]">
      <div className="font-semibold text-foreground mb-1">{fmtTimeShort(p.time)}</div>
      <div className="space-y-0.5 font-mono">
        <div className="flex items-center justify-between gap-3">
          <span className="text-teal-500">L/S Ratio</span>
          <span className="tabular-nums">{ratio.toFixed(3)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-emerald-500">Long</span>
          <span className="tabular-nums">{p.longPct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-rose-500">Short</span>
          <span className="tabular-nums">{p.shortPct.toFixed(1)}%</span>
        </div>
      </div>
      {interp && (
        <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground leading-snug">
          {interp.label} · {interp.signal}
        </div>
      )}
    </div>
  );
}

function TakerTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const total = p.buy + p.sell;
  const interp = total > 0 ? interpretTakerVolume(p.buy, p.sell) : null;
  return (
    <div className="rounded-md border border-border/60 bg-popover/95 backdrop-blur-sm p-2 text-xs shadow-lg max-w-[260px]">
      <div className="font-semibold text-foreground mb-1">{fmtTimeShort(p.time)}</div>
      <div className="space-y-0.5 font-mono">
        <div className="flex items-center justify-between gap-3">
          <span className="text-emerald-500">Buy Vol</span>
          <span className="tabular-nums">{fmtCompact(p.buy)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-rose-500">Sell Vol</span>
          <span className="tabular-nums">{fmtCompact(p.sell)}</span>
        </div>
      </div>
      {interp && (
        <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground leading-snug">
          {interp.label}
        </div>
      )}
    </div>
  );
}
