import { beforeAll, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// SAFETY GUARD: this setup resets the database (drops everything). If vitest is
// run WITHOUT the `dotenv -e .env.test` wrapper (i.e. `npx vitest` instead of
// `npm test`), Prisma loads `.env` and DATABASE_URL points at the DEV database
// (visualex_platform) — the reset then wipes dev data. Refuse to run unless the
// target DB name clearly looks like a test database.
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const dbName = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests: DATABASE_URL points at "${dbName || '(unset)'}", ` +
        `which does not look like a test database. Run tests via "npm test" ` +
        `(which loads .env.test) — never "npx vitest" directly.`
    );
  }
}

beforeAll(() => {
  assertTestDatabase();
  // Pass process.env explicitly so the child process uses the test DATABASE_URL
  // (dotenv-cli sets it in process.env before vitest starts, but execSync forks
  // a new shell that would otherwise fall back to loading .env instead of .env.test).
  execSync('npx prisma migrate reset --force --skip-seed', {
    stdio: 'ignore',
    env: process.env,
  });
});

beforeEach(async () => {
  // Truncate all tables in one statement, fastest teardown.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "merlt_ingestion_jobs",
      "merlt_extraction_jobs",
      "merlt_consent_audits",
      "merlt_user_preferences",
      "merlt_user_authority_cache",
      "suggestion_items",
      "environment_suggestions",
      "shared_environment_versions",
      "shared_environment_likes",
      "shared_environment_reports",
      "shared_environments",
      "annotations",
      "highlights",
      "dossier_items",
      "dossiers",
      "quick_norms",
      "custom_aliases",
      "environments",
      "bookmarks",
      "folders",
      "search_history",
      "feedbacks",
      "users"
    RESTART IDENTITY CASCADE;
  `);
});

export { prisma };
