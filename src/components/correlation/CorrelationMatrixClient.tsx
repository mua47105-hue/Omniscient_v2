'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Grid3x3,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Search,
  Check,
  X,
  Plus,
  Layers,
  TrendingUp,
  TrendingDown,
  Activity,
  Bitcoin,
  ArrowLeftRight,
  Boxes,
  BarChart3,
  Building2,
  Coins,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ChevronRight,
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  ReferenceLine,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { ApiResult, Ticker } from '@/lib/types';
import {
  computeCorrelationMatrix,
  computeDiversificationScore,
  averageAbsoluteCorrelation,
  interpretCorrelation,
  topPairs,
  linearRegression,
  type CorrelationCell,
} from '@/lib/analysis/correlation';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------
interface AssetOption {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  changePct: number;
}

interface ReturnsResponse {
  data: Record<string, number[]>;
  warnings?: string[];
}

const CLASS_ORDER = ['crypto', 'forex', 'commodity', 'index', 'stock'] as const;
const CLASS_LABEL: Record<string, string> = {
  crypto: 'Crypto',
  forex: 'Forex',
  commodity: 'Commodities',
  index: 'Indices',
  stock: 'Stocks',
};

const WINDOW_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 30, label: '30D' },
  { value: 60, label: '60D' },
  { value: 90, label: '90D' },
  { value: 180, label: '180D' },
];

// Default selection per spec: 10 crypto + 6 forex + 4 commodities + 4 indices.
const DEFAULT_SELECTION: string[] = [
  // 10 crypto (all seeded)
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'POLUSDT',
  // 6 forex majors
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD',
  // 4 commodities
  'GOLD', 'SILVER', 'OIL', 'COPPER',
  // 4 indices
  'SP500', 'NASDAQ', 'DOW', 'NIFTY50',
];

const STORAGE_KEY = 'omniscient.correlation.v1';

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
async function fetchAssets(): Promise<AssetOption[]> {
  const [cryptoRes, marketsRes] = await Promise.all([
    fetch('/api/crypto/prices', { cache: 'no-store' }),
    fetch('/api/markets/quotes?class=all', { cache: 'no-store' }),
  ]);
  const cryptoJson: ApiResult<Ticker[]> = await cryptoRes.json();
  const marketsJson: ApiResult<Record<string, unknown>> = await marketsRes.json();

  const out: AssetOption[] = [];
  if (cryptoJson.success && Array.isArray(cryptoJson.data)) {
    for (const t of cryptoJson.data) {
      out.push({
        symbol: t.symbol,
        name: t.symbol,
        assetClass: 'crypto',
        price: t.price,
        changePct: t.changePct,
      });
    }
  }
  if (marketsJson.success && marketsJson.data) {
    for (const [sym, qRaw] of Object.entries(marketsJson.data)) {
      const q = qRaw as {
        assetClass?: string;
        name?: string;
        price?: number;
        changePct?: number;
      };
      if (q.assetClass === 'crypto') continue;
      out.push({
        symbol: sym,
        name: q.name || sym,
        assetClass: q.assetClass || 'unknown',
        price: q.price || 0,
        changePct: q.changePct || 0,
      });
    }
  }
  out.sort((a, b) => {
    const ai = CLASS_ORDER.indexOf(a.assetClass as typeof CLASS_ORDER[number]);
    const bi = CLASS_ORDER.indexOf(b.assetClass as typeof CLASS_ORDER[number]);
    if (ai !== bi) return ai - bi;
    return a.symbol.localeCompare(b.symbol);
  });
  return out;
}

async function fetchReturns(
  symbols: string[],
  days: number,
): Promise<ReturnsResponse> {
  const url = `/api/correlation/returns?symbols=${encodeURIComponent(symbols.join(','))}&days=${days}`;
  const r = await fetch(url, { cache: 'no-store' });
  const j: ApiResult<Record<string, number[]>> & { warnings?: string[] } = await r.json();
  if (!j.success || !j.data) {
    throw new Error(j.error || 'Failed to load correlation data');
  }
  return { data: j.data, warnings: j.warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function cleanSymbol(sym: string): string {
  return sym
    .replace(/USDT$/, '')
    .replace(/=X$/, '')
    .replace(/\.NS$|\.BO$/, '')
    .replace(/-USD$/, '')
    .replace(/=F$/, '');
}

function classColor(c: string): string {
  switch (c) {
    case 'crypto': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
    case 'forex': return 'text-teal-500 bg-teal-500/10 border-teal-500/30';
    case 'commodity': return 'text-amber-500 bg-amber-500/10 border-amber-500/30';
    case 'index': return 'text-orange-500 bg-orange-500/10 border-orange-500/30';
    case 'stock': return 'text-rose-500 bg-rose-500/10 border-rose-500/30';
    default: return 'text-muted-foreground bg-muted border-border';
  }
}

function classDot(c: string): string {
  switch (c) {
    case 'crypto': return 'bg-emerald-500';
    case 'forex': return 'bg-teal-500';
    case 'commodity': return 'bg-amber-500';
    case 'index': return 'bg-orange-500';
    case 'stock': return 'bg-rose-500';
    default: return 'bg-muted-foreground';
  }
}

function ClassIcon({ ac, className }: { ac: string; className?: string }) {
  if (ac === 'crypto') return <Bitcoin className={className} />;
  if (ac === 'forex') return <ArrowLeftRight className={className} />;
  if (ac === 'stock') return <Building2 className={className} />;
  if (ac === 'index') return <BarChart3 className={className} />;
  if (ac === 'commodity') return <Boxes className={className} />;
  return <Coins className={className} />;
}

// ---------------------------------------------------------------------------
// Persistence hook (localStorage)
// ---------------------------------------------------------------------------
function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(initial);

  // Hydrate once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(parsed);
      }
    } catch {
      /* ignore */
    }
  }, [key]);

  // Write on change.
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [key, state]);

  return [state, setState];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function CorrelationMatrixClient() {
  const queryClient = useQueryClient();

  const [selected, setSelected] = usePersistedState<string[]>(STORAGE_KEY, DEFAULT_SELECTION);
  const [days, setDays] = usePersistedState<number>(STORAGE_KEY + '.days', 90);
  const [searchQuery, setSearchQuery] = useState('');
  const [detailPair, setDetailPair] = useState<{ a: string; b: string } | null>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  // Fetch the asset list (for the picker).
  const assetsQ = useQuery({
    queryKey: ['correlation-assets'],
    queryFn: fetchAssets,
    staleTime: 5 * 60_000,
  });

  // Fetch returns for the selected symbols — only enabled when ≥2 symbols selected.
  const sortedSelected = useMemo(
    () => [...selected].sort((a, b) => a.localeCompare(b)),
    [selected],
  );
  const returnsQ = useQuery({
    queryKey: ['correlation-returns', sortedSelected.join(','), days],
    queryFn: () => fetchReturns(sortedSelected, days),
    enabled: sortedSelected.length >= 2,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  // Compute the matrix + derived metrics.
  const matrix = useMemo<CorrelationCell[]>(() => {
    if (!returnsQ.data?.data) return [];
    // Preserve selected order (NOT sorted) for the matrix axes.
    const present = selected.filter((s) => returnsQ.data!.data[s]?.length >= 2);
    if (present.length < 2) return [];
    const returnsObj: Record<string, number[]> = {};
    for (const s of present) returnsObj[s] = returnsQ.data.data[s];
    return computeCorrelationMatrix(returnsObj);
  }, [returnsQ.data, selected]);

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const c of matrix) {
      set.add(c.a);
      set.add(c.b);
    }
    return [...set];
  }, [matrix]);

  const score = useMemo(() => computeDiversificationScore(matrix), [matrix]);
  const avgAbsR = useMemo(() => averageAbsoluteCorrelation(matrix), [matrix]);
  const topPos = useMemo(() => topPairs(matrix, 'positive', 5), [matrix]);
  const topNeg = useMemo(() => topPairs(matrix, 'negative', 5), [matrix]);
  const sampleSize = matrix.find((c) => !c.diagonal)?.n ?? 0;

  // Refresh handler.
  async function refresh() {
    toast.info('Recomputing correlations…');
    try {
      await queryClient.invalidateQueries({ queryKey: ['correlation-returns'] });
      await queryClient.refetchQueries({ queryKey: ['correlation-returns'] });
      toast.success('Matrix refreshed');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      toast.error('Refresh failed', { description: msg });
    }
  }

  // Selection helpers
  function toggleSymbol(sym: string) {
    setSelected((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym],
    );
  }
  function selectAllOfClass(cls: string) {
    const syms = (assetsQ.data || [])
      .filter((a) => a.assetClass === cls)
      .map((a) => a.symbol);
    setSelected((prev) => [...new Set([...prev, ...syms])]);
  }
  function clearAll() {
    setSelected([]);
  }
  function resetToDefault() {
    setSelected(DEFAULT_SELECTION);
  }

  const isLoading = returnsQ.isLoading || returnsQ.isFetching;
  const isError = returnsQ.isError;
  const hasData = matrix.length > 0;
  const noSelection = selected.length === 0;

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
              <Grid3x3 className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Correlation Matrix</h1>
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Pearson correlation of daily returns · spot redundancy risks and hedge opportunities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </motion.div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <DiversificationGauge score={score} avgAbsR={avgAbsR} loading={isLoading && !hasData} />
        <StatTile
          label="Avg |r|"
          value={hasData ? avgAbsR.toFixed(3) : '—'}
          sub="lower = more diversified"
          icon={<Activity className="h-4 w-4" />}
          accent={avgAbsR < 0.3 ? 'emerald' : avgAbsR < 0.6 ? 'amber' : 'rose'}
          loading={isLoading && !hasData}
        />
        <StatTile
          label="Selected Assets"
          value={String(selected.length)}
          sub={`${symbols.length} with data`}
          icon={<Layers className="h-4 w-4" />}
          accent="teal"
          loading={false}
        />
        <StatTile
          label="Sample Size"
          value={hasData ? `${sampleSize}d` : '—'}
          sub={`over ${days}D window`}
          icon={<BarChart3 className="h-4 w-4" />}
          accent="orange"
          loading={isLoading && !hasData}
        />
      </div>

      {/* Window selector + warnings */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Window:</span>
          <div className="inline-flex rounded-md border border-border/60 bg-card/40 p-0.5 gap-0.5">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded transition-colors',
                  days === opt.value
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {returnsQ.data?.warnings && returnsQ.data.warnings.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="inline-flex items-center gap-1.5 text-xs text-amber-500 hover:underline">
                <AlertTriangle className="h-3.5 w-3.5" />
                {returnsQ.data.warnings.length} warning(s)
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm bg-popover text-popover-foreground border border-border shadow-xl">
              <ul className="space-y-1 text-[11px]">
                {returnsQ.data.warnings.map((w, i) => (
                  <li key={i} className="font-mono">{w}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Main layout: picker sidebar + matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Asset Selection Panel */}
        <AssetSelectionPanel
          assets={assetsQ.data || []}
          loading={assetsQ.isLoading}
          selected={selected}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onToggle={toggleSymbol}
          onSelectAllOfClass={selectAllOfClass}
          onClear={clearAll}
          onResetDefault={resetToDefault}
        />

        {/* Matrix + Top correlations */}
        <div className="space-y-4 min-w-0">
          {noSelection ? (
            <EmptyState onResetDefault={resetToDefault} />
          ) : isError ? (
            <ErrorState
              message={returnsQ.error?.message || 'Failed to load correlation data'}
              onRetry={() => returnsQ.refetch()}
            />
          ) : isLoading && !hasData ? (
            <MatrixSkeleton n={Math.min(selected.length, 12)} />
          ) : hasData ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <HeatmapMatrix
                symbols={symbols}
                matrix={matrix}
                selectedCell={selectedCell}
                onSelectCell={(key) => setSelectedCell((prev) => (prev === key ? null : key))}
                onOpenPair={(a, b) => setDetailPair({ a, b })}
                assets={assetsQ.data || []}
                loading={isLoading}
              />
            </motion.div>
          ) : null}

          {/* Top correlations */}
          {hasData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TopCorrelationsList
                title="Strongest Positive"
                subtitle="Redundancy risks — these assets move together"
                pairs={topPos}
                assets={assetsQ.data || []}
                direction="positive"
                onOpenPair={(a, b) => setDetailPair({ a, b })}
              />
              <TopCorrelationsList
                title="Strongest Negative"
                subtitle="Hedging opportunities — these move against each other"
                pairs={topNeg}
                assets={assetsQ.data || []}
                direction="negative"
                onOpenPair={(a, b) => setDetailPair({ a, b })}
              />
            </div>
          )}
        </div>
      </div>

      {/* Detail dialog: scatter plot + regression line */}
      <DetailDialog
        pair={detailPair}
        returns={returnsQ.data?.data}
        assets={assetsQ.data || []}
        onClose={() => setDetailPair(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------
function StatTile({
  label,
  value,
  sub,
  icon,
  accent,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'rose' | 'amber' | 'teal' | 'orange';
  loading: boolean;
}) {
  const accentMap: Record<string, string> = {
    emerald: 'text-emerald-500',
    rose: 'text-rose-500',
    amber: 'text-amber-500',
    teal: 'text-teal-500',
    orange: 'text-orange-500',
  };
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className={accentMap[accent]}>{icon}</span>
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-2" />
        ) : (
          <div className={cn('text-2xl font-bold font-mono tabular-nums mt-1', accentMap[accent])}>
            {value}
          </div>
        )}
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Diversification gauge (circular SVG)
// ---------------------------------------------------------------------------
function DiversificationGauge({
  score,
  avgAbsR,
  loading,
}: {
  score: number;
  avgAbsR: number;
  loading: boolean;
}) {
  // Color: rose <30, amber 30–60, emerald >60.
  const tier: 'rose' | 'amber' | 'emerald' =
    score < 30 ? 'rose' : score < 60 ? 'amber' : 'emerald';
  const tierColor: Record<string, string> = {
    rose: '#f43f5e',
    amber: '#f59e0b',
    emerald: '#10b981',
  };
  const tierLabel: Record<string, string> = {
    rose: 'Poor',
    amber: 'Moderate',
    emerald: 'Strong',
  };
  const tierIcon: Record<string, React.ReactNode> = {
    rose: <ShieldAlert className="h-4 w-4" />,
    amber: <ShieldQuestion className="h-4 w-4" />,
    emerald: <ShieldCheck className="h-4 w-4" />,
  };

  const R = 36;
  const C = 2 * Math.PI * R; // circumference
  const pct = Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * C;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="relative h-[88px] w-[88px] shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-muted/40"
            />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={tierColor[tier]}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C - dash}`}
              style={{ transition: 'stroke-dasharray 0.6s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <span
                  className="text-xl font-bold font-mono tabular-nums"
                  style={{ color: tierColor[tier] }}
                >
                  {Math.round(score)}
                </span>
                <span className="text-[9px] text-muted-foreground -mt-0.5">/100</span>
              </>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span style={{ color: tierColor[tier] }}>{tierIcon[tier]}</span>
            Diversification
          </div>
          <div
            className="text-sm font-bold"
            style={{ color: tierColor[tier] }}
          >
            {tierLabel[tier]}
          </div>
          <div className="text-[10px] text-muted-foreground">
            avg |r| = {avgAbsR.toFixed(3)}
          </div>
          <div className="text-[10px] text-muted-foreground/80">
            score = 100 × (1 − avg|r|)
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Asset selection panel (left sidebar)
// ---------------------------------------------------------------------------
function AssetSelectionPanel({
  assets,
  loading,
  selected,
  searchQuery,
  onSearchChange,
  onToggle,
  onSelectAllOfClass,
  onClear,
  onResetDefault,
}: {
  assets: AssetOption[];
  loading: boolean;
  selected: string[];
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onToggle: (sym: string) => void;
  onSelectAllOfClass: (cls: string) => void;
  onClear: () => void;
  onResetDefault: () => void;
}) {
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return assets;
    const q = searchQuery.toLowerCase();
    return assets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.assetClass.toLowerCase().includes(q),
    );
  }, [assets, searchQuery]);

  const grouped = useMemo(() => {
    const g: Record<string, AssetOption[]> = {};
    for (const a of filtered) (g[a.assetClass] ||= []).push(a);
    return g;
  }, [filtered]);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm lg:sticky lg:top-4 h-fit">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-500" />
            Asset Universe
          </span>
          <Badge variant="outline" className="text-[10px] h-5">
            {selected.length} selected
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search symbol / name…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-1.5">
          {CLASS_ORDER.map((cls) => (
            <button
              key={cls}
              onClick={() => onSelectAllOfClass(cls)}
              className="text-[10px] px-2 py-0.5 rounded border border-border/60 bg-card/40 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              + {CLASS_LABEL[cls]}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] flex-1"
            onClick={onClear}
            disabled={selected.length === 0}
          >
            <X className="h-3 w-3" /> Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] flex-1"
            onClick={onResetDefault}
          >
            <RefreshCw className="h-3 w-3" /> Default
          </Button>
        </div>

        {/* Grouped list */}
        <div className="max-h-[480px] overflow-y-auto pr-1 -mr-1 space-y-3 scrollbar-thin">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-6">
              No assets match "{searchQuery}"
            </div>
          ) : (
            CLASS_ORDER.map((cls) => {
              const list = grouped[cls];
              if (!list || list.length === 0) return null;
              const classSelectedCount = list.filter((a) => selected.includes(a.symbol)).length;
              return (
                <div key={cls} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <ClassIcon ac={cls} className="h-3 w-3" />
                      {CLASS_LABEL[cls]}
                    </span>
                    <span className="font-mono">{classSelectedCount}/{list.length}</span>
                  </div>
                  <div className="space-y-1">
                    {list.map((a) => {
                      const isSelected = selected.includes(a.symbol);
                      return (
                        <button
                          key={a.symbol}
                          onClick={() => onToggle(a.symbol)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs text-left transition-all',
                            isSelected
                              ? 'border-emerald-500/40 bg-emerald-500/10'
                              : 'border-border/40 bg-card/30 hover:border-border hover:bg-muted/40',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              isSelected
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : 'border-border/60',
                            )}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </span>
                          <span className={cn('h-2 w-2 rounded-full shrink-0', classDot(a.assetClass))} />
                          <span className="font-mono font-semibold text-foreground truncate flex-1">
                            {cleanSymbol(a.symbol)}
                          </span>
                          <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                            {a.name === a.symbol ? '' : a.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyState({ onResetDefault }: { onResetDefault: () => void }) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
          <Grid3x3 className="h-8 w-8" />
        </div>
        <div className="space-y-1">
          <div className="text-base font-semibold">Select assets to begin</div>
          <p className="text-xs text-muted-foreground max-w-md">
            Pick at least 2 assets from the picker on the left. We&apos;ll fetch their daily
            returns and compute pairwise Pearson correlation coefficients so you can spot
            redundancy risks and hedge opportunities.
          </p>
        </div>
        <Button onClick={onResetDefault} size="sm">
          <Plus className="h-4 w-4" /> Load default universe (24 assets)
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-rose-500/30 bg-rose-500/5">
      <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-rose-500" />
        <div className="text-sm font-semibold text-rose-500">Failed to load correlations</div>
        <div className="text-xs text-muted-foreground max-w-md">{message}</div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" /> Retry
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Matrix skeleton
// ---------------------------------------------------------------------------
function MatrixSkeleton({ n }: { n: number }) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `auto repeat(${n}, minmax(0, 1fr))` }}
          >
            <div />
            {Array.from({ length: n }).map((_, i) => (
              <Skeleton key={`h-${i}`} className="aspect-square" />
            ))}
            {Array.from({ length: n }).map((_, r) => (
              <div key={`r-${r}`} className="contents">
                <Skeleton className="aspect-square" />
                {Array.from({ length: n }).map((_, c) => (
                  <Skeleton key={`c-${r}-${c}`} className="aspect-square" />
                ))}
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm rounded-md">
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card/80 border border-border/60 px-3 py-2 rounded-md shadow-md">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              Computing correlations…
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Heatmap matrix
// ---------------------------------------------------------------------------
function HeatmapMatrix({
  symbols,
  matrix,
  selectedCell,
  onSelectCell,
  onOpenPair,
  assets,
  loading,
}: {
  symbols: string[];
  matrix: CorrelationCell[];
  selectedCell: string | null;
  onSelectCell: (key: string) => void;
  onOpenPair: (a: string, b: string) => void;
  assets: AssetOption[];
  loading: boolean;
}) {
  const assetBySymbol = useMemo(() => {
    const m = new Map<string, AssetOption>();
    for (const a of assets) m.set(a.symbol, a);
    return m;
  }, [assets]);

  // Index cells by "i-j" for O(1) lookup.
  const cellMap = useMemo(() => {
    const m = new Map<string, CorrelationCell>();
    for (const c of matrix) m.set(`${c.i}-${c.j}`, c);
    return m;
  }, [matrix]);

  const N = symbols.length;
  if (N === 0) return null;

  // Cap stagger to 200ms total — delay = min(index * 5ms, 200ms).
  function staggerDelay(index: number): number {
    return Math.min(index * 0.005, 0.2);
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm relative">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <Grid3x3 className="h-4 w-4 text-emerald-500" />
            {N}×{N} Correlation Matrix
          </span>
          <div className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
            {loading && <Loader2 className="h-3 w-3 animate-spin text-emerald-500" />}
            <span>Pearson · daily returns</span>
          </div>
        </CardTitle>
        <CardDescription className="text-xs">
          Click any cell for a scatter plot · hover for interpretation · diagonal cells are self-correlation
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Scrollable matrix container — preserves aspect-square on small screens. */}
        <div className="overflow-x-auto scrollbar-thin">
          <div
            className="grid gap-[2px] min-w-fit"
            style={{
              gridTemplateColumns: `auto repeat(${N}, minmax(0, 1fr))`,
            }}
          >
            {/* Top-left corner */}
            <div className="aspect-square" />
            {/* Top header row (column labels) */}
            {symbols.map((sym, j) => (
              <MatrixAxisLabel
                key={`top-${sym}`}
                sym={sym}
                asset={assetBySymbol.get(sym)}
                variant="top"
              />
            ))}
            {/* Body rows */}
            {symbols.map((rowSym, i) => (
              <div key={`row-${rowSym}`} className="contents">
                <MatrixAxisLabel
                  sym={rowSym}
                  asset={assetBySymbol.get(rowSym)}
                  variant="left"
                />
                {symbols.map((colSym, j) => {
                  const cell = cellMap.get(`${i}-${j}`);
                  if (!cell) {
                    return <div key={`c-${i}-${j}`} className="aspect-square bg-muted/20 rounded-sm" />;
                  }
                  const cellIdx = i * N + j;
                  return (
                    <HeatmapCell
                      key={`c-${i}-${j}`}
                      cell={cell}
                      assetA={assetBySymbol.get(cell.a)}
                      assetB={assetBySymbol.get(cell.b)}
                      delay={staggerDelay(cellIdx)}
                      isSelected={selectedCell === `${cell.a}|${cell.b}`}
                      onSelect={() => onSelectCell(`${cell.a}|${cell.b}`)}
                      onOpen={() => onOpenPair(cell.a, cell.b)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Color legend */}
        <ColorLegend />
      </CardContent>
    </Card>
  );
}

function MatrixAxisLabel({
  sym,
  asset,
  variant,
}: {
  sym: string;
  asset?: AssetOption;
  variant: 'top' | 'left';
}) {
  const cls = asset?.assetClass || 'unknown';
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1 p-1 min-w-[44px]',
        variant === 'top' ? 'aspect-auto flex-col pb-1.5' : 'aspect-square flex-row justify-end pr-1.5',
      )}
    >
      <span className={cn('h-2 w-2 rounded-full shrink-0', classDot(cls))} />
      <span className="text-[9px] sm:text-[10px] font-mono font-semibold leading-none">
        {cleanSymbol(sym)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heatmap cell
// ---------------------------------------------------------------------------
function HeatmapCell({
  cell,
  assetA,
  assetB,
  delay,
  isSelected,
  onSelect,
  onOpen,
}: {
  cell: CorrelationCell;
  assetA?: AssetOption;
  assetB?: AssetOption;
  delay: number;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const interp = interpretCorrelation(cell.r);
  const isDiagonal = cell.diagonal;
  const isHoverable = !isDiagonal && isFinite(cell.r);
  const nameA = assetA?.name || cleanSymbol(cell.a);
  const nameB = assetB?.name || cleanSymbol(cell.b);

  const cellBg = isDiagonal
    ? 'linear-gradient(135deg, rgb(39 39 42 / 0.6), rgb(24 24 27 / 0.8))'
    : interp.rgba;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, delay }}
      className="aspect-square relative"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => {
              if (isDiagonal) return;
              onSelect();
              onOpen();
            }}
            disabled={isDiagonal}
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-sm border text-[9px] sm:text-[10px] font-mono font-bold tabular-nums transition-all',
              isDiagonal
                ? 'cursor-default text-zinc-600 border-zinc-800/40'
                : 'cursor-pointer hover:scale-[1.08] hover:z-10 hover:ring-2 hover:ring-offset-1 hover:ring-offset-background',
              isSelected && !isDiagonal && 'ring-2 ring-emerald-500 ring-offset-1 ring-offset-background z-10',
            )}
            style={{
              background: cellBg,
              color: isDiagonal
                ? '#52525b'
                : Math.abs(cell.r) > 0.5
                  ? '#ffffff'
                  : 'rgb(244 244 245)',
              borderColor: isDiagonal ? 'transparent' : `${interp.color}40`,
            }}
            aria-label={`${nameA} vs ${nameB}: r=${cell.r.toFixed(2)}`}
          >
            {isDiagonal ? (
              <span className="text-[8px] sm:text-[9px] font-sans font-normal opacity-50 rotate-45">
                self
              </span>
            ) : (
              <span className="drop-shadow-sm">
                {isFinite(cell.r) ? cell.r.toFixed(2) : '—'}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent className="bg-popover text-popover-foreground border border-border shadow-xl max-w-[280px]">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', classDot(assetA?.assetClass || ''))} />
              <span className="font-mono font-bold text-xs">{cleanSymbol(cell.a)}</span>
              <span className="text-[10px] text-muted-foreground">×</span>
              <span className={cn('h-2 w-2 rounded-full', classDot(assetB?.assetClass || ''))} />
              <span className="font-mono font-bold text-xs">{cleanSymbol(cell.b)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40">
              <span className="text-[10px] text-muted-foreground">Pearson r</span>
              <span
                className="font-mono font-bold text-sm tabular-nums"
                style={{ color: interp.color }}
              >
                {isFinite(cell.r) ? cell.r.toFixed(3) : 'N/A'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="text-[9px] h-4 px-1.5"
                style={{ borderColor: `${interp.color}80`, color: interp.color }}
              >
                {interp.label}
              </Badge>
              {isHoverable && (
                <span className="text-[10px] text-muted-foreground">
                  n={cell.n}
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground leading-snug">
              {interp.advice}
            </div>
            {isHoverable && (
              <div className="text-[10px] text-emerald-500 pt-0.5 flex items-center gap-1">
                Click for scatter plot <ChevronRight className="h-2.5 w-2.5" />
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Color legend
// ---------------------------------------------------------------------------
function ColorLegend() {
  return (
    <div className="mt-4 flex items-center gap-3 justify-center">
      <span className="text-[10px] text-muted-foreground font-mono">−1.0</span>
      <div
        className="h-3 w-48 rounded-full"
        style={{
          background:
            'linear-gradient(to right, rgba(244,63,94,0.95) 0%, rgba(63,63,70,0.2) 50%, rgba(16,185,129,0.95) 100%)',
        }}
      />
      <span className="text-[10px] text-muted-foreground font-mono">+1.0</span>
      <div className="hidden sm:flex items-center gap-3 ml-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-rose-500" /> Negative
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-zinc-500" /> Neutral
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Positive
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top correlations list
// ---------------------------------------------------------------------------
function TopCorrelationsList({
  title,
  subtitle,
  pairs,
  assets,
  direction,
  onOpenPair,
}: {
  title: string;
  subtitle: string;
  pairs: CorrelationCell[];
  assets: AssetOption[];
  direction: 'positive' | 'negative';
  onOpenPair: (a: string, b: string) => void;
}) {
  const accent = direction === 'positive' ? 'emerald' : 'rose';
  const Icon = direction === 'positive' ? TrendingUp : TrendingDown;
  const assetBySymbol = useMemo(() => {
    const m = new Map<string, AssetOption>();
    for (const a of assets) m.set(a.symbol, a);
    return m;
  }, [assets]);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon
            className={cn(
              'h-4 w-4',
              direction === 'positive' ? 'text-emerald-500' : 'text-rose-500',
            )}
          />
          {title}
        </CardTitle>
        <CardDescription className="text-[11px]">{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 max-h-[280px] overflow-y-auto scrollbar-thin">
        {pairs.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            No pairs available
          </div>
        ) : (
          pairs.map((c) => {
            const interp = interpretCorrelation(c.r);
            const aA = assetBySymbol.get(c.a);
            const aB = assetBySymbol.get(c.b);
            return (
              <button
                key={`${c.a}-${c.b}`}
                onClick={() => onOpenPair(c.a, c.b)}
                className="w-full flex items-center gap-2 p-2 rounded-md border border-border/40 bg-card/30 hover:border-border hover:bg-muted/40 transition-all group"
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <PairBadge asset={aA} symbol={c.a} />
                  <span className="text-[10px] text-muted-foreground">×</span>
                  <PairBadge asset={aB} symbol={c.b} />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="font-mono font-bold text-sm tabular-nums"
                    style={{ color: interp.color }}
                  >
                    {c.r.toFixed(2)}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[9px] h-5 px-1.5"
                    style={{ borderColor: `${interp.color}80`, color: interp.color }}
                  >
                    {interp.label}
                  </Badge>
                  <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function PairBadge({ asset, symbol }: { asset?: AssetOption; symbol: string }) {
  const cls = asset?.assetClass || 'unknown';
  return (
    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/40 bg-card/40 min-w-0">
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', classDot(cls))} />
      <span className="font-mono font-semibold text-[11px] truncate">{cleanSymbol(symbol)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail dialog (scatter plot + regression line)
// ---------------------------------------------------------------------------
function DetailDialog({
  pair,
  returns,
  assets,
  onClose,
}: {
  pair: { a: string; b: string } | null;
  returns?: Record<string, number[]>;
  assets: AssetOption[];
  onClose: () => void;
}) {
  const open = pair !== null;
  const a = pair?.a;
  const b = pair?.b;
  const assetA = useMemo(() => assets.find((x) => x.symbol === a), [assets, a]);
  const assetB = useMemo(() => assets.find((x) => x.symbol === b), [assets, b]);

  const r = useMemo(() => {
    if (!open || !a || !b || !returns || !returns[a] || !returns[b]) return NaN;
    // Compute live (the lib helper is what the matrix uses too, but recomputing
    // here keeps this dialog self-contained and avoids passing the matrix down).
    const xs = returns[a];
    const ys = returns[b];
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return NaN;
    let sx = 0, sy = 0;
    for (let k = 0; k < n; k++) { sx += xs[k]; sy += ys[k]; }
    const mx = sx / n;
    const my = sy / n;
    let num = 0, dx = 0, dy = 0;
    for (let k = 0; k < n; k++) {
      const ddx = xs[k] - mx;
      const ddy = ys[k] - my;
      num += ddx * ddy;
      dx += ddx * ddx;
      dy += ddy * ddy;
    }
    const den = Math.sqrt(dx * dy);
    return den === 0 ? NaN : num / den;
  }, [open, a, b, returns]);

  const scatterData = useMemo(() => {
    if (!open || !a || !b || !returns || !returns[a] || !returns[b]) return [];
    const xs = returns[a];
    const ys = returns[b];
    const n = Math.min(xs.length, ys.length);
    const out: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < n; k++) {
      if (isFinite(xs[k]) && isFinite(ys[k])) {
        out.push({ x: xs[k], y: ys[k] });
      }
    }
    return out;
  }, [open, a, b, returns]);

  const regression = useMemo(() => {
    if (scatterData.length < 2) return null;
    return linearRegression(
      scatterData.map((p) => p.x),
      scatterData.map((p) => p.y),
    );
  }, [scatterData]);

  const interp = interpretCorrelation(r);

  // Compute axis ranges with small padding.
  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    if (scatterData.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const p of scatterData) {
      if (p.x < xmin) xmin = p.x;
      if (p.x > xmax) xmax = p.x;
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
    }
    const xpad = (xmax - xmin) * 0.1 || 1;
    const ypad = (ymax - ymin) * 0.1 || 1;
    return {
      xMin: Number((xmin - xpad).toFixed(2)),
      xMax: Number((xmax + xpad).toFixed(2)),
      yMin: Number((ymin - ypad).toFixed(2)),
      yMax: Number((ymax + ypad).toFixed(2)),
    };
  }, [scatterData]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            Correlation Detail
            <div className="flex items-center gap-2 ml-auto">
              <PairBadge asset={assetA} symbol={a || ''} />
              <span className="text-xs text-muted-foreground">×</span>
              <PairBadge asset={assetB} symbol={b || ''} />
            </div>
          </DialogTitle>
          <DialogDescription>
            Scatter plot of daily returns · each point = one trading day
          </DialogDescription>
        </DialogHeader>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border border-border/60 bg-card/40 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pearson r
            </div>
            <div
              className="text-2xl font-bold font-mono tabular-nums mt-1"
              style={{ color: interp.color }}
            >
              {isFinite(r) ? r.toFixed(3) : '—'}
            </div>
            <Badge
              variant="outline"
              className="text-[9px] h-4 mt-1.5"
              style={{ borderColor: `${interp.color}80`, color: interp.color }}
            >
              {interp.label}
            </Badge>
          </div>
          <div className="rounded-md border border-border/60 bg-card/40 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Sample size
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1 text-foreground">
              {scatterData.length}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1.5">trading days</div>
          </div>
          <div className="rounded-md border border-border/60 bg-card/40 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              β (slope)
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1 text-foreground">
              {regression ? regression.slope.toFixed(3) : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1.5">
              Δ{cleanSymbol(b || '')} per 1% Δ{cleanSymbol(a || '')}
            </div>
          </div>
        </div>

        {/* Scatter chart */}
        <div className="h-[300px] w-full rounded-md border border-border/40 bg-card/20 p-2">
          {scatterData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              No return data available for this pair
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart
                margin={{ top: 12, right: 16, bottom: 28, left: 8 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={cleanSymbol(a || '')}
                  domain={[xMin, xMax]}
                  tickFormatter={(v) => `${v.toFixed(1)}%`}
                  tick={{ fill: 'rgb(161 161 170)', fontSize: 10 }}
                  stroke="rgba(255,255,255,0.1)"
                  label={{
                    value: `${cleanSymbol(a || '')} daily return (%)`,
                    position: 'insideBottom',
                    offset: -16,
                    fill: 'rgb(161 161 170)',
                    fontSize: 11,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={cleanSymbol(b || '')}
                  domain={[yMin, yMax]}
                  tickFormatter={(v) => `${v.toFixed(1)}%`}
                  tick={{ fill: 'rgb(161 161 170)', fontSize: 10 }}
                  stroke="rgba(255,255,255,0.1)"
                  label={{
                    value: `${cleanSymbol(b || '')} (%)`,
                    angle: -90,
                    position: 'insideLeft',
                    fill: 'rgb(161 161 170)',
                    fontSize: 11,
                  }}
                />
                <ZAxis range={[16, 16]} />
                <RechartsTooltip
                  cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.2)' }}
                  contentStyle={{
                    background: 'rgb(24 24 27)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                  formatter={(value: number, name: string) => [
                    `${value.toFixed(2)}%`,
                    name === 'x' ? cleanSymbol(a || '') : cleanSymbol(b || ''),
                  ]}
                />
                <Scatter
                  data={scatterData}
                  fill={interp.color}
                  fillOpacity={0.55}
                  stroke={interp.color}
                  strokeOpacity={0.9}
                />
                {/* Zero reference lines */}
                <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 2" />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 2" />
                {/* Regression line */}
                {regression && regression.points.length === 2 && (
                  <Line
                    type="linear"
                    data={regression.points}
                    dataKey="y"
                    stroke={interp.color}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Interpretation */}
        <div
          className="rounded-md border p-3 text-xs leading-relaxed"
          style={{
            borderColor: `${interp.color}40`,
            background: `${interp.color}10`,
            color: 'rgb(212 212 216)',
          }}
        >
          <span className="font-semibold" style={{ color: interp.color }}>
            {interp.label}.
          </span>{' '}
          {interp.advice}
          {regression && isFinite(regression.slope) && regression.slope !== 0 && (
            <> A 1% move in {cleanSymbol(a || '')} is historically associated with a{' '}
              <span className="font-mono font-semibold">
                {regression.slope > 0 ? '+' : ''}
                {regression.slope.toFixed(2)}%
              </span>{' '}
              move in {cleanSymbol(b || '')}.</>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
