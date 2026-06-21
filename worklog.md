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

---
Task ID: 3
Agent: main (15-min cron review #1)
Task: QA + fixes + deeper autonomy (self-tuning, cross-asset triggers) + UI polish.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 29/30 ticks ok). Brain running, auto mode, 11 assets watched. Token economy proven (2.9× savings). Lint clean, no runtime errors.
- QA via agent-browser: all key pages render (/ /brain /crypto /signals /macro /settings). VLM assessed the UI — watch-list labels were raw internal codes ("llm-failed-fallback"), slider handles lacked contrast.

## Bugs found + fixed
1. **Thundering-herd rate-limiting (functional bug)**: when Pollinations 429s one asset, the brain re-attempted ALL 11 assets simultaneously after back-off expired → 11 failed calls. FIX: added a **global LLM circuit-breaker** (state.ts: `llmInCooldown`, `recordLlmFailure`/`recordLlmSuccess`, exponential backoff 30s→60s→120s capped). The first 429 trips it; sibling assets in the same scan skip the LLM (`reason: llm-cooldown`) and use deterministic consensus. Force-run bypasses it (manual control preserved).
2. **UI: raw reason codes** in watch list/action feed. FIX: `humanizeReason()` maps `calm-recently-analyzed`→"calm", `llm-failed-fallback`/`llm-cooldown`→"rate-limited", `unanimous-deterministic`→"math agrees", etc.

## New features (deeper autonomy)
3. **Self-tuning thresholds from grading feedback** (`src/lib/brain/selftune.ts`): after each scan, reads the 40 most-recent SignalOutcome grades, splits by conviction band, nudges `unanimousConviction` + `minNoteworthiness` toward better calibration. Conservative: needs ≥12 grades, max ±2/run, bounded [55-85]/[20-55], only in auto mode. Records a `SELF-TUNE` action. Currently reports "insufficient graded sample" (no signals have expired yet — needs 24h).
4. **Cross-asset triggers** (`src/lib/brain/triggers.ts`): after a scan, if BTC/ETH is in a volatile regime or high-noteworthiness, queues correlated alts for re-analysis next tick via forceRun (clears their cadence back-off). Free + deterministic detection (zero tokens). Storm-guard: skips followers analyzed <2min ago.
5. Both wired into the scheduler tick POST (best-effort, never block). Response now includes `triggers` + `tune` summaries.

## UI polish
6. **LLM circuit-breaker banner**: amber banner under the header when cooldown is active — tells the operator WHY no LLM calls are happening + retry countdown.
7. **Win Rate stat tile** (5th tile, xl:grid-cols-5): reads /api/analytics/models, shows accuracy % + graded count, color-coded (emerald ≥50%, rose <50%). Subtext "self-tunes" ties it to the self-tuning feature.
8. **Slider handle contrast**: config sliders now have bright sky-blue handles with border, shadow, ring, hover-scale (VLM: 6/10 → 9/10 visibility).
9. Humanized reason labels across watch list + action feed.

## Verification results
- Lint clean. dev.log: no errors from new code. Scheduler 29/30 ok. Pages: / /brain /crypto /signals all 200.
- agent-browser: brain page renders all 5 stat tiles (incl Win Rate "awaiting grades"), watch list shows "calm"/"rate-limited" labels, cooldown banner hidden when not active.
- VLM UI assessment: watch-list labels 8/10, slider handles 9/10.
- Brain stats: 40 ticks, 6 LLM calls, 24 skips, 1 cache hit, 2331 tokens used / 6750 saved (2.9×).
- Tick response includes `triggers: null` (no volatile anchors currently) + `tune: {tuned:false, reason:"insufficient graded sample"}` — both features wired + functioning, waiting for data.

## Unresolved / next-phase recommendations
- Self-tuning + cross-asset triggers are wired but data-starved (need 24h for first grades; need a volatile anchor session for triggers). They'll activate autonomously as data accrues — no action needed.
- Next cron could: (a) add a "brain health" mini-card to the main dashboard (overview) surfacing brain status to casual viewers, (b) wire Reddit sentiment into the consensus sentiment layer when not IP-blocked, (c) add a free on-chain data source (blockchain.info), (d) add a "self-tune history" log view so operators can see the thresholds evolving.
