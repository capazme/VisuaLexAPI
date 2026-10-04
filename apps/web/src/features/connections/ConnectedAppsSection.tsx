import { useEffect, useState } from 'react';
import { Link2, Unplug } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
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

  const confirmRevoke = async () => {
    const app = pending;
    setPending(null);
    if (!app) return;
    try {
      await connectionsService.revoke(app.id);
      setState((current) =>
        current.status === 'ready' ? { status: 'ready', apps: current.apps.filter((a) => a.id !== app.id) } : current,
      );
      setMessage(`Collegamento con ${appName(app)} revocato.`);
    } catch (error: unknown) {
      setMessage(getErrorMessage(error) ?? 'Impossibile revocare il collegamento.');
    }
  };

  return (
    <div>
      <label className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-1.5">
        <Link2 size={12} aria-hidden /> Applicazioni collegate
      </label>
      <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
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
                  onClick={() => setPending(app)}
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
      <ConfirmDialog
        open={pending !== null}
        variant="danger"
        title="Revocare il collegamento?"
        message={
          pending
            ? `${appName(pending)} non potrà più accedere al tuo account. Per usarla di nuovo dovrai autorizzarla un’altra volta.`
            : ''
        }
        confirmLabel="Revoca"
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
