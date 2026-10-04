# The dossier grouped by act — Design

**Date:** 2026-10-04
**Status:** interview answered by the owner («dossier ok a tutto», 4 Oct 2026); spec awaiting his approval
**Round:** dossier UI, tranche 2 (orchestrator `visualexapi-7e`)
**Earlier rounds, still standing unless this spec says otherwise:**
`2026-08-24-dossier-lavoro-reale-design.md` (rows expand in place, the star, the two-click
collection), and the April polish rounds (the split into files, `ToolbarButton`, undo on
remove, server-synced import).

## Context and problem

The owner and his partner filled a dossier through the MCP server with articles of
l. 247/2012 and l. 49/2023 and found the page «molto brutta, con molte ripetizioni.
Sicuramente si possono ricondurre gli articoli della stessa norma sotto una sola finestra».

What the page does today, measured in the code:

- Every article is a card of its own: «legge 247 / Art. 3 • 31 dicembre 2012 / Aggiunto il …».
  Ten articles of one law print the act, its date and «Aggiunto il» ten times, and two laws
  of the same type read alike at a glance.
- The header carries ten coloured icon buttons; the «Seleziona» bar is always on screen.
- An expanded article ends with «Copia citazione» and «Apri su Dashboard», repeated under
  every article.
- The August spec planned rows like «Art. 2043 c.c. — Risarcimento per fatto illecito»; they
  were never built.
- The PDF prints the text only for articles filed from a loaded article: anything added
  through the MCP server or «Importa da norma» prints «(Nessun testo disponibile)».

The August diagnosis holds: the problem is the organisation, not the colours. This round
organises the dossier around the act, which is how a lawyer reads a file of norms.

## The owner's answers

He answered the whole interview with «dossier ok a tutto», so every proposal stands as
written:

| # | Question | Decision |
|---|---|---|
| 1–3 | Real use, what to look for first, what repeats | The page opens on the acts it contains; per-row «Aggiunto il», per-row icon and the ten buttons go |
| 4 | Form | **A**: one block per act, its articles as rows beneath |
| 5 | Order | Acts in the order they entered the dossier, **draggable**; articles inside an act **by number, not draggable** (the August drag of articles is removed — confirmed) |
| 6 | Act header | The act's citation, the article count, three actions (Apri tutto, + articoli, ⋯ with «Rimuovi l'atto»), **and the act's title** (one Normattiva request per act, cached) |
| 7 | Article row | «art. 3 — rubrica» + star |
| 8 | Past texts and annexes | Rows inside the act's block: «art. 3 · Testo al 29/12/2007», «All. A, art. 1» |
| 9 | Free notes | A «Note» section at the top; notes written by Claude carry their mark |
| 10 | Decisions | A «Giurisprudenza» section after the acts, one row per decision, opening in place |
| 11 | Header buttons | Three — «Apri tutto su Dashboard», «Aggiungi ▾», «Esporta ▾» — plus «⋯» |
| 12 | Export | PDF grouped by act; share link and JSON unchanged |
| 13 | Trash | A «Rimossi di recente» row at the bottom — **space only** in this round |
| 14 | Selection, list cards | «Seleziona» moves into «⋯»; dossier cards name the acts they hold |

From the MCP second round (relayed by the orchestrator, same day): the owner wants **notes on
an article** (a note about a dossier article as a whole, never a passage). This spec places
them in the article row.

## Goals

- Each act named once, in the app's citation style, with its articles beneath it.
- Articles readable in place, as today, with their rubrica on the collapsed row.
- A header with three actions instead of ten.
- A PDF that carries every article's text, grouped by act.
- Room, in the layout and in the code, for decisions, attached notes, Claude's mark and the
  trash, which other rounds deliver.

## Non-goals

- Article text, offsets and anchors: untouched (root rule 23). The redesign groups and
  re-arranges rows; the reader inside an expanded row is today's `DossierItemReader`.
- User-made sections or per-issue grouping (rejected by the owner in August).
- The visual-language refresh (fonts, palette): parked since August.
- The trash screens' behaviour: this round leaves the row and the link in place, inert
  until the MCP round's routes exist.
- The wording of a decision's citation: the «convenzione fonti» session settles it; until
  then the row shows the item's stored `etichetta`.

## Detailed design

### 1. The page, top to bottom

```
← Torna ai Dossier
Ricorso Rossi c. Bianchi                           ★
Descrizione …  · tag · tag
Creato il 4 ottobre 2026 · 3 atti, 11 articoli, 2 note, 1 sentenza

[Apri tutto su Dashboard] [Aggiungi ▾] [Esporta ▾] [⋯]
[🔍 Cerca in questo dossier…]           [Espandi tutto]

NOTE (2)
  «Verificare la decorrenza…»                   4 ott
  «Riassunto dei punti…»  ✦ scritta da Claude Code     4 ott

⠿ l. 31 dicembre 2012, n. 247                    6 articoli  [Apri tutto] [+ articoli] [⋯]  ▾
  Nuova disciplina dell'ordinamento della professione forense
    ▸ art. 1 — Disciplina dell'ordinamento forense                 ☆
    ▾ art. 3 — Doveri e deontologia                  📝 1          ★
        (the article's attached notes, then its text, read in place)
    ▸ art. 25 — Disposizioni generali                              ☆
    ▸ art. 25 · Testo al 29/12/2015                                ☆
⠿ l. 21 aprile 2023, n. 49                        3 articoli  …  ▾
⠿ Codice civile                                   2 articoli  …  ▾

GIURISPRUDENZA (1)
    ▸ Cass. civ., sez. III, … n. …                                 ☆

Rimossi di recente (3) — ripristina            (only once the trash exists)
```

Sections with nothing in them are not drawn. An empty dossier keeps today's empty state.

### 2. Grouping articles by act

A new pure module `components/features/dossier/dossierLayout.ts` turns `dossier.items` into
the page's sections, so the components only render:

```ts
interface ActBlock {
  key: string;               // act identity: a code's name, else tipo_atto (lower case) | numero_atto | data
  heading: string;           // what the block is called (below)
  articles: DossierItem[];   // norma items, sorted by article (below)
  groups: NormaGroup[];      // computeNormaGroups(articles): what "Apri tutto" opens
}
interface DossierLayout {
  notes: DossierItem[];       // free notes, and notes whose article is gone
  attached: Map<string, DossierItem[]>;  // article item id → its notes (about_item_id)
  acts: ActBlock[];           // in order of each act's first item
  decisions: DossierItem[];   // sentenza items, in stored order
}
function layoutDossier(items: DossierItem[]): DossierLayout;
```

- **The act's identity** is `tipo_atto` (case-insensitive), `numero_atto` and `data`. The
  version and the annex are **not** part of it: a past text and an annexed article sit in the
  same block as their act (decision 8). `computeNormaGroups` keeps splitting by version and
  annex, so «Apri tutto» still opens a past text in a tab of its own (gotcha 32). The
  preleggi and the codice civile share R.D. 262/1942 but differ in `tipo_atto`, so they are
  two blocks — as a lawyer cites them. A code or the Constitution is identified by its name
  alone (the table below): items of the codice civile saved with and without its R.D.
  number and date are one act. Every other act compares `numero_atto` and `data` as stored.
- **Order of the acts**: the position of each act's first item in `dossier.items`.
- **Order inside an act**: by annex (the body first, then annexes in the order they appear),
  then by article number in natural order (`2`, `2-bis`, `3`, `10`, `2043`), then the text in
  force before past texts, past texts by date. A pure comparator in the same module, tested on
  the suffix table's ordinals (`utils/articleSuffixes.ts`).
- **The heading**: for the codes and the Constitution, their name («Codice civile»,
  «Costituzione», «Codice di procedura civile», «Preleggi», …) from a table in the module;
  for every other act, the server's `act_citation` («l. 31 dicembre 2012, n. 247»,
  «regolamento (UE) 2016/679»). The web never re-derives the citation (it has one
  formatter, the server another, both pinned to the golden file; a third would drift).
  An item whose server answer has not arrived yet (the optimistic window of `addToDossier`)
  is placed by identity and, when its act has no other item, headed
  `tipo_atto n. numero_atto` in muted type until the answer lands.

### 3. The server: `act_citation`, and the act's title

- **`act_citation`** — PR #66 (merged in this round, before the spec): dossier items carry it
  in `GET /dossiers`, `GET /dossiers/:id`, `PUT /dossiers/:id`. This round adds it, with
  `citation`, to the answer of `POST /dossiers/:id/items`, so an item added from the web gets
  its heading from the server's answer instead of waiting for the next `fetchUserData`.
  The web reads both into `DossierItem` (`citation?`, `actCitation?`), set by hydration and by
  the add path; `importDossier` and `applyEnvironment` already round-trip through `addItem`.
- **The act's title** — `/fetch_rubriche` already reads the act's Akoma Ntoso index, which
  holds the title (`AktIndex.title`, from `docTitle`). It is added to the route's answer as
  `title` (empty string when the index has none or is unavailable). One call per act thus
  brings the title and the rubriche; the server caches the index, the web caches the answer for
  the session (`utils/actStructureCache.ts`). The plan's first task checks a real title for
  accents and amendment markers before the field is shown; if the AKN title is not
  presentable, the block shows no title rather than a mangled one.
  The codes and the Constitution show no title (their heading already is one).

### 4. The act block (`DossierActBlock.tsx`, new)

- **Header**: drag handle; heading; the title on a second line, muted, truncated to one line
  with the full title in `title`; the count («6 articoli»); «Apri tutto» (that act's groups,
  through `searchesForGroups`: the texts in force into the dossier's tab, each past group into
  a tab of its own); «+ articoli» (the existing `TreeNavigatorModal`, opened on this act with no
  search step — a new optional `initialAct` prop); «⋯» with «Rimuovi l'atto dal dossier»
  (all its articles, one undo toast that restores them all at their positions, through the
  existing `restoreDossierItem`); a chevron that folds the block. A folded block shows its
  article numbers on one line: «artt. 1, 3, 25, 26».
- **Drag**: blocks reorder with `@dnd-kit` (pointer and keyboard sensors, as today). Dropping
  rewrites the dossier's item order — notes first, then each act's items in block order and
  in display order, then the decisions — through a new store action
  `setDossierItemOrder(dossierId, itemIds)` that reorders locally and calls the existing
  `dossierService.reorderItems` (optimistic, reverted with a toast on failure, gotcha 17).
  While the search filter is on, drag is off (as today).
- **Fold state** is component state, not persisted. «Espandi tutto» opens every block and
  every article; «Comprimi tutto» closes the articles and leaves the blocks open.

### 5. The article row (`SortableDossierItem.tsx` → `DossierArticleRow.tsx`)

The row is no longer sortable; the file is renamed for what it is.

- **Collapsed**: «art. 3 — Doveri e deontologia», then, when present, a chip «All. A» for an
  annex and «Testo al 29/12/2007» for a past text (`historicalItemLabel`, as today); a note
  count when the article has attached notes, with Claude's mark when one of them is his; the
  star (44px target); remove on hover (always visible on mobile). No icon, no date, no
  «Aggiunto il».
- **The rubrica**: from the act's `/fetch_rubriche` answer (above). For an article without an
  annex, the top-level map. For an annexed article, the part whose article set matches the
  annex's (the same majority match the index window makes, moved from `TreeViewPanel` into a
  shared `utils/actRubriche.ts` that both use; it needs the act's tree, `fetchActTree`, which
  is cached and fetched only when the act has annexed articles). No match, no rubrica: never a
  rubrica from another annex. Once the article's text is fetched (the row opened), its own
  rubrica (`getRubricText`) fills a row that had none. Lookups go through
  `normalizeArticleId` (gotcha 9). While the rubriche load, the row shows «art. 3» alone.
- **Expanded**: the article's attached notes first (author mark, date, the text), then
  `DossierItemReader` as today. «Copia citazione» and «Apri su Dashboard» stay in the reader's
  footer — they act on that one article; the repetition the owner saw was the act's name, and
  that is what goes.
- **Accessible name**: «Espandi art. 3, l. 31 dicembre 2012, n. 247» (from `citation`, so two
  laws never read alike), plus the version label for a past text, as today.

### 6. Notes

- **The «Note» section**: every note item without `about_item_id`, and every note whose
  `about_item_id` names an item no longer in the dossier (the MCP round keeps a trashed
  article's notes as plain notes). Each shows its text (three lines, expandable), its date, and
  its author mark.
- **Claude's mark**: when the item carries `created_by` (MCP round), the note shows
  «✦ scritta da Claude Code (applicazione collegata)» with `created_by.clientName` in the
  sentence. With no `created_by` it is the user's own and shows nothing.
- **Notes on an article**: listed in the expanded row (§5). Creating one from the web is
  «Aggiungi nota» in the article's reader footer, posting to the MCP round's
  `POST /dossiers/:id/notes {text, aboutItemId}`. That route and the two fields come from the
  MCP round: the parts of this design that read them are built behind their presence (an item
  without the field renders as today) and the composer is wired only once the route is merged.
- **The note cap** goes from 2,000 to 4,000 characters (`AddNoteModal`), the cap the MCP round
  sets for Claude's notes.

### 7. Decisions («Giurisprudenza»)

Owned by this round by the orchestrator's decision: pull request C of the Sentenze plan stops
at the data (server, Forum, import, share links, environments — its tasks 11–13 and 15); the
rendering inside the dossier (its task 14's dossier view and the PDF) is built here, in this
layout, after PR C is merged.

- A section after the acts, one row per `sentenza` item, in stored order, with the star and
  remove like an article row; the row's label is the stored `etichetta` until the «convenzione
  fonti» session settles the wording.
- Expanded, it renders `DossierDecisionReader` as specified by the Sentenze plan's task 14
  (fetched text, notice when the open data have none). The PDF prints the decision's label and
  source line (`dossierItemPdfSource`).
- If PR C is not merged when this round reaches it, the decision tasks wait; nothing else
  depends on them.

### 8. The header

- **«Apri tutto su Dashboard»** — as today (`OpenOnDashboardPicker` when there are several
  groups).
- **«Aggiungi ▾»** — «Articoli da una norma» (`TreeNavigatorModal`), «Nota»
  (`AddNoteModal`), «Cerca un articolo» (goes to `/`).
- **«Esporta ▾»** — «PDF», «Copia link di condivisione», «JSON», «Salva snapshot».
- **«⋯»** — «Modifica», «Aggiungi ai preferiti» / «Rimuovi dai preferiti», «Seleziona
  elementi» (turns on the checkboxes and the bulk bar, as today), «Elimina dossier» (danger
  `ConfirmDialog`, as today).
- Menus are one new shared primitive, `components/ui/MenuButton.tsx` (`role="menu"`, arrow
  keys, Escape and click-outside close, focus returns to the trigger, 44px items on mobile).
  The list view's card menu, today hand-rolled, moves onto it. `ToolbarButton` stays for the
  icon buttons that remain; the ten coloured buttons go.
- One layout for mobile and desktop: the three buttons wrap; on a phone their labels shorten
  to icons with accessible names.

### 9. The PDF

Grouped as the page is: the dossier's title, description and tags; the notes; then each act —
its heading and title once — and under it each article as «art. 3 — rubrica» (plus the past
text's label) and its text; then the decisions. Each article's text is the text the reader
shows, fetched through `articleFetchCache` when the item does not carry it (a progress line
«Preparo il PDF… 4 di 11» on the button). A text that may not be exported
(`describeVersion(...).canCopyOrSave` false) prints its `copyBlockedReason` in place of the
text; a text that cannot be fetched prints «Testo non disponibile al momento» and the toast at
the end says how many. The page footer stays.

### 10. The dossier list

Each card names the acts it holds, by heading, in act order: «l. 31 dicembre 2012, n. 247 ·
l. 21 aprile 2023, n. 49 · Codice civile», truncated with «e altri N»; then the counts of
notes and decisions. The «Cestino (n)» link in the list's header appears with the MCP round's
`GET /trash`; it opens one list of every entry kind (dossiers, items of a dossier named with
their dossier, «Schede LingoLex» with their first questions), each with «Ripristina» —
specified here, built when the routes exist.

### 11. The trash row (space only)

At the bottom of a dossier, «Rimossi di recente (n) — ripristina», listing that dossier's
`DOSSIER_ITEMS` entries grouped by act like the page (`items: [{itemType, citation,
actCitation}]`), each restored whole. This round builds nothing that calls the trash; the
plan's last task builds the row once the routes are merged, or is handed to the MCP round.

## What goes, what stays

| Goes | Stays |
|---|---|
| Per-article card with act name, date, icon, «Aggiunto il» | Rows expand in place with today's reader |
| Dragging articles | The star, persisted in `_dossierMeta` |
| Ten coloured header buttons | Undo on remove; danger confirm on delete |
| Always-visible selection bar | Search within the dossier, now matching the citation and the rubrica too |
| PDF without the text of MCP-added articles | Share link, JSON, snapshot, «Apri tutto», the tour (its anchors are updated) |

## Error handling

- `/fetch_rubriche` or `/fetch_tree` failing: the rows show «art. N» and the block no title;
  logged with the act's URN (gotcha 18), never retried in a loop; the session cache drops the
  failure so a reload asks again.
- An item with no `urn`: its act's URN comes from `fetchActUrn` (`utils/actUrn.ts`); if that
  fails too, no rubriche, no title.
- Reorder failing on the server: the local order reverts and a toast says so.
- An act block whose items all have no `act_citation` (an old client cache, a server without
  #66): the muted fallback heading, never an empty one.

## Testing and verification

- **Pure modules, no DOM**: `layoutDossier` (grouping by identity across versions and
  annexes, preleggi apart from c.c., act order, article order with suffixes and annexes,
  orphaned attached notes, decisions), the code-name table, `utils/actRubriche.ts` (moved
  from `TreeViewPanel`, with its existing behaviour pinned before the move), the PDF's section
  builder.
- **Components**: `DossierActBlock` (heading, title, count, fold line, «Rimuovi l'atto» with
  undo), `DossierArticleRow` (rubrica, chips, star, note count, accessible name),
  `MenuButton` (keyboard, Escape, focus return), the detail view's sections and header.
- **Server**: `POST /dossiers/:id/items` answers `citation` and `act_citation`; `/fetch_rubriche`
  answers `title` (Python test with the recorded AKN fixtures).
- **Rule 23**: no change to `articleRender`, `useArticleMarkers` or the reader; the existing
  `articleRender.test.ts` stays green.
- **Browser pass** on the branch's own web port against the shared backend, with a test
  account created for it and deleted at the end: a dossier with l. 247/2012, l. 49/2023, a
  c.c. article, a past text, an annexed article, two notes; fold, drag an act, reload (the
  order holds), expand, star, remove an act and undo, export the PDF, open the list.

## Overlaps

- **Sentenze PR C** — §7: data in PR C, rendering here, after it.
- **MCP second round** — `about_item_id`, `created_by`, `POST /dossiers/:id/notes`, the trash
  routes. This round renders them when present and wires the composer and the trash once they
  are merged; the shapes are the ones agreed with that round (orchestrator, 4 Oct).
- **«Convenzione fonti»** — the wording of every citation; the headings follow the server's
  `act_citation` and change with it, with no web change.
