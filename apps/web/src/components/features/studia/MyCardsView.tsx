import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { studiaService } from '../../../services/studiaService';
import { useAppStore } from '../../../store/useAppStore';
import type { AncoraScheda, Scheda } from '../../../types/studia';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { EmptyState } from '../../ui/EmptyState';
import { Toast } from '../../ui/Toast';
import { CardDetail } from './CardDetail';
import { CardFilters } from './CardFilters';
import { CardGroups } from './CardGroups';
import { CardFormDialog } from './CardFormDialog';
import { anchorActLabel, searchParamsFromAnchor } from './studiaLabels';
import { NO_FILTERS, useMyCards, type ActOption, type CardQuery, type FilterState } from './useMyCards';

const SEARCH_DEBOUNCE_MS = 300;
const LIST_PATH = '/studia/schede';

type ToastState = { message: string; type: 'success' | 'error' } | null;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The acts the cards rest on (by `normaKey`), each named by the source convention; what was seen once stays on offer. */
function withActsOf(known: ReadonlyMap<string, string>, cards: Scheda[]): ReadonlyMap<string, string> {
  let next: Map<string, string> | null = null;
  for (const card of cards) {
    for (const anchor of card.ancore) {
      if ((next ?? known).has(anchor.normaKey)) continue;
      const label = anchorActLabel(anchor);
      if (!label) continue;
      next ??= new Map(known);
      next.set(anchor.normaKey, label);
    }
  }
  return next ?? known;
}

/**
 * «Le mie schede»: the user's cards by subject and institute, behind a sticky filter row, with
 * the selected card beside the list (a phone shows one or the other). The selection is the route:
 * `/studia/schede/:id`.
 */
export function MyCardsView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const triggerSearch = useAppStore((s) => s.triggerSearch);

  const [filterState, setFilterState] = useState<FilterState>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const filters = useMemo<CardQuery>(
    () => ({
      materia: filterState.materia,
      stato: filterState.daRileggere ? 'BOZZA_PERSONALE' : filterState.stato,
      tipo: filterState.tipo,
      normaKey: filterState.normaKey,
      origine: filterState.daRileggere ? 'applicazione' : undefined,
      q: q || undefined,
    }),
    [filterState, q],
  );
  const { cards, groups, loadMore, hasMore, loading, error, refresh } = useMyCards(filters);

  const [knownActs, setKnownActs] = useState<ReadonlyMap<string, string>>(new Map());
  const acts = withActsOf(knownActs, cards);
  if (acts !== knownActs) setKnownActs(acts);
  const actOptions = useMemo<ActOption[]>(
    () => [...acts].map(([normaKey, label]) => ({ normaKey, label })).sort((a, b) => a.label.localeCompare(b.label, 'it')),
    [acts],
  );

  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (key: string) =>
    setFolded((before) => {
      const next = new Set(before);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // The selected card: from the list, else read by its id (a link from the reader, or a card the filters hide).
  const listed = id ? cards.find((card) => card.id === id) : undefined;
  const [fetched, setFetched] = useState<{ id: string; card: Scheda | null } | null>(null);
  useEffect(() => {
    if (!id || listed || loading || fetched?.id === id) return;
    let live = true;
    studiaService.get(id).then(
      (card) => live && setFetched({ id, card }),
      () => live && setFetched({ id, card: null }),
    );
    return () => {
      live = false;
    };
  }, [id, listed, loading, fetched]);
  // undefined: still being read; null: it is not there.
  const selected = listed ?? (fetched && fetched.id === id ? fetched.card : undefined);

  const [edit, setEdit] = useState<{ card: Scheda; open: boolean } | null>(null);
  const [toDelete, setToDelete] = useState<Scheda | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const openAnchor = (anchor: AncoraScheda) => {
    const params = searchParamsFromAnchor(anchor);
    if (!params) return;
    navigate('/');
    triggerSearch(params);
  };

  const handleSaved = (savedId: string) => {
    setFetched(null);
    void refresh();
    navigate(`${LIST_PATH}/${encodeURIComponent(savedId)}`);
  };

  const confirmDelete = async () => {
    const card = toDelete;
    setToDelete(null);
    if (!card) return;
    try {
      const outcome = await studiaService.trash([card.id]);
      if (outcome.moved.includes(card.id)) {
        setToast({ message: 'Scheda nel cestino', type: 'success' });
      } else if (outcome.notDeletable.includes(card.id)) {
        setToast({ message: 'Questa scheda non si può eliminare nello stato in cui si trova. Ho aggiornato l’elenco.', type: 'error' });
      } else {
        setToast({ message: 'La scheda non c’è più. Ho aggiornato l’elenco.', type: 'error' });
      }
      if (outcome.notDeletable.includes(card.id)) {
        setFetched(null);
      } else {
        // The router moves off the card as a transition: until it lands, the card is known to be gone,
        // so the new list that lacks it is not read as a reason to fetch it.
        setFetched({ id: card.id, card: null });
        navigate(LIST_PATH);
      }
      void refresh();
    } catch {
      setToast({ message: 'Non sono riuscito a spostare la scheda nel cestino. Riprova.', type: 'error' });
    }
  };

  const resetFilters = () => {
    setFilterState(NO_FILTERS);
    setSearch('');
  };
  const filtered = Boolean(q) || Object.values(filterState).some(Boolean);
  const showList = desktop || !id;

  return (
    <section className="md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start md:gap-6">
      <h2 className="sr-only">Le mie schede</h2>

      {showList && (
        <div className="min-w-0">
          <CardFilters value={filterState} onChange={setFilterState} search={search} onSearchChange={setSearch} acts={actOptions} />
          <div className="pt-4">
            {error && (
              <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
                {error}
                <button type="button" onClick={() => void refresh()} className="min-h-[44px] rounded px-2 font-medium underline md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  Riprova
                </button>
              </div>
            )}
            {loading && cards.length === 0 && !error && <p className="text-sm text-slate-500 dark:text-slate-400">Carico le schede…</p>}
            {!loading && !error && cards.length === 0 &&
              (filtered ? (
                <div className="space-y-2 py-8 text-center text-sm text-slate-600 dark:text-slate-300">
                  <p>Nessuna scheda con questi filtri.</p>
                  <button type="button" onClick={resetFilters} className="min-h-[44px] rounded px-2 font-medium text-primary-700 underline md:min-h-0 dark:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                    Azzera i filtri
                  </button>
                </div>
              ) : (
                <EmptyState variant="generic" title="Nessuna scheda ancora. Aprine una da un articolo con “+ Nuova scheda”, o chiedi a Claude di scriverne." />
              ))}
            <CardGroups groups={groups} selectedId={id} folded={folded} onToggleFold={toggleFold} />
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="mt-4 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 md:min-h-0 md:py-1.5 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                Mostra altre schede
              </button>
            )}
          </div>
        </div>
      )}

      {id ? (
        <div className={cn('min-w-0 pt-2 md:pt-3', desktop && 'sticky top-0 max-h-screen overflow-y-auto pb-4')}>
          {selected ? (
            <CardDetail
              card={selected}
              onBack={desktop ? undefined : () => navigate(LIST_PATH)}
              onEdit={() => setEdit({ card: selected, open: true })}
              onDelete={() => setToDelete(selected)}
              onOpenAnchor={openAnchor}
            />
          ) : (
            <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <p>{selected === null ? 'Questa scheda non c’è più.' : 'Carico la scheda…'}</p>
              {!desktop && (
                <button type="button" onClick={() => navigate(LIST_PATH)} className="min-h-[44px] rounded px-2 font-medium text-primary-700 underline dark:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  Indietro
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        desktop && cards.length > 0 && <p className="pt-4 text-sm text-slate-500 dark:text-slate-400">Scegli una scheda dall’elenco per leggerla.</p>
      )}

      {/* Kept mounted: its «Scheda salvata» toast outlives the dialog. */}
      {edit && (
        <CardFormDialog
          open={edit.open}
          mode={{ kind: 'edit', card: edit.card }}
          onClose={() => setEdit((current) => current && { ...current, open: false })}
          onSaved={handleSaved}
        />
      )}
      <ConfirmDialog
        open={toDelete !== null}
        variant="danger"
        title="Eliminare questa scheda?"
        message="La scheda va nel cestino per 30 giorni. Le altre schede non sono toccate."
        confirmLabel="Elimina"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
      <div className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
        <Toast message={toast?.message ?? ''} type={toast?.type ?? 'success'} isVisible={toast !== null} onClose={() => setToast(null)} />
      </div>
    </section>
  );
}
