'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
  ChevronsUpDown,
  Trophy,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  PieChart as PieChartIcon,
  Coins,
  Building2,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Bitcoin,
  Calendar,
  Sparkles,
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
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { ApiResult, Ticker } from '@/lib/types';
import type {
  PortfolioHoldingWithPnl,
  PortfolioTotals,
  PortfolioResponse,
} from '@/app/api/portfolio/route';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AssetOption {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  changePct: number;
  source: 'binance' | 'yahoo';
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
async function fetchPortfolio(): Promise<PortfolioResponse> {
  const r = await fetch('/api/portfolio', { cache: 'no-store' });
  const j: ApiResult<PortfolioResponse> = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to load portfolio');
  return (j.data as PortfolioResponse) || { holdings: [], totals: emptyTotals() };
}

async function fetchAssets(): Promise<AssetOption[]> {
  const [cryptoRes, marketsRes] = await Promise.all([
    fetch('/api/crypto/prices', { cache: 'no-store' }),
    fetch('/api/markets/quotes?class=all', { cache: 'no-store' }),
  ]);
  const cryptoJson: ApiResult<Ticker[]> = await cryptoRes.json();
  const marketsJson: ApiResult<Record<string, any>> = await marketsRes.json();

  const out: AssetOption[] = [];
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
  if (marketsJson.success && marketsJson.data) {
    for (const [sym, q] of Object.entries(marketsJson.data)) {
      const qd = q as any;
      if (qd.assetClass === 'crypto') continue;
      out.push({
        symbol: sym,
        name: qd.name || sym,
        assetClass: qd.assetClass || 'unknown',
        price: qd.price || 0,
        changePct: qd.changePct || 0,
        source: 'yahoo',
      });
    }
  }
  out.sort((a, b) => {
    if (a.assetClass === 'crypto' && b.assetClass !== 'crypto') return -1;
    if (a.assetClass !== 'crypto' && b.assetClass === 'crypto') return 1;
    return a.symbol.localeCompare(b.symbol);
  });
  return out;
}

function emptyTotals(): PortfolioTotals {
  return {
    totalValue: 0,
    totalCost: 0,
    totalPnl: 0,
    totalPnlPct: 0,
    bestPerformer: null,
    worstPerformer: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtPrice(p: number | null | undefined): string {
  if (p == null || !isFinite(p) || p === 0) return '—';
  if (p >= 10000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toFixed(6);
}

function fmtUsd(v: number): string {
  if (!isFinite(v)) return '$0.00';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(2)}K`;
  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(q: number): string {
  if (!isFinite(q)) return '—';
  if (q >= 1000) return q.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (q >= 1) return q.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return q.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function fmtPct(p: number, withSign = true): string {
  if (!isFinite(p)) return '—';
  const sign = withSign && p > 0 ? '+' : '';
  return `${sign}${p.toFixed(2)}%`;
}

function classLabel(c: string): string {
  switch (c) {
    case 'crypto': return 'Crypto';
    case 'forex': return 'Forex';
    case 'stock': return 'Stock';
    case 'index': return 'Index';
    case 'commodity': return 'Commodity';
    default: return c || 'Asset';
  }
}

// Renders the right lucide icon for an asset class without dynamically
// assigning a component to a capitalized variable inside the consumer's
// render (keeps the react-hooks/static-components lint rule happy).
function ClassIcon({ ac, className }: { ac: string; className?: string }) {
  if (ac === 'crypto') return <Bitcoin className={className} />;
  if (ac === 'forex') return <ArrowLeftRight className={className} />;
  if (ac === 'stock') return <Building2 className={className} />;
  if (ac === 'index') return <BarChart3 className={className} />;
  if (ac === 'commodity') return <Boxes className={className} />;
  return <Coins className={className} />;
}

function classColor(c: string): string {
  switch (c) {
    case 'crypto': return 'text-emerald-500 bg-emerald-500/10';
    case 'forex': return 'text-teal-500 bg-teal-500/10';
    case 'stock': return 'text-rose-500 bg-rose-500/10';
    case 'index': return 'text-orange-500 bg-orange-500/10';
    case 'commodity': return 'text-amber-500 bg-amber-500/10';
    default: return 'text-muted-foreground bg-muted';
  }
}

// Emerald/teal palette for the allocation pie chart — NO indigo/blue
const PIE_COLORS = [
  '#10b981', // emerald-500
  '#14b8a6', // teal-500
  '#22c55e', // green-500
  '#84cc16', // lime-500
  '#eab308', // yellow-500
  '#f59e0b', // amber-500
  '#f97316', // orange-500
  '#ef4444', // red-500
  '#ec4899', // pink-500
  '#a855f7', // violet-500 (allowed — used sparingly)
  '#64748b', // slate-500
  '#78716c', // stone-500
];

// ---------------------------------------------------------------------------
// Asset Picker (Popover + Command combobox)
// ---------------------------------------------------------------------------
function AssetPicker({
  assets,
  value,
  onPick,
  loading,
}: {
  assets: AssetOption[];
  value: AssetOption | null;
  onPick: (a: AssetOption) => void;
  loading: boolean;
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
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', classColor(value.assetClass))}>
                {value.assetClass.slice(0, 3)}
              </span>
              <span className="font-mono font-semibold">{value.symbol}</span>
              <span className="text-xs text-muted-foreground truncate">{fmtPrice(value.price)}</span>
            </span>
          ) : loading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading assets…
            </span>
          ) : (
            <span className="text-muted-foreground">Search for an asset…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search symbol or name…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-72">
            <CommandEmpty>No asset found.</CommandEmpty>
            {Object.entries(grouped).map(([cls, items]) => (
              <CommandGroup key={cls} heading={classLabel(cls)}>
                {items.slice(0, 30).map((a) => (
                  <CommandItem
                    key={`${a.source}-${a.symbol}`}
                    value={`${a.symbol} ${a.name} ${a.assetClass}`}
                    onSelect={() => {
                      onPick(a);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-1 h-4 w-4',
                        value?.symbol === a.symbol ? 'opacity-100 text-emerald-500' : 'opacity-0',
                      )}
                    />
                    <span className="font-mono text-sm font-semibold">{a.symbol}</span>
                    <span className="ml-2 text-xs text-muted-foreground truncate flex-1">{a.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{fmtPrice(a.price)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------
function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'default',
  delay = 0,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: any;
  accent?: 'default' | 'emerald' | 'rose' | 'amber';
  delay?: number;
}) {
  const accentClass = {
    default: 'text-muted-foreground bg-muted/50',
    emerald: 'text-emerald-500 bg-emerald-500/10',
    rose: 'text-rose-500 bg-rose-500/10',
    amber: 'text-amber-500 bg-amber-500/10',
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </CardTitle>
          <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', accentClass)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
          {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Allocation Pie Chart
// ---------------------------------------------------------------------------
function AllocationChart({ holdings }: { holdings: PortfolioHoldingWithPnl[] }) {
  const data = useMemo(() => {
    return holdings
      .filter((h) => h.currentValue > 0)
      .map((h) => ({
        name: h.assetSymbol,
        value: h.currentValue,
        assetClass: h.assetClass,
      }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <PieChartIcon className="h-8 w-8 opacity-50" />
          <span>Add holdings to see allocation</span>
        </div>
      </div>
    );
  }

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            stroke="hsl(var(--background))"
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <RechartsTooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number, _name, item: any) => {
              const pct = total > 0 ? ((value as number) / total) * 100 : 0;
              return [`${fmtUsd(value as number)} · ${pct.toFixed(1)}%`, item?.payload?.name];
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            iconType="circle"
            wrapperStyle={{ fontSize: 11 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Holding Dialog
// ---------------------------------------------------------------------------
function AddHoldingDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [picked, setPicked] = useState<AssetOption | null>(null);
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [entryDate, setEntryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Load assets once when dialog first opens
  useEffect(() => {
    if (open && assets.length === 0 && !loadingAssets) {
      setLoadingAssets(true);
      fetchAssets()
        .then(setAssets)
        .catch((e) => toast.error('Failed to load assets', { description: e.message }))
        .finally(() => setLoadingAssets(false));
    }
  }, [open, assets.length, loadingAssets]);

  // Pre-fill entry price when an asset is picked
  useEffect(() => {
    if (picked && picked.price > 0 && !entryPrice) {
      setEntryPrice(String(picked.price));
    }
  }, [picked, entryPrice]);

  function reset() {
    setPicked(null);
    setQuantity('');
    setEntryPrice('');
    setEntryDate(format(new Date(), 'yyyy-MM-dd'));
    setNotes('');
  }

  async function handleSave() {
    if (!picked) {
      toast.error('Select an asset first');
      return;
    }
    const q = Number(quantity);
    const ep = Number(entryPrice);
    if (!isFinite(q) || q <= 0) {
      toast.error('Quantity must be a positive number');
      return;
    }
    if (!isFinite(ep) || ep <= 0) {
      toast.error('Entry price must be a positive number');
      return;
    }

    setSaving(true);
    try {
      const r = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetSymbol: picked.symbol,
          quantity: q,
          entryPrice: ep,
          notes: notes.trim() || undefined,
          entryDate: new Date(entryDate).toISOString(),
        }),
      });
      const j: ApiResult<any> = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to add holding');
      toast.success('Holding added', {
        description: `${picked.symbol} · ${fmtQty(q)} @ ${fmtPrice(ep)}`,
      });
      reset();
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      onCreated();
    } catch (e: any) {
      toast.error('Failed to add holding', { description: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-500" /> Add Holding
          </DialogTitle>
          <DialogDescription>
            Record a new position. Current prices and P&L are computed live.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="asset">Asset</Label>
            <AssetPicker
              assets={assets}
              value={picked}
              onPick={setPicked}
              loading={loadingAssets}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="0.00"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Entry Price ($)</Label>
              <Input
                id="price"
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="0.00"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date" className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Entry Date
            </Label>
            <Input
              id="date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              placeholder="Strategy, thesis, exchange…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {picked && quantity && entryPrice && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Position Value</span>
                <span className="font-mono font-semibold text-emerald-500">
                  {fmtUsd(Number(quantity) * Number(entryPrice))}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !picked} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add Holding
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Holding row — kept inline to satisfy the react-hooks static-component rule
// ---------------------------------------------------------------------------
function HoldingRow({
  h,
  allocationPct,
  onDelete,
}: {
  h: PortfolioHoldingWithPnl;
  allocationPct: number;
  onDelete: (h: PortfolioHoldingWithPnl) => void;
}) {
  const pnlPositive = h.pnl >= 0;
  const hasLivePrice = h.currentPrice != null;

  return (
    <TableRow className="group">
      {/* Asset */}
      <TableCell className="pl-3 py-3">
        <div className="flex items-center gap-2.5">
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-md', classColor(h.assetClass))}>
            <ClassIcon ac={h.assetClass} className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-sm font-semibold">{h.assetSymbol}</span>
            <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
              {h.name}
            </span>
          </div>
        </div>
      </TableCell>
      {/* Quantity */}
      <TableCell className="text-right font-mono text-sm tabular-nums">
        {fmtQty(h.quantity)}
      </TableCell>
      {/* Entry Price */}
      <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
        {fmtPrice(h.entryPrice)}
      </TableCell>
      {/* Current Price */}
      <TableCell className="text-right font-mono text-sm tabular-nums">
        {hasLivePrice ? (
          <span>{fmtPrice(h.currentPrice)}</span>
        ) : (
          <span className="text-muted-foreground italic">n/a</span>
        )}
        {h.dayChangePct != null && (
          <div
            className={cn(
              'text-[10px] tabular-nums',
              h.dayChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500',
            )}
          >
            {h.dayChangePct >= 0 ? '+' : ''}
            {h.dayChangePct.toFixed(2)}%
          </div>
        )}
      </TableCell>
      {/* Current Value */}
      <TableCell className="text-right font-mono text-sm tabular-nums font-semibold">
        {hasLivePrice ? fmtUsd(h.currentValue) : '—'}
      </TableCell>
      {/* P&L $ */}
      <TableCell
        className={cn(
          'text-right font-mono text-sm tabular-nums font-semibold',
          !hasLivePrice && 'text-muted-foreground',
          hasLivePrice && pnlPositive && 'text-emerald-500',
          hasLivePrice && !pnlPositive && 'text-rose-500',
        )}
      >
        {hasLivePrice ? (
          <span className="inline-flex items-center gap-0.5">
            {pnlPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {fmtUsd(Math.abs(h.pnl))}
          </span>
        ) : (
          '—'
        )}
      </TableCell>
      {/* P&L % */}
      <TableCell
        className={cn(
          'text-right font-mono text-sm tabular-nums font-semibold',
          !hasLivePrice && 'text-muted-foreground',
          hasLivePrice && pnlPositive && 'text-emerald-500',
          hasLivePrice && !pnlPositive && 'text-rose-500',
        )}
      >
        {hasLivePrice ? fmtPct(h.pnlPct) : '—'}
      </TableCell>
      {/* Allocation */}
      <TableCell className="pr-3">
        <div className="flex items-center gap-2 w-32">
          <Progress
            value={allocationPct}
            className="h-1.5 bg-muted"
            indicatorClassName={cn(
              'transition-all',
              pnlPositive ? 'bg-emerald-500' : 'bg-rose-500',
            )}
          />
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums w-10 text-right">
            {allocationPct.toFixed(1)}%
          </span>
        </div>
      </TableCell>
      {/* Actions */}
      <TableCell className="pr-3 text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
          onClick={() => onDelete(h)}
          aria-label={`Delete ${h.assetSymbol} holding`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function PortfolioClient() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<PortfolioResponse>({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    refetchInterval: 60_000, // auto-refresh every 60s
    staleTime: 30_000,
  });

  const holdings = data?.holdings ?? [];
  const totals = data?.totals ?? emptyTotals();
  const totalValue = totals.totalValue;

  // Compute allocation % per holding
  const allocationMap = useMemo(() => {
    const m = new Map<string, number>();
    if (totalValue > 0) {
      for (const h of holdings) {
        m.set(h.id, (h.currentValue / totalValue) * 100);
      }
    }
    return m;
  }, [holdings, totalValue]);

  function handleRefresh() {
    refetch();
    toast.success('Refreshing portfolio', {
      description: 'Re-fetching live prices from Binance + Yahoo.',
    });
  }

  async function handleDelete(h: PortfolioHoldingWithPnl) {
    if (!confirm(`Remove ${h.assetSymbol} from your portfolio?`)) return;
    setDeletingId(h.id);
    try {
      const r = await fetch(`/api/portfolio?id=${h.id}`, { method: 'DELETE' });
      const j: ApiResult<{ id: string }> = await r.json();
      if (!j.success) throw new Error(j.error || 'Delete failed');
      toast.success('Holding removed', { description: h.assetSymbol });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
    } catch (e: any) {
      toast.error('Failed to delete holding', { description: e.message });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Portfolio Tracker</h1>
            <p className="text-sm text-muted-foreground">
              Track your holdings across all asset classes with live P&L
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="h-4 w-4" />
            Add Holding
          </Button>
        </div>
      </motion.div>

      {/* Error state */}
      {isError && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-rose-500 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-rose-500">Failed to load portfolio</div>
              <div className="text-xs text-muted-foreground">{(error as Error)?.message}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-3 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-7 w-24 mb-2" />
                <Skeleton className="h-3 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <SummaryCard
            label="Total Value"
            value={fmtUsd(totals.totalValue)}
            sub={<span>{holdings.length} {holdings.length === 1 ? 'holding' : 'holdings'}</span>}
            icon={Activity}
            accent="emerald"
            delay={0.02}
          />
          <SummaryCard
            label="Total Cost"
            value={fmtUsd(totals.totalCost)}
            sub={<span>invested capital</span>}
            icon={Wallet}
            delay={0.04}
          />
          <SummaryCard
            label="Total P&L"
            value={fmtUsd(totals.totalPnl)}
            sub={
              <span className={totals.totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                {totals.totalPnl >= 0 ? 'profit' : 'loss'}
              </span>
            }
            icon={totals.totalPnl >= 0 ? TrendingUp : TrendingDown}
            accent={totals.totalPnl >= 0 ? 'emerald' : 'rose'}
            delay={0.06}
          />
          <SummaryCard
            label="Total P&L %"
            value={fmtPct(totals.totalPnlPct)}
            sub={
              <span className={totals.totalPnlPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                {totals.totalPnlPct >= 0 ? 'outperforming' : 'underwater'}
              </span>
            }
            icon={totals.totalPnlPct >= 0 ? TrendingUp : TrendingDown}
            accent={totals.totalPnlPct >= 0 ? 'emerald' : 'rose'}
            delay={0.08}
          />
          <SummaryCard
            label="Best Performer"
            value={totals.bestPerformer ? totals.bestPerformer.symbol : '—'}
            sub={
              totals.bestPerformer ? (
                <span className="text-emerald-500 font-mono">{fmtPct(totals.bestPerformer.pnlPct)}</span>
              ) : (
                <span>no data</span>
              )
            }
            icon={Trophy}
            accent="emerald"
            delay={0.1}
          />
          <SummaryCard
            label="Worst Performer"
            value={totals.worstPerformer ? totals.worstPerformer.symbol : '—'}
            sub={
              totals.worstPerformer ? (
                <span className="text-rose-500 font-mono">{fmtPct(totals.worstPerformer.pnlPct)}</span>
              ) : (
                <span>no data</span>
              )
            }
            icon={Flame}
            accent="rose"
            delay={0.12}
          />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && holdings.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 mb-4">
                <Wallet className="h-7 w-7 text-emerald-500" />
              </div>
              <h3 className="text-lg font-semibold">No holdings yet</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                Add your first position to start tracking P&L. Supports crypto, forex,
                stocks, indices, and commodities.
              </p>
              <Button
                className="mt-5 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" /> Add your first holding
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Holdings table + Allocation chart */}
      {!isLoading && !isError && holdings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Holdings table — spans 2 cols on lg */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="lg:col-span-2"
          >
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Activity className="h-4 w-4 text-emerald-500" /> Holdings
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Live P&L refreshed every 60 seconds · {holdings.length} {holdings.length === 1 ? 'position' : 'positions'}
                    </CardDescription>
                  </div>
                  {isFetching && (
                    <Badge variant="outline" className="text-[10px] gap-1 text-emerald-500 border-emerald-500/30">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> updating
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[640px] overflow-y-auto rounded-b-xl">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/40 backdrop-blur-sm">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-3">Asset</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Entry</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right text-emerald-500">P&L $</TableHead>
                        <TableHead className="text-right text-emerald-500">P&L %</TableHead>
                        <TableHead>Alloc</TableHead>
                        <TableHead className="pr-3 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {holdings.map((h) => (
                        <HoldingRow
                          key={h.id}
                          h={h}
                          allocationPct={allocationMap.get(h.id) ?? 0}
                          onDelete={handleDelete}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Allocation chart */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.18 }}
          >
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <PieChartIcon className="h-4 w-4 text-teal-500" /> Allocation
                </CardTitle>
                <CardDescription className="text-xs">
                  By current market value
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AllocationChart holdings={holdings} />
                <Separator className="my-3" />
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {holdings
                    .filter((h) => h.currentValue > 0)
                    .sort((a, b) => b.currentValue - a.currentValue)
                    .map((h, i) => (
                      <div key={h.id} className="flex items-center gap-2 text-xs">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="font-mono font-semibold">{h.assetSymbol}</span>
                        <span className="text-muted-foreground truncate flex-1">{h.name}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {(allocationMap.get(h.id) ?? 0).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      )}

      {/* Footer note */}
      {!isLoading && holdings.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground pt-2">
          <Sparkles className="h-3 w-3 text-emerald-500" />
          <span>
            Prices from Binance (crypto) + Yahoo Finance (forex / stocks / indices / commodities).
            Yahoo rate-limiting may temporarily disable live quotes for non-crypto assets.
          </span>
        </div>
      )}

      {/* Add holding dialog (always mounted so it can open instantly) */}
      <AddHoldingDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          /* query invalidated inside dialog */
        }}
      />

      {/* Deleting overlay state — purely visual, used to flag any in-flight deletes */}
      {deletingId && (
        <div className="sr-only" aria-live="polite">
          Deleting holding…
        </div>
      )}
    </div>
  );
}
