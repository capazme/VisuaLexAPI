import { beforeEach, describe, expect, it } from 'vitest';
import { appStore } from '../useAppStore';

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

  it('shares a tab between a citation without archive and the resolved decision', () => {
    const a = get().openDecisionTab({ corte: 'cassazione', numero: 10787, anno: 2024 });
    expect(get().openDecisionTab(REF)).toBe(a);
    expect(get().openDecisionTab({ ...REF, archivio: 'penale' })).not.toBe(a);
  });

  it('places the decision on the right half beside the article tab', () => {
    const article = get().addWorkspaceTab('art. 2043 c.c.');
    const decision = get().openDecisionTab(REF, { besideTabId: article });
    const tabOf = (id: string) => get().workspaceTabs.find((t) => t.id === id)!;
    const left = tabOf(article);
    const right = tabOf(decision);
    expect(left.position.x).toBeLessThan(right.position.x);
    expect(left.position.x + left.size.width).toBeLessThanOrEqual(right.position.x);
    expect(left.size.height).toBe(right.size.height);
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
