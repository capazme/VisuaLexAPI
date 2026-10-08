# The norm tab becomes the practice's table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating norm tabs with one table per practice — acts, their articles in one continuous column with an index on top, and the practice's decisions under «Giurisprudenza» — with a light window to read one article or one decision beside it (two at most), a bar of practices in place of the dock, the same column on the phone, «Salva come dossier», and every saved workspace carried over without loss.

**Architecture:** A pure module (`utils/practice.ts`) holds the practice model, its rules and the migration from today's tabs. The store gains a `practices` slice beside `workspaceTabs`; while `VITE_FEATURE_PRACTICE_TABLE` is on, the search page draws the new table, the bar and the windows from it, and the few store actions every entry point already calls (`openDecisionTab`, `openDecisionSearchTab`, `addNormaIndexToTab`, `focusArticleInTab`) route into the practice. The reading surfaces (`ArticleTabContent`, the decision's view) are mounted unchanged in a row of the table or in a window; nothing inside a text root changes (root rule 23). The last PR removes the flag, migrates every browser once (persist version 1) and deletes the tab model.

**Tech Stack:** React 19 / TypeScript / Zustand + Immer (`persist`) / `@dnd-kit` / Vitest / Testing Library (apps/web). No server, Python or Prisma change.

**Spec:** `docs/superpowers/specs/2026-10-08-norm-tab-container-design.md`

## Global Constraints

- UI copy in Italian; code, comments, commits and docs in English.
- Root rule 23: no change to `ArticleBody`'s text root, `renderArticleHtml`, `renderDecisionHtml`, `useArticleMarkers` or the readers' output. Every new label sits outside a text root. `articleRender.test.ts` and `decisionRender.test.ts` stay green untouched.
- Annotation keys never change: `buildItemKey`, `uniqueArticleIdFromNorma` (`utils/normaKeys.ts`) and `decisionKey` are read, never rewritten. An article carries its `norma_data` unchanged through every move and through the migration.
- Gotcha 32: every surface that draws article text goes through `describeVersion` (the row and the window mount `ArticleTabContent`, which does). Anything that groups or compares articles adds `versionKey` (`practiceArticleKey` does).
- Gotcha 14: every store action that changes two things does it in one `set`; a one-shot signal (`pendingReveal`, `pendingDecision`, the focus request) is consumed atomically.
- Gotcha 15: the dossier's «Apri tutto» creates its practice synchronously before `navigate('/')` and passes its id as `targetTabId` on every queued search.
- Gotcha 17: the practice is UI state saved in the browser (spec D6); «Salva come dossier» creates the dossier on the server first (`createDossier` returns the server id or null) and adds items through `addToDossier`.
- Gotcha 26: one layout per breakpoint through `useIsDesktop`; never a portal inside a CSS-hidden wrapper.
- Gotcha 9: article ids compared through `normalizeArticleId` / `findArticleByNormalizedId`, then canonicalised with `getUniqueArticleId`.
- Gotcha 18: saved state that does not parse is dropped and logged with context, never thrown and never swallowed.
- Shared code first (`apps/web/CLAUDE.md`, «Shared utilities»): `actKeyOf`, `compareArticles`, `articleLabel`, `shownAnnex` (`dossierLayout.ts`); `normaForDossier`, `sentenzaFromDecision`, `dossierContainsArticle`, `searchesForGroups` (`dossierUtils.ts`); `actHeading`, `citeNorm`, `shortAct` (`utils/sources`); `formatDecisionShort`, `decisionKey`, `identityOf` (`decisionLinks.ts`); `versionKey`, `historicalItemLabel`, `versionTabSuffix` (`versionDisplay.ts`); `getRubricText`, `parseArticleStructure`; `ui/MenuButton`, `ui/ConfirmDialog` (`variant="danger"`); `useIsDesktop`; `Z_INDEX`.
- The flag: `VITE_FEATURE_PRACTICE_TABLE`, absent or anything but `true` = off. A browser pass starts the web with `VITE_FEATURE_PRACTICE_TABLE=true` in its environment; no env file is read or written by the agent.
- The redesign code starts after VisuaLex Studia PR A (`feat/studia-cards`) merges; whoever merges second merges `origin/develop` into its branch first (spec §12). PR 5 of the norms-decisions plan (`feat/decision-history`) goes before P1.
- Branches from `origin/develop` in a worktree, one per PR; never switch branches in the main checkout. Commits with explicit paths and the session's attribution line. Merge commit titled `merge: <branch> — <what changes>`, at green CI.
- Nothing private in the repository (no vault text, no personal paths or names, no infrastructure addresses).
- Before calling a PR done: `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build` (the real type-check), `npm --prefix apps/web run lint`, all green; errors met in touched files fixed, pre-existing ones too.

## Review Focus

1. **A saved workspace that becomes practices** — two tabs of one act, an extracted article, a forged collection, a past-text tab, a decision tab found and one not found, two topic tabs, an empty tab, garbage: every article and decision arrives in the right practice, nothing throws, the highlights and notes made before show after. Tests in Tasks 4 and 5; browser pass at P3 and P6.
2. **The same decision opened three ways** (palette, a massima, a reload) — one entry in the practice, one window, focused; a candidate chosen that turns out to be an entry already there merges into it. Test in Task 7.
3. **The row of two** — a decision opened from an article read in a window never closes that article; a third window replaces the oldest other; the replaced subject stays in the table. Test in Task 7.
4. **A past text and the text in force of one article** — two rows, two keys, Studio locked on the past one, both saved as two dossier items. Tests in Tasks 3, 8 and 11.
5. **Root rule 23 in the window** — the text root's text nodes spell `article_text` minus `\n` with the compact toolbar and a find box open. Test in Task 13.
6. **Logout on a shared browser** — `clearUserData` leaves no practice behind. Test in Task 5.

---

## P1 — `refactor/workspace-groundwork` (apps/web)

Worktree: `git worktree add .claude/worktrees/workspace-groundwork -b refactor/workspace-groundwork origin/develop`, then `cd` into it in its own command. No visible change.

### Task 1: The article collections go

Nothing creates a collection (spec, «What was measured»); a browser may still hold one, which the old surface must keep drawing until P6, so the store turns a saved collection into loose articles of the same tab when it loads.

**Files:**
- Delete: `apps/web/src/components/features/workspace/ArticleCollectionComponent.tsx`
- Modify: `apps/web/src/store/useAppStore.ts` (drop `ArticleCollection`, `CollectionArticle` and the six collection actions from `AppState` and the implementation; `TabContent = NormaBlock | LooseArticle`; in `merge`, `foldCollections` after `sanitizeViews`; the type export line)
- Modify: `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx` (the `collection` branches of `handleAddToDossier` and of the content map)
- Modify: `apps/web/src/components/features/workspace/WorkspaceManager.tsx` (the `collection-drop-` branch and `moveLooseArticleToCollection`)
- Modify: `apps/web/src/components/features/workspace/SortableWorkspaceTab.tsx` (the collection count and icon)
- Modify: `apps/web/src/components/features/compare/CompareView.tsx` and `CompareView.test.tsx` (the collection branch and its fixture)
- Modify: `apps/web/src/store/__tests__/decisionTabs.test.ts` (the `createCollection` row of the refusal table)
- Test: `apps/web/src/store/__tests__/useAppStore.workspaceTabs.test.ts`

- [ ] **Step 1: Failing test** — a saved collection is kept as loose articles:

```ts
it('turns a saved collection into loose articles of its tab', () => {
  const merge = appStore.persist.getOptions().merge!;
  const saved = { workspaceTabs: [{ id: 't', label: 'x', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
    zIndex: 1, isMinimized: false, isHidden: false, labelIsCustom: false,
    content: [{ type: 'collection', id: 'c', label: 'Raccolta', isCollapsed: false,
      articles: [{ article: ARTICLE_2043, sourceNorma: CC }] }] }] };
  // ARTICLE_2043 and CC: an ArticleData and its Norma, as the file's existing fixtures
  const tabs = (merge(saved, appStore.getState()) as { workspaceTabs: WorkspaceTab[] }).workspaceTabs;
  expect(tabs[0].content).toEqual([{ type: 'loose-article', id: expect.any(String), article: ARTICLE_2043, sourceNorma: CC }]);
});
```

- [ ] **Step 2: Run to see it fail** — `npm --prefix apps/web run test -- --run src/store/__tests__/useAppStore.workspaceTabs.test.ts`. Expected: FAIL (the collection survives).
- [ ] **Step 3: Implement.** Remove the code listed above; `foldCollections(tabs)` maps a `collection` item to one loose article per entry and drops any other unknown `type` with a `console.warn` naming the tab (gotcha 18).
- [ ] **Step 4: Run** the store and compare tests; `grep -rn "collection" apps/web/src --include='*.ts*'` shows no workspace reference left; web build and lint.
- [ ] **Step 5: Commit** — `refactor(web): the article collections go; a saved one is kept as loose articles`.

### Task 2: `workspaceTabActions.ts` goes

**Files:**
- Delete: `apps/web/src/store/workspaceTabActions.ts`
- Modify: `apps/web/src/hooks/useGlobalSearch.ts` (import `NormaBlock`, `LooseArticle` from `../store/useAppStore`)
- Modify: `apps/web/CLAUDE.md` (gotcha 25 removed; its number left free, as 23, 24 and 31 are)

- [ ] **Step 1:** `grep -rn "workspaceTabActions" apps/web/src` lists only `useGlobalSearch.ts`.
- [ ] **Step 2:** Switch the import, delete the file, remove gotcha 25.
- [ ] **Step 3:** Web tests, build, lint.
- [ ] **Step 4: Commit** — `refactor(web): the dead copy of the workspace tab actions goes`.

### Task 3: The practice model and its rules

**Files:**
- Create: `apps/web/src/utils/practice.ts`
- Test: `apps/web/src/utils/__tests__/practice.test.ts`

**Interfaces** (spec §2):
- Types `Practice`, `PracticeAct`, `PracticeDecision`, `BesideRef` exactly as the spec's §2.
- `practiceArticleKey(article: ArticleData): string` — `uniqueArticleIdFromNorma(norma_data)` + `'|'` + `versionKey(norma_data)`; when `norma_data` carries no version but `versionInfo.isHistorical` is true, confirm in Step 1 which field a «Testo alla data» search fills (`processResult` sets `versionInfo`; `normaForDossier` reads `norma_data.versione`/`data_versione`) and key on the one that is always set.
- `addArticles(acts: PracticeAct[], norma: Norma, articles: ArticleData[], newId: () => string): { acts: PracticeAct[]; actId: string; added: string[] }` — finds the act by `actKeyOf(norma)` or appends one; inserts articles not present by `practiceArticleKey`; sorts by `compareArticles(a.norma_data, b.norma_data)`; backfills `brocardi_info` (and drops `brocardi_error`) and the act's `norma.urn`.
- `sameDecision(entry: DecisionReference, wanted: DecisionReference): boolean` — moved from `useAppStore.ts`, same rule.
- `decisionOrder(decisions: PracticeDecision[]): PracticeDecision[]` — newest first: `depositDate` when present, else `anno`; ties by `numero` descending (spec T7).
- `besideAfterOpen(beside: BesideRef[], ref: BesideRef, askerId?: string): BesideRef[]` — spec §4.2.
- `practiceCounts(p: Practice): { acts: number; articles: number; decisions: number }` and `practiceCountLine(p)` («2 atti · 4 articoli · 2 sentenze», singulars right, empty parts left out).

- [ ] **Step 1: Failing tests**:

```ts
describe('addArticles', () => {
  it('puts the codice civile with and without its R.D. in one act, articles by number', () => {
    let r = addArticles([], { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262' }, [art('2043')], id);
    r = addArticles(r.acts, { tipo_atto: 'codice civile', data: '' }, [art('1218'), art('2043')], id);
    expect(r.acts).toHaveLength(1);
    expect(r.acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['1218', '2043']);
    expect(r.added).toEqual([practiceArticleKey(art('1218'))]);
  });
  it('keeps a past text beside the text in force, after it', () => {
    const r = addArticles([], CC, [art('2043', { data_versione: '2007-12-29' }), art('2043')], id);
    expect(r.acts[0].articles.map(practiceArticleKey)).toEqual(['2043|vigente|', '2043|vigente|2007-12-29']);
  });
  it('orders 2, 2-bis, 3, 10 and puts an annex after the body', () => { /* … */ });
  it('lets a later copy fill Brocardi and the act its URN', () => { /* … */ });
});
describe('besideAfterOpen', () => {
  const A = win('a'), B = win('b'), C = win('c');
  it('appends up to two', () => expect(besideAfterOpen([A], B)).toEqual([A, B]));
  it('replaces the oldest with a third', () => expect(besideAfterOpen([A, B], C)).toEqual([B, C]));
  it('never replaces the window that asked', () => expect(besideAfterOpen([A, B], C, 'a')).toEqual([A, C]));
  it('moves nothing when the subject is already beside', () => expect(besideAfterOpen([A, B], A)).toEqual([A, B]));
});
describe('decisionOrder', () => {
  it('puts the newest deposit first and an unread decision by its year', () => { /* … */ });
});
```

  (Expected keys follow `versionKey`'s real output; adjust the literals once Step 1 has confirmed the field.)
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement**, importing `actKeyOf`, `compareArticles` from `components/features/dossier/dossierLayout.ts` (the store already imports from the dossier folder) and nothing from the store.
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice model: acts, articles by number, decisions, the row of two windows`.

### Task 4: From saved tabs to practices, and saved practices checked

**Files:**
- Modify: `apps/web/src/utils/practice.ts` (`practicesFromTabs`, `sanitizePractices`)
- Create: `apps/web/src/utils/__fixtures__/savedWorkspaces.ts` (saved states in the shapes `useAppStore.ts` writes today; one forged collection; one garbage state)
- Test: `apps/web/src/utils/__tests__/practiceMigration.test.ts`

**Interfaces:**
- `practicesFromTabs(tabs: unknown, newId: () => string): { practices: Practice[]; activePracticeId: string | null; dropped: string[] }` — spec §9, steps 1–5. Takes `unknown`; never throws.
- `sanitizePractices(raw: unknown): { practices: Practice[]; dropped: string[] }` — spec §10.

- [ ] **Step 1: Failing tests** — one per case of spec §9 and §10:
  - two tabs → two practices, same ids, labels, order; the front tab's practice is active;
  - one tab with two blocks of the codice civile (with and without R.D.) → one act keeping the first block's id;
  - a loose article of an act already in the tab → in that act; of another act → a new act;
  - the forged collection → its articles in their acts;
  - a past-text tab → a practice whose act holds the past text, key with its version;
  - a found decision tab and an unresolved one → two entries of the front practice, `identified` true and false, references unchanged;
  - decision tabs and no norm tab → one practice «Sentenze»;
  - two topic tabs → the newest a window of the front practice, the other in `dropped`;
  - an empty tab → an empty practice;
  - garbage (`null`, a string, a tab without `id`, an article without `norma_data`, a decision with `numero: -1`) → dropped and listed, no throw;
  - **nothing lost**: for every article of the fixture, `buildItemKey(norma_data)` and `uniqueArticleIdFromNorma(norma_data)` before equal one article's after; for every decision, `decisionKey`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement**, reusing `addArticles` and `isValidView`'s checks (move `isValidView` from the store into `practice.ts` and import it back).
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): saved tabs become practices, and saved practices are checked before use`.

**P1:** title «refactor: workspace groundwork for the practice table»; body: the collections and the dead action file go (gotcha 25), the pure model and migration land unused, spec link. Browser pass (desktop and 390 px): a workspace with two tabs, a decision tab and a topic tab reloads unchanged; with a collection forged into `visualex-storage` in devtools, its articles reload as loose cards. Merge: `merge: refactor/workspace-groundwork — collections out, the practice model and its migration`.

---

## P2 — `feat/practice-store` (apps/web)

Worktree as P1, branch `feat/practice-store`. Inert without the UI of P3.

### Task 5: The flag, the slice, persistence and logout

**Files:**
- Create: `apps/web/src/utils/practiceTableFlag.ts` (`isPracticeTableEnabled()`: `import.meta.env.VITE_FEATURE_PRACTICE_TABLE === 'true'`; a comment saying it is removed by P6)
- Modify: `apps/web/src/store/useAppStore.ts` (state `practices`, `activePracticeId`, session-only `practiceRows`, `pendingReveal`; `partialize` adds `practices` and `activePracticeId`; `merge` runs `sanitizePractices` on saved practices and, with the flag on and none saved, seeds from `practicesFromTabs(p.workspaceTabs)`; `clearUserData` empties the four)
- Test: `apps/web/src/store/__tests__/practices.persist.test.ts`

- [ ] **Step 1: Failing tests**: with `vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true')`, a saved state with tabs and no practices rehydrates with practices and keeps the tabs; with the flag off, no practices are seeded; saved practices are kept and sanitized (a malformed one dropped, logged); `partialize` holds `practices` and `activePracticeId`, never `practiceRows` or `pendingReveal`; `clearUserData` empties them.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Seeding sits in `merge` because the persist `version` changes only in P6 (spec §9).
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): practices in the store, saved in the browser, seeded from the tabs behind a flag`.

### Task 6: The practice's actions

**Files:**
- Modify: `apps/web/src/store/useAppStore.ts`
- Test: `apps/web/src/store/__tests__/practices.actions.test.ts`

**Interfaces** (every one a single `set`):
- `createPractice(label: string, options?: { custom?: boolean; activate?: boolean }): string`
- `renamePractice(id, label)` (trimmed, capped at 120 characters, sets `labelIsCustom`), `closePractice(id)`, `closeAllPractices()`, `setActivePractice(id)`, `reorderPractices(from, to)`
- `addArticlesToPractice(practiceId: string | null, norma: Norma, articles: ArticleData[], options?: { reveal?: 'first' | string; label?: string }): { practiceId: string; actId: string }` — `null` means the active practice, created (named `options.label ?? shortAct(norma)`) when there is none; `reveal` sets `pendingReveal` and opens the row
- `addActIndexToPractice(practiceId: string | null, norma: Norma): string` — an article-less act, and `structureWindow.blockId` pointed at it, atomically (today's `addNormaIndexToTab`)
- `removePracticeArticle(practiceId, actId, articleKey)`, `removePracticeAct(practiceId, actId)`, `moveActToPractice(actId, from, to)`, `reorderActs(practiceId, from, to)`, `toggleActCollapse(practiceId, actId)`
- `setRowOpen(rowKey: string, open: boolean)`, `takeReveal(practiceId): { rowKey: string } | null` (atomic, gotcha 14)

- [ ] **Step 1: Failing tests**: a search into no practice creates one named after the act and makes it active; a second act enters the same practice; `reveal` opens the asked row and is taken once (two calls under StrictMode-like double invocation: the second returns null); `addActIndexToPractice` reuses an act already there and backfills its URN, and the structure window points at it; moving an act to another practice keeps its id and its articles; closing the active practice activates its neighbour; renaming caps the label.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** over `utils/practice.ts`.
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice's actions: acts, articles, rows, the index, moves`.

### Task 7: Decisions and windows in the practice; the back-stack over practices

**Files:**
- Modify: `apps/web/src/store/useAppStore.ts` (`openDecision`, `setDecisionEntryIdentity`, `removePracticeDecision`, `openBeside`, `closeBeside`; `pushReadingBack`/`popReadingBack` accept the new entry shape. No existing action routes here yet: an entry point that wrote into practices before P3 draws them would hide what it opened)
- Modify: `apps/web/src/utils/readingBackStack.ts` (the entry union of spec §6.3; `findLiveBackIndex` over tabs and practices)
- Test: `apps/web/src/store/__tests__/practices.decisions.test.ts`, `apps/web/src/utils/readingBackStack.test.ts`

**Interfaces:**
- `openDecision(reference: DecisionReference, options?: { practiceId?: string; beside?: boolean; askerId?: string }): { practiceId: string; decisionId: string }` — the entry by `sameDecision` (an unresolved entry learns a later citation's section, today's rule) or a new one; `beside` (default true: every way in today opens a decision to read it, spec D7) opens the window through `besideAfterOpen`
- `setDecisionEntryIdentity(practiceId, decisionId, identity, attrs: { sezione?: string; tipo?: string; data_deposito?: string }, label)` — identity, label, `depositDate`, `tipo`, `identified: true`; another entry of the practice already holding the decision → this one goes, the window (if any) points at the survivor, `decisionFocusRequest` names it
- `openBeside(practiceId, ref: BesideRef, askerId?: string)`, `closeBeside(practiceId, refId)`

- [ ] **Step 1: Failing tests**: the same decision through three `openDecision` calls (plain, again, with a section) is one entry and one window; a citation with an archive does not match an entry of the other archive; a found identity that another entry holds merges into it and asks it for focus; `openDecision` with an `askerId` keeps that window; `beside: false` adds the entry and no window; a topic opens a window and no entry; the back-stack: an entry whose practice was closed or whose subject was removed is skipped; a `beside` entry reopens the window, a `table` entry reveals the row; the old tab entries still work while both shapes exist.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): decisions and the windows beside them belong to the practice; the way back follows them`.

**P2:** title «feat: the practice store (behind VITE_FEATURE_PRACTICE_TABLE)»; body: inert without P3, the seeding only with the flag on, spec §2, §9, §10. Browser pass: with the flag off, nothing changes on desktop and at 390 px; with it on, `visualex-storage` gains `practices` seeded from the tabs (devtools), and the old surface still works. Merge: `merge: feat/practice-store — practices, decisions and windows in the store, behind a flag`.

---

## P3 — `feat/practice-table` (apps/web)

Branch `feat/practice-table`. Everything new is drawn only with the flag on and on the desktop; the phone keeps today's view until P5.

### Task 8: The column: act blocks and their rows

**Files:**
- Create: `apps/web/src/components/features/practice/PracticeColumn.tsx` (the acts in order, then «Giurisprudenza»; takes `practiceId`, `onViewPdf`, `onCrossReference`; consumes `takeReveal` and scrolls the revealed row into view)
- Create: `apps/web/src/components/features/practice/PracticeActBlock.tsx` (spec §3.2: heading with drag handle, `actHeading`, `formatNormaMeta`, Studio / Struttura / PDF as `NormaBlockComponent` has them, «⋯» with «Sposta in un'altra pratica» and «Rimuovi l'atto» behind a danger `ConfirmDialog`; the index line of chips and `ArticleNavigation`; the rows; the structure window `TreeViewPanel variant="window"`; `LazyStudyMode` mounted only with an article)
- Create: `apps/web/src/components/features/practice/PracticeArticleRow.tsx` (spec §3.2: `articleLabel`, the rubrica from `getRubricText(text, parseArticleStructure(text))`, the «Testo al …» chip, «Togli dal tavolo»; header-scoped toggle; open → `ArticleTabContent` with `readingOrigin = { tabId: practiceId, blockId: actId }`; `AnnexSuggestion` inside the open row)
- Modify: `apps/web/src/hooks/useAnnexNavigation.ts` (an optional `addArticles(norma, articles)` used before `tabId`; `tabId` stays for the old surface)
- Test: `PracticeActBlock.test.tsx`, `PracticeArticleRow.test.tsx` (beside each component), `apps/web/src/hooks/__tests__/useAnnexNavigation.addArticles.test.ts`

- [ ] **Step 1: Failing tests**: the index line lists every article once with annex and past-text marks and a click opens and reveals the row; rows show «art. 2043 — Risarcimento per fatto illecito» from the text; a past text shows «Testo al 29/12/2007» and Studio is disabled when it is the last opened row; «Rimuovi l'atto» asks first; «Sposta in un'altra pratica» lists the other practices; a closed row mounts no `ArticleTabContent`; acts reorder by keyboard (dnd-kit's keyboard sensor); a pick from the index lands in the act through `addArticles`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement**, composing `ui/MenuButton`, `ConfirmDialog`, the collapsible and sticky-row conventions, 44 px touch targets.
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice's column: acts, an index on top, articles one under the other`.

### Task 9: «Giurisprudenza», and a decision read in place

**Files:**
- Create: `apps/web/src/components/features/decisions/DecisionEntryView.tsx` (from `DecisionTabView`: props `{ practiceId, decisionId, reference, hostId }`; the same fetch, candidates, notices, palette hand-off and focus request; on `trovata` calls `setDecisionEntryIdentity` with `attributi`; keeps PR 5's once-per-opening Cronologia record)
- Modify: `apps/web/src/components/features/decisions/DecisionTabView.tsx` (a thin wrapper over `DecisionEntryView`'s inner body for the old tab until P6; no duplicated logic: both call one hook, `useDecisionAnswer(reference)`, created here)
- Create: `apps/web/src/components/features/decisions/useDecisionAnswer.ts`
- Create: `apps/web/src/components/features/practice/PracticeDecisionsSection.tsx` (spec §3.3: «Giurisprudenza (n)», rows in `decisionOrder`, ×; a row opens `DecisionEntryView` in place)
- Test: `DecisionEntryView.test.tsx` (moved cases of `DecisionTabView.test.tsx` plus the entry merge), `PracticeDecisionsSection.test.tsx`

- [ ] **Step 1: Failing tests**: the section is absent with no decision; rows sort newest deposit first; a found decision updates its row's label and date; a candidate chosen that is already an entry merges and focuses it; the Cronologia record happens once per opening (PR 5's test, carried); `DecisionTabView`'s existing tests stay green.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): «Giurisprudenza» in the practice, a decision read in place`.

### Task 10: The table, the bar, and everything routed to the practice

**Files:**
- Create: `apps/web/src/components/features/practice/PracticeTable.tsx` (spec §3.1: header with name, count line, «Salva come dossier», «⋯»; empty state; the streaming bar; `PracticeColumn`)
- Create: `apps/web/src/components/features/practice/PracticeBar.tsx` and `PracticeChip.tsx` (spec §5: chips, `aria-current`, rename, drag reorder, per-chip «⋯», «+ Nuova pratica», «Chiudi tutte» behind its danger confirmation, collapse; `Z_INDEX.dock`; `id="tour-workspace-dock"` kept)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (flag on and desktop: `PracticeTable` + `PracticeBar` in place of `WorkspaceManager` + `WorkspaceNavigator`, mounted through `useIsDesktop`; `processResult` and the buffered path call `addArticlesToPractice(targetTabId ?? null, …)` with R1/R2's reveal rules; `handleBrowseStructure` calls `addActIndexToPractice`; `handleCrossReferenceNavigate` reveals the row; the auto-switch's duplicate removal per spec §5.2)
- Modify: `apps/web/src/components/features/dossier/DossierDetailView.tsx`, `DossierListView.tsx` (flag on: `createPractice(dossier.title, { custom: true })` as `searchesForGroups`' callback, so every group targets one practice; the whole dossier's «Apri tutto» also adds its decisions with `beside: false`)
- Modify: `apps/web/src/hooks/useGlobalSearch.ts`, `apps/web/src/components/features/search/GlobalSearch.tsx` (flag on: scan the practices; a result names practice and act; a click activates, reveals, requests the scroll)
- Modify: `apps/web/src/components/features/compare/CompareView.tsx` (flag on: the practices' articles, labelled with the practice)
- Modify: `apps/web/src/store/useAppStore.ts` (flag on: `openDecisionTab(ref, …)` → `openDecision(ref, { beside: false })` and the decision's row revealed — P4 turns it to beside; `openDecisionSearchTab` → a `decision-search` window kept for P4 and, until then, the old tab; `drainPendingDecision` once, gotcha 14; `focusArticleInTab` → reveal in the practice; `addNormaIndexToTab` → `addActIndexToPractice`)
- Test: `PracticeTable.test.tsx`, `PracticeBar.test.tsx`, `SearchPanel.practice.test.tsx` (new), `useGlobalSearch` and `CompareView` flag cases, the dossier's open-all test with the flag

- [ ] **Step 1: Failing tests**: a one-article search lands in the active practice and opens its row; a decision from the palette, a massima or the address enters «Giurisprudenza» once and opens in place; a range opens the first row of a new act and leaves the others closed; a search with no practice creates one named after the act; «Apri tutto» of a dossier with a past group creates one practice holding both texts as rows and its decisions unread; the bar switches the table, renames, creates «Nuova pratica», closes after confirming; «Cerca negli articoli aperti» finds a word in a closed row and opens it; compare lists the practices' articles; with the flag off, `SearchPanel`'s existing tests pass unchanged.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** No change to `ArticleTabContent`.
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice's table and the bar of practices on the desktop, behind the flag`.

### Task 11: «Salva come dossier» and «Aggiungi a un dossier»

**Files:**
- Create: `apps/web/src/components/features/practice/practiceDossierItems.ts` (pure: `practiceDossierItems(practice): { norms: NormaVisitata[]; decisions: DossierSentenzaData[]; unidentified: number }` in table order, spec §7)
- Create: `apps/web/src/components/features/practice/useSavePracticeAsDossier.ts` (new dossier: `createDossier` → `addToDossier` each → one `setDossierItemOrder`; existing dossier: skip what `dossierContainsArticle` or the same decision identity finds; returns the counts for the toast)
- Modify: `PracticeTable.tsx`, `PracticeChip.tsx` (the actions; «Aggiungi a un dossier…» lists the dossiers as `AddToDossierPopover` does)
- Test: `practiceDossierItems.test.ts`, `useSavePracticeAsDossier.test.tsx`

- [ ] **Step 1: Failing tests**: items in table order, a past text kept with its version, decisions in `decisionOrder` with `sezione`, `tipo`, `data_deposito`, an unidentified decision counted not saved; a refused `createDossier` adds nothing and says so; the order is written once after the adds; into an existing dossier, duplicates skipped and counted; the toast wording («Salvato nel dossier «…»: 4 articoli, 2 sentenze»; «1 sentenza non identificata non è stata salvata»; «2 già presenti»).
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): «Salva come dossier» — the practice becomes a dossier in its order`.

**P3:** title «feat: the practice's table on the desktop (behind VITE_FEATURE_PRACTICE_TABLE)»; body: spec §3, §5, §6.4–§6.10, §7; no change to the reading surfaces. Browser pass, flag on, desktop: build the old workspace first with the flag off (spec «Verification»: two tabs, an act with three articles, an extracted article, a past text, a decision beside an article, a topic search, a highlight and a note on an article and a decision, a forged collection), reload with the flag on: every article in its practice and act, the decision under «Giurisprudenza», the highlight and the note shown; a search, a range, «Apri l'indice e sfoglia», a citation jump inside one act and to another act, «Apri tutto» from a dossier, Cmd/Ctrl+F, compare, «Salva come dossier» and the new dossier's page; reload; turn the flag off and the old tabs are back. Phone (390 px), flag on: unchanged old view. Merge: `merge: feat/practice-table — the practice's table and the bar of practices, behind a flag`.

---

## P4 — `feat/reading-window` (apps/web)

Branch `feat/reading-window`.

### Task 12: The row of windows and its layout

**Files:**
- Create: `apps/web/src/components/features/practice/besideLayout.ts` (pure: `besideLayout(width: number, count: 0 | 1 | 2): { table: number | 'rail'; windows: number[] }`, spec §4.3: half and half; thirds when each gets 420 px; else a 48 px rail)
- Create: `apps/web/src/components/features/practice/ReadingRow.tsx` (the table and the windows side by side in the results area, widths from `besideLayout` and a `ResizeObserver` on the area; the rail opens the table as an overlay closed by Esc or a click outside)
- Create: `apps/web/src/components/features/practice/ReadingWindow.tsx` (spec §4.1: the shell — title, «Chiudi», scrolling body — and the body by kind: `article`, `decision` (`DecisionEntryView` with `hostId` = the window id), `decision-search` (`DecisionSearchTabView` with `tabId` = the window id))
- Test: `besideLayout.test.ts`, `ReadingRow.test.tsx`, `ReadingWindow.test.tsx`

- [ ] **Step 1: Failing tests**: `besideLayout` at 1280, 1440 and 1920 px with zero, one and two windows; the rail below the thresholds; the row draws the practice's windows in order and only the active practice's; switching practice hides them and returning shows them; «Chiudi» removes one window and leaves the subject in the table; a decision window and a topic window render their views.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the light window and the row of two beside the practice`.

### Task 13: The article in a window

**Files:**
- Modify: `apps/web/src/components/features/search/ArticleTabContent.tsx` (prop `variant?: 'row' | 'beside'`, default `'row'` = today; `'beside'`: the toolbar compact, Brocardi in a closed section, no `onOpenStudyMode`, no Studia row, no `AskMerltEntry`, no `article_sidebar` slot; `article_content_after` kept)
- Modify: `apps/web/src/components/features/search/ReadingToolbar.tsx` (prop `compact`: notes, highlights, discussions, copy and «Cerca nel testo» only, on the desktop row and the phone row)
- Test: `apps/web/src/components/features/search/__tests__/ArticleTabContent.beside.test.tsx` (new), `ReadingToolbar.test.tsx` (compact cases), the existing `ArticleTabContent` tests unchanged

- [ ] **Step 1: Failing tests**: in `beside`, the toolbar shows exactly the five buttons and no «⋯»; Brocardi and «Giurisprudenza» are closed; no Studio, Studia row, MERL-T entry or graph rail; **rule 23**: for each text of `utils/__fixtures__/articleTexts.ts`, the text root's text nodes joined equal `article_text` without `\n`, with a find box open (`utils/__fixtures__/openFind.ts`); in `row`, everything as today.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement**, branching on `variant` around the siblings of `ArticleBody` only.
- [ ] **Step 4: Run** the web suite, including `articleRender.test.ts` untouched; build; lint.
- [ ] **Step 5: Commit** — `feat(web): an article in a light window: its reading bar, its text, Brocardi and case law closed`.

### Task 14: «Apri accanto», decisions beside, citations from a window, the way back

**Files:**
- Modify: `PracticeArticleRow.tsx`, `PracticeDecisionsSection.tsx` («Apri accanto»; a row shown beside folds to «Aperto accanto · Chiudi la finestra», spec T5)
- Modify: `apps/web/src/store/useAppStore.ts` (flag on: `openDecisionTab` → `openDecision` beside, with `besideTabId` as the asker when it names a window; `openDecisionSearchTab` → the window only)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (flag on: `ReadingRow` in place of the bare table; a search carrying `besideTabId` that names a window opens its first article beside that window, through `openBeside` with the asker, in place of `placeTabsSideBySide`)
- Modify: `apps/web/src/components/features/search/ReadingBackControl.tsx` (flag on: a popped entry activates its practice and reveals the row or reopens the window; `onNavigated` gets the practice id)
- Modify: `ArticleTabContent.tsx` only if the citation origin must say «beside»: the window passes `readingOrigin = { tabId: <window id>, blockId: actId }`, which `findLiveBackIndex` reads as a `beside` place (to confirm in Step 1 against `useCitationLinks`; no change to the text root either way)
- Test: `ReadingRow.beside.test.tsx`, `SearchPanel.beside.test.tsx` (flag cases), `ReadingBackControl.test.tsx` (flag cases)

- [ ] **Step 1: Failing tests**: «Apri accanto» on a row opens the window and folds the row; a decision opened from a massima in an open row enters «Giurisprudenza» and opens beside; from an article in a window it keeps that window; a third window replaces the oldest other; a norm cited in a decision window enters its act and opens beside the decision; «‹ Torna a art. 2043 c.c.» after a jump from a window reopens the article beside; after a jump from a row it reveals the row; the Cronologia's reopen and the `/sentenze/…` address open beside once.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): «Apri accanto»: articles and decisions read beside the practice, and the way back to them`.

**P4:** title «feat: the light window beside the practice (behind VITE_FEATURE_PRACTICE_TABLE)»; body: spec §4, §6.1–§6.3, §11 and its test. Browser pass, flag on, desktop at 1280 and 1920 px: «Apri accanto» on an article, then a decision from its «Giurisprudenza», then a third subject (the oldest other goes, the asker stays); the rail at 1280 px with two windows; a topic search from the palette and a decision opened from it; a norm cited in the decision opens beside it; the back control both ways; a highlight and a note made in a window show in the row; «Cerca nel testo» in a window and a row at once; `/sentenze/…` opened cold; switching practices and back; reload. Phone (390 px), flag on: unchanged old view. Merge: `merge: feat/reading-window — articles and decisions read beside the practice, two at a time`.

---

## P5 — `feat/practice-phone` (apps/web)

Branch `feat/practice-phone`.

### Task 15: The phone: the table, and reading full screen

**Files:**
- Create: `apps/web/src/components/features/practice/PracticePhoneView.tsx` (spec §8: the header switching practices — chevrons, name, dots; a tap on the name lists them with «+ Nuova pratica» — and `PracticeColumn`)
- Create: `apps/web/src/components/features/practice/ReadingFullScreen.tsx` (header «‹ Pratica», 44 px, and the title; the body is `ReadingWindow`'s body for the newest `beside` entry; «‹ Pratica» closes it and returns to the table where it was)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (flag on and phone: `PracticePhoneView`, or `ReadingFullScreen` while a window is open; `ReadingBackControl`'s `onNavigated` selects the practice)
- Modify: `apps/web/src/components/features/practice/PracticeActBlock.tsx` (on the phone, Struttura opens the drawer, `TreeViewPanel variant="drawer"`)
- Test: `PracticePhoneView.test.tsx`, `ReadingFullScreen.test.tsx`, `SearchPanel.phone.test.tsx` (flag cases)

- [ ] **Step 1: Failing tests** (`matchMedia` at 390 px): the table is the main screen with «Giurisprudenza» at the bottom; «Apri accanto» shows the full-screen reader with «‹ Pratica», which returns; a decision opened from a link opens full screen; the chevrons and the list switch practices; the index drawer stays open across picks; no extracted article anywhere; with the flag off, the old phone tests pass unchanged.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice on the phone: the table first, articles and decisions full screen`.

**P5:** title «feat: the practice on the phone (behind VITE_FEATURE_PRACTICE_TABLE)»; body: spec §8. Browser pass, flag on, at 320, 360 and 390 px: the migrated workspace of P3's pass, rows opening in place, the index drawer, «Apri accanto» and «‹ Pratica», a decision from a massima, the back control, switching practices, Study Mode; then desktop again at 1440 px: the same windows are beside the table (spec §5.4). Merge: `merge: feat/practice-phone — the practice's table on the phone, reading full screen`.

---

## P6 — `refactor/retire-floating-tabs` (apps/web)

Branch `refactor/retire-floating-tabs`. After P5; before the deploy the owner asked for.

### Task 16: The flag goes; every browser migrates once

**Files:**
- Delete: `apps/web/src/utils/practiceTableFlag.ts`
- Modify: `apps/web/src/store/useAppStore.ts` (persist `version: 1` and `migrate(saved, from)`: from 0, keep sanitized `practices` if saved, else `practicesFromTabs(saved.workspaceTabs)`; drop `workspaceTabs` and `highestZIndex`; the `merge` seeding goes; `partialize` without them)
- Modify: every `isPracticeTableEnabled()` call site (the new branch stays, the old one goes): `SearchPanel.tsx`, `DossierDetailView.tsx`, `DossierListView.tsx`, `useGlobalSearch.ts`, `GlobalSearch.tsx`, `CompareView.tsx`, `ReadingBackControl.tsx`, the store
- Test: `apps/web/src/store/__tests__/practices.persist.test.ts` (the `migrate` cases, from the P1 fixtures saved as version 0)

- [ ] **Step 1: Failing tests**: a version-0 state with tabs migrates to practices (every case of Task 4 through `migrate`); a version-0 state that already holds practices keeps them; the result holds no `workspaceTabs`; a garbage state yields no practice and no throw.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `refactor(web): the practice table is the workspace; saved tabs migrate once`.

### Task 17: The tab model goes

**Files:**
- Delete: `apps/web/src/components/features/workspace/WorkspaceManager.tsx`, `WorkspaceTabPanel.tsx` and `WorkspaceTabPanel.test.tsx`, `NormaBlockComponent.tsx`, `LooseArticleCard.tsx`, `WorkspaceNavigator.tsx`, `SortableWorkspaceTab.tsx`, `renderTabView.tsx`, `apps/web/src/components/features/decisions/DecisionTabView.tsx` (its tests moved in Task 9); `apps/web/src/components/features/search/NormaCard.tsx` and `ArticleMinimap.tsx` if nothing else imports them (check with `grep`)
- Modify: `apps/web/src/store/useAppStore.ts` (remove `WorkspaceTab`, `TabView`, `TabContent`, `NormaBlock`, `LooseArticle`, `workspaceTabs`, `highestZIndex` and every tab action: `addWorkspaceTab`, `addNormaToTab`, `addLooseArticleToTab`, `updateTab`, `removeTab`, `bringTabToFront`, `toggleTabMinimize`, `toggleTabVisibility`, `toggleNormaCollapse`, `setTabLabel`, `reorderWorkspaceTabs`, `arrangeWorkspaceTabs`, `closeAllWorkspaceTabs`, `moveNormaBetweenTabs`, `extractArticleFromNorma`, `moveLooseArticleBetweenTabs`, `removeArticleFromNorma`, `removeContentFromTab`, `mergeLooseArticleToNorma`, `consumeAutoFocusArticle`, `placeTabsSideBySide`, `setDecisionTabIdentity`, `refuseViewTab`, `newViewTab`, `placeSideBySide`, `fillFreeArea`, `freeArea`, `sanitizeViews`; `openDecisionTab` → `openDecision` and `openDecisionSearchTab` → a window, at every caller)
- Modify: `apps/web/src/utils/readingBackStack.ts` (the tab entry shape goes), `apps/web/src/hooks/useAnnexNavigation.ts` (`tabId` goes), `apps/web/src/utils/workspaceOrigin.ts` (`dragLimits` and `workspaceOrigin` go if unused; `WORKSPACE_AREA_ID` stays)
- Modify: rename `besideTabId` → `besideId` in `DecisionLink.tsx`, `DecisionResultList.tsx`, `DecisionSearchTabView.tsx`, `MassimeSection.tsx`, `CaseLawSection.tsx`, `BrocardiDisplay.tsx`, `features/merlt/rassegne/RassegnePanel.tsx`, `RassegnaPassage.tsx`, `DecisionChip.tsx`, `types/index.ts` (`SearchParams.besideTabId`), and `targetTabId` → `targetPracticeId` in `types/index.ts`, `SearchPanel.tsx`, `dossierUtils.ts`
- Test: the store tests rewritten over practices (`decisionTabs.test.ts` → `practices.decisions.test.ts`, `useAppStore.workspaceTabs.test.ts` and `useAppStore.readingNavigation.test.ts` folded into the practice tests), every test importing a deleted file

- [ ] **Step 1:** `grep -rn` for each removed name lists its callers; every one is moved or deleted.
- [ ] **Step 2:** Remove; rename; move the tests.
- [ ] **Step 3:** Web tests, build, lint; `grep -rn "workspaceTabs\|WorkspaceTab\b\|besideTabId\|targetTabId\|loose-article" apps/web/src` is empty.
- [ ] **Step 4: Commit** — `refactor(web): the floating tabs, their dock and their actions go`.

### Task 18: Tours and the web guide

**Files:**
- Modify: `apps/web/src/config/tourConfig.ts` (the workspace and block tours re-anchored on the practice table, the act block, its index line and Studio / Struttura; the dock step on the bar), and the components that start them (`useTour` in `PracticeTable` and `PracticeActBlock`)
- Modify: `apps/web/CLAUDE.md` (Frontend State: practices UI-only, saved in the browser; Reading surface: «The index is a window, the text is not» kept, the light window and `variant="beside"`; «Going back» with practice entries; «Decisions in the workspace» rewritten as «The practice»; the dossier's «Apri tutto»; the `features/workspace/` and new `features/practice/` file lists; gotchas 12, 15 and 26 brought up to date; `utils/practice.ts` among the shared utilities)
- Modify: `docs/superpowers/specs/2026-10-08-norm-tab-container-design.md` (a «Built» note at the top with the PR numbers) and this plan («Amendments during execution»)
- Test: the tour test if one exists for these steps (`grep -rn "workspaceTab\|normaBlock" apps/web/src --include='*.test.*'`)

- [ ] **Step 1:** Update the tours; run the web suite.
- [ ] **Step 2:** Update the guide, the spec note and the amendments.
- [ ] **Step 3:** Web tests, build, lint.
- [ ] **Step 4: Commit** — `docs(web): the practice table in the web guide, the tours re-anchored`.

**P6:** title «refactor: the practice table replaces the floating tabs»; body: the flag removed, the one-time migration (persist version 1), the deleted files and actions, the renames, spec §9. Browser pass with no flag: a browser that saved a workspace on `develop` before P6 (the P3 fixture workspace, built with the flag off) loads it as practices — every article, decision, highlight and note present; desktop at 1280 and 1920 px and phone at 360 and 390 px; the tours; `/sentenze/…` cold; a dossier's «Apri tutto»; «Salva come dossier»; logout and login as another test account shows no practice. Merge: `merge: refactor/retire-floating-tabs — the practice table replaces the floating tabs`.

Then: the owner's trial on the development stack, and the deploy he asked for after the whole redesign («implementiamo prima tutto e poi mettiamo sul ROG»).

## Amendments during execution

(None yet.)
