'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Flame,
  Gauge,
  MessageCircle,
  Bitcoin,
  Github,
  ArrowUp,
  ArrowDown,
  Minus,
  RefreshCw,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// API response shapes — match the parallel-built endpoints (all return
// { success: true, data: ... } envelopes; the underlying source shapes are
// defined in src/lib/market/*).
// ---------------------------------------------------------------------------

interface TrendingEnvelope {
  success?: boolean;
  data?: {
    trending?: Array<{
      id: string;
      symbol: string;
      name: string;
      marketCapRank: number | null;
      priceBtc?: number;
    }>;
    topMarkets?: Array<{
      id: string;
      symbol: string;
      name: string;
      currentPrice: number;
      marketCap: number;
      totalVolume: number;
      priceChangePercentage24h: number;
      marketCapRank: number;
    }>;
  };
}

interface FearGreedEnvelope {
  success?: boolean;
  data?: Array<{
    value: number;
    classification: string;
    timestamp: number;
  }>;
}

interface RedditEnvelope {
  success?: boolean;
  available?: boolean;
  data?: {
    available: boolean;
    aggregatedSentiment?: number; // -1..+1
    bullCount?: number;
    bearCount?: number;
    postCount?: number;
    perSub?: Array<{
      subreddit: string;
      available: boolean;
      sentiment: number;
      bullCount: number;
      bearCount: number;
      postCount: number;
    }>;
    asOf?: number;
  };
}

interface OnchainEnvelope {
  success?: boolean;
  data?: {
    stats?: {
      transactionCount24h?: number;
      hashrate?: number; // EH/s
      difficulty?: number;
      asOf?: number;
    };
    trend?: {
      direction?: 'rising' | 'falling' | 'flat';
      pctChange?: number;
      sampleCount?: number;
    };
    history?: number[];
  };
}

interface DevActivityEnvelope {
  success?: boolean;
  data?: {
    asOf?: number;
    fromCache?: boolean;
    entries?: Array<{
      asset: string;
      label: string;
      repo: string;
      stars: number;
      commits7d: number;
      commitsPrev7d: number;
      deltaPct: number;
      lastPush: string | null;
      ok: boolean;
      error?: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtAge(ts: number | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(0, Math.round(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  return `${Math.round(diff / 3_600_000)}h`;
}

function fmtNum(n: number | undefined | null, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B${suffix}`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M${suffix}`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k${suffix}`;
  return `${n.toFixed(0)}${suffix}`;
}

function fgColor(v: number | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v < 25) return 'text-rose-400';
  if (v < 45) return 'text-orange-400';
  if (v < 55) return 'text-amber-300';
  if (v < 75) return 'text-lime-300';
  return 'text-emerald-400';
}

function fgGradient(v: number | undefined): string {
  return `linear-gradient(90deg, oklch(0.65 0.22 25) 0%, oklch(0.72 0.18 75) 25%, oklch(0.78 0.18 160) ${
    v ?? 50
  }%, oklch(0.30 0.014 264) ${v ?? 50}%)`;
}

function sentimentDirection(score: number | undefined): 'bull' | 'bear' | 'neutral' {
  if (score == null || !Number.isFinite(score)) return 'neutral';
  if (score > 0.1) return 'bull';
  if (score < -0.1) return 'bear';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Column shell
// ---------------------------------------------------------------------------

function ColumnShell({
  icon,
  title,
  dataUpdatedAt,
  children,
  isLoading,
}: {
  icon: React.ReactNode;
  title: string;
  dataUpdatedAt?: number;
  children: React.ReactNode;
  isLoading?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          {icon}
          {title}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <RefreshCw className="h-2.5 w-2.5" />
          <span>{fmtAge(dataUpdatedAt)}</span>
        </div>
      </div>
      <div className="flex-1">
        {isLoading ? <Skeleton className="h-12 w-full" /> : children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export function FreeSignalsCard(): React.ReactElement {
  const trendingQ = useQuery<TrendingEnvelope>({
    queryKey: ['cg-trending'],
    queryFn: async () => {
      const res = await fetch('/api/crypto/trending');
      if (!res.ok) throw new Error('trending fetch failed');
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  const fgQ = useQuery<FearGreedEnvelope>({
    queryKey: ['fear-greed'],
    queryFn: async () => {
      const res = await fetch('/api/macro/fear-greed');
      if (!res.ok) throw new Error('fear-greed fetch failed');
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  const redditQ = useQuery<RedditEnvelope>({
    queryKey: ['reddit-sentiment'],
    queryFn: async () => {
      const res = await fetch('/api/sentiment/reddit');
      if (!res.ok) throw new Error('reddit fetch failed');
      return res.json();
    },
    refetchInterval: 180_000,
    staleTime: 120_000,
  });

  const onchainQ = useQuery<OnchainEnvelope>({
    queryKey: ['onchain-stats'],
    queryFn: async () => {
      const res = await fetch('/api/onchain/stats');
      if (!res.ok) throw new Error('onchain fetch failed');
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  const devQ = useQuery<DevActivityEnvelope>({
    queryKey: ['dev-activity'],
    queryFn: async () => {
      const res = await fetch('/api/devactivity');
      if (!res.ok) throw new Error('devactivity fetch failed');
      return res.json();
    },
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  const trending = trendingQ.data?.data?.trending?.slice(0, 7) ?? [];
  const fgEntries = fgQ.data?.data ?? [];
  const latestFg = fgEntries[0];
  const reddit = redditQ.data?.data;
  const redditAvailable = redditQ.data?.available !== false && reddit?.available !== false;
  const redditScore = reddit?.aggregatedSentiment;
  const redditDir = sentimentDirection(redditScore);
  const onchain = onchainQ.data?.data?.stats;
  const onchainTrend = onchainQ.data?.data?.trend;
  const devEntries = devQ.data?.data?.entries?.slice(0, 5) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-400" />
          Free Signal Sources
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-3 xl:grid-cols-5">
        {/* 1. CoinGecko Trending */}
        <ColumnShell
          icon={<Flame className="h-3.5 w-3.5 text-amber-400" />}
          title="CoinGecko Trending"
          dataUpdatedAt={trendingQ.dataUpdatedAt}
          isLoading={trendingQ.isLoading}
        >
          <div className="space-y-1.5">
            {trending.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No trending coins</p>
            ) : (
              trending.map((c, i) => (
                <div
                  key={c.id ?? `${c.symbol}-${i}`}
                  className="flex items-center justify-between text-[11px]"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-muted-foreground">{i + 1}</span>
                    <span className="font-medium text-foreground">{c.symbol}</span>
                    <span className="max-w-[60px] truncate text-muted-foreground/70">
                      {c.name}
                    </span>
                  </div>
                  {c.marketCapRank ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      #{c.marketCapRank}
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </ColumnShell>

        {/* 2. Fear & Greed */}
        <ColumnShell
          icon={<Gauge className="h-3.5 w-3.5 text-emerald-400" />}
          title="Fear & Greed"
          dataUpdatedAt={fgQ.dataUpdatedAt}
          isLoading={fgQ.isLoading}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${fgColor(latestFg?.value)}`}>
                {latestFg?.value ?? '—'}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {latestFg?.classification ?? 'awaiting'}
              </span>
            </div>
            <div
              className="h-1.5 w-full rounded-full"
              style={{ background: fgGradient(latestFg?.value) }}
            />
          </div>
        </ColumnShell>

        {/* 3. Reddit Sentiment */}
        <ColumnShell
          icon={<MessageCircle className="h-3.5 w-3.5 text-orange-400" />}
          title="Reddit Sentiment"
          dataUpdatedAt={redditQ.dataUpdatedAt}
          isLoading={redditQ.isLoading}
        >
          {!redditAvailable ? (
            <p className="text-[11px] text-muted-foreground">
              Reddit unavailable (IP-blocked)
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-orange-300">
                  {redditScore != null ? (redditScore * 100).toFixed(0) : '—'}
                </span>
                <Badge
                  variant={
                    redditDir === 'bull'
                      ? 'success'
                      : redditDir === 'bear'
                        ? 'rose'
                        : 'muted'
                  }
                >
                  {redditDir}
                </Badge>
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span className="text-emerald-400">bull {reddit?.bullCount ?? 0}</span>
                <span className="text-rose-400">bear {reddit?.bearCount ?? 0}</span>
                <span>{reddit?.postCount ?? reddit?.perSub?.length ?? 0} posts</span>
              </div>
            </div>
          )}
        </ColumnShell>

        {/* 4. BTC On-Chain */}
        <ColumnShell
          icon={<Bitcoin className="h-3.5 w-3.5 text-amber-400" />}
          title="BTC On-Chain"
          dataUpdatedAt={onchainQ.dataUpdatedAt}
          isLoading={onchainQ.isLoading}
        >
          <div className="space-y-1.5 text-[11px]">
            <OnchainRow
              label="Hashrate"
              value={fmtNum(onchain?.hashrate, ' EH/s')}
              trend={onchainTrend?.direction}
            />
            <OnchainRow label="Txns 24h" value={fmtNum(onchain?.transactionCount24h)} />
            <OnchainRow label="Difficulty" value={fmtNum(onchain?.difficulty)} />
            <OnchainRow
              label="Trend"
              value={onchainTrend?.direction ?? '—'}
              trend={onchainTrend?.direction}
            />
          </div>
        </ColumnShell>

        {/* 5. Dev Activity */}
        <ColumnShell
          icon={<Github className="h-3.5 w-3.5 text-violet-300" />}
          title="Dev Activity"
          dataUpdatedAt={devQ.dataUpdatedAt}
          isLoading={devQ.isLoading}
        >
          <div className="space-y-1.5">
            {devEntries.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No repo data</p>
            ) : (
              devEntries.map((r) => {
                const trend: 'up' | 'down' | 'flat' =
                  r.deltaPct > 5 ? 'up' : r.deltaPct < -5 ? 'down' : 'flat';
                return (
                  <div
                    key={r.repo}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="truncate text-foreground" title={r.label}>
                      {r.asset}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="violet" className="font-mono">
                        {r.commits7d ?? 0}
                      </Badge>
                      {trend === 'up' ? (
                        <ArrowUp className="h-3 w-3 text-emerald-400" />
                      ) : trend === 'down' ? (
                        <ArrowDown className="h-3 w-3 text-rose-400" />
                      ) : (
                        <Minus className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ColumnShell>
      </CardContent>
    </Card>
  );
}

function OnchainRow({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: 'rising' | 'falling' | 'flat';
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className="font-mono text-foreground">{value}</span>
        {trend === 'rising' ? (
          <ArrowUp className="h-3 w-3 text-emerald-400" />
        ) : trend === 'falling' ? (
          <ArrowDown className="h-3 w-3 text-rose-400" />
        ) : null}
      </div>
    </div>
  );
}
