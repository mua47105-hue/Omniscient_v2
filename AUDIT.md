# AUDIT.md — OMNISCIENT_v2 Phase 0 Ground Truth

**Auditor:** audit-agent · **Task ID:** `audit` · **Date:** 2026-06-21
**Scope:** Read-only ground-truth audit of `/home/z/my-project` (OMNISCIENT_v2).
No files were modified.

---

## 1. Full Module Map

> Convention for "What calls it / What it calls": only direct import edges within `src/` and `mini-services/` are listed. External APIs (third-party HTTP) are listed separately per module.

### 1.1 `src/lib/brain/` — Lazy Brain gate / state / triggers

#### `state.ts`
- **What it does:** Singleton brain state on `globalThis` (control flags, per-asset watch, stats, sparkline ring buffer, tune-event log, LLM circuit-breaker, force-run queue). Hydrates `running`/`mode`/`config` from the Setting KV table on first touch. Hot-reload-safe migration guards.
- **What calls it:** `engine.ts`, `selftune.ts`, `triggers.ts`, `news-triggers.ts` (all in same dir); `src/app/api/scheduler/tick/route.ts`, `src/app/api/brain/route.ts`.
- **What it calls:** `./types` (types only), `./config` (`defaultBrainConfig`), `@/lib/db` (lazy `import()` inside `hydrate`/`persist`).
- **External APIs:** none directly.
- **Notes:** Exposes `__resetForTests()` (only caller would be tests — none exist).

#### `engine.ts` (pure-logic gate)
- **What it does:** Pure-logic brain core. `classifyRegime()` (trending/ranging/volatile from ATR% + EMA separation + RSI), `computeNoteworthiness()` (7-signal 0..100 score), `dataSignature()` (coarse market fingerprint for cache gate), `gateDecide()` (the "ponytail ladder": budget → force-run → YAGNI unanimous → cache → cadence → LLM), `layerAgreement()`, `watchFromDecision()`.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`gateDecide`).
- **What it calls:** `./state` (`budgetExhausted`, `getConfig`, `getWatch`, `recordBudgetSkip`, `recordCacheHit`, `recordSkip`); `./types`; `@/lib/types`.
- **External APIs:** none.
- **Notes:** `watchFromDecision` is exported but has **zero callers** — dead code.

#### `selftune.ts`
- **What it does:** Self-tuning loop. Pulls the 40 most-recent graded `SignalOutcome` rows, splits by conviction band (high ≥60, low <40), nudges `unanimousConviction` (bounds [55,85]) and `minNoteworthiness` (bounds [20,55]) by ±2 when win-rate crosses 0.6/0.8 (high) or 0.5/0.3 (low). Auto-mode only.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`selfTune`).
- **What it calls:** `@/lib/db` (`db.signalOutcome.findMany`), `./state` (`getMode`, `getConfig`, `setConfig`, `recordTuneEvent`), `./config` (`clamp`).
- **External APIs:** none.

#### `triggers.ts` (cross-asset)
- **What it does:** Cross-asset trigger. If BTC or ETH watch entry is `volatile` regime or has `lastNoteworthiness ≥ cfg.highNoteworthiness`, queue its follower set via `forceRun(symbol,'cross-asset')`. Storm-guard skips followers analyzed <2 min ago.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`checkCrossAssetTriggers`).
- **What it calls:** `./state` (`allWatch`, `forceRun`, `recordTrigger`, `getConfig`).
- **External APIs:** none.
- **Notes:** `LEADERS = ['BTCUSDT','ETHUSDT']` and the `FOLLOWERS` map are **hardcoded** (10 alt-coins per leader).

#### `news-triggers.ts`
- **What it does:** Every-tick scan of three crypto RSS feeds (CoinDesk, Cointelegraph, Decrypt) via `node:https`. Keyword lexicon (weight × polarity) flags high-impact headlines (`weight ≥ 2` triggers force-run). 5-min cache + 500-entry dedup ring buffer. Tagged assets force-queued with source `'news'`.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`checkNewsTriggers`).
- **What it calls:** `./state` (`forceRun`, `recordTrigger`); `node:https`.
- **External APIs:** `coindesk.com/arc/outboundfeeds/rss/`, `cointelegraph.com/rss`, `decrypt.co/feed`.

#### `config.ts`
- **What it does:** `defaultBrainConfig()` factory (single source of truth for thresholds) + `clamp()` helper.
- **What calls it:** `state.ts`, `selftune.ts`, `src/app/api/brain/route.ts` (via state re-exports).
- **What it calls:** `./types`.

#### `types.ts`
- **What it does:** Type-only module: `BrainMode`, `BrainConfig`, `AssetWatch`, `BrainStats`, `StatsSample`, `TuneEvent`, `BrainAction`, `TriggerSource`. Kept separate so pure-logic modules don't pull the `globalThis` singleton.
- **What calls it:** every other brain module + the brain API + tick route.

### 1.2 `src/lib/llm/`

#### `router.ts`
- **What it does:** Multi-provider LLM router. Per-key cooldown on 429 (60s). `complete()` resolves provider+model from `preferProvider` or `ModuleModelConfig`, then dispatches to `callOpenAICompatible` or `callGeminiNative`. `completeWithAutoFallback()` walks providers in reliability order `[pollinations, groq, nvidia, mistral, openrouter, gemini]`. Uses `node:https` (not `fetch`) to bypass Next.js fetch patching + Cloudflare bot detection.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`completeWithAutoFallback`, `resolveModel`), `src/app/api/news/analyze/route.ts` (`completeWithAutoFallback`).
- **What it calls:** `@/lib/db` (`db.llmProvider`, `db.moduleModelConfig`); `@/lib/types`; `node:https`; `node:url`.
- **External APIs:** any LLM provider configured in `LlmProvider` table (default list: Pollinations, Gemini, Groq, NVIDIA, Mistral, OpenRouter — and any OpenAI-compatible endpoint).

#### `prompts.ts`
- **What it does:** Five system-prompt constants (`CRYPTO_TECHNICAL_SYSTEM`, `MARKETS_ANALYSIS_SYSTEM`, `NEWS_SENTIMENT_SYSTEM`, `SCHEDULER_TICK_SYSTEM`, `MACRO_ANALYSIS_SYSTEM`) and a `SYSTEM_PROMPTS_BY_MODULE` lookup.
- **What calls it:** `CRYPTO_TECHNICAL_SYSTEM` → tick route; `NEWS_SENTIMENT_SYSTEM` → news/analyze route.
- **What it calls:** none.
- **Notes:** `MARKETS_ANALYSIS_SYSTEM`, `SCHEDULER_TICK_SYSTEM`, `MACRO_ANALYSIS_SYSTEM`, and the `SYSTEM_PROMPTS_BY_MODULE` lookup are **exported but have zero importers** — dead code.

### 1.3 `src/lib/analysis/`

#### `consensus.ts`
- **What it does:** 7-layer weighted consensus fusion. `LAYER_WEIGHTS` sums to 1.0 (technical 0.25, orderbook 0.15, onchain 0.10, sentiment 0.20, macro 0.10, fundamental 0.10, intermarket 0.10). `buildTechnicalLayer`, `buildOrderbookLayer`, `buildSentimentLayer`, `buildOnchainLayer` (BTC-only, ≥3 hashrate samples). `computeConsensus` = confidence-weighted sum × 0.5+0.5·conf. `shouldAlert` threshold check.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`computeConsensus`, `buildTechnicalLayer`, `buildOrderbookLayer`, `buildOnchainLayer`, `shouldAlert`).
- **What it calls:** `@/lib/types`.
- **Notes:** `entryPrice` calculation is `input.technical?.rationale ? undefined : undefined` — **always undefined**, dead/buggy line. Magic `8` direction threshold, `1.5` conviction divisor, sentiment multipliers `2/1.5/1`, `5`-article cap.

#### `cointegration.ts`
- **What it does:** E3 Engle-Granger cointegration (own OLS + ADF + half-life, no deps). MacKinnon (1996) criticals. `engleGranger()` end-to-end, `computeCointegrationMatrix()` pairwise. Outputs `{hedgeRatio, adfStat, pValue, isCointegrated, halfLife, zScore, tradeable, signal}`.
- **What calls it:** `src/app/api/analysis/cointegration/route.ts` (`computeCointegrationMatrix`).
- **What it calls:** none (pure TS).
- **External APIs:** none.

#### `triple-barrier.ts`
- **What it does:** E9 López de Prado triple-barrier labeling. Defaults: `slMult=1.5`, `tpMult=3.0`, `holdingPeriod=24` (hourly bars), `direction='long'`. Conservative stop-loss-first ordering. Returns `{label, exitBar, exitPrice, exitReason, returnPct, returnR, barsHeld}`.
- **What calls it:** **none in production code**. Per its own header comment: "BUILT + tested, NOT yet wired into grading.ts."
- **What it calls:** `@/lib/types`.
- **Notes:** Dead code in the production hot path. Intended to replace grading.ts's fixed-24h evaluate.

#### `deflated-sharpe.ts`
- **What it does:** E9 Deflated Sharpe Ratio (Bailey-LdP 2014). Own Abramowitz-Stegun normalCDF + Acklam inverse-normal CDF + moments() + `deflatedSharpeRatio()` with multiple-testing + skew/kurt adjustments. Verdict buckets: ≥0.95 genuine, ≥0.80 likely, ≥0.50 inconclusive, <0.50 noise.
- **What calls it:** **none in production code** — dead code.
- **What it calls:** none (pure TS).

#### `hurst.ts`
- **What it does:** E10 Hurst exponent via DFA (Detrended Fluctuation Analysis). `hurstExponent()` returns H + R². `classifyRegime()` (different from brain/engine's `classifyRegime`!) buckets H<0.45 → MEAN_REVERTING, H>0.55 → TRENDING.
- **What calls it:** **none in production code** — dead code.
- **What it calls:** none (pure TS).
- **Notes:** The header recommends using `classifyRegime()` as a cointegration filter — never wired in.

#### `fear-greed-edge.ts`
- **What it does:** E8 Asymmetric Fear & Greed edge. Reuses `getFearGreed()` upstream. Constants: EXTREME_GREED=75, EXTREME_FEAR=25, GREED_STREAK_MOMENTUM=14d, FEAR_STREAK_MEANREVERT=5d, FEAR_STREAK_STRONG=14d, HISTORY_LIMIT=180. Returns `MOMENTUM_LONG | MEAN_REVERT_LONG | MEAN_REVERT_SHORT | NONE`.
- **What calls it:** `src/app/api/analysis/fear-greed-edge/route.ts` (`computeFearGreedSignal`).
- **What it calls:** `@/lib/market/macro` (`getFearGreed`).

#### `grading.ts`
- **What it does:** Self-learning grading loop. Finds `Signal` rows where `status='open'` AND `expiresAt < now`. Fetches current price (Binance for crypto, Yahoo for everything else). Evaluates grade (correct/wrong/partial) per direction; creates `SignalOutcome` row, marks signal closed.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`gradeExpiredSignals`).
- **What it calls:** `@/lib/db`, `@/lib/market/binance` (`getTicker24h`), `@/lib/market/macro` (`getMacroQuote`).
- **Notes:** Uses **fixed 4h horizon** (`expiresAt` set in tick route). Magic `2%` neutral threshold. Not wired to triple-barrier.

#### `correlation.ts`
- **What it does:** Pure-TS Pearson correlation, daily log-returns, linear regression, N×N correlation matrix.
- **What calls it:** `src/app/api/correlation/returns/route.ts` (`dailyReturns`), `src/components/correlation/CorrelationMatrixClient.tsx` (`computeCorrelationMatrix`, `pearsonCorrelation`, `dailyReturns`).
- **What it calls:** none.

#### `price-alerts.ts`
- **What it does:** Checks active `PriceAlert` rows against current price. Conditions: above/below/crosses_up/crosses_down (the cross-* are simplified to above/below). Updates row status on match.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`checkPriceAlerts`), `src/app/api/price-alerts/check/route.ts`.
- **What it calls:** `@/lib/db`, `@/lib/market/binance` (`getTicker24h`), `@/lib/market/macro` (`getMacroQuote`).

### 1.4 `src/lib/risk/`

#### `vol_targeting.ts`
- **What it does:** E1 Moreira-Muir vol-targeted position sizing. Defaults: `targetVolPct=0.6` (60% pa), `lookback=30` bars, `minVolFloor=0.15`, `maxNotionalPct=1.0` (no leverage), `barsPerYear=365`, `fallbackSizePct=0.02`, `minBars=10`. `volTargetSize(equity, klines, config?)`.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`volTargetSize` — called with **hardcoded equity of $10,000**).
- **What it calls:** `@/lib/types`.

### 1.5 `src/lib/market/`

#### `binance.ts`
- **What it does:** Binance USD-M futures REST + WS client. Tickers (24h, batch + per-symbol fallback on 418), klines, order book, funding rate, open interest, top movers, `subscribeTicker` WS. Caches: ticker 10s, klines 30s, orderbook 5s, funding 10s.
- **What calls it:** tick route, screener/scan, multi-timeframe, crypto/* routes, derivatives-v2 route, grading.ts, price-alerts.ts.
- **What it calls:** `@/lib/types`; `WebSocket` global; `fetch`.
- **External APIs:** `fapi.binance.com`, `api.binance.com`, `wss://stream.binance.com:9443/ws`.

#### `macro.ts`
- **What it does:** Yahoo Finance chart fetcher + alternative.me Fear&Greed + CoinGecko global + er-api forex fallback. 5-min cache. Uses `node:https` with browser-spoofing UA. Exports `ok()` / `err()` envelope helpers.
- **What calls it:** macro/* routes, markets/heatmap, markets/quotes, fear-greed-edge.ts, grading.ts, price-alerts.ts.
- **What it calls:** `@/lib/types`; `node:https`.
- **External APIs:** `query1.finance.yahoo.com/v8/finance/chart/*`, `api.alternative.me/fng/`, `api.coingecko.com/api/v3/global`, `open.er-api.com/v6/latest/*`.
- **Notes:** `getForexRate()` is exported but has **zero callers** — dead code.

#### `deribit.ts`
- **What it does:** E4 Derivatives-v2 (basis term structure + 25Δ risk reversal + VRP + DVOL + regime). Combines Deribit's public options/book-summary API with Binance COIN-M quarterly futures. Regime: CAPITULATION (basis<-5 & RR<-6 & DVOL≥90), EUPHORIA (basis>15 & RR>4 & DVOL<50), else NEUTRAL. 8-hour cache.
- **What calls it:** `src/app/api/analysis/derivatives-v2/route.ts` (`computeDerivativesV2`).
- **What it calls:** `@/lib/types`; `node:https`.
- **External APIs:** `deribit.com/api/v2/public/get_book_summary_by_currency`, `…/get_index_price` (×2: spot + DVOL), `dapi.binance.com/dapi/v1/ticker/price`.
- **Notes:** 25Δ is a **moneyness proxy** (call strike ≈ spot × 1.10, put strike ≈ spot × 0.90), not a true delta.

#### `onchain.ts`
- **What it does:** blockchain.info client. Pulls `/q/24hrtransactioncount`, `/q/hashrate`, `/q/getdifficulty`. Maintains 24-sample hashrate ring buffer (survives cache eviction via `globalThis`). 15-min cache. `getOnchainTrend()` returns rising/falling/flat with ±2% threshold.
- **What calls it:** `src/app/api/onchain/stats/route.ts`, `src/app/api/scheduler/tick/route.ts` (`getOnChainStats`, `getHashrateHistory`).
- **What it calls:** `node:https`.
- **External APIs:** `blockchain.info/q/*`.
- **Notes:** Only BTC hashrate — consensus onchain layer is BTC-only by design.

#### `coingecko.ts`
- **What it does:** CoinGecko free public API client — `getTrending()` + `getTopMarkets(limit)`. 5-min cache. `node:https`.
- **What calls it:** `src/app/api/crypto/trending/route.ts`.
- **What it calls:** `node:https`.
- **External APIs:** `api.coingecko.com/api/v3/search/trending`, `…/coins/markets`.

#### `reddit.ts`
- **What it does:** Reddit sentiment via word-count lexicon (BULL_WORDS 25, BEAR_WORDS 26). 15-min cache per subreddit. Degrades gracefully on 403 (datacenter IP). `getCryptoSocialSentiment()` aggregates r/CryptoCurrency, r/Bitcoin, r/ethereum.
- **What calls it:** `src/app/api/sentiment/reddit/route.ts`.
- **What it calls:** `node:https`.
- **External APIs:** `reddit.com/r/{sub}/hot.json?limit=50`.

#### `devactivity.ts`
- **What it does:** GitHub commit-count client (no API key). 30-min cache. Tracks 7-day vs prior-7-day commit counts for 5 repos (bitcoin/bitcoin, ethereum/go-ethereum, solana-labs/solana, chainlink/chainlink, IntersectMBO/cardano-node).
- **What calls it:** `src/app/api/devactivity/route.ts`.
- **What it calls:** `node:https`.
- **External APIs:** `api.github.com/repos/{repo}`, `…/repos/{repo}/commits`.

#### `indicators.ts`
- **What it does:** Pure-TS technical indicators (no deps). sma, ema, emaSeries, rsi (Wilder), macd(12,26,9), bollinger(20,2), vwap, atr(14, Wilder), findLevels (local extrema), `computeIndicators(klines)` → 5-vote summary score in [-100,100].
- **What calls it:** tick route, screener/scan, multi-timeframe, markets/scan, crypto/* routes.
- **What it calls:** `@/lib/types`.

### 1.6 `src/lib/config/`

#### `settings.ts`
- **What it does:** KV-table wrapper over `Setting`. JSON-parses values that look like JSON. Exports `SETTING_KEYS` constant object.
- **What calls it:** 14 API routes + `state.ts` (via `hydrate` lazy import) + `alerts/telegram.ts`.
- **What it calls:** `@/lib/db`.

### 1.7 `src/lib/alerts/`

#### `telegram.ts`
- **What it does:** Telegram sendMessage via `fetch`. Reads `telegram.bot_token` + `telegram.chat_id` from Setting KV. Skips neutral signals.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (`sendSignalAlert`), `src/app/api/telegram/test/route.ts`.
- **What it calls:** `@/lib/config/settings`, `@/lib/types`.
- **External APIs:** `api.telegram.org/bot{token}/sendMessage`.

### 1.8 `src/lib/supabase/`

#### `sync.ts`
- **What it does:** Stub. `syncToSupabase()` returns `null`. The tick route calls it via dynamic import inside try/catch.
- **What calls it:** `src/app/api/scheduler/tick/route.ts` (dynamic `import('@/lib/supabase/sync')`).
- **What it calls:** none.

### 1.9 `src/lib/db.ts`
- **What it does:** Prisma singleton with schema-hash cache-busting + hot-reload-safe delegate check (`priceAlert`, `portfolioHolding` must exist or client is recreated). Uses `createRequire` to bypass Turbopack ESM loader.
- **What calls it:** ~25 lib modules + ~30 API routes.
- **What it calls:** `node:module`, `node:fs`, `node:crypto`, `node:path`, `@prisma/client`.

### 1.10 `src/lib/types.ts`
- **What it does:** Shared TS types (`AssetClass`, `Direction`, `AnalysisLayer`, `ModuleKey`, `Ticker`, `Kline`, `OrderBook`, `FundingRate`, `OpenInterest`, `TechnicalIndicators`, `LayerScore`, `ConsensusInput`, `ConsensusResult`, `LlmMessage`, `LlmCompletionRequest`/`Response`, `NewsArticle`, `ApiResult`).
- **What calls it:** almost every lib + API module.

### 1.11 `src/lib/utils.ts`
- **What it does:** `cn()` Tailwind-merge helper.
- **What calls it:** ~40 components.

### 1.12 `src/app/api/scheduler/tick/route.ts` (THE TICK)
- **What it does:** Main scheduler loop. GET returns `ScheduleJob[]` + last tick. POST runs the 12-step pipeline: hydrate → tickStarted → gradeExpiredSignals → checkPriceAlerts → runForcedAnalysis (drains queue even when paused) → checkNewsTriggers (+ re-drain if triggered) → findDueJobs → for each `crypto_technical` job: runCryptoScan → checkCrossAssetTriggers (+ re-drain) → selfTune → supabase sync → recordSample → tickEnded. `analyzeAsset()` is the per-asset pipeline: parallel market-data fetch → computeIndicators → onchain trend → deterministic consensus → gateDecide → (if eligible) LLM triage/deep prompt → safeParseJson → final consensus → setWatch → volTargetSize → db.signal.create → shouldAlert → recordAction.
- **What calls it:** `mini-services/scheduler/index.ts` (POST every 60s); `src/app/scheduler/page.tsx` (if any) or `src/components/brain/*` indirectly.
- **What it calls:** brain/* (5 modules), analysis/{consensus,grading,price-alerts}, risk/vol_targeting, market/{binance,onchain}, llm/{router,prompts}, alerts/telegram, config/settings, db.
- **External APIs:** none directly (all upstream calls go through lib modules).

### 1.13 `src/app/api/brain/route.ts`
- **What it does:** Brain control API. GET → `snapshot()`. POST → `{action: pause|resume|setMode|setConfig|forceRun|resetBudget, ...}`. `forceRun` enqueues symbol with source `'manual'` + records trigger.
- **What calls it:** `BrainPanel.tsx`, `FooterBrainIndicator.tsx` (both via `fetch('/api/brain')`).
- **What it calls:** `@/lib/brain/state`.

### 1.14 Other notable API routes (brief)

| Route | Lib imports | External |
|-------|-------------|----------|
| `/api/analysis/derivatives-v2` | binance, deribit | Binance, Deribit |
| `/api/analysis/cointegration` | binance, analysis/cointegration | Binance |
| `/api/analysis/fear-greed-edge` | analysis/fear-greed-edge → market/macro | alternative.me |
| `/api/macro/global` | market/macro | CoinGecko |
| `/api/macro/fear-greed` | market/macro | alternative.me |
| `/api/macro/quotes` | market/macro | Yahoo, alternative.me |
| `/api/portfolio` | db | — |
| `/api/settings` | config/settings, db | — |
| `/api/reports` | db | — |
| `/api/news` | db | — |
| `/api/news/analyze` | llm/router, llm/prompts, db | LLM providers |
| `/api/ipo-ico` | db | — |
| `/api/auth/login` `/api/auth/logout` | config/settings | — |
| `/api/setup` | db, config/settings | — |
| `/api/price-alerts` (POST/GET/DELETE) | db | — |
| `/api/price-alerts/check` | analysis/price-alerts | (re-uses lib) |
| `/api/onchain/stats` | market/onchain | blockchain.info |
| `/api/signals` | db | — |
| `/api/multi-timeframe` | db, binance, indicators | Binance |
| `/api/watchlists` | db | — |
| `/api/economic-calendar` | (own https) | external calendar |
| `/api/llm/providers` `/models` `/module-configs` | db | — |
| `/api/derivatives/funding-all` | binance | Binance |
| `/api/crypto/prices` `/trending` `/klines` `/orderbook` `/scan` `/movers` | binance / db | Binance, CoinGecko |
| `/api/screener/scan` | db, binance, indicators | Binance |
| `/api/devactivity` | market/devactivity | GitHub |
| `/api/notifications` | db | — |
| `/api/sentiment/reddit` | market/reddit | Reddit |
| `/api/markets/heatmap` `/quotes` `/scan` | db, macro, binance, indicators | Yahoo, Binance |
| `/api/analytics/models` | db | — |
| `/api/correlation/returns` | analysis/correlation, binance | Binance |
| `/api/telegram/test` | alerts/telegram | Telegram |

### 1.15 `prisma/schema.prisma` — all models

Datasource: **SQLite** (`file:/home/z/my-project/db/custom.db`).

| Model | Purpose | Notable fields / relations |
|-------|---------|----------------------------|
| `LlmProvider` | LLM provider row | `name @unique`, `baseUrl`, `apiKey` (newline-separated), `isActive`. Has many `LlmModel`, `ModuleModelConfig`. |
| `LlmModel` | Model definition | `@@unique([providerId, modelId])`, `contextWindow`, `freeTierRpm`, `capabilities`. |
| `ModuleModelConfig` | (moduleKey, layer) → model binding | `@@unique([moduleKey, layer])`, `temperature`, `systemPrompt`, `enabled`. |
| `Asset` | Tradeable universe | `symbol @unique`, `assetClass`, `isActive`. Has many `Signal`, `DataSnapshot`. |
| `Watchlist` | Named watchlist | `symbols` JSON string. |
| `DataSnapshot` | Per-tick per-layer raw snapshot | `layer`, `source`, `payload` JSON string. |
| `Signal` | Output of `analyzeAsset` | `direction`, `conviction`, `timeframe` (default 4h), `layersSummary` JSON, `modelsUsed` JSON, `entryPrice/stopLoss/takeProfit`, `status` (open/closed), `expiresAt`. Has many `SignalOutcome`, `Alert`. |
| `SignalOutcome` | Grading result | `horizon`, `expected`, `actual`, `pnlPct`, `grade` (correct/wrong/partial), `gradedAt`. |
| `Alert` | Channel delivery log | `channel`, `status`, `payload` JSON, `sentAt`. |
| `PriceAlert` | User price-trigger alert | `assetSymbol`, `condition`, `targetPrice`, `currentPrice`, `status` (active/triggered), `triggeredAt`. Indexed on `[assetSymbol]` + `[status]`. |
| `NewsItem` | News article + sentiment | `source`, `title`, `body`, `publishedAt`, `sentiment`, `impact`, `assetsTagged` JSON, `analyzed`. Indexed on `[publishedAt]` + `[source]`. |
| `IpoIcoItem` | IPO/ICO calendar entry | `type`, `name`, `symbol`, `date`, `details` JSON, `analysis`. |
| `Report` | Generated report | `type`, `period`, `title`, `contentMd`. `@@unique([type, period])`. |
| `PortfolioHolding` | User portfolio row | `assetSymbol`, `quantity`, `entryPrice`, `entryDate`, `notes`. Indexed on `[assetSymbol]`. |
| `ScheduleJob` | Cron-driven job definition | `moduleKey @unique`, `cronExpr`, `enabled`, `lastRunAt`, `nextRunAt` (unused), `lastStatus`, `lastError`. |
| `Setting` | Generic KV store | `key @unique`, `value` TEXT. |

### 1.16 `mini-services/scheduler/`

#### `index.ts`
- **What it does:** Bun runtime HTTP server on port 3042. Polls `${APP_URL}/api/scheduler/tick` (POST) every `POLL_INTERVAL` seconds (default 60). Exposes `/health` (status JSON) and `/trigger` (manual fire). Tracks `ticksTotal/ok/err` + `lastTickAt/lastError`.
- **What calls it:** nothing — it's the entry point (cron replacement).
- **What it calls:** `fetch` to `${APP_URL}/api/scheduler/tick`.
- **External APIs:** the Next.js app itself.
- **Notes:** `package.json` has `"dependencies": {}` and no devDependencies. Uses Bun globals (`Bun.serve`) — currently flagged as a tsc error (per AGENT_JOURNAL.md Section 1.4).

---

## 2. Dependency Graph — Scheduler Tick → Signal Generation

```
mini-services/scheduler/index.ts  (Bun, port 3042, fires every 60s)
        │
        │  POST /api/scheduler/tick
        ▼
src/app/api/scheduler/tick/route.ts  (POST handler)
        │
        ├─ @/lib/brain/state             hydrate(), tickStarted/Ended(), recordSample(),
        │                                snapshot(), consumeForceRunQueue(), setWatch(),
        │                                recordLlmCall/Success/Failure(), recordAlert(),
        │                                recordAction(), isRunning(), llmInCooldown()
        │     │
        │     ├─ @/lib/brain/types       (type-only)
        │     ├─ @/lib/brain/config      defaultBrainConfig(), clamp()
        │     └─ @/lib/db                Setting KV (lazy import)
        │
        ├─ @/lib/brain/engine            gateDecide(), classifyRegime()
        │     ├─ @/lib/brain/state       (budget/watch/skip recorders)
        │     └─ @/lib/types
        │
        ├─ @/lib/brain/selftune          selfTune()
        │     ├─ @/lib/db                SignalOutcome
        │     ├─ @/lib/brain/state       getMode/getConfig/setConfig/recordTuneEvent
        │     └─ @/lib/brain/config      clamp
        │
        ├─ @/lib/brain/triggers          checkCrossAssetTriggers()
        │     └─ @/lib/brain/state       allWatch/forceRun/recordTrigger/getConfig
        │
        ├─ @/lib/brain/news-triggers     checkNewsTriggers()
        │     ├─ @/lib/brain/state       forceRun/recordTrigger
        │     ├─ node:https              (RSS feeds)
        │     └─ CoinDesk, Cointelegraph, Decrypt  (external)
        │
        ├─ @/lib/analysis/grading        gradeExpiredSignals()
        │     ├─ @/lib/db                Signal/SignalOutcome
        │     ├─ @/lib/market/binance    getTicker24h()
        │     └─ @/lib/market/macro      getMacroQuote()
        │
        ├─ @/lib/analysis/price-alerts   checkPriceAlerts()
        │     ├─ @/lib/db                PriceAlert
        │     ├─ @/lib/market/binance    getTicker24h()
        │     └─ @/lib/market/macro      getMacroQuote()
        │
        ├─ @/lib/analysis/consensus      computeConsensus(), buildTechnicalLayer(),
        │                                buildOrderbookLayer(), buildOnchainLayer(),
        │                                shouldAlert()
        │     └─ @/lib/types
        │
        ├─ @/lib/risk/vol_targeting      volTargetSize()
        │     └─ @/lib/types
        │
        ├─ @/lib/market/binance          getKlines(), getOrderBook(),
        │                                getFundingRate(), getTicker24h()
        │     ├─ @/lib/types
        │     ├─ fetch                   (Binance REST)
        │     └─ WebSocket               (Binance WS)
        │
        ├─ @/lib/market/onchain          getOnChainStats(), getHashrateHistory()
        │     ├─ node:https
        │     └─ blockchain.info         (external)
        │
        ├─ @/lib/llm/router              completeWithAutoFallback(), resolveModel()
        │     ├─ @/lib/db                LlmProvider, ModuleModelConfig
        │     ├─ @/lib/types
        │     ├─ node:https
        │     └─ {provider}.baseUrl      (external LLM)
        │
        ├─ @/lib/llm/prompts             CRYPTO_TECHNICAL_SYSTEM
        │
        ├─ @/lib/alerts/telegram         sendSignalAlert()
        │     ├─ @/lib/config/settings   getSetting()
        │     └─ fetch                   api.telegram.org (external)
        │
        ├─ @/lib/config/settings         getSetting(), setSetting()
        │     └─ @/lib/db                Setting
        │
        ├─ @/lib/db                      Prisma singleton
        │
        └─ @/lib/supabase/sync           (dynamic import; stub, returns null)

Per-asset analyzeAsset() pipeline (called from runCryptoScan/runForcedAnalysis):

  klines(4h,200) ┐
  orderbook(50)  ├─ parallel ─► computeIndicators()  ─┐
  fundingRate    │                                       ├─► buildTechnicalLayer()
  ticker24h      ┘                                       │   buildOrderbookLayer()
                                                         │   computeConsensus()  ──► detConsensus
                  getOnChainStats()  ─► getHashrateHistory() ─► buildOnchainLayer() ─┘
                                                                                      │
                                                                                  gateDecide()
                                                                                  │  ├─ budget-exhausted  → skip
                                                                                  │  ├─ force-run         → analyze (tier 1/2)
                                                                                  │  ├─ yagni-unanimous   → skip
                                                                                  │  ├─ cache-hit         → cache
                                                                                  │  ├─ cadence-quiet     → skip
                                                                                  │  └─ otherwise         → analyze (tier 1/2)
                                                                                      │
                                                              ┌───────────────────────┘
                                                              ▼ (if action='analyze' & eligible)
                                          completeWithAutoFallback({messages, moduleKey:'crypto_technical', layer})
                                                              │
                                                              ▼
                                          safeParseJson()  ─► llmLayer
                                                              │
                                                              ▼
                                          computeConsensus({technical, orderbook, onchain}, llmLayer)
                                                              │
                                                              ▼
                                          setWatch() ─► volTargetSize(10000, klines)
                                                              │
                                                              ▼
                                          db.signal.create({direction, conviction, entry/stop/tp,
                                                            rationale: `[trigger:${src}] [vol-target:X% rv:Y%]\n…`,
                                                            status:'open', expiresAt: now+4h})
                                                              │
                                                              ▼
                                          shouldAlert()  ─► sendSignalAlert()  ─► Telegram
                                                              │
                                                              ▼
                                          recordAction()
```

**Circular imports:** None observed. `state.ts` is the only module with cross-dir import cycles avoided by lazy `import()` of `@/lib/db` inside `hydrate`/`persist`.

---

## 3. Test Coverage

### 3.1 State
- **Test files in `src/` or `mini-services/`:** **0**
- **Test runner configured:** No (`package.json` has no `test` script, no `vitest`/`jest`/`bun:test` in dependencies).
- **Coverage tooling:** none.
- **Confirmed:** 0 test files, 0% coverage.

### 3.2 Modules with zero coverage (all of them)

Every module listed in Section 1 has **zero direct test coverage**. The complete list:

**Brain:** `state.ts`, `engine.ts`, `selftune.ts`, `triggers.ts`, `news-triggers.ts`, `config.ts`, `types.ts`
**LLM:** `router.ts`, `prompts.ts`
**Analysis:** `consensus.ts`, `cointegration.ts`, `triple-barrier.ts`, `deflated-sharpe.ts`, `hurst.ts`, `fear-greed-edge.ts`, `grading.ts`, `correlation.ts`, `price-alerts.ts`
**Risk:** `vol_targeting.ts`
**Market:** `binance.ts`, `macro.ts`, `deribit.ts`, `onchain.ts`, `coingecko.ts`, `reddit.ts`, `devactivity.ts`, `indicators.ts`
**Config:** `settings.ts`
**Alerts:** `telegram.ts`
**Supabase:** `sync.ts` (stub)
**DB:** `db.ts`
**All API routes** (44 routes under `src/app/api/**`)
**Mini-service:** `mini-services/scheduler/index.ts`

Several modules **expose** `__resetForTests()` / `__clearXxxCacheForTests()` helpers (state.ts, news-triggers.ts, deribit.ts, onchain.ts, coingecko.ts, reddit.ts, devactivity.ts) — suggesting tests were planned but never written.

### 3.3 Pure functions (testable without mocks) vs integration-test-required

#### Pure — no mocks needed
| Module | Why pure |
|--------|----------|
| `lib/brain/engine.ts` | `classifyRegime`, `computeNoteworthiness`, `dataSignature`, `layerAgreement`, `watchFromDecision` are pure. `gateDecide` reads `getConfig`/`getWatch`/`budgetExhausted` from state — needs `__resetForTests()` but no network/DB. |
| `lib/brain/config.ts` | `defaultBrainConfig`, `clamp` — pure. |
| `lib/analysis/consensus.ts` | All builders + `computeConsensus` + `shouldAlert` — pure. |
| `lib/analysis/cointegration.ts` | `ols`, `adfTest`, `halfLife`, `engleGranger`, `computeCointegrationMatrix` — pure. |
| `lib/analysis/triple-barrier.ts` | `tripleBarrierLabel`, `tripleBarrierLabelBatch` — pure. |
| `lib/analysis/deflated-sharpe.ts` | `normalCDF`, `inverseNormalCDF`, `moments`, `deflatedSharpeRatio` — pure. |
| `lib/analysis/hurst.ts` | `hurstExponent`, `classifyRegime` — pure. |
| `lib/analysis/correlation.ts` | `pearsonCorrelation`, `dailyReturns`, `linearRegression`, `computeCorrelationMatrix` — pure. |
| `lib/risk/vol_targeting.ts` | `volTargetSize` — pure (takes equity + klines). |
| `lib/market/indicators.ts` | sma, ema, rsi, macd, bollinger, vwap, atr, findLevels, computeIndicators — pure. |
| `lib/brain/config.ts` | (already listed) |
| `lib/brain/types.ts` | type-only, no tests needed. |

#### Need integration-test setup (DB / network / globalThis)
| Module | Why |
|--------|-----|
| `lib/brain/state.ts` | globalThis singleton; `hydrate`/`persist` hit Prisma. Use `__resetForTests` + a SQLite test fixture. |
| `lib/brain/selftune.ts` | DB read (`signalOutcome.findMany`) + state mutations. |
| `lib/brain/triggers.ts` | State-only — testable with `__resetForTests` + seeded `setWatch` calls. |
| `lib/brain/news-triggers.ts` | Hits RSS feeds; needs `https` mock or VCR-style fixture. |
| `lib/llm/router.ts` | Hits provider HTTP; needs nock/msw + DB seed for `LlmProvider`. |
| `lib/analysis/grading.ts` | DB + binance + macro. Needs DB fixture + HTTP mocks. |
| `lib/analysis/price-alerts.ts` | DB + binance + macro. Same. |
| `lib/analysis/fear-greed-edge.ts` | Calls `getFearGreed()` (HTTP). Needs mock. |
| `lib/market/binance.ts` | HTTP + WS. Needs HTTP mock + WS stub. |
| `lib/market/macro.ts` | HTTP. Needs mock. |
| `lib/market/deribit.ts` | HTTP. Needs mock. |
| `lib/market/onchain.ts` | HTTP + globalThis state. |
| `lib/market/coingecko.ts` | HTTP + globalThis cache. |
| `lib/market/reddit.ts` | HTTP + globalThis cache. |
| `lib/market/devactivity.ts` | HTTP + globalThis cache. |
| `lib/alerts/telegram.ts` | HTTP + Setting KV. |
| `lib/config/settings.ts` | Prisma. |
| `lib/db.ts` | Prisma singleton — environmental. |
| `app/api/**` | Need Next route harness (`@testing-library/react` or `bun:test` route invokers) + DB fixtures. |
| `mini-services/scheduler/index.ts` | Bun runtime — needs `Bun.serve` mock. |

---

## 4. Risk Smells Inventory

### 4.1 Magic numbers not in a config/tunables file

| File:Line | Magic number | What it controls |
|-----------|--------------|------------------|
| `brain/engine.ts:55` | `0.04` | ATR% threshold for "volatile" regime |
| `brain/engine.ts:64` | `0.005`, `10` | EMA sep / RSI dev for "trending" regime |
| `brain/engine.ts:110-160` | `0.04, 0.08, 30, 0.001, log(1.5), 10` | Per-signal scaling in `computeNoteworthiness` |
| `brain/engine.ts:226-232` | `0.005, 5, 0.5, 0.01, 0.1, 0.5` | Bucket step sizes in `dataSignature` |
| `brain/engine.ts:289` | `1500` (default tier tokens) | `estimatedTierTokens` fallback |
| `brain/state.ts:96-102` | `60, 120, 50, 500` (500 unused) | Ring-buffer caps + LLM cooldown 30s/120s |
| `brain/selftune.ts:23-39` | `40, 12, 2, 55/85, 20/55, 0.6/0.8/0.5/0.3, 60/40` | All tuning thresholds |
| `brain/triggers.ts:16,19,23-48` | `2*60*1000`, `LEADERS`, `FOLLOWERS` map | Storm-guard + leader/follower map (hardcoded) |
| `brain/news-triggers.ts:24-32,106` | `5*60*1000`, `8000`, `500`, `2` | Cache TTL, timeout, dedup cap, impact weight |
| `brain/news-triggers.ts:38-64` | `ASSET_TOKENS` map (25 entries) | Hardcoded token → symbol table |
| `brain/news-triggers.ts:76-104` | `KEYWORDS` lexicon (28 entries) | Hardcoded news lexicon |
| `brain/config.ts:11-19` | `35, 65, 70, 0.8, 30min, 10min, 60000, 1hr` | `defaultBrainConfig` — at least these are isolated |
| `analysis/consensus.ts:35-43` | `LAYER_WEIGHTS` | At least isolated |
| `analysis/consensus.ts:53` | `8` | Direction threshold |
| `analysis/consensus.ts:125` | `2, 1.5, 1` | Sentiment impact multipliers |
| `analysis/consensus.ts:136` | `5` | Sentiment article-count cap |
| `analysis/consensus.ts:217` | `1.5` | Conviction divisor |
| `analysis/cointegration.ts:30-34` | MacKinnon criticals `-3.43/-2.86/-2.57` | ADF critical values (these *are* constants — OK) |
| `analysis/cointegration.ts:273-276` | `30, 1.0, 250, 1` | `engleGranger` defaults |
| `analysis/triple-barrier.ts:43-48` | `1.5, 3.0, 24` | SL/TP multipliers + holding period |
| `analysis/deflated-sharpe.ts:75,199` | `0.02425, 0.5772156649…` | Acklam pLow + Euler-Mascheroni (these *are* constants) |
| `analysis/fear-greed-edge.ts:27-33` | `75, 25, 14, 5, 14, 180` | All F&G thresholds |
| `analysis/fear-greed-edge.ts:150,154,158` | `55, 60, 80, 40` | Conviction math |
| `analysis/grading.ts:88` | `2` | Neutral 2% move threshold |
| `risk/vol_targeting.ts:45-53` | All defaults | At least isolated as `DEFAULT_VOL_TARGET_CONFIG` |
| `market/binance.ts:34-36` | `10s, 30s, 5s` | Cache TTLs |
| `market/macro.ts:69` | `5min` | Macro cache TTL |
| `market/deribit.ts:37-42` | `8h, 8s, 1.10, 0.90, 7` | Cache, timeout, OTM moneyness, min DTE |
| `market/deribit.ts:351-353` | `-5, -6, 90, 15, 4, 50` | Regime thresholds |
| `market/onchain.ts:24-26` | `15min, 6s, 24` | Cache, timeout, ring size |
| `market/coingecko.ts:14-15` | `5min, 8s` | Cache, timeout |
| `market/reddit.ts:22-24` | `15min, 6s, 50` | Cache, timeout, post limit |
| `market/devactivity.ts:24-26` | `30min, 8s, 7d` | Cache, timeout, week window |
| `app/api/scheduler/tick/route.ts:404` | `10000` | **Hardcoded equity of $10,000 for volTargetSize** |
| `app/api/scheduler/tick/route.ts:418-424` | `1.5, 2` | ATR multipliers for stopLoss/takeProfit (override LLM) |
| `app/api/scheduler/tick/route.ts:431` | `4 * 60 * 60 * 1000` | Signal horizon (4h) |
| `app/api/scheduler/tick/route.ts:102` | `300` | `maxDuration` |
| `app/api/macro/quotes/route.ts:56-61` | `25, 18, 0.3` | VIX/DXY risk-on/off regime thresholds |
| `app/api/multi-timeframe/route.ts:50` | `30` | Min klines for indicator computation |

### 4.2 `any` types in function signatures / hot paths

| File:Line | Usage |
|-----------|-------|
| `lib/db.ts:43,53,57,90` | `client: any`, `createClient(): any`, `ensureClient(): any`, `export const db = ensureClient()` — the Prisma client is untyped at the boundary. |
| `lib/brain/selftune.ts:90` | `rows.map((r: any) => ({…}))` — Prisma result untyped. |
| `lib/analysis/grading.ts:100` | `let expired: any[] = []` — Signal rows untyped. |
| `lib/analysis/price-alerts.ts:83` | `let alerts: any[] = []` — PriceAlert rows untyped. |
| `lib/llm/router.ts:136` | `(r: any) => ({…})` — LlmProvider row untyped. |
| `lib/llm/router.ts:250` | `const contents: any[] = []` — Gemini request body. |
| `lib/llm/router.ts:282` | `.map((p: any) => p.text)` — Gemini response parts. |
| `lib/market/binance.ts:65,87,135,186,281` | `fetchJson(): Promise<any>`, `parseTicker24h(raw: any)`, `err: any`, `raw.map((k: any[]))`, `raw.map((r: any))` |
| `lib/market/deribit.ts:122,188` | `httpsGetJson(): Promise<any>`, `parseOptionSummary(row: any)` |
| `lib/market/coingecko.ts:87,138,164` | `httpsGetJson(): Promise<any>`, two `.map((c: any))` |
| `lib/market/macro.ts:17,161` | `httpsGetJson(): Promise<any>`, `arr.map((d: any))` |
| `lib/market/reddit.ts:109` | `httpsGetJson(): Promise<any>` |
| `lib/market/devactivity.ts:85` | `httpsGetJson(): Promise<any>` |
| `lib/analysis/fear-greed-edge.ts:194,199,202,207` | `entry: any` casts in extractValues |
| `app/api/scheduler/tick/route.ts:794-795` | `(supabase as any).syncToSupabase === 'function'` and `(supabase as any).syncToSupabase()` — dynamic-import cast |
| `app/api/setup/route.ts:57` | `moduleConfigs.map((c: any) => c.moduleKey)` |
| `app/api/news/route.ts:124` | `(r: any) => ({…})` |
| `app/api/economic-calendar/route.ts:102` | `rawEvents.map((e: any, i: number))` |
| `app/api/notifications/route.ts` (whole file) | DB rows used without explicit typing |

### 4.3 Dead code

| Location | What |
|----------|------|
| `lib/brain/state.ts:99` | `const MAX_SEEN_ARTICLES = 500;` — **never used**. The actual dedup buffer is `MAX_SEEN = 500` in `news-triggers.ts:32`. |
| `lib/brain/engine.ts:411-427` | `watchFromDecision()` — exported, **zero importers**. |
| `lib/llm/prompts.ts:41-117` | `MARKETS_ANALYSIS_SYSTEM`, `SCHEDULER_TICK_SYSTEM`, `MACRO_ANALYSIS_SYSTEM`, `SYSTEM_PROMPTS_BY_MODULE` — **zero importers** (only `CRYPTO_TECHNICAL_SYSTEM` and `NEWS_SENTIMENT_SYSTEM` are used). |
| `lib/market/macro.ts:226-249` | `getForexRate()` — **zero callers**. |
| `lib/analysis/triple-barrier.ts` (entire file) | Built but **not wired** — see header comment "NOT yet wired into grading.ts". |
| `lib/analysis/deflated-sharpe.ts` (entire file) | `deflatedSharpeRatio()` has **zero callers**. |
| `lib/analysis/hurst.ts` (entire file) | `hurstExponent()` + `classifyRegime()` have **zero callers**. |
| `lib/analysis/consensus.ts:220-223` | `entryPrice` line `input.technical?.rationale ? undefined : undefined` — always `undefined`; the comment says "kept simple" but it's effectively dead. |
| `prisma/schema.prisma:193` | `ScheduleJob.nextRunAt` field — never set/read in code (only `lastRunAt` is used by `isJobDue`). |
| `app/api/notifications/route.ts:77` | `where: type ? undefined : undefined` — ternary where both branches are `undefined`. Dead/confused expression. |
| `lib/supabase/sync.ts` | Stub that always returns `null`. Whether it counts as "dead" depends on intent, but it's currently a no-op called every tick. |

### 4.4 Circular imports
None observed. `state.ts` deliberately uses lazy `import('@/lib/db')` inside `hydrate`/`persist` to avoid pulling Prisma into pure-logic test paths — a documented pattern, not a smell.

### 4.5 Untyped API boundaries (no input validation)

`zod` is a declared dependency (^4.4.3) but is **not used by a single API route**. Every route does `body = await req.json() as SomeType` and then ad-hoc `if (!body.x) return 400`.

| Route | Issue |
|-------|-------|
| `POST /api/brain` | `setConfig` accepts `Partial<BrainConfig>` with no validation — could write `NaN`/strings into numeric fields; `setMode`/`forceRun` only validate the obvious field. |
| `POST /api/scheduler/tick` | Body is parsed and then **ignored** (only `Date.now()` is used). No validation needed but the param is dead. |
| `POST /api/signals` | Manual `direction` enum check + `Math.max/min` clamp. No schema. |
| `POST /api/llm/providers` | `name`, `baseUrl` checked; `apiKey` stored verbatim with no length/format check. |
| `POST /api/llm/models` | Manual field checks. |
| `POST /api/llm/module-configs` | Manual `moduleKey/layer/modelId/providerId` presence check; no enum validation on `moduleKey` (the `ModuleKey` union is bypassed). |
| `POST /api/portfolio` | Manual `Number.isFinite` checks on `quantity`/`entryPrice`. |
| `POST /api/price-alerts` | `condition` validated against a `Set`; `targetPrice` finite check. |
| `POST /api/news/analyze` | Only checks `body.id` presence. |
| `POST /api/auth/login` | Only checks `password` presence. |
| `POST /api/setup` | (not inspected — likely similar pattern). |
| `POST /api/notifications`, `/api/watchlists`, `/api/reports`, `/api/economic-calendar`, `/api/ipo-ico`, `/api/settings` | All follow the same `await req.json() as X` pattern. |

### 4.6 Money / order-touching code without tests

The app does not place real exchange orders (signals are advisory). However, the following are money-adjacent and have **no tests**:

| Module | What's at stake |
|--------|-----------------|
| `lib/risk/vol_targeting.ts` | Computes position notional. A bug here sizes real trades wrong if signals are followed. Called with hardcoded `$10,000` equity in tick route. |
| `lib/analysis/grading.ts` | Writes `SignalOutcome` rows + flips Signal status to `closed`. Feeds `selftune.ts` which **mutates live trading thresholds** (`unanimousConviction`, `minNoteworthiness`). A grading bug becomes a self-tuning bug. |
| `lib/brain/selftune.ts` | Mutates `brain.config` thresholds in production memory. The bounds `[55,85]`/`[20,55]` and ±2 nudge cap are the only safety net. |
| `app/api/scheduler/tick/route.ts:432-454` | `db.signal.create` with `entryPrice`/`stopLoss`/`takeProfit` — these are the values Telegram alerts and the signals feed surface to users. Magic ATR multipliers `1.5`/`2` override the LLM-provided values when null. |
| `app/api/signals/route.ts (POST)` | Manual signal creation. `entryPrice`/`stopLoss`/`takeProfit` written verbatim from user input with no sanity check (e.g. SL on the wrong side of entry for the chosen direction). |
| `app/api/portfolio/route.ts (POST)` | User-entered holdings (`quantity`, `entryPrice`) — no validation that SL is meaningful, but at least finite/positive. |
| `lib/alerts/telegram.ts` | Sends alerts to a Telegram channel. A bug spams users with bad signals. |

### 4.7 Hardcoded values that should be configurable

| Hardcoding | Where | Should become |
|------------|-------|---------------|
| Equity = $10,000 | `tick/route.ts:404` | Setting KV `brain.paperEquity` or per-user portfolio. |
| Signal horizon = 4h | `tick/route.ts:431`, `signals/route.ts:97`, `Signal.timeframe` default | Setting KV `brain.signalHorizonMs` (also used by grading.ts to find `expiresAt < now`). |
| Stop = 1.5×ATR, TP = 2×ATR | `tick/route.ts:418-424` | `BrainConfig` or per-asset override. |
| `LEADERS = ['BTCUSDT','ETHUSDT']` + `FOLLOWERS` map | `triggers.ts:19,23-48` | DB table `CrossAssetEdge(leader, follower, weight)`. |
| `ASSET_TOKENS` map (25 entries) | `news-triggers.ts:38-64` | DB table or JSON setting. |
| `KEYWORDS` lexicon (28 entries) | `news-triggers.ts:76-104` | DB table `NewsKeyword(word, weight, polarity)`. |
| `REPOS` list (5 entries) | `devactivity.ts:61-67` | DB table. |
| Reddit subreddits | `reddit.ts:245` | Setting KV. |
| `MACRO_SYMBOLS` | `macro/quotes/route.ts:16-24` | DB table. |
| `FALLBACK_PRIORITY` LLM order | `llm/router.ts:338` | `LlmProvider.priority` field + `ORDER BY priority`. |
| Per-provider default model IDs | `llm/router.ts:371-378` | Already in `LlmModel` — should always resolve via `ModuleModelConfig`. |
| Regime thresholds (VIX 25/18, DXY 0.3) | `macro/quotes/route.ts:56-61` | Setting KV. |
| Derivatives regime thresholds (-5/-6/90, 15/4/50) | `deribit.ts:351-353` | Setting KV or constants file. |
| F&G streak thresholds (14/5/14/75/25) | `fear-greed-edge.ts:27-33` | Setting KV. |
| `barsPerYear: 365 * 6` (4h bars) | `tick/route.ts:404` | Derive from `klines` interval instead of hardcoding. |
| Port 3042 (scheduler) | `mini-services/scheduler/index.ts:3` | Already overridable via env, but `PORT` constant could be cleaner. |

### 4.8 Security / access-control smells (bonus)

| Smell | Detail |
|-------|--------|
| **All API routes are publicly accessible.** | `src/middleware.ts:20` lists `'/api/'` in `PUBLIC_PREFIXES`. Every `POST /api/llm/providers` (writes `apiKey`), `POST /api/portfolio`, `POST /api/signals`, `POST /api/brain` (force-run, setConfig, resetBudget) is reachable without the auth cookie. The middleware comment says "API routes are still gated by auth checks at the route level" — but no route performs an auth check. |
| **API keys stored in plaintext.** | `LlmProvider.apiKey` and `Setting[telegram.bot_token]` are TEXT in SQLite. No encryption at rest. |
| **Telegram bot token exposed via API.** | `POST /api/llm/providers` returns the row including `apiKey` on every GET `/api/llm/providers`. |
| **`POST /api/auth/login`** uses `submitted !== expected` after a length check — not constant-time. A timing attacker can detect length matches. (Minor; the cookie-based session is the bigger surface.) |

---

## 5. Top-10 Ranked Improvement Candidates

Ranked by (1) risk reduction, (2) verifiability, (3) impact on signal quality.

| # | Candidate | Why it matters | Size (h) | Success metric |
|---|-----------|----------------|----------|----------------|
| 1 | **Wire `triple-barrier.ts` into `grading.ts` + add characterization tests for both before/after** | The fixed-4h grading horizon systematically mislabels slow and fast signals; the triple-barrier method is already built but dormant. Once wired, every downstream `selftune` decision changes. | 6 | `grade` distribution shifts (fewer `partial`, more `correct`/`wrong`); `selftune` nudges become directionally consistent; ≥20 graded signals/unit-test fixture pass. |
| 2 | **Characterization tests for the 8 pure-math modules** (`indicators`, `consensus`, `cointegration`, `hurst`, `triple-barrier`, `deflated-sharpe`, `vol_targeting`, `correlation`) | These compute every number the brain uses. Zero coverage means any refactor is a coin-flip. They're pure — easiest to test, highest payoff. | 8 | 100% line coverage on those 8 modules; test suite runs in <2s; CI green. |
| 3 | **Move magic numbers from `engine.ts`, `consensus.ts`, `selftune.ts`, `triggers.ts` into `BrainConfig` + Setting KV** | 30+ hardcoded thresholds scattered across the brain make A/B testing a new strategy impossible without a code deploy. | 5 | All thresholds readable from `getConfig()`; default values unchanged; `__resetForTests` + a snapshot test pins the defaults. |
| 4 | **Add zod input validation to every `POST` API route** | `zod` is already a dependency. 12+ routes do `await req.json() as X` — malformed input flows straight into Prisma writes. | 6 | Every POST has a zod schema; tests cover happy path + 1 rejection case per route; no `as X` casts remain on `req.json()`. |
| 5 | **Lock down `/api/*` (except `/api/auth/*` and `/api/health`) behind the auth middleware** | Currently every POST route (provider keys, portfolio, signals, brain control) is reachable without the auth cookie. Highest-impact security fix. | 2 | Middleware test: unauthenticated request to `/api/llm/providers` → 302 to `/lock`; authenticated → 200. |
| 6 | **Replace hardcoded equity `$10,000` + 4h horizon + 1.5×/2× ATR overrides with config** | The tick route silently overrides LLM-provided SL/TP with ATR math and sizes every signal against a fictitious $10k. Users see "vol-target:X%" badges that are wrong for any real portfolio. | 3 | `volTargetSize` reads equity from Setting KV; SL/TP override only when LLM omits them; signal horizon configurable; tested via tick-route unit test. |
| 7 | **Delete or wire the 3 dead advanced-analysis modules** (`deflated-sharpe.ts`, `hurst.ts`, `triple-barrier.ts`) | ~600 lines of untested, unwired code inflate the cognitive load and lint surface. Either wire them (see #1 for triple-barrier) or delete + document. | 2 (delete) / 8 (wire all 3) | Either zero dead-code warnings from `tsc --noUnusedLocals` (after enabling) or each module has ≥1 caller + 1 test. |
| 8 | **Type the Prisma boundary (`db.ts`) + remove `(r: any)` casts in selftune/grading/price-alerts/router** | The Prisma client is typed at runtime (via `@prisma/client`) but `db.ts` casts it to `any`, so every `db.signal.findMany(...)` returns `any` and the `any` propagates. | 4 | `export const db: PrismaClient` (typed); `expired: any[]` → `expired: Signal[]`; tsc strict mode passes; no new runtime behavior. |
| 9 | **Externalize `LEADERS`/`FOLLOWERS` + `ASSET_TOKENS` + `KEYWORDS` lexicons into DB tables** | Adding a new tracked asset today requires a code deploy. The cross-asset + news-trigger logic is otherwise sound. | 6 | New `CrossAssetEdge`, `NewsKeyword` tables + admin UI; existing trigger behavior covered by tests against seeded fixtures. |
| 10 | **End-to-end tick-route test with mocked LLM + binance + DB** | The tick is the 800-line heart of the app and the only place where the 12-step pipeline composes. A single integration test that asserts "given X market state, the tick produces a Signal row with direction D and conviction C" would catch regressions in every module at once. | 8 | 1 happy-path + 2 skip-path (budget-exhausted, llm-cooldown) integration tests; runs <5s against in-memory SQLite + nock fixtures. |

**Total estimated effort: ~50-60 hours** for all 10. Candidates 1, 2, 4, 5 are the highest leverage and could be sequenced first (≈22h combined).

---

*End of AUDIT.md*
