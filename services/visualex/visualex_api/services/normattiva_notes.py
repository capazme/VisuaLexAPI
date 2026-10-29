"""The update notes («AGGIORNAMENTO (N)») a Normattiva article page carries below its text.

Normattiva records what changed an article, and what the Corte costituzionale
declared about it, in `div.art_aggiornamento-akn` blocks after the article. The
scraper's extractor reads them only for the codes (`_estrai_testo_allegato`, where
they end the text); the comma formats (`_estrai_testo_akn_dettagliato`,
`_estrai_testo_akn_semplice`) leave them out. Art. 3 d.lgs. 23/2015 has four,
one of them on C. cost. 194/2018, and none was in its text (G-386).

This module reads them from the raw page the scraper already keeps in its
persistent cache, as `normattiva_validity` does, so it costs no request and never
touches `article_text`: that output is frozen (root CLAUDE.md, rule 23), and the
notes go next to it, in their own field. The shape is the one agreed for
mcp-legal-it 3.0.x: `{numero, testo, ordine, corte_costituzionale}` per note.

Best effort: a page that cannot be read yields None, never a guess. Normattiva's
editorial notes (`note-akn`, «Nota all'art. …») are out of scope.
"""
from __future__ import annotations

import re
from typing import List, Optional, TypedDict

import structlog
from bs4 import BeautifulSoup, Tag

from ..tools.selectors import NormattivaSelectors
from .akn_parser import comparable_article_key
from .normattiva_validity import _BODY_WORD, _LABEL, _find_div

log = structlog.get_logger()

_SELECTORS = NormattivaSelectors()
_NOTE_BLOCK = _SELECTORS.AGGIORNAMENTO_DIV
_NOTE_TITLE = "art_aggiornamento_title-akn"
_NOTE_TEXT = "art_aggiornamento_testo-akn"
_NOTE_SEPARATOR = "art_aggiornamento_separator-akn"

# Linear on any page (no class here runs past the next closing bracket): the heading
# «AGGIORNAMENTO (129a)», and the marker «((348))» the text leaves where a note applies.
_HEADING = re.compile(r"AGGIORNAMENTO\s*\(\s*(\d{1,6}[a-z]?)\s*\)", re.I)
_DOUBLE_MARKER = re.compile(r"\(\(\s*(\d{1,6}[a-z]?)\s*\)\)", re.I)
# A word match, no legal reading: what a client may open its box of notes on.
_COURT = re.compile(r"corte\s+costituzionale|\bc\.\s*cost\.", re.I)
_JUDGMENT = re.compile(r"\bsentenz[ae]\b", re.I)


class UpdateNote(TypedDict):
    """One note on the wire, as mcp-legal-it 3.0.x writes it."""

    numero: str                  # the N of «AGGIORNAMENTO (N)», in lower case («129a»)
    testo: str                   # whitespace collapsed, separator and heading removed, links as their text
    ordine: int                  # from 1, in page order
    corte_costituzionale: bool   # «Corte costituzionale» or «C. cost.», and «sentenza»


class UpdateNotes(TypedDict):
    """What a page says: the notes it holds, and whether any could not be read."""

    notes: List[UpdateNote]
    unread: bool        # a block with no heading or number, or a «((n))» with no note n
    in_text: bool       # the extractor already put them in `article_text` (the codes' format)


def _collapse(text: str) -> str:
    return " ".join(text.split())


def _read_note(block: Tag) -> Optional[tuple[str, str]]:
    """(numero, testo) of one block, or None when it has no readable heading."""
    title = block.find(class_=_NOTE_TITLE)
    heading = _HEADING.search(_collapse(title.get_text())) if title is not None else None
    if heading is None:
        return None
    body = block.find(class_=_NOTE_TEXT)
    if body is None:
        # No text div: the block's own text, less its separator line and heading.
        for part in block.find_all(class_=(_NOTE_SEPARATOR, _NOTE_TITLE)):
            part.extract()
        body = block
    return heading.group(1).lower(), _collapse(body.get_text())


def _notes_in_text(body: Tag) -> bool:
    """Whether the scraper's extractor reads this body with the notes in its text.

    The same order of tests as `NormattivaScraper.estrai_da_html`: the two comma
    formats leave the notes out; the codes' format appends them, and the fallback
    takes every visible word of the body.
    """
    if body.find(class_=_SELECTORS.AKN_COMMA_DIV) or body.find(class_=_SELECTORS.AKN_JUST_TEXT):
        return False
    return True


def extract_update_notes(raw_html: str, *, article: Optional[str] = None) -> Optional[UpdateNotes]:
    """The update notes of a Normattiva article page, or None when it cannot be read.

    `article` is the article asked for: when given, the page must be that article
    (as `extract_validity` checks), or nothing is claimed about it.
    """
    if not raw_html:
        return None
    opening = _find_div(raw_html, _BODY_WORD)
    if opening is None:
        return None
    # The whole body: the notes close it, after every comma (an article in parts runs to 125 KB).
    soup = BeautifulSoup(raw_html[opening.start():], "html.parser")
    body = soup.find("div", class_=_SELECTORS.BODY_TESTO)
    if body is None:
        return None
    if article:
        label = _LABEL.search(_collapse(body.get_text(" "))[:400])
        if label is None or comparable_article_key(label.group(1)) != comparable_article_key(article):
            log.info("Update notes not read: the page is not the article asked for",
                     asked=article, found=label.group(1) if label else None)
            return None

    in_text = _notes_in_text(body)
    notes: List[UpdateNote] = []
    unread = False
    for block in body.find_all("div", class_=_NOTE_BLOCK):
        block.extract()  # out of the body: its heading is not a marker in the text
        read = _read_note(block)
        if read is None:
            unread = True
            continue
        numero, testo = read
        notes.append({
            "numero": numero,
            "testo": testo,
            "ordine": len(notes) + 1,
            "corte_costituzionale": bool(_COURT.search(testo) and _JUDGMENT.search(testo)),
        })

    # A «((n))» in the text with no note n: the note is somewhere this page does not show.
    # Only on a page that has notes: the portal also brackets amended words, «entro ((30))
    # giorni», which on a page with no note at all would raise the notice for nothing (on a
    # page with notes it still can: a cautious notice, never a lost note). A plain «(n)» is
    # left alone: the text has those for other reasons too.
    numbers = {note["numero"] for note in notes}
    if (notes or unread) and any(
            m.group(1).lower() not in numbers for m in _DOUBLE_MARKER.finditer(body.get_text())):
        unread = True

    log.info("Update notes read", count=len(notes), unread=unread, in_text=in_text)
    return {"notes": notes, "unread": unread, "in_text": in_text}


def update_notes_fields(notes: Optional[UpdateNotes], *, akn_text: bool = False) -> dict:
    """The keys an article answer carries for a Normattiva text.

    - `note_aggiornamento`: the list (`[]` when the page has none), or None when the
      page could not be read, or when the text is the AKN export's, whose notes are
      already in it.
    - `note_non_lette`: some note could not be read, or the page could not be read at
      all: «note di aggiornamento non lette: verificare su Normattiva».
    - `note_nel_testo`: `article_text` already holds them (the codes' format, the AKN
      export), so a client shows them once.
    """
    if akn_text:
        return {"note_aggiornamento": None, "note_non_lette": False, "note_nel_testo": True}
    if notes is None:
        return {"note_aggiornamento": None, "note_non_lette": True, "note_nel_testo": False}
    return {
        "note_aggiornamento": notes["notes"],
        "note_non_lette": notes["unread"],
        "note_nel_testo": notes["in_text"],
    }
