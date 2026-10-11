import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, ArticleValidity } from '../../../../types';

vi.mock('../../../../services/studiaService', () => ({
  studiaService: { forArticle: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true }),
}));
vi.mock('../../../../hooks/useArticlePassageThreads', () => ({
  useArticlePassageThreads: () => ({ threads: [], error: null, reload: vi.fn(), locations: new Map() }),
}));
vi.mock('../../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));

import { ArticleTabContent } from '../ArticleTabContent';
import { studiaService } from '../../../../services/studiaService';
import { appStore } from '../../../../store/useAppStore';
import { clearArticleCardsCache } from '../../../../utils/articleCardsCache';

const forArticle = vi.mocked(studiaService.forArticle);

const NEEDLE = 'decreto sulla semplificazione amministrativa';
const ARTICLE_TEXT = `Art. 3. (Semplificazione)\n\nIl presente articolo rinvia al ${NEEDLE} per le procedure.`;
const URN = 'urn:nir:stato:legge:1990-08-07;241~art3';

const data: ArticleData = {
  article_text: ARTICLE_TEXT,
  norma_data: { tipo_atto: 'legge', data: '1990-08-07', numero_atto: '241', numero_articolo: '3', urn: URN },
  brocardi_info: null,
};

const PAST: ArticleValidity = {
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: '2026-08-11', request_in_window: true,
};

const RECT = { x: 40, y: 120, width: 90, height: 18 };
const originalRect = Range.prototype.getBoundingClientRect;

function show(article: ArticleData = data) {
  return render(
    <MemoryRouter>
      <ArticleTabContent data={article} />
    </MemoryRouter>,
  );
}

/** Select NEEDLE in the rendered text and release the mouse. */
async function selectNeedle(marker: RegExp) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let target: Text | null = null;
  while ((node = walker.nextNode())) {
    if (node.textContent?.includes(NEEDLE)) {
      target = node as Text;
      break;
    }
  }
  expect(target).not.toBeNull();
  const start = target!.textContent!.indexOf(NEEDLE);
  const range = document.createRange();
  range.setStart(target!, start);
  range.setEnd(target!, start + NEEDLE.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(target!.parentElement!.closest('.relative.group\\/content') as HTMLElement);
  await waitFor(() => expect(screen.getByTitle(marker)).toBeInTheDocument());
}

beforeEach(() => {
  forArticle.mockReset().mockResolvedValue([]);
  clearArticleCardsCache();
  appStore.setState({ loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn() });
  Range.prototype.getBoundingClientRect = () =>
    ({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  Range.prototype.getBoundingClientRect = originalRect;
  window.getSelection()?.removeAllRanges();
  vi.unstubAllEnvs();
});

describe('ArticleTabContent: the cards on this article', () => {
  it('draws the row outside the text, so the text and a search in it do not see it', async () => {
    show();
    const row = await screen.findByRole('group', { name: 'Schede di studio' });
    expect(forArticle).toHaveBeenCalledWith(URN);
    expect(row.closest('.vlx-art')).toBeNull();
    expect(document.querySelector('.vlx-art')).not.toContainElement(row);
    expect(document.querySelector('.vlx-art')).not.toHaveTextContent('Nuova scheda');
  });

  it('puts «Crea scheda» in the selection popup, and the form opens on the words and the rubric', async () => {
    show();
    await selectNeedle(/aggiungi nota/i);
    fireEvent.click(screen.getByRole('button', { name: 'Crea scheda' }));
    expect(await screen.findByLabelText('Risposta')).toHaveValue(NEEDLE);
    expect(screen.getByLabelText('Istituto')).toHaveValue('Semplificazione');
  });

  it('leaves «Crea scheda» out of a past text, whose row is disabled', async () => {
    show({
      ...data,
      validity: PAST,
      norma_data: { ...data.norma_data, versione: 'vigente', data_versione: '2005-06-01' },
      versionInfo: { isHistorical: true, requestedDate: '2005-06-01' },
    });
    expect(await screen.findByRole('button', { name: '+ Nuova scheda' })).toHaveAttribute('aria-disabled', 'true');
    await selectNeedle(/^copia \(cmd/i);
    expect(screen.queryByRole('button', { name: 'Crea scheda' })).not.toBeInTheDocument();
  });

  it('leaves «Crea scheda» out of an act with no Normattiva address', async () => {
    show({ ...data, norma_data: { ...data.norma_data, urn: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679' } });
    await selectNeedle(/aggiungi nota/i);
    expect(screen.queryByRole('button', { name: 'Crea scheda' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Schede di studio' })).not.toBeInTheDocument();
  });

  it('draws neither the row nor «Crea scheda» with the feature off', async () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    show();
    await selectNeedle(/aggiungi nota/i);
    expect(screen.queryByRole('button', { name: 'Crea scheda' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Schede di studio' })).not.toBeInTheDocument();
    expect(forArticle).not.toHaveBeenCalled();
  });
});
