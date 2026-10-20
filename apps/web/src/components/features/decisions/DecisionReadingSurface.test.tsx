import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import type { Annotation, Highlight } from '../../../types';
import type { DecisionIdentity, DecisionText } from '../../../types/decisions';
import { decisionProjection } from '../../../utils/decisionRender';
import { DECISION_TEXTS } from '../../../utils/__fixtures__/decisionTexts';
import { DecisionReadingSurface } from './DecisionReadingSurface';
import { DecisionView } from './DecisionView';
import { findRootsFor } from '../../../utils/findTargets';
import { findTargetsInScope } from '../../../utils/findScope';

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
// What the surface records is the call: the store keeps an entry only when it names a practice's subject.
const pushReadingBack = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({
    searchTrigger: null, readingBackStack: [], highlights: [], annotations: [],
    loadHighlightsForArticle: loadHighlights, loadAnnotationsForArticle: loadAnnotations,
    addHighlight, addAnnotation, removeHighlight, removeAnnotation, pushReadingBack,
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

  it('a click searches the norm beside the host and records the way back to the decision', () => {
    const { container } = render(
      <DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} hostTabId="dec-tab" />,
    );
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(appStore.getState().searchTrigger).toEqual({
      act_type: 'codice civile', act_number: '', date: '', article: '2043',
      version: 'vigente', besideId: 'dec-tab',
    });
    expect(pushReadingBack).toHaveBeenCalledExactlyOnceWith(
      { tabId: 'dec-tab', blockId: 'dec-tab', articleId: '', label: 'Cass. civ., sez. III, n. 99999/2024' },
    );
  });

  it('a host block names the place the way back returns to, inside the host (a decision row of a practice)', () => {
    const { container } = render(
      <DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} hostTabId="practice-1" hostBlockId="decision-1" />,
    );
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(appStore.getState().searchTrigger).toMatchObject({ besideId: 'practice-1' });
    expect(pushReadingBack).toHaveBeenCalledExactlyOnceWith(
      { tabId: 'practice-1', blockId: 'decision-1', articleId: '', label: 'Cass. civ., sez. III, n. 99999/2024' },
    );
  });

  it('without a host tab the norm opens by the ordinary search and no way back is recorded', () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'codice civile', article: '2043' });
    expect(appStore.getState().searchTrigger).not.toHaveProperty('besideId');
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

describe('DecisionReadingSurface — the decisions the text cites', () => {
  const CITING: DecisionText = {
    motivazione: 'Così Cass. civ., sez. III, n. 99999/2024 (questa stessa), Sez. U, n. 9100 del 2015, Corte cost. n. 71/2020 e C-634/21.',
  };
  const openDecision = vi.fn(() => ({ practiceId: 'p', decisionId: 'd' }));
  const originalOpen = appStore.getState().openDecision;
  beforeEach(() => appStore.setState({ openDecision } as never));
  afterEach(() => appStore.setState({ openDecision: originalOpen }));
  const written = (container: HTMLElement) => [...container.querySelectorAll('.decision-cite')].map((e) => e.textContent);

  it('links them, not the decision to itself, and reads a bare section as the Cassazione’s', () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={CITING} attributi={{}} />);
    expect(written(container)).toEqual(['Sez. U, n. 9100 del 2015', 'Corte cost. n. 71/2020', 'C-634/21']);
    expect(textOf(container.querySelector('.vlx-decision')!)).toBe(decisionProjection(CITING));
  });

  it('reads a bare section as a Cassazione citation only inside a Cassazione decision', () => {
    const { container } = render(
      <DecisionReadingSurface identity={{ corte: 'corte_costituzionale', numero: 5, anno: 2020 }} testo={CITING} attributi={{}} />,
    );
    expect(written(container)).toEqual(['Cass. civ., sez. III, n. 99999/2024', 'Corte cost. n. 71/2020', 'C-634/21']);
  });

  it('a click records the way back, then opens the decision beside the host', () => {
    const { container } = render(
      <DecisionReadingSurface identity={IDENTITY} testo={CITING} attributi={{ sezione: '3' }} hostTabId="practice-1" hostBlockId="decision-1" />,
    );
    fireEvent.click(container.querySelector('.decision-cite')!);
    expect(pushReadingBack).toHaveBeenCalledExactlyOnceWith(
      { tabId: 'practice-1', blockId: 'decision-1', articleId: '', label: 'Cass. civ., sez. III, n. 99999/2024' },
    );
    expect(openDecision).toHaveBeenCalledExactlyOnceWith(
      { corte: 'cassazione', numero: 9100, anno: 2015, sezione: 'U' },
      { fromLink: true, besideId: 'practice-1' },
    );
  });
});

describe('DecisionReadingSurface — a Corte costituzionale decision cites its own precedents', () => {
  const CC: DecisionIdentity = { corte: 'corte_costituzionale', numero: 99, anno: 2024 };
  const OWN: DecisionText = {
    motivazione: 'Come già affermato con l\'ordinanza n. 207 del 2018 e con le sentenze n. 253 del 2009 e n. 12 del 2010; non così la sentenza n. 7 del 2017 della Corte di cassazione. Questa sentenza n. 99 del 2024 è la presente.',
  };
  const openDecision = vi.fn(() => ({ practiceId: 'p', decisionId: 'd' }));
  const originalOpen = appStore.getState().openDecision;
  beforeEach(() => appStore.setState({ openDecision } as never));
  afterEach(() => appStore.setState({ openDecision: originalOpen }));
  const written = (container: HTMLElement) => [...container.querySelectorAll('.decision-cite')].map((e) => e.textContent);

  it('reads «ordinanza/sentenza n. … del …» as the Court’s own, not the decision itself nor one of another court', () => {
    const { container } = render(<DecisionReadingSurface identity={CC} testo={OWN} attributi={{}} />);
    expect(written(container)).toEqual(['ordinanza n. 207 del 2018', 'sentenze n. 253 del 2009', 'n. 12 del 2010']);
    expect(textOf(container.querySelector('.vlx-decision')!)).toBe(decisionProjection(OWN));
  });

  it('a click opens the precedent beside the host', () => {
    const { container } = render(<DecisionReadingSurface identity={CC} testo={OWN} attributi={{}} hostTabId="practice-1" />);
    fireEvent.click(container.querySelector('.decision-cite')!);
    expect(openDecision).toHaveBeenCalledExactlyOnceWith({ corte: 'corte_costituzionale', numero: 207, anno: 2018 }, { fromLink: true, besideId: 'practice-1' });
  });

  it('is the Court’s own rule: a Cassazione decision links no bare «sentenza n. …»', () => {
    const { container } = render(<DecisionReadingSurface identity={{ corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 }} testo={OWN} attributi={{}} />);
    expect(written(container)).toEqual([]);
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

describe('DecisionReadingSurface — the find window\'s text root', () => {
  it('registers its text root under the key the scope computes for the decision tab', () => {
    const tabId = appStore.getState().openDecision(IDENTITY, { fromLink: true }).decisionId;
    const { container, unmount } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} hostTabId={tabId} />);

    const roots = findRootsFor(tabId);
    const [target] = findTargetsInScope(appStore.getState(), 'all', null);
    expect(roots).toHaveLength(1);
    expect(roots[0].targetKey).toBe(target.targetKey);
    expect(roots[0].element).toBe(container.querySelector('.vlx-art.vlx-decision'));
    unmount();
    expect(findRootsFor(tabId)).toHaveLength(0);
  });

  it('registers nothing without a host tab', () => {
    const { unmount } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    expect(findRootsFor()).toHaveLength(0);
    unmount();
  });
});

describe('DecisionReadingSurface — the key passages', () => {
  const PRINCIPLE = 'il fornitore che consegna in ritardo la merce deperibile risponde del danno anche quando il ritardo dipende dal vettore';
  const WITH_PASSAGES: DecisionText = {
    motivazione: `Il motivo è fondato.\n\nLa Corte enuncia il seguente principio di diritto: «${PRINCIPLE}».`,
    dispositivo: 'P.Q.M.\n\nLa Corte accoglie il ricorso e condanna la controricorrente al pagamento delle spese.',
  };
  const mount = (testo: DecisionText = WITH_PASSAGES, identity: DecisionIdentity = IDENTITY) =>
    render(<DecisionReadingSurface identity={identity} testo={testo} attributi={{}} />);
  const settings = appStore.getState().settings;
  const realMatchMedia = window.matchMedia;
  /** `useIsDesktop`: the desktop draws a menu, a phone a sheet. */
  const atDesktop = (desktop: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: desktop, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };
  beforeEach(() => atDesktop(true));
  afterEach(() => {
    appStore.setState({ settings });
    window.matchMedia = realMatchMedia;
  });

  it('marks them in the text with their label, the text nodes untouched', () => {
    const { container } = mount();
    const root = container.querySelector('.vlx-decision')!;
    expect(textOf(root)).toBe(decisionProjection(WITH_PASSAGES));
    const kinds = [...root.querySelectorAll<HTMLElement>('.vlx-key-head')].map((e) => e.dataset.keyLabel);
    expect(kinds).toEqual(['Principio di diritto', 'Dispositivo']);
    expect(container.querySelector('.key-passages-hidden')).toBeNull();
  });

  it('lists them under «Passaggi chiave» with the legend, and takes the reader to one', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Passaggi chiave (2), evidenziati automaticamente' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAccessibleDescription('Evidenziati automaticamente: non sono le tue evidenziazioni.');
    const entries = within(menu).getAllByRole('menuitem').map((e) => e.textContent);
    expect(entries[0]).toBe('Principio di diritto — «il fornitore che consegna in ritardo la…»');
    expect(entries[1]).toBe('Dispositivo — «La Corte accoglie il ricorso»');
    expect(entries[2]).toBe('Nascondi i passaggi chiave');
    await act(async () => { fireEvent.click(within(menu).getAllByRole('menuitem')[0]); });
    expect(scroll).toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: 'Principio di diritto, evidenziato automaticamente' })).toBeInTheDocument();
  });

  it('«Fai tua» on a passage makes one highlight of the reader\'s, with its words and offset', async () => {
    const { container } = mount();
    const plain = decisionProjection(WITH_PASSAGES);
    const piece = container.querySelector<HTMLElement>('[data-key-passage="principio"]')!;
    await act(async () => { fireEvent.click(piece); });
    const dialog = await screen.findByRole('dialog', { name: 'Principio di diritto, evidenziato automaticamente' });
    expect(within(dialog).getByText('Evidenziato automaticamente: non è una tua evidenziazione.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fai tua (evidenzia)' }));
    expect(addHighlight).toHaveBeenCalledExactlyOnceWith(KEY, '', PRINCIPLE, '', 'yellow', plain.indexOf(PRINCIPLE));
    expect(screen.queryByRole('dialog', { name: /evidenziato automaticamente/ })).toBeNull();
  });

  it('never stores a passage: nothing is added until the reader makes one theirs', () => {
    mount();
    expect(addHighlight).not.toHaveBeenCalled();
    expect(addAnnotation).not.toHaveBeenCalled();
    expect(appStore.getState().highlights).toEqual([]);
  });

  it('hides them all from the popover or the menu, remembers it, and shows them again', async () => {
    const { container } = mount();
    // the switch is a class on the text's container, as the highlights' is
    const hidden = () => container.querySelector('.key-passages-hidden [data-key-passage]') !== null;
    await act(async () => { fireEvent.click(container.querySelector<HTMLElement>('[data-key-passage="dispositivo"]')!); });
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Dispositivo/ })).getByRole('button', { name: 'Nascondi i passaggi chiave' }));
    expect(appStore.getState().settings.showKeyPassages).toBe(false);
    expect(hidden()).toBe(true);
    // hidden, a click on the words opens nothing
    await act(async () => { fireEvent.click(container.querySelector<HTMLElement>('[data-key-passage="dispositivo"]')!); });
    expect(screen.queryByRole('dialog', { name: /evidenziato automaticamente/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Passaggi chiave \(2\)/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')[0]).toBeDisabled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mostra i passaggi chiave' }));
    expect(appStore.getState().settings.showKeyPassages).toBe(true);
    expect(hidden()).toBe(false);
  });

  it('on a phone lists them in a sheet with the legend, and the switch is there too', async () => {
    atDesktop(false);
    Element.prototype.scrollIntoView = vi.fn();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Passaggi chiave (2), evidenziati automaticamente' }));
    const sheet = screen.getByRole('dialog', { name: 'Passaggi chiave' });
    expect(within(sheet).getByText('Evidenziati automaticamente: non sono le tue evidenziazioni.')).toBeInTheDocument();
    expect(within(sheet).getAllByRole('button').slice(1).map((b) => b.textContent)).toEqual([
      'Principio di diritto — «il fornitore che consegna in ritardo la…»',
      'Dispositivo — «La Corte accoglie il ricorso»',
      'Nascondi i passaggi chiave',
    ]);
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: /^Dispositivo/ }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByRole('dialog', { name: 'Passaggi chiave' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Dispositivo, evidenziato automaticamente' })).toBeInTheDocument();
  });

  it('opens nothing on words the reader has highlighted: they are the reader\'s', async () => {
    const plain = decisionProjection(WITH_PASSAGES);
    appStore.setState({ highlights: [{ id: 'own', normaKey: KEY, articleId: '', text: PRINCIPLE, startOffset: plain.indexOf(PRINCIPLE), color: 'yellow' } as Highlight] });
    const { container } = mount();
    const covered = container.querySelector<HTMLElement>('.highlight-mark [data-key-passage="principio"]')!;
    expect(covered).not.toBeNull();
    await act(async () => { fireEvent.click(covered); });
    expect(screen.queryByRole('dialog', { name: /evidenziato automaticamente/ })).toBeNull();
  });

  it('with the highlights hidden, a passage under one answers again', async () => {
    const plain = decisionProjection(WITH_PASSAGES);
    appStore.setState({ highlights: [{ id: 'own', normaKey: KEY, articleId: '', text: PRINCIPLE, startOffset: plain.indexOf(PRINCIPLE), color: 'yellow' } as Highlight] });
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Gestisci evidenziazioni' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nascondi evidenziazioni' }));
    await waitFor(() => expect(container.querySelector('.highlights-hidden')).not.toBeNull());
    await act(async () => { fireEvent.click(container.querySelector<HTMLElement>('.highlight-mark [data-key-passage="principio"]')!); });
    expect(await screen.findByRole('dialog', { name: 'Principio di diritto, evidenziato automaticamente' })).toBeInTheDocument();
  });

  it('counts none of them among the reader\'s highlights: there is nothing to export', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Gestisci evidenziazioni' }));
    expect(await screen.findByRole('button', { name: 'Nessuna evidenziazione da esportare' })).toBeDisabled();
  });

  it('leaves a link inside a passage to its own click', async () => {
    const testo: DecisionText = { motivazione: 'Il motivo è fondato.', dispositivo: 'P.Q.M.\n\nLa Corte, visto l\'art. 2043 c.c., accoglie il ricorso.' };
    const { container } = mount(testo);
    const link = container.querySelector<HTMLElement>('[data-key-passage] .citation-hover')!;
    expect(link).not.toBeNull();
    await act(async () => { fireEvent.click(link); });
    expect(screen.queryByRole('dialog', { name: /evidenziato automaticamente/ })).toBeNull();
  });

  it('draws no menu and no mark where the rules find nothing, or for a court they were not measured on', () => {
    const { container, unmount } = mount({ motivazione: 'Il motivo è fondato.' });
    expect(screen.queryByRole('button', { name: /Passaggi chiave/ })).toBeNull();
    expect(container.querySelector('[data-key-passage]')).toBeNull();
    unmount();
    const council = mount(WITH_PASSAGES, { corte: 'consiglio_di_stato', numero: 1, anno: 2024, provvedimento: 'sentenza' } as DecisionIdentity);
    expect(council.container.querySelector('[data-key-passage]')).toBeNull();
  });
});
