'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

interface PricesResponse {
  success?: boolean;
  data?: Array<{
    symbol: string;
    lastPrice: number;
    priceChangePercent: number;
    quoteVolume?: number;
    volume?: number;
    high?: number;
    low?: number;
  }>;
}

interface LiveTickerBarProps {
  symbols?: string[];
}

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
  'MATICUSDT',
  'DOTUSDT',
  'TONUSDT',
];

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/**
 * Scrolling ticker bar. Duplicates the symbol list so the marquee loops
 * seamlessly (50% translate-x). Pauses on hover.
 */
export function LiveTickerBar({ symbols = DEFAULT_SYMBOLS }: LiveTickerBarProps): React.ReactElement {
  const { data } = useQuery<PricesResponse>({
    queryKey: ['crypto-prices-ticker', symbols.join(',')],
    queryFn: async () => {
      const res = await fetch('/api/crypto/prices');
      if (!res.ok) throw new Error('prices fetch failed');
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const items = data?.data ?? [];

  return (
    <div className="border-b border-border bg-card/40">
      <div className="relative overflow-hidden whitespace-nowrap py-1.5">
        <div className="animate-ticker inline-flex gap-6 px-4">
          {[...items, ...items].map((it, i) => {
            const positive = it.priceChangePercent >= 0;
            return (
              <span
                key={`${it.symbol}-${i}`}
                className="inline-flex items-center gap-1.5 text-[11px]"
              >
                <span className="font-medium text-foreground">{it.symbol.replace('USDT', '')}</span>
                <span className="font-mono text-muted-foreground">${fmtPrice(it.lastPrice)}</span>
                <span
                  className={`font-mono ${positive ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {positive ? '+' : ''}
                  {it.priceChangePercent.toFixed(2)}%
                </span>
              </span>
            );
          })}
          {items.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">Loading live prices…</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
