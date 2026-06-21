// Price Alerts — threshold monitoring engine.
//
// Shared `checkPriceAlerts()` is invoked both by the manual check API route
// (`/api/price-alerts/check`) and by the scheduler tick (best-effort, before
// crypto scans) so user-defined threshold alerts fire as soon as prices move.
//
// Conditions:
//   above        — currentPrice >= targetPrice
//   below        — currentPrice <= targetPrice
//   crosses_up   — currentPrice >= targetPrice AND lastCheckedPrice < targetPrice
//   crosses_down — currentPrice <= targetPrice AND lastCheckedPrice > targetPrice
//
// For crosses_* conditions, when there is no prior currentPrice (first check),
// we only record the price — we cannot know if a cross happened.

import { db } from '@/lib/db';
import { getTickers24h } from '@/lib/market/binance';
import { getYahooQuotesBySymbol } from '@/lib/market/macro';
import { sendTelegramMessage } from '@/lib/alerts/telegram';

export type PriceAlertCondition = 'above' | 'below' | 'crosses_up' | 'crosses_down';

export interface PriceAlertRow {
  id: string;
  assetSymbol: string;
  condition: string;
  targetPrice: number;
  currentPrice: number | null;
  status: string;
  channel: string;
  note: string | null;
  triggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceAlertCheckResultItem {
  alertId: string;
  symbol: string;
  triggered: boolean;
  currentPrice: number | null;
  error?: string;
}

export interface PriceAlertCheckSummary {
  checked: number;
  triggered: number;
  results: PriceAlertCheckResultItem[];
}

const VALID_CONDITIONS: PriceAlertCondition[] = [
  'above',
  'below',
  'crosses_up',
  'crosses_down',
];

export function isValidCondition(c: string): c is PriceAlertCondition {
  return (VALID_CONDITIONS as string[]).includes(c);
}

/**
 * Evaluate whether a price-alert should fire given the latest price.
 * Returns false (and does not fire) for crosses_* on first check (no prior price).
 */
export function evaluateCondition(
  condition: PriceAlertCondition,
  targetPrice: number,
  currentPrice: number,
  lastCheckedPrice: number | null,
): boolean {
  switch (condition) {
    case 'above':
      return currentPrice >= targetPrice;
    case 'below':
      return currentPrice <= targetPrice;
    case 'crosses_up':
      // Need a prior price to know whether we actually crossed.
      if (lastCheckedPrice == null) return false;
      return currentPrice >= targetPrice && lastCheckedPrice < targetPrice;
    case 'crosses_down':
      if (lastCheckedPrice == null) return false;
      return currentPrice <= targetPrice && lastCheckedPrice > targetPrice;
    default:
      return false;
  }
}

function formatTriggerMessage(
  symbol: string,
  condition: PriceAlertCondition,
  targetPrice: number,
  currentPrice: number,
): string {
  const condLabel =
    condition === 'above'
      ? 'crossed above'
      : condition === 'below'
        ? 'dropped below'
        : condition === 'crosses_up'
          ? 'crossed UP through'
          : 'crossed DOWN through';
  return `🔔 PRICE ALERT: ${symbol} ${condLabel} ${targetPrice} — now at ${currentPrice}`;
}

/**
 * Check every active PriceAlert against current market prices.
 * Updates `currentPrice` on every alert. On trigger: marks status='triggered',
 * records triggeredAt, dispatches Telegram (if channel includes telegram),
 * and creates an `Alert` log row.
 *
 * Safe to call from the scheduler — wraps each alert in its own try/catch so
 * a single asset failure never blocks the rest.
 */
export async function checkPriceAlerts(): Promise<PriceAlertCheckSummary> {
  const alerts = await db.priceAlert.findMany({
    where: { status: 'active' },
    orderBy: { createdAt: 'asc' },
  });

  if (alerts.length === 0) {
    return { checked: 0, triggered: 0, results: [] };
  }

  // Look up asset metadata once for every distinct symbol so we know whether
  // to fetch from Binance (crypto) or Yahoo (everything else).
  const distinctSymbols = [...new Set(alerts.map((a) => a.assetSymbol))];
  const assets = await db.asset.findMany({
    where: { symbol: { in: distinctSymbols } },
  });
  const assetBySymbol = new Map(assets.map((a) => [a.symbol, a]));

  // Partition symbols by source. Crypto → Binance (one batched call).
  // Non-crypto → Yahoo via meta.yahooSymbol.
  const cryptoSymbols: string[] = [];
  const yahooSymbolToOurSymbol = new Map<string, string>(); // yahooSym → our symbol
  for (const sym of distinctSymbols) {
    const asset = assetBySymbol.get(sym);
    if (asset && asset.assetClass === 'crypto') {
      cryptoSymbols.push(sym);
    } else if (asset) {
      let meta: any = {};
      try {
        meta = JSON.parse(asset.meta || '{}');
      } catch {
        /* ignore */
      }
      const yahooSym = meta.yahooSymbol || asset.symbol;
      yahooSymbolToOurSymbol.set(yahooSym, sym);
    } else {
      // Unknown asset — try Binance first (BTCUSDT-style), otherwise treat as Yahoo raw symbol.
      if (/USDT$|USDC$|BUSD$|BTC$|ETH$|BNB$/.test(sym)) {
        cryptoSymbols.push(sym);
      } else {
        yahooSymbolToOurSymbol.set(sym, sym);
      }
    }
  }

  // Fetch current prices — both sources in parallel.
  const prices = new Map<string, number>();
  const errors = new Map<string, string>();

  if (cryptoSymbols.length > 0) {
    try {
      const tickers = await getTickers24h(cryptoSymbols);
      for (const t of tickers) {
        prices.set(t.symbol, t.price);
      }
    } catch (e: any) {
      for (const s of cryptoSymbols) errors.set(s, `Binance: ${e.message}`);
    }
  }

  if (yahooSymbolToOurSymbol.size > 0) {
    try {
      const yahooQuotes = await getYahooQuotesBySymbol(
        [...yahooSymbolToOurSymbol.keys()],
        '1d',
      );
      for (const [yahooSym, quote] of Object.entries(yahooQuotes)) {
        const ourSym = yahooSymbolToOurSymbol.get(yahooSym);
        if (ourSym) prices.set(ourSym, quote.price);
      }
    } catch (e: any) {
      for (const ourSym of yahooSymbolToOurSymbol.values()) {
        if (!errors.has(ourSym)) errors.set(ourSym, `Yahoo: ${e.message}`);
      }
    }
  }

  const results: PriceAlertCheckResultItem[] = [];
  let triggeredCount = 0;

  for (const alert of alerts) {
    const item: PriceAlertCheckResultItem = {
      alertId: alert.id,
      symbol: alert.assetSymbol,
      triggered: false,
      currentPrice: null,
    };

    const price = prices.get(alert.assetSymbol);
    if (price == null || !isFinite(price)) {
      item.error = errors.get(alert.assetSymbol) || 'price unavailable';
      results.push(item);
      continue;
    }
    item.currentPrice = price;

    const condition = isValidCondition(alert.condition)
      ? (alert.condition as PriceAlertCondition)
      : null;
    if (!condition) {
      item.error = `invalid condition: ${alert.condition}`;
      results.push(item);
      continue;
    }

    const lastChecked = alert.currentPrice;
    const shouldTrigger = evaluateCondition(
      condition,
      alert.targetPrice,
      price,
      lastChecked,
    );

    try {
      if (shouldTrigger) {
        await db.priceAlert.update({
          where: { id: alert.id },
          data: {
            currentPrice: price,
            status: 'triggered',
            triggeredAt: new Date(),
          },
        });
        item.triggered = true;
        triggeredCount++;

        const sendTelegram =
          alert.channel === 'telegram' || alert.channel === 'both';
        const payload = JSON.stringify({
          kind: 'price_alert',
          alertId: alert.id,
          assetSymbol: alert.assetSymbol,
          condition: alert.condition,
          targetPrice: alert.targetPrice,
          currentPrice: price,
          note: alert.note,
        });

        if (sendTelegram) {
          try {
            const text = formatTriggerMessage(
              alert.assetSymbol,
              condition,
              alert.targetPrice,
              price,
            );
            await sendTelegramMessage(text, 'HTML');
            await db.alert.create({
              data: {
                channel: 'telegram',
                status: 'sent',
                sentAt: new Date(),
                payload,
              },
            });
          } catch (e: any) {
            // Telegram failed (bot not configured, network) — still log the alert
            // so the dashboard surfaces it. Don't re-trigger the price alert.
            await db.alert.create({
              data: {
                channel: 'telegram',
                status: 'failed',
                error: e.message?.slice(0, 500),
                payload,
              },
            });
          }
        } else {
          // Dashboard-only alert — log it so users have a record in the alerts table.
          await db.alert.create({
            data: {
              channel: 'dashboard',
              status: 'sent',
              sentAt: new Date(),
              payload,
            },
          });
        }
      } else {
        // Always update the last-checked price so crosses_* logic works next time.
        await db.priceAlert.update({
          where: { id: alert.id },
          data: { currentPrice: price },
        });
      }
    } catch (e: any) {
      item.error = `db: ${e.message}`;
    }

    results.push(item);
  }

  return {
    checked: alerts.length,
    triggered: triggeredCount,
    results,
  };
}
