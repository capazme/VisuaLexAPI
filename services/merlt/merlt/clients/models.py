"""
Data Models for VisuaLex Client

These models replicate the core data structures from visualex-api,
allowing merlt to work with legal norm data received via HTTP.

The models are designed to:
1. Deserialize JSON responses from visualex-api
2. Provide the same interface as the original visualex models
3. Work independently without requiring visualex as a dependency
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
import re


class TipoModifica(Enum):
    """
    Tipi di modifica normativa supportati.

    Basato su Normattiva FAQ:
    - ABROGA: Abrogazione totale dell'articolo
    - SOSTITUISCE: Sostituzione integrale del testo
    - MODIFICA: Modifica parziale del testo
    - INSERISCE: Inserimento nuovo articolo (bis, ter, quater...)
    """
    ABROGA = "abroga"
    SOSTITUISCE = "sostituisce"
    MODIFICA = "modifica"
    INSERISCE = "inserisce"

    @classmethod
    def from_string(cls, s: str) -> "TipoModifica":
        """
        Parse tipo modifica from Normattiva string.

        Examples:
            - "ABROGAZIONE" -> ABROGA
            - "SOSTITUZIONE" -> SOSTITUISCE
            - "MODIFICA" -> MODIFICA
            - "INSERIMENTO" -> INSERISCE
        """
        s_lower = s.lower().strip()
        mapping = {
            "abrogazione": cls.ABROGA,
            "abrogato": cls.ABROGA,
            "abroga": cls.ABROGA,
            "sostituzione": cls.SOSTITUISCE,
            "sostituito": cls.SOSTITUISCE,
            "sostituisce": cls.SOSTITUISCE,
            "modifica": cls.MODIFICA,
            "modificato": cls.MODIFICA,
            "inserimento": cls.INSERISCE,
            "inserito": cls.INSERISCE,
            "inserisce": cls.INSERISCE,
            "aggiunto": cls.INSERISCE,
        }
        return mapping.get(s_lower, cls.MODIFICA)


@dataclass
class Modifica:
    """
    Rappresenta una singola modifica normativa.

    Esempio:
        Art. 2 della L. 241/1990 è stato modificato dalla
        L. 15 maggio 1997, n. 127, art. 17, comma 2

    Attributes:
        tipo_modifica: Tipo di modifica (abroga, sostituisce, modifica, inserisce)
        atto_modificante_urn: URN completo dell'atto che modifica
        atto_modificante_estremi: Estremi leggibili (es. "L. 15 maggio 1997, n. 127")
        disposizione: Parte specifica dell'atto (es. "art. 17, comma 2")
        destinazione: Parte target modificata (es. "art. 2" o "art. 2, comma 1")
        data_efficacia: Data di entrata in vigore della modifica
        data_pubblicazione_gu: Data pubblicazione Gazzetta Ufficiale
        note: Note aggiuntive (opzionale)
    """
    tipo_modifica: TipoModifica
    atto_modificante_urn: str
    atto_modificante_estremi: str
    data_efficacia: str
    disposizione: Optional[str] = None
    destinazione: Optional[str] = None
    data_pubblicazione_gu: Optional[str] = None
    note: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "tipo_modifica": self.tipo_modifica.value,
            "atto_modificante_urn": self.atto_modificante_urn,
            "atto_modificante_estremi": self.atto_modificante_estremi,
            "disposizione": self.disposizione,
            "destinazione": self.destinazione,
            "data_efficacia": self.data_efficacia,
            "data_pubblicazione_gu": self.data_pubblicazione_gu,
            "note": self.note,
        }

    @staticmethod
    def from_dict(data: dict) -> "Modifica":
        """Create from dictionary."""
        return Modifica(
            tipo_modifica=TipoModifica(data["tipo_modifica"]),
            atto_modificante_urn=data["atto_modificante_urn"],
            atto_modificante_estremi=data["atto_modificante_estremi"],
            disposizione=data.get("disposizione"),
            destinazione=data.get("destinazione"),
            data_efficacia=data["data_efficacia"],
            data_pubblicazione_gu=data.get("data_pubblicazione_gu"),
            note=data.get("note"),
        )

    def is_article_level_abrogation(self, for_article: Optional[str] = None) -> bool:
        """
        Verifica se l'abrogazione riguarda l'intero articolo o solo un comma/lettera.
        """
        if self.tipo_modifica != TipoModifica.ABROGA:
            return False

        if not self.destinazione:
            return True

        dest_lower = self.destinazione.lower()

        if 'comma' in dest_lower or 'lettera' in dest_lower or 'numero' in dest_lower:
            return False

        if for_article:
            art_match = re.search(r'art\.\s*(\d+(?:-\w+)?)', dest_lower)
            if art_match:
                dest_article = art_match.group(1)
                if dest_article != for_article.lower():
                    return False

        return True


@dataclass
class StoriaArticolo:
    """
    Storia completa delle modifiche di un articolo.
    """
    articolo_urn: str
    versione_originale: str
    versione_vigente: Optional[str] = None
    modifiche: List[Modifica] = field(default_factory=list)
    is_abrogato: bool = False

    def get_versione_a_data(self, data: str) -> Optional[str]:
        """Ritorna la versione vigente a una data specifica."""
        sorted_mods = sorted(self.modifiche, key=lambda m: m.data_efficacia)

        versione = self.versione_originale
        for mod in sorted_mods:
            if mod.data_efficacia <= data:
                versione = mod.data_efficacia
            else:
                break

        return versione if versione <= data else None

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            "articolo_urn": self.articolo_urn,
            "versione_originale": self.versione_originale,
            "versione_vigente": self.versione_vigente,
            "modifiche": [m.to_dict() for m in self.modifiche],
            "is_abrogato": self.is_abrogato,
        }


@dataclass
class Norma:
    """
    Rappresenta una norma giuridica italiana.

    Questa versione è progettata per deserializzare i dati JSON
    ricevuti da visualex-api, senza dipendenze esterne.
    """
    tipo_atto: str
    data: Optional[str] = None
    numero_atto: Optional[str] = None
    tipo_atto_reale: Optional[str] = None
    url: Optional[str] = None

    # Computed fields (set from API response)
    tipo_atto_str: Optional[str] = None
    tipo_atto_urn: Optional[str] = None

    def __post_init__(self):
        if not self.tipo_atto or not isinstance(self.tipo_atto, str):
            raise ValueError("tipo_atto must be a non-empty string")

        if self.data:
            if not re.match(r'^\d{4}(-\d{2}-\d{2})?$', self.data):
                raise ValueError(f"Invalid date format: {self.data}")

        # Use tipo_atto as default if not set from API
        if not self.tipo_atto_str:
            self.tipo_atto_str = self.tipo_atto

    def __str__(self):
        parts = [self.tipo_atto_str or self.tipo_atto]
        if self.data:
            parts.append(f"{self.data},")
        if self.numero_atto:
            parts.append(f"n. {self.numero_atto}")
        return " ".join(parts)

    def to_dict(self) -> dict:
        result = {
            'tipo_atto': self.tipo_atto_str or self.tipo_atto,
            'data': self.data,
            'numero_atto': self.numero_atto,
            'url': self.url,
        }
        if self.tipo_atto_reale:
            result['tipo_atto_reale'] = self.tipo_atto_reale
        return result

    @staticmethod
    def from_dict(data: dict) -> "Norma":
        """Create Norma from API response dictionary."""
        return Norma(
            tipo_atto=data.get('tipo_atto', ''),
            data=data.get('data'),
            numero_atto=data.get('numero_atto'),
            tipo_atto_reale=data.get('tipo_atto_reale'),
            url=data.get('url'),
            tipo_atto_str=data.get('tipo_atto'),
        )


@dataclass(eq=False)
class NormaVisitata:
    """
    Rappresenta una specifica visita a un articolo di una norma.

    Include informazioni sulla versione e allegato specifici.
    """
    norma: Norma
    allegato: Optional[str] = None
    numero_articolo: Optional[str] = None
    versione: Optional[str] = None
    data_versione: Optional[str] = None
    urn: Optional[str] = None

    def __hash__(self):
        return hash((
            self.norma.tipo_atto,
            self.norma.data,
            self.norma.numero_atto,
            self.numero_articolo,
            self.versione,
            self.data_versione
        ))

    def __eq__(self, other):
        if not isinstance(other, NormaVisitata):
            return NotImplemented
        return (
            self.norma.tipo_atto == other.norma.tipo_atto and
            self.norma.data == other.norma.data and
            self.norma.numero_atto == other.norma.numero_atto and
            self.numero_articolo == other.numero_articolo and
            self.versione == other.versione and
            self.data_versione == other.data_versione and
            self.allegato == other.allegato
        )

    def __str__(self):
        base_str = str(self.norma)
        if self.numero_articolo:
            base_str += f" art. {self.numero_articolo}"
        return base_str

    def to_dict(self) -> dict:
        base_dict = self.norma.to_dict()
        base_dict.update({
            'allegato': self.allegato,
            'numero_articolo': self.numero_articolo,
            'versione': self.versione,
            'data_versione': self.data_versione,
            'urn': self.urn,
        })
        return base_dict

    @staticmethod
    def from_dict(data: dict) -> "NormaVisitata":
        """Create NormaVisitata from API response dictionary."""
        norma = Norma.from_dict(data)
        return NormaVisitata(
            norma=norma,
            numero_articolo=data.get('numero_articolo'),
            versione=data.get('versione'),
            data_versione=data.get('data_versione'),
            allegato=data.get('allegato'),
            urn=data.get('urn'),
        )
