# OMNISCIENT — Global Market Intelligence System

A 24/7 AI-powered market-intelligence dashboard that analyzes crypto, forex, stocks, indices, commodities, and macro indicators. It uses a multi-provider LLM router to generate trading signals, runs a self-learning grading loop, and features the **Lazy Brain** — an autonomous orchestration layer that applies ponytail's ladder to token usage, keeping a free-tier stack alive without hitting rate limits.

## What makes this different

- **The Lazy Brain** — instead of running the full LLM pipeline on every asset every tick, the brain decides *whether* and *how deeply* to consult the LLM per asset. It skips when the deterministic math is unanimous, reuses cached verdicts when data is unchanged, and only spends tokens when something noteworthy is happening. Result: 3× token savings on a free stack.
- **7 Edge Modules** from "Field Guide to Real Edge (Vol. 2)" — research-backed signal layers with published evidence: vol-targeting position sizing, cointegration pairs trading, derivatives intelligence (basis + skew + VRP), triple-barrier labeling, Deflated Sharpe Ratio, Hurst exponent regime filter, asymmetric Fear & Greed.
- **5 Free Data Sources** — CoinGecko trending, blockchain.info on-chain stats, GitHub dev-activity, Reddit sentiment, Deribit options. Zero API keys needed.
- **Zero-Config Start** — Pollinations (free LLM, no key) is seeded as the default active provider. The app works out of the box.

## Quick Start

```bash
bun install                      # Install dependencies
bun run db:push                  # Create SQLite database
bun run src/lib/db/seed.ts       # Seed providers + crypto assets + module configs
bun run dev                      # Start dev server (port 3000)
cd mini-services/scheduler && bun --hot index.ts  # Start scheduler (port 3042)
```

**Login password:** `omniscient` (change in Settings → Security)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Database | Prisma 6 ORM (SQLite dev / PostgreSQL prod) |
| State | @tanstack/react-query 5 |
| Charts | recharts + custom inline-SVG sparklines |
| Auth | Custom middleware (httpOnly cookie) |
| Runtime | Bun |
| Scheduler | Bun mini-service (port 3042) |

## Architecture

```
Browser → Next.js → API Routes → Prisma → SQLite
                    ↘ External APIs (Binance, Yahoo, CoinGecko, Deribit, Pollinations)
                    ↘ Lazy Brain (gate: budget→YAGNI→cache→cadence→analyze)
                    ↘ Scheduler (60s tick → grading → scan → triggers → self-tune)
```

## The 32 Pages

| Page | Description |
|------|-------------|
| `/` | Overview — dashboard with live prices, gainers/losers, Fear & Greed, brain status |
| `/brain` | The Lazy Brain — control panel with token economy, watch list, gate config, edge sources |
| `/crypto` | Crypto market — live Binance prices |
| `/crypto/[symbol]` | Crypto detail — chart, indicators, orderbook, funding |
| `/markets` | Multi-asset — forex, stocks, indices, commodities |
| `/markets/[symbol]` | Asset detail — chart, indicators, analysis |
| `/heat-map` | Market heat map — color-coded performance grid |
| `/correlation` | Correlation matrix — Pearson + cointegration |
| `/screener` | 14-filter scanner |
| `/signals` | Signal feed — direction, conviction, trigger-source + vol-target badges |
| `/derivatives` | Funding rates + OI + E4 derivatives-v2 regime |
| `/multi-timeframe` | 1h/4h/1d confluence scoring |
| `/price-alerts` | User-defined threshold alerts |
| `/portfolio` | Holdings tracker with P&L |
| `/risk-calculator` | Position sizing, leverage, liquidation |
| `/backtest` | Historical strategy backtesting |
| `/strategy-builder` | Visual strategy builder |
| `/analytics` | Model accuracy dashboard |
| `/news` | RSS + web search news with LLM sentiment |
| `/macro` | DXY, VIX, Gold, Oil, S&P500, Fear & Greed |
| `/economic-calendar` | Upcoming economic events |
| `/ipo-ico` | Upcoming IPOs and ICOs |
| `/notifications` | Unified activity feed |
| `/reports` | Daily/weekly/monthly reports |
| `/settings/*` | 6 settings sub-pages (providers, alerts, security, data, watchlists, supabase) |

## The Lazy Brain — How It Works

The brain governs whether and how deeply the LLM is consulted per asset per tick. It never silences a real signal — the deterministic consensus always runs.

### The Gate (ponytail's ladder applied to token usage)

1. **Budget** — if the rolling token budget is exhausted → skip LLM
2. **YAGNI** — if the deterministic consensus is unanimous + high-conviction → skip LLM
3. **Cache** — if the market-data fingerprint is unchanged → reuse the last verdict
4. **Cadence** — if nothing noteworthy + recently analyzed → skip
5. **Minimum** — only then call the LLM (tier 1 triage / tier 2 deep)

### Autonomous Features

- **Self-tuning** — reads recent SignalOutcome grades, nudges gate thresholds toward better calibration
- **Cross-asset triggers** — BTC/ETH volatile → re-analyze correlated alts
- **News-event triggers** — RSS keyword scan (hack/ETF/SEC) → force-run mentioned assets
- **LLM circuit-breaker** — global cooldown (30s→60s→120s) on 429, prevents thundering-herd
- **Token economy** — tracks tokens used vs saved, with timeline sparkline + trigger-breakdown donut

## Edge Modules (from Field Guide to Real Edge, Vol. 2)

| Module | Evidence | Impact |
|--------|----------|--------|
| E1 Vol-targeting | Moreira-Muir 2017 (JF) | +0.15-0.30 Sharpe |
| E3 Cointegration | Yale (Zhu 2024) | Sharpe 0.7-1.3 on pairs |
| E4 Derivatives-v2 | Alexander-Imeraj 2021 | Regime confirmation |
| E8 Asymmetric F&G | Milk Road + ScienceDirect | +0.05-0.10 Sharpe |
| E9 Triple-Barrier | López de Prado 2018 | Capital preservation |
| E9 Deflated Sharpe | Bailey-LdP 2014 | Reject overfit strategies |
| E10 Hurst exponent | MDPI 2024 | Regime filter |

## Configuration

All LLM API keys + settings are stored in the database (Setting KV table), configurable via the Settings UI. No environment variables needed for API keys.

**Environment variables:**
- `DATABASE_URL` — SQLite path (default: `file:/home/z/my-project/db/custom.db`)
- `APP_PASSWORD` — Login password (default: `omniscient`)

## License

MIT
