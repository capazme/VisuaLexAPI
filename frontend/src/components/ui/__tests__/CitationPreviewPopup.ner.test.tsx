import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, type Mock } from 'vitest';
import { CitationPreviewPopup } from '../CitationPreviewPopup';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import type { NerFeedbackType, NerCorrectReference } from '../../../services/merltService';

const citation: ParsedCitationData = {
  act_type: 'codice civile',
  article: '1453',
  confidence: 0.6,
};

type OnNerFeedback = (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => void;

function renderPopup(opts?: { enabled?: boolean; onNerFeedback?: Mock<OnNerFeedback> }) {
  const onNerFeedback = opts?.onNerFeedback ?? vi.fn<OnNerFeedback>();
  render(
    <CitationPreviewPopup
      isVisible
      isLoading={false}
      error={null}
      citation={citation}
      article={null}
      position={{ top: 0, left: 0 }}
      onClose={vi.fn()}
      onOpenInTab={vi.fn()}
      nerFeedbackEnabled={opts?.enabled ?? true}
      onNerFeedback={onNerFeedback}
    />,
  );
  return onNerFeedback;
}

describe('CitationPreviewPopup — NER feedback bar (surface: article_xref)', () => {
  it('renders ✓/✗/Correggi when nerFeedbackEnabled', () => {
    renderPopup();
    expect(screen.getByRole('button', { name: /conferma la citazione/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /segnala citazione errata/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /correggi la citazione/i })).toBeInTheDocument();
  });

  it('hides the bar when nerFeedbackEnabled is false', () => {
    renderPopup({ enabled: false });
    expect(screen.queryByRole('button', { name: /conferma la citazione/i })).toBeNull();
  });

  it('confirm emits feedbackType=confirmation with no correctReference', () => {
    const onNerFeedback = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: /conferma la citazione/i }));
    expect(onNerFeedback).toHaveBeenCalledWith('confirmation', undefined);
  });

  it('reject emits feedbackType=false_positive', () => {
    const onNerFeedback = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: /segnala citazione errata/i }));
    expect(onNerFeedback).toHaveBeenCalledWith('false_positive', undefined);
  });

  it('correct opens an editor (prefilled) and emits correction with correctReference', () => {
    const onNerFeedback = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: /correggi la citazione/i }));

    const actTypeInput = screen.getByLabelText(/tipo atto corretto/i) as HTMLInputElement;
    const articleInput = screen.getByLabelText(/articolo corretto/i) as HTMLInputElement;
    expect(actTypeInput.value).toBe('codice civile');
    expect(articleInput.value).toBe('1453');

    fireEvent.change(actTypeInput, { target: { value: 'codice penale' } });
    fireEvent.change(articleInput, { target: { value: '624' } });
    fireEvent.click(screen.getByRole('button', { name: /^salva$/i }));

    expect(onNerFeedback).toHaveBeenCalledWith(
      'correction',
      expect.objectContaining({ actType: 'codice penale', article: '624' }),
    );
  });

  it('acknowledges after a vote (controls replaced by a thank-you)', () => {
    renderPopup();
    fireEvent.click(screen.getByRole('button', { name: /conferma la citazione/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/grazie/i);
    expect(screen.queryByRole('button', { name: /conferma la citazione/i })).toBeNull();
  });
});
