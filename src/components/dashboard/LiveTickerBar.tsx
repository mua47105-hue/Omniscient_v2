'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useLiveTicker, type LiveConnectionStatus } from '@/hooks/useLiveTicker';
import { cn } from '@/lib/utils';
import type { Ticker } from '@/lib/types';

const DEFAULT_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'POLUSDT',
];

interface LiveTickerBarProps {
  /** Override the default 10-symbol watchlist. */
  symbols?: string[];
  className?: string;
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function StatusDot({ status }: { status: LiveConnectionStatus }) {
  const cfg = {
    connecting: { color: 'bg-amber-400', label: 'Connecting', ring: 'bg-amber-400/60' },
    connected: { color: 'bg-emerald-400', label: 'Live', ring: 'bg-emerald-400/60' },
    reconnecting: { color: 'bg-amber-400', label: 'Reconnecting', ring: 'bg-amber-400/60' },
    disconnected: { color: 'bg-rose-500', label: 'Offline', ring: 'bg-rose-500/60' },
  }[status];

  const pulse = status === 'connected' || status === 'reconnecting' || status === 'connecting';

  return (
    <div className="flex items-center gap-1.5 shrink-0" title={cfg.label}>
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              cfg.ring
            )}
          />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', cfg.color)} />
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground hidden sm:inline">
        {cfg.label}
      </span>
    </div>
  );
}

interface TickerCellProps {
  symbol: string;
  ticker: Ticker | undefined;
}

function TickerCell({ symbol, ticker }: TickerCellProps) {
  // Track the previous price so we can flash up/down on each tick. The flash
  // state is set inside an effect (which is the canonical place to synchronize
  // derived UI state with an external/propped value). setState inside a
  // setTimeout callback is allowed by the lint rule because it's not in the
  // synchronous effect body.
  const prevPriceRef = useRef<number | undefined>(ticker?.price);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  const price = ticker?.price;
  const changePct = ticker?.changePct;
  const isUp = (changePct ?? 0) >= 0;

  useEffect(() => {
    if (price == null) return;
    const prev = prevPriceRef.current;
    if (prev != null && price !== prev) {
      const dir: 'up' | 'down' = price > prev ? 'up' : 'down';
      const t1 = setTimeout(() => setFlash(dir), 0);
      const t2 = setTimeout(() => setFlash(null), 500);
      prevPriceRef.current = price;
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    prevPriceRef.current = price;
  }, [price]);

  const base = symbol.replace(/USDT$/, '');

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-r border-border/40 last:border-r-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {base}
      </span>
      <motion.span
        key={price ?? 'no-data'}
        initial={
          flash === 'up'
            ? { backgroundColor: 'rgba(16,185,129,0.18)' }
            : flash === 'down'
            ? { backgroundColor: 'rgba(244,63,94,0.18)' }
            : false
        }
        animate={{ backgroundColor: 'rgba(0,0,0,0)' }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={cn(
          'rounded px-1.5 py-0.5 font-mono text-[12px] font-medium tabular-nums',
          'min-w-[64px] text-right'
        )}
      >
        {price != null ? `$${fmtPrice(price)}` : '—'}
      </motion.span>
      <span
        className={cn(
          'flex items-center gap-0.5 text-[11px] font-semibold tabular-nums min-w-[52px] justify-end',
          changePct == null
            ? 'text-muted-foreground'
            : isUp
            ? 'text-emerald-500'
            : 'text-rose-500'
        )}
      >
        {changePct != null &&
          (isUp ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          ))}
        {changePct != null ? `${isUp ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
      </span>
    </div>
  );
}

export function LiveTickerBar({ symbols = DEFAULT_SYMBOLS, className }: LiveTickerBarProps) {
  const { tickers, status } = useLiveTicker(symbols);

  // Render the symbols twice (for an optional marquee effect) — but we keep it
  // simple: a horizontally scrollable flex row that the user can swipe on
  // mobile and which fits naturally on desktop.
  const cells = useMemo(() => symbols, [symbols]);

  // Whether we've received any data yet — derived directly, no state needed.
  const hasData = Object.keys(tickers).length > 0;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-border/60 bg-card/30 backdrop-blur supports-[backdrop-filter]:bg-card/20',
        className
      )}
      role="region"
      aria-label="Live crypto price ticker"
    >
      <div className="flex items-stretch">
        {/* Left — LIVE badge with stronger triple-pulse */}
        <div className="relative flex items-center gap-2 px-3 py-1.5 border-r border-border/40 bg-emerald-500/[0.06] shrink-0 overflow-hidden">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.18),transparent_70%)]"
          />
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-50"
              style={{ animationDelay: '0.4s' }}
            />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
          </span>
          <span className="relative text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]">
            Live
          </span>
        </div>

        {/* Middle — scrolling ticker */}
        <div
          className="flex-1 overflow-x-auto scrollbar-thin"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="flex items-center divide-x divide-border/30">
            {cells.map((s) => (
              <TickerCell key={s} symbol={s} ticker={tickers[s]} />
            ))}
          </div>
        </div>

        {/* Right — connection status */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-l border-border/40 bg-muted/20 shrink-0">
          <StatusDot status={status} />
          {!hasData && status !== 'connected' && (
            <span className="text-[10px] text-muted-foreground hidden md:inline">
              awaiting feed
            </span>
          )}
        </div>
      </div>

      {/* Tiny shimmer hint when no data has arrived yet */}
      <AnimatePresence>
        {!hasData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-y-0 left-16 right-24 bg-gradient-to-r from-transparent via-foreground/[0.04] to-transparent"
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default LiveTickerBar;
