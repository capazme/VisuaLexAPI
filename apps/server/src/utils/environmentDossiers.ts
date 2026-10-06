/**
 * The dossiers of an environment published to the Forum, their norms rebuilt from closed values
 * before they are stored (`schemas/normEntry.ts`). Whoever applies the environment gets those
 * norms cited to them — on the web, in the MCP reads and in the MCP deletion dialog — so no text
 * the publisher wrote may reach a citation. A norm that cannot be rebuilt refuses the publication
 * with an Italian message naming the dossier, the entry and why (owner's decision, 6 October
 * 2026). The web app rebuilds them again when an environment is applied (`validateImportedDossier`):
 * environments published before this check, files and share links come that way.
 */
import { AppError } from '../middleware/errorHandler';
import { rebuildNormEntry } from '../schemas/normEntry';

const shown = (value: string): string => (value.length > 60 ? `${value.slice(0, 60)}…` : value);

export function rebuildEnvironmentDossiers(dossiers: unknown[], action: 'pubblicato' | 'aggiornato'): unknown[] {
  return dossiers.map((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
    const dossier = raw as { title?: unknown; items?: unknown };
    if (!Array.isArray(dossier.items)) return raw;
    const title = typeof dossier.title === 'string' && dossier.title.trim() ? `«${shown(dossier.title.trim())}»` : 'senza titolo';
    const items = dossier.items.map((entry, index) => {
      const item = entry as { type?: unknown; data?: unknown } | null;
      if (item?.type !== 'norma') return entry;
      const norm = rebuildNormEntry(item.data);
      if (!norm.ok) {
        throw new AppError(400, `Dossier ${title}, voce ${index + 1}: ${norm.reason}: l'ambiente non può essere ${action}`);
      }
      return { ...(entry as object), data: norm.entry };
    });
    return { ...dossier, items };
  });
}
