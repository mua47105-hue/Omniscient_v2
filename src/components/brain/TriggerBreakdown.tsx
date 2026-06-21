'use client';

import { cn } from '@/lib/utils';

interface TriggerBreakdownProps {
  news: number;
  crossAsset: number;
  manual: number;
  size?: number;
  className?: string;
}

/**
 * Compact donut chart for the trigger-source breakdown (news / cross-asset /
 * manual). Inline SVG — no chart lib (ponytail: the platform has <svg>). Each
 * segment is an arc colored by source. Center shows the total. Empty state
 * shows a muted ring + "no triggers yet".
 */
export function TriggerBreakdown({ news, crossAsset, manual, size = 120, className }: TriggerBreakdownProps) {
  const total = news + crossAsset + manual;
  const r = (size - 16) / 2; // radius with 8px padding
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  const segments = [
    { count: news, color: '#f59e0b', label: 'news' },        // amber
    { count: crossAsset, color: '#a855f7', label: 'cross-asset' }, // violet
    { count: manual, color: '#38bdf8', label: 'manual' },     // sky
  ].filter((s) => s.count > 0);

  // Build arc segments. Each segment's length = (count/total) * circumference.
  let offset = 0;
  const arcs = segments.map((s) => {
    const fraction = total > 0 ? s.count / total : 0;
    const length = fraction * circumference;
    const arc = { ...s, length, offset, dasharray: `${length} ${circumference - length}` };
    offset += length;
    return arc;
  });

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <svg width={size} height={size} className="shrink-0" role="img" aria-label={`Trigger breakdown: ${total} total (${news} news, ${crossAsset} cross-asset, ${manual} manual)`}>
        {/* Background ring (muted) */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="10" />
        {total === 0 ? (
          // Empty state — dashed muted ring
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="10" strokeDasharray="4 6" />
        ) : (
          arcs.map((a, i) => (
            <circle
              key={i}
              cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth="10"
              strokeDasharray={a.dasharray}
              strokeDashoffset={-a.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
            />
          ))
        )}
        {/* Center total */}
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-foreground" fontSize="18" fontWeight="700">
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
          triggers
        </text>
      </svg>
      {/* Legend */}
      <div className="space-y-1 text-[11px]">
        <LegendRow color="#f59e0b" label="News" count={news} />
        <LegendRow color="#a855f7" label="Cross-asset" count={crossAsset} />
        <LegendRow color="#38bdf8" label="Manual" count={manual} />
      </div>
    </div>
  );
}

function LegendRow({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground flex-1">{label}</span>
      <span className="font-mono tabular-nums font-semibold">{count}</span>
    </div>
  );
}
