// One-time migration: switch module configs + LLM models to known-working providers.
//
// Diagnosis that led to this:
//   - NVIDIA NIM `minimaxai/minimax-m3`  → 60s+ timeout (huge reasoning model)
//   - OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free` → 45s+ timeout (huge reasoning model)
//   - Gemini `gemini-flash-latest` → 400 "User location is not supported" (geo-blocked)
//   - Groq (all models) → 403 Cloudflare IP block
//   - Gemini `gemini-2.0-flash` → 429 quota exhausted
//   - Mistral `mistral-large-latest` → ✓ works in 689ms
//   - NVIDIA NIM `meta/llama-3.3-70b-instruct` → ✓ works in 189ms
//   - OpenRouter `meta-llama/llama-3.3-70b-instruct` (paid) → ✓ works in 415ms
//
// This script:
//   1. Deactivates broken models + activates working ones (without deleting anything).
//   2. Repoints ModuleModelConfig entries to the working provider+model.
//   3. Safe to re-run (idempotent upserts).

import { db } from '@/lib/db';

async function main() {
  console.log('=== LLM Provider/Model Migration ===\n');

  // --- NVIDIA NIM: add llama-3.3-70b-instruct, deactivate minimax-m3 ---
  const nim = await db.llmProvider.findFirst({ where: { name: 'NVIDIA NIM' } });
  if (nim) {
    await db.llmModel.upsert({
      where: { providerId_modelId: { providerId: nim.id, modelId: 'meta/llama-3.3-70b-instruct' } },
      create: {
        providerId: nim.id,
        modelId: 'meta/llama-3.3-70b-instruct',
        displayName: 'Llama 3.3 70B Instruct',
        contextWindow: 128000,
        freeTierRpm: 40,
        isActive: true,
        capabilities: JSON.stringify(['text', 'json']),
      },
      update: { isActive: true, displayName: 'Llama 3.3 70B Instruct' },
    });
    console.log('✓ NIM: added/activated meta/llama-3.3-70b-instruct');

    await db.llmModel.updateMany({
      where: { providerId: nim.id, modelId: 'minimaxai/minimax-m3' },
      data: { isActive: false },
    });
    console.log('✓ NIM: deactivated minimaxai/minimax-m3 (too slow — 60s+ timeout)');
  }

  // --- OpenRouter: add llama-3.3-70b-instruct (paid, cheap, fast), deactivate nemotron ---
  const or = await db.llmProvider.findFirst({ where: { name: 'OpenRouter' } });
  if (or) {
    await db.llmModel.upsert({
      where: { providerId_modelId: { providerId: or.id, modelId: 'meta-llama/llama-3.3-70b-instruct' } },
      create: {
        providerId: or.id,
        modelId: 'meta-llama/llama-3.3-70b-instruct',
        displayName: 'Llama 3.3 70B Instruct (paid)',
        contextWindow: 128000,
        freeTierRpm: 50,
        isActive: true,
        capabilities: JSON.stringify(['text', 'json']),
      },
      update: { isActive: true, displayName: 'Llama 3.3 70B Instruct (paid)' },
    });
    console.log('✓ OpenRouter: added/activated meta-llama/llama-3.3-70b-instruct');

    await db.llmModel.updateMany({
      where: { providerId: or.id, modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
      data: { isActive: false },
    });
    console.log('✓ OpenRouter: deactivated nvidia/nemotron-3-ultra-550b-a55b:free (too slow — 45s+ timeout)');
  }

  // --- Mistral: ensure mistral-large-latest is active (it already is, but be safe) ---
  const mistral = await db.llmProvider.findFirst({ where: { name: 'Mistral' } });
  if (mistral) {
    await db.llmModel.updateMany({
      where: { providerId: mistral.id, modelId: 'mistral-large-latest' },
      data: { isActive: true },
    });
    console.log('✓ Mistral: confirmed mistral-large-latest active');
  }

  // --- Repoint ModuleModelConfig entries to working provider+model ---
  // crypto_technical/deep_reasoning → NIM llama-3.3-70b-instruct
  if (nim) {
    const nimModel = await db.llmModel.findUnique({
      where: { providerId_modelId: { providerId: nim.id, modelId: 'meta/llama-3.3-70b-instruct' } },
    });
    if (nimModel) {
      await db.moduleModelConfig.upsert({
        where: { moduleKey_layer: { moduleKey: 'crypto_technical', layer: 'deep_reasoning' } },
        create: {
          moduleKey: 'crypto_technical',
          layer: 'deep_reasoning',
          modelId: nimModel.id,
          providerId: nim.id,
          temperature: 0.3,
          enabled: true,
        },
        update: { modelId: nimModel.id, providerId: nim.id, enabled: true },
      });
      console.log('✓ Module config: crypto_technical/deep_reasoning → NIM/llama-3.3-70b-instruct');
    }
  }

  // macro_analysis/macro → OpenRouter llama-3.3-70b-instruct
  if (or) {
    const orModel = await db.llmModel.findUnique({
      where: { providerId_modelId: { providerId: or.id, modelId: 'meta-llama/llama-3.3-70b-instruct' } },
    });
    if (orModel) {
      await db.moduleModelConfig.upsert({
        where: { moduleKey_layer: { moduleKey: 'macro_analysis', layer: 'macro' } },
        create: {
          moduleKey: 'macro_analysis',
          layer: 'macro',
          modelId: orModel.id,
          providerId: or.id,
          temperature: 0.3,
          enabled: true,
        },
        update: { modelId: orModel.id, providerId: or.id, enabled: true },
      });
      console.log('✓ Module config: macro_analysis/macro → OpenRouter/llama-3.3-70b-instruct');
    }
  }

  // news_sentiment/sentiment → Mistral mistral-large-latest (Gemini is geo-blocked)
  if (mistral) {
    const mistralModel = await db.llmModel.findUnique({
      where: { providerId_modelId: { providerId: mistral.id, modelId: 'mistral-large-latest' } },
    });
    if (mistralModel) {
      await db.moduleModelConfig.upsert({
        where: { moduleKey_layer: { moduleKey: 'news_sentiment', layer: 'sentiment' } },
        create: {
          moduleKey: 'news_sentiment',
          layer: 'sentiment',
          modelId: mistralModel.id,
          providerId: mistral.id,
          temperature: 0.2,
          enabled: true,
        },
        update: { modelId: mistralModel.id, providerId: mistral.id, enabled: true },
      });
      console.log('✓ Module config: news_sentiment/sentiment → Mistral/mistral-large-latest');
    }
  }

  // --- Summary ---
  console.log('\n=== Final ModuleModelConfig ===');
  const configs = await db.moduleModelConfig.findMany({
    include: { model: { include: { provider: true } }, provider: true },
    orderBy: { moduleKey: 'asc' },
  });
  for (const c of configs) {
    console.log(`  ${c.moduleKey}/${c.layer}: ${c.provider.name}/${c.model.modelId} (enabled=${c.enabled})`);
  }

  console.log('\n=== Active models per provider ===');
  const providers = await db.llmProvider.findMany({
    include: { models: { where: { isActive: true } } },
    orderBy: { name: 'asc' },
  });
  for (const p of providers) {
    console.log(`  ${p.name}: ${p.models.map((m) => m.modelId).join(', ') || '(none)'}`);
  }

  console.log('\n✓ Migration complete.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
