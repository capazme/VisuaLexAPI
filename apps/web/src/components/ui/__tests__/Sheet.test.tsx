import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
