/**
 * The dossiers of an environment published to the Forum, their entries rebuilt from closed values
 * before they are stored: norms through `schemas/normEntry.ts`, decisions through
 * `schemas/decisionItem.ts` (the label recomputed), notes as plain text of at most the length a
 * note in a dossier may have. Whoever applies the environment has those entries cited to them —
 * on the web, in the MCP reads and in the MCP deletion dialog — so no text the publisher wrote
 * may reach a citation. An entry that cannot be rebuilt, or of a type the app does not know,
 * refuses the publication (or its update, or the restoring of an older version) with an Italian
 * message naming the dossier, the entry and why (owner's decisions, 6 and 7 October 2026). The
 * web app rebuilds them again when an environment is applied (`validateImportedDossier`):
 * environments published before this check, files and share links come that way.
 */
import { AppError } from '../middleware/errorHandler';
import { MAX_NOTE_LENGTH } from '../controllers/dossierController';
import { rebuildDecisionEntry } from '../schemas/decisionItem';
import { rebuildNormEntry } from '../schemas/normEntry';

const shown = (value: string): string => (value.length > 60 ? `${value.slice(0, 60)}…` : value);

export function rebuildEnvironmentDossiers(dossiers: unknown[], action: 'pubblicato' | 'aggiornato' | 'ripristinato'): unknown[] {
  return dossiers.map((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
    const dossier = raw as { title?: unknown; items?: unknown };
    if (!Array.isArray(dossier.items)) return raw;
    const title = typeof dossier.title === 'string' && dossier.title.trim() ? `«${shown(dossier.title.trim())}»` : 'senza titolo';
    const items = dossier.items.map((entry, index) => {
      const refuse = (reason: string): never => {
        throw new AppError(400, `Dossier ${title}, voce ${index + 1}: ${reason}: l'ambiente non può essere ${action}`);
      };
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return refuse('voce non leggibile');
      const item = entry as { type?: unknown; data?: unknown; status?: unknown };
      if (item.type === 'norma') {
        const norm = rebuildNormEntry(item.data);
        return norm.ok ? { ...item, data: norm.entry } : refuse(norm.reason);
      }
      if (item.type === 'sentenza') {
        const decision = rebuildDecisionEntry(item.data);
        if (!decision.ok) return refuse(decision.reason);
        // The web carries the star on the item (`status`); one that travelled inside the data is moved there.
        const data = item.data as { _dossierMeta?: { important?: unknown } };
        const starred = item.status === 'important' || data._dossierMeta?.important === true;
        return { ...item, ...(starred ? { status: 'important' } : {}), data: decision.entry };
      }
      if (item.type === 'note') {
        if (typeof item.data !== 'string' || item.data.length > MAX_NOTE_LENGTH) {
          return refuse(`nota non valida (testo di al massimo ${MAX_NOTE_LENGTH} caratteri)`);
        }
        return entry;
      }
      return refuse('tipo di voce sconosciuto');
    });
    return { ...dossier, items };
  });
}
