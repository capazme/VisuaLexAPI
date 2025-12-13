from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from functools import lru_cache
from typing import Optional, List
import structlog

# Imports from utils
from merlt.sources.utils.urn import generate_urn
from merlt.sources.utils.text import normalize_act_type
from merlt.sources.utils.tree import get_tree

# Config
MAX_CACHE_SIZE = 1000

log = structlog.get_logger()


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
        return mapping.get(s_lower, cls.MODIFICA)  # Default to MODIFICA


@dataclass
class Modifica:
    """
    Rappresenta una singola modifica normativa.

    Esempio:
        Art. 2 della L. 241/1990 è stato modificato dalla
        L. 15 maggio 1997, n. 127, art. 17, comma 2

        Modifica(
            tipo_modifica=TipoModifica.MODIFICA,
            atto_modificante_urn="urn:nir:stato:legge:1997-05-15;127",
            atto_modificante_estremi="L. 15 maggio 1997, n. 127",
            disposizione="art. 17, comma 2",
            data_efficacia="1997-05-17",
            data_pubblicazione_gu="1997-05-17"
        )

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
    destinazione: Optional[str] = None  # es. "art. 2, comma 1" - cosa viene modificato
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

        Args:
            for_article: Numero articolo specifico (es. "2", "2-bis"). Se fornito,
                        verifica che l'abrogazione sia per esattamente questo articolo.

        Returns:
            True se abroga l'intero articolo, False se abroga solo una parte
        """
        import re

        if self.tipo_modifica != TipoModifica.ABROGA:
            return False

        # Se non c'è destinazione, assumiamo articolo intero
        if not self.destinazione:
            return True

        dest_lower = self.destinazione.lower()

        # Se contiene "comma" o "lettera", è una abrogazione parziale
        if 'comma' in dest_lower or 'lettera' in dest_lower or 'numero' in dest_lower:
            return False

        # Se è specificato un articolo, verifica che la destinazione sia esattamente quell'articolo
        if for_article:
            # Estrai numero articolo dalla destinazione (es. "art. 2-bis" -> "2-bis")
            art_match = re.search(r'art\.\s*(\d+(?:-\w+)?)', dest_lower)
            if art_match:
                dest_article = art_match.group(1)
                # Confronta articoli normalizzati
                if dest_article != for_article.lower():
                    return False

        return True


@dataclass
class StoriaArticolo:
    """
    Storia completa delle modifiche di un articolo.

    Contiene tutte le versioni temporali di un articolo,
    dalla versione originale a quella vigente.

    Attributes:
        articolo_urn: URN dell'articolo (senza versione)
        versione_originale: Data della versione originale (GU)
        versione_vigente: Data dell'ultima versione vigente
        modifiche: Lista cronologica delle modifiche
        is_abrogato: True se l'articolo è stato abrogato
    """
    articolo_urn: str
    versione_originale: str
    versione_vigente: Optional[str] = None
    modifiche: List[Modifica] = field(default_factory=list)
    is_abrogato: bool = False

    def get_versione_a_data(self, data: str) -> Optional[str]:
        """
        Ritorna la versione vigente a una data specifica.

        Args:
            data: Data in formato YYYY-MM-DD

        Returns:
            Data versione vigente, o None se articolo non esisteva
        """
        # Ordina modifiche per data_efficacia
        sorted_mods = sorted(
            self.modifiche,
            key=lambda m: m.data_efficacia
        )

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
    tipo_atto: str
    data: str = None
    numero_atto: str = None
    _url: str = None
    _tree: any = field(default=None, repr=False)

    def __post_init__(self):
        log.debug(f"Initializing Norma with tipo_atto: {self.tipo_atto}, data: {self.data}, numero_atto: {self.numero_atto}")
        self.tipo_atto_str = normalize_act_type(self.tipo_atto, search=True)
        self.tipo_atto_urn = normalize_act_type(self.tipo_atto)
        log.debug(f"Norma initialized: {self}")

    @property

    def url(self):
        if not self._url:
            log.debug("Generating URL for Norma.")
            generated_urn = generate_urn(
                act_type=self.tipo_atto_urn,
                date=self.data,
                act_number=self.numero_atto,
                urn_flag=False
            )
            if generated_urn is None:
                log.error(f"Failed to generate URN for {self.tipo_atto_urn} {self.data} {self.numero_atto}")
                raise ValueError(f"Cannot generate URL for legal norm: {self}")
            self._url = generated_urn
        return self._url

    @property
     
    def tree(self):
        if not self._tree:
            log.debug("Fetching tree structure for Norma.")
            self._tree = get_tree(self.url)
        return self._tree

    def __str__(self):
        parts = [self.tipo_atto_str]
        if self.data:
            parts.append(f"{self.data},")
        if self.numero_atto:
            parts.append(f"n. {self.numero_atto}")
        return " ".join(parts)

    def to_dict(self):
        return {
            'tipo_atto': self.tipo_atto_str,
            'data': self.data,
            'numero_atto': self.numero_atto,
            'url': self.url,
        }

@dataclass(eq=False)
class NormaVisitata:
    norma: Norma
    allegato: str = None
    numero_articolo: str = None
    versione: str = None
    data_versione: str = None
    _urn: str = field(default=None, repr=False)
    #timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def __hash__(self):
        return hash((self.norma.tipo_atto_urn, self.norma.data, self.norma.numero_atto, self.numero_articolo, self.versione, self.data_versione))

    def __eq__(self, other):
        if not isinstance(other, NormaVisitata):
            return NotImplemented
        return (self.norma.tipo_atto_urn == other.norma.tipo_atto_urn and
                self.norma.data == other.norma.data and
                self.norma.numero_atto == other.norma.numero_atto and
                self.numero_articolo == other.numero_articolo and
                self.versione == other.versione and
                self.data_versione == other.data_versione and self.allegato == other.allegato)

    def __post_init__(self):
        log.debug(f"NormaVisitata initialized: {self}")

    @property

    def urn(self):
        if not self._urn:
            log.debug("Generating URN for NormaVisitata.")
            generated_urn = generate_urn(
                act_type=self.norma.tipo_atto_urn,
                date=self.norma.data,
                act_number=self.norma.numero_atto,
                annex = self.allegato,
                article=self.numero_articolo,
                version=self.versione,
                version_date=self.data_versione
            )
            if generated_urn is None:
                log.error(f"Failed to generate URN for {self.norma}")
                raise ValueError(f"Cannot generate URN for visited norm: {self}")
            self._urn = generated_urn
        return self._urn

    def __str__(self):
        base_str = str(self.norma)
        if self.numero_articolo:
            base_str += f" art. {self.numero_articolo}"
        return base_str

    def to_dict(self):
        base_dict = self.norma.to_dict()
        base_dict.update({
            'allegato': self.allegato,
            'numero_articolo': self.numero_articolo,
            'versione': self.versione,
            'data_versione': self.data_versione,
            #'timestamp': self.timestamp,
            'urn': self.urn,
        })
        return base_dict

    @staticmethod
    def from_dict(data):
        log.debug(f"Creating NormaVisitata from dict: {data}")
        norma = Norma(
            tipo_atto=data['tipo_atto'],
            data=data.get('data'),
            numero_atto=data.get('numero_atto'),
            _url=data.get('url'),
            _tree=data.get('tree')
        )
        norma_visitata = NormaVisitata(
            norma=norma,
            numero_articolo=data.get('numero_articolo'),
            versione=data.get('versione'),
            data_versione=data.get('data_versione'),
            allegato = data.get('allegato')
            #timestamp=data.get('timestamp')
        )
        log.debug(f"NormaVisitata created: {norma_visitata}")
        return norma_visitata

codice_civile = Norma(tipo_atto='codice civile')
print(codice_civile.to_dict())