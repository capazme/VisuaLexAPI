import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, ArticleValidity, NormaVisitata, SearchParams } from '../../../../types';

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
// The cards row reads the study cards of the article; they are not under test.
vi.mock('../../../../services/studiaService', () => ({ studiaService: { forArticle: () => Promise.resolve([]) } }));
vi.mock('../../../../services/authService', () => ({ isAuthenticated: () => true }));
vi.mock('../../../../services/notificationService', () => ({ notificationService: { checkNorma } }));
// The entry that asks MERL-T is drawn in the development mode only; this suite is about the text in force.
vi.mock('../../../../features/devMode/useDevMode', () => ({ useDevMode: () => true }));
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true }),
}));
vi.mock('../../../../plugins/PluginSlot', () => ({
  PluginSlot: ({ slot, props }: { slot: string; props: Record<string, unknown> }) => {
    slotCalls.push({ slot, props });
    return null;
  },
}));
vi.mock('../../rassegne/RassegnePanel', () => ({ RassegnePanel: () => <div data-testid="rassegne-panel" /> }));
// The real comparison state, with the call to open it recorded.
vi.mock('../../../../hooks/useCompare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/useCompare')>();
  return { ...actual, openCompareWithArticle: vi.fn(actual.openCompareWithArticle) };
});

import { ArticleTabContent } from '../ArticleTabContent';
import { appStore } from '../../../../store/useAppStore';

import { ReadingHostContext } from '../../practice/readingHost';

/** LC52 c2: the reader's search gestures go to whoever hosts the reading; without a host, to the store's search. */

const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284', allegato: '2',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1284',
};
const CURRENT: ArticleValidity = {
  state: 'current', valid_from: '2025-12-28', valid_to: null, version_number: 8, act_updated: '2026-08-11', request_in_window: null,
};
const MIDDLE: ArticleValidity = {
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: '2026-08-11', request_in_window: true,
};
const NOT_YET: ArticleValidity = {
  state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true,
};
const TEXT = 'Art. 1284\nIl saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.';

function article(validity: ArticleValidity, norma: Partial<NormaVisitata> = {}, over: Partial<ArticleData> = {}): ArticleData {
  return { article_text: TEXT, norma_data: { ...NORMA, ...norma }, validity, ...over };
}

let triggerSearch: Mock<(params: SearchParams) => void>;
let hostSearch: Mock<(params: SearchParams) => void>;

function hosted(data: ArticleData) {
  return render(
    <MemoryRouter>
      <ReadingHostContext.Provider value={{ search: hostSearch }}>
        <ArticleTabContent data={data} />
      </ReadingHostContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listDiscussions.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } });
  listPassages.mockResolvedValue([]);
  checkNorma.mockResolvedValue({ changed: false });
  triggerSearch = vi.fn<(params: SearchParams) => void>();
  hostSearch = vi.fn<(params: SearchParams) => void>();
  appStore.setState({
    loadAnnotationsForArticle: vi.fn(),
    loadHighlightsForArticle: vi.fn(),
    triggerSearch,
    highlights: [],
    annotations: [],
    bookmarks: [],
  });
});

describe('ArticleTabContent — the search gestures go to the host (LC52 c2)', () => {
  it('«Vai al testo attuale»', () => {
    hosted(article(MIDDLE, { versione: 'vigente', data_versione: '2005-06-01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vai al testo attuale' }));
    expect(hostSearch).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'codice civile', article: '1284', version: 'vigente' }));
    expect(triggerSearch).not.toHaveBeenCalled();
  });

  it('«Testo alla data»', async () => {
    hosted(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'In vigore dal 28 dicembre 2025' }));
    const dialog = screen.getByRole('dialog', { name: 'Testo alla data' });
    fireEvent.change(within(dialog).getByLabelText('Data'), { target: { value: '2007-12-29' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Mostra il testo/ }));
    expect(hostSearch).toHaveBeenCalledWith(expect.objectContaining({ version_date: '2007-12-29', annex: '2' }));
    expect(triggerSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('the text of the first day an article existed', () => {
    hosted(article(NOT_YET, { versione: 'vigente', data_versione: '2010-01-01' }, {
      article_text: 'Art. 183-bis\n\nARTICOLO NON ANCORA ESISTENTE O VIGENTE',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Vai al testo del 13 settembre 2014' }));
    expect(hostSearch).toHaveBeenCalledWith(expect.objectContaining({ version_date: '2014-09-13' }));
    expect(triggerSearch).not.toHaveBeenCalled();
  });

  it('without a host, the store\'s search, as before', () => {
    render(
      <MemoryRouter>
        <ArticleTabContent data={article(MIDDLE, { versione: 'vigente', data_versione: '2005-06-01' })} />
      </MemoryRouter>,
    );
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Vai al testo attuale' })); });
    expect(triggerSearch).toHaveBeenCalledTimes(1);
    expect(hostSearch).not.toHaveBeenCalled();
  });
});
