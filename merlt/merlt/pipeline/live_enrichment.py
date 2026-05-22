"""
Live Enrichment Service
=======================

Servizio per enrichment in tempo reale con validazione umana granulare.

A differenza della pipeline batch, questo servizio:
1. Processa un singolo articolo alla volta
2. NON scrive direttamente nel grafo
3. Ritorna entita'/relazioni come "pending" per validazione umana
4. Supporta feedback RLCF pesato per authority

Flusso:
    1. Scrape Normattiva (testo ufficiale)
    2. Fetch Brocardi (ratio, spiegazione, brocardo)
    3. LLM extraction (concetti, principi, definizioni)
    4. Return pending entities per validazione
"""

import asyncio
import hashlib
import structlog
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple
from uuid import uuid4

from merlt.api.models.enrichment_models import (
    ArticleData,
    GraphLinkPreview,
    GraphNodePreview,
    GraphPreviewData,
    LiveEnrichmentRequest,
    LiveEnrichmentResponse,
    PendingEntityData,
    PendingRelationData,
    ValidationStatus,
)
from merlt.pipeline.enrichment.models import (
    EnrichmentContent,
    EntityType,
    ExtractedEntity,
    ExtractedRelation,
    RelationType,
)
from merlt.pipeline.enrichment.extractors.mechanistic import (
    MechanisticExtractor,
    MechanisticExtractionResult,
)

log = structlog.get_logger()


class LiveEnrichmentService:
    """
    Servizio per live enrichment con validazione umana.

    Coordina l'estrazione di entita' e relazioni da un articolo,
    preparandole per la validazione granulare da parte degli utenti.

    Attributes:
        scraper: NormattivaScraper per fetch testo ufficiale
        brocardi_source: BrocardiSource per enrichment dottrina
        llm_service: OpenRouterService per estrazione LLM
        graph_client: FalkorDBClient per check esistenza (opzionale)

    Example:
        >>> service = LiveEnrichmentService()
        >>> response = await service.enrich(request)
        >>> for entity in response.pending_entities:
        ...     print(f"{entity.tipo}: {entity.nome}")
    """

    def __init__(
        self,
        scraper: Optional[Any] = None,
        brocardi_source: Optional[Any] = None,
        llm_service: Optional[Any] = None,
        graph_client: Optional[Any] = None,
    ):
        """
        Inizializza il servizio.

        Args:
            scraper: NormattivaScraper (creato lazy se None)
            brocardi_source: BrocardiSource (creato lazy se None)
            llm_service: OpenRouterService (creato lazy se None)
            graph_client: FalkorDBClient per check esistenza
        """
        self._scraper = scraper
        self._brocardi_source = brocardi_source
        self._llm_service = llm_service
        self._graph_client = graph_client

        # Mechanistic extractor (always available, no LLM)
        self._mechanistic_extractor = MechanisticExtractor()

        # Lazy-init LLM extractors
        self._extractors: Dict[EntityType, Any] = {}

    async def _ensure_initialized(self) -> None:
        """Inizializza componenti lazy."""
        if self._scraper is None:
            from merlt.clients import NormattivaScraper
            self._scraper = NormattivaScraper()

        if self._brocardi_source is None:
            try:
                from merlt.clients import BrocardiScraper
                self._brocardi_source = BrocardiScraper()
            except ImportError as e:
                log.warning(f"BrocardiScraper not available: {e}")

        if self._llm_service is None:
            try:
                from merlt.rlcf.ai_service import OpenRouterService
                self._llm_service = OpenRouterService()
            except ImportError:
                log.warning("OpenRouterService not available")

        if not self._extractors and self._llm_service:
            from merlt.pipeline.enrichment.extractors import create_extractor
            # Inizializza extractors per tipi core (priorita' 1)
            for entity_type in [
                EntityType.CONCETTO,
                EntityType.PRINCIPIO,
                EntityType.DEFINIZIONE,
            ]:
                try:
                    self._extractors[entity_type] = create_extractor(
                        self._llm_service, entity_type
                    )
                except Exception as e:
                    log.warning(f"Failed to create extractor for {entity_type}: {e}")

    async def enrich(
        self,
        request: LiveEnrichmentRequest,
    ) -> LiveEnrichmentResponse:
        """
        Esegue live enrichment per un articolo.

        Flusso:
        1. Scrape Normattiva (testo ufficiale)
        2. Fetch Brocardi (ratio, spiegazione, brocardo)
        3. LLM extraction (concetti, principi, definizioni)
        4. Return pending entities per validazione

        Args:
            request: LiveEnrichmentRequest con tipo_atto, articolo, user_id

        Returns:
            LiveEnrichmentResponse con article, pending_entities, pending_relations

        Raises:
            ValueError: Se articolo non trovato
        """
        start_time = datetime.now(timezone.utc)
        sources_used: List[str] = []

        await self._ensure_initialized()

        log.info(
            "Live enrichment started",
            tipo_atto=request.tipo_atto,
            articolo=request.articolo,
            user_id=request.user_id,
        )

        # 1. Usa il testo gia' fornito da VisuaLex quando disponibile; in questo modo
        # il sidecar non deve riscaricare l'articolo durante l'integrazione BFF.
        if getattr(request, "article_text", None):
            article = self._article_from_request(request)
            sources_used.append("visualex")
        else:
            article = await self._fetch_article(request.tipo_atto, request.articolo)
            sources_used.append("normattiva")

        # 2. Fetch Brocardi (se richiesto)
        brocardi_contents: List[EnrichmentContent] = []
        brocardi_info: Dict[str, Any] = {}
        if request.include_brocardi and self._brocardi_source:
            brocardi_contents, brocardi_info = await self._fetch_brocardi(
                request.tipo_atto,
                request.articolo,
            )
            if brocardi_contents:
                sources_used.append("brocardi")

        # 3. Estrai entita' con LLM (se richiesto)
        pending_entities: List[PendingEntityData] = []
        pending_relations: List[PendingRelationData] = []

        if request.extract_entities and self._extractors:
            # Prepara contenuto per estrazione
            contents = self._prepare_contents(article, brocardi_contents)

            # Estrai entita'
            extracted_entities, extracted_relations = await self._extract_all(
                contents,
                request.priority_types,
            )
            sources_used.append("llm")

            # Converti in pending
            pending_entities = self._to_pending_entities(
                extracted_entities,
                request.user_id,
                request.user_authority,
            )
            pending_relations = self._to_pending_relations(
                extracted_relations,
                request.user_id,
                request.user_authority,
            )

        # 4. Genera preview grafo
        graph_preview = self._generate_preview(
            article,
            pending_entities,
            pending_relations,
        )

        # Calcola tempo
        elapsed_ms = int(
            (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
        )

        log.info(
            "Live enrichment completed",
            entities=len(pending_entities),
            relations=len(pending_relations),
            elapsed_ms=elapsed_ms,
        )

        return LiveEnrichmentResponse(
            success=True,
            article=article,
            pending_entities=pending_entities,
            pending_relations=pending_relations,
            graph_preview=graph_preview,
            extraction_time_ms=elapsed_ms,
            sources_used=sources_used,
        )

    async def _fetch_article(
        self,
        tipo_atto: str,
        articolo: str,
    ) -> ArticleData:
        """
        Fetch articolo da Normattiva.

        Args:
            tipo_atto: Tipo atto normativo
            articolo: Numero articolo

        Returns:
            ArticleData con testo e metadata

        Raises:
            ValueError: Se articolo non trovato
        """
        from merlt.clients import Norma, NormaVisitata
        from merlt.utils import NORMATTIVA_URN_CODICI

        norma = Norma(tipo_atto=tipo_atto)
        nv = NormaVisitata(norma=norma, numero_articolo=articolo)

        try:
            text, _ = await self._scraper.get_document(nv)

            if not text:
                raise ValueError(f"Articolo {articolo} non trovato in {tipo_atto}")

            # Build URN: prefer NormaVisitata.urn, fallback to NORMATTIVA_URN_CODICI
            urn = nv.urn
            if not urn:
                codice_urn = NORMATTIVA_URN_CODICI.get(tipo_atto.lower().strip(), "")
                if codice_urn:
                    urn = f"urn:nir:stato:{codice_urn}~art{articolo}!vig="
                else:
                    urn = f"urn:nir:stato:{tipo_atto.lower().replace(' ', '.')}~art{articolo}!vig="

            return ArticleData(
                urn=urn,
                tipo_atto=tipo_atto,
                numero_articolo=articolo,
                rubrica=getattr(nv, "rubrica", ""),
                testo_vigente=text,
                estremi=getattr(norma, "estremi", ""),
                url=f"https://www.normattiva.it/uri-res/N2Ls?{urn}",
            )

        except Exception as e:
            log.error(f"Failed to fetch article: {e}")
            raise ValueError(f"Impossibile recuperare articolo: {e}")

    def _article_from_request(self, request: LiveEnrichmentRequest) -> ArticleData:
        """Build ArticleData from VisuaLex-provided text and metadata."""
        norma_data = request.norma_data or {}
        article_urn = (
            request.article_urn
            or norma_data.get("urn")
            or f"urn:nir:visualex:{request.tipo_atto.lower().replace(' ', '.')}~art{request.articolo}!vig="
        )

        return ArticleData(
            urn=article_urn,
            tipo_atto=str(norma_data.get("tipo_atto") or request.tipo_atto),
            numero_articolo=str(norma_data.get("numero_articolo") or request.articolo),
            rubrica=str(norma_data.get("rubrica") or norma_data.get("titolo") or ""),
            testo_vigente=request.article_text or "",
            estremi=str(norma_data.get("estremi") or ""),
            url=str(norma_data.get("url") or article_urn),
        )

    async def _fetch_brocardi(
        self,
        tipo_atto: str,
        articolo: str,
    ) -> Tuple[List[EnrichmentContent], Dict[str, Any]]:
        """
        Fetch contenuti Brocardi per un articolo.

        Args:
            tipo_atto: Tipo atto (es. "codice civile")
            articolo: Numero articolo

        Returns:
            Tuple (contents, raw_info):
            - contents: Lista di EnrichmentContent da Brocardi
            - raw_info: Dict originale con Massime, Spiegazione, etc. (per meccanistico)
        """
        if not self._brocardi_source:
            return [], {}

        try:
            from merlt.clients import Norma, NormaVisitata

            norma = Norma(tipo_atto=tipo_atto)
            nv = NormaVisitata(norma=norma, numero_articolo=articolo)

            position, info, url = await self._brocardi_source.get_info(nv)

            if not info:
                log.debug(f"No Brocardi info for {tipo_atto} art. {articolo}")
                return [], {}

            contents = []
            article_ref = f"{tipo_atto}~art{articolo}"

            # Spiegazione
            if info.get("Spiegazione"):
                contents.append(EnrichmentContent(
                    id=f"brocardi:spiegazione:{article_ref}",
                    text=info["Spiegazione"],
                    article_refs=[article_ref],
                    source="brocardi",
                    content_type="spiegazione",
                ))

            # Ratio legis
            if info.get("Ratio"):
                contents.append(EnrichmentContent(
                    id=f"brocardi:ratio:{article_ref}",
                    text=info["Ratio"],
                    article_refs=[article_ref],
                    source="brocardi",
                    content_type="ratio",
                ))

            # Brocardo
            if info.get("Brocardi"):
                contents.append(EnrichmentContent(
                    id=f"brocardi:brocardo:{article_ref}",
                    text=info["Brocardi"],
                    article_refs=[article_ref],
                    source="brocardi",
                    content_type="brocardo",
                ))

            # Massime
            if info.get("Massime"):
                for i, massima in enumerate(info["Massime"]):
                    if isinstance(massima, dict):
                        text = massima.get("text", str(massima))
                    else:
                        text = str(massima)
                    contents.append(EnrichmentContent(
                        id=f"brocardi:massima:{article_ref}:{i}",
                        text=text,
                        article_refs=[article_ref],
                        source="brocardi",
                        content_type="massima",
                    ))

            log.info(f"Fetched {len(contents)} Brocardi contents for {tipo_atto} art. {articolo}")
            return contents, info

        except Exception as e:
            log.warning(f"Failed to fetch Brocardi: {e}")
            return [], {}

    def _prepare_contents(
        self,
        article: ArticleData,
        brocardi_contents: List[EnrichmentContent],
    ) -> List[EnrichmentContent]:
        """
        Prepara contenuti per estrazione LLM.

        Combina testo articolo con contenuti Brocardi.

        Args:
            article: Dati articolo
            brocardi_contents: Contenuti Brocardi

        Returns:
            Lista di EnrichmentContent pronti per estrazione
        """
        contents = []

        # Aggiungi testo articolo come contenuto principale
        article_content = EnrichmentContent(
            id=f"article:{article.urn}",
            text=article.testo_vigente,
            article_refs=[article.urn],
            source="normattiva",
            content_type="testo_vigente",
        )
        contents.append(article_content)

        # Aggiungi contenuti Brocardi
        contents.extend(brocardi_contents)

        return contents

    async def _extract_all(
        self,
        contents: List[EnrichmentContent],
        priority_types: Optional[List[EntityType]] = None,
    ) -> Tuple[List[ExtractedEntity], List[ExtractedRelation]]:
        """
        Estrai entita' e relazioni da tutti i contenuti.

        Args:
            contents: Lista di contenuti da processare
            priority_types: Tipi entita' prioritari (None = tutti)

        Returns:
            Tuple (entities, relations)
        """
        all_entities: List[ExtractedEntity] = []
        all_relations: List[ExtractedRelation] = []

        # Filtra extractors per priority
        extractors = self._extractors
        if priority_types:
            extractors = {
                k: v for k, v in extractors.items()
                if k in priority_types
            }

        # Processa ogni contenuto
        for content in contents:
            # Esegui extractors in parallelo
            tasks = [
                extractor.extract(content)
                for extractor in extractors.values()
            ]

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                if isinstance(result, Exception):
                    log.warning(f"Extractor error: {result}")
                    continue

                if isinstance(result, list):
                    for item in result:
                        if isinstance(item, ExtractedEntity):
                            all_entities.append(item)
                        elif isinstance(item, ExtractedRelation):
                            all_relations.append(item)

        # Generate relations between entities if we have multiple entities
        if len(all_entities) >= 2:
            generated_relations = self._generate_entity_relations(all_entities, contents)
            all_relations.extend(generated_relations)

        return all_entities, all_relations

    async def extract_streaming(
        self,
        request: LiveEnrichmentRequest,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Estrae entità in streaming, yielding ogni entità appena estratta.

        Usato per SSE (Server-Sent Events) per UX migliore.

        Yields:
            Dict con tipo evento e dati:
            - {"type": "start", "article": ArticleData}
            - {"type": "entity", "entity": PendingEntityData}
            - {"type": "relation", "relation": PendingRelationData}
            - {"type": "complete", "summary": {...}}
            - {"type": "error", "message": str}
        """
        from typing import AsyncGenerator

        start_time = datetime.now(timezone.utc)
        sources_used: List[str] = []
        all_entities: List[ExtractedEntity] = []

        await self._ensure_initialized()

        log.info(
            "Streaming enrichment started",
            tipo_atto=request.tipo_atto,
            articolo=request.articolo,
        )

        try:
            # 1. Fetch articolo
            article = await self._fetch_article(request.tipo_atto, request.articolo)
            sources_used.append("normattiva")

            # Yield article info
            yield {
                "type": "start",
                "article": {
                    "urn": article.urn,
                    "tipo_atto": article.tipo_atto,
                    "numero_articolo": article.numero_articolo,
                    "rubrica": article.rubrica,
                },
            }

            # 2. Fetch Brocardi
            brocardi_contents: List[EnrichmentContent] = []
            brocardi_info: Dict[str, Any] = {}
            if request.include_brocardi and self._brocardi_source:
                brocardi_contents, brocardi_info = await self._fetch_brocardi(
                    request.tipo_atto,
                    request.articolo,
                )
                if brocardi_contents:
                    sources_used.append("brocardi")
                    yield {"type": "progress", "message": f"Brocardi: {len(brocardi_contents)} contenuti"}

            # 3. Prepara contenuti
            contents = self._prepare_contents(article, brocardi_contents)

            # 3.5 ESTRAZIONE MECCANICISTICA (PRIMA di LLM - zero costi API)
            # Estrae ATTO_GIUDIZIARIO (massime), BROCARDO (massime latine), CITA (cross-refs)
            mechanistic_entities: List[ExtractedEntity] = []
            mechanistic_relations: List[ExtractedRelation] = []

            if brocardi_info:
                yield {"type": "progress", "message": "Estrazione meccanicistica..."}

                mech_result = self._mechanistic_extractor.extract_all(
                    brocardi_info=brocardi_info,
                    article_urn=article.urn,
                    article_text=article.testo_vigente,
                )

                sources_used.append("mechanistic")
                mechanistic_entities = mech_result.entities
                mechanistic_relations = mech_result.relations

                # Yield entità meccanicistiche immediatamente
                for entity in mechanistic_entities:
                    all_entities.append(entity)

                    pending = self._to_pending_entities(
                        [entity],
                        request.user_id,
                        request.user_authority,
                    )[0]

                    yield {
                        "type": "entity",
                        "entity": pending.model_dump(mode='json'),
                    }

                log.info(
                    f"Mechanistic extraction: {len(mechanistic_entities)} entities, "
                    f"{len(mechanistic_relations)} relations"
                )

            # 4. Estrai entità LLM - UNA ALLA VOLTA per streaming
            if request.extract_entities and self._extractors:
                sources_used.append("llm")

                for content in contents:
                    for entity_type, extractor in self._extractors.items():
                        try:
                            yield {"type": "progress", "message": f"Estrazione {entity_type.value}..."}

                            result = await extractor.extract(content)

                            if isinstance(result, list):
                                for item in result:
                                    if isinstance(item, ExtractedEntity):
                                        all_entities.append(item)

                                        # Converti e yield immediatamente
                                        pending = self._to_pending_entities(
                                            [item],
                                            request.user_id,
                                            request.user_authority,
                                        )[0]

                                        yield {
                                            "type": "entity",
                                            "entity": pending.model_dump(mode='json'),
                                        }

                        except Exception as e:
                            log.warning(f"Extractor {entity_type} error: {e}")
                            yield {"type": "warning", "message": f"Errore {entity_type.value}: {str(e)[:50]}"}

            # 5. Genera relazioni (meccanicistiche + LLM-inferred)
            all_extracted_relations: List[ExtractedRelation] = []

            # 5a. Aggiungi relazioni meccanicistiche
            all_extracted_relations.extend(mechanistic_relations)

            # 5b. Genera relazioni LLM-inferred tra entità
            if len(all_entities) >= 2:
                llm_relations = self._generate_entity_relations(all_entities, contents)
                all_extracted_relations.extend(llm_relations)

            # Converti e yield tutte le relazioni
            generated_relations: List[PendingRelationData] = []
            if all_extracted_relations:
                generated_relations = self._to_pending_relations(
                    all_extracted_relations,
                    request.user_id,
                    request.user_authority,
                )

                for rel in generated_relations:
                    yield {
                        "type": "relation",
                        "relation": rel.model_dump(mode='json'),
                    }

            # 6. Complete
            elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)

            yield {
                "type": "complete",
                "summary": {
                    "entities_count": len(all_entities),
                    "relations_count": len(generated_relations),  # Use actual count, not formula
                    "extraction_time_ms": elapsed_ms,
                    "sources_used": sources_used,
                },
            }

        except Exception as e:
            log.error(f"Streaming enrichment error: {e}", exc_info=True)
            yield {
                "type": "error",
                "message": str(e),
            }

    def _generate_entity_relations(
        self,
        entities: List[ExtractedEntity],
        contents: List[EnrichmentContent],
    ) -> List[ExtractedRelation]:
        """
        Genera relazioni tra entita' estratte basate su euristiche.

        Crea relazioni come:
        - PRINCIPIO -> CONCETTO: ESPRIME_PRINCIPIO
        - CONCETTO A -> CONCETTO B: IMPLICA (se nello stesso contesto)
        - DEFINIZIONE -> CONCETTO: DEFINISCE

        Args:
            entities: Lista di entita' estratte
            contents: Contenuti originali per contesto

        Returns:
            Lista di ExtractedRelation generate
        """
        relations: List[ExtractedRelation] = []

        # Raggruppa entita' per tipo
        by_type: Dict[EntityType, List[ExtractedEntity]] = {}
        for entity in entities:
            if entity.tipo not in by_type:
                by_type[entity.tipo] = []
            by_type[entity.tipo].append(entity)

        # Genera relazioni basate su tipi
        principi = by_type.get(EntityType.PRINCIPIO, [])
        concetti = by_type.get(EntityType.CONCETTO, [])
        definizioni = by_type.get(EntityType.DEFINIZIONE, [])

        # PRINCIPIO esprime CONCETTO
        for principio in principi:
            for concetto in concetti[:2]:  # Limita a 2 relazioni
                relations.append(ExtractedRelation(
                    source_id=f"entity:{principio.nome.lower().replace(' ', '_')}",
                    target_id=f"entity:{concetto.nome.lower().replace(' ', '_')}",
                    relation_type=RelationType.ESPRIME_PRINCIPIO,
                    fonte="llm_inference",
                    confidence=0.7,
                ))

        # DEFINIZIONE definisce CONCETTO
        for definizione in definizioni:
            for concetto in concetti[:2]:
                relations.append(ExtractedRelation(
                    source_id=f"entity:{definizione.nome.lower().replace(' ', '_')}",
                    target_id=f"entity:{concetto.nome.lower().replace(' ', '_')}",
                    relation_type=RelationType.DEFINISCE,
                    fonte="llm_inference",
                    confidence=0.75,
                ))

        # CONCETTO implica altro CONCETTO (se >= 2 concetti)
        if len(concetti) >= 2:
            for i, c1 in enumerate(concetti[:-1]):
                for c2 in concetti[i + 1:min(i + 2, len(concetti))]:
                    relations.append(ExtractedRelation(
                        source_id=f"entity:{c1.nome.lower().replace(' ', '_')}",
                        target_id=f"entity:{c2.nome.lower().replace(' ', '_')}",
                        relation_type=RelationType.IMPLICA,
                        fonte="llm_inference",
                        confidence=0.6,
                    ))

        # PRINCIPIO correlato a altro PRINCIPIO (se >= 2 principi e nessun concetto)
        if len(principi) >= 2 and len(concetti) == 0:
            for i, p1 in enumerate(principi[:-1]):
                for p2 in principi[i + 1:min(i + 2, len(principi))]:
                    relations.append(ExtractedRelation(
                        source_id=f"entity:{p1.nome.lower().replace(' ', '_')}",
                        target_id=f"entity:{p2.nome.lower().replace(' ', '_')}",
                        relation_type=RelationType.CORRELATO,
                        fonte="llm_inference",
                        confidence=0.5,
                    ))

        log.info(f"Generated {len(relations)} relations from {len(entities)} entities")
        return relations

    def _to_pending_entities(
        self,
        entities: List[ExtractedEntity],
        user_id: str,
        user_authority: float,
    ) -> List[PendingEntityData]:
        """
        Converti ExtractedEntity in PendingEntityData.

        Args:
            entities: Entita' estratte
            user_id: ID utente contributor
            user_authority: Authority utente

        Returns:
            Lista di PendingEntityData
        """
        pending = []

        for entity in entities:
            # Genera ID univoco per pending
            entity_id = f"pending:{uuid4().hex[:12]}"

            # Ensure raw_context is a string (LLM may return a list)
            raw_context = entity.raw_context
            if isinstance(raw_context, list):
                raw_context = " ".join(str(item) for item in raw_context)
            elif not isinstance(raw_context, str):
                raw_context = str(raw_context) if raw_context else ""

            pending.append(PendingEntityData(
                id=entity_id,
                nome=entity.nome,
                tipo=entity.tipo,
                descrizione=entity.descrizione,
                articoli_correlati=entity.articoli_correlati,
                ambito=entity.ambito,
                fonte=entity.fonte or "llm",
                llm_confidence=entity.confidence,
                raw_context=raw_context,
                validation_status=ValidationStatus.PENDING,
                approval_score=0.0,
                rejection_score=0.0,
                votes_count=0,
                contributed_by=user_id,
                contributor_authority=user_authority,
            ))

        return pending

    def _to_pending_relations(
        self,
        relations: List[ExtractedRelation],
        user_id: str,
        user_authority: float,
    ) -> List[PendingRelationData]:
        """
        Converti ExtractedRelation in PendingRelationData.

        Args:
            relations: Relazioni estratte
            user_id: ID utente contributor
            user_authority: Authority utente

        Returns:
            Lista di PendingRelationData
        """
        pending = []

        for relation in relations:
            relation_id = f"pending:{uuid4().hex[:12]}"

            pending.append(PendingRelationData(
                id=relation_id,
                source_urn=relation.source_id,
                target_urn=relation.target_id,
                relation_type=relation.relation_type,
                fonte=relation.fonte or "llm",
                llm_confidence=relation.confidence,
                evidence="",  # TODO: estrarre evidenza dal contesto
                validation_status=ValidationStatus.PENDING,
                approval_score=0.0,
                rejection_score=0.0,
                votes_count=0,
                contributed_by=user_id,
                contributor_authority=user_authority,
            ))

        return pending

    def _generate_preview(
        self,
        article: ArticleData,
        entities: List[PendingEntityData],
        relations: List[PendingRelationData],
    ) -> GraphPreviewData:
        """
        Genera preview del grafo per visualizzazione D3.js.

        Args:
            article: Articolo centrale
            entities: Entita' pending
            relations: Relazioni pending

        Returns:
            GraphPreviewData con nodes e links
        """
        nodes: List[GraphNodePreview] = []
        links: List[GraphLinkPreview] = []

        # Nodo articolo (centrale, gia' approvato)
        nodes.append(GraphNodePreview(
            id=article.urn,
            label=f"Art. {article.numero_articolo}",
            type="ARTICOLO",
            status=ValidationStatus.APPROVED,
            confidence=1.0,
        ))

        # Nodi entita'
        for entity in entities:
            nodes.append(GraphNodePreview(
                id=entity.id,
                label=entity.nome,
                type=entity.tipo.value,
                status=entity.validation_status,
                confidence=entity.llm_confidence,
            ))

            # Link implicito Articolo -> Entita' (DISCIPLINA)
            links.append(GraphLinkPreview(
                source=article.urn,
                target=entity.id,
                type="DISCIPLINA",
                status=entity.validation_status,
            ))

        # Links da relazioni esplicite
        for relation in relations:
            links.append(GraphLinkPreview(
                source=relation.source_urn,
                target=relation.target_urn,
                type=relation.relation_type.value,
                status=relation.validation_status,
            ))

        return GraphPreviewData(nodes=nodes, links=links)


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = ["LiveEnrichmentService"]
