import { useEffect, useRef, useState } from 'react';
import { FolderPlus, MoreHorizontal, Pencil, X } from 'lucide-react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { useTour } from '../../../hooks/useTour';
import type { ArticleData } from '../../../types';
import { MenuButton } from '../../ui/MenuButton';
import { PAGE_TITLE } from '../../layout/PageFrame';
import { cn } from '../../../lib/utils';
import { practiceCountLine, practiceCounts, type Practice } from '../../../utils/practice';
import { isEmptyPractice } from './practiceView';
import { closePracticeWithUndo } from './practiceUndo';
import { usePracticeSaveActions } from './usePracticeSaveActions';
import { PracticeColumn } from './PracticeColumn';
import { PracticeEmpty, PracticeNameInput, PracticeStreamingBar, type PracticeStreaming } from './PracticeParts';

export interface PracticeTableProps {
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string) => void;
  streaming: PracticeStreaming | null;
}

/**
 * The active practice's table on the desktop (spec §3): its header (name, count line, «Salva come
 * dossier», «⋯»), the streaming bar of a search landing in it, then its column. An empty practice
 * says so. Topic searches are windows beside it (`ReadingRow`, T8); the phone's table keeps its band. (The migration's notice is `SearchPanel`'s, over both layouts.)
 */
export function PracticeTable({ onViewPdf, onCrossReference, streaming }: PracticeTableProps) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === s.activePracticeId));
  const theme = useAppStore((s) => s.settings.theme);
  // The tour of the table, once; when it is done the act's follows (`PracticeActBlock`).
  const { tryStartTour } = useTour({ theme: theme as 'light' | 'dark', onComplete: (type) => {
    // the act's tour follows, when the practice has an act to show
    const held = appStore.getState().practices.find((p) => p.id === appStore.getState().activePracticeId);
    if (type === 'practice' && held && held.acts.length > 0) tryStartTour('practiceAct');
  } });
  // Asked once: `tryStartTour` is a new function on every render, so the effect cannot key on it.
  const tourAsked = useRef(false);
  const drawn = practice !== undefined;
  useEffect(() => {
    if (!drawn || tourAsked.current) return;
    tourAsked.current = true;
    tryStartTour('practice');
  });
  if (!practice) return null;
  return (
    <div data-testid="practice-table" className="mx-auto w-full max-w-4xl space-y-3">
      <PracticeHeader practice={practice} />
      <PracticeStreamingBar streaming={streaming} practiceId={practice.id} />
      {isEmptyPractice(practice) ? (
        <PracticeEmpty />
      ) : (
        <PracticeColumn practiceId={practice.id} onViewPdf={onViewPdf} onCrossReference={onCrossReference} />
      )}
    </div>
  );
}

function PracticeHeader({ practice }: { practice: Practice }) {
  const renamePractice = useAppStore((s) => s.renamePractice);
  const [editing, setEditing] = useState(false);
  const countLine = practiceCountLine(practiceCounts(practice));
  const save = usePracticeSaveActions(practice.id);

  return (
    <header id="tour-practice-header" data-pinned-head className="flex items-start gap-2 px-1 pb-2">
      <div className="min-w-0 flex-1">
        {editing ? (
          <PracticeNameInput
            initial={practice.label}
            className={cn('w-full', PAGE_TITLE)}
            onDone={(name) => {
              setEditing(false);
              if (name !== null) renamePractice(practice.id, name);
            }}
          />
        ) : (
          // The page's title, as every section page writes it (`PageFrame`'s `PAGE_TITLE`, R3).
          <h2
            onDoubleClick={() => setEditing(true)}
            title="Doppio clic per rinominare"
            className={cn('truncate', PAGE_TITLE)}
          >
            {practice.label}
          </h2>
        )}
        {countLine && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{countLine}</p>}
      </div>
      <button
        type="button"
        onClick={save.saveAsNew}
        disabled={save.busy}
        id="tour-practice-save"
        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:py-1.5 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <FolderPlus size={16} aria-hidden />
        Salva come dossier
      </button>
      <MenuButton
        label={`Altre azioni per la pratica ${practice.label}`}
        triggerClassName="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 md:min-h-0 md:min-w-0 md:p-2 dark:text-slate-300 dark:hover:bg-slate-800"
        items={[
          { label: 'Rinomina', icon: Pencil, onSelect: () => setEditing(true) },
          ...save.items,
          { label: 'Chiudi la pratica', icon: X, danger: true, separatorBefore: true, onSelect: () => closePracticeWithUndo(practice.id) },
        ]}
      >
        <MoreHorizontal size={18} aria-hidden />
      </MenuButton>
      {save.overlay}
    </header>
  );
}
