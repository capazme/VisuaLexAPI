import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WireConfirm } from '../WireConfirm';
import { Modal } from '../../Modal';

/** A button that opens the confirmation, as the four places do. */
function Host({ onConfirm = vi.fn(), onCancelled = vi.fn() }: { onConfirm?: () => void | Promise<string | null | void>; onCancelled?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Elimina i miei dati</button>
      <WireConfirm
        open={open}
        variant="danger"
        title="Eliminare i tuoi dati?"
        message="Non si torna indietro."
        confirmLabel="Elimina i dati"
        onConfirm={() => {
          setOpen(false);
          return onConfirm();
        }}
        onCancel={() => {
          setOpen(false);
          onCancelled();
        }}
      />
    </>
  );
}

describe('WireConfirm — a confirmation drawn from its button (K1b)', () => {
  it('is an alert dialog named by its question, the focus on «Annulla», Tab going between the two buttons', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Elimina i miei dati' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Eliminare i tuoi dati?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Non si torna indietro.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Annulla' })).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Elimina i dati' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Annulla' })).toHaveFocus();
  });

  it('Esc winds it back and gives the focus to the button; leaving, it takes no click', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancelled = vi.fn();
    render(<Host onConfirm={onConfirm} onCancelled={onCancelled} />);
    const opener = screen.getByRole('button', { name: 'Elimina i miei dati' });
    await user.click(opener);
    const confirm = screen.getByRole('button', { name: 'Elimina i dati' });
    await user.keyboard('{Escape}');
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    // Still drawn while it winds back, or gone: either way nothing in it answers (`inert`, which the browser honours;
    // jsdom does not, so the attribute is what is checked).
    if (confirm.isConnected) expect(confirm.closest('[inert]')).not.toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('starts from the button it is given, which a click did not focus (Safari, a tap), and gives it the focus back', async () => {
    function Given() {
      const [open, setOpen] = useState(false);
      const [from, setFrom] = useState<HTMLElement | null>(null);
      return (
        <>
          <button type="button" onClick={(event) => { setFrom(event.currentTarget); setOpen(true); }}>Revoca</button>
          <button type="button">Altro</button>
          <WireConfirm open={open} title="Revocare il collegamento?" message="…" origin={from} onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </>
      );
    }
    render(<Given />);
    screen.getByRole('button', { name: 'Altro' }).focus();
    // `fireEvent.click` moves no focus, as Safari's click does not.
    fireEvent.click(screen.getByRole('button', { name: 'Revoca' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Annulla' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('button', { name: 'Revoca' })).toHaveFocus();
  });

  it('gives the focus back to a button its action disabled once it is enabled again', async () => {
    function Busy() {
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      return (
        <>
          <button type="button" disabled={busy} onClick={() => setOpen(true)}>Elimina</button>
          <button type="button" onClick={() => setBusy(false)}>Fine</button>
          <WireConfirm open={open} title="Eliminare?" message="…" onConfirm={() => { setOpen(false); setBusy(true); }} onCancel={() => setOpen(false)} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Busy />);
    await user.click(screen.getByRole('button', { name: 'Elimina' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    expect(screen.getByRole('button', { name: 'Elimina' })).toBeDisabled();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Elimina' })).toHaveFocus());
  });

  it('brings Tab back to its two buttons from its text', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Elimina i miei dati' }));
    act(() => screen.getByRole('alertdialog').focus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Annulla' })).toHaveFocus();
  });

  it('tells the caller once the outcome has been said, so it removes the button only then', async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    function Removed() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Revoca</button>
          <WireConfirm open={open} title="Revocare?" message="…" onConfirm={async () => { setOpen(false); return 'Revocata'; }} onCancel={() => setOpen(false)} onOutcomeDone={done} />
        </>
      );
    }
    render(<Removed />);
    await user.click(screen.getByRole('button', { name: 'Revoca' }));
    await user.click(screen.getByRole('button', { name: 'Conferma' }));
    expect(await screen.findByText('Revocata', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(done).not.toHaveBeenCalled();
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it('a click outside cancels', async () => {
    const user = userEvent.setup();
    const onCancelled = vi.fn();
    render(<Host onCancelled={onCancelled} />);
    await user.click(screen.getByRole('button', { name: 'Elimina i miei dati' }));
    fireEvent.click(document.querySelector('.bg-ink-950\\/30')!);
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it('confirmed, runs the action once, and the button says the outcome with its tick', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => 'Eliminati');
    render(<Host onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Elimina i miei dati' }));
    await user.click(screen.getByRole('button', { name: 'Elimina i dati' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Seen over the button (the caller says it in words where a screen reader hears it).
    expect(await screen.findByText('Eliminati', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('a failed or silent action draws no tick', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => { throw new Error('no'); });
    render(<Host onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Elimina i miei dati' }));
    await user.click(screen.getByRole('button', { name: 'Elimina i dati' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(screen.queryByText('Eliminati')).toBeNull();
  });

  it('opened from a dialog (Impostazioni), Esc closes it alone', async () => {
    const user = userEvent.setup();
    const closeSettings = vi.fn();
    render(
      <Modal isOpen onClose={closeSettings} title="Impostazioni">
        <Host />
      </Modal>,
    );
    // The dialog's own first focus (50 ms after it opens) comes first, as it does for a person.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    await user.click(screen.getByRole('button', { name: 'Elimina i miei dati' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Annulla' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(closeSettings).not.toHaveBeenCalled();
  });
});
