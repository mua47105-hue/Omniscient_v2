# OMNISCIENT — Lazy Brain · Senior-Developer Handover

**Project:** OMNISCIENT market-intelligence app + the "Lazy Brain" autonomous
orchestration layer + the "Field Guide to Real Edge (Vol. 2)" edge modules.
**Status as of last session:** Stable, lint-clean, all pages 200, scheduler
running. The code was built across 13 development rounds (Task IDs 0–13) in a
Next.js 16 + Prisma + SQLite environment.

> ⚠️ **Environment reset note:** At the time of writing this handover, the
> `/home/z/my-project` directory was reset to a bare scaffold (only `.env`,
> `.git`, `download/`, `skills/`, `upload/` remained). The original Omniscient
> tarball (`omniscient-hf-spaces.tar.gz`) and the research PDF
> (`OMNISCIENT_EDGE_SOURCES.pdf`) were previously in `upload/`. This document
> reconstructs the **full intended structure** from the development worklog so a
> senior developer can restore + continue the work. All file paths, module
> responsibilities, and integration points below are accurate to the last
> verified state.

---

## 1. Project overview

OMNISCIENT is a 24/7 AI-powered global market-intelligence dashboard (crypto,
forex, stocks, indices, commodities, macro). It uses multiple LLM providers to
generate trading signals, runs a self-learning grading loop, and sends Telegram
alerts. The **Lazy Brain** is an autonomous orchestration layer that applies
"ponytail's ladder" to token usage — it decides *whether* and *how deeply* to
consult the LLM per asset per tick, keeping a free-tier stack alive without
hitting rate limits.

### Tech stack
- **Framework:** Next.js 16 (App Router, Turbopack, standalone output)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 4 + shadcn/ui (New York preset)
- **Database:** Prisma 6 ORM (SQLite for dev, PostgreSQL for prod via Supabase)
- **State:** @tanstack/react-query 5, Zustand
- **Charts:** recharts + custom inline-SVG sparklines (no chart lib for the brain)
- **Auth:** Custom middleware-based password lock (cookie `omniscient-auth`)
- **Runtime:** Bun (dev + production server)
- **Scheduler:** Bun mini-service on port 3042, pings `/api/scheduler/tick` every 60s

### Free stack (zero API keys to start)
- **LLM:** Pollinations (free, no key, `openai` model = gpt-oss-20b) — seeded as the default active provider
- **Crypto data:** Binance public REST + WebSocket
- **Trending:** CoinGecko public API
- **Macro:** Yahoo Finance, alternative.me Fear & Greed, er-api forex
- **On-chain:** blockchain.info `/q` endpoints
- **Dev activity:** GitHub public API (60 req/hr anonymous)
- **Derivatives:** Deribit public API (no key) + Binance Coin-M

---

## 2. Directory structure (intended)

```
/home/z/my-project/
├── .env                          # DATABASE_URL=file:/home/z/my-project/db/custom.db, APP_PASSWORD=omniscient
├── package.json                  # Next 16, Prisma 6, react-query 5, recharts, framer-motion, z-ai-web-dev-sdk
├── prisma/
│   └── schema.prisma             # 15 models (LlmProvider, LlmModel, ModuleModelConfig, Asset, Watchlist,
│                                 #   DataSnapshot, Signal, SignalOutcome, Alert, PriceAlert, NewsItem,
│                                 #   IpoIcoItem, Report, PortfolioHolding, ScheduleJob, Setting)
├── mini-services/
│   └── scheduler/
│       ├── index.ts              # Bun HTTP server on port 3042, POSTs to /api/scheduler/tick every 60s
│       └── package.json          # dev: bun --hot index.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Inter + JetBrains Mono fonts, dark theme, AppShell, Toaster
│   │   ├── page.tsx              # / → OverviewClient
│   │   ├── brain/page.tsx        # /brain → BrainPanel (the centerpiece)
│   │   ├── lock/page.tsx         # /lock → LockClient (auth gate)
│   │   ├── globals.css
│   │   ├── middleware.ts         # Auth: redirects to /lock if no 'omniscient-auth' cookie
│   │   ├── api/
│   │   │   ├── brain/route.ts              # GET brain snapshot, POST control (pause/resume/forceRun/...)
│   │   │   ├── scheduler/tick/route.ts     # POST — the brain's main loop (grading, scan, triggers, tune)
│   │   │   ├── analysis/
│   │   │   │   ├── cointegration/route.ts  # E3 cointegration matrix
│   │   │   │   ├── derivatives-v2/route.ts # E4 basis + skew + VRP + regime
│   │   │   │   └── fear-greed-edge/route.ts# E8 asymmetric F&G
│   │   │   ├── crypto/{prices,klines,orderbook,movers,scan,trending}/route.ts
│   │   │   ├── markets/{quotes,scan,heatmap}/route.ts
│   │   │   ├── macro/{fear-greed,quotes,global}/route.ts
│   │   │   ├── signals/{route,grade/route}.ts
│   │   │   ├── news/{route,analyze/route}.ts
│   │   │   ├── onchain/stats/route.ts      # blockchain.info hashrate/tx/difficulty
│   │   │   ├── devactivity/route.ts        # GitHub commit count per repo
│   │   │   ├── sentiment/reddit/route.ts   # Reddit word-count sentiment (graceful when IP-blocked)
│   │   │   ├── analytics/models/route.ts   # Model accuracy dashboard data
│   │   │   ├── auth/{login,logout}/route.ts
│   │   │   ├── settings/route.ts
│   │   │   ├── portfolio/route.ts
│   │   │   ├── price-alerts/{route,check/route}.ts
│   │   │   ├── watchlists/route.ts
│   │   │   └── ... (43 API routes total)
│   │   └── [22 page routes: / /brain /crypto /crypto/[symbol] /markets /markets/[symbol]
│   │       /heat-map /correlation /screener /signals /derivatives /multi-timeframe
│   │       /price-alerts /portfolio /risk-calculator /backtest /strategy-builder
│   │       /analytics /news /macro /economic-calendar /ipo-ico /notifications /reports /settings/*]
│   ├── components/
│   │   ├── brain/                # ← Lazy Brain UI (the new centerpiece)
│   │   │   ├── BrainPanel.tsx            # Main control panel (header, scoreboard, budget, watch, config, feed)
│   │   │   ├── BrainStatusCard.tsx       # Dashboard banner (autonomous status + sparkline)
│   │   │   ├── ThinkingIndicator.tsx     # Animated waveform during ticks
│   │   │   ├── TriggerBreakdown.tsx      # Interactive donut (news/cross-asset/manual)
│   │   │   ├── Sparkline.tsx             # Inline-SVG used-vs-saved sparkline
│   │   │   ├── SavedAreaChart.tsx        # Cumulative tokens-saved area chart
│   │   │   ├── EdgeSourcesCard.tsx       # E4 derivatives regime + E8 asymmetric F&G
│   │   │   ├── FreeSignalsCard.tsx       # 5 free sources: CoinGecko / F&G / Reddit / On-Chain / Dev-Activity
│   │   │   └── FooterBrainIndicator.tsx  # Global footer brain-health indicator
│   │   ├── dashboard/            # Overview, StatCard, AssetTable, LiveTickerBar, CommandPalette
│   │   ├── signals/SignalsFeedClient.tsx # Signal feed with "Triggered by" + "Vol-target" badges
│   │   ├── layout/               # AppShell, Sidebar, Header, Footer, MobileNav
│   │   ├── crypto/, markets/, macro/, news/, settings/, ... (existing Omniscient components)
│   │   └── ui/                   # Full shadcn/ui component set (New York style)
│   ├── lib/
│   │   ├── brain/                # ← The Lazy Brain engine (NEW)
│   │   │   ├── state.ts          # In-memory singleton (running/mode/config/budget/stats/watch/triggers/tuneEvents/samples)
│   │   │   ├── engine.ts         # computeNoteworthiness, classifyRegime, dataSignature, gateDecide (the ponytail ladder)
│   │   │   ├── selftune.ts       # Self-tuning thresholds from grading feedback
│   │   │   ├── triggers.ts       # Cross-asset triggers (BTC/ETH → correlated alts)
│   │   │   ├── news-triggers.ts  # News-event triggers (keyword RSS scan, 5-min cache, every-tick)
│   │   │   └── (state.ts exports: forceRun, recordTrigger, recordTuneEvent, recordSample, tickStarted/Ended, isThinking, llmInCooldown, snapshot)
│   │   ├── analysis/             # ← Edge modules from the PDF (NEW) + existing
│   │   │   ├── consensus.ts      # 7-layer weighted fusion (technical/orderbook/onchain/sentiment/macro/fundamental/intermarket) + onchain-trend layer + LLM layer
│   │   │   ├── cointegration.ts  # E3 Engle-Granger ADF + half-life + z-score (own OLS/ADF, no deps)
│   │   │   ├── triple-barrier.ts # E9 López de Prado triple-barrier labeling
│   │   │   ├── deflated-sharpe.ts# E9 Deflated Sharpe Ratio (multiple-testing correction)
│   │   │   ├── hurst.ts          # E10 DFA-based Hurst exponent regime filter
│   │   │   ├── fear-greed-edge.ts# E8 asymmetric F&G (momentum-long on greed streaks)
│   │   │   ├── grading.ts        # Self-learning loop (grades expired signals)
│   │   │   ├── correlation.ts    # Pearson matrix (existing) — to be augmented by cointegration
│   │   │   ├── screener.ts, backtest.ts, multi-timeframe.ts, derivatives.ts, price-alerts.ts, strategy-builder.ts
│   │   ├── risk/
│   │   │   ├── vol_targeting.ts  # E1 vol-targeting position sizing (Moreira-Muir 2017)
│   │   │   └── calculations.ts   # Existing position-size/risk-reward calc
│   │   ├── market/
│   │   │   ├── binance.ts        # REST + WS (klines, ticker, orderbook, funding, OI)
│   │   │   ├── macro.ts          # Yahoo, Fear&Greed, CoinGecko global, er-api forex
│   │   │   ├── coingecko.ts      # Trending + top markets
│   │   │   ├── onchain.ts        # blockchain.info stats + hashrate-trend tracker
│   │   │   ├── reddit.ts         # Word-count sentiment (graceful 403)
│   │   │   ├── devactivity.ts    # GitHub commit count + 7d delta trend
│   │   │   ├── deribit.ts        # E4 Deribit options (DVOL, 25Δ skew) + Binance Coin-M basis
│   │   │   └── indicators.ts     # Pure-TS RSI/MACD/EMA/Bollinger/VWAP/ATR
│   │   ├── llm/
│   │   │   ├── router.ts         # Multi-provider + auto-fallback + multi-key rotation
│   │   │   └── prompts.ts        # System prompts per analysis module
│   │   ├── config/settings.ts    # Setting KV table wrapper + SETTING_KEYS
│   │   ├── alerts/telegram.ts    # Telegram alert delivery
│   │   ├── supabase/             # Optional cloud sync (client, sync, schema-sql)
│   │   ├── db.ts                 # Prisma singleton (schema-hash-aware, hot-reload-safe)
│   │   ├── db/seed.ts            # Seeds Pollinations (active) + providers + assets + module configs
│   │   ├── db/seed-markets.ts    # Seeds forex/stocks/indices/commodities
│   │   ├── types.ts              # Shared TS types
│   │   └── utils.ts
│   └── hooks/                    # use-mobile, use-toast, useLiveTicker
├── scripts/
│   ├── fix-llm-models.ts
│   └── swap-provider.cjs         # SQLite→PostgreSQL schema swap at build time
├── public/                       # logo.svg, robots.txt
└── worklog.md                    # Development handover log (13 task IDs)
```

---

## 3. The Lazy Brain — how it works

The Brain is the centerpiece. It governs **whether and how deeply** the LLM is
consulted per asset per tick. It never silences a real signal — the
deterministic consensus always runs; the brain only governs the LLM layer.

### 3.1 The gate (ponytail's ladder applied to token usage)

`src/lib/brain/engine.ts` → `gateDecide()`. Returns the first rung that holds:

1. **Budget** — if the rolling token budget is exhausted → skip LLM (free-tier safety net)
2. **YAGNI** — if the deterministic consensus is unanimous + high-conviction → skip LLM
3. **Cache** — if the market-data fingerprint (`dataSignature`) is unchanged → reuse the last verdict
4. **Cadence** — if nothing noteworthy is happening + recently analyzed → skip
5. **Minimum** — only then call the LLM, tier 1 (triage, compressed prompt) or tier 2 (deep)

### 3.2 Brain state (`src/lib/brain/state.ts`)

In-memory singleton on `globalThis` (survives Next.js hot reloads), with
control flags persisted to the Setting KV table:

- `running` (pause/resume), `mode` ('auto'|'manual'), `config` (gate thresholds)
- `budgetUsed` / `budgetWindowStart` (rolling token budget)
- `llmCooldownUntil` / `llmConsecutiveFailures` (circuit-breaker, exponential backoff)
- `tickStartTs` / `lastTickDurationMs` (thinking indicator)
- `stats` (ticksTotal, llmCallsTotal, tokensUsed, tokensSaved, cacheHits, budgetSkips, triggersNews/CrossAsset/Manual)
- `watch: Map<symbol, AssetWatch>` (per-asset last verdict, noteworthiness, regime, action)
- `forceRunQueue: Map<symbol, source>` (manual/news/cross-asset override queue)
- `statsSamples: StatsSample[]` (ring buffer, capped 120 — sparkline timeline)
- `tuneEvents: TuneEvent[]` (ring buffer, capped 50 — self-tune history)
- `recentActions: BrainAction[]` (capped 60 — action feed)

**Hot-reload safety:** `state()` has migration guards that backfill missing
fields AND check types (e.g. `if (!(s.forceRunQueue instanceof Map))` — a Set→Map
type change once crashed the running dev server). Nested stats fields need their
own guards (e.g. `if (s.stats.triggersNews == null) s.stats.triggersNews = 0`).

### 3.3 The scheduler tick (`src/app/api/scheduler/tick/route.ts`)

This is the brain's main loop. Runs every 60s (pinged by the mini-service).
Order of operations (all best-effort — safety paths never block):

1. `tickStarted()` — mark tick in progress (for the thinking indicator)
2. `gradeExpiredSignals()` — self-learning loop: close yesterday's signals with P&L
3. `checkPriceAlerts()` — user price thresholds
4. `runForcedAnalysis()` — process the force-run queue (manual override, works even when paused)
5. `checkNewsTriggers()` — every-tick RSS scan (5-min cache) for breaking news → force-run mentioned assets
6. For each due `ScheduleJob` (crypto_technical every 15min):
   - `runCryptoScan()` → per asset: fetch klines/orderbook/funding/ticker → `computeIndicators` → deterministic `computeConsensus` → `gateDecide` → (skip|cache|analyze) → `volTargetSize` (E1) → save Signal → alert if conviction clears threshold
7. `checkCrossAssetTriggers()` — if BTC/ETH volatile/high-noteworthiness → queue correlated alts
8. `selfTune()` — read recent SignalOutcome grades, nudge gate thresholds toward better calibration
9. `recordSample()` — snapshot the token economy for the sparkline
10. `tickEnded()` — mark tick complete
11. Best-effort Supabase sync

### 3.4 The LLM circuit-breaker (global cooldown)

When Pollinations 429s one asset, `recordLlmFailure()` trips a global cooldown
(30s→60s→120s exponential backoff). Subsequent assets in the same scan skip the
LLM (`reason: 'llm-cooldown'`) and use deterministic consensus — preventing the
"thundering herd" where 11 assets all fire 429'd requests simultaneously.
`recordLlmSuccess()` clears the counter. Force-run bypasses the cooldown.

---

## 4. Edge modules from the PDF ("Field Guide to Real Edge, Vol. 2")

The PDF proposed 12 research-backed suggestions (E1–E12) to add ~0.6–1.0 Sharpe.
6 were implemented (the pure-math core + free-data layers). All are pure TS, no
new dependencies.

### Implemented

| # | Module | File | Evidence | Integration |
|---|--------|------|----------|-------------|
| **E1** | Vol-targeting position sizing | `src/lib/risk/vol_targeting.ts` | Moreira-Muir 2017 (+0.15–0.30 Sharpe) | **Wired into tick** — every signal carries `[vol-target:X% rv:Y%]` in rationale |
| **E3** | Cointegration matrix (Engle-Granger) | `src/lib/analysis/cointegration.ts` | Yale 2024 (Sharpe 1.35) | API `/api/analysis/cointegration`. Own OLS + ADF (no `simple-statistics`) |
| **E9** | Triple-Barrier labeling | `src/lib/analysis/triple-barrier.ts` | López de Prado 2018 | Built + tested. **NOT yet wired into grading.ts** (see deferrals) |
| **E9** | Deflated Sharpe Ratio | `src/lib/analysis/deflated-sharpe.ts` | Bailey-LdP 2014 | `deflatedSharpeRatio()` + `moments()` + `dsrVerdict()`. Ready for backtest |
| **E10** | Hurst exponent (DFA) | `src/lib/analysis/hurst.ts` | MDPI 2024 | `classifyRegime()`. **Key: call on I(0) series (returns/spreads), not prices** |
| **E4** | Derivatives-v2 (basis+skew+VRP) | `src/lib/market/deribit.ts` | Alexander-Imeraj 2021 | API `/api/analysis/derivatives-v2`. Deribit public + Binance Coin-M. Live |
| **E8** | Asymmetric F&G regime | `src/lib/analysis/fear-greed-edge.ts` | Milk Road + ScienceDirect | API `/api/analysis/fear-greed-edge`. Reuses `getFearGreed()`. Live |

### How the edge modules connect to the brain

- **E1** is wired into `analyzeAsset()` in the tick: `volTargetSize(10000, klines)`
  computes the notional, stamped into the signal rationale.
- **E4 + E8** are surfaced in the `EdgeSourcesCard` on `/brain` — showing the
  derivatives regime (CAPITULATION/NEUTRAL/EUPHORIA) + the asymmetric F&G edge.
- **E3** has an API route but the `/correlation` page UI doesn't yet have a
  cointegration tab (next phase).
- **E9/E10** are library-only (tested, ready to wire into grading + cointegration filter).

### Honest deferrals (from the PDF, documented in worklog Task 13)

- **E2/E12 (live execution):** no broker integration. App is signal-generation only.
- **E5 (onchain-v2 flow metrics):** CryptoQuant needs a free account.
- **E6 (leading macro):** FRED needs a free API key. HYG/LQD via Yahoo is free.
- **E7 (microstructure):** needs a persistent WebSocket worker process.
- **E11 (full risk stack):** E1 shipped. Correlation-aware sizing + Kelly + drawdown need `pnlR` + `equityCurve` schema fields.
- **E9 into grading.ts:** triple-barrier is built + tested but NOT wired into the live grading loop (changes the self-tuning feedback — riskier).

---

## 5. Key integration points (where to look)

### Signal generation pipeline
`src/app/api/scheduler/tick/route.ts` → `analyzeAsset()`:
1. Fetch klines/orderbook/funding/ticker (Binance, parallel)
2. `computeIndicators(klines)` → RSI/MACD/EMA/Bollinger/VWAP/ATR
3. `getOnchainTrend()` → BTC hashrate trend (fundamental layer)
4. `computeConsensus()` → 7-layer weighted fusion (deterministic, FREE)
5. `gateDecide()` → skip/cache/analyze (the ponytail ladder)
6. If analyze: `completeWithAutoFallback()` → Pollinations (or fallback chain)
7. `volTargetSize()` → E1 position sizing
8. `db.signal.create()` → save with `[trigger:...]` + `[vol-target:...]` tags in rationale
9. `shouldAlert()` → Telegram if conviction clears threshold

### LLM router
`src/lib/llm/router.ts`:
- Supports 11+ providers (Pollinations, Gemini, Groq, NVIDIA NIM, Mistral, OpenRouter, …)
- `completeWithAutoFallback()` — tries the requested provider, falls back through all active providers by reliability priority
- Multi-key rotation (newline-separated keys, 60s cooldown on 429)
- Uses `node:https` (not fetch) to bypass Next.js fetch patching + Cloudflare bot detection

### Brain control API
`src/app/api/brain/route.ts`:
- `GET` → full snapshot (running, mode, config, budget, llm, thinking, stats, samples, tuneEvents, watch, recentActions)
- `POST` → `{action: pause|resume|setMode|setConfig|forceRun|resetBudget, ...}`

### Signal feed badges
`src/components/signals/SignalsFeedClient.tsx` → `parseTrigger()`:
- Parses `[trigger:manual|news|cross-asset]` → "Triggered by" badge (color-coded)
- Parses `[vol-target:X% rv:Y%]` → vol-target badge (Target icon, emerald)

---

## 6. Database schema (Prisma — 15 models)

Key models in `prisma/schema.prisma`:

- **LlmProvider** — name, baseUrl, apiKey (multi-key), isActive
- **LlmModel** — modelId, displayName, contextWindow, freeTierRpm
- **ModuleModelConfig** — maps (moduleKey, layer) → provider+model+temperature
- **Asset** — symbol, name, assetClass, exchange, meta (JSON)
- **Signal** — direction, conviction, layersSummary (JSON), entryPrice/stopLoss/takeProfit, rationale, status, expiresAt
- **SignalOutcome** — grade (correct|wrong|partial), pnlPct, actual direction
- **ScheduleJob** — moduleKey, cronExpr, enabled, lastRunAt
- **Setting** — key-value KV store (brain state, telegram, thresholds, etc.)

JSON fields stored as `String` (TEXT) — parsed via `JSON.parse()`. Keeps schema identical across SQLite + PostgreSQL.

---

## 7. Getting started (restore steps)

1. **Re-overlay the Omniscient source** from the original tarball (`omniscient-hf-spaces.tar.gz`, was in `upload/`) into the project root.
2. **Install deps:** `bun install`
3. **Push DB:** `bun run db:push` (creates `db/custom.db`)
4. **Seed:** `bun run src/lib/db/seed.ts` then `bun run src/lib/db/seed-markets.ts`
   - The seed creates Pollinations as the ACTIVE default LLM (free, no key), enables `crypto_technical` job, wires module configs → Pollinations/openai.
5. **Start dev:** `bun run dev` (port 3000) — use the subshell-double-fork pattern `(next dev &)` to survive across shell exits.
6. **Start scheduler:** `cd mini-services/scheduler && bun --hot index.ts` (port 3042)
7. **Login:** password `omniscient` (change in Settings → Security)

---

## 8. Development worklog summary (13 rounds)

| Task | What was done |
|------|---------------|
| 0 | Bootstrap: overlay Omniscient, install, push DB, seed, start dev |
| 1 | Build the Lazy Brain (state, engine, gate), wire Pollinations, control panel UI |
| 2 | End-to-end verification (agent-browser), enable crypto_technical job, fix LLM-failure back-off |
| 3 | QA + global LLM circuit-breaker (thundering-herd fix), self-tuning thresholds, cross-asset triggers, UI polish |
| 4 | Brain status card on dashboard, autonomy log in action feed, free on-chain data source (blockchain.info) |
| 5 | News-event triggers (keyword RSS), token-economy timeline sparkline, hot-reload migration fix |
| 6 | "Triggered by" traceability on signals (trigger source stamped in rationale), brain header elevation |
| 7 | GitHub dev-activity data source (commit count + 7d delta), trigger-stats tile, FreeSignalsCard 5-column |
| 8 | Dashboard visual cohesion (emerald palette), FreeSignalsCard freshness timestamps, global footer brain indicator |
| 9 | Watch-list action icons, dev-activity delta trend, self-tune history chart |
| 10 | "Brain thinking" live indicator (animated waveform), every-tick news triggers (5-min RSS cache), watch-icon tooltips |
| 11 | Fix tokensSaved double-count bug, trigger-breakdown donut, thinking-waveform contrast |
| 12 | On-chain hashrate-trend consensus layer, cumulative-saved area chart, donut hover interactivity |
| 13 | **PDF implementation:** E1 vol-targeting, E3 cointegration, E9 triple-barrier + DSR, E10 Hurst, E4 derivatives-v2, E8 asymmetric F&G |

---

## 9. Next-phase recommendations (priority order)

1. **Wire E9 triple-barrier into grading.ts** — replace the fixed-24h `evaluate()` with `tripleBarrierLabel()`. Risk: changes the self-tuning feedback loop. Re-validate analytics after.
2. **Wire E10 Hurst as a cointegration filter** — skip pairs trades when spread Hurst > 0.55. Module ready (`classifyRegime()`).
3. **Add cointegration view to /correlation page** — API exists (`/api/analysis/cointegration`), UI needs a tab/toggle.
4. **Add E6 (FRED leading macro)** — DXY momentum, 10yr TIPS, VIX term structure, HYG/LQD, Fed Net Liquidity. Needs free FRED key.
5. **Add E5 (CryptoQuant onchain-v2)** — exchange netflow + stablecoin flow + STH-SOPR. Needs free CryptoQuant account.
6. **Add E11 risk stack** — correlation-aware sizing, fractional-Kelly ceiling, drawdown deleveraging. Needs `pnlR` + `equityCurve` schema fields.
7. **E9 DSR gate on backtest** — `deflatedSharpeRatio()` is ready. Add hard gate: reject strategies with DSR < 0.95. This tests whether current signals have genuine positive expectancy (the PDF's "start here").

---

## 10. Honest assessment (from the PDF, applied here)

> "No risk management or signal layering technique creates alpha. They only stop
> you from destroying or mis-loading the edge you have. If your signals are
> noise, fix that first."

The Lazy Brain's token economy is proven (3× savings, fully lazy on calm
markets). The edge modules (E1/E3/E4/E8/E9/E10) are research-backed and verified
live. But the **next critical step is E9's DSR gate** — run the current signal
history through `deflatedSharpeRatio()`. If DSR < 0.5, the signals are noise and
no amount of risk management will help; fix signal quality first. If DSR ≥ 0.5,
proceed through the roadmap.

The free stack works with zero API keys. Adding a FRED key + CryptoQuant account
+ optional GitHub token unlocks E5/E6 and raises the dev-activity rate limit.
