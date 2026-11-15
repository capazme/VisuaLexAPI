import { describe, expect, it } from 'vitest';
import { attiError } from './attiService';

describe('attiError', () => {
  it('keeps the server\'s Italian sentence', () => {
    expect(attiError(new Error('Atto non trovato.'), 'fallback')).toBe('Atto non trovato.');
  });
  it.each(['Not Found', 'Internal Server Error', 'Failed to fetch', 'Request failed with status code 502', ''])('never shows «%s»: the caller\'s sentence instead', (message) => {
    expect(attiError(new Error(message), 'Non è stato possibile leggere gli atti del dossier.')).toBe('Non è stato possibile leggere gli atti del dossier.');
  });
});
