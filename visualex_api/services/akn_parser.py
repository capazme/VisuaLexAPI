"""Pure parser for Akoma Ntoso 3.0 XML exported by Normattiva (caricaAKN).

Ported from mcp-legal-it (same author, relicensed MIT).

NOTE ON SCOPE: this is a STRUCTURE and FALLBACK source, never the text the
reading surface shows. Normattiva's AKN export transliterates every accent
("attivita'", "e'"), and article_text is the offset space that every stored
highlight and note is anchored to. See
docs/superpowers/specs/2026-08-26-trasfusione-mcp-legal-design.md.

No network access — XML string in, structured ``ParsedAct`` out. Handles both
AKN structures emitted by Normattiva:

- **flat**: ``<article eId="art_N">`` directly under the body (laws, decrees,
  Costituzione);
- **component**: each article is a ``<doc name="PART-art. N">`` inside
  ``<attachments>/<attachment>`` (codici: c.c., c.p.).

The AKN namespace (``http://docs.oasis-open.org/legaldocml/ns/akn/3.0``) is the
default namespace; all element lookups use ``local-name()`` so the namespace can
be ignored.

Both shapes are frozen as offline fixtures under ``tests/fixtures/akn/``.
"""

import re
from dataclasses import dataclass, field

import structlog
from lxml import etree

log = structlog.get_logger()


_AGGIORNAMENTO_MARKER = "-----------"


# ---------------------------------------------------------------------------
# Rubriche (article headings)
# ---------------------------------------------------------------------------
#
# Normattiva's article TREE carries no rubriche — every <li> holds a bare
# number — so an index built from it can only show numbers. The AKN export does
# carry them, in two different shapes depending on the act's structure:
#
#   flat acts (leggi, decreti)  the rubrica is the <heading>, which the renderer
#                               emits on the "### Art. N." line;
#   component acts (codici)     there is no <heading>; the rubrica is a
#                               parenthesised block of its own, right after the
#                               repeated "Art. N." line.
#
# Measured over the committed fixtures: 3248/3249 for the codice civile,
# 995/995 for the codice penale, 50/51 for L. 241/1990, 104/109 for
# D.Lgs. 231/2001. The Costituzione yields 0, which is correct — its articles
# have no rubriche.

# Everything after "Art." on the heading line. What of it belongs to the article
# id and what is the rubrica cannot be decided by pattern: "Art. 2409 bis" is an
# id with a space in it, while "Art. 3 Motivazione" is an id plus a rubrica. The
# caller knows the key, so the id is consumed by normalising against it.
_RUBRICA_FROM_HEADING = re.compile(r"^#+\s*Art\.?\s*(.+)$")
# A third shape: the rubrica opens the body block instead of standing alone —
# "(Potere discrezionale del giudice nell'applicazione della pena: limiti) Nei
# limiti stabiliti dalla legge…" (art. 132 c.p.).
_RUBRICA_LEADING_PAREN = re.compile(r"^\((.{3,200}?)\)", re.S)

# An abrogated article carries no rubrica because it carries no content. Saying
# so is more useful than leaving the row blank — the reader cannot otherwise
# tell "repealed" from "we could not find the title".
_ABROGATO = re.compile(
    r"^\(*\s*(?:articolo\s+)?(?:abrogat|soppress)|^\(*\s*articolo\s+da\s+ritenersi\s+soppress",
    re.IGNORECASE,
)


def is_abrogato(article_text: str | None) -> bool:
    """Whether the rendered article says it has been repealed."""
    if not article_text:
        return False
    blocks = [b.strip() for b in article_text.strip().split("\n") if b.strip()]
    # blocks[0] is the "### Art. N" heading; a component act repeats "Art. N."
    # on the next line. The statement, when there is one, follows.
    body = " ".join(blocks[1:]).strip()
    body = re.sub(r"^Art\.?\s*[\w.-]+\.?\s*", "", body).strip()
    return bool(_ABROGATO.match(body))

# Words whose final apostrophe is a genuine troncamento, not a stand-in for an
# accent. Without this list "un po'" would become "un pò".
_TRONCAMENTI = frozenset({
    "po", "da", "fa", "sta", "va", "di", "be", "ca", "mo", "to", "de", "su", "fu",
})

_ACCENTED = {"a": "à", "e": "è", "i": "ì", "o": "ò", "u": "ù"}

_TRANSLITTERATED_WORD = re.compile(r"\b([A-Za-zÀ-ÿ]+)([aeiou])'(?![A-Za-zÀ-ÿ])")


def _restore_accents(text: str) -> str:
    """Undo the AKN export's accent transliteration, for rubriche only.

    Normattiva's AKN writes every accented final vowel as vowel+apostrophe
    ("responsabilita'", "e'"). In the article TEXT this is left alone — that
    text is a data contract and must not be rewritten. In a rubrica it is a
    title shown in an index, short and nominal, where the transliteration reads
    as a defect.

    Conservative by construction: only a word-final vowel+apostrophe is touched,
    and never for the handful of words where the apostrophe is a real
    troncamento. Words ending in -che' take the acute accent (perché), the rest
    take the grave.
    """
    def replace(match: re.Match) -> str:
        stem, vowel = match.group(1), match.group(2)
        if (stem + vowel).lower() in _TRONCAMENTI:
            return match.group(0)
        if vowel == "e" and stem.lower().endswith("ch"):
            return stem + "é"
        return stem + _ACCENTED[vowel]

    # A bare "e'" is the verb è, and carries no stem for the pattern above.
    text = re.sub(r"(?<![A-Za-zÀ-ÿ])e'(?![A-Za-zÀ-ÿ])", "è", text)
    return _TRANSLITTERATED_WORD.sub(replace, text)


def extract_rubrica(article_text: str | None, key: str | None = None) -> str | None:
    """The rubrica of a rendered article, or None when it has none.

    `key` is the article's canonical key. It is what separates the id from the
    title on the heading line: an ordinal suffix is part of the id ("Art. 2409
    bis"), and without the key the suffix itself gets read as the rubrica.
    """
    if not article_text:
        return None
    blocks = [b.strip() for b in article_text.strip().split("\n") if b.strip()]
    if not blocks:
        return None

    match = _RUBRICA_FROM_HEADING.match(blocks[0])
    if match and key:
        tokens = match.group(1).split()
        # Consume the LONGEST token prefix that still normalises to this
        # article's key; whatever follows is the rubrica.
        consumed = 0
        for i in range(1, len(tokens) + 1):
            # rstrip the trailing dot: flat acts write "Art. 3." where the
            # key is "3", and without this the id is never consumed and the
            # rubrica on the same line is lost.
            if normalize_article_key(" ".join(tokens[:i]).rstrip(".")) == key:
                consumed = i
        if consumed:
            candidate = " ".join(tokens[consumed:]).strip().strip("().").strip()
            if candidate:
                return _restore_accents(" ".join(candidate.split()))

    # Component acts carry no <heading>: the rubrica is a parenthesised span
    # right after the article number. It appears in three shapes — a block of
    # its own, the opening of the body block, or split across lines mid-phrase
    # ("(Potere discrezionale del giudice nell'applicazione della pena:" /
    # "limiti)", art. 132 c.p.) — so the lines are joined before matching
    # rather than examined one by one.
    # Two kinds of preamble sit between the heading and the rubrica and have to
    # be stepped over first: the article number repeated ("Art. 1."), and — on
    # the FIRST article of a component part — the part's own title in capitals
    # ("CODICE CIVILE"). Everything from the first parenthesised block onwards
    # is then joined, because the span itself can be split across lines.
    tail = []
    for block in blocks[1:6]:
        if not tail:
            if block.startswith("("):
                tail.append(block)
                continue
            stripped = re.sub(r"^Art\.?\s*", "", block).rstrip(".")
            if key and normalize_article_key(stripped) == key:
                continue          # the repeated article number
            if block == block.upper() and len(block) < 90:
                continue          # the part title
            break                 # real body text: there is no rubrica here
        else:
            tail.append(block)

    match = _RUBRICA_LEADING_PAREN.match(" ".join(tail)) if tail else None
    if match:
        return _restore_accents(" ".join(match.group(1).split()))
    return None


# ---------------------------------------------------------------------------
# Article key normalization
# ---------------------------------------------------------------------------

_ORDINAL_SUFFIXES = (
    "bis", "ter", "quater", "quinquies", "sexies", "septies",
    "octies", "novies", "decies",
)


def normalize_article_key(numero_articolo: str) -> str:
    """Normalize an article reference to the canonical key form.

    Examples: ``"art. 2 bis"`` -> ``"2-bis"``, ``"2043"`` -> ``"2043"``,
    ``"art_2-bis"`` -> ``"2-bis"``, ``"2 BIS"`` -> ``"2-bis"``.
    """
    if not numero_articolo:
        return ""

    key = numero_articolo.strip().lower()
    # Drop leading "art_" (eId form) or "art."/"articolo"/"art" word.
    key = re.sub(r"^art_", "", key)
    key = re.sub(r"^\s*articol[oi]\b\.?\s*", "", key)
    key = re.sub(r"^\s*art\b\.?\s*", "", key)
    key = key.strip()

    # Unify separators between the number and an ordinal suffix: a space, a dash
    # or nothing all collapse to a single dash. e.g. "2 bis" / "2bis" -> "2-bis".
    suffix_alt = "|".join(_ORDINAL_SUFFIXES)
    m = re.match(rf"^(\d+)\s*[-\s]?\s*({suffix_alt})$", key)
    if m:
        return f"{m.group(1)}-{m.group(2)}"

    # Plain number (possibly with trailing punctuation/spaces).
    m = re.match(r"^(\d+)\b", key)
    if m and re.fullmatch(rf"\d+(?:\s*[-\s]\s*(?:{suffix_alt}))?", key):
        return key.replace(" ", "-")

    # Fallback: collapse internal whitespace to dashes, strip stray chars.
    key = re.sub(r"\s+", "-", key)
    key = re.sub(r"-{2,}", "-", key).strip("-")
    return key


# ---------------------------------------------------------------------------
# Component parts
# ---------------------------------------------------------------------------

# A component act can bundle more than one PART (see ``_parse_component``). The
# default lookup targets the dominant part (the code body); a caller may request
# another part by name. ``_PART_ALIASES`` maps a caller-facing hint to a
# substring of the real AKN PART name.
#: Name given to the flat <article> elements of a component act. They are the
#: enacting provisions, which Normattiva exposes as the "Dispositivo" annex.
_DISPOSITIVO_PART = "Dispositivo"

_PART_ALIASES = {
    # The codice civile AKN export bundles the preleggi as a separate part named
    # "Disposizioni sulla legge in generale".
    "preleggi": "disposizioni sulla legge in generale",
}


@dataclass
class ParsedPart:
    """One PART of a component act (e.g. the code body, or the preleggi)."""

    name: str
    articles: dict[str, str] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)

    @property
    def article_count(self) -> int:
        return len(self.order)


# ---------------------------------------------------------------------------
# ParsedAct
# ---------------------------------------------------------------------------

@dataclass
class ParsedAct:
    title: str
    articles: dict[str, str] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)
    structure: str = "flat"
    # All component parts keyed by their AKN PART name. Empty for flat acts and
    # for single-part component acts. ``articles``/``order`` mirror the dominant
    # part so the default (part-less) lookup is unchanged.
    parts: dict[str, ParsedPart] = field(default_factory=dict)

    def article(self, numero_articolo: str, part: str | None = None) -> str | None:
        """Return the markdown text of an article, or ``None`` if absent.

        Accepts ``"2043"``, ``"art. 2043"``, ``"2-bis"``, ``"2 bis"``. When
        ``part`` is given (e.g. ``"preleggi"``), the lookup targets that
        component part instead of the dominant one, and ``None`` is returned if
        the part is unknown.
        """
        key = normalize_article_key(numero_articolo)
        if part:
            matched = self._resolve_part(part)
            return matched.articles.get(key) if matched is not None else None
        return self.articles.get(key)

    def full_text(self, part: str | None = None) -> str:
        """Return all articles joined as markdown, prefixed by the act title.

        When ``part`` is given, only that component part is rendered (headed by
        the part's own name); an empty string is returned if the part is unknown.
        """
        if part:
            matched = self._resolve_part(part)
            if matched is None:
                return ""
            title = matched.name
            source_order, source_articles = matched.order, matched.articles
        else:
            title = self.title
            source_order, source_articles = self.order, self.articles
        out: list[str] = []
        if title:
            out.append(f"# {title}")
        for key in source_order:
            out.append(source_articles[key])
        return "\n\n".join(out).strip()

    def _resolve_part(self, query: str) -> "ParsedPart | None":
        """Resolve a part hint to a :class:`ParsedPart` (exact then substring)."""
        q = (query or "").strip().lower()
        if not q:
            return None
        q = _PART_ALIASES.get(q, q)
        for name, part in self.parts.items():
            if name.lower() == q:
                return part
        for name, part in self.parts.items():
            if q in name.lower():
                return part
        return None

    def part_article_count(self, part: str | None = None) -> int:
        """Article count of a component part (dominant part when ``part`` is None)."""
        if part:
            matched = self._resolve_part(part)
            return matched.article_count if matched is not None else 0
        return len(self.order)

    def part_title(self, part: str | None = None) -> str:
        """Display title: the selected part's name (falling back to the act
        title if the part is unknown), or the act title when ``part`` is None."""
        if part:
            matched = self._resolve_part(part)
            if matched is not None:
                return matched.name
        return self.title

    def rubriche(self, part: str | None = None) -> dict[str, str]:
        """Article key -> rubrica, for every article that has one.

        Built for the index: Normattiva's article tree carries only numbers, so
        this is where the titles come from. Articles without a rubrica are
        absent from the map rather than present with an empty value.
        """
        matched = self._resolve_part(part) if part else None
        articles = matched.articles if matched else self.articles
        out: dict[str, str] = {}
        for key, text in articles.items():
            rubrica = extract_rubrica(text, key)
            if rubrica:
                out[key] = rubrica
        return out

    def abrogati(self, part: str | None = None) -> list[str]:
        """Keys of the articles this act declares repealed."""
        matched = self._resolve_part(part) if part else None
        articles = matched.articles if matched else self.articles
        return [key for key, text in articles.items() if is_abrogato(text)]

    @property
    def article_count(self) -> int:
        return len(self.order)


# ---------------------------------------------------------------------------
# Text cleaning
# ---------------------------------------------------------------------------

def _strip_modification_markers(text: str) -> str:
    """Remove the literal ``(( ))`` Normattiva modification markers."""
    text = text.replace("((", "").replace("))", "")
    return text


def _clean_text(text: str) -> str:
    """Collapse whitespace runs and trim, preserving paragraph breaks."""
    text = _strip_modification_markers(text)
    # Normalize spaces/tabs (not newlines) within lines.
    text = re.sub(r"[ \t]+", " ", text)
    # Trim trailing spaces on each line.
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    # Collapse 3+ blank lines to a single blank line.
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _collect(node, parts: list[str]) -> None:
    """Recursively collect text, dropping ``<del>`` subtrees, keeping ``<ins>``."""
    local = etree.QName(node).localname if isinstance(node.tag, str) else ""
    if local == "del":
        return  # drop deleted text entirely
    if node.text:
        parts.append(node.text)
    for child in node:
        _collect(child, parts)
        if child.tail:
            parts.append(child.tail)


# ---------------------------------------------------------------------------
# Flat structure
# ---------------------------------------------------------------------------

def _local(tag: str) -> str:
    return f"*[local-name()='{tag}']"


def _child_text(elem, tag: str) -> str:
    children = elem.xpath(_local(tag))
    if not children:
        return ""
    return _flatten(children[0])


def _flatten(elem) -> str:
    """Flatten an element to plain text, ins-aware."""
    parts: list[str] = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        _collect(child, parts)
        if child.tail:
            parts.append(child.tail)
    return "".join(parts).strip()


def _render_flat_article(article) -> str:
    """Render a flat ``<article>`` element to markdown."""
    num = _child_text(article, "num").strip()
    heading = ""
    headings = article.xpath(_local("heading"))
    if headings:
        heading = _flatten(headings[0]).strip()

    header = f"### {num}".rstrip() if num else "###"
    if heading:
        header = f"{header} {heading}".strip()

    lines: list[str] = [header]

    paragraphs = article.xpath(_local("paragraph"))
    if paragraphs:
        for para in paragraphs:
            lines.append(_render_flat_paragraph(para))
    else:
        # No commi: dump any content/p directly.
        body = "\n".join(
            _flatten(p) for p in article.xpath(f".//{_local('content')}/{_local('p')}")
        ).strip()
        if body:
            lines.append(body)

    return _clean_text("\n\n".join(part for part in lines if part.strip()))


def _render_flat_paragraph(para) -> str:
    """Render a ``<paragraph>`` (comma), including any ``<point>`` (lettere)."""
    num = _child_text(para, "num").strip()
    chunks: list[str] = []

    points = para.xpath(f".//{_local('point')}")
    if points:
        intro = para.xpath(f".//{_local('intro')}")
        intro_text = _flatten(intro[0]).strip() if intro else ""
        head = f"{num} {intro_text}".strip() if num else intro_text
        if head:
            chunks.append(head)
        for point in points:
            p_num = _child_text(point, "num").strip()
            p_body = "\n".join(
                _flatten(p) for p in point.xpath(f".//{_local('content')}/{_local('p')}")
            ).strip()
            if not p_body:
                p_body = _flatten(point).strip()
            chunks.append(f"  {p_num} {p_body}".rstrip())
    else:
        body = "\n".join(
            _flatten(p) for p in para.xpath(f".//{_local('content')}/{_local('p')}")
        ).strip()
        if not body:
            body = _flatten(para).strip()
        chunks.append(f"{num} {body}".strip() if num else body)

    return "\n".join(chunk for chunk in chunks if chunk.strip())


def _parse_flat(root) -> tuple[dict[str, str], list[str]]:
    """Parse flat ``<article eId="art_N">`` elements under the body."""
    articles: dict[str, str] = {}
    order: list[str] = []
    for article in root.xpath(f"//{_local('body')}//{_local('article')}"):
        eid = article.get("eId", "")
        if not eid:
            continue
        key = normalize_article_key(eid)
        if not key or key in articles:
            continue
        rendered = _render_flat_article(article)
        if rendered:
            articles[key] = rendered
            order.append(key)
    return articles, order


# ---------------------------------------------------------------------------
# Component structure
# ---------------------------------------------------------------------------

_DOC_NAME_RE = re.compile(r"^(?P<part>.+?)-art\.\s*(?P<num>.+)$", re.IGNORECASE)


def _render_component_doc(doc, num_label: str) -> str:
    """Render a component ``<doc>`` element to markdown."""
    paragraphs = doc.xpath(f".//{_local('mainBody')}//{_local('paragraph')}")
    body_chunks: list[str] = []
    update_chunks: list[str] = []

    for para in paragraphs:
        ps = para.xpath(f".//{_local('content')}/{_local('p')}")
        if not ps:
            ps = para.xpath(f".//{_local('p')}")
        para_text = "\n".join(_flatten(p) for p in ps).strip()
        if not para_text:
            continue
        # Modification-history blocks start with a separator line / AGGIORNAMENTO.
        if para_text.startswith(_AGGIORNAMENTO_MARKER) or "AGGIORNAMENTO" in para_text.split("\n")[0]:
            update_chunks.append(para_text)
        else:
            body_chunks.append(para_text)

    body = "\n\n".join(body_chunks).strip()
    # The body already embeds "Art. N." + rubrica inline; add a markdown header
    # for consistency with the flat renderer.
    header = f"### Art. {num_label}".rstrip()
    parts = [header]
    if body:
        parts.append(body)
    if update_chunks:
        parts.append("\n\n".join(update_chunks))
    return _clean_text("\n\n".join(parts))


def _parse_component(root) -> tuple[dict[str, ParsedPart], str]:
    """Parse component ``<doc name="PART-art. N">`` elements into parts.

    Returns ``(parts, main_part_name)`` where ``parts`` maps each PART name to a
    :class:`ParsedPart`. For codici with multiple parts (e.g. the preleggi plus
    the main code), every part is kept and the dominant one (most articles) is
    reported as ``main_part_name`` — it becomes the act's default lookup.
    """
    docs = root.xpath(f"//{_local('attachments')}//{_local('doc')}")

    # Group docs by PART prefix.
    by_part: dict[str, list[tuple[str, object]]] = {}
    for doc in docs:
        name = (doc.get("name") or "").strip()
        m = _DOC_NAME_RE.match(name)
        if not m:
            continue
        part = m.group("part").strip()
        num_raw = m.group("num").strip()
        by_part.setdefault(part, []).append((num_raw, doc))

    if not by_part:
        return {}, ""

    parts: dict[str, ParsedPart] = {}
    for part_name, entries in by_part.items():
        articles: dict[str, str] = {}
        order: list[str] = []
        for num_raw, doc in entries:
            key = normalize_article_key(num_raw)
            if not key or key in articles:
                continue
            rendered = _render_component_doc(doc, num_raw)
            if rendered:
                articles[key] = rendered
                order.append(key)
        if articles:
            parts[part_name] = ParsedPart(name=part_name, articles=articles, order=order)

    if not parts:
        return {}, ""

    # The dominant part (largest) is the main code; it is the default lookup.
    main_part = max(parts, key=lambda p: parts[p].article_count)
    return parts, main_part


# ---------------------------------------------------------------------------
# Title
# ---------------------------------------------------------------------------

def _extract_title(root) -> str:
    titles = root.xpath(f"//{_local('docTitle')}")
    if titles:
        text = _flatten(titles[0]).strip()
        if text:
            return text
    aliases = root.xpath(f"//{_local('FRBRalias')}")
    if aliases:
        val = aliases[0].get("value")
        if val:
            return val
    return ""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_akn(xml: str) -> ParsedAct:
    """Parse an Akoma Ntoso XML string into a ``ParsedAct``.

    Auto-detects flat vs component structure: if the act has component
    ``<doc name="...-art. N">`` elements, those win (they carry the full set for
    codici); otherwise the flat ``<article>`` elements are used.
    """
    if isinstance(xml, str):
        xml_bytes = xml.encode("utf-8")
    else:
        xml_bytes = xml
    # recover=True keeps a malformed export usable. resolve_entities=False and
    # no_network=True close the XXE / billion-laughs surface that lxml leaves
    # open by default; huge_tree is dropped because it lifts libxml2's limits on
    # entity expansion and nesting depth and the fixtures parse without it.
    parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
    try:
        root = etree.fromstring(xml_bytes, parser=parser)
    except etree.XMLSyntaxError as exc:
        # An empty body or an HTML error page reaches here. The caller treats an
        # article-less act as "AKN had nothing to say" and falls back to the
        # HTML path, so return that shape rather than propagating — but say so.
        log.warning("AKN payload is not parseable XML",
                    length=len(xml_bytes), error=str(exc))
        return ParsedAct(title="")
    if root is None:
        log.warning("AKN payload parsed to no root element", length=len(xml_bytes))
        return ParsedAct(title="")

    title = _extract_title(root)

    parts, main_part = _parse_component(root)
    if parts:
        main = parts[main_part]
        # A component act ALSO carries a couple of flat <article> elements at the
        # top. They are not duplicates of the components: they are the enacting
        # provisions — "È approvato il testo del Codice civile…" — which
        # Normattiva serves as the act's *Dispositivo*, its own annex.
        #
        # They stay out of `articles`/`order`, because a text lookup for "art. 1"
        # must keep resolving to art. 1 of the code body. But they are kept as
        # their own part, so the index can label the Dispositivo with its own
        # titles instead of borrowing the code body's — which is what happened
        # while this part was discarded: art. 1 of the Dispositivo was shown as
        # "Capacità giuridica", the rubrica of a different article entirely.
        flat_articles, flat_order = _parse_flat(root)
        if flat_articles:
            parts = dict(parts)
            parts[_DISPOSITIVO_PART] = ParsedPart(
                name=_DISPOSITIVO_PART, articles=flat_articles, order=flat_order
            )
        return ParsedAct(
            title=title,
            articles=main.articles,
            order=main.order,
            structure="component",
            parts=parts,
        )

    flat_articles, flat_order = _parse_flat(root)
    return ParsedAct(
        title=title,
        articles=flat_articles,
        order=flat_order,
        structure="flat",
    )
