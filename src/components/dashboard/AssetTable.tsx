import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

interface AssetRow {
  symbol: string;
  name?: string;
  price: number;
  changePct: number;
  quoteVolume?: number;
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtVol(v?: number): string {
  if (!v) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// Tiny SVG polyline sparkline — derived from a deterministic 7-tick pseudo
// history of the change% so the visual gives a directional hint without
// needing real kline history in this stripped-down table.
function MiniSpark({ changePct }: { changePct: number }) {
  const up = changePct >= 0;
  // Deterministic 7-point walk biased by direction.
  const points = Array.from({ length: 7 }, (_, i) => {
    const noise = Math.sin(i * 1.7 + Math.abs(changePct)) * 0.5;
    const drift = up ? i * 0.18 : -i * 0.18;
    return 0.5 + noise * 0.18 + drift * 0.18;
  });
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(0.001, max - min);
  const w = 56;
  const h = 14;
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const stroke = up ? '#10b981' : '#f43f5e';
  const fill = up ? 'rgba(16,185,129,0.18)' : 'rgba(244,63,94,0.18)';
  const areaPath = `M0,${h} L${coords} L${w},${h} Z`;
  return (
    <svg
      aria-hidden
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0 overflow-visible"
      title={`${up ? '+' : ''}${changePct.toFixed(2)}%`}
    >
      <path d={areaPath} fill={fill} stroke="none" />
      <polyline
        points={coords}
        fill="none"
        stroke={stroke}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={w}
        cy={h - ((points[points.length - 1] - min) / range) * (h - 2) - 1}
        r={1.5}
        fill={stroke}
      />
    </svg>
  );
}

export function AssetTable({ rows, hrefBase = '/crypto' }: { rows: AssetRow[]; hrefBase?: string }) {
  return (
    <div className="rounded-lg border border-border/70 overflow-hidden ring-1 ring-inset ring-border/20">
      <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border/60">
        <span>Asset</span>
        <span className="text-right">Price</span>
        <span className="text-right">24h %</span>
        <span className="text-right hidden sm:block">Volume</span>
      </div>
      <div className="divide-y divide-border/40">
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No data</div>
        )}
        {rows.map((r) => {
          const up = r.changePct >= 0;
          return (
            <Link
              key={r.symbol}
              href={`${hrefBase}/${encodeURIComponent(r.symbol)}`}
              className={cn(
                'group relative grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 px-4 py-3 items-center transition-all duration-200 ease-out',
                'hover:bg-muted/40 hover:pl-5 focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500',
              )}
            >
              {/* Left accent on hover */}
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[2px] rounded-r-full bg-gradient-to-b from-emerald-400 to-teal-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              />
              <span className="flex items-center gap-2 min-w-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-muted to-muted/50 text-[10px] font-bold uppercase ring-1 ring-inset ring-border/40 transition-transform duration-200 group-hover:scale-105">
                  {r.symbol.replace('USDT', '').slice(0, 3)}
                </span>
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold truncate group-hover:text-emerald-500 transition-colors duration-200">
                    {r.symbol.replace('USDT', '')}
                  </span>
                  {r.name && (
                    <span className="text-[11px] text-muted-foreground truncate">{r.name}</span>
                  )}
                </span>
              </span>
              <span className="text-right text-sm font-mono tabular-nums">
                ${fmtPrice(r.price)}
              </span>
              <span className="flex items-center justify-end gap-1.5">
                <MiniSpark changePct={r.changePct} />
                <span
                  className={cn(
                    'text-right text-sm font-semibold tabular-nums',
                    up ? 'text-emerald-500' : 'text-rose-500',
                  )}
                >
                  {up ? '+' : ''}
                  {r.changePct.toFixed(2)}%
                </span>
              </span>
              <span className="text-right text-xs text-muted-foreground hidden sm:block tabular-nums">
                {fmtVol(r.quoteVolume)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
