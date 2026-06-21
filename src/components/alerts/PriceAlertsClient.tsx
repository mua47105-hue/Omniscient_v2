'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import {
  BellRing,
  Search,
  Plus,
  Trash2,
  Power,
  PowerOff,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRightLeft,
  Target,
  Trophy,
  Flame,
  CheckCircle2,
  Activity,
  Smartphone,
  Send,
  ArrowUp,
  ArrowDown,
  X,
  Sparkles,
  Zap,
  CircleDashed,
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
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandList, CommandInput, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { ApiResult, Ticker } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Condition = 'above' | 'below' | 'crosses_up' | 'crosses_down';
type Channel = 'dashboard' | 'telegram' | 'both';

interface AssetOption {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  changePct: number;
  source: 'binance' | 'yahoo';
}

interface PriceAlert {
  id: string;
  assetSymbol: string;
  condition: Condition;
  targetPrice: number;
  currentPrice: number | null;
  status: 'active' | 'triggered' | 'disabled';
  channel: Channel;
  note: string | null;
  triggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CheckSummary {
  checked: number;
  triggered: number;
  results: {
    alertId: string;
    symbol: string;
    triggered: boolean;
    currentPrice: number | null;
    error?: string;
  }[];
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const CONDITION_DEFS: {
  value: Condition;
  label: string;
  description: string;
  icon: typeof TrendingUp;
}[] = [
  { value: 'above', label: 'Above', description: 'Price rises to or above target', icon: ArrowUpRight },
  { value: 'below', label: 'Below', description: 'Price falls to or below target', icon: ArrowDownRight },
  { value: 'crosses_up', label: 'Crosses Up', description: 'Price crosses upward through target', icon: ArrowUp },
  { value: 'crosses_down', label: 'Crosses Down', description: 'Price crosses downward through target', icon: ArrowDown },
];

const CHANNEL_DEFS: { value: Channel; label: string; icon: typeof Smartphone }[] = [
  { value: 'dashboard', label: 'Dashboard', icon: Smartphone },
  { value: 'telegram', label: 'Telegram', icon: Send },
  { value: 'both', label: 'Both', icon: BellRing },
];

function fmtPrice(p: number | null | undefined, currency = 'USD'): string {
  if (p == null || !isFinite(p) || p === 0) return '—';
  const prefix = currency === 'USD' ? '$' : '';
  if (p >= 10000) return prefix + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return prefix + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return prefix + p.toFixed(2);
  if (p >= 0.01) return prefix + p.toFixed(4);
  return prefix + p.toFixed(6);
}

function cleanSymbol(sym: string): string {
  return sym
    .replace(/=X$/, '')
    .replace(/\.NS$|\.BO$/, '')
    .replace(/-USD$/, '')
    .replace(/=F$/, '');
}

function isIndianStock(symbol: string): boolean {
  return /\.NS$|\.BO$/.test(symbol);
}

function accentForAsset(assetClass: string, symbol: string): 'emerald' | 'amber' | 'rose' | 'orange' | 'teal' {
  if (assetClass === 'crypto') return 'teal';
  if (assetClass === 'forex') return 'emerald';
  if (assetClass === 'stock') return 'rose';
  if (assetClass === 'index') return 'orange';
  if (assetClass === 'commodity') return 'amber';
  return 'emerald';
}

const accentClasses: Record<
  'emerald' | 'amber' | 'rose' | 'orange' | 'teal',
  { bg: string; text: string; border: string; grad: string; marker: string }
> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/30', grad: 'from-emerald-500/20 to-transparent', marker: 'bg-emerald-500' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30', grad: 'from-amber-500/20 to-transparent', marker: 'bg-amber-500' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-500', border: 'border-rose-500/30', grad: 'from-rose-500/20 to-transparent', marker: 'bg-rose-500' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/30', grad: 'from-orange-500/20 to-transparent', marker: 'bg-orange-500' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/30', grad: 'from-teal-500/20 to-transparent', marker: 'bg-teal-500' },
};

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
async function fetchAssets(): Promise<AssetOption[]> {
  // Fetch crypto + all markets quotes in parallel, then merge.
  const [cryptoRes, marketsRes] = await Promise.all([
    fetch('/api/crypto/prices', { cache: 'no-store' }),
    fetch('/api/markets/quotes?class=all', { cache: 'no-store' }),
  ]);
  const cryptoJson: ApiResult<Ticker[]> = await cryptoRes.json();
  const marketsJson: ApiResult<Record<string, any>> = await marketsRes.json();

  const out: AssetOption[] = [];

  // Crypto (Binance) — array of tickers
  if (cryptoJson.success && Array.isArray(cryptoJson.data)) {
    for (const t of cryptoJson.data) {
      out.push({
        symbol: t.symbol,
        name: t.symbol,
        assetClass: 'crypto',
        price: t.price,
        changePct: t.changePct,
        source: 'binance',
      });
    }
  }

  // Non-crypto (Yahoo) — record of symbol → quote
  if (marketsJson.success && marketsJson.data) {
    for (const [sym, q] of Object.entries(marketsJson.data)) {
      // Skip crypto entries (already added above from Binance)
      if ((q as any).assetClass === 'crypto') continue;
      out.push({
        symbol: sym,
        name: (q as any).name || sym,
        assetClass: (q as any).assetClass || 'unknown',
        price: (q as any).price || 0,
        changePct: (q as any).changePct || 0,
        source: 'yahoo',
      });
    }
  }

  // Sort: crypto first, then by symbol alpha
  out.sort((a, b) => {
    if (a.assetClass === 'crypto' && b.assetClass !== 'crypto') return -1;
    if (a.assetClass !== 'crypto' && b.assetClass === 'crypto') return 1;
    return a.symbol.localeCompare(b.symbol);
  });
  return out;
}

async function fetchAlerts(status: 'active' | 'triggered' | 'all'): Promise<PriceAlert[]> {
  const r = await fetch(`/api/price-alerts?status=${status}`, { cache: 'no-store' });
  const j: ApiResult<PriceAlert[]> = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to load alerts');
  return j.data ?? [];
}

async function checkAlerts(): Promise<CheckSummary> {
  const r = await fetch('/api/price-alerts/check', { method: 'POST' });
  const j: ApiResult<CheckSummary> = await r.json();
  if (!j.success) throw new Error(j.error || 'Check failed');
  return j.data ?? { checked: 0, triggered: 0, results: [] };
}

// ---------------------------------------------------------------------------
// Asset Picker (Popover + Command combobox)
// ---------------------------------------------------------------------------
function AssetPicker({
  value,
  assets,
  onPick,
}: {
  value: AssetOption | null;
  assets: AssetOption[];
  onPick: (a: AssetOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query) return assets;
    const q = query.toLowerCase();
    return assets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.assetClass.toLowerCase().includes(q),
    );
  }, [assets, query]);

  // Group by asset class for nicer display
  const grouped = useMemo(() => {
    const groups: Record<string, AssetOption[]> = {};
    for (const a of filtered) {
      (groups[a.assetClass] ||= []).push(a);
    }
    return groups;
  }, [filtered]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs">{cleanSymbol(value.symbol)}</span>
              <span className="text-muted-foreground text-xs truncate">— {fmtPrice(value.price)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              Pick an asset…
            </span>
          )}
          <ArrowRightLeft className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search symbol, name, or class…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No asset found.</CommandEmpty>
            {Object.entries(grouped).map(([cls, items]) => (
              <CommandGroup key={cls} heading={cls.toUpperCase()}>
                {items.map((a) => {
                  const accent = accentForAsset(a.assetClass, a.symbol);
                  const ac = accentClasses[accent];
                  const up = a.changePct >= 0;
                  return (
                    <CommandItem
                      key={a.symbol}
                      value={a.symbol}
                      onSelect={() => {
                        onPick(a);
                        setOpen(false);
                        setQuery('');
                      }}
                      className="gap-2"
                    >
                      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', ac.bg, ac.text)}>
                        <span className="text-[10px] font-bold uppercase">{a.assetClass.slice(0, 1)}</span>
                      </span>
                      <span className="font-mono text-xs">{cleanSymbol(a.symbol)}</span>
                      <span className="text-muted-foreground text-xs truncate flex-1">{a.name}</span>
                      <span className={cn('text-xs font-mono tabular-nums', up ? 'text-emerald-500' : 'text-rose-500')}>
                        {fmtPrice(a.price)}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Stats Tile
// ---------------------------------------------------------------------------
function StatsTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  index,
}: {
  icon: typeof Target;
  label: string;
  value: string | number;
  sub?: string;
  accent: 'emerald' | 'teal' | 'amber' | 'rose' | 'orange';
  index: number;
}) {
  const cls: Record<typeof accent, { bg: string; text: string; ring: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', ring: 'ring-emerald-500/20' },
    teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', ring: 'ring-teal-500/20' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-500', ring: 'ring-amber-500/20' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-500', ring: 'ring-rose-500/20' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', ring: 'ring-orange-500/20' },
  };
  const c = cls[accent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, delay: index * 0.05, ease: 'easeOut' }}
    >
      <Card className={cn('relative overflow-hidden border-border/60', 'ring-1', c.ring)}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">{label}</span>
              <span className="text-2xl font-bold tabular-nums tracking-tight">{value}</span>
              {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
            </div>
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', c.bg, c.text)}>
              <Icon className="h-4 w-4" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Distance/progress calculation — how close current price is to target
// ---------------------------------------------------------------------------
function distanceToTarget(
  condition: Condition,
  targetPrice: number,
  currentPrice: number | null,
): { pct: number; progress: number; direction: 'toward' | 'away' | 'flat' | 'unknown' } {
  if (currentPrice == null || currentPrice === 0 || targetPrice === 0) {
    return { pct: 0, progress: 0, direction: 'unknown' };
  }
  const diff = targetPrice - currentPrice;
  const pct = (diff / currentPrice) * 100;
  // For 'above'/'crosses_up' we want price to rise to target → progress = how close we are
  // For 'below'/'crosses_down' we want price to fall to target → progress = how close we are
  // Use a window of ±20% around the current price as the visual range, clamped 0..100.
  const WINDOW = 0.2; // 20% — distance at which progress is 0
  const absPct = Math.abs(pct);
  let progress = Math.max(0, Math.min(100, 100 * (1 - absPct / (WINDOW * 100))));
  let direction: 'toward' | 'away' | 'flat' | 'unknown' = 'flat';
  if (condition === 'above' || condition === 'crosses_up') {
    direction = diff > 0 ? 'toward' : diff < 0 ? 'away' : 'flat';
    // If price already above target (diff negative), progress = 100 (triggered)
    if (diff <= 0) progress = 100;
  } else {
    direction = diff < 0 ? 'toward' : diff > 0 ? 'away' : 'flat';
    if (diff >= 0) progress = 100;
  }
  return { pct, progress, direction };
}

// ---------------------------------------------------------------------------
// Active Alert Card
// ---------------------------------------------------------------------------
function ActiveAlertCard({
  alert,
  livePrice,
  index,
  onDelete,
  onToggle,
  busy,
}: {
  alert: PriceAlert;
  livePrice: number | null;
  index: number;
  onDelete: (id: string) => void;
  onToggle: (id: string, status: 'active' | 'disabled') => void;
  busy: boolean;
}) {
  const condDef = CONDITION_DEFS.find((c) => c.value === alert.condition);
  const CondIcon = condDef?.icon ?? Target;
  const isDisabled = alert.status === 'disabled';
  const dist = distanceToTarget(alert.condition, alert.targetPrice, livePrice);

  // Use livePrice if available, else fall back to alert.currentPrice (last checked)
  const displayPrice = livePrice ?? alert.currentPrice;
  const accent = accentForAsset('forex', alert.assetSymbol); // neutral — accent by status instead
  const ac = accentClasses[accent];

  // Status-based styling
  const statusAccent =
    isDisabled
      ? { text: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-border/60' }
      : dist.direction === 'toward' && dist.progress >= 80
        ? { text: 'text-rose-500', bg: 'bg-rose-500/5', border: 'border-rose-500/30' }
        : dist.direction === 'toward' && dist.progress >= 50
          ? { text: 'text-amber-500', bg: 'bg-amber-500/5', border: 'border-amber-500/30' }
          : { text: 'text-emerald-500', bg: 'bg-emerald-500/5', border: 'border-emerald-500/30' };

  const progressColor =
    dist.direction === 'toward' && dist.progress >= 80
      ? '[&>[data-slot=progress-indicator]]:bg-rose-500'
      : dist.direction === 'toward' && dist.progress >= 50
        ? '[&>[data-slot=progress-indicator]]:bg-amber-500'
        : '[&>[data-slot=progress-indicator]]:bg-emerald-500';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.3), ease: 'easeOut' }}
      layout
    >
      <Card
        className={cn(
          'relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20',
          statusAccent.border,
          statusAccent.bg,
          isDisabled && 'opacity-60',
        )}
      >
        <div className={cn('absolute left-0 top-0 bottom-0 w-1', statusAccent.text.replace('text-', 'bg-'))} />
        <CardContent className="p-4 pl-5">
          {/* Top row: symbol + status + actions */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-start gap-2 min-w-0">
              <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ac.bg, ac.text)}>
                <CondIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold truncate">{cleanSymbol(alert.assetSymbol)}</span>
                  <Badge variant="outline" className={cn('text-[9px] uppercase tracking-wider gap-0.5', statusAccent.text, statusAccent.border)}>
                    {isDisabled ? 'Disabled' : alert.status}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <span className="capitalize">{condDef?.label ?? alert.condition}</span>
                  <span className="opacity-50">·</span>
                  <span className="font-mono">{fmtPrice(alert.targetPrice)}</span>
                  <span className="opacity-50">·</span>
                  <span className="capitalize">{alert.channel}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => onToggle(alert.id, isDisabled ? 'active' : 'disabled')}
                disabled={busy}
                title={isDisabled ? 'Enable' : 'Disable'}
              >
                {isDisabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
                onClick={() => onDelete(alert.id)}
                disabled={busy}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Note (if any) */}
          {alert.note && (
            <p className="text-[11px] text-muted-foreground/80 italic mb-2.5 line-clamp-2 pl-2 border-l-2 border-border/60">
              {alert.note}
            </p>
          )}

          {/* Current price + distance */}
          <div className="flex items-end justify-between gap-3 mb-2">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">Current</div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold tabular-nums tracking-tight">{fmtPrice(displayPrice)}</span>
                {displayPrice != null && displayPrice > 0 && (
                  <span
                    className={cn(
                      'text-[11px] font-medium tabular-nums',
                      dist.direction === 'toward'
                        ? dist.progress >= 80
                          ? 'text-rose-500'
                          : dist.progress >= 50
                            ? 'text-amber-500'
                            : 'text-emerald-500'
                        : dist.direction === 'away'
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground',
                    )}
                  >
                    {dist.pct >= 0 ? '+' : ''}{dist.pct.toFixed(2)}% to target
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">Target</div>
              <div className="text-sm font-mono tabular-nums text-muted-foreground">{fmtPrice(alert.targetPrice)}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-1.5">
            <Progress value={dist.progress} className={cn('h-1.5', progressColor)} />
            <div className="flex items-center justify-between mt-1 text-[9px] text-muted-foreground/60">
              <span>{dist.progress >= 100 ? 'AT TARGET' : `${dist.progress.toFixed(0)}% there`}</span>
              <span>
                {displayPrice != null
                  ? `Last: ${formatDistanceToNow(new Date(alert.updatedAt), { addSuffix: true })}`
                  : 'No live data'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Triggered Alert Card
// ---------------------------------------------------------------------------
function TriggeredAlertCard({
  alert,
  index,
  onReenable,
  onDelete,
  busy,
}: {
  alert: PriceAlert;
  index: number;
  onReenable: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const condDef = CONDITION_DEFS.find((c) => c.value === alert.condition);
  const CondIcon = condDef?.icon ?? Target;
  const triggeredAt = alert.triggeredAt ? new Date(alert.triggeredAt) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.3), ease: 'easeOut' }}
      layout
    >
      <Card className="relative overflow-hidden border-rose-500/20 bg-rose-500/[0.03] hover:shadow-lg hover:shadow-rose-500/5 transition-all">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500/60" />
        <CardContent className="p-4 pl-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-start gap-2 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold truncate">{cleanSymbol(alert.assetSymbol)}</span>
                  <Badge variant="outline" className="text-[9px] uppercase tracking-wider text-rose-500 border-rose-500/40 bg-rose-500/5">
                    Triggered
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <CondIcon className="h-3 w-3" />
                  <span className="capitalize">{condDef?.label ?? alert.condition}</span>
                  <span className="opacity-50">·</span>
                  <span className="font-mono">{fmtPrice(alert.targetPrice)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={() => onReenable(alert.id)}
                disabled={busy}
              >
                <Power className="h-3 w-3" />
                Re-enable
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
                onClick={() => onDelete(alert.id)}
                disabled={busy}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[10px] mt-3 pt-3 border-t border-border/60">
            <div>
              <div className="text-muted-foreground/70 uppercase tracking-wider mb-0.5">Triggered at</div>
              <div className="font-mono tabular-nums text-rose-500 font-medium">{fmtPrice(alert.currentPrice)}</div>
            </div>
            <div>
              <div className="text-muted-foreground/70 uppercase tracking-wider mb-0.5">When</div>
              <div className="font-mono tabular-nums">
                {triggeredAt ? format(triggeredAt, 'MMM d, HH:mm') : '—'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground/70 uppercase tracking-wider mb-0.5">Channel</div>
              <div className="capitalize">{alert.channel}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Create Alert Form
// ---------------------------------------------------------------------------
function CreateAlertForm({
  assets,
  onCreate,
  creating,
}: {
  assets: AssetOption[];
  onCreate: (data: {
    assetSymbol: string;
    condition: Condition;
    targetPrice: number;
    channel: Channel;
    note?: string;
  }) => void;
  creating: boolean;
}) {
  const [picked, setPicked] = useState<AssetOption | null>(null);
  const [condition, setCondition] = useState<Condition>('above');
  const [targetPrice, setTargetPrice] = useState<string>('');
  const [channel, setChannel] = useState<Channel>('dashboard');
  const [note, setNote] = useState<string>('');
  const [touched, setTouched] = useState(false);

  const targetNum = parseFloat(targetPrice);
  const targetValid = isFinite(targetNum) && targetNum > 0;
  const canSubmit = !!picked && targetValid && !creating;

  const handleSubmit = () => {
    setTouched(true);
    if (!picked || !targetValid) return;
    onCreate({
      assetSymbol: picked.symbol,
      condition,
      targetPrice: targetNum,
      channel,
      note: note.trim() || undefined,
    });
    // Reset form
    setPicked(null);
    setCondition('above');
    setTargetPrice('');
    setChannel('dashboard');
    setNote('');
    setTouched(false);
  };

  return (
    <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.04] to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Plus className="h-4 w-4 text-emerald-500" />
          Create New Alert
        </CardTitle>
        <CardDescription className="text-[11px]">
          Pick any asset, choose a condition, set a target — we&apos;ll watch it for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3.5">
        {/* Asset picker */}
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Asset</Label>
          <AssetPicker value={picked} assets={assets} onPick={setPicked} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Condition */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Condition</Label>
            <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_DEFS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="flex items-center gap-2">
                      <c.icon className="h-3.5 w-3.5" />
                      {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Target price */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Target Price</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="e.g. 70000"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className={cn('tabular-nums', touched && !targetValid && 'border-rose-500/60 focus-visible:ring-rose-500/20')}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Channel */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Notify via</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_DEFS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="flex items-center gap-2">
                      <c.icon className="h-3.5 w-3.5" />
                      {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Note (optional)</Label>
            <Input
              type="text"
              placeholder="e.g. take profit zone"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
            />
          </div>
        </div>

        {/* Live price hint */}
        {picked && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/40">
            <Activity className="h-3 w-3 text-emerald-500" />
            <span>Current price of <span className="font-mono">{cleanSymbol(picked.symbol)}</span>: <span className="font-mono font-semibold text-foreground">{fmtPrice(picked.price)}</span></span>
            <span className="text-muted-foreground/60">·</span>
            <span className={picked.changePct >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
              {picked.changePct >= 0 ? '+' : ''}{picked.changePct.toFixed(2)}% 24h
            </span>
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/20"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create Alert
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function AlertSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-7 w-7" />
        </div>
        <Skeleton className="h-6 w-32 mb-2" />
        <Skeleton className="h-1.5 w-full" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof BellRing;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground mb-3">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-sm mb-4">{description}</p>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------
export function PriceAlertsClient() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'active' | 'triggered'>('active');
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const lastCheckRef = useRef<number>(0);

  // ---- Live asset prices (auto-refresh 30s) ----
  const assetsQuery = useQuery<AssetOption[]>({
    queryKey: ['price-alert-assets'],
    queryFn: fetchAssets,
    refetchInterval: 30 * 1000,
    staleTime: 10 * 1000,
  });

  // ---- Alerts (active + triggered) — single source, refetch 60s ----
  const alertsQuery = useQuery<PriceAlert[]>({
    queryKey: ['price-alerts', 'all'],
    queryFn: () => fetchAlerts('all'),
    refetchInterval: 60 * 1000,
    staleTime: 15 * 1000,
  });

  // ---- Auto-check alerts every 2 min (calls /api/price-alerts/check) ----
  // Also runs once on mount after a short delay.
  useEffect(() => {
    const runCheck = async () => {
      try {
        await checkAlerts();
        lastCheckRef.current = Date.now();
        // Refresh alerts list so any newly-triggered ones appear.
        await queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
      } catch {
        /* best-effort */
      }
    };
    const initial = setTimeout(runCheck, 3000);
    const interval = setInterval(runCheck, 2 * 60 * 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [queryClient]);

  // Build a fast lookup of live prices by symbol
  const livePriceMap = useMemo(() => {
    const m = new Map<string, number>();
    if (assetsQuery.data) {
      for (const a of assetsQuery.data) {
        if (a.price > 0) m.set(a.symbol, a.price);
      }
    }
    return m;
  }, [assetsQuery.data]);

  // Partition alerts
  const allAlerts = alertsQuery.data ?? [];
  const activeAlerts = useMemo(
    () => allAlerts.filter((a) => a.status === 'active' || a.status === 'disabled'),
    [allAlerts],
  );
  const triggeredAlerts = useMemo(
    () => allAlerts.filter((a) => a.status === 'triggered'),
    [allAlerts],
  );

  // ---- Stats ----
  const stats = useMemo(() => {
    const activeCount = activeAlerts.filter((a) => a.status === 'active').length;
    const triggeredCount = triggeredAlerts.length;
    // Closest to triggering = active alert with highest progress
    let closest: { alert: PriceAlert; progress: number; dist: number } | null = null;
    for (const a of activeAlerts.filter((a) => a.status === 'active')) {
      const live = livePriceMap.get(a.assetSymbol) ?? a.currentPrice;
      if (live == null || live === 0) continue;
      const dist = distanceToTarget(a.condition, a.targetPrice, live);
      if (!closest || dist.progress > closest.progress) {
        closest = { alert: a, progress: dist.progress, dist: Math.abs(dist.pct) };
      }
    }
    return {
      activeCount,
      triggeredCount,
      closest,
    };
  }, [activeAlerts, triggeredAlerts, livePriceMap]);

  // ---- Mutations ----
  const handleCreate = async (data: {
    assetSymbol: string;
    condition: Condition;
    targetPrice: number;
    channel: Channel;
    note?: string;
  }) => {
    setCreating(true);
    try {
      const r = await fetch('/api/price-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const j: ApiResult<PriceAlert> = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to create alert');
      toast.success('Alert created', {
        description: `${data.assetSymbol} ${data.condition} ${data.targetPrice}`,
      });
      await queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    } catch (e: any) {
      toast.error('Could not create alert', { description: e.message });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const r = await fetch(`/api/price-alerts?id=${id}`, { method: 'DELETE' });
      const j: ApiResult<{ id: string }> = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to delete alert');
      toast.success('Alert deleted');
      await queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    } catch (e: any) {
      toast.error('Could not delete alert', { description: e.message });
    }
  };

  const handleToggle = async (id: string, status: 'active' | 'disabled') => {
    setTogglingId(id);
    try {
      const r = await fetch(`/api/price-alerts?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const j: ApiResult<PriceAlert> = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to update alert');
      toast.success(status === 'active' ? 'Alert enabled' : 'Alert disabled');
      await queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    } catch (e: any) {
      toast.error('Could not update alert', { description: e.message });
    } finally {
      setTogglingId(null);
    }
  };

  const handleReenable = async (id: string) => {
    setTogglingId(id);
    try {
      const r = await fetch(`/api/price-alerts?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      const j: ApiResult<PriceAlert> = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to re-enable alert');
      toast.success('Alert re-enabled');
      await queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    } catch (e: any) {
      toast.error('Could not re-enable alert', { description: e.message });
    } finally {
      setTogglingId(null);
    }
  };

  const handleCheckNow = async () => {
    setChecking(true);
    const t = toast.loading('Checking alerts against live prices…');
    try {
      const summary = await checkAlerts();
      toast.dismiss(t);
      if (summary.triggered > 0) {
        toast.success(`${summary.triggered} alert${summary.triggered === 1 ? '' : 's'} triggered!`, {
          description: `Checked ${summary.checked} active alerts.`,
        });
      } else {
        toast.success('Check complete', {
          description: `Checked ${summary.checked} alert${summary.checked === 1 ? '' : 's'} — none triggered.`,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    } catch (e: any) {
      toast.dismiss(t);
      toast.error('Check failed', { description: e.message });
    } finally {
      setChecking(false);
    }
  };

  const isLoading = alertsQuery.isLoading;
  const isError = alertsQuery.isError;
  const assetsLoading = assetsQuery.isLoading;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 md:py-8 space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
          className="flex flex-col md:flex-row md:items-end md:justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 shrink-0">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Price Alerts</h1>
                <Badge variant="outline" className="gap-1 text-[10px] border-emerald-500/30 bg-emerald-500/5 text-emerald-500">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                  </span>
                  LIVE
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Set threshold alerts on any asset — crypto, forex, stocks, indices, commodities. Get notified on the dashboard or via Telegram when prices cross your targets.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckNow}
              disabled={checking}
              className="gap-2"
            >
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-emerald-500" />}
              Check Now
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                assetsQuery.refetch();
                alertsQuery.refetch();
              }}
              className="gap-2"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (assetsQuery.isFetching || alertsQuery.isFetching) && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </motion.div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatsTile
            icon={Target}
            label="Active Alerts"
            value={stats.activeCount}
            sub="Watching thresholds"
            accent="teal"
            index={0}
          />
          <StatsTile
            icon={Trophy}
            label="Triggered (All Time)"
            value={stats.triggeredCount}
            sub={stats.triggeredCount > 0 ? 'Successfully fired' : 'None yet — set one!'}
            accent="amber"
            index={1}
          />
          <StatsTile
            icon={Flame}
            label="Closest To Trigger"
            value={stats.closest ? `${stats.closest.progress.toFixed(0)}%` : '—'}
            sub={
              stats.closest
                ? `${cleanSymbol(stats.closest.alert.assetSymbol)} · ${stats.closest.dist.toFixed(2)}% away`
                : 'No active alerts'
            }
            accent="rose"
            index={2}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Create Alert form */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.32, delay: 0.1, ease: 'easeOut' }}
            className="lg:col-span-1"
          >
            <CreateAlertForm
              assets={assetsQuery.data ?? []}
              onCreate={handleCreate}
              creating={creating}
            />
          </motion.div>

          {/* Right: Alerts tabs */}
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.32, delay: 0.15, ease: 'easeOut' }}
            className="lg:col-span-2"
          >
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'active' | 'triggered')}>
              <div className="flex items-center justify-between mb-3">
                <TabsList>
                  <TabsTrigger value="active" className="gap-1.5">
                    <Target className="h-3.5 w-3.5" />
                    Active
                    {stats.activeCount > 0 && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{stats.activeCount}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="triggered" className="gap-1.5">
                    <Trophy className="h-3.5 w-3.5" />
                    Triggered
                    {stats.triggeredCount > 0 && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{stats.triggeredCount}</Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
                <span className="text-[10px] text-muted-foreground/70 hidden md:flex items-center gap-1.5">
                  <Activity className="h-3 w-3 text-emerald-500" />
                  Prices refresh every 30s · auto-check every 2 min
                </span>
              </div>

              <TabsContent value="active" className="mt-0">
                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <AlertSkeleton />
                    <AlertSkeleton />
                    <AlertSkeleton />
                    <AlertSkeleton />
                  </div>
                ) : isError ? (
                  <Card className="border-rose-500/30 bg-rose-500/[0.03]">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 shrink-0">
                          <AlertCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold mb-1">Could not load alerts</h3>
                          <p className="text-xs text-muted-foreground mb-3">{alertsQuery.error?.message}</p>
                          <Button size="sm" variant="outline" onClick={() => alertsQuery.refetch()}>
                            Retry
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : activeAlerts.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="p-0">
                      <EmptyState
                        icon={BellRing}
                        title="No active alerts yet"
                        description="Use the form on the left to create your first price alert. Pick any asset — crypto, forex, stocks, indices, or commodities — and we'll watch it 24/7."
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[1100px] overflow-y-auto pr-1
                    [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full
                    [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
                    {activeAlerts.map((a, i) => (
                      <ActiveAlertCard
                        key={a.id}
                        alert={a}
                        livePrice={livePriceMap.get(a.assetSymbol) ?? null}
                        index={i}
                        onDelete={handleDelete}
                        onToggle={handleToggle}
                        busy={togglingId === a.id}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="triggered" className="mt-0">
                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <AlertSkeleton />
                    <AlertSkeleton />
                  </div>
                ) : triggeredAlerts.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="p-0">
                      <EmptyState
                        icon={Sparkles}
                        title="No triggered alerts"
                        description="When one of your price alerts fires, it will appear here with the trigger timestamp and the price at the moment it crossed. Then you can re-enable it for the next move."
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[1100px] overflow-y-auto pr-1
                    [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full
                    [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
                    {triggeredAlerts.map((a, i) => (
                      <TriggeredAlertCard
                        key={a.id}
                        alert={a}
                        index={i}
                        onReenable={handleReenable}
                        onDelete={handleDelete}
                        busy={togglingId === a.id}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-border/60 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <CircleDashed className="h-3 w-3" />
            <span>
              Alerts check on every scheduler tick (every 15 min for crypto) + on demand via &quot;Check Now&quot;.
              Crosses-up/down conditions need at least one prior price check before they can fire.
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
            <Badge variant="outline" className="text-[10px] gap-1">
              <Activity className="h-3 w-3 text-emerald-500" />
              {assetsLoading ? 'Loading assets…' : `${assetsQuery.data?.length ?? 0} assets tracked`}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
