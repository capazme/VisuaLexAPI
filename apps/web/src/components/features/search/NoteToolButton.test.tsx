import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NoteToolButton } from './NoteToolButton';
import { HighlighterButton } from './HighlighterButton';
import { appStore } from '../../../store/useAppStore';
import { registerInkTarget } from '../../../utils/inkTargets';

afterEach(() => {
  appStore.setState({ readingTool: null, noteToolKind: 'note' });
  window.getSelection()?.removeAllRanges();
});

const tool = () => screen.getByRole('button', { name: /^Strumento nota \(/ });
const kinds = () => screen.getByRole('button', { name: 'Tipo di nota' });

/** A text that takes notes, its words selected: what each reader's selection bar registers. */
function selectedText() {
  const p = document.createElement('p');
  p.textContent = 'Il danno ingiusto obbliga al risarcimento.';
  document.body.appendChild(p);
  const range = document.createRange();
  range.setStart(p.firstChild!, 3);
  range.setEnd(p.firstChild!, 8);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const note = vi.fn();
  const unregister = registerInkTarget({ holds: (r) => p.contains(r.commonAncestorContainer), read: () => ({ apply: vi.fn(), note }) });
  return { note, done: () => { unregister(); p.remove(); } };
}

describe('NoteToolButton — the note tool, beside the highlighter (A4 §6)', () => {
  it('with nothing selected, a press turns the tool on and another turns it off; on, it turns the highlighter off', () => {
    render(<><HighlighterButton /><NoteToolButton gloss /></>);
    expect(tool()).toHaveAccessibleName('Strumento nota (nota personale)');
    fireEvent.click(screen.getByRole('button', { name: /^Evidenziatore \(/ }));
    expect(appStore.getState().readingTool).toBe('highlight');
    fireEvent.click(tool());
    expect(appStore.getState().readingTool).toBe('note');
    expect(tool()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Evidenziatore \(/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(tool());
    expect(appStore.getState().readingTool).toBeNull();
  });

  it('with words selected, a press opens the editor of a note on them at once and leaves the tool off', () => {
    const text = selectedText();
    try {
      render(<NoteToolButton gloss />);
      fireEvent.pointerDown(tool());
      fireEvent.click(tool());
      expect(text.note).toHaveBeenCalledExactlyOnceWith('note');
      expect(appStore.getState().readingTool).toBeNull();
    } finally {
      text.done();
    }
  });

  it('its menu chooses «Nota personale» or «Glossa»; chosen with words selected it opens that editor, else it turns the tool on', () => {
    render(<NoteToolButton gloss />);
    fireEvent.click(kinds());
    const menu = screen.getByRole('menu', { name: 'Tipo di nota' });
    expect(within(menu).getAllByRole('menuitemradio').map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Nota personaleLa vedi solo tu, accanto al testo', 'true'],
      ['GlossaUna discussione con i colleghi sul passo', 'false'],
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Glossa/ }));
    expect(appStore.getState()).toMatchObject({ readingTool: 'note', noteToolKind: 'gloss' });
    expect(tool()).toHaveAccessibleName('Strumento nota (glossa)');

    const text = selectedText();
    try {
      fireEvent.click(tool());
      fireEvent.pointerDown(kinds());
      fireEvent.click(kinds());
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^Nota personale/ }));
      expect(text.note).toHaveBeenCalledExactlyOnceWith('note');
      expect(appStore.getState()).toMatchObject({ readingTool: null, noteToolKind: 'note' });
    } finally {
      text.done();
    }
  });

  it('where the reader has no discussions, the toggle alone, writing personal notes whatever was chosen elsewhere', () => {
    appStore.setState({ noteToolKind: 'gloss' });
    const text = selectedText();
    try {
      render(<NoteToolButton />);
      expect(screen.queryByRole('button', { name: 'Tipo di nota' })).toBeNull();
      expect(tool()).toHaveAccessibleName('Strumento nota (nota personale)');
      fireEvent.pointerDown(tool());
      fireEvent.click(tool());
      expect(text.note).toHaveBeenCalledExactlyOnceWith('note');
    } finally {
      text.done();
    }
  });

  it('Esc turns it off, and it goes off when the last bar holding it leaves the screen', async () => {
    const first = render(<NoteToolButton />);
    fireEvent.click(tool());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(appStore.getState().readingTool).toBeNull();
    fireEvent.click(tool());
    expect(appStore.getState().readingTool).toBe('note');
    first.unmount();
    await act(async () => {});
    expect(appStore.getState().readingTool).toBeNull();
  });

  it('a highlighter\'s bar going leaves the note tool on', async () => {
    const highlighter = render(<HighlighterButton />);
    render(<NoteToolButton />);
    fireEvent.click(tool());
    highlighter.unmount();
    await act(async () => {});
    expect(appStore.getState().readingTool).toBe('note');
  });
});
