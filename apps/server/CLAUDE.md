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
  `updatedAt`, vote count.
- **Account data**: `GET /auth/export` (the user's data, minus password and
  tokens) and `DELETE /auth/account` (password re-checked; every relation to
  `User` cascades). Reached from the Settings modal.
- **`GET /api/health/detailed`** — a `SELECT 1`, for the frontend's health
  banner. The Python `/health/detailed` is the one that probes the sources
  (see Key API Endpoints).

## Prisma migrations

Write a migration by hand in `prisma/migrations/<timestamp>_<name>/migration.sql`,
following Prisma's naming, then apply it with `npx prisma migrate deploy`, run
`npx prisma generate`, and check with `npx prisma migrate status`. Never
`prisma migrate dev`: on a drifted database it offers to reset it, and an agent
can accept (the shared hook refuses it).

## Tests

Only through `npm test`: its setup runs `prisma migrate reset` and refuses a
database whose name lacks "test". nock is replaced by a fetch shim (vitest
alias) because nock 14 corrupted supertest's sockets, and the suite shares one
persistent server bound to `127.0.0.1` (a wildcard bind on macOS could share its
port with another local process).

## Environment Variables

**Node backend** — see `apps/server/.env.example`. `REDIS_ENABLED` defaults to
`"true"` there to mirror production; set `"false"` for dev without Redis.
`NORMA_WATCH_ENABLED` / `NORMA_WATCH_INTERVAL_MS` / `LEGAL_API_URL` drive the
saved-norm watcher (see the Node backend section); all three have defaults.

## Critical Files

Breaking one of these breaks the product. Read before editing.

**Backend** — `prisma/schema.prisma` · `src/lib/prisma.ts` · `controllers/` (`environmentController`,
`quickNormController`, `customAliasController`, `dossierController`) ·
`routes/` (all authenticate-gated, mounted on `/api`).
