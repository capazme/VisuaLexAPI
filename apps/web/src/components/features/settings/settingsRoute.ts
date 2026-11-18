import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';

/** Impostazioni as a page of its own (LC84, L-73): its address, each part an anchor on it (`/impostazioni#dati`). */
export const SETTINGS_PATH = '/impostazioni';

/** What the page keeps in the history's state: where it was opened from, for «Indietro» and Esc to go back there. */
export interface SettingsState {
  settingsFrom?: string;
}

/**
 * Opens Impostazioni at a part (or its top), from anywhere: a request in the store, which `useSettingsRequests` turns
 * into the navigation. The callers need no router (a reader's gear is drawn alone in its tests, and in the old dialogs').
 */
export function useOpenSettings() {
  return useAppStore((s) => s.openSettings);
}

/**
 * Goes to Impostazioni when it is asked for (mounted once, by `Layout`), remembering the page it leaves. Already on it,
 * the anchor changes in place (`replace`), so «Indietro» still goes back to the page it was opened from.
 */
export function useSettingsRequests() {
  const request = useAppStore((s) => s.settingsRequest);
  const clear = useAppStore((s) => s.clearSettingsRequest);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!request) return;
    clear();
    const to = { pathname: SETTINGS_PATH, hash: request.section ? `#${request.section}` : '' };
    if (location.pathname === SETTINGS_PATH) navigate(to, { replace: true, state: location.state });
    else navigate(to, { state: { settingsFrom: location.pathname + location.search + location.hash } satisfies SettingsState });
  }, [request, clear, navigate, location]);
}
