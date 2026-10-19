"""
Edit Merge Algorithm with Authority Weighting
==============================================

Algoritmo per aggregare le proposte di modifica (edit votes) pesandole per l'authority
degli utenti. Quando viene raggiunto il consenso, applica automaticamente le modifiche
più supportate dalla community.

Workflow:
1. Raccogli tutti i voti "edit" per un'entità/relazione
2. Per ogni campo modificato, aggrega i valori proposti pesandoli per authority
3. Seleziona il valore con il peso maggiore per ogni campo
4. Applica le modifiche quando il consenso è raggiunto (approval_score >= threshold)

Metriche:
- Campo modificato se: sum(authority * 1) per quel valore >= 0.5 del totale authority votes
- Se multiple proposte per stesso campo con valori diversi: vince quella con più authority
"""

import json
import structlog
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class EditVote:
    """Rappresenta un voto di modifica con i cambiamenti suggeriti."""
    user_id: str
    authority: float
    vote_value: int  # +1 approve/edit, -1 reject
    suggested_edits: Dict[str, Any]  # {field_name: new_value}
    comment: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class FieldMergeResult:
    """Risultato del merge per un singolo campo."""
    field_name: str
    original_value: Any
    merged_value: Any
    total_authority_weight: float  # Peso totale authority per questo valore
    alternatives: List[Tuple[Any, float]]  # [(value, weight), ...] altri valori proposti
    confidence: float  # % authority che supporta questo valore


@dataclass
class MergeResult:
    """Risultato completo del merge per un'entità/relazione."""
    entity_id: str
    should_apply: bool  # True se le modifiche devono essere applicate
    merged_fields: Dict[str, FieldMergeResult]
    total_edit_votes: int
    total_authority_weight: float
    consensus_type: str  # "approved", "rejected", "needs_revision", "pending"
    message: str


# =============================================================================
# MERGE ALGORITHM
# =============================================================================

class EditMergeAlgorithm:
    """
    Algoritmo di merge per edit proposals pesato per authority.

    Supporta tre modalità di aggregazione:
    1. MAJORITY: vince il valore proposto dalla maggioranza (pesata per authority)
    2. WEIGHTED_AVERAGE: per campi numerici, calcola media pesata
    3. LATEST: usa l'ultima proposta (se authority >= threshold)

    Consensus Logic (Net Score):
    - net_score = approval_weight - rejection_weight
    - If net_score >= +2.0 → approved
    - If net_score <= -2.0 → rejected (entity discarded)
    - Otherwise → pending/needs_revision
    """

    DEFAULT_CONSENSUS_THRESHOLD = 2.0  # Net score threshold (positive or negative)
    FIELD_CONSENSUS_RATIO = 0.5  # 50% dell'authority totale per applicare un campo

    def __init__(
        self,
        consensus_threshold: float = DEFAULT_CONSENSUS_THRESHOLD,
        field_consensus_ratio: float = FIELD_CONSENSUS_RATIO,
    ):
        self.consensus_threshold = consensus_threshold
        self.field_consensus_ratio = field_consensus_ratio

    def aggregate_edit_votes(
        self,
        edit_votes: List[EditVote],
        original_values: Dict[str, Any],
    ) -> MergeResult:
        """
        Aggrega tutti i voti di modifica e determina i valori finali.

        Args:
            edit_votes: Lista di voti con suggested_edits
            original_values: Valori originali dell'entità {field: value}

        Returns:
            MergeResult con i campi da modificare
        """
        if not edit_votes:
            return MergeResult(
                entity_id="",
                should_apply=False,
                merged_fields={},
                total_edit_votes=0,
                total_authority_weight=0.0,
                consensus_type="pending",
                message="No edit votes to merge",
            )

        # Calcola peso totale authority per voti approve/edit (positivi) e reject (negativi)
        positive_votes = [v for v in edit_votes if v.vote_value > 0]
        negative_votes = [v for v in edit_votes if v.vote_value < 0]

        total_positive_weight = sum(v.authority * v.vote_value for v in positive_votes)
        total_negative_weight = sum(v.authority * abs(v.vote_value) for v in negative_votes)

        # Calculate NET SCORE (can be negative)
        net_score = total_positive_weight - total_negative_weight

        # Determina consensus type based on NET SCORE
        # >= +2.0 → approved
        # <= -2.0 → rejected (entity will be discarded)
        if net_score >= self.consensus_threshold:
            consensus_type = "approved"
        elif net_score <= -self.consensus_threshold:
            consensus_type = "rejected"
        elif total_positive_weight > 0 or total_negative_weight > 0:
            consensus_type = "needs_revision"
        else:
            consensus_type = "pending"

        log.debug(
            "Net score calculation",
            positive_weight=total_positive_weight,
            negative_weight=total_negative_weight,
            net_score=net_score,
            consensus_type=consensus_type,
        )

        # Aggrega proposte per campo
        field_proposals: Dict[str, Dict[Any, float]] = defaultdict(lambda: defaultdict(float))

        for vote in positive_votes:
            if not vote.suggested_edits:
                continue
            for field_name, new_value in vote.suggested_edits.items():
                # Converti a stringa per chiave (dict key must be hashable)
                value_key = str(new_value) if not isinstance(new_value, (str, int, float, bool)) else new_value
                field_proposals[field_name][value_key] += vote.authority

        # Merge fields
        merged_fields: Dict[str, FieldMergeResult] = {}

        for field_name, value_weights in field_proposals.items():
            # Trova il valore con più peso
            sorted_values = sorted(value_weights.items(), key=lambda x: x[1], reverse=True)
            best_value, best_weight = sorted_values[0]

            # Calcola confidence (% authority che supporta questo valore)
            total_field_weight = sum(value_weights.values())
            confidence = best_weight / total_field_weight if total_field_weight > 0 else 0.0

            # Determina se applicare la modifica
            # Il campo viene modificato se:
            # 1. Ha ricevuto supporto >= field_consensus_ratio del totale authority
            # 2. Il valore vincente ha >= 50% del peso per quel campo
            should_apply_field = (
                total_field_weight >= (total_positive_weight * self.field_consensus_ratio) and
                confidence >= 0.5
            )

            original_value = original_values.get(field_name)

            merged_fields[field_name] = FieldMergeResult(
                field_name=field_name,
                original_value=original_value,
                merged_value=best_value if should_apply_field else original_value,
                total_authority_weight=total_field_weight,
                alternatives=[(v, w) for v, w in sorted_values[1:] if w > 0],
                confidence=confidence,
            )

            log.debug(
                "Field merge result",
                field=field_name,
                original=original_value,
                merged=best_value if should_apply_field else original_value,
                confidence=confidence,
                should_apply=should_apply_field,
            )

        # Determina se applicare le modifiche
        should_apply = (
            consensus_type == "approved" and
            len(merged_fields) > 0 and
            any(f.merged_value != f.original_value for f in merged_fields.values())
        )

        return MergeResult(
            entity_id="",
            should_apply=should_apply,
            merged_fields=merged_fields,
            total_edit_votes=len(edit_votes),
            total_authority_weight=total_positive_weight,
            consensus_type=consensus_type,
            message=self._build_merge_message(merged_fields, consensus_type),
        )

    def _build_merge_message(
        self,
        merged_fields: Dict[str, FieldMergeResult],
        consensus_type: str,
    ) -> str:
        """Costruisce messaggio descrittivo del merge."""
        if consensus_type == "rejected":
            return "Edit proposals rejected by community consensus"

        if not merged_fields:
            return "No field changes to apply"

        changed_fields = [
            f.field_name for f in merged_fields.values()
            if f.merged_value != f.original_value
        ]

        if not changed_fields:
            return "No fields were modified (insufficient consensus for changes)"

        return f"Applied changes to: {', '.join(changed_fields)}"


# =============================================================================
# DATABASE INTEGRATION
# =============================================================================

async def get_edit_votes_for_entity(
    session: AsyncSession,
    entity_id: str,
) -> List[EditVote]:
    """
    Recupera tutti i voti di tipo 'edit' per un'entità dal database.
    """
    from merlt.storage.enrichment import EntityVote

    stmt = select(EntityVote).where(
        EntityVote.entity_id == entity_id,
        EntityVote.vote_value > 0,  # Solo approve/edit votes
        EntityVote.suggested_revision.isnot(None),  # Solo quelli con modifiche
    )

    result = await session.execute(stmt)
    votes = result.scalars().all()

    edit_votes = []
    for vote in votes:
        try:
            # Parse suggested_revision JSON
            suggested_edits = {}
            if vote.suggested_revision:
                suggested_edits = json.loads(vote.suggested_revision)

            edit_votes.append(EditVote(
                user_id=vote.user_id,
                authority=vote.voter_authority or 0.5,
                vote_value=vote.vote_value,
                suggested_edits=suggested_edits,
                comment=vote.comment,
                created_at=vote.created_at,
            ))
        except json.JSONDecodeError:
            log.warning(f"Invalid JSON in suggested_revision for vote {vote.id}")
            continue

    return edit_votes


async def get_edit_votes_for_relation(
    session: AsyncSession,
    relation_id: str,
) -> List[EditVote]:
    """
    Recupera tutti i voti di tipo 'edit' per una relazione dal database.
    """
    from merlt.storage.enrichment import RelationVote

    stmt = select(RelationVote).where(
        RelationVote.relation_id == relation_id,
        RelationVote.vote_value > 0,  # Solo approve/edit votes
        RelationVote.comment.isnot(None),  # Suggested edits stored in comment
    )

    result = await session.execute(stmt)
    votes = result.scalars().all()

    edit_votes = []
    for vote in votes:
        try:
            # Parse comment JSON (contains reason + suggested_edits)
            suggested_edits = {}
            if vote.comment:
                try:
                    comment_data = json.loads(vote.comment)
                    if isinstance(comment_data, dict) and "suggested_edits" in comment_data:
                        suggested_edits = comment_data["suggested_edits"]
                except json.JSONDecodeError:
                    # Plain text comment, no edits
                    pass

            if suggested_edits:  # Solo se ci sono edits
                edit_votes.append(EditVote(
                    user_id=vote.user_id,
                    authority=vote.voter_authority or 0.5,
                    vote_value=vote.vote_value,
                    suggested_edits=suggested_edits,
                    comment=vote.comment,
                    created_at=vote.created_at,
                ))
        except Exception as e:
            log.warning(f"Error parsing vote {vote.id}: {e}")
            continue

    return edit_votes


async def apply_entity_edits(
    session: AsyncSession,
    entity_id: str,
    merge_result: MergeResult,
) -> bool:
    """
    Applica le modifiche mergiate a un'entità nel database.

    Returns:
        True se le modifiche sono state applicate, False altrimenti.
    """
    if not merge_result.should_apply:
        return False

    from merlt.storage.enrichment import PendingEntity

    stmt = select(PendingEntity).where(PendingEntity.entity_id == entity_id)
    result = await session.execute(stmt)
    entity = result.scalar_one_or_none()

    if not entity:
        log.error(f"Entity {entity_id} not found for edit application")
        return False

    # Mappa campi merge -> colonne DB
    field_to_column = {
        "nome": "entity_text",
        "tipo": "entity_type",
        "descrizione": "descrizione",
        "ambito": "ambito",
    }

    changes_applied = []

    for field_name, field_result in merge_result.merged_fields.items():
        if field_result.merged_value == field_result.original_value:
            continue

        column_name = field_to_column.get(field_name, field_name)

        if hasattr(entity, column_name):
            old_value = getattr(entity, column_name)
            setattr(entity, column_name, field_result.merged_value)
            changes_applied.append(f"{field_name}: {old_value} -> {field_result.merged_value}")

            log.info(
                "Applied edit to entity",
                entity_id=entity_id,
                field=field_name,
                old_value=old_value,
                new_value=field_result.merged_value,
                confidence=field_result.confidence,
            )

    if changes_applied:
        # Update timestamp (use timezone-aware datetime, then strip tzinfo for PostgreSQL)
        entity.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await session.commit()

        log.info(
            "Entity edits applied",
            entity_id=entity_id,
            changes=changes_applied,
        )
        return True

    return False


async def apply_relation_edits(
    session: AsyncSession,
    relation_id: str,
    merge_result: MergeResult,
) -> bool:
    """
    Applica le modifiche mergiate a una relazione nel database.
    """
    if not merge_result.should_apply:
        return False

    from merlt.storage.enrichment import PendingRelation

    stmt = select(PendingRelation).where(PendingRelation.relation_id == relation_id)
    result = await session.execute(stmt)
    relation = result.scalar_one_or_none()

    if not relation:
        log.error(f"Relation {relation_id} not found for edit application")
        return False

    # Mappa campi merge -> colonne DB
    field_to_column = {
        "relation_type": "relation_type",
        "target_urn": "target_entity_id",
        "evidence": "relation_description",
    }

    changes_applied = []

    for field_name, field_result in merge_result.merged_fields.items():
        if field_result.merged_value == field_result.original_value:
            continue

        column_name = field_to_column.get(field_name, field_name)

        if hasattr(relation, column_name):
            old_value = getattr(relation, column_name)
            setattr(relation, column_name, field_result.merged_value)
            changes_applied.append(f"{field_name}: {old_value} -> {field_result.merged_value}")

            log.info(
                "Applied edit to relation",
                relation_id=relation_id,
                field=field_name,
                old_value=old_value,
                new_value=field_result.merged_value,
            )

    if changes_applied:
        relation.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await session.commit()

        log.info(
            "Relation edits applied",
            relation_id=relation_id,
            changes=changes_applied,
        )
        return True

    return False


# =============================================================================
# HIGH-LEVEL FUNCTIONS
# =============================================================================

async def process_entity_consensus(
    session: AsyncSession,
    entity_id: str,
    original_values: Dict[str, Any],
) -> MergeResult:
    """
    Processa il consenso per un'entità e applica le modifiche se necessario.

    Chiamato quando il consensus_reached diventa True.

    Args:
        session: Database session
        entity_id: ID dell'entità
        original_values: {field_name: current_value}

    Returns:
        MergeResult con il risultato del merge
    """
    # 1. Recupera tutti i voti edit
    edit_votes = await get_edit_votes_for_entity(session, entity_id)

    if not edit_votes:
        log.info(f"No edit votes for entity {entity_id}, skipping merge")
        return MergeResult(
            entity_id=entity_id,
            should_apply=False,
            merged_fields={},
            total_edit_votes=0,
            total_authority_weight=0.0,
            consensus_type="approved",  # Approved without edits
            message="Entity approved without modifications",
        )

    # 2. Aggrega i voti e calcola merge
    algorithm = EditMergeAlgorithm()
    merge_result = algorithm.aggregate_edit_votes(edit_votes, original_values)
    merge_result.entity_id = entity_id

    # 3. Applica modifiche se necessario
    if merge_result.should_apply:
        await apply_entity_edits(session, entity_id, merge_result)

    log.info(
        "Entity consensus processed",
        entity_id=entity_id,
        consensus_type=merge_result.consensus_type,
        edits_applied=merge_result.should_apply,
        fields_changed=len([f for f in merge_result.merged_fields.values()
                          if f.merged_value != f.original_value]),
    )

    return merge_result


async def process_relation_consensus(
    session: AsyncSession,
    relation_id: str,
    original_values: Dict[str, Any],
) -> MergeResult:
    """
    Processa il consenso per una relazione e applica le modifiche se necessario.
    """
    # 1. Recupera tutti i voti edit
    edit_votes = await get_edit_votes_for_relation(session, relation_id)

    if not edit_votes:
        return MergeResult(
            entity_id=relation_id,
            should_apply=False,
            merged_fields={},
            total_edit_votes=0,
            total_authority_weight=0.0,
            consensus_type="approved",
            message="Relation approved without modifications",
        )

    # 2. Aggrega i voti
    algorithm = EditMergeAlgorithm()
    merge_result = algorithm.aggregate_edit_votes(edit_votes, original_values)
    merge_result.entity_id = relation_id

    # 3. Applica modifiche
    if merge_result.should_apply:
        await apply_relation_edits(session, relation_id, merge_result)

    return merge_result


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "EditVote",
    "FieldMergeResult",
    "MergeResult",
    "EditMergeAlgorithm",
    "get_edit_votes_for_entity",
    "get_edit_votes_for_relation",
    "apply_entity_edits",
    "apply_relation_edits",
    "process_entity_consensus",
    "process_relation_consensus",
]
