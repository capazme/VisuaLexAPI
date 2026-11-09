import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, MessageCircle, MessageSquarePlus } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { NoteKind } from '../../../utils/inkTargets';
import { cn } from '../../../lib/utils';
import { MenuButton } from '../../ui/MenuButton';
import { TOOL_PRESSED } from './toolbarToggle';
import { keepForMenu, readAtPress, takeAtPress, takeForMenu, useReadingToolLife } from './readingToolLife';

export interface NoteToolButtonProps {
  /** The look of the bar's buttons, given to each half. */
  triggerClassName?: string;
  /** Classes for the wrapper, the row's flex item. */
  className?: string;
  /** Where the menu opens (`MenuButton`). */
  placement?: 'below' | 'above' | 'auto';
  /**
   * Whether the reader has discussions with colleagues (the article, the decision): the menu offers «Glossa» beside
   * «Nota personale». Without, the button is the toggle alone, and the tool writes personal notes.
   */
  gloss?: boolean;
}

/** The kinds as the menu and the button name them. */
const KINDS: Record<NoteKind, { name: string; description: string }> = {
  note: { name: 'Nota personale', description: 'La vedi solo tu, accanto al testo' },
  gloss: { name: 'Glossa', description: 'Una discussione con i colleghi sul passo' },
};

/**
 * The note tool (A4, spec `2026-11-03-a4-highlighter-and-notes-design` §6), a word processor's split button beside the
 * highlighter. The left half is the tool: with words selected in a reading text it opens the editor of a note on them at
 * once; with nothing selected it turns the tool on (`aria-pressed`) — which turns the highlighter off, one tool at a
 * time —, and every selection then opens the editor as it is released, until it is pressed again or Esc. The right half,
 * where the reader has discussions, chooses what the tool writes: «Nota personale», or «Glossa» (the discussion's
 * composer); chosen with words selected, it opens that editor on them, else it turns the tool on with it. Its press
 * keeps the selection: it is read as the press starts. What it writes is the session's.
 */
export function NoteToolButton({ triggerClassName, className, placement, gloss = false }: NoteToolButtonProps) {
  const on = useAppStore((s) => s.readingTool === 'note');
  const chosen = useAppStore((s) => s.noteToolKind);
  const setReadingTool = useAppStore((s) => s.setReadingTool);
  const setNoteToolKind = useAppStore((s) => s.setNoteToolKind);
  const turnOff = useCallback(() => setReadingTool(null), [setReadingTool]);
  useReadingToolLife('note', on, turnOff);
  // A gloss where the reader has none is a personal note.
  const kind: NoteKind = gloss ? chosen : 'note';

  const press = () => {
    const selected = takeAtPress();
    if (on) setReadingTool(null);
    else if (selected?.note) selected.note(kind);
    else setReadingTool('note');
  };
  const choose = (next: NoteKind) => {
    const selected = takeForMenu();
    setNoteToolKind(next);
    if (selected?.note) selected.note(next);
    else setReadingTool('note');
  };

  const { name } = KINDS[kind];
  const hint = on
    ? `${name}: acceso. Premi per spegnerlo, o Esc`
    : `${name}: con del testo selezionato la scrive su quelle parole; senza, si accende`;
  const Icon = kind === 'gloss' ? MessageCircle : MessageSquarePlus;
  return (
    <div role="group" aria-label="Strumento nota" className={cn('flex items-center', className)}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={`Strumento nota (${name.toLowerCase()})`}
        title={hint}
        onPointerDown={readAtPress}
        // The selection stays where it is: the button never takes it (nor the focus) from the text.
        onMouseDown={(event) => event.preventDefault()}
        // As the menu's clicks, it never reaches the card it sits in (a dossier's row).
        onClick={(event) => { event.stopPropagation(); press(); }}
        // 44 px wide on a phone whatever the bar's padding; a bar that keeps 44 px at every width says so in its classes.
        className={cn(
          'inline-flex min-w-[44px] items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-w-0',
          triggerClassName,
          on && TOOL_PRESSED,
        )}
      >
        <Icon size={16} aria-hidden />
      </button>
      {gloss && (
        <div
          className="contents"
          onPointerDownCapture={(event: ReactPointerEvent) => {
            if ((event.target as Element | null)?.closest('[aria-haspopup="menu"]')) readAtPress();
          }}
        >
          <MenuButton
            label="Tipo di nota"
            items={(['note', 'gloss'] as const).map((k) => ({
              label: KINDS[k].name,
              description: KINDS[k].description,
              icon: k === 'gloss' ? MessageCircle : MessageSquarePlus,
              checked: kind === k,
              onSelect: () => choose(k),
            }))}
            // 44 px wide on a phone; on a computer never under 24 px (WCAG 2.5.8), where the bar lets its buttons shrink.
            triggerClassName={cn('min-w-[44px] md:min-w-6', triggerClassName?.replace(/\bmd:min-w-0\b/g, 'md:min-w-6'), 'px-1')}
            placement={placement}
            menuClassName="w-64"
            onOpen={keepForMenu}
          >
            <ChevronDown size={14} aria-hidden />
          </MenuButton>
        </div>
      )}
    </div>
  );
}
