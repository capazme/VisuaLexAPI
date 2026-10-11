import { useState } from 'react';
import { MoreHorizontal, Pencil, X } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { MenuButton } from '../../ui/MenuButton';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { practiceCountLine, practiceCounts, type Practice } from '../../../utils/practice';
import { CLOSE_PRACTICE_MESSAGE, isEmptyPractice } from './practiceView';
import { PracticeColumn } from './PracticeColumn';
import { PracticeTopicSearches } from './PracticeTopicSearches';
import {
  PracticeEmpty, PracticeNameInput, PracticeNotice, PracticeStreamingBar, type PracticeStreaming,
} from './PracticeParts';

export interface PracticeTableProps {
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  streaming: PracticeStreaming | null;
}

/**
 * The active practice's table on the desktop (spec §3): its header (name, count line, «⋯»), the
 * streaming bar of a search landing in it, the topic searches' band (P3, T8), then its column.
 * An empty practice says so. The migration's notice is taken here once (§9).
 */
export function PracticeTable({ onViewPdf, onCrossReference, streaming }: PracticeTableProps) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === s.activePracticeId));
  return (
    <>
      <PracticeNotice />
      {practice && (
        <div data-testid="practice-table" className="mx-auto w-full max-w-4xl space-y-3">
          <PracticeHeader practice={practice} />
          <PracticeStreamingBar streaming={streaming} practiceId={practice.id} />
          {isEmptyPractice(practice) ? (
            <PracticeEmpty />
          ) : (
            <>
              <PracticeTopicSearches practiceId={practice.id} />
              <PracticeColumn practiceId={practice.id} onViewPdf={onViewPdf} onCrossReference={onCrossReference} />
            </>
          )}
        </div>
      )}
    </>
  );
}

function PracticeHeader({ practice }: { practice: Practice }) {
  const renamePractice = useAppStore((s) => s.renamePractice);
  const closePractice = useAppStore((s) => s.closePractice);
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const countLine = practiceCountLine(practiceCounts(practice));

  return (
    <header className="flex items-start gap-2 px-1">
      <div className="min-w-0 flex-1">
        {editing ? (
          <PracticeNameInput
            initial={practice.label}
            className="w-full text-xl font-bold"
            onDone={(name) => {
              setEditing(false);
              if (name !== null) renamePractice(practice.id, name);
            }}
          />
        ) : (
          <h2
            onDoubleClick={() => setEditing(true)}
            title="Doppio clic per rinominare"
            className="truncate text-xl font-bold text-slate-900 dark:text-white"
          >
            {practice.label}
          </h2>
        )}
        {countLine && <p className="text-sm text-slate-500 dark:text-slate-400">{countLine}</p>}
      </div>
      <MenuButton
        label={`Altre azioni per la pratica ${practice.label}`}
        triggerClassName="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 md:min-h-0 md:min-w-0 md:p-2 dark:text-slate-300 dark:hover:bg-slate-800"
        items={[
          { label: 'Rinomina', icon: Pencil, onSelect: () => setEditing(true) },
          { label: 'Chiudi la pratica', icon: X, danger: true, separatorBefore: true, onSelect: () => setConfirmClose(true) },
        ]}
      >
        <MoreHorizontal size={18} aria-hidden />
      </MenuButton>
      <ConfirmDialog
        open={confirmClose}
        variant="danger"
        title={`Chiudere la pratica «${practice.label}»?`}
        message={CLOSE_PRACTICE_MESSAGE}
        confirmLabel="Chiudi la pratica"
        onConfirm={() => {
          setConfirmClose(false);
          closePractice(practice.id);
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </header>
  );
}
