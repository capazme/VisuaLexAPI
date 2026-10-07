import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { appStore } from '../../store/useAppStore';
import { SyncErrorToast } from './SyncErrorToast';

afterEach(() => appStore.setState({ lastSyncError: null }));

describe('SyncErrorToast', () => {
  it('draws an error in the toast band, above the command palette and the modals', () => {
    render(<SyncErrorToast />);
    act(() => { appStore.getState().pushSyncError("L'indirizzo non indica una sentenza leggibile: x."); });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("L'indirizzo non indica una sentenza leggibile: x.");
    // the Toast's own box is z-[60]; the layer that holds it is what sets the band
    const layer = screen.getByTestId('sync-error-layer');
    expect(layer).toContainElement(alert);
    expect(layer).toHaveClass('z-[1450]');
    expect(layer).toHaveClass('fixed');
  });
});
