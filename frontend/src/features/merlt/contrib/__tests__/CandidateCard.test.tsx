import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const promote = vi.fn();
vi.mock('../contribApi', () => ({ promoteCandidate: (...a: unknown[]) => promote(...a) }));

import { CandidateCard } from '../CandidateCard';
import type { ExtractionCandidate } from '../types';

const candidate: ExtractionCandidate = {
  id: 7,
  candidate_type: 'entity',
  entity_text: 'Risoluzione',
  descrizione: '',
  verbatim_excerpt: 'Risoluzione: scioglimento del vincolo (Torrente, p.120).',
  llm_confidence: 0.8,
};

function promoteBtn() {
  return screen.getByRole('button', { name: /promuovi/i });
}

beforeEach(() => {
  promote.mockReset().mockResolvedValue({ pendingId: 'pe-1' });
});

describe('CandidateCard', () => {
  it('disables promote until fonte + reformulation + attestation are present', () => {
    render(<CandidateCard candidate={candidate} articleUrn="urn:test" onPromoted={() => {}} />);
    expect(promoteBtn()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    expect(promoteBtn()).toBeDisabled(); // attestation still missing

    fireEvent.click(screen.getByRole('checkbox'));
    expect(promoteBtn()).toBeEnabled();
  });

  it('keeps promote disabled when the reformulation equals the verbatim', () => {
    render(<CandidateCard candidate={candidate} articleUrn="urn:test" onPromoted={() => {}} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'fonte' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: candidate.verbatim_excerpt },
    });
    expect(promoteBtn()).toBeDisabled();
  });

  it('promotes with the reformulated payload and calls onPromoted', async () => {
    const onPromoted = vi.fn();
    render(<CandidateCard candidate={candidate} articleUrn="urn:test" onPromoted={onPromoted} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(promoteBtn());
    });
    expect(promote).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        candidateType: 'entity',
        fonte: 'Torrente p.120',
        attested: true,
        descrizione: 'La risoluzione estingue il contratto.',
      }),
    );
    await waitFor(() => expect(onPromoted).toHaveBeenCalledWith(7));
  });

  it('keeps promote disabled until a reference norma (article URN) is given', () => {
    // No default article URN from context → user must supply one (#6).
    render(<CandidateCard candidate={candidate} articleUrn="" onPromoted={() => {}} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(promoteBtn()).toBeDisabled(); // article still missing

    fireEvent.change(screen.getByLabelText(/norma di riferimento/i), {
      target: { value: 'urn:nir:stato:codice.civile:1942;262~art1453' },
    });
    expect(promoteBtn()).toBeEnabled();
  });

  it('shows a dedup hint when potential_duplicate_of is set', () => {
    render(
      <CandidateCard
        candidate={{ ...candidate, potential_duplicate_of: 'ent:risoluzione' }}
        articleUrn="urn:test"
        onPromoted={() => {}}
      />,
    );
    expect(screen.getByTestId('dedup-hint')).toBeInTheDocument();
  });
});
