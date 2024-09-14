from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
import logging

# Assuming these functions are defined elsewhere in your code
from tools.urngenerator import generate_urn
from tools.text_op import normalize_act_type
from tools.treextractor import get_tree
from tools.config import MAX_CACHE_SIZE

@dataclass
class Norma:
    tipo_atto: str
    data: str = None
    numero_atto: str = None
    _url: str = None
    _tree: any = field(default=None, repr=False)

    def __post_init__(self):
        logging.debug(f"Initializing Norma with tipo_atto: {self.tipo_atto}, data: {self.data}, numero_atto: {self.numero_atto}")
        self.tipo_atto_str = normalize_act_type(self.tipo_atto, search=True)
        self.tipo_atto_urn = normalize_act_type(self.tipo_atto)
        logging.debug(f"Norma initialized: {self}")

    @property
    def url(self):
        if not self._url:
            logging.debug("Generating URL for Norma.")
            self._url = generate_urn(
                act_type=self.tipo_atto_urn,
                date=self.data,
                act_number=self.numero_atto,
                urn_flag=False
            )
        return self._url

    @property
    @lru_cache(maxsize=MAX_CACHE_SIZE)
    def tree(self):
        if not self._tree:
            logging.debug("Fetching tree structure for Norma.")
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
                self.data_versione == other.data_versione)

    def __post_init__(self):
        logging.debug(f"NormaVisitata initialized: {self}")

    @property
    @lru_cache(maxsize=MAX_CACHE_SIZE)
    def urn(self):
        if not self._urn:
            logging.debug("Generating URN for NormaVisitata.")
            self._urn = generate_urn(
                act_type=self.norma.tipo_atto_urn,
                date=self.norma.data,
                act_number=self.norma.numero_atto,
                article=self.numero_articolo,
                version=self.versione,
                version_date=self.data_versione
            )
        return self._urn

    def __str__(self):
        base_str = str(self.norma)
        if self.numero_articolo:
            base_str += f" art. {self.numero_articolo}"
        return base_str

    def to_dict(self):
        base_dict = self.norma.to_dict()
        base_dict.update({
            'numero_articolo': self.numero_articolo,
            'versione': self.versione,
            'data_versione': self.data_versione,
            #'timestamp': self.timestamp,
            'urn': self.urn,
        })
        return base_dict

    @staticmethod
    def from_dict(data):
        logging.debug(f"Creating NormaVisitata from dict: {data}")
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
            #timestamp=data.get('timestamp')
        )
        logging.debug(f"NormaVisitata created: {norma_visitata}")
        return norma_visitata
