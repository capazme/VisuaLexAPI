import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Link2, ShieldAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { getErrorMessage } from '../../utils/errors';
import { connectionsService, type AuthorizationRequestView } from './connectionsService';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; request: AuthorizationRequestView }
  | { status: 'deciding'; request: AuthorizationRequestView }
  | { status: 'redirecting' }
  | { status: 'error'; message: string };

/** Only an http(s) address may receive the browser: never a script or a data URI. */
function isWebAddress(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The consent page of the authorization server (MCP spike, spec 4.2). An
 * application such as Claude Code sent the browser here through
 * `/oauth/authorize`; the user sees which application, where it sends them
 * back, that nobody verified it, and what it may do, then approves or refuses.
 * Either way the browser goes back to the application. Everything the client
 * chose (its name) is rendered as text.
 */
export function ConnectPage() {
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [allowDelete, setAllowDelete] = useState(false);

  useEffect(() => {
    if (!requestId) {
      setState({ status: 'error', message: 'Collegamento non valido: manca la richiesta. Riavvia il collegamento dall’applicazione.' });
      return;
    }
    let cancelled = false;
    connectionsService
      .getRequest(requestId)
      .then((request) => {
        if (cancelled) return;
        setAllowDelete(Boolean(request.deletion?.granted));
        setState({ status: 'ready', request });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: getErrorMessage(error) ?? 'Impossibile leggere la richiesta di collegamento.' });
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const decide = async (approve: boolean) => {
    if (state.status !== 'ready' || !requestId) return;
    setState({ status: 'deciding', request: state.request });
    try {
      const { redirectTo } = await connectionsService.decide(requestId, approve, approve && allowDelete);
      if (!isWebAddress(redirectTo)) throw new Error('Indirizzo di ritorno non valido.');
      setState({ status: 'redirecting' });
      window.location.assign(redirectTo);
    } catch (error: unknown) {
      setState({ status: 'error', message: getErrorMessage(error) ?? 'Impossibile registrare la decisione.' });
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4 py-10">
      <section
        aria-labelledby="connect-title"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      >
        <h1 id="connect-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          <Link2 size={20} aria-hidden /> Collegare un’applicazione a VisuaLex
        </h1>

        {state.status === 'loading' && <p className="mt-4 text-sm text-slate-500">Caricamento della richiesta…</p>}

        {state.status === 'redirecting' && (
          <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-300">
            Decisione registrata. Ritorno all’applicazione… Se non succede nulla, puoi chiudere questa finestra.
          </p>
        )}

        {state.status === 'error' && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{state.message}</span>
          </p>
        )}

        {(state.status === 'ready' || state.status === 'deciding') && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm text-slate-500">L’applicazione</p>
              <p className="text-base font-semibold text-slate-900 dark:text-white break-words">
                {state.request.client.name ?? 'Applicazione senza nome'}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                chiede di accedere al tuo account. Dopo la tua decisione tornerai a{' '}
                <span className="font-mono">{state.request.client.redirectHost}</span>.
              </p>
            </div>

            {state.request.client.registeredAutomatically && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  Applicazione registrata automaticamente, non verificata: il nome lo ha scelto l’applicazione stessa.
                  Autorizza solo se hai appena avviato tu il collegamento.
                </span>
              </p>
            )}

            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Potrà:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {state.request.scopes.map((scope) => (
                  <li key={scope.scope}>{scope.label}</li>
                ))}
              </ul>
            </div>

            {state.request.deletion && (
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={allowDelete}
                  onChange={(event) => setAllowDelete(event.target.checked)}
                  disabled={state.status === 'deciding'}
                />
                <span>{state.request.deletion.label}</span>
              </label>
            )}

            <p className="text-xs text-slate-500">
              Puoi revocare il collegamento, o togliergli il permesso di eliminare, in qualsiasi momento da Impostazioni → Applicazioni collegate.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => void decide(false)} disabled={state.status === 'deciding'}>
                Rifiuta
              </Button>
              <Button onClick={() => void decide(true)} loading={state.status === 'deciding'} disabled={state.status === 'deciding'}>
                Autorizza
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
