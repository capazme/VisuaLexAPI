import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompareView } from './CompareView';
import { Modal } from '../../ui/Modal';
import { appStore } from '../../../store/useAppStore';
import { closeCompare, getCompareState, setCompareState } from '../../../hooks/useCompare';
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

describe('CompareView — a modal dialog, as the app\'s others', () => {
  // jsdom lays nothing out: every element is «visible» to the trap, as in a browser.
  const laidOut = () => vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
    return this.parentElement;
  });
  const focusables = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));

  it('is a modal dialog named by its title', () => {
    render(<CompareView />);
    const dialog = screen.getByRole('dialog', { name: 'Confronta articoli' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Chiudi il confronto' }));
  });

  it('takes the focus on «Chiudi» as it opens and gives it back to what had it once it closes', async () => {
    closeCompare();
    render(<><button type="button">Confronta</button><CompareView /></>);
    const opener = screen.getByRole('button', { name: 'Confronta' });
    opener.focus();
    act(() => setCompareState({ isOpen: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chiudi il confronto' })).toHaveFocus());
    act(() => closeCompare());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside: past the last control to the first, before the first to the last, and in from the page', () => {
    const offsetParent = laidOut();
    render(<><button type="button">Fuori</button><CompareView /></>);
    const dialog = screen.getByRole('dialog', { name: 'Confronta articoli' });
    const inside = focusables(dialog);
    const [first, last] = [inside[0], inside[inside.length - 1]];
    expect(inside.length).toBeGreaterThan(2);

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    const outside = screen.getByRole('button', { name: 'Fuori' });
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Tab' });
    expect(first).toHaveFocus();
    offsetParent.mockRestore();
  });

  it('leaves Esc and Tab to a dialog opened over it, and closes on Esc once it is the top-most', () => {
    const onClose = vi.fn();
    const offsetParent = laidOut();
    const { rerender } = render(<><CompareView /><Modal isOpen onClose={onClose} title="Sopra"><button type="button">Dentro</button></Modal></>);
    const inner = screen.getByRole('button', { name: 'Dentro' });
    inner.focus();
    // The comparison's trap would send the focus to its own first control.
    fireEvent.keyDown(inner, { key: 'Tab' });
    expect(screen.getByRole('dialog', { name: 'Sopra' })).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getCompareState().isOpen).toBe(true);

    rerender(<><CompareView /><Modal isOpen={false} onClose={onClose} title="Sopra" /></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(getCompareState().isOpen).toBe(false);
    offsetParent.mockRestore();
  });
});

