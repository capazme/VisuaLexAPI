# Server — apps/server

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

MERL-T integration across server and web (routes, gates, guards, surfaces, slice history): `docs/merlt/claude-notes.md`.

### Node backend (`apps/server`)

Express + Prisma. Auth, and the persistence for every user-owned slice.

- `src/lib/prisma.ts` — the one `PrismaClient`; every module under `src/`
  imports `prisma` from it. Each client owns a connection pool (physical CPUs
  × 2 + 1 connections by default in Prisma 5; a flat 10 from Prisma 7), and
  until September 2026 the server loaded eighteen, one per module — eighteen
  pools against Postgres' `max_connections`. `tests/prismaClient.test.ts`
  fails when a module under `src/` constructs another; the test harness
  (`tests/setup.ts`, `tests/helpers.ts`) keeps its own clients on purpose.
- `src/index.ts` — graceful shutdown on SIGTERM/SIGINT: clear the MERL-T
  watchdog's and the saved-norm watcher's intervals, `server.close()`, drop each
  keep-alive socket as soon as it goes idle, `prisma.$disconnect()`, exit; a
  forced exit after 10 s. The idle sweep is load-bearing: a socket that was
  mid-request otherwise holds `close()` open for the whole keep-alive timeout
  (~6 s, measured), past what a process manager waits before its SIGKILL (pm2,
  on the old server, waited 1.6 s).
- `src/middleware/rateLimiter.ts` — tiers: anonymous 100/min (by IP),
  authenticated 300/min (by userId), writes 20/min. `RateLimiterRedis` when
  `REDIS_ENABLED=true`, else in-memory with a startup warning.
- `src/utils/redis.ts` — `getRedisClient()`, returns `null` when disabled;
  connection errors fail open.
- `src/middleware/auth.ts` — `authenticate` answers **401** only when the
  session is over: no token, a token that does not verify, the wrong type, a
  missing or disabled user. When it cannot read the user (the database is
  unreachable) it answers **503**: the web client treats a 401 as "log out",
  so a 401 there logged every open tab out at each database hiccup.
  `tests/authUnavailable.test.ts` holds both sides.
- `src/middleware/scrapeGate.ts` — the handlers behind `GET /api/auth/verify`, the question
  the production ingress (Caddy `forward_auth`) puts to the server before it lets a scraping
  request through to the Python API. In order: a cap per address (`SCRAPE_IP_POINTS`, 1200 a
  minute: a flood with no token stops here), `authenticate`, the user's quota
  (`SCRAPE_QUOTA_POINTS`, 300 points per `SCRAPE_QUOTA_WINDOW_SECONDS`, charged by the route
  the ingress names in `X-Forwarded-Uri`: an export 20, a stream 3, a whole act 5, the
  detailed health page 5, a decision lookup 2, anything else 1), then `204`. A `401` or `429`
  (with `Retry-After`) goes back to the browser as it is. Mounted **before** the general
  limiter in `app.ts` on purpose: it has limits of its own, and reading many articles must
  not spend the quota of every other call. Both caps count over
  `SCRAPE_QUOTA_WINDOW_SECONDS`. Limiter errors fail open, authentication never does.
- **The OAuth 2.1 authorization server** (MCP spike; spec
  `docs/superpowers/specs/2026-10-02-mcp-spike-design.md`), `src/oauth/` and
  `routes/oauth.ts`, mounted at the root **before** the general limiter and the
  body parsers: `/.well-known/oauth-authorization-server`, `/oauth/register`,
  `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/oauth/introspect`.
  Built on the MCP SDK's handlers one by one (pinned 1.31.0), not its
  `mcpAuthRouter`, whose metadata puts the endpoints at the root and knows no
  token exchange; the metadata is ours (`oauth/metadata.ts`) and `iss` equals
  its `issuer` character for character. Registration makes every client public
  (no secret, whatever it asked) and accepts only loopback redirect URIs and
  the `OAUTH_ALLOWED_REDIRECT_URIS` allow-list, at most five; on a loopback
  address only the port may differ (`oauth/redirectUri.ts`). `/oauth/authorize`
  never issues a code: it stores an `OAuthAuthorizationRequest` (ten minutes)
  and redirects to the web consent page, so calling it twice is harmless. The
  consent page uses `routes/oauthAccount.ts` (`/api/oauth`, user session): the
  first user who opens a request claims it; the decision is single use and
  issues a 60-second code bound to client, redirect, challenge and resource.
  Codes and tokens are stored only as SHA-256. Access tokens last 8 hours,
  refresh tokens 30 days and rotate; a replayed code revokes its chain, a
  replayed refresh token the whole grant. Introspection answers only the MCP
  server's credential (`mcp-omnilex`, HTTP Basic, `OAUTH_MCP_CLIENT_SECRET`).
  `GET`/`DELETE /api/oauth/grants` list and revoke the user's connected
  applications. Housekeeping (`oauth/sweep.ts`) runs, awaited, on registration
  at most every ten minutes: never fire-and-forget it, a background sweep
  deadlocked the test suite's TRUNCATE.
- `src/middleware/errorHandler.ts` — the only place a status is decided for an
  unhandled throw. `AppError` carries its own; a Zod `ZodError` becomes **400**
  naming the offending fields; everything else is a 500. Controllers therefore
  call `schema.parse()` and let it throw — 41 sites across 13 controllers — and
  must not catch it to hand-roll a status. The body is
  `{ detail: string, errors?: [{ field, message }] }`: `detail` stays a plain
  string because `services/api.ts` renders it straight to the user.
- **Environments**: `Environment` model keeps searchable metadata in columns
  (`name/description/author/version/category/color/tags`) and everything else in
  one opaque `content` JSON blob. Deliberately separate from `SharedEnvironment`
  (the forum entity) — a personal env can be promoted, the tables stay distinct.
- **QuickNorm / CustomAlias**: full CRUD, plus a dedicated `POST /:id/use` per
  entity (see gotcha 19). `CustomAlias` carries `@@unique([userId, trigger])`;
  the controller maps Prisma P2002 to 409.
- **Scoped bulk deletes**: `DELETE /annotations` and `DELETE /highlights`, both
  scoped to `req.user.id`. Intended caller is `applyEnvironment(replace)` ONLY —
  do not wire into end-user UI without a dedicated confirm flow.
- Dossier item mutations are scoped to their dossier (IDOR fix — keep it that
  way when adding item routes). `POST`/`GET /dossiers/:id/snapshots` are
  scoped to the owner the same way. Write-only from the UI today ("Snapshot"
  in the detail view); there is no restore yet.
- **`POST /dossiers/:id/items/:itemId/move`** — a move to another dossier is
  the row itself changing `dossier_id` and `position` (target max + 1), not an
  `addItem` on the target plus a `deleteItem` on the source. Ownership is
  checked on **both** dossiers — the target comes from the body, so the URL's
  dossier proves nothing about it — and the item is scoped to the source. The
  client's `moveToDossier` reverts a refused item into the source at its old
  index; leaving it in the target would make every later star or delete there
  404, since the server still has the row in the source.
- **Saved-norm change tracking** (`routes/notifications.ts`, all behind
  `authenticate`): `POST /notifications/normas/check` — the reader registers
  `{normaKey, normaData: {norma_data, article_text}}` (Zod, 2 MB cap on the
  text) — plus `GET /notifications/normas`, `GET …/unread-count`,
  `POST …/mark-read`. One `NormaWatch` row per `(userId, normaKey)` holds
  the last snapshot; a `NormaChangeNotification` is written when the
  **text** differs. `compareNormaSnapshots` in `utils/normaWatcher.ts` is
  the one definition of "changed" for both writers of those rows (this
  endpoint and the background watcher): compare anything but `article_text`
  and the two ping-pong false notifications forever, because each stores
  `norma_data` in its own shape. A stored snapshot with no text
  (metadata-only, from before this contract) is a `baseline`: the snapshot
  is replaced and nothing is notified.
- **`utils/normaWatcher.ts`** — started from `index.ts`. Every
  `NORMA_WATCH_INTERVAL_MS` (6 h, floor 1 min) it refetches up to 100
  watches through the Python API — `LEGAL_API_URL` is the **base** URL,
  `/fetch_article_text` is appended — and notifies on a text change.
  `NORMA_WATCH_ENABLED=false` turns it off. A malformed answer (no
  `norma_data`, empty text) is a no-op, never a fallback to the stored data.
  A run that fails outright (database unreachable as it starts) is logged by
  the scheduler. **Nothing in the backend handles rejections globally**, so
  any fire-and-forget promise (`void f()`) that rejects crashes the whole
  server: catch it where it is fired.
- **Article discussions** (`routes/articleDiscussions.ts`): threads anchored
  on `{normaKey, articleId, version}` with comments, toggled votes and
  reports; `PATCH /admin/article-discussions/:threadId` (moderation) is
  `requireAdmin`. `sort=recent|active|popular` orders by `createdAt`,
  `updatedAt`, vote count. A thread may carry a `passage` (quotation, plain-text
  offset, 32-char prefix and suffix), `articleUrn` and `textHash` (SHA-256 of the plain
  projection when the thread was opened); the title is optional only for passage
  threads; `GET /article-discussions/passages` lists an article's passage threads
  without bodies. The stored passage is never rewritten; the reader's browser locates it.
- **LingoLex trace bank** (first slice of the study layer; plan in
  `docs/superpowers/plans/2026-09-30-lingolex-foundation.md`): `LingoTraccia`
  (`lingo_tracce`) holds exam traces and references no other model. Nothing
  writes to it through the API; rows arrive by
  `npx tsx src/utils/importLingoTracce.ts <file.json> [--apply]` (dry run
  unless `--apply`; it prints the counts by subject, kind of test and
  session). The file's contract is `schemas/lingo/traccia.ts`, strict
  on purpose: every row carries a `provenienza` block that is checked and
  **not stored**, and only `statoUtilizzo: "ufficiale_verificato"` rows
  enter; material with `fonte: "terzi"` can never carry that state, so a
  collection of someone else's work cannot pass by being labelled official.
  One bad row refuses the whole file. The repository is public and the
  collections of traces found around are mostly other people's work, so a
  file of unknown origin never lands by omission. A row's id derives from its
  `chiave` (`tracciaIdFromChiave`): importing again updates in place — the
  text and classification always, but the answer key, the difficulty and
  `attiva` only when the file names them, since they are curated after the
  import and the contract's defaults would otherwise wipe them. `runImportCli`
  returns the exit code (0 done or dry run, 1 file refused, 2 unreadable).
- **LingoLex trace routes** (`routes/lingoSimulazioni.ts`, mounted in `app.ts`
  at `/api/lingo/simulazioni` **before** the catch-all routers, like MERL-T's,
  so a request authenticates once): `GET /tracce` (filters `materia`,
  `tipoProva`, `sottoTipoAtto`; `limit` 1–100, default 50; `offset` 0–100000) and
  `GET /tracce/:id`. They serialise an explicit `select`, never the answer key
  (`normeRiferimento`, `questioniForma`, `questioniSostanza`: what the
  correction compares an essay against) and never an inactive trace (404, like
  a missing one). The list carries no text; the detail does. Keep it that way
  when adding fields: a new column stays hidden until someone shows it.
- **`src/srs/fsrsEngine.ts`** — the spaced-repetition engine: FSRS v4 as a pure
  function (`review(previous, rating, elapsedDays, options)`), no database and
  no dependency. Checked against `ts-fsrs@3.0.0`, which is FSRS v4 proper
  (`ts-fsrs@3.5.x` is FSRS 4.5, another curve and other weights): bit-identical
  over 100,000 random reviews. The stability update uses the *new* difficulty
  and difficulty is rounded to two decimals at each step, as the reference does.
  No learning steps in minutes. Every exported function refuses what is not a
  finite number in range with a `RangeError`, including a custom set of weights
  that overflows: a NaN must never reach a stored row.
- **LingoLex cards** (data layer only; no route writes them yet): `LingoCard` and
  `LingoCardAncora` (`lingo_cards`, `lingo_card_ancore`). `schemas/lingo/card.ts`
  is the strict contract: one to ten anchors, a lower-case SHA-256 fingerprint,
  at most one primary, and the caller cannot set state, score, author or id.
  `is_primary` defaults to false in the database: the service is the only thing
  that decides which anchor is the primary one.
  `lingo/cards.ts` `createLingoCard(authorId, input)` is one nested write that
  starts the card as `BOZZA_PERSONALE`; `lingo/cardStates.ts` holds the
  lifecycle (`canTransition`). The author is optional: when an account goes
  (`deleteUserAccount`, used by `DELETE /auth/account` and by the administrator's
  `DELETE /admin/users/:id`; never delete the user row by hand) the cards the
  community has taken up (proposed, validated, to review) stay without an author,
  and the person's drafts and archived cards are deleted with them, in one
  transaction (plan, decision 14). `GET /auth/export` includes the user's cards
  as `data.lingoCards`.
- **Account data**: `GET /auth/export` (the user's data, minus password and
  tokens) and `DELETE /auth/account` (password re-checked; every relation to
  `User` cascades, except the community's study cards, which stay without an
  author: see LingoLex cards). Reached from the Settings modal.
- **`GET /api/health/detailed`** — a `SELECT 1`, for the frontend's health
  banner. The Python `/health/detailed` is the one that probes the sources
  (see Key API Endpoints).

## Prisma migrations

Write a migration by hand in `prisma/migrations/<timestamp>_<name>/migration.sql`,
following Prisma's naming, then apply it with `npx prisma migrate deploy`, run
`npx prisma generate`, and check with `npx prisma migrate status`. Never
`prisma migrate dev`: on a drifted database it offers to reset it, and an agent
can accept (the shared hook refuses it). To get the exact SQL without a
database, `npx prisma migrate diff --from-schema-datamodel <copy of the old
schema> --to-schema-datamodel prisma/schema.prisma --script`. Do not run
`prisma format` on `schema.prisma`: it realigns about ninety untouched lines
(measured) and buries the diff that the other developer has to review.

## Tests

Only through `npm test`: its setup runs `prisma migrate reset` and refuses a
database whose name lacks "test". nock is replaced by a fetch shim (vitest
alias) because nock 14 corrupted supertest's sockets, and the suite shares one
persistent server bound to `127.0.0.1` (a wildcard bind on macOS could share its
port with another local process).

## Container image

`apps/server/Dockerfile` (context: this folder) has two targets. `runtime` carries only
what `node dist/index.js` needs, on Debian slim with openssl for Prisma's query engine,
as user `node`, with an exec-form `CMD` so SIGTERM reaches the graceful shutdown.
`migrate` is a one-shot (`prisma migrate deploy`) and exists because `prisma` and `tsx`
are development dependencies. `.dockerignore` excludes every `.env*`: a secret never
enters an image. The admin seed runs compiled: `node dist/utils/seed.js`.

Under `infra/compose.app.yml` the server's `DATABASE_URL` and the secrets it shares with
MERL-T (`MERLT_INTERNAL_SECRET`, `MERLT_API_KEY`) come from `infra/.env`, not from
`apps/server/.env`, whose `DATABASE_URL` points at localhost for the development flow;
`apps/server/.env` keeps the server's own (the JWT secret, the admin seed). The MERL-T
dead-letter log (`MERLT_DEAD_LETTER_DIR`, default `./logs`) is a volume and the root
filesystem is read-only.

## Environment Variables

**Node backend** — see `apps/server/.env.example`. `REDIS_ENABLED` defaults to
`"true"` there to mirror production; set `"false"` for dev without Redis.
`NORMA_WATCH_ENABLED` / `NORMA_WATCH_INTERVAL_MS` / `LEGAL_API_URL` drive the
saved-norm watcher (see the Node backend section); all three have defaults.
`SCRAPE_QUOTA_POINTS` / `SCRAPE_QUOTA_WINDOW_SECONDS` / `SCRAPE_IP_POINTS` (defaults
300, 60, 1200) size the quota behind `GET /api/auth/verify`.
`OAUTH_*` configure the authorization server (see `.env.example`);
`tests/setup.ts` lifts its per-address limits for the suite and sets a test
`OAUTH_MCP_CLIENT_SECRET`.

## Critical Files

Breaking one of these breaks the product. Read before editing.

**Backend** — `prisma/schema.prisma` · `src/lib/prisma.ts` · `controllers/` (`environmentController`,
`quickNormController`, `customAliasController`, `dossierController`) ·
`routes/` (all authenticate-gated, mounted on `/api`).
