import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, canUseDevMode: false, devMode: false, setDevMode: vi.fn() }) }));
vi.mock('../../../features/connections/ConnectedAppsSection', () => ({ ConnectedAppsSection: () => null }));
vi.mock('../../../features/merlt/privacy/MerltDataSection', () => ({ MerltDataSection: () => null }));
vi.mock('../../../services/accountService', () => ({ accountService: {} }));
// The layout's content area is the scroller in a browser; jsdom computes no overflow from the classes.
const scrollParent = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/scrollParent', () => ({ scrollParentOf: scrollParent }));

import { SettingsPage } from './SettingsPage';
import { appStore } from '../../../store/useAppStore';
import type { SettingsSection } from '../../../types';

const own = () => appStore.getState().settings.highlightColorMeanings;
const setOwn = (meanings: Record<string, string>) =>
  appStore.setState((st) => ({ settings: { ...st.settings, highlightColorMeanings: meanings } }));

// Opened by its address, with no page of the app to go back to: «Indietro» and Esc go to the search page.
function open(section: SettingsSection | null = null) {
  render(
    <MemoryRouter initialEntries={[`/impostazioni${section ? `#${section}` : ''}`]}>
      <Routes>
        <Route path="/" element={<p>Pagina di ricerca</p>} />
        <Route path="/impostazioni" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return { region: screen.getByRole('region', { name: 'Significato dei colori' }) };
}

const field = (region: HTMLElement, colour: string) => within(region).getByRole('textbox', { name: colour });

beforeEach(() => {
  // The version box asks /version when the page opens; it is not under test.
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

  it('Esc gives up a change and keeps Impostazioni open; the next Esc goes back', () => {
    const { region } = open();
    const red = field(region, 'Rosso');
    red.focus();
    fireEvent.change(red, { target: { value: 'Contro' } });
    fireEvent.keyDown(red, { key: 'Escape' });
    expect(red).toHaveValue('Da rivedere');
    expect(screen.queryByText('Pagina di ricerca')).toBeNull();
    fireEvent.blur(red);
    expect(own()).toEqual({});
    fireEvent.keyDown(red, { key: 'Escape' });
    expect(screen.getByText('Pagina di ricerca')).toBeInTheDocument();
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

  it('opened by the reader\'s gear (`#colori`), it focuses the first field, «Giallo», a control of the Tab order', async () => {
    const { region } = open('colori');
    const yellow = field(region, 'Giallo');
    await waitFor(() => expect(document.activeElement).toBe(yellow));
    expect(yellow.tabIndex).toBe(0);
    expect(yellow).not.toHaveAttribute('tabindex');
    expect(screen.getByRole('heading', { name: 'Significato dei colori' })).not.toHaveAttribute('tabindex');
  });

  it('and scrolls the page\'s scroller alone to the part, its heading at the top with 16 px of air (gotcha 34)', async () => {
    const scroller = document.createElement('div');
    scroller.scrollTop = 40;
    // jsdom has no `scrollTo` on an element: the call sets the place, as a browser does with no smooth scroll.
    scroller.scrollTo = ((options: ScrollToOptions) => { scroller.scrollTop = options.top ?? 0; }) as typeof scroller.scrollTo;
    scrollParent.mockReturnValue(scroller);
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: this.tagName === 'SECTION' ? 500 : 100 } as DOMRect;
    });
    try {
      const { region } = open('colori');
      await waitFor(() => expect(document.activeElement).toBe(field(region, 'Giallo')));
      // The part 400 px below the scroller's top, less the page's 16 px of air.
      expect(scroller.scrollTop).toBe(424);
      field(region, 'Verde').focus();
      field(region, 'Giallo').focus();
      expect(scroller.scrollTop).toBe(424);
    } finally {
      rect.mockRestore();
    }
  });

  it('opened from the user menu, it opens at its top, and a focus in its fields scrolls nothing', () => {
    const scroller = document.createElement('div');
    scroller.scrollTop = 300;
    scroller.scrollTo = ((options: ScrollToOptions) => { scroller.scrollTop = options.top ?? 0; }) as typeof scroller.scrollTo;
    scrollParent.mockReturnValue(scroller);
    const { region } = open();
    expect(scroller.scrollTop).toBe(0);
    const asked = scrollParent.mock.calls.length;
    field(region, 'Giallo').focus();
    expect(scrollParent).toHaveBeenCalledTimes(asked);
    expect(scroller.scrollTop).toBe(0);
  });

  it('is a page, not a dialog: nothing in it is drawn over the content (L-73)', () => {
    open();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeInTheDocument();
  });
});
