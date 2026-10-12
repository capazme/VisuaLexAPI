"""A court decision as VisuaLex reads it (design 2026-10-01 §1).

A *reference* is what a citation says and may be ambiguous; an *identity* is what VisuaLex
resolved and is unique. The identity, and its key, are shared by the page's address, the
dossier item, the MERL-T graph and the remote MCP server: its fields must not drift.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

# The courts of the Union are named by their case (design 2026-10-12 §3, Q10 decided on 12 October
# 2026): the Court of Justice since its first cases, the General Court since 1989.
EU_COURTS: tuple[str, ...] = ("corte_giustizia_ue", "tribunale_ue")
# The administrative courts (design 2026-10-12-administrative-courts §2, D1): each kind of measure
# numbered in its own series, so the kind is part of the identity, and a TAR's seat too.
ADMIN_COURTS: tuple[str, ...] = ("consiglio_di_stato", "cgars", "tar")
CORTI: tuple[str, ...] = ("cassazione", "corte_costituzionale", *EU_COURTS, *ADMIN_COURTS)
ARCHIVI: tuple[str, ...] = ("civile", "penale")
FIRST_YEAR: dict[str, int] = {"cassazione": 1900, "corte_costituzionale": 1956,
                              "corte_giustizia_ue": 1953, "tribunale_ue": 1989,
                              "consiglio_di_stato": 1990, "cgars": 1990, "tar": 1990}
MAX_NUMERO = 999_999
#: a case number of the Union's courts: four digits, as the CELEX writes it
MAX_NUMERO_CAUSA = 9_999
#: a measure's number at giustizia-amministrativa.it: five digits, as the search takes it
MAX_NUMERO_AMMINISTRATIVO = 99_999
#: the kind of a measure, as the ECLI's suffix writes it (lower case): sent, senb, ocau, …
PROVVEDIMENTO = re.compile(r"[a-z]{3,6}", re.ASCII)
#: the families a citation names («sent.», «ord.», «decr.») and the kinds each holds
FAMIGLIE: dict[str, tuple[str, ...]] = {
    "sentenza": ("sent", "senb"),
    "ordinanza": ("ocau", "ocol", "ord"),
    "decreto": ("dcau", "ddec", "dpres"),
}

# Section codes as Italgiure indexes them (`szdec`): 1-7, L (lavoro), U (Sezioni Unite),
# F (feriale). Tributaria is civil section 5 and has no code of its own.
_ROMAN = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6", "VII": "7"}
_NAMED = {"SU": "U", "U": "U", "UNITE": "U", "SEZIONIUNITE": "U", "SSUU": "U",
          "L": "L", "LAV": "L", "LAVORO": "L", "F": "F", "FER": "F", "FERIALE": "F"}
_TRIBUTARIA = {"T", "TRIB", "TRIBUTARIA"}
_ATTRIBUTES = ("sezione", "tipo", "data_deposito", "data_decisione", "ecli", "relatore",
               "presidente", "materia", "testo_assente", "testo_origine",
               "parti", "cause_riunite", "lingua_processuale")


@dataclass(frozen=True)
class Section:
    code: str | None          # 1-7, L, U, F; None when absent or unreadable
    raw: str | None           # as written, for the notice
    recognised: bool = True
    civil_only: bool = False  # tributaria is a civil section


def normalize_section(raw: object) -> Section:
    if raw is None or not str(raw).strip():
        return Section(None, None)
    text = str(raw).strip()
    key = re.sub(r"[\s.]", "", text).upper()
    if key in _TRIBUTARIA:
        return Section("5", text, civil_only=True)
    if key in _NAMED:
        return Section(_NAMED[key], text)
    if key in _ROMAN:
        return Section(_ROMAN[key], text)
    if key in {"1", "2", "3", "4", "5", "6", "7"}:
        return Section(key, text)
    return Section(None, text, recognised=False)


@dataclass(frozen=True)
class Identity:
    corte: str
    numero: int
    anno: int
    archivio: str | None = None  # always set for the Cassazione
    sede: str | None = None  # a TAR's seat (tar_seats.py), always set for a TAR
    provvedimento: str | None = None  # the kind, always set for the administrative courts

    def key(self) -> str:
        if self.corte == "cassazione":
            return f"cassazione:{self.archivio}:{self.numero}:{self.anno}"
        if self.corte == "tar":
            return f"tar:{self.sede}:{self.provvedimento}:{self.numero}:{self.anno}"
        if self.corte in ADMIN_COURTS:
            return f"{self.corte}:{self.provvedimento}:{self.numero}:{self.anno}"
        return f"{self.corte}:{self.numero}:{self.anno}"

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"corte": self.corte, "numero": self.numero, "anno": self.anno}
        if self.archivio:
            out["archivio"] = self.archivio
        if self.sede:
            out["sede"] = self.sede
        if self.provvedimento:
            out["provvedimento"] = self.provvedimento
        return out


@dataclass(frozen=True)
class Reference:
    corte: str
    numero: int
    anno: int
    archivio: str | None = None
    sezione: Section = field(default_factory=lambda: Section(None, None))
    # the administrative courts: a TAR's seat, or its region alone (D3); the exact kind, or the
    # family the citation names (D2: none named is a sentenza)
    sede: str | None = None
    regione: str | None = None
    provvedimento: str | None = None
    tipo: str | None = None


@dataclass
class Decision:
    identita: Identity
    sezione: str | None = None
    tipo: str | None = None
    data_deposito: str | None = None   # ISO
    data_decisione: str | None = None  # ISO (Corte costituzionale)
    ecli: str | None = None
    relatore: str | None = None
    presidente: str | None = None
    materia: str | None = None
    # why the source gives no text: "oscuramento" or "valutazione_oscuramento" when it said so; None otherwise
    testo_assente: str | None = None
    # where the Cassazione's text was read: "pdf" (the court's original) or "archivio" (Italgiure's
    # text field, possibly cut short); None for a source with one way to read
    testo_origine: str | None = None
    # the courts of the Union: the parties as the source names them, every case of a judgment on
    # joined cases («C-293/12», «C-594/12»), the procedure language
    parti: str | None = None
    cause_riunite: list[str] | None = None
    lingua_processuale: str | None = None
    testo: dict[str, str] = field(default_factory=dict)  # epigrafe?, motivazione, dispositivo?
    fonte: dict[str, str] = field(default_factory=dict)  # nome, licenza?, url?

    def to_dict(self) -> dict[str, Any]:
        return {
            "identita": self.identita.to_dict(),
            "attributi": {name: getattr(self, name) for name in _ATTRIBUTES
                          if getattr(self, name)},
            "testo": dict(self.testo),
            "fonte": dict(self.fonte),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Decision:
        ident = data["identita"]
        attrs = data.get("attributi", {})
        return cls(
            identita=Identity(ident["corte"], int(ident["numero"]), int(ident["anno"]),
                              ident.get("archivio"), ident.get("sede"), ident.get("provvedimento")),
            testo=dict(data.get("testo", {})),
            fonte=dict(data.get("fonte", {})),
            **{name: attrs.get(name) for name in _ATTRIBUTES},
        )


class InvalidReference(ValueError):
    def __init__(self, errors: dict[str, str]):
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))
        self.errors = errors


def _int_field(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"\d{1,7}", value.strip(), re.ASCII):
        return int(value.strip())
    return None


def parse_reference(body: object, today: date | None = None) -> Reference:
    """The reference in a request body, or InvalidReference naming every bad field."""
    if not isinstance(body, dict):
        raise InvalidReference({"body": "atteso un oggetto JSON"})
    today = today or date.today()
    errors: dict[str, str] = {}
    corte = body.get("corte")
    if corte not in CORTI:
        errors["corte"] = "attesa una corte tra " + ", ".join(CORTI)
    numero = _int_field(body.get("numero"))
    highest = (MAX_NUMERO_CAUSA if corte in EU_COURTS
               else MAX_NUMERO_AMMINISTRATIVO if corte in ADMIN_COURTS else MAX_NUMERO)
    if numero is None or not 1 <= numero <= highest:
        errors["numero"] = f"atteso un numero da 1 a {highest}"
    first = FIRST_YEAR.get(corte, 1900) if isinstance(corte, str) else 1900
    anno = _int_field(body.get("anno"))
    if anno is None or not first <= anno <= today.year:
        errors["anno"] = f"atteso un anno dal {first} al {today.year}"
    archivio = body.get("archivio")
    if archivio is not None and archivio not in ARCHIVI:
        errors["archivio"] = "atteso civile o penale"
    if corte in ADMIN_COURTS:
        return _admin_reference(body, corte, numero, anno, errors)
    if errors:
        raise InvalidReference(errors)
    if corte == "corte_costituzionale" or corte in EU_COURTS:
        return Reference(corte, numero, anno)
    sezione = normalize_section(body.get("sezione"))
    if archivio is None and sezione.civil_only:
        archivio = "civile"
    return Reference("cassazione", numero, anno, archivio, sezione)


def _admin_reference(body: dict, corte: str, numero: int | None, anno: int | None,
                     errors: dict[str, str]) -> Reference:
    """A reference to the Consiglio di Stato, the C.G.A.R.S. or a TAR: the seat (or the region) for
    a TAR only, an exact kind or a family, the section as written."""
    from .tar_seats import BY_SLUG, region_named

    sede, regione = body.get("sede"), body.get("regione")
    provvedimento, tipo = body.get("provvedimento"), body.get("tipo")
    if corte == "tar":
        if sede is not None and sede not in BY_SLUG:
            errors["sede"] = "sede del TAR non riconosciuta"
        if regione is not None and (not isinstance(regione, str) or region_named(regione) is None):
            errors["regione"] = "regione non riconosciuta"
        if sede is None and regione is None:
            errors["sede"] = "per un TAR serve la sede o la regione"
    elif sede is not None or regione is not None:
        errors["sede"] = "la sede vale solo per un TAR"
    if provvedimento is not None and not (isinstance(provvedimento, str) and PROVVEDIMENTO.fullmatch(provvedimento)):
        errors["provvedimento"] = "tipo di provvedimento non valido"
    if tipo is not None and tipo not in FAMIGLIE:
        errors["tipo"] = "atteso sentenza, ordinanza o decreto"
    if errors:
        raise InvalidReference(errors)
    raw_section = body.get("sezione")
    section = Section(None, str(raw_section).strip()[:20]) if raw_section not in (None, "") else Section(None, None)
    return Reference(corte, numero, anno, None, section,
                     sede=sede, regione=region_named(regione) if isinstance(regione, str) else None,
                     provvedimento=provvedimento, tipo=tipo)
