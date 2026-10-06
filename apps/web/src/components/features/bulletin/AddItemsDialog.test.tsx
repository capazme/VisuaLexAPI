import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// The viewer is a stub with one button that selects the dossier: what is pinned here is the payload the dialog sends.
vi.mock('../environments/EnvironmentContentViewer', () => ({
  EnvironmentContentViewer: ({ onSelectionChange }: { onSelectionChange: (s: unknown) => void }) => (
    <button onClick={() => onSelectionChange({ dossierIds: ['d1'], quickNormIds: [], aliasIds: [], annotationIds: [], highlightIds: [] })}>
      Seleziona il dossier
    </button>
  ),
}));
vi.mock('../../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: { addSuggestionItems: vi.fn(async () => ({})) },
}));

import { appStore } from '../../../store/useAppStore';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { dossierSuggestionPayload } from '../dossier/dossierUtils';
import { AddItemsDialog } from './AddItemsDialog';
import type { Dossier } from '../../../types';

const dossier: Dossier = { id: 'd1', title: 'Pratica', createdAt: '', tags: ['t'], items: [
  { id: 's', type: 'sentenza', addedAt: '', status: 'important',
    data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza', data_deposito: '2014-01-13', etichetta: 'Corte cost. 1/2014' } },
  { id: 'n', type: 'note', data: 'appunto', addedAt: '' },
] };

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({ dossiers: [dossier], quickNorms: [], customAliases: [], annotations: [], highlights: [] });
});

describe('AddItemsDialog: a dossier goes to the Forum through dossierSuggestionPayload', () => {
  it('sends a decision as sentenzaRef with its citation recomputed', async () => {
    render(<AddItemsDialog suggestionId="sug" onAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona il dossier' }));
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi$/ }));
    await vi.waitFor(() => expect(sharedEnvironmentService.addSuggestionItems).toHaveBeenCalledOnce());
    const payload = dossierSuggestionPayload(dossier);
    expect(sharedEnvironmentService.addSuggestionItems).toHaveBeenCalledWith('sug', { items: [{ itemType: 'dossier', payload }] });
    expect(payload.entries[0].sentenzaRef?.etichetta).toBe('Corte cost., sent. 13 gennaio 2014, n. 1');
  });
});
