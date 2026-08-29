"""The contract every court adapter speaks.

`link_kind` is the load-bearing field. The sources do not agree on what
"related to this article" means: CELLAR publishes a citation graph the court
itself declared, while Italgiure and CeRDEF match strings in the decision text.
Averaging those into one relevance score would hide exactly the difference a
lawyer needs in order to decide how far to trust a row, so the difference is
carried, not resolved (spec D2).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol


class LinkKind(str, Enum):
    #: The source declares this decision cites the norm.
    CITED = "cited"
    #: The norm's text was found in the decision. An inference, not a fact.
    MATCHED = "matched"


@dataclass
class Decisione:
    organo: str
    numero: str
    anno: int
    link_kind: LinkKind
    url: str
    sezione: str = ""
    data: str = ""
    ecli: str = ""
    estratto: str = ""

    def to_dict(self) -> dict:
        return {
            "organo": self.organo,
            "numero": self.numero,
            "anno": self.anno,
            "link_kind": self.link_kind.value,
            "url": self.url,
            "sezione": self.sezione,
            "data": self.data,
            "ecli": self.ecli,
            "estratto": self.estratto,
        }


@dataclass
class SourceResult:
    """One source's answer, including the answer "I could not reach it".

    A failed source returns `ok=False` rather than an empty list, so the caller
    can say which source is missing instead of implying there is nothing to
    find (CLAUDE.md gotcha 18).
    """

    organo: str
    decisioni: list[Decisione] = field(default_factory=list)
    ok: bool = True
    error: str = ""
    coverage: str = ""

    def to_dict(self) -> dict:
        return {
            "organo": self.organo,
            "ok": self.ok,
            "error": self.error,
            "coverage": self.coverage,
            "decisioni": [d.to_dict() for d in self.decisioni],
            "count": len(self.decisioni),
        }


def _version() -> str:
    """The deployed version, so a source operator can tell releases apart."""
    from pathlib import Path

    f = Path(__file__).resolve().parents[3] / "version.txt"
    try:
        return f.read_text().strip() or "0"
    except OSError:
        return "0"


#: Spec D5. Names the product, carries a contact, impersonates nothing. Every
#: source in this package was verified to answer this string; if one starts
#: refusing it, that is a fact to record and act on, not to hide behind a
#: browser string.
USER_AGENT = f"VisuaLex/{_version()} (ricerca giuridica; +https://visualex.org)"


def http_headers(extra: dict | None = None) -> dict:
    """Request headers for an outbound call to a case-law source."""
    headers = {"User-Agent": USER_AGENT}
    if extra:
        headers.update(extra)
    return headers


class CaseLawAdapter(Protocol):
    organo: str
    coverage: str

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        ...

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        ...

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        ...
