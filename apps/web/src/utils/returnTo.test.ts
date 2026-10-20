import { beforeEach, describe, expect, it } from 'vitest';
import { authPageTab, forgetReturnTo, isLoginPage, locationToPath, safeReturnPath, stashReturnTo, takeReturnTo } from './returnTo';

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

  it('never stashes the sign-up tab either: it is the same page', () => {
    for (const register of ['/register', '/register/', '/Register?x=1', '/%72egister']) {
      stashReturnTo(register);
      expect(takeReturnTo()).toBeNull();
    }
  });

  it('names the tab of the sign-in page a path opens, and nothing else', () => {
    expect(authPageTab('/login')).toBe('login');
    expect(authPageTab('/LOGIN//')).toBe('login');
    expect(authPageTab('/register')).toBe('register');
    expect(authPageTab('/%52egister')).toBe('register');
    expect(authPageTab('/registered')).toBeNull();
    expect(authPageTab('/dossier')).toBeNull();
    expect(authPageTab('/%E0%A4%A')).toBeNull(); // a malformed escape is read raw
    expect(isLoginPage('/register')).toBe(true);
    expect(isLoginPage('/')).toBe(false);
  });

  it('forgets the stash on request', () => {
    stashReturnTo('/dossier');
    forgetReturnTo();
    expect(takeReturnTo()).toBeNull();
  });
});
