"""
Domain Authority Calculation
=============================

Calculates user's domain-specific authority based on accuracy.

Formula:
    domain_authority[domain] = correct_feedbacks / total_feedbacks

Where:
- correct_feedbacks: Feedbacks where user's vote matches consensus
- total_feedbacks: All feedbacks where consensus was reached
- Consensus requires quorum of votes weighted by authority

Peer Validation:
- Only feedbacks with consensus count (not individual opinions)
- Consensus = majority of weighted votes (approval_score > threshold)
- User is "correct" if their vote aligns with consensus

Integration:
- Reads from entity_votes, relation_votes, amendment_votes
- Syncs with VisuaLex MerltFeedback (optional)
- Updates user_domain_authority table
- Provides real-time authority lookup

Usage:
    from merlt.rlcf.domain_authority import DomainAuthorityService
    from merlt.storage.enrichment import get_db_session

    service = DomainAuthorityService()

    async with get_db_session() as session:
        # Calculate for user
        authority = await service.calculate_user_authority(
            session, user_id="user123", legal_domain="civile"
        )
        print(f"Authority: {authority:.2f}")

        # Batch recalculate for all users
        await service.recalculate_all_authorities(session)
"""

import structlog
from typing import Dict, List, Optional
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.storage.enrichment.models import (
    EntityVote,
    PendingEntity,
    RelationVote,
    PendingRelation,
    AmendmentVote,
    PendingAmendment,
    UserDomainAuthority,
)

log = structlog.get_logger()


class DomainAuthorityService:
    """
    Service for calculating domain-specific authority.

    Authority is based on accuracy: how often the user's votes
    align with community consensus.
    """

    def __init__(self, consensus_threshold: float = 2.0):
        """
        Initialize service.

        Args:
            consensus_threshold: Weighted votes needed for consensus
        """
        self.consensus_threshold = consensus_threshold

    async def calculate_user_authority(
        self,
        session: AsyncSession,
        user_id: str,
        legal_domain: str,
    ) -> float:
        """
        Calculate authority for user in specific domain.

        Args:
            session: DB session
            user_id: User ID
            legal_domain: Legal domain ('civile', 'penale', etc.)

        Returns:
            Authority score (0.0 to 1.0, starts at 0.5)

        Formula:
            1. Count total feedbacks where consensus was reached
            2. Count correct feedbacks (user vote = consensus)
            3. accuracy = correct / total
            4. domain_authority = accuracy (bounded 0.0-1.0)
        """
        # Get all entity votes by this user in this domain
        entity_stats = await self._get_entity_vote_stats(session, user_id, legal_domain)

        # Get relation votes
        relation_stats = await self._get_relation_vote_stats(session, user_id, legal_domain)

        # Get amendment votes
        amendment_stats = await self._get_amendment_vote_stats(session, user_id, legal_domain)

        # Combine stats
        total = entity_stats["total"] + relation_stats["total"] + amendment_stats["total"]
        correct = entity_stats["correct"] + relation_stats["correct"] + amendment_stats["correct"]

        # Calculate accuracy
        if total == 0:
            # No consensus feedbacks yet → default authority 0.5
            accuracy = 0.5
        else:
            accuracy = correct / total

        # Authority = accuracy (simple formula)
        authority = max(0.0, min(1.0, accuracy))  # Bound to [0.0, 1.0]

        log.debug(
            "Calculated authority",
            user_id=user_id,
            domain=legal_domain,
            total=total,
            correct=correct,
            accuracy=accuracy,
            authority=authority,
        )

        return authority

    async def _get_entity_vote_stats(
        self,
        session: AsyncSession,
        user_id: str,
        legal_domain: str,
    ) -> Dict[str, int]:
        """
        Get vote stats for entities.

        Returns:
            Dict with 'total' and 'correct' counts
        """
        # Get user's votes for entities with consensus
        stmt = (
            select(EntityVote, PendingEntity)
            .join(PendingEntity, EntityVote.entity_id == PendingEntity.entity_id)
            .where(EntityVote.user_id == user_id)
            .where(EntityVote.vote_type == "accuracy")  # Only accuracy votes count
            .where(PendingEntity.consensus_reached == True)
            .where(PendingEntity.ambito == legal_domain)
        )

        result = await session.execute(stmt)
        votes = result.all()

        total = len(votes)
        correct = 0

        for vote, entity in votes:
            # User is correct if their vote matches consensus type
            user_approved = vote.vote_value == 1
            consensus_approved = entity.consensus_type == "approved"

            if user_approved == consensus_approved:
                correct += 1

        return {"total": total, "correct": correct}

    async def _get_relation_vote_stats(
        self,
        session: AsyncSession,
        user_id: str,
        legal_domain: str,
    ) -> Dict[str, int]:
        """Get vote stats for relations."""
        stmt = (
            select(RelationVote, PendingRelation)
            .join(PendingRelation, RelationVote.relation_id == PendingRelation.relation_id)
            .where(RelationVote.user_id == user_id)
            .where(RelationVote.vote_type == "accuracy")
            .where(PendingRelation.consensus_reached == True)
            .where(RelationVote.legal_domain == legal_domain)
        )

        result = await session.execute(stmt)
        votes = result.all()

        total = len(votes)
        correct = 0

        for vote, relation in votes:
            user_approved = vote.vote_value == 1
            consensus_approved = relation.consensus_type == "approved"

            if user_approved == consensus_approved:
                correct += 1

        return {"total": total, "correct": correct}

    async def _get_amendment_vote_stats(
        self,
        session: AsyncSession,
        user_id: str,
        legal_domain: str,
    ) -> Dict[str, int]:
        """Get vote stats for amendments."""
        stmt = (
            select(AmendmentVote, PendingAmendment)
            .join(PendingAmendment, AmendmentVote.amendment_id == PendingAmendment.amendment_id)
            .where(AmendmentVote.user_id == user_id)
            .where(AmendmentVote.vote_type == "accuracy")
            .where(PendingAmendment.consensus_reached == True)
            .where(AmendmentVote.legal_domain == legal_domain)
        )

        result = await session.execute(stmt)
        votes = result.all()

        total = len(votes)
        correct = 0

        for vote, amendment in votes:
            user_approved = vote.vote_value == 1
            consensus_approved = amendment.consensus_type == "approved"

            if user_approved == consensus_approved:
                correct += 1

        return {"total": total, "correct": correct}

    async def update_user_domain_authority(
        self,
        session: AsyncSession,
        user_id: str,
        legal_domain: str,
    ) -> UserDomainAuthority:
        """
        Calculate and persist user's domain authority.

        Args:
            session: DB session
            user_id: User ID
            legal_domain: Legal domain

        Returns:
            Updated UserDomainAuthority instance
        """
        # Calculate stats
        entity_stats = await self._get_entity_vote_stats(session, user_id, legal_domain)
        relation_stats = await self._get_relation_vote_stats(session, user_id, legal_domain)
        amendment_stats = await self._get_amendment_vote_stats(session, user_id, legal_domain)

        total_feedbacks = entity_stats["total"] + relation_stats["total"] + amendment_stats["total"]
        correct_feedbacks = entity_stats["correct"] + relation_stats["correct"] + amendment_stats["correct"]

        accuracy_score = correct_feedbacks / total_feedbacks if total_feedbacks > 0 else 0.0
        domain_authority = max(0.0, min(1.0, accuracy_score)) if total_feedbacks > 0 else 0.5

        # Upsert UserDomainAuthority
        stmt = select(UserDomainAuthority).where(
            UserDomainAuthority.user_id == user_id, UserDomainAuthority.legal_domain == legal_domain
        )
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()

        if record:
            # Update existing
            record.total_feedbacks = total_feedbacks
            record.correct_feedbacks = correct_feedbacks
            record.accuracy_score = accuracy_score
            record.domain_authority = domain_authority
            record.last_calculated_at = datetime.now()
        else:
            # Create new
            record = UserDomainAuthority(
                user_id=user_id,
                legal_domain=legal_domain,
                total_feedbacks=total_feedbacks,
                correct_feedbacks=correct_feedbacks,
                accuracy_score=accuracy_score,
                domain_authority=domain_authority,
            )
            session.add(record)

        await session.commit()

        log.info(
            "Updated domain authority",
            user_id=user_id,
            domain=legal_domain,
            authority=domain_authority,
            total=total_feedbacks,
            correct=correct_feedbacks,
        )

        return record

    async def get_user_authority(
        self,
        session: AsyncSession,
        user_id: str,
        legal_domain: str,
        recalculate: bool = False,
    ) -> float:
        """
        Get user's cached authority or recalculate if needed.

        Args:
            session: DB session
            user_id: User ID
            legal_domain: Legal domain
            recalculate: Force recalculation

        Returns:
            Authority score (0.5 default if no data)
        """
        if recalculate:
            record = await self.update_user_domain_authority(session, user_id, legal_domain)
            return record.domain_authority

        # Try to get cached value
        stmt = select(UserDomainAuthority).where(
            UserDomainAuthority.user_id == user_id, UserDomainAuthority.legal_domain == legal_domain
        )
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()

        if record:
            return record.domain_authority

        # No cached value → calculate and cache
        record = await self.update_user_domain_authority(session, user_id, legal_domain)
        return record.domain_authority

    async def get_user_authority_for_vote(
        self,
        session: AsyncSession,
        user_id: str,
        legal_domain: str,
    ) -> float:
        """
        Get user's authority for voting (wrapper for get_user_authority).

        Use this when recording a new vote to populate voter_authority field.

        Args:
            session: DB session
            user_id: User ID
            legal_domain: Legal domain

        Returns:
            Authority score (0.5 default if no data)
        """
        return await self.get_user_authority(session, user_id, legal_domain)

    async def recalculate_all_authorities(
        self,
        session: AsyncSession,
        legal_domain: Optional[str] = None,
    ) -> int:
        """
        Batch recalculate authorities for all users.

        Args:
            session: DB session
            legal_domain: Optional filter for specific domain

        Returns:
            Number of users updated
        """
        log.info("Recalculating all domain authorities", domain=legal_domain)

        # Get distinct (user_id, legal_domain) pairs from votes
        # Entity votes
        entity_stmt = (
            select(EntityVote.user_id, EntityVote.legal_domain)
            .where(EntityVote.legal_domain.isnot(None))
            .distinct()
        )

        if legal_domain:
            entity_stmt = entity_stmt.where(EntityVote.legal_domain == legal_domain)

        entity_result = await session.execute(entity_stmt)
        entity_pairs = entity_result.all()

        # Relation votes
        relation_stmt = (
            select(RelationVote.user_id, RelationVote.legal_domain)
            .where(RelationVote.legal_domain.isnot(None))
            .distinct()
        )

        if legal_domain:
            relation_stmt = relation_stmt.where(RelationVote.legal_domain == legal_domain)

        relation_result = await session.execute(relation_stmt)
        relation_pairs = relation_result.all()

        # Amendment votes
        amendment_stmt = (
            select(AmendmentVote.user_id, AmendmentVote.legal_domain)
            .where(AmendmentVote.legal_domain.isnot(None))
            .distinct()
        )

        if legal_domain:
            amendment_stmt = amendment_stmt.where(AmendmentVote.legal_domain == legal_domain)

        amendment_result = await session.execute(amendment_stmt)
        amendment_pairs = amendment_result.all()

        # Combine and deduplicate
        all_pairs = set(entity_pairs + relation_pairs + amendment_pairs)

        count = 0
        for user_id, domain in all_pairs:
            await self.update_user_domain_authority(session, user_id, domain)
            count += 1

        log.info("Recalculation complete", users_updated=count, domain=legal_domain)
        return count


# ====================================================
# CONVENIENCE FUNCTIONS
# ====================================================
async def get_user_authority_for_vote(
    session: AsyncSession,
    user_id: str,
    legal_domain: str,
) -> float:
    """
    Get user's authority for voting (cached or calculated).

    Use this when recording a new vote to populate voter_authority field.

    Args:
        session: DB session
        user_id: User ID
        legal_domain: Legal domain

    Returns:
        Authority score (0.5 default)
    """
    service = DomainAuthorityService()
    return await service.get_user_authority(session, user_id, legal_domain)


async def recalculate_authorities_after_consensus(
    session: AsyncSession,
    affected_users: List[str],
    legal_domain: str,
) -> None:
    """
    Recalculate authorities for users after consensus is reached.

    Call this when a pending item reaches consensus to update
    all voters' authorities.

    Args:
        session: DB session
        affected_users: List of user IDs who voted
        legal_domain: Legal domain
    """
    service = DomainAuthorityService()

    for user_id in affected_users:
        await service.update_user_domain_authority(session, user_id, legal_domain)


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "DomainAuthorityService",
    "get_user_authority_for_vote",
    "recalculate_authorities_after_consensus",
]
