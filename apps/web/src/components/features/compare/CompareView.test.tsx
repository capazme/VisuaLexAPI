import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  appStore.setState({ practices: [], activePracticeId: null });
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

describe('CompareView — the articles of the practices (spec §6.8)', () => {
  it('lists every practice\'s articles, the text in force and the past text apart, each named with its practice', () => {
    appStore.setState({
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
    expect(within(leftPanel()).getByRole('button', { name: 'Dalle pratiche (3)' })).toBeInTheDocument();
  });
});
