# The dossier grouped by act — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dossier's detail page around the act — each act named once, its articles beneath it with their rubrica — with a three-button header, a PDF that carries every text, and room for decisions, attached notes, Claude's mark and the trash.

**Architecture:** A pure layout module turns `dossier.items` into sections (notes, act blocks, decisions); small components render a block and an article row; the existing reader (`DossierItemReader`) is reused untouched in its text path. The server names each act (`act_citation`, merged in #66) and the Python API gives each act's title next to its rubriche, so one cached call per act decorates a block.

**Tech Stack:** React 19 + TypeScript + Tailwind v4, Zustand + Immer, `@dnd-kit`, Vitest + Testing Library (web); Express + Prisma + Vitest (server); Quart + pytest (Python).

**Spec:** `docs/superpowers/specs/2026-10-04-dossier-per-atto-design.md` (approved by the owner, 4 Oct 2026: «sì confermo la decizione»). Read it before any task: it argues every decision this plan implements.

## Global Constraints

- UI copy in Italian; code, comments, commits and docs in English (root `CLAUDE.md`).
- Root rule 23: no change to `article_text`, its rendering (`utils/articleRender.ts`, `useArticleMarkers`) or the offsets of highlights and notes. The redesign groups and re-arranges rows only.
- Citations are never formatted in the web for the act heading: the heading of an ordinary act is the server's `act_citation`; codes and the Constitution are named from the table in `dossierLayout.ts`.
- `buildItemKey` stays byte-identical (annotations are keyed on it); anything that groups or compares items by article adds `versionKey` (gotcha 32).
- Every create/update/delete round-trips the server (gotcha 17); no silent `.catch(() => …)` (gotcha 18).
- Interactive controls keep a 44px touch target on mobile; collapsibles follow the `role="button"` rules of `apps/web/CLAUDE.md` (UI Conventions).
- Destructive actions use `ConfirmDialog variant="danger"` or an undo toast (`showUndoToast`), never `window.confirm`.
- Stacking through `constants/zIndex.ts`, never a bare z-index literal.
- Note cap: 4,000 characters (MCP second round, S11).
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch from `origin/develop` in a worktree; never switch branches in the main checkout.
- The shared server test DB: ask the orchestrator (`visualexapi-08`) before every `npm --prefix apps/server test`. Python tests and web tests need no permission.
- The shared dev stack (5173/3001/5000) is not restarted; a browser pass runs the branch's web on its own port (`npm --prefix apps/web run dev -- --port 5180`) against the shared backend, with a test account created for it and deleted at the end.
- The Python venv is not in a worktree: run pytest with the main checkout's interpreter, `PY=~/Desktop/CODE/VisuaLexAPI/services/visualex/.venv/bin/python`, from the worktree's `services/visualex`.

## Pull requests and order

| PR | Branch | Tasks | Depends on |
|---|---|---|---|
| 1 | `feat/dossier-act-data` | 1–2 | — |
| 2 | `feat/dossier-by-act` | 3–13 | PR 1 merged (Task 6 reads `title`) |
| 3 | `feat/dossier-decisions` | 14 | Sentenze PR C merged |
| 4 | `feat/dossier-attached-notes` | 15 | MCP second round's notes route and `about_item_id`/`created_by` merged |
| 5 | `feat/dossier-trash` | 16 | MCP second round's trash routes merged |

The orchestrator gives the go before PR 2's first commit. PRs 3–5 start only when their dependency is in `develop`; before starting one, re-read the dependency's merged code and amend the task here if a name or a shape differs (as the Sentenze plan did after its PR A).

## Review Focus

1. **An item without `act_citation`** (added a moment ago and not yet answered, or hydrated from an older server): it must land in its act's block by identity, and a new act's block must show the muted fallback heading, never an empty one. Pinned in Task 4 (`layoutDossier` fallback) and Task 3 (the add path sets the field from the answer).
2. **An act in parts whose tree has no `annexes` metadata, or whose annex matches no part** (d.lgs. 196/2003 is the measured case): no rubrica at all, never the top-level map. Pinned in Task 5 with the 196/2003 shape, and in the index window's own test.
3. **The same act saved two ways** — the codice civile with and without its R.D. number and date, `tipo_atto` in different case («Codice civile» / «codice civile»): one block. Pinned in Task 4.
4. **Dragging an act while another act's article is still pending** (temp id): the reorder must not send a temp id to the server. Pinned in Task 9 (`setDossierItemOrder` skips the server call while any id is pending, and replays once settled — same rule as the star).
5. **The PDF with a text that cannot be fetched or may not be exported** (a past text outside its window, a source down): the PDF still downloads, the article shows why its text is missing, and the toast counts the misses. Pinned in Task 12.

---

## PR 1 — the act's data (`feat/dossier-act-data`)

### Task 1: The add-item answer carries the citations

**Files:**
- Modify: `apps/server/src/controllers/dossierController.ts` (`addDossierItem`, the `res.status(201).json({...})` block)
- Modify: `apps/server/tests/norms/dossierNorms.test.ts` (next to «gives a note no citation»)
- Modify: `apps/server/CLAUDE.md` (the `norms/citation.ts` bullet)

**Interfaces:**
- Consumes: `citeStoredNorm`, `citeStoredAct` from `apps/server/src/norms/citation.ts` (#66).
- Produces: `POST /api/dossiers/:id/items` answers `citation: string | null` and `act_citation: string | null`, like `GET /dossiers/:id`.

- [ ] **Step 1: Write the failing test** — append inside the `describe` that holds «gives a note no citation»:

```ts
  it('answers an added item with its citations, so the web names the act at once', async () => {
    const norm = await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send({
      itemType: 'norm', title: 'legge',
      content: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3' },
    });
    expect(norm.status).toBe(201);
    expect(norm.body.citation).toBe('art. 3, l. 31 dicembre 2012, n. 247');
    expect(norm.body.act_citation).toBe('l. 31 dicembre 2012, n. 247');

    const note = await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send({
      itemType: 'note', title: 'Nota', content: 'appunto',
    });
    expect(note.body.citation).toBeNull();
    expect(note.body.act_citation).toBeNull();
  });
```

- [ ] **Step 2: Ask the orchestrator for the test DB, then run it to verify it fails**

Run: `npm --prefix apps/server test -- tests/norms/dossierNorms.test.ts`
Expected: FAIL — `expected undefined to be 'art. 3, …'`.

- [ ] **Step 3: Implement** — in `addDossierItem`, the answer becomes:

```ts
  res.status(201).json({
    id: item.id,
    item_type: item.itemType,
    title: item.title,
    // The same names as GET /dossiers/:id, so the web heads a new act's block at once.
    citation: citeStoredNorm(item.itemType, item.content),
    act_citation: citeStoredAct(item.itemType, item.content),
    content: item.content,
    position: item.position,
    status: item.status,
    created_at: item.createdAt,
  });
```

- [ ] **Step 4: Run it to verify it passes** (same command, still inside the DB window). Expected: PASS. Then `npm --prefix apps/server run build` — no output past `tsc`.

- [ ] **Step 5: Document** — in `apps/server/CLAUDE.md`, the sentence «Dossier items carry it as `citation` (null for anything but a norm) in `GET /dossiers` and `GET /dossiers/:id`» becomes «… in `GET /dossiers`, `GET /dossiers/:id` and the answer of `POST /dossiers/:id/items`».

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/controllers/dossierController.ts apps/server/tests/norms/dossierNorms.test.ts apps/server/CLAUDE.md
git commit -m "feat(server): an added dossier item is answered with its citations"
```

### Task 2: `/fetch_rubriche` gives the act's title, made presentable

**Files:**
- Modify: `services/visualex/visualex_api/services/akn_parser.py` (new `presentable_title`, next to `_restore_accents`)
- Modify: `services/visualex/app.py` (`fetch_rubriche`: every `jsonify` gets `title`)
- Modify: `services/visualex/tests/test_akn_parser.py` (new class)
- Create: `services/visualex/tests/test_fetch_rubriche.py`
- Modify: `services/visualex/CLAUDE.md` (where `/fetch_rubriche` is described; add one line)

**Interfaces:**
- Produces: `presentable_title(raw: str | None) -> str`; `/fetch_rubriche` answers `title: str` on every path (`''` when there is none: EUR-Lex, no AKN index, error).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_akn_parser.py` (add `presentable_title` to its `from visualex_api.services.akn_parser import …` line):

```python
class TestPresentableTitle:
    """The act's title as a heading. The raw strings are the AKN `docTitle`s read live on 4 Oct 2026."""

    def test_the_gazzetta_code_goes(self):
        raw = "Nuova disciplina dell'ordinamento della professione forense. (13G00018)"
        assert presentable_title(raw) == "Nuova disciplina dell'ordinamento della professione forense"

    def test_another_act_of_the_same_shape(self):
        raw = "Disposizioni in materia di equo compenso delle prestazioni professionali. (23G00051)"
        assert presentable_title(raw) == "Disposizioni in materia di equo compenso delle prestazioni professionali"

    def test_amendment_brackets_are_unwrapped_and_accents_restored(self):
        raw = ("Codice in materia di protezione dei dati personali ((, recante disposizioni per "
               "l'adeguamento dell'ordinamento nazionale al regolamento (UE) n. 2016/679 del Parlamento "
               "europeo e del Consiglio, del 27 aprile 2016, relativo alla protezione delle persone "
               "fisiche con riguardo al trattamento dei dati personali, nonche' alla libera "
               "circolazione di tali dati e che abroga la direttiva 95/46/CE)).")
        assert presentable_title(raw) == (
            "Codice in materia di protezione dei dati personali, recante disposizioni per "
            "l'adeguamento dell'ordinamento nazionale al regolamento (UE) n. 2016/679 del Parlamento "
            "europeo e del Consiglio, del 27 aprile 2016, relativo alla protezione delle persone "
            "fisiche con riguardo al trattamento dei dati personali, nonché alla libera "
            "circolazione di tali dati e che abroga la direttiva 95/46/CE")

    def test_an_elision_is_not_an_accent(self):
        assert presentable_title("Norme sull'attivita' dell'ente.") == "Norme sull'attività dell'ente"

    def test_nothing_gives_nothing(self):
        assert presentable_title(None) == ""
        assert presentable_title("   ") == ""
        assert presentable_title("(13G00018)") == ""
```

Create `tests/test_fetch_rubriche.py`:

```python
"""`POST /fetch_rubriche` gives the act's title with its rubriche: one call decorates a dossier's act block."""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.akn_fetch import AktIndex

ACT_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2012-12-31;247"


@pytest.fixture
def client():
    return NormaController().app.test_client()


async def test_the_title_comes_with_the_rubriche(client):
    index = AktIndex(
        title="Nuova disciplina dell'ordinamento della professione forense. (13G00018)",
        keys=["1"], rubriche={"1": "Disciplina dell'ordinamento forense"},
    )
    with patch("app.fetch_act_index", AsyncMock(return_value=index)):
        response = await client.post("/fetch_rubriche", json={"urn": ACT_URL + "~art1"})
    body = await response.get_json()
    assert response.status_code == 200
    assert body["title"] == "Nuova disciplina dell'ordinamento della professione forense"
    assert body["rubriche"] == {"1": "Disciplina dell'ordinamento forense"}


async def test_no_index_no_title(client):
    with patch("app.fetch_act_index", AsyncMock(return_value=None)):
        response = await client.post("/fetch_rubriche", json={"urn": ACT_URL})
    assert (await response.get_json())["title"] == ""


async def test_a_failure_answers_no_title(client):
    with patch("app.fetch_act_index", AsyncMock(side_effect=RuntimeError("boom"))):
        response = await client.post("/fetch_rubriche", json={"urn": ACT_URL})
    body = await response.get_json()
    assert response.status_code == 200
    assert body["title"] == ""
```

- [ ] **Step 2: Run them to verify they fail**

Run: `(cd services/visualex && $PY -m pytest tests/test_akn_parser.py::TestPresentableTitle tests/test_fetch_rubriche.py -q)`
Expected: FAIL — `ImportError: cannot import name 'presentable_title'`.

- [ ] **Step 3: Implement** — in `akn_parser.py`, after `_restore_accents`:

```python
# "… professione forense. (13G00018)": the Gazzetta's code for the act, which a
# heading does not need.
_GAZZETTA_CODE = re.compile(r"\s*\.?\s*\(\d{2}[A-Z]\d{5}\)\s*$")


def presentable_title(raw: str | None) -> str:
    """An act's AKN title as a heading (the dossier names each act once, with it).

    Three repairs, each measured on Normattiva's export: the Gazzetta code at the
    end goes; the amendment brackets "((…))" are unwrapped and the space they
    leave before a comma closed up; transliterated accents are restored as in a
    rubrica ("nonche'" → "nonché"). The final full stop goes too. Never used on
    article text (root rule 23).
    """
    if not raw:
        return ""
    text = " ".join(raw.split())
    text = _GAZZETTA_CODE.sub("", text)
    text = text.replace("((", " ").replace("))", " ")
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    text = " ".join(text.split()).rstrip(".").strip()
    return _restore_accents(text)
```

In `app.py`, import it next to `fetch_act_index`'s neighbours (`from visualex_api.services.akn_parser import presentable_title`) and give every answer of `fetch_rubriche` a `title`:
- the EUR-Lex branch: `'title': '',`
- the no-index branch: `return jsonify({'title': '', 'rubriche': {}, 'abrogati': [], 'parts': [], 'count': 0})`
- the served branch: `'title': presentable_title(index.title),` first in the dict
- the `except` branch: `return jsonify({'title': '', 'rubriche': {}, 'abrogati': [], 'parts': [], 'count': 0, 'error': str(e)})`

- [ ] **Step 4: Run them to verify they pass**, then the whole Python suite:

Run: `(cd services/visualex && $PY -m pytest tests/ -q)`
Expected: all pass.

- [ ] **Step 5: Document** — `services/visualex/CLAUDE.md`, where `/fetch_rubriche` is listed: «answers the act's `title` too (`presentable_title`: no Gazzetta code, no amendment brackets, accents restored), so the dossier names an act with one call».

- [ ] **Step 6: Commit**

```bash
git add services/visualex/visualex_api/services/akn_parser.py services/visualex/app.py services/visualex/tests/test_akn_parser.py services/visualex/tests/test_fetch_rubriche.py services/visualex/CLAUDE.md
git commit -m "feat(api): /fetch_rubriche gives the act's title, made presentable"
```

**PR 1:** push, open the PR into `develop` (title «feat: the act's citation on added items and its title with the rubriche»), merge with `merge: feat/dossier-act-data — …` once CI is green and the task reviews are clean.

---

## PR 2 — the dossier by act (`feat/dossier-by-act`)

Ask the orchestrator for the go before the first commit of this PR.

### Amendments during execution (4 Oct 2026)

What the code ended up with where it differs from the tasks below; later tasks
(14–16) build on these names.

- **Task 1** landed through #70 (`feat/mcp-notes`), whose shared `serializeItem`
  answers every item route with `citation` and `act_citation`; PR 1 kept only
  the test.
- **Task 2**: `presentable_title` also drops the older Gazzetta code
  («(030U1398)»), closes a space before «)» and keeps the full stop of a final
  abbreviation («c.p.c.»).
- **Task 4**: `compareArticles` puts the text in force before past texts with
  `requestIsHistorical` (the plan's `versionKey` order put «originale» first),
  reads «2bis» as «2-bis» and sub-numbers numerically. `dossierItemOrder(items,
  layout, actKeys)` takes the items too and appends any item no act names: the
  saved order always names every item (Task 14 relies on it for decisions).
  An annexed article folds as «All. A art. 1».
- **Task 5**: on a tie between parts, the part of the annex's size wins; still
  tied, none (the server lists the code body before the Dispositivo, and both
  hold arts. 1–3). `abrogatiFor` follows the same rule.
- **Task 6**: the URN from `resolveAct` drops its probed article; the previous
  act's title and rubriche clear when the act changes.
- **Task 7**: Enter and Space are the trigger's own click (handling them on
  keydown too opened and closed the menu at once).
- **Task 9**: `restoreDossierItem` marks the restored item pending too, and
  `flushDossierOrder(dossierId)` saves a waiting order once no item is pending.
- **Task 10**: `TreeNavigatorModal` stores the act as the source resolved it
  (the day as typed, «31-12-2012», made one act two blocks). «Seleziona tutti»
  takes the articles on screen only (notes have no checkbox).
- **Task 12**: `dossierItemPdfTitle` is gone; the PDF's headings come from
  `buildPdfBlocks`. Task 14 adds a `decisions` block there instead of the
  Sentenze plan's `dossierItemPdfTitle` changes.

### Task 3: Items carry the server's citations

**Files:**
- Modify: `apps/web/src/types/index.ts` (`DossierItemBase`)
- Modify: `apps/web/src/services/dossierService.ts` (`DossierItemApi`)
- Modify: `apps/web/src/components/features/dossier/dossierUtils.ts` (new `dossierItemFromApi`, `citationsFromApi`)
- Modify: `apps/web/src/store/useAppStore.ts` (hydration in `fetchUserData`; `addToDossier`, `restoreDossierItem`, `importDossier` read the answer)
- Test: `apps/web/src/components/features/dossier/dossierUtils.test.ts`, `apps/web/src/store/dossierActions.test.ts`

**Interfaces:**
- Produces:
  - `DossierItemBase.citation?: string | null`, `DossierItemBase.actCitation?: string | null`;
  - `DossierItemApi.citation?: string | null`, `DossierItemApi.act_citation?: string | null`;
  - `citationsFromApi(api: Pick<DossierItemApi, 'citation' | 'act_citation'>): { citation?: string | null; actCitation?: string | null }`;
  - `dossierItemFromApi(api: DossierItemApi): DossierItem`.

- [ ] **Step 1: Write the failing tests**

Append to `dossierUtils.test.ts` (import `dossierItemFromApi`):

```ts
describe('dossierItemFromApi', () => {
  const base = { title: 'x', position: 0, status: 'unread' as const, created_at: '2026-10-04T10:00:00Z' };
  it('keeps the server\'s citations on a norm', () => {
    const item = dossierItemFromApi({
      ...base, id: 'a', item_type: 'norm',
      content: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3', _dossierMeta: { important: true } },
      citation: 'art. 3, l. 31 dicembre 2012, n. 247', act_citation: 'l. 31 dicembre 2012, n. 247',
    });
    expect(item).toMatchObject({
      id: 'a', type: 'norma', status: 'important', addedAt: base.created_at,
      citation: 'art. 3, l. 31 dicembre 2012, n. 247', actCitation: 'l. 31 dicembre 2012, n. 247',
    });
    expect(item.data).not.toHaveProperty('_dossierMeta');
  });
  it('reads a note, and an answer from a server without the fields', () => {
    const note = dossierItemFromApi({ ...base, id: 'n', item_type: 'note', content: 'appunto' });
    expect(note).toEqual({ id: 'n', type: 'note', data: 'appunto', addedAt: base.created_at });
  });
});
```

Append to `store/dossierActions.test.ts`:

```ts
describe('addToDossier reads the citations of the answer', () => {
  it('puts act_citation on the settled item', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '2026-10-04', items: [], tags: [] }] });
    vi.mocked(dossierService.addItem).mockResolvedValueOnce({
      ...fakeDossierItemApi('srv-9'),
      citation: 'art. 2043 c.c.', act_citation: 'c.c.',
    });
    appStore.getState().addToDossier('d1', norma, 'norma');
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items[0].id).toBe('srv-9'));
    expect(appStore.getState().dossiers[0].items[0]).toMatchObject({ citation: 'art. 2043 c.c.', actCitation: 'c.c.' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/web run test -- --run dossierUtils dossierActions`
Expected: FAIL — `dossierItemFromApi is not a function`, and `actCitation` undefined.

- [ ] **Step 3: Implement**

`types/index.ts`, `DossierItemBase`:

```ts
interface DossierItemBase {
    id: string;
    addedAt: string;
    status?: 'unread' | 'reading' | 'important' | 'done';
    // How the server names the item and its act (`citation`, `act_citation`), in the
    // app's citation style; null for anything but a norm, absent before the server answered.
    citation?: string | null;
    actCitation?: string | null;
}
```

`dossierService.ts`, `DossierItemApi`: add `citation?: string | null;` and `act_citation?: string | null;` after `title`.

`dossierUtils.ts` (import `DossierItemApi` as a type from `../../../services/dossierService`, `DossierNormaData` from types):

```ts
// The server's names for an item, copied only when it gave them: an answer from
// an older server leaves the fields absent, and the layout falls back.
export function citationsFromApi(api: Pick<DossierItemApi, 'citation' | 'act_citation'>): { citation?: string | null; actCitation?: string | null } {
  return {
    ...(api.citation !== undefined ? { citation: api.citation } : {}),
    ...(api.act_citation !== undefined ? { actCitation: api.act_citation } : {}),
  };
}

// One server item as the store holds it. The star travels inside `content` as a
// _dossierMeta envelope (packItemContent); the DB `status` column is not read.
export function dossierItemFromApi(api: DossierItemApi): DossierItem {
  const { data, status } = unpackItemContent(api.content);
  const base = { id: api.id, addedAt: api.created_at, ...(status ? { status } : {}), ...citationsFromApi(api) };
  return api.item_type === 'norm'
    ? { ...base, type: 'norma', data: data as DossierNormaData }
    : { ...base, type: 'note', data: data as string };
}
```

`useAppStore.ts`:
- `fetchUserData`: `items: d.items.map(dossierItemFromApi),` replaces the inline mapping (keep its comment's substance on `dossierItemFromApi`).
- `addToDossier`, inside the `.then(created => set(...))`: after `item.id = created.id;` add `Object.assign(item, citationsFromApi(created));`.
- `restoreDossierItem`, same place: `if (restored) { restored.id = created.id; Object.assign(restored, citationsFromApi(created)); }`.
- `importDossier`, the `.map((r) => ({ ...r.value.original, id: …, addedAt: …, ...citationsFromApi(r.value.serverItem) }))`.

- [ ] **Step 4: Run them to verify they pass** (same command). Then `npm --prefix apps/web run build`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/services/dossierService.ts apps/web/src/components/features/dossier/dossierUtils.ts apps/web/src/components/features/dossier/dossierUtils.test.ts apps/web/src/store/useAppStore.ts apps/web/src/store/dossierActions.test.ts
git commit -m "feat(web): dossier items carry the server's citations"
```

### Task 4: The layout — sections and act blocks

**Files:**
- Create: `apps/web/src/components/features/dossier/dossierLayout.ts`
- Test: `apps/web/src/components/features/dossier/dossierLayout.test.ts`

**Interfaces:**
- Consumes: `computeNormaGroups`, `NormaGroup` (`dossierUtils.ts`); `versionKey` (`utils/versionDisplay.ts`); `normalizeArticleId` (`utils/treeUtils.ts`); `DossierItem` with `actCitation` (Task 3).
- Produces:

```ts
export interface ActBlock {
  key: string;
  heading: string;          // a code's name, the server's act_citation, or the fallback
  headingIsFallback: boolean;
  isCode: boolean;          // codes and the Constitution: no title line
  articles: Extract<DossierItem, { type: 'norma' }>[];
  groups: NormaGroup[];
}
export interface DossierLayout { notes: DossierItem[]; acts: ActBlock[]; }
export function actKeyOf(norma: { tipo_atto: string; numero_atto?: string; data?: string }): string;
export function codeName(tipoAtto: string): string | null;
export function compareArticles(a: NormaVisitata, b: NormaVisitata): number;
export function layoutDossier(items: DossierItem[]): DossierLayout;
export function articleLabel(norma: NormaVisitata): string;   // "art. 3", "All. A, art. 1"
export function foldedArticleList(block: ActBlock): string;   // "artt. 1, 3, 25" / "art. 3"
export function dossierItemOrder(layout: DossierLayout, actKeys: string[]): string[]; // ids, for a drag
```

Decisions (`DossierLayout.decisions`) and attached notes (`attached`) are added by Tasks 14 and 15; nothing here reads them.

- [ ] **Step 1: Write the failing tests** — `dossierLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DossierItem, NormaVisitata } from '../../../types';
import { actKeyOf, articleLabel, codeName, compareArticles, dossierItemOrder, foldedArticleList, layoutDossier } from './dossierLayout';

let n = 0;
function art(data: Partial<NormaVisitata> & { numero_articolo: string }, actCitation?: string | null): DossierItem {
  n += 1;
  return {
    id: `i${n}`, type: 'norma', addedAt: '2026-10-04',
    data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', ...data },
    ...(actCitation !== undefined ? { actCitation } : {}),
  };
}
const L247 = 'l. 31 dicembre 2012, n. 247';
const L49 = 'l. 21 aprile 2023, n. 49';
const note = (text: string): DossierItem => ({ id: `n-${text}`, type: 'note', data: text, addedAt: '2026-10-04' });

describe('layoutDossier', () => {
  it('names each act once, in the order the acts entered the dossier', () => {
    const items = [
      art({ numero_articolo: '3' }, L247),
      art({ numero_atto: '49', data: '2023-04-21', numero_articolo: '1' }, L49),
      art({ numero_articolo: '1' }, L247),
    ];
    const { acts } = layoutDossier(items);
    expect(acts.map((a) => a.heading)).toEqual([L247, L49]);
    expect(acts[0].articles.map((i) => (i.data as NormaVisitata).numero_articolo)).toEqual(['1', '3']);
  });

  it('keeps a past text and an annexed article in their act\'s block, apart in its groups', () => {
    const items = [
      art({ numero_articolo: '3' }, L247),
      art({ numero_articolo: '3', versione: 'originale', data_versione: '2013-01-01' }, L247),
      art({ numero_articolo: '1', allegato: 'A' }, L247),
    ];
    const [block] = layoutDossier(items).acts;
    expect(block.articles).toHaveLength(3);
    expect(block.groups).toHaveLength(3);
    expect(block.articles.map((i) => articleLabel(i.data as NormaVisitata))).toEqual(['art. 3', 'art. 3', 'All. A, art. 1']);
  });

  it('is one block for a code saved with and without its decree, in any case', () => {
    const items = [
      art({ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' }, 'c.c.'),
      art({ tipo_atto: 'Codice civile', numero_atto: undefined, data: undefined, numero_articolo: '1218' }, 'c.c.'),
      art({ tipo_atto: 'preleggi', numero_atto: '262', data: '1942-03-16', numero_articolo: '12' }, 'preleggi'),
    ];
    const { acts } = layoutDossier(items);
    expect(acts.map((a) => [a.heading, a.isCode, a.articles.length])).toEqual([
      ['Codice civile', true, 2], ['Preleggi', true, 1],
    ]);
  });

  it('heads an act the server has not named yet with a muted fallback, never an empty heading', () => {
    const [block] = layoutDossier([art({ numero_articolo: '3' })]).acts;
    expect(block).toMatchObject({ heading: 'legge n. 247', headingIsFallback: true });
    const [named] = layoutDossier([art({ numero_articolo: '3' }), art({ numero_articolo: '4' }, L247)]).acts;
    expect(named).toMatchObject({ heading: L247, headingIsFallback: false });
  });

  it('puts the notes first, in their order', () => {
    const { notes, acts } = layoutDossier([art({ numero_articolo: '3' }, L247), note('b'), note('a')]);
    expect(notes.map((i) => i.data)).toEqual(['b', 'a']);
    expect(acts).toHaveLength(1);
  });
});

describe('compareArticles', () => {
  const nv = (numero_articolo: string, more: Partial<NormaVisitata> = {}): NormaVisitata =>
    ({ tipo_atto: 'legge', data: '2012-12-31', numero_articolo, ...more });
  it('orders the body before the annexes, then by number and ordinal', () => {
    const sorted = [nv('10'), nv('2-bis'), nv('1', { allegato: 'A' }), nv('2'), nv('2 ter'), nv('25-terdecies'), nv('25-ter')]
      .sort(compareArticles).map(articleLabel);
    expect(sorted).toEqual(['art. 2', 'art. 2-bis', 'art. 2 ter', 'art. 10', 'art. 25-ter', 'art. 25-terdecies', 'All. A, art. 1']);
  });
  it('puts the text in force before past texts, past texts by date', () => {
    const sorted = [
      nv('3', { versione: 'originale', data_versione: '2015-01-01' }),
      nv('3'),
      nv('3', { versione: 'originale', data_versione: '2013-01-01' }),
    ].sort(compareArticles).map((x) => x.data_versione ?? '');
    expect(sorted).toEqual(['', '2013-01-01', '2015-01-01']);
  });
});

describe('the smaller helpers', () => {
  it('names the codes and the Constitution', () => {
    expect(codeName('Costituzione')).toBe('Costituzione');
    expect(codeName('codice di procedura civile')).toBe('Codice di procedura civile');
    expect(codeName('legge')).toBeNull();
  });
  it('keys an act by identity, a code by name', () => {
    expect(actKeyOf({ tipo_atto: 'Legge', numero_atto: '247', data: '2012-12-31' })).toBe('legge|247|2012-12-31');
    expect(actKeyOf({ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16' })).toBe('codice civile');
  });
  it('folds a block into its numbers', () => {
    const { acts } = layoutDossier([art({ numero_articolo: '3' }, L247), art({ numero_articolo: '1' }, L247)]);
    expect(foldedArticleList(acts[0])).toBe('artt. 1, 3');
  });
  it('gives the order a drag of the acts saves: notes, then the acts in the new order', () => {
    const a = art({ numero_articolo: '3' }, L247);
    const b = art({ numero_atto: '49', data: '2023-04-21', numero_articolo: '1' }, L49);
    const c = note('x');
    const layout = layoutDossier([a, b, c]);
    expect(dossierItemOrder(layout, [layout.acts[1].key, layout.acts[0].key])).toEqual([c.id, b.id, a.id]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/web run test -- --run dossierLayout`
Expected: FAIL — cannot resolve `./dossierLayout`.

- [ ] **Step 3: Implement** — `dossierLayout.ts`:

```ts
import type { DossierItem, NormaVisitata } from '../../../types';
import { normalizeArticleId } from '../../../utils/treeUtils';
import { versionKey } from '../../../utils/versionDisplay';
import { computeNormaGroups, type NormaGroup } from './dossierUtils';

/**
 * The dossier page as sections: notes first, then one block per act (its articles
 * beneath it), in the order the acts entered the dossier. Pure: the components
 * only render what this returns. Spec §2.
 */

type NormaItem = Extract<DossierItem, { type: 'norma' }>;

export interface ActBlock {
  key: string;
  heading: string;
  headingIsFallback: boolean;
  isCode: boolean;
  articles: NormaItem[];
  groups: NormaGroup[];
}

export interface DossierLayout {
  notes: DossierItem[];
  acts: ActBlock[];
}

// Codes and the Constitution are named, not cited by decree: their heading is
// the name, and they are one act whatever number and date an item carries.
// Keys are lower case, as `tipo_atto` arrives in either case.
const CODE_NAMES: Record<string, string> = {
  'codice civile': 'Codice civile',
  'codice penale': 'Codice penale',
  'codice di procedura civile': 'Codice di procedura civile',
  'codice procedura civile': 'Codice di procedura civile',
  'codice di procedura penale': 'Codice di procedura penale',
  'codice procedura penale': 'Codice di procedura penale',
  costituzione: 'Costituzione',
  preleggi: 'Preleggi',
  "disposizioni per l'attuazione del codice civile e disposizioni transitorie": 'Disposizioni di attuazione del codice civile',
  "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": 'Disposizioni di attuazione del codice di procedura civile',
};

export function codeName(tipoAtto: string): string | null {
  return CODE_NAMES[(tipoAtto || '').trim().toLowerCase()] ?? null;
}

export function actKeyOf(norma: { tipo_atto: string; numero_atto?: string; data?: string }): string {
  const type = (norma.tipo_atto || '').trim().toLowerCase();
  // A code by its name, so both spellings of the same code are one act.
  const name = CODE_NAMES[type];
  if (name) return name.toLowerCase();
  return `${type}|${norma.numero_atto || ''}|${norma.data || ''}`;
}

// Ordinal suffixes by value (2 = bis … 20 = vicies), with the variant spellings.
const ORDINALS: Record<string, number> = {
  bis: 2, ter: 3, quater: 4, quinquies: 5, sexies: 6, septies: 7, octies: 8, novies: 9, decies: 10,
  undecies: 11, duodecies: 12, terdecies: 13, quaterdecies: 14, quinquiesdecies: 15, quindecies: 15,
  sexiesdecies: 16, sexdecies: 16, septiesdecies: 17, octiesdecies: 18, duodevicies: 18,
  noviesdecies: 19, undevicies: 19, vicies: 20, vices: 20,
};

// "2043" → [2043, 0, ''], "2-bis" → [2, 2, ''], "270-bis.1" → [270, 2, '.1'].
function articleRank(numero: string): [number, number, string] {
  const id = normalizeArticleId(numero || '');
  const match = /^(\d+)(?:-([a-z]+))?(.*)$/.exec(id);
  if (!match) return [Number.MAX_SAFE_INTEGER, 0, id];
  return [parseInt(match[1], 10), match[2] ? (ORDINALS[match[2]] ?? 99) : 0, match[3] ?? ''];
}

export function compareArticles(a: NormaVisitata, b: NormaVisitata): number {
  const annexA = a.allegato || '';
  const annexB = b.allegato || '';
  if (annexA !== annexB) {
    if (!annexA) return -1;
    if (!annexB) return 1;
    return annexA.localeCompare(annexB, 'it', { numeric: true });
  }
  const [na, oa, ra] = articleRank(a.numero_articolo);
  const [nb, ob, rb] = articleRank(b.numero_articolo);
  if (na !== nb) return na - nb;
  if (oa !== ob) return oa - ob;
  if (ra !== rb) return ra.localeCompare(rb);
  // The text in force (empty version key) first, past texts by date.
  return versionKey(a).localeCompare(versionKey(b));
}

export function articleLabel(norma: NormaVisitata): string {
  const article = `art. ${norma.numero_articolo}`;
  return norma.allegato ? `All. ${norma.allegato}, ${article}` : article;
}

export function foldedArticleList(block: ActBlock): string {
  const labels = block.articles.map((i) => (i.data.allegato ? `All. ${i.data.allegato}, ${i.data.numero_articolo}` : i.data.numero_articolo));
  const unique = labels.filter((label, index) => labels.indexOf(label) === index);
  return `${unique.length === 1 ? 'art.' : 'artt.'} ${unique.join(', ')}`;
}

function fallbackHeading(norma: NormaVisitata): string {
  return `${(norma.tipo_atto || '').trim()}${norma.numero_atto ? ` n. ${norma.numero_atto}` : ''}`;
}

export function layoutDossier(items: DossierItem[]): DossierLayout {
  const notes: DossierItem[] = [];
  const byKey = new Map<string, NormaItem[]>();
  for (const item of items) {
    if (item.type === 'norma') {
      const key = actKeyOf(item.data);
      const list = byKey.get(key);
      if (list) list.push(item); else byKey.set(key, [item]);
    } else {
      notes.push(item);
    }
  }
  const acts = Array.from(byKey.entries()).map(([key, articles]): ActBlock => {
    const sorted = [...articles].sort((x, y) => compareArticles(x.data, y.data));
    const name = codeName(sorted[0].data.tipo_atto);
    const named = sorted.find((i) => i.actCitation)?.actCitation ?? null;
    return {
      key,
      heading: name ?? named ?? fallbackHeading(sorted[0].data),
      headingIsFallback: !name && !named,
      isCode: !!name,
      articles: sorted,
      groups: computeNormaGroups(sorted),
    };
  });
  return { notes, acts };
}

// The full item order a drag of the acts saves: notes as they are, then each
// act's articles in display order, in the new order of the acts. Items of any
// other kind (decisions, Task 14) keep their place after the acts.
export function dossierItemOrder(layout: DossierLayout, actKeys: string[]): string[] {
  const blocks = new Map(layout.acts.map((a) => [a.key, a]));
  return [
    ...layout.notes.map((i) => i.id),
    ...actKeys.flatMap((key) => blocks.get(key)?.articles.map((i) => i.id) ?? []),
  ];
}
```

Note for the reviewer: `computeNormaGroups(sorted)` keeps its own key (with version and annex), so «Apri tutto» still splits a past text into a tab of its own.

- [ ] **Step 4: Run them to verify they pass** (same command).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/features/dossier/dossierLayout.ts apps/web/src/components/features/dossier/dossierLayout.test.ts
git commit -m "feat(web): the dossier's layout by act, as a pure module"
```

### Task 5: One rule for an act's rubriche, shared with the index window

**Files:**
- Create: `apps/web/src/utils/actRubriche.ts`
- Test: `apps/web/src/utils/actRubriche.test.ts`
- Modify: `apps/web/src/utils/actStructureCache.ts` (`ActRubricheResponse.title?: string`)
- Modify: `apps/web/src/components/features/search/TreeViewPanel.tsx` (`activePart` and `rubricheNormalized` use the shared functions)
- Test: `apps/web/src/components/features/search/TreeViewPanel.test.tsx` (one case)

**Interfaces:**
- Consumes: `RubrichePart`, `ActRubricheResponse` (`utils/actStructureCache.ts`), `normalizeArticleId`.
- Produces:

```ts
export function matchRubrichePart(parts: RubrichePart[], articleNumbers: string[]): RubrichePart | null;
export function rubricheFor(answer: ActRubricheResponse, annexArticleNumbers: string[] | null): Record<string, string>; // keys normalised
```

- [ ] **Step 1: Write the failing tests** — `utils/actRubriche.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchRubrichePart, rubricheFor } from './actRubriche';

// The shape measured on 4 Oct 2026 for d.lgs. 196/2003: the top-level map is an annex's.
const DLGS_196 = {
  rubriche: { '1': 'Delibera del Garante n. 515 del 19 dicembre 2018, in G.U. 14 gennaio 2019, n. 11' },
  parts: [
    { name: 'Allegato A.4 Regole deontologiche', keys: ['1', '2', '3'], rubriche: { '1': 'Delibera del Garante n. 515…' }, abrogati: [] },
    { name: 'Dispositivo', keys: ['1', '2', '2-bis', '2-ter', '3', '4'], rubriche: { '1': 'Oggetto', '2-bis': 'Autorità di controllo' }, abrogati: [] },
  ],
};

describe('rubricheFor', () => {
  it('uses the top-level map for an act with no parts', () => {
    expect(rubricheFor({ rubriche: { '1': 'Definizione', '2 bis': 'Ambito' }, parts: [] }, null))
      .toEqual({ '1': 'Definizione', '2-bis': 'Ambito' });
  });
  it('matches the body of an act in parts by its article numbers', () => {
    expect(rubricheFor(DLGS_196, ['1', '2', '2-bis', '2-ter', '3', '4'])['1']).toBe('Oggetto');
  });
  it('gives nothing for an act in parts when the part cannot be told, never the top-level map', () => {
    expect(rubricheFor(DLGS_196, null)).toEqual({});
    expect(rubricheFor(DLGS_196, [])).toEqual({});
    expect(rubricheFor(DLGS_196, ['900', '901'])).toEqual({});
  });
});

describe('matchRubrichePart', () => {
  it('needs a real majority: a shared article 1 is a coincidence', () => {
    expect(matchRubrichePart(DLGS_196.parts, ['1', '50', '51', '52'])).toBeNull();
  });
});
```

Append to `TreeViewPanel.test.tsx` a case that renders the window for an act whose `rubricheParts` are `DLGS_196.parts` (copy the constant), whose `annexes` metadata has no entry for the open annex, and asserts that art. 1 shows **no** «Delibera del Garante» text (`expect(screen.queryByText(/Delibera del Garante/)).toBeNull()`). Follow the file's existing render helper for the props.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/web run test -- --run actRubriche TreeViewPanel`
Expected: FAIL — cannot resolve `./actRubriche`; the TreeViewPanel case finds the Delibera text (today's fallback).

- [ ] **Step 3: Implement** — `utils/actRubriche.ts`:

```ts
import type { ActRubricheResponse, RubrichePart } from './actStructureCache';
import { normalizeArticleId } from './treeUtils';

/**
 * Which article titles belong to the articles in view. Every annex has its own
 * article 1 ("Capacità giuridica" in the codice civile, "Indicazione delle fonti"
 * in the preleggi), and the top-level map of an act in parts can be an annex's:
 * measured on d.lgs. 196/2003, whose top-level art. 1 is "Delibera del Garante
 * n. 515…" while its body is the part "Dispositivo". So an act in parts gets the
 * part matched by its article numbers, or nothing — never the top-level map.
 * Used by the index window and the dossier.
 */
export function matchRubrichePart(parts: RubrichePart[], articleNumbers: string[]): RubrichePart | null {
  if (parts.length === 0 || articleNumbers.length === 0) return null;
  const wanted = new Set(articleNumbers.map(normalizeArticleId));
  let best: RubrichePart | null = null;
  let bestScore = 0;
  for (const part of parts) {
    const overlap = part.keys.reduce((n, k) => (wanted.has(normalizeArticleId(k)) ? n + 1 : n), 0);
    if (overlap > bestScore) {
      bestScore = overlap;
      best = part;
    }
  }
  // A real majority: a couple of shared numbers is coincidence (every annex has
  // an article 1), a matching set is identification.
  return bestScore >= Math.max(1, Math.min(wanted.size, best?.keys.length ?? 0) * 0.5) ? best : null;
}

export function rubricheFor(answer: ActRubricheResponse, annexArticleNumbers: string[] | null): Record<string, string> {
  const parts = answer.parts ?? [];
  const source = parts.length === 0
    ? (answer.rubriche ?? {})
    : (matchRubrichePart(parts, annexArticleNumbers ?? [])?.rubriche ?? {});
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value) map[normalizeArticleId(key)] = value;
  }
  return map;
}
```

`actStructureCache.ts`, `ActRubricheResponse`: add `title?: string;` with the comment «The act's title, made presentable by the server (`presentable_title`); '' or absent when there is none.»

`TreeViewPanel.tsx`: replace the body of the `activePart` memo with

```ts
  const activePart = useMemo(() => {
    const annexNumbers = annexes?.find(
      a => a.number === effectiveAnnex || (a.number === null && effectiveAnnex === null)
    )?.article_numbers;
    return matchRubrichePart(rubricheParts ?? [], annexNumbers ?? []);
  }, [rubricheParts, annexes, effectiveAnnex]);
```

and the `rubricheNormalized` memo with

```ts
  const rubricheNormalized = useMemo(() => {
    const annexNumbers = annexes?.find(
      a => a.number === effectiveAnnex || (a.number === null && effectiveAnnex === null)
    )?.article_numbers ?? null;
    return rubricheFor({ rubriche, parts: rubricheParts }, annexNumbers);
  }, [rubriche, rubricheParts, annexes, effectiveAnnex]);
```

keeping the explanatory comment above `activePart` (shortened to point at `utils/actRubriche.ts`). If `activePart` has no other reader after this, delete it.

- [ ] **Step 4: Run them to verify they pass**, then the whole web suite: `npm --prefix apps/web run test -- --run`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/actRubriche.ts apps/web/src/utils/actRubriche.test.ts apps/web/src/utils/actStructureCache.ts apps/web/src/components/features/search/TreeViewPanel.tsx apps/web/src/components/features/search/TreeViewPanel.test.tsx
git commit -m "fix(web): an act in parts never shows another part's rubriche; one rule for index and dossier"
```

### Task 6: An act's title and rubriche, for a block

**Files:**
- Create: `apps/web/src/components/features/dossier/useActDetails.ts`
- Test: `apps/web/src/components/features/dossier/useActDetails.test.ts`

**Interfaces:**
- Consumes: `fetchActRubriche`, `fetchActTree` (`utils/actStructureCache.ts`), `rubricheFor` (Task 5), `resolveAct` (`utils/actUrn.ts`), `ActBlock` (Task 4), `normalizeArticleId`.
- Produces:

```ts
export interface ActDetails { title: string | null; rubricaOf: (norma: NormaVisitata) => string | null; }
export function actUrnForBlock(block: ActBlock): string | null; // first item's urn without "~art…"
export function useActDetails(block: ActBlock): ActDetails;
```

Rules (spec §3, §5): one `/fetch_rubriche` per act; `/fetch_tree` only when the answer has `parts`; the title is shown only for an act that is not a code; an item with no `urn` resolves the act through `resolveAct({ act_type, act_number, date })`; any failure is logged with the URN and leaves `title: null` and no rubriche.

- [ ] **Step 1: Write the failing tests** — mock `../../../utils/actStructureCache` and `../../../utils/actUrn` with `vi.mock`, render the hook with `renderHook` from Testing Library:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchActRubriche = vi.fn();
const fetchActTree = vi.fn();
const resolveAct = vi.fn();
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActRubriche: (...a: unknown[]) => fetchActRubriche(...a),
  fetchActTree: (...a: unknown[]) => fetchActTree(...a),
}));
vi.mock('../../../utils/actUrn', () => ({ resolveAct: (...a: unknown[]) => resolveAct(...a) }));

import { useActDetails, actUrnForBlock } from './useActDetails';
import { layoutDossier } from './dossierLayout';
import type { DossierItem } from '../../../types';

const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2012-12-31;247';
const item = (numero_articolo: string, more: object = {}): DossierItem => ({
  id: numero_articolo, type: 'norma', addedAt: '2026-10-04', actCitation: 'l. 31 dicembre 2012, n. 247',
  data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo, urn: `${URN}~art${numero_articolo}`, ...more },
});

beforeEach(() => { vi.clearAllMocks(); });

describe('useActDetails', () => {
  it('reads the title and the rubriche of a flat act with one call, and no tree', async () => {
    fetchActRubriche.mockResolvedValue({ title: 'Nuova disciplina', rubriche: { '3': 'Doveri e deontologia' }, parts: [] });
    const [block] = layoutDossier([item('3')]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(result.current.title).toBe('Nuova disciplina'));
    expect(result.current.rubricaOf(block.articles[0].data)).toBe('Doveri e deontologia');
    expect(fetchActRubriche).toHaveBeenCalledWith(URN);
    expect(fetchActTree).not.toHaveBeenCalled();
  });

  it('matches an act in parts through its tree, and shows no title for a code', async () => {
    fetchActRubriche.mockResolvedValue({
      title: 'Approvazione del testo del Codice civile', rubriche: { '1': 'Indicazione delle fonti' },
      parts: [{ name: 'CODICE CIVILE', keys: ['1', '2', '3'], rubriche: { '2043': 'Risarcimento per fatto illecito' }, abrogati: [] }],
    });
    fetchActTree.mockResolvedValue({ articles: [], metadata: { annexes: [{ number: '2', label: 'Codice civile', article_count: 3, article_numbers: ['1', '2', '3'] }] } });
    const [block] = layoutDossier([{
      id: 'cc', type: 'norma', addedAt: '2026-10-04', actCitation: 'c.c.',
      data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043', allegato: '2', urn: 'urn:x;262:2~art2043' },
    }]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(result.current.rubricaOf(block.articles[0].data)).toBe('Risarcimento per fatto illecito'));
    expect(result.current.title).toBeNull();
  });

  it('logs a failure and shows nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchActRubriche.mockRejectedValue(new Error('down'));
    const [block] = layoutDossier([item('3')]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(result.current.title).toBeNull();
    expect(result.current.rubricaOf(block.articles[0].data)).toBeNull();
  });
});

describe('actUrnForBlock', () => {
  it('is the first urn without the article', () => {
    expect(actUrnForBlock(layoutDossier([item('3')]).acts[0])).toBe(URN);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/web run test -- --run useActDetails`
Expected: FAIL — cannot resolve `./useActDetails`.

- [ ] **Step 3: Implement** — `useActDetails.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import type { NormaVisitata } from '../../../types';
import { fetchActRubriche, fetchActTree } from '../../../utils/actStructureCache';
import { rubricheFor } from '../../../utils/actRubriche';
import { resolveAct } from '../../../utils/actUrn';
import { normalizeArticleId } from '../../../utils/treeUtils';
import type { ActBlock } from './dossierLayout';

export interface ActDetails {
  title: string | null;
  rubricaOf: (norma: NormaVisitata) => string | null;
}

/** The act's URN for the index routes: the first item's URN, without "~art…". */
export function actUrnForBlock(block: ActBlock): string | null {
  const urn = block.articles.find((i) => i.data.urn)?.data.urn;
  return urn ? urn.split('~')[0] : null;
}

// annex ('' = body) → rubriche keyed by normalised article id
type RubricheByAnnex = Record<string, Record<string, string>>;

/**
 * Title and rubriche of one act block: one `/fetch_rubriche` per act (cached for
 * the session), and the act's tree only when the act is made of parts, to tell
 * which part an annex is (spec §5). Never a rubrica from another part.
 */
export function useActDetails(block: ActBlock): ActDetails {
  const [title, setTitle] = useState<string | null>(null);
  const [byAnnex, setByAnnex] = useState<RubricheByAnnex>({});
  const annexes = useMemo(
    () => Array.from(new Set(block.articles.map((i) => i.data.allegato || ''))),
    [block.articles],
  );
  const first = block.articles[0]?.data;
  const knownUrn = actUrnForBlock(block);

  useEffect(() => {
    if (!first) return;
    let cancelled = false;
    (async () => {
      let urn = knownUrn;
      try {
        urn ??= (await resolveAct({ act_type: first.tipo_atto, act_number: first.numero_atto, date: first.data })).urn;
        const answer = await fetchActRubriche(urn);
        let maps: RubricheByAnnex;
        if ((answer.parts ?? []).length === 0) {
          const flat = rubricheFor(answer, null);
          maps = Object.fromEntries(annexes.map((a) => [a, flat]));
        } else {
          const tree = await fetchActTree(urn);
          const meta = Array.isArray(tree) ? undefined : tree.metadata;
          maps = Object.fromEntries(annexes.map((a) => {
            const numbers = meta?.annexes?.find((x) => (x.number ?? '') === a)?.article_numbers ?? null;
            return [a, rubricheFor(answer, numbers)];
          }));
        }
        if (cancelled) return;
        setTitle(block.isCode ? null : (answer.title?.trim() || null));
        setByAnnex(maps);
      } catch (err) {
        // Decoration only: the rows keep "art. N" (gotcha 18: logged, never swallowed).
        console.error('Act title and rubriche unavailable for', urn ?? first.tipo_atto, err);
      }
    })();
    return () => { cancelled = true; };
    // One load per act and set of annexes; the block object changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.key, knownUrn, annexes.join('|')]);

  const rubricaOf = (norma: NormaVisitata) =>
    byAnnex[norma.allegato || '']?.[normalizeArticleId(norma.numero_articolo)] ?? null;

  return { title, rubricaOf };
}
```

- [ ] **Step 4: Run them to verify they pass** (same command), and `npm --prefix apps/web run lint -- src/components/features/dossier/useActDetails.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/features/dossier/useActDetails.ts apps/web/src/components/features/dossier/useActDetails.test.ts
git commit -m "feat(web): an act block's title and rubriche, one cached call per act"
```

### Task 7: `MenuButton`, one accessible menu

**Files:**
- Create: `apps/web/src/components/ui/MenuButton.tsx`
- Test: `apps/web/src/components/ui/__tests__/MenuButton.test.tsx`
- Modify: `apps/web/src/components/features/dossier/DossierListView.tsx` (the card's «⋯» menu moves onto it; `activeMenuId`, `menuWrapperRef` and their click-outside effect go)
- Test: `apps/web/src/components/features/dossier/DossierListView.test.tsx` (the existing menu cases must stay green; add one for Escape)

**Interfaces:**
- Produces:

```ts
export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}
export interface MenuButtonProps {
  label: string;               // accessible name of the trigger
  items: MenuItem[];
  children: React.ReactNode;   // the trigger's content (icon, or icon + text)
  triggerClassName?: string;
  align?: 'left' | 'right';
}
export function MenuButton(props: MenuButtonProps): JSX.Element;
```

Behaviour: trigger has `aria-haspopup="menu"`, `aria-expanded`; open on click, Enter, Space or ArrowDown (focus the first enabled item); ArrowDown/ArrowUp move with wrap, Home/End jump; Escape and Tab close and return focus to the trigger; click outside closes; selecting an item closes, returns focus, then calls `onSelect`; items are `role="menuitem"` buttons with 44px height on mobile; the panel takes the `Z_INDEX.dropdown` class (`constants/zIndex.ts`: «Inline dropdown menus, popovers within cards»); clicks inside never bubble to a parent card (`stopPropagation` on the wrapper).

- [ ] **Step 1: Write the failing tests** — `MenuButton.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MenuButton } from '../MenuButton';

function setup(onSelect = vi.fn()) {
  render(
    <div>
      <MenuButton label="Azioni" items={[
        { label: 'Modifica', onSelect },
        { label: 'Disattivata', onSelect: vi.fn(), disabled: true },
        { label: 'Elimina', onSelect: vi.fn(), danger: true, separatorBefore: true },
      ]}>⋯</MenuButton>
      <button>fuori</button>
    </div>,
  );
  return { trigger: screen.getByRole('button', { name: 'Azioni' }), onSelect };
}

describe('MenuButton', () => {
  it('opens on click and selects an item, closing and returning focus', () => {
    const { trigger, onSelect } = setup();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it('moves with the arrows, skipping a disabled item, and closes on Escape', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Modifica' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Elimina' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it('closes on a click outside', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'fuori' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
```

In `DossierListView.test.tsx`, add: open a card's «Azioni su …» menu, press Escape, the menu is gone and the card's detail view did not open.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/web run test -- --run MenuButton DossierListView`
Expected: FAIL — cannot resolve `../MenuButton`.

- [ ] **Step 3: Implement** `MenuButton.tsx`:

```tsx
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface MenuButtonProps {
  label: string;
  items: MenuItem[];
  children: ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
}

/** A button that opens a list of actions: the one menu of the dossier screens (spec §8). */
export function MenuButton({ label, items, children, triggerClassName, align = 'right' }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);
  const focusItem = (index: number) => itemRefs.current[index]?.focus();
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openAndFocus = (which: 'first' | 'last') => {
    setOpen(true);
    requestAnimationFrame(() => focusItem(which === 'first' ? enabled[0] : enabled[enabled.length - 1]));
  };

  const onTriggerKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAndFocus('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAndFocus('last');
    }
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const at = enabled.indexOf(current);
    if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(enabled[(at + 1) % enabled.length]); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(enabled[(at - 1 + enabled.length) % enabled.length]); }
    else if (event.key === 'Home') { event.preventDefault(); focusItem(enabled[0]); }
    else if (event.key === 'End') { event.preventDefault(); focusItem(enabled[enabled.length - 1]); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') { close(false); }
  };

  return (
    <div ref={wrapperRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg', triggerClassName)}
      >
        {children}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cn(
            Z_INDEX.dropdown,
            'absolute mt-1 w-56 py-1 rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) => (
            <div key={item.label}>
              {item.separatorBefore && <div className="my-1 border-t border-slate-200 dark:border-slate-700" aria-hidden />}
              <button
                ref={(el) => { itemRefs.current[index] = el; }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => { close(); item.onSelect(); }}
                className={cn(
                  'flex w-full min-h-[44px] items-center gap-2 px-3 py-2 text-left text-sm md:min-h-0',
                  'focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
                  item.danger
                    ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 dark:focus-visible:bg-red-900/20'
                    : 'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700',
                )}
              >
                {item.icon && <item.icon size={16} aria-hidden />}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

`DossierListView.tsx`: replace the card's menu `<div ref=… className="relative">…</div>` block with

```tsx
<MenuButton
  label={`Azioni su ${dossier.title}`}
  triggerClassName={cn(
    'p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700',
    'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 max-md:opacity-100',
  )}
  items={[
    { label: 'Apri su Dashboard', icon: ExternalLink, onSelect: () => handleQuickOpen(dossier), disabled: !hasNormaItems },
    { label: 'Rinomina / Modifica', icon: Edit2, onSelect: () => setEditingDossier(dossier) },
    { label: 'Elimina', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => setDeletingDossier(dossier) },
  ]}
>
  <MoreHorizontal size={18} />
</MenuButton>
```

and remove `activeMenuId`, `setActiveMenuId`, `menuWrapperRef`, the effect that closed it on outside click, and the `isMenuOpen &&` class on the quick-open button (it stays visible on hover/focus as before).

- [ ] **Step 4: Run them to verify they pass**, plus `npm --prefix apps/web run lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/MenuButton.tsx apps/web/src/components/ui/__tests__/MenuButton.test.tsx apps/web/src/components/features/dossier/DossierListView.tsx apps/web/src/components/features/dossier/DossierListView.test.tsx
git commit -m "feat(web): one accessible menu button; the dossier card's menu uses it"
```

### Task 8: The article row

**Files:**
- Rename: `apps/web/src/components/features/dossier/SortableDossierItem.tsx` → `DossierArticleRow.tsx` (and its two tests → `DossierArticleRow.test.tsx`, `DossierArticleRow.pastText.test.tsx`, `git mv`)
- Modify: `apps/web/src/components/features/dossier/DossierItemReader.tsx` (optional `onArticle` prop)
- Modify: `apps/web/src/components/features/dossier/DossierItemReader.test.tsx` (one case)

**Interfaces:**
- Consumes: `articleLabel` (Task 4), `ActDetails.rubricaOf` (Task 6), `historicalItemLabel`, `getRubricText` + `parseArticleStructure` (`utils/articleStructure.ts`).
- Produces:

```ts
interface DossierArticleRowProps {
  item: Extract<DossierItem, { type: 'norma' }>;
  rubrica: string | null;            // from useActDetails; the row may fill it from the text
  isSelected: boolean;
  showCheckbox: boolean;
  onToggleSelect: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenOnDashboard: () => void;
  onRemove: () => void;
  onToggleImportant: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}
export function DossierArticleRow(props: DossierArticleRowProps): JSX.Element;
// DossierItemReader gains: onArticle?: (article: ArticleData) => void
```

The row is **not sortable** (no `useSortable`, no grip). Notes are no longer rows (Task 10 renders them); the `type === 'note'` branches go.

- [ ] **Step 1: Write the failing tests** — rewrite the moved test file's helper and add the new cases (keep every existing star, accessibility and past-text case, adapted to the new props: drop `dragDisabled`, the DnD wrappers and the note-row cases):

```tsx
function renderRow(item = normaItem, over: Partial<Parameters<typeof DossierArticleRow>[0]> = {}) {
  return render(
    <DossierArticleRow
      item={item} rubrica={null} isSelected={false} showCheckbox={false}
      onToggleSelect={() => {}} onRemove={() => {}} onToggleImportant={() => {}}
      isExpanded={false} onToggleExpand={() => {}} onOpenOnDashboard={() => {}} showToast={() => {}}
      {...over}
    />,
  );
}

describe('DossierArticleRow', () => {
  it('reads "art. N — rubrica", without the act, the date or «Aggiunto il»', () => {
    renderRow(normaItem, { rubrica: 'Risarcimento per fatto illecito' });
    expect(screen.getByText('art. 2043')).toBeInTheDocument();
    expect(screen.getByText('Risarcimento per fatto illecito')).toBeInTheDocument();
    expect(screen.queryByText(/Aggiunto il/)).toBeNull();
    expect(screen.queryByText(/codice civile/i)).toBeNull();
    expect(screen.queryByText(/1942/)).toBeNull();
  });
  it('names the act in its accessible name, from the server citation', () => {
    renderRow({ ...normaItem, citation: 'art. 2043 c.c.' });
    expect(screen.getByRole('button', { name: 'Espandi art. 2043 c.c.' })).toBeInTheDocument();
  });
  it('shows the annex as a chip', () => {
    renderRow({ ...normaItem, data: { ...normaItem.data, allegato: 'A', numero_articolo: '1' } });
    expect(screen.getByText('All. A')).toBeInTheDocument();
  });
  it('has no drag handle', () => {
    renderRow();
    expect(document.querySelector('[aria-roledescription="sortable"]')).toBeNull();
  });
});
```

`normaItem` keeps `{ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' }`. The accessible name for an item without `citation` stays the current form (`Espandi codice civile 262 articolo 2043`), so the existing case keeps passing.

In `DossierItemReader.test.tsx`, add: with `onArticle={spy}`, once the mocked fetch resolves, `spy` is called with the article.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/web run test -- --run DossierArticleRow DossierItemReader`
Expected: FAIL — cannot resolve `./DossierArticleRow`.

- [ ] **Step 3: Implement**

`DossierItemReader.tsx`: add `onArticle?: (article: ArticleData) => void;` to `Props`, destructure it, and after the `article` derivation:

```ts
  // Lets the row fill a rubrica the act's index did not give (spec §5).
  useEffect(() => {
    if (article) onArticle?.(article);
  }, [article, onArticle]);
```

`DossierArticleRow.tsx` (from the old file, keeping the 44px star and remove, the checkbox, the header-scoped `role="button"` expand toggle and the amber stripe for important items):

```tsx
import { useCallback, useState } from 'react';
import { CheckSquare, ChevronDown, Square, Star, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { historicalItemLabel } from '../../../utils/versionDisplay';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import type { ArticleData, DossierItem } from '../../../types';
import { DossierItemReader } from './DossierItemReader';
import { articleLabel } from './dossierLayout';

type NormaItem = Extract<DossierItem, { type: 'norma' }>;

export interface DossierArticleRowProps {
  item: NormaItem;
  rubrica: string | null;
  isSelected: boolean;
  showCheckbox: boolean;
  onToggleSelect: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenOnDashboard: () => void;
  onRemove: () => void;
  onToggleImportant: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/** One article inside its act's block: "art. 3 — rubrica", the star, the text in place (spec §5). */
export function DossierArticleRow({
  item, rubrica, isSelected, showCheckbox, onToggleSelect, isExpanded, onToggleExpand,
  onOpenOnDashboard, onRemove, onToggleImportant, showToast,
}: DossierArticleRowProps) {
  const [textRubrica, setTextRubrica] = useState<string | null>(null);
  const onArticle = useCallback((article: ArticleData) => {
    const raw = article.article_text || '';
    setTextRubrica(raw ? getRubricText(raw, parseArticleStructure(raw)) : null);
  }, []);

  const shownRubrica = rubrica ?? textRubrica;
  const isImportant = item.status === 'important';
  const historicalLabel = historicalItemLabel(item.data);
  const label = item.data.allegato ? `art. ${item.data.numero_articolo}` : articleLabel(item.data);
  const verb = isExpanded ? 'Comprimi' : 'Espandi';
  // The act must be in the name: two laws' art. 3 must never read alike.
  const named = item.citation
    ?? `${item.data.tipo_atto}${item.data.numero_atto ? ` ${item.data.numero_atto}` : ''} articolo ${item.data.numero_articolo}`;
  const rowLabel = `${verb} ${named}`
    + (historicalLabel ? `, ${historicalLabel.charAt(0).toLowerCase()}${historicalLabel.slice(1)}` : '');
  const regionId = `dossier-item-content-${item.id}`;

  return (
    <div className={cn(
      'group relative rounded-lg pl-3 pr-2 py-1.5 transition-colors',
      isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
    )}>
      {isImportant && <span aria-hidden className="absolute left-0 top-1 bottom-1 w-1 rounded bg-amber-400" />}
      <div className="flex items-center gap-2">
        {showCheckbox && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label={isSelected ? 'Deseleziona elemento' : 'Seleziona elemento'}
            aria-pressed={isSelected}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-slate-400 hover:text-blue-500 md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {isSelected ? <CheckSquare size={18} className="text-blue-500" /> : <Square size={18} />}
          </button>
        )}
        <div
          role="button"
          tabIndex={0}
          aria-label={rowLabel}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? regionId : undefined}
          onClick={onToggleExpand}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand(); }
          }}
          className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md md:min-h-0 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ChevronDown size={16} aria-hidden className={cn('flex-shrink-0 text-slate-400 transition-transform', !isExpanded && '-rotate-90')} />
          <span className="min-w-0 flex-1 truncate text-sm md:text-[15px]">
            <span className="font-medium text-slate-900 dark:text-white">{label}</span>
            {shownRubrica && <span className="text-slate-500 dark:text-slate-400"> — <span>{shownRubrica}</span></span>}
          </span>
          {item.data.allegato && (
            <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              All. {item.data.allegato}
            </span>
          )}
          {historicalLabel && (
            <span className="flex-shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {historicalLabel}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleImportant}
          aria-pressed={isImportant}
          aria-label={isImportant ? 'Rimuovi da importanti' : 'Segna come importante'}
          title={isImportant ? 'Importante' : 'Segna come importante'}
          className={cn(
            'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 transition-colors md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
            isImportant ? 'text-amber-500' : 'text-slate-300 hover:bg-amber-50 hover:text-amber-500 dark:text-slate-600 dark:hover:bg-amber-900/20',
          )}
        >
          <Star size={16} className={cn(isImportant && 'fill-amber-400')} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Rimuovi articolo dal dossier"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500 md:min-h-0 md:min-w-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20"
        >
          <Trash2 size={16} />
        </button>
      </div>
      {isExpanded && (
        <div id={regionId} className="pl-6 pr-2 pb-2">
          <DossierItemReader norma={item.data} onOpenOnDashboard={onOpenOnDashboard} showToast={showToast} onArticle={onArticle} />
        </div>
      )}
    </div>
  );
}
```

Note the label: for an annexed article the chip carries «All. A», so the label is plain «art. 1» (the folded list and the PDF use `articleLabel`, which includes the annex). The existing accessible-name test case for a past text keeps its wording.

- [ ] **Step 4: Run them to verify they pass**; `npm --prefix apps/web run build` will now fail in `DossierDetailView.tsx` (it imports `SortableDossierItem`) — that is fixed in Task 10; do not commit a red build: go on to Tasks 9 and 10 and commit 8–10 together, or leave `DossierDetailView` on a temporary local import alias **only within the working tree** and commit when Task 10 is green. Preferred: one commit for Tasks 8–10 after Task 10's tests and build pass, each task still reviewed on its own diff.

### Task 9: The act block, and saving the order of the acts

**Files:**
- Create: `apps/web/src/components/features/dossier/DossierActBlock.tsx`
- Test: `apps/web/src/components/features/dossier/DossierActBlock.test.tsx`
- Modify: `apps/web/src/store/useAppStore.ts` (new `setDossierItemOrder`; `reorderDossierItems` is removed once nothing calls it)
- Test: `apps/web/src/store/dossierActions.test.ts`

**Interfaces:**
- Consumes: `ActBlock`, `foldedArticleList` (Task 4), `useActDetails` (Task 6), `MenuButton` (Task 7), `DossierArticleRow` (Task 8), `useSortable` (`@dnd-kit/sortable`).
- Produces:

```ts
// store
setDossierItemOrder: (dossierId: string, itemIds: string[]) => void;

// component
interface DossierActBlockProps {
  block: ActBlock;
  dragDisabled: boolean;
  isFolded: boolean;
  onToggleFold: () => void;
  expandedIds: Set<string>;
  onToggleExpand: (itemId: string) => void;
  selectedIds: Set<string>;
  showCheckbox: boolean;
  onToggleSelect: (itemId: string) => void;
  onOpenAct: () => void;                     // "Apri tutto" for this act's groups
  onAddArticles: () => void;                 // TreeNavigatorModal on this act
  onRemoveAct: () => void;                   // all its articles, one undo toast
  onOpenItem: (item: DossierItem) => void;
  onRemoveItem: (item: DossierItem) => void;
  onToggleImportant: (item: DossierItem) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}
export function DossierActBlock(props: DossierActBlockProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`dossierActions.test.ts`:

```ts
describe('setDossierItemOrder', () => {
  it('reorders locally and saves the whole order', () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: [
      { id: 'a', type: 'note', data: 'a', addedAt: '' }, { id: 'b', type: 'note', data: 'b', addedAt: '' },
    ] }], pendingDossierItemIds: {} });
    appStore.getState().setDossierItemOrder('d1', ['b', 'a']);
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(dossierService.reorderItems).toHaveBeenCalledWith('d1', ['b', 'a']);
  });
  it('never sends a temporary id: the save waits while an item is pending', () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: [
      { id: 'tmp', type: 'note', data: 'a', addedAt: '' }, { id: 'b', type: 'note', data: 'b', addedAt: '' },
    ] }], pendingDossierItemIds: { tmp: true } });
    appStore.getState().setDossierItemOrder('d1', ['b', 'tmp']);
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['b', 'tmp']);
    expect(dossierService.reorderItems).not.toHaveBeenCalled();
  });
  it('reverts and says so when the server refuses', async () => {
    const before = [{ id: 'a', type: 'note' as const, data: 'a', addedAt: '' }, { id: 'b', type: 'note' as const, data: 'b', addedAt: '' }];
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: before }], pendingDossierItemIds: {} });
    vi.mocked(dossierService.reorderItems).mockRejectedValueOnce(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    appStore.getState().setDossierItemOrder('d1', ['b', 'a']);
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['a', 'b']));
  });
});
```

Also add to the `addToDossier` describe: after an order was set while an item was pending, the settled answer replays the save with the server id (`reorderItems` called once, with `srv-…` in place of the temp id).

`DossierActBlock.test.tsx` (wrap in `DndContext` + `SortableContext` with `items={[block.key]}`; mock `./useActDetails` to return `{ title: 'Nuova disciplina dell\'ordinamento della professione forense', rubricaOf: () => null }`):
- the heading `l. 31 dicembre 2012, n. 247` appears once, with the title and «2 articoli»;
- a fallback heading carries a muted class and the text `legge n. 247`;
- clicking the fold toggle hides the rows and shows `artt. 1, 3`;
- «Apri tutto», «Aggiungi articoli» call their handlers;
- the «⋯» menu has «Rimuovi l'atto dal dossier», which calls `onRemoveAct`;
- the drag handle is labelled `Sposta l. 31 dicembre 2012, n. 247` and is absent from the DOM when `dragDisabled`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/web run test -- --run DossierActBlock dossierActions`
Expected: FAIL.

- [ ] **Step 3: Implement**

Store (`useAppStore.ts`), in the interface next to `reorderDossierItems` and in the body:

```ts
            // The order of a whole dossier after a drag of its acts (spec §4). Optimistic,
            // reverted with a sync error when the server refuses (gotcha 17). While an
            // item still has a temporary id the server call waits: addToDossier replays it
            // once the id is settled, as it does for the star.
            setDossierItemOrder: (dossierId, itemIds) => {
                const dossier = get().dossiers.find(d => d.id === dossierId);
                if (!dossier) return;
                const before = dossier.items;
                const byId = new Map(before.map(i => [i.id, i]));
                const next = [
                    ...itemIds.map(id => byId.get(id)).filter((i): i is DossierItem => !!i),
                    ...before.filter(i => !itemIds.includes(i.id)),
                ];
                set((state) => {
                    const d = state.dossiers.find(x => x.id === dossierId);
                    if (d) d.items = next;
                    if (next.some(i => state.pendingDossierItemIds[i.id])) state.pendingDossierOrders[dossierId] = true;
                });
                if (next.some(i => get().pendingDossierItemIds[i.id])) return;
                dossierService.reorderItems(dossierId, next.map(i => i.id)).catch(err => {
                    console.error('Failed to save the order of the dossier:', err);
                    set((state) => {
                        const d = state.dossiers.find(x => x.id === dossierId);
                        if (d) d.items = before;
                    });
                    get().pushSyncError('Impossibile salvare il nuovo ordine degli atti. Riprova.');
                });
            },
```

Add `pendingDossierOrders: Record<string, true>` to the state (initial `{}`, not persisted — check the `persist` partialize keeps UI state only and does not list it). In `addToDossier`'s `.then`, after the star replay: if `get().pendingDossierOrders[dossierId]` and no item of that dossier is pending any more, clear the flag and call `get().setDossierItemOrder(dossierId, current item ids)`.

Remove `reorderDossierItems` from the interface and the body once Task 10 no longer calls it; its existing tests (if any) move to `setDossierItemOrder`.

`DossierActBlock.tsx`:

```tsx
import { ChevronDown, ExternalLink, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../../lib/utils';
import { MenuButton } from '../../ui/MenuButton';
import type { DossierItem } from '../../../types';
import { DossierArticleRow } from './DossierArticleRow';
import { foldedArticleList, type ActBlock } from './dossierLayout';
import { useActDetails } from './useActDetails';

export interface DossierActBlockProps { /* as in Interfaces above */ }

/** One act, named once, with its articles beneath it (spec §4). */
export function DossierActBlock(props: DossierActBlockProps) {
  const { block, dragDisabled, isFolded, onToggleFold } = props;
  const { title, rubricaOf } = useActDetails(block);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.key, disabled: dragDisabled });
  const count = block.articles.length;
  const foldLabel = `${isFolded ? 'Apri' : 'Chiudi'} ${block.heading}`;

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      aria-label={block.heading}
      className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <header className="flex items-start gap-2 border-b border-slate-100 px-3 py-3 dark:border-slate-700 md:px-4">
        {!dragDisabled && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Sposta ${block.heading}`}
            className="mt-0.5 hidden cursor-grab rounded text-slate-300 hover:text-slate-500 md:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-600"
          >
            <GripVertical size={18} />
          </button>
        )}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isFolded}
          aria-label={foldLabel}
          onClick={onToggleFold}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleFold(); }
          }}
          className="min-w-0 flex-1 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <div className="flex items-baseline gap-2">
            <ChevronDown size={16} aria-hidden className={cn('flex-shrink-0 self-center text-slate-400 transition-transform', isFolded && '-rotate-90')} />
            <h3 className={cn('truncate text-base font-semibold', block.headingIsFallback ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white')}>
              {block.heading}
            </h3>
            <span className="flex-shrink-0 text-xs text-slate-400">{count === 1 ? '1 articolo' : `${count} articoli`}</span>
          </div>
          {title && <p className="ml-6 truncate text-sm text-slate-500 dark:text-slate-400" title={title}>{title}</p>}
          {isFolded && <p className="ml-6 truncate text-sm text-slate-500 dark:text-slate-400">{foldedArticleList(block)}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button type="button" onClick={props.onOpenAct} title="Apri tutto su Dashboard" aria-label={`Apri tutto ${block.heading} su Dashboard`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100 md:min-h-0 md:min-w-0 md:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-700">
            <ExternalLink size={15} aria-hidden /><span className="hidden lg:inline">Apri tutto</span>
          </button>
          <button type="button" onClick={props.onAddArticles} title="Aggiungi articoli di quest'atto" aria-label={`Aggiungi articoli di ${block.heading}`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100 md:min-h-0 md:min-w-0 md:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-700">
            <Plus size={15} aria-hidden /><span className="hidden lg:inline">Articoli</span>
          </button>
          <MenuButton
            label={`Azioni su ${block.heading}`}
            triggerClassName="flex min-h-[44px] min-w-[44px] items-center justify-center p-1.5 text-slate-500 hover:bg-slate-100 md:min-h-0 md:min-w-0 dark:hover:bg-slate-700"
            items={[{ label: "Rimuovi l'atto dal dossier", icon: Trash2, danger: true, onSelect: props.onRemoveAct }]}
          >
            <MoreHorizontal size={18} />
          </MenuButton>
        </div>
      </header>
      {!isFolded && (
        <div className="px-1 py-1 md:px-2">
          {block.articles.map((item) => (
            <DossierArticleRow
              key={item.id}
              item={item}
              rubrica={rubricaOf(item.data)}
              isSelected={props.selectedIds.has(item.id)}
              showCheckbox={props.showCheckbox}
              onToggleSelect={() => props.onToggleSelect(item.id)}
              isExpanded={props.expandedIds.has(item.id)}
              onToggleExpand={() => props.onToggleExpand(item.id)}
              onOpenOnDashboard={() => props.onOpenItem(item)}
              onRemove={() => props.onRemoveItem(item)}
              onToggleImportant={() => props.onToggleImportant(item)}
              showToast={props.showToast}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run them to verify they pass** (same command).

### Task 10: The detail page by sections, the header and its menus

**Files:**
- Modify: `apps/web/src/components/features/dossier/DossierDetailView.tsx` (the body from the search row down, and the header's buttons)
- Modify: `apps/web/src/components/features/dossier/TreeNavigatorModal.tsx` (optional `initialAct`)
- Create: `apps/web/src/components/features/dossier/DossierNotesSection.tsx`
- Create: `apps/web/src/components/features/dossier/DossierDetailView.test.tsx`
- Modify: `apps/web/src/components/features/dossier/AddNoteModal.tsx` (cap 4,000)

**Interfaces:**
- Consumes: `layoutDossier`, `dossierItemOrder` (Task 4), `DossierActBlock` (Task 9), `setDossierItemOrder` (Task 9), `MenuButton` (Task 7), `searchesForGroups`, `tabLabelForGroup`, `searchParamsFromGroup` (`dossierUtils.ts`), `showUndoToast`, `restoreDossierItem`.
- Produces:
  - `TreeNavigatorModal` prop `initialAct?: { tipo_atto: string; numero_atto: string; data: string }`: fields prefilled from it and the tree fetched on mount, with no search step;
  - `DossierNotesSection({ notes, onRemove })`;
  - the page described in spec §1 and §8.

- [ ] **Step 1: Write the failing tests** — `DossierDetailView.test.tsx`, rendering the view inside `MemoryRouter` with a dossier fixture in `appStore` (mock `./useActDetails` to `{ title: null, rubricaOf: () => null }` and `../../../services/dossierService` like `dossierActions.test.ts`):

```tsx
const dossier: Dossier = {
  id: 'd1', title: 'Ricorso Rossi', createdAt: '2026-10-04T08:00:00Z', tags: [],
  items: [
    { id: 'a3', type: 'norma', addedAt: '', actCitation: 'l. 31 dicembre 2012, n. 247', citation: 'art. 3, l. 31 dicembre 2012, n. 247', data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3' } },
    { id: 'b1', type: 'norma', addedAt: '', actCitation: 'l. 21 aprile 2023, n. 49', data: { tipo_atto: 'legge', numero_atto: '49', data: '2023-04-21', numero_articolo: '1' } },
    { id: 'a1', type: 'norma', addedAt: '', actCitation: 'l. 31 dicembre 2012, n. 247', data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '1' } },
    { id: 'n1', type: 'note', addedAt: '2026-10-04T09:00:00Z', data: 'Verificare la decorrenza' },
  ],
};
```

Cases:
- each act's heading appears exactly once (`getAllByRole('heading', { name: 'l. 31 dicembre 2012, n. 247' })` has length 1), in the order 247 then 49;
- inside the 247 block the rows read `art. 1` then `art. 3`;
- the «Note» section is above the first act and lists «Verificare la decorrenza»;
- the header shows exactly three labelled buttons and one menu: «Apri tutto su Dashboard», «Aggiungi», «Esporta», «Altre azioni»; no «Seleziona» button is on screen until «Seleziona elementi» is picked from «Altre azioni»;
- «Aggiungi» lists «Articoli da una norma», «Nota», «Cerca un articolo»; «Esporta» lists «PDF», «Copia link di condivisione», «JSON», «Salva snapshot»; «Altre azioni» lists «Modifica», «Aggiungi ai preferiti», «Seleziona elementi», «Elimina dossier»;
- «Rimuovi l'atto dal dossier» on the 247 block removes `a1` and `a3` and shows the undo toast «2 articoli rimossi»; undo restores both;
- typing «49» in the search shows only the 49 block, and the drag handles are gone;
- the counts line reads «2 atti · 3 articoli · 1 nota».

`AddNoteModal`: a test that 4,000 characters are accepted and the counter reads `4000/4000` (adapt to the modal's current counter markup).

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix apps/web run test -- --run DossierDetailView AddNoteModal`
Expected: FAIL.

- [ ] **Step 3: Implement**

`AddNoteModal.tsx`: the 2000 constant becomes `const MAX_NOTE_LENGTH = 4000; // the cap the MCP round sets for Claude's notes (S11)`.

`TreeNavigatorModal.tsx`: add `initialAct?` to `Props`; initialise the three fields from it (`useState(initialAct?.tipo_atto ?? 'codice civile')`, the date through the field's own format — `initialAct.data` is ISO, the field shows Italian: use `formatDateItalianLong`'s sibling that the field already parses, or keep ISO if `parseItalianDate` accepts it; check `parseItalianDate('2012-12-31')` in `dateUtils.test.ts` and pick the format it round-trips); add `useEffect(() => { if (initialAct) void fetchTree(); }, [])` with the justification comment for the empty dependency list; when the act type is not one of the `<select>`'s options, add it as an option so the select shows it.

`DossierNotesSection.tsx`:

```tsx
import { Trash2 } from 'lucide-react';
import type { DossierItem } from '../../../types';
import { formatTimestampLong } from './dossierUtils';

interface Props {
  notes: Extract<DossierItem, { type: 'note' }>[];
  onRemove: (item: DossierItem) => void;
}

/** The dossier's free notes, above the acts (spec §6). Claude's mark arrives with Task 15. */
export function DossierNotesSection({ notes, onRemove }: Props) {
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="dossier-notes-heading" className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20 md:p-4">
      <h3 id="dossier-notes-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
        Note ({notes.length})
      </h3>
      <ul className="space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="group flex items-start gap-2">
            <p className="flex-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{note.data}</p>
            <span className="flex-shrink-0 text-xs text-slate-500">{formatTimestampLong(note.addedAt)}</span>
            <button type="button" onClick={() => onRemove(note)} aria-label="Rimuovi nota"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-slate-400 hover:text-red-500 md:min-h-0 md:min-w-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`DossierDetailView.tsx` — what changes (everything else stays):
1. **Imports**: drop `SortableDossierItem`, `verticalListSortingStrategy` stays, `reorderDossierItems` goes from the store destructuring, `setDossierItemOrder` comes in; add `layoutDossier`, `dossierItemOrder`, `DossierActBlock`, `DossierNotesSection`, `MenuButton`.
2. **Filtering**: `visibleItems` matches, besides today's fields, `item.citation` and `item.actCitation` (lower-cased); the layout is `const layout = useMemo(() => layoutDossier(visibleItems), [visibleItems]);`.
3. **Header buttons**: the two `ToolbarButton` rows (mobile and desktop) are replaced by one row:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <button type="button" onClick={handleOpenAllOnDashboard} disabled={!hasNormaItems}
    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 md:min-h-0 md:py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
    <ExternalLink size={16} aria-hidden /><span>Apri tutto<span className="hidden sm:inline"> su Dashboard</span></span>
  </button>
  <MenuButton label="Aggiungi" align="left" triggerClassName={SECONDARY_BUTTON} items={[
    { label: 'Articoli da una norma', icon: TreeDeciduous, onSelect: () => setTreeNavigatorAct(null) },
    { label: 'Nota', icon: StickyNote, onSelect: () => setAddNoteOpen(true) },
    { label: 'Cerca un articolo', icon: Search, onSelect: () => navigate('/') },
  ]}><Plus size={16} aria-hidden /><span className="hidden sm:inline">Aggiungi</span></MenuButton>
  <MenuButton label="Esporta" align="left" triggerClassName={SECONDARY_BUTTON} items={[
    { label: 'PDF', icon: Download, onSelect: () => void handleExportPdf() },
    { label: 'Copia link di condivisione', icon: Share2, onSelect: () => void copyShareLink() },
    { label: 'JSON', icon: FileJson, onSelect: exportDossierJSON },
    { label: snapshotBusy ? 'Salvo lo snapshot…' : 'Salva snapshot', icon: History, onSelect: () => void handleCreateSnapshot(), disabled: snapshotBusy },
  ]}><Download size={16} aria-hidden /><span className="hidden sm:inline">Esporta</span></MenuButton>
  <MenuButton label="Altre azioni" triggerClassName={ICON_BUTTON} items={[
    { label: 'Modifica', icon: Edit2, onSelect: () => setEditingDossier(dossier) },
    { label: dossier.isPinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti', icon: Star, onSelect: () => toggleDossierPin(dossier.id) },
    { label: showBulkActions ? 'Annulla selezione' : 'Seleziona elementi', icon: CheckSquare, onSelect: () => setShowBulkActions((v) => !v) },
    { label: 'Elimina dossier', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => setConfirmDeleteOpen(true) },
  ]}><MoreHorizontal size={18} /></MenuButton>
</div>
```

with `SECONDARY_BUTTON = 'inline-flex min-h-[44px] items-center gap-2 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0 md:py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'` and `ICON_BUTTON` the same without text padding (`min-w-[44px] justify-center px-2`), as module constants. `ToolbarButton` is no longer imported here; if nothing else imports it, delete `ToolbarButton.tsx` and remove it from `apps/web/CLAUDE.md` (Task 13). The tour ids `tour-dossier-pin` / `tour-dossier-export` go with the buttons (the tour is list-view only, spec «What stays»).
4. **The counts line**: `Creato il … · {acts} atti · {articles} articoli · {notes} note` (singular forms for 1), from `layout`, plus `• N snapshot` as today.
5. **The bulk bar** shows only while `showBulkActions` (picked from «Altre azioni»); its content is today's («Seleziona tutti», count, «Sposta», «Elimina»).
6. **The body** replaces the `DndContext … SortableContext … visibleItems.map(SortableDossierItem)` block:

```tsx
<div id="tour-dossier-items" className="space-y-4">
  {dossier.items.length === 0 ? (/* today's empty state, unchanged */) : visibleItems.length === 0 ? (/* today's filtered empty state */) : (
    <>
      <DossierNotesSection notes={layout.notes as Extract<DossierItem, { type: 'note' }>[]} onRemove={handleRemoveSingle} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleActDragEnd}>
        <SortableContext items={layout.acts.map((a) => a.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {layout.acts.map((block) => (
              <DossierActBlock
                key={block.key}
                block={block}
                dragDisabled={hasFilter}
                isFolded={foldedActs.has(block.key)}
                onToggleFold={() => toggleFolded(block.key)}
                expandedIds={expandedIds}
                onToggleExpand={toggleExpanded}
                selectedIds={selectedItems}
                showCheckbox={showBulkActions}
                onToggleSelect={toggleItemSelection}
                onOpenAct={() => openGroupsOnDashboard(block.groups)}
                onAddArticles={() => setTreeNavigatorAct({ tipo_atto: block.articles[0].data.tipo_atto, numero_atto: block.articles[0].data.numero_atto || '', data: block.articles[0].data.data || '' })}
                onRemoveAct={() => handleRemoveAct(block)}
                onOpenItem={openItemOnDashboard}
                onRemoveItem={handleRemoveSingle}
                onToggleImportant={(item) => updateDossierItemStatus(dossier.id, item.id, item.status === 'important' ? 'unread' : 'important')}
                showToast={showToast}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </>
  )}
</div>
```

with, in the component:

```ts
  const [foldedActs, setFoldedActs] = useState<Set<string>>(new Set());
  const [treeNavigatorAct, setTreeNavigatorAct] = useState<{ tipo_atto: string; numero_atto: string; data: string } | null | undefined>(undefined);
  // undefined = closed; null = open on a blank form; an act = open on that act.

  const toggleFolded = (key: string) => setFoldedActs((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const handleActDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const keys = layout.acts.map((a) => a.key);
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const moved = [...keys];
    moved.splice(to, 0, moved.splice(from, 1)[0]);
    setDossierItemOrder(dossier.id, dossierItemOrder(layoutDossier(dossier.items), moved));
  };

  // One act's groups (or several), each search routed to its tab (gotcha 15).
  const openGroupsOnDashboard = (groups: NormaGroup[]) => {
    if (groups.length === 0) return;
    const paramsList = searchesForGroups(dossier.title, groups, (label) => addWorkspaceTab(label, undefined, undefined, { isCustom: true }));
    navigate('/');
    triggerMultiSearch(paramsList);
  };

  // All the act's articles, one undo toast that puts them back where they were.
  const handleRemoveAct = (block: ActBlock) => {
    const snapshots = block.articles
      .map((item) => ({ item: item as DossierItem, atIndex: dossier.items.findIndex((i) => i.id === item.id) }))
      .filter((s) => s.atIndex >= 0)
      .sort((a, b) => a.atIndex - b.atIndex);
    void showUndoToast({
      action: () => { snapshots.forEach((s) => removeFromDossier(dossier.id, s.item.id)); return snapshots; },
      undo: (snaps) => snaps.forEach((s) => restoreDossierItem(dossier.id, s.item, s.atIndex)),
      message: snapshots.length === 1 ? 'Articolo rimosso' : `${snapshots.length} articoli rimossi`,
    });
  };
```

`handleDragEnd`, `openGroupOnDashboard`/`openAllGroupsOnDashboard` collapse into `openGroupsOnDashboard` (the picker's «tutte» calls it with `normaGroups`; a single group calls it with `[group]`). «Espandi tutto» opens every block (`setFoldedActs(new Set())`) and every article; «Comprimi tutto» closes the articles only. The `TreeNavigatorModal` mounts when `treeNavigatorAct !== undefined`, with `initialAct={treeNavigatorAct ?? undefined}`. The empty-state «Importa da norma» button calls `setTreeNavigatorAct(null)`.

- [ ] **Step 4: Run the tests, the whole web suite, the build and the lint**

Run: `npm --prefix apps/web run test -- --run && npm --prefix apps/web run build && npm --prefix apps/web run lint`
Expected: all green. Lint errors in the files touched are fixed, pre-existing ones included.

- [ ] **Step 5: Commit Tasks 8–10**

```bash
git add apps/web/src/components/features/dossier apps/web/src/store apps/web/src/components/ui
git commit -m "feat(web): the dossier page by act — act blocks, article rows, notes first, a three-action header"
```

### Task 11: The dossier list names the acts

**Files:**
- Modify: `apps/web/src/components/features/dossier/DossierListView.tsx` (the counts line of a card)
- Modify: `apps/web/src/components/features/dossier/dossierLayout.ts` (new `actsSummary`)
- Test: `dossierLayout.test.ts`, `DossierListView.test.tsx`

**Interfaces:**
- Produces: `actsSummary(layout: DossierLayout, max = 3): string` → `"l. 31 dicembre 2012, n. 247 · l. 21 aprile 2023, n. 49 · Codice civile"`, then `" e altri N"` past `max`; `''` with no acts.

- [ ] **Step 1: Write the failing tests**

```ts
describe('actsSummary', () => {
  it('names the acts in order, then counts the rest', () => {
    const items = ['1', '2', '3', '4'].map((k, i) => art({ numero_atto: k, data: `200${i}-01-01`, numero_articolo: '1' }, `l. ${k}`));
    expect(actsSummary(layoutDossier(items))).toBe('l. 1 · l. 2 · l. 3 e altri 1');
    expect(actsSummary(layoutDossier([note('x')]))).toBe('');
  });
});
```

In `DossierListView.test.tsx`: a card for a dossier with the two laws shows `l. 31 dicembre 2012, n. 247 · l. 21 aprile 2023, n. 49` and `1 nota`.

- [ ] **Step 2: Run them to verify they fail** — `npm --prefix apps/web run test -- --run dossierLayout DossierListView`.

- [ ] **Step 3: Implement**

```ts
export function actsSummary(layout: DossierLayout, max = 3): string {
  const names = layout.acts.map((a) => a.heading);
  if (names.length <= max) return names.join(' · ');
  return `${names.slice(0, max).join(' · ')} e altri ${names.length - max}`;
}
```

In the card, the line `{counts.norme} norme · {counts.note} note` becomes two lines: the acts (`line-clamp-2`, `text-slate-700 dark:text-slate-300`, absent when empty), then `{counts.note} nota/note` with the star count as today (the «norme» count goes: the acts say it better).

- [ ] **Step 4: Run them to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/features/dossier/dossierLayout.ts apps/web/src/components/features/dossier/dossierLayout.test.ts apps/web/src/components/features/dossier/DossierListView.tsx apps/web/src/components/features/dossier/DossierListView.test.tsx
git commit -m "feat(web): a dossier card names the acts it holds"
```

### Task 12: The PDF, grouped by act, with every text

**Files:**
- Create: `apps/web/src/components/features/dossier/dossierPdf.ts` (the pure section builder and the text loader)
- Test: `apps/web/src/components/features/dossier/dossierPdf.test.ts`
- Modify: `apps/web/src/components/features/dossier/DossierDetailView.tsx` (`handleExportPdf` draws the sections; progress on the «Esporta» menu)
- Modify: `apps/web/src/components/features/dossier/dossierUtils.ts` (`dossierItemPdfTitle` goes if nothing else uses it)

**Interfaces:**
- Consumes: `layoutDossier`, `articleLabel` (Task 4), `fetchArticleForNorma` (`utils/articleFetchCache.ts`), `describeVersion`, `historicalItemLabel` (`utils/versionDisplay.ts`), `getRubricText` + `parseArticleStructure`.
- Produces:

```ts
export type PdfBlock =
  | { kind: 'notes'; notes: string[] }
  | { kind: 'act'; heading: string; title: string | null; articles: PdfArticle[] };
export interface PdfArticle { label: string; rubrica: string | null; versionLabel: string | null; text: string; missing: 'none' | 'blocked' | 'unavailable'; }
export interface LoadedText { text: string | null; blockedReason?: string; rubrica?: string | null; }
export async function loadDossierTexts(items: DossierItem[], onProgress: (done: number, total: number) => void): Promise<Map<string, LoadedText>>;
export function buildPdfBlocks(items: DossierItem[], texts: Map<string, LoadedText>, titles: Map<string, string | null>): PdfBlock[];
```

Rules (spec §9): an item's own stored `article_text` is **not** used — the PDF prints the text the reader shows, fetched through the cache (it is cached already for every row opened); a text whose `describeVersion(validity, norma).canCopyOrSave` is false prints `copyBlockedReason`; a failed fetch prints «Testo non disponibile al momento»; HTML is stripped as today; the act titles come from the session cache (`fetchActRubriche`, already fetched by the blocks on screen — `titles` maps act key → title, missing = none).

- [ ] **Step 1: Write the failing tests** — mock `../../../utils/articleFetchCache`:

```ts
it('fetches each text once, reports progress, and keeps going past a failure', async () => {
  fetchArticleForNorma
    .mockResolvedValueOnce({ article_text: '1. Testo.', norma_data: {}, validity: { state: 'current' } })
    .mockRejectedValueOnce(new Error('down'));
  const progress = vi.fn();
  const texts = await loadDossierTexts([a1, b1], progress);
  expect(texts.get(a1.id)).toMatchObject({ text: '1. Testo.' });
  expect(texts.get(b1.id)).toMatchObject({ text: null });
  expect(progress).toHaveBeenLastCalledWith(2, 2);
});

it('says why a text may not be exported', async () => {
  fetchArticleForNorma.mockResolvedValueOnce({ article_text: 'x', norma_data: {}, validity: { state: 'historical', request_in_window: false } });
  const texts = await loadDossierTexts([past], () => {});
  expect(texts.get(past.id)?.blockedReason).toMatch(/non comprende la data richiesta/);
});

it('builds notes first, then each act once with its articles in order', () => {
  const blocks = buildPdfBlocks([a3, note, a1, b1], new Map([
    [a1.id, { text: 'uno' }], [a3.id, { text: 'tre' }], [b1.id, { text: null }],
  ]), new Map([['legge|247|2012-12-31', 'Nuova disciplina']]));
  expect(blocks.map((b) => b.kind)).toEqual(['notes', 'act', 'act']);
  const act = blocks[1] as Extract<PdfBlock, { kind: 'act' }>;
  expect(act).toMatchObject({ heading: 'l. 31 dicembre 2012, n. 247', title: 'Nuova disciplina' });
  expect(act.articles.map((x) => [x.label, x.text])).toEqual([['art. 1', 'uno'], ['art. 3', 'tre']]);
  const other = blocks[2] as Extract<PdfBlock, { kind: 'act' }>;
  expect(other.articles[0]).toMatchObject({ missing: 'unavailable', text: 'Testo non disponibile al momento' });
});
```

(`a1`, `a3`, `b1`, `past`, `note` are fixtures in the file, shaped like Task 10's; `past` has `versione: 'originale', data_versione: '2013-01-01'`.)

- [ ] **Step 2: Run them to verify they fail** — `npm --prefix apps/web run test -- --run dossierPdf`.

- [ ] **Step 3: Implement** `dossierPdf.ts`:

```ts
import type { DossierItem } from '../../../types';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { describeVersion, historicalItemLabel } from '../../../utils/versionDisplay';
import { articleLabel, layoutDossier } from './dossierLayout';

export interface PdfArticle { label: string; rubrica: string | null; versionLabel: string | null; text: string; missing: 'none' | 'blocked' | 'unavailable'; }
export type PdfBlock =
  | { kind: 'notes'; notes: string[] }
  | { kind: 'act'; heading: string; title: string | null; articles: PdfArticle[] };
export interface LoadedText { text: string | null; blockedReason?: string; rubrica?: string | null; }

const UNAVAILABLE = 'Testo non disponibile al momento';

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Every article's text as the reader shows it (spec §9): fetched through the cache, one at a time as the cache allows. */
export async function loadDossierTexts(
  items: DossierItem[],
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, LoadedText>> {
  const norms = items.filter((i): i is Extract<DossierItem, { type: 'norma' }> => i.type === 'norma');
  const texts = new Map<string, LoadedText>();
  let done = 0;
  await Promise.all(norms.map(async (item) => {
    try {
      const article = await fetchArticleForNorma(item.data);
      const display = describeVersion(article.validity, item.data);
      const raw = article.article_text || '';
      texts.set(item.id, display.canCopyOrSave
        ? { text: raw, rubrica: raw ? getRubricText(raw, parseArticleStructure(raw)) : null }
        : { text: null, blockedReason: display.copyBlockedReason });
    } catch (err) {
      console.error('PDF: text unavailable for', item.data.urn ?? item.id, err);
      texts.set(item.id, { text: null });
    } finally {
      done += 1;
      onProgress(done, norms.length);
    }
  }));
  return texts;
}

export function buildPdfBlocks(items: DossierItem[], texts: Map<string, LoadedText>, titles: Map<string, string | null>): PdfBlock[] {
  const layout = layoutDossier(items);
  const blocks: PdfBlock[] = [];
  if (layout.notes.length > 0) blocks.push({ kind: 'notes', notes: layout.notes.map((n) => String(n.data)) });
  for (const act of layout.acts) {
    blocks.push({
      kind: 'act',
      heading: act.heading,
      title: titles.get(act.key) ?? null,
      articles: act.articles.map((item): PdfArticle => {
        const loaded = texts.get(item.id);
        const base = { label: articleLabel(item.data), rubrica: loaded?.rubrica ?? null, versionLabel: historicalItemLabel(item.data) };
        if (loaded?.text) return { ...base, text: plain(loaded.text), missing: 'none' };
        if (loaded?.blockedReason) return { ...base, text: loaded.blockedReason, missing: 'blocked' };
        return { ...base, text: UNAVAILABLE, missing: 'unavailable' };
      }),
    });
  }
  return blocks;
}
```

In `DossierDetailView.tsx`, `handleExportPdf` becomes `async`: set `pdfProgress` state (`{ done, total } | null`), `const texts = await loadDossierTexts(dossier.items, (done, total) => setPdfProgress({ done, total }))`, read the titles from the session cache (`fetchActRubriche(actUrnForBlock(block))` for each act with a URN, `.catch(() => null)`; for codes `null`), then draw: the cover as today; a «Note» section; per act the heading in bold 14pt and the title in italic 10pt under it; per article «art. 3 — rubrica» bold 11pt (plus «· Testo al …» when `versionLabel`), the text 9pt; a missing text in italic grey. At the end, `pdfProgress = null`, and when some texts are `unavailable`, `showToast(\`PDF salvato: ${n} testi non disponibili\`, 'info')`. The «Esporta» trigger shows «Preparo il PDF… 4 di 11» while `pdfProgress` is set, and the «PDF» item is disabled meanwhile.

- [ ] **Step 4: Run them to verify they pass**, the whole web suite and the build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/features/dossier/dossierPdf.ts apps/web/src/components/features/dossier/dossierPdf.test.ts apps/web/src/components/features/dossier/DossierDetailView.tsx apps/web/src/components/features/dossier/dossierUtils.ts apps/web/src/components/features/dossier/dossierUtils.test.ts
git commit -m "feat(web): the dossier PDF is grouped by act and carries every article's text"
```

### Task 13: Docs, and the browser pass

**Files:**
- Modify: `apps/web/CLAUDE.md` (the «Dossier» section, «Shared utilities», «Critical Files», UI Conventions' mention of `SortableDossierItem`)
- Modify: root `CLAUDE.md` only if a statement there became false (it should not)

- [ ] **Step 1: Update `apps/web/CLAUDE.md`**:
  - «Dossier»: the page by act (`dossierLayout.ts`: sections, act identity — a code by name —, order of acts and of articles), `DossierActBlock` (heading from `act_citation` or a code's name, title from `/fetch_rubriche`, fold, «Apri tutto», «+ articoli», «Rimuovi l'atto»), `DossierArticleRow` (not sortable; «art. N — rubrica»), notes first (`DossierNotesSection`), `setDossierItemOrder` (acts reorder; waits on pending ids), the PDF (`dossierPdf.ts`).
  - «Shared utilities»: `utils/actRubriche.ts` (`matchRubrichePart`, `rubricheFor`: never the top-level map for an act in parts), `components/ui/MenuButton.tsx`, `dossierLayout.ts` exports.
  - «Critical Files», `features/dossier/`: replace `SortableDossierItem.tsx (row + star + expand)` and `ToolbarButton.tsx` with the new files.
  - UI Conventions: «scope the role to the header, as `SortableDossierItem` does» → `DossierArticleRow`.

- [ ] **Step 2: Run every suite of the touched areas**

```bash
npm --prefix apps/web run test -- --run && npm --prefix apps/web run build && npm --prefix apps/web run lint
```

- [ ] **Step 3: Browser pass** (spec, Testing and verification): run `npm --prefix apps/web run dev -- --port 5180` from the worktree against the shared backend; create a test account through the app's register page (its credentials are not written anywhere in the repo); build a dossier with articles 1, 3, 25 of l. 247/2012, art. 1 of l. 49/2023, art. 2043 c.c., a past text (art. 3 of l. 247/2012 at 29/12/2015), an article of an annex (d.lgs. 36/2023, Allegato I.1, art. 1), two notes. Check, with screenshots kept out of the repo:
  - each act named once; the title under l. 247/2012 reads «Nuova disciplina dell'ordinamento della professione forense»; no title under «Codice civile»; rubriche on the rows; the annexed row has its rubrica or none, never another part's;
  - fold, drag l. 49/2023 above l. 247/2012, reload: the order holds;
  - expand art. 3, star it, reload: the star holds; «Copia citazione» works;
  - «Rimuovi l'atto» on l. 49/2023, then «Annulla»: it comes back;
  - «Esporta → PDF»: the progress line, then a PDF with the acts grouped and every text present;
  - the list card names the acts; the card's menu works with the keyboard;
  - the index window on the codice civile still shows its rubriche (Task 5's change), and on d.lgs. 196/2003 shows no «Delibera del Garante» on art. 1;
  - 375px wide: no horizontal scroll, the three header buttons wrap, touch targets hold.
  Delete the test account at the end (from the app's account settings).

- [ ] **Step 4: Commit and open PR 2**

```bash
git add apps/web/CLAUDE.md
git commit -m "docs(web): the dossier by act"
```

Whole-branch review, then push, PR into `develop`, merge `merge: feat/dossier-by-act — the dossier is grouped by act, each act named once with its articles beneath it` once CI is green.

---

## PR 3 — decisions in the dossier (`feat/dossier-decisions`) — after Sentenze PR C

### Task 14: «Giurisprudenza»

**Precondition:** Sentenze PR C merged (`DossierItem` has a `sentenza` member, `DossierSentenzaData` with `etichetta`, `item_type: 'sentenza'` on the server). Re-read its Task 13 code and the Sentenze plan's Task 14 (the parts moved here by the orchestrator: `DossierDecisionReader`, the dossier's decision row, `dossierItemPdfSource`), then amend this task if a name differs.

**Files:**
- Create: `apps/web/src/components/features/dossier/DossierDecisionReader.tsx` + test (as specified by the Sentenze plan's Task 14, Step 1 tests and Step 3 code, unchanged)
- Create: `apps/web/src/components/features/dossier/DossierDecisionsSection.tsx` + test
- Modify: `dossierLayout.ts` (`DossierLayout.decisions`; `layoutDossier` puts `sentenza` items there in stored order; `dossierItemOrder` appends them after the acts)
- Modify: `dossierPdf.ts` (`PdfBlock` gains `{ kind: 'decisions'; decisions: { label: string; source: string | null }[] }`)
- Modify: `DossierDetailView.tsx` (the section after the acts; counts line «1 sentenza»)
- Modify: `dossierLayout.ts` `actsSummary` callers: the list card adds «N sentenze»

**Interfaces:**
- Consumes: from PR C — `DossierSentenzaData`, `dossierContainsDecision`, `assertNever`; from the Sentenze plan's Task 14 — `DossierDecisionReader({ sentenza })`, `dossierItemPdfSource(item)`.
- Produces: `DossierLayout.decisions: Extract<DossierItem, { type: 'sentenza' }>[]`; `DossierDecisionsSection({ decisions, expandedIds, onToggleExpand, onRemove, onToggleImportant })`.

- [ ] **Step 1: Write the failing tests** — `dossierLayout.test.ts`: a `sentenza` item lands in `decisions`, not in `acts` or `notes`, and `dossierItemOrder` puts it last. `DossierDecisionsSection.test.tsx`: heading «Giurisprudenza (1)», the row reads the stored `etichetta`, has the star (44px) and remove, and expands to `DossierDecisionReader` (mocked). `dossierPdf.test.ts`: the decisions block follows the acts, with label and source line.
- [ ] **Step 2: Run them to verify they fail** — `npm --prefix apps/web run test -- --run dossierLayout DossierDecisionsSection dossierPdf`.
- [ ] **Step 3: Implement** — the section mirrors `DossierNotesSection`'s frame (neutral colours, `aria-labelledby`), each row the same header-scoped `role="button"` pattern as `DossierArticleRow` with the label `item.data.etichetta` (placeholder until the «convenzione fonti» wording lands — leave a one-line comment saying so) and the accessible name «Espandi {etichetta}».
- [ ] **Step 4: Run every web suite, build, lint.**
- [ ] **Step 5: Browser pass** — add a decision from its page («Aggiungi al dossier»), see it under «Giurisprudenza», expand it, export the PDF.
- [ ] **Step 6: Commit, PR, merge** (`merge: feat/dossier-decisions — decisions sit under «Giurisprudenza», after the acts`).

---

## PR 4 — notes on articles and Claude's mark (`feat/dossier-attached-notes`) — after the MCP round's notes

### Task 15: Attached notes, the mark, the composer

**Precondition:** the MCP second round's PR 1 (`feat/mcp-notes`) merged: `about_item_id` and `created_by: { clientName } | null` on every item in `GET /dossiers` and `GET /dossiers/:id`; `POST /api/dossiers/:id/notes { text, aboutItemId? }` open to the user's session; a note moved to another dossier loses its `about_item_id` (server side: the web only renders what it gets). Re-read the merged route and answers; amend names here if they differ.

**Files:**
- Modify: `types/index.ts` (`DossierItemBase.aboutItemId?: string | null; createdBy?: { clientName: string } | null`), `services/dossierService.ts` (`DossierItemApi.about_item_id?`, `created_by?`; new `addNote(dossierId, { text, aboutItemId })`), `dossierUtils.ts` (`dossierItemFromApi` copies them)
- Modify: `dossierLayout.ts` (`DossierLayout.attached: Map<string, DossierItem[]>`; a note whose `aboutItemId` names an item present in the dossier goes there, otherwise into `notes`)
- Create: `apps/web/src/components/features/dossier/ClaudeMark.tsx` (+ test)
- Modify: `DossierNotesSection.tsx` (the mark), `DossierArticleRow.tsx` (note count when collapsed, the article's notes above the reader when expanded, «Aggiungi nota all'articolo» in the expanded footer), `DossierActBlock.tsx` (passes `attached.get(item.id)`), store (`addNoteToDossier(dossierId, text, aboutItemId?)`: server first, then the store — gotcha 17)
- Test: the layout, the row, the store action, `ClaudeMark`

**Interfaces:**
- Produces: `ClaudeMark({ createdBy })` → «✦ scritta da {clientName} (applicazione collegata)», nothing when `createdBy` is null; `addNoteToDossier(dossierId: string, text: string, aboutItemId?: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests** — layout: a note about `a3` goes to `attached.get('a3')`; a note about a missing id goes to `notes`; `ClaudeMark` renders the sentence with the client's name; the row shows «1 nota» collapsed and the note's text above the reader expanded; `addNoteToDossier` posts to `/dossiers/d1/notes` with `{ text, aboutItemId }` and adds the answered item; on failure nothing is added and a sync error is pushed.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** — the composer in the row reuses `AddNoteModal` (the one free-note composer, round-3 decision 8) with a title «Nota su art. 3, l. 31 dicembre 2012, n. 247»; the dossier-level «Aggiungi → Nota» moves onto `addNoteToDossier` too, so both paths use the same route.
- [ ] **Step 4: Run every web suite, build, lint; browser pass** with a note added through MCP (ask the orchestrator for a Claude Code connection to the dev stack, or create it with the API as the MCP round's e2e does) and one from the web.
- [ ] **Step 5: Commit, PR, merge** (`merge: feat/dossier-attached-notes — notes sit with their article, and Claude's notes say so`).

---

## PR 5 — the trash (`feat/dossier-trash`) — after the MCP round's trash

### Task 16: «Rimossi di recente» and «Cestino»

**Precondition:** the MCP second round's trash merged: `GET /api/trash` → `[{ id, kind: 'DOSSIER' | 'DOSSIER_ITEMS' | 'LINGO_CARDS', dossierId, label, itemCount, items?: { itemType, citation, actCitation }[], cards?: { istituto, domanda }[], clientName, deletedAt, expiresAt }]`; `POST /api/trash/:id/restore { targetDossierId? }` (409 when the dossier is gone and no target is given); `DELETE /api/trash/:id`. Re-read the merged routes and amend here if a name differs.

**Files:**
- Create: `apps/web/src/services/trashService.ts` (+ test with the API client mocked)
- Create: `apps/web/src/components/features/dossier/trashSummary.ts` (+ test): `trashItemsSummary(items)` → «l. 31 dicembre 2012, n. 247: artt. 3, 25 · 1 nota», grouping by `actCitation`, articles from `citation`
- Create: `apps/web/src/components/features/dossier/DossierRecentlyRemoved.tsx` (+ test): the row at the bottom of a dossier, its `DOSSIER_ITEMS` entries, each «Ripristina» (restores, then refetches the dossier through `fetchUserData` or a dossier-scoped reload — choose the narrower one available in the store) and «Elimina definitivamente» (danger `ConfirmDialog`)
- Create: `apps/web/src/components/features/dossier/TrashPage.tsx` (+ test) — the global «Cestino», reached from a «Cestino (n)» link in `DossierListView`'s header (route `?trash=1` inside `/dossier`, handled by `DossierPage`), listing every kind: dossiers, items «da {dossier}», «Schede LingoLex» with the first 2–3 questions and «e altre N»; restore of an entry whose dossier is gone asks for the target dossier (a select of the user's dossiers)
- Modify: `DossierDetailView.tsx`, `DossierListView.tsx`, `DossierPage.tsx`

**Interfaces:**
- Produces: `trashService.list(): Promise<TrashEntry[]>`, `restore(id, targetDossierId?)`, `purge(id)`; `TrashEntry` as the precondition's shape.

- [ ] **Step 1: Write the failing tests** for `trashSummary`, the service, the row (hidden when the dossier has no entries; restore calls the service and reloads), the page (all three kinds, the 409 path asks for a dossier, LingoLex cards only here).
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement**; the dossier's own deletions in the web keep their undo toast (S10): nothing in the web writes to the trash.
- [ ] **Step 4: Run every web suite, build, lint; browser pass** with an entry trashed through the API as the MCP round's e2e does.
- [ ] **Step 5: Commit, PR, merge** (`merge: feat/dossier-trash — what Claude removed can be restored from the dossier and from the trash`).
