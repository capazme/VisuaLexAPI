/**
 * Version check configuration
 */

// LocalStorage key for last seen version
export const VERSION_STORAGE_KEY = 'visualex_last_seen_version';

// SessionStorage key for throttling checks
export const VERSION_CHECK_SESSION_KEY = 'visualex_version_last_check';

// Minimum interval between version checks (ms)
export const VERSION_CHECK_THROTTLE = 5000;

// API endpoint for version info
export const VERSION_API_ENDPOINT = '/version';

// Fetch timeout (ms)
export const VERSION_FETCH_TIMEOUT = 5000;

/**
 * Changelog entry from the API
 */
export interface ChangelogEntry {
  hash: string;
  message: string;
  date: string;
  author: string;
}

/**
 * Version info response from GET /version
 */
export interface VersionInfo {
  version: string;
  git?: {
    branch: string;
    commit: {
      hash: string;
      hash_full: string;
      message: string;
      date: string;
      author: string;
    };
  };
  changelog: ChangelogEntry[];
}

/**
 * Compare two semantic versions
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}
