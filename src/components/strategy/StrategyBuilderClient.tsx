'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Wrench, Plus, Trash2, Play, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types — strategy = list of rules
// ---------------------------------------------------------------------------

type Indicator = 'rsi' | 'ema' | 'sma' | 'macd' | 'price';
type Comparator = 'below' | 'above' | 'cross_up' | 'cross_down';

interface Rule {
  id: string;
  indicator: Indicator;
  period: number;
  comparator: Comparator;
  value: number; // for rsi/price comparisons
  side: 'long' | 'short';
}

interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

interface Trade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: 'long' | 'short';
  pnlPct: number;
}

interface BacktestResult {
  trades: Trade[];
  equityCurve: Array<{ t: number; equity: number }>;
  finalEquity: number;
  totalReturnPct: number;
  winRate: number;
  totalTrades: number;
  sharpe: number;
  maxDrawdownPct: number;
}

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
const INTERVALS = ['1h', '4h', '1d'];

// ---------------------------------------------------------------------------
// Indicators (mini — shared with backtest)
// ---------------------------------------------------------------------------

function rsiSeries(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length).fill(NaN);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function smaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    out[i] = s / period;
  }
  return out;
}

function macdSeries(closes: number[]): number[] {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  return closes.map((_, i) =>
    Number.isNaN(ema12[i]) || Number.isNaN(ema26[i]) ? NaN : ema12[i] - ema26[i],
  );
}

// ---------------------------------------------------------------------------
// Strategy engine — evaluate rule at each bar
// ---------------------------------------------------------------------------

function evaluateRule(
  rule: Rule,
  closes: number[],
  indicatorCache: Map<string, number[]>,
  i: number,
): boolean {
  const key = `${rule.indicator}:${rule.period}`;
  if (!indicatorCache.has(key)) {
    let series: number[];
    switch (rule.indicator) {
      case 'rsi':
        series = rsiSeries(closes, rule.period);
        break;
      case 'ema':
        series = emaSeries(closes, rule.period);
        break;
      case 'sma':
        series = smaSeries(closes, rule.period);
        break;
      case 'macd':
        series = macdSeries(closes);
        break;
      case 'price':
      default:
        series = closes;
        break;
    }
    indicatorCache.set(key, series);
  }
  const series = indicatorCache.get(key)!;
  if (Number.isNaN(series[i])) return false;

  switch (rule.comparator) {
    case 'below':
      return series[i] < rule.value;
    case 'above':
      return series[i] > rule.value;
    case 'cross_up':
      return (
        i > 0 &&
        !Number.isNaN(series[i - 1]) &&
        series[i - 1] <= rule.value &&
        series[i] > rule.value
      );
    case 'cross_down':
      return (
        i > 0 &&
        !Number.isNaN(series[i - 1]) &&
        series[i - 1] >= rule.value &&
        series[i] < rule.value
      );
    default:
      return false;
  }
}

function runStrategy(
  klines: Kline[],
  entryRules: Rule[],
  exitRules: Rule[],
  initialCapital: number,
): BacktestResult | null {
  if (klines.length < 50 || entryRules.length === 0) return null;
  const closes = klines.map((k) => k.close);
  const cache = new Map<string, number[]>();

  const trades: Trade[] = [];
  let position: { side: 'long' | 'short'; entryPrice: number; entryTime: number } | null = null;

  for (let i = 1; i < klines.length; i++) {
    const price = closes[i];
    const time = klines[i].openTime;

    if (position) {
      const allExit = exitRules.length === 0 || exitRules.every((r) => evaluateRule(r, closes, cache, i));
      if (allExit) {
        const pnlPct =
          position.side === 'long'
            ? ((price - position.entryPrice) / position.entryPrice) * 100
            : ((position.entryPrice - price) / position.entryPrice) * 100;
        trades.push({
          entryTime: position.entryTime,
          exitTime: time,
          entryPrice: position.entryPrice,
          exitPrice: price,
          side: position.side,
          pnlPct,
        });
        position = null;
      }
    }

    if (!position) {
      const allEntry = entryRules.every((r) => evaluateRule(r, closes, cache, i));
      if (allEntry) {
        // Use the side of the first rule (assume all rules share the same side).
        position = {
          side: entryRules[0].side,
          entryPrice: price,
          entryTime: time,
        };
      }
    }
  }

  // Close open position at last bar
  if (position) {
    const price = closes[closes.length - 1];
    const pnlPct =
      position.side === 'long'
        ? ((price - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - price) / position.entryPrice) * 100;
    trades.push({
      entryTime: position.entryTime,
      exitTime: klines[klines.length - 1].openTime,
      entryPrice: position.entryPrice,
      exitPrice: price,
      side: position.side,
      pnlPct,
    });
  }

  let equity = initialCapital;
  const equityCurve: Array<{ t: number; equity: number }> = [
    { t: klines[0].openTime, equity },
  ];
  for (const t of trades) {
    equity = equity * (1 + t.pnlPct / 100);
    equityCurve.push({ t: t.exitTime, equity });
  }
  const finalEquity = equity;
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  const returns = trades.map((t) => t.pnlPct / 100);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (returns.length - 1)
      : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(Math.max(1, returns.length)) : 0;

  let peak = initialCapital;
  let maxDd = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    trades,
    equityCurve,
    finalEquity,
    totalReturnPct,
    winRate,
    totalTrades: trades.length,
    sharpe,
    maxDrawdownPct: maxDd,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUsd(n: number, max = 2): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: max })}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(2)}%`;
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function newRule(side: 'long' | 'short'): Rule {
  return {
    id: Math.random().toString(36).slice(2, 10),
    indicator: 'rsi',
    period: 14,
    comparator: 'below',
    value: 30,
    side,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StrategyBuilderClient(): React.ReactElement {
  const [symbol, setSymbol] = React.useState('BTCUSDT');
  const [interval, setInterval_] = React.useState('4h');
  const [limit, setLimit] = React.useState('365');
  const [capital, setCapital] = React.useState('10000');
  const [entryRules, setEntryRules] = React.useState<Rule[]>([
    { ...newRule('long'), indicator: 'rsi', period: 14, comparator: 'below', value: 30 },
  ]);
  const [exitRules, setExitRules] = React.useState<Rule[]>([
    { ...newRule('long'), indicator: 'rsi', period: 14, comparator: 'above', value: 50 },
  ]);
  const [result, setResult] = React.useState<BacktestResult | null>(null);
  const [running, setRunning] = React.useState(false);

  const klinesQ = useQuery<Kline[]>({
    queryKey: ['strategy-klines', symbol, interval, limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/crypto/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
          interval,
        )}&limit=${encodeURIComponent(limit)}`,
      );
      if (!res.ok) throw new Error('klines fetch failed');
      const json: { success?: boolean; data?: Kline[] } = await res.json();
      return json.data ?? [];
    },
    enabled: false,
  });

  const handleRun = React.useCallback(async () => {
    setRunning(true);
    try {
      const data = await klinesQ.refetch();
      const klines = data.data ?? [];
      if (!klines.length) {
        setResult(null);
        return;
      }
      const res = runStrategy(klines, entryRules, exitRules, parseFloat(capital) || 10000);
      setResult(res);
    } finally {
      setRunning(false);
    }
  }, [klinesQ, entryRules, exitRules, capital]);

  const updateRule = (which: 'entry' | 'exit', id: string, patch: Partial<Rule>) => {
    const setter = which === 'entry' ? setEntryRules : setExitRules;
    setter((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const addRule = (which: 'entry' | 'exit') => {
    const setter = which === 'entry' ? setEntryRules : setExitRules;
    const list = which === 'entry' ? entryRules : exitRules;
    setter([...list, newRule(list[0]?.side ?? 'long')]);
  };
  const removeRule = (which: 'entry' | 'exit', id: string) => {
    const setter = which === 'entry' ? setEntryRules : setExitRules;
    setter((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Strategy Builder</h1>
        <p className="text-xs text-muted-foreground">
          Build a custom strategy from indicator rules. All entry rules must be true to open a
          position; all exit rules must be true to close. AND-logic.
        </p>
      </div>

      <Card className="ring-1 ring-inset ring-border/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            Market Setup
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Interval</Label>
            <Select value={interval} onValueChange={setInterval_}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="limit">Bars</Label>
            <Input
              id="limit"
              type="number"
              min="50"
              max="1500"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cap">Initial Capital</Label>
            <Input
              id="cap"
              type="number"
              min="100"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <RulesCard
          title="Entry Rules"
          subtitle="ALL must be true → open position"
          rules={entryRules}
          onChange={(id, patch) => updateRule('entry', id, patch)}
          onAdd={() => addRule('entry')}
          onRemove={(id) => removeRule('entry', id)}
          accent="emerald"
        />
        <RulesCard
          title="Exit Rules"
          subtitle="ALL must be true → close position"
          rules={exitRules}
          onChange={(id, patch) => updateRule('exit', id, patch)}
          onAdd={() => addRule('exit')}
          onRemove={(id) => removeRule('exit', id)}
          accent="rose"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleRun} disabled={running || entryRules.length === 0}>
          <Play className="h-4 w-4" />
          {running ? 'Running…' : 'Run Strategy'}
        </Button>
      </div>

      {result ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Final Equity" value={fmtUsd(result.finalEquity)} tone={result.totalReturnPct >= 0 ? 'emerald' : 'rose'} />
            <Metric label="Return" value={fmtPct(result.totalReturnPct)} tone={result.totalReturnPct >= 0 ? 'emerald' : 'rose'} />
            <Metric label="Sharpe" value={result.sharpe.toFixed(2)} tone={result.sharpe >= 1 ? 'emerald' : 'amber'} />
            <Metric label="Max DD" value={`-${result.maxDrawdownPct.toFixed(2)}%`} tone="rose" />
            <Metric label="Win Rate" value={`${result.winRate.toFixed(1)}%`} />
            <Metric label="Trades" value={String(result.totalTrades)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Equity Curve
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.014 264 / 0.4)" />
                    <XAxis
                      dataKey="t"
                      tickFormatter={(t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                      stroke="oklch(0.30 0.014 264)"
                    />
                    <YAxis
                      tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                      stroke="oklch(0.30 0.014 264)"
                      tickFormatter={(v) => fmtUsd(v, 0)}
                      width={70}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'oklch(0.20 0.014 264)',
                        border: '1px solid oklch(0.30 0.014 264)',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      labelFormatter={(t) => fmtTime(Number(t))}
                      formatter={(v: number) => [fmtUsd(v), 'Equity']}
                    />
                    <ReferenceLine y={parseFloat(capital) || 10000} stroke="oklch(0.70 0.012 264)" strokeDasharray="4 4" />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      stroke={result.totalReturnPct >= 0 ? 'oklch(0.72 0.18 160)' : 'oklch(0.65 0.22 25)'}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {result.trades.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Trades ({result.trades.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Entry Time</TableHead>
                      <TableHead className="text-right">Entry $</TableHead>
                      <TableHead className="text-right">Exit $</TableHead>
                      <TableHead className="text-right">P&amp;L %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.trades.slice(0, 50).map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <Badge variant={t.side === 'long' ? 'success' : 'rose'} className="text-[10px] capitalize">
                            {t.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">{fmtTime(t.entryTime)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{t.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{t.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className={cn('text-right font-mono text-xs', t.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          {fmtPct(t.pnlPct)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-xs text-muted-foreground">
            Add entry + exit rules and click <span className="text-foreground">Run Strategy</span>.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RulesCard — list of rules
// ---------------------------------------------------------------------------

function RulesCard({
  title,
  subtitle,
  rules,
  onChange,
  onAdd,
  onRemove,
  accent,
}: {
  title: string;
  subtitle: string;
  rules: Rule[];
  onChange: (id: string, patch: Partial<Rule>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  accent: 'emerald' | 'rose';
}): React.ReactElement {
  const accentBorder = accent === 'emerald' ? 'border-emerald-500/30' : 'border-rose-500/30';
  const accentText = accent === 'emerald' ? 'text-emerald-300' : 'text-rose-300';
  return (
    <Card className={cn('ring-1 ring-inset ring-border/30', accentBorder)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className={accentText}>{title}</span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={onAdd}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules.length === 0 ? (
          <div className="rounded border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
            No rules. Click &quot;Add&quot;.
          </div>
        ) : (
          rules.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto] items-center gap-2 rounded-md border border-border bg-muted/20 p-2"
            >
              <Select
                value={r.side}
                onValueChange={(v) => onChange(r.id, { side: v as 'long' | 'short' })}
              >
                <SelectTrigger className="h-7 w-[70px] text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">LONG</SelectItem>
                  <SelectItem value="short">SHORT</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={r.indicator}
                onValueChange={(v) => onChange(r.id, { indicator: v as Indicator })}
              >
                <SelectTrigger className="h-7 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rsi">RSI</SelectItem>
                  <SelectItem value="ema">EMA</SelectItem>
                  <SelectItem value="sma">SMA</SelectItem>
                  <SelectItem value="macd">MACD</SelectItem>
                  <SelectItem value="price">Price</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min="1"
                max="200"
                value={r.period}
                onChange={(e) => onChange(r.id, { period: parseInt(e.target.value, 10) || 14 })}
                className="h-7 text-[11px]"
                placeholder="period"
              />
              <Select
                value={r.comparator}
                onValueChange={(v) => onChange(r.id, { comparator: v as Comparator })}
              >
                <SelectTrigger className="h-7 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="below">below</SelectItem>
                  <SelectItem value="above">above</SelectItem>
                  <SelectItem value="cross_up">crosses up</SelectItem>
                  <SelectItem value="cross_down">crosses down</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="any"
                value={r.value}
                onChange={(e) => onChange(r.id, { value: parseFloat(e.target.value) || 0 })}
                className="h-7 text-[11px]"
                placeholder="value"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-rose-400 hover:text-rose-300"
                onClick={() => onRemove(r.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: 'muted' | 'emerald' | 'rose' | 'amber';
}): React.ReactElement {
  const toneMap: Record<typeof tone, string> = {
    muted: 'text-foreground',
    emerald: 'text-emerald-300',
    rose: 'text-rose-300',
    amber: 'text-amber-300',
  };
  return (
    <Card className="p-3 ring-1 ring-inset ring-border/30">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-mono text-lg font-bold', toneMap[tone])}>{value}</div>
    </Card>
  );
}
