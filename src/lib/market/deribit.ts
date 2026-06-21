// E4 — Derivatives Intelligence Layer (Basis + 25Δ Skew + VRP)
//
// Source: "OMNISCIENT — Field Guide to Real Edge (Vol. 2)", Suggestion E4.
// Evidence: Every major BTC bottom since 2019 marked by basis backwardation +
// extreme put skew + DVOL≥90 (CME/CoinDesk). Alexander & Imeraj (2021) +
// SSRN 6410838 confirm 25Δ skew predictiveness. All FREE: Deribit public API
// (no key, 20 req/s) + Binance Coin-M public REST.
//
// Three signals:
//   1. Term-structure basis = quarterly future vs spot, annualized %
//      Backwardation (<−5% APR) marks major bottoms.
//   2. 25Δ risk reversal = IV(25Δ call) − IV(25Δ put) from Deribit
//      Extreme put skew (RR ≤ −6 vol pts) marks bottoms.
//   3. VRP = Deribit DVOL − 30d realized vol. DVOL ≥ 90 = capitulation.
//
// Regime: CAPITULATION (all 3 bearish-extreme) → contrarian long
//         EUPHORIA (all 3 bullish-extreme) → contrarian short / take profit
//         NEUTRAL → no derivatives override
//
// Counter-argument: "every major bottom since 2019" = 5 data points (small
// sample). 25Δ options don't always exist for the exact expiry. Mitigation:
// use as a CONFIRMATION signal, not primary. If primary says "long" and regime
// is CAPITULATION, increase conviction. If "long" + EUPHORIA, reduce size.
//
// ponytail: native node:https (matches the rest of the codebase), in-memory
// cache, graceful degradation per endpoint. No API key.

import https from 'node:https';

const UA = 'OMNISCIENT/1.0 (market-intel)';
const DERIBIT_BASE = 'https://www.deribit.com/api/v2';

function getJson(url: string, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('bad JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

const cache = new Map<string, { data: any; ts: number }>();
const TTL = 8 * 60 * 60 * 1000; // 8h — derivatives data changes slowly (funding cadence)
function cached<T>(key: string): T | null {
  const c = cache.get(key);
  return c && Date.now() - c.ts < TTL ? (c.data as T) : null;
}
function store(key: string, data: any) { cache.set(key, { data, ts: Date.now() }); }

export interface DeribitOptionSummary {
  instrument_name: string; // e.g. "BTC-28MAR25-80000-C"
  mark_price: number;
  underlying_price: number;
  open_interest: number;
  mark_iv: number; // IV in %
  delta: number;
}

/** Fetch all option summaries for BTC or ETH from Deribit (public, no key). */
export async function getOptionSummaries(currency: 'BTC' | 'ETH'): Promise<DeribitOptionSummary[]> {
  const key = `options:${currency}`;
  const cachedArr = cached<DeribitOptionSummary[]>(key);
  if (cachedArr) return cachedArr;
  const data = await getJson(`${DERIBIT_BASE}/public/get_book_summary_by_currency?currency=${currency}&kind=option`);
  const result: DeribitOptionSummary[] = (data.result || []).map((o: any) => ({
    instrument_name: o.instrument_name,
    mark_price: o.mark_price ?? 0,
    underlying_price: o.underlying_price ?? 0,
    open_interest: o.open_interest ?? 0,
    mark_iv: o.mark_iv ?? 0,
    delta: o.delta ?? 0,
  }));
  store(key, result);
  return result;
}

/** Fetch the latest Deribit DVOL (volatility index) for BTC or ETH. */
export async function getDVOL(currency: 'BTC' | 'ETH'): Promise<number> {
  const key = `dvol:${currency}`;
  const cachedV = cached<number>(key);
  if (cachedV !== null) return cachedV;
  const now = Date.now();
  const start = now - 7 * 24 * 60 * 60 * 1000;
  const data = await getJson(`${DERIBIT_BASE}/public/get_volatility_index_data?currency=${currency}&resolution=1D&start_timestamp=${start}&end_timestamp=${now}`);
  const arr = data?.result?.data;
  if (!arr || arr.length === 0) throw new Error('DVOL: no data');
  const latest = arr[arr.length - 1]; // [ts, open, high, low, close]
  const dvol = latest[4];
  store(key, dvol);
  return dvol;
}

/**
 * Find the 25-delta call + put IVs from the Deribit option book.
 * Deribit's book-summary endpoint doesn't return `delta`, so we estimate 25Δ
 * by moneyness: for each expiry, pick the OTM call with strike ≈ spot×1.1 and
 * the OTM put with strike ≈ spot×0.9 (≈25Δ for 3-month crypto at ~60% vol).
 * The document notes "25Δ options don't always exist for the exact expiry;
 * interpolation introduces error" — a moneyness proxy captures the skew
 * direction well enough for a confirmation signal.
 */
export function find25DeltaOptions(options: DeribitOptionSummary[], currency: string): { callIv: number; putIv: number; expiry: string } | null {
  // Parse instrument: "BTC-28MAR25-80000-C" → { expiry:"28MAR25", strike:80000, type:"C" }
  const parsed = options
    .filter((o) => o.instrument_name.startsWith(`${currency}-`) && o.mark_iv > 0 && o.underlying_price > 0)
    .map((o) => {
      const parts = o.instrument_name.split('-');
      return { ...o, expiry: parts[1], strike: parseFloat(parts[2]), type: parts[3] as 'C' | 'P' };
    });
  if (parsed.length === 0) return null;

  // Group by expiry.
  const byExpiry = new Map<string, typeof parsed>();
  for (const o of parsed) {
    if (!byExpiry.has(o.expiry)) byExpiry.set(o.expiry, []);
    byExpiry.get(o.expiry)!.push(o);
  }
  const expiries = Array.from(byExpiry.keys()).sort((a, b) => {
    const da = new Date(a).getTime() || 0;
    const db = new Date(b).getTime() || 0;
    return da - db;
  });

  for (const exp of expiries) {
    const opts = byExpiry.get(exp)!;
    const spot = opts[0].underlying_price;
    if (spot <= 0) continue;
    // OTM calls (strike > spot), OTM puts (strike < spot).
    const otmCalls = opts.filter((o) => o.type === 'C' && o.strike > spot);
    const otmPuts = opts.filter((o) => o.type === 'P' && o.strike < spot);
    if (otmCalls.length === 0 || otmPuts.length === 0) continue;
    // 25Δ proxy: call with strike closest to spot×1.1, put closest to spot×0.9.
    const callTarget = spot * 1.1;
    const putTarget = spot * 0.9;
    const call = otmCalls.sort((a, b) => Math.abs(a.strike - callTarget) - Math.abs(b.strike - callTarget))[0];
    const put = otmPuts.sort((a, b) => Math.abs(a.strike - putTarget) - Math.abs(b.strike - putTarget))[0];
    if (call && put) return { callIv: call.mark_iv, putIv: put.mark_iv, expiry: exp };
  }
  return null;
}

// --- Binance Coin-M basis (quarterly future vs spot) ---

/** Fetch the Binance COIN-M quarterly futures price for BTC/ETH. */
export async function getCoinMQuarterlyPrice(currency: 'BTC' | 'ETH'): Promise<{ symbol: string; price: number; daysToExpiry: number } | null> {
  const key = `coinm:${currency}`;
  const cachedV = cached<{ symbol: string; price: number; daysToExpiry: number } | null>(key);
  if (cachedV !== null) return cachedV;
  try {
    const data = await getJson('https://dapi.binance.com/dapi/v1/ticker/price');
    const tickers: any[] = data || [];
    // Find the quarterly contract: symbol like "BTCUSD_250328"
    const prefix = `${currency}USD_`;
    const quarterlies = tickers
      .filter((t) => t.symbol.startsWith(prefix))
      .map((t) => {
        const dateStr = t.symbol.replace(prefix, '');
        // Parse YYMMDD → Date
        const yy = parseInt(dateStr.slice(0, 2)) + 2000;
        const mm = parseInt(dateStr.slice(2, 4)) - 1;
        const dd = parseInt(dateStr.slice(4, 6));
        const expiry = new Date(yy, mm, dd).getTime();
        return { symbol: t.symbol, price: parseFloat(t.price), expiry, daysToExpiry: (expiry - Date.now()) / (86400000) };
      })
      .filter((t) => t.daysToExpiry > 7) // skip near-expiry
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry); // nearest quarterly
    const result = quarterlies[0] ?? null;
    store(key, result);
    return result;
  } catch {
    return null;
  }
}

export interface DerivativesV2Result {
  basisTermStructure: number | null; // quarterly - spot, annualized %
  riskReversal25Delta: number | null; // IV(call) - IV(put), vol points
  vrp: number | null; // DVOL - 30d realized vol
  dvol: number | null;
  regime: 'CAPITULATION' | 'NEUTRAL' | 'EUPHORIA';
  rationale: string;
}

/**
 * Compute the full derivatives-v2 intelligence layer.
 * Each sub-signal degrades independently — partial data is more useful than none.
 */
export async function computeDerivativesV2(
  currency: 'BTC' | 'ETH',
  klines30d: { close: number }[],
): Promise<DerivativesV2Result> {
  const spotPrice = klines30d[klines30d.length - 1]?.close ?? 0;

  // 1. Basis: Binance COIN-M quarterly vs spot, annualized.
  let basisTermStructure: number | null = null;
  const quarterly = await getCoinMQuarterlyPrice(currency);
  if (quarterly && spotPrice > 0 && quarterly.daysToExpiry > 0) {
    basisTermStructure = ((quarterly.price - spotPrice) / spotPrice) * (365 / quarterly.daysToExpiry) * 100;
  }

  // 2. 25Δ risk reversal from Deribit.
  let riskReversal25Delta: number | null = null;
  let dvol: number | null = null;
  try {
    const options = await getOptionSummaries(currency);
    const rr = find25DeltaOptions(options, currency);
    if (rr) riskReversal25Delta = rr.callIv - rr.putIv;
    dvol = await getDVOL(currency);
  } catch { /* Deribit unavailable — degrade gracefully */ }

  // 3. VRP = DVOL - 30d annualized realized vol.
  let vrp: number | null = null;
  if (dvol !== null && klines30d.length >= 10) {
    const logReturns: number[] = [];
    for (let i = 1; i < klines30d.length; i++) {
      if (klines30d[i - 1].close > 0) logReturns.push(Math.log(klines30d[i].close / klines30d[i - 1].close));
    }
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(logReturns.length - 1, 1);
    const dailyVol = Math.sqrt(variance);
    const annualizedVol = dailyVol * Math.sqrt(365) * 100; // crypto trades 365d/yr
    vrp = dvol - annualizedVol;
  }

  // Regime detection (per the document's thresholds).
  let regime: DerivativesV2Result['regime'] = 'NEUTRAL';
  let rationale = 'derivatives neutral';
  const basisBearish = basisTermStructure !== null && basisTermStructure < -5;
  const skewBearish = riskReversal25Delta !== null && riskReversal25Delta < -6;
  const volHigh = dvol !== null && dvol >= 90;
  const basisBullish = basisTermStructure !== null && basisTermStructure > 15;
  const skewBullish = riskReversal25Delta !== null && riskReversal25Delta > 4;
  const volLow = dvol !== null && dvol < 50;

  if (basisBearish && skewBearish && volHigh) {
    regime = 'CAPITULATION';
    rationale = `basis ${basisTermStructure?.toFixed(1)}% (backwardation) + RR ${riskReversal25Delta?.toFixed(1)} (put skew) + DVOL ${dvol?.toFixed(0)} → capitulation (bottom signal)`;
  } else if (basisBullish && skewBullish && volLow) {
    regime = 'EUPHORIA';
    rationale = `basis ${basisTermStructure?.toFixed(1)}% (contango) + RR ${riskReversal25Delta?.toFixed(1)} (call skew) + DVOL ${dvol?.toFixed(0)} → euphoria (top signal)`;
  } else {
    rationale = `basis ${basisTermStructure?.toFixed(1) ?? 'n/a'}% · RR ${riskReversal25Delta?.toFixed(1) ?? 'n/a'} · DVOL ${dvol?.toFixed(0) ?? 'n/a'} · VRP ${vrp?.toFixed(1) ?? 'n/a'}`;
  }

  return { basisTermStructure, riskReversal25Delta, vrp, dvol, regime, rationale };
}
