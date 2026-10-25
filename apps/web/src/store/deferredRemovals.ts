import { closeNotification, notify, RESTORED_MS, UNDO_MS } from '../components/ui/notifications/notifications';
import { getFreshAccessToken } from '../services/api';
import { getAccessToken } from '../services/authService';

// As `apiClient`'s base: the exit's removal is a plain `fetch`.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface Pending {
  /** Sends the removal now: by `apiClient`, or as the page goes by a `keepalive` fetch. */
  send: (onExit?: boolean) => void;
}

/** Removals waiting behind «Annulla», by what they remove (`highlight:<id>`, `annotation:<id>`). */
const pending = new Map<string, Pending>();

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const { send } of [...pending.values()]) send(true);
  });
}

/** Still waiting behind «Annulla»: a reading meanwhile must not draw it back (the server still has it). */
export function isRemovalPending(key: string): boolean {
  return pending.has(key);
}

export interface DeferredRemoval {
  /** `highlight:<id>`: what it removes, unique. */
  key: string;
  /** What the notification says: «Evidenziazione rimossa». */
  message: string;
  /** The API path of the removal (`/highlights/<id>`), for the exit's request. */
  path: string;
  /** The removal itself, through `apiClient`. */
  remove: () => Promise<void>;
  /** «Annulla», or a refused removal: puts it back where it was. */
  putBack: () => void;
  /** A refused removal, put back: says so (the caller's words). */
  onRefused: (error: unknown) => void;
}

/**
 * A removal behind «Annulla» (the D7b bin's pattern, `assistantProposals.removeProposal`): the caller has taken the
 * item off the screen; the notification offers «Annulla» for `UNDO_MS`; the removal is sent when the notification
 * closes, or at once as the page goes (`pagehide`, a `keepalive` fetch with a token refreshed now, since that fetch
 * cannot refresh it). «Annulla» puts it back and sends nothing, then says «Ripristinato»; a refused removal puts it back
 * and says why; one the server no longer has (404) is a removal done. At logout nothing is sent: `clearUserData` drops
 * every notification (`dropped`), which forgets what it held.
 */
export function removeWithUndo({ key, message, path, remove, putBack, onRefused }: DeferredRemoval): void {
  void getFreshAccessToken().catch(() => null);
  let settled = false;
  let notification: number | null = null;
  const send = (onExit = false) => {
    if (settled) return;
    settled = true;
    pending.delete(key);
    if (notification !== null) closeNotification(notification, 'external');
    if (onExit) {
      const token = getAccessToken();
      void fetch(`${API_BASE_URL}${path}`, {
        method: 'DELETE',
        keepalive: true,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {});
      return;
    }
    remove().catch((error: unknown) => {
      // Already gone from the server: what was wanted.
      if ((error as { status?: number } | null)?.status === 404) return;
      putBack();
      onRefused(error);
    });
  };
  pending.set(key, { send });
  notification = notify({
    type: 'info',
    message,
    duration: UNDO_MS,
    onUndo: () => {
      if (settled) return;
      settled = true;
      pending.delete(key);
      putBack();
      notify({ type: 'success', message: 'Ripristinato', duration: RESTORED_MS, after: notification ?? undefined });
    },
    onClose: (reason) => {
      // Dropped at logout: forgotten, so the page going later sends nothing either.
      if (reason === 'dropped') pending.delete(key);
      else if (reason !== 'undo') send();
    },
  });
}
