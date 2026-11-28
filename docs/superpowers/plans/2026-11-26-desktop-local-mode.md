# Desktop app, local mode in the core (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** today's server runs on the lawyer's computer, an Apple Silicon Mac or a Windows x64 PC, on one encrypted
SQLite file whose key lives in the system's credential store (the macOS keychain, Windows Credential Manager). Same routes, same rules, same tests. The online server keeps Postgres, on the same ORM version.

**Architecture:**
- Prisma 7.10.1 on both sides. Online: `@prisma/adapter-pg`. Local: `@prisma/adapter-better-sqlite3` over
  SQLite3MultipleCiphers 2.7.1 (package `better-sqlite3-multiple-ciphers` 13.2.0), ChaCha20-Poly1305 with a raw
  256-bit key, and one lock on the single connection.
- The local Prisma schema is derived from `schema.prisma` by a script and checked in CI. Local migrations are SQL
  files the server applies at start-up, after an encrypted backup.
- A local entry point starts the same Express app for the Tauri shell: the handshake, the port's checks, and a
  local profile with no password (G-514). Online sections answer 503.

**Tech Stack:** Node 24 / Express / Prisma 7.10.1 / zod / Vitest (apps/server); SQLite3MultipleCiphers via
better-sqlite3-multiple-ciphers; GitHub Actions on `macos-latest` and `windows-latest`.

**Spec:** `docs/superpowers/specs/2026-11-26-desktop-local-mode-design.md`. § numbers below are the spec's.

**Decided:** the road and the encryption (G-612, G-613); the line (G-614); M1 in this repository first, the app's
repository after it is merged (G-615); Apple Silicon and Windows x64 from the first version (26 November). The test
harness creates a fresh test database per run (PR 1b), and AI sessions run the server suite in CI only until it is
in: Prisma 7 refuses its database reset when an AI agent runs it, and that safeguard is never worked around. **Status (27 November 2026):** the spec is accepted and merged; PRs 1 to 5 are open, stacked (#757, #758, #759, #760,
#761, #762); PR 1 merges first, in a release of its own.

**Open:** D1 (the backup key), D2 (the session's memory threshold), D3 (the Windows signing identity) and D4 (the
Windows machine for the manual pass) touch M4 and M5, not M1. The Apple Developer account (G-616) touches M5.

## Global Constraints

- **Seven pull requests into `develop`**, in this order, each merging on its own:
  1. Prisma 7 online (Task 1). **It touches the online server; it ships in a release of its own** before PR 2
     merges.
  1b. The test harness creates a fresh test database per run (Task 1b).
  2. The local schema (Tasks 2–3).
  3. The encrypted client and its migrations (Tasks 4–5).
  4. The dialect seam (Task 6).
  5. The local entry point (Task 7).
  6. The local CI job (Task 8).

  Branches `feat/local-mode-<piece>`; PR 1 is `chore/prisma-7`, PR 1b `fix/test-db-per-run`.
- **Both platforms from M1.** Every local test (`tests/local/`) and the Work files the local job runs pass on
  `macos-latest` and on `windows-latest`. Nothing in `src/local/` assumes a POSIX path, a Unix socket or a signal
  Windows lacks.
- **Shared and reviewed areas.**
  - `.github/workflows/ci.yml` changes in PR 1b (one comment line) and PR 6. Each is reserved in the owners' coordination register
    before its branch touches the file.
  - CODEOWNERS asks the other owner to review `apps/server/prisma/` (the schema's generator block in PR 1,
    `prisma/local/` in PRs 2 and 3) and `.github/`. The Dockerfile is not covered; PR 1 asks for that review
    anyway, since it changes the image. The author merges at green CI.
  - **No Postgres migration** in M1. The online database does not change.
- **Never run `prisma migrate dev` or `prisma migrate reset` by hand** (the shared hook refuses them). Until PR 1b,
  the test setup's own reset runs in CI and in a person's local run; from PR 1b the setup runs no reset at all.
- **Locally, the targeted test files; the whole suite runs in CI.**
- **Pins, exact:**
  - `prisma` and `@prisma/client` 7.10.1;
  - `@prisma/adapter-pg` 7.10.1;
  - development dependencies, carried by the local bundle and not by the online image: `@prisma/adapter-better-sqlite3`
    7.10.1, and `better-sqlite3-multiple-ciphers` 13.2.0, installed in place of `better-sqlite3` through
    `overrides`.
- **No secret in the repository.** The tests generate their database key per run; nothing logs a key.
- **Names:**
  - the mode: `LEXCRAFT_MODE=local`;
  - the files: the data folder's `lexcraft.db`, its WAL and backups under `backups/`;
  - the tables: `_lexcraft_migrations` (local only) and `lexcraft_text_cache` (local only, filled by M3);
  - the generated clients: `src/generated/prisma` (Postgres) and `src/generated/prisma-local` (SQLite).
- **Copy (Italian, exact):**
  - «Sezione online: in questa versione dell'app non è disponibile senza il server.» (503 of an online section);
  - «Per questo testo serve la rete.» (503 of a source not kept locally);
  - «Nell'app sul computer non serve accedere.» (the sign-in routes in local mode).

## Review Focus

- **The lock (Task 4).** No plain query may run while a transaction is open on the connection. A `BEGIN` that
  throws releases the lock, and the adapter's own `startTransaction` (whose mutex a failed `BEGIN` never releases) is
  never called. Queries inside a transaction never take the lock again.
- **Migrations (Task 5).** Foreign keys are off around a migration's transaction and checked before `COMMIT`; every
  local migration carries the same date defaults and CHECKs as `init.sql`.
- **Dates (Task 3).** Every datetime that reaches the local file, by Prisma or by raw SQL, has the adapter's format.
- **The key.** It never touches a file, a log, an error message or `process.env` after start-up.
- **The online server after PR 1** behaves as before: same pool limits, same timeouts, same error mapping, Bytes
  round-trips.

---

## PR 1 — Prisma 7 on the online server (`chore/prisma-7`)

### Task 1: Prisma 7.10.1 with `@prisma/adapter-pg`

**Files:**
- Modify: `apps/server/package.json` and its lock file (pins above; `pg` per the adapter's range)
- Create: `apps/server/prisma.config.ts` (schema path, migrations path, `datasource.url` from `DATABASE_URL`,
  loaded explicitly; `prisma generate` must still work when the variable is absent, as in the image's build stage)
- Modify: `apps/server/prisma/schema.prisma`, the generator block only: `provider = "prisma-client"`,
  `output = "../src/generated/prisma"`, `moduleFormat = "cjs"`, `runtime = "nodejs"`. The `url` moves out of the
  datasource.
- Modify: `apps/server/src/lib/prisma.ts` (the adapter, pool settings as today)
- Modify: every `from '@prisma/client'`: 82 files in `src/`, 29 in `tests/`. Point each at the generated client
  through one module, `src/lib/db.ts`, so the local client can later take its place in one spot.
- Modify: the test harness. `tests/setup.ts`, `tests/helpers.ts` and `tests/globalSetup.ts` construct their clients
  with the adapter. `globalSetup.ts`'s dynamic import changes path, and its `migrate reset` loses `--skip-seed`,
  which Prisma 7 removed. `tests/lingoCardGoneMidRead.test.ts` drops `datasourceUrl`. `setup.ts`'s
  `vi.mock('@prisma/client')` targets `src/lib/db.ts`.
- Modify: `apps/server/tests/prismaClient.test.ts` (skip `src/generated/`, whose files construct the client) and
  `apps/server/CLAUDE.md` (the generated client's folder; `lib/prisma.ts` stays the one place that constructs one)
- Modify: `apps/server/src/routes/praticaFiles.ts` (Bytes as `Uint8Array`)
- Modify: `apps/server/Dockerfile`. The build stage copies `prisma.config.ts` too, which the `migrate` target's
  `prisma migrate deploy` reads its URL from. No `node_modules/.prisma` is copied any more: the generated client is
  inside `dist/`.
- `.github/workflows/ci.yml` does not change: `npx prisma generate` keeps working through the config
- Modify: `apps/server/.gitignore` (`src/generated/`)
- Test: `apps/server/tests/prisma7.test.ts`

**Interfaces:**
- Produces: `src/lib/db.ts`, which re-exports `PrismaClient`, `Prisma` and the enums from the generated client.
  Every other file imports from it, never from a generated path directly.
- Produces: `prisma` from `src/lib/prisma.ts`, unchanged for its callers.

- [ ] **Step 1: Write the failing tests** (`tests/prisma7.test.ts`)
  - `a Bytes field round-trips byte for byte` (a `praticaFile.chiaveCifrata` of `[0, 1, 2, 250, 255]`);
  - `a unique violation is still a PrismaClientKnownRequestError with code P2002`;
  - `the pool answers ten queries in parallel` (no timeout at today's limit);
  - `an interactive transaction rolls back on error`.
- [ ] **Step 2: Run them on Prisma 5 and see which fail.**
  - Run: `npm --prefix apps/server test -- tests/prisma7.test.ts`
  - Expected: they pass on 5.22, and stay as the guard of the upgrade. The Bytes one fails only after the
    upgrade if the route is not fixed.
- [ ] **Step 3: Upgrade.** Pins, config, generator, `lib/db.ts`, then the import codemod (a script run once, not
  committed: `from '@prisma/client'` → `from '<relative>/lib/db'`). Then the two type errors.
- [ ] **Step 4: Type-check through the build** (not a bare `tsc --noEmit`, which misses the project references).
  - Run: `npm --prefix apps/server run build`
  - Expected: no error.
- [ ] **Step 5: Run the targeted files**: `prisma7.test.ts`, `trash.test.ts`, `tasks.routes.test.ts`,
  `praticaFiles.test.ts`, `dossierNotes.test.ts`. A person runs them locally against a throwaway test database; an AI
  session leaves them to CI until PR 1b. Expected: PASS.
- [ ] **Step 6: Push; CI runs the whole server suite on Postgres 16.** Expected: green, every job.
- [ ] **Step 7: Build both targets of the server image**: `docker build apps/server` and
  `docker build --target migrate apps/server`. Run `migrate` and then the runtime against a throwaway test
  database. Expected: the migrations apply, `/api/health` answers 200, and a sign-in works.
- [ ] **Step 8: Commit** `chore(server): Prisma 7.10.1 with the pg adapter (G-612)`. The pull request says it
  touches the online server, and ships in a release of its own.

---

## PR 1b — A fresh test database per run (`fix/test-db-per-run`)

### Task 1b: The global setup creates the run's database, migrates it with `migrate deploy`, and drops it at the end

**Files:**
- Modify: `apps/server/tests/globalSetup.ts`, which no longer resets a database; `apps/server/tests/testDatabase.ts`
  (the guard and the name)
- Modify: `apps/server/tests/setup.ts`. It assigns `process.env.DATABASE_URL` from `inject('testDatabase')`
  before it constructs its client, so every reader of the variable uses the run's database: `src/lib/prisma.ts`,
  `src/config.ts`, `tests/helpers.ts` and `tests/lingoCardGoneMidRead.test.ts`.
- Test: `apps/server/tests/testDatabase.test.ts`

**Interfaces:**
- Produces: the run's database `<name in DATABASE_URL>_run_<pid>_<random>`. It is created on the server
  `DATABASE_URL` names. `npx prisma migrate deploy` applies the migrations, run as a child process with
  `DATABASE_URL` set to the run's URL. That URL goes to the test files through vitest's `provide`, and the teardown
  drops the database.
- Keeps: the guard. A `DATABASE_URL` whose database name lacks «test» is refused before anything is created; the
  teardown drops only a database whose name has the run's prefix and was created by this run.
- No Prisma command that drops data runs at all, so Prisma 7's safeguard for AI agents is never met, and never
  worked around.

- [ ] **Step 1: Write the failing tests**
  - `a DATABASE_URL without "test" is refused before any database is created`;
  - `the run's database name carries the prefix and the run's id`;
  - `the teardown drops only the database this run created`.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement.** The `CREATE DATABASE` and the `DROP DATABASE` go through a plain `pg` client on the
  server's `postgres` database.
- [ ] **Step 4: Run two files locally**, then the whole suite in CI. Expected: PASS, with no database left behind.
  The role in `DATABASE_URL` must be allowed to create databases: the CI service's is; a developer's may need
  `CREATEDB`.
- [ ] **Step 5: Commit** `fix(tests): each run creates its own test database and drops it at the end`

---

## PR 2 — The local schema (`feat/local-mode-schema`)

### Task 2: The derived SQLite schema, checked in CI

**Files:**
- Create: `apps/server/scripts/local-schema.ts` (the converter of spec §2)
- Create: `apps/server/prisma/local/schema.prisma` (generated, committed)
- Create: `apps/server/prisma/local/init.sql` (from `prisma migrate diff --from-empty --to-schema`, post-processed,
  committed)
- Create: `apps/server/prisma.local.config.ts`
- Modify: `apps/server/package.json` (scripts `local:schema`, `local:generate`, and `pretest` generating the local
  client; the development dependencies `@prisma/adapter-better-sqlite3` and `better-sqlite3-multiple-ciphers` with
  its `overrides` entry, which Task 3's tests already need)
- The staleness check is a test (`tests/local/schema.test.ts`), so it runs in the server job as it is: `ci.yml` does
  not change in PR 2.
- Test: `apps/server/tests/local/schema.test.ts`

**Interfaces:**
- Produces: `npm run local:schema`, which rewrites both files.
- Produces: `tests/local/schema.test.ts`, which fails when a committed file differs from what `local:schema` would
  write.
- Produces: `src/generated/prisma-local`, generated with `compilerBuild = "small"`.

- [ ] **Step 1: Write the failing tests**
  - `the local schema has every model and enum of schema.prisma, with the same @map names`;
  - `no @db attribute survives`;
  - `every list is Json with a "[]" default where the source had []`;
  - `the generator writes to src/generated/prisma-local with compilerBuild "small"`.
- [ ] **Step 2: Run them; they fail** (no script yet).
- [ ] **Step 3: Implement the converter** (the trial's rules, spec §2). Run it, then `prisma generate` with the
  local config. Expected: the client generates.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(local): the SQLite schema, derived from the server's (spec §2)`

### Task 3: Dates in one format, and the CHECK constraints of the local tables

**Files:**
- Create: `apps/server/scripts/localSql.ts`, the post-processing that both `init.sql` and every later local
  migration go through (Task 5): every `DEFAULT CURRENT_TIMESTAMP` becomes
  `DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))`, and each `CREATE TABLE` of a local table gets its CHECKs
- Modify: `apps/server/scripts/local-schema.ts` (runs `init.sql` through it)
- Create: `apps/server/prisma/local/checks.sql` (the CHECK constraints of `tasks`, `highlights`, `dossier_items`,
  `search_history` and `assistant_note_versions`, as SQLite table constraints)
- Test: `apps/server/tests/local/dates.test.ts`, `apps/server/tests/local/checks.test.ts`

**Interfaces:**
- Consumes: until Task 4 lands, the tests open the driver directly with the same cipher and pragmas; Task 4
  switches them to the local client.
- Produces: SQLite cannot rebuild a table to add a constraint in place, so `init.sql` is assembled with each table's
  CHECKs inside its `CREATE TABLE`. The converter merges `checks.sql` by table name.

- [ ] **Step 1: Write the failing tests**
  - `a row inserted by raw SQL without created_at reads back as now, within a second`;
  - `filtering createdAt >= now - 1 s finds both rows`: one by Prisma, one by raw SQL;
  - `every CHECK live on a local table after the Postgres migrations has a twin in checks.sql, by name`;
  - `a task violating each CHECK is refused by the local file`.
- [ ] **Step 2: Run them; they fail** (today's `init.sql` writes `CURRENT_TIMESTAMP` and has no CHECK).
- [ ] **Step 3: Implement** the post-processing and `checks.sql`.
- [ ] **Step 4: Run them.** Expected: PASS. **Step 5:** `tests/local/schema.test.ts` passes.
- [ ] **Step 6: Commit** `feat(local): one datetime format and the local tables' CHECKs (spec §2)`

---

## PR 3 — The encrypted client and its migrations (`feat/local-mode-client`)

### Task 4: The encrypted local client and the connection lock

**Files:**
- Create: `apps/server/src/local/database.ts`
- Modify: `apps/server/src/lib/prisma.ts`. In local mode it loads `local/database.ts` lazily and constructs the
  local client; otherwise it constructs the Postgres one, unchanged. It stays the one place under `src/` that
  constructs a client.
- Modify: `apps/server/src/lib/db.ts` (in the local bundle, the generated local client takes the Postgres one's
  place; the types stay those of the Postgres client, spec §1)
- Test: `apps/server/tests/local/database.test.ts`, `apps/server/tests/local/lock.test.ts`

**Interfaces:**
- Produces: `localAdapter({ file }): SqlDriverAdapterFactory` and `setLocalKey(keyHex)`, called once by the entry
  point; the key is then held in the module only.
- Produces: the adapter subclass that applies the cipher, the key and the pragmas in `connect()`, in the order of
  spec §3, then wraps the adapter with `serialize()`.
- Produces: `serialize(adapter)`, a FIFO lock.
  - Plain `queryRaw`, `executeRaw` and `executeScript` hold it for their own duration.
  - `startTransaction` is the wrapper's own. It takes the lock, runs `BEGIN` on the connection, and returns an
    object implementing `Transaction` from `@prisma/driver-adapter-utils`: the adapter's unlocked query methods,
    `commit`, `rollback` and the three savepoint methods. `commit` and `rollback` release the lock, and so does a
    `BEGIN` that throws. The adapter's own `startTransaction` is never called.

- [ ] **Step 1: Write the failing tests**
  - `the file is not readable without the key`: no `SQLite format 3` header, no inserted text in the bytes;
  - `a wrong key is refused with "file is not a database"`;
  - `a flipped bit in a data page is refused`;
  - `the pragmas are set`: `journal_mode` is `wal`, `synchronous` 2, `foreign_keys` 1, `temp_store` 2, and on
    macOS `fullfsync` 1;
  - `a plain write during an open transaction waits, and survives the transaction's rollback`: the trial's case,
    A fails after 200 ms and B writes meanwhile;
  - `a plain read during an open transaction does not see its uncommitted rows`;
  - `a transaction whose BEGIN fails releases the lock`: the next query and the next transaction both run;
  - `savepoints inside a transaction work` (`tx.$transaction` nesting as the server uses it);
  - `the key is not in process.env after setLocalKey`.

  All of them run on macOS and Windows (Task 8).
- [ ] **Step 2: Run them; they fail** (no module yet).
- [ ] **Step 3: Implement** `database.ts` (from the trial's `prisma-local.ts`).
- [ ] **Step 4: Run them.** Expected: PASS. Then run the Work test files on the local client by hand once
  (`LEXCRAFT_TEST_DB=local`, Task 8 makes it a job).
- [ ] **Step 5: Commit** `feat(local): the encrypted SQLite client and one lock on its connection (spec §3)`

### Task 5: Local migrations at start-up, after an encrypted backup; one instance

**Files:**
- Create: `apps/server/src/local/migrate.ts`, `apps/server/src/local/backup.ts`
- Create: `apps/server/scripts/local-migration.ts`. It writes `prisma/local/migrations/<timestamp>_<name>/migration.sql`
  with `prisma migrate diff` from the last committed local schema, then runs it through `scripts/localSql.ts`
  (Task 3).
- Create: `apps/server/prisma/local/migrations/` (empty: `init.sql` is the baseline)
- Test: `apps/server/tests/local/migrate.test.ts`, `apps/server/tests/local/backup.test.ts`

**Interfaces:**
- Produces: `migrateLocal(prisma, { dataDir })`.
  - On a new file it applies `init.sql` in one transaction.
  - Otherwise it backs up, sets `foreign_keys=OFF`, applies the pending migrations in one transaction, runs
    `foreign_key_check` before `COMMIT`, then `integrity_check`, then `foreign_keys=ON`. Each migration is recorded
    in `_lexcraft_migrations`.
  - Before anything opens the file it takes the data folder's lock (`holdInstanceLock`, spec §4).
- Produces: `backupLocal(prisma, { dataDir, label })`, which runs `VACUUM INTO` into
  `backups/<iso>-<label>.db` and returns the path. The copy keeps the database key for now; M4 adds the rekey to
  the backup key (spec D1).
- Produces: `PRAGMA locking_mode=EXCLUSIVE`, set in `connect()` before the key check and before `journal_mode=WAL`,
  and the lock file `lexcraft.db.lock` (spec §4), taken by `migrateLocal` and by the client's `connect()`, released by
  its `dispose()`.

- [ ] **Step 1: Write the failing tests**
  - `a new file gets the whole schema in one transaction` (the table count, plus `_lexcraft_migrations` empty);
  - `a pending migration is applied once and recorded`;
  - `a migration that fails leaves the file as it was, and its backup exists`;
  - `a migration that rebuilds dossiers leaves every dossier_items row`;
  - `after a migration that rebuilds tasks, its live CHECKs equal checks.sql and its datetime defaults keep the format`;
  - `the backup is encrypted, opens with the key and has the same rows`;
  - `a second process is refused while the first holds the data folder, and opens it once the first is gone`, in
    child processes, with twenty plain processes trying the lock.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(local): migrations at start-up after an encrypted backup, one instance (spec §4)`

---

## PR 4 — The dialect seam (`feat/local-mode-dialect`)

### Task 6: Row locks, advisory locks and casts behind one module; the two Work rewrites

**Files:**
- Create: `apps/server/src/lib/sqlDialect.ts`
- Modify: the Work files whose raw SQL locks or casts: `trash/trash.ts`, `tasks/tasks.ts`, `utils/dossierCaps.ts`,
  `routes/atti.ts`, `routes/praticaFiles.ts`, `routes/assistantProposals.ts`, `routes/assistantPassages.ts`
- Modify: `tasks/tasks.ts` `reorderTasks` (spec §5)
- Modify: `trash/trash.ts`, where the restore's `RETURNING payload` is parsed through the dialect module
- Test: `apps/server/tests/local/dialect.test.ts`, and the existing `tasks.routes`, `tasks.idor` and `trash` tests on both databases

**Interfaces:**
- Produces: `forUpdate(): Prisma.Sql` and `advisoryXactLock(tx, key: string): Promise<void>`, each a no-op on
  SQLite.
- Produces: `jsonValue<T>(v: unknown): T`, which parses on SQLite and passes through on Postgres.

- [ ] **Step 1: Write the failing tests**
  - `no raw statement under src/ names FOR UPDATE, FOR SHARE or pg_advisory outside sqlDialect.ts`, a source scan
    that lists the offenders;
  - `reorderTasks puts the named tasks at 0, 1, 2 in order`, on SQLite (the Postgres case already exists);
  - `restoring a trashed entry brings back its content`, on SQLite.
- [ ] **Step 2: Run them; they fail.** The scan lists the Work files, and also those of the sections that stay
  online: `lingo/*`, the `lingo*` routes, `forum/*`, `controllers/forumCommunitiesController.ts`,
  `controllers/forumProfileController.ts` and `account/removeAllContributions.ts`. Those are allowed by name in the test, each with its reason, until a later
  milestone brings its section offline.
- [ ] **Step 3: Implement** the module, then move each Work statement onto it. Rewrite `reorderTasks` without
  `ANY`, `unnest` or `AT TIME ZONE`: one `UPDATE … SET position = CASE id WHEN … END` built with `Prisma.join`,
  and `updated_at` passed as a parameter.
- [ ] **Step 4: Run the Work test files on Postgres and on the local client.** Expected: PASS on both.
- [ ] **Step 5: Commit** `refactor(server): row and advisory locks behind a dialect seam; reorder without Postgres-only SQL (spec §5)`

---

## PR 5 — The local entry point (`feat/local-mode-entry`)

### Task 7: The handshake, the port's checks, the local profile, the online sections

**Files:**
- Create: `apps/server/src/local/main.ts` (entry), `apps/server/src/local/server.ts` (the local server's order),
  `apps/server/src/local/guards.ts` (Host, Origin, the shell's exchange, the window's cookie),
  `apps/server/src/local/profile.ts`, `apps/server/src/local/online.ts` (the 503s), `apps/server/src/local/sources.ts`
  (503 «serve la rete» until M3)
- Modify: `apps/server/src/app.ts` (in local mode, no CORS; the online routers are replaced by `online.ts` before
  authentication; the sign-in routes answer with the copy above)
- Modify: `apps/server/src/index.ts` (it refuses local mode, so the online background jobs never start there)
- Modify: `apps/server/src/config.ts` (no `.env` in local mode), `apps/server/src/norms/resolveReference.ts` (no
  source reached in local mode)
- Test: `apps/server/tests/local/entry.test.ts`, `apps/server/tests/local/guards.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5.
- Produces: the stdin contract. The first line carries `key=<64 hex> launch=<secret>`. The process answers on stdout
  `LEXCRAFT_READY port=<n> ready_ms=<t>`, and exits when stdin closes.
- Produces: `POST /__lexcraft/session` with `Authorization: Bearer <launch>`, for the shell only (refused with an
  `Origin` or a `Sec-Fetch-*` header). It ends the profile's earlier web sessions, creates one
  (`auth/webSession.ts`), and returns the window's cookies for the shell to set (spec §6).

- [ ] **Step 1: Write the failing tests** (the entry is started as a child process with a temporary data folder)
  - `it answers READY and serves /api/health only with the window's cookie`;
  - `a missing or wrong launch secret, or the secret in a URL: 403`;
  - `another Host: 421`;
  - `a cross-site Origin: 403`;
  - `it listens on the loopback address only`, and no response carries a CORS header;
  - `/api/auth/me answers the local profile after the shell's exchange`;
  - `no source is reached`: a stand-in Python API named in `LEGAL_API_URL` receives no request;
  - `POST /api/auth/login answers 403 with "Nell'app sul computer non serve accedere."`;
  - `GET /api/forum/... answers 503 with the online copy, without touching the database`;
  - `a source not kept locally: 503 "Per questo testo serve la rete."`;
  - `closing stdin stops the process within 3 s, and the file reopens`;
  - `a killed parent leaves no sidecar running`: a stand-in parent starts the entry point **detached** (on Windows
    Node would otherwise put it in a job object that kills it with the parent, which hides the contract), the
    parent is killed (TerminateProcess on Windows), and the test asserts that the entry point ran its own
    stdin-end handler, by a marker it writes, as the trial's probe did (spec §10.3).
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement**, from the trial's sidecar (`main.ts`, `shell.ts`), minus its trial-only parts.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: An independent review that attacks the port's checks.**
- [ ] **Step 6: Commit** `feat(local): the local entry point, its port's checks and the local profile (G-514, spec §6)`

The bundle and the trial's flow script move to Task 8, where CI runs them on both platforms.

---

## PR 6 — The local CI job (`feat/local-mode-ci`)

### Task 8: Work's tests on an encrypted file, in CI

**Files:**
- Modify: `.github/workflows/ci.yml`. A job `local`, on `macos-latest` and `windows-latest` (spec §10.7), with no
  Postgres service. Third-party actions are pinned to a full commit SHA. It runs `npm ci`, `npm run local:generate`, the Work test files and `tests/local/` with
  `LEXCRAFT_TEST_DB=local`, then the bundle and the flow script.
- Modify: `apps/server/tests/globalSetup.ts`, `apps/server/tests/setup.ts`, `apps/server/tests/testDatabase.ts`. With
  `LEXCRAFT_TEST_DB=local`: a fresh encrypted file per run under the OS temp folder, a random key, and the guard's
  twin (the file must sit under the temp folder).
- Create: `apps/server/tests/local/work-files.txt`, the list of Work test files the job runs, each by name.
- Create: `apps/server/scripts/build-local.mjs` (esbuild bundle of `src/local/main.ts` with the local client; native
  modules beside it; `esbuild` becomes a development dependency) and `apps/server/scripts/local-flow.mjs` (the
  trial's flow, against the bundle, through the shell's exchange).
- The job is not a required check: making it one is a ruleset change for the owners, proposed once it has run green
  for a while.
- Test: the job itself.

- [ ] **Step 1: Make the setup's local branch** and run `tests/local/` with it locally. Expected: PASS.
- [ ] **Step 2: Run the listed Work files locally**, one at a time, on the local branch. Each that fails for a
  reason outside M1 is written in the list with its reason and skipped by name, never silently.
- [ ] **Step 3: Push.** Expected: the new job is green on macOS and on Windows, and the server job is unchanged.
- [ ] **Step 4: Commit** `ci: Work's tests and the local flow on an encrypted SQLite file (spec §8)`

---

## After M1

M2 (the app's repository and shell, on both platforms) starts once M1 is merged (G-615); its plan is written then,
in that repository. M3–M8 are outlined in the spec's «After M1».
