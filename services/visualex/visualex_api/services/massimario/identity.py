# services/visualex/visualex_api/services/massimario/identity.py
"""Who a cited decision is: the identity shared with the sentenze round (spec §5.2).

A copy of MERL-T's `merlt/pipeline/massimario/identity.py` (its graph key), kept apart so
this package never imports MERL-T (design 2026-10-30-rassegne-without-merlt §3.1). Both
copies are pinned to the decision keys of `conventions/sources/golden.json`
(`tests/test_massimario_identity.py` here). The labels (`estremi`, `label`) are not copied:
the web writes a decision's label from its fields (`formatDecisionShort`), and MERL-T
computes its own `estremi` (§5).

`numero` without leading zeros; for criminal decisions `anno` is the deposit
year (the year of the number, as Italgiure indexes it); the section is an
attribute, never part of the identity.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# The kind of an administrative measure: the ECLI's suffix in lower case (sent, ocau, …).
_KIND = re.compile(r"[a-z]{3,6}")

CASSAZIONE = "cassazione"
CORTE_COSTITUZIONALE = "corte_costituzionale"
ARCHIVI = ("civile", "penale")
#: the courts of the Union, named by their case, and the first year of each
EU_COURTS = {"corte_giustizia_ue": 1953, "tribunale_ue": 1989}
#: the administrative courts, keyed by kind (and a TAR by seat)
ADMIN_COURTS = ("consiglio_di_stato", "cgars", "tar")


@dataclass(frozen=True)
class DecisionIdentity:
    corte: str
    numero: int
    anno: int
    archivio: Optional[str] = None  # Cassazione only
    sede: Optional[str] = None  # a TAR's seat (services/decisions/tar_seats.py)
    provvedimento: Optional[str] = None  # the kind, for the administrative courts (sent, ocau, …)

    def __post_init__(self) -> None:
        if self.corte == CASSAZIONE:
            if self.archivio not in ARCHIVI:
                raise ValueError(f"archivio non valido per la Cassazione: {self.archivio!r}")
        elif self.corte == CORTE_COSTITUZIONALE:
            if self.archivio is not None:
                raise ValueError("la Corte costituzionale non ha archivio")
        elif self.corte in ADMIN_COURTS:
            # by kind, number and year, a TAR by its seat too (design 2026-10-12-administrative-courts §2)
            from ..decisions.tar_seats import BY_SLUG as SEATS
            if (self.archivio is not None or not _KIND.fullmatch(self.provvedimento or "")
                    or self.numero > 99999 or self.anno < 1990
                    or (self.corte == "tar") != (self.sede is not None)
                    or (self.sede is not None and self.sede not in SEATS)):
                raise ValueError(f"provvedimento non valido per {self.corte}: {self.numero}/{self.anno}")
        elif self.corte in EU_COURTS:
            # named by the case (convention, design 2026-10-12 §3.1): a number of four digits
            if self.archivio is not None or self.numero > 9999 or self.anno < EU_COURTS[self.corte]:
                raise ValueError(f"causa non valida per {self.corte}: {self.numero}/{self.anno}")
        else:
            raise ValueError(f"corte non valida: {self.corte!r}")
        if self.numero <= 0 or not 1900 <= self.anno <= 2100:
            raise ValueError(f"numero o anno fuori intervallo: {self.numero}/{self.anno}")

    @property
    def key(self) -> str:
        if self.corte == CASSAZIONE:
            return f"{CASSAZIONE}:{self.archivio}:{self.numero}:{self.anno}"
        if self.corte == "tar":
            return f"tar:{self.sede}:{self.provvedimento}:{self.numero}:{self.anno}"
        if self.corte in ADMIN_COURTS:
            return f"{self.corte}:{self.provvedimento}:{self.numero}:{self.anno}"
        return f"{self.corte}:{self.numero}:{self.anno}"


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
    sede: Optional[str] = None  # a TAR's seat (the Massimario cites the Cassazione and the Corte costituzionale only)

