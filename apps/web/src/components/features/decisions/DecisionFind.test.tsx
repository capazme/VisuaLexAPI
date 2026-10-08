import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import type { DecisionIdentity, DecisionText, FoundDecision } from '../../../types/decisions';
import { FakeHighlight } from '../../../utils/__fixtures__/openFind';
import { DecisionReadingSurface } from './DecisionReadingSurface';
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
    searchTrigger: null, readingBackStack: [], workspaceTabs: [], highlights: [], annotations: [],
    loadHighlightsForArticle: vi.fn(), loadAnnotationsForArticle: vi.fn(),
  });
});
afterEach(() => {
  delete g.CSS;
  delete g.Highlight;
});

const surface = () => <DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} />;
const openIn = (scope: ReturnType<typeof within>) => fireEvent.click(scope.getByRole('button', { name: 'Cerca nel testo' }));
const typeIn = (scope: ReturnType<typeof within>, value: string) =>
  fireEvent.change(scope.getByRole('searchbox', { name: 'Cerca nel testo' }), { target: { value } });
const drawn = (name: string) => registry.get(name)?.ranges.length ?? 0;

describe('«Cerca nel testo» on a decision', () => {
  it('has the button on a decision with text, and no box until it is pressed', () => {
    render(surface());
    expect(screen.getByRole('button', { name: 'Cerca nel testo' })).toHaveAttribute('aria-pressed', 'false');
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

  it('finds a word typed without its accent, and the same word with it', async () => {
    render(surface());
    openIn(screen);
    typeIn(screen, 'societa');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 di 1'));
    typeIn(screen, 'società');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 di 1'));
    typeIn(screen, 'perche');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 di 1'));
    expect(drawn('vlx-find-current')).toBe(1);
  });

  it('searches the decision text only: not the notices around it', async () => {
    // A highlight whose words are not in the text is listed by UnmatchedAnchors, outside the text root
    const lost = { id: 'h1', normaKey: decisionKey(IDENTITY), articleId: '', rangeSerialized: '', text: 'parole sparite', color: 'red', startOffset: 3 } as Highlight;
    appStore.setState({ highlights: [lost] });
    render(surface());
    expect(document.body.textContent).toContain('parole sparite');
    expect(document.body.textContent).toContain('Il testo della fonte è cambiato');
    openIn(screen);
    typeIn(screen, 'parole sparite');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nessun risultato'));
    typeIn(screen, 'fonte è cambiato');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nessun risultato'));
    expect(drawn('vlx-find')).toBe(0);
  });

  it('orders the buttons as the article does: discussion, then find', () => {
    render(surface());
    const find = screen.getByRole('button', { name: 'Cerca nel testo' });
    const discussion = screen.getByRole('button', { name: /Discussioni/ });
    expect(discussion.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('steps with Enter and Shift+Enter, and closes on Esc giving focus back to the button', async () => {
    render(surface());
    openIn(screen);
    typeIn(screen, 'ricorso');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 di 2'));
    const field = screen.getByRole('searchbox');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('2 di 2');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('1 di 2');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(registry.size).toBe(0);
    expect(screen.getByRole('button', { name: 'Cerca nel testo' })).toHaveFocus();
  });

  it('Esc in the field does not reach the document, so an open panel stays open', () => {
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    render(surface());
    openIn(screen);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    document.removeEventListener('keydown', onDocKey);
    expect(onDocKey).not.toHaveBeenCalled();
  });

  it('two decisions searching at once keep both sets of ranges', async () => {
    render(<><div data-testid="a">{surface()}</div><div data-testid="b">{surface()}</div></>);
    for (const id of ['a', 'b']) {
      const scope = within(screen.getByTestId(id));
      openIn(scope);
      typeIn(scope, 'ricorso');
    }
    await waitFor(() => expect(drawn('vlx-find-current')).toBe(2));
    expect(drawn('vlx-find')).toBe(2);
    fireEvent.keyDown(within(screen.getByTestId('a')).getByRole('searchbox'), { key: 'Escape' });
    expect(drawn('vlx-find-current')).toBe(1);
    expect(drawn('vlx-find')).toBe(1);
  });
});
