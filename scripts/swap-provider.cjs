/* eslint-disable @typescript-eslint/no-require-imports */
// Swaps Prisma provider based on the database URL.
// Checks DATABASE_URL first, then falls back to POSTGRES_PRISMA_URL
// (which Vercel's built-in Supabase integration sets automatically).

const fs = require('fs');
const path = require('path');

const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');

// Get the database URL — check DATABASE_URL first, then Vercel Supabase vars
const dbUrl = process.env.DATABASE_URL
  || process.env.POSTGRES_PRISMA_URL
  || process.env.POSTGRES_URL_NON_POOLING
  || '';

// Also set DATABASE_URL env var so Prisma can find it during generate
if (!process.env.DATABASE_URL && dbUrl) {
  process.env.DATABASE_URL = dbUrl;
  // Write to .env so prisma generate picks it up
  const envPath = path.join(process.cwd(), '.env');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  if (!envContent.includes('DATABASE_URL=')) {
    fs.appendFileSync(envPath, `\nDATABASE_URL=${dbUrl}\n`);
  } else {
    fs.writeFileSync(envPath, envContent.replace(/DATABASE_URL=.*/g, `DATABASE_URL=${dbUrl}`));
  }
  console.log(`[swap-provider] Set DATABASE_URL from POSTGRES_PRISMA_URL`);
}

let schema = fs.readFileSync(schemaPath, 'utf8');

// Determine the correct provider
const wantProvider = (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://'))
  ? 'postgresql'
  : 'sqlite';

// Replace whatever provider is currently set
schema = schema.replace(
  /provider\s*=\s*"(sqlite|postgresql)"/g,
  `provider = "${wantProvider}"`
);

console.log(`[swap-provider] DB URL starts with: ${dbUrl.slice(0, 20)}...`);
console.log(`[swap-provider] Set Prisma provider to: ${wantProvider}`);

fs.writeFileSync(schemaPath, schema);
