/**
 * Price-alert checker.
 *
 *  - Fetches all PriceAlerts with status='active'.
 *  - Fetches the current price for each (Binance for crypto, Yahoo for the
 *    rest — same logic as grading.ts).
 *  - Fires when condition matches:
 *      'above':       current >= targetPrice
 *      'below':       current <= targetPrice
 *      'crosses_up':  previousClose < target && current >= target  (simplified: current >= target)
 *      'crosses_down':previousClose > target && current <= target  (simplified: current <= target)
 *  - On match: updates the row (status='triggered', triggeredAt, currentPrice)
 *    and pushes a result. The caller (scheduler tick / API route) is
 *    responsible for delivering the alert through whatever channel.
 *  - Returns {checked, triggered, results}.
 */
import db from '@/lib/db';
import { getTicker24h } from '@/lib/market/binance';
import { getMacroQuote } from '@/lib/market/macro';

export interface PriceAlertResult {
  id: string;
  assetSymbol: string;
  condition: string;
  targetPrice: number;
  currentPrice: number | null;
  triggered: boolean;
  error?: string;
}

export interface PriceAlertSummary {
  checked: number;
  triggered: number;
  results: PriceAlertResult[];
}

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  // Crypto heuristic: ends in USDT or looks like a futures pair.
  const upper = symbol.toUpperCase();
  if (upper.endsWith('USDT') || upper.endsWith('USD')) {
    const binanceSymbol = upper.endsWith('USDT') ? upper : upper + 'T';
    try {
      const t = await getTicker24h(binanceSymbol);
      if (Number.isFinite(t.lastPrice) && t.lastPrice > 0) return t.lastPrice;
    } catch {
      /* fall through to Yahoo */
    }
  }
  try {
    const q = await getMacroQuote(symbol);
    if (q && Number.isFinite(q.price) && q.price > 0) return q.price;
  } catch {
    /* ignore */
  }
  return null;
}

function matches(
  condition: string,
  current: number,
  target: number,
): boolean {
  switch ((condition || '').toLowerCase()) {
    case 'above':
    case 'crosses_up':
      return current >= target;
    case 'below':
    case 'crosses_down':
      return current <= target;
    case 'percent_change':
      // Reserved for future use — never matches here.
      return false;
    default:
      return false;
  }
}

export async function checkPriceAlerts(): Promise<PriceAlertSummary> {
  const results: PriceAlertResult[] = [];
  let checked = 0;
  let triggered = 0;

  let alerts: any[] = [];
  try {
    alerts = await db.priceAlert.findMany({
      where: { status: 'active' },
      take: 200,
    });
  } catch (err) {
    console.error('[price-alerts] query failed:', err);
    return { checked: 0, triggered: 0, results: [] };
  }

  for (const a of alerts) {
    checked++;
    try {
      const current = await fetchCurrentPrice(a.assetSymbol);
      if (current == null || !Number.isFinite(current)) {
        results.push({
          id: a.id,
          assetSymbol: a.assetSymbol,
          condition: a.condition,
          targetPrice: a.targetPrice,
          currentPrice: null,
          triggered: false,
          error: 'price fetch failed',
        });
        continue;
      }

      // Persist the currentPrice so the UI / next tick can see the latest.
      const didFire = matches(a.condition, current, a.targetPrice);
      if (didFire) {
        await db.priceAlert.update({
          where: { id: a.id },
          data: {
            status: 'triggered',
            currentPrice: current,
            triggeredAt: new Date(),
          },
        });
        triggered++;
      } else {
        // Light-touch update — don't bump updatedAt unnecessarily on every tick.
        await db.priceAlert.update({
          where: { id: a.id },
          data: { currentPrice: current },
        });
      }

      results.push({
        id: a.id,
        assetSymbol: a.assetSymbol,
        condition: a.condition,
        targetPrice: a.targetPrice,
        currentPrice: current,
        triggered: didFire,
      });
    } catch (err) {
      console.error(`[price-alerts] alert ${a.id} failed:`, err);
      results.push({
        id: a.id,
        assetSymbol: a.assetSymbol,
        condition: a.condition,
        targetPrice: a.targetPrice,
        currentPrice: null,
        triggered: false,
        error: (err as Error).message,
      });
    }
  }

  return { checked, triggered, results };
}
