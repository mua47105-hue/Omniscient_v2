import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

// Schema-versioned singleton: cache the PrismaClient on globalThis so we
// don't create a new one on every Next.js dev hot-reload, BUT re-create it
// when the schema changes (e.g. when a new model is added via `db:push`).
// Without this, the cached client's delegates (e.g. `db.portfolioHolding`) go
// stale after a schema change until the dev server is fully restarted.
//
// IMPORTANT (Next.js 16 / Turbopack): We resolve @prisma/client via Node's
// NATIVE `require` (using `createResolve(process.cwd() + '/package.json')`)
// rather than `createRequire(import.meta.url)`. Turbopack intercepts the
// latter and serves a bundled (often stale) version of @prisma/client that
// doesn't pick up newly-generated model delegates after `prisma generate` /
// `db:push`. The cwd-relative `createRequire` bypasses Turbopack entirely,
// reading the on-disk generated client directly.
const nativeRequire = createRequire(resolve(process.cwd(), 'package.json'))

function schemaHash(): string {
  try {
    const p = resolve(process.cwd(), 'prisma', 'schema.prisma')
    const src = readFileSync(p, 'utf8')
    return createHash('sha1').update(src).digest('hex').slice(0, 16)
  } catch {
    return 'unknown'
  }
}

// Bust Node's require.cache for @prisma/client + the generated client so the
// next `require('@prisma/client')` reads freshly-generated code from disk.
// (The cache holds the OLD client across hot reloads in the dev server
// process, which is why we'd otherwise keep getting a client missing newly
// added model delegates.)
function bustPrismaCache() {
  const cache = (nativeRequire as unknown as { cache: Record<string, unknown> }).cache || {}
  for (const key of Object.keys(cache)) {
    const norm = key.replace(/\\/g, '/')
    if (norm.includes('/.prisma/client/') || norm.includes('/@prisma/client/')) {
      try { delete cache[key] } catch { /* ignore */ }
    }
  }
}

const PrismaClientCtor = nativeRequire('@prisma/client').PrismaClient as typeof import('@prisma/client').PrismaClient
type PrismaClientInstance = InstanceType<typeof PrismaClientCtor>

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientInstance | undefined
  prismaSchemaHash?: string
}

const currentHash = schemaHash()
const cachedHash = globalForPrisma.prismaSchemaHash
if (globalForPrisma.prisma && cachedHash !== currentHash) {
  // Schema changed since the client was created — discard the stale singleton
  // so a fresh client (with the new model delegates) is created below.
  try { globalForPrisma.prisma.$disconnect() } catch { /* ignore */ }
  globalForPrisma.prisma = undefined
}

// Defensive: also recreate if the cached client is missing expected delegates.
// (Happens when @prisma/client was bundled before the latest schema push, or
// when the schema-hash check above was bypassed because the singleton was
// created after the schema file was edited but before prisma generate ran.)
if (
  globalForPrisma.prisma &&
  (typeof (globalForPrisma.prisma as any).priceAlert === 'undefined' ||
   typeof (globalForPrisma.prisma as any).portfolioHolding === 'undefined')
) {
  try { globalForPrisma.prisma.$disconnect() } catch { /* ignore */ }
  globalForPrisma.prisma = undefined
}

// If we're about to create a fresh client, bust the require cache first so we
// pick up the freshly-regenerated Prisma client code from disk.
if (!globalForPrisma.prisma) {
  bustPrismaCache()
}

// Re-resolve the constructor on every load so we always use the latest
// @prisma/client (the bustPrismaCache() call above invalidated any stale
// require.cache entry, so this `require` reads the freshly-generated code).
const FreshPrismaClientCtor = nativeRequire('@prisma/client').PrismaClient as typeof import('@prisma/client').PrismaClient

export const db: PrismaClientInstance =
  globalForPrisma.prisma ??
  new FreshPrismaClientCtor({ log: ['error', 'warn'] })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
  globalForPrisma.prismaSchemaHash = currentHash
}
