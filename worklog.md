# OMNISCIENT — Autonomous Market Intelligence · Worklog

Project: Improving the "Omniscient" crypto/market intelligence app (uploaded as
`omniscient-hf-spaces.tar.gz`) with a ponytail-inspired autonomous brain +
token economy, more free data sources, and manual control. Deployed into the
`/home/z/my-project` Next.js 16 environment.

## Goals (user intent)
1. Move from a rigid "command-driven" scheduler (full pipeline + LLM on ALL
   assets every 15 min) to an **autonomous** system that decides what to
   analyze and how deeply — but stays manually controllable.
2. Apply **ponytail's ladder** to **token usage**: only spend an LLM call when
   it actually adds value. Skip when deterministic is unanimous, reuse cached
   verdicts when data is unchanged, tier the analysis, guard a token budget.
   Goal is "use only what's necessary" on a free stack to avoid rate limits.
3. Add more **free** data sources (Pollinations, CoinGecko, Reddit, GDELT).
4. Powerful + efficient, not fancy. Real edge.

## Plan / Phases
- Phase 0: Bootstrap — overlay Omniscient, install, push DB, seed, run.
- Phase 1: Free data source clients + wire Pollinations provider seed.
- Phase 2: The Lazy Brain engine (watch/triage/cache/budget/regime) + integrate
  into the scheduler tick (the core autonomy + token-economy improvement).
- Phase 3: Brain API + Autonomous Control Panel UI (pause/resume, force-run,
  token budget, live brain state, token-saved scoreboard).
- Phase 4: Lint, agent-browser verification, launch preview.
- Phase 5: 15-min webDevReview cron + handover notes.

---
Task ID: 0
Agent: main (bootstrap)
Task: Overlay Omniscient into /home/z/my-project, install deps, push DB, seed, start dev server, verify base app runs.

Work Log:
- Extracted uploaded tarball to /home/z/my-project/omniscient-inspect (read-only reference).
- Deep-read: PROJECT_GUIDE, package.json, prisma schema, LLM router, scheduler tick, consensus engine, settings KV, seed, middleware, layout, OverviewClient, prompts.
- Deep-read ponytail: AGENTS.md + skills/ponytail/SKILL.md (the ladder: YAGNI → stdlib → native → installed dep → one line → minimum-that-works; never cut trust-boundary validation, security, data-loss handling).
- Confirmed /home/z/my-project is an empty Next.js scaffold; Omniscient is a complete 22-page app on the same scaffold. Overlay is safe.
- (bootstrap steps recorded below as executed)

Stage Summary:
- Starting bootstrap overlay now.

Stage Summary (Task 0 — bootstrap COMPLETE):
- Omniscient source + prisma + scripts + mini-services + public + configs overlaid into /home/z/my-project.
- .env set: DATABASE_URL=file:/home/z/my-project/db/custom.db, APP_PASSWORD=omniscient.
- bun install OK (18 new packages incl @openrouter/sdk, @supabase/supabase-js).
- db:push + prisma generate OK. Both seeds ran (5 LLM provider templates, 11 crypto assets, forex/stocks/indices/commodities + 5 watchlists, 3 schedule jobs).
- Dev server started via subshell-double-fork `(next dev &)`, survives across tool calls on port 3000, pid 2275.
- Verified: / → 307 redirect to /lock (auth middleware works), /lock → 200, POST /api/auth/login {password:omniscient} → success, / (authed) → 200 dashboard, /api/crypto/prices → live Binance data (BTC $64,216).
- NOTE: Prisma `log:['query']` in db.ts floods dev.log — will reduce to ['error','warn'] during brain work.
- NOTE: middleware.ts triggers a deprecation warning (use "proxy" in Next 16) but still functions. Leaving as-is (not in scope).
- Base app is healthy. Moving to Phase 1 (free data sources) + Phase 2 (Lazy Brain).

---
Task ID: 1
Agent: main
Task: Build the Lazy Brain (autonomous orchestration + ponytail token economy), wire Pollinations free LLM, add free data sources, control panel UI.

Work Log:
- Created src/lib/brain/state.ts — in-memory brain singleton (running/mode/config/budget/stats/watch/forceRunQueue) on globalThis, persisted control flags to Setting KV.
- Created src/lib/brain/engine.ts — pure logic: computeNoteworthiness (7 free signals → 0-100), classifyRegime, dataSignature (cache fingerprint), gateDecide (ponytail ladder: budget→YAGNI-unanimous→cache→cadence→analyze-tiered).
- Rewrote src/app/api/scheduler/tick/route.ts — deterministic consensus FIRST (free), then the gate decides skip/cache/analyze per asset. Force-run queue processed every tick even when paused. Triage (tier 1, compressed prompt) vs deep (tier 2) tiers. safeParseJson (no jsonMode — Pollinations breaks on response_format). All safety layers (grading, price alerts, supabase sync) preserved.
- Created src/app/api/brain/route.ts — GET snapshot, POST control (pause/resume/setMode/setConfig/forceRun/resetBudget).
- Created src/app/brain/page.tsx + src/components/brain/BrainPanel.tsx — control panel: status/controls, token-economy scoreboard (used/saved/cache/skips), budget bar, asset watch list with per-asset force-run, action feed, gate-config sliders.
- Created src/components/brain/FreeSignalsCard.tsx — CoinGecko trending + Fear&Greed + Reddit sentiment (graceful when blocked).
- Added "Brain" to sidebar nav (Overview group) + MobileNav icon.
- Added brainState to SETTING_KEYS.
- Updated seed.ts: added Pollinations as ACTIVE provider (free, no key), only the valid `openai` (gpt-oss-20b) model. Default module configs wire crypto_technical/news_sentiment/macro → Pollinations/openai. crypto_technical job enabled by default. Cleaned invalid Pollinations models from DB + re-seeded.
- Created src/lib/market/coingecko.ts (getTrending, getTopMarkets) + /api/crypto/trending route.
- Created src/lib/market/reddit.ts (word-count sentiment, zero LLM) + /api/sentiment/reddit route (graceful degradation — Reddit 403s on datacenter IPs).
- Reduced db.ts Prisma logging from ['query'] to ['error','warn'] (dev.log noise).
- Moved ponytail-research + omniscient-inspect reference dirs to /home/z/reference/ (out of lint/build scope).
- Started scheduler mini-service on port 3042 (bun --hot, APP_URL=localhost:3000, 60s poll).

Stage Summary:
- Brain verified end-to-end: force-run BTCUSDT → Pollinations LLM call → 386 tokens → signal "short" conviction 42. Brain running=true, mode=auto, budget 386/60000 used.
- Lint clean (0 errors in src/). Dev server stable on port 3000. Scheduler pinging on 3042.
- Free stack works with ZERO api keys: Pollinations (LLM) + CoinGecko (data) + Binance (data) + Fear&Greed + Yahoo + er-api.
- Next: agent-browser end-to-end verification of the UI, then 15-min webDevReview cron.

---
Task ID: 2
Agent: main
Task: End-to-end verification + finalization (agent-browser QA, scheduler, cron, fixes).

Work Log:
- agent-browser verification: unlocked (/lock → password "omniscient"), dashboard renders live BTC/ETH/breadth/volume data, sidebar shows new "Brain" link, /brain page renders full control panel (status, token scoreboard, budget bar, watch list, action feed, 6 gate-config sliders, free-data card with live CoinGecko trending). Pause/resume interactivity confirmed (AUTONOMOUS ↔ PAUSED). Sticky-footer layout verified (min-h-screen flex flex-col + main flex-1 + footer mt-auto).
- Fixed scheduler mini-service persistence: `setsid` died across tool calls; switched to subshell-double-fork `(exec bun --hot index.ts &)` → stable on port 3042 (13+ ticks, 0 errors).
- Enabled crypto_technical schedule job (seed's `update:{}` didn't flip the pre-existing row; changed to `update:{enabled}` + re-ran seed). Autonomous scan now runs every 15 min.
- Fixed LLM-failure back-off: `attemptedLlm` flag (hoisted to function scope) records the attempt timestamp even when the LLM call fails, so the cadence rung backs off for minReanalyzeMs instead of re-hitting the rate limit every scan.
- Added Brain link to MobileNav (responsive).
- Created 15-min webDevReview cron job (job_id 221492, fixed_rate 900s, tz Asia/Calcutta) for autonomous ongoing improvement.

Stage Summary (VERIFIED):
- Token economy proven: 3 LLM calls / 1074 tokens used vs 14 skips / 3780 tokens SAVED (3.5x). The 3rd autonomous scan skipped ALL 11 assets (calm-recently-analyzed) — zero tokens, fully lazy. This is the ponytail ladder working: spend only when necessary.
- Free stack with ZERO api keys: Pollinations (LLM) + CoinGecko (trending) + Binance (price/klines/orderbook/funding) + Fear&Greed + Yahoo + er-api. Reddit client included (graceful 403 degradation on datacenter IPs).
- Graceful free-tier resilience: when Pollinations rate-limits (429) the brain falls back to deterministic consensus (signal still generated) + backs off for 10 min. No crashes, no lost signals.
- Lint clean (0 errors). Dev server stable (port 3000). Scheduler stable (port 3042). No runtime errors in dev.log.
- All 6 todos complete. Preview ready.

Unresolved / next-phase opportunities (for the 15-min cron):
- Deeper autonomy: cross-asset triggers (BTC move → re-analyze correlated alts), news-event triggers (breaking news → immediate analysis), self-tuning gate thresholds from grading feedback.
- Wire Reddit sentiment into the consensus sentiment layer (when not IP-blocked).
- Model tiering: configure a separate triage model (cheaper) vs deep model.
- More free data sources: GDELT global events, on-chain (blockchain.info), GitHub dev-activity.
