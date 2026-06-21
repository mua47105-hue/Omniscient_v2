# OMNISCIENT — Developer Guide

This document is for developers continuing work on the OMNISCIENT project. It covers the architecture, file structure, key integration points, and how to extend the system.

## 1. Project Structure

```
src/
├── app/                           # Next.js App Router
│   ├── api/                       # 44 API routes (all return {success, data?, error?})
│   │   ├── brain/route.ts         # Brain control: GET snapshot, POST pause/resume/forceRun
│   │   ├── scheduler/tick/route.ts# Brain main loop (grading → scan → triggers → tune)
│   │   ├── analysis/              # Edge module APIs (cointegration, derivatives-v2, F&G)
│   │   ├── crypto/                # Binance data (prices, klines, orderbook, movers, scan, trending)
│   │   ├── markets/               # Yahoo multi-asset (quotes, scan, heatmap)
│   │   ├── macro/                 # Fear&Greed, global stats, quotes
│   │   ├── onchain/stats/         # blockchain.info hashrate/tx/difficulty
│   │   ├── devactivity/           # GitHub commit count per repo
│   │   ├── sentiment/reddit/      # Reddit word-count sentiment
│   │   ├── signals/               # GET signals, POST grade
│   │   ├── analytics/models/      # Model accuracy aggregation
│   │   ├── auth/                  # login, logout (httpOnly cookie)
│   │   ├── settings/              # GET/POST settings KV
│   │   ├── llm/                   # providers, models, module-configs CRUD
│   │   ├── portfolio/             # Holdings CRUD
│   │   ├── price-alerts/          # CRUD + check
│   │   ├── watchlists/            # CRUD
│   │   ├── news/                  # RSS + web_search + LLM analyze
│   │   ├── reports/               # GET/POST
│   │   ├── notifications/         # Unified feed
│   │   ├── economic-calendar/     # Economic events
│   │   ├── ipo-ico/               # IPO/ICO listings
│   │   ├── telegram/test/         # Test alert delivery
│   │   └── setup/                 # System status
│   ├── [32 page routes]           # Each page.tsx imports a *Client component
│   ├── layout.tsx                 # Inter + JetBrains Mono fonts, dark theme, Providers
│   ├── globals.css                # Tailwind 4 + CSS variables (dark theme)
│   └── middleware.ts              # Auth gate (redirects to /lock)
│
├── components/
│   ├── brain/                     # Lazy Brain UI (9 components)
│   │   ├── BrainPanel.tsx         # Main /brain page (scoreboard, watch list, gate config, charts)
│   │   ├── BrainStatusCard.tsx    # Dashboard banner (autonomous status + sparkline)
│   │   ├── ThinkingIndicator.tsx  # Animated waveform during ticks
│   │   ├── TriggerBreakdown.tsx   # Interactive donut (news/cross-asset/manual)
│   │   ├── Sparkline.tsx          # Inline-SVG used-vs-saved timeline
│   │   ├── SavedAreaChart.tsx     # Cumulative tokens-saved area chart
│   │   ├── EdgeSourcesCard.tsx    # E4 derivatives regime + E8 asymmetric F&G
│   │   ├── FreeSignalsCard.tsx    # 5 free sources (CoinGecko/F&G/Reddit/On-Chain/Dev)
│   │   └── FooterBrainIndicator.tsx # Global footer brain-health
│   ├── dashboard/                 # Overview, StatCard, AssetTable, LiveTickerBar
│   ├── signals/                   # Signal feed with trigger + vol-target badges
│   ├── layout/                    # AppShell, Sidebar, Header, Footer, MobileNav
│   ├── auth/                      # LockClient (login)
│   ├── crypto/, markets/, macro/, news/, settings/, portfolio/, etc.
│   ├── providers.tsx              # QueryClientProvider + ThemeProvider
│   └── ui/                        # 30 shadcn/ui components (New York style)
│
├── lib/
│   ├── brain/                     # Lazy Brain engine
│   │   ├── state.ts               # In-memory singleton (running, config, watch, stats, budget, triggers, samples, tuneEvents)
│   │   ├── engine.ts              # computeNoteworthiness, classifyRegime, dataSignature, gateDecide
│   │   ├── selftune.ts            # Self-tuning thresholds from grading feedback
│   │   ├── triggers.ts            # Cross-asset triggers (BTC/ETH → correlated alts)
│   │   ├── news-triggers.ts       # News-event triggers (RSS keyword scan, 5-min cache)
│   │   └── types.ts               # BrainConfig, AssetWatch, BrainStats, etc.
│   ├── analysis/                  # Edge modules + existing analysis
│   │   ├── consensus.ts           # 7-layer weighted fusion + onchain-trend layer
│   │   ├── cointegration.ts       # E3 Engle-Granger ADF + half-life + z-score (own OLS)
│   │   ├── triple-barrier.ts      # E9 López de Prado triple-barrier labeling
│   │   ├── deflated-sharpe.ts     # E9 DSR + moments + verdict
│   │   ├── hurst.ts               # E10 DFA-based Hurst exponent regime filter
│   │   ├── fear-greed-edge.ts     # E8 asymmetric F&G (momentum vs mean-revert)
│   │   ├── grading.ts             # Self-learning loop (grades expired signals)
│   │   ├── correlation.ts         # Pearson matrix + OLS regression
│   │   └── price-alerts.ts        # User alert threshold checking
│   ├── risk/
│   │   └── vol_targeting.ts       # E1 vol-targeting position sizing
│   ├── market/
│   │   ├── binance.ts             # REST client (klines, ticker, orderbook, funding, OI)
│   │   ├── macro.ts               # Yahoo, Fear&Greed, CoinGecko global, er-api forex
│   │   ├── coingecko.ts           # Trending + top markets
│   │   ├── onchain.ts             # blockchain.info + hashrate-trend tracker
│   │   ├── reddit.ts              # Word-count sentiment (graceful 403)
│   │   ├── devactivity.ts         # GitHub commit count + 7d delta
│   │   ├── deribit.ts             # E4 Deribit options (DVOL, skew) + Binance Coin-M basis
│   │   └── indicators.ts          # Pure-TS RSI/MACD/EMA/Bollinger/VWAP/ATR
│   ├── llm/
│   │   ├── router.ts              # Multi-provider + auto-fallback + multi-key rotation
│   │   └── prompts.ts             # System prompts per analysis module
│   ├── config/settings.ts         # Setting KV wrapper + SETTING_KEYS
│   ├── alerts/telegram.ts         # Telegram alert delivery
│   ├── db.ts                      # Prisma singleton (schema-hash-aware, hot-reload-safe)
│   ├── db/seed.ts                 # Seeds Pollinations + crypto assets + module configs
│   ├── types.ts                   # Shared TS types
│   └── utils.ts                   # cn() helper
│
├── hooks/                         # use-mobile, use-toast, useLiveTicker
└── middleware.ts                  # Auth gate
```

## 2. The Lazy Brain — Architecture Deep Dive

### State Management (`src/lib/brain/state.ts`)

The brain state lives in-memory on `globalThis` (survives Next.js hot reloads). Control flags (running/mode/config) are persisted to the Setting KV table.

**Key state fields:**
- `running` / `mode` — pause/resume + auto/manual
- `config` — gate thresholds (minNoteworthiness, highNoteworthiness, unanimousConviction, etc.)
- `watch: Map<symbol, AssetWatch>` — per-asset verdict, noteworthiness, regime, last action
- `stats` — ticksTotal, llmCallsTotal, tokensUsed, tokensSaved, cacheHits, budgetSkips, triggers
- `forceRunQueue: Map<symbol, source>` — manual/news/cross-asset override queue
- `statsSamples` — ring buffer (capped 120) for the token-economy sparkline
- `tuneEvents` — ring buffer (capped 50) for self-tune history

**Hot-reload safety:** The `state()` function has migration guards that check BOTH existence AND type. When a field's type changes (e.g. Set→Map), the guard replaces it. Nested stats fields need their own guards.

### The Gate (`src/lib/brain/engine.ts`)

`gateDecide(input)` returns the first rung that holds:
1. Budget exhausted → skip (free-tier safety net)
2. Deterministic consensus unanimous + high-conviction → skip (YAGNI)
3. Data signature unchanged → cache (reuse verdict)
4. Not noteworthy + recently analyzed → skip (cadence)
5. Otherwise → analyze (tier 1 triage / tier 2 deep)

### The Scheduler Tick (`src/app/api/scheduler/tick/route.ts`)

The brain's main loop, called every 60s by the mini-service:

1. `tickStarted()` — mark tick in progress
2. `gradeExpiredSignals()` — self-learning: close yesterday's signals with P&L
3. `checkPriceAlerts()` — user thresholds
4. `runForcedAnalysis()` — process force-run queue (manual override, works even when paused)
5. `checkNewsTriggers()` — every-tick RSS scan for breaking news
6. For each due ScheduleJob: `runCryptoScan()` → per-asset `analyzeAsset()`
7. `checkCrossAssetTriggers()` — BTC/ETH volatile → queue correlated alts
8. `selfTune()` — nudge gate thresholds from grading feedback
9. `recordSample()` — snapshot token economy for sparkline
10. `tickEnded()`

### `analyzeAsset()` — The Per-Asset Pipeline

1. Fetch klines/orderbook/funding/ticker (Binance, parallel)
2. `computeIndicators(klines)` → RSI/MACD/EMA/Bollinger/VWAP/ATR
3. `getOnchainTrend()` → BTC hashrate trend (fundamental layer)
4. `computeConsensus()` → 7-layer weighted fusion (deterministic, FREE)
5. `gateDecide()` → skip/cache/analyze
6. If analyze: build prompt (triage/deep), `completeWithAutoFallback()`, `safeParseJson()`
7. `volTargetSize()` → E1 position sizing
8. Stamp `[trigger:SOURCE]` + `[vol-target:X% rv:Y%]` in signal rationale
9. `db.signal.create()` → save signal
10. `shouldAlert()` → Telegram if conviction clears threshold

## 3. Edge Modules

All edge modules are pure TypeScript with no external dependencies. They implement research-backed trading techniques from "Field Guide to Real Edge (Vol. 2)".

| Module | File | What it does |
|--------|------|-------------|
| E1 Vol-targeting | `src/lib/risk/vol_targeting.ts` | Size positions inversely to realized vol |
| E3 Cointegration | `src/lib/analysis/cointegration.ts` | Engle-Granger ADF test for tradeable spreads |
| E4 Derivatives-v2 | `src/lib/market/deribit.ts` | Basis + 25Δ skew + VRP → CAPITULATION/EUPHORIA regime |
| E8 Asymmetric F&G | `src/lib/analysis/fear-greed-edge.ts` | Momentum-long on greed streaks (opposite of equities) |
| E9 Triple-Barrier | `src/lib/analysis/triple-barrier.ts` | TP/SL/timeout labeling for backtest |
| E9 Deflated Sharpe | `src/lib/analysis/deflated-sharpe.ts` | Multiple-testing correction for Sharpe |
| E10 Hurst | `src/lib/analysis/hurst.ts` | DFA-based regime filter (mean-revert vs trending) |

## 4. LLM Router

`src/lib/llm/router.ts` supports 11+ providers with automatic fallback:
- Priority: Pollinations (free) → Groq → NVIDIA NIM → Mistral → OpenRouter → Gemini
- Multi-key rotation: paste multiple API keys (newline-separated), router rotates + applies 60s cooldown on 429
- Uses `node:https` (not fetch) to bypass Next.js fetch patching + Cloudflare bot detection
- `completeWithAutoFallback()` tries the requested provider, falls back through all active providers

## 5. Database Schema

15 Prisma models in `prisma/schema.prisma`. JSON fields stored as `String` (TEXT) — parsed via `JSON.parse()`. Keeps schema identical across SQLite + PostgreSQL.

Key models: LlmProvider, LlmModel, ModuleModelConfig, Asset, Signal, SignalOutcome, ScheduleJob, Setting.

## 6. Adding a New Analysis Layer

1. Create the analysis function in `src/lib/analysis/your-module.ts`
2. Add it as a layer in `src/lib/analysis/consensus.ts` (`buildYourLayer()` + push to `layers[]` in `computeConsensus()`)
3. Add the weight to `LAYER_WEIGHTS`
4. If it needs data, create a client in `src/lib/market/` + an API route in `src/app/api/`
5. If it needs UI, add a card to `src/components/brain/` + import in BrainPanel

## 7. Development Worklog

See `worklog.md` for the complete development history (14 rounds), including what was built, bugs found + fixed, and next-phase recommendations.
