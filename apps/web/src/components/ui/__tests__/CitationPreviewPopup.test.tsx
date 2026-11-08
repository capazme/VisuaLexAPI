import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CitationPreviewPopup } from '../CitationPreviewPopup';
import type { ParsedCitationData } from '../../../utils/citationMatcher';

const citation: ParsedCitationData = { act_type: 'codice civile', article: '2043', confidence: 0.9 };

function renderPopup(openLabel?: string) {
  const onOpenCitation = vi.fn();
  render(
    <CitationPreviewPopup
      isVisible
      isLoading={false}
      error={null}
      citation={citation}
      article={null}
      position={{ top: 0, left: 0 }}
      onClose={vi.fn()}
      onOpenCitation={onOpenCitation}
      openLabel={openLabel}
    />,
  );
  return onOpenCitation;
}

describe('CitationPreviewPopup — the open button', () => {
  it('opens the norm in the practice by default', () => {
    const onOpenCitation = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Apri nella pratica' }));
    expect(onOpenCitation).toHaveBeenCalledExactlyOnceWith(citation);
  });

  it('says the host’s words when the host opens the norm itself (the dossier’s own norms, D7d)', () => {
    const onOpenCitation = renderPopup('Apri tra le norme');
    expect(screen.queryByRole('button', { name: 'Apri nella pratica' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apri tra le norme' }));
    expect(onOpenCitation).toHaveBeenCalledExactlyOnceWith(citation);
  });
});
