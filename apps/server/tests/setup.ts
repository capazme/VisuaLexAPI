import { beforeAll, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// The texts the migrations insert (version 1 of the notice to accept). The TRUNCATE
// below empties their table, since it references `users`; they are read once after
// the reset and put back after every truncation, so the migration stays the one
// place that holds their wording and every test starts from "one version, number 1".
type TextVersionRow = {
  id: string; chiave: string; versione: number; titolo: string; corpo: string;
  conferma: string; azione: string; created_at: Date; autore_id: string | null;
};
let seededTexts: TextVersionRow[] = [];

// The OAuth endpoints' own rate limits are per address, and the whole suite
// comes from 127.0.0.1: lift them here (the flood test builds its own router
// with a low one), and give the MCP server's credential a test value.
process.env.OAUTH_REGISTRATIONS_PER_HOUR ??= '100000';
process.env.OAUTH_REQUESTS_PER_15_MINUTES ??= '100000';
process.env.OAUTH_MCP_CLIENT_SECRET ??= 'test-mcp-client-secret';
process.env.OAUTH_DELEGATION_SECRET ??= 'test-delegation-secret';

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

beforeAll(async () => {
  assertTestDatabase();
  // Pass process.env explicitly so the child process uses the test DATABASE_URL
  // (dotenv-cli sets it in process.env before vitest starts, but execSync forks
  // a new shell that would otherwise fall back to loading .env instead of .env.test).
  execSync('npx prisma migrate reset --force --skip-seed', {
    stdio: 'ignore',
    env: process.env,
  });
  seededTexts = await prisma.$queryRaw<TextVersionRow[]>`
    SELECT id, chiave::text AS chiave, versione, titolo, corpo, conferma, azione, created_at, autore_id
    FROM lingo_testi_versioni`;
  if (seededTexts.length === 0) throw new Error('The migrations seed no text version: expected version 1 of PROPOSTA_SCHEDA.');
});

beforeEach(async () => {
  // Truncate all tables in one statement, fastest teardown.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "merlt_qa_jobs",
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
      "lingo_tracce",
      "lingo_stato_ripasso",
      "lingo_revisioni_srs",
      "lingo_preferenze_studio",
      "lingo_card_ancore",
      "lingo_validazioni_card",
      "lingo_accettazioni_testi",
      "lingo_cards",
      "lingo_testi_versioni",
      "oauth_tokens",
      "trash_entries",
      "oauth_authorization_codes",
      "oauth_grants",
      "oauth_authorization_requests",
      "oauth_clients",
      "users"
    RESTART IDENTITY CASCADE;
  `);
  for (const t of seededTexts) {
    await prisma.$executeRaw`
      INSERT INTO lingo_testi_versioni (id, chiave, versione, titolo, corpo, conferma, azione, created_at, autore_id)
      VALUES (${t.id}, ${t.chiave}::"LingoTestoChiave", ${t.versione}, ${t.titolo}, ${t.corpo}, ${t.conferma}, ${t.azione}, ${t.created_at}, ${t.autore_id})`;
  }
});

export { prisma };
