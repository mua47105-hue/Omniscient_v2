'use client';

import * as React from 'react';

/**
 * Inline-SVG used-vs-saved sparkline. Renders two layers:
 *   1. Emerald filled area = cumulative tokens saved
 *   2. Amber line = cumulative tokens used
 *
 * Both lines share a common y-scale (the larger of the two maxima) so the
 * visual ratio is honest. Falls back to a "collecting…" state when fewer than
 * two samples are available.
 */
export interface SparklineProps {
  samples: Array<{ tokensUsed: number; tokensSaved: number; ts: number }>;
  width?: number;
  height?: number;
}

export function Sparkline({
  samples,
  width = 220,
  height = 44,
}: SparklineProps): React.ReactElement {
  if (samples.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground"
        style={{ width, height }}
      >
        collecting…
      </div>
    );
  }

  const pad = 3;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const n = samples.length;
  const maxY = Math.max(
    1,
    ...samples.map((s) => Math.max(s.tokensUsed, s.tokensSaved)),
  );

  const xAt = (i: number) => pad + (n === 1 ? 0 : (i / (n - 1)) * w);
  const yAt = (v: number) => pad + h - (v / maxY) * h;

  // Saved (filled emerald area)
  const savedPath =
    `M ${xAt(0).toFixed(1)} ${yAt(samples[0].tokensSaved).toFixed(1)}` +
    samples
      .slice(1)
      .map((s, i) => ` L ${xAt(i + 1).toFixed(1)} ${yAt(s.tokensSaved).toFixed(1)}`)
      .join('');
  const savedArea = `${savedPath} L ${xAt(n - 1).toFixed(1)} ${pad + h} L ${xAt(0).toFixed(
    1,
  )} ${pad + h} Z`;

  // Used (amber line)
  const usedPath =
    `M ${xAt(0).toFixed(1)} ${yAt(samples[0].tokensUsed).toFixed(1)}` +
    samples
      .slice(1)
      .map((s, i) => ` L ${xAt(i + 1).toFixed(1)} ${yAt(s.tokensUsed).toFixed(1)}`)
      .join('');

  const last = samples[n - 1];
  const lastX = xAt(n - 1);
  const lastY = yAt(last.tokensUsed);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      role="img"
      aria-label="Token economy sparkline"
    >
      <defs>
        <linearGradient id="spark-saved" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.72 0.18 160)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="oklch(0.72 0.18 160)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={savedArea} fill="url(#spark-saved)" />
      <path
        d={savedPath}
        fill="none"
        stroke="oklch(0.72 0.18 160)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={usedPath}
        fill="none"
        stroke="oklch(0.75 0.18 75)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill="oklch(0.75 0.18 75)" />
    </svg>
  );
}
