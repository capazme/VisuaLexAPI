import { beforeEach, describe, expect, it } from 'vitest';
import { appStore } from '../useAppStore';

const get = () => appStore.getState();

beforeEach(() => appStore.setState({ workspaceTabs: [], practices: [], activePracticeId: null, pendingDecision: null }));

describe('decision tabs', () => {
  it('does not tell two labels of one norm search apart', () => {
    const norma = { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '2043' };
    const a = get().openDecisionSearchTab({ norma, normaLabel: 'art. 2043 c.c.' }, 'a');
    expect(get().openDecisionSearchTab({ norma, normaLabel: 'Art. 2043 codice civile' }, 'b')).toBe(a);
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
});
