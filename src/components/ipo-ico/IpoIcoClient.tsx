'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { formatDistanceToNow, format, isValid } from 'date-fns';
import { toast } from 'sonner';
import {
  Building2,
  Coins,
  CalendarDays,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Sparkles,
  TrendingUp,
  Search,
  ShieldCheck,
  FileText,
  Presentation,
  DollarSign,
  CircleDashed,
  Cpu,
  ArrowRight,
  Clock,
  Newspaper,
  Layers,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ApiResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types — mirror of the /api/ipo-ico response shape
// ---------------------------------------------------------------------------
interface IpoIcoItem {
  type: 'ipo' | 'ico';
  name: string;
  symbol?: string;
  date?: string;
  exchange?: string;
  offerPrice?: string;
  valuation?: string;
  details: string;
  assessment?: 'positive' | 'neutral' | 'negative';
  assessmentReason?: string;
  source?: string;
  url?: string;
}

interface IpoIcoPayload {
  ipos: IpoIcoItem[];
  icos: IpoIcoItem[];
}

type TabKey = 'ipo' | 'ico' | 'all';
type FeedFilter = 'all' | 'ipo' | 'ico';

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------
async function fetchIpoIco(type: TabKey): Promise<IpoIcoPayload> {
  const r = await fetch(`/api/ipo-ico?type=${type}`, { cache: 'no-store' });
  const j: ApiResult<IpoIcoPayload> = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to load IPO/ICO feed');
  return j.data ?? { ipos: [], icos: [] };
}

const REFRESH_MS = 10 * 60 * 1000; // 10 minutes — listings don't change fast

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function safeDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isValid(d) ? d : null;
}

function relativeDate(s?: string): string {
  const d = safeDate(s);
  if (!d) return 'date TBA';
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return 'date TBA';
  }
}

function exactDate(s?: string): string {
  const d = safeDate(s);
  if (!d) return '';
  try {
    return format(d, 'PPP');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Pipeline stages (IPO lifecycle) — static informational
// ---------------------------------------------------------------------------
const IPO_STAGES = [
  { label: 'Filed', desc: 'S-1 / F-1 submitted', icon: FileText },
  { label: 'Roadshow', desc: 'Investor marketing', icon: Presentation },
  { label: 'Priced', desc: 'Final offer price set', icon: DollarSign },
  { label: 'Listed', desc: 'Starts trading publicly', icon: TrendingUp },
];

// Risk-screening checklist (ICO) — static informational
const ICO_RISK_CHECKS = [
  { label: 'Whitepaper reviewed', desc: 'Tokenomics, use-case, roadmap' },
  { label: 'Team verified', desc: 'Identity, history, advisors' },
  { label: 'Tokenomics analyzed', desc: 'Supply, vesting, distribution' },
  { label: 'Audit status', desc: 'Smart-contract security audit' },
  { label: 'Liquidity check', desc: 'LP lock, depth, slippage' },
];

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------
function SummaryStat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: typeof Layers;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <div
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md',
          accent,
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-sm font-semibold tabular-nums truncate">{value}</div>
      </div>
    </div>
  );
}

function SummaryStrip({
  items,
  accent,
}: {
  items: { label: string; value: string | number; icon: typeof Layers; accent: string }[];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {items.map((s) => (
        <SummaryStat key={s.label} {...s} accent={accent} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IPO Pipeline Stepper
// ---------------------------------------------------------------------------
function PipelineStepper() {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="h-4 w-4 text-emerald-500" />
          IPO Pipeline Stages
          <Badge
            variant="outline"
            className="ml-auto px-1.5 py-0 text-[10px] bg-muted/30 text-muted-foreground border-border/60"
          >
            lifecycle
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          className={cn(
            'flex items-stretch gap-1 overflow-x-auto pb-1',
            '[&::-webkit-scrollbar]:h-1.5',
            '[&::-webkit-scrollbar-track]:bg-transparent',
            '[&::-webkit-scrollbar-thumb]:rounded-full',
            '[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30',
            '[&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50',
          )}
        >
          {IPO_STAGES.map((stage, i) => {
            const Icon = stage.icon;
            const isLast = i === IPO_STAGES.length - 1;
            return (
              <div
                key={stage.label}
                className="flex items-center gap-1 min-w-[180px] flex-1"
              >
                <div className="flex-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-500">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500/80">
                      Stage {i + 1}
                    </div>
                  </div>
                  <div className="mt-1.5 text-sm font-semibold">{stage.label}</div>
                  <div className="text-[11px] text-muted-foreground leading-tight">
                    {stage.desc}
                  </div>
                </div>
                {!isLast && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ICO Risk Screening checklist (static informational)
// ---------------------------------------------------------------------------
function RiskScreeningCard() {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-amber-500" />
          Risk Screening Checklist
          <Badge
            variant="outline"
            className="ml-auto px-1.5 py-0 text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-500 gap-1"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            pending LLM
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid sm:grid-cols-2 gap-2.5">
          {ICO_RISK_CHECKS.map((c) => (
            <div
              key={c.label}
              className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-muted/15 px-3 py-2"
            >
              <CircleDashed className="h-4 w-4 text-amber-500/70 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-medium">{c.label}</div>
                <div className="text-[11px] text-muted-foreground leading-tight">
                  {c.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
          These fields will be auto-populated by the LLM diligence layer once a
          model is wired in <span className="font-mono">Settings</span>.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Single listing card
// ---------------------------------------------------------------------------
function ListingCard({
  item,
  index,
  accent,
}: {
  item: IpoIcoItem;
  index: number;
  accent: 'emerald' | 'amber';
}) {
  const isIPO = item.type === 'ipo';
  const accentText = accent === 'emerald' ? 'text-emerald-500' : 'text-amber-500';
  const accentBg = accent === 'emerald' ? 'bg-emerald-500/15' : 'bg-amber-500/15';
  const accentBorderHover =
    accent === 'emerald' ? 'hover:border-emerald-500/40' : 'hover:border-amber-500/40';
  const accentBgHover =
    accent === 'emerald'
      ? 'hover:bg-emerald-500/[0.02]'
      : 'hover:bg-amber-500/[0.02]';
  const accentBar =
    accent === 'emerald' ? 'bg-emerald-500' : 'bg-amber-500';
  const accentBadge =
    accent === 'emerald'
      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500'
      : 'bg-amber-500/10 border-amber-500/25 text-amber-500';

  const rel = relativeDate(item.date);
  const exact = exactDate(item.date);
  const Icon = isIPO ? Building2 : Coins;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: Math.min(index * 0.04, 0.4),
        duration: 0.3,
        ease: 'easeOut',
      }}
      className="h-full"
    >
      <Card
        className={cn(
          'relative h-full border-border/60 transition-all overflow-hidden group',
          accentBorderHover,
          accentBgHover,
        )}
      >
        {/* Left accent stripe */}
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 w-[3px] opacity-70 group-hover:opacity-100 transition-opacity',
            accentBar,
          )}
        />
        <CardContent className="p-4 pl-5 space-y-3">
          {/* Top row: type badge + source */}
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant="outline"
              className={cn('px-1.5 py-0 text-[10px] gap-1', accentBadge)}
            >
              <Icon className="h-3 w-3" />
              {isIPO ? 'IPO' : 'ICO'}
            </Badge>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
              <span className="truncate max-w-[160px] font-mono">
                {item.source || 'source'}
              </span>
            </div>
          </div>

          {/* Name + symbol */}
          <div className="space-y-0.5">
            <h3 className="font-semibold text-base leading-tight line-clamp-2">
              {item.name}
            </h3>
            {item.symbol && (
              <div className="text-[11px] text-muted-foreground font-mono">
                {item.symbol.toUpperCase()}
              </div>
            )}
          </div>

          {/* Assessment badge */}
          {item.assessment && (
            <div className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium',
              item.assessment === 'positive' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
              item.assessment === 'neutral' && 'border-amber-500/25 bg-amber-500/10 text-amber-500',
              item.assessment === 'negative' && 'border-rose-500/25 bg-rose-500/10 text-rose-500',
            )}>
              {item.assessment === 'positive' && <TrendingUp className="h-3 w-3" />}
              {item.assessment === 'neutral' && <CircleDashed className="h-3 w-3" />}
              {item.assessment === 'negative' && <AlertCircle className="h-3 w-3" />}
              {item.assessment === 'positive' ? 'Bullish' : item.assessment === 'negative' ? 'Bearish' : 'Neutral'}
            </div>
          )}

          {/* Assessment reasoning / details */}
          {(item.assessmentReason || item.details) && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {item.assessmentReason || item.details}
            </p>
          )}

          {/* Price + valuation row */}
          {(item.offerPrice || item.valuation) && (
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              {item.offerPrice && (
                <span className="flex items-center gap-1 font-mono text-foreground/80">
                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                  {item.offerPrice}
                </span>
              )}
              {item.valuation && (
                <span className="flex items-center gap-1 font-mono text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  {item.valuation}
                </span>
              )}
            </div>
          )}

          <Separator className="bg-border/50" />

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5" title={exact}>
              <CalendarDays className="h-3 w-3" />
              {rel}
            </span>
            {item.exchange && (
              <span className="flex items-center gap-1.5">
                <Building2 className="h-3 w-3" />
                {item.exchange}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {item.url && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] gap-1.5 ml-auto"
                asChild
              >
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open source for ${item.name}`}
                >
                  Open source
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton card
// ---------------------------------------------------------------------------
function ListingSkeleton() {
  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-4 pl-5 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-12 rounded" />
          <Skeleton className="h-3 w-20 rounded" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-3 w-1/3 rounded" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-5/6 rounded" />
        </div>
        <Separator className="bg-border/40" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Skeleton className="h-7 w-20 rounded" />
          <Skeleton className="h-7 w-24 rounded ml-auto" />
        </div>
      </CardContent>
    </Card>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Error card with retry
// ---------------------------------------------------------------------------
function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border-rose-500/30 bg-rose-500/[0.04]">
      <CardContent className="p-6 flex flex-col items-center text-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-500">
          <AlertCircle className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-rose-500">
            Failed to load live feed
          </h3>
          <p className="text-xs text-muted-foreground max-w-md">{message}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyState() {
  return (
    <Card className="border-dashed border-border/60">
      <CardContent className="p-8 flex flex-col items-center text-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
          <Newspaper className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">No upcoming listings found</h3>
          <p className="text-xs text-muted-foreground max-w-sm">
            No new IPOs or ICOs detected in the latest scan. Try refreshing in a
            moment — the feed updates every 10 minutes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Build summary stats from items
// ---------------------------------------------------------------------------
function buildSummaryStats(
  ipos: IpoIcoItem[],
  icos: IpoIcoItem[],
  kind: 'ipo' | 'ico',
) {
  const items = kind === 'ipo' ? ipos : icos;
  const sources = new Set<string>();
  let mostRecent: Date | null = null;
  for (const it of items) {
    if (it.source) sources.add(it.source);
    const d = safeDate(it.date);
    if (d && (!mostRecent || d > mostRecent)) mostRecent = d;
  }
  return {
    total: items.length,
    sources: sources.size,
    mostRecent: mostRecent
      ? formatDistanceToNow(mostRecent, { addSuffix: true })
      : '—',
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function IpoIcoClient() {
  const [tab, setTab] = useState<TabKey>('ipo');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['ipo-ico', tab],
    queryFn: () => fetchIpoIco(tab),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });

  const handleRefresh = () => {
    refetch();
    toast.success('Refreshing live feed…', {
      description: 'Pulling latest IPO & ICO listings from web search.',
    });
  };

  // Build the combined feed for "All" tab
  const combinedFeed = useMemo<IpoIcoItem[]>(() => {
    if (!data) return [];
    const all = [...data.ipos, ...data.icos];
    const q = search.trim().toLowerCase();
    const filtered = feedFilter === 'all' ? all : all.filter((i) => i.type === feedFilter);
    if (!q) return filtered;
    return filtered.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.symbol ?? '').toLowerCase().includes(q) ||
        (i.source ?? '').toLowerCase().includes(q) ||
        (i.exchange ?? '').toLowerCase().includes(q) ||
        i.details.toLowerCase().includes(q),
    );
  }, [data, feedFilter, search]);

  const ipoStats = useMemo(
    () => (data ? buildSummaryStats(data.ipos, data.icos, 'ipo') : null),
    [data],
  );
  const icoStats = useMemo(
    () => (data ? buildSummaryStats(data.ipos, data.icos, 'ico') : null),
    [data],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              LIVE · auto-refresh every 10 min
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2.5">
              <CalendarDays className="h-7 w-7 text-emerald-500" />
              IPO &amp; ICO Intelligence
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Upcoming stock listings + new crypto token launches — tracked and
              analyzed in real time via live web search.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="gap-1.5 shrink-0"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </motion.div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabKey)}
        className="space-y-5"
      >
        <TabsList className="w-full sm:w-auto overflow-x-auto">
          <TabsTrigger value="ipo" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            IPO (Stocks)
          </TabsTrigger>
          <TabsTrigger value="ico" className="gap-1.5">
            <Coins className="h-3.5 w-3.5" />
            ICO (Crypto)
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            All
          </TabsTrigger>
        </TabsList>

        {/* ----------------------------- IPO TAB ----------------------------- */}
        <TabsContent value="ipo" className="space-y-5">
          {/* Summary strip */}
          {ipoStats && (
            <SummaryStrip
              accent="bg-emerald-500/15 text-emerald-500"
              items={[
                {
                  label: 'Total IPOs',
                  value: ipoStats.total,
                  icon: Building2,
                  accent: 'bg-emerald-500/15 text-emerald-500',
                },
                {
                  label: 'Sources',
                  value: ipoStats.sources,
                  icon: Newspaper,
                  accent: 'bg-emerald-500/15 text-emerald-500',
                },
                {
                  label: 'Most Recent',
                  value: ipoStats.mostRecent,
                  icon: Clock,
                  accent: 'bg-emerald-500/15 text-emerald-500',
                },
              ]}
            />
          )}

          {/* Pipeline stages */}
          <PipelineStepper />

          {/* IPO cards */}
          {isLoading ? (
            <CardGrid>
              {Array.from({ length: 6 }).map((_, i) => (
                <ListingSkeleton key={i} />
              ))}
            </CardGrid>
          ) : isError ? (
            <ErrorState
              message={error?.message || 'Unknown error fetching IPO feed.'}
              onRetry={() => refetch()}
            />
          ) : !data || data.ipos.length === 0 ? (
            <EmptyState />
          ) : (
            <CardGrid>
              {data.ipos.map((item, i) => (
                <ListingCard key={`ipo-${i}-${item.name}`} item={item} index={i} accent="emerald" />
              ))}
            </CardGrid>
          )}
        </TabsContent>

        {/* ----------------------------- ICO TAB ----------------------------- */}
        <TabsContent value="ico" className="space-y-5">
          {/* Summary strip */}
          {icoStats && (
            <SummaryStrip
              accent="bg-amber-500/15 text-amber-500"
              items={[
                {
                  label: 'Total ICOs',
                  value: icoStats.total,
                  icon: Coins,
                  accent: 'bg-amber-500/15 text-amber-500',
                },
                {
                  label: 'Sources',
                  value: icoStats.sources,
                  icon: Newspaper,
                  accent: 'bg-amber-500/15 text-amber-500',
                },
                {
                  label: 'Most Recent',
                  value: icoStats.mostRecent,
                  icon: Clock,
                  accent: 'bg-amber-500/15 text-amber-500',
                },
              ]}
            />
          )}

          {/* Risk screening */}
          <RiskScreeningCard />

          {/* ICO cards */}
          {isLoading ? (
            <CardGrid>
              {Array.from({ length: 6 }).map((_, i) => (
                <ListingSkeleton key={i} />
              ))}
            </CardGrid>
          ) : isError ? (
            <ErrorState
              message={error?.message || 'Unknown error fetching ICO feed.'}
              onRetry={() => refetch()}
            />
          ) : !data || data.icos.length === 0 ? (
            <EmptyState />
          ) : (
            <CardGrid>
              {data.icos.map((item, i) => (
                <ListingCard key={`ico-${i}-${item.name}`} item={item} index={i} accent="amber" />
              ))}
            </CardGrid>
          )}
        </TabsContent>

        {/* ----------------------------- ALL TAB ----------------------------- */}
        <TabsContent value="all" className="space-y-5">
          {/* Combined summary + filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'ipo', 'ico'] as FeedFilter[]).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={feedFilter === f ? 'default' : 'outline'}
                  onClick={() => setFeedFilter(f)}
                  className="h-8 text-[11px] gap-1.5"
                >
                  {f === 'ipo' && <Building2 className="h-3 w-3" />}
                  {f === 'ico' && <Coins className="h-3 w-3" />}
                  {f === 'all' && <Activity className="h-3 w-3" />}
                  {f === 'all' ? 'All' : f.toUpperCase()}
                </Button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, source, details…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          {data && (
            <SummaryStrip
              accent="bg-emerald-500/15 text-emerald-500"
              items={[
                {
                  label: 'IPOs in feed',
                  value: data.ipos.length,
                  icon: Building2,
                  accent: 'bg-emerald-500/15 text-emerald-500',
                },
                {
                  label: 'ICOs in feed',
                  value: data.icos.length,
                  icon: Coins,
                  accent: 'bg-amber-500/15 text-amber-500',
                },
                {
                  label: 'Shown now',
                  value: combinedFeed.length,
                  icon: Activity,
                  accent: 'bg-emerald-500/15 text-emerald-500',
                },
              ]}
            />
          )}

          {/* Combined cards */}
          {isLoading ? (
            <CardGrid>
              {Array.from({ length: 6 }).map((_, i) => (
                <ListingSkeleton key={i} />
              ))}
            </CardGrid>
          ) : isError ? (
            <ErrorState
              message={error?.message || 'Unknown error fetching combined feed.'}
              onRetry={() => refetch()}
            />
          ) : combinedFeed.length === 0 ? (
            <EmptyState />
          ) : (
            <CardGrid>
              {combinedFeed.map((item, i) => (
                <ListingCard
                  key={`${item.type}-${i}-${item.name}`}
                  item={item}
                  index={i}
                  accent={item.type === 'ipo' ? 'emerald' : 'amber'}
                />
              ))}
            </CardGrid>
          )}
        </TabsContent>
      </Tabs>

      {/* Bottom callout — multi-LLM future */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 flex items-start gap-3"
      >
        <Sparkles className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Deep AI analysis is on the way</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The <span className="font-mono">Analyze</span> button on each card
            will eventually run a multi-LLM diligence pass (Gemini, Groq, NVIDIA
            NIM, Mistral, OpenRouter) covering fundamentals, tokenomics, on-chain
            risk, and post-listing performance forecasts. Wire a model in{' '}
            <span className="font-mono">Settings</span> to enable it.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
