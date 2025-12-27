import { useState, useEffect, useCallback } from 'react';
import {
  VERSION_STORAGE_KEY,
  VERSION_CHECK_SESSION_KEY,
  VERSION_CHECK_THROTTLE,
  VERSION_API_ENDPOINT,
  VERSION_FETCH_TIMEOUT,
  compareVersions,
  type VersionInfo,
  type ChangelogEntry,
} from '../config/versionConfig';

interface UseVersionCheckState {
  currentVersion: string | null;
  hasNewVersion: boolean;
  changelog: ChangelogEntry[];
  isLoading: boolean;
  error: string | null;
}

interface UseVersionCheckReturn extends UseVersionCheckState {
  dismissNotification: () => void;
  showChangelog: boolean;
  setShowChangelog: (show: boolean) => void;
}

/**
 * Hook to check for new app versions and manage changelog notifications
 *
 * Behavior:
 * - Fetches /version on mount
 * - First visit: saves version silently (no notification)
 * - New version detected: sets hasNewVersion = true
 * - dismissNotification: saves current version to localStorage
 * - Throttled: won't check more than once per session within throttle window
 */
export function useVersionCheck(): UseVersionCheckReturn {
  const [state, setState] = useState<UseVersionCheckState>({
    currentVersion: null,
    hasNewVersion: false,
    changelog: [],
    isLoading: true,
    error: null,
  });

  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    // Throttle: don't check if we recently checked in this session
    const lastCheck = sessionStorage.getItem(VERSION_CHECK_SESSION_KEY);
    if (lastCheck && Date.now() - Number(lastCheck) < VERSION_CHECK_THROTTLE) {
      setState((s) => ({ ...s, isLoading: false }));
      return;
    }

    const controller = new AbortController();

    fetch(VERSION_API_ENDPOINT, {
      signal: AbortSignal.timeout(VERSION_FETCH_TIMEOUT),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch version');
        return res.json() as Promise<VersionInfo>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;

        const lastSeenVersion = localStorage.getItem(VERSION_STORAGE_KEY);

        // First visit: save version silently, no notification
        if (!lastSeenVersion) {
          localStorage.setItem(VERSION_STORAGE_KEY, data.version);
          setState({
            currentVersion: data.version,
            hasNewVersion: false,
            changelog: data.changelog || [],
            isLoading: false,
            error: null,
          });
          return;
        }

        // Compare versions
        const isNewer = compareVersions(data.version, lastSeenVersion) > 0;

        setState({
          currentVersion: data.version,
          hasNewVersion: isNewer,
          changelog: data.changelog || [],
          isLoading: false,
          error: null,
        });

        // Mark check time
        sessionStorage.setItem(VERSION_CHECK_SESSION_KEY, String(Date.now()));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;

        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      });

    return () => {
      controller.abort();
    };
  }, []);

  const dismissNotification = useCallback(() => {
    if (state.currentVersion) {
      localStorage.setItem(VERSION_STORAGE_KEY, state.currentVersion);
    }
    setState((s) => ({ ...s, hasNewVersion: false }));
    setShowChangelog(false);
  }, [state.currentVersion]);

  return {
    ...state,
    dismissNotification,
    showChangelog,
    setShowChangelog,
  };
}
