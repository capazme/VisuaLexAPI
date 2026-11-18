import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, FolderPlus, MoreHorizontal, PanelRightOpen, Star, StickyNote, X } from 'lucide-react';
import { useAddToDossier, useHeldInLabel, type DossierTarget } from '../dossier/addFromResult';
import { HeldInMark } from '../dossier/HeldInMark';
import { cn } from '../../../lib/utils';
import { MenuButton } from '../../ui/MenuButton';
import { Expand } from '../../ui/Expand';
import { rowDossierItems, type RowDossier } from './inDossier';
import { RowMovePicker, RowNoteComposer } from './RowDossierPanels';

const ICON_BUTTON =
  'flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20';

/** A row that can be read beside the table: in a window on the desktop (spec §4.2, T5), in the
 *  full-screen reader on a phone (§8), where no row ever folds. */
export interface RowBeside {
  /** A window shows this subject: the row folds and says so. Always false on a phone. */
  shown: boolean;
  /** «Apri accanto»; asked of a window already open, it takes focus instead. */
  onOpen: () => void;
  /** «Chiudi la finestra»: the subject stays in the table. */
  onClose: () => void;
}

export interface PracticeRowShellProps {
  rowKey: string;
  isOpen: boolean;
  onToggle: () => void;
  /** The toggle's accessible name without the verb; it must contain the visible text. */
  name: string;
  /** The remove button's accessible name, after «Togli dal tavolo». */
  removeName: string;
  onRemove: () => void;
  /** The visible header content (label, rubrica, deposit, version chip). */
  header: ReactNode;
  /** Set on the open region (e.g. the reading toolbar's pin). */
  regionStyle?: CSSProperties;
  /** «Apri accanto», and on the desktop the fold of a row whose subject a window shows. */
  beside?: RowBeside;
  /** In a dossier's «Lettura» (LC55): whether the row is in the dossier, and its commands, in a «⋯» with their names
   *  instead of the bare «Togli dal tavolo». Absent in the Corpus, which draws as before. */
  dossier?: RowDossier;
  /** In the Corpus (LC59): what «Aggiungi al dossier» adds through the reader's popover, and the mark «Nel dossier
   *  «X»» or «In 2 dossier». Ignored when `dossier` is set: a dossier's «Lettura» keeps its own commands. */
  corpusItem?: DossierTarget;
  /** Mounted only while the row is open (and not shown beside). */
  children: ReactNode;
}

/** «Non nel dossier»: a small word, not an icon (§14). What is in the dossier says nothing: it is the rule. */
export function NotInDossier() {
  return (
    <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      Non nella pratica
    </span>
  );
}

const ADD_BUTTON =
  'min-h-[44px] flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50 md:min-h-0 dark:text-primary-300 dark:hover:bg-primary-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const MENU_TRIGGER =
  'flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 -mr-3 md:mr-0 md:min-h-0 md:min-w-0 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * The shell shared by the practice's rows (articles and decisions): a header that toggles the row
 * (accordion pattern), a hover-revealed «Togli dal tavolo», and the open region. The hover tint is
 * the header's: hovering the open text does not wash it. A closed row renders no children.
 */
export function PracticeRowShell({
  rowKey, isOpen: open, onToggle, name: shownName, removeName, onRemove, header, regionStyle, beside, dossier, corpusItem, children,
}: PracticeRowShellProps) {
  const outside = dossier !== undefined && !dossier.inDossier;
  const starred = dossier?.important === true;
  const corpus = dossier ? undefined : corpusItem;
  const notes = dossier?.inDossier ? dossier.notes : 0;
  const notesWords = notes === 1 ? '1 nota' : `${notes} note`;
  const toggleRef = useRef<HTMLDivElement>(null);
  // A note or a move asked from «⋯» (LC86), under the row.
  const [panel, setPanel] = useState<'note' | 'move' | null>(null);
  const heldIn = useHeldInLabel(corpus);
  const adding = useAddToDossier(corpus);
  // The toggle's name replaces its content: it carries the mark's words, and the star's (LC58).
  const name = (outside
    ? `${shownName}, non nella pratica`
    : starred
      ? `${shownName}, importante`
      : heldIn ? `${shownName}, ${heldIn.charAt(0).toLowerCase()}${heldIn.slice(1)}` : shownName)
    + (notes > 0 ? `, ${notesWords}` : '');
  const regionId = `practice-row-${rowKey}`;
  // One subject, one mounted reading surface (T5): a row shown in a window folds, whatever its stored
  // state, and comes back as it was when the window closes. Its header then points at the window.
  const folded = beside?.shown === true;
  const isOpen = open && !folded;
  return (
    <div
      data-practice-row={rowKey}
      // Read by the overview's strip of decisions (U2): an open row takes the strip's width.
      data-row-open={isOpen || undefined}
      // Clear of the act's sticky heading (`--practice-head`, set by the act block) when scrolled into view.
      // `@container`: a narrow column (the overview's decisions, a phone) keeps the row's name whole (LC59, #536).
      className="group @container scroll-mt-[calc(var(--practice-head,5rem)+0.5rem)] rounded-lg py-1 md:pl-2 md:pr-1"
    >
      <div className="flex items-center gap-1 rounded-lg transition-colors hover:bg-slate-50 md:gap-2 dark:hover:bg-slate-800/60">
        {/* The toggle wraps only text: the remove button stays outside it (gotcha 22). */}
        <div
          ref={toggleRef}
          role="button"
          tabIndex={0}
          // Folded because a window shows the subject, the header does not expand: it goes to the window.
          aria-label={folded ? `Vai alla finestra su ${name}` : `${isOpen ? 'Comprimi' : 'Espandi'} ${name}`}
          aria-expanded={folded ? undefined : isOpen}
          aria-controls={isOpen ? regionId : undefined}
          onClick={folded ? beside.onOpen : onToggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              (folded ? beside.onOpen : onToggle)();
            }
          }}
          className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('flex-shrink-0 text-slate-400 transition-transform', !isOpen && '-rotate-90')}
          />
          {header}
          {/* The dossier's notes about it (LC86), said on the row, open or closed. */}
          {notes > 0 && (
            <span aria-hidden title={notesWords} className="flex flex-shrink-0 items-center gap-0.5 text-xs text-amber-800 dark:text-amber-300">
              <StickyNote size={13} aria-hidden />
              {notes}
            </span>
          )}
          {starred && (
            <span aria-hidden title="Importante" className="flex-shrink-0 text-amber-600 dark:text-amber-400">
              <Star size={14} aria-hidden className="fill-amber-400" />
            </span>
          )}
          {outside && <NotInDossier />}
        </div>
        {/* Beside the mark on a computer; a phone has it in «⋯», where the row's name needs the width. */}
        {outside && dossier.add && (
          <button type="button" onClick={dossier.add} aria-label={`Aggiungi alla pratica ${removeName}`} className={cn(ADD_BUTTON, 'hidden md:flex')}>
            <FolderPlus size={14} aria-hidden />
            Aggiungi alla pratica
          </button>
        )}
        {corpus && (
          <button type="button" onClick={(e) => adding.open(e.currentTarget)} aria-label={`Aggiungi alla pratica ${removeName}`} title="Aggiungi alla pratica" className={cn(ADD_BUTTON, 'hidden md:flex')}>
            <FolderPlus size={14} aria-hidden />
            {/* Icon only in a narrow column: the row's name is never the one cut. */}
            <span className="hidden @[40rem]:inline">Aggiungi alla pratica</span>
          </button>
        )}
        {beside && (folded ? (
          <span className="flex flex-shrink-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            Aperto accanto ·
            <button
              type="button"
              onClick={beside.onClose}
              aria-label={`Chiudi la finestra su ${removeName}`}
              className="rounded px-1 font-medium text-primary-600 underline hover:text-primary-700 dark:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              Chiudi la finestra
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={beside.onOpen}
            aria-label={`Apri accanto ${removeName}`}
            title="Apri accanto"
            // 14 px in a dossier's «Lettura» (LC55, a reader of fifty); the Corpus keeps its 12.
            className={cn('practice-row-beside flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium', dossier ? 'text-sm' : 'text-xs', 'text-slate-500 md:min-h-0 md:min-w-0 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500')}
          >
            <PanelRightOpen size={14} aria-hidden />
            {/* Icon-only on a phone, where the row's name needs the width. */}
            <span className="hidden md:inline">Apri accanto</span>
          </button>
        ))}
        {dossier ? (
          <MenuButton
            label={`Azioni su ${removeName}`}
            triggerClassName={MENU_TRIGGER}
            items={rowDossierItems(dossier, onRemove, { note: () => setPanel('note'), move: () => setPanel('move') })}
          >
            <MoreHorizontal size={16} aria-hidden />
          </MenuButton>
        ) : (
          <>
            {/* A phone has «Aggiungi al dossier» in the row's «⋯», with its name; the popover is then the bottom sheet. */}
            {corpus && (
              <MenuButton
                label={`Azioni su ${removeName}`}
                className="md:hidden"
                triggerClassName={MENU_TRIGGER}
                items={[
                  { label: 'Aggiungi alla pratica', icon: FolderPlus, onSelect: () => adding.open(null) },
                  { label: 'Togli dal tavolo', icon: X, danger: true, onSelect: onRemove },
                ]}
              >
                <MoreHorizontal size={16} aria-hidden />
              </MenuButton>
            )}
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Togli dal tavolo ${removeName}`}
              title="Togli dal tavolo"
              // On a phone its 44 px reach into the page's margin, as every icon on the column's right edge (R3b).
              className={cn(ICON_BUTTON, '-mr-3 md:mr-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100', corpus && 'hidden md:flex')}
            >
              <X size={16} aria-hidden />
            </button>
          </>
        )}
        {adding.popover}
      </div>
      {/* The mark goes under the name, never beside it: the row's name is never the one cut (#536). */}
      {heldIn && (
        <div className="flex pl-7 md:pl-8">
          <HeldInMark label={heldIn} className="max-w-full" />
        </div>
      )}
      {dossier && (
        <>
          <Expand open={panel === 'note'} onClose={() => setPanel(null)}>
            <RowNoteComposer name={removeName} onSave={dossier.addNote} onDone={() => setPanel(null)} />
          </Expand>
          <Expand open={panel === 'move'} onClose={() => setPanel(null)}>
            <RowMovePicker onMove={dossier.moveTo} onDone={() => setPanel(null)} />
          </Expand>
        </>
      )}
      {dossier ? (
        // A dossier's «Fonti» (LC86, L-73): the row opens in place, the space growing under its heading and pushing the
        // rest down (`Expand`, the island's times). The focus stays on the heading; no Esc, which is the reader's. Clipped
        // on the height alone, and with `clip`, not `hidden`: the reader's toolbar keeps sticking to the page's
        // scroller and the glosses' margin is not cut at the side. Brought into view on opening, it keeps the row's heading
        // (its 44 px, the command that closes it) clear under the act's sticky head.
        <Expand open={isOpen} initialFocusRef={toggleRef} className="scroll-mt-[calc(var(--practice-head,0px)+3rem)] overflow-x-visible overflow-y-clip">
          <div id={regionId} className="pb-3 pt-1 md:pl-6 md:pr-2" style={regionStyle}>
            {children}
          </div>
        </Expand>
      ) : isOpen && (
        // Opacity only, 150 ms: a row opens tens of times a day, and a transform here would move the
        // reader's sticky toolbar and fixed popovers while it plays (gotchas 22, 26).
        <div id={regionId} className="animate-in fade-in duration-150 pb-3 pt-1 md:pl-6 md:pr-2" style={regionStyle}>
          {children}
        </div>
      )}
    </div>
  );
}
