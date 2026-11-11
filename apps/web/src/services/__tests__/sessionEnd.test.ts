import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../../test/memoryStorage';
import { BROWSER_STORAGE, OWNER_KEY, UNKNOWN_OWNER, claimBrowserFor, forgetUserData, onSessionEnd, parkedKey } from '../sessionEnd';

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

const practices = (ids: string[]) =>
  JSON.stringify({ state: { settings: { theme: 'dark' }, practices: ids.map((id) => ({ id })), activePracticeId: ids[0] ?? null }, version: 1 });
const savedPractices = () => (JSON.parse(localStorage.getItem('visualex-storage') ?? '{}').state?.practices ?? []).map((p: { id: string }) => p.id);

describe('forgetUserData', () => {
  it('removes the copies of server data, keeps the device, and parks the only copy of the work under its owner', () => {
    fill();
    localStorage.setItem(OWNER_KEY, 'alice');
    forgetUserData();
    expect(present('user')).toEqual([]);
    expect(present('only-copy')).toEqual([]);
    expect(present('device')).toEqual(BROWSER_STORAGE.filter((e) => e.kind === 'device').map((e) => e.key));
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
    const parked = JSON.parse(localStorage.getItem(parkedKey('alice'))!);
    expect(Object.keys(parked.keys)).toEqual(
      expect.arrayContaining(['local:merlt-qa-thread-v1', 'local:visualex-storage.v0-backup']),
    );
  });

  it('never deletes the practices: they are parked, then given back to the same person at sign-in', () => {
    localStorage.setItem(OWNER_KEY, 'alice');
    localStorage.setItem('visualex-storage', practices(['p1', 'p2']));
    localStorage.setItem('merlt-qa-thread-v1', '[{"q":"alice"}]');
    // what the store's own reset does on a session end
    const off = onSessionEnd(() => localStorage.setItem('visualex-storage', practices([])));
    forgetUserData();
    off();
    expect(savedPractices()).toEqual([]);
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBeNull();

    claimBrowserFor('alice', { signIn: true });
    expect(savedPractices()).toEqual(['p1', 'p2']);
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBe('[{"q":"alice"}]');
    expect(localStorage.getItem(parkedKey('alice'))).toBeNull();
  });

  it('a second session end with nothing new keeps what was parked before', () => {
    localStorage.setItem(OWNER_KEY, 'alice');
    localStorage.setItem('visualex-storage', practices(['p1']));
    forgetUserData();
    localStorage.setItem(OWNER_KEY, 'alice');
    localStorage.setItem('visualex-storage', practices([]));
    forgetUserData();
    expect(JSON.parse(localStorage.getItem(parkedKey('alice'))!).store.practices).toEqual([{ id: 'p1' }]);
  });

  it('parks under «unknown» when the browser has no owner mark, and never gives that back automatically', () => {
    localStorage.setItem('visualex-storage', practices(['p1']));
    forgetUserData();
    expect(localStorage.getItem(parkedKey(UNKNOWN_OWNER))).not.toBeNull();
  });

  it('removes the Q&A thread from the app’s sight', () => {
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
  it('a different person signing in sees nothing of the previous one, whose work is parked, not deleted', () => {
    localStorage.setItem(OWNER_KEY, 'alice');
    localStorage.setItem('visualex-storage', practices(['a1']));
    localStorage.setItem('merlt-qa-thread-v1', 'alice’s questions');
    const off = onSessionEnd(() => localStorage.setItem('visualex-storage', practices([])));
    claimBrowserFor('bob', { signIn: true });
    off();
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBeNull();
    expect(savedPractices()).toEqual([]);
    expect(localStorage.getItem(OWNER_KEY)).toBe('bob');
    expect(JSON.parse(localStorage.getItem(parkedKey('alice'))!).store.practices).toEqual([{ id: 'a1' }]);

    // Alice comes back: she finds her work, Bob's stays parked for him
    localStorage.setItem('visualex-storage', practices(['b1']));
    const off2 = onSessionEnd(() => localStorage.setItem('visualex-storage', practices([])));
    claimBrowserFor('alice', { signIn: true });
    off2();
    expect(savedPractices()).toEqual(['a1']);
    expect(JSON.parse(localStorage.getItem(parkedKey('bob'))!).store.practices).toEqual([{ id: 'b1' }]);
  });

  it('the same person signing in again keeps their data', () => {
    localStorage.setItem(OWNER_KEY, 'alice');
    localStorage.setItem('merlt-qa-thread-v1', 'kept');
    claimBrowserFor('alice', { signIn: true });
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBe('kept');
  });

  it('an unmarked browser (from before the mark) is adopted, not emptied: its work is not hidden from its person', () => {
    localStorage.setItem('merlt-qa-thread-v1', 'mine');
    claimBrowserFor('alice', { signIn: true });
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
