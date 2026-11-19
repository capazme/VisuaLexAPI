import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { Dossier } from '../../../types';
import { appStore } from '../../../store/useAppStore';

// The form stands in as one button that starts the publication and leaves it running (it disables itself, as the
// real form's «Pubblica» does while the server works).
vi.mock('../dossier/PublishDossierDialog', () => ({
  PublishDossierForm: ({ busy, setBusy, headingId }: { busy: boolean; setBusy: (b: boolean) => void; headingId: string }) => (
    <>
      <h2 id={headingId}>Pubblica nel Forum</h2>
      <button type="button" disabled={busy} onClick={() => setBusy(true)}>Pubblica</button>
      <button type="button" onClick={() => setBusy(false)}>Fine</button>
    </>
  ),
}));

import { PublishDossierPicker } from './PublishDossierPicker';

const item = { id: 'i', type: 'norma', addedAt: '', data: {} } as Dossier['items'][number];

describe('PublishDossierPicker while it publishes', () => {
  it('keeps the focus on the space, not on the body, and Esc waits', () => {
    appStore.setState({ dossiers: [{ id: 'a', title: 'Dossier a', createdAt: '', items: [item], kind: 'studio' }] });
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Apri</button>
          <PublishDossierPicker open={open} onClose={onClose} onPublished={vi.fn()} />
        </>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
    fireEvent.click(screen.getByRole('button', { name: /Dossier a/ }));
    const publish = screen.getByRole('button', { name: 'Pubblica' });
    publish.focus();
    fireEvent.click(publish);
    const region = screen.getByRole('region', { name: 'Pubblica nel Forum' });
    expect(publish).toBeDisabled();
    expect(region).toHaveFocus();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // #709's review: another space opening while it publishes does not take it away; it closes once the server answers.
  it('stays open while it publishes when it is told to close, then closes', () => {
    appStore.setState({ dossiers: [{ id: 'a', title: 'Dossier a', createdAt: '', items: [item], kind: 'studio' }] });
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Apri</button>
          <button type="button" onClick={() => setOpen(false)}>Un altro spazio</button>
          <PublishDossierPicker open={open} onClose={() => setOpen(false)} onPublished={vi.fn()} />
        </>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
    fireEvent.click(screen.getByRole('button', { name: /Dossier a/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Un altro spazio' }));
    expect(screen.getByRole('region', { name: 'Pubblica nel Forum' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }));
    expect(screen.queryByRole('region', { name: 'Pubblica nel Forum' })).toBeNull();
  });
});
