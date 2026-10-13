# «Ambienti» into the Forum: dossiers of work, dossiers of study, «Pubblica nel Forum»

Date: 13 October 2026. Status: **proposal, waiting for the owner** on the questions at the end (Q1–Q8). The
direction is decided: the owner's document of 13 October («La voce "Ambienti" deve essere assorbita all'interno della
sezione "Forum"»; «distinguendo nettamente "dossier interni di lavoro", "dossier interni di studio" e "ambienti del
forum"»; «una funzione diretta per trasformare/convertire un dossier interno in ambiente condiviso nel forum»; «I futuri
ambienti dovranno consistere in dossier mantenuti privati finché l'utente non decida di pubblicarli nel forum,
contenenti note e versioni annotate ed evidenziate di norme, provvedimenti e sentenze»), and his «Sì» of 13 October to
«Ambienti disappears as a page of its own; the three names «dossier di lavoro», «dossier di studio» and «Forum»;
«Pubblica nel Forum» from the dossier; the examples become ready-made study dossiers». On privacy, for the AI apps:
«Per ora lasciamo stare la pseudonimizzazione, mettiamo un disclamer (non inserire dati personali o usare solo con AI
fidate)»; publishing carries the same risk.

Out of scope: the Lavora/Studia/Community selector (D-002, still under discussion); turning a dossier into a «case for
discussion» (waits for pseudonymisation); the MERL-T Forum events themselves (owned by the paused MERL-T
data-protection round, #153/#154).

## Today

Read from develop e08005eb.

- **An environment** (`Environment`, table `environments`; `/environments`, `features/environments/`) is a private
  snapshot of the workspace — dossiers, quick norms, aliases, and the notes and highlights *the browser has loaded*
  (they are fetched per article, so notes on articles not opened in the session are missing, silently) — in one JSON
  column the server does not validate (`content: z.any()`). It is created from the current state, refreshed from it
  («Aggiorna da stato corrente»), exported as JSON or a base64 link (`/environments?import=`), and **applied**
  client-side (`applyEnvironment`, `importEnvironmentPartial`):
  - *merge* skips a dossier whose title exists, dedupes quick norms by label and aliases by trigger, and re-posts
    every note and highlight with no dedup (duplicates on a second merge);
  - *replace* deletes every dossier, quick norm and alias one request at a time, then `DELETE /annotations` and
    `DELETE /highlights` (their only callers), then recreates — not transactional; a failure halfway leaves the
    workspace emptied. Quick norm, alias, note and highlight failures are dropped silently.
- **The Forum** (`SharedEnvironment`, `/forum`, `features/bulletin/`) lists published environments: likes, downloads,
  views, reports, versions (replace/coexist), suggestions (take/decline into the owner's own workspace), withdraw and
  republish. Its `content` has the same five keys.
- **Publishing takes three steps**: save the workspace as an environment, open the Forum, pick that environment in
  «Condividi ambiente» and fill a form. No preview of what becomes public, no warning. **The server strips nothing**:
  quick norms, aliases, notes and highlights are stored and served as sent — ids, `originalAuthor {id, username}`,
  usage counts — and the dossier object is kept whole (`{ ...dossier, items }`, `environmentDossiers.ts:64`): its
  private title, tags, colour, attribution. Only dossier entries are rebuilt. Restoring a version republishes old
  content unchecked.
- **Downloading** creates a *private environment* (not awaited; the success toast shows regardless); using it is a
  further «Applica».
- **Withdrawing does not hide**: detail, like, download, versions and adding items to a suggestion do not check
  `isActive`. An item the admin withdrew can be republished by its author.
- **Notes belong to an article, not to a dossier** (`Annotation`/`Highlight` keyed `<itemKey>::art::<articleId>`,
  `<decisionKey>::art::` for a decision). A note on art. 2043 c.c. shows in every dossier and reading of art. 2043.
- **The suggestion «take»** stores a note on a decision under an empty key (`articleId: ''` is falsy,
  `sharedEnvironmentController.ts:1102-1105`): invisible.
- **The examples** (`data/exampleEnvironments.ts`, client-only): 20 packs (GDPR, DORA, AI Act, Consumatori, the
  codes…), each 12–19 quick norms and 2–4 dossiers of articles, no notes. «Esempi» turns them into personal
  environments.
- **A dossier** has no kind, and never reaches the Forum except inside an environment or as a suggestion item.
- **MCP**: no tool mentions environments or the Forum.
- **MERL-T**: the web sends `forum_like`, `forum_download`, `forum_suggestion_accepted/declined`, keyed on the
  `SharedEnvironment` id (`sharedEnvId`), to `POST /api/merlt/events/forum-signal`, behind the consent guard.

## Decisions (proposed)

| # | Decision |
| --- | --- |
| D1 | **Three names.** «Dossier di lavoro» (a practice, a client's matter: may hold personal data); «Dossier di studio» (a topic studied: the examples, what comes from the Forum); «Forum» (what users publish). The Forum's items are **«dossier pubblicati»** (Q1); the word «ambiente» leaves the interface. Code identifiers stay (`SharedEnvironment`, `features/bulletin`, `sharedEnvId`): renaming tables and the MERL-T wire field is churn with no user benefit. |
| D2 | **A dossier carries a kind**: `lavoro` \| `studio`, default `lavoro`. Chosen when creating («Di lavoro» pre-selected), changed in «Modifica». The list: filter «Tutti · Di lavoro · Di studio», a label on each study dossier. Every existing dossier becomes `lavoro` — the cautious reading, since nothing tells which hold client matters. Forum downloads, the examples, recovered environments and a dossier taken from a suggestion become `studio`. The trash keeps the kind on restore. |
| D3 | **«Pubblica nel Forum» from the dossier, one dialog.** In the dossier's header (both kinds, Q5). Fields: title (the dossier's name, editable), description, category, tags. Then **the preview — exactly what will be sent**: every entry (citation and title), every note entry of the dossier in full, and the user's notes and highlights on those articles and decisions, **read from the server** for each entry's key (not from the browser's partial cache), text in full. Every note entry, note and highlight has a checkbox; two global switches «Note» and «Evidenziazioni». **A note or highlight on an article that also sits in one of the user's dossiers di lavoro starts unchecked**, marked «anche nel dossier di lavoro ‹nome›» (the name is shown to the user only). Then the privacy check (D5) and «Pubblica». One request. |
| D4 | **What a published dossier is**: a `SharedEnvironment` whose content holds one dossier — title, description and tags *as typed in the dialog* (never the private name), its entries, its note entries, a note's link to its entry (`aboutItemId`, ids renumbered) — plus the selected notes and highlights, no quick norms, no aliases. The keys that select notes are computed from the entries *as the server will rebuild them* (the web twin `utils/sources/normEntry.ts`), so a downloader's keys match. Anchors on a decision's withdrawn words are left out as today (`travellingSelection`). Exact keys only: a Brocardi section's notes are not included; an entry in its historical text carries the in-force text's notes, deduped if both versions are in the dossier. It records `sourceDossierId`. It is a **snapshot**: later work on the private dossier is published only by «Aggiorna la versione pubblicata» (same dialog, same preview, a new version in replace mode). Nothing syncs on its own. |
| D5 | **The privacy check** (wording for the owner, Q4). Above «Pubblica», in an amber box: «**Stai per rendere pubblico questo dossier.** Chiunque abbia un account VisuaLex potrà leggerlo e scaricarne una copia: il titolo, la descrizione, le voci, le note e le evidenziazioni spuntate qui sopra, con il tuo nome utente. Le note appartengono all'articolo, non al dossier: controlla anche quelle scritte per altre pratiche. Non pubblicare dati personali dei clienti o di altre persone, né fatti di una pratica che le rendano riconoscibili. Se ritiri il dossier dal Forum, chi l'ha già scaricato ne conserva la copia.» For a dossier di lavoro one more line first: «È un dossier di lavoro: controlla con attenzione titolo e note.» A required checkbox «Ho controllato: non contiene dati personali» enables «Pubblica». No pseudonymisation (owner, 13 Oct). |
| D6 | **The server never trusts Forum content: an allow-list that validates.** `utils/publishedContent.ts`, applied on publish, update and **version restore**, and **on every read** (list, detail, download, versions) so legacy items stop exposing what they carry without rewriting a row. Per row: the dossier (title ≤ 200, description, tags — bounded), entries (today's rebuild), notes (key and article id bounded, no `::art::` inside them; text; anchor text; `startOffset` a non-negative integer), highlights (same, colour from the known set), quick norms (label, search parameters), aliases (trigger, expansion); a cap on rows. Dropped: user ids, `originalAuthor`, `sourceSuggestionId`, `bookmarkId`, usage counts, MCP provenance (`createdByClient*`), colour, any other key. Row ids are **replaced by fresh ones, consistently** (a note's `aboutItemId` follows its entry) so the UI's keys still work. Root rule 23: no trim, no normalisation of text or anchor text. Publishing from a dossier further requires exactly one dossier and no quick norms or aliases; the switches must match the content. |
| D7 | **Withdrawing hides.** Detail, like, download, versions, a new suggestion and adding items to one answer 404 on a withdrawn item to anyone but its owner and the admin. The owner sees «Ritira dal Forum» and «Elimina dal Forum» in the dossier's header once published. An item **the admin** withdrew cannot be republished by its author (Q8): the admin's withdrawal after a report of personal data must hold. |
| D8 | **Downloading makes study dossiers, in one server request.** «Aggiungi ai miei dossier» on a Forum item: each dossier of the content becomes a `studio` dossier with the publisher as `originalAuthor` (the «da @utente» chip); if the user keeps the two switches on, the notes and highlights come too, also marked with the publisher, **skipping one identical to one the user has** (same key, offsets and text, compared exactly). They live on the article (D4): they show wherever the user reads it and outlive the study dossier; the chip tells them apart. Legacy items' quick norms and aliases come too, a label or trigger the user has being skipped. An entry the rebuild refuses (a legacy item) is skipped and counted, not fatal. The answer says what was created and what was skipped; the toast reports it and opens the new dossier. `forum_download` is sent after success, as today. No private environment is created any more. |
| D9 | **One import path on the server** (`services/studyImport.ts`) for D8, the archive (D10b), old links (D10c) and the packs (D11): validate and rebuild everything first (D6, refused rows counted), read the user's existing labels, triggers, notes and highlights for the skips, then create everything in one transaction — a database error rolls it all back, a skip never does. Notes are mapped by one shared function (`content` ← note text, `textContext` ← anchor text, `position` ← `startOffset`; a highlight's `endOffset` = `startOffset` + its text's length; a highlight without a valid `startOffset` skipped), which the suggestion «take» also uses, fixing its empty-key bug. |
| D10 | **Apply and replace go.** «Sostituisci tutto» is removed with environments: nothing in the new model replaces a workspace. With it go the replace branches of `applyEnvironment` and `importEnvironmentPartial`, then the routes `DELETE /annotations` and `DELETE /highlights` (one request that wipes all of a user's notes — a risk with no remaining caller) (Q3). |
| D11 | **Existing data, no loss.** (a) *Published environments* stay in the Forum with likes, downloads, versions and suggestions, shown as «dossier pubblicati» with their dossiers listed (through D6's read filter); downloads follow D8. (b) *Private environments* stay in their table, read-only (Q2): Forum › «I miei» › «Ambienti salvati (archivio)» lists them with «Esporta JSON», «Recupera i dossier» (D9, server-side from the stored row: its dossiers as `studio`, its notes and highlights skipped where identical) and «Elimina». No new environment can be created; the section is absent for a user with none. (c) *Old links* `/environments?import=…` redirect to `/forum?import=…`, whose preview offers «Recupera i dossier» (D9 with the decoded content). The migration only adds; no row is rewritten or deleted. |
| D12 | **The examples become ready-made study dossiers.** Forum › Esplora opens with a band «Dossier di studio pronti» (the 20 packs, by category, «di VisuaLex»). «Aggiungi ai miei dossier» on a pack (D9) creates its dossiers as `studio` dossiers (2–4 each) and gathers the pack's quick-norm articles that are in none of them into one more, «‹pack›: articoli chiave» (Q6). No quick norm is created. A pack already added is marked «Già tra i tuoi dossier» (by name). The data stays in `data/exampleEnvironments.ts`, re-typed as packs. The dossier list's empty state links to the band. |
| D13 | **Navigation and words.** The sidebar loses «Ambienti»; «Forum» keeps its badge. `/environments` redirects to `/forum`. The Forum: «Forum» / «I dossier di studio pubblicati dalla comunità», tabs «Esplora · I miei pubblicati · Suggerimenti», CTA «Pubblica un dossier» (a dossier picker, then D3's dialog). The admin page's «Ambienti» tabs become «Forum». Tours: `ENVIRONMENTS_STEPS` removed, `FORUM_STEPS` and the welcome step rewritten. One list of categories (today four copies, worded differently from the environments'). Server messages the dialog shows in Italian (the daily limit says «You can only publish 5 environments per day»). |
| D14 | **MCP** (tool names are a contract with connected clients: none is renamed). `omnilex_crea_dossier` gains an optional `tipo` (`lavoro` \| `studio`, default `lavoro`); `omnilex_elenca_dossier` and `omnilex_leggi_dossier` say each dossier's kind. **No tool publishes** (Q7): publishing makes data public and stays a human act, with the preview and the check in front of the user. No description says «ambiente». |
| D15 | **MERL-T, unchanged.** The four events keep their names, payload and consent gate, keyed on the `SharedEnvironment` id, which a published dossier is; download fires from D8 after the server's success, once per download. Seam: #154 (paused) stops relaying `originalAuthorId`; nothing here reads it, so the two merge in either order. Publish, update, «Recupera» and the packs send no event. |
| D16 | **Root rule 23.** Notes and highlights travel with their stored `(startOffset, text)` unchanged through publish, read filter and import; dedupe is exact equality. The preview renders their text as plain text. |

## Design

**Server** (`apps/server`).
- Migration `<next>_dossier_kind_forum_source` (name from the orchestrator): enum `DossierKind` (`lavoro`, `studio`);
  `dossiers.kind DossierKind NOT NULL DEFAULT 'lavoro'`; `shared_environments.source_dossier_id TEXT NULL` →
  `dossiers(id) ON DELETE SET NULL`, with a partial unique index (`WHERE source_dossier_id IS NOT NULL`);
  `shared_environments.withdrawn_by_admin_at TIMESTAMP NULL` (Q8). Additive only; tested on a copy of the dev DB
  (row counts of dossiers, environments, shared environments, likes, versions, suggestions equal before and after).
- Dossier CRUD, serializers and the trash restore carry `kind`; `GET /dossiers` and `/:id` add `published:
  { sharedEnvironmentId, version, isActive, updatedAt } | null`.
- `POST /shared-environments` accepts `sourceDossierId`: the caller's dossier or 404; a second publish is 409 (the
  unique index's P2002 too) → the client offers «Aggiorna»; `PUT` and restore never change it; `coexist` refused on
  an item with one. D6 on publish, update, restore and reads. D7's checks; the admin withdrawal stamped.
- D9's service; `POST /shared-environments/:id/download` with `{ addNotes, addHighlights }` (no body → today's answer,
  filtered, for an older client); `POST /environments/:id/recover`; `POST /dossiers/import-study` (packs, old links;
  size-capped). The «take» uses the shared note mapper; a taken dossier is `studio`. D10's routes removed in PR 3.

**Web** (`apps/web`).
- `Dossier.kind` in the type, service, store; the create and edit dialogs; the list filter and label.
- `features/dossier/PublishDossierDialog.tsx` over `utils/dossierPublication.ts` (pure: rebuilt entries → keys → the
  server's notes and highlights → content + preview rows, one function, so the preview is the payload); D5's check;
  reused for «Aggiorna». The header: «Pubblicato nel Forum · v N» with Aggiorna / Ritira / Elimina / Apri nel Forum,
  through the seam the dossier session leaves in `DossierDetailView`. Phone: a full-height sheet, 44 px targets.
- The Forum: the packs (D12), «Aggiungi ai miei dossier» (D8) replacing `ImportEnvironmentModal`, «I miei pubblicati»
  with the archive (D11b), the `?import=` preview (D11c), the CTA's picker. `PublishEnvironmentModal` goes;
  `EditSharedEnvironmentModal` keeps title, description, category and tags (content changes come from the dossier).
- Removed: `/environments` and its modals, `applyEnvironment`, `importEnvironmentPartial`,
  `refreshEnvironmentFromCurrent`, `createEnvironment*`, `getCurrentStateAsEnvironment`, the dead
  `findConflicts`/`countConflicts`.
- Sidebar, tours, admin labels, categories (D13).

**MCP** (`apps/mcp`): D14; `delegatedRoutes.ts` unchanged (same routes, same scopes).

**Docs**: root and area `CLAUDE.md` files, `docs/frontend/setup.md`, `docs/audit-local-readiness.md` (the environment
gaps it lists close), `docs/merlt/claude-notes.md` (where `forum_download` fires).

## Verification

- Server: the migration on a copy (row counts); kind through CRUD, trash restore, take; publish from a dossier (a
  foreign dossier 404, a second publish 409, a race on the index 409, `coexist` refused); the allow-list drops every
  listed field on publish, update, restore and each read, renumbers ids consistently, keeps offsets and text byte for
  byte; withdrawn items 404 to others on each route; the admin's withdrawal not republishable; D9: study dossiers with
  attribution, notes on articles and on decisions under the keys the web reads (`<key>::art::<id>`,
  `<decisionKey>::art::`), exact-dedupe on a second download, a refused legacy entry skipped and counted, a database
  error rolling everything back; the take's note on a decision now visible. Own DB `visualex_test_forum`.
- Web: `dossierPublication` (notes of articles never opened are in; keys from the rebuilt entries equal the server's;
  decision anchors; switches and exclusions; the lavoro-overlap default; preview rows = payload); the dialog (the
  checkbox gates «Pubblica»; the lavoro line); the kind filter; the download toast; the packs; the archive;
  redirects; Sidebar and tour tests updated.
- MCP: `tipo` accepted and listed; tool names unchanged (`tools.test.ts`).
- Browser pass (desktop and 390 px, own test accounts): publish a study dossier with a note and a highlight, one note
  also in a working dossier (starts unchecked); see it from a second account, download it, find the study dossier and
  the note with its chip; withdraw it and see it vanish for the second account; add a pack; recover an archived
  environment.

## Questions for the owner

1. **The Forum's items**: «dossier pubblicati» (recommended: one word fewer, and it says what they are), or keep
   «ambienti del Forum», as in your document?
2. **Private environments already saved**: a read-only archive inside the Forum with «Recupera i dossier» and
   «Esporta», no new ones (recommended); or convert them all into study dossiers at once (duplicates: each is a copy
   of the workspace); or delete them after an export.
3. **«Sostituisci tutto»** goes, with the route that deletes all of a user's notes in one request (recommended).
4. **The privacy warning** (D5): approve or change the wording; the required checkbox, the per-row exclusion, and
   notes also used in a dossier di lavoro starting unchecked (recommended).
5. **Who can be published**: both kinds, a dossier di lavoro with one more line of warning (recommended); or only
   dossiers di studio (a working dossier is first switched in «Modifica»).
6. **The examples**: each pack's 2–4 dossiers become study dossiers, plus one «articoli chiave» with its other
   articles (recommended); or one study dossier per pack with all its articles.
7. **MCP**: no tool publishes to the Forum; `tipo` added to the dossier tools (recommended).
8. **An item the admin withdrew** (e.g. after a report of personal data) cannot be republished by its author
   (recommended); today it can.
