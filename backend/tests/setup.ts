import { beforeAll, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(() => {
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
