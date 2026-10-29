import { Settings } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { highlightColorName } from '../../../utils/highlightColors';
import { useHighlightColorMeanings } from '../../../hooks/useHighlightColorMeanings';
import { cn } from '../../../lib/utils';
import { MenuButton } from '../../ui/MenuButton';
import { CHANGE_MEANINGS_LABEL, highlightColorItems, SECTION_HEADING } from './highlightColorItems';

export interface HighlightColorMenuProps {
  /** The trigger's look: with its words («Colore: giallo»), as the article's reading row; or the dot alone. */
  labelled?: boolean;
  triggerClassName?: string;
  /** Classes for the wrapper, the row's flex item (`ml-auto`). */
  className?: string;
  /** Where the list opens (`MenuButton`). */
  placement?: 'below' | 'above' | 'auto';
}

/**
 * The colour of new highlights, chosen once in the reading bar (H1, the owner's decision): every highlight made after
 * takes it, never asking. The trigger shows the colour; its menu offers the four, each with what it means to this user
 * (D8 §3: their own meaning, else the default), a hint and no rule. Kept on this device with the other reading settings
 * (`settings.highlightColor`). Beside it one gear, and only that, opens Impostazioni at «Significato dei colori»: the
 * gear says «change it», where a «?» would say «explain it», and the menu already explains the four.
 */
export function HighlightColorMenu({ labelled = false, triggerClassName, className, placement }: HighlightColorMenuProps) {
  const color = useAppStore((s) => s.settings.highlightColor);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const openSettings = useAppStore((s) => s.openSettings);
  const meanings = useHighlightColorMeanings();
  const name = highlightColorName(color);
  return (
    <div className={cn('flex items-center', className)}>
      <MenuButton
        // The name starts with the words shown («Colore: giallo», WCAG 2.5.3); a dot alone says them in its tooltip.
        label={`Colore: ${name} (nuove evidenziazioni)`}
        title={labelled ? undefined : `Colore delle nuove evidenziazioni: ${name}`}
        heading={SECTION_HEADING}
        items={highlightColorItems(color, meanings, (next) => updateSettings({ highlightColor: next }))}
        triggerClassName={triggerClassName}
        placement={placement}
        menuClassName="w-64"
      >
        {/* The highlight's tint inside its ink, as in the menu: the tint alone is near the page's own colour. */}
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 rounded-full border-2"
          style={{ backgroundColor: `hsl(var(--hl-${color}-bg))`, borderColor: `hsl(var(--hl-${color}-fg))` }}
        />
        {labelled && <span>Colore: {name}</span>}
      </MenuButton>
      {/* The trigger's own look, as an icon: 44 px wide on a phone whatever the trigger's padding. */}
      <button
        type="button"
        // As the menu's clicks, it never reaches the card it sits in (a dossier's row).
        onClick={(event) => { event.stopPropagation(); openSettings('highlightColors'); }}
        aria-label={CHANGE_MEANINGS_LABEL}
        title={CHANGE_MEANINGS_LABEL}
        className={cn(
          'inline-flex items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          triggerClassName,
          'min-w-[44px] md:min-w-0',
        )}
      >
        <Settings size={16} aria-hidden />
      </button>
    </div>
  );
}
