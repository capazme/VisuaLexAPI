import { describe, expect, it } from 'vitest';
import {
  DOCTRINE_ATTRIBUTION,
  DOCTRINE_LABEL,
  DOCTRINE_SOURCE_NAME,
  LATIN_MAXIMS_LABEL,
} from './doctrineLabel';

describe('doctrine labels', () => {
  it('names the layer "Dottrina" and the maxims "Locuzioni latine"', () => {
    expect(DOCTRINE_LABEL).toBe('Dottrina');
    expect(LATIN_MAXIMS_LABEL).toBe('Locuzioni latine');
  });

  it('credits the source by name', () => {
    expect(DOCTRINE_SOURCE_NAME).toBe('Brocardi.it');
    expect(DOCTRINE_ATTRIBUTION).toBe('Fonte: Brocardi.it');
  });
});
