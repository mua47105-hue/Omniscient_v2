'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Newspaper, Sparkles, ExternalLink, Search, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewsItem {
  id: string;
  source: string;
  url?: string | null;
  title: string;
  body?: string | null;
  publishedAt: string;
  sentiment?: number | null;
  impact?: string | null;
  assetsTagged: string; // JSON
  analyzed: boolean;
  createdAt: string;
}

interface NewsResponse {
  success?: boolean;
  data?: NewsItem[];
  scanned?: number;
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

function parseAssets(raw: string): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    if (Array.isArray(a)) return a.map((s) => String(s));
  } catch {
    /* ignore */
  }
  return [];
}

function sentimentColor(v: number | null | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v > 0.3) return 'text-emerald-400';
  if (v > -0.3) return 'text-amber-300';
  return 'text-rose-400';
}

function impactVariant(impact: string | null | undefined): 'success' | 'warning' | 'rose' | 'muted' {
  if (impact === 'high') return 'rose';
  if (impact === 'medium') return 'warning';
  if (impact === 'low') return 'success';
  return 'muted';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewsClient(): React.ReactElement {
  const qc = useQueryClient();
  const [query, setQuery] = React.useState('');
  const [activeQuery, setActiveQuery] = React.useState<string>('');

  const newsQ = useQuery<NewsItem[]>({
    queryKey: ['news-feed', activeQuery],
    queryFn: async () => {
      const url = activeQuery
        ? `/api/news?limit=40&q=${encodeURIComponent(activeQuery)}`
        : '/api/news?limit=40';
      const res = await fetch(url);
      if (!res.ok) throw new Error('news fetch failed');
      const json: NewsResponse = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  const analyzeMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/news/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('analyze failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['news-feed', activeQuery] });
    },
  });

  const items = newsQ.data ?? [];

  const handleSearch = () => {
    setActiveQuery(query.trim());
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">News</h1>
          <p className="text-xs text-muted-foreground">
            Live feed from CoinDesk, Cointelegraph, Decrypt + z-ai web search. Click the analyze
            button on any article to run LLM sentiment analysis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Augment with web search…"
              className="h-9 w-56 pl-8"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => newsQ.refetch()}>
            <RefreshCw className={cn('h-4 w-4', newsQ.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {newsQ.isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Loading news…
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Newspaper className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              No articles found. RSS feeds may be unreachable.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              onAnalyze={() => analyzeMut.mutate(item.id)}
              analyzing={
                analyzeMut.isPending && analyzeMut.variables === item.id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewsCard
// ---------------------------------------------------------------------------

function NewsCard({
  item,
  onAnalyze,
  analyzing,
}: {
  item: NewsItem;
  onAnalyze: () => void;
  analyzing: boolean;
}): React.ReactElement {
  const assets = parseAssets(item.assetsTagged);
  return (
    <Card className="ring-1 ring-inset ring-border/30">
      <CardContent className="grid gap-2 p-3 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info" className="text-[10px]">
              {item.source}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{fmtAgo(item.publishedAt)}</span>
            {item.analyzed ? (
              <>
                {item.impact ? (
                  <Badge variant={impactVariant(item.impact)} className="text-[10px] capitalize">
                    {item.impact}
                  </Badge>
                ) : null}
                {item.sentiment != null ? (
                  <span
                    className={cn(
                      'font-mono text-[10px]',
                      sentimentColor(item.sentiment),
                    )}
                  >
                    sentiment {item.sentiment >= 0 ? '+' : ''}
                    {item.sentiment.toFixed(2)}
                  </span>
                ) : null}
              </>
            ) : null}
            {assets.length > 0
              ? assets.map((a) => (
                  <Badge key={a} variant="violet" className="text-[10px]">
                    {a}
                  </Badge>
                ))
              : null}
          </div>
          <div className="flex items-start gap-2">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-foreground hover:text-primary hover:underline"
              >
                {item.title}
                <ExternalLink className="ml-1 inline h-3 w-3 align-middle" />
              </a>
            ) : (
              <span className="text-sm font-semibold text-foreground">{item.title}</span>
            )}
          </div>
          {item.body ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
              {item.body}
            </p>
          ) : null}
        </div>
        <div className="flex items-center lg:pl-4">
          <Button
            variant={item.analyzed ? 'outline' : 'default'}
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={onAnalyze}
            disabled={analyzing}
          >
            <Sparkles className="h-3 w-3" />
            {analyzing ? 'Analyzing…' : item.analyzed ? 'Re-analyze' : 'Analyze'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
