// Market heat map — performance + correlation matrix across all asset classes.
// Fetches all asset quotes, computes daily returns, and produces a heat-map-ready dataset.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTickers24h } from '@/lib/market/binance';
import { getYahooQuotesBySymbol } from '@/lib/market/macro';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface HeatMapItem {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  changePct: number;
  volume?: number;
  sparkline: number[]; // last N closes
}

export async function GET() {
  try {
    const assets = await db.asset.findMany({ where: { isActive: true } });
    const cryptoAssets = assets.filter((a) => a.assetClass === 'crypto');
    const yahooAssets = assets.filter((a) => a.assetClass !== 'crypto');

    const items: HeatMapItem[] = [];

    // Crypto via Binance
    if (cryptoAssets.length > 0) {
      try {
        const tickers = await getTickers24h(cryptoAssets.map((a) => a.symbol));
        for (const t of tickers) {
          const asset = cryptoAssets.find((a) => a.symbol === t.symbol);
          items.push({
            symbol: t.symbol,
            name: asset?.name || t.symbol,
            assetClass: 'crypto',
            price: t.price,
            changePct: t.changePct,
            volume: t.quoteVolume,
            sparkline: [t.low, t.price, t.high],
          });
        }
      } catch (e: any) {
        console.error('[heatmap] crypto failed:', e.message);
      }
    }

    // Non-crypto via Yahoo — fetch sequentially (rate-limit safe)
    const symbolMap = new Map<string, typeof yahooAssets[0]>();
    for (const a of yahooAssets) {
      let m: any = {};
      try { m = JSON.parse(a.meta || '{}'); } catch {}
      const ys = m.yahooSymbol || a.symbol;
      symbolMap.set(ys, a);
    }
    const yahooSymbols = [...symbolMap.keys()];
    const quotes = await getYahooQuotesBySymbol(yahooSymbols, '5d');

    for (const [ys, q] of Object.entries(quotes)) {
      const asset = symbolMap.get(ys);
      if (!asset) continue;
      items.push({
        symbol: asset.symbol,
        name: asset.name,
        assetClass: asset.assetClass,
        price: q.price,
        changePct: q.changePct,
        sparkline: q.klines?.slice(-20).map((k: any) => k.close) || [q.price],
      });
    }

    // Sort by absolute changePct for heat map emphasis
    items.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    // Group by asset class for the UI
    const byClass: Record<string, HeatMapItem[]> = {};
    for (const item of items) {
      if (!byClass[item.assetClass]) byClass[item.assetClass] = [];
      byClass[item.assetClass].push(item);
    }

    // Compute cross-asset-class stats
    const stats = {
      totalAssets: items.length,
      totalUp: items.filter((i) => i.changePct > 0).length,
      totalDown: items.filter((i) => i.changePct < 0).length,
      avgChange: items.length ? items.reduce((s, i) => s + i.changePct, 0) / items.length : 0,
      bestPerformer: items[0] || null,
      worstPerformer: items[items.length - 1] || null,
      byClassStats: Object.fromEntries(
        Object.entries(byClass).map(([cls, arr]) => [
          cls,
          {
            count: arr.length,
            avgChange: arr.length ? arr.reduce((s, i) => s + i.changePct, 0) / arr.length : 0,
            up: arr.filter((i) => i.changePct > 0).length,
            down: arr.filter((i) => i.changePct < 0).length,
          },
        ])
      ),
    };

    return NextResponse.json<ApiResult<{ items: HeatMapItem[]; byClass: Record<string, HeatMapItem[]>; stats: typeof stats }>>({
      success: true,
      data: { items, byClass, stats },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
