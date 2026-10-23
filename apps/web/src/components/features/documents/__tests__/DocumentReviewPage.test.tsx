import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { extractCitations } from '../../../../utils/citationMatcher';
import { DocumentReviewPage } from '../DocumentReviewPage';
import { PARERE, testFile } from './fixtures';

const navigateMock = vi.fn();
const triggerSearchMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (select: (state: { triggerSearch: typeof triggerSearchMock }) => unknown) => select({ triggerSearch: triggerSearchMock }),
}));

const input = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="file"]')!;

async function choose(container: HTMLElement, text: string, name = 'parere.txt') {
  await userEvent.upload(input(container), testFile([text], name));
  return screen.findByRole('heading', { level: 2, name });
}

/** A line on screen, not its echo in the live region (which a screen reader hears once). */
const visible = (text: string) => screen.getByText(text, { selector: 'p:not([aria-live])' });

/** The text column's own body: what scrolls, and what the marks sit in. */
const textBody = () => screen.getByTestId('document-text');

beforeEach(() => {
  // Framer Motion puts the window's scroll back after measuring a height of `auto`; jsdom has no scrollTo.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  navigateMock.mockReset();
  triggerSearchMock.mockReset();
});

describe('DocumentReviewPage — before a document', () => {
  it('has a title with its phrase and says, to a screen reader too, that nothing leaves the browser', () => {
    render(<DocumentReviewPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Analizza documento' })).toHaveClass('font-serif');
    expect(screen.getByText('Trova le norme citate in un atto: il file resta nel tuo browser.')).toBeInTheDocument();
    const badge = screen.getByText(/^Resta nel tuo browser/);
    expect(badge).toHaveTextContent('Resta nel tuo browser: il documento non viene inviato al server né salvato.');
  });

  it('opens the file picker from the box, with Enter and Space as with a click', async () => {
    const { container } = render(<DocumentReviewPage />);
    const click = vi.spyOn(input(container), 'click');
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    zone.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(click).toHaveBeenCalledTimes(2);
    expect(zone.className).toMatch(/min-h-48/);
  });

  it('follows a file over the window and over the box from `dragover` alone, and reads the file let go on it (D6)', async () => {
    render(<DocumentReviewPage />);
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    const file = testFile([PARERE], 'trascinato.txt');
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };

    // Over the window: the dashes run in ink, the sheets fan out.
    fireEvent.dragOver(document.body, { dataTransfer });
    expect(zone).toHaveAttribute('data-phase', 'page');
    expect(zone).toHaveTextContent('Lascia qui il documento');
    // Over the box: one line, the sheets open wide.
    fireEvent.dragOver(zone, { dataTransfer });
    expect(zone).toHaveAttribute('data-phase', 'over');
    expect(zone).toHaveTextContent('Rilascia per leggerlo');
    // No event for 400 ms (`DRAG_REST_MS`): the file went away.
    await waitFor(() => expect(zone).toHaveAttribute('data-phase', 'idle'));
    expect(zone).toHaveTextContent('Scegli un documento');
    // A child of the box is the box: no `dragleave` to fool it.
    fireEvent.dragOver(zone.querySelector('span.font-serif')!, { dataTransfer });
    expect(zone).toHaveAttribute('data-phase', 'over');

    fireEvent.drop(zone, { dataTransfer });
    expect(zone).toHaveAttribute('data-phase', 'idle');
    expect(screen.getByText('trascinato.txt', { selector: '[title]' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'trascinato.txt' })).toBeInTheDocument();
  });

  it('throws the ink sheet to the row when a file is let go on the box, not when it is chosen (D6)', async () => {
    const { container } = render(<DocumentReviewPage />);
    const flying = () => document.body.querySelector(':scope > div.fixed[aria-hidden]');
    await userEvent.upload(input(container), testFile([PARERE], 'scelto.txt'));
    expect(flying()).toBeNull();
    await screen.findByRole('heading', { level: 2, name: 'scelto.txt' });
    await userEvent.click(screen.getByRole('button', { name: 'Scegli un altro documento' }));
    const again = await screen.findByRole('button', { name: /Scegli un documento/ });
    fireEvent.drop(again, { dataTransfer: { types: ['Files'], files: [testFile([PARERE], 'lasciato.txt')], dropEffect: 'none' } });
    expect(flying()).not.toBeNull();
  });

  it('a file chosen while another is read wins: the older answer is dropped', async () => {
    const { container } = render(<DocumentReviewPage />);
    const slow = testFile(['art. 2043 c.c.'], 'lento.txt');
    let finish: (text: string) => void = () => {};
    Object.assign(slow, { text: () => new Promise<string>(resolve => { finish = resolve; }) });
    await userEvent.upload(input(container), slow);
    await userEvent.upload(input(container), testFile([PARERE], 'svelto.txt'));
    expect(await screen.findByRole('heading', { level: 2, name: 'svelto.txt' })).toBeInTheDocument();
    await act(async () => finish('art. 2043 c.c.'));
    expect(screen.queryByRole('heading', { level: 2, name: 'lento.txt' })).toBeNull();
  });

  it('reads the first of several files let go, and says the others were not read (D6)', async () => {
    render(<DocumentReviewPage />);
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    const files = [testFile([PARERE], 'primo.txt'), testFile(['x'], 'secondo.txt'), testFile(['y'], 'terzo.txt')];
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files, dropEffect: 'none' } });
    expect(screen.getByText('Letto il primo dei 3 file: uno alla volta')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'primo.txt' })).toBeInTheDocument();
  });

  it('a text or a link dragged over the page changes nothing, and is not taken', () => {
    render(<DocumentReviewPage />);
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    for (const types of [['text/plain'], ['text/uri-list', 'text/plain']]) {
      const over = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'dataTransfer', { value: { types, files: [], dropEffect: 'none' } });
      zone.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(false);
      expect(zone).toHaveAttribute('data-phase', 'idle');
    }
  });

  it('lets go of its window listeners and its timer when the page goes', () => {
    const removed = vi.spyOn(window, 'removeEventListener');
    const cleared = vi.spyOn(window, 'clearTimeout');
    const { unmount } = render(<DocumentReviewPage />);
    fireEvent.dragOver(screen.getByRole('button', { name: /Scegli un documento/ }), { dataTransfer: { types: ['Files'], files: [], dropEffect: 'none' } });
    unmount();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['dragover', 'drop']));
    expect(cleared).toHaveBeenCalled();
    // A file over the window after the page went is no business of it: nothing prevented.
    const later = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(later, 'dataTransfer', { value: { types: ['Files'], files: [], dropEffect: 'none' } });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
    removed.mockRestore();
    cleared.mockRestore();
  });

  it('keeps its dashes still at rest, turning under a mouse or the focus, and stops them in a hidden tab (Bill)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toMatch(/\.vlx-dash \{[^}]*animation-play-state: paused;/);
    expect(css).toMatch(/\.group:hover \.vlx-dash, \.group:focus-visible \.vlx-dash \{ animation-play-state: running; \}/);
    expect(css).toMatch(/\.group\[data-tab-hidden\] \.vlx-dash, \.group\[data-tab-hidden\] \.vlx-dash-run \{ animation-play-state: paused; \}/);
    render(<DocumentReviewPage />);
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    expect(zone).toHaveClass('group');
    expect(zone).not.toHaveAttribute('data-tab-hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(zone).toHaveAttribute('data-tab-hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(zone).not.toHaveAttribute('data-tab-hidden');
  });

  it('keeps the promise in sight in every state: the file stays in the browser', () => {
    render(<DocumentReviewPage />);
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    expect(zone).toHaveTextContent('Il file resta nel tuo browser');
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [], dropEffect: 'none' } });
    expect(zone).toHaveTextContent('Il file resta nel tuo browser');
  });

  it('refuses a file let go outside the box, so the browser does not open it in place of the app', () => {
    render(<DocumentReviewPage />);
    const outside = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(outside, 'dataTransfer', { value: { types: ['Files'], files: [], dropEffect: 'copy' } });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
  });

  it('does not keep the drop wording when the box comes back', async () => {
    const { container } = render(<DocumentReviewPage />);
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [], dropEffect: 'none' } });
    await choose(container, PARERE);
    await userEvent.click(screen.getByRole('button', { name: 'Scegli un altro documento' }));
    expect(await screen.findByRole('button', { name: /Scegli un documento/ })).toHaveTextContent('Scegli un documento');
  });

  it('says each step on the document\'s row, honestly, and announces it (D6)', async () => {
    const { container } = render(<DocumentReviewPage />);
    const slow = testFile(['art. 2043 c.c.'], 'lungo.txt');
    let finish: (text: string) => void = () => {};
    Object.assign(slow, { text: () => new Promise<string>(resolve => { finish = resolve; }) });
    await userEvent.upload(input(container), slow);
    const live = container.querySelector('[aria-live]')!;
    // The row at once: its name, its size, the step, a bar with no percentage.
    expect(screen.getByText('lungo.txt', { selector: '[title]' })).toBeInTheDocument();
    expect(screen.getByText('Leggo il documento…', { selector: 'span' })).toBeInTheDocument();
    expect(live).toHaveTextContent('Documento in lettura');
    expect(container.textContent).not.toMatch(/\d+\s?%/);
    await act(async () => finish('art. 2043 c.c.'));
    await waitFor(() => expect(container.querySelector('[data-stage="done"]')).not.toBeNull());
    expect(live).toHaveTextContent('Pronto');
    expect(await screen.findByRole('heading', { level: 2, name: 'lungo.txt' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByText('Leggo il documento…')).toHaveLength(0));
  });

  it('turns the row red with the reason of a refusal, says it, and lets it go with ✕ (D6)', async () => {
    const { container } = render(<DocumentReviewPage />);
    await userEvent.upload(input(container), testFile(['%PDF'], 'atto.pdf'));
    const row = await waitFor(() => {
      const found = container.querySelector('[data-stage="error"]');
      if (!found) throw new Error('no refusal yet');
      return found as HTMLElement;
    });
    expect(row).toHaveTextContent('I PDF scansionati o non testuali richiedono OCR.');
    expect(row).toHaveClass('vlx-shake');
    expect(container.querySelector('[aria-live]')).toHaveTextContent('I PDF scansionati o non testuali richiedono OCR.');
    await userEvent.upload(input(container), testFile(['   '], 'vuoto.txt'));
    await waitFor(() => expect(container.querySelector('[data-stage="error"]')).toHaveTextContent('Il documento non contiene testo leggibile.'));
    await userEvent.click(screen.getByRole('button', { name: 'Chiudi l’avviso' }));
    await waitFor(() => expect(container.querySelector('[data-stage]')).toBeNull());
    expect(screen.getByRole('button', { name: /Scegli un documento/ })).toHaveFocus();
  });

  it('on a phone says to tap, with no word of dragging', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('hover: none'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      render(<DocumentReviewPage />);
      const zone = screen.getByRole('button', { name: /Tocca per scegliere un documento/ });
      expect(zone).not.toHaveTextContent('trascinalo');
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('DocumentReviewPage — the result', () => {
  it('counts the citations and groups them by act', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    expect(visible('6 citazioni in 2 atti')).toBeInTheDocument();
    const list = screen.getByRole('complementary', { name: 'Citazioni' });
    expect(within(list).getByRole('heading', { level: 3, name: /^Codice civile\s+4 citazioni$/ })).toBeInTheDocument();
    expect(within(list).getByRole('heading', { level: 3, name: /^l\. 241\/1990\s+2 citazioni$/ })).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: /^Apri / })).toHaveLength(6);
  });

  it('draws the document as it is: every character, once, in order', async () => {
    const text = `${PARERE}\n\n\tUn rientro,   spazi doppi e «virgolette».\nart. 5 del regolamento (UE) 2016/679`;
    const { container } = render(<DocumentReviewPage />);
    await choose(container, text);
    expect(textBody().textContent).toBe(text);
    expect(textBody().querySelectorAll('mark')).toHaveLength(extractCitations(text).length);
    expect(textBody().className).toMatch(/font-serif/);
    expect(textBody().className).toMatch(/whitespace-pre-wrap/);
  });

  it('selects in the list what is touched in the text, and in the text what is touched in the list', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    const marks = textBody().querySelectorAll<HTMLElement>('mark');
    const list = screen.getByRole('complementary', { name: 'Citazioni' });

    await userEvent.click(marks[2]);
    const row = within(list).getByText('art. 2043').closest('button')!;
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(marks[2]).toHaveAttribute('data-selected', 'true');

    await userEvent.click(within(list).getByText('art. 1455').closest('button')!);
    expect(marks[1]).toHaveAttribute('data-selected', 'true');
    expect(marks[2]).not.toHaveAttribute('data-selected');
    expect(row).not.toHaveAttribute('aria-current');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('opens a citation as it always has: the reader, then the search', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    await userEvent.click(screen.getByRole('button', { name: 'Apri art. 3 l. 241/1990' }));
    expect(navigateMock).toHaveBeenCalledWith('/');
    expect(triggerSearchMock).toHaveBeenCalledWith({
      act_type: 'legge', act_number: '241', date: '1990', article: '3', version: 'vigente', version_date: '',
    });
  });

  it('says so when it finds nothing, with what it recognises', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, 'Una lettera senza riferimenti a norme.');
    expect(visible('Nessuna citazione')).toBeInTheDocument();
    expect(screen.getByText('Non ho trovato citazioni di norme in questo documento.')).toBeInTheDocument();
    expect(screen.getByText(/Riconosco, per esempio,/)).toHaveTextContent('«art. 2043 c.c.»');
  });

  it('puts the focus on the result once it has come', async () => {
    const { container } = render(<DocumentReviewPage />);
    const heading = await choose(container, PARERE);
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('goes back to the box with «Scegli un altro documento», a 44 px button at every width', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    const again = screen.getByRole('button', { name: 'Scegli un altro documento' });
    expect(again.className).toMatch(/(^| )min-h-11( |$)/);
    expect(again.className).toMatch(/md:min-h-11/);
    expect(again.className).not.toMatch(/md:min-h-9/);
    await userEvent.click(again);
    const zone = await screen.findByRole('button', { name: /Scegli un documento/ });
    await waitFor(() => expect(zone).toHaveFocus());
    await waitFor(() => expect(screen.queryByText('6 citazioni in 2 atti', { selector: 'p:not([aria-live])' })).not.toBeInTheDocument());
  });
});

describe('DocumentReviewPage — motion', () => {
  const originalMatchMedia = window.matchMedia;
  const scrollTo = vi.fn();
  const animate = vi.fn();

  const reduceMotion = (reduce: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  };

  beforeEach(() => {
    scrollTo.mockReset();
    animate.mockReset();
    // jsdom has neither: without them the calls under `?.` would pass whatever they were given.
    HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate'];
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  });

  it('under reduced motion throws no sheet when a file is let go (D6)', async () => {
    reduceMotion(true);
    render(<DocumentReviewPage />);
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [testFile([PARERE], 'fermo.txt')], dropEffect: 'none' } });
    expect(document.body.querySelector(':scope > div.fixed[aria-hidden]')).toBeNull();
    expect(await screen.findByRole('heading', { level: 2, name: 'fermo.txt' })).toBeInTheDocument();
  });

  it('scrolls the text column (not the window) to the citation chosen in the list, and pulses it once', async () => {
    reduceMotion(false);
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    vi.mocked(window.scrollTo).mockClear();
    const list = screen.getByRole('complementary', { name: 'Citazioni' });
    await userEvent.click(within(list).getByText('art. 2043').closest('button')!);

    const textColumn = textBody().parentElement!;
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.contexts[0]).toBe(textColumn);
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' });
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(textBody().querySelectorAll('mark')[2]);
    // The ring's colour is the theme's token, set on the text, never a colour written in the code.
    expect(textBody().className).toMatch(/\[--doc-pulse:var\(--color-toga-500\)\]/);
    expect(textBody().className).toMatch(/dark:\[--doc-pulse:var\(--color-toga-400\)\]/);
    expect(JSON.stringify(animate.mock.calls[0][0])).not.toMatch(/rgb\(/);
    expect(JSON.stringify(animate.mock.calls[0][0])).toMatch(/color-mix\(in oklch/);
  });

  it('scrolls the list to the row of a citation touched in the text, without a pulse', async () => {
    reduceMotion(false);
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    await userEvent.click(textBody().querySelectorAll('mark')[4]);
    const listColumn = screen.getByRole('complementary', { name: 'Citazioni' }).querySelector('[data-cite-row]')!.closest('.overflow-y-auto');
    expect(scrollTo.mock.contexts[0]).toBe(listColumn);
    expect(animate).not.toHaveBeenCalled();
  });

  it('under reduced motion, jumps to the citation and does not pulse it', async () => {
    reduceMotion(true);
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    const list = screen.getByRole('complementary', { name: 'Citazioni' });
    await userEvent.click(within(list).getByText('art. 1455').closest('button')!);
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: 'auto' });
    expect(animate).not.toHaveBeenCalled();
  });

  it('lets the text column be scrolled from the keyboard', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    expect(textBody().parentElement).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('group', { name: 'Testo del documento' })).toBe(textBody().parentElement);
  });
});

describe('DocumentReviewPage — the worst cases', () => {
  it('lists 400 citations, the first 8 entering one after the other and none of the rest', async () => {
    const many = Array.from({ length: 400 }, (_, i) => `Punto ${i + 1}: art. ${i + 1} c.c.`).join('\n');
    const { container } = render(<DocumentReviewPage />);
    await choose(container, many, 'lungo.txt');
    expect(visible('400 citazioni in 1 atto')).toBeInTheDocument();
    const rows = container.querySelectorAll<HTMLElement>('[data-cite-row]');
    expect(rows).toHaveLength(400);
    const cascading = Array.from(rows).filter(row => row.className.includes('motion-safe:animate-in'));
    expect(cascading).toHaveLength(8);
    expect(cascading.map(row => row.style.animationDelay)).toEqual(['0ms', '40ms', '80ms', '120ms', '160ms', '200ms', '240ms', '280ms']);
  });

  it('keeps a document of 300 pages inside its column, which scrolls on its own', async () => {
    const page = 'Il presente atto richiama l’art. 1218 c.c. e prosegue con un testo di riempimento. '.repeat(30);
    const long = Array.from({ length: 300 }, (_, i) => `Pagina ${i + 1}\n${page}`).join('\n\n');
    const { container } = render(<DocumentReviewPage />);
    await choose(container, long, 'trecento-pagine.txt');
    expect(textBody().textContent).toBe(long);
    expect(textBody().parentElement?.className).toMatch(/overflow-y-auto/);
    expect(textBody().className).toMatch(/\[overflow-wrap:anywhere\]/);
  });

  it('sizes both columns to the window less the page\'s foot, which grows under the feedback button (G8c)', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, PARERE);
    const text = screen.getByRole('region', { name: 'Testo del documento' });
    const list = screen.getByRole('complementary', { name: 'Citazioni' });
    for (const column of [text, list]) expect(column).toHaveClass('lg:h-[calc(100dvh-15rem-var(--page-foot,2rem))]');
  });

  it('wraps a very long file name instead of widening the page, and keeps it whole for the pointer', async () => {
    const name = `${'parere-pro-veritate-sul-recesso-dal-contratto-di-fornitura-'.repeat(6)}definitivo.txt`;
    const { container } = render(<DocumentReviewPage />);
    const heading = await choose(container, PARERE, name);
    expect(heading).toHaveAttribute('title', name);
    expect(heading.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(heading.className).toMatch(/line-clamp-2/);
  });
});
