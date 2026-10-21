import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { studiaService } from '../../../services/studiaService';
import { useAppStore } from '../../../store/useAppStore';
import { invalidateArticleCards } from '../../../utils/articleCardsCache';
import type { AncoraScheda, Scheda } from '../../../types/studia';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Toast } from '../../ui/Toast';
import { CardDetail, type CardDetailProps } from './CardDetail';
import { CardFilters } from './CardFilters';
import { CardGroups } from './CardGroups';
import type { CardFormMode } from './CardForm';
import { CardFormDialog } from './CardFormDialog';
import { BLOCK_HEADING, FOCUS_RING, INK_BUTTON, INK_TEXT, MUTED_TEXT, QUIET_BUTTON, SECONDARY_BUTTON, TILE } from './progress/tokens';
import { anchorActLabel, searchParamsFromAnchor } from './studiaLabels';
import { useCardSources } from './useCardSources';
import { NO_FILTERS, useMyCards, type ActOption, type CardQuery, type FilterState } from './useMyCards';

const SEARCH_DEBOUNCE_MS = 300;
const LIST_PATH = '/studia/schede';

type ToastState = { message: string; type: 'success' | 'error' } | null;

/** The value after `ms` of quiet, and a way to settle it at once (clearing the filters must not wait for the old text to expire). */
function useDebounced<T>(value: T, ms: number): [T, (next: T) => void] {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return [settled, setSettled];
}

/**
 * The card with what only its own address carries: the approvals and the validators' remarks of a
 * card that has left the drafts (the list does not carry them). Read again when its state or
 * date moves, so a withdrawn or newly validated card shows the present. Until the answer comes, or
 * if it never does, the card is shown as the list gave it.
 */
function useCardDetail(card: Scheda): { card: Scheda; failed: boolean; retry: () => void } {
  const needsDetail = card.stato !== 'BOZZA_PERSONALE' && card.rilievi === undefined;
  const [detail, setDetail] = useState<Scheda | null>(null);
  // The card, state and date whose reading failed: a different one starts without the failure.
  const asked = `${card.id}|${card.stato}|${card.updatedAt}`;
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!needsDetail) return;
    let live = true;
    studiaService.get(card.id).then(
      (full) => {
        if (!live) return;
        setDetail(full);
        setFailedFor(null);
      },
      (error) => {
        console.error(`Could not read the validators' remarks of study card ${card.id}`, error);
        if (live) setFailedFor(asked);
      },
    );
    return () => {
      live = false;
    };
  }, [needsDetail, card.id, asked, attempt]);
  const retry = () => {
    setFailedFor(null);
    setAttempt((n) => n + 1);
  };
  // Only an answer for this very card and state: another one's, or a draft's, is not shown.
  const shown = needsDetail && detail && detail.id === card.id && detail.stato === card.stato ? detail : card;
  return { card: shown, failed: needsDetail && failedFor === asked, retry };
}

/**
 * The list with no card yet: how to begin. From here with «+ Nuova scheda» when the sources answer (the
 * form checks every anchor against them); from an article, or through Claude, in any case. While the
 * sources have not answered, only the first line: the way to begin is not said twice in two ways.
 */
function NoCardsYet({ sources, onNew }: { sources: boolean | undefined; onNew: () => void }) {
  const search = (
    <Link to="/" className={cn('font-medium underline underline-offset-2', FOCUS_RING)}>
      Ricerca
    </Link>
  );
  return (
    <div className={cn(TILE, 'grid justify-items-stretch gap-3 p-4 md:justify-items-start md:p-6')}>
      <p className={cn('font-serif text-xl leading-snug md:text-2xl', INK_TEXT)}>Non hai ancora schede.</p>
      {sources === undefined ? null : sources ? (
        <>
          <p className="max-w-prose text-sm text-slate-700 dark:text-slate-200">
            Scrivi la prima da qui: indica l’articolo su cui poggia, ad esempio «art. 1455 c.c.», poi la domanda e la risposta.
          </p>
          <button type="button" aria-haspopup="dialog" onClick={onNew} className={cn(INK_BUTTON, 'w-full px-6 md:w-auto')}>
            + Nuova scheda
          </button>
          <p className="max-w-prose text-sm text-slate-700 dark:text-slate-200">
            Puoi anche aprire un articolo dalla {search} e scegliere «+ Nuova scheda» sotto il testo, o chiedere a Claude di scriverne.
          </p>
        </>
      ) : (
        <p className="max-w-prose text-sm text-slate-700 dark:text-slate-200">
          Per cominciare, apri un articolo dalla {search} e scegli «+ Nuova scheda» sotto il testo, o chiedi a Claude di scriverne.
        </p>
      )}
    </div>
  );
}

/** The detail of a card, completed with what its own address carries (`useCardDetail`). */
function DetailOf({ card, ...rest }: CardDetailProps) {
  const full = useCardDetail(card);
  return <CardDetail {...rest} card={full.card} rilieviFailed={full.failed} onRetryRilievi={full.retry} />;
}

/**
 * The acts the cards rest on (by `normaKey`), each named by the source convention. A narrowed list
 * adds to what was on offer; with `rebuild` the options are those of these cards alone, so an act
 * whose last card is gone stops being offered. The act now selected is always kept. The same
 * instance comes back when nothing changes.
 */
function withActsOf(
  known: ReadonlyMap<string, string>,
  cards: Scheda[],
  selected: string | undefined,
  rebuild: boolean,
): ReadonlyMap<string, string> {
  const next = new Map(rebuild ? [] : known);
  for (const card of cards) {
    for (const anchor of card.ancore) {
      if (next.has(anchor.normaKey)) continue;
      const label = anchorActLabel(anchor);
      if (label) next.set(anchor.normaKey, label);
    }
  }
  const kept = selected ? known.get(selected) : undefined;
  if (selected && kept && !next.has(selected)) next.set(selected, kept);
  const unchanged = next.size === known.size && [...next].every(([key, label]) => known.get(key) === label);
  return unchanged ? known : next;
}

/**
 * «Le mie schede»: the user's cards by subject and institute, behind a sticky filter row, with
 * the selected card beside the list (a phone shows one or the other). The selection is the route:
 * `/studia/schede/:id`. «+ Nuova scheda», in the heading and in the empty list, opens the form with no
 * article — only while the sources answer (`useCardSources`).
 */
export function MyCardsView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const triggerSearch = useAppStore((s) => s.triggerSearch);
  const sources = useCardSources();
  const canWrite = sources === true;
  // After a card is created the dialog gives the focus back to the button that opened it, which may be the
  // empty list's and go with it: the heading's button takes it instead.
  const newCardButton = useRef<HTMLButtonElement>(null);
  const focusAfterCreate = useRef(false);

  const [filterState, setFilterState] = useState<FilterState>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const [q, settleSearch] = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const filters = useMemo<CardQuery>(
    () => ({
      materia: filterState.materia,
      stato: filterState.daRileggere ? 'BOZZA_PERSONALE' : filterState.stato,
      tipo: filterState.tipo,
      normaKey: filterState.normaKey,
      origine: filterState.daRileggere ? 'applicazione' : undefined,
      dovuteOggi: filterState.dovuteOggi ? 'true' : undefined,
      q: q || undefined,
    }),
    [filterState, q],
  );
  const { cards, groups, loadMore, hasMore, loading, settled, error, refresh } = useMyCards(filters);
  const filtered = Boolean(q) || Object.values(filterState).some(Boolean);

  const [knownActs, setKnownActs] = useState<ReadonlyMap<string, string>>(new Map());
  // A deletion starts the options over even under a filter: the act of the card that went must not stay on offer.
  const [restartActs, setRestartActs] = useState(false);
  const rebuildActs = settled && !error && (!filtered || restartActs);
  const acts = withActsOf(knownActs, cards, filterState.normaKey, rebuildActs);
  if (acts !== knownActs) setKnownActs(acts);
  if (rebuildActs && restartActs) setRestartActs(false);
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

  const [form, setForm] = useState<{ mode: CardFormMode; open: boolean } | null>(null);
  const openNew = () => setForm({ mode: { kind: 'create' }, open: true });
  const formOpen = form?.open === true;
  useEffect(() => {
    if (formOpen || !focusAfterCreate.current) return;
    focusAfterCreate.current = false;
    newCardButton.current?.focus();
  }, [formOpen]);
  const [toDelete, setToDelete] = useState<Scheda | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const openAnchor = (anchor: AncoraScheda) => {
    const params = searchParamsFromAnchor(anchor);
    if (!params) return;
    navigate('/');
    triggerSearch(params);
  };

  const handleSaved = (savedId: string) => {
    if (form?.mode.kind === 'create') focusAfterCreate.current = true;
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
      setRestartActs(true);
      // The cards under an article are read again where they are shown next.
      if (outcome.moved.length > 0) invalidateArticleCards();
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

  // A card proposed, withdrawn or refused: the lists are read again where they are shown next.
  const handleChanged = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setFetched(null);
    invalidateArticleCards();
    void refresh();
  };

  const resetFilters = () => {
    setFilterState(NO_FILTERS);
    setSearch('');
    settleSearch('');
  };
  const showList = desktop || !id;

  return (
    <section className="space-y-4 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={BLOCK_HEADING}>Le mie schede</h2>
        {canWrite && (
          <button ref={newCardButton} type="button" aria-haspopup="dialog" onClick={openNew} className={SECONDARY_BUTTON}>
            + Nuova scheda
          </button>
        )}
      </header>

      <div className="md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start md:gap-6">
        {showList && (
          <div className="min-w-0">
            <CardFilters value={filterState} onChange={setFilterState} search={search} onSearchChange={setSearch} acts={actOptions} />
            <div className="pt-4">
              {error && (
                <div role="alert" className="mb-3 flex flex-wrap items-center gap-x-3 text-sm text-red-700 dark:text-red-400">
                  {error}
                  <button type="button" onClick={() => void refresh()} className={cn('min-h-[44px] rounded px-1 font-medium underline', FOCUS_RING)}>
                    Riprova
                  </button>
                </div>
              )}
              {loading && cards.length === 0 && !error && <p className={cn('text-sm', MUTED_TEXT)}>Carico le schede…</p>}
              {!loading && !error && cards.length === 0 &&
                (filtered ? (
                  <div className="grid justify-items-center gap-1 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    <p>Nessuna scheda con questi filtri.</p>
                    <button type="button" onClick={resetFilters} className={cn(QUIET_BUTTON, 'mx-0 justify-self-center underline')}>
                      Azzera i filtri
                    </button>
                  </div>
                ) : (
                  <NoCardsYet sources={sources} onNew={openNew} />
                ))}
              <CardGroups groups={groups} selectedId={id} folded={folded} onToggleFold={toggleFold} />
              {hasMore && (
                <button type="button" onClick={loadMore} disabled={loading} className={cn(SECONDARY_BUTTON, 'mt-4 w-full disabled:opacity-60')}>
                  Mostra altre schede
                </button>
              )}
            </div>
          </div>
        )}

        {id ? (
          <div className={cn('min-w-0 pt-2 md:pt-0', desktop && 'sticky top-0 max-h-dvh overflow-y-auto pb-4')}>
            {selected ? (
              <DetailOf
                // Its confirmations and pending request belong to this card: another one starts clean.
                key={selected.id}
                card={selected}
                onBack={desktop ? undefined : () => navigate(LIST_PATH)}
                onEdit={() => setForm({ mode: { kind: 'edit', card: selected }, open: true })}
                onDelete={() => setToDelete(selected)}
                onOpenAnchor={openAnchor}
                onChanged={handleChanged}
              />
            ) : (
              <div className="grid justify-items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <p>{selected === null ? 'Questa scheda non c’è più.' : 'Carico la scheda…'}</p>
                {!desktop && (
                  <button type="button" onClick={() => navigate(LIST_PATH)} className={QUIET_BUTTON}>
                    Indietro
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          desktop &&
          cards.length > 0 && (
            <p className={cn('rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm dark:border-slate-700', MUTED_TEXT)}>
              Scegli una scheda dall’elenco per leggerla.
            </p>
          )
        )}
      </div>

      {/* Kept mounted: its «Scheda salvata» toast outlives the dialog. */}
      {form && (
        <CardFormDialog
          open={form.open}
          mode={form.mode}
          onClose={() => setForm((current) => current && { ...current, open: false })}
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
