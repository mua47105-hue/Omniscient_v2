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
import { Play, History, TrendingUp, TrendingDown } from 'lucide-react';
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
// Types
// ---------------------------------------------------------------------------

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
  bars: number;
}

interface BacktestResult {
  trades: Trade[];
  equityCurve: Array<{ t: number; equity: number }>;
  finalEquity: number;
  totalReturnPct: number;
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  sharpe: number;
  maxDrawdownPct: number;
  avgTradePct: number;
  bestTradePct: number;
  worstTradePct: number;
}

type Strategy = 'rsi_oversold' | 'macd_cross' | 'ema_cross';

const STRATEGIES: Array<{ value: Strategy; label: string; description: string }> = [
  {
    value: 'rsi_oversold',
    label: 'RSI Oversold',
    description: 'Long when RSI(14) < 30; exit when RSI > 50.',
  },
  {
    value: 'macd_cross',
    label: 'MACD Cross',
    description: 'Long when MACD crosses above signal; exit when it crosses below.',
  },
  {
    value: 'ema_cross',
    label: 'EMA Cross',
    description: 'Long when EMA(12) crosses above EMA(26); exit on opposite cross.',
  },
];

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
const INTERVALS = ['1h', '4h', '1d'];

// ---------------------------------------------------------------------------
// Indicators (mini-implementation — enough for backtesting)
// ---------------------------------------------------------------------------

function rsiSeries(closes: number[], period = 14): number[] {
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

function macdSeries(closes: number[]): { macd: number[]; signal: number[] } {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) =>
    Number.isNaN(ema12[i]) || Number.isNaN(ema26[i]) ? NaN : ema12[i] - ema26[i],
  );
  // Signal = EMA(9) of macdLine (only the valid portion)
  const validStart = macdLine.findIndex((v) => !Number.isNaN(v));
  const signal: number[] = new Array(closes.length).fill(NaN);
  if (validStart >= 0) {
    const slice = macdLine.slice(validStart);
    const sig = emaSeries(slice, 9);
    for (let i = 0; i < sig.length; i++) signal[validStart + i] = sig[i];
  }
  return { macd: macdLine, signal };
}

// ---------------------------------------------------------------------------
// Backtest engine
// ---------------------------------------------------------------------------

function runBacktest(
  klines: Kline[],
  strategy: Strategy,
  initialCapital: number,
): BacktestResult | null {
  if (klines.length < 50) return null;
  const closes = klines.map((k) => k.close);

  // Pre-compute indicators.
  const rsi = strategy === 'rsi_oversold' ? rsiSeries(closes, 14) : [];
  const { macd, signal } = strategy === 'macd_cross' ? macdSeries(closes) : { macd: [], signal: [] };
  const ema12 = strategy === 'ema_cross' ? emaSeries(closes, 12) : [];
  const ema26 = strategy === 'ema_cross' ? emaSeries(closes, 26) : [];

  const trades: Trade[] = [];
  let position: { side: 'long' | 'short'; entryPrice: number; entryTime: number; entryIdx: number } | null = null;

  const crossUp = (a: number[], b: number[], i: number): boolean =>
    i > 0 &&
    !Number.isNaN(a[i]) && !Number.isNaN(b[i]) && !Number.isNaN(a[i - 1]) && !Number.isNaN(b[i - 1]) &&
    a[i - 1] <= b[i - 1] && a[i] > b[i];
  const crossDown = (a: number[], b: number[], i: number): boolean =>
    i > 0 &&
    !Number.isNaN(a[i]) && !Number.isNaN(b[i]) && !Number.isNaN(a[i - 1]) && !Number.isNaN(b[i - 1]) &&
    a[i - 1] >= b[i - 1] && a[i] < b[i];

  for (let i = 1; i < klines.length; i++) {
    const price = closes[i];
    const time = klines[i].openTime;

    // Check exit first
    if (position) {
      let shouldExit = false;
      if (strategy === 'rsi_oversold' && !Number.isNaN(rsi[i]) && rsi[i] > 50) shouldExit = true;
      if (strategy === 'macd_cross' && crossDown(macd, signal, i)) shouldExit = true;
      if (strategy === 'ema_cross' && crossDown(ema12, ema26, i)) shouldExit = true;

      if (shouldExit) {
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
          bars: i - position.entryIdx,
        });
        position = null;
      }
    }

    // Check entry
    if (!position) {
      let shouldEnter = false;
      if (strategy === 'rsi_oversold' && !Number.isNaN(rsi[i]) && rsi[i] < 30) shouldEnter = true;
      if (strategy === 'macd_cross' && crossUp(macd, signal, i)) shouldEnter = true;
      if (strategy === 'ema_cross' && crossUp(ema12, ema26, i)) shouldEnter = true;

      if (shouldEnter) {
        position = {
          side: 'long',
          entryPrice: price,
          entryTime: time,
          entryIdx: i,
        };
      }
    }
  }

  // Close any open position at the last bar.
  if (position) {
    const lastIdx = klines.length - 1;
    const price = closes[lastIdx];
    const pnlPct =
      position.side === 'long'
        ? ((price - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - price) / position.entryPrice) * 100;
    trades.push({
      entryTime: position.entryTime,
      exitTime: klines[lastIdx].openTime,
      entryPrice: position.entryPrice,
      exitPrice: price,
      side: position.side,
      pnlPct,
      bars: lastIdx - position.entryIdx,
    });
  }

  // Build equity curve — each trade compounds.
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
  const losses = trades.filter((t) => t.pnlPct <= 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  // Sharpe (per-trade, annualized to ~252 trading days / 6.5 hrs = ~58 trades/day on 1h bars)
  // Simpler: per-trade mean / std, × sqrt(trades.length) for an aggregate ratio.
  const returns = trades.map((t) => t.pnlPct / 100);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (returns.length - 1)
      : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(Math.max(1, returns.length)) : 0;

  // Max drawdown
  let peak = initialCapital;
  let maxDd = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const avgTradePct = trades.length ? returns.reduce((a, b) => a + b * 100, 0) / trades.length : 0;
  const bestTradePct = trades.length ? Math.max(...trades.map((t) => t.pnlPct)) : 0;
  const worstTradePct = trades.length ? Math.min(...trades.map((t) => t.pnlPct)) : 0;

  return {
    trades,
    equityCurve,
    finalEquity,
    totalReturnPct,
    winRate,
    totalTrades: trades.length,
    wins,
    losses,
    sharpe,
    maxDrawdownPct: maxDd,
    avgTradePct,
    bestTradePct,
    worstTradePct,
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BacktestClient(): React.ReactElement {
  const [symbol, setSymbol] = React.useState('BTCUSDT');
  const [interval, setInterval_] = React.useState('4h');
  const [limit, setLimit] = React.useState('365');
  const [strategy, setStrategy] = React.useState<Strategy>('rsi_oversold');
  const [capital, setCapital] = React.useState('10000');
  const [result, setResult] = React.useState<BacktestResult | null>(null);
  const [running, setRunning] = React.useState(false);

  const klinesQ = useQuery<Kline[]>({
    queryKey: ['backtest-klines', symbol, interval, limit],
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
    enabled: false, // only fetch when user clicks run
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
      const res = runBacktest(klines, strategy, parseFloat(capital) || 10000);
      setResult(res);
    } finally {
      setRunning(false);
    }
  }, [klinesQ, strategy, capital]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Backtest</h1>
        <p className="text-xs text-muted-foreground">
          Historical strategy backtesting. Pick an asset + strategy preset, run, and inspect the
          equity curve + trade log.
        </p>
      </div>

      {/* Config */}
      <Card className="ring-1 ring-inset ring-border/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1.5">
            <Label>Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
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
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
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
          <div className="space-y-1.5 lg:col-span-2">
            <Label>Strategy</Label>
            <Select value={strategy} onValueChange={(v) => setStrategy(v as Strategy)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 lg:col-span-6">
            <p className="text-[11px] text-muted-foreground">
              {STRATEGIES.find((s) => s.value === strategy)?.description}
            </p>
          </div>
          <div className="sm:col-span-2 lg:col-span-6">
            <Button onClick={handleRun} disabled={running}>
              <Play className="h-4 w-4" />
              {running ? 'Running…' : 'Run Backtest'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {result ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              label="Final Equity"
              value={fmtUsd(result.finalEquity)}
              tone={result.totalReturnPct >= 0 ? 'emerald' : 'rose'}
            />
            <MetricCard
              label="Return"
              value={fmtPct(result.totalReturnPct)}
              tone={result.totalReturnPct >= 0 ? 'emerald' : 'rose'}
            />
            <MetricCard label="Sharpe" value={result.sharpe.toFixed(2)} tone={result.sharpe >= 1 ? 'emerald' : 'amber'} />
            <MetricCard
              label="Max Drawdown"
              value={`-${result.maxDrawdownPct.toFixed(2)}%`}
              tone="rose"
            />
            <MetricCard label="Win Rate" value={`${result.winRate.toFixed(1)}%`} />
            <MetricCard label="Trades" value={String(result.totalTrades)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Equity Curve</span>
                <Badge variant={result.totalReturnPct >= 0 ? 'success' : 'rose'}>
                  {result.totalReturnPct >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {fmtPct(result.totalReturnPct)}
                </Badge>
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

          <Card>
            <CardHeader>
              <CardTitle>Trade Log ({result.trades.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {result.trades.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No trades generated. Try a different strategy or longer time window.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Exit</TableHead>
                      <TableHead className="text-right">Entry $</TableHead>
                      <TableHead className="text-right">Exit $</TableHead>
                      <TableHead className="text-right">Bars</TableHead>
                      <TableHead className="text-right">P&amp;L %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.trades.slice(0, 100).map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <Badge variant={t.side === 'long' ? 'success' : 'rose'} className="text-[10px] capitalize">
                            {t.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">{fmtTime(t.entryTime)}</TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">{fmtTime(t.exitTime)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{t.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{t.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{t.bars}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-mono text-xs',
                            t.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400',
                          )}
                        >
                          {fmtPct(t.pnlPct)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-xs text-muted-foreground">
            Configure a strategy and click <span className="text-foreground">Run Backtest</span> to
            see results.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({
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
