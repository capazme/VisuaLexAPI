import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, NormaVisitata } from '../../../../types';

const h = vi.hoisted(() => ({
  origins: [] as unknown[],
  backEntries: [] as unknown[],
}));

vi.mock('../../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: () => Promise.resolve({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } }),
    listPassages: () => Promise.resolve([]),
    create: vi.fn(), comment: vi.fn(), report: vi.fn(), voteThread: vi.fn(), voteComment: vi.fn(),
  },
}));
vi.mock('../../../../services/studiaService', () => ({ studiaService: { forArticle: () => Promise.resolve([]) } }));
vi.mock('../../../../services/authService', () => ({ isAuthenticated: () => true }));
vi.mock('../../../../services/notificationService', () => ({ notificationService: { checkNorma: () => Promise.resolve({ changed: false }) } }));
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true }),
}));
vi.mock('../../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
// What the two ways out of an article record as the way back: a citation jump and a decision opened.
vi.mock('../../../../hooks/useCitationLinks', () => ({
  useCitationLinks: (_ref: unknown, options: { origin?: unknown }) => { h.origins.push(options.origin); },
}));
vi.mock('../CaseLawSection', () => ({
  CaseLawSection: (props: { backEntry?: unknown }) => {
    h.backEntries.push(props.backEntry);
    return null;
  },
}));

import { ArticleTabContent } from '../ArticleTabContent';
import { appStore } from '../../../../store/useAppStore';
import { fixtureText } from '../../../../utils/__fixtures__/articleTexts';

const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043', allegato: '2',
  data_versione: '2007-12-29',
};
const DATA: ArticleData = { article_text: fixtureText('nrm-fx-attachment'), norma_data: NORMA };

function show(readingOrigin?: { tabId: string; blockId: string; articleKey?: string }) {
  render(
    <MemoryRouter>
      <ArticleTabContent data={DATA} readingOrigin={readingOrigin} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.origins.length = 0;
  h.backEntries.length = 0;
  // The reader's notes and highlights are not under test: no request leaves.
  appStore.setState({ loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn(), bookmarks: [] });
});

describe('ArticleTabContent: the way back carries the row (carry-over ruling 12)', () => {
  it("a row's key travels with the citation jump and the decision opened", () => {
    show({ tabId: 'p-1', blockId: 'act-1', articleKey: 'cc|2043|past' });
    const expected = { tabId: 'p-1', blockId: 'act-1', articleId: 'all2:2043', articleKey: 'cc|2043|past', label: 'art. 2043 c.c.' };
    expect(h.origins.at(-1)).toEqual(expected);
    expect(h.backEntries.at(-1)).toEqual(expected);
  });

  it('an origin without a key records none (the old surface, unchanged)', () => {
    show({ tabId: 'tab-1', blockId: 'blk-1' });
    const expected = { tabId: 'tab-1', blockId: 'blk-1', articleId: 'all2:2043', label: 'art. 2043 c.c.' };
    expect(h.origins.at(-1)).toEqual(expected);
    expect(h.backEntries.at(-1)).toEqual(expected);
    expect(h.origins.at(-1)).not.toHaveProperty('articleKey');
    expect(h.backEntries.at(-1)).not.toHaveProperty('articleKey');
  });
});
