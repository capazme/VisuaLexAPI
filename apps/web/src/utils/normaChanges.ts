import type { NormaChangeNotification } from '../services/notificationService';
import type { NormaVisitata } from '../types';
import { formatCitation } from './normaMeta';

/**
 * The norm a change notification is about, read from the snapshot the
 * server stored at detection time. `null` when the snapshot carries no
 * reopenable identity (a watch created before snapshots had `norma_data`,
 * or a malformed row): the caller then shows the message and offers no
 * "Apri" rather than opening the wrong article.
 */
export function normaFromChangeNotification(notification: NormaChangeNotification): NormaVisitata | null {
  const raw = notification.snapshot?.norma_data;
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const tipoAtto = candidate.tipo_atto;
  const articolo = candidate.numero_articolo;
  if (typeof tipoAtto !== 'string' || !tipoAtto.trim()) return null;
  if ((typeof articolo !== 'string' && typeof articolo !== 'number') || !String(articolo).trim()) return null;
  const optional = (key: string): string | undefined =>
    typeof candidate[key] === 'string' && (candidate[key] as string).trim() ? (candidate[key] as string) : undefined;
  return {
    tipo_atto: tipoAtto,
    data: optional('data') ?? '',
    numero_atto: optional('numero_atto'),
    numero_articolo: String(articolo),
    versione: optional('versione'),
    data_versione: optional('data_versione'),
    allegato: optional('allegato'),
  };
}

/** Label for the list: the citation when the snapshot allows it, else the server's message. */
export function normaChangeLabel(notification: NormaChangeNotification): string {
  const norma = normaFromChangeNotification(notification);
  return norma ? formatCitation(norma) : notification.message;
}
