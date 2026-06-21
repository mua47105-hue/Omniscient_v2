// Notification Center API — unified activity feed.
//
// GET /api/notifications?type=all|price|signal|telegram|system
//                        &severity=all|critical|warning|info
//                        &asset=SYMBOL
//                        &range=today|7d|30d|all
//                        &limit=50&offset=0
//
// Aggregates three Prisma sources into a single chronological timeline:
//   - PriceAlert  (status='triggered')  → type 'price'
//   - Signal      (status open/closed)  → type 'signal'
//   - Alert       (Telegram log)        → type 'telegram'
//
// Returns NotificationsResponse: items (sorted desc), total, unread (0 —
// the client computes unread from localStorage), counts (per type & severity),
// and mostActiveAsset.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type {
  ApiResult,
  NotificationCounts,
  NotificationItem,
  NotificationsResponse,
  NotificationSeverity,
  NotificationType,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseType(v: string | null): NotificationType | 'all' {
  if (v === 'price' || v === 'signal' || v === 'telegram' || v === 'system') return v;
  return 'all';
}

function parseSeverity(v: string | null): NotificationSeverity | 'all' {
  if (v === 'critical' || v === 'warning' || v === 'info') return v;
  return 'all';
}

function parseRange(v: string | null): 'today' | '7d' | '30d' | 'all' {
  if (v === 'today' || v === '7d' || v === '30d' || v === 'all') return v;
  return '7d';
}

function rangeStart(range: 'today' | '7d' | '30d' | 'all'): Date | null {
  if (range === 'all') return null;
  const now = new Date();
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = range === '7d' ? 7 : 30;
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d;
}

function assetMatches(filter: string | null, symbol?: string): boolean {
  if (!filter) return true;
  if (!symbol) return false;
  return symbol.toUpperCase().includes(filter.toUpperCase().trim());
}

function conditionVerb(c: string): string {
  switch (c) {
    case 'above':
      return 'crossed above';
    case 'below':
      return 'crossed below';
    case 'crosses_up':
      return 'crossed up through';
    case 'crosses_down':
      return 'crossed down through';
    default:
      return c;
  }
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface ConsensusPayload {
  asset?: string;
  direction?: string;
  conviction?: number;
  timeframe?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  rationale?: string;
  modelsUsed?: string[];
  layers?: Array<{ layer: string; score: number; confidence: number; detail: string }>;
}

// ---------------------------------------------------------------------------
// Main GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const typeFilter = parseType(sp.get('type'));
    const sevFilter = parseSeverity(sp.get('severity'));
    const assetFilter = sp.get('asset')?.trim() || '';
    const range = parseRange(sp.get('range'));
    const limit = Math.min(parseInt(sp.get('limit') || '50', 10) || 50, 200);
    const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0);

    const since = rangeStart(range);

    // ----- Parallel queries across the 3 sources -----
    const [triggeredAlerts, recentSignals, telegramAlerts] = await Promise.all([
      db.priceAlert.findMany({
        where: {
          status: 'triggered',
          ...(since ? { triggeredAt: { gte: since } } : {}),
        },
        orderBy: { triggeredAt: 'desc' },
        take: 500,
      }),
      db.signal.findMany({
        where: {
          ...(since ? { timestamp: { gte: since } } : {}),
          status: { in: ['open', 'closed', 'expired'] },
        },
        include: { asset: true },
        orderBy: { timestamp: 'desc' },
        take: 500,
      }),
      db.alert.findMany({
        where: {
          ...(since ? { createdAt: { gte: since } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    // ----- Normalize each source into NotificationItem[] -----
    const items: NotificationItem[] = [];

    // Triggered Price Alerts → 'price' type, severity 'info' (or 'warning' for crosses_*)
    for (const pa of triggeredAlerts) {
      const sym = pa.assetSymbol;
      if (!assetMatches(assetFilter, sym)) continue;
      const verb = conditionVerb(pa.condition);
      const severity: NotificationSeverity =
        pa.condition === 'crosses_up' || pa.condition === 'crosses_down' ? 'warning' : 'info';
      const triggeredPrice = pa.currentPrice ?? null;
      const title = `${sym} ${verb} ${pa.targetPrice}`;
      const messageParts: string[] = [
        `Target ${pa.targetPrice} ${pa.condition} hit at ${pa.triggeredAt ? new Date(pa.triggeredAt).toLocaleString() : '—'}.`,
      ];
      if (triggeredPrice != null) {
        messageParts.push(`Last price: ${triggeredPrice}.`);
      }
      if (pa.note) messageParts.push(`Note: ${pa.note}`);
      if (pa.channel && pa.channel !== 'dashboard') {
        messageParts.push(`Channel: ${pa.channel}.`);
      }
      items.push({
        id: `price:${pa.id}`,
        type: 'price',
        severity,
        title,
        message: messageParts.join(' '),
        assetSymbol: sym,
        timestamp: (pa.triggeredAt ?? pa.updatedAt).toISOString(),
        metadata: {
          condition: pa.condition,
          targetPrice: pa.targetPrice,
          triggeredPrice,
          channel: pa.channel,
          note: pa.note,
        },
      });
    }

    // Recent Signals → 'signal' type, severity by conviction (>=75 critical, >=50 warning, else info)
    for (const s of recentSignals) {
      const sym = s.asset?.symbol;
      if (!assetMatches(assetFilter, sym)) continue;
      const sev: NotificationSeverity =
        s.conviction >= 75 ? 'critical' : s.conviction >= 50 ? 'warning' : 'info';
      const dirLabel = s.direction === 'long' ? 'LONG' : s.direction === 'short' ? 'SHORT' : 'NEUTRAL';
      const title = `${sym ?? 'Asset'} — ${dirLabel} signal · ${s.conviction}% conviction`;
      const messageParts: string[] = [
        `New ${s.direction} signal on ${s.timeframe} timeframe with ${s.conviction}% conviction.`,
      ];
      if (s.entryPrice != null) messageParts.push(`Entry ${s.entryPrice}.`);
      if (s.stopLoss != null) messageParts.push(`SL ${s.stopLoss}.`);
      if (s.takeProfit != null) messageParts.push(`TP ${s.takeProfit}.`);
      const rationale = s.rationale?.trim();
      if (rationale) {
        messageParts.push(`Rationale: ${rationale.slice(0, 240)}${rationale.length > 240 ? '…' : ''}`);
      }
      items.push({
        id: `signal:${s.id}`,
        type: 'signal',
        severity: sev,
        title,
        message: messageParts.join(' '),
        assetSymbol: sym,
        timestamp: s.timestamp.toISOString(),
        metadata: {
          direction: s.direction as any,
          conviction: s.conviction,
          timeframe: s.timeframe,
          entryPrice: s.entryPrice,
          stopLoss: s.stopLoss,
          takeProfit: s.takeProfit,
          rationale: s.rationale,
          layersSummary: s.layersSummary,
          modelsUsed: s.modelsUsed,
          signalStatus: s.status,
          assetId: s.assetId,
        },
      });
    }

    // Telegram Alerts → 'telegram' type, severity by alert status (failed=critical, sent=info)
    for (const a of telegramAlerts) {
      const payload = safeParse<ConsensusPayload>(a.payload, {});
      const sym = payload.asset;
      if (!assetMatches(assetFilter, sym)) continue;
      const sev: NotificationSeverity = a.status === 'failed' ? 'critical' : 'info';
      const dirLabel =
        payload.direction === 'long' ? 'LONG' : payload.direction === 'short' ? 'SHORT' : 'NEUTRAL';
      const title = a.status === 'failed'
        ? `Telegram alert failed — ${sym ?? 'signal'}`
        : `Telegram alert sent — ${sym ?? 'signal'} ${dirLabel}`;
      const messageParts: string[] = [];
      if (sym) messageParts.push(`${sym} ${dirLabel} signal (${payload.conviction ?? 0}% conviction, ${payload.timeframe ?? '—'}).`);
      if (a.status === 'failed' && a.error) {
        messageParts.push(`Error: ${a.error.slice(0, 200)}`);
      } else {
        messageParts.push(`Delivered via ${a.channel} at ${a.sentAt ? new Date(a.sentAt).toLocaleString() : '—'}.`);
      }
      const rationale = payload.rationale?.trim();
      if (rationale) {
        messageParts.push(`Rationale: ${rationale.slice(0, 180)}${rationale.length > 180 ? '…' : ''}`);
      }
      items.push({
        id: `telegram:${a.id}`,
        type: 'telegram',
        severity: sev,
        title,
        message: messageParts.join(' '),
        assetSymbol: sym,
        timestamp: (a.sentAt ?? a.createdAt).toISOString(),
        metadata: {
          direction: payload.direction as any,
          conviction: payload.conviction,
          timeframe: payload.timeframe,
          entryPrice: payload.entryPrice,
          stopLoss: payload.stopLoss,
          takeProfit: payload.takeProfit,
          rationale: payload.rationale,
          modelsUsed: payload.modelsUsed ? JSON.stringify(payload.modelsUsed) : undefined,
          alertStatus: a.status,
          error: a.error,
          signalId: a.signalId,
        },
      });
    }

    // ----- Sort all items desc by timestamp -----
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // ----- Compute counts over the FULL filtered set (before pagination) -----
    const counts: NotificationCounts = {
      type: { price: 0, signal: 0, telegram: 0, system: 0 },
      severity: { critical: 0, warning: 0, info: 0 },
    };
    const assetTally = new Map<string, number>();
    for (const it of items) {
      counts.type[it.type]++;
      counts.severity[it.severity]++;
      if (it.assetSymbol) {
        assetTally.set(it.assetSymbol, (assetTally.get(it.assetSymbol) ?? 0) + 1);
      }
    }

    // ----- Apply type / severity filters (counts were computed pre-filter
    //       so they always reflect the full available set per the
    //       asset+range filter — for the filter-bar badges) -----
    const filtered = items.filter((it) => {
      if (typeFilter !== 'all' && it.type !== typeFilter) return false;
      if (sevFilter !== 'all' && it.severity !== sevFilter) return false;
      return true;
    });

    // ----- Most active asset -----
    let mostActiveAsset: { symbol: string; count: number } | null = null;
    for (const [symbol, count] of assetTally) {
      if (!mostActiveAsset || count > mostActiveAsset.count) {
        mostActiveAsset = { symbol, count };
      }
    }

    // ----- Pagination -----
    const paged = filtered.slice(offset, offset + limit);

    const body: NotificationsResponse = {
      items: paged,
      total: filtered.length,
      // Unread is computed client-side from localStorage; the API reports 0 so
      // the response shape stays stable. (Server doesn't track read state.)
      unread: 0,
      counts,
      mostActiveAsset,
    };

    return NextResponse.json<ApiResult<NotificationsResponse>>({
      success: true,
      data: body,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
