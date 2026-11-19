import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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
    render(<PublishDossierPicker open onClose={vi.fn()} onPublished={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Dossier a/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Dossier b/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dossier c/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dossier x/ })).toBeDisabled();
  });

  it('says when there is nothing to publish', () => {
    appStore.setState({ dossiers: [d('b', { items: [] })] });
    render(<PublishDossierPicker open onClose={vi.fn()} onPublished={vi.fn()} />);
    expect(screen.getByText(/Non hai dossier da pubblicare/)).toBeInTheDocument();
  });
});

// LC138 (L-73): «Pubblica un dossier» opens in the page, under the command, not over it.
function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen(true)}>Pubblica un dossier</button>
      <PublishDossierPicker open={open} onClose={() => setOpen(false)} onPublished={vi.fn()} />
    </>
  );
}

describe('PublishDossierPicker in the page', () => {
  it('opens as a region that takes the focus, no dialog; Esc gives the focus back', () => {
    appStore.setState({ dossiers: [d('a')] });
    render(<Host />);
    const command = screen.getByRole('button', { name: 'Pubblica un dossier' });
    command.focus();
    fireEvent.click(command);
    const region = screen.getByRole('region', { name: 'Pubblica un dossier' });
    expect(region).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(command).toHaveFocus();
  });

  it('keeps the focus on the space once a dossier is chosen, so Esc still closes it; «Chiudi» too', () => {
    appStore.setState({ dossiers: [d('a')] });
    render(<Host />);
    const command = screen.getByRole('button', { name: 'Pubblica un dossier' });
    command.focus();
    fireEvent.click(command);
    const region = screen.getByRole('region', { name: 'Pubblica un dossier' });
    fireEvent.click(screen.getByRole('button', { name: /Dossier a/ }));
    // The list gave way to the dossier's form, in the same space.
    expect(screen.getByRole('heading', { name: /Pubblica nel Forum/ })).toBeInTheDocument();
    expect(region).toHaveFocus();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(region).not.toBeInTheDocument();
    expect(command).toHaveFocus();
    // Opened again, it starts from the list.
    fireEvent.click(command);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(command).toHaveFocus();
  });
});
