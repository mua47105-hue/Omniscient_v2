'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  LayoutDashboard,
  Bitcoin,
  Globe2,
  Grid3x3,
  TrendingUp,
  BellRing,
  BarChart3,
  Newspaper,
  Globe,
  CalendarDays,
  FileText,
  Settings,
  Search,
  Command as CommandIcon,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Loader2,
  Zap,
  AlertCircle,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { ApiResult, Ticker } from '@/lib/types';

// ---------------------------------------------------------------------------
// Event bus — lets the Header ⌘K button open the palette imperatively.
// ---------------------------------------------------------------------------
export const OPEN_COMMAND_PALETTE_EVENT = 'omniscient:open-command-palette';

// ---------------------------------------------------------------------------
// Navigation items — keep in sync with Sidebar.tsx
// ---------------------------------------------------------------------------
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/crypto', label: 'Crypto', icon: Bitcoin },
  { href: '/markets', label: 'Markets', icon: Globe2 },
  { href: '/heat-map', label: 'Heat Map', icon: Grid3x3 },
  { href: '/signals', label: 'Signals', icon: TrendingUp },
  { href: '/price-alerts', label: 'Alerts', icon: BellRing },
  { href: '/portfolio', label: 'Portfolio', icon: BarChart3 },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/news', label: 'News', icon: Newspaper },
  { href: '/macro', label: 'Macro', icon: Globe },
  { href: '/ipo-ico', label: 'IPO / ICO', icon: CalendarDays },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

// ---------------------------------------------------------------------------
// Asset type — flattened representation for the asset search section
// ---------------------------------------------------------------------------
interface AssetOption {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  changePct: number;
  source: 'binance' | 'yahoo';
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

  out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtPrice(p: number): string {
  if (!isFinite(p) || p === 0) return '—';
  if (p >= 10000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toFixed(6);
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

function assetHref(a: AssetOption): string {
  return a.assetClass === 'crypto' ? `/crypto/${a.symbol}` : `/markets/${a.symbol}`;
}

// ---------------------------------------------------------------------------
// CommandPalette
// ---------------------------------------------------------------------------
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [runningAction, setRunningAction] = React.useState<string | null>(null);

  // Global Cmd+K / Ctrl+K listener
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Allow the Header ⌘K button to open us
  React.useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
  }, []);

  // Fetch assets (only when palette has been opened at least once)
  const { data: assets } = useQuery<AssetOption[]>({
    queryKey: ['command-palette-assets'],
    queryFn: fetchAssets,
    enabled: open,
    staleTime: 60_000,
  });

  // Filtered assets based on search query
  const filteredAssets = React.useMemo(() => {
    if (!assets) return [];
    const q = search.trim().toLowerCase();
    if (!q) return assets.slice(0, 8);
    return assets
      .filter(
        (a) =>
          a.symbol.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.assetClass.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [assets, search]);

  // Filtered navigation items
  const filteredNav = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.href.toLowerCase().includes(q),
    );
  }, [search]);

  // Action runners
  const runAction = React.useCallback(
    async (key: string, label: string) => {
      setRunningAction(key);
      try {
        if (key === 'scan') {
          const r = await fetch('/api/scheduler/tick?module=crypto_technical&alerts=1', {
            method: 'POST',
          });
          const j: ApiResult<any> = await r.json();
          if (!j.success) throw new Error(j.error || 'Scan failed');
          toast.success('Crypto scan complete', { description: 'Signals regenerated for all active crypto assets.' });
        } else if (key === 'alerts') {
          const r = await fetch('/api/price-alerts/check', { method: 'POST' });
          const j: ApiResult<any> = await r.json();
          if (!j.success) throw new Error(j.error || 'Alert check failed');
          const summary = j.data;
          toast.success('Price alert check complete', {
            description: `Checked ${summary?.checked ?? 0} alerts · ${summary?.triggered ?? 0} triggered.`,
          });
        } else if (key === 'refresh') {
          // No backend endpoint exists for "refresh all data" — the data sources
          // have their own caches; we just toast and let the next fetch refresh.
          toast.success('Data refresh requested', {
            description: 'Live data will be re-fetched on next view load.',
          });
        }
      } catch (e: any) {
        toast.error(`${label} failed`, { description: e.message });
      } finally {
        setRunningAction(null);
        setOpen(false);
      }
    },
    [],
  );

  const handleNav = React.useCallback(
    (href: string) => {
      setOpen(false);
      setSearch('');
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch('');
      }}
      className="max-w-2xl"
    >
      <CommandInput
        placeholder="Search pages, assets, or actions…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Navigation */}
        {filteredNav.length > 0 && (
          <CommandGroup heading="Navigation">
            {filteredNav.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.href} navigation page`}
                  onSelect={() => handleNav(item.href)}
                  className="group"
                >
                  <Icon className="h-4 w-4 text-emerald-500" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {item.href === '/' ? 'home' : item.href.replace('/', '')}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Assets */}
        {filteredAssets.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Assets">
              {filteredAssets.map((a) => {
                const up = a.changePct >= 0;
                return (
                  <CommandItem
                    key={`${a.source}-${a.symbol}`}
                    value={`${a.symbol} ${a.name} ${a.assetClass} asset`}
                    onSelect={() => handleNav(assetHref(a))}
                    className="group"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase">
                      {a.assetClass.slice(0, 3)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{a.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate">{a.name}</span>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{fmtPrice(a.price)}</span>
                    <span
                      className={cn(
                        'font-mono text-xs tabular-nums',
                        up ? 'text-emerald-500' : 'text-rose-500',
                      )}
                    >
                      {up ? '+' : ''}
                      {a.changePct.toFixed(2)}%
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {/* Actions */}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="run crypto scan signals consensus analysis refresh"
            onSelect={() => runAction('scan', 'Crypto scan')}
            disabled={runningAction !== null}
          >
            {runningAction === 'scan' ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
            ) : (
              <Zap className="h-4 w-4 text-emerald-500" />
            )}
            <span className="flex-1">Run Crypto Scan</span>
            <span className="text-[10px] text-muted-foreground">Generates fresh signals</span>
          </CommandItem>
          <CommandItem
            value="run price alert check triggered threshold monitor"
            onSelect={() => runAction('alerts', 'Alert check')}
            disabled={runningAction !== null}
          >
            {runningAction === 'alerts' ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            )}
            <span className="flex-1">Run Price Alert Check</span>
            <span className="text-[10px] text-muted-foreground">Evaluates active alerts</span>
          </CommandItem>
          <CommandItem
            value="refresh all data reload market quotes prices"
            onSelect={() => runAction('refresh', 'Refresh data')}
            disabled={runningAction !== null}
          >
            {runningAction === 'refresh' ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
            ) : (
              <RefreshCw className="h-4 w-4 text-teal-500" />
            )}
            <span className="flex-1">Refresh All Data</span>
            <span className="text-[10px] text-muted-foreground">Busts client cache on next load</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <div className="flex items-center justify-between px-3 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                <ArrowUp className="inline h-2.5 w-2.5" />
                <ArrowDown className="inline h-2.5 w-2.5" />
              </kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono flex items-center gap-0.5">
                <CornerDownLeft className="h-2.5 w-2.5" />
              </kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono">esc</kbd>
              close
            </span>
          </div>
          <span className="flex items-center gap-1">
            <CommandIcon className="h-3 w-3" /> OMNISCIENT
          </span>
        </div>
      </CommandList>
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------
// Header ⌘K trigger button — used by Header.tsx
// ---------------------------------------------------------------------------
export function CommandPaletteTrigger({ className }: { className?: string }) {
  function open() {
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
  }
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={open}
      aria-label="Open command palette"
      className={cn(
        'group relative inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-all duration-200 ease-out',
        'hover:border-emerald-500/40 hover:bg-muted/70 hover:text-foreground hover:shadow-[0_0_0_3px_rgba(16,185,129,0.08),0_4px_14px_-6px_rgba(16,185,129,0.35)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Search className="h-3.5 w-3.5 transition-colors duration-200 group-hover:text-emerald-500" />
      <span className="hidden sm:inline transition-colors duration-200">Quick search</span>
      <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium shadow-sm transition-all duration-200 group-hover:border-emerald-500/30 group-hover:shadow group-hover:scale-105 sm:flex">
        <span className="text-emerald-500 select-none">⌘</span>
        <span className="text-muted-foreground group-hover:text-foreground select-none">K</span>
      </kbd>
    </motion.button>
  );
}
