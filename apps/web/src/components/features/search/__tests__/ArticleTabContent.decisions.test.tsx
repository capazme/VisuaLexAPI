import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, NormaVisitata } from '../../../../types';

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
vi.mock('../CaseLawSection', () => ({ CaseLawSection: () => null }));

import { ArticleTabContent } from '../ArticleTabContent';
import { appStore } from '../../../../store/useAppStore';
import { fixtureText } from '../../../../utils/__fixtures__/articleTexts';

const NORMA: NormaVisitata = { tipo_atto: 'codice penale', data: '1930-10-19', numero_atto: '1398', numero_articolo: '640' };
const DATA: ArticleData = { article_text: fixtureText('nrm-cp-640'), norma_data: NORMA };

const pushReadingBack = vi.fn();
const openDecision = vi.fn(() => ({ practiceId: 'p', decisionId: 'd' }));
const original = { pushReadingBack: appStore.getState().pushReadingBack, openDecision: appStore.getState().openDecision };

beforeEach(() => {
  pushReadingBack.mockClear();
  openDecision.mockClear();
  appStore.setState({ loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn(), bookmarks: [], pushReadingBack, openDecision } as never);
});
afterEach(() => appStore.setState(original));

describe('ArticleTabContent: the decisions its update notes cite', () => {
  it('links the Corte costituzionale a Normattiva note cites, and opens it beside the row after the way back', () => {
    const { container } = render(
      <MemoryRouter>
        <ArticleTabContent data={DATA} readingOrigin={{ tabId: 'p-1', blockId: 'act-1' }} />
      </MemoryRouter>,
    );
    const cites = [...container.querySelectorAll('.decision-cite')];
    expect(cites.map((c) => c.getAttribute('data-decision-path'))).toEqual(['/sentenze/corte-costituzionale/272/1997']);
    // the links only wrap: the text nodes of the article still spell article_text minus \n
    const root = container.querySelector('.vlx-art')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) text += n.nodeValue;
    expect(text).toContain('Corte Costituzionale, con sentenza 18-25 luglio 1997, n. 272');
    fireEvent.click(cites[0]);
    expect(pushReadingBack).toHaveBeenCalledExactlyOnceWith(
      { tabId: 'p-1', blockId: 'act-1', articleId: '640', label: 'art. 640 c.p.' },
    );
    expect(openDecision).toHaveBeenCalledExactlyOnceWith(
      { corte: 'corte_costituzionale', numero: 272, anno: 1997 },
      { fromLink: true, besideId: 'p-1' },
    );
  });
});
