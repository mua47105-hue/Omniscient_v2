// Pure-TS statistical helpers for the Correlation Matrix page.
// NO React, NO DOM, NO Next.js — fully unit-testable in isolation.
//
// All functions live here so the UI component stays declarative and the math
// can be re-used by other analytics (portfolio risk, hedging, etc.) without
// duplicating logic.

/**
 * A single cell in the N×N correlation matrix.
 * `i` and `j` are matrix indices (0-based) into the ordered symbol list,
 * `a` and `b` are the actual asset symbols. `r` is the Pearson coefficient
 * in [-1, +1]; the diagonal has r = 1 (self-correlation).
 */
export interface CorrelationCell {
  i: number;
  j: number;
  a: string;
  b: string;
  r: number;
  n: number;          // sample size used (number of overlapping returns)
  diagonal: boolean;  // true when a === b
}

export interface CorrelationInterpretation {
  label: string;       // "Strong positive" | "Weak positive" | "Neutral" | "Weak negative" | "Strong negative"
  color: string;       // hex color suitable for badges / accents
  advice: string;      // human-readable diversification advice
  /** CSS rgba() background color: red channel for r<0, green channel for r>0, alpha scales with |r|. */
  rgba: string;
  /** Plain {r, g, b, a} for callers that need raw channels. */
  channels: { r: number; g: number; b: number; a: number };
}

/**
 * Pearson product-moment correlation coefficient.
 * Returns NaN if either series has fewer than 2 valid paired observations or
 * zero variance in either series (would divide by zero).
 *
 * Formula:  r = Σ((xᵢ-x̄)(yᵢ-ȳ)) / sqrt(Σ(xᵢ-x̄)² · Σ(yᵢ-ȳ)²)
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  if (!Array.isArray(x) || !Array.isArray(y)) return NaN;
  const n = Math.min(x.length, y.length);
  if (n < 2) return NaN;

  // Pair up only finite values from both series (drops NaNs/undefined).
  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    const xv = x[k];
    const yv = y[k];
    if (typeof xv === 'number' && typeof yv === 'number' && isFinite(xv) && isFinite(yv)) {
      pairs.push([xv, yv]);
    }
  }
  const m = pairs.length;
  if (m < 2) return NaN;

  let sumX = 0;
  let sumY = 0;
  for (const [xv, yv] of pairs) {
    sumX += xv;
    sumY += yv;
  }
  const meanX = sumX / m;
  const meanY = sumY / m;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const [xv, yv] of pairs) {
    const dx = xv - meanX;
    const dy = yv - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return NaN;
  const r = num / den;
  // Clamp to [-1, +1] to guard against floating-point overshoot.
  return Math.max(-1, Math.min(1, r));
}

/**
 * Build the full N×N correlation matrix from a {symbol: returns[]} map.
 *
 * - Aligns series by INDEX (callers must pre-align by date or accept that we
 *   simply use the overlapping tail; the API route aligns by date).
 * - Diagonal cells get r = 1 and `diagonal: true`.
 * - The matrix is symmetric — we still emit both (i,j) and (j,i) for easier
 *   rendering as a flat list indexed by row-major order.
 */
export function computeCorrelationMatrix(returns: Record<string, number[]>): CorrelationCell[] {
  const symbols = Object.keys(returns);
  const cells: CorrelationCell[] = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = 0; j < symbols.length; j++) {
      const a = symbols[i];
      const b = symbols[j];
      const x = returns[a];
      const y = returns[b];
      const diagonal = i === j;
      const r = diagonal ? 1 : pearsonCorrelation(x, y);
      // Effective sample size = overlapping finite pairs.
      let n = 0;
      if (x && y) {
        const len = Math.min(x.length, y.length);
        for (let k = 0; k < len; k++) {
          if (isFinite(x[k]) && isFinite(y[k])) n++;
        }
      }
      cells.push({ i, j, a, b, r, n, diagonal });
    }
  }
  return cells;
}

/**
 * Diversification score (0–100) for the selected universe.
 *
 * Formula:  score = 100 × (1 − avg(|rᵢⱼ|))
 *   - only off-diagonal cells (i ≠ j) are averaged
 *   - if no off-diagonal cells exist, returns 100 (vacuously diversified)
 *   - lower average pairwise correlation → higher score
 *
 * Interpretation:
 *   < 30  → poor diversification (rose)
 *   30–60 → moderate (amber)
 *   > 60  → well diversified (emerald)
 */
export function computeDiversificationScore(matrix: CorrelationCell[]): number {
  const off = matrix.filter((c) => !c.diagonal && isFinite(c.r));
  if (off.length === 0) return 100;
  let sum = 0;
  for (const c of off) sum += Math.abs(c.r);
  const avg = sum / off.length;
  const score = 100 * (1 - avg);
  // Clamp to [0, 100].
  return Math.max(0, Math.min(100, score));
}

/**
 * Average absolute correlation — exposed for the UI to show alongside the
 * diversification score (e.g. "avg |r| = 0.42 → score 58").
 */
export function averageAbsoluteCorrelation(matrix: CorrelationCell[]): number {
  const off = matrix.filter((c) => !c.diagonal && isFinite(c.r));
  if (off.length === 0) return 0;
  let sum = 0;
  for (const c of off) sum += Math.abs(c.r);
  return sum / off.length;
}

/**
 * Human-readable interpretation of a correlation value.
 *
 * Thresholds (|r|):
 *   ≥ 0.7  Strong — moves together / apart
 *   ≥ 0.4  Moderate
 *   ≥ 0.2  Weak
 *   < 0.2  Negligible / uncorrelated
 */
export function interpretCorrelation(r: number): CorrelationInterpretation {
  const ar = isFinite(r) ? r : 0;
  const abs = Math.abs(ar);

  let label: string;
  let advice: string;
  if (ar >= 0.7) {
    label = 'Strong positive';
    advice = 'Move together strongly — poor diversifier, redundancy risk.';
  } else if (ar >= 0.4) {
    label = 'Moderate positive';
    advice = 'Tend to move together — limited diversification benefit.';
  } else if (ar >= 0.2) {
    label = 'Weak positive';
    advice = 'Loosely correlated — some diversification benefit.';
  } else if (ar > -0.2) {
    label = 'Uncorrelated';
    advice = 'Independent — strong diversifier.';
  } else if (ar > -0.4) {
    label = 'Weak negative';
    advice = 'Mildly inversely correlated — modest hedge.';
  } else if (ar > -0.7) {
    label = 'Moderate negative';
    advice = 'Moves against — useful hedge.';
  } else {
    label = 'Strong negative';
    advice = 'Strong inverse — excellent hedge opportunity.';
  }

  // Color: rose (-1) → zinc (0) → emerald (+1)
  // We use a perceptually clean stop set rather than a literal hue rotation.
  let color: string;
  if (ar >= 0.7) color = '#059669';      // emerald-600
  else if (ar >= 0.4) color = '#10b981'; // emerald-500
  else if (ar >= 0.2) color = '#34d399'; // emerald-400
  else if (ar > -0.2) color = '#71717a'; // zinc-500
  else if (ar > -0.4) color = '#fb7185'; // rose-400
  else if (ar > -0.7) color = '#f43f5e'; // rose-500
  else color = '#e11d48';                 // rose-600

  // rgba channels for the heatmap background.
  // alpha = abs(r) * 0.85 + 0.08 (so even near-zero r still has a faint tint).
  const alpha = Math.min(1, abs * 0.85 + 0.08);
  let red: number;
  let green: number;
  let blue: number;
  if (ar >= 0) {
    // green channel: 16 (emerald-500 dark) at r=1, fade to neutral
    red = 16;
    green = Math.round(185 * ar + 39 * (1 - ar)); // 39 = zinc-700-ish
    blue = Math.round(129 * ar + 50 * (1 - ar));
  } else {
    // red channel: rose-500 at r=-1, fade to neutral
    const a = -ar; // 0..1
    red = Math.round(244 * a + 39 * (1 - a));
    green = Math.round(63 * a + 39 * (1 - a));
    blue = Math.round(94 * a + 50 * (1 - a));
  }
  const rgba = `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;

  return { label, color, advice, rgba, channels: { r: red, g: green, b: blue, a: alpha } };
}

/**
 * Compute daily percentage returns from a price series.
 *   returns[i] = (close[i] - close[i-1]) / close[i-1] * 100
 * The first element is dropped (no prior close), so length = prices.length - 1.
 * Returns [] for any input shorter than 2.
 */
export function dailyReturns(prices: number[]): number[] {
  if (!Array.isArray(prices) || prices.length < 2) return [];
  const out: number[] = new Array(prices.length - 1);
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const cur = prices[i];
    if (prev === 0 || !isFinite(prev) || !isFinite(cur)) {
      out[i - 1] = NaN;
    } else {
      out[i - 1] = ((cur - prev) / prev) * 100;
    }
  }
  return out;
}

/**
 * Simple linear regression (ordinary least squares) for a scatter plot's
 * regression line. Returns slope, intercept, and two endpoint [x, y] pairs
 * suitable for recharts' Line component.
 *
 *   y = slope · x + intercept
 */
export function linearRegression(
  x: number[],
  y: number[],
): { slope: number; intercept: number; r: number; points: Array<{ x: number; y: number }> } {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { slope: 0, intercept: 0, r: 0, points: [] };
  const pairs: Array<[number, number]> = [];
  let minX = Infinity;
  let maxX = -Infinity;
  for (let k = 0; k < n; k++) {
    const xv = x[k];
    const yv = y[k];
    if (isFinite(xv) && isFinite(yv)) {
      pairs.push([xv, yv]);
      if (xv < minX) minX = xv;
      if (xv > maxX) maxX = xv;
    }
  }
  if (pairs.length < 2 || !isFinite(minX) || !isFinite(maxX) || minX === maxX) {
    return { slope: 0, intercept: 0, r: pearsonCorrelation(x, y), points: [] };
  }
  let sumX = 0;
  let sumY = 0;
  for (const [xv, yv] of pairs) {
    sumX += xv;
    sumY += yv;
  }
  const mx = sumX / pairs.length;
  const my = sumY / pairs.length;
  let num = 0;
  let den = 0;
  for (const [xv, yv] of pairs) {
    num += (xv - mx) * (yv - my);
    den += (xv - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const r = pearsonCorrelation(
    pairs.map((p) => p[0]),
    pairs.map((p) => p[1]),
  );
  // Two endpoints spanning the x-range — recharts renders them as a straight Line.
  const points = [
    { x: minX, y: slope * minX + intercept },
    { x: maxX, y: slope * maxX + intercept },
  ];
  return { slope, intercept, r, points };
}

/**
 * Sort off-diagonal cells by correlation (descending or ascending) and return
 * the top N pairs. Each pair appears only once (we dedupe (i,j) vs (j,i) by
 * requiring i < j).
 */
export function topPairs(
  matrix: CorrelationCell[],
  direction: 'positive' | 'negative',
  limit = 5,
): CorrelationCell[] {
  const seen = new Set<string>();
  const unique: CorrelationCell[] = [];
  for (const c of matrix) {
    if (c.diagonal) continue;
    if (!isFinite(c.r)) continue;
    if (c.i >= c.j) continue; // dedupe
    const key = `${c.a}|${c.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  unique.sort((a, b) => (direction === 'positive' ? b.r - a.r : a.r - b.r));
  return unique.slice(0, limit);
}
