/**
 * The document's registry of find-in-text highlights. Two names are
 * registered with the CSS Custom Highlight API: `vlx-find` (every match but
 * the current ones) and `vlx-find-current`, each the union of the ranges of
 * every open search, so two tabs searching at once do not clear each other.
 * Where the API is missing every call is a no-op. No DOM is touched.
 */

const FIND = 'vlx-find';
const FIND_CURRENT = 'vlx-find-current';

interface OwnerState {
  ranges: Range[];
  current: Range | null;
}

const owners = new Map<string, OwnerState>();

function rebuild(): void {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
  const all: Range[] = [];
  const current: Range[] = [];
  for (const state of owners.values()) {
    for (const r of state.ranges) if (r !== state.current) all.push(r);
    if (state.current) current.push(state.current);
  }
  if (all.length) CSS.highlights.set(FIND, new Highlight(...all));
  else CSS.highlights.delete(FIND);
  if (current.length) CSS.highlights.set(FIND_CURRENT, new Highlight(...current));
  else CSS.highlights.delete(FIND_CURRENT);
}

/** Replace what `ownerId` draws; `current` is one of `ranges`, or null. */
export function setFindRanges(ownerId: string, ranges: Range[], current: Range | null): void {
  owners.set(ownerId, { ranges, current });
  rebuild();
}

export function clearFindRanges(ownerId: string): void {
  owners.delete(ownerId);
  rebuild();
}
