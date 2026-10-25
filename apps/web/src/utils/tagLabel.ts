/**
 * How a dossier's tag is shown. Tags are the user's own words and are stored as typed: only what is
 * drawn changes, never the stored value, which every filter keeps comparing.
 */

/** The tag with its first letter capitalised and the rest as typed: «accesso» → «Accesso», «DPO» stays «DPO». */
export function tagLabel(tag: string): string {
  const first = tag.codePointAt(0);
  if (first === undefined) return tag;
  const head = String.fromCodePoint(first);
  return head.toLocaleUpperCase('it') + tag.slice(head.length);
}

/** One entry of the category menu: the stored values it filters (they differ only by case) and its label. */
export interface TagCategory {
  /** The values folded to lower case: the menu's value, the same for «gdpr» and «GDPR». */
  key: string;
  label: string;
  /** Every stored value the category stands for, exactly as stored. */
  values: string[];
}

const categoryKey = (tag: string) => tag.toLocaleLowerCase('it');

const capitals = (tag: string) => [...tag].filter((c) => c !== c.toLocaleLowerCase('it')).length;

/**
 * The categories of a set of tags, in alphabetical order (Italian, case and accents ignored). Stored
 * values that differ only by case are one category; its label is the spelling with the most capitals
 * («GDPR» over «gdpr»), else the first in alphabetical order.
 */
export function tagCategories(tags: Iterable<string>): TagCategory[] {
  const groups = new Map<string, string[]>();
  for (const tag of new Set(tags)) {
    if (!tag) continue;
    const key = categoryKey(tag);
    groups.set(key, [...(groups.get(key) ?? []), tag]);
  }
  const compare = (a: string, b: string) => a.localeCompare(b, 'it', { sensitivity: 'base' });
  return [...groups.entries()]
    .map(([key, values]) => {
      const sorted = [...values].sort((a, b) => capitals(b) - capitals(a) || compare(a, b) || (a < b ? -1 : 1));
      return { key, label: tagLabel(sorted[0]), values: [...values].sort(compare) };
    })
    .sort((a, b) => compare(a.label, b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Whether a dossier's tags fall in a category: the stored values compared, case and all. */
export function hasTagCategory(tags: readonly string[] | undefined, category: TagCategory): boolean {
  return !!tags?.some((t) => category.values.includes(t));
}
