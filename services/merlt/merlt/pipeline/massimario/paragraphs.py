# services/merlt/merlt/pipeline/massimario/paragraphs.py
"""A section's HTML → plain paragraphs, with the spans of the norm links (spec §5.1).

Only text leaves this module: tags, attributes, scripts and styles are dropped,
so the reader renders text nodes and never HTML. Whitespace is collapsed;
offsets index the returned text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

_BLOCKS = {"p", "li", "div", "blockquote", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}
_SKIP = {"script", "style"}
# The portal writes «…» as `<<…>>` inside its HTML. A `<` opens markup only when a
# whole tag of a known name follows, every attribute with a value; any other `<`
# is the author's text (`<<i fatti>>` is not an <i> tag).
_TAG = re.compile(
    r"</?(?:p|a|br|b|i|u|em|strong|sup|sub|span|div|li|ul|ol|blockquote|tr|td|th|table|tbody|thead"
    r"|h[1-6]|img|script|style|font)"
    r"(?:\s+[\w:-]{1,40}\s*=\s*(?:\"[^\"]{0,2000}\"|'[^']{0,2000}'|[^\s\"'>]{1,2000}))*\s*/?>"
    r"|<!--",
    re.IGNORECASE,
)


def _escape_stray_brackets(html: str) -> str:
    return re.sub("<", lambda found: "<" if _TAG.match(html, found.start()) else "&lt;", html)


@dataclass(frozen=True)
class LinkSpan:
    start: int
    end: int
    href: str
    text: str


@dataclass
class Paragraph:
    text: str
    links: list[LinkSpan] = field(default_factory=list)


def _collapse(raw: str) -> tuple[str, list[int]]:
    """Collapse whitespace; return the text and, for each raw offset, its offset in the text."""
    out: list[str] = []
    index = [0] * (len(raw) + 1)
    previous_space = True
    for i, ch in enumerate(raw):
        index[i] = len(out)
        if ch.isspace():
            if not previous_space:
                out.append(" ")
            previous_space = True
        else:
            out.append(ch)
            previous_space = False
    index[len(raw)] = len(out)
    text = "".join(out)
    if text.endswith(" "):
        text = text[:-1]
    return text, index


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[Paragraph] = []
        self._raw: list[str] = []
        self._size = 0
        self._links: list[tuple[int, int, str]] = []
        self._href: str | None = None
        self._href_start = 0
        self._skip = 0

    def _add(self, data: str) -> None:
        self._raw.append(data)
        self._size += len(data)

    def flush(self) -> None:
        text, index = _collapse("".join(self._raw))
        if text:
            spans = []
            for raw_start, raw_end, href in self._links:
                start, end = index[raw_start], min(index[raw_end], len(text))
                while start < end and text[start] == " ":
                    start += 1
                while end > start and text[end - 1] == " ":
                    end -= 1
                if end > start:
                    spans.append(LinkSpan(start, end, href, text[start:end]))
            self.paragraphs.append(Paragraph(text, spans))
        self._raw, self._size, self._links, self._href = [], 0, [], None

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP:
            self._skip += 1
        elif tag in _BLOCKS:
            self.flush()
        elif tag == "br":
            self._add(" ")
        elif tag == "a":
            href = dict(attrs).get("href") or ""
            if "N2Ls?urn:nir:" in href:
                self._href, self._href_start = href, self._size

    def handle_endtag(self, tag):
        if tag in _SKIP:
            self._skip = max(0, self._skip - 1)
        elif tag in _BLOCKS:
            self.flush()
        elif tag == "a" and self._href is not None:
            self._links.append((self._href_start, self._size, self._href))
            self._href = None

    def handle_data(self, data):
        if not self._skip:
            self._add(data)


def extract_paragraphs(html: str) -> list[Paragraph]:
    collector = _Collector()
    collector.feed(_escape_stray_brackets(html or ""))
    collector.close()
    collector.flush()
    return collector.paragraphs


def split_for_vectors(text: str, max_len: int = 2000) -> list[tuple[int, int]]:
    """Cut a long paragraph at sentence ends into pieces of at most `max_len` characters."""
    pieces: list[tuple[int, int]] = []
    start = 0
    while len(text) - start > max_len:
        window = text[start:start + max_len]
        cut = max(window.rfind(". "), window.rfind("; "))
        if cut > max_len // 2:
            end = start + cut + 1
        else:
            space = window.rfind(" ")
            end = start + (space if space > 0 else max_len)
        pieces.append((start, end))
        start = end
        while start < len(text) and text[start] == " ":
            start += 1
    pieces.append((start, len(text)))
    return pieces
