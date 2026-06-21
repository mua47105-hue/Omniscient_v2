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

---
Task ID: 4
Agent: main (15-min cron review #2)
Task: QA + make autonomy visible (dashboard brain card, autonomy log) + free on-chain data source.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 36/37 ticks ok). Brain running, auto mode, 47 ticks, 6 LLM calls, 24 skips, 2331 tokens used / 6750 saved (2.9×). Lint clean, no runtime errors.
- QA via agent-browser + VLM: all 7 key pages render 200. VLM flagged two gaps: (1) no brain-status indicator on the main dashboard — casual viewers land on `/` and see nothing about the autonomous system; (2) the new autonomy features (self-tune, cross-asset triggers) run invisibly in the backend, not surfaced in the brain UI.

## Completed modifications
1. **Brain Status card on the overview dashboard** (`src/components/brain/BrainStatusCard.tsx` + wired into OverviewClient): a prominent banner directly under the hero showing AUTONOMOUS/PAUSED badge with live pulse, assets-watched count, last-tick ago, and 3 mini-stats (Tokens used, Saved %, LLM calls). Links to /brain. VLM: "clearly communicates the autonomous system is running" (7/10 polish).
2. **Autonomy Log in the brain action feed** (`src/components/brain/BrainPanel.tsx`): self-tune + cross-asset trigger events now get highlighted violet rows with a Sparkles badge + conviction/win-rate chip, so the brain's higher-level reasoning is visible — not just the per-asset skip/analyze churn. Cross-asset triggers now `recordAction` so they appear in the feed (was invisible before).
3. **Free on-chain data source** (`src/lib/market/onchain.ts` + `/api/onchain/stats`): blockchain.info /q endpoints — BTC hashrate (EH/s), 24h tx count, difficulty (T). Zero tokens, zero API key, 15-min cache. Wired as a 4th column in the brain's FreeSignalsCard (Trending / Fear&Greed / Reddit / On-Chain). Live data confirmed: 701,998 txns, 869 GH/s, 125T difficulty.

## UI polish
4. BrainStatusCard: animated ping pulse on the brain icon when running, ambient sky/teal gradient, hover lift + arrow nudge, COOLDOWN badge appears when the LLM circuit-breaker is active.
5. FreeSignalsCard: grid upgraded to 4 columns on xl, on-chain rows with semantic hints ("miner confidence", "network demand", "security budget").
6. Action feed: autonomy events highlighted with violet tint + ring so they stand out from routine skips.

## Verification results
- Lint clean. dev.log: no errors. Scheduler 36/37 ok. Pages: / /brain /crypto /signals /macro /news /settings all 200.
- agent-browser: dashboard renders "The Lazy Brain / AUTONOMOUS / assets watched / Tokens" banner; brain page FreeSignalsCard shows "BTC On-Chain / Hashrate / miner confidence / 24h Txns / Difficulty".
- VLM: brain banner "clearly communicates the autonomous system is running" (7/10).
- on-chain API: returns live data (txCount24h:701998, hashRate:869GH/s, difficulty:125T).
- Brain stats stable: 47 ticks, 6 LLM calls, 24 skips, 2.9× token savings.

## Unresolved / next-phase recommendations
- Self-tuning still data-starved (needs 24h for first grades to expire). It's wired + will activate autonomously — no action needed.
- Cross-asset triggers will fire when an anchor (BTC/ETH) next enters a volatile/high-noteworthiness regime — also autonomous, no action needed.
- Next cron could: (a) add a small sparkline/trend to the dashboard brain card showing token-savings over time, (b) add a "brain health" row to the footer, (c) wire on-chain hashrate-trend as a consensus fundamental layer, (d) add a self-tune history mini-chart showing threshold evolution.

---
Task ID: 5
Agent: main (15-min cron review #3)
Task: QA + news-event triggers (deeper autonomy) + token-economy timeline sparkline.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 45/49 ticks ok — 4 errors were historical from a hot-reload crash, now resolved). Brain running, auto mode, 62 ticks, 6 LLM calls, 2331 tokens used / 7020 saved (3.0×). Lint clean, no runtime errors.
- QA via agent-browser: all 7 key pages render 200. News API has 50 items available — a news-event trigger can fire NOW (unlike the data-starved self-tuning which needs 24h grades).

## Completed modifications
1. **News-event triggers** (`src/lib/brain/news-triggers.ts`): free, keyword-based breaking-news detector. Scans crypto RSS (CoinDesk/Cointelegraph/Decrypt) for market-moving keywords (hack/ETF/SEC/regulation/ban/listing/surge/crash/…) with polarity + weight, tags mentioned tracked assets, queues them for re-analysis via forceRun. Seen-article dedup (capped 500) so the same headline doesn't re-trigger. Zero LLM tokens, zero API key. Records a `NEWS→TRIGGER` action (visible in the action feed as an autonomy event). Wired into the scheduler tick (runs on every due scan).
2. **Token-economy timeline** (`src/lib/brain/state.ts` StatsSample ring buffer + `recordSample()`/`getSamples()`): one sample per tick (capped 120 = ~2h), records cumulative tokensUsed/tokensSaved/llmCalls/skips. Wired into the tick (both the due + skipped paths) so the timeline is continuous. Exposed in the brain snapshot.
3. **Sparkline component** (`src/components/brain/Sparkline.tsx`): minimal inline-SVG sparkline (no chart lib — ponytail: the platform has <svg>). Emerald area = tokens saved, sky line = tokens used. The gap between them IS the ponytail token-economy benefit, visible over time. Handles <2 samples with a "collecting…" state.
4. **Dashboard sparkline** (BrainStatusCard): compact 130×34 sparkline with a "{N} saved" label so the line is interpretable, not abstract. Hidden on small screens.
5. **Brain page sparkline** (BrainPanel budget card → "Token Economy"): larger 220×44 sparkline with a legend (used/saved) beside the budget progress bar. Renamed the card from "Token Budget" to "Token Economy" to reflect the combined budget + timeline view.

## Bug fixed
6. **Hot-reload migration crash**: `recordSample()` crashed on "Cannot read properties of undefined (reading 'push')" because the running dev server's globalThis brain singleton predated the `statsSamples` field. FIX: `state()` now defensively backfills missing fields (`statsSamples`, `forceRunQueue`) so a stale singleton from a previous code version doesn't crash. Each new state field needs a one-line guard.

## UI polish
7. Action feed: `news-event` actions now join `self-tune` + `cross-asset` in the highlighted violet autonomy rows.
8. Dashboard sparkline label changed from "SAVINGS TREND" to "{N} saved" (VLM: tiny abstract label was hard to interpret → now shows the live value).
9. Brain budget card redesigned into a 2-column layout (progress bar left, sparkline + legend right).

## Verification results
- Lint clean. dev.log: no errors. Scheduler 45/49 ok (lastErr: none — the 4 errors were pre-fix). Pages: / /brain /crypto /signals all 200.
- agent-browser: dashboard renders "The Lazy Brain / AUTONOMOUS / {N} saved" + sparkline; brain page renders "Token Economy / USED VS SAVED" + sparkline with legend.
- Brain stats: 62 ticks, 5 timeline samples, 6 LLM calls, 2331 used / 7020 saved (3.0×).
- News triggers: wired + firing on scan cadence (no breaking headlines in the current feed, so no trigger fired yet — will activate when news breaks).
- VLM: dashboard 7/10 (sparkline label improved).

## Unresolved / next-phase recommendations
- News triggers run on the 15-min scan cadence. Could be moved to every 60s tick for sub-minute breaking-news response (needs a short RSS cache to stay free-tier-safe). Currently acceptable — force-run queue is processed every tick, so queued assets analyze within 60s of the trigger firing.
- Self-tuning still data-starved (needs 24h for first grades). Will activate autonomously.
- Next cron could: (a) add a self-tune history mini-chart showing threshold evolution over time, (b) wire on-chain hashrate-trend as a consensus fundamental layer, (c) add a "triggered by" badge on signals that were force-run'd by a news/cross-asset trigger (traceability), (d) move news triggers to every-tick with a 5-min RSS cache for faster breaking-news response.
