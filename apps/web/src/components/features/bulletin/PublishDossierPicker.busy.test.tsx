import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { Dossier } from '../../../types';
import { appStore } from '../../../store/useAppStore';

// The form stands in as one button that starts the publication and leaves it running (it disables itself, as the
// real form's «Pubblica» does while the server works).
vi.mock('../dossier/PublishDossierDialog', async () => {
  const { useState } = await import('react');
  return {
    PublishDossierForm: ({ busy, setBusy, headingId, onFailed }: { busy: boolean; setBusy: (b: boolean) => void; headingId: string; onFailed?: () => void }) => {
      const [error, setError] = useState<string | null>(null);
      return (
        <>
          <h2 id={headingId}>Pubblica nel Forum</h2>
          <button type="button" disabled={busy} onClick={() => setBusy(true)}>Pubblica</button>
          <button type="button" onClick={() => setBusy(false)}>Fine</button>
          {/* The server refuses: the form keeps its error, as the real one does. */}
          <button type="button" onClick={() => { setError('Pubblicazione non riuscita. Riprova.'); setBusy(false); onFailed?.(); }}>Rifiuta</button>
          {error && <p role="alert">{error}</p>}
        </>
      );
    },
  };
});

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

  // LC145: the command says its space is there while it publishes; a refusal after another space opened shows again.
  it('keeps the command expanded while it publishes, and opens again with the error when the server refuses', () => {
    appStore.setState({ dossiers: [{ id: 'a', title: 'Dossier a', createdAt: '', items: [item], kind: 'studio' }] });
    function Host() {
      // As the Forum's page wires it.
      const [open, setOpen] = useState(false);
      const [publishing, setPublishing] = useState(false);
      return (
        <>
          <button type="button" aria-expanded={open || publishing} onClick={() => setOpen(true)}>Apri</button>
          <button type="button" onClick={() => setOpen(false)}>Un altro spazio</button>
          <PublishDossierPicker open={open} onClose={() => setOpen(false)} onPublished={vi.fn()} onBusyChange={setPublishing} onReopen={() => setOpen(true)} />
        </>
      );
    }
    render(<Host />);
    const command = screen.getByRole('button', { name: 'Apri' });
    fireEvent.click(command);
    fireEvent.click(screen.getByRole('button', { name: /Dossier a/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Un altro spazio' }));
    expect(screen.getByRole('region', { name: 'Pubblica nel Forum' })).toBeInTheDocument();
    expect(command).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Rifiuta' }));
    expect(screen.getByRole('region', { name: 'Pubblica nel Forum' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Pubblicazione non riuscita. Riprova.');
    expect(command).toHaveAttribute('aria-expanded', 'true');
  });
});
