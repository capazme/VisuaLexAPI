# 🗺️ MERL-T & VisuaLex - Roadmap Completa 2026

> **Versione**: 1.0
> **Data Creazione**: 4 Gennaio 2026
> **Timeline Totale**: 10-15 settimane (flessibile per tesi)
> **Obiettivo**: Sistema completo e production-ready

---

## 📋 Executive Summary

| Phase | Durata | Effort | Priority | Deliverables |
|-------|--------|--------|----------|--------------|
| **Phase 1: Core Fixes** | 1 settimana | 10h | P0 | DB Persistence, Domain Authority, FalkorDB Write |
| **Phase 2: Graph Visualization** | 2-3 settimane | 80-120h | P1 | API completo, UI integration, Layout intelligente |
| **Phase 3: Pipeline Monitoring** | 2-3 settimane | 80-120h | P1 | WebSocket infra, Admin Dashboard, User progress view |
| **Phase 4: RLCF Training** | 2-3 settimane | 80-120h | P2 | Manual trigger, Training pipeline, A/B testing |
| **Phase 5: Feature Completion** | 2-4 settimane | 100-160h | P3 | Compare View, Dossiers, Annotation, Bulletin Board |
| **TOTALE** | **10-15 settimane** | **350-530h** | - | Sistema completo production-ready |

---

## 🎯 PHASE 1: Core Fixes (P0 - CRITICAL)

**Timeline**: 1 settimana (5-7 giorni)
**Effort**: 10 ore totali
**Priority**: P0 (BLOCKING per community validation)

### Task 1.1: Live Enrichment DB Persistence ⚠️ BLOCKER

**Status**: ❌ Not Started
**Effort**: 4 ore
**Dependencies**: Nessuna
**Owner**: Backend specialist

#### Problema
Community validation perde tutti i dati al restart MERL-T (in-memory storage).

#### Decisioni Prese
- **Storage**: PostgreSQL (già configurato per RLCF)
- **Migration**: Hard cutover (1 giorno downtime validations)

#### Schema PostgreSQL

```sql
-- Table: pending_entities
CREATE TABLE pending_entities (
    id SERIAL PRIMARY KEY,
    entity_id VARCHAR(50) UNIQUE NOT NULL,
    article_urn VARCHAR(200) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_text TEXT NOT NULL,
    descrizione TEXT,
    ambito VARCHAR(50),
    fonte VARCHAR(50),
    llm_confidence FLOAT,
    validation_status VARCHAR(20) DEFAULT 'pending',
    approval_score FLOAT DEFAULT 0,
    rejection_score FLOAT DEFAULT 0,
    votes_count INT DEFAULT 0,
    contributed_by VARCHAR(50),
    contributor_authority FLOAT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pending_entities_status ON pending_entities(validation_status);
CREATE INDEX idx_pending_entities_type ON pending_entities(entity_type);
CREATE INDEX idx_pending_entities_article ON pending_entities(article_urn);
CREATE INDEX idx_pending_entities_contributor ON pending_entities(contributed_by);

-- Table: entity_votes
CREATE TABLE entity_votes (
    id SERIAL PRIMARY KEY,
    entity_id VARCHAR(50) REFERENCES pending_entities(entity_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL,
    vote VARCHAR(20) NOT NULL CHECK (vote IN ('approve', 'reject', 'edit')),
    suggested_edits JSONB,
    reason TEXT,
    user_authority FLOAT NOT NULL,
    weighted_vote FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(entity_id, user_id)
);

CREATE INDEX idx_entity_votes_entity ON entity_votes(entity_id);
CREATE INDEX idx_entity_votes_user ON entity_votes(user_id);

-- Table: pending_relations
CREATE TABLE pending_relations (
    id SERIAL PRIMARY KEY,
    relation_id VARCHAR(50) UNIQUE NOT NULL,
    source_urn VARCHAR(200) NOT NULL,
    target_urn VARCHAR(200) NOT NULL,
    relation_type VARCHAR(50) NOT NULL,
    fonte VARCHAR(50),
    llm_confidence FLOAT,
    evidence TEXT,
    validation_status VARCHAR(20) DEFAULT 'pending',
    approval_score FLOAT DEFAULT 0,
    rejection_score FLOAT DEFAULT 0,
    votes_count INT DEFAULT 0,
    contributed_by VARCHAR(50),
    contributor_authority FLOAT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pending_relations_status ON pending_relations(validation_status);
CREATE INDEX idx_pending_relations_source ON pending_relations(source_urn);
CREATE INDEX idx_pending_relations_target ON pending_relations(target_urn);

-- Table: relation_votes
CREATE TABLE relation_votes (
    id SERIAL PRIMARY KEY,
    relation_id VARCHAR(50) REFERENCES pending_relations(relation_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL,
    vote VARCHAR(20) NOT NULL CHECK (vote IN ('approve', 'reject', 'edit')),
    suggested_edits JSONB,
    reason TEXT,
    user_authority FLOAT NOT NULL,
    weighted_vote FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(relation_id, user_id)
);

CREATE INDEX idx_relation_votes_relation ON relation_votes(relation_id);
CREATE INDEX idx_relation_votes_user ON relation_votes(user_id);

-- Trigger: Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_pending_entities_updated_at
BEFORE UPDATE ON pending_entities
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pending_relations_updated_at
BEFORE UPDATE ON pending_relations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

#### Implementazione Steps

**Step 1: Database Migration (1h)**
```bash
# File: merlt/rlcf/migrations/add_pending_validation_tables.sql
cd /Users/gpuzio/Desktop/CODE/MERL-T_alpha
# Run migration script
psql -U postgres -d merl_t_rlcf -f merlt/rlcf/migrations/add_pending_validation_tables.sql
```

**Step 2: Database Models (1h)**
```python
# File: merlt/rlcf/database.py

from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime

class PendingEntity(Base):
    __tablename__ = "pending_entities"

    id = Column(Integer, primary_key=True)
    entity_id = Column(String(50), unique=True, nullable=False)
    article_urn = Column(String(200), nullable=False)
    entity_type = Column(String(50), nullable=False)
    entity_text = Column(Text, nullable=False)
    descrizione = Column(Text)
    ambito = Column(String(50))
    fonte = Column(String(50))
    llm_confidence = Column(Float)
    validation_status = Column(String(20), default='pending')
    approval_score = Column(Float, default=0.0)
    rejection_score = Column(Float, default=0.0)
    votes_count = Column(Integer, default=0)
    contributed_by = Column(String(50))
    contributor_authority = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    votes = relationship("EntityVote", back_populates="entity", cascade="all, delete-orphan")


class EntityVote(Base):
    __tablename__ = "entity_votes"

    id = Column(Integer, primary_key=True)
    entity_id = Column(String(50), ForeignKey("pending_entities.entity_id", ondelete="CASCADE"))
    user_id = Column(String(50), nullable=False)
    vote = Column(String(20), nullable=False)
    suggested_edits = Column(JSONB)
    reason = Column(Text)
    user_authority = Column(Float, nullable=False)
    weighted_vote = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationship
    entity = relationship("PendingEntity", back_populates="votes")


# Similar for PendingRelation, RelationVote
```

**Step 3: Refactor enrichment_router.py (2h)**
```python
# File: merlt/api/enrichment_router.py

# BEFORE (in-memory)
_pending_entities: Dict[str, PendingEntityData] = {}

# AFTER (PostgreSQL)
from merlt.rlcf.database import PendingEntity, EntityVote, get_async_session_dep
from sqlalchemy import select

@router.post("/live")
async def live_enrich(
    request: LiveEnrichmentRequest,
    session: AsyncSession = Depends(get_async_session_dep)
):
    # ... enrichment logic ...

    # Save to PostgreSQL instead of in-memory
    for entity_data in response.pending_entities:
        pending_entity = PendingEntity(
            entity_id=entity_data.id,
            article_urn=entity_data.article_urn,
            entity_type=entity_data.tipo.value,
            entity_text=entity_data.nome,
            descrizione=entity_data.descrizione,
            ambito=entity_data.ambito,
            fonte=entity_data.fonte,
            llm_confidence=entity_data.llm_confidence,
            validation_status='pending',
            contributed_by=request.user_id,
            contributor_authority=request.user_authority,
        )
        session.add(pending_entity)

    await session.commit()
    return response


@router.post("/validate-entity")
async def validate_entity(
    request: EntityValidationRequest,
    session: AsyncSession = Depends(get_async_session_dep)
):
    # Fetch from PostgreSQL
    result = await session.execute(
        select(PendingEntity).where(PendingEntity.entity_id == request.entity_id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Create vote
    vote = EntityVote(
        entity_id=request.entity_id,
        user_id=request.user_id,
        vote=request.vote,
        suggested_edits=request.suggested_edits,
        reason=request.reason,
        user_authority=request.user_authority,
        weighted_vote=calculate_weighted_vote(request.vote, request.user_authority),
    )
    session.add(vote)

    # Update entity scores
    result = await session.execute(
        select(EntityVote).where(EntityVote.entity_id == request.entity_id)
    )
    all_votes = result.scalars().all()

    entity.approval_score = sum(v.weighted_vote for v in all_votes if v.weighted_vote > 0)
    entity.rejection_score = abs(sum(v.weighted_vote for v in all_votes if v.weighted_vote < 0))
    entity.votes_count = len(all_votes)

    # Check threshold (2.0)
    if entity.approval_score >= 2.0:
        entity.validation_status = 'approved'
        # TODO: Write to FalkorDB (Task 1.3)
    elif entity.rejection_score >= 2.0:
        entity.validation_status = 'rejected'

    await session.commit()

    return EntityValidationResponse(...)
```

#### Testing
```bash
# Test 1: Create pending entity
curl -X POST http://localhost:8000/api/enrichment/live \
  -H "Content-Type: application/json" \
  -d '{
    "tipo_atto": "codice penale",
    "articolo": "52",
    "user_id": "test_user",
    "user_authority": 0.5
  }'

# Test 2: Validate entity
curl -X POST http://localhost:8000/api/enrichment/validate-entity \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "entity_abc123",
    "vote": "approve",
    "user_id": "test_user",
    "user_authority": 0.7
  }'

# Test 3: Restart server and verify persistence
docker-compose -f docker-compose.dev.yml restart
curl http://localhost:8000/api/enrichment/pending
```

#### Acceptance Criteria
- [x] PostgreSQL tables created
- [x] SQLAlchemy models implemented
- [x] enrichment_router.py refactored (no in-memory)
- [x] All endpoints working with DB
- [x] Data persists across server restart
- [x] Tests passing

---

### Task 1.2: Domain Authority (Accuracy-Based)

**Status**: ❌ Not Started
**Effort**: 2 ore
**Dependencies**: Task 1.1 (uses entity_votes table)
**Owner**: Backend + Algorithm specialist

#### Problema
ProfilePage mostra dati FAKE hardcoded come reali.

#### Decisioni Prese
- **Formula**: Accuracy-based con peer validation
- **Accuracy Source**: Quorum di voti basato su authority
- **Meccanismo**: Voto marcato "corretto" se allineato con consensus finale

#### Formula Domain Authority

```
domain_authority[domain] = (feedbacks corretti nel dominio) / (feedbacks totali nel dominio)

Dove un feedback è "corretto" se:
  - Allineato con consensus finale (approval > 2.0 → voto approve è corretto)
  - Peso: user_authority del votante
```

#### Implementazione Steps

**Step 1: Add domain tracking (30min)**
```typescript
// VisuaLex: backend/prisma/schema.prisma

model MerltFeedback {
  id        String   @id @default(uuid())
  userId    String
  type      MerltFeedbackType

  // NEW: Domain tracking
  legalDomain String?  // "civile", "penale", "amministrativo", etc.
  accuracyScore Float?  // 0-1 (calcolato dopo consensus)

  // ... existing fields
}
```

**Step 2: Calculate accuracy on consensus (1h)**
```python
# MERL-T: merlt/api/enrichment_router.py

async def _calculate_voter_accuracy(
    session: AsyncSession,
    entity_id: str,
    final_status: str
):
    """
    Calcola accuracy score per ogni votante basato su alignment con consensus.

    Se entità approvata (approval_score >= 2.0):
      - Voti "approve" → accuracy = 1.0
      - Voti "reject" → accuracy = 0.0
      - Voti "edit" → accuracy = 0.5
    """
    result = await session.execute(
        select(EntityVote).where(EntityVote.entity_id == entity_id)
    )
    votes = result.scalars().all()

    accuracy_map = {
        'approved': {'approve': 1.0, 'reject': 0.0, 'edit': 0.5},
        'rejected': {'approve': 0.0, 'reject': 1.0, 'edit': 0.5},
    }

    if final_status not in accuracy_map:
        return  # Pending, skip

    for vote in votes:
        accuracy = accuracy_map[final_status].get(vote.vote, 0.0)

        # Sync accuracy to VisuaLex via webhook
        await sync_accuracy_to_visualex(
            user_id=vote.user_id,
            entity_id=entity_id,
            accuracy_score=accuracy,
            legal_domain=_infer_domain_from_article(entity.article_urn)
        )


async def sync_accuracy_to_visualex(user_id, entity_id, accuracy_score, legal_domain):
    """Sync accuracy feedback to VisuaLex PostgreSQL."""
    # Call VisuaLex endpoint to update MerltFeedback
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{VISUALEX_API_URL}/api/merlt/accuracy/sync",
            json={
                "user_id": user_id,
                "entity_id": entity_id,
                "accuracy_score": accuracy_score,
                "legal_domain": legal_domain,
            }
        )
```

**Step 3: Calculate domain authority in VisuaLex (30min)**
```typescript
// VisuaLex: backend/src/controllers/merltController.ts

export const calculateDomainAuthority = async (userId: string) => {
  const domains = [
    'civile', 'penale', 'amministrativo', 'costituzionale',
    'lavoro', 'commerciale', 'tributario', 'internazionale'
  ];

  const domainAuthority: Record<string, number> = {};

  for (const domain of domains) {
    // Get all feedbacks for this domain
    const feedbacks = await prisma.merltFeedback.findMany({
      where: {
        userId,
        legalDomain: domain,
        accuracyScore: { not: null },  // Only feedbacks with consensus
      },
    });

    if (feedbacks.length === 0) {
      domainAuthority[domain] = 0.3;  // Default baseline
      continue;
    }

    // Calculate accuracy rate
    const totalAccuracy = feedbacks.reduce((sum, f) => sum + (f.accuracyScore || 0), 0);
    domainAuthority[domain] = totalAccuracy / feedbacks.length;
  }

  return domainAuthority;
};

export const getFullProfile = async (req: Request, res: Response) => {
  // ... existing code ...

  // Calculate domain authority
  const domainAuthority = await calculateDomainAuthority(req.user.id);

  res.json({
    ...existingProfile,
    domain_authority: domainAuthority,  // NOW REAL DATA
  });
};
```

#### Testing
```bash
# Test 1: Submit entity validation vote
curl -X POST http://localhost:8000/api/enrichment/validate-entity \
  -d '{"entity_id": "e1", "vote": "approve", "user_id": "u1", "user_authority": 0.7}'

# Test 2: Trigger consensus (3 votes)
curl -X POST ... # vote 2
curl -X POST ... # vote 3 → approval_score = 2.1 → approved

# Test 3: Verify accuracy synced to VisuaLex
curl http://localhost:3001/api/merlt/profile/full \
  -H "Authorization: Bearer <token>"
# Should show domain_authority.penale = 1.0 (100% correct vote)
```

#### Acceptance Criteria
- [x] MerltFeedback has legalDomain and accuracyScore fields
- [x] Accuracy calculated on consensus
- [x] Accuracy synced to VisuaLex
- [x] Domain authority calculated from real accuracy data
- [x] ProfilePage shows real domain authority (no hardcoded values)

---

### Task 1.3: FalkorDB Write Operations (Schema Rigoroso)

**Status**: ❌ Not Started
**Effort**: 4 ore
**Dependencies**: Task 1.1 (requires approved entities)
**Owner**: Graph specialist + Backend

#### Problema
Entities approvate non vengono scritte al knowledge graph.

#### Decisioni Prese
- **Schema Source**: `/Users/gpuzio/Desktop/CODE/MERL-T_alpha/merlt/pipeline/enrichment/models.py`
- **Principi**: Rigore, omogeneità, schema univoco
- **Obiettivo**: Guidare 4 expert nelle loro task
- **User nodes**: NO (grafo solo entità giuridiche)
- **Duplicazioni**: Evitare con check meccanico + LLM + peer-reviewed
- **Enrichment**: Nodi arricchiti progressivamente

#### Schema Nodi (da models.py)

**EntityType (17 tipi, 4 priorità):**
- **P1 (core)**: `Concetto`, `Principio`, `Definizione`
- **P2 (soggetti)**: `Soggetto`, `Ruolo`, `Modalita`
- **P3 (fatti/atti)**: `Fatto`, `Atto`, `Procedura`, `Termine`, `Effetto`, `Responsabilita`, `Rimedio`
- **P4 (avanzate)**: `Sanzione`, `Caso`, `Eccezione`, `Clausola`

**Schema Cypher:**
```cypher
// Nodo Entity con label tipo-specifico
CREATE (e:Entity:Principio {
  id: "principio:legittima_difesa",
  nome: "Legittima difesa",
  tipo: "principio",
  descrizione: "Diritto di difendere se stessi o altri da aggressione ingiusta",
  ambito: "penale",
  fonte: "brocardi",

  // Community validation metadata
  community_validated: true,
  approval_score: 2.5,
  votes_count: 3,
  validated_at: datetime(),

  // Enrichment tracking
  llm_confidence: 0.92,
  extraction_source: "Art. 52 c.p. - spiegazione Brocardi",

  // Timestamps
  created_at: datetime(),
  updated_at: datetime()
})
```

#### Relazioni (da models.py RelationType)

**Relazioni Semantiche (Norma → Entità):**
```cypher
// Art 52 c.p. esprime il principio di legittima difesa
MATCH (a:Articolo {urn: "urn:...:codice.penale:art52"})
MATCH (p:Principio {id: "principio:legittima_difesa"})
CREATE (a)-[:ESPRIME_PRINCIPIO]->(p)

// Art 52 c.p. disciplina il concetto di legittima difesa
MATCH (a:Articolo {urn: "urn:...:codice.penale:art52"})
MATCH (c:Concetto {id: "concetto:legittima_difesa"})
CREATE (a)-[:DISCIPLINA]->(c)
```

**Relazioni Gerarchiche (Entità → Entità):**
```cypher
// Concetto "Buona fede oggettiva" è SPECIES di "Buona fede"
MATCH (spec:Concetto {id: "concetto:buona_fede_oggettiva"})
MATCH (genus:Concetto {id: "concetto:buona_fede"})
CREATE (spec)-[:SPECIES]->(genus)

// Principio "Tutela affidamento" IMPLICA "Buona fede"
MATCH (p1:Principio {id: "principio:tutela_affidamento"})
MATCH (p2:Principio {id: "principio:buona_fede"})
CREATE (p1)-[:IMPLICA]->(p2)
```

**Relazioni Dottrina:**
```cypher
// Spiegazione Brocardi SPIEGA il principio
MATCH (d:Spiegazione {id: "brocardi:52:spiegazione"})
MATCH (p:Principio {id: "principio:legittima_difesa"})
CREATE (d)-[:SPIEGA]->(p)
```

#### Deduplication Strategy (3-layer)

**Layer 1: Mechanical Check (exact match)**
```python
async def check_duplicate_mechanical(
    session: AsyncSession,
    entity_nome: str,
    entity_tipo: str
) -> Optional[str]:
    """Check if exact nome + tipo exists in graph."""
    normalized_nome = entity_nome.lower().strip().replace(" ", "_")
    node_id = f"{entity_tipo}:{normalized_nome}"

    # Query FalkorDB
    cypher = """
        MATCH (e {id: $node_id})
        RETURN e.id AS existing_id
    """
    results = await falkordb_client.query(cypher, {"node_id": node_id})

    if results:
        return results[0]["existing_id"]  # Duplicate found
    return None
```

**Layer 2: LLM-based Semantic Check (fuzzy match)**
```python
async def check_duplicate_llm(
    entity_nome: str,
    entity_descrizione: str,
    entity_tipo: str
) -> Optional[Dict[str, Any]]:
    """Use LLM to find semantically similar entities."""
    # Query existing entities of same type
    cypher = f"""
        MATCH (e:Entity {{tipo: $tipo}})
        RETURN e.nome AS nome, e.descrizione AS descrizione, e.id AS id
        LIMIT 50
    """
    existing = await falkordb_client.query(cypher, {"tipo": entity_tipo})

    if not existing:
        return None

    # LLM prompt for similarity check
    prompt = f"""
    Nuova entità da inserire:
    - Nome: {entity_nome}
    - Descrizione: {entity_descrizione}

    Entità esistenti nel grafo:
    {json.dumps([{"nome": e["nome"], "descrizione": e["descrizione"]} for e in existing], indent=2)}

    Domanda: La nuova entità è semanticamente IDENTICA a una di quelle esistenti?
    - Se SÌ, rispondi con il nome dell'entità esistente
    - Se NO, rispondi "NUOVA"

    Risposta (solo nome o "NUOVA"):
    """

    response = await llm_service.complete(prompt)

    if response.strip() == "NUOVA":
        return None

    # Find matching entity
    for entity in existing:
        if entity["nome"].lower() in response.lower():
            return {"existing_id": entity["id"], "confidence": "llm_match"}

    return None
```

**Layer 3: Peer-reviewed Approval**
```python
# Already implemented in Task 1.1 (entity validation with quorum)
# If approved by community → guaranteed no duplicate (they would vote "reject" if duplicate)
```

#### Implementazione Steps

**Step 1: FalkorDB Writer Service (2h)**
```python
# File: merlt/storage/graph/entity_writer.py

from merlt.storage.graph.client import FalkorDBClient
from merlt.pipeline.enrichment.models import EntityType, RelationType

class EntityGraphWriter:
    """Writes validated entities to FalkorDB with rigorous deduplication."""

    def __init__(self, falkordb_client: FalkorDBClient):
        self.client = falkordb_client

    async def write_entity(
        self,
        entity_id: str,
        entity_nome: str,
        entity_tipo: EntityType,
        entity_descrizione: str,
        article_urn: str,
        ambito: str,
        approval_score: float,
        votes_count: int,
        llm_confidence: float,
        fonte: str
    ) -> str:
        """
        Write entity to FalkorDB with deduplication.

        Returns:
            node_id (str): ID of created or merged node
        """
        # Step 1: Mechanical check
        duplicate_id = await self._check_duplicate_mechanical(entity_nome, entity_tipo)
        if duplicate_id:
            logger.info(f"Duplicate found (mechanical): {duplicate_id}")
            await self._enrich_existing_entity(duplicate_id, entity_descrizione, article_urn)
            return duplicate_id

        # Step 2: LLM semantic check
        duplicate = await self._check_duplicate_llm(entity_nome, entity_descrizione, entity_tipo)
        if duplicate:
            logger.info(f"Duplicate found (LLM): {duplicate['existing_id']}")
            await self._enrich_existing_entity(duplicate['existing_id'], entity_descrizione, article_urn)
            return duplicate['existing_id']

        # Step 3: Create new node
        node_id = f"{entity_tipo.value}:{self._normalize_nome(entity_nome)}"

        cypher = f"""
            CREATE (e:Entity:{entity_tipo.value.capitalize()} {{
                id: $node_id,
                nome: $nome,
                tipo: $tipo,
                descrizione: $descrizione,
                ambito: $ambito,
                fonte: $fonte,
                community_validated: true,
                approval_score: $approval_score,
                votes_count: $votes_count,
                llm_confidence: $llm_confidence,
                created_at: datetime(),
                updated_at: datetime()
            }})
            RETURN e.id AS created_id
        """

        result = await self.client.query(cypher, {
            "node_id": node_id,
            "nome": entity_nome,
            "tipo": entity_tipo.value,
            "descrizione": entity_descrizione,
            "ambito": ambito,
            "fonte": fonte,
            "approval_score": approval_score,
            "votes_count": votes_count,
            "llm_confidence": llm_confidence,
        })

        logger.info(f"Created new entity node: {node_id}")

        # Step 4: Create relation to article
        await self._create_entity_article_relation(
            entity_id=node_id,
            article_urn=article_urn,
            entity_tipo=entity_tipo
        )

        return node_id

    async def _create_entity_article_relation(
        self,
        entity_id: str,
        article_urn: str,
        entity_tipo: EntityType
    ):
        """Create semantic relation between article and entity."""
        # Determine relation type based on entity type
        relation_map = {
            EntityType.PRINCIPIO: "ESPRIME_PRINCIPIO",
            EntityType.CONCETTO: "DISCIPLINA",
            EntityType.DEFINIZIONE: "DEFINISCE",
            EntityType.PROCEDURA: "REGOLA_PROCEDURA",
            EntityType.SANZIONE: "PREVEDE",
            # ... other mappings
        }

        rel_type = relation_map.get(entity_tipo, "CORRELATO")

        cypher = f"""
            MATCH (a:Articolo)
            WHERE a.urn = $article_urn OR a.URN = $article_urn
            MATCH (e:Entity {{id: $entity_id}})
            CREATE (a)-[:{rel_type}]->(e)
        """

        await self.client.query(cypher, {
            "article_urn": article_urn,
            "entity_id": entity_id,
        })

        logger.info(f"Created {rel_type} relation: {article_urn} -> {entity_id}")

    async def _enrich_existing_entity(
        self,
        node_id: str,
        new_descrizione: str,
        article_urn: str
    ):
        """Enrich existing entity with new information."""
        cypher = """
            MATCH (e:Entity {id: $node_id})
            SET e.descrizione = e.descrizione + '\n\n' + $new_descrizione,
                e.updated_at = datetime()
            RETURN e.id AS updated_id
        """

        await self.client.query(cypher, {
            "node_id": node_id,
            "new_descrizione": new_descrizione,
        })

        logger.info(f"Enriched existing entity: {node_id}")

    def _normalize_nome(self, nome: str) -> str:
        """Normalize entity name for node ID."""
        return nome.lower().strip().replace(" ", "_")
```

**Step 2: Integration in enrichment_router.py (1h)**
```python
# File: merlt/api/enrichment_router.py

from merlt.storage.graph.entity_writer import EntityGraphWriter

@router.post("/validate-entity")
async def validate_entity(
    request: EntityValidationRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    falkordb_client: FalkorDBClient = Depends(get_falkordb_client)
):
    # ... existing voting logic ...

    # If approved, write to FalkorDB
    if entity.validation_status == 'approved':
        writer = EntityGraphWriter(falkordb_client)

        node_id = await writer.write_entity(
            entity_id=entity.entity_id,
            entity_nome=entity.entity_text,
            entity_tipo=EntityType(entity.entity_type),
            entity_descrizione=entity.descrizione or "",
            article_urn=entity.article_urn,
            ambito=entity.ambito or "diritto_civile",
            approval_score=entity.approval_score,
            votes_count=entity.votes_count,
            llm_confidence=entity.llm_confidence or 1.0,
            fonte=entity.fonte or "community",
        )

        logger.info(f"Entity written to FalkorDB: {node_id}")

        # Update entity record with graph node ID
        entity.graph_node_id = node_id
        await session.commit()

    return EntityValidationResponse(
        ...
        graph_node_id=entity.graph_node_id if entity.validation_status == 'approved' else None
    )
```

**Step 3: Testing Deduplication (1h)**
```bash
# Test 1: Create entity
curl -X POST http://localhost:8000/api/enrichment/live \
  -d '{"tipo_atto": "codice penale", "articolo": "52", ...}'

# Test 2: Approve entity
curl -X POST http://localhost:8000/api/enrichment/validate-entity \
  -d '{"entity_id": "entity_1", "vote": "approve", ...}'
# → approval_score = 2.1 → approved → written to FalkorDB

# Test 3: Try to create duplicate (should merge)
curl -X POST http://localhost:8000/api/enrichment/live \
  -d '{"tipo_atto": "codice penale", "articolo": "52", ...}'  # Same entity
curl -X POST .../validate-entity ...
# → Should detect duplicate and enrich existing node instead of creating new

# Test 4: Verify in FalkorDB
cypher-shell -a bolt://localhost:6380
> MATCH (e:Entity {tipo: "principio"}) RETURN e.nome, e.descrizione, e.approval_score;
```

#### Acceptance Criteria
- [x] EntityGraphWriter implemented with 3-layer deduplication
- [x] Entities written to FalkorDB on approval
- [x] Semantic relations created (ESPRIME_PRINCIPIO, DISCIPLINA, etc.)
- [x] Mechanical duplicate check working
- [x] LLM semantic duplicate check working
- [x] Existing entities enriched (not duplicated)
- [x] Graph node ID stored in pending_entities.graph_node_id
- [x] Tests passing

---

## 📊 PHASE 1 Summary

| Task | Effort | Status | Deliverable |
|------|--------|--------|-------------|
| 1.1 Live Enrichment DB | 4h | ❌ Not Started | PostgreSQL persistence, zero data loss |
| 1.2 Domain Authority | 2h | ❌ Not Started | Real accuracy-based calculation |
| 1.3 FalkorDB Write | 4h | ❌ Not Started | Validated entities in graph, deduplication |
| **TOTAL** | **10h** | - | **Production-ready community validation** |

---

## 🎨 PHASE 2: Graph Visualization (P1 - HIGH PRIORITY)

**Timeline**: 2-3 settimane
**Effort**: 80-120 ore
**Priority**: P1 (il grafo è il cuore del sistema)

### Obiettivi

1. **Endpoint API completo** per subgraph retrieval
2. **Frontend integration** in VisuaLex workspace
3. **Layout intelligente** (force-directed + hierarchical)
4. **UX context-aware**: user capisce che parte del grafo sta visualizzando

### Task 2.1: Graph API Endpoints (Scope: COMPLETO)

**Status**: ❌ Not Started
**Effort**: 40 ore
**Dependencies**: Task 1.3 (requires entities in graph)
**Owner**: Backend specialist

#### Endpoint Design

**1. GET /api/graph/subgraph** - Retrieve subgraph around node
```typescript
interface SubgraphRequest {
  root_urn: string;           // Root article/entity URN
  depth: number;              // 1-3 hops
  relation_types?: string[];  // Filter by relation type
  entity_types?: string[];    // Filter by entity type
  include_metadata?: boolean; // Include approval_score, votes, etc.
  layout_hint?: 'force' | 'hierarchical' | 'radial';
}

interface SubgraphResponse {
  nodes: Array<{
    id: string;
    urn: string;
    type: string;             // "Articolo", "Principio", "Concetto", etc.
    label: string;            // Display name
    properties: {
      nome?: string;
      estremi?: string;
      descrizione?: string;
      ambito?: string;
      // Community validation
      community_validated?: boolean;
      approval_score?: number;
      votes_count?: number;
    };
    metadata: {
      created_at: string;
      source: string;         // "normattiva", "brocardi", "community"
    };
  }>;
  edges: Array<{
    id: string;
    source: string;           // node.id
    target: string;           // node.id
    type: string;             // Relation type (DISCIPLINA, ESPRIME_PRINCIPIO, etc.)
    properties: {
      strength?: number;      // 0-1
      bidirectional?: boolean;
    };
  }>;
  metadata: {
    total_nodes: number;
    total_edges: number;
    depth_reached: number;
    root_node_id: string;
  };
}
```

**Implementation:**
```python
# File: merlt/api/graph_router.py

from fastapi import APIRouter, Depends, Query
from merlt.storage.graph.client import FalkorDBClient

router = APIRouter(prefix="/graph", tags=["graph"])

@router.get("/subgraph")
async def get_subgraph(
    root_urn: str = Query(..., description="Root node URN"),
    depth: int = Query(2, ge=1, le=3, description="Max depth"),
    relation_types: Optional[List[str]] = Query(None),
    entity_types: Optional[List[str]] = Query(None),
    include_metadata: bool = Query(True),
    client: FalkorDBClient = Depends(get_falkordb_client)
) -> SubgraphResponse:
    """
    Retrieve subgraph around a root node.

    Complexity: O(k^d) where k=avg degree, d=depth
    Limits: depth<=3, max_nodes=200
    """
    # Build relation filter
    rel_filter = ""
    if relation_types:
        rel_filter = f":{':'.join(relation_types)}"

    # Build entity type filter
    entity_filter = ""
    if entity_types:
        entity_filter = f":{':'.join(entity_types)}"

    # Cypher query for subgraph
    cypher = f"""
        MATCH (root)
        WHERE root.urn = $root_urn OR root.URN = $root_urn OR root.id = $root_urn
        CALL {{
            WITH root
            MATCH path = (root)-[r{rel_filter}*1..{depth}]-(n{entity_filter})
            RETURN path
            LIMIT 200
        }}
        WITH nodes(path) AS path_nodes, relationships(path) AS path_rels
        UNWIND path_nodes AS node
        WITH collect(DISTINCT node) AS all_nodes, path_rels
        UNWIND path_rels AS rel
        WITH all_nodes, collect(DISTINCT rel) AS all_rels
        RETURN all_nodes, all_rels
    """

    results = await client.query(cypher, {"root_urn": root_urn})

    if not results:
        return SubgraphResponse(nodes=[], edges=[], metadata={...})

    # Parse nodes
    nodes = []
    for node_data in results[0]["all_nodes"]:
        node = {
            "id": node_data.get("id") or node_data.get("urn") or node_data.get("URN"),
            "urn": node_data.get("urn") or node_data.get("URN"),
            "type": node_data.get("labels", ["Unknown"])[0],
            "label": node_data.get("nome") or node_data.get("estremi") or node_data.get("id"),
            "properties": {
                k: v for k, v in node_data.get("properties", {}).items()
                if k not in ["id", "urn", "URN"]
            },
            "metadata": {
                "created_at": node_data.get("created_at"),
                "source": node_data.get("fonte", "normattiva"),
            }
        }
        nodes.append(node)

    # Parse edges
    edges = []
    for i, rel_data in enumerate(results[0]["all_rels"]):
        edge = {
            "id": f"edge_{i}",
            "source": rel_data.get("start_node_id"),  # FalkorDB specific
            "target": rel_data.get("end_node_id"),
            "type": rel_data.get("type"),
            "properties": rel_data.get("properties", {}),
        }
        edges.append(edge)

    return SubgraphResponse(
        nodes=nodes,
        edges=edges,
        metadata={
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "depth_reached": depth,
            "root_node_id": root_urn,
        }
    )
```

**2. POST /api/graph/search** - Search entities by name/description
```typescript
interface GraphSearchRequest {
  query: string;              // Search term
  entity_types?: string[];    // Filter by type
  fuzzy?: boolean;            // Fuzzy matching
  limit?: number;             // Max results (default: 20)
}

interface GraphSearchResponse {
  results: Array<{
    node_id: string;
    type: string;
    nome: string;
    descrizione: string;
    ambito: string;
    relevance_score: number;  // 0-1
    article_references: string[];  // Related articles
  }>;
  total_count: number;
}
```

**Implementation:**
```python
@router.post("/search")
async def search_graph(
    request: GraphSearchRequest,
    client: FalkorDBClient = Depends(get_falkordb_client)
) -> GraphSearchResponse:
    """
    Full-text search across entities.

    Uses Cypher string matching + optional fuzzy.
    Future: Integrate with Qdrant for semantic search.
    """
    entity_filter = ""
    if request.entity_types:
        entity_filter = f":{':'.join(request.entity_types)}"

    # Build search condition
    if request.fuzzy:
        search_cond = "toLower(e.nome) CONTAINS toLower($query) OR toLower(e.descrizione) CONTAINS toLower($query)"
    else:
        search_cond = "e.nome = $query"

    cypher = f"""
        MATCH (e:Entity{entity_filter})
        WHERE {search_cond}
        OPTIONAL MATCH (a:Articolo)-[r]->(e)
        WITH e, collect(DISTINCT a.urn) AS article_refs
        RETURN e.id AS node_id,
               e.tipo AS type,
               e.nome AS nome,
               e.descrizione AS descrizione,
               e.ambito AS ambito,
               article_refs
        LIMIT {request.limit or 20}
    """

    results = await client.query(cypher, {"query": request.query})

    # Calculate relevance (simple: exact match = 1.0, partial = 0.5)
    for result in results:
        if result["nome"].lower() == request.query.lower():
            result["relevance_score"] = 1.0
        else:
            result["relevance_score"] = 0.5

    return GraphSearchResponse(
        results=results,
        total_count=len(results)
    )
```

**3. GET /api/graph/article/{urn}/relations** - Get all relations for article
```typescript
interface ArticleRelationsResponse {
  article_urn: string;
  outgoing: Array<{
    relation_type: string;
    target_node: {
      id: string;
      type: string;
      nome: string;
    };
  }>;
  incoming: Array<{
    relation_type: string;
    source_node: {
      id: string;
      type: string;
      nome: string;
    };
  }>;
}
```

**4. GET /api/graph/stats** - Graph statistics
```typescript
interface GraphStatsResponse {
  total_nodes: number;
  total_edges: number;
  nodes_by_type: Record<string, number>;
  edges_by_type: Record<string, number>;
  community_validated_entities: number;
  avg_approval_score: number;
  last_updated: string;
}
```

#### Testing
```bash
# Test 1: Subgraph retrieval
curl "http://localhost:8000/api/graph/subgraph?root_urn=urn:...:art52&depth=2"

# Test 2: Search entities
curl -X POST http://localhost:8000/api/graph/search \
  -d '{"query": "legittima difesa", "fuzzy": true}'

# Test 3: Article relations
curl "http://localhost:8000/api/graph/article/urn:...:art52/relations"

# Test 4: Graph stats
curl "http://localhost:8000/api/graph/stats"
```

#### Acceptance Criteria
- [x] All 4 endpoints implemented
- [x] Subgraph retrieval working with depth 1-3
- [x] Search working (fuzzy + exact)
- [x] Performance: subgraph query < 500ms for depth=2
- [x] Tests passing

---

### Task 2.2: Frontend Graph Viewer Component

**Status**: ❌ Not Started
**Effort**: 40 ore
**Dependencies**: Task 2.1 (requires API endpoints)
**Owner**: Frontend specialist

#### Component Design

**Location:** `frontend/src/components/features/graph/GraphViewer.tsx`

**Features:**
1. **Force-directed layout** (react-force-graph-2d)
2. **Hierarchical tree view** (toggle)
3. **Interactive controls**: zoom, pan, drag nodes
4. **Node click** → show details panel
5. **Edge hover** → show relation type
6. **Filter controls**: entity type, relation type, depth
7. **Context breadcrumb**: "Visualizzando: Art 52 c.p. → Principi (3) → Concetti (5)"

**Implementation:**
```typescript
// frontend/src/components/features/graph/GraphViewer.tsx

import { useState, useEffect, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, ZoomIn, ZoomOut, Filter, GitBranch } from 'lucide-react';
import * as graphService from '../../../services/graphService';

interface GraphViewerProps {
  rootUrn: string;
  initialDepth?: number;
}

export function GraphViewer({ rootUrn, initialDepth = 2 }: GraphViewerProps) {
  const [graphData, setGraphData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [depth, setDepth] = useState(initialDepth);
  const [layout, setLayout] = useState<'force' | 'hierarchical'>('force');
  const [filters, setFilters] = useState({
    entityTypes: [] as string[],
    relationTypes: [] as string[],
  });

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const data = await graphService.getSubgraph({
        root_urn: rootUrn,
        depth,
        entity_types: filters.entityTypes.length > 0 ? filters.entityTypes : undefined,
        relation_types: filters.relationTypes.length > 0 ? filters.relationTypes : undefined,
      });

      // Transform to react-force-graph format
      const transformed = {
        nodes: data.nodes.map(n => ({
          id: n.id,
          name: n.label,
          type: n.type,
          ...n.properties,
        })),
        links: data.edges.map(e => ({
          source: e.source,
          target: e.target,
          type: e.type,
        })),
      };

      setGraphData(transformed);
    } catch (error) {
      console.error('Failed to load graph:', error);
    } finally {
      setLoading(false);
    }
  }, [rootUrn, depth, filters]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const nodeColor = (node: any) => {
    const colorMap: Record<string, string> = {
      Articolo: '#3b82f6',      // Blue
      Principio: '#8b5cf6',     // Purple
      Concetto: '#10b981',      // Green
      Definizione: '#f59e0b',   // Amber
      Soggetto: '#ef4444',      // Red
      // ... other types
    };
    return colorMap[node.type] || '#6b7280';  // Gray default
  };

  const nodeLabel = (node: any) => {
    return `
      <div style="background: white; padding: 8px; border-radius: 4px; border: 2px solid ${nodeColor(node)};">
        <strong>${node.name}</strong><br/>
        <span style="font-size: 12px; color: #666;">${node.type}</span>
        ${node.community_validated ? '<br/><span style="font-size: 11px; color: #10b981;">✓ Validato</span>' : ''}
      </div>
    `;
  };

  return (
    <div className="relative w-full h-full bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden">
      {/* Header Controls */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center gap-4">
        {/* Breadcrumb Context */}
        <div className="flex-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur px-4 py-2 rounded-lg shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            <GitBranch className="w-4 h-4 text-purple-600" />
            <span className="font-medium">Visualizzando:</span>
            <span className="text-slate-600 dark:text-slate-400">
              {graphData?.nodes?.[0]?.name || rootUrn}
            </span>
            <span className="text-slate-400">→</span>
            <span className="text-purple-600 font-medium">
              {graphData?.nodes?.length || 0} nodi, {graphData?.links?.length || 0} relazioni
            </span>
          </div>
        </div>

        {/* Layout Toggle */}
        <button
          onClick={() => setLayout(layout === 'force' ? 'hierarchical' : 'force')}
          className="px-4 py-2 bg-white dark:bg-slate-800 rounded-lg shadow-lg"
        >
          <Layers className="w-4 h-4" />
        </button>

        {/* Depth Control */}
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-4 py-2 rounded-lg shadow-lg">
          <span className="text-sm font-medium">Profondità:</span>
          <button
            onClick={() => setDepth(Math.max(1, depth - 1))}
            disabled={depth === 1}
            className="p-1 disabled:opacity-30"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-sm font-mono">{depth}</span>
          <button
            onClick={() => setDepth(Math.min(3, depth + 1))}
            disabled={depth === 3}
            className="p-1 disabled:opacity-30"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Button */}
        <button className="px-4 py-2 bg-white dark:bg-slate-800 rounded-lg shadow-lg">
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* Graph Canvas */}
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-600 border-t-transparent" />
        </div>
      ) : graphData ? (
        <ForceGraph2D
          graphData={graphData}
          nodeColor={nodeColor}
          nodeLabel={nodeLabel}
          nodeAutoColorBy="type"
          linkDirectionalArrowLength={6}
          linkDirectionalArrowRelPos={1}
          linkCurvature={0.25}
          onNodeClick={(node) => setSelectedNode(node)}
          enableNodeDrag={true}
          enableZoom={true}
          enablePan={true}
          width={window.innerWidth * 0.8}
          height={window.innerHeight * 0.8}
        />
      ) : null}

      {/* Node Details Panel */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            className="absolute top-4 right-4 w-80 bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">{selectedNode.name}</h3>
                <span className="text-sm text-slate-600 dark:text-slate-400">{selectedNode.type}</span>
              </div>
              <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {selectedNode.descrizione && (
              <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
                {selectedNode.descrizione}
              </p>
            )}

            {selectedNode.community_validated && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 mb-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                </svg>
                Validato dalla community ({selectedNode.votes_count} voti)
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <button className="flex-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm">
                Espandi nodo
              </button>
              <button className="flex-1 px-3 py-2 bg-slate-200 dark:bg-slate-700 rounded-lg text-sm">
                Dettagli
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

#### Integration in Workspace

```typescript
// frontend/src/components/features/workspace/WorkspaceTabPanel.tsx

import { GraphViewer } from '../graph/GraphViewer';

export function WorkspaceTabPanel({ tab }: WorkspaceTabPanelProps) {
  // ... existing code ...

  return (
    <div>
      {tab.content.map(block => {
        if (block.type === 'graph-view') {
          return (
            <GraphViewer
              key={block.id}
              rootUrn={block.rootUrn}
              initialDepth={2}
            />
          );
        }

        // ... existing block types ...
      })}
    </div>
  );
}
```

#### Acceptance Criteria
- [x] GraphViewer component implemented
- [x] Force-directed layout working
- [x] Node click → details panel
- [x] Depth control working (1-3 hops)
- [x] Context breadcrumb showing current view
- [x] Performance: smooth rendering for 200+ nodes
- [x] Integrated in workspace tabs

---

### Task 2.3: Graph Context UX

**Status**: ❌ Not Started
**Effort**: 20 ore
**Dependencies**: Task 2.2
**Owner**: UX + Frontend specialist

#### Obiettivo
User capisce SEMPRE che parte del grafo sta visualizzando/validando.

#### Features

**1. Validation Context Card**
When user validates entity, show:
```
┌─────────────────────────────────────────────────┐
│ 📍 CONTESTO VALIDAZIONE                          │
├─────────────────────────────────────────────────┤
│ Stai validando:                                  │
│   🟣 Principio: "Legittima difesa"              │
│                                                  │
│ Estratto da:                                     │
│   📄 Art. 52 c.p. - Causa di non punibilità     │
│                                                  │
│ Impatto:                                         │
│   • Se approvato, sarà usato da LiteralExpert   │
│   • Sarà collegato a 3 articoli correlati       │
│   • Arricchirà il knowledge graph (27K nodi)    │
│                                                  │
│ [Visualizza nel grafo]  [Dettagli fonte]        │
└─────────────────────────────────────────────────┘
```

**2. Graph Minimap**
Small preview showing position in full graph:
```
┌──────────────────────┐
│  Graph Overview      │
│                      │
│    Codice Penale     │
│         │            │
│    ┌────┴────┐       │
│   L.I     L.II       │
│    │                 │
│ ┌──┴──┐              │
│ 52  53  ◄── Tu sei qui
│ │                    │
│ Principi (5)         │
│ Concetti (12)        │
└──────────────────────┘
```

**3. Contribution Impact Visualization**
After validation, show animated graph update:
```
"Il tuo voto ha contribuito all'approvazione di questo principio!

 Nuovo collegamento creato:
 Art. 52 c.p. ──[ESPRIME_PRINCIPIO]──> Legittima difesa

 Grafo aggiornato: 27,741 nodi (+1)"
```

#### Acceptance Criteria
- [x] Validation context card implemented
- [x] Graph minimap showing user position
- [x] Contribution impact visualization
- [x] User comprehension test: 90%+ understand context

---

## 📊 PHASE 2 Summary

| Task | Effort | Status | Deliverable |
|------|--------|--------|-------------|
| 2.1 Graph API Endpoints | 40h | ❌ | 4 endpoints (subgraph, search, relations, stats) |
| 2.2 Frontend Graph Viewer | 40h | ❌ | React component with force-directed + hierarchical |
| 2.3 Graph Context UX | 20h | ❌ | Context card, minimap, impact viz |
| **TOTAL** | **100h** | - | **Complete graph visualization system** |

---

## 📡 PHASE 3: Pipeline Monitoring (P1 - HIGH PRIORITY)

**Timeline**: 2-3 settimane
**Effort**: 80-120 ore
**Priority**: P1 (transparency per utenti e admin)

### Obiettivi

1. **WebSocket infrastructure** per real-time updates
2. **Admin Dashboard WebUI** completo
3. **User progress view** non invasivo

### Task 3.1: WebSocket Infrastructure

**Status**: ❌ Not Started
**Effort**: 30 ore
**Dependencies**: Nessuna
**Owner**: Backend specialist

#### WebSocket Endpoints

**1. WS /api/pipeline/ws/{run_id}** - Pipeline execution updates
```typescript
// Client → Server (subscribe)
{
  "type": "subscribe",
  "run_id": "run_abc123"
}

// Server → Client (progress updates)
{
  "type": "progress",
  "run_id": "run_abc123",
  "pipeline": "enrichment",
  "status": "running",
  "progress": {
    "current": 45,
    "total": 100,
    "percentage": 45,
    "estimated_time_remaining_ms": 120000
  },
  "current_step": "Extracting entities from Art. 1453 c.c.",
  "stats": {
    "entities_created": 12,
    "relations_created": 23,
    "errors": 0
  }
}

// Server → Client (completion)
{
  "type": "complete",
  "run_id": "run_abc123",
  "status": "success",
  "final_stats": { ... },
  "duration_ms": 180000
}

// Server → Client (error)
{
  "type": "error",
  "run_id": "run_abc123",
  "error_message": "Failed to connect to Brocardi",
  "error_phase": "scraping",
  "recoverable": true
}
```

**2. WS /api/validation/ws** - Community validation updates
```typescript
// Server → Client (entity approved)
{
  "type": "entity_approved",
  "entity_id": "entity_abc123",
  "entity_name": "Legittima difesa",
  "approval_score": 2.5,
  "votes_count": 3,
  "graph_node_id": "principio:legittima_difesa"
}

// Server → Client (validation progress)
{
  "type": "validation_stats",
  "pending_entities": 15,
  "pending_relations": 8,
  "approved_today": 7,
  "rejected_today": 2
}
```

#### Implementation

```python
# File: merlt/api/websocket_router.py

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import asyncio
import json

router = APIRouter()

# Active connections by run_id
active_connections: Dict[str, Set[WebSocket]] = {}

@router.websocket("/pipeline/ws/{run_id}")
async def pipeline_websocket(websocket: WebSocket, run_id: str):
    await websocket.accept()

    # Register connection
    if run_id not in active_connections:
        active_connections[run_id] = set()
    active_connections[run_id].add(websocket)

    try:
        # Send initial state
        await websocket.send_json({
            "type": "connected",
            "run_id": run_id,
            "message": "Subscribed to pipeline updates"
        })

        # Keep connection alive
        while True:
            # Receive messages (for heartbeat)
            data = await websocket.receive_text()
            # Echo back (optional)
            await websocket.send_text(f"Received: {data}")

    except WebSocketDisconnect:
        # Unregister on disconnect
        active_connections[run_id].remove(websocket)
        if not active_connections[run_id]:
            del active_connections[run_id]


async def broadcast_pipeline_progress(
    run_id: str,
    pipeline: str,
    status: str,
    progress: dict,
    current_step: str,
    stats: dict
):
    """Broadcast progress update to all clients subscribed to run_id."""
    if run_id not in active_connections:
        return

    message = {
        "type": "progress",
        "run_id": run_id,
        "pipeline": pipeline,
        "status": status,
        "progress": progress,
        "current_step": current_step,
        "stats": stats,
    }

    # Broadcast to all connected clients
    disconnected = set()
    for websocket in active_connections[run_id]:
        try:
            await websocket.send_json(message)
        except:
            disconnected.add(websocket)

    # Remove disconnected clients
    for ws in disconnected:
        active_connections[run_id].remove(ws)
```

**Integration in pipeline:**
```python
# File: merlt/pipeline/ingestion.py

from merlt.api.websocket_router import broadcast_pipeline_progress

class IngestionPipelineV2:
    async def ingest_batch(self, articles: List[str], run_id: str = None):
        if not run_id:
            run_id = f"run_{uuid4().hex[:12]}"

        total = len(articles)
        for i, article_urn in enumerate(articles):
            # Process article
            result = await self.ingest_article(article_urn)

            # Broadcast progress
            await broadcast_pipeline_progress(
                run_id=run_id,
                pipeline="ingestion",
                status="running",
                progress={
                    "current": i + 1,
                    "total": total,
                    "percentage": ((i + 1) / total) * 100,
                },
                current_step=f"Processing {article_urn}",
                stats={
                    "articles_processed": i + 1,
                    "entities_created": self.stats.total_entities_created,
                    "errors": len(self.stats.errors),
                }
            )

        # Broadcast completion
        await broadcast_pipeline_progress(
            run_id=run_id,
            pipeline="ingestion",
            status="complete",
            progress={"current": total, "total": total, "percentage": 100},
            current_step="Done",
            stats=self.stats.to_dict()
        )
```

#### Acceptance Criteria
- [x] WebSocket endpoints implemented
- [x] Connection management (subscribe/unsubscribe)
- [x] Progress broadcast working
- [x] Multiple clients supported
- [x] Graceful disconnect handling

---

### Task 3.2: Admin Dashboard (WebUI)

**Status**: ❌ Not Started
**Effort**: 50 ore
**Dependencies**: Task 3.1
**Owner**: Frontend specialist

#### Dashboard Design

**Location:** `frontend/src/pages/AdminDashboard.tsx`

**Tabs:**
1. **Pipeline Runs** - List all pipeline executions
2. **Live Monitoring** - Real-time pipeline execution
3. **Validation Queue** - Community validation status
4. **Graph Stats** - Knowledge graph metrics
5. **User Contributions** - Top contributors

**Tab 1: Pipeline Runs**
```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 PIPELINE EXECUTIONS                                          │
├─────────────────────────────────────────────────────────────────┤
│ Run ID          │ Pipeline    │ Status    │ Progress │ Duration │
├─────────────────┼─────────────┼───────────┼──────────┼──────────┤
│ run_abc123      │ Enrichment  │ Running   │ 45/100   │ 2m 15s   │
│ run_def456      │ Ingestion   │ Complete  │ 100/100  │ 15m 32s  │
│ run_ghi789      │ Training    │ Failed    │ 23/50    │ 5m 10s   │
└─────────────────────────────────────────────────────────────────┘

[Filter by Pipeline] [Filter by Status] [Export CSV]
```

**Tab 2: Live Monitoring**
```
┌─────────────────────────────────────────────────────────────────┐
│ 🔴 LIVE: run_abc123 - Enrichment Pipeline                      │
├─────────────────────────────────────────────────────────────────┤
│ Progress: ████████████░░░░░░░░ 45%                              │
│ Current Step: Extracting entities from Art. 1453 c.c.          │
│ Estimated Time: 2m 30s remaining                                │
│                                                                 │
│ Stats:                                                          │
│   • Entities Created: 12                                        │
│   • Relations Created: 23                                       │
│   • Errors: 0                                                   │
│                                                                 │
│ Real-time Log:                                                  │
│ ┌───────────────────────────────────────────────────────────┐  │
│ │ [14:35:12] Processing Art. 1453 c.c.                       │  │
│ │ [14:35:15] Extracted 3 entities (2 concetti, 1 principio)  │  │
│ │ [14:35:18] Created 4 relations                             │  │
│ │ [14:35:20] Processing Art. 1454 c.c.                       │  │
│ │ ...                                                         │  │
│ └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│ [Pause] [Stop] [View Full Log]                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Tab 3: Validation Queue**
```
┌─────────────────────────────────────────────────────────────────┐
│ ✅ COMMUNITY VALIDATION                                         │
├─────────────────────────────────────────────────────────────────┤
│ Summary:                                                        │
│   • Pending Entities: 15                                        │
│   • Pending Relations: 8                                        │
│   • Approved Today: 7                                           │
│   • Rejected Today: 2                                           │
│                                                                 │
│ Top Pending:                                                    │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ Principio: "Legittima difesa"                            │   │
│ │ Votes: 2/3 (approval_score: 1.4)                         │   │
│ │ [View Details] [Force Approve] [Force Reject]            │   │
│ ├──────────────────────────────────────────────────────────┤   │
│ │ Concetto: "Buona fede oggettiva"                         │   │
│ │ Votes: 1/3 (approval_score: 0.7)                         │   │
│ │ [View Details]                                            │   │
│ └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Tab 4: Graph Stats**
```
┌─────────────────────────────────────────────────────────────────┐
│ 🌐 KNOWLEDGE GRAPH METRICS                                      │
├─────────────────────────────────────────────────────────────────┤
│ Total Nodes: 27,741 (+15 today)                                │
│ Total Edges: 43,935 (+23 today)                                │
│                                                                 │
│ Nodes by Type:                                                  │
│ ████████████░░░ Articoli: 3,148 (76%)                           │
│ ██░░░░░░░░░░░░ Principi: 456 (11%)                             │
│ █░░░░░░░░░░░░░ Concetti: 289 (7%)                              │
│ █░░░░░░░░░░░░░ Altri: 248 (6%)                                 │
│                                                                 │
│ Community Validated Entities: 67                                │
│ Avg Approval Score: 2.8                                         │
└─────────────────────────────────────────────────────────────────┘
```

#### Implementation

```typescript
// frontend/src/pages/AdminDashboard.tsx

import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs';
import { useWebSocket } from '../../hooks/useWebSocket';

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('runs');
  const [pipelineRuns, setPipelineRuns] = useState([]);
  const [liveRun, setLiveRun] = useState(null);

  // WebSocket for live monitoring
  const { connected, lastMessage } = useWebSocket(
    liveRun ? `ws://localhost:8000/api/pipeline/ws/${liveRun.id}` : null
  );

  useEffect(() => {
    if (lastMessage) {
      // Update live run data
      if (lastMessage.type === 'progress') {
        setLiveRun(prev => ({
          ...prev,
          progress: lastMessage.progress,
          current_step: lastMessage.current_step,
          stats: lastMessage.stats,
        }));
      }
    }
  }, [lastMessage]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Pipeline & Graph Dashboard</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="runs">Pipeline Runs</TabsTrigger>
          <TabsTrigger value="live">Live Monitoring</TabsTrigger>
          <TabsTrigger value="validation">Validation Queue</TabsTrigger>
          <TabsTrigger value="graph">Graph Stats</TabsTrigger>
          <TabsTrigger value="users">User Contributions</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <PipelineRunsTable runs={pipelineRuns} onSelectRun={setLiveRun} />
        </TabsContent>

        <TabsContent value="live">
          {liveRun ? (
            <LiveMonitoringPanel run={liveRun} connected={connected} />
          ) : (
            <div className="text-center py-12 text-slate-500">
              Select a running pipeline to monitor
            </div>
          )}
        </TabsContent>

        <TabsContent value="validation">
          <ValidationQueuePanel />
        </TabsContent>

        <TabsContent value="graph">
          <GraphStatsPanel />
        </TabsContent>

        <TabsContent value="users">
          <UserContributionsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

#### Acceptance Criteria
- [x] Admin dashboard implemented with 5 tabs
- [x] WebSocket integration for live monitoring
- [x] Real-time progress updates
- [x] Pipeline control (pause/stop/resume)
- [x] Validation queue management
- [x] Graph stats visualization
- [x] User contributions leaderboard

---

### Task 3.3: User Progress View (Non-invasivo)

**Status**: ❌ Not Started
**Effort**: 20 ore
**Dependencies**: Task 3.1
**Owner**: Frontend + UX specialist

#### Obiettivo
Mostrare contributi e impatto senza sovraccarico.

#### Design

**1. Contribution Toast (dopo validazione)**
```
┌─────────────────────────────────────────┐
│ ✓ Voto registrato!                      │
│                                         │
│ Il tuo contributo:                      │
│   • Approvato "Legittima difesa"        │
│   • +15 punti autorità (dominio penale) │
│   • Knowledge graph aggiornato          │
│                                         │
│ [Visualizza nel grafo]                  │
└─────────────────────────────────────────┘
```

**2. Profile Impact Widget**
```
┌─────────────────────────────────────────┐
│ 📊 IL TUO IMPATTO                        │
├─────────────────────────────────────────┤
│ Entità validate: 12                     │
│ Relazioni validate: 8                   │
│ Accuracy media: 92%                     │
│                                         │
│ Grafo arricchito:                       │
│   • 12 principi                         │
│   • 8 concetti                          │
│   • 5 definizioni                       │
│                                         │
│ [Dettagli contributi]                   │
└─────────────────────────────────────────┘
```

**3. Real-time Notification (WebSocket)**
```
┌─────────────────────────────────────────┐
│ 🔔 Il principio "Legittima difesa"      │
│    che hai validato è stato approvato!  │
│                                         │
│    Approval Score: 2.5 (3 voti)         │
│    Aggiunto al grafo: ✓                 │
│                                         │
│ [Vedi nel grafo] [Chiudi]               │
└─────────────────────────────────────────┘
```

#### Acceptance Criteria
- [x] Contribution toast after validation
- [x] Profile impact widget
- [x] Real-time notifications (WebSocket)
- [x] Non-invasive: max 1 notification ogni 5 min
- [x] User control: toggle notifications on/off

---

## 📊 PHASE 3 Summary

| Task | Effort | Status | Deliverable |
|------|--------|--------|-------------|
| 3.1 WebSocket Infrastructure | 30h | ❌ | WebSocket endpoints, broadcast system |
| 3.2 Admin Dashboard | 50h | ❌ | 5-tab dashboard con live monitoring |
| 3.3 User Progress View | 20h | ❌ | Contribution toast, impact widget, notifications |
| **TOTAL** | **100h** | - | **Complete monitoring system** |

---

## 🤖 PHASE 4: RLCF Training Automation (P2 - MEDIUM PRIORITY)

**Timeline**: 2-3 settimane
**Effort**: 80-120 ore
**Priority**: P2 (demo system functional, automation per production)

### Obiettivi

1. **Manual trigger** da admin page
2. **Training pipeline** completo
3. **A/B testing deployment**

### Task 4.1: Training Trigger UI (Admin)

**Status**: ❌ Not Started
**Effort**: 20 ore
**Dependencies**: Nessuna
**Owner**: Frontend + Backend specialist

#### Admin UI

**Location:** `frontend/src/pages/AdminDashboard.tsx` (new tab "RLCF Training")

```
┌─────────────────────────────────────────────────────────────────┐
│ 🧠 RLCF TRAINING CONTROL                                        │
├─────────────────────────────────────────────────────────────────┤
│ Current Model:                                                  │
│   • Version: v1.2.5                                             │
│   • Deployed: 2026-01-02 14:35                                  │
│   • Policy Entropy: 0.45                                        │
│   • Avg Reward: +0.78                                           │
│                                                                 │
│ Training Data Available:                                        │
│   • QA Traces: 127 (with feedback)                             │
│   • Inline Feedback: 87                                         │
│   • Detailed Feedback: 34                                       │
│   • Last Training: 3 days ago                                   │
│                                                                 │
│ [▶️ Start Training] [📊 View Metrics] [📜 Training History]     │
└─────────────────────────────────────────────────────────────────┘

Training Configuration:
┌─────────────────────────────────────────────────────────────────┐
│ Epochs: [5]              Learning Rate: [0.001]                 │
│ Batch Size: [32]         Validation Split: [0.2]                │
│ Policy Type: [x] Gating  [ ] Traversal                          │
│ Deploy Mode: [x] A/B Test (10% traffic)                         │
│              [ ] Full Deploy                                    │
│              [ ] Save Only (no deploy)                          │
│                                                                 │
│ [Cancel] [Start Training →]                                     │
└─────────────────────────────────────────────────────────────────┘
```

#### Backend Endpoint

```python
# File: merlt/api/rlcf_router.py

from fastapi import APIRouter, Depends, BackgroundTasks
from merlt.rlcf.policy_gradient import PolicyGradientTrainer, GatingPolicy

router = APIRouter(prefix="/rlcf", tags=["rlcf"])

@router.post("/training/start")
async def start_training(
    config: TrainingConfig,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_async_session_dep)
):
    """
    Start RLCF training in background.

    Returns run_id for monitoring via WebSocket.
    """
    run_id = f"training_{uuid4().hex[:12]}"

    # Start training in background
    background_tasks.add_task(
        run_training_pipeline,
        run_id=run_id,
        config=config,
        session=session
    )

    return {"run_id": run_id, "status": "started"}


async def run_training_pipeline(
    run_id: str,
    config: TrainingConfig,
    session: AsyncSession
):
    """Run full training pipeline with progress broadcast."""
    try:
        # Broadcast start
        await broadcast_training_progress(
            run_id=run_id,
            status="initializing",
            progress={"current": 0, "total": 100},
            message="Loading training data..."
        )

        # Step 1: Load training data
        traces_with_feedback = await load_training_data(session)
        await broadcast_training_progress(
            run_id=run_id,
            status="running",
            progress={"current": 20, "total": 100},
            message=f"Loaded {len(traces_with_feedback)} traces"
        )

        # Step 2: Initialize trainer
        trainer = PolicyGradientTrainer(
            policy_type="gating" if config.policy_type == "gating" else "traversal",
            learning_rate=config.learning_rate
        )
        await broadcast_training_progress(
            run_id=run_id,
            status="running",
            progress={"current": 30, "total": 100},
            message="Trainer initialized"
        )

        # Step 3: Train
        for epoch in range(config.epochs):
            metrics = await trainer.train_epoch(traces_with_feedback)

            await broadcast_training_progress(
                run_id=run_id,
                status="running",
                progress={"current": 30 + (epoch + 1) * 50 / config.epochs, "total": 100},
                message=f"Epoch {epoch + 1}/{config.epochs} - Loss: {metrics.loss:.4f}"
            )

        await broadcast_training_progress(
            run_id=run_id,
            status="running",
            progress={"current": 80, "total": 100},
            message="Training complete, evaluating..."
        )

        # Step 4: Evaluate
        validation_metrics = await trainer.evaluate(validation_set)

        # Step 5: Deploy (if configured)
        if config.deploy_mode == "ab_test":
            await deploy_model_ab_test(trainer.policy, traffic_percentage=0.1)
            deploy_message = "Deployed as A/B test (10% traffic)"
        elif config.deploy_mode == "full":
            await deploy_model_full(trainer.policy)
            deploy_message = "Deployed to production (100% traffic)"
        else:
            deploy_message = "Model saved (not deployed)"

        await broadcast_training_progress(
            run_id=run_id,
            status="complete",
            progress={"current": 100, "total": 100},
            message=deploy_message,
            final_metrics=validation_metrics
        )

    except Exception as e:
        await broadcast_training_progress(
            run_id=run_id,
            status="error",
            progress={"current": 0, "total": 100},
            message=f"Training failed: {str(e)}"
        )
```

#### Acceptance Criteria
- [x] Training trigger UI in admin dashboard
- [x] Training configuration form
- [x] Backend endpoint for training start
- [x] Background training execution
- [x] WebSocket progress updates
- [x] Training history log

---

### Task 4.2: Training Pipeline

**Status**: ❌ Not Started
**Effort**: 40 ore
**Dependencies**: Task 4.1
**Owner**: ML specialist

#### Training Loop

**Data Preparation:**
```python
async def load_training_data(session: AsyncSession) -> List[TrainingExample]:
    """
    Load QA traces with feedback for training.

    Returns list of (query, expert_selection, reward) tuples.
    """
    # Query qa_traces + qa_feedback
    result = await session.execute(
        select(QATrace, QAFeedback)
        .join(QAFeedback, QATrace.trace_id == QAFeedback.trace_id)
        .where(QAFeedback.inline_rating.isnot(None))  # Must have feedback
    )

    examples = []
    for trace, feedback in result:
        # Convert inline rating (1-5) to reward (-1 to +1)
        reward = (feedback.inline_rating - 3) / 2  # 1→-1, 3→0, 5→+1

        # Weight by user authority
        weighted_reward = reward * feedback.user_authority

        examples.append(TrainingExample(
            query_embedding=await embed_query(trace.query),
            expert_selection=trace.selected_experts,  # Ground truth
            reward=weighted_reward,
            metadata={
                "trace_id": trace.trace_id,
                "user_authority": feedback.user_authority,
                "synthesis_mode": trace.synthesis_mode,
            }
        ))

    return examples
```

**Training Loop (REINFORCE):**
```python
async def train_epoch(self, examples: List[TrainingExample]) -> TrainingMetrics:
    """Train for one epoch using REINFORCE algorithm."""
    total_loss = 0.0

    for batch in batched(examples, self.batch_size):
        # Forward pass
        query_embeddings = torch.stack([ex.query_embedding for ex in batch])
        expert_probs = self.policy(query_embeddings)  # (batch_size, num_experts)

        # Compute log probabilities for selected experts
        log_probs = []
        for i, ex in enumerate(batch):
            # Multi-hot encoding of selected experts
            selected_mask = torch.zeros(4)  # 4 experts
            for expert_idx in ex.expert_selection:
                expert_idx_num = self.expert_to_idx[expert_idx]
                selected_mask[expert_idx_num] = 1.0

            # Log prob of selection
            log_prob = (selected_mask * torch.log(expert_probs[i] + 1e-8)).sum()
            log_probs.append(log_prob)

        log_probs = torch.stack(log_probs)

        # REINFORCE loss: -log_prob * reward
        rewards = torch.tensor([ex.reward for ex in batch])
        loss = -(log_probs * rewards).mean()

        # Entropy regularization (encourage exploration)
        entropy = -(expert_probs * torch.log(expert_probs + 1e-8)).sum(dim=1).mean()
        loss = loss - 0.01 * entropy  # entropy_coef = 0.01

        # Backward pass
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.policy.parameters(), max_norm=1.0)
        self.optimizer.step()

        total_loss += loss.item()

    return TrainingMetrics(
        loss=total_loss / len(examples),
        avg_reward=np.mean([ex.reward for ex in examples]),
        policy_entropy=entropy.item(),
    )
```

**Evaluation:**
```python
async def evaluate(self, validation_set: List[TrainingExample]) -> ValidationMetrics:
    """Evaluate policy on validation set."""
    self.policy.eval()

    total_reward = 0.0
    correct_selections = 0

    with torch.no_grad():
        for ex in validation_set:
            # Predict expert selection
            expert_probs = self.policy(ex.query_embedding.unsqueeze(0))
            predicted_experts = torch.topk(expert_probs, k=2).indices[0].tolist()

            # Check if matches ground truth
            if set(predicted_experts) == set(ex.expert_selection):
                correct_selections += 1

            total_reward += ex.reward

    self.policy.train()

    return ValidationMetrics(
        avg_reward=total_reward / len(validation_set),
        accuracy=correct_selections / len(validation_set),
        policy_entropy=self.compute_entropy(validation_set),
    )
```

#### Acceptance Criteria
- [x] Training data loader implemented
- [x] REINFORCE training loop working
- [x] Entropy regularization
- [x] Validation evaluation
- [x] Model checkpointing
- [x] Metrics logging

---

### Task 4.3: A/B Testing Deployment

**Status**: ❌ Not Started
**Effort**: 20 ore
**Dependencies**: Task 4.2
**Owner**: Backend + DevOps specialist

#### A/B Test Infrastructure

**Model Versioning:**
```python
# File: merlt/rlcf/model_registry.py

from typing import Dict, Optional
import torch

class ModelRegistry:
    """Registry for RLCF policy models with versioning."""

    def __init__(self):
        self.models: Dict[str, torch.nn.Module] = {}
        self.active_model_version = "v1.0.0"
        self.ab_test_config: Optional[ABTestConfig] = None

    def register_model(self, version: str, model: torch.nn.Module):
        """Register a new model version."""
        self.models[version] = model
        logger.info(f"Registered model version {version}")

    def set_active(self, version: str):
        """Set active model version (100% traffic)."""
        if version not in self.models:
            raise ValueError(f"Model {version} not found")
        self.active_model_version = version
        self.ab_test_config = None
        logger.info(f"Activated model {version} (100% traffic)")

    def start_ab_test(
        self,
        control_version: str,
        treatment_version: str,
        traffic_percentage: float = 0.1
    ):
        """Start A/B test with treatment model."""
        if treatment_version not in self.models:
            raise ValueError(f"Treatment model {treatment_version} not found")

        self.ab_test_config = ABTestConfig(
            control_version=control_version,
            treatment_version=treatment_version,
            traffic_percentage=traffic_percentage,
        )
        logger.info(
            f"Started A/B test: {control_version} (90%) vs {treatment_version} (10%)"
        )

    def get_model_for_request(self, user_id: str) -> torch.nn.Module:
        """Get model for request (A/B routing based on user_id hash)."""
        if not self.ab_test_config:
            # No A/B test, return active model
            return self.models[self.active_model_version]

        # Hash user_id to determine A/B bucket
        user_hash = hash(user_id) % 100
        if user_hash < self.ab_test_config.traffic_percentage * 100:
            # Treatment group
            return self.models[self.ab_test_config.treatment_version]
        else:
            # Control group
            return self.models[self.ab_test_config.control_version]
```

**Integration in orchestrator:**
```python
# File: merlt/experts/orchestrator.py

class MultiExpertOrchestrator:
    def __init__(self, model_registry: ModelRegistry):
        self.model_registry = model_registry

    async def process(self, query: str, user_id: str, **kwargs):
        # Get policy model for this user (A/B routing)
        policy_model = self.model_registry.get_model_for_request(user_id)

        # Use policy to select experts
        query_emb = await self.embed_query(query)
        expert_probs = policy_model(query_emb)
        selected_experts = self.select_experts_from_probs(expert_probs)

        # ... rest of orchestration ...
```

**Metrics Tracking:**
```python
# File: merlt/api/experts_router.py

@router.post("/query")
async def query_experts(
    request: ExpertQueryRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    model_registry: ModelRegistry = Depends(get_model_registry)
):
    # Track which model version was used
    model_version = model_registry.get_active_version_for_user(request.user_id)

    # ... orchestrator.process() ...

    # Save trace with model version
    trace = QATrace(
        trace_id=trace_id,
        user_id=request.user_id,
        query=request.query,
        model_version=model_version,  # Track for A/B analysis
        # ... other fields ...
    )
```

**A/B Analysis:**
```sql
-- Compare metrics between control and treatment
SELECT
  model_version,
  COUNT(*) AS total_queries,
  AVG(CASE WHEN f.inline_rating >= 4 THEN 1.0 ELSE 0.0 END) AS satisfaction_rate,
  AVG(f.inline_rating) AS avg_rating,
  AVG(t.execution_time_ms) AS avg_latency_ms
FROM qa_traces t
LEFT JOIN qa_feedback f ON t.trace_id = f.trace_id
WHERE t.created_at >= NOW() - INTERVAL '7 days'
GROUP BY model_version;

-- Result:
-- model_version | total_queries | satisfaction_rate | avg_rating | avg_latency_ms
-- v1.2.5        | 450           | 0.78              | 4.2        | 2450
-- v1.3.0        | 50            | 0.84              | 4.5        | 2380
```

#### Acceptance Criteria
- [x] ModelRegistry implemented with versioning
- [x] A/B test routing (user_id hash)
- [x] Model version tracking in qa_traces
- [x] A/B metrics analysis query
- [x] Admin UI for A/B test status
- [x] Promote to production after validation

---

## 📊 PHASE 4 Summary

| Task | Effort | Status | Deliverable |
|------|--------|--------|-------------|
| 4.1 Training Trigger UI | 20h | ❌ | Admin dashboard training tab |
| 4.2 Training Pipeline | 40h | ❌ | REINFORCE training loop, validation |
| 4.3 A/B Testing | 20h | ❌ | Model versioning, A/B routing, metrics |
| **TOTAL** | **80h** | - | **Automated RLCF training with A/B testing** |

---

## 🎨 PHASE 5: Feature Completion (P3 - NICE TO HAVE)

**Timeline**: 2-4 settimane
**Effort**: 100-160 ore
**Priority**: P3 (enhancement features from Gap Analysis)

### Task 5.1: Compare View (Divergent Mode)

**Status**: ❌ Not Started
**Effort**: 40 ore
**Dependencies**: Nessuna
**Owner**: Frontend specialist

#### Obiettivo
Visualizzare interpretazioni divergenti side-by-side quando esperti non concordano.

#### Design

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️ DIVERGENZA RILEVATA                                          │
├─────────────────────────────────────────────────────────────────┤
│ Gli esperti hanno fornito interpretazioni contrastanti:         │
│                                                                 │
│ ┌────────────────────────┬────────────────────────┐            │
│ │ LITERAL EXPERT         │ SYSTEMIC EXPERT        │            │
│ ├────────────────────────┼────────────────────────┤            │
│ │ Interpretazione:       │ Interpretazione:       │            │
│ │ "Art 52 richiede..."   │ "Nel contesto del..."  │            │
│ │                        │                        │            │
│ │ Fondamento:            │ Fondamento:            │            │
│ │ - Art 52 c.p.          │ - Art 52 + Art 53 c.p. │            │
│ │ - Testo letterale      │ - Sistema penale       │            │
│ │                        │                        │            │
│ │ Confidence: 0.92       │ Confidence: 0.88       │            │
│ ├────────────────────────┼────────────────────────┤            │
│ │ [Preferisco questa]    │ [Preferisco questa]    │            │
│ └────────────────────────┴────────────────────────┘            │
│                                                                 │
│ [Feedback dettagliato] [Salva entrambe]                         │
└─────────────────────────────────────────────────────────────────┘
```

#### Acceptance Criteria
- [x] Compare view UI implemented
- [x] Side-by-side interpretation display
- [x] User can select preferred interpretation
- [x] Feedback recorded for RLCF

---

### Task 5.2: Dossier Training Sets

**Status**: ❌ Not Started
**Effort**: 20 ore
**Dependencies**: Nessuna
**Owner**: Backend + Frontend specialist

#### Obiettivo
Usare Dossiers come training set per fine-tuning esperti.

#### Design

```
Dossier: "Contratti di vendita - Casi pratici"
  - 15 articoli salvati
  - 8 Q&A sessions
  - 3 annotazioni utente

→ Export as Training Set
  {
    "queries": [
      {"query": "Cos'è la garanzia per vizi?", "expected_sources": ["art1490"]},
      ...
    ],
    "annotations": [
      {"article": "art1453", "user_note": "Importante: distinzione vendita/permuta"}
    ]
  }

→ Use for RLCF fine-tuning
```

#### Acceptance Criteria
- [x] Export dossier as training set
- [x] Training data format (JSON)
- [x] Integration with RLCF training pipeline
- [x] UI button in dossier page

---

### Task 5.3: Annotation Fine-Tuning

**Status**: ❌ Not Started
**Effort**: 20 ore
**Dependencies**: Task 5.2
**Owner**: ML specialist

#### Obiettivo
User annotations usate per fine-tuning retrieval.

#### Implementation
```python
# User annotates article with note
annotation = {
    "article_urn": "urn:...:art1453",
    "user_note": "Importante per casi di vendita immobiliare",
    "tags": ["vendita", "immobili", "consenso"],
}

# Fine-tune retrieval with user annotations
retriever.fine_tune_with_annotations(annotations=[annotation])
# → Boost relevance for queries about "vendita immobiliare"
```

#### Acceptance Criteria
- [x] Annotation capture UI
- [x] Fine-tuning integration
- [x] Retrieval boosting based on annotations

---

### Task 5.4: Bulletin Board RLCF Integration

**Status**: ❌ Not Started
**Effort**: 40 ore
**Dependencies**: Nessuna
**Owner**: Backend + Frontend specialist

#### Obiettivo
Discussions in Bulletin Board usate come feedback RLCF.

#### Design

```
Discussion Thread: "Interpretazione Art 52 c.p. - Legittima difesa"
  User A: "Secondo me richiede proporzione..."
  User B: "Ma il caso X mostra che..."

→ Extract as RLCF feedback
  {
    "article": "art52",
    "disagreement_detected": true,
    "positions": [
      {"user": "A", "interpretation": "...", "authority": 0.7},
      {"user": "B", "interpretation": "...", "authority": 0.6},
    ]
  }

→ Use for Disagreement Detection training
```

#### Acceptance Criteria
- [x] Discussion extraction
- [x] Position clustering
- [x] Disagreement detection training data

---

## 📊 PHASE 5 Summary

| Task | Effort | Status | Deliverable |
|------|--------|--------|-------------|
| 5.1 Compare View | 40h | ❌ | Side-by-side divergent interpretations |
| 5.2 Dossier Training Sets | 20h | ❌ | Export dossier as training data |
| 5.3 Annotation Fine-Tuning | 20h | ❌ | User annotations → retrieval boost |
| 5.4 Bulletin Board RLCF | 40h | ❌ | Discussions → disagreement training |
| **TOTAL** | **120h** | - | **Complete feature parity with Gap Analysis** |

---

## 📊 OVERALL ROADMAP SUMMARY

| Phase | Timeline | Effort | Priority | Status | Deliverables |
|-------|----------|--------|----------|--------|--------------|
| **Phase 1: Core Fixes** | 1 week | 10h | P0 | ❌ | DB Persistence, Domain Authority, FalkorDB Write |
| **Phase 2: Graph Viz** | 2-3 weeks | 100h | P1 | ❌ | API + UI + Context UX |
| **Phase 3: Monitoring** | 2-3 weeks | 100h | P1 | ❌ | WebSocket + Admin Dashboard + User View |
| **Phase 4: RLCF Training** | 2-3 weeks | 80h | P2 | ❌ | Manual trigger + Training + A/B test |
| **Phase 5: Features** | 2-4 weeks | 120h | P3 | ❌ | Compare View + Dossiers + Annotations + Bulletin |
| **TOTALE** | **10-15 weeks** | **410h** | - | - | **Sistema completo production-ready** |

---

## 🎯 MILESTONE TRACKING

### Milestone 1: Community Validation Production-Ready (Week 1)
- [x] Live Enrichment DB Persistence
- [x] Domain Authority (real data)
- [x] FalkorDB Write Operations
- **Acceptance**: User can validate entity → persists → goes to graph → no data loss

### Milestone 2: Graph as Core Feature (Week 4)
- [x] Graph API endpoints
- [x] Graph Viewer UI
- [x] Context-aware UX
- **Acceptance**: User visualizes subgraph, understands position, navigates graph

### Milestone 3: Full Transparency (Week 7)
- [x] WebSocket infrastructure
- [x] Admin Dashboard
- [x] User Progress View
- **Acceptance**: Admin monitors pipelines real-time, users see impact contributions

### Milestone 4: Automated Training (Week 10)
- [x] Training trigger
- [x] Training pipeline
- [x] A/B testing
- **Acceptance**: Admin triggers training, model deployed with A/B test, metrics tracked

### Milestone 5: Feature Complete (Week 15)
- [x] All Phase 5 features
- **Acceptance**: Compare view, dossier training, annotations, bulletin RLCF all working

---

## 🚀 DEPLOYMENT STRATEGY

### Development Environment
```bash
# MERL-T
cd /Users/gpuzio/Desktop/CODE/MERL-T_alpha
docker-compose -f docker-compose.dev.yml up -d
python -m merlt.api.visualex_bridge

# VisuaLex
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI
npm run dev:backend  # Port 3001
npm run dev:frontend # Port 5173
```

### Production Environment (Future)
```yaml
# docker-compose.prod.yml
services:
  merlt-api:
    image: merlt:v1.0.0
    environment:
      - ENV=production
      - DATABASE_URL=postgresql://...

  visualex-backend:
    image: visualex-backend:v1.0.0
    environment:
      - MERLT_API_URL=http://merlt-api:8000

  visualex-frontend:
    image: visualex-frontend:v1.0.0
    build:
      context: ./frontend
      args:
        - VITE_API_URL=https://api.visualex.it
```

---

## 📝 TESTING STRATEGY

### Phase 1: Unit + Integration Tests
- PostgreSQL schema tests
- Domain authority calculation tests
- FalkorDB write + deduplication tests

### Phase 2: E2E Tests
- Graph API endpoint tests (subgraph, search, relations)
- Graph Viewer UI tests (interaction, rendering)
- Context UX tests (user comprehension)

### Phase 3: Load Tests
- WebSocket connection scalability (100+ concurrent)
- Dashboard real-time updates
- Notification delivery rate

### Phase 4: ML Tests
- Training data quality checks
- Model convergence tests
- A/B test statistical significance

### Phase 5: User Acceptance Tests
- Compare view usability
- Dossier export workflow
- Bulletin discussion extraction

---

## 📖 DOCUMENTATION UPDATES

Dopo ogni phase, aggiornare:

1. **MERL_T_IMPLEMENTATION_STATUS.md**
   - Update feature status (❌ → ✅)
   - Add test coverage
   - Update database state

2. **VISUALEX_IMPLEMENTATION_STATUS.md**
   - Update frontend components
   - Add new endpoints
   - Update integration points

3. **INTEGRATION_MERL_T_VISUALEX.md**
   - Add new API endpoints
   - Update data flows
   - Document WebSocket protocols

4. **README.md**
   - Update Quick Start
   - Add new features to feature list
   - Update screenshots

---

## ⏱️ TIME ESTIMATES & FLEXIBILITY

**Conservative Estimate**: 15 settimane (full-time equivalent)
**Optimistic Estimate**: 10 settimane (se parallelizzazione efficace)
**Realistic for Tesi**: 12-14 settimane (con altre attività tesi)

**Buffer Time**: +2 settimane per imprevisti, testing, bug fixing

**Total Timeline**: **12-17 settimane** (3-4 mesi)

**Decisione**: Se consegna tesi flessibile, **implementare tutto** per demo completo.

---

**Ultimo Aggiornamento**: 4 Gennaio 2026
**Versione Roadmap**: 1.0
**Status**: ✅ Pronto per execution

---

*Questa roadmap è stata generata in base alle decisioni prese e ai principi di rigore ingegneristico di MERL-T. Ogni task ha acceptance criteria verificabili.*
