import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';

const promote = vi.fn();
vi.mock('../contribApi', () => ({ promoteCandidate: (...a: unknown[]) => promote(...a) }));
const search = vi.fn();
vi.mock('../../graph/shared/graphApi', () => ({ searchGraph: (...a: unknown[]) => search(...a) }));

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
  search.mockReset().mockResolvedValue([]);
});

/** Fill the copyright gate (fonte + reformulation + attestation). */
function satisfyCopyrightGate() {
  fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
  fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
    target: { value: 'La risoluzione estingue il contratto.' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
}

/** Pick the reference norma through the NL picker's URN-paste path. */
async function pickReferenceNorma(urn = 'urn:nir:stato:codice.civile:1942;262~art1453') {
  fireEvent.change(screen.getByLabelText(/norma di riferimento/i), { target: { value: urn } });
  fireEvent.click(await screen.findByTestId('norma-picker-apply'));
}

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
    await waitFor(() => expect(onPromoted).toHaveBeenCalledWith(7, 'pe-1'));
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
    const relation = {
      ...candidate,
      candidate_type: 'relation' as const,
      source_node_urn: 'concetto:inadempimento',
      source_resolved: true,
      target_entity_id: 'concetto:risoluzione',
      target_resolved: true,
    };
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
    // the relation checklist also demands a reference norma and resolved ends
    expect(screen.getByTestId('promotion-checklist')).toHaveTextContent(/norma di riferimento/i);
    expect(screen.getByTestId('promotion-checklist')).toHaveTextContent(
      /estremi della relazione collegati al grafo/i,
    );
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
      source_resolved: true,
      relation_type: 'DISCIPLINA',
      target_entity_id: 'ent:risoluzione',
      target_text: 'risoluzione',
      target_resolved: true,
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
    await waitFor(() => expect(onPromoted).toHaveBeenCalledWith(relation.id, 'pe-1'));
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

  it('sends the LLM-assigned entity type and shows its badge', async () => {
    const onPromoted = vi.fn();
    render(
      <CandidateCard
        candidate={{ ...candidate, entity_type: 'principio' }}
        articleUrn="urn:test"
        onPromoted={onPromoted}
      />,
    );
    expect(screen.getByTestId('entity-type-badge')).toHaveTextContent('Principio');
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(promoteBtn());
    });
    expect(promote).toHaveBeenCalledWith(7, expect.objectContaining({ tipo: 'principio' }));
  });

  it('asks to confirm when MERL-T defers on a duplicate, then retries with the skip flags', async () => {
    const onPromoted = vi.fn();
    promote.mockResolvedValueOnce({
      pendingId: null,
      created: false,
      hasDuplicates: true,
      duplicateActionRequired: true,
      duplicates: [{ id: 'concetto:risoluzione', text: 'Risoluzione' }],
    });
    render(<CandidateCard candidate={candidate} articleUrn="urn:test" onPromoted={onPromoted} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(promoteBtn());
    });

    expect(screen.getByTestId('duplicate-confirm')).toHaveTextContent(/proposta identica/i);
    expect(onPromoted).not.toHaveBeenCalled();
    expect(screen.queryByText(/proposta inviata/i)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /invia comunque/i }));
    });
    expect(promote).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ skipDuplicateCheck: true, acknowledgedDuplicateOf: 'concetto:risoluzione' }),
    );
    await waitFor(() => expect(onPromoted).toHaveBeenCalledWith(7, 'pe-1'));
  });

  it("shows MERL-T's reason instead of a false success when nothing was created", async () => {
    const onPromoted = vi.fn();
    promote.mockResolvedValueOnce({ pendingId: null, created: false, message: 'Nome entità non valido' });
    render(<CandidateCard candidate={candidate} articleUrn="urn:test" onPromoted={onPromoted} />);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Torrente p.120' } });
    fireEvent.change(screen.getByLabelText(/la tua riformulazione/i), {
      target: { value: 'La risoluzione estingue il contratto.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(promoteBtn());
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Nome entità non valido');
    expect(onPromoted).not.toHaveBeenCalled();
    expect(screen.queryByText(/proposta inviata/i)).not.toBeInTheDocument();
  });

  describe('relation endpoints (B1)', () => {
    // As staged by the extractor: the two ends are the names it wrote.
    const unresolved: ExtractionCandidate = {
      id: 21,
      candidate_type: 'relation',
      relation_type: 'DISCIPLINA',
      source_node_urn: 'inadempimento',
      source_text: 'inadempimento',
      target_entity_id: 'risoluzione del contratto',
      target_text: 'risoluzione del contratto',
      descrizione: '',
      verbatim_excerpt: "L'inadempimento consente la risoluzione del contratto.",
    };

    it('keeps promote disabled until both ends are resolved, and says why', async () => {
      render(<CandidateCard candidate={unresolved} articleUrn="" onPromoted={() => {}} />);
      satisfyCopyrightGate();
      await pickReferenceNorma();

      expect(promoteBtn()).toBeDisabled();
      const checklist = screen.getByTestId('promotion-checklist');
      expect(checklist).toHaveTextContent(/estremi della relazione collegati al grafo/i);
      // the title still reads source → TYPE → target in the extractor's words
      expect(screen.getByTestId('candidate-21')).toHaveTextContent('inadempimento');
      expect(screen.getByTestId('candidate-21')).toHaveTextContent('risoluzione del contratto');
      expect(screen.getByTestId('endpoint-source-picker')).toBeInTheDocument();
      expect(screen.getByTestId('endpoint-target-picker')).toBeInTheDocument();
    });

    it('resolves the ends from graph search and from a just-promoted entity, then sends the ids', async () => {
      search.mockImplementation(async (q: string) =>
        q === 'inadempimento'
          ? [
              { id: 'live:abc', nome: 'Inadempimento (provvisorio)' },
              { id: 'inadempimento', nome: 'nome nudo, non un id' },
              { id: 'concetto:inadempimento', nome: 'Inadempimento', tipo: 'concetto' },
            ]
          : [],
      );
      const onPromoted = vi.fn();
      render(
        <CandidateCard
          candidate={unresolved}
          articleUrn=""
          onPromoted={onPromoted}
          promotedEntities={[{ candidateId: 3, pendingId: 'concetto:1a2b3c4d', label: 'Risoluzione del contratto' }]}
        />,
      );
      satisfyCopyrightGate();
      await pickReferenceNorma();

      // Source: the graph search is pre-filled with the extractor's name and
      // runs once the field is reached; only identifiers a relation can point
      // at are offered.
      expect(search).not.toHaveBeenCalled();
      const sourceInput = screen.getByLabelText('Nodo di origine');
      expect(sourceInput).toHaveValue('inadempimento');
      fireEvent.focus(sourceInput);
      const option = await screen.findByRole('option', { name: /^Inadempimento/ });
      expect(screen.queryByText('Inadempimento (provvisorio)')).not.toBeInTheDocument();
      expect(screen.queryByText('nome nudo, non un id')).not.toBeInTheDocument();
      expect(search).toHaveBeenCalledWith('inadempimento', expect.any(Number));
      fireEvent.mouseDown(option);
      expect(screen.getByTestId('endpoint-source-selected')).toHaveTextContent('concetto:inadempimento');

      // Target: the entity promoted a moment ago from the same document.
      const target = screen.getByTestId('endpoint-target-picker');
      fireEvent.click(within(target).getByRole('tab', { name: /proposta promossa/i }));
      fireEvent.click(within(target).getByRole('button', { name: /risoluzione del contratto/i }));
      expect(screen.getByTestId('endpoint-target-selected')).toHaveTextContent('Risoluzione del contratto');

      expect(promoteBtn()).toBeEnabled();
      await act(async () => {
        fireEvent.click(promoteBtn());
      });
      expect(promote).toHaveBeenCalledWith(
        21,
        expect.objectContaining({
          candidateType: 'relation',
          sourceUrn: 'concetto:inadempimento',
          targetEntityId: 'concetto:1a2b3c4d',
          tipoRelazione: 'DISCIPLINA',
        }),
      );
      await waitFor(() => expect(onPromoted).toHaveBeenCalledWith(21, 'pe-1'));
    });

    it('resolves an end to a norm through the NL norma picker', async () => {
      render(<CandidateCard candidate={unresolved} articleUrn="" onPromoted={() => {}} />);
      const source = screen.getByTestId('endpoint-source-picker');
      fireEvent.click(within(source).getByRole('tab', { name: /^norma$/i }));
      fireEvent.change(screen.getByLabelText(/norma di origine/i), {
        target: { value: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453' },
      });
      fireEvent.click(await within(source).findByTestId('norma-picker-apply'));
      expect(screen.getByTestId('endpoint-source-selected')).toHaveTextContent(
        'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
      );
    });

    it('does not offer the "proposta promossa" option when nothing was promoted', () => {
      render(<CandidateCard candidate={unresolved} articleUrn="" onPromoted={() => {}} />);
      expect(screen.queryByRole('tab', { name: /proposta promossa/i })).not.toBeInTheDocument();
    });

    it('trusts ends the staging parser resolved, and lets the user change them', () => {
      render(
        <CandidateCard
          candidate={{
            ...unresolved,
            source_node_urn: 'concetto:inadempimento',
            source_resolved: true,
            // resolved flag without an identifier-shaped value is not trusted
            target_resolved: true,
          }}
          articleUrn=""
          onPromoted={() => {}}
        />,
      );
      expect(screen.getByTestId('endpoint-source-selected')).toHaveTextContent('inadempimento');
      expect(screen.getByTestId('endpoint-target-picker')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cambia origine/i }));
      expect(screen.getByTestId('endpoint-source-picker')).toBeInTheDocument();
    });
  });
});
