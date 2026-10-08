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
- **Exchanged tokens: how the MCP server acts for a user** (spec section 5).
  `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` on
  `/oauth/token` (`oauth/exchange.ts`), for `mcp-omnilex` only: the client's
  access token becomes a two-minute HS256 JWT (audience the API, `act` =
  `mcp-omnilex`, the grant, a scope within the subject's) signed with
  `OAUTH_DELEGATION_SECRET`, which must differ from `JWT_SECRET`.
  `middleware/delegated.ts` (`delegatedAuth`, on `/api` **before** the general
  limiter, so the MCP server's calls count per user) recognises it by its
  `act` claim, verifies it strictly, and holds it to `oauth/delegatedRoutes.ts`
  — default deny: any route outside the table is 403, a missing scope 403
  `insufficient_scope` — to a live grant and an active user, and to the daily
  quota (points by route, `OAUTH_DAILY_POINTS`; and named daily counters,
  `DELEGATED_COUNTERS`: 10 dossiers created, 100 notes, 20 deletions, 100
  cards). A delegated POST must be JSON (415): the weight is read from the body
  before the app's parsers run. A refused call (4xx/5xx) gives back its points
  and the counter it spent. Then it sets `req.user` and `req.delegation`, and `authenticate` lets
  the request through; nothing else sets `req.delegation`. **Adding a route to
  the table is a security decision**: every entry is reachable by any MCP
  client the user connected. None updates or moves, and none deletes for
  good: the three trash routes (below) move rows to a trash only the user's
  session restores or empties.
  `GET /api/oauth/quota` reports what is left (`{ points, counters }`).
- **Provenance and notes** (MCP second round; spec
  `docs/superpowers/specs/2026-10-04-mcp-second-round-design.md` §5). Dossiers
  and items carry `created_by_client_id`/`_name`: the connected application
  that created the row, set by `provenanceFromRequest` from `req.delegation`
  and never from a body; answered as `created_by: { clientName } | null`.
  Every dossier and item answer goes through `serializeDossier`/`serializeItem`
  in `dossierController.ts`: add a field there, not in a route.
  `POST /api/dossiers/:id/notes` `{ text, aboutItemId? }` (user session and
  exchanged tokens with `dossier:write`): plain text, 1–4,000 characters; with
  `aboutItemId` the note is about a norm entry of the same dossier as a whole
  (`about_item_id`, no foreign key), never a passage of its text (root rule 23).
  A note moved to another dossier loses its `about_item_id`; a client treats one
  that points outside its dossier as a plain note. `PUT /api/dossiers/:id/items/:itemId`
  `{ aboutItemId: id | null }` reattaches or detaches a note (only a note; user
  session only, the route is not in the delegated table): the web app's undo
  restores an article with a new id and points its notes at it.
  `assertArticleOfDossier` is the one check behind both routes.
- **Decisions in a dossier**: an item may be `sentenza`: a court decision's
  identity and a label, never its text. Its content is checked by
  `schemas/decisionItem.ts` (unknown keys refused) when an item is added and
  when a decision's content is updated; it must stay aligned with the web's
  `parseSentenzaContent`, so change both together. The item's `title` follows
  `etichetta`, a copy of the decision's citation that every write recomputes on the
  server from the identity and the attributes (`withDecisionLabel`, source convention D9),
  whatever the client sent; reading writes nothing. A Forum proposal of a dossier is someone else's data, and its entries end up
  cited to the owner (the web, the MCP reads and deletion dialog): every entry is rebuilt
  from closed values when the proposal is stored and again when it is taken
  (`utils/suggestionEntries.ts`) — a norm through `schemas/normEntry.ts` (an act type the
  convention's tables know; an article's suffix one of the printed ordinals, an annex a number,
  a Roman numeral or a letter, fixed forms for number, date and version; the
  sources' addresses kept only when they are Normattiva's or EUR-Lex's; unknown keys dropped),
  a decision through the item schema with its label recomputed. One refused entry refuses the
  proposal whole, with an Italian 400 naming the entry, the field and why; nothing applied.
- **Deleting through a connected application, and the trash** (second-round
  spec §4.2–4.3). Scope `content:delete`: the consent page offers it apart and
  unticked, `PATCH /api/oauth/grants/:id {canDelete}` switches it, and
  introspection, the exchange and `delegatedAuth` read it **live from the
  grant** (`effectiveScopes`), so switching it off stops a token exchanged
  before; a deletion route also needs the read scope of what it deletes
  (`readScope` in the delegated table). `trash/trash.ts` copies the rows into
  `trash_entries` and deletes them in one transaction, the dossier row locked
  (`FOR UPDATE`): `POST /dossiers/:id/trash {itemIds}` (the entries the user
  saw: a dossier that changed answers 409), `/dossiers/:id/trash-items`,
  `/lingo/cards/trash` — the two dossier routes for exchanged tokens only,
  whose own deletions in the web app stay immediate; the card trash is open to
  the web app too: a deletion by the user's session is stored with no client,
  no name and no grant (`DeletedBy` all null) and listed with
  `byApplication: false`, while one through a connected application is
  `byApplication: true` even when its name is unknown. `GET /api/trash`,
  `POST /api/trash/:id/restore {targetDossierId?}`, `DELETE /api/trash/:id` are the user's session's.
  Restore brings every column back with the original ids; entries 30 days,
  then swept (awaited, at most every ten minutes). No route reachable by an
  exchanged token deletes for good.
- **`POST /api/dossiers/:id/norms`** — 1 to 50 references in free text
  (`norms/resolveReference.ts`): `parse_query`, then `fetch_norma_data` (the
  norm as the reader stores it), then existence once per act: the
  fingerprints for a single-part Normattiva act, the tree's (annex, article)
  pairs for an act with annexes, the article's own text for an EU act. Never
  the text alone for Normattiva: it answers a missing article with the act's
  art. 1 and a 200. A source that fails or answers 429 makes the reference
  `unavailable`, never "missing". Outcomes: `added`, `already_present`,
  `not_recognised`, `does_not_exist`, `ambiguous`, `unavailable`; the added
  ones in one transaction, after the dossier's last item. Each resolved
  reference's `display` is its citation (below), never Python's own label
  («Art. 3 — legge» named no act).
- **`norms/citation.ts`** and **`norms/decisionCitation.ts`** — how the server names a
  source, in the source convention (spec
  `docs/superpowers/specs/2026-10-04-source-convention-design.md`, decided by the owner):
  `citeArticle` («art. 3, l. 31 dicembre 2012, n. 247», «art. 1284 c.c.», «art. 5, reg. (UE)
  2016/679», «art. 6, l. n. 184 del 1983»), `shortNorm` («art. 3 l. 247/2012»), `citeAct` (the
  act alone, without the article or the annex, carried as `act_citation` for a reader that
  names each act once above its articles; `citeArticle` is built on the same code, so the two
  cannot drift), `citeDecision` («Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310») and
  `shortDecision`. Dossier items carry `citeStoredItem` as `citation` — a norm's or a
  decision's, null for anything else — in every dossier answer and in the trash's list, and the
  MCP tools pass it on. The tables (`norms/actTypes.ts`) are a copy of the web app's
  `utils/sources/actTypes.ts`; the web app, the API and MERL-T write the same words with their
  own code. `tests/norms/sourcesGolden.test.ts` pins this copy to
  `conventions/sources/golden.json` and the codes table to the API's `map.py`: change the
  wording in the golden file and every copy together. A stored decision is cited only from the
  values the item schema admits, because the citation reaches the MCP confirmation dialog.
  The saved-norm notifications name the norm by its citation (`changeMessage`), the stored key
  only when the snapshot names no article.
- `src/middleware/errorHandler.ts` — the only place a status is decided for an
  unhandled throw. `AppError` carries its own; a Zod `ZodError` becomes **400**
  naming the offending fields; everything else is a 500. Controllers therefore
  call `schema.parse()` and let it throw — 41 sites across 13 controllers — and
  must not catch it to hand-roll a status. The body is
  `{ detail: string, errors?: [{ field, message }] }`: `detail` stays a plain
  string because `services/api.ts` renders it straight to the user.
- **Published environments** carry dossiers; their entries are rebuilt from closed values when
  an environment is published, its content updated or an older version restored
  (`utils/environmentDossiers.ts`): norms through `schemas/normEntry.ts`, decisions through
  `rebuildDecisionEntry` in `schemas/decisionItem.ts` (unknown keys refused, the label
  recomputed, a missing one supplied), notes only as text of at most `MAX_NOTE_LENGTH`; around
  its data an item keeps only its id and date when they are strings, its type and the star
  (`status: 'important'`, also when it travelled inside the data as `_dossierMeta`). An entry that cannot be rebuilt, or of an
  unknown type, refuses the operation with an Italian 400 naming the dossier, the entry and why:
  whoever applies the environment has those entries cited to them, in the MCP deletion dialog
  too. The web rebuilds them again on import.
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
  A thread may be anchored on a **court decision** (spec 2026-10-05 §8.7), in
  columns of its own (`target_kind` `'article'|'decision'`, `decision_key`,
  CHECKs in the migration `20261011100000_article_threads_decision_target`).
  The server derives the target from `normaKey` (`norms/decisionKey.ts`
  `readDecisionKey`, the twin of the web's `identityFromKey`, both pinned to
  `conventions/sources/decision-keys.json`): a key in the
  `cassazione:` / `corte_costituzionale:` space must read back (else 400) and
  comes with `articleId` `''` and no `version` or `articleUrn`; an optional body
  `target: { kind, key }` is accepted only if it agrees (an article target takes no key). The answer carries
  `target` and `passageReleased`. The list queries may omit `articleId` for a
  decision; a decision thread never shows in an article's list nor the reverse.
  `textHash` and passage offsets are on the decision's projection (the client
  computes them). A withdrawn quotation is hidden by the panel from everyone
  but its author and admins; `PATCH /admin/article-discussions/:id` takes
  `{ hidden?, passageReleased? }` and sets or clears `passage_released_at` /
  `passage_released_by` (the admin's id) on a decision thread with a passage.
  The API still returns the stored quotation. Deleting the releasing admin
  sets `passage_released_by` null and keeps the release (the CHECK allows it).
  Every discussion route answers its 400s and 404s in Italian (`parseItalian`,
  not the global handler's English prefix); moderation on a missing thread is a
  404 «Discussione non trovata».
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
- **LingoLex card routes** (`routes/lingoCards.ts`, `/api/lingo/cards`; second-round
  spec §6): `POST` (1–10 cards, at most 20 distinct anchor references a call,
  anchors given in words and resolved by `lingo/anchors.ts` — the official
  `urn:nir:…` as identity, `normaKey`/`articleId` derived in one place, the AKN
  fingerprint from the part matched to the annex by article numbers, refused
  when ambiguous; a card with an unverifiable anchor is refused, the others
  created; always the author's draft, with the connected application that wrote
  it in `created_by_client_id`/`_name`, answered as `origine: { clientName } | null`,
  the client's id never), `GET /` and `GET /:id` (own cards only; the list
  filters by `materia`, `stato`, `tipo`, `normaKey` — any anchor on the act —
  `q` — 1–100 characters, in the institute or the question, case-insensitive —
  and `origine=applicazione`, ordered `ordine=recenti` (default) or `materia`,
  then institute, newest, id),
  `POST /trash` (personal states only, `PERSONAL_STATES`; the session and
  exchanged tokens alike), and `PATCH /:id` for the session only (not in the
  delegated table: a default-deny 403 for an exchanged token). The patch takes
  one card in the shape of an element of `POST`'s `cards` and replaces its
  fields and anchors whole: `lingo/planCards.ts` (shared with `POST`) checks
  the references first — every one unreachable is a 503, an unverifiable one a
  400 `{ detail, anchors }`, and the draft stays as it was — then one
  transaction locks the row (`FOR UPDATE`) and re-reads author and state (404;
  409 unless `BOZZA_PERSONALE`). It never touches `created_by_client_*`.
  `q` refuses a NUL byte (400). Scopes
  `lingo:cards:read` / `lingo:cards:write`; two points per reference, one of
  the day's hundred per card. `lingo/serializeCard.ts` is the one answer shape.
- **`GET /api/lingo/articolo?urn=`** (`routes/lingoArticolo.ts`, session only):
  the user's non-archived cards anchored on the article, each with `comunita`
  and `approvazioni` (in PR A always `false` and `null`; the community's come
  later). The address is the reader's (`…urn:nir:…~art1453!vig=…`); the
  identity is `anchorUrn`, the same cut that stores an anchor's `urn`, so
  storage and lookup agree. An address with no `urn:` is a 400.
- **LingoLex cards** (data layer): `LingoCard` and
  `LingoCardAncora` (`lingo_cards`, `lingo_card_ancore`). `schemas/lingo/card.ts`
  is the strict contract: one to ten anchors, a lower-case SHA-256 fingerprint,
  at most one primary, and the caller cannot set state, score, author or id.
  `is_primary` defaults to false in the database: the service is the only thing
  that decides which anchor is the primary one.
  `lingo/cards.ts` `createLingoCard(authorId, input, client?, origin?)` is one nested write that
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
  author: see LingoLex cards). Reached from the Settings modal. The export's
  discussion threads keep a release's time but not the releasing admin's id.
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
