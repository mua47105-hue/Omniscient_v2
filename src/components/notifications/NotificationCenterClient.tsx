'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import Link from 'next/link';
import {
  Bell,
  BellRing,
  Zap,
  Send,
  Activity,
  AlertTriangle,
  CheckCheck,
  X,
  Search,
  ChevronRight,
  Loader2,
  Inbox,
  ArrowRight,
  RotateCcw,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldAlert,
  Cpu,
  Clock,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type {
  ApiResult,
  Direction,
  NotificationItem,
  NotificationsResponse,
  NotificationSeverity,
  NotificationType,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const READ_KEY = 'omniscient.notifications.read';
const PAGE_SIZE = 50;

type RangeKey = 'today' | '7d' | '30d' | 'all';

const RANGE_PILLS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'all', label: 'All Time' },
];

interface TypePill {
  key: NotificationType | 'all';
  label: string;
  icon: typeof Bell;
  accent: string; // active background tint
  ring: string;
  text: string;
  dot: string;
}

const TYPE_PILLS: TypePill[] = [
  {
    key: 'all',
    label: 'All',
    icon: Bell,
    accent: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
    ring: 'ring-emerald-500/40',
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  {
    key: 'price',
    label: 'Price Alerts',
    icon: BellRing,
    accent: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
    ring: 'ring-emerald-500/40',
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  {
    key: 'signal',
    label: 'Signals',
    icon: Zap,
    accent: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/40',
    ring: 'ring-teal-500/40',
    text: 'text-teal-600 dark:text-teal-400',
    dot: 'bg-teal-500',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    icon: Send,
    accent: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40',
    ring: 'ring-amber-500/40',
    text: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  {
    key: 'system',
    label: 'System',
    icon: Activity,
    accent: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/40',
    ring: 'ring-zinc-500/40',
    text: 'text-zinc-600 dark:text-zinc-300',
    dot: 'bg-zinc-500',
  },
];

interface SevPill {
  key: NotificationSeverity | 'all';
  label: string;
  accent: string;
}

const SEV_PILLS: SevPill[] = [
  {
    key: 'all',
    label: 'All',
    accent: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  },
  {
    key: 'critical',
    label: 'Critical',
    accent: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40',
  },
  {
    key: 'warning',
    label: 'Warning',
    accent: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40',
  },
  {
    key: 'info',
    label: 'Info',
    accent: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  },
];

// Visual config per type — left accent border, dot color, icon, badge style.
interface TypeVisual {
  accent: string; // left border color (border-l-{color}-500)
  dot: string; // timeline dot bg
  dotGlow: string;
  icon: typeof Bell;
  iconBg: string;
  iconText: string;
  badge: string; // badge pill style
  badgeText: string;
  halo: string; // subtle gradient halo for card
}

const TYPE_VISUAL: Record<NotificationType, TypeVisual> = {
  price: {
    accent: 'border-l-emerald-500',
    dot: 'bg-emerald-500',
    dotGlow: 'shadow-[0_0_10px_rgba(16,185,129,0.8)]',
    icon: BellRing,
    iconBg: 'bg-emerald-500/15 ring-emerald-500/30',
    iconText: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
    badgeText: 'Price Alert',
    halo: 'from-emerald-500/[0.06] via-transparent to-transparent',
  },
  signal: {
    accent: 'border-l-teal-500',
    dot: 'bg-teal-500',
    dotGlow: 'shadow-[0_0_10px_rgba(20,184,166,0.8)]',
    icon: Zap,
    iconBg: 'bg-teal-500/15 ring-teal-500/30',
    iconText: 'text-teal-600 dark:text-teal-400',
    badge: 'bg-teal-500/10 border-teal-500/30 text-teal-600 dark:text-teal-400',
    badgeText: 'Signal',
    halo: 'from-teal-500/[0.06] via-transparent to-transparent',
  },
  telegram: {
    accent: 'border-l-amber-500',
    dot: 'bg-amber-500',
    dotGlow: 'shadow-[0_0_10px_rgba(245,158,11,0.8)]',
    icon: Send,
    iconBg: 'bg-amber-500/15 ring-amber-500/30',
    iconText: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
    badgeText: 'Telegram',
    halo: 'from-amber-500/[0.06] via-transparent to-transparent',
  },
  system: {
    accent: 'border-l-zinc-400',
    dot: 'bg-zinc-400',
    dotGlow: 'shadow-[0_0_10px_rgba(161,161,170,0.6)]',
    icon: Activity,
    iconBg: 'bg-zinc-500/15 ring-zinc-500/30',
    iconText: 'text-zinc-600 dark:text-zinc-300',
    badge: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600 dark:text-zinc-300',
    badgeText: 'System',
    halo: 'from-zinc-500/[0.06] via-transparent to-transparent',
  },
};

interface SevVisual {
  badge: string;
  text: string;
  icon?: typeof AlertTriangle;
  glow?: string;
}

const SEV_VISUAL: Record<NotificationSeverity, SevVisual> = {
  critical: {
    badge: 'bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400',
    text: 'text-rose-600 dark:text-rose-400',
    icon: AlertTriangle,
    glow: 'shadow-[0_0_8px_rgba(244,63,94,0.5)]',
  },
  warning: {
    badge: 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400',
    text: 'text-amber-600 dark:text-amber-400',
    icon: AlertTriangle,
  },
  info: {
    badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
};

function dirVisual(dir?: Direction) {
  if (dir === 'long') {
    return {
      label: 'LONG',
      icon: TrendingUp,
      text: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/30',
    };
  }
  if (dir === 'short') {
    return {
      label: 'SHORT',
      icon: TrendingDown,
      text: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-500/10 border-rose-500/30',
    };
  }
  return {
    label: 'NEUTRAL',
    icon: Minus,
    text: 'text-zinc-500 dark:text-zinc-400',
    bg: 'bg-zinc-500/10 border-zinc-500/30',
  };
}

function fmtPrice(n: number | null | undefined, digits = 4): string {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(digits);
}

// Read-state persistence helpers.
function loadReadIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr as string[]);
    return new Set();
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READ_KEY, JSON.stringify(Array.from(ids).slice(-5000)));
  } catch {
    /* quota — ignore */
  }
}

// Deterministic pseudo-random sparkline path for stat-card trends.
function sparkPath(seed: number, w = 64, h = 22, points = 7): string {
  const rand = (i: number) => {
    const x = Math.sin(seed * 99.7 + i * 13.13) * 10000;
    return x - Math.floor(x);
  };
  const vals: number[] = [];
  for (let i = 0; i < points; i++) vals.push(0.25 + rand(i) * 0.7);
  const stepX = w / (points - 1);
  return vals
    .map((v, i) => {
      const x = i * stepX;
      const y = h - v * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchNotifications(params: {
  type: NotificationType | 'all';
  severity: NotificationSeverity | 'all';
  asset: string;
  range: RangeKey;
  limit: number;
  offset: number;
}): Promise<NotificationsResponse> {
  const qs = new URLSearchParams({
    type: params.type,
    severity: params.severity,
    range: params.range,
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.asset) qs.set('asset', params.asset);
  const r = await fetch(`/api/notifications?${qs.toString()}`, { cache: 'no-store' });
  const j: ApiResult<NotificationsResponse> = await r.json();
  if (!j.success || !j.data) throw new Error(j.error || 'Failed to load notifications');
  return j.data;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NotificationCenterClient() {
  // ---- Filters ----
  const [typeFilter, setTypeFilter] = useState<NotificationType | 'all'>('all');
  const [sevFilter, setSevFilter] = useState<NotificationSeverity | 'all'>('all');
  const [assetInput, setAssetInput] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [range, setRange] = useState<RangeKey>('7d');

  // ---- Detail sheet ----
  const [selected, setSelected] = useState<NotificationItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // ---- Read state ----
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds());
  // Keep track of every ID we've ever seen (for the unread = total - read calc).
  const allKnownIdsRef = useRef<Set<string>>(new Set());

  // Sync readIds between tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === READ_KEY) setReadIds(loadReadIds());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Debounced asset search input → assetFilter
  useEffect(() => {
    const id = setTimeout(() => setAssetFilter(assetInput.trim()), 280);
    return () => clearTimeout(id);
  }, [assetInput]);

  // ---- Main feed (infinite query) ----
  const feedQuery = useInfiniteQuery<NotificationsResponse, Error>({
    queryKey: ['notifications', typeFilter, sevFilter, assetFilter, range],
    queryFn: ({ pageParam }) =>
      fetchNotifications({
        type: typeFilter,
        severity: sevFilter,
        asset: assetFilter,
        range,
        limit: PAGE_SIZE,
        offset: (pageParam as number) ?? 0,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((s, p) => s + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // ---- Stats queries (fixed windows, independent of type/sev/asset filters) ----
  const allTimeStats = useQuery<NotificationsResponse, Error>({
    queryKey: ['notifications-stats', 'all'],
    queryFn: () =>
      fetchNotifications({
        type: 'all',
        severity: 'all',
        asset: '',
        range: 'all',
        limit: 1,
        offset: 0,
      }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const weekPriceStats = useQuery<NotificationsResponse, Error>({
    queryKey: ['notifications-stats', 'price-7d'],
    queryFn: () =>
      fetchNotifications({
        type: 'price',
        severity: 'all',
        asset: '',
        range: '7d',
        limit: 1,
        offset: 0,
      }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const todaySignalStats = useQuery<NotificationsResponse, Error>({
    queryKey: ['notifications-stats', 'signal-today'],
    queryFn: () =>
      fetchNotifications({
        type: 'signal',
        severity: 'all',
        asset: '',
        range: 'today',
        limit: 1,
        offset: 0,
      }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // ---- Track known IDs ----
  useEffect(() => {
    if (!feedQuery.data) return;
    for (const page of feedQuery.data.pages) {
      for (const it of page.items) allKnownIdsRef.current.add(it.id);
    }
  }, [feedQuery.data]);

  // ---- Compute aggregated state ----
  const allItems = useMemo<NotificationItem[]>(() => {
    if (!feedQuery.data) return [];
    const seen = new Set<string>();
    const out: NotificationItem[] = [];
    for (const page of feedQuery.data.pages) {
      for (const it of page.items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  }, [feedQuery.data]);

  const feedTotal = feedQuery.data?.pages[0]?.total ?? 0;
  const feedCounts = feedQuery.data?.pages[0]?.counts ?? {
    type: { price: 0, signal: 0, telegram: 0, system: 0 },
    severity: { critical: 0, warning: 0, info: 0 },
  };

  // Stats-card numbers
  const totalAllTime = allTimeStats.data?.total ?? 0;
  const priceLast7d = weekPriceStats.data?.total ?? 0;
  const signalsToday = todaySignalStats.data?.total ?? 0;
  const criticalAllTime = allTimeStats.data?.counts.severity.critical ?? 0;
  const mostActiveAsset = allTimeStats.data?.mostActiveAsset ?? null;

  // Unread = total of currently visible feed - readIds intersected with current page items.
  // For the sidebar/global badge, we use the visible feed unread count (more
  // useful than an all-time number — unread notifications older than 7d are
  // usually irrelevant).
  const visibleUnread = useMemo(() => {
    let n = 0;
    for (const it of allItems) if (!readIds.has(it.id)) n++;
    return n;
  }, [allItems, readIds]);

  // ---- Broadcast unread count to Sidebar (window event) ----
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('notifications-unread', { detail: visibleUnread }),
    );
  }, [visibleUnread]);

  // ---- Handlers ----
  const markItemRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveReadIds(next);
      return next;
    });
  }, []);

  const openDetail = useCallback(
    (item: NotificationItem) => {
      setSelected(item);
      setSheetOpen(true);
      markItemRead(item.id);
    },
    [markItemRead],
  );

  const markAllRead = useCallback(() => {
    if (allItems.length === 0) {
      toast.info('No notifications to mark as read.');
      return;
    }
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const it of allItems) next.add(it.id);
      saveReadIds(next);
      return next;
    });
    toast.success(`Marked ${allItems.length} notification${allItems.length === 1 ? '' : 's'} as read.`);
  }, [allItems]);

  const dismissSelected = useCallback(() => {
    if (!selected) return;
    markItemRead(selected.id);
    setSheetOpen(false);
    setSelected(null);
    toast.success('Notification dismissed.');
  }, [selected, markItemRead]);

  const snoozeSelected = useCallback(async () => {
    if (!selected) return;
    if (selected.type === 'price' && selected.id.startsWith('price:')) {
      const alertId = selected.id.slice('price:'.length);
      try {
        const r = await fetch(`/api/price-alerts?id=${alertId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || 'Failed to re-arm alert');
        toast.success(`Re-armed price alert for ${selected.assetSymbol ?? 'asset'}.`);
        setSheetOpen(false);
        setSelected(null);
        feedQuery.refetch();
      } catch (e: any) {
        toast.error(e.message || 'Failed to re-arm alert');
      }
    } else {
      toast.info('Snooze is only available for triggered price alerts.');
    }
  }, [selected, feedQuery]);

  const clearFilters = useCallback(() => {
    setTypeFilter('all');
    setSevFilter('all');
    setAssetInput('');
    setAssetFilter('');
    setRange('7d');
  }, []);

  const hasActiveFilters =
    typeFilter !== 'all' || sevFilter !== 'all' || assetFilter !== '' || range !== '7d';

  const isInitialLoading = feedQuery.isLoading;
  const isFetchingNextPage = feedQuery.isFetchingNextPage;
  const hasNextPage = feedQuery.hasNextPage;

  // ---- Render ----
  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-400/30">
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-xl bg-emerald-400/40 blur-md opacity-60"
                />
                <Bell className="relative h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
                  Notification Center
                </h1>
                <p className="text-xs text-muted-foreground">
                  Unified activity feed — price alerts, signals, and Telegram deliveries in one timeline.
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {visibleUnread > 0 && (
              <div className="relative">
                <span className="absolute -right-1 -top-1 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
                </span>
                <Badge className="bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 gap-1 px-2.5 py-1">
                  <span className="font-mono tabular-nums font-bold">{visibleUnread}</span>
                  <span className="text-[10px] uppercase tracking-wider opacity-80">unread</span>
                </Badge>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => feedQuery.refetch()}
              disabled={feedQuery.isFetching}
              className="gap-2"
            >
              <RotateCcw className={cn('h-3.5 w-3.5', feedQuery.isFetching && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={markAllRead}
              className="group gap-2 hover:bg-emerald-500/10 hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
              Mark all read
            </Button>
          </div>
        </header>

        {/* Stats summary */}
        <StatsGrid
          totalAllTime={totalAllTime}
          visibleUnread={visibleUnread}
          priceLast7d={priceLast7d}
          signalsToday={signalsToday}
          criticalAllTime={criticalAllTime}
          mostActiveAsset={mostActiveAsset}
          isLoading={allTimeStats.isLoading}
        />

        {/* Filter bar */}
        <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
          <CardContent className="p-4 space-y-3">
            {/* Type pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mr-1">
                Type
              </span>
              {TYPE_PILLS.map((pill) => {
                const Icon = pill.icon;
                const active = typeFilter === pill.key;
                const count =
                  pill.key === 'all'
                    ? feedCounts.type.price + feedCounts.type.signal + feedCounts.type.telegram + feedCounts.type.system
                    : feedCounts.type[pill.key];
                return (
                  <button
                    key={pill.key}
                    type="button"
                    onClick={() => setTypeFilter(pill.key)}
                    className={cn(
                      'group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200',
                      'hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2',
                      pill.ring,
                      active
                        ? cn(pill.accent, 'shadow-sm')
                        : 'border-border/60 bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{pill.label}</span>
                    <span
                      className={cn(
                        'ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-mono tabular-nums',
                        active ? 'bg-foreground/15' : 'bg-muted/80 text-muted-foreground',
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Severity pills + asset search + range pills */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mr-1">
                  Severity
                </span>
                {SEV_PILLS.map((pill) => {
                  const active = sevFilter === pill.key;
                  return (
                    <button
                      key={pill.key}
                      type="button"
                      onClick={() => setSevFilter(pill.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200',
                        'hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 ring-offset-1 ring-offset-background',
                        active
                          ? cn(pill.accent, 'shadow-sm')
                          : 'border-border/60 bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                      )}
                    >
                      {pill.key === 'critical' && <AlertTriangle className="h-3 w-3" />}
                      {pill.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mr-1">
                  Range
                </span>
                {RANGE_PILLS.map((pill) => {
                  const active = range === pill.key;
                  return (
                    <button
                      key={pill.key}
                      type="button"
                      onClick={() => setRange(pill.key)}
                      className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200',
                        'hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2',
                        active
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shadow-sm'
                          : 'border-border/60 bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                      )}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>

              <div className="relative ml-auto w-full sm:w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={assetInput}
                  onChange={(e) => setAssetInput(e.target.value)}
                  placeholder="Filter by asset symbol…"
                  className="h-8 pl-8 pr-7 text-xs font-mono uppercase"
                />
                {assetInput && (
                  <button
                    type="button"
                    aria-label="Clear asset filter"
                    onClick={() => setAssetInput('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Main feed */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          {/* Timeline */}
          <div className="min-w-0">
            {isInitialLoading ? (
              <SkeletonTimeline />
            ) : allItems.length === 0 ? (
              <EmptyState onClear={clearFilters} hasFilters={hasActiveFilters} />
            ) : (
              <Timeline
                items={allItems}
                readIds={readIds}
                onSelect={openDetail}
              />
            )}

            {/* Load more */}
            {hasNextPage && !isInitialLoading && allItems.length > 0 && (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => feedQuery.fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="gap-2 hover:bg-emerald-500/10 hover:border-emerald-500/40"
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Load more
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({allItems.length}/{feedTotal})
                  </span>
                </Button>
              </div>
            )}
          </div>

          {/* Sidebar info panel */}
          <aside className="hidden lg:block">
            <div className="sticky top-4 space-y-3">
              <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-500" />
                    <h3 className="text-sm font-semibold">Feed summary</h3>
                  </div>
                  <div className="space-y-2 text-xs">
                    <SummaryRow label="Showing" value={`${allItems.length} of ${feedTotal}`} />
                    <SummaryRow label="Range" value={RANGE_PILLS.find((r) => r.key === range)?.label ?? '—'} />
                    <SummaryRow
                      label="Type filter"
                      value={TYPE_PILLS.find((t) => t.key === typeFilter)?.label ?? 'All'}
                    />
                    <SummaryRow
                      label="Severity"
                      value={SEV_PILLS.find((s) => s.key === sevFilter)?.label ?? 'All'}
                    />
                    {assetFilter && <SummaryRow label="Asset" value={assetFilter.toUpperCase()} />}
                  </div>
                  <div className="h-px bg-border/60" />
                  <div className="space-y-1.5">
                    {(['price', 'signal', 'telegram'] as NotificationType[]).map((t) => {
                      const visual = TYPE_VISUAL[t];
                      const Icon = visual.icon;
                      return (
                        <div key={t} className="flex items-center gap-2 text-xs">
                          <span className={cn('flex h-5 w-5 items-center justify-center rounded ring-1', visual.iconBg, visual.iconText)}>
                            <Icon className="h-3 w-3" />
                          </span>
                          <span className="text-muted-foreground">{visual.badgeText}</span>
                          <span className="ml-auto font-mono tabular-nums text-foreground">
                            {feedCounts.type[t]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] via-transparent to-transparent">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <BellRing className="h-4 w-4 text-emerald-500" />
                    <h3 className="text-sm font-semibold">Stay notified</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Set up price alerts or connect Telegram to receive real-time notifications when the system fires.
                  </p>
                  <div className="flex flex-col gap-1.5 pt-1">
                    <Link
                      href="/price-alerts"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      <Target className="h-3 w-3" />
                      Create price alert
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                    <Link
                      href="/settings/alerts"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      <Send className="h-3 w-3" />
                      Configure Telegram
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      </div>

      {/* Detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 border-l-border/60 bg-background/95 backdrop-blur-xl"
        >
          {selected && (
            <NotificationDetail
              item={selected}
              onClose={() => setSheetOpen(false)}
              onDismiss={dismissSelected}
              onSnooze={snoozeSelected}
            />
          )}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function StatsGrid({
  totalAllTime,
  visibleUnread,
  priceLast7d,
  signalsToday,
  criticalAllTime,
  mostActiveAsset,
  isLoading,
}: {
  totalAllTime: number;
  visibleUnread: number;
  priceLast7d: number;
  signalsToday: number;
  criticalAllTime: number;
  mostActiveAsset: { symbol: string; count: number } | null;
  isLoading: boolean;
}) {
  const stats: Array<{
    label: string;
    value: string;
    sub?: string;
    icon: typeof Bell;
    accent: string;
    tint: string;
    sparkSeed: number;
    pulse?: boolean;
  }> = [
    {
      label: 'Total Notifications',
      value: totalAllTime.toLocaleString(),
      sub: 'all time',
      icon: Bell,
      accent: 'text-emerald-500',
      tint: 'from-emerald-500/[0.08] via-transparent to-transparent',
      sparkSeed: 11,
    },
    {
      label: 'Unread',
      value: visibleUnread.toLocaleString(),
      sub: visibleUnread > 0 ? 'new activity' : 'all caught up',
      icon: BellRing,
      accent: 'text-emerald-500',
      tint: 'from-emerald-500/[0.10] via-transparent to-transparent',
      sparkSeed: 23,
      pulse: visibleUnread > 0,
    },
    {
      label: 'Price Alerts Triggered',
      value: priceLast7d.toLocaleString(),
      sub: 'last 7 days',
      icon: Target,
      accent: 'text-teal-500',
      tint: 'from-teal-500/[0.08] via-transparent to-transparent',
      sparkSeed: 37,
    },
    {
      label: 'New Signals',
      value: signalsToday.toLocaleString(),
      sub: 'last 24 hours',
      icon: Zap,
      accent: 'text-teal-500',
      tint: 'from-teal-500/[0.10] via-transparent to-transparent',
      sparkSeed: 51,
    },
    {
      label: 'Critical Alerts',
      value: criticalAllTime.toLocaleString(),
      sub: 'high severity',
      icon: AlertTriangle,
      accent: 'text-rose-500',
      tint: 'from-rose-500/[0.10] via-transparent to-transparent',
      sparkSeed: 67,
    },
    {
      label: 'Most Active Asset',
      value: mostActiveAsset?.symbol ?? '—',
      sub: mostActiveAsset ? `${mostActiveAsset.count} events` : 'no data yet',
      icon: Activity,
      accent: 'text-amber-500',
      tint: 'from-amber-500/[0.08] via-transparent to-transparent',
      sparkSeed: 83,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {stats.map((s, i) => {
        const Icon = s.icon;
        return (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.04 }}
          >
            <Card
              className={cn(
                'relative overflow-hidden border-border/60 bg-card/50 backdrop-blur-sm',
                'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-border',
              )}
            >
              <div aria-hidden className={cn('absolute inset-0 bg-gradient-to-br pointer-events-none', s.tint)} />
              <CardContent className="relative p-3.5">
                <div className="flex items-start justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                    {s.label}
                  </span>
                  <Icon className={cn('h-3.5 w-3.5', s.accent)} />
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    {isLoading ? (
                      <Skeleton className="h-7 w-16" />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono tabular-nums text-xl font-bold tracking-tight text-foreground truncate">
                          {s.value}
                        </span>
                        {s.pulse && (
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          </span>
                        )}
                      </div>
                    )}
                    {s.sub && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground/80 truncate">{s.sub}</p>
                    )}
                  </div>
                  <svg width="64" height="22" viewBox="0 0 64 22" className="shrink-0 opacity-70">
                    <defs>
                      <linearGradient id={`spark-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d={`${sparkPath(s.sparkSeed)} L64,22 L0,22 Z`}
                      fill={`url(#spark-${i})`}
                      className={s.accent}
                    />
                    <path
                      d={sparkPath(s.sparkSeed)}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={s.accent}
                    />
                  </svg>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}

function Timeline({
  items,
  readIds,
  onSelect,
}: {
  items: NotificationItem[];
  readIds: Set<string>;
  onSelect: (item: NotificationItem) => void;
}) {
  return (
    <div className="relative pl-6 sm:pl-8">
      {/* Vertical gradient line */}
      <span
        aria-hidden
        className="absolute left-[10px] sm:left-[14px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-emerald-500/40 via-border to-transparent rounded-full"
      />
      <AnimatePresence mode="popLayout">
        {items.map((item, idx) => (
          <NotificationCard
            key={item.id}
            item={item}
            read={readIds.has(item.id)}
            index={idx}
            onSelect={onSelect}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function NotificationCard({
  item,
  read,
  index,
  onSelect,
}: {
  item: NotificationItem;
  read: boolean;
  index: number;
  onSelect: (item: NotificationItem) => void;
}) {
  const visual = TYPE_VISUAL[item.type];
  const sev = SEV_VISUAL[item.severity];
  const Icon = visual.icon;
  const SevIcon = sev.icon;
  const dir = dirVisual(item.metadata.direction);
  const DirIcon = dir.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.025, 0.5) }}
      className="relative"
    >
      {/* Timeline dot */}
      <span
        aria-hidden
        className={cn(
          'absolute -left-6 sm:-left-8 top-4 flex h-3.5 w-3.5 items-center justify-center',
        )}
      >
        {/* Ring */}
        <span
          className={cn(
            'absolute inset-0 rounded-full ring-2 ring-background',
            visual.dot,
            !read && visual.dotGlow,
          )}
        />
        {/* Pulsing aura for unread */}
        {!read && (
          <span
            aria-hidden
            className={cn('absolute inset-0 rounded-full animate-ping opacity-40', visual.dot)}
          />
        )}
      </span>

      <Card
        role="button"
        tabIndex={0}
        onClick={() => onSelect(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(item);
          }
        }}
        className={cn(
          'group relative cursor-pointer overflow-hidden border border-l-4 border-border/50 bg-card/50 backdrop-blur-sm',
          'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-foreground/5 hover:border-border',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
          visual.accent,
          !read && 'bg-emerald-500/[0.04]',
          read && 'opacity-[0.78] hover:opacity-100',
        )}
      >
        {/* Halo */}
        <div
          aria-hidden
          className={cn('absolute inset-0 bg-gradient-to-r pointer-events-none opacity-70', visual.halo)}
        />
        <CardContent className="relative p-3.5 sm:p-4">
          <div className="flex items-start gap-3">
            {/* Type icon */}
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
                visual.iconBg,
                visual.iconText,
                'transition-transform group-hover:scale-105',
              )}
            >
              <Icon className="h-4 w-4" />
            </div>

            <div className="min-w-0 flex-1">
              {/* Title row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {!read && (
                      <span
                        aria-hidden
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)] animate-pulse"
                      />
                    )}
                    <h3
                      className={cn(
                        'text-sm leading-snug truncate',
                        !read ? 'font-bold text-foreground' : 'font-medium text-foreground/90',
                      )}
                    >
                      {item.title}
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.message}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground transition-colors mt-0.5" />
              </div>

              {/* Meta row */}
              <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                {/* Type badge */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={cn('h-5 px-1.5 text-[10px] font-medium gap-1 cursor-help', visual.badge)}
                    >
                      <Icon className="h-2.5 w-2.5" />
                      {visual.badgeText}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {typeTooltip(item.type)}
                  </TooltipContent>
                </Tooltip>

                {/* Severity badge */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-5 px-1.5 text-[10px] font-medium gap-1 cursor-help capitalize',
                        sev.badge,
                        sev.glow,
                      )}
                    >
                      {SevIcon && <SevIcon className="h-2.5 w-2.5" />}
                      {item.severity}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {severityTooltip(item.severity)}
                  </TooltipContent>
                </Tooltip>

                {/* Asset badge */}
                {item.assetSymbol && (
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 text-[10px] font-mono font-semibold border-border/60 text-foreground/80"
                  >
                    {item.assetSymbol}
                  </Badge>
                )}

                {/* Direction badge (for signals/telegram) */}
                {(item.type === 'signal' || item.type === 'telegram') && item.metadata.direction && (
                  <Badge
                    variant="outline"
                    className={cn('h-5 px-1.5 text-[10px] font-bold gap-0.5', dir.bg, dir.text)}
                  >
                    <DirIcon className="h-2.5 w-2.5" />
                    {dir.label}
                  </Badge>
                )}

                {/* Conviction (for signals) */}
                {item.type === 'signal' && item.metadata.conviction != null && (
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 text-[10px] font-mono gap-0.5 border-border/60 text-muted-foreground"
                  >
                    <Zap className="h-2.5 w-2.5 text-amber-500" />
                    {item.metadata.conviction}%
                  </Badge>
                )}

                {/* Alert status (for telegram) */}
                {item.type === 'telegram' && item.metadata.alertStatus && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-5 px-1.5 text-[10px] font-medium gap-0.5 capitalize',
                      item.metadata.alertStatus === 'failed'
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {item.metadata.alertStatus}
                  </Badge>
                )}

                {/* Timestamp */}
                <span className="ml-auto text-[10px] font-mono tabular-nums text-muted-foreground/80">
                  <RelativeTime iso={item.timestamp} />
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SkeletonTimeline() {
  return (
    <div className="relative pl-6 sm:pl-8">
      <span
        aria-hidden
        className="absolute left-[10px] sm:left-[14px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-emerald-500/30 via-border to-transparent rounded-full"
      />
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="relative">
            <span
              aria-hidden
              className="absolute -left-6 sm:-left-8 top-4 h-3.5 w-3.5 rounded-full bg-muted ring-2 ring-background"
            />
            <Card className="border border-l-4 border-l-muted border-border/50 bg-card/40">
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <Skeleton className="ml-auto h-3 w-16" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  onClear,
  hasFilters,
}: {
  onClear: () => void;
  hasFilters: boolean;
}) {
  return (
    <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
      <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="relative mb-4">
          <div
            aria-hidden
            className="absolute inset-0 rounded-full bg-emerald-500/20 blur-2xl scale-150"
          />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/10 ring-1 ring-emerald-500/30">
            <Inbox className="h-8 w-8 text-emerald-500" />
          </div>
        </div>
        <h3 className="text-lg font-semibold">No notifications yet</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {hasFilters
            ? 'No notifications match your current filters. Try widening the range or clearing filters.'
            : 'Triggered price alerts, new consensus signals, and Telegram deliveries will appear here in real time. Set up alerts to get started.'}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {hasFilters ? (
            <Button variant="outline" size="sm" onClick={onClear} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          ) : (
            <>
              <Link href="/price-alerts">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 hover:bg-emerald-500/10 hover:border-emerald-500/40"
                >
                  <Target className="h-3.5 w-3.5" />
                  Set up price alert
                </Button>
              </Link>
              <Link href="/settings/alerts">
                <Button variant="outline" size="sm" className="gap-1.5 hover:bg-amber-500/10 hover:border-amber-500/40">
                  <Send className="h-3.5 w-3.5" />
                  Configure Telegram
                </Button>
              </Link>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationDetail({
  item,
  onClose,
  onDismiss,
  onSnooze,
}: {
  item: NotificationItem;
  onClose: () => void;
  onDismiss: () => void;
  onSnooze: () => void;
}) {
  const visual = TYPE_VISUAL[item.type];
  const sev = SEV_VISUAL[item.severity];
  const Icon = visual.icon;
  const SevIcon = sev.icon;
  const dir = dirVisual(item.metadata.direction);
  const DirIcon = dir.icon;
  const assetLink = item.assetSymbol
    ? item.assetSymbol.endsWith('USDT')
      ? `/crypto/${item.assetSymbol}`
      : `/markets/${item.assetSymbol}`
    : null;

  const meta: Array<{ label: string; value: string; mono?: boolean }> = [];
  if (item.type === 'price') {
    if (item.metadata.condition) meta.push({ label: 'Condition', value: item.metadata.condition.replace('_', ' ') });
    if (item.metadata.targetPrice != null) meta.push({ label: 'Target Price', value: fmtPrice(item.metadata.targetPrice), mono: true });
    if (item.metadata.triggeredPrice != null) meta.push({ label: 'Triggered At', value: fmtPrice(item.metadata.triggeredPrice), mono: true });
    if (item.metadata.channel) meta.push({ label: 'Channel', value: item.metadata.channel });
    if (item.metadata.note) meta.push({ label: 'Note', value: item.metadata.note });
  } else if (item.type === 'signal') {
    if (item.metadata.direction) meta.push({ label: 'Direction', value: item.metadata.direction.toUpperCase() });
    if (item.metadata.conviction != null) meta.push({ label: 'Conviction', value: `${item.metadata.conviction}%`, mono: true });
    if (item.metadata.timeframe) meta.push({ label: 'Timeframe', value: item.metadata.timeframe });
    if (item.metadata.entryPrice != null) meta.push({ label: 'Entry Price', value: fmtPrice(item.metadata.entryPrice), mono: true });
    if (item.metadata.stopLoss != null) meta.push({ label: 'Stop Loss', value: fmtPrice(item.metadata.stopLoss), mono: true });
    if (item.metadata.takeProfit != null) meta.push({ label: 'Take Profit', value: fmtPrice(item.metadata.takeProfit), mono: true });
    if (item.metadata.signalStatus) meta.push({ label: 'Status', value: item.metadata.signalStatus });
    const models = safeJsonArray(item.metadata.modelsUsed);
    if (models.length > 0) meta.push({ label: 'Models Used', value: models.join(', ') });
  } else if (item.type === 'telegram') {
    if (item.metadata.alertStatus) meta.push({ label: 'Delivery Status', value: item.metadata.alertStatus });
    if (item.metadata.direction) meta.push({ label: 'Signal Direction', value: item.metadata.direction.toUpperCase() });
    if (item.metadata.conviction != null) meta.push({ label: 'Conviction', value: `${item.metadata.conviction}%`, mono: true });
    if (item.metadata.timeframe) meta.push({ label: 'Timeframe', value: item.metadata.timeframe });
    if (item.metadata.entryPrice != null) meta.push({ label: 'Entry Price', value: fmtPrice(item.metadata.entryPrice), mono: true });
    if (item.metadata.stopLoss != null) meta.push({ label: 'Stop Loss', value: fmtPrice(item.metadata.stopLoss), mono: true });
    if (item.metadata.takeProfit != null) meta.push({ label: 'Take Profit', value: fmtPrice(item.metadata.takeProfit), mono: true });
    if (item.metadata.error) meta.push({ label: 'Error', value: item.metadata.error });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <SheetHeader className={cn('border-b border-border/60 p-5 space-y-3', visual.accent.replace('border-l-', 'border-l-4'))}>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1',
              visual.iconBg,
              visual.iconText,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-base leading-snug">{item.title}</SheetTitle>
            <SheetDescription className="sr-only">Notification detail</SheetDescription>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] font-medium gap-1', visual.badge)}>
                <Icon className="h-2.5 w-2.5" />
                {visual.badgeText}
              </Badge>
              <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] font-medium gap-1 capitalize', sev.badge, sev.glow)}>
                {SevIcon && <SevIcon className="h-2.5 w-2.5" />}
                {item.severity}
              </Badge>
              {item.assetSymbol && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono font-semibold border-border/60">
                  {item.assetSymbol}
                </Badge>
              )}
              {(item.type === 'signal' || item.type === 'telegram') && item.metadata.direction && (
                <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] font-bold gap-0.5', dir.bg, dir.text)}>
                  <DirIcon className="h-2.5 w-2.5" />
                  {dir.label}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span className="font-mono tabular-nums">{format(new Date(item.timestamp), "MMM d, yyyy 'at' HH:mm:ss")}</span>
          <span className="text-muted-foreground/60">·</span>
          <RelativeTime iso={item.timestamp} />
        </div>
      </SheetHeader>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
        {/* Message */}
        <section>
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">
            Message
          </h4>
          <p className="text-sm leading-relaxed text-foreground/90">{item.message}</p>
        </section>

        {/* Rationale (for signal/telegram) */}
        {item.metadata.rationale && (
          <section>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2 flex items-center gap-1.5">
              <Cpu className="h-3 w-3" />
              Rationale
            </h4>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-foreground/80 max-h-48 overflow-y-auto scrollbar-thin">
              {item.metadata.rationale}
            </div>
          </section>
        )}

        {/* Metadata grid */}
        {meta.length > 0 && (
          <section>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">
              Details
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {meta.map((m) => (
                <div
                  key={m.label}
                  className={cn(
                    'rounded-md border border-border/60 bg-card/40 p-2.5',
                    m.label === 'Note' || m.label === 'Error' || m.label === 'Models Used' ? 'col-span-2' : '',
                  )}
                >
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {m.label}
                  </div>
                  <div
                    className={cn(
                      'mt-0.5 text-xs text-foreground',
                      m.mono ? 'font-mono tabular-nums' : '',
                      m.label === 'Error' ? 'text-rose-600 dark:text-rose-400' : '',
                    )}
                  >
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Layer summary (for signals) */}
        {item.metadata.layersSummary && (
          <LayersSummary raw={item.metadata.layersSummary} />
        )}
      </div>

      {/* Footer with action buttons */}
      <SheetFooter className="border-t border-border/60 p-4 flex-row gap-2 sm:justify-stretch">
        {assetLink && (
          <Link href={assetLink} className="flex-1" onClick={onClose}>
            <Button variant="outline" className="w-full gap-1.5 hover:bg-emerald-500/10 hover:border-emerald-500/40">
              <ExternalLink className="h-3.5 w-3.5" />
              View Asset
            </Button>
          </Link>
        )}
        {item.type === 'price' && (
          <Button
            variant="outline"
            onClick={onSnooze}
            className="flex-1 gap-1.5 hover:bg-teal-500/10 hover:border-teal-500/40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Snooze (re-arm)
          </Button>
        )}
        <Button
          variant="outline"
          onClick={onDismiss}
          className="flex-1 gap-1.5 hover:bg-rose-500/10 hover:border-rose-500/40"
        >
          <X className="h-3.5 w-3.5" />
          Dismiss
        </Button>
      </SheetFooter>
    </div>
  );
}

function LayersSummary({ raw }: { raw: string }) {
  let layers: Array<{ layer: string; score: number; confidence: number; detail: string }> = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) layers = parsed;
    else if (parsed && typeof parsed === 'object') {
      // Could be a record of layer→score
      layers = Object.entries(parsed).map(([layer, v]: any) => ({
        layer,
        score: typeof v === 'number' ? v : (v?.score ?? 0),
        confidence: v?.confidence ?? 0,
        detail: v?.detail ?? '',
      }));
    }
  } catch {
    /* ignore */
  }
  if (layers.length === 0) return null;
  return (
    <section>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2 flex items-center gap-1.5">
        <Activity className="h-3 w-3" />
        Analysis Layers
      </h4>
      <div className="space-y-1.5">
        {layers.map((l) => {
          const isBull = l.score > 20;
          const isBear = l.score < -20;
          return (
            <div
              key={l.layer}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 p-2"
            >
              <span
                className={cn(
                  'inline-flex h-1.5 w-1.5 shrink-0 rounded-full',
                  isBull ? 'bg-emerald-500' : isBear ? 'bg-rose-500' : 'bg-zinc-400',
                )}
              />
              <span className="text-xs font-medium capitalize text-foreground/90 flex-1 min-w-0 truncate">
                {l.layer}
              </span>
              <span
                className={cn(
                  'font-mono tabular-nums text-xs font-bold',
                  isBull ? 'text-emerald-600 dark:text-emerald-400' : isBear ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                )}
              >
                {l.score > 0 ? '+' : ''}
                {l.score}
              </span>
              <span className="text-[10px] text-muted-foreground/70 font-mono tabular-nums w-10 text-right">
                {l.confidence}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RelativeTime({ iso }: { iso: string }) {
  // Re-render every 30s so relative timestamps stay fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const formatted = (() => {
    try {
      return formatDistanceToNow(new Date(iso), { addSuffix: true });
    } catch {
      return '—';
    }
  })();
  return <>{formatted}</>;
}

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------

function safeJsonArray(raw?: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function typeTooltip(t: NotificationType): string {
  switch (t) {
    case 'price':
      return 'A price alert you configured was triggered — the asset crossed your target threshold.';
    case 'signal':
      return 'The OMNISCIENT consensus engine produced a new trade signal with multi-layer analysis.';
    case 'telegram':
      return 'An alert was delivered (or attempted) to your Telegram channel.';
    case 'system':
      return 'A system-level event — scheduler, data source, or background job.';
  }
}

function severityTooltip(s: NotificationSeverity): string {
  switch (s) {
    case 'critical':
      return 'High-priority event — high-conviction signal, failed delivery, or other action-required situation.';
    case 'warning':
      return 'Worth attention — moderate conviction, threshold crossover, or partial failure.';
    case 'info':
      return 'Informational — routine event, no action required.';
  }
}
