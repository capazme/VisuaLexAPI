import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportDossierPanel } from './ImportDossierPanel';
import type { ImportCheck } from './dossierUtils';

const show = (check: ImportCheck) => render(<ImportDossierPanel check={check} onClose={vi.fn()} onOpen={vi.fn()} showToast={vi.fn()} />);

describe('ImportDossierPanel', () => {
  it('counts the decisions and says what will not be imported', () => {
    show({
      dossier: { id: 'd', title: 'Da link', createdAt: '', items: [
        { id: '1', type: 'sentenza', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'Corte cost. n. 1/2014' }, addedAt: '' },
      ] },
      discarded: [{ index: 1, reason: 'sentenza con dati non validi' }],
    });
    expect(screen.getByText(/1 sentenza$/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('1 voce non importabile: sentenza con dati non validi');
  });

  it('shows the tags with a capital letter, as typed past the first (D1)', () => {
    show({ dossier: { id: 'd', title: 'Da link', createdAt: '', items: [], tags: ['accesso', 'DPO'] }, discarded: [] });
    expect(screen.getByText('Accesso')).toBeInTheDocument();
    expect(screen.getByText('DPO')).toBeInTheDocument();
  });

  it('has no warning when everything can be imported', () => {
    show({ dossier: { id: 'd', title: 'Da link', createdAt: '', items: [] }, discarded: [] });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
