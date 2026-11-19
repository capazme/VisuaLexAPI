import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CitationPreviewPopup } from '../CitationPreviewPopup';
import type { ArticleData } from '../../../types';
import type { ParsedCitationData } from '../../../utils/citationMatcher';

const citation: ParsedCitationData = { act_type: 'codice civile', article: '2043', confidence: 0.9 };
const article = { article_text: 'Qualunque fatto doloso o colposo, che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.' } as ArticleData;

// L-74 (LC142): on hover a pure tooltip. The click on the citation opens the norm beside the text.
describe('CitationPreviewPopup — a pure tooltip', () => {
  it('shows the article\'s first lines, with nothing to press, close or scroll', () => {
    render(
      <CitationPreviewPopup isVisible isLoading={false} error={null} citation={citation} article={article} position={{ top: 0, left: 0 }} onClose={vi.fn()} />,
    );
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByText(/Qualunque fatto doloso/)).toHaveClass('line-clamp-6');
    expect(within(tip).queryAllByRole('button')).toEqual([]);
    expect(tip.querySelector('.overflow-y-auto')).toBeNull();
  });
});
