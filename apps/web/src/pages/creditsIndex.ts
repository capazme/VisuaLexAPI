/** Where a section counts as reached: its top past the upper 30 % of the window. */
const READING_LINE = 0.3;

/**
 * The group being read, for the index's mark, from the page's scroll: the last section whose top has passed the
 * reading line; at the page's end the last group (a short last section never reaches the line on a tall window); above
 * the first section, the first. Read on every scroll, once a frame.
 */
export function groupAt(tops: ReadonlyArray<{ id: string; top: number }>, viewport: number, atEnd: boolean): string {
  if (tops.length === 0) return '';
  if (atEnd) return tops[tops.length - 1].id;
  const passed = tops.filter((section) => section.top <= viewport * READING_LINE);
  return (passed[passed.length - 1] ?? tops[0]).id;
}

/**
 * The group an address's fragment names: a group's own id, or the group of the entry it names (`/crediti#cerdef`
 * marks «Autorità e registri», not the last group the page's end would). Undefined for any other fragment.
 */
export function groupOf(
  id: string,
  entries: ReadonlyArray<{ id: string; group: string }>,
  groups: ReadonlyArray<{ id: string }>,
): string | undefined {
  if (groups.some((group) => group.id === id)) return id;
  return entries.find((entry) => entry.id === id)?.group;
}
