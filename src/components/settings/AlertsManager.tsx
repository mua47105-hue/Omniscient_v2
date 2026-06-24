'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BellRing,
  Send,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Hash,
  Sliders,
  RotateCcw,
  ChevronDown,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ApiResult, Ticker, Direction } from '@/lib/types';

// ----- Types -----
type SettingsMap = Record<string, any>;

interface DefaultThreshold {
  minConviction: number;
  directions: Direction[];
}
type AlertThresholds = Record<string, { minConviction: number; directions: Direction[] }>;

// ----- Helpers -----
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (fetchErr: any) {
    // Browser fetch failed — connection dropped, timeout, or network error
    throw new Error(fetchErr.message || 'Network error — the server may be unreachable or the request timed out.');
  }
  const text = await r.text();
  let j: ApiResult<T>;
  try {
    j = JSON.parse(text);
  } catch {
    // Non-JSON response (HTML error page, empty body, etc.)
    throw new Error(`Server returned ${r.status} ${r.statusText} (non-JSON response)`);
  }
  if (!j.success) throw new Error(j.error ?? 'Request failed');
  return j.data as T;
}

const isPlaceholder = (v: any) => !v || String(v).startsWith('PASTE_') || String(v).includes('YOUR_');

// ----- Main -----
export function AlertsManager() {
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [tickers, setTickers] = useState<Ticker[] | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        api<SettingsMap>('/api/settings'),
        api<Ticker[]>('/api/crypto/prices').catch(() => [] as Ticker[]),
      ]);
      setSettings(s);
      setTickers(t);
    } catch (e: any) {
      toast.error('Failed to load alert settings', { description: e.message });
      setSettings({});
      setTickers([]);
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
          <div key={i} className="h-44 rounded-xl bg-muted/40 animate-pulse" />
        ))}
      </div>
    );
  }

  const telegramConnected =
    !!settings?.telegram_bot_token &&
    !isPlaceholder(settings.telegram_bot_token) &&
    !!settings?.telegram_chat_id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Alerts</h1>
          <Badge
            variant="outline"
            className={cn(
              'gap-1',
              telegramConnected
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
            )}
          >
            {telegramConnected ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            Telegram {telegramConnected ? 'connected' : 'not connected'}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure where alerts go and which signals trigger them. Override per-asset when needed.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Telegram */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <TelegramSection settings={settings ?? {}} onSaved={reload} />
        </motion.div>

        {/* Default threshold */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
        >
          <DefaultThresholdSection settings={settings ?? {}} onSaved={reload} />
        </motion.div>
      </div>

      {/* Per-asset thresholds */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
      >
        <PerAssetThresholdsSection
          settings={settings ?? {}}
          tickers={tickers ?? []}
          onSaved={reload}
        />
      </motion.div>
    </div>
  );
}

// ----- Telegram Section -----
function TelegramSection({
  settings,
  onSaved,
}: {
  settings: SettingsMap;
  onSaved: () => void;
}) {
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setToken(settings.telegram_bot_token ?? '');
    setChatId(settings.telegram_chat_id ?? '');
  }, [settings.telegram_bot_token, settings.telegram_chat_id]);

  const dirty =
    token !== (settings.telegram_bot_token ?? '') || chatId !== (settings.telegram_chat_id ?? '');

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_bot_token: token.trim(),
          telegram_chat_id: chatId.trim(),
        }),
      });
      toast.success('Telegram credentials saved');
      onSaved();
    } catch (e: any) {
      toast.error('Failed to save', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      toast.success('Test message sent', { description: 'Check your Telegram chat.' });
    } catch (e: any) {
      toast.error('Test failed', { description: e.message });
    } finally {
      setTesting(false);
    }
  };

  const connected =
    !!settings.telegram_bot_token &&
    !isPlaceholder(settings.telegram_bot_token) &&
    !!settings.telegram_chat_id;

  return (
    <Card className={cn('border-border/60 h-full', connected && 'border-emerald-500/30')}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg',
                connected ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted/60 text-muted-foreground'
              )}
            >
              <Send className="h-4 w-4" />
            </div>
            Telegram Channel
          </CardTitle>
          {connected ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 gap-1">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500 gap-1">
              <AlertTriangle className="h-3 w-3" /> Not set
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          Create a bot via{' '}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
            className="text-emerald-500 hover:underline"
          >
            @BotFather
          </a>{' '}
          and get your chat ID from{' '}
          <a
            href="https://t.me/userinfobot"
            target="_blank"
            rel="noreferrer"
            className="text-emerald-500 hover:underline"
          >
            @userinfobot
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <KeyRound className="h-3 w-3" /> Bot Token
          </Label>
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:AAH...your_bot_token"
              className="pr-10 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Hash className="h-3 w-3" /> Chat ID
          </Label>
          <Input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="e.g. 123456789 or @yourchannel"
            className="font-mono text-xs"
          />
        </div>
        <Separator />
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={save}
            disabled={saving || !dirty}
            className={cn(
              'gap-1.5 flex-1',
              dirty && 'bg-emerald-600 hover:bg-emerald-700 text-white'
            )}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save credentials
          </Button>
          <Button
            variant="outline"
            onClick={sendTest}
            disabled={testing || !connected}
            className="gap-1.5 flex-1"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send test alert
          </Button>
        </div>
        {connected && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
            <p className="font-medium flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" />
              First-time setup
            </p>
            <p className="mt-1 leading-relaxed opacity-90">
              If the test fails with &quot;chat not found&quot;, open Telegram, search for your bot
              (the username you set with @BotFather), and send <code className="font-mono bg-amber-500/10 px-1 rounded">/start</code> to it.
              Bots can only message users who have started a conversation with them first.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ----- Default Threshold Section -----
function DefaultThresholdSection({
  settings,
  onSaved,
}: {
  settings: SettingsMap;
  onSaved: () => void;
}) {
  const current: DefaultThreshold =
    settings.default_threshold ?? { minConviction: 60, directions: ['long', 'short'] };
  const [minConviction, setMinConviction] = useState<number>(current.minConviction);
  const [directions, setDirections] = useState<Direction[]>(current.directions);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMinConviction(current.minConviction);
    setDirections(current.directions);
  }, [settings.default_threshold]);

  const dirty =
    minConviction !== current.minConviction ||
    JSON.stringify([...directions].sort()) !== JSON.stringify([...current.directions].sort());

  const toggleDirection = (d: Direction) => {
    setDirections((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const save = async () => {
    if (directions.length === 0) {
      toast.error('Select at least one direction');
      return;
    }
    setSaving(true);
    try {
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'default_threshold',
          value: { minConviction, directions },
        }),
      });
      toast.success('Default threshold saved', {
        description: `${minConviction}% conviction · ${directions.join(', ')}`,
      });
      onSaved();
    } catch (e: any) {
      toast.error('Failed to save', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const convictionTone =
    minConviction >= 75 ? 'text-emerald-500' : minConviction >= 50 ? 'text-amber-500' : 'text-rose-500';

  return (
    <Card className="border-border/60 h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
            <Sliders className="h-4 w-4" />
          </div>
          Default Threshold
        </CardTitle>
        <CardDescription className="text-xs">
          Minimum conviction score and direction filter applied to all assets without a custom override.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Min Conviction
            </Label>
            <span className={cn('text-2xl font-bold tabular-nums', convictionTone)}>
              {minConviction}%
            </span>
          </div>
          <Slider
            value={[minConviction]}
            onValueChange={(v) => setMinConviction(v[0])}
            min={0}
            max={100}
            step={5}
            className="py-2"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>All signals</span>
            <span>Balanced</span>
            <span>High-conviction only</span>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Directions
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <DirectionToggle
              active={directions.includes('long')}
              onClick={() => toggleDirection('long')}
              label="Long"
              icon={<TrendingUp className="h-4 w-4" />}
              tone="emerald"
            />
            <DirectionToggle
              active={directions.includes('short')}
              onClick={() => toggleDirection('short')}
              label="Short"
              icon={<TrendingDown className="h-4 w-4" />}
              tone="rose"
            />
          </div>
        </div>

        <Button
          onClick={save}
          disabled={saving || !dirty}
          className={cn(
            'w-full gap-1.5',
            dirty && 'bg-emerald-600 hover:bg-emerald-700 text-white'
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save default
        </Button>
      </CardContent>
    </Card>
  );
}

function DirectionToggle({
  active,
  onClick,
  label,
  icon,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'rose';
}) {
  const activeCls =
    tone === 'emerald'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-500';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all',
        active
          ? activeCls
          : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ----- Per-Asset Thresholds Section -----
function PerAssetThresholdsSection({
  settings,
  tickers,
  onSaved,
}: {
  settings: SettingsMap;
  tickers: Ticker[];
  onSaved: () => void;
}) {
  const thresholds: AlertThresholds = settings.alert_thresholds ?? {};
  const defaultThreshold: DefaultThreshold =
    settings.default_threshold ?? { minConviction: 60, directions: ['long', 'short'] };

  const overrideCount = Object.keys(thresholds).length;

  const resetAsset = async (symbol: string) => {
    const next = { ...thresholds };
    delete next[symbol];
    try {
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'alert_thresholds', value: next }),
      });
      toast.success('Override removed', { description: `${symbol} now uses default` });
      onSaved();
    } catch (e: any) {
      toast.error('Failed to reset', { description: e.message });
    }
  };

  if (tickers.length === 0) {
    return (
      <Card className="border-dashed border-border">
        <CardContent className="py-10 text-center">
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
          <p className="text-sm text-muted-foreground">No assets available for per-asset overrides.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Crypto asset prices feed this list. Make sure the database has active crypto assets.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
                <ShieldCheck className="h-4 w-4" />
              </div>
              Per-Asset Thresholds
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Override the default threshold for specific assets. Default: {defaultThreshold.minConviction}% ·{' '}
              {defaultThreshold.directions.join(', ')}
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-500">
            {overrideCount} override{overrideCount === 1 ? '' : 's'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
          {tickers.map((t) => {
            const override = thresholds[t.symbol];
            const hasOverride = !!override;
            const minC = override?.minConviction ?? defaultThreshold.minConviction;
            const dirs = override?.directions ?? defaultThreshold.directions;
            return (
              <AccordionItem key={t.symbol} value={t.symbol} className="border-border/60">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3 w-full pr-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/60 text-xs font-mono">
                      {t.symbol.replace('USDT', '').slice(0, 2)}
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-medium">{t.symbol}</div>
                      <div className="text-[10px] text-muted-foreground">
                        ${t.price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ·{' '}
                        <span className={t.changePct >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                          {t.changePct >= 0 ? '+' : ''}
                          {t.changePct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    {hasOverride && (
                      <Badge variant="outline" className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-[10px] mr-2">
                        Custom
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
                      <span className="tabular-nums font-medium text-foreground">{minC}%</span>
                      <span>·</span>
                      <span className="flex gap-1">
                        {dirs.includes('long') && (
                          <TrendingUp className="h-3 w-3 text-emerald-500" />
                        )}
                        {dirs.includes('short') && (
                          <TrendingDown className="h-3 w-3 text-rose-500" />
                        )}
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <AssetThresholdEditor
                    symbol={t.symbol}
                    override={override}
                    defaultThreshold={defaultThreshold}
                    onSaved={onSaved}
                    onReset={() => resetAsset(t.symbol)}
                  />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function AssetThresholdEditor({
  symbol,
  override,
  defaultThreshold,
  onSaved,
  onReset,
}: {
  symbol: string;
  override?: { minConviction: number; directions: Direction[] };
  defaultThreshold: DefaultThreshold;
  onSaved: () => void;
  onReset: () => void;
}) {
  const [minConviction, setMinConviction] = useState<number>(
    override?.minConviction ?? defaultThreshold.minConviction
  );
  const [directions, setDirections] = useState<Direction[]>(
    override?.directions ?? defaultThreshold.directions
  );
  const [saving, setSaving] = useState(false);

  const toggleDirection = (d: Direction) => {
    setDirections((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const save = async () => {
    if (directions.length === 0) {
      toast.error('Select at least one direction');
      return;
    }
    setSaving(true);
    try {
      // Fetch current thresholds then merge — avoids clobbering concurrent edits
      const cur = await api<SettingsMap>('/api/settings');
      const curTh: AlertThresholds = cur.alert_thresholds ?? {};
      const next = { ...curTh, [symbol]: { minConviction, directions } };
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'alert_thresholds', value: next }),
      });
      toast.success('Override saved', {
        description: `${symbol}: ${minConviction}% · ${directions.join(', ')}`,
      });
      onSaved();
    } catch (e: any) {
      toast.error('Failed to save override', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Min Conviction
          </Label>
          <span className="text-lg font-bold tabular-nums">{minConviction}%</span>
        </div>
        <Slider
          value={[minConviction]}
          onValueChange={(v) => setMinConviction(v[0])}
          min={0}
          max={100}
          step={5}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Directions</Label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={directions.includes('long')}
              onCheckedChange={() => toggleDirection('long')}
            />
            <span className="text-sm flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-emerald-500" /> Long
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={directions.includes('short')}
              onCheckedChange={() => toggleDirection('short')}
            />
            <span className="text-sm flex items-center gap-1">
              <TrendingDown className="h-3 w-3 text-rose-500" /> Short
            </span>
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={save}
          disabled={saving}
          size="sm"
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save override
        </Button>
        {override && (
          <Button onClick={onReset} variant="outline" size="sm" className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </Button>
        )}
      </div>
    </div>
  );
}
