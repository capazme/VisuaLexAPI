"""
Gold Standard Management per RAG Benchmark
===========================================

Gestisce il caricamento, validazione e manipolazione di dataset
di query annotate per benchmark di retrieval.

Uso:
    >>> from merlt.benchmark.gold_standard import GoldStandard, Query
    >>>
    >>> gs = GoldStandard.from_file("gold_standard.json")
    >>> print(f"Loaded {len(gs)} queries")
    >>>
    >>> for query in gs.queries:
    ...     print(f"{query.id}: {query.text} → {query.relevant_urns}")
"""

import json
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
from dataclasses import dataclass, field
from enum import Enum
import structlog

log = structlog.get_logger()


class QueryCategory(Enum):
    """Categorie di query per analisi disaggregata."""
    CONCETTUALE = "concettuale"       # "Cos'è l'obbligazione?"
    NORMATIVA = "normativa"           # "Art. 1453 codice civile"
    GIURISPRUDENZIALE = "giurisprudenziale"  # "Sentenza su risoluzione"
    PRATICA = "pratica"               # "Come risolvere un contratto?"
    # Categorie EXP-016 (semantic-only)
    DEFINIZIONE = "definizione"       # "Cos'è X?" - definizioni di istituti
    CONCETTO = "concetto"             # Principi e concetti giuridici
    ISTITUTO = "istituto"             # Istituti giuridici specifici


@dataclass
class Query:
    """
    Una query annotata con ground truth.

    Attributes:
        id: Identificatore univoco (es. "Q001")
        text: Testo della query in linguaggio naturale
        category: Categoria per analisi disaggregata
        expected_article: Articolo principale atteso (URN)
        relevant_urns: Lista di URN rilevanti (ground truth)
        relevance_scores: Dizionario URN → score (0-3) per valutazione graduata
        source: Provenienza annotazione ("manual", "expert", "synthetic")
        difficulty: Difficoltà stimata ("easy", "medium", "hard")
        metadata: Campi aggiuntivi flessibili

    Example:
        >>> q = Query(
        ...     id="Q001",
        ...     text="Cos'è l'obbligazione naturale?",
        ...     category=QueryCategory.CONCETTUALE,
        ...     expected_article="urn:nir:stato:regio.decreto:1942-03-16;262:2~art2034",
        ...     relevant_urns=["urn:...art2034", "urn:...art2035"],
        ...     relevance_scores={"urn:...art2034": 3, "urn:...art2035": 2}
        ... )
    """
    id: str
    text: str
    category: QueryCategory
    expected_article: str  # URN principale
    relevant_urns: List[str]  # Tutti gli URN rilevanti (backward compat)
    relevance_scores: Dict[str, int] = field(default_factory=dict)  # URN → score (0-3)
    source: str = "manual"
    difficulty: str = "medium"
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def relevant_set(self) -> Set[str]:
        """Set di URN rilevanti per lookup O(1)."""
        return set(self.relevant_urns)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario JSON-compatibile."""
        return {
            "id": self.id,
            "text": self.text,
            "category": self.category.value,
            "expected_article": self.expected_article,
            "relevant_urns": self.relevant_urns,
            "relevance_scores": self.relevance_scores,
            "source": self.source,
            "difficulty": self.difficulty,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Query":
        """Deserializza da dizionario."""
        return cls(
            id=data["id"],
            text=data["text"],
            category=QueryCategory(data.get("category", "concettuale")),
            expected_article=data.get("expected_article", ""),
            relevant_urns=data.get("relevant_urns", []),
            relevance_scores=data.get("relevance_scores", {}),
            source=data.get("source", "manual"),
            difficulty=data.get("difficulty", "medium"),
            metadata=data.get("metadata", {}),
        )


@dataclass
class GoldStandard:
    """
    Dataset di query annotate per benchmark.

    Attributes:
        queries: Lista di query annotate
        metadata: Metadati del dataset (versione, autore, data)

    Example:
        >>> gs = GoldStandard.from_file("gold_standard.json")
        >>> conceptual = gs.filter_by_category(QueryCategory.CONCETTUALE)
        >>> print(f"{len(conceptual)} query concettuali")
    """
    queries: List[Query]
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.queries)

    def __iter__(self):
        return iter(self.queries)

    def __getitem__(self, idx) -> Query:
        return self.queries[idx]

    @property
    def categories(self) -> List[str]:
        """Lista di categorie per tutte le query."""
        return [q.category.value for q in self.queries]

    @property
    def all_relevant_urns(self) -> List[List[str]]:
        """Lista di ground truth per ogni query."""
        return [q.relevant_urns for q in self.queries]

    def filter_by_category(self, category: QueryCategory) -> "GoldStandard":
        """
        Filtra query per categoria.

        Args:
            category: Categoria da filtrare

        Returns:
            Nuovo GoldStandard con solo le query della categoria
        """
        filtered = [q for q in self.queries if q.category == category]
        return GoldStandard(queries=filtered, metadata=self.metadata)

    def filter_by_difficulty(self, difficulty: str) -> "GoldStandard":
        """Filtra query per difficoltà (easy, medium, hard)."""
        filtered = [q for q in self.queries if q.difficulty == difficulty]
        return GoldStandard(queries=filtered, metadata=self.metadata)

    def get_statistics(self) -> Dict[str, Any]:
        """
        Calcola statistiche sul dataset.

        Returns:
            Dizionario con statistiche aggregate
        """
        stats = {
            "total_queries": len(self.queries),
            "by_category": {},
            "by_difficulty": {},
            "avg_relevant_per_query": 0,
            "unique_relevant_urns": 0,
        }

        # Per categoria
        for cat in QueryCategory:
            count = len([q for q in self.queries if q.category == cat])
            stats["by_category"][cat.value] = count

        # Per difficoltà
        for diff in ["easy", "medium", "hard"]:
            count = len([q for q in self.queries if q.difficulty == diff])
            stats["by_difficulty"][diff] = count

        # Media rilevanti per query
        if self.queries:
            stats["avg_relevant_per_query"] = sum(
                len(q.relevant_urns) for q in self.queries
            ) / len(self.queries)

        # URN unici
        all_urns = set()
        for q in self.queries:
            all_urns.update(q.relevant_urns)
        stats["unique_relevant_urns"] = len(all_urns)

        return stats

    def validate(self) -> List[str]:
        """
        Valida il dataset per errori comuni.

        Returns:
            Lista di warning/errori trovati
        """
        errors = []

        # Check ID duplicati
        ids = [q.id for q in self.queries]
        if len(ids) != len(set(ids)):
            errors.append("Duplicate query IDs found")

        # Check query senza relevant
        for q in self.queries:
            if not q.relevant_urns:
                errors.append(f"Query {q.id} has no relevant URNs")
            if not q.expected_article:
                errors.append(f"Query {q.id} has no expected article")
            if not q.text.strip():
                errors.append(f"Query {q.id} has empty text")

        return errors

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario JSON-compatibile."""
        return {
            "metadata": self.metadata,
            "queries": [q.to_dict() for q in self.queries],
        }

    def to_file(self, path: str) -> None:
        """
        Salva su file JSON.

        Args:
            path: Percorso file di output
        """
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)

        log.info(f"Gold standard saved to {path}", num_queries=len(self.queries))

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GoldStandard":
        """Deserializza da dizionario."""
        queries = [Query.from_dict(q) for q in data.get("queries", [])]
        metadata = data.get("metadata", {})
        return cls(queries=queries, metadata=metadata)

    @classmethod
    def from_file(cls, path: str) -> "GoldStandard":
        """
        Carica da file JSON.

        Args:
            path: Percorso file JSON

        Returns:
            GoldStandard caricato

        Raises:
            FileNotFoundError: Se il file non esiste
            json.JSONDecodeError: Se il JSON non è valido
        """
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        gs = cls.from_dict(data)
        log.info(f"Gold standard loaded from {path}", num_queries=len(gs))

        return gs

    @classmethod
    def create_empty(
        cls,
        name: str = "MERL-T RAG Benchmark",
        version: str = "1.0",
        author: str = "Unknown"
    ) -> "GoldStandard":
        """
        Crea un dataset vuoto con metadati base.

        Args:
            name: Nome del dataset
            version: Versione
            author: Autore

        Returns:
            GoldStandard vuoto
        """
        return cls(
            queries=[],
            metadata={
                "name": name,
                "version": version,
                "author": author,
                "created_at": None,  # Sarà impostato al salvataggio
                "description": "Gold standard per RAG benchmark",
            }
        )

    def add_query(
        self,
        text: str,
        category: QueryCategory,
        expected_article: str,
        relevant_urns: List[str] = None,
        difficulty: str = "medium",
        **metadata
    ) -> Query:
        """
        Aggiunge una nuova query al dataset.

        Args:
            text: Testo della query
            category: Categoria
            expected_article: URN articolo principale
            relevant_urns: URN rilevanti (default: [expected_article])
            difficulty: Difficoltà (easy, medium, hard)
            **metadata: Campi aggiuntivi

        Returns:
            Query creata
        """
        if relevant_urns is None:
            relevant_urns = [expected_article] if expected_article else []

        query_id = f"Q{len(self.queries) + 1:03d}"

        query = Query(
            id=query_id,
            text=text,
            category=category,
            expected_article=expected_article,
            relevant_urns=relevant_urns,
            difficulty=difficulty,
            metadata=metadata,
        )

        self.queries.append(query)
        return query


def create_libro_iv_gold_standard() -> GoldStandard:
    """
    Crea un gold standard di esempio per il Libro IV del Codice Civile.

    Contiene 50 query distribuite per categoria e difficoltà.

    Returns:
        GoldStandard con query di esempio
    """
    gs = GoldStandard.create_empty(
        name="MERL-T Libro IV RAG Benchmark",
        version="1.0",
        author="EXP-015"
    )

    # Base URN per Codice Civile (formato completo come nel database)
    CC_BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~"

    # =========================================================================
    # QUERY CONCETTUALI (15)
    # =========================================================================

    gs.add_query(
        text="Cos'è l'obbligazione naturale?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art2034",
        relevant_urns=[f"{CC_BASE}art2034", f"{CC_BASE}art2035"],
        difficulty="medium"
    )

    gs.add_query(
        text="Definizione di contratto",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1321",
        relevant_urns=[f"{CC_BASE}art1321", f"{CC_BASE}art1322", f"{CC_BASE}art1323"],
        difficulty="easy"
    )

    gs.add_query(
        text="Cosa sono le fonti delle obbligazioni?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1173",
        relevant_urns=[f"{CC_BASE}art1173"],
        difficulty="easy"
    )

    gs.add_query(
        text="Cos'è la risoluzione per inadempimento?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1453",
        relevant_urns=[f"{CC_BASE}art1453", f"{CC_BASE}art1454", f"{CC_BASE}art1455"],
        difficulty="medium"
    )

    gs.add_query(
        text="Definizione di locazione",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1571",
        relevant_urns=[f"{CC_BASE}art1571", f"{CC_BASE}art1572"],
        difficulty="easy"
    )

    gs.add_query(
        text="Cos'è l'adempimento dell'obbligazione?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1176",
        relevant_urns=[f"{CC_BASE}art1176", f"{CC_BASE}art1177", f"{CC_BASE}art1178"],
        difficulty="medium"
    )

    gs.add_query(
        text="Cosa si intende per mora del debitore?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1219",
        relevant_urns=[f"{CC_BASE}art1219", f"{CC_BASE}art1220", f"{CC_BASE}art1221"],
        difficulty="medium"
    )

    gs.add_query(
        text="Definizione di compravendita",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1470",
        relevant_urns=[f"{CC_BASE}art1470", f"{CC_BASE}art1471"],
        difficulty="easy"
    )

    gs.add_query(
        text="Cos'è il mandato?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1703",
        relevant_urns=[f"{CC_BASE}art1703", f"{CC_BASE}art1704"],
        difficulty="easy"
    )

    gs.add_query(
        text="Cosa sono i vizi della cosa venduta?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1490",
        relevant_urns=[f"{CC_BASE}art1490", f"{CC_BASE}art1491", f"{CC_BASE}art1492"],
        difficulty="medium"
    )

    gs.add_query(
        text="Cos'è la novazione?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1230",
        relevant_urns=[f"{CC_BASE}art1230", f"{CC_BASE}art1231", f"{CC_BASE}art1232"],
        difficulty="hard"
    )

    gs.add_query(
        text="Definizione di appalto",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1655",
        relevant_urns=[f"{CC_BASE}art1655", f"{CC_BASE}art1656"],
        difficulty="easy"
    )

    gs.add_query(
        text="Cos'è la fideiussione?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1936",
        relevant_urns=[f"{CC_BASE}art1936", f"{CC_BASE}art1937"],
        difficulty="medium"
    )

    gs.add_query(
        text="Cosa si intende per surrogazione?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art1201",
        relevant_urns=[f"{CC_BASE}art1201", f"{CC_BASE}art1202", f"{CC_BASE}art1203"],
        difficulty="hard"
    )

    gs.add_query(
        text="Cos'è l'arricchimento senza causa?",
        category=QueryCategory.CONCETTUALE,
        expected_article=f"{CC_BASE}art2041",
        relevant_urns=[f"{CC_BASE}art2041", f"{CC_BASE}art2042"],
        difficulty="medium"
    )

    # =========================================================================
    # QUERY NORMATIVE (15)
    # =========================================================================

    gs.add_query(
        text="Art. 1453 codice civile",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1453",
        relevant_urns=[f"{CC_BASE}art1453"],
        difficulty="easy"
    )

    gs.add_query(
        text="Articolo 1321 del codice civile",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1321",
        relevant_urns=[f"{CC_BASE}art1321"],
        difficulty="easy"
    )

    gs.add_query(
        text="Art. 2043 responsabilità extracontrattuale",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art2043",
        relevant_urns=[f"{CC_BASE}art2043", f"{CC_BASE}art2044"],
        difficulty="easy"
    )

    gs.add_query(
        text="Articolo 1218 cc inadempimento",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1218",
        relevant_urns=[f"{CC_BASE}art1218"],
        difficulty="easy"
    )

    gs.add_query(
        text="Art. 1372 efficacia del contratto",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1372",
        relevant_urns=[f"{CC_BASE}art1372", f"{CC_BASE}art1373"],
        difficulty="easy"
    )

    gs.add_query(
        text="Articoli sulla compravendita immobiliare",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1470",
        relevant_urns=[f"{CC_BASE}art1470", f"{CC_BASE}art1498", f"{CC_BASE}art1523"],
        difficulty="medium"
    )

    gs.add_query(
        text="Art. 1341 condizioni generali di contratto",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1341",
        relevant_urns=[f"{CC_BASE}art1341", f"{CC_BASE}art1342"],
        difficulty="easy"
    )

    gs.add_query(
        text="Articolo 1175 buona fede",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1175",
        relevant_urns=[f"{CC_BASE}art1175"],
        difficulty="easy"
    )

    gs.add_query(
        text="Art. 2059 danni non patrimoniali",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art2059",
        relevant_urns=[f"{CC_BASE}art2059"],
        difficulty="easy"
    )

    gs.add_query(
        text="Articolo sulla prelazione ereditaria",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art732",
        relevant_urns=[f"{CC_BASE}art732"],
        difficulty="hard"
    )

    gs.add_query(
        text="Art. 1284 interessi legali",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1284",
        relevant_urns=[f"{CC_BASE}art1284", f"{CC_BASE}art1285"],
        difficulty="easy"
    )

    gs.add_query(
        text="Articoli sul pegno",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art2784",
        relevant_urns=[f"{CC_BASE}art2784", f"{CC_BASE}art2785", f"{CC_BASE}art2786"],
        difficulty="medium"
    )

    gs.add_query(
        text="Art. 1469 bis clausole vessatorie",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1469bis",
        relevant_urns=[f"{CC_BASE}art1469bis"],
        difficulty="medium"
    )

    gs.add_query(
        text="Articolo 1901 assicurazione",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art1901",
        relevant_urns=[f"{CC_BASE}art1901", f"{CC_BASE}art1902"],
        difficulty="medium"
    )

    gs.add_query(
        text="Art. 2049 responsabilità dei padroni",
        category=QueryCategory.NORMATIVA,
        expected_article=f"{CC_BASE}art2049",
        relevant_urns=[f"{CC_BASE}art2049"],
        difficulty="easy"
    )

    # =========================================================================
    # QUERY GIURISPRUDENZIALI (10)
    # =========================================================================

    gs.add_query(
        text="Giurisprudenza sulla risoluzione del contratto",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art1453",
        relevant_urns=[f"{CC_BASE}art1453", f"{CC_BASE}art1454", f"{CC_BASE}art1455"],
        difficulty="medium"
    )

    gs.add_query(
        text="Sentenze sul danno biologico",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art2059",
        relevant_urns=[f"{CC_BASE}art2059", f"{CC_BASE}art2043"],
        difficulty="medium"
    )

    gs.add_query(
        text="Cassazione sulla buona fede contrattuale",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art1175",
        relevant_urns=[f"{CC_BASE}art1175", f"{CC_BASE}art1375"],
        difficulty="hard"
    )

    gs.add_query(
        text="Giurisprudenza sui vizi della cosa venduta",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art1490",
        relevant_urns=[f"{CC_BASE}art1490", f"{CC_BASE}art1491", f"{CC_BASE}art1492", f"{CC_BASE}art1495"],
        difficulty="medium"
    )

    gs.add_query(
        text="Sentenze sulla responsabilità del costruttore",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art1669",
        relevant_urns=[f"{CC_BASE}art1669", f"{CC_BASE}art2053"],
        difficulty="hard"
    )

    gs.add_query(
        text="Cassazione sul preliminare di vendita",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art1351",
        relevant_urns=[f"{CC_BASE}art1351", f"{CC_BASE}art2932"],
        difficulty="hard"
    )

    gs.add_query(
        text="Giurisprudenza sull'inadempimento contrattuale",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art1218",
        relevant_urns=[f"{CC_BASE}art1218", f"{CC_BASE}art1223", f"{CC_BASE}art1227"],
        difficulty="medium"
    )

    gs.add_query(
        text="Sentenze sulla mora del debitore",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art1219",
        relevant_urns=[f"{CC_BASE}art1219", f"{CC_BASE}art1220", f"{CC_BASE}art1224"],
        difficulty="medium"
    )

    gs.add_query(
        text="Cassazione sul danno da circolazione",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art2054",
        relevant_urns=[f"{CC_BASE}art2054"],
        difficulty="medium"
    )

    gs.add_query(
        text="Giurisprudenza sulla responsabilità medica",
        category=QueryCategory.GIURISPRUDENZIALE,
        expected_article=f"{CC_BASE}art2236",
        relevant_urns=[f"{CC_BASE}art2236", f"{CC_BASE}art1218", f"{CC_BASE}art2043"],
        difficulty="hard"
    )

    # =========================================================================
    # QUERY PRATICHE (10)
    # =========================================================================

    gs.add_query(
        text="Come risolvere un contratto per inadempimento?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art1453",
        relevant_urns=[f"{CC_BASE}art1453", f"{CC_BASE}art1454", f"{CC_BASE}art1455", f"{CC_BASE}art1456"],
        difficulty="medium"
    )

    gs.add_query(
        text="Come chiedere il risarcimento danni?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art2043",
        relevant_urns=[f"{CC_BASE}art2043", f"{CC_BASE}art2056", f"{CC_BASE}art2059"],
        difficulty="medium"
    )

    gs.add_query(
        text="Come contestare un prodotto difettoso?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art1490",
        relevant_urns=[f"{CC_BASE}art1490", f"{CC_BASE}art1492", f"{CC_BASE}art1495"],
        difficulty="medium"
    )

    gs.add_query(
        text="Come recedere da un contratto?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art1373",
        relevant_urns=[f"{CC_BASE}art1373", f"{CC_BASE}art1385", f"{CC_BASE}art1386"],
        difficulty="medium"
    )

    gs.add_query(
        text="Come costituire in mora il debitore?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art1219",
        relevant_urns=[f"{CC_BASE}art1219", f"{CC_BASE}art1220"],
        difficulty="medium"
    )

    gs.add_query(
        text="Come far valere la garanzia per vizi?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art1495",
        relevant_urns=[f"{CC_BASE}art1495", f"{CC_BASE}art1490", f"{CC_BASE}art1492"],
        difficulty="medium"
    )

    gs.add_query(
        text="Come calcolare il danno da ritardato pagamento?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art1224",
        relevant_urns=[f"{CC_BASE}art1224", f"{CC_BASE}art1284"],
        difficulty="hard"
    )

    gs.add_query(
        text="Come impugnare un contratto per errore?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art1428",
        relevant_urns=[f"{CC_BASE}art1428", f"{CC_BASE}art1429", f"{CC_BASE}art1431", f"{CC_BASE}art1433"],
        difficulty="hard"
    )

    gs.add_query(
        text="Come agire per esecuzione specifica?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art2932",
        relevant_urns=[f"{CC_BASE}art2932"],
        difficulty="hard"
    )

    gs.add_query(
        text="Come tutelare un credito con ipoteca?",
        category=QueryCategory.PRATICA,
        expected_article=f"{CC_BASE}art2808",
        relevant_urns=[f"{CC_BASE}art2808", f"{CC_BASE}art2809", f"{CC_BASE}art2810"],
        difficulty="hard"
    )

    return gs


def create_expanded_gold_standard() -> GoldStandard:
    """
    Crea un gold standard ESPANSO per validazione RLCF.

    Contiene 150+ query distribuite per categoria, coprendo:
    - Tutti i principali istituti del Libro IV
    - Query concettuali, normative, giurisprudenziali e pratiche
    - Diverse difficoltà (easy, medium, hard)

    Returns:
        GoldStandard con 150+ query per esperimenti RLCF
    """
    gs = GoldStandard.create_empty(
        name="MERL-T Expanded RAG Benchmark",
        version="2.0",
        author="EXP-021"
    )

    CC_BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~"

    # =========================================================================
    # SEZIONE 1: OBBLIGAZIONI IN GENERALE (art. 1173-1320) - 30 query
    # =========================================================================

    # Fonti delle obbligazioni
    gs.add_query("Cos'è l'obbligazione nel diritto civile?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1173", [f"{CC_BASE}art1173", f"{CC_BASE}art1174"], "easy")
    gs.add_query("Quali sono le fonti delle obbligazioni?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1173", [f"{CC_BASE}art1173"], "easy")
    gs.add_query("Art. 1173 codice civile fonti obbligazioni", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1173", [f"{CC_BASE}art1173"], "easy")

    # Adempimento
    gs.add_query("Cos'è l'adempimento dell'obbligazione?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1176", [f"{CC_BASE}art1176", f"{CC_BASE}art1177", f"{CC_BASE}art1178"], "easy")
    gs.add_query("Diligenza nell'adempimento delle obbligazioni", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1176", [f"{CC_BASE}art1176"], "medium")
    gs.add_query("Adempimento da parte del terzo", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1180", [f"{CC_BASE}art1180", f"{CC_BASE}art1181"], "medium")
    gs.add_query("Art. 1182 luogo dell'adempimento", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1182", [f"{CC_BASE}art1182"], "easy")
    gs.add_query("Art. 1183 tempo dell'adempimento", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1183", [f"{CC_BASE}art1183", f"{CC_BASE}art1184"], "easy")

    # Mora
    gs.add_query("Cosa si intende per mora del debitore?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1219", [f"{CC_BASE}art1219", f"{CC_BASE}art1220", f"{CC_BASE}art1221"], "medium")
    gs.add_query("Costituzione in mora del debitore", QueryCategory.PRATICA,
                 f"{CC_BASE}art1219", [f"{CC_BASE}art1219", f"{CC_BASE}art1220"], "medium")
    gs.add_query("Effetti della mora del debitore", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1221", [f"{CC_BASE}art1221", f"{CC_BASE}art1224"], "medium")
    gs.add_query("Art. 1219 costituzione in mora", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1219", [f"{CC_BASE}art1219"], "easy")
    gs.add_query("Mora del creditore art. 1206", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1206", [f"{CC_BASE}art1206", f"{CC_BASE}art1207"], "medium")

    # Inadempimento
    gs.add_query("Responsabilità del debitore per inadempimento", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1218", [f"{CC_BASE}art1218", f"{CC_BASE}art1223"], "medium")
    gs.add_query("Art. 1218 responsabilità del debitore", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1218", [f"{CC_BASE}art1218"], "easy")
    gs.add_query("Risarcimento del danno per inadempimento", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1223", [f"{CC_BASE}art1223", f"{CC_BASE}art1224", f"{CC_BASE}art1225"], "medium")
    gs.add_query("Concorso del fatto colposo del creditore", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1227", [f"{CC_BASE}art1227"], "hard")

    # Estinzione diverse dall'adempimento
    gs.add_query("Cos'è la novazione?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1230", [f"{CC_BASE}art1230", f"{CC_BASE}art1231", f"{CC_BASE}art1232"], "hard")
    gs.add_query("La remissione del debito", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1236", [f"{CC_BASE}art1236", f"{CC_BASE}art1237"], "medium")
    gs.add_query("La compensazione tra debiti", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1241", [f"{CC_BASE}art1241", f"{CC_BASE}art1242", f"{CC_BASE}art1243"], "hard")
    gs.add_query("La confusione nelle obbligazioni", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1253", [f"{CC_BASE}art1253", f"{CC_BASE}art1254"], "hard")
    gs.add_query("L'impossibilità sopravvenuta della prestazione", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1256", [f"{CC_BASE}art1256", f"{CC_BASE}art1257", f"{CC_BASE}art1258"], "hard")

    # Cessione del credito
    gs.add_query("La cessione del credito", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1260", [f"{CC_BASE}art1260", f"{CC_BASE}art1261", f"{CC_BASE}art1262"], "medium")
    gs.add_query("Art. 1260 cedibilità dei crediti", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1260", [f"{CC_BASE}art1260"], "easy")

    # Surrogazione
    gs.add_query("Cosa si intende per surrogazione?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1201", [f"{CC_BASE}art1201", f"{CC_BASE}art1202", f"{CC_BASE}art1203"], "hard")

    # Obbligazioni solidali
    gs.add_query("Obbligazioni solidali passive", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1292", [f"{CC_BASE}art1292", f"{CC_BASE}art1293", f"{CC_BASE}art1294"], "hard")
    gs.add_query("Art. 1292 obbligazioni in solido", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1292", [f"{CC_BASE}art1292"], "easy")
    gs.add_query("Regresso tra condebitori solidali", QueryCategory.PRATICA,
                 f"{CC_BASE}art1298", [f"{CC_BASE}art1298", f"{CC_BASE}art1299"], "hard")

    # Obbligazioni divisibili e indivisibili
    gs.add_query("Obbligazioni indivisibili", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1316", [f"{CC_BASE}art1316", f"{CC_BASE}art1317"], "hard")

    # =========================================================================
    # SEZIONE 2: CONTRATTI IN GENERALE (art. 1321-1469) - 40 query
    # =========================================================================

    # Definizione e requisiti
    gs.add_query("Definizione di contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1321", [f"{CC_BASE}art1321", f"{CC_BASE}art1322", f"{CC_BASE}art1323"], "easy")
    gs.add_query("Art. 1321 nozione di contratto", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1321", [f"{CC_BASE}art1321"], "easy")
    gs.add_query("I requisiti del contratto art. 1325", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1325", [f"{CC_BASE}art1325"], "easy")
    gs.add_query("L'accordo delle parti nel contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1326", [f"{CC_BASE}art1326", f"{CC_BASE}art1327", f"{CC_BASE}art1328"], "medium")
    gs.add_query("La causa del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1343", [f"{CC_BASE}art1343", f"{CC_BASE}art1344", f"{CC_BASE}art1345"], "medium")
    gs.add_query("L'oggetto del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1346", [f"{CC_BASE}art1346", f"{CC_BASE}art1347", f"{CC_BASE}art1348"], "medium")
    gs.add_query("La forma del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1350", [f"{CC_BASE}art1350", f"{CC_BASE}art1351", f"{CC_BASE}art1352"], "medium")

    # Trattative e buona fede
    gs.add_query("La buona fede nelle trattative", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1337", [f"{CC_BASE}art1337", f"{CC_BASE}art1338"], "medium")
    gs.add_query("Art. 1337 trattative e responsabilità precontrattuale", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1337", [f"{CC_BASE}art1337"], "easy")
    gs.add_query("Responsabilità precontrattuale", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art1337", [f"{CC_BASE}art1337", f"{CC_BASE}art1338"], "hard")

    # Condizioni generali
    gs.add_query("Condizioni generali di contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1341", [f"{CC_BASE}art1341", f"{CC_BASE}art1342"], "medium")
    gs.add_query("Art. 1341 clausole vessatorie", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1341", [f"{CC_BASE}art1341"], "easy")
    gs.add_query("Clausole vessatorie nel contratto", QueryCategory.PRATICA,
                 f"{CC_BASE}art1341", [f"{CC_BASE}art1341", f"{CC_BASE}art1469bis"], "medium")

    # Contratto preliminare
    gs.add_query("Il contratto preliminare", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1351", [f"{CC_BASE}art1351", f"{CC_BASE}art2932"], "medium")
    gs.add_query("Esecuzione in forma specifica del preliminare", QueryCategory.PRATICA,
                 f"{CC_BASE}art2932", [f"{CC_BASE}art2932", f"{CC_BASE}art1351"], "hard")

    # Interpretazione
    gs.add_query("Interpretazione del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1362", [f"{CC_BASE}art1362", f"{CC_BASE}art1363", f"{CC_BASE}art1366"], "medium")
    gs.add_query("Art. 1362 interpretazione secondo buona fede", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1366", [f"{CC_BASE}art1366"], "easy")

    # Effetti
    gs.add_query("Efficacia del contratto tra le parti", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1372", [f"{CC_BASE}art1372", f"{CC_BASE}art1373"], "medium")
    gs.add_query("Art. 1372 forza di legge del contratto", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1372", [f"{CC_BASE}art1372"], "easy")
    gs.add_query("Il recesso dal contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1373", [f"{CC_BASE}art1373", f"{CC_BASE}art1385"], "medium")
    gs.add_query("Contratto a favore di terzi", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1411", [f"{CC_BASE}art1411", f"{CC_BASE}art1412", f"{CC_BASE}art1413"], "medium")
    gs.add_query("La clausola penale", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1382", [f"{CC_BASE}art1382", f"{CC_BASE}art1383", f"{CC_BASE}art1384"], "medium")
    gs.add_query("La caparra confirmatoria", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1385", [f"{CC_BASE}art1385", f"{CC_BASE}art1386"], "medium")

    # Nullità
    gs.add_query("Cause di nullità del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1418", [f"{CC_BASE}art1418", f"{CC_BASE}art1419", f"{CC_BASE}art1421"], "medium")
    gs.add_query("Art. 1418 nullità del contratto", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1418", [f"{CC_BASE}art1418"], "easy")
    gs.add_query("Nullità parziale del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1419", [f"{CC_BASE}art1419", f"{CC_BASE}art1420"], "medium")

    # Annullabilità
    gs.add_query("Annullabilità del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1425", [f"{CC_BASE}art1425", f"{CC_BASE}art1427"], "medium")
    gs.add_query("L'errore come vizio del consenso", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1428", [f"{CC_BASE}art1428", f"{CC_BASE}art1429", f"{CC_BASE}art1431"], "hard")
    gs.add_query("La violenza come vizio del consenso", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1434", [f"{CC_BASE}art1434", f"{CC_BASE}art1435", f"{CC_BASE}art1436"], "hard")
    gs.add_query("Il dolo nel contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1439", [f"{CC_BASE}art1439", f"{CC_BASE}art1440"], "hard")

    # Rescissione
    gs.add_query("La rescissione del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1447", [f"{CC_BASE}art1447", f"{CC_BASE}art1448", f"{CC_BASE}art1449"], "hard")

    # Risoluzione
    gs.add_query("La risoluzione per inadempimento", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1453", [f"{CC_BASE}art1453", f"{CC_BASE}art1454", f"{CC_BASE}art1455"], "medium")
    gs.add_query("Art. 1453 risoluzione del contratto", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1453", [f"{CC_BASE}art1453"], "easy")
    gs.add_query("Diffida ad adempiere", QueryCategory.PRATICA,
                 f"{CC_BASE}art1454", [f"{CC_BASE}art1454"], "medium")
    gs.add_query("Clausola risolutiva espressa", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1456", [f"{CC_BASE}art1456"], "medium")
    gs.add_query("Risoluzione per impossibilità sopravvenuta", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1463", [f"{CC_BASE}art1463", f"{CC_BASE}art1464", f"{CC_BASE}art1465"], "hard")
    gs.add_query("Risoluzione per eccessiva onerosità", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1467", [f"{CC_BASE}art1467", f"{CC_BASE}art1468", f"{CC_BASE}art1469"], "hard")

    # =========================================================================
    # SEZIONE 3: SINGOLI CONTRATTI (art. 1470-2059) - 50 query
    # =========================================================================

    # Compravendita
    gs.add_query("Definizione di compravendita", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1470", [f"{CC_BASE}art1470", f"{CC_BASE}art1471"], "easy")
    gs.add_query("Art. 1470 nozione di vendita", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1470", [f"{CC_BASE}art1470"], "easy")
    gs.add_query("Obbligazioni del venditore", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1476", [f"{CC_BASE}art1476", f"{CC_BASE}art1477"], "medium")
    gs.add_query("Garanzia per i vizi della cosa venduta", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1490", [f"{CC_BASE}art1490", f"{CC_BASE}art1491", f"{CC_BASE}art1492"], "medium")
    gs.add_query("Art. 1490 vizi della cosa venduta", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1490", [f"{CC_BASE}art1490"], "easy")
    gs.add_query("Termini per la denuncia dei vizi", QueryCategory.PRATICA,
                 f"{CC_BASE}art1495", [f"{CC_BASE}art1495"], "medium")
    gs.add_query("Vendita con riserva di proprietà", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1523", [f"{CC_BASE}art1523", f"{CC_BASE}art1524", f"{CC_BASE}art1525"], "hard")

    # Locazione
    gs.add_query("Definizione di locazione", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1571", [f"{CC_BASE}art1571", f"{CC_BASE}art1572"], "easy")
    gs.add_query("Art. 1571 nozione di locazione", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1571", [f"{CC_BASE}art1571"], "easy")
    gs.add_query("Obbligazioni del locatore", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1575", [f"{CC_BASE}art1575", f"{CC_BASE}art1576", f"{CC_BASE}art1577"], "medium")
    gs.add_query("Obbligazioni del conduttore", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1587", [f"{CC_BASE}art1587", f"{CC_BASE}art1588", f"{CC_BASE}art1590"], "medium")
    gs.add_query("Sublocazione e cessione del contratto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1594", [f"{CC_BASE}art1594", f"{CC_BASE}art1595"], "medium")

    # Appalto
    gs.add_query("Definizione di appalto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1655", [f"{CC_BASE}art1655", f"{CC_BASE}art1656"], "easy")
    gs.add_query("Art. 1655 nozione di appalto", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1655", [f"{CC_BASE}art1655"], "easy")
    gs.add_query("Responsabilità dell'appaltatore per difformità", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1667", [f"{CC_BASE}art1667", f"{CC_BASE}art1668"], "medium")
    gs.add_query("Rovina e difetti dell'opera art. 1669", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1669", [f"{CC_BASE}art1669"], "hard")

    # Mandato
    gs.add_query("Cos'è il mandato?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1703", [f"{CC_BASE}art1703", f"{CC_BASE}art1704"], "easy")
    gs.add_query("Art. 1703 nozione di mandato", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1703", [f"{CC_BASE}art1703"], "easy")
    gs.add_query("Mandato con rappresentanza", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1704", [f"{CC_BASE}art1704", f"{CC_BASE}art1705"], "medium")
    gs.add_query("Obblighi del mandatario", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1710", [f"{CC_BASE}art1710", f"{CC_BASE}art1711", f"{CC_BASE}art1712"], "medium")

    # Deposito
    gs.add_query("Cos'è il deposito?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1766", [f"{CC_BASE}art1766", f"{CC_BASE}art1767", f"{CC_BASE}art1768"], "easy")
    gs.add_query("Deposito irregolare", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1782", [f"{CC_BASE}art1782"], "medium")

    # Comodato
    gs.add_query("Cos'è il comodato?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1803", [f"{CC_BASE}art1803", f"{CC_BASE}art1804", f"{CC_BASE}art1805"], "easy")

    # Mutuo
    gs.add_query("Definizione di mutuo", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1813", [f"{CC_BASE}art1813", f"{CC_BASE}art1814", f"{CC_BASE}art1815"], "easy")
    gs.add_query("Art. 1813 nozione di mutuo", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1813", [f"{CC_BASE}art1813"], "easy")
    gs.add_query("Interessi nel mutuo", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1815", [f"{CC_BASE}art1815", f"{CC_BASE}art1284"], "medium")

    # Assicurazione
    gs.add_query("Il contratto di assicurazione", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1882", [f"{CC_BASE}art1882", f"{CC_BASE}art1883"], "medium")
    gs.add_query("Art. 1882 nozione di assicurazione", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1882", [f"{CC_BASE}art1882"], "easy")
    gs.add_query("Assicurazione contro i danni", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1904", [f"{CC_BASE}art1904", f"{CC_BASE}art1905", f"{CC_BASE}art1906"], "medium")

    # Fideiussione
    gs.add_query("Cos'è la fideiussione?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1936", [f"{CC_BASE}art1936", f"{CC_BASE}art1937"], "medium")
    gs.add_query("Art. 1936 nozione di fideiussione", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art1936", [f"{CC_BASE}art1936"], "easy")
    gs.add_query("Beneficio della preventiva escussione", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1944", [f"{CC_BASE}art1944"], "hard")

    # Transazione
    gs.add_query("Cos'è la transazione?", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1965", [f"{CC_BASE}art1965", f"{CC_BASE}art1966"], "medium")

    # Promessa unilaterale
    gs.add_query("La promessa unilaterale", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1987", [f"{CC_BASE}art1987", f"{CC_BASE}art1988", f"{CC_BASE}art1989"], "hard")

    # Arricchimento senza causa
    gs.add_query("L'arricchimento senza causa", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2041", [f"{CC_BASE}art2041", f"{CC_BASE}art2042"], "medium")
    gs.add_query("Art. 2041 azione di arricchimento", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2041", [f"{CC_BASE}art2041"], "easy")

    # Gestione di affari
    gs.add_query("La gestione di affari altrui", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2028", [f"{CC_BASE}art2028", f"{CC_BASE}art2029", f"{CC_BASE}art2030"], "hard")

    # Pagamento dell'indebito
    gs.add_query("Il pagamento dell'indebito", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2033", [f"{CC_BASE}art2033", f"{CC_BASE}art2034", f"{CC_BASE}art2035"], "hard")
    gs.add_query("Obbligazione naturale", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2034", [f"{CC_BASE}art2034"], "hard")

    # =========================================================================
    # SEZIONE 4: FATTI ILLECITI (art. 2043-2059) - 15 query
    # =========================================================================

    gs.add_query("Responsabilità per fatto illecito", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2043", [f"{CC_BASE}art2043", f"{CC_BASE}art2044", f"{CC_BASE}art2045"], "easy")
    gs.add_query("Art. 2043 risarcimento per fatto illecito", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2043", [f"{CC_BASE}art2043"], "easy")
    gs.add_query("Legittima difesa nel diritto civile", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2044", [f"{CC_BASE}art2044"], "medium")
    gs.add_query("Stato di necessità art. 2045", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2045", [f"{CC_BASE}art2045"], "medium")
    gs.add_query("Responsabilità dei padroni e committenti", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2049", [f"{CC_BASE}art2049"], "medium")
    gs.add_query("Art. 2049 responsabilità vicaria", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2049", [f"{CC_BASE}art2049"], "easy")
    gs.add_query("Responsabilità per esercizio di attività pericolose", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2050", [f"{CC_BASE}art2050"], "medium")
    gs.add_query("Danno cagionato da animali", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2052", [f"{CC_BASE}art2052"], "medium")
    gs.add_query("Danno cagionato da cose in custodia", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2051", [f"{CC_BASE}art2051"], "medium")
    gs.add_query("Responsabilità per la circolazione dei veicoli", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2054", [f"{CC_BASE}art2054"], "medium")
    gs.add_query("Art. 2054 danno da circolazione", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2054", [f"{CC_BASE}art2054"], "easy")
    gs.add_query("Risarcimento del danno art. 2056", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2056", [f"{CC_BASE}art2056", f"{CC_BASE}art1223", f"{CC_BASE}art1226"], "medium")
    gs.add_query("Danni non patrimoniali", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2059", [f"{CC_BASE}art2059"], "medium")
    gs.add_query("Art. 2059 danno morale", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2059", [f"{CC_BASE}art2059"], "easy")
    gs.add_query("Giurisprudenza sul danno biologico", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art2059", [f"{CC_BASE}art2059", f"{CC_BASE}art2043"], "hard")

    # =========================================================================
    # SEZIONE 5: QUERY PRATICHE E GIURISPRUDENZIALI (15 query)
    # =========================================================================

    gs.add_query("Come risolvere un contratto per inadempimento?", QueryCategory.PRATICA,
                 f"{CC_BASE}art1453", [f"{CC_BASE}art1453", f"{CC_BASE}art1454", f"{CC_BASE}art1455"], "medium")
    gs.add_query("Come chiedere il risarcimento danni?", QueryCategory.PRATICA,
                 f"{CC_BASE}art2043", [f"{CC_BASE}art2043", f"{CC_BASE}art2056", f"{CC_BASE}art2059"], "medium")
    gs.add_query("Come contestare un prodotto difettoso?", QueryCategory.PRATICA,
                 f"{CC_BASE}art1490", [f"{CC_BASE}art1490", f"{CC_BASE}art1492", f"{CC_BASE}art1495"], "medium")
    gs.add_query("Come recedere da un contratto?", QueryCategory.PRATICA,
                 f"{CC_BASE}art1373", [f"{CC_BASE}art1373", f"{CC_BASE}art1385"], "medium")
    gs.add_query("Come impugnare un contratto per errore?", QueryCategory.PRATICA,
                 f"{CC_BASE}art1428", [f"{CC_BASE}art1428", f"{CC_BASE}art1429", f"{CC_BASE}art1431"], "hard")
    gs.add_query("Giurisprudenza sulla risoluzione del contratto", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art1453", [f"{CC_BASE}art1453", f"{CC_BASE}art1454", f"{CC_BASE}art1455"], "hard")
    gs.add_query("Cassazione sulla buona fede contrattuale", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art1175", [f"{CC_BASE}art1175", f"{CC_BASE}art1375"], "hard")
    gs.add_query("Sentenze sulla responsabilità del costruttore", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art1669", [f"{CC_BASE}art1669", f"{CC_BASE}art2053"], "hard")
    gs.add_query("Giurisprudenza sull'inadempimento contrattuale", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art1218", [f"{CC_BASE}art1218", f"{CC_BASE}art1223", f"{CC_BASE}art1227"], "hard")
    gs.add_query("Cassazione sul preliminare di vendita", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art1351", [f"{CC_BASE}art1351", f"{CC_BASE}art2932"], "hard")
    gs.add_query("Sentenze sulla mora del debitore", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art1219", [f"{CC_BASE}art1219", f"{CC_BASE}art1220", f"{CC_BASE}art1224"], "hard")
    gs.add_query("Giurisprudenza sulla responsabilità medica", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art2236", [f"{CC_BASE}art2236", f"{CC_BASE}art1218", f"{CC_BASE}art2043"], "hard")
    gs.add_query("Giurisprudenza sui vizi della cosa venduta", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art1490", [f"{CC_BASE}art1490", f"{CC_BASE}art1491", f"{CC_BASE}art1495"], "hard")
    gs.add_query("Cassazione sul danno da circolazione", QueryCategory.GIURISPRUDENZIALE,
                 f"{CC_BASE}art2054", [f"{CC_BASE}art2054"], "hard")
    gs.add_query("Come calcolare il danno da ritardato pagamento?", QueryCategory.PRATICA,
                 f"{CC_BASE}art1224", [f"{CC_BASE}art1224", f"{CC_BASE}art1284"], "hard")

    # =========================================================================
    # SEZIONE 6: QUERY AGGIUNTIVE PER COMPLETEZZA (20 query)
    # =========================================================================

    # Modi di estinzione delle obbligazioni
    gs.add_query("La novazione dell'obbligazione", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1230", [f"{CC_BASE}art1230", f"{CC_BASE}art1231", f"{CC_BASE}art1232"], "hard")
    gs.add_query("La remissione del debito", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1236", [f"{CC_BASE}art1236", f"{CC_BASE}art1237"], "medium")
    gs.add_query("Confusione nell'obbligazione", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1253", [f"{CC_BASE}art1253", f"{CC_BASE}art1254"], "hard")
    gs.add_query("Cessione del credito", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1260", [f"{CC_BASE}art1260", f"{CC_BASE}art1261", f"{CC_BASE}art1262"], "medium")

    # Contratti specifici aggiuntivi
    gs.add_query("Il contratto di somministrazione", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1559", [f"{CC_BASE}art1559", f"{CC_BASE}art1560", f"{CC_BASE}art1561"], "medium")
    gs.add_query("La permuta", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1552", [f"{CC_BASE}art1552", f"{CC_BASE}art1553", f"{CC_BASE}art1555"], "easy")
    gs.add_query("Il contratto estimatorio", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1556", [f"{CC_BASE}art1556", f"{CC_BASE}art1557", f"{CC_BASE}art1558"], "hard")
    gs.add_query("Il contratto d'opera", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2222", [f"{CC_BASE}art2222", f"{CC_BASE}art2223", f"{CC_BASE}art2224"], "medium")
    gs.add_query("Art. 2222 definizione contratto d'opera", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2222", [f"{CC_BASE}art2222"], "easy")
    gs.add_query("Il contratto di trasporto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1678", [f"{CC_BASE}art1678", f"{CC_BASE}art1679", f"{CC_BASE}art1680"], "medium")

    # Responsabilità aggiuntive
    gs.add_query("Responsabilità del vettore", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1693", [f"{CC_BASE}art1693", f"{CC_BASE}art1694", f"{CC_BASE}art1695"], "hard")
    gs.add_query("Responsabilità del custode", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2051", [f"{CC_BASE}art2051"], "medium")
    gs.add_query("Responsabilità per esercizio di attività pericolose", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2050", [f"{CC_BASE}art2050"], "medium")

    # Garanzie
    gs.add_query("L'ipoteca nel codice civile", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2808", [f"{CC_BASE}art2808", f"{CC_BASE}art2809", f"{CC_BASE}art2810"], "hard")
    gs.add_query("Il pegno nel codice civile", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art2784", [f"{CC_BASE}art2784", f"{CC_BASE}art2785", f"{CC_BASE}art2786"], "medium")
    gs.add_query("Art. 2784 costituzione del pegno", QueryCategory.NORMATIVA,
                 f"{CC_BASE}art2784", [f"{CC_BASE}art2784"], "easy")

    # Diritti reali
    gs.add_query("Le servitù prediali", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1027", [f"{CC_BASE}art1027", f"{CC_BASE}art1028", f"{CC_BASE}art1029"], "hard")
    gs.add_query("L'usufrutto", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art978", [f"{CC_BASE}art978", f"{CC_BASE}art979", f"{CC_BASE}art980"], "medium")
    gs.add_query("La proprietà nel codice civile", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art832", [f"{CC_BASE}art832", f"{CC_BASE}art833"], "easy")
    gs.add_query("Il possesso nel diritto civile", QueryCategory.CONCETTUALE,
                 f"{CC_BASE}art1140", [f"{CC_BASE}art1140", f"{CC_BASE}art1141", f"{CC_BASE}art1142"], "medium")

    return gs


def create_semantic_gold_standard() -> GoldStandard:
    """
    Crea un gold standard per test SEMANTICI (EXP-016).

    A differenza di create_libro_iv_gold_standard():
    - Solo query concettuali/semantiche (NO numeri articolo)
    - Solo articoli nel range Libro IV (1173-2059)
    - Valutazione graduata (0-3) invece di binaria

    Scores:
    - 3: Articolo esattamente sul tema (definizione diretta)
    - 2: Articolo fortemente correlato (stesso istituto)
    - 1: Articolo tangenzialmente correlato
    - 0: Non rilevante

    Returns:
        GoldStandard con 30 query semantiche
    """
    gs = GoldStandard.create_empty(
        name="MERL-T Semantic RAG Benchmark",
        version="2.0",
        author="EXP-016"
    )

    # Base URN per Codice Civile (formato completo come nel database)
    CC_BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~"

    # =========================================================================
    # DEFINIZIONI (10) - "Cos'è X?"
    # =========================================================================

    gs.queries.append(Query(
        id="S001",
        text="Cos'è il contratto nel diritto civile",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1321",
        relevant_urns=[f"{CC_BASE}art1321", f"{CC_BASE}art1322", f"{CC_BASE}art1323", f"{CC_BASE}art1324"],
        relevance_scores={
            f"{CC_BASE}art1321": 3,  # Definizione di contratto
            f"{CC_BASE}art1322": 2,  # Classificazione contratti
            f"{CC_BASE}art1323": 2,  # Contratti atipici
            f"{CC_BASE}art1324": 1,  # Norme sui contratti
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S002",
        text="Definizione di obbligazione",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1173",
        relevant_urns=[f"{CC_BASE}art1173", f"{CC_BASE}art1174", f"{CC_BASE}art1175", f"{CC_BASE}art1176"],
        relevance_scores={
            f"{CC_BASE}art1173": 3,  # Fonti delle obbligazioni
            f"{CC_BASE}art1174": 2,  # Carattere patrimoniale
            f"{CC_BASE}art1175": 2,  # Comportamento secondo buona fede
            f"{CC_BASE}art1176": 2,  # Diligenza nell'adempimento
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S003",
        text="Cos'è l'adempimento dell'obbligazione",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1176",
        relevant_urns=[f"{CC_BASE}art1176", f"{CC_BASE}art1177", f"{CC_BASE}art1178", f"{CC_BASE}art1180"],
        relevance_scores={
            f"{CC_BASE}art1176": 3,  # Diligenza nell'adempimento
            f"{CC_BASE}art1177": 2,  # Diligenza nel restituire
            f"{CC_BASE}art1178": 2,  # Obbligazioni generiche
            f"{CC_BASE}art1180": 2,  # Adempimento del terzo
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S004",
        text="Definizione di compravendita",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1470",
        relevant_urns=[f"{CC_BASE}art1470", f"{CC_BASE}art1471", f"{CC_BASE}art1472", f"{CC_BASE}art1476"],
        relevance_scores={
            f"{CC_BASE}art1470": 3,  # Definizione vendita
            f"{CC_BASE}art1471": 2,  # Divieto di acquistare
            f"{CC_BASE}art1472": 2,  # Vendita cosa futura
            f"{CC_BASE}art1476": 2,  # Obbligazioni del venditore
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S005",
        text="Cosa si intende per locazione",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1571",
        relevant_urns=[f"{CC_BASE}art1571", f"{CC_BASE}art1572", f"{CC_BASE}art1573", f"{CC_BASE}art1575"],
        relevance_scores={
            f"{CC_BASE}art1571": 3,  # Definizione locazione
            f"{CC_BASE}art1572": 2,  # Locazione eccedente i 9 anni
            f"{CC_BASE}art1573": 2,  # Determinazione della durata
            f"{CC_BASE}art1575": 2,  # Obbligazioni del locatore
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S006",
        text="Cos'è il mandato",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1703",
        relevant_urns=[f"{CC_BASE}art1703", f"{CC_BASE}art1704", f"{CC_BASE}art1705", f"{CC_BASE}art1710"],
        relevance_scores={
            f"{CC_BASE}art1703": 3,  # Definizione mandato
            f"{CC_BASE}art1704": 2,  # Mandato con rappresentanza
            f"{CC_BASE}art1705": 2,  # Mandato senza rappresentanza
            f"{CC_BASE}art1710": 2,  # Obblighi del mandatario
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S007",
        text="Definizione di appalto",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1655",
        relevant_urns=[f"{CC_BASE}art1655", f"{CC_BASE}art1656", f"{CC_BASE}art1658", f"{CC_BASE}art1659"],
        relevance_scores={
            f"{CC_BASE}art1655": 3,  # Definizione appalto
            f"{CC_BASE}art1656": 2,  # Subappalto
            f"{CC_BASE}art1658": 2,  # Fornitura della materia
            f"{CC_BASE}art1659": 2,  # Variazioni al progetto
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S008",
        text="Cos'è la fideiussione",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1936",
        relevant_urns=[f"{CC_BASE}art1936", f"{CC_BASE}art1937", f"{CC_BASE}art1938", f"{CC_BASE}art1939"],
        relevance_scores={
            f"{CC_BASE}art1936": 3,  # Definizione fideiussione
            f"{CC_BASE}art1937": 2,  # Manifestazione della volontà
            f"{CC_BASE}art1938": 2,  # Obbligazioni future
            f"{CC_BASE}art1939": 2,  # Validità della fideiussione
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S009",
        text="Definizione di mutuo",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1813",
        relevant_urns=[f"{CC_BASE}art1813", f"{CC_BASE}art1814", f"{CC_BASE}art1815", f"{CC_BASE}art1817"],
        relevance_scores={
            f"{CC_BASE}art1813": 3,  # Definizione mutuo
            f"{CC_BASE}art1814": 2,  # Promessa di mutuo
            f"{CC_BASE}art1815": 2,  # Interessi
            f"{CC_BASE}art1817": 2,  # Inadempimento del mutuatario
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S010",
        text="Cos'è il deposito",
        category=QueryCategory.DEFINIZIONE,
        expected_article=f"{CC_BASE}art1766",
        relevant_urns=[f"{CC_BASE}art1766", f"{CC_BASE}art1767", f"{CC_BASE}art1768", f"{CC_BASE}art1770"],
        relevance_scores={
            f"{CC_BASE}art1766": 3,  # Definizione deposito
            f"{CC_BASE}art1767": 2,  # Presunzione di gratuità
            f"{CC_BASE}art1768": 2,  # Diligenza nella custodia
            f"{CC_BASE}art1770": 2,  # Uso della cosa depositata
        },
        difficulty="easy",
        source="manual"
    ))

    # =========================================================================
    # CONCETTI (10) - Principi e concetti giuridici
    # =========================================================================

    gs.queries.append(Query(
        id="S011",
        text="Responsabilità del debitore per inadempimento",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1218",
        relevant_urns=[f"{CC_BASE}art1218", f"{CC_BASE}art1219", f"{CC_BASE}art1223", f"{CC_BASE}art1227"],
        relevance_scores={
            f"{CC_BASE}art1218": 3,  # Responsabilità del debitore
            f"{CC_BASE}art1219": 2,  # Mora del debitore
            f"{CC_BASE}art1223": 2,  # Risarcimento del danno
            f"{CC_BASE}art1227": 2,  # Concorso del creditore
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S012",
        text="La buona fede nelle obbligazioni",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1175",
        relevant_urns=[f"{CC_BASE}art1175", f"{CC_BASE}art1337", f"{CC_BASE}art1366", f"{CC_BASE}art1375"],
        relevance_scores={
            f"{CC_BASE}art1175": 3,  # Comportamento secondo buona fede
            f"{CC_BASE}art1337": 2,  # Trattative e buona fede
            f"{CC_BASE}art1366": 2,  # Interpretazione di buona fede
            f"{CC_BASE}art1375": 2,  # Esecuzione di buona fede
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S013",
        text="Effetti della mora del debitore",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1219",
        relevant_urns=[f"{CC_BASE}art1219", f"{CC_BASE}art1220", f"{CC_BASE}art1221", f"{CC_BASE}art1224"],
        relevance_scores={
            f"{CC_BASE}art1219": 3,  # Costituzione in mora
            f"{CC_BASE}art1220": 2,  # Mora automatica
            f"{CC_BASE}art1221": 2,  # Effetti della mora
            f"{CC_BASE}art1224": 2,  # Danni nelle obbligazioni pecuniarie
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S014",
        text="Responsabilità per fatto illecito",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art2043",
        relevant_urns=[f"{CC_BASE}art2043", f"{CC_BASE}art2044", f"{CC_BASE}art2045", f"{CC_BASE}art2046"],
        relevance_scores={
            f"{CC_BASE}art2043": 3,  # Risarcimento per fatto illecito
            f"{CC_BASE}art2044": 2,  # Legittima difesa
            f"{CC_BASE}art2045": 2,  # Stato di necessità
            f"{CC_BASE}art2046": 2,  # Imputabilità
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S015",
        text="La risoluzione del contratto per inadempimento",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1453",
        relevant_urns=[f"{CC_BASE}art1453", f"{CC_BASE}art1454", f"{CC_BASE}art1455", f"{CC_BASE}art1458"],
        relevance_scores={
            f"{CC_BASE}art1453": 3,  # Risolubilità del contratto
            f"{CC_BASE}art1454": 2,  # Diffida ad adempiere
            f"{CC_BASE}art1455": 2,  # Importanza inadempimento
            f"{CC_BASE}art1458": 2,  # Effetti della risoluzione
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S016",
        text="Nullità e annullabilità del contratto",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1418",
        relevant_urns=[f"{CC_BASE}art1418", f"{CC_BASE}art1419", f"{CC_BASE}art1425", f"{CC_BASE}art1427"],
        relevance_scores={
            f"{CC_BASE}art1418": 3,  # Cause di nullità
            f"{CC_BASE}art1419": 2,  # Nullità parziale
            f"{CC_BASE}art1425": 2,  # Incapacità delle parti
            f"{CC_BASE}art1427": 2,  # Errore, violenza, dolo
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S017",
        text="Obblighi del venditore nella compravendita",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1476",
        relevant_urns=[f"{CC_BASE}art1476", f"{CC_BASE}art1477", f"{CC_BASE}art1490", f"{CC_BASE}art1495"],
        relevance_scores={
            f"{CC_BASE}art1476": 3,  # Obbligazioni principali
            f"{CC_BASE}art1477": 2,  # Consegna della cosa
            f"{CC_BASE}art1490": 2,  # Garanzia vizi
            f"{CC_BASE}art1495": 2,  # Termini e condizioni garanzia
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S018",
        text="Cessione del credito",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1260",
        relevant_urns=[f"{CC_BASE}art1260", f"{CC_BASE}art1261", f"{CC_BASE}art1262", f"{CC_BASE}art1264"],
        relevance_scores={
            f"{CC_BASE}art1260": 3,  # Cedibilità dei crediti
            f"{CC_BASE}art1261": 2,  # Divieto di cessione
            f"{CC_BASE}art1262": 2,  # Accessori del credito
            f"{CC_BASE}art1264": 2,  # Efficacia della cessione
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S019",
        text="Solidarietà nelle obbligazioni",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1292",
        relevant_urns=[f"{CC_BASE}art1292", f"{CC_BASE}art1293", f"{CC_BASE}art1294", f"{CC_BASE}art1298"],
        relevance_scores={
            f"{CC_BASE}art1292": 3,  # Obbligazioni solidali
            f"{CC_BASE}art1293": 2,  # Eccezioni opponibili
            f"{CC_BASE}art1294": 2,  # Morte di un condebitore
            f"{CC_BASE}art1298": 2,  # Ripartizione del debito
        },
        difficulty="hard",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S020",
        text="Prescrizione e decadenza",
        category=QueryCategory.CONCETTO,
        expected_article=f"{CC_BASE}art1946",
        relevant_urns=[f"{CC_BASE}art1946", f"{CC_BASE}art1947", f"{CC_BASE}art1948", f"{CC_BASE}art1949"],
        relevance_scores={
            f"{CC_BASE}art1946": 3,  # Eccezione del fideiussore
            f"{CC_BASE}art1947": 2,  # Regresso
            f"{CC_BASE}art1948": 2,  # Surrogazione
            f"{CC_BASE}art1949": 2,  # Surrogazione parziale
        },
        difficulty="hard",
        source="manual"
    ))

    # =========================================================================
    # ISTITUTI (10) - Istituti giuridici specifici
    # =========================================================================

    gs.queries.append(Query(
        id="S021",
        text="La garanzia per i vizi della cosa venduta",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art1490",
        relevant_urns=[f"{CC_BASE}art1490", f"{CC_BASE}art1491", f"{CC_BASE}art1492", f"{CC_BASE}art1495"],
        relevance_scores={
            f"{CC_BASE}art1490": 3,  # Garanzia per i vizi
            f"{CC_BASE}art1491": 2,  # Esclusione della garanzia
            f"{CC_BASE}art1492": 2,  # Effetti della garanzia
            f"{CC_BASE}art1495": 2,  # Termini e condizioni
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S022",
        text="La caparra confirmatoria",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art1385",
        relevant_urns=[f"{CC_BASE}art1385", f"{CC_BASE}art1386"],
        relevance_scores={
            f"{CC_BASE}art1385": 3,  # Caparra confirmatoria
            f"{CC_BASE}art1386": 2,  # Caparra penitenziale
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S023",
        text="La clausola penale nel contratto",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art1382",
        relevant_urns=[f"{CC_BASE}art1382", f"{CC_BASE}art1383", f"{CC_BASE}art1384"],
        relevance_scores={
            f"{CC_BASE}art1382": 3,  # Effetti della clausola penale
            f"{CC_BASE}art1383": 2,  # Divieto di cumulo
            f"{CC_BASE}art1384": 2,  # Riduzione della penale
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S024",
        text="Il comodato",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art1803",
        relevant_urns=[f"{CC_BASE}art1803", f"{CC_BASE}art1804", f"{CC_BASE}art1805", f"{CC_BASE}art1809"],
        relevance_scores={
            f"{CC_BASE}art1803": 3,  # Definizione comodato
            f"{CC_BASE}art1804": 2,  # Obbligazioni del comodatario
            f"{CC_BASE}art1805": 2,  # Perimento della cosa
            f"{CC_BASE}art1809": 2,  # Comodato senza termine
        },
        difficulty="easy",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S025",
        text="La transazione",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art1965",
        relevant_urns=[f"{CC_BASE}art1965", f"{CC_BASE}art1966", f"{CC_BASE}art1967", f"{CC_BASE}art1972"],
        relevance_scores={
            f"{CC_BASE}art1965": 3,  # Definizione transazione
            f"{CC_BASE}art1966": 2,  # Capacità e potere di disporre
            f"{CC_BASE}art1967": 2,  # Prova della transazione
            f"{CC_BASE}art1972": 2,  # Transazione e titolo nullo
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S026",
        text="L'arricchimento senza causa",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art2041",
        relevant_urns=[f"{CC_BASE}art2041", f"{CC_BASE}art2042"],
        relevance_scores={
            f"{CC_BASE}art2041": 3,  # Azione generale di arricchimento
            f"{CC_BASE}art2042": 2,  # Carattere sussidiario
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S027",
        text="La gestione di affari altrui",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art2028",
        relevant_urns=[f"{CC_BASE}art2028", f"{CC_BASE}art2029", f"{CC_BASE}art2030", f"{CC_BASE}art2031"],
        relevance_scores={
            f"{CC_BASE}art2028": 3,  # Obbligo di continuare la gestione
            f"{CC_BASE}art2029": 2,  # Capacità del gestore
            f"{CC_BASE}art2030": 2,  # Obbligazioni del gestore
            f"{CC_BASE}art2031": 2,  # Obbligazioni dell'interessato
        },
        difficulty="hard",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S028",
        text="Il contratto a favore di terzi",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art1411",
        relevant_urns=[f"{CC_BASE}art1411", f"{CC_BASE}art1412", f"{CC_BASE}art1413"],
        relevance_scores={
            f"{CC_BASE}art1411": 3,  # Contratto a favore di terzi
            f"{CC_BASE}art1412": 2,  # Prestazione al terzo dopo morte
            f"{CC_BASE}art1413": 2,  # Revoca e modifica
        },
        difficulty="medium",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S029",
        text="La promessa unilaterale",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art1987",
        relevant_urns=[f"{CC_BASE}art1987", f"{CC_BASE}art1988", f"{CC_BASE}art1989"],
        relevance_scores={
            f"{CC_BASE}art1987": 3,  # Efficacia delle promesse
            f"{CC_BASE}art1988": 2,  # Promessa di pagamento
            f"{CC_BASE}art1989": 2,  # Promessa al pubblico
        },
        difficulty="hard",
        source="manual"
    ))

    gs.queries.append(Query(
        id="S030",
        text="La novazione dell'obbligazione",
        category=QueryCategory.ISTITUTO,
        expected_article=f"{CC_BASE}art1230",
        relevant_urns=[f"{CC_BASE}art1230", f"{CC_BASE}art1231", f"{CC_BASE}art1232", f"{CC_BASE}art1234"],
        relevance_scores={
            f"{CC_BASE}art1230": 3,  # Novazione oggettiva
            f"{CC_BASE}art1231": 2,  # Modifiche accessorie
            f"{CC_BASE}art1232": 2,  # Estinzione del debito
            f"{CC_BASE}art1234": 2,  # Novazione soggettiva
        },
        difficulty="hard",
        source="manual"
    ))

    return gs
