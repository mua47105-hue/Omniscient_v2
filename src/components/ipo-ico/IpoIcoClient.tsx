'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Rocket, Sparkles, Calendar, Building2, Coins } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IpoIcoItem {
  id: string;
  type: string;
  name: string;
  symbol?: string | null;
  date?: string | null;
  exchange?: string | null;
  details: string;
  analysis?: string | null;
  createdAt: string;
}

interface IpoIcoResponse {
  success?: boolean;
  data?: IpoIcoItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso?: string | null): string {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'TBD';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.max(0, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function parseDetails(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IpoIcoClient(): React.ReactElement {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<'all' | 'ipo' | 'ico'>('all');

  const q = useQuery<IpoIcoItem[]>({
    queryKey: ['ipo-ico', filter],
    queryFn: async () => {
      const url =
        filter === 'all' ? '/api/ipo-ico?limit=50' : `/api/ipo-ico?type=${filter}&limit=50`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('ipo-ico fetch failed');
      const json: IpoIcoResponse = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  const analyzeMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/ipo-ico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, analyze: true }),
      });
      if (!res.ok) throw new Error('analyze failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ipo-ico', filter] });
    },
  });

  const items = q.data ?? [];
  const ipoCount = items.filter((i) => i.type === 'ipo').length;
  const icoCount = items.filter((i) => i.type === 'ico').length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">IPO / ICO</h1>
          <p className="text-xs text-muted-foreground">
            Upcoming initial offerings. Click analyze to run LLM-based investment thesis
            generation.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
          {(['all', 'ipo', 'ico'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded px-3 py-1 text-[11px] font-semibold uppercase transition-colors',
                filter === f
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="ring-1 ring-inset ring-border/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Total
              </span>
              <Rocket className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">{items.length}</div>
          </CardContent>
        </Card>
        <Card className="border-sky-500/30 ring-1 ring-inset ring-border/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                IPOs
              </span>
              <Building2 className="h-4 w-4 text-sky-300" />
            </div>
            <div className="mt-2 text-2xl font-bold text-sky-300">{ipoCount}</div>
          </CardContent>
        </Card>
        <Card className="border-violet-500/30 ring-1 ring-inset ring-border/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                ICOs
              </span>
              <Coins className="h-4 w-4 text-violet-300" />
            </div>
            <div className="mt-2 text-2xl font-bold text-violet-300">{icoCount}</div>
          </CardContent>
        </Card>
      </div>

      {q.isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Loading offerings…
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Rocket className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              No upcoming {filter === 'all' ? 'offerings' : filter.toUpperCase()}s in the database.
              Use the API or seed script to add entries.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <IpoIcoCard
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
// IpoIcoCard
// ---------------------------------------------------------------------------

function IpoIcoCard({
  item,
  onAnalyze,
  analyzing,
}: {
  item: IpoIcoItem;
  onAnalyze: () => void;
  analyzing: boolean;
}): React.ReactElement {
  const details = parseDetails(item.details);
  const [expanded, setExpanded] = React.useState(false);
  const isIpo = item.type === 'ipo';
  const accent = isIpo ? 'text-sky-300' : 'text-violet-300';
  const borderAccent = isIpo ? 'border-sky-500/30' : 'border-violet-500/30';

  return (
    <Card className={cn('ring-1 ring-inset ring-border/30', borderAccent)}>
      <CardContent className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isIpo ? 'info' : 'violet'} className="text-[10px] uppercase">
              {item.type}
            </Badge>
            <span className="text-sm font-semibold text-foreground">{item.name}</span>
            {item.symbol ? (
              <span className={cn('font-mono text-xs', accent)}>${item.symbol}</span>
            ) : null}
            {item.exchange ? (
              <Badge variant="muted" className="text-[10px]">
                {item.exchange}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {fmtDate(item.date)}
            </span>
            <span>added {fmtAgo(item.createdAt)}</span>
          </div>
          {Object.keys(details).length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(details).slice(0, 6).map(([k, v]) => (
                <div key={k} className="rounded border border-border bg-muted/20 px-2 py-1">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
                  <div className="font-mono text-[11px] text-foreground">
                    {typeof v === 'string' || typeof v === 'number' ? String(v) : '—'}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {item.analysis ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] text-primary hover:underline"
              >
                {expanded ? 'Hide analysis' : 'Show LLM analysis'}
              </button>
              {expanded ? (
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-muted/20 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  {item.analysis}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center lg:pl-4">
          <Button
            variant={item.analysis ? 'outline' : 'default'}
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={onAnalyze}
            disabled={analyzing}
          >
            <Sparkles className="h-3 w-3" />
            {analyzing ? 'Analyzing…' : item.analysis ? 'Re-analyze' : 'Analyze'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
