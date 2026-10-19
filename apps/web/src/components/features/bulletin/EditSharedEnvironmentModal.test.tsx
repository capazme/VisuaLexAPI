import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: { updateWithVersion: vi.fn(async () => ({ id: 'se' })) },
}));

import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { EditSharedEnvironmentModal } from './EditSharedEnvironmentModal';

const shared = { id: 'se', title: 'Responsabilità', description: 'Pratica Rossi', category: 'civil', tags: ['civile'], currentVersion: 2 };

describe('EditSharedEnvironmentModal', () => {
  it('sends the name, an emptied description as null, the category and tags — never a content', async () => {
    const onUpdated = vi.fn();
    render(<EditSharedEnvironmentModal environment={shared as never} onClose={vi.fn()} onUpdated={onUpdated} />);
    fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'eu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(sharedEnvironmentService.updateWithVersion).toHaveBeenCalledWith('se', {
      title: 'Responsabilità', description: null, category: 'eu', tags: ['civile'],
    });
  });

  it('flags a codice fiscale in the title and refuses a title too short', () => {
    render(<EditSharedEnvironmentModal environment={shared as never} onClose={vi.fn()} onUpdated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'RSSMRA85T10A562S' } });
    expect(screen.getByText('Possibile dato personale: codice fiscale')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'ab' } });
    expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();
  });
});
