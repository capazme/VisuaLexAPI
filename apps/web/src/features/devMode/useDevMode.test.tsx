import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const auth = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth() }));

import { useDevMode } from './useDevMode';

describe('useDevMode', () => {
  it('is the effective flag of the account', () => {
    auth.mockReturnValue({ devMode: true });
    expect(renderHook(() => useDevMode()).result.current).toBe(true);
    auth.mockReturnValue({ devMode: false });
    expect(renderHook(() => useDevMode()).result.current).toBe(false);
  });
});
