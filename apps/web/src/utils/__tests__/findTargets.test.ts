import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRootsFor, registerFindRoot, subscribeFindRoots } from '../findTargets';

const unregisterFns: Array<() => void> = [];
function register(tabId: string, targetKey: string, label: string, element: HTMLElement): () => void {
  const unregister = registerFindRoot({ tabId, targetKey, label, element });
  unregisterFns.push(unregister);
  return unregister;
}

afterEach(() => {
  while (unregisterFns.length) unregisterFns.pop()?.();
  document.body.innerHTML = '';
});

describe('registerFindRoot / findRootsFor', () => {
  it('answers a displayed root', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    register('tab-1', 'art--1|vigente|', 'art. 1', el);
    expect(findRootsFor('tab-1')).toEqual([
      { id: expect.any(Number), tabId: 'tab-1', targetKey: 'art--1|vigente|', label: 'art. 1', element: el },
    ]);
  });

  it('does not answer a root whose own computed display is none', () => {
    const el = document.createElement('div');
    el.style.display = 'none';
    document.body.appendChild(el);
    register('tab-1', 'art--1|vigente|', 'art. 1', el);
    expect(findRootsFor('tab-1')).toEqual([]);
  });

  it('does not answer a root under a hidden ancestor, even though its own computed display is not none', () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'hidden-wrapper';
    const el = document.createElement('div');
    wrapper.appendChild(el);
    document.body.appendChild(wrapper);
    const style = document.createElement('style');
    style.textContent = '.hidden-wrapper { display: none; }';
    document.head.appendChild(style);
    try {
      register('tab-1', 'art--1|vigente|', 'art. 1', el);
      expect(findRootsFor('tab-1')).toEqual([]);
    } finally {
      style.remove();
    }
  });

  it('does not answer a root detached from the document', () => {
    const el = document.createElement('div'); // never appended
    register('tab-1', 'art--1|vigente|', 'art. 1', el);
    expect(findRootsFor('tab-1')).toEqual([]);
  });

  it('removes a root once unregistered', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const unregister = register('tab-1', 'art--1|vigente|', 'art. 1', el);
    expect(findRootsFor('tab-1')).toHaveLength(1);
    unregister();
    expect(findRootsFor('tab-1')).toEqual([]);
  });

  it('keeps two registrations of the same key apart, answering only the displayed one (desktop/phone twins)', () => {
    const desktop = document.createElement('div');
    desktop.style.display = 'none'; // e.g. the phone breakpoint is current
    const phone = document.createElement('div');
    document.body.append(desktop, phone);
    register('tab-1', 'cassazione:civile:1:2024', 'Cass. civ. 1/2024', desktop);
    register('tab-1', 'cassazione:civile:1:2024', 'Cass. civ. 1/2024', phone);
    expect(findRootsFor('tab-1')).toEqual([
      { id: expect.any(Number), tabId: 'tab-1', targetKey: 'cassazione:civile:1:2024', label: 'Cass. civ. 1/2024', element: phone },
    ]);
  });

  it('filters by tabId, and answers every tab with none given', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    register('tab-1', 'k1', 'l1', a);
    register('tab-2', 'k2', 'l2', b);
    expect(findRootsFor('tab-1').map((r) => r.tabId)).toEqual(['tab-1']);
    expect(findRootsFor().map((r) => r.tabId).sort()).toEqual(['tab-1', 'tab-2']);
  });
});

describe('subscribeFindRoots', () => {
  it('notifies on register and on unregister, and stops once unsubscribed', () => {
    const listener = vi.fn();
    const stop = subscribeFindRoots(listener);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const unregister = register('tab-1', 'k', 'l', el);
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    register('tab-1', 'k', 'l', el);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
