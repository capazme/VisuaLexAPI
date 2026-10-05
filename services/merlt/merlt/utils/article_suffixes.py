"""Ordinal suffixes of Italian article numbering — MERL-T's copy of the API's one table.

MERL-T does not import the VisuaLex API, so this is a copy of
services/visualex/visualex_api/tools/article_suffixes.py; tests/unit/test_sources_golden.py
fails when the two differ. Every MERL-T regex over article numbers reads it
(``utils/urn_labels.py``, ``pipeline/mechanical_ingestion/parser.py``): two private copies
stopped short, one at "decies".

This module imports nothing on purpose: it must stay a leaf.
"""

ARTICLE_ORDINAL_SUFFIXES = (
    # 2-10
    "bis", "ter", "quater", "quinquies", "sexies", "septies", "octies",
    "novies", "decies",
    # 11-20
    "undecies", "duodecies", "terdecies", "quaterdecies", "quinquiesdecies",
    "sexiesdecies", "septiesdecies", "octiesdecies", "noviesdecies", "vicies",
    # variant spellings of 15, 16, 18, 19, 20
    "quindecies", "sexdecies", "duodevicies", "undevicies", "vices",
    # second word of the compound forms ("vicies semel", 21)
    "semel",
)

# The alternation, LONGEST FIRST: the first branch that matches wins, so "ter" listed
# before "terdecies" would claim the head of the longer word. A pattern that embeds it
# must close the group (a boundary or a fixed continuation).
ARTICLE_SUFFIX_ALTERNATION = "|".join(sorted(ARTICLE_ORDINAL_SUFFIXES, key=len, reverse=True))
