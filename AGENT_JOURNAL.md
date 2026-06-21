# AGENT_JOURNAL.md — OMNISCIENT_v2 Improvement Session

**Session start:** 2026-06-21
**Branch:** `improve/2026-06-21-session`
**Tag:** `pre-improvement-2026-06-21`

---

## Section 1: Known Open Items — Resolved

### 1.1 Git remote integrity
- **Remote:** `origin → mua47105-hue/Omniscient_v2.git`
- **Divergence:** None. Working tree clean. `main` and `origin/main` in sync.
- **Status:** ✅ CONFIRMED

### 1.2 Test suite
- **Test files found:** 0
- **Test count:** 0/0 (0 pass, 0 fail — no tests exist)
- **Status:** ❌ NO TEST SUITE EXISTS. This is the #1 priority. Every "L1.1 complete" claim from prior sessions is unverifiable because there is nothing to run.

### 1.3 Database target
- **Datasource:** SQLite (`file:/home/z/my-project/db/custom.db`)
- **Supabase:** Optional sync module exists (`src/lib/supabase/`) but is NOT the source of truth. Local SQLite is the source of truth in this environment.
- **Migrations target:** Local SQLite via `prisma db push` (no migration files, schema-push model)
- **Status:** ✅ CONFIRMED — local SQLite is source of truth

### 1.4 Stability bar
- **Bar definition:** (a) lint passes with 0 errors, (b) tsc passes with 0 errors, (c) full test suite passes, (d) app boots with zero console errors on cold start
- **Lint:** 0 errors, 1 warning (unused eslint-disable in db.ts). ✅
- **tsc:** 1 error — `mini-services/scheduler/index.ts(23,16): TS2867: Cannot find name 'Bun'`. The scheduler is a Bun runtime file outside the Next.js app. tsconfig.json does not exclude `mini-services/`. ⚠️ FIXABLE
- **Test suite:** ❌ 0 tests. Cannot pass.
- **App boot:** Dev server running on port 3000, all responses 200, zero console errors in dev.log. ✅
- **Scheduler:** Running on port 3042, 121 ticks, 12+ OK. ✅
- **Meets bar?** ❌ NO — missing test suite + tsc error in mini-services

### Priority order (revised after Section 1)
1. Fix tsc error (exclude mini-services from tsconfig) — 5 min
2. Create initial test suite for the highest-risk modules — this IS the first priority
3. Phase 0 audit (proceeds in parallel with test creation)

---

## Section 1: Decision Log

| Item | Decision | Rationale |
|------|----------|-----------|
| tsc error in mini-services/scheduler | Fix by adding `"mini-services/**"` to tsconfig exclude | The scheduler is a Bun script, not part of the Next.js app. tsc should not type-check it. |
| Zero tests | First priority: create characterization tests for pure-math modules (indicators, consensus, cointegration, hurst, triple-barrier, deflated-sharpe, vol-targeting) | These are the highest-risk modules (they compute numbers that drive trading decisions) and are pure functions (easy to test, no mocks needed). |
| Supabase vs SQLite | SQLite is source of truth. Supabase is optional sync. | .env confirms `DATABASE_URL=file:...sqlite`. No Supabase URL configured. |

---
Task ID: audit
Agent: audit-agent
Task: Phase 0 ground truth audit — produce AUDIT.md with module map, dependency graph, test coverage, risk smells, top-10 candidates.

Work Log:
- Read all key source files in src/lib/, src/app/api/, src/components/
- Produced AUDIT.md

Stage Summary:
- Audit complete. Key findings:
  1. Zero test coverage confirmed (0 test files; 8 pure-math modules including indicators, consensus, cointegration, hurst, triple-barrier, deflated-sharpe, vol-targeting, correlation are trivially testable but uncovered — these are the modules driving every trading decision).
  2. Three built-but-unwired advanced-analysis modules are dead code: `triple-barrier.ts` (header comment admits "NOT yet wired into grading.ts"), `deflated-sharpe.ts`, and `hurst.ts` — ~600 lines of latent functionality. The fixed-4h grading horizon they were meant to replace is still live and feeds `selftune.ts`, which mutates production trading thresholds.
  3. Two systemic risk smells: (a) `src/middleware.ts` whitelists `/api/*` as public, so every POST route — including `/api/llm/providers` (writes API keys), `/api/portfolio`, `/api/signals`, and `/api/brain` (setConfig/forceRun/resetBudget) — is reachable without auth; (b) 30+ magic numbers are scattered across engine.ts, consensus.ts, selftune.ts, triggers.ts, news-triggers.ts, deribit.ts, fear-greed-edge.ts with no central tunables file, and the tick route hardcodes $10,000 paper equity + 1.5×/2× ATR stop/TP overrides that silently discard LLM-provided levels.

---
Task ID: fix-tests
Agent: test-fixer
Task: Fix characterization tests to match actual implementation shapes.

Work Log:
- Read all 8 implementation files (indicators, consensus, cointegration, hurst, triple-barrier, deflated-sharpe, correlation, vol_targeting)
- Fixed all 6 test files to match actual field names/types:
  - indicators.test.ts: rsi→rsi14, ema20/50/200→ema12/26, summary.score→summaryScore, summary.buy/neutral/sell→votes, atr→atr14, trend values up/down/sideways (not bullish/bearish/neutral)
  - consensus.test.ts: rewrote mockIndicators + mockOrderbook shapes; buildSentimentLayer now takes NewsArticle[]; buildOnchainLayer takes OnchainTrend; computeConsensus takes ConsensusInput; shouldAlert takes {direction, conviction, summaryScore}+AlertThresholds
  - cointegration.test.ts: ols(y, x) arg order; adfTest degenerate threshold is n<5 (not 30); engleGranger pair is a string (never returns null); computeCointegrationMatrix returns {assets, entries, byPair}
  - edge-modules.test.ts: hurstExponent returns HurstResult (.hurst, .nPoints, .rSquared, .windowSizes, .fValues); classifyRegime returns HurstRegime (.label, .meanRevertOk, .momentumOk); tripleBarrierLabel config uses slMult/tpMult/holdingPeriod/direction, exitReason uses 'take-profit'/'stop-loss'/'timeout'; deflatedSharpeRatio takes DsrStats (perPeriodSharpe, excessKurtosis, nObservations) and returns DsrResult (.dsr, .verdict); moments returns excessKurtosis (not kurtosis); dsrVerdict returns string label
  - correlation.test.ts: pearsonCorrelation returns 0 (not NaN) for degenerate inputs; dailyReturns uses log returns; linearRegression(y, x) arg order; computeCorrelationMatrix returns {assets, entries, matrix}
  - vol_targeting.test.ts: already passing — no changes needed
- Used stronger AR(1) coefficients (φ=±0.7/0.85) for Hurst DFA tests since φ=±0.3 is too weak for DFA to register H clearly outside [0.45, 0.55] on 600-sample windows
- Used Box-Muller transform for moments test (uniform random has excessKurtosis ≈ -1.2, not 0)
- Used white-noise (not smooth sine) residual for engleGranger cointegration test — the simple no-lag ADF can't reject unit root on smooth oscillations
- Ran tests: 76/76 pass (verified stable across 5 consecutive runs)

Stage Summary:
- Characterization test suite established. 76/76 tests pass.
