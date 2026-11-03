import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHighlightInk } from './useHighlightInk';
import { appStore } from '../store/useAppStore';
import type { Highlight } from '../types';

const PLAIN = 'Il danno ingiusto obbliga colui che ha commesso il fatto a risarcire il danno.';
const at = (words: string) => PLAIN.indexOf(words);
const hl = (id: string, words: string, color: Highlight['color'], extra: Partial<Highlight> = {}): Highlight => ({
  id, normaKey: 'k', articleId: '2043', rangeSerialized: '', text: words, color, startOffset: at(words), ...extra,
});

const store = appStore.getState();
afterEach(() => appStore.setState({ addHighlight: store.addHighlight, editHighlights: store.editHighlights }));

function ink(highlights: Highlight[], extra: { showToast?: () => void; onCreated?: () => void; enabled?: boolean } = {}) {
  const addHighlight = vi.fn();
  const editHighlights = vi.fn();
  appStore.setState({ addHighlight, editHighlights });
  const { result } = renderHook(() => useHighlightInk({ key: 'k', articleId: '2043', plain: PLAIN, highlights, ...extra }));
  return { apply: result.current, addHighlight, editHighlights };
}

describe('useHighlightInk — the rules, into the store (A4)', () => {
  it('a new highlight: made, said in the reader\'s toast, and told to the article (MERL-T)', () => {
    const showToast = vi.fn();
    const onCreated = vi.fn();
    const { apply, addHighlight, editHighlights } = ink([], { showToast, onCreated });
    apply('danno ingiusto', 'blue', at('danno ingiusto'));
    expect(addHighlight).toHaveBeenCalledExactlyOnceWith('k', '2043', 'danno ingiusto', '', 'blue', at('danno ingiusto'));
    expect(showToast).toHaveBeenCalledWith('Testo evidenziato in blu', 'success');
    expect(onCreated).toHaveBeenCalledWith('danno ingiusto', 'blue', at('danno ingiusto'));
    expect(editHighlights).not.toHaveBeenCalled();
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

  it('a text that takes no highlight is left alone', () => {
    const { apply, addHighlight } = ink([], { enabled: false });
    apply('danno', 'yellow', at('danno'));
    expect(addHighlight).not.toHaveBeenCalled();
  });
});
