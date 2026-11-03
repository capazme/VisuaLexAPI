import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { HighlighterButton } from './HighlighterButton';
import { appStore } from '../../../store/useAppStore';
import { registerInkTarget } from '../../../utils/inkTargets';

afterEach(() => {
  appStore.getState().closeSettings();
  appStore.setState((s) => ({ readingTool: null, highlighterEraser: false, settings: { ...s.settings, highlightColor: 'yellow' } }));
  window.getSelection()?.removeAllRanges();
});

const tool = () => screen.getByRole('button', { name: /^Evidenziatore \(/ });
const inks = () => screen.getByRole('button', { name: 'Colore dell’evidenziatore' });

/** A text that takes the ink, its words selected: what each reader's selection bar registers. */
function selectedText() {
  const p = document.createElement('p');
  p.textContent = 'Il danno ingiusto obbliga al risarcimento.';
  document.body.appendChild(p);
  const range = document.createRange();
  range.setStart(p.firstChild!, 3);
  range.setEnd(p.firstChild!, 8);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const apply = vi.fn();
  const unregister = registerInkTarget({ holds: (r) => p.contains(r.commonAncestorContainer), read: () => ({ apply }) });
  return { apply, done: () => { unregister(); p.remove(); } };
}

describe('HighlighterButton — the highlighter as a tool (A4)', () => {
  it('with nothing selected, a press turns the tool on and another turns it off', () => {
    render(<HighlighterButton />);
    expect(tool()).toHaveAccessibleName('Evidenziatore (giallo)');
    expect(tool()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(tool());
    expect(appStore.getState().readingTool).toBe('highlight');
    expect(tool()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tool());
    expect(appStore.getState().readingTool).toBeNull();
  });

  it('with words selected, a press applies the ink to them at once and leaves the tool off', () => {
    const text = selectedText();
    try {
      render(<HighlighterButton />);
      fireEvent.pointerDown(tool());
      fireEvent.click(tool());
      expect(text.apply).toHaveBeenCalledExactlyOnceWith('yellow');
      expect(appStore.getState().readingTool).toBeNull();
    } finally {
      text.done();
    }
  });

  it('Esc turns it off before anything else hears it; not from a field, nor under a modal dialog', () => {
    const elsewhere = vi.fn();
    window.addEventListener('keydown', elsewhere);
    try {
      render(<><HighlighterButton /><input aria-label="campo" /></>);
      fireEvent.click(tool());
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'campo' }), { key: 'Escape' });
      expect(appStore.getState().readingTool).toBe('highlight');
      const dialog = document.createElement('div');
      dialog.setAttribute('aria-modal', 'true');
      document.body.appendChild(dialog);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(appStore.getState().readingTool).toBe('highlight');
      dialog.remove();
      elsewhere.mockClear();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(appStore.getState().readingTool).toBeNull();
      expect(elsewhere).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', elsewhere);
    }
  });

  it('goes off when the last bar holding it leaves the screen', async () => {
    const first = render(<HighlighterButton />);
    const second = render(<HighlighterButton />);
    fireEvent.click(within(first.container).getByRole('button', { name: /^Evidenziatore \(/ }));
    first.unmount();
    await act(async () => {});
    expect(appStore.getState().readingTool).toBe('highlight');
    second.unmount();
    await act(async () => {});
    expect(appStore.getState().readingTool).toBeNull();
  });

  it('its menu offers the four colours with their meanings and «Nessun colore»', () => {
    render(<HighlighterButton />);
    fireEvent.click(inks());
    const menu = screen.getByRole('menu', { name: 'Colore dell’evidenziatore' });
    expect(menu).toHaveAccessibleDescription('Colore dell’evidenziatore — uso suggerito');
    expect(within(menu).getAllByRole('menuitemradio').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Giallo, uso suggerito: punto centrale',
      'Verde, uso suggerito: condizione o presupposto',
      'Rosso, uso suggerito: da rivedere',
      'Blu, uso suggerito: definizione o eccezione',
      'Nessun colore: toglie le evidenziazioni',
    ]);
  });

  it('a colour chosen with nothing selected is saved and turns the tool on with it, as in a word processor', () => {
    render(<HighlighterButton />);
    fireEvent.click(inks());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Verde/ }));
    expect(appStore.getState()).toMatchObject({ readingTool: 'highlight', highlighterEraser: false, settings: { highlightColor: 'green' } });
    expect(tool()).toHaveAccessibleName('Evidenziatore (verde)');
  });

  it('«Nessun colore» chosen over words selected takes their highlight away, the colour saved left as it was', () => {
    const text = selectedText();
    try {
      render(<HighlighterButton />);
      fireEvent.pointerDown(inks());
      fireEvent.click(inks());
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^Nessun colore/ }));
      expect(text.apply).toHaveBeenCalledExactlyOnceWith('none');
      expect(appStore.getState()).toMatchObject({ readingTool: null, highlighterEraser: true, settings: { highlightColor: 'yellow' } });
      expect(tool()).toHaveAccessibleName('Evidenziatore (nessun colore)');
    } finally {
      text.done();
    }
  });

  it('the toggle alone, on a phone\'s row: no menu, no gear', () => {
    render(<HighlighterButton toggleOnly />);
    expect(tool()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Colore dell’evidenziatore' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cambia il significato dei colori' })).toBeNull();
  });
});

describe('HighlighterButton — the gear to the colours\' meanings', () => {
  it('opens Impostazioni at «Significato dei colori», its click never reaching the row it sits in', () => {
    const onRow = vi.fn();
    render(<div onClick={onRow}><HighlighterButton triggerClassName="min-h-[44px] px-2 py-1 text-xs md:min-h-0" /></div>);
    const gear = screen.getByRole('button', { name: 'Cambia il significato dei colori' });
    // The trigger's look, 44 px wide on a phone whatever the trigger's padding.
    expect(gear).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'md:min-w-0');
    fireEvent.click(gear);
    expect(appStore.getState().settingsDialog).toEqual({ open: true, section: 'highlightColors' });
    expect(onRow).not.toHaveBeenCalled();
  });

  it('can be left out where a gear stands beside it already (Study Mode)', () => {
    render(<HighlighterButton meaningsGear={false} />);
    expect(tool()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambia il significato dei colori' })).toBeNull();
  });
});
