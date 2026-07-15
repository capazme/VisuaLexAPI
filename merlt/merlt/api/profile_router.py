"""
Profile API Router
==================

FastAPI router per gestione profilo utente e RLCF authority.

Endpoint:
- GET /profile/full - Profilo completo con authority, domains, stats
- GET /profile/authority/domains - Authority per dominio
- GET /profile/stats/detailed - Statistiche contributi dettagliate
- PATCH /profile/qualification - Aggiorna qualifiche
- PATCH /profile/notifications - Aggiorna preferenze notifiche
"""

import structlog
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, status, Depends, Response
from sqlalchemy import select, func, and_, or_, case
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.api.auth import verify_api_key, require_role, get_current_user_id
from merlt.experts.models import ApiKey
from merlt.api.models.profile_models import (
    FullProfileResponse,
    FullProfileResponseInternal,
    DomainAuthorityResponse,
    DetailedContributionStats,
    UpdateQualificationRequest,
    UpdateNotificationsRequest,
    NotificationPreferences,
    AuthorityBreakdown,
    AuthorityInfo,
    ContributionStatsSimple,
    DomainStats,
    QualificationType,
    LegalDomain,
    ProfileActivityEntry,
)
from merlt.storage.enrichment.database import get_db_session_dependency
from merlt.storage.enrichment.models import (
    PendingEntity,
    EntityVote,
    PendingRelation,
    RelationVote,
    UserDomainAuthority,
    NERFeedback,
    MerltUser,
)

log = structlog.get_logger()

router = APIRouter(prefix="/profile", tags=["profile"])


# =============================================================================
# DATABASE QUERY FUNCTIONS
# =============================================================================

# Mapping qualifiche -> baseline score
QUALIFICATION_BASELINE = {
    QualificationType.STUDENTE: 0.2,
    QualificationType.LAUREANDO: 0.3,
    QualificationType.NEOLAUREATO: 0.4,
    QualificationType.PRATICANTE: 0.5,
    QualificationType.AVVOCATO: 0.7,
    QualificationType.MAGISTRATO: 0.85,
    QualificationType.DOCENTE: 0.9,
    QualificationType.GIUDICE_SUPREMA: 1.0,
}

# Default baseline per utenti senza qualifica
DEFAULT_BASELINE = 0.3

# Tier thresholds
TIER_THRESHOLDS = {
    "novizio": {"min": 0.0, "max": 0.4},
    "contributore": {"min": 0.4, "max": 0.6},
    "esperto": {"min": 0.6, "max": 0.8},
    "autorita": {"min": 0.8, "max": 1.0},
}


def _domain_from_urn(article_urn: str) -> Optional[str]:
    """Best-effort legal-domain guess from an article URN.

    Mirrors `NERRLCFIntegration._extract_domain` (rlcf/ner_rlcf_integration.py)
    but is duplicated here on purpose: profile_router now reads NER feedback
    directly from the `ner_feedback` Postgres table (this module's own
    enrichment session) instead of going through the legacy RLCF integration,
    which was reading from a database the modern frontend never writes to.
    """
    urn_lower = (article_urn or "").lower()
    if "codice.civile" in urn_lower or "cc" in urn_lower:
        return "civile"
    elif "codice.penale" in urn_lower or "cp" in urn_lower:
        return "penale"
    elif "procedura.civile" in urn_lower or "cpc" in urn_lower:
        return "procedura_civile"
    elif "procedura.penale" in urn_lower or "cpp" in urn_lower:
        return "procedura_penale"
    elif "costituzione" in urn_lower:
        return "costituzionale"
    elif "amministrativo" in urn_lower or "cpa" in urn_lower:
        return "amministrativo"
    return None


async def _get_user_baseline(session: AsyncSession, user_id: str) -> float:
    """Read the persisted B_u baseline for a user, defaulting for unknown users."""
    result = await session.execute(
        select(MerltUser.baseline_bu).where(MerltUser.user_id == user_id)
    )
    value = result.scalar_one_or_none()
    return value if value is not None else DEFAULT_BASELINE


async def _upsert_merlt_user(session: AsyncSession, user_id: str, **fields) -> MerltUser:
    """Create-or-update the `merlt_users` row for `user_id`, setting only the
    provided fields (None values are skipped so PATCH semantics hold for
    partial requests)."""
    result = await session.execute(select(MerltUser).where(MerltUser.user_id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        user = MerltUser(user_id=user_id)
        session.add(user)
    for key, value in fields.items():
        if value is not None:
            setattr(user, key, value)
    await session.commit()
    await session.refresh(user)
    return user


def get_tier_from_score(score: float) -> str:
    """Determina il tier dall'authority score."""
    if score >= 0.8:
        return "autorita"
    if score >= 0.6:
        return "esperto"
    if score >= 0.4:
        return "contributore"
    return "novizio"


def get_progress_to_next_tier(score: float) -> tuple[float, float]:
    """
    Calcola progresso verso prossimo tier.

    Returns:
        (progress_percent, next_threshold)
    """
    tier = get_tier_from_score(score)
    thresholds = TIER_THRESHOLDS[tier]

    if tier == "autorita":
        return 100.0, 1.0

    tier_range = thresholds["max"] - thresholds["min"]
    position_in_tier = score - thresholds["min"]
    progress = min(100, max(0, (position_in_tier / tier_range) * 100))

    return progress, thresholds["max"]


async def get_entity_contribution_stats(
    session: AsyncSession, user_id: str
) -> dict:
    """Query statistiche contributi entità per utente."""
    query = select(
        func.count(PendingEntity.id).label("total"),
        func.count(
            case((PendingEntity.validation_status == "approved", 1))
        ).label("approved"),
        func.count(
            case((PendingEntity.validation_status == "rejected", 1))
        ).label("rejected"),
        func.count(
            case((PendingEntity.validation_status == "pending", 1))
        ).label("pending"),
    ).where(PendingEntity.contributed_by == user_id)

    result = await session.execute(query)
    row = result.one()
    return {
        "total": row.total or 0,
        "approved": row.approved or 0,
        "rejected": row.rejected or 0,
        "pending": row.pending or 0,
    }


async def get_relation_contribution_stats(
    session: AsyncSession, user_id: str
) -> dict:
    """Query statistiche contributi relazioni per utente."""
    query = select(
        func.count(PendingRelation.id).label("total"),
        func.count(
            case((PendingRelation.validation_status == "approved", 1))
        ).label("approved"),
        func.count(
            case((PendingRelation.validation_status == "rejected", 1))
        ).label("rejected"),
        func.count(
            case((PendingRelation.validation_status == "pending", 1))
        ).label("pending"),
    ).where(PendingRelation.contributed_by == user_id)

    result = await session.execute(query)
    row = result.one()
    return {
        "total": row.total or 0,
        "approved": row.approved or 0,
        "rejected": row.rejected or 0,
        "pending": row.pending or 0,
    }


async def get_vote_stats(session: AsyncSession, user_id: str) -> dict:
    """Query statistiche voti dell'utente."""
    # Query entity votes
    entity_votes_query = select(
        func.count(EntityVote.id).label("total"),
    ).where(EntityVote.user_id == user_id)

    # Query relation votes
    relation_votes_query = select(
        func.count(RelationVote.id).label("total"),
    ).where(RelationVote.user_id == user_id)

    entity_result = await session.execute(entity_votes_query)
    relation_result = await session.execute(relation_votes_query)

    entity_votes = entity_result.scalar() or 0
    relation_votes = relation_result.scalar() or 0

    # Per calcolare i voti "corretti", contiamo i voti su entità/relazioni
    # il cui outcome finale corrisponde al voto dell'utente
    # Voto +1 su entità approvata = corretto
    # Voto -1 su entità rigettata = corretto

    correct_entity_query = select(func.count(EntityVote.id)).where(
        and_(
            EntityVote.user_id == user_id,
            or_(
                and_(EntityVote.vote_value == 1, PendingEntity.validation_status == "approved"),
                and_(EntityVote.vote_value == -1, PendingEntity.validation_status == "rejected"),
            ),
        )
    ).join(PendingEntity, EntityVote.entity_id == PendingEntity.entity_id)

    correct_relation_query = select(func.count(RelationVote.id)).where(
        and_(
            RelationVote.user_id == user_id,
            or_(
                and_(RelationVote.vote_value == 1, PendingRelation.validation_status == "approved"),
                and_(RelationVote.vote_value == -1, PendingRelation.validation_status == "rejected"),
            ),
        )
    ).join(PendingRelation, RelationVote.relation_id == PendingRelation.relation_id)

    correct_entity = (await session.execute(correct_entity_query)).scalar() or 0
    correct_relation = (await session.execute(correct_relation_query)).scalar() or 0

    total_votes = entity_votes + relation_votes
    total_correct = correct_entity + correct_relation

    return {
        "total": total_votes,
        "correct": total_correct,
        "accuracy": total_correct / total_votes if total_votes > 0 else 0.0,
    }


async def get_domain_authorities(
    session: AsyncSession, user_id: str
) -> DomainAuthorityResponse:
    """Query domain authority per utente (flat response)."""
    query = select(UserDomainAuthority).where(
        UserDomainAuthority.user_id == user_id
    )
    result = await session.execute(query)
    rows = result.scalars().all()

    # Build response from database or use defaults
    domain_auth = DomainAuthorityResponse()
    for row in rows:
        domain = row.legal_domain.lower()
        if hasattr(domain_auth, domain):
            setattr(domain_auth, domain, row.domain_authority or 0.0)

    return domain_auth


async def get_domain_stats_detailed(
    session: AsyncSession, user_id: str
) -> Dict[str, DomainStats]:
    """
    Query domain stats dettagliati per frontend.

    Returns dict con authority, contributions e success_rate per ogni dominio.
    """
    # Default domains con valori iniziali
    domains = {
        "civile": DomainStats(authority=0.0, contributions=0, success_rate=0.0),
        "penale": DomainStats(authority=0.0, contributions=0, success_rate=0.0),
        "amministrativo": DomainStats(authority=0.0, contributions=0, success_rate=0.0),
        "costituzionale": DomainStats(authority=0.0, contributions=0, success_rate=0.0),
        "lavoro": DomainStats(authority=0.0, contributions=0, success_rate=0.0),
        "commerciale": DomainStats(authority=0.0, contributions=0, success_rate=0.0),
        "tributario": DomainStats(authority=0.0, contributions=0, success_rate=0.0),
        "internazionale": DomainStats(authority=0.0, contributions=0, success_rate=0.0),
    }

    # Get domain authority from UserDomainAuthority
    auth_query = select(UserDomainAuthority).where(
        UserDomainAuthority.user_id == user_id
    )
    auth_result = await session.execute(auth_query)
    for row in auth_result.scalars().all():
        domain = row.legal_domain.lower()
        if domain in domains:
            domains[domain].authority = row.domain_authority or 0.0
            domains[domain].contributions = row.total_feedbacks or 0
            # success_rate from accuracy_score
            domains[domain].success_rate = (row.accuracy_score or 0.0) * 100

    return domains


def normalize_domain(raw_domain: str | None) -> str | None:
    """Normalizza dominio legale per frontend."""
    if not raw_domain:
        return None

    # Mapping da valori interni a valori frontend
    domain_map = {
        "diritto_civile": "civile",
        "diritto_penale": "penale",
        "diritto_amministrativo": "amministrativo",
        "diritto_costituzionale": "costituzionale",
        "diritto_del_lavoro": "lavoro",
        "diritto_commerciale": "commerciale",
        "diritto_tributario": "tributario",
        "diritto_internazionale": "internazionale",
    }

    normalized = raw_domain.lower().strip()
    return domain_map.get(normalized, normalized)


async def get_ner_feedback_stats(session: AsyncSession, user_id: str) -> dict:
    """
    Query NER feedback stats per utente dalla tabella Postgres `ner_feedback`
    (stessa sessione enrichment usata da tutte le altre query di questo modulo).

    Prima leggeva `NERRLCFIntegration.get_user_ner_history`, che interroga
    Feedback/LegalTask/Response (schema RLCF legacy) popolato SOLO dal path
    `/enrichment/ner-feedback*`. Il frontend moderno scrive invece
    direttamente su `ner_feedback` via `/api/v1/ner/feedback` (ner_router.py),
    quindi quelle stats risultavano sempre vuote in produzione.

    Returns:
        dict con total, confirmations, corrections, annotations, accuracy
    """
    try:
        query = (
            select(NERFeedback.feedback_type, func.count(NERFeedback.id))
            .where(NERFeedback.user_id == user_id)
            .group_by(NERFeedback.feedback_type)
        )
        result = await session.execute(query)
        counts = {ft: c for ft, c in result.all()}

        confirmations = counts.get("confirmation", 0)
        corrections = counts.get("correction", 0)
        # ner_feedback's feedback_type vocabulary is confirmation/correction/
        # false_positive/missed (no "annotation"); fold the latter two into
        # the "annotations" bucket so downstream (calculate_authority, the
        # response's ContributionStatsSimple) keeps its existing 3-bucket
        # shape and 0.8-weight treatment.
        annotations = counts.get("false_positive", 0) + counts.get("missed", 0)
        total = confirmations + corrections + annotations

        if total > 0:
            # Simplified: confirmations = 100% correct, corrections/annotations = 80% valuable
            accuracy = (confirmations * 1.0 + (corrections + annotations) * 0.8) / total
        else:
            accuracy = 0.0

        return {
            "total": total,
            "confirmations": confirmations,
            "corrections": corrections,
            "annotations": annotations,
            "accuracy": min(1.0, accuracy),  # Cap at 1.0
        }
    except Exception as e:
        log.warning(f"Failed to get NER feedback stats: {e}")
        return {
            "total": 0,
            "confirmations": 0,
            "corrections": 0,
            "annotations": 0,
            "accuracy": 0.0,
        }


async def get_recent_activity(
    session: AsyncSession, user_id: str, limit: int = 10
) -> List[ProfileActivityEntry]:
    """Query attività recente dell'utente (voti, proposte, e NER feedback)."""
    activities = []

    # Get recent NER feedback from the enrichment `ner_feedback` table (same
    # session as the rest of this module — see get_ner_feedback_stats's
    # docstring for why the legacy RLCF-integration history read was dropped).
    try:
        ner_query = (
            select(NERFeedback)
            .where(NERFeedback.user_id == user_id)
            .order_by(NERFeedback.created_at.desc())
            .limit(limit)
        )
        ner_result = await session.execute(ner_query)
        for item in ner_result.scalars().all():
            # Map feedback_type to outcome
            outcome = "approved" if item.feedback_type == "confirmation" else "pending"
            selected_text = item.selected_text or ""

            activities.append(
                ProfileActivityEntry(
                    id=f"ner-{item.feedback_id}",
                    type="ner_feedback",
                    item_name=f"Citazione: {selected_text[:40]}..." if len(selected_text) > 40 else f"Citazione: {selected_text}",
                    item_type="citation",
                    outcome=outcome,
                    timestamp=item.created_at or datetime.now(timezone.utc),
                    domain=normalize_domain(_domain_from_urn(item.article_urn or "")),
                    track_record_delta=0.001 if item.feedback_type == "confirmation" else 0.005,
                    item_id=item.feedback_id,
                )
            )
    except Exception as e:
        log.warning(f"Failed to get NER feedback history: {e}")

    # Get recent entity proposals
    entity_query = (
        select(PendingEntity)
        .where(PendingEntity.contributed_by == user_id)
        .order_by(PendingEntity.created_at.desc())
        .limit(limit)
    )
    entity_result = await session.execute(entity_query)
    for entity in entity_result.scalars().all():
        activities.append(
            ProfileActivityEntry(
                id=f"entity-{entity.id}",
                type="proposal",
                item_name=entity.entity_text[:50] if entity.entity_text else "Entità",
                item_type="entity",
                outcome=entity.validation_status or "pending",
                timestamp=entity.created_at or datetime.now(timezone.utc),
                domain=normalize_domain(entity.ambito),
                item_id=entity.entity_id,
            )
        )

    # Get recent relation proposals
    relation_query = (
        select(PendingRelation)
        .where(PendingRelation.contributed_by == user_id)
        .order_by(PendingRelation.created_at.desc())
        .limit(limit)
    )
    relation_result = await session.execute(relation_query)
    for rel in relation_result.scalars().all():
        activities.append(
            ProfileActivityEntry(
                id=f"relation-{rel.id}",
                type="proposal",
                item_name=f"{rel.relation_type} → {rel.target_entity_id[:30] if rel.target_entity_id else '...'}",
                item_type="relation",
                outcome=rel.validation_status or "pending",
                timestamp=rel.created_at or datetime.now(timezone.utc),
                item_id=rel.relation_id,
            )
        )

    # Get recent entity votes with outcome info
    entity_vote_query = (
        select(EntityVote, PendingEntity)
        .join(PendingEntity, EntityVote.entity_id == PendingEntity.entity_id)
        .where(EntityVote.user_id == user_id)
        .order_by(EntityVote.created_at.desc())
        .limit(limit)
    )
    vote_result = await session.execute(entity_vote_query)
    for vote, entity in vote_result.all():
        # Calcola delta track record (semplificato)
        delta = None
        if entity.validation_status in ("approved", "rejected"):
            vote_correct = (
                (vote.vote_value == 1 and entity.validation_status == "approved")
                or (vote.vote_value == -1 and entity.validation_status == "rejected")
            )
            # Delta semplificato: +0.01 se corretto, -0.005 se errato
            delta = 0.01 if vote_correct else -0.005

        activities.append(
            ProfileActivityEntry(
                id=f"vote-entity-{vote.id}",
                type="vote",
                item_name=entity.entity_text[:50] if entity.entity_text else "Entità",
                item_type="entity",
                outcome=entity.validation_status or "pending",
                timestamp=vote.created_at or datetime.now(timezone.utc),
                track_record_delta=delta,
                domain=normalize_domain(vote.legal_domain or entity.ambito),
                item_id=entity.entity_id,
            )
        )

    # Get recent relation votes
    relation_vote_query = (
        select(RelationVote, PendingRelation)
        .join(PendingRelation, RelationVote.relation_id == PendingRelation.relation_id)
        .where(RelationVote.user_id == user_id)
        .order_by(RelationVote.created_at.desc())
        .limit(limit)
    )
    rel_vote_result = await session.execute(relation_vote_query)
    for vote, rel in rel_vote_result.all():
        delta = None
        if rel.validation_status in ("approved", "rejected"):
            vote_correct = (
                (vote.vote_value == 1 and rel.validation_status == "approved")
                or (vote.vote_value == -1 and rel.validation_status == "rejected")
            )
            delta = 0.01 if vote_correct else -0.005

        activities.append(
            ProfileActivityEntry(
                id=f"vote-relation-{vote.id}",
                type="vote",
                item_name=f"{rel.relation_type}",
                item_type="relation",
                outcome=rel.validation_status or "pending",
                timestamp=vote.created_at or datetime.now(timezone.utc),
                track_record_delta=delta,
                domain=normalize_domain(vote.legal_domain),
                item_id=rel.relation_id,
            )
        )

    # Sort by timestamp and return top N
    activities.sort(key=lambda x: x.timestamp, reverse=True)
    return activities[:limit]


def calculate_authority(
    baseline: float,
    entity_stats: dict,
    relation_stats: dict,
    vote_stats: dict,
    ner_stats: dict | None = None,
) -> tuple[float, AuthorityBreakdown]:
    """
    Calcola authority usando formula RLCF.

    A_u(t) = 0.3*B_u + 0.5*T_u + 0.2*P_u

    - B_u: Baseline da qualifiche
    - T_u: Track Record (accuracy storica) - include voti + NER feedback
    - P_u: Performance recente (basata su contributi approvati) - include NER feedback

    Args:
        baseline: B_u baseline score da qualifiche
        entity_stats: stats contributi entità
        relation_stats: stats contributi relazioni
        vote_stats: stats voti
        ner_stats: stats NER feedback (optional)
    """
    # B_u: Baseline (già fornito)
    b_u = baseline

    # Initialize NER stats if not provided
    if ner_stats is None:
        ner_stats = {"total": 0, "accuracy": 0.0, "confirmations": 0}

    # T_u: Track Record - weighted accuracy across votes + NER feedback
    vote_total = vote_stats.get("total", 0)
    vote_accuracy = vote_stats.get("accuracy", 0.0)
    ner_total = ner_stats.get("total", 0)
    ner_accuracy = ner_stats.get("accuracy", 0.0)

    total_feedback = vote_total + ner_total
    if total_feedback > 0:
        # Weighted average of accuracies
        t_u = (vote_accuracy * vote_total + ner_accuracy * ner_total) / total_feedback
    else:
        t_u = 0.5  # Default per utenti senza feedback

    # P_u: Performance recente - include NER feedback as contributions
    entity_contributions = entity_stats.get("total", 0)
    relation_contributions = relation_stats.get("total", 0)
    ner_contributions = ner_stats.get("total", 0)

    entity_approved = entity_stats.get("approved", 0)
    relation_approved = relation_stats.get("approved", 0)
    # For NER: confirmations are "approved", corrections/annotations are valuable (count as 0.8)
    ner_approved = ner_stats.get("confirmations", 0) + \
                   (ner_stats.get("corrections", 0) + ner_stats.get("annotations", 0)) * 0.8

    total_contributions = entity_contributions + relation_contributions + ner_contributions
    total_approved = entity_approved + relation_approved + ner_approved

    if total_contributions > 0:
        p_u = total_approved / total_contributions
    else:
        p_u = 0.5  # Default per utenti senza contributi

    # Formula RLCF
    authority = 0.3 * b_u + 0.5 * t_u + 0.2 * p_u

    breakdown = AuthorityBreakdown(
        baseline=round(b_u, 4),
        track_record=round(t_u, 4),
        level_authority=round(p_u, 4),
    )

    return round(authority, 4), breakdown


# =============================================================================
# FULL PROFILE
# =============================================================================

@router.get(
    "/full",
    response_model=FullProfileResponse,
    summary="Profilo completo utente",
    description="""
Ritorna il profilo completo dell'utente con:

- **Authority globale** e breakdown (B_u, T_u, P_u)
- **Domain-specific authority** per 8 domini legali
- **Statistiche contributi** (entità, relazioni, voti)
- **Qualifiche** e specializzazioni
- **Preferenze notifiche**

Formula Authority: A_u(t) = 0.3*B_u + 0.5*T_u + 0.2*P_u
    """,
)
async def get_full_profile(
    user_id: str = Query(..., description="User ID from auth context"),
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
    jwt_user_id: Optional[str] = Depends(get_current_user_id),
) -> FullProfileResponse:
    """Ritorna profilo completo utente."""
    if jwt_user_id and jwt_user_id != user_id and api_key is None:
        raise HTTPException(status_code=403, detail="Cannot access another user's profile")
    log.info("API: get_full_profile", user_id=user_id)

    try:
        # Query statistiche contributi
        entity_stats = await get_entity_contribution_stats(session, user_id)
        relation_stats = await get_relation_contribution_stats(session, user_id)
        vote_stats = await get_vote_stats(session, user_id)

        # Query NER feedback stats
        ner_stats = await get_ner_feedback_stats(session, user_id)

        # Query domain stats dettagliati
        domains = await get_domain_stats_detailed(session, user_id)

        # Query recent activity
        recent_activity = await get_recent_activity(session, user_id, limit=10)

        # Calcola authority (baseline persistito in merlt_users, default per utenti nuovi)
        baseline = await _get_user_baseline(session, user_id)
        authority_score, breakdown = calculate_authority(
            baseline, entity_stats, relation_stats, vote_stats, ner_stats
        )

        # Calcola tier e progress
        tier = get_tier_from_score(authority_score)
        progress, next_threshold = get_progress_to_next_tier(authority_score)

        # Build stats semplificate (include NER feedback)
        total_contributions = entity_stats["total"] + relation_stats["total"] + ner_stats["total"]
        total_approved = entity_stats["approved"] + relation_stats["approved"] + ner_stats["confirmations"]
        total_rejected = entity_stats["rejected"] + relation_stats["rejected"]  # NER doesn't have rejected
        total_pending = entity_stats["pending"] + relation_stats["pending"] + ner_stats["corrections"] + ner_stats["annotations"]

        stats = ContributionStatsSimple(
            total_contributions=total_contributions,
            approved=total_approved,
            rejected=total_rejected,
            pending=total_pending,
            vote_weight=authority_score,
        )

        # Build authority info
        authority_info = AuthorityInfo(
            score=authority_score,
            tier=tier,
            breakdown=breakdown,
            next_tier_threshold=next_threshold,
            progress_to_next=progress,
        )

        # Build response
        profile = FullProfileResponse(
            user_id=user_id,
            display_name=user_id,
            authority=authority_info,
            domains={k: v for k, v in domains.items()},  # Convert to dict
            stats=stats,
            recent_activity=recent_activity,
            joined_at=None,
            last_updated=None,
        )

        log.info(
            "Profile fetched",
            user_id=user_id,
            authority=authority_score,
            tier=tier,
            total_contributions=total_contributions,
            ner_contributions=ner_stats["total"],
            track_record=breakdown.track_record,
            performance=breakdown.level_authority,
        )

        return profile

    except Exception as e:
        log.error(f"Failed to get profile: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get profile: {str(e)}",
        )


# =============================================================================
# DOMAIN AUTHORITY
# =============================================================================

@router.get(
    "/authority/domains",
    response_model=DomainAuthorityResponse,
    summary="Authority per dominio legale",
    description="""
Ritorna l'authority dell'utente per ciascuno degli 8 domini legali.

L'authority per dominio è calcolata come:
- Validazioni corrette nel dominio / Validazioni totali nel dominio
- Pesata per track record globale
    """,
)
async def get_domain_authority(
    user_id: str = Query(..., description="User ID from auth context"),
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DomainAuthorityResponse:
    """Ritorna authority per dominio."""
    log.info("API: get_domain_authority", user_id=user_id)

    try:
        domain_auth = await get_domain_authorities(session, user_id)
        return domain_auth

    except Exception as e:
        log.error(f"Failed to get domain authority: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get domain authority: {str(e)}",
        )


# =============================================================================
# DETAILED STATS
# =============================================================================

@router.get(
    "/stats/detailed",
    response_model=DetailedContributionStats,
    summary="Statistiche contributi dettagliate",
    description="""
Ritorna statistiche complete sui contributi dell'utente:

- **Entità**: proposte, approvate, rifiutate
- **Relazioni**: proposte, approvate, rifiutate
- **Voti**: cast, corretti, accuracy rate

Accuracy rate = votes_correct / votes_cast
    """,
)
async def get_detailed_stats(
    user_id: str = Query(..., description="User ID from auth context"),
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DetailedContributionStats:
    """Ritorna statistiche dettagliate contributi."""
    log.info("API: get_detailed_stats", user_id=user_id)

    try:
        entity_stats = await get_entity_contribution_stats(session, user_id)
        relation_stats = await get_relation_contribution_stats(session, user_id)
        vote_stats = await get_vote_stats(session, user_id)

        stats = DetailedContributionStats(
            entities_proposed=entity_stats["total"],
            entities_approved=entity_stats["approved"],
            entities_rejected=entity_stats["rejected"],
            relations_proposed=relation_stats["total"],
            relations_approved=relation_stats["approved"],
            relations_rejected=relation_stats["rejected"],
            votes_cast=vote_stats["total"],
            votes_correct=vote_stats["correct"],
            accuracy_rate=vote_stats["accuracy"],
        )

        return stats

    except Exception as e:
        log.error(f"Failed to get stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get stats: {str(e)}",
        )


# =============================================================================
# UPDATE QUALIFICATION
# =============================================================================

@router.patch(
    "/qualification",
    response_model=FullProfileResponse,
    summary="Aggiorna qualifiche utente",
    description="""
Aggiorna qualifica professionale, specializzazioni e anni di esperienza.

Questo aggiornamento impatta il **Baseline (B_u)** dell'authority:
- Qualifica più alta → B_u più alto
- Specializzazioni → Bonus authority nei domini specifici
- Anni esperienza → Scaling factor per track record
    """,
)
async def update_qualification(
    request: UpdateQualificationRequest,
    response: Response,
    user_id: str = Query(..., description="User ID from auth context"),
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> FullProfileResponse:
    """Aggiorna qualifiche utente."""
    log.info(
        "API: update_qualification",
        user_id=user_id,
        qualification=request.qualification,
        specializations=request.specializations,
        years_experience=request.years_experience,
    )

    try:
        new_baseline = QUALIFICATION_BASELINE.get(request.qualification, DEFAULT_BASELINE)

        await _upsert_merlt_user(
            session,
            user_id,
            qualification=request.qualification.value,
            specializations=(
                [d.value for d in request.specializations] if request.specializations else None
            ),
            years_experience=request.years_experience,
            baseline_bu=new_baseline,
        )

        # Refetch stats from database
        entity_stats = await get_entity_contribution_stats(session, user_id)
        relation_stats = await get_relation_contribution_stats(session, user_id)
        vote_stats = await get_vote_stats(session, user_id)
        ner_stats = await get_ner_feedback_stats(session, user_id)
        domains = await get_domain_stats_detailed(session, user_id)
        recent_activity = await get_recent_activity(session, user_id, limit=10)

        # Ricalcola authority con nuovo baseline
        authority_score, breakdown = calculate_authority(
            new_baseline, entity_stats, relation_stats, vote_stats, ner_stats
        )

        # Calcola tier e progress
        tier = get_tier_from_score(authority_score)
        progress, next_threshold = get_progress_to_next_tier(authority_score)

        # Build stats (include NER feedback)
        total_contributions = entity_stats["total"] + relation_stats["total"] + ner_stats["total"]
        total_approved = entity_stats["approved"] + relation_stats["approved"] + ner_stats["confirmations"]
        total_rejected = entity_stats["rejected"] + relation_stats["rejected"]
        total_pending = entity_stats["pending"] + relation_stats["pending"] + ner_stats["corrections"] + ner_stats["annotations"]

        stats = ContributionStatsSimple(
            total_contributions=total_contributions,
            approved=total_approved,
            rejected=total_rejected,
            pending=total_pending,
            vote_weight=authority_score,
        )

        authority_info = AuthorityInfo(
            score=authority_score,
            tier=tier,
            breakdown=breakdown,
            next_tier_threshold=next_threshold,
            progress_to_next=progress,
        )

        profile = FullProfileResponse(
            user_id=user_id,
            display_name=user_id,
            authority=authority_info,
            domains={k: v for k, v in domains.items()},
            stats=stats,
            recent_activity=recent_activity,
            joined_at=None,
            last_updated=datetime.now(timezone.utc).isoformat(),
        )

        log.info(
            "Qualification updated",
            new_baseline=new_baseline,
            new_authority=authority_score,
            tier=tier,
        )

        return profile

    except Exception as e:
        log.error(f"Failed to update qualification: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update qualification: {str(e)}",
        )


# =============================================================================
# UPDATE NOTIFICATIONS
# =============================================================================

@router.patch(
    "/notifications",
    response_model=NotificationPreferences,
    summary="Aggiorna preferenze notifiche",
    description="""
Aggiorna le preferenze di notifica email:

- **email_on_validation**: Notifica quando una tua proposta viene validata
- **email_on_authority_change**: Notifica quando la tua authority cambia significativamente
- **email_weekly_summary**: Summary settimanale delle attività
    """,
)
async def update_notifications(
    request: UpdateNotificationsRequest,
    response: Response,
    user_id: str = Query(..., description="User ID from auth context"),
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> NotificationPreferences:
    """Aggiorna preferenze notifiche."""
    log.info(
        "API: update_notifications",
        user_id=user_id,
        preferences=request.model_dump(exclude_none=True),
    )

    try:
        user = await _upsert_merlt_user(
            session,
            user_id,
            email_on_validation=request.email_on_validation,
            email_on_authority_change=request.email_on_authority_change,
            email_weekly_summary=request.email_weekly_summary,
        )

        prefs = NotificationPreferences(
            email_on_validation=user.email_on_validation if user.email_on_validation is not None else True,
            email_on_authority_change=user.email_on_authority_change if user.email_on_authority_change is not None else True,
            email_weekly_summary=user.email_weekly_summary if user.email_weekly_summary is not None else False,
        )

        log.info("Notification preferences updated", preferences=prefs.model_dump())

        return prefs

    except Exception as e:
        log.error(f"Failed to update notifications: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update notifications: {str(e)}",
        )


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = ["router"]
