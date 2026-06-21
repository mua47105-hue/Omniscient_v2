'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface AssetRow {
  symbol: string;
  price: number;
  changePct?: number;
  volume?: number;
  quoteVolume?: number;
  name?: string;
}

interface AssetTableProps {
  rows: AssetRow[];
  className?: string;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtVol(n?: number): string {
  if (!n || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function AssetTable({ rows, className }: AssetTableProps): React.ReactElement {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-2 text-left font-medium">Symbol</th>
            <th className="px-2 py-2 text-right font-medium">Price</th>
            <th className="px-2 py-2 text-right font-medium">24h %</th>
            <th className="px-2 py-2 text-right font-medium">Volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                No data
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const positive = (r.changePct ?? 0) >= 0;
              return (
                <tr
                  key={r.symbol}
                  className="border-b border-border/50 transition-colors hover:bg-muted/30"
                >
                  <td className="px-2 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {r.symbol.replace('USDT', '')}
                      </span>
                      {r.name ? (
                        <span className="text-[10px] text-muted-foreground">{r.name}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-foreground">
                    ${fmtPrice(r.price)}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-2 text-right font-mono',
                      positive ? 'text-emerald-400' : 'text-rose-400',
                    )}
                  >
                    {positive ? '+' : ''}
                    {(r.changePct ?? 0).toFixed(2)}%
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                    {fmtVol(r.quoteVolume ?? r.volume)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
