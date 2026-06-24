last_updated: 2026-06-24T04:10:00Z
turn_count: 4
last_commit: 00a3119
CAPABILITY_CHECK
file_io: yes | terminal: yes | git: yes | network: yes

HANDBOOK
- Never wrap a known-broken call in try/catch returning empty/default. ipo-ico/route.ts webSearch() is the canonical example of what NOT to do.
- Never remove a rung from an existing fallback chain (Yahoo→Binance, multi-source, LLM auto-fallback) — only add.
- Don't touch gateDecide() thresholds or deterministic consensus math unless a goal requires it.
- No schema migrations unless a goal requires one.
- z-ai-web-dev-sdk has no reachable backend outside this sandbox — replace with a real free source, don't silence errors.
- CRON_SECRET must be identical on main app env and scheduler mini-service env.
- ?alerts=1 must be in the scheduler tick URL or sendAlerts is always false.
- Supabase sync MUST resolve local cuid IDs to Supabase IDs before upserting FK tables (LlmModel, ModuleModelConfig).

GOALS_LEDGER
[x] G1 Telegram test route — VERIFIED — proof: POST /api/telegram/test returns JSON
[x] G2 Scheduler sends ?alerts=1 — VERIFIED — confirmed in mini-services/scheduler/index.ts
[x] G3 Oil/forex/macro fallback chain — VERIFIED — macro/quotes returns gold price
[x] G4 IPO/News/EconCalendar — VERIFIED — news: 50 articles, IPO: 10+10, econ: 10 events
[x] G5 CRON_SECRET + tick — VERIFIED — POST tick → 200, ran=[crypto_technical/11 assets]
[x] G6 news_sentiment 401 — VERIFIED — extractJsonArray now wraps single objects; analyzed:true
[x] G7 Non-crypto module dispatch — VERIFIED (DESCOPED) — intentionally disabled
[B] G8 klines wiring — BLOCKED — materially changes conviction scores; needs user review
[x] G9 Watchlist prices — VERIFIED — 11/11 assets with real prices
[x] G10 Full regression pass — VERIFIED — no regressions
[x] G11 Supabase sync FK violations — VERIFIED — sync now resolves local IDs to Supabase IDs for LlmModel + ModuleModelConfig

NEWLY_DISCOVERED
- OPEN: klines is NOT being passed to computeConsensus in scheduler/tick/route.ts. BLOCKED pending user review.
- OPEN: Dev server dies between tool calls — sandbox reaps background processes.

DO_NOT_RE_ATTEMPT
- CryptoCompare news API requires key now (401). Don't try again.
- CoinGecko /v3/news requires PRO subscription. Don't try again.
- Finnhub news returns "Invalid API key" with demo token. Don't try again.
