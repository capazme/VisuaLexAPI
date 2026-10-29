import { describe, it, expect } from 'vitest';
import { alignOffsetToTrimmedText, getSelectionAnchor, plainOffsetAt, rangeFromPlainOffsets } from './selectionOffset';

describe('alignOffsetToTrimmedText', () => {
  it('shifts the offset past leading whitespace', () => {
    expect(alignOffsetToTrimmedText('   danno ingiusto', 10)).toEqual({
      text: 'danno ingiusto',
      startOffset: 13,
    });
  });

  it('leaves a clean selection untouched', () => {
    expect(alignOffsetToTrimmedText('danno ingiusto', 10)).toEqual({
      text: 'danno ingiusto',
      startOffset: 10,
    });
  });

  it('handles trailing whitespace without moving the start', () => {
    expect(alignOffsetToTrimmedText('danno ingiusto   ', 10)).toEqual({
      text: 'danno ingiusto',
      startOffset: 10,
    });
  });

  it('does not shift for a newline-only prefix', () => {
    // A line break is a <br /> in the rendered body, so it contributes zero
    // characters to the offset space (the offset space counts textContent;
    // plainToRaw skips '\n'). Selection.toString() still emits '\n' for it, so
    // counting those newlines would push the anchor off its own text and the
    // marker would be dropped — the failure this helper exists to prevent.
    expect(alignOffsetToTrimmedText('\n\ndanno', 5)).toEqual({
      text: 'danno',
      startOffset: 5,
    });
  });

  it('counts spaces but not newlines in a mixed prefix', () => {
    expect(alignOffsetToTrimmedText('\n  danno', 5)).toEqual({
      text: 'danno',
      startOffset: 7,
    });
  });

  it('is a no-op for whitespace-only input', () => {
    expect(alignOffsetToTrimmedText('   ', 4)).toEqual({
      text: '',
      startOffset: 7,
    });
  });
});

describe('getSelectionAnchor', () => {
  const setup = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  };
  const select = (startNode: Node, startOffset: number, endNode: Node, endOffset: number) => {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  };

  it('reads a selection across two blocks as the text between them, not as rendered lines', () => {
    const root = setup('<div>Primo comma. </div><div> Secondo comma.</div>');
    const [first, second] = [root.children[0].firstChild!, root.children[1].firstChild!];
    const anchor = getSelectionAnchor(root, select(first, 6, second, 8));
    expect(anchor).toEqual({ text: 'comma.  Secondo', startOffset: 6 });
    root.remove();
  });

  it('resolves a selection that starts on an element boundary', () => {
    const root = setup('<div>Art. 1</div><div>Testo del comma.</div>');
    const second = root.children[1].firstChild!;
    const anchor = getSelectionAnchor(root, select(root, 1, second, 5));
    expect(anchor).toEqual({ text: 'Testo', startOffset: 6 });
    root.remove();
  });

  it('counts hidden text, so offsets stay in the stored projection', () => {
    const root = setup('<div><span style="display:none">### </span>Art. 3.</div><div>Tutti i cittadini</div>');
    const second = root.children[1].firstChild!;
    expect(getSelectionAnchor(root, select(second, 0, second, 5))).toEqual({ text: 'Tutti', startOffset: 11 });
    root.remove();
  });

  it('returns null for a selection outside the root or with no text', () => {
    const root = setup('<div>Dentro</div>');
    const outside = setup('<div>Fuori</div>');
    expect(getSelectionAnchor(root, select(outside.firstChild!.firstChild!, 0, outside.firstChild!.firstChild!, 3))).toBeNull();
    expect(getSelectionAnchor(root, select(root.firstChild!.firstChild!, 2, root.firstChild!.firstChild!, 2))).toBeNull();
    root.remove();
    outside.remove();
  });

  it('plainOffsetAt returns -1 outside the root', () => {
    const root = setup('<div>a</div>');
    const other = setup('<div>b</div>');
    expect(plainOffsetAt(root, other.firstChild!.firstChild!, 0)).toBe(-1);
    root.remove();
    other.remove();
  });
});

describe('rangeFromPlainOffsets (D7b: a stored anchor selected again)', () => {
  const root = () => {
    const div = document.createElement('div');
    // Two blocks and a sign with no text, as the renderer draws them: the projection is «Primo comma.Secondo comma.».
    div.innerHTML = '<div class="vlx-b">Primo <mark>comma</mark>.</div><span class="vlx-sign"></span><div class="vlx-b">Secondo comma.</div>';
    document.body.append(div);
    return div;
  };

  it('is the inverse of plainOffsetAt, across marks and blocks', () => {
    const r = root();
    for (const [start, end] of [[0, 5], [6, 11], [6, 20], [12, 26], [3, 4]]) {
      const range = rangeFromPlainOffsets(r, start, end)!;
      expect(range.toString()).toBe('Primo comma.Secondo comma.'.slice(start, end));
      expect(plainOffsetAt(r, range.startContainer, range.startOffset)).toBe(start);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      expect(getSelectionAnchor(r, selection)).toEqual({ startOffset: start, text: 'Primo comma.Secondo comma.'.slice(start, end).trim() });
    }
    r.remove();
  });

  it('is null for a span that does not fit the text', () => {
    const r = root();
    expect(rangeFromPlainOffsets(r, 20, 40)).toBeNull();
    expect(rangeFromPlainOffsets(r, 5, 5)).toBeNull();
    expect(rangeFromPlainOffsets(r, -1, 3)).toBeNull();
    r.remove();
  });
});
