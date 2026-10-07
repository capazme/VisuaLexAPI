import { beforeEach, describe, expect, it } from 'vitest';
import { forgetReturnTo, locationToPath, safeReturnPath, stashReturnTo, takeReturnTo } from './returnTo';

beforeEach(() => sessionStorage.clear());

describe('the return address', () => {
  it('accepts only paths of the app itself', () => {
    expect(safeReturnPath('/sentenze/cassazione/99999/2024?sezione=3')).toBe('/sentenze/cassazione/99999/2024?sezione=3');
    for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/..//x', '/.//x', '/a/..//x', '?x', '#x', '', null, 42]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });

  it('normalises a backslash inside a path instead of refusing it', () => {
    expect(safeReturnPath('/a\\b')).toBe('/a/b');
    expect(safeReturnPath('/.%2e/x')).toBe('/x');
  });

  it('keeps the query and the fragment of a router location', () => {
    expect(locationToPath({ pathname: '/', search: '?norma=abc', hash: '#x' })).toBe('/?norma=abc#x');
    expect(locationToPath(undefined)).toBeNull();
  });

  it('a stashed address is read once', () => {
    stashReturnTo('/sentenze/corte-costituzionale/1/2014');
    expect(takeReturnTo()).toBe('/sentenze/corte-costituzionale/1/2014');
    expect(takeReturnTo()).toBeNull();
  });

  it('never stashes the login page or a foreign address', () => {
    stashReturnTo('/login');
    stashReturnTo('//evil.example');
    expect(takeReturnTo()).toBeNull();
  });

  it('never stashes the login page, with a slash, a query or a fragment after it', () => {
    for (const login of ['/login/', '/login#x', '/login?next=/x', '/LOGIN', '/login//', '/%6cogin']) {
      stashReturnTo(login);
      expect(takeReturnTo()).toBeNull();
    }
  });

  it('forgets the stash on request', () => {
    stashReturnTo('/dossier');
    forgetReturnTo();
    expect(takeReturnTo()).toBeNull();
  });
});
