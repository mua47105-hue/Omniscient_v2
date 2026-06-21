'use client';

import * as React from 'react';

/**
 * Cumulative-tokens-saved area chart. Single emerald-filled area + line + a
 * glowing dot on the latest sample. Pure inline SVG — no chart library.
 */
export interface SavedAreaChartProps {
  samples: Array<{ tokensSaved: number; ts: number }>;
  width?: number;
  height?: number;
}

export function SavedAreaChart({
  samples,
  width = 300,
  height = 70,
}: SavedAreaChartProps): React.ReactElement {
  if (samples.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground"
        style={{ width, height }}
      >
        collecting data…
      </div>
    );
  }

  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const n = samples.length;
  const maxY = Math.max(1, ...samples.map((s) => s.tokensSaved));

  const xAt = (i: number) => pad + (n === 1 ? 0 : (i / (n - 1)) * w);
  const yAt = (v: number) => pad + h - (v / maxY) * h;

  const linePath =
    `M ${xAt(0).toFixed(1)} ${yAt(samples[0].tokensSaved).toFixed(1)}` +
    samples
      .slice(1)
      .map((s, i) => ` L ${xAt(i + 1).toFixed(1)} ${yAt(s.tokensSaved).toFixed(1)}`)
      .join('');
  const areaPath = `${linePath} L ${xAt(n - 1).toFixed(1)} ${pad + h} L ${xAt(0).toFixed(
    1,
  )} ${pad + h} Z`;

  const last = samples[n - 1];
  const lastX = xAt(n - 1);
  const lastY = yAt(last.tokensSaved);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      role="img"
      aria-label="Cumulative tokens saved"
    >
      <defs>
        <linearGradient id="saved-area-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.72 0.18 160)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="oklch(0.72 0.18 160)" stopOpacity="0.02" />
        </linearGradient>
        <filter id="saved-dot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={areaPath} fill="url(#saved-area-grad)" />
      <path
        d={linePath}
        fill="none"
        stroke="oklch(0.78 0.18 160)"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="3.5"
        fill="oklch(0.85 0.18 160)"
        filter="url(#saved-dot-glow)"
      />
    </svg>
  );
}
