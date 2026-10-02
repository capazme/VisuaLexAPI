import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, ArticleValidity, Highlight, NormaVisitata, SearchParams } from '../../../../types';

const { listPassages, listDiscussions, checkNorma, slotCalls } = vi.hoisted(() => ({
  listPassages: vi.fn(),
  listDiscussions: vi.fn(),
  checkNorma: vi.fn(),
  slotCalls: [] as Array<{ slot: string; props: Record<string, unknown> }>,
}));

vi.mock('../../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: listDiscussions,
    listPassages,
    create: vi.fn(),
    comment: vi.fn(),
    report: vi.fn(),
    voteThread: vi.fn(),
    voteComment: vi.fn(),
  },
}));
vi.mock('../../../../services/authService', () => ({ isAuthenticated: () => true }));
vi.mock('../../../../services/notificationService', () => ({ notificationService: { checkNorma } }));
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true }),
}));
vi.mock('../../../../plugins/PluginSlot', () => ({
  PluginSlot: ({ slot, props }: { slot: string; props: Record<string, unknown> }) => {
    slotCalls.push({ slot, props });
    return null;
  },
}));
vi.mock('../BrocardiDisplay', () => ({ BrocardiDisplay: () => <div data-testid="brocardi" /> }));

import { ArticleTabContent } from '../ArticleTabContent';
import { appStore } from '../../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../../utils/normaKeys';
import { fixtureText } from '../../../../utils/__fixtures__/articleTexts';

const TEXT = fixtureText('nrm-cc-1284');
const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284', allegato: '2',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1284',
};
const BROCARDI = { position: null, link: null, Brocardi: ['Nemo iudex'], Ratio: null, Spiegazione: null, Massime: null };

const CURRENT: ArticleValidity = {
  state: 'current', valid_from: '2025-12-28', valid_to: null, version_number: 8, act_updated: '2026-08-11', request_in_window: null,
};
const MIDDLE: ArticleValidity = {
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: '2026-08-11', request_in_window: true,
};
const NOT_YET: ArticleValidity = {
  state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true,
};
const PAST = { versione: 'vigente', data_versione: '2005-06-01' };

function article(validity?: ArticleValidity, norma: Partial<NormaVisitata> = {}, over: Partial<ArticleData> = {}): ArticleData {
  return { article_text: TEXT, norma_data: { ...NORMA, ...norma }, brocardi_info: BROCARDI, validity, ...over };
}

function show(data: ArticleData) {
  return render(
    <MemoryRouter>
      <ArticleTabContent data={data} />
    </MemoryRouter>,
  );
}

const highlight: Highlight = {
  id: 'h1',
  normaKey: buildItemKey(NORMA),
  articleId: uniqueArticleIdFromNorma(NORMA),
  rangeSerialized: '',
  text: 'saggio degli interessi legali',
  color: 'yellow',
  startOffset: TEXT.replace(/\n/g, '').indexOf('saggio degli interessi legali'),
};

let triggerSearch: Mock<(params: SearchParams) => void>;
let writeText: Mock<(text: string) => Promise<void>>;

beforeEach(() => {
  vi.clearAllMocks();
  slotCalls.length = 0;
  listDiscussions.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } });
  listPassages.mockResolvedValue([]);
  checkNorma.mockResolvedValue({ changed: false });
  triggerSearch = vi.fn<(params: SearchParams) => void>();
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  appStore.setState({
    loadAnnotationsForArticle: vi.fn(),
    loadHighlightsForArticle: vi.fn(),
    triggerSearch,
    highlights: [highlight],
    annotations: [],
    bookmarks: [],
  });
});

describe('ArticleTabContent — the text in force', () => {
  it('states since when the source says it has been in force, and keeps every tool', () => {
    show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    expect(screen.getByRole('button', { name: 'In vigore dal 28-12-2025' })).toBeInTheDocument();
    expect(screen.queryByText('Testo storico')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Apri note')[0]).toBeEnabled();
    expect(screen.getByTestId('brocardi')).toBeInTheDocument();
    expect(screen.getByText('Chiedi su questo articolo')).toBeInTheDocument();
  });

  it('shows the reader’s highlight on the words it was made on (the control for the past text)', () => {
    const { container } = show(article(CURRENT, { versione: 'vigente' }));
    expect(container.querySelector('mark')).not.toBeNull();
  });

  it('claims nothing when the source stated nothing', () => {
    show(article(undefined, { versione: 'vigente' }));
    expect(screen.queryByText(/In vigore dal|Testo storico|Vigente/)).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Apri note')[0]).toBeEnabled();
  });

  it('hands the plug-in slot the window and whether the text is a past one', () => {
    show(article(CURRENT, { versione: 'vigente' }));
    const call = slotCalls.find((c) => c.slot === 'article_content_after');
    expect(call?.props).toMatchObject({ articleUrn: NORMA.urn, validity: CURRENT, isHistorical: false });
  });
});

describe('ArticleTabContent — a past text is a reading', () => {
  it('says which window came back and what it does not say', () => {
    show(article(MIDDLE, PAST));
    expect(screen.getByRole('button', { name: 'Testo storico · dal 25-12-2003 al 29-12-2007' })).toBeInTheDocument();
    expect(screen.getByText('Testo storico')).toBeInTheDocument();
    expect(screen.getByText(/non dice quale disciplina si applichi al fatto/)).toBeInTheDocument();
  });

  it('shows the text itself, with the update notes open', () => {
    const { container } = show(article(MIDDLE, PAST));
    const root = container.querySelector('.vlx-art');
    expect(root?.textContent).toContain('Il saggio degli interessi legali');
    expect(root).toHaveClass('vlx-updates-open');
  });

  it('draws none of the reader’s marks on it: they would sit on the wrong words', () => {
    const { container } = show(article(MIDDLE, PAST));
    expect(container.querySelector('mark')).toBeNull();
    expect(container.querySelector('.vlx-sign')).toBeNull();
  });

  it('switches off the tools keyed by article, with the reason in the tooltip', () => {
    show(article(MIDDLE, PAST));
    for (const name of ['Apri note', 'Gestisci evidenziazioni', 'Discussioni sull’articolo', 'Aggiungi a norme rapide']) {
      screen.getAllByTitle(`${name} — Non disponibile su un testo storico`).forEach((b) => expect(b).toBeDisabled());
    }
  });

  it('keeps Brocardi out, even when an older answer carried it', () => {
    show(article(MIDDLE, PAST));
    expect(screen.queryByTestId('brocardi')).not.toBeInTheDocument();
  });

  it('does not ask the discussions of the passages of a text it will not mark', () => {
    show(article(MIDDLE, PAST));
    expect(listPassages).not.toHaveBeenCalled();
  });

  it('does not offer the question to the assistant, which would answer about the current text', () => {
    show(article(MIDDLE, PAST));
    expect(screen.queryByText('Chiedi su questo articolo')).not.toBeInTheDocument();
  });

  it('tells the plug-in slot it is a past text', () => {
    show(article(MIDDLE, PAST));
    const call = slotCalls.find((c) => c.slot === 'article_content_after');
    expect(call?.props).toMatchObject({ validity: MIDDLE, isHistorical: true });
  });

  it('keeps even a text that was asked for by a date read-only when the source says it is not current', () => {
    show(article(MIDDLE, { versione: 'vigente', data_versione: '' }));
    expect(screen.getAllByTitle('Apri note — Non disponibile su un testo storico')[0]).toBeDisabled();
  });

  it('is read-only too when the source could not be read but a date was asked for', () => {
    show(article(undefined, PAST));
    expect(screen.queryByTestId('brocardi')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Apri note — Non disponibile su un testo storico')[0]).toBeDisabled();
  });

  it('does not register a past text of a saved norm as the saved text', async () => {
    const bookmarked = { id: 'b1', normaKey: buildItemKey(NORMA), normaData: NORMA, addedAt: '2026-01-01', tags: [] };
    appStore.setState({ bookmarks: [bookmarked] });
    show(article(MIDDLE, { versione: 'vigente', data_versione: '' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(checkNorma).not.toHaveBeenCalled();
  });

  it('still watches the text in force of a saved norm (the control)', async () => {
    const bookmarked = { id: 'b1', normaKey: buildItemKey(NORMA), normaData: NORMA, addedAt: '2026-01-01', tags: [] };
    appStore.setState({ bookmarks: [bookmarked] });
    show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    await waitFor(() => expect(checkNorma).toHaveBeenCalledTimes(1));
  });
});

describe('ArticleTabContent — the way back and the way on', () => {
  it('goes to the text in force without a date and with its doctrine', () => {
    show(article(MIDDLE, PAST));
    fireEvent.click(screen.getByRole('button', { name: 'Vai al testo attuale' }));
    const params = triggerSearch.mock.calls[0][0];
    expect(params).toMatchObject({ act_type: 'codice civile', article: '1284', version: 'vigente', show_brocardi_info: true });
    expect(params.version_date).toBeUndefined();
  });

  it('opens the dialog from the chip and asks for a text on a day, without doctrine and keeping the annex', async () => {
    show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'In vigore dal 28-12-2025' }));
    const dialog = screen.getByRole('dialog', { name: 'Testo alla data' });
    fireEvent.change(within(dialog).getByLabelText('Data'), { target: { value: '2007-12-29' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Mostra il testo/ }));
    expect(triggerSearch).toHaveBeenCalledWith({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1284',
      version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false, annex: '2',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); // it fades out
  });

  it('refuses an act of the Union in the dialog', () => {
    show(article(undefined, { tipo_atto: 'regolamento ue', allegato: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni' }));
    fireEvent.click(screen.getByRole('button', { name: 'Testo alla data...' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Atti dell’Unione europea');
  });
});

describe('ArticleTabContent — an article that did not exist yet', () => {
  const notYet = () => article(NOT_YET, { versione: 'vigente', data_versione: '2010-01-01' }, {
    article_text: 'Art. 183-bis\n\nARTICOLO NON ANCORA ESISTENTE O VIGENTE',
  });

  it('does not draw the served notice as an article, and says when it came into being', () => {
    const { container } = show(notYet());
    expect(container.querySelector('.vlx-art')).toBeNull();
    expect(screen.queryByText(/NON ANCORA ESISTENTE/)).not.toBeInTheDocument();
    expect(screen.getByText('Questo articolo non esisteva al 1 gennaio 2010. È in vigore dal 13 settembre 2014.')).toBeInTheDocument();
  });

  it('opens the text of the first day it existed', () => {
    show(notYet());
    fireEvent.click(screen.getByRole('button', { name: 'Vai al testo del 13 settembre 2014' }));
    expect(triggerSearch).toHaveBeenCalledWith(expect.objectContaining({
      version: 'vigente', version_date: '2014-09-13', show_brocardi_info: false,
    }));
  });

  it('offers to pick another date', () => {
    show(notYet());
    fireEvent.click(screen.getByRole('button', { name: 'Scegli un’altra data' }));
    expect(screen.getByRole('dialog', { name: 'Testo alla data' })).toBeInTheDocument();
  });

  it('switches off copying and the dossier', () => {
    show(notYet());
    const reason = 'Non disponibile: l’articolo non esisteva a quella data';
    screen.getAllByTitle(`Copia testo — ${reason}`).forEach((b) => expect(b).toBeDisabled());
    screen.getAllByTitle(`Aggiungi a dossier — ${reason}`).forEach((b) => expect(b).toBeDisabled());
  });
});

describe('ArticleTabContent — copying a past text', () => {
  const copyButton = () => screen.getAllByTitle('Copia testo')[0];

  it('starts with the citation of the version, so the quotation cannot travel without it', async () => {
    show(article(MIDDLE, PAST));
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied: string = writeText.mock.calls[0][0];
    expect(copied.startsWith(
      'art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il ',
    )).toBe(true);
    expect(copied).toContain('Il saggio degli interessi legali');
    expect(copied).not.toContain('Tratto da');
  });

  it('keeps the trailer the text in force always had', async () => {
    show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied: string = writeText.mock.calls[0][0];
    expect(copied.endsWith('\n\n---\ncodice civile n. 262 del 1942-03-16, Art. 1284 (Allegato 2)')).toBe(true);
  });

  it('copies the citation alone from the banner', async () => {
    show(article(MIDDLE, PAST));
    fireEvent.click(screen.getByRole('button', { name: 'Copia citazione' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(/^art\. 1284 c\.c\., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 \(Normattiva/);
  });

  it('offers no citation for a version that does not contain the day', () => {
    show(article({ ...MIDDLE, request_in_window: false }, { versione: 'vigente', data_versione: '2010-01-01' }));
    expect(screen.getByRole('alert')).toHaveTextContent('non va considerata attendibile');
    expect(screen.queryByRole('button', { name: 'Copia citazione' })).not.toBeInTheDocument();
  });
});

describe('ArticleTabContent — selecting words of the text', () => {
  const RECT = { x: 40, y: 120, width: 90, height: 18 };
  const original = Range.prototype.getBoundingClientRect;

  beforeEach(() => {
    // jsdom has no layout: give the range a rect so the popup can position.
    Range.prototype.getBoundingClientRect = () =>
      ({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) }) as DOMRect;
  });
  afterEach(() => {
    Range.prototype.getBoundingClientRect = original;
    window.getSelection()?.removeAllRanges();
  });

  function select(container: HTMLElement, needle: string) {
    const root = container.querySelector('.vlx-art');
    if (!root) throw new Error('no text on screen');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const at = node.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent.mouseUp(root);
      return;
    }
    throw new Error(`"${needle}" is not in the text`);
  }

  const WORDS = 'Gli interessi superiori alla misura legale';

  it('offers only "Copia" on a past text: nothing may be anchored to it', async () => {
    const { container } = show(article(MIDDLE, PAST));
    select(container, WORDS);
    await waitFor(() => expect(screen.getByTitle(/^Copia \(/)).toBeInTheDocument());
    expect(screen.queryByTitle(/^Evidenzia \(H\)/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/^Aggiungi nota \(N\)/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
  });

  it('offers highlight, note and discussion on the text in force (the control)', async () => {
    const { container } = show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    select(container, WORDS);
    await waitFor(() => expect(screen.getByTitle(/^Aggiungi nota \(N\)/)).toBeInTheDocument());
    expect(screen.getByTitle(/^Evidenzia \(H\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discuti con i colleghi/i })).toBeInTheDocument();
  });
});
