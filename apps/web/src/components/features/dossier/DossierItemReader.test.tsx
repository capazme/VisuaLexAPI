import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: vi.fn() }));

import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { DossierItemReader } from './DossierItemReader';
import { appStore } from '../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import type { Highlight, NormaVisitata } from '../../../types';

const norma: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1453' };
const RAW = fixtureText('nrm-cc-1453');
const PLAIN = RAW.replace(/\n/g, '');
const highlight: Highlight = {
  id: 'h1',
  normaKey: buildItemKey(norma),
  articleId: uniqueArticleIdFromNorma(norma),
  rangeSerialized: '',
  text: 'risarcimento del danno',
  color: 'green',
  startOffset: PLAIN.indexOf('risarcimento del danno'),
};

describe('DossierItemReader — annotations on the text', () => {
  beforeEach(() => {
    vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: norma });
  });

  it('marks the annotated comma with a sign that opens its annotations, where a highlight is removed', async () => {
    const removeHighlight = vi.fn();
    appStore.setState({ highlights: [highlight], annotations: [], removeHighlight });
    const { container } = render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
    const sign = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('.vlx-sign[data-block="2"]');
      if (!found) throw new Error('no sign yet');
      return found;
    });
    fireEvent.click(sign);
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni · Nei contratti/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rimuovi/ }));
    expect(removeHighlight).toHaveBeenCalledWith('h1');
  });

  it('no longer lists the highlights a sign already shows in a box under the text', async () => {
    appStore.setState({ highlights: [highlight], annotations: [] });
    const { container } = render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(screen.queryByText('Evidenziazioni')).toBeNull();
    expect(screen.queryByText('Altre evidenziazioni')).toBeNull();
  });

  it('still lets the reader remove a highlight whose text is no longer there', async () => {
    const removeHighlight = vi.fn();
    const orphan: Highlight = { ...highlight, id: 'gone', text: 'testo che non c\'è più', startOffset: 40 };
    appStore.setState({ highlights: [highlight, orphan], annotations: [], removeHighlight });
    render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
    await screen.findByText('Altre evidenziazioni');
    expect(screen.getByText('Non più nel testo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi evidenziazione' }));
    expect(removeHighlight).toHaveBeenCalledWith('gone');
  });
});

describe('DossierItemReader — onArticle', () => {
  it('hands the fetched article to the row, so a row with no rubrica can take it from the text', async () => {
    vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: norma });
    appStore.setState({ highlights: [], annotations: [] });
    const onArticle = vi.fn();
    render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} onArticle={onArticle} />);
    await waitFor(() => expect(onArticle).toHaveBeenCalledWith(expect.objectContaining({ article_text: RAW })));
  });
});
