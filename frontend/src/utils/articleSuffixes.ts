/**
 * Ordinal suffixes of Italian article numbering — the one copy.
 *
 * Numbering does not stop at "decies". The catalogue of reati presupposto of
 * d.lgs. 231/2001 runs 25-bis … 25-sexiesdecies and beyond, and
 * `tests/test_article_existence.py` records the spellings captured live from
 * Normattiva's article tree: "281 undecies" (c.p.c.), "669 terdecies" (c.p.c.),
 * "452 quaterdecies" (c.p.), "518 duodevicies" (c.p.), "2409 octiesdecies" and
 * "2409 noviesdecies" (c.c.), "25 undecies", "25 quinquiesdecies",
 * "25 septiesdecies", "25 undevicies" (d.lgs. 231/2001).
 *
 * Nine regexes across the frontend and the Python API each carried their own
 * copy of the alternation, and all nine stopped at "decies": "art.
 * 25-terdecies" was read as art. 25-ter — an article that exists, so the
 * truncation produced a plausible link to the wrong text rather than an error.
 * Mirrored by `visualex_api/tools/article_suffixes.py`; change both together.
 *
 * Two spellings circulate for 15, 16, 18 and 19 ("quinquiesdecies" /
 * "quindecies", "sexiesdecies" / "sexdecies", "octiesdecies" / "duodevicies",
 * "noviesdecies" / "undevicies"); both are listed because Normattiva returns
 * both. The table covers 2 to 20 — a suffix past that needs a new entry here
 * and nowhere else.
 */
export const ARTICLE_ORDINAL_SUFFIXES = [
  // 2-10
  'bis', 'ter', 'quater', 'quinquies', 'sexies', 'septies', 'octies', 'novies', 'decies',
  // 11-20
  'undecies', 'duodecies', 'terdecies', 'quaterdecies', 'quinquiesdecies',
  'sexiesdecies', 'septiesdecies', 'octiesdecies', 'noviesdecies', 'vicies',
  // variant spellings of 15, 16, 18, 19, 20
  'quindecies', 'sexdecies', 'duodevicies', 'undevicies', 'vices',
  // second word of the compound forms ("vicies semel", 21)
  'semel',
] as const;

/**
 * The alternation, **longest first**. In a regex alternation the first branch
 * that matches wins, so "ter" listed before "terdecies" claims the head of the
 * longer word and leaves "decies" stranded. Sorting here means an entry added
 * above can be written in any position without reintroducing that bug.
 *
 * Every pattern that embeds this must close the group with `\b`, or a suffix
 * still matches the head of an ordinary word ("art. 5 bisogna" → art. 5-bis).
 */
export const ARTICLE_SUFFIX_ALTERNATION = [...ARTICLE_ORDINAL_SUFFIXES]
  .sort((a, b) => b.length - a.length)
  .join('|');
