'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow, format } from 'date-fns';
import { toast } from 'sonner';
import {
  Newspaper,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Loader2,
  Clock,
  Sparkles,
  Bitcoin,
  DollarSign,
  Coins,
  Globe,
  CalendarDays,
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Gauge,
  Tag,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import type { ApiResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface NewsItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
  date: string | null;
}

type Topic = 'crypto' | 'forex' | 'commodities' | 'macro' | 'ipo';

interface SentimentResult {
  sentiment: number; // -100..100
  impact: 'low' | 'medium' | 'high';
  assetsTagged: string[];
  oneLineSummary: string;
}

interface SentimentSummary {
  avgSentiment: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  topAssets: { asset: string; mentions: number; avgSentiment: number }[];
}

interface AnalyzedResponse {
  analyzed: true;
  results: SentimentResult[];
  summary: SentimentSummary;
  model?: string;
  latencyMs?: number;
}

interface NotAnalyzedResponse {
  analyzed: false;
  message: string;
}

type AnalyzeResponse = AnalyzedResponse | NotAnalyzedResponse;

const TOPICS: { key: Topic; label: string; icon: typeof Bitcoin }[] = [
  { key: 'crypto', label: 'Crypto', icon: Bitcoin },
  { key: 'forex', label: 'Forex', icon: DollarSign },
  { key: 'commodities', label: 'Commodities', icon: Coins },
  { key: 'macro', label: 'Macro', icon: Globe },
  { key: 'ipo', label: 'IPO', icon: CalendarDays },
];

async function fetchNews(topic: Topic): Promise<NewsItem[]> {
  const r = await fetch(`/api/news?topic=${topic}`, { cache: 'no-store' });
  const j: ApiResult<NewsItem[]> = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to load news');
  return j.data ?? [];
}

async function analyzeNews(
  articles: { title: string; snippet?: string; source: string }[],
): Promise<AnalyzeResponse> {
  const r = await fetch('/api/news/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles }),
    cache: 'no-store',
  });
  const j: ApiResult<AnalyzeResponse> = await r.json();
  if (!j.success) throw new Error(j.error || 'Analysis request failed');
  return j.data as AnalyzeResponse;
}

// ---------------------------------------------------------------------------
// Recency bucketing
// ---------------------------------------------------------------------------
type Bucket = { label: string; items: NewsItem[] };

function bucketByRecency(items: NewsItem[]): Bucket[] {
  const now = Date.now();
  const today: NewsItem[] = [];
  const yesterday: NewsItem[] = [];
  const week: NewsItem[] = [];
  const older: NewsItem[] = [];

  for (const it of items) {
    if (!it.date) {
      today.push(it);
      continue;
    }
    const t = new Date(it.date).getTime();
    if (Number.isNaN(t)) {
      today.push(it);
      continue;
    }
    const ageHrs = (now - t) / (1000 * 60 * 60);
    if (ageHrs <= 24) today.push(it);
    else if (ageHrs <= 48) yesterday.push(it);
    else if (ageHrs <= 24 * 7) week.push(it);
    else older.push(it);
  }

  const buckets: Bucket[] = [];
  if (today.length) buckets.push({ label: 'Today', items: today });
  if (yesterday.length) buckets.push({ label: 'Yesterday', items: yesterday });
  if (week.length) buckets.push({ label: 'Past Week', items: week });
  if (older.length) buckets.push({ label: 'Older', items: older });
  return buckets;
}

// ---------------------------------------------------------------------------
// Sentiment helpers
// ---------------------------------------------------------------------------
function sentimentTone(s: number): 'bullish' | 'bearish' | 'neutral' {
  if (s > 20) return 'bullish';
  if (s < -20) return 'bearish';
  return 'neutral';
}

function sentimentColor(s: number): { text: string; bg: string; border: string; bar: string } {
  const t = sentimentTone(s);
  if (t === 'bullish')
    return {
      text: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      bar: 'bg-emerald-500',
    };
  if (t === 'bearish')
    return {
      text: 'text-rose-500',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/30',
      bar: 'bg-rose-500',
    };
  return {
    text: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    bar: 'bg-amber-500',
  };
}

function sentimentLabel(s: number): string {
  const t = sentimentTone(s);
  if (t === 'bullish') return 'Bullish';
  if (t === 'bearish') return 'Bearish';
  return 'Neutral';
}

function impactTone(impact: 'low' | 'medium' | 'high'): { text: string; dot: string } {
  if (impact === 'high') return { text: 'text-rose-500', dot: 'bg-rose-500' };
  if (impact === 'medium') return { text: 'text-amber-500', dot: 'bg-amber-500' };
  return { text: 'text-muted-foreground', dot: 'bg-muted-foreground/60' };
}

// Map sentiment (-100..100) to a 0..100 position for the gauge bar.
function gaugePos(s: number): number {
  return Math.max(0, Math.min(100, ((s + 100) / 200) * 100));
}

// ---------------------------------------------------------------------------
// Single article row
// ---------------------------------------------------------------------------
function ArticleCard({
  item,
  index,
  result,
}: {
  item: NewsItem;
  index: number;
  result?: SentimentResult;
}) {
  const date = item.date ? new Date(item.date) : null;
  const validDate = date && !Number.isNaN(date.getTime());
  const rel = validDate
    ? formatDistanceToNow(date as Date, { addSuffix: true })
    : 'recent';
  const exact = validDate ? format(date as Date, 'PPP p') : '';

  const sCol = result ? sentimentColor(result.sentiment) : null;
  const iTone = result ? impactTone(result.impact) : null;

  return (
    <motion.a
      href={item.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.25 }}
      className="block group"
    >
      <Card
        className={cn(
          'border-border/60 hover:border-emerald-500/40 hover:bg-emerald-500/[0.02] transition-all overflow-hidden',
          result && sCol?.border,
        )}
      >
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-[10px] font-medium bg-emerald-500/5 border-emerald-500/20 text-emerald-500"
              >
                {item.source || 'source'}
              </Badge>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {rel}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {result && sCol && (
                <Badge
                  variant="outline"
                  className={cn(
                    'px-1.5 py-0 text-[10px] gap-1 font-semibold',
                    sCol.bg,
                    sCol.border,
                    sCol.text,
                  )}
                >
                  {result.sentiment > 20 ? (
                    <TrendingUp className="h-2.5 w-2.5" />
                  ) : result.sentiment < -20 ? (
                    <TrendingDown className="h-2.5 w-2.5" />
                  ) : (
                    <Minus className="h-2.5 w-2.5" />
                  )}
                  {result.sentiment > 0 ? '+' : ''}
                  {result.sentiment}
                </Badge>
              )}
              {result && iTone && (
                <Badge
                  variant="outline"
                  className={cn(
                    'px-1.5 py-0 text-[10px] gap-1 border-border/60',
                    iTone.text,
                  )}
                >
                  <span className={cn('inline-block h-1.5 w-1.5 rounded-full', iTone.dot)} />
                  {result.impact}
                </Badge>
              )}
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          <h3 className="font-semibold text-sm leading-snug group-hover:text-emerald-500 transition-colors line-clamp-2">
            {item.title}
          </h3>

          {result?.oneLineSummary ? (
            <p className="text-xs italic text-muted-foreground/80 leading-relaxed line-clamp-2">
              {result.oneLineSummary}
            </p>
          ) : (
            item.snippet && (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {item.snippet}
              </p>
            )
          )}

          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground/70">
              {exact || 'Date unavailable'}
            </span>
            <div className="flex items-center gap-1 flex-wrap">
              {result?.assetsTagged && result.assetsTagged.length > 0 ? (
                result.assetsTagged.slice(0, 5).map((a) => (
                  <Badge
                    key={a}
                    variant="outline"
                    className="px-1.5 py-0 text-[10px] font-mono gap-0.5 bg-muted/40 border-border/60 text-muted-foreground"
                  >
                    <Tag className="h-2.5 w-2.5" />
                    {a}
                  </Badge>
                ))
              ) : !result ? (
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 text-[10px] gap-1 bg-amber-500/5 border-amber-500/20 text-amber-500/80"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  Pending analysis
                </Badge>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.a>
  );
}

// ---------------------------------------------------------------------------
// Sentiment Summary Card
// ---------------------------------------------------------------------------
function SentimentSummaryCard({
  summary,
  model,
  latencyMs,
  articleCount,
  onReset,
}: {
  summary: SentimentSummary;
  model?: string;
  latencyMs?: number;
  articleCount: number;
  onReset: () => void;
}) {
  const tone = sentimentTone(summary.avgSentiment);
  const pos = gaugePos(summary.avgSentiment);
  const total = summary.bullishCount + summary.bearishCount + summary.neutralCount;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <Card
        className={cn(
          'border-border/60 overflow-hidden relative',
          tone === 'bullish' && 'border-emerald-500/40',
          tone === 'bearish' && 'border-rose-500/40',
          tone === 'neutral' && 'border-amber-500/40',
        )}
      >
        <div
          className={cn(
            'absolute inset-x-0 top-0 h-0.5',
            tone === 'bullish' && 'bg-emerald-500',
            tone === 'bearish' && 'bg-rose-500',
            tone === 'neutral' && 'bg-amber-500',
          )}
        />
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge
                  className={cn(
                    'h-4 w-4',
                    tone === 'bullish' && 'text-emerald-500',
                    tone === 'bearish' && 'text-rose-500',
                    tone === 'neutral' && 'text-amber-500',
                  )}
                />
                Sentiment Summary
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {articleCount} articles analyzed{model ? ` · ${model}` : ''}
                {latencyMs ? ` · ${latencyMs}ms` : ''}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onReset} className="h-7 text-xs gap-1">
              <RefreshCw className="h-3 w-3" /> Re-run
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Average sentiment gauge */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Average sentiment
              </span>
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'font-mono text-3xl font-bold leading-none',
                    tone === 'bullish' && 'text-emerald-500',
                    tone === 'bearish' && 'text-rose-500',
                    tone === 'neutral' && 'text-amber-500',
                  )}
                >
                  {summary.avgSentiment > 0 ? '+' : ''}
                  {summary.avgSentiment}
                </span>
                <span className="text-xs text-muted-foreground">/ 100</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] gap-1',
                    tone === 'bullish' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
                    tone === 'bearish' && 'border-rose-500/30 bg-rose-500/10 text-rose-500',
                    tone === 'neutral' && 'border-amber-500/30 bg-amber-500/10 text-amber-500',
                  )}
                >
                  {sentimentLabel(summary.avgSentiment)}
                </Badge>
              </div>
            </div>
            {/* Bipolar bar: rose ← center → emerald */}
            <div className="relative h-2.5 w-full rounded-full overflow-hidden bg-muted/60">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border/80" />
              <div
                className={cn(
                  'absolute inset-y-0 transition-all duration-500',
                  summary.avgSentiment >= 0
                    ? cn('left-1/2', sentimentColor(50).bar)
                    : cn('right-1/2', sentimentColor(-50).bar),
                )}
                style={{
                  width: `${Math.abs(summary.avgSentiment) / 2}%`,
                }}
              />
              {/* Marker for exact position */}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3.5 w-0.5 bg-foreground shadow-sm"
                style={{ left: `calc(${pos}% - 1px)` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground/70">
              <span>-100 Bearish</span>
              <span>0 Neutral</span>
              <span>+100 Bullish</span>
            </div>
          </div>

          {/* Counts row */}
          <div className="grid grid-cols-3 gap-2">
            <CountTile
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              label="Bullish"
              count={summary.bullishCount}
              total={total}
              tone="bullish"
            />
            <CountTile
              icon={<Minus className="h-3.5 w-3.5" />}
              label="Neutral"
              count={summary.neutralCount}
              total={total}
              tone="neutral"
            />
            <CountTile
              icon={<TrendingDown className="h-3.5 w-3.5" />}
              label="Bearish"
              count={summary.bearishCount}
              total={total}
              tone="bearish"
            />
          </div>

          {/* Top assets */}
          {summary.topAssets.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <Activity className="h-3 w-3" />
                Most mentioned assets
              </div>
              <div className="flex flex-wrap gap-1.5">
                {summary.topAssets.map((a) => {
                  const aTone = sentimentTone(a.avgSentiment);
                  return (
                    <Badge
                      key={a.asset}
                      variant="outline"
                      className={cn(
                        'px-2 py-0.5 text-[11px] font-mono gap-1.5',
                        aTone === 'bullish' &&
                          'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
                        aTone === 'bearish' &&
                          'border-rose-500/30 bg-rose-500/10 text-rose-500',
                        aTone === 'neutral' &&
                          'border-amber-500/30 bg-amber-500/10 text-amber-500',
                      )}
                      title={`avg sentiment ${a.avgSentiment.toFixed(0)}`}
                    >
                      {a.asset}
                      <span className="text-[9px] opacity-70">×{a.mentions}</span>
                      <span className="text-[9px] opacity-80">
                        {a.avgSentiment > 0 ? '+' : ''}
                        {a.avgSentiment.toFixed(0)}
                      </span>
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function CountTile({
  icon,
  label,
  count,
  total,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  tone: 'bullish' | 'bearish' | 'neutral';
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const col =
    tone === 'bullish'
      ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/[0.06]'
      : tone === 'bearish'
        ? 'text-rose-500 border-rose-500/30 bg-rose-500/[0.06]'
        : 'text-amber-500 border-amber-500/30 bg-amber-500/[0.06]';
  return (
    <div className={cn('rounded-lg border p-2.5 space-y-1', col)}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-90">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-lg font-bold leading-none">{count}</span>
        <span className="text-[10px] opacity-70">/ {total} · {pct}%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function NewsSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 2 }).map((_, b) => (
        <div key={b} className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="border-border/60">
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------
export function NewsClient() {
  const router = useRouter();
  const [topic, setTopic] = useState<Topic>('crypto');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);

  const newsQ = useQuery({
    queryKey: ['news', topic],
    queryFn: () => fetchNews(topic),
    refetchInterval: 120_000,
  });

  // Clear cached analysis whenever the topic changes.
  useEffect(() => {
    setAnalysis(null);
  }, [topic]);

  const buckets = useMemo(() => bucketByRecency(newsQ.data ?? []), [newsQ.data]);
  const total = newsQ.data?.length ?? 0;

  const runAnalysis = async () => {
    if (!newsQ.data || newsQ.data.length === 0) return;
    setAnalyzing(true);
    try {
      const payload = newsQ.data.map((a) => ({
        title: a.title,
        snippet: a.snippet,
        source: a.source,
      }));
      const resp = await analyzeNews(payload);
      setAnalysis(resp);
      if (!resp.analyzed) {
        toast.error('Sentiment analysis unavailable', {
          description: resp.message,
          action: {
            label: 'Open Settings',
            onClick: () => router.push('/settings/providers'),
          },
        });
      } else {
        toast.success('Sentiment analysis complete', {
          description: `${resp.results.length} articles · avg ${resp.summary.avgSentiment > 0 ? '+' : ''}${resp.summary.avgSentiment} sentiment`,
        });
      }
    } catch (e: any) {
      toast.error('Analysis failed', { description: e?.message || 'Unknown error' });
    } finally {
      setAnalyzing(false);
    }
  };

  const resetAnalysis = () => {
    setAnalysis(null);
  };

  // Helper to find the result for a given article index in the flat order.
  const resultFor = (bucketIdx: number, itemIdx: number): SentimentResult | undefined => {
    if (!analysis?.analyzed) return undefined;
    // Buckets preserve order from newsQ.data, so we need the global index.
    // Flatten in same order as buckets were built.
    let counter = 0;
    for (let b = 0; b < buckets.length; b++) {
      if (b === bucketIdx) {
        return analysis.results[counter + itemIdx];
      }
      counter += buckets[b].items.length;
    }
    return undefined;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2">
            Market News
            <Newspaper className="h-6 w-6 text-emerald-500" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time financial news wire · LLM sentiment scoring & impact analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => newsQ.refetch()}
            disabled={newsQ.isFetching}
            className="h-8"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', newsQ.isFetching && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={runAnalysis}
            disabled={analyzing || total === 0}
            className={cn(
              'h-8 gap-1.5',
              'bg-emerald-600 hover:bg-emerald-700 text-white',
            )}
          >
            {analyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Brain className="h-3.5 w-3.5" />
                Analyze Sentiment
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Topic selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {TOPICS.map((t) => {
          const Icon = t.icon;
          const active = topic === t.key;
          return (
            <Button
              key={t.key}
              size="sm"
              variant={active ? 'secondary' : 'outline'}
              onClick={() => setTopic(t.key)}
              className={cn(
                'h-8 gap-1.5',
                active &&
                  'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/30',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </Button>
          );
        })}
      </div>

      {/* Analyzing banner */}
      <AnimatePresence>
        {analyzing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] px-4 py-2.5 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
              <span className="text-emerald-500/90 font-medium">
                Analyzing {total} article{total === 1 ? '' : 's'}…
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Fusing sentiment, impact, and asset tagging in one LLM pass.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sentiment summary card */}
      <AnimatePresence>
        {analysis?.analyzed && (
          <SentimentSummaryCard
            summary={analysis.summary}
            model={analysis.model}
            latencyMs={analysis.latencyMs}
            articleCount={analysis.results.length}
            onReset={resetAnalysis}
          />
        )}
      </AnimatePresence>

      {/* Body */}
      {newsQ.isLoading ? (
        <NewsSkeleton />
      ) : newsQ.error ? (
        <Card className="border-rose-500/30 bg-rose-500/[0.03]">
          <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-3">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <div>
              <p className="font-semibold text-rose-500">Failed to load news</p>
              <p className="text-xs text-muted-foreground mt-1">
                {newsQ.error instanceof Error ? newsQ.error.message : 'Unknown error'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => newsQ.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
          </CardContent>
        </Card>
      ) : total === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 flex flex-col items-center justify-center text-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
              <Newspaper className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">No articles found</p>
              <p className="text-sm text-muted-foreground max-w-md">
                The news wire returned no recent stories for this topic. Try another topic or
                refresh in a moment.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {buckets.map((b, bIdx) => (
            <div key={b.label} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {b.label}
                </h2>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {b.items.length}
                </Badge>
                <div className="flex-1 h-px bg-border/40" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {b.items.map((it, i) => (
                  <ArticleCard
                    key={it.url + i}
                    item={it}
                    index={i}
                    result={resultFor(bIdx, i)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fetching indicator */}
      {newsQ.isFetching && !newsQ.isLoading && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-full bg-card border border-border/60 px-3 py-1.5 text-xs shadow-lg">
          <Loader2 className="h-3 w-3 animate-spin text-emerald-500" />
          Updating…
        </div>
      )}
    </div>
  );
}
