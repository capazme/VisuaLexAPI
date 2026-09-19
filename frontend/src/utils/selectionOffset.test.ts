import { describe, it, expect } from 'vitest';
import { alignOffsetToTrimmedText } from './selectionOffset';

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
    // characters to the offset space (getPlainTextOffset walks textContent;
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
