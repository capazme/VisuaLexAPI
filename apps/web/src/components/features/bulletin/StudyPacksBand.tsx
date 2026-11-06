import { useEffect, useState } from 'react';
import { Check, FolderPlus } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { dossierService } from '../../../services/dossierService';
import { getErrorMessage } from '../../../utils/errors';
import { loadStudyPacks, packAlreadyAdded, packContent, peekStudyPacks, type StudyPack } from '../../../utils/studyPacks';
import { cn } from '../../../lib/utils';
import { CARD_GRID_COLUMNS } from '../../layout/frame';
import type { EnvironmentCategory, StudyImportReport } from '../../../types';

interface Props {
  /** The Explore view's category filter: the band follows it. */
  category: EnvironmentCategory | 'all';
  onAdded: (report: StudyImportReport) => void;
  onError: (message: string) => void;
  /** Once the packs are on screen (they load after the band): `/forum#pronti` can then bring them to the top. */
  onShown?: () => void;
}

/** The pack's 44 px controls (S7a): on every width, the cards being small. */
const ACTION = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium';
/**
 * The band's two layouts (U1 §7), chosen by its own width (`@container` on the section, so the sidebar and the full
 * screen count, not the window): a row of 224 px cards that scrolls sideways, on a phone and wherever fewer than three
 * cards of 20rem fit; from three of them and their gaps (61.5rem, 984 px at the default text size) a grid of cards of at
 * least 20rem (`CARD_GRID_COLUMNS`, which the row ignores), every pack in sight — the row ran some 4700 px at 2560. The
 * list and the cards held while it loads share it, so the one takes the other's place.
 */
const LAYOUT = `-mx-1 flex gap-3 px-1 pb-3 pt-1 @min-[61.5rem]:grid @min-[61.5rem]:pb-1 ${CARD_GRID_COLUMNS}`;
const CARD = 'flex w-56 shrink-0 snap-start flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 @min-[61.5rem]:w-auto dark:border-slate-700 dark:bg-slate-900';
const BAR = 'rounded bg-slate-100 dark:bg-slate-800';
/** While the packs load: cards of their size — a name on two lines in the row (the cards stretch to the tallest), on one
 *  in the grid (at 20rem the names fit one, the longest 41 characters), the count, the button's 44 px — as many as the
 *  packs of «Tutte le categorie», where the Forum opens, so the Forum below hardly moves when they arrive (a name that
 *  wraps in the grid makes its line one taller; every category holds packs, so the band never turns out empty; the
 *  test holds the number to the data). */
const WAITING_CARDS = 20;

/**
 * Whether the list is laid out as the row, as the CSS chose by the band's width: only the row is a Tab stop of its own,
 * so the arrows scroll it past the packs already added, which hold no button; the grid shows every pack and is no stop,
 * still focusable by script for `/forum#pronti`. Read whenever the list is resized (a change of layout resizes it); the
 * row until then, and where the browser has no `ResizeObserver`.
 */
function useIsRow(list: HTMLElement | null): boolean {
  const [row, setRow] = useState(true);
  useEffect(() => {
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setRow(getComputedStyle(list).display !== 'grid'));
    observer.observe(list);
    return () => observer.disconnect();
  }, [list]);
  return row;
}

/**
 * «Pronti da VisuaLex» (spec 2026-10-13-environments-into-forum, D12; S7a): the packs VisuaLex ships, as compact cards
 * after the community's dossiers — they are the Forum's reason, the packs a help. Each is added as dossiers di studio with
 * one request (`POST /dossiers/import-study`); a pack whose dossiers the user already holds says so instead. Every pack is
 * in the band: in the row a swipe, the trackpad or Tab reach them, in the grid (U1) they are all in sight.
 */
export function StudyPacksBand({ category, onAdded, onError, onShown }: Props) {
  const dossiers = useAppStore((s) => s.dossiers);
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const row = useIsRow(list);
  const [adding, setAdding] = useState<string | null>(null);
  // Added in this visit: marked at once, before the dossier list is read again, so a second tap makes no second copy.
  const [addedNow, setAddedNow] = useState<ReadonlySet<string>>(new Set());
  // `undefined` while they load, `null` when they could not be loaded: the band is left out, as a help it is.
  const [all, setAll] = useState<StudyPack[] | null | undefined>(peekStudyPacks);
  useEffect(() => {
    let live = true;
    loadStudyPacks().then(
      (loaded) => { if (live) setAll(loaded); },
      (error: unknown) => {
        console.error('the study packs could not be loaded', error);
        if (live) setAll(null);
      },
    );
    return () => { live = false; };
  }, []);
  const packs = all?.filter((p) => category === 'all' || p.category === category);
  const shown = Boolean(packs?.length);
  useEffect(() => {
    if (shown) onShown?.();
  }, [shown, onShown]);
  if (all === null || packs?.length === 0) return null;

  const add = async (pack: StudyPack) => {
    setAdding(pack.key);
    try {
      const report = await dossierService.importStudy(packContent(pack), { addNotes: false, addHighlights: false });
      setAddedNow((prev) => new Set(prev).add(pack.key));
      onAdded(report);
    } catch (err) {
      onError(getErrorMessage(err) || 'Non è stato possibile aggiungere il pacchetto. Riprova.');
    } finally {
      setAdding(null);
    }
  };

  return (
    <section aria-labelledby="study-packs" aria-busy={packs === undefined || undefined} className="@container min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="study-packs" className="font-serif text-xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
          Pronti da VisuaLex
        </h2>
        <span className="text-sm text-slate-600 dark:text-slate-400">dossier di studio da aggiungere ai tuoi</span>
      </div>
      {/* The row scrolls sideways, each card snapping to the start, the cards one width and one height; it takes the focus
          itself, so the arrows scroll it even past the packs already added, which hold no button. The grid's cards share
          each line's height. */}
      {packs === undefined ? (
        <div aria-hidden className={cn(LAYOUT, 'overflow-hidden')}>
          {Array.from({ length: WAITING_CARDS }, (_, i) => (
            <div key={i} className={cn(CARD, 'motion-safe:animate-pulse')}>
              <span className="min-w-0">
                <span className="block text-base leading-snug">
                  <span className="flex h-[1lh] items-center"><span className={cn(BAR, 'h-4 w-4/5')} /></span>
                  <span className="flex h-[1lh] items-center @min-[61.5rem]:hidden"><span className={cn(BAR, 'h-4 w-1/2')} /></span>
                </span>
                <span className="mt-0.5 flex h-5 items-center text-sm"><span className={cn(BAR, 'h-3 w-16')} /></span>
              </span>
              <span className={cn(ACTION, 'px-0')}><span className={cn(BAR, 'h-4 w-20')} /></span>
            </div>
          ))}
        </div>
      ) : (
        <ul
          ref={setList}
          id="pronti"
          tabIndex={row ? 0 : -1}
          aria-labelledby="study-packs"
          className={cn(
            LAYOUT,
            'snap-x overflow-x-auto rounded-xl @min-[61.5rem]:overflow-x-visible',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          )}
        >
          {packs.map((pack) => {
            const added = addedNow.has(pack.key) || packAlreadyAdded(pack, dossiers);
            return (
              <li key={pack.key} className={CARD}>
                <span className="min-w-0">
                  <span className="line-clamp-2 break-words font-serif text-base font-medium leading-snug text-slate-900 dark:text-slate-50" title={pack.description}>
                    {pack.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
                    <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(var(--category-${pack.category}))` }} />
                    {pack.dossiers.length} dossier
                  </span>
                </span>
                {added ? (
                  <span className={cn(ACTION, 'px-0 text-emerald-700 dark:text-emerald-300')}>
                    <Check size={16} aria-hidden /> Già tra i tuoi dossier
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void add(pack)}
                    disabled={adding !== null}
                    aria-label={`Aggiungi «${pack.name}» ai miei dossier`}
                    className={cn(
                      ACTION,
                      '-mx-2 self-start text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-300 dark:hover:bg-primary-900/30',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    )}
                  >
                    <FolderPlus size={16} aria-hidden /> {adding === pack.key ? 'Aggiungo…' : 'Aggiungi'}
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
