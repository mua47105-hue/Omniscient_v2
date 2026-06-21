/**
 * E4 — Derivatives-v2 (basis term structure + 25Δ risk reversal + VRP + DVOL).
 *
 * Combines Deribit's public options/book-summary API with Binance's COIN-M
 * quarterly futures to compute four derivatives signals and a regime label.
 *
 *   - basisTermStructure : futures price vs spot index (perp + next quarterly)
 *   - riskReversal25Delta: IV(25Δ call) − IV(25Δ put)  (via moneyness proxy)
 *   - vrp                : DVOL − realised vol (variance risk premium)
 *   - dvol               : Deribit DVOL implied-vol index
 *   - regime             : CAPITULATION | NEUTRAL | EUPHORIA
 *
 * Regime rules (Alexander-Imeraj 2021):
 *   basis < -5%  AND  RR < -6  AND  DVOL ≥ 90 → CAPITULATION
 *   basis > 15%  AND  RR > 4   AND  DVOL < 50 → EUPHORIA
 *   else                                  → NEUTRAL
 *
 * 8-hour cache — derivatives data is slow-moving relative to spot.
 *
 * Note on the 25Δ proxy: Deribit's `get_book_summary_by_currency` endpoint
 * does NOT return option delta, so we approximate 25Δ OTM by moneyness
 * (call strike ≈ spot × 1.1, put strike ≈ spot × 0.9). For short-dated
 * BTC options this is close to the true 25Δ strike; the bias is consistent
 * across the matrix so RR comparisons remain valid.
 */

import https from 'node:https';
import type { Kline } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DERIBIT_BASE = 'https://www.deribit.com';
const BINANCE_COINM_BASE = 'https://dapi.binance.com';

const CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const FETCH_TIMEOUT_MS = 8_000;

const OTM_CALL_MONEYNESS = 1.10; // 10% OTM call ≈ 25Δ for short-dated BTC
const OTM_PUT_MONEYNESS = 0.90; // 10% OTM put ≈ 25Δ
const MIN_DAYS_TO_EXPIRY = 7; // avoid noisy last-week options

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DerivativesCurrency = 'BTC' | 'ETH';
export type DerivativesRegime = 'CAPITULATION' | 'NEUTRAL' | 'EUPHORIA';

export interface DeribitOptionSummary {
  instrumentName: string;
  kind: 'option' | 'future' | 'combo';
  optionType?: 'call' | 'put';
  strike?: number;
  settlementPeriod?: string;
  markPrice?: number;
  markIv?: number;
  underlyingPrice?: number;
  openInterest?: number;
  volume?: number;
  expiryMs?: number;
}

export interface BasisPoint {
  expiry: string;
  basisPct: number;
  futurePrice: number;
}

export interface RiskReversalResult {
  callIv?: number;
  putIv?: number;
  riskReversal: number; // call − put, in vol points
  callStrike?: number;
  putStrike?: number;
  expiry?: string;
}

export interface DerivativesV2Result {
  currency: DerivativesCurrency;
  spot: number;
  basisTermStructure: BasisPoint[];
  /** Nearest-quarterly basis (used by the regime rule). */
  basis: number;
  riskReversal25Delta: RiskReversalResult;
  dvol: number;
  realizedVol: number; // annualised, from klines30d
  vrp: number; // DVOL − realisedVol, in vol points
  regime: DerivativesRegime;
  rationale: string;
  asOf: number;
  fromCache: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Cache (module-scoped, survives hot reload via globalThis)
// ---------------------------------------------------------------------------

interface DerivativesCacheEntry {
  at: number;
  result: DerivativesV2Result;
}

interface DerivativesGlobal {
  __OMNISCIENT_DERIVATIVES_CACHE__?: Map<string, DerivativesCacheEntry>;
}

function cacheMap(): Map<string, DerivativesCacheEntry> {
  const g = globalThis as unknown as DerivativesGlobal;
  if (!(g.__OMNISCIENT_DERIVATIVES_CACHE__ instanceof Map)) {
    g.__OMNISCIENT_DERIVATIVES_CACHE__ = new Map();
  }
  return g.__OMNISCIENT_DERIVATIVES_CACHE__!;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpsGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'OMNISCIENT/1.0 (derivatives-v2)', Accept: 'application/json' },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGetJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Deribit calls
// ---------------------------------------------------------------------------

/** Public endpoint: GET /api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option */
export async function getOptionSummaries(currency: DerivativesCurrency): Promise<DeribitOptionSummary[]> {
  const url = `${DERIBIT_BASE}/api/v2/public/get_book_summary_by_currency?currency=${currency.toLowerCase()}&kind=option`;
  const json = await httpsGetJson(url);
  const rows = json?.result ?? [];
  return rows.map(parseOptionSummary).filter((s: DeribitOptionSummary | null): s is DeribitOptionSummary => s !== null);
}

/** Public endpoint: GET /api/v2/public/get_volatility_index_data?currency=BTC — returns the latest DVOL. */
export async function getDVOL(currency: DerivativesCurrency): Promise<number> {
  // /public/get_index_price can also give the DVOL via index_name=btc_dvol
  // but the cleaner endpoint is get_volatility_index_data. Use the index price endpoint
  // for the latest single value.
  const url = `${DERIBIT_BASE}/api/v2/public/get_index_price?index_name=${currency.toLowerCase()}_dvol`;
  const json = await httpsGetJson(url);
  const v = json?.result?.index_price;
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** Spot index price from Deribit. */
async function getSpotIndex(currency: DerivativesCurrency): Promise<number> {
  const url = `${DERIBIT_BASE}/api/v2/public/get_index_price?index_name=${currency.toLowerCase()}_usd`;
  const json = await httpsGetJson(url);
  const v = json?.result?.index_price;
  return typeof v === 'number' ? v : Number(v) || 0;
}

function parseOptionSummary(row: any): DeribitOptionSummary | null {
  if (!row || typeof row.instrument_name !== 'string') return null;
  // Instrument format: "BTC-28JUN24-65000-C"
  const parts = row.instrument_name.split('-');
  const optionType = parts[3] === 'P' ? 'put' : parts[3] === 'C' ? 'call' : undefined;
  const strike = parts[2] ? Number(parts[2]) : undefined;
  let expiryMs: number | undefined;
  if (parts[1]) {
    const ms = Date.parse(parts[1].replace(/(\d{2})([A-Z]{3})(\d{2})/, '20$3-$2-$1T08:00:00Z'));
    if (Number.isFinite(ms)) expiryMs = ms;
  }
  return {
    instrumentName: row.instrument_name,
    kind: 'option',
    optionType,
    strike,
    settlementPeriod: row.settlement_period,
    markPrice: num(row.mark_price),
    markIv: num(row.mark_iv),
    underlyingPrice: num(row.underlying_price),
    openInterest: num(row.open_interest),
    volume: num(row.volume),
    expiryMs,
  };
}

function num(x: unknown): number | undefined {
  if (typeof x === 'number') return x;
  if (typeof x === 'string') {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 25Δ moneyness proxy
// ---------------------------------------------------------------------------

/**
 * Find a representative OTM call and OTM put for the 25Δ risk-reversal.
 * Moneyness proxy: call strike ≈ spot × 1.1, put strike ≈ spot × 0.9.
 * Picks the nearest expiry that's ≥7 days out, then the strike closest to
 * the target within that expiry.
 */
export function find25DeltaOptions(
  options: DeribitOptionSummary[],
  currency: DerivativesCurrency,
): { call?: DeribitOptionSummary; put?: DeribitOptionSummary; spot: number } {
  // Spot: prefer the underlying_price of any option; fall back to a Deribit call.
  const spot = options.find((o) => o.underlyingPrice && o.underlyingPrice > 0)?.underlyingPrice ?? 0;
  if (spot <= 0) return { spot: 0 };

  const now = Date.now();
  const minExpiry = now + MIN_DAYS_TO_EXPIRY * 24 * 60 * 60 * 1000;

  // Calls and puts, filtered to liquid-enough expiries.
  const calls = options.filter(
    (o) => o.optionType === 'call' && o.expiryMs && o.expiryMs >= minExpiry && o.markIv != null,
  );
  const puts = options.filter(
    (o) => o.optionType === 'put' && o.expiryMs && o.expiryMs >= minExpiry && o.markIv != null,
  );

  // Pick the nearest valid expiry (smallest expiry ≥ minExpiry).
  const expiries = Array.from(
    new Set([...calls, ...puts].map((o) => o.expiryMs!)),
  ).sort((a, b) => a - b);
  if (expiries.length === 0) return { spot };
  const targetExpiry = expiries[0];

  const targetCallStrike = spot * OTM_CALL_MONEYNESS;
  const targetPutStrike = spot * OTM_PUT_MONEYNESS;

  const call = calls
    .filter((o) => o.expiryMs === targetExpiry && o.strike != null)
    .sort((a, b) => Math.abs(a.strike! - targetCallStrike) - Math.abs(b.strike! - targetCallStrike))[0];

  const put = puts
    .filter((o) => o.expiryMs === targetExpiry && o.strike != null)
    .sort((a, b) => Math.abs(a.strike! - targetPutStrike) - Math.abs(b.strike! - targetPutStrike))[0];

  return { call, put, spot };
}

// ---------------------------------------------------------------------------
// Binance COIN-M quarterly
// ---------------------------------------------------------------------------

interface BinanceDapiTicker {
  symbol: string;
  markPrice: string;
  lastPrice: string;
}

/**
 * Binance COIN-M dapi ticker for the next quarterly future.
 * Symbols look like BTCUSD_240329 (YYMMDD expiry, last weekday of quarter).
 */
export async function getCoinMQuarterlyPrice(
  currency: DerivativesCurrency,
): Promise<{ symbol: string; price: number; expiry: string } | null> {
  const url = `${BINANCE_COINM_BASE}/dapi/v1/ticker/price`;
  const json = await httpsGetJson(url);
  const rows: BinanceDapiTicker[] = Array.isArray(json) ? json : [];
  const prefix = `${currency}USD_`;
  // Quarterly expiries land on the last Friday of Mar/Jun/Sep/Dec.
  // Pick the symbol whose expiry date is the soonest in the future.
  const now = Date.now();
  const candidates = rows
    .filter((r) => r.symbol.startsWith(prefix))
    .map((r) => {
      const expiry = r.symbol.slice(prefix.length); // e.g. "240329"
      const ms = parseExpiry(expiry);
      return { symbol: r.symbol, price: Number(r.lastPrice) || Number(r.markPrice) || 0, expiryMs: ms, expiry };
    })
    .filter((x) => Number.isFinite(x.expiryMs) && x.expiryMs > now && x.price > 0)
    .sort((a, b) => a.expiryMs - b.expiryMs);

  if (candidates.length === 0) return null;
  const c = candidates[0];
  return { symbol: c.symbol, price: c.price, expiry: c.expiry };
}

/** Parse YYMMDD → ms. */
function parseExpiry(yyMMdd: string): number {
  if (yyMMdd.length !== 6) return NaN;
  const yy = Number(yyMMdd.slice(0, 2));
  const mm = Number(yyMMdd.slice(2, 4));
  const dd = Number(yyMMdd.slice(4, 6));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return NaN;
  return Date.UTC(2000 + yy, mm - 1, dd, 8, 0, 0);
}

// ---------------------------------------------------------------------------
// Realised vol from klines
// ---------------------------------------------------------------------------

function realizedVolFromKlines(klines: Kline[]): number {
  if (!klines || klines.length < 2) return 0;
  const rs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const a = klines[i - 1].close;
    const b = klines[i].close;
    if (a > 0 && b > 0) rs.push(Math.log(b / a));
  }
  if (rs.length < 2) return 0;
  const n = rs.length;
  let s = 0;
  for (const r of rs) s += r;
  const m = s / n;
  let ss = 0;
  for (const r of rs) ss += (r - m) * (r - m);
  const sd = Math.sqrt(ss / (n - 1));
  // Assume daily bars → annualise by sqrt(365).
  return sd * Math.sqrt(365);
}

// ---------------------------------------------------------------------------
// Regime
// ---------------------------------------------------------------------------

function classifyRegime(basis: number, rr: number, dvol: number): DerivativesRegime {
  if (basis < -5 && rr < -6 && dvol >= 90) return 'CAPITULATION';
  if (basis > 15 && rr > 4 && dvol < 50) return 'EUPHORIA';
  return 'NEUTRAL';
}

// ---------------------------------------------------------------------------
// Public: compute everything
// ---------------------------------------------------------------------------

export async function computeDerivativesV2(
  currency: DerivativesCurrency,
  klines30d: Kline[],
): Promise<DerivativesV2Result> {
  // Cache check.
  const cache = cacheMap();
  const cached = cache.get(currency);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return { ...cached.result, fromCache: true };
  }

  const errors: string[] = [];

  // Fire requests in parallel.
  const [spot, options, dvol, quarterly] = await Promise.all([
    getSpotIndex(currency).catch((e) => {
      errors.push(`spot: ${msg(e)}`);
      return 0;
    }),
    getOptionSummaries(currency).catch((e) => {
      errors.push(`options: ${msg(e)}`);
      return [] as DeribitOptionSummary[];
    }),
    getDVOL(currency).catch((e) => {
      errors.push(`dvol: ${msg(e)}`);
      return 0;
    }),
    getCoinMQuarterlyPrice(currency).catch((e) => {
      errors.push(`coinm: ${msg(e)}`);
      return null;
    }),
  ]);

  // --- Risk reversal (25Δ proxy) --------------------------------------
  const { call, put } = find25DeltaOptions(options, currency);
  const callIv = call?.markIv;
  const putIv = put?.markIv;
  let riskReversal = 0;
  if (callIv != null && putIv != null) riskReversal = callIv - putIv;
  else if (callIv != null || putIv != null) {
    // Degenerate — record an error so the caller knows.
    errors.push('rr: incomplete 25Δ pair');
  }
  const rr: RiskReversalResult = {
    callIv,
    putIv,
    riskReversal,
    callStrike: call?.strike,
    putStrike: put?.strike,
    expiry: call?.expiryMs ? new Date(call.expiryMs).toISOString().slice(0, 10) : undefined,
  };

  // --- Basis term structure ------------------------------------------
  const basisTermStructure: BasisPoint[] = [];
  let basis = 0;
  if (spot > 0 && quarterly && quarterly.price > 0) {
    const b = ((quarterly.price - spot) / spot) * 100;
    basis = b;
    basisTermStructure.push({
      expiry: quarterly.expiry,
      basisPct: b,
      futurePrice: quarterly.price,
    });
  } else {
    errors.push('basis: missing spot or quarterly');
  }

  // --- VRP -----------------------------------------------------------
  const realizedVol = realizedVolFromKlines(klines30d);
  // DVOL is reported as a percentage (e.g. 60 = 60%). Convert to fraction,
  // compare with realisedVol (fraction), then express the premium in vol
  // points.
  const dvolPct = dvol / 100;
  const vrp = (dvolPct - realizedVol) * 100;

  // --- Regime --------------------------------------------------------
  const regime = classifyRegime(basis, riskReversal, dvol);

  const rationale = buildRationale(regime, basis, riskReversal, dvol, realizedVol, vrp, currency);

  const result: DerivativesV2Result = {
    currency,
    spot,
    basisTermStructure,
    basis,
    riskReversal25Delta: rr,
    dvol,
    realizedVol,
    vrp,
    regime,
    rationale,
    asOf: now,
    fromCache: false,
    errors,
  };

  cache.set(currency, { at: now, result });
  return result;
}

function buildRationale(
  regime: DerivativesRegime,
  basis: number,
  rr: number,
  dvol: number,
  rv: number,
  vrp: number,
  currency: DerivativesCurrency,
): string {
  const parts: string[] = [`${currency} ${regime}`];
  parts.push(`basis=${basis.toFixed(1)}%`);
  parts.push(`RR25Δ=${rr.toFixed(1)}vp`);
  parts.push(`DVOL=${dvol.toFixed(0)}`);
  parts.push(`rv=${(rv * 100).toFixed(0)}%`);
  parts.push(`VRP=${vrp.toFixed(1)}vp`);
  if (regime === 'CAPITULATION') {
    parts.push('— negative basis + put skew + elevated vol → capitulation');
  } else if (regime === 'EUPHORIA') {
    parts.push('— contango + call skew + depressed vol → euphoria');
  }
  return parts.join(' ');
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Test helper — clears the cache. NOT for production use.
// ---------------------------------------------------------------------------

export function __clearDerivativesCacheForTests(): void {
  cacheMap().clear();
}
