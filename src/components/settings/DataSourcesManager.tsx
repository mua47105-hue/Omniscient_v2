'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  Save,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  KeyRound,
  Newspaper,
  Coins,
  Landmark,
  BarChart3,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ApiResult } from '@/lib/types';

// ----- Types -----
type SettingsMap = Record<string, any>;

interface DataSourceDef {
  key: string;
  name: string;
  description: string;
  link: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  purpose: string;
}

const SOURCES: DataSourceDef[] = [
  {
    key: 'finnhub_api_key',
    name: 'Finnhub',
    description: 'Real-time forex, commodities, stocks, news. Free 60 calls/min.',
    link: 'https://finnhub.io/register',
    icon: BarChart3,
    accent: 'text-emerald-500',
    purpose: 'Forex · Stocks · News',
  },
  {
    key: 'alpha_vantage_api_key',
    name: 'Alpha Vantage',
    description: 'Forex, stocks, commodities, economic indicators. Free 25 calls/day.',
    link: 'https://www.alphavantage.co/support/#api-key',
    icon: Landmark,
    accent: 'text-teal-500',
    purpose: 'Forex · Macro',
  },
  {
    key: 'coingecko_api_key',
    name: 'CoinGecko',
    description: 'Crypto prices, market data, on-chain metrics. Demo API free.',
    link: 'https://www.coingecko.com/api/pricing',
    icon: Coins,
    accent: 'text-amber-500',
    purpose: 'Crypto · On-chain',
  },
  {
    key: 'fmp_api_key',
    name: 'FMP',
    description: 'Financial Modeling Prep — fundamentals, IPO calendar, filings.',
    link: 'https://site.financialmodelingprep.com/developer/docs',
    icon: Database,
    accent: 'text-rose-500',
    purpose: 'Fundamentals · IPOs',
  },
  {
    key: 'news_api_key',
    name: 'News API',
    description: 'Aggregated global news headlines. Free 100 requests/day.',
    link: 'https://newsapi.org/register',
    icon: Newspaper,
    accent: 'text-yellow-500',
    purpose: 'News · Sentiment',
  },
];

// ----- Helpers -----
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j: ApiResult<T> = await r.json().catch(() => ({ success: false, error: 'Invalid JSON' }) as any);
  if (!j.success) throw new Error(j.error ?? 'Request failed');
  return j.data as T;
}

const isPlaceholder = (v: any) => !v || String(v).startsWith('PASTE_') || String(v).includes('YOUR_');

// ----- Main -----
export function DataSourcesManager() {
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const s = await api<SettingsMap>('/api/settings');
      setSettings(s);
    } catch (e: any) {
      toast.error('Failed to load data source settings', { description: e.message });
      setSettings({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-muted/40 animate-pulse" />
        ))}
      </div>
    );
  }

  const configuredCount = SOURCES.filter((s) => {
    const v = settings?.[s.key];
    return v && !isPlaceholder(v);
  }).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Data Sources</h1>
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-500">
            <Database className="h-3 w-3" /> {configuredCount}/{SOURCES.length} configured
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          API keys for market-data feeds. Crypto uses Binance (no key needed). Forex, stocks, commodities, news, and fundamentals need the keys below.
        </p>
      </div>

      {/* Quick status overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {SOURCES.map((s) => {
          const v = settings?.[s.key];
          const ready = v && !isPlaceholder(v);
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className={cn(
                'rounded-lg border px-3 py-2.5 flex flex-col gap-1.5',
                ready ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'border-border bg-muted/30'
              )}
            >
              <div className="flex items-center justify-between">
                <Icon className={cn('h-4 w-4', ready ? s.accent : 'text-muted-foreground')} />
                {ready ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/60" />
                )}
              </div>
              <div className="text-xs font-medium truncate">{s.name}</div>
              <div className="text-[10px] text-muted-foreground">{s.purpose}</div>
            </div>
          );
        })}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {SOURCES.map((s, i) => (
          <motion.div
            key={s.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.25 }}
          >
            <DataSourceCard def={s} currentValue={settings?.[s.key] ?? ''} onSaved={reload} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ----- Single Data Source Card -----
function DataSourceCard({
  def,
  currentValue,
  onSaved,
}: {
  def: DataSourceDef;
  currentValue: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(currentValue ?? '');
  }, [currentValue]);

  const isSet = !!currentValue && !isPlaceholder(currentValue);
  const dirty = value !== (currentValue ?? '');

  const Icon = def.icon;

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: def.key, value: value.trim() }),
      });
      toast.success(`${def.name} key saved`);
      onSaved();
    } catch (e: any) {
      toast.error('Failed to save', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={cn('border-border/60', isSet && 'border-emerald-500/30')}>
      <CardContent className="py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          {/* Left: icon + meta */}
          <div className="flex items-start gap-3 min-w-0 md:max-w-md">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                isSet ? 'bg-emerald-500/15' : 'bg-muted/60'
              )}
            >
              <Icon className={cn('h-5 w-5', isSet ? def.accent : 'text-muted-foreground')} />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{def.name}</h3>
                {isSet ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-[10px] gap-1">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Set
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-border text-muted-foreground text-[10px] gap-1">
                    <AlertTriangle className="h-2.5 w-2.5" /> Not set
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{def.description}</p>
              <a
                href={def.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-emerald-500 hover:underline"
              >
                Get API key <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* Right: input + save */}
          <div className="flex flex-col sm:flex-row gap-2 md:w-[420px] shrink-0">
            <div className="relative flex-1">
              <Input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isSet ? '••••••••••••••••' : `Paste ${def.name} API key…`}
                className={cn(
                  'pr-10 font-mono text-xs',
                  dirty && 'border-emerald-500/50'
                )}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? 'Hide' : 'Show'}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              onClick={save}
              disabled={saving || !dirty}
              size="sm"
              className={cn(
                'gap-1.5 shrink-0',
                dirty && 'bg-emerald-600 hover:bg-emerald-700 text-white'
              )}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
