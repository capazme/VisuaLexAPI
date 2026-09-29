import { describe, it, expect } from 'vitest';
import { getTransformOrigin } from './floatingOrigin';

describe('getTransformOrigin', () => {
  it('grows a popover from the edge that faces its anchor', () => {
    expect(getTransformOrigin('bottom-end')).toBe('right top');
    expect(getTransformOrigin('top-start')).toBe('left bottom');
    expect(getTransformOrigin('right-start')).toBe('left top');
    expect(getTransformOrigin('top')).toBe('center bottom');
  });
});
