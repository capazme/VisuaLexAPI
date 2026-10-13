import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { appStore } from '../../../store/useAppStore';
import type { DecisionIdentity, DecisionText, FoundDecision } from '../../../types/decisions';
import { FakeHighlight } from '../../../utils/__fixtures__/openFind';
import { DecisionReadingSurface } from './DecisionReadingSurface';
import { FindWindow } from '../search/FindWindow';
import { closeFindWindow } from '../../../utils/findWindowControl';
import { decisionKey } from '../../../utils/decisionLinks';
import type { Highlight } from '../../../types';
import { DecisionView } from './DecisionView';

const IDENTITY: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 };
const TESTO: DecisionText = {
  epigrafe: 'LA CORTE DI CASSAZIONE\nsezione terza civile',
  motivazione: 'Il ricorrente invoca l\'art. 2043 c.c. Perché il danno è provato, la società risponde.',
  dispositivo: 'P.Q.M. rigetta il ricorso principale e il ricorso incidentale.',
};

const FOUND_WITHOUT_TEXT: FoundDecision = {
  esito: 'trovata',
  identita: IDENTITY,
  attributi: { testo_assente: 'oscuramento' },
  testo: {},
  avvisi: [{ tipo: 'testo_non_disponibile' }],
  fonte: { nome: 'Italgiure', url: 'https://www.italgiure.giustizia.it/', licenza: 'x' },
};

const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;

beforeEach(() => {
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  appStore.setState({
    searchTrigger: null, readingBackStack: [], practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, highlights: [], annotations: [],
    loadHighlightsForArticle: vi.fn(), loadAnnotationsForArticle: vi.fn(),
  });
});
afterEach(() => {
  delete g.CSS;
  delete g.Highlight;
});

const surface = (hostTabId?: string) => <DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} hostTabId={hostTabId} />;
/** The decision as an entry of a practice, read in its row. */
const inTab = () => surface(appStore.getState().openDecision(IDENTITY, { open: false }).practiceId);
const withWindow = (ui: ReactNode) => <>{ui}<FindWindow /></>;
const magnifier = () => screen.getByRole('button', { name: 'Cerca nel testo' });
const typeQuery = (value: string) => fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nel testo' }), { target: { value } });
const drawn = (name: string) => registry.get(name)?.ranges.length ?? 0;

afterEach(() => {
  act(() => closeFindWindow());
});

describe('«Cerca nel testo» on a decision', () => {
  it('has the magnifier on a decision with text, and no window until it is pressed', () => {
    render(withWindow(surface()));
    expect(magnifier()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('has none on a decision without text', () => {
    render(
      <DecisionView
        answer={FOUND_WITHOUT_TEXT}
        reference={IDENTITY}
        onRetry={vi.fn()}
        onChooseCandidate={vi.fn()}
        onOpenPalette={vi.fn()}
        textSlot={<DecisionReadingSurface identity={IDENTITY} testo={{}} attributi={{}} />}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cerca nel testo' })).not.toBeInTheDocument();
  });

  it('opens the window scoped to its practice, not a box under the toolbar', () => {
    render(withWindow(inTab()));
    fireEvent.click(magnifier());
    expect(screen.getByRole('search').closest('.glass-toolbar')).toBeNull();
    expect(magnifier()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Questa pratica' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('finds a word typed without its accent, and the same word with it', async () => {
    render(withWindow(inTab()));
    fireEvent.click(magnifier());
    typeQuery('societa');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 di 1'));
    typeQuery('società');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 di 1'));
    typeQuery('perche');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 di 1'));
    expect(drawn('vlx-find-current')).toBe(1);
  });

  it('searches the decision text only: not the notices around it', async () => {
    // A highlight whose words are not in the text is listed by UnmatchedAnchors, outside the text root
    const lost = { id: 'h1', normaKey: decisionKey(IDENTITY), articleId: '', rangeSerialized: '', text: 'parole sparite', color: 'red', startOffset: 3 } as Highlight;
    appStore.setState({ highlights: [lost] });
    render(withWindow(inTab()));
    expect(document.body.textContent).toContain('parole sparite');
    expect(document.body.textContent).toContain('Il testo della fonte è cambiato');
    fireEvent.click(magnifier());
    typeQuery('parole sparite');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nessun risultato'));
    typeQuery('fonte è cambiato');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nessun risultato'));
    expect(drawn('vlx-find')).toBe(0);
  });

  it('orders the buttons as the article does: discussion, then find', () => {
    render(withWindow(surface()));
    const discussion = screen.getByRole('button', { name: /Discussioni/ });
    expect(discussion.compareDocumentPosition(magnifier()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('steps with Enter and Shift+Enter, and closes on Esc giving focus back to the magnifier', async () => {
    render(withWindow(inTab()));
    const button = magnifier();
    fireEvent.click(button);
    typeQuery('ricorso');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 di 2'));
    const field = screen.getByRole('searchbox');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('2 di 2');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('1 di 2');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(registry.size).toBe(0);
    expect(button).toHaveFocus();
  });

  it('Esc in the window does not reach the document, so an open panel stays open', () => {
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    render(withWindow(surface()));
    fireEvent.click(magnifier());
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    document.removeEventListener('keydown', onDocKey);
    expect(onDocKey).not.toHaveBeenCalled();
  });
});
