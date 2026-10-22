import { useEffect, useState, useRef } from 'react';
import { Link2, Unplug } from 'lucide-react';
import { WireConfirm } from '../../components/ui/wireConfirm/WireConfirm';
import { getErrorMessage } from '../../utils/errors';
import { connectionsService, type ConnectedApp } from './connectionsService';

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; apps: ConnectedApp[] }
  | { status: 'error'; message: string };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const appName = (app: ConnectedApp) => app.clientName ?? 'Applicazione senza nome';

/**
 * The settings section that lists the applications the user connected through
 * the authorization server (Claude Code, for one) and revokes one. A
 * revocation takes effect on the application's next call.
 */
export function ConnectedAppsSection() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [pending, setPending] = useState<ConnectedApp | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The connection whose permission is being changed: its switch waits, so what it shows is what the server holds.
  const [switching, setSwitching] = useState<string | null>(null);
  // The apps revoked whose rows wait for their «Revocata ✓» to go, oldest first (two revoked in a row each go when
  // theirs has been said), and the «Revoca» a confirmation was drawn from (K1b).
  const revokedQueue = useRef<string[]>([]);
  const [revoked, setRevoked] = useState<string[]>([]);
  // The app the confirmation names, kept while it leaves (its words do not empty under the rewind).
  const [shownApp, setShownApp] = useState<ConnectedApp | null>(null);
  const [revokeFrom, setRevokeFrom] = useState<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    connectionsService
      .listConnectedApps()
      .then((apps) => !cancelled && setState({ status: 'ready', apps }))
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: getErrorMessage(error) ?? 'Impossibile caricare le applicazioni collegate.' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleDelete = async (app: ConnectedApp) => {
    if (switching) return;
    const canDelete = !app.canDelete;
    const set = (value: boolean) =>
      setState((current) =>
        current.status === 'ready'
          ? { status: 'ready', apps: current.apps.map((a) => (a.id === app.id ? { ...a, canDelete: value } : a)) }
          : current,
      );
    set(canDelete);
    setSwitching(app.id);
    try {
      await connectionsService.setCanDelete(app.id, canDelete);
      setMessage(
        canDelete
          ? `${appName(app)} ora può eliminare: ogni eliminazione ti chiederà conferma e finirà nel cestino per 30 giorni.`
          : `${appName(app)} non può più eliminare.`,
      );
    } catch (error: unknown) {
      set(app.canDelete);
      setMessage(getErrorMessage(error) ?? 'Impossibile cambiare il permesso.');
    } finally {
      setSwitching(null);
    }
  };

  /** The revocation; «Revoca» says «Revocata» with its tick, and the row goes once it has said it (`dropRevoked`). */
  const confirmRevoke = async (): Promise<string | null> => {
    const app = pending;
    setPending(null);
    if (!app) return null;
    try {
      await connectionsService.revoke(app.id);
      setMessage(`Collegamento con ${appName(app)} revocato.`);
      revokedQueue.current.push(app.id);
      setRevoked([...revokedQueue.current]);
      return 'Revocata';
    } catch (error: unknown) {
      setMessage(getErrorMessage(error) ?? 'Impossibile revocare il collegamento.');
      return null;
    }
  };

  // The revoked app's row goes; the focus it held goes to the next app's «Revoca», else to the list's box.
  const dropRevoked = () => {
    const id = revokedQueue.current.shift();
    if (!id) return;
    setRevoked([...revokedQueue.current]);
    const holder = listRef.current;
    const buttons = [...(holder?.querySelectorAll<HTMLButtonElement>('[data-revoke]') ?? [])];
    const at = buttons.findIndex((b) => b.dataset.revoke === id);
    const lost = holder?.contains(document.activeElement) || document.activeElement === document.body;
    setState((current) =>
      current.status === 'ready' ? { status: 'ready', apps: current.apps.filter((a) => a.id !== id) } : current,
    );
    if (lost) (buttons[at + 1] ?? buttons[at - 1] ?? holder)?.focus({ preventScroll: true });
  };

  return (
    <div>
      <label className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-1.5">
        <Link2 size={12} aria-hidden /> Applicazioni collegate
      </label>
      <div ref={listRef} tabIndex={-1} className="space-y-3 rounded-xl border border-slate-200 p-3 focus:outline-none dark:border-slate-700">
        {state.status === 'loading' && <p className="text-xs text-slate-500">Caricamento…</p>}
        {state.status === 'error' && <p className="text-xs text-red-600">{state.message}</p>}
        {state.status === 'ready' && state.apps.length === 0 && (
          <p className="text-xs text-slate-500">Nessuna applicazione collegata al tuo account.</p>
        )}
        {state.status === 'ready' && state.apps.length > 0 && (
          <ul className="space-y-2">
            {state.apps.map((app) => (
              <li key={app.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 break-words">{appName(app)}</p>
                  <p className="text-xs text-slate-500">Collegata il {formatDate(app.createdAt)}</p>
                  <p className="text-xs text-slate-500">
                    {app.lastUsedAt ? `Ultimo uso: ${formatDate(app.lastUsedAt)}` : 'Mai usata'}
                  </p>
                  <label className="mt-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={app.canDelete}
                      disabled={switching === app.id}
                      onChange={() => void toggleDelete(app)}
                    />
                    Può eliminare dossier, voci e schede
                  </label>
                </div>
                <button
                  type="button"
                  data-revoke={app.id}
                  // Revoked, it waits for its tick to go: no second revocation meanwhile.
                  disabled={revoked.includes(app.id)}
                  onClick={(event) => {
                    setRevokeFrom(event.currentTarget);
                    setPending(app);
                    setShownApp(app);
                  }}
                  aria-label={`Revoca ${appName(app)}`}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300"
                >
                  <Unplug size={14} aria-hidden /> Revoca
                </button>
              </li>
            ))}
          </ul>
        )}
        {message && <p role="status" className="text-xs text-slate-500">{message}</p>}
      </div>
      {/* The app loses its access at once: drawn from its button (K1b). */}
      <WireConfirm
        open={pending !== null}
        variant="danger"
        title="Revocare il collegamento?"
        message={
          shownApp
            ? `${appName(shownApp)} non potrà più accedere al tuo account. Per usarla di nuovo dovrai autorizzarla un’altra volta.`
            : ''
        }
        confirmLabel="Revoca"
        onConfirm={confirmRevoke}
        origin={revokeFrom}
        onOutcomeDone={dropRevoked}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
