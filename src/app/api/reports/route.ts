/**
 * Reports API.
 *
 * GET /api/reports?type=daily|weekly|monthly|all&limit=50
 *   Returns Report records ordered by createdAt desc.
 *
 * POST /api/reports
 *   Create a new report. Body: { type, period, title, contentMd }
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') ?? '50', 10) || 50));

    const rows = await db.report.findMany({
      where: type && ['daily', 'weekly', 'monthly'].includes(type) ? { type } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

interface CreateBody {
  type: string;
  period: string;
  title: string;
  contentMd: string;
}

export async function POST(req: Request) {
  try {
    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid JSON body' },
        { status: 400 },
      );
    }

    if (!body.type || !body.period || !body.title || !body.contentMd) {
      return NextResponse.json(
        { success: false, error: 'type, period, title, contentMd all required' },
        { status: 400 },
      );
    }

    const row = await db.report.create({
      data: {
        type: body.type,
        period: body.period,
        title: body.title,
        contentMd: body.contentMd,
      },
    });
    return NextResponse.json({ success: true, data: row });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
