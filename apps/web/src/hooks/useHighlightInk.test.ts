import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHighlightInk } from './useHighlightInk';
import { appStore } from '../store/useAppStore';
import { isTextShown } from '../store/textsOnScreen';
import type { Highlight } from '../types';

const PLAIN = 'Il danno ingiusto obbliga colui che ha commesso il fatto a risarcire il danno.';
const at = (words: string) => PLAIN.indexOf(words);
const hl = (id: string, words: string, color: Highlight['color'], extra: Partial<Highlight> = {}): Highlight => ({
  id, normaKey: 'k', articleId: '2043', rangeSerialized: '', text: words, color, startOffset: at(words), ...extra,
});

const store = appStore.getState();
afterEach(() => appStore.setState({ addHighlight: store.addHighlight, editHighlights: store.editHighlights, highlights: [] }));

/** The hook over the text, the store holding `highlights` (another text's one among them, which it never reads). */
function ink(highlights: Highlight[], extra: { onCreated?: () => void; enabled?: boolean } = {}) {
  const addHighlight = vi.fn();
  const editHighlights = vi.fn();
  appStore.setState({ addHighlight, editHighlights, highlights: [...highlights, hl('elsewhere', 'danno', 'yellow', { articleId: '2044' })] });
  const { result, unmount } = renderHook(() => useHighlightInk({ key: 'k', articleId: '2043', plain: PLAIN, ...extra }));
  return { apply: result.current, addHighlight, editHighlights, unmount };
}

describe('useHighlightInk — the rules, into the store (A4)', () => {
  it('a new highlight: made (no toast: the store says it to a screen reader alone, A4) and told to the article (MERL-T)', () => {
    const onCreated = vi.fn();
    const { apply, addHighlight, editHighlights } = ink([], { onCreated });
    apply('danno ingiusto', 'blue', at('danno ingiusto'));
    expect(addHighlight).toHaveBeenCalledExactlyOnceWith('k', '2043', 'danno ingiusto', '', 'blue', at('danno ingiusto'));
    expect(onCreated).toHaveBeenCalledWith('danno ingiusto', 'blue', at('danno ingiusto'));
    expect(editHighlights).not.toHaveBeenCalled();
  });

  it('counts its text as on screen while it is mounted: Ctrl+Z (⌘Z) undoes a gesture on it only then', () => {
    expect(isTextShown('k')).toBe(false);
    const { unmount } = ink([]);
    expect(isTextShown('k')).toBe(true);
    unmount();
    expect(isTextShown('k')).toBe(false);
    // A past text, which takes no highlight, is not the text in force on screen.
    const past = ink([], { enabled: false });
    expect(isTextShown('k')).toBe(false);
    past.unmount();
  });

  it('a piece cut out: one gesture, the parts the projection\'s own words trimmed at their edges', () => {
    const { apply, editHighlights } = ink([hl('h1', 'Il danno ingiusto obbliga', 'yellow')]);
    apply('ingiusto', 'yellow', at('ingiusto'));
    expect(editHighlights).toHaveBeenCalledExactlyOnceWith({
      normaKey: 'k', articleId: '2043', remove: ['h1'], recolor: [],
      add: [
        { text: 'Il danno', startOffset: 0, color: 'yellow', from: 'h1' },
        { text: 'obbliga', startOffset: at('obbliga'), color: 'yellow', from: 'h1' },
      ],
      message: 'Evidenziazione rimossa',
    });
  });

  it('another colour: «Evidenziazione cambiata in verde»; on a highlight from the Forum, the whole one, in place', () => {
    const forum = hl('f1', 'Il danno ingiusto obbliga', 'yellow', { sourceSuggestionId: 's1' });
    const { apply, editHighlights } = ink([forum]);
    apply('danno', 'green', at('danno'));
    expect(editHighlights).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      remove: [], recolor: [{ id: 'f1', color: 'green' }], add: [], message: 'Evidenziazione cambiata in verde',
    }));
  });

  it('«Nessun colore» over words with no highlight does nothing; over two, says so in the plural', () => {
    const { apply, addHighlight, editHighlights } = ink([hl('a', 'danno ingiusto', 'yellow'), hl('b', 'obbliga colui', 'red')]);
    apply('commesso', 'none', at('commesso'));
    expect(addHighlight).not.toHaveBeenCalled();
    expect(editHighlights).not.toHaveBeenCalled();
    apply('ingiusto obbliga', 'none', at('ingiusto obbliga'));
    expect(editHighlights).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ remove: ['a', 'b'], message: 'Evidenziazioni rimosse' }));
  });

  it('the words beside a highlight of the ink lengthen it: one highlight, said as words highlighted, told to the article (A4, 5 November)', () => {
    const onCreated = vi.fn();
    const { apply, addHighlight, editHighlights } = ink([hl('h1', 'danno', 'yellow', { note: 'del server' })], { onCreated });
    apply('ingiusto', 'yellow', at('ingiusto'));
    expect(addHighlight).not.toHaveBeenCalled();
    expect(editHighlights).toHaveBeenCalledExactlyOnceWith({
      normaKey: 'k', articleId: '2043', remove: ['h1'], recolor: [],
      add: [{ text: 'danno ingiusto', startOffset: at('danno'), color: 'yellow', from: 'h1' }],
      message: 'Testo evidenziato in giallo',
    });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('ingiusto', 'yellow', at('ingiusto'));
  });

  it('reads the highlights as the store holds them when it applies, not as the last render drew them (the owner\'s duplicates)', () => {
    const { apply, addHighlight, editHighlights } = ink([]);
    apply('danno', 'yellow', at('danno'));
    expect(addHighlight).toHaveBeenCalledOnce();
    // The first one in the store, the screen not drawn again yet: the same words again are its words, not a second one.
    appStore.setState({ highlights: [hl('h1', 'danno', 'yellow')] });
    apply('danno', 'yellow', at('danno'));
    expect(addHighlight).toHaveBeenCalledOnce();
    expect(editHighlights).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ remove: ['h1'], add: [] }));
  });

  it('a text that takes no highlight is left alone', () => {
    const { apply, addHighlight } = ink([], { enabled: false });
    apply('danno', 'yellow', at('danno'));
    expect(addHighlight).not.toHaveBeenCalled();
  });
});
