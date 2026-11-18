import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, Pencil, X } from 'lucide-react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { useTour } from '../../../hooks/useTour';
import type { ArticleData } from '../../../types';
import { MenuButton } from '../../ui/MenuButton';
import { PAGE_TITLE } from '../../layout/PageFrame';
import { cn } from '../../../lib/utils';
import { isBoundPractice, practiceCountLine, practiceCounts, type Practice } from '../../../utils/practice';
import { isEmptyPractice } from './practiceView';
import { CLOSE_TABLE, closePracticeWithUndo, tableItemsForAct } from './practiceUndo';
import { PRACTICE_VT, practiceTransitionName } from './practiceSwitch';
import { usePracticeSaveActions } from './usePracticeSaveActions';
import { PracticeColumn } from './PracticeColumn';
import { SimpleReadingContext, isOneActPractice, isSimplePractice } from './simpleReading';
import { useHostedPractice } from './readingHost';
import { PracticeEmpty, PracticeNameInput, PracticeStreamingBar, TableNameLine, type PracticeStreaming } from './PracticeParts';

export interface PracticeTableProps {
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string) => void;
  streaming: PracticeStreaming | null;
  /** The overview (the acts a grid of panels) or the reading view's index, beside the windows (U2, `ReadingRow`). */
  layout: 'overview' | 'index';
  /** Mounted but hidden (the rail's overlay, closed): it asks for no tour, whose steps would point at nothing drawn. */
  concealed?: boolean;
  /** The practice to show (LC52 c2: a dossier's bound table); without it, the Corpus's active one. */
  practiceId?: string;
}

/**
 * A practice's table on the desktop — the one given, else the Corpus's active one — (spec §3): its header (name, count line,
 * «⋯»; LC60: no «Salva come dossier», the Ricerca's table is the session's), the streaming bar of a search landing in it, then its column — the overview's grid, or the index of
 * the reading view, where the header is compact. An empty practice says so. Topic searches are windows beside it
 * (`ReadingRow`, T8); the phone's table keeps its band. (The migration's notice is `SearchPanel`'s, over both layouts.)
 */
export function PracticeTable({ onViewPdf, onCrossReference, streaming, layout, concealed = false, practiceId }: PracticeTableProps) {
  const practice = useHostedPractice(practiceId);
  const theme = useAppStore((s) => s.settings.theme);
  // The tour of the table, once; when it is done the act's follows (`PracticeActBlock`).
  const { tryStartTour } = useTour({ theme: theme as 'light' | 'dark', onComplete: (type) => {
    // the act's tour follows, when the practice has an act to show in the overview (its steps are the panel's)
    const held = appStore.getState().practices.find((p) => p.id === (practiceId ?? appStore.getState().activePracticeId));
    if (type === 'practice' && held && held.acts.length > 0 && held.beside.length === 0) tryStartTour('practiceAct');
  } });
  // Asked once: `tryStartTour` is a new function on every render, so the effect cannot key on it.
  const tourAsked = useRef(false);
  const drawn = practice !== undefined;
  // A dossier's table (LC54) is not a practice of the Corpus: none of the practice's tours.
  const bound = practice !== undefined && isBoundPractice(practice);
  useEffect(() => {
    if (!drawn || concealed || bound || tourAsked.current) return;
    tourAsked.current = true;
    tryStartTour('practice');
  });
  if (!practice) return null;
  // A dossier's «Fonti» (LC86): its one article a closed row as any other, never Lettura semplice.
  const simple = layout === 'overview' && isSimplePractice(practice) && !bound;
  // LC68: one act with more articles is named by its own heading too; the head would repeat it as «c.c.».
  const headless = layout === 'overview' && isOneActPractice(practice) && practice.beside.length === 0;
  return (
    // The frame's width (U1): its rows widen, the text they open stays at the reading measure (`.vlx-art`).
    <div
      data-testid="practice-table"
      // Lettura semplice (LC28): the article takes the room it needs, the measure; the whole frame only when its margin
      // has notes or glosses to set beside the text (`AnnotationMargin` needs 52rem for its column). LC70: so does one
      // act with more articles, the same card as with one (Luca: «se apro due articoli si scassa tutto»). LC74: an
      // article's glosses widen it to the right by their margin (21.25rem and its 1.5rem), the text where it was. LC90:
      // the notes' column keeps that same width, not the frame's: the text does not slide when the glosses go into it.
      data-glosses-room={headless ? '' : undefined}
      className={cn('w-full space-y-3', headless && 'max-w-[44rem] has-[[data-margin-content]]:max-w-[66.75rem] has-[[data-glosses-beside]]:max-w-[66.75rem]')}
    >
      <PracticeHeader practice={practice} compact={layout === 'index'} simple={simple} headless={headless}>
        <PracticeStreamingBar streaming={streaming} practiceId={practice.id} />
        {isEmptyPractice(practice) ? (
          <PracticeEmpty />
        ) : (
          <PracticeColumn practiceId={practice.id} onViewPdf={onViewPdf} onCrossReference={onCrossReference} layout={layout} />
        )}
      </PracticeHeader>
    </div>
  );
}

/** The index's title (U2): the act headings' serif, a step larger than theirs, so the name fits a 320 px column. */
const INDEX_TITLE = 'font-serif text-[22px] font-medium leading-tight text-slate-900 dark:text-white';

/** In the index (`compact`) the name is smaller. A dossier's table
 *  (LC54) draws none of it: the dossier's page already names it, and its name, count and actions are the Corpus's. */
function PracticeHeader({ practice, compact, simple, headless, children }: { practice: Practice; compact: boolean; simple: boolean; headless: boolean; children: ReactNode }) {
  const renamePractice = useAppStore((s) => s.renamePractice);
  const [editing, setEditing] = useState(false);
  const countLine = practiceCountLine(practiceCounts(practice));
  const save = usePracticeSaveActions(practice.id);
  const bound = isBoundPractice(practice);
  // One act (LC28, LC68): one head, the act's; the table's name small over its title, its actions in the act's «⋯».
  const one = headless && !bound;
  const reading = useMemo(() => ({
    simple,
    practiceItems: one ? tableItemsForAct(save.items, practice.id, () => setEditing(true)) : [],
    tableName: one ? (
      <TableNameLine
        id="tour-practice-header"
        label={practice.label}
        editing={editing}
        onDone={(name) => {
          setEditing(false);
          if (name !== null) renamePractice(practice.id, name);
        }}
      />
    ) : undefined,
  }), [simple, one, save.items, practice.id, practice.label, editing, renamePractice]);

  if (bound) return <SimpleReadingContext.Provider value={reading}>{children}</SimpleReadingContext.Provider>;

  if (headless) {
    return (
      <>
        {save.overlay}
        <SimpleReadingContext.Provider value={reading}>{children}</SimpleReadingContext.Provider>
      </>
    );
  }

  return (
    <>
    <header
      id="tour-practice-header"
      data-pinned-head
      // One piece of the passage between the views (L-62): the overview's title becomes the index's.
      style={{ ['--vlx-vt' as string]: practiceTransitionName('practice-head') }}
      className={cn('flex items-start gap-2 px-1 pb-2', PRACTICE_VT)}
    >
      <div className="min-w-0 flex-1">
        {editing ? (
          <PracticeNameInput
            initial={practice.label}
            className={cn('w-full', compact ? INDEX_TITLE : PAGE_TITLE)}
            onDone={(name) => {
              setEditing(false);
              if (name !== null) renamePractice(practice.id, name);
            }}
          />
        ) : (
          // The page's title, as every section page writes it (`PageFrame`'s `PAGE_TITLE`, R3).
          <h2
            onDoubleClick={() => setEditing(true)}
            title={compact ? `${practice.label} · doppio clic per rinominare` : 'Doppio clic per rinominare'}
            className={cn('truncate', compact ? INDEX_TITLE : PAGE_TITLE)}
          >
            {practice.label}
          </h2>
        )}
        {countLine && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{countLine}</p>}
      </div>
      <MenuButton
        label={`Altre azioni per ${practice.label}`}
        triggerClassName="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 md:min-h-0 md:min-w-0 md:p-2 dark:text-slate-300 dark:hover:bg-slate-800"
        items={[
          { label: 'Rinomina', icon: Pencil, onSelect: () => setEditing(true) },
          ...save.items,
          { label: CLOSE_TABLE, icon: X, danger: true, separatorBefore: true, onSelect: () => closePracticeWithUndo(practice.id) },
        ]}
      >
        <MoreHorizontal size={18} aria-hidden />
      </MenuButton>
      {save.overlay}
    </header>
    <SimpleReadingContext.Provider value={reading}>{children}</SimpleReadingContext.Provider>
    </>
  );
}
