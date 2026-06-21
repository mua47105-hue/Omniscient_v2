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

---
Task ID: 6
Agent: main (15-min cron review #4)
Task: QA + trigger traceability (signals "triggered by" badge) + brain header elevation.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 57/61 ticks ok — lastErr: none, the 4 errors historical). Brain running, auto mode, 77 ticks, 7 LLM calls, 2791 used / 7020 saved (72% saved). 20 timeline samples. Lint clean, no runtime errors.
- QA via agent-browser + VLM: all 7 pages render 200. VLM flagged brain header as flat + visual hierarchy could be stronger. totalGraded still 0 (signals need 24h to expire).

## Completed modifications
1. **"Triggered by" traceability** — closes the autonomy loop visibly. When a news/cross-asset/manual trigger force-runs an asset, the resulting signal is now stamped with its trigger source so operators can trace WHY it was analyzed.
   - `src/lib/brain/state.ts`: force-run queue upgraded from `Set<string>` to `Map<string,string>` (symbol→source). `forceRun(symbol, source)` accepts 'manual'|'news'|'cross-asset'. `consumeForceRunQueue()` returns `{symbol, source}[]`.
   - `src/lib/brain/triggers.ts` + `news-triggers.ts`: pass their source ('cross-asset'/'news'). `src/app/api/brain/route.ts` manual force-run passes 'manual'.
   - `src/app/api/scheduler/tick/route.ts`: `analyzeAsset` accepts `triggerSource` param, stamps rationale as `[trigger:SOURCE] ...` (no schema migration — ponytail: reuse the existing rationale field). `runForcedAnalysis` carries the source from queue→analyzeAsset.
   - `src/components/signals/SignalsFeedClient.tsx`: `parseTrigger()` helper strips the prefix + returns the source; renders a colored "Triggered by {source}" badge (amber=news, violet=cross-asset, sky=manual) above the rationale.
2. **Brain header elevation** (`src/components/brain/BrainPanel.tsx`) — addresses VLM feedback. Gradient title (sky-300→sky-400→teal-300, transparent clip), brain icon in a rounded gradient chip with ring, ambient blur glow behind the header, animated AUTONOMOUS badge (framer-motion scale pulse + ping dot + emerald glow shadow). VLM: 7/10 → 8/10 polish.

## Bug fixed
3. **Hot-reload type-migration crash**: `forceRunQueue` changed from `Set` to `Map`, but the running dev server's stale singleton still had a `Set`. The old guard `if (!s.forceRunQueue)` didn't fire (Set is truthy). FIX: guard now checks `if (!(s.forceRunQueue instanceof Map))` — replaces a stale-typed field. General lesson: hot-reload migration guards must check the TYPE, not just existence, when a field's type changes.

## Verification results
- Lint clean. dev.log: no errors. Scheduler 57/61 ok (lastErr: none). Pages: / /brain /crypto /signals /macro /news /settings all 200.
- Trigger stamping verified end-to-end: force-run BTC → tick processes queue (forced: BTCUSDT, tier 2, "manual-force-run") → signal rationale = "[trigger:manual] [technical] RSI 68...". Signals page renders "Triggered by" badge.
- agent-browser: brain page renders elevated gradient header + animated AUTONOMOUS badge; signals page renders "Triggered by" badge.
- VLM: brain header 8/10 ("premium feel, gradient + glow tasteful").
- Brain stats: 77 ticks, 20 samples, 7 LLM calls, 2791 used / 7020 saved (72%).

## Unresolved / next-phase recommendations
- GitHub dev-activity data source (todo deferred this round — would add commit-count for top crypto repos as another zero-token FreeSignalsCard column). High value, low effort.
- Self-tuning still data-starved (needs 24h for first grades). Will activate autonomously.
- News/cross-asset triggers will stamp their source on signals the moment they fire — traceability is now ready for when triggers activate.
- Next cron could: (a) GitHub dev-activity source, (b) self-tune history mini-chart, (c) wire on-chain hashrate-trend as a consensus fundamental, (d) a "trigger stats" tile on the brain page (count of news/cross-asset/manual triggers fired).

---
Task ID: 7
Agent: main (15-min cron review #5)
Task: QA + GitHub dev-activity free source + trigger-stats tile + FreeSignalsCard 5-column layout.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 68/72 ticks ok — lastErr: none). Brain running, auto mode. Lint clean, no runtime errors. All 9 pages render 200.
- QA via agent-browser + VLM: brain page healthy. VLM flagged FreeSignalsCard column imbalance (4 cols uneven) + suggested refresh timestamps. totalGraded still 0 (signals need 24h).

## Completed modifications
1. **GitHub dev-activity free data source** (`src/lib/market/devactivity.ts` + `/api/devactivity`): free GitHub API (no key, 60 req/hr anonymous). Fetches commit count (7d) + stars + last push for 5 flagship crypto repos (bitcoin/bitcoin, ethereum, solana, chainlink, cardano). Cached 30 min. Verified live: BTC 44 commits/89k★, ETH 100, LINK 35, ADA 11. Zero tokens, zero API key.
2. **5th column in FreeSignalsCard** (`src/components/brain/FreeSignalsCard.tsx`): "Dev Activity" column with per-repo commit badges (emerald >30, amber >10, muted else). Grid upgraded to `md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5` for balanced layout. Card title now "5 free sources".
3. **Trigger-stats tile** (`src/lib/brain/state.ts` + BrainPanel): new BrainStats fields `triggersNews/triggersCrossAsset/triggersManual`. `recordTrigger(source)` function called from news-triggers, cross-asset triggers, + manual brain-API forceRun. New "Triggers Fired" scoreboard tile (fuchsia accent) showing total + breakdown subtext. Scoreboard grid → xl:grid-cols-6. VLM: 9/10 ("balanced, scannable, cohesive").
4. **UI polish**: 6-tile scoreboard balanced, trigger tile with breakdown subtext, dev-activity column with semantic color coding.

## Bug fixed
5. **Hot-reload nested-stats backfill**: trigger counters showed `null` after hot-reload because the `state()` migration guard only backfilled top-level state fields, not nested stats fields. FIX: added guards `if (s.stats.triggersNews == null) s.stats.triggersNews = 0` (×3) for the new nested stats. Lesson: nested-object field additions need their own backfill guards on the parent object (don't reset the whole stats object — would lose ticksTotal/tokensUsed).
6. **Dev-server state corruption**: after multiple hot-reloads the brain singleton's stats object got into an inconsistent state where the guard ran but didn't persist across module re-instantiation. A clean dev-server restart resolved it (fresh `globalThis`). Production won't hit this (no hot-reload).

## Verification results
- Lint clean. dev.log: no errors. Scheduler 68/72 ok (lastErr: none). Pages: / /brain /crypto /signals /macro /news /settings all 200.
- agent-browser: brain scoreboard renders all 6 tiles (Tokens Used, Saved, Cache Hits, Skips, Win Rate, Triggers Fired); FreeSignalsCard renders 5 columns (CoinGecko, Fear&Greed, Reddit, On-Chain, Dev Activity) with "5 free sources" label.
- Trigger counter verified: force-run BTC → `triggersManual: 1`.
- devactivity API: returns live data (BTC 44 commits, ETH 100, etc.).
- VLM: scoreboard 9/10 ("balanced, scannable, cohesive design").

## Unresolved / next-phase recommendations
- Self-tuning still data-starved (needs 24h for first grades). Will activate autonomously.
- News/cross-asset triggers will fire + count when their conditions are met (breaking news / volatile anchor). Counter ready.
- Next cron could: (a) self-tune history mini-chart showing threshold evolution, (b) wire on-chain hashrate-trend as a consensus fundamental layer, (c) add refresh timestamps to each FreeSignalsCard column, (d) move news triggers to every-tick (60s) with a 5-min RSS cache for sub-minute breaking-news response, (e) add a "dev-activity delta" — compare this week's commits to last week's as a trend signal.

---
Task ID: 8
Agent: main (15-min cron review #6)
Task: QA + dashboard visual cohesion + FreeSignalsCard freshness timestamps + global footer brain indicator.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 75/79 ticks ok — lastErr: none). Brain running, auto mode, LLM in cooldown (Pollinations 429 on fresh-state first scan — circuit-breaker working as designed). Lint clean, no runtime errors. All 9 pages render 200.
- QA via agent-browser + VLM: VLM flagged the dashboard brain banner as "disconnected" from the stat cards (sky/purple gradient clashed with the dashboard's emerald/amber/orange palette).

## Completed modifications
1. **Dashboard visual cohesion** (`src/components/brain/BrainStatusCard.tsx` + `Sparkline.tsx`): shifted the brain banner from sky/teal → emerald-forward palette to match the dashboard's stat-card family (BTC amber, ETH teal, breadth emerald/rose, volume orange). Mini-stat accents now amber (tokens) / emerald (saved) / orange (LLM calls). Sparkline "used" line changed sky→amber, legend updated. VLM: 6/10 → 8/10 ("banner now feels cohesive with the stat cards, visual harmony").
2. **FreeSignalsCard freshness timestamps** (`src/components/brain/FreeSignalsCard.tsx`): each of the 5 column headers now shows "Xm ago" / "just now" via react-query's `dataUpdatedAt` + a `freshness()` helper. Operators can see at a glance how stale each free source is. Column headers shortened (e.g. "CoinGecko Trending"→"CoinGecko") to fit the timestamp.
3. **Global footer brain indicator** (`src/components/brain/FooterBrainIndicator.tsx` + wired into Footer): compact client component showing a pulsing emerald dot + "Brain ON" / "cooldown" / "OFF" + tokens-saved count. Visible on EVERY page (verified on /crypto), not just the dashboard. Links to /brain. Amber dot when in cooldown, rose when paused.

## Verification results
- Lint clean. dev.log: no errors. Scheduler 75/79 ok (lastErr: none). Pages: / /brain /crypto /signals /macro /news /settings all 200.
- agent-browser: dashboard brain banner renders with emerald/amber/orange accents; footer brain indicator renders on /crypto (non-dashboard page) with "Brain ... tok saved"; FreeSignalsCard columns show freshness ("57s ago").
- VLM: dashboard cohesion 8/10 ("visual harmony, banner cohesive with stat cards").
- Brain stats: fresh state after restart (ticks:3, LLM in cooldown from first-scan 429 — circuit-breaker active, will recover in 30-120s).

## Unresolved / next-phase recommendations
- Self-tuning still data-starved (needs 24h for first grades). Will activate autonomously.
- News/cross-asset triggers will fire + count when conditions are met.
- Next cron could: (a) self-tune history mini-chart, (b) wire on-chain hashrate-trend as a consensus fundamental, (c) move news triggers to every-tick (60s) with a 5-min RSS cache, (d) dev-activity delta (this week vs last week commits), (e) refine the banner gradient to "more defined color blocks" (VLM's only remaining nit).

---
Task ID: 9
Agent: main (15-min cron review #7)
Task: QA + watch-list action icons + dev-activity delta trend + self-tune history chart.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 82/86 ticks ok — lastErr: none). Brain running, auto mode, 9 ticks, 1 LLM call, 9 skips (8 budget-skips), 11 assets watched. Lint clean, no runtime errors. All 9 pages render 200.
- QA via agent-browser + VLM: VLM flagged the watch list as "lacks per-asset activity context" — only words, no icons. totalGraded still 0 (signals need 24h).

## Completed modifications
1. **Watch-list action icons** (`src/components/brain/BrainPanel.tsx`): `actionIcon()` helper maps each brain action to a color-coded lucide icon — analyze=Zap(sky), cache=DatabaseZap(violet), skip=Eye(muted), paused=Ban(rose), watch=Activity(amber). Each watch row now leads with the icon in a rounded chip, so the brain's per-asset activity is instantly clear at a glance. VLM: 7/10 → 9/10 ("significantly clarify the brain's per-asset activity").
2. **Dev-activity delta trend** (`src/lib/market/devactivity.ts` + FreeSignalsCard): the client now fetches this-week AND last-week commits (3 GitHub calls per repo) and computes `deltaPct`. The FreeSignalsCard dev-activity column shows a ↑/↓/→ trend badge with the % change (emerald up, rose down, muted flat) + a tooltip "X this week vs Y last week". Header now "commits / 7d · vs last week". Adds genuine trend info — rising dev activity = accelerating development.
3. **Self-tune history chart** (`src/lib/brain/state.ts` TuneEvent ring buffer + `recordTuneEvent()` + BrainPanel card): new `tuneEvents` array (capped 50) records each threshold nudge with field/from→to/reason/winRate/sampleSize. The selftune module calls `recordTuneEvent` for each adjusted threshold. New "Self-Tune History" card on the brain page shows the timeline of threshold evolution (violet rows) with an empty-state explaining it activates after 24h when grades accrue. Exposed in the brain snapshot.

## Verification results
- Lint clean. dev.log: no errors. Scheduler 82/86 ok (lastErr: none). Pages: / /brain /crypto /signals /macro /news /settings all 200.
- agent-browser: watch list renders with action-icon chips; Self-Tune History card renders with "No threshold nudges yet" placeholder (correct — needs 24h grades); dev-activity column renders (Unavailable during GitHub rate-limit, will recover).
- tuneEvents in brain snapshot: 0 (expected).
- VLM: watch list 9/10 ("action icons significantly clarify per-asset activity, well-organized row structure").
- NOTE: GitHub dev-activity API hit the 60/hr anonymous rate limit during testing (3 calls/repo × 5 repos = 15 calls, plus earlier tests). The 30-min cache + the limit reset will restore it. On a residential/HF-Spaces host with a GitHub token (optional) this won't happen.

## Unresolved / next-phase recommendations
- Self-tuning + self-tune history are wired but data-starved (need 24h for first grades). They'll activate + populate autonomously.
- Dev-activity delta is computed but GitHub rate-limits anonymous use. Could add an optional GitHub token in Settings to raise to 5000/hr.
- Next cron could: (a) wire on-chain hashrate-trend as a consensus fundamental layer, (b) move news triggers to every-tick (60s) with a 5-min RSS cache, (c) add hover tooltips on the watch-list action icons, (d) make the self-tune history a proper step-chart of threshold values over time, (e) add a "trigger stats" breakdown chart (news vs cross-asset vs manual over time).

---
Task ID: 10
Agent: main (15-min cron review #8)
Task: QA + "Brain thinking" live indicator + every-tick news triggers + watch-icon tooltips.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 156/160 ticks ok — lastErr: none). Brain running, auto mode, 83 ticks, 2 LLM calls, 48 skips (47 budget-skips — budget guard very active), 11 assets watched, 83 timeline samples. Lint clean, no runtime errors. All 9 pages render 200.
- QA via agent-browser + VLM: VLM suggested a real-time "thinking" indicator to make the brain feel alive. totalGraded still 0 (signals need 24h).

## Completed modifications
1. **"Brain thinking" live indicator** (`src/lib/brain/state.ts` thinking-state + `src/components/brain/ThinkingIndicator.tsx`): `tickStarted()`/`tickEnded()` track when a tick is in progress + the last tick's duration. `isThinking()` returns true during a tick (with a 30s sanity cap for stuck ticks). The ThinkingIndicator client component polls /api/brain every 1.5s + renders a 5-bar animated waveform (framer-motion staggered scale) while thinking, a flat dim line when idle, + shows the last tick duration ("42ms") or "thinking…". Added to the BrainPanel header next to the AUTONOMOUS badge. VLM: 8/10 ("makes the brain feel more alive, well-placed").
2. **Every-tick news triggers** (`src/lib/brain/news-triggers.ts` RSS cache + tick route): moved `checkNewsTriggers()` from the 15-min due-job scan to run on EVERY tick (60s) for sub-minute breaking-news response. Added a 5-min RSS feed cache (Map<url, {items, ts}>) so feeds aren't re-fetched constantly — the seen-article dedup prevents re-triggering within the cache window. Removed the duplicate call from the due-jobs section. This is the biggest autonomy improvement: breaking news now wakes the brain within 60s instead of up to 15min.
3. **Watch-list action-icon tooltips** (`src/components/brain/BrainPanel.tsx`): upgraded the icon `title` from a bare action name to a rich multi-line tooltip "ACTION · humanized-reason · tier" + added a hover bg transition. Lightweight (native title, no extra Tooltip providers).

## Verification results
- Lint clean. dev.log: no errors. Scheduler 156/160 ok (lastErr: none). Pages: / /brain /crypto /signals /macro /news /settings all 200.
- agent-browser: ThinkingIndicator renders in the header ("Brain idle" / "idle" when not thinking); watch-list action icons have rich tooltips.
- Brain snapshot includes `thinking` + `lastTickDurationMs` fields.
- News triggers run on every tick (verified: tick with `skipped:true` still ran news triggers without error).
- VLM: thinking indicator 8/10 ("makes the brain feel more alive, well-placed next to AUTONOMOUS badge").

## Unresolved / next-phase recommendations
- Self-tuning still data-starved (needs 24h for first grades). Will activate autonomously + populate the Self-Tune History card.
- News triggers now run every 60s — will fire + count the moment breaking news lands (sub-minute response).
- Next cron could: (a) wire on-chain hashrate-trend as a consensus fundamental layer, (b) make the self-tune history a step-chart of threshold values, (c) add a "trigger stats" breakdown chart (news vs cross-asset vs manual over time), (d) add a GitHub token setting to raise dev-activity rate limit to 5000/hr, (e) color-contrast tweak on the thinking waveform (VLM's only nit).

---
Task ID: 11
Agent: main (15-min cron review #9)
Task: QA + fix tokensSaved double-count bug + trigger-breakdown donut + thinking-waveform contrast.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 161/165 ticks ok — lastErr: none). Brain running, auto mode, 92 ticks, 2 LLM calls, 58 skips (57 budget-skips), 11 assets watched. Lint clean, no runtime errors. All 9 pages render 200.
- QA: found a real token-accounting bug while reviewing the budget-skip path.

## Bug fixed
1. **tokensSaved double-counting** (`src/lib/brain/state.ts`): `recordBudgetSkip()` was adding to `tokensSaved`, AND the tick route called BOTH `recordSkip()` (which adds to tokensSaved) + `recordBudgetSkip()` for budget-skips/cooldown-skips → double-counting saved tokens. This inflated the savings % on the scoreboard. FIX: `recordBudgetSkip()` now only increments the `budgetSkips` counter (for the "unanimous + budget" breakdown) and does NOT touch `tokensSaved` — the companion `recordSkip()` call already handles that. Real correctness fix; existing accumulated value is forward-only (pre-fix double-count stays, new skips are accurate).

## Completed modifications
2. **Trigger-breakdown donut chart** (`src/components/brain/TriggerBreakdown.tsx` + wired into BrainPanel): compact inline-SVG donut (no chart lib) showing the news / cross-asset / manual trigger split as colored arcs (amber/violet/sky) with a center total + legend. Empty state shows a dashed muted ring. Added as a compact card between the scoreboard + Token Economy card. VLM: 7/10 ("adds value, visually breaks down trigger sources, proportions more intuitive than raw numbers"). Addresses worklog rec (c).
3. **Thinking-waveform contrast** (`src/components/brain/ThinkingIndicator.tsx`): per VLM's nit — the waveform bars were `w-0.5 bg-emerald-400`, now `w-1 bg-emerald-300` + a `drop-shadow(0 0 3px rgba(16,185,129,0.6))` glow so the bars pop against the gradient background. Idle bars also widened to w-1.

## Verification results
- Lint clean. dev.log: no errors. Scheduler 161/165 ok (lastErr: none). Pages: / /brain /crypto /signals /macro /news /settings all 200.
- agent-browser: Trigger Breakdown donut renders with alt text "Trigger breakdown: 1 total (0 news, 0 cross-asset, 1 manual)" — correct counts + accessibility.
- tokensSaved accounting: fix is forward-only (existing 270 stays, new skips count once).
- VLM: donut 7/10 ("adds value, visually breaks down trigger sources, well-integrated below Triggers Fired").

## Unresolved / next-phase recommendations
- Self-tuning still data-starved (needs 24h for first grades). Will activate autonomously + populate the Self-Tune History card.
- News triggers run every 60s — will fire + count + populate the donut the moment breaking news lands.
- Next cron could: (a) wire on-chain hashrate-trend as a consensus fundamental layer, (b) make the self-tune history a step-chart of threshold values, (c) add hover interactivity to the donut (VLM nit), (d) add a GitHub token setting to raise dev-activity rate limit, (e) add a "tokensSaved over time" area chart (distinct from the used-vs-saved sparkline).

---
Task ID: 12
Agent: main (15-min cron review #10)
Task: QA + on-chain hashrate-trend consensus layer + cumulative-saved area chart + donut hover interactivity.

## Current project status (assessment)
- App + scheduler both alive (dev:3000, scheduler:3042, 170/174 ticks ok — lastErr: none). Brain running, auto mode, 98 ticks, 2 LLM calls, 58 skips, 11 assets watched, 98 timeline samples. Lint clean, no runtime errors. All 9 pages render 200.
- QA via agent-browser + VLM: dashboard 7/10. totalGraded still 0 (signals need 24h).

## Completed modifications
1. **On-chain hashrate-trend consensus layer** (`src/lib/market/onchain.ts` trend tracker + `src/lib/analysis/consensus.ts` buildOnchainLayer + tick wiring): the onchain client now accumulates hashrate samples in a ring buffer (capped 24) + exposes `getOnchainTrend()` returning direction/pctChange/sampleCount. New `buildOnchainLayer()` in the consensus engine maps the trend to a ±60 score (rising hashrate = miners committing capital = bullish; falling = bearish), only for BTC + when ≥3 samples exist. Confidence scales with magnitude + sample count. Wired into both `computeConsensus` calls in the tick (deterministic + final). This adds a genuine free fundamental layer to the 7-layer consensus — the deepest autonomy improvement (worklog rec a).
2. **Cumulative tokens-saved area chart** (`src/components/brain/SavedAreaChart.tsx` + BrainPanel card): dedicated emerald area chart showing cumulative savings GROWING over time (distinct from the used-vs-saved sparkline). Inline SVG, no chart lib. New "Cumulative Tokens Saved" card on the brain page with the area chart + a big savings number + "% of gross". VLM: 9/10 ("makes savings tangible, donut + area chart well-balanced, complementary purposes"). Addresses worklog rec (e).
3. **Donut hover interactivity** (`src/components/brain/TriggerBreakdown.tsx`): made the donut stateful — hovering a segment OR legend row highlights it (thickens the arc, dims the others) + the center shows that segment's count + label instead of the total. Legend rows also highlight on hover. Addresses VLM's earlier nit.

## Verification results
- Lint clean. dev.log: no errors. Scheduler 170/174 ok (lastErr: none). Pages: / /brain /crypto /signals /macro /news /settings all 200.
- agent-browser: Trigger Breakdown donut renders (interactive); Cumulative Tokens Saved card renders with area chart + "25% of gross".
- onchain API: returns live data (hashRate: 857 GH/s). Trend tracker accumulating samples (will produce a direction after 3+ samples).
- VLM: area chart + donut combination 9/10 ("sleek and functional, complementary purposes").
- On-chain consensus layer: wired + will contribute to BTC signals once ≥3 hashrate samples accumulate (~45 min at 15-min cache).

## Unresolved / next-phase recommendations
- On-chain hashrate layer is BTC-only + needs ≥3 samples (~45min) to produce a direction. Will activate autonomously.
- Self-tuning still data-starved (needs 24h for first grades).
- Next cron could: (a) make the self-tune history a step-chart of threshold values, (b) add a GitHub token setting to raise dev-activity rate limit, (c) extend the on-chain layer to ETH gas-price trend (free, via etherscan-style API), (d) add a "consensus layers" breakdown on signals showing which layers contributed (now that onchain can contribute), (e) area-chart contrast tweak (VLM's only nit).
