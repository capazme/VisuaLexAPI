# The norm tab becomes the practice's table — Design

Round opened 2026-10-07 from the decision tabs of the norms-and-decisions round. The owner asked:

> «vedendo la tab delle sentenze ho pensato che potremmo destrutturare un po' la tab norma, in modo
> che si possa tenere il singolo articolo fluttuante più pulito, tipo la sentenza. In questo modo la
> tab più grande, quella che contiene le norme, diventa l'equivalente grafico del dossier (dove si
> possono mettere sia norme che sentenze) e quando ci sono articoli comuni alla stessa norma si
> costruisce il sistema attuale che rende lo scorrimento più fluente»

The interview had 14 questions, each with a proposal; it stays with the round's working notes,
outside the repository, and every question and proposal is restated under «Decisions» below. The
owner answered on 8 October 2026:
«Ti confermo l'intervista con i raccomandati». Every proposal stands as written; for questions 1
and 2, which had hypotheses rather than proposals, the hypotheses stand. His standing instruction
for the round: «implementiamo prima tutto e poi mettiamo sul ROG» — the whole redesign is built and
merged first, and only then deployed on the deployment host.

**Amendments to earlier designs.**
- `2026-10-05-norms-decisions-search-design.md` §2.1–§2.3 (a decision is a workspace tab, «reading
  1»): a decision becomes an entry of the practice, listed under «Giurisprudenza», and is read beside
  it in a light window (§3, §4 below). The addresses of §3 there (`/sentenze/…`) do not change.
- Round 2b (agreed in August, never built; `2026-08-26-lettura-navigabile-round2a-design.md`, «Out
  of scope — round 2b»): kept and corrected, §1 below.
- «Testo alla data» (`2026-10-01-testo-alla-data-design.md`, its T5: «In this slice the historical
  text stays in its own tab, as today»): a past text no longer opens in a tab of its own; it is a
  row of its act, marked «Testo al …», as in the dossier (D6, D8, §5.3). That T5 deferred the change
  until the reader left the window, which this round does.

## What was measured

All in the code of `develop` at `1f0c0af8`, 8 October 2026.

- **A tab is a floating window holding a list of mixed things.** `WorkspaceTab`
  (`apps/web/src/store/useAppStore.ts`) has a position, a size, a z-index, minimised and hidden
  flags, a label with `labelIsCustom`, a `content: TabContent[]` and, since PR 2 of the
  norms-decisions round, an optional `view` (`decision` or `decision-search`). `TabContent` is
  `NormaBlock | LooseArticle | ArticleCollection`. `WorkspaceTabPanel` (619 lines) draws the window:
  drag by the header, resize on eight handles, minimise, rename, «Aggiungi a dossier» (every article
  of the tab, no decisions: a decision tab hides the button), close behind a danger confirmation.
- **One article at a time on the desktop.** `NormaBlockComponent` (601 lines) heads a block with
  Studio, Struttura and PDF, then draws a strip of article tabs (`norma-article-tabs`) and only the
  active article's `ArticleTabContent`. Each chip carries «Estrai come articolo loose» and «Chiudi
  articolo». A block opened from the index starts empty («Scegli un articolo dall'indice»).
- **The phone already reads a norm as one column.** `SearchPanel` draws one tab at a time
  (`mobileActiveTabIndex`, chevrons, dots, swipe) and, inside it, `NormaCard` per norm block: every
  article as a row that opens in place, the index in a drawer (`TreeViewPanel variant="drawer"`).
  The phone draws only `type === 'norma'` items: a loose article or a collection is not shown at
  all. A decision tab is drawn through `renderTabView`.
- **The desktop and the phone views are both mounted**, one hidden by CSS (`hidden md:block` around
  `WorkspaceManager`, `md:hidden` around the phone view). For decision tabs this is why
  `DecisionTabView` takes a focus request only in the copy on screen (`apps/web/CLAUDE.md`,
  «Decisions in the workspace»). `NormaBlockComponent` already mounts one layout through
  `useIsDesktop`, because each `ArticleTabContent` loads discussions, rubriche and the saved-norm
  check.
- **The collections are dead code.** `createCollection` has no caller outside the store and one
  store test (`store/__tests__/decisionTabs.test.ts`); no button reaches it. The drop zone that
  `moveLooseArticleToCollection` serves exists only inside `ArticleCollectionComponent`, which draws
  only an existing collection. A collection can therefore reach the screen only from a browser that
  saved one long ago. `WorkspaceTabPanel`, `WorkspaceManager`, `SortableWorkspaceTab` and
  `CompareView` still branch on it.
- **`store/workspaceTabActions.ts` is a dead duplicate** (gotcha 25): nothing imports its factory;
  `hooks/useGlobalSearch.ts` imports its `NormaBlock` and `LooseArticle` types.
- **Where a search lands** is `SearchPanel.processResult`: with `targetTabId` (the dossier's «Apri
  tutto», gotcha 15) the given tab; else the tab of the same streaming search; else, for a custom
  label, an open custom tab of that label; else (R3 of streaming-ux) a non-custom tab already
  holding the same act and no past text; else a new tab. A past text never merges: it opens a tab
  named «… — testo al …» (`versionTabSuffix`). A block is matched by `tipo_atto`, `numero_atto` and
  `data` as stored, and an article inside it by annex and number only (`addNormaToTab`), so a block
  cannot hold two versions of one article.
- **The workspace is persisted whole in the browser.** `partialize` keeps `settings`,
  `searchPanelState`, `workspaceTabs` (with every article's `ArticleData`, text and Brocardi
  included), `highestZIndex` and the structure window's position. There is no `version` and no
  `migrate`; `merge` drops malformed decision views (`sanitizeViews`). `clearUserData` empties the
  tabs at logout.
- **The reading back-stack points at tabs and blocks** (`utils/readingBackStack.ts`:
  `{ tabId, blockId, articleId, label }`; a decision tab names itself as its block). It is
  session-only.
- **Other readers of the tabs**: «Cerca negli articoli aperti» (`useGlobalSearch`, Cmd/Ctrl+F)
  scans every norm block's and loose article's text; `CompareView` lists every article of every tab
  as a candidate; `ReadingBackControl` brings a tab to the front; `useAnnexNavigation` loads an
  article picked from the index into its tab (`addNormaToTab`); `useAutoSwitch`
  (`onRemoveDuplicateTabs`) closes every tab holding an act when a search switches to its annex; the
  dossier's «Apri tutto» pre-creates custom tabs (`DossierDetailView`, `DossierListView`,
  `searchesForGroups`); the tours anchor on `.workspace-tab-panel`, `.norma-block-header`,
  `.norma-article-tabs`, `.norma-study-mode-btn`, `.norma-structure-btn` and `#tour-workspace-dock`
  (`config/tourConfig.ts`).
- **A decision tab** is one per decision (`openDecisionTab`, `sameDecision`), placed beside the tab
  it was opened from (`placeSideBySide` over `utils/workspaceOrigin.ts`), persisted by reference
  until found and then by identity (`setDecisionTabIdentity`, which also closes a duplicate and asks
  the survivor to take focus). A topic search is a `decision-search` tab (`DecisionSearchTabView`).
- **Annotations do not depend on the tab.** Highlights and notes are keyed by
  `buildItemKey(norma_data)` (`utils/normaKeys.ts`) for an article and by `decisionKey(identity)`
  with `articleId ''` for a decision; discussions by the same anchor. Moving an article from one
  container to another changes no key.
- **The dossier already has the shape asked for** (`2026-10-04-dossier-per-atto-design.md`,
  `components/features/dossier/dossierLayout.ts`): an act's identity is a code's name or
  `tipo_atto|numero_atto|data` (`actKeyOf`); acts in the order they arrived, reorderable by drag;
  articles by annex, number and ordinal, the text in force before past texts (`compareArticles`);
  past texts and annexes as rows of their act; decisions under «Giurisprudenza».
- **VisuaLex Studia PR A** (`feat/studia-cards`, in flight) adds a row under each article in
  `ArticleTabContent` («Schede su questo articolo», before `BrocardiDisplay`) and «Crea scheda» to
  `SelectionPopup` (`2026-10-07-studia-cards-screens-design.md`, «Reader»; plan Task A6).

## Real use (questions 1–3)

- **Q1** (hypothesis, confirmed): three to ten articles open together, from two or three norms,
  plus one or two decisions. Two texts at most are really read side by side: usually an article and
  a decision, or two articles of different norms.
- **Q2** (hypothesis, confirmed): what weighs today is seeing one article at a time behind the
  tabs, large windows covering one another, and not having the norms and the decisions of one
  question in one place.
- **Q3**: the «system that makes scrolling more fluent» is the phone's single column, every article
  of a norm one under the other, brought to the desktop with a small index on top to jump.

## Goals

- One table per practice holds the acts, their articles and the decisions of a question, and reads
  on its own, like a dossier.
- The articles of one act read as one continuous column, with an index on top.
- A single article or a decision can be read beside the table in a light window, at most two at a
  time.
- The dock switches between practices.
- The phone shows the same column, and reads an article or a decision full screen.
- A practice can be saved as a dossier.
- Every workspace a browser holds today becomes practices on first load, losing nothing.

## Non-goals

- **The practice as a server-side dossier** (Q6 b). Later, as its own round: it changes the data
  model and raises its own questions (what becomes of a quick search one does not want to keep).
- **Any change to article or decision text, offsets or anchors** (root rule 23). The redesign
  rearranges where the existing reading surfaces are mounted.
- **The visual-language refresh** (fonts, palette), parked since August.
- **Server, Python or Prisma changes.** None is needed: the practice lives in the browser, «Salva
  come dossier» uses the dossier's existing routes.
- **New reading tools.** The window reuses the reading surface as it is.

## Decisions

Every interview answer is a decision; D-numbers follow the questions.

| # | Decision | From |
|---|---|---|
| D1 | The table is sized for three to ten articles of two or three norms plus one or two decisions; at most two texts are read side by side. | Q1, hypothesis confirmed |
| D2 | The redesign removes the one-article-at-a-time strip, the overlapping windows, and the split between norms and decisions. | Q2, hypothesis confirmed |
| D3 | The phone's single column becomes the reading form on every screen: the articles of an act one under the other, an index on top to jump. | Q3 (a) |
| D4 | **Form A.** The container is the practice's table, read on its own like a dossier; «Apri accanto» takes an article or a decision into a light window for comparison. Not B (everything floating, the container an index) nor C (no windows, the table split in two). | Q4 A |
| D5 | The article's light window holds, on top, the title («art. 2043 c.c.») and the reading bar (notes, highlights, discussions, copy); then the text; at the bottom, closed, Brocardi and «Giurisprudenza». Studio, Struttura and PDF stay on the act's block in the table, not in the window. | Q5 |
| D6 | **Similar, not the same:** the table has the dossier's shape (acts, articles by number, «Giurisprudenza») but stays the user's work table, saved in the browser. «Salva come dossier» turns it into a real dossier. Making it a server-side dossier is a later step. | Q6 (a) now, (b) later |
| D7 | A decision opened from an article enters the table under «Giurisprudenza»; opened to be read, it also opens beside, in a window. Closing the window leaves it in the table. | Q7 |
| D8 | Order as in the dossier: acts in order of arrival, reorderable by drag; an act's articles by number; decisions at the bottom, by date of deposit. | Q8 |
| D9 | One table per practice (round 2b's contexts); the dock becomes the bar of practices; a click changes table; light windows belong to the practice they were opened in and disappear when the practice changes. | Q9 |
| D10 | «Apri accanto» always lines the windows up to the right of the table, two at a time; a third takes the place of the oldest, which stays only in the table. Not «free and draggable as today». | Q10, the proposal |
| D11 | On the phone the table is the main screen (today's column, «Giurisprudenza» at the bottom); «Apri accanto» opens the article or the decision full screen with «‹ Pratica» to return; extracted articles no longer exist. | Q11 |
| D12 | Removed: «Estrai come articolo loose» (replaced by «Apri accanto»), the article collections, the strip of article tabs (replaced by the continuous column). | Q12 |
| D13 | On first load after the change, each tab becomes a practice with the same acts and articles; an extracted article joins its act; an open decision goes under «Giurisprudenza». Notes, highlights and discussions are tied to the article, not to the tab, so nothing is lost. | Q13 |
| D14 | Spec first, then the plan. The interview placed the change after PR 3 and before PR 4 of the norms-decisions round; PR 3, 4, 4b and 4c have since merged, so the order relayed by the orchestrator on 8 October applies: this documentation PR, then PR 5 (decisions in the Cronologia) and the redesign code (§12). | Q14, as overtaken by events |

### Technical choices made here

These are recommendations within the owner's answers, each with its trade-off. None needs him
except where §13 says so.

| # | Choice | Trade-off |
|---|---|---|
| T1 | **A new `Practice` model replaces `WorkspaceTab`**, rather than adding fields to the tab. | A rewrite of the workspace slice, against a tab type whose position, size, z-index, `view` and three content kinds all stop meaning anything; evolving it in place would keep every dead field and every `else` branch alive. |
| T2 | **An article in a practice is identified by `uniqueArticleIdFromNorma` plus `versionKey`.** A past text is a row of its act, beside the text in force. | Follows D6 and D8 (the dossier already holds both in one block) and gotcha 32 holds per row; it ends the «tab of its own» of the «Testo alla data» round (§13). |
| T3 | **The practice keeps the articles' `ArticleData` in the browser, as the tabs do today.** | No refetch on reload and no new cache, at the cost of `localStorage` space (texts of several acts); while the flag is on (§12) the tabs and the practices are both stored. Holding references only and refetching through `articleFetchCache` is Later. |
| T4 | **One layout mounted per breakpoint** (`useIsDesktop`), never a CSS-hidden twin. | Ends the doubled `DecisionTabView` and the doubled article effects; the phone and the desktop no longer stay in sync while the window is resized across 768 px (the column keeps its open rows through the store, §5.4). |
| T5 | **A row read beside is folded in the column** («Aperto accanto · Chiudi la finestra»). | One mounted reading surface per subject on the desktop: one saved-norm check, one discussions panel, one find box. The reader cannot see the same article twice, which nothing asked for. |
| T6 | **Windows are docked in a row, not dragged.** Widths come from one pure function (§4.3). | The interview chose the proposal over «free and draggable as today»; a user-adjustable divider is Later. |
| T7 | **Decisions sort newest first**: by date of deposit when known (`attributi.data_deposito`, learned when the decision is found), else by year; ties by number. | The interview fixed the key, not the direction; newest first is how the Cassazione's lists are ordered in the app (`/search_decisions`, `sort=pd desc`). A decision never read has no date and sorts by its year. |
| T8 | **A topic search is a window, not an entry.** It is a question, not a source: it never enters «Giurisprudenza»; a decision opened from it does. | One fewer kind of row; a search is not kept once its window is replaced, as it is not kept once its tab is closed today. |
| T9 | **Built behind `VITE_FEATURE_PRACTICE_TABLE`** (absent = off), the practices persisted beside the tabs and seeded from them on the first load with the flag on; the last PR removes the flag, migrates every browser and deletes the tab model (§12). | Develop stays usable between PRs (root CLAUDE.md: experiments sit behind flags). While the flag is on, the tabs and the practices diverge: turning it off shows the tabs as they were. Acceptable for the owner's trial before the deploy. |
| T10 | **Migration placement**: a decision tab goes under «Giurisprudenza» of the practice that was in front (the norm tab with the highest z-index), or of a new practice «Sentenze» when there is no norm tab; the newest topic-search tab becomes a window of that practice, older ones are dropped with a console note. | The old tabs do not record which tab a decision was opened from; the front tab is the likeliest. A search is re-run from the palette in one line. |
| T11 | **A search lands in the active practice**, creating one (named after its first act, `shortAct`) when there is none. R3's merge heuristics, the custom-label matching and the historical split retire; `targetTabId` keeps its role for the dossier's «Apri tutto» and names a practice (gotcha 15). | Simpler and predictable: what you search goes on the table you are looking at. A user who wants a new practice makes one from the bar. |
| T12 | **The window's reading bar** is the toolbar in a compact form: notes, highlights, discussions, copy and «Cerca nel testo» (§13 of the norms-decisions spec, part of the reading bar since 8 October). The rest of the toolbar (dossier, quick norm, share, export, «Testo alla data», compare, Studio) stays on the row in the table. | D5's «pulito come la sentenza»; one more step for those actions from a window. |
| T13 | **Acts move between practices from the act's «⋯»** («Sposta in un'altra pratica»), as round 2b planned; drag between containers goes. | Drag between floating windows has no target once there is one table on screen. |
| T14 | **The windows are persisted with their practice** (references only, at most two). | Returning to a practice, or reloading, shows what was beside it. |
| T15 | **Open rows are session state**; after a reload every row is closed, like the dossier. | The column loads no article surface it does not need. |

## Detailed design

### 1. Rounds 2a and 2b: what stays, what changes

**Kept from round 2a**: the index is a window (`TreeViewPanel variant="window"`, one owner in
`structureWindow.blockId`, which now names an act of the practice); an act's index opens without a
prior search («Apri l'indice e sfoglia»); citation jumps can be undone (`readingBackStack`, one
`ReadingBackControl`); the principle that a floating window suits a tool, not content. The light
window is not floating: it is docked beside the table (T6), which keeps that principle.

**Kept from round 2b**: one table per context, here called a practice; the dock as the bar of
contexts; «Sposta in…» replacing drag between tabs (T13); `position` and `size` retired;
`store/workspaceTabActions.ts` deleted.

**Corrected from round 2b**: content is not confined to the table. A single article or a decision
can be read beside it (D4: option C, «2b puro», was not chosen), and comparison is a second window,
not the table split in two columns.

### 2. The practice: data model

The practice replaces `WorkspaceTab` (T1). New module `apps/web/src/utils/practice.ts` (pure, no
store import) holds the types and every rule; the store holds the state and calls it.

```ts
/** One practice: the table of a question. UI state, saved in the browser (D6). */
export interface Practice {
  id: string;
  label: string;
  /** The user named it (rename, a dossier's «Apri tutto»): searches never rename it. */
  labelIsCustom: boolean;
  /** In order of arrival; reordered by drag (D8). */
  acts: PracticeAct[];
  /** «Giurisprudenza»: stored in order of arrival, shown by `decisionOrder` (T7). */
  decisions: PracticeDecision[];
  /** The light windows beside the table, oldest first, at most two (D10, T14). */
  beside: BesideRef[];
}

export interface PracticeAct {
  /** Stable: owns the structure window and names the act in back-stack entries. */
  id: string;
  /** `actKeyOf(norma)` (dossierLayout.ts): a code by its name, any other act by type, number, date. */
  key: string;
  /** The act as the first search or the index resolved it; carries the act-level URN. */
  norma: Norma;
  /** Sorted by `compareArticles(a.norma_data, b.norma_data)`; unique by `practiceArticleKey` (T2). */
  articles: ArticleData[];
  isCollapsed: boolean;
}

export interface PracticeDecision {
  id: string;
  /** The citation as asked; replaced by the identity once found (as `setDecisionTabIdentity` does). */
  reference: DecisionReference;
  label: string;           // formatDecisionShort, with the section once known
  identified: boolean;     // the reference is the decision's identity
  depositDate?: string;    // attributi.data_deposito, ISO, once found (T7)
  tipo?: string;           // attributi.tipo, kept for «Salva come dossier»
}

/** What a light window shows. `id` is stable for the subject, so opening it twice finds it. */
export type BesideRef =
  | { id: string; kind: 'article'; actId: string; articleKey: string }
  | { id: string; kind: 'decision'; decisionId: string }
  | { id: string; kind: 'decision-search'; query: DecisionSearchQuery; label: string };

/** `uniqueArticleIdFromNorma(norma_data)` + '|' + `versionKey(norma_data)` (which field a
 *  «Testo alla data» search always fills, `norma_data` or `versionInfo`, to confirm in Task 3). */
export function practiceArticleKey(article: ArticleData): string;
```

Store state (in `useAppStore.ts`): `practices: Practice[]`, `activePracticeId: string | null`
(both persisted), and session-only `practiceRows: Record<string, true>` (open rows, keyed
`practiceId/actId/articleKey` or `practiceId/decisionId`, T15) and `pendingReveal` (one row to open
and scroll to, consumed once, gotcha 14).

**How today's types map:**

| Today | Becomes |
|---|---|
| `WorkspaceTab` without `view` | `Practice` (same `id`, `label`, `labelIsCustom`) |
| `NormaBlock` | `PracticeAct` (same `id`; blocks of one `actKeyOf` merge) |
| `NormaBlock.articles` | `PracticeAct.articles`, deduplicated by `practiceArticleKey` |
| `NormaBlock.autoFocusArticleId` | `pendingReveal` |
| `LooseArticle` | an article of its act (`actKeyOf(sourceNorma)`) |
| `ArticleCollection` | each article into its act |
| `WorkspaceTab.view` `decision` | a `PracticeDecision` (+ a window when opened to read) |
| `WorkspaceTab.view` `decision-search` | a `BesideRef` of kind `decision-search` |
| `position`, `size`, `zIndex`, `isMinimized`, `isHidden`, `highestZIndex` | gone (the layout is computed, §4.3) |

**The rules** (all in `utils/practice.ts`, tested without a DOM):
- `addArticles(acts, norma, articles)`: finds the act by `actKeyOf(norma)` or appends one;
  inserts each article not already present by `practiceArticleKey`, keeps the sort; an article
  stored without `brocardi_info` learns it from a later copy (today's `addNormaToTab` backfill); an
  act that arrived without a URN learns it (today's `addNormaIndexToTab` backfill).
- `decisionOrder(decisions)`: T7.
- `sameDecision(entry, reference)`: today's rule, moved from the store: same court, number and year;
  a citation with an archive matches only that archive.
- `besideAfterOpen(beside, ref, { askerId? })`: D10 (§4.2).
- `practicesFromTabs(tabs)`: the migration (§9).
- `sanitizePractices(raw)`: rehydration of untrusted saved state (§10).

### 3. The table on the desktop

The search page draws the active practice's table in the results area (`WORKSPACE_AREA_ID`), full
height, and the windows beside it (§4). No floating panel.

```
┌ Responsabilità medica ─────────── 2 atti · 4 articoli · 2 sentenze  [Salva come dossier] [⋯] ┐
│ ⠿ Codice civile                                          [Studio] [Struttura] [PDF] [⋯]  ▾  │
│   1218 · 2043 · 2236                                          ‹ art. prec. · art. succ. ›   │
│   ▾ art. 1218 — Responsabilità del debitore                          [⇱ Apri accanto] [×]   │
│       (reading toolbar, text, «Giurisprudenza» ▸, Brocardi …)                               │
│   ▸ art. 2043 — Risarcimento per fatto illecito          Aperto accanto · Chiudi la finestra│
│   ▸ art. 2236 — Responsabilità del prestatore d'opera                                       │
│ ⠿ l. 8 marzo 2017, n. 24                                  [Studio] [Struttura] [PDF] [⋯]  ▾  │
│   7                                                                                         │
│   ▸ art. 7 — Responsabilità civile della struttura e dell'esercente la professione sanitaria│
│ GIURISPRUDENZA (2)                                                                          │
│   ▸ Cass. civ., sez. III, n. 28994/2019                              [⇱ Apri accanto] [×]   │
│   ▸ Cass. civ., sez. un., n. 577/2008                                [⇱ Apri accanto] [×]   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**3.1 The header.** The practice's name (double-click or «⋯ › Rinomina» to rename; a rename sets
`labelIsCustom`), a count line («2 atti · 4 articoli · 2 sentenze»), «Salva come dossier» (§7) and
«⋯» (`ui/MenuButton`): «Aggiungi a un dossier…», «Rinomina», «Chiudi la pratica» (danger
`ConfirmDialog`: «Gli atti e le sentenze della pratica verranno tolti dal tavolo. Dossier, note ed
evidenziazioni non saranno toccati.»). While a search streams into the practice, today's inline
progress bar sits under the header. An empty practice says «Pratica vuota» and offers «Cerca una
norma o una sentenza» (opens the palette).

**3.2 The act block** (`PracticeActBlock`), shaped like the dossier's `DossierActBlock`:
- **Heading**: drag handle (acts reorder with `@dnd-kit`, pointer and keyboard sensors, as the
  dossier); the act's heading (`actHeading`) and `formatNormaMeta`; Studio, Struttura, PDF exactly
  as on today's block (D5): Studio opens Study Mode on the act's articles starting at the last row
  opened (or the first), disabled when that text is read-only (gotcha 32); Struttura owns the
  structure window (`structureWindow.blockId = act.id`); PDF calls `onViewPdf(norma.urn)`. «⋯»:
  «Sposta in un'altra pratica» (T13, a submenu of the other practices and «Nuova pratica»),
  «Rimuovi l'atto» (danger confirmation, today's wording). A chevron folds the block. The heading
  follows the sticky-row convention (`apps/web/CLAUDE.md`, «Sticky filter rows»).
- **The index on top** (D3): one line of chips, one per article of the act («1218 · 2043 · 2236»;
  «All. A 1» for an annex; a past text's chip carries «· testo al …»), each opening its row and
  scrolling to it; at the end of the line, today's `ArticleNavigation` (previous and next in the
  act's tree, loading an article not yet on the table into this act) and the loading chip. The
  annex suggestion (`AnnexSuggestion`) shows inside the open row it concerns.
- **Rows** (`PracticeArticleRow`): «art. 2043 — Risarcimento per fatto illecito» (`articleLabel`
  from dossierLayout, the rubrica from the article's own text through `getRubricText` — no request),
  a chip «Testo al 29/12/2007» for a past text (`historicalItemLabel`); on the right «Apri accanto»
  (§4) and «Togli dal tavolo» (×, no confirmation: the article stays one search away, and the
  undo is the search). The expand toggle is scoped to the row header (keyboard-accessible
  collapsible convention; never wrapping the reader or the buttons, gotcha 22). Open, the row
  mounts `ArticleTabContent` exactly as the block mounts it today, with `readingOrigin = { tabId:
  practice.id, blockId: act.id }` and `onOpenStudyMode`. A row shown beside folds and says «Aperto
  accanto · Chiudi la finestra» (T5).
- **Which rows open by themselves**: the article a one-article search asked for (today's R2), and
  the first article of a new act from a range (R1: the others stay closed). Both through
  `pendingReveal`. A citation jump or a back-stack return opens and reveals its row.

**3.3 «Giurisprudenza»** (`PracticeDecisionsSection`), after the acts, only when there is one:
rows «Cass. civ., sez. III, n. 28994/2019» (the entry's `label`), in `decisionOrder`, each with
«Apri accanto» and ×. A row opens in place on the decision's reading surface (§6.1): the table
reads on its own (D4).

### 4. The light window

**4.1 One component for an article and a decision** (D5, `ReadingWindow`). A shell — a header with
the title and «Chiudi» (×, 44 px on a phone), a scrolling body, the 68ch measure — and a body chosen
by the reference's kind:
- `article`: `ArticleTabContent` with `variant="beside"`: the toolbar in its compact form (T12),
  the version banner, the text, then one closed line «▸ Brocardi · ▸ Giurisprudenza» — Brocardi
  folded into a closed section, «Giurisprudenza» the existing `CaseLawSection` (already closed by
  default). Not drawn in the window: Studio (D5), the Studia row of PR A, «Chiedi a MERL-T»
  (`AskMerltEntry`) and the graph rail (`article_sidebar`); the viewing tracker
  (`article_content_after`) stays. Title: `citeNorm(norma_data)` plus `versionTabSuffix` for a past
  text.
- `decision`: the decision's view (§6.1), as the tab shows it today (title, notices, its actions,
  the text).
- `decision-search`: `DecisionSearchTabView` as today (T8).

```
┌ art. 2043 c.c. ────────── [✎] [▮] [💬] [⧉] [🔍] [×] ┐   ┌ Cass. civ., sez. III, n. 28994/2019 [×] ┐
│ (Risarcimento per fatto illecito).                │   │ Corte di cassazione · Sez. III civile …│
│ Qualunque fatto doloso o colposo …                │   │ [Copia citazione] [Aggiungi…] […]      │
│ ▸ Brocardi · ▸ Giurisprudenza                     │   │ Motivazione …                          │
└───────────────────────────────────────────────────┘   └────────────────────────────────────────┘
```

**4.2 «Apri accanto» and the row of two** (D10). `openBeside(practiceId, ref, { askerId? })` in one
store update: if a window already shows that subject, nothing moves (it is focused); with fewer than
two windows the new one is appended on the right; with two, the oldest window that is not the asker
is removed and the new one appended on the right. A removed window's subject stays in the table
(D10). The asker is the window a link was clicked in: a decision opened from an article in a window
must not close that article. Windows belong to their practice (D9): switching practice hides them,
returning shows them again (T14).

**4.3 The layout** (`besideLayout(width, count)`, pure, tested). The free width is the results
area's. No window: the table takes it all, its text at the 68ch measure. One window: table and
window share it half and half. Two windows: three equal columns when each gets at least 420 px;
otherwise the table folds into a 48 px rail («Pratica», vertical, with the count) and the windows
share the rest — the rail opens the table as an overlay over the windows, closed by Esc or a click
outside. Below 768 px there are no windows (§8).

**4.4 What opens beside, and what goes back.** «Apri accanto» on a row; a decision opened from any
link (§6.2); a topic search; a norm cited inside a window's text (the cited article enters its act
and opens beside the asking window). A citation clicked in a row of the table opens and reveals the
cited row in the column, as a same-act jump does today. `readingBackStack` records citation jumps
and the jump from an article to a decision, as today; its entries name the practice, the subject and
where it was read (§6.3).

### 5. The dock becomes the bar of practices

`PracticeBar` replaces `WorkspaceNavigator` (D9), same place (`fixed bottom-6`, `Z_INDEX.dock`),
same collapse toggle («N pratiche»).
- **One chip per practice**: the name and a count («2 atti · 1 sentenza»); the active one marked
  (`aria-current`); a click makes it active; double-click renames; drag reorders (today's sortable
  list); «⋯» per chip: «Rinomina», «Salva come dossier», «Chiudi la pratica» (danger confirmation).
- **«+ Nuova pratica»**: creates «Nuova pratica», makes it active and opens its name for editing.
- **«Chiudi tutte»** stays, behind its danger confirmation (the practices are persisted).
- **Gone**: «Allinea», minimise and show/hide (nothing floats).

**5.1 Where things land** (T11). A search's results enter the active practice; with no practice, a
new one named after the first act. The dossier's «Apri tutto» pre-creates a practice named after
the dossier (`labelIsCustom`) synchronously, before `navigate('/')`, and passes its id as
`targetTabId` on every queued search (gotcha 15); past groups go to the same practice, as rows (T2).
The whole dossier's «Apri tutto» also puts the dossier's decisions under «Giurisprudenza», unread
(no request until a row or a window opens). «Apri l'indice e sfoglia» drops an article-less act on
the active practice and points the structure window at it (today's `addNormaIndexToTab`).

**5.2 The annex auto-switch.** `useAutoSwitch` today closes every tab holding the act it switches.
With the flag on it closes nothing: the annex's articles are separate rows of the same act
(`allegato` is part of `practiceArticleKey`); the stray row from the first search is removed from
the active practice only when that search created it. To confirm against
`SearchPanel`'s auto-switch tests in Task 10.

**5.3 Past texts** (T2). A text asked for by date or as the original enters its act as a row of its
own, chip «Testo al …», read-only per gotcha 32 (`describeVersion` in `ArticleTabContent`, as
today); Studio is disabled on it. Its window's title names the version. It never shares a key with
the text in force: `versionKey` is in `practiceArticleKey`, so «Cerca negli articoli aperti»,
compare and «Salva come dossier» keep the two apart.

**5.4 Breakpoint changes.** The open rows and the windows live in the store, so resizing across
768 px keeps what is open; the phone shows the table and, if the reader opened one, the full-screen
view of the newest window (§8).

### 6. How the existing pieces carry over

**6.1 Decisions** (D7). `openDecisionTab(reference, { besideTabId })` keeps its name for its many
callers while the flag exists and, with the flag on, adds an entry to the active practice and opens
it beside (the window, §4.2; on a phone, full screen). One entry per decision per practice:
`sameDecision`, and an unresolved entry learns a section a later citation adds, as today.
`DecisionTabView` becomes `DecisionEntryView({ practiceId, decisionId, reference, hostId })` (the old
tab keeps a thin wrapper over the same fetching hook until P6): the
same fetch through `decisionFetchCache`, the same handling of candidates, notices and «Cerca nella
barra di ricerca», and on a found decision `setDecisionEntryIdentity`, which records identity, label,
date of deposit and type, and — when another entry of the practice already holds that decision —
drops this one, points the window at the survivor and asks it to take focus (today's
`setDecisionTabIdentity` rule). The same view draws the row opened in place and the window. With one
layout mounted (T4) the «only the copy on screen takes focus» guard has one copy to serve; it stays
for the row and the window of one decision (T5 folds the row, so at most one is open). The
Cronologia records a found decision once per opening (PR 5 of the norms-decisions plan); the record
moves with the view.

**6.2 Ways in to a decision.** The palette («Cass. civ. 10787/2024»), `DecisionLink` (massime, the
Massimario's chips, the result lists), the sidebar's «Sentenze», the Cronologia and the address all
go through `openDecisionTab`, so they need no change of their own. **The `/sentenze/<corte>/<numero>/
<anno>` contract is untouched**: `DecisionAddress` still queues `pendingDecision`, `SearchPanel`
drains it once (gotcha 14), and the decision enters the active practice and opens beside.
`besideTabId` keeps its role — the reading place the link sits in — and now names a practice (a row
of the table) or a window id (§4.2's asker); P6 renames it `besideId` across its users (the
decision links and lists, `CaseLawSection`, `MassimeSection`, `BrocardiDisplay`, the MERL-T
Massimario panel's slot props).

**6.3 The reading back-stack.** An entry becomes `{ practiceId, subject: { kind: 'article'; actId;
articleKey } | { kind: 'decision'; decisionId }, place: 'table' | 'beside', label }`.
`findLiveBackIndex` keeps an entry while its practice holds its subject. Going back makes that
practice active and either reveals the row (`table`) or opens the subject beside (`beside`).
`ReadingBackControl` stays one, global, without a shortcut. While the flag exists the stack accepts
both shapes; P6 drops the tab shape.

**6.4 The structure window** is unchanged in kind: `TreeViewPanel variant="window"` on the desktop,
`"drawer"` on the phone, one owner (`structureWindow.blockId`, now an act id), picks load into the
act through `useAnnexNavigation`, which takes an `addArticles(norma, articles)` callback in place of
`tabId` (P6 removes `tabId`).

**6.5 Study Mode** opens from the act's «Studio» (D5) on the act's articles, unchanged inside
(`LazyStudyMode`). Mounted only with an article in hand, as today.

**6.6 «Cerca nel testo»** (norms-decisions §13) comes with the reading surfaces: every open row, the
article window and the decision window have their own box; the registry is keyed by owner, so
several can search at once. Rule 23 is untouched (§11).

**6.7 «Cerca negli articoli aperti»** (Cmd/Ctrl+F, `useGlobalSearch`) scans every article of every
practice; a result names its practice and act; a click makes that practice active, reveals the row
and asks the surface to scroll to the occurrence (`requestSearchNavigation`, as today).

**6.8 Compare** (`CompareView`) lists the articles of every practice, labelled with the practice's
name and the version suffix, instead of every tab's.

**6.9 The palette** keeps every action: a norm search (§5.1), «Apri l'indice e sfoglia» (§5.1), a
decision (§6.2), a topic (a `decision-search` window), aliases and quick norms untouched.

**6.10 The dossier's «Apri tutto»** (gotcha 15): §5.1. `searchesForGroups` keeps its signature; the
callback returns the one practice's id for every group. P6 renames `SearchParams.targetTabId` to
`targetPracticeId`.

### 7. «Salva come dossier» (D6)

From the practice header, the chip's «⋯» and «⋯ › Aggiungi a un dossier…» (an existing dossier).
- **Order of the items**: the acts in table order, each act's articles in table order, then the
  decisions in `decisionOrder`. A pure function `practiceDossierItems(practice)` returns the norma
  items (`normaForDossier(act.norma, article)`) and the decision items (`sentenzaFromDecision(
  identity, { sezione, tipo, data_deposito })`), and the decisions it cannot save: an entry never
  identified (a citation that did not resolve, a choice between candidates not made).
- **A new dossier** (gotcha 17): `createDossier(practice.label)` first — the server's id or
  nothing — then `addToDossier` per item, then one `setDossierItemOrder` with the computed order,
  which waits for every pending id (`pendingDossierOrders`). Duplicates cannot occur in a new
  dossier.
- **An existing dossier**: items already there (`dossierContainsArticle`, which compares versions;
  for decisions, the same identity) are skipped and counted; nothing is reordered.
- **The toast** says what happened: «Salvato nel dossier «…»: 4 articoli, 2 sentenze», plus «1
  sentenza non identificata non è stata salvata» or «2 già presenti» when so. A refused dossier
  creation keeps the practice untouched and says so.
- The practice stays as it is (D6: it is not linked to the dossier).

### 8. The phone (D11)

One layout mounted (T4, `useIsDesktop`).
- **The main screen is the table**: the header switches practices (today's chevrons, name and dots,
  now over practices; a tap on the name opens the list with «+ Nuova pratica»); the body is the same
  column component as the desktop (`PracticeColumn`): acts with their index line and rows opening in
  place, «Giurisprudenza» at the bottom.
- **«Apri accanto» opens full screen** (`ReadingFullScreen`): a header «‹ Pratica» (44 px, returns
  to the table where it was) and the title; the body is the window's body (§4.1). A decision opened
  from a link opens this way too (as decision tabs do on a phone today). There is one full-screen
  view at a time; the store's `beside` list is shared with the desktop, and the phone shows its
  newest entry.
- **Extracted articles are gone** (D12); the phone already never showed them.
- The structure index stays the drawer; Study Mode as today; the back control as today, telling
  the phone view which practice and place to show.

### 9. Migration of the saved workspace (D13)

`practicesFromTabs(tabs: unknown): { practices: Practice[]; activePracticeId: string | null;
dropped: string[] }`, pure, never throwing:
1. Each tab without `view` becomes a practice with its `id`, `label` and `labelIsCustom`, in the
   tabs' array order (the dock's order). A tab with no content becomes an empty practice: its name
   is the user's.
2. Its norm blocks become acts by `actKeyOf`; two blocks of one act merge (the first block's id is
   kept). Its loose articles join their act (`actKeyOf(sourceNorma)`), created if absent. A
   collection's articles join theirs. Articles are deduplicated by `practiceArticleKey` and sorted.
3. Decision tabs go under «Giurisprudenza» of the practice whose tab had the highest z-index, or of
   a new practice «Sentenze» when there was no norm tab (T10). Their reference is kept as saved (by
   identity once found, `identified: true` then). Two tabs of one decision cannot exist; if they do,
   one entry is kept.
4. The decision-search tab with the highest z-index becomes the only window of that practice; any
   other is dropped and named in `dropped` (logged once, gotcha 18). The other decision tabs become
   entries without windows.
5. The active practice is the one whose tab was in front. Positions, sizes, z-indexes and flags are
   dropped.

**Where it runs.** While the flag exists, the store's `merge` seeds `practices` from
`workspaceTabs` when the flag is on and nothing was saved under `practices` yet; the tabs stay as
they are. P6 sets the persist `version` to 1 with a `migrate` from version 0 that keeps saved
`practices` if any, else runs the same function, and drops `workspaceTabs` and `highestZIndex`.
Both paths are synchronous and pure: StrictMode cannot run them twice against one value (gotcha 14).

**Nothing is lost.** Every article keeps its `norma_data`, so `buildItemKey` and
`uniqueArticleIdFromNorma` — the keys of highlights, notes and discussions — are the same before and
after; every decision keeps its reference, so `decisionKey` is the same. A past text keeps its
version (gotcha 32: it stays read-only, and `versionKey` keeps it apart). The tests run the function
on saved states taken from the code's own shapes: two tabs of one act, a loose article, a collection
(forged: no button makes one), a past-text tab, a decision tab found and one not found, two topic
tabs, an empty tab, malformed entries (§10).

## 10. Security and data

- **Saved state is untrusted input.** `localStorage` can hold an old shape, a hand-edited value or
  garbage. `sanitizePractices` keeps a practice only with a string `id` and `label` and arrays where
  arrays belong; an act only with a `norma.tipo_atto` string and articles with a `norma_data`; a
  decision only with a reference that passes today's `isValidView` checks (court, positive integer
  number and year); a `BesideRef` only when it points at something the practice holds. What fails is
  dropped and logged, never thrown: a throw in `merge` would reset the whole store.
- **User isolation.** `clearUserData` empties `practices`, `activePracticeId`, the open rows and the
  pending reveal at logout, as it empties the tabs today: a shared browser must not show the last
  user's table. Annotations and dossiers are server-side and already cleared.
- **Labels are text.** A practice name and every label are rendered by React as text, never as
  HTML; a name is trimmed and capped at 120 characters.
- **Server-backed data stays server-backed** (gotcha 17). The practice is workspace UI state, as
  the tabs are; «Salva come dossier» creates the dossier on the server first and adds items through
  the existing optimistic, reverting actions.
- **No new route, no new request kind.** The table fetches nothing the tabs did not; a decision
  under «Giurisprudenza» added by «Apri tutto» is fetched only when read.
- **Storage size.** T3 keeps the texts in `localStorage`, as today. While the flag is on the texts
  are stored twice (tabs and practices); a `QuotaExceededError` on save is logged by the persist
  layer and the app keeps working in memory. The flag's life is short (§12) and P6 stores them once.

## 11. Root rule 23

No reading surface is changed in what it renders. The row and the window mount `ArticleTabContent`
and the decision's view; `variant="beside"` only chooses which siblings of the text are drawn
(toolbar buttons, Brocardi folded, the Studia row and MERL-T entries absent): nothing inside
`ArticleBody`'s text root, nothing in `renderArticleHtml` or `renderDecisionHtml`. Every new label —
«Aperto accanto», chips, counts, the window's title — sits outside the text root. Tests: the
existing `articleRender.test.ts` and `decisionRender.test.ts` stay green untouched; a new test
renders an article in the window and checks that its text root's text nodes spell `article_text`
minus `\n` (the fixtures of `utils/__fixtures__/articleTexts.ts`), with a find box open as the
§13 tests do.

## 12. Sequencing

**Before the redesign code**: this documentation PR; **PR 5 of the norms-decisions round**
(`feat/decision-history`, decisions in the Cronologia, Tasks 23–24 of that plan). PR 5 goes first,
as the controller expects: it is small and independent of the workspace (a Prisma migration, the
history controller, `HistoryView` and one record in `DecisionTabView`), it can run while VisuaLex
Studia PR A is in flight, and P3 then carries its once-per-opening record into `DecisionEntryView`
instead of the other way round (doing it after would mean writing it twice).

**The redesign code starts after VisuaLex Studia PR A merges** (it touches `ArticleTabContent` and
`SelectionPopup`); whoever merges second merges `origin/develop` into its branch first. P1 and P2
touch neither file; if PR A is delayed the orchestrator may start them earlier, at no conflict risk.

**The redesign PRs**, each shippable on its own, P3–P5 behind `VITE_FEATURE_PRACTICE_TABLE`
(absent = off; a browser pass starts the web with `VITE_FEATURE_PRACTICE_TABLE=true` in its environment):

| PR | Branch | What | Flag |
|---|---|---|---|
| P1 | `refactor/workspace-groundwork` | Collections removed (a saved one becomes loose articles at load); `workspaceTabActions.ts` deleted; `utils/practice.ts` with the model, the rules and the migration, tested. No visible change. | none |
| P2 | `feat/practice-store` | The flag; the practice slice, its actions, persistence and seeding; decisions and windows in the store; the two-shape back-stack. Inert: no entry point calls it yet. | gates the seeding |
| P3 | `feat/practice-table` | The desktop table and the bar of practices; searches, the index, the dossier's «Apri tutto», decisions (opened in place until P4), global search and compare routed to the practice; «Salva come dossier». | on = new desktop |
| P4 | `feat/reading-window` | The light window, «Apri accanto», the row of two and its layout; decisions and topic searches beside; citations from a window; the back-stack over practices. | on = windows |
| P5 | `feat/practice-phone` | The phone: the table as main screen, full-screen reading with «‹ Pratica», the practice switcher. | on = new phone |
| P6 | `refactor/retire-floating-tabs` | The flag removed; persist version 1 migrates every browser; the tab model, its components and actions deleted; `besideTabId` renamed; tours and `apps/web/CLAUDE.md`. | removed |

The order is P1 → P6, one after another: each builds on the one before (P5's full-screen reader
reuses P4's window body). After P6 merges, the owner's trial on the development stack and then the deploy he
asked for («implementiamo prima tutto e poi mettiamo sul ROG»).

## 13. For the owner

One choice follows from his answers but undoes an earlier one, so it is named here rather than
asked: **a past text sits in its act as a row marked «Testo al …»** (T2, §5.3), as the dossier
already shows it (dossier decision 8), instead of opening in a tab of its own («Testo alla data»).
If he wants past texts apart, the alternative is a practice of their own per date, at the cost of a
practice the user did not ask for at every «Testo alla data».

## Verification

- **Pure modules, no DOM**: `practice.ts` (`addArticles` with duplicates, past texts, annexes,
  Brocardi and URN backfill, the code with and without its R.D.; `decisionOrder`; `sameDecision`;
  `besideAfterOpen` with and without the asker; `practicesFromTabs` on every case of §9;
  `sanitizePractices` on garbage), `besideLayout`, `practiceDossierItems`.
- **Store**: actions atomic under StrictMode (open beside twice, drain a pending decision once,
  consume a reveal once); persistence (`partialize`, seeding only with the flag on and nothing saved,
  P6's `migrate`); `clearUserData`.
- **Components**: the act block (index line, rows, Studio locked on a past text, «Sposta in…»,
  «Rimuovi l'atto»), the row (rubrica, chips, «Apri accanto», folded when beside), «Giurisprudenza»
  order, the window (compact toolbar, Brocardi closed, no Studia row), the bar (switch, rename, new,
  close with confirmation), the phone view and the full-screen reader, «Salva come dossier».
- **Rule 23**: §11.
- **Suites**: `npm --prefix apps/web run test -- --run`, `run build`, `run lint` at every PR; no
  server or Python change.
- **Browser pass at every PR** (P3 on), logged in on `http://localhost:5173` with the flag on,
  desktop and a phone width (390 px): before turning the flag on, build a workspace on the old
  surface — two tabs, an act with three articles, an extracted article, a past text, a decision
  opened beside an article, a topic search, a highlight and a note on an article and on a decision;
  add a forged collection to `visualex-storage` in devtools; reload with the flag on and check every
  item is in its practice, the highlight and the note show, and the old tabs come back with the flag
  off. P6's pass repeats this with no flag, from a browser saved before P6.

## Coordination

- **VisuaLex Studia PR A**: §12. After it merges, P4's window omits its row; Studia's spec gets no
  amendment (the row stays under every article in the table).
- **Norms-decisions PR 5**: §12; P3 moves its record into `DecisionEntryView` and keeps its test.
- **MERL-T**: the Massimario panel's slot props (`besideTabId`) are renamed in P6, in `apps/web`
  only; the graph rail's coordinator (`railFocus.ts`) is unchanged — the column can mount several
  articles, which it already handles.
- **LibreLex and the graph**: the `/sentenze/…` addresses and `?norma=` deep links are unchanged.
- **The tours**: P6 re-anchors the workspace and block tours on the new classes.

## Later

- The practice as a server-side dossier (Q6 b), with its own interview.
- Holding references only in the browser and refetching texts (T3).
- A divider the reader drags between the table and the windows (T6).
- An act's title line in the table, as the dossier shows it (`/fetch_rubriche` `title`).
- «Cerca nel testo» in Study Mode and the dossier reader (norms-decisions, Later).
