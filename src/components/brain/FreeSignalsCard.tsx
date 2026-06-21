'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Flame, Gauge, MessageSquare, TrendingUp, ExternalLink, Boxes, GitCommit } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendingCoin { rank: number; coinId: string; symbol: string; name: string; marketCapRank: number | null; priceBtc: number; score: number; }
interface FearGreed { value: number; classification: string; timestamp: number; }
interface OnChainStats { txCount24h: number; hashRate: number; difficulty: number; fetchedAt: number; }
interface RepoActivity { asset: string; label: string; repo: string; stars: number; commits7d: number; lastPush: string | null; }

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'failed');
  return j.data as T;
}

function fgColor(v: number): string {
  if (v < 25) return 'text-rose-400';
  if (v < 45) return 'text-orange-400';
  if (v < 55) return 'text-amber-400';
  if (v < 75) return 'text-lime-400';
  return 'text-emerald-400';
}

export function FreeSignalsCard() {
  const trendingQ = useQuery({ queryKey: ['cg-trending'], queryFn: () => fetchJson<{ trending: TrendingCoin[] }>(`/api/crypto/trending`).then((d) => d.trending), refetchInterval: 5 * 60 * 1000, retry: 1 });
  const fgQ = useQuery({ queryKey: ['fg-brain'], queryFn: () => fetchJson<FearGreed>(`/api/macro/fear-greed`), refetchInterval: 15 * 60 * 1000, retry: 1 });
  const redditQ = useQuery({ queryKey: ['reddit-sentiment'], queryFn: () => fetchJson<{ available: boolean; aggregate?: { score: number; label: string; postsAnalyzed: number; bullishHits: number; bearishHits: number }; reason?: string }>(`/api/sentiment/reddit`), refetchInterval: 10 * 60 * 1000, retry: 1 });
  const onchainQ = useQuery({ queryKey: ['onchain'], queryFn: () => fetchJson<OnChainStats>(`/api/onchain/stats`), refetchInterval: 15 * 60 * 1000, retry: 1 });
  const devQ = useQuery({ queryKey: ['devactivity'], queryFn: () => fetchJson<RepoActivity[]>(`/api/devactivity`), refetchInterval: 30 * 60 * 1000, retry: 1 });

  const trending = trendingQ.data ?? [];
  const fg = fgQ.data;
  const reddit = redditQ.data;
  const onchain = onchainQ.data;
  const dev = devQ.data ?? [];

  return (
    <Card className="border-border/60 ring-1 ring-inset ring-border/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-400" /> Free Data Sources
          <span className="text-[10px] font-normal text-muted-foreground ml-1">zero-token signals · 5 free sources</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Trending */}
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> CoinGecko Trending
          </div>
          <ScrollArea className="h-[170px]">
            <div className="space-y-0.5 pr-2">
              {trendingQ.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-6 rounded bg-muted/40 animate-pulse" />)
              ) : trending.length === 0 ? (
                <div className="text-xs text-muted-foreground/60 py-4 text-center">Unavailable</div>
              ) : (
                trending.slice(0, 7).map((c) => (
                  <div key={c.coinId} className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-muted/30 transition-colors">
                    <span className="text-[10px] font-mono text-muted-foreground/60 w-4">{c.rank}</span>
                    <span className="text-sm font-semibold flex-1 truncate">{c.symbol}</span>
                    {c.marketCapRank != null && <Badge variant="outline" className="text-[9px] py-0">#{c.marketCapRank}</Badge>}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Fear & Greed */}
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> Fear &amp; Greed
          </div>
          {fgQ.isLoading ? (
            <div className="h-[170px] flex items-center justify-center"><div className="h-10 w-20 rounded bg-muted/40 animate-pulse" /></div>
          ) : !fg ? (
            <div className="text-xs text-muted-foreground/60 py-4 text-center h-[170px] flex items-center justify-center">Unavailable</div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[170px]">
              <span className={cn('text-4xl font-bold tabular-nums', fgColor(fg.value))}>{fg.value}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">/ 100</span>
              <Badge variant="outline" className={cn('mt-2 text-[10px]', fgColor(fg.value))}>{fg.classification}</Badge>
              <div className="mt-3 h-1.5 w-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500 relative overflow-hidden">
                <div className="absolute top-1/2 -translate-y-1/2 h-3 w-1 rounded-full bg-white shadow" style={{ left: `${fg.value}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Reddit sentiment (graceful when blocked) */}
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" /> Reddit Sentiment
          </div>
          {redditQ.isLoading ? (
            <div className="h-[170px] space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-6 rounded bg-muted/40 animate-pulse" />)}</div>
          ) : !reddit || !reddit.available ? (
            <div className="h-[170px] flex items-center justify-center text-center px-2">
              <span className="text-[10px] text-muted-foreground/60 leading-relaxed">
                {reddit?.reason ?? 'Unavailable'}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                <div>
                  <div className={cn('text-lg font-bold', reddit.aggregate!.score > 15 ? 'text-emerald-400' : reddit.aggregate!.score < -15 ? 'text-rose-400' : 'text-muted-foreground')}>
                    {reddit.aggregate!.score > 0 ? '+' : ''}{reddit.aggregate!.score}
                  </div>
                  <div className="text-[10px] text-muted-foreground capitalize">{reddit.aggregate!.label} · {reddit.aggregate!.postsAnalyzed}</div>
                </div>
                <div className="flex flex-col items-end text-[10px]">
                  <span className="text-emerald-400">▲ {reddit.aggregate!.bullishHits}</span>
                  <span className="text-rose-400">▼ {reddit.aggregate!.bearishHits}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* On-chain BTC fundamentals */}
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
            <Boxes className="h-3.5 w-3.5" /> BTC On-Chain
          </div>
          {onchainQ.isLoading ? (
            <div className="h-[170px] space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-6 rounded bg-muted/40 animate-pulse" />)}</div>
          ) : !onchain ? (
            <div className="text-xs text-muted-foreground/60 py-4 text-center h-[170px] flex items-center justify-center">Unavailable</div>
          ) : (
            <div className="space-y-1.5 h-[170px]">
              <OnChainRow label="Hashrate" value={`${(onchain.hashRate / 1e9).toFixed(1)} EH/s`} hint="miner confidence" accent="text-sky-400" />
              <OnChainRow label="24h Txns" value={onchain.txCount24h.toLocaleString()} hint="network demand" accent="text-emerald-400" />
              <OnChainRow label="Difficulty" value={`${(onchain.difficulty / 1e12).toFixed(1)}T`} hint="security budget" accent="text-violet-400" />
            </div>
          )}
        </div>

        {/* GitHub dev-activity — commit count for flagship crypto repos */}
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
            <GitCommit className="h-3.5 w-3.5" /> Dev Activity
          </div>
          {devQ.isLoading ? (
            <div className="h-[170px] space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-6 rounded bg-muted/40 animate-pulse" />)}</div>
          ) : dev.length === 0 ? (
            <div className="text-xs text-muted-foreground/60 py-4 text-center h-[170px] flex items-center justify-center">Unavailable</div>
          ) : (
            <ScrollArea className="h-[170px]">
              <div className="space-y-0.5 pr-2">
                {dev.map((r) => (
                  <div key={r.repo} className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-muted/30 transition-colors">
                    <span className="text-xs font-bold w-8 shrink-0">{r.asset}</span>
                    <span className="text-[10px] text-muted-foreground flex-1 truncate">{r.label}</span>
                    <Badge variant="outline" className={cn('text-[9px] py-0', r.commits7d > 30 ? 'text-emerald-400 border-emerald-500/30' : r.commits7d > 10 ? 'text-amber-400' : 'text-muted-foreground')}>
                      {r.commits7d}c
                    </Badge>
                  </div>
                ))}
                <div className="text-[9px] text-muted-foreground/60 pt-1.5 text-center">commits / 7d</div>
              </div>
            </ScrollArea>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OnChainRow({ label, value, hint, accent }: { label: string; value: string; hint: string; accent: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="text-[9px] text-muted-foreground/60">{hint}</div>
      </div>
      <span className={cn('text-sm font-bold tabular-nums', accent)}>{value}</span>
    </div>
  );
}
