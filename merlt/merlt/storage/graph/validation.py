"""
KG Validation Module
====================

Gestione validazioni community per Knowledge Graph.

Funzionalità:
- PendingValidation: nodi/relazioni in attesa di validazione
- ValidationVote: voti pesati per authority
- Workflow di approvazione/rifiuto automatico
- Query per validation queue

Schema Cypher:
    (:PendingValidation {
        id: string,
        type: string,              // "ingestion", "relation", "enrichment"
        target_urn: string,
        contributor_id: string,
        contributor_authority: float,
        source: string,
        trigger: string,
        proposed_data: string,     // JSON serialized
        created_at: datetime,
        expires_at: datetime,
        approvals: float,          // Somma pesata voti positivi
        rejections: float,         // Somma pesata voti negativi
        required_approvals: float,
        status: string             // "pending", "approved", "rejected", "expired"
    })

    (:ValidationVote {
        id: string,
        pending_id: string,
        voter_id: string,
        voter_authority: float,
        vote: boolean,
        reason: string?,
        created_at: datetime
    })

Esempio:
    >>> from merlt.storage.graph.validation import ValidationService
    >>> service = ValidationService(falkordb_client)
    >>> pending_id = await service.create_pending(...)
    >>> await service.add_vote(pending_id, voter_id, authority, True)
"""

import structlog
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any, Tuple
from uuid import uuid4
from enum import Enum
import json


log = structlog.get_logger()


# =============================================================================
# ENUMS E DATACLASS
# =============================================================================

class ValidationType(str, Enum):
    """Tipo di validazione."""
    INGESTION = "ingestion"
    RELATION = "relation"
    ENRICHMENT = "enrichment"
    CONCEPT = "concept"


class ValidationStatus(str, Enum):
    """Stato della validazione."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


@dataclass
class PendingValidation:
    """
    Validazione in attesa.

    Attributes:
        id: ID univoco
        type: Tipo di validazione (ingestion, relation, enrichment)
        target_urn: URN dell'oggetto da validare
        contributor_id: ID del contributore
        contributor_authority: Authority del contributore
        source: Fonte della proposta (visualex, manual, etc.)
        trigger: Trigger che ha causato la proposta
        proposed_data: Dati proposti (serializzati JSON)
        created_at: Timestamp creazione
        expires_at: Timestamp scadenza
        approvals: Somma pesata voti positivi
        rejections: Somma pesata voti negativi
        required_approvals: Soglia per approvazione
        status: Stato corrente
    """
    id: str
    type: ValidationType
    target_urn: str
    contributor_id: str
    contributor_authority: float
    source: str
    trigger: str
    proposed_data: Dict[str, Any]
    created_at: datetime
    expires_at: datetime
    approvals: float = 0.0
    rejections: float = 0.0
    required_approvals: float = 2.0
    status: ValidationStatus = ValidationStatus.PENDING

    @property
    def is_approved(self) -> bool:
        """Verifica se approvato."""
        return self.approvals >= self.required_approvals

    @property
    def is_rejected(self) -> bool:
        """Verifica se rifiutato."""
        return self.rejections >= self.required_approvals

    @property
    def is_expired(self) -> bool:
        """Verifica se scaduto."""
        return datetime.now() > self.expires_at

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario."""
        return {
            "id": self.id,
            "type": self.type.value,
            "target_urn": self.target_urn,
            "contributor_id": self.contributor_id,
            "contributor_authority": self.contributor_authority,
            "source": self.source,
            "trigger": self.trigger,
            "proposed_data": self.proposed_data,
            "created_at": self.created_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "approvals": self.approvals,
            "rejections": self.rejections,
            "required_approvals": self.required_approvals,
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PendingValidation":
        """Crea da dizionario."""
        return cls(
            id=data["id"],
            type=ValidationType(data["type"]),
            target_urn=data["target_urn"],
            contributor_id=data["contributor_id"],
            contributor_authority=float(data["contributor_authority"]),
            source=data["source"],
            trigger=data["trigger"],
            proposed_data=data.get("proposed_data", {}),
            created_at=datetime.fromisoformat(data["created_at"]),
            expires_at=datetime.fromisoformat(data["expires_at"]),
            approvals=float(data.get("approvals", 0)),
            rejections=float(data.get("rejections", 0)),
            required_approvals=float(data.get("required_approvals", 2.0)),
            status=ValidationStatus(data.get("status", "pending")),
        )


@dataclass
class ValidationVote:
    """
    Voto di validazione.

    Attributes:
        id: ID univoco
        pending_id: ID della PendingValidation
        voter_id: ID del votante
        voter_authority: Authority del votante
        vote: True=approva, False=rifiuta
        reason: Motivazione (opzionale)
        created_at: Timestamp del voto
    """
    id: str
    pending_id: str
    voter_id: str
    voter_authority: float
    vote: bool
    reason: Optional[str]
    created_at: datetime

    @property
    def weight(self) -> float:
        """Peso del voto (= authority)."""
        return self.voter_authority

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario."""
        return {
            "id": self.id,
            "pending_id": self.pending_id,
            "voter_id": self.voter_id,
            "voter_authority": self.voter_authority,
            "vote": self.vote,
            "reason": self.reason,
            "created_at": self.created_at.isoformat(),
        }


# =============================================================================
# VALIDATION SERVICE
# =============================================================================

class ValidationService:
    """
    Servizio per gestione validazioni community.

    Esempio:
        >>> service = ValidationService(falkordb_client)
        >>> pending_id = await service.create_pending(
        ...     type=ValidationType.RELATION,
        ...     target_urn="urn:source->urn:target",
        ...     contributor_id="user-123",
        ...     contributor_authority=0.5,
        ...     source="visualex",
        ...     trigger="dossier_grouping",
        ...     proposed_data={"relation_type": "RELATED_TO"},
        ... )
        >>> await service.add_vote(pending_id, "voter-456", 0.8, True)
    """

    # Costanti di default
    DEFAULT_REQUIRED_APPROVALS = 2.0
    DEFAULT_EXPIRATION_DAYS = 7

    def __init__(
        self,
        falkordb_client: Any,
        required_approvals: float = DEFAULT_REQUIRED_APPROVALS,
        expiration_days: int = DEFAULT_EXPIRATION_DAYS,
    ):
        """
        Inizializza servizio.

        Args:
            falkordb_client: Client FalkorDB
            required_approvals: Soglia voti per approvazione
            expiration_days: Giorni prima della scadenza
        """
        self.client = falkordb_client
        self.required_approvals = required_approvals
        self.expiration_days = expiration_days

        log.info(
            "ValidationService initialized",
            required_approvals=required_approvals,
            expiration_days=expiration_days,
        )

    # -------------------------------------------------------------------------
    # CRUD PENDING VALIDATIONS
    # -------------------------------------------------------------------------

    async def create_pending(
        self,
        type: ValidationType,
        target_urn: str,
        contributor_id: str,
        contributor_authority: float,
        source: str,
        trigger: str,
        proposed_data: Optional[Dict[str, Any]] = None,
        required_approvals: Optional[float] = None,
    ) -> str:
        """
        Crea una nuova pending validation.

        Args:
            type: Tipo di validazione
            target_urn: URN dell'oggetto da validare
            contributor_id: ID del contributore
            contributor_authority: Authority del contributore
            source: Fonte della proposta
            trigger: Trigger che ha causato la proposta
            proposed_data: Dati proposti
            required_approvals: Soglia per approvazione (override)

        Returns:
            ID della pending validation creata
        """
        pending_id = str(uuid4())
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=self.expiration_days)
        req_approvals = required_approvals or self.required_approvals

        cypher = """
            CREATE (p:PendingValidation {
                id: $id,
                type: $type,
                target_urn: $target_urn,
                contributor_id: $contributor_id,
                contributor_authority: $contributor_authority,
                source: $source,
                trigger: $trigger,
                proposed_data: $proposed_data,
                created_at: $created_at,
                expires_at: $expires_at,
                approvals: 0.0,
                rejections: 0.0,
                required_approvals: $required_approvals,
                status: 'pending'
            })
            RETURN p.id
        """

        await self.client.query(cypher, {
            "id": pending_id,
            "type": type.value,
            "target_urn": target_urn,
            "contributor_id": contributor_id,
            "contributor_authority": contributor_authority,
            "source": source,
            "trigger": trigger,
            "proposed_data": json.dumps(proposed_data or {}),
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "required_approvals": req_approvals,
        })

        log.info(
            "Created pending validation",
            pending_id=pending_id,
            type=type.value,
            target_urn=target_urn,
            contributor=contributor_id,
        )

        return pending_id

    async def get_pending(self, pending_id: str) -> Optional[PendingValidation]:
        """
        Recupera una pending validation per ID.

        Args:
            pending_id: ID della pending validation

        Returns:
            PendingValidation o None se non trovata
        """
        cypher = """
            MATCH (p:PendingValidation {id: $id})
            RETURN p
        """

        results = await self.client.query(cypher, {"id": pending_id})

        if not results:
            return None

        props = results[0].get("p", {}).get("properties", {})
        if not props:
            return None

        # Parse proposed_data da JSON
        proposed_data = {}
        if props.get("proposed_data"):
            try:
                proposed_data = json.loads(props["proposed_data"])
            except json.JSONDecodeError:
                proposed_data = {}

        return PendingValidation(
            id=props["id"],
            type=ValidationType(props["type"]),
            target_urn=props["target_urn"],
            contributor_id=props["contributor_id"],
            contributor_authority=float(props["contributor_authority"]),
            source=props["source"],
            trigger=props["trigger"],
            proposed_data=proposed_data,
            created_at=datetime.fromisoformat(props["created_at"]),
            expires_at=datetime.fromisoformat(props["expires_at"]),
            approvals=float(props.get("approvals", 0)),
            rejections=float(props.get("rejections", 0)),
            required_approvals=float(props.get("required_approvals", 2.0)),
            status=ValidationStatus(props.get("status", "pending")),
        )

    async def list_pending(
        self,
        status: Optional[ValidationStatus] = None,
        type: Optional[ValidationType] = None,
        exclude_voter: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> List[PendingValidation]:
        """
        Lista pending validations con filtri.

        Args:
            status: Filtra per stato
            type: Filtra per tipo
            exclude_voter: Escludi pending già votate da questo utente
            limit: Numero massimo di risultati
            offset: Offset per paginazione

        Returns:
            Lista di PendingValidation
        """
        conditions = []
        params = {"limit": limit, "offset": offset}

        if status:
            conditions.append("p.status = $status")
            params["status"] = status.value
        else:
            conditions.append("p.status = 'pending'")

        if type:
            conditions.append("p.type = $type")
            params["type"] = type.value

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        if exclude_voter:
            cypher = f"""
                MATCH (p:PendingValidation)
                WHERE {where_clause}
                AND NOT EXISTS {{
                    MATCH (v:ValidationVote {{pending_id: p.id, voter_id: $voter_id}})
                }}
                RETURN p
                ORDER BY p.created_at DESC
                SKIP $offset
                LIMIT $limit
            """
            params["voter_id"] = exclude_voter
        else:
            cypher = f"""
                MATCH (p:PendingValidation)
                WHERE {where_clause}
                RETURN p
                ORDER BY p.created_at DESC
                SKIP $offset
                LIMIT $limit
            """

        results = await self.client.query(cypher, params)

        pending_list = []
        for row in results:
            props = row.get("p", {}).get("properties", {})
            if not props:
                continue

            proposed_data = {}
            if props.get("proposed_data"):
                try:
                    proposed_data = json.loads(props["proposed_data"])
                except json.JSONDecodeError:
                    pass

            pending_list.append(PendingValidation(
                id=props["id"],
                type=ValidationType(props["type"]),
                target_urn=props["target_urn"],
                contributor_id=props["contributor_id"],
                contributor_authority=float(props["contributor_authority"]),
                source=props["source"],
                trigger=props["trigger"],
                proposed_data=proposed_data,
                created_at=datetime.fromisoformat(props["created_at"]),
                expires_at=datetime.fromisoformat(props["expires_at"]),
                approvals=float(props.get("approvals", 0)),
                rejections=float(props.get("rejections", 0)),
                required_approvals=float(props.get("required_approvals", 2.0)),
                status=ValidationStatus(props.get("status", "pending")),
            ))

        return pending_list

    # -------------------------------------------------------------------------
    # VOTING
    # -------------------------------------------------------------------------

    async def add_vote(
        self,
        pending_id: str,
        voter_id: str,
        voter_authority: float,
        vote: bool,
        reason: Optional[str] = None,
    ) -> Tuple[bool, str, Optional[ValidationStatus]]:
        """
        Aggiunge un voto a una pending validation.

        Args:
            pending_id: ID della pending validation
            voter_id: ID del votante
            voter_authority: Authority del votante
            vote: True=approva, False=rifiuta
            reason: Motivazione (opzionale)

        Returns:
            Tupla (success, message, new_status)
            new_status è non-None se lo status è cambiato
        """
        # Verifica che pending esista e sia pending
        pending = await self.get_pending(pending_id)
        if not pending:
            return False, "Pending validation not found", None

        if pending.status != ValidationStatus.PENDING:
            return False, f"Pending validation already {pending.status.value}", None

        # Verifica che utente non abbia già votato
        check_result = await self.client.query(
            """
            MATCH (v:ValidationVote {pending_id: $pending_id, voter_id: $voter_id})
            RETURN v.id
            """,
            {"pending_id": pending_id, "voter_id": voter_id}
        )

        if check_result:
            return False, "User has already voted", None

        # Crea voto
        vote_id = str(uuid4())
        now = datetime.now(timezone.utc)

        await self.client.query(
            """
            CREATE (v:ValidationVote {
                id: $vote_id,
                pending_id: $pending_id,
                voter_id: $voter_id,
                voter_authority: $authority,
                vote: $vote,
                reason: $reason,
                created_at: $timestamp
            })
            """,
            {
                "vote_id": vote_id,
                "pending_id": pending_id,
                "voter_id": voter_id,
                "authority": voter_authority,
                "vote": vote,
                "reason": reason or "",
                "timestamp": now.isoformat(),
            }
        )

        # Aggiorna conteggi
        field = "approvals" if vote else "rejections"
        await self.client.query(
            f"""
            MATCH (p:PendingValidation {{id: $id}})
            SET p.{field} = p.{field} + $weight
            """,
            {"id": pending_id, "weight": voter_authority}
        )

        # Verifica se raggiunto threshold
        new_status = await self._check_and_update_status(pending_id)

        log.info(
            "Vote added",
            pending_id=pending_id,
            voter_id=voter_id,
            vote=vote,
            new_status=new_status.value if new_status else None,
        )

        message = "Vote recorded"
        if new_status:
            message = f"Vote recorded, validation {new_status.value}"

        return True, message, new_status

    async def _check_and_update_status(
        self,
        pending_id: str,
    ) -> Optional[ValidationStatus]:
        """
        Verifica se threshold raggiunto e aggiorna status.

        Returns:
            Nuovo status se cambiato, None altrimenti
        """
        result = await self.client.query(
            """
            MATCH (p:PendingValidation {id: $id})
            RETURN p.approvals AS approvals,
                   p.rejections AS rejections,
                   p.required_approvals AS required
            """,
            {"id": pending_id}
        )

        if not result:
            return None

        approvals = float(result[0].get("approvals", 0))
        rejections = float(result[0].get("rejections", 0))
        required = float(result[0].get("required", self.required_approvals))

        new_status = None

        if approvals >= required:
            new_status = ValidationStatus.APPROVED
        elif rejections >= required:
            new_status = ValidationStatus.REJECTED

        if new_status:
            await self.client.query(
                "MATCH (p:PendingValidation {id: $id}) SET p.status = $status",
                {"id": pending_id, "status": new_status.value}
            )

        return new_status

    async def get_votes(self, pending_id: str) -> List[ValidationVote]:
        """
        Recupera tutti i voti per una pending validation.

        Args:
            pending_id: ID della pending validation

        Returns:
            Lista di ValidationVote
        """
        results = await self.client.query(
            """
            MATCH (v:ValidationVote {pending_id: $pending_id})
            RETURN v
            ORDER BY v.created_at ASC
            """,
            {"pending_id": pending_id}
        )

        votes = []
        for row in results:
            props = row.get("v", {}).get("properties", {})
            if not props:
                continue

            votes.append(ValidationVote(
                id=props["id"],
                pending_id=props["pending_id"],
                voter_id=props["voter_id"],
                voter_authority=float(props["voter_authority"]),
                vote=props["vote"],
                reason=props.get("reason"),
                created_at=datetime.fromisoformat(props["created_at"]),
            ))

        return votes

    # -------------------------------------------------------------------------
    # CLEANUP & MAINTENANCE
    # -------------------------------------------------------------------------

    async def expire_old_validations(self) -> int:
        """
        Scade validazioni oltre la data di scadenza.

        Returns:
            Numero di validazioni scadute
        """
        now = datetime.now(timezone.utc)

        result = await self.client.query(
            """
            MATCH (p:PendingValidation)
            WHERE p.status = 'pending'
            AND p.expires_at < $now
            SET p.status = 'expired'
            RETURN count(p) AS count
            """,
            {"now": now.isoformat()}
        )

        count = result[0].get("count", 0) if result else 0

        if count > 0:
            log.info(f"Expired {count} old pending validations")

        return count

    async def cleanup_old_votes(self, days: int = 90) -> int:
        """
        Rimuove voti vecchi per validazioni già processate.

        Args:
            days: Cancella voti più vecchi di N giorni

        Returns:
            Numero di voti rimossi
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        result = await self.client.query(
            """
            MATCH (v:ValidationVote)
            WHERE v.created_at < $cutoff
            AND EXISTS {
                MATCH (p:PendingValidation {id: v.pending_id})
                WHERE p.status IN ['approved', 'rejected', 'expired']
            }
            DELETE v
            RETURN count(v) AS count
            """,
            {"cutoff": cutoff.isoformat()}
        )

        count = result[0].get("count", 0) if result else 0

        if count > 0:
            log.info(f"Cleaned up {count} old votes")

        return count

    # -------------------------------------------------------------------------
    # STATISTICS
    # -------------------------------------------------------------------------

    async def get_stats(self) -> Dict[str, Any]:
        """
        Recupera statistiche sulle validazioni.

        Returns:
            Dict con statistiche
        """
        result = await self.client.query("""
            MATCH (p:PendingValidation)
            WITH p.status AS status, count(p) AS count
            RETURN collect({status: status, count: count}) AS by_status
        """)

        by_status = {}
        if result and result[0].get("by_status"):
            for item in result[0]["by_status"]:
                by_status[item["status"]] = item["count"]

        vote_result = await self.client.query("""
            MATCH (v:ValidationVote)
            RETURN count(v) AS total_votes
        """)

        total_votes = vote_result[0].get("total_votes", 0) if vote_result else 0

        return {
            "by_status": by_status,
            "total_pending": by_status.get("pending", 0),
            "total_approved": by_status.get("approved", 0),
            "total_rejected": by_status.get("rejected", 0),
            "total_expired": by_status.get("expired", 0),
            "total_votes": total_votes,
        }


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "ValidationType",
    "ValidationStatus",
    "PendingValidation",
    "ValidationVote",
    "ValidationService",
]
