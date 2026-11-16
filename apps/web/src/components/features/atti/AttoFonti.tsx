import { Link } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../../../constants/interactions';
import type { DossierItemApi } from '../../../services/dossierService';
import type { AttoSummary } from '../../../services/attiService';
import { citationOf, noteTextOf } from './attiText';

const PILL = 'shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300';
const TITLE = 'min-w-0 font-serif text-[15px] leading-snug text-slate-800 dark:text-slate-200';
const CITE = 'min-h-11 shrink-0 rounded-md px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:min-h-0 md:px-2 md:py-1 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100';

/**
 * What the practice (the act's dossier) holds, in the dossier's order: norms, decisions and notes, then its other acts.
 * «Cita» (only while the text is open to a correction) writes a norm or a decision where the cursor is.
 */
export function AttoFonti({ items, atti, editing, onCite }: {
  items: DossierItemApi[];
  atti: AttoSummary[];
  editing: boolean;
  onCite: (text: string) => void;
}) {
  const voci = items.filter((item) => item.item_type === 'norm' || item.item_type === 'sentenza' || (item.item_type === 'note' && noteTextOf(item)));
  if (voci.length === 0 && atti.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">La pratica non ha ancora fonti, note né altri atti.</p>;
  return (
    <ul className="flex flex-col">
      {voci.map((item) => {
        const citable = item.item_type !== 'note';
        return (
          <li key={item.id} className="flex items-start gap-2 border-b border-slate-200/70 py-2 last:border-b-0 dark:border-slate-800">
            <span className={cn(PILL, 'mt-0.5')}>{item.item_type === 'norm' ? 'Norma' : item.item_type === 'sentenza' ? 'Sentenza' : 'Nota'}</span>
            {citable
              ? <span className={cn(TITLE, 'flex-1')} title={citationOf(item)}>{citationOf(item)}</span>
              : <span className={cn(TITLE, 'line-clamp-4 flex-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300')} title={noteTextOf(item)}>{noteTextOf(item)}</span>}
            {editing && citable && (
              <button type="button" onClick={() => onCite(citationOf(item))} aria-label={`Cita ${citationOf(item)}`} className={cn(CITE, FOCUS_RING)}>Cita</button>
            )}
          </li>
        );
      })}
      {atti.map((atto) => (
        <li key={atto.id} className="border-b border-slate-200/70 last:border-b-0 dark:border-slate-800">
          <Link to={`/work/atti/${atto.id}`} className={cn('flex min-h-11 items-start gap-2 rounded-sm py-2 md:min-h-0', FOCUS_RING)}>
            <span className={cn(PILL, 'mt-0.5')}>Atto</span>
            <span className="min-w-0 flex-1">
              <span className={cn(TITLE, 'block')}>{atto.titolo}</span>
              <span className="block text-[13px] text-slate-600 dark:text-slate-400">{[atto.tipo, atto.stato === 'finale' ? 'Finale' : 'Bozza'].filter(Boolean).join(' · ')}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
