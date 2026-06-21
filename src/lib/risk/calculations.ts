/**
 * Pure-TypeScript risk / position-sizing calculation helpers.
 *
 * No React, no DOM — every formula lives here so it can be unit-tested and
 * reused by the Risk Calculator UI, the portfolio P&L engine, the signal
 * grader, etc.
 *
 * Conventions
 * -----------
 * - All money values are in **USD** (account currency).
 * - All percentages are stored as **percent numbers** (e.g. 1.5 means 1.5%),
 *   NOT as fractions (0.015). The helpers convert internally.
 * - "Entry" is the price at which the trader opens the position.
 * - "Stop"  is the price at which the trader exits for a loss.
 * - "TP"    is the price at which the trader exits for a profit.
 * - `direction` is `'long' | 'short'`. For longs, SL < Entry < TP.
 *   For shorts, TP < Entry < SL.
 * - Every helper returns `null` for the offending field when the inputs are
 *   invalid (NaN, division by zero, wrong direction, etc.) so the UI can
 *   render an em-dash gracefully.
 */

export type TradeDirection = 'long' | 'short';

// ---------------------------------------------------------------------------
// 1. Position size
// ---------------------------------------------------------------------------

export interface PositionSizeInput {
  accountSize: number;
  riskPct: number; // e.g. 1.5 = 1.5%
  entryPrice: number;
  stopLossPrice: number;
  direction?: TradeDirection; // optional — defaults to long
}

export interface PositionSizeResult {
  riskAmount: number; // $ at risk
  riskPerUnit: number; // |entry − stop|
  positionSize: number; // units of the asset
  positionValue: number; // $ exposure = size × entry
  potentialLoss: number; // $ (equals riskAmount when sizing correctly)
  direction: TradeDirection;
  valid: boolean;
  errors: string[];
}

/**
 * Calculate the position size (units) a trader may take so that hitting the
 * stop loss costs exactly `riskPct%` of the account.
 *
 *   riskAmount      = accountSize × riskPct / 100
 *   riskPerUnit     = |entry − stop|
 *   positionSize    = riskAmount / riskPerUnit
 *   positionValue   = positionSize × entry
 *   potentialLoss   = positionSize × riskPerUnit   (= riskAmount by design)
 */
export function calculatePositionSize(
  input: PositionSizeInput,
): PositionSizeResult {
  const { accountSize, riskPct, entryPrice, stopLossPrice } = input;
  const direction = input.direction ?? 'long';
  const errors: string[] = [];

  if (!isFinite(accountSize) || accountSize <= 0) errors.push('Account size must be > 0');
  if (!isFinite(riskPct) || riskPct <= 0) errors.push('Risk % must be > 0');
  if (!isFinite(entryPrice) || entryPrice <= 0) errors.push('Entry price must be > 0');
  if (!isFinite(stopLossPrice) || stopLossPrice <= 0) errors.push('Stop-loss price must be > 0');
  if (
    isFinite(entryPrice) &&
    isFinite(stopLossPrice) &&
    entryPrice === stopLossPrice
  ) {
    errors.push('Entry and stop cannot be the same');
  }
  if (
    direction === 'long' &&
    isFinite(entryPrice) &&
    isFinite(stopLossPrice) &&
    stopLossPrice >= entryPrice
  ) {
    errors.push('For a long, stop must be below entry');
  }
  if (
    direction === 'short' &&
    isFinite(entryPrice) &&
    isFinite(stopLossPrice) &&
    stopLossPrice <= entryPrice
  ) {
    errors.push('For a short, stop must be above entry');
  }

  if (errors.length > 0) {
    return {
      riskAmount: 0,
      riskPerUnit: 0,
      positionSize: 0,
      positionValue: 0,
      potentialLoss: 0,
      direction,
      valid: false,
      errors,
    };
  }

  const riskAmount = accountSize * (riskPct / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
  const positionSize = riskAmount / riskPerUnit;
  const positionValue = positionSize * entryPrice;
  const potentialLoss = positionSize * riskPerUnit;

  return {
    riskAmount,
    riskPerUnit,
    positionSize,
    positionValue,
    potentialLoss,
    direction,
    valid: true,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// 2. Risk / Reward
// ---------------------------------------------------------------------------

export interface RiskRewardInput {
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  positionSize?: number; // optional — for $ P&L
  direction?: TradeDirection;
}

export interface RiskRewardResult {
  riskPerUnit: number;
  rewardPerUnit: number;
  ratio: number | null; // reward / risk
  potentialProfit: number | null; // $ if positionSize provided
  potentialLoss: number | null; // $ if positionSize provided
  rMultiple: number | null; // alias of ratio
  valid: boolean;
  errors: string[];
}

/**
 * Risk/Reward ratio = reward per unit / risk per unit.
 *
 *   riskPerUnit   = |entry − stop|
 *   rewardPerUnit = |TP − entry|
 *   ratio         = rewardPerUnit / riskPerUnit   (e.g. 2 = "2R")
 *
 * For shorts, the absolute values still hold — reward = |entry − TP|.
 */
export function calculateRiskReward(input: RiskRewardInput): RiskRewardResult {
  const { entryPrice, stopLossPrice, takeProfitPrice, positionSize } = input;
  const direction = input.direction ?? 'long';
  const errors: string[] = [];

  if (!isFinite(entryPrice) || entryPrice <= 0) errors.push('Entry price must be > 0');
  if (!isFinite(stopLossPrice) || stopLossPrice <= 0) errors.push('Stop-loss price must be > 0');
  if (takeProfitPrice != null && (!isFinite(takeProfitPrice) || takeProfitPrice <= 0)) {
    errors.push('Take-profit price must be > 0');
  }
  if (entryPrice === stopLossPrice) errors.push('Entry and stop cannot be the same');

  // Direction sanity-checks only when TP is provided.
  if (takeProfitPrice != null) {
    if (direction === 'long' && takeProfitPrice <= entryPrice) {
      errors.push('For a long, take-profit must be above entry');
    }
    if (direction === 'short' && takeProfitPrice >= entryPrice) {
      errors.push('For a short, take-profit must be below entry');
    }
  }

  if (errors.length > 0 || takeProfitPrice == null) {
    return {
      riskPerUnit: isFinite(entryPrice) && isFinite(stopLossPrice)
        ? Math.abs(entryPrice - stopLossPrice)
        : 0,
      rewardPerUnit: 0,
      ratio: null,
      potentialProfit: null,
      potentialLoss: positionSize != null && isFinite(positionSize)
        ? positionSize * Math.abs(entryPrice - stopLossPrice)
        : null,
      rMultiple: null,
      valid: false,
      errors,
    };
  }

  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
  const rewardPerUnit = Math.abs(takeProfitPrice - entryPrice);
  const ratio = rewardPerUnit / riskPerUnit;
  const potentialLoss = positionSize != null ? positionSize * riskPerUnit : null;
  const potentialProfit = positionSize != null ? positionSize * rewardPerUnit : null;

  return {
    riskPerUnit,
    rewardPerUnit,
    ratio,
    potentialProfit,
    potentialLoss,
    rMultiple: ratio,
    valid: true,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// 3. Leverage & liquidation
// ---------------------------------------------------------------------------

export interface LeverageInput {
  entryPrice: number;
  leverage: number; // e.g. 10 = 10x
  positionValue?: number; // $ exposure — preferred input
  positionSize?: number; // units — alternative input (computed with entry)
  direction?: TradeDirection;
  maintenanceMarginPct?: number; // e.g. 0.5 = 0.5% — for warning threshold
}

export interface LeverageResult {
  marginRequired: number; // $ = positionValue / leverage
  positionValue: number;
  positionSize: number | null;
  liquidationPrice: number | null;
  liqFormula: string; // human-readable formula string
  maintenanceMargin: number; // $ the exchange would require to keep open
  maintenanceMarginRatio: number; // mMargin / positionValue
  riskLevel: 'safe' | 'caution' | 'danger';
  warning: string | null;
  valid: boolean;
  errors: string[];
}

/**
 * Margin & liquidation price (isolated-margin, simplified model — exchanges
 * use slightly different formulas + fees, but this is the textbook one used
 * by every "what is my liquidation price" educational tool).
 *
 *   marginRequired   = positionValue / leverage
 *   liqPrice (long)  = entry × (1 − 1/leverage)
 *   liqPrice (short) = entry × (1 + 1/leverage)
 *
 * Maintenance margin is typically ~0.5% of position value on crypto perps;
 * we use it to flag a warning at high leverage.
 */
export function calculateLiquidation(input: LeverageInput): LeverageResult {
  const { entryPrice, leverage, direction = 'long' } = input;
  const maintenanceMarginPct = input.maintenanceMarginPct ?? 0.5; // 0.5%
  const errors: string[] = [];

  if (!isFinite(entryPrice) || entryPrice <= 0) errors.push('Entry price must be > 0');
  if (!isFinite(leverage) || leverage <= 0) errors.push('Leverage must be > 0');

  let positionValue = 0;
  if (input.positionValue != null && isFinite(input.positionValue) && input.positionValue > 0) {
    positionValue = input.positionValue;
  } else if (input.positionSize != null && isFinite(input.positionSize) && input.positionSize > 0) {
    positionValue = input.positionSize * entryPrice;
  } else {
    errors.push('Provide either positionValue ($) or positionSize (units)');
  }

  if (errors.length > 0) {
    return {
      marginRequired: 0,
      positionValue: 0,
      positionSize: null,
      liquidationPrice: null,
      liqFormula: '',
      maintenanceMargin: 0,
      maintenanceMarginRatio: 0,
      riskLevel: 'danger',
      warning: null,
      valid: false,
      errors,
    };
  }

  const marginRequired = positionValue / leverage;
  const positionSize = input.positionSize ?? positionValue / entryPrice;
  const invLev = 1 / leverage;

  const liquidationPrice =
    direction === 'long'
      ? entryPrice * (1 - invLev)
      : entryPrice * (1 + invLev);

  const liqFormula =
    direction === 'long'
      ? `Entry × (1 − 1/Leverage) = ${entryPrice} × (1 − 1/${leverage})`
      : `Entry × (1 + 1/Leverage) = ${entryPrice} × (1 + 1/${leverage})`;

  const maintenanceMargin = positionValue * (maintenanceMarginPct / 100);
  const maintenanceMarginRatio = maintenanceMargin / positionValue;

  // Risk level heuristic on leverage
  let riskLevel: 'safe' | 'caution' | 'danger' = 'safe';
  if (leverage > 10) riskLevel = 'danger';
  else if (leverage > 5) riskLevel = 'caution';

  // Warning when margin is close to maintenance threshold (within 2x)
  let warning: string | null = null;
  if (marginRequired < maintenanceMargin * 2) {
    warning =
      `Margin ($${marginRequired.toFixed(2)}) is within 2× of the maintenance margin ` +
      `($${maintenanceMargin.toFixed(2)}). At this leverage a small adverse move ` +
      `can trigger liquidation.`;
  }
  if (leverage > 20) {
    warning =
      (warning ? warning + ' ' : '') +
      `Leverage > 20× is extremely risky — a ${(invLev * 100).toFixed(2)}% adverse move ` +
      `liquidates the position.`;
  }

  return {
    marginRequired,
    positionValue,
    positionSize,
    liquidationPrice,
    liqFormula,
    maintenanceMargin,
    maintenanceMarginRatio,
    riskLevel,
    warning,
    valid: true,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// 4. Multi-trade portfolio risk
// ---------------------------------------------------------------------------

export interface PortfolioPositionInput {
  id: string;
  symbol: string;
  entryPrice: number;
  stopLossPrice: number;
  positionSize: number; // units
  direction?: TradeDirection;
  /** Optional grouping key used to detect correlated risk (e.g. assetClass). */
  group?: string;
}

export interface PortfolioRiskResult {
  positions: Array<{
    id: string;
    symbol: string;
    riskAmount: number; // $ at risk on this single trade
    riskPctOfAccount: number; // % of account
    group?: string;
  }>;
  totalRiskAmount: number;
  totalRiskPct: number; // % of account at risk across all open trades
  correlatedGroups: Array<{
    group: string;
    riskPct: number;
    warning: boolean;
  }>;
  correlatedWarning: string | null; // human-readable, only if > 6% on a related group
  maxPortfolioRiskExceeded: boolean; // true if total > 6%
  warning: string | null;
  valid: boolean;
  errors: string[];
}

/**
 * Aggregate the risk of a basket of open positions against a single account.
 *
 * - Per position:  riskAmount = size × |entry − stop|
 * - Total:         totalRiskPct = Σ riskAmount / accountSize × 100
 * - Correlated-risk warning: if the sum of riskPct for positions sharing the
 *   same `group` (e.g. "crypto" / "BTC-correlated") exceeds 6% of the
 *   account, flag it.
 * - Portfolio max: 6% rule — total portfolio risk above this is dangerous.
 */
export function calculatePortfolioRisk(
  accountSize: number,
  positions: PortfolioPositionInput[],
): PortfolioRiskResult {
  const errors: string[] = [];
  if (!isFinite(accountSize) || accountSize <= 0) errors.push('Account size must be > 0');
  if (!Array.isArray(positions)) errors.push('Positions must be an array');

  if (errors.length > 0) {
    return {
      positions: [],
      totalRiskAmount: 0,
      totalRiskPct: 0,
      correlatedGroups: [],
      correlatedWarning: null,
      maxPortfolioRiskExceeded: false,
      warning: null,
      valid: false,
      errors,
    };
  }

  const enriched = positions.map((p) => {
    const riskPerUnit = Math.abs(p.entryPrice - p.stopLossPrice);
    const riskAmount = p.positionSize * riskPerUnit;
    const riskPctOfAccount = (riskAmount / accountSize) * 100;
    return {
      id: p.id,
      symbol: p.symbol,
      riskAmount: isFinite(riskAmount) ? riskAmount : 0,
      riskPctOfAccount: isFinite(riskPctOfAccount) ? riskPctOfAccount : 0,
      group: p.group,
    };
  });

  const totalRiskAmount = enriched.reduce((s, p) => s + p.riskAmount, 0);
  const totalRiskPct = (totalRiskAmount / accountSize) * 100;

  // Group correlated risks
  const groupMap: Record<string, number> = {};
  for (const p of enriched) {
    const g = p.group || 'ungrouped';
    groupMap[g] = (groupMap[g] || 0) + p.riskPctOfAccount;
  }
  const correlatedGroups = Object.entries(groupMap)
    .map(([group, riskPct]) => ({
      group,
      riskPct,
      warning: riskPct > 6,
    }))
    .sort((a, b) => b.riskPct - a.riskPct);

  const flaggedGroup = correlatedGroups.find((g) => g.warning);
  const correlatedWarning = flaggedGroup
    ? `Correlated risk on "${flaggedGroup.group}" is ${flaggedGroup.riskPct.toFixed(
        2,
      )}% of account — above the 6% safe limit. Reduce size on related positions.`
    : null;

  const maxPortfolioRiskExceeded = totalRiskPct > 6;

  const warning = maxPortfolioRiskExceeded
    ? `Total portfolio risk is ${totalRiskPct.toFixed(2)}% of account — above the 6% maximum. Close or reduce positions before adding new ones.`
    : null;

  return {
    positions: enriched,
    totalRiskAmount,
    totalRiskPct,
    correlatedGroups,
    correlatedWarning,
    maxPortfolioRiskExceeded,
    warning,
    valid: true,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers (UI-only, but kept with the maths for cohesion)
// ---------------------------------------------------------------------------

export function fmtUsd(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v == null || !isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (opts?.compact) {
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(2)}K`;
  }
  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtQty(q: number | null | undefined): string {
  if (q == null || !isFinite(q)) return '—';
  if (q >= 1000) return q.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (q >= 1) return q.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return q.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function fmtPrice(p: number | null | undefined): string {
  if (p == null || !isFinite(p) || p === 0) return '—';
  if (p >= 10000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toFixed(6);
}

export function fmtPct(p: number | null | undefined, withSign = false): string {
  if (p == null || !isFinite(p)) return '—';
  const sign = withSign && p > 0 ? '+' : '';
  return `${sign}${p.toFixed(2)}%`;
}

/** Format a number with up to 6 significant digits — used for leverage ratios. */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}
