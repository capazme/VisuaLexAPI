import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { resolveTheme, useResolvedTheme } from './useResolvedTheme';

describe('resolveTheme', () => {
  it('keeps a fixed choice and follows the system for «di sistema»', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('useResolvedTheme', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns with the system while «di sistema» is chosen', () => {
    let listener: (() => void) | null = null;
    const query = { matches: false, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => query));
    const { result } = renderHook(() => useResolvedTheme('system'));
    expect(result.current).toBe('light');
    act(() => { query.matches = true; listener?.(); });
    expect(result.current).toBe('dark');
  });
});
