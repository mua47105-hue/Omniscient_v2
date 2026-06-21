/**
 * Settings KV API.
 *
 * GET /api/settings
 *   Returns all settings as a {key: value} object (JSON-parsed where
 *   possible, raw string otherwise).
 *
 * POST /api/settings  body: {key: string, value: any}
 *   Upserts a single setting. Strings stored verbatim; objects/arrays/
 *   booleans/numbers JSON-stringified.
 *
 * Both routes force-dynamic — settings may change at any time and must not
 * be cached at the edge.
 */
import { NextResponse } from 'next/server';
import {
  getAllSettings,
  setSetting,
} from '@/lib/config/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = await getAllSettings();
    return NextResponse.json({ success: true, data: settings });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

interface SetSettingBody {
  key: string;
  value: unknown;
}

export async function POST(req: Request) {
  try {
    let body: SetSettingBody;
    try {
      body = (await req.json()) as SetSettingBody;
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid JSON body' },
        { status: 400 },
      );
    }

    if (!body.key || typeof body.key !== 'string') {
      return NextResponse.json(
        { success: false, error: 'key required' },
        { status: 400 },
      );
    }
    if (body.value === undefined) {
      return NextResponse.json(
        { success: false, error: 'value required' },
        { status: 400 },
      );
    }

    await setSetting(body.key, body.value);
    const all = await getAllSettings();
    return NextResponse.json({
      success: true,
      data: { key: body.key, value: body.value, all },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
