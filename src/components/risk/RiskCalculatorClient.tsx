'use client';

import * as React from 'react';
import { Calculator, TrendingUp, AlertTriangle, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Pure math — position sizing + leverage + liquidation
// ---------------------------------------------------------------------------

interface RiskInputs {
  accountSize: number;
  riskPct: number; // % of account to risk on the trade (e.g. 1 = 1%)
  entry: number;
  stop: number;
  leverage: number; // 1 = no leverage
  side: 'long' | 'short';
  takeProfit?: number;
}

interface RiskResults {
  riskAmount: number; // $ at risk
  stopDistance: number; // absolute
  stopDistancePct: number; // %
  positionSize: number; // units of the asset
  notional: number; // $ exposure
  marginRequired: number; // $ margin
  liqPrice: number | null; // estimated liquidation
  rrRatio: number | null; // risk:reward
  rewardAmount: number | null;
}

function computeRisk(inp: RiskInputs): RiskResults | null {
  const { accountSize, riskPct, entry, stop, leverage, side, takeProfit } = inp;
  if (![accountSize, riskPct, entry, stop, leverage].every((v) => Number.isFinite(v) && v > 0)) {
    return null;
  }
  if (entry === stop) return null;

  const riskAmount = accountSize * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);
  const stopDistancePct = (stopDistance / entry) * 100;
  // Units = riskAmount / per-unit loss
  const positionSize = riskAmount / stopDistance;
  const notional = positionSize * entry;
  const marginRequired = notional / leverage;

  // Liquidation estimate — simplified isolated-margin formula:
  //   long:  liq = entry * (1 - 1/leverage + stopDistancePct/(100*leverage))
  //          approx → entry * (1 - 1/leverage) * (1 - maintenance)
  // We use the textbook isolated-margin liq price ignoring fees:
  //   long:  liq = entry * (1 - 1/leverage)
  //   short: liq = entry * (1 + 1/leverage)
  // Note: real exchanges add a maintenance margin; this is an estimate.
  const liqPrice =
    side === 'long' ? entry * (1 - 1 / leverage) : entry * (1 + 1 / leverage);

  // R:R
  let rrRatio: number | null = null;
  let rewardAmount: number | null = null;
  if (takeProfit != null && Number.isFinite(takeProfit) && takeProfit > 0) {
    const reward = Math.abs(takeProfit - entry) * positionSize;
    rewardAmount = reward;
    rrRatio = reward / riskAmount;
  }

  return {
    riskAmount,
    stopDistance,
    stopDistancePct,
    positionSize,
    notional,
    marginRequired,
    liqPrice,
    rrRatio,
    rewardAmount,
  };
}

function fmtUsd(n: number | null | undefined, max = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: max })}`;
  return `$${n.toFixed(4)}`;
}

function fmtNum(n: number | null | undefined, max = 6): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toFixed(Math.min(max, 6));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RiskCalculatorClient(): React.ReactElement {
  const [accountSize, setAccountSize] = React.useState('10000');
  const [riskPct, setRiskPct] = React.useState('1');
  const [entry, setEntry] = React.useState('50000');
  const [stop, setStop] = React.useState('49000');
  const [takeProfit, setTakeProfit] = React.useState('53000');
  const [leverage, setLeverage] = React.useState('1');
  const [side, setSide] = React.useState<'long' | 'short'>('long');

  const results = React.useMemo<RiskResults | null>(() => {
    return computeRisk({
      accountSize: parseFloat(accountSize),
      riskPct: parseFloat(riskPct),
      entry: parseFloat(entry),
      stop: parseFloat(stop),
      leverage: parseFloat(leverage),
      side,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
    });
  }, [accountSize, riskPct, entry, stop, leverage, side, takeProfit]);

  // Sanity: warn when stop is on the wrong side.
  const stopWarning = React.useMemo(() => {
    const e = parseFloat(entry);
    const s = parseFloat(stop);
    if (!Number.isFinite(e) || !Number.isFinite(s)) return null;
    if (side === 'long' && s >= e) return 'For a LONG, stop must be BELOW entry.';
    if (side === 'short' && s <= e) return 'For a SHORT, stop must be ABOVE entry.';
    return null;
  }, [entry, stop, side]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Risk Calculator</h1>
        <p className="text-xs text-muted-foreground">
          Position sizing, leverage, and liquidation price estimates. All math runs client-side — no
          data leaves the browser.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Inputs */}
        <Card className="ring-1 ring-inset ring-border/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              Trade Inputs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="account">Account Size (USD)</Label>
              <Input
                id="account"
                type="number"
                step="any"
                min="0"
                value={accountSize}
                onChange={(e) => setAccountSize(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="risk">Risk per Trade (%)</Label>
              <Input
                id="risk"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={riskPct}
                onChange={(e) => setRiskPct(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Recommended: 0.5–2% per trade. Higher = aggressive.
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
              {(['long', 'short'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  className={cn(
                    'flex-1 rounded px-3 py-1 text-[11px] font-semibold uppercase transition-colors',
                    side === s
                      ? s === 'long'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="entry">Entry Price</Label>
                <Input
                  id="entry"
                  type="number"
                  step="any"
                  min="0"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stop">Stop Loss</Label>
                <Input
                  id="stop"
                  type="number"
                  step="any"
                  min="0"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                />
              </div>
            </div>

            {stopWarning ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {stopWarning}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tp">Take Profit (optional)</Label>
                <Input
                  id="tp"
                  type="number"
                  step="any"
                  min="0"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lev">Leverage (×)</Label>
                <Input
                  id="lev"
                  type="number"
                  step="1"
                  min="1"
                  max="125"
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Risk $"
              value={fmtUsd(results?.riskAmount)}
              icon={<AlertTriangle className="h-4 w-4 text-rose-300" />}
              accent="rose"
            />
            <Stat
              label="Position Size"
              value={fmtNum(results?.positionSize)}
              sub="units"
              icon={<Target className="h-4 w-4 text-sky-300" />}
              accent="sky"
            />
            <Stat
              label="Notional"
              value={fmtUsd(results?.notional)}
              icon={<TrendingUp className="h-4 w-4 text-amber-300" />}
              accent="amber"
            />
            <Stat
              label="Margin"
              value={fmtUsd(results?.marginRequired)}
              icon={<Calculator className="h-4 w-4 text-emerald-300" />}
              accent="emerald"
            />
          </div>

          <Card className="ring-1 ring-inset ring-border/30">
            <CardHeader>
              <CardTitle>Trade Metrics</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Metric label="Stop Distance" value={fmtNum(results?.stopDistance)} sub="absolute" />
              <Metric
                label="Stop Distance %"
                value={results ? `${results.stopDistancePct.toFixed(2)}%` : '—'}
              />
              <Metric
                label="Risk : Reward"
                value={results?.rrRatio != null ? `1 : ${results.rrRatio.toFixed(2)}` : '—'}
                tone={results?.rrRatio == null ? 'muted' : results.rrRatio >= 2 ? 'emerald' : 'amber'}
              />
              <Metric
                label="Potential Reward"
                value={fmtUsd(results?.rewardAmount)}
                tone="emerald"
              />
              <Metric
                label="Est. Liquidation"
                value={fmtUsd(results?.liqPrice)}
                tone="rose"
                sub="isolated · pre-fees"
              />
              <Metric
                label="Leverage"
                value={leverage ? `${leverage}×` : '—'}
                tone={parseFloat(leverage) > 10 ? 'rose' : 'muted'}
              />
            </CardContent>
          </Card>

          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div className="space-y-1 text-[11px] text-muted-foreground">
                  <p className="font-semibold text-amber-200">Disclaimer</p>
                  <p>
                    Liquidation price is an isolated-margin estimate ignoring fees and maintenance
                    margin. Real exchanges liquidate earlier. Always verify with your exchange&apos;s
                    calculator before placing leveraged trades.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: 'rose' | 'sky' | 'amber' | 'emerald';
}): React.ReactElement {
  const borderMap: Record<typeof accent, string> = {
    rose: 'border-rose-500/30',
    sky: 'border-sky-500/30',
    amber: 'border-amber-500/30',
    emerald: 'border-emerald-500/30',
  };
  return (
    <Card className={cn('p-4', borderMap[accent])}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-xl font-bold text-foreground">{value}</div>
      {sub ? <div className="mt-1 text-[10px] text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = 'muted',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'muted' | 'emerald' | 'rose' | 'amber';
}): React.ReactElement {
  const toneMap: Record<typeof tone, string> = {
    muted: 'text-foreground',
    emerald: 'text-emerald-300',
    rose: 'text-rose-300',
    amber: 'text-amber-300',
  };
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-mono text-sm', toneMap[tone])}>{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
