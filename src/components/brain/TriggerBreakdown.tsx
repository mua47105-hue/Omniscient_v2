'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TriggerSegment {
  key: 'news' | 'cross-asset' | 'manual';
  label: string;
  count: number;
  color: string; // oklch stroke
}

interface TriggerBreakdownProps {
  segments: TriggerSegment[];
  size?: number;
}

const SEGMENT_META: Record<TriggerSegment['key'], { color: string; label: string }> = {
  news: { color: 'oklch(0.75 0.18 75)', label: 'News' },
  'cross-asset': { color: 'oklch(0.70 0.18 290)', label: 'Cross-asset' },
  manual: { color: 'oklch(0.70 0.18 230)', label: 'Manual' },
};

/**
 * Interactive donut. Hovering a segment (or its legend row) thickens the arc
 * and dims the others, and the center readout switches to that segment's
 * count + label. Empty state renders a dashed muted ring.
 */
export function TriggerBreakdown({
  segments,
  size = 140,
}: TriggerBreakdownProps): React.ReactElement {
  const [hovered, setHovered] = React.useState<TriggerSegment['key'] | null>(null);

  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const pad = 2;
  const center = size / 2;
  const radius = center - pad - 6;
  const innerRadius = radius - 12;
  const circumference = 2 * Math.PI * radius;

  const activeCount = hovered
    ? segments.find((s) => s.key === hovered)?.count ?? 0
    : total;
  const activeLabel = hovered
    ? SEGMENT_META[hovered].label
    : 'Triggers';

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-4">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="oklch(0.30 0.014 264 / 0.7)"
            strokeWidth="2"
            strokeDasharray="4 6"
          />
        </svg>
        <div className="text-center">
          <div className="text-xs font-semibold text-muted-foreground">No triggers yet</div>
          <div className="text-[10px] text-muted-foreground/70">The brain is calm</div>
        </div>
      </div>
    );
  }

  // Pre-compute each segment's starting offset via a pure fold (no mutation
  // inside .map, which the react-hooks/immutability lint rule disallows).
  const segmentLayout = segments.reduce<
    Array<{ seg: (typeof segments)[number]; length: number; startOffset: number }>
  >((acc, s) => {
    const fraction = s.count / total;
    const length = fraction * circumference;
    const startOffset = acc.length > 0 ? acc[acc.length - 1].startOffset + acc[acc.length - 1].length : 0;
    return [...acc, { seg: s, length, startOffset }];
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segmentLayout.map(({ seg, length, startOffset }) => {
          const isHovered = hovered === seg.key;
          const isDimmed = hovered !== null && !isHovered;
          const dash = `${length} ${circumference - length}`;
          const rotation = (startOffset / circumference) * 360 - 90;
          return (
            <circle
              key={seg.key}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={SEGMENT_META[seg.key].color}
              strokeWidth={isHovered ? 14 : 10}
              strokeDasharray={dash}
              strokeDashoffset={-((rotation + 90) / 360) * circumference}
              transform={`rotate(${rotation} ${center} ${center})`}
              opacity={isDimmed ? 0.35 : 1}
              style={{ transition: 'stroke-width 150ms ease, opacity 150ms ease', cursor: 'pointer' }}
              onMouseEnter={() => setHovered(seg.key)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
        <circle
          cx={center}
          cy={center}
          r={innerRadius}
          fill="oklch(0.20 0.014 264)"
          stroke="oklch(0.30 0.014 264 / 0.7)"
          strokeWidth="1"
        />
        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 18, fontWeight: 700 }}
        >
          {activeCount}
        </text>
        <text
          x={center}
          y={center + 12}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {activeLabel}
        </text>
      </svg>
      <div className="grid w-full grid-cols-1 gap-1">
        {segments.map((s) => (
          <div
            key={s.key}
            className={cn(
              'flex items-center justify-between rounded px-2 py-1 text-xs transition-colors',
              hovered === s.key ? 'bg-muted/60' : 'hover:bg-muted/30',
              hovered !== null && hovered !== s.key && 'opacity-50',
            )}
            onMouseEnter={() => setHovered(s.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: SEGMENT_META[s.key].color }}
              />
              <span className="text-muted-foreground">{SEGMENT_META[s.key].label}</span>
            </div>
            <span className="font-mono text-foreground">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
