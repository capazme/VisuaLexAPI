import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { NotificationHost, Toast } from '../Toast';
import { notificationStore, resetNotifications } from '../notifications/notifications';

// Alone in its file: Framer's frame loop keeps the clock it first met, and a test with fake timers before this one
// would leave it with a clock that never ticks. Here the cards end their exits themselves, as in the app.

afterEach(() => resetNotifications());

const cards = () => within(screen.getByRole('list')).queryAllByRole('listitem');

describe('NotificationCard, its own exit (K1a)', () => {
  it('ends its own exit, under StrictMode too: no notification is left drawn and deaf', async () => {
    const { rerender } = render(
      <StrictMode>
        <NotificationHost />
        <Toast message="Nota salvata" type="success" isVisible duration={0} onClose={vi.fn()} />
      </StrictMode>,
    );
    await waitFor(() => expect(cards()).toHaveLength(1));
    rerender(
      <StrictMode>
        <NotificationHost />
        <Toast message="Nota salvata" type="success" isVisible={false} duration={0} onClose={vi.fn()} />
      </StrictMode>,
    );
    await waitFor(() => expect(notificationStore.getState().entries.map((e) => `${e.id}:${e.closing}`)).toEqual([]), { timeout: 3000 });
    expect(screen.queryByRole('list')).toBeNull();
  });


  it('closed while its entrance is still on its way, still ends its exit', async () => {
    const { rerender } = render(
      <>
        <NotificationHost />
        <Toast message="Subito via" type="info" isVisible onClose={vi.fn()} />
      </>,
    );
    rerender(
      <>
        <NotificationHost />
        <Toast message="Subito via" type="info" isVisible={false} onClose={vi.fn()} />
      </>,
    );
    await waitFor(() => expect(notificationStore.getState().entries).toEqual([]), { timeout: 3000 });
  });
});
