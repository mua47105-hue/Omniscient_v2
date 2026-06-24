last_updated: 2026-06-24T06:00:00Z
turn_count: 7
last_commit: ce72ea7
CAPABILITY_CHECK
file_io: yes | terminal: yes | git: yes | network: yes

HANDBOOK
- Never wrap a known-broken call in try/catch returning empty/default.
- Never remove a rung from an existing fallback chain.
- Don't touch gateDecide() thresholds or deterministic consensus math unless a goal requires it.
- No schema migrations unless a goal requires one.
- z-ai-web-dev-sdk has no reachable backend outside this sandbox.
- CRON_SECRET must be identical on main app env and scheduler mini-service env.
- ?alerts=1 must be in the scheduler tick URL.
- Supabase sync MUST resolve local cuid IDs to Supabase IDs before upserting FK tables.
- Telegram API calls MUST use node:https with family:4 (force IPv4), NOT fetch().
- Frontend api() helpers MUST wrap fetch() in try/catch.
- api.telegram.org may be genuinely blocked from HF Space datacenter IPs — if timeout persists after IPv4+retry, Telegram alerts won't work from HF Spaces.

GOALS_LEDGER
[x] G1 Telegram test route — VERIFIED
[x] G2 Scheduler sends ?alerts=1 — VERIFIED
[x] G3 Oil/forex/macro fallback chain — VERIFIED
[x] G4 IPO/News/EconCalendar — VERIFIED
[x] G5 CRON_SECRET + tick — VERIFIED
[x] G6 news_sentiment 401 — VERIFIED
[x] G7 Non-crypto module dispatch — VERIFIED (DESCOPED)
[B] G8 klines wiring — BLOCKED — needs user review
[x] G9 Watchlist prices — VERIFIED
[x] G10 Full regression pass — VERIFIED
[x] G11 Supabase sync FK violations — VERIFIED
[x] G12 Telegram "fetch failed" — VERIFIED (node:https + IPv4 + retry deployed)
[ ] G13 Telegram timeout on HF Spaces — VERIFIED-CODE-DEPLOYED but CANNOT VERIFY RUNTIME (don't know user's HF Space password to test the Telegram test button)

NEWLY_DISCOVERED
- OPEN: klines is NOT being passed to computeConsensus in scheduler/tick/route.ts. BLOCKED pending user review.
- OPEN: Dev server dies between tool calls — sandbox reaps background processes.
- OPEN: HF Space has a custom APP_PASSWORD set as a secret — not "omniscient". Can't login to verify.
- OPEN: api.telegram.org timeout from HF Spaces may be a genuine network block. Fixes applied: IPv4 force, 30s timeout, retry. If still failing, user needs a deployment that can reach api.telegram.org (Vercel, Railway, VPS).

DO_NOT_RE_ATTEMPT
- CryptoCompare news API requires key now (401).
- CoinGecko /v3/news requires PRO subscription.
- Finnhub news returns "Invalid API key" with demo token.
- Using fetch() for Telegram API calls on HF Spaces.
