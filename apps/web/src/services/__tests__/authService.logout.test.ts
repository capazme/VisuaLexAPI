import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

import { logout } from '../authService';

const realLocation = window.location;

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('location', { pathname: '/dossier', search: '', hash: '', href: 'http://localhost/dossier' });
});

afterEach(() => {
  vi.stubGlobal('location', realLocation);
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe('logout', () => {
  it('forgets the address kept for the next login, drops the tokens and goes to the login', () => {
    localStorage.setItem('access_token', 'a');
    localStorage.setItem('refresh_token', 'r');
    sessionStorage.setItem('vlx:return-to', '/sentenze/cassazione/99999/2024');
    logout();
    expect(sessionStorage.getItem('vlx:return-to')).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(window.location.href).toBe('/login');
  });
});
