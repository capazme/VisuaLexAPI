# Dossier Oriented to Real Work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dossier a working file: article text readable in place (expandable rows), two-click collection from any article surface (AddToDossierPopover), reading statuses removed in favor of a single persisted "important" star.

**Architecture:** Pure utilities first (keys, citation, content envelope), then store changes (async `createDossier`, star persistence through the opaque `content` JSON — no backend change), then three UI waves: status removal, expandable rows with a new `DossierItemReader`, and the collection popover wired into `ReadingToolbar` and `LooseArticleCard`.

**Tech Stack:** React 18 + TypeScript, Zustand + Immer, Tailwind, @floating-ui/react, dnd-kit, Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-24-dossier-lavoro-reale-design.md`

## Global Constraints

- Frontend root: `frontend/` inside the worktree; all paths below are relative to `frontend/` unless prefixed.
- UI copy in Italian; code, comments, commits in English. Conventional Commits.
- **Owner rule — no auto-commit:** at every commit step, the commit message is prepared and the commit is executed only if the owner pre-authorized per-task commits at kickoff; otherwise accumulate and propose at the end of the task.
- **No backend/Prisma changes.** The only persistence vehicle for the star is the opaque `content` JSON accepted by `dossierService.updateItem` (`DossierItemUpdate` has no status field — verified).
- Every server-backed mutation follows optimistic + sync + revert-on-error (CLAUDE.md gotcha #17). No silent `.catch(() => fallback)` (gotcha #18).
- Popovers: outer div = floating-ui positioning, inner div = entry animation; DOM anchor passed via `useFloating({ elements: { reference } })` at render time (gotchas #10/#13). Keyboard collapsibles per CLAUDE.md conventions.
- Never `window.confirm` — `ConfirmDialog variant="danger"`.
- Existing lint/test/build errors surfaced while running gates are fixed, not deferred (owner's standing feedback). If >30 legacy lint errors in files NOT touched by this round surface, checkpoint with the owner before fixing them all.
- `DossierItem.status` union in `types/index.ts` keeps all 4 legacy values (old data still hydrates); only `'important' | 'unread'` are ever written from now on.
- The star applies to `type: 'norma'` items only: note items store `data` as a raw string, which cannot carry the `_dossierMeta` envelope. (Deviation from spec §2 discovered during research — report it to the owner in the final summary.)

---

### Task 1: Pure utilities — keys, citation, content envelope, counts

**Files:**
- Create: `src/utils/normaKeys.ts`
- Modify: `src/utils/articleIds.ts` (add `uniqueArticleIdFromNorma`, delegate `getUniqueArticleId`)
- Modify: `src/utils/normaMeta.ts` (add `formatCitation`)
- Modify: `src/components/features/dossier/dossierUtils.ts` (add 5 functions)
- Modify: `src/components/features/search/ArticleTabContent.tsx:114-128` (use the extracted key builders) and `:424` (use `formatCitation`; also `handleAdvancedCopy` ~l.268 and `handleMobileCopy` ~l.290 — same template literal)
- Test: `src/utils/normaKeys.test.ts`, `src/components/features/dossier/dossierUtils.test.ts`

**Interfaces:**
- Consumes: `NormaVisitata`, `Dossier`, `DossierItem`, `SearchParams` from `src/types/index.ts`; `normalizeArticleId` from `src/utils/treeUtils.ts`.
- Produces (later tasks rely on these exact signatures):
  - `buildItemKey(norma: NormaVisitata): string`
  - `uniqueArticleIdFromNorma(norma: Pick<NormaVisitata, 'allegato' | 'numero_articolo'>): string`
  - `formatCitation(norma: Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo' | 'allegato'>): string`
  - `searchParamsFromNorma(norma: NormaVisitata): SearchParams`
  - `packItemContent(data: unknown, status?: DossierItem['status']): unknown`
  - `unpackItemContent(content: unknown): { data: unknown; status?: 'important' }`
  - `computeItemCounts(items: DossierItem[]): { norme: number; note: number; important: number }`
  - `dossierRecency(d: Dossier): number`
  - `dossierContainsArticle(dossier: Dossier, norma: NormaVisitata): boolean`

- [ ] **Step 1: Write the failing tests**

`src/utils/normaKeys.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildItemKey, uniqueArticleIdFromNorma } from './normaKeys';

const cc2043 = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262',
  numero_articolo: '2043',
};

describe('buildItemKey', () => {
  it('sanitizes and joins parts with --', () => {
    expect(buildItemKey(cc2043 as never)).toBe('codice-civile--262--1942-03-16--2043');
  });
  it('includes allegato as allN segment', () => {
    expect(buildItemKey({ ...cc2043, allegato: '2' } as never))
      .toBe('codice-civile--262--1942-03-16--all2--2043');
  });
  it('skips empty optional parts', () => {
    expect(buildItemKey({ tipo_atto: 'costituzione', data: '', numero_articolo: '3' } as never))
      .toBe('costituzione--3');
  });
});

describe('uniqueArticleIdFromNorma', () => {
  it('plain number without annex', () => {
    expect(uniqueArticleIdFromNorma({ numero_articolo: '2043' })).toBe('2043');
  });
  it('allN: prefix with annex', () => {
    expect(uniqueArticleIdFromNorma({ allegato: 'A', numero_articolo: '1' })).toBe('allA:1');
  });
});
```

`src/components/features/dossier/dossierUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  searchParamsFromNorma, packItemContent, unpackItemContent,
  computeItemCounts, dossierRecency, dossierContainsArticle,
} from './dossierUtils';
import type { Dossier, DossierItem, NormaVisitata } from '../../../types';

const norma: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043',
};
const item = (over: Partial<DossierItem>): DossierItem => ({
  id: 'i1', type: 'norma', data: norma, addedAt: '2026-08-01T10:00:00.000Z', ...over,
});
const dossier = (items: DossierItem[]): Dossier => ({
  id: 'd1', title: 'Pratica', createdAt: '2026-07-01T09:00:00.000Z', items,
});

describe('searchParamsFromNorma', () => {
  it('maps NormaVisitata to SearchParams honoring stored version', () => {
    expect(searchParamsFromNorma({ ...norma, versione: 'originale', data_versione: '1990-01-01', allegato: '2' }))
      .toEqual({
        act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '2043',
        version: 'originale', version_date: '1990-01-01', show_brocardi_info: true, annex: '2',
      });
  });
  it('defaults to vigente and empty version_date', () => {
    const p = searchParamsFromNorma(norma);
    expect(p.version).toBe('vigente');
    expect(p.version_date).toBe('');
    expect(p).not.toHaveProperty('annex');
  });
});

describe('pack/unpackItemContent', () => {
  it('round-trips an important norma item', () => {
    const packed = packItemContent(norma, 'important');
    expect((packed as Record<string, unknown>)._dossierMeta).toEqual({ important: true });
    expect(unpackItemContent(packed)).toEqual({ data: norma, status: 'important' });
  });
  it('strips stale meta when status is not important', () => {
    const packed = packItemContent({ ...norma, _dossierMeta: { important: true } }, 'unread');
    expect(packed).toEqual(norma);
    expect(unpackItemContent(packed)).toEqual({ data: norma });
  });
  it('passes raw strings through untouched (note items)', () => {
    expect(packItemContent('appunto', 'important')).toBe('appunto');
    expect(unpackItemContent('appunto')).toEqual({ data: 'appunto' });
  });
});

describe('computeItemCounts', () => {
  it('counts norme, note and important', () => {
    expect(computeItemCounts([
      item({}), item({ id: 'i2', status: 'important' }),
      item({ id: 'i3', type: 'note', data: 'memo' }),
      item({ id: 'i4', status: 'done' }), // legacy value: not important
    ])).toEqual({ norme: 3, note: 1, important: 1 });
  });
});

describe('dossierRecency', () => {
  it('is the max of createdAt and item addedAt', () => {
    const d = dossier([item({ addedAt: '2026-08-20T10:00:00.000Z' })]);
    expect(dossierRecency(d)).toBe(new Date('2026-08-20T10:00:00.000Z').getTime());
  });
  it('falls back to createdAt for empty dossiers', () => {
    expect(dossierRecency(dossier([]))).toBe(new Date('2026-07-01T09:00:00.000Z').getTime());
  });
});

describe('dossierContainsArticle', () => {
  it('matches same act + normalized article id', () => {
    expect(dossierContainsArticle(dossier([item({})]), { ...norma })).toBe(true);
  });
  it('tolerates -bis formatting differences', () => {
    const stored = item({ data: { ...norma, numero_articolo: '2043-bis' } });
    expect(dossierContainsArticle(dossier([stored]), { ...norma, numero_articolo: '2043 bis' })).toBe(true);
  });
  it('rejects different act or article', () => {
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, numero_articolo: '2059' })).toBe(false);
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, tipo_atto: 'codice penale' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/utils/normaKeys.test.ts src/components/features/dossier/dossierUtils.test.ts`
Expected: FAIL — modules/functions not found.

- [ ] **Step 3: Implement `src/utils/normaKeys.ts`**

Extract verbatim the logic currently inlined in `ArticleTabContent.tsx:114-128`:

```ts
import type { NormaVisitata } from '../types';

const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();

/**
 * Store-level norm+article key. MUST stay byte-identical to the memo that
 * lived in ArticleTabContent — annotations/highlights are keyed on it, so a
 * drift would orphan every existing annotation.
 */
export function buildItemKey(norma: NormaVisitata): string {
  const parts = [norma.tipo_atto];
  if (norma.numero_atto?.trim()) parts.push(norma.numero_atto);
  if (norma.data?.trim()) parts.push(norma.data);
  if (norma.allegato?.trim()) parts.push(`all${norma.allegato}`);
  if (norma.numero_articolo?.trim()) parts.push(norma.numero_articolo);
  return parts.map(part => sanitize(part || '')).join('--');
}

export function uniqueArticleIdFromNorma(
  norma: Pick<NormaVisitata, 'allegato' | 'numero_articolo'>,
): string {
  return norma.allegato ? `all${norma.allegato}:${norma.numero_articolo}` : norma.numero_articolo;
}
```

- [ ] **Step 4: Add `formatCitation` to `src/utils/normaMeta.ts`**

```ts
export function formatCitation(
  norma: Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo' | 'allegato'>,
): string {
  return `${norma.tipo_atto}${norma.numero_atto ? ` n. ${norma.numero_atto}` : ''}${norma.data ? ` del ${norma.data}` : ''}, Art. ${norma.numero_articolo}${norma.allegato ? ` (Allegato ${norma.allegato})` : ''}`;
}
```

(Import `NormaVisitata` type if the file doesn't already.)

- [ ] **Step 5: Add the five functions to `dossierUtils.ts`**

```ts
import { normalizeArticleId } from '../../../utils/treeUtils';
import { uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import type { Dossier, DossierItem, NormaVisitata, SearchParams } from '../../../types';

export function searchParamsFromNorma(norma: NormaVisitata): SearchParams {
  return {
    act_type: norma.tipo_atto,
    act_number: norma.numero_atto || '',
    date: norma.data || '',
    article: norma.numero_articolo?.toString() || '',
    // Honor the stored version: a dossier can hold a historical text and the
    // reader must not silently swap it for the current one.
    version: (norma.versione as SearchParams['version']) || 'vigente',
    version_date: norma.data_versione || '',
    show_brocardi_info: true,
    ...(norma.allegato ? { annex: norma.allegato } : {}),
  };
}

interface DossierMeta { important?: boolean }

export function packItemContent(data: unknown, status?: DossierItem['status']): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const { _dossierMeta: _stale, ...rest } = data as Record<string, unknown>;
  return status === 'important' ? { ...rest, _dossierMeta: { important: true } } : rest;
}

export function unpackItemContent(content: unknown): { data: unknown; status?: 'important' } {
  if (typeof content !== 'object' || content === null) return { data: content };
  const { _dossierMeta, ...rest } = content as Record<string, unknown> & { _dossierMeta?: DossierMeta };
  return _dossierMeta?.important ? { data: rest, status: 'important' } : { data: rest };
}

export function computeItemCounts(items: DossierItem[]): { norme: number; note: number; important: number } {
  let norme = 0, note = 0, important = 0;
  for (const i of items) {
    if (i.type === 'norma') norme++; else note++;
    if (i.status === 'important') important++;
  }
  return { norme, note, important };
}

export function dossierRecency(d: Dossier): number {
  const times = [d.createdAt, ...d.items.map(i => i.addedAt)]
    .map(t => new Date(t).getTime())
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

export function dossierContainsArticle(dossier: Dossier, norma: NormaVisitata): boolean {
  const target = normalizeArticleId(uniqueArticleIdFromNorma(norma));
  return dossier.items.some((i) => {
    if (i.type !== 'norma') return false;
    const d = i.data as NormaVisitata;
    return d.tipo_atto === norma.tipo_atto
      && (d.numero_atto || '') === (norma.numero_atto || '')
      && (d.data || '') === (norma.data || '')
      && normalizeArticleId(uniqueArticleIdFromNorma(d)) === target;
  });
}
```

Check `normalizeArticleId`'s actual export in `src/utils/treeUtils.ts` before importing; adjust the `dossierContainsArticle` -bis test expectation only if its normalization semantics differ from "space and dash equivalent".

- [ ] **Step 6: Delegate in `articleIds.ts`**

Replace the body of `getUniqueArticleId` with a delegation to keep one source:

```ts
import { uniqueArticleIdFromNorma } from './normaKeys';

export function getUniqueArticleId(article: ArticleData): string {
  return uniqueArticleIdFromNorma(article.norma_data);
}
```

Re-export for convenience: `export { uniqueArticleIdFromNorma } from './normaKeys';`

- [ ] **Step 7: Swap ArticleTabContent to the shared utils**

In `ArticleTabContent.tsx`:
- `itemKey` memo (l.114-123) → `useMemo(() => buildItemKey(norma_data), [norma_data.tipo_atto, norma_data.numero_atto, norma_data.data, norma_data.allegato, norma_data.numero_articolo])`
- `uniqueArticleId` memo (l.125-128) → `useMemo(() => uniqueArticleIdFromNorma(norma_data), [norma_data.allegato, norma_data.numero_articolo])`
- The three inline citation template literals (`handleAdvancedCopy` ~268, `handleMobileCopy` ~290, `handlePopupCopy` ~424): keep each handler's own prefix/suffix (`\n\n---\nTratto da: ` etc.) but build the core string with `formatCitation(norma_data)`.

- [ ] **Step 8: Run tests + typecheck**

Run: `cd frontend && npx vitest run src/utils/normaKeys.test.ts src/components/features/dossier/dossierUtils.test.ts && npx tsc --noEmit -p tsconfig.app.json` (use `npm run build` if no separate typecheck script)
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/utils/normaKeys.ts frontend/src/utils/normaKeys.test.ts frontend/src/utils/articleIds.ts frontend/src/utils/normaMeta.ts frontend/src/components/features/dossier/dossierUtils.ts frontend/src/components/features/dossier/dossierUtils.test.ts frontend/src/components/features/search/ArticleTabContent.tsx
git commit -m "refactor(dossier): extract norm keys, citation and item-content utilities"
```

---

### Task 2: Store — async createDossier + star persistence

**Files:**
- Modify: `src/store/useAppStore.ts:277` (interface), `:285` (interface), `:1140-1173` (createDossier), `:1299-1313` (restoreDossierItem), `:1342-1350` (updateDossierItemStatus), `:479-491` (fetchUserData dossier hydration)
- Modify: `src/components/ui/DossierModal.tsx` (`handleCreate` now returns a promise — `void` it)
- Test: `src/store/dossierActions.test.ts`

**Interfaces:**
- Consumes: `packItemContent`, `unpackItemContent` from `dossierUtils` (Task 1); `dossierService` from `src/services/dossierService.ts`.
- Produces: `createDossier(title: string, description?: string): Promise<string | null>` (server id or null on failure); `updateDossierItemStatus(dossierId: string, itemId: string, status: 'unread' | 'important'): void` (optimistic + server sync via `updateItem({ content })`, revert on error).

- [ ] **Step 1: Write the failing test**

`src/store/dossierActions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/dossierService', () => ({
  dossierService: {
    getAll: vi.fn(async () => []),
    getById: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 'srv-1', name: 'Pratica', items: [], created_at: '2026-08-25T00:00:00Z', updated_at: '2026-08-25T00:00:00Z' })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => {}),
    addItem: vi.fn(async () => ({ id: 'item-srv-1' })),
    updateItem: vi.fn(async () => ({})),
    deleteItem: vi.fn(async () => {}),
    reorderItems: vi.fn(async () => {}),
  },
}));

import { useAppStore } from './useAppStore';
import { dossierService } from '../services/dossierService';

const norma = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043' };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ dossiers: [] });
});

describe('createDossier', () => {
  it('resolves to the server id and swaps it into the store', async () => {
    const id = await useAppStore.getState().createDossier('Pratica');
    expect(id).toBe('srv-1');
    expect(useAppStore.getState().dossiers[0].id).toBe('srv-1');
  });
  it('returns null and rolls back on failure', async () => {
    vi.mocked(dossierService.create).mockRejectedValueOnce(new Error('boom'));
    const id = await useAppStore.getState().createDossier('Pratica');
    expect(id).toBeNull();
    expect(useAppStore.getState().dossiers).toHaveLength(0);
  });
});

describe('updateDossierItemStatus', () => {
  it('persists the star via updateItem with the _dossierMeta envelope', async () => {
    useAppStore.setState({
      dossiers: [{ id: 'd1', title: 'P', createdAt: '2026-08-01', items: [
        { id: 'i1', type: 'norma', data: norma, addedAt: '2026-08-01' },
      ] }],
    });
    useAppStore.getState().updateDossierItemStatus('d1', 'i1', 'important');
    expect(useAppStore.getState().dossiers[0].items[0].status).toBe('important');
    await vi.waitFor(() => expect(dossierService.updateItem).toHaveBeenCalledWith(
      'd1', 'i1', { content: { ...norma, _dossierMeta: { important: true } } },
    ));
  });
  it('reverts the optimistic status when the server rejects', async () => {
    vi.mocked(dossierService.updateItem).mockRejectedValueOnce(new Error('boom'));
    useAppStore.setState({
      dossiers: [{ id: 'd1', title: 'P', createdAt: '2026-08-01', items: [
        { id: 'i1', type: 'norma', data: norma, addedAt: '2026-08-01', status: 'unread' },
      ] }],
    });
    useAppStore.getState().updateDossierItemStatus('d1', 'i1', 'important');
    await vi.waitFor(() =>
      expect(useAppStore.getState().dossiers[0].items[0].status).toBe('unread'));
  });
});
```

If importing `useAppStore` in jsdom fails on some other service's side effects, add the same `vi.mock` shape for the service named in the error (they are all plain fetch-wrapping objects); do not weaken the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/store/dossierActions.test.ts`
Expected: FAIL — `createDossier` resolves `undefined` (currently returns void), `updateItem` never called.

- [ ] **Step 3: Implement the store changes**

Interface (l.277, l.285):

```ts
createDossier: (title: string, description?: string) => Promise<string | null>;
updateDossierItemStatus: (dossierId: string, itemId: string, status: 'unread' | 'important') => void;
```

`createDossier` (replace l.1140-1173):

```ts
createDossier: async (title, description) => {
    const tempId = uuidv4();
    set((state) => {
        state.dossiers.push({
            id: tempId, title, description,
            createdAt: new Date().toISOString(), items: [],
        });
    });
    try {
        const created = await dossierService.create({ name: title, description });
        set((state) => {
            const dossier = state.dossiers.find(d => d.id === tempId);
            if (dossier) dossier.id = created.id;
        });
        return created.id;
    } catch (err) {
        console.error('Failed to create dossier:', err);
        set((state) => {
            state.dossiers = state.dossiers.filter(d => d.id !== tempId);
        });
        return null;
    }
},
```

`updateDossierItemStatus` (replace l.1342-1350):

```ts
updateDossierItemStatus: (dossierId, itemId, status) => {
    const dossier = get().dossiers.find(d => d.id === dossierId);
    const item = dossier?.items.find(i => i.id === itemId);
    if (!dossier || !item || item.type !== 'norma') return;
    const previous = item.status;
    set((state) => {
        const it = state.dossiers.find(d => d.id === dossierId)?.items.find(i => i.id === itemId);
        if (it) it.status = status;
    });
    dossierService.updateItem(dossierId, itemId, {
        content: packItemContent(item.data, status),
    }).catch(err => {
        console.error('Failed to persist dossier item status:', err);
        set((state) => {
            const it = state.dossiers.find(d => d.id === dossierId)?.items.find(i => i.id === itemId);
            if (it) it.status = previous;
        });
    });
},
```

`restoreDossierItem` (l.1306-1309): change the `content` line to `content: packItemContent(item.data, item.status),` so undo preserves the star server-side.

Hydration (l.484-489):

```ts
items: d.items.map(item => {
    const { data, status } = unpackItemContent(item.content);
    return {
        id: item.id,
        type: item.item_type === 'norm' ? 'norma' : 'note',
        data,
        addedAt: item.created_at,
        ...(status ? { status } : {}),
    };
}),
```

Import at top of the store: `import { packItemContent, unpackItemContent } from '../components/features/dossier/dossierUtils';`

`DossierModal.tsx` `handleCreate`: `void createDossier(newDossierTitle);` (return type changed; behavior unchanged there). Grep for other `createDossier(` callers and `void` them too: `grep -rn "createDossier(" src --include="*.tsx" --include="*.ts"`.

- [ ] **Step 4: Run test + full suite**

Run: `cd frontend && npx vitest run src/store/dossierActions.test.ts && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useAppStore.ts frontend/src/store/dossierActions.test.ts frontend/src/components/ui/DossierModal.tsx
git commit -m "feat(dossier): persist important flag and return server id from createDossier"
```

---

### Task 3: Remove reading statuses; important star on rows and cards

**Files:**
- Modify: `src/components/features/dossier/dossierUtils.ts:1-12,63-79` (drop `STATUS_CONFIG`, `computeStatusBreakdown`, `StatusBreakdownEntry`, unused lucide imports; keep `export type DossierItemStatus`)
- Modify: `src/components/features/dossier/SortableDossierItem.tsx` (drop status dropdown, add star)
- Modify: `src/components/features/dossier/DossierDetailView.tsx` (drop pills row l.454-493, statusFilter l.87/l.118, bulk Stato l.693-726 + `bulkChangeStatus` l.206-212 + its menu state l.89-90 and outside-click wiring)
- Modify: `src/components/features/dossier/DossierListView.tsx:21,383,515-535` (counts line instead of breakdown pills)
- Modify: `src/config/tourConfig.ts:220-228,238-245` (copy no longer mentions statuses)
- Test: `src/components/features/dossier/SortableDossierItem.test.tsx`

**Interfaces:**
- Consumes: `computeItemCounts` (Task 1); `updateDossierItemStatus(dossierId, itemId, 'unread' | 'important')` (Task 2).
- Produces: `SortableDossierItem` props change — `onStatusChange` is REPLACED by `onToggleImportant: () => void`. Task 4 modifies this same props interface again (`onView` → expansion); keep `onView` untouched in this task.

- [ ] **Step 1: Write the failing test**

`src/components/features/dossier/SortableDossierItem.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableDossierItem } from './SortableDossierItem';
import type { DossierItem } from '../../../types';

const normaItem: DossierItem = {
  id: 'i1', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z',
  data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' },
};

function renderRow(item: DossierItem, over: Partial<Parameters<typeof SortableDossierItem>[0]> = {}) {
  return render(
    <DndContext>
      <SortableContext items={[item.id]} strategy={verticalListSortingStrategy}>
        <SortableDossierItem
          item={item} isSelected={false} showCheckbox={false}
          onToggleSelect={() => {}} onView={() => {}} onRemove={() => {}}
          onToggleImportant={() => {}}
          {...over}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe('SortableDossierItem star', () => {
  it('renders an unpressed star for a plain norma item and fires onToggleImportant', () => {
    const onToggleImportant = vi.fn();
    renderRow(normaItem, { onToggleImportant });
    const star = screen.getByRole('button', { name: /segna come importante/i });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    expect(onToggleImportant).toHaveBeenCalledTimes(1);
  });
  it('renders a pressed star for an important item', () => {
    renderRow({ ...normaItem, status: 'important' });
    expect(screen.getByRole('button', { name: /rimuovi da importanti/i }))
      .toHaveAttribute('aria-pressed', 'true');
  });
  it('shows no status menu anymore', () => {
    renderRow(normaItem);
    expect(screen.queryByRole('button', { name: /cambia stato/i })).toBeNull();
  });
  it('hides the star on note items', () => {
    renderRow({ id: 'n1', type: 'note', data: 'appunto di pratica', addedAt: '2026-08-01' });
    expect(screen.queryByRole('button', { name: /importante/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/features/dossier/SortableDossierItem.test.tsx`
Expected: FAIL — `onToggleImportant` prop does not exist; star button not found.

- [ ] **Step 3: Rework `SortableDossierItem.tsx`**

- Props: remove `onStatusChange: (status: DossierItemStatus) => void`; add `onToggleImportant: () => void`.
- Delete: `statusMenuOpen`/`setStatusMenuOpen`/`statusWrapperRef` (l.41-42), the outside-click effect (l.44-60), the status derivation block (l.68-70), the whole status dropdown (l.147-188).
- Add after imports cleanup (`Star` from lucide-react; drop `STATUS_CONFIG`/`DossierItemStatus` import):

```tsx
const isImportant = item.status === 'important';
```

- Stripe span (l.97-100) becomes conditional amber:

```tsx
{isImportant && (
  <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-amber-400" />
)}
```

- Star button, placed where the status dropdown was (between the body block and the remove button), rendered only for `item.type === 'norma'`:

```tsx
{item.type === 'norma' && (
  <button
    onClick={(e) => { e.stopPropagation(); onToggleImportant(); }}
    aria-pressed={isImportant}
    aria-label={isImportant ? 'Rimuovi da importanti' : 'Segna come importante'}
    title={isImportant ? 'Importante' : 'Segna come importante'}
    className={cn(
      'p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
      isImportant
        ? 'text-amber-500'
        : 'text-slate-300 dark:text-slate-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20',
    )}
  >
    <Star size={18} className={cn(isImportant && 'fill-amber-400')} />
  </button>
)}
```

- [ ] **Step 4: Purge statuses from `DossierDetailView.tsx`**

- Delete the pills row block l.454-493 (including the `tour-dossier-stats` id and the clear-X), the `statusFilter` state (l.87) and its filter branch (l.118 — `visibleItems` now filters on search only), the bulk Stato dropdown (l.693-726), `bulkStatusMenuOpen`/`bulkStatusMenuRef` (l.89-90) and their part of the outside-click effect (l.95-111), `bulkChangeStatus` (l.206-212).
- `hasFilter` (l.133) becomes `const hasFilter = itemSearchQuery.trim().length > 0;`
- Call-site (l.793-805): replace `onStatusChange={...}` with

```tsx
onToggleImportant={() => updateDossierItemStatus(dossier.id, item.id, item.status === 'important' ? 'unread' : 'important')}
```

- Remove now-unused imports (`STATUS_CONFIG`, `type DossierItemStatus`, `ListChecks`).

- [ ] **Step 5: Counts line on cards in `DossierListView.tsx`**

- Import `computeItemCounts` (drop `computeStatusBreakdown`, `STATUS_CONFIG` from the l.21 import).
- Replace `const statusBreakdown = computeStatusBreakdown(dossier.items);` (l.383) with `const counts = computeItemCounts(dossier.items);`
- Replace the pills block (l.515-535) with:

```tsx
<p className="mt-2 md:mt-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
  <span>
    {counts.norme} {counts.norme === 1 ? 'norma' : 'norme'} · {counts.note} {counts.note === 1 ? 'nota' : 'note'}
  </span>
  {counts.important > 0 && (
    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
          title={`${counts.important} element${counts.important === 1 ? 'o' : 'i'} importanti`}>
      <Star size={11} className="fill-amber-400 text-amber-400" /> {counts.important}
    </span>
  )}
</p>
```

(`Star` is already imported in this file for the pin; verify, otherwise add it.) The "{n} elementi" badge (l.412-414) stays.

- [ ] **Step 6: Shrink `dossierUtils.ts` and update tour copy**

- Delete `STATUS_CONFIG`, `computeStatusBreakdown`, `StatusBreakdownEntry` and the lucide imports that served them (`Circle`, `BookOpen`, `AlertCircle`, `CheckCircle2`, `LucideIcon`). Keep `export type DossierItemStatus = 'unread' | 'reading' | 'important' | 'done';` (legacy data + types compat).
- `tourConfig.ts:224` card-step description → `'Ogni card mostra titolo, tag, quante norme e note contiene e l\'ultimo aggiornamento. Clicca per aprire.'`
- `tourConfig.ts:241` final-step description → `'Entra in un dossier (clic sulla card) per leggere gli articoli sul posto, riordinare gli elementi, selezionarne in blocco, esportare in PDF/JSON o condividere un link. Buon lavoro!'`

- [ ] **Step 7: Run tests + typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS. The compiler will flag every forgotten status reference — fix each (`AddItemsDialog.tsx:61` keeps compiling because the type union is unchanged).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/features/dossier/ frontend/src/config/tourConfig.ts
git commit -m "feat(dossier): replace reading statuses with a single important star"
```

---

### Task 4: Expandable rows — article text in place

**Files:**
- Create: `src/utils/articleFetchCache.ts`
- Create: `src/components/features/dossier/DossierItemReader.tsx`
- Modify: `src/components/features/dossier/SortableDossierItem.tsx` (expansion props + expanded region)
- Modify: `src/components/features/dossier/DossierDetailView.tsx` (expandedIds state, Espandi tutto, onOpenOnDashboard, remove `viewingItem` + `ArticleViewerModal`)
- Delete: `src/components/features/dossier/ArticleViewerModal.tsx` (only after `grep -rn "ArticleViewerModal" src/` shows no other importer)
- Modify: `src/components/features/dossier/SortableDossierItem.test.tsx` (props updated)
- Test: `src/utils/articleFetchCache.test.ts`

**Interfaces:**
- Consumes: `buildItemKey`, `uniqueArticleIdFromNorma` (Task 1); `searchParamsFromNorma`, `formatCitation` (Task 1); store actions `loadAnnotationsForArticle(normaKey, articleId)`, `loadHighlightsForArticle(normaKey, articleId)`, `addHighlight(normaKey, articleId, text, range, color, startOffset)`, `addAnnotation(normaKey, articleId, text, anchor?)`, `removeHighlight(id)`; `useArticleMarkers({ rawText, highlights, annotations })`; `ArticleBody` (`src/components/features/search/ArticleBody.tsx`, exported `ArticleBodyProps`); `InlineNoteComposer` (`src/components/features/search/InlineNoteComposer.tsx`).
- Produces: `fetchArticleForNorma(norma: NormaVisitata): Promise<ArticleData>` (cached, max 3 concurrent); `clearArticleCache(): void`; `DossierItemReader` props `{ norma: NormaVisitata; onOpenOnDashboard: () => void; showToast: (message: string, type?: 'success' | 'error' | 'info') => void }`; `SortableDossierItem` props REPLACE `onView` with `isExpanded: boolean; onToggleExpand: () => void; onOpenOnDashboard: () => void; showToast: (message: string, type?: 'success' | 'error' | 'info') => void`.

- [ ] **Step 1: Write the failing fetch-cache test**

`src/utils/articleFetchCache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchArticleForNorma, clearArticleCache } from './articleFetchCache';
import type { NormaVisitata } from '../types';

const norma: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043',
};
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => { clearArticleCache(); vi.restoreAllMocks(); });

describe('fetchArticleForNorma', () => {
  it('POSTs /fetch_article_text with the mapped body and returns the first result', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([{ article_text: 'Qualunque fatto...', norma_data: norma }]));
    const res = await fetchArticleForNorma(norma);
    expect(res.article_text).toBe('Qualunque fatto...');
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/fetch_article_text');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16',
      article: '2043', version: 'vigente', show_brocardi_info: false,
    });
  });
  it('caches by norm identity: second call does not refetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([{ article_text: 'testo', norma_data: norma }]));
    await fetchArticleForNorma(norma);
    await fetchArticleForNorma({ ...norma });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('dedupes in-flight requests', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([{ article_text: 'testo', norma_data: norma }]));
    await Promise.all([fetchArticleForNorma(norma), fetchArticleForNorma(norma)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('throws on backend error and does not poison the cache', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok([{ error: 'Articolo non trovato', norma_data: norma }]))
      .mockResolvedValueOnce(ok([{ article_text: 'testo', norma_data: norma }]));
    await expect(fetchArticleForNorma(norma)).rejects.toThrow('Articolo non trovato');
    await expect(fetchArticleForNorma(norma)).resolves.toMatchObject({ article_text: 'testo' });
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('runs at most 3 fetches concurrently', async () => {
    let active = 0, peak = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      const body = JSON.parse((init as RequestInit).body as string);
      return ok([{ article_text: 't', norma_data: { ...norma, numero_articolo: body.article } }]);
    });
    await Promise.all(['1', '2', '3', '4', '5'].map(numero_articolo =>
      fetchArticleForNorma({ ...norma, numero_articolo })));
    expect(peak).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/utils/articleFetchCache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/utils/articleFetchCache.ts`**

```ts
import type { ArticleData, NormaVisitata } from '../types';
import { buildItemKey } from './normaKeys';

// Session-only cache: deliberately NOT persisted and NOT in the Zustand store
// (must never enter the persist partialize).
const cache = new Map<string, ArticleData>();
const inFlight = new Map<string, Promise<ArticleData>>();

// "Espandi tutto" mounts many readers at once; cap parallel scraper calls.
const MAX_CONCURRENT = 3;
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(() => { active++; resolve(); }));
}
function release(): void { active--; waiters.shift()?.(); }

export function clearArticleCache(): void { cache.clear(); inFlight.clear(); }

export function fetchArticleForNorma(norma: NormaVisitata): Promise<ArticleData> {
  const key = buildItemKey(norma);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    await acquire();
    try {
      const response = await fetch('/fetch_article_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          act_type: norma.tipo_atto,
          act_number: norma.numero_atto || '',
          date: norma.data || '',
          article: norma.numero_articolo?.toString() || '',
          version: norma.versione || 'vigente',
          version_date: norma.data_versione || '',
          show_brocardi_info: false,
          ...(norma.allegato ? { annex: norma.allegato } : {}),
        }),
      });
      if (!response.ok) throw new Error(`Errore nella richiesta (${response.status})`);
      const results = (await response.json()) as ArticleData[] | ArticleData;
      const first = Array.isArray(results) ? results[0] : results;
      if (!first || first.error || !first.article_text) {
        throw new Error(first?.error || 'Testo non disponibile');
      }
      cache.set(key, first);
      return first;
    } finally {
      release();
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
```

- [ ] **Step 4: Run fetch-cache test to verify it passes**

Run: `cd frontend && npx vitest run src/utils/articleFetchCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `DossierItemReader.tsx`**

The in-row reading surface. Mirrors the minimal subset of `ArticleTabContent` (its l.114-141 filters, l.165-169 hydration, l.383-435 popup handlers) using the shared utils:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RefreshCw, Copy, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import { ArticleBody } from '../../features/search/ArticleBody';
import { InlineNoteComposer } from '../../features/search/InlineNoteComposer';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { formatCitation } from '../../../utils/normaMeta';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import type { ArticleData, NormaVisitata } from '../../../types';

interface Props {
  norma: NormaVisitata;
  onOpenOnDashboard: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; article: ArticleData };

export function DossierItemReader({ norma, onOpenOnDashboard, showToast }: Props) {
  const [state, setState] = useState<FetchState>({ phase: 'loading' });
  const [retryTick, setRetryTick] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [composer, setComposer] = useState<{
    rect: { x: number; y: number; width: number; height: number };
    anchorText: string; startOffset: number;
  } | null>(null);

  const itemKey = useMemo(() => buildItemKey(norma), [norma]);
  const uniqueArticleId = useMemo(() => uniqueArticleIdFromNorma(norma), [norma]);

  const {
    annotations, highlights,
    addAnnotation, addHighlight, removeHighlight,
    loadAnnotationsForArticle, loadHighlightsForArticle,
  } = useAppStore(useShallow((s) => ({
    annotations: s.annotations, highlights: s.highlights,
    addAnnotation: s.addAnnotation, addHighlight: s.addHighlight,
    removeHighlight: s.removeHighlight,
    loadAnnotationsForArticle: s.loadAnnotationsForArticle,
    loadHighlightsForArticle: s.loadHighlightsForArticle,
  })));

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    fetchArticleForNorma(norma)
      .then((article) => { if (!cancelled) setState({ phase: 'ready', article }); })
      .catch((err: unknown) => {
        if (!cancelled) setState({ phase: 'error', message: err instanceof Error ? err.message : 'Errore di caricamento' });
      });
    return () => { cancelled = true; };
  }, [norma, retryTick]);

  useEffect(() => {
    void loadAnnotationsForArticle(itemKey, uniqueArticleId);
    void loadHighlightsForArticle(itemKey, uniqueArticleId);
  }, [itemKey, uniqueArticleId, loadAnnotationsForArticle, loadHighlightsForArticle]);

  const itemAnnotations = useMemo(
    () => annotations.filter(a => a.normaKey === itemKey && a.articleId === uniqueArticleId),
    [annotations, itemKey, uniqueArticleId],
  );
  const articleHighlights = useMemo(
    () => highlights.filter(h => h.normaKey === itemKey && h.articleId === uniqueArticleId),
    [highlights, itemKey, uniqueArticleId],
  );

  const rawText = state.phase === 'ready' ? (state.article.article_text || '') : '';
  const markedHtml = useArticleMarkers({ rawText, highlights: articleHighlights, annotations: itemAnnotations });

  const handleCopyCitation = async () => {
    try {
      await navigator.clipboard.writeText(formatCitation(norma));
      showToast('Citazione copiata', 'success');
    } catch {
      showToast('Errore durante la copia', 'error');
    }
  };

  if (state.phase === 'loading') {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2 text-sm text-slate-400">
        <RefreshCw size={14} className="animate-spin" /> Recupero del testo…
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-sm text-red-600 dark:text-red-400 flex items-center gap-3">
        <span>{state.message}</span>
        <button
          onClick={() => setRetryTick(t => t + 1)}
          className="font-semibold underline underline-offset-2 hover:no-underline"
        >
          Riprova
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
      <ArticleBody
        contentRef={contentRef}
        itemKey={itemKey}
        processedContent={markedHtml}
        panelHighlights={articleHighlights}
        onPopupHighlight={(text, color, startOffset) => {
          addHighlight(itemKey, uniqueArticleId, text, '', color, startOffset);
        }}
        onPopupAddNote={(text, startOffset, rect) => {
          setComposer({ rect, anchorText: text, startOffset });
        }}
        onPopupCopy={async (text) => {
          await navigator.clipboard.writeText(`${text}\n\n---\nTratto da: ${formatCitation(norma)}`);
          showToast('Testo copiato con citazione', 'success');
        }}
        onRemoveHighlight={removeHighlight}
      />
      {composer && (
        <InlineNoteComposer
          anchorRect={composer.rect}
          anchorText={composer.anchorText}
          onSave={(text) => {
            addAnnotation(itemKey, uniqueArticleId, text, {
              anchorText: composer.anchorText, startOffset: composer.startOffset,
            });
            setComposer(null);
            showToast('Nota aggiunta', 'success');
          }}
          onClose={() => setComposer(null)}
        />
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          onClick={handleCopyCitation}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <Copy size={13} /> Copia citazione
        </button>
        <button
          onClick={onOpenOnDashboard}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <ExternalLink size={13} /> Apri su Dashboard
        </button>
      </div>
    </div>
  );
}
```

Verify `InlineNoteComposer`'s actual prop names (`anchorRect`, `anchorText`, `onSave`, `onClose`) against the file before wiring; adapt this call site (not the composer) if they differ. Same for the highlight dedup: if `ArticleTabContent.handlePopupHighlight` (l.383-391) guards against duplicate anchors, replicate the same guard here.

- [ ] **Step 6: Rework `SortableDossierItem.tsx` for expansion**

- Props: REPLACE `onView: () => void` with:

```ts
isExpanded: boolean;
onToggleExpand: () => void;
onOpenOnDashboard: () => void;
showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
```

- `rowLabel` (l.72-74): `Espandi`/`Comprimi` phrasing, e.g. `` `${isExpanded ? 'Comprimi' : 'Espandi'} ${item.data.tipo_atto} …` `` for norma, `'Espandi nota'`/`'Comprimi nota'` for note.
- Root div: `onClick={onToggleExpand}` (l.83) and same swap in the keydown handler (l.87); add `aria-expanded={isExpanded}`.
- Add a chevron affordance at the right end of the flex row (before the remove button):

```tsx
<ChevronDown
  size={18} aria-hidden
  className={cn('text-slate-400 transition-transform flex-shrink-0', isExpanded && 'rotate-180')}
/>
```

- Expanded region, INSIDE the root div, after the flex row (so the stripe spans it):

```tsx
{isExpanded && (
  item.type === 'norma' ? (
    <DossierItemReader
      norma={item.data}
      onOpenOnDashboard={onOpenOnDashboard}
      showToast={showToast}
    />
  ) : (
    <p
      onClick={(e) => e.stopPropagation()}
      className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-sm md:text-base text-slate-700 dark:text-slate-300 whitespace-pre-wrap"
    >
      {item.data}
    </p>
  )
)}
```

- The collapsed note preview (l.140) keeps `truncate`; the expanded block shows the full text.

- [ ] **Step 7: Wire expansion state in `DossierDetailView.tsx`**

- State: `const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());`

```ts
const toggleExpanded = (id: string) => setExpandedIds((prev) => {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
});
const allExpanded = visibleItems.length > 0 && visibleItems.every(i => expandedIds.has(i.id));
```

- Rename `handleDossierItemClick` → `openItemOnDashboard(item: DossierItem)`; body keeps ONLY the norma branch, now via the shared mapper: `navigate('/'); triggerSearch(searchParamsFromNorma(item.data));`. Delete `setViewingItem`, the `viewingItem` state (l.79) and the `ArticleViewerModal` render (l.820-822).
- Call site (l.793-805): replace `onView={...}` with

```tsx
isExpanded={expandedIds.has(item.id)}
onToggleExpand={() => toggleExpanded(item.id)}
onOpenOnDashboard={() => openItemOnDashboard(item)}
showToast={showToast}
```

- "Espandi tutto" toggle inside the search-row container (l.642), right-aligned next to the input, visible when `dossier.items.length > 0`:

```tsx
<button
  onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(visibleItems.map(i => i.id)))}
  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors whitespace-nowrap"
  aria-pressed={allExpanded}
>
  {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
  {allExpanded ? 'Comprimi tutto' : 'Espandi tutto'}
</button>
```

(icons from lucide-react). The fetch concurrency cap lives in `articleFetchCache`, so expand-all needs no extra orchestration here.
- `grep -rn "ArticleViewerModal" src/` — if the only hits were this view, delete `ArticleViewerModal.tsx`.

- [ ] **Step 8: Update the row test for the new props**

In `SortableDossierItem.test.tsx`: replace `onView={() => {}}` with `isExpanded={false} onToggleExpand={() => {}} onOpenOnDashboard={() => {}} showToast={() => {}}` in the harness, and add:

```tsx
it('expands a note item in place on row click', () => {
  const noteItem: DossierItem = { id: 'n1', type: 'note', data: 'appunto di pratica completo', addedAt: '2026-08-01' };
  const { rerender } = renderRow(noteItem);
  const row = screen.getByRole('button', { name: /espandi nota/i });
  expect(row).toHaveAttribute('aria-expanded', 'false');
  // Parent owns the state: assert the callback fires, then re-render expanded.
  const onToggleExpand = vi.fn();
  rerender(
    <DndContext>
      <SortableContext items={[noteItem.id]} strategy={verticalListSortingStrategy}>
        <SortableDossierItem
          item={noteItem} isSelected={false} showCheckbox={false}
          onToggleSelect={() => {}} onRemove={() => {}} onToggleImportant={() => {}}
          isExpanded={true} onToggleExpand={onToggleExpand}
          onOpenOnDashboard={() => {}} showToast={() => {}}
        />
      </SortableContext>
    </DndContext>,
  );
  expect(screen.getByText('appunto di pratica completo')).toBeInTheDocument();
});
```

- [ ] **Step 9: Run tests + typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/utils/articleFetchCache.ts frontend/src/utils/articleFetchCache.test.ts frontend/src/components/features/dossier/
git commit -m "feat(dossier): expandable rows with in-place article reading"
```

---

### Task 5: AddToDossierPopover — two-click collection

**Files:**
- Create: `src/components/features/dossier/AddToDossierPopover.tsx`
- Modify: `src/components/features/search/ReadingToolbar.tsx` (promote the dossier button out of the More menu; add `dossierButtonRef` prop)
- Modify: `src/components/features/search/ArticleTabContent.tsx` (replace `DossierModal` with the popover; l.77, l.583, l.701-706)
- Modify: `src/components/features/workspace/LooseArticleCard.tsx` (add button + popover; replace `window.confirm` with `ConfirmDialog`)
- Modify: `src/components/ui/DossierModal.tsx` (drop the now-dead `itemToAdd`/`itemType` add-mode)
- Test: `src/components/features/dossier/AddToDossierPopover.test.tsx`

**Interfaces:**
- Consumes: `dossierRecency`, `dossierContainsArticle` (Task 1); `createDossier(): Promise<string | null>` (Task 2); `addToDossier(dossierId, item, 'norma')` (store); Toast action API `action?: { label: string; onClick: () => void }` (`src/components/ui/Toast.tsx`).
- Produces:

```ts
interface AddToDossierPopoverProps {
  isOpen: boolean;
  anchorEl: HTMLElement | null;      // desktop anchor; mobile renders as bottom sheet
  onClose: () => void;
  norma: NormaVisitata;
  onAdded: (dossierId: string, dossierTitle: string) => void; // parent toasts + offers "Apri"
}
```

- [ ] **Step 1: Write the failing test**

`src/components/features/dossier/AddToDossierPopover.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    getAll: vi.fn(async () => []), getById: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 'srv-new', name: 'Nuova pratica', items: [], created_at: '2026-08-25T00:00:00Z', updated_at: '2026-08-25T00:00:00Z' })),
    update: vi.fn(async () => ({})), delete: vi.fn(async () => {}),
    addItem: vi.fn(async () => ({ id: 'item-srv' })),
    updateItem: vi.fn(async () => ({})), deleteItem: vi.fn(async () => {}),
    reorderItems: vi.fn(async () => {}),
  },
}));

import { useAppStore } from '../../../store/useAppStore';
import { AddToDossierPopover } from './AddToDossierPopover';
import type { NormaVisitata } from '../../../types';

const norma: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043',
};

beforeEach(() => {
  useAppStore.setState({
    dossiers: [
      { id: 'old', title: 'Pratica vecchia', createdAt: '2026-01-01T00:00:00Z', items: [] },
      { id: 'recent', title: 'Pratica recente', createdAt: '2026-08-01T00:00:00Z', items: [
        { id: 'x', type: 'norma', data: { ...norma, numero_articolo: '2059' }, addedAt: '2026-08-20T00:00:00Z' },
      ] },
      { id: 'dup', title: 'Con duplicato', createdAt: '2026-05-01T00:00:00Z', items: [
        { id: 'y', type: 'norma', data: { ...norma }, addedAt: '2026-05-02T00:00:00Z' },
      ] },
    ],
  });
});

function renderPopover(onAdded = vi.fn()) {
  render(
    <AddToDossierPopover isOpen anchorEl={document.body} onClose={() => {}} norma={norma} onAdded={onAdded} />,
  );
  return onAdded;
}

describe('AddToDossierPopover', () => {
  it('lists dossiers most-recent first', () => {
    renderPopover();
    const options = screen.getAllByRole('button', { name: /pratica|duplicato/i }).map(b => b.textContent);
    expect(options[0]).toContain('Pratica recente');
  });
  it('adds to a dossier and reports through onAdded', () => {
    const onAdded = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: /pratica recente/i }));
    expect(useAppStore.getState().dossiers.find(d => d.id === 'recent')!.items).toHaveLength(2);
    expect(onAdded).toHaveBeenCalledWith('recent', 'Pratica recente');
  });
  it('marks and inhibits dossiers that already contain the article', () => {
    const onAdded = renderPopover();
    const dupRow = screen.getByRole('button', { name: /con duplicato/i });
    expect(dupRow).toHaveTextContent(/già presente/i);
    fireEvent.click(dupRow);
    expect(useAppStore.getState().dossiers.find(d => d.id === 'dup')!.items).toHaveLength(1);
    expect(onAdded).not.toHaveBeenCalled();
  });
  it('creates a dossier inline with the server id, then adds', async () => {
    const onAdded = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: /nuovo dossier/i }));
    fireEvent.change(screen.getByPlaceholderText(/nome del dossier/i), { target: { value: 'Nuova pratica' } });
    fireEvent.submit(screen.getByRole('form', { name: /crea dossier/i }));
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith('srv-new', 'Nuova pratica'));
    const created = useAppStore.getState().dossiers.find(d => d.id === 'srv-new')!;
    expect(created.items).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/features/dossier/AddToDossierPopover.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AddToDossierPopover.tsx`**

Follow the floating-ui conventions (outer positioning / inner animation, anchor via `elements: { reference: anchorEl }`, `flip` + `shift` + `offset(8)` middleware, Escape + outside-click close, `getTransformOrigin` pattern from `NotesPeekPanel.tsx`). Desktop: anchored panel `w-72`; mobile (`window.matchMedia('(min-width: 768px)')` false or no `anchorEl`): fixed bottom sheet `fixed inset-x-4 bottom-4 z-[70]`. Body:

```tsx
export function AddToDossierPopover({ isOpen, anchorEl, onClose, norma, onAdded }: AddToDossierPopoverProps) {
  const { dossiers, addToDossier, createDossier } = useAppStore(useShallow((s) => ({
    dossiers: s.dossiers, addToDossier: s.addToDossier, createDossier: s.createDossier,
  })));
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...dossiers]
      .filter(d => !q || d.title.toLowerCase().includes(q))
      .sort((a, b) => dossierRecency(b) - dossierRecency(a));
  }, [dossiers, query]);
  const visible = query.trim() ? sorted : sorted.slice(0, 5);

  const handlePick = (dossierId: string) => {
    const target = dossiers.find(d => d.id === dossierId);
    if (!target || dossierContainsArticle(target, norma)) return;
    addToDossier(dossierId, norma, 'norma');
    onAdded(dossierId, target.title);
    onClose();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    const id = await createDossier(title);
    setBusy(false);
    if (!id) return; // creation failed: stay open, the name is not lost
    addToDossier(id, norma, 'norma');
    onAdded(id, title);
    onClose();
  };
  /* render: search input (only when dossiers.length > 5), rows, create form */
}
```

Row rendering: each dossier is a `<button role="button">` with `Folder` icon, title (truncate), `{d.items.length} elementi` in muted text; when `dossierContainsArticle(d, norma)` render a `Check` icon + `già presente` chip, `aria-disabled="true"`, muted style, and the early-return above makes the click inert. Create form: `<form aria-label="Crea dossier" onSubmit={handleCreate}>` with `<input placeholder="Nome del dossier…" autoFocus>` + submit `Crea e aggiungi`, revealed by a `Nuovo dossier…` button (FolderPlus icon, dashed border, mirrors `DossierModal`'s create affordance).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/features/dossier/AddToDossierPopover.test.tsx`
Expected: PASS. (If jsdom trips on floating-ui autoUpdate, gate `autoUpdate` behind `typeof ResizeObserver !== 'undefined'` or mock ResizeObserver in `src/test/setup.ts` — a standard jsdom shim, add it there.)

- [ ] **Step 5: Promote the toolbar button in `ReadingToolbar.tsx`**

- Add prop: `dossierButtonRef?: Ref<HTMLButtonElement | null>;` (mirror `notesButtonRef`, l.13).
- Desktop block: insert after the Copy button (l.199), before the divider (l.201):

```tsx
<button
    ref={dossierButtonRef}
    onClick={onOpenDossier}
    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-colors"
    title="Aggiungi a dossier"
    aria-label="Aggiungi a dossier"
>
    <FolderPlus size={16} />
</button>
```

- Mobile block: same button after the mobile Copy (l.112) with the mobile classes (`p-2 lg:p-2.5 rounded-lg`, `size={20}`), NO ref (mobile popover renders as bottom sheet).
- Remove the "Aggiungi a dossier" entry from the More menu (l.221-230).

- [ ] **Step 6: Swap modal for popover in `ArticleTabContent.tsx`**

- l.77: `const [showDossierModal, setShowDossierModal] = useState(false);` → `const [dossierPopoverOpen, setDossierPopoverOpen] = useState(false);` plus `const [dossierBtnEl, setDossierBtnEl] = useState<HTMLButtonElement | null>(null);` (state, not ref — gotcha #13).
- l.583: `onOpenDossier={() => setDossierPopoverOpen(true)}` and add `dossierButtonRef={setDossierBtnEl}`.
- l.701-706: replace the `<DossierModal …/>` block with:

```tsx
<AddToDossierPopover
    isOpen={dossierPopoverOpen}
    anchorEl={dossierBtnEl}
    onClose={() => setDossierPopoverOpen(false)}
    norma={norma_data}
    onAdded={(dossierId, title) => showToast(`Aggiunto a «${title}»`, 'success')}
/>
```

- The file already has a local `showToast` (l.231) rendered through `Toast` (l.8). The existing `Toast` render call: pass `action={…}` only if its current usage allows; otherwise keep the plain success toast (the "Apri" deep-link stays available from LooseArticleCard/`/dossier` — do NOT rebuild the toast plumbing here; note the simplification in the task report).
- Remove the `DossierModal` import if now unused in this file.

- [ ] **Step 7: LooseArticleCard — button, popover, ConfirmDialog**

In `LooseArticleCard.tsx`:
- Add `useAppStore` is NOT needed — the popover owns store access. Add local state `const [dossierPopoverOpen, setDossierPopoverOpen] = useState(false); const [dossierBtnEl, setDossierBtnEl] = useState<HTMLButtonElement | null>(null); const [toast, setToast] = useState<string | null>(null); const [confirmRemove, setConfirmRemove] = useState(false);`
- New button next to the PDF button (before l.104):

```tsx
<button
    ref={setDossierBtnEl}
    onClick={(e) => { e.stopPropagation(); setDossierPopoverOpen(true); }}
    className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
    title="Aggiungi a dossier"
    aria-label="Aggiungi a dossier"
>
    <FolderPlus size={14} className="text-blue-500 opacity-70 hover:opacity-100" />
</button>
```

- Render `<AddToDossierPopover isOpen={dossierPopoverOpen} anchorEl={dossierBtnEl} onClose={() => setDossierPopoverOpen(false)} norma={looseArticle.article.norma_data} onAdded={(_, title) => setToast(`Aggiunto a «${title}»`)} />` plus a `<Toast message={toast ?? ''} type="success" isVisible={toast !== null} onClose={() => setToast(null)} />`.
- Replace the `window.confirm` delete (l.62-75) with `onClick={(e) => { e.stopPropagation(); setConfirmRemove(true); }}` and a `<ConfirmDialog isOpen={confirmRemove} variant="danger" title="Eliminare questo articolo?" message="L'articolo viene rimosso solo da questa scheda di lavoro. Segnalibri e dossier non saranno toccati." confirmLabel="Elimina" onConfirm={() => { setConfirmRemove(false); onRemove?.(); }} onClose={() => setConfirmRemove(false)} />` — check `ConfirmDialog`'s exact prop names in `src/components/ui/ConfirmDialog.tsx` and match them.

- [ ] **Step 8: Trim dead add-mode from `DossierModal.tsx`**

`grep -rn "DossierModal" src/ --include="*.tsx"` — expected remaining consumer: `DossierListView` (create-only, no `itemToAdd`). Remove `itemToAdd`/`itemType` props, `handleAddToDossier`, and the add-to-dossier list rendering; the modal keeps only the create flow. If any other consumer passes `itemToAdd`, migrate it to `AddToDossierPopover` instead.

- [ ] **Step 9: Run full suite + typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/features/dossier/AddToDossierPopover.tsx frontend/src/components/features/dossier/AddToDossierPopover.test.tsx frontend/src/components/features/search/ReadingToolbar.tsx frontend/src/components/features/search/ArticleTabContent.tsx frontend/src/components/features/workspace/LooseArticleCard.tsx frontend/src/components/ui/DossierModal.tsx frontend/src/test/setup.ts
git commit -m "feat(dossier): two-click article collection via AddToDossierPopover"
```

---

### Task 6: Gates, browser verification, docs

**Files:**
- Modify: `CLAUDE.md` (project root — dossier sections)
- No new source files.

- [ ] **Step 1: Full gates**

Run: `cd frontend && npm run test -- --run && npm run lint && npm run build`
Expected: all green. Fix every error surfaced, including pre-existing ones in touched files; if >30 legacy lint errors live in files NOT touched by this round, stop and checkpoint with the owner before the mass fix.

- [ ] **Step 2: Browser verification (desktop + mobile)**

Start the stack (Python API on 5000, backend on 3001, frontend on 5173 — `./start.sh` or the three dev servers) and verify in the browser:
1. Dossier detail: click a norma row → text expands in place with serif layer; existing highlights/notes painted; selection → highlight + note creation works inside the row; Copia citazione → clipboard + toast; Apri su Dashboard → workspace opens the article.
2. Espandi tutto on a dossier with 5+ articles → all rows fill, network shows ≤3 concurrent `/fetch_article_text`; Comprimi tutto works; re-expanding is instant (cache).
3. Error path: kill the Python API, expand a fresh row → inline error + Riprova; restart API, Riprova succeeds.
4. Star: toggle on a row → stripe + card counter update; reload the page → star SURVIVES (server persistence — this was broken for statuses before).
5. No status pills anywhere; bulk bar shows only Seleziona/Sposta/Elimina.
6. Dashboard: FolderPlus in the reading toolbar → popover with recents; add → toast; duplicate shows "già presente"; Nuovo dossier inline → created and added (check it lands in `/dossier`).
7. LooseArticleCard: same flow; delete now uses ConfirmDialog.
8. Mobile viewport (375px): popover renders as bottom sheet; rows expand and read comfortably; toolbar button reachable.
9. Dossier tour (list view) still runs with the updated copy.

- [ ] **Step 3: Align CLAUDE.md**

Update the dossier bullets: statuses removed (star only, persisted via `_dossierMeta` envelope in item `content`), expandable rows + `DossierItemReader` + `articleFetchCache` (session cache, max 3 concurrent), `AddToDossierPopover` as the only add-from-reading entry (DossierModal is create-only), `ArticleViewerModal` removed, `SortableDossierItem` props change. Keep entries terse, matching the existing style.

- [ ] **Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: align CLAUDE.md with the work-oriented dossier round"
```

---

## Self-Review Notes

- Spec §1 expandable rows → Task 4; §2 statuses/star → Tasks 2-3; §3 cards → Task 3; §4 popover → Task 5; error handling → Tasks 4-5; testing/verification → every task + Task 6. Spec's "status maps onto the existing field with no schema change" required the `_dossierMeta` envelope because `updateDossierItemStatus` was local-only (statuses never survived reload) — this plan FIXES that for the star; deviation (star = norma items only) recorded in Global Constraints.
- Type consistency: `onToggleImportant` (Tasks 3-5), `isExpanded`/`onToggleExpand`/`onOpenOnDashboard`/`showToast` (Task 4+), `createDossier → Promise<string | null>` (Tasks 2, 5), `packItemContent`/`unpackItemContent` (Tasks 1, 2), `fetchArticleForNorma` (Task 4) — names match across tasks.
- Deliberate simplifications: reader skips dictionary-term and citation-hover pipelines (dashboard-only features; the row's "Apri su Dashboard" covers them); toast "Apri" action deferred if `Toast` wiring in ArticleTabContent doesn't already support `action`.
