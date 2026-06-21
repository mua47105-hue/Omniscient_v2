'use client';

import { useMemo } from 'react';

interface SparklineProps {
  /** Cumulative token-economy samples (newest last). */
  samples: { ts: number; tokensUsed: number; tokensSaved: number }[];
  /** Pixel dimensions. */
  width?: number;
  height?: number;
  /** Which series to draw. */
  series?: 'saved' | 'both';
  className?: string;
}

/**
 * Minimal inline-SVG sparkline for the token-economy timeline. No chart lib
 * (ponytail: the platform has <svg>) — just a polyline. Draws tokensSaved as
 * an emerald area + tokensUsed as a sky line so the gap (the savings) reads
 * visually. Gracefully handles <2 samples (flat line).
 */
export function Sparkline({ samples, width = 240, height = 48, series = 'both', className }: SparklineProps) {
  const { savedPath, usedPath, areaPath, lastSaved, maxV } = useMemo(() => {
    if (samples.length < 2) {
      return { savedPath: '', usedPath: '', areaPath: '', lastSaved: 0, maxV: 1 };
    }
    const maxV = Math.max(1, ...samples.map((s) => Math.max(s.tokensUsed, s.tokensSaved)));
    const n = samples.length;
    const x = (i: number) => (i / (n - 1)) * width;
    const y = (v: number) => height - (v / maxV) * (height - 4) - 2;
    const savedPts = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.tokensSaved).toFixed(1)}`);
    const usedPts = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.tokensUsed).toFixed(1)}`);
    const savedPath = `M ${savedPts.join(' L ')}`;
    const usedPath = `M ${usedPts.join(' L ')}`;
    // Area under the saved curve (for the fill).
    const areaPath = `${savedPath} L ${width},${height} L 0,${height} Z`;
    return { savedPath, usedPath, areaPath, lastSaved: samples[n - 1].tokensSaved, maxV };
  }, [samples, width, height]);

  if (samples.length < 2) {
    return (
      <svg width={width} height={height} className={className} role="img" aria-label="token savings timeline — collecting data">
        <text x="4" y={height / 2 + 4} fill="currentColor" fontSize="10" opacity="0.5">collecting…</text>
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className={className} role="img" aria-label={`token savings timeline — ${lastSaved.toLocaleString()} saved`}>
      <defs>
        <linearGradient id="spark-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Grid baseline */}
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
      {/* Saved area (emerald fill) */}
      {series === 'both' && <path d={areaPath} fill="url(#spark-area)" />}
      {/* Used line (sky) */}
      {series === 'both' && <path d={usedPath} fill="none" stroke="rgb(56 189 248)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />}
      {/* Saved line (emerald) */}
      <path d={savedPath} fill="none" stroke="rgb(16 185 129)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* Last-point dot */}
      <circle cx={width} cy={height - (lastSaved / maxV) * (height - 4) - 2} r="2.5" fill="rgb(16 185 129)" />
    </svg>
  );
}
