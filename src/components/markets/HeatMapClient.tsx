'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  Grid3x3,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  Building2,
  BarChart3,
  Boxes,
  Bitcoin,
  RefreshCw,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Activity,
  Radio,
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
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ApiResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types — mirror what /api/markets/heatmap returns
// ---------------------------------------------------------------------------
interface HeatMapItem {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  changePct: number;
  volume?: number;
  sparkline: number[];
}
interface ClassStats {
  count: number;
  avgChange: number;
  up: number;
  down: number;
}
interface HeatMapStats {
  totalAssets: number;
  totalUp: number;
  totalDown: number;
  avgChange: number;
  bestPerformer: HeatMapItem | null;
  worstPerformer: HeatMapItem | null;
  byClassStats: Record<string, ClassStats>;
}
interface HeatMapResponse {
  items: HeatMapItem[];
  byClass: Record<string, HeatMapItem[]>;
  stats: HeatMapStats;
}

const CLASS_ORDER = ['crypto', 'forex', 'stock', 'index', 'commodity'] as const;
const CLASS_LABEL: Record<string, string> = {
  crypto: 'Crypto',
  forex: 'Forex',
  stock: 'Stocks',
  index: 'Indices',
  commodity: 'Commodities',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchHeatMap(): Promise<HeatMapResponse> {
  const r = await fetch('/api/markets/heatmap');
  const j: ApiResult<HeatMapResponse> = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to load heat map');
  return (j.data as HeatMapResponse) || { items: [], byClass: {}, stats: emptyStats() };
}

function emptyStats(): HeatMapStats {
  return {
    totalAssets: 0,
    totalUp: 0,
    totalDown: 0,
    avgChange: 0,
    bestPerformer: null,
    worstPerformer: null,
    byClassStats: {},
  };
}

function fmtPrice(p?: number): string {
  if (p == null || Number.isNaN(p) || !isFinite(p)) return '—';
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtVol(v?: number): string {
  if (!v || v <= 0) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function cleanSymbol(sym: string): string {
  return sym
    .replace(/=X$/, '')
    .replace(/\.NS$|\.BO$/, '')
    .replace(/-USD$/, '')
    .replace(/=F$/, '')
    .replace(/USDT$/, '');
}

function hrefFor(item: HeatMapItem): string {
  return item.assetClass === 'crypto' ? `/crypto/${encodeURIComponent(item.symbol)}` : `/markets/${encodeURIComponent(item.symbol)}`;
}

// Color tiers based on changePct
type ColorTier = 'strong-up' | 'light-up' | 'neutral' | 'light-down' | 'strong-down';

function tierFor(changePct: number): ColorTier {
  if (changePct > 3) return 'strong-up';
  if (changePct > 1) return 'light-up';
  if (changePct >= -1) return 'neutral';
  if (changePct >= -3) return 'light-down';
  return 'strong-down';
}

const tierClasses: Record<ColorTier, { bg: string; text: string; border: string }> = {
  'strong-up': { bg: 'bg-emerald-500/80 hover:bg-emerald-500', text: 'text-white', border: 'border-emerald-400/50' },
  'light-up': { bg: 'bg-emerald-500/30 hover:bg-emerald-500/45', text: 'text-emerald-100', border: 'border-emerald-500/30' },
  'neutral': { bg: 'bg-muted/60 hover:bg-muted', text: 'text-muted-foreground', border: 'border-border/40' },
  'light-down': { bg: 'bg-rose-500/30 hover:bg-rose-500/45', text: 'text-rose-100', border: 'border-rose-500/30' },
  'strong-down': { bg: 'bg-rose-500/80 hover:bg-rose-500', text: 'text-white', border: 'border-rose-400/50' },
};

// Size tiers based on absolute changePct (within the class section)
type SizeTier = 'xl' | 'lg' | 'md' | 'sm';
function sizeTier(absChange: number): SizeTier {
  if (absChange > 5) return 'xl';
  if (absChange > 2) return 'lg';
  if (absChange > 0.5) return 'md';
  return 'sm';
}

const sizeClasses: Record<SizeTier, { basis: string; minH: string; text: string; pct: string }> = {
  xl: { basis: 'basis-[260px]', minH: 'min-h-[120px]', text: 'text-2xl', pct: 'text-3xl' },
  lg: { basis: 'basis-[200px]', minH: 'min-h-[100px]', text: 'text-xl', pct: 'text-2xl' },
  md: { basis: 'basis-[150px]', minH: 'min-h-[80px]', text: 'text-lg', pct: 'text-xl' },
  sm: { basis: 'basis-[110px]', minH: 'min-h-[64px]', text: 'text-sm', pct: 'text-base' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function HeatMapClient() {
  const queryClient = useQueryClient();
  const heatQ = useQuery({
    queryKey: ['markets-heatmap'],
    queryFn: fetchHeatMap,
    refetchInterval: 5 * 60_000, // 5 min
    staleTime: 60_000,
  });

  const data = heatQ.data;
  const stats = data?.stats ?? emptyStats();
  const isLoading = heatQ.isLoading;
  const isError = heatQ.isError;
  const items = data?.items ?? [];
  const byClass = data?.byClass ?? {};
  const hasItems = items.length > 0;
  const cryptoOnly = hasItems && items.every((i) => i.assetClass === 'crypto');

  async function refresh() {
    toast.info('Refreshing heat map…');
    try {
      await queryClient.invalidateQueries({ queryKey: ['markets-heatmap'] });
      await queryClient.refetchQueries({ queryKey: ['markets-heatmap'] });
      toast.success('Heat map refreshed');
    } catch (e: any) {
      toast.error('Refresh failed', { description: e.message });
    }
  }

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
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Market Heat Map</h1>
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            One glance at the whole market · sized by absolute daily move · colored by direction
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Radio className="h-3 w-3 animate-pulse text-emerald-500" /> Auto-refresh 5 min
            {heatQ.isFetching && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
          </span>
          <Button variant="outline" size="sm" onClick={refresh} disabled={heatQ.isFetching}>
            <RefreshCw className={cn('h-3.5 w-3.5', heatQ.isFetching && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </motion.div>

      {/* Stats strip */}
      <StatsStrip stats={stats} loading={isLoading} />

      {/* By-class summary */}
      <ByClassSummary byClassStats={stats.byClassStats} loading={isLoading} />

      {/* Rate-limit banner */}
      {!isLoading && !hasItems && !isError && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <div className="text-sm font-semibold text-amber-500">
              Yahoo Finance is rate-limiting requests right now
            </div>
            <div className="text-xs text-muted-foreground max-w-md">
              Heat map data is currently unavailable for forex, stocks, indices, and commodities.
              Crypto data is still available via Binance. Try refreshing in a few minutes.
            </div>
            <Button variant="outline" size="sm" onClick={() => heatQ.refetch()}>
              <RefreshCw className="h-3 w-3" /> Retry now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Crypto-only partial banner */}
      {!isLoading && cryptoOnly && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="py-3 flex items-center gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-amber-500">Showing crypto only — Yahoo Finance is rate-limited.</span>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {isError && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <div className="text-sm text-rose-500">Failed to load heat map data</div>
            <div className="text-xs text-muted-foreground">{heatQ.error?.message}</div>
            <Button variant="outline" size="sm" onClick={() => heatQ.refetch()}>
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Heat map sections */}
      {isLoading ? (
        <div className="space-y-5">
          {CLASS_ORDER.map((cls) => (
            <Card key={cls} className="border-border/60">
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-[200px] w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {CLASS_ORDER.map((cls) => {
            const classItems = byClass[cls];
            if (!classItems || classItems.length === 0) return null;
            return <HeatMapSection key={cls} cls={cls} items={classItems} />;
          })}
          {/* Catch-all for any class not in CLASS_ORDER */}
          {Object.entries(byClass)
            .filter(([cls]) => !CLASS_ORDER.includes(cls as any))
            .map(([cls, items]) => (
              <HeatMapSection key={cls} cls={cls} items={items} />
            ))}
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-[11px] text-muted-foreground pb-2">
        <Activity className="inline h-3 w-3 mr-1" />
        Cell size scales with absolute daily move · click any cell for deep analysis · refreshes every 5 min
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------------
function StatsStrip({ stats, loading }: { stats: HeatMapStats; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>
    );
  }

  const best = stats.bestPerformer;
  const worst = stats.worstPerformer;
  const avgPos = (stats.avgChange + 10) / 20 * 100; // -10..+10 → 0..100

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <StatTile
        label="Total Assets"
        value={String(stats.totalAssets)}
        icon={<Grid3x3 className="h-4 w-4" />}
        accent="emerald"
      />
      <StatTile
        label="Up"
        value={String(stats.totalUp)}
        sub={`${stats.totalAssets > 0 ? Math.round((stats.totalUp / stats.totalAssets) * 100) : 0}% of market`}
        icon={<TrendingUp className="h-4 w-4" />}
        accent="emerald"
      />
      <StatTile
        label="Down"
        value={String(stats.totalDown)}
        sub={`${stats.totalAssets > 0 ? Math.round((stats.totalDown / stats.totalAssets) * 100) : 0}% of market`}
        icon={<TrendingDown className="h-4 w-4" />}
        accent="rose"
      />
      <StatTile
        label="Avg Change"
        value={`${stats.avgChange >= 0 ? '+' : ''}${stats.avgChange.toFixed(2)}%`}
        icon={<Activity className="h-4 w-4" />}
        accent={stats.avgChange >= 0 ? 'emerald' : 'rose'}
        sub={
          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full', stats.avgChange >= 0 ? 'bg-emerald-500' : 'bg-rose-500')}
              style={{ width: `${Math.max(2, Math.min(100, avgPos))}%` }}
            />
          </div>
        }
      />
      <StatTile
        label="Best Performer"
        value={best ? `${best.changePct >= 0 ? '+' : ''}${best.changePct.toFixed(2)}%` : '—'}
        sub={best ? cleanSymbol(best.symbol) : '—'}
        icon={<ArrowUpRight className="h-4 w-4" />}
        accent="emerald"
      />
      <StatTile
        label="Worst Performer"
        value={worst ? `${worst.changePct >= 0 ? '+' : ''}${worst.changePct.toFixed(2)}%` : '—'}
        sub={worst ? cleanSymbol(worst.symbol) : '—'}
        icon={<ArrowDownRight className="h-4 w-4" />}
        accent="rose"
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  accent: 'emerald' | 'rose' | 'amber' | 'orange' | 'teal';
}) {
  const accentMap: Record<string, string> = {
    emerald: 'text-emerald-500',
    rose: 'text-rose-500',
    amber: 'text-amber-500',
    orange: 'text-orange-500',
    teal: 'text-teal-500',
  };
  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className={accentMap[accent]}>{icon}</span>
          {label}
        </div>
        <div className={cn('text-xl font-bold font-mono tabular-nums mt-1', accentMap[accent])}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// By-class summary
// ---------------------------------------------------------------------------
function ByClassSummary({
  byClassStats,
  loading,
}: {
  byClassStats: Record<string, ClassStats>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {CLASS_ORDER.map((cls) => {
        const s = byClassStats[cls] || { count: 0, avgChange: 0, up: 0, down: 0 };
        const total = s.up + s.down;
        const upPct = total > 0 ? (s.up / total) * 100 : 50;
        return (
          <Card key={cls} className="border-border/60">
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <ClassChipIcon cls={cls} className="h-3.5 w-3.5" />
                  {CLASS_LABEL[cls] || cls}
                </div>
                <Badge variant="outline" className="text-[10px] h-5">{s.count}</Badge>
              </div>
              <div
                className={cn(
                  'text-lg font-bold font-mono tabular-nums',
                  s.avgChange > 0 ? 'text-emerald-500' : s.avgChange < 0 ? 'text-rose-500' : 'text-muted-foreground'
                )}
              >
                {s.avgChange >= 0 ? '+' : ''}
                {s.avgChange.toFixed(2)}%
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="text-emerald-500">{s.up} up</span>
                <span className="text-rose-500">{s.down} down</span>
              </div>
              <div className="flex h-1.5 rounded-full overflow-hidden bg-rose-500/30">
                <div className="bg-emerald-500" style={{ width: `${upPct}%` }} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ClassChipIcon({ cls, className }: { cls: string; className?: string }) {
  if (cls === 'crypto') return <Bitcoin className={className} />;
  if (cls === 'forex') return <ArrowLeftRight className={className} />;
  if (cls === 'stock') return <Building2 className={className} />;
  if (cls === 'index') return <BarChart3 className={className} />;
  if (cls === 'commodity') return <Boxes className={className} />;
  return <Activity className={className} />;
}

// ---------------------------------------------------------------------------
// Heat map section (per asset class)
// ---------------------------------------------------------------------------
function HeatMapSection({ cls, items }: { cls: string; items: HeatMapItem[] }) {
  // Sort by abs changePct descending so biggest movers render first (and grab the bigger cells)
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  }, [items]);

  const upCount = items.filter((i) => i.changePct > 0).length;
  const downCount = items.filter((i) => i.changePct < 0).length;
  const avg = items.length ? items.reduce((s, i) => s + i.changePct, 0) / items.length : 0;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <ClassChipIcon cls={cls} className={cn('h-4 w-4', classAccentText(cls))} />
            {CLASS_LABEL[cls] || cls}
            <Badge variant="outline" className="text-[10px] h-5">{items.length} assets</Badge>
          </span>
          <div className="flex items-center gap-3 text-[11px] font-normal">
            <span className="flex items-center gap-1">
              <span className="text-emerald-500 font-mono">{upCount} up</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-rose-500 font-mono">{downCount} down</span>
            </span>
            <span
              className={cn(
                'font-mono font-bold tabular-nums',
                avg > 0 ? 'text-emerald-500' : avg < 0 ? 'text-rose-500' : 'text-muted-foreground'
              )}
            >
              avg {avg >= 0 ? '+' : ''}
              {avg.toFixed(2)}%
            </span>
          </div>
        </CardTitle>
        <CardDescription className="text-xs">
          Sorted by absolute move · cell size scales with magnitude
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((item, i) => (
            <HeatCell key={`${item.symbol}-${i}`} item={item} index={i} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function classAccentText(cls: string): string {
  if (cls === 'crypto') return 'text-amber-500';
  if (cls === 'forex') return 'text-emerald-500';
  if (cls === 'stock') return 'text-rose-500';
  if (cls === 'index') return 'text-orange-500';
  if (cls === 'commodity') return 'text-amber-500';
  return 'text-muted-foreground';
}

// ---------------------------------------------------------------------------
// Heat cell — the actual treemap rectangle
// ---------------------------------------------------------------------------
function HeatCell({ item, index }: { item: HeatMapItem; index: number }) {
  const tier = tierFor(item.changePct);
  const size = sizeTier(Math.abs(item.changePct));
  const tCls = tierClasses[tier];
  const sCls = sizeClasses[size];
  const isUp = item.changePct >= 0;
  const href = hrefFor(item);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.015, 0.4) }}
      className={cn(
        sCls.basis,
        sCls.minH,
        'grow shrink-0 rounded-md border transition-colors',
        tCls.bg,
        tCls.text,
        tCls.border
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className="block w-full h-full p-2 sm:p-2.5 text-left"
          >
            <div className="flex flex-col h-full justify-between gap-1">
              <div>
                <div className={cn('font-bold leading-tight truncate', size === 'sm' ? 'text-xs' : sCls.text)}>
                  {cleanSymbol(item.symbol)}
                </div>
                <div
                  className={cn(
                    'font-mono font-bold tabular-nums leading-none mt-0.5',
                    sCls.pct,
                    'flex items-center gap-0.5'
                  )}
                >
                  {isUp ? <ArrowUpRight className="inline h-3.5 w-3.5" /> : <ArrowDownRight className="inline h-3.5 w-3.5" />}
                  {item.changePct >= 0 ? '+' : ''}
                  {item.changePct.toFixed(2)}%
                </div>
              </div>
              <div className={cn('font-mono tabular-nums opacity-80 truncate', size === 'sm' ? 'text-[10px]' : 'text-xs')}>
                {fmtPrice(item.price)}
              </div>
            </div>
          </Link>
        </TooltipTrigger>
        <TooltipContent className="bg-popover text-popover-foreground border border-border shadow-xl max-w-[260px]">
          <div className="space-y-1">
            <div className="font-bold text-xs">{item.name}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{item.symbol}</div>
            <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-border/40">
              <span className="font-mono tabular-nums">{fmtPrice(item.price)}</span>
              <span className={cn('font-bold font-mono', isUp ? 'text-emerald-500' : 'text-rose-500')}>
                {isUp ? '+' : ''}
                {item.changePct.toFixed(2)}%
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Class: {CLASS_LABEL[item.assetClass] || item.assetClass}
              {item.volume != null && item.volume > 0 && ` · Vol ${fmtVol(item.volume)}`}
            </div>
            <div className="text-[10px] text-emerald-500 pt-0.5">Click for deep analysis →</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </motion.div>
  );
}
