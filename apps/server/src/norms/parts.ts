/**
 * A part of an article Normattiva splits into parts (G-387 (a)): its comma range, «701-800», as the Python API
 * writes it (`normattiva_parts.part_range`, `\d{1,5}[a-z-]{0,12}` on each side). Every reader of a stored norm
 * takes `parte` through `partOf`, so a value of any other shape is no part: the article is read, keyed and cited.
 */
export const PART_RANGE = /^\d{1,5}[a-z-]{0,12}-\d{1,5}[a-z-]{0,12}$/;

/** The part a stored or answered norm names, or undefined. */
export const partOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= 40 && PART_RANGE.test(value) ? value : undefined;
