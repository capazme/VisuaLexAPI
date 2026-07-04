"""
Graph API Router
================

Endpoints for graph querying and navigation.

Fornisce endpoint per:
- Verificare se un articolo esiste nel grafo
- Recuperare dettagli di nodi specifici
- Navigazione Q&A ↔ Graph
- Ricerca entità (incluse pending) per autocomplete
- **Risoluzione norme** per ProposeRelationDrawer

Integrazione:
- FalkorDB per query Cypher
- PostgreSQL per entità pending
- Supporta frontend VisuaLex per interactive sources
"""

import asyncio
import hashlib
import os
import structlog
from redis import Redis
from rq import Queue, Retry
from rq.job import Job
from rq.exceptions import NoSuchJobError
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.enrichment import get_db_session_dependency, PendingEntity
from merlt.api.models.enrichment_models import NormResolveRequest, NormResolveResponse
from merlt.pipeline.enrichment.models import EntityType

# Import mapping from local utilities
from merlt.utils import NORMATTIVA_URN_CODICI
from merlt.utils.urn_labels import build_node_label, article_label_from_urn

# TODO: Implement full URN generation locally
# For now, generate_urn returns None and callers handle it gracefully
def generate_urn(*args, **kwargs):
    """
    Placeholder for URN generation.

    Full implementation requires visualex-api HTTP call.
    TODO: Add HTTP endpoint to visualex-api for URN generation.
    """
    return None

log = structlog.get_logger()

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/check-article")
async def check_article_in_graph(
    article_urn: str,
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, Any]:
    """
    Verifica se un articolo esiste nel knowledge graph.

    Args:
        article_urn: URN dell'articolo (es. "urn:lex:it:codice.civile:1942;art1218")

    Returns:
        {
            "exists": bool,
            "node_id": str (se esiste),
            "pending_validation": bool (se ha entità pending)
        }

    Example:
        >>> GET /api/v1/graph/check-article?article_urn=urn:lex:it:codice.civile:1942;art1218
        {
            "exists": true,
            "node_id": "art:1218:cc",
            "pending_validation": false
        }
    """
    log.info("Checking article in graph", article_urn=article_urn)

    # Create and connect graph client
    graph_client = FalkorDBClient()
    await graph_client.connect()

    try:
        query = """
        MATCH (a:Norma)
        WHERE a.URN = $urn OR a.node_id = $urn
        RETURN
            COALESCE(a.node_id, a.URN) as node_id,
            false as pending_validation
        """

        result = await graph_client.query(query, {"urn": article_urn})

        if result and len(result) > 0:
            node_data = result[0]
            log.info(
                "Article found in graph",
                article_urn=article_urn,
                node_id=node_data["node_id"],
                pending_validation=node_data["pending_validation"]
            )
            return {
                "exists": True,
                "node_id": node_data["node_id"],
                "pending_validation": node_data["pending_validation"]
            }
        else:
            log.info("Article not found in graph", article_urn=article_urn)
            return {"exists": False}

    except Exception as e:
        log.error(f"Error checking article in graph: {e}", article_urn=article_urn, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Graph query failed: {str(e)}")
    finally:
        await graph_client.close()


@router.get("/node/{node_id}")
async def get_node_details(
    node_id: str,
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, Any]:
    """
    Recupera dettagli completi di un nodo del grafo.

    Args:
        node_id: ID del nodo (es. "art:1218:cc")

    Returns:
        {
            "node": {...},  # Node properties
            "relations": [...]  # Outgoing relations
        }

    Example:
        >>> GET /api/v1/graph/node/art:1218:cc
        {
            "node": {
                "id": "art:1218:cc",
                "urn": "urn:lex:it:codice.civile:1942;art1218",
                "text": "Il debitore che non esegue esattamente...",
                "tipo_atto": "codice civile"
            },
            "relations": [
                {"type": "HAS_ENTITY", "target": {...}},
                {"type": "CITES", "target": {...}}
            ]
        }
    """
    log.info("Fetching node details", node_id=node_id)

    # Create and connect graph client
    graph_client = FalkorDBClient()
    await graph_client.connect()

    try:
        query = """
        MATCH (n {id: $node_id})
        OPTIONAL MATCH (n)-[r]->(m)
        RETURN
            n as node,
            collect({
                type: type(r),
                target_id: m.id,
                target_label: labels(m)[0]
            }) as relations
        """

        result = await graph_client.query(query, {"node_id": node_id})

        if result and len(result) > 0:
            node_data = result[0]["node"]
            relations = result[0]["relations"]

            log.info(
                "Node details retrieved",
                node_id=node_id,
                relations_count=len(relations)
            )

            return {
                "node": node_data,
                "relations": relations
            }
        else:
            log.warning("Node not found", node_id=node_id)
            raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error fetching node details: {e}", node_id=node_id, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Graph query failed: {str(e)}")
    finally:
        await graph_client.close()


@router.get("/article-entities")
async def get_article_entities_query(
    article_urn: str,
    validation_status: Optional[str] = None,
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, Any]:
    """Query-parameter variant of article entities (avoids URN-in-path issues)."""
    return await get_article_entities(article_urn, validation_status)


@router.get("/article/{article_urn}/entities")
async def get_article_entities(
    article_urn: str,
    validation_status: Optional[str] = None,
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, Any]:
    """
    Recupera tutte le entità associate a un articolo.

    Args:
        article_urn: URN dell'articolo
        validation_status: Filtra per stato validazione (pending, approved, rejected)

    Returns:
        {
            "article_urn": str,
            "entities": [...]
        }

    Example:
        >>> GET /api/v1/graph/article/urn:lex:it:codice.civile:1942;art1218/entities?validation_status=approved
        {
            "article_urn": "urn:lex:it:codice.civile:1942;art1218",
            "entities": [
                {
                    "entity_id": "principio:abc123",
                    "entity_type": "principio",
                    "entity_text": "Responsabilità contrattuale",
                    "validation_status": "approved"
                }
            ]
        }
    """
    log.info("Fetching article entities", article_urn=article_urn, validation_status=validation_status)

    # Create and connect graph client
    graph_client = FalkorDBClient()
    await graph_client.connect()

    try:
        # Build query - match Norma by URN (uppercase property)
        # then follow all outgoing relations to find connected entities
        query = """
        MATCH (a:Norma)
        WHERE a.URN = $urn OR a.node_id = $urn
        WITH a
        MATCH (a)-[r]->(e)
        WHERE NOT e:Comma
        """

        if validation_status:
            query += " AND e.validation_status = $status"

        query += """
        RETURN
            COALESCE(e.node_id, e.URN, id(e)) as entity_id,
            labels(e)[0] as entity_type,
            COALESCE(e.nome, e.estremi, e.titolo, e.testo_vigente) as entity_text,
            COALESCE(e.validation_status, 'approved') as validation_status,
            COALESCE(e.approval_score, 0.0) as approval_score,
            type(r) as relation_type
        """

        params = {"urn": article_urn}
        if validation_status:
            params["status"] = validation_status

        result = await graph_client.query(query, params)

        entities = [
            {
                "entity_id": row["entity_id"],
                "entity_type": row["entity_type"],
                "entity_text": row["entity_text"],
                "validation_status": row["validation_status"],
                "approval_score": row.get("approval_score", 0.0),
                "relation_type": row.get("relation_type"),
            }
            for row in result
            if row.get("entity_text")  # Skip nodes without text
        ]

        log.info(
            "Article entities retrieved",
            article_urn=article_urn,
            entities_count=len(entities)
        )

        return {
            "article_urn": article_urn,
            "entities": entities
        }

    except Exception as e:
        log.error(f"Error fetching article entities: {e}", article_urn=article_urn, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Graph query failed: {str(e)}")
    finally:
        await graph_client.close()


@router.get("/article-relations")
async def get_article_relations_query(
    article_urn: str,
    relation_type: Optional[str] = None,
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, Any]:
    """Query-parameter variant of article relations (avoids URN-in-path issues)."""
    return await get_article_relations(article_urn, relation_type)


@router.get("/article/{article_urn}/relations")
async def get_article_relations(
    article_urn: str,
    relation_type: Optional[str] = None,
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, Any]:
    """
    Recupera tutte le relazioni di un articolo nel grafo.

    Args:
        article_urn: URN dell'articolo
        relation_type: Tipo relazione per filtrare (opzionale, es. "CITA", "DISCIPLINA")

    Returns:
        {
            "article_urn": str,
            "relations": [
                {
                    "type": str,
                    "target_urn": str,
                    "target_label": str,
                    "confidence": float
                }
            ]
        }

    Example:
        >>> GET /api/v1/graph/article/urn:lex:it:codice.civile:1942;art1218/relations
        {
            "article_urn": "urn:lex:it:codice.civile:1942;art1218",
            "relations": [
                {
                    "type": "DISCIPLINA",
                    "target_urn": "urn:lex:it:codice.civile:1942;art1453",
                    "target_label": "Art. 1453 c.c. - Risoluzione per inadempimento",
                    "confidence": 0.95
                },
                {
                    "type": "ESPRIME_PRINCIPIO",
                    "target_urn": "principio:resp_contrattuale",
                    "target_label": "Responsabilità contrattuale",
                    "confidence": 0.88
                }
            ]
        }

        >>> GET /api/v1/graph/article/urn:lex:it:codice.civile:1942;art1218/relations?relation_type=CITA
        # Solo relazioni di tipo CITA
    """
    log.info("Fetching article relations", article_urn=article_urn, relation_type=relation_type)

    # Create and connect graph client
    graph_client = FalkorDBClient()
    await graph_client.connect()

    try:
        # Build query - match Norma by URN (uppercase property)
        query = """
        MATCH (a:Norma)
        WHERE a.URN = $urn OR a.node_id = $urn
        WITH a
        MATCH (a)-[r]-(target)
        """

        if relation_type:
            query += " WHERE type(r) = $relation_type"

        query += """
        RETURN
            type(r) as relation_type,
            COALESCE(target.URN, target.node_id) as target_urn,
            COALESCE(target.node_id, target.URN) as target_id,
            COALESCE(target.nome, target.rubrica, target.estremi, target.titolo) as target_label,
            labels(target)[0] as target_node_type,
            COALESCE(r.certezza, r.confidence, 0.5) as confidence
        ORDER BY confidence DESC, relation_type ASC
        """

        params = {"urn": article_urn}
        if relation_type:
            params["relation_type"] = relation_type

        result = await graph_client.query(query, params)

        relations = [
            {
                "type": row["relation_type"],
                "target_urn": row.get("target_urn") or row.get("target_id"),
                "target_label": row["target_label"],
                "confidence": float(row["confidence"]),
                # Informazione aggiuntiva utile per frontend
                "target_type": row.get("target_node_type", "Unknown")
            }
            for row in result
        ]

        log.info(
            "Article relations retrieved",
            article_urn=article_urn,
            relations_count=len(relations),
            filtered_by=relation_type
        )

        return {
            "article_urn": article_urn,
            "relations": relations
        }

    except Exception as e:
        log.error(f"Error fetching article relations: {e}", article_urn=article_urn, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Graph query failed: {str(e)}")
    finally:
        await graph_client.close()


def _classify_search_result(entity_id: str, tipo: Optional[str], article_urn: Optional[str]) -> Tuple[str, Optional[str]]:
    """
    Derive ``(type, urn)`` for a search result so the FE can route it (C5).

    - ``type`` is the concept-family tipo when present ("principio"/"concetto"/
      ...), else "norma" for norm ids, else "entity". The FE uses this to
      decide whether a click is a routable article (Norma) or a concept
      (which must NOT trigger article lazy-ingestion).
    - ``urn`` is the entity's attaching ``article_urn`` when available, else the
      id itself when it already looks like a norm URN. ``None`` for pure
      concepts with no article context.

    Args:
        entity_id: The result id (e.g. "principio:abc", "norma:hash", URN).
        tipo: The entity ``tipo`` field (may be None).
        article_urn: The article the entity attaches to (may be None).

    Returns:
        ``(type, urn)``.
    """
    result_type = (tipo or "").strip().lower()
    if not result_type:
        if entity_id.startswith("norma:") or "~art" in entity_id:
            result_type = "norma"
        else:
            result_type = "entity"

    urn: Optional[str] = None
    if article_urn:
        urn = article_urn
    elif "~art" in entity_id or entity_id.startswith("urn:"):
        urn = entity_id

    return result_type, urn


def _is_openable_search_id(entity_id: Optional[str]) -> bool:
    """
    Reject search results whose id can't be opened by the FE (C5).

    Currently drops leaked ``live:`` provisional node ids — they have no stable
    graph URN and clicking them leads nowhere.
    """
    if not entity_id:
        return False
    return not entity_id.strip().lower().startswith("live:")


# Per-label search specs for /entities/search (defect #3a). The graph carries
# ONE :Entity node out of ~27.7k — searching only :Entity returned nothing.
# Each spec drives a small per-label Cypher query; results are merged and
# ranked in Python (type_rank ASC — Norma first). Fields verified against the
# Libro IV seed: Norma has estremi/rubrica/titolo (no nome); concepts and
# principles have nome/descrizione; AttoGiudiziario has estremi/massima.
_SEARCH_LABEL_SPECS: List[Dict[str, Any]] = [
    {
        "label": "Norma",
        "match_fields": ["estremi", "rubrica", "titolo"],
        "name_fields": ["estremi", "rubrica", "titolo"],
        "id_fields": ["URN", "node_id"],
        "article_filter_field": "URN",
        "urn_field": "URN",
        "type_rank": 0,
    },
    {
        "label": "ConcettoGiuridico",
        "match_fields": ["nome", "descrizione"],
        "name_fields": ["nome"],
        "id_fields": ["node_id"],
        "article_filter_field": None,
        "urn_field": None,
        "type_rank": 1,
    },
    {
        "label": "PrincipioGiuridico",
        "match_fields": ["nome", "descrizione"],
        "name_fields": ["nome"],
        "id_fields": ["node_id"],
        "article_filter_field": None,
        "urn_field": None,
        "type_rank": 1,
    },
    {
        "label": "AttoGiudiziario",
        "match_fields": ["estremi", "massima"],
        "name_fields": ["estremi"],
        "id_fields": ["node_id"],
        "article_filter_field": None,
        "urn_field": None,
        "type_rank": 2,
    },
    {
        "label": "Entity",
        "match_fields": ["nome", "descrizione"],
        "name_fields": ["nome"],
        "id_fields": ["id", "node_id"],
        "article_filter_field": "article_urn",
        "urn_field": "article_urn",
        "type_rank": 3,
        "tipo_field": "tipo",
    },
]


def _build_label_search_cypher(spec: Dict[str, Any], with_article_filter: bool) -> str:
    """Compile one _SEARCH_LABEL_SPECS entry into a per-label search query."""
    match_clause = " OR ".join(
        f"toLower(n.{f}) CONTAINS toLower($q)" for f in spec["match_fields"]
    )
    article_filter = ""
    if with_article_filter:
        article_filter = f"\n               AND n.{spec['article_filter_field']} CONTAINS $article_pattern"
    id_expr = "COALESCE(" + ", ".join(f"n.{f}" for f in spec["id_fields"]) + ")"
    nome_expr = "COALESCE(" + ", ".join(f"n.{f}" for f in spec["name_fields"]) + ")"
    tipo_field = spec.get("tipo_field")
    tipo_expr = f"COALESCE(n.{tipo_field}, '{spec['label']}')" if tipo_field else f"'{spec['label']}'"
    urn_expr = f"n.{spec['urn_field']}" if spec["urn_field"] else "null"
    return f"""
            MATCH (n:{spec['label']})
            WHERE ({match_clause}){article_filter}
            RETURN
                {id_expr} as id,
                {nome_expr} as nome,
                {tipo_expr} as tipo,
                {urn_expr} as article_urn,
                COALESCE(n.approval_score, 0.0) as approval_score,
                COALESCE(n.validation_status, 'approved') as validation_status
            ORDER BY COALESCE(n.approval_score, 0.0) DESC
            LIMIT $limit
            """


@router.get("/entities/search")
async def search_entities(
    q: str,
    article_urn: Optional[str] = None,
    include_pending: bool = True,
    limit: int = 10,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> List[Dict[str, Any]]:
    """
    Ricerca fuzzy entità per autocomplete (grafo + pending).

    Usato in ProposeRelationDrawer per selezionare entità esistenti
    quando si propone una nuova relazione.

    **IMPORTANTE**: Include sia entità approvate (nel grafo) che pending
    (in PostgreSQL). Le relazioni possono ora puntare a entità pending.

    Args:
        q: Query di ricerca (min 2 caratteri)
        article_urn: URN articolo per filtrare (opzionale)
        include_pending: Se includere entità pending (default True)
        limit: Numero massimo risultati (default 10, max 50)

    Returns:
        Lista di entità matching ordinate per:
        1. Approved first (nel grafo)
        2. Exact match sul nome
        3. Approval score DESC

        Ogni entità ha campo `is_pending` per distinguere.

    Example:
        >>> GET /api/v1/graph/entities/search?q=buona%20fede&limit=5
        [
            {
                "id": "principio:abc123",
                "nome": "Buona fede",
                "tipo": "principio",
                "approval_score": 2.5,
                "validation_status": "approved",
                "is_pending": false
            },
            {
                "id": "concetto:def456",
                "nome": "Buona fede oggettiva",
                "tipo": "concetto",
                "approval_score": 0.8,
                "validation_status": "pending",
                "is_pending": true
            }
        ]
    """
    if len(q) < 2:
        return []

    # Limit max results
    limit = min(limit, 50)

    log.info("Searching entities", query=q, article_urn=article_urn, include_pending=include_pending, limit=limit)

    all_entities = []

    # === 1. Search in FalkorDB (approved nodes, all label types — defect #3a) ===
    try:
        graph_client = FalkorDBClient()
        await graph_client.connect()

        try:
            article_pattern: Optional[str] = None
            if article_urn:
                article_pattern = article_urn.split(":")[-1] if ":" in article_urn else article_urn

            seen_graph_ids: set = set()
            for spec in _SEARCH_LABEL_SPECS:
                # When an article filter is requested, labels without an
                # article-bearing field are skipped (strict-filter semantics,
                # same as the legacy :Entity-only query).
                if article_pattern and not spec["article_filter_field"]:
                    continue

                query = _build_label_search_cypher(spec, with_article_filter=bool(article_pattern))
                params: Dict[str, Any] = {"q": q, "limit": limit}
                if article_pattern:
                    params["article_pattern"] = article_pattern

                try:
                    graph_result = await graph_client.query(query, params)
                except Exception as label_exc:
                    log.warning(f"Search on label {spec['label']} failed: {label_exc}")
                    continue

                for row in graph_result:
                    row_id = row.get("id")
                    row_nome = row.get("nome")
                    if not row_id or not row_nome:
                        continue  # nodes without a usable label are noise in autocomplete
                    if row_id in seen_graph_ids:
                        continue
                    if not _is_openable_search_id(row_id):
                        continue
                    seen_graph_ids.add(row_id)
                    result_type, result_urn = _classify_search_result(
                        row_id, row.get("tipo"), row.get("article_urn")
                    )
                    all_entities.append({
                        "id": row_id,
                        "nome": row_nome,
                        "tipo": row.get("tipo"),
                        "type": result_type,
                        "urn": result_urn,
                        "approval_score": row.get("approval_score") or 0.0,
                        "validation_status": row.get("validation_status") or "approved",
                        "is_pending": False,  # In graph = not pending
                        "_type_rank": spec["type_rank"],
                    })

        finally:
            await graph_client.close()

    except Exception as e:
        log.warning(f"FalkorDB search failed, continuing with pending only: {e}")

    # === 2. Search in PostgreSQL (pending entities) ===
    if include_pending:
        try:
            q_lower = q.lower()

            # Build query for pending entities
            stmt = (
                select(PendingEntity)
                .where(PendingEntity.validation_status == "pending")
                .where(
                    or_(
                        PendingEntity.entity_text.ilike(f"%{q_lower}%"),
                        PendingEntity.descrizione.ilike(f"%{q_lower}%"),
                    )
                )
                .order_by(PendingEntity.approval_score.desc())
                .limit(limit)
            )

            # Filter by article_urn if provided
            if article_urn:
                article_pattern = article_urn.split(":")[-1] if ":" in article_urn else article_urn
                stmt = stmt.where(PendingEntity.article_urn.ilike(f"%{article_pattern}%"))

            result = await session.execute(stmt)
            pending_entities = result.scalars().all()

            for entity in pending_entities:
                if not _is_openable_search_id(entity.entity_id):
                    continue
                # Avoid duplicates (same entity_id)
                existing_ids = {e["id"] for e in all_entities}
                if entity.entity_id not in existing_ids:
                    result_type, result_urn = _classify_search_result(
                        entity.entity_id, entity.entity_type, entity.article_urn
                    )
                    all_entities.append({
                        "id": entity.entity_id,
                        "nome": entity.entity_text,
                        "tipo": entity.entity_type,
                        "type": result_type,
                        "urn": result_urn,
                        "approval_score": entity.approval_score or 0.0,
                        "validation_status": "pending",
                        "is_pending": True,
                        # Pending rows always sort after approved (is_pending is
                        # the first sort key), so type ranking barely matters here.
                        "_type_rank": 3,
                    })

        except Exception as e:
            log.warning(f"PostgreSQL pending search failed: {e}")

    # === 3. Sort combined results ===
    # Order: approved first, then exact match, then type rank (Norma first),
    # then approval_score.
    def sort_key(entity):
        is_exact = (entity.get("nome") or "").lower() == q.lower()
        return (
            entity["is_pending"],  # False (approved) first
            0 if is_exact else 1,  # Exact match first
            entity.get("_type_rank", 99),  # Norma → concepts/principles → atti → entity
            -entity["approval_score"],  # Higher score first
        )

    all_entities.sort(key=sort_key)

    # Limit final results, dropping the internal ranking key (payload shape
    # stays id/nome/tipo/type/urn/approval_score/validation_status/is_pending).
    all_entities = all_entities[:limit]
    for entity in all_entities:
        entity.pop("_type_rank", None)

    log.info(
        "Entity search completed",
        query=q,
        total_results=len(all_entities),
        approved_count=sum(1 for e in all_entities if not e["is_pending"]),
        pending_count=sum(1 for e in all_entities if e["is_pending"]),
    )

    return all_entities


# ====================================================
# NORM RESOLVER
# ====================================================

def _generate_norm_entity_id(urn: str) -> str:
    """
    Genera un entity_id deterministico per una norma basato sul suo URN.

    Usa hash MD5 troncato per garantire:
    1. Stesso URN → stesso ID (idempotente)
    2. ID ragionevolmente corto
    3. Unicità pratica

    Example:
        >>> _generate_norm_entity_id("urn:nir:stato:regio.decreto:1942-03-16;262:2~art1218")
        "norma:a1b2c3d4"
    """
    hash_digest = hashlib.md5(urn.encode(), usedforsecurity=False).hexdigest()[:8]
    return f"norma:{hash_digest}"


def _format_display_label(act_type: str, article: str, act_number: str = None, date: str = None) -> str:
    """
    Formatta label per visualizzazione utente.

    Examples:
        >>> _format_display_label("codice civile", "1218")
        "Art. 1218 Codice Civile"

        >>> _format_display_label("legge", "241", "241", "1990")
        "Art. 241 L. 241/1990"
    """
    # Capitalizza tipo atto per display
    act_type_display = act_type.title()

    # Abbreviazioni comuni per atti non-codice
    abbreviations = {
        "legge": "L.",
        "decreto legislativo": "D.Lgs.",
        "decreto legge": "D.L.",
        "decreto del presidente della repubblica": "D.P.R.",
        "regio decreto": "R.D.",
    }

    if act_type.lower() in NORMATTIVA_URN_CODICI:
        # È un codice → "Art. X Codice Y"
        return f"Art. {article} {act_type_display}"
    elif act_type.lower() in abbreviations:
        # È una legge/decreto → "Art. X L. 241/1990"
        abbr = abbreviations[act_type.lower()]
        if act_number and date:
            return f"Art. {article} {abbr} {act_number}/{date}"
        elif act_number:
            return f"Art. {article} {abbr} {act_number}"
        else:
            return f"Art. {article} {abbr}"
    else:
        # Fallback generico
        return f"Art. {article} {act_type_display}"


@router.post("/resolve-norm")
async def resolve_norm(
    request: NormResolveRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> NormResolveResponse:
    """
    Risolve una citazione normativa per ProposeRelationDrawer.

    Flusso:
    1. Genera URN dalla parsed citation (frontend ha già parsato)
    2. Cerca norma nel grafo FalkorDB (approved)
    3. Cerca norma nelle pending entities (PostgreSQL)
    4. Se non trovata → crea PendingEntity tipo=norma

    Questo endpoint permette di creare relazioni verso norme
    che l'utente inserisce in linguaggio naturale (es. "Art. 1218 c.c.")
    senza dover gestire URN direttamente.

    Args:
        request: Dati parsed dal frontend (act_type, article, etc.)

    Returns:
        NormResolveResponse con entity_id da usare in proposeRelation

    Example:
        >>> POST /api/v1/graph/resolve-norm
        >>> {
        >>>     "act_type": "codice civile",
        >>>     "article": "1218",
        >>>     "source_article_urn": "urn:...",
        >>>     "user_id": "user123"
        >>> }
        >>>
        >>> Response:
        >>> {
        >>>     "resolved": true,
        >>>     "entity_id": "norma:a1b2c3d4",
        >>>     "display_label": "Art. 1218 Codice Civile",
        >>>     "urn": "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1218",
        >>>     "exists_in_graph": false,
        >>>     "is_pending": false,
        >>>     "created_pending": true
        >>> }
    """
    log.info(
        "Resolving norm",
        act_type=request.act_type,
        article=request.article,
        act_number=request.act_number,
        date=request.date,
        user_id=request.user_id,
    )

    # === 1. Genera URN ===
    try:
        urn = generate_urn(
            act_type=request.act_type,
            date=request.date,
            act_number=request.act_number,
            article=request.article,
            urn_flag=True,
        )

        if not urn:
            return NormResolveResponse(
                resolved=False,
                error_message=f"Impossibile generare URN per {request.act_type} art. {request.article}",
            )

        log.info("Generated URN", urn=urn)

    except Exception as e:
        log.error(f"URN generation failed: {e}", exc_info=True)
        return NormResolveResponse(
            resolved=False,
            error_message=f"Errore nella generazione URN: {str(e)}",
        )

    # Genera entity_id deterministico basato su URN
    entity_id = _generate_norm_entity_id(urn)
    display_label = _format_display_label(
        request.act_type,
        request.article,
        request.act_number,
        request.date,
    )

    # === 2. Cerca nel grafo FalkorDB ===
    graph_client = FalkorDBClient()
    try:
        await graph_client.connect()

        # Cerca sia per URN esatto che per entity_id
        query = """
        MATCH (n)
        WHERE n.urn = $urn OR n.id = $entity_id
        RETURN n.id as node_id, n.urn as node_urn, labels(n) as labels
        LIMIT 1
        """
        result = await graph_client.query(query, {"urn": urn, "entity_id": entity_id})

        if result and len(result) > 0:
            # Norma esiste nel grafo!
            node_data = result[0]
            log.info(
                "Norm found in graph",
                node_id=node_data["node_id"],
                node_urn=node_data.get("node_urn"),
            )

            return NormResolveResponse(
                resolved=True,
                entity_id=node_data["node_id"],
                display_label=display_label,
                urn=urn,
                exists_in_graph=True,
                is_pending=False,
                created_pending=False,
            )

    except Exception as e:
        log.warning(f"FalkorDB lookup failed, continuing with PostgreSQL: {e}")
    finally:
        await graph_client.close()

    # === 3. Cerca nelle pending entities ===
    try:
        stmt = (
            select(PendingEntity)
            .where(
                or_(
                    PendingEntity.entity_id == entity_id,
                    # Cerca anche per URN parziale nel campo articoli_correlati
                    PendingEntity.article_urn.contains(urn.split("~")[0] if "~" in urn else urn),
                )
            )
            .where(PendingEntity.entity_type == EntityType.NORMA.value)
            .limit(1)
        )
        result = await session.execute(stmt)
        pending_entity = result.scalar_one_or_none()

        if pending_entity:
            log.info(
                "Norm found as pending entity",
                entity_id=pending_entity.entity_id,
                validation_status=pending_entity.validation_status,
            )

            return NormResolveResponse(
                resolved=True,
                entity_id=pending_entity.entity_id,
                display_label=display_label,
                urn=urn,
                exists_in_graph=False,
                is_pending=True,
                created_pending=False,
            )

    except Exception as e:
        log.warning(f"PostgreSQL pending lookup failed: {e}")

    # === 4. Crea nuova PendingEntity tipo=norma ===
    try:
        new_pending = PendingEntity(
            entity_id=entity_id,
            article_urn=urn,  # URN della norma stessa
            source_type="norm_resolver",
            entity_type=EntityType.NORMA.value,
            entity_text=display_label,
            descrizione=f"Norma riferita da {request.source_article_urn}",
            ambito="diritto",
            fonte="user_citation",
            llm_confidence=1.0,  # Citazione utente = alta confidence
            validation_status="pending",
            contributed_by=request.user_id,
            contributor_authority=0.5,  # Default authority
        )

        session.add(new_pending)
        await session.commit()

        log.info(
            "Created pending norm entity",
            entity_id=entity_id,
            display_label=display_label,
            urn=urn,
        )

        return NormResolveResponse(
            resolved=True,
            entity_id=entity_id,
            display_label=display_label,
            urn=urn,
            exists_in_graph=False,
            is_pending=True,
            created_pending=True,
        )

    except Exception as e:
        log.error(f"Failed to create pending norm entity: {e}", exc_info=True)
        await session.rollback()

        return NormResolveResponse(
            resolved=False,
            error_message=f"Errore nella creazione entità pending: {str(e)}",
        )


# ====================================================
# SUBGRAPH VISUALIZATION
# ====================================================

from pydantic import BaseModel, Field
from typing import Literal


class SubgraphNode(BaseModel):
    """Node in subgraph response."""
    id: str = Field(..., description="Unique node identifier")
    urn: Optional[str] = Field(None, description="URN if available")
    type: str = Field(..., description="Node type (Norma, Entity, Principio, etc.)")
    label: str = Field(..., description="Display label")
    properties: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SubgraphEdge(BaseModel):
    """Edge in subgraph response."""
    id: str = Field(..., description="Unique edge identifier")
    source: str = Field(..., description="Source node ID")
    target: str = Field(..., description="Target node ID")
    type: str = Field(..., description="Relation type")
    properties: Dict[str, Any] = Field(default_factory=dict)


class SubgraphMetadata(BaseModel):
    """Metadata for subgraph response."""
    total_nodes: int
    total_edges: int
    depth_reached: int
    root_node_id: str
    query_time_ms: Optional[float] = None
    # True when the edge query hit the max_nodes LIMIT — the FE can surface
    # "risultato troncato" instead of pretending the neighborhood is complete.
    truncated: bool = False


# Only scalar relationship properties are serialized into the edge DTO —
# lists/maps (e.g. embeddings) would bloat the payload for no FE benefit.
_EDGE_SCALAR_TYPES = (str, int, float, bool)


def _edge_properties(raw_props: Any, hop_level: Any) -> Dict[str, Any]:
    """Merge real relationship properties into the edge DTO (defect #8).

    The subgraph RETURNs used to serialize only ``type(r)`` and hardcode
    ``properties={hop_level}`` — dropping ``certezza``, ``fonte``,
    ``tipo_interpretazione`` etc. that EdgeDetailsDrawer renders. ``raw_props``
    is the map produced by ``properties(r)`` in Cypher (None when r is null).
    """
    properties: Dict[str, Any] = {}
    if isinstance(raw_props, dict):
        for key, value in raw_props.items():
            if key.startswith("_"):
                continue  # internal plumbing (e.g. _seed_key), not FE-facing
            if isinstance(value, _EDGE_SCALAR_TYPES):
                properties[key] = value
    if isinstance(hop_level, int) and hop_level > 1:
        properties["hop_level"] = hop_level
    return properties


class SubgraphResponse(BaseModel):
    """Response for subgraph endpoint."""
    nodes: List[SubgraphNode]
    edges: List[SubgraphEdge]
    metadata: SubgraphMetadata


# ====================================================
# LAZY ARTICLE INGESTION (Slice 2a)
# ====================================================


class IngestArticleOptions(BaseModel):
    force_refresh: bool = Field(False, description="Re-ingest anche se l'articolo è già nel grafo")
    bff_job_id: Optional[str] = Field(None, description="ID del job lato BFF (MerltIngestionJob) per il callback")


class IngestArticleRequest(BaseModel):
    urn: str = Field(..., description="URN dell'articolo da ingerire (es. .../art2043)")
    options: Optional[IngestArticleOptions] = Field(None, description="Opzioni di ingestion")


class IngestArticleResponse(BaseModel):
    task_id: str = Field(..., description="ID del job RQ accodato")
    status: str = Field(..., description="'queued' se nuovo job, 'already_queued' se idempotency hit")
    urn: str = Field(..., description="URN normalizzato")


_RQ_QUEUE_NAME = "merlt_ingest"

_rq_connection: Optional[Redis] = None


def _get_rq_queue() -> Queue:
    global _rq_connection
    if _rq_connection is None:
        _rq_connection = Redis.from_url(
            os.getenv("RQ_REDIS_URL", "redis://localhost:6379/1")
        )
    return Queue(_RQ_QUEUE_NAME, connection=_rq_connection)


@router.post("/ingest-article", response_model=IngestArticleResponse, status_code=202)
async def ingest_article(
    request: IngestArticleRequest,
    api_key: ApiKey = Depends(verify_api_key),
) -> IngestArticleResponse:
    """
    Accoda un job di ingestion per un articolo non ancora presente nel grafo.

    Idempotente sull'URN: il job usa un `job_id` derivato da sha256(urn) per
    evitare problemi con caratteri speciali dell'URN come chiave Redis. RQ
    sovrascrive i job con lo stesso id invece di deduplicarli, quindi
    l'idempotenza è gestita con un pre-check esplicito: se esiste già un job
    attivo per l'URN non se ne accoda un altro. Con `force_refresh=True` il
    pre-check viene bypassato e una re-ingestion viene sempre accodata.
    """
    urn = request.urn
    bff_job_id = request.options.bff_job_id if request.options else None
    force_refresh = request.options.force_refresh if request.options else False
    # Job ID uses a dash separator (NOT colon) — RQ ≥ 2.0 validates [A-Za-z0-9_-]
    # via `validate_job_id` (rq/job.py:85). Same fix already applied to the
    # extraction job id (CLAUDE.md Slice 2c gotcha #4).
    job_id = "ingest-" + hashlib.sha256(urn.encode("utf-8")).hexdigest()[:40]

    log.info("Enqueuing article ingestion job", urn=urn, bff_job_id=bff_job_id)

    try:
        queue = await asyncio.to_thread(_get_rq_queue)
    except Exception as e:
        log.error(f"Failed to connect to RQ job queue: {e}", urn=urn, exc_info=True)
        raise HTTPException(status_code=503, detail="Job queue non disponibile")

    # Idempotency: explicit pre-check (RQ enqueue overwrites, doesn't dedupe)
    def _existing_active_job():
        try:
            job = Job.fetch(job_id, connection=queue.connection)
        except NoSuchJobError:
            return None
        except Exception as e:
            log.warning("Job.fetch failed, treating as absent", job_id=job_id, exc=str(e))
            return None
        return job if job.get_status(refresh=True) in ("queued", "started", "deferred", "scheduled") else None

    existing = None
    if not force_refresh:
        existing = await asyncio.to_thread(_existing_active_job)

    if existing is not None:
        log.info("Ingestion job already active, idempotency hit", urn=urn, task_id=job_id)
        return IngestArticleResponse(task_id=job_id, status="already_queued", urn=urn)

    try:
        job = await asyncio.to_thread(
            lambda: queue.enqueue(
                "merlt.worker.tasks.ingest_article",
                urn,
                bff_job_id,
                job_id=job_id,
                job_timeout=600,
                retry=Retry(max=3, interval=[10, 30, 60]),
            )
        )
    except Exception as e:
        log.error(f"Failed to enqueue ingestion job: {e}", urn=urn, exc_info=True)
        raise HTTPException(status_code=503, detail="Job queue non disponibile")

    log.info("Ingestion job queued", urn=urn, task_id=job.id)
    return IngestArticleResponse(task_id=job.id, status="queued", urn=urn)


@router.get("/overview", response_model=SubgraphResponse)
async def get_graph_overview(
    max_nodes: int = 50,
    api_key: ApiKey = Depends(verify_api_key),
) -> SubgraphResponse:
    """
    Return a sample of the knowledge graph for the bulletin board explorer.

    Picks the most-connected Norma nodes and their immediate neighbors
    so the user sees a representative slice of the graph.
    """
    import time
    start_time = time.time()

    if max_nodes > 200:
        max_nodes = 200

    graph_client = FalkorDBClient()
    await graph_client.connect()

    try:
        # Get top-connected Norma nodes + a limited number of neighbors each
        # This ensures diverse seeds rather than one dominating node
        cypher = """
        MATCH (n:Norma)-[r]-(m)
        WITH n, count(r) as degree
        ORDER BY degree DESC
        LIMIT 8
        WITH n as seed
        MATCH (seed)-[r]-(neighbor)
        WITH seed, r, neighbor
        ORDER BY rand()
        WITH seed, collect({r: r, neighbor: neighbor})[0..6] as neighbors
        UNWIND neighbors as nb
        RETURN seed, type(nb.r) as rel_type, nb.neighbor as neighbor,
               id(seed) as source_id, id(nb.neighbor) as target_id
        """

        result = await graph_client.query(cypher, {"max_nodes": max_nodes})

        nodes: List[SubgraphNode] = []
        edges: List[SubgraphEdge] = []
        seen_node_ids: Dict[str, str] = {}

        if result and len(result) > 0:
            for row in result:
                seed = row.get("seed")
                neighbor = row.get("neighbor")
                rel_type = row.get("rel_type")
                source_id = str(row.get("source_id", ""))
                target_id = str(row.get("target_id", ""))

                # Add seed node
                if seed and source_id not in seen_node_ids:
                    node = _parse_graph_node_v2(seed, True)
                    nodes.append(node)
                    seen_node_ids[source_id] = node.id

                # Add neighbor node
                if neighbor and target_id not in seen_node_ids:
                    node = _parse_graph_node_v2(neighbor, True)
                    nodes.append(node)
                    seen_node_ids[target_id] = node.id

                # Add edge
                if source_id in seen_node_ids and target_id in seen_node_ids and rel_type:
                    edge_id = f"{seen_node_ids[source_id]}-{rel_type}-{seen_node_ids[target_id]}"
                    if not any(e.id == edge_id for e in edges):
                        edges.append(SubgraphEdge(
                            id=edge_id,
                            source=seen_node_ids[source_id],
                            target=seen_node_ids[target_id],
                            type=rel_type,
                            properties={},
                        ))

        query_time = (time.time() - start_time) * 1000

        log.info(
            "Graph overview fetched",
            nodes_count=len(nodes),
            edges_count=len(edges),
            query_time_ms=query_time,
        )

        return SubgraphResponse(
            nodes=nodes,
            edges=edges,
            metadata=SubgraphMetadata(
                total_nodes=len(nodes),
                total_edges=len(edges),
                depth_reached=1,
                root_node_id="overview",
                query_time_ms=round(query_time, 2),
            ),
        )
    except Exception as e:
        log.error(f"Error fetching graph overview: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Graph overview failed: {str(e)}")
    finally:
        await graph_client.close()


@router.get("/subgraph", response_model=SubgraphResponse)
async def get_subgraph(
    root_urn: str,
    depth: int = 2,
    relation_types: Optional[str] = None,
    entity_types: Optional[str] = None,
    include_metadata: bool = True,
    max_nodes: int = 100,
    api_key: ApiKey = Depends(verify_api_key),
) -> SubgraphResponse:
    """
    Retrieve subgraph around a root node for visualization.

    Args:
        root_urn: URN or ID of root node (article or entity)
        depth: Max traversal depth (1-3, default 2)
        relation_types: Comma-separated relation types to include (e.g., "DISCIPLINA,ESPRIME_PRINCIPIO")
        entity_types: Comma-separated entity types to include (e.g., "principio,concetto")
        include_metadata: Include approval scores, votes, timestamps
        max_nodes: Maximum nodes to return (default 100, max 200)

    Returns:
        SubgraphResponse with nodes, edges, and metadata

    Example:
        >>> GET /api/v1/graph/subgraph?root_urn=urn:nir:stato:codice.civile:1942;art1453&depth=2
        {
            "nodes": [...],
            "edges": [...],
            "metadata": {"total_nodes": 15, "total_edges": 20, ...}
        }
    """
    import time
    start_time = time.time()

    # Validate depth
    if depth < 1:
        depth = 1
    elif depth > 3:
        depth = 3

    # Validate max_nodes
    if max_nodes > 200:
        max_nodes = 200

    log.info(
        "Fetching subgraph",
        root_urn=root_urn,
        depth=depth,
        relation_types=relation_types,
        entity_types=entity_types,
    )

    # Connect to FalkorDB
    graph_client = FalkorDBClient()
    await graph_client.connect()

    try:
        # --- Root lookup, separate from the edge query. The root must ALWAYS
        # be returned when it exists: an empty `nodes` array is the FE's
        # "article not indexed" signal (Slice 2a gotcha #4), so relation/type
        # filters or the LIMIT must never be able to drop it.
        root_cypher = """
        MATCH (root)
        WHERE root.URN = $root_urn
           OR root.urn = $root_urn
           OR root.node_id = $root_urn
        RETURN root, indegree(root) + outdegree(root) as degree
        LIMIT 1
        """
        root_result = await graph_client.query(root_cypher, {"root_urn": root_urn})

        if not root_result or not root_result[0].get("root"):
            query_time = (time.time() - start_time) * 1000
            log.info("Subgraph root not found", root_urn=root_urn, query_time_ms=query_time)
            return SubgraphResponse(
                nodes=[],
                edges=[],
                metadata=SubgraphMetadata(
                    total_nodes=0,
                    total_edges=0,
                    depth_reached=0,
                    root_node_id=root_urn,
                    query_time_ms=round(query_time, 2),
                    truncated=False,
                ),
            )

        # --- Filters compiled INTO the Cypher (defect #9): filtering in Python
        # after the LIMIT wasted the node budget on rows that were then thrown
        # away. Both filters target the returned edge/neighbor of each row.
        params: Dict[str, Any] = {"root_urn": root_urn, "max_nodes": max_nodes}
        filter_clauses: List[str] = []
        if relation_types:
            # Case-insensitive: the live graph mixes lowercase seed types
            # ("commenta", "contiene") with uppercase enrichment types
            # ("DISCIPLINA"), and the legacy Python filter uppercased both sides.
            allowed_rels = [t.strip().lower() for t in relation_types.split(",") if t.strip()]
            if allowed_rels:
                filter_clauses.append("toLower(type(r)) IN $allowed_rels")
                params["allowed_rels"] = allowed_rels
        if entity_types:
            allowed_types = [t.strip().lower() for t in entity_types.split(",") if t.strip()]
            if allowed_types:
                # Norma nodes always pass (same carve-out as the old Python filter).
                filter_clauses.append(
                    "(toLower(labels(connected)[0]) IN $allowed_types"
                    " OR toLower(labels(connected)[0]) = 'norma')"
                )
                params["allowed_types"] = allowed_types
        where_filter = ("WHERE " + " AND ".join(filter_clauses)) if filter_clauses else ""

        # --- Depth-aware edge query. Ranked deterministic truncation (F4):
        # ORDER BY hop ASC, certezza DESC before LIMIT, so close/strong edges
        # survive the cut first (and hop-1 rows always precede the hop-2 rows
        # that depend on them). `properties(r)` returns the real edge props
        # (defect #8); indegree+outdegree is FalkorDB's O(1) node degree.
        if depth == 1:
            edge_cypher = f"""
            MATCH (root)
            WHERE root.URN = $root_urn
               OR root.urn = $root_urn
               OR root.node_id = $root_urn
            WITH root
            LIMIT 1
            MATCH (root)-[r]-(connected)
            {where_filter}
            WITH root, r, connected, 1 as hop
            ORDER BY hop ASC, COALESCE(r.certezza, 0.5) DESC
            LIMIT $max_nodes
            RETURN type(r) as rel_type, properties(r) as rel_props,
                   connected, hop as hop_level,
                   id(root) as source_id, id(connected) as target_id,
                   indegree(connected) + outdegree(connected) as node_degree
            """
        elif depth == 2:
            edge_cypher = f"""
            MATCH (root)
            WHERE root.URN = $root_urn
               OR root.urn = $root_urn
               OR root.node_id = $root_urn
            WITH root
            LIMIT 1
            CALL {{
                WITH root
                MATCH (root)-[r]-(n1)
                RETURN root as src, r, n1 as dst, 1 as hop
                UNION ALL
                WITH root
                MATCH (root)-[]-(n1)-[r2]-(n2)
                WHERE n2 <> root
                RETURN n1 as src, r2 as r, n2 as dst, 2 as hop
            }}
            WITH src, r, dst as connected, hop
            {where_filter}
            WITH src, r, connected, hop
            ORDER BY hop ASC, COALESCE(r.certezza, 0.5) DESC
            LIMIT $max_nodes
            RETURN type(r) as rel_type, properties(r) as rel_props,
                   connected, hop as hop_level,
                   id(src) as source_id, id(connected) as target_id,
                   indegree(connected) + outdegree(connected) as node_degree
            """
        else:  # depth == 3
            edge_cypher = f"""
            MATCH (root)
            WHERE root.URN = $root_urn
               OR root.urn = $root_urn
               OR root.node_id = $root_urn
            WITH root
            LIMIT 1
            CALL {{
                WITH root
                MATCH (root)-[r]-(n1)
                RETURN root as src, r, n1 as dst, 1 as hop
                UNION ALL
                WITH root
                MATCH (root)-[]-(n1)-[r2]-(n2)
                WHERE n2 <> root
                RETURN n1 as src, r2 as r, n2 as dst, 2 as hop
                UNION ALL
                WITH root
                MATCH (root)-[]-(n1)-[]-(n2)-[r3]-(n3)
                WHERE n3 <> root AND n3 <> n1
                RETURN n2 as src, r3 as r, n3 as dst, 3 as hop
            }}
            WITH src, r, dst as connected, hop
            {where_filter}
            WITH src, r, connected, hop
            ORDER BY hop ASC, COALESCE(r.certezza, 0.5) DESC
            LIMIT $max_nodes
            RETURN type(r) as rel_type, properties(r) as rel_props,
                   connected, hop as hop_level,
                   id(src) as source_id, id(connected) as target_id,
                   indegree(connected) + outdegree(connected) as node_degree
            """

        result = await graph_client.query(edge_cypher, params)

        nodes: List[SubgraphNode] = []
        edges: List[SubgraphEdge] = []
        seen_node_ids: Dict[str, str] = {}  # internal_id -> node_id
        max_hop_reached = 0  # Track actual depth reached

        # Root node from the dedicated lookup
        root_row = root_result[0]
        root_data = root_row["root"]
        root_props = root_data.get("properties", root_data)
        root_internal_id = str(root_data.get("id", ""))
        root_node_id = root_props.get("URN") or root_props.get("urn") or root_props.get("node_id") or root_urn

        root_node = _parse_graph_node_v2(root_data, include_metadata)
        root_degree = root_row.get("degree")
        if isinstance(root_degree, (int, float)):
            root_node.metadata["degree"] = int(root_degree)
        nodes.append(root_node)
        seen_node_ids[root_internal_id] = root_node.id

        # Connected nodes and edges (multi-hop aware)
        for row in result or []:
            connected = row.get("connected")
            rel_type = row.get("rel_type")
            hop_level = row.get("hop_level", 1)
            source_id = row.get("source_id")
            target_id = row.get("target_id")

            # Track max depth reached
            if hop_level and hop_level > max_hop_reached:
                max_hop_reached = hop_level

            if not (connected and rel_type):
                continue

            conn_internal_id = str(connected.get("id", ""))

            # Add node if not seen
            if conn_internal_id not in seen_node_ids:
                node = _parse_graph_node_v2(connected, include_metadata)
                node_degree = row.get("node_degree")
                if isinstance(node_degree, (int, float)):
                    node.metadata["degree"] = int(node_degree)
                nodes.append(node)
                seen_node_ids[conn_internal_id] = node.id

            # Add edge using source_id/target_id from multi-hop query
            source_key = str(source_id) if source_id is not None else root_internal_id
            target_key = str(target_id) if target_id is not None else conn_internal_id

            if source_key in seen_node_ids and target_key in seen_node_ids:
                edge_id = f"{seen_node_ids[source_key]}-{rel_type}-{seen_node_ids[target_key]}"
                # Avoid duplicate edges
                if not any(e.id == edge_id for e in edges):
                    edges.append(SubgraphEdge(
                        id=edge_id,
                        source=seen_node_ids[source_key],
                        target=seen_node_ids[target_key],
                        type=rel_type,
                        properties=_edge_properties(row.get("rel_props"), hop_level),
                    ))

        # LIMIT hit ⇒ the neighborhood was (very likely) cut short.
        truncated = bool(result) and len(result) >= max_nodes

        query_time = (time.time() - start_time) * 1000

        log.info(
            "Subgraph fetched",
            root_urn=root_urn,
            nodes_count=len(nodes),
            edges_count=len(edges),
            depth_reached=max_hop_reached or 1,
            truncated=truncated,
            query_time_ms=query_time,
        )

        return SubgraphResponse(
            nodes=nodes,
            edges=edges,
            metadata=SubgraphMetadata(
                total_nodes=len(nodes),
                total_edges=len(edges),
                depth_reached=max_hop_reached or depth,  # Actual depth reached
                root_node_id=root_node_id,
                query_time_ms=round(query_time, 2),
                truncated=truncated,
            ),
        )

    except Exception as e:
        log.error(f"Error fetching subgraph: {e}", root_urn=root_urn, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Subgraph query failed: {str(e)}")
    finally:
        await graph_client.close()


# ====================================================
# SEMANTIC GRAPH SEARCH
# ====================================================

class GraphSearchFilters(BaseModel):
    """Filters for graph search."""
    entity_types: Optional[List[str]] = Field(None, description="Entity types to filter (e.g., ['principio', 'concetto'])")
    relation_types: Optional[List[str]] = Field(None, description="Relation types to filter (e.g., ['DISCIPLINA', 'ESPRIME_PRINCIPIO'])")
    date_range: Optional[Dict[str, str]] = Field(None, description="Date range filter (start, end)")


class GraphSearchRequest(BaseModel):
    """Request for graph semantic search."""
    query: str = Field(..., description="Natural language search query")
    filters: Optional[GraphSearchFilters] = Field(None, description="Optional filters")
    limit: int = Field(10, description="Maximum results to return", ge=1, le=50)


class GraphSearchResponse(BaseModel):
    """Response for graph search."""
    subgraph: SubgraphResponse
    relevance_scores: Dict[str, float] = Field(..., description="Relevance score per node ID (0.0-1.0)")
    query_time_ms: Optional[float] = None


@router.post("/search", response_model=GraphSearchResponse)
async def search_graph(
    request: GraphSearchRequest,
    api_key: ApiKey = Depends(verify_api_key),
) -> GraphSearchResponse:
    """
    Semantic search nel knowledge graph.

    Esegue ricerca semantica usando embeddings e ritorna un subgraph
    con i nodi più rilevanti e le loro relazioni.

    Flow:
    1. Encode query usando EmbeddingService
    2. Vector search in Qdrant (top_k * over_retrieve_factor)
    3. Map chunks → graph nodes via Bridge Table
    4. Fetch subgraph da FalkorDB con nodi rilevanti
    5. Applica filtri (entity_types, relation_types)
    6. Ritorna subgraph con relevance scores

    Args:
        request: GraphSearchRequest con query e filtri opzionali

    Returns:
        GraphSearchResponse con subgraph e relevance scores

    Example:
        >>> POST /api/v1/graph/search
        >>> {
        >>>     "query": "responsabilità del debitore",
        >>>     "filters": {
        >>>         "entity_types": ["principio", "concetto"]
        >>>     },
        >>>     "limit": 5
        >>> }
        >>>
        >>> Response:
        >>> {
        >>>     "subgraph": {
        >>>         "nodes": [...],
        >>>         "edges": [...],
        >>>         "metadata": {...}
        >>>     },
        >>>     "relevance_scores": {
        >>>         "urn:nir:stato:codice.civile:1942;art1218": 0.92,
        >>>         "principio:abc123": 0.87,
        >>>         ...
        >>>     }
        >>> }
    """
    import time
    start_time = time.time()

    log.info(
        "Graph semantic search",
        query=request.query,
        filters=request.filters,
        limit=request.limit,
    )

    try:
        # === 1. Encode query ===
        from merlt.storage.vectors.embeddings import EmbeddingService

        embedding_service = EmbeddingService.get_instance()
        query_vector = await embedding_service.encode_query_async(request.query)

        log.debug("Query encoded", vector_dim=len(query_vector))

        # === 2. Vector search in Qdrant ===
        from qdrant_client import QdrantClient
        from qdrant_client.models import Filter, FieldCondition, MatchAny
        import os

        qdrant_client = QdrantClient(
            host=os.getenv("QDRANT_HOST", "localhost"),
            port=int(os.getenv("QDRANT_PORT", "6333")),
        )

        collection_name = os.getenv("QDRANT_COLLECTION", "merl_t_dev_chunks")

        # Over-retrieve for better coverage (then re-rank)
        over_retrieve_factor = 3
        search_limit = min(request.limit * over_retrieve_factor, 100)

        # Build Qdrant filter if needed
        qdrant_filter = None
        if request.filters and request.filters.entity_types:
            # Filter by entity_type in metadata
            qdrant_filter = Filter(
                must=[
                    FieldCondition(
                        key="entity_type",
                        match=MatchAny(any=request.filters.entity_types)
                    )
                ]
            )

        try:
            if hasattr(qdrant_client, "search"):
                search_results = qdrant_client.search(
                    collection_name=collection_name,
                    query_vector=query_vector,
                    limit=search_limit,
                    query_filter=qdrant_filter,
                )
            else:
                query_response = qdrant_client.query_points(
                    collection_name=collection_name,
                    query=query_vector,
                    limit=search_limit,
                    query_filter=qdrant_filter,
                )
                search_results = query_response.points
        except Exception as vector_error:
            log.warning(
                "Graph vector search unavailable",
                collection_name=collection_name,
                error=str(vector_error),
            )
            return GraphSearchResponse(
                subgraph=SubgraphResponse(
                    nodes=[],
                    edges=[],
                    metadata=SubgraphMetadata(
                        total_nodes=0,
                        total_edges=0,
                        depth_reached=0,
                        root_node_id="",
                        query_time_ms=round((time.time() - start_time) * 1000, 2),
                    ),
                ),
                relevance_scores={},
                query_time_ms=round((time.time() - start_time) * 1000, 2),
            )

        log.info(
            "Vector search completed",
            results_count=len(search_results),
            search_limit=search_limit,
        )

        if not search_results:
            # No results from vector search
            return GraphSearchResponse(
                subgraph=SubgraphResponse(
                    nodes=[],
                    edges=[],
                    metadata=SubgraphMetadata(
                        total_nodes=0,
                        total_edges=0,
                        depth_reached=0,
                        root_node_id="",
                        query_time_ms=round((time.time() - start_time) * 1000, 2),
                    ),
                ),
                relevance_scores={},
                query_time_ms=round((time.time() - start_time) * 1000, 2),
            )

        # === 3. Map chunks → graph nodes via Bridge Table ===
        from merlt.storage.bridge.bridge_table import BridgeTable
        from merlt.rlcf.database import get_db_url

        bridge_table = BridgeTable(db_url=get_db_url())
        await bridge_table.connect()

        try:
            # Collect chunk IDs and similarity scores
            chunk_id_to_score = {}
            for result in search_results:
                chunk_id = result.id
                similarity_score = result.score
                chunk_id_to_score[chunk_id] = similarity_score

            chunk_ids = list(chunk_id_to_score.keys())

            # Get graph node URNs from bridge table
            mappings = await bridge_table.get_nodes_for_chunks(chunk_ids)

            log.debug(
                "Bridge mappings retrieved",
                mappings_count=len(mappings),
            )

            # Build chunk → node URN mapping and relevance scores
            node_urns = set()
            node_relevance_scores = {}

            for mapping in mappings:
                chunk_id = mapping["chunk_id"]
                node_urn = mapping["node_urn"]
                mapping_confidence = mapping.get("mapping_confidence", 1.0)

                # Compute relevance: similarity * mapping_confidence
                similarity = chunk_id_to_score.get(chunk_id, 0.0)
                relevance = similarity * mapping_confidence

                node_urns.add(node_urn)

                # Keep max relevance per node (chunks can map to same node)
                if node_urn not in node_relevance_scores:
                    node_relevance_scores[node_urn] = relevance
                else:
                    node_relevance_scores[node_urn] = max(
                        node_relevance_scores[node_urn],
                        relevance
                    )

        finally:
            await bridge_table.close()

        if not node_urns:
            # No graph nodes found
            return GraphSearchResponse(
                subgraph=SubgraphResponse(
                    nodes=[],
                    edges=[],
                    metadata=SubgraphMetadata(
                        total_nodes=0,
                        total_edges=0,
                        depth_reached=0,
                        root_node_id="",
                        query_time_ms=round((time.time() - start_time) * 1000, 2),
                    ),
                ),
                relevance_scores={},
                query_time_ms=round((time.time() - start_time) * 1000, 2),
            )

        # === 4. Fetch subgraph from FalkorDB ===
        graph_client = FalkorDBClient()
        await graph_client.connect()

        try:
            # Build Cypher query to get nodes and their relations
            # Filter by relation_types if specified
            relation_filter = ""
            if request.filters and request.filters.relation_types:
                allowed_rels = request.filters.relation_types
                relation_filter = f"AND type(r) IN {allowed_rels}"

            cypher = f"""
            MATCH (n)
            WHERE n.URN IN $urns
               OR n.urn IN $urns
            WITH n
            OPTIONAL MATCH (n)-[r]-(connected)
            WHERE connected IS NOT NULL
            {relation_filter}
            RETURN n, type(r) as rel_type, connected
            LIMIT $max_results
            """

            node_urns_list = list(node_urns)
            result = await graph_client.query(
                cypher,
                {
                    "urns": node_urns_list,
                    "max_results": request.limit * 10,  # Allow for edges
                }
            )

            # Parse results into SubgraphResponse
            nodes: List[SubgraphNode] = []
            edges: List[SubgraphEdge] = []
            seen_node_ids: Dict[str, str] = {}  # internal_id → node_id

            if result:
                for row in result:
                    # Process main node
                    if row.get("n"):
                        n_data = row["n"]
                        n_props = n_data.get("properties", n_data)
                        n_internal_id = str(n_data.get("id", ""))
                        n_urn = n_props.get("URN") or n_props.get("urn")

                        if n_internal_id not in seen_node_ids and n_urn:
                            # Apply entity_type filter if specified
                            if request.filters and request.filters.entity_types:
                                node_labels = n_data.get("labels", [])
                                entity_type = node_labels[0] if node_labels else ""
                                if entity_type.lower() not in [t.lower() for t in request.filters.entity_types]:
                                    # Check if it's a Norma node (always include)
                                    if entity_type != "Norma" and entity_type != "Article":
                                        continue

                            node = _parse_graph_node_v2(n_data, include_metadata=True)
                            nodes.append(node)
                            seen_node_ids[n_internal_id] = node.id

                    # Process connected node
                    if row.get("connected") and row.get("rel_type"):
                        conn_data = row["connected"]
                        rel_type = row["rel_type"]
                        conn_props = conn_data.get("properties", conn_data)
                        conn_internal_id = str(conn_data.get("id", ""))
                        conn_urn = conn_props.get("URN") or conn_props.get("urn")

                        if conn_internal_id not in seen_node_ids and conn_urn:
                            # Apply entity_type filter
                            if request.filters and request.filters.entity_types:
                                conn_labels = conn_data.get("labels", [])
                                entity_type = conn_labels[0] if conn_labels else ""
                                if entity_type.lower() not in [t.lower() for t in request.filters.entity_types]:
                                    if entity_type != "Norma" and entity_type != "Article":
                                        continue

                            node = _parse_graph_node_v2(conn_data, include_metadata=True)
                            nodes.append(node)
                            seen_node_ids[conn_internal_id] = node.id

                        # Add edge if both nodes are in seen_node_ids
                        n_internal_id_edge = str(row["n"].get("id", ""))
                        if n_internal_id_edge in seen_node_ids and conn_internal_id in seen_node_ids:
                            edge_id = f"{seen_node_ids[n_internal_id_edge]}-{rel_type}-{seen_node_ids[conn_internal_id]}"
                            edge = SubgraphEdge(
                                id=edge_id,
                                source=seen_node_ids[n_internal_id_edge],
                                target=seen_node_ids[conn_internal_id],
                                type=rel_type,
                                properties={},
                            )
                            # Avoid duplicates
                            if not any(e.id == edge_id for e in edges):
                                edges.append(edge)

            # Sort nodes by relevance and limit
            nodes_with_scores = [
                (node, node_relevance_scores.get(node.urn or node.id, 0.0))
                for node in nodes
            ]
            nodes_with_scores.sort(key=lambda x: x[1], reverse=True)
            top_nodes = [node for node, _ in nodes_with_scores[:request.limit]]

            # Keep only edges where both source and target are in top_nodes
            top_node_ids = {node.id for node in top_nodes}
            filtered_edges = [
                edge for edge in edges
                if edge.source in top_node_ids and edge.target in top_node_ids
            ]

            # Build final relevance scores dict (only for top nodes)
            final_relevance_scores = {
                node.id: node_relevance_scores.get(node.urn or node.id, 0.0)
                for node in top_nodes
            }

            query_time = (time.time() - start_time) * 1000

            log.info(
                "Graph search completed",
                query=request.query,
                nodes_count=len(top_nodes),
                edges_count=len(filtered_edges),
                query_time_ms=query_time,
            )

            return GraphSearchResponse(
                subgraph=SubgraphResponse(
                    nodes=top_nodes,
                    edges=filtered_edges,
                    metadata=SubgraphMetadata(
                        total_nodes=len(top_nodes),
                        total_edges=len(filtered_edges),
                        depth_reached=1,  # Current implementation is depth=1
                        root_node_id=top_nodes[0].id if top_nodes else "",
                        query_time_ms=round(query_time, 2),
                    ),
                ),
                relevance_scores=final_relevance_scores,
                query_time_ms=round(query_time, 2),
            )

        finally:
            await graph_client.close()

    except Exception as e:
        log.error(f"Graph search failed: {e}", query=request.query, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Graph search failed: {str(e)}")


# ====================================================
# HELPER FUNCTIONS
# ====================================================

def _parse_graph_node_v2(node_data: Dict[str, Any], include_metadata: bool) -> SubgraphNode:
    """Parse FalkorDB node data (with properties/labels structure) into SubgraphNode."""
    # FalkorDB returns: {properties: {...}, labels: [...], id: int}
    props = node_data.get("properties", node_data)
    labels = node_data.get("labels", [])

    # Get node ID
    node_id = (
        props.get("URN")
        or props.get("urn")
        or props.get("node_id")
        or props.get("id")
        or str(node_data.get("id", ""))
    )

    # Get node type from labels
    node_type = labels[0] if labels else "Unknown"

    # Get display label (A1: nome→estremi→rubrica→titolo→Norma synth→
    # numero_articolo→testo→URN-derived "Art. N"→id, never the raw URL).
    label = build_node_label(props, node_id)

    # Build properties (exclude internal fields)
    internal_fields = {"URN", "urn", "node_id", "id", "created_at", "updated_at"}
    properties = {
        k: v for k, v in props.items()
        if k not in internal_fields and v is not None
    }

    # Build metadata
    metadata = {}
    if include_metadata:
        if props.get("created_at"):
            metadata["created_at"] = props["created_at"]
        if props.get("fonte"):
            metadata["source"] = props["fonte"]
        if props.get("community_validated"):
            metadata["community_validated"] = props["community_validated"]

    return SubgraphNode(
        id=node_id,
        urn=props.get("URN") or props.get("urn"),
        type=node_type,
        label=label,
        properties=properties,
        metadata=metadata,
    )


def _parse_graph_node(node_data: Dict[str, Any], include_metadata: bool) -> SubgraphNode:
    """Parse FalkorDB node data into SubgraphNode (legacy)."""
    # Get node ID (try multiple fields)
    node_id = (
        node_data.get("id")
        or node_data.get("URN")
        or node_data.get("urn")
        or str(hash(str(node_data)))[:12]
    )

    # Get node type from labels
    labels = node_data.get("labels", [])
    node_type = labels[0] if labels else "Unknown"

    # Handle Entity subtypes
    if "Entity" in labels and len(labels) > 1:
        node_type = labels[1]  # Use more specific label (Principio, Concetto, etc.)

    # Get display label
    label = (
        node_data.get("nome")
        or node_data.get("estremi")
        or node_data.get("label")
        or node_id[:30]
    )

    # Build properties (exclude internal fields)
    internal_fields = {"id", "URN", "urn", "labels", "created_at", "updated_at"}
    properties = {
        k: v for k, v in node_data.items()
        if k not in internal_fields and v is not None
    }

    # Build metadata
    metadata = {}
    if include_metadata:
        if node_data.get("created_at"):
            metadata["created_at"] = node_data["created_at"]
        if node_data.get("fonte"):
            metadata["source"] = node_data["fonte"]
        if node_data.get("community_validated"):
            metadata["community_validated"] = node_data["community_validated"]

    return SubgraphNode(
        id=node_id,
        urn=node_data.get("URN") or node_data.get("urn"),
        type=node_type,
        label=label,
        properties=properties,
        metadata=metadata,
    )


def _parse_graph_edge(rel_data: Any, include_metadata: bool) -> SubgraphEdge:
    """Parse FalkorDB relationship data into SubgraphEdge."""
    # Handle different FalkorDB result formats
    if hasattr(rel_data, "type"):
        # Native relationship object
        rel_type = rel_data.type()
        source = rel_data.src_node
        target = rel_data.dest_node
        props = dict(rel_data.properties)
    elif isinstance(rel_data, dict):
        rel_type = rel_data.get("type", "RELATES_TO")
        source = rel_data.get("source") or rel_data.get("src")
        target = rel_data.get("target") or rel_data.get("dest")
        props = rel_data.get("properties", {})
    else:
        rel_type = "RELATES_TO"
        source = "unknown"
        target = "unknown"
        props = {}

    # Generate edge ID
    edge_id = f"{source}-{rel_type}-{target}"

    # Build properties
    properties = {}
    if props.get("certezza"):
        properties["strength"] = props["certezza"]
    if props.get("evidence"):
        properties["evidence"] = props["evidence"]
    if include_metadata:
        if props.get("created_at"):
            properties["created_at"] = props["created_at"]
        if props.get("fonte"):
            properties["source"] = props["fonte"]

    return SubgraphEdge(
        id=edge_id,
        source=str(source),
        target=str(target),
        type=rel_type,
        properties=properties,
    )


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "router",
    "check_article_in_graph",
    "get_node_details",
    "get_article_entities",
    "get_article_relations",
    "search_entities",
    "resolve_norm",
    "get_subgraph",
    "search_graph",
    "SubgraphResponse",
    "SubgraphNode",
    "SubgraphEdge",
    "GraphSearchRequest",
    "GraphSearchResponse",
    "GraphSearchFilters",
    "ingest_article",
    "IngestArticleRequest",
    "IngestArticleResponse",
    "IngestArticleOptions",
]
