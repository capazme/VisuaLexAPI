# services/merlt/merlt/pipeline/massimario/identity.py
"""Who a cited decision is: the identity shared with the sentenze round (spec §5.2).

`numero` without leading zeros; for criminal decisions `anno` is the deposit
year (the year of the number, as Italgiure indexes it); the section is an
attribute, never part of the identity.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

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
        if self.corte == CORTE_COSTITUZIONALE:
            return f"Corte cost., n. {self.numero}/{self.anno}"
        court = {"civile": "Cass. civ.", "penale": "Cass. pen."}.get(self.archivio or "", "Cass.")
        return f"{court}, n. {self.numero}/{self.anno}" if self.anno else f"{court}, n. {self.numero}"

    @property
    def label(self) -> str:
        """As the chip shows it: the section as written, number/year, the massime."""
        if self.corte == CORTE_COSTITUZIONALE or not self.sezione:
            head = self.estremi
        else:
            head = f"Sez. {self.sezione}, n. {self.numero}" + (f"/{self.anno}" if self.anno else "")
        return f"{head} · Rv. {', '.join(self.rv)}" if self.rv else head
