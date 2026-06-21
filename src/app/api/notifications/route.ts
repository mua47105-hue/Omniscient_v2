/**
 * Notifications API — unified activity feed.
 *
 * GET /api/notifications?type=alert|signal|price|all&limit=50
 *
 * Aggregates three sources into a single chronologically-sorted feed:
 *   - PriceAlert (status='triggered') — type 'price'
 *   - Signal (recent, all statuses)    — type 'signal'
 *   - Alert (sent alerts)              — type 'alert'
 *
 * Each row is normalized to a NotificationItem shape so the UI can render a
 * single list.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

interface NotificationItem {
  id: string;
  type: 'price' | 'signal' | 'alert';
  title: string;
  body: string;
  timestamp: string;
  status: string;
  channel?: string;
  meta?: Record<string, unknown>;
}

function safeParse(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type'); // 'alert' | 'signal' | 'price' | null = all
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') ?? '50', 10) || 50));

    const items: NotificationItem[] = [];

    // Price alerts (triggered).
    if (!type || type === 'price') {
      const priceAlerts = await db.priceAlert.findMany({
        where: { status: 'triggered' },
        orderBy: { triggeredAt: 'desc' },
        take: limit,
      });
      for (const pa of priceAlerts) {
        items.push({
          id: `price-${pa.id}`,
          type: 'price',
          title: `${pa.assetSymbol} ${pa.condition} $${pa.targetPrice}`,
          body: pa.note ?? `Triggered at $${pa.currentPrice ?? '?'}`,
          timestamp: pa.triggeredAt?.toISOString() ?? pa.createdAt.toISOString(),
          status: pa.status,
          channel: pa.channel,
          meta: {
            assetSymbol: pa.assetSymbol,
            condition: pa.condition,
            targetPrice: pa.targetPrice,
            currentPrice: pa.currentPrice,
          },
        });
      }
    }

    // Recent signals.
    if (!type || type === 'signal') {
      const signals = await db.signal.findMany({
        where: type ? undefined : undefined,
        include: { asset: true },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
      for (const s of signals) {
        items.push({
          id: `signal-${s.id}`,
          type: 'signal',
          title: `${s.asset?.symbol ?? '?'} ${s.direction.toUpperCase()} @ ${s.conviction}%`,
          body: s.rationale?.slice(0, 240) ?? '',
          timestamp: s.timestamp.toISOString(),
          status: s.status,
          meta: {
            direction: s.direction,
            conviction: s.conviction,
            timeframe: s.timeframe,
            entryPrice: s.entryPrice,
            stopLoss: s.stopLoss,
            takeProfit: s.takeProfit,
          },
        });
      }
    }

    // Sent alerts.
    if (!type || type === 'alert') {
      const alerts = await db.alert.findMany({
        where: { status: 'sent' },
        include: { signal: { include: { asset: true } } },
        orderBy: { sentAt: 'desc' },
        take: limit,
      });
      for (const a of alerts) {
        items.push({
          id: `alert-${a.id}`,
          type: 'alert',
          title: a.signal
            ? `${a.signal.asset?.symbol ?? '?'} ${a.signal.direction.toUpperCase()} alert`
            : `Alert via ${a.channel}`,
          body: JSON.stringify(safeParse(a.payload)).slice(0, 240),
          timestamp: a.sentAt?.toISOString() ?? a.createdAt.toISOString(),
          status: a.status,
          channel: a.channel,
        });
      }
    }

    // Sort all by timestamp desc and slice.
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const sliced = items.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: sliced,
      counts: {
        price: items.filter((i) => i.type === 'price').length,
        signal: items.filter((i) => i.type === 'signal').length,
        alert: items.filter((i) => i.type === 'alert').length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
