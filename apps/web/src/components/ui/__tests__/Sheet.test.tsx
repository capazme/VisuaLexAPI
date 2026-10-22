import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sheet } from '../Sheet';

function backdrop(): HTMLElement {
  const el = document.querySelector<HTMLElement>('div[aria-hidden].fixed.inset-0');
  if (!el) throw new Error('no backdrop');
  return el;
}

describe('Sheet', () => {
  it('stays open on a press on the backdrop by default (a form keeps what was typed)', () => {
    const onClose = vi.fn();
    render(<Sheet title="Scheda" onClose={onClose}><p>x</p></Sheet>);
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Scheda' })).toBeInTheDocument();
  });

  it('closes on a press on the backdrop with closeOnBackdrop', () => {
    const onClose = vi.fn();
    render(<Sheet title="Anteprima" onClose={onClose} closeOnBackdrop><p>x</p></Sheet>);
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// A sheet gives the focus back to what opened it. A field inside that takes the focus by itself (`autoFocus`, as the
// palette's box does) used to beat the focus manager to it, and the focus went to the body as the sheet closed.
describe('Sheet — the focus as it closes', () => {
  it('goes back to what had it as the sheet opened, even when a field inside took it first', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Apri';
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <Sheet title="Prova" onClose={() => {}}>
        <input aria-label="Campo" autoFocus />
      </Sheet>,
    );
    expect(screen.getByRole('textbox', { name: 'Campo' })).toHaveFocus();

    rerender(<></>);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });
});
