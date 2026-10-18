import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditDossierModal } from './EditDossierModal';
import type { Dossier } from '../../../types';

const dossier = (extra: Partial<Dossier> = {}): Dossier => ({ id: 'd', title: 'GDPR', createdAt: '2026-10-14', items: [], ...extra });

describe('EditDossierModal — the kind', () => {
  it('starts from the dossier\'s kind and saves the one chosen', () => {
    const onSave = vi.fn();
    render(<EditDossierModal dossier={dossier({ kind: 'studio' })} onClose={() => {}} onSave={onSave} />);
    expect(screen.getByRole('radio', { name: /Di studio/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Di lavoro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith('GDPR', '', [], 'lavoro');
  });

  it('reads a dossier with no kind as di lavoro', () => {
    render(<EditDossierModal dossier={dossier()} onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByRole('radio', { name: /Di lavoro/ })).toBeChecked();
  });
});
