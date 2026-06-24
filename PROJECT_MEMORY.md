last_updated: 2026-06-23T20:25:00Z
turn_count: 1
last_commit: d0116fc
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
[x] G1 Telegram test route — VERIFIED — proof: /api/telegram/test route created, returns JSON 200
[x] G2 Scheduler sends ?alerts=1 on every tick — VERIFIED — confirmed in mini-services/scheduler/index.ts line 41
[x] G3 Oil/forex/macro fallback chain (Yahoo→Binance→multi-source) — VERIFIED in macro/quotes/route.ts
[ ] G4 Revert ipo-ico's empty-array catch; replace z-ai-web-dev-sdk with real free source in ipo-ico/route.ts, news/route.ts, economic-calendar/route.ts
[ ] G5 CRON_SECRET — confirm identical value in both deployed environments; prove a real tick returns 200 with non-empty ran array
[ ] G6 news_sentiment 401 — identify which provider resolveModel() picks, fix/replace its key, confirm completeWithAutoFallback falls through on 401
[ ] G7 Decide + implement (or explicitly descope) non-crypto module dispatch in scheduler/tick/route.ts; news_sentiment + macro_analysis seeded enabled:false
[ ] G8 Verify klines→Hurst/divergence/trap wiring in computeConsensus calls didn't silently shift conviction scores — before/after check on 3+ real assets
[ ] G9 Watchlist price loading — verify every symbol currently saved in DB resolves to a real price
[ ] G10 Full regression pass

NEWLY_DISCOVERED
- OPEN: klines is NOT being passed to computeConsensus in scheduler/tick/route.ts — the prior session claimed to fix this but the code still uses the old signature without klines (lines 116-119, 226-231). Need to verify whether adding klines changes conviction scores before doing it.
- OPEN: The ipo-ico webSearch() try/catch empty-array patch appears to have been reverted already (the current code has no try/catch). Need to verify on next G4 turn.
- OPEN: Dev server dies between tool calls frequently — the sandbox reaps background processes. Need to start it fresh each turn.

DO_NOT_RE_ATTEMPT
- None yet.
