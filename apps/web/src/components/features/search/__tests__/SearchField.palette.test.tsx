import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appStore, useAppStore } from '../../../../store/useAppStore';
import { CommandPalette } from '../CommandPalette';
import { SearchField } from '../SearchField';
import { resetSearchFieldControl } from '../../../../utils/searchFieldControl';

vi.mock('../../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

/** The palette as `GlobalSearch` mounts it: opened and closed by the store. */
function Palette() {
  const isOpen = useAppStore((s) => s.commandPaletteOpen);
  const close = useAppStore((s) => s.closeCommandPalette);
  return <CommandPalette isOpen={isOpen} onClose={close} onSearch={vi.fn()} />;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ recognized: false, presets: {}, known_acts: [] }) })));
});

afterEach(() => {
  act(() => appStore.getState().closeCommandPalette());
  resetSearchFieldControl();
  vi.unstubAllGlobals();
});

describe('SearchField and the menu together (R2: one field)', () => {
  it('a key typed on the field goes on in the box; Esc gives the words and the focus back, and opens nothing again', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SearchField />
        <Palette />
      </MemoryRouter>,
    );
    const field = screen.getByRole('button', { name: /^Cerca una norma, una sentenza o un tema/ });
    act(() => field.focus());
    fireEvent.keyDown(field, { key: 'a' });
    const box = await screen.findByPlaceholderText(/art 2043 cc/i);
    expect(box).toHaveValue('a');
    await waitFor(() => expect(box).toHaveFocus());
    await user.keyboard('rt 2043{Escape}');
    await waitFor(() => expect(appStore.getState().commandPaletteOpen).toBe(false));
    expect(field).toHaveTextContent('art 2043');
    await waitFor(() => expect(field).toHaveFocus());
    expect(appStore.getState().commandPaletteOpen).toBe(false);
  });
});
