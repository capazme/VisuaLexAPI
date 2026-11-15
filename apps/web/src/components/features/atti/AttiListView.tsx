import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../../../constants/interactions';
import { dossierService, type DossierApi } from '../../../services/dossierService';
import { changedOn } from './attiText';
import { ATTO_TIPI, attiError, attiService, type AttoSummary } from '../../../services/attiService';

const FIELD =
  'h-10 w-full rounded-lg border border-slate-300 bg-card px-3 text-sm text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-100';


/**
 * Atti (Work): the user's acts, the last changed first, and the form that starts a new one — its title, its kind and
 * the dossier whose sources it rests on. A new act opens in the editor (`AttoEditor`).
 */
export function AttiListView() {
  const navigate = useNavigate();
  const [atti, setAtti] = useState<AttoSummary[] | null>(null);
  const [dossiers, setDossiers] = useState<DossierApi[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [titolo, setTitolo] = useState('');
  const [tipo, setTipo] = useState('');
  const [dossierId, setDossierId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    attiService
      .list()
      .then((list) => alive && setAtti(list))
      .catch((error) => alive && setLoadError(attiError(error, 'Non è stato possibile leggere i tuoi atti.')));
    // The dossiers name the acts' sources; without them the list still reads.
    dossierService.getAll().then((list) => alive && setDossiers(list)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload]);

  const dossierName = useMemo(() => new Map(dossiers.map((d) => [d.id, d.name])), [dossiers]);
  const workDossiers = useMemo(() => dossiers.filter((d) => d.kind !== 'studio'), [dossiers]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!titolo.trim()) {
      setCreateError('Scrivi il titolo dell’atto.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const atto = await attiService.create({ titolo: titolo.trim(), tipo: tipo.trim() || null, dossierId: dossierId || null });
      navigate(`/work/atti/${atto.id}`);
    } catch (error) {
      setCreateError(attiError(error, 'L’atto non è stato creato. Riprova.'));
      setCreating(false);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <form onSubmit={create} aria-labelledby="atti-nuovo" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-card p-5 dark:border-slate-800">
        <h2 id="atti-nuovo" className="font-serif text-xl text-slate-900 dark:text-slate-50">Nuovo atto</h2>
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Titolo
            <input value={titolo} onChange={(e) => setTitolo(e.target.value)} maxLength={300} placeholder="Atto di appello, Sempronia c. Filano" className={FIELD} aria-invalid={createError ? true : undefined} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Tipo
            <input value={tipo} onChange={(e) => setTipo(e.target.value)} maxLength={100} list="atti-tipi" placeholder="Scegli o scrivi" className={FIELD} />
            <datalist id="atti-tipi">{ATTO_TIPI.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Dossier
            <select value={dossierId} onChange={(e) => setDossierId(e.target.value)} className={FIELD}>
              <option value="">Nessuno</option>
              {workDossiers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={creating}>Crea e apri</Button>
          {createError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{createError}</p>}
        </div>
      </form>

      <section aria-labelledby="atti-elenco" className="flex flex-col gap-3">
        <h2 id="atti-elenco" className="font-serif text-xl text-slate-900 dark:text-slate-50">I tuoi atti</h2>
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
            {loadError}
            <Button variant="secondary" size="sm" onClick={() => {
              setLoadError(null);
              setReload((n) => n + 1);
            }}>Riprova</Button>
          </div>
        ) : atti === null ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Caricamento…</p>
        ) : atti.length === 0 ? (
          <p className="max-w-prose text-sm text-slate-600 dark:text-slate-400">
            Non hai ancora atti. Creane uno qui sopra: se lo colleghi a un dossier, le sue norme e le sue sentenze restano accanto al testo mentre scrivi.
          </p>
        ) : (
          <ul className="border-t border-slate-200 dark:border-slate-800">
            {atti.map((atto) => {
              const dossier = atto.dossierId ? dossierName.get(atto.dossierId) : null;
              return (
                <li key={atto.id} className="border-b border-slate-200 dark:border-slate-800">
                  <Link to={`/work/atti/${atto.id}`} className={cn('flex items-center gap-4 px-2 py-3 transition-colors hover:bg-slate-100 dark:hover:bg-slate-900', FOCUS_RING)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-lg text-slate-900 dark:text-slate-50">{atto.titolo}</span>
                      <span className="block truncate text-sm text-slate-600 dark:text-slate-400">
                        {[atto.tipo, dossier, `modificato il ${changedOn(atto.updatedAt)}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={cn(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      atto.stato === 'finale' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
                    )}>
                      {atto.stato === 'finale' ? 'Finale' : 'Bozza'}
                    </span>
                    <ChevronRight aria-hidden size={16} className="shrink-0 text-slate-500" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
