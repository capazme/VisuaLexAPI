import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./StudyModeHeader', () => ({ StudyModeHeader: () => null }));
vi.mock('./StudyModeContent', () => ({ StudyModeContent: () => <p>testo</p> }));
vi.mock('./StudyModeToolsPanel', () => ({ StudyModeToolsPanel: () => null }));
vi.mock('./StudyModeSettings', () => ({ StudyModeSettings: () => null }));
vi.mock('../../../ui/AdvancedExportModal', () => ({ AdvancedExportModal: () => null }));
vi.mock('../../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));

import { StudyMode } from './StudyMode';
import { appStore } from '../../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../../utils/normaKeys';
import { isWorkspaceCovered } from '../../../../utils/findWindowControl';
import { isUndoCovered } from '../../../ui/notifications/undoShortcut';
import type { ArticleData } from '../../../../types';

const ARTICLE: ArticleData = {
  article_text: 'testo',
  norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284' },
};

describe('StudyMode — over the workspace', () => {
  it('leaves Cmd/Ctrl+F to the browser while it is open', () => {
    const { rerender } = render(<StudyMode article={ARTICLE} onClose={vi.fn()} />);
    expect(isWorkspaceCovered()).toBe(true);
    rerender(<StudyMode isOpen={false} article={ARTICLE} onClose={vi.fn()} />);
    expect(isWorkspaceCovered()).toBe(false);
  });

  it('leaves Ctrl+Z to the notifications drawn over it: their «Annulla» is seen', () => {
    render(<StudyMode article={ARTICLE} onClose={vi.fn()} />);
    expect(isUndoCovered()).toBe(false);
  });

  it('is not a modal dialog: a note popover portalled outside it stays readable to a screen reader', () => {
    render(<StudyMode article={ARTICLE} onClose={vi.fn()} />);
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('StudyMode — the article\'s notes and highlights', () => {
  const { loadAnnotationsForArticle, loadHighlightsForArticle } = appStore.getState();
  afterEach(() => appStore.setState({ loadAnnotationsForArticle, loadHighlightsForArticle }));

  it('reads them for the article it shows, one reached with the arrows too (its row never opened in the practice)', () => {
    const notes = vi.fn(async () => {});
    const marks = vi.fn(async () => {});
    appStore.setState({ loadAnnotationsForArticle: notes, loadHighlightsForArticle: marks });
    const next: ArticleData = { ...ARTICLE, norma_data: { ...ARTICLE.norma_data, numero_articolo: '1285' } };
    const { rerender } = render(<StudyMode article={ARTICLE} articles={[ARTICLE, next]} onClose={vi.fn()} />);
    rerender(<StudyMode article={next} articles={[ARTICLE, next]} onClose={vi.fn()} />);
    const keys = [ARTICLE, next].map((a) => [buildItemKey(a.norma_data), uniqueArticleIdFromNorma(a.norma_data)]);
    expect(notes.mock.calls).toEqual(keys);
    expect(marks.mock.calls).toEqual(keys);
    // Closed, it reads nothing.
    rerender(<StudyMode isOpen={false} article={ARTICLE} articles={[ARTICLE, next]} onClose={vi.fn()} />);
    expect(notes).toHaveBeenCalledTimes(2);
    expect(marks).toHaveBeenCalledTimes(2);
  });
});
