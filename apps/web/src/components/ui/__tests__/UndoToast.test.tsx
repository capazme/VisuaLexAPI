import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// Whether the toast is leaving: AnimatePresence says so through `useIsPresent`. jsdom ends an exit at
// once, so the test sets it instead of waiting for one.
const presence = vi.hoisted(() => ({ present: true }));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useIsPresent: () => presence.present };
});

import { UndoToastContainer } from '../Toast';
import { showUndoToast } from '../../../hooks/useUndoableAction';

describe('UndoToastContainer', () => {
  afterEach(() => {
    presence.present = true;
  });

  it('answers «Annulla» while the countdown runs', async () => {
    const undo = vi.fn();
    render(<UndoToastContainer />);
    let outcome: Promise<boolean> | undefined;
    await act(async () => {
      outcome = showUndoToast({ action: () => 'rimosso', undo, message: 'Elemento rimosso' });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Annulla/ }));
    });
    await expect(outcome).resolves.toBe(false);
    expect(undo).toHaveBeenCalledWith('rimosso');
  });

  it('takes nothing while it leaves: a last-moment «Annulla» is not a restore', async () => {
    presence.present = false;
    const undo = vi.fn();
    render(<UndoToastContainer />);
    await act(async () => {
      void showUndoToast({ action: () => 'rimosso', undo, message: 'Elemento rimosso' });
    });
    const annulla = screen.getByRole('button', { name: /Annulla/ });
    expect(annulla).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chiudi notifica' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveAttribute('inert');
    expect(screen.getByRole('alert')).toHaveClass('pointer-events-none');
    fireEvent.click(annulla);
    expect(undo).not.toHaveBeenCalled();
  });
});
