import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appStore, useAppStore } from '../../../../store/useAppStore';
import { CommandPalette } from '../CommandPalette';
import { SearchField } from '../SearchField';
import { ISLAND_FIELD_FOCUS, ISLAND_LENS, ISLAND_SHAPE, ISLAND_SURFACE, ISLAND_TEXT, ISLAND_WORDS, resetSearchFieldControl } from '../../../../utils/searchFieldControl';

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
    const field = screen.getByRole('button', { name: /^Apri il menu di ricerca/ });
    act(() => field.focus());
    fireEvent.keyDown(field, { key: 'a' });
    const box = await screen.findByPlaceholderText(/^Norma, sentenza o tema/);
    expect(box).toHaveValue('a');
    await waitFor(() => expect(box).toHaveFocus());
    await user.keyboard('rt 2043{Escape}');
    await waitFor(() => expect(appStore.getState().commandPaletteOpen).toBe(false));
    expect(field).toHaveTextContent('art 2043');
    await waitFor(() => expect(field).toHaveFocus());
    expect(appStore.getState().commandPaletteOpen).toBe(false);
  });

  it('the pill and the field it grows into are one object: shape, type, lens, ground; the focus on the frame (LC81)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SearchField />
        <Palette />
      </MemoryRouter>,
    );
    const classes = (value: string) => value.split(' ');
    const pill = screen.getByRole('button', { name: /^Apri il menu di ricerca/ });
    await user.click(pill);
    const box = await screen.findByPlaceholderText(/^Norma, sentenza o tema$/);
    const frame = box.closest('[data-island-field]') as HTMLElement;
    for (const name of classes(`${ISLAND_SHAPE} ${ISLAND_SURFACE}`)) {
      expect(pill).toHaveClass(name);
      expect(frame).toHaveClass(name);
    }
    for (const name of classes(`${ISLAND_TEXT} ${ISLAND_WORDS}`)) expect(box).toHaveClass(name);
    for (const name of classes(ISLAND_TEXT)) expect(pill).toHaveClass(name);
    expect(pill.querySelector('svg')).toHaveClass(...classes(ISLAND_LENS));
    expect(frame.querySelector('svg')).toHaveClass(...classes(ISLAND_LENS));
    // The old field's look is gone: no squarer corners, no larger type, no tinted ring around the focus.
    expect(frame.className).not.toMatch(/rounded-lg|h-12|focus-within/);
    expect(box.className).not.toMatch(/font-medium|1\.125rem/);
    expect(frame).toHaveClass(...classes(ISLAND_FIELD_FOCUS));
    // Opened with a pointer: the 1 px edge; Tab back into the field: the keyboard's 2 px; a letter typed: unchanged.
    expect(frame).not.toHaveAttribute('data-keyboard');
    await user.keyboard('a');
    expect(frame).not.toHaveAttribute('data-keyboard');
    await user.tab();
    expect(frame).toHaveAttribute('data-keyboard');
    await user.click(box);
    expect(frame).not.toHaveAttribute('data-keyboard');
  });

  it('opened from the keyboard (⌘K), the field shows the keyboard\'s focus at once (LC81)', async () => {
    render(
      <MemoryRouter>
        <SearchField />
        <Palette />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    act(() => appStore.getState().openCommandPalette());
    const box = await screen.findByPlaceholderText(/^Norma, sentenza o tema$/);
    expect(box.closest('[data-island-field]')).toHaveAttribute('data-keyboard');
  });
});
