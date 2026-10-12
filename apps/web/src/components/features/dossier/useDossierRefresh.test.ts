import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import { REFRESH_MIN_INTERVAL_MS, REFRESH_POLL_MS, useDossierRefresh } from './useDossierRefresh';

const refreshDossier = vi.fn(async () => {});
const refreshDossiers = vi.fn(async () => {});
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  appStore.setState({ refreshDossier, refreshDossiers });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useDossierRefresh', () => {
  it('reads the open dossier again, quietly, when the window comes back into focus', () => {
    const onRefresh = vi.fn();
    renderHook(() => useDossierRefresh('d1', onRefresh));
    vi.advanceTimersByTime(REFRESH_MIN_INTERVAL_MS);
    window.dispatchEvent(new Event('focus'));
    expect(refreshDossier).toHaveBeenCalledWith('d1', { quiet: true });
    expect(refreshDossiers).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('reads the list when no dossier is open, on coming into view, leaving the trash its own read', () => {
    const onRefresh = vi.fn();
    renderHook(() => useDossierRefresh(null, onRefresh));
    vi.advanceTimersByTime(REFRESH_MIN_INTERVAL_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refreshDossiers).toHaveBeenCalledOnce();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('polls every minute while visible, and never while hidden', () => {
    renderHook(() => useDossierRefresh('d1'));
    vi.advanceTimersByTime(REFRESH_POLL_MS);
    expect(refreshDossier).toHaveBeenCalledTimes(1);
    visibility = 'hidden';
    vi.advanceTimersByTime(REFRESH_POLL_MS * 3);
    expect(refreshDossier).toHaveBeenCalledTimes(1);
  });

  it('reads at most once in the window, whatever triggered it, and not right after mounting', () => {
    renderHook(() => useDossierRefresh('d1'));
    window.dispatchEvent(new Event('focus'));
    expect(refreshDossier).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REFRESH_MIN_INTERVAL_MS);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refreshDossier).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the page goes', () => {
    const { unmount } = renderHook(() => useDossierRefresh('d1'));
    unmount();
    vi.advanceTimersByTime(REFRESH_POLL_MS * 2);
    window.dispatchEvent(new Event('focus'));
    expect(refreshDossier).not.toHaveBeenCalled();
  });
});
