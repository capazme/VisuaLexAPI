"""Synthetic PDFs for the Cassazione PDF reader's tests (design 2026-10-05 §11).

The real decisions stay out of the repository (it is public), so the reader is tested on
PDFs built here: one font (Helvetica), one text object per line (`BT /F1 n Tf a b c d x y Tm
(text) Tj ET`) so pdfminer reports one LTTextLine per `Text`, positioned by the Tm matrix; a
rotated text uses a rotation matrix, which pdfminer reports as non-upright. The page is A4
(595 x 842) like the real ones; y is measured from the bottom edge, as in PDF space.
"""
from __future__ import annotations

from dataclasses import dataclass

PAGE_WIDTH = 595
PAGE_HEIGHT = 842


@dataclass
class Text:
    x: float
    y: float
    text: str
    size: float = 12
    rotate: bool = False


def _escape(text: str) -> bytes:
    raw = text.encode("latin-1", "replace")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _content(page: list[Text]) -> bytes:
    out = []
    for t in page:
        # rotated 90 degrees counter-clockwise: (cos, sin, -sin, cos) = (0, 1, -1, 0)
        a, b, c, d = (0, 1, -1, 0) if t.rotate else (1, 0, 0, 1)
        out.append(b"BT /F1 %g Tf %d %d %d %d %g %g Tm (" % (t.size, a, b, c, d, t.x, t.y)
                   + _escape(t.text) + b") Tj ET")
    return b"\n".join(out)


def make_pdf(pages: list[list[Text]]) -> bytes:
    """A minimal valid PDF with a correct xref table, one A4 page per list of `Text`."""
    n = len(pages)
    # objects: 1 catalog, 2 pages, 3 font, then per page a page (4+2i) and its content (5+2i)
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % (4 + 2 * i) for i in range(n))
        + b"] /Count %d >>" % n,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    for i, page in enumerate(pages):
        body = _content(page)
        objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
                       b"/Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>"
                       % (PAGE_WIDTH, PAGE_HEIGHT, 5 + 2 * i))
        objects.append(b"<< /Length %d >>\nstream\n" % len(body) + body + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += (b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objects) + 1, xref))
    return bytes(out)
