import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Dossier } from '../../../types';
import { appStore } from '../../../store/useAppStore';
import { PublishDossierPicker } from './PublishDossierPicker';

const item = { id: 'i', type: 'norma', addedAt: '', data: { tipo_atto: 'codice civile', numero_articolo: '2043' } } as Dossier['items'][number];
const d = (id: string, extra: Partial<Dossier> = {}): Dossier => ({ id, title: `Dossier ${id}`, createdAt: '', items: [item], kind: 'studio', ...extra });

describe('PublishDossierPicker', () => {
  it('lists the dossiers that can be published, a withdrawn one disabled', () => {
    appStore.setState({
      dossiers: [
        d('a'),
        d('b', { items: [] }),
        d('c', { published: { sharedEnvironmentId: 'e', version: 1, isActive: true, updatedAt: '' } }),
        d('x', { forumBlocked: true }),
      ],
    });
    render(<PublishDossierPicker onClose={vi.fn()} onPublished={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Dossier a/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Dossier b/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dossier c/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dossier x/ })).toBeDisabled();
  });

  it('says when there is nothing to publish', () => {
    appStore.setState({ dossiers: [d('b', { items: [] })] });
    render(<PublishDossierPicker onClose={vi.fn()} onPublished={vi.fn()} />);
    expect(screen.getByText(/Non hai dossier da pubblicare/)).toBeInTheDocument();
  });
});
