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

  it('allows promoting an entity WITHOUT a reference norma (stand-alone, BFF fallback)', () => {
    // Entities extracted from free-text notes often have no specific norma to
    // link to. The BFF falls back to the `user_document` placeholder; the user
    // can leave the optional URN field empty. Only fonte+reformulation+attest.
    render(<CandidateCard candidate={candidate} articleUrn="" onPromoted={() => {}} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(promoteBtn()).toBeEnabled(); // article URN no longer required for entities
  });

  it('still requires the article URN for RELATIONS — picked via NL → URN picker', async () => {
    const relation = { ...candidate, candidate_type: 'relation' as const };
    // Picker hits /api/parse_query; intercept and return a recognized URN.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        recognized: true,
        urn: 'urn:nir:stato:codice.civile:1942;262~art1453',
        display: 'Art. 1453 — codice civile',
      }),
    }) as unknown as typeof fetch;
    render(<CandidateCard candidate={relation} articleUrn="" onPromoted={() => {}} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(promoteBtn()).toBeDisabled(); // no norma yet

    // The picker's input — power-user URN paste path short-circuits the
    // network call by recognizing the "urn:" prefix synchronously.
    fireEvent.change(screen.getByLabelText(/norma di riferimento/i), {
      target: { value: 'urn:nir:stato:codice.civile:1942;262~art1453' },
    });
    const apply = await screen.findByTestId('norma-picker-apply');
    fireEvent.click(apply);
    expect(promoteBtn()).toBeEnabled();
  });

  it('shows a per-requirement checklist while promotion is gated', () => {
    render(<CandidateCard candidate={candidate} articleUrn="urn:test" onPromoted={() => {}} />);
    const checklist = screen.getByTestId('promotion-checklist');
    expect(checklist).toBeInTheDocument();
    // fonte is pre-filled ("Appunti personali"), reformulation + attestation are not
    expect(checklist).toHaveTextContent(/fonte indicata/i);
    expect(checklist).toHaveTextContent(/riformulazione/i);
    expect(checklist).toHaveTextContent(/dichiarazione/i);
  });

  it('hides the checklist once every requirement is met', () => {
    render(<CandidateCard candidate={candidate} articleUrn="urn:test" onPromoted={() => {}} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(promoteBtn()).toBeEnabled();
    expect(screen.queryByTestId('promotion-checklist')).not.toBeInTheDocument();
  });

  it('renders a readable source → relation_type → target title for relation candidates', () => {
    const relation = {
      ...candidate,
      candidate_type: 'relation' as const,
      entity_text: undefined,
      source_node_urn: 'urn:nir:stato:codice.civile:1942;262~art1453',
      relation_type: 'DISCIPLINA',
      target_entity_id: 'ent:risoluzione',
    };
    render(<CandidateCard candidate={relation} articleUrn="" onPromoted={() => {}} />);
    const card = screen.getByTestId(`candidate-${relation.id}`);
    expect(card).toHaveTextContent('urn:nir:stato:codice.civile:1942;262~art1453');
    expect(card).toHaveTextContent('DISCIPLINA');
    expect(card).toHaveTextContent('ent:risoluzione');
    // the relation checklist also demands a reference norma
    expect(screen.getByTestId('promotion-checklist')).toHaveTextContent(/norma di riferimento/i);
  });

  it('promotes a relation candidate with the source/target/relation-type payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        recognized: true,
        urn: 'urn:nir:stato:codice.civile:1942;262~art1453',
        display: 'Art. 1453 — codice civile',
      }),
    }) as unknown as typeof fetch;
    const relation = {
      ...candidate,
      candidate_type: 'relation' as const,
      source_node_urn: 'urn:nir:stato:codice.civile:1942;262~art1453',
      relation_type: 'DISCIPLINA',
      target_entity_id: 'ent:risoluzione',
    };
    const onPromoted = vi.fn();
    render(<CandidateCard candidate={relation} articleUrn="" onPromoted={onPromoted} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/norma di riferimento/i), {
      target: { value: 'urn:nir:stato:codice.civile:1942;262~art1453' },
    });
    const apply = await screen.findByTestId('norma-picker-apply');
    fireEvent.click(apply);
    await act(async () => {
      fireEvent.click(promoteBtn());
    });
    expect(promote).toHaveBeenCalledWith(
      relation.id,
      expect.objectContaining({
        candidateType: 'relation',
        sourceUrn: 'urn:nir:stato:codice.civile:1942;262~art1453',
        targetEntityId: 'ent:risoluzione',
        tipoRelazione: 'DISCIPLINA',
        fonte: 'Torrente p.120',
        attested: true,
      }),
    );
    await waitFor(() => expect(onPromoted).toHaveBeenCalledWith(relation.id));
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
