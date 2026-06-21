/**
 * Screener scan API — runs 14 technical filters across all crypto assets.
 *
 * GET /api/screener/scan?filters=rsi_oversold,macd_bullish_cross,...
 *
 * Filters:
 *   1.  rsi_oversold      RSI < 30
 *   2.  rsi_overbought    RSI > 70
 *   3.  macd_bullish      MACD histogram > 0
 *   4.  macd_bearish      MACD histogram < 0
 *   5.  macd_bull_cross   MACD line crossed above signal (last 3 bars)
 *   6.  macd_bear_cross   MACD line crossed below signal (last 3 bars)
 *   7.  ema_bull           EMA12 > EMA26 (golden cross territory)
 *   8.  ema_bear           EMA12 < EMA26 (death cross territory)
 *   9.  bb_breakout_up     close > BB upper
 *   10. bb_breakout_down   close < BB lower
 *   11. vol_spike          last volume > 2× SMA-20 volume
 *   12. near_support       close within 1% of nearest support level
 *   13. near_resistance    close within 1% of nearest resistance level
 *   14. trend_up / trend_down
 *
 * Returns matching assets with the filter that triggered + indicator snapshot.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getKlines } from '@/lib/market/binance';
import { computeIndicators, findLevels, sma, macd as computeMacd } from '@/lib/market/indicators';
import type { Kline, TechnicalIndicators } from '@/lib/types';

export const dynamic = 'force-dynamic';

type FilterKey =
  | 'rsi_oversold'
  | 'rsi_overbought'
  | 'macd_bullish'
  | 'macd_bearish'
  | 'macd_bull_cross'
  | 'macd_bear_cross'
  | 'ema_bull'
  | 'ema_bear'
  | 'bb_breakout_up'
  | 'bb_breakout_down'
  | 'vol_spike'
  | 'near_support'
  | 'near_resistance'
  | 'trend_up'
  | 'trend_down';

const ALL_FILTERS: FilterKey[] = [
  'rsi_oversold',
  'rsi_overbought',
  'macd_bullish',
  'macd_bearish',
  'macd_bull_cross',
  'macd_bear_cross',
  'ema_bull',
  'ema_bear',
  'bb_breakout_up',
  'bb_breakout_down',
  'vol_spike',
  'near_support',
  'near_resistance',
  'trend_up',
  'trend_down',
];

interface MatchedFilter {
  key: FilterKey;
  label: string;
  detail: string;
}

interface ScreenerResult {
  symbol: string;
  name: string;
  price: number;
  changePct24h?: number;
  matchedFilters: MatchedFilter[];
  indicators: TechnicalIndicators;
  nearSupport?: number;
  nearResistance?: number;
}

/**
 * Run a single filter against an asset's klines + indicators.
 * Returns a MatchedFilter if triggered, null otherwise.
 */
function runFilter(
  key: FilterKey,
  klines: Kline[],
  ind: TechnicalIndicators,
): MatchedFilter | null {
  const lastClose = ind.lastClose ?? klines[klines.length - 1]?.close ?? null;
  if (lastClose == null) return null;

  switch (key) {
    case 'rsi_oversold':
      if (ind.rsi14 != null && ind.rsi14 < 30) {
        return { key, label: 'RSI Oversold', detail: `RSI=${ind.rsi14.toFixed(1)}` };
      }
      return null;
    case 'rsi_overbought':
      if (ind.rsi14 != null && ind.rsi14 > 70) {
        return { key, label: 'RSI Overbought', detail: `RSI=${ind.rsi14.toFixed(1)}` };
      }
      return null;
    case 'macd_bullish':
      if (ind.macd.histogram != null && ind.macd.histogram > 0) {
        return { key, label: 'MACD Bullish', detail: `hist=${ind.macd.histogram.toFixed(2)}` };
      }
      return null;
    case 'macd_bearish':
      if (ind.macd.histogram != null && ind.macd.histogram < 0) {
        return { key, label: 'MACD Bearish', detail: `hist=${ind.macd.histogram.toFixed(2)}` };
      }
      return null;
    case 'macd_bull_cross':
    case 'macd_bear_cross': {
      // Crude cross detection: histogram changed sign in last 3 bars.
      if (klines.length < 50) return null;
      const recentCloses = klines.slice(-50).map((k) => k.close);
      // Compute histogram for last 3 bars by slicing the close series.
      const hists: number[] = [];
      for (let i = 0; i < 3; i++) {
        const slice = recentCloses.slice(0, recentCloses.length - (2 - i));
        if (slice.length < 26) continue;
        const m = computeMacd(slice);
        if (m.histogram != null) hists.push(m.histogram);
      }
      if (hists.length < 2) return null;
      const last = hists[hists.length - 1];
      const prev = hists[hists.length - 2];
      if (key === 'macd_bull_cross' && prev <= 0 && last > 0) {
        return { key, label: 'MACD Bull Cross', detail: `${prev.toFixed(2)}→${last.toFixed(2)}` };
      }
      if (key === 'macd_bear_cross' && prev >= 0 && last < 0) {
        return { key, label: 'MACD Bear Cross', detail: `${prev.toFixed(2)}→${last.toFixed(2)}` };
      }
      return null;
    }
    case 'ema_bull':
      if (ind.ema12 != null && ind.ema26 != null && ind.ema12 > ind.ema26) {
        return { key, label: 'EMA Bull (12>26)', detail: `12=${ind.ema12.toFixed(2)} 26=${ind.ema26.toFixed(2)}` };
      }
      return null;
    case 'ema_bear':
      if (ind.ema12 != null && ind.ema26 != null && ind.ema12 < ind.ema26) {
        return { key, label: 'EMA Bear (12<26)', detail: `12=${ind.ema12.toFixed(2)} 26=${ind.ema26.toFixed(2)}` };
      }
      return null;
    case 'bb_breakout_up':
      if (ind.bollinger.upper != null && lastClose > ind.bollinger.upper) {
        return { key, label: 'BB Breakout Up', detail: `close=${lastClose.toFixed(2)} > upper=${ind.bollinger.upper.toFixed(2)}` };
      }
      return null;
    case 'bb_breakout_down':
      if (ind.bollinger.lower != null && lastClose < ind.bollinger.lower) {
        return { key, label: 'BB Breakout Down', detail: `close=${lastClose.toFixed(2)} < lower=${ind.bollinger.lower.toFixed(2)}` };
      }
      return null;
    case 'vol_spike': {
      const vols = klines.slice(-21, -1).map((k) => k.volume);
      const lastVol = klines[klines.length - 1]?.volume ?? 0;
      const avgVol = sma(vols, 20) ?? 0;
      if (avgVol > 0 && lastVol > 2 * avgVol) {
        return { key, label: 'Volume Spike', detail: `${(lastVol / avgVol).toFixed(1)}× avg` };
      }
      return null;
    }
    case 'near_support':
    case 'near_resistance': {
      const closes = klines.map((k) => k.close);
      const { supports, resistances } = findLevels(closes, 5);
      if (key === 'near_support') {
        for (const s of supports) {
          if (s > 0 && Math.abs((lastClose - s) / s) < 0.01) {
            return { key, label: 'Near Support', detail: `support=${s.toFixed(2)}` };
          }
        }
      } else {
        for (const r of resistances) {
          if (r > 0 && Math.abs((lastClose - r) / r) < 0.01) {
            return { key, label: 'Near Resistance', detail: `resistance=${r.toFixed(2)}` };
          }
        }
      }
      return null;
    }
    case 'trend_up':
      if (ind.trend === 'up') return { key, label: 'Trend Up', detail: 'EMA12>EMA26 + slope>0.5%' };
      return null;
    case 'trend_down':
      if (ind.trend === 'down') return { key, label: 'Trend Down', detail: 'EMA12<EMA26 + slope<-0.5%' };
      return null;
    default:
      return null;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get('filters') ?? '';
    const requestedFilters: FilterKey[] = raw
      ? (raw.split(',').map((s) => s.trim()).filter(Boolean) as FilterKey[])
      : ALL_FILTERS;

    // Validate filter keys.
    const validSet = new Set<FilterKey>(ALL_FILTERS);
    const filters = requestedFilters.filter((f) => validSet.has(f));
    if (filters.length === 0) filters.push(...ALL_FILTERS);

    const assets = await db.asset.findMany({
      where: { assetClass: 'crypto', isActive: true },
      select: { symbol: true, name: true },
    });

    const results: ScreenerResult[] = [];
    await Promise.all(
      assets.map(async (a) => {
        try {
          const klines = await getKlines(a.symbol, '4h', 200);
          if (klines.length < 50) return;
          const ind = computeIndicators(klines);
          const matched: MatchedFilter[] = [];
          for (const f of filters) {
            const m = runFilter(f, klines, ind);
            if (m) matched.push(m);
          }
          if (matched.length === 0) return;

          // Compute 24h % change from klines (last 6 4h-bars).
          const recent = klines.slice(-6);
          const start = recent[0]?.open ?? recent[0]?.close ?? 0;
          const end = recent[recent.length - 1]?.close ?? 0;
          const changePct24h = start > 0 ? ((end - start) / start) * 100 : undefined;

          // Nearest support/resistance (for display).
          const closes = klines.map((k) => k.close);
          const { supports, resistances } = findLevels(closes, 5);
          const lastClose = ind.lastClose ?? 0;
          const ns = supports.filter((s) => s <= lastClose).sort((a, b) => b - a)[0];
          const nr = resistances.filter((r) => r >= lastClose).sort((a, b) => a - b)[0];

          results.push({
            symbol: a.symbol,
            name: a.name,
            price: lastClose,
            changePct24h,
            matchedFilters: matched,
            indicators: ind,
            nearSupport: ns,
            nearResistance: nr,
          });
        } catch (e) {
          console.warn(`[screener] failed for ${a.symbol}:`, (e as Error).message);
        }
      }),
    );

    // Sort: most filters matched first, then by |summaryScore| desc.
    results.sort((a, b) => {
      if (b.matchedFilters.length !== a.matchedFilters.length) {
        return b.matchedFilters.length - a.matchedFilters.length;
      }
      return Math.abs(b.indicators.summaryScore) - Math.abs(a.indicators.summaryScore);
    });

    return NextResponse.json({ success: true, data: results });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
