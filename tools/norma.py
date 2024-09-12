from tools.urngenerator import generate_urn
from tools.text_op import normalize_act_type
from datetime import datetime
from functools import lru_cache
from .map import EURLEX
from .config import MAX_CACHE_SIZE
from tools.treextractor import get_tree
import logging

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

class Norma:
    def __init__(self, tipo_atto, data=None, numero_atto=None, url=None, tree=None):
        logging.debug(f"Initializing Norma with tipo_atto: {tipo_atto}, data: {data}, numero_atto: {numero_atto}, url: {url}")
        
        self.tipo_atto_str = normalize_act_type(tipo_atto, search=True)
        self.tipo_atto_urn = normalize_act_type(tipo_atto)
        self.data = data
        self.numero_atto = numero_atto
        self._url = url
        self._tree = tree
        
        logging.debug(f"Norma initialized: {self}")

    @property
    def url(self):
        """Lazily generate the URL if not provided."""
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
        """Lazily retrieve or generate the tree structure."""
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
        """Converts the Norma object to a dictionary."""
        return {
            'tipo_atto': self.tipo_atto_str,
            'data': self.data,
            'numero_atto': self.numero_atto,
            'url': self.url,
        }

class NormaVisitata(Norma):
    def __init__(self, norma, numero_articolo=None, versione=None, data_versione=None, urn=None, timestamp=None):
        self.numero_articolo = numero_articolo
        self.versione = versione
        self.data_versione = data_versione
        self._urn = urn
        self.timestamp = timestamp or datetime.now().isoformat()
        
        # Initialize the base class
        super().__init__(
            tipo_atto=norma.tipo_atto_str,
            data=norma.data,
            numero_atto=norma.numero_atto,
        )

        logging.debug(f"NormaVisitata initialized: {self}")

    @property
    @lru_cache(maxsize=MAX_CACHE_SIZE)
    def urn(self):
        """Lazily generate the URN if not provided."""
        if not self._urn:
            logging.debug("Generating URN for NormaVisitata.")
            self._urn = generate_urn(
                act_type=self.tipo_atto_urn,
                date=self.data,
                act_number=self.numero_atto,
                article=self.numero_articolo,
                version=self.versione,
                version_date=self.data_versione
            )
        return self._urn

    def __str__(self):
        base_str = super().__str__()
        if self.numero_articolo:
            base_str += f" art. {self.numero_articolo}"
        return base_str
    
    @lru_cache(maxsize=MAX_CACHE_SIZE)
    def to_dict(self):
        """Converts the NormaVisitata object to a dictionary."""
        base_dict = super().to_dict()
        base_dict.update({
            'numero_articolo': self.numero_articolo,
            'versione': self.versione,
            'data_versione': self.data_versione,
            'timestamp': self.timestamp,
            'urn': self.urn,
        })
        return base_dict

    def get_url(self):
        """Returns the URL of the NormaVisitata object."""
        return self.url

    @staticmethod
    def from_dict(data):
        """Creates a NormaVisitata object from a dictionary."""
        logging.debug(f"Creating NormaVisitata from dict: {data}")
        
        norma = Norma(
            tipo_atto=data['tipo_atto'],
            data=data.get('data'),
            numero_atto=data.get('numero_atto'),
            url=data.get('url'),
            tree=data.get('tree')
        )
        norma_visitata = NormaVisitata(
            norma=norma,
            numero_articolo=data.get('numero_articolo'),
            versione=data.get('versione'),
            data_versione=data.get('data_versione'),
            timestamp=data.get('timestamp')
        )
        
        logging.debug(f"NormaVisitata created: {norma_visitata}")
        return norma_visitata
