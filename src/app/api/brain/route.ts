// The Lazy Brain — control + state API.
// GET  → full snapshot (running, mode, config, budget, stats, watch, actions)
// POST → { action: pause|resume|setMode|setConfig|forceRun|resetBudget, ... }
import { NextRequest, NextResponse } from 'next/server';
import {
  hydrate, snapshot, setRunning, setMode, setConfig, forceRun, resetBudget,
  type BrainConfig,
} from '@/lib/brain/state';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  await hydrate();
  return NextResponse.json<ApiResult<ReturnType<typeof snapshot>>>({ success: true, data: snapshot() });
}

export async function POST(req: NextRequest) {
  await hydrate();
  try {
    const body = await req.json();
    const action: string = body.action;
    switch (action) {
      case 'pause':
        await setRunning(false);
        break;
      case 'resume':
        await setRunning(true);
        break;
      case 'setMode':
        if (body.mode === 'auto' || body.mode === 'manual') await setMode(body.mode);
        else return NextResponse.json<ApiResult<never>>({ success: false, error: 'mode must be auto|manual' }, { status: 400 });
        break;
      case 'setConfig': {
        // Patch only known BrainConfig fields; ignore anything else.
        const allowed: (keyof BrainConfig)[] = ['minNoteworthiness', 'highNoteworthiness', 'unanimousConviction', 'unanimousAgreement', 'cacheTtlMs', 'minReanalyzeMs', 'budgetCap', 'budgetWindowMs'];
        const patch: Partial<BrainConfig> = {};
        for (const k of allowed) {
          if (typeof body[k] === 'number' && isFinite(body[k])) patch[k] = body[k];
        }
        if (Object.keys(patch).length > 0) await setConfig(patch);
        break;
      }
      case 'forceRun':
        if (typeof body.symbol === 'string' && body.symbol.trim()) forceRun(body.symbol.trim());
        else return NextResponse.json<ApiResult<never>>({ success: false, error: 'symbol required' }, { status: 400 });
        break;
      case 'resetBudget':
        resetBudget();
        break;
      default:
        return NextResponse.json<ApiResult<never>>({ success: false, error: `unknown action: ${action}` }, { status: 400 });
    }
    return NextResponse.json<ApiResult<ReturnType<typeof snapshot>>>({ success: true, data: snapshot() });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
