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

CORTI: tuple[str, ...] = ("cassazione", "corte_costituzionale")
ARCHIVI: tuple[str, ...] = ("civile", "penale")
FIRST_YEAR: dict[str, int] = {"cassazione": 1900, "corte_costituzionale": 1956}
MAX_NUMERO = 999_999

# Section codes as Italgiure indexes them (`szdec`): 1-7, L (lavoro), U (Sezioni Unite),
# F (feriale). Tributaria is civil section 5 and has no code of its own.
_ROMAN = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6", "VII": "7"}
_NAMED = {"SU": "U", "U": "U", "UNITE": "U", "SEZIONIUNITE": "U", "SSUU": "U",
          "L": "L", "LAV": "L", "LAVORO": "L", "F": "F", "FER": "F", "FERIALE": "F"}
_TRIBUTARIA = {"T", "TRIB", "TRIBUTARIA"}
_ATTRIBUTES = ("sezione", "tipo", "data_deposito", "data_decisione", "ecli", "relatore",
               "presidente", "materia", "testo_assente")


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

    def key(self) -> str:
        if self.corte == "cassazione":
            return f"cassazione:{self.archivio}:{self.numero}:{self.anno}"
        return f"corte_costituzionale:{self.numero}:{self.anno}"

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"corte": self.corte, "numero": self.numero, "anno": self.anno}
        if self.archivio:
            out["archivio"] = self.archivio
        return out


@dataclass(frozen=True)
class Reference:
    corte: str
    numero: int
    anno: int
    archivio: str | None = None
    sezione: Section = field(default_factory=lambda: Section(None, None))


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
    # why the source gives no text: "oscuramento" when it said so; None otherwise
    testo_assente: str | None = None
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
                              ident.get("archivio")),
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
        errors["corte"] = "atteso cassazione o corte_costituzionale"
    numero = _int_field(body.get("numero"))
    if numero is None or not 1 <= numero <= MAX_NUMERO:
        errors["numero"] = "atteso un numero da 1 a 999999"
    first = FIRST_YEAR.get(corte, 1900) if isinstance(corte, str) else 1900
    anno = _int_field(body.get("anno"))
    if anno is None or not first <= anno <= today.year:
        errors["anno"] = f"atteso un anno dal {first} al {today.year}"
    archivio = body.get("archivio")
    if archivio is not None and archivio not in ARCHIVI:
        errors["archivio"] = "atteso civile o penale"
    if errors:
        raise InvalidReference(errors)
    if corte == "corte_costituzionale":
        return Reference("corte_costituzionale", numero, anno)
    sezione = normalize_section(body.get("sezione"))
    if archivio is None and sezione.civil_only:
        archivio = "civile"
    return Reference("cassazione", numero, anno, archivio, sezione)
