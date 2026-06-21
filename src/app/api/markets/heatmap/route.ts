/**
 * Markets heat-map API — returns price changes for all assets (crypto + non-crypto)
 * for heat-map coloring.
 *
 * GET /api/markets/heatmap
 *
 * Returns:
 *   {
 *     success: true,
 *     data: Array<{
 *       symbol: string,
 *       name: string,
 *       assetClass: 'crypto' | 'forex' | 'stocks' | 'indices' | 'commodities',
 *       changePercent: number,   // 24h % change
 *       price: number,
 *       marketCap?: number,      // for sizing (crypto only)
 *       volume?: number
 *     }>
 *   }
 *
 * Combines Binance crypto tickers + Yahoo non-crypto quotes + CoinGecko market
 * caps (for tile sizing on crypto). 5-min cache (Yahoo) / 30s tickers.
 */
import { NextResponse } from 'next/server';
import { getTickers24h } from '@/lib/market/binance';
import { getMacroQuotes } from '@/lib/market/macro';
import { getTopMarkets, type TopMarket } from '@/lib/market/coingecko';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

interface HeatMapEntry {
  symbol: string;
  name: string;
  assetClass: 'crypto' | 'forex' | 'stocks' | 'indices' | 'commodities';
  changePercent: number;
  price: number;
  marketCap?: number;
  volume?: number;
}

const FALLBACK_NON_CRYPTO: { symbol: string; name: string; assetClass: 'forex' | 'stocks' | 'indices' | 'commodities' }[] = [
  { symbol: '^GSPC', name: 'S&P 500', assetClass: 'indices' },
  { symbol: '^DJI', name: 'Dow Jones', assetClass: 'indices' },
  { symbol: '^IXIC', name: 'NASDAQ', assetClass: 'indices' },
  { symbol: '^VIX', name: 'VIX', assetClass: 'indices' },
  { symbol: '^NSEI', name: 'NIFTY 50', assetClass: 'indices' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', assetClass: 'forex' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', assetClass: 'forex' },
  { symbol: 'USDJPY=X', name: 'USD/JPY', assetClass: 'forex' },
  { symbol: 'USDINR=X', name: 'USD/INR', assetClass: 'forex' },
  { symbol: 'GC=F', name: 'Gold', assetClass: 'commodities' },
  { symbol: 'SI=F', name: 'Silver', assetClass: 'commodities' },
  { symbol: 'CL=F', name: 'Crude Oil', assetClass: 'commodities' },
  { symbol: 'NG=F', name: 'Natural Gas', assetClass: 'commodities' },
  { symbol: 'AAPL', name: 'Apple', assetClass: 'stocks' },
  { symbol: 'MSFT', name: 'Microsoft', assetClass: 'stocks' },
  { symbol: 'NVDA', name: 'NVIDIA', assetClass: 'stocks' },
  { symbol: 'TSLA', name: 'Tesla', assetClass: 'stocks' },
  { symbol: 'AMZN', name: 'Amazon', assetClass: 'stocks' },
];

export async function GET() {
  try {
    // Fire all upstream calls in parallel.
    const [cryptoTickers, nonCryptoQuotes, topMarkets] = await Promise.all([
      // Crypto tickers from DB-listed assets.
      (async (): Promise<Array<{ ticker: import('@/lib/types').Ticker; name: string }>> => {
        try {
          const assets = await db.asset.findMany({
            where: { assetClass: 'crypto', isActive: true },
            select: { symbol: true, name: true },
          });
          const symbols = assets.map((a) => a.symbol);
          if (symbols.length === 0) return [];
          const tickers = await getTickers24h(symbols);
          const byName = new Map<string, string>(assets.map((a) => [a.symbol, a.name]));
          return tickers.map((t) => ({
            ticker: t,
            name: byName.get(t.symbol) ?? t.symbol,
          }));
        } catch {
          return [];
        }
      })(),
      // Non-crypto quotes.
      getMacroQuotes(FALLBACK_NON_CRYPTO.map((a) => a.symbol)),
      // CoinGecko top markets (for market-cap sizing).
      getTopMarkets(20).catch((): TopMarket[] => []),
    ]);

    const coinGeckoBySymbol = new Map<string, TopMarket>(
      topMarkets.map((m) => [m.symbol, m]),
    );

    const out: HeatMapEntry[] = [];

    // Crypto entries — combine Binance ticker + CoinGecko market cap.
    for (const { ticker, name } of cryptoTickers) {
      const base = ticker.symbol.replace(/USDT$/, '').toUpperCase();
      const cg = coinGeckoBySymbol.get(base);
      out.push({
        symbol: ticker.symbol,
        name,
        assetClass: 'crypto',
        changePercent: ticker.priceChangePercent,
        price: ticker.lastPrice,
        marketCap: cg?.marketCap,
        volume: ticker.quoteVolume,
      });
    }

    // Non-crypto entries from Yahoo quotes.
    const quoteBySymbol = new Map(nonCryptoQuotes.map((q) => [q.symbol, q]));
    for (const a of FALLBACK_NON_CRYPTO) {
      const q = quoteBySymbol.get(a.symbol);
      if (!q) continue;
      out.push({
        symbol: a.symbol,
        name: a.name,
        assetClass: a.assetClass,
        changePercent: q.changePercent ?? 0,
        price: q.price,
      });
    }

    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
