import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, canUseDevMode: false, devMode: false, setDevMode: vi.fn() }) }));
vi.mock('../../features/connections/ConnectedAppsSection', () => ({ ConnectedAppsSection: () => null }));
vi.mock('../../features/merlt/privacy/MerltDataSection', () => ({ MerltDataSection: () => null }));
vi.mock('../../services/accountService', () => ({ accountService: {} }));
// The dialog's body is the scroller in a browser; jsdom computes no overflow from the classes.
const scrollParent = vi.hoisted(() => vi.fn());
vi.mock('../../utils/scrollParent', () => ({ scrollParentOf: scrollParent }));

import { SettingsModal } from './SettingsModal';
import { appStore } from '../../store/useAppStore';
import type { SettingsSection } from '../../types';

const own = () => appStore.getState().settings.highlightColorMeanings;
const setOwn = (meanings: Record<string, string>) =>
  appStore.setState((st) => ({ settings: { ...st.settings, highlightColorMeanings: meanings } }));

function open(section: SettingsSection | null = null) {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <SettingsModal isOpen section={section} onClose={onClose} />
    </MemoryRouter>,
  );
  return { onClose, region: screen.getByRole('region', { name: 'Significato dei colori' }) };
}

const field = (region: HTMLElement, colour: string) => within(region).getByRole('textbox', { name: colour });

beforeEach(() => {
  // The version box asks /version when the modal opens; it is not under test.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});
afterEach(() => {
  setOwn({});
  scrollParent.mockReset();
});

describe('Impostazioni › «Significato dei colori»', () => {
  it('lists the four colours, each with its meaning: VisuaLex\'s by default', () => {
    const { region } = open();
    expect(within(region).getAllByRole('textbox').map((f) => [f.closest('div')?.textContent, (f as HTMLInputElement).value]))
      .toEqual([['Giallo', 'Punto centrale'], ['Verde', 'Condizione o presupposto'], ['Rosso', 'Da rivedere'], ['Blu', 'Definizione o eccezione']]);
    // Each field says what it is for, its limit and that only the words change.
    expect(field(region, 'Giallo')).toHaveAccessibleDescription(/fino a 40 caratteri.*Le evidenziazioni non cambiano/);
    expect(field(region, 'Giallo')).toHaveAttribute('maxLength', '40');
  });

  it('saves a meaning when its field is left, trimmed, and only the colours changed', () => {
    const { region } = open();
    const green = field(region, 'Verde');
    fireEvent.change(green, { target: { value: '  Termini e scadenze  ' } });
    // Nothing saved while typing.
    expect(own()).toEqual({});
    fireEvent.blur(green);
    expect(own()).toEqual({ green: 'Termini e scadenze' });
    expect(green).toHaveValue('Termini e scadenze');
    expect(within(region).getByRole('status')).toHaveTextContent('Significato del verde salvato: «Termini e scadenze».');
  });

  it('saves on Enter too', () => {
    const { region } = open();
    const blue = field(region, 'Blu');
    fireEvent.change(blue, { target: { value: 'GDPR' } });
    fireEvent.keyDown(blue, { key: 'Enter' });
    expect(own()).toEqual({ blue: 'GDPR' });
  });

  it('keeps the meaning it had when a field is emptied, and says so', () => {
    setOwn({ yellow: 'Tesi' });
    const { region } = open();
    const yellow = field(region, 'Giallo');
    fireEvent.change(yellow, { target: { value: '   ' } });
    fireEvent.blur(yellow);
    expect(own()).toEqual({ yellow: 'Tesi' });
    expect(yellow).toHaveValue('Tesi');
    expect(within(region).getByRole('status')).toHaveTextContent('Il significato non può essere vuoto: il giallo resta «Tesi».');
  });

  it('Esc gives up a change and keeps Impostazioni open; the next Esc closes it', () => {
    const { region, onClose } = open();
    const red = field(region, 'Rosso');
    red.focus();
    fireEvent.change(red, { target: { value: 'Contro' } });
    fireEvent.keyDown(red, { key: 'Escape' });
    expect(red).toHaveValue('Da rivedere');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.blur(red);
    expect(own()).toEqual({});
    fireEvent.keyDown(red, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a meaning written back to the default is no meaning of one\'s own', () => {
    setOwn({ green: 'Termini' });
    const { region } = open();
    const green = field(region, 'Verde');
    fireEvent.change(green, { target: { value: 'Condizione o presupposto' } });
    fireEvent.blur(green);
    expect(own()).toEqual({});
  });

  it('«Ripristina predefiniti» brings VisuaLex\'s four back, and does nothing with nothing to restore', () => {
    setOwn({ yellow: 'Tesi', red: 'Contro' });
    const { region } = open();
    const reset = within(region).getByRole('button', { name: 'Ripristina predefiniti' });
    expect(reset).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(reset);
    expect(own()).toEqual({});
    expect(field(region, 'Giallo')).toHaveValue('Punto centrale');
    expect(field(region, 'Rosso')).toHaveValue('Da rivedere');
    expect(within(region).getByRole('status')).toHaveTextContent('Ripristinati i significati predefiniti.');
    expect(reset).toHaveAttribute('aria-disabled', 'true');
  });

  it('44 px on a phone: every field and the button', () => {
    const { region } = open();
    for (const f of within(region).getAllByRole('textbox')) expect(f).toHaveClass('min-h-[44px]', 'md:min-h-0');
    expect(within(region).getByRole('button', { name: 'Ripristina predefiniti' })).toHaveClass('min-h-[44px]');
  });

  it('opened by the reader\'s gear, it focuses the first field, «Giallo», a control of the dialog\'s Tab order', async () => {
    const { region } = open('highlightColors');
    const yellow = field(region, 'Giallo');
    await waitFor(() => expect(document.activeElement).toBe(yellow));
    // A control of the dialog's Tab order, so its trap leaves Shift+Tab to the browser (the control before it): from
    // an element outside that order (a heading with tabIndex -1) it jumped to the dialog's last control. (jsdom lays
    // nothing out, so the trap itself is not run here: `offsetParent` is always null.)
    expect(yellow.tabIndex).toBe(0);
    expect(yellow).not.toHaveAttribute('tabindex');
    expect(screen.getByRole('heading', { name: 'Significato dei colori' })).not.toHaveAttribute('tabindex');
  });

  it('and scrolls the dialog\'s body to the section, its heading at the top, once', async () => {
    const scroller = document.createElement('div');
    scroller.scrollTop = 40;
    scrollParent.mockReturnValue(scroller);
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: this.tagName === 'SECTION' ? 500 : 100 } as DOMRect;
    });
    try {
      const { region } = open('highlightColors');
      await waitFor(() => expect(document.activeElement).toBe(field(region, 'Giallo')));
      // From the field's place to the section's top: 500 − 100 more.
      expect(scroller.scrollTop).toBe(440);
      field(region, 'Verde').focus();
      field(region, 'Giallo').focus();
      expect(scroller.scrollTop).toBe(440);
    } finally {
      rect.mockRestore();
    }
  });

  it('opened from the user menu, a focus in its fields scrolls nothing', () => {
    const scroller = document.createElement('div');
    scrollParent.mockReturnValue(scroller);
    const { region } = open();
    field(region, 'Giallo').focus();
    expect(scrollParent).not.toHaveBeenCalled();
  });

  it('opened from the user menu, the focus goes to «Chiudi» as before', async () => {
    open();
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/Chiudi/));
  });
});
