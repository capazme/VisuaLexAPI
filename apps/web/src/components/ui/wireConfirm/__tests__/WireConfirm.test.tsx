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

  it('Esc winds it back and gives the focus to the button; an Enter right after confirms nothing', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancelled = vi.fn();
    render(<Host onConfirm={onConfirm} onCancelled={onCancelled} />);
    const opener = screen.getByRole('button', { name: 'Elimina i miei dati' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    // Leaving, the card takes no key and no click.
    const confirm = screen.queryByRole('button', { name: 'Elimina i dati', hidden: true });
    if (confirm) {
      expect(confirm.closest('[inert]')).not.toBeNull();
      fireEvent.keyDown(confirm, { key: 'Enter' });
    }
    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
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
    expect(await screen.findByRole('status', {}, { timeout: 2000 })).toHaveTextContent('Eliminati');
  });

  it('a failed or silent action draws no tick', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => { throw new Error('no'); });
    render(<Host onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Elimina i miei dati' }));
    await user.click(screen.getByRole('button', { name: 'Elimina i dati' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(screen.queryByRole('status')).toBeNull();
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
