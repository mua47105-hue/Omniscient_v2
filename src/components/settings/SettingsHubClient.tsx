'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Cpu,
  ListChecks,
  BellRing,
  Database,
  Cloud,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ApiResult } from '@/lib/types';

// Local types matching Prisma models (only the fields we need)
interface LlmModelLite {
  id: string;
  isActive: boolean;
}
interface LlmProviderLite {
  id: string;
  name: string;
  isActive: boolean;
  apiKey: string;
  models: LlmModelLite[];
}
interface WatchlistLite {
  id: string;
  name: string;
  isActive: boolean;
  symbols: string; // JSON string
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const j: ApiResult<T> = await r.json();
  if (!j.success) throw new Error(j.error);
  return j.data as T;
}

export function SettingsHubClient() {
  const [providers, setProviders] = useState<LlmProviderLite[] | null>(null);
  const [watchlists, setWatchlists] = useState<WatchlistLite[] | null>(null);
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pRes, wRes, sRes] = await Promise.all([
          fetch('/api/llm/providers', { cache: 'no-store' }),
          fetch('/api/watchlists', { cache: 'no-store' }),
          fetch('/api/settings', { cache: 'no-store' }),
        ]);
        if (cancelled) return;

        // Parse each response, handling non-JSON (HTML error) gracefully
        const safeParse = async (res: Response) => {
          if (!res.ok) return null;
          const text = await res.text();
          try { return JSON.parse(text); } catch { return null; }
        };

        const p = await safeParse(pRes);
        const w = await safeParse(wRes);
        const s = await safeParse(sRes);

        setProviders(p?.success ? p.data : []);
        setWatchlists(w?.success ? w.data : []);
        setSettings(s?.success ? s.data : {});
      } catch (e: any) {
        if (!cancelled) {
          setErr(e.message ?? 'Failed to load settings summary');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !providers || !watchlists || !settings;

  // Provider status — "ready" = active AND apiKey doesn't look like the placeholder
  const isKeyPlaceholder = (k: string) => !k || k.startsWith('PASTE_') || k.includes('YOUR_');
  const providersReady = (providers ?? []).filter((p) => p.isActive && !isKeyPlaceholder(p.apiKey)).length;
  const providersTotal = (providers ?? []).length;
  const modelsTotal = (providers ?? []).reduce((s, p) => s + (p.models?.length ?? 0), 0);

  const activeWatchlists = (watchlists ?? []).filter((w) => w.isActive).length;
  const watchlistsTotal = (watchlists ?? []).length;
  const watchlistSymbols = (watchlists ?? []).reduce((s, w) => {
    try {
      return s + (JSON.parse(w.symbols) as string[]).length;
    } catch {
      return s;
    }
  }, 0);

  const telegramConnected =
    !!settings?.telegram_bot_token &&
    !String(settings.telegram_bot_token).startsWith('PASTE_') &&
    !!settings?.telegram_chat_id;

  const dataSourcesConfigured = [
    'finnhub_api_key',
    'alpha_vantage_api_key',
    'coingecko_api_key',
    'fmp_api_key',
    'news_api_key',
  ].filter((k) => {
    const v = settings?.[k];
    return v && !String(v).startsWith('PASTE_') && !String(v).includes('YOUR_');
  }).length;

  const supabaseUrl = settings?.supabase_url;
  const supabaseKey = settings?.supabase_anon_key;
  const supabaseConfigured =
    !!supabaseUrl &&
    !String(supabaseUrl).startsWith('PASTE_') &&
    !!supabaseKey &&
    !String(supabaseKey).startsWith('PASTE_');

  type StatusTone = 'ok' | 'warn' | 'partial';
  interface CardDef {
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    status: { label: string; tone: StatusTone } | null;
    detail: string | null;
  }
  const cards: CardDef[] = [
    {
      href: '/settings/providers',
      icon: Cpu,
      title: 'LLM Providers',
      description: 'Wire up Gemini, Groq, NVIDIA NIM, Mistral, OpenRouter. Paste API keys, test models, toggle active.',
      status: loading ? null : {
        label: `${providersReady} of ${providersTotal} ready`,
        tone: providersReady === 0 ? 'warn' : providersReady === providersTotal ? 'ok' : 'partial',
      },
      detail: loading ? null : `${modelsTotal} models configured`,
    },
    {
      href: '/settings/watchlists',
      icon: ListChecks,
      title: 'Watchlists',
      description: 'Group assets by class. Control which symbols the scanner monitors each cycle.',
      status: loading ? null : {
        label: `${activeWatchlists} active`,
        tone: activeWatchlists === 0 ? 'warn' : 'ok',
      },
      detail: loading ? null : `${watchlistsTotal} list${watchlistsTotal === 1 ? '' : 's'} · ${watchlistSymbols} symbols`,
    },
    {
      href: '/settings/alerts',
      icon: BellRing,
      title: 'Alerts & Telegram',
      description: 'Connect Telegram bot, set default conviction threshold, override per-asset.',
      status: loading ? null : {
        label: telegramConnected ? 'Telegram connected' : 'Not connected',
        tone: telegramConnected ? 'ok' : 'warn',
      },
      detail: null,
    },
    {
      href: '/settings/data-sources',
      icon: Database,
      title: 'Data Sources',
      description: 'API keys for Finnhub, Alpha Vantage, CoinGecko, FMP, News API — for forex, stocks, news, fundamentals.',
      status: loading ? null : {
        label: `${dataSourcesConfigured} of 5 keys`,
        tone: dataSourcesConfigured === 0 ? 'warn' : dataSourcesConfigured === 5 ? 'ok' : 'partial',
      },
      detail: null,
    },
    {
      href: '/settings/supabase',
      icon: Cloud,
      title: 'Supabase',
      description: 'Connect your Supabase project. Enter Project URL + anon key, then run the SQL schema to create all tables.',
      status: loading ? null : {
        label: supabaseConfigured ? 'Configured' : 'Not connected',
        tone: supabaseConfigured ? 'ok' : 'warn',
      },
      detail: loading ? null : supabaseConfigured ? 'Cloud persistence active' : 'Using local SQLite',
    },
    {
      href: '/settings/security',
      icon: Lock,
      title: 'Security',
      description: 'Set the password that locks access to your dashboard. Default password is "omniscient".',
      status: loading ? null : {
        label: 'Protected',
        tone: 'ok',
      },
      detail: null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Settings</h1>
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-500">
            Configuration Hub
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Wire up LLM providers, manage watchlists, configure alerts, and connect data-source APIs.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
          {err}
        </div>
      )}

      {/* Cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={c.href}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.3 }}
            >
              <Link href={c.href} className="block h-full group">
                <Card className="h-full border-border/60 hover:border-emerald-500/40 hover:bg-emerald-500/[0.02] transition-all cursor-pointer">
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-500 group-hover:scale-110 transition-transform">
                        <Icon className="h-5 w-5" />
                      </div>
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : c.status ? (
                        <StatusBadge tone={c.status.tone} label={c.status.label} />
                      ) : null}
                    </div>
                    <CardTitle className="text-base flex items-center gap-1.5">
                      {c.title}
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                    </CardTitle>
                    <CardDescription className="text-xs leading-relaxed">{c.description}</CardDescription>
                  </CardHeader>
                  {c.detail && (
                    <CardContent className="pt-0">
                      <p className="text-xs text-muted-foreground">{c.detail}</p>
                    </CardContent>
                  )}
                </Card>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Quick start panel */}
      <Card className="border-border/60 bg-gradient-to-br from-emerald-500/[0.04] to-transparent">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-500">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
                Setup checklist
              </h3>
              <p className="text-xs text-muted-foreground">
                Get the system producing signals in 4 steps. Each card above maps to a step.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ChecklistItem done={!loading && providersReady > 0} label="1 LLM key" />
              <ChecklistItem done={!loading && activeWatchlists > 0} label="Watchlist" />
              <ChecklistItem done={telegramConnected} label="Telegram" />
              <ChecklistItem done={!loading && dataSourcesConfigured > 0} label="Data source" />
              <ChecklistItem done={supabaseConfigured} label="Supabase" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ tone, label }: { tone: 'ok' | 'warn' | 'partial'; label: string }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'partial' ? CircleDashed : AlertTriangle;
  const cls =
    tone === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
      : tone === 'partial'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-500';
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', cls)}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
        done
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
          : 'border-border bg-muted/40 text-muted-foreground'
      )}
    >
      {done ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
      {label}
    </div>
  );
}
