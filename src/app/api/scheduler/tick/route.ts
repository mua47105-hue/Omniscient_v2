// Scheduler tick endpoint — called by the always-on mini-service scheduler.
//
// The Lazy Brain governs the LLM layer here. For every active crypto asset the
// brain: (1) computes a FREE deterministic consensus, (2) runs the ponytail
// gate to decide skip/cache/analyze, (3) only calls the LLM when the gate
// permits. Safety layers (grading, price alerts, alert delivery, Supabase
// sync) always run — the brain never silences them. Manual force-run requests
// are processed every tick, even when the autonomous brain is paused.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getKlines, getTicker24h, getOrderBook, getFundingRate } from '@/lib/market/binance';
import { computeIndicators } from '@/lib/market/indicators';
import { computeConsensus, shouldAlert } from '@/lib/analysis/consensus';
import { gradeExpiredSignals } from '@/lib/analysis/grading';
import { checkPriceAlerts } from '@/lib/analysis/price-alerts';
import { resolveModel, completeWithAutoFallback } from '@/lib/llm/router';
import { SCHEDULER_TICK_SYSTEM } from '@/lib/llm/prompts';
import { sendSignalAlert } from '@/lib/alerts/telegram';
import { getSetting, setSetting, SETTING_KEYS } from '@/lib/config/settings';
import {
  hydrate, isRunning, tickStarted, tickEnded, getWatch, setWatch, getConfig, budgetExhausted,
  recordSkip, recordCacheHit, recordBudgetSkip, recordLlmCall, recordAlert, recordAction,
  recordLlmFailure, recordLlmSuccess, llmInCooldown, recordSample,
  consumeForceRunQueue, type AssetWatch,
} from '@/lib/brain/state';
import { gateDecide } from '@/lib/brain/engine';
import { selfTune } from '@/lib/brain/selftune';
import { checkCrossAssetTriggers } from '@/lib/brain/triggers';
import { checkNewsTriggers } from '@/lib/brain/news-triggers';
import type { ApiResult, TechnicalIndicators, OrderBook, Ticker } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isDue(job: { cronExpr: string; lastRunAt: Date | null }): boolean {
  const m = job.cronExpr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*/);
  if (m) {
    const every = parseInt(m[1]);
    if (job.lastRunAt) return Date.now() - job.lastRunAt.getTime() > every * 60 * 1000 - 5000;
    return true;
  }
  if (job.cronExpr === '0 * * * *') {
    if (job.lastRunAt) return Date.now() - job.lastRunAt.getTime() > 60 * 60 * 1000 - 5000;
    return true;
  }
  return false;
}

// Tier-1 (triage) prompt — compressed to ~half the tokens of the full prompt.
// Drops the asset name, trims decimals, uses terse key=value pairs. The LLM
// still gets every decision-relevant signal; the prose around it is gone.
function triagePrompt(
  symbol: string, ticker: Ticker, ti: TechnicalIndicators, ob: OrderBook,
  funding: { rate: number } | null,
): string {
  const fr = funding ? (funding.rate * 100).toFixed(3) + '%' : 'n/a';
  const macd = ti.macd.histogram > 0 ? '+' : '-';
  return `${symbol} $${ticker.price.toFixed(2)} ${ticker.changePct.toFixed(1)}% RSI${ti.rsi.toFixed(0)} MACD${macd} trd${ti.trend[0]} ob${(ob.imbalance * 100).toFixed(0)} fr${fr} | JSON {"score":int[-100,100],"rationale":"1 sentence","confidence":int[0,100]}`;
}

// Tier-2 (deep) prompt — the original full-context prompt, for high-
// noteworthiness situations where the extra context earns its tokens.
function deepPrompt(
  symbol: string, name: string, ticker: Ticker, ti: TechnicalIndicators, ob: OrderBook,
  funding: { rate: number } | null,
): string {
  return `Analyze ${symbol} (${name}). Price $${ticker.price}, 24h ${ticker.changePct.toFixed(2)}%. RSI ${ti.rsi.toFixed(0)}, MACD ${ti.macd.histogram.toFixed(2)}, trend ${ti.trend}. Order book imbalance ${(ob.imbalance * 100).toFixed(1)}%. Funding ${funding ? (funding.rate * 100).toFixed(4) + '%' : 'N/A'}. Respond JSON: {"score":<-100..100>,"rationale":"<2 sentences>","confidence":<0..100>}`;
}

// Robust JSON parse — some free providers wrap JSON in prose or code fences,
// and a few ignore "JSON only" instructions. Extract the first {...} block
// and parse that. Returns null on failure (the caller falls back to the
// deterministic consensus, so a parse failure is safe, never fatal).
function safeParseJson(content: string): any | null {
  if (!content) return null;
  // Strip code fences if present.
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  try { return JSON.parse(candidate.trim()); } catch { /* try extraction */ }
  // Extract the first balanced {...} block.
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++;
    else if (candidate[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(candidate.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/** Analyze a single asset through the brain's gate. Returns the result row. */
async function analyzeAsset(
  asset: { id: string; symbol: string; name: string },
  sendAlerts: boolean,
  thresholds: any,
  defaultThreshold: any,
  llmCfg: Awaited<ReturnType<typeof resolveModel>>,
  forceDeep = false, // manual force-run: bypass the gate, always tier 2
  triggerSource: 'manual' | 'news' | 'cross-asset' | 'auto' = 'auto',
): Promise<any> {
  const now = Date.now();
  const config = getConfig();
  const [klines, orderbook, funding, ticker] = await Promise.all([
    getKlines(asset.symbol, '4h', 200),
    getOrderBook(asset.symbol, 50),
    getFundingRate(asset.symbol).catch(() => null),
    getTicker24h(asset.symbol),
  ]);
  const indicators = computeIndicators(klines);

  // 1) FREE deterministic consensus — always computed, the gate's baseline.
  const deterministic = computeConsensus(
    { asset: asset.symbol, timeframe: '4h', price: ticker.price, technical: indicators, orderbook, fundingRate: funding?.rate },
    undefined,
  );

  let llmAnalysis: { score: number; rationale: string; model: string; confidence?: number } | undefined;
  let llmLayer: { layer: string; score: number; confidence: number; detail: string; model: string } | undefined;
  let tier = 0;
  let action = 'watch';
  let reason = 'no-llm';
  let dataSig = '';
  let noteworthiness = 0;
  let regime: 'trending' | 'ranging' | 'volatile' = 'ranging';
  let tokensUsed = 0;
  let attemptedLlm = false; // true if we entered the analyze branch (success or fail)

  const canCallLlm = !!llmCfg && (forceDeep || isRunning());

  if (canCallLlm) {
    const decision = gateDecide({
      indicators, orderbook, fundingRate: funding?.rate, ticker,
      deterministic, watch: getWatch(asset.symbol), config,
      budgetExhausted: budgetExhausted(), now,
    });
    tier = decision.tier;
    action = decision.action;
    reason = decision.reason;
    dataSig = decision.dataSig;
    noteworthiness = decision.noteworthiness;
    regime = decision.regime;

    // Force-run overrides skip/cache AND the tier → always a deep analysis.
    // The operator explicitly asked for it; this bypasses the gate entirely
    // (including the budget guard — manual control means manual control).
    if (forceDeep) {
      action = 'analyze';
      tier = 2;
      reason = 'manual-force-run';
    }

    // Whether we ATTEMPTED an LLM call this tick (success or fail). Used to
    // update the watch cache so the cadence rung backs off after a failed
    // attempt instead of re-hitting the rate limit every scan.
    attemptedLlm = decision.action === 'analyze' || forceDeep;

    // Global LLM circuit-breaker: if a recent call rate-limited (429), skip the
    // LLM entirely for ALL assets until the cooldown expires. This prevents the
    // thundering-herd problem where 11 assets all fire 429'd requests at once.
    // Force-run (manual override) bypasses this — the operator asked for it.
    if (attemptedLlm && llmInCooldown() && !forceDeep) {
      action = 'skip';
      reason = 'llm-cooldown';
      tier = 0;
      attemptedLlm = false;
      recordSkip(decision.estimatedSavedTokens);
      recordBudgetSkip(decision.estimatedSavedTokens);
    } else if (decision.action === 'skip' && !forceDeep) {
      recordSkip(decision.estimatedSavedTokens);
      if (reason === 'budget-exhausted') recordBudgetSkip(decision.estimatedSavedTokens);
    } else if (decision.action === 'cache' && !forceDeep) {
      const w = getWatch(asset.symbol);
      if (w?.lastVerdict) {
        llmAnalysis = w.lastVerdict;
        llmLayer = { layer: 'technical', score: w.lastVerdict.score, confidence: w.lastVerdict.confidence, detail: w.lastVerdict.rationale.slice(0, 120), model: w.lastVerdict.model };
      }
      recordCacheHit(decision.estimatedSavedTokens);
    } else if (decision.action === 'analyze' || forceDeep) {
      // The LLM call — tier 1 compressed, tier 2 full.
      try {
        const prompt = (tier === 1 && !forceDeep)
          ? triagePrompt(asset.symbol, ticker, indicators, orderbook, funding)
          : deepPrompt(asset.symbol, asset.name, ticker, indicators, orderbook, funding);
        const maxTokens = (tier === 1 && !forceDeep) ? 150 : 300;
        const result = await completeWithAutoFallback({
          provider: llmCfg!.providerName, model: llmCfg!.modelId,
          messages: [
            { role: 'system', content: llmCfg!.systemPrompt || SCHEDULER_TICK_SYSTEM },
            { role: 'user', content: prompt },
          ],
          temperature: llmCfg!.temperature, maxTokens,
        });
        // jsonMode is intentionally OFF: Pollinations (the default free LLM)
        // returns empty when response_format is set. The prompt requests JSON
        // explicitly + safeParseJson handles any prose wrapping. This keeps the
        // brain provider-agnostic and resilient.
        const parsed = safeParseJson(result.content);
        if (!parsed || typeof parsed.score !== 'number') throw new Error('LLM returned non-JSON');
        const model = `${result.usedProvider ?? llmCfg!.providerName}/${result.usedModel ?? llmCfg!.modelId}`;
        llmAnalysis = { score: parsed.score, rationale: parsed.rationale, model, confidence: parsed.confidence ?? 70 };
        llmLayer = { layer: 'technical', score: parsed.score, confidence: parsed.confidence ?? 70, detail: parsed.rationale.slice(0, 120), model };
        tokensUsed = (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0) || maxTokens;
        recordLlmCall(tokensUsed);
        recordLlmSuccess(); // clear the consecutive-failure counter
      } catch {
        // Tiered: LLM failure falls back to the deterministic consensus. The
        // signal is still saved — just without the LLM layer this tick. The
        // global cooldown is tripped so sibling assets in this scan skip the
        // LLM instead of all hitting the rate limit together.
        recordLlmFailure();
        action = 'skip';
        reason = 'llm-failed-fallback';
        tier = 0;
      }
    }
  } else if (!isRunning() && !forceDeep) {
    action = 'paused';
    reason = 'brain-paused';
  }

  // 2) Final consensus — with whatever LLM input we have (or none).
  const consensus = computeConsensus(
    { asset: asset.symbol, timeframe: '4h', price: ticker.price, technical: indicators, orderbook, fundingRate: funding?.rate, llmAnalysis },
    llmLayer,
  );

  // 3) Update the per-asset watch cache. The verdict + data signature are
  //    only refreshed when we actually called the LLM (so cache hits stay
  //    valid until a real new analysis happens).
  const prevWatch = getWatch(asset.symbol);
  const analyzedThisTick = attemptedLlm;
  const newWatch: AssetWatch = {
    symbol: asset.symbol,
    lastPrice: ticker.price,
    lastAnalyzedAt: analyzedThisTick ? now : (prevWatch?.lastAnalyzedAt ?? 0),
    lastWatchedAt: now,
    lastDataSig: analyzedThisTick ? dataSig : (prevWatch?.lastDataSig ?? ''),
    lastVerdict: analyzedThisTick && llmAnalysis
      ? { score: llmAnalysis.score, rationale: llmAnalysis.rationale, confidence: llmAnalysis.confidence ?? 70, model: llmAnalysis.model, direction: consensus.direction, conviction: consensus.conviction }
      : prevWatch?.lastVerdict,
    lastNoteworthiness: noteworthiness || prevWatch?.lastNoteworthiness || 0,
    lastRegime: regime || prevWatch?.lastRegime || 'ranging',
    lastTier: tier,
    lastAction: action,
    lastReason: reason,
    updatedAt: now,
  };
  setWatch(newWatch);

  // 4) Save the signal. Deterministic-only signals are valid signals too —
  //    the conviction reflects which layers contributed.
  const created = await db.signal.create({
    data: {
      assetId: asset.id,
      direction: consensus.direction,
      conviction: consensus.conviction,
      timeframe: '4h',
      layersSummary: JSON.stringify(consensus.layers),
      modelsUsed: JSON.stringify(consensus.modelsUsed),
      entryPrice: consensus.entryPrice,
      stopLoss: consensus.stopLoss,
      takeProfit: consensus.takeProfit,
      // Stamp the trigger source as a machine-readable prefix on the rationale
      // so the signals feed can show a "triggered by" badge without a schema
      // migration. Auto-scans have no prefix (the common case).
      rationale: triggerSource !== 'auto' ? `[trigger:${triggerSource}] ${consensus.rationale}` : consensus.rationale,
      status: 'open',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // 5) Alert if conviction clears the threshold. The brain never suppresses
  //    a qualifying alert — that's a safety path, not a token path.
  let alerted = false;
  if (sendAlerts) {
    const assetThreshold = (thresholds as any)[asset.symbol] ?? defaultThreshold;
    if (shouldAlert(consensus, assetThreshold)) {
      alerted = await sendSignalAlert(consensus);
      if (alerted) recordAlert();
    }
  }

  recordAction({
    symbol: asset.symbol, action, tier, reason,
    tokens: analyzedThisTick ? tokensUsed : undefined,
    conviction: consensus.conviction, direction: consensus.direction,
  });

  return { symbol: asset.symbol, direction: consensus.direction, conviction: consensus.conviction, alerted, signalId: created.id, action, tier, reason, noteworthiness, regime };
}

/** Autonomous gated scan of all active crypto assets (only when running). */
async function runCryptoScan(sendAlerts: boolean) {
  await hydrate();
  if (!isRunning()) {
    // Brain paused — skip autonomous analysis. Force-run is handled separately.
    return [];
  }
  const assets = await db.asset.findMany({ where: { assetClass: 'crypto', isActive: true } });
  const thresholds = await getSetting(SETTING_KEYS.alertThresholds, {});
  const defaultThreshold = await getSetting(SETTING_KEYS.defaultThreshold, { minConviction: 60, directions: ['long', 'short'] });
  const llmCfg = await resolveModel('crypto_technical', 'deep_reasoning');
  const results: any[] = [];
  for (const asset of assets) {
    try {
      results.push(await analyzeAsset(asset, sendAlerts, thresholds, defaultThreshold, llmCfg));
    } catch (e: any) {
      results.push({ symbol: asset.symbol, error: e.message });
    }
  }
  return results;
}

/** Manual override — deep-analyze the force-run queue, even when paused.
 *  Carries the trigger source (manual/news/cross-asset) so the resulting
 *  signal can be stamped with WHY it was analyzed. */
async function runForcedAnalysis(sendAlerts: boolean) {
  const queue = consumeForceRunQueue();
  if (queue.length === 0) return [];
  const assets = await db.asset.findMany({ where: { symbol: { in: queue.map((q) => q.symbol) }, isActive: true } });
  if (assets.length === 0) return [];
  const thresholds = await getSetting(SETTING_KEYS.alertThresholds, {});
  const defaultThreshold = await getSetting(SETTING_KEYS.defaultThreshold, { minConviction: 60, directions: ['long', 'short'] });
  const llmCfg = await resolveModel('crypto_technical', 'deep_reasoning');
  const results: any[] = [];
  for (const asset of assets) {
    const source = queue.find((q) => q.symbol === asset.symbol)?.source ?? 'manual';
    try {
      results.push(await analyzeAsset(asset, sendAlerts, thresholds, defaultThreshold, llmCfg, true, source));
    } catch (e: any) {
      results.push({ symbol: asset.symbol, error: e.message });
    }
  }
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const forceModule = req.nextUrl.searchParams.get('module');
    const sendAlerts = req.nextUrl.searchParams.get('alerts') === '1';
    await setSetting(SETTING_KEYS.lastSchedulerTick, new Date().toISOString());

    // Hydrate the brain's persisted control flags + mark a tick started.
    await hydrate();
    tickStarted();

    // Self-learning loop: grade expired open signals BEFORE running new scans.
    let gradingSummary: { graded: number; skipped: number } | null = null;
    try {
      gradingSummary = await gradeExpiredSignals();
    } catch { /* best-effort — never block the tick */ }

    // Price-alert threshold check — safety path, always runs.
    let priceAlertSummary: { checked: number; triggered: number } | null = null;
    try {
      priceAlertSummary = await checkPriceAlerts();
    } catch { /* best-effort */ }

    // Manual override: deep-analyze any force-run'd symbols every tick, even
    // when the autonomous brain is paused. This is the manual control path.
    let forcedSummary: any[] = [];
    try {
      forcedSummary = await runForcedAnalysis(sendAlerts);
    } catch { /* best-effort */ }

    // News-event triggers — run on EVERY tick (60s) for sub-minute breaking-news
    // response. The 5-min RSS cache (in news-triggers) keeps this free-tier-safe.
    // This is the only trigger that fires on external events rather than price
    // action, so it mustn't wait for the 15-min scan cadence.
    let newsTriggerSummary: { triggered: number; queued: number; headlines: number } | null = null;
    try {
      if (isRunning()) {
        const nt = await checkNewsTriggers();
        if (nt.triggered) {
          newsTriggerSummary = { triggered: 1, queued: nt.queuedAssets.length, headlines: nt.matchedHeadlines.length };
        }
      }
    } catch { /* best-effort — news never blocks the tick */ }

    const jobs = await db.scheduleJob.findMany({ where: { enabled: true } });
    const due = jobs.filter((j) => forceModule ? j.moduleKey === forceModule : isDue(j));
    if (due.length === 0) {
      recordSample(); // keep the timeline continuous even on no-op ticks
      tickEnded();
      return NextResponse.json<ApiResult<{ ran: any[]; skipped: true; grading: typeof gradingSummary; priceAlerts: typeof priceAlertSummary; forced: typeof forcedSummary }>>({ success: true, data: { ran: [], skipped: true, grading: gradingSummary, priceAlerts: priceAlertSummary, forced: forcedSummary } });
    }

    const ran: any[] = [];
    for (const job of due) {
      try {
        let result: any;
        if (job.moduleKey === 'crypto_technical') {
          result = { module: job.moduleKey, assets: await runCryptoScan(sendAlerts) };
        } else {
          result = { module: job.moduleKey, note: 'module not yet implemented in tick' };
        }
        await db.scheduleJob.update({
          where: { id: job.id },
          data: { lastRunAt: new Date(), lastStatus: 'success', lastError: null },
        });
        ran.push(result);
      } catch (e: any) {
        await db.scheduleJob.update({
          where: { id: job.id },
          data: { lastRunAt: new Date(), lastStatus: 'error', lastError: e.message.slice(0, 500) },
        });
        ran.push({ module: job.moduleKey, error: e.message });
      }
    }

    // Cross-asset triggers: after a scan, if an anchor (BTC/ETH) is volatile
    // or high-noteworthiness, queue correlated alts for re-analysis next tick.
    // Free + deterministic — zero tokens spent on detection.
    let triggerSummary: { triggered: number; queued: number; details: any[] } | null = null;
    try {
      if (isRunning()) {
        const triggers = checkCrossAssetTriggers();
        if (triggers.length > 0) {
          triggerSummary = { triggered: triggers.length, queued: triggers.reduce((s, t) => s + t.queued.length, 0), details: triggers };
        }
      }
    } catch { /* best-effort */ }

    // (News-event triggers already ran above, on every tick, for sub-minute
    // breaking-news response. No duplicate call here.)

    // Self-tuning: read recent graded signals and nudge gate thresholds toward
    // better calibration. Conservative (needs ≥12 grades, max ±2 nudge, bounded).
    let tuneSummary: any = null;
    try {
      tuneSummary = await selfTune();
    } catch { /* best-effort — tuning never blocks the tick */ }

    // Best-effort Supabase sync.
    let syncSummary: { totalSynced: number; totalErrors: number } | null = null;
    try {
      const { syncToSupabase } = await import('@/lib/supabase/sync');
      const syncResult = await syncToSupabase();
      syncSummary = { totalSynced: syncResult.totalSynced, totalErrors: syncResult.totalErrors };
      console.log(`[supabase-sync] Auto-synced ${syncResult.totalSynced} rows in ${syncResult.durationMs}ms`);
    } catch { /* non-fatal */ }

    // Record a token-economy timeline sample so the savings sparkline stays fresh.
    recordSample();
    tickEnded();

    return NextResponse.json<ApiResult<{ ran: typeof ran; skipped: false; grading: typeof gradingSummary; priceAlerts: typeof priceAlertSummary; sync: typeof syncSummary; forced: typeof forcedSummary; triggers: typeof triggerSummary; newsTriggers: typeof newsTriggerSummary; tune: typeof tuneSummary }>>({ success: true, data: { ran, skipped: false, grading: gradingSummary, priceAlerts: priceAlertSummary, sync: syncSummary, forced: forcedSummary, triggers: triggerSummary, newsTriggers: newsTriggerSummary, tune: tuneSummary } });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const jobs = await db.scheduleJob.findMany({ orderBy: { moduleKey: 'asc' } });
  const lastTick = await getSetting(SETTING_KEYS.lastSchedulerTick, null);
  return NextResponse.json<ApiResult<{ jobs: typeof jobs; lastTick: any }>>({ success: true, data: { jobs, lastTick } });
}
