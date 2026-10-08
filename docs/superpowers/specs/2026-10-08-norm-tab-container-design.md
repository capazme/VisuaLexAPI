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
for the round: build and merge the whole redesign first, and only then deploy it on the deployment
host. On 8 October he also answered the one question the first draft of this spec left open, with
«procedi» (§13, D15).

**Amendments to earlier designs.**
- `2026-10-05-norms-decisions-search-design.md` §2.1–§2.3 (a decision is a workspace tab, «reading
  1»): a decision becomes an entry of the practice, listed under «Giurisprudenza», and is read beside
  it in a light window (§3, §4 below). The addresses of §3 there (`/sentenze/…`) do not change.
- `2026-10-05-norms-decisions-search-design.md` §13.1 (PR 4d, one floating find window): its scope
  switch «Questa scheda» / «Tutte le schede» is renamed «Questa pratica» / «Tutte le pratiche» in
  P3, and its scope reads the practices instead of the tabs (§6.6–§6.7 below).
- Round 2b (agreed in August, never built; `2026-08-26-lettura-navigabile-round2a-design.md`, «Out
  of scope — round 2b»): kept and corrected, §1 below.
- «Testo alla data» (`2026-10-01-testo-alla-data-design.md`, its T5: «In this slice the historical
  text stays in its own tab, as today»): a past text no longer opens in a tab of its own; it is a
  row of its act, marked «Testo al …», as in the dossier (D15, §5.3). That T5 deferred the change
  until the reader left the window, which this round does; the same spec's «v2 — the text switches
  inside the page» is replaced by the two rows, not built.

## What was measured

All in the code of `develop` at `1f0c0af8`, 8 October 2026, except where a line names PR 4d, which
is read from its spec and plan (`feat/find-window`, f8f0cf04).

- **A tab is a floating window holding a list of mixed things.** `WorkspaceTab`
  (`apps/web/src/store/useAppStore.ts`) has a position, a size, a z-index, minimised and hidden
  flags, a label with `labelIsCustom`, a `content: TabContent[]` and, since PR 2 of the
  norms-decisions round, an optional `view` (`decision` or `decision-search`). It records no
  creation time. `TabContent` is `NormaBlock | LooseArticle | ArticleCollection`.
  `WorkspaceTabPanel` (619 lines) draws the window: drag by the header, resize on eight handles,
  minimise, rename, «Aggiungi a dossier» (every article of the tab, no decisions: a decision tab
  hides the button), close behind a danger confirmation.
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
  `useIsDesktop` (`(min-width: 768px)`), because each `ArticleTabContent` loads discussions,
  rubriche and the saved-norm check.
- **The collections are dead code.** `createCollection` has no caller outside the store and one
  store test (`store/__tests__/decisionTabs.test.ts`); no button reaches it. The drop zone that
  `moveLooseArticleToCollection` serves exists only inside `ArticleCollectionComponent`, which draws
  only an existing collection. A collection can therefore reach the screen only from a browser that
  saved one long ago. `WorkspaceTabPanel`, `WorkspaceManager`, `SortableWorkspaceTab` and
  `CompareView` still branch on it.
- **`store/workspaceTabActions.ts` is a dead duplicate** (gotcha 25): nothing imports its factory;
  `hooks/useGlobalSearch.ts` imports its `NormaBlock` and `LooseArticle` types, and is its only
  importer. PR 4d deletes `useGlobalSearch.ts`.
- **Where a search lands** is `SearchPanel.processResult`: with `targetTabId` (the dossier's «Apri
  tutto», gotcha 15) the given tab; else the tab of the same streaming search; else, for a custom
  label, an open custom tab of that label; else (R3 of streaming-ux) a non-custom tab already
  holding the same act and no past text; else a new tab. A past text never merges: it opens a tab
  named «… — testo al …» (`versionTabSuffix`). A block is matched by `tipo_atto`, `numero_atto` and
  `data` as stored, and an article inside it by annex and number only (`addNormaToTab`), so a block
  cannot hold two versions of one article.
- **The dossier's «Apri tutto»** pre-creates tabs synchronously: `DossierDetailView` and
  `DossierListView.openAllGroupsOnDashboard` pass `addWorkspaceTab` to `searchesForGroups`
  (`dossierUtils.ts`), which calls it once for the texts in force and once per past group;
  `DossierListView.openGroupOnDashboard` (a dossier with one group, or one group picked) calls
  `addWorkspaceTab` itself and passes the tab id as `targetTabId`. Neither opens the dossier's
  decisions.
- **The workspace is persisted whole in the browser.** `partialize` keeps `settings`,
  `searchPanelState`, `workspaceTabs` (with every article's `ArticleData`, text and Brocardi
  included), `highestZIndex` and the structure window's position. There is no `version`, no
  `migrate` and no custom `storage`; `merge` drops malformed decision views (`sanitizeViews`).
  zustand 5.0.8's `persist` writes through `storage.setItem` synchronously inside every `set`, so a
  `QuotaExceededError` today is thrown out of whichever store action ran, after memory changed.
  `clearUserData` empties the tabs at logout. Transient errors reach the user through
  `pushSyncError` (`lastSyncError`, drawn by `ui/SyncErrorToast`).
- **The reading back-stack points at tabs and blocks** (`utils/readingBackStack.ts`:
  `{ tabId, blockId, articleId, label }`; a decision tab names itself as its block). It is
  session-only. `ArticleTabContent` builds the entry from its `readingOrigin = { tabId, blockId }`
  and `useCitationLinks` pushes it.
- **Find in the text.** On `1f0c0af8`, «Cerca negli articoli aperti» (`useGlobalSearch`,
  `GlobalSearch.tsx`, Cmd/Ctrl+F) scans every norm block's and loose article's stored text, and PR
  4c's magnifier opens a box under the reading toolbar. **PR 4d** (norms-decisions spec §13.1,
  being built) replaces both with one floating window, mounted once in `Layout`: a scope switch
  «Questa scheda» / «Tutte le schede»; `utils/findScope.ts` lists the texts in scope from the tabs
  (the front tab = the visible tab with the highest `zIndex`, or the tab on screen on a phone);
  `utils/findTargets.ts` registers the text roots on screen (`registerFindRoot({ tabId, targetKey,
  label, element })`); `hooks/useFindWindow.ts` counts matches on screen and in stored texts and
  reaches an undrawn one with `bringTabToFront` and `focusArticleInTab`; the window opens at the top
  right of the results area and remembers a dragged place for the session.
- **Other readers of the tabs**: `CompareView` lists every article of every tab as a candidate;
  `ReadingBackControl` brings a tab to the front; `useAnnexNavigation` loads an article picked from
  the index into its tab (`addNormaToTab`); `useAutoSwitch` (`onRemoveDuplicateTabs`) closes every
  tab holding an act when a search switches to its annex; the tours anchor on
  `.workspace-tab-panel`, `.norma-block-header`, `.norma-article-tabs`, `.norma-study-mode-btn`,
  `.norma-structure-btn` and `#tour-workspace-dock` (`config/tourConfig.ts`).
- **A decision tab** is one per decision (`openDecisionTab`, `sameDecision`), placed beside the tab
  it was opened from (`placeSideBySide` over `utils/workspaceOrigin.ts`), persisted by reference
  until found and then by identity (`setDecisionTabIdentity`, which also closes a duplicate and asks
  the survivor to take focus). A saved reference does not say whether it was found: a citation can
  carry `archivio` before it is. A topic search is a `decision-search` tab (`DecisionSearchTabView`).
- **Annotations do not depend on the tab.** Highlights and notes are keyed by
  `buildItemKey(norma_data)` (`utils/normaKeys.ts`: the act's type, number and date, the annex, the
  article number; no version) for an article and by `decisionKey(identity)` with `articleId ''` for
  a decision; discussions by the same anchor. Moving an article from one container to another
  changes no key. A code's articles carry `allegato: '2'` and the decree's number and date when
  they come from a search, and none of them when they come from the index (`shownAnnex`'s comment
  in `dossierLayout.ts`; `utils/__fixtures__/citationGolden.ts`): the two copies of one article
  have different `buildItemKey`s.
- **The dossier already has the shape asked for** (`2026-10-04-dossier-per-atto-design.md`,
  `components/features/dossier/dossierLayout.ts`): an act's identity is a code's name or
  `tipo_atto|numero_atto|data` (`actKeyOf`); acts in the order they arrived, reorderable by drag;
  articles by annex, number and ordinal, the text in force before past texts (`compareArticles`);
  past texts and annexes as rows of their act; decisions under «Giurisprudenza», in stored order.
- **Feature flags** live in `apps/web/src/features/<area>/featureFlag.ts` (`features/merlt/`,
  Studia's `features/studia/` in its plan), read from `import.meta.env` and on unless the variable
  says otherwise: they hide a finished area in a deployment. Vite reads them when it starts.
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

Every interview answer is a decision; D-numbers follow the questions. D15 is the owner's answer to
the question the first draft left open (§13).

| # | Decision | From |
|---|---|---|
| D1 | The table is sized for three to ten articles of two or three norms plus one or two decisions; at most two texts are read side by side. | Q1, hypothesis confirmed |
| D2 | The redesign removes the one-article-at-a-time strip, the overlapping windows, and the split between norms and decisions. | Q2, hypothesis confirmed |
| D3 | The phone's single column becomes the reading form on every screen: the articles of an act one under the other, an index on top to jump. | Q3 (a) |
| D4 | **Form A.** The container is the practice's table, read on its own like a dossier; «Apri accanto» takes an article or a decision into a light window for comparison. Not B (everything floating, the container an index) nor C (no windows, the table split in two). | Q4 A |
| D5 | The article's light window holds, on top, the title («art. 2043 c.c.») and the reading bar (notes, highlights, discussions, copy); then the text; at the bottom, closed, Brocardi and «Giurisprudenza». Studio, Struttura and PDF stay on the act's block in the table, not in the window. | Q5 |
| D6 | **Similar, not the same:** the table has the dossier's shape (acts, articles by number, «Giurisprudenza») but stays the user's work table, saved in the browser. «Salva come dossier» turns it into a real dossier. Making it a server-side dossier is a later step. | Q6 (a) now, (b) later |
| D7 | A decision opened from an article enters the table under «Giurisprudenza»; opened to be read, it also opens beside, in a window. Closing the window leaves it in the table. | Q7 |
| D8 | Acts in order of arrival, reorderable by drag, and an act's articles by number, as in the dossier; decisions at the bottom, by date of deposit (the dossier keeps its decisions in stored order: this order is the practice's own, T7). | Q8 |
| D9 | One table per practice (round 2b's contexts); the dock becomes the bar of practices; a click changes table; light windows belong to the practice they were opened in and disappear when the practice changes. | Q9 |
| D10 | «Apri accanto» always lines the windows up to the right of the table, two at a time; a third takes the place of the oldest, which stays only in the table. Not «free and draggable as today». | Q10, the proposal |
| D11 | On the phone the table is the main screen (today's column, «Giurisprudenza» at the bottom); «Apri accanto» opens the article or the decision full screen with «‹ Pratica» to return; extracted articles no longer exist. | Q11 |
| D12 | Removed: «Estrai come articolo loose» (replaced by «Apri accanto»), the article collections, the strip of article tabs (replaced by the continuous column). | Q12 |
| D13 | On first load after the change, each tab becomes a practice with the same acts and articles; an extracted article joins its act; an open decision goes under «Giurisprudenza». Notes, highlights and discussions are tied to the article, not to the tab, so nothing is lost. | Q13 |
| D14 | Spec first, then the plan. The interview placed the change after PR 3 and before PR 4 of the norms-decisions round; PR 3, 4, 4b and 4c have since merged, so the order the owner set on 8 October applies: this documentation PR, then PR 5 (decisions in the Cronologia) and the redesign code (§12). | Q14, as overtaken by events |
| D15 | **A past text is a row of its act**, marked «Testo al …», beside the text in force, as the dossier shows it (dossier decision 8). It ends the «tab of its own» of «Testo alla data» (that spec's T5) and takes the place of that spec's in-page switch (its v2). | The owner, 8 October: «procedi» (§13) |

### Technical choices made here

These are recommendations within the owner's answers, each with its trade-off. The one that undid
an earlier decision was put to him and answered (§13, D15); none of the others needs him.

| # | Choice | Trade-off |
|---|---|---|
| T1 | **A new `Practice` model replaces `WorkspaceTab`**, rather than adding fields to the tab. | A rewrite of the workspace slice, against a tab type whose position, size, z-index, `view` and three content kinds all stop meaning anything; evolving it in place would keep every dead field and every `else` branch alive. |
| T2 | **An article in a practice is identified by `buildItemKey(norma_data)` plus `versionKey`** (`practiceArticleKey`). Two copies are one row only when both parts match; copies whose annotation keys differ are never merged, so no row hides a highlight or a note. A past text is a row of its act, beside the text in force (D15). | A code's article from a search (`allegato: '2'`, the decree's number and date) and from the index (none) are two rows when both arrive — visible, and both rows show their annotations. To keep that rare, the index pick, the act's arrows and a citation jump first look for a row already holding the article (`findPracticeArticle`, §2) and reveal it instead of adding one. Gotcha 32 holds per row. |
| T3 | **The practice keeps the articles' `ArticleData` in the browser, as the tabs do today.** | No refetch on reload and no new cache, at the cost of `localStorage` space (texts of several acts); while the flag is on (§12) the tabs and the practices are both stored, and a save that overflows is caught (T20, §10). Holding references only and refetching through `articleFetchCache` is Later. |
| T4 | **One layout mounted per breakpoint** (`useIsDesktop`), never a CSS-hidden twin. | Ends the doubled `DecisionTabView` and the doubled article effects; the phone and the desktop no longer stay in sync while the window is resized across 768 px (the column keeps its open rows through the store, §5.4). |
| T5 | **On the desktop, a row read beside is folded in the column** («Aperto accanto · Chiudi la finestra»). On the phone no row is folded. | One mounted reading surface per subject on the desktop: one saved-norm check, one discussions panel, one registered find root. The reader cannot see the same article twice, which nothing asked for. |
| T6 | **Windows are docked in a row, not dragged.** Widths come from one pure function (§4.3). | The interview chose the proposal over «free and draggable as today»; a user-adjustable divider is Later. |
| T7 | **Decisions sort newest first**: by date of deposit when known (`attributi.data_deposito`, learned when the decision is found), else by year; ties by number. | The interview fixed the key, not the direction; newest first is how the Cassazione's lists are ordered in the app (`/search_decisions`, `sort=pd desc`). A decision never read has no date and sorts by its year. |
| T8 | **A topic search is a window, not an entry.** It is a question, not a source: it never enters «Giurisprudenza»; a decision opened from it does. On the desktop it is a light window (from P4; a band at the top of the table in P3); on a phone it opens in the full-screen reader with «‹ Pratica» (from P5; the same band at the top of the phone's table in P3 and P4). | One fewer kind of row; a search is not kept once its window is replaced, as it is not kept once its tab is closed today. |
| T9 | **Built behind `VITE_FEATURE_PRACTICE_TABLE`**, read by `isPracticeTableEnabled()` in `apps/web/src/features/practice/featureFlag.ts`, the house's place for flags, but **off unless the variable is `true`**, unlike the house's flags. The practices are persisted beside the tabs and seeded from them once, marked by `practicesSeeded` (§9); the last PR removes the flag, migrates every browser and deletes the tab model (§12). | The house's flags are on by default because they hide a finished area in a deployment; this one hides unfinished work on `develop`, so a build that does not ask for it must get the old surface. Develop stays usable between PRs (root CLAUDE.md: experiments sit behind flags). While the flag is on, the tabs and the practices diverge: turning it off shows the tabs as they were. Vite reads the flag when it starts, so a browser pass runs the branch's own Vite on its own port, never the shared stack on :5173 (§12). |
| T10 | **Migration placement**: a decision tab goes under «Giurisprudenza» of the practice whose norm tab had the highest z-index, or of a new practice «Sentenze» when there is no norm tab; the topic-search tab with the highest z-index becomes a window of that practice; any other is not reopened, and the user is told which (§9). | «Highest z-index» everywhere, never «newest»: a tab records no creation time and the array order is the dock's drag order, while the z-index is the one last brought to the front — the one last looked at, and PR 4d's front tab. The old tabs do not record which tab a decision was opened from; the front tab is the likeliest. A search is re-run from the palette in one line. |
| T11 | **A search lands in the active practice**, creating one (named after its first act, `shortAct`) when there is none. R3's merge heuristics, the custom-label matching and the historical split retire; `targetTabId` keeps its role for the dossier's «Apri tutto» and names a practice (gotcha 15); a `targetTabId` that names no practice (closed meanwhile) lands in the active practice. | Simpler and predictable: what you search goes on the table you are looking at. A user who wants a new practice makes one from the bar. |
| T12 | **The window's reading bar** is the toolbar in a compact form: notes, highlights, discussions, copy and the magnifier «Cerca nel testo», which opens the find window (PR 4d). The rest of the toolbar (dossier, quick norm, share, export, «Testo alla data», compare, Studio) stays on the row in the table. | D5's «pulito come la sentenza»; one more step for those actions from a window. |
| T13 | **Acts move between practices from the act's «⋯»** («Sposta in un'altra pratica»), as round 2b planned; drag between containers goes. | Drag between floating windows has no target once there is one table on screen. |
| T14 | **The windows are persisted with their practice** (references only, at most two). They are the desktop's: the phone's full-screen reader is separate session state (T19). | Returning to a practice, or reloading, shows what was beside it. |
| T15 | **Open rows are session state**; after a reload every row is closed, like the dossier. | The column loads no article surface it does not need. |
| T16 | **The window a link was clicked in is never the one replaced** (§4.2): with two windows, the oldest window *that is not the asker* goes. | Q10 says «the oldest»; read literally, a decision opened from an article read in the older window would close that article. The rule differs from the answer only in that case. |
| T17 | **The whole dossier's «Apri tutto» also puts the dossier's decisions under «Giurisprudenza»**, unread (§5.1). New: today it opens only the articles. | The practice is the dossier's shape (D6); leaving the decisions out would make «Apri tutto» open half the dossier. No request is sent until a row or a window opens one. A single group or act opened from the dossier brings no decision. |
| T18 | **With the flag on, the desktop and the phone both draw the practices from P3.** P3 brings a plain phone table (the switcher over practices and the column); P5 adds the full-screen reader and the practice list. | Every store action that routes into a practice is drawn on both breakpoints, so nothing is written where nothing draws it, the tabs and the practices never diverge by breakpoint, and P6's migration finds everything in the practices. The other way — routing only on the desktop until P5 — keeps P3 smaller but lets a phone with the flag on keep writing tabs that P6 then drops. |
| T19 | **The phone's full-screen reader is session state of its own** (`phoneReader`, one subject — an article, a decision or a topic search — or none), never the desktop's persisted `beside`. | A reload on a phone, or a desktop window narrowed below 768 px, lands on the table (D11); «‹ Pratica» always returns to the table; rows are folded only by the desktop's windows. |
| T20 | **The persist storage is wrapped** (P2): a failed save is caught, logged with context and shown once as a sync error, never thrown out of `set`. | The app keeps working in memory and says that the table is not being saved; without the wrapper an overflow throws out of every store action (searches, decisions, dossier actions). |

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
  /** The light windows beside the table on the desktop, oldest first, at most two (D10, T14). */
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
  identified: boolean;     // the reference is the decision's identity: set on a found answer, never guessed
  depositDate?: string;    // attributi.data_deposito, ISO, once found (T7)
  tipo?: string;           // attributi.tipo, kept for «Salva come dossier»
}

/** What a light window shows. `id` is stable for the subject, so opening it twice finds it. */
export type BesideRef =
  | { id: string; kind: 'article'; actId: string; articleKey: string }
  | { id: string; kind: 'decision'; decisionId: string }
  | { id: string; kind: 'decision-search'; query: DecisionSearchQuery; label: string };

/** `buildItemKey(norma_data)` + '|' + `versionKey(...)` (T2). Which field a «Testo alla data»
 *  search always fills, `norma_data` or `versionInfo`, is confirmed in plan Task 3. */
export function practiceArticleKey(article: ArticleData): string;

/** The row of `act` holding the article `articleId` names (an index pick, an arrow, a citation, a
 *  back-stack entry): `findArticleByNormalizedId` over the rows (gotcha 9), a code's annex compared
 *  through `shownAnnex`; the text in force before a past text. */
export function findPracticeArticle(act: PracticeAct, articleId: string): ArticleData | undefined;
```

Store state (in `useAppStore.ts`): `practices: Practice[]`, `activePracticeId: string | null` and
`practicesSeeded: boolean` (all three persisted; §9), and, session-only, `practiceRows:
Record<string, true>` (open rows, keyed `practiceId/actId/articleKey` or `practiceId/decisionId`,
T15), `pendingReveal` (one row to open and scroll to, consumed once, gotcha 14), `phoneReader`
(`{ practiceId, ref: BesideRef } | null`, T19) and `practiceNotice` (the migration's message, taken
once, §9).

**How today's types map:**

| Today | Becomes |
|---|---|
| `WorkspaceTab` without `view` | `Practice` (same `id`, `label`, `labelIsCustom`) |
| `NormaBlock` | `PracticeAct` (same `id`; blocks of one `actKeyOf` merge) |
| `NormaBlock.articles` | `PracticeAct.articles`; only identical `practiceArticleKey`s merge (T2) |
| `NormaBlock.autoFocusArticleId` | `pendingReveal` |
| `LooseArticle` | an article of its act (`actKeyOf(sourceNorma)`) |
| `ArticleCollection` | each article into its act |
| `WorkspaceTab.view` `decision` | a `PracticeDecision` (+ a window when opened to read) |
| `WorkspaceTab.view` `decision-search` | a `BesideRef` of kind `decision-search` |
| `position`, `size`, `zIndex`, `isMinimized`, `isHidden`, `highestZIndex` | gone (the layout is computed, §4.3) |

**The rules** (all in `utils/practice.ts`, tested without a DOM):
- `addArticles(acts, norma, articles)`: finds the act by `actKeyOf(norma)` or appends one;
  inserts each article whose `practiceArticleKey` is not already there, keeps the sort; a copy with
  the same key fills what the stored one lacks — `brocardi_info` (today's `addNormaToTab`
  backfill) and the act's URN (today's `addNormaIndexToTab` backfill) — and never replaces its
  `norma_data`.
- `findPracticeArticle(act, articleId)`: above; used before anything is fetched or added from an
  article id.
- `decisionOrder(decisions)`: T7.
- `sameDecision(entry, reference)`: today's rule, moved from the store: same court, number and year;
  a citation with an archive matches only that archive.
- `besideAfterOpen(beside, ref, { askerId? })`: D10, T16 (§4.2).
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
- **The index on top** (D3): one line of chips, one per row of the act («1218 · 2043 · 2236»;
  «All. A 1» for an annex, `shownAnnex`, so a code's articles show none; a past text's chip carries
  «· testo al …»), each opening its row and scrolling to it; at the end of the line, today's
  `ArticleNavigation` (previous and next in the act's tree: a row already there is revealed through
  `findPracticeArticle`, an article not yet on the table is loaded into this act) and the loading
  chip. The annex suggestion (`AnnexSuggestion`) shows inside the open row it concerns.
- **Rows** (`PracticeArticleRow`): «art. 2043 — Risarcimento per fatto illecito» (`articleLabel`
  from dossierLayout, the rubrica from the article's own text through `getRubricText` — no request),
  a chip «Testo al 29/12/2007» for a past text (`historicalItemLabel`); on the right «Apri accanto»
  (§4) and «Togli dal tavolo» (×, no confirmation: the article stays one search away, and the
  undo is the search). The expand toggle is scoped to the row header (keyboard-accessible
  collapsible convention; never wrapping the reader or the buttons, gotcha 22). Open, the row
  mounts `ArticleTabContent` exactly as the block mounts it today, with `readingOrigin = { tabId:
  practice.id, blockId: act.id }` and `onOpenStudyMode`. On the desktop, a row shown beside folds
  and says «Aperto accanto · Chiudi la finestra» (T5).
- **Which rows open by themselves**: the article a one-article search asked for (today's R2), and
  the first article of a new act from a range (R1: the others stay closed). Both through
  `pendingReveal`. A citation jump or a back-stack return opens and reveals its row.

**3.3 «Giurisprudenza»** (`PracticeDecisionsSection`), after the acts, only when there is one:
rows «Cass. civ., sez. III, n. 28994/2019» (the entry's `label`), in `decisionOrder`, each with
«Apri accanto» and ×. A row opens in place on the decision's reading surface (§6.1): the table
reads on its own (D4).

**3.4 The bottom of the column.** The bar of practices floats over the results area (`fixed
bottom-6`, §5), so the column reserves a bottom padding equal to the bar's height plus its 24 px
offset: the last row, and the last «Giurisprudenza» row, scroll clear of it. The same holds for a
window's scrolling body.

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
- `decision-search`: `DecisionSearchTabView` as today (T8). It holds no text of its own and is not
  searched by the find window.

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
is removed and the new one appended on the right (T16). A removed window's subject stays in the
table (D10). The asker is the window a link was clicked in: a decision opened from an article in a
window must not close that article. Windows belong to their practice (D9): switching practice hides
them, returning shows them again (T14).

**4.3 The layout** (`besideLayout(width, count)`, pure, tested). The free width is the results
area's. No window: the table takes it all, its text at the 68ch measure. One window: table and
window share it half and half. Two windows: three equal columns when each gets at least 420 px;
otherwise the table folds into a 48 px rail («Pratica», vertical, with the count) and the windows
share the rest — the rail opens the table as an overlay over the windows, closed by Esc or a click
outside. Below 768 px there are no windows (§8).

**4.4 Where the find window opens.** PR 4d opens the find window at the top right of the results
area, which with windows beside is the right-hand window's header and its ×. So `ReadingRow`
gives the find window its default place: with no window, PR 4d's; with windows beside, the top
right of the table's column, under the practice header; with the rail, the top of the first
window's body, under its header. A place the user dragged it to is kept for the session and
clamped, as PR 4d does.

**4.5 What opens beside, and what goes back.** «Apri accanto» on a row; a decision opened from any
link (§6.2); a topic search; a norm cited inside a window's text (the cited article enters its act
and opens beside the asking window). A citation clicked in a row of the table opens and reveals the
cited row in the column, as a same-act jump does today. `readingBackStack` records citation jumps
and the jump from an article to a decision, as today; its entries name the practice, the subject and
where it was read (§6.3).

### 5. The dock becomes the bar of practices

`PracticeBar` replaces `WorkspaceNavigator` (D9), same place (`fixed bottom-6`, `Z_INDEX.dock`),
same collapse toggle («N pratiche»); the column keeps clear of it (§3.4).
- **One chip per practice**: the name and a count («2 atti · 1 sentenza»); the active one marked
  (`aria-current`); a click makes it active; double-click renames; drag reorders (today's sortable
  list); «⋯» per chip: «Rinomina», «Salva come dossier», «Chiudi la pratica» (danger confirmation).
- **«+ Nuova pratica»**: creates «Nuova pratica», makes it active and opens its name for editing.
- **«Chiudi tutte»** stays, behind its danger confirmation (the practices are persisted). It never
  brings the old tabs back: the seeding marker stays set (§9).
- **Gone**: «Allinea», minimise and show/hide (nothing floats).

**5.1 Where things land** (T11). A search's results enter the active practice; with no practice, a
new one named after the first act. A `targetTabId` that names no practice falls back to the
active practice, created when there is none, with a `console.warn` naming the id.

The dossier's «Apri tutto» (gotcha 15) creates **exactly one** practice, named after the dossier
(`labelIsCustom`), synchronously, before `navigate('/')`; it becomes the active practice, since the
user asked to see the dossier on the table. `searchesForGroups` is called with `() => practiceId`,
so the texts in force and every past group target that one practice, the past groups as rows of
their acts (D15). This holds for every way in: `DossierDetailView`'s action and its picker
(«Apri tutto» or one group), `DossierListView.openAllGroupsOnDashboard`, and
`DossierListView.openGroupOnDashboard` (one group: it calls `createPractice` in place of
`addWorkspaceTab` and passes the practice's id). When every group of the dossier is opened (the
picker's «Apri tutto», or a dossier with one group), the dossier's decisions also enter that
practice's «Giurisprudenza» through `openDecision(reference, { practiceId, open: false })`, closed
and unread: `open: false` adds the entry and nothing else — no window, no revealed row (so no
`DecisionEntryView` is mounted and no request is sent) — until a row or a window opens one (T17). One group picked brings no decision. A dossier
with no article still opens nothing, as today.

«Apri l'indice e sfoglia» drops an article-less act on the active practice and points the
structure window at it (today's `addNormaIndexToTab`).

**5.2 The annex auto-switch.** `useAutoSwitch` today closes every tab holding the act it switches.
With the flag on it closes nothing: the annex's articles are separate rows of the same act
(`allegato` is part of `buildItemKey`, hence of `practiceArticleKey`); the stray row from the first
search is removed from the active practice only when that search created it. To confirm against
`SearchPanel`'s auto-switch tests in plan Task 10.

**5.3 Past texts** (D15, T2). A text asked for by date or as the original enters its act as a row of
its own, chip «Testo al …», read-only per gotcha 32 (`describeVersion` in `ArticleTabContent`, as
today); Studio is disabled on it. Its window's title names the version. It never shares a key with
the text in force: `versionKey` is in `practiceArticleKey`, so the find window, compare and «Salva
come dossier» keep the two apart.

**5.4 Breakpoint changes.** The open rows and the windows live in the store, so resizing across
768 px keeps what is open. Narrowed below 768 px, the screen shows the table: the desktop's windows
are not shown and fold no row (T5, T19); widened again, they are back beside the table. The phone's
full-screen reader is its own state (§8) and is closed when the screen widens.

### 6. How the existing pieces carry over

**6.1 Decisions** (D7). `openDecisionTab(reference, { besideTabId })` keeps its name for its many
callers while the flag exists and, with the flag on, adds an entry to the active practice and opens
it to be read: beside, on the desktop (the window, §4.2); in the full-screen reader, on a phone
(§8). One entry per decision per practice:
`sameDecision`, and an unresolved entry learns a section a later citation adds, as today.
`DecisionTabView` becomes `DecisionEntryView({ practiceId, decisionId, reference, hostId })` (the old
tab keeps a thin wrapper over the same fetching hook until P6): the
same fetch through `decisionFetchCache`, the same handling of candidates, notices and «Cerca nella
barra di ricerca», and on a found decision `setDecisionEntryIdentity`, which records identity, label,
date of deposit and type, sets `identified`, and — when another entry of the practice already holds
that decision — drops this one, points the window at the survivor and asks it to take focus (today's
`setDecisionTabIdentity` rule). The same view draws the row opened in place, the window and the
phone's reader. With one layout mounted (T4) the «only the copy on screen takes focus» guard has one
copy to serve; it stays for the row and the window of one decision (T5 folds the row, so at most
one is open). The Cronologia records a found decision once per opening (PR 5 of the norms-decisions
plan); the record moves with the view.

**6.2 Ways in to a decision.** The palette («Cass. civ. 10787/2024»), `DecisionLink` (massime, the
Massimario's chips, the result lists), the sidebar's «Sentenze», the Cronologia and the address all
go through `openDecisionTab`, so they need no change of their own. **The `/sentenze/<corte>/<numero>/
<anno>` contract is untouched**: `DecisionAddress` still queues `pendingDecision`, `SearchPanel`
drains it once (gotcha 14), and the decision enters the active practice and opens to be read.
`besideTabId` keeps its role — the reading place the link sits in — and now names a practice (a row
of the table) or a window id (§4.2's asker); P6 renames it `besideId` across its users (the
decision links and lists, `DecisionReadingSurface`, `CaseLawSection`, `MassimeSection`,
`BrocardiDisplay`, the MERL-T Massimario panel's slot props).

**6.3 The reading back-stack.** An entry becomes `{ practiceId, subject: { kind: 'article'; actId;
articleKey } | { kind: 'decision'; decisionId }, place: 'table' | 'beside', label }`. The reading
surfaces keep pushing today's shape (`ArticleTabContent`'s `readingOrigin`, `useCitationLinks`);
`pushReadingBack` converts an entry whose `tabId` names a practice into `place: 'table'` (the row:
`blockId` is the act, `articleId` is found through `findPracticeArticle`) and one whose `tabId` names
a window into `place: 'beside'`. `findLiveBackIndex` keeps an entry while its practice holds its
subject. Going back makes that practice active and either reveals the row (`table`) or opens the
subject beside (`beside`; on a phone, in the reader). `ReadingBackControl` stays one, global,
without a shortcut. While the flag exists the stack accepts both shapes; P6 drops the tab shape.
P3 rows push entries that name a practice, so P3 brings the `table` half of the way back with them;
P4 adds the `beside` half (§12).

**6.4 The structure window** is unchanged in kind: `TreeViewPanel variant="window"` on the desktop,
`"drawer"` on the phone, one owner (`structureWindow.blockId`, now an act id), picks load into the
act through `useAnnexNavigation`, which takes an `addArticles(norma, articles)` callback in place of
`tabId` (P6 removes `tabId`); a pick of an article the act already holds reveals its row
(`findPracticeArticle`, T2).

**6.5 Study Mode** opens from the act's «Studio» (D5) on the act's articles, unchanged inside
(`LazyStudyMode`). Mounted only with an article in hand, as today.

**6.6 Find in the text: what the window searches.** PR 4d's floating window (norms-decisions spec
§13.1) stays as it is built — one window, Cmd/Ctrl+F or the magnifier, matching and drawing as
there — and from P3 its scope reads the practices. Its switch says «Questa pratica» / «Tutte le
pratiche» (renamed from «Questa scheda» / «Tutte le schede»).
- **«Questa pratica»** is the active practice: every article of every act, its row open or closed;
  its «Giurisprudenza»; and the subjects of its windows. On a phone, the practice on screen,
  including the subject in the full-screen reader. The magnifier opens the window on «Questa
  pratica» with the first match taken in its own text, as PR 4d's magnifier does in its tab.
- **«Tutte le pratiche»** covers every practice in the bar's order; inside a practice, the acts in
  table order, an act's articles in column order, then the decisions in `decisionOrder`. A subject
  is one text wherever it is shown, under PR 4d's own keys, shared by its row and its window: an
  article's `buildItemKey|versionKey`, which is its `practiceArticleKey` (unique within a practice,
  since acts merge by `actKeyOf`), and a decision's `decisionKey(identity)`.
- **Which text is searched.** A subject drawn on screen — an open row, a window, the phone's
  reader — is searched in its text root, and its matches are drawn. A subject read beside on the
  desktop is searched in its window's root (its row is folded, T5). A closed row is searched in its
  stored text (`article_text`, the projection), counted and not drawn. A decision not on screen is
  searched in the session cache of decisions, as PR 4d does; a decision never read (the dossier's
  «Apri tutto», T17) counts nothing.
- **Where a root registers.** PR 4d registers a root from the surface itself, under the tab the
  surface reads in (`ArticleTabContent`: `readingOrigin.tabId ?? tabId`; `DecisionReadingSurface`:
  `hostTabId`). With practices, every root registers under its **practice's id**: a row's
  `readingOrigin.tabId` already is the practice's id; a light window carries its `practiceId` and
  passes it to the surface as a separate find host (`findHostId`, used only for the registration),
  while its `readingOrigin` and its `hostId` stay the window's own, for its way back (§6.3) and its
  focus. The phone's reader draws the window's body and registers the same way. So «Questa pratica» finds the open rows and the windows on screen and draws their matches;
  only closed rows are counted from their stored text. `findScope.ts`'s `frontTabId` becomes the
  active practice's id (the phone's practice on screen is the active one). The new prop changes
  nothing inside a text root (§11).

**6.7 Find in the text: reaching a match, keeping it current.** Going to a match that is not drawn
makes its practice active (`setActivePractice`) and opens its row (`pendingReveal`), in place of PR
4d's `bringTabToFront` and `focusArticleInTab`; once the row's root registers, the match is taken by
its ordinal as PR 4d does. A match in a subject read beside is already drawn. On a phone, reaching
a match in a row while the full-screen reader is open closes the reader first (`phoneReader`
cleared), so the revealed row is on screen; a match in the reader's own subject is already drawn.
The window recomputes,
besides PR 4d's own triggers, when the active practice changes, a row opens or closes, a window
opens or closes, and articles or decisions enter or leave a practice. Its default place: §4.4.

**6.8 Compare** (`CompareView`) lists the articles of every practice, labelled with the practice's
name and the version suffix, instead of every tab's.

**6.9 The palette** keeps every action: a norm search (§5.1), «Apri l'indice e sfoglia» (§5.1), a
decision (§6.2), a topic (a `decision-search` window on the desktop, the full-screen reader on a
phone, T8), aliases and quick norms untouched.

**6.10 The dossier's «Apri tutto»** (gotcha 15): §5.1. `searchesForGroups` keeps its signature; the
callback returns the one practice's id for every group. P6 renames `SearchParams.targetTabId` to
`targetPracticeId`.

### 7. «Salva come dossier» (D6)

From the practice header, the chip's «⋯» and «⋯ › Aggiungi a un dossier…» (an existing dossier).
- **Order of the items**: the acts in table order, each act's articles in table order, then the
  decisions in `decisionOrder`. A pure function `practiceDossierItems(practice)` returns the norma
  items (`normaForDossier(act.norma, article)`) and the decision items (`sentenzaFromDecision(
  identity, { sezione, tipo, data_deposito })`), and the decisions it cannot save: an entry never
  identified (a citation that did not resolve, a choice between candidates not made, or a decision
  carried over from a tab and not read since, §9).
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

One layout mounted (T4, `useIsDesktop`). From P3 the phone draws the practices too (T18).
- **The main screen is the table**: the header switches practices (today's chevrons, name and dots,
  now over practices; from P5 a tap on the name opens the list with «+ Nuova pratica»); the body is
  the same column component as the desktop (`PracticeColumn`): acts with their index line and rows
  opening in place, «Giurisprudenza» at the bottom. No row is folded on the phone (T5).
- **«Apri accanto» opens full screen** (`ReadingFullScreen`, P5): a header «‹ Pratica» (44 px) and
  the title; the body is the window's body (§4.1). A decision opened from a link opens this way too
  (as decision tabs do on a phone today). What the reader shows is `phoneReader` (T19): session
  state, one subject or none, set by «Apri accanto», by a decision opened from a link, by a topic
  search and by the back control; it never reads or writes the desktop's `beside`. «‹ Pratica» clears it and returns
  to the table where it was: the phone view stores the column's scroll position when the reader
  opens and restores it when the reader closes (the open rows are already in the store). The column
  is not kept mounted under the reader: a hidden twin would mount the same article twice (T4,
  gotcha 26).
- **A topic search on the phone** opens in the full-screen reader too (P5): the palette's topic and
  «Tema: …» set `phoneReader` to a `decision-search` ref, never the desktop's `beside`; a decision
  opened from its list replaces it in the reader. Before P5, the phone's table draws the practice's
  topic searches in the same band at its top as the desktop's table in P3 (T8).
- **A reload lands on the table** (`phoneReader` is not persisted), whatever windows the desktop
  had beside; a topic search read only in the phone's reader is not kept, as a closed tab today.
- **Before P5**, a phone with the flag on reads a decision opened from a link in place: the entry
  enters «Giurisprudenza» and its row is revealed, as on the desktop in P3.
- **Extracted articles are gone** (D12); the phone already never showed them.
- The structure index stays the drawer; Study Mode as today; the back control as today, telling
  the phone view which practice to show and which row to reveal or subject to read.

### 9. Migration of the saved workspace (D13)

`practicesFromTabs(tabs: unknown): { practices: Practice[]; activePracticeId: string | null;
dropped: string[]; droppedSearches: string[] }`, pure, never throwing:
1. Each tab without `view` becomes a practice with its `id`, `label` and `labelIsCustom`, in the
   tabs' array order (the dock's order). A tab with no content becomes an empty practice: its name
   is the user's.
2. Its norm blocks become acts by `actKeyOf`; two blocks of one act merge (the first block's id is
   kept). Its loose articles join their act (`actKeyOf(sourceNorma)`), created if absent. A
   collection's articles join theirs. Articles merge only when their `practiceArticleKey`s are
   identical (T2) and are sorted.
3. Decision tabs go under «Giurisprudenza» of the practice whose norm tab had the highest z-index,
   or of a new practice «Sentenze» when there was no norm tab (T10). Their reference is kept as
   saved, with `identified: false`: the saved reference does not say whether it was found, so the
   entry is identified the first time it is read (`setDecisionEntryIdentity`); until then «Salva come
   dossier» counts it as not identified (§7). Two tabs of one decision cannot exist; if they do, one
   entry is kept.
4. The decision-search tab with the highest z-index becomes the only window of that practice; any
   other is not reopened: its label goes into `droppedSearches`. The other decision tabs become
   entries without windows.
5. The active practice is the one whose tab had the highest z-index. Positions, sizes, z-indexes
   and flags are dropped.

What fails to parse goes into `dropped` and is logged once with context (gotcha 18). The searches
not reopened are told to the user, since a lawyer does not read the console: the store keeps
`practiceNotice` (session-only) and the table shows it once (taken atomically, gotcha 14), as an
info toast that stays until closed: «Una ricerca per tema non è stata riaperta: «Tema: perdita di
chance». Puoi rifarla dalla barra di ricerca.», or, for more than one, «2 ricerche per tema non sono
state riaperte: «…», «…». Puoi rifarle dalla barra di ricerca.»

**The seeding marker.** `practicesSeeded` is persisted beside `practices`. `practices` alone cannot
say whether seeding happened: a session with the flag off persists `practices: []`, and so does a
user who closed every practice.
- **While the flag exists**, the store's `merge` seeds `practices` from `workspaceTabs` when the
  flag is on and `practicesSeeded` is not `true`, and sets it to `true` in the same step, whatever
  the result (an empty workspace seeds nothing and is still seeded). The tabs stay as they are. A
  session with the flag off never sets the marker, so turning the flag on later seeds from the tabs
  as they are then. «Chiudi tutte» leaves the marker set: a reload shows no practice, never the old
  tabs again. `clearUserData` sets it to `isPracticeTableEnabled()`, never clears it: with the flag
  on, the tabs it empties hold nothing to seed, and a cleared marker would make the next reload
  seed again and replace the table the next user built since logging in; with the flag off, it
  stays unset, so the flag turned on later still seeds from that user's tabs.
- **P6** sets the persist `version` to 1 with a `migrate` from version 0 that keeps the sanitized
  `practices` when `practicesSeeded` is `true` (even an empty list), else runs the same function
  over `workspaceTabs`; it drops `workspaceTabs`, `highestZIndex` and the marker.

Both paths are synchronous and pure: StrictMode cannot run them twice against one value (gotcha 14).

**Nothing is lost.** Every article keeps its `norma_data`, so `buildItemKey` and
`uniqueArticleIdFromNorma` — the keys of highlights, notes and discussions — are the same before and
after, and no two articles with different `buildItemKey`s become one row (T2); every decision keeps
its reference, so `decisionKey` is the same. A past text keeps its version (gotcha 32: it stays
read-only, and `versionKey` keeps it apart). The tests run the function on saved states taken from
the code's own shapes: two tabs of one act, a codice civile with and without its R.D., a code's
article from a search (`allegato: '2'`) and from the index, a loose article, a collection (forged:
no button makes one), a past-text tab, a decision tab found and one not found, two topic tabs, an
empty tab, malformed entries (§10).

### 10. Security and data

- **Saved state is untrusted input.** `localStorage` can hold an old shape, a hand-edited value or
  garbage. `sanitizePractices` keeps a practice only with a string `id` and `label` and arrays where
  arrays belong; an act only with a `norma.tipo_atto` string and articles with a `norma_data`; a
  decision only with a reference that passes today's `isValidView` checks (court, positive integer
  number and year); a `BesideRef` only when it points at something the practice holds;
  `practicesSeeded` only as a boolean. What fails is dropped and logged, never thrown: a throw in
  `merge` would reset the whole store.
- **User isolation.** `clearUserData` empties `practices`, `activePracticeId`, the open rows, the
  pending reveal, `phoneReader` and `practiceNotice` and sets `practicesSeeded` to
  `isPracticeTableEnabled()` at logout (§9), as it
  empties the tabs today: a shared browser must not show the last user's table. Annotations and
  dossiers are server-side and already cleared.
- **Labels are text.** A practice name and every label are rendered by React as text, never as
  HTML; a name is trimmed and capped at 120 characters.
- **Server-backed data stays server-backed** (gotcha 17). The practice is workspace UI state, as
  the tabs are; «Salva come dossier» creates the dossier on the server first and adds items through
  the existing optimistic, reverting actions.
- **No new route, no new request kind.** The table fetches nothing the tabs did not; a decision
  under «Giurisprudenza» added by «Apri tutto» is fetched only when read.
- **Storage size** (T3, T20). The texts stay in `localStorage`, as today, and while the flag is on
  they are stored twice (tabs and practices). zustand calls `storage.setItem` inside every `set`, so
  P2 gives `persist` a wrapped storage: `createJSONStorage` over a `localStorage` adapter whose
  `setItem` catches any error, logs it once per session with context (the key, the size of the
  value, the error's name; gotcha 18) and raises one sync error through `pushSyncError` («Il tavolo
  di lavoro non viene più salvato nel browser: lo spazio è esaurito. Chiudi qualche pratica.»),
  deferred to a microtask so it does not run inside the `set` that failed. Nothing is thrown out of
  `set`; the app keeps working in memory. The flag's life is short (§12) and P6 stores the texts
  once.

### 11. Root rule 23

No reading surface is changed in what it renders. The row and the window mount `ArticleTabContent`
and the decision's view; `variant="beside"` only chooses which siblings of the text are drawn
(toolbar buttons, Brocardi folded, the Studia row and MERL-T entries absent): nothing inside
`ArticleBody`'s text root, nothing in `renderArticleHtml` or `renderDecisionHtml`. Every new label —
«Aperto accanto», chips, counts, the window's title — sits outside the text root. Tests: the
existing `articleRender.test.ts` and `decisionRender.test.ts` stay green untouched; a new test
renders an article in the window and checks that its text root's text nodes spell `article_text`
minus `\n` (the fixtures of `utils/__fixtures__/articleTexts.ts`), with the find window open on that
text, as PR 4d's contract tests do.

### 12. Sequencing

**Before the redesign code**: this documentation PR; **PR 4d of the norms-decisions round**
(`feat/find-window`, the floating find window, Tasks 33–35 of that plan), being built now; **PR 5
of the norms-decisions round** (`feat/decision-history`, decisions in the Cronologia, Tasks 23–24
of that plan).
- PR 4d merges before P1: it touches `ArticleTabContent`, `ReadingToolbar` and `Layout`, and
  deletes `useGlobalSearch.ts` and `GlobalSearch.tsx`, which P1 and P3 would otherwise edit. Every
  redesign branch starts from a `develop` that holds it.
- PR 5 goes first too: it is small and independent of the workspace (a Prisma migration, the
  history controller, `HistoryView` and one record in `DecisionTabView`), it can run while VisuaLex
  Studia PR A is in flight, and P3 then carries its once-per-opening record into `DecisionEntryView`
  instead of the other way round (doing it after would mean writing it twice).

**The redesign code starts after VisuaLex Studia PR A merges** (it touches `ArticleTabContent` and
`SelectionPopup`); whoever merges second merges `origin/develop` into its branch first. P1 and P2
touch neither file; if PR A is delayed they may start earlier, agreed with the Studia session, at no conflict risk.

**The redesign PRs**, each shippable on its own, P3–P5 behind `VITE_FEATURE_PRACTICE_TABLE` (T9).
A browser pass runs the branch's own Vite on its own port with the flag in its environment
(`VITE_FEATURE_PRACTICE_TABLE=true npm --prefix apps/web run dev -- --port 5174`, against the shared
backend, which Vite's proxy reaches), never the shared stack on :5173, which other sessions use.
`localStorage` belongs to the origin, so the pass that builds a workspace with the flag off and
reloads it with the flag on restarts that same port's Vite without, then with, the flag.

| PR | Branch | What | Flag |
|---|---|---|---|
| P1 | `refactor/workspace-groundwork` | Collections removed (a saved one becomes loose articles at load); `workspaceTabActions.ts` deleted; `utils/practice.ts` with the model, the rules and the migration, tested. No visible change. | none |
| P2 | `feat/practice-store` | The flag; the practice slice, its actions, persistence, the seeding marker and the wrapped storage; decisions and windows in the store; the two-shape back-stack. Inert: no entry point calls it yet. | gates the seeding |
| P3 | `feat/practice-table` | The table and the bar of practices on the desktop, and the plain table on the phone (T18); searches, the index, the dossier's «Apri tutto», decisions (opened in place until P4), topic searches (in a band of the table until P4), the find window's scope, compare and the `table` half of the way back routed to the practice; «Salva come dossier». | on = new desktop and phone |
| P4 | `feat/reading-window` | The light window, «Apri accanto», the row of two and its layout, the find window's place; decisions and topic searches beside (on a phone topic searches stay in the table's band); the find root of a window under its practice (§6.6); citations from a window; the `beside` half of the way back. | on = windows |
| P5 | `feat/practice-phone` | The phone's full-screen reader with «‹ Pratica» and its own state, for articles, decisions and topic searches; the practice list. | on = phone reader |
| P6 | `refactor/retire-floating-tabs` | The flag removed; persist version 1 migrates every browser; the tab model, its components and actions deleted; `besideTabId` renamed; tours and `apps/web/CLAUDE.md`. | removed |

The order is P1 → P6, one after another: each builds on the one before (P5's full-screen reader
reuses P4's window body). After P6 merges, the owner's trial on the development stack and then the
deploy on the deployment host he asked for (the whole redesign first, then the deploy).

### 13. Questions for the owner — answered (8 October)

The first draft of this spec named one choice that follows from his answers but undoes an earlier
decision: **a past text sits in its act as a row marked «Testo al …»** (T2, §5.3), as the dossier
already shows it (dossier decision 8), instead of opening in a tab of its own («Testo alla data»,
its T5). The alternative offered was a practice of its own per date, at the cost of a practice the
user did not ask for at every «Testo alla data».

The owner answered on 8 October 2026: «procedi». The row of its act is decided (D15); the
alternative is dropped.

## Verification

- **Pure modules, no DOM**: `practice.ts` (`addArticles` with duplicates, past texts, annexes,
  Brocardi and URN backfill, the codice civile with and without its R.D., a code's article with
  `allegato: '2'` and without; `findPracticeArticle` with `1-bis` / `1 bis` and a code's annex;
  `decisionOrder`; `sameDecision`; `besideAfterOpen` with and without the asker; `practicesFromTabs`
  on every case of §9, the notice's labels included; `sanitizePractices` on garbage),
  `besideLayout`, `practiceDossierItems`.
- **Store**: actions atomic under StrictMode (open beside twice, drain a pending decision once,
  consume a reveal once, take the notice once); persistence (`partialize`; seeding with the flag on
  and no marker; no seeding with the marker; a flag-off session then the flag on seeds; «Chiudi
  tutte» then a reload stays empty; P6's `migrate` with and without the marker); the wrapped storage
  (a `setItem` that throws `QuotaExceededError`: the action completes, nothing is thrown, one log
  and one sync error); «Apri tutto» with two past groups creates one practice, its decisions closed
  and not fetched (`open: false`); an unknown `targetTabId`; `clearUserData`, and logout, login and
  a reload with the flag on keeping the table built after the login.
- **Components**: the act block (index line, rows, Studio locked on a past text, «Sposta in…»,
  «Rimuovi l'atto»), the row (rubrica, chips, «Apri accanto», folded when beside on the desktop
  only), «Giurisprudenza» order, the column's bottom padding, the window (compact toolbar, Brocardi
  closed, no Studia row), the bar (switch, rename, new, close with confirmation), the phone view and
  the full-screen reader (a reload on a phone lands on the table; two windows on the desktop, then
  a phone width, show the table with no row folded; «‹ Pratica» returns to the same scroll; a topic
  search in the phone's band, then in the reader; reaching a row's match closes the reader), the
  find window's scope and place (a match in an open row and in a window is drawn, not only counted),
  «Salva come dossier».
- **Rule 23**: §11.
- **Suites**: `npm --prefix apps/web run test -- --run`, `run build`, `run lint` at every PR; no
  server or Python change.
- **Browser pass at every PR** (P3 on), logged in on the branch's own Vite (§12) with the flag on,
  desktop and a phone width (390 px). A pass that exercises seeding or the migration starts from
  cleared site data for that origin (devtools › Application › Storage › «Clear site data» on
  `http://localhost:5174`, then log in again with the test account), because an earlier pass on the
  same port leaves `practicesSeeded` set. Then, before turning the flag on, build a workspace on the old
  surface — two tabs, an act with three articles, an extracted article, a past text, a decision
  opened beside an article, two topic searches, a highlight and a note on an article and on a
  decision; add a forged collection to `visualex-storage` in devtools; restart the same port with
  the flag on and check every item is in its practice, the highlight and the note show, the notice
  names the topic search not reopened, and the old tabs come back with the flag off. P6's pass
  repeats this with no flag, from a browser saved before P6.

## Coordination

- **Norms-decisions PR 4d**: §12; P3 renames its scope labels and points its scope at the
  practices (§6.6–§6.7); P4 gives it its default place (§4.4). If PR 4d's code differs from its spec,
  the plan's Tasks 2, 10, 13 and 16 are re-read against what merged.
- **VisuaLex Studia PR A**: §12. The window and the phone's reader omit its row (§4.1); the row stays
  under every article in the table. Studia's spec needs one line in «Reader», to be applied by the
  Studia session, as agreed with it, not here: «The row is drawn under an article in the
  practice's table; the light window beside the table and the phone's full-screen reader do not
  draw it (norm-tab-container spec §4.1).»
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
- Find in the text in Study Mode and the dossier reader (norms-decisions spec §13, Later).
