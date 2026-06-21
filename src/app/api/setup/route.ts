/**
 * Setup status API.
 *
 * GET /api/setup
 *   Returns a status snapshot used by the setup/onboarding UI:
 *     - dbConnected
 *     - providersCount, activeProvidersCount
 *     - modelsCount
 *     - moduleConfigsCount, modulesCovered (which module keys have a config)
 *     - assetsCount (active crypto assets in watchlist)
 *     - signalsCount (recent 24h)
 *     - watchlistsCount
 *     - priceAlertsCount (active)
 *     - reportsCount
 *     - telegramConfigured, finnhubConfigured, supabaseConfigured
 *     - schedulerEnabled
 *     - appPasswordConfigured
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Parallel DB queries — best-effort, each wrapped in try/catch.
    const [
      providers,
      models,
      moduleConfigs,
      assetsCount,
      signalsCount,
      watchlistsCount,
      priceAlertsCount,
      reportsCount,
    ] = await Promise.all([
      db.llmProvider.count().catch(() => 0),
      db.llmModel.count().catch(() => 0),
      db.moduleModelConfig.findMany().catch(() => []),
      db.asset.count({ where: { isActive: true } }).catch(() => 0),
      db.signal
        .count({
          where: { timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        })
        .catch(() => 0),
      db.watchlist.count().catch(() => 0),
      db.priceAlert.count({ where: { status: 'active' } }).catch(() => 0),
      db.report.count().catch(() => 0),
    ]);

    const activeProvidersCount = await db.llmProvider
      .count({ where: { isActive: true } })
      .catch(() => 0);

    const modulesCovered = Array.isArray(moduleConfigs)
      ? Array.from(new Set(moduleConfigs.map((c: any) => c.moduleKey)))
      : [];

    const [telegramToken, telegramChatId, finnhubKey, supabaseUrl, supabaseKey, appPassword, schedulerEnabled] =
      await Promise.all([
        getSetting<string>(SETTING_KEYS.telegramBotToken),
        getSetting<string>(SETTING_KEYS.telegramChatId),
        getSetting<string>(SETTING_KEYS.finnhubApiKey),
        getSetting<string>(SETTING_KEYS.supabaseUrl),
        getSetting<string>(SETTING_KEYS.supabaseAnonKey),
        getSetting<string>(SETTING_KEYS.appPassword),
        getSetting<boolean>(SETTING_KEYS.schedulerEnabled),
      ]);

    return NextResponse.json({
      success: true,
      data: {
        dbConnected: true,
        providersCount: providers,
        activeProvidersCount,
        modelsCount: models,
        moduleConfigsCount: Array.isArray(moduleConfigs) ? moduleConfigs.length : 0,
        modulesCovered,
        assetsCount,
        signalsCount,
        watchlistsCount,
        priceAlertsCount,
        reportsCount,
        telegramConfigured: !!(telegramToken && telegramChatId),
        finnhubConfigured: !!finnhubKey,
        supabaseConfigured: !!(supabaseUrl && supabaseKey),
        appPasswordConfigured: !!appPassword,
        schedulerEnabled: schedulerEnabled !== false,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: (err as Error).message,
        data: { dbConnected: false },
      },
      { status: 500 },
    );
  }
}
