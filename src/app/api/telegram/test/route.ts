// Telegram test endpoint — sends a test message to verify the bot config.
import { NextResponse } from 'next/server';
import { sendTestMessage } from '@/lib/alerts/telegram';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const ok = await sendTestMessage();
    if (ok) {
      return NextResponse.json<ApiResult<{ ok: boolean }>>({ success: true, data: { ok: true } });
    }
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Telegram test failed — check your bot token and chat ID' },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message?.slice(0, 200) || 'Unknown error' },
      { status: 200 }
    );
  }
}
