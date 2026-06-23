'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity, CheckCircle2, XCircle, Clock, Zap, ArrowRight, Brain,
  TrendingUp, Newspaper, Globe, RefreshCw, Layers, AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ApiResult } from '@/lib/types';

interface LlmActivityEntry {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  module: string;
  asset?: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  fallbackUsed: boolean;
  primaryProvider?: string;
  promptTokens?: number;
  completionTokens?: number;
  contentPreview?: string;
}

interface LlmStats {
  totalCalls: number;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  fallbackCount: number;
  byProvider: Record<string, { calls: number; success: number; fail: number; avgLatencyMs: number }>;
  byModule: Record<string, { calls: number; success: number; fail: number }>;
}

interface ActivityResponse {
  entries: LlmActivityEntry[];
  stats: LlmStats;
}

async function fetchActivity(): Promise<ActivityResponse> {
  const r = await fetch('/api/llm/activity');
  const j: ApiResult<ActivityResponse> = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to fetch activity');
  return j.data as ActivityResponse;
}

const MODULE_ICONS: Record<string, typeof Brain> = {
  crypto_technical: TrendingUp,
  news_sentiment: Newspaper,
  macro_analysis: Globe,
  brain: Brain,
  test: Zap,
  unknown: Activity,
};

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function latencyColor(ms: number): string {
  if (ms < 500) return 'text-emerald-500';
  if (ms < 2000) return 'text-amber-500';
  return 'text-rose-500';
}

export function LlmActivityClient() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['llm-activity'],
    queryFn: fetchActivity,
    refetchInterval: 5000,
  });

  const entries = data?.entries ?? [];
  const stats = data?.stats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">LLM Activity</h1>
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Track every LLM call in real-time — see which provider serves each request, latency, and fallback chain
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Total Calls"
            value={stats.totalCalls.toString()}
            icon={<Activity className="h-4 w-4" />}
            accent="text-sky-500"
          />
          <StatCard
            label="Success Rate"
            value={stats.totalCalls > 0 ? `${Math.round((stats.successCount / stats.totalCalls) * 100)}%` : '—'}
            subtitle={`${stats.successCount}/${stats.totalCalls}`}
            icon={<CheckCircle2 className="h-4 w-4" />}
            accent="text-emerald-500"
          />
          <StatCard
            label="Failures"
            value={stats.failCount.toString()}
            icon={<XCircle className="h-4 w-4" />}
            accent={stats.failCount > 0 ? 'text-rose-500' : 'text-muted-foreground'}
          />
          <StatCard
            label="Avg Latency"
            value={stats.avgLatencyMs > 0 ? `${stats.avgLatencyMs}ms` : '—'}
            icon={<Clock className="h-4 w-4" />}
            accent={latencyColor(stats.avgLatencyMs)}
          />
          <StatCard
            label="Fallbacks"
            value={stats.fallbackCount.toString()}
            subtitle={stats.fallbackCount > 0 ? 'primary failed' : undefined}
            icon={<ArrowRight className="h-4 w-4" />}
            accent={stats.fallbackCount > 0 ? 'text-amber-500' : 'text-muted-foreground'}
          />
        </div>
      )}

      {/* Provider breakdown */}
      {stats && Object.keys(stats.byProvider).length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-500" />
              Provider Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(stats.byProvider)
                .sort(([, a], [, b]) => b.calls - a.calls)
                .map(([name, p]) => (
                  <div key={name} className="rounded-lg border border-border/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {p.calls} {p.calls === 1 ? 'call' : 'calls'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-emerald-500 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {p.success}
                      </span>
                      {p.fail > 0 && (
                        <span className="text-rose-500 flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          {p.fail}
                        </span>
                      )}
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {p.avgLatencyMs}ms avg
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity feed */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-500" />
            Recent Calls
            <span className="text-xs font-normal text-muted-foreground ml-1">(last 50, auto-refresh 5s)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Activity className="h-8 w-8 opacity-30" />
              <span>No LLM calls yet</span>
              <span className="text-xs">Calls will appear here when the brain runs analysis or you test a provider</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {entries.map((entry, i) => {
                const ModuleIcon = MODULE_ICONS[entry.module] || Activity;
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.2) }}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                      entry.success
                        ? 'border-border/40 hover:border-emerald-500/30'
                        : 'border-rose-500/20 bg-rose-500/[0.03]'
                    )}
                  >
                    {/* Status icon */}
                    <div className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      entry.success
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-rose-500/10 text-rose-500'
                    )}>
                      {entry.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Module icon */}
                        <ModuleIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-semibold">{entry.provider}</span>
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                          {entry.model}
                        </span>
                        {entry.fallbackUsed && (
                          <Badge variant="outline" className="text-[9px] gap-0.5 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            <ArrowRight className="h-2.5 w-2.5" />
                            fallback
                          </Badge>
                        )}
                        {entry.asset && (
                          <Badge variant="outline" className="text-[9px] font-mono">
                            {entry.asset}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[9px]">
                          {entry.module}
                        </Badge>
                      </div>

                      {/* Details */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span className={latencyColor(entry.latencyMs)}>
                            {entry.latencyMs > 0 ? `${entry.latencyMs}ms` : '—'}
                          </span>
                        </span>
                        {entry.promptTokens !== undefined && (
                          <span className="flex items-center gap-1">
                            <Zap className="h-3 w-3" />
                            {entry.promptTokens + (entry.completionTokens || 0)} tokens
                          </span>
                        )}
                        <span>{timeAgo(entry.timestamp)}</span>
                      </div>

                      {/* Error or content preview */}
                      {entry.error ? (
                        <p className="text-xs text-rose-500 truncate">{entry.error}</p>
                      ) : entry.contentPreview ? (
                        <p className="text-xs text-muted-foreground truncate font-mono">
                          "{entry.contentPreview}"
                        </p>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  icon,
  accent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className={accent}>{icon}</span>
        </div>
        <div className="text-xl font-bold tabular-nums">{value}</div>
        {subtitle && <div className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</div>}
      </CardContent>
    </Card>
  );
}
