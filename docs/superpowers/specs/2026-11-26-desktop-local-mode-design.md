# The desktop app's local mode: today's server on an encrypted SQLite file

Status: proposed on 26 November 2026 under G-612 («the server of today on SQLite, rewriting what SQLite cannot do»),
G-613 («the database encrypted already in the first version, even if it takes longer»), G-614 (the porting line is
one owner's) and G-615 (the local mode is built in this repository first; the app's own repository is created once
it is merged, public like the others). On the same day the owners set the platforms: Apple Silicon and Windows x64
from the first version, Windows on ARM and Intel Macs optional. This document designs the first milestone, **M1, the local mode in the
core**, and places it among the milestones that lead to the first desktop app. The plan is
`docs/superpowers/plans/2026-11-26-desktop-local-mode.md`. The decisions still open for the owners are in
«Decisions for the owners».

The numbers below come from a throwaway trial run outside the repository on 26 November 2026, on an Apple Silicon
Mac, with invented data: today's `apps/server` (develop at be48927f), bundled with the pieces this document
describes, behind the Tauri shell of an earlier trial. The stack was then probed on GitHub-hosted Windows x64,
Windows on ARM and macOS runners (§10.1). Each number is marked **[measured]** there, **[read]** in a source listed
at the end, or **[estimated]**.

## Why

The desktop app keeps a lawyer's work on the lawyer's own computer: the practices, their entries and notes, the
highlights, the tasks and deadlines, the act files. G-512 chose to run today's Express server beside a Tauri window
rather than to rewrite it, so the routes, the rules and the tests stay one. G-612 puts that server on SQLite, and
G-613 asks for the file to be encrypted from the first version.

Two things stood in the way, measured in an earlier trial:

- Prisma 5.22, the server's ORM today, cannot open an encrypted SQLite file, and on SQLite it cannot hold the Json,
  enum and list fields the Work tables use.
- Part of the hand-written SQL and the CHECK constraints are Postgres-only.

The trial of 26 November shows a road through both, at a moderate cost.

## What the lawyer gets, and what the first version leaves out

**The first internal app** (M1 + M2 below): the app opens on the lawyer's Mac (Apple Silicon) or Windows PC (x64)
without a password (G-514: a local profile). It shows the practices, their entries, notes, highlights and tasks, reads the texts already kept on the
computer, and writes everything into one encrypted file whose key lives in the system's credential store (the
macOS keychain, Windows Credential Manager). The sections that
need the community or the online services (Forum, Learn, the interpretive experts) say they are online.

**The first distributable version** (M1–M5) adds:

- reading new texts and the online sections through the local server (G-515), with the lawyer's account;
- encrypted backups that can be restored on another computer;
- a signed build for each platform (notarized on macOS) that updates itself (G-573).

**Left out of the first version, to make it early:**

- Windows on ARM and Intel Macs, which are optional (§10.9 gives their cost);
- the local MCP server (G-516), which follows right after (M6);
- the practices-as-folders and the local deadline register, designed separately (M7 is their slot);
- Learn, the Forum and the experts without a network: they stay online;
- moving an existing online account's data into the app;
- search across the saved texts (the local index of G-560);
- synchronisation between computers or with the online server;
- teams, permissions, two-factor sign-in and the audit log (G-570); the client portal (G-566); Rust (G-512).

## The road, in one picture

```
Tauri 2 window (WebKit / WebView2)     keychain / Credential Manager: the database key (32 random bytes)
   │  http://127.0.0.1:<port>  (the built web app, same origin as /api)        │
   ▼                                                                          │ stdin, at launch
Node sidecar: apps/server in local mode  ◄──────────────────────────────────────┘
   │  Prisma 7.10.1, client generated from the derived SQLite schema
   │  @prisma/adapter-better-sqlite3 7.10.1 + one connection lock
   ▼
better-sqlite3-multiple-ciphers 13.2.0 (SQLite3MultipleCiphers 2.7.1, SQLite 3.54.1)
   ▼
lexcraft.db — ChaCha20-Poly1305, WAL, synchronous=FULL (+ fullfsync on macOS)
```

The online server keeps Postgres; it moves to Prisma 7 with `@prisma/adapter-pg`, so both read the same code with
the same ORM version.

## Design

### 1. One codebase, Prisma 7 on both sides

- **The upgrade.** Prisma 5.22 becomes 7.10.1 on the online server too, with `@prisma/adapter-pg`, the
  `prisma-client` generator (an explicit output folder, `apps/server/src/generated/`), and `prisma.config.ts`, which
  the Dockerfile's build stage copies too: `prisma migrate deploy` reads its URL from there. Prisma 7 requires a
  driver adapter for every database and no longer ships a query engine binary **[read]**.
  - The generated client constructs `PrismaClient` in its own files, so `tests/prismaClient.test.ts`, which allows
    one construction under `src/` (`lib/prisma.ts`), skips `src/generated/`. `lib/prisma.ts` stays the one place
    that constructs a client: the Postgres one online, the encrypted one in local mode. `apps/server/CLAUDE.md`
    says so in the same change.
  - Type-checked against a Prisma 7 client, today's `src/` has two errors **[measured]**: `lib/prisma.ts`
    constructs the client without an adapter, and `routes/praticaFiles.ts` passes a `Buffer` where Prisma 7 types
    a `Uint8Array`.
  - The server uses none of the APIs Prisma 6 and 7 removed (`$use`, `$metrics`, `NotFoundError`) **[measured]**.
  - `from '@prisma/client'` appears in 82 source files and 29 test files. In `src/` the change of path is
    mechanical. The test harness needs more:
    - `tests/setup.ts`, `tests/helpers.ts` and `tests/globalSetup.ts` construct clients without an adapter, which
      Prisma 7 refuses;
    - `globalSetup.ts` imports the client dynamically and passes `migrate reset --skip-seed`, a flag Prisma 7
      removed;
    - `lingoCardGoneMidRead.test.ts` passes `datasourceUrl`, also removed;
    - `setup.ts` mocks `@prisma/client` by name, a mock that would no longer intercept anything **[read]**.
  - The `pg` pool replaces Prisma's own, with the driver's defaults; the adapter is configured to keep today's
    connection limit and timeouts **[read]**.
- **Why on both sides.** The desktop bundle could alias `@prisma/client` to its own Prisma 7 client while the
  online server stays on 5.22; the trial did exactly that. But one codebase on two ORM major versions means every
  change tested twice against two behaviours. The upgrade is the first pull request of M1 and ships in a release of
  its own, before anything local lands.
- **Prisma 8** is a release candidate, a rewrite from the ground up; Prisma 7 «remains fully supported» **[read]**.
  This design picks 7 and accepts a later migration.
- **The query compiler.** Prisma 7 compiles queries in WebAssembly. With its `compilerBuild = "small"` build the
  first query cost 50–60 MB less than with the default «fast» one in an isolated test **[measured]**.
  - In the whole server, «small» stayed at 125–132 MB at rest where «fast» ranged from 134 to 204 MB.
  - After the big practice was read, the two were within a few MB of each other.
  - «small» was no slower **[measured]**.

  The local client uses «small»; the online one keeps the default unless measured otherwise.

### 2. The local schema is derived, never written by hand

A script (`apps/server/scripts/local-schema.ts`) reads `prisma/schema.prisma` and writes
`prisma/local/schema.prisma`. CI runs it and fails when the committed file differs.

- **What it changes.** The datasource becomes `sqlite`. Every `@db.*` native type is dropped (34 today). Every
  scalar or enum list becomes `Json` (13 today), with `@default([])` becoming `@default("[]")`. The generator gets
  its own output folder and `compilerBuild = "small"`. Nothing else changes: same models, same `@map` names, same
  enums (82 models and 34 enums today) **[measured]**.
- **Dates: one format.** The adapter writes a `DateTime` as ISO 8601 text, `2026-11-26T21:23:56.349+00:00`, while a
  column's `DEFAULT CURRENT_TIMESTAMP` writes `2026-11-26 21:23:56` **[measured]**. Mixed in one column, the two
  formats compare wrongly as text: in the trial, `createdAt >= now − 1 s` matched one of two rows, and raw SQL read
  the default's value one hour off **[measured]**. The local SQL therefore writes every datetime default as
  `(strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))`, which is the adapter's own format, and a test inserts a row by raw
  SQL and by Prisma and compares both.
- **CHECK constraints.** `prisma migrate diff` produces none: the Postgres ones live in hand-written migration SQL.
  SQLite enforces CHECK, so the ones on tables the local mode writes are written again in
  `prisma/local/checks.sql`. The migrations hold 15 CHECK clauses on those tables today, on `tasks` (6),
  `highlights` (5), `dossier_items` (2), `search_history` (1) and `assistant_note_versions` (1) **[measured]**; some
  may since have been replaced. A test lists the CHECKs live on those tables after the Postgres migrations and
  fails when one has no twin, by name.
- **Both rewrites hold for every later migration too.** A migration that rebuilds a table writes it again from the
  local schema, so the script that writes local migrations (section 4) applies the same date defaults and merges
  the same CHECKs. A test compares the CHECKs in the live local file, read from `sqlite_master`, with `checks.sql`.
- **Every table.** The local file holds all 82 tables, empty where the section is online. The split of G-514 and
  G-515 narrows that later; until then the code runs unchanged and online sections stop before the database
  (section 6).

### 3. The encrypted database

- **The library.** SQLite3MultipleCiphers 2.7.1, through `better-sqlite3-multiple-ciphers` 13.2.0, which has
  better-sqlite3's interface, ships prebuilt addons for macOS, Windows and Linux on x64 and arm64, and bundles
  SQLite 3.54.1 **[read]**.
  - The native driver and the adapter are development dependencies of `apps/server`: the local bundle carries them,
    and the online image does not install them. `lib/prisma.ts` loads the local client only in local mode, so the
    online server never loads a native SQLite.
  - Release 2.7.0 is «strongly recommended»: it fixes a backup path that «could deliver corrupted databases»
    **[read]**. Hence 13.2.0, not the 12.x line the adapter's dependency range names. npm `overrides` replace
    `better-sqlite3` with it, and the whole Work flow passes on it **[measured]**.
- **The cipher.** ChaCha20-Poly1305, the library's default, which authenticates every page **[read]**. The SQLCipher
  scheme is available too, but its compatibility mode («legacy») «is not recommended» for new databases **[read]**.
  In the trial, with each of the three:
  - the file starts with random bytes and holds no readable text;
  - a wrong key or no key is refused («file is not a database»);
  - one bit flipped at five places among the rows is refused five times out of five **[measured]**.

  The database, its journal and its WAL are encrypted; temporary files are not **[read]**, so the local client sets
  `temp_store=MEMORY`.
- **The key.** 32 random bytes made at first launch and kept in the system's credential store: the keychain on
  macOS, Credential Manager on Windows (§10.2). The shell reads it (the `keyring` crate) and writes it to the sidecar's stdin, beside the launch secret it already sends. The sidecar holds
  it in memory only, passes it as a raw key (`PRAGMA key="x'…'"`: no key derivation at open) and never writes it to
  a file, a log or an environment its children inherit.
  - In the trial the key came from the keychain in 8–18 ms, and the database opened and checked in 32–78 ms
    **[measured]**.
- **How the key reaches the file.** The adapter opens the file itself. A subclass of `PrismaBetterSqlite3`
  overrides `connect()`:
  1. it sets the cipher and the key first;
  2. it sets `locking_mode=EXCLUSIVE` (section 4);
  3. it checks the key with a read;
  4. it sets `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON` (SQLite's default is off: no cascade
     otherwise), `temp_store=MEMORY` and `busy_timeout`, and on macOS only `fullfsync=ON` and
     `checkpoint_fullfsync=ON`;
  5. it wraps the adapter in the connection lock below.
- **One connection, one lock.** `@prisma/adapter-better-sqlite3` 7.10.1 queues interactive transactions behind its
  own mutex, but a plain query does not wait for it **[read]**. On the single connection, a query from another
  request runs *inside* the open transaction. In the trial:
  1. request A opened a transaction, updated a dossier and, 200 ms later, failed;
  2. request B wrote a highlight in the meantime, got its answer in 3 ms, and had read A's uncommitted update;
  3. B's write was gone after A rolled back **[measured]**.

  The local client wraps the adapter in a FIFO lock. A plain query holds the lock for its own duration; a
  transaction holds it from `BEGIN` to `COMMIT` or `ROLLBACK`; queries inside a transaction go through the
  transaction object and never wait on themselves. With the lock, B waited 155–157 ms, read nothing uncommitted, and
  its write stayed **[measured]**.
  - **The wrapper runs transactions itself.** If `BEGIN` throws, the adapter never releases its own mutex
    **[read]**, and every later transaction would wait for ever. So the wrapper never calls the adapter's
    `startTransaction`. It implements the `Transaction` interface of `@prisma/driver-adapter-utils` on the same
    connection: `BEGIN`, the adapter's own query methods, `COMMIT`, `ROLLBACK` and the savepoints, all under its
    lock. A failed `BEGIN` releases the lock, and a test checks that the next query and the next transaction both
    run.
  - The lock also makes it correct to drop the row locks of Postgres (section 5): under it no other statement runs
    between a read and the write that follows.
  - The same behaviour is worth reporting to Prisma; the lock stays until the adapter does the same itself.

### 4. Migrations on the lawyer's computer

- **Prisma Migrate cannot open an encrypted file**: its schema engine carries a plain SQLite. Local migrations are
  SQL files, applied by the server at start-up through the encrypted connection.
- **Making them.** A release that changes `schema.prisma` regenerates `prisma/local/schema.prisma` (section 2), and
  `prisma migrate diff` from the previous local schema to the new one writes
  `prisma/local/migrations/<timestamp>_<name>/migration.sql`. Data changes written by hand in a Postgres migration
  get their SQLite twin in the same folder, reviewed in the same pull request.
- **Applying them**, in order, each once, recorded in `_lexcraft_migrations`:
  1. an encrypted backup of the file (section 7);
  2. `PRAGMA foreign_keys=OFF`, before the transaction. On SQLite a migration rebuilds a table: it creates the new
     one, copies the rows and drops the old one. The pragma has no effect inside a transaction, and with foreign keys
     on, dropping a parent table would fire `ON DELETE CASCADE` on its children;
  3. every pending migration in one transaction;
  4. `PRAGMA foreign_key_check` before `COMMIT`, then `integrity_check`, then `foreign_keys=ON` again;
  5. if anything fails, the transaction rolls back and the app says so; the backup is kept.

  A test rebuilds `dossiers` in a migration and finds every `dossier_items` row still there.

  The first launch creates the schema in one transaction: one statement at a time with `fullfsync` took 1.3–1.5 s
  in the trial **[measured]**.
- **One instance.** Two processes on one file would each think they hold the only connection.
  - The data folder has its own lock, `lexcraft.db.lock`. It is a small SQLite file in rollback-journal mode with
    `locking_mode=EXCLUSIVE`, written once. The sidecar takes it before anything opens the database (the migrations
    and the client both take it, once per process) and keeps it until it closes.
  - The operating system releases it when the process ends, however it ends, so a crash leaves no stale lock. The
    file holds a pid and a time, never data.
  - A second process is refused with «another LexCraft process has this data folder open».
  - Why not the database's own lock: the trial relied on `locking_mode=EXCLUSIVE` on the database itself, in WAL
    mode. It refused a second process on macOS and on both Windows runners **[measured]**, but Linux CI let a
    second process read the file while the first held it **[measured, #760]**. The lock file behaves the same on
    every system. The database keeps its exclusive mode as well.
  - Tests:
    - a second process started right after start-up is refused, and so is the test's own process;
    - twenty plain processes trying the lock are refused;
    - the folder opens again once the first has exited.

    The test ran 100 times out of 100 on macOS.
  - The shell also refuses a second window (Tauri's single-instance plugin).

### 5. The SQL only Postgres understands

The server has 104 hand-written statements (`$queryRaw`, `$executeRaw` and their `Unsafe` forms). Prepared against
the encrypted schema **[measured]**:

| | Work | Learn | Online only | Total |
|---|---|---|---|---|
| Valid SQLite as written | 2 | 2 | 3 | 7 |
| Valid once row locks and `::type` casts are dropped | 21 | 37 | 16 | 74 |
| Advisory locks (`pg_advisory_xact_lock`) | 3 | 3 | 0 | 6 |
| Savepoints (SQLite has them) | 0 | 3 | 0 | 3 |
| **To be rewritten** | **2** | **7** | **5** | **14** |

- **The two in Work** are both in `tasks/tasks.ts` `reorderTasks`: `= ANY(array)` in the read, and
  `unnest … WITH ORDINALITY` with `now() AT TIME ZONE 'UTC'` in the update. They are rewritten in SQL both databases
  accept, or as one Prisma update per task inside the transaction, with the existing tests run on both.
- **Locks become a seam, not a regex.** A small module (`src/lib/sqlDialect.ts`) gives `forUpdate()` (the clause
  on Postgres, nothing on SQLite) and `advisoryXactLock(key)` (the call on Postgres, nothing on SQLite, where the
  connection lock already excludes every other statement). The Work statements that lock use it.
  - The trial dropped the clauses with a regular expression; the seam replaces it. A test fails if a raw statement
    under `src/` names `FOR UPDATE` or `pg_advisory` outside it. The exceptions are the files of the sections that
    stay online (Learn, the Forum and its controllers, the account's removal of contributions), allowed by name
    with the reason.
- **Casts.** Work's statements stop casting where the column type already says it (`::text`, `::int`). Where a cast
  matters, the dialect module gives the expression.
- **Learn and the online sections** keep their Postgres SQL: they do not run locally (section 6). Their 12
  statements are rewritten only if a later milestone brings those sections offline.
- **Json read by raw SQL.** On SQLite a Json column comes back as text from `$queryRaw`. One Work statement returns
  one: the trash restore's `DELETE … RETURNING payload` (`trash/trash.ts`). It parses the value through the dialect
  module, and a test covers it.

### 6. The local entry point

`apps/server/src/local/main.ts` starts the same Express app in local mode (`LEXCRAFT_MODE=local`). It is built from
the 17 November trial, whose port checks all passed.

- **The handshake with the shell.**
  - The shell starts it with the data folder and the built web folder. On stdin, one line: `key=<64 hex>
    launch=<secret>`, the database key and a secret the shell makes for this launch.
  - It answers with one line on stdout once it listens on `127.0.0.1`: `LEXCRAFT_READY port=… ready_ms=…`.
  - When stdin closes, however the shell ended, it closes the database and exits. This holds during start-up too.
  - The server's own secrets (its JWT secret, the act files' key) are derived from the database key (HKDF), so
    nothing secret is written in the data folder. The process works from the data folder, and in local mode no
    `.env` is read.
- **The window's cookies.**
  - The shell calls `POST /__lexcraft/session` with `Authorization: Bearer <launch secret>` and receives two cookies:
    `lexcraft_window`, a random value made for this launch, and the local profile's web session.
  - It sets them in the window's own cookie store (Tauri's `Webview::set_cookie`, HttpOnly, SameSite=Strict,
    Path=/), then loads `http://127.0.0.1:<port>/`.
  - The launch secret never travels in a URL. A request that looks like a browser's (an `Origin` or any `Sec-Fetch-*`
    header) is refused even with it.
  - Each exchange ends the profile's earlier sessions, so a cookie a window kept from an earlier launch opens
    nothing.
  - (This replaces the trial's `/__lexcraft/open?k=<secret>`, a one-use secret in the window's first address.)
- **The port.** It listens on `127.0.0.1` only. A fixed port with a few fallbacks, so the page's origin, and with it
  the web's local storage, stays the same across launches. Each request must carry:
  - a `Host` of `127.0.0.1:<port>`; any other is refused with 421, against DNS rebinding;
  - no foreign `Origin`, and no `Sec-Fetch-Site` of `cross-site` or `same-site` (403);
  - the window's cookie (403 without it).

  No CORS header is ever sent: the page is same-origin, and no other page may read an answer **[tested, #762]**.
- **What the shell must do.** Cookies ignore ports, so a window sent to another `127.0.0.1` port would hand its
  cookies to whoever listens there.
  - The shell uses the port of the READY line, never a constant.
  - It blocks every navigation off that exact origin (Tauri's `on_navigation`) and opens external links in the
    system browser.
- **The local profile (G-514).** At first launch the server creates one local user, with no usable password. The
  exchange above creates its web session (the cookie session of G-455, `auth/webSession.ts`), which lasts as long as
  the launch. Locally:
  - `/api/auth/login`, `/register`, the refresh, sign-out and the password routes answer that they are not needed;
  - the account for Forum and Learn arrives with M3.
- **The web on the session cookie, before M2.** The web signs in without a form only once it has moved to the
  session cookie (step 2 of A.1, G-455): it relies on the cookie and sends `X-VisuaLex-Client: web` on writes. The
  web pinned today still keeps JWT tokens in its local storage. That step lands in lexcraft-web before the first
  internal app, with no local stopgap; the M1 tests act as the moved web.
- **What answers where.**
  - The Work routes run as they are.
  - The source routes (`/fetch_article_text` and the others the web calls) answer from the local text copy, or 503
    «serve la rete» until M3 forwards them. The Work routes that would resolve a reference through the Python API
    (a norm or a decision added by reference, an entry's text) reach no source either: in M1 nothing leaves the
    process, not even for the Python API's default address, which another program on the computer could hold.
  - The online sections (Forum, Learn, the experts, OAuth, administration) answer 503 «sezione online» before
    reaching the database.
  - The background jobs that belong online (the MERL-T watchdog and erasure worker, the Forum sweeper, the norm
    watcher) do not start.
- **The web is served from the same origin**, so its relative calls to `/api` and to the sources work unchanged.
  Nothing in lexcraft-web changes for M1.

### 7. Durability and backups

- **A commit survives a power cut.** In WAL mode `synchronous=FULL` is «atomic, consistent, isolated, and durable»,
  while with `NORMAL` a committed transaction «might roll back following a power loss» **[read]**. On macOS only
  `fullfsync` takes the data past the drive's cache **[read]**. Cost per commit, in the trial **[measured]**:
  - `synchronous=FULL` with `fullfsync`: 3.8–3.9 ms;
  - `synchronous=FULL` without it: 0.12–0.15 ms;
  - `synchronous=NORMAL`: 0.02–0.03 ms.
- **A process crash loses nothing acknowledged.** The server was killed (`kill -9`) after 40 writes it had answered,
  with 20 more on their way, 15, 60 or 150 ms into that burst. Over 9 rounds no acknowledged write was missing
  (42–60 per round, counting those of the burst answered before the kill), and the file reopened in 166–340 ms
  **[measured]**.
- **An encrypted backup with its own key** (M4 builds the feature; M1 builds the call the migrations use):
  1. `VACUUM INTO '<file>'` writes a consistent copy, already encrypted with the database key;
  2. `PRAGMA rekey` on the copy moves it to a backup key.

  Timings and checks **[measured]**:
  - 2 MB took 8 + 16 ms; 50 MB took 327 + 449 ms;
  - the database key no longer opens the copy, and a flipped bit in it is refused.

  Two shortcuts fail on purpose:
  - SQLite's backup API refuses an encrypted source and a plain target («incompatible source and target
    databases»), which is safe;
  - `VACUUM INTO` a URI that names its own cipher and key does not work in this build, whose URI filenames are off.

  Where the backup key comes from is a decision for the owners (D1).

### 8. Tests and CI

- **A new CI job, «local», on macOS and on Windows** (§10.7). It generates the local client, creates an encrypted
  file with a test key, and runs on it:
  - the Work test files (dossiers, entries, notes, highlights, trash, tasks, act files, the assistant's proposals);
  - the tests of this design.

  The server job keeps Postgres for everything. The test setup's guard, which refuses a database that is not a
  test one, gains a twin for the local file.
- **New tests:**
  - the schema drift check;
  - the twin check of the CHECK constraints;
  - the date format;
  - the connection lock: the trial's two-request case, and a failed `BEGIN` that leaves the next query and the next
    transaction free;
  - the wrong key refused;
  - a flipped bit refused;
  - a migration that fails and leaves the file as it was;
  - a migration that rebuilds `dossiers` and leaves every `dossier_items` row;
  - the live CHECKs equal to `checks.sql` after a migration;
  - a second process refused;
  - the dialect seam's guard;
  - the handshake and the port's checks, one by one and on the real process: a request without the cookie, with
    another `Host`, from a foreign `Origin`, with the secret in a URL, each refused; loopback only; no CORS header;
    no source reached; a killed shell leaves no server running.
- **The trial's flow, kept as a script.** 19 checks: open a practice, read a text from the local copy, highlight,
  note, trash and restore an entry and a whole practice, restart and read everything back, and the port's
  refusals. It passed 19 of 19 on the encrypted file **[measured]** and becomes the local job's smoke test.

### 9. Security notes

- **What the encryption protects.** The file at rest: a stolen disk, a backup copied elsewhere, a synced folder.
  It does not protect against a program running as the same user while the app is open; the key is in the
  sidecar's memory then. The app says so in its privacy note.
- **The keychain.** An app signed with a Developer ID keeps its identity across updates, so the keychain item it
  created stays its own. An ad-hoc signature identifies only that one build **[read]**. That macOS shows no prompt
  after a signed update is our inference: Apple's text does not say it in those words.
  - Hence the first internal build (ad-hoc) may ask for the keychain at each update; the distributable one is
    signed (M5).
  - Apple calls the file-based keychain «on the road to deprecation» and points to the data-protection keychain,
    which needs a provisioning profile **[read]**; M5 checks whether a Developer ID build can use it.
- **The port checks** of section 6 stay as they are, and so do the server's own rules: per-user ownership, the caps,
  deletions going to the trash.
- **No secret in the repository**; the test key is generated per run.

### 10. Two platforms from the first version: Apple Silicon and Windows x64

The first internal app and the first distributable version run on Apple Silicon Macs and on Windows x64 PCs.
Windows on ARM and Intel Macs are optional (§10.9).

#### 10.1 The encrypted stack on Windows, measured

One probe ran unchanged on GitHub-hosted runners on 26 November 2026 (three runs; the table gives their ranges), from a throwaway branch with a read-only
token. It covered the stack of §3: Prisma 7.10.1, the better-sqlite3 adapter, SQLite3MultipleCiphers 2.7.1,
ChaCha20, the connection lock, the OS credential store, and the server's schema derived for SQLite **[measured]**:

| | Windows x64 (`windows-latest`) | Windows on ARM (`windows-11-arm`) | macOS, Apple Silicon (`macos-latest`) |
|---|---|---|---|
| Prebuilt addon loads (Node 24.22.3) | yes, 2.3 MB | yes, 2.2 MB | yes, 2.2 MB |
| Key in the credential store: set / read / delete | 8–16 ms / 0.5–0.9 ms / ok | 15–35 ms / 0.9–1.1 ms / ok | 247–315 ms / 1.5–2.6 ms / ok |
| Readable text in the file; wrong key | none; refused | none; refused | none; refused |
| A flipped bit refused | 5 / 5 | 5 / 5 | 5 / 5 |
| The server's 82 tables through Prisma 7 | yes | yes | yes |
| Big practice (200 entries, 600 highlights), median | 6.0–10.4 ms | 13.6–13.9 ms | 5.6–10.6 ms |
| Bytes round-trip; foreign-key cascade | ok; ok | ok; ok | ok; ok |
| A second process on the open file | refused | refused | refused |
| Two requests at once, without / with the lock | write lost / kept | write lost / kept | write lost / kept |
| Process killed during writes, 15 rounds (5 per run) | 0 lost of 565–13,682 acknowledged per round | 0 lost of 21–344 | 0 lost of 149–2,650 |
| Commit with `synchronous=FULL` | 0.09–0.19 ms | 4.5–13.1 ms | 0.15–0.17 ms (1.2–1.3 ms with `fullfsync`) |
| Shell killed: the sidecar exits through its stdin's end (third run) | 7.8 ms | 8.9 ms | 103–107 ms |

- The runners are cloud virtual machines. Their disks decide the cost of a commit, so 0.09 ms on Windows x64 says
  nothing about a laptop's drive.
- **Node.** The probe ran on Node 24.22.3, the major the server's CI and image use. The local macOS trial also ran
  on Node 26.5.0 **[measured]**; the addon on Node 26 under Windows is untested. The sidecar ships the Node the CI
  tests (24 today), and moves to 26 with a CI matrix that covers both platforms.
- `fullfsync` is macOS-only **[read]**; on Windows `synchronous=FULL` alone is the setting.
- `windows-latest` is Windows Server 2025, not Windows 11 **[read]**: the desktop pass of §10.8 stays necessary.

#### 10.2 The key on Windows

- **The store.** The shell keeps the key in Windows Credential Manager through the same `keyring` crate (4.2.0)
  as on macOS: its Windows store holds a generic credential of at most 2,560 bytes, far above a 32-byte key **[read]**.
- **What protects it.** Windows encrypts the credential with the user's logon session key; DPAPI lets «only a user
  with the same logon credential» decrypt **[read]**.
  - As on macOS, a program running as the same user can read it while the user is logged in. No Microsoft page says
    so in those words; it follows from the per-user scope.
  - Credential Guard does not cover generic credentials **[read]**.
- **Roaming.** The crate's default persistence («Enterprise») roams with a roaming profile **[read]**. The local
  mode picks a persistence that stays on the PC, if the store offers one; M2 checks it **[estimated]**.

#### 10.3 The Node sidecar on Windows

- **The binary.** Tauri names the sidecar `node-x86_64-pc-windows-msvc.exe` (and `-aarch64-pc-windows-msvc.exe` on
  ARM) **[read]**. The official `node.exe` of Node 26.13.1 weighs 100 MB on x64 and 88 MB on ARM **[read]**; Node
  24's is of the same order **[estimated]**.
- **When the shell dies.** The shell plugin kills only children spawned from its JavaScript API, or a Rust child
  with `kill_on_drop`. A Windows job object does not end its processes when it is closed **[read]**. So if the shell
  is killed, the sidecar would survive unless it watches for that itself.
  - The design's contract (§6) is that the sidecar exits when its stdin closes. The probe killed a stand-in shell
    (TerminateProcess on Windows). In the third run the sidecar saw its stdin close and exited through its own
    handler **[measured]**: after 7.8 ms on Windows x64, 8.9 ms on Windows on ARM and 107 ms on macOS (103 ms in
    the second run).
    - The stand-in shell is a Node process. On Windows Node puts its children in a job object that kills them with
      it, which a Rust shell does not do: in the second run the job object, not the contract, ended the sidecar on
      both Windows runners. The third run starts the stand-in sidecar detached, so only the stdin contract could
      end it.
  - The shell also sets `kill_on_drop` for a normal exit.
- **Paths and the port.** The data folder is the app's data directory that Tauri resolves per platform. The port
  checks of §6 do not depend on the platform.

#### 10.4 WebView2 and WebKit

- **WebView2 is Chromium and updates itself; WebKit updates only with macOS** **[read]**.
- **Installing WebView2.** Microsoft preinstalls the Evergreen runtime on all Windows 11 devices and installed it on
  eligible Windows 10 devices, but «a small number» lack it and Microsoft advises shipping it anyway **[read]**.
  - The installer embeds the bootstrapper (`embedBootstrapper`, about 1.8 MB), which installs the runtime when it
    is missing.
  - The updater's bundles always use the downloading bootstrapper **[read]**.
- **What differs, as Microsoft and Tauri state it** **[read]**:
  - Push notifications, the Web Payment API and Periodic Background Sync do not exist in WebView2;
  - downloads are WebView2's own, and Tauri's download handler sets where they go (on macOS the finished path
    comes back empty);
  - `window.print()` works on both;
  - zoom keys are native on Windows and need a polyfill on macOS;
  - the user data folder is not removed when the app is uninstalled.

  What the web needs to do about it is in §10.10.
- **Accessibility.** No Microsoft page states screen-reader support for WebView2 in so many words; Edge exposes its
  content through UI Automation **[read]**. The release checks include a pass with Narrator and NVDA (§10.8).

#### 10.5 Installer and updates on Windows

- **NSIS, per user.** The NSIS installer in `currentUser` mode needs no administrator and installs under the user's
  local application data **[read]**. The MSI installs per machine and is built only on Windows **[read]**.
- **Updates.** With `createUpdaterArtifacts`, the updater reuses the signed `-setup.exe` with its `.sig`; the
  default `passive` mode shows progress and needs no clicks **[read]**. One `latest.json` lists both platforms,
  each entry checked against the updater key (§ «After M1», M5).

#### 10.6 Signing on Windows

| Option | Who can enrol | Cost per year | Delay to first signature | From CI |
|---|---|---|---|---|
| **Azure Artifact Signing** (formerly Trusted Signing), Basic | organisations in the EU, Italy included; individuals only in the US and Canada | about US$120 (US$9.99 a month, 5,000 signatures) plus a paid Azure subscription | 1–30 working days of identity validation | yes, on Windows runners only |
| OV certificate with cloud signing | registered organisations | SSL.com US$129 plus eSigner from US$15 a month; Certum cloud from €209; DigiCert KeyLocker US$996 | 1–5 days | yes, with the vendor's tool |
| EV certificate | registered organisations | from US$349 | 3–7 days | as OV |

All **[read]**.

- **Why EV is not worth it.** Microsoft: «EV certificates no longer bypass SmartScreen… Paying a premium for EV
  solely to avoid SmartScreen warnings is no longer justified». Reputation builds over downloads either way **[read]**.
- **Hardware keys and CI.** Since 1 June 2023 a code-signing key must live in a hardware module or a cloud signing
  service, so a GitHub-hosted runner signs through a cloud service, never a USB token **[read]**.
- **What Artifact Signing involves.**
  - Its certificates last 72 hours, so every signature is timestamped.
  - Validation needs the organisation's legal name and identifier, the legal representative's identity check, and
    documents issued within the last 12 months.
  - Free and sponsored Azure subscriptions are not accepted **[read]**.
  - Whether it validates an Italian association without an entry in a public register is not stated **[read]**.

  The identity is a decision for the owners (D3).

#### 10.7 CI for both platforms

GitHub's hosted runners are free for public repositories **[read]**:

| Runner | What runs there |
|---|---|
| `macos-latest` (Apple Silicon) | the local job, the app's build, signing and notarization |
| `windows-latest` (x64) | the local job, the app's build, signing (Artifact Signing runs only on Windows), and the automated UI smoke test |
| `windows-11-arm` | optional (§10.9) |

- **Automated UI tests.** Tauri's WebDriver tool works on Windows and Linux, not on macOS («macOS has no WKWebView
  driver tool») **[read]**. Windows therefore carries the automated UI smoke test: launch, the local profile, open
  a practice, highlight, close. macOS gets the scripted flow of §8 against the sidecar, and the manual pass.

#### 10.8 A manual pass on a real Windows machine

The owners work on Apple Silicon Macs. The options:

| Option | What it tests | Limits |
|---|---|---|
| (a) A real Windows 11 x64 PC kept for testing (an owner's, or a small dedicated one) | the x64 build on x64 hardware, WebView2, Credential Manager, SmartScreen, the installer, a screen reader | one more machine to keep updated |
| (b) Windows 11 on Arm in Parallels Desktop on a Mac | the ARM OS; the x64 build under Prism emulation | Microsoft names Parallels 18–20 on M1–M3 as authorized, each VM needs its own licence, and M4/M5 Macs are not mentioned **[read]** |
| (c) CI only | the automated smoke test on Windows Server 2025 | no desktop session, no human eye |

Which one is a decision for the owners (D4); the recommendation there is (a) for each release and (b) day to day.

#### 10.9 Windows on ARM and Intel Macs: optional

| Target | What it adds | Cost **[estimated]** |
|---|---|---|
| Windows on ARM | the `aarch64-pc-windows-msvc` build; `node.exe` for ARM (88 MB); the same installer and signing. The encrypted stack already passed on `windows-11-arm` **[measured]** | 1–2 days, then one more CI job per release |
| Intel Macs | an `x86_64-apple-darwin` build, or a universal one carrying both Node binaries (about 100 MB more); the addon's package carries a `darwin-x64` build **[measured]**; no Intel Mac to test on | 2–3 days, and a test machine or a hosted Intel runner |

#### 10.10 For the web owner

Nothing here blocks M1, and nothing changes lexcraft-web for M1. Before the first distributable version, the web
needs these, built by the porting line and approved by the web owner:

1. **Downloads.** Every download goes through one function, so the shell can open a save dialog on both platforms.
   WebView2 handles downloads itself; on macOS the finished path comes back empty.
2. **External links.** They go through one function, which the shell hands to the system browser.
3. **Printing.** Use `window.print()`, which works in both views.
4. **Missing features.** Nothing may depend on push notifications, the Web Payment API or background sync, which
   WebView2 lacks.
5. **Without a network.** The online sections show a «senza rete» message when there is no network.
6. **Undo before closing.** Deletions with «Annulla» are sent before the window closes.
7. **The engine's version.** Checked at start: an old WebKit asks to update macOS, an old WebView2 asks to update
   Windows.
8. **Memory.** The view's growth between practices, measured in WebKit (§ «Measured in the trial»), is measured
   in WebView2 too.
9. **One pass on each platform before each release.** Fonts, zoom, keyboard shortcuts (⌘ on macOS, Ctrl on
   Windows), the spell checker, which no official page documents, and a screen reader.

## Measured in the trial

Final configuration: SQLite3MC 2.7.1, ChaCha20, the connection lock, the «small» compiler. All **[measured]**
unless marked.

The whole-app rows mix two builds: two of the three runs of each used the earlier build, with SQLite3MC 2.3.5 in
SQLCipher 4 mode, whose server measured the same memory on its own. The totals leave out a WebKit GPU process
belonging to another app on the same Mac (24 MB); counted in, the open-practice runs read 381–393 MB and the
session runs 394–446 MB.

| | Result |
|---|---|
| Work flow without a network, 19 checks | 19 / 19 |
| `kill -9` during writes, 9 rounds | 0 acknowledged writes lost; reopened in 166–340 ms |
| Key from the keychain / open and check | 8–18 ms / 32–78 ms |
| Big practice (200 entries, 600 highlights), server side | median 13.0–14.1 ms, 90% under 17 ms |
| Server's memory (physical footprint) | 132–157 MB; Prisma 6's native engine on a plain file: 76–92 MB |
| Whole app, big practice open | 357–369 MB (3 runs) |
| Whole app, after 30 practice switches | 370–422 MB (3 runs) |
| Whole app, first open after a fresh sign-in | 467–620 MB (2 runs), mostly WebKit and its GPU process |
| Server bundle / app without Node / zipped | 12.2 MB / 23 MB / 8.7 MB |
| App with Node | 125–165 MB on disk, about 50 MB to download **[estimated]** |
| Data of the trial | 2.1 MB, encrypted |

- **Where the memory goes.** The cipher and the driver add about 3 MB; Prisma 7's WebAssembly query compiler adds
  30–80 MB at the first query, depending on the build **[measured]**.
- **The threshold.** With the big practice open the app stays within the 400 MB of G-554. A long session goes past
  it, mostly in the web view, as it did on every road measured.

## After M1: the milestones to the first app

Times are working days of one line of sessions, with tests and a review after each task, for both platforms
**[estimated]**:

| Milestone | What | Days |
|---|---|---|
| **M1** | The local mode in the core (this document), its CI job on macOS and Windows | 11–15 |
| **M2** | The app's repository and shell on both platforms; **first internal app** (G-615: the repository is created once M1 is merged) | 7–10 |
| **M3** | Online through the local server (G-515): sources and online sections, the account, the byte-exact text copy | 6–9 |
| **M4** | Encrypted backups and their restore | 2–3 |
| **M5** | Signed releases for both platforms (notarized on macOS), self-updating, one release for web and app (G-573, G-517); the Windows desktop pass and the accessibility checks | 7–10, plus Apple's and Microsoft's lead times |
| M6 | The local MCP server (G-516), on both platforms | 4–5 |
| M7 | Slot for the practices-as-folders and the local deadline register | set by their design |
| M8 | Optional: Windows on ARM, Intel Macs (§10.9) | 1–2 and 2–3 |

- **First internal app:** M1 + M2, 18–25 days, against 14–20 for macOS alone.
- **First distributable version:** M1–M5, 33–47 days, against 26–38.
- **Lead times outside the work**, which run in parallel:
  - the Apple Developer account (G-616), with its D-U-N-S number;
  - Microsoft's identity validation for Artifact Signing (D3), 1–30 working days.

How each milestone follows current practice, with its source:

- **M2, the shell.**
  - The specifics of Windows are in §10.2–10.5: Credential Manager, `node.exe`, WebView2's bootstrapper, the NSIS
    installer per user, and the sidecar's exit when the shell dies.
  - Tauri 2.12 (crate 2.12.7, CLI 2.12.6). The sidecar ships through `bundle.externalBin` with the target-triple
    naming, and is spawned through the shell plugin's sidecar API under a capability that allows only it **[read]**.
  - Node ships as the official binary. Its single-executable form (SEA) is still «Active development», and it
    carries native addons only as files written out at run time **[read]**.
  - The page is served by the sidecar on `127.0.0.1` with the checks of section 6. Tauri's own localhost plugin
    warns of «considerable security risks» and is not used **[read]**.
  - The shell does what section 6 asks of it: the exchange of the launch secret for the window's cookies, set with
    `Webview::set_cookie` (in Tauri 2.11.1's source **[read]**; M2 checks it on WebKit and WebView2), the READY
    line's port, and no navigation off the page's origin.
  - The web is on the session cookie by then (section 6).
- **M3, the account.** It follows OAuth for native apps (RFC 8252): the system browser, a loopback redirect, PKCE,
  against the server's existing OAuth authorization server. The local server keeps the refresh token in the
  keychain and adds it to the requests it forwards; the web does not change.
  - The text copy stays byte-exact (rule 23): a test compares it with the online answer on the texts already in the
    tests.
- **M4, backups.**
  - Automatic copies: before each migration, at closing and once a day.
  - Kept: 7 daily and 4 weekly. An export to a folder the lawyer picks, such as an external disk.
  - Restore from the menu, with `integrity_check` before the restored file replaces the live one.
- **M5, the release.**
  - A Developer ID Application certificate, which only the account holder can create, the hardened runtime and
    `notarytool` with stapling **[read]**.
  - Signing goes from the inside out: Node, then each native addon (`.node` files are Mach-O images and must be
    signed), then the app **[read]**.
  - Node runs with the entitlements its own release carries for V8 (`allow-jit`,
    `allow-unsigned-executable-memory`); whether a smaller set suffices is tested, since Apple advises against the
    second **[read]**.
  - `tauri-plugin-updater` 2.14: signed updates with the updater key pair, a static `latest.json` on GitHub Releases.
    A lost updater key ends updates for every installed copy, so two owners keep it **[read]**.
  - One product tag builds the online images and the installers from the same pins (G-573).
  - **Accessibility:** WCAG 2.2 AA, which W3C advises **[read]**, with a keyboard-only pass and a VoiceOver pass in
    the WebKit window. Tauri documents no accessibility support of its own, and its tracking issue has been open
    since 2019 **[read]**. Whether the European Accessibility Act covers software sold to professionals is not
    settled by any official page read **[read]**; the app applies WCAG 2.2 AA anyway.
- **M6, the local MCP.**
  - The specification (revision 2026-07-28) recommends stdio for a local server, «to limit access to just the MCP
    client» **[read]**.
  - A small stdio program inside the app speaks to the local server over a private channel, with a key per client
    that the lawyer creates and revokes. The channel is a Unix socket in the app's private folder on macOS, and a
    named pipe or the loopback port with that key on Windows, to be chosen in M6 **[estimated]**. The server's rules apply to it unchanged.
  - Claude Code adds it with `claude mcp add`; Claude Desktop installs it as an MCP Bundle (`.mcpb`) **[read]**.

## Decisions for the owners

**D1 · Where the backup key comes from.** The database key lives in one Mac's keychain; a backup must open on
another computer if that Mac is lost.

- (a) **A recovery code** shown once at first launch (24 words), which the lawyer prints and keeps. The backup key
  derives from it (Argon2id). Lose both the Mac and the code, and the backups are unreadable.
- (b) The backup key in the keychain, synchronised through iCloud Keychain (end-to-end encrypted by Apple). It needs
  the data-protection keychain and an Apple account, and ties recovery to Apple.
- (c) Backups with the database key only: they restore on the same Mac, and are lost with it.
- **Recommendation: (a).** It works without any third party, and the lawyer holds the only way back in; the app
  asks to confirm three of the words before going on.

**D2 · The memory threshold for a working session.** G-554 set 400 MB for the app with a big practice open, which
holds (357–369 MB). After 30 practice switches the app measured 370–422 MB, and the first open after a fresh
sign-in 467–620 MB, mostly in WebKit.

- (a) Keep 400 MB with a practice open. Set **450 MB** for a session, measured on a real working day before the
  first distributable version. M2 removes the sign-in form (G-514), which should remove the worst case measured **[estimated]**.
- (b) 400 MB for the session too: the web view's growth between practices is chased first, in lexcraft-web.
- **Recommendation: (a).**

**D3 · The identity that signs the Windows build.** G-517 puts the signing certificates in the association's
name. The options are in §10.6.

- (a) **Azure Artifact Signing, Basic**, in the association's name: about US$120 a year plus a paid Azure
  subscription. The legal representative goes through an identity check, with documents issued in the last 12
  months; validation takes 1–30 working days. Signing runs in CI on Windows runners.
- (b) An OV certificate with cloud signing (for example SSL.com with eSigner, about US$129 a year plus from US$15 a
  month), in the association's name, in 1–5 days.
- (c) EV: dearer, and Microsoft says it no longer bypasses SmartScreen.
- **Recommendation: (a)**, started now because of its lead time, with (b) as the fallback if Microsoft's
  validation stalls (for instance if it wants a public register entry the association lacks).

**D4 · The Windows machine for the manual pass** (§10.8).

- (a) A real Windows 11 x64 PC kept for testing, an owner's or a small dedicated one.
- (b) Windows 11 on Arm in Parallels on a Mac: x64 runs under emulation, and Microsoft's page names M1–M3 only.
- (c) CI only.
- **Recommendation: (a) before each release, (b) day to day.** The automated UI test runs on Windows in CI either
  way.

**The Apple Developer account** (G-616) is already with the owners: M5 depends on it, and the keychain behaviour of
section 9 too.

## Not in this change

- Any change to lexcraft-web or lexcraft-mcp.
- Learn, the Forum and the experts offline: they stay online, and so do their 12 Postgres-only statements.
- Synchronisation, teams and the client portal (G-566, G-570).

## Sources (read on 26 November 2026)

- **Prisma 7:**
  - SQLite and its driver adapters: https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite
  - driver adapters in general: https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers
  - upgrading to 7: https://www.prisma.io/docs/orm/v6/more/upgrades/to-v7
  - status of versions 6, 7 and 8: https://www.prisma.io/docs/llms.txt and https://www.prisma.io/changelog.md
- **The adapter's code:** `@prisma/adapter-better-sqlite3` 7.10.1, `dist/index.js`, as published on npm.
- **SQLite3MultipleCiphers:**
  - the ciphers and the default: https://utelle.github.io/SQLite3MultipleCiphers/
  - the SQLCipher scheme and its legacy mode: https://utelle.github.io/SQLite3MultipleCiphers/docs/ciphers/cipher_sqlcipher/
  - which files are encrypted: https://utelle.github.io/SQLite3MultipleCiphers/docs/architecture/arch_vfs/
  - releases 2.7.0 and 2.7.1: https://github.com/utelle/SQLite3MultipleCiphers/releases
- **better-sqlite3-multiple-ciphers 13.2.0:** https://github.com/m4heshd/better-sqlite3-multiple-ciphers
- **SQLite:**
  - durability: https://www.sqlite.org/pragma.html
  - the backup API: https://www.sqlite.org/backup.html
  - `VACUUM INTO`: https://www.sqlite.org/lang_vacuum.html
- **libSQL**, considered and set aside: its local default cipher is AES-256-CBC with no HMAC, so pages are not
  authenticated. https://github.com/tursodatabase/libsql/blob/main/libsql-sys/src/connection.rs
- **Tauri:**
  - sidecars: https://v2.tauri.app/develop/sidecar/
  - Node.js as a sidecar: https://v2.tauri.app/learn/sidecar-nodejs/
  - the localhost plugin and its warning: https://v2.tauri.app/plugin/localhost/
  - macOS signing: https://v2.tauri.app/distribute/sign/macos/
  - the updater: https://v2.tauri.app/plugin/updater/
  - the accessibility issue: https://github.com/tauri-apps/tauri/issues/207
- **Apple:**
  - notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
  - the hardened runtime: https://developer.apple.com/documentation/security/hardened-runtime
  - the two keychains: https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains
  - code signing requirements: https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
- **Node:**
  - single-executable applications: https://nodejs.org/api/single-executable-applications.html
  - the entitlements its release carries: https://github.com/nodejs/node/blob/main/tools/osx-entitlements.plist
- **The keyring crate:** https://docs.rs/keyring/latest/keyring/
- **MCP:**
  - the specification, revision 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices
  - MCP Bundles: https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
- **Accessibility:**
  - WCAG 2.2: https://www.w3.org/TR/WCAG22/
  - the European Accessibility Act: https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng
- **OAuth for native apps (RFC 8252):** https://www.rfc-editor.org/rfc/rfc8252
- **Windows, WebView2 and Tauri:**
  - the Evergreen runtime: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version
  - distributing WebView2: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
  - what WebView2 lacks: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features
  - its user data folder: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder
  - the Windows installer: https://v2.tauri.app/distribute/windows-installer/
  - the webview versions: https://v2.tauri.app/reference/webview-versions/
  - the configuration reference: https://v2.tauri.app/reference/config/
  - WebDriver tests: https://v2.tauri.app/develop/tests/webdriver/
  - Windows signing: https://v2.tauri.app/distribute/sign/windows/
  - the shell plugin's child processes: https://docs.rs/tauri-plugin-shell/latest/tauri_plugin_shell/process/struct.Command.html
- **Credentials on Windows:**
  - the credential structure and its size limit: https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw
  - handling passwords: https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords
  - DPAPI: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata
  - Credential Guard's limits: https://learn.microsoft.com/en-us/windows/security/identity-protection/credential-guard/considerations-known-issues
  - the keyring crate's Windows store: https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/
- **Node for Windows:** https://nodejs.org/dist/v26.13.1/win-x64/ and https://nodejs.org/dist/v26.13.1/win-arm64/
- **Signing on Windows:**
  - Artifact Signing, overview: https://learn.microsoft.com/en-us/azure/artifact-signing/overview
  - quickstart: https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
  - FAQ: https://learn.microsoft.com/en-us/azure/artifact-signing/faq
  - certificate management: https://learn.microsoft.com/en-us/azure/artifact-signing/concept-certificate-management
  - pricing: https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
  - SmartScreen reputation: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
  - the CA/Browser Forum's code-signing requirements: https://cabforum.org/working-groups/code-signing/requirements/
  - OV and EV certificates: https://www.ssl.com/products/software-integrity/code-signing/ov/ , https://www.ssl.com/products/software-integrity/code-signing/ev/ and https://www.certum.eu/en/code-signing-certificates/
- **GitHub-hosted runners:** https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- **Windows 11 on Apple Silicon Macs:** https://support.microsoft.com/en-us/windows/experience/platform-variants/options-for-using-windows-11-with-mac-computers-with-apple-m1-m2-and-m3-chips
  and Prism: https://learn.microsoft.com/en-us/windows/arm/apps-on-arm-x86-emulation
