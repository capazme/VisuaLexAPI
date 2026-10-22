import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appStore } from '../../../../store/useAppStore';
import { SearchField } from '../SearchField';
import { PALETTE_SHORTCUT, focusSearchField, openSearchMenu, resetSearchFieldControl, returnWordsToSearchField } from '../../../../utils/searchFieldControl';

const original = appStore.getState();
const openCommandPaletteWith = vi.fn();
const openCommandPalette = vi.fn();

function renderField() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SearchField />
    </MemoryRouter>,
  );
}

const field = () => screen.getByRole('button', { name: /^Cerca una norma, una sentenza o un tema/ });

beforeEach(() => {
  appStore.setState({ openCommandPaletteWith, openCommandPalette, commandPaletteOpen: false });
});

afterEach(() => {
  appStore.setState({ openCommandPaletteWith: original.openCommandPaletteWith, openCommandPalette: original.openCommandPalette });
  resetSearchFieldControl();
  vi.clearAllMocks();
});

describe('SearchField — the door to the search menu (R2)', () => {
  it('writes its words at 16 px at least on a phone, as the box it opens, with the text size «piccolo» too', () => {
    renderField();
    expect(field()).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
    expect(field()).not.toHaveClass('text-base');
  });

  it('is one field, with no «Opzioni»: it says it opens a dialog, and that ⌘K (Ctrl K) does too', () => {
    renderField();
    expect(field()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Opzioni/ })).toBeNull();
    expect(field()).toHaveTextContent(PALETTE_SHORTCUT);
    expect(document.getElementById('tour-search-field')).toBe(field());
  });

  it('grows into the menu on a click, with its words', async () => {
    const user = userEvent.setup();
    renderField();
    await user.click(field());
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
    act(() => returnWordsToSearchField('art 2043 cc'));
    expect(field()).toHaveTextContent('art 2043 cc');
    await user.click(field());
    expect(openCommandPaletteWith).toHaveBeenCalledWith('art 2043 cc');
  });

  it('grows into the menu when Tab brings the focus, not when the menu gives it back', async () => {
    const user = userEvent.setup();
    renderField();
    await user.tab();
    expect(field()).toHaveFocus();
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
    field().blur();
    // The menu closing gives the focus back by script: no new opening.
    act(() => field().focus());
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('a letter typed on it goes on in the menu, after its words', () => {
    renderField();
    act(() => returnWordsToSearchField('art 2043'));
    fireEvent.keyDown(field(), { key: ' ' });
    expect(openCommandPaletteWith).toHaveBeenLastCalledWith('art 2043 ');
    fireEvent.keyDown(field(), { key: 'c' });
    expect(openCommandPaletteWith).toHaveBeenLastCalledWith('art 2043c');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(openCommandPaletteWith).toHaveBeenLastCalledWith('art 2043');
  });

  it('opens the menu from elsewhere with the words given: the empty page\'s examples', () => {
    renderField();
    act(() => focusSearchField({ text: 'Art. 2043 c.c.' }));
    expect(field()).toHaveTextContent('Art. 2043 c.c.');
    expect(openCommandPaletteWith).toHaveBeenCalledWith('Art. 2043 c.c.');
  });

  it('takes a request made before it was mounted, when asked to wait (the sidebar\'s «Ricerca»): the cursor, no menu', () => {
    expect(focusSearchField({ focus: true }, { wait: true })).toBe(false);
    renderField();
    expect(field()).toHaveFocus();
    expect(openCommandPalette).not.toHaveBeenCalled();
    // The first key typed opens the menu with it.
    fireEvent.keyDown(field(), { key: 'a' });
    expect(openCommandPaletteWith).toHaveBeenCalledWith('a');
  });

  it('the cursor put by «Ricerca» right after a Tab still opens no menu', async () => {
    const user = userEvent.setup();
    renderField();
    await user.keyboard('{Tab}');
    vi.clearAllMocks();
    field().blur();
    act(() => { focusSearchField({ focus: true }); });
    expect(field()).toHaveFocus();
    expect(openCommandPalette).not.toHaveBeenCalled();
  });

  it('says it took a request, and a request that did not wait is not kept', () => {
    expect(focusSearchField({ text: 'gdpr' })).toBe(false);
    renderField();
    expect(openCommandPaletteWith).not.toHaveBeenCalled();
    expect(focusSearchField({ text: 'gdpr' })).toBe(true);
  });

  it('takes the words the menu gives back without opening it, and is emptied after a choice', () => {
    renderField();
    act(() => returnWordsToSearchField('legge 241'));
    expect(field()).toHaveTextContent('legge 241');
    expect(openCommandPaletteWith).not.toHaveBeenCalled();
    act(() => returnWordsToSearchField(''));
    expect(field()).not.toHaveTextContent('legge 241');
  });

  it('Escape empties its words', () => {
    renderField();
    act(() => returnWordsToSearchField('art 2043 cc'));
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field()).not.toHaveTextContent('art 2043 cc');
  });

  it('⌘K opens the menu from the field, with its words; with no field on screen, the menu opens empty', () => {
    const { unmount } = renderField();
    act(() => returnWordsToSearchField('gdpr'));
    act(() => openSearchMenu());
    expect(openCommandPaletteWith).toHaveBeenCalledWith('gdpr');
    unmount();
    act(() => openSearchMenu());
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });
});

describe('SearchField — what the review found (R2)', () => {
  it('⌘K with the menu already open does nothing: the field\'s words would overwrite the box', () => {
    renderField();
    act(() => returnWordsToSearchField('gdpr'));
    appStore.setState({ commandPaletteOpen: true });
    act(() => openSearchMenu());
    expect(openCommandPaletteWith).not.toHaveBeenCalled();
    expect(openCommandPalette).not.toHaveBeenCalled();
  });

  it('a Tab pressed inside the open menu does not count: the focus given back right after opens nothing', () => {
    renderField();
    appStore.setState({ commandPaletteOpen: true });
    fireEvent.keyDown(window, { key: 'Tab' });
    appStore.setState({ commandPaletteOpen: false });
    act(() => field().focus());
    expect(openCommandPalette).not.toHaveBeenCalled();
  });

  it('a character written with AltGr opens the menu with it; a Ctrl shortcut does not', () => {
    renderField();
    fireEvent.keyDown(field(), { key: '@', ctrlKey: true, altKey: true, modifierAltGraph: true } as never);
    expect(openCommandPaletteWith).toHaveBeenLastCalledWith('@');
    openCommandPaletteWith.mockClear();
    fireEvent.keyDown(field(), { key: 'c', ctrlKey: true });
    expect(openCommandPaletteWith).not.toHaveBeenCalled();
  });
});
