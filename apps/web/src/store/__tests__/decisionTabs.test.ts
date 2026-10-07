import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '../useAppStore';

const origin = vi.hoisted(() => ({ left: 0, top: 0, width: 0 }));
vi.mock('../../utils/workspaceOrigin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/workspaceOrigin')>()),
  workspaceOrigin: () => ({ ...origin }),
}));

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };
const get = () => appStore.getState();

beforeEach(() => appStore.setState({ workspaceTabs: [], pendingDecision: null }));

describe('decision tabs', () => {
  it('opens one tab per decision and focuses it the second time', () => {
    const a = get().openDecisionTab(REF);
    const z = get().workspaceTabs[0].zIndex;
    const b = get().openDecisionTab({ ...REF, sezione: 'III' });
    const tabs = get().workspaceTabs;
    expect(b).toBe(a);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].view).toEqual({ kind: 'decision', reference: REF });
    expect(tabs[0].content).toEqual([]);
    expect(tabs[0].label).toBe('Cass. civ., n. 10787/2024');
    expect(tabs[0].zIndex).toBeGreaterThan(z);
  });

  it('matches an archive only to a tab of that archive; a citation without one matches either', () => {
    const bare = get().openDecisionTab({ corte: 'cassazione', numero: 10787, anno: 2024 });
    const civil = get().openDecisionTab(REF);
    expect(civil).not.toBe(bare);
    const penal = get().openDecisionTab({ ...REF, archivio: 'penale' });
    expect(penal).not.toBe(civil);
    expect(get().workspaceTabs).toHaveLength(3);
    expect(get().workspaceTabs.find((t) => t.id === bare)!.view).toEqual({ kind: 'decision', reference: { corte: 'cassazione', numero: 10787, anno: 2024 } });
    expect(get().openDecisionTab({ corte: 'cassazione', numero: 10787, anno: 2024 })).toBe(bare);
    expect(get().workspaceTabs).toHaveLength(3);
  });

  it('bumps the z-index once per opened tab', () => {
    const before = get().highestZIndex;
    get().openDecisionTab(REF);
    expect(get().highestZIndex).toBe(before + 1);
    get().openDecisionSearchTab({ tema: 'x' }, 'x');
    expect(get().highestZIndex).toBe(before + 2);
  });

  it('does not tell two labels of one norm search apart', () => {
    const norma = { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '2043' };
    const a = get().openDecisionSearchTab({ norma, normaLabel: 'art. 2043 c.c.' }, 'a');
    expect(get().openDecisionSearchTab({ norma, normaLabel: 'Art. 2043 codice civile' }, 'b')).toBe(a);
  });

  it('reuses one tab for a topic typed with other case or spacing, and keeps it as typed', () => {
    const a = get().openDecisionSearchTab({ tema: 'Perdita di chance' }, 'Tema: Perdita di chance');
    expect(get().openDecisionSearchTab({ tema: ' perdita  di chance ' }, 'Tema: perdita di chance')).toBe(a);
    const b = get().openDecisionSearchTab({ tema: '  Colpa ' }, 'x');
    const view = get().workspaceTabs.find((t) => t.id === b)!.view;
    expect(view).toEqual({ kind: 'decision-search', query: { tema: 'Colpa' } });
  });

  it('drops a persisted search view whose query is malformed', () => {
    const merge = (appStore as unknown as { persist: { getOptions: () => { merge: (p: unknown, c: unknown) => { workspaceTabs: Array<{ id: string }> } } } })
      .persist.getOptions().merge;
    const base = { position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, zIndex: 1, isMinimized: false, isHidden: false, label: 'l', content: [] };
    const search = (id: string, query: unknown) => ({ ...base, id, view: { kind: 'decision-search', query } });
    const out = merge({
      workspaceTabs: [
        search('numeric', { tema: 42 }),
        search('empty', {}),
        search('halfnorma', { norma: { tipo_atto: 'codice civile' } }),
        search('good', { tema: 'colpa' }),
        search('goodnorma', { norma: { tipo_atto: 'codice civile', numero_articolo: '2043' } }),
      ],
    }, get());
    expect(out.workspaceTabs.map((t) => t.id)).toEqual(['good', 'goodnorma']);
  });

  it('gives a stored article the Brocardi of a later copy, and forgets the error, text untouched', () => {
    appStore.setState({ workspaceTabs: [] });
    const NORMA = { tipo_atto: 'legge', numero_atto: '241', data: '1990' } as unknown as Parameters<ReturnType<typeof get>['addNormaToTab']>[1];
    const art = (extra: object) => ({ norma_data: { numero_articolo: '1' }, article_text: 'testo', ...extra }) as unknown as Parameters<ReturnType<typeof get>['addNormaToTab']>[2][number];
    const tabId = get().addWorkspaceTab('t');
    get().addNormaToTab(tabId, NORMA, [art({ brocardi_error: 'down' })]);
    get().addNormaToTab(tabId, NORMA, [art({ article_text: 'altro', brocardi_info: { Ratio: 'r' } })]);
    const stored = (get().workspaceTabs[0].content[0] as unknown as { articles: Array<Record<string, unknown>> }).articles[0];
    expect(stored.brocardi_info).toEqual({ Ratio: 'r' });
    expect(stored).not.toHaveProperty('brocardi_error');
    expect(stored.article_text).toBe('testo');
  });

  describe('side by side', () => {
    const original = { w: window.innerWidth, h: window.innerHeight };
    const viewport = (w: number, h: number, o: { left: number; top: number }) => {
      Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
      Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
      Object.assign(origin, o, { width: w - o.left });
    };
    afterEach(() => {
      viewport(original.w, original.h, { left: 0, top: 0 });
    });
    const MARGIN = 16;
    const DOCK_TOP = (h: number) => h - 24 - 44; // fixed bottom-6, ~44px collapsed
    const place = () => {
      const article = get().addWorkspaceTab('art. 2043 c.c.');
      const decision = get().openDecisionTab(REF, { besideTabId: article });
      const of = (id: string) => get().workspaceTabs.find((t) => t.id === id)!;
      const view = (t: ReturnType<typeof of>) => ({
        x: t.position.x + origin.left, y: t.position.y + origin.top,
        right: t.position.x + origin.left + t.size.width, bottom: t.position.y + origin.top + t.size.height,
      });
      return { left: view(of(article)), right: view(of(decision)) };
    };

    it('at 1280x800 sits right of the sidebar, inside the viewport, above the dock, filling the width', () => {
      viewport(1280, 800, { left: 184, top: 32 });
      appStore.setState({ sidebarVisible: true });
      const { left, right } = place();
      expect(left.x).toBeGreaterThanOrEqual(64 + MARGIN);
      expect(right.right).toBeLessThanOrEqual(1280 - MARGIN);
      expect(left.right).toBeLessThanOrEqual(right.x);
      expect(Math.max(left.bottom, right.bottom)).toBeLessThanOrEqual(DOCK_TOP(800));
      expect(Math.min(left.y, right.y)).toBeGreaterThanOrEqual(56);
      // free width = 1280 - 64 - two margins; the gap between the tabs is one margin
      expect(right.x - left.right).toBeGreaterThanOrEqual(MARGIN - 2);
      expect(right.x - left.right).toBeLessThanOrEqual(MARGIN + 2);
      expect(right.right - left.x).toBeGreaterThanOrEqual(1280 - 64 - 2 * MARGIN - 2);
    });

    it('at 900x700 has no sidebar, clears the menu button and stays inside the viewport', () => {
      viewport(900, 700, { left: 56, top: 32 });
      appStore.setState({ sidebarVisible: true });
      const { left, right } = place();
      expect(left.x).toBeGreaterThanOrEqual(MARGIN);
      expect(left.x).toBeLessThanOrEqual(MARGIN + 1);
      expect(Math.min(left.y, right.y)).toBeGreaterThanOrEqual(56);
      expect(right.right).toBeLessThanOrEqual(900 - MARGIN);
      expect(right.right).toBeGreaterThanOrEqual(900 - MARGIN - 2);
      expect(left.right).toBeLessThanOrEqual(right.x);
      expect(Math.max(left.bottom, right.bottom)).toBeLessThanOrEqual(DOCK_TOP(700));
    });

    it('uses the whole width in focus mode', () => {
      viewport(1280, 800, { left: 328, top: 120 });
      appStore.setState((st) => ({ sidebarVisible: true, settings: { ...st.settings, focusMode: true } }));
      const { left, right } = place();
      appStore.setState((st) => ({ settings: { ...st.settings, focusMode: false } }));
      expect(left.x).toBeGreaterThanOrEqual(MARGIN);
      expect(left.x).toBeLessThanOrEqual(MARGIN + 1);
      expect(right.right).toBeLessThanOrEqual(1280 - MARGIN);
      expect(right.right).toBeGreaterThanOrEqual(1280 - MARGIN - 2);
    });

    it('a decision opened with nothing on screen takes the whole free area, from the palette or the address alike', () => {
      viewport(1280, 800, { left: 184, top: 32 });
      appStore.setState({ sidebarVisible: true, workspaceTabs: [] });
      const id = get().openDecisionTab(REF);
      const t = get().workspaceTabs.find((x) => x.id === id)!;
      expect(t.position.x + origin.left).toBe(64 + MARGIN);
      expect(t.position.x + origin.left + t.size.width).toBe(1280 - MARGIN);
      expect(t.position.y + origin.top + t.size.height).toBeLessThanOrEqual(DOCK_TOP(800));
      expect(t.position.y + origin.top).toBeGreaterThanOrEqual(56);
    });

    it('a search opened with nothing on screen takes the free area; over a visible tab it keeps the cascade', () => {
      viewport(1280, 800, { left: 184, top: 32 });
      appStore.setState({ workspaceTabs: [] });
      const first = get().openDecisionSearchTab({ tema: 'colpa' }, 'Tema: colpa');
      expect(get().workspaceTabs.find((x) => x.id === first)!.size).not.toEqual({ width: 800, height: 650 });
      const second = get().openDecisionSearchTab({ tema: 'dolo' }, 'Tema: dolo');
      expect(get().workspaceTabs.find((x) => x.id === second)!.size).toEqual({ width: 800, height: 650 });
    });

    it('keeps the cascade on a phone, so phone geometry is never saved with the tab', () => {
      viewport(390, 844, { left: 0, top: 0 });
      appStore.setState({ workspaceTabs: [] });
      const id = get().openDecisionTab(REF);
      expect(get().workspaceTabs.find((x) => x.id === id)!.size).toEqual({ width: 800, height: 650 });
    });

    it('a decision opened over a visible tab, without a tab to sit beside, keeps the cascade', () => {
      viewport(1280, 800, { left: 184, top: 32 });
      appStore.setState({ workspaceTabs: [] });
      get().addWorkspaceTab('Codice civile');
      const id = get().openDecisionTab(REF);
      expect(get().workspaceTabs.find((x) => x.id === id)!.size).toEqual({ width: 800, height: 650 });
    });
  });

  it('gives an unresolved tab the section a later citation adds, and its label', () => {
    const bare = { corte: 'cassazione' as const, numero: 10787, anno: 2024 };
    const id = get().openDecisionTab({ ...bare, sezione: 'VII' });
    const again = get().openDecisionTab({ ...bare, sezione: 'III' });
    expect(again).toBe(id);
    const tab = get().workspaceTabs.find((t) => t.id === id)!;
    expect(tab.view).toEqual({ kind: 'decision', reference: { ...bare, sezione: 'III' } });
    expect(tab.label).toBe('Cass., sez. III, n. 10787/2024');
    // a tab that already has its archive keeps its reference
    const resolved = get().openDecisionTab({ ...REF, numero: 5 });
    get().openDecisionTab({ ...REF, numero: 5, sezione: 'III' });
    expect(get().workspaceTabs.find((t) => t.id === resolved)!.view).toEqual({ kind: 'decision', reference: { ...REF, numero: 5 } });
  });

  it('persists a cited section with the reference until the decision is found', () => {
    const id = get().openDecisionTab({ ...REF, archivio: undefined, sezione: 'VII' });
    const saved = appStore.persist.getOptions().partialize!(appStore.getState()) as { workspaceTabs: Array<{ id: string; view?: { reference: { sezione?: string } } }> };
    expect(saved.workspaceTabs.find((t) => t.id === id)?.view?.reference.sezione).toBe('VII');
  });

  it('drops a malformed persisted view on rehydration, and the tab with it when empty', () => {
    const merge = (appStore as unknown as { persist: { getOptions: () => { merge: (p: unknown, c: unknown) => { workspaceTabs: Array<{ id: string; view?: unknown }> } } } })
      .persist.getOptions().merge;
    const base = { position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, zIndex: 1, isMinimized: false, isHidden: false, label: 'l' };
    const out = merge({
      workspaceTabs: [
        { ...base, id: 'ok', content: [], view: { kind: 'decision', reference: REF } },
        { ...base, id: 'bare', content: [], view: { kind: 'decision', reference: { corte: 'cassazione', numero: 5, anno: 2020 } } },
        { ...base, id: 'cc', content: [], view: { kind: 'decision', reference: { corte: 'corte_costituzionale', numero: 5, anno: 2020 } } },
        { ...base, id: 'search', content: [], view: { kind: 'decision-search', query: { tema: 'danno' } } },
        { ...base, id: 'badkind', content: [], view: { kind: 'wat' } },
        { ...base, id: 'noyear', content: [], view: { kind: 'decision', reference: { corte: 'cassazione', numero: 5 } } },
        { ...base, id: 'withcontent', content: [{ type: 'x' }], view: { kind: 'decision', reference: { numero: 5, anno: 2000 } } },
        { ...base, id: 'plain', content: [] },
      ],
    }, get());
    expect(out.workspaceTabs.map((t) => t.id)).toEqual(['ok', 'bare', 'cc', 'search', 'withcontent', 'plain']);
    expect(out.workspaceTabs[4]).not.toHaveProperty('view');
  });

  it('keeps the identity once found, so a reload asks for exactly it', () => {
    const id = get().openDecisionTab({ corte: 'cassazione', numero: 10787, anno: 2024, sezione: 'III' });
    get().setDecisionTabIdentity(id, REF, 'Cass. civ., sez. III, n. 10787/2024');
    const tab = get().workspaceTabs[0];
    expect(tab.view).toEqual({ kind: 'decision', reference: REF });
    expect(tab.label).toBe('Cass. civ., sez. III, n. 10787/2024');
  });

  it('focuses a search tab with the same query whatever the key order', () => {
    const a = get().openDecisionSearchTab({ tema: 'danno', archivio: 'civile' }, 'Sentenze: danno');
    const b = get().openDecisionSearchTab({ archivio: 'civile', tema: 'danno' }, 'Sentenze: danno');
    expect(b).toBe(a);
    expect(get().workspaceTabs).toHaveLength(1);
    expect(get().workspaceTabs[0].view).toEqual({ kind: 'decision-search', query: { tema: 'danno', archivio: 'civile' } });
    expect(get().openDecisionSearchTab({ tema: 'altro' }, 'Sentenze: altro')).not.toBe(a);
  });

  it('drains a queued decision once, even when called twice (StrictMode)', () => {
    get().requestOpenDecision(REF);
    const first = get().drainPendingDecision();
    const second = get().drainPendingDecision();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(get().workspaceTabs).toHaveLength(1);
  });

  it('persists the view and never the pending request', () => {
    get().openDecisionTab(REF);
    get().requestOpenDecision(REF);
    const persisted = (appStore as unknown as { persist: { getOptions: () => { partialize: (s: unknown) => Record<string, unknown> } } })
      .persist.getOptions().partialize(get());
    expect((persisted.workspaceTabs as Array<{ view?: unknown }>)[0].view).toEqual({ kind: 'decision', reference: REF });
    expect(persisted).not.toHaveProperty('pendingDecision');
  });

  describe('a tab with a view takes no content', () => {
    const NORMA = { tipo_atto: 'legge', numero_atto: '241', data: '1990', urn: 'urn:x' } as unknown as Parameters<ReturnType<typeof get>['addNormaToTab']>[1];
    const ARTICLE = { norma_data: { numero_articolo: '1' }, article_text: 'x' } as unknown as Parameters<ReturnType<typeof get>['addNormaToTab']>[2][number];
    let id: string;
    let articleTab: string;
    let warn: ReturnType<typeof vi.spyOn>;
    const content = () => get().workspaceTabs.find((t) => t.id === id)!.content;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      id = get().openDecisionTab(REF);
      articleTab = get().addWorkspaceTab('Codice civile');
    });
    afterEach(() => warn.mockRestore());

    it.each([
      ['addNormaToTab', () => get().addNormaToTab(id, NORMA, [ARTICLE])],
      ['addLooseArticleToTab', () => get().addLooseArticleToTab(id, ARTICLE, NORMA)],
      ['addNormaIndexToTab', () => expect(get().addNormaIndexToTab(id, NORMA)).toBeNull()],
      ['createCollection', () => get().createCollection(id)],
    ])('%s refuses it, and says so', (name, act) => {
      act();
      expect(content()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
    });

    it('moveNormaBetweenTabs and moveLooseArticleBetweenTabs refuse it as a target and keep the item at its source', () => {
      get().addNormaToTab(articleTab, NORMA, [ARTICLE]);
      get().addLooseArticleToTab(articleTab, ARTICLE, NORMA);
      const source = () => get().workspaceTabs.find((t) => t.id === articleTab)!.content;
      const norma = source().find((c) => c.type === 'norma')!;
      const loose = source().find((c) => c.type === 'loose-article')!;
      get().moveNormaBetweenTabs(norma.id, articleTab, id);
      get().moveLooseArticleBetweenTabs(loose.id, articleTab, id);
      expect(content()).toEqual([]);
      expect(source()).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('moveNormaBetweenTabs'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('moveLooseArticleBetweenTabs'));
    });

    it('an article tab still takes content', () => {
      get().addNormaToTab(articleTab, NORMA, [ARTICLE]);
      expect(get().workspaceTabs.find((t) => t.id === articleTab)!.content).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('one tab per decision after a candidate is chosen', () => {
    const PENAL = { ...REF, archivio: 'penale' as const };
    it('brings the tab that already holds the decision to the front and closes this one', () => {
      const penal = get().openDecisionTab(PENAL);
      const civil = get().openDecisionTab(REF);
      get().setDecisionTabIdentity(civil, PENAL, 'Cass. pen., n. 10787/2024');
      const tabs = get().workspaceTabs;
      expect(tabs.map((t) => t.id)).toEqual([penal]);
      expect(tabs[0].zIndex).toBe(get().highestZIndex);
    });

    it('just renames the tab when no other tab holds the decision', () => {
      const bare = get().openDecisionTab({ corte: 'cassazione', numero: 10787, anno: 2024 });
      get().setDecisionTabIdentity(bare, PENAL, 'Cass. pen., n. 10787/2024');
      expect(get().workspaceTabs).toHaveLength(1);
      expect(get().workspaceTabs[0].view).toEqual({ kind: 'decision', reference: PENAL });
    });
  });
});
