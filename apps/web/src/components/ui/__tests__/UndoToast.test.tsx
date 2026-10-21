import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NotificationHost, Toast } from '../Toast';
import { showUndoToast } from '../../../hooks/useUndoableAction';
import { closeNotification, notificationStore, notify, resetNotifications } from '../notifications/notifications';

// jsdom runs no animation to its end on its own: an exit is ended by hand, as the card would at its end.
const endExits = () => act(() => notificationStore.getState().entries.filter((e) => e.closing).forEach((e) => notificationStore.setState((s) => ({ entries: s.entries.filter((x) => x.id !== e.id) }))));

afterEach(() => {
  resetNotifications();
  vi.useRealTimers();
});

const list = () => screen.getByRole('list');
const cards = () => within(list()).queryAllByRole('listitem');

describe('NotificationHost (K1a)', () => {
  it('answers «Annulla» while the time runs, then says «Ripristinato» in the same place', async () => {
    const undo = vi.fn();
    render(<NotificationHost />);
    let outcome: Promise<boolean> | undefined;
    await act(async () => {
      outcome = showUndoToast({ action: () => 'rimosso', undo, message: 'Elemento rimosso' });
    });
    expect(screen.getByRole('region', { name: 'Notifiche' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    });
    await expect(outcome).resolves.toBe(false);
    expect(undo).toHaveBeenCalledWith('rimosso');
    endExits();
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent('Ripristinato');
    expect(screen.queryByRole('button', { name: 'Annulla' })).toBeNull();
  });

  it('takes nothing while it leaves: a last-moment «Annulla» is not a restore', async () => {
    const undo = vi.fn();
    render(<NotificationHost />);
    let outcome: Promise<boolean> | undefined;
    await act(async () => {
      outcome = showUndoToast({ action: () => 'rimosso', undo, message: 'Elemento rimosso' });
    });
    const annulla = screen.getByRole('button', { name: 'Annulla' });
    act(() => closeNotification(notificationStore.getState().entries[0].id, 'timeout'));
    // Still drawn while it closes into its line, but it answers nothing.
    expect(annulla).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chiudi notifica' })).toBeDisabled();
    expect(annulla.closest('[inert]')).not.toBeNull();
    fireEvent.click(annulla);
    expect(undo).not.toHaveBeenCalled();
    await expect(outcome).resolves.toBe(true);
  });

  it('holds three at most: the newest first, a fourth closes the oldest', async () => {
    render(<NotificationHost />);
    const outcomes: Promise<boolean>[] = [];
    for (const n of [1, 2, 3, 4]) {
      await act(async () => {
        outcomes.push(showUndoToast({ action: () => n, undo: vi.fn(), message: `Elemento ${n} rimosso` }));
      });
    }
    // The first was pushed out: its action stands.
    await expect(outcomes[0]).resolves.toBe(true);
    endExits();
    expect(cards().map((c) => c.textContent)).toEqual([
      expect.stringContaining('Elemento 4'),
      expect.stringContaining('Elemento 3'),
      expect.stringContaining('Elemento 2'),
    ]);
  });

  it('closes with Esc from inside it, and with ✕', async () => {
    render(<NotificationHost />);
    let outcome: Promise<boolean> | undefined;
    await act(async () => {
      outcome = showUndoToast({ action: () => 'x', undo: vi.fn(), message: 'Elemento rimosso' });
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Annulla' }), { key: 'Escape' });
    await expect(outcome).resolves.toBe(true);
    endExits();
    expect(screen.queryByRole('list')).toBeNull();

    act(() => {
      notify({ type: 'info', message: 'Salvato', duration: 3000 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi notifica' }));
    endExits();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('holds «Annulla»\'s time while the focus is in it, and lets it go after', async () => {
    vi.useFakeTimers();
    render(<NotificationHost />);
    let outcome: Promise<boolean> | undefined;
    await act(async () => {
      outcome = showUndoToast({ action: () => 'x', undo: vi.fn(), message: 'Elemento rimosso' });
    });
    const settled = vi.fn();
    void outcome!.then(settled);
    act(() => screen.getByRole('button', { name: 'Annulla' }).focus());
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(settled).not.toHaveBeenCalled();
    act(() => screen.getByRole('button', { name: 'Annulla' }).blur());
    await act(async () => vi.advanceTimersByTime(5000));
    expect(settled).toHaveBeenCalledWith(true);
  });

  it('draws a plain Toast in the stack while it is visible, and tells it when it goes', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <>
        <NotificationHost />
        <Toast message="Scheda salvata" type="success" isVisible onClose={onClose} />
      </>,
    );
    expect(within(list()).getByText('Scheda salvata')).toBeInTheDocument();
    // No time line: it has no «Annulla».
    expect(screen.queryByRole('button', { name: 'Annulla' })).toBeNull();
    // The stack's live region reads it.
    expect(screen.getByRole('status')).toHaveTextContent('Scheda salvata');
    act(() => vi.advanceTimersByTime(3000));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reads an error assertively', () => {
    render(
      <>
        <NotificationHost />
        <Toast message="Non salvato" type="error" isVisible onClose={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Non salvato');
  });
});
