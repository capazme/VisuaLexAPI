import { useAppStore } from '../../../store/useAppStore';
import { getHighlightSwatch, highlightColorName } from '../../../utils/highlightColors';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { highlightColorItems } from './highlightColorItems';

export interface HighlightColorMenuProps {
  /** The trigger's look: with its word («Colore»), as the article's reading row; or the swatch alone. */
  labelled?: boolean;
  triggerClassName?: string;
  /** Where the list opens (`MenuButton`). */
  placement?: 'below' | 'above' | 'auto';
}

/**
 * The colour of new highlights, chosen once in the reading bar (H1, the owner's decision): every highlight made after
 * takes it, never asking. The trigger shows the colour; its menu offers the four, each with what it is suggested for,
 * a hint and no rule. Kept on this device with the other reading settings (`settings.highlightColor`).
 */
export function HighlightColorMenu({ labelled = false, triggerClassName, placement }: HighlightColorMenuProps) {
  const color = useAppStore((s) => s.settings.highlightColor);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const name = highlightColorName(color);
  return (
    <MenuButton
      label={`Colore delle evidenziazioni: ${name}`}
      heading="Colore delle nuove evidenziazioni (sotto, un uso suggerito)"
      items={highlightColorItems(color, (next) => updateSettings({ highlightColor: next }))}
      triggerClassName={triggerClassName}
      placement={placement}
      menuClassName="w-64"
    >
      <span
        aria-hidden
        className={cn('h-4 w-4 shrink-0 rounded-full border border-slate-400/70 dark:border-slate-500')}
        style={{ backgroundColor: getHighlightSwatch(color) }}
      />
      {labelled && <span>Colore</span>}
    </MenuButton>
  );
}
