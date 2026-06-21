'use client';

import { useMemo } from 'react';

interface SavedAreaChartProps {
  samples: { ts: number; tokensSaved: number; tokensUsed: number }[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Dedicated "tokens saved over time" area chart — distinct from the used-vs-saved
 * sparkline. Shows cumulative savings growing as an emerald filled area, making
 * the ponytail token-economy benefit tangible over time. Inline SVG (no chart lib).
 * Handles <2 samples with a "collecting…" state.
 */
export function SavedAreaChart({ samples, width = 280, height = 64, className }: SavedAreaChartProps) {
  const { areaPath, linePath, lastSaved, maxV, hasData } = useMemo(() => {
    if (samples.length < 2) return { areaPath: '', linePath: '', lastSaved: 0, maxV: 1, hasData: false };
    const maxV = Math.max(1, ...samples.map((s) => s.tokensSaved));
    const n = samples.length;
    const x = (i: number) => (i / (n - 1)) * width;
    const y = (v: number) => height - (v / maxV) * (height - 6) - 3;
    const linePts = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.tokensSaved).toFixed(1)}`);
    const linePath = `M ${linePts.join(' L ')}`;
    const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
    return { areaPath, linePath, lastSaved: samples[n - 1].tokensSaved, maxV, hasData: true };
  }, [samples, width, height]);

  if (!hasData) {
    return (
      <svg width={width} height={height} className={className} role="img" aria-label="tokens saved over time — collecting data">
        <text x="4" y={height / 2 + 4} fill="currentColor" fontSize="10" opacity="0.5">collecting data…</text>
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className={className} role="img" aria-label={`tokens saved over time — ${lastSaved.toLocaleString()} saved cumulatively`}>
      <defs>
        <linearGradient id="saved-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {/* Baseline */}
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
      {/* Filled area */}
      <path d={areaPath} fill="url(#saved-area-grad)" />
      {/* Top line */}
      <path d={linePath} fill="none" stroke="rgb(16 185 129)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* Last-point dot */}
      <circle cx={width} cy={height - (lastSaved / maxV) * (height - 6) - 3} r="3" fill="rgb(16 185 129)" />
      <circle cx={width} cy={height - (lastSaved / maxV) * (height - 6) - 3} r="5" fill="rgb(16 185 129)" fillOpacity="0.3" />
    </svg>
  );
}
