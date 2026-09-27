"""
Entity & Relation Deduplication Module
======================================

Fase 1: Fuzzy Matching + Normalizzazione

Strategie:
1. Normalizzazione testo (lowercase, rimozione stop words, sorting)
2. Fuzzy matching con Levenshtein/Jaro-Winkler
3. Exact match su nome normalizzato + tipo

Usage:
    from merlt.storage.enrichment.deduplication import EntityDeduplicator

    dedup = EntityDeduplicator()
    result = await dedup.find_duplicates(
        entity_text="Principio di buona fede",
        entity_type="principio",
        article_urn="urn:nir:stato:..."
    )

    if result.has_duplicates:
        # Mostra duplicati all'utente
        for dup in result.duplicates:
            print(f"Possibile duplicato: {dup.entity_text} (score: {dup.similarity_score})")
"""

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import List, Optional, Tuple
from enum import Enum

import structlog
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.storage.enrichment.models import PendingEntity, PendingRelation

log = structlog.get_logger()


# =============================================================================
# CONSTANTS
# =============================================================================

# Stop words giuridiche italiane da rimuovere per normalizzazione
LEGAL_STOP_WORDS = {
    # Articoli
    "il", "lo", "la", "i", "gli", "le", "l",
    # Preposizioni
    "di", "del", "della", "dello", "dei", "degli", "delle",
    "a", "al", "alla", "allo", "ai", "agli", "alle",
    "da", "dal", "dalla", "dallo", "dai", "dagli", "dalle",
    "in", "nel", "nella", "nello", "nei", "negli", "nelle",
    "su", "sul", "sulla", "sullo", "sui", "sugli", "sulle",
    "con", "per", "tra", "fra",
    # Congiunzioni
    "e", "ed", "o", "od", "ma", "che",
    # Termini generici giuridici (troppo comuni)
    "principio", "concetto", "nozione", "istituto", "figura",
    "diritto", "obbligo", "dovere",
}

# Soglie di similarità - CONSERVATIVE per evitare falsi positivi
# Nel dominio giuridico, "buona fede" vs "buona fede oggettiva" sono DIVERSI
EXACT_MATCH_THRESHOLD = 1.0
HIGH_SIMILARITY_THRESHOLD = 0.95  # Quasi identici (typo, plurale/singolare)
MEDIUM_SIMILARITY_THRESHOLD = 0.88  # Molto simili ma chiedi conferma
LOW_SIMILARITY_THRESHOLD = 0.80  # Potenzialmente correlati - solo warning informativo


# =============================================================================
# DATA CLASSES
# =============================================================================

class DuplicateConfidence(str, Enum):
    """Livello di confidenza nella rilevazione duplicato."""
    EXACT = "exact"  # Match esatto dopo normalizzazione (identici)
    HIGH = "high"  # Score >= 0.95, quasi certamente duplicato (typo, variante minima)
    MEDIUM = "medium"  # Score 0.88-0.95, probabile duplicato ma verifica
    LOW = "low"  # Score 0.80-0.88, potenzialmente correlato (solo informativo)


@dataclass
class DuplicateCandidate:
    """Un candidato duplicato trovato."""
    entity_id: str
    entity_text: str
    entity_type: str
    descrizione: Optional[str]
    article_urn: str
    similarity_score: float
    confidence: DuplicateConfidence
    match_reason: str  # "exact_normalized", "fuzzy_name", "fuzzy_description"
    validation_status: str = "pending"
    votes_count: int = 0
    net_score: float = 0.0


@dataclass
class DeduplicationResult:
    """Risultato della ricerca duplicati."""
    query_text: str
    query_type: str
    normalized_query: str
    has_duplicates: bool = False
    exact_match: Optional[DuplicateCandidate] = None
    duplicates: List[DuplicateCandidate] = field(default_factory=list)
    recommendation: str = "create"  # "create", "merge", "ask_user"

    @property
    def best_match(self) -> Optional[DuplicateCandidate]:
        """Ritorna il miglior match se esiste."""
        if self.exact_match:
            return self.exact_match
        if self.duplicates:
            return max(self.duplicates, key=lambda x: x.similarity_score)
        return None


@dataclass
class RelationDuplicateCandidate:
    """Un candidato duplicato per relazioni."""
    relation_id: str
    source_text: str
    target_text: str
    relation_type: str
    similarity_score: float
    confidence: DuplicateConfidence
    validation_status: str = "pending"


@dataclass
class RelationDeduplicationResult:
    """Risultato della ricerca duplicati per relazioni."""
    has_duplicates: bool = False
    exact_match: Optional[RelationDuplicateCandidate] = None
    duplicates: List[RelationDuplicateCandidate] = field(default_factory=list)
    recommendation: str = "create"


# =============================================================================
# TEXT NORMALIZATION
# =============================================================================

def normalize_text(text: str, remove_stop_words: bool = True) -> str:
    """
    Normalizza testo per confronto.

    Steps:
    1. Lowercase
    2. Rimuovi accenti
    3. Rimuovi punteggiatura
    4. Rimuovi stop words (opzionale)
    5. Ordina token alfabeticamente (per match indipendente dall'ordine)

    Examples:
        "Principio di buona fede" → "buona fede"
        "Buona fede oggettiva" → "buona fede oggettiva"
        "La responsabilità precontrattuale" → "precontrattuale responsabilita"
    """
    if not text:
        return ""

    # Lowercase
    text = text.lower().strip()

    # Rimuovi accenti (à → a, è → e, etc.)
    text = unicodedata.normalize('NFD', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')

    # Rimuovi punteggiatura
    text = re.sub(r'[^\w\s]', ' ', text)

    # Tokenizza
    tokens = text.split()

    # Rimuovi stop words
    if remove_stop_words:
        tokens = [t for t in tokens if t not in LEGAL_STOP_WORDS and len(t) > 1]

    # Ordina alfabeticamente (per match order-independent)
    tokens = sorted(tokens)

    return ' '.join(tokens)


def normalize_for_exact_match(text: str) -> str:
    """
    Normalizzazione più aggressiva per exact match.
    Rimuove tutte le stop words e ordina.
    """
    return normalize_text(text, remove_stop_words=True)


def normalize_for_fuzzy_match(text: str) -> str:
    """
    Normalizzazione leggera per fuzzy match.
    Mantiene più contesto ma standardizza formato.
    """
    return normalize_text(text, remove_stop_words=False)


# =============================================================================
# SIMILARITY FUNCTIONS
# =============================================================================

def calculate_similarity(text1: str, text2: str) -> float:
    """
    Calcola similarità tra due stringhe usando SequenceMatcher.

    Returns:
        Float tra 0.0 e 1.0
    """
    if not text1 or not text2:
        return 0.0

    # Usa SequenceMatcher (simile a Levenshtein ma più veloce)
    return SequenceMatcher(None, text1, text2).ratio()


def calculate_token_overlap(text1: str, text2: str) -> float:
    """
    Calcola overlap tra token delle due stringhe (Jaccard similarity).

    Returns:
        Float tra 0.0 e 1.0
    """
    if not text1 or not text2:
        return 0.0

    tokens1 = set(text1.split())
    tokens2 = set(text2.split())

    if not tokens1 or not tokens2:
        return 0.0

    intersection = tokens1 & tokens2
    union = tokens1 | tokens2

    return len(intersection) / len(union)


def combined_similarity(text1: str, text2: str) -> float:
    """
    Combina multiple metriche di similarità.

    Weights:
    - 60% SequenceMatcher (cattura ordine e substring)
    - 40% Token overlap (cattura contenuto indipendente dall'ordine)
    """
    seq_sim = calculate_similarity(text1, text2)
    token_sim = calculate_token_overlap(text1, text2)

    return 0.6 * seq_sim + 0.4 * token_sim


# =============================================================================
# ENTITY DEDUPLICATOR
# =============================================================================

class EntityDeduplicator:
    """
    Classe principale per deduplicazione entità.

    Usage:
        async with get_db_session() as session:
            dedup = EntityDeduplicator(session)
            result = await dedup.find_duplicates("Buona fede", "concetto")
    """

    def __init__(self, session: AsyncSession):
        self.session = session

    async def find_duplicates(
        self,
        entity_text: str,
        entity_type: str,
        article_urn: Optional[str] = None,
        scope: str = "global",  # "global", "article", "type"
        limit: int = 10,
    ) -> DeduplicationResult:
        """
        Cerca duplicati per un'entità.

        Args:
            entity_text: Nome/testo dell'entità
            entity_type: Tipo (concetto, principio, etc.)
            article_urn: URN articolo (per scope="article")
            scope: Ambito ricerca
                - "global": Tutte le entità
                - "article": Solo stesso articolo
                - "type": Solo stesso tipo
            limit: Max risultati

        Returns:
            DeduplicationResult con duplicati trovati
        """
        normalized = normalize_for_exact_match(entity_text)

        result = DeduplicationResult(
            query_text=entity_text,
            query_type=entity_type,
            normalized_query=normalized,
        )

        # Build query
        query = select(PendingEntity)

        # Escludi entità già rifiutate
        query = query.where(PendingEntity.validation_status != "rejected")

        # Scope filtering
        if scope == "article" and article_urn:
            query = query.where(PendingEntity.article_urn == article_urn)
        elif scope == "type":
            query = query.where(PendingEntity.entity_type == entity_type)

        # Limita risultati
        query = query.limit(500)  # Max da analizzare

        # Execute
        db_result = await self.session.execute(query)
        existing_entities = db_result.scalars().all()

        if not existing_entities:
            result.recommendation = "create"
            return result

        # Cerca duplicati
        candidates: List[DuplicateCandidate] = []

        for entity in existing_entities:
            candidate = self._compare_entity(
                entity_text=entity_text,
                entity_type=entity_type,
                normalized=normalized,
                existing=entity,
            )

            if candidate:
                candidates.append(candidate)

        # Ordina per similarità
        candidates.sort(key=lambda x: x.similarity_score, reverse=True)

        # Prendi top results
        candidates = candidates[:limit]

        # Analizza risultati
        if candidates:
            result.has_duplicates = True

            # Check for exact match
            exact_matches = [c for c in candidates if c.confidence == DuplicateConfidence.EXACT]
            if exact_matches:
                result.exact_match = exact_matches[0]
                result.recommendation = "merge"
            elif candidates[0].confidence == DuplicateConfidence.HIGH:
                result.recommendation = "ask_user"
            else:
                result.recommendation = "ask_user"

            result.duplicates = candidates
        else:
            result.recommendation = "create"

        log.debug(
            "Deduplication result",
            query=entity_text,
            normalized=normalized,
            duplicates_found=len(candidates),
            recommendation=result.recommendation,
        )

        return result

    def _compare_entity(
        self,
        entity_text: str,
        entity_type: str,
        normalized: str,
        existing: PendingEntity,
    ) -> Optional[DuplicateCandidate]:
        """Confronta con un'entità esistente."""

        existing_normalized = normalize_for_exact_match(existing.entity_text)

        # 1. Exact match su normalizzato
        if normalized == existing_normalized:
            return DuplicateCandidate(
                entity_id=existing.entity_id,
                entity_text=existing.entity_text,
                entity_type=existing.entity_type,
                descrizione=existing.descrizione,
                article_urn=existing.article_urn,
                similarity_score=1.0,
                confidence=DuplicateConfidence.EXACT,
                match_reason="exact_normalized",
                validation_status=existing.validation_status,
                votes_count=existing.votes_count,
                net_score=existing.net_score,
            )

        # 2. Fuzzy match su nome
        name_similarity = combined_similarity(normalized, existing_normalized)

        # 3. Fuzzy match su descrizione (se presente)
        desc_similarity = 0.0
        if existing.descrizione:
            existing_desc_norm = normalize_for_fuzzy_match(existing.descrizione)
            query_desc_norm = normalize_for_fuzzy_match(entity_text)
            desc_similarity = combined_similarity(query_desc_norm, existing_desc_norm)

        # Combina scores (nome più importante)
        final_score = max(name_similarity, desc_similarity * 0.8)

        # Bonus se stesso tipo
        if entity_type == existing.entity_type:
            final_score = min(1.0, final_score * 1.1)

        # Determina confidence
        if final_score >= HIGH_SIMILARITY_THRESHOLD:
            confidence = DuplicateConfidence.HIGH
        elif final_score >= MEDIUM_SIMILARITY_THRESHOLD:
            confidence = DuplicateConfidence.MEDIUM
        elif final_score >= LOW_SIMILARITY_THRESHOLD:
            confidence = DuplicateConfidence.LOW
        else:
            return None  # Troppo diverso

        match_reason = "fuzzy_name" if name_similarity >= desc_similarity else "fuzzy_description"

        return DuplicateCandidate(
            entity_id=existing.entity_id,
            entity_text=existing.entity_text,
            entity_type=existing.entity_type,
            descrizione=existing.descrizione,
            article_urn=existing.article_urn,
            similarity_score=round(final_score, 3),
            confidence=confidence,
            match_reason=match_reason,
            validation_status=existing.validation_status,
            votes_count=existing.votes_count,
            net_score=existing.net_score,
        )


# =============================================================================
# RELATION DEDUPLICATOR
# =============================================================================

class RelationDeduplicator:
    """
    Deduplicazione per relazioni.

    Una relazione è duplicata se:
    1. Stesso tipo di relazione
    2. Source e target sono gli stessi (o molto simili)
    """

    def __init__(self, session: AsyncSession):
        self.session = session

    async def find_duplicates(
        self,
        source_entity_id: str,
        target_entity_id: str,
        relation_type: str,
        limit: int = 5,
    ) -> RelationDeduplicationResult:
        """
        Cerca relazioni duplicate.

        Args:
            source_entity_id: ID entità sorgente
            target_entity_id: ID entità target
            relation_type: Tipo relazione
            limit: Max risultati

        Returns:
            RelationDeduplicationResult
        """
        result = RelationDeduplicationResult()

        # Cerca relazioni con stesso tipo e stesse entità
        query = select(PendingRelation).where(
            PendingRelation.relation_type == relation_type,
            PendingRelation.validation_status != "rejected",
            or_(
                # Stessa direzione
                (PendingRelation.source_entity_id == source_entity_id) &
                (PendingRelation.target_entity_id == target_entity_id),
                # Direzione opposta (per relazioni simmetriche)
                (PendingRelation.source_entity_id == target_entity_id) &
                (PendingRelation.target_entity_id == source_entity_id),
            )
        ).limit(limit)

        db_result = await self.session.execute(query)
        existing = db_result.scalars().all()

        if existing:
            result.has_duplicates = True
            result.recommendation = "merge"

            for rel in existing:
                is_exact = (
                    rel.source_entity_id == source_entity_id and
                    rel.target_entity_id == target_entity_id
                )

                candidate = RelationDuplicateCandidate(
                    relation_id=rel.relation_id,
                    source_text=rel.source_entity_id,  # TODO: fetch actual text
                    target_text=rel.target_entity_id,
                    relation_type=rel.relation_type,
                    similarity_score=1.0 if is_exact else 0.95,
                    confidence=DuplicateConfidence.EXACT if is_exact else DuplicateConfidence.HIGH,
                    validation_status=rel.validation_status,
                )

                if is_exact and not result.exact_match:
                    result.exact_match = candidate

                result.duplicates.append(candidate)

        return result


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

async def check_entity_duplicate(
    session: AsyncSession,
    entity_text: str,
    entity_type: str,
    article_urn: Optional[str] = None,
) -> DeduplicationResult:
    """
    Funzione convenience per check duplicati entità.

    Usage:
        async with get_db_session() as session:
            result = await check_entity_duplicate(
                session, "Buona fede", "concetto"
            )
    """
    dedup = EntityDeduplicator(session)
    return await dedup.find_duplicates(
        entity_text=entity_text,
        entity_type=entity_type,
        article_urn=article_urn,
    )


async def check_relation_duplicate(
    session: AsyncSession,
    source_entity_id: str,
    target_entity_id: str,
    relation_type: str,
) -> RelationDeduplicationResult:
    """
    Funzione convenience per check duplicati relazione.
    """
    dedup = RelationDeduplicator(session)
    return await dedup.find_duplicates(
        source_entity_id=source_entity_id,
        target_entity_id=target_entity_id,
        relation_type=relation_type,
    )


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    # Classes
    "EntityDeduplicator",
    "RelationDeduplicator",
    # Data classes
    "DeduplicationResult",
    "DuplicateCandidate",
    "DuplicateConfidence",
    "RelationDeduplicationResult",
    "RelationDuplicateCandidate",
    # Functions
    "check_entity_duplicate",
    "check_relation_duplicate",
    "normalize_text",
    "normalize_for_exact_match",
    "calculate_similarity",
]
