// CoinGecko free client — no API key, public endpoints.
// Adds a "trending" + "top markets" data source to the free stack. Trending is
// a genuine attention signal (which coins are being looked at right now), and
// it costs zero tokens. Cached 5 min to stay well under CoinGecko's free rate
// limit (~30 req/min).

import https from 'node:https';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function get(url: string, timeoutMs = 10000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

const cache = new Map<string, { data: any; ts: number }>();
const TTL = 5 * 60 * 1000;
function cached<T>(key: string): T | null {
  const c = cache.get(key);
  return c && Date.now() - c.ts < TTL ? (c.data as T) : null;
}
function store(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

export interface TrendingCoin {
  rank: number;
  coinId: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
  priceBtc: number;
  score: number; // CoinGecko's interest score (lower = more trending)
}

/** Trending coins — the top-searched on CoinGecko in the last 24h. Free attention signal. */
export async function getTrending(): Promise<TrendingCoin[]> {
  const cachedArr = cached<TrendingCoin[]>('trending');
  if (cachedArr) return cachedArr;
  const { status, text } = await get('https://api.coingecko.com/api/v3/search/trending');
  if (status !== 200) throw new Error(`CoinGecko trending ${status}`);
  const data = JSON.parse(text);
  const out: TrendingCoin[] = (data.coins || []).map((c: any, i: number) => ({
    rank: i + 1,
    coinId: c.item.id,
    symbol: (c.item.symbol || '').toUpperCase(),
    name: c.item.name,
    marketCapRank: c.item.market_cap_rank ?? null,
    priceBtc: c.item.price_btc ?? 0,
    score: c.item.score ?? i,
  }));
  store('trending', out);
  return out;
}

export interface TopMarket {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  changePct24h: number;
  marketCap: number;
  volume24h: number;
}

/** Top N markets by market cap — gives the brain + UI a free market-cap context layer. */
export async function getTopMarkets(limit = 20): Promise<TopMarket[]> {
  const key = `top:${limit}`;
  const cachedArr = cached<TopMarket[]>(key);
  if (cachedArr) return cachedArr;
  const { status, text } = await get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`);
  if (status !== 200) throw new Error(`CoinGecko markets ${status}`);
  const data = JSON.parse(text);
  const out: TopMarket[] = data.map((c: any, i: number) => ({
    rank: c.market_cap_rank ?? i + 1,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    price: c.current_price ?? 0,
    changePct24h: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? 0,
    marketCap: c.market_cap ?? 0,
    volume24h: c.total_volume ?? 0,
  }));
  store(key, out);
  return out;
}
