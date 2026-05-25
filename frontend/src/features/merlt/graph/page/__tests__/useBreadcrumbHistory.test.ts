import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBreadcrumbHistory, BREADCRUMB_STORAGE_KEY } from '../useBreadcrumbHistory';

beforeEach(() => {
  sessionStorage.clear();
});

describe('useBreadcrumbHistory', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useBreadcrumbHistory());
    expect(result.current.entries).toEqual([]);
  });

  it('appends entries and persists to sessionStorage', () => {
    const { result } = renderHook(() => useBreadcrumbHistory());
    act(() => result.current.push({ urn: 'a', label: 'A' }));
    expect(result.current.entries).toEqual([{ urn: 'a', label: 'A' }]);
    expect(JSON.parse(sessionStorage.getItem(BREADCRUMB_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  it('does not duplicate the same urn consecutively (updates label in place)', () => {
    const { result } = renderHook(() => useBreadcrumbHistory());
    act(() => result.current.push({ urn: 'a', label: 'A' }));
    act(() => result.current.push({ urn: 'a', label: 'A bis' }));
    expect(result.current.entries).toEqual([{ urn: 'a', label: 'A bis' }]);
  });

  it('caps the history at 5, keeping the most recent', () => {
    const { result } = renderHook(() => useBreadcrumbHistory());
    act(() => {
      for (let i = 1; i <= 6; i++) result.current.push({ urn: `u${i}`, label: `L${i}` });
    });
    expect(result.current.entries).toHaveLength(5);
    expect(result.current.entries[0].urn).toBe('u2');
    expect(result.current.entries[4].urn).toBe('u6');
  });

  it('hydrates from sessionStorage on mount', () => {
    sessionStorage.setItem(
      BREADCRUMB_STORAGE_KEY,
      JSON.stringify([{ urn: 'x', label: 'X' }])
    );
    const { result } = renderHook(() => useBreadcrumbHistory());
    expect(result.current.entries).toEqual([{ urn: 'x', label: 'X' }]);
  });
});
