import { useAppStore } from '../../../store/useAppStore';
import { highlightColorName } from '../../../utils/highlightColors';
import { MenuButton } from '../../ui/MenuButton';
import { highlightColorItems } from './highlightColorItems';

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
 * takes it, never asking. The trigger shows the colour; its menu offers the four, each with what it is suggested for,
 * a hint and no rule. Kept on this device with the other reading settings (`settings.highlightColor`).
 */
export function HighlightColorMenu({ labelled = false, triggerClassName, className, placement }: HighlightColorMenuProps) {
  const color = useAppStore((s) => s.settings.highlightColor);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const name = highlightColorName(color);
  return (
    <MenuButton
      label={`Colore delle evidenziazioni: ${name}`}
      heading="Colore delle nuove evidenziazioni (sotto, un uso suggerito)"
      items={highlightColorItems(color, (next) => updateSettings({ highlightColor: next }))}
      triggerClassName={triggerClassName}
      className={className}
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
  );
}
