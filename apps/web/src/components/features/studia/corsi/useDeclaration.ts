import { useCallback, useEffect, useState } from 'react';
import { notify } from '../../../ui/notifications/notifications';
import { corsiErrorDetail, corsiService } from '../../../../services/corsiService';
import type { TestoCorrente } from '../../../../types/studia';

export type DeclarationState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; text: TestoCorrente };

/**
 * The declaration on one's study material (`MATERIALE_STUDIO`, courses spec §12): accepted once in «Percorsi» before the
 * first course, since the assistant's creating tool refuses until then. Every word is the server's version. Accepting
 * answers the text accepted, or — when a newer version came meanwhile — that version, shown unticked to be read again
 * (`AcceptTextDialog`).
 */
export function useDeclaration() {
  const [state, setState] = useState<DeclarationState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let live = true;
    corsiService.declaration().then(
      (text) => live && setState({ status: 'ready', text }),
      (error: unknown) => {
        if (!live) return;
        console.warn('[Percorsi] declaration read failed', error);
        setState((previous) => (previous.status === 'ready' ? previous : { status: 'error' }));
      },
    );
    return () => {
      live = false;
    };
  }, [reads]);

  const reload = useCallback(() => setReads((n) => n + 1), []);

  /** True once accepted; false when a newer version replaced the one shown, or the acceptance failed. */
  const accept = useCallback(async (testoId: string): Promise<boolean> => {
    setBusy(true);
    try {
      const outcome = await corsiService.acceptDeclaration(testoId);
      if ('accettata' in outcome) {
        setState({ status: 'ready', text: { ...outcome.accettata, accettata: true } });
        return true;
      }
      setState({ status: 'ready', text: { ...outcome.richiedeTesto, accettata: false } });
      return false;
    } catch (error) {
      notify({ type: 'error', message: corsiErrorDetail(error, 'Dichiarazione non registrata: riprova.'), duration: 5000 });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, accept, reload };
}
