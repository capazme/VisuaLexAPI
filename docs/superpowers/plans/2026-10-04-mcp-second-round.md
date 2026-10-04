# The MCP server, second round — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Through a connected application, a user can add notes to a dossier (or to an article in it), delete dossiers, entries and their own study cards after confirming in a dialog the model cannot answer, restore what was deleted from a 30-day trash in the web app, and make and read LingoLex study cards.

**Architecture:** `apps/server` gains provenance columns on dossiers and entries, a `trash_entries` table with move/restore/purge, a `content:delete` permission read live from the grant, a notes route, the card routes and the anchor derivation. `apps/mcp` becomes stateful (sessions in memory, bound to user and grant) so it can send a form elicitation inside a tool call, and gains the notes, deletion and card tools. `apps/web` gains the deletion checkbox on the consent page and the switch in Impostazioni → Applicazioni collegate; the trash screens belong to the dossier UI round.

**Tech Stack:** Express 4 + Prisma + Zod + Vitest/supertest (server); `@modelcontextprotocol/sdk` 1.31.0 (pinned) + Express 5 + Vitest (apps/mcp); React 19 + Testing Library (web).

**Spec:** `docs/superpowers/specs/2026-10-04-mcp-second-round-design.md` (decisions S1–S12, P2, P7–P9; §10 has the owner's answers). Phase 1: `docs/superpowers/specs/2026-10-02-mcp-spike-design.md` and `docs/superpowers/plans/2026-10-02-mcp-spike.md` — read their sections 4–6 for the token exchange and the delegated table.

## Global Constraints

- **Git flow:** one branch per pull request from `develop`, merged with a merge commit `merge: <branch> — <what changes>` once CI is green. The owner gave this session the go-ahead for commits, pushes of its own branches and merges into `develop`, and a written ok for code touching login and the Prisma schema; each PR description says when it touches authentication or the schema (D-046). `main`, tags and releases are the owner's.
- **Migrations by hand**, never `prisma migrate dev`, never `prisma format`: save the schema before the change, write the SQL with `npx prisma migrate diff --from-schema-datamodel <saved> --to-schema-datamodel prisma/schema.prisma --script`, apply with `migrate deploy` only.
- **Server tests share one database:** ask the orchestrator (`visualexapi-7e`) for a window before every `npm --prefix apps/server test`. `npm --prefix apps/server run build` is the type-check. `apps/mcp` tests need no database.
- **The shared dev stack is not restarted.** Live checks run this branch's server and `apps/mcp` on other ports (as the spike did: server :3011, mcp :3012 with `MCP_PORT`), with a test user created for the round and deleted at the end through `deleteUserAccount`.
- **Nothing private in the repo; never read `.env` files;** secrets come from the environment.
- **Copy:** UI text and tool messages in Italian; code, comments, commits, docs in English.
- **Errors surfaced in touched files are fixed,** pre-existing ones too.
- **Numbers (placeholders to calibrate, spec §4.4, §5, §6):** note 1–4,000 characters, 2 points, counter `note` 100/day; trash calls 1 point, counter `trash` 20/day; entries per deletion 1–50; cards per deletion 1–10; cards per save 1–10, counter `card` 100/day; elicitation wait 5 minutes; session idle 30 minutes, 10 sessions per grant; trash kept 30 days.
- **Citations** come from `apps/server/src/norms/citation.ts` (`citeArticle`, and `citeAct` once #66 is in `develop`): never a second formatter.

## Review Focus

The failure modes the spec implies and no obvious test would name, most likely first. Each has its test in the task named.

1. **A refreshed token on an open session.** Claude Code refreshes its access token every 8 hours; the next request carries a new token on the old session id. It must continue the session (same grant), not 404 it or open a second one. Task 4.
2. **The dialog shows one thing, the call deletes another.** The entries shown must be exactly the ids sent, even if the dossier changed between the read and the deletion (an id gone → reported, never swapped). Task 8.
3. **Re-consent silently changes the delete permission.** A user who re-connects and leaves the box unticked must lose deletion; one who only reconnects must not gain it. Task 5.
4. **Restore into a dossier that moved on.** Items restored after the user added others must land after the last entry, keep their ids, and not collide on position; restoring twice is a 404. Task 6.
5. **A note attached to an article of another dossier, or to a note.** Refused, and a trashed article leaves its notes visible as plain notes. Task 2 and Task 6.

---

## PR 1 — `feat/mcp-notes`: notes and the mark

### Task 1: Provenance and note-attachment columns

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (models `Dossier`, `DossierItem`)
- Create: `apps/server/prisma/migrations/20261005090000_add_dossier_provenance/migration.sql`
- Modify: `apps/server/src/types/express.d.ts` (or wherever `req.delegation` is declared — `grep -rn "delegation?" apps/server/src/types`)
- Modify: `apps/server/src/middleware/delegated.ts` (load the client's name with the grant)
- Modify: `apps/server/src/controllers/dossierController.ts` (`createDossier`, `addDossierNorms`, the item and dossier serialisers)
- Test: `apps/server/tests/dossierProvenance.test.ts`

**Interfaces:**
- Produces: `req.delegation.clientName: string | null`; on every dossier and item the API returns, `created_by: { clientName: string | null } | null` and, on items, `about_item_id: string | null`; a helper `provenanceFromRequest(req): { createdByClientId: string | null; createdByClientName: string | null }` exported from `dossierController.ts`.

- [ ] **Step 1: Save the schema** — `cp apps/server/prisma/schema.prisma .superpowers/sdd/2026-10-04-mcp-second-round/schema.before-task1.prisma`.

- [ ] **Step 2: Write the failing tests** in `apps/server/tests/dossierProvenance.test.ts`, following `tests/oauth/` for how an exchanged token is minted in tests (reuse its helper that signs a delegated JWT):
  - `a dossier created through an exchanged token records the connection` → `POST /api/dossiers` with a delegated token for a grant whose client is named "Claude Code (prova)"; then `GET /api/dossiers/:id` with the user session → `created_by` equals `{ clientName: 'Claude Code (prova)' }`.
  - `norms added through an exchanged token carry the mark, norms added by the user do not` → `POST /api/dossiers/:id/norms` delegated (Python stubbed with nock as in `tests/dossierNorms*.test.ts`), `POST /api/dossiers/:id/items` with the session; the first item has `created_by.clientName`, the second `created_by: null`.
  - `a body cannot set the mark` → session `POST /api/dossiers/:id/items` with `createdByClientName: 'Claude'` in the body → 400 (the schema is `.strict()` after this task) or the field is absent from the stored row; assert `created_by: null`.
  - `about_item_id is returned, null by default`.

- [ ] **Step 3: Run them to see them fail** — ask the orchestrator for a window, then `npm --prefix apps/server test -- tests/dossierProvenance.test.ts`. Expected: failures on missing `created_by`.

- [ ] **Step 4: Schema.** In `model Dossier` and `model DossierItem` add:

```prisma
  // Which connected application created this row (MCP); null = the user.
  // Set by the server from the delegation, never from a body.
  createdByClientId   String? @map("created_by_client_id")
  createdByClientName String? @map("created_by_client_name")
```

and in `model DossierItem` only:

```prisma
  // A note about another entry of the same dossier (an article), as a whole:
  // never a passage of its text (root rule 23). No foreign key: the entry may
  // be in the trash, and the note must survive it and reattach on restore.
  aboutItemId String? @map("about_item_id")
```

- [ ] **Step 5: Migration.** `npx prisma migrate diff --from-schema-datamodel ../../.superpowers/sdd/2026-10-04-mcp-second-round/schema.before-task1.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261005090000_add_dossier_provenance/migration.sql` (from `apps/server`). Expected SQL: three `ALTER TABLE ... ADD COLUMN` on `dossier_items`, two on `dossiers`; nothing else (if anything else appears, the saved copy is wrong: stop). `npx prisma generate`.

- [ ] **Step 6: The delegation carries the client's name.** In `delegatedAuth`, read the grant with `include: { user: true, client: { select: { clientName: true } } }` and set `req.delegation = { grantId, clientId, scopes, clientName: grant.client.clientName ?? null }`; extend the type declaration.

- [ ] **Step 7: Controller.** Add and use:

```ts
/** Who created a row: the connected application when the request is delegated, else nobody (the user). */
export function provenanceFromRequest(req: Request) {
  return req.delegation
    ? { createdByClientId: req.delegation.clientId, createdByClientName: req.delegation.clientName }
    : { createdByClientId: null, createdByClientName: null };
}

const createdBy = (row: { createdByClientId: string | null; createdByClientName: string | null }) =>
  row.createdByClientId ? { clientName: row.createdByClientName } : null;
```

  Spread `provenanceFromRequest(req)` into the `data` of `createDossier`, `addDossierItem` and each item of `addDossierNorms`. Add `created_by: createdBy(row)` to every dossier and item object the controller returns, and `about_item_id: item.aboutItemId` to every item — in `GET /dossiers` and `GET /dossiers/:id` above all, which the dossier UI round reads to place a note with its article. Make `createDossierItemSchema` `.strict()` if it is not, so an unknown field is a 400.

- [ ] **Step 8: Run** the new test file and the dossier test files (`tests/dossier*.test.ts`) in one window → PASS. `npm --prefix apps/server run build` → clean.

- [ ] **Step 9: Commit** — `git add apps/server && git commit -m "feat(server): record which connected application created a dossier or entry"` (with the attribution line).

### Task 2: The notes route

**Files:**
- Modify: `apps/server/src/controllers/dossierController.ts` (new `addDossierNote`), `apps/server/src/routes/dossiers.ts`
- Modify: `apps/server/src/oauth/delegatedRoutes.ts` (route + counter), `apps/server/src/middleware/delegated.ts` (named counters become a table)
- Test: `apps/server/tests/dossierNotes.test.ts`, extend `apps/server/tests/oauth/delegated*.test.ts` for the counter

**Interfaces:**
- Consumes: `provenanceFromRequest` (Task 1).
- Produces: `POST /api/dossiers/:id/notes` `{ text: string (1–4000), aboutItemId?: string }` → 201 with the item (`item_type: 'note'`, `title: 'Nota'`, `content: text`, `about_item_id`, `created_by`); `MAX_NOTE_LENGTH = 4000` exported; `DelegatedRoute.counter?: DelegatedCounter` with `type DelegatedCounter = 'dossier_create' | 'note' | 'trash' | 'card'`; `DELEGATED_COUNTERS: Record<DelegatedCounter, number>` = `{ dossier_create: 10, note: 100, trash: 20, card: 100 }`; `delegatedQuotaStatus(userId)` returns `{ points, counters: Record<DelegatedCounter, QuotaLine> }` (keep `dossierCreations` too until `apps/mcp` reads `counters`, then drop it in Task 3).

- [ ] **Step 1: Failing tests** (`dossierNotes.test.ts`):
  - `adds a note with the user session, unmarked`; `adds a note through an exchanged token, marked`. The route stays open to the web session: the dossier UI round creates attached notes through it, not through `POST /dossiers/:id/items`.
  - `trims; refuses empty, over 4000 characters, and control characters other than new lines` (`'a\u0007b'` → 400; `'riga 1\nriga 2'` → 201).
  - `attaches a note to a norm entry of the same dossier`; `refuses aboutItemId of another dossier, of a note, or unknown` → 400 «La voce indicata non è un articolo di questo dossier.».
  - `another user's dossier is a 404`.
  - `the 101st note of the day through an exchanged token is a 429 with quota: 'note'`, after `spendDelegatedCounter(userId, 'note', 100)`; a user-session note is never counted.
  - `GET /api/oauth/quota lists the counters` (`counters.note.limit === 100`).
- [ ] **Step 2: Run, see them fail** (window from the orchestrator).
- [ ] **Step 3: Implement.** The route validates with:

```ts
export const MAX_NOTE_LENGTH = 4000;
// Plain text: new lines and tabs, nothing else below U+0020.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const noteSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_NOTE_LENGTH).refine((t) => !CONTROL.test(t), 'Caratteri di controllo non ammessi.'),
    aboutItemId: z.string().uuid().optional(),
  })
  .strict();
```

  Ownership as `addDossierItem`; when `aboutItemId` is given, `prisma.dossierItem.findFirst({ where: { id: aboutItemId, dossierId: id, itemType: 'norm' } })` must exist (later Sentenze PR C adds `sentenza` to the allowed types). Position = max + 1. In `delegated.ts`, replace the single creations limiter with one limiter per counter (`createLimiter(\`rl:mcp-${name}\`, DELEGATED_COUNTERS[name], DAY_SECONDS)`), keep the refund logic per counter, export `spendDelegatedCounter(userId, counter, amount)` for tests, and word `overQuota` per counter («Limite giornaliero di note…», «…di eliminazioni…», «…di schede…»). Table entry: `{ method: 'POST', path: '/dossiers/:id/notes', scope: 'dossier:write', weight: 2, counter: 'note' }`.
- [ ] **Step 4: Run** the new file plus `tests/oauth/` → PASS; build clean.
- [ ] **Step 5: Commit** — `feat(server): add notes to a dossier or to an article in it, with a daily counter for applications`.

### Task 3: The notes tool

**Files:**
- Modify: `apps/mcp/src/tools/dossier.ts`, `apps/mcp/src/exchange.ts` (429 wording per counter)
- Modify: `apps/mcp/tests/stubs.ts` (stub `POST /api/dossiers/:id/notes`), `apps/mcp/tests/tools.test.ts`

**Interfaces:**
- Consumes: `POST /api/dossiers/:id/notes` (Task 2); `created_by`, `about_item_id` on items (Task 1).
- Produces: tool `omnilex_aggiungi_nota_dossier` `{ dossier: string, testo: string (1–4000), voce?: string }`, `TOOL_SCOPES` entry `['dossier:read', 'dossier:write']`; `omnilex_leggi_dossier` items gain `aggiunta_da: string | null` and `nota_su: string | null`.

- [ ] **Step 1: Failing tests** in `tools.test.ts`:
  - the tool list now has six tools; the existing "nothing that updates, moves or deletes" test keeps its name list in step;
  - `adds a note to the dossier named, through dossier:write, and answers with its id` (stub records the body `{ text, aboutItemId }`);
  - `passes voce as aboutItemId`; `refuses a note over 4000 characters before calling anything`;
  - `a 429 with quota note says the daily notes limit and when it renews`;
  - `omnilex_leggi_dossier reports who added each entry and what a note is about`.
- [ ] **Step 2: Run** `npm --prefix apps/mcp test` → the new tests fail.
- [ ] **Step 3: Implement** the tool (title «Aggiungi una nota a un dossier»; description says it only adds, that the note is marked as written by the application, and that `voce` is the id of an article from `omnilex_leggi_dossier`; annotations `readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false`). In `exchange.ts`, the 429 text by `body.quota`: `dossier_create` → dossier creati; `note` → note; `trash` → eliminazioni; `card` → schede; else operazioni. Read `counters` from `/oauth/quota` and drop `dossierCreations` on the server in the same PR.
- [ ] **Step 4: Run** → PASS; `npm --prefix apps/mcp run build` clean.
- [ ] **Step 5: Commit**, open **PR 1** (`feat/mcp-notes`): says it touches the Prisma schema (D-046). A fresh code review of the PR's diff; fix findings; merge at green CI.

---

## PR 2 — `feat/mcp-sessions`: the stateful MCP server

### Task 4: Sessions bound to user and grant

**Files:**
- Create: `apps/mcp/src/sessions.ts`
- Modify: `apps/mcp/src/server.ts`, `apps/mcp/src/tools/dossier.ts` (the caller comes from the request, not the session), `apps/mcp/src/index.ts` (the idle sweep timer, cleared on shutdown)
- Test: `apps/mcp/tests/sessions.test.ts`; adapt `server.test.ts` and `tools.test.ts` (clients now keep a session)

**Interfaces:**
- Produces:

```ts
// src/sessions.ts
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const MAX_SESSIONS_PER_GRANT = 10;
export interface Session { id: string; userId: string; grantId: string; transport: StreamableHTTPServerTransport; server: McpServer; lastSeen: number }
export class SessionStore {
  /** The session for this id if it belongs to this caller's user and grant; otherwise undefined (answer 404). */
  find(id: string, caller: Caller): Session | undefined;
  add(session: Session): void;            // closes the oldest when the grant already has MAX_SESSIONS_PER_GRANT
  close(id: string): Promise<void>;
  sweep(now?: number): Promise<number>;   // closes sessions idle longer than SESSION_IDLE_MS, returns how many
  size(): number;
}
```

  Tools read the caller per request: `server.ts` sets `req.auth = { token: caller.token, clientId: caller.clientId, scopes: caller.scopes, extra: { caller } }` before `transport.handleRequest`; handlers get it as `extra.authInfo.extra.caller` through a helper `callerOf(extra): Caller` in `src/auth.ts` (throws if absent). `registerDossierTools(server, config, run)` loses its `caller` parameter; `RunTool = (tool: string, caller: Caller, body: () => Promise<CallToolResult>) => Promise<CallToolResult>`.

- [ ] **Step 1: Failing tests** (`sessions.test.ts`, SDK `Client` + `StreamableHTTPClientTransport` against the stubs):
  - `initialize returns an Mcp-Session-Id and later calls on it reach the tools`;
  - `a refreshed token of the same grant continues the session` (stub introspection: token B active with the same `sub` and `grant` as token A; second request with token B on A's session → 200);
  - `another user's token on the session is a 404`; `another grant's token is a 404`;
  - `an unknown session id is a 404; a POST without session that is not initialize is a 400`;
  - `an inactive token on a live session is a 401 and the session survives` (next request with an active token works);
  - `DELETE ends the session; GET opens the stream (200, text/event-stream)`;
  - `the eleventh session of a grant closes the first`; `sweep closes idle sessions` (inject `now`);
  - `each tool call is logged with the request's caller` (spy on `console.info`).
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.** In `server.ts`:
  - after `authenticate` and the scope check, read `mcp-session-id`;
  - if present: `store.find(id, caller)` or 404 `{ jsonrpc:'2.0', error:{ code:-32001, message:'Session not found' }, id:null }`; touch `lastSeen`; set `req.auth`; `transport.handleRequest(req, res, req.body)`;
  - if absent and the body is `initialize`: a new `McpServer` with the tools, a `StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => store.add({ id, userId, grantId, transport, server, lastSeen: Date.now() }) })` (no `enableJsonResponse`: SSE responses), `transport.onclose = () => store.close(id)`;
  - otherwise 400;
  - `GET` and `DELETE` on the endpoint: authenticate, find the session (404 if not theirs), hand them to the transport (`app.get`/`app.delete` replace the 405 handler; `GET` without session → 400).
  - Keep the Host/Origin checks and the body-error handler as they are. `index.ts`: `setInterval(() => void store.sweep(), 60_000).unref()`.
- [ ] **Step 4: Run** `npm --prefix apps/mcp test` → all green (phase-1 tests adapted to sessions, none deleted); build clean.
- [ ] **Step 5: Live check.** This branch's `apps/mcp` on :3012 against the shared dev server (its `/oauth/introspect` needs `MCP_CLIENT_SECRET` from the environment the orchestrator gives, never from `.env`), then `node apps/mcp/scripts/e2e.mjs` adapted to keep the session → all steps pass. Then with Claude Code: `claude -p --strict-mcp-config --mcp-config <scratch json pointing at :3012>` once; stop and restart `apps/mcp`; run it again in an interactive session that was open before the restart and record whether Claude Code re-initialises on the 404 (expected: it does; if not, write it in the ledger and the PR — the owner will meet it after each dev restart).
- [ ] **Step 6: Commit**, open **PR 2** (`feat/mcp-sessions`); fresh code review; merge at green CI.

---

## PR 3 — `feat/mcp-trash`: the permission and the trash

### Task 5: The `content:delete` permission

**Files:**
- Modify: `apps/server/src/oauth/config.ts` (`SCOPES`), `apps/server/src/oauth/consent.ts`, `apps/server/src/routes/oauthAccount.ts`, `apps/server/src/oauth/introspect.ts`, `apps/server/src/oauth/exchange.ts`, `apps/server/src/middleware/delegated.ts`
- Test: `apps/server/tests/oauth/deletePermission.test.ts`

**Interfaces:**
- Produces: `export const DELETE_SCOPE = 'content:delete'` in `config.ts`, part of `SCOPES`; `DELETE_SCOPE_LABEL = 'Eliminare dossier, voci e schede (finiscono nel cestino per 30 giorni; ogni eliminazione ti chiede conferma)'`; `readAuthorizationRequest` answers `scopes` without the delete scope plus `deletion: { label: string }`; decision body `{ approve: boolean, allowDelete?: boolean }`; `PATCH /api/oauth/grants/:id` `{ canDelete: boolean }` → `{ id, scopes }`; `GET /api/oauth/grants` items gain `canDelete: boolean`; `effectiveScopes(tokenScopes: string[], grantScopes: string[]): string[]` exported from `config.ts`:

```ts
/** The token's scopes with deletion read live from the grant (spec §4.2): switching it takes effect on the next call. */
export function effectiveScopes(tokenScopes: string[], grantScopes: string[]): string[] {
  const rest = tokenScopes.filter((s) => s !== DELETE_SCOPE && grantScopes.includes(s));
  return grantScopes.includes(DELETE_SCOPE) ? [...rest, DELETE_SCOPE] : rest;
}
```

- [ ] **Step 1: Failing tests:**
  - `the consent page lists read and write, and the deletion apart` (request asked `dossier:read dossier:write content:delete` → `scopes` has two, `deletion.label` present);
  - `approve without allowDelete grants no deletion, even if the client asked`; `approve with allowDelete grants it`;
  - `re-consent without allowDelete removes deletion from a live grant; re-consent with it adds it; read and write still merge as before` (Review Focus 3);
  - `introspection reports content:delete from the grant, live`: issue tokens, PATCH `canDelete: true`, introspect → scope includes it; PATCH false → it is gone, without a new token;
  - `the exchange grants content:delete only while the grant has it`; `delegatedAuth refuses a content:delete route when the grant lost it after the exchange` (403 `insufficient_scope`);
  - `PATCH another user's grant or a revoked one is a 404; a delegated token cannot reach PATCH` (403: not in the table).
- [ ] **Step 2: Run** (window) → fail.
- [ ] **Step 3: Implement.** Consent decision: `scopes = request.scopes.filter(s => s !== DELETE_SCOPE).concat(allowDelete ? [DELETE_SCOPE] : [])`; the live-grant update becomes `[...new Set([...live.scopes.filter(s => s !== DELETE_SCOPE), ...scopes])]` (deletion follows this decision); the code stores the same `scopes`. Introspection: `scope: effectiveScopes(active.token.scopes, active.grant.scopes).join(' ')`. Exchange: check the requested scopes against `effectiveScopes(subject.token.scopes, subject.grant.scopes)` (read the grant with the subject token if `findActiveAccessToken` does not already). `delegatedAuth`: after loading the grant, if `route.scope === DELETE_SCOPE && !grant.scopes.includes(DELETE_SCOPE)` → 403 `insufficient_scope`. `SCOPE_LABELS` gains the delete label.
- [ ] **Step 4: Run** → PASS; `tests/oauth/` all green; build.
- [ ] **Step 5: Commit** — `feat(server): a separate, live permission to delete through connected applications`.

### Task 6: The trash

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (enum `TrashKind`, model `TrashEntry`, relation on `User`)
- Create: `apps/server/prisma/migrations/20261005120000_add_trash_entries/migration.sql`, `apps/server/src/trash/trash.ts`, `apps/server/src/routes/trash.ts`
- Modify: `apps/server/src/routes/dossiers.ts`, `apps/server/src/controllers/dossierController.ts`, `apps/server/src/oauth/delegatedRoutes.ts`, `apps/server/src/app.ts` (mount `/api/trash`), `apps/server/tests/setup.ts` (truncation list)
- Test: `apps/server/tests/trash.test.ts`

**Interfaces:**
- Consumes: `DELETE_SCOPE` (Task 5); `citeArticle`, `citeAct` (#66) for summaries; `provenanceFromRequest` shape for `clientId/clientName`.
- Produces:

```prisma
enum TrashKind {
  DOSSIER
  DOSSIER_ITEMS
  LINGO_CARDS
}

// What a connected application deleted (spec §4.3): the rows as they were,
// restorable from the web app for 30 days. A separate table, so that no query
// on dossiers or cards needs a "deleted" filter.
model TrashEntry {
  id         String    @id @default(uuid())
  userId     String    @map("user_id")
  kind       TrashKind
  dossierId  String?   @map("dossier_id")
  label      String
  summary    Json
  payload    Json
  clientId   String?   @map("client_id")
  clientName String?   @map("client_name")
  grantId    String?   @map("grant_id")
  deletedAt  DateTime  @default(now()) @map("deleted_at")
  expiresAt  DateTime  @map("expires_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, deletedAt])
  @@index([expiresAt])
  @@map("trash_entries")
}
```

```ts
// src/trash/trash.ts
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export interface DeletedBy { clientId: string; clientName: string | null; grantId: string }
export interface TrashListEntry { id: string; kind: TrashKind; dossierId: string | null; label: string; itemCount: number;
  items?: { itemType: string; citation: string | null; actCitation: string | null }[];
  cards?: { istituto: string; domanda: string }[]; clientName: string | null; deletedAt: string; expiresAt: string }
export async function trashDossier(userId: string, dossierId: string, by: DeletedBy): Promise<{ trashId: string; itemCount: number }>;
export async function trashDossierItems(userId: string, dossierId: string, itemIds: string[], by: DeletedBy):
  Promise<{ trashId: string; moved: string[]; notFound: string[] }>;
export async function listTrash(userId: string): Promise<TrashListEntry[]>;
export async function restoreTrashEntry(userId: string, trashId: string, targetDossierId?: string): Promise<{ dossierId: string | null }>;
export async function purgeTrashEntry(userId: string, trashId: string): Promise<void>;
export async function sweepExpiredTrash(now?: Date): Promise<number>;   // awaited, at most every 10 minutes
```

  Routes: delegated `POST /api/dossiers/:id/trash` (weight 1, counter `trash`, scope `content:delete`) → `{ trashId, itemCount }`; delegated `POST /api/dossiers/:id/trash-items` `{ itemIds: string[] 1–50 }` (weight 1, counter `trash`) → `{ trashId, moved, notFound }` — `notFound` lists ids not in that dossier, which are never deleted; when `moved` is empty the answer is 404 and nothing is written. Session only: `GET /api/trash`, `POST /api/trash/:id/restore` `{ targetDossierId? }`, `DELETE /api/trash/:id`. Both trash routes refuse a user-session caller (403: they are for connected applications; the web app keeps its own immediate deletion, S10).

- [ ] **Step 1: Save the schema**, as in Task 1 (`schema.before-task6.prisma`).
- [ ] **Step 2: Failing tests** (`trash.test.ts`):
  - `trashing a dossier moves it, its items and snapshots into one entry, and the dossier is gone` (summary `itemCount`, label = name, `clientName` from the grant's client);
  - `trashing items moves exactly the ids given; ids of another dossier are reported in notFound and untouched` (seed a second dossier of the same user and one of another user);
  - `nothing to move is a 404 and writes no trash entry`;
  - `the list shows items with citation and actCitation, notes with nulls, newest first`;
  - `restoring a dossier brings back the same ids for dossier, items and snapshots`;
  - `restoring items appends them after the last entry in their original order` (add an item after the deletion; Review Focus 4); `restoring twice is a 404`;
  - `restoring items whose dossier is gone is a 409 without targetDossierId, and lands in targetDossierId when it is the user's (404 when it is not)`;
  - `a note attached to a trashed article stays, and is attached again on restore` (Review Focus 5);
  - `purge deletes the entry; another user's entry is a 404 for list, restore and purge`;
  - `the sweep removes expired entries only`;
  - `deleting the account removes the trash` (through `deleteUserAccount`);
  - `revoking the grant leaves the entries restorable`;
  - `a delegated token cannot list, restore or purge` (403), `a user session cannot call the trash routes` (403);
  - `the 21st trash call of the day is a 429 with quota trash`;
  - `a sentenza-like item type round-trips unchanged` — skip until Sentenze PR C adds the enum value; leave the test written with `it.skip` and a comment naming PR C.
- [ ] **Step 3: Run** (window) → fail.
- [ ] **Step 4: Schema + migration** as in Task 1 Steps 4–5 (expected SQL: one `CREATE TYPE`, one `CREATE TABLE`, two indexes, one foreign key). Add `trash_entries` to the truncation list in `tests/setup.ts`. `npx prisma generate`.
- [ ] **Step 5: Implement `trash.ts`.** Each move is one `prisma.$transaction(async (tx) => …)`: read the rows scoped by `userId` and `dossierId`, build `payload` (dates as ISO strings) and `summary`, `tx.trashEntry.create`, then `tx.dossier.delete` (cascades items and snapshots) or `tx.dossierItem.deleteMany({ where: { id: { in: moved }, dossierId } })`. Restore: in one transaction, re-check the entry is the user's and unexpired, re-create with the original ids (`createMany` for items and snapshots), positions for items `max(position)+1+i`, `tx.trashEntry.delete`; a unique violation on an id (P2002) → 409 «Questi elementi sono già stati ripristinati.». `sweepExpiredTrash` is called and awaited at the top of every trash route through a module-level `lastSweep` timestamp (at most every 10 minutes; phase 1's lesson: never fire-and-forget).
- [ ] **Step 6: Routes and table.** `routes/trash.ts` behind `authenticate`, refusing `req.delegation` with 403; the two trash routes in `dossiers.ts` refusing a request without `req.delegation` with 403; table entries with scope `DELETE_SCOPE`. The existing `DELETE` routes stay out of the table (a test asserts `findDelegatedRoute('DELETE', '/dossiers/x')` is undefined).
- [ ] **Step 7: Run** → PASS; whole server suite in one window; build.
- [ ] **Step 8: Commit** — `feat(server): a 30-day trash for what connected applications delete`.

### Task 7: The checkbox and the switch in the web app

**Files:**
- Modify: `apps/web/src/features/connections/connectionsService.ts`, `ConnectPage.tsx`, `ConnectedAppsSection.tsx`
- Test: `apps/web/src/features/connections/__tests__/ConnectPage.test.tsx`, `ConnectedAppsSection.test.tsx`

**Interfaces:**
- Consumes: `deletion.label`, `{ approve, allowDelete }`, `canDelete`, `PATCH /api/oauth/grants/:id` (Task 5).
- Produces: `connectionsService.decide(requestId, approve, allowDelete = false)`, `connectionsService.setCanDelete(grantId, canDelete): Promise<void>`; `ConnectedApp.canDelete: boolean`.

- [ ] **Step 1: Failing tests:** the consent page shows the deletion checkbox unticked under the permissions, with the label from the server; Autorizza sends `allowDelete: false` untouched and `true` when ticked; the settings list shows «Può eliminare dossier, voci e schede» per connection with its state, and toggling calls `setCanDelete` and shows the new state (and rolls back with an error message when the call fails).
- [ ] **Step 2: Run** `npm --prefix apps/web run test -- --run src/features/connections` → fail.
- [ ] **Step 3: Implement** with the existing UI primitives in these files (the checkbox is a labelled `<input type="checkbox">`, the switch a labelled checkbox styled as the settings page's other toggles — `grep -rn "role=\"switch\"" apps/web/src/components` and reuse it if one exists).
- [ ] **Step 4: Run** the web suite, `npm --prefix apps/web run build`, `npm --prefix apps/web run lint` → clean.
- [ ] **Step 5: Browser pass** with Chrome DevTools MCP: this branch's web on :5183 (a temporary vite config in the scratchpad, as the spike did) against this branch's server on :3011 (after `migrate deploy` of Tasks 1 and 6 on the dev DB, announced to the orchestrator first); the round's test user; register a client with the e2e script, open `/connect`, tick, approve; Impostazioni shows the switch on; switch off; introspection says no `content:delete`. Console clean except known MERL-T 404s.
- [ ] **Step 6: Commit**, open **PR 3** (`feat/mcp-trash`): says it touches authentication and the Prisma schema (D-046). Fresh code review **and** a security review of Tasks 5–6 against spec §7 points 3–5; fix; merge at green CI. Tell the orchestrator the trash routes are in `develop` (the dossier UI round builds on them).

---

## PR 4 — `feat/mcp-delete-tools`: deleting through MCP

### Task 8: Confirmation and the two deletion tools

**Files:**
- Create: `apps/mcp/src/confirm.ts`, `apps/mcp/tests/delete.test.ts`
- Modify: `apps/mcp/src/tools/dossier.ts`, `apps/mcp/src/server.ts` (`TOOL_SCOPES` for HTTP: read scopes only), `apps/mcp/tests/stubs.ts` (trash routes, `content:delete` in introspection), `apps/mcp/tests/tools.test.ts` (the "no destructive tool" test becomes "the destructive tools are exactly these two, marked destructive"), `apps/mcp/scripts/e2e.mjs`

**Interfaces:**
- Consumes: sessions and `callerOf` (Task 4); trash routes and `content:delete` (Tasks 5–6).
- Produces:

```ts
// src/confirm.ts
export const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;
export type Confirmation = 'confirmed' | 'declined' | 'unsupported';
/**
 * Asks the user, through the client, to confirm (form elicitation, spec §4.1).
 * Only an explicit Accept with the box ticked confirms; Decline, Cancel, a
 * timeout, an unticked box or an invalid answer are all 'declined'. A client
 * that did not declare form elicitation is 'unsupported' — never a fallback.
 */
export async function confirmWithUser(server: McpServer, message: string): Promise<Confirmation>;
/** The dialog's text, built from stored data only: what goes, how many, and that it can be restored for 30 days. */
export function deletionMessage(what: { dossierName: string; lines: string[]; total: number; attachedNotesStaying?: number }): string;
```

  `confirmWithUser` checks `server.server.getClientCapabilities()?.elicitation` (an empty object counts as form, per the 2025-06-18 revision; `form` explicitly otherwise), then `server.server.elicitInput({ mode: 'form', message, requestedSchema: { type: 'object', properties: { conferma: { type: 'boolean', title: 'Confermo: sposta nel cestino' } }, required: ['conferma'] } }, { timeout: CONFIRMATION_TIMEOUT_MS })`, returns `'confirmed'` only for `action === 'accept' && content?.conferma === true`, and `'declined'` for anything else including a thrown timeout or validation error. `deletionMessage` cuts every line to 120 characters, lists at most 20 and adds «e altre N», strips control characters and the characters `<>` from stored titles. Tools: `omnilex_elimina_dossier { dossier }` and `omnilex_elimina_voci_dossier { dossier, voci: string[] 1–50 }`, annotations `destructiveHint: true, readOnlyHint: false, idempotentHint: false, openWorldHint: false`; `TOOL_SCOPES` = `['dossier:read']` for both (the HTTP layer); the tool itself refuses when `!caller.scopes.includes('content:delete')` with «Questa applicazione non è autorizzata a eliminare. Puoi abilitarlo in VisuaLex: Impostazioni → Applicazioni collegate → «Può eliminare dossier, voci e schede».».

- [ ] **Step 1: Failing tests** (`delete.test.ts`, SDK `Client` declaring `capabilities: { elicitation: { form: {} } }` and a `setRequestHandler(ElicitRequestSchema, …)` the test controls):
  - `without content:delete the tool says how to turn it on and calls nothing` (no exchange, no elicitation);
  - `a client without elicitation is refused and nothing is called beyond the read`;
  - `the dialog names the dossier, each entry's citation and the count, and says 30 days`;
  - `Decline, Cancel, conferma false, and a timeout delete nothing` (timeout: use fake timers or pass a short timeout through an exported test hook);
  - `Accept deletes exactly the ids shown` — the stub's `GET /dossiers` answer changes between the read and the trash call (an id removed): the trash call carries the ids shown; the answer reports the missing one as not found (Review Focus 2);
  - `the content:delete token is exchanged only after Accept` (the stub's `exchanges` list: `dossier:read` before the elicitation, `content:delete` after, and none on Decline);
  - `voci not in the dossier are refused before asking` («Voci non trovate in questo dossier: …»);
  - `a stored title with markup or control characters is shown cleaned and cut`;
  - `omnilex_elimina_dossier moves the whole dossier after confirmation`;
  - `a 429 with quota trash says the daily deletions limit`;
  - `the log line never contains the titles or the answer` (spy on `console.info`/`console.error`).
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement** `confirm.ts` and the two tools: read the dossier with `dossier:read` (`findDossier`, then `GET /dossiers/:id`), resolve `voci` to items (all must belong to it, else refuse before asking), count notes whose `about_item_id` is among them and not themselves deleted (for «N note collegate restano nel dossier»), build the message from server data, `confirmWithUser`, then `callApi(config, caller, 'content:delete', …, { method: 'POST', body: { itemIds } })`. Answer: `{ spostate_nel_cestino: n, non_trovate: [...], ripristinabili_fino_al: <date> }` or «Nulla è stato eliminato.».
- [ ] **Step 4: Run** → PASS; build.
- [ ] **Step 5: e2e.** `e2e.mjs` gains: switch deletion on through `PATCH /api/oauth/grants/:id` with the user session; the SDK client answers the elicitation with Accept; delete one entry; `GET /api/trash` shows it; restore it with the user session; delete again and Decline → still there; switch deletion off → the tool answers how to turn it on. Run live (:3011/:3012, the round's test user) → all steps pass. LibreLex smoke (`uv run --with fastmcp==3.4.7`) with and without an `elicitation_handler`: without → refused; with one that returns Accept → moved.
- [ ] **Step 6: Security review gate** — a fresh read-only reviewer over PR 3's merged code and this task, against spec §7 points 1–8 (prompt injection, auto-approving client, replay, outside the user's dossiers, restore after revocation, session hijack, the mark forged, logs). Findings fixed or written in the PR before merge.
- [ ] **Step 7: Commit**, open **PR 4** (`feat/mcp-delete-tools`), with the review table; merge at green CI. Manual acceptance (spec §1, deletion part) is asked of the owner through the orchestrator, with the steps.

---

## PR 5 — `feat/mcp-cards`: LingoLex cards (spike Tasks 12–13)

Q7 («28 sì») and Q8 (global trash only) are answered: spec §10.

### Task 9: Anchors from a resolved norm

**Files:**
- Create: `apps/server/src/lingo/anchors.ts`, `apps/server/tests/lingoAnchors.test.ts`
- Modify: `apps/server/src/norms/resolveReference.ts` (export what the anchor needs: the fingerprint and tree reads, without changing their behaviour)

**Interfaces:**
- Consumes: `resolveReferences`, `NormaVisitata` (phase 1).
- Produces:

```ts
export interface AnchorKeys { normaKey: string; articleId: string; urn: string }
/** One documented place (S6): labels derived from the resolved norm; the URN is the identity. */
export function anchorKeys(norm: NormaVisitata): AnchorKeys;
export type AnchorOutcome =
  | { outcome: 'anchored'; anchor: AnchorKeys & { aknFingerprint: string } }
  | { outcome: 'not_recognised' | 'does_not_exist' | 'ambiguous' | 'unavailable'; detail: string };
/** Resolves references and takes each article's fingerprint (S7 for annexes): 1–10 per call. */
export async function resolveAnchors(references: string[]): Promise<AnchorOutcome[]>;
```

- [ ] **Step 1: Failing tests** — a table for `anchorKeys`: «codice civile» art. 1453 → `codice_civile`, `art_1453`; art. 2-bis of l. 241/1990 → `legge_1990_08_07_241`, `art_2_bis`; art. 3 of allegato 1 of a d.lgs. → `…`, `all_1_art_3`; the URN passed through untouched; every `normaKey` matches the card schema's `^[a-z0-9]+(_[a-z0-9]+)*$`. For `resolveAnchors` (Python stubbed with nock): a single-part act takes the fingerprint from `fingerprints[articleKey]`; an annexed article takes it from the one part whose fingerprint keys equal the annex's article numbers in `fetch_tree`; two parts matching or none → `unavailable` with «non riesco a verificare l'articolo nell'allegato»; `available: false` → `unavailable`; an EU act → `unavailable` («per gli atti UE non c'è un'impronta AKN»).
- [ ] **Step 2: Run** (window) → fail. **Step 3: Implement** (the alias → snake_case table lives beside `anchorKeys`, built from the Python preset aliases the resolver already returns in `tipo_atto`; document each rule in the function's comment). **Step 4: Run** → PASS. **Step 5: Commit.**

### Task 10: Card routes, scopes and card deletion

**Files:**
- Create: `apps/server/src/routes/lingoCards.ts`, `apps/server/src/controllers/lingoCardsController.ts`
- Modify: `apps/server/src/oauth/config.ts` (`lingo:cards:read`, `lingo:cards:write`), `consent.ts` (labels), `delegatedRoutes.ts`, `apps/server/src/lingo/deleteUserAccount.ts` (export `PERSONAL_STATES`), `apps/server/src/trash/trash.ts` (`trashLingoCards`, card restore), `app.ts`
- Test: `apps/server/tests/lingoCardsRoutes.test.ts`, extend `trash.test.ts`

**Interfaces:**
- Consumes: `resolveAnchors` (Task 9), `createLingoCard`, the trash (Task 6).
- Produces: `POST /api/lingo/cards` `{ cards: CardInput[] 1–10 }` where `CardInput` is the card schema with `ancore: { riferimento: string; principale?: boolean }[]` in place of fingerprints → per-card `{ outcome: 'created', id } | { outcome: 'refused', detail, anchors: AnchorOutcome[] }` (a card is created only when every anchor is `anchored`; 503 for the whole call only when the source is down for all); `GET /api/lingo/cards?materia&stato&cursor` (own, 50 a page); `GET /api/lingo/cards/:id`; delegated `POST /api/lingo/cards/trash` `{ cardIds: 1–10 }` → `{ trashId?, moved, notFound, notDeletable }` (Q7: only `PERSONAL_STATES`); `trashLingoCards(userId, cardIds, by)`; trash kind `LINGO_CARDS` restore re-creates cards and anchors with their ids and state. Table: create `lingo:cards:write` weight 2 per card counter `card`; list/read `lingo:cards:read` weight 1; trash `content:delete` weight 1 counter `trash`.
- [ ] **Step 1: Failing tests:** a card is created as `BOZZA_PERSONALE` whatever the body says; the stored fingerprint is the one the Python API returned; an unresolvable anchor refuses that card and writes nothing for it; one user cannot read another's cards (404); the 101st card of the day is a 429 `card`; card deletion moves own drafts and archived cards, reports community cards in `notDeletable` and other users' in `notFound`, touches neither; restore brings the card back with its anchors; account deletion still removes drafts and keeps community cards (the existing test stays green with the shared `PERSONAL_STATES`).
- [ ] **Steps 2–5:** run (window) → fail; implement; run → PASS; commit.

### Task 11: The card tools and the end to end

**Files:**
- Create: `apps/mcp/src/tools/cards.ts`, `apps/mcp/tests/cards.test.ts`
- Modify: `apps/mcp/src/server.ts` (register, `ALL_SCOPES` gains the card scopes), `apps/mcp/tests/stubs.ts`, `apps/mcp/scripts/e2e.mjs`

**Interfaces:**
- Consumes: Task 10's routes; `confirmWithUser`, `deletionMessage` (Task 8).
- Produces: `lingolex_schema_card` (read-only; the card's fields, the kinds and subjects, the anchoring rules: anchors as references, one primary, the URN is verified by VisuaLex, a card without a verifiable anchor is refused), `lingolex_salva_card` (1–10 cards), `lingolex_le_mie_card` (own cards, filters, paging), `lingolex_elimina_card` (1–10 ids; `lingo:cards:read` at the HTTP layer, `content:delete` checked in the tool, confirmation as Task 8, the dialog lists each card's istituto and the first 80 characters of the question).
- [ ] **Step 1: Failing tests:** schema tool text names the anchoring rules; saving reports per-card outcomes; reading is the user's own; deletion refuses without permission, asks, deletes only after Accept, reports `notDeletable` in Italian («è stata proposta alla community: non si può eliminare»); the tool list: the destructive tools are exactly the three, marked destructive.
- [ ] **Steps 2–4:** run → fail; implement; run → PASS; build.
- [ ] **Step 5: e2e and smoke** — `e2e.mjs` saves a card on art. 1453 c.c., reads it, deletes it with Accept, restores it through the API; live run passes; LibreLex smoke saves and reads a card. Record in the PR whether Claude Code re-authorises on 403 `insufficient_scope` for the new card scopes (an existing connection lacks them); if it does not, the documentation tells the user to reconnect from `/mcp`.
- [ ] **Step 6: Commit**, open **PR 5** (`feat/mcp-cards`); fresh code review; merge at green CI.

### Task 12: Documentation, final review, handoff

**Files:** `apps/mcp/CLAUDE.md` (stateful sessions, the tools, the confirmation rule, the destructive tools list), `apps/server/CLAUDE.md` (trash, `content:delete`, provenance, notes, cards), `docs/setup.md` §8 (the switch, the trash, reconnecting for card scopes), root `CLAUDE.md` only if a statement there became false.

- [ ] A fresh whole-round review (code-reviewer, most capable model) over the five PRs' merged diff against this spec; findings fixed in a last PR or tabled.
- [ ] The owner's manual acceptance in Claude Code (spec §1), asked through the orchestrator with the exact steps; the result recorded on PR 4 and PR 5.
- [ ] Cleanup: stop this round's processes (:3011, :3012, :5183), delete the test user through `deleteUserAccount`, remove the scratch probe.
- [ ] Written handoff to the orchestrator: done, left, decisions with the owner's words, PRs; the ledger closed.

---

## Order and sequencing

PR 1 → PR 2 → PR 3 → PR 4 → PR 5 (S12). PR 2 touches only `apps/mcp` and can be written while PR 1 waits for CI. Task 7's browser pass needs PR 3's migrations on the dev DB: tell the orchestrator before `migrate deploy`. Server suites run only in windows the orchestrator grants. The dossier UI round consumes PR 1 (`created_by`, `about_item_id`) and PR 3 (`/api/trash`); tell the orchestrator when each is in `develop`. Sentenze PR C: once merged, un-skip the `sentenza` round-trip test in `trash.test.ts` and allow `sentenza` as a note's `aboutItemId` target.

**Execution:** native (this session implements; a fresh reviewer per PR; a security review before PR 3 and PR 4 merge; a whole-round review at the end). The tasks share tight interfaces and the shared test database serialises the server work anyway, as in phase 1.
