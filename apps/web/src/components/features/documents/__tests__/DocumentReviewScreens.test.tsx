import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentReviewPage } from '../DocumentReviewPage';
import { normKey, type LinkNorm } from '../documentLinks';
import { registerUndoToastListener, type UndoToast } from '../../../../hooks/useUndoableAction';
import { notificationStore, resetNotifications } from '../../../ui/notifications/notifications';
import { DOCX_XML, storedDocx, testFile } from './fixtures';

// «Analizza documento», the screens of PR 3 of spec #376 (completion by hand, «Non sono norme», the switch) and of L5
// of spec #391 (the paste, «Prepara i link», the copy and the download). The server is the recorded corpus's.

const navigateMock = vi.fn();
const triggerSearchMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
const NO_ALIASES: never[] = [];
vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (select: (state: { triggerSearch: typeof triggerSearchMock; customAliases: never[] }) => unknown) =>
    select({ triggerSearch: triggerSearchMock, customAliases: NO_ALIASES }),
}));
const server = vi.hoisted(() => ({ fetchActNames: vi.fn(), readOnServer: vi.fn() }));
vi.mock('../documentServer', () => server);
const linkServer = vi.hoisted(() => ({ fetchNormLinks: vi.fn() }));
vi.mock('../documentLinkServer', () => linkServer);

const RECORDED = JSON.parse(readFileSync(resolve(__dirname, 'corpus/server.json'), 'utf8')) as {
  act_names: string[];
  answers: Record<string, unknown>;
};
const answerAsRecorded = async (queries: string[]) => ({
  answers: new Map(queries.map((q) => [q, RECORDED.answers[q] ?? { recognized: false, parsed: null }])),
  unanswered: [],
});
const hrefOf = (norm: LinkNorm) => `https://www.normattiva.it/uri-res/N2Ls?urn:nir:prova:${encodeURIComponent(norm.act_type)}~art${norm.article}`;
const linkAll = async (norms: LinkNorm[]) => ({
  answers: new Map(norms.map((norm) => [normKey(norm), { href: hrefOf(norm), reason: 'ok' as const }])),
  unanswered: [],
});

const BRIEF = [
  'Memoria del convenuto, Mario Bianchi.',
  'Il datore risponde ai sensi dell’art. 82 GDPR e degli artt. 13 e 14 GDPR.',
  'Visto il d.lgs. 81/2008, l’art. 18 impone obblighi di sicurezza.',
  'L’art. 7 del contratto prevede una penale; restano gli artt. 167 e ss. del Codice privacy.',
  'Quanto all’art. 2043 il danno va provato, come per l’art. 2043 già detto.',
].join('\n');

const input = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="file"]')!;
async function choose(container: HTMLElement, text: string | Uint8Array, name = 'memoria.txt') {
  await userEvent.upload(input(container), testFile([text], name));
  return screen.findByRole('heading', { level: 2, name });
}
const visible = (text: string) => screen.getByText(text, { selector: 'p:not([aria-live])' });
const list = () => screen.getByRole('complementary', { name: 'Citazioni' });

/** A blob's text: jsdom's `Blob` has no `text()`. */
const readBlob = (blob: Blob) => new Promise<string>((done) => {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result));
  reader.readAsText(blob);
});

let undo: UndoToast | null = null;
let stopListening = () => {};

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  navigateMock.mockReset();
  triggerSearchMock.mockReset();
  server.fetchActNames.mockReset().mockResolvedValue(RECORDED.act_names);
  server.readOnServer.mockReset().mockImplementation(answerAsRecorded);
  linkServer.fetchNormLinks.mockReset().mockImplementation(linkAll);
  resetNotifications();
  undo = null;
  stopListening = registerUndoToastListener((toast) => { undo = toast; });
});
afterEach(() => stopListening());

describe('«Da completare» and the picker (#376 §5)', () => {
  it('lists the rows to complete first, with what follows them, and «Completa»', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, BRIEF);
    const group = within(list()).getByRole('heading', { level: 3, name: /^Da completare\s+3 da completare$/ });
    const rows = within(group.nextElementSibling as HTMLElement).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('span')!.textContent)).toEqual(['art. 7', 'art. 2043', 'art. 2043']);
    expect(rows[0]).toHaveTextContent('seguito da «del contratto»');
    expect(within(rows[0]).getByRole('button', { name: 'Completa art. 7' })).toBeInTheDocument();
    // The count's badge is the one colour the page adds.
    expect(group.querySelector('.bg-amber-50')).not.toBeNull();
    expect(visible('5 citazioni in 3 atti · 3 da completare')).toBeInTheDocument();
  });

  it('opens the picker with the sentence, the field focused, the document\'s acts first (the nearest above leading)', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, BRIEF);
    await userEvent.click(screen.getByRole('button', { name: 'Completa art. 7' }));
    const dialog = await screen.findByRole('dialog', { name: /Completa «art\. 7»/ });
    expect(within(dialog).getByText('art. 7', { selector: 'strong' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('del contratto prevede una penale');
    const field = within(dialog).getByRole('combobox', { name: 'Atto' });
    await waitFor(() => expect(field).toHaveFocus());
    const document = within(dialog).getByRole('group', { name: 'Atti citati in questo documento' });
    expect(within(document).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'd.lgs. n. 81 del 2008', 'reg. (UE) 2016/679', 'd.lgs. 30 giugno 2003, n. 196',
    ]);
    // Esc closes, the focus back on the row's button.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Completa art. 7' })).toHaveFocus());
  });

  it('reads the act typed as the search does, picks it with Enter, applies to the identical ones by default, and undoes', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, BRIEF);
    const pending = within(list()).getAllByRole('button', { name: 'Completa art. 2043' });
    await userEvent.click(pending[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('combobox'), 'c.c.');
    expect(within(dialog).getByText('Codice civile', { selector: 'span' })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    // Where it goes: the identical «art. 2043» is the default.
    const identical = within(dialog).getByRole('radio', { name: 'Anche all’altra «art. 2043» da completare' });
    expect(identical).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'A tutte le 3 da completare' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Applica' })).toHaveFocus();
    // A second Enter applies.
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(visible('7 citazioni in 4 atti · 1 da completare')).toBeInTheDocument();
    const civil = within(list()).getByRole('heading', { level: 3, name: /^Codice civile\s+2 citazioni$/ });
    const civilRows = within(civil.nextElementSibling as HTMLElement).getAllByRole('listitem');
    expect(civilRows[0]).toHaveTextContent('scelto da te');
    expect(civilRows[0]).not.toHaveTextContent('applicato a più citazioni');
    expect(civilRows[1]).toHaveTextContent('scelto da te (applicato a più citazioni)');
    // The notice, with «Annulla» for 8 seconds.
    expect(undo?.message).toBe('Atto applicato a 2 citazioni');
    expect(notificationStore.getState().entries.at(-1)?.duration).toBe(8000);
    await act(async () => { await undo!.onUndo(); });
    expect(visible('5 citazioni in 3 atti · 3 da completare')).toBeInTheDocument();
  });

  it('asks the server for the act alone, 250 ms after typing stops, never the article', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, BRIEF);
    server.readOnServer.mockClear().mockImplementation(async (queries: string[]) => ({
      answers: new Map(queries.map((q) => [q, { recognized: true, parsed: { act_type: 'decreto del presidente della repubblica', act_number: '380', date: '2001-06-06' } }])),
      unanswered: [],
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Completa art. 7' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('combobox'), 'testo unico edilizia');
    await waitFor(() => expect(within(dialog).getByText(/6 giugno 2001, n\. 380/, { selector: 'span' })).toBeInTheDocument());
    expect(server.readOnServer).toHaveBeenCalledTimes(1);
    expect(server.readOnServer.mock.calls[0][0]).toEqual(['testo unico edilizia']);
  });

  it('«Non è una norma» moves a row to «Non sono norme», collapsed, and «Ripristina» brings it back', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, BRIEF);
    await userEvent.click(screen.getByRole('button', { name: 'Altre azioni per art. 7' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Non è una norma' }));
    expect(visible('5 citazioni in 3 atti · 2 da completare')).toBeInTheDocument();
    const toggle = within(list()).getByRole('button', { name: /Non sono norme/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Its mark is gone from the text.
    expect(screen.getByTestId('document-text').querySelectorAll('[data-kind="incomplete"]')).toHaveLength(2);
    // A reload would lose the choice: the browser asks.
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await userEvent.click(toggle);
    await userEvent.click(within(list()).getByRole('button', { name: 'Ripristina art. 7' }));
    expect(visible('5 citazioni in 3 atti · 3 da completare')).toBeInTheDocument();
  });

  it('changes the act of an inherited row, which then is the user\'s, and sends it back to complete', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, BRIEF);
    await userEvent.click(screen.getByRole('button', { name: 'Altre azioni per art. 18 d.lgs. 81/2008' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cambia atto' }));
    const dialog = await screen.findByRole('dialog', { name: /Cambia atto di «art\. 18»/ });
    await userEvent.type(within(dialog).getByRole('combobox'), 'c.c.{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const row = within(list()).getByRole('button', { name: 'Apri art. 18 c.c.' }).closest('li')!;
    expect(row).toHaveTextContent('scelto da te');
    await userEvent.click(within(row).getByRole('button', { name: /Altre azioni/ }));
    // The page had read it: back to the act of its context, «dal contesto» again.
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rimetti l’atto di prima' }));
    expect(visible('5 citazioni in 3 atti · 3 da completare')).toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: 'Apri art. 18 d.lgs. 81/2008' }).closest('li')).toHaveTextContent('dal contesto: d.lgs. n. 81 del 2008');
  });

  it('«Torna da completare» sends a row completed by hand back to the group', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, BRIEF);
    await userEvent.click(screen.getByRole('button', { name: 'Completa art. 7' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('combobox'), 'c.c.{Enter}');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Solo a questa citazione' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Applica' }));
    expect(visible('6 citazioni in 4 atti · 2 da completare')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Altre azioni per art. 7 c.c.' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Torna da completare' }));
    expect(visible('5 citazioni in 3 atti · 3 da completare')).toBeInTheDocument();
  });
});

describe('«Riconosci solo nel browser» (#376 §6.3)', () => {
  it('sends nothing, says so, and turns the links off until the user asks VisuaLex for this document', async () => {
    const { container } = render(<DocumentReviewPage />);
    const toggle = screen.getByRole('switch', { name: 'Riconosci solo nel browser' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/^Tutto nel tuo browser/, { selector: 'p' })).toBeInTheDocument();
    await choose(container, BRIEF);
    expect(server.readOnServer).not.toHaveBeenCalled();
    expect(screen.getByText('Trova le norme citate in un atto. Il riconoscimento è più limitato: VisuaLex non riceve nulla.')).toBeInTheDocument();
    expect(screen.queryByText(/VisuaLex non risponde/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prepara i link' })).toBeNull();
    expect(screen.getByText(/Per inserire i link VisuaLex deve ricevere le norme citate \(non il testo\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riconosci con VisuaLex questo documento' }));
    await waitFor(() => expect(server.readOnServer).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Prepara i link' })).toBeInTheDocument();
  });
});

describe('«Riconosci solo nel browser», kept', () => {
  it('stays on for the next document after «Riconosci con VisuaLex questo documento», and the picker asks nothing', async () => {
    const { container } = render(<DocumentReviewPage />);
    await userEvent.click(screen.getByRole('switch', { name: 'Riconosci solo nel browser' }));
    await choose(container, BRIEF);
    await userEvent.click(screen.getByRole('button', { name: 'Completa art. 7' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('combobox'), 'testo unico edilizia');
    await act(async () => { await new Promise((done) => setTimeout(done, 400)); });
    expect(server.readOnServer).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('leggo solo nel browser');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Riconosci con VisuaLex questo documento' }));
    await waitFor(() => expect(server.readOnServer).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Scegli un altro documento' }));
    expect(await screen.findByRole('switch', { name: 'Riconosci solo nel browser' })).toHaveAttribute('aria-checked', 'true');
    await choose(container, BRIEF, 'altro.txt');
    expect(server.readOnServer).toHaveBeenCalledTimes(1);
  });

  it('cannot be changed while a document is read', async () => {
    const { container } = render(<DocumentReviewPage />);
    const slow = testFile(['art. 2043 c.c.'], 'lento.txt');
    let finish: (text: string) => void = () => {};
    Object.assign(slow, { text: () => new Promise<string>((done) => { finish = done; }) });
    await userEvent.upload(input(container), slow);
    expect(screen.getByRole('switch', { name: 'Riconosci solo nel browser' })).toBeDisabled();
    await act(async () => finish('art. 2043 c.c.'));
    await screen.findByRole('heading', { level: 2, name: 'lento.txt' });
  });
});

describe('the paste box (#391 §5.1)', () => {
  it('reads a pasted text as a file, titled «Testo incollato»', async () => {
    render(<DocumentReviewPage />);
    const box = screen.getByRole('textbox', { name: 'Oppure incolla il testo' });
    expect(box).toHaveAttribute('maxLength', '2000000');
    expect(screen.getByRole('button', { name: 'Analizza il testo' })).toBeDisabled();
    await userEvent.click(box);
    await userEvent.paste('Si richiama l’art. 2043 c.c.');
    await userEvent.click(screen.getByRole('button', { name: 'Analizza il testo' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Testo incollato' })).toBeInTheDocument();
    expect(visible('1 citazione in 1 atto')).toBeInTheDocument();
    // A pasted text has no Word file to copy.
    await userEvent.click(screen.getByRole('button', { name: 'Prepara i link' }));
    expect(await screen.findByRole('button', { name: 'Copia con i link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scarica una copia con i link' })).toBeNull();
  });
});

describe('the links (#391 §4.2, §5.2, §6.7)', () => {
  it('asks only on «Prepara i link», the norms alone; an inherited row waits for «Conferma»', async () => {
    const { container } = render(<DocumentReviewPage />);
    await choose(container, BRIEF);
    expect(linkServer.fetchNormLinks).not.toHaveBeenCalled();
    expect(screen.getByText(/Per i link, a VisuaLex arriva l’elenco delle norme citate \(per esempio «art\. 2043 c\.c\.»\), non il testo del documento\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Prepara i link' }));
    await screen.findByText('4 citazioni avranno il link');
    const sent = linkServer.fetchNormLinks.mock.calls[0][0] as LinkNorm[];
    expect(JSON.stringify(sent)).not.toMatch(/Bianchi|datore|contratto|penale/);
    // art. 18 is inherited: not asked until confirmed.
    expect(sent.map((n) => n.article)).toEqual(['82', '13', '14', '167']);
    expect(screen.getByText('1 citazione non avrà il link finché non la confermi')).toBeInTheDocument();
    const inherited = within(list()).getByRole('button', { name: 'Apri art. 18 d.lgs. 81/2008' }).closest('li')!;
    expect(inherited).toHaveTextContent('Senza link: da confermare');
    await userEvent.click(within(inherited).getByRole('button', { name: 'Conferma il link di art. 18 d.lgs. 81/2008' }));
    expect(screen.queryByText(/finché non la confermi/)).toBeNull();
    // Its address was not asked yet: asked now, alone.
    await userEvent.click(screen.getByRole('button', { name: 'Prepara i link mancanti' }));
    await screen.findByText('5 citazioni avranno il link');
    expect((linkServer.fetchNormLinks.mock.calls[1][0] as LinkNorm[]).map((n) => n.article)).toEqual(['18']);
  });

  it('leaves out of the copy a row completed in bulk until confirmed, and a row left «Senza link»', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const items: Array<Record<string, Promise<Blob>>> = [];
    vi.stubGlobal('ClipboardItem', class { constructor(item: Record<string, Promise<Blob>>) { items.push(item); } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText: vi.fn() } });
    try {
      const { container } = render(<DocumentReviewPage />);
      await choose(container, 'L’art. 5 e poi l’art. 5 ancora.\nSi richiama l’art. 2043 c.c.');
      await userEvent.click(within(list()).getAllByRole('button', { name: 'Completa art. 5' })[0]);
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByRole('combobox'), 'c.c.{Enter}');
      await userEvent.keyboard('{Enter}');
      await userEvent.click(screen.getByRole('button', { name: 'Prepara i link' }));
      await screen.findByText('2 citazioni avranno il link');
      await userEvent.click(screen.getByRole('button', { name: 'Altre azioni per art. 2043 c.c.' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Senza link' }));
      await screen.findByText('1 citazione avrà il link');
      await userEvent.click(screen.getByRole('button', { name: 'Copia con i link' }));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const html = await readBlob(await items[0]['text/html']);
      // The first «art. 5» was chosen for itself; the second, in bulk, waits; art. 2043 was left out.
      expect(html.match(/<a /g)).toHaveLength(1);
      expect(html).toMatch(/^<p>L’<a href="[^"]+">art\. 5<\/a> e poi l’art\. 5 ancora\.<\/p><p>Si richiama l’art\. 2043 c\.c\.<\/p>$/);
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copies the text with its links as HTML and plain text, in one write', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const items: Array<Record<string, Promise<Blob>>> = [];
    vi.stubGlobal('ClipboardItem', class { constructor(item: Record<string, Promise<Blob>>) { items.push(item); } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText: vi.fn() } });
    try {
      const { container } = render(<DocumentReviewPage />);
      await choose(container, 'Si richiama l’art. 2043 c.c.\nE la l. 241/1990 art. 3.');
      await userEvent.click(screen.getByRole('button', { name: 'Prepara i link' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Copia con i link' }));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const html = await readBlob(await items[0]['text/html']);
      expect(html).toBe('<p>Si richiama l’<a href="https://www.normattiva.it/uri-res/N2Ls?urn:nir:prova:codice%20civile~art2043">art. 2043 c.c.</a></p><p>E la <a href="https://www.normattiva.it/uri-res/N2Ls?urn:nir:prova:legge~art3">l. 241/1990 art. 3</a>.</p>');
      await waitFor(() => expect(notificationStore.getState().entries.some((e) => e.message === 'Testo con 2 link copiato')).toBe(true));
      expect(screen.getByText(/In Word incolla con «Unisci formattazione»/)).toHaveTextContent('esporta il PDF da Word');
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('downloads a copy of the Word file with the links, the original untouched, and reports it', async () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return 'blob:copia'; });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const { container } = render(<DocumentReviewPage />);
      const original = storedDocx(DOCX_XML);
      const before = original.slice();
      await choose(container, original, 'memoria.docx');
      await userEvent.click(screen.getByRole('button', { name: 'Prepara i link' }));
      expect(await screen.findByText('Il file originale non viene modificato.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Scarica una copia con i link' }));
      const report = await screen.findByText(/Copia scaricata: 2 link inseriti/);
      expect(report.closest('[role="status"]')).toHaveTextContent('in «memoria (con link).docx»');
      expect(report.closest('[role="status"]')).toHaveTextContent('esporta il PDF da Word');
      expect(click).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      expect(original).toEqual(before);
    } finally {
      click.mockRestore();
    }
  });
});
