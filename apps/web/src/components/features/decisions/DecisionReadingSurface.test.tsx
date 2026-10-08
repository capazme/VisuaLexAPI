import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import type { Annotation, Highlight } from '../../../types';
import type { DecisionIdentity, DecisionText } from '../../../types/decisions';
import { decisionProjection } from '../../../utils/decisionRender';
import { DECISION_TEXTS } from '../../../utils/__fixtures__/decisionTexts';
import { DecisionReadingSurface } from './DecisionReadingSurface';
import { DecisionView } from './DecisionView';

const IDENTITY: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 };
const TESTO: DecisionText = {
  epigrafe: 'LA CORTE DI CASSAZIONE\nsezione terza civile',
  motivazione: 'Il ricorrente invoca l\'art. 2043 c.c. e,\n\nquanto al termine, l\'art. 5 della stessa disciplina.',
  dispositivo: 'P.Q.M. rigetta il ricorso.',
};

const textOf = (root: Element) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out += n.nodeValue;
  return out;
};

const KEY = 'cassazione:civile:99999:2024';
const loadHighlights = vi.fn();
const loadAnnotations = vi.fn();
const addHighlight = vi.fn();
const addAnnotation = vi.fn();
const removeHighlight = vi.fn();
const removeAnnotation = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({
    searchTrigger: null, readingBackStack: [], workspaceTabs: [], highlights: [], annotations: [],
    loadHighlightsForArticle: loadHighlights, loadAnnotationsForArticle: loadAnnotations,
    addHighlight, addAnnotation, removeHighlight, removeAnnotation,
  });
});

const H = { id: 'h1', normaKey: KEY, articleId: '', rangeSerialized: '', text: 'ricorso', color: 'green', startOffset: 3 } as Highlight;
const N = { id: 'n1', normaKey: KEY, articleId: '', text: 'da verificare', createdAt: '', anchorText: 'fondato', startOffset: 13 } as Annotation;
const seed = (highlights: Highlight[], annotations: Annotation[]) => appStore.setState({ highlights, annotations });

// A selection inside the first line of the first paragraph, the way a mouse leaves it.
async function selectText(container: HTMLElement, from: number, to: number) {
  const line = container.querySelector('.vlx-dec-line')!;
  // the line's text may be cut by marks: offsets are counted across its text nodes
  const at = (offset: number): [Node, number] => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let left = offset;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (left <= n.nodeValue!.length) return [n, left];
      left -= n.nodeValue!.length;
    }
    throw new Error('offset beyond the line');
  };
  const range = document.createRange();
  range.setStart(...at(from));
  range.setEnd(...at(to));
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(container.querySelector('.group\\/content')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}
Range.prototype.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });


describe('DecisionReadingSurface', () => {
  it('links «art. 2043 c.c.» and leaves a bare «art. 5» as text', () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} />);
    const links = [...container.querySelectorAll('.citation-hover')];
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => /2043|c\.c\./.test(l.textContent ?? ''))).toBe(true);
    expect(links.some((l) => /art\. 5\b/.test(l.textContent ?? ''))).toBe(false);
    expect(container.textContent).toContain('l\'art. 5 della stessa');
    expect(container.querySelector('.vlx-art.vlx-decision')).not.toBeNull();
  });

  it('keeps the contract: the rendered text nodes spell the projection, the citation spans only wrap', () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    expect(textOf(container.querySelector('.vlx-decision')!)).toBe(decisionProjection(TESTO));
  });

  it('a click searches the norm beside the host tab and records the way back to the decision', () => {
    const { container } = render(
      <DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} hostTabId="dec-tab" />,
    );
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(appStore.getState().searchTrigger).toEqual({
      act_type: 'codice civile', act_number: '', date: '', article: '2043',
      version: 'vigente', show_brocardi_info: true, besideTabId: 'dec-tab',
    });
    expect(appStore.getState().readingBackStack).toEqual([
      { tabId: 'dec-tab', blockId: 'dec-tab', articleId: '', label: 'Cass. civ., sez. III, n. 99999/2024' },
    ]);
  });

  it('without a host tab the norm opens by the ordinary search and no way back is recorded', () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'codice civile', article: '2043' });
    expect(appStore.getState().searchTrigger).not.toHaveProperty('besideTabId');
    expect(appStore.getState().readingBackStack).toEqual([]);
  });

  // The real mount (ArticleBody -> SafeHTML -> DOMPurify), over every fixture. The carriage-return
  // fixture is a renderer-level case: the readers normalise CR to LF (italgiure:v4), so none
  // reaches a page, and the sanitiser's re-serialisation would read one as a line feed. A decision
  // without text never mounts the surface (DecisionView draws a notice instead).
  for (const [name, testo] of Object.entries(DECISION_TEXTS).filter(([n, t]) => n !== 'carriage_return' && decisionProjection(t) !== '')) {
    it(`${name}: the rendered text nodes spell the projection`, () => {
      const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={testo} attributi={{}} />);
      expect(textOf(container.querySelector('.vlx-decision')!)).toBe(decisionProjection(testo));
    });
  }

  it('copies a selection across two lines with the space between them, as the plain view did', () => {
    const { container } = render(
      <DecisionReadingSurface identity={IDENTITY} testo={{ motivazione: 'prima riga\nseconda riga' }} attributi={{}} />,
    );
    const lines = container.querySelectorAll('.vlx-dec-line');
    expect(lines).toHaveLength(2);
    const range = document.createRange();
    range.setStart(lines[0].firstChild!, 6);
    range.setEnd(lines[1].firstChild!, 7);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const setData = vi.fn();
    const notPrevented = fireEvent.copy(container.querySelector('.vlx-decision')!, { clipboardData: { setData } });
    expect(notPrevented).toBe(false);
    expect(setData).toHaveBeenCalledWith('text/plain', 'riga seconda');
  });
});

describe('DecisionReadingSurface — notes and highlights', () => {
  const MOTIVAZIONE = { motivazione: 'Il ricorso è fondato.' };

  it('loads, renders and creates highlights under the decision key', async () => {
    seed([{ ...H, text: 'fondato', startOffset: 13 }], []);
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={MOTIVAZIONE} attributi={{}} />);
    expect(loadHighlights).toHaveBeenCalledWith(KEY, '');
    expect(loadAnnotations).toHaveBeenCalledWith(KEY, '');
    expect(container.querySelector('mark')?.textContent).toBe('fondato');
    await selectText(container, 3, 10);
    fireEvent.click(await screen.findByTitle('Evidenzia (H)'));
    fireEvent.click(await screen.findByTitle('Evidenzia in yellow'));
    expect(addHighlight).toHaveBeenCalledWith(KEY, '', 'ricorso', expect.any(String), 'yellow', 3);
  });

  it('anchors a note on the selection, with the composer on the words', async () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={MOTIVAZIONE} attributi={{}} />);
    await selectText(container, 3, 10);
    fireEvent.click(await screen.findByTitle('Aggiungi nota (N)'));
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'da verificare' } });
    fireEvent.click(screen.getByRole('button', { name: /Salva/ }));
    expect(addAnnotation).toHaveBeenCalledWith(KEY, '', 'da verificare', { anchorText: 'ricorso', startOffset: 3 });
  });

  it('draws the sign on an annotated paragraph and its popover lists the notes and highlights', async () => {
    seed([H], [N]);
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={MOTIVAZIONE} attributi={{}} />);
    const sign = container.querySelector<HTMLElement>('.vlx-sign[data-block="0"]')!;
    expect(sign).not.toBeNull();
    expect(container.querySelectorAll('.vlx-sign')).toHaveLength(1);
    fireEvent.click(sign);
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni · Il ricorso è fondato\./ });
    expect(within(dialog).getByText('da verificare')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/ricorso/).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getAllByRole('button', { name: /Rimuovi/ })[0]);
    expect(removeHighlight.mock.calls.length + removeAnnotation.mock.calls.length).toBe(1);
  });

  it('keeps the contract with signs and marks on: the text nodes still spell the projection', () => {
    const plain = decisionProjection(TESTO);
    const word = 'ricorrente';
    const at = plain.indexOf(word);
    const later = plain.indexOf('termine');
    seed(
      [{ ...H, text: word, startOffset: at }],
      [{ ...N, anchorText: 'termine', startOffset: later }],
    );
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    expect(container.querySelector('mark')?.textContent).toBe(word);
    expect(container.querySelector('.note-anchor')?.textContent).toBe('termine');
    expect(container.querySelectorAll('.vlx-sign').length).toBeGreaterThan(0);
    expect(textOf(container.querySelector('.vlx-decision')!)).toBe(decisionProjection(TESTO));
  });

  it('lists a highlight whose words are gone, with its text, and removes it on request', async () => {
    seed([{ ...H, text: 'parole sparite' }], []);
    render(<DecisionReadingSurface identity={IDENTITY} testo={MOTIVAZIONE} attributi={{}} />);
    const box = await screen.findByRole('region', { name: 'Non ritrovate nel testo attuale (1)' });
    expect(within(box).getByText('«parole sparite»')).toBeInTheDocument();
    expect(within(box).getByText('Il testo della fonte è cambiato dopo che le hai create.')).toBeInTheDocument();
    fireEvent.click(within(box).getByRole('button', { name: 'Rimuovi evidenziazione «parole sparite»' }));
    expect(removeHighlight).toHaveBeenCalledWith('h1');
  });

  it('does not list a free note (no anchor) as lost: the notes panel holds it', () => {
    seed([], [{ ...N, anchorText: undefined, startOffset: undefined } as Annotation]);
    render(<DecisionReadingSurface identity={IDENTITY} testo={MOTIVAZIONE} attributi={{}} />);
    expect(screen.queryByRole('region', { name: /Non ritrovate/ })).toBeNull();
  });

  it('lists a lost note with its words and removes it', async () => {
    seed([], [{ ...N, anchorText: 'altro testo' }]);
    render(<DecisionReadingSurface identity={IDENTITY} testo={MOTIVAZIONE} attributi={{}} />);
    const box = await screen.findByRole('region', { name: 'Non ritrovate nel testo attuale (1)' });
    fireEvent.click(within(box).getByRole('button', { name: 'Rimuovi nota «da verificare»' }));
    expect(removeAnnotation).toHaveBeenCalledWith('n1');
  });

  it('says the notes list is empty in the decision\'s own words', async () => {
    render(<DecisionReadingSurface identity={IDENTITY} testo={MOTIVAZIONE} attributi={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri note' }));
    expect(await screen.findByText('Nessuna nota su questa decisione.')).toBeInTheDocument();
  });

  it('hides the highlights from the picker without losing them', async () => {
    seed([H], []);
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={MOTIVAZIONE} attributi={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestisci evidenziazioni' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nascondi evidenziazioni' }));
    await waitFor(() => expect(container.querySelector('.highlights-hidden')).not.toBeNull());
    expect(container.querySelector('mark')).not.toBeNull();
  });
});

describe('DecisionView — what has no text or no identity', () => {
  const FOUND = {
    esito: 'trovata' as const,
    identita: IDENTITY,
    attributi: { testo_assente: 'oscuramento' },
    testo: {},
    avvisi: [{ tipo: 'testo_non_disponibile' as const }],
    fonte: { nome: 'Italgiure', url: 'https://www.italgiure.giustizia.it/', licenza: 'x' },
  };
  const view = (answer: unknown) => render(
    <DecisionView answer={answer as never} reference={IDENTITY} onRetry={() => {}} onChooseCandidate={() => {}} onOpenPalette={() => {}} />,
  );

  it('a decision found without its text lists every note and highlight under the notice', async () => {
    seed([H], [N]);
    view(FOUND);
    const box = await screen.findByRole('region', { name: 'Non ritrovate nel testo attuale (2)' });
    expect(within(box).getByText(/La fonte non mostra più il testo/)).toBeInTheDocument();
    expect(loadHighlights).toHaveBeenCalledWith(KEY, '');
  });

  it('draws nothing for a decision with no notes and no text', () => {
    view(FOUND);
    expect(screen.queryByRole('region', { name: /Non ritrovate/ })).toBeNull();
  });

  it('an ambiguous reference takes no notes: no tools, nothing loaded', () => {
    view({ esito: 'ambigua', candidati: [{ identita: IDENTITY, attributi: {} }] });
    expect(screen.queryByRole('button', { name: /note|evidenziazioni/i })).toBeNull();
    expect(loadHighlights).not.toHaveBeenCalled();
  });
});
