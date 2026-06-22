// Lightweight data-source probe — lets the UI show an honest "Data via Binance"
// or "Data via CoinGecko (fallback)" badge. On Hugging Face Spaces the Binance
// API is geo-blocked, so the app transparently falls back to CoinGecko. This
// endpoint surfaces which source is currently serving data without leaking
// internal errors to the client.
import { NextResponse } from 'next/server';
import { getMarketDataSource } from '@/lib/market/binance';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface SourceInfo {
  source: 'binance' | 'coingecko' | 'cache';
  fetchedAt: number;
  label: string;
  isFallback: boolean;
}

function labelFor(source: string): string {
  switch (source) {
    case 'binance':
      return 'Binance';
    case 'coingecko':
      return 'CoinGecko (fallback)';
    case 'cache':
      return 'Cached snapshot';
    default:
      return 'Unknown';
  }
}

export async function GET() {
  const { source, fetchedAt } = getMarketDataSource();
  const info: SourceInfo = {
    source,
    fetchedAt,
    label: labelFor(source),
    isFallback: source !== 'binance',
  };
  return NextResponse.json<ApiResult<SourceInfo>>({ success: true, data: info });
}
