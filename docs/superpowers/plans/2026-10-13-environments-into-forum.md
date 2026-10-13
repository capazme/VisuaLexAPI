# Plan: «Ambienti» into the Forum, dossiers of work and of study, «Pubblica nel Forum»

Spec: `docs/superpowers/specs/2026-10-13-environments-into-forum-design.md`. Three PRs of code into `develop`, each
task reviewed before the next. Code starts after the dossier session's PRs are merged and the owner has answered
Q1–Q8; the tasks assume the recommended answers and change where he chose otherwise.

## Global constraints

- Root rule 23: notes and highlights travel with `(startOffset, text)` byte for byte; no trim, no normalisation;
  dedupe by exact equality; preview text is plain text.
- Nothing published that the preview did not show: preview rows and payload come from one pure function.
- The server trusts no Forum content: D6's allow-list on every write and every read.
- No data loss: the migration only adds; no environment or Forum row is rewritten or deleted by code in this round.
- MCP tool names unchanged; `delegatedRoutes.ts` unchanged.
- The four MERL-T Forum events unchanged (names, payload, consent gate); nothing reads `originalAuthorId` (#154).
- Code identifiers `SharedEnvironment`, `features/bulletin`, `sharedEnvId` stay.
- Server tests on `visualex_test_forum` only; one suite at a time; `uptime` first.
- UI copy in Italian; code, comments and docs in English; 44 px targets on a phone.

## PR 1 — `feat/dossier-kind-forum-server` (apps/server)

**Task 1.1 — the migration and the kind.** Announce the migration to the orchestrator and take the name it assigns.
`DossierKind`, `dossiers.kind` default `lavoro`, `shared_environments.source_dossier_id TEXT` (SetNull, partial unique
index), `withdrawn_by_admin_at`; by hand, `migrate deploy` on the test DB, then on a copy of the dev DB with row counts
before and after. Dossier create/update accept `kind`; serializers return it and `published`; the trash restore keeps
it.
Tests: CRUD with and without `kind`; `published` for none/active/withdrawn; a study dossier trashed and restored; the
counts.
Commit: `feat(server): a dossier is of work or of study, and knows its published copy`.

**Task 1.2 — the allow-list, publishing from a dossier, withdrawal that hides.** `utils/publishedContent.ts`
(validate and pick per row, fresh ids renumbered consistently, caps) on publish, update, restore and every read
(list, detail, download, versions); `sourceDossierId` (404 for a foreign dossier, 409 on a second publish and on
P2002, never changed by update or restore, `coexist` refused); one dossier and no quick norms or aliases when
publishing from a dossier; `isActive` on detail, like, download, versions, new suggestion, added items (owner and
admin exempt); the admin's withdrawal stamped and not republishable by the author; Italian messages for the daily
limit and the refusals.
Tests: each dropped field per kind of row, on each write and read; ids renumbered with `aboutItemId` following;
offsets and text unchanged byte for byte; each route on a withdrawn item for owner, other, admin; republish after
an admin withdrawal refused.
Commit: `fix(server): Forum content carries no personal fields, and a withdrawn item is hidden`.

**Task 1.3 — one import path.** `services/studyImport.ts` (validate and rebuild, refused rows counted, existing
labels/triggers/notes/highlights read for the skips, one transaction); the shared note mapper (decision keys
`<decisionKey>::art::`, `endOffset` from the text's length) also used by the take, whose taken dossier becomes
`studio`; `POST /shared-environments/:id/download` with a body (no body → today's answer, filtered);
`POST /environments/:id/recover`; `POST /dossiers/import-study` (size cap).
Tests: a published dossier and a legacy environment downloaded (study dossiers, attribution on dossiers, notes and
highlights; keys as the web reads them); exact dedupe on a second download; a refused legacy entry skipped and
counted; a database error rolls everything back; the take's note on a decision now under its key; recover and
import-study.
Commit: `feat(server): Forum downloads, recovered environments and packs become study dossiers in one request`.

PR: `merge: feat/dossier-kind-forum-server — dossiers of work and of study; the Forum's content filtered and
imported by the server`.

## PR 2 — `feat/publish-dossier` (apps/web, apps/mcp)

**Task 2.1 — the kind on the web and in MCP.** Type, service, store; create and edit dialogs; list filter and label;
`omnilex_crea_dossier` `tipo`, the kind in `elenca`/`leggi`.
Tests: dialogs, filter, store round-trip; MCP schema and output; `tools.test.ts` names.
Commit: `feat: a dossier di lavoro or di studio, on the site and for connected apps`.

**Task 2.2 — «Pubblica nel Forum».** `utils/dossierPublication.ts` (pure): entries rebuilt through
`utils/sources/normEntry.ts` → keys → notes and highlights fetched by key (`getByNormaKeyPrefix`) → content and
preview rows; the overlap with dossiers di lavoro. `PublishDossierDialog` (preview, switches, per-row exclusion, D5's
check and the lavoro line, 409 → «Aggiorna»); the header's published state with Aggiorna / Ritira / Elimina / Apri nel
Forum; phone sheet.
Tests: notes of articles never opened are in; keys equal the server rebuild's (fixture shared with Task 1.3); decision
anchors; overlap rows start unchecked; preview rows = payload; the checkbox gates «Pubblica».
Commit: `feat(web): «Pubblica nel Forum» from the dossier, with a preview and a privacy check`.

PR: `merge: feat/publish-dossier — «Pubblica nel Forum» from the dossier; dossiers di lavoro and di studio`.
Browser pass: publish (one note also in a working dossier), update, withdraw, delete; desktop and 390 px.

## PR 3 — `feat/forum-absorbs-environments` (apps/web, apps/server)

**Task 3.1 — the Forum.** «Aggiungi ai miei dossier» (D8) replacing `ImportEnvironmentModal`, the toast with what
was skipped, `forum_download` after success; «Pubblica un dossier» with a picker; «I miei pubblicati»;
`EditSharedEnvironmentModal` reduced to metadata; `PublishEnvironmentModal` removed; one category list; the packs
(D12) from `exampleEnvironments.ts` re-typed, through `import-study`.
Commit: `feat(web): the Forum adds study dossiers, and offers ready-made ones`.

**Task 3.2 — Ambienti goes.** The archive (D11b) over `recover`; `/environments` → `/forum` and `?import=` (D11c) over
`import-study`; the page, its modals, `applyEnvironment`, `importEnvironmentPartial` and the other environment actions
removed; then the server routes `DELETE /annotations` and `DELETE /highlights` and their client methods; Sidebar
(coordinated through the orchestrator with the navigation session), tours, admin labels.
Commit: `refactor: «Ambienti» absorbed by the Forum; apply and replace removed`.

**Task 3.3 — docs.** Root and area `CLAUDE.md`, `docs/frontend/setup.md`, `docs/audit-local-readiness.md`,
`docs/merlt/claude-notes.md`.
Commit: `docs: dossiers of work and of study, and the Forum without environments`.

PR: `merge: feat/forum-absorbs-environments — Ambienti absorbed by the Forum; ready-made study dossiers`.
Browser pass: a pack added, a download from a second account, an archived environment recovered, an old link.

## Close

Drop `visualex_test_forum`. Handoff to the orchestrator: done, left, the owner's words, the PRs, the migration.
