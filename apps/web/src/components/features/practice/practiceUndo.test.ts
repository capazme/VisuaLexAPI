import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appStore } from '../../../store/useAppStore';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { notificationStore, resetNotifications } from '../../ui/notifications/notifications';
import { articleRowKey, practiceArticleKey } from '../../../utils/practice';
import { L24, L241, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { closeAllPracticesWithUndo, closePracticeWithUndo, removePracticeActWithUndo } from './practiceUndo';

type AppState = ReturnType<typeof appStore.getState>;
const s = (): AppState => appStore.getState();
let shown: UndoToast | null;
let unregister: () => void;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null });
  shown = null;
  unregister = registerUndoToastListener((t) => { shown = t; });
});
afterEach(() => {
  unregister();
  resetNotifications();
});

describe('practiceUndo (K1a)', () => {
  it('a closed practice comes back at its place, active, with its open rows; one opened meanwhile stays', async () => {
    const a = s().createPractice('Prima');
    const b = s().createPractice('Seconda');
    const { actId } = s().addArticlesToPractice(b, L24, [article(L24, '5')]);
    const row = articleRowKey(b, actId, practiceArticleKey(article(L24, '5')));
    appStore.setState((st) => ({ practiceRows: { ...st.practiceRows, [row]: true } }));
    s().setActivePractice(b);
    closePracticeWithUndo(b);
    expect(s().practices.map((p) => p.id)).toEqual([a]);
    expect(s().practiceRows[row]).toBeUndefined();
    const c = s().createPractice('Nuova', { activate: false });
    await settle();
    await shown!.onUndo();
    expect(s().practices.map((p) => p.id)).toEqual([a, b, c]);
    expect(s().activePracticeId).toBe(b);
    expect(s().practiceRows[row]).toBe(true);
  });

  it('closing them all comes back as it was, the active one too', async () => {
    const a = s().createPractice('Prima');
    const b = s().createPractice('Seconda');
    s().setActivePractice(a);
    closeAllPracticesWithUndo();
    expect(s().practices).toEqual([]);
    await settle();
    expect(shown!.message).toBe('2 pratiche chiuse');
    await shown!.onUndo();
    expect(s().practices.map((p) => p.id)).toEqual([a, b]);
    expect(s().activePracticeId).toBe(a);
  });

  it('an act taken off comes back at its place, with the windows it had beside', async () => {
    const p = s().createPractice('Pratica');
    const first = s().addArticlesToPractice(p, L24, [article(L24, '5')]).actId;
    s().addArticlesToPractice(p, L241, [article(L241, '1')]);
    const window = { id: 'w1', kind: 'article' as const, actId: first, articleKey: practiceArticleKey(article(L24, '5')) };
    appStore.setState((st) => ({ practices: st.practices.map((x) => ({ ...x, beside: [window] })) }));
    removePracticeActWithUndo(p, first);
    expect(s().practices[0].acts.map((a) => a.id)).not.toContain(first);
    expect(s().practices[0].beside).toEqual([]);
    await settle();
    await shown!.onUndo();
    expect(s().practices[0].acts[0].id).toBe(first);
    expect(s().practices[0].beside).toEqual([window]);
  });

  it('the same act added again meanwhile takes the removed articles: no second copy', async () => {
    const p = s().createPractice('Pratica');
    const first = s().addArticlesToPractice(p, L24, [article(L24, '5')]).actId;
    removePracticeActWithUndo(p, first);
    s().addArticlesToPractice(p, L24, [article(L24, '6')]);
    await settle();
    await shown!.onUndo();
    expect(s().practices[0].acts).toHaveLength(1);
    expect(s().practices[0].acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['5', '6']);
  });

  it('its windows come back only while the row has room for two', async () => {
    const p = s().createPractice('Pratica');
    const first = s().addArticlesToPractice(p, L24, [article(L24, '5'), article(L24, '6')]).actId;
    const win = (n: string) => ({ id: `w${n}`, kind: 'article' as const, actId: first, articleKey: practiceArticleKey(article(L24, n)) });
    appStore.setState((st) => ({ practices: st.practices.map((x) => ({ ...x, beside: [win('5'), win('6')] })) }));
    removePracticeActWithUndo(p, first);
    const other = { id: 'd1', kind: 'decision' as const, decisionId: 'cass-1' };
    appStore.setState((st) => ({ practices: st.practices.map((x) => ({ ...x, beside: [other as never] })) }));
    await settle();
    await shown!.onUndo();
    expect(s().practices[0].beside).toHaveLength(2);
  });

  it('an act whose practice was closed meanwhile cannot come back: «Annulla» says so, never «Ripristinato»', async () => {
    const p = s().createPractice('Pratica');
    s().createPractice('Altra');
    const actId = s().addArticlesToPractice(p, L24, [article(L24, '5')]).actId;
    removePracticeActWithUndo(p, actId);
    await settle();
    const removal = shown!;
    closePracticeWithUndo(p);
    await settle();
    await removal.onUndo();
    const messages = notificationStore.getState().entries.map((e) => e.message);
    expect(messages).toContain('Non ripristinabile: la pratica «Pratica» è stata chiusa.');
    expect(messages).not.toContain('Ripristinato');
    // The practice's own «Annulla» still brings it back, without the act (it was taken off before).
    await shown!.onUndo();
    expect(s().practices.find((x) => x.id === p)?.acts).toEqual([]);
    expect(notificationStore.getState().entries.map((e) => e.message)).toContain('Ripristinato');
  });
});
