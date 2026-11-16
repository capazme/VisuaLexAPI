import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../useAppStore';
import { isBoundPractice, type Practice } from '../../utils/practice';
import { claimBrowserFor, forgetUserData, parkedKey, OWNER_KEY } from '../../services/sessionEnd';
import '../../services/userDataReset';
import { L24, article } from '../../utils/__fixtures__/savedWorkspaces';
import type { Dossier } from '../../types';

/**
 * LC60: the Ricerca is a reading bench of the session; the Corpus's practices left in a browser wait for the riquadro
 * (`corpusPracticesPending`), saved as before until it is answered, then gone from the browser for good.
 */

type AppState = ReturnType<typeof appStore.getState>;
const s = (): AppState => appStore.getState();
const options = () => appStore.persist.getOptions() as unknown as {
  name: string;
  partialize: (state: AppState) => Record<string, unknown>;
  merge: (persisted: unknown, current: AppState) => AppState;
};
const saved = (id: string, label: string): Practice => ({
  id, label, labelIsCustom: true, beside: [], decisions: [],
  acts: [{ id: `a-${id}`, key: 'legge|24|2017-03-08', norma: L24, articles: [article(L24, '5')], isCollapsed: false }],
});
const dossier: Dossier = { id: 'dos-1', title: 'Rossi', createdAt: '', items: [] } as unknown as Dossier;
/** The browser's saved value, as the store writes it. */
const written = () => JSON.parse(localStorage.getItem(options().name) ?? '{"state":{}}').state as Record<string, unknown>;
const writeSaved = (practices: Practice[]) =>
  localStorage.setItem(options().name, JSON.stringify({ state: { practices, activePracticeId: practices[0]?.id ?? null }, version: 1 }));

// The store's storage is the page's own (captured when the store is made), as `sessionEnd` reads it. The test setup's
// mock keeps its keys beside its methods: `clear()` would remove those too.
const forget = () => {
  for (const key of [options().name, OWNER_KEY, parkedKey('user-1'), parkedKey('user-a'), parkedKey('user-b')]) localStorage.removeItem(key);
};
beforeEach(() => {
  forget();
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, corpusPracticesPending: false });
});
afterEach(() => {
  forget();
  vi.restoreAllMocks();
});

describe('LC60: the Corpus\'s practices in the browser', () => {
  it('a load that finds some marks them as waiting for the riquadro, and keeps saving them until it is answered', async () => {
    writeSaved([saved('p1', 'Rossi'), saved('p2', 'IA Act')]);
    await appStore.persist.rehydrate();
    expect(s().corpusPracticesPending).toBe(true);
    s().createPractice('Una ricerca');
    expect((written().practices as Practice[]).map((p) => p.label)).toEqual(['Rossi', 'IA Act', 'Una ricerca']);
  });

  it('a load that finds none waits for nothing, and the Ricerca\'s table is never saved', async () => {
    writeSaved([]);
    await appStore.persist.rehydrate();
    expect(s().corpusPracticesPending).toBe(false);
    s().createPractice('Una ricerca');
    expect(written().practices).toEqual([]);
    expect(written().activePracticeId).toBeNull();
    await appStore.persist.rehydrate();
    expect(s().practices).toEqual([]);
  });

  it('once answered, the Corpus\'s practices leave the store and the browser; a dossier\'s reading table stays', async () => {
    writeSaved([saved('p1', 'Rossi')]);
    await appStore.persist.rehydrate();
    const bound = s().openDossierPractice(dossier);
    s().endCorpusPractices();
    expect(s().corpusPracticesPending).toBe(false);
    expect(s().practices.map((p) => p.id)).toEqual([bound]);
    expect(s().practices.every(isBoundPractice)).toBe(true);
    expect(written().practices).toEqual([]);
  });

  it('a sign-out before the riquadro parks them; the sign-in gives them back, waiting for it again', async () => {
    localStorage.setItem(OWNER_KEY, 'user-1');
    writeSaved([saved('p1', 'Rossi')]);
    await appStore.persist.rehydrate();
    forgetUserData();
    expect(s().practices).toEqual([]);
    expect(s().corpusPracticesPending).toBe(false);
    expect(JSON.parse(localStorage.getItem(parkedKey('user-1')) ?? '{}').store.practices).toHaveLength(1);
    claimBrowserFor('user-1', { signIn: true });
    await vi.waitFor(() => expect(s().corpusPracticesPending).toBe(true));
    expect(s().practices.map((p) => p.label)).toEqual(['Rossi']);
  });

  it('a sign-out after the riquadro parks nothing, and the sign-in brings nothing back', async () => {
    localStorage.setItem(OWNER_KEY, 'user-1');
    writeSaved([saved('p1', 'Rossi')]);
    await appStore.persist.rehydrate();
    s().endCorpusPractices();
    s().createPractice('Una ricerca');
    forgetUserData();
    expect(localStorage.getItem(parkedKey('user-1'))).toBeNull();
    claimBrowserFor('user-1', { signIn: true });
    await appStore.persist.rehydrate();
    expect(s().practices).toEqual([]);
    expect(s().corpusPracticesPending).toBe(false);
  });

  it('another person on the same browser never sees them; their owner finds them at the next sign-in', async () => {
    localStorage.setItem(OWNER_KEY, 'user-a');
    writeSaved([saved('p1', 'Rossi')]);
    await appStore.persist.rehydrate();
    claimBrowserFor('user-b', { signIn: true });
    await appStore.persist.rehydrate();
    expect(s().practices).toEqual([]);
    expect(s().corpusPracticesPending).toBe(false);
    claimBrowserFor('user-a', { signIn: true });
    await vi.waitFor(() => expect(s().corpusPracticesPending).toBe(true));
    expect(s().practices.map((p) => p.label)).toEqual(['Rossi']);
  });
});
