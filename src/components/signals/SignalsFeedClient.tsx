'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Target,
  Layers3,
  Sparkles,
  Bot,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shapes — the /api/signals route returns the Prisma Signal model
// (with the `asset` relation included) wrapped in { success, data }.
// layersSummary and modelsUsed are JSON-encoded strings (TEXT columns).
// ---------------------------------------------------------------------------

interface AssetLite {
  symbol: string;
  name?: string;
  assetClass?: string;
}

interface LayerEntry {
  layer?: string;
  direction?: string;
  score?: number;
  confidence?: number;
  weight?: number;
  rationale?: string;
}

interface SignalRow {
  id?: string;
  assetId?: string;
  asset?: AssetLite;
  symbol?: string; // fallback if asset relation is missing
  timestamp?: string | number;
  direction: string; // Prisma stores as String
  conviction: number;
  timeframe?: string;
  layersSummary?: string; // JSON
  modelsUsed?: string; // JSON array
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  rationale?: string;
  status?: string;
  expiresAt?: string | number | null;
}

interface SignalsResponse {
  success?: boolean;
  data?: SignalRow[];
}

// ---------------------------------------------------------------------------
// parseTrigger — extracts [trigger:SOURCE] and [vol-target:X% rv:Y%] tags
// ---------------------------------------------------------------------------

interface ParsedRationale {
  source?: 'manual' | 'news' | 'cross-asset' | 'scheduler';
  volTarget?: { targetPct: number; realizedPct: number };
  clean: string;
}

function parseTrigger(rationale: string | undefined): ParsedRationale {
  if (!rationale) return { clean: '' };
  let clean = rationale;
  const out: ParsedRationale = { clean };

  // [trigger:manual|news|cross-asset]
  const triggerMatch = clean.match(/\[trigger:(manual|news|cross-asset|scheduler)\]/i);
  if (triggerMatch) {
    out.source = triggerMatch[1].toLowerCase() as ParsedRationale['source'];
    clean = clean.replace(triggerMatch[0], '').trim();
  }

  // [vol-target:X% rv:Y%]
  const volMatch = clean.match(/\[vol-target:([\d.]+)%\s+rv:([\d.]+)%\]/i);
  if (volMatch) {
    out.volTarget = {
      targetPct: parseFloat(volMatch[1]),
      realizedPct: parseFloat(volMatch[2]),
    };
    clean = clean.replace(volMatch[0], '').trim();
  }

  out.clean = clean;
  return out;
}

function parseLayers(raw: string | undefined): LayerEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as LayerEntry[];
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { layers?: unknown }).layers)) {
      return (parsed as { layers: LayerEntry[] }).layers;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function parseModels(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((m) => String(m));
  } catch {
    /* ignore */
  }
  return [];
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

type DirectionFilter = 'all' | 'long' | 'short' | 'neutral';
type SortKey = 'recent' | 'conviction';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SignalsFeedClient(): React.ReactElement {
  const [dirFilter, setDirFilter] = React.useState<DirectionFilter>('all');
  const [sortKey, setSortKey] = React.useState<SortKey>('recent');
  const [query, setQuery] = React.useState('');

  const signalsQ = useQuery<SignalRow[]>({
    queryKey: ['signals-feed'],
    queryFn: async () => {
      const res = await fetch('/api/signals');
      if (!res.ok) throw new Error('signals fetch failed');
      const json: SignalsResponse = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const allSignals = signalsQ.data ?? [];

  const filtered = React.useMemo(() => {
    let out = allSignals;
    if (dirFilter !== 'all') {
      out = out.filter((s) => s.direction === dirFilter);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter(
        (s) =>
          (s.asset?.symbol ?? s.symbol ?? '').toLowerCase().includes(q) ||
          (s.rationale ?? '').toLowerCase().includes(q),
      );
    }
    if (sortKey === 'conviction') {
      out = [...out].sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0));
    } else {
      out = [...out].sort((a, b) => {
        const ta = typeof a.timestamp === 'number' ? a.timestamp : Date.parse(a.timestamp ?? '');
        const tb = typeof b.timestamp === 'number' ? b.timestamp : Date.parse(b.timestamp ?? '');
        return (tb || 0) - (ta || 0);
      });
    }
    return out;
  }, [allSignals, dirFilter, query, sortKey]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Signal Feed</h1>
          <p className="text-xs text-muted-foreground">
            Live AI-graded trading signals. Trigger-source traceability + E1 vol-target sizing included.
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by symbol…"
          className="h-9 w-48 rounded-md border border-input bg-background/50 px-3 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
          {(['all', 'long', 'short', 'neutral'] as DirectionFilter[]).map((d) => (
            <Button
              key={d}
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 px-2.5 text-[11px] capitalize',
                dirFilter === d ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
              onClick={() => setDirFilter(d)}
            >
              {d}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
          {(['recent', 'conviction'] as SortKey[]).map((k) => (
            <Button
              key={k}
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 px-2.5 text-[11px] capitalize',
                sortKey === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
              onClick={() => setSortKey(k)}
            >
              {k}
            </Button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {filtered.length} of {allSignals.length}
        </span>
      </div>

      {/* Signal cards */}
      {signalsQ.isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Loading signals…
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            No signals match the current filter.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((s, i) => (
            <SignalCard key={s.id ?? `${s.asset?.symbol ?? s.symbol}-${i}`} signal={s} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignalCard
// ---------------------------------------------------------------------------

function SignalCard({ signal }: { signal: SignalRow }): React.ReactElement {
  const parsed = parseTrigger(signal.rationale);
  const layers = parseLayers(signal.layersSummary);
  const models = parseModels(signal.modelsUsed);

  const dir = (signal.direction ?? 'neutral') as 'long' | 'short' | 'neutral';
  const dirVariant =
    dir === 'long' ? 'success' : dir === 'short' ? 'rose' : 'muted';
  const DirIcon = dir === 'long' ? ArrowUp : dir === 'short' ? ArrowDown : ArrowRight;
  const conviction = signal.conviction ?? 0;

  const symbol = signal.asset?.symbol ?? signal.symbol ?? '?';
  const assetName = signal.asset?.name;

  const triggerVariant =
    parsed.source === 'news'
      ? 'warning'
      : parsed.source === 'cross-asset'
        ? 'violet'
        : parsed.source === 'manual'
          ? 'info'
          : 'muted';

  return (
    <Card className="overflow-hidden">
      <CardContent className="grid gap-3 p-4 lg:grid-cols-[200px_1fr_auto]">
        {/* Left column — asset + direction */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/crypto/${symbol.replace('USDT', '')}`}
              className="font-semibold text-foreground hover:underline"
            >
              {symbol.replace('USDT', '')}
            </Link>
            <Badge variant={dirVariant} className="capitalize">
              <DirIcon className="h-3 w-3" />
              {dir}
            </Badge>
          </div>
          {assetName ? (
            <span className="text-[10px] text-muted-foreground">{assetName}</span>
          ) : null}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Conviction</span>
              <span className="font-mono text-foreground">{conviction.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full',
                  dir === 'long'
                    ? 'bg-emerald-400'
                    : dir === 'short'
                      ? 'bg-rose-400'
                      : 'bg-muted-foreground',
                )}
                style={{
                  width: `${conviction}%`,
                  backgroundImage:
                    dir === 'long'
                      ? 'linear-gradient(90deg, oklch(0.65 0.18 160), oklch(0.78 0.18 160))'
                      : dir === 'short'
                        ? 'linear-gradient(90deg, oklch(0.65 0.22 25), oklch(0.75 0.22 25))'
                        : undefined,
                }}
              />
            </div>
          </div>
        </div>

        {/* Middle column — rationale + tags */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {parsed.source ? (
              <Badge variant={triggerVariant} className="text-[10px]">
                <Sparkles className="h-2.5 w-2.5" />
                Triggered by {parsed.source}
              </Badge>
            ) : null}
            {parsed.volTarget ? (
              <Badge variant="success" className="text-[10px]">
                <Target className="h-2.5 w-2.5" />
                Vol-target {parsed.volTarget.targetPct}% rv {parsed.volTarget.realizedPct}%
              </Badge>
            ) : null}
            {signal.timeframe ? (
              <Badge variant="muted" className="text-[10px]">
                {signal.timeframe}
              </Badge>
            ) : null}
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {parsed.clean || 'No rationale provided.'}
          </p>
          {layers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <Layers3 className="h-3 w-3 text-muted-foreground" />
              {layers.slice(0, 6).map((l, i) => (
                <Badge
                  key={i}
                  variant={
                    l.direction === 'long'
                      ? 'success'
                      : l.direction === 'short'
                        ? 'rose'
                        : 'muted'
                  }
                  className="text-[9px] capitalize"
                >
                  {l.layer ?? '?'}:{l.direction ?? '?'}
                </Badge>
              ))}
            </div>
          ) : null}
          {models.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <Bot className="h-3 w-3 text-muted-foreground" />
              {models.map((m, i) => (
                <span
                  key={i}
                  className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                >
                  {m}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right column — entry/SL/TP */}
        <div className="grid grid-cols-3 gap-2 text-[11px] lg:w-[260px]">
          <PriceCell label="Entry" value={signal.entryPrice ?? undefined} />
          <PriceCell label="SL" value={signal.stopLoss ?? undefined} tone="rose" />
          <PriceCell label="TP" value={signal.takeProfit ?? undefined} tone="emerald" />
        </div>
      </CardContent>
    </Card>
  );
}

function PriceCell({
  label,
  value,
  tone,
}: {
  label: string;
  value?: number;
  tone?: 'rose' | 'emerald';
}): React.ReactElement {
  const toneClass =
    tone === 'rose' ? 'text-rose-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-foreground';
  return (
    <div className="rounded border border-border bg-muted/20 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-xs', toneClass)}>
        {value != null ? value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}
      </div>
    </div>
  );
}

export { parseTrigger };
