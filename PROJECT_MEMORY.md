last_updated: 2026-06-23T20:35:00Z
turn_count: 2
last_commit: 7b3c0e1
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
[x] G1 Telegram test route — VERIFIED — proof: /api/telegram/test returns JSON 200
[x] G2 Scheduler sends ?alerts=1 on every tick — VERIFIED — confirmed in mini-services/scheduler/index.ts line 41
[x] G3 Oil/forex/macro fallback chain — VERIFIED in macro/quotes/route.ts
[x] G4 IPO/News/EconCalendar ZAI replacement — VERIFIED — news: 50 articles via RSS, IPO: 10+10 via ZAI+503 fallback, econ: 10 events via ZAI+502 fallback
[ ] G5 CRON_SECRET — confirm identical value in both deployed environments; prove a real tick returns 200 with non-empty ran array
[ ] G6 news_sentiment 401 — identify which provider resolveModel() picks, fix/replace its key, confirm completeWithAutoFallback falls through on 401
[ ] G7 Decide + implement or descope non-crypto module dispatch; news_sentiment + macro_analysis seeded enabled:false
[ ] G8 Verify klines→Hurst/divergence/trap wiring didn't shift conviction scores — before/after on 3+ assets
[ ] G9 Watchlist price loading — verify every DB symbol resolves to real price
[ ] G10 Full regression pass

NEWLY_DISCOVERED
- OPEN: klines is NOT being passed to computeConsensus in scheduler/tick/route.ts (lines 116-119, 226-231). Prior session claimed to fix but code wasn't changed. Need G8 to resolve.
- OPEN: Dev server dies between tool calls — sandbox reaps background processes.

DO_NOT_RE_ATTEMPT
- None yet.
