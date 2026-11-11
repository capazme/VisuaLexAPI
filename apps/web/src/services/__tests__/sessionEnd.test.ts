import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../../test/memoryStorage';
import { BROWSER_STORAGE, OWNER_KEY, claimBrowserFor, forgetUserData, onSessionEnd } from '../sessionEnd';

function fill(): void {
  for (const e of BROWSER_STORAGE) {
    const key = e.key.replace('*', 'tab-1');
    (e.area === 'local' ? localStorage : sessionStorage).setItem(key, 'x');
  }
}

function present(kind: string): string[] {
  return BROWSER_STORAGE.filter((e) => e.kind === kind)
    .filter((e) => (e.area === 'local' ? localStorage : sessionStorage).getItem(e.key.replace('*', 'tab-1')) !== null)
    .map((e) => e.key);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('forgetUserData', () => {
  it('removes every key of the person, from both storages, and keeps the preferences of the device', () => {
    fill();
    forgetUserData();
    expect(present('user')).toEqual([]);
    expect(present('device')).toEqual(BROWSER_STORAGE.filter((e) => e.kind === 'device').map((e) => e.key));
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it('removes the Q&A thread with the assistant', () => {
    localStorage.setItem('merlt-qa-thread-v1', '[{"question":"secret"}]');
    forgetUserData();
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBeNull();
  });

  it('runs every registered reset, also after one that throws', () => {
    const first = vi.fn(() => {
      throw new Error('boom');
    });
    const second = vi.fn();
    const off1 = onSessionEnd(first);
    const off2 = onSessionEnd(second);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    forgetUserData();
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    off1();
    off2();
  });
});

describe('claimBrowserFor', () => {
  it('a different person signing in finds nothing of the previous one', () => {
    localStorage.setItem(OWNER_KEY, 'alice');
    localStorage.setItem('merlt-qa-thread-v1', 'alice’s questions');
    claimBrowserFor('bob', { signIn: true });
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBeNull();
    expect(localStorage.getItem(OWNER_KEY)).toBe('bob');
  });

  it('the same person signing in again keeps their data', () => {
    localStorage.setItem(OWNER_KEY, 'alice');
    localStorage.setItem('merlt-qa-thread-v1', 'kept');
    claimBrowserFor('alice', { signIn: true });
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBe('kept');
  });

  it('a sign-in on a browser marked by no one empties it (whose data it is is unknown)', () => {
    localStorage.setItem('merlt-qa-thread-v1', 'unknown');
    claimBrowserFor('bob', { signIn: true });
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBeNull();
  });

  it('at start-up an unmarked browser is marked, not emptied: it already holds this session', () => {
    localStorage.setItem('merlt-qa-thread-v1', 'mine');
    claimBrowserFor('alice', { signIn: false });
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBe('mine');
    expect(localStorage.getItem(OWNER_KEY)).toBe('alice');
  });

  it('at start-up a browser marked by someone else is emptied', () => {
    localStorage.setItem(OWNER_KEY, 'alice');
    localStorage.setItem('merlt-qa-thread-v1', 'alice’s');
    claimBrowserFor('bob', { signIn: false });
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBeNull();
  });
});
