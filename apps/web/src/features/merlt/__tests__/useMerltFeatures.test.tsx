import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ---- mocks (hoisted) ----
const useConsentMock = vi.fn();
const useAuthMock = vi.fn();
const isMerltEnabledMock = vi.fn();
const isMerltGraphEnabledMock = vi.fn();

vi.mock('../consent/useConsent', () => ({ useConsent: () => useConsentMock() }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }));
vi.mock('../featureFlag', () => ({ isMerltEnabled: () => isMerltEnabledMock() }));
vi.mock('../graph/featureFlag', () => ({ isMerltGraphEnabled: () => isMerltGraphEnabledMock() }));

import { useMerltFeatures } from '../useMerltFeatures';

beforeEach(() => {
  useConsentMock.mockReturnValue({ level: 'none', canTrack: false, status: 'ready' });
  useAuthMock.mockReturnValue({ isAdmin: false });
  isMerltEnabledMock.mockReturnValue(true);
  isMerltGraphEnabledMock.mockReturnValue(true);
});

describe('useMerltFeatures (client-side derivation)', () => {
  it('full consent + admin → everything on', () => {
    useConsentMock.mockReturnValue({ level: 'full', canTrack: true, status: 'ready' });
    useAuthMock.mockReturnValue({ isAdmin: true });
    const { result } = renderHook(() => useMerltFeatures());
    expect(result.current).toMatchObject({
      merltEnabled: true,
      graphEnabled: true,
      consentLevel: 'full',
      canTrack: true,
      qaAskable: true,
      canContribute: true,
      canValidate: true,
      graphReadable: true,
      opsVisible: true,
    });
  });

  it('none consent → contribute/validate/canTrack/qaAskable false, but graph stays readable (flag-only)', () => {
    const { result } = renderHook(() => useMerltFeatures());
    expect(result.current.canContribute).toBe(false);
    expect(result.current.canValidate).toBe(false);
    // Reading the graph is free (D2): graphReadable follows the flag, not consent.
    expect(result.current.graphReadable).toBe(true);
    expect(result.current.canTrack).toBe(false);
    // Q&A needs at least `basic` (D2 ladder): none → not askable.
    expect(result.current.qaAskable).toBe(false);
    expect(result.current.opsVisible).toBe(false);
  });

  it('basic consent → graph readable + canTrack + qaAskable, but no contribution', () => {
    useConsentMock.mockReturnValue({ level: 'basic', canTrack: true, status: 'ready' });
    const { result } = renderHook(() => useMerltFeatures());
    expect(result.current.graphReadable).toBe(true);
    expect(result.current.canTrack).toBe(true);
    // D2: asking is unlocked at basic (below the teaching threshold).
    expect(result.current.qaAskable).toBe(true);
    expect(result.current.canContribute).toBe(false);
  });

  it('opsVisible follows isAdmin regardless of consent', () => {
    useAuthMock.mockReturnValue({ isAdmin: true });
    const { result } = renderHook(() => useMerltFeatures());
    expect(result.current.opsVisible).toBe(true);
  });

  it('feature flag off → all capabilities gated off', () => {
    isMerltEnabledMock.mockReturnValue(false);
    useConsentMock.mockReturnValue({ level: 'full', canTrack: true, status: 'ready' });
    useAuthMock.mockReturnValue({ isAdmin: true });
    const { result } = renderHook(() => useMerltFeatures());
    expect(result.current.merltEnabled).toBe(false);
    expect(result.current.graphEnabled).toBe(false);
    expect(result.current.canContribute).toBe(false);
    expect(result.current.graphReadable).toBe(false);
    expect(result.current.opsVisible).toBe(false);
    expect(result.current.canTrack).toBe(false);
    // qaAskable is also flag-gated: full consent cannot unlock Q&A when merlt off.
    expect(result.current.qaAskable).toBe(false);
  });

  it('graph flag off → graph capabilities off but contribution stays', () => {
    isMerltGraphEnabledMock.mockReturnValue(false);
    useConsentMock.mockReturnValue({ level: 'full', canTrack: true, status: 'ready' });
    const { result } = renderHook(() => useMerltFeatures());
    expect(result.current.graphEnabled).toBe(false);
    expect(result.current.graphReadable).toBe(false);
    expect(result.current.canContribute).toBe(true);
  });
});
