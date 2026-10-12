import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../useAppStore';
import { buildItemKey } from '../../utils/normaKeys';
import { practiceArticleKey, sanitizePractices, type Practice } from '../../utils/practice';
import {
  ALL_SAVED_STATES, CC_RD, FOUND, L24, article, block, decisionTab, garbage, searchTab, tab, twoTabs,
} from '../../utils/__fixtures__/savedWorkspaces';

type AppState = ReturnType<typeof appStore.getState>;
type Persisted = Record<string, unknown>;
const options = () => appStore.persist.getOptions() as unknown as {
  name: string;
  version: number;
  partialize: (s: AppState) => Persisted;
  migrate: (persisted: unknown, from: number) => Persisted;
  merge: (persisted: unknown, current: AppState) => AppState;
};
const asStored = (saved: unknown) => (saved === undefined ? undefined : JSON.parse(JSON.stringify(saved)));
/** What the persist middleware does with a state saved as version 0: `migrate`, then `merge`. */
const loadV0 = (saved: unknown, current: AppState = initial) => options().merge(options().migrate(asStored(saved), 0), current);
/** A reload of a state saved as version 1: `merge` alone. */
const reload = (saved: Persisted, current: AppState = initial) => options().merge(asStored(saved), current);

const SLICE_EMPTY = {
  practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, practiceNotice: null,
};
let initial: AppState;

beforeEach(() => {
  appStore.setState({ ...SLICE_EMPTY, workspaceTabs: [], lastSyncError: null });
  initial = appStore.getState();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const practice = (id: string, label: string, more: Partial<Practice> = {}): Practice => ({
  id, label, labelIsCustom: false, acts: [], decisions: [], beside: [], ...more,
});

/** Every article a saved tab holds, wherever it sits: in a block, loose, or in a forged collection. */
function savedArticles(tabs: unknown[]): Array<{ norma_data: unknown }> {
  const found: Array<{ norma_data: unknown }> = [];
  for (const t of tabs as Array<{ content?: Array<Record<string, unknown>> }>) {
    for (const item of t?.content ?? []) {
      if (item.type === 'norma') found.push(...(item.articles as Array<{ norma_data: unknown }>));
      else if (item.type === 'loose-article') found.push(item.article as { norma_data: unknown });
      else if (item.type === 'collection') found.push(...(item.articles as Array<{ article: { norma_data: unknown } }>).map((e) => e.article));
    }
  }
  return found.filter((a) => a && typeof a === 'object' && (a.norma_data as { tipo_atto?: unknown } | undefined)?.tipo_atto);
}

describe('persist version 1: the saved tabs become practices, once', () => {
  it('is version 1', () => {
    expect(options().version).toBe(1);
  });

  it('a version-0 state with tabs and no marker migrates to practices; no tab, z-index or marker is left', () => {
    const migrated = options().migrate(asStored({ workspaceTabs: twoTabs, highestZIndex: 7 }), 0);
    expect(migrated).not.toHaveProperty('workspaceTabs');
    expect(migrated).not.toHaveProperty('highestZIndex');
    expect(migrated).not.toHaveProperty('practicesSeeded');
    const state = loadV0({ workspaceTabs: twoTabs, highestZIndex: 7 });
    expect(state.practices.map((p) => p.id)).toEqual(['tab-cc', 'tab-l24']);
    expect(state.activePracticeId).toBe('tab-l24');
    expect(state.practiceNotice).toBeNull();
  });

  it('a state a flag-off browser saved (no practice, no marker) migrates from its tabs', () => {
    const state = loadV0({ workspaceTabs: twoTabs, practices: [], activePracticeId: null });
    expect(state.practices.map((p) => p.label)).toEqual(['Codice civile', 'Responsabilità medica']);
    expect(state.activePracticeId).toBe('tab-l24');
  });

  it('a state with the marker keeps its practices, an empty list included, and ignores the tabs', () => {
    const kept = practice('p1', 'Pratica uno');
    const state = loadV0({ workspaceTabs: twoTabs, practices: [kept], activePracticeId: 'p1', practicesSeeded: true });
    expect(state.practices).toEqual([kept]);
    expect(state.activePracticeId).toBe('p1');

    const closed = loadV0({ workspaceTabs: twoTabs, practices: [], activePracticeId: null, practicesSeeded: true });
    expect(closed.practices).toEqual([]);
    expect(closed.activePracticeId).toBeNull();
    expect(closed.practiceNotice).toBeNull();
  });

  it('a marked state is kept sanitized: a malformed practice is dropped and logged naming it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const law = article(L24, '1');
    const good = practice('p1', 'Danno', { acts: [{ id: 'a', key: 'legge|24|2017-03-08', norma: L24, articles: [law], isCollapsed: false }] });
    const state = loadV0({ workspaceTabs: twoTabs, practices: [good, { id: 7, label: 'Rotta' }], activePracticeId: 'p1', practicesSeeded: true });
    expect(state.practices).toEqual([good]);
    expect(state.practices[0].acts[0].articles.map(practiceArticleKey)).toEqual([practiceArticleKey(law)]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain('practice #1');
  });

  it('reads the marker only as `true`: anything else migrates from the tabs', () => {
    expect(loadV0({ workspaceTabs: twoTabs, practices: [], practicesSeeded: 'yes' }).practices).toHaveLength(2);
    expect(loadV0({ workspaceTabs: twoTabs, practices: [], practicesSeeded: false }).practices).toHaveLength(2);
  });

  it('every saved workspace of the P1 fixtures arrives sanitized as it is, its articles with their norma_data untouched', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const [name, tabs] of Object.entries(ALL_SAVED_STATES)) {
      const { practices } = options().migrate(asStored({ workspaceTabs: tabs }), 0) as { practices: Practice[] };
      // the load's own sanitizer leaves the migration's output as it is: nothing is dropped or re-id'd
      const again = sanitizePractices(asStored(practices));
      expect(again.dropped, name).toEqual([]);
      expect(again.practices, name).toEqual(practices);
      // the annotation keys are the same before and after
      const arrived = practices.flatMap((p) => p.acts.flatMap((a) => a.articles.map((x) => JSON.stringify(x.norma_data))));
      for (const saved of savedArticles(tabs)) {
        expect(arrived, `${name}: ${buildItemKey(saved.norma_data as never)}`).toContain(JSON.stringify(saved.norma_data));
      }
    }
  });

  it('decisions arrive under «Giurisprudenza» of the practice that was in front, with their history key', () => {
    const state = loadV0({ workspaceTabs: [
      tab('tab-norm', 'Codice civile', 5, [block('blk', CC_RD, [article(CC_RD, '2043', { allegato: '2' })])]),
      decisionTab('dec', 'Cass. civ., sez. III, n. 28994/2019', 4, FOUND, { historyRecordedKey: 'cassazione:civile:28994:2019' }),
    ] });
    expect(state.practices.map((p) => p.id)).toEqual(['tab-norm']);
    expect(state.practices[0].decisions).toHaveLength(1);
    expect(state.practices[0].decisions[0]).toMatchObject({ reference: FOUND, historyRecordedKey: 'cassazione:civile:28994:2019', identified: false });
  });

  it('logs what the migration could not read, once, naming each item and its tab', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = tab('tab-broken', 'Rotta', 1, [{ type: 'mystery' }, block('blk', CC_RD, [{ norma_data: 'x' }] as never)]);
    const state = loadV0({ workspaceTabs: [broken] });
    expect(state.practices).toHaveLength(1);
    const lines = warn.mock.calls.map((call) => call.join(' ')).filter((line) => line.includes('item #'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('tab "Rotta", item #0');
    expect(lines[0]).toContain('tab "Rotta", item #1');
  });

  it('names two topic searches not reopened in the notice, which is taken once', () => {
    const tabs = [
      tab('tab-norm', 'Codice civile', 1, [block('blk', CC_RD, [article(CC_RD, '1223', { allegato: '2' })])]),
      searchTab('s1', 'Tema: perdita di chance', 2, { tema: 'perdita di chance' }),
      searchTab('s2', 'Tema: nesso causale', 3, { tema: 'nesso causale' }),
      searchTab('s3', 'Tema: danno da ritardo', 9, { tema: 'danno da ritardo' }),
      decisionTab('dec', 'Cass. civ., sez. III, n. 28994/2019', 4, FOUND),
    ];
    appStore.setState(loadV0({ workspaceTabs: tabs }));
    const notice = '2 ricerche per tema non sono state riaperte: «Tema: nesso causale», «Tema: perdita di chance». Puoi rifarle dalla barra di ricerca.';
    expect(appStore.getState().practiceNotice).toBe(notice);
    expect(appStore.getState().takePracticeNotice()).toBe(notice);
    expect(appStore.getState().takePracticeNotice()).toBeNull();
    expect(appStore.getState().practiceNotice).toBeNull();
  });

  it('the notice is told by the migrating load alone: a later load of the version-1 state brings none', () => {
    const tabs = [
      tab('tab-norm', 'Codice civile', 1, [block('blk', CC_RD, [article(CC_RD, '1223', { allegato: '2' })])]),
      searchTab('s1', 'Tema: perdita di chance', 2, { tema: 'perdita di chance' }),
      searchTab('s2', 'Tema: nesso causale', 9, { tema: 'nesso causale' }),
    ];
    expect(loadV0({ workspaceTabs: tabs }).practiceNotice).toContain('Tema: perdita di chance');
    expect(reload({ practices: [practice('p1', 'Uno')], activePracticeId: 'p1' }).practiceNotice).toBeNull();
  });

  it('an empty or unreadable state yields no practice and throws nothing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const saved of [null, undefined, 'una scheda', 42, [], {}, { workspaceTabs: [] }, { workspaceTabs: 'x' }, { workspaceTabs: garbage.slice(0, 4) }]) {
      expect(() => loadV0(saved), JSON.stringify(saved)).not.toThrow();
      expect(loadV0(saved).practices, JSON.stringify(saved)).toEqual([]);
      expect(loadV0(saved).activePracticeId).toBeNull();
    }
  });

  it('a state with real tabs among garbage keeps the real ones', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = loadV0({ workspaceTabs: garbage });
    expect(state.practices.map((p) => p.id)).toContain('tab-ok');
  });

  it('a migration that throws is logged with its context and yields no practice, never a throw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hostile = { get workspaceTabs(): unknown { throw new Error('boom'); } };
    expect(() => options().migrate(hostile, 0)).not.toThrow();
    expect((options().migrate(hostile, 0) as { practices: unknown[] }).practices).toEqual([]);
    expect(error.mock.calls[0].join(' ')).toContain('boom');
  });

  it('a version-1 state is not migrated again: leftover tabs and a marker in it are ignored', () => {
    const state = reload({ workspaceTabs: twoTabs, practicesSeeded: false, practices: [] });
    expect(state.practices).toEqual([]);
    expect(state.activePracticeId).toBeNull();
  });

  it('after «Chiudi tutte» a reload shows no practice', () => {
    expect(reload({ practices: [], activePracticeId: null }).practices).toEqual([]);
  });

  it('points the active practice at one that is there: a saved id that names none falls back to the first', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = reload({ practices: [practice('p1', 'Uno'), practice('p2', 'Due')], activePracticeId: 'gone' });
    expect(state.activePracticeId).toBe('p1');
    expect(reload({ practices: [], activePracticeId: 'gone' }).activePracticeId).toBeNull();
  });

  it('really rehydrates a version-0 storage through the wrapped storage and rewrites it as version 1', async () => {
    localStorage.setItem(options().name, JSON.stringify({ state: { workspaceTabs: twoTabs, highestZIndex: 7 }, version: 0 }));
    await appStore.persist.rehydrate();
    expect(appStore.getState().practices.map((p) => p.id)).toEqual(['tab-cc', 'tab-l24']);
    const written = JSON.parse(localStorage.getItem(options().name) ?? '{}');
    expect(written.version).toBe(1);
    expect(written.state.practices.map((p: Practice) => p.id)).toEqual(['tab-cc', 'tab-l24']);
    for (const gone of ['workspaceTabs', 'highestZIndex', 'practicesSeeded']) expect(written.state).not.toHaveProperty(gone);
    // the second load finds version 1 and migrates nothing
    appStore.setState({ practices: [practice('mine', 'Mia')], activePracticeId: 'mine' });
    await appStore.persist.rehydrate();
    expect(appStore.getState().practices.map((p) => p.id)).toEqual(['mine']);
    localStorage.removeItem(options().name);
  });
});

describe('partialize', () => {
  it('saves the practices and the active one; never the tabs, the marker, the open rows, the pending reveal or the notice', () => {
    appStore.setState({
      practices: [practice('p1', 'Uno')], activePracticeId: 'p1',
      practiceRows: { 'p1/d1': true }, pendingReveal: { practiceId: 'p1', rowKey: 'p1/d1' }, practiceNotice: 'avviso',
      workspaceTabs: twoTabs as unknown as AppState['workspaceTabs'],
    });
    const saved = options().partialize(appStore.getState());
    expect(saved).toMatchObject({ practices: [practice('p1', 'Uno')], activePracticeId: 'p1' });
    for (const gone of ['workspaceTabs', 'highestZIndex', 'practicesSeeded', 'practiceRows', 'pendingReveal', 'practiceNotice']) {
      expect(saved).not.toHaveProperty(gone);
    }
  });

  it('a reload never brings back the open rows, the pending reveal or the notice, even if storage holds them', () => {
    const state = reload({ practices: [], practiceRows: { x: true }, pendingReveal: 'x', practiceNotice: 'x' });
    expect(state.practiceRows).toEqual({});
    expect(state.pendingReveal).toBeNull();
    expect(state.practiceNotice).toBeNull();
  });
});

describe('a full storage', () => {
  it('a store action completes without throwing, the change is kept, one log and one sync error, once a session', async () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quota; });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => appStore.getState().pushSyncError('prima')).not.toThrow();
    expect(appStore.getState().lastSyncError?.message).toBe('prima');
    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls[0].join(' ');
    expect(logged).toContain('visualex-storage');
    expect(logged).toContain('QuotaExceededError');
    expect(logged).toMatch(/\d+ bytes/);

    await Promise.resolve();
    expect(appStore.getState().lastSyncError?.message)
      .toBe('Lo spazio del browser è esaurito: il tavolo di lavoro potrebbe non essere salvato. Chiudi qualche pratica.');

    // a second failing save logs nothing more and raises nothing more
    expect(() => appStore.setState({ practices: [practice('p1', 'Uno')] })).not.toThrow();
    appStore.getState().pushSyncError('seconda');
    await Promise.resolve();
    expect(error).toHaveBeenCalledTimes(1);
    expect(appStore.getState().lastSyncError?.message).toBe('seconda');
    expect(appStore.getState().practices).toHaveLength(1);
  });
});

describe('a load that migrates writes at once', () => {
  it('the migrated practices are in storage as version 1 before any action, so a reload does not migrate again', async () => {
    localStorage.setItem('visualex-storage', JSON.stringify({ state: { workspaceTabs: twoTabs }, version: 0 }));
    vi.resetModules();
    const fresh = await import('../useAppStore');
    expect(fresh.appStore.getState().practices).toHaveLength(2);
    const written = JSON.parse(localStorage.getItem('visualex-storage') ?? '{}');
    expect(written.version).toBe(1);
    expect(written.state.practices.length).toBeGreaterThan(0);
    expect(written.state).not.toHaveProperty('workspaceTabs');
    localStorage.removeItem('visualex-storage');
  });
});

describe('clearUserData — logout on a shared browser', () => {
  const migrated = () => {
    appStore.setState(loadV0({ workspaceTabs: twoTabs }));
    appStore.setState({ practiceRows: { 'tab-cc/x': true }, pendingReveal: { practiceId: 'tab-cc', rowKey: 'tab-cc/x' }, practiceNotice: 'avviso' });
  };

  it('empties the slice', () => {
    migrated();
    expect(appStore.getState().practices).toHaveLength(2);
    appStore.getState().clearUserData();
    expect(appStore.getState()).toMatchObject(SLICE_EMPTY);
  });

  it('logout, login, reload: the table built after the login is there, nothing is migrated over it', () => {
    migrated();
    appStore.getState().clearUserData();
    const law = article(L24, '5');
    const after = practice('p-new', 'Dopo il login', {
      acts: [{ id: 'a-new', key: 'legge|24|2017-03-08', norma: L24, articles: [law], isCollapsed: false }],
    });
    appStore.setState({ practices: [after], activePracticeId: 'p-new' });
    const state = reload(options().partialize(appStore.getState()));
    expect(state.practices).toEqual([after]);
    expect(state.activePracticeId).toBe('p-new');
  });
});
