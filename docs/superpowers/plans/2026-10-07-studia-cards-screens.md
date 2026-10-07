# VisuaLex Studia: study-card screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give study cards their screens in the web app: write and keep one's own cards (PR A), propose them and validate other people's (PR B), and study them with FSRS spaced repetition (PR C).

**Architecture:** Three pull requests, each usable on its own and each with its own additive migration. The server grows the card routes it already has (`routes/lingoCards.ts`) and adds three small routers (`lingoArticolo`, `lingoValidazione`, `lingoSrs`). Two pure modules hold the rules: `lingo/validationRule.ts` (when a card is validated) and `lingo/studyDay.ts` (what «today» is in Europe/Rome). The web app gets one lazy area, `components/features/studia/`, whose data is server state fetched per view, outside `useAppStore`. A row under each article in the reader, plus «Crea scheda» in the selection popup, are the only reader changes. None of the new routes is open to exchanged tokens.

**Tech Stack:** Express 4, Prisma 5 (migrations written by hand with `prisma migrate diff`), Zod 3, Vitest + supertest + nock on the server; React 19, react-router 7, Tailwind v4, Vitest + Testing Library on the web.

**Spec:** `docs/superpowers/specs/2026-10-07-studia-cards-screens-design.md`. Decisions are cited by their number there («spec D5»). It builds on the foundation plan (`docs/superpowers/plans/2026-09-30-lingolex-foundation.md`).

## Global Constraints

- **Git flow.** Each PR is its own branch off the latest `develop`, in its own worktree, never in the main checkout:
  - A: `feat/studia-cards`;
  - B: `feat/studia-validation`;
  - C: `feat/studia-review`.

  Each goes into `develop` with a merge commit `merge: <branch> — <what changes>`, once CI is green. Commits, pushes and the merge are covered by the owner's standing authorisation for the VisuaLex sessions; quote it in every subagent dispatch.
- **Before the code round**, announce the migration of PR A (`lingo_cards` gains two columns) in the activity register, as the orchestrator asked.
- **Migrations by hand.** Never `prisma migrate dev` or `reset`, and never `prisma format`. Generate with `npx prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script`, using a copy of the schema saved in the scratch directory before the edit. The drift check after each migration may show only the known `merlt_qa_jobs.updated_at` difference.
- **One server suite at a time**, across sessions too: `npm --prefix apps/server test` resets the shared test database. Never read `.env` files.
- **The shared dev stack is in use:** don't restart it. Apply a migration to the development database only after its PR is merged (`prisma migrate deploy`), as the foundation plan explains.
- **Names.** The UI says «VisuaLex Studia», «Studia», «scheda» and «schede», never «card» or «LingoLex» (spec D3). Code, comments, commits and docs are in English; UI copy is in Italian, in sentence case.
- **Labels** come from the source convention (`apps/web/src/utils/sources/`, e.g. `citeNorm`). No new label is ever invented.
- **No new delegated surface.** No route of this plan is added to `oauth/delegatedRoutes.ts`. A new path never has the shape `/lingo/cards/<one segment>`, which the delegated matcher would read as `:id`.
- **Errors you surface in files you touch are fixed**, pre-existing ones too.
- **Before calling a PR done:**
  - the suites of each area touched are green: `npm --prefix apps/server test`, `npm --prefix apps/server run build`, `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build`, `npm --prefix apps/web run lint`, and for A also `npm --prefix apps/mcp run build && npm --prefix apps/mcp test`;
  - a browser pass on `http://localhost:5173` at desktop and phone width, light and dark;
  - one fresh `code-reviewer` over the branch against the spec and this plan.

## Review Focus

These failure modes are implied by the spec, but no other task's tests would exercise them. Each is pinned in its owning task.

1. **The day boundary.** A review at 23:59 and another at 00:01 Rome time are on two different days. On the night daylight saving changes, «domani» is still the next calendar day. A server running in UTC computes the same days as one in Rome. Pinned in **Task C2**.
2. **Two votes racing.** Two validators approve the same card at the same moment: it ends `VALIDATA` once, with two votes. A vote on a card withdrawn a moment earlier is refused with 404, and no vote is left behind. Pinned in **Task B3**.
3. **An edit whose anchors cannot be checked right now.** The sources are down, so every reference is transient: the draft is unchanged and the answer is 503, as on creation. One anchor does not exist: the answer is 400 naming it, and nothing is changed. Pinned in **Task A2**.
4. **A validator demoted mid-queue.** The admin clears the flag while the queue is open: the next vote is refused with 403, because the flag is read from the database on each call. Pinned in **Task B3**.
5. **A community card that leaves the pool while queued.** A validated card goes `DA_RIVEDERE` or is archived after the session list was fetched: grading it answers 404 and writes nothing, and the next session no longer lists it. Pinned in **Task C3**.

---

## PR A — My cards (`feat/studia-cards`)

### Task A1: Origin of a card, and the list's new filters

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (model `LingoCard`)
- Create: `apps/server/prisma/migrations/20261008100000_lingo_card_origin/migration.sql`
- Modify: `apps/server/src/lingo/cards.ts`, `apps/server/src/routes/lingoCards.ts`
- Test: `apps/server/tests/lingoCardsRoutes.test.ts`

**Interfaces:**
- Produces: `createLingoCard(authorId, input, client?, origin?: { clientId: string; clientName: string | null } | null)`.
- Produces: `GET /api/lingo/cards`, with these query parameters:
  - `materia`, `stato`;
  - `tipo?: LingoCardTipo`;
  - `normaKey?: string` (snake case, at most 100 characters);
  - `q?: string` (1–100 characters, trimmed);
  - `origine?: 'applicazione'`;
  - `ordine?: 'recenti' | 'materia'` (default `recenti`);
  - `limit`, `offset`.
- Produces: each serialised card gains `origine: { clientName: string | null } | null`.

- [ ] **Step 1: Write the failing tests** in `lingoCardsRoutes.test.ts`, in a new `describe('the list for the Studia area')`:
  - a card created through `delegated(alice, 'lingo:cards:write')` has `origine.clientName` equal to the registered client's name. One created with `authHeader(alice)` has `origine: null`;
  - `?tipo=CASO_APPLICATIVO` returns only that kind;
  - `?normaKey=codice_civile` returns cards with *any* anchor on the c.c. (seed a card whose second anchor is on the c.c.);
  - `?q=risoluz` matches on the institute and on the question, case-insensitively. `?q=` (empty) answers 400, and so does a 101-character `q`;
  - `?origine=applicazione` returns only cards with a client;
  - `?ordine=materia` orders by subject, then institute, then newest. Three pages of 2 never repeat or skip a card;
  - another user's cards never appear, whatever the filter.
- [ ] **Step 2: Run them, see them fail.** Run `npm --prefix apps/server test -- lingoCardsRoutes`. Expected: the new tests FAIL (unknown query keys are ignored, and there is no `origine`).
- [ ] **Step 3: Edit the schema.** Save a copy of `schema.prisma` to the scratch directory first. Then add, under `isControversa` in `LingoCard`:

```prisma
  // The connected application that created the card (Claude Code, LibreLex), as on DossierItem.
  createdByClientId   String?        @map("created_by_client_id")
  createdByClientName String?        @map("created_by_client_name")
```

  Generate the migration with `migrate diff`. Expected SQL:

```sql
-- AlterTable
ALTER TABLE "lingo_cards" ADD COLUMN     "created_by_client_id" TEXT,
ADD COLUMN     "created_by_client_name" TEXT;
```

  Then run `npx prisma generate`.
- [ ] **Step 4: Implement.**
  - `createLingoCard` writes `createdByClientId`/`createdByClientName` from its new `origin` argument.
  - `POST /` passes `req.delegation ? { clientId: req.delegation.clientId, clientName: req.delegation.clientName } : null`.
  - `listSchema` gains the new keys:

```ts
  tipo: z.nativeEnum(LingoCardTipo).optional(),
  normaKey: z.string().max(100).regex(/^[a-z0-9]+(_[a-z0-9]+)*$/).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  origine: z.literal('applicazione').optional(),
  ordine: z.enum(['recenti', 'materia']).default('recenti'),
```

  The `where` clause becomes:

```ts
const where: Prisma.LingoCardWhereInput = {
  autoreId: req.user!.id,
  ...(materia ? { materia } : {}),
  ...(stato ? { stato } : {}),
  ...(tipo ? { tipo } : {}),
  ...(normaKey ? { ancore: { some: { normaKey } } } : {}),
  ...(q ? { OR: [{ istituto: { contains: q, mode: 'insensitive' } }, { domanda: { contains: q, mode: 'insensitive' } }] } : {}),
  ...(origine ? { createdByClientId: { not: null } } : {}),
};
const orderBy: Prisma.LingoCardOrderByWithRelationInput[] =
  ordine === 'materia'
    ? [{ materia: 'asc' }, { istituto: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
    : [{ createdAt: 'desc' }, { id: 'desc' }];
```

  `serialize` adds `origine: card.createdByClientId ? { clientName: card.createdByClientName } : null`. The client id is never serialised.
- [ ] **Step 5: Run the tests and the build, see them pass.** Run `npm --prefix apps/server test -- lingoCardsRoutes` and `npm --prefix apps/server run build`. Then run the drift check.
- [ ] **Step 6: Commit:** `feat(server): a study card records the application that wrote it; the list filters by kind, act, text and origin`.

### Task A2: Editing a draft, deleting from the web app, the cards of an article

**Files:**
- Modify: `apps/server/src/routes/lingoCards.ts` (extract the planning of a card into `lingo/planCards.ts`)
- Create: `apps/server/src/lingo/planCards.ts`, `apps/server/src/routes/lingoArticolo.ts`
- Modify: `apps/server/src/lingo/anchors.ts` (export `anchorUrn`), `apps/server/src/trash/trash.ts` (`DeletedBy` nullable), `apps/server/src/app.ts` (mount `/api/lingo/articolo` next to the other `lingo` routers)
- Test: `apps/server/tests/lingoCardsRoutes.test.ts`, `apps/server/tests/lingoAnchors.test.ts`, `apps/server/tests/trash.test.ts`, `apps/server/tests/unauthenticated.test.ts`

**Interfaces:**
- Consumes: `resolveAnchors`, `createLingoCard` (Task A1).
- Produces:
  - `planCards(cards: CardInput[]): Promise<{ planned: Planned[]; failures: AnchorOutcome[]; allTransient: boolean }>`. This is the existing body of `POST /` up to the transaction, moved verbatim.
  - `anchorUrn(raw: string): string | null`: the URN cut at `urn:`, with any `!vig=…` or `@…` version suffix removed; `null` without `urn:`.
  - `PATCH /api/lingo/cards/:id`. Its body is one card in the same shape as an element of `POST`'s `cards`. It returns `200 serialize(card)`. A card that is not the caller's answers 404, one that is not a draft 409, an unverifiable anchor 400 with `{ detail, anchors }`, and sources down for every reference 503.
  - `POST /api/lingo/cards/trash` is open to the session. `DeletedBy` becomes `{ clientId: string | null; clientName: string | null; grantId: string | null }`.
  - `GET /api/lingo/articolo?urn=`, which returns `200 { cards: Array<serialize(card) & { comunita: boolean; approvazioni: number | null }> }`. In PR A it lists only the caller's non-archived cards; PR B adds the community's.

- [ ] **Step 1: Write the failing tests.**
  - `lingoAnchors.test.ts`, a table for `anchorUrn`:
    - the c.c. address with `~art1453` → `urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453`;
    - the same address with `!vig=2026-10-07` → the same URN, without the suffix;
    - `…;241~art2bis@originale` → `…;241~art2bis`;
    - an EUR-Lex URL → `null`;
    - `''` → `null`.
  - `lingoCardsRoutes.test.ts`, `describe('editing a draft')`:
    - the author edits the question and adds an anchor «art. 1454 c.c.»: 200, with two anchors, the old primary still primary;
    - Bob's PATCH on Alice's card: 404;
    - a PATCH on a card set to `PROPOSTA_COMMUNITY` (by Prisma in the test): 409;
    - a non-existent article «art. 99999 c.c.»: 400 naming it, and the card is unchanged in the database;
    - **Review Focus 3**: with the Python API stubbed to 503 for every call, 503, and the card is unchanged (`updatedAt` too);
    - an unknown key in the body: 400;
    - an exchanged token with `lingo:cards:write`: 403 (PATCH is not in the delegated table).
  - `describe('deleting from the web app')`:
    - `POST /trash` with `authHeader(alice)` moves a draft: 200. `GET /api/trash` lists it with `clientName: null`;
    - a validated card is `notDeletable`;
    - the restore brings it back with its anchors.
  - `describe('the cards of an article')`:
    - two of Alice's cards on art. 1453 c.c. and one on art. 1454: `?urn=<the reader's address for 1453 with !vig>` returns exactly the two;
    - an archived one is absent;
    - Bob sees none of Alice's;
    - `urn` missing or without `urn:`: 400;
    - an exchanged token: 403.
  - `unauthenticated.test.ts`: rows for `PATCH /api/lingo/cards/x` and `GET /api/lingo/articolo`.
- [ ] **Step 2: Run them, see them fail.** Run `npm --prefix apps/server test -- lingoCardsRoutes lingoAnchors trash unauthenticated`. Expected: FAIL (404 or 403 on the new paths; `anchorUrn` not exported).
- [ ] **Step 3: Implement.**
  - `anchorUrn` in `anchors.ts`; `anchorKeys` uses it for `urn`, so storage and lookup share one cut:

```ts
/** The anchor's identity from a Normattiva address: cut at `urn:`, without a version suffix (S6). */
export function anchorUrn(raw: string): string | null {
  const at = raw.indexOf('urn:');
  if (at < 0) return null;
  return raw.slice(at).replace(/(!vig=[^~@]*|@[^~!]*)$/, '');
}
```

  - Move the planning of `POST /` into `planCards.ts` without changing its behaviour. The existing POST tests are the guard.
  - `PATCH /:id`:
    1. `planCards([body])`; `allTransient` → 503; a refused plan → 400 with its detail and anchors.
    2. `prisma.$transaction`: lock the row with `SELECT … FOR UPDATE` through `tx.$queryRaw`, re-read `autoreId` and `stato` (404 or 409), `lingoCardAncora.deleteMany({ where: { cardId } })`, then `lingoCard.update` with the fields and `ancore: { create: … }`. The first anchor is primary when none is marked, as in `createLingoCard`.
  - `listTrash` adds `byApplication: boolean` (`clientId !== null`) to each entry, so the web app can tell «you» from a connected application whose name is unknown.
  - In `POST /trash`, remove the `if (!req.delegation) throw 403`. Pass `by = req.delegation ? {…} : { clientId: null, clientName: null, grantId: null }`. In `trash.ts` the `label` stays `'Schede di studio'`. `apps/server/CLAUDE.md` says the card trash is open to the web app.
  - `routes/lingoArticolo.ts`:

```ts
const querySchema = z.object({ urn: z.string().min(1).max(600) });
router.get('/', async (req, res) => {
  const urn = anchorUrn(querySchema.parse(req.query).urn);
  if (!urn) throw new AppError(400, 'Indirizzo dell’articolo non valido.');
  const cards = await prisma.lingoCard.findMany({
    where: { autoreId: req.user!.id, stato: { not: 'ARCHIVIATA' }, ancore: { some: { urn } } },
    include: { ancore: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });
  res.json({ cards: cards.map((card) => ({ ...serialize(card), comunita: false, approvazioni: null })) });
});
```

  Move `serialize` to `lingo/serializeCard.ts` so both routers share it.
- [ ] **Step 4: Run the tests and the build, see them pass.** Run `npm --prefix apps/server test` (whole suite, alone) and `npm --prefix apps/server run build`.
- [ ] **Step 5: Commit:** `feat(server): drafts are edited, deleted from the web app into the trash, and found by the article they rest on`.

### Task A3: The Studia area's skeleton, the service, the words

**Files:**
- Create:
  - `apps/web/src/features/studia/featureFlag.ts`;
  - `apps/web/src/services/studiaService.ts`;
  - `apps/web/src/types/studia.ts`;
  - `apps/web/src/components/features/studia/StudiaPage.tsx` (the layout with the three views' links, and an `<Outlet/>`);
  - `apps/web/src/components/features/studia/studiaLabels.ts` (subjects, states and kinds in Italian; the card title).
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/layout/Sidebar.tsx`, `apps/web/src/components/features/dossier/TrashEntryRow.tsx`, `apps/web/src/components/features/dossier/trashSummary.ts`, `apps/mcp/src/tools/cards.ts` (titles and descriptions only)
- Test:
  - `apps/web/src/services/studiaService.test.ts`;
  - `apps/web/src/components/features/studia/studiaLabels.test.ts`;
  - `apps/web/src/__tests__/App.routes.test.tsx`;
  - `TrashEntryRow.test.tsx`;
  - `apps/mcp` tests that pin the titles.

**Interfaces:**
- Produces `types/studia.ts`:

```ts
export type Materia = 'DIRITTO_CIVILE' | 'DIRITTO_PENALE' | 'DIRITTO_AMMINISTRATIVO' | 'DIRITTO_PROCESSUALE_CIVILE' | 'DIRITTO_PROCESSUALE_PENALE';
export type StatoScheda = 'BOZZA_PERSONALE' | 'PROPOSTA_COMMUNITY' | 'VALIDATA' | 'DA_RIVEDERE' | 'ARCHIVIATA';
export type TipoScheda = 'ISTITUTO_DEFINIZIONE' | 'DISTINZIONE_CONCETTUALE' | 'CASO_APPLICATIVO' | 'REQUISITO_FORMA_ATTO';
export interface AncoraScheda { normaKey: string; articleId: string; urn: string; isPrimary: boolean }
export interface Scheda {
  id: string; materia: Materia; istituto: string; tipo: TipoScheda;
  domanda: string; risposta: string; spiegazione: string | null; stato: StatoScheda;
  createdAt: string; updatedAt: string; ancore: AncoraScheda[];
  origine: { clientName: string | null } | null;
}
export interface SchedaInput { materia: Materia; istituto: string; tipo: TipoScheda; domanda: string; risposta: string; spiegazione?: string; ancore: Array<{ riferimento: string; principale?: boolean }> }
export interface FiltriSchede { materia?: Materia; stato?: StatoScheda; tipo?: TipoScheda; normaKey?: string; q?: string; origine?: 'applicazione'; ordine?: 'recenti' | 'materia'; limit?: number; offset?: number }
```

- Produces `studiaService`:
  - `list(filtri): Promise<{ cards: Scheda[]; nextOffset: number | null }>`;
  - `get(id)`;
  - `create(input): Promise<{ outcome: 'created'; id: string } | { outcome: 'refused'; detail: string; anchors?: … }>`, which wraps `POST /lingo/cards` with `cards: [input]` and returns `results[0]`;
  - `update(id, input)`;
  - `trash(ids)`;
  - `forArticle(urn)`.
- Produces `studiaLabels`:
  - `MATERIA_LABEL`, `STATO_LABEL`, `TIPO_LABEL`;
  - `cardTitle(card: Scheda): string`. It returns `istituto · citeNorm(normFromUrn(primary.urn))`; if `normFromUrn` cannot rebuild the norm, the institute alone.
- Produces `isStudiaEnabled(): boolean`, which reads `VITE_FEATURE_STUDIA` and defaults to on.

- [ ] **Step 1: Write the failing tests.**
  - `studiaLabels.test.ts`: `cardTitle` on a card anchored at `urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453` → «Risoluzione per inadempimento · art. 1453 c.c.»; on a l. 241/1990 anchor → «… · art. 2, l. 7 agosto 1990, n. 241»; with an unparseable URN → the institute alone. `STATO_LABEL.VALIDATA === 'Validata'`.
  - `studiaService.test.ts` (axios mocked): `create` posts `{ cards: [input] }` and returns `results[0]`; `list` drops undefined filters from the query.
  - `App.routes.test.tsx`: `/studia/schede` renders «Le mie schede»; with `VITE_FEATURE_STUDIA=false` the nav entry is absent and `/studia` is the 404 page.
  - `TrashEntryRow.test.tsx`: one card → «Scheda di studio»; three → «Schede di studio (3)»; an entry without a client → «Rimosso da te il …».
  - In `apps/mcp`, the test that lists tool titles expects «Come si scrive una scheda di VisuaLex Studia», «Salva schede di VisuaLex Studia», «Le mie schede di VisuaLex Studia» and «Elimina schede di VisuaLex Studia».
- [ ] **Step 2: Run them, see them fail.** Run `npm --prefix apps/web run test -- --run studia TrashEntryRow App.routes` and `npm --prefix apps/mcp test`.
- [ ] **Step 3: Implement.**
  - The route in `App.tsx`, lazy like the others:

```tsx
const StudiaPage = lazy(() => import('./components/features/studia/StudiaPage').then((m) => ({ default: m.StudiaPage })));
const MyCardsView = lazy(() => import('./components/features/studia/MyCardsView').then((m) => ({ default: m.MyCardsView })));
…
{isStudiaEnabled() && (
  <Route path="studia" element={<Suspense fallback={<div>Caricamento…</div>}><StudiaPage /></Suspense>}>
    <Route index element={<Navigate to="schede" replace />} />
    <Route path="schede" element={<Suspense fallback={null}><MyCardsView /></Suspense>} />
    <Route path="schede/:id" element={<Suspense fallback={null}><MyCardsView /></Suspense>} />
  </Route>
)}
```

  - In the sidebar: `<NavItem to="/studia" icon={GraduationCap} label="Studia" id="tour-nav-studia" onClick={closeMobile} />` after Dossier.
  - `MyCardsView` is a stub with its heading until Task A5.
  - `trashWhen` uses «te» when the entry's `byApplication` is false (Task A2); the label text changes as above.
  - The four MCP titles and descriptions say «VisuaLex Studia» instead of «LingoLex». The tool names stay.
- [ ] **Step 4: Run the tests, the build and lint, see them pass.**
- [ ] **Step 5: Commit:** `feat(web): the Studia area, its service and its words; the trash and the MCP tools say «schede di studio»`.

### Task A4: The card form, created from an article or from a selection

**Files:**
- Create:
  - `apps/web/src/components/features/studia/CardForm.tsx`;
  - `apps/web/src/components/features/studia/CardFormDialog.tsx` (a `Modal` on desktop, a bottom sheet on a phone, chosen with `useIsDesktop`);
  - `apps/web/src/components/features/studia/inferMateria.ts`.
- Test: `CardForm.test.tsx`, `inferMateria.test.ts`

**Interfaces:**
- Consumes: `studiaService.create/update`, `citeNorm`, the types of Task A3.
- Produces:
  - `inferMateria(norma: { tipo_atto: string; tipo_atto_reale?: string | null }): Materia | null`;
  - `<CardFormDialog open onClose mode={{ kind: 'create', norma: NormaVisitata, passage?: string } | { kind: 'edit', card: Scheda }} onSaved={(id: string) => void} />`.

- [ ] **Step 1: Write the failing tests.**
  - `inferMateria`:
    - «codice civile» → civile; «codice penale» → penale;
    - «codice di procedura civile» → processuale civile; «codice di procedura penale» → processuale penale;
    - «codice del processo amministrativo» → amministrativo;
    - «legge» → null;
    - the comparison folds case and spaces, as `actTypes.ts` does (gotcha 28).
  - `CardForm`:
    - opened from art. 1453 c.c., the primary chip reads «art. 1453 c.c.» and cannot be removed, and the subject is «Diritto civile»;
    - opened with `passage: 'Nei contratti con prestazioni corrispettive…'`, the answer field holds it;
    - «Salva» with an empty question shows «Scrivi la domanda» and sends nothing;
    - adding «art. 99999 c.c.» and saving, with the service answering `refused` and that anchor, puts the server's detail under that chip and keeps the form open;
    - a successful save calls `onSaved(id)` and shows the toast «Scheda salvata»;
    - in edit mode the primary chip is removable and replaceable, and «Salva» calls `update`;
    - the question `<img src=x onerror=alert(1)>` round-trips as literal text.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: Implement** with the `ui/` primitives (`Input`, `FormSelect`, `SegmentedControl`, `Button`, `Modal`). The fields use the server schema's limits: institute 200, question 2,000, answer 4,000, explanation 8,000, shown as a countdown in the last 10%. The anchors are sent as `{ riferimento, principale }`, with the reader's article as `citeNorm(norma)` and `principale: true`.
- [ ] **Step 4: Run them, see them pass; build and lint.**
- [ ] **Step 5: Commit:** `feat(web): the card form, with the subject inferred from the act and the article as primary anchor`.

### Task A5: «Le mie schede»

**Files:**
- Create:
  - `apps/web/src/components/features/studia/MyCardsView.tsx`;
  - `CardFilters.tsx`;
  - `CardGroups.tsx` (subject → institute, the accordion pattern of `DossierActBlock`);
  - `CardDetail.tsx`;
  - `StateChip.tsx` (maps the states onto `StatusChip` tones);
  - `useMyCards.ts`.
- Test: `MyCardsView.test.tsx`, `useMyCards.test.ts`

**Interfaces:**
- Consumes: `studiaService.list/get/trash`, `cardTitle`, `CardFormDialog`, `ClaudeMark` (from `dossier/ClaudeMark.tsx`; move it to `components/ui/ClaudeMark.tsx` if a second feature imports it, and update the dossier's imports).
- Produces: `useMyCards(filtri)`, which returns `{ groups: Array<{ materia: Materia; istituti: Array<{ istituto: string; cards: Scheda[] }> }>; loadMore(); hasMore; loading; error; refresh() }`. It always lists with `ordine: 'materia'`, so groups stay contiguous across pages.

- [ ] **Step 1: Write the failing tests.**
  - Five cards in two subjects and three institutes render two subject headings and three institute headings, in order.
  - The search box debounces 300 ms and calls `list` with `q`.
  - «Scritte da Claude, da rileggere» sends `origine=applicazione&stato=BOZZA_PERSONALE`.
  - A card with `origine.clientName: 'Claude Code'` shows «scritta da Claude Code (applicazione collegata)».
  - Selecting a row navigates to `/studia/schede/:id` and shows the detail. On a narrow viewport (`useIsDesktop` mocked false) the detail replaces the list and has «Indietro».
  - «Elimina» opens `ConfirmDialog` with «La scheda va nel cestino per 30 giorni. Le altre schede non sono toccate.»; confirming calls `trash([id])` and shows «Scheda nel cestino».
  - «Elimina» and «Modifica» are absent on a validated card.
  - The empty state reads «Nessuna scheda ancora. Aprine una da un articolo con “+ Nuova scheda”, o chiedi a Claude di scriverne.»
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: Implement.** The filter row is sticky, following the UI conventions («Sticky filter rows»). The detail shows each anchor as a link that opens the article in the reader through the workspace's existing open-norm action (the one `DossierArticleRow` uses).
- [ ] **Step 4: Run them, see them pass; build and lint.**
- [ ] **Step 5: Commit:** `feat(web): «Le mie schede», grouped by subject and institute, with filters, detail, edit and delete`.

### Task A6: The reader's row and the selection's «Crea scheda»

**Files:**
- Create: `apps/web/src/components/features/studia/ArticleCardsRow.tsx`, `ArticleCardsPeek.tsx`, `useArticleCards.ts`
- Modify: `apps/web/src/components/features/search/ArticleTabContent.tsx` (after `ArticleDiscussionPanel` and `AskMerltEntry`, before `BrocardiDisplay`), and `SelectionPopup` (one action).
- Test: `ArticleCardsRow.test.tsx`, plus the existing `ArticleTabContent` and `SelectionPopup` tests.

**Interfaces:**
- Consumes: `studiaService.forArticle`, `CardFormDialog`, `isStudiaEnabled`.
- Produces: `useArticleCards(urn: string | undefined)`, which returns `{ cards; count; refresh }`. It is cached per URN in a module-level `Map` for the session, and invalidated by `refresh()` after a save.

- [ ] **Step 1: Write the failing tests.**
  - With two cards the row reads «Schede su questo articolo (2)» and «+ Nuova scheda». Clicking the count opens the Peek, which lists both questions with their state chips; a row links to `/studia/schede/:id`.
  - With none, the row reads «Nessuna scheda su questo articolo · + Nuova scheda».
  - An EUR-Lex article (no `urn:` in `norma_data.urn`) renders no row.
  - `readOnly` or `versionInfo.isHistorical` disables «+ Nuova scheda», with the tooltip «Le schede si ancorano al testo vigente».
  - With the flag off, there is no row.
  - In `SelectionPopup`, «Crea scheda» opens the form with the selected text in the answer.
  - The rendered article text nodes are unchanged: the existing `articleRender.test.ts` still passes. The row sits outside `.vlx-art`.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: Implement.** The row is one line in slate, `text-sm`, with a 44 px target on a phone. The Peek follows the notes' pattern («Two flavours of pop-up»). Saving from the form calls `refresh()`.
- [ ] **Step 4: Run the whole web suite, build and lint.**
- [ ] **Step 5: Commit:** `feat(web): under each article, the cards that rest on it and «+ Nuova scheda»; «Crea scheda» from a selection`.

### Task A7: Docs, browser pass, review, PR A

- [ ] `apps/server/CLAUDE.md`: the card routes (filters, PATCH, the trash open to the session, `/api/lingo/articolo`, `anchorUrn`). `apps/web/CLAUDE.md`: the Studia area, its folder, its flag, the reader row, and the rule that cards are server state outside the store. `apps/mcp/CLAUDE.md` if it quotes the tool titles.
- [ ] Browser pass on `http://localhost:5173`. Open art. 1453 c.c. and create a card. See it under the article and in «Le mie schede». Edit it and delete it, and find it in the trash as «Rimosso da te». Try a past text (button disabled). Repeat at 390 px wide and in dark mode.
- [ ] Fresh `code-reviewer` over the branch. Fix every finding or record why not.
- [ ] Push. Open the PR into `develop`; the description says it touches the Prisma schema and migrations. Merge with `merge: feat/studia-cards — study cards in the web app: written, edited, listed and found under their article` once CI is green. Then `prisma migrate deploy` on the development database.

---

## PR B — Propose and validate (`feat/studia-validation`)

### Task B1: Votes, versioned texts to accept, the validator flag

**Files:**
- Modify: `apps/server/prisma/schema.prisma`, `apps/server/tests/setup.ts` (truncate the new tables), `apps/server/src/controllers/authController.ts` (export), `apps/server/src/controllers/adminController.ts` (the flag)
- Create: `apps/server/prisma/migrations/20261009100000_lingo_validation/migration.sql`
- Test: `apps/server/tests/lingoAccountErasure.test.ts`, `apps/server/tests/accountData.test.ts`, `apps/server/tests/lingoValidation.schema.test.ts`

**Interfaces:**
- Produces:
  - the models `LingoValidazioneCard` (`lingo_validazioni_card`), `LingoTestoVersione` (`lingo_testi_versioni`) and `LingoAccettazioneTesto` (`lingo_accettazioni_testi`), the enums `LingoGiudizio` and `LingoTestoChiave`, `LingoCard.propostaTestoId` and `User.lingoValidatore`, exactly as spec §4 «PR B» writes them;
  - version 1 of `PROPOSTA_SCHEDA`, inserted by the migration with the wording of spec decision 13 (title «Proponi la scheda alla comunità», the three paragraphs as the body separated by blank lines, checkbox «Ho letto e accetto», button «Proponi»), `autore_id` null;
  - the export keys `data.lingoValidazioni: Array<{ cardId; giudizio; motivazione; createdAt }>` and `data.lingoAccettazioni: Array<{ chiave; versione; acceptedAt }>`;
  - `PUT /admin/users/:id` accepts `lingoValidatore: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - Deleting Carol, who voted on Alice's proposed card and accepted the notice, keeps the vote with `utenteId: null` and the card untouched; her acceptance is gone. Use both deletion paths: the user's own and the admin's.
  - Deleting an administrator who wrote version 2 keeps the version with `autoreId: null`.
  - After the migration, `PROPOSTA_SCHEDA` has exactly one version, number 1, whose body contains «CC BY-SA 4.0».
  - Deleting a text version that an acceptance points to fails at the database (`Restrict`).
  - Two anonymous votes on the same card don't collide on the unique index.
  - The export of a validator carries their votes and their acceptances.
  - The admin sets and clears `lingoValidatore`; a non-admin's PUT is 403.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: Schema, migration, generate.** Generate with `migrate diff`. Read the SQL: two enums, three tables, one column on `lingo_cards` and one on `users`, and the foreign keys: `SET NULL` from votes and versions to `users`, `CASCADE` from acceptances to `users`, `RESTRICT` from acceptances and cards to versions. Append by hand the `INSERT` of version 1 (a fixed uuid, `versione` 1, the texts as SQL literals with `'` doubled). Then the export and the admin field.
- [ ] **Step 4: Run them, see them pass; build; drift check.**
- [ ] **Step 5: Commit:** `feat(server): validators and their votes on study cards; texts to accept, versioned, and who accepted which; votes outlive their author`.

### Task B2: The validation rule and the new arrow

**Files:**
- Create: `apps/server/src/lingo/validationRule.ts`
- Modify: `apps/server/src/lingo/cardStates.ts`
- Test: `apps/server/tests/unit/lingo/validationRule.test.ts`, `apps/server/tests/unit/lingo/cardStates.test.ts`

**Interfaces:**
- Produces:

```ts
import type { LingoCardStato, LingoGiudizio } from '@prisma/client';
/** Provisional (spec decision 14): to confirm with the other developer. */
export const APPROVALS_TO_VALIDATE = 2;
export const ERRATA_TO_ARCHIVE = 1;
export function stateAfterVotes(votes: readonly LingoGiudizio[]): LingoCardStato {
  if (votes.filter((v) => v === 'ERRATA').length >= ERRATA_TO_ARCHIVE) return 'ARCHIVIATA';
  if (votes.filter((v) => v === 'APPROVATA').length >= APPROVALS_TO_VALIDATE) return 'VALIDATA';
  return 'PROPOSTA_COMMUNITY';
}
```

- In `cardStates.ts`, `PROPOSTA_COMMUNITY: ['VALIDATA', 'ARCHIVIATA', 'BOZZA_PERSONALE']`, with the diagram comment updated (withdrawal, spec decision 20).

- [ ] **Step 1: Write the failing tests.** A table for `stateAfterVotes`:
  - `[]` → proposed;
  - `[APPROVATA]` → proposed;
  - `[APPROVATA, APPROVATA]` → validated;
  - `[APPROVATA, MIGLIORABILE]` → proposed;
  - `[APPROVATA, APPROVATA, ERRATA]` → archived (the «errata» wins);
  - `[ERRATA]` → archived;
  - `[MIGLIORABILE, MIGLIORABILE, MIGLIORABILE]` → proposed.

  In `cardStates`, proposed → draft is allowed, and draft → validated is still refused.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Commit:** `feat(server): when a proposed card is validated or archived, in one module; a proposal can be withdrawn`.

### Task B3: Propose, withdraw, the queue, the vote, the texts' versions

**Files:**
- Create: `apps/server/src/routes/lingoValidazione.ts` (mounted at `/api/lingo/validazione`), `apps/server/src/lingo/texts.ts`, `apps/server/src/routes/lingoTesti.ts` (mounted at `/api/lingo/testi`), `apps/server/src/routes/adminStudiaTesti.ts` (next to the other admin routes, behind the admin check)
- Modify: `apps/server/src/routes/lingoCards.ts`, `apps/server/src/routes/lingoArticolo.ts`, `apps/server/src/lingo/serializeCard.ts`, `apps/server/src/app.ts`
- Test: `apps/server/tests/lingoValidation.routes.test.ts`, `apps/server/tests/lingoTexts.routes.test.ts`, `apps/server/tests/unauthenticated.test.ts`

**Interfaces:**
- Consumes: `stateAfterVotes`, `canTransition`.
- Produces:
  - in `lingo/texts.ts`: `currentText(tx, chiave): Promise<LingoTestoVersione>` (the highest version) and `hasAccepted(tx, userId, testoId): Promise<boolean>`;
  - `GET /api/lingo/testi/:chiave`, which answers `200 { id, chiave, versione, titolo, corpo, conferma, azione, accettata: boolean }`, or 404 for an unknown key;
  - `GET /api/admin/studia/testi`, which answers `200 { testi: Array<{ chiave, versioni: Array<{ id, versione, titolo, corpo, conferma, azione, createdAt, autore: string | null }> }> }`, newest version first;
  - `POST /api/admin/studia/testi/:chiave`, body `{ titolo (1–200), corpo (1–8,000), conferma (1–120), azione (1–120) }`, strict. It answers `201` with the new version, or 409 when another version was saved at the same moment;
  - `POST /api/lingo/cards/:id/proponi`, body `{ accettoTestoId?: string }`. It answers `200 serialize(card)`, or `409 { richiedeTesto: <current version, as GET /api/lingo/testi> }`;
  - `POST /api/lingo/cards/:id/ritira`, which answers `200 serialize(card)`;
  - `GET /api/lingo/validazione/coda?materia=&limit=` (1–20, default 10), which answers `200 { cards: Array<serialize(card)> }`;
  - `POST /api/lingo/validazione/:cardId`, body `{ giudizio: 'APPROVATA' | 'MIGLIORABILE' | 'ERRATA', motivazione?: string }` (reason 1–2,000 characters, required unless `APPROVATA`). It answers `200 { stato }`;
  - `GET /api/lingo/cards/:id` adds `approvazioni: number` and `rilievi: Array<{ giudizio: 'MIGLIORABILE' | 'ERRATA'; motivazione: string; createdAt }>`, with no voter id;
  - `GET /api/lingo/articolo` adds other people's `VALIDATA` cards on the URN, with `comunita: true` and `approvazioni`.

- [ ] **Step 1: Write the failing tests.**
  - **Proposing:**
    - without an accepted notice, 409 with the current version (number 1), and the card is still a draft;
    - with `accettoTestoId` = that version's id, 200, the card is proposed with `propostaTestoId` set, and one acceptance row holds the user, the version and the time;
    - a second proposal by the same user needs no body;
    - an administrator saves version 2: Alice's next proposal answers 409 with version 2, while her card proposed under version 1 keeps `propostaTestoId` = version 1 and its state;
    - `accettoTestoId` = version 1's id after version 2 exists: 409 with version 2, and no acceptance is written;
    - `accettoTestoId` = an unknown id: 409, nothing written;
    - Bob proposing Alice's draft gets 404;
    - proposing a proposed card gets 409.
  - **Withdrawing:** Alice withdraws a proposed card that has one «migliorabile»: it is a draft again, its votes are gone and `propostaTestoId` is null. Withdrawing a validated card gets 409.
  - **The queue:**
    - a non-validator gets 403;
    - Carol (validator) sees Alice's proposed cards, oldest first, and not her own, nor those she voted on, nor drafts;
    - `?materia=DIRITTO_PENALE` filters.
  - **Voting:**
    - Carol and Dave approve, so the card becomes `VALIDATA`;
    - Carol «errata» with a reason archives it;
    - «migliorabile» without a reason gets 400;
    - voting on one's own card gets 403;
    - a second vote gets 409;
    - a vote on a draft gets 404.
  - **Review Focus 2:** two approvals sent with `Promise.all` leave exactly two votes and state `VALIDATA`. A vote sent after `ritira` gets 404 and leaves no vote.
  - **Review Focus 4:** Carol's flag is cleared between two calls, so her next vote gets 403.
  - **What the author sees:** Alice's `GET /:id` shows `approvazioni` and the «migliorabile» reason, without Carol's id.
  - **The article's cards:** Bob's `/api/lingo/articolo` on the URN of Alice's validated card returns it with `comunita: true, approvazioni: 2`, and never her drafts.
  - **The texts' versions:**
    - `GET /api/lingo/testi/PROPOSTA_SCHEDA` gives version 1 with `accettata: false`, then `true` after a proposal;
    - an administrator's POST creates version 2 with the administrator as author; version 1 is still listed and unchanged;
    - two POSTs sent together with `Promise.all`: one 201, one 409, and version 2 exists once;
    - a non-admin gets 403 on both admin routes; an unknown key gets 404; an unknown body key, 400;
    - a body holding `<script>` is stored and returned as the same literal string.
  - **Tokens:** an exchanged token gets 403 on `proponi`, `ritira`, `coda`, the vote, `/api/lingo/testi` and the admin routes.
  - **Unauthenticated:** add the rows.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: Implement.** The vote's transaction:

```ts
await prisma.$transaction(async (tx) => {
  const voter = await tx.user.findUnique({ where: { id: req.user!.id }, select: { lingoValidatore: true } });
  if (!voter?.lingoValidatore) throw new AppError(403, 'Solo i validatori possono votare le schede.');
  const [card] = await tx.$queryRaw<{ autore_id: string | null; stato: LingoCardStato }[]>`
    SELECT autore_id, stato FROM lingo_cards WHERE id = ${cardId} FOR UPDATE`;
  if (!card || card.stato !== 'PROPOSTA_COMMUNITY') throw new AppError(404, 'Scheda non in attesa di validazione.');
  if (card.autore_id === req.user!.id) throw new AppError(403, 'Non puoi validare una tua scheda.');
  const already = await tx.lingoValidazioneCard.findFirst({ where: { cardId, utenteId: req.user!.id } });
  if (already) throw new AppError(409, 'Hai già votato questa scheda.');
  await tx.lingoValidazioneCard.create({ data: { cardId, utenteId: req.user!.id, giudizio, motivazione } });
  const votes = await tx.lingoValidazioneCard.findMany({ where: { cardId }, select: { giudizio: true } });
  const stato = stateAfterVotes(votes.map((v) => v.giudizio));
  if (stato !== card.stato) await tx.lingoCard.update({ where: { id: cardId }, data: { stato } });
  return stato;
});
```

  `ritira` locks the same row, checks the author and `PROPOSTA_COMMUNITY`, deletes the votes and sets the draft state, in one transaction. `proponi`, in one transaction: lock the card row, check author and draft, read `currentText(tx, 'PROPOSTA_SCHEDA')`; if `hasAccepted` is false, require `accettoTestoId === current.id` and create the acceptance, or answer 409 with the current version; then set the state and `propostaTestoId`. The admin's POST reads the highest `versione` and inserts `versione + 1`; a unique violation on `(chiave, versione)` (Prisma `P2002`) answers 409.
- [ ] **Step 4: Run the whole server suite alone, and the build.**
- [ ] **Step 5: Commit:** `feat(server): proposing a card under the current notice, withdrawing it, the validators' queue and vote, and the admin's versions of the texts`.

### Task B4: Proposing and withdrawing in the web app; the admin's texts and checkbox

**Files:**
- Create: `apps/web/src/components/features/studia/AcceptTextDialog.tsx`, `apps/web/src/components/features/admin/StudiaTextsAdmin.tsx` (or next to the admin page's other sections, following its layout)
- Modify: `CardDetail.tsx`, `studiaService.ts` (`propose`, `withdraw`, `text`), `services/adminService.ts` (or the admin page's service: `studiaTexts`, `saveStudiaText`), `types/studia.ts` (`approvazioni`, `rilievi`, `comunita`, `TestoDaAccettare`), `ArticleCardsPeek.tsx`, `pages/AdminPage.tsx` (the texts section, the validator checkbox)
- Test: `AcceptTextDialog.test.tsx`, `StudiaTextsAdmin.test.tsx`, `CardDetail.test.tsx`, the admin page test

**Interfaces:**
- Produces:
  - `type TestoDaAccettare = { id: string; chiave: 'PROPOSTA_SCHEDA'; versione: number; titolo: string; corpo: string; conferma: string; azione: string }`;
  - `studiaService.propose(id, accettoTestoId?: string)`, which returns `Scheda | { richiedeTesto: TestoDaAccettare }`, and `studiaService.withdraw(id)`, which returns `Scheda`;
  - `<AcceptTextDialog text={TestoDaAccettare} onAccept={(id: string) => void} onCancel />`, the one place a text to accept is drawn (the simulation will reuse it).

- [ ] **Step 1: Write the failing tests.**
  - «Proponi alla comunità» on a draft, with the service answering `richiedeTesto`, opens `AcceptTextDialog` with that version's title, body, checkbox and button labels; nothing of the wording comes from the web app's code (the test passes a made-up text and finds it).
  - The body «Uno.\n\nDue.» renders as two paragraphs; `<b>x</b>` in the body renders as literal text.
  - The button is disabled until the box is ticked. Accepting calls `propose(id, text.id)` and shows «Scheda proposta alla comunità»; if the answer is `richiedeTesto` again (a new version meanwhile), the dialog shows the new version.
  - In the admin page, «Testi di VisuaLex Studia» shows the current version of each text in a form with a preview; «Salva come nuova versione» asks through `ConfirmDialog` with the wording of spec §6 and posts; the earlier versions are listed newest first with number, date and author, and open read-only; a 409 shows «Un'altra versione è stata salvata nel frattempo: ricarica».
  - «Ritira» on a proposed card, through `ConfirmDialog` («La scheda torna una tua bozza; i voti ricevuti si perdono.»), shows «Proposta ritirata: la scheda è di nuovo una bozza».
  - The detail of a proposed card lists the reasons under «Rilievi dei validatori», without names.
  - The Peek shows «Validata da 2» on a community card.
  - The admin's user row has a «Validatore di VisuaLex Studia» checkbox that sends `lingoValidatore`.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass, build, lint.**
- [ ] **Step 5: Commit:** `feat(web): propose a card under the current notice, withdraw it, read the validators' remarks; the admin edits the texts' versions and names validators`.

### Task B5: «Da validare»

**Files:**
- Create: `apps/web/src/components/features/studia/ValidationQueueView.tsx`, `useValidationQueue.ts`, `VoteBar.tsx`
- Modify: `App.tsx` (`studia/valida`), `StudiaPage.tsx` (the link only for validators: `GET /auth/me` returns `lingoValidatore`; add it to the server's `me` serialiser and to the web user type), `studiaService.ts` (`queue`, `vote`)
- Test: `ValidationQueueView.test.tsx`

- [ ] **Step 1: Write the failing tests.**
  - The first card shows with its anchors, and the primary article is rendered read-only beside it (on a narrow viewport, in a collapsed section «Testo dell'articolo» under the card).
  - «Approvata» sends the vote and shows the next card.
  - «Migliorabile» and «Errata» first open a required reason field («Scrivi il motivo»), then send.
  - The subject filter is remembered in `localStorage` (inside try/catch) and used on the next visit.
  - When the queue is empty: «Nessuna scheda da validare in questa materia».
  - A 403 from the server (demoted) shows «Non sei più tra i validatori» and stops.
  - The link «Da validare» is absent for a non-validator.
- [ ] **Step 2: Fail. Step 3: Implement.** The article is the reader's article component in read-only mode, as `dossier/DossierItemReader.tsx` embeds it, loaded with the anchor's URN. **Step 4: Pass, build, lint.**
- [ ] **Step 5: Commit:** `feat(web): the validators' queue, one card at a time beside its article`.

### Task B6: Docs, browser pass, review, PR B

- [ ] Update `apps/server/CLAUDE.md` (validation, the rule module, the texts to accept and their versions, the deletion and export keys, the `User` flag) and `apps/web/CLAUDE.md` (the queue, `AcceptTextDialog`, the admin texts).
- [ ] Browser pass. As admin, make a second test user a validator. As the first user, propose a card and accept the notice. As admin, save version 2 of the notice: the first user's next proposal shows it again, and the first card still says version 1 in the database. As the validator, vote «migliorabile»; as the author, read the remark and withdraw. Propose again, approve twice with two validators, and see «Validata da 2» under the article for a third user. Repeat at phone width and in dark mode.
- [ ] Fresh `code-reviewer`; fix everything.
- [ ] PR (it touches the Prisma schema, the `User` model and the admin route), CI green, merge `merge: feat/studia-validation — study cards proposed to the community and validated by named validators`, then `prisma migrate deploy` on the development database.

---

## PR C — Review (`feat/studia-review`)

### Task C1: Review state, review log, the study preferences

**Files:**
- Modify: `apps/server/prisma/schema.prisma`, `apps/server/tests/setup.ts`, `apps/server/src/controllers/authController.ts` (export)
- Create: `apps/server/prisma/migrations/20261010100000_lingo_review/migration.sql`
- Test: `apps/server/tests/lingoAccountErasure.test.ts`, `apps/server/tests/accountData.test.ts`

**Interfaces:**
- Produces:
  - the models `LingoStatoRipasso` and `LingoRevisioneSRS`, exactly as spec §4 «PR C» writes them;
  - the model `LingoPreferenzeStudio` (`lingo_preferenze_studio`: `nuoveAlGiorno`, default 20; `materieComunita`, empty at first), as spec §4 «PR C» writes it;
  - the export keys `data.lingoRipassi` (the log rows with `cardId`, `dataRevisione`, `rating`, `scheduledDays` and `durataMs`) and `data.lingoPreferenze: { nuoveAlGiorno; materieComunita } | null`.

- [ ] **Step 1: Write the failing tests.**
  - Deleting a user removes their review state, log and preferences, and nobody else's.
  - Deleting a card removes everyone's reviews of it.
  - The export carries the log.
- [ ] **Step 2: Fail. Step 3: Schema, `migrate diff`, generate. Step 4: Pass; build; drift check.**
- [ ] **Step 5: Commit:** `feat(server): the review state and log of study cards, and the daily goal`.

### Task C2: What «today» is

**Files:**
- Create: `apps/server/src/lingo/studyDay.ts`
- Test: `apps/server/tests/unit/lingo/studyDay.test.ts`

**Interfaces:**
- Produces:

```ts
/** The calendar day in Europe/Rome as 'YYYY-MM-DD' (spec decision 18). */
export function romeDay(at: Date): string;
/** Whole calendar days from one Rome day to another (may be 0). */
export function daysBetween(fromDay: string, toDay: string): number;
/** 00:00 Europe/Rome of the day `days` after `day`, as an instant: what `dueAt` stores. */
export function startOfRomeDay(day: string, plusDays?: number): Date;
```

  Implemented with `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })` for `romeDay`. `daysBetween` uses `Date.UTC` on the two dates' parts, so it never sees the clock. For `startOfRomeDay`, take the guess `Date.UTC(y, m, d + plusDays)`, read Rome's offset at that instant from `Intl` (`timeZoneName: 'longOffset'`), and subtract it. One pass is exact, because Rome changes its clocks at 02:00 and 03:00, never around midnight. Never take the offset at noon: on a change day it differs from the one at midnight. No dependency is added.

- [ ] **Step 1: Write the failing tests (Review Focus 1).**
  - `romeDay(new Date('2026-10-07T21:59:00Z'))` is `'2026-10-07'`, and `'2026-10-07T22:01:00Z'` gives `'2026-10-08'` (CEST, UTC+2).
  - On 25 October 2026 (the clocks go back), `startOfRomeDay('2026-10-24', 1)` is `2026-10-24T22:00:00Z`, and `startOfRomeDay('2026-10-25', 1)` is `2026-10-25T23:00:00Z`.
  - `daysBetween('2026-10-24', '2026-10-26')` is `2` across the change.
  - On 29 March 2026 (the clocks go forward), the same checks hold.
  - The tests run with `process.env.TZ` set to `UTC` and to `America/New_York` (set in the test file before importing): same results.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Commit:** `feat(server): the study day is the calendar day in Rome, whatever the server's clock`.

### Task C3: The session, the review, the preferences

**Files:**
- Create: `apps/server/src/lingo/reviewQueue.ts`, `apps/server/src/routes/lingoSrs.ts` (mounted at `/api/lingo/srs`)
- Modify: `apps/server/src/routes/lingoCards.ts` (`dovuteOggi`, `prossimoRipasso`), `apps/server/src/app.ts`
- Test: `apps/server/tests/lingoSrs.routes.test.ts`, `apps/server/tests/unit/lingo/reviewQueue.test.ts`, `apps/server/tests/unauthenticated.test.ts`

**Interfaces:**
- Consumes: `review`, `nextIntervalDays` and `Rating` from `srs/fsrsEngine.ts`; `romeDay`, `daysBetween` and `startOfRomeDay`.
- Produces:
  - `reviewScope(userId, materieComunita, materia?)`, the Prisma `where` of decision 8: own cards in draft, proposed or validated; plus `VALIDATA` cards of other authors in the chosen subjects;
  - `previewIntervals(state: SrsState | null, elapsedDays: number)`, which returns `Record<Rating, number>`: the `scheduledDays` of `review(state, r, elapsedDays)` for each rating;
  - `GET /api/lingo/srs/sessione?materia=`, which answers `200 { conteggi: { dovute, nuove }, cards: Array<serialize(card) & { nuova: boolean; anteprima: Record<1|2|3|4, number> }> }`. Due cards come first, the earliest `dueAt` first. Then the new cards, oldest first, up to `nuoveAlGiorno` minus the cards introduced today; a card counts as introduced when its first log row is today.
  - `POST /api/lingo/srs/revisioni`, body `{ cardId, rating: 1|2|3|4, durataMs?: 0..3_600_000 }`, which answers `200 { registrata: boolean; prossimoRipasso: string /* YYYY-MM-DD */; scheduledDays }`.
  - `GET /api/lingo/srs/preferenze` and `PUT /api/lingo/srs/preferenze`, the latter with `{ nuoveAlGiorno?: 1..200, materieComunita?: Materia[] }`. Both return `{ nuoveAlGiorno, materieComunita }`.

- [ ] **Step 1: Write the failing tests.**
  - **The session:**
    - with 3 due and 30 new cards and a goal of 20, the session holds 3 due then 20 new, and the counts are `{ dovute: 3, nuove: 20 }`;
    - after grading 5 new cards, a second session has 15 new. the same user from a second session token (a second device) also has 15 new;
    - a «da rivedere» or archived own card never appears;
    - a community `VALIDATA` card appears only when its subject is switched on;
    - each card's `anteprima` equals `previewIntervals` on its state.
  - **The review:**
    - a first «Bene» on a new card creates the state with stability 2.4, difficulty 4.93 and `dueAt` two days later (the foundation's hand-computed values) plus one log row;
    - a second grade the same Rome day answers `registrata: false` and changes nothing;
    - after moving the clock to the next day (`vi.setSystemTime`), a grade uses `elapsedDays` from the Rome days;
    - `rating: 5` gets 400;
    - another user's draft gets 404.
  - **Review Focus 5:** a community card in the session list, set `DA_RIVEDERE` by Prisma before the grade, gets 404, nothing is written, and the next session does not list it.
  - **The list:** `GET /api/lingo/cards?dovuteOggi=true` returns only cards with `dueAt` up to today, and each card carries `prossimoRipasso`.
  - **Tokens:** an exchanged token gets 403 on the three paths.
  - **Unauthenticated:** add the rows.
- [ ] **Step 2: Fail. Step 3: Implement.** In the review transaction:
  1. lock the state row (`SELECT … FOR UPDATE`, or create it);
  2. re-check that the card is in scope;
  3. compare `romeDay(lastReviewAt)` with today;
  4. `review(previous, rating, daysBetween(lastDay, today))`;
  5. upsert the state with `dueAt = startOfRomeDay(today, scheduledDays)`, `reps + 1`, and `lapses + (rating === 1 && previous ? 1 : 0)`;
  6. append the log row.

  **Step 4: Run the whole suite alone, and the build.**
- [ ] **Step 5: Commit:** `feat(server): the review session of study cards, FSRS v4 grades and the daily goal`.

### Task C4: The review screen

**Files:**
- Create:
  - `apps/web/src/components/features/studia/ReviewSession.tsx`;
  - `ReviewCard.tsx` (the visual identity of spec §6);
  - `GradeBar.tsx`;
  - `useReviewSession.ts`;
  - `formatInterval.ts`.
- Modify: `apps/web/src/components/ui/KeyboardShortcutsModal.tsx` (a «Ripasso» group)
- Test: `useReviewSession.test.ts`, `ReviewSession.test.tsx`, `formatInterval.test.ts`

**Interfaces:**
- Produces:
  - `formatInterval(days: number): string`: 1 → «domani», 2–29 → «n giorni», 30–364 → «n mesi» (rounded), 365 and more → «n anni» (one decimal when under 10);
  - `useReviewSession(materia?)`, which returns `{ current: SessionCard | null; revealed; reveal(); grade(r: 1|2|3|4); remaining; done; summary: { reviewed; again; nextDue } }`.

- [ ] **Step 1: Write the failing tests.**
  - `formatInterval` follows its table.
  - `useReviewSession`:
    - space reveals; 1–4 grade only after reveal;
    - a first «Di nuovo» posts the review and requeues the card at the end;
    - a requeued card's later grade is **not** posted, and «Bene» on it removes it from the queue;
    - Esc asks «Interrompere il ripasso? Le schede già valutate restano registrate.»;
    - a failed post keeps the card and shows «Non registrato: riprova».
  - `ReviewSession`:
    - the question and answer render inside a serif container;
    - each button shows the interval as the larger text («3 giorni») and the grade as the smaller («Difficile»);
    - an anchor's link opens the article panel and the session stays;
    - the end screen reads «Hai ripassato 23 schede, 4 da rifare. Le prossime: domani.»;
    - with `prefers-reduced-motion` the reveal has no transition class.
- [ ] **Step 2: Fail. Step 3: Implement** to the visual direction of spec §6:
  - the anchor citation in small slate sans above the question;
  - the question in the reader's serif, one step larger than the answer;
  - a 60ch measure;
  - a hairline that draws on reveal, then the answer unfolding (180 ms, `motion-safe:` only);
  - the grade bar pinned at the bottom on a phone, with 44 px targets;
  - «Di nuovo» in the warning tone and the others neutral.

  **Step 4: Pass, build, lint.**
- [ ] **Step 5: Commit:** `feat(web): the review session — one card, the answer revealed, four grades with their intervals`.

### Task C5: The Ripasso landing, preferences, due dates in the list

**Files:**
- Create: `apps/web/src/components/features/studia/ReviewHome.tsx`, `StudyPreferences.tsx`
- Modify:
  - `App.tsx` (`studia/ripasso`, `studia/ripasso/sessione`, and `/studia` → `ripasso`);
  - `StudiaPage.tsx`;
  - `MyCardsView.tsx` and `CardFilters.tsx` («Da ripassare oggi», the next review date in each row);
  - `studiaService.ts` (`session`, `review`, `preferences`, `savePreferences`).
- Test: `ReviewHome.test.tsx`, `StudyPreferences.test.tsx`, `MyCardsView.test.tsx`

- [ ] **Step 1: Write the failing tests.**
  - The landing reads «Oggi: 18 da ripassare · 20 nuove» and «Inizia il ripasso»; choosing «Diritto penale» refetches the counts for that subject.
  - With nothing due and no new cards: «Per oggi hai finito. Le prossime schede tornano domani.»
  - In the preferences, the daily goal accepts 1–200 and refuses 0. The five community switches are off at first; switching «Diritto civile» on sends it and updates the counts.
  - In «Le mie schede», each row shows «Prossimo ripasso: 12 ottobre», and the «Da ripassare oggi» filter sends `dovuteOggi=true`.
  - `/studia` lands on Ripasso.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass, build, lint.**
- [ ] **Step 5: Commit:** `feat(web): the Ripasso view, the daily goal, community subjects and due dates in the list`.

### Task C6: Docs, browser pass, review, PR C

- [ ] Update `apps/server/CLAUDE.md` (the SRS routes, `studyDay`, the export key) and `apps/web/CLAUDE.md` (the review card's visual rule, the shortcuts).
- [ ] Browser pass:
  1. Review five cards with the keyboard; «Di nuovo» on one and see it come back.
  2. Leave, then come back: the counts have moved.
  3. Switch a community subject on.
  4. At 390 px, review with the thumb only.
  5. Repeat in dark mode.
- [ ] Run a fresh `code-reviewer` and fix everything.
- [ ] Open the PR (it touches the Prisma schema), wait for green CI, and merge with `merge: feat/studia-review — study cards reviewed with FSRS v4, a daily goal and community subjects`. Then run `prisma migrate deploy` on the development database.

## Later, each with its own plan

- **The exam simulation**, starting from spec §11. Its consent adds the key `CONSENSO_SIMULAZIONE` to the texts' store of PR B (one `ALTER TYPE … ADD VALUE`, version 1 seeded with the approved wording), drawn by `AcceptTextDialog`, and asked again before the next simulation whenever an administrator saves a new version.
- **The norm watcher for card anchors** (a validated card goes «da rivedere»), together with what a changed norm does to a *draft* (foundation decision 12).
- **RLCF** weighting, authority and the «controversa» flag replace `validationRule.ts`.
- **Fitting the FSRS weights** to the stored log.
- **An installable app**, if the phone use asks for it.
