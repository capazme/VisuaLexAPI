import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { appStore } from '../../store/useAppStore';
import { DossierModal } from './DossierModal';
import { sectionStore } from '../../features/sections/useSection';

describe('DossierModal — the kind of a new dossier', () => {
  it('creates a dossier di lavoro unless «Di studio» is chosen', async () => {
    const createDossier = vi.fn().mockResolvedValue('new-id');
    appStore.setState({ createDossier });
    render(<DossierModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Crea Nuovo Dossier/ }));
    expect(screen.getByRole('radio', { name: /Di lavoro/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Di studio/ }));
    fireEvent.change(screen.getByPlaceholderText('Nome Dossier...'), { target: { value: 'GDPR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea' }));
    await waitFor(() => expect(createDossier).toHaveBeenCalledWith('GDPR', undefined, 'studio'));
  });
});

describe('DossierModal — «Annulla» never carries the kind over', () => {
  it('starts every creation as a dossier di lavoro', () => {
    appStore.setState({ createDossier: vi.fn().mockResolvedValue('id') });
    render(<DossierModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Crea Nuovo Dossier/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Di studio/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    fireEvent.click(screen.getByRole('button', { name: /Crea Nuovo Dossier/ }));
    expect(screen.getByRole('radio', { name: /Di lavoro/ })).toBeChecked();
  });
});

describe('DossierModal — the section chooses the kind (sections spec S7)', () => {
  it('starts as a dossier di studio in Gymnasium, and the choice stays visible and changeable', async () => {
    sectionStore.setState({ section: 'gymnasium', dossierKind: 'studio' });
    try {
      const createDossier = vi.fn().mockResolvedValue('new-id');
      appStore.setState({ createDossier });
      render(<DossierModal isOpen onClose={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: /Crea Nuovo Dossier/ }));
      expect(screen.getByRole('radio', { name: /Di studio/ })).toBeChecked();
      fireEvent.click(screen.getByRole('radio', { name: /Di lavoro/ }));
      fireEvent.change(screen.getByPlaceholderText('Nome Dossier...'), { target: { value: 'Pratica' } });
      fireEvent.click(screen.getByRole('button', { name: 'Crea' }));
      await waitFor(() => expect(createDossier).toHaveBeenCalledWith('Pratica', undefined, 'lavoro'));
    } finally {
      sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
    }
  });
});
