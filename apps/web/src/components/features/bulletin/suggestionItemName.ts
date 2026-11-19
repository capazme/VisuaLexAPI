import type { SuggestionItem, SuggestionItemType } from '../../../types';

const KIND: Record<SuggestionItemType, string> = {
  annotation: 'la nota', highlight: "l'evidenza", dossier: 'il dossier', quickNorm: 'la norma veloce', alias: "l'alias",
};

/** A suggestion item's short name for its buttons, so «Prendi», «Rifiuta» and «Revoca» say which one. */
export function itemName(item: SuggestionItem): string {
  const p = item.payload as Record<string, unknown>;
  const words = [p.trigger, p.title, p.label, p.text, p.anchorText].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (!words) return KIND[item.itemType];
  return `«${words.length > 40 ? `${words.slice(0, 40)}…` : words}»`;
}
