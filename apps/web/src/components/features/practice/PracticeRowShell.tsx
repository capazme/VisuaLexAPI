import { useMemo, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ChevronDown, FolderPlus, MoreHorizontal, PanelRightOpen, Star, StickyNote, X } from 'lucide-react';
import { useAddToDossier, useHeldInLabel, type DossierTarget } from '../dossier/addFromResult';
import { HeldInMark } from '../dossier/HeldInMark';
import { cn } from '../../../lib/utils';
import { MenuButton } from '../../ui/MenuButton';
import { Expand } from '../../ui/Expand';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { buttonClassName } from '../../ui/buttonStyles';
import { rowDossierItems, type RowDossier } from './inDossier';
import { RowMovePicker, RowNoteComposer } from './RowDossierPanels';
import { useFontiTools } from './fontiTools';


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

/** The row's commands on `Button`'s quiet look: 36 px on a computer, 44 on a phone. */
const ROW_COMMAND = 'shrink-0 gap-1 px-2';
/** «Azioni» (the row's «⋯»): `IconButton`'s square; on a phone its 44 px reach into the page's margin (R3b). */
const ROW_MENU = cn(buttonClassName('quiet'), 'min-w-11 shrink-0 px-0 -mr-3 md:mr-0 md:min-w-9');

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
  // Opening, the focus stays where it is: on the heading clicked, on the act's arrows or chips that revealed the row.
  const focusWhereItIs = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() { return document.activeElement instanceof HTMLElement ? document.activeElement : null; },
  }), []);
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
  // «Seleziona» on in «Fonti» (LC88): a row of the dossier carries a checkbox, and the Space on its heading ticks it.
  const tools = useFontiTools();
  const selectable = tools?.selecting === true && dossier !== undefined && dossier.itemIds.length > 0;
  const ticked = selectable && dossier.itemIds.some((id) => tools.selected.has(id));
  // One subject, one mounted reading surface (T5): a row shown in a window folds, whatever its stored
  // state, and comes back as it was when the window closes. Its header then points at the window.
  const folded = beside?.shown === true;
  const isOpen = open && !folded;
  return (
    <div
      data-practice-row={rowKey}
      // The dossier's entries on this row, for «Cronologia»'s «Apri nella pratica» (LC137).
      data-dossier-entries={dossier?.itemIds.join(' ') || undefined}
      // Read by the overview's strip of decisions (U2): an open row takes the strip's width.
      data-row-open={isOpen || undefined}
      // Clear of the act's sticky heading (`--practice-head`, set by the act block) when scrolled into view.
      // `@container`: a narrow column (the overview's decisions, a phone) keeps the row's name whole (LC59, #536).
      className="group @container scroll-mt-[calc(var(--practice-head,5rem)+0.5rem)] rounded-[8px] py-1 md:pl-2 md:pr-1"
    >
      <div className="flex items-center gap-1 rounded-[8px] transition-colors hover:bg-slate-50 md:gap-2 dark:hover:bg-slate-800/60">
        {/* Outside the toggle (gotcha 22): its own control, 44 px to touch. */}
        {selectable && (
          <label className="-ml-2 flex min-h-[44px] min-w-[44px] flex-shrink-0 cursor-pointer items-center justify-center md:ml-0 md:min-h-0 md:min-w-0 md:p-1">
            {/* bare-input: the row's checkbox while selecting, inside its 44 px label. */}
            <input
              type="checkbox"
              checked={ticked}
              onChange={() => tools.toggle(dossier.itemIds)}
              aria-label={`Seleziona ${removeName}`}
              // The theme's colours, as the app's other checkboxes: never a white box in the dark.
              className="h-4 w-4 accent-primary-600 focus-visible:outline-none dark:accent-primary-300 dark:[color-scheme:dark]"
            />
          </label>
        )}
        {/* The toggle wraps only text: the remove button stays outside it (gotcha 22). */}
        <div
          role="button"
          tabIndex={0}
          // Folded because a window shows the subject, the header does not expand: it goes to the window.
          // While selecting, the heading says whether the row is ticked: the Space on it ticks it.
          aria-label={(folded ? `Vai alla finestra su ${name}` : `${isOpen ? 'Comprimi' : 'Espandi'} ${name}`)
            + (selectable ? (ticked ? ', selezionato' : ', non selezionato') : '')}
          aria-expanded={folded ? undefined : isOpen}
          aria-controls={isOpen ? regionId : undefined}
          onClick={folded ? beside.onOpen : onToggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === ' ' && selectable) {
              e.preventDefault();
              tools.toggle(dossier.itemIds);
            } else if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              (folded ? beside.onOpen : onToggle)();
            }
          }}
          className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 md:min-h-0 focus-visible:outline-none "
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
          <Button type="button" variant="quiet" onClick={dossier.add} aria-label={`Aggiungi alla pratica ${removeName}`} icon={<FolderPlus size={14} aria-hidden />} className={cn(ROW_COMMAND, 'hidden md:inline-flex')}>
            Aggiungi alla pratica
          </Button>
        )}
        {corpus && (
          <Button type="button" variant="quiet" onClick={adding.open} aria-expanded={adding.isOpen} aria-controls={adding.id} aria-label={`Aggiungi alla pratica ${removeName}`} title="Aggiungi alla pratica" icon={<FolderPlus size={14} aria-hidden />} className={cn(ROW_COMMAND, 'hidden md:inline-flex')}>
            {/* Icon only in a narrow column: the row's name is never the one cut. */}
            <span className="hidden @[40rem]:inline">Aggiungi alla pratica</span>
          </Button>
        )}
        {beside && (folded ? (
          <span className="flex flex-shrink-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            Aperto accanto ·
            <Button type="button" variant="link" onClick={beside.onClose} aria-label={`Chiudi la finestra su ${removeName}`}>
              Chiudi la finestra
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            variant="quiet"
            onClick={beside.onOpen}
            aria-label={`Apri accanto ${removeName}`}
            title="Apri accanto"
            icon={<PanelRightOpen size={14} aria-hidden />}
            // 14 px in a dossier's «Lettura» (LC55, a reader of fifty); the Corpus keeps its 12. Square on a phone.
            className={cn('practice-row-beside min-w-11 md:min-w-0', ROW_COMMAND, dossier ? 'text-sm' : 'text-xs')}
          >
            {/* Icon-only on a phone, where the row's name needs the width. */}
            <span className="hidden md:inline">Apri accanto</span>
          </Button>
        ))}
        {dossier ? (
          <MenuButton
            label={`Azioni su ${removeName}`}
            triggerClassName={ROW_MENU}
            items={rowDossierItems(dossier, onRemove, { note: dossier.addNote && (() => setPanel('note')), move: () => setPanel('move') })}
          >
            <MoreHorizontal size={16} aria-hidden />
          </MenuButton>
        ) : (
          <>
            {/* A phone has «Aggiungi al dossier» in the row's «⋯», with its name; it opens the same space under the row. */}
            {corpus && (
              <MenuButton
                label={`Azioni su ${removeName}`}
                className="md:hidden"
                triggerClassName={ROW_MENU}
                items={[
                  { label: 'Aggiungi alla pratica', icon: FolderPlus, onSelect: adding.open },
                  { label: 'Togli dal tavolo', icon: X, danger: true, onSelect: onRemove },
                ]}
              >
                <MoreHorizontal size={16} aria-hidden />
              </MenuButton>
            )}
            <IconButton
              onClick={onRemove}
              aria-label={`Togli dal tavolo ${removeName}`}
              title="Togli dal tavolo"
              icon={<X aria-hidden />}
              // On a phone its 44 px reach into the page's margin, as every icon on the column's right edge (R3b).
              className={cn('shrink-0 -mr-3 text-slate-400 hover:bg-red-50 hover:text-red-500 md:mr-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-red-900/20', corpus && 'hidden md:inline-flex')}
            />
          </>
        )}
      </div>
      {/* «Aggiungi alla pratica» opens under the row's heading, in the page (LC125, L-73). */}
      {adding.popover}
      {/* The mark goes under the name, never beside it: the row's name is never the one cut (#536). */}
      {heldIn && (
        <div className="flex pl-7 md:pl-8">
          <HeldInMark label={heldIn} className="max-w-full" />
        </div>
      )}
      {dossier && (
        <>
          {dossier.addNote && (
            <Expand open={panel === 'note'} onClose={() => setPanel(null)}>
              <RowNoteComposer name={removeName} onSave={dossier.addNote} onDone={() => setPanel(null)} />
            </Expand>
          )}
          <Expand open={panel === 'move'} onClose={() => setPanel(null)}>
            <RowMovePicker onMove={dossier.moveTo} onDone={() => setPanel(null)} />
          </Expand>
        </>
      )}
      {dossier ? (
        // A dossier's «Fonti» (LC86, L-73): the row opens in place, the space growing under its heading and pushing the
        // rest down (`Expand`, the island's times). The focus stays where it was; no Esc, which is the reader's. `Expand`
        // clips only the height and only while it moves, so the reader's toolbar keeps sticking to the page's scroller
        // and the glosses' margin is not cut at the side. Brought into view on opening, it keeps the row's heading (its
        // 44 px, the command that closes it) clear under the act's sticky head.
        <Expand open={isOpen} initialFocusRef={focusWhereItIs} className="scroll-mt-[calc(var(--practice-head,0px)+3rem)]">
          <div id={regionId} className="pb-3 pt-1 md:pl-6 md:pr-2" style={regionStyle}>
            {children}
          </div>
        </Expand>
      ) : isOpen && (
        // Opacity only, 150 ms: a row opens tens of times a day, and a transform here would move the
        // reader's sticky toolbar and fixed popovers while it plays (gotchas 22, 26).
        <div id={regionId} className="animate-in fade-in duration-(--dur-pop) pb-3 pt-1 md:pl-6 md:pr-2" style={regionStyle}>
          {children}
        </div>
      )}
    </div>
  );
}
