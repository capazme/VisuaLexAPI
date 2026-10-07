import { describe, expect, it } from 'vitest';
import { annotationTargetLabel } from '../annotationLabels';

describe('annotationTargetLabel', () => {
  it('names a decision by its short citation', () => {
    expect(annotationTargetLabel('cassazione:civile:99999:2024')).toBe('Cass. civ., n. 99999/2024');
  });
  it('spells a norm\'s key out as it always did', () => {
    expect(annotationTargetLabel('codice-civile--2043')).toBe('codice civile 2043');
  });
});
