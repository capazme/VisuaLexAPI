/**
 * Ordinal suffixes of Italian article numbering — a mirror.
 *
 * The source is the Python API's
 * `services/visualex/visualex_api/tools/article_suffixes.py`; the web app keeps
 * the other mirror (`apps/web/src/utils/articleSuffixes.ts`). Change all three
 * together: `tests/unit/articleSuffixes.test.ts` fails when this list drifts
 * from the source. A copy that stops at "decies" reads "art. 25-terdecies" as
 * art. 25-ter, an article that exists, so nothing looks broken.
 */
export const ARTICLE_ORDINAL_SUFFIXES = [
  // 2-10
  'bis', 'ter', 'quater', 'quinquies', 'sexies', 'septies', 'octies', 'novies', 'decies',
  // 11-20
  'undecies', 'duodecies', 'terdecies', 'quaterdecies', 'quinquiesdecies',
  'sexiesdecies', 'septiesdecies', 'octiesdecies', 'noviesdecies', 'vicies',
  // variant spellings of 9, 15, 16, 18, 19, 20 (nonies: art. 21-nonies l. 241/1990,
  // art. 25-nonies d.lgs. 231/2001, as Normattiva prints them)
  'nonies', 'quindecies', 'sexdecies', 'duodevicies', 'undevicies', 'vices',
  // second word of the compound forms ("vicies semel", 21)
  'semel',
] as const;

/**
 * The alternation, longest first: in a regex alternation the first branch that
 * matches wins, so "ter" before "terdecies" would claim the head of the longer
 * word. Every pattern that embeds it must close the group with `\b`.
 */
export const ARTICLE_SUFFIX_ALTERNATION = [...ARTICLE_ORDINAL_SUFFIXES]
  .sort((a, b) => b.length - a.length)
  .join('|');
