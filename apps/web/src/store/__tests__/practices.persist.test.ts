import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../useAppStore';
import { practiceArticleKey, type Practice } from '../../utils/practice';
import {
  CC_RD, FOUND, L24, article, block, decisionTab, searchTab, tab, twoTabs,
} from '../../utils/__fixtures__/savedWorkspaces';

type AppState = ReturnType<typeof appStore.getState>;
type Persisted = Record<string, unknown>;
const options = () => appStore.persist.getOptions() as unknown as {
  name: string;
  partialize: (s: AppState) => Persisted;
  merge: (persisted: unknown, current: AppState) => AppState;
};
const flagOn = () => vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
const flagOff = () => vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', '');
/** A reload: what partialize saved, through JSON as localStorage holds it, merged into a fresh state. */
const reload = (saved: Persisted, current: AppState = initial) => options().merge(JSON.parse(JSON.stringify(saved)), current);

const SLICE_EMPTY = {
  practices: [], activePracticeId: null, practicesSeeded: false, practiceRows: {}, pendingReveal: null, practiceNotice: null,
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

describe('the practices, seeded once from the saved tabs behind the flag', () => {
  it('with the flag on, a saved state with tabs and no marker rehydrates with practices, the marker set, the tabs kept', () => {
    flagOn();
    const state = reload({ workspaceTabs: twoTabs, highestZIndex: 7 });
    expect(state.practices.map((p) => p.id)).toEqual(['tab-cc', 'tab-l24']);
    expect(state.activePracticeId).toBe('tab-l24');
    expect(state.practicesSeeded).toBe(true);
    expect(state.workspaceTabs.map((t) => t.id)).toEqual(['tab-cc', 'tab-l24']);
    expect(state.practiceNotice).toBeNull();
  });

  it('a state a flag-off session saved (no practice, no marker) is seeded when the flag is on', () => {
    flagOff();
    appStore.setState({ workspaceTabs: twoTabs as unknown as AppState['workspaceTabs'] });
    const saved = options().partialize(appStore.getState());
    expect(saved.practices).toEqual([]);
    expect(saved.practicesSeeded).toBe(false);
    flagOn();
    const state = reload(saved);
    expect(state.practices.map((p) => p.label)).toEqual(['Codice civile', 'Responsabilità medica']);
    expect(state.practicesSeeded).toBe(true);
  });

  it('after «Chiudi tutte» a reload shows no practice, whatever the tabs hold', () => {
    flagOn();
    const state = reload({ workspaceTabs: twoTabs, practices: [], activePracticeId: null, practicesSeeded: true });
    expect(state.practices).toEqual([]);
    expect(state.activePracticeId).toBeNull();
    expect(state.practicesSeeded).toBe(true);
  });

  it('an empty workspace seeds nothing and is still seeded', () => {
    flagOn();
    const state = reload({ workspaceTabs: [] });
    expect(state.practices).toEqual([]);
    expect(state.practicesSeeded).toBe(true);
  });

  it('with the flag off, nothing is seeded and the marker stays unset; the tabs are as they were', () => {
    flagOff();
    const state = reload({ workspaceTabs: twoTabs, highestZIndex: 7 });
    expect(state.practices).toEqual([]);
    expect(state.practicesSeeded).toBe(false);
    expect(state.workspaceTabs.map((t) => t.id)).toEqual(['tab-cc', 'tab-l24']);
    expect(state.highestZIndex).toBe(7);
  });

  it('with the flag off, a marker a flag-on session set is kept, and so are its practices', () => {
    flagOff();
    const kept = practice('p1', 'Pratica uno');
    const state = reload({ workspaceTabs: twoTabs, practices: [kept], activePracticeId: 'p1', practicesSeeded: true });
    expect(state.practices).toEqual([kept]);
    expect(state.activePracticeId).toBe('p1');
    expect(state.practicesSeeded).toBe(true);
  });

  it('keeps the saved practices sanitized, drops a malformed one and logs it naming it', () => {
    flagOn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const law = article(L24, '1');
    const good = practice('p1', 'Danno', { acts: [{ id: 'a', key: 'legge|24|2017-03-08', norma: L24, articles: [law], isCollapsed: false }] });
    const state = reload({ workspaceTabs: twoTabs, practices: [good, { id: 7, label: 'Rotta' }], activePracticeId: 'p1', practicesSeeded: true });
    expect(state.practices).toEqual([good]);
    expect(state.practices[0].acts[0].articles.map(practiceArticleKey)).toEqual([practiceArticleKey(law)]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain('practice #1');
  });

  it('points the active practice at one that is there: a saved id that names none falls back to the first', () => {
    flagOn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = reload({ practices: [practice('p1', 'Uno'), practice('p2', 'Due')], activePracticeId: 'gone', practicesSeeded: true });
    expect(state.activePracticeId).toBe('p1');
    expect(reload({ practices: [], activePracticeId: 'gone', practicesSeeded: true }).activePracticeId).toBeNull();
  });

  it('reads the marker only as a boolean', () => {
    flagOn();
    const state = reload({ workspaceTabs: twoTabs, practices: [], practicesSeeded: 'yes' });
    expect(state.practices).toHaveLength(2);
    expect(state.practicesSeeded).toBe(true);
  });

  it('logs what the migration could not read, once, naming each item and its tab', () => {
    flagOn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = tab('tab-broken', 'Rotta', 1, [{ type: 'mystery' }, block('blk', CC_RD, [{ norma_data: 'x' }] as never)]);
    const state = reload({ workspaceTabs: [broken] });
    expect(state.practices).toHaveLength(1);
    // the old surface's own fold of the tabs warns too, as it did before the practices
    const lines = warn.mock.calls.map((call) => call.join(' ')).filter((line) => line.includes('item #'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('tab "Rotta", item #0');
    expect(lines[0]).toContain('tab "Rotta", item #1');
  });

  it('names two topic searches not reopened in the notice, which is taken once', () => {
    flagOn();
    const tabs = [
      tab('tab-norm', 'Codice civile', 1, [block('blk', CC_RD, [article(CC_RD, '1223', { allegato: '2' })])]),
      searchTab('s1', 'Tema: perdita di chance', 2, { tema: 'perdita di chance' }),
      searchTab('s2', 'Tema: nesso causale', 3, { tema: 'nesso causale' }),
      searchTab('s3', 'Tema: danno da ritardo', 9, { tema: 'danno da ritardo' }),
      decisionTab('dec', 'Cass. civ., sez. III, n. 28994/2019', 4, FOUND),
    ];
    appStore.setState(reload({ workspaceTabs: tabs }));
    const notice = '2 ricerche per tema non sono state riaperte: «Tema: nesso causale», «Tema: perdita di chance». Puoi rifarle dalla barra di ricerca.';
    expect(appStore.getState().practiceNotice).toBe(notice);
    expect(appStore.getState().takePracticeNotice()).toBe(notice);
    expect(appStore.getState().takePracticeNotice()).toBeNull();
    expect(appStore.getState().practiceNotice).toBeNull();
  });

  it('really rehydrates from localStorage through the wrapped storage', async () => {
    flagOn();
    localStorage.setItem(options().name, JSON.stringify({ state: { workspaceTabs: twoTabs }, version: 0 }));
    await appStore.persist.rehydrate();
    expect(appStore.getState().practices.map((p) => p.id)).toEqual(['tab-cc', 'tab-l24']);
    expect(appStore.getState().practicesSeeded).toBe(true);
    localStorage.removeItem(options().name);
  });
});

describe('partialize', () => {
  it('saves the practices, the active one and the marker; never the open rows, the pending reveal or the notice', () => {
    appStore.setState({
      practices: [practice('p1', 'Uno')], activePracticeId: 'p1', practicesSeeded: true,
      practiceRows: { 'p1/d1': true }, pendingReveal: { practiceId: 'p1', rowKey: 'p1/d1' }, practiceNotice: 'avviso',
    });
    const saved = options().partialize(appStore.getState());
    expect(saved).toMatchObject({ practices: [practice('p1', 'Uno')], activePracticeId: 'p1', practicesSeeded: true });
    expect(saved).not.toHaveProperty('practiceRows');
    expect(saved).not.toHaveProperty('pendingReveal');
    expect(saved).not.toHaveProperty('practiceNotice');
  });

  it('a reload never brings back the open rows, the pending reveal or the notice, even if storage holds them', () => {
    flagOn();
    const state = reload({ practices: [], practicesSeeded: true, practiceRows: { x: true }, pendingReveal: 'x', practiceNotice: 'x' });
    expect(state.practiceRows).toEqual({});
    expect(state.pendingReveal).toBeNull();
    expect(state.practiceNotice).toBeNull();
  });
});

describe('a full storage', () => {
  it('a store action completes without throwing, the change is kept, one log and one sync error, once a session', async () => {
    flagOn();
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

describe('a full storage, flag off', () => {
  it('the message does not mention practices', async () => {
    flagOff();
    vi.resetModules(); // the report is once a module: a fresh one
    const fresh = await import('../useAppStore');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fresh.appStore.getState().pushSyncError('prima');
    await Promise.resolve();
    const message = fresh.appStore.getState().lastSyncError?.message ?? '';
    expect(message).toMatch(/spazio del browser/);
    expect(message).not.toMatch(/pratich/i);
  });
});

describe('a load that seeds writes at once', () => {
  it('the seeded practices are in storage before any action, so a reload does not seed again', async () => {
    vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
    localStorage.setItem('visualex-storage', JSON.stringify({ state: { workspaceTabs: twoTabs }, version: 0 }));
    vi.resetModules();
    const fresh = await import('../useAppStore');
    expect(fresh.appStore.getState().practicesSeeded).toBe(true);
    const saved = JSON.parse(localStorage.getItem('visualex-storage') ?? '{}').state;
    expect(saved.practicesSeeded).toBe(true);
    expect(saved.practices.length).toBeGreaterThan(0);
    localStorage.removeItem('visualex-storage');
  });
});

describe('clearUserData — logout on a shared browser', () => {
  const seeded = () => {
    appStore.setState(reload({ workspaceTabs: twoTabs }));
    appStore.setState({ practiceRows: { 'tab-cc/x': true }, pendingReveal: { practiceId: 'tab-cc', rowKey: 'tab-cc/x' }, practiceNotice: 'avviso' });
  };

  it('with the flag on, empties the slice and leaves the marker set', () => {
    flagOn();
    seeded();
    expect(appStore.getState().practices).toHaveLength(2);
    appStore.getState().clearUserData();
    expect(appStore.getState()).toMatchObject({ ...SLICE_EMPTY, practicesSeeded: true });
  });

  it('with the flag off, empties the slice and leaves the marker unset', () => {
    flagOn();
    seeded();
    flagOff();
    appStore.getState().clearUserData();
    expect(appStore.getState()).toMatchObject(SLICE_EMPTY);
  });

  it('logout, login, reload with the flag on: the table built after the login is there, nothing is seeded from the tabs', () => {
    flagOn();
    seeded();
    appStore.getState().clearUserData();
    // the next user builds a practice, and the old surface still writes a tab while P2 draws it
    const law = article(L24, '5');
    const after = practice('p-new', 'Dopo il login', {
      acts: [{ id: 'a-new', key: 'legge|24|2017-03-08', norma: L24, articles: [law], isCollapsed: false }],
    });
    appStore.setState({
      practices: [after], activePracticeId: 'p-new',
      workspaceTabs: [tab('tab-new', 'Nuova', 1, [block('blk-new', L24, [law])])] as unknown as AppState['workspaceTabs'],
    });
    const state = reload(options().partialize(appStore.getState()));
    expect(state.practices).toEqual([after]);
    expect(state.activePracticeId).toBe('p-new');
    expect(state.practicesSeeded).toBe(true);
  });
});
