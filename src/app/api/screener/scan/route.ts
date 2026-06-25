// POST /api/screener/scan
//
// Runs the Market Screener: scans all USDT tickers from Binance, filters by
// price/volume, fetches klines for the top N candidates by 24h quote volume,
// computes indicators, applies the active technical filters, computes a
import { validateBody, schemas } from "@/lib/api/validation";
// conviction score (0-100), and returns sorted results.
//
// Request body (JSON):
//   {
//     "filters":      ["rsi_oversold", "volume_spike", ...], // filter keys
//     "volumeMin":    1_000_000,    // optional, default 1M
//     "priceMin":     0,            // optional
//     "priceMax":     0,            // optional (0 = no cap)
//     "direction":    "all",        // all | bullish | bearish
//     "sortBy":       "conviction", // conviction | changePct | volume | rsi | symbol
//     "topN":         80,           // max candidates to deep-scan with klines (default 80, cap 150)
//     "limit":        50            // max results to return (default 50)
//   }
//
// Response:
//   {
//     "success": true,
//     "data": {
//       "results":      ScreenerResult[],
//       "stats": {
//         "scanned":    number,   // total assets fetched from Binance
//         "candidates": number,   // number that passed price/volume filters
//         "matches":    number,   // number that matched at least one filter
//         "bullish":    number,   // matches with bullish trend
//         "bearish":    number,   // matches with bearish trend
//         "avgRsi":     number,
//         "filterCounts": { [filterKey]: number } // distribution
//       }
//     }
//   }
import { NextRequest, NextResponse } from 'next/server';
import { getAllTickers, getKlines } from '@/lib/market/binance';
import { computeIndicators } from '@/lib/market/indicators';
import {
  TECHNICAL_FILTERS,
  FILTER_BY_KEY,
  applyFilters,
  computeConvictionScore,
  type ScreenerResult,
  type SortKey,
} from '@/lib/analysis/screener';
import type { ApiResult, TechnicalIndicators } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ScanRequest {
  filters?: string[];
  volumeMin?: number;
  priceMin?: number;
  priceMax?: number;
  direction?: 'all' | 'bullish' | 'bearish';
  sortBy?: SortKey;
  topN?: number;
  limit?: number;
}

interface ScanStats {
  scanned: number;
  candidates: number;
  matches: number;
  bullish: number;
  bearish: number;
  avgRsi: number;
  filterCounts: Record<string, number>;
}

interface ScanResponse {
  results: ScreenerResult[];
  stats: ScanStats;
}

/** Curated name map for common crypto symbols — improves the table UX. */
const NAME_MAP: Record<string, string> = {
  BTCUSDT: 'Bitcoin',
  ETHUSDT: 'Ethereum',
  BNBUSDT: 'BNB',
  SOLUSDT: 'Solana',
  XRPUSDT: 'XRP',
  ADAUSDT: 'Cardano',
  DOGEUSDT: 'Dogecoin',
  AVAXUSDT: 'Avalanche',
  LINKUSDT: 'Chainlink',
  DOTUSDT: 'Polkadot',
  TRXUSDT: 'TRON',
  LTCUSDT: 'Litecoin',
  BCHUSDT: 'Bitcoin Cash',
  ATOMUSDT: 'Cosmos',
  UNIUSDT: 'Uniswap',
  NEARUSDT: 'NEAR Protocol',
  APTUSDT: 'Aptos',
  FILUSDT: 'Filecoin',
  ICPUSDT: 'Internet Computer',
  ARBUSDT: 'Arbitrum',
  OPUSDT: 'Optimism',
  INJUSDT: 'Injective',
  SUIUSDT: 'Sui',
  SEIUSDT: 'Sei',
  TIAUSDT: 'Celestia',
  RNDRUSDT: 'Render',
  FETUSDT: 'Fetch.ai',
  GALAUSDT: 'Gala',
  SANDUSDT: 'The Sandbox',
  POLUSDT: 'Polygon',
  SHIBUSDT: 'Shiba Inu',
  PEPEUSDT: 'Pepe',
  WIFUSDT: 'dogwifhat',
  FLOKIUSDT: 'FLOKI',
  ORDIUSDT: 'ORDI',
  JUPUSDT: 'Jupiter',
  PYTHUSDT: 'Pyth Network',
  TONUSDT: 'Toncoin',
  KASUSDT: 'Kaspa',
  AAVEUSDT: 'Aave',
  MKRUSDT: 'Maker',
  LDOUSDT: 'Lido DAO',
  ENAUSDT: 'Ethena',
  WLDUSDT: 'Worldcoin',
  RUNEUSDT: 'THORChain',
  ETCUSDT: 'Ethereum Classic',
  XLMUSDT: 'Stellar',
  IMXUSDT: 'Immutable',
  GRTUSDT: 'The Graph',
  FTMUSDT: 'Fantom',
  ALGOUSDT: 'Algorand',
  EGLDUSDT: 'MultiversX',
  FLOWUSDT: 'Flow',
  AXSUSDT: 'Axie Infinity',
  MANAUSDT: 'Decentraland',
  THETAUSDT: 'Theta Network',
  CHZUSDT: 'Chiliz',
  ZECUSDT: 'Zcash',
  DASHUSDT: 'Dash',
  COMPUSDT: 'Compound',
  SNXUSDT: 'Synthetix',
  CRVUSDT: 'Curve DAO',
  '1INCHUSDT': '1inch',
  BALUSDT: 'Balancer',
  YFIUSDT: 'Yearn Finance',
  SUSHIUSDT: 'SushiSwap',
  KAVAUSDT: 'Kava',
  ROSEUSDT: 'Oasis Network',
  DYDXUSDT: 'dYdX',
  GMTUSDT: 'STEPN',
  APEUSDT: 'ApeCoin',
  XECUSDT: 'eCash',
};

function nameForSymbol(symbol: string): string {
  if (NAME_MAP[symbol]) return NAME_MAP[symbol];
  if (symbol.endsWith('USDT')) return symbol.slice(0, -4);
  return symbol;
}

/** Run an async function on each item with bounded concurrency. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: string; index: number }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: string; index: number }> = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const v = await fn(items[i], i);
        results[i] = { ok: true, value: v };
      } catch (e: unknown) {
        results[i] = {
          ok: false,
          error: e instanceof Error ? e.message : 'failed',
          index: i,
        };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function distancePct(level: number, price: number): number {
  if (!price) return 0;
  return ((level - price) / price) * 100;
}

export async function POST(req: NextRequest) {
  try {
    let body: ScanRequest = {};
    try {
      body = await validateBody(req, schemas.screenerScan) as any;
    } catch {
      // Empty body is fine — we'll use defaults.
    }

    const activeFilters = (body.filters || []).filter((f) => FILTER_BY_KEY[f]);
    const volumeMin = Math.max(0, body.volumeMin ?? 1_000_000);
    const priceMin = Math.max(0, body.priceMin ?? 0);
    const priceMax = Math.max(0, body.priceMax ?? 0);
    const direction: 'all' | 'bullish' | 'bearish' = body.direction || 'all';
    const sortBy: SortKey = body.sortBy || 'conviction';
    const topN = Math.min(Math.max(body.topN ?? 80, 10), 150);
    const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);

    // 1. Fetch all USDT tickers (cached 30s by Binance client).
    const allTickers = await getAllTickers();
    if (allTickers.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'no tickers available from Binance' },
        { status: 502 },
      );
    }

    // 2. Apply basic liquidity + price filters.
    const candidates = allTickers.filter((t) => {
      if (!isFinite(t.price) || t.price <= 0) return false;
      if (t.quoteVolume < volumeMin) return false;
      if (priceMin > 0 && t.price < priceMin) return false;
      if (priceMax > 0 && t.price > priceMax) return false;
      // Exclude obvious stablecoin pairs — they don't have meaningful signals.
      const base = t.symbol.replace(/USDT$/, '').toUpperCase();
      if (['USDC', 'BUSD', 'TUSD', 'FDUSD', 'USDP', 'DAI', 'EUR', 'GBP', 'USTC'].includes(base)) {
        return false;
      }
      return true;
    });

    // 3. Sort by quote volume desc, take top N for deep scan.
    const top = [...candidates]
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, topN);

    // 4. Fetch klines for each candidate in parallel (bounded concurrency).
    // 4h interval × 200 limit gives ~33 days of price action — enough for
    // EMA200 + indicator convergence.
    const klineResults = await mapWithConcurrency(top, 12, async (ticker) => {
      const klines = await getKlines(ticker.symbol, '4h', 200);
      return { ticker, klines };
    });

    // 5. Compute indicators + apply filters per asset.
    const results: ScreenerResult[] = [];
    const filterCounts: Record<string, number> = {};
    for (const f of TECHNICAL_FILTERS) filterCounts[f.key] = 0;

    let bullishCount = 0;
    let bearishCount = 0;
    let rsiSum = 0;
    let rsiCount = 0;

    for (const r of klineResults) {
      if (!r.ok) continue;
      const { ticker, klines } = r.value;
      if (!klines || klines.length < 60) continue;

      const ind: TechnicalIndicators = computeIndicators(klines);

      rsiSum += ind.rsi;
      rsiCount++;

      if (ind.trend === 'bullish') bullishCount++;
      else if (ind.trend === 'bearish') bearishCount++;

      // Apply active filters — require ALL active filters to match (AND semantics).
      // If no filters are active, include every asset (pure scan mode).
      const matched = applyFilters(ind, ticker, activeFilters);
      if (activeFilters.length > 0 && matched.length < activeFilters.length) continue;

      if (direction !== 'all') {
        if (direction === 'bullish' && ind.trend !== 'bullish') continue;
        if (direction === 'bearish' && ind.trend !== 'bearish') continue;
      }

      for (const key of matched) filterCounts[key]++;

      const conviction = computeConvictionScore(matched, ind);

      const supportDistPct =
        ind.support.length > 0
          ? distancePct(
              ind.support.reduce((best, lvl) =>
                Math.abs(lvl - ticker.price) < Math.abs(best - ticker.price) ? lvl : best,
              ),
              ticker.price,
            )
          : 0;
      const resistanceDistPct =
        ind.resistance.length > 0
          ? distancePct(
              ind.resistance.reduce((best, lvl) =>
                Math.abs(lvl - ticker.price) < Math.abs(best - ticker.price) ? lvl : best,
              ),
              ticker.price,
            )
          : 0;

      results.push({
        symbol: ticker.symbol,
        name: nameForSymbol(ticker.symbol),
        price: ticker.price,
        changePct: ticker.changePct,
        quoteVolume: ticker.quoteVolume,
        rsi: Math.round(ind.rsi * 10) / 10,
        macdHistogram: Math.round(ind.macd.histogram * 10000) / 10000,
        ema20: Math.round(ind.ema20 * 100) / 100,
        ema50: Math.round(ind.ema50 * 100) / 100,
        trend: ind.trend,
        matchedFilters: matched,
        conviction,
        supportDistPct: Math.round(supportDistPct * 100) / 100,
        resistanceDistPct: Math.round(resistanceDistPct * 100) / 100,
      });
    }

    // 6. Sort.
    const sorted = [...results].sort((a, b) => {
      switch (sortBy) {
        case 'conviction':
          return b.conviction - a.conviction || b.quoteVolume - a.quoteVolume;
        case 'volume':
          return b.quoteVolume - a.quoteVolume;
        case 'changePct':
          return b.changePct - a.changePct;
        case 'rsi':
          return a.rsi - b.rsi; // ascending — oversold first
        case 'symbol':
          return a.symbol.localeCompare(b.symbol);
        default:
          return b.conviction - a.conviction;
      }
    });

    // 7. Apply limit.
    const limited = sorted.slice(0, limit);

    const stats: ScanStats = {
      scanned: allTickers.length,
      candidates: candidates.length,
      matches: sorted.length,
      bullish: bullishCount,
      bearish: bearishCount,
      avgRsi: rsiCount > 0 ? Math.round((rsiSum / rsiCount) * 10) / 10 : 0,
      filterCounts,
    };

    const data: ScanResponse = { results: limited, stats };
    return NextResponse.json<ApiResult<ScanResponse>>({ success: true, data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'internal error';
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: msg },
      { status: 500 },
    );
  }
}
