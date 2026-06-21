/**
 * Brain control API.
 *
 *   GET  → full brain snapshot (running/mode/config/budget/llm/thinking/stats/
 *          samples/tuneEvents/watch/recentActions/forceRunQueue).
 *   POST → {action: pause|resume|setMode|setConfig|forceRun|resetBudget, ...}.
 *          forceRun calls forceRun(symbol,'manual') + recordTrigger('manual').
 *          Returns the updated snapshot.
 *
 * All routes are force-dynamic (no caching) — the brain state lives in
 * process memory and changes every tick.
 */
import { NextResponse } from 'next/server';
import {
  hydrate,
  snapshot,
  setRunning,
  setMode,
  setConfig,
  forceRun,
  resetBudget,
  recordTrigger,
  type BrainMode,
  type BrainConfig,
} from '@/lib/brain/state';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await hydrate();
    return NextResponse.json({ success: true, data: snapshot() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

interface BrainPostBody {
  action: 'pause' | 'resume' | 'setMode' | 'setConfig' | 'forceRun' | 'resetBudget';
  mode?: BrainMode;
  config?: Partial<BrainConfig>;
  symbol?: string;
}

export async function POST(req: Request) {
  try {
    await hydrate();

    let body: BrainPostBody;
    try {
      body = (await req.json()) as BrainPostBody;
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid JSON body' },
        { status: 400 },
      );
    }

    const { action } = body;
    if (!action) {
      return NextResponse.json(
        { success: false, error: 'missing action' },
        { status: 400 },
      );
    }

    switch (action) {
      case 'pause':
        setRunning(false);
        break;
      case 'resume':
        setRunning(true);
        break;
      case 'setMode': {
        if (body.mode !== 'auto' && body.mode !== 'manual') {
          return NextResponse.json(
            { success: false, error: 'invalid mode (must be auto|manual)' },
            { status: 400 },
          );
        }
        setMode(body.mode);
        break;
      }
      case 'setConfig': {
        if (!body.config || typeof body.config !== 'object') {
          return NextResponse.json(
            { success: false, error: 'missing config object' },
            { status: 400 },
          );
        }
        setConfig(body.config);
        break;
      }
      case 'forceRun': {
        if (!body.symbol || typeof body.symbol !== 'string') {
          return NextResponse.json(
            { success: false, error: 'missing symbol' },
            { status: 400 },
          );
        }
        forceRun(body.symbol.toUpperCase(), 'manual');
        recordTrigger('manual');
        break;
      }
      case 'resetBudget':
        resetBudget();
        break;
      default:
        return NextResponse.json(
          { success: false, error: `unknown action: ${action}` },
          { status: 400 },
        );
    }

    return NextResponse.json({ success: true, data: snapshot() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
