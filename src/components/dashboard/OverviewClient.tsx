'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bitcoin, Coins, Activity, BarChart3, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BrainStatusCard } from '@/components/brain/BrainStatusCard';
import { LiveTickerBar } from './LiveTickerBar';
import { StatCard } from './StatCard';
import { AssetTable, type AssetRow } from './AssetTable';

// ---------------------------------------------------------------------------
// API response shapes (all wrapped in { success: true, data: ... })
// ---------------------------------------------------------------------------

interface TickerLite {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume?: number;
  volume?: number;
  high?: number;
  low?: number;
}

interface PricesResponse {
  success?: boolean;
  data?: TickerLite[];
}

interface MoversResponse {
  success?: boolean;
  data?: TickerLite[];
}

interface FearGreedEntry {
  value: number;
  classification: string;
  timestamp: number;
}

interface FearGreedResponse {
  success?: boolean;
  data?: FearGreedEntry[];
}

interface GlobalCryptoStats {
  totalMarketCapUsd?: number;
  totalVolumeUsd?: number;
  marketCapChangePercent24h?: number;
  btcDominancePercent?: number;
  ethDominancePercent?: number;
  activeCryptocurrencies?: number;
  fetchedAt?: number;
}

interface GlobalResponse {
  success?: boolean;
  data?: GlobalCryptoStats;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUsd(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fgColor(v: number | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v < 25) return 'text-rose-400';
  if (v < 45) return 'text-orange-400';
  if (v < 55) return 'text-amber-300';
  if (v < 75) return 'text-lime-300';
  return 'text-emerald-400';
}

// ---------------------------------------------------------------------------
// OverviewClient — the / page
// ---------------------------------------------------------------------------

export function OverviewClient(): React.ReactElement {
  const pricesQ = useQuery<PricesResponse>({
    queryKey: ['crypto-prices'],
    queryFn: async () => {
      const res = await fetch('/api/crypto/prices');
      if (!res.ok) throw new Error('prices fetch failed');
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const moversQ = useQuery<MoversResponse>({
    queryKey: ['crypto-movers'],
    queryFn: async () => {
      const res = await fetch('/api/crypto/movers');
      if (!res.ok) throw new Error('movers fetch failed');
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const fgQ = useQuery<FearGreedResponse>({
    queryKey: ['fear-greed-overview'],
    queryFn: async () => {
      const res = await fetch('/api/macro/fear-greed?limit=1');
      if (!res.ok) throw new Error('fear-greed fetch failed');
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  const globalQ = useQuery<GlobalResponse>({
    queryKey: ['global'],
    queryFn: async () => {
      const res = await fetch('/api/macro/global');
      if (!res.ok) throw new Error('global fetch failed');
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  const prices = pricesQ.data?.data ?? [];
  const btc = prices.find((p) => p.symbol === 'BTCUSDT');
  const eth = prices.find((p) => p.symbol === 'ETHUSDT');
  const totalVol = prices.reduce((sum, p) => sum + (p.quoteVolume ?? 0), 0);
  const movers = moversQ.data?.data ?? [];

  // Split movers by direction for the gainers/losers columns.
  const gainers = movers.filter((m) => m.priceChangePercent > 0);
  const losers = movers.filter((m) => m.priceChangePercent < 0);
  const breadth =
    gainers.length + losers.length > 0
      ? (gainers.length / (gainers.length + losers.length)) * 100
      : 50;

  const assetRows: AssetRow[] = prices.slice(0, 12).map((p) => ({
    symbol: p.symbol,
    price: p.lastPrice,
    changePct: p.priceChangePercent,
    quoteVolume: p.quoteVolume,
  }));

  const global = globalQ.data?.data;
  const marketCapChange = global?.marketCapChangePercent24h ?? 0;
  const btcDominance = global?.btcDominancePercent ?? 0;
  const totalMktCap = global?.totalMarketCapUsd ?? 0;
  const totalVolume = global?.totalVolumeUsd ?? 0;
  const latestFg = fgQ.data?.data?.[0];
  const fg = latestFg?.value;

  return (
    <div className="flex min-h-screen flex-col">
      <LiveTickerBar />

      <div className="flex-1 space-y-4 p-4 md:p-6">
        {/* Hero */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Market Overview
          </h1>
          <p className="text-xs text-muted-foreground">
            Real-time intelligence across crypto, forex, and macro — autonomous analysis running 24/7.
          </p>
        </div>

        {/* Brain status banner */}
        <BrainStatusCard />

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="BTC / USDT"
            value={btc ? `$${fmtPrice(btc.lastPrice)}` : '—'}
            changePct={btc?.priceChangePercent}
            accent="amber"
            icon={<Bitcoin className="h-4 w-4" />}
            sub={btc ? `H ${btc.high?.toFixed(0)} · L ${btc.low?.toFixed(0)}` : undefined}
          />
          <StatCard
            title="ETH / USDT"
            value={eth ? `$${fmtPrice(eth.lastPrice)}` : '—'}
            changePct={eth?.priceChangePercent}
            accent="teal"
            icon={<Coins className="h-4 w-4" />}
          />
          <StatCard
            title="Market Breadth"
            value={`${breadth.toFixed(0)}%`}
            sub={`${gainers.length}↑ / ${losers.length}↓`}
            accent={breadth >= 55 ? 'emerald' : breadth <= 45 ? 'rose' : 'muted'}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard
            title="24h Volume"
            value={fmtUsd(totalVolume || totalVol)}
            accent="orange"
            icon={<BarChart3 className="h-4 w-4" />}
          />
        </div>

        {/* Sentiment banner */}
        <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-950/20 to-card">
          <CardContent className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Fear &amp; Greed
              </span>
              <div className="flex items-baseline gap-2">
                <span className={`text-xl font-bold ${fgColor(fg)}`}>{fg ?? '—'}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {latestFg?.classification ?? 'awaiting'}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Global Mkt Cap
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-base text-foreground">{fmtUsd(totalMktCap)}</span>
                <span
                  className={`font-mono text-[11px] ${
                    marketCapChange >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {marketCapChange >= 0 ? '+' : ''}
                  {marketCapChange.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                BTC Dominance
              </span>
              <span className="font-mono text-base text-amber-300">
                {btcDominance.toFixed(1)}%
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Volatility
              </span>
              <Badge variant={breadth > 70 || breadth < 30 ? 'warning' : 'success'}>
                {breadth > 70 || breadth < 30 ? 'High' : 'Normal'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Watchlist table + movers */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Watchlist</span>
                <Link
                  href="/crypto"
                  className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground hover:text-foreground"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AssetTable rows={assetRows} />
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-emerald-300">Top Gainers</CardTitle>
              </CardHeader>
              <CardContent>
                <AssetTable
                  rows={gainers.slice(0, 5).map((g) => ({
                    symbol: g.symbol,
                    price: g.lastPrice,
                    changePct: g.priceChangePercent,
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-rose-300">Top Losers</CardTitle>
              </CardHeader>
              <CardContent>
                <AssetTable
                  rows={losers.slice(0, 5).map((g) => ({
                    symbol: g.symbol,
                    price: g.lastPrice,
                    changePct: g.priceChangePercent,
                  }))}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Feature module preview cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <FeaturePreview
            href="/signals"
            title="Signal Feed"
            description="Live AI-graded trading signals with trigger-source traceability."
            icon={<Activity className="h-4 w-4 text-emerald-300" />}
          />
          <FeaturePreview
            href="/derivatives"
            title="Derivatives Edge"
            description="E4 — basis, risk-reversal, DVOL, and VRP regime detection."
            icon={<BarChart3 className="h-4 w-4 text-violet-300" />}
          />
          <FeaturePreview
            href="/correlation"
            title="Cointegration Matrix"
            description="E3 — Engle-Granger ADF + half-life on every crypto pair."
            icon={<Activity className="h-4 w-4 text-sky-300" />}
          />
          <FeaturePreview
            href="/analytics"
            title="Model Analytics"
            description="Per-model win rate, signal grades, self-tuning history."
            icon={<BarChart3 className="h-4 w-4 text-amber-300" />}
          />
        </div>
      </div>
    </div>
  );
}

function FeaturePreview({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}): React.ReactElement {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm font-semibold text-foreground">{title}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
