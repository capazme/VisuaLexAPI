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
    expect(screen.getByRole('list', { name: 'Notifiche' })).toBeInTheDocument();
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

  it('reads a notification when it arrives, never an older one again when a newer one closes', () => {
    render(<NotificationHost />);
    let newer = 0;
    act(() => {
      notify({ type: 'success', message: 'Primo', duration: 0 });
      newer = notify({ type: 'success', message: 'Secondo', duration: 0 });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Secondo');
    act(() => closeNotification(newer, 'dismiss'));
    endExits();
    expect(screen.getByRole('status')).toHaveTextContent('Secondo');
    expect(screen.getByRole('status')).not.toHaveTextContent('Primo');
  });

  it('draws «Ripristinato» in the undone one\'s place even when the undo outlasts its exit', async () => {
    render(<NotificationHost />);
    let finish = () => {};
    const slow = new Promise<void>((r) => { finish = r; });
    await act(async () => {
      void showUndoToast({ action: () => 1, undo: vi.fn(), message: 'Più vecchia' });
    });
    await act(async () => {
      void showUndoToast({ action: () => 2, undo: () => slow, message: 'Da annullare' });
    });
    await act(async () => {
      void showUndoToast({ action: () => 3, undo: vi.fn(), message: 'Più nuova' });
    });
    fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Annulla' }));
    endExits();
    expect(cards().map((c) => c.textContent)).toEqual([expect.stringContaining('Più nuova'), expect.stringContaining('Più vecchia')]);
    await act(async () => { finish(); await slow; });
    expect(cards().map((c) => c.textContent)).toEqual([
      expect.stringContaining('Più nuova'),
      expect.stringContaining('Ripristinato'),
      expect.stringContaining('Più vecchia'),
    ]);
  });

  it('closed from the keyboard, gives the focus to the next notification still open', async () => {
    render(<NotificationHost />);
    await act(async () => {
      void showUndoToast({ action: () => 1, undo: vi.fn(), message: 'Prima' });
      notify({ type: 'info', message: 'Seconda', duration: 0 });
    });
    const card = (text: string) => cards().find((c) => c.textContent?.includes(text))!;
    const close = within(card('Seconda')).getByRole('button', { name: 'Chiudi notifica' });
    act(() => close.focus());
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(within(card('Prima')).getByRole('button', { name: 'Annulla' })).toHaveFocus();
  });

  it('closed with a mouse click, gives the focus to no other notification: the next one\'s time still runs', async () => {
    vi.useFakeTimers();
    render(<NotificationHost />);
    let waiting: Promise<boolean> | undefined;
    await act(async () => {
      waiting = showUndoToast({ action: () => 1, undo: vi.fn(), message: 'Importazione in attesa' });
      notify({ type: 'info', message: 'Seconda', duration: 0 });
    });
    const settled = vi.fn();
    void waiting!.then(settled);
    const card = (text: string) => cards().find((c) => c.textContent?.includes(text))!;
    const close = within(card('Seconda')).getByRole('button', { name: 'Chiudi notifica' });
    // A mouse press focuses the button, then clicks it (`detail` 1).
    act(() => close.focus());
    fireEvent.click(close, { detail: 1 });
    expect(within(card('Importazione in attesa')).getByRole('button', { name: 'Annulla' })).not.toHaveFocus();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(settled).toHaveBeenCalledWith(true);
  });

  it('pushes out a plain notification before an «Annulla» or an error that stays', () => {
    const closed: string[] = [];
    const add = (message: string, over: Partial<Parameters<typeof notify>[0]> = {}) =>
      notify({ type: 'success', message, duration: 3000, onClose: () => closed.push(message), ...over });
    act(() => {
      add('Annulla da tenere', { onUndo: vi.fn(), duration: 5000 });
      add('Errore fisso', { type: 'error', duration: 0 });
      add('Semplice');
      add('Quarta');
    });
    expect(closed).toEqual(['Semplice']);
  });

  describe('Ctrl+Z (⌘Z on a Mac) runs the newest «Annulla» still on screen (L-36)', () => {
    const platform = (value: string) => Object.defineProperty(navigator, 'platform', { configurable: true, get: () => value });
    afterEach(() => Reflect.deleteProperty(navigator, 'platform'));

    async function two() {
      const undoOld = vi.fn();
      const undoNew = vi.fn();
      render(<NotificationHost />);
      let older: Promise<boolean> | undefined;
      let newer: Promise<boolean> | undefined;
      await act(async () => {
        older = showUndoToast({ action: () => 'a', undo: undoOld, message: 'Primo rimosso' });
      });
      await act(async () => {
        newer = showUndoToast({ action: () => 'b', undo: undoNew, message: 'Secondo rimosso' });
      });
      return { undoOld, undoNew, older: older!, newer: newer! };
    }

    it('undoes the newest, says so, and leaves the older one', async () => {
      platform('Win32');
      const { undoOld, undoNew, newer } = await two();
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      await act(async () => { document.body.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
      await expect(newer).resolves.toBe(false);
      expect(undoNew).toHaveBeenCalledWith('b');
      expect(undoOld).not.toHaveBeenCalled();
      endExits();
      // Said, then «Ripristinato» in its place.
      expect(cards().map((c) => c.textContent)).toEqual([expect.stringContaining('Ripristinato'), expect.stringContaining('Primo rimosso')]);
    });

    it('says it in the live region', async () => {
      platform('Win32');
      await two();
      let said = '';
      const unsubscribe = notificationStore.subscribe((s) => { if (s.announced.polite?.message.startsWith('Annullato')) said = s.announced.polite.message; });
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); });
      unsubscribe();
      expect(said).toBe('Annullato: Secondo rimosso');
    });

    it('writes «· Ctrl+Z» beside the newest «Annulla» only, and declares it', async () => {
      platform('Win32');
      await two();
      const card = (text: string) => cards().find((c) => c.textContent?.includes(text))!;
      const newest = within(card('Secondo rimosso')).getByRole('button', { name: 'Annulla' });
      expect(newest).toHaveTextContent('Annulla· Ctrl+Z');
      expect(newest).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
      expect(within(card('Primo rimosso')).getByRole('button', { name: 'Annulla' })).not.toHaveTextContent('Ctrl+Z');
    });

    it('is ⌘Z on a Mac', async () => {
      platform('MacIntel');
      const { undoNew } = await two();
      expect(within(cards()[0]).getByRole('button', { name: 'Annulla' })).toHaveTextContent('⌘Z');
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); });
      expect(undoNew).not.toHaveBeenCalled();
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })); });
      expect(undoNew).toHaveBeenCalled();
    });

    it('stays the browser\'s undo in a field or anything editable, and with Shift', async () => {
      platform('Win32');
      const { undoNew, undoOld } = await two();
      const field = document.createElement('input');
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      document.body.append(field, editor);
      for (const target of [field, editor]) {
        const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
        await act(async () => { target.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(false);
      }
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
      expect(undoNew).not.toHaveBeenCalled();
      expect(undoOld).not.toHaveBeenCalled();
      field.remove();
      editor.remove();
    });

    it('does nothing, and lets the key go, with no «Annulla» on screen', async () => {
      platform('Win32');
      render(<NotificationHost />);
      act(() => { notify({ type: 'info', message: 'Salvato', duration: 0 }); });
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
