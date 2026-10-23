import { describe, expect, it } from 'vitest';
import { isIOSWebKit } from '../inkMark';

// The wordmark's fallback (A3): WebKit for iOS, where every browser is WebKit, an iPad included when it says it is a Mac.
describe('isIOSWebKit', () => {
  const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

  it('knows an iPhone, an iPad and an iPod, whatever the browser', () => {
    expect(isIOSWebKit(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1', 5))).toBe(true);
    expect(isIOSWebKit(nav('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/124.0 Mobile/15E148', 5))).toBe(true);
    expect(isIOSWebKit(nav('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15', 5))).toBe(true);
  });

  it('knows an iPad with a Mac\'s user agent by its touch points, and leaves a Mac alone', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
    expect(isIOSWebKit(nav(mac, 5))).toBe(true);
    expect(isIOSWebKit(nav(mac, 0))).toBe(false);
  });

  it('leaves Chrome on Android and on a computer alone', () => {
    expect(isIOSWebKit(nav('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36', 5))).toBe(false);
    expect(isIOSWebKit(nav('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'))).toBe(false);
  });
});
