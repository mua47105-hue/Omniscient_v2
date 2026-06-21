'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Radio,
  BellRing,
  CheckCheck,
  ArrowUp,
  ArrowDown,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationItem {
  id: string;
  type: 'price' | 'signal' | 'alert';
  title: string;
  body: string;
  timestamp: string;
  status: string;
  channel?: string;
  meta?: Record<string, unknown>;
}

interface Counts {
  price: number;
  signal: number;
  alert: number;
}

interface NotificationsResponse {
  success?: boolean;
  data?: NotificationItem[];
  counts?: Counts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.max(0, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function typeMeta(type: NotificationItem['type']): {
  label: string;
  icon: React.ReactNode;
  variant: 'warning' | 'violet' | 'info';
} {
  switch (type) {
    case 'price':
      return { label: 'Price Alert', icon: <BellRing className="h-3.5 w-3.5" />, variant: 'warning' };
    case 'signal':
      return { label: 'Signal', icon: <Radio className="h-3.5 w-3.5" />, variant: 'violet' };
    case 'alert':
      return { label: 'Alert', icon: <Bell className="h-3.5 w-3.5" />, variant: 'info' };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationCenterClient(): React.ReactElement {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<'all' | 'price' | 'signal' | 'alert'>('all');
  const [readIds, setReadIds] = React.useState<Set<string>>(new Set());

  const q = useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/notifications?limit=100');
      if (!res.ok) throw new Error('notifications fetch failed');
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const items = q.data?.data ?? [];
  const counts = q.data?.counts ?? { price: 0, signal: 0, alert: 0 };

  const filtered = React.useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.type === filter);
  }, [items, filter]);

  const unreadCount = items.filter((i) => !readIds.has(i.id)).length;

  const markAllRead = () => {
    setReadIds(new Set(items.map((i) => i.id)));
  };

  const markOneRead = (id: string) => {
    setReadIds((prev) => new Set(prev).add(id));
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            Notifications
            {unreadCount > 0 ? (
              <Badge variant="rose" className="text-[10px]">
                {unreadCount} new
              </Badge>
            ) : null}
          </h1>
          <p className="text-xs text-muted-foreground">
            Unified activity feed — alerts, signals, and price triggers in one place.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
          <CheckCheck className="h-4 w-4" />
          Mark all read
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="All"
          count={items.length}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterChip
          label="Price"
          count={counts.price}
          active={filter === 'price'}
          onClick={() => setFilter('price')}
          tone="warning"
        />
        <FilterChip
          label="Signals"
          count={counts.signal}
          active={filter === 'signal'}
          onClick={() => setFilter('signal')}
          tone="violet"
        />
        <FilterChip
          label="Alerts"
          count={counts.alert}
          active={filter === 'alert'}
          onClick={() => setFilter('alert')}
          tone="info"
        />
      </div>

      {/* Feed */}
      {q.isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Loading notifications…
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              No notifications of this type yet. Activity will appear here as the brain generates
              signals and price alerts fire.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((item) => {
            const meta = typeMeta(item.type);
            const isRead = readIds.has(item.id);
            return (
              <Card
                key={item.id}
                className={cn(
                  'ring-1 ring-inset ring-border/30 transition-colors',
                  !isRead && 'border-primary/30 bg-primary/[0.03]',
                )}
              >
                <CardContent
                  className="grid cursor-pointer gap-2 p-3 sm:grid-cols-[auto_1fr_auto]"
                  onClick={() => markOneRead(item.id)}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                        meta.variant === 'warning' && 'bg-amber-500/15 text-amber-300',
                        meta.variant === 'violet' && 'bg-violet-500/15 text-violet-300',
                        meta.variant === 'info' && 'bg-sky-500/15 text-sky-300',
                      )}
                    >
                      {meta.icon}
                    </div>
                    {!isRead ? (
                      <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    ) : (
                      <span className="mt-3 h-1.5 w-1.5 shrink-0" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={meta.variant} className="text-[10px]">
                        {meta.label}
                      </Badge>
                      <span className="text-sm font-semibold text-foreground">{item.title}</span>
                      {item.type === 'signal' && item.meta?.direction ? (
                        <DirectionBadge direction={String(item.meta.direction)} />
                      ) : null}
                    </div>
                    {item.body ? (
                      <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                        {item.body}
                      </p>
                    ) : null}
                    {item.channel ? (
                      <span className="text-[10px] text-muted-foreground">
                        via {item.channel}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[10px] text-muted-foreground">
                    <span>{fmtAgo(item.timestamp)}</span>
                    <Badge variant="muted" className="text-[9px] capitalize">
                      {item.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  count,
  active,
  onClick,
  tone = 'muted',
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: 'muted' | 'warning' | 'violet' | 'info';
}): React.ReactElement {
  const toneActive: Record<typeof tone, string> = {
    muted: 'bg-background text-foreground',
    warning: 'bg-amber-500/15 text-amber-300',
    violet: 'bg-violet-500/15 text-violet-300',
    info: 'bg-sky-500/15 text-sky-300',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1 text-[11px] font-medium transition-colors',
        active ? toneActive[tone] : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span className="rounded bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
        {count}
      </span>
    </button>
  );
}

function DirectionBadge({ direction }: { direction: string }): React.ReactElement {
  const d = direction.toLowerCase();
  const variant = d === 'long' ? 'success' : d === 'short' ? 'rose' : 'muted';
  const Icon = d === 'long' ? ArrowUp : d === 'short' ? ArrowDown : ArrowRight;
  return (
    <Badge variant={variant} className="text-[10px] capitalize">
      <Icon className="h-2.5 w-2.5" />
      {d}
    </Badge>
  );
}
