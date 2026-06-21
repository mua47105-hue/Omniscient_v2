'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell as RechartsCell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ScanLine,
  Activity,
  RefreshCw,
  Filter,
  RotateCcw,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Target,
  Layers,
  Search,
  SlidersHorizontal,
  X,
  BarChart3,
  CheckCircle2,
  Circle,
  Crosshair,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  TECHNICAL_FILTERS,
  FILTER_BY_KEY,
  FILTER_COLOR_CLASSES,
  FILTER_COLOR_HEX,
  PRESET_STRATEGIES,
  SORT_OPTIONS,
  type ScreenerResult,
  type SortKey,
  type FilterColor,
} from '@/lib/analysis/screener';
import type { ApiResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// API contract (mirrors src/app/api/screener/scan/route.ts)
// ---------------------------------------------------------------------------
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
  results: ScreenerResult[];
  stats: ScanStats;
}

interface ScanRequest {
  filters: string[];
  volumeMin: number;
  priceMin: number;
  priceMax: number;
  direction: 'all' | 'bullish' | 'bearish';
  sortBy: SortKey;
  topN: number;
  limit: number;
}

async function runScan(req: ScanRequest): Promise<ScanResponse> {
  const r = await fetch('/api/screener/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    cache: 'no-store',
  });
  const j: ApiResult<ScanResponse> = await r.json();
  if (!j.success || !j.data) {
    throw new Error(j.error || 'Scan failed');
  }
  return j.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TREND_STYLE: Record<
  ScreenerResult['trend'],
  { label: string; icon: typeof TrendingUp; cls: string }
> = {
  bullish: {
    label: 'Bullish',
    icon: TrendingUp,
    cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  },
  bearish: {
    label: 'Bearish',
    icon: TrendingDown,
    cls: 'bg-rose-500/10 text-rose-500 border-rose-500/30',
  },
  neutral: {
    label: 'Neutral',
    icon: Minus,
    cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  },
};

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(4);
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatPct(v: number): string {
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

function convictionColor(score: number): { text: string; bar: string; from: string; to: string } {
  if (score >= 60) {
    return {
      text: 'text-emerald-400',
      bar: 'bg-gradient-to-r',
      from: 'from-emerald-500',
      to: 'to-teal-400',
    };
  }
  if (score >= 30) {
    return {
      text: 'text-amber-400',
      bar: 'bg-gradient-to-r',
      from: 'from-amber-500',
      to: 'to-orange-400',
    };
  }
  return {
    text: 'text-rose-400',
    bar: 'bg-gradient-to-r',
    from: 'from-rose-500',
    to: 'to-rose-400',
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterChip({
  filterKey,
  active,
  onToggle,
}: {
  filterKey: string;
  active: boolean;
  onToggle: () => void;
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
          aria-pressed={active}
          className={cn(
            'group relative flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200 ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            active
              ? cn(c.activeBg, c.activeBorder, c.activeText, c.glow)
              : cn(c.bg, c.border, 'text-muted-foreground hover:scale-[1.03] hover:brightness-125'),
          )}
        >
          <Icon className={cn('h-3 w-3 shrink-0 transition-transform', active && 'scale-110')} />
          <span className="truncate">{filter.label}</span>
          {active && (
            <CheckCircle2 className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-left leading-snug">
        <div className="font-semibold">{filter.label}</div>
        <div className="text-[11px] text-muted-foreground">{filter.description}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'zinc',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: typeof Activity;
  tone?: FilterColor;
}) {
  const c = FILTER_COLOR_CLASSES[tone];
  return (
    <Card
      className={cn(
        'relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm',
        'transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg',
      )}
    >
      <div
        aria-hidden
        className={cn('absolute inset-0 opacity-30 pointer-events-none', c.bg)}
      />
      <CardContent className="relative p-4">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </Label>
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset ring-border/30',
              c.bg,
              c.text,
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

function ConvictionBar({ score }: { score: number }) {
  const c = convictionColor(score);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-[60px] overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border/30">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className={cn('h-full rounded-full', c.bar, c.from, c.to)}
          style={{ boxShadow: score > 0 ? '0 0 6px rgba(16,185,129,0.25)' : undefined }}
        />
      </div>
      <span className={cn('font-mono text-[11px] tabular-nums font-semibold', c.text)}>
        {score}
      </span>
    </div>
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
              <span className="block text-muted-foreground">{f.description}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  onClick: () => void;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
        active ? 'text-emerald-500' : 'text-muted-foreground hover:text-foreground',
        align === 'right' && 'justify-end',
        align === 'center' && 'justify-center',
      )}
    >
      {label}
      {active ? (
        direction === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-50" />
      )}
    </button>
  );
}

function ResultsRow({
  row,
  index,
}: {
  row: ScreenerResult;
  index: number;
}) {
  const trend = TREND_STYLE[row.trend];
  const TrendIcon = trend.icon;
  return (
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        ease: 'easeOut',
        delay: Math.min(index * 0.02, 0.4),
      }}
      className={cn(
        'group cursor-pointer border-b border-border/40 transition-all duration-200',
        'hover:bg-emerald-500/[0.04] hover:shadow-[inset_3px_0_0_0_rgba(16,185,129,0.6)]',
      )}
    >
      <td className="px-3 py-2.5">
        <Link
          href={`/crypto/${row.symbol}`}
          className="flex items-center gap-2.5"
          aria-label={`Open ${row.symbol} detail`}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 ring-1 ring-inset ring-emerald-500/20 text-[10px] font-bold text-emerald-500">
            {row.symbol.slice(0, 2)}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-mono text-xs font-semibold text-foreground group-hover:text-emerald-500 transition-colors">
              {row.symbol}
            </span>
            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
              {row.name}
            </span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-foreground">
        ${formatPrice(row.price)}
      </td>
      <td
        className={cn(
          'px-3 py-2.5 text-right font-mono text-xs tabular-nums font-medium',
          row.changePct >= 0 ? 'text-emerald-500' : 'text-rose-500',
        )}
      >
        {formatPct(row.changePct)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatVolume(row.quoteVolume)}
      </td>
      <td
        className={cn(
          'px-3 py-2.5 text-right font-mono text-xs tabular-nums font-medium',
          row.rsi < 30 ? 'text-emerald-500' : row.rsi > 70 ? 'text-rose-500' : 'text-foreground',
        )}
      >
        {row.rsi.toFixed(1)}
      </td>
      <td
        className={cn(
          'px-3 py-2.5 text-right font-mono text-xs tabular-nums font-medium',
          row.macdHistogram >= 0 ? 'text-emerald-500' : 'text-rose-500',
        )}
      >
        {row.macdHistogram >= 0 ? '+' : ''}
        {row.macdHistogram.toFixed(4)}
      </td>
      <td className="px-3 py-2.5">
        <Badge variant="outline" className={cn('gap-1 text-[10px]', trend.cls)}>
          <TrendIcon className="h-3 w-3" />
          {trend.label}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-center">
        <span
          className={cn(
            'inline-flex items-center gap-1 font-mono text-[10px] tabular-nums',
            row.ema20 > row.ema50 ? 'text-emerald-500' : 'text-rose-500',
          )}
          title={`EMA20 ${row.ema20.toFixed(2)} vs EMA50 ${row.ema50.toFixed(2)}`}
        >
          {row.ema20 > row.ema50 ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )}
          {row.ema20 > row.ema50 ? '20>50' : '20<50'}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <SignalDots matched={row.matchedFilters} />
      </td>
      <td className="px-3 py-2.5">
        <ConvictionBar score={row.conviction} />
      </td>
    </motion.tr>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-md border border-border/40 bg-card/30 p-3"
        >
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <Card className="border-dashed border-border/60 bg-card/30">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/20">
          <Filter className="h-7 w-7 text-emerald-500" />
        </div>
        <div>
          <div className="text-base font-semibold text-foreground">No assets match your filters</div>
          <div className="text-sm text-muted-foreground mt-1 max-w-sm">
            Try relaxing your criteria — reduce the minimum volume, remove some technical filters,
            or switch the direction pill to “All”.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onReset} className="mt-2 gap-2">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Filters
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Filter panel content — shared between desktop sidebar and mobile Sheet
// ---------------------------------------------------------------------------
interface FilterPanelProps {
  activeFilters: string[];
  toggleFilter: (key: string) => void;
  setFilters: (keys: string[]) => void;
  direction: 'all' | 'bullish' | 'bearish';
  setDirection: (d: 'all' | 'bullish' | 'bearish') => void;
  volumeMin: number;
  setVolumeMin: (n: number) => void;
  priceMin: number;
  setPriceMin: (n: number) => void;
  priceMax: number;
  setPriceMax: (n: number) => void;
  sortBy: SortKey;
  setSortBy: (s: SortKey) => void;
  onScan: () => void;
  onReset: () => void;
  scanning: boolean;
  matchCount: number;
  scannedCount: number;
}

function FilterPanelContent(props: FilterPanelProps) {
  return (
    <div className="space-y-5">
      {/* Asset class — pills */}
      <div>
        <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Asset Class
        </Label>
        <div className="mt-2 flex gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.35)]">
            <Activity className="h-3 w-3" />
            Crypto
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            All
          </span>
        </div>
      </div>

      {/* Price range */}
      <div>
        <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Price Range (USD, optional)
        </Label>
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Min"
            value={props.priceMin || ''}
            onChange={(e) => props.setPriceMin(Number(e.target.value) || 0)}
            className="h-8 font-mono text-xs tabular-nums"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Max"
            value={props.priceMax || ''}
            onChange={(e) => props.setPriceMax(Number(e.target.value) || 0)}
            className="h-8 font-mono text-xs tabular-nums"
          />
        </div>
      </div>

      {/* Volume min */}
      <div>
        <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Min 24h Volume (USD)
        </Label>
        <Input
          type="number"
          inputMode="decimal"
          value={props.volumeMin || ''}
          onChange={(e) => props.setVolumeMin(Number(e.target.value) || 0)}
          className="mt-2 h-8 font-mono text-xs tabular-nums"
        />
      </div>

      {/* Direction pills */}
      <div>
        <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Direction
        </Label>
        <Tabs
          value={props.direction}
          onValueChange={(v) => props.setDirection(v as 'all' | 'bullish' | 'bearish')}
          className="mt-2"
        >
          <TabsList className="grid w-full grid-cols-3 bg-muted/60 backdrop-blur-sm h-8">
            <TabsTrigger value="all" className="text-[11px] data-[state=active]:text-emerald-400">
              All
            </TabsTrigger>
            <TabsTrigger value="bullish" className="text-[11px] data-[state=active]:text-emerald-400">
              Bull
            </TabsTrigger>
            <TabsTrigger value="bearish" className="text-[11px] data-[state=active]:text-rose-400">
              Bear
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Technical filter chips */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Technical Filters
          </Label>
          <span className="font-mono text-[10px] tabular-nums text-emerald-500">
            {props.activeFilters.length}/{TECHNICAL_FILTERS.length}
          </span>
        </div>
        <TooltipProvider delayDuration={120}>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TECHNICAL_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                filterKey={f.key}
                active={props.activeFilters.includes(f.key)}
                onToggle={() => props.toggleFilter(f.key)}
              />
            ))}
          </div>
        </TooltipProvider>
      </div>

      {/* Sort by */}
      <div>
        <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Sort By
        </Label>
        <Select value={props.sortBy} onValueChange={(v) => props.setSortBy(v as SortKey)}>
          <SelectTrigger className="mt-2 h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-1">
        <Button
          onClick={props.onScan}
          disabled={props.scanning}
          className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-[0_0_18px_-2px_rgba(16,185,129,0.55)] hover:shadow-[0_0_24px_-2px_rgba(16,185,129,0.7)] hover:brightness-110 transition-all"
        >
          {props.scanning ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Scanning…
            </>
          ) : (
            <>
              <ScanLine className="h-4 w-4" />
              Scan Now
            </>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={props.onReset}
          disabled={props.scanning}
          className="w-full gap-2"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Filters
        </Button>
      </div>

      {/* Result count */}
      {props.scannedCount > 0 && (
        <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-center">
          <div className="font-mono text-sm tabular-nums text-foreground">
            <span className="text-emerald-500 font-semibold">{props.matchCount}</span>
            <span className="text-muted-foreground"> matches of </span>
            <span className="text-foreground font-semibold">{props.scannedCount}</span>
            <span className="text-muted-foreground"> scanned</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------
export function ScreenerClient() {
  // Filter state
  const [activeFilters, setActiveFilters] = useState<string[]>([
    'rsi_oversold',
    'volume_spike',
    'macd_bullish',
  ]);
  const [direction, setDirection] = useState<'all' | 'bullish' | 'bearish'>('all');
  const [volumeMin, setVolumeMin] = useState<number>(1_000_000);
  const [priceMin, setPriceMin] = useState<number>(0);
  const [priceMax, setPriceMax] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortKey>('conviction');

  // Result state — kept in component state, mutated via useMutation.
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Visible rows (top 50 by default; expand with "Show more")
  const visibleResults = useMemo(
    () => (showAll ? results : results.slice(0, 50)),
    [results, showAll],
  );

  // Scan mutation
  const mutation = useMutation({
    mutationFn: runScan,
    onSuccess: (data) => {
      setResults(data.results);
      setStats(data.stats);
      setHasScanned(true);
      setShowAll(false);
      toast.success(
        `Scan complete — ${data.stats.matches} matches out of ${data.stats.scanned} scanned`,
      );
    },
    onError: (err: Error) => {
      toast.error(`Scan failed: ${err.message}`);
    },
  });

  const toggleFilter = useCallback((key: string) => {
    setActiveFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const handleScan = useCallback(() => {
    mutation.mutate({
      filters: activeFilters,
      volumeMin,
      priceMin,
      priceMax,
      direction,
      sortBy,
      topN: 80,
      limit: 200,
    });
  }, [activeFilters, volumeMin, priceMin, priceMax, direction, sortBy, mutation]);

  const handleReset = useCallback(() => {
    setActiveFilters([]);
    setDirection('all');
    setVolumeMin(1_000_000);
    setPriceMin(0);
    setPriceMax(0);
    setSortBy('volume');
  }, []);

  const loadPreset = useCallback((filters: string[]) => {
    setActiveFilters(filters);
    toast.success(`Preset loaded — ${filters.length} filters active`);
  }, []);

  // Most active filter — used in the "Most Active" stat tile
  const mostActiveFilter = useMemo(() => {
    if (!stats) return null;
    let best: { key: string; count: number } | null = null;
    for (const [k, v] of Object.entries(stats.filterCounts)) {
      if (v > 0 && (!best || v > best.count)) best = { key: k, count: v };
    }
    return best;
  }, [stats]);

  // Distribution chart data
  const distributionData = useMemo(() => {
    if (!stats) return [];
    return TECHNICAL_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      count: stats.filterCounts[f.key] || 0,
      color: FILTER_COLOR_HEX[f.color],
    }))
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  const scanning = mutation.isPending;
  const totalScanned = stats?.scanned ?? 0;
  const matchCount = results.length;

  return (
    <TooltipProvider delayDuration={150}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="space-y-5"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-400/30 group">
              <span
                aria-hidden
                className="absolute inset-0 rounded-xl bg-emerald-400/40 blur-md opacity-60 group-hover:opacity-90 transition-opacity duration-300"
              />
              <ScanLine className="relative h-6 w-6 drop-shadow group-hover:rotate-12 transition-transform duration-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-balance">
                Market Screener
              </h1>
              <p className="text-sm text-muted-foreground">
                Scan all USDT pairs with 14 technical filters. Surface high-conviction opportunities
                in seconds.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                Live Binance Feed
              </span>
            </Badge>
          </div>
        </div>

        {/* Preset strategy cards */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Crosshair className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Preset Strategies
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PRESET_STRATEGIES.map((preset, i) => {
              const Icon = preset.icon;
              const isActive =
                activeFilters.length === preset.filters.length &&
                preset.filters.every((f) => activeFilters.includes(f));
              return (
                <motion.button
                  key={preset.name}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                  whileHover={{ y: -3 }}
                  onClick={() => loadPreset(preset.filters)}
                  className={cn(
                    'group relative overflow-hidden rounded-lg border p-3 text-left transition-all duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    isActive
                      ? 'border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_18px_-4px_rgba(16,185,129,0.5)]'
                      : 'border-border/50 bg-card/40 hover:border-emerald-500/40 hover:bg-card/70 hover:shadow-lg hover:shadow-emerald-500/10',
                  )}
                >
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-0 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent transition-opacity duration-300 group-hover:opacity-100 pointer-events-none"
                  />
                  <div className="relative flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-inset ring-border/30 bg-emerald-500/10 text-emerald-500 transition-transform duration-200 group-hover:scale-110',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="flex flex-col leading-tight">
                        <span className="text-xs font-semibold text-foreground">
                          {preset.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {preset.filters.length} filters
                        </span>
                      </div>
                    </div>
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-all duration-200',
                        'group-hover:translate-x-1 group-hover:text-emerald-500',
                      )}
                    />
                  </div>
                  <p className="relative mt-2 text-[11px] text-muted-foreground leading-snug">
                    {preset.description}
                  </p>
                  {isActive && (
                    <div className="relative mt-1.5 text-[10px] font-semibold text-emerald-500 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Layout: filter sidebar + main panel */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
          {/* Desktop filter sidebar */}
          <Card className="hidden lg:block sticky top-4 border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    Filters
                  </span>
                </div>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {activeFilters.length} active
                </span>
              </div>
              <FilterPanelContent
                activeFilters={activeFilters}
                toggleFilter={toggleFilter}
                setFilters={setActiveFilters}
                direction={direction}
                setDirection={setDirection}
                volumeMin={volumeMin}
                setVolumeMin={setVolumeMin}
                priceMin={priceMin}
                setPriceMin={setPriceMin}
                priceMax={priceMax}
                setPriceMax={setPriceMax}
                sortBy={sortBy}
                setSortBy={setSortBy}
                onScan={handleScan}
                onReset={handleReset}
                scanning={scanning}
                matchCount={matchCount}
                scannedCount={totalScanned}
              />
            </CardContent>
          </Card>

          {/* Mobile filter trigger */}
          <div className="lg:hidden flex items-center justify-between">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters
                  {activeFilters.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1 h-5 px-1.5 text-[10px] bg-emerald-500/15 text-emerald-500"
                    >
                      {activeFilters.length}
                    </Badge>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] sm:max-w-xs overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-base">
                    <SlidersHorizontal className="h-4 w-4 text-emerald-500" />
                    Screener Filters
                  </SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-6">
                  <FilterPanelContent
                    activeFilters={activeFilters}
                    toggleFilter={toggleFilter}
                    setFilters={setActiveFilters}
                    direction={direction}
                    setDirection={setDirection}
                    volumeMin={volumeMin}
                    setVolumeMin={setVolumeMin}
                    priceMin={priceMin}
                    setPriceMin={setPriceMin}
                    priceMax={priceMax}
                    setPriceMax={setPriceMax}
                    sortBy={sortBy}
                    setSortBy={setSortBy}
                    onScan={handleScan}
                    onReset={handleReset}
                    scanning={scanning}
                    matchCount={matchCount}
                    scannedCount={totalScanned}
                  />
                </div>
              </SheetContent>
            </Sheet>
            <Button
              onClick={handleScan}
              disabled={scanning}
              size="sm"
              className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white"
            >
              {scanning ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ScanLine className="h-3.5 w-3.5" />
              )}
              {scanning ? 'Scanning…' : 'Scan Now'}
            </Button>
          </div>

          {/* Main panel */}
          <div className="space-y-4 min-w-0">
            {/* Live progress bar (during scan) */}
            <AnimatePresence>
              {scanning && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <Card className="border-emerald-500/30 bg-emerald-500/[0.04]">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 text-xs text-emerald-500 font-medium">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>
                            Scanning market — fetching klines for top 80 assets by volume…
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-rose-500"
                          onClick={() => mutation.reset()}
                        >
                          <X className="h-3 w-3" />
                          Cancel
                        </Button>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                          initial={{ x: '-100%' }}
                          animate={{ x: '0%' }}
                          transition={{
                            duration: 2.5,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                          style={{ width: '50%' }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <StatTile
                label="Scanned"
                value={stats ? stats.scanned : '—'}
                icon={Search}
                tone="zinc"
              />
              <StatTile
                label="Matches"
                value={stats ? stats.matches : '—'}
                icon={Target}
                tone="emerald"
              />
              <StatTile
                label="Bullish"
                value={stats ? stats.bullish : '—'}
                icon={TrendingUp}
                tone="emerald"
              />
              <StatTile
                label="Bearish"
                value={stats ? stats.bearish : '—'}
                icon={TrendingDown}
                tone="rose"
              />
              <StatTile
                label="Avg RSI"
                value={stats ? stats.avgRsi.toFixed(1) : '—'}
                icon={Activity}
                tone={stats && stats.avgRsi < 30 ? 'emerald' : stats && stats.avgRsi > 70 ? 'rose' : 'amber'}
              />
              <StatTile
                label="Most Active"
                value={
                  mostActiveFilter
                    ? FILTER_BY_KEY[mostActiveFilter.key]?.label.split(' ')[0] ?? '—'
                    : '—'
                }
                sub={mostActiveFilter ? `${mostActiveFilter.count} hits` : undefined}
                icon={BarChart3}
                tone="teal"
              />
            </div>

            {/* Filter distribution chart */}
            {distributionData.length > 0 && (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Filter Distribution
                      </span>
                    </div>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {distributionData.length} active filters
                    </span>
                  </div>
                  <div className="h-[160px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={distributionData}
                        layout="vertical"
                        margin={{ top: 4, right: 12, bottom: 4, left: 8 }}
                        barCategoryGap={4}
                      >
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={110}
                          tick={{
                            fill: 'hsl(var(--muted-foreground))',
                            fontSize: 10,
                          }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <RechartsTooltip
                          cursor={{ fill: 'rgba(16,185,129,0.08)' }}
                          contentStyle={{
                            background: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '6px',
                            fontSize: '11px',
                            padding: '6px 10px',
                          }}
                          formatter={(v: number, _n, item) => [
                            `${v} asset${v === 1 ? '' : 's'}`,
                            item?.payload?.label ?? '',
                          ]}
                          labelFormatter={() => ''}
                        />
                        <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                          {distributionData.map((d) => (
                            <RechartsCell key={d.key} fill={d.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Results table */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-0">
                <div className="flex items-center justify-between p-3 border-b border-border/40">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      Results
                    </span>
                    {matchCount > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono tabular-nums border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      >
                        {matchCount}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                      <SelectTrigger className="h-7 w-[140px] text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SORT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 gap-1.5"
                      onClick={handleScan}
                      disabled={scanning}
                    >
                      <RefreshCw
                        className={cn('h-3 w-3', scanning && 'animate-spin')}
                      />
                      Refresh
                    </Button>
                  </div>
                </div>

                {/* Table or states */}
                {scanning && !hasScanned ? (
                  <div className="p-4">
                    <ResultsSkeleton />
                  </div>
                ) : matchCount === 0 ? (
                  <div className="p-4">
                    {hasScanned ? (
                      <EmptyState onReset={handleReset} />
                    ) : (
                      <Card className="border-dashed border-border/60 bg-card/30">
                        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/20">
                            <ScanLine className="h-7 w-7 text-emerald-500" />
                          </div>
                          <div>
                            <div className="text-base font-semibold text-foreground">
                              Ready to scan
                            </div>
                            <div className="text-sm text-muted-foreground mt-1 max-w-sm">
                              Pick filters above or load a preset, then hit{' '}
                              <span className="font-medium text-emerald-500">Scan Now</span> to
                              surface matching opportunities across the entire USDT universe.
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={handleScan}
                            disabled={scanning}
                            className="mt-2 gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white"
                          >
                            <ScanLine className="h-4 w-4" />
                            Run Initial Scan
                          </Button>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full min-w-[920px] text-sm">
                      <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/50">
                        <tr>
                          <th className="px-3 py-2 text-left">
                            <SortableHeader
                              label="Symbol"
                              active={sortBy === 'symbol'}
                              direction="asc"
                              onClick={() => setSortBy('symbol')}
                            />
                          </th>
                          <th className="px-3 py-2 text-right">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Price
                            </span>
                          </th>
                          <th className="px-3 py-2 text-right">
                            <SortableHeader
                              label="24h %"
                              active={sortBy === 'changePct'}
                              direction="desc"
                              onClick={() => setSortBy('changePct')}
                              align="right"
                            />
                          </th>
                          <th className="px-3 py-2 text-right">
                            <SortableHeader
                              label="Volume"
                              active={sortBy === 'volume'}
                              direction="desc"
                              onClick={() => setSortBy('volume')}
                              align="right"
                            />
                          </th>
                          <th className="px-3 py-2 text-right">
                            <SortableHeader
                              label="RSI"
                              active={sortBy === 'rsi'}
                              direction="asc"
                              onClick={() => setSortBy('rsi')}
                              align="right"
                            />
                          </th>
                          <th className="px-3 py-2 text-right">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              MACD
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Trend
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              EMA
                            </span>
                          </th>
                          <th className="px-3 py-2 text-left">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Signals
                            </span>
                          </th>
                          <th className="px-3 py-2 text-left">
                            <SortableHeader
                              label="Conviction"
                              active={sortBy === 'conviction'}
                              direction="desc"
                              onClick={() => setSortBy('conviction')}
                            />
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleResults.map((row, i) => (
                          <ResultsRow key={row.symbol} row={row} index={i} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Show more button */}
                {matchCount > 50 && !showAll && (
                  <div className="border-t border-border/40 p-3 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAll(true)}
                      className="gap-2"
                    >
                      Show {matchCount - 50} more
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {showAll && matchCount > 50 && (
                  <div className="border-t border-border/40 p-3 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAll(false)}
                      className="gap-2"
                    >
                      Show top 50 only
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Hint */}
            {hasScanned && matchCount > 0 && (
              <div className="text-center text-[11px] text-muted-foreground">
                Click any row to open the asset detail page · All indicators computed on 4h × 200
                klines
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
