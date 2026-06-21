'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Calculator,
  Gauge,
  Layers,
  BookOpen,
  Info,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
  Check,
  ChevronsUpDown,
  Plus,
  Trash2,
  Zap,
  ShieldAlert,
  Target,
  Wallet,
  Scale,
  Crosshair,
  Bitcoin,
  ArrowLeftRight,
  Building2,
  BarChart3,
  Boxes,
  Coins,
  AlertTriangle,
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
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
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
import { cn } from '@/lib/utils';
import type { ApiResult, Ticker } from '@/lib/types';
import {
  calculatePositionSize,
  calculateRiskReward,
  calculateLiquidation,
  calculatePortfolioRisk,
  fmtUsd,
  fmtQty,
  fmtPrice,
  fmtPct,
  fmtNum,
  type TradeDirection,
  type PortfolioPositionInput,
} from '@/lib/risk/calculations';

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

interface PortfolioPosition extends PortfolioPositionInput {
  // optional UI extras (currently none)
  readonly _brand?: unique symbol;
}

interface PersistedState {
  accountSize: number;
  riskPct: number;
  direction: TradeDirection;
  entryPrice: string;
  stopLossPrice: string;
  takeProfitPrice: string;
  leverage: number;
  leverageDirection: TradeDirection;
  leveragePositionValue: string;
  portfolioPositions: PortfolioPosition[];
  portfolioAccountSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_STATE: PersistedState = {
  accountSize: 10000,
  riskPct: 1,
  direction: 'long',
  entryPrice: '',
  stopLossPrice: '',
  takeProfitPrice: '',
  leverage: 10,
  leverageDirection: 'long',
  leveragePositionValue: '1000',
  portfolioPositions: [],
  portfolioAccountSize: 10000,
};

const STORAGE_KEY = 'omniscient.risk-calc.v1';

const PIE_COLORS = [
  '#10b981', // emerald-500
  '#14b8a6', // teal-500
  '#f59e0b', // amber-500
  '#f97316', // orange-500
  '#ef4444', // red-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
  '#22c55e', // green-500
  '#a855f7', // violet-500
  '#64748b', // slate-500
];

const RISK_RULES = [
  {
    icon: ShieldAlert,
    title: '1% Rule',
    accent: 'emerald',
    summary: 'Never risk more than 1% of your account on a single trade.',
    math: 'Risk $ = Account × 1%\n$10,000 → $100 max loss per trade',
    detail:
      'The conservative default used by professional futures traders. Lets you survive long losing streaks without catastrophic drawdown.',
  },
  {
    icon: Crosshair,
    title: '2% Rule',
    accent: 'amber',
    summary: 'Maximum risk per trade — the upper bound for active traders.',
    math: 'Risk $ = Account × 2%\n$10,000 → $200 max loss per trade',
    detail:
      'Aggressive but defensible for day-traders with high win-rates. Going beyond 2% dramatically raises the risk of ruin.',
  },
  {
    icon: Scale,
    title: 'Risk:Reward ≥ 2:1',
    accent: 'teal',
    summary: 'Aim for at least $2 of potential profit per $1 of risk.',
    math: 'RR = (TP − Entry) / (Entry − Stop)\nBreakeven win-rate at 2R = 33%',
    detail:
      'With a 2:1 R/R, you only need 34% of trades to win to be profitable. A 3:1 R/R drops the breakeven to 25%.',
  },
  {
    icon: Layers,
    title: 'Max 6% Portfolio Risk',
    accent: 'rose',
    summary: 'Total open risk across all positions must not exceed 6% of account.',
    math: 'Σ (size × |entry − stop|) / Account × 100 ≤ 6%\n$10,000 → $600 total at risk',
    detail:
      'The "Turtle" rule. When total portfolio risk hits 6%, stop opening new positions until existing ones close.',
  },
];

// ---------------------------------------------------------------------------
// Persistence hook (localStorage)
// ---------------------------------------------------------------------------
function usePersistedState(): [PersistedState, (patch: Partial<PersistedState>) => void, () => void] {
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE);

  // Hydrate from localStorage on mount — one-time read of an external store.
  // This is the canonical pattern for client-only persistence after hydration;
  // the setState-in-effect rule is intentionally disabled for this line.
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
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

  const reset = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
    setState(DEFAULT_STATE);
  }, []);

  return [state, update, reset];
}

// ---------------------------------------------------------------------------
// Asset fetcher (same pattern as Portfolio)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Asset Picker (Popover + Command combobox)
// ---------------------------------------------------------------------------
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

function AssetPicker({
  assets,
  value,
  onPick,
  loading,
  align = 'start',
  className,
}: {
  assets: AssetOption[];
  value: AssetOption | null;
  onPick: (a: AssetOption) => void;
  loading: boolean;
  align?: 'start' | 'center' | 'end';
  className?: string;
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
          className={cn('justify-between font-normal', className)}
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
            <span className="text-muted-foreground">Pick an asset…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align={align}>
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
// Small UI atoms
// ---------------------------------------------------------------------------
function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: any;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{title}</span>
          </div>
          {description && (
            <p className="text-sm text-foreground font-medium mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-left leading-relaxed font-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function LabelWithInfo({ htmlFor, children, info }: { htmlFor?: string; children: React.ReactNode; info: string }) {
  return (
    <Label htmlFor={htmlFor} className="flex items-center gap-1.5 text-xs font-medium">
      {children}
      <InfoTip text={info} />
    </Label>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'default',
  delay = 0,
  formula,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: any;
  accent?: 'default' | 'emerald' | 'rose' | 'amber' | 'teal';
  delay?: number;
  formula?: string;
}) {
  const accentClass = {
    default: 'text-muted-foreground bg-muted/50 border-transparent',
    emerald: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
    rose: 'text-rose-500 bg-rose-500/10 border-rose-500/20',
    amber: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    teal: 'text-teal-500 bg-teal-500/10 border-teal-500/20',
  }[accent];

  const valueColor = {
    default: 'text-foreground',
    emerald: 'text-emerald-500',
    rose: 'text-rose-500',
    amber: 'text-amber-500',
    teal: 'text-teal-500',
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      whileHover={{ y: -2 }}
    >
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden transition-colors hover:border-border">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {label}
              {formula && <InfoTip text={formula} />}
            </span>
            <div className={cn('flex h-7 w-7 items-center justify-center rounded-md border', accentClass)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className={cn('text-2xl font-bold tracking-tight tabular-nums font-mono', valueColor)}>
            {value}
          </div>
          {sub && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Large mono number input
function MonoInput({
  value,
  onChange,
  placeholder,
  id,
  prefix,
  suffix,
  step = 'any',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  prefix?: string;
  suffix?: string;
  step?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono pointer-events-none">
          {prefix}
        </span>
      )}
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-11 font-mono tabular-nums text-base font-semibold',
          prefix && 'pl-7',
          suffix && 'pr-10',
        )}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk/Reward visual bar (rose → zinc → emerald)
// ---------------------------------------------------------------------------
function RiskRewardBar({
  entry,
  stop,
  tp,
  direction,
}: {
  entry: number;
  stop: number;
  tp: number | null;
  direction: TradeDirection;
}) {
  if (!isFinite(entry) || !isFinite(stop) || entry === stop) {
    return (
      <div className="h-12 rounded-md bg-muted/30 border border-border/50 flex items-center justify-center text-xs text-muted-foreground">
        Enter entry + stop to visualise the risk / reward zones
      </div>
    );
  }

  // Determine price range. Without TP, show symmetrical zone around entry.
  const riskPerUnit = Math.abs(entry - stop);
  let low = direction === 'long' ? stop : entry - riskPerUnit;
  let high = direction === 'long' ? entry + riskPerUnit : entry;
  if (tp != null && isFinite(tp) && tp > 0) {
    low = Math.min(low, tp, stop, entry);
    high = Math.max(high, tp, stop, entry);
  }
  // Pad 4% so endpoints don't sit on the edge
  const pad = (high - low) * 0.04 || 1;
  low -= pad;
  high += pad;
  const range = high - low || 1;

  const pct = (p: number) => ((p - low) / range) * 100;

  const entryPct = pct(entry);
  const stopPct = pct(stop);
  const tpPct = tp != null && isFinite(tp) ? pct(tp) : null;

  // Gradient: rose zone on stop side, emerald zone on TP side
  // For long: stop is left (rose), TP is right (emerald), entry in middle
  // For short: stop is right (rose), TP is left (emerald)
  const isLong = direction === 'long';
  const gradient = isLong
    ? `linear-gradient(90deg, rgba(244,63,94,0.45) 0%, rgba(244,63,94,0.15) ${Math.min(stopPct, entryPct)}%, rgba(161,161,170,0.15) ${entryPct}%, rgba(16,185,129,0.15) ${entryPct}%, rgba(16,185,129,0.45) 100%)`
    : `linear-gradient(90deg, rgba(16,185,129,0.45) 0%, rgba(16,185,129,0.15) ${Math.min(tpPct ?? entryPct, entryPct)}%, rgba(161,161,170,0.15) ${entryPct}%, rgba(244,63,94,0.15) ${entryPct}%, rgba(244,63,94,0.45) 100%)`;

  return (
    <div className="space-y-2">
      <div
        className="relative h-14 rounded-md border border-border/50 overflow-hidden"
        style={{ background: gradient }}
      >
        {/* Stop marker */}
        <div
          className="absolute top-0 bottom-0 border-l-2 border-rose-500/70 flex items-center justify-center"
          style={{ left: `${stopPct}%` }}
        >
          <Badge variant="outline" className="absolute -top-0.5 left-1 text-[9px] bg-rose-500/10 text-rose-500 border-rose-500/30">
            SL {fmtPrice(stop)}
          </Badge>
        </div>

        {/* Entry marker */}
        <div
          className="absolute top-0 bottom-0 border-l-2 border-zinc-400/70"
          style={{ left: `${entryPct}%` }}
        >
          <Badge variant="outline" className="absolute -top-0.5 -translate-x-1/2 text-[9px] bg-zinc-500/10 text-zinc-300 border-zinc-500/30">
            ENTRY {fmtPrice(entry)}
          </Badge>
        </div>

        {/* TP marker */}
        {tpPct != null && (
          <div
            className="absolute top-0 bottom-0 border-l-2 border-emerald-500/70"
            style={{ left: `${tpPct}%` }}
          >
            <Badge variant="outline" className="absolute -top-0.5 right-1 text-[9px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
              TP {fmtPrice(tp!)}
            </Badge>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>{fmtPrice(low)}</span>
        <span>{fmtPrice(high)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leverage gauge (semicircular SVG)
// ---------------------------------------------------------------------------
function LeverageGauge({ leverage }: { leverage: number }) {
  const maxLev = 50;
  const clamped = Math.max(1, Math.min(maxLev, leverage));
  const pct = clamped / maxLev; // 0..1

  // Color stops
  let color = '#10b981'; // emerald
  if (clamped > 10) color = '#f43f5e'; // rose
  else if (clamped > 5) color = '#f59e0b'; // amber

  // Semicircle geometry
  const size = 180;
  const r = 70;
  const cx = size / 2;
  const cy = size / 2 + 20;
  const startAngle = Math.PI; // 180deg
  const endAngle = 0; // 0deg
  const angle = startAngle - pct * (startAngle - endAngle);

  const polar = (a: number, rad: number) => ({
    x: cx + rad * Math.cos(a),
    y: cy - rad * Math.sin(a),
  });

  const arcPath = (a0: number, a1: number, rad: number) => {
    const p0 = polar(a0, rad);
    const p1 = polar(a1, rad);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    const sweep = a0 > a1 ? 1 : 0;
    return `M ${p0.x} ${p0.y} A ${rad} ${rad} 0 ${large} ${sweep} ${p1.x} ${p1.y}`;
  };

  const needle = polar(angle, r - 8);
  const needleTip = polar(angle, r - 24);

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 30} viewBox={`0 0 ${size} ${size / 2 + 30}`}>
        {/* Background track */}
        <path d={arcPath(startAngle, endAngle, r)} fill="none" stroke="hsl(var(--muted))" strokeWidth={10} strokeLinecap="round" />

        {/* Colored progress arc */}
        <path
          d={arcPath(startAngle, angle, r)}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          style={{ transition: 'all 0.3s ease' }}
        />

        {/* Tick marks at 5x, 10x, 20x, 50x */}
        {[5, 10, 20, 50].map((tick) => {
          const tickPct = tick / maxLev;
          const tickAngle = startAngle - tickPct * (startAngle - endAngle);
          const outer = polar(tickAngle, r + 6);
          const inner = polar(tickAngle, r - 6);
          const labelPos = polar(tickAngle, r + 14);
          return (
            <g key={tick}>
              <line
                x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                stroke="hsl(var(--muted-foreground))" strokeWidth={1}
              />
              <text
                x={labelPos.x} y={labelPos.y}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 9, fontFamily: 'monospace' }}
              >
                {tick}x
              </text>
            </g>
          );
        })}

        {/* Needle */}
        <line
          x1={needle.x} y1={needle.y} x2={needleTip.x} y2={needleTip.y}
          stroke={color} strokeWidth={3} strokeLinecap="round"
          style={{ transition: 'all 0.3s ease' }}
        />
        <circle cx={cx} cy={cy} r={4} fill={color} style={{ transition: 'all 0.3s ease' }} />
      </svg>
      <div className="flex items-center gap-2 -mt-2">
        <span className="text-2xl font-bold font-mono tabular-nums" style={{ color }}>
          {clamped}×
        </span>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px]',
            clamped > 10
              ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
              : clamped > 5
                ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
          )}
        >
          {clamped > 10 ? 'DANGER' : clamped > 5 ? 'CAUTION' : 'SAFE'}
        </Badge>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline risk-distribution donut (recharts-free, pure SVG so it works
// without recharts' ResponsiveContainer quirks in flex layouts)
// ---------------------------------------------------------------------------
function RiskDonut({
  data,
}: {
  data: Array<{ symbol: string; value: number; color: string }>;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0 || data.length === 0) {
    return (
      <div className="h-[180px] flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <Layers className="h-8 w-8 opacity-30" />
        <span>Add positions to see risk distribution</span>
      </div>
    );
  }

  const size = 180;
  const r = 60;
  const innerR = 38;
  const cx = size / 2;
  const cy = size / 2;

  // Compute donut slices via reduce to avoid mutating a counter inside .map
  // (satisfies the react-hooks/immutability rule)
  const slices = data.reduce<{
    path: string;
    color: string;
    symbol: string;
    value: number;
    pct: number;
  }[]>((acc, d) => {
    // Cumulative sum of previous slices gives the start position for this slice.
    const cumSum = acc.reduce((s, x) => s + x.value, 0);
    const startAngle = (cumSum / total) * 2 * Math.PI - Math.PI / 2;
    const endAngle = ((cumSum + d.value) / total) * 2 * Math.PI - Math.PI / 2;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const xi1 = cx + innerR * Math.cos(endAngle);
    const yi1 = cy + innerR * Math.sin(endAngle);
    const xi2 = cx + innerR * Math.cos(startAngle);
    const yi2 = cy + innerR * Math.sin(startAngle);

    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${innerR} ${innerR} 0 ${largeArc} 0 ${xi2} ${yi2} Z`;
    acc.push({ path, color: d.color, symbol: d.symbol, value: d.value, pct: (d.value / total) * 100 });
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {slices.map((s, i) => (
          <path
            key={i}
            d={s.path}
            fill={s.color}
            stroke="hsl(var(--background))"
            strokeWidth={2}
            className="hover:opacity-80 transition-opacity cursor-pointer"
          >
            <title>{`${s.symbol}: ${fmtUsd(s.value)} (${s.pct.toFixed(1)}%)`}</title>
          </path>
        ))}
        <text
          x={cx} y={cy - 4}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 10, fontFamily: 'monospace' }}
        >
          TOTAL
        </text>
        <text
          x={cx} y={cy + 12}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}
        >
          {fmtUsd(total, { compact: true })}
        </text>
      </svg>
      <div className="flex-1 space-y-1.5 min-w-0">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
            <span className="font-mono font-semibold truncate">{s.symbol}</span>
            <span className="text-muted-foreground ml-auto font-mono tabular-nums">
              {s.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================
export function RiskCalculatorClient() {
  const [state, update, reset] = usePersistedState();
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [pickedAsset, setPickedAsset] = useState<AssetOption | null>(null);

  // Portfolio add-position form state (not persisted)
  const [newPosSymbol, setNewPosSymbol] = useState('');
  const [newPosEntry, setNewPosEntry] = useState('');
  const [newPosStop, setNewPosStop] = useState('');
  const [newPosSize, setNewPosSize] = useState('');
  const [newPosDirection, setNewPosDirection] = useState<TradeDirection>('long');
  const [newPosGroup, setNewPosGroup] = useState('crypto');

  // Fetch assets for picker
  const { data: assets, isLoading: assetsLoading } = useQuery<AssetOption[]>({
    queryKey: ['risk-calc-assets'],
    queryFn: fetchAssets,
    staleTime: 60_000,
  });

  // Sync pickedAsset with current assets (refresh price)
  useEffect(() => {
    if (pickedAsset && assets) {
      const fresh = assets.find((a) => a.symbol === pickedAsset.symbol);
      if (fresh && fresh.price !== pickedAsset.price) {
        setPickedAsset(fresh);
      }
    }
  }, [assets, pickedAsset]);

  // ---- Live calculations ----
  const entryNum = parseFloat(state.entryPrice) || 0;
  const stopNum = parseFloat(state.stopLossPrice) || 0;
  const tpNum = parseFloat(state.takeProfitPrice) || 0;

  const positionSize = useMemo(
    () =>
      calculatePositionSize({
        accountSize: state.accountSize,
        riskPct: state.riskPct,
        entryPrice: entryNum,
        stopLossPrice: stopNum,
        direction: state.direction,
      }),
    [state.accountSize, state.riskPct, entryNum, stopNum, state.direction],
  );

  const riskReward = useMemo(
    () =>
      calculateRiskReward({
        entryPrice: entryNum,
        stopLossPrice: stopNum,
        takeProfitPrice: tpNum > 0 ? tpNum : undefined,
        positionSize: positionSize.positionSize,
        direction: state.direction,
      }),
    [entryNum, stopNum, tpNum, positionSize.positionSize, state.direction],
  );

  const leverageInputValue = parseFloat(state.leveragePositionValue) || 0;
  const leverageResult = useMemo(
    () =>
      calculateLiquidation({
        entryPrice: entryNum > 0 ? entryNum : 0,
        leverage: state.leverage,
        positionValue: leverageInputValue > 0 ? leverageInputValue : undefined,
        direction: state.leverageDirection,
      }),
    [entryNum, state.leverage, leverageInputValue, state.leverageDirection],
  );

  const portfolioRisk = useMemo(
    () => calculatePortfolioRisk(state.portfolioAccountSize, state.portfolioPositions),
    [state.portfolioAccountSize, state.portfolioPositions],
  );

  // ---- Handlers ----
  const handleFetchLivePrice = useCallback(async () => {
    if (!pickedAsset) {
      toast.error('Pick an asset first', {
        description: 'Choose a symbol from the dropdown to fetch its live price.',
      });
      return;
    }
    setFetchingPrice(true);
    try {
      // Re-query to get the freshest price
      const fresh = await fetchAssets();
      const found = fresh.find((a) => a.symbol === pickedAsset.symbol);
      if (!found) throw new Error('Asset not found in latest prices');
      update({ entryPrice: String(found.price) });
      setPickedAsset(found);
      toast.success('Live price applied', {
        description: `${found.symbol} → ${fmtPrice(found.price)} (${found.source})`,
      });
    } catch (e: any) {
      toast.error('Failed to fetch live price', { description: e.message });
    } finally {
      setFetchingPrice(false);
    }
  }, [pickedAsset, update]);

  const handleAddPortfolioPosition = useCallback(() => {
    const sym = newPosSymbol.trim().toUpperCase();
    const entry = parseFloat(newPosEntry) || 0;
    const stop = parseFloat(newPosStop) || 0;
    const size = parseFloat(newPosSize) || 0;
    if (!sym || entry <= 0 || stop <= 0 || size <= 0) {
      toast.error('Fill all fields', { description: 'Symbol, entry, stop, and size are required.' });
      return;
    }
    const pos: PortfolioPosition = {
      id: `${sym}-${Date.now()}`,
      symbol: sym,
      entryPrice: entry,
      stopLossPrice: stop,
      positionSize: size,
      direction: newPosDirection,
      group: newPosGroup || 'ungrouped',
    };
    update({ portfolioPositions: [...state.portfolioPositions, pos] });
    setNewPosSymbol('');
    setNewPosEntry('');
    setNewPosStop('');
    setNewPosSize('');
    toast.success('Position added', { description: `${sym} · ${fmtQty(size)} @ ${fmtPrice(entry)}` });
  }, [newPosSymbol, newPosEntry, newPosStop, newPosSize, newPosDirection, newPosGroup, state.portfolioPositions, update]);

  const handleRemovePosition = useCallback((id: string) => {
    update({ portfolioPositions: state.portfolioPositions.filter((p) => p.id !== id) });
  }, [state.portfolioPositions, update]);

  // Donut chart data for portfolio risk distribution
  const donutData = useMemo(() => {
    return portfolioRisk.positions.map((p, i) => ({
      symbol: p.symbol,
      value: p.riskAmount,
      color: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [portfolioRisk.positions]);

  // ---- Render ----
  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Risk Calculator</h1>
              <p className="text-sm text-muted-foreground">
                Position sizer · Leverage & liquidation · Portfolio risk — inputs persist across refreshes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                reset();
                toast.success('Inputs reset to defaults');
              }}
              className="hover:border-rose-500/40 hover:text-rose-500"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </motion.div>

        {/* MAIN GRID: left = 3 calc panels stacked; right = risk rules + portfolio donut */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT COLUMN (2/3 width): 3 calc panels */}
          <div className="lg:col-span-2 space-y-6">
            {/* ============================================================
                PANEL 1: POSITION SIZE CALCULATOR
            ============================================================ */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
            >
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader className="pb-3">
                  <SectionHeader
                    icon={Calculator}
                    title="Position Sizer"
                    description="Size your trade so the stop-loss costs exactly N% of your account"
                  />
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Direction toggle */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground mr-2">Direction</span>
                    <div className="inline-flex rounded-md border border-border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => update({ direction: 'long' })}
                        className={cn(
                          'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                          state.direction === 'long'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                        )}
                      >
                        <TrendingUp className="h-3.5 w-3.5" /> Long
                      </button>
                      <button
                        type="button"
                        onClick={() => update({ direction: 'short' })}
                        className={cn(
                          'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                          state.direction === 'short'
                            ? 'bg-rose-500/15 text-rose-500'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                        )}
                      >
                        <TrendingDown className="h-3.5 w-3.5" /> Short
                      </button>
                    </div>
                  </div>

                  {/* Account + Risk inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithInfo
                        htmlFor="account-size"
                        info="Total capital at risk across all your trading. Used as the denominator for % risk calculations."
                      >
                        Account Size
                      </LabelWithInfo>
                      <MonoInput
                        id="account-size"
                        value={state.accountSize ? String(state.accountSize) : ''}
                        onChange={(v) => update({ accountSize: parseFloat(v) || 0 })}
                        placeholder="10000"
                        prefix="$"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <LabelWithInfo
                          htmlFor="risk-pct"
                          info="How much of your account you're willing to lose if the stop-loss hits. 1% is conservative, 2% is the upper bound."
                        >
                          Risk per Trade
                        </LabelWithInfo>
                        <Badge className="font-mono tabular-nums bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/15">
                          {state.riskPct.toFixed(2)}%
                        </Badge>
                      </div>
                      <Slider
                        id="risk-pct"
                        value={[state.riskPct]}
                        min={0.25}
                        max={5}
                        step={0.05}
                        onValueChange={([v]) => update({ riskPct: v })}
                        className="py-3"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                        <span>0.25%</span>
                        <span>1%</span>
                        <span>2%</span>
                        <span>3%</span>
                        <span>5%</span>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-border/50" />

                  {/* Asset picker + live price + entry/SL/TP */}
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <LabelWithInfo
                        info="Pick an asset to fetch its current market price. Uses the same live data as the Markets page (Binance for crypto, Yahoo + fallbacks for everything else)."
                      >
                        Asset (for live price)
                      </LabelWithInfo>
                      <div className="flex gap-2">
                        <AssetPicker
                          assets={assets || []}
                          value={pickedAsset}
                          onPick={setPickedAsset}
                          loading={assetsLoading}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          onClick={handleFetchLivePrice}
                          disabled={fetchingPrice || !pickedAsset}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                        >
                          {fetchingPrice ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Fetching…</>
                          ) : (
                            <><Zap className="h-4 w-4" /> Use live price</>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <LabelWithInfo
                          htmlFor="entry-price"
                          info="The price at which you open the position. Used to compute position value ($ exposure) and as the reference for stop/target distances."
                        >
                          Entry Price
                        </LabelWithInfo>
                        <MonoInput
                          id="entry-price"
                          value={state.entryPrice}
                          onChange={(v) => update({ entryPrice: v })}
                          placeholder="65000"
                          prefix="$"
                        />
                      </div>
                      <div className="space-y-2">
                        <LabelWithInfo
                          htmlFor="stop-price"
                          info="The price at which you exit for a loss. Distance from entry defines how many units you can buy while keeping risk constant."
                        >
                          Stop Loss
                        </LabelWithInfo>
                        <MonoInput
                          id="stop-price"
                          value={state.stopLossPrice}
                          onChange={(v) => update({ stopLossPrice: v })}
                          placeholder="63000"
                          prefix="$"
                        />
                      </div>
                      <div className="space-y-2">
                        <LabelWithInfo
                          htmlFor="tp-price"
                          info="Optional take-profit price. Required to compute the Risk:Reward ratio and potential profit."
                        >
                          Take Profit
                        </LabelWithInfo>
                        <MonoInput
                          id="tp-price"
                          value={state.takeProfitPrice}
                          onChange={(v) => update({ takeProfitPrice: v })}
                          placeholder="70000"
                          prefix="$"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Validation errors */}
                  {!positionSize.valid && positionSize.errors.length > 0 && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{positionSize.errors.join(' · ')}</span>
                    </div>
                  )}

                  {/* Output stat cards */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <StatCard
                      label="Risk Amount"
                      value={fmtUsd(positionSize.riskAmount)}
                      sub={`${state.riskPct.toFixed(2)}% of ${fmtUsd(state.accountSize, { compact: true })}`}
                      icon={Wallet}
                      accent="rose"
                      delay={0.05}
                      formula="Risk $ = Account × Risk%"
                    />
                    <StatCard
                      label="Position Size"
                      value={fmtQty(positionSize.positionSize)}
                      sub={pickedAsset ? `${pickedAsset.symbol} units` : 'units'}
                      icon={Layers}
                      accent="default"
                      delay={0.1}
                      formula="Size = Risk$ / |Entry − Stop|"
                    />
                    <StatCard
                      label="Position Value"
                      value={fmtUsd(positionSize.positionValue)}
                      sub="total $ exposure"
                      icon={Crosshair}
                      accent="teal"
                      delay={0.15}
                      formula="Value = Size × Entry"
                    />
                    <StatCard
                      label="Potential Loss @ SL"
                      value={fmtUsd(positionSize.potentialLoss)}
                      sub="should equal risk amount"
                      icon={TrendingDown}
                      accent="rose"
                      delay={0.2}
                      formula="Loss = Size × |Entry − Stop|"
                    />
                    <StatCard
                      label="Potential Profit @ TP"
                      value={riskReward.potentialProfit != null ? fmtUsd(riskReward.potentialProfit) : '—'}
                      sub={tpNum > 0 ? 'if TP hit' : 'add TP price'}
                      icon={TrendingUp}
                      accent="emerald"
                      delay={0.25}
                      formula="Profit = Size × |TP − Entry|"
                    />
                    <StatCard
                      label="Risk : Reward"
                      value={riskReward.ratio != null ? `${fmtNum(riskReward.ratio, 2)} : 1` : '—'}
                      sub={
                        riskReward.ratio != null
                          ? riskReward.ratio >= 2
                            ? <span className="text-emerald-500">healthy (≥ 2R)</span>
                            : <span className="text-amber-500">below 2R target</span>
                          : 'add TP to compute'
                      }
                      icon={Scale}
                      accent={riskReward.ratio != null && riskReward.ratio >= 2 ? 'emerald' : 'amber'}
                      delay={0.3}
                      formula="RR = |TP − Entry| / |Entry − Stop|"
                    />
                  </div>

                  {/* Risk/Reward visual bar */}
                  <div className="space-y-2">
                    <LabelWithInfo info="Visual map of the trade's risk zone (rose, between entry and stop) and reward zone (emerald, between entry and take-profit). Markers show exact price levels.">
                      Risk / Reward Map
                    </LabelWithInfo>
                    <RiskRewardBar
                      entry={entryNum}
                      stop={stopNum}
                      tp={tpNum > 0 ? tpNum : null}
                      direction={state.direction}
                    />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* ============================================================
                PANEL 2: LEVERAGE & LIQUIDATION CALCULATOR
            ============================================================ */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader className="pb-3">
                  <SectionHeader
                    icon={Gauge}
                    title="Leverage & Liquidation"
                    description="Margin required + liquidation price for leveraged positions"
                  />
                </CardHeader>
                <CardContent className="space-y-5">
                  <Tabs defaultValue="long" value={state.leverageDirection} onValueChange={(v) => update({ leverageDirection: v as TradeDirection })}>
                    <TabsList className="grid w-full grid-cols-2 max-w-xs">
                      <TabsTrigger value="long" className="data-[state=active]:text-emerald-500">
                        <TrendingUp className="h-3.5 w-3.5 mr-1" /> Long
                      </TabsTrigger>
                      <TabsTrigger value="short" className="data-[state=active]:text-rose-500">
                        <TrendingDown className="h-3.5 w-3.5 mr-1" /> Short
                      </TabsTrigger>
                    </TabsList>

                    {(['long', 'short'] as const).map((dir) => (
                      <TabsContent key={dir} value={dir} className="mt-4">
                        <AnimatePresence mode="wait">
                          {state.leverageDirection === dir && (
                            <motion.div
                              key={dir}
                              initial={{ opacity: 0, x: dir === 'long' ? -10 : 10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: dir === 'long' ? 10 : -10 }}
                              transition={{ duration: 0.2 }}
                              className="space-y-5"
                            >
                              {/* Leverage gauge + slider */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                                <div className="flex justify-center">
                                  <LeverageGauge leverage={state.leverage} />
                                </div>
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <LabelWithInfo
                                      info="Leverage multiplies your exposure. 10× means $100 controls $1000 of the asset. Higher leverage = smaller margin = closer liquidation price."
                                    >
                                      Leverage
                                    </LabelWithInfo>
                                    <Badge className="font-mono tabular-nums bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/15">
                                      {state.leverage}×
                                    </Badge>
                                  </div>
                                  <Slider
                                    value={[state.leverage]}
                                    min={1}
                                    max={50}
                                    step={1}
                                    onValueChange={([v]) => update({ leverage: v })}
                                    className="py-2"
                                  />
                                  <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                                    <span>1×</span>
                                    <span className="text-emerald-500">5×</span>
                                    <span className="text-amber-500">10×</span>
                                    <span className="text-rose-500">25×</span>
                                    <span>50×</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                                    {state.leverage <= 5 && (
                                      <>Safe zone — a {(100 / state.leverage).toFixed(1)}% adverse move liquidates you, which is rare for most assets.</>
                                    )}
                                    {state.leverage > 5 && state.leverage <= 10 && (
                                      <>Caution — a {(100 / state.leverage).toFixed(1)}% adverse move triggers liquidation. Use tight stops.</>
                                    )}
                                    {state.leverage > 10 && (
                                      <>Danger — only a {(100 / state.leverage).toFixed(1)}% adverse move liquidates the position. Funding fees can also eat margin quickly.</>
                                    )}
                                  </p>
                                </div>
                              </div>

                              <Separator className="bg-border/50" />

                              {/* Inputs: entry + position value */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <LabelWithInfo
                                    htmlFor="lev-entry"
                                    info="Entry price for the leveraged position. Used to convert between $ exposure and units, and as the reference for the liquidation formula."
                                  >
                                    Entry Price
                                  </LabelWithInfo>
                                  <MonoInput
                                    id="lev-entry"
                                    value={state.entryPrice}
                                    onChange={(v) => update({ entryPrice: v })}
                                    placeholder="65000"
                                    prefix="$"
                                  />
                                  <p className="text-[10px] text-muted-foreground">
                                    Shares the entry from the position sizer above.
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <LabelWithInfo
                                    htmlFor="lev-pos-value"
                                    info="Total $ exposure of the position (the notional value, before leverage). Margin required = this ÷ leverage."
                                  >
                                    Position Value (notional)
                                  </LabelWithInfo>
                                  <MonoInput
                                    id="lev-pos-value"
                                    value={state.leveragePositionValue}
                                    onChange={(v) => update({ leveragePositionValue: v })}
                                    placeholder="1000"
                                    prefix="$"
                                  />
                                </div>
                              </div>

                              {/* Output stat cards */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <StatCard
                                  label="Margin Required"
                                  value={fmtUsd(leverageResult.marginRequired)}
                                  sub={`of ${fmtUsd(leverageResult.positionValue, { compact: true })} notional`}
                                  icon={Wallet}
                                  accent="teal"
                                  delay={0.05}
                                  formula="Margin = PositionValue / Leverage"
                                />
                                <StatCard
                                  label="Liquidation Price"
                                  value={leverageResult.liquidationPrice != null ? fmtPrice(leverageResult.liquidationPrice) : '—'}
                                  sub={`${dir === 'long' ? 'below' : 'above'} entry`}
                                  icon={Crosshair}
                                  accent={leverageResult.riskLevel === 'danger' ? 'rose' : leverageResult.riskLevel === 'caution' ? 'amber' : 'default'}
                                  delay={0.1}
                                  formula={leverageResult.liqFormula || (dir === 'long' ? 'Entry × (1 − 1/Leverage)' : 'Entry × (1 + 1/Leverage)')}
                                />
                                <StatCard
                                  label="Maintenance Margin"
                                  value={fmtUsd(leverageResult.maintenanceMargin)}
                                  sub="0.5% of notional (typical)"
                                  icon={ShieldAlert}
                                  accent="amber"
                                  delay={0.15}
                                  formula="Maint = PositionValue × 0.5%"
                                />
                                <StatCard
                                  label="Position Size"
                                  value={leverageResult.positionSize != null ? fmtQty(leverageResult.positionSize) : '—'}
                                  sub="units at this entry"
                                  icon={Layers}
                                  accent="default"
                                  delay={0.2}
                                  formula="Size = PositionValue / Entry"
                                />
                              </div>

                              {/* Maintenance margin / high-leverage warning */}
                              {leverageResult.warning && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2"
                                >
                                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                  <span className="leading-relaxed">{leverageResult.warning}</span>
                                </motion.div>
                              )}

                              {/* Liquidation formula explainer */}
                              <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                                <span className="font-mono">
                                  L<sub>liq</sub> {dir === 'long' ? '=' : '='} Entry × (1 {dir === 'long' ? '−' : '+'} 1/{state.leverage})
                                </span>
                                {' '}
                                <span className="text-[10px]">
                                  = {fmtPrice(entryNum)} × (1 {dir === 'long' ? '−' : '+'} {(1 / state.leverage).toFixed(4)})
                                </span>
                                {' '}
                                <span className="text-emerald-500 font-mono">
                                  = {leverageResult.liquidationPrice != null ? fmtPrice(leverageResult.liquidationPrice) : '—'}
                                </span>
                                <p className="mt-1 text-[10px] italic">
                                  Simplified isolated-margin formula. Real exchanges add fees, funding, and tiered maintenance rates — treat as approximation.
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              </Card>
            </motion.div>

            {/* ============================================================
                PANEL 3: MULTI-TRADE PORTFOLIO RISK
            ============================================================ */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
            >
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader className="pb-3">
                  <SectionHeader
                    icon={Layers}
                    title="Portfolio Risk"
                    description="Aggregate risk across open positions — 6% rule enforcement"
                  />
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Portfolio account size + summary stats */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-2 sm:col-span-1">
                      <LabelWithInfo
                        htmlFor="port-account"
                        info="The account size to use when computing portfolio risk %s. Often the same as the per-trade account, but you can model a separate allocation here."
                      >
                        Portfolio Account
                      </LabelWithInfo>
                      <MonoInput
                        id="port-account"
                        value={state.portfolioAccountSize ? String(state.portfolioAccountSize) : ''}
                        onChange={(v) => update({ portfolioAccountSize: parseFloat(v) || 0 })}
                        placeholder="10000"
                        prefix="$"
                      />
                    </div>
                    <StatCard
                      label="Total Risk"
                      value={fmtUsd(portfolioRisk.totalRiskAmount)}
                      sub={`${fmtPct(portfolioRisk.totalRiskPct)} of account`}
                      icon={Wallet}
                      accent={portfolioRisk.maxPortfolioRiskExceeded ? 'rose' : portfolioRisk.totalRiskPct > 3 ? 'amber' : 'emerald'}
                      delay={0}
                      formula="Σ (Size × |Entry − Stop|)"
                    />
                    <StatCard
                      label="Open Positions"
                      value={String(state.portfolioPositions.length)}
                      sub={portfolioRisk.correlatedGroups.filter((g) => g.warning).length > 0
                        ? <span className="text-rose-500">{portfolioRisk.correlatedGroups.filter((g) => g.warning).length} correlated group(s) over 6%</span>
                        : 'no correlated overexposure'}
                      icon={Layers}
                      accent={portfolioRisk.correlatedGroups.filter((g) => g.warning).length > 0 ? 'rose' : 'default'}
                      delay={0.05}
                    />
                  </div>

                  {/* Total portfolio warning */}
                  {portfolioRisk.warning && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2"
                    >
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span className="leading-relaxed">{portfolioRisk.warning}</span>
                    </motion.div>
                  )}
                  {portfolioRisk.correlatedWarning && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2"
                    >
                      <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                      <span className="leading-relaxed">{portfolioRisk.correlatedWarning}</span>
                    </motion.div>
                  )}

                  {/* Add position form */}
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                      <Plus className="h-3.5 w-3.5" /> Add Position
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                      <Input
                        placeholder="Symbol (BTC)"
                        value={newPosSymbol}
                        onChange={(e) => setNewPosSymbol(e.target.value)}
                        className="font-mono"
                      />
                      <Input
                        type="number"
                        step="any"
                        placeholder="Entry"
                        value={newPosEntry}
                        onChange={(e) => setNewPosEntry(e.target.value)}
                        className="font-mono"
                      />
                      <Input
                        type="number"
                        step="any"
                        placeholder="Stop"
                        value={newPosStop}
                        onChange={(e) => setNewPosStop(e.target.value)}
                        className="font-mono"
                      />
                      <Input
                        type="number"
                        step="any"
                        placeholder="Size (units)"
                        value={newPosSize}
                        onChange={(e) => setNewPosSize(e.target.value)}
                        className="font-mono"
                      />
                      <select
                        value={newPosGroup}
                        onChange={(e) => setNewPosGroup(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm font-mono"
                      >
                        <option value="crypto">crypto</option>
                        <option value="forex">forex</option>
                        <option value="stock">stock</option>
                        <option value="commodity">commodity</option>
                        <option value="index">index</option>
                        <option value="ungrouped">other</option>
                      </select>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setNewPosDirection('long')}
                          className={cn(
                            'flex-1 rounded-md border text-xs flex items-center justify-center transition-colors',
                            newPosDirection === 'long'
                              ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                              : 'text-muted-foreground border-border hover:bg-muted/50',
                          )}
                        >
                          <TrendingUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewPosDirection('short')}
                          className={cn(
                            'flex-1 rounded-md border text-xs flex items-center justify-center transition-colors',
                            newPosDirection === 'short'
                              ? 'bg-rose-500/15 text-rose-500 border-rose-500/30'
                              : 'text-muted-foreground border-border hover:bg-muted/50',
                          )}
                        >
                          <TrendingDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={handleAddPortfolioPosition}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Plus className="h-4 w-4" /> Add Position to Portfolio
                    </Button>
                  </div>

                  {/* Positions table + donut */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Risk Distribution</div>
                      <div className="rounded-lg border border-border/50 bg-muted/10 p-4">
                        <RiskDonut data={donutData} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Open Positions</div>
                      <div className="rounded-lg border border-border/50 bg-muted/10 max-h-64 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:hsl(var(--muted-foreground))_transparent]">
                        {state.portfolioPositions.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            No positions yet. Add one above.
                          </div>
                        ) : (
                          <ul className="divide-y divide-border/40">
                            {state.portfolioPositions.map((p, i) => {
                              const r = portfolioRisk.positions.find((x) => x.id === p.id);
                              const color = PIE_COLORS[i % PIE_COLORS.length];
                              return (
                                <li key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                                  <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                                  <span className="font-mono font-semibold text-sm">{p.symbol}</span>
                                  <Badge variant="outline" className={cn('text-[9px]', p.direction === 'long' ? 'text-emerald-500 border-emerald-500/30' : 'text-rose-500 border-rose-500/30')}>
                                    {p.direction === 'long' ? 'L' : 'S'}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                                    {fmtQty(p.positionSize)} @ {fmtPrice(p.entryPrice)} / SL {fmtPrice(p.stopLossPrice)}
                                  </span>
                                  <span className="text-xs font-mono tabular-nums text-rose-500 w-16 text-right">
                                    {r ? fmtUsd(r.riskAmount, { compact: true }) : '—'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePosition(p.id)}
                                    className="text-muted-foreground hover:text-rose-500 transition-colors p-1"
                                    aria-label={`Remove ${p.symbol}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Correlated groups */}
                  {portfolioRisk.correlatedGroups.filter((g) => g.group !== 'ungrouped').length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Risk by Group</div>
                      <div className="flex flex-wrap gap-2">
                        {portfolioRisk.correlatedGroups
                          .filter((g) => g.group !== 'ungrouped')
                          .map((g) => (
                            <Badge
                              key={g.group}
                              variant="outline"
                              className={cn(
                                'px-2.5 py-1 font-mono tabular-nums',
                                g.warning
                                  ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                                  : 'bg-muted/30 text-muted-foreground border-border',
                              )}
                            >
                              {g.group}: {g.riskPct.toFixed(2)}% {g.warning && '⚠'}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* RIGHT COLUMN (1/3 width): Risk Rules Reference */}
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm sticky top-20">
                <CardHeader className="pb-3">
                  <SectionHeader
                    icon={BookOpen}
                    title="Risk Rules"
                    description="The professional trader's commandments"
                  />
                </CardHeader>
                <CardContent className="space-y-3">
                  {RISK_RULES.map((rule, i) => {
                    const Icon = rule.icon;
                    const accentBg = {
                      emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                      amber: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
                      teal: 'bg-teal-500/10 text-teal-500 border-teal-500/20',
                      rose: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
                    }[rule.accent] || 'bg-muted/50 text-muted-foreground border-border';

                    return (
                      <motion.div
                        key={rule.title}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: 0.15 + i * 0.05 }}
                        whileHover={{ y: -2, borderColor: 'hsl(var(--border))' }}
                        className="rounded-lg border border-border/50 bg-muted/20 p-3.5 hover:bg-muted/30 transition-colors cursor-default"
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn('flex h-8 w-8 items-center justify-center rounded-md border shrink-0', accentBg)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-sm font-semibold">{rule.title}</h4>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{rule.summary}</p>
                            <pre className="mt-1.5 text-[10px] font-mono bg-background/60 border border-border/40 rounded px-2 py-1.5 text-emerald-600 dark:text-emerald-400 whitespace-pre-wrap">
                              {rule.math}
                            </pre>
                            <p className="text-[10px] text-muted-foreground/80 italic leading-relaxed pt-0.5">{rule.detail}</p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}

                  <Separator className="bg-border/50 my-3" />

                  {/* Worked example */}
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3.5">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs uppercase tracking-wider text-emerald-500 font-semibold">Worked Example</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                      BTC entry $65,000 · SL $63,000 · TP $70,000 · account $10,000 · risk 1%
                    </p>
                    <ul className="text-[11px] font-mono space-y-1 text-foreground/80">
                      <li>• Risk amount: <span className="text-rose-500">$100</span></li>
                      <li>• Risk / unit: <span className="text-amber-500">$2,000</span></li>
                      <li>• Position size: <span className="text-emerald-500">0.05 BTC</span></li>
                      <li>• Position value: <span className="text-teal-500">$3,250</span></li>
                      <li>• Potential profit: <span className="text-emerald-500">$250</span></li>
                      <li>• Risk : reward: <span className="text-emerald-500">2.5 : 1</span></li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>

        {/* Footer note */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 pb-6 text-[11px] text-muted-foreground border-t border-border/50">
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
            Educational tool only — formulas are simplified. Real exchanges use tiered maintenance margins + fees + funding.
          </span>
          <span className="font-mono">
            Inputs auto-saved locally · Last reset: clear browser storage for this site
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}
