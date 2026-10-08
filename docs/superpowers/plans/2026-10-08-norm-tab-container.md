# The norm tab becomes the practice's table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating norm tabs with one table per practice — acts, their articles in one continuous column with an index on top, and the practice's decisions under «Giurisprudenza» — with a light window to read one article or one decision beside it (two at most), a bar of practices in place of the dock, the same column on the phone, «Salva come dossier», and every saved workspace carried over without loss.

**Architecture:** A pure module (`utils/practice.ts`) holds the practice model, its rules and the migration from today's tabs. The store gains a `practices` slice beside `workspaceTabs`; while `VITE_FEATURE_PRACTICE_TABLE` is on, the search page draws the new table, the bar and the windows from it on the desktop and the phone alike, and the few store actions every entry point already calls (`openDecisionTab`, `openDecisionSearchTab`, `addNormaIndexToTab`, `focusArticleInTab`) route into the practice. The reading surfaces (`ArticleTabContent`, the decision's view) are mounted unchanged in a row of the table or in a window; nothing inside a text root changes (root rule 23). PR 4d's find window reads the practices. The last PR removes the flag, migrates every browser once (persist version 1) and deletes the tab model.

**Tech Stack:** React 19 / TypeScript / Zustand + Immer (`persist`) / `@dnd-kit` / Vitest / Testing Library (apps/web). No server, Python or Prisma change.

**Spec:** `docs/superpowers/specs/2026-10-08-norm-tab-container-design.md`

## Owner answers after the spec

The owner confirmed the interview on 8 October 2026 («Ti confermo l'intervista con i raccomandati»; for questions 1 and 2 the hypotheses stand) and answered the one question the spec's first draft left open with «procedi» (spec §13, D15): a past text is a row of its act, marked «Testo al …», and no longer opens in a tab of its own (Tasks 3, 4, 8, 10, 11). His instruction for the round: build and merge the whole redesign first, then deploy it on the deployment host.

Sequencing, as the spec's §12 sets it: PR 4d of the norms-decisions round (the floating find window, being built) and PR 5 (decisions in the Cronologia) merge before P1.

## Global Constraints

- UI copy in Italian; code, comments, commits and docs in English.
- Root rule 23: no change to `ArticleBody`'s text root, `renderArticleHtml`, `renderDecisionHtml`, `useArticleMarkers` or the readers' output. Every new label sits outside a text root. `articleRender.test.ts` and `decisionRender.test.ts` stay green untouched.
- Annotation keys never change: `buildItemKey`, `uniqueArticleIdFromNorma` (`utils/normaKeys.ts`) and `decisionKey` are read, never rewritten. An article carries its `norma_data` unchanged through every move and through the migration. Two copies of an article become one row only when `buildItemKey` and `versionKey` both match (`practiceArticleKey`, spec T2): no row may hide an annotation key.
- Gotcha 32: every surface that draws article text goes through `describeVersion` (the row and the window mount `ArticleTabContent`, which does). Anything that groups or compares articles adds `versionKey` (`practiceArticleKey` does).
- Gotcha 14: every store action that changes two things does it in one `set`; a one-shot signal (`pendingReveal`, `pendingDecision`, the focus request, `practiceNotice`) is consumed atomically.
- Gotcha 15: the dossier's «Apri tutto» creates exactly one practice synchronously before `navigate('/')` and passes its id as `targetTabId` on every queued search (`searchesForGroups(title, groups, () => practiceId)`).
- Gotcha 17: the practice is UI state saved in the browser (spec D6); «Salva come dossier» creates the dossier on the server first (`createDossier` returns the server id or null) and adds items through `addToDossier`.
- Gotcha 26: one layout per breakpoint through `useIsDesktop`; never a portal inside a CSS-hidden wrapper.
- Gotcha 9: article ids compared through `normalizeArticleId` / `findArticleByNormalizedId` (in the practice, `findPracticeArticle`, which also compares a code's annex through `shownAnnex`), then canonicalised with `getUniqueArticleId`.
- Gotcha 18: saved state that does not parse, and a save that fails, are logged with context, never thrown and never swallowed.
- Shared code first (`apps/web/CLAUDE.md`, «Shared utilities»): `actKeyOf`, `compareArticles`, `articleLabel`, `shownAnnex` (`dossierLayout.ts`); `normaForDossier`, `sentenzaFromDecision`, `dossierContainsArticle`, `searchesForGroups` (`dossierUtils.ts`); `actHeading`, `citeNorm`, `shortAct` (`utils/sources`); `formatDecisionShort`, `decisionKey`, `identityOf` (`decisionLinks.ts`); `versionKey`, `historicalItemLabel`, `versionTabSuffix` (`versionDisplay.ts`); `getRubricText`, `parseArticleStructure`; `ui/MenuButton`, `ui/ConfirmDialog` (`variant="danger"`), `ui/Toast`; `pushSyncError`; `useIsDesktop`; `Z_INDEX`.
- The flag: `VITE_FEATURE_PRACTICE_TABLE`, read by `isPracticeTableEnabled()` in `apps/web/src/features/practice/featureFlag.ts` (the house's place for flags); absent or anything but `true` = off, unlike the house's default-on flags, because it hides unfinished work rather than a finished area (spec T9). No env file is read or written by the agent.
- Browser passes run the branch's own Vite on its own port, with the flag in its environment when the pass needs it: `VITE_FEATURE_PRACTICE_TABLE=true npm --prefix apps/web run dev -- --port 5174`, logged in with a test account against the shared backend. Never restart or reconfigure the shared stack on :5173. `localStorage` belongs to the origin: a pass that builds on the old surface and reloads with the flag on restarts the same port without, then with, the flag.
- Before P1: PR 4d (`feat/find-window`) and PR 5 (`feat/decision-history`) of the norms-decisions plan have merged; each redesign branch starts from a `develop` that holds them. The redesign code starts after VisuaLex Studia PR A (`feat/studia-cards`) merges; whoever merges second merges `origin/develop` into its branch first (spec §12).
- Branches from `origin/develop` in a worktree, one per PR; never switch branches in the main checkout. Commits with explicit paths and the session's attribution line. Merge commit titled `merge: <branch> — <what changes>`, at green CI.
- Nothing private in the repository (no vault text, no personal paths or names, no infrastructure addresses).
- Before calling a PR done: `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build` (the real type-check), `npm --prefix apps/web run lint`, all green; errors met in touched files fixed, pre-existing ones too.

## Review Focus

1. **A saved workspace that becomes practices** — two tabs of one act, a codice civile with and without its R.D., an extracted article, a forged collection, a past-text tab, a decision tab found and one not found, two topic tabs, an empty tab, garbage: every article and decision arrives in the right practice, nothing throws, the highlights and notes made before show after, and the topic search not reopened is named to the user. Tests in Tasks 4 and 5; browser pass at P3 and P6.
2. **Seeding happens once, and only once** — a session with the flag off then on seeds; «Chiudi tutte» then a reload stays empty; P6's `migrate` keeps seeded practices and migrates unseeded browsers. Tests in Tasks 5 and 16.
3. **No row hides an annotation** — copies whose `buildItemKey`s differ are two rows; an index pick of an article already on the table reveals its row. Tests in Tasks 3, 4 and 8.
4. **The same decision opened three ways** (palette, a massima, a reload) — one entry in the practice, one window, focused; a candidate chosen that turns out to be an entry already there merges into it. Test in Task 7.
5. **The row of two** — a decision opened from an article read in a window never closes that article; a third window replaces the oldest other; the replaced subject stays in the table. Test in Task 7.
6. **A past text and the text in force of one article** — two rows, two keys, Studio locked on the past one, both saved as two dossier items. Tests in Tasks 3, 8 and 11.
7. **Root rule 23 in the window** — the text root's text nodes spell `article_text` minus `\n` with the compact toolbar and the find window open on that text. Test in Task 13.
8. **A full `localStorage`** — a failed save throws out of no store action and is shown once. Test in Task 5.
9. **The phone's reader** — a reload on a phone lands on the table; the desktop's windows fold no row on a phone; «‹ Pratica» returns to the same scroll. Test in Task 15.
10. **Logout on a shared browser** — `clearUserData` leaves no practice behind. Test in Task 5.

---

## P1 — `refactor/workspace-groundwork` (apps/web)

Worktree: `git worktree add .claude/worktrees/workspace-groundwork -b refactor/workspace-groundwork origin/develop`, then `cd` into it in its own command. No visible change. `origin/develop` holds PR 4d and PR 5 (Global Constraints).

### Task 1: The article collections go

Nothing creates a collection (spec, «What was measured»); a browser may still hold one, which the old surface must keep drawing until P6, so the store turns a saved collection into loose articles of the same tab when it loads.

**Files:**
- Delete: `apps/web/src/components/features/workspace/ArticleCollectionComponent.tsx`
- Modify: `apps/web/src/store/useAppStore.ts` (drop `ArticleCollection`, `CollectionArticle` and the six collection actions from `AppState` and the implementation; `TabContent = NormaBlock | LooseArticle`; in `merge`, `foldCollections` after `sanitizeViews`; the type export line)
- Modify: `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx` (the `collection` branches of `handleAddToDossier` and of the content map)
- Modify: `apps/web/src/components/features/workspace/WorkspaceManager.tsx` (the `collection-drop-` branch and `moveLooseArticleToCollection`)
- Modify: `apps/web/src/components/features/workspace/SortableWorkspaceTab.tsx` (the collection count and icon)
- Modify: `apps/web/src/components/features/compare/CompareView.tsx` and `apps/web/src/components/features/compare/CompareView.test.tsx` (the collection branch and its fixture)
- Modify: `apps/web/src/store/__tests__/decisionTabs.test.ts` (the `createCollection` row of the refusal table)
- Test: `apps/web/src/store/__tests__/useAppStore.workspaceTabs.test.ts`

- [ ] **Step 1: Failing test** — a saved collection is kept as loose articles:

```ts
import type { ArticleData, Norma } from '../../types';

const CC: Norma = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16' };
const ARTICLE_2043: ArticleData = {
  article_text: 'Qualunque fatto doloso o colposo…',
  norma_data: { ...CC, numero_articolo: '2043', allegato: '2' },
};
type Merge = (persisted: unknown, current: unknown) => { workspaceTabs: WorkspaceTab[] };

it('turns a saved collection into loose articles of its tab', () => {
  const merge = (appStore as unknown as { persist: { getOptions: () => { merge: Merge } } }).persist.getOptions().merge;
  const saved = { workspaceTabs: [{ ...makeTab('t'),
    content: [{ type: 'collection', id: 'c', label: 'Raccolta', isCollapsed: false,
      articles: [{ article: ARTICLE_2043, sourceNorma: CC }] }] }] };
  const tabs = merge(saved, appStore.getState()).workspaceTabs;
  expect(tabs[0].content).toEqual([{ type: 'loose-article', id: expect.any(String), article: ARTICLE_2043, sourceNorma: CC }]);
});
```

- [ ] **Step 2: Run to see it fail** — `npm --prefix apps/web run test -- --run src/store/__tests__/useAppStore.workspaceTabs.test.ts`. Expected: FAIL (the collection survives).
- [ ] **Step 3: Implement.** Remove the code listed above; `foldCollections(tabs)` maps a `collection` item to one loose article per entry and drops any other unknown `type` with a `console.warn` naming the tab (gotcha 18).
- [ ] **Step 4: Run** the store and compare tests; `grep -rn "collection" apps/web/src --include='*.ts*'` shows no workspace reference left; web build and lint.
- [ ] **Step 5: Commit** — `refactor(web): the article collections go; a saved one is kept as loose articles`.

### Task 2: `workspaceTabActions.ts` goes

PR 4d deletes `useGlobalSearch.ts`, the file's only importer (norms-decisions plan Task 35), so after 4d nothing imports it.

**Files:**
- Delete: `apps/web/src/store/workspaceTabActions.ts`
- Modify: `apps/web/CLAUDE.md` (gotcha 25 removed; its number left free, as 23, 24 and 31 are)
- Modify, only if Step 1 lists it: whatever file still imports the module (switch its type import to `../store/useAppStore`)

- [ ] **Step 1:** `grep -rn "workspaceTabActions" apps/web/src` lists no importer (only the store's comment that names the file, which goes with gotcha 25). If PR 4d's code left an importer, switch it first.
- [ ] **Step 2:** Delete the file, remove gotcha 25 and the store's comment that points at it.
- [ ] **Step 3:** Web tests, build, lint.
- [ ] **Step 4: Commit** — `refactor(web): the dead copy of the workspace tab actions goes`.

### Task 3: The practice model and its rules

**Files:**
- Create: `apps/web/src/utils/practice.ts`
- Test: `apps/web/src/utils/__tests__/practice.test.ts`

**Interfaces** (spec §2):
- Types `Practice`, `PracticeAct`, `PracticeDecision`, `BesideRef` exactly as the spec's §2.
- `practiceArticleKey(article: ArticleData): string` — `buildItemKey(norma_data)` + `'|'` + `versionKey(...)`. In Step 1, confirm which field a «Testo alla data» search always fills (`processResult` sets `versionInfo` through `deriveVersionInfo`; `normaForDossier` reads `norma_data.versione` / `data_versione`) and key on the one that is always set; adjust the past-text fixture below to match.
- `findPracticeArticle(act: PracticeAct, articleId: string): ArticleData | undefined` — `findArticleByNormalizedId` over the act's rows; for a code (`shownAnnex` empty) the annex prefix of `articleId` and of the rows is ignored; among several matches the text in force first.
- `addArticles(acts: PracticeAct[], norma: Norma, articles: ArticleData[], newId: () => string): { acts: PracticeAct[]; actId: string; added: string[] }` — finds the act by `actKeyOf(norma)` or appends one; inserts each article whose `practiceArticleKey` is not present (`added`: their keys, in input order); sorts by `compareArticles(a.norma_data, b.norma_data)` (stable); a copy with a key already present fills `brocardi_info` (and drops `brocardi_error`) and the act's `norma.urn`, never its `norma_data`.
- `sameDecision(entry: DecisionReference, wanted: DecisionReference): boolean` — moved from `useAppStore.ts`, same rule.
- `decisionOrder(decisions: PracticeDecision[]): PracticeDecision[]` — newest first: `depositDate` when present, else `anno`; ties by `numero` descending (spec T7).
- `besideAfterOpen(beside: BesideRef[], ref: BesideRef, askerId?: string): BesideRef[]` — spec §4.2, T16.
- `practiceCounts(p: Practice): { acts: number; articles: number; decisions: number }` and `practiceCountLine(counts)` («2 atti · 4 articoli · 2 sentenze», singulars right, empty parts left out).

- [ ] **Step 1: Failing tests**:

```ts
import { describe, it, expect } from 'vitest';
import type { ArticleData, BrocardiInfo, Norma, NormaVisitata } from '../../types';
import { buildItemKey, uniqueArticleIdFromNorma } from '../normaKeys';
import {
  addArticles, besideAfterOpen, decisionOrder, findPracticeArticle, practiceArticleKey, practiceCountLine,
  type BesideRef, type PracticeDecision,
} from '../practice';

let seq = 0;
const id = () => `id-${++seq}`;
const CC_RD: Norma = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16' };
const CC_BARE: Norma = { tipo_atto: 'codice civile', data: '' };
const L24: Norma = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' };
const art = (norma: Norma, numero: string, extra: Partial<NormaVisitata> = {}, more: Partial<ArticleData> = {}): ArticleData =>
  ({ article_text: `Art. ${numero}`, norma_data: { ...norma, numero_articolo: numero, ...extra }, ...more });
const numbers = (a: ArticleData[]) => a.map((x) => uniqueArticleIdFromNorma(x.norma_data));

describe('addArticles', () => {
  it('puts the codice civile with and without its R.D. in one act, and never merges copies whose annotation keys differ', () => {
    const fromSearch = art(CC_RD, '2043', { allegato: '2' });
    const fromIndex = art(CC_BARE, '2043');
    const art1218 = art(CC_BARE, '1218');
    let r = addArticles([], CC_RD, [fromSearch], id);
    r = addArticles(r.acts, CC_BARE, [fromIndex, art1218], id);
    expect(r.acts).toHaveLength(1);
    expect(r.acts[0].articles.map((a) => buildItemKey(a.norma_data)))
      .toEqual([buildItemKey(art1218.norma_data), buildItemKey(fromSearch.norma_data), buildItemKey(fromIndex.norma_data)]);
    expect(r.added).toEqual([practiceArticleKey(fromIndex), practiceArticleKey(art1218)]);
  });
  it('merges an identical copy, which fills Brocardi and gives the act its URN', () => {
    const first = art(CC_RD, '2043', {}, { brocardi_error: 'timeout' });
    const brocardi = { position: 'Libro IV' } as BrocardiInfo;
    let r = addArticles([], CC_RD, [first], id);
    r = addArticles(r.acts, { ...CC_RD, urn: 'urn:nir:stato:regio.decreto:1942-03-16;262' },
      [art(CC_RD, '2043', {}, { brocardi_info: brocardi })], id);
    expect(r.added).toEqual([]);
    expect(r.acts[0].articles).toHaveLength(1);
    expect(r.acts[0].articles[0].brocardi_info).toEqual(brocardi);
    expect(r.acts[0].articles[0].brocardi_error).toBeUndefined();
    expect(r.acts[0].articles[0].norma_data).toEqual(first.norma_data);
    expect(r.acts[0].norma.urn).toBe('urn:nir:stato:regio.decreto:1942-03-16;262');
  });
  it('keeps a past text beside the text in force, after it, under another key', () => {
    const inForce = art(CC_RD, '2043');
    const past = art(CC_RD, '2043', { data_versione: '2007-12-29' }, { versionInfo: { isHistorical: true, requestedDate: '2007-12-29' } });
    const r = addArticles([], CC_RD, [past, inForce], id);
    expect(r.acts[0].articles).toEqual([inForce, past]);
    expect(practiceArticleKey(past)).not.toBe(practiceArticleKey(inForce));
  });
  it('orders 2, 2-bis, 3, 10 and puts an annex after the body', () => {
    const r = addArticles([], L24, [art(L24, '10'), art(L24, '1', { allegato: 'A' }), art(L24, '2-bis'), art(L24, '3'), art(L24, '2')], id);
    expect(numbers(r.acts[0].articles)).toEqual(['2', '2-bis', '3', '10', 'allA:1']);
  });
});

describe('findPracticeArticle', () => {
  it('finds «1 bis» as 1-bis, and a code article with or without its annex', () => {
    const law = addArticles([], L24, [art(L24, '1-bis')], id).acts[0];
    expect(findPracticeArticle(law, '1 bis')?.norma_data.numero_articolo).toBe('1-bis');
    const code = addArticles([], CC_RD, [art(CC_RD, '2043', { allegato: '2' })], id).acts[0];
    expect(findPracticeArticle(code, '2043')).toBe(code.articles[0]);
    expect(findPracticeArticle(code, 'all2:2043')).toBe(code.articles[0]);
  });
  it('prefers the text in force to a past text of the same article', () => {
    const inForce = art(CC_RD, '2043');
    const act = addArticles([], CC_RD, [art(CC_RD, '2043', { data_versione: '2007-12-29' }), inForce], id).acts[0];
    expect(findPracticeArticle(act, '2043')).toEqual(inForce);
  });
});

describe('besideAfterOpen', () => {
  const win = (k: string): BesideRef => ({ id: k, kind: 'decision', decisionId: k });
  const [A, B, C] = [win('a'), win('b'), win('c')];
  it('appends up to two', () => expect(besideAfterOpen([A], B)).toEqual([A, B]));
  it('replaces the oldest with a third', () => expect(besideAfterOpen([A, B], C)).toEqual([B, C]));
  it('never replaces the window that asked', () => expect(besideAfterOpen([A, B], C, 'a')).toEqual([A, C]));
  it('moves nothing when the subject is already beside', () => expect(besideAfterOpen([A, B], A)).toEqual([A, B]));
});

describe('decisionOrder', () => {
  const dec = (key: string, numero: number, anno: number, depositDate?: string): PracticeDecision => ({
    id: key, reference: { corte: 'cassazione', numero, anno, archivio: 'civile' }, label: `${numero}/${anno}`,
    identified: depositDate !== undefined, ...(depositDate ? { depositDate } : {}),
  });
  it('puts the newest deposit first, an unread decision by its year, ties by number', () => {
    const a = dec('a', 28994, 2019, '2019-11-11');
    const b = dec('b', 577, 2008, '2008-01-11');
    const c = dec('c', 100, 2024);
    const d = dec('d', 200, 2024);
    expect(decisionOrder([b, a, c, d]).map((x) => x.id)).toEqual(['d', 'c', 'a', 'b']);
  });
});

describe('practiceCountLine', () => {
  it('names what is there, singulars right', () => {
    expect(practiceCountLine({ acts: 2, articles: 4, decisions: 2 })).toBe('2 atti · 4 articoli · 2 sentenze');
    expect(practiceCountLine({ acts: 1, articles: 1, decisions: 0 })).toBe('1 atto · 1 articolo');
    expect(practiceCountLine({ acts: 0, articles: 0, decisions: 1 })).toBe('1 sentenza');
  });
});
```

- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/utils/__tests__/practice.test.ts`.
- [ ] **Step 3: Implement**, importing `actKeyOf`, `compareArticles`, `shownAnnex` from `components/features/dossier/dossierLayout.ts` (the store already imports from the dossier folder), `findArticleByNormalizedId` from `utils/articleIds.ts`, and nothing from the store.
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice model: acts, articles by number, decisions, the row of two windows`.

### Task 4: From saved tabs to practices, and saved practices checked

**Files:**
- Modify: `apps/web/src/utils/practice.ts` (`practicesFromTabs`, `sanitizePractices`)
- Create: `apps/web/src/utils/__fixtures__/savedWorkspaces.ts` (saved states in the shapes `useAppStore.ts` writes today; one forged collection; one garbage state)
- Test: `apps/web/src/utils/__tests__/practiceMigration.test.ts`

**Interfaces:**
- `practicesFromTabs(tabs: unknown, newId: () => string): { practices: Practice[]; activePracticeId: string | null; dropped: string[]; droppedSearches: string[] }` — spec §9, steps 1–5. Takes `unknown`; never throws. `dropped`: what did not parse, for the log; `droppedSearches`: the labels of the topic searches not reopened, for the notice.
- `practiceNoticeText(droppedSearches: string[]): string | null` — the notice of spec §9 (singular and plural), `null` for none.
- `sanitizePractices(raw: unknown): { practices: Practice[]; dropped: string[] }` — spec §10.

- [ ] **Step 1: Failing tests** — one per case of spec §9 and §10:
  - two tabs → two practices, same ids, labels, order; the practice of the tab with the highest z-index is active;
  - one tab with two blocks of the codice civile (with and without R.D.) → one act keeping the first block's id; art. 2043 in both blocks → two rows (their `buildItemKey`s differ), art. 1218 in one → one row;
  - a code's article from a search (`allegato: '2'`) and from the index → two rows of one act, each keeping its `norma_data`;
  - a loose article of an act already in the tab → in that act; of another act → a new act;
  - the forged collection → its articles in their acts;
  - a past-text tab → a practice whose act holds the past text, key with its version;
  - a found decision tab and an unresolved one → two entries of the front practice, both `identified: false`, references unchanged;
  - decision tabs and no norm tab → one practice «Sentenze»;
  - two topic tabs → the one with the higher z-index a window of the front practice, the other's label in `droppedSearches`; `practiceNoticeText` for one and for two labels gives spec §9's two sentences;
  - an empty tab → an empty practice;
  - garbage (`null`, a string, a tab without `id`, an article without `norma_data`, a decision with `numero: -1`) → dropped and listed in `dropped`, no throw;
  - **nothing lost**: for every article of the fixture, `buildItemKey(norma_data)` and `uniqueArticleIdFromNorma(norma_data)` before equal one article's after, and the number of distinct `buildItemKey` + `versionKey` pairs is unchanged; for every decision, `decisionKey`.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/utils/__tests__/practiceMigration.test.ts`.
- [ ] **Step 3: Implement**, reusing `addArticles` and `isValidView`'s checks (move `isValidView` from the store into `practice.ts` and import it back).
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): saved tabs become practices, and saved practices are checked before use`.

**P1:** title «refactor: workspace groundwork for the practice table»; body: the collections and the dead action file go (gotcha 25), the pure model and migration land unused, spec link. Browser pass on the branch's own Vite (Global Constraints), desktop and 390 px: a workspace with two tabs, a decision tab and a topic tab reloads unchanged; with a collection forged into `visualex-storage` in devtools, its articles reload as loose cards. Merge: `merge: refactor/workspace-groundwork — collections out, the practice model and its migration`.

---

## P2 — `feat/practice-store` (apps/web)

Worktree as P1, branch `feat/practice-store`. Inert without the UI of P3.

### Task 5: The flag, the slice, the seeding marker, the wrapped storage, logout

**Files:**
- Create: `apps/web/src/features/practice/featureFlag.ts` (`isPracticeTableEnabled()`: `import.meta.env.VITE_FEATURE_PRACTICE_TABLE === 'true'`; a comment saying why it is off by default unlike the house's flags, and that P6 removes it)
- Create: `apps/web/src/utils/guardedStorage.ts` (`guardedStorage(target: Storage, onFail: (info: { name: string; bytes: number; error: unknown }) => void): StateStorage`: `getItem` and `removeItem` pass through; `setItem` catches any error, calls `onFail` and returns)
- Modify: `apps/web/src/store/useAppStore.ts` (state `practices`, `activePracticeId`, `practicesSeeded`, session-only `practiceRows`, `pendingReveal`, `practiceNotice` with `takePracticeNotice()`; `partialize` adds `practices`, `activePracticeId` and `practicesSeeded`; `storage: createJSONStorage(() => guardedStorage(localStorage, reportSaveFailure))`, where `reportSaveFailure` logs once per session with the key, the size and the error's name and, in a microtask, calls `pushSyncError('Il tavolo di lavoro non viene più salvato nel browser: lo spazio è esaurito. Chiudi qualche pratica.')`; `merge` runs `sanitizePractices` on saved practices and, with the flag on and `practicesSeeded !== true`, seeds from `practicesFromTabs(p.workspaceTabs)`, sets `practicesSeeded: true` and `practiceNotice` from `practiceNoticeText`, and logs `dropped`; `clearUserData` empties the slice and resets `practicesSeeded`)
- Test: `apps/web/src/store/__tests__/practices.persist.test.ts`, `apps/web/src/utils/__tests__/guardedStorage.test.ts`

- [ ] **Step 1: Failing tests**:
  - with `vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true')`, a saved state with tabs and no marker rehydrates with practices, `practicesSeeded: true`, the tabs kept;
  - **flag off, then on**: a saved state written by a flag-off session (`practices: []`, no marker) rehydrates with the flag on seeded from its tabs;
  - **«Chiudi tutte»**: a saved state with `practices: []` and `practicesSeeded: true` rehydrates with no practice, whatever the tabs hold;
  - with the flag off, no practices are seeded and the marker stays unset;
  - saved practices are kept and sanitized (a malformed one dropped, logged);
  - two dropped topic searches set `practiceNotice`, and `takePracticeNotice()` returns it once (the second call returns null);
  - `partialize` holds `practices`, `activePracticeId` and `practicesSeeded`, never `practiceRows`, `pendingReveal` or `practiceNotice`;
  - **a full storage**: with a `localStorage` whose `setItem` throws a `DOMException` named `QuotaExceededError`, `createPractice('x')` (Task 6; here any store action, e.g. `pushSyncError`) completes without throwing, the state holds the change, `console.error` is called once with the key and the size, and after a microtask `lastSyncError.message` is the copy above; a second failing save logs nothing more; `guardedStorage`'s own test covers pass-through and the caught error;
  - `clearUserData` empties the slice and resets the marker.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/store/__tests__/practices.persist.test.ts src/utils/__tests__/guardedStorage.test.ts`.
- [ ] **Step 3: Implement.** Seeding sits in `merge` because the persist `version` changes only in P6 (spec §9).
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): practices in the store, saved in the browser, seeded once from the tabs behind a flag; a full storage no longer throws`.

### Task 6: The practice's actions

**Files:**
- Modify: `apps/web/src/store/useAppStore.ts`
- Test: `apps/web/src/store/__tests__/practices.actions.test.ts`

**Interfaces** (every one a single `set`):
- `createPractice(label: string, options?: { custom?: boolean; activate?: boolean }): string`
- `renamePractice(id, label)` (trimmed, capped at 120 characters, sets `labelIsCustom`), `closePractice(id)`, `closeAllPractices()` (leaves `practicesSeeded` set), `setActivePractice(id)`, `reorderPractices(from, to)`
- `addArticlesToPractice(practiceId: string | null, norma: Norma, articles: ArticleData[], options?: { reveal?: 'first' | string; label?: string }): { practiceId: string; actId: string }` — `null` means the active practice, created (named `options.label ?? shortAct(norma)`) when there is none; an id that names no practice falls back to the same, with a `console.warn` naming it (spec §5.1); `reveal` sets `pendingReveal` and opens the row
- `addActIndexToPractice(practiceId: string | null, norma: Norma): string` — an article-less act, and `structureWindow.blockId` pointed at it, atomically (today's `addNormaIndexToTab`)
- `revealPracticeArticle(practiceId, actId, articleId): boolean` — `findPracticeArticle`; when found, opens and reveals its row and returns true (the index pick, the arrows and citation jumps call it before fetching)
- `removePracticeArticle(practiceId, actId, articleKey)`, `removePracticeAct(practiceId, actId)`, `moveActToPractice(actId, from, to)`, `reorderActs(practiceId, from, to)`, `toggleActCollapse(practiceId, actId)`
- `setRowOpen(rowKey: string, open: boolean)`, `takeReveal(practiceId): { rowKey: string } | null` (atomic, gotcha 14)

- [ ] **Step 1: Failing tests**: a search into no practice creates one named after the act and makes it active; a second act enters the same practice; an unknown practice id lands in the active practice and warns; `reveal` opens the asked row and is taken once (two calls under StrictMode-like double invocation: the second returns null); `revealPracticeArticle` finds «1 bis» as 1-bis and a code article with or without `all2:`; `addActIndexToPractice` reuses an act already there and backfills its URN, and the structure window points at it; moving an act to another practice keeps its id and its articles; closing the active practice activates its neighbour; `closeAllPractices` leaves the marker set; renaming caps the label.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/store/__tests__/practices.actions.test.ts`.
- [ ] **Step 3: Implement** over `utils/practice.ts`.
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice's actions: acts, articles, rows, the index, moves`.

### Task 7: Decisions and windows in the practice; the back-stack over practices

**Files:**
- Modify: `apps/web/src/store/useAppStore.ts` (`openDecision`, `setDecisionEntryIdentity`, `removePracticeDecision`, `openBeside`, `closeBeside`; `pushReadingBack` converts an entry whose `tabId` names a practice (`place: 'table'`) or a window (`place: 'beside'`) into the shape of spec §6.3; `popReadingBack` accepts both shapes. No existing action routes here yet: an entry point that wrote into practices before P3 draws them would hide what it opened)
- Modify: `apps/web/src/utils/readingBackStack.ts` (the entry union of spec §6.3; `findLiveBackIndex` over tabs and practices)
- Test: `apps/web/src/store/__tests__/practices.decisions.test.ts`, `apps/web/src/utils/readingBackStack.test.ts`

**Interfaces:**
- `openDecision(reference: DecisionReference, options?: { practiceId?: string; beside?: boolean; askerId?: string }): { practiceId: string; decisionId: string }` — the entry by `sameDecision` (an unresolved entry learns a later citation's section, today's rule) or a new one with `identified: false`; `beside` (default true: every way in today opens a decision to read it, spec D7) opens the window through `besideAfterOpen`; `beside: false` reveals the entry's row instead
- `setDecisionEntryIdentity(practiceId, decisionId, identity, attrs: { sezione?: string; tipo?: string; data_deposito?: string }, label)` — identity, label, `depositDate`, `tipo`, `identified: true`; another entry of the practice already holding the decision → this one goes, the window (if any) points at the survivor, `decisionFocusRequest` names it
- `openBeside(practiceId, ref: BesideRef, askerId?: string)`, `closeBeside(practiceId, refId)`

- [ ] **Step 1: Failing tests**: the same decision through three `openDecision` calls (plain, again, with a section) is one entry and one window; a citation with an archive does not match an entry of the other archive; a found identity that another entry holds merges into it and asks it for focus; `openDecision` with an `askerId` keeps that window; `beside: false` adds the entry, no window, and reveals its row; a topic opens a window and no entry; the back-stack: an entry pushed with `{ tabId: <practice id>, blockId: <act id>, articleId }` is stored as a `table` entry and one with a window id as a `beside` entry; an entry whose practice was closed or whose subject was removed is skipped; a `beside` entry reopens the window, a `table` entry reveals the row; the old tab entries still work while both shapes exist.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/store/__tests__/practices.decisions.test.ts src/utils/readingBackStack.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): decisions and the windows beside them belong to the practice; the way back follows them`.

**P2:** title «feat: the practice store (behind VITE_FEATURE_PRACTICE_TABLE)»; body: inert without P3, the seeding once with the flag on (the marker), the wrapped storage, spec §2, §9, §10. Browser pass on the branch's own Vite: with the flag off, nothing changes on desktop and at 390 px; restarted with it on, `visualex-storage` gains `practices` seeded from the tabs and `practicesSeeded: true` (devtools), and the old surface still works; a reload does not seed again. Merge: `merge: feat/practice-store — practices, decisions and windows in the store, behind a flag`.

---

## P3 — `feat/practice-table` (apps/web)

Branch `feat/practice-table`. Everything new is drawn only with the flag on, on the desktop and on the phone (spec T18): every store action that routes into a practice is drawn on both breakpoints. The phone gets the plain table here (the switcher over practices and the column); its full-screen reader and the practice list come in P5.

### Task 8: The column: act blocks and their rows

**Files:**
- Create: `apps/web/src/components/features/practice/PracticeColumn.tsx` (the acts in order, then «Giurisprudenza»; takes `practiceId`, `onViewPdf`, `onCrossReference`; consumes `takeReveal` and scrolls the revealed row into view; reserves the bottom padding of spec §3.4)
- Create: `apps/web/src/components/features/practice/PracticeActBlock.tsx` (spec §3.2: heading with drag handle, `actHeading`, `formatNormaMeta`, Studio / Struttura / PDF as `NormaBlockComponent` has them, «⋯» with «Sposta in un'altra pratica» and «Rimuovi l'atto» behind a danger `ConfirmDialog`; the index line of chips (`shownAnnex`) and `ArticleNavigation`, which calls `revealPracticeArticle` before loading; the rows; the structure window `TreeViewPanel variant="window"` on the desktop and `variant="drawer"` on the phone (`useIsDesktop`); `LazyStudyMode` mounted only with an article)
- Create: `apps/web/src/components/features/practice/PracticeArticleRow.tsx` (spec §3.2: `articleLabel`, the rubrica from `getRubricText(text, parseArticleStructure(text))`, the «Testo al …» chip, «Togli dal tavolo»; header-scoped toggle; open → `ArticleTabContent` with `readingOrigin = { tabId: practiceId, blockId: actId }`; `AnnexSuggestion` inside the open row)
- Modify: `apps/web/src/hooks/useAnnexNavigation.ts` (an optional `addArticles(norma, articles)` used before `tabId`, after `revealPracticeArticle`; `tabId` stays for the old surface)
- Test: `apps/web/src/components/features/practice/PracticeActBlock.test.tsx`, `apps/web/src/components/features/practice/PracticeArticleRow.test.tsx`, `apps/web/src/components/features/practice/PracticeColumn.test.tsx`, `apps/web/src/hooks/__tests__/useAnnexNavigation.addArticles.test.ts`

- [ ] **Step 1: Failing tests**: the index line lists every row once with annex and past-text marks (a code's rows with no annex) and a click opens and reveals the row; rows show «art. 2043 — Risarcimento per fatto illecito» from the text; a past text shows «Testo al 29/12/2007» and Studio is disabled when it is the last opened row; «Rimuovi l'atto» asks first; «Sposta in un'altra pratica» lists the other practices; a closed row mounts no `ArticleTabContent`; acts reorder by keyboard (dnd-kit's keyboard sensor); a pick from the index lands in the act through `addArticles`, and a pick of an article already there reveals its row and fetches nothing; the column has the bottom padding; on a phone width Struttura opens the drawer.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/components/features/practice src/hooks/__tests__/useAnnexNavigation.addArticles.test.ts`.
- [ ] **Step 3: Implement**, composing `ui/MenuButton`, `ConfirmDialog`, the collapsible and sticky-row conventions, 44 px touch targets.
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice's column: acts, an index on top, articles one under the other`.

### Task 9: «Giurisprudenza», and a decision read in place

**Files:**
- Create: `apps/web/src/components/features/decisions/useDecisionAnswer.ts` (the fetch, candidates and notices of today's `DecisionTabView`, as one hook over `decisionFetchCache`)
- Create: `apps/web/src/components/features/decisions/DecisionEntryView.tsx` (props `{ practiceId, decisionId, reference, hostId }`; `useDecisionAnswer`, the palette hand-off and the focus request; on `trovata` calls `setDecisionEntryIdentity` with `attributi`; keeps PR 5's once-per-opening Cronologia record)
- Modify: `apps/web/src/components/features/decisions/DecisionTabView.tsx` (a thin wrapper for the old tab until P6, over `useDecisionAnswer` and `DecisionEntryView`'s inner body; no duplicated logic)
- Create: `apps/web/src/components/features/practice/PracticeDecisionsSection.tsx` (spec §3.3: «Giurisprudenza (n)», rows in `decisionOrder`, ×; a row opens `DecisionEntryView` in place)
- Modify: `apps/web/src/components/features/decisions/DecisionTabView.test.tsx` (its cases of fetch, candidates, notices, hand-off and the Cronologia record **move** to `DecisionEntryView.test.tsx`; it keeps one case: the wrapper draws the entry view for a decision tab; P6 deletes it)
- Test: `apps/web/src/components/features/decisions/DecisionEntryView.test.tsx` (the moved cases plus the entry merge), `apps/web/src/components/features/practice/PracticeDecisionsSection.test.tsx`

- [ ] **Step 1: Failing tests**: the section is absent with no decision; rows sort newest deposit first; a found decision updates its row's label and date and sets `identified`; a candidate chosen that is already an entry merges and focuses it; the Cronologia record happens once per opening (PR 5's test, moved); the cases moved from `DecisionTabView.test.tsx` pass against `DecisionEntryView`; the one case left in `DecisionTabView.test.tsx` passes.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/components/features/decisions src/components/features/practice/PracticeDecisionsSection.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): «Giurisprudenza» in the practice, a decision read in place`.

### Task 10: The table, the bar, the phone's table, and everything routed to the practice

**Files:**
- Create: `apps/web/src/components/features/practice/PracticeTable.tsx` (spec §3.1: header with name, count line, «Salva come dossier», «⋯»; empty state; the streaming bar; `PracticeTopicSearches`; `PracticeColumn`; takes `practiceNotice` once and shows it as an info `ui/Toast` with `duration={0}`)
- Create: `apps/web/src/components/features/practice/PracticeTopicSearches.tsx` (until P4: the practice's `decision-search` refs as a band at the top of the column, «Ricerca per tema: …» with ×, each drawing `DecisionSearchTabView` with `tabId` = the ref's id; Task 14 deletes it)
- Create: `apps/web/src/components/features/practice/PracticeBar.tsx` and `apps/web/src/components/features/practice/PracticeChip.tsx` (spec §5: chips, `aria-current`, rename, drag reorder, per-chip «⋯», «+ Nuova pratica», «Chiudi tutte» behind its danger confirmation, collapse; `Z_INDEX.dock`; `id="tour-workspace-dock"` kept)
- Create: `apps/web/src/components/features/practice/PracticePhoneView.tsx` (spec §8, P3 part: the header switching practices — chevrons, name, dots — and `PracticeColumn`; the notice toast as on the desktop)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (flag on: one layout through `useIsDesktop` — `PracticeTable` + `PracticeBar` on the desktop in place of `WorkspaceManager` + `WorkspaceNavigator`, `PracticePhoneView` on the phone in place of today's phone view; `processResult` and the buffered path call `addArticlesToPractice(targetTabId ?? null, …)` with R1/R2's reveal rules; `handleBrowseStructure` calls `addActIndexToPractice`; `handleCrossReferenceNavigate` calls `revealPracticeArticle`, else searches into the act; the auto-switch's duplicate removal per spec §5.2)
- Modify: `apps/web/src/components/features/dossier/DossierDetailView.tsx` (flag on: `openGroupsOnDashboard` creates one practice before `navigate('/')` — `const practiceId = createPractice(dossier.title, { custom: true, activate: true })` — and passes `() => practiceId` to `searchesForGroups`; when every group is opened (the picker's «Apri tutto», or a dossier with one group) it adds the dossier's decisions with `openDecision(reference, { practiceId, beside: false })`)
- Modify: `apps/web/src/components/features/dossier/DossierListView.tsx` (flag on: `openAllGroupsOnDashboard` as above, and `openGroupOnDashboard` (one group) calls `createPractice(dossier.title, { custom: true, activate: true })` in place of `addWorkspaceTab` and passes the practice id as `targetTabId`)
- Modify: `apps/web/src/utils/findScope.ts`, `apps/web/src/hooks/useFindWindow.ts`, `apps/web/src/components/features/search/FindWindow.tsx` (PR 4d's files; flag on: spec §6.6–§6.7 — the scope from the practices, the front = the active practice, «Questa pratica» / «Tutte le pratiche», one `targetKey` per subject, a decision never read counts nothing; reaching an undrawn match = `setActivePractice` + reveal the row; recompute on practice switch, row open and close, practice content changes), and the text roots' registration in `ArticleTabContent` / `DecisionReadingSurface` only if PR 4d's `tabId` must be passed the practice id from the row (no change to a text root)
- Modify: `apps/web/src/components/features/compare/CompareView.tsx` (flag on: the practices' articles, labelled with the practice)
- Modify: `apps/web/src/components/features/search/ReadingBackControl.tsx` (flag on, the `table` half of spec §6.3: a popped `table` entry activates its practice and reveals the row; `onNavigated` gets the practice id. P3 rows push such entries, so the way back works from P3)
- Modify: `apps/web/src/store/useAppStore.ts` (flag on: `openDecisionTab(ref, …)` → `openDecision(ref, { beside: false })`, the decision's row revealed — P4 turns it to beside on the desktop; `openDecisionSearchTab` → a `decision-search` ref in the active practice's `beside`, drawn by `PracticeTopicSearches` until P4; `drainPendingDecision` once, gotcha 14; `focusArticleInTab` → reveal in the practice; `addNormaIndexToTab` → `addActIndexToPractice`)
- Test: `apps/web/src/components/features/practice/PracticeTable.test.tsx`, `apps/web/src/components/features/practice/PracticeBar.test.tsx`, `apps/web/src/components/features/practice/PracticePhoneView.test.tsx`, `apps/web/src/components/features/search/SearchPanel.practice.test.tsx` (new), the flag cases of PR 4d's `apps/web/src/utils/__tests__/findScope.test.ts` (or wherever 4d put it) and `useFindWindow.test.tsx`, `apps/web/src/components/features/compare/CompareView.test.tsx` (flag cases), `apps/web/src/components/features/search/ReadingBackControl.test.tsx` (flag cases), the dossier's open-all tests with the flag (`apps/web/src/components/features/dossier/`)

- [ ] **Step 1: Failing tests**: a one-article search lands in the active practice and opens its row, on the desktop and at 390 px; a decision from the palette, a massima or the address enters «Giurisprudenza» once and opens in place; a topic search from the palette shows in the band and a decision opened from it enters «Giurisprudenza»; a range opens the first row of a new act and leaves the others closed; a search with no practice creates one named after the act; «Apri tutto» of a dossier with two past groups creates **one** practice, active, holding the texts in force and both past texts as rows, and its decisions unread (no fetch); one group opened from `DossierListView` creates one practice and adds no decision; the bar switches the table, renames, creates «Nuova pratica», closes after confirming; «Chiudi tutte» then a reload shows no practice; the phone's header switches practices by chevrons; the migration notice shows once; the find window on «Questa pratica» finds a word in a closed row and, on «Tutte le pratiche», in another practice, and going there activates the practice and opens the row; a decision never read counts nothing; compare lists the practices' articles; a citation jump from a row, then the back control, reveals the row left; with the flag off, `SearchPanel`'s existing tests (`SearchPanel.*.test.tsx`) and the dossier's pass unchanged.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/components/features/practice src/components/features/search src/components/features/dossier src/components/features/compare`.
- [ ] **Step 3: Implement.** No change to `ArticleTabContent`'s rendering.
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice's table and the bar of practices, on the desktop and the phone, behind the flag`.

### Task 11: «Salva come dossier» and «Aggiungi a un dossier»

**Files:**
- Create: `apps/web/src/components/features/practice/practiceDossierItems.ts` (pure: `practiceDossierItems(practice): { norms: NormaVisitata[]; decisions: DossierSentenzaData[]; unidentified: number }` in table order, spec §7)
- Create: `apps/web/src/components/features/practice/useSavePracticeAsDossier.ts` (new dossier: `createDossier` → `addToDossier` each → one `setDossierItemOrder`; existing dossier: skip what `dossierContainsArticle` or the same decision identity finds; returns the counts for the toast)
- Modify: `apps/web/src/components/features/practice/PracticeTable.tsx`, `apps/web/src/components/features/practice/PracticeChip.tsx` (the actions; «Aggiungi a un dossier…» lists the dossiers as `AddToDossierPopover` does)
- Test: `apps/web/src/components/features/practice/practiceDossierItems.test.ts`, `apps/web/src/components/features/practice/useSavePracticeAsDossier.test.tsx`

- [ ] **Step 1: Failing tests**: items in table order, a past text kept with its version, two rows of one code article (search and index copies) saved as two items, decisions in `decisionOrder` with `sezione`, `tipo`, `data_deposito`, an unidentified decision (a migrated entry not read since included) counted not saved; a refused `createDossier` adds nothing and says so; the order is written once after the adds; into an existing dossier, duplicates skipped and counted; the toast wording («Salvato nel dossier «…»: 4 articoli, 2 sentenze»; «1 sentenza non identificata non è stata salvata»; «2 già presenti»).
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/components/features/practice/practiceDossierItems.test.ts src/components/features/practice/useSavePracticeAsDossier.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): «Salva come dossier» — the practice becomes a dossier in its order`.

**P3:** title «feat: the practice's table on the desktop and the phone (behind VITE_FEATURE_PRACTICE_TABLE)»; body: spec §3, §5, §6.3 (the `table` half), §6.4–§6.10, §7, §8 (P3 part); no change to the reading surfaces. Browser pass on the branch's own Vite (Global Constraints): first with the flag off, build the old workspace (spec «Verification»: two tabs, an act with three articles, an extracted article, a past text, a decision beside an article, two topic searches, a highlight and a note on an article and a decision, a forged collection); restart the same port with the flag on and reload, desktop: every article in its practice and act, the decision under «Giurisprudenza», the highlight and the note shown, the notice naming the topic search not reopened, the other in the band; a search, a range, «Apri l'indice e sfoglia» (and a pick of an article already there), a citation jump inside one act and to another act and the back control, «Apri tutto» from a dossier with a past group (one practice), Cmd/Ctrl+F on «Questa pratica» and «Tutte le pratiche», compare, «Salva come dossier» and the new dossier's page; the last row clear of the bar; reload; restart with the flag off and the old tabs are back. Phone (390 px), flag on: the same practices, rows opening in place, a decision from a massima opening in place, the index drawer, switching practices. Merge: `merge: feat/practice-table — the practice's table and the bar of practices, behind a flag`.

---

## P4 — `feat/reading-window` (apps/web)

Branch `feat/reading-window`. The windows are the desktop's; on a phone, «Apri accanto» is not drawn and a decision still opens in place until P5.

### Task 12: The row of windows, its layout, and the find window's place

**Files:**
- Create: `apps/web/src/components/features/practice/besideLayout.ts` (pure: `besideLayout(width: number, count: 0 | 1 | 2): { table: number | 'rail'; windows: number[] }`, spec §4.3: half and half; thirds when each gets 420 px; else a 48 px rail)
- Create: `apps/web/src/components/features/practice/ReadingRow.tsx` (the table and the windows side by side in the results area, widths from `besideLayout` and a `ResizeObserver` on the area; the rail opens the table as an overlay closed by Esc or a click outside; tells the find window its default place, spec §4.4)
- Create: `apps/web/src/components/features/practice/ReadingWindow.tsx` (spec §4.1: the shell — title, «Chiudi», scrolling body with the bottom padding of spec §3.4 — and the body by kind: `article`, `decision` (`DecisionEntryView` with `hostId` = the window id), `decision-search` (`DecisionSearchTabView` with `tabId` = the window id))
- Modify: `apps/web/src/utils/findWindowControl.ts` and `apps/web/src/components/features/search/FindWindow.tsx` (PR 4d's files: a default place a layout can set — `setFindWindowDefaultPlace(place | null)` — used when the user has not dragged the window this session; `null` = PR 4d's top right of the results area)
- Test: `apps/web/src/components/features/practice/besideLayout.test.ts`, `apps/web/src/components/features/practice/ReadingRow.test.tsx`, `apps/web/src/components/features/practice/ReadingWindow.test.tsx`, PR 4d's `FindWindow.test.tsx` (the default-place cases)

- [ ] **Step 1: Failing tests**: `besideLayout` at 1280, 1440 and 1920 px with zero, one and two windows; the rail below the thresholds; the row draws the practice's windows in order and only the active practice's; switching practice hides them and returning shows them; «Chiudi» removes one window and leaves the subject in the table; a decision window and a topic window render their views; the find window opens under the practice header at the table's top right with windows beside, at the first window's body with the rail, and never over a window's ×; a dragged place wins.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/components/features/practice src/components/features/search/FindWindow.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the light window and the row of two beside the practice`.

### Task 13: The article in a window

**Files:**
- Modify: `apps/web/src/components/features/search/ArticleTabContent.tsx` (prop `variant?: 'row' | 'beside'`, default `'row'` = today; `'beside'`: the toolbar compact, Brocardi in a closed section, no `onOpenStudyMode`, no Studia row, no `AskMerltEntry`, no `article_sidebar` slot; `article_content_after` kept)
- Modify: `apps/web/src/components/features/search/ReadingToolbar.tsx` (prop `compact`: notes, highlights, discussions, copy and the magnifier «Cerca nel testo» only, on the desktop row and the phone row)
- Test: `apps/web/src/components/features/search/__tests__/ArticleTabContent.beside.test.tsx` (new), `apps/web/src/components/features/search/ReadingToolbar.test.tsx` (compact cases), the existing `apps/web/src/components/features/search/__tests__/ArticleTabContent.*.test.tsx` unchanged

- [ ] **Step 1: Failing tests**: in `beside`, the toolbar shows exactly the five buttons and no «⋯»; the magnifier opens the find window on that text (PR 4d's `openFindWindow`); Brocardi and «Giurisprudenza» are closed; no Studio, Studia row, MERL-T entry or graph rail; **rule 23**: for each text of `apps/web/src/utils/__fixtures__/articleTexts.ts`, the text root's text nodes joined equal `article_text` without `\n`, with the find window open on that text (re-read `apps/web/src/utils/__fixtures__/openFind.ts` after PR 4d: if it still opens PR 4c's box, use whatever PR 4d's contract tests use to open the window); in `row`, everything as today.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/components/features/search/__tests__/ArticleTabContent.beside.test.tsx src/components/features/search/ReadingToolbar.test.tsx`.
- [ ] **Step 3: Implement**, branching on `variant` around the siblings of `ArticleBody` only.
- [ ] **Step 4: Run** the web suite, including `articleRender.test.ts` untouched; build; lint.
- [ ] **Step 5: Commit** — `feat(web): an article in a light window: its reading bar, its text, Brocardi and case law closed`.

### Task 14: «Apri accanto», decisions beside, citations from a window, the way back

**Files:**
- Modify: `apps/web/src/components/features/practice/PracticeArticleRow.tsx`, `apps/web/src/components/features/practice/PracticeDecisionsSection.tsx` («Apri accanto», drawn on the desktop only until P5; a row shown beside folds to «Aperto accanto · Chiudi la finestra» on the desktop only, spec T5)
- Delete: `apps/web/src/components/features/practice/PracticeTopicSearches.tsx` and its use in `PracticeTable.tsx` (topic searches become windows)
- Modify: `apps/web/src/hooks/useIsDesktop.ts` (export `isDesktopViewport()`, the same `DESKTOP_QUERY` read once, for store actions)
- Modify: `apps/web/src/store/useAppStore.ts` (flag on: `openDecisionTab` → `openDecision` beside on the desktop (`isDesktopViewport()`), with `besideTabId` as the asker when it names a window; on a phone, P3's in-place reveal stays until P5; `openDecisionSearchTab` → the window only)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (flag on, desktop: `ReadingRow` in place of the bare table; a search carrying `besideTabId` that names a window opens its first article beside that window, through `openBeside` with the asker, in place of `placeTabsSideBySide`)
- Modify: `apps/web/src/components/features/search/ReadingBackControl.tsx` (flag on, the `beside` half: a popped `beside` entry activates its practice and reopens the window)
- Modify: `apps/web/src/components/features/search/ArticleTabContent.tsx` only if the citation origin must say «beside»: the window passes `readingOrigin = { tabId: <window id>, blockId: actId }`, which `pushReadingBack` reads as a `beside` place (to confirm in Step 1 against `useCitationLinks`; no change to the text root either way)
- Test: `apps/web/src/components/features/practice/ReadingRow.beside.test.tsx` (new); Modify (add flag cases): `apps/web/src/components/features/search/SearchPanel.beside.test.tsx`, `apps/web/src/components/features/search/ReadingBackControl.test.tsx`

- [ ] **Step 1: Failing tests**: «Apri accanto» on a row opens the window and folds the row; a decision opened from a massima in an open row enters «Giurisprudenza» and opens beside; from an article in a window it keeps that window; a third window replaces the oldest other; a norm cited in a decision window enters its act and opens beside the decision; «‹ Torna a art. 2043 c.c.» after a jump from a window reopens the article beside; after a jump from a row it reveals the row; the Cronologia's reopen and the `/sentenze/…` address open beside once; a topic search opens a window; at 390 px no «Apri accanto» is drawn and a decision from a link opens in place.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/components/features/practice src/components/features/search/SearchPanel.beside.test.tsx src/components/features/search/ReadingBackControl.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): «Apri accanto»: articles and decisions read beside the practice, and the way back to them`.

**P4:** title «feat: the light window beside the practice (behind VITE_FEATURE_PRACTICE_TABLE)»; body: spec §4, §6.1–§6.3, §11 and its test. Browser pass on the branch's own Vite, flag on, desktop at 1280 and 1920 px: «Apri accanto» on an article, then a decision from its «Giurisprudenza», then a third subject (the oldest other goes, the asker stays); the rail at 1280 px with two windows; a topic search from the palette and a decision opened from it; a norm cited in the decision opens beside it; the back control both ways; a highlight and a note made in a window show in the row; Cmd/Ctrl+F with two windows beside (the find window clear of their ×) reaching a closed row, a window and an open row; `/sentenze/…` opened cold; switching practices and back; reload. Phone (390 px), flag on: P3's table, no «Apri accanto», decisions in place. Merge: `merge: feat/reading-window — articles and decisions read beside the practice, two at a time`.

---

## P5 — `feat/practice-phone` (apps/web)

Branch `feat/practice-phone`.

### Task 15: The phone: reading full screen, and the practice list

**Files:**
- Modify: `apps/web/src/store/useAppStore.ts` (session-only `phoneReader: { practiceId: string; ref: BesideRef } | null`, never persisted; `openPhoneReader(practiceId, ref)`, `closePhoneReader()`; flag on and phone: `openDecisionTab` adds the entry and sets `phoneReader` (never `beside`); `clearUserData` empties it)
- Create: `apps/web/src/components/features/practice/ReadingFullScreen.tsx` (header «‹ Pratica», 44 px, and the title; the body is `ReadingWindow`'s body for `phoneReader.ref`; «‹ Pratica» calls `closePhoneReader`)
- Modify: `apps/web/src/components/features/practice/PracticePhoneView.tsx` (a tap on the name lists the practices with «+ Nuova pratica»; `ReadingFullScreen` in place of the column while `phoneReader` is set, the column's scroll position saved when it opens and restored when it closes; the column is not kept mounted under it, gotcha 26)
- Modify: `apps/web/src/components/features/practice/PracticeArticleRow.tsx`, `apps/web/src/components/features/practice/PracticeDecisionsSection.tsx` («Apri accanto» drawn on the phone too, calling `openPhoneReader`; no fold on the phone)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (`ReadingBackControl`'s `onNavigated` selects the practice and, for a `beside` entry, opens the phone reader; closing the reader when the screen widens)
- Test: `apps/web/src/components/features/practice/ReadingFullScreen.test.tsx`; Modify (add cases): `apps/web/src/components/features/practice/PracticePhoneView.test.tsx`, `apps/web/src/components/features/search/SearchPanel.phone.test.tsx` (flag cases)

- [ ] **Step 1: Failing tests** (`matchMedia` at 390 px): the table is the main screen with «Giurisprudenza» at the bottom; «Apri accanto» shows the full-screen reader with «‹ Pratica», which returns to the table at the same scroll; a decision opened from a link opens full screen and leaves `beside` untouched; **a reload on a phone** (saved state with two windows in `beside`) lands on the table; **two windows on the desktop, then a phone width**: the table, no row folded; the list switches practices and creates one; the index drawer stays open across picks; no extracted article anywhere; with the flag off, the old phone tests pass unchanged.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/components/features/practice src/components/features/search/SearchPanel.phone.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `feat(web): the practice on the phone: articles and decisions full screen, and the practice list`.

**P5:** title «feat: reading full screen on the phone (behind VITE_FEATURE_PRACTICE_TABLE)»; body: spec §8, T19. Browser pass on the branch's own Vite, flag on, at 320, 360 and 390 px: the migrated workspace of P3's pass, rows opening in place, the index drawer, «Apri accanto» and «‹ Pratica» (back at the same scroll), a decision from a massima, the back control, switching practices from the list, Study Mode, a reload while the reader is open (the table); then desktop again at 1440 px: the same windows are beside the table (spec §5.4). Merge: `merge: feat/practice-phone — reading full screen on the phone, the practice list`.

---

## P6 — `refactor/retire-floating-tabs` (apps/web)

Branch `refactor/retire-floating-tabs`. After P5; before the deploy the owner asked for.

### Task 16: The flag goes; every browser migrates once

**Files:**
- Delete: `apps/web/src/features/practice/featureFlag.ts` (and the folder if nothing else is in it)
- Modify: `apps/web/src/store/useAppStore.ts` (persist `version: 1` and `migrate(saved, from)`: from 0, keep the sanitized `practices` when `practicesSeeded === true` (an empty list included), else `practicesFromTabs(saved.workspaceTabs)` with its notice; drop `workspaceTabs`, `highestZIndex` and `practicesSeeded`; the `merge` seeding goes; `partialize` without them)
- Modify: every `isPracticeTableEnabled()` call site (the new branch stays, the old one goes): `apps/web/src/components/features/search/SearchPanel.tsx`, `apps/web/src/components/features/dossier/DossierDetailView.tsx`, `apps/web/src/components/features/dossier/DossierListView.tsx`, `apps/web/src/utils/findScope.ts`, `apps/web/src/hooks/useFindWindow.ts`, `apps/web/src/components/features/search/FindWindow.tsx`, `apps/web/src/components/features/compare/CompareView.tsx`, `apps/web/src/components/features/search/ReadingBackControl.tsx`, the store (confirm the list with `grep -rn "isPracticeTableEnabled" apps/web/src`)
- Test: `apps/web/src/store/__tests__/practices.persist.test.ts` (the `migrate` cases, from the P1 fixtures saved as version 0)

- [ ] **Step 1: Failing tests**: a version-0 state with tabs and no marker migrates to practices (every case of Task 4 through `migrate`, the notice included); a version-0 state with `practices: []` and no marker (a flag-off browser) migrates from its tabs; a version-0 state with the marker keeps its practices, an empty list included, and ignores the tabs; the result holds no `workspaceTabs` and no marker; a garbage state yields no practice and no throw.
- [ ] **Step 2: Run to see them fail** — `npm --prefix apps/web run test -- --run src/store/__tests__/practices.persist.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; web build and lint.**
- [ ] **Step 5: Commit** — `refactor(web): the practice table is the workspace; saved tabs migrate once`.

### Task 17: The tab model goes

**Files:**
- Delete: `apps/web/src/components/features/workspace/WorkspaceManager.tsx`, `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx` and `apps/web/src/components/features/workspace/WorkspaceTabPanel.test.tsx`, `apps/web/src/components/features/workspace/NormaBlockComponent.tsx`, `apps/web/src/components/features/workspace/LooseArticleCard.tsx`, `apps/web/src/components/features/workspace/WorkspaceNavigator.tsx`, `apps/web/src/components/features/workspace/SortableWorkspaceTab.tsx`, `apps/web/src/components/features/workspace/renderTabView.tsx`, `apps/web/src/components/features/decisions/DecisionTabView.tsx` and `apps/web/src/components/features/decisions/DecisionTabView.test.tsx` (its other cases moved in Task 9); `apps/web/src/components/features/search/NormaCard.tsx` and `apps/web/src/components/features/workspace/ArticleMinimap.tsx` if nothing else imports them (check with `grep`)
- Modify: `apps/web/src/store/useAppStore.ts` (remove `WorkspaceTab`, `TabView`, `TabContent`, `NormaBlock`, `LooseArticle`, `workspaceTabs`, `highestZIndex` and every tab action: `addWorkspaceTab`, `addNormaToTab`, `addLooseArticleToTab`, `updateTab`, `removeTab`, `bringTabToFront`, `toggleTabMinimize`, `toggleTabVisibility`, `toggleNormaCollapse`, `setTabLabel`, `reorderWorkspaceTabs`, `arrangeWorkspaceTabs`, `closeAllWorkspaceTabs`, `moveNormaBetweenTabs`, `extractArticleFromNorma`, `moveLooseArticleBetweenTabs`, `removeArticleFromNorma`, `removeContentFromTab`, `mergeLooseArticleToNorma`, `consumeAutoFocusArticle`, `placeTabsSideBySide`, `setDecisionTabIdentity`, `refuseViewTab`, `newViewTab`, `placeSideBySide`, `fillFreeArea`, `freeArea`, `sanitizeViews`; `openDecisionTab` → `openDecision` and `openDecisionSearchTab` → a window, at every caller)
- Modify: `apps/web/src/utils/readingBackStack.ts` (the tab entry shape goes), `apps/web/src/hooks/useAnnexNavigation.ts` (`tabId` goes), `apps/web/src/utils/workspaceOrigin.ts` (`dragLimits` and `workspaceOrigin` go if unused — PR 4d's `FindWindow` uses `dragLimits`, so check; `WORKSPACE_AREA_ID` stays), `apps/web/src/utils/findScope.ts` and `apps/web/src/hooks/useFindWindow.ts` (the tab branches go)
- Modify: rename `besideTabId` → `besideId` in `apps/web/src/components/features/decisions/DecisionLink.tsx`, `apps/web/src/components/features/decisions/DecisionResultList.tsx`, `apps/web/src/components/features/decisions/DecisionSearchTabView.tsx`, `apps/web/src/components/features/decisions/DecisionReadingSurface.tsx` (it passes `besideTabId: hostTabId`), `apps/web/src/components/features/search/MassimeSection.tsx`, `apps/web/src/components/features/search/CaseLawSection.tsx`, `apps/web/src/components/features/search/BrocardiDisplay.tsx`, `apps/web/src/components/features/search/SearchPanel.tsx`, `apps/web/src/features/merlt/rassegne/RassegnePanel.tsx`, `apps/web/src/features/merlt/rassegne/RassegnaPassage.tsx`, `apps/web/src/features/merlt/rassegne/DecisionChip.tsx`, `apps/web/src/store/useAppStore.ts`, `apps/web/src/types/index.ts` (`SearchParams.besideTabId`); and `targetTabId` → `targetPracticeId` in `apps/web/src/types/index.ts`, `apps/web/src/components/features/search/SearchPanel.tsx`, `apps/web/src/components/features/dossier/dossierUtils.ts`, `apps/web/src/components/features/dossier/DossierDetailView.tsx`, `apps/web/src/components/features/dossier/DossierListView.tsx`, `apps/web/src/store/useAppStore.ts` (confirm both lists with `grep -rln`)
- Test: the store tests rewritten over practices (`apps/web/src/store/__tests__/decisionTabs.test.ts` → `practices.decisions.test.ts`, `apps/web/src/store/__tests__/useAppStore.workspaceTabs.test.ts` and `apps/web/src/store/__tests__/useAppStore.readingNavigation.test.ts` folded into the practice tests), every test importing a deleted file

- [ ] **Step 1:** `grep -rn` for each removed name lists its callers; every one is moved or deleted.
- [ ] **Step 2:** Remove; rename; move the tests.
- [ ] **Step 3:** Web tests, build, lint; `grep -rn "workspaceTabs\|WorkspaceTab\b\|besideTabId\|targetTabId\|loose-article" apps/web/src` is empty.
- [ ] **Step 4: Commit** — `refactor(web): the floating tabs, their dock and their actions go`.

### Task 18: Tours and the web guide

**Files:**
- Modify: `apps/web/src/config/tourConfig.ts` (the workspace and block tours re-anchored on the practice table, the act block, its index line and Studio / Struttura; the dock step on the bar), and the components that start them (`useTour` in `PracticeTable` and `PracticeActBlock`)
- Modify: `apps/web/CLAUDE.md` (Frontend State: practices UI-only, saved in the browser, the wrapped storage; Reading surface: «The index is a window, the text is not» kept, the light window and `variant="beside"`, the find window over practices; «Going back» with practice entries; «Decisions in the workspace» rewritten as «The practice»; the dossier's «Apri tutto»; the `features/workspace/` and new `features/practice/` file lists; gotchas 12, 15 and 26 brought up to date; `utils/practice.ts` among the shared utilities)
- Modify: `docs/superpowers/specs/2026-10-08-norm-tab-container-design.md` (a «Built» note at the top with the PR numbers) and this plan («Amendments during execution»)
- Test: the tour test if one exists for these steps (`grep -rn "workspaceTab\|normaBlock" apps/web/src --include='*.test.*'`)

- [ ] **Step 1:** Update the tours; run the web suite.
- [ ] **Step 2:** Update the guide, the spec note and the amendments.
- [ ] **Step 3:** Web tests, build, lint.
- [ ] **Step 4: Commit** — `docs(web): the practice table in the web guide, the tours re-anchored`.

**P6:** title «refactor: the practice table replaces the floating tabs»; body: the flag removed, the one-time migration (persist version 1), the deleted files and actions, the renames, spec §9. Browser pass on the branch's own Vite with no flag: a browser origin that saved a workspace on `develop` before P6 (the P3 fixture workspace, built with the flag off on that same port) loads it as practices — every article, decision, highlight and note present, the notice shown once; desktop at 1280 and 1920 px and phone at 360 and 390 px; the tours; `/sentenze/…` cold; a dossier's «Apri tutto»; «Salva come dossier»; logout and login as another test account shows no practice. Merge: `merge: refactor/retire-floating-tabs — the practice table replaces the floating tabs`.

Then: the owner's trial on the development stack, and the deploy on the deployment host he asked for once the whole redesign is merged.

## Amendments during execution

(None yet.)
