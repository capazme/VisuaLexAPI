"""
Disagreement Data Collector
===========================

Raccoglie samples per training LegalDisagreementNet da diverse fonti.

Fonti supportate:
1. RLCF Feedback - Estrae disagreement_score e contention_points
2. Overruling Relations - Ground truth dal grafo (tipo OVR)
3. Synthetic Generation - Genera samples con LLM

Esempio:
    >>> from merlt.disagreement.data import DisagreementDataCollector
    >>>
    >>> collector = DisagreementDataCollector(
    ...     rlcf_db=rlcf_database,
    ...     graph_db=falkordb_client
    ... )
    >>> samples = await collector.collect_all(limit=1000)
    >>> print(f"Raccolti {len(samples)} samples")
"""

import uuid
import structlog
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, AsyncIterator
from datetime import datetime, timedelta
from dataclasses import dataclass

from merlt.disagreement.types import (
    DisagreementSample,
    DisagreementType,
    DisagreementLevel,
    ExpertResponseData,
    EXPERT_NAMES,
)

log = structlog.get_logger()


# =============================================================================
# BASE SOURCE CLASS
# =============================================================================

class DataSource(ABC):
    """
    Base class per fonti di dati.

    Ogni fonte implementa collect() per restituire samples.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Nome della fonte."""
        pass

    @property
    @abstractmethod
    def quality_tier(self) -> str:
        """Tier di qualita': 'gold', 'silver', 'bronze'."""
        pass

    @abstractmethod
    async def collect(
        self,
        limit: Optional[int] = None,
        since: Optional[datetime] = None
    ) -> AsyncIterator[DisagreementSample]:
        """
        Raccoglie samples dalla fonte.

        Args:
            limit: Numero massimo di samples
            since: Solo samples creati dopo questa data

        Yields:
            DisagreementSample per ogni sample trovato
        """
        pass

    @abstractmethod
    async def count(self) -> int:
        """Conta samples disponibili nella fonte."""
        pass


# =============================================================================
# RLCF SOURCE
# =============================================================================

class RLCFSource(DataSource):
    """
    Fonte dati dal sistema RLCF (Reinforcement Learning from Crowd Feedback).

    Estrae samples dalle interazioni con feedback che hanno:
    - disagreement_score > threshold
    - contention_points identificati

    Quality: Silver (inferito da feedback, non annotato direttamente)
    """

    name = "rlcf"
    quality_tier = "silver"

    def __init__(
        self,
        rlcf_db: Any,
        disagreement_threshold: float = 0.3,
        min_expert_responses: int = 2
    ):
        """
        Inizializza RLCFSource.

        Args:
            rlcf_db: Database RLCF (SQLAlchemy session o client)
            disagreement_threshold: Soglia minima per disagreement_score
            min_expert_responses: Numero minimo di risposte expert necessarie
        """
        self.rlcf_db = rlcf_db
        self.disagreement_threshold = disagreement_threshold
        self.min_expert_responses = min_expert_responses

    async def collect(
        self,
        limit: Optional[int] = None,
        since: Optional[datetime] = None
    ) -> AsyncIterator[DisagreementSample]:
        """
        Raccoglie samples da RLCF feedback.

        Cerca interazioni con:
        1. Almeno min_expert_responses risposte expert
        2. disagreement_score > threshold (oppure == 0 per negatives)
        """
        if self.rlcf_db is None:
            log.warning("RLCF database non configurato")
            return

        try:
            # Query per estrarre feedback con expert responses
            # Struttura attesa dal modello RLCF esistente
            query = """
                SELECT
                    r.id as response_id,
                    t.query as query,
                    t.domain as legal_domain,
                    r.aggregation_metadata,
                    r.created_at
                FROM rlcf_responses r
                JOIN rlcf_tasks t ON r.task_id = t.id
                WHERE r.aggregation_metadata IS NOT NULL
            """

            if since:
                query += f" AND r.created_at > '{since.isoformat()}'"

            query += " ORDER BY r.created_at DESC"

            if limit:
                query += f" LIMIT {limit * 2}"  # Over-fetch per filtrare

            results = await self.rlcf_db.execute(query)

            count = 0
            for row in results:
                if limit and count >= limit:
                    break

                sample = await self._row_to_sample(row)
                if sample:
                    count += 1
                    yield sample

        except Exception as e:
            log.error(f"Errore raccolta da RLCF: {e}")

    async def _row_to_sample(self, row: Dict[str, Any]) -> Optional[DisagreementSample]:
        """Converte una riga del DB in DisagreementSample."""
        try:
            metadata = row.get("aggregation_metadata", {})
            if isinstance(metadata, str):
                import json
                metadata = json.loads(metadata)

            # Estrai expert responses dalla metadata
            expert_interpretations = metadata.get("expert_interpretations", {})
            if len(expert_interpretations) < self.min_expert_responses:
                return None

            # Costruisci expert responses
            expert_responses = {}
            for expert_name, interp_data in expert_interpretations.items():
                # Normalizza nome expert
                normalized_name = expert_name.lower().replace("expert", "")
                if normalized_name not in EXPERT_NAMES:
                    continue

                expert_responses[normalized_name] = ExpertResponseData(
                    expert_type=normalized_name,
                    interpretation=interp_data.get("interpretation", ""),
                    confidence=interp_data.get("confidence", 0.5),
                    sources_cited=interp_data.get("sources", []),
                    reasoning_pattern=interp_data.get("reasoning_type"),
                )

            if len(expert_responses) < self.min_expert_responses:
                return None

            # Estrai disagreement info
            disagreement_score = metadata.get("disagreement_score", 0.0)
            contention_points = metadata.get("contention_points", [])

            # Determina label
            has_disagreement = disagreement_score > self.disagreement_threshold

            # Inferisci tipo (euristica basata su contention points)
            disagreement_type = None
            if has_disagreement and contention_points:
                disagreement_type = self._infer_type_from_contention(contention_points)

            # Inferisci livello dalla coppia in conflitto
            disagreement_level = None
            conflicting_pairs_raw = metadata.get("conflicting_pairs", [])
            if conflicting_pairs_raw:
                disagreement_level = self._infer_level_from_pairs(conflicting_pairs_raw)

            return DisagreementSample(
                sample_id=f"rlcf_{row['response_id']}",
                query=row.get("query", ""),
                expert_responses=expert_responses,
                has_disagreement=has_disagreement,
                disagreement_type=disagreement_type,
                disagreement_level=disagreement_level,
                intensity=disagreement_score if has_disagreement else 0.0,
                conflicting_pairs=[
                    tuple(p) for p in conflicting_pairs_raw
                ] if conflicting_pairs_raw else None,
                source="rlcf",
                legal_domain=row.get("legal_domain", "generale"),
                created_at=row.get("created_at", datetime.now()),
            )

        except Exception as e:
            log.debug(f"Errore conversione row RLCF: {e}")
            return None

    def _infer_type_from_contention(
        self,
        contention_points: List[str]
    ) -> Optional[DisagreementType]:
        """
        Inferisce tipo di disagreement dai contention points.

        Euristica basata su keyword matching.
        """
        text = " ".join(contention_points).lower()

        # Keyword matching
        if any(kw in text for kw in ["contrasto", "incompatibil", "antinom"]):
            return DisagreementType.ANTINOMY
        if any(kw in text for kw in ["ambig", "polisem", "significat"]):
            return DisagreementType.INTERPRETIVE_GAP
        if any(kw in text for kw in ["metodo", "letterale", "teleologic", "sistematic"]):
            return DisagreementType.METHODOLOGICAL
        if any(kw in text for kw in ["superat", "overrul", "revir", "precedent"]):
            return DisagreementType.OVERRULING
        if any(kw in text for kw in ["costituz", "gerarc", "superior"]):
            return DisagreementType.HIERARCHICAL
        if any(kw in text for kw in ["special", "specific", "complemen"]):
            return DisagreementType.SPECIALIZATION

        return None

    def _infer_level_from_pairs(
        self,
        pairs: List[List[str]]
    ) -> Optional[DisagreementLevel]:
        """
        Inferisce livello di disagreement dalle coppie in conflitto.

        Logica: il livello corrisponde all'expert che diverge.
        """
        # Conta frequenza expert nelle coppie
        expert_counts = {}
        for pair in pairs:
            for expert in pair:
                name = expert.lower().replace("expert", "")
                expert_counts[name] = expert_counts.get(name, 0) + 1

        if not expert_counts:
            return None

        # L'expert piu' frequente determina il livello
        most_common = max(expert_counts, key=expert_counts.get)

        level_mapping = {
            "literal": DisagreementLevel.SEMANTIC,
            "systemic": DisagreementLevel.SYSTEMIC,
            "principles": DisagreementLevel.TELEOLOGICAL,
            "precedent": DisagreementLevel.APPLICATIVE,
        }

        return level_mapping.get(most_common)

    async def count(self) -> int:
        """Conta samples disponibili in RLCF."""
        if self.rlcf_db is None:
            return 0

        try:
            result = await self.rlcf_db.execute(
                "SELECT COUNT(*) FROM rlcf_responses WHERE aggregation_metadata IS NOT NULL"
            )
            return result[0][0] if result else 0
        except Exception as e:
            log.warning("count_query_failed", error=str(e))
            return 0


# =============================================================================
# OVERRULING SOURCE
# =============================================================================

class OverrulingSource(DataSource):
    """
    Fonte dati dalle relazioni di overruling nel grafo.

    Estrae coppie di precedenti dove uno supera l'altro.
    Questi sono ground truth per tipo OVR (Overruling).

    Quality: Gold (relazione esplicita nel grafo)
    """

    name = "overruling"
    quality_tier = "gold"

    def __init__(self, graph_db: Any):
        """
        Inizializza OverrulingSource.

        Args:
            graph_db: FalkorDB client
        """
        self.graph_db = graph_db

    async def collect(
        self,
        limit: Optional[int] = None,
        since: Optional[datetime] = None
    ) -> AsyncIterator[DisagreementSample]:
        """
        Raccoglie samples da relazioni SUPERA nel grafo.

        Ogni relazione diventa un sample con:
        - has_disagreement: True
        - disagreement_type: OVR
        - disagreement_level: APP (applicativo)
        """
        if self.graph_db is None:
            log.warning("Graph database non configurato")
            return

        try:
            # Query per trovare relazioni di overruling
            cypher = """
                MATCH (new:Sentenza)-[r:SUPERA]->(old:Sentenza)
                RETURN
                    new.URN as new_urn,
                    new.massima as new_massima,
                    new.data as new_data,
                    old.URN as old_urn,
                    old.massima as old_massima,
                    old.data as old_data,
                    r.motivazione as motivazione
                ORDER BY new.data DESC
            """

            if limit:
                cypher += f" LIMIT {limit}"

            results = await self.graph_db.query(cypher)

            for row in results:
                sample = self._row_to_sample(row)
                if sample:
                    yield sample

        except Exception as e:
            log.error(f"Errore raccolta overruling: {e}")

    def _row_to_sample(self, row: Dict[str, Any]) -> Optional[DisagreementSample]:
        """Converte una relazione overruling in DisagreementSample."""
        try:
            new_massima = row.get("new_massima", "")
            old_massima = row.get("old_massima", "")

            if not new_massima or not old_massima:
                return None

            # Costruisci expert responses simulati
            # L'overruling crea disagreement tra precedent vecchio e nuovo
            expert_responses = {
                "precedent": ExpertResponseData(
                    expert_type="precedent",
                    interpretation=f"Orientamento attuale: {new_massima}",
                    confidence=0.9,
                    sources_cited=[row.get("new_urn", "")],
                    reasoning_pattern="precedent_current",
                ),
                "literal": ExpertResponseData(
                    expert_type="literal",
                    interpretation=f"Orientamento precedente: {old_massima}",
                    confidence=0.7,
                    sources_cited=[row.get("old_urn", "")],
                    reasoning_pattern="precedent_overruled",
                ),
            }

            # Query sintetica basata sulla massima
            query = f"Quale orientamento giurisprudenziale si applica? Riferimento: {old_massima[:100]}..."

            return DisagreementSample(
                sample_id=f"ovr_{row.get('new_urn', '')}_{row.get('old_urn', '')}",
                query=query,
                expert_responses=expert_responses,
                has_disagreement=True,
                disagreement_type=DisagreementType.OVERRULING,
                disagreement_level=DisagreementLevel.APPLICATIVE,
                intensity=1.0,  # Overruling e' sempre massima intensita'
                resolvability=0.9,  # Alta: il nuovo prevale
                conflicting_pairs=[("precedent", "literal")],
                explanation=row.get("motivazione", "Orientamento giurisprudenziale superato"),
                source="overruling",
                legal_domain="giurisprudenza",
            )

        except Exception as e:
            log.debug(f"Errore conversione overruling: {e}")
            return None

    async def count(self) -> int:
        """Conta relazioni overruling nel grafo."""
        if self.graph_db is None:
            return 0

        try:
            result = await self.graph_db.query(
                "MATCH ()-[r:SUPERA]->() RETURN COUNT(r) as count"
            )
            return result[0]["count"] if result else 0
        except Exception as e:
            log.warning("count_query_failed", error=str(e))
            return 0


# =============================================================================
# SYNTHETIC SOURCE
# =============================================================================

class SyntheticSource(DataSource):
    """
    Fonte dati generati sinteticamente con LLM.

    Genera esempi di disagreement controllati per:
    - Bilanciare classi sotto-rappresentate
    - Creare casi edge
    - Aumentare diversity

    Quality: Bronze (richiede validazione)
    """

    name = "synthetic"
    quality_tier = "bronze"

    def __init__(
        self,
        ai_service: Any = None,
        templates_path: Optional[str] = None
    ):
        """
        Inizializza SyntheticSource.

        Args:
            ai_service: AIService per generazione (lazy init se None)
            templates_path: Path a file YAML con template
        """
        self.ai_service = ai_service
        self.templates_path = templates_path
        self._templates = None

    async def collect(
        self,
        limit: Optional[int] = None,
        since: Optional[datetime] = None
    ) -> AsyncIterator[DisagreementSample]:
        """
        Genera samples sintetici.

        Per ora placeholder - implementazione completa richiede
        definizione dei template di generazione.
        """
        log.info("SyntheticSource: generazione non ancora implementata")
        return
        yield  # Make it a generator

    async def count(self) -> int:
        """Synthetic source non ha count fisso."""
        return 0

    async def generate_for_type(
        self,
        disagreement_type: DisagreementType,
        count: int = 10
    ) -> List[DisagreementSample]:
        """
        Genera samples per un tipo specifico di disagreement.

        Utile per bilanciare classi sotto-rappresentate.

        Args:
            disagreement_type: Tipo da generare
            count: Numero di samples

        Returns:
            Lista di DisagreementSample generati
        """
        # TODO: Implementare con template + LLM
        log.warning(f"generate_for_type({disagreement_type}) non implementato")
        return []


# =============================================================================
# MAIN COLLECTOR
# =============================================================================

@dataclass
class CollectionStats:
    """Statistiche raccolta dati."""
    total_samples: int
    by_source: Dict[str, int]
    by_type: Dict[str, int]
    by_quality: Dict[str, int]
    collection_time_seconds: float


class DisagreementDataCollector:
    """
    Collector principale che aggrega tutte le fonti.

    Esempio:
        >>> collector = DisagreementDataCollector(
        ...     rlcf_db=rlcf_database,
        ...     graph_db=falkordb_client
        ... )
        >>> samples = await collector.collect_all(limit=1000)
        >>> stats = collector.get_stats()
        >>> print(f"Raccolti {stats.total_samples} samples")
    """

    def __init__(
        self,
        rlcf_db: Any = None,
        graph_db: Any = None,
        ai_service: Any = None,
        sources: Optional[List[DataSource]] = None
    ):
        """
        Inizializza collector con le fonti disponibili.

        Args:
            rlcf_db: Database RLCF
            graph_db: FalkorDB client
            ai_service: AIService per synthetic
            sources: Lista custom di DataSource (override default)
        """
        if sources:
            self.sources = sources
        else:
            self.sources = []

            if rlcf_db:
                self.sources.append(RLCFSource(rlcf_db=rlcf_db))

            if graph_db:
                self.sources.append(OverrulingSource(graph_db=graph_db))

            if ai_service:
                self.sources.append(SyntheticSource(ai_service=ai_service))

        self._collected_samples: List[DisagreementSample] = []
        self._stats: Optional[CollectionStats] = None

    async def collect_all(
        self,
        limit: Optional[int] = None,
        since: Optional[datetime] = None,
        sources: Optional[List[str]] = None
    ) -> List[DisagreementSample]:
        """
        Raccoglie samples da tutte le fonti configurate.

        Args:
            limit: Limite totale samples
            since: Solo samples dopo questa data
            sources: Lista nomi fonti da usare (default: tutte)

        Returns:
            Lista di DisagreementSample
        """
        import time
        start_time = time.time()

        self._collected_samples = []
        by_source: Dict[str, int] = {}
        by_type: Dict[str, int] = {}
        by_quality: Dict[str, int] = {}

        # Filtra fonti se specificato
        active_sources = self.sources
        if sources:
            active_sources = [s for s in self.sources if s.name in sources]

        # Calcola limit per source (distribuzione equa)
        per_source_limit = None
        if limit and active_sources:
            per_source_limit = limit // len(active_sources) + 1

        for source in active_sources:
            source_count = 0

            try:
                async for sample in source.collect(
                    limit=per_source_limit,
                    since=since
                ):
                    self._collected_samples.append(sample)
                    source_count += 1

                    # Track by type
                    type_key = sample.disagreement_type.value if sample.disagreement_type else "none"
                    by_type[type_key] = by_type.get(type_key, 0) + 1

                    # Check total limit
                    if limit and len(self._collected_samples) >= limit:
                        break

            except Exception as e:
                log.error(f"Errore raccolta da {source.name}: {e}")

            by_source[source.name] = source_count
            by_quality[source.quality_tier] = (
                by_quality.get(source.quality_tier, 0) + source_count
            )

            if limit and len(self._collected_samples) >= limit:
                break

        # Salva stats
        self._stats = CollectionStats(
            total_samples=len(self._collected_samples),
            by_source=by_source,
            by_type=by_type,
            by_quality=by_quality,
            collection_time_seconds=time.time() - start_time,
        )

        log.info(
            f"Raccolta completata: {self._stats.total_samples} samples "
            f"in {self._stats.collection_time_seconds:.2f}s"
        )

        return self._collected_samples

    async def collect_balanced(
        self,
        samples_per_type: int = 100,
        include_negatives: bool = True
    ) -> List[DisagreementSample]:
        """
        Raccoglie samples bilanciati per tipo di disagreement.

        Utile per training per evitare class imbalance.

        Args:
            samples_per_type: Numero target per ogni tipo
            include_negatives: Include samples senza disagreement

        Returns:
            Lista bilanciata di DisagreementSample
        """
        # Prima raccolta standard
        all_samples = await self.collect_all()

        # Raggruppa per tipo
        by_type: Dict[Optional[DisagreementType], List[DisagreementSample]] = {}
        for sample in all_samples:
            dtype = sample.disagreement_type
            if dtype not in by_type:
                by_type[dtype] = []
            by_type[dtype].append(sample)

        # Bilancia
        balanced = []
        for dtype, samples in by_type.items():
            if dtype is None and not include_negatives:
                continue

            # Prendi fino a samples_per_type
            selected = samples[:samples_per_type]
            balanced.extend(selected)

            log.debug(
                f"Tipo {dtype}: {len(selected)}/{len(samples)} samples"
            )

        return balanced

    def get_stats(self) -> Optional[CollectionStats]:
        """Restituisce statistiche ultima raccolta."""
        return self._stats

    async def export_to_jsonl(
        self,
        output_path: str,
        samples: Optional[List[DisagreementSample]] = None
    ):
        """
        Esporta samples in formato JSONL.

        Args:
            output_path: Path file di output
            samples: Samples da esportare (default: ultimi raccolti)
        """
        import json

        samples = samples or self._collected_samples

        with open(output_path, "w", encoding="utf-8") as f:
            for sample in samples:
                f.write(json.dumps(sample.to_dict(), ensure_ascii=False) + "\n")

        log.info(f"Esportati {len(samples)} samples in {output_path}")

    async def import_from_jsonl(self, input_path: str) -> List[DisagreementSample]:
        """
        Importa samples da file JSONL.

        Args:
            input_path: Path file da importare

        Returns:
            Lista di DisagreementSample importati
        """
        import json

        samples = []
        with open(input_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    data = json.loads(line)
                    sample = DisagreementSample.from_dict(data)
                    samples.append(sample)

        log.info(f"Importati {len(samples)} samples da {input_path}")
        return samples
