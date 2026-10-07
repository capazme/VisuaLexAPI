# LingoLex foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the first stones of LingoLex, the study layer of OMNILEX: the bank of exam traces that the simulations and the correction draw on (Tasks 1–5), the spaced-repetition engine that schedules the study cards (Task 6), and the data layer of the cards themselves (Task 7). Database, pure logic and two read-only routes; no screen, and no route that writes.

**Architecture:** `LingoTraccia` (`lingo_tracce`) has no relation to any existing model, so its migration is purely additive; rows arrive through a strict import contract (`schemas/lingo/traccia.ts`) and a CLI importer (`utils/importLingoTracce.ts`) that refuses a file whole when one row is wrong or of unverified origin. Task 5 reads the bank through two routes that never serialise the answer key. Task 6 is one pure module with no database and no dependency. Task 7 adds two models (`LingoCard`, `LingoCardAncora`) and one back-relation line on `User`; the SQL of the migration touches no existing table, but the Prisma model of `User` does change.

**Tech Stack:** Prisma 5 (hand-written migration, generated offline with `prisma migrate diff`), Zod 3, Vitest.

**Spec:** the LingoLex specification is in the owners' private workspace (decisions D-035 on the perimeter and D-036 on the application server; D-016 on the unified repository). The repository is public: this plan cites decisions by ID and does not copy that text. The data model below is the specification's, with the deviations listed in Decisions.

**Measured on develop `66dabeb` (30 September 2026):** no LingoLex code, model, migration or branch. Server suite with this work: 53 files, 729 tests, green (8 files and 195 tests are new, against a base of 45 files and 534 tests); `npm run build` (`tsc`) clean.

## Global Constraints

- **Git flow:** branch `feat/lingolex-foundation` from `develop`; pull request into `develop`. The pull request description says it touches the Prisma schema and migrations, so that the other developer can read it (`CLAUDE.md`: his approval is expected there; nothing enforces it yet).
- **Commits, pushes and merges wait for the owner's go-ahead**, with the message proposed.
- **Migrations by hand**, never `prisma migrate dev`. This one was generated with `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new> --script`, which needs no database.
- **Nothing private enters the repository**, and **nothing of third parties**: the collections of exam traces found around are mostly other people's work. Real trace files live outside the repository until every row has a verified source; the repository holds the bank's structure and the tooling only.
- **Errors you surface in files you touch are fixed**, pre-existing ones too (see the drift noted below, which is in another table and is left for its own change).

## Decisions

Taken here, reversible, for the owner to overrule:

1. **Ids are `uuid()`**, as in all 31 models that have one, not `cuid()` as the specification writes it.
2. **The stored columns are the specification's**, nothing added. The provenance of a row (`provenienza`) is checked on import and **not stored**. If an audit after the import is wanted (which URL, which verification), add nullable `fonte_url` and `stato_utilizzo` columns: a one-line migration, better decided with the other developer.
3. **`LingoCardTipo` is created in Task 7**, and the open question is settled: it starts with the four kinds of the specification (`ISTITUTO_DEFINIZIONE`, `DISTINZIONE_CONCETTUALE`, `CASO_APPLICATIVO`, `REQUISITO_FORMA_ATTO`), knowing that more will come. It stays a database enum: a new kind is one additive `ALTER TYPE … ADD VALUE` migration, and the database keeps refusing a kind nobody declared. The alternative, a free string validated in Zod (as `sottoTipoAtto` is), would save that migration and lose the database's check; worth revisiting only if kinds start arriving faster than releases. Decided by the owner on 30 September.
4. **A trace's identity is its `chiave`.** Renaming a key in a later file creates a new row and leaves the old one behind; once simulations reference traces (they will, with `onDelete: Restrict`), an orphan cannot be deleted silently. A key is chosen once and kept.

Taken for Tasks 5–7, also reversible:

7. **No route carries the answer key.** `normeRiferimento`, `questioniForma` and `questioniSostanza` are what the correction compares an essay against: a candidate who can read them has the exam solved. The routes use an explicit `select`, not an `omit`, so that a column added later stays hidden until someone decides to show it. The list does not carry the text either; the detail does.
8. **Only `attiva` traces are visible.** An inactive one is absent from the list and answers 404 by id, the same as one that does not exist.
9. **The engine is FSRS v4 with its published default weights**, as the specification says (A3): forgetting curve `R = (1 + t / 9S)^-1`. It takes the weights, the requested retention and the maximum interval as options, so that fitting it to the users' own reviews later is a parameter and not a rewrite. A move to a newer FSRS changes the meaning of every stored stability, so it is decided once and not drifted into.
10. **The engine has no learning steps in minutes.** The specification's review record keeps days to the next review, stability and difficulty, and nothing else.
11. **A card has exactly one primary anchor**; when none is marked, the first one is. At least one anchor is required, in the contract and again in the service.
12. **The card state machine is the specification's diagram, exactly:** draft → proposed → validated ⇄ to review, and proposed → archived. Left out because the diagram does not have them: archiving one's own draft, and what happens to a *draft* whose norm changes. To decide before the norm watcher is built.
13. **`LingoRevisioneSRS` and `LingoValidazioneCard` are not in this slice.** They arrive with the session routes and the validation flow that write them.
16. **`LingoCard` has an index on `autore_id`**, which the specification does not list: the cascade on account deletion and any "my cards" list read by author, and without it each is a scan of the table.
17. **`LingoCardAncora.isPrimary` defaults to `false` in the database**, where the specification has `true`. The rule is exactly one primary anchor per card (decision 11) and only `createLingoCard` enforces it; with a default of `true`, any future writer that forgets the flag (the norm watcher re-anchoring a card, an admin tool) would quietly add a second primary. A partial unique index (`UNIQUE (card_id) WHERE is_primary`) would enforce it in the database, but Prisma cannot express it in the schema and `migrate diff` would then report it as drift, so it is left for the day a second writer exists.
18. **A trace from third parties cannot be `ufficiale_verificato`** (found in review): the contract refuses `fonte: "terzi"` with that state, so a collection of someone else's work cannot pass the gate by being labelled official. It stays `da_verificare` or `escluso` until the trace is taken from the official source and imported from there. `originale` (written by the owners) and `ministero_giustizia` may be verified.
19. **Re-importing a key rewrites the text and the classification but not what a lawyer curates afterwards**: the answer key, the difficulty and the `attiva` flag are written on update only if the file itself names the field (found in review: the contract's defaults, applied to an update, would have emptied the answer key of every trace a later file does not mention it for).

To decide with the other developer:

5. Whether provenance is stored (decision 2).
6. Where the read routes for traces live. The specification puts them under `/api/lingo/simulazioni`; Task 5 follows it unless told otherwise.
14. **Settled by the owner on 2 October: what deleting an account does to its cards.** Validation is kept and personal data goes. The cards the community has taken up (proposed, validated, to review) stay with their state and anchors and lose only their author (`autoreId` becomes NULL; the foreign key is `SET NULL`, where the specification had `CASCADE`). The cards that belong to the person alone, drafts and archived, are deleted with the account. The same holds when an administrator deletes the user. The second half is done by the application (`lingo/deleteUserAccount.ts`, one transaction with the user's deletion), because the database cannot tell a draft from a validated card: deleting the user row by hand leaves the drafts behind, anonymous. Both readings were confirmed by the owner on 2 October: *proposed* cards count as taken up by the community (validators may already have voted), and *archived* ones, turned down by the validators, count as personal; each is one word in `PERSONAL_STATES`. Anonymity here is of the account: the text of a kept card is the author's writing, and if it names someone it still does.
15. **The account export** (`GET /auth/export`) includes the user's cards, in every state, with their anchors (`data.lingoCards`). The payload stays at `schemaVersion` 1: a key was added and none changed.

**Noticed, not part of this change:** `prisma migrate diff` between the migrated test database and `schema.prisma` reports one difference, in `merlt_qa_jobs.updated_at` (the migration gives it `DEFAULT now()`; the schema, with `@updatedAt`, says no default). Harmless in practice, since Prisma sets the value itself, and it predates this work. A separate `ALTER TABLE … DROP DEFAULT` migration would clear it.

## Review Focus

1. **Unverified origin landing by omission.** Only `statoUtilizzo: "ufficiale_verificato"` rows enter; a file with any other row writes nothing, even with `--apply`. Test `refuses a row whose source is not verified as official`, and the CLI run with `--apply` on such a file exits 1.
2. **A partial import.** All or nothing: one invalid, duplicated or unverified row refuses the file and names every such row. Tests `refuses the whole file…`.
3. **Duplicates on re-import.** The id derives from the key: importing twice updates in place. Test `importing the same file twice…`.
4. **Contract drift in the cleaning output.** Every object is `.strict()`: an unknown key (a stray third-party solution, a renamed column) stops the import. Test `rejects a key the contract does not know`.
5. **The answer key leaking.** A trace with `normeRiferimento` and `questioni*` set: neither the list nor the detail response has those keys. Task 5, `never serialises the answer key`.
6. **An inactive trace reachable by id.** Task 5: 404, and absent from the list.
7. **An abusive list request.** `limit` over 100 or below 1, a negative `offset`, an unknown subject: 400. The default page is 50. Task 5.
8. **Numeric garbage into the engine.** A rating outside 1–4 or not an integer, negative or non-finite elapsed days, a retention outside (0, 1): `RangeError`. A ten-year gap, or an extreme stability, still gives a finite result; the interval is never under 1 day nor over the maximum. Task 6.
9. **A card without a norm.** Zero anchors, a fingerprint that is not 64 hexadecimal characters, two primaries: refused, and nothing is written (one nested write). Task 7.
10. **Skipping validation.** Draft → validated is refused, and nothing leaves archived. Task 7, `canTransition`.
11. **Deleting an author.** Drafts and archived cards go with the account; proposed, validated and to-review cards stay, without an author (decision 14). Task 7b.

---

### Task 1: The model and its migration

**Files:** `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/20260930200000_add_lingo_tracce/migration.sql`, `apps/server/tests/setup.ts` (the table joins the per-test truncation).

- [x] Two enums (`LingoMateria`, `LingoTipoProva`) and `LingoTraccia`, with snake_case column maps like the rest of the schema.
- [x] Migration generated offline, purely additive (two types, one table, one index).
- [x] Applied by the suite's `prisma migrate reset` on the test database; `migrate diff` shows no difference on the Lingo table.

### Task 2: The import contract

**Files:** `apps/server/src/schemas/lingo/traccia.ts`, `apps/server/tests/unit/lingo/traccia.schema.test.ts`.

- [x] `lingoTracciaImportRowSchema` (strict), `isImportable`, `tracciaIdFromChiave`.
- [x] Enums come from `@prisma/client`, so the contract cannot drift from the database.

### Task 3: The importer

**Files:** `apps/server/src/utils/importLingoTracce.ts`, `apps/server/tests/lingoTracceImport.test.ts`, and `apps/server/tests/lingoTracceImport.cli.test.ts` for the command line's exit codes (`runImportCli`).

- [x] `importLingoTracce(input, { apply })`: dry run by default in the CLI, all-or-nothing, report of created, updated and rejected rows.
- [x] The report counts the rows by subject, kind of test and source (`summary`), which is what reading the first real dry run needs.
- [x] CLI checked by hand against the test database: a valid sample file (dry run) and a file with an unverified row with `--apply` (refused, exit 1).

### Task 4: The first real file

**Waiting on the data and on two decisions, not on the code.** The order matters:

- [ ] The data-cleaning work delivers a file outside the repository, every row marked `da_verificare`.
- [ ] The owner reads the Ministry's terms of reuse and decides. Only then are the Ministry's rows promoted to `ufficiale_verificato`, by the script the cleaning work prepares (it needs an explicit flag and writes a new file).
- [ ] Dry run on the test database; read the report (new and already present rows, counts by subject, kind of test and session).
- [ ] This branch is merged into `develop`, migration included; `npx prisma migrate deploy` on the development database; dry run there, then `--apply`.

Why not apply earlier: a migration applied to the development database from an unmerged branch leaves that database ahead of `develop`, whose `prisma migrate status` would then flag a migration it does not know, and the forbidden `migrate dev` would offer to reset it.

**Execution order of Tasks 5–7: 6, 5, 7.** The pure module first, the read route second, the schema change (the one that touches an existing model) last, so that the two safe pieces are finished and green before it. Each task: failing tests, run, implement, run, `tsc`; then one fresh reviewer over the whole branch. The tests share one database and each run resets it, so the tasks are run one after the other, never in parallel.

### Task 6: The spaced-repetition engine

**Files:** create `apps/server/src/srs/fsrsEngine.ts`, `apps/server/tests/unit/srs/fsrsEngine.test.ts`. A differential check against a reference library runs in a scratch directory outside the repository; the library is not added to the project.

**Interfaces** (produces; nothing consumes them yet — the session routes will):

```ts
export type Rating = 1 | 2 | 3 | 4; // again, hard, good, easy
export interface SrsState { stability: number; difficulty: number }
export interface SrsOptions { weights?: readonly number[]; requestRetention?: number; maximumInterval?: number }
export interface ReviewResult extends SrsState { scheduledDays: number; retrievability: number | null }
export const DEFAULT_WEIGHTS: readonly number[]; // the 17 published FSRS v4 defaults
export function retrievability(elapsedDays: number, stability: number): number;
export function nextIntervalDays(stability: number, options?: SrsOptions): number;
export function review(previous: SrsState | null, rating: Rating, elapsedDays: number, options?: SrsOptions): ReviewResult;
```

The formulas (FSRS v4, `w` = the weights, `G` = the rating, `clamp` keeps difficulty in 1–10):

- first review (`previous === null`): `S = max(w[G-1], 0.1)`, `D = clamp(w4 − w5·(G−3))`; `retrievability` is `null`.
- `R = (1 + t / (9S))^-1`, with `t` the elapsed days.
- `D′ = clamp(w7·w4 + (1−w7)·(D − w6·(G−3)))`, **rounded to two decimals** at every step, as the reference implementations do.
- recall (`G ≥ 2`): `S′ = S·(1 + e^w8 · (11−D′) · S^−w9 · (e^(w10·(1−R)) − 1) · (G=2 ? w15 : 1) · (G=4 ? w16 : 1))`, with the difficulty **after** this review's update `D′`.
- lapse (`G = 1`): `S′ = w11 · D′^−w12 · ((S+1)^w13 − 1) · e^(w14·(1−R))`, again with `D′`.
- stability is floored at 0.01 so that degenerate input can never produce a zero or a NaN downstream.
- interval: `round(9·S·(1/r − 1))`, at least 1 day, at most `maximumInterval`; defaults `r = 0.9`, maximum 36500.

The reference is `ts-fsrs@3.0.0`, which is FSRS v4 proper. (Checked 30 September: `ts-fsrs@3.5.7` is **FSRS 4.5**, with another forgetting curve and other default weights; it is not the specification's algorithm.) The learning steps in minutes and the reordering of the four options' intervals that the library does are scheduler behaviour, not the algorithm, and are left out (decision 10).

**Done (30 September): Steps 1–5.** Step 5 result: against `ts-fsrs@3.0.0` the engine agrees **bit for bit** (compared with `!==`, no tolerance) on the 4 first reviews, on 100,000 later reviews (25,000 random states, stability 0.1–3000, difficulty 1–10, 0–400 days, times the four ratings) and on 100,000 intervals: no difference in stability, difficulty or interval. Rerun after the review's guards were added. A negative control (one weight moved by 0.01) produces 74,841 mismatches, up to 4.8% on stability, so the comparison can fail. Two things the reference taught that the plan had wrong and are now fixed above: the stability update uses the *new* difficulty, and difficulty is rounded to two decimals at each step.

- [x] **Step 1:** write `fsrsEngine.test.ts`: hand-computed first reviews (Good: stability 2.4, difficulty 4.93, interval 2 days); a second Good review after 2 days against the formula written out in the test; properties (Again shrinks stability, Easy ≥ Good ≥ Hard ≥ Again on the same state, difficulty stays in 1–10 over a long run of Again, retrievability falls as time passes and is 1 at zero, interval grows with stability and with a higher requested retention it shortens); the guards of Review Focus 8.
- [x] **Step 2:** run it, see it fail (module missing).
- [x] **Step 3:** implement the module.
- [x] **Step 4:** run it, see it pass; `npm --prefix apps/server run build`.
- [x] **Step 5:** in a scratch directory install the reference library (`ts-fsrs@3.0.0`, FSRS v4) and compare the engine against it over thousands of random states (stability, difficulty, elapsed days) and all four ratings, for the first review and the later ones; the intervals are compared through the library's own `next_interval` on the same stability. Write the result into this task.

### Task 5: Read access to the bank

**Files:** create `apps/server/src/schemas/lingo/tracciaQuery.ts`, `apps/server/src/controllers/lingoTracceController.ts`, `apps/server/src/routes/lingoSimulazioni.ts`, `apps/server/tests/lingoTracce.routes.test.ts`; modify `apps/server/src/app.ts` (mount at `/api/lingo/simulazioni`), `apps/server/tests/unauthenticated.test.ts` (two rows), `apps/server/CLAUDE.md`.

**Interfaces** (produces):

- `GET /api/lingo/simulazioni/tracce?materia=&tipoProva=&sottoTipoAtto=&limit=&offset=` → `200 { items: TracciaSummary[], total, limit, offset }`; `limit` defaults to 50 (1–100), `offset` to 0; ordered by `fonteTraccia` descending (newest session first), then `materia`, `tipoProva`, `titolo`.
- `GET /api/lingo/simulazioni/tracce/:id` → `200 TracciaDetail`, `404` if absent or inactive.
- `TracciaSummary = { id, materia, tipoProva, sottoTipoAtto, titolo, fonteTraccia, difficolta }`; `TracciaDetail = TracciaSummary & { testoTraccia }`. Nothing else is ever serialised (decision 7).
- Both behind `authenticate` at router level, like every other router; the errors are thrown (`ZodError`, `AppError`) and left to `errorHandler`.

**Done (30 September): Steps 1–5, the route tests plus the two rows of `unauthenticated.test.ts`.** Mounted before the catch-all routers (see the comment in `app.ts`), so a request authenticates once. A negative control on the answer-key tests: adding `questioniSostanza` to the `select` makes 4 tests fail; removed, all pass.

- [x] **Step 1:** write `lingoTracce.routes.test.ts`: 401 without a token (list and detail); the list returns active traces, newest session first, with `total`, and no text; filters by subject, kind of test and kind of act; `limit` and `offset` paginate and the default page is 50; the detail carries the text; `never serialises the answer key` (list and detail, on a trace that has `normeRiferimento` and `questioni*` set); an inactive trace is absent from the list and 404 by id; an unknown id is 404; 400 for an unknown subject, `limit` 0 and 101, a negative `offset`. Add the two routes to `unauthenticated.test.ts`.
- [x] **Step 2:** run it, see it fail (routes missing, 404).
- [x] **Step 3:** implement the query schema, the controller and the router; mount it.
- [x] **Step 4:** run it, see it pass; `npm --prefix apps/server run build`.
- [x] **Step 5:** update `apps/server/CLAUDE.md`: the routes, the answer-key rule.

### Task 7: The data layer of the cards

**Files:** modify `apps/server/prisma/schema.prisma` (two enums, two models, `lingoCards LingoCard[]` on `User`), `apps/server/tests/setup.ts`, `apps/server/CLAUDE.md`; create `apps/server/prisma/migrations/20260930210000_add_lingo_cards/migration.sql` (generated offline with `migrate diff` from the schema before this task), `apps/server/src/schemas/lingo/card.ts`, `apps/server/src/lingo/cardStates.ts`, `apps/server/src/lingo/cards.ts`, `apps/server/tests/unit/lingo/card.schema.test.ts`, `apps/server/tests/unit/lingo/cardStates.test.ts`, `apps/server/tests/lingoCards.test.ts`.

**Interfaces** (produces):

```ts
// schemas/lingo/card.ts — every object .strict()
export const lingoCardAncoraInputSchema;   // normaKey, articleId, urn, aknFingerprint (64 hex), isPrimary (default false)
export const lingoCardCreateSchema;        // materia, istituto, tipo (default ISTITUTO_DEFINIZIONE), domanda, risposta, spiegazione?, ancore (1–10, at most one primary)
export type LingoCardCreateInput = z.infer<typeof lingoCardCreateSchema>;
// lingo/cardStates.ts
export function allowedTransitions(from: LingoCardStato): readonly LingoCardStato[];
export function canTransition(from: LingoCardStato, to: LingoCardStato): boolean;
// lingo/cards.ts
export async function createLingoCard(authorId: string, input: unknown): Promise<LingoCard & { ancore: LingoCardAncora[] }>;
```

Models as in the specification: `LingoCard` (`lingo_cards`: author, subject, institute, kind, question, answer, explanation, state `BOZZA_PERSONALE` by default, `authorityScore` 0, `isControversa` false) and `LingoCardAncora` (`lingo_card_ancore`: norm key, article id, URN, fingerprint, primary flag, last check), the anchors cascading from the card, and the author optional (`SET NULL`, see decision 14 and Task 7b).

**Done (30 September): Steps 1–6, tests in the three files.** The schema diff is additive only (118 lines added, none changed: the schema was deliberately *not* run through `prisma format`, which would have realigned 86 untouched lines of a file the other developer reads). The migration's only contact with an existing table is the foreign key from `lingo_cards` to `users`. After the migrations the drift check shows the one known difference, in `merlt_qa_jobs`, and nothing on the Lingo tables.

- [x] **Step 1:** save the current schema to the scratch directory; write the three test files: the contract (accepts a minimal card, defaults, zero anchors, more than ten, a short or non-hex fingerprint, two primaries, unknown key, lengths); the state machine (each arrow of the diagram allowed, draft → validated refused, nothing out of archived, nothing to itself); the service (creates a card in `BOZZA_PERSONALE` with its anchors, the first anchor primary when none is marked, refuses zero anchors and writes nothing, deleting the author deletes the card and its anchors).
- [x] **Step 2:** run them, see them fail.
- [x] **Step 3:** edit the schema, generate the migration with `prisma migrate diff`, `prisma generate`; add the tables to the truncation in `tests/setup.ts`.
- [x] **Step 4:** implement the contract, the state machine and the service.
- [x] **Step 5:** run them, see them pass; `npm --prefix apps/server run build`; the drift check (`prisma migrate diff` from the migrated test database to the schema shows only the known `merlt_qa_jobs` difference).
- [x] **Step 6:** update `apps/server/CLAUDE.md`.

### Task 7b: Deleting an account (a separate change, stacked on this one)

**Files:** modify `apps/server/prisma/schema.prisma` (the author optional, `SET NULL`), `apps/server/src/controllers/authController.ts` (deletion and export), `apps/server/src/controllers/adminController.ts` (deletion), `apps/server/tests/lingoCards.test.ts`, `apps/server/CLAUDE.md`; create `apps/server/prisma/migrations/20261002100000_lingo_card_author_set_null/migration.sql`, `apps/server/src/lingo/deleteUserAccount.ts`, `apps/server/tests/lingoAccountErasure.test.ts`.

**Interfaces** (produces): `deleteUserAccount(userId: string): Promise<void>` — one transaction: delete the user's drafts and archived cards (their anchors cascade), then the user (the foreign key anonymises the rest); `GET /api/auth/export` gains `data.lingoCards`.

- [x] Tests first: both ways of deleting (the user's own and the administrator's) keep the proposed, validated and to-review cards without an author and with their anchors, remove drafts and archived ones, touch nobody else's card, and leave no trace of the person in what remains; a refused deletion leaves the cards alone; the export has the user's own cards in every state and nobody else's.
- [x] Schema, migration (generated offline, three statements on a table with no rows), the shared function, both controllers, the export.
- [x] The earlier pin of the cascade in `lingoCards.test.ts` now says the opposite: the database alone never takes a card with it.

### Closing gates

- [x] Full server suite green (`npm --prefix apps/server test`: 53 files, 729 tests), `tsc` clean, the drift check as above (only the known `merlt_qa_jobs` difference).
- [x] One fresh reviewer (the `code-reviewer` agent, read-only, no database) over the whole branch against this plan. No blocker; the answer key, mass assignment, authorisation and the migrations came back clean. Its findings and what became of them:
  - Fixed: a row with `fonte: "terzi"` and `statoUtilizzo: "ufficiale_verificato"` passed the gate (decision 18); a re-import emptied the answer key of rows the file did not mention it for (decision 19); `offset=1e20` was a 500 instead of a 400 (now capped at 100000); `is_primary` defaulted to `true` in the database against the contract's `false` (decision 17); the engine could still hand back a NaN with extreme custom weights, and its exported helpers had no guards; the stale schema comment; no test for the command line's exit codes, nor for a stored stability of `1e300`.
  - Recorded, not changed: the admin deletion of a user cascades to their cards too (added to decision 14); a partial unique index for "one primary anchor" (decision 17).
  - Not a defect: the "bit for bit" claim was read off a script with a 1e-9 tolerance; the script now compares with `!==` and still finds no difference.
- [ ] Proposed commit message(s) to the owner; nothing is committed before the go-ahead.

### Later, each with its own plan

The simulation with its server-side timer and draft saving, the correction pipeline, `LingoRevisioneSRS` with the session routes, the validation flow and the reputation ledger, the card routes (`/api/lingo/cards`) and the application MCP server (`apps/mcp/`, D-036 and D-037, a separate line of work that this slice does not depend on).

Since then: the card routes and the MCP server were built (MCP second round, `docs/superpowers/specs/2026-10-04-mcp-second-round-design.md`); the screens, the validation flow and `LingoRevisioneSRS` are specified in `docs/superpowers/specs/2026-10-07-studia-cards-screens-design.md`. For the simulation, the owner decided on 2 October that it happens in VisuaLex's editor, that the reader shows only norms and case law during it, and that the AI correction comes at once, marked «non verificata»; his answers of 7 October on duration, editor, lost connection, access to essays and traces are in that spec's §11, some still to confirm with the other developer.
