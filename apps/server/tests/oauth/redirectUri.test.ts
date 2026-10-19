import { describe, expect, it } from 'vitest';
import { isRegistrableRedirectUri, matchesRedirectUri } from '../../src/oauth/redirectUri';

const ALLOW = ['https://claude.ai/api/mcp/auth_callback'];

describe('matchesRedirectUri', () => {
  it('matches a registered URI exactly', () => {
    expect(matchesRedirectUri(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
  });

  it('frees the port on a loopback address, and only the port', () => {
    const registered = ['http://127.0.0.1:1234/callback'];
    expect(matchesRedirectUri(registered, 'http://127.0.0.1:55555/callback')).toBe(true);
    expect(matchesRedirectUri(registered, 'http://127.0.0.1/callback')).toBe(true);
    expect(matchesRedirectUri(registered, 'http://127.0.0.1:55555/other')).toBe(false);
    expect(matchesRedirectUri(registered, 'http://127.0.0.1:55555/callback?x=1')).toBe(false);
    expect(matchesRedirectUri(registered, 'http://localhost:55555/callback')).toBe(false);
    expect(matchesRedirectUri(registered, 'https://127.0.0.1:55555/callback')).toBe(false);
  });

  it('never frees the port, the path or anything else on a public host', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback'];
    expect(matchesRedirectUri(registered, 'https://claude.ai:8443/api/mcp/auth_callback')).toBe(false);
    expect(matchesRedirectUri(registered, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(matchesRedirectUri(registered, 'https://claude.ai.evil.test/api/mcp/auth_callback')).toBe(false);
    expect(matchesRedirectUri(registered, 'https://claude.ai/api/mcp/auth_callback#x')).toBe(false);
  });

  it('refuses what is not a URL', () => {
    expect(matchesRedirectUri(['http://127.0.0.1/callback'], 'not a url')).toBe(false);
  });
});

describe('isRegistrableRedirectUri', () => {
  it('accepts loopback addresses on any port', () => {
    for (const uri of ['http://127.0.0.1:33418/callback', 'http://localhost:9/cb', 'http://[::1]:8080/']) {
      expect(isRegistrableRedirectUri(uri, ALLOW)).toBe(true);
    }
  });

  it('accepts an HTTPS callback only when it is on the allow-list, exactly', () => {
    expect(isRegistrableRedirectUri('https://claude.ai/api/mcp/auth_callback', ALLOW)).toBe(true);
    expect(isRegistrableRedirectUri('https://claude.ai/api/mcp/other', ALLOW)).toBe(false);
    expect(isRegistrableRedirectUri('https://evil.test/callback', ALLOW)).toBe(false);
  });

  it('refuses plain HTTP off loopback, custom schemes, fragments and credentials', () => {
    for (const uri of [
      'http://example.test/callback',
      'javascript:alert(1)',
      'myapp://callback',
      'http://127.0.0.1/callback#frag',
      'http://user:pass@127.0.0.1/callback',
    ]) {
      expect(isRegistrableRedirectUri(uri, ALLOW)).toBe(false);
    }
  });
});
