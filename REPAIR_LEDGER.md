# OMNISCIENT v2 — REPAIR LEDGER

## Session: 2026-06-23

---

### G1 — Scheduler tick actually authenticates and runs
Status: OPEN
Root cause: CRON_SECRET is not set in the dev environment (no .env file). The middleware requires CRON_SECRET (min 8 chars) for the scheduler to authenticate. Without it, the scheduler's tick POST gets 401. Additionally, the scheduler URL does NOT include ?alerts=1 — the previous commit claimed to fix this but the code was never changed.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G2 — Crypto brain produces real signals end-to-end
Status: OPEN
Root cause: Need to verify signals are being created in the DB via the tick route.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G3 — Alerts actually fire
Status: OPEN
Root cause: ?alerts=1 is NOT in the scheduler URL (confirmed: grep finds zero matches). sendAlerts is always false in production. Even if it were true, need to verify shouldAlert() threshold against real conviction values.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G4 — Telegram test button works
Status: OPEN
Root cause: /api/telegram/test route exists (created in prior session). Need to verify it actually works with real Telegram config.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G5 — IPO/ICO, news, and economic-calendar routes have a real data source
Status: OPEN
Root cause: webSearch() in ipo-ico/route.ts was patched with try/catch returning [] — this is a symptom patch (banned). Need to verify ZAI SDK works or replace with a real data source. Also check news and economic-calendar routes.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G6 — Gold/oil/forex price data survives Yahoo rate-limiting
Status: OPEN
Root cause: /api/macro/quotes has multi-source fallback wired in (prior session). Need to verify it actually works when Yahoo 429s.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G7 — Watchlists load real prices for every symbol currently saved in the DB
Status: OPEN
Root cause: Need to verify all DB assets have working price fetches via Binance multi-host fallback.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G8 — News-sentiment 401 resolved
Status: OPEN
Root cause: Need to verify which provider resolveModel('news_sentiment','sentiment') resolves to and whether completeWithAutoFallback falls through on 401.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G9 — Decide and implement non-crypto module dispatch, or explicitly descope it
Status: OPEN
Root cause: scheduler/tick/route.ts only dispatches crypto_technical. news_sentiment and macro_analysis jobs are seeded enabled:false. Need to decide: implement or descope.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G10 — klines/Hurst-divergence-trap wiring verified safe
Status: OPEN
Root cause: Prior session added klines to computeConsensus calls in tick route, but checking the ACTUAL code shows klines is NOT being passed — the calls still use the old signature without klines. The "fix" was claimed but never actually applied to the file. Need to verify whether adding klines changes conviction scores.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23

---

### G11 — Full regression pass
Status: OPEN
Root cause: Need to run all existing tests and verify no regressions.
Fix applied: (pending)
Proof: (pending)
Last checked: 2026-06-23
