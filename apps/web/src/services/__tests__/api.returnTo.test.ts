import { describe, expect, it } from 'vitest';
import { handleUnauthenticated } from '../api';

describe('handleUnauthenticated', () => {
  it('keeps the address the reader was on before it sends them to the login', () => {
    window.history.pushState({}, '', '/sentenze/cassazione/10787/2024?sezione=3');
    handleUnauthenticated();
    expect(sessionStorage.getItem('vlx:return-to')).toBe('/sentenze/cassazione/10787/2024?sezione=3');
  });
});
