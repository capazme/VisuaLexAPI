import { useLayoutEffect, useRef } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { cn } from '../../../lib/utils';
import { isBoundPractice, practiceCountLine, practiceCounts, type Practice } from '../../../utils/practice';
import { MenuButton } from '../../ui/MenuButton';
import { PracticeColumn } from './PracticeColumn';
import { ReadingFullScreen } from './ReadingFullScreen';
import { PracticeEmpty, PracticeStreamingBar, type PracticeStreaming } from './PracticeParts';
import { scrollParentOf } from './practiceView';
import { CLOSE_TABLE } from './PracticeTable';
import { closePracticeWithUndo } from './practiceUndo';
import { usePracticeSaveActions, type PracticeSaveActions } from './usePracticeSaveActions';
import { SimpleReadingContext, isSimplePractice } from './simpleReading';
import { useHostedPractice } from './readingHost';

const SIMPLE_ON_PHONE = { simple: true, practiceItems: [] };
const NOT_SIMPLE = { simple: false, practiceItems: [] };

export interface PracticePhoneViewProps {
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string) => void;
  streaming: PracticeStreaming | null;
  /** The practice to show (LC52 c2: a dossier's bound table); without it, the Corpus's active one. */
  practiceId?: string;
}

/** A pending reveal wins over the saved scroll: any of the Corpus's for a Corpus practice, as before; across the line
 *  between a bound table and the Corpus, never (LC52 c2: one's reveal is not the other's). */
function revealWaits(practiceId: string): boolean {
  const { pendingReveal, practices } = appStore.getState();
  if (!pendingReveal) return false;
  const bound = (id: string) => practices.some((p) => p.id === id && isBoundPractice(p));
  return pendingReveal.practiceId === practiceId || bound(pendingReveal.practiceId) === bound(practiceId);
}

/** How long the column's scroll position is asked for again while its content arrives. */
const SETTLE_MS = 3000;
/** What a user's own scroll starts with: it ends the asking. */
const USER_SCROLL = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;


/**
 * The phone's table (spec §8, R3): one line that names the practice, with «⋯» (LC60: no list of practices and no «Salva
 * come dossier»: the Ricerca is one reading bench of the session), over the active practice's column, rows opening in place. «Apri accanto», a decision opened from a
 * link and a topic search read in the full-screen reader instead (`phoneReader`, T19), which takes
 * the column's place — the column is not kept mounted under it (gotcha 26) — and gives it back at the
 * scroll position it left. The practice on screen is the active one, so the store's routing, the way
 * back and the find window all name the same practice on both breakpoints. The migration's notice is
 * `SearchPanel`'s, over both layouts.
 */
export function PracticePhoneView({ onViewPdf, onCrossReference, streaming, practiceId }: PracticePhoneViewProps) {
  const practice = useHostedPractice(practiceId);
  const shownId = practice?.id ?? null;
  // A dossier's table (LC54): the dossier's page names it; no head of its own.
  const bound = practice !== undefined && isBoundPractice(practice);
  // The reader is drawn for the practice on screen only: one whose practice is another is not this view's.
  const readerOpen = useAppStore((s) => s.phoneReader !== null && s.phoneReader.practiceId === shownId &&
    s.practices.some((p) => p.id === s.phoneReader?.practiceId));
  // The save's picker and toast belong to the view, not to the column the reader replaces: an outcome
  // arriving while the reader is open is not lost.
  const save = usePracticeSaveActions(practice?.id ?? '');

  // The column's scroll position (the page's content scroller) is kept, with its practice, while the
  // column is drawn and given back when the reader closes on the same practice — unless a row is
  // waiting to be revealed, which scrolls to itself. The column remounts short and its open rows'
  // content arrives afterwards, so one write at mount would be clamped and lost: the position is
  // asked for again each time the view grows, until it is reached, the user scrolls, or SETTLE_MS pass.
  const rootRef = useRef<HTMLDivElement>(null);
  const lastTop = useRef<{ practiceId: string | null; top: number }>({ practiceId: null, top: 0 });
  const restore = useRef<string | null>(null);
  const shownPractice = useRef(shownId);
  // (declared before the effect that reads it: layout effects run in order)
  useLayoutEffect(() => { shownPractice.current = shownId; });
  useLayoutEffect(() => {
    if (readerOpen) {
      restore.current = shownPractice.current;
      return;
    }
    const root = rootRef.current;
    const scroller = root ? scrollParentOf(root) : null;
    if (!root || !scroller) return;
    let settling = false;
    let stopSettling: (record: boolean) => void = () => {};
    if (restore.current !== null) {
      const kept = restore.current;
      restore.current = null;
      if (kept === shownPractice.current && lastTop.current.practiceId === kept && !revealWaits(kept)) {
        const target = lastTop.current.top;
        const observer = new ResizeObserver(() => apply());
        const timer = setTimeout(() => stop(true), SETTLE_MS);
        const byUser = () => stop(true);
        settling = true;
        function stop(record: boolean) {
          if (!settling) return;
          settling = false;
          observer.disconnect();
          clearTimeout(timer);
          for (const type of USER_SCROLL) scroller!.removeEventListener(type, byUser);
          if (record) lastTop.current = { practiceId: kept, top: scroller!.scrollTop };
        }
        function apply() {
          if (revealWaits(kept)) return stop(true);
          if (scroller!.scrollTop < target - 1) scroller!.scrollTop = target;
          if (Math.abs(scroller!.scrollTop - target) <= 1) stop(true);
        }
        stopSettling = stop;
        for (const type of USER_SCROLL) scroller.addEventListener(type, byUser, { passive: true });
        observer.observe(root);
        apply();
      }
    }
    // The clamping and the restoring write scroll events of their own: only the user's are the place.
    const onScroll = () => {
      if (!settling) lastTop.current = { practiceId: shownPractice.current, top: scroller.scrollTop };
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      stopSettling(false);
    };
  }, [readerOpen]);

  if (!practice) return null;
  // The save's picker and toast are one stable sibling of whichever branch is drawn: opening the
  // reader does not remount the picker.
  return (
    <>
      {readerOpen ? <ReadingFullScreen onCrossReference={onCrossReference} practiceId={shownId ?? undefined} /> : (
        <div ref={rootRef} data-testid="practice-phone-view" className="flex w-full flex-col bg-slate-50 dark:bg-slate-950">
          {/* One line under the search page's field (R3: the text first): the practice's name, its count beside it, «⋯». */}
          {practice && !bound && <PhonePracticeHead practice={practice} save={save} />}
          {practice && (
            // At the layout's 16 px from the edges (R3b): no step of its own.
            <div className="space-y-4 pb-4 pt-2">
              <PracticeStreamingBar streaming={streaming} practiceId={practice.id} />
              {practice.acts.length === 0 && practice.decisions.length === 0 ? (
                <PracticeEmpty />
              ) : (
                // One article alone is read simply here too (LC28): no row to open, the article at once. The head above
                // stays, with «⋯».
                <SimpleReadingContext.Provider value={isSimplePractice(practice) ? SIMPLE_ON_PHONE : NOT_SIMPLE}>
                  <PracticeColumn practiceId={practice.id} onViewPdf={onViewPdf} onCrossReference={onCrossReference} layout="phone" />
                </SimpleReadingContext.Provider>
              )}
            </div>
          )}
        </div>
      )}
      {!bound && save.overlay}
    </>
  );
}

/** The phone's head of the practice (R3), one row: its name, the count after it, and its «⋯» (spec §7, carry-over 15).
 *  The toast is portalled to the document in the toast band. */
function PhonePracticeHead({ practice, save }: { practice: Practice; save: PracticeSaveActions }) {
  const countLine = practiceCountLine(practiceCounts(practice));
  return (
    // One row (R3: the text first): the name, the count after it, then «⋯».
    <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h2 className={cn('flex min-h-[44px] min-w-0 items-center font-serif text-xl font-medium text-slate-900 dark:text-white', countLine && 'max-w-[70%] shrink-0')}>
          <span className="truncate">{practice.label}</span>
        </h2>
        {/* It gives way before the name does. */}
        {countLine && <p title={countLine} className="min-w-0 truncate text-xs text-slate-600 dark:text-slate-400">{countLine}</p>}
      </div>
      <MenuButton
        // Its 44 px reach into the page's margin, as every icon on the column's right edge (R3b).
        className="-mr-3"
        label={`Altre azioni per ${practice.label}`}
        triggerClassName="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        items={[
          ...save.items,
          { label: CLOSE_TABLE, icon: X, danger: true, separatorBefore: true, onSelect: () => closePracticeWithUndo(practice.id) },
        ]}
      >
        <MoreHorizontal size={18} aria-hidden />
      </MenuButton>
    </div>
  );
}
