import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useVersionCheck', async () => {
  const { useState } = await import('react');
  return {
    useVersionCheck: () => {
      const [hasNewVersion, setHasNewVersion] = useState(true);
      const [showChangelog, setShowChangelog] = useState(false);
      return {
        currentVersion: '1.9.2',
        hasNewVersion,
        changelog: [],
        dismissNotification: () => setHasNewVersion(false),
        showChangelog,
        setShowChangelog,
      };
    },
  };
});

import { ChangelogNotification } from './ChangelogNotification';

const page = () => render(<><main data-testid="page"><p>Pagina</p></main><ChangelogNotification /></>);

describe('ChangelogNotification — where the focus goes when it closes', () => {
  it('gives it to <main> when «Novità» closes, since «Vedi» went with the toast', async () => {
    vi.useFakeTimers();
    try {
      page();
      const see = screen.getByRole('button', { name: 'Vedi' });
      see.focus();
      fireEvent.click(see);
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
      fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
      act(() => {
        vi.runAllTimers();
      });
      const main = screen.getByTestId('page');
      expect(document.activeElement).toBe(main);
      // Focusable only while it holds the focus.
      act(() => main.blur());
      expect(main).not.toHaveAttribute('tabindex');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives it to <main> when the toast is dismissed', () => {
    page();
    const dismiss = screen.getByRole('button', { name: 'Chiudi notifica' });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(document.activeElement).toBe(screen.getByTestId('page'));
  });
});
