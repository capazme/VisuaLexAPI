# Web app — apps/web

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

MERL-T integration across server and web (routes, gates, guards, surfaces, slice history): `docs/merlt/claude-notes.md`.

### Frontend (`apps/web/src`)

- `App.tsx` — routing. In the signed-in layout: `/` (search), `/dossier`,
  `/history`, `/environments`, `/forum`, `/documents`, then `/sentenze` and
  `/sentenze/:corte/:numero/:anno` (both `DecisionAddress`: they redirect to `/`, a decision
  address queues the decision for the search space to open as a tab; `/sentenze` alone and an
  address that does not parse both open the palette, and only the address that does not parse
  says why, in the error toast (`pushSyncError`); the addresses stay the contract with LibreLex
  and the graph), then the MERL-T pages `/merlt` (the hub), `/merlt/contribuisci`, `/merlt/valida` and
  `/grafo` (`/merlt/qa` and `/merlt/chiedi` redirect to `/grafo`), and a 404 for
  anything else. The MERL-T routes are always registered: `VITE_FEATURE_MERLT`
  and `VITE_FEATURE_MERLT_GRAPH` decide the Sidebar's «Assistente» and «Grafo»
  entries and whether a page says it is unavailable. Outside the layout:
  `/login`, `/register`, `/connect` (the consent page an MCP client's
  authorization request lands on: signed in, the user approves or refuses) and
  `/admin/*` (admins only).
- `store/useAppStore.ts` — Zustand + Immer, the single global store.
- `types/index.ts` — shared types. `services/` — one file per backend entity.
- `components/features/` — `search`, `workspace`, `dossier`, `environments`,
  `bulletin` (the Forum), `history`, `compare`, `settings`, `documents`
  (`DocumentReviewPage`: citations found in a TXT/Markdown/HTML/DOCX the
  user drops in — parsed in the browser, never uploaded — each opening the
  reader through `navigate('/')` + `triggerSearch`, gotcha 15) and `decisions`
  (`DecisionView`, the body of a decision wherever it is drawn; `DecisionTabView`,
  its workspace tab and the phone view; `DecisionAddress`, the `/sentenze/…` route element;
  `DecisionLink`, a decision named by other data (the Massimario's chips, Brocardi's massime);
  `DecisionTextView`: a court decision's text; `DecisionReadingSurface`: the same text with the
  reader's marks and the norms it cites as links; `DecisionDownloads`: its two PDF buttons; `DecisionResultList`, the Cassazione's decisions for an
  article or a topic, and `DecisionSearchTabView`, its workspace tab; design `docs/superpowers/specs/2026-10-01-sentenze-design.md`).
- `components/layout/` — `Layout`, `Sidebar`, `ReaderLayout`.
- `components/ui/` — shared primitives: `Button`, `IconButton`, `Input`, `Card`,
  `Modal`, `ConfirmDialog`, `Toast`, `EmptyState`, plus feature-flavoured modals.
  Interaction tokens live in `constants/interactions.ts`, stacking bands in
  `constants/zIndex.ts`. Compose these rather than hand-rolling Tailwind.

## Frontend State

One Zustand store (`store/useAppStore.ts`) with Immer. Always mutate through
actions.

**Server-backed** (hydrated by `fetchUserData`, mutated optimistically then
synced): bookmarks, dossiers + items, environments, quickNorms, customAliases,
annotations and highlights (these two hydrate per-article via
`loadAnnotationsForArticle` / `loadHighlightsForArticle`), history.

**UI-only** (persisted to `localStorage` through the `persist` partialize):
workspace tabs and z-index, settings, `searchPanelState`.

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
  on `window` so the badge drops before the next 30s poll.

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
(`utils/__fixtures__/articleTexts.ts`). Tab, dossier reader and Study Mode all
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
`BrocardiDisplay`): an accordion closed by default (state per tab in
`sessionStorage`) holding Brocardi's massime (`MassimeSection`, only where the
doctrine is shown — gotcha 32), the Massimario's panel (the plugin slot
`article_case_law`, which takes `articleUrn`, `isHistorical`, `besideTabId`,
`backEntry`) and the Cassazione's decisions that mention the article, searched
only when the reader presses the button (`DecisionResultList`). On a past text the
section stays; the massime do not. A decision opens beside the article with the way back.
A topic opens a `decision-search` tab (`renderTabView` draws `DecisionSearchTabView`: heading
«Tema: …», the article when the query has one, «Solo il tema» to drop it, the limits line, the
list; a decision opened from it sits beside that tab, with no way back): from a Brocardi glossary
term («Sentenze su questo tema», beside the article's tab, with its norm) or from the palette
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
(`groupAnnotationsByBlock`). With `signs: true` — the tab and the dossier
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

**Passage discussions on the reading surface**: discussions anchored to a
specific passage of an article are loaded per article by `useArticlePassageThreads`,
located against the plain text by `locatePassage`, and counted on the round-B sign
(`data-threads`, speech-bubble icon). In the text, words stay clean until a
discussion is opened. The block popover (`BlockAnnotationsPopover`) lists the
block's passage discussions with their quotation, title, author, reply count,
and an "Apri discussione" action that opens the discussion panel. The discussed
words light up only for the discussion open in the panel (`focusedThreadId` →
`.vlx-thread-focus`), nesting inside any highlight over the same words. When the
article text changes, a discussion whose words moved re-attaches to the new location;
a detached one stays listed in the panel with a notice and its original quotation,
never hidden or deleted. Supported on the article tab for now.

**A court decision takes the same tools** (`DecisionReadingSurface`, PR 4): notes and
highlights are stored under `normaKey = decisionKey(identity)` with `articleId = ''` (wire key
`<key>::art::`), through the store's ordinary actions; the surface mounts the article's own
`SelectionPopup`, `InlineNoteComposer`/`InlineNotePopover`, `NotesPeekPanel`,
`HighlightsActionsPicker`, the round-B signs and `BlockAnnotationsPopover` (a paragraph is the
block; `decisionStructure` names them). `DecisionReadingToolbar` draws the two toolbar buttons
(`ReadingToolbar` needs an article's props). Anchors that do not land are listed, never dropped
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
found decision only for a host that mounts `DecisionView` without the reading surface; the
workspace tab always passes the surface. A private
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
the Corte costituzionale's PDF adds «· licenza <fonte.licenza>» (e.g. CC BY-SA 3.0); the
Cassazione's PDF and the page (`DecisionView` footer) carry no licence line (the owner, 8 Oct 2026).

**A past text is a reading** (round "Testo alla data", spec
`docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`). The server
states, next to `article_text`, the window the source's own page gives
(`ArticleData.validity`: `state`, `valid_from`, `valid_to`, …).
`utils/versionDisplay.ts` is the one table that turns it into what is shown —
the status chip (`VersionStatusChip`: "In vigore dal …", "Testo storico · dal …
al …"), the `VersionBanner`, and what is switched off — and it is tested without
a DOM. `versionInfo.isHistorical` is what was ASKED for (a date, or the original
text), never what came back. On a past text the tab, the dossier reader and
Study Mode take no notes, highlights, discussions or quick-norm (the selection
popup offers only "Copia"), Brocardi is not shown, and the update notes open;
an article that did not exist yet draws no text, only the way forward. The
"Testo alla data" dialog (`TextAtDateDialog`) replaces the old "Cerca versione"
modal; the result opens in a tab of its own, labelled with the day asked for.
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
`ArticleDiscussionPanel`, a draggable portal anchored on
`{normaKey, articleId, version}` (threads, replies, votes, report; moderation
is admin-only, `PATCH /admin/article-discussions/:id`). A new discussion can also
start from a selection via the "Discuti" button in `SelectionPopup`, which opens
the panel composer with a draft passage block and makes the title optional (the
quotation stands in for it). Every new discussion records `articleUrn` and the
`textHash` (SHA-256 fingerprint) of the text on screen. The panel is mounted
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

**Opening an act without an article.** `fetchActUrn` (`utils/actUrn.ts`) resolves
an act's URN structurally, with no text fetched; `addNormaIndexToTab` then drops
an article-less block on a tab and points the window at it atomically. The
palette's "Apri l'indice e sfoglia" is the entry point. A block with zero
articles is a legitimate state — guard anything that dereferences the active
article (`StudyMode` is mounted conditionally for exactly this reason).

**Going back.** `readingBackStack` records **citation jumps and the jump from an article to a decision**. Picking from
the index does not lose your place, and a previous/next arrow is undone by the
opposite arrow; recording those would fill the stack with stops nobody wants.
`ReadingBackControl` renders once for the whole app — the stack is global, so a
per-tab copy would sit inside the very tab an entry points at. It names its
destination, and it has no keyboard shortcut on purpose: every natural
combination for "back" already belongs to the browser.

**Decisions in the workspace.** A court decision is a workspace tab of its own: `WorkspaceTab.view`
(`{ kind: 'decision', reference }`, drawn by `workspace/renderTabView.tsx` on the desktop panel and the
phone alike), never a `TabContent`; the norm actions refuse a view tab (`refuseViewTab`). There is
one tab per decision (`openDecisionTab` brings an open one to the front; `setDecisionTabIdentity`
closes the tab a candidate was chosen in when another already holds that decision, and asks the
survivor to take keyboard focus), it opens beside the article when given `besideTabId`
(`placeSideBySide`, in viewport pixels converted through `utils/workspaceOrigin.ts`), and it is
persisted by its reference until the route has found it, then by identity (a cited section
travels with the reference to the route, which uses it to tell homonyms apart): the text is fetched again through `utils/decisionFetchCache.ts`. On a
phone one tab shows at a time, and a decision just opened becomes the visible one. The ways in:
the palette (a citation such as «Cass. civ. 10787/2024» is read by `decisionCitationParser.ts`
before the norm parser, unless the first word is one of the user's alias triggers; Enter opens
the tab; with no other tab on screen a new decision takes the whole free area), `DecisionLink` (a
plain click on the search page opens the tab beside the article and, given a `backEntry`, records
the jump in `readingBackStack` so «‹ Torna a art. 2043 c.c.» works as for a citation jump; any
other click follows the real `href`, which `DecisionAddress` turns into the same tab), the
sidebar's «Sentenze» (a button: it opens the palette, there is no page) and the address itself
(queued in `pendingDecision`, drained by `SearchPanel`). The tab reads the decision on the
reading surface, where highlights and notes work as on an article (see «A court decision takes
the same tools»). «Cerca nella barra di ricerca», on a decision that was not found, opens the
palette with its citation typed in (`openCommandPaletteWith`, taken once). The desktop panel and
the phone view both mount a `DecisionTabView` for the same tab, one of them hidden: only the copy
on screen takes the focus request, and both follow the identity the store learns, keeping the answer already shown (notices included) and seeding it
in the cache (`rememberDecision`) so that no second request goes out. A later citation that adds a section to
a tab still without an archive replaces its reference, so the tab asks again with it. The free-area
placement applies from the `md` breakpoint up only: a phone's geometry is never saved with the tab.

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
  act's title (`/fetch_rubriche` `title`, not for codes) and each row «art. N —
  rubrica» through `useActDetails` (one cached call per act; the tree only for an
  act in parts — `utils/actRubriche.ts`). Acts reorder by drag:
  `setDossierItemOrder` saves the whole order and waits, never sending a
  temporary id, while an added or restored item is pending
  (`pendingDossierOrders`). Articles do not drag. The header has three actions
  and a «⋯» (`ui/MenuButton`); «Seleziona elementi» lives there.
- **Notes**: every note a dossier gets from the web takes the notes route
  (`addNoteToDossier` → `POST /dossiers/:id/notes`), the one Claude's notes take
  through MCP. A note about an article (`aboutItemId`) sits with it: a count on
  the closed row, the notes above the text when open, «Aggiungi una nota
  all'articolo»; a note whose article is no longer in the dossier shows among
  the free notes. An entry an application wrote carries `ClaudeMark` («scritta
  da Claude Code (applicazione collegata)», from `createdBy`). An undone removal
  gives the article a new id: `restoreDossierItem` reattaches its notes at once
  (`PUT …/items/:noteId {aboutItemId}`, reverted with a sync error if refused);
  an undone note comes back through the notes route, about its article if the
  article is still there. It comes back as the user's: no web route sets
  `created_by`, by design, so Claude's mark does not survive a web undo (the
  MCP trash, which keeps ids, restores it). The note dialog closes only once
  the server has the note, so a refused note keeps its text.
- **The trash** (what a connected application deleted, 30 days; spec §10-11):
  one `useTrash` in `DossierPage` feeds «Cestino (n)» on the list (shown only
  when there is something), the page `?trash=1` (`TrashPage`: dossiers, entries
  «Da «dossier»», «Schede LingoLex» by their first questions) and a dossier's
  own «Rimossi di recente (n)» at its bottom (`DossierRecentlyRemoved`). Each
  entry (`TrashEntryRow`, `trashSummary.ts`) is restored whole — a 409 asks
  which dossier to restore into — or emptied behind a danger confirmation; a
  restore reloads that dossier from the server (`refreshDossier`). The web never
  moves anything to the trash: its own deletions stay immediate, with an undo.
  A decision in the trash is named by the server's citation.
- **Decisions** (`type: 'sentenza'`): the item stores the identity, the attributes the item
  schema accepts and a label, never the text. They are added from the decision's tab
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
  point for articles (from `ReadingToolbar` and `LooseArticleCard`) and for
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
  (`searchParamsFromGroup`, `searchesForGroups`), and a group asking for a past text
  opens in a tab of its own.

## Shared utilities — check before writing a new one

Duplicating any of these is a defect, not a shortcut.

**Frontend**:
- `utils/normaKeys.ts` — `buildItemKey(norma)` (norm + article),
  `buildNormaKey(norma)` (act only, used to group streaming results),
  `uniqueArticleIdFromNorma(norma)`. Both keys share their act-level segments so
  they cannot drift. `buildItemKey` is the annotation/highlight key contract and
  must stay byte-identical across dashboard and dossier.
- `utils/actUrn.ts` — `fetchActUrn(params)`: an act's URN with no article text
  fetched. It sends `article: '1'` because the endpoint refuses to build a
  `NormaVisitata` without one — a probe, not a request for article 1.
- `services/legalFetch.ts` — `legalFetch(path, init)`: `fetch` for the Python routes
  (`/fetch_*`, `/stream_article_text`, `/export_pdf`, `/parse_query`, `/health/detailed`…).
  It sends the login token (refreshing it first when expired, once more on a 401, through
  `api.ts`'s single in-flight refresh) because the production ingress refuses those calls
  without one, and it returns fetch's own `Response`, so the NDJSON stream and the PDF
  work as before. `/version` and `/health` are the two that stay open.
- `utils/decisionCitationParser.ts` — `parseDecisionCitation(input, { aliasTriggers })`: a decision as
  typed in the palette; it reads only an input that starts with a court and needs number and year.
  `utils/decisionFetchCache.ts` — `fetchDecisionCached`, one request per decision for the session
  (50 answers, least recently used out; a failure is not kept; `clearDecisionCache` at logout). `utils/workspaceOrigin.ts` — where a
  tab's (0, 0) is on screen, and the drag limits.
- `utils/decisionLinks.ts` — the addresses of court decisions (`decisionPath`,
  `parseDecisionPath`, `decisionKey`, `identityFromKey` and `isDecisionKey`, which read a key back) and their names (`formatDecisionHeading`,
  `formatDecisionCitation`, and `formatDecisionShort` — «Cass. civ., sez. un., n.
  31310/2024 · Rv. …», for chips and lists — both pinned to
  `conventions/sources/golden.json`); `brocardiDecisionRef` reads the court a Brocardi
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
  `findLiveBackIndex` for citation-jump undo.
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
  all towards the EU act. The client matcher reads the article-first form
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
  («art. 2 l. 241/1990»: tabs of an article, comparison, chips, quick norms),
  `citeAct`, `shortAct` (workspace tabs), `actHeading` (a code's name, else the act
  citation: card and block titles), `actSubtitle`, `inForceCitation` (what a copy
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
- `utils/normaMeta.ts` — `formatNormaTitle(norma)` (the act heading) and
  `formatNormaMeta(norma, articleCount?)`, the line under it: only
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
- `hooks/useArticlePassageThreads.ts` — loads an article's passage discussions
  for its signs via `GET /article-discussions/passages`.
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

**Stacking** — use the bands in `constants/zIndex.ts` (`sidebar` 50, `dock` 80,
overlay band 1000+), never a bare literal. See gotcha 22 before assuming a
z-index will be honoured.

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
- `features/workspace/` — `WorkspaceManager`, `WorkspaceTabPanel`,
  `NormaBlockComponent`, `LooseArticleCard`, `LazyStudyMode` (the
  `StudyMode/` bundle behind `lazy()`; `PDFViewer` and `CompareView` are
  lazy the same way), and `WorkspaceNavigator` (the dock: "Allinea" and
  "Chiudi tutte", the latter behind a danger `ConfirmDialog` because the
  workspace is persisted).
- `features/history/` — `HistoryView.tsx` plus `NormaChangesSection.tsx`
  (see History above).
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
12. **Workspace tab pin was removed** — the flag only suppressed bring-to-front,
    which contradicted the word "pin". Don't reintroduce without a product
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
    time; each carries `tabLabel` (cosmetic) and `targetTabId` (load-bearing —
    tells `processResult` to skip merge heuristics). The destination tab is
    pre-created synchronously before `navigate('/')`. Without `targetTabId` a
    stale orphan tab in persisted state can swallow the results.
16. **Capture the selection rect eagerly** — before `hidePopup()` /
    `removeAllRanges()`, because the selection is gone immediately after. The rect
    travels through `onAddNote(text, startOffset, rect)`.
17. **Every user-owned slice is server-backed** — every create/update/delete must
    round-trip the backend. The canonical regressions were `importDossier` and
    `applyEnvironment`, which pushed a local `uuidv4()` into the store; the UI
    looked fine until the first `addItem` 404'd on a ghost entity. Creation goes
    through `service.create()` first so the store holds server ids; mutations are
    optimistic + sync + revert. `applyEnvironment(replace)` also wipes
    server-side first, gated behind a danger `ConfirmDialog`.
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


25. **`store/workspaceTabActions.ts` is a dead duplicate — edit `useAppStore.ts`.**
    The live workspace-tab actions are inlined in the store (`addNormaToTab` and
    friends); nothing imports the factory in that file. Its only live export is
    the `NormaBlock` / `LooseArticle` *types*, imported by `useGlobalSearch.ts`.
    Editing an action there changes nothing at runtime. The file carries a header
    saying so; relocating the types and deleting the rest is queued for round 2b.
26. **A portal escapes `hidden md:block`, so a CSS breakpoint cannot gate it.**
    `display: none` hides descendants, but a portal re-parents to `document.body`
    and leaves the hidden subtree behind — the desktop renderer would surface its
    window on a phone, next to the mobile one. Anything portalled that exists in
    only one breakpoint needs a real viewport check (`useIsDesktop`), not a
    wrapper class. Conversely, a non-portalled `fixed` element inside a
    transformed ancestor is positioned against *that ancestor*, not the viewport
    (see gotcha 22) — which is why the structure window portals at all.

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
    them (a tab's "testo al 29/12/2007", a dossier row's "Testo al …") says what
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
    surface (a tab, a dossier row, the comparison) names its version
    (`versionTabSuffix`, `historicalItemLabel`); the banner and the chip sit
    beside the text, never in it (root rule 23).
