# services/merlt/merlt/pipeline/massimario/identity.py
"""Who a cited decision is: the identity shared with the sentenze round (spec §5.2).

`numero` without leading zeros; for criminal decisions `anno` is the deposit
year (the year of the number, as Italgiure indexes it); the section is an
attribute, never part of the identity.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from merlt.utils.sources import decision_short

CASSAZIONE = "cassazione"
CORTE_COSTITUZIONALE = "corte_costituzionale"
ARCHIVI = ("civile", "penale")


@dataclass(frozen=True)
class DecisionIdentity:
    corte: str
    numero: int
    anno: int
    archivio: Optional[str] = None  # Cassazione only

    def __post_init__(self) -> None:
        if self.corte == CASSAZIONE:
            if self.archivio not in ARCHIVI:
                raise ValueError(f"archivio non valido per la Cassazione: {self.archivio!r}")
        elif self.corte == CORTE_COSTITUZIONALE:
            if self.archivio is not None:
                raise ValueError("la Corte costituzionale non ha archivio")
        else:
            raise ValueError(f"corte non valida: {self.corte!r}")
        if self.numero <= 0 or not 1900 <= self.anno <= 2100:
            raise ValueError(f"numero o anno fuori intervallo: {self.numero}/{self.anno}")

    @property
    def key(self) -> str:
        if self.corte == CASSAZIONE:
            return f"{CASSAZIONE}:{self.archivio}:{self.numero}:{self.anno}"
        return f"{CORTE_COSTITUZIONALE}:{self.numero}:{self.anno}"


@dataclass
class CitedDecision:
    """A decision as one paragraph cites it; `identity` is None when it cannot be established."""

    corte: str
    numero: int
    anno: Optional[int]
    archivio: Optional[str]
    sezione: Optional[str] = None
    relatore: Optional[str] = None
    data_udienza: Optional[str] = None  # ISO date
    rv: list[str] = field(default_factory=list)
    forma: str = ""
    anno_implicito: bool = False
    identity: Optional[DecisionIdentity] = None
    motivo_senza_identita: Optional[str] = None

    @property
    def estremi(self) -> str:
        """The decision's short label (source convention, D2): "Cass. civ., sez. un., n. 31310/2024"."""
        return decision_short(self.corte, self.numero, self.anno, self.archivio, self.sezione)

    @property
    def label(self) -> str:
        """As the chip shows it: the short label and the massime ("… · Rv. 673165-01")."""
        return decision_short(self.corte, self.numero, self.anno, self.archivio, self.sezione, self.rv or None)
