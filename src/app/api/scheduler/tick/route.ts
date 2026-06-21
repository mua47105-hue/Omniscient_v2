/**
 * Scheduler tick — the Lazy Brain's main loop.
 *
 * Pinged every 60s by the mini-service on port 3042. Order of operations
 * (all best-effort — safety paths never block):
 *
 *   1.  hydrate() + tickStarted()
 *   2.  gradeExpiredSignals()      (self-learning grading loop)
 *   3.  checkPriceAlerts()         (user price thresholds)
 *   4.  runForcedAnalysis()        (drain force-run queue; works even paused)
 *   5.  checkNewsTriggers()        (every-tick RSS scan, 5-min cache)
 *   6.  Find due ScheduleJobs (parse "STAR/N MIN HR DOM MON DOW" as every N min).
 *       If none due → recordSample() + tickEnded() + return skipped.
 *   7.  For crypto_technical job: runCryptoScan(sendAlerts)
 *   8.  checkCrossAssetTriggers()  (BTC/ETH volatile → queue correlated alts)
 *   9.  selfTune()                 (best-effort)
 *   10. Supabase sync              (best-effort, dynamic import)
 *   11. recordSample() + tickEnded()
 *   12. Return {ran, skipped, grading, priceAlerts, forced, triggers,
 *              newsTriggers, tune, sync}
 *
 * analyzeAsset() is the per-asset pipeline:
 *   klines(4h,200) + orderbook(50) + funding + ticker  → computeIndicators
 *   → getOnchainTrend → deterministic computeConsensus → gateDecide
 *   → (if LLM eligible) triage/deep prompt → completeWithAutoFallback
 *   → safeParseJson (NO jsonMode — Pollinations breaks) → llmLayer
 *   → final computeConsensus → setWatch → volTargetSize → db.signal.create
 *   → alert if shouldAlert → recordAction.
 *
 * Both GET (returns ScheduleJob list + lastSchedulerTick) and POST (runs the
 * tick) are force-dynamic. POST has maxDuration=300 (5 min) so a slow scan
 * can't be killed by the platform.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import {
  hydrate,
  tickStarted,
  tickEnded,
  recordSample,
  snapshot,
  consumeForceRunQueue,
  setWatch,
  recordLlmCall,
  recordLlmSuccess,
  recordLlmFailure,
  recordAlert,
  recordAction,
  isRunning,
  llmInCooldown,
  type TriggerSource,
} from '@/lib/brain/state';
import { gateDecide } from '@/lib/brain/engine';
import { selfTune } from '@/lib/brain/selftune';
import { checkCrossAssetTriggers } from '@/lib/brain/triggers';
import { checkNewsTriggers } from '@/lib/brain/news-triggers';
import { gradeExpiredSignals } from '@/lib/analysis/grading';
import { checkPriceAlerts } from '@/lib/analysis/price-alerts';
import {
  computeConsensus,
  buildTechnicalLayer,
  buildOrderbookLayer,
  buildOnchainLayer,
  shouldAlert,
  type AlertThresholds,
  type OnchainTrend as ConsensusOnchainTrend,
} from '@/lib/analysis/consensus';
import { volTargetSize } from '@/lib/risk/vol_targeting';
import { computeIndicators } from '@/lib/market/indicators';
import {
  getKlines,
  getOrderBook,
  getFundingRate,
  getTicker24h,
} from '@/lib/market/binance';
import {
  getOnChainStats,
  getHashrateHistory,
} from '@/lib/market/onchain';
import {
  completeWithAutoFallback,
  resolveModel,
  type ResolvedModel,
} from '@/lib/llm/router';
import { CRYPTO_TECHNICAL_SYSTEM } from '@/lib/llm/prompts';
import { sendSignalAlert } from '@/lib/alerts/telegram';
import {
  getSetting,
  setSetting,
  SETTING_KEYS,
} from '@/lib/config/settings';
import type {
  Kline,
  OrderBook,
  Ticker,
  LayerScore,
  Direction,
  AssetClass,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Cron parsing — "*/N * * * *" → every N minutes
// ---------------------------------------------------------------------------

function parseEveryNMin(cron: string): number | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const m = parts[0].match(/^\*\/(\d+)$/);
  if (!m) return null;
  // Other fields must be "*" (every).
  if (!parts.slice(1).every((p) => p === '*')) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function isJobDue(cron: string, lastRunAt: Date | null): boolean {
  const n = parseEveryNMin(cron);
  if (n == null) return false;
  if (!lastRunAt) return true;
  const elapsedMin = (Date.now() - lastRunAt.getTime()) / 60_000;
  return elapsedMin >= n;
}

// ---------------------------------------------------------------------------
// JSON safety — Pollinations (and most free providers) ignore response_format
// and occasionally wrap output in markdown fences. We strip and best-effort
// parse so a single bad token doesn't lose us the whole asset's analysis.
// ---------------------------------------------------------------------------

function safeParseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let t = text.trim();
  // Strip ```json ... ``` fences.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Find the first {...} block (LLMs sometimes prepend prose).
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt builders (compact — free-tier RPM is the binding constraint)
// ---------------------------------------------------------------------------

function buildTriagePrompt(
  symbol: string,
  ti: ReturnType<typeof computeIndicators>,
  ob: OrderBook,
  fundingRate: number,
  ticker: Ticker,
  consensusScore: number,
): string {
  return [
    `Symbol: ${symbol}`,
    `Price: ${ti.lastClose ?? ticker.lastPrice}  24h%: ${ticker.priceChangePercent?.toFixed(2)}`,
    `Trend: ${ti.trend}  SummaryScore: ${consensusScore}`,
    `RSI14: ${ti.rsi14?.toFixed(1)}  MACD-hist: ${ti.macd?.histogram?.toFixed(3)}`,
    `EMA12/26: ${ti.ema12?.toFixed(2)}/${ti.ema26?.toFixed(2)}  ATR%: ${(((ti.atr14 ?? 0) / (ti.lastClose ?? 1)) * 100).toFixed(2)}`,
    `Funding: ${(fundingRate * 100).toFixed(4)}%`,
    `OB: bidVol/askVol in top 10`,
    `Return STRICT JSON {direction,conviction,entry,stopLoss,takeProfit,rationale,tags[]}.`,
  ].join('\n');
}

function buildDeepPrompt(
  symbol: string,
  ti: ReturnType<typeof computeIndicators>,
  ob: OrderBook,
  fundingRate: number,
  ticker: Ticker,
  consensusScore: number,
): string {
  // Deep prompt includes bollinger + vwap + a richer OB read.
  const bidVol = ob.bids.slice(0, 10).reduce((s, l) => s + l.quantity, 0);
  const askVol = ob.asks.slice(0, 10).reduce((s, l) => s + l.quantity, 0);
  return [
    `Deep analysis — ${symbol}`,
    `Price: ${ti.lastClose ?? ticker.lastPrice}  24h%: ${ticker.priceChangePercent?.toFixed(2)}  Vol: ${ticker.quoteVolume}`,
    `Trend: ${ti.trend}  DetScore: ${consensusScore}`,
    `RSI14: ${ti.rsi14?.toFixed(1)}  MACD: ${ti.macd?.macd?.toFixed(3)}/${ti.macd?.signal?.toFixed(3)} (hist ${ti.macd?.histogram?.toFixed(3)})`,
    `EMA12/26: ${ti.ema12?.toFixed(2)}/${ti.ema26?.toFixed(2)}  SMA20: ${ti.sma20?.toFixed(2)}`,
    `Bollinger: u=${ti.bollinger.upper?.toFixed(2)} m=${ti.bollinger.middle?.toFixed(2)} l=${ti.bollinger.lower?.toFixed(2)}`,
    `VWAP: ${ti.vwap?.toFixed(2)}  ATR14: ${ti.atr14?.toFixed(2)}`,
    `Funding: ${(fundingRate * 100).toFixed(4)}%`,
    `OB top10: bidVol=${bidVol.toFixed(2)} askVol=${askVol.toFixed(2)} imbalance=${(bidVol - askVol).toFixed(2)}`,
    `Return STRICT JSON {direction,conviction,entry,stopLoss,takeProfit,rationale(<=280 chars),tags[]}.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// analyzeAsset — per-asset pipeline (the heart of the brain)
// ---------------------------------------------------------------------------

interface AnalyzeAssetResult {
  symbol: string;
  direction: Direction;
  conviction: number;
  alerted: boolean;
  signalId?: string;
  action: 'skip' | 'cache' | 'analyze';
  tier: 0 | 1 | 2;
  reason: string;
  noteworthiness: number;
  regime: 'trending' | 'ranging' | 'volatile';
}

async function analyzeAsset(
  asset: { id: string; symbol: string; assetClass: string; isActive: boolean },
  sendAlerts: boolean,
  thresholds: Record<string, AlertThresholds>,
  defaultThreshold: AlertThresholds,
  llmCfg: ResolvedModel | null,
  forceDeep = false,
  triggerSource: TriggerSource = 'scheduler',
): Promise<AnalyzeAssetResult> {
  const symbol = asset.symbol;

  // 1. Parallel market-data fetch.
  const emptyOrderbook: OrderBook = { symbol, bids: [], asks: [], fetchedAt: Date.now() };
  const emptyTicker: Ticker = {
    symbol,
    lastPrice: 0,
    priceChange: 0,
    priceChangePercent: 0,
    high: 0,
    low: 0,
    volume: 0,
    quoteVolume: 0,
    fetchedAt: Date.now(),
  };
  const [klines, orderbook, fundingInfo, ticker] = await Promise.all([
    getKlines(symbol, '4h', 200).catch((e) => {
      console.warn(`[tick] klines failed for ${symbol}:`, (e as Error).message);
      return [] as Kline[];
    }),
    getOrderBook(symbol, 50).catch((e) => {
      console.warn(`[tick] orderbook failed for ${symbol}:`, (e as Error).message);
      return emptyOrderbook;
    }),
    getFundingRate(symbol).catch(() => null),
    getTicker24h(symbol).catch((e) => {
      console.warn(`[tick] ticker failed for ${symbol}:`, (e as Error).message);
      return emptyTicker;
    }),
  ]);
  const fundingRate = fundingInfo?.fundingRate ?? 0;

  // 2. computeIndicators
  const ti = computeIndicators(klines);

  // 3. Onchain trend (BTC only — best-effort).
  let onchainLayer: LayerScore | null = null;
  try {
    // Ensure cache is fresh + ring buffer populated.
    await getOnChainStats();
    const history = getHashrateHistory();
    if (history.length >= 3) {
      const trendForLayer: ConsensusOnchainTrend = {
        asset: 'BTC',
        samples: history,
        current: history[history.length - 1],
      };
      onchainLayer = buildOnchainLayer(trendForLayer, symbol);
    }
  } catch {
    /* ignore — onchain is best-effort */
  }

  // 4. Deterministic consensus (no LLM layer).
  const technicalLayer = buildTechnicalLayer(ti);
  const orderbookLayer = buildOrderbookLayer(orderbook);
  const detConsensus = computeConsensus({
    symbol,
    assetClass: asset.assetClass as AssetClass,
    technical: technicalLayer,
    orderbook: orderbookLayer,
    onchain: onchainLayer,
  });

  // 5. Gate decision.
  let decision = gateDecide({
    symbol,
    ti,
    ob: orderbook,
    fundingRate,
    ticker,
    consensus: detConsensus,
    forceRun: forceDeep ? triggerSource : null,
  });

  // Force-deep overrides the gate to analyze+tier2 (bypasses YAGNI/cache/cadence
  // but NOT budget — gateDecide already short-circuits on budget-exhausted).
  if (forceDeep && decision.action !== 'skip') {
    decision = {
      ...decision,
      action: 'analyze',
      tier: 2,
      reason: `force-deep:${triggerSource}`,
    };
  } else if (forceDeep && decision.action === 'skip' && decision.reason === 'budget-exhausted') {
    // Budget exhausted — keep the skip, but log the force attempt.
    decision = { ...decision, reason: `force-deep-blocked:${decision.reason}` };
  }

  // 6. LLM call (if eligible).
  const canCallLlm = !!(llmCfg && (forceDeep || isRunning()));
  let llmLayer: LayerScore | null = null;

  if (canCallLlm && decision.action === 'analyze') {
    // Global circuit-breaker: skip when in cooldown, unless force-deep.
    if (llmInCooldown() && !forceDeep) {
      decision = {
        ...decision,
        action: 'skip',
        tier: 0,
        reason: 'llm-cooldown',
      };
    } else {
      try {
        const tier = decision.tier;
        const prompt =
          tier === 2
            ? buildDeepPrompt(symbol, ti, orderbook, fundingRate, ticker, detConsensus.summaryScore)
            : buildTriagePrompt(symbol, ti, orderbook, fundingRate, ticker, detConsensus.summaryScore);

        const response = await completeWithAutoFallback({
          messages: [
            { role: 'system', content: CRYPTO_TECHNICAL_SYSTEM },
            { role: 'user', content: prompt },
          ],
          moduleKey: 'crypto_technical',
          layer: tier === 2 ? 'deep' : 'triage',
          temperature: llmCfg?.temperature ?? 0.3,
        });

        const parsed = safeParseJson(response.text);
        if (parsed && typeof parsed.direction === 'string') {
          const dir = parsed.direction as Direction;
          const conv = typeof parsed.conviction === 'number'
            ? Math.max(0, Math.min(100, parsed.conviction))
            : 50;
          llmLayer = {
            layer: 'llm',
            direction: dir,
            score: dir === 'long' ? 50 : dir === 'short' ? -50 : 0,
            confidence: conv / 100,
            rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'LLM analysis',
            weight: 0.2,
          };
          recordLlmCall(response.usage?.totalTokens ?? 1000);
          recordLlmSuccess();
        } else {
          // Got a response but couldn't parse — treat as a soft failure.
          recordLlmFailure();
        }
      } catch (e) {
        console.warn(`[tick] LLM failed for ${symbol}:`, (e as Error).message);
        recordLlmFailure();
        // Decision stays as 'analyze' — the final consensus just won't include
        // the llm layer, which is exactly the safe fallback.
      }
    }
  }

  // 7. Final consensus (with llmLayer if we got one).
  const finalConsensus = computeConsensus(
    {
      symbol,
      assetClass: asset.assetClass as AssetClass,
      technical: technicalLayer,
      orderbook: orderbookLayer,
      onchain: onchainLayer,
    },
    llmLayer,
  );

  // 8. Update watch cache.
  setWatch({
    symbol,
    lastAnalyzedAt: decision.action === 'analyze' ? Date.now() : 0,
    lastDataSig: decision.dataSig,
    lastVerdict: finalConsensus.direction,
    lastNoteworthiness: decision.noteworthiness,
    regime: decision.regime,
    action: decision.action,
    updatedAt: Date.now(),
  });

  // 9. Vol-target sizing (E1) + trigger tag stamp into rationale.
  // 4h bars → 6 bars/day → 6 × 365 = 2190 bars/year.
  const volTarget = volTargetSize(10000, klines, { barsPerYear: 365 * 6 });
  const triggerTag = `[trigger:${triggerSource}]`;
  const volTag = `[${volTarget.rationale}]`;
  const stampedRationale = `${triggerTag} ${volTag}\n${finalConsensus.rationale ?? ''}`;

  // Compute entry/stop/take from ATR if not already set by the consensus.
  const lastClose = ti.lastClose ?? ticker.lastPrice ?? null;
  const atr = ti.atr14 ?? 0;
  let entryPrice: number | null = finalConsensus.entryPrice ?? lastClose;
  let stopLoss: number | null = finalConsensus.stopLoss ?? null;
  let takeProfit: number | null = finalConsensus.takeProfit ?? null;
  if (entryPrice && atr > 0 && finalConsensus.direction !== 'neutral') {
    if (stopLoss == null) {
      stopLoss = finalConsensus.direction === 'long'
        ? entryPrice - 1.5 * atr
        : entryPrice + 1.5 * atr;
    }
    if (takeProfit == null) {
      takeProfit = finalConsensus.direction === 'long'
        ? entryPrice + 2 * atr
        : entryPrice - 2 * atr;
    }
  }

  // 10. db.signal.create.
  let signalId: string | undefined;
  try {
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4h horizon
    const sig = await db.signal.create({
      data: {
        assetId: asset.id,
        direction: finalConsensus.direction,
        conviction: finalConsensus.conviction,
        timeframe: '4h',
        layersSummary: JSON.stringify(
          finalConsensus.layers.map((l) => ({
            layer: l.layer,
            direction: l.direction,
            score: l.score,
            confidence: l.confidence,
          })),
        ),
        modelsUsed: JSON.stringify(llmLayer ? ['llm'] : ['deterministic']),
        entryPrice,
        stopLoss,
        takeProfit,
        rationale: stampedRationale,
        status: 'open',
        expiresAt,
      },
    });
    signalId = sig.id;
  } catch (e) {
    console.error(`[tick] signal.create failed for ${symbol}:`, (e as Error).message);
  }

  // 11. Alert if shouldAlert.
  let alerted = false;
  if (sendAlerts && signalId) {
    const perAsset = (thresholds && thresholds[symbol]) || {};
    const alertThresholds: AlertThresholds = { ...defaultThreshold, ...perAsset };
    if (shouldAlert(finalConsensus, alertThresholds)) {
      try {
        const ok = await sendSignalAlert(finalConsensus);
        if (ok) {
          alerted = true;
          recordAlert();
        }
      } catch (e) {
        console.warn(`[tick] alert send failed for ${symbol}:`, (e as Error).message);
      }
    }
  }

  // 12. recordAction.
  recordAction({
    symbol,
    action: alerted ? 'alert' : decision.action,
    reason: decision.reason,
    tier: decision.tier,
    source: triggerSource,
  });

  return {
    symbol,
    direction: finalConsensus.direction,
    conviction: finalConsensus.conviction,
    alerted,
    signalId,
    action: decision.action,
    tier: decision.tier,
    reason: decision.reason,
    noteworthiness: decision.noteworthiness,
    regime: decision.regime,
  };
}

// ---------------------------------------------------------------------------
// runForcedAnalysis — drain the force-run queue. Works even when brain paused.
// ---------------------------------------------------------------------------

async function runForcedAnalysis(sendAlerts: boolean): Promise<AnalyzeAssetResult[]> {
  const queue = consumeForceRunQueue();
  const out: AnalyzeAssetResult[] = [];
  if (queue.size === 0) return out;

  const thresholds = (await getSetting<Record<string, AlertThresholds>>(SETTING_KEYS.alertThresholds, {})) ?? {};
  const defaultThreshold = (await getSetting<AlertThresholds>(SETTING_KEYS.defaultThreshold, {})) ?? {};
  const llmCfg = await resolveModel('crypto_technical', 'primary').catch(() => null);

  for (const [symbol, source] of queue.entries()) {
    try {
      const asset = await db.asset.findUnique({ where: { symbol } });
      if (!asset || !asset.isActive) {
        out.push({
          symbol,
          direction: 'neutral',
          conviction: 0,
          alerted: false,
          action: 'skip',
          tier: 0,
          reason: 'asset-not-found',
          noteworthiness: 0,
          regime: 'ranging',
        });
        continue;
      }
      const result = await analyzeAsset(
        asset,
        sendAlerts,
        thresholds,
        defaultThreshold,
        llmCfg,
        true,
        source,
      );
      out.push(result);
    } catch (e) {
      console.error(`[tick] forced analysis failed for ${symbol}:`, (e as Error).message);
      out.push({
        symbol,
        direction: 'neutral',
        conviction: 0,
        alerted: false,
        action: 'skip',
        tier: 0,
        reason: `error:${(e as Error).message}`,
        noteworthiness: 0,
        regime: 'ranging',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// runCryptoScan — for each active crypto asset, run analyzeAsset with the
// scheduled trigger source. Honors brain running flag (no LLM if paused).
// ---------------------------------------------------------------------------

async function runCryptoScan(sendAlerts: boolean): Promise<AnalyzeAssetResult[]> {
  const assets = await db.asset.findMany({
    where: { assetClass: 'crypto', isActive: true },
    take: 100,
  });

  const thresholds = (await getSetting<Record<string, AlertThresholds>>(SETTING_KEYS.alertThresholds, {})) ?? {};
  const defaultThreshold = (await getSetting<AlertThresholds>(SETTING_KEYS.defaultThreshold, {})) ?? {};
  const llmCfg = await resolveModel('crypto_technical', 'primary').catch(() => null);

  const out: AnalyzeAssetResult[] = [];
  for (const asset of assets) {
    try {
      const result = await analyzeAsset(
        asset,
        sendAlerts,
        thresholds,
        defaultThreshold,
        llmCfg,
        false,
        'scheduler',
      );
      out.push(result);
    } catch (e) {
      console.error(`[tick] scan failed for ${asset.symbol}:`, (e as Error).message);
      out.push({
        symbol: asset.symbol,
        direction: 'neutral',
        conviction: 0,
        alerted: false,
        action: 'skip',
        tier: 0,
        reason: `error:${(e as Error).message}`,
        noteworthiness: 0,
        regime: 'ranging',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// findDueJobs + markJobRun
// ---------------------------------------------------------------------------

async function findDueJobs(): Promise<{ id: string; moduleKey: string; cronExpr: string }[]> {
  let jobs: { id: string; moduleKey: string; cronExpr: string; lastRunAt: Date | null }[] = [];
  try {
    jobs = await db.scheduleJob.findMany({
      where: { enabled: true },
    });
  } catch (err) {
    console.error('[tick] scheduleJob query failed:', (err as Error).message);
    return [];
  }
  return jobs.filter((j) => isJobDue(j.cronExpr, j.lastRunAt));
}

async function markJobRun(jobId: string, status: string, error?: string): Promise<void> {
  try {
    await db.scheduleJob.update({
      where: { id: jobId },
      data: {
        lastRunAt: new Date(),
        lastStatus: status,
        lastError: error ?? null,
      },
    });
  } catch (e) {
    console.error('[tick] markJobRun failed:', (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// GET — ScheduleJob list + lastSchedulerTick
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const jobs = await db.scheduleJob.findMany({ orderBy: { moduleKey: 'asc' } });
    const lastTick = await getSetting<string>(SETTING_KEYS.lastSchedulerTick);
    return NextResponse.json({
      success: true,
      data: {
        jobs,
        lastSchedulerTick: lastTick ?? null,
        running: snapshot().running,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — the main tick loop
// ---------------------------------------------------------------------------

export async function POST() {
  const tickStartTs = Date.now();
  const result: {
    ran: boolean;
    skipped: boolean;
    grading: Awaited<ReturnType<typeof gradeExpiredSignals>> | null;
    priceAlerts: Awaited<ReturnType<typeof checkPriceAlerts>> | null;
    forced: AnalyzeAssetResult[];
    triggers: ReturnType<typeof checkCrossAssetTriggers> | null;
    newsTriggers: Awaited<ReturnType<typeof checkNewsTriggers>> | null;
    tune: Awaited<ReturnType<typeof selfTune>> | null;
    sync: unknown;
    scan?: AnalyzeAssetResult[];
    durationMs: number;
  } = {
    ran: false,
    skipped: false,
    grading: null,
    priceAlerts: null,
    forced: [],
    triggers: null,
    newsTriggers: null,
    tune: null,
    sync: null,
    durationMs: 0,
  };

  // 1. hydrate + tickStarted.
  try {
    await hydrate();
  } catch (e) {
    console.warn('[tick] hydrate failed:', (e as Error).message);
  }
  tickStarted();

  // 2. gradeExpiredSignals (best-effort).
  try {
    result.grading = await gradeExpiredSignals();
  } catch (e) {
    console.error('[tick] grading failed:', (e as Error).message);
  }

  // 3. checkPriceAlerts (best-effort).
  try {
    result.priceAlerts = await checkPriceAlerts();
  } catch (e) {
    console.error('[tick] price alerts failed:', (e as Error).message);
  }

  // 4. runForcedAnalysis — drain the queue. Works even when brain paused.
  try {
    const forced = await runForcedAnalysis(true);
    result.forced.push(...forced);
  } catch (e) {
    console.error('[tick] forced analysis failed:', (e as Error).message);
  }

  // 5. checkNewsTriggers — every-tick RSS scan (5-min cache). If triggered,
  //    it queues assets via forceRun — drain those immediately.
  try {
    result.newsTriggers = await checkNewsTriggers();
    if (result.newsTriggers?.triggered) {
      const newsForced = await runForcedAnalysis(true);
      result.forced.push(...newsForced);
    }
  } catch (e) {
    console.error('[tick] news triggers failed:', (e as Error).message);
  }

  // 6. Find due ScheduleJobs. If none → record sample + end + return skipped.
  let dueJobs: { id: string; moduleKey: string; cronExpr: string }[] = [];
  try {
    dueJobs = await findDueJobs();
  } catch (e) {
    console.error('[tick] findDueJobs failed:', (e as Error).message);
  }

  if (dueJobs.length === 0) {
    recordSample();
    tickEnded();
    result.skipped = true;
    result.durationMs = Date.now() - tickStartTs;
    // Persist last-tick timestamp (best-effort).
    try {
      await setSetting(SETTING_KEYS.lastSchedulerTick, new Date().toISOString());
    } catch {
      /* ignore */
    }
    return NextResponse.json({ success: true, data: result });
  }

  // 7. For each due job, dispatch by moduleKey. crypto_technical → runCryptoScan.
  for (const job of dueJobs) {
    try {
      if (job.moduleKey === 'crypto_technical') {
        const scanResults = await runCryptoScan(true);
        result.scan = scanResults;
      }
      // Other moduleKeys can be added here as the app grows.
      await markJobRun(job.id, 'ok');
    } catch (e) {
      console.error(`[tick] job ${job.moduleKey} failed:`, (e as Error).message);
      await markJobRun(job.id, 'error', (e as Error).message);
    }
  }
  result.ran = true;

  // 8. checkCrossAssetTriggers — BTC/ETH volatile → queue correlated alts.
  //    If triggered, drain the newly-queued force runs.
  try {
    result.triggers = checkCrossAssetTriggers();
    if (result.triggers?.triggered) {
      const crossForced = await runForcedAnalysis(true);
      result.forced.push(...crossForced);
    }
  } catch (e) {
    console.error('[tick] cross-asset triggers failed:', (e as Error).message);
  }

  // 9. selfTune (best-effort).
  try {
    result.tune = await selfTune();
  } catch (e) {
    console.error('[tick] self-tune failed:', (e as Error).message);
  }

  // 10. Supabase sync (best-effort, dynamic import — module may not exist).
  try {
    const supabase = await import('@/lib/supabase/sync').catch(() => null);
    if (supabase && typeof (supabase as any).syncToSupabase === 'function') {
      result.sync = await (supabase as any).syncToSupabase();
    }
  } catch (e) {
    console.warn('[tick] supabase sync skipped:', (e as Error).message);
  }

  // 11. recordSample + tickEnded.
  recordSample();
  tickEnded();
  result.durationMs = Date.now() - tickStartTs;

  // Persist last-tick timestamp (best-effort).
  try {
    await setSetting(SETTING_KEYS.lastSchedulerTick, new Date().toISOString());
  } catch {
    /* ignore */
  }

  // 12. Return.
  return NextResponse.json({ success: true, data: result });
}
