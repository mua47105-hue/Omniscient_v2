/**
 * Markets scan API — fetches Yahoo Finance klines + computes indicators
 * for non-crypto assets.
 *
 * GET /api/markets/scan?symbol=^GSPC  → single-asset indicators
 * GET /api/markets/scan                → all-asset indicators (no klines, just stats)
 *
 * For each asset: fetch 3-month daily klines from Yahoo, compute RSI/MACD/
 * EMA/Bollinger/VWAP/trend/5-vote summary. Yahoo's chart endpoint returns
 * closes in `result.indicators.quote[0].close`. We fetch this directly
 * (rather than via macro.ts's getMacroQuote which only returns the latest
 * price) so we get the full OHLCV series needed for indicators.
 */
import { NextResponse } from 'next/server';
import https from 'node:https';
import { computeIndicators } from '@/lib/market/indicators';
import type { Kline } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface YahooChartResult {
  meta: {
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    currency?: string;
    symbol?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

function httpsGetJson(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          httpsGetJson(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`JSON parse failed for ${url}: ${(err as Error).message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

async function fetchYahooKlines(symbol: string, range = '3mo'): Promise<Kline[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=${range}`;
  const data = await httpsGetJson(url);
  const result: YahooChartResult | undefined = data?.chart?.result?.[0];
  if (!result || !result.indicators?.quote?.[0]) return [];
  const q = result.indicators.quote[0];
  const ts = result.timestamp ?? [];
  const closes = q.close ?? [];
  const opens = q.open ?? [];
  const highs = q.high ?? [];
  const lows = q.low ?? [];
  const volumes = q.volume ?? [];
  const klines: Kline[] = [];
  const n = Math.min(ts.length, closes.length);
  for (let i = 0; i < n; i++) {
    const c = closes[i];
    if (c == null) continue;
    klines.push({
      openTime: ts[i] * 1000,
      open: opens[i] ?? c,
      high: highs[i] ?? c,
      low: lows[i] ?? c,
      close: c,
      volume: volumes[i] ?? 0,
      closeTime: ts[i] * 1000,
      quoteVolume: (volumes[i] ?? 0) * c,
    });
  }
  return klines;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get('symbol')?.trim();

    // Single-asset deep scan.
    if (symbol) {
      const klines = await fetchYahooKlines(symbol);
      if (klines.length < 30) {
        return NextResponse.json(
          {
            success: true,
            data: {
              symbol,
              klines,
              indicators: null,
              klineCount: klines.length,
              message: 'insufficient klines for indicator computation',
            },
          },
        );
      }
      const indicators = computeIndicators(klines);
      return NextResponse.json({
        success: true,
        data: { symbol, klines, indicators, klineCount: klines.length },
      });
    }

    // Multi-asset scan — for now, just respond with the supported symbol list
    // (the deep multi-asset scan would make too many parallel Yahoo calls).
    return NextResponse.json({
      success: true,
      data: {
        message:
          'use ?symbol= for single-asset deep scan. Multi-asset scan uses /api/markets/quotes.',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
