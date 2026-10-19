import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportDossierModal } from './ImportDossierModal';

describe('ImportDossierModal', () => {
  it('counts the decisions and says what will not be imported', () => {
    render(<ImportDossierModal
      dossier={{ id: 'd', title: 'Da link', createdAt: '', items: [
        { id: '1', type: 'sentenza', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'Corte cost. n. 1/2014' }, addedAt: '' },
      ] }}
      discarded={[{ index: 1, reason: 'sentenza con dati non validi' }]}
      onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('1 sentenza')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('1 voce non importabile: sentenza con dati non validi');
  });

  it('has no warning when everything can be imported', () => {
    render(<ImportDossierModal dossier={{ id: 'd', title: 'Da link', createdAt: '', items: [] }} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
