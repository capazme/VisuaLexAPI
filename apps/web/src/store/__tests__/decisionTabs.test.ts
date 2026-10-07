import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '../useAppStore';

const origin = vi.hoisted(() => ({ left: 0, top: 0, width: 0 }));
vi.mock('../../utils/workspaceOrigin', () => ({
  WORKSPACE_AREA_ID: 'tour-results-area',
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
      expect(right.right - left.x + MARGIN).toBeGreaterThanOrEqual(1280 - 64 - 2 * MARGIN - 2);
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
});
