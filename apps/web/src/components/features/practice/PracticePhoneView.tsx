import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FolderPlus, Layers, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { appStore, useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { cn } from '../../../lib/utils';
import { practiceCountLine, practiceCounts, type Practice } from '../../../utils/practice';
import { Modal } from '../../ui/Modal';
import { MenuButton } from '../../ui/MenuButton';
import { PracticeColumn } from './PracticeColumn';
import { ReadingFullScreen } from './ReadingFullScreen';
import { PracticeEmpty, PracticeNameInput, PracticeStreamingBar, type PracticeStreaming } from './PracticeParts';
import { fromPracticePair, practicePair, scrollParentOf } from './practiceView';
import { closePracticeWithUndo } from './practiceUndo';
import { usePracticeSaveActions, type PracticeSaveActions } from './usePracticeSaveActions';

export interface PracticePhoneViewProps {
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string) => void;
  streaming: PracticeStreaming | null;
}

const NEW_PRACTICE_LABEL = 'Nuova pratica';

/** How long the column's scroll position is asked for again while its content arrives. */
const SETTLE_MS = 3000;
/** What a user's own scroll starts with: it ends the asking. */
const USER_SCROLL = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

// 44 px touch targets (apps/web/CLAUDE.md, «Mobile-first»).
const CHEVRON =
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl shadow-sm transition-[color,background-color,border-color,scale] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const CHEVRON_ON =
  'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700';
const CHEVRON_OFF = 'bg-slate-50 text-slate-300 dark:bg-slate-900 dark:text-slate-700';

/**
 * The phone's table (spec §8): a header that switches practices — the chevrons, the name (a tap on it
 * lists the practices, with «+ Nuova pratica»), one dot per practice — over the active practice's
 * «Salva come dossier» and its column, rows opening in place. «Apri accanto», a decision opened from a
 * link and a topic search read in the full-screen reader instead (`phoneReader`, T19), which takes
 * the column's place — the column is not kept mounted under it (gotcha 26) — and gives it back at the
 * scroll position it left. The practice on screen is the active one, so the store's routing, the way
 * back and the find window all name the same practice on both breakpoints. The migration's notice is
 * `SearchPanel`'s, over both layouts.
 */
export function PracticePhoneView({ onViewPdf, onCrossReference, streaming }: PracticePhoneViewProps) {
  const practices = useAppStore(useShallow((s) => s.practices.map(practicePair)));
  const activePracticeId = useAppStore((s) => s.activePracticeId);
  const practice = useAppStore((s) => s.practices.find((p) => p.id === s.activePracticeId));
  const setActivePractice = useAppStore((s) => s.setActivePractice);
  // The reader is drawn for the practice on screen only: one whose practice is not the active one is stale.
  const readerOpen = useAppStore((s) => s.phoneReader !== null && s.phoneReader.practiceId === s.activePracticeId &&
    s.practices.some((p) => p.id === s.phoneReader?.practiceId));
  const [listing, setListing] = useState(false);
  // The save's picker and toast belong to the view, not to the column the reader replaces: an outcome
  // arriving while the reader is open is not lost.
  const save = usePracticeSaveActions(practice?.id ?? '');

  const list = practices.map(fromPracticePair);
  const index = list.findIndex((p) => p.id === activePracticeId);
  const go = (to: number) => {
    const target = list[to];
    if (target) setActivePractice(target.id);
  };

  // The column's scroll position (the page's content scroller) is kept, with its practice, while the
  // column is drawn and given back when the reader closes on the same practice — unless a row is
  // waiting to be revealed, which scrolls to itself. The column remounts short and its open rows'
  // content arrives afterwards, so one write at mount would be clamped and lost: the position is
  // asked for again each time the view grows, until it is reached, the user scrolls, or SETTLE_MS pass.
  const rootRef = useRef<HTMLDivElement>(null);
  const lastTop = useRef<{ practiceId: string | null; top: number }>({ practiceId: null, top: 0 });
  const restore = useRef<string | null>(null);
  const shownPractice = useRef(activePracticeId);
  // (declared before the effect that reads it: layout effects run in order)
  useLayoutEffect(() => { shownPractice.current = activePracticeId; });
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
      if (kept === shownPractice.current && lastTop.current.practiceId === kept && !appStore.getState().pendingReveal) {
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
          if (appStore.getState().pendingReveal) return stop(true);
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

  if (list.length === 0) return null;
  // The save's picker and toast are one stable sibling of whichever branch is drawn: opening the
  // reader does not remount the picker.
  return (
    <>
      {readerOpen ? <ReadingFullScreen onCrossReference={onCrossReference} /> : (
        <div ref={rootRef} data-testid="practice-phone-view" className="flex w-full flex-col bg-slate-50 dark:bg-slate-950">
          {/* Under the search page's field, the phone's bar with the menu button beside it: no inset. */}
          <div className="flex-shrink-0 border-b border-slate-200 bg-white/80 px-4 py-2 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => go(index - 1)}
                disabled={index <= 0}
                aria-label="Pratica precedente"
                className={cn(CHEVRON, index <= 0 ? CHEVRON_OFF : CHEVRON_ON)}
              >
                <ChevronLeft size={20} aria-hidden />
              </button>
              <div className="min-w-0 flex-1 px-4 text-center">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  <button
                    type="button"
                    onClick={() => setListing(true)}
                    aria-haspopup="dialog"
                    title="Elenco delle pratiche"
                    className="inline-flex min-h-[44px] max-w-full items-center justify-center gap-1 rounded-lg px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <span className="truncate">{practice?.label ?? ''}</span>
                    <ChevronDown size={16} aria-hidden className="flex-shrink-0 text-slate-400" />
                  </button>
                </h2>
                {/* Each dot is a 44 px button around a small visual dot; many practices wrap. */}
                <div className="flex flex-wrap justify-center">
                  {list.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => go(i)}
                      aria-label={`Pratica ${i + 1}: ${p.label}`}
                      aria-current={i === index ? 'true' : undefined}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'block h-1.5 rounded-full transition-[width,background-color] duration-300',
                          i === index ? 'w-6 bg-primary-500' : 'w-1.5 bg-slate-300 dark:bg-slate-700',
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => go(index + 1)}
                disabled={index < 0 || index >= list.length - 1}
                aria-label="Pratica successiva"
                className={cn(CHEVRON, index < 0 || index >= list.length - 1 ? CHEVRON_OFF : CHEVRON_ON)}
              >
                <ChevronRight size={20} aria-hidden />
              </button>
            </div>
          </div>
          {practice && (
            <div className="space-y-4 p-4">
              <PhonePracticeActions practice={practice} save={save} />
              <PracticeStreamingBar streaming={streaming} practiceId={practice.id} />
              {practice.acts.length === 0 && practice.decisions.length === 0 ? (
                <PracticeEmpty />
              ) : (
                <PracticeColumn practiceId={practice.id} onViewPdf={onViewPdf} onCrossReference={onCrossReference} />
              )}
            </div>
          )}
          <PracticeList isOpen={listing} onClose={() => setListing(false)} />
        </div>
      )}
      {save.overlay}
    </>
  );
}

/** The count line, «Salva come dossier» and its «⋯» (spec §7, carry-over 15): the desktop header's
 *  save actions, on a phone. The toast is portalled to the document in the toast band. */
function PhonePracticeActions({ practice, save }: { practice: Practice; save: PracticeSaveActions }) {
  const countLine = practiceCountLine(practiceCounts(practice));
  return (
    <div className="space-y-2">
      {/* The count has its own line: it is never cut by the buttons. */}
      {countLine && <p className="text-sm text-slate-500 dark:text-slate-400">{countLine}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save.saveAsNew}
          disabled={save.busy}
          className="inline-flex min-h-[44px] min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <FolderPlus size={16} aria-hidden className="shrink-0" />
          Salva come dossier
        </button>
        <MenuButton
          label={`Altre azioni per la pratica ${practice.label}`}
          triggerClassName="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          items={save.items}
        >
          <MoreHorizontal size={18} aria-hidden />
        </MenuButton>
      </div>
    </div>
  );
}

/** A tap on the practice's name: every practice to switch to, each with «⋯» (Rinomina, Chiudi la
 *  pratica — the bar's chip actions, the same confirmation), and «+ Nuova pratica» (spec §8). */
function PracticeList({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const practices = useAppStore((s) => s.practices);
  const createPractice = useAppStore((s) => s.createPractice);
  const [editingId, setEditingId] = useState<string | null>(null);
  const row =
    'flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:hover:bg-primary-900/10';

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" title="Le tue pratiche" icon={<Layers size={18} />} variant="info" contentClassName="p-0">
      <div className="space-y-1 px-2 py-2">
        {practices.map((p) => (
          <PracticeListRow
            key={p.id}
            practice={p}
            rowClass={row}
            editing={editingId === p.id}
            onEditingChange={(editing) => setEditingId(editing ? p.id : null)}
            onPicked={onClose}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            createPractice(NEW_PRACTICE_LABEL, { activate: true });
            onClose();
          }}
          className={cn(row, 'border-t border-slate-100 text-primary-700 dark:border-slate-800 dark:text-primary-300')}
        >
          <Plus size={16} aria-hidden className="shrink-0" />
          <span className="text-sm font-medium">Nuova pratica</span>
        </button>
      </div>
    </Modal>
  );
}

function PracticeListRow({ practice, rowClass, editing, onEditingChange, onPicked }: {
  practice: Practice;
  rowClass: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onPicked: () => void;
}) {
  const isActive = useAppStore((s) => s.activePracticeId === practice.id);
  const setActivePractice = useAppStore((s) => s.setActivePractice);
  const renamePractice = useAppStore((s) => s.renamePractice);
  const counts = practiceCountLine(practiceCounts(practice));

  return (
    <div className="flex items-center gap-1">
      {editing ? (
        <div className="flex min-h-[44px] min-w-0 flex-1 items-center px-1">
          <PracticeNameInput
            initial={practice.label}
            className="min-h-[44px] w-full text-sm font-medium"
            onDone={(name) => {
              onEditingChange(false);
              if (name !== null) renamePractice(practice.id, name);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          aria-current={isActive ? 'true' : undefined}
          onClick={() => {
            setActivePractice(practice.id);
            onPicked();
          }}
          className={cn(rowClass, 'min-w-0 flex-1', isActive && 'bg-primary-50 dark:bg-primary-900/20')}
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-200">{practice.label}</span>
          {counts && <span className="max-w-[45%] shrink-0 truncate text-xs text-slate-400 dark:text-slate-500">{counts}</span>}
        </button>
      )}
      <MenuButton
        label={`Altre azioni per la pratica ${practice.label}`}
        triggerClassName="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        items={[
          { label: 'Rinomina', icon: Pencil, onSelect: () => onEditingChange(true) },
          { label: 'Chiudi la pratica', icon: X, danger: true, separatorBefore: true, onSelect: () => closePracticeWithUndo(practice.id) },
        ]}
      >
        <MoreHorizontal size={18} aria-hidden />
      </MenuButton>
    </div>
  );
}
