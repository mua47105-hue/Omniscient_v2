import { NextRequest, NextResponse } from 'next/server';
import { getKlines, getTicker24h } from '@/lib/market/binance';
import { computeIndicators } from '@/lib/market/indicators';
import {
  TIMEFRAME_ORDER,
  computeConfluenceScore,
  generateInsights,
  computeEntrySuggestion,
  buildAgreementMatrix,
  type TimeframeAnalysis,
  type TimeframeKey,
} from '@/lib/analysis/multi-timeframe';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface MultiTimeframeResponse {
  symbol: string;
  price: number;
  changePct: number;
  timeframes: TimeframeAnalysis[];
  confluence: ReturnType<typeof computeConfluenceScore>;
  agreementMatrix: ReturnType<typeof buildAgreementMatrix>;
  insights: ReturnType<typeof generateInsights>;
  suggestion: ReturnType<typeof computeEntrySuggestion>;
  updatedAt: number;
}

export async function GET(req: NextRequest) {
  try {
    const symbol = (req.nextUrl.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();

    // Fetch 4 timeframes in parallel + the 24h ticker (for live price + change %).
    const [k1h, k4h, k1d, k1w, ticker] = await Promise.all([
      getKlines(symbol, '1h', 200).catch(() => []),
      getKlines(symbol, '4h', 200).catch(() => []),
      getKlines(symbol, '1d', 200).catch(() => []),
      getKlines(symbol, '1w', 200).catch(() => []),
      getTicker24h(symbol).catch(() => null),
    ]);

    const intervals: { key: TimeframeKey; klines: typeof k1h }[] = [
      { key: '1h', klines: k1h },
      { key: '4h', klines: k4h },
      { key: '1d', klines: k1d },
      { key: '1w', klines: k1w },
    ];

    const timeframes: TimeframeAnalysis[] = intervals.map(({ key, klines }) => ({
      interval: key,
      klines: klines.slice(-50),
      indicators: computeIndicators(klines),
    }));

    const confluence = computeConfluenceScore(timeframes);
    const agreementMatrix = buildAgreementMatrix(timeframes);
    const insights = generateInsights(timeframes);
    const suggestion = computeEntrySuggestion(timeframes, confluence);

    const lastPrice =
      k1d.length > 0
        ? k1d[k1d.length - 1].close
        : k1h.length > 0
          ? k1h[k1h.length - 1].close
          : ticker?.price ?? 0;

    const payload: MultiTimeframeResponse = {
      symbol,
      price: ticker?.price ?? lastPrice,
      changePct: ticker?.changePct ?? 0,
      timeframes,
      confluence,
      agreementMatrix,
      insights,
      suggestion,
      updatedAt: Date.now(),
    };

    // Stable ordering for TIMEFRAME_ORDER consumers
    payload.timeframes.sort(
      (a, b) =>
        TIMEFRAME_ORDER.indexOf(a.interval) - TIMEFRAME_ORDER.indexOf(b.interval),
    );

    return NextResponse.json<ApiResult<MultiTimeframeResponse>>({
      success: true,
      data: payload,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: msg },
      { status: 500 },
    );
  }
}
