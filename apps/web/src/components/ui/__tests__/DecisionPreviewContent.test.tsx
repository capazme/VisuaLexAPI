import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FetchDecisionAnswer } from '../../../types/decisions';
import { DecisionPreviewContent } from '../DecisionPreviewPopup';

// Synthetic texts written for this test: no court's words.
const answer = (testo: Record<string, string>): FetchDecisionAnswer => ({
  esito: 'trovata',
  identita: { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 },
  attributi: { tipo: 'ordinanza' },
  testo,
  fonte: { nome: 'Cassazione' },
  avvisi: [],
}) as FetchDecisionAnswer;
const REF = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 } as const;

describe('DecisionPreviewContent', () => {
  it('shows the first key passage, labelled as automatic, instead of the parties', () => {
    const found = answer({ motivazione: 'Mario Rossi ricorre contro Bianchi s.r.l.', dispositivo: 'P.Q.M.\n\nLa Corte rigetta il ricorso e condanna il ricorrente al pagamento delle spese.' });
    render(<DecisionPreviewContent isLoading={false} error={null} reference={REF} answer={found} />);
    expect(screen.getByText('Dispositivo')).toBeInTheDocument();
    expect(screen.getByText('· evidenziato automaticamente')).toBeInTheDocument();
    expect(screen.getByText('La Corte rigetta il ricorso')).toBeInTheDocument();
    expect(screen.queryByText(/Mario Rossi/)).toBeNull();
  });

  it('shows the first lines when the decision has no key passage', () => {
    render(<DecisionPreviewContent isLoading={false} error={null} reference={REF} answer={answer({ motivazione: 'Il motivo è fondato.' })} />);
    expect(screen.getByText('Il motivo è fondato.')).toBeInTheDocument();
    expect(screen.queryByText(/evidenziato automaticamente/)).toBeNull();
  });
});
