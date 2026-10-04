import { beforeEach, describe, expect, it } from 'vitest';
import { locationToPath, safeReturnPath, stashReturnTo, takeReturnTo } from './returnTo';

beforeEach(() => sessionStorage.clear());

describe('the return address', () => {
  it('accepts only paths of the app itself', () => {
    expect(safeReturnPath('/sentenze/cassazione/10787/2024?sezione=3')).toBe('/sentenze/cassazione/10787/2024?sezione=3');
    for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', null, 42]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
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
});
