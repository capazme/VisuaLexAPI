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

  it('changes the box while a file is over it, and reads the file let go on it', async () => {
    render(<DocumentReviewPage />);
    const zone = screen.getByRole('button', { name: /Scegli un documento/ });
    const file = testFile([PARERE], 'trascinato.txt');
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };

    fireEvent.dragEnter(zone, { dataTransfer });
    expect(zone).toHaveTextContent('Lascia qui il documento');
    expect(zone.className).toMatch(/border-solid/);
    fireEvent.dragLeave(zone, { dataTransfer });
    expect(zone).toHaveTextContent('Scegli un documento');
    expect(zone.className).toMatch(/border-dashed/);

    fireEvent.dragOver(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });
    expect(await screen.findByRole('heading', { level: 2, name: 'trascinato.txt' })).toBeInTheDocument();
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
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [], dropEffect: 'none' } });
    await choose(container, PARERE);
    await userEvent.click(screen.getByRole('button', { name: 'Scegli un altro documento' }));
    expect(await screen.findByRole('button', { name: /Scegli un documento/ })).toHaveTextContent('Scegli un documento');
  });

  it('says it is reading while a file takes time', async () => {
    const { container } = render(<DocumentReviewPage />);
    const slow = testFile(['art. 2043 c.c.'], 'lungo.txt');
    let finish: (text: string) => void = () => {};
    Object.assign(slow, { text: () => new Promise<string>(resolve => { finish = resolve; }) });
    await userEvent.upload(input(container), slow);
    const live = container.querySelector('[aria-live]')!;
    // Not at once: a small file is read before the line would show, so neither it nor the announcement comes.
    expect(screen.queryAllByText('Leggo il documento…')).toHaveLength(0);
    // Then both together, the line on screen and its announcement.
    await waitFor(() => expect(live).toHaveTextContent('Leggo il documento…'));
    expect(screen.getByText('Leggo il documento…', { selector: 'p[aria-hidden]' })).toBeInTheDocument();
    await act(async () => finish('art. 2043 c.c.'));
    expect(await screen.findByRole('heading', { level: 2, name: 'lungo.txt' })).toBeInTheDocument();
    // The box closes upwards and is gone with the line under it.
    await waitFor(() => expect(screen.queryAllByText('Leggo il documento…')).toHaveLength(0));
  });

  it('keeps the words of each refusal, under the box', async () => {
    const { container } = render(<DocumentReviewPage />);
    await userEvent.upload(input(container), testFile(['%PDF'], 'atto.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('I PDF scansionati o non testuali richiedono OCR.');
    await userEvent.upload(input(container), testFile(['   '], 'vuoto.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Il documento non contiene testo leggibile.');
    expect(screen.getByRole('button', { name: /Scegli un documento/ })).toBeInTheDocument();
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

  it('wraps a very long file name instead of widening the page, and keeps it whole for the pointer', async () => {
    const name = `${'parere-pro-veritate-sul-recesso-dal-contratto-di-fornitura-'.repeat(6)}definitivo.txt`;
    const { container } = render(<DocumentReviewPage />);
    const heading = await choose(container, PARERE, name);
    expect(heading).toHaveAttribute('title', name);
    expect(heading.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(heading.className).toMatch(/line-clamp-2/);
  });
});
