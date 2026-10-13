# Web app — apps/web

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

MERL-T integration across server and web (routes, gates, guards, surfaces, slice history): `docs/merlt/claude-notes.md`.

### Frontend (`apps/web/src`)

- `App.tsx` — routing. In the signed-in layout: `/` (search), `/dossier`,
  `/studia` (VisuaLex Studia, the study cards: `StudiaPage` with its views under
  `components/features/studia/`, `studiaService`; behind `VITE_FEATURE_STUDIA`, default on
  (`features/studia/featureFlag.ts`; in production a build argument of the ingress image, key only
  in `infra/compose.app.yml`), which also hides the Sidebar's «Studia»; `/studia` redirects to `ripasso` (see «Card review» below); «Le mie schede» is
  `MyCardsView` — `useMyCards` pages through `ordine=materia` and groups subject → institute,
  the selected card is the route `/studia/schede/:id`, an anchor opens its article through
  `triggerSearch` as the dossier's rows do; the act filter offers the acts of the cards listed,
  keeping what a narrowed list hid until a deletion starts it over; each row shows the next review,
  `nextReviewLabel`, and «Da ripassare oggi» filters with `dovuteOggi`; the detail proposes a draft
  («Proponi alla comunità» asks for the notice through `AcceptTextDialog`, the one place a text to
  accept is drawn — every word from the server's version, the body as `TextParagraphs` plain text) and
  withdraws a proposal, and reads a card past the drafts again by its id for `approvazioni` and the
  validators' `rilievi`, which the list does not carry (a failed read says so, with «Riprova»); the admin page's «Testi di VisuaLex Studia»
  tab (`features/admin/StudiaTextsAdmin`, which keeps an unsaved draft across a reload) saves a text as a new version and its user list
  names the validators; both follow `VITE_FEATURE_STUDIA`. «Da validare» is `/studia/valida`
  (`ValidationQueueView`), linked for validators only (`useAuth().isValidator`, from `lingo_validatore`
  on `/auth/me`; the server checks the flag on every call): `useValidationQueue` shows the proposed cards
  one at a time, oldest first, refilling when two are left; the primary anchor's article sits beside the
  card read-only (`ArticleReadOnly`: the reader's text, copy only, no marks; on a phone a collapsed «Testo
  dell'articolo»); `VoteBar` sends Approvata at once and asks a reason for Migliorabile and Errata, and sits
  `sticky bottom-0` at every width (the keyboard moves to the next card's heading after a vote, back to the
  verdict after «Annulla»; `Layout` hides the floating feedback button and the services pill
  (`ServiceHealthBanner`) below `md` on this route, as in a review session, where they would cover the verdicts); the subject is remembered in `localStorage`; a vote that outlives a subject
  change only marks its card handled, and a 403 stops the queue with «Non sei più tra i validatori»),
  `/history`, `/environments`, `/forum`, `/documents`, `/collega-app` («Collega un'app AI»,
  `features/connections/ConnectAiAppPage`: the MCP address from `GET /api/oauth/connection` with
  «Copia», one card per client that connects today — `aiClients.ts`, the survey of 13 Oct 2026, with
  the clients our server refuses listed apart and why —, what a connected app can do, and
  `ConnectedAppsSection`, the same list Impostazioni shows; reached from the user menu), then `/sentenze` and
  `/sentenze/:corte/:numero/:anno` (both `DecisionAddress`: they redirect to `/`, a decision
  address queues the decision for the search space to open in a practice; `/sentenze` alone and an
  address that does not parse both open the palette, and only the address that does not parse
  says why, in the error toast (`pushSyncError`); the addresses stay the contract with LibreLex
  and the graph), then the MERL-T pages `/merlt` (the hub), `/merlt/contribuisci`, `/merlt/valida` and
  `/grafo` (`/merlt/qa` and `/merlt/chiedi` redirect to `/grafo`), and a 404 for
  anything else. The MERL-T routes are always registered, each inside `DevRoute`: without the
  development mode (below) the address redirects to `/`. `VITE_FEATURE_MERLT`
  and `VITE_FEATURE_MERLT_GRAPH` decide the Sidebar's «Assistente» and «Grafo»
  entries and whether a page says it is unavailable. Outside the layout:
  `/login`, `/register`, `/connect` (the consent page an MCP client's
  authorization request lands on: signed in, the user approves or refuses) and
  `/admin/*` (admins only).
- `store/useAppStore.ts` — Zustand + Immer, the single global store.
- `types/index.ts` — shared types. `services/` — one file per backend entity.
- `components/features/` — `search`, `workspace`, `dossier`, `environments`,
  `bulletin` (the Forum), `history`, `compare`, `settings`, `studia` (VisuaLex
  Studia: the study cards, see `/studia` above and «Study cards under the article»),
  `documents`
  (`DocumentReviewPage`: citations found in a TXT/Markdown/HTML/DOCX the
  user drops in — parsed in the browser, never uploaded — each opening the
  reader through `navigate('/')` + `triggerSearch`, gotcha 15) and `decisions`
  (`DecisionView`, the body of a decision wherever it is drawn; `DecisionEntryView`, a practice's
  decision read in its row, its window or the phone's reader, over `useDecisionAnswer` (the fetch, the
  candidates, the notices) and `DecisionAnswerBody`; `DecisionAddress`, the `/sentenze/…` route element;
  `DecisionLink`, a decision named by other data (the Massimario's chips, Brocardi's massime);
  `DecisionTextView`: a court decision's text; `DecisionReadingSurface`: the same text with the
  reader's marks and the norms it cites as links; `DecisionDownloads`: its two PDF buttons; `DecisionResultList`, the Cassazione's decisions for an
  article or a topic, `EuCaseLawBlock`, the Union's courts' decisions that cite an article of a regulation or a directive, and `DecisionSearchTabView`, a topic search's window (or the phone's reader); design `docs/superpowers/specs/2026-10-01-sentenze-design.md`).
- `components/layout/` — `Layout`, `Sidebar`, `ReaderLayout`. The sidebar, for everyone: «Ricerca»
  (a link to `/` that also opens the palette; its hover label carries ⌘K; the quick norms' dot sits under it;
  `#tour-nav-search` is what the welcome and search tours point at), Dossier, Studia (flag), Cronologia, Ambienti,
  Forum, «Analizza documento»; and at the bottom only the user menu, whose dropdown holds Impostazioni,
  «Collega un'app AI», the theme, «Scorciatoie (?)», «Pannello Admin» (admins) and «Esci». The dropdown is a portalled WAI-ARIA
  menu (`role="menu"`/`menuitem`): focus goes to the first entry on open (ArrowUp opens on the last), the arrows,
  Home and End move, Esc closes and returns focus to the avatar, Tab closes and goes on from the avatar, the
  backdrop closes; entries are 44 px high on a phone. Below `lg` the menu opens from a floating button
  at the top left, and `Layout` starts every page's content under it (`pt-[4.5rem]`, repeated at `md`)
  except the search page, whose phone headers sit beside it (`pl-[4.5rem]`); the practice row's
  `h-app-row` is drawn only there, so its height is unchanged. There is no «Ricerca Veloce», no
  «Sentenze» and no row of system buttons. `Layout` mounts the same component twice (the desktop column and
  the phone's off-canvas copy), so both show the same list and the same menu.
- `features/devMode/` — the per-user **development mode**: `useDevMode()` (the effective flag) and
  `DevRoute` (a route element: without the mode, `<Navigate to="/" replace />`; while `useAuth` is
  still loading it draws nothing, so a reload on a development address is not mistaken for the mode
  being off). The administrator enables an account (`dev_mode_allowed`, a checkbox in `AdminPage`);
  the account switches the mode in Impostazioni («Modalità sviluppo», only for an enabled account;
  `dev_mode`, stored on the server, so it follows the user across devices). `useAuth` exposes
  `canUseDevMode`, `devMode` (`dev_mode_allowed && dev_mode`) and `setDevMode(enabled)`, which calls
  `PUT /auth/dev-mode`, makes the answer the shared `/auth/me` and publishes it
  (`services/authEvents.ts`), so every mounted `useAuth` — the sidebar, an article, a route guard —
  follows at once, with no reload. **The mode hides and never grants:** it is drawn in the sidebar
  («Assistente» and «Grafo», under a «Sviluppo» separator, on top of their `VITE_FEATURE_MERLT*`
  flags), on the MERL-T routes, and on an article (the `article_sidebar` graph rail, `AskMerltEntry`,
  the selection popup's «Segnala come citazione» and `MissedCitationReporter`, all gated in
  `ArticleTabContent`, on top of the consent gates); the server's guards stay the real barrier.
  Not behind it: the RLCF trackers and the consent banner (collection is the owner's separate
  decision), the Massimario's panel (`article_case_law`), `article_content_after`, `global` and the
  implicit citation feedback on a click. The mode is unrelated to the Q&A view's own `useQaDevMode`
  (a local toggle for the pipeline trace).
- `components/ui/` — shared primitives: `Button`, `IconButton`, `Input`, `Card`,
  `Modal`, `ConfirmDialog`, `Toast`, `EmptyState`, plus feature-flavoured modals.
  `Modal` is portaled to `document.body`, so a dialog opened inside a reading window
  (transformed, stacked) is not confined to it; each open `Modal` is on a module-level
  stack and only the top-most handles Tab (the focus trap) and Esc, so a dialog opened
  from a dialog keeps the keyboard.
  Interaction tokens live in `constants/interactions.ts`, stacking bands in
  `constants/zIndex.ts`. Compose these rather than hand-rolling Tailwind.

## Frontend State

One Zustand store (`store/useAppStore.ts`) with Immer. Always mutate through
actions.

**Server-backed** (hydrated by `fetchUserData`, mutated optimistically then
synced): bookmarks, dossiers + items, environments, quickNorms, customAliases,
annotations and highlights (these two hydrate per-article via
`loadAnnotationsForArticle` / `loadHighlightsForArticle`). The search history is
not a store slice: `HistoryView` keeps it in local state and reloads it on mount.

**Not in the store:** study cards are server state fetched per view (`studiaService`, `useMyCards`,
`useArticleCards` over `utils/articleCardsCache.ts`, `useReviewSession`), never in `useAppStore`.

**UI-only** (persisted to `localStorage` through the `persist` partialize):
settings, `searchPanelState`, and the practices of the norm-tab redesign (`practices`,
`activePracticeId`; spec `docs/superpowers/specs/2026-10-08-norm-tab-container-design.md` §9-10). The
persist `version` is 1: `migrate` turns a browser's version-0 state into practices once —
the sanitized `practices` when it carries `practicesSeeded: true`, else `practicesFromTabs` over its
`workspaceTabs` — and drops `workspaceTabs`, `highestZIndex` and the marker; the topic searches it
could not reopen are told once (`practiceNotice`). `merge` sanitizes the practices
(`sanitizePractices`). `persist` writes through `utils/guardedStorage.ts`: a save the
browser refuses (a full `localStorage`) is logged and told once as a sync error, never thrown out of
`set`. `clearUserData` empties the practices.
Before the first conversion the raw version-0 value is copied once to `visualex-storage.v0-backup`, so a
browser's old tabs can be recovered by hand should the conversion go wrong (never overwritten; skipped,
with a logged warning «saved workspace too large to back up», when the value is over 1 000 000
characters, so the copy cannot fill the browser's space). The key holds a user's saved norms and
searches: `clearUserData` (logout) removes it, and nothing reads it back in the app.

The partialize deliberately holds UI state only. **Every user-owned slice is
server-backed** — see gotcha 17, which is the rule any new slice must follow.

### How the collections differ

- **Dossiers** (`/dossier`) — the working file for a task: many articles, read in
  place, reorderable, exportable, shareable. This is where real work happens.
- **Bookmarks** — a save action in the reading toolbar backed by
  `bookmarkService`. There is **no bookmarks page or route**; the dedicated UI was
  removed as dead code. Don't document or build against a bookmarks page without
  first deciding to rebuild one.
- **History** (`/history`) — server-side search history. It also hosts
  `NormaChangesSection`, the one place the "a saved norm changed"
  notifications are listed and marked read; the Cronologia entry in the
  sidebar badges their unread count (`useForumNotifications().count.normaChanges`,
  deliberately kept out of the Forum's `total`, which nothing on that page
  could clear). Marking read dispatches `NORMA_NOTIFICATIONS_CHANGED_EVENT`
  on `window` so the badge drops before the next 30s poll. A row is a norm (`act_type`) or a
  decision (`decision_key`, never both): `DecisionEntryView` records a found decision once per
  opening: the key it sent is kept on the practice's entry (`historyRecordedKey`, persisted with it,
  `markDecisionEntryRecorded`), so a remount, a closed and reopened row or a reload never records
  again, while a new entry does (the copy on screen only), and `DecisionHistoryRow` reopens it with
  `openDecision(…, { fromLink: true })`. The entry is marked
  before the request, so a failed request is not retried (not even after a reload) and the failure
  is logged: the history is a convenience.

All of them reopen a norm through `triggerSearch()`.

### Aliases

Three different things. Conflating them is the recurring mistake.

- **Presets** (80) — shipped in `preset_aliases.yaml`, served by
  `GET /fetch_alias_catalog`. 21 of them only rename an act type: "codice
  appalti" IS the "Codice Contratti Pubblici" tile already in the palette's
  grid, so listing them duplicates that grid. The palette shows only the 59
  that carry a number and a date (`gdpr` → Reg. UE 679/2016), which is work
  the grid cannot save.
- **Known acts** (392) — names `act_resolver.py` understands unaided ("statuto
  dei lavoratori", "TUSL"). These need no alias at all; one would only drift.
- **CustomAlias** — the user's own, server-backed. A custom trigger beats a
  preset of the same name, because the client resolves its own aliases before
  asking the server. So the palette hides the shadowed preset rather than
  advertising a shortcut that no longer runs, and the manager badges it
  "sovrascritto".

`AliasManager` is reached **only** from the command palette (gotcha 27), and in
the palette the presets cost one line of header text at rest — they render as
rows only once the user types, and cmdk does the matching. `useAliasCatalog`
keeps its `loaded` flag in component state, so the palette and the manager each
fetch the catalog once for as long as they stay mounted — two calls per session,
never repeated, nothing persisted.

### Reading surface

The dashboard article view (`ArticleTabContent`) composes: `ArticleBody` (renders
sanitised HTML + hosts `SelectionPopup`), `useArticleMarkers` (turns raw text into
HTML with highlight `<mark>`s and wavy note anchors), and the toolbar
(`ReadingToolbar`). Keys are `buildItemKey(norma)` and
`uniqueArticleIdFromNorma(norma)` from `utils/normaKeys.ts` — the dossier reader
uses the same two functions, and they must stay byte-identical or annotations
made on one surface stop appearing on the other.

**The text is structured, never rewritten** (round A, spec
`docs/superpowers/specs/2026-09-25-lettura-testo-design.md`).
`parseArticleStructure` (`utils/articleStructure.ts`) reads heading, rubric,
commi, items with their printed enumerator and level, Normattiva's
`((modifications))` and repeal notices, `(119)` references and the
AGGIORNAMENTO notes, as raw ranges that partition `article_text`;
`renderArticleHtml` (`utils/articleRender.ts`, behind `useArticleMarkers`)
emits one `div.vlx-b.vlx-{kind}` per block, cutting the text at every block and
mark edge and nesting marks with a stack, so the HTML is always well-formed and
escaped. Styles are the `.vlx-*` rules in `index.css` (READING SURFACE): a 68ch
measure, commi divided by space, hanging numbers and items. The contract is
gotcha 23: the rendered text nodes spell `article_text` minus `\n` — any new
label goes in CSS (`content: attr(...)`), never in a text node.
`articleRender.test.ts` enforces it on 27 real texts
(`utils/__fixtures__/articleTexts.ts`). The practice's rows and windows, the dossier reader and Study Mode all
render this way; Study Mode hides the heading and rubric blocks
(`vlx-hide-header`) instead of cutting them, so its offsets are
document-relative like everywhere else. The Brocardi sections render flat
(`structure: null`).

**Offsets are measured from the text alone.** `SelectionPopup` takes a
`textRootRef` (the element holding only the article text) and stores the anchor
from `getSelectionAnchor` (`utils/selectionOffset.ts`), which reads
`Range.toString()`: `Selection.toString()` is rendered text and writes a newline
per line or comma boundary, which made every cross-comma highlight unmatched.
The renderer also accepts, at the same offset, a stored text that differs only
in whitespace, so those older highlights show again.

**«Giurisprudenza» under the article** (`CaseLawSection`, between the text and
`BrocardiDisplay`): an accordion closed by default (state per host in
`sessionStorage`) holding Brocardi's massime (`MassimeSection`, only where the
doctrine is shown — gotcha 32), the Massimario's panel (the plugin slot
`article_case_law`, which takes `articleUrn`, `isHistorical`, `besideId`,
`backEntry`) and the Cassazione's decisions that mention the article, searched
only when the reader presses the button (`DecisionResultList`; not offered on an act of the Union,
`isEuropeanAct`). On a past text the section stays; the massime do not. A decision opens beside the
article with the way back. Every block draws its rows with the one `CaseLawRow`
(`components/features/search/caseLaw/`: the estremi as a `DecisionLink`, the exact date else the year,
the text cut at three lines with «Mostra tutto», the source as a small label; `authorityColor` is the
one colour key) and the section's header holds the one set of controls (`CaseLawControls`): a range of
years «dal / al», a chip per year with the count of the rows loaded, the order (newest first, reversible)
and one text filter; on a phone they sit behind «Filtri». The blocks do not own a filter and no block
scrolls inside itself. The controls reach them through `CaseLawFiltersContext` (`useCaseLawFilters`;
the Massimario's panel is a plugin whose slot props are a contract, so it reads the same context) and
each block reports its years back with `useReportCaseLawYears(source, counts)` — `YearCount[]`, memoised;
the section adds them up into the chips (`mergeYearCounts`; a year is «circa» when any block's count is
approximate). What a row answers to is the source's to say (`YearsOf`: Brocardi's `anno`, a passage's
cited decisions' years — the review's year is its provenance, a Court of Justice decision's day); a row
with no year is kept only while no range is set. The year range and the text filter narrow what is
*loaded* — except for the Cassazione: its block sends the range to the archive (`anno_dal`/`anno_al`,
`DecisionResultList`'s `yearRange`; a new range starts the search again from page one, nothing is asked
before the reader presses the button) and reports the archive's own `anni` counts for every year — approximate
(«circa») in index mode, which counts before the citation re-check, exact in the text search — or, when the
archive sent none, the years of the hits loaded (the counts are kept for the query, archive and mode they
count, not for the next one if that fails; the range is clamped to 1900 – this year in Rome, and a range wholly outside
that answers «none» without a request). On the Cassazione the reversed order applies once every
decision is loaded; until then the archive's order (newest first) stands and a line says so. Filters reset
with the article.
**An act of the Union has the Court of Justice's block** (`EuCaseLawBlock`, in place of the Cassazione's) for a
regulation or a directive: `utils/euCaseLaw.ts` derives the act's CELEX from the norm
(`3` + the year + `R`/`L` + the number on four digits, as the API's `sources.eu_identity` does — the norm
carries none; a pair written in `numero_atto` is not guessed at) and the plain-number article; a Treaty, or an article that is not a plain number, has no query
and the block says the list is for regulations and directives (for a regulation or a directive whose article is not
a plain number, that it is searched by simple numbers). It asks `/search_eu_case_law`
(`services/euCaseLawService.ts`, `legalFetch`) when it appears, once per act and article for the session
(`utils/euCaseLawCache.ts`, cleared at logout; only an answer is kept, so «Riprova» asks again). A row is
`CaseLawRow`: a judgment is a `DecisionLink` from its `identita` (our reader, beside, the way back, the phone's
full screen); an order or an Advocate General's opinion, which that reader does not hold, is a link to EUR-Lex by
its CELEX (`eurLexDecisionUrl`, new tab, «su EUR-Lex»; no link from a CELEX that is not a decision's). The
opinions («Conclusioni AG») are hidden, and out of the counts, until the toggle; the block says the list may be
incomplete with a link to InfoCuria's search page (its search by cited provision has no address to rely on),
credits «EUR-Lex / Ufficio delle pubblicazioni dell'UE», and holds the archive's order when the query stopped at
its 500 rows.
A topic opens a topic-search window of the practice (`openTopicSearch`; `ReadingWindow` draws
`DecisionSearchTabView`: heading «Tema: …», the article when the query has one, «Solo il tema» to
drop it, the limits line, the list; a decision opened from it sits beside that window, with no way
back; on a phone it is the full-screen reader's subject): from a Brocardi glossary
term («Sentenze su questo tema», beside the article's row, with its norm) or from the palette
(a line «Cerca "…" nelle sentenze della Cassazione», shown only when the box is neither a decision,
a norm, has at least three characters one of which is a letter or a digit, nor starts with a custom alias, nor while the server is still resolving it as an act, and announced in the palette's status region).

**Normattiva's update notes** are interactive and out of the way:
`useArticleTextInteractions` delegates click and Enter/Space on the body — a
`(119)` chip opens `UpdateNotePopover`, the "Note di aggiornamento (N)" toggle
folds the tail through the `vlx-updates-open` class on the text container
(the HTML never changes when it opens). A reference whose note is not in the
text is plain text; only `((49))` is dimmed.

**The reader's own annotations are marked where they are** (round B, spec
`docs/superpowers/specs/2026-09-25-annotazioni-sul-testo-design.md`).
`utils/articleAnnotations.ts` is the one definition of where a highlight or a
note renders (`resolveAnchors`) and of which block shows it
(`groupAnnotationsByBlock`). With `signs: true` — the practice's rows and windows and the dossier
reader, not Study Mode — the renderer ends each annotated block with an empty
`span.vlx-sign`: the note icon, the count and one dot per colour are CSS, so
the text nodes are untouched. The sign sits inline after the block's text, or
in the right margin when the `vlx-frame` size container (a wrapper around the
text in `ArticleBody`) has room for the 68ch column plus a sign. It opens
`BlockAnnotationsPopover` through `useArticleTextInteractions` (one popover at
a time with the update notes): the block's notes, edited and deleted in place
with the Notes panel's own `NoteCard`, and its highlights, removed; *Vai al
passo* scrolls to the passage and makes it glow (`utils/revealAnnotation.ts`).
The popover is placed against the whole block (`utils/blockAnchorRect.ts`) —
beside it when the margin has room, else below or above it, never over the
passage it lists — through a virtual reference that finds the sign again on
every measurement, because every edit redraws the text. Its focus management
is modal: with no element in the text for floating-ui to bridge Tab back to,
Tab cycles inside and Esc returns to the sign. The "Evidenziazioni" box under
the article now lists only what no sign can reach (`LooseHighlightsList`,
desktop): highlights made in the Brocardi sections and highlights whose text
changed — without it they could no longer be removed.

**Find in the text** («Cerca nel testo», spec §13): one floating `FindWindow` (`features/search/`,
mounted once in `Layout`, portalled, z-index `findWindow`) opened by Cmd/Ctrl+F (`Layout.tsx`: opens,
or focuses and selects the query when already open) and by the magnifier (`FindInTextButton`) of
`ReadingToolbar` (desktop and phone rows) and `DecisionReadingToolbar`. Cmd/Ctrl+F is intercepted on `/`
only, where the workspace is drawn; on every other route it is the browser's, and leaving `/` closes the
window. It is also the browser's while an overlay covers the workspace (`isWorkspaceCovered`): an element
with `aria-modal="true"`, or one marked `data-find-overlay` — Study Mode, `CommandPalette`, `CompareView`,
`PDFViewer`. A new full-screen overlay that is not a modal dialog in ARIA terms takes the mark on its
root, rendered only while open; do not add `aria-modal` for this alone (Study Mode lost it: its note
popovers are portalled outside it, and VoiceOver hides what lies outside a modal dialog). The hand-rolled
`z-50`/`z-[100]` modals sit under the window, which stays over them, visible and usable.
`utils/findWindowControl.ts` (`openFindWindow`, `closeFindWindow`, `subscribeFindWindow`,
`isWorkspaceCovered`) is its control; `useFindWindowScopedTo` gives the magnifier its pressed state
(pressed: open on this practice and this text; the state is read at `pointerdown`, before a practice
switch changes the active one). The scopes are «Questa pratica» (the active
practice, on both breakpoints: every article of every act, its row open or closed, then its decisions
newest first) and «Tutte le pratiche» (the bar's order, each place named with its practice); a row's
root registers under its practice's id with the same keys, and so does a light window's (the
surface's `findHostId` prop, which also names the practice for the magnifier's pressed state and
request; the window's own id stays the way back's and the focus's); `setFindWindowDefaultPlace` lets a
layout give the window its opening place (`ReadingRow`, in every case: right-aligned in the table's
column, or the first window's body with the rail, under the stack pinned at its top — the practice header,
the first act's heading, an open row's toolbar, each marked `data-pinned-head` — and every window's
header, so never over a control; a dragged place wins; a tool held over the table carries
`data-floating-tool`, which the rail's overlay does not read as a click away); a decision never read counts nothing (it
is not in the session's cache); reaching an undrawn match opens its row with its practice made active
(`revealPracticeRow`, `revealPracticeDecision`; on a phone the reveal's own update takes the full-screen reader off, so the row is on screen — a match in the reader's own subject is drawn and needs nothing), and the window recomputes on a practice switched, a
row opened or closed, a subject added or removed. `CompareView` then lists the practices' articles. Under «Tutte le pratiche» the place of the match is one label: the target's own (a decision entry's, which carries the section, or an article's `shortNorm`), with its practice. The window is dragged by its handle (pointer or arrow keys), its
place kept in sessionStorage and clamped; on a phone it is a full-width top bar, not draggable (gotcha
26: use `useIsDesktop`). Esc closes it and returns focus. Text roots register through
`useRegisterFindRoot`; `useFindWindow` finds across `utils/findTargets.ts` targets (a displayed root is
searched in its DOM, any other in its stored projection and only counted), moves the reader only on
next or previous, and shows an undrawn match through `revealPracticeRow` / `revealPracticeDecision` (the practice made
active, the row opened). A target whose root does not
appear within 3 s is given up for that query and leaves the counter. The article searches `ArticleBody`'s text root only (`textRootRef`), not Brocardi nor «Giurisprudenza»; the root holds only the text (the empty-text placeholder is drawn beside it), which the find and `SelectionPopup` both rely on;
a decision only when it has text (`hasDecisionText`). The search reads the text nodes, joined by one virtual space at every block boundary, `<br>` and skipped hidden subtree, and paints with
the CSS Custom Highlight API (`::highlight(vlx-find)`, `::highlight(vlx-find-current)`); it adds,
moves and changes nothing in the DOM (gotcha 23), and where the API is missing it only fails to
draw. The article renderer emits nothing for a search (no `search` mark kind, no amber `<mark>`).
Matching ignores case, accents and marks, folded 1:1 per UTF-16 unit so offsets are the
original's; a query needs two letters or digits (punctuation does not count: «n.» is not searched); past 1000 matches the rest are not drawn.
A dot or comma of an abbreviation is optional («cpa» finds «c.p.a.», «art 13» finds «art. 13»; «art.» never finds «articolo»), and a
number is never cut out of a longer one («8980/2018» is not in «18980/2018»). A query that reads as a
citation (`readQueryCitation`, spec §13.2) also finds the other forms of it: per target, the literal
matches and `findCitationSpans` are one list (`matchesWithCitation`), ordered by start, overlapping matches joined into their union, on a drawn text
over the same separator map and on a stored text over its projection (`utils/citationSearch.ts`).
The literal matches of a citation query obey the spans' bounds: never right after a letter, digit
or dot, never before a letter when the query ends with a dot («art. 1 c.p.» is not in «c.p.c.»).
`useFindWindow` keeps one `CitationText` per target in scope (folded and parsed for citations once
per text, replaced when the text changes, dropped when the target leaves the scope). Act types come from `sources/actTypes.ts` plus the
palette's spellings (`NUMBERED_ACT_SPELLINGS`); a type is never found inside another's name («legge»
in «decreto-legge» or «decreto- legge»), a decision's number never inside an act's citation (any
type of the table, or «decreto», «direttiva», «regolamento», or an administrative act, in every form of the number and
year: «circolare», «nota», «provvedimento», «delibera», «determina», «risoluzione», «parere»…; regional laws and
Union acts too, never «ordinanza» or «sentenza», which are decisions; an administrative court (`ADMIN_COURT_HEAD_SOURCE`)
named in the act's words is a decision's head, except right after «del»/«della»/«dello»/«dell'», where it is the act's issuer: «il parere del C.d.S. n. 5/2018» is an act; any other court there stays a head: «il decreto del Tribunale di Milano n. 5/2018» is a decision), and
an article links to its act only across the gap §13.2 whitelists (commas, «comma N», «commi 2 e 3», «primo comma» and the
other ordinals, «e ss.», «lett.», «n.», «del»…). A decision cited date first («Cass., sez. III, 12 aprile 2018, n. 8980») is found by
its date and number when the date's year is the query's and a court or a decision's marker stands within 60
characters before the date (`followsDecisionMarker`: no act's name, semicolon or end of a sentence between; a full stop ends a sentence
after a word of five letters or more, a digit, a bracket or a quote, a short abbreviation never does), never
as an act's («legge 12 aprile 2018, n. 8980»); without a marker nothing is found, because date first is also how
ministerial decrees, regional laws and administrative acts are cited. A code's article
is found across the same words (`blankCodeLinks`: «art. 2043 del c.c.», «art. 2043, primo comma, c.c.», «art. 2043 e ss. c.c.»
are blanked to spaces at the same offsets and `extractCitations` reads the text again; it is the one reader of codes, and it
still does not make «del c.c.» a link). Its tests use synthetic texts (no run of 30
characters shared with the real ones); the real ones live in
the git-ignored `utils/__fixtures__/private/` (personal data: never copy them into a committed
file) and `citationSearch.local.test.ts` is skipped where the folder is absent.
Browser floor: the Highlight API (Chrome/Edge 105, Safari 17.2, Firefox 140). `articleRender.test.ts` and
`decisionRender.test.ts` check the projection with a search open (`utils/__fixtures__/openFind.ts`).
The «?» dialog lists Cmd/Ctrl+F as «Cerca nel testo».

**Card review** (`/studia/ripasso`, `ReviewHome` with `StudyPreferences`; the session is
`/studia/ripasso/sessione?materia=`, `ReviewSession`): the server builds the day's queue and decides
what «today» is (Studia spec decision 18), so the web app never computes a due date; the one exception,
`nextReviewLabel`'s «Da ripassare oggi», is a display label. `useReviewSession` holds the queue: a card's
first grade is posted, «Di nuovo» puts it back at the end, and its later passes that day are practice,
never posted (the bar then shows the grades without intervals and «Ripasso di pratica: non registrato»).
Its key handler reads the queue from refs and every queue update checks the head is still the graded
card: a second key pressed between a post resolving and the re-render must not drop the next card.
Keys: space reveals (ignored on a focused button or link, in a field, under an `aria-modal` dialog or a
`data-find-overlay` layer), 1–4 grade after the reveal, Esc closes the article first, then asks
«Interrompere il ripasso?»; listed in the «?» dialog's «Ripasso» group. The visual rule of the review
card (`ReviewCard`) is the spec's §6 and is not to be restyled: the anchor's citation small in slate sans
above, question and answer in the reader's serif at a 60ch measure, the question a step larger, no
shadow or gradient; the reveal is the area's one motion (a hairline, then the answer, `motion-safe:`
only); on `GradeBar` the interval is the large text and the grade the small one, every button neutral
but «Di nuovo» (warning tone), pinned at the bottom on a phone in the `pinnedBar` band (under the mobile
menu's backdrop; `Layout` hides the feedback button and the services pill, `ServiceHealthBanner`, there on a phone). An anchor opens its article
(`DossierItemReader`) in a side panel on desktop and in `studia/Sheet` on a phone (the bottom sheet
shared with `CardFormDialog`, marked `data-find-overlay`); the panel closes when the card changes.

**Study cards under the article** (`studia/ArticleCardsRow`, behind `VITE_FEATURE_STUDIA`): one quiet
row after the discussion panel and «Chiedi su questo articolo», outside `ArticleBody` and its text root
(find-in-text and the offsets never see it): «Schede su questo articolo (n) · + Nuova scheda». The count
(`useArticleCards`: one read per address from `/api/lingo/articolo`, kept for the session in
`utils/articleCardsCache.ts`, shared between copies, `refresh()` after a save) opens `ArticleCardsPeek` (the reader's own
card is a link to `/studia/schede/:id`; a community card — `comunita: true` — is a 44 px `aria-expanded` button that opens in
place with its answer and explanation as text, because `GET /lingo/cards/:id` answers only the author); the row owns the
`CardFormDialog`, and the selection popup's «Crea scheda» (`SelectionPopup.onCreateCard`, passed through
`ArticleBody.onPopupCreateCard`, offered only by the article surface) reaches it through the row's `ref`
(`createFromPassage`). `articleCardsOffer.ts` is the one rule: a row needs a `urn:` in `norma_data.urn`
(an EU act has none), «+ Nuova scheda» and «Crea scheda» need the text in force (`readOnly` or
`versionInfo.isHistorical` marks the first `aria-disabled`, not `disabled`, so it keeps focus and its
`Tooltip` shows the reason on hover and on focus, and withholds the second). The cache is cleared at
logout (`clearArticleCardsCache`) and invalidated (`invalidateArticleCards`) after every card saved
(`CardForm`), moved to the trash (`MyCardsView`) and restored from it (`useTrash`, a `LINGO_CARDS`
entry); a generation counter keeps a read that began before either from writing what it found. The form's
institute is suggested from the article's rubric (`getRubricText`).

**Passage discussions on the reading surface**: the discussion wiring of a reading surface
lives in one hook, `useDiscussionWiring` (passage threads load and reload, the ones that still
land in the text, the panel's open state, the focused thread, the «Discuti» draft, the text
fingerprint; it returns the props the panel takes), and one status component,
`PassageThreadsStatus` (the loading line, the failed-load alert with its 44 px «Riprova»).
The article and a decision's surface both use them. Under it, `useArticlePassageThreads(anchor,
{ enabled?, plainText? })` loads the passages of one subject: the caller gives the anchor
(`{normaKey, articleId}`; the article folds `Boolean(articleId)` into `enabled`) and the plain
text, and the hook returns `locations`, where `locatePassage` says where each passage lands in
that text (the one place «detached» is computed). A reload reaches every mounted copy of the
subject (the phone view and the desktop panel) and keeps the previous list meanwhile. The result
is counted on the round-B sign (`data-threads`, speech-bubble icon). In the text, words stay clean until a
discussion is opened. The block popover (`BlockAnnotationsPopover`) lists the
block's passage discussions with their quotation, title, author, reply count,
and an "Apri discussione" action that opens the discussion panel. The discussed
words light up only for the discussion open in the panel (`focusedThreadId` →
`.vlx-thread-focus`), nesting inside any highlight over the same words. When the
article text changes, a discussion whose words moved re-attaches to the new location;
a detached one stays listed in the panel with a notice and its original quotation,
never hidden or deleted. The article surface and a found decision's surface (`DecisionReadingSurface`) use this, the
decision through the same hook and panel with its anchor (`articleId: ''`); its
`renderDecisionHtml` takes `threads` and `focusedThreadId` and the text hash is that of the
projection. A decision found without its text still takes general discussions
(`DecisionDiscussionsWithoutText`: the button and the panel, no «Discuti», no passages, no text
hash). The toolbar's button is the shared `DiscussionButton`. A decision's panel withholds a
withdrawn passage's quotation from every reader but the thread's author and the admins, until an
admin releases it, and fails closed: a passage whose state is not known (loading, reloading,
failed load, a thread missing from the passages list, a decision shown without its text) is
withheld like a detached one. The rule is the panel's alone: the API still returns the stored
quotation to any signed-in caller (spec §8.7), so withholding is presentation, not access control,
and no other view may show a decision thread's `passage.quote` without the same rule. Server-side
withholding is a precondition for opening VisuaLex to the public.

**A court decision takes the same tools** (`DecisionReadingSurface`, PR 4): notes and
highlights are stored under `normaKey = decisionKey(identity)` with `articleId = ''` (wire key
`<key>::art::`), through the store's ordinary actions; the surface mounts the article's own
`SelectionPopup`, `InlineNoteComposer`/`InlineNotePopover`, `NotesPeekPanel`,
`HighlightsActionsPicker`, the round-B signs and `BlockAnnotationsPopover` (a paragraph is the
block; `decisionStructure` names them). `DecisionReadingToolbar` draws the notes and highlights
buttons and the discussion button (`ReadingToolbar` needs an article's props). Anchors that do not land are listed, never dropped
(`UnmatchedAnchors`; a decision found without text hosts it through `DecisionAnchorsWithoutText`).
No MERL-T events, versions, Brocardi or saved-norm watcher. `utils/decisionRender.ts` is the
renderer and the one definition of the layout (`decisionProjection`, `layoutDecision`,
`decisionStructure`, `renderDecisionHtml`, `unmatchedAnchors`); `decisionRender.test.ts` checks
that the rendered text nodes spell the projection (root rule 23). The .txt export of notes and
highlights is shared with the article (`utils/annotationExport.ts`). Only what really
leaves the account carries just the anchors whose words are still in the decision's text: an
environment's export file, its share link and the Forum (publishing, editing, suggestions), through
`utils/decisionAnchorsTravel.ts` (`travellingAnchors`, `travellingSelection`): «the decision's
current text» is the server's cached copy (up to 30 days, the owner's choice), so words a court
has withdrawn can travel until it expires; lookups run per distinct decision, at most four at a
time, and a failure is not cached. `isAnchoredNote` (`decisionRender.ts`) is the one definition of
a note that quotes words (a note without a quote is free). The decision downloads, the notes and
highlights .txt, an environment's file and a dossier's JSON go through `utils/saveBlob.ts` (the
object URL is revoked later, not at once); a few older exports still make their own link. `DecisionTextView` renders a
found decision only for a host that mounts `DecisionView` without the reading surface; a practice's
entry always passes the surface. A private
environment save (create, create from a selection, update, refresh) stays in the account and keeps
every anchor, decisions included (the owner, 8 Oct 2026). The personal files are not filtered
either: the .txt export and the PDF «Con le mie evidenziazioni e note» list the anchors that no
longer land (the PDF under «Non ritrovate nel testo attuale»), like the account export — the user's
own data (decided by the owner, 8 Oct 2026).
**Downloads** (`DecisionDownloads`, among `DecisionView`'s actions for a found decision):
«Scarica PDF» is a PDF of ours (`decisionPdf.ts`: `decisionPdfModel` is pure,
`writeDecisionPdf` draws it with jsPDF through `utils/pdfWriter.ts`, the page layout the
dossier's PDF shares), optionally «Con le mie evidenziazioni e note» (placed by `resolveAnchors`
over the same projection; free notes follow the text; anchors that no longer land are listed under
«Non ritrovate nel testo attuale», switchable with the `includeUnmatched` option of
`decisionPdfModel`); «PDF originale della Corte», for the Cassazione only, is the court's own file
through `/fetch_decision_pdf` (`services/decisionPdfService.ts`, via `legalFetch`). The footer of
the Corte costituzionale's PDF adds «· licenza <fonte.licenza>» (e.g. CC BY-SA 3.0), and the text ends with its
own line «Dati aperti della Corte costituzionale, licenza CC BY-SA 3.0 — <licence address>» (`licenceLine`; the
address from a small table, no line for an unknown licence); the
Cassazione's PDF and the page (`DecisionView` footer) carry no licence line (the owner, 8 Oct 2026).

**The decisions a text cites are links** (spec `docs/superpowers/specs/2026-10-13-decision-citations-in-texts-design.md`).
After `wrapCitationsInHtml`, `wrapDecisionCitationsInHtml` (`utils/decisionCitationMatcher.ts`) wraps each
decision a text cites in `span.decision-cite` (`data-decision-path` is the one source of truth, `data-cache-key`
the same address), per text segment and adding no character (root rule 23: a citation cut by a highlight is
two spans with one key). It reads the visible text with the tags removed and the entities decoded as the browser does
(soft hyphens ignored), so a mark in the middle of a number does not cut the citation, and never claims a range a `.citation-hover` span holds. Three surfaces use it:
`DecisionReadingSurface` (with `within: 'cassazione'` when the decision read is the Cassazione's, and its own
path as `selfPath`, so a decision never links to itself), `ArticleTabContent` (Normattiva's update notes cite
the Corte costituzionale) and the Ratio and Spiegazione of Brocardi (`MarkableBrocardiSection`, told where it is
read through `decisionLinks`; Brocardi's massime already link their decision through `DecisionLink` and are not
wrapped again). `useCitationLinks` takes a `decisions` option (`DecisionLinksOptions`); `useDecisionLinks`
builds it and the popup's props: a click records the way back from the surface's origin, then
`openDecision(reference, { fromLink: true, besideId: <host> })` (the reference is rebuilt from the path with
`decisionReferenceOfPath`; the practice's window rule and the phone's full-screen reader are the store's).
Hover for 400 ms (`useDecisionPreview`) shows `DecisionPreviewPopup`, on the same frame as the norm popup
(`ui/PreviewFrame`, `calculatePreviewPosition`): the decision's heading and first lines from
`fetchDecisionCached` (one request per decision for the session, none without a hover that lasted; the pointer
leaving first drops the pending request), «Con questi estremi esistono N decisioni» for an ambiguous reference.
«C.d.S.» and «cds» are also the codice della strada: right after an article citation («art. 142 c.d.s.», «art. 142, comma 8, C.d.S.», «art. 142 del cds») or after «del»/«al»/«dal»/«nel» they are the code and no court head, unless «sez.»/«Ad. plen.» follows them («C.d.S., sez. IV» is the court; «dal C.d.S. n. 5/2018» alone stays the code, truly ambiguous) (`isCodiceDellaStrada`, `decisionCitationParser.ts`, used by this scanner and by the find window's marker rule). The scanner never links a court that is not written (D2): a bare «n. 123/2020» stays text everywhere; the one
context rules (the owner, 13 October 2026) are two: inside a Cassazione decision a section without its court
(«Sez. U, n. 9100 del 2015») reads as the Cassazione; inside a Corte costituzionale decision «sentenza/ordinanza
n. N del YYYY» (also «sentenze n. … e n. …», each number its own span) reads as the Court's own, unless a court is
written right before it (the court covers its own citation) or right after it («… della Corte di cassazione», «…, la
Cassazione ha affermato», «… delle Sezioni unite», «… del giudice di legittimità»; a plural list is read whole first), or
when another court (any head, the referring judge, the Sezioni unite, «la Suprema Corte» among them) is the nearest court named
earlier in the same sentence ("questa Corte" or "Corte costituzionale" in between gives it back); a register number
(«reg. ord. n. 120 del 2018») is never a ruling.
`DecisionReadingSurface` passes `within` for these two courts only; no other court has such a rule. «decreto n.» of an administrative court is a known conservative miss.

**A past text is a reading** (round "Testo alla data", spec
`docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`). The server
states, next to `article_text`, the window the source's own page gives
(`ArticleData.validity`: `state`, `valid_from`, `valid_to`, …).
`utils/versionDisplay.ts` is the one table that turns it into what is shown —
the status chip (`VersionStatusChip`: "In vigore dal …", "Testo storico · dal …
al …"), the `VersionBanner`, and what is switched off — and it is tested without
a DOM. `versionInfo.isHistorical` is what was ASKED for (a date, or the original
text), never what came back. On a past text the practice's row, the dossier reader and
Study Mode take no notes, highlights, discussions or quick-norm (the selection
popup offers only "Copia"), Brocardi is not shown, and the update notes open;
an article that did not exist yet draws no text, only the way forward. The
"Testo alla data" dialog (`TextAtDateDialog`) replaces the old "Cerca versione"
modal; the result opens as a row of its own in the act, labelled with the day asked for (the text in
force stays another row: `practiceArticleKey` carries the version).
`utils/citation.ts` writes how a lawyer cites it, in the owner's style ("art. 1284
c.c., nel testo in vigore al 29 dicembre 2007"; "art. 2, l. 7 agosto 1990, n. 241,
nel testo in vigore al …"; the golden file is `utils/__fixtures__/citationGolden.ts`),
and a copy of a past text starts with it. A version that does not contain the day
asked for (`request_in_window` false) is shown with a warning and is not cited,
copied, exported or saved (`copyBlockedReason` says why); the update notes of a
past text are open by default and can be closed (the `updatesOpenByDefault` option
of `useArticleTextInteractions`).

**Notes**: a Peek popover (`NotesPeekPanel`) from the toolbar for browsing and
free notes; `InlineNoteComposer` anchored on the selection when creating an
anchored note; `InlineNotePopover` when clicking an existing wavy underline;
the block popover from a sign, for everything one block holds. Deliberately
distinct entry points — don't collapse them.

**Highlights**: created **only** from `SelectionPopup`. The toolbar's Highlighter
button opens `HighlightsActionsPicker`, an action bar that toggles visibility and
exports to `.txt` — it is not a second creator (that was tried and rolled back).
Hiding them also hides the signs' colour dots and the signs that hold only
highlights.

**Discussions**: the toolbar's speech-bubble button opens
`ArticleDiscussionPanel`, a draggable portal whose anchor
(`{normaKey, articleId, articleLabel?, version?}`), `label`, `heading` and
text-changed notice come from the caller (the article's wording is the default;
the load keys on the anchor's fields, so an inline object does not refetch)
(threads, replies, votes, report; moderation
is admin-only, `PATCH /admin/article-discussions/:id`). A new discussion can also
start from a selection via the "Discuti" button in `SelectionPopup`, which opens
the panel composer with a draft passage block and makes the title optional (the
quotation stands in for it). Every new discussion records the `textHash` (SHA-256
fingerprint) of the text on screen, and an article's also its `articleUrn` (a decision
records no URN: the server refuses one). The article and a found
decision's surface mount the panel (the decision's anchor is `articleId: ''`, with its own heading and notice). The panel is mounted
for every rendered article and fetches **only while open** — a load on mount
cost one GET per article of a range.

**Saved-norm change check**: when a *bookmarked* article is shown,
`ArticleTabContent` posts `{norma_data, article_text}` to
`/notifications/normas/check`; the server keeps one snapshot per
`(user, normaKey)` and answers `changed` when the **text** differs, which
the reader toasts. The effect is keyed on `(itemKey, isSavedArticle)` and
reads the body through a ref, so a re-render with the same text as a new
object does not post again; it is separate from the highlights/annotations
load effect, which stays keyed on identity alone.

**The index is a window, the text is not.** `TreeViewPanel` takes a `variant`:
`'window'` on desktop — a draggable, backdrop-less window portalled to
`document.body`, parked where the user left it — and `'drawer'` on mobile, the
old right-side sheet. Neither closes when an article is picked: taking three
articles out of an index without reopening it is the whole point. Ownership of
the desktop window lives in the store as a single `structureWindow.blockId`, so
opening one block's index hands the window over rather than stacking a second.
The floating mechanism belongs to the *tool*, not the content — the owner's own
framing, and the correction that shaped round 2a.

**Opening an act without an article.** `resolveAct` (`utils/actUrn.ts`) resolves
an act's URN structurally, with no text fetched; `addActIndexToPractice` then drops
an article-less act on the active practice (created when there is none) and points the
window at it atomically. The
palette's "Apri l'indice e sfoglia" is the entry point. An act with zero
articles is a legitimate state — guard anything that dereferences the active
article (`StudyMode` is mounted conditionally for exactly this reason).

**Going back.** `readingBackStack` records **citation jumps and the jump from an article to a decision**. Picking from
the index does not lose your place, and a previous/next arrow is undone by the
opposite arrow; recording those would fill the stack with stops nobody wants.
`ReadingBackControl` renders once for the whole app — the stack is global, so a
per-practice copy would sit inside the very place an entry points at. It names its
destination, and it has no keyboard shortcut on purpose: every natural
combination for "back" already belongs to the browser. It floats centred above the bar of practices on the desktop (`bottomOffset`
from the bar's measured height) and, on a phone, a fixed 80 px up, clear of the services
pill and the feedback button; the bottom is the one edge the table's sticky headings and the windows' headers leave free.
The reading surfaces push a `ReadingBackEntry` (`{ tabId, blockId, articleId, articleKey?, label }`: `tabId` names a practice, one of
its windows or the phone's reader, `blockId` an act or a decision) and `pushReadingBack` keeps it as a `PracticeBackEntry`
(`{ practiceId, subject, place }`, spec §6.3) — `table` for a practice's row, `beside` for a window or the reader — the
row named by the entry's `articleKey` when a practice's row gave one (its `readingOrigin.articleKey`,
so a past text comes back as itself), else found through `findPracticeArticle`. An entry that names nothing the
practices hold is not kept. The entry is live while its practice holds the subject, and `popReadingBack` walks back to
it itself (the practice made active, the row revealed or the window reopened, or an open window asked to take focus
through `windowFocusRequest`, a one-shot signal the window takes atomically; a topic-search window is never a target; on a phone the same step opens the full-screen reader on a subject read beside, or closes it for a row of the table, since a phone has no windows).
`moveActToPractice` rewrites the entries that name the moved act.

**The practice.** A practice is the table of one question (spec `2026-10-08-norm-tab-container-design.md`):
acts with their articles, then «Giurisprudenza», and the light windows beside the table. It is UI state saved in
the browser (gotcha 17); the store holds it as `practices` with `activePracticeId`, and every way in routes to it.
A court decision is an entry of a practice, never a tab: one entry per decision per practice (`openDecision`
reuses the entry `sameDecision` matches, and a later citation that adds a section to a still unresolved entry
replaces its reference, so the entry asks again with it). `openDecision(reference, { fromLink: true, besideId })` is
the read from a link — the practice `besideId` names (a practice, one of its windows or the phone's reader),
else the active one, created as «Sentenze» when there is none; on the desktop a window beside the table, the window
the link was clicked in being the asker and so never the one a third window replaces (`besideWith`, T16); on a phone the
full-screen reader. A found answer gives the entry its identity (`setDecisionEntryIdentity`); when another entry already
holds that decision the two merge — the survivor keeps the richer fields, its window, its row, its way-back entries and
the pending reveal follow, and it asks to take keyboard focus (`decisionFocusRequest`). The ways in:
the palette (a citation such as «Cass. civ. 10787/2024» is read by `decisionCitationParser.ts`
before the norm parser, unless the first word is one of the user's alias triggers), `DecisionLink` (a
plain click on the search page opens the decision beside the article and, given a `backEntry`, records
the jump in `readingBackStack` so «‹ Torna a art. 2043 c.c.» works as for a citation jump; any
other click follows the real `href`, which `DecisionAddress` turns into the same entry), the
sidebar's «Ricerca» (which also opens the palette: there is no decisions page), the Cronologia
(`DecisionHistoryRow`) and the address itself (queued in `pendingDecision`, drained by `SearchPanel`). The entry
persists its reference until the route has found it, then the identity (a cited section
travels with the reference to the route, which uses it to tell homonyms apart): the text is fetched again through `utils/decisionFetchCache.ts`.
The entry reads on the reading surface (`DecisionEntryView` over `DecisionAnswerBody`), where highlights and notes work as on an
article (see «A court decision takes the same tools»). «Cerca nella barra di ricerca», on a decision that was not found, opens the
palette with its citation typed in (`openCommandPaletteWith`, taken once). A subject has one mounted reading surface:
a row whose subject a window shows folds and says «Aperto accanto» (desktop only; a phone's reader replaces the table
instead), and the find window, the way back and the index reach the row or the window through the store's reveal actions.

**The host props.** Despite their names, `ArticleTabContent`'s `tabId` and `readingOrigin.tabId`, `DecisionReadingSurface`'s
`hostTabId` and `CaseLawSection`'s `tabId` name the host a surface reads in: a practice (its row) or one of its windows
(or the phone's reader), never a tab. They give the find window the id it registers the text root under (`findHostId` overrides
it with the window's practice), the way-back entry its `tabId`, and the links they render their `besideId`. A surface with no
host (a preview such as the palette's result card) registers and records nothing.

### Dossier

A dossier is where the articles needed for a task are aggregated and read.
It is **grouped by act** (spec `docs/superpowers/specs/2026-10-04-dossier-per-atto-design.md`).

- **The page by act**: `dossierLayout.ts` (pure) turns the items into sections —
  the notes first (`DossierNotesSection`), then one `DossierActBlock` per act in
  the order the acts entered the dossier, then «Giurisprudenza»
  (`DossierDecisionsSection`, the decisions in stored order). An act's identity is a code's name
  (the codice civile with or without its R.D. is one act) or `tipo_atto|numero_atto|data`;
  its heading is a code's name or the server's `act_citation`, never formatted
  here (a muted fallback until the server answers); its articles sort by annex,
  number and ordinal, the text in force before past texts. A block shows the
  act's title (`/fetch_rubriche` `title`, not for codes; an EU act's subject from
  its EUR-Lex page) and each row «art. N — rubrica» through `useActDetails` (one
  cached call per act; the tree only for an act in parts — `utils/actRubriche.ts`).
  The hook reads the whole act (`act`), never what the dossier's search left of it;
  what it read stays on screen while the act is read again and when a reading
  fails, and a block that mounts again shows it at once (the PDF falls back to it,
  `lastActTitle`). `/fetch_rubriche` answers
  200 even when the source failed, so `actStructureCache` keeps no empty answer:
  until 13 October 2026 one empty answer blanked the act's title for the session,
  and each new annex or search blanked it while it was read. Acts reorder by drag:
  `setDossierItemOrder` saves the whole order and waits, never sending a
  temporary id, while an added or restored item is pending
  (`pendingDossierOrders`). Articles do not drag. The header has three actions
  and a «⋯» (`ui/MenuButton`); «Seleziona elementi» lives there.
- **Notes**: every note a dossier gets from the web takes the notes route
  (`addNoteToDossier` → `POST /dossiers/:id/notes`), the one Claude's notes take
  through MCP. A note about an article (`aboutItemId`) sits with it: a count on
  the closed row, the notes above the text when open, «Aggiungi una nota
  all'articolo»; a note whose article is no longer in the dossier shows among
  the free notes. An entry an application wrote carries `ClaudeMark` (`components/ui/`,
  shared with Studia, its sentence `claudeMarkSentence` beside it; «scritta da Claude Code (applicazione collegata)», from `createdBy`). An undone removal
  gives the article a new id: `restoreDossierItem` reattaches its notes at once
  (`PUT …/items/:noteId {aboutItemId}`, reverted with a sync error if refused);
  an undone note comes back through the notes route, about its article if the
  article is still there. It comes back as the user's: no web route sets
  `created_by`, by design, so Claude's mark does not survive a web undo (the
  MCP trash, which keeps ids, restores it). The note dialog closes only once
  the server has the note, so a refused note keeps its text.
- **The trash** (what a connected application deleted, and the study cards the user deleted, 30 days; spec §10-11):
  one `useTrash` in `DossierPage` feeds «Cestino (n)» on the list (shown only
  when there is something), the page `?trash=1` (`TrashPage`: dossiers, entries
  «Da «dossier»», «Schede di studio» by their first questions) and a dossier's
  own «Rimossi di recente (n)» at its bottom (`DossierRecentlyRemoved`). Each
  entry (`TrashEntryRow`, `trashSummary.ts`) is restored whole — a 409 asks
  which dossier to restore into — or emptied behind a danger confirmation; a
  restore reloads that dossier from the server (`refreshDossier`). The web moves
  no dossier or entry to the trash: its own deletions there stay immediate, with an undo.
  Only study cards go through it: «Elimina» on a draft or an archived card in
  «Le mie schede» (`studiaService.trash`).
  A decision in the trash is named by the server's citation.
- **What another application changes shows without a reload** (`useDossierRefresh`, mounted by
  `DossierPage`): the open dossier (`refreshDossier(id, { quiet: true })`) or the list
  (`refreshDossiers`) is read again when the window comes back into focus or into view, and every
  minute while visible, at most once in 15 s; the trash joins the focus and the poll. Quiet reads
  only log a failure; they are skipped, or their answer dropped, while any dossier write is on its
  way (`dossierService.writesInFlight()`, counted around every write the service makes) or when the
  dossier (or the list) changed here while they travelled (Immer's new object); a dossier with an
  add, an undo or an order pending is kept as it is, never merged. The pushes a read may have
  beaten (`createDossier`, `importDossier`, `addNoteToDossier`) replace an entry with the same id
  instead of adding it twice. No websockets.
- **Decisions** (`type: 'sentenza'`): the item stores the identity, the attributes the item
  schema accepts and a label, never the text. They are added from the decision's reading surface
  («Aggiungi al dossier», `AddToDossierPopover` with `sentenza`) and listed after the acts under
  «Giurisprudenza» (`DossierDecisionsSection`: each citation links to the decision's address, and
  each row can be removed). The stored `etichetta` is a copy (source convention, D9):
  `decisionCitationOf` recomputes the citation from the identity and the attributes, every write
  sends it (`itemContentFor`, `serverItemFor`), the server recomputes it again on every write
  (`withDecisionLabel`), and every screen shows the recomputed one, never the copy.
  `parseSentenzaContent` (dossierUtils) mirrors `apps/server/src/schemas/decisionItem.ts`:
  change both together. Every switch over item types ends in `assertNever`, so a new type cannot
  fall silently into "note".
- **The PDF** (`dossierPdf.ts`) is grouped the same way and prints each
  article's text as the reader shows it, fetched through `articleFetchCache` —
  never a stored `article_text`, which items added through MCP or «Importa da
  norma» do not have.
- **Rows expand in place**: clicking a norma row renders `DossierItemReader.tsx`
  inline, reusing the dashboard reading layer (markers, `SelectionPopup`, note
  composer and popover). "Apri su Dashboard" and "Copia citazione" live in the
  expanded footer. `ArticleViewerModal` no longer exists.
- **Fetching**: `utils/articleFetchCache.ts` — session-only cache, in-flight
  de-dup, max 3 concurrent fetches, errors not cached so "Riprova" really
  refetches.
- **Important star**: reading statuses (unread/reading/done) were removed. The
  star persists through a `_dossierMeta` envelope packed into the item's `content`
  JSON — no backend schema change — via `packItemContent`/`unpackItemContent` in
  `dossierUtils.ts`. `updateDossierItemStatus` writes only `'unread' | 'important'`
  and defers the PUT while an item is still in `pendingDossierItemIds` (its
  `addItem` POST hasn't returned a server id yet), replaying it once settled.
  Legacy status values still hydrate and simply render as unstarred.
- **Collection**: `AddToDossierPopover.tsx` is the add-from-reading entry
  point for articles (from `ReadingToolbar`) and for
  decisions (`DecisionView`'s actions, with `sentenza`). It lists recent dossiers,
  guards duplicates, and its inline "Nuovo dossier" waits for the server id
  before adding — `createDossier()` returns `Promise<string | null>`.
  `DossierModal` is create-only.
- **Rows** (`DossierArticleRow`): the expand toggle lives on a header-scoped
  sub-div, never wrapping the reader or the action buttons (see gotcha 22); the
  star keeps a 44px touch target. The accessible name carries the server's
  `citation`, so two laws' art. 3 never read alike.
- **Versions**: an item keeps the version it was added with (`versione`,
  `data_versione`), whichever button added it (`normaForDossier` for the window
  header's), and `dossierContainsArticle` tells two versions of one article apart,
  so both can sit in one dossier. A row shows "Testo al 29/12/2007" for a past
  text; the reader is read-only on it (gotcha 32) and reopens it without Brocardi.
  The item key (`buildItemKey`) carries no version, by contract (annotations are
  keyed on it), so whatever caches, groups or compares items by article adds
  `versionKey` (`utils/versionDisplay.ts`): the reader's fetch cache
  (`articleFetchCache`), `computeNormaGroups`, `dossierContainsArticle`. "Apri tutto"
  and the quick-open of the list view build their searches from a group
  (`searchParamsFromGroup`, `searchesForGroups`) into ONE practice (`dossier/openInPractice.ts`): a
  group asking for a past text lands as rows of its act, beside the text in force; the dossier's
  decisions come too when the whole dossier is opened, unread (`addKnownDecisions`).

## Shared utilities — check before writing a new one

Duplicating any of these is a defect, not a shortcut.

**Frontend**:
- `utils/normaKeys.ts` — `buildItemKey(norma)` (norm + article),
  `buildNormaKey(norma)` (act only, used to group streaming results),
  `uniqueArticleIdFromNorma(norma)`. Both keys share their act-level segments so
  they cannot drift. `buildItemKey` is the annotation/highlight key contract and
  must stay byte-identical across dashboard and dossier.
- `utils/findInText.ts`, `utils/citationSearch.ts`, `utils/findHighlights.ts`, `utils/findScope.ts`, `utils/findTargets.ts`,
  `utils/findWindowControl.ts`, `hooks/useFindWindow.ts`, `hooks/useRegisterFindRoot.ts`,
  `hooks/useFindWindowScopedTo.ts` — find in the text:
  `findMatches`/`collectSearchableText`/`rangesForMatches` (folded, 1:1 offsets; `isSearchableQuery`
  is the one rule for «long enough»), the owner-keyed highlight registry (`setFindRanges`,
  `clearFindRanges`), and the window's scope, targets and hook (debounced typing, the current match
  kept across a redraw, re-search when the text changes). Read-only over the DOM. `features/search/findBarParts.ts` (`counterText`, `ICON_BUTTON`) is the counter and icon button of the window; `features/search/toolbarToggle.ts`
  (`toolbarToggleClass`) is the look shared by the toolbar toggles (`DiscussionButton`,
  `FindInTextButton`): add a toggle with it, not with a copy of the classes.
- `components/features/search/caseLaw/` — case law under an article: `CaseLawRow` (the one row),
  `caseLawYears.ts` (a row's years, the counts, the range, the order — pure), `caseLawFilter.ts` (the text
  filter, folded as the find window folds: `findMatches`), `authorityColor`, `caseLawFiltersContext`. A new
  source of case law draws `CaseLawRow` and reads `useCaseLawFilters`, it does not bring its own filter.
- `utils/actUrn.ts` — `resolveAct(params)`: an act's URN and identity with no article text
  fetched. It sends `article: '1'` because the endpoint refuses to build a
  `NormaVisitata` without one — a probe, not a request for article 1.
- `services/legalFetch.ts` — `legalFetch(path, init)`: `fetch` for the Python routes
  (`/fetch_*`, `/stream_article_text`, `/export_pdf`, `/parse_query`, `/health/detailed`…).
  It sends the login token (refreshing it first when expired, once more on a 401, through
  `api.ts`'s single in-flight refresh) because the production ingress refuses those calls
  without one, and it returns fetch's own `Response`, so the NDJSON stream and the PDF
  work as before. `/version` and `/health` are the two that stay open.
- `utils/decisionCitationParser.ts` — `parseDecisionCitation(input, { aliasTriggers })`: a decision as
  typed in the palette; it reads only an input that starts with a court and needs number and year,
  or a case of the Union («C-634/21», «causa T-612/17»: the letter names the court), or an
  administrative court («Cons. Stato, sez. VI, n. 2270/2019», «TAR Lazio, Roma, ord. n. 1234/2020»;
  a parere is left to the API, which names it as a court it cannot read). The Python
  API's `decisions/citation.py` reads the same words; both assert the golden file's `decision_citations`.
  `readDecisionCitation` returns the reference with where its words are (`headEnd`, `words`), and the
  parser exports its court-head sources (`COURT_HEAD_SOURCE`, `EU_COURT_HEAD_SOURCE`, …) for the scanner.
  `utils/decisionCitationMatcher.ts` — the decisions a running text cites: `extractDecisionCitations(text,
  { within, now })` gives `{ start, end, reference, path }` spans over the text (a court head, a bounded tail
  of 200 characters cut at the next head, at a sentence end, at «;», at a «)» it did not open and at the Gazzetta Ufficiale, handed to
  `readDecisionCitation`; the words between the court and the number must be citation words, no number of
  another, and an «e» right after the court, or an «e la sentenza» / «e la n.» before its number, ends its citation («Consiglio di Stato e la sentenza n. 7»); a list whose
  year is written once at its end («sentenze n. 96 e n. 229 del 2015») is one decision per number, only when nothing
  but citation words stands before it; a section written in words («sezione prima civile») is a citation word
  (the span links without a section: the parser reads the code of «sez. III», not of «terza»); the reference is read again from the span's own words; never inside an act's citation,
  `allActSpans`), and `wrapDecisionCitationsInHtml` (see «The decisions a text cites are links»). Pinned to
  the golden file's `decision_citations_in_text` (web only, no Python twin) by `decisionCitationMatcher.test.ts`.
  `utils/decisionFetchCache.ts` — `fetchDecisionCached`, one request per decision for the session
  (50 answers, least recently used out; a failure is not kept; `clearDecisionCache` at logout). `utils/workspaceOrigin.ts` — the id of the results area
  (`WORKSPACE_AREA_ID`) and its rectangle, which the find window and the row of windows are placed against.
- `utils/decisionLinks.ts` — the addresses of court decisions (`decisionPath`,
  `parseDecisionPath`, `decisionKey`, `identityFromKey` and `isDecisionKey`, which read a key back) and their names (`formatDecisionHeading`,
  `formatDecisionCitation`, and `formatDecisionShort` — «Cass. civ., sez. un., n.
  31310/2024 · Rv. …», for chips and lists — both pinned to
  `conventions/sources/golden.json`). The courts of the Union (`corte_giustizia_ue`,
  `tribunale_ue`) are named by their case (`/sentenze/corte-giustizia-ue/634/2021`, «Corte giust.
  UE, sez. I, sent. 7 dicembre 2023, causa C-634/21»); their closed values and labels live in
  `utils/euCourts.ts`, the twin of the server's `norms/euCourts.ts`. The administrative courts
  (`consiglio_di_stato`, `cgars`, `tar`; design `docs/superpowers/specs/2026-10-12-administrative-courts-design.md`)
  carry the kind (`provvedimento`) and a TAR its seat in the identity
  (`tar:roma:ocau:1234:2020`, `/sentenze/tar-roma/1234/2020?provvedimento=ocau`; a sentenza's path
  names no kind); a reference the words left open is keyed `/sentenze/tar/…?regione=Lazio` and
  `?tipo=ordinanza`, never taken for an identity. Their seats, names and closed values live in
  `utils/adminCourts.ts`, the twin of the server's `norms/adminCourts.ts`, its `SEATS` pinned to
  `conventions/sources/tar-seats.json`; `brocardiDecisionRef` reads the court a Brocardi
  massima is headed with. Never write a decision's label inline. The paths
  `/sentenze/<corte>/<numero>/<anno>` are a contract with LibreLex and the MERL-T graph: never
  rename them (spec `docs/superpowers/specs/2026-10-01-sentenze-design.md`). Its first block is
  shared with the Massimario panel (`linkableDecisionPath`); `httpsUrl` keeps a source link to
  https only.
- `services/decisionService.ts` — `fetchDecision(reference)`: `POST /fetch_decision` through
  `legalFetch`. Only the route's six `esito` values are read as its answer: a quota refusal, or
  any other body (the rate limit's, the login gate's, a framework page), is "fonte non
  raggiungibile", and `errore_interno` a generic error; neither is ever "non trovata".
- `utils/decisionText.ts` + `features/decisions/DecisionTextView.tsx` — a decision's text, one
  span per line: the text nodes spell the received text minus `\n` (the same contract as
  gotcha 23), labels and the space between lines come from CSS, and a copy is composed by
  `decisionClipboardText` so it reads as the page does. An epigrafe without a motivazione is
  labelled «Testo» (the owner's decision); a decision found without its text draws no block
  (`hasDecisionText`).
- `utils/returnTo.ts` — where the login sends the reader back: router state or the
  sessionStorage stash, only what the browser's URL parser reads as a path of the app, never a
  URL parameter; a logout forgets it.
- `utils/readingBackStack.ts` — `appendBackEntry`, `peekReadingBack`,
  `findLiveBackIndex` (over the practices), `ReadingBackEntry` (what a surface pushes) and `PracticeBackEntry`
  (what the stack holds) for citation-jump undo.
- `utils/practice.ts` (+ `utils/practiceMigration.ts`) — the practice's model and its rules, pure: `practiceArticleKey`
  (`buildItemKey|versionKey`, what makes a row), `sanitizePractices` (saved state is untrusted input), `addArticles`,
  `findPracticeArticle` (tolerant, gotcha 9), `decisionOrder`, `holdsSubject`/`subjectOfRef`, the row and window
  keys (`articleRowKey`, `decisionRowKey`, `articleWindowId`); `practicesFromTabs` reads the old saved workspace once.
  Reach for these before writing a second comparison of two articles.
- `hooks/useIsDesktop.ts` — viewport check for components that must render
  *structurally* different markup per breakpoint (portal vs. inline). It existed
  as two private copies before round 2a; do not make a third. For anything a CSS
  breakpoint can express, use the CSS breakpoint.
- `utils/articleSuffixes.ts` — `ARTICLE_ORDINAL_SUFFIXES` and
  `ARTICLE_SUFFIX_ALTERNATION`, the one ordinal table behind every article-number
  regex (`citationMatcher`, `citationParser`, `treeUtils`, `articleStructure`).
  Mirrors `services/visualex/visualex_api/tools/article_suffixes.py`, as does
  `apps/server/src/utils/articleSuffixes.ts` — change all three together. Each
  pattern must close the alternation with `\b`.
- `utils/articleIds.ts` — `getUniqueArticleId(article)` (canonical `allN:num`),
  `filterLoadedIdsForAnnex(ids, annex)`, `findArticleByNormalizedId(articles, id)`
  (**tolerant** lookup — required, see gotcha 9).
- `utils/dateUtils.ts` — `parseItalianDate`, `formatDateItalianLong`,
  `expandTwoDigitYear` (the one two-digit-year pivot, same as the backend's
  `_expand_year`: "90" → 1990, "23" → 2023), `formatDateDashed` ("29-12-2007",
  the way Normattiva writes a day), `formatDateForCitation` ("1° ottobre 2026"),
  `withPreposition` (a preposition and the date it governs, elided before 8 and
  11: "dall'11 giugno", "all'8 settembre"; the version banners and the citations
  (`consultato il …`) go through it, and so does any new sentence that
  puts a spelled-out date after "il", "del", "dal", "al" or "nel"),
  `addDaysToIsoDate`, and `todayInRome` (the day the server compares a
  `version_date` with; the browser's own day can differ).
- `utils/versionDisplay.ts` — `describeVersion(validity, request)` (chip, banner,
  what is shown and what is off: `readOnly`, `doctrineVisible`, `textVisible`,
  `canCite`, `canCopyOrSave` with its reason `copyBlockedReason`,
  `updateNotesOpen`), `versionKey` (which text a request asks for, as one string),
  `requestIsHistorical` (mirrors the server's
  `is_historical_request`), `deriveVersionInfo`, `isEuropeanAct` (mirrors
  `get_scraper_for_norma`), `buildTextAtDateParams`, `versionTabSuffix`,
  `historicalItemLabel`. Every surface that renders article text goes through
  it (gotcha 32).
- `utils/citation.ts` — `formatNormCitation` (null when there is nothing honest
  to cite: the text in force with no day, an act of the Union, an article that did
  not exist, a version that does not contain the day, a repealed article with no
  repeal day stated; its head is `citeNorm`), `unversionedCitation` (what a copy
  starts with when no version is cited: the text in force's, never on a past text)
  and `withCitation(text, citation, inForce)`, which puts the citation first — the
  version's, else `inForce` (`unversionedCitation`); the wording is the golden file's.
- `utils/euCitation.ts` — the one reading of an EU pair ("2024/2847" is year
  then number, "679/2016" the reverse, "2006/2004" number first), shared by
  the palette parser and the in-text matcher and mirrored by
  `resolve_eu_year_and_number` in `nl_parser.py`, which `citation_linker.py`
  reuses through `build_eu_act_pattern` / `eu_act_from_groups`. Change all
  four together. The two in-text detectors (`citationMatcher.ts`,
  `citation_linker.py`) read the same prose forms: "regolamento (UE)
  2016/679, art. 5", "art. 5 del regolamento (UE) 2016/679", "art. 5, comma
  1, del …", and a list ("articoli 8 e 9 del …") becomes one link per number,
  all towards the EU act. The matcher also reads documents a user drops in, so its patterns read a run of
  spaces in one way only (`\s*(?:,\s*)?`, never `\s*,?\s*`; two adjacent `\s*` are quadratic) and its used
  ranges are a byte map, not a list: `citationMatcher.test.ts` and `citationParser.test.ts` (the palette's parser, `extractArticleRefs`) time 100 000-character runs. The client matcher reads the article-first form
  for numbered national acts too ("art. 7 del d.lgs. 196/2003", with or
  without the preposition), as the server's `_EXPLICIT_CITE_RE` and
  `_ART_DEL_ACT_RE` do, and the codici and the Costituzione named in full
  ("art. 5 del codice civile") through `FULL_ACT_NAMES`, the palette's own
  vocabulary. An article the prose gives to an act no pattern can read
  ("art. 17 della legge 23 agosto 1988, n. 400") gets no link on the
  client rather than one to the act being read.
- `utils/sources/` — how a norm is written, for each use (the source convention,
  `docs/superpowers/specs/2026-10-04-source-convention-design.md`; pinned to
  `conventions/sources/golden.json` by `sources/__tests__/golden.test.ts`):
  `citeNorm` («art. 2, l. 7 agosto 1990, n. 241», «art. 2043 c.c.»), `shortNorm`
  («art. 2 l. 241/1990»: rows of an article, comparison, chips, quick norms),
  `citeAct`, `shortAct` (an act's short label), `actHeading` (a code's name, else the act
  citation: an act block's title), `actSubtitle`, `inForceCitation` (what a copy
  of the text in force starts with, D8), `labelFromParams` (the parsers'
  previews), `normFromUrn` (a Normattiva URN or an ELI read back into a norm; the
  preleggi are never the codice civile). `actTypes.ts` holds the tables; its
  `CODES_TABLE` is a copy of the API's `NORMATTIVA_URN_CODICI`, and the golden test
  fails when the two differ. Never write a norm's label inline: a new surface
  picks one of these.
- `utils/sources/normEntry.ts` — `rebuildNormEntry`: a norm from someone else (a shared
  environment, a file, a share link) rebuilt from closed values — a known act type, fixed forms,
  unknown keys dropped — or refused with an Italian reason. `validateImportedDossier` runs it on
  every imported norm and counts what it leaves out. A copy of the server's, both pinned to
  `conventions/sources/norm-entries.json`.
- `utils/normaMeta.ts` — `formatNormaMeta(norma, articleCount?)`, the line under an act's
  heading (`actHeading`, `utils/sources/`): only
  what the title does not say (a code's decree, an aliased code's name, «Estremi
  non disponibili»), often empty.
- `utils/articleFetchCache.ts` — `fetchArticleForNorma`, cached and capped.
- `utils/articleStructure.ts` + `utils/articleRender.ts` — the structured
  reading text (see Reading surface). `parseArticleStructure`, `getRubricText`,
  `getUpdateNoteParagraphs`; `renderArticleHtml` is what `useArticleMarkers`
  calls. Real test texts in `utils/__fixtures__/articleTexts.ts`.
- `utils/selectionOffset.ts` — `getSelectionAnchor(root, selection)` (text and
  plain-text offset of a selection, from the DOM text) and `plainOffsetAt`.
  Every surface that creates a highlight or an anchored note goes through it.
- `hooks/useArticleTextInteractions.ts` — the update-note chips, the
  foldable AGGIORNAMENTO tail and the annotation signs (`openBlock`), for any
  surface that renders structured text.
- `utils/articleAnnotations.ts` — `resolveAnchors`, `groupAnnotationsByBlock`,
  `highlightsWithoutSign`, `describeBlock` (a block named by its printed enumerator or its opening
  words, never a computed number). The renderer and the block popover both
  read it: never re-derive where an anchor lands anywhere else.
- `utils/revealAnnotation.ts` — `revealAnnotation(root, { kind, id }, near?)`:
  scroll to an annotation and make it glow. The block popover and Study
  Mode's summary.
- `utils/floatingOrigin.ts` — `getTransformOrigin(placement)` for a popover's
  entry animation.
- `utils/blockAnchorRect.ts` — `blockAnchorRect` / `signReference`: the
  rectangle and the virtual reference a block's popover is placed against.
- `hooks/useNoteEditing.ts` + `features/search/NoteCard.tsx` — a note edited in
  place; the Notes panel and the block popover.
- `hooks/useArticlePassageThreads.ts` — one signature, `(anchor, { enabled?,
  plainText? })`: the anchor comes from the caller. Loads passage discussions for
  the signs via `GET /article-discussions/passages` and, given `plainText`, returns
  `locations` (the one place a passage is found or `detached`). Used by the article
  surface and the decision's surface.
- `utils/threadPassages.ts` — `buildPassage`, `textFingerprint`, `locatePassage`
  (exact → whitespace-tolerant search → the occurrence whose context agrees;
  never guesses: ambiguous or missing = `detached`).
- `components/features/dossier/dossierUtils.ts` — `searchParamsFromNorma`,
  `packItemContent`/`unpackItemContent`, `dossierItemFromApi`/`serverFieldsFromApi`
  (a server item as the store holds it: citations, `aboutItemId`, `createdBy`), `computeItemCounts`, `dossierRecency`,
  `dossierContainsArticle`, `normaForDossier`, `computeNormaGroups`,
  `formatTimestampLong`.
- `components/features/dossier/dossierLayout.ts` — `layoutDossier`, `actKeyOf`,
  `codeName`, `compareArticles`, `articleLabel`, `foldedArticleList`,
  `dossierItemOrder`, `actsSummary`: the dossier by act.
- `utils/actRubriche.ts` — `matchRubrichePart`, `rubricheFor`, `abrogatiFor`:
  which article titles belong to the articles in view. An act in parts gets the
  part matched by article numbers (on a tie, the one of the annex's size; still
  tied, none) and never the top-level map, which can be an annex's (d.lgs.
  196/2003). The index window and the dossier use it.
- `components/ui/MenuButton.tsx` — the one menu button (arrows, Home/End,
  Escape/Tab, focus return, click outside; clicks never reach the card).
- `hooks/useAnnexNavigation.ts` — shared tree fetch + annex switch + load article.
- `utils/deepLinks.ts` — `buildSearchDeepLink(params, articleId)` /
  `parseSearchDeepLink(value)`: the `?norma=` share link (base64url JSON with
  an optional article to focus, which `SearchPanel` focuses even inside a
  range). `SearchPanel` still reads the older `?share=`.
- `utils/searchFilters.ts` — `matchesSearchFilters(article, filters)` for the
  palette's source / Brocardi / historical / year filters, applied
  client-side to each streamed result. `SearchPanel` counts what a filter
  drops and, when nothing got through, says so instead of showing an empty
  search.
- `utils/normaChanges.ts` — `normaFromChangeNotification` /
  `normaChangeLabel`: reopen and label a change notification from the
  snapshot the server stored (null, not a guess, when the snapshot has no
  identity).
- `hooks/useForumNotifications.ts` — the one 30s poller behind both sidebar
  badges (Forum `total`, Cronologia `normaChanges`).
- `hooks/useServiceHealth.ts` + `ui/ServiceHealthBanner` — probes
  `/api/health/detailed` (Node, a `SELECT 1`) and `/health/detailed` (Python, which reaches
  Normattiva, EUR-Lex and Brocardi for real). Once on mount, then every
  **5 minutes** per visible tab, plus "Ricontrolla"; the Python answer is
  cached server-side for `HEALTH_DETAILED_TTL`. Do not tighten either loop —
  the first version polled every 60s per tab.

## UI Conventions

Non-obvious rules baked into the codebase. Follow them so new surfaces stay
coherent.

**Destructive confirmations** — never `window.confirm`. Use
`components/ui/ConfirmDialog` with `variant="danger"`, and word the message so it
names the scope *and* what is not touched ("Segnalibri e dossier non saranno
toccati").

**Keyboard-accessible collapsibles** — a `div` that toggles on click needs
`role="button"`, `tabIndex={0}`, `aria-expanded`, a dynamic `aria-label`
(espandi/comprimi), and `onKeyDown` for Enter/Space with `preventDefault()`. The
handler must start with `if (e.target !== e.currentTarget) return;` or interactive
children re-trigger the toggle. Always add
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`.
Never nest interactive content inside the element carrying `role="button"` —
scope the role to the header, as `DossierArticleRow` does. A collapsible whose header
is a section heading follows the accordion pattern instead (`DossierActBlock`):
the toggle sits inside the `<h3>`, its name is the heading's own text and its
state is `aria-expanded` alone, with no `aria-label` replacing what it says.

**Popovers with `@floating-ui/react`** — split positioning and animation across
**two** elements: outer div takes `refs.setFloating` + `floatingStyles`, inner div
owns the entry animation. On the same element the scale transform overwrites the
positioning transform. Compute `transformOrigin` from `placement` (`getTransformOrigin`,
`utils/floatingOrigin.ts`). Anchor via a `useState` element,
not a ref object, and pass it at render time (gotcha 13).

**Toggle buttons** — drive the visual from an `isPressed` selector, not a fixed
colour: idle `text-slate-400` + hover accent, active `bg-{accent}-50
text-{accent}` (plus `fill-` when the icon has a body). Toast wording must match
the action actually taken. Always set `aria-pressed`.

**Two flavours of pop-up** — *Peek* (header, scrollable body, composer; ~360px,
page-themed) when the surface lists or edits content; *action bar* (thin dark
slate, 2-4 icon buttons with 1px dividers, no chrome) when it only performs
actions. Both use the outer/inner split above.

**Sticky filter rows** — `sticky top-0` alone lets content scroll through. Give
the row an opaque background matching the panel, bleed it edge-to-edge with
negative margins matching the parent padding, add `border-b border-current/10`,
and raise it to `z-20`.

**Stacking** — use the bands in `constants/zIndex.ts` (`pinnedBar` 35, `sidebar` 50, `dock` 80 — the bar of practices —,
`bottomNotice` 85 — MERL-T's consent prompt, over the bar —, overlay band
1000+), never a bare literal. See gotcha 22 before assuming a
z-index will be honoured. An overlay above `findWindow` (110) that covers the
workspace carries `aria-modal="true"` (a real modal dialog) or `data-find-overlay`,
or Cmd/Ctrl+F opens the find window hidden under it.

**Beating inline `style="..."` without `!important`** — when markup you don't
control ships inline styles (e.g. `useArticleMarkers` emits
`<mark style="background-color:hsl(var(--hl-yellow-bg))">`), first try
**redefining the CSS variable in a narrower scope** so the inline `hsl(var(--…))`
resolves differently. Only if the inline style references no variable, fall back
to a single narrowly-scoped `!important` with a comment justifying why every
other route fails.

**Colour markers** — for a list mirroring something already coloured in the
article body, use a 4px stripe down the card's leading edge rather than
re-applying a saturated background behind the text.

**Mobile-first** — interactive controls keep a 44px touch target on mobile.
`TOUCH_TARGET_RESPONSIVE` in `constants/interactions.ts` covers the height only
(`min-h-[44px] md:min-h-0`); icon-only buttons need the width too, so they carry
`min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0` explicitly — as the dossier
row's star and remove buttons do.

## Common Patterns

**New frontend component** — compose the `ui/` primitives and the interaction
constants; import types from `types/index.ts`; reach state through
`useAppStore()`; Tailwind v4 for styling.

## Critical Files

Breaking one of these breaks the product. Read before editing.

**Frontend core** — `store/useAppStore.ts` · `types/index.ts` · `services/api.ts` ·
`services/legalFetch.ts` · `utils/normaKeys.ts` · `utils/articleIds.ts` · `utils/articleSuffixes.ts` ·
`utils/articleStructure.ts` · `utils/articleRender.ts` ·
`utils/articleAnnotations.ts` · `utils/dateUtils.ts` ·
`utils/normaMeta.ts` · `utils/articleFetchCache.ts` · `utils/actUrn.ts` ·
`utils/readingBackStack.ts` · `hooks/useAnnexNavigation.ts` ·
`hooks/useIsDesktop.ts` · `constants/zIndex.ts` · `constants/interactions.ts`.

**Frontend features** — each of these folders was split out of a monolith and is
meant to stay split; add new features as new files, not inside the shells:

- `features/dossier/` — `DossierPage.tsx` is a thin shell routing list/detail via
  `?dossier=<id>`; `DossierListView.tsx` (grid, context menu, shortcuts `n` `/`
  `i`), `DossierDetailView.tsx` (sections and header), `DossierActBlock.tsx`
  (an act and its rows), `DossierArticleRow.tsx` (row + star + expand),
  `DossierNotesSection.tsx`, `DossierItemReader.tsx` (in-place article),
  `AddToDossierPopover.tsx`, one file per modal, shared helpers in
  `dossierUtils.ts`, `dossierLayout.ts`, `dossierPdf.ts`, `useActDetails.ts`.
- `features/environments/` — `EnvironmentPage.tsx` shell + `EnvironmentCard.tsx` +
  one file per modal; `EnvironmentContentViewer.tsx` renders the shared
  dossier/quickNorm/alias/annotation/highlight tree. Cards carry a category
  stripe and a stale/fresh chip; primary action is "Unisci", replace lives in the
  3-dot menu behind a danger `ConfirmDialog`.
- `features/bulletin/` — the Forum. Folder and component names stay `bulletin`
  because they match the backend `SharedEnvironment` model; the route is `/forum`
  and the UI label is "Forum". `BulletinBoardPage.tsx` is a shell over three dumb
  views (`ForumExploreView`, `ForumMyEnvironmentsView`, `ForumSuggestionsView`).
  The suggestion flow adds `SuggestionReviewDialog`, `EditSuggestionDialog`,
  `SuggestionItemCard` (all five itemTypes), `AliasConflictDialog`,
  `AddItemsDialog` and `AttributionChip` (see gotchas 20-21).
- `features/search/` — `ArticleTabContent.tsx` (the reading surface),
  `ArticleBody.tsx`, `NotesPeekPanel.tsx`, `InlineNoteComposer.tsx`,
  `InlineNotePopover.tsx`, `UpdateNotePopover.tsx` (a Normattiva update note,
  opened from its `(119)`), `BlockAnnotationsPopover.tsx` (a block's notes and
  highlights, opened from its sign), `NoteCard.tsx`, `LooseHighlightsList.tsx`, `HighlightsActionsPicker.tsx`, `ReadingToolbar.tsx`,
  `SearchPanel.tsx` (streaming merge logic, and the mount point for both
  `CommandPalette.tsx` and `AliasManager` — see gotcha 27),
  `TreeViewPanel.tsx` (the article index window).
- `features/settings/` — `AliasManager.tsx` and nothing else. Named for what it
  edits, not for where it opens: it is reached from the command palette, not
  from Settings (gotcha 27). See the Aliases section above.
- `features/workspace/` — what a practice's rows borrow from the old workspace: `LazyStudyMode` (the
  `StudyMode/` bundle behind `lazy()`; `PDFViewer` and `CompareView` are lazy the same way) and
  `ArticleNavigation` (an act's previous/next arrows). The floating tabs, their dock and their panels are gone
  (round 6 of the norm-tab redesign).
- `features/practice/` — the practice, the norm-tab's replacement (spec
  `2026-10-08-norm-tab-container-design.md`): `PracticeTable` (the active practice on the desktop:
  header with name, count line, a «Salva come dossier» button and «⋯», the streaming bar, then
  `PracticeColumn`; the topic searches are windows beside it on the desktop and the full-screen reader's
  subject on a phone); `PracticeColumn` (the acts, dragged
  into order, then «Giurisprudenza»; it takes the reveal once) of `PracticeActBlock` (an act: its sticky
  heading with Studio, Struttura, PDF and «⋯», the index line of its rows, the rows; the structure
  window on the desktop, the drawer on a phone), `PracticeArticleRow` (an article, its reader mounted
  only while open) and `PracticeDecisionsSection` (the decisions, newest first, read in place through
  `DecisionEntryView`), both rows on `PracticeRowShell` (the header-scoped toggle, «Togli dal tavolo»,
  «Apri accanto» (on the desktop a row whose subject a window shows folds and says «Aperto accanto ·
  Chiudi la finestra», so one subject has one mounted reading surface, T5; on a phone it opens the
  full-screen reader, icon-only so the row's name keeps its width, and no row ever folds));
  `PracticeBar` + `PracticeChip` (the bar of practices, `fixed bottom-6`, `Z_INDEX.dock`, `#tour-practice-bar`; a «⋯» per chip);
  `PracticePhoneView` (the phone's table: chevrons, the name — a tap lists the practices with «Nuova
  pratica» — and dots, the count line with «Salva come dossier» and its «⋯» (`usePracticeSaveActions`),
  over the same column; while `phoneReader` is set it draws `ReadingFullScreen` in the column's place
  — the column is not kept mounted under it, gotcha 26 — and gives the column back at the scroll
  position of the page's content scroller it left, asked for again while the remounted column grows
  until reached, the user scrolls or 3 s pass) and `ReadingFullScreen` (the phone's reader, T19:
  «‹ Pratica» at 44 px, the title, and `ReadingWindow`'s own body — `ReadingWindowBody` — for what
  `phoneReader` names: an article, a decision or a topic search). `phoneReader` (`{ practiceId, ref }`)
  is session state of its own, never saved and never the desktop's `beside`: `openPhoneReader`,
  `closePhoneReader`; on a phone `openDecision(…, { fromLink: true })` and `openTopicSearch` set it and touch
  neither `beside` nor the rows, the way back sets or clears it, a screen that widens clears it
  (`SearchPanel`), a reload starts on the table; every reveal of a row, the act's index and any other
  practice coming on screen (`activate`) clear it in their own update, and it is drawn only for the
  active practice. The practice list (a tap on the name) has «⋯» per practice: Rinomina, and Chiudi la
  pratica behind the chip's danger confirmation;
  `PracticeParts` (the migration's notice, taken once and mounted by `SearchPanel` over both layouts, in
  the toast band; the empty practice; the name editor); `practiceView.ts` (helpers kept out of the
  component files). `ReadingRow` (the table and the active practice's windows beside it, `ReadingWindow` each, on widths
  from the pure `besideLayout`: half and half, thirds from 420 px a column, else a 48 px rail that opens
  the table as an overlay closed by Esc or a click outside; `SearchPanel` mounts it on the desktop in
  place of the bare table, and with a window beside it reaches past the search page's `ReaderLayout` cap (`max-w-5xl`, about 960 px) to the scroller's
  width, measured, for that row only) and `ReadingWindow` (the light window: title, «Chiudi», a scrolling body with
  the column's bottom padding, the body by kind; it reads under its own id and passes its practice as
  `findHostId`, and an article as `ArticleTabContent variant="beside"`: the compact `ReadingToolbar`
  (notes, highlights, discussions, the magnifier and copy), Brocardi in a `ClosedSection`, and no Studio,
  Studia row, MERL-T entry or graph rail; the `row` variant is the table's). «Salva come dossier» and «Aggiungi a un dossier…» (spec §7): `practiceDossierItems`
  (pure: the items in table order, each article from its own `norma_data`, a code's search and index
  copies one item; `dossierHoldsArticle`), `useSavePracticeAsDossier` (create first, add, order once,
  wait for the items to settle and count them; one save at a time per practice, `usePracticeSaving`),
  `usePracticeSaveActions` (the header's button, the «⋯» entries, the picker and the outcome's toast,
  portalled in the toast band: inside the bar a `fixed` child would be placed against it, gotchas 22
  and 26) and `PracticeDossierPicker` (a `ui/Modal`). Three CSS variables carry measured heights:
  `--practice-head` (the act block's heading, sticky from `md` up over the open rows' toolbars
  (`Z_INDEX.stickyHead`); on a phone it wraps and scrolls with the block, and the variable is 0; the
  rows' scroll margin reads it, and an open row passes it on as `--reading-toolbar-top`, which
  `ReadingToolbar` reads with a `0px` fallback, so the toolbar pins under the heading and is unchanged
  elsewhere) and `--practice-bar-height` (the bar's
  height, set by `SearchPanel` on the workspace area: the column's bottom padding keeps its last row
  clear of the bar).
  The tours start here: `PracticeTable` asks for the `practice` tour once (the bar, the header, «Salva come dossier», an act)
  and, when it is done, for the `practiceAct` tour, which the practice's first `PracticeActBlock` also asks for once the
  table's has been seen (`config/tourConfig.ts`; their targets are `#tour-practice-bar`, `#tour-practice-header`,
  `#tour-practice-save`, `.practice-act`, `.practice-act-head`, `.practice-act-index`, `.practice-row-beside`,
  `.practice-act-study`, `.practice-act-structure`, plus the reading bar's `.glass-toolbar` and Brocardi's
  `.brocardi-display`; `tourConfig.practice.test.tsx` fails when one is missing). Tours never overlap: `useTour` keeps one driver on screen
  module-wide, so a tour asked while another shows is not started (it is asked again the next time its
  surface mounts, and a tour not seen stays unseen), and `tryStartTour` looks at «seen» again when its delay ends;
  `practiceAct` is asked only for a practice that has an act. `tourConfig.targets.test.tsx` fails when a tour's
  target is written nowhere in the sources, and checks the search tour against the search page.
  `SearchPanel` mounts them (imported statically: the table is the app's main surface; `PDFViewer`, Study Mode and
  `CompareView` stay behind `lazy()`), one layout per breakpoint (`useIsDesktop`); a decision opened from any link lands in its practice
  and opens beside on the desktop (the window a link was clicked in is never the one a third window
  replaces) or in the full-screen reader on a phone (`isDesktopViewport`), a norm cited in a window (or
  in the reader) enters its act and opens beside that window (in the reader, on a phone; `SearchPanel`:
  `besideId` naming a window or the reader's subject), and searches, the index, topic searches and
  the dossier's «Apri tutto» (`dossier/openInPractice.ts`: one practice, its decisions unread, identified
  from what the dossier kept, `addKnownDecisions`, so «Salva come dossier» saves them back) land in
  the practices.
- `features/history/` — `HistoryView.tsx`, `DecisionHistoryRow.tsx` (a decision's row) plus
  `NormaChangesSection.tsx` (see History above).
- `features/documents/` — `DocumentReviewPage.tsx` only.

## Gotchas

9. **Article id formatting (`-bis` / `-ter`)** — the tree API and the scraper
   disagree (`"1-bis"` vs `"1 bis"`). Server-side both are now canonicalised
   through `normalize_article_key` (`services/akn_parser.py`), which reads the
   ordinal from `tools/article_suffixes.py` and falls back to "any alphabetic
   tail" for anything that table does not list — Normattiva goes well past
   `decies` ("2409 octiesdecies" c.c.). On the frontend the tolerant
   `findArticleByNormalizedId` is still required: a naive `===` silently misses
   and falls back to the first article. Always use it, then canonicalise with
   `getUniqueArticleId(match)` before storing in state. The accepted forms now
   include the dotted sub-number (`270-bis.1`, `171-octies.1`), the slash
   (`314/2`) and multi-token ordinals (`135-sex-decies`), on both the server
   normaliser and the archive (`tools/archivio-normativo/archivio_normativo/hierarchy.py`).
10. **Popover positioning vs entry animation** — floating-ui positions with an
    inline `transform`; an `animate-in zoom-in-95` on the *same* element
    overwrites it and the popover flies from (0,0). Split across two elements.
11. **`set-state-in-effect`** — prefer deriving the value during render over
    silencing the rule. Silence only for effects synchronising with an external
    signal *and* mutating external state in the same transaction, and always
    leave the justification on the disable line.
12. **A practice and its windows have no pin** — the old tab pin only suppressed
    bring-to-front, which contradicted the word "pin", and the floating tabs it
    belonged to are gone: a practice is a table and its windows are placed by
    `besideLayout`, not dragged and raised. Don't reintroduce without a product
    reason. `Dossier.isPinned` is unrelated and stays.
13. **Popover first paint at (0,0)** — floating-ui computes position
    asynchronously. Registering the reference in a layout effect leaves the first
    paint uncoordinated. For DOM anchors pass
    `useFloating({ elements: { reference: anchorEl } })` at render time. For
    **virtual** elements that path throws, so use `refs.setPositionReference()`
    plus `visibility: isPositioned ? 'visible' : 'hidden'`.
14. **StrictMode double-invoke + multi-step store actions** — an effect issuing
    two separate mutations runs both twice against the same closure value.
    Collapse them into one atomic store action (`drainNextSearch` is the
    canonical example) so the second invocation finds the precondition already
    satisfied and no-ops.
15. **Dossier "apri tutte le norme"** — `triggerSearch` overwrites the trigger, so
    a loop keeps only the last. The flow queues params and drains them one at a
    time; each carries `tabLabel` (cosmetic) and `targetPracticeId` (load-bearing —
    names the practice every search lands in, and keeps a reveal off the queue).
    The destination practice is created synchronously before `navigate('/')`
    (`searchesIntoOnePractice`, which passes its id on every search). Without
    `targetPracticeId` the results land in whichever practice is active when each
    arrives.
16. **Capture the selection rect eagerly** — before `hidePopup()` /
    `removeAllRanges()`, because the selection is gone immediately after. The rect
    travels through `onAddNote(text, startOffset, rect)`.
17. **Every user-owned slice is server-backed** — every create/update/delete must
    round-trip the backend. The canonical regressions were `importDossier` and
    `applyEnvironment`, which pushed a local `uuidv4()` into the store; the UI
    looked fine until the first `addItem` 404'd on a ghost entity. Creation goes
    through `service.create()` first so the store holds server ids; mutations are
    optimistic + sync + revert. `applyEnvironment(replace)` also wipes
    server-side first, gated behind a danger `ConfirmDialog`. The one deliberate
    exception is the practices (spec D6): UI state, browser-only, saved in
    localStorage and never sent to the server.
18. **Never silently swallow errors in load paths** — `.catch(() => [])` in
    `fetchUserData` once hid a backend restart behind an empty UI for a whole
    session. Log with context before any fallback.
19. **Atomic usage counters** — `usageCount` bumps go through `POST /:id/use`
    (`increment: 1`), never a read-modify-write PUT. Client pattern: bump locally
    for instant feedback, then fire-and-forget `service.use(id)`; the next
    `fetchUserData` is the source of truth.
20. **SuggestionItem payloads are server-trusted, except a dossier's entries** —
    the `take` handler trusts the stored shape, so any rename must happen before
    storage. That is why the alias Rename path is deferred; Replace and Skip cover
    the flows. A dossier proposal is the exception: the server rebuilds each entry from
    closed values when it is stored and when it is taken
    (`apps/server/src/utils/suggestionEntries.ts`: a norm of a known act type, a decision
    through the item schema) and, if any is not accepted, refuses the whole proposal with an
    Italian 400 naming the entry and the field, and applies nothing.
21. **`sourceSuggestionId` + `originalAuthorId` are the attribution contract** —
    never mutate or filter them out. If a row has an author, the UI shows the
    `AttributionChip`; a deleted author renders "@utente-rimosso" by design.
22. **A z-index is inert on a `static` element, and `backdrop-filter` traps its
    descendants.** The sidebar was `lg:static` with `z-50` (never applied) *and*
    `backdrop-blur-xl`, which creates a stacking context — so its hover tooltips
    could not escape it no matter how high their own z-index went, and page
    content painted over them. Before reaching for a bigger number, check that the
    element is positioned and that no ancestor sets `backdrop-filter`, `filter`,
    `transform`, `opacity < 1` or `isolation`. Fix the ancestor or portal out;
    raising the child's value does nothing.
    The sidebar's navigation scrolls on its own in a low window (`overflow-y-auto`, which clips what hangs
    out of it) and the document never scrolls (`Layout`'s root is `h-app overflow-hidden`: `index.css`'s utility, `100dvh` with a `100vh` fallback; the practice row's columns are `h-app-row`, that less the content area's 4 rem of padding), so its
    labels are portalled to the body (`SidebarTooltip`), placed from the control's rectangle; they show
    for a mouse pointer and on keyboard focus-visible (never after a tap or a click), and go with Esc, a scroll
    or a resize.


26. **A portal escapes `hidden md:block`, so a CSS breakpoint cannot gate it.**
    `display: none` hides descendants, but a portal re-parents to `document.body`
    and leaves the hidden subtree behind — the desktop renderer would surface its
    window on a phone, next to the mobile one. Anything portalled that exists in
    only one breakpoint needs a real viewport check (`useIsDesktop`), not a
    wrapper class. Conversely, a non-portalled `fixed` element inside a
    transformed ancestor is positioned against *that ancestor*, not the viewport
    (see gotcha 22) — which is why the structure window portals at all. The practice
    is the standing example: `SearchPanel` mounts `ReadingRow` (the table and the
    windows beside it) on the desktop and `PracticePhoneView` below `md`, one of the
    two by `useIsDesktop`, never both under a CSS class; the phone's reader is
    `phoneReader` state, not a hidden copy of a window.

27. **A store flag only opens a modal that is actually mounted.** `AliasManager`
    (and its siblings) render inside `SearchPanel`, so `aliasManagerOpen` is
    inert on `/dossier`, `/history` or any route that is not the search page —
    the flag flipped and nothing appeared, silently. That is why the alias
    manager is reached from the command palette, which lives in the same subtree,
    and why the Settings entry that used to open it was removed rather than kept
    as a second door. Before adding a global-looking "open X" button, check where
    X is mounted.

29. **A Tailwind class whose token is undeclared fails in total silence.**
    `apps/web/tailwind.config.js` is a v3-style config and Tailwind v4 never
    loads it — there is no `@config` in `src/index.css`. Every
    `primary-<number>` class the app wrote therefore generated no CSS at all:
    568 of them across 60 files, including 38 buttons carrying `text-white` on
    a `bg-primary-600` that painted nothing, and the
    `focus-visible:ring-primary-500` this file prescribes for accessibility.
    No build error, no lint warning, no visual difference from a typo. The
    scale now lives in the `@theme` block of `index.css`, which is the only
    place v4 reads; `src/theme.test.ts` compiles the real stylesheet and fails
    if a step stops resolving. **`--color-primary` and `--color-primary-500`
    are different tokens** — `bg-primary` (213 uses) comes from the first and
    must keep working. Everything else the config declares — `font-sans`,
    `shadow-glow`, `animate-shimmer` — is still inert.

30. **A bare `fetch` to a scraping route works in development and answers 401 in
    production.** Vite proxies those routes to the Python API with no login; the ingress
    does not. Call them through `legalFetch`. `services/__tests__/legalFetch.guard.test.ts`
    reads the route list from `vite.config.ts` and fails on a bare `fetch('/fetch_…'`,
    the way `infra/ingress/paths.test.mjs` keeps the ingress in step with the same list.

28. **Two vocabularies name the same act, and they disagree on case.**
    `constants/actTypes.ts` spells it `Regolamento UE`; the backend resolver
    answers `regolamento ue`. A `===` between the two silently produced an act
    with no name in the palette ("· n. 1689 del 2024") and skipped the step
    that collects an act's number and date. Compare case-insensitively and fall
    back to the raw value: the resolver knows 389 names against `ACT_TYPES`'
    40, so a miss is the normal case, not the exception. Same trap as
    `codice_urn` on the backend.

32. **"Vigente" is never a default, and a past text is read-only.** The status of
    a text comes from `ArticleData.validity` (what the source's page says) and
    from nothing else: `versionInfo` and `norma_data.data_versione` are what was
    ASKED for, an echo, and must never be shown as a fact ("Aggiornato al" once
    printed the typed date as if Normattiva had said it); a label built from
    them (a row's "testo al 29/12/2007", a dossier row's "Testo al …") says what
    was asked for, and only that. With no `validity` the toolbar shows no status.
    A text the source says is past, one whose window does not contain the day
    asked for, and one asked for by date or as the original that is repealed or
    whose page could not be read, takes no notes, highlights or discussions:
    `buildItemKey` has no version segment, so anything made on it would appear
    on the text in force, on the wrong words. A new surface that renders
    article text passes it through `describeVersion` and honours `readOnly`,
    `doctrineVisible` and `textVisible`, and asks `canCopyOrSave` (showing
    `copyBlockedReason`) and `canCite` before it copies, exports, saves or
    cites, the way `ArticleTabContent` and `DossierItemReader` do; and anything
    that caches, groups or compares texts by article adds `versionKey` to the
    item key, which has no version, and one that labels a text for another
    surface (a practice's row, a dossier row, the comparison) names its version
    (`versionTabSuffix`, `historicalItemLabel`); the banner and the chip sit
    beside the text, never in it (root rule 23).
