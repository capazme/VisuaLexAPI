// The Prisma CLI's configuration (Prisma 7 reads the database URL from here, no longer from the schema).
// Prisma 7 no longer loads `.env` by itself: `dotenv/config` does, for the development flow
// (`./start.sh --dev` runs `prisma migrate deploy` with `apps/server/.env`). It never overrides a variable
// already set, so the test run (`.env.test` through dotenv-cli) and the containers (Compose) keep theirs.
// `process.env`, not the `env()` helper: `prisma generate` runs without a URL (the image's build stage).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
