"""The Cassazione's text from the court's original PDF (design 2026-10-05 §11).

Italgiure's text field is cut short at the source in about a third of the records (measured on
2026-10-05), sometimes before the dispositivo; the court's PDF is whole. This module turns the
PDF's text layer into the blocks the page shows, dropping only page furniture: the rotated
«copia non ufficiale», the first page's header and «Oggetto» box, running headers and footers,
page numbers, unmapped glyphs, margin stamps. The output is frozen with every reader (design
§8.5): change the rules and every note anchored to a Cassazione text moves.

Thresholds below are measured, not guessed (plan Task 2, 2026-10-05, 36 non-withheld PDFs read
by hand): `TOP_BAND` and `BOTTOM_BAND` widened from the design's draft because a running header
and a running footer each sat just outside the draft bands on at least one fixture and leaked
into the body verbatim; `INDENT`, `GAP`, `REPEATED_ON` and `OGGETTO_X` confirmed unchanged.
`CENTER_INDENT`/`HEADING_MAX_CHARS` are new: a centred heading ("RILEVATO CHE", "P.Q.M.", …)
starts its own paragraph correctly on the INDENT rule alone, but the ordinary left-aligned line
right after it does not — neither indented far enough nor far enough below to start one on its
own — so without this rule the heading glues onto the paragraph that follows it (measured on at
least 22 of 36 fixtures, civil and penal alike).

Fix round 1, 2026-10-05 (review on the real fixtures, not the prototype's smaller sample):
- the row grid (`round(y0 / 3)`) could split one physical baseline into two rows on a rounding
  boundary (y0 124.5 vs 124.3 landing in adjacent buckets), sorting the piece that should finish
  a sentence ahead of the rest of its own line and scrambling it; rows are now clustered by
  y-proximity (`_cluster_rows`), never a fixed grid.
- `_RUNNING`'s "Ric." branch required a literal "sez." later in the line and failed on OCR
  noise ("Ric, 2021 n. 039U Su. SU …", comma and garbled "sez."); loosened to the shape alone.
- a line-ending hyphen joined the next line with no space even when the character before it was
  itself a space (a dash used as punctuation, "CORTE DEI CONTI -" / "SEZIONI RIUNITE", not a
  word broken across lines) — now joined without a space only when the character right before
  the "-" is a letter.
- the body's left edge is computed per page, not once for the whole document (it drifts, e.g.
  93 pt on one page to 70 pt eleven pages later in the same decision), and an outdent (a hanging
  numbered point whose number sits left of the body, its continuation lines back at the body's
  margin) now starts a paragraph too, not only an indent or a vertical gap.
- a centred heading was any short line merely *beyond* `left + CENTER_INDENT`, which also
  caught right-margin debris (a stray stamp mark) that is nowhere near the page's centre; a
  short line is a heading only when its own centre sits within `CENTER_INDENT` of the page's,
  and a short line whose left edge sits beyond the page's own mirrored right margin is dropped
  outright as debris, never kept as a one-word paragraph.
- the band-repeat rule (`REPEATED_ON`) could drop a short line of real text that happens to
  recur, coincidentally, inside the band on two different pages at two different heights; a
  repeat now also has to sit within about 6 pt of the same y on both pages.
- the page count is read from the document's own page tree before the (slower) layout pass,
  so an oversized page count is refused without laying out any page.

Fix round 2, 2026-10-05 (re-review of round 1, on the same fixtures):
- an outdent starts a paragraph only when the line is a numbered point: on a page whose mode is
  the continuation lines' indent every flush-left line is an "outdent", and a date on a short
  last page was split off its sentence.
- a page whose most common x0 occurs fewer than three times takes the document's left edge.
- a heading is a short line indented beyond `left + CENTER_INDENT`, centred or right-aligned
  (role labels such as "- intimati -"); the centre clause of round 1 is gone.
- the band patterns also test the text without a leading page-number token, and the margin
  debris is computed once.

Fix round 3: a numbered point is recognised by its number alone (OCR turns the «Il» after a
number into «11», so «13.11 ricorso» was merged into the point before it), minus amounts,
decimals and dates.
"""
from __future__ import annotations

import asyncio
import io
import re
import statistics

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTChar, LTTextContainer, LTTextLine
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser

MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 200
TOP_BAND = 90       # points from the top edge (Task 2, 2026-10-05: 60 missed a running header by 17 pt)
BOTTOM_BAND = 110    # points from the bottom edge (Task 2, 2026-10-05: 80 missed a running footer and bare page numbers)
INDENT = 8           # points beyond the body's left edge that start a paragraph (Task 2: unchanged)
GAP = 30             # points between two baselines that start a paragraph (Task 2: unchanged)
CENTER_INDENT = 40   # a short line indented this many points beyond the body's left edge is a heading, centred or right-aligned (Task 2; fix round 2 keeps the indent test alone)
HEADING_MAX_CHARS = 60  # a centred line this long or shorter is a heading, not a far-right first line of prose (Task 2)
REPEATED_ON = 2      # a band line on this many pages, at about the same y, digits ignored, is a running header/footer
ROW_TOL = 3.0        # points of y0 (or an overlapping vertical extent) that keep two text fragments on one baseline (fix round 1)
MAX_ORDINARY_LINE_HEIGHT = 15  # pt; ordinary lines measured 8-14 pt tall, one stamp mark 18 (fix round 1)
FOOTER_Y_TOL = 6.0   # points of y that a repeated band line must share across pages to count as the same running header/footer (fix round 1)
OGGETTO_X = 0.6      # the «Oggetto» box starts beyond this share of the page width (measured x0 407 of 595)

_HEADER = re.compile(r"^(?:Civile|Penale)\b.*\bNum\.|^Presidente:|^Relatore:|^Data pubblicazione:")
_TITLE = re.compile(r"^(?:ORDINANZA|SENTENZA|DECRETO)(?:\s+INTERLOCUTORIA)?\s*$")
_PAGE_NUMBER = re.compile(r"^(?:-\s*\d{1,3}\s*-|\d{1,3}|Pag\.?\s*\d{1,3}(?:\s*(?:di|/)\s*\d{1,3})?)$", re.I)
_CID = re.compile(r"\(cid:\d+\)")
# running headers and footers whose shape is known even on a page where they appear once
# (measured on 2026-10-05: «Ric. 2021 n. 09083 sez. SU - ud. 14-12-2021», «r.g. n. 27512/2022»,
# «Cons. est. Paolo Fraulini»). The "Ric." branch was loosened in fix round 1: OCR noise can
# turn it into «Ric, 2021 n. 039U Su. SU - ud. 08-02-2022» (comma, garbled "sez."), which the
# original branch's required literal "sez." never matched — the shape up to the case number is
# distinctive enough on its own.
_RUNNING = re.compile(r"^(?:Ric[.,]\s*\d{4}\s+n\.\s*\w+|r\.\s?g\.\s*n\.\s*\d+/\d{4}$|Cons\.\s*est\.)", re.I)
# widened on Task 2's 36-fixture read (2026-10-05): "PQM." with no periods between the letters
# (snciv_05628_2022) and "PER QUESTI MOTIVI" spelled out, an older civil-ordinanza template that
# never uses "P.Q.M." at all (snciv_26052_2026, snciv_26054_2026) — without both, 3 of 36
# decisions lost their dispositivo to the motivazione.
# a page number can sit left of the running footer on the same baseline, and the row merge then
# fuses them ("-2- Ric. 2020 n. …"): the band patterns also test the text without that token
# (fix round 2, N6)
_LEADING_PAGE_NUMBER = re.compile(r"^(?:-\s*\d{1,3}\s*-|\d{1,3})\s+(?=\S)")
# a numbered point ("7. va premessa …", "47.il giudice …"): the only kind of outdented line that
# starts a paragraph (fix round 2, N1/N2)
# The text after the number is not tested: OCR reads «Il»/«le» as «11»/«1e» ("13.11 ricorso",
# "52.1e modalità", snciv_05628_2022), so only an amount ("612.000,00"), a decimal ("1,5") or a
# date ("22.06.2020") at a line start is refused (fix round 3, P1).
_POINT = re.compile(r"^\d{1,3}[.)](?!\d{3}\b|\d{1,2}[./]\d|\d+,\d)")
_PQM = re.compile(r"^(?:P\.\s?Q\.\s?M\.?|PQM\.|PER QUESTI MOTIVI)\s*$")
_PQM_PREFIX = ("P.Q.M.", "PQM.", "PER QUESTI MOTIVI")


class PdfRefused(ValueError):
    """Not a PDF this reader will read: the caller falls back to the text field."""


def _page_count(data: bytes) -> int:
    """The page count from the document's own page tree, read before the slower layout
    pass (fix round 1, Minor 2): an oversized PDF is refused without laying out a page."""
    parser = PDFParser(io.BytesIO(data))
    document = PDFDocument(parser)
    return sum(1 for _ in PDFPage.create_pages(document))


def _cluster_rows(pieces: list[dict]) -> list[list[dict]]:
    """Group same-baseline text fragments into rows by proximity, never a fixed grid.

    A fixed `round(y0 / N)` grid can split one baseline into two buckets when two
    fragments' y0 straddle a rounding boundary (measured on snciv_05628_2022: y0 124.522
    and 124.272 — 0.25 pt apart — used to land in different buckets because a third
    fragment at 124.772 pulled the average over the boundary): the piece that should
    finish a sentence then opened a new row, sorted ahead of the rest of its own line by
    the row-ordering step, and the paragraph rules read it as a stray indented fragment
    starting a new paragraph mid-sentence. Pieces are sorted top to bottom and merged into
    the open row while within `ROW_TOL` of that row's first piece, or their own vertical
    extents overlap it — but only between two ordinary-height lines: a stamp mark with an
    inflated glyph box (measured on snciv_05626_2022: "(A," boxed 18 pt tall against 8-14 pt
    for every ordinary line in the sample, y0 151.7 to y1 169.7) would otherwise overlap,
    and merge into, a real sentence 7.4 pt above it on a different baseline."""
    ordered = sorted(pieces, key=lambda p: -p["y0"])
    rows: list[list[dict]] = []
    for piece in ordered:
        if rows:
            anchor = rows[-1][0]
            ordinary_height = (max(anchor["y1"] - anchor["y0"], piece["y1"] - piece["y0"])
                                <= MAX_ORDINARY_LINE_HEIGHT)
            same_row = (abs(piece["y0"] - anchor["y0"]) <= ROW_TOL
                        or (ordinary_height
                            and piece["y0"] < anchor["y1"] and piece["y1"] > anchor["y0"]))
            if same_row:
                rows[-1].append(piece)
                continue
        rows.append([piece])
    return rows


def _lines(data: bytes) -> list[dict]:
    if not data.startswith(b"%PDF-"):
        raise PdfRefused("not a PDF")
    if len(data) > MAX_BYTES:
        raise PdfRefused("over the size limit")
    out: list[dict] = []
    try:
        if _page_count(data) > MAX_PAGES:
            raise PdfRefused("over the page limit")
        for pno, page in enumerate(extract_pages(io.BytesIO(data), laparams=LAParams())):
            if pno >= MAX_PAGES:
                raise PdfRefused("over the page limit")
            pieces: list[dict] = []
            for element in page:
                if not isinstance(element, LTTextContainer):
                    continue
                for line in element:
                    if not isinstance(line, LTTextLine):
                        continue
                    chars = [c for c in line if isinstance(c, LTChar)]
                    if not chars or not all(c.upright for c in chars):
                        continue
                    pieces.append({"x0": line.x0, "y0": line.y0, "x1": line.x1, "y1": line.y1,
                                   "text": line.get_text().replace("\n", "")})
            for row in _cluster_rows(pieces):
                row.sort(key=lambda p: p["x0"])
                text = " ".join(_CID.sub("", " ".join(p["text"] for p in row)).split())
                if text:
                    out.append({"page": pno, "x0": row[0]["x0"], "x1": max(p["x1"] for p in row),
                                "y": row[0]["y0"], "text": text,
                                "height": page.height, "width": page.width})
    except PdfRefused:
        raise
    except Exception as exc:  # noqa: BLE001 — untrusted input to a parser: any failure is a refusal
        # (measured: a PDF cut at a third raises pdfminer's PSEOF), and the caller falls back
        raise PdfRefused(f"unparsable: {type(exc).__name__}") from exc
    return out


def _furniture(lines: list[dict]) -> set[int]:
    drop: set[int] = set()
    in_band = [i for i, l in enumerate(lines)
               if l["y"] < BOTTOM_BAND or l["y"] > l["height"] - TOP_BAND]
    # a band line only counts as a repeated running header/footer when another occurrence
    # of (near enough) the same text sits at (near enough) the same y on another page —
    # otherwise two unrelated, short body lines that happen to recur verbatim (e.g.
    # "contro", "- ricorrente -") on two different pages, at two different heights, would
    # be dropped as if they were a footer (fix round 1, IMPORTANT 4).
    groups: dict[str, list[int]] = {}
    for i in in_band:
        groups.setdefault(re.sub(r"\d+", "#", lines[i]["text"]), []).append(i)
    repeated: set[int] = set()
    for idxs in groups.values():
        idxs = sorted(idxs, key=lambda i: lines[i]["y"])
        cluster: list[int] = []
        for i in idxs:
            if cluster and lines[i]["y"] - lines[cluster[0]]["y"] > FOOTER_Y_TOL:
                if len({lines[j]["page"] for j in cluster}) >= REPEATED_ON:
                    repeated.update(cluster)
                cluster = []
            cluster.append(i)
        if cluster and len({lines[j]["page"] for j in cluster}) >= REPEATED_ON:
            repeated.update(cluster)
    for i in in_band:
        text = lines[i]["text"]
        bare = _LEADING_PAGE_NUMBER.sub("", text)
        if (_PAGE_NUMBER.match(text) or _RUNNING.match(text) or _RUNNING.match(bare)
                or i in repeated):
            drop.add(i)
    title_y = next((l["y"] for l in lines if l["page"] == 0 and _TITLE.match(l["text"])), None)
    for i, l in enumerate(lines):
        if l["page"] != 0:
            continue
        if _HEADER.search(l["text"]):
            drop.add(i)
        elif title_y is not None and l["y"] > title_y + 1 and l["x0"] > l["width"] * OGGETTO_X:
            drop.add(i)  # the «Oggetto» box: right margin, above the title
    return drop


def _left_per_page(lines: list[dict]) -> dict[int, float]:
    """The body's left edge, per page (fix round 1, IMPORTANT 2): it drifts across a long
    decision (measured 93 pt to 70 pt within the same document, snciv_05628_2022), so one
    document-wide mode mis-starts or mis-continues paragraphs on whichever pages differ
    from it. A page whose most common x0 occurs fewer than three times (a short last page:
    snciv_26035_2026's sixth page has one line at 108 and one at 85, every x0 distinct) has no
    edge of its own and takes the document's (fix round 2, N2)."""
    pages: dict[int, list[int]] = {}
    for l in lines:
        pages.setdefault(l["page"], []).append(round(l["x0"]))
    overall = statistics.mode(x for xs in pages.values() for x in xs)
    out: dict[int, float] = {}
    for page, xs in pages.items():
        mode = statistics.mode(xs)
        out[page] = mode if xs.count(mode) >= 3 else overall
    return out


def _margin_debris(body: list[dict]) -> set[int]:
    """A short line whose left edge sits beyond the page's own mirrored right margin is a
    stamp or scan mark, not text (measured on snciv_05626_2022: "(A," at x0 525 on a
    595-wide page whose body starts at x0 78 — well past the mirrored right edge of 517).
    Dropped outright: kept, it would still start its own one-word paragraph on the INDENT
    rule alone, breaking the sentence on both sides of it even once it no longer forces a
    heading-style split (fix round 1, IMPORTANT 3)."""
    lefts = _left_per_page(body)
    drop: set[int] = set()
    for i, l in enumerate(body):
        right_edge = l["width"] - lefts[l["page"]]
        if l["x0"] > right_edge and len(l["text"]) <= HEADING_MAX_CHARS:
            drop.add(i)
    return drop


def _paragraphs(body: list[dict]) -> list[str]:
    lefts = _left_per_page(body)
    paragraphs: list[list[str]] = []
    current: list[str] = []
    current_is_heading = False  # current paragraph so far is a single, short, indented line
    for i, line in enumerate(body):
        left = lefts[line["page"]]
        previous = body[i - 1] if i else None
        # an outdented numbered point (the number left of the body, its continuation lines back
        # at the margin) starts a paragraph. An outdented line that is not a point does not:
        # on a page whose mode is the continuation lines' indent (snciv_05628_2022 page 1: mode
        # 93, ordinary lines at 79) every ordinary line is "outdented", and a date on a short
        # last page (snciv_26035_2026: "2026." at 85 against 103) would be split off its
        # sentence (fix round 2, N1/N2).
        starts = (line["x0"] > left + INDENT
                  or (line["x0"] < left - INDENT and bool(_POINT.match(line["text"])))
                  or (previous is not None and previous["page"] == line["page"]
                      and previous["y"] - line["y"] > GAP))
        # a centred heading ("RILEVATO CHE", "P.Q.M.", …) already starts its own paragraph via
        # the indent check above, but the ordinary line right after it does not — neither
        # indented far enough nor far enough below — so it would otherwise glue onto the
        # heading (Task 2, 2026-10-05): force the split regardless of this line's own shape.
        heading_glued = current and not starts and current_is_heading
        if current and (starts or heading_glued):
            paragraphs.append(current)
            current = []
        current.append(line["text"])
        # a heading is a short line indented well beyond the body's left edge, centred
        # ("RILEVATO CHE") or right-aligned ("- intimati -"): the next line starts a paragraph.
        # An ordinary body line starts at the left edge, so the indent test alone excludes it
        # (fix round 2, N3: the centre clause of round 1 dropped the right-aligned role labels;
        # stamp debris in the margin is removed earlier by `_margin_debris`).
        current_is_heading = (len(current) == 1
                               and line["x0"] > left + CENTER_INDENT
                               and len(line["text"]) <= HEADING_MAX_CHARS)
    if current:
        paragraphs.append(current)

    def join(lines: list[str]) -> str:
        text = lines[0]
        for nxt in lines[1:]:
            # a line ending in a hyphen joins without a space only when the character
            # right before the hyphen is a letter — a word broken across lines
            # ("Emilia-" / "Romagna"). A hyphen used as punctuation keeps a space on both
            # sides ("CORTE DEI CONTI -" / "SEZIONI RIUNITE"): the character before it is
            # itself a space, not a letter, so joining without one would fuse two words
            # that were never one (fix round 1, IMPORTANT 1; measured on snciv_05626_2022,
            # snciv_05628_2022, snciv_26035_2026).
            if text.endswith("-") and len(text) >= 2 and text[-2].isalpha():
                text = text + nxt
            else:
                text = f"{text} {nxt}"
        return text

    return [join(p) for p in paragraphs]


_HEADER_NUMBER = re.compile(r"^(?:Civile|Penale)\b.*?\bNum\.?\s*(\d+)\s+Anno\s+(\d{4})\b")


def _header_identity(lines: list[dict]) -> tuple[int, int] | None:
    """The (numero, anno) the first page's header line gives («Civile Ord. Sez. 1 Num. 26034
    Anno 2026»), or None when the page has no such line."""
    for line in lines:
        if line["page"] > 0:
            break
        m = _HEADER_NUMBER.match(line["text"])
        if m:
            return int(m.group(1)), int(m.group(2))
    return None


def text_from_pdf(data: bytes) -> dict[str, str]:
    return read_decision_pdf(data)[0]


def read_decision_pdf(data: bytes) -> tuple[dict[str, str], tuple[int, int] | None]:
    """The text exactly as `text_from_pdf` gives it, and the (numero, anno) its header names."""
    lines = _lines(data)
    identity = _header_identity(lines)
    drop = _furniture(lines)
    body = [l for i, l in enumerate(lines) if i not in drop]
    if not body:
        raise PdfRefused("no text layer")
    debris = _margin_debris(body)
    body = [l for i, l in enumerate(body) if i not in debris]
    if not body:
        raise PdfRefused("no text layer")
    paragraphs = _paragraphs(body)
    pqm = max((i for i, p in enumerate(paragraphs)
               if _PQM.match(p) or p.startswith(_PQM_PREFIX)), default=None)
    if pqm is None or pqm == 0:
        return {"motivazione": "\n\n".join(paragraphs)}, identity
    return {"motivazione": "\n\n".join(paragraphs[:pqm]),
            "dispositivo": "\n\n".join(paragraphs[pqm:])}, identity


async def text_from_pdf_async(data: bytes, timeout: float = 20.0) -> dict[str, str]:
    try:
        return await asyncio.wait_for(asyncio.to_thread(text_from_pdf, data), timeout)
    except asyncio.TimeoutError as exc:
        raise PdfRefused("parsing took too long") from exc


async def read_decision_pdf_async(
        data: bytes, timeout: float = 20.0) -> tuple[dict[str, str], tuple[int, int] | None]:
    try:
        return await asyncio.wait_for(asyncio.to_thread(read_decision_pdf, data), timeout)
    except asyncio.TimeoutError as exc:
        raise PdfRefused("parsing took too long") from exc
