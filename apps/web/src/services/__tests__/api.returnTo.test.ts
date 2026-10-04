import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUnauthenticated } from '../api';

// jsdom cannot navigate: stand in for window.location, so the redirect can be read.
const realLocation = window.location;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.setItem('access_token', 'a');
  localStorage.setItem('refresh_token', 'r');
  vi.stubGlobal('location', {
    pathname: '/sentenze/cassazione/10787/2024',
    search: '?sezione=3',
    hash: '',
    href: 'http://localhost/sentenze/cassazione/10787/2024?sezione=3',
  });
});

afterEach(() => {
  vi.stubGlobal('location', realLocation);
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe('handleUnauthenticated', () => {
  it('keeps the address the reader was on, drops the tokens and sends them to the login', () => {
    handleUnauthenticated();
    expect(sessionStorage.getItem('vlx:return-to')).toBe('/sentenze/cassazione/10787/2024?sezione=3');
    expect(window.location.href).toBe('/login');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });
});
