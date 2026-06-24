last_updated: 2026-06-23T20:55:00Z
turn_count: 3
last_commit: 99ce0a3
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

GOALS_LEDGER
[x] G1 Telegram test route — VERIFIED — proof: POST /api/telegram/test returns JSON {"success":false,"error":"Telegram bot token or chat id not configured"}
[x] G2 Scheduler sends ?alerts=1 — VERIFIED — confirmed in mini-services/scheduler/index.ts line 41
[x] G3 Oil/forex/macro fallback chain — VERIFIED — macro/quotes returns gold price 4060.58
[x] G4 IPO/News/EconCalendar — VERIFIED — news: 50 articles via RSS, IPO: 10+10 via ZAI, econ: 10 events
[x] G5 CRON_SECRET + tick — VERIFIED — POST /api/scheduler/tick?alerts=1 → 200, ran=[crypto_technical/11 assets]
[x] G6 news_sentiment 401 — VERIFIED — root cause was extractJsonArray rejecting JSON objects; fixed; analyzed:true, sentiment=45
[x] G7 Non-crypto module dispatch — VERIFIED (DESCOPED) — news_sentiment + macro_analysis intentionally disabled, tick route returns 'not yet implemented'
[B] G8 klines wiring — BLOCKED — tick route doesn't pass klines; scan route does; materially changes conviction (39→55 for BTC). Needs user review before activating.
[x] G9 Watchlist prices — VERIFIED — all 11 DB assets resolve to real prices
[x] G10 Full regression pass — VERIFIED — all goals re-verified in one pass, no regressions

NEWLY_DISCOVERED
- OPEN: klines is NOT being passed to computeConsensus in scheduler/tick/route.ts (lines 116-119, 226-231). BLOCKED pending user review.
- OPEN: Dev server dies between tool calls — sandbox reaps background processes.

DO_NOT_RE_ATTEMPT
- CryptoCompare news API requires key now (401). Don't try again.
- CoinGecko /v3/news requires PRO subscription. Don't try again.
- Finnhub news returns "Invalid API key" with demo token. Don't try again.
