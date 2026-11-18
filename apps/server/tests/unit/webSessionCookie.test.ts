import { describe, expect, it } from 'vitest';
import { deriveCookieSecure, sessionLabel } from '../../src/auth/webSession';

describe('whether the session cookie is Secure (A.1, «Plain HTTP»)', () => {
  it('follows the first allowed origin: Secure over https, not over plain http', () => {
    expect(deriveCookieSecure(undefined, ['https://lexcraft.example', 'http://localhost:5173'])).toBe(true);
    expect(deriveCookieSecure(undefined, ['http://192.168.1.20:8080'])).toBe(false);
    expect(deriveCookieSecure(undefined, ['http://localhost:5173', 'https://other.example'])).toBe(false);
    expect(deriveCookieSecure(undefined, [])).toBe(false);
  });

  it('lets SESSION_COOKIE_SECURE override it either way, and ignores anything else', () => {
    expect(deriveCookieSecure('true', ['http://localhost:5173'])).toBe(true);
    expect(deriveCookieSecure(' FALSE ', ['https://lexcraft.example'])).toBe(false);
    expect(deriveCookieSecure('yes', ['https://lexcraft.example'])).toBe(true);
    expect(deriveCookieSecure('', ['http://localhost:5173'])).toBe(false);
  });
});

describe('the label of a session', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox su macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Chrome su Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', 'Edge su Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari su iOS'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'Chrome su Android'],
    ['curl/8.7.1', 'Browser sconosciuto'],
    [undefined, 'Browser sconosciuto'],
  ])('reads %s as «%s»', (userAgent, label) => {
    expect(sessionLabel(userAgent)).toBe(label);
  });
});
