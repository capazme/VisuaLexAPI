import { useEffect, useState } from 'react';
import { ArrowRight, BellRing, Check, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { notificationService, type NormaChangeNotification } from '../../../services/notificationService';
import { NORMA_NOTIFICATIONS_CHANGED_EVENT } from '../../../hooks/useForumNotifications';
import { normaChangeLabel, normaFromChangeNotification } from '../../../utils/normaChanges';
import { searchParamsFromNorma } from '../dossier/dossierUtils';
import type { SearchParams } from '../../../types';

interface NormaChangesSectionProps {
  /** Reopens the norm on the reading surface: the caller navigates and triggers the search. */
  onOpen: (params: SearchParams) => void;
}

/**
 * "Norme salvate aggiornate": the unread change notifications, listed where
 * the user already comes to find what they consulted. The badge on the
 * Cronologia entry counts these rows; "Segna come lette" clears them
 * server-side and tells the badge's poller through a window event.
 * Renders nothing while loading and when there is nothing unread.
 */
export function NormaChangesSection({ onOpen }: NormaChangesSectionProps) {
  const [notifications, setNotifications] = useState<NormaChangeNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    notificationService.getNormaChanges()
      .then(list => { if (!cancelled) setNotifications(list.filter(item => !item.readAt)); })
      .catch(err => {
        // Never hide a backend failure behind an empty section (gotcha 18).
        console.error('Failed to load norma change notifications:', err);
        if (!cancelled) setError('Impossibile caricare gli aggiornamenti delle norme salvate.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const markAllRead = async () => {
    setMarking(true);
    try {
      await notificationService.markNormaChangesRead();
      setNotifications([]);
      window.dispatchEvent(new Event(NORMA_NOTIFICATIONS_CHANGED_EVENT));
    } catch (err) {
      console.error('Failed to mark norma change notifications read:', err);
      setError('Impossibile segnare le notifiche come lette. Riprova.');
    } finally {
      setMarking(false);
    }
  };

  if (loading) return null;
  if (!error && notifications.length === 0) return null;

  return (
    <section
      aria-labelledby="norma-changes-title"
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20"
    >
      <div className="flex items-center justify-between gap-3 border-b border-amber-200/70 px-4 py-3 dark:border-amber-900/40">
        <h2 id="norma-changes-title" className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <BellRing size={18} className="text-amber-500" /> Norme salvate aggiornate
          {notifications.length > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{notifications.length}</span>
          )}
        </h2>
        {notifications.length > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={marking}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-amber-200 dark:hover:bg-amber-900/40 md:min-h-0 md:py-1.5"
          >
            {marking ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Segna come lette
          </button>
        )}
      </div>
      {error && <p role="alert" className="px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notifications.length > 0 && (
        <ul className="divide-y divide-amber-200/60 dark:divide-amber-900/40">
          {notifications.map(item => {
            const norma = normaFromChangeNotification(item);
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{normaChangeLabel(item)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Il testo è cambiato · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: it })}
                  </p>
                </div>
                {norma && (
                  <button
                    type="button"
                    onClick={() => onOpen(searchParamsFromNorma(norma))}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-medium text-primary-600 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400 dark:hover:bg-primary-900/20 md:min-h-0 md:py-1.5"
                  >
                    Apri <ArrowRight size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
