import { Circle, BookOpen, AlertCircle, CheckCircle2, type LucideIcon } from 'lucide-react';
import { formatDateItalianLong } from '../../../utils/dateUtils';
import type { DossierItem } from '../../../types';

export type DossierItemStatus = 'unread' | 'reading' | 'important' | 'done';

export const STATUS_CONFIG: Record<DossierItemStatus, { label: string; icon: LucideIcon; color: string; bg: string }> = {
  unread: { label: 'Da leggere', icon: Circle, color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-700' },
  reading: { label: 'In lettura', icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  important: { label: 'Importante', icon: AlertCircle, color: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  done: { label: 'Completato', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30' },
};

// Turn a stored timestamp (ISO string or epoch ms) into the Italian long format
// used across the app, e.g. "7 agosto 1990". Falls back to the raw input when
// parsing fails so the UI degrades to something-readable rather than "Invalid Date".
export function formatTimestampLong(ts: string | number | undefined | null): string {
  if (ts === undefined || ts === null || ts === '') return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return formatDateItalianLong(d.toISOString().slice(0, 10));
}

// One group = one norm (tipo + numero + data) and all its articles in the dossier.
// Used both by the detail view ("Apri tutti su Dashboard") and the list view
// ("apri rapido dalla card"). `triggerSearch` in the store overwrites any
// previous search, so the consuming UI must pick a single group to open at
// once — see OpenOnDashboardPicker for the multi-group UX.
export interface NormaGroup {
  key: string;
  tipo_atto: string;
  numero_atto: string;
  data: string;
  articles: string[];
}

export function computeNormaGroups(items: DossierItem[]): NormaGroup[] {
  const groups = new Map<string, NormaGroup>();
  items
    .filter((i) => i.type === 'norma')
    .forEach((item) => {
      const key = `${item.data.tipo_atto}|${item.data.numero_atto || ''}|${item.data.data || ''}`;
      const existing = groups.get(key);
      if (existing) {
        existing.articles.push(item.data.numero_articolo);
      } else {
        groups.set(key, {
          key,
          tipo_atto: item.data.tipo_atto,
          numero_atto: item.data.numero_atto || '',
          data: item.data.data || '',
          articles: [item.data.numero_articolo],
        });
      }
    });
  return Array.from(groups.values());
}
