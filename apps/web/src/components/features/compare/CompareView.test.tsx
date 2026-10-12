import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompareView } from './CompareView';
import { appStore } from '../../../store/useAppStore';
import { closeCompare, setCompareState } from '../../../hooks/useCompare';
import { isWorkspaceCovered } from '../../../utils/findWindowControl';
import type { ArticleData, Norma, NormaVisitata } from '../../../types';

const NORMA: Norma = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2' };
const IN_FORCE: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284', allegato: '2',
};
const PAST: NormaVisitata = { ...IN_FORCE, versione: 'vigente', data_versione: '2007-12-29' };
const ORIGINAL: NormaVisitata = { ...IN_FORCE, versione: 'originale' };

const article = (norma_data: NormaVisitata): ArticleData => ({ article_text: 'testo', norma_data });

// Each tab has its own id, as a past text opens in a tab of its own.
function tab(id: string, label: string, content: unknown[]) {
  return { id, label, position: { x: 0, y: 0 }, size: { width: 800, height: 600 }, zIndex: 1, isMinimized: false, isHidden: false, labelIsCustom: false, content };
}

const normaBlock = (id: string, data: NormaVisitata) => ({
  type: 'norma' as const, id, norma: NORMA, articles: [article(data)], isCollapsed: false,
});

// The selector is drawn once per side: the labels of one side are enough.
// heading -> its header -> the panel
const leftPanel = () => screen.getByText('Seleziona primo articolo').parentElement!.parentElement!;
const pickerLabels = () => within(leftPanel()).getAllByText(/^art\. 128\d c\.c\./).map((el) => el.textContent);

beforeEach(() => {
  closeCompare();
  setCompareState({ isOpen: true });
});

afterEach(() => {
  cleanup(); // unmount before the singleton notifies its listeners
  closeCompare();
  appStore.setState({ workspaceTabs: [] });
});

describe('CompareView — the articles it lists from the open tabs', () => {
  it('names the version of a past text, so it cannot pass for the text in force', () => {
    appStore.setState({
      workspaceTabs: [
        tab('t1', 'Codice civile', [normaBlock('n1', IN_FORCE)]),
        tab('t2', 'Codice civile — testo al 29/12/2007', [normaBlock('n2', PAST)]),
        tab('t3', 'Codice civile — testo originale', [normaBlock('n3', ORIGINAL)]),
      ] as never,
    });
    render(<CompareView />);
    expect(pickerLabels()).toEqual([
      'art. 1284 c.c.',
      'art. 1284 c.c. — testo al 29/12/2007',
      'art. 1284 c.c. — testo originale',
    ]);
  });

  it('names the version of a past loose article', () => {
    appStore.setState({
      workspaceTabs: [
        tab('t1', 'Sparsi', [{ type: 'loose-article', id: 'l1', article: article(PAST), sourceNorma: NORMA }]),
        tab('t2', 'Altri sparsi', [
          { type: 'loose-article', id: 'l2', article: article(PAST), sourceNorma: NORMA },
          { type: 'loose-article', id: 'l3', article: article({ ...IN_FORCE, numero_articolo: '1285' }), sourceNorma: NORMA },
        ]),
      ] as never,
    });
    render(<CompareView />);
    expect(pickerLabels()).toEqual([
      'art. 1284 c.c. — testo al 29/12/2007',
      'art. 1284 c.c. — testo al 29/12/2007',
      'art. 1285 c.c.',
    ]);
  });
});

describe('CompareView — over the workspace', () => {
  it('leaves Cmd/Ctrl+F to the browser while it is open', () => {
    render(<CompareView />);
    expect(isWorkspaceCovered()).toBe(true);
    cleanup();
    closeCompare();
    render(<CompareView />);
    expect(isWorkspaceCovered()).toBe(false);
  });
});

describe('CompareView — the articles of the practices (flag on, spec §6.8)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    appStore.setState({ practices: [], activePracticeId: null });
  });

  it('lists every practice\'s articles, the text in force and the past text apart, each named with its practice', () => {
    vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
    appStore.setState({
      workspaceTabs: [tab('t1', 'Una tab', [normaBlock('n1', IN_FORCE)])] as never,
      practices: [
        { id: 'p1', label: 'Interessi', labelIsCustom: true, decisions: [], beside: [],
          acts: [{ id: 'a1', key: 'codice civile', norma: NORMA, articles: [article(IN_FORCE), article(PAST)], isCollapsed: false }] },
        { id: 'p2', label: 'Originale', labelIsCustom: true, decisions: [], beside: [],
          acts: [{ id: 'a2', key: 'codice civile', norma: NORMA, articles: [article(ORIGINAL)], isCollapsed: false }] },
      ],
      activePracticeId: 'p1',
    });
    render(<CompareView />);
    expect(pickerLabels()).toEqual([
      'art. 1284 c.c.',
      'art. 1284 c.c. — testo al 29/12/2007',
      'art. 1284 c.c. — testo originale',
    ]);
    expect(within(leftPanel()).getAllByText('Interessi')).toHaveLength(2);
    expect(within(leftPanel()).getByText('Originale')).toBeInTheDocument();
    expect(within(leftPanel()).queryByText('Una tab')).toBeNull();
    expect(within(leftPanel()).getByRole('button', { name: 'Dalle pratiche (3)' })).toBeInTheDocument();
  });
});
