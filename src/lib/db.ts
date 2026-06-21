/**
 * Prisma singleton — schema-hash-aware + hot-reload-safe.
 *
 * Why this exists:
 *  - Next.js 16 / Turbopack re-imports modules on hot reload. A naive
 *    `new PrismaClient()` on every import exhausts DB connections.
 *  - Stashing the client on `globalThis` solves that, BUT if the developer
 *    edits `prisma/schema.prisma` (e.g. adds a model), the cached client's
 *    generated delegates go stale → runtime errors. We hash the schema file
 *    and recreate the client when the hash changes.
 *  - Even with the right hash, a partial hot reload can leave the cached
 *    client missing delegates for newer models (priceAlert, portfolioHolding).
 *    Defensive check below recreates the client if either is missing.
 *  - `createRequire(process.cwd() + '/package.json')` bypasses Turbopack's
 *    ESM loader so the CommonJS Prisma client is loaded via Node's require.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const require = createRequire(process.cwd() + '/package.json');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client') as {
  PrismaClient: new (opts?: { log?: Array<'query' | 'info' | 'warn' | 'error'> }) => any;
};

const SCHEMA_PATH = join(process.cwd(), 'prisma', 'schema.prisma');

function computeSchemaHash(): string {
  try {
    if (existsSync(SCHEMA_PATH)) {
      const content = readFileSync(SCHEMA_PATH, 'utf-8');
      return createHash('sha256').update(content).digest('hex').slice(0, 16);
    }
  } catch {
    /* fall through */
  }
  return 'unknown';
}

interface CachedPrisma {
  client: any;
  schemaHash: string;
}

interface GlobalWithPrisma {
  __omniscientPrisma?: CachedPrisma;
}

const g = globalThis as unknown as GlobalWithPrisma;

function createClient(): any {
  return new PrismaClient({ log: ['error', 'warn'] });
}

function ensureClient(): any {
  const schemaHash = computeSchemaHash();

  // Cache-bust on schema change.
  if (g.__omniscientPrisma && g.__omniscientPrisma.schemaHash !== schemaHash) {
    try {
      g.__omniscientPrisma.client?.$disconnect?.();
    } catch {
      /* ignore */
    }
    g.__omniscientPrisma = undefined;
  }

  if (!g.__omniscientPrisma) {
    g.__omniscientPrisma = { client: createClient(), schemaHash };
    return g.__omniscientPrisma.client;
  }

  const cached = g.__omniscientPrisma.client;
  // Defensive: recreate if newer-model delegates are missing (partial hot reload).
  if (!cached || typeof cached.priceAlert !== 'object' || typeof cached.portfolioHolding !== 'object') {
    try {
      cached?.$disconnect?.();
    } catch {
      /* ignore */
    }
    g.__omniscientPrisma = { client: createClient(), schemaHash };
    return g.__omniscientPrisma.client;
  }

  return cached;
}

export const db = ensureClient();
export default db;
