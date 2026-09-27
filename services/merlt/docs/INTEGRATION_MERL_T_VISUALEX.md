# INTEGRATION MERL-T ↔ VisuaLex

**Versione**: 1.0
**Data**: 4 Gennaio 2026
**Autore**: Sistema Multi-Agente MERL-T

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VisuaLex Frontend (React)                        │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ FloatingQA     │  │ QAPanel     │  │ Expert       │  │ useAppStore│ │
│  │ Button         │  │             │  │ Service      │  │            │ │
│  └───────┬────────┘  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │
│          │                  │                │                 │         │
│          └──────────────────┴────────────────┴─────────────────┘         │
│                                     │                                     │
└─────────────────────────────────────┼─────────────────────────────────────┘
                                      │ HTTP (axios)
                                      │ Port: 3001
                    ┌─────────────────▼────────────────────┐
                    │  VisuaLex Express Backend            │
                    │  ┌─────────────────────────────────┐ │
                    │  │ merltController.ts              │ │
                    │  │  - trackInteraction()           │ │
                    │  │  - submitFeedback()             │ │
                    │  │  - queryExperts()               │ │
                    │  │  - submitInlineFeedback()       │ │
                    │  │  - liveEnrich()                 │ │
                    │  │  - validateEntity()             │ │
                    │  │  - getFullProfile()             │ │
                    │  └──────────┬──────────────────────┘ │
                    │             │                         │
                    │  ┌──────────▼──────────────────────┐ │
                    │  │ PostgreSQL (VisuaLex)           │ │
                    │  │  - User (merltUserId,           │ │
                    │  │         merltAuthority)         │ │
                    │  │  - MerltFeedback (tracking)     │ │
                    │  └─────────────────────────────────┘ │
                    └──────────────┬──────────────────────┘
                                   │ HTTP Proxy (axios)
                                   │ MERLT_API_URL
                                   │ Default: http://localhost:8000
          ┌────────────────────────▼─────────────────────────┐
          │        MERL-T FastAPI Backend                    │
          │  ┌──────────────────────────────────────────────┐│
          │  │ visualex_bridge.py (Main App)                ││
          │  │  Port: 8000                                  ││
          │  │  Lifespan: Initialize MultiExpertOrchestrator││
          │  └───────────────────┬──────────────────────────┘│
          │                      │ Include Routers           │
          │  ┌───────────────────▼──────────────────────────┐│
          │  │ experts_router.py                            ││
          │  │  POST /api/experts/query                     ││
          │  │  POST /api/experts/feedback/inline           ││
          │  │  POST /api/experts/feedback/detailed         ││
          │  │  POST /api/experts/feedback/source           ││
          │  │  POST /api/experts/feedback/refine           ││
          │  └──────────────────────────────────────────────┘│
          │  ┌──────────────────────────────────────────────┐│
          │  │ enrichment_router.py                         ││
          │  │  GET  /api/enrichment/check-article          ││
          │  │  POST /api/enrichment/live                   ││
          │  │  POST /api/enrichment/validate-entity        ││
          │  │  POST /api/enrichment/validate-relation      ││
          │  │  POST /api/enrichment/propose-entity         ││
          │  │  POST /api/enrichment/propose-relation       ││
          │  │  POST /api/enrichment/pending                ││
          │  │  GET  /api/enrichment/admin/stats            ││
          │  └──────────────────────────────────────────────┘│
          │  ┌──────────────────────────────────────────────┐│
          │  │ profile_router.py                            ││
          │  │  GET   /api/merlt/profile/full               ││
          │  │  GET   /api/merlt/profile/authority/domains  ││
          │  │  GET   /api/merlt/profile/stats/detailed     ││
          │  │  PATCH /api/merlt/profile/qualification      ││
          │  │  PATCH /api/merlt/profile/notifications      ││
          │  └──────────────────────────────────────────────┘│
          │  ┌──────────────────────────────────────────────┐│
          │  │ feedback_router.py (deprecated for Q&A)      ││
          │  │  POST /api/feedback (legacy)                 ││
          │  └──────────────────────────────────────────────┘│
          │  ┌──────────────────────────────────────────────┐│
          │  │ auth_router.py                               ││
          │  │  POST /api/auth/sync                         ││
          │  │  GET  /api/auth/authority/{user_id}          ││
          │  └──────────────────────────────────────────────┘│
          └────────────────────┬─────────────────────────────┘
                               │
          ┌────────────────────▼─────────────────────────────┐
          │         MERL-T Storage & Processing              │
          │  ┌───────────────────────────────────────────┐   │
          │  │ PostgreSQL (RLCF)                         │   │
          │  │  - qa_traces (queries & responses)        │   │
          │  │  - qa_feedback (inline, detailed, source) │   │
          │  │  Port: 5433                               │   │
          │  └───────────────────────────────────────────┘   │
          │  ┌───────────────────────────────────────────┐   │
          │  │ FalkorDB (Knowledge Graph)                │   │
          │  │  - merl_t_dev (27,740 nodes)              │   │
          │  │  Port: 6380                               │   │
          │  └───────────────────────────────────────────┘   │
          │  ┌───────────────────────────────────────────┐   │
          │  │ Qdrant (Vector Store)                     │   │
          │  │  - merl_t_dev_chunks (5,926 vectors)      │   │
          │  │  Port: 6333                               │   │
          │  └───────────────────────────────────────────┘   │
          │  ┌───────────────────────────────────────────┐   │
          │  │ Redis (Cache)                             │   │
          │  │  - dev:* keys                             │   │
          │  │  Port: 6379                               │   │
          │  └───────────────────────────────────────────┘   │
          └───────────────────────────────────────────────────┘
```

---

## 2. API Integration Points

### 2.1 Expert System Q&A

#### POST /api/merlt/experts/query

**VisuaLex → MERL-T**

```typescript
// Frontend: frontend/src/services/expertService.ts
export async function queryExperts(request: ExpertQueryRequest): Promise<ExpertQueryResponse> {
  const response = await api.post<ExpertQueryResponse>('/merlt/experts/query', request);
  return response.data;
}

// Request Type
interface ExpertQueryRequest {
  query: string;              // "Cos'è la legittima difesa?"
  context?: {                 // Optional context
    entities?: any[];
    retrieved_chunks?: any[];
  };
  max_experts?: number;       // Default: 4
}

// Response Type
interface ExpertQueryResponse {
  trace_id: string;           // "trace_abc123" - for feedback
  synthesis: string;          // Final answer
  mode: 'convergent' | 'divergent';
  alternatives?: Array<{     // Only in divergent mode
    expert: string;
    interpretation: string;
    legal_basis: string;
  }>;
  sources: Array<{
    article_urn: string;
    expert: string;
    relevance: number;        // 0.0-1.0
    excerpt?: string;
  }>;
  experts_used: string[];     // ["literal", "systemic"]
  confidence: number;         // 0.0-1.0
  execution_time_ms: number;
}
```

**Backend Proxy:**
```typescript
// backend/src/controllers/merltController.ts
export const queryExperts = async (req: Request, res: Response) => {
  const data = expertQuerySchema.parse(req.body);

  const response = await axios.post(`${MERLT_API_URL}/api/experts/query`, {
    ...data,
    user_id: req.user.merltUserId || req.user.id,
  });

  // Track Q&A interaction in local DB
  await prisma.merltFeedback.create({
    data: {
      userId: req.user.id,
      type: 'implicit',
      interactionType: 'expert_query',
      traceId: response.data.trace_id,
      queryText: data.query,
      metadata: {
        synthesis_mode: response.data.mode,
        experts_used: response.data.experts_used,
        confidence: response.data.confidence,
      },
      syncedToMerlt: true,
    },
  });

  res.json(response.data);
};
```

**MERL-T Handler:**
```python
# merlt/api/experts_router.py
@router.post("/query", response_model=ExpertQueryResponse)
async def query_experts(
    request: ExpertQueryRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    orchestrator: MultiExpertOrchestrator = Depends(get_orchestrator)
):
    # Run MultiExpertOrchestrator
    result = await orchestrator.process(
        query=request.query,
        entities=request.context.get("entities") if request.context else None,
        retrieved_chunks=request.context.get("retrieved_chunks") if request.context else None,
        metadata={"user_id": request.user_id}
    )

    # Generate trace_id
    trace_id = f"trace_{uuid4().hex[:12]}"

    # Save QATrace to PostgreSQL
    trace = QATrace(
        trace_id=trace_id,
        user_id=request.user_id,
        query=request.query,
        selected_experts=list(result.expert_contributions.keys()),
        synthesis_mode=result.mode.value,
        synthesis_text=result.synthesis,
        sources=[s.dict() for s in sources],
        execution_time_ms=execution_time_ms
    )
    session.add(trace)
    await session.commit()

    return ExpertQueryResponse(...)
```

**UI Component:**
```typescript
// frontend/src/components/features/qa/QAPanel.tsx
export function QAPanel({ qaBlock, tabId, onRemove, ... }: QAPanelProps) {
  const response = qaBlock.response as ExpertQueryResponse;

  return (
    <div className="qa-panel">
      {/* Header with mode badge */}
      <div className={colors.bg}>
        {response.mode === 'convergent' ? '✓ Convergente' : '⚠ Divergente'}
      </div>

      {/* Synthesis */}
      <p>{response.synthesis}</p>

      {/* Alternative interpretations (divergent mode) */}
      {response.mode === 'divergent' && response.alternatives?.map(...)}

      {/* Sources */}
      {response.sources.map(source => (
        <div>
          <span>{getURNDisplayName(source.article_urn)}</span>
          <span>({source.expert})</span>
          <button onClick={() => onAddSourceAsArticle(source.article_urn)}>
            <Plus /> {/* Add to workspace */}
          </button>
        </div>
      ))}

      {/* Feedback buttons */}
      <button onClick={handleFeedbackPositive}>👍 Sì</button>
      <button onClick={handleFeedbackNegative}>👎 No</button>
      <button onClick={handleFeedbackDetailed}>💬 Dettagli</button>
    </div>
  );
}
```

---

#### POST /api/merlt/experts/feedback/inline

**Quick thumbs up/down feedback**

```typescript
// Request
interface InlineFeedbackRequest {
  trace_id: string;
  rating: number;  // 1-5 (1=thumbs down, 5=thumbs up)
}

// Response
interface FeedbackResponse {
  success: boolean;
  feedback_id?: number;
  message: string;
}
```

**VisuaLex Handler:**
```typescript
export const submitInlineFeedback = async (req: Request, res: Response) => {
  const response = await axios.post(`${MERLT_API_URL}/api/experts/feedback/inline`, {
    ...data,
    user_id: req.user.merltUserId || req.user.id,
    user_authority: req.user.merltAuthority || 0.3,
  });

  // Track in local DB
  await prisma.merltFeedback.create({
    data: {
      userId: req.user.id,
      type: 'explicit',
      interactionType: 'expert_feedback_inline',
      traceId: data.trace_id,
      feedbackData: { inline_rating: data.rating },
      syncedToMerlt: true,
    },
  });

  // Increment contribution count
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      totalFeedbackCount: { increment: 1 },
      totalContributions: { increment: 1 },
    },
  });

  res.json(response.data);
};
```

**MERL-T Handler:**
```python
@router.post("/feedback/inline", response_model=FeedbackResponse)
async def submit_inline_feedback(
    request: InlineFeedbackRequest,
    session: AsyncSession = Depends(get_async_session_dep)
):
    # Verify trace exists
    result = await session.execute(
        select(QATrace).where(QATrace.trace_id == request.trace_id)
    )
    trace = result.scalar_one_or_none()
    if not trace:
        raise HTTPException(404, f"Trace {request.trace_id} not found")

    # Create feedback
    feedback = QAFeedback(
        trace_id=request.trace_id,
        user_id=request.user_id,
        inline_rating=request.rating
    )
    session.add(feedback)
    await session.commit()

    return FeedbackResponse(
        success=True,
        feedback_id=feedback.id,
        message="Inline feedback saved successfully"
    )
```

---

#### POST /api/merlt/experts/feedback/detailed

**3-dimension feedback (retrieval, reasoning, synthesis)**

```typescript
interface DetailedFeedbackRequest {
  trace_id: string;
  retrieval_score: number;  // 0-1: Quality of sources
  reasoning_score: number;  // 0-1: Quality of reasoning
  synthesis_score: number;  // 0-1: Quality of synthesis
  comment?: string;
}
```

**Database:**
```python
# merlt/rlcf/database.py → PostgreSQL qa_feedback table
class QAFeedback(Base):
    __tablename__ = "qa_feedback"

    id = Column(Integer, primary_key=True)
    trace_id = Column(String, ForeignKey("qa_traces.trace_id"))
    user_id = Column(String)

    # Inline feedback
    inline_rating = Column(Integer)  # 1-5

    # Detailed 3D feedback
    retrieval_score = Column(Float)
    reasoning_score = Column(Float)
    synthesis_score = Column(Float)
    detailed_comment = Column(Text)

    # Per-source feedback
    source_id = Column(String)  # article URN
    source_relevance = Column(Integer)  # 1-5 stars

    # Conversational refinement
    follow_up_query = Column(Text)
    refined_trace_id = Column(String)

    # Authority weighting
    user_authority = Column(Float)

    created_at = Column(DateTime, default=datetime.utcnow)
```

---

#### POST /api/merlt/experts/feedback/source

**Per-source rating (1-5 stars)**

```typescript
interface SourceFeedbackRequest {
  trace_id: string;
  source_id: string;  // article URN
  relevance: number;  // 1-5 stars
}
```

---

#### POST /api/merlt/experts/feedback/refine

**Conversational refinement with follow-up**

```typescript
interface RefineFeedbackRequest {
  trace_id: string;
  follow_up_query: string;  // "Puoi spiegare meglio il requisito della proporzione?"
}

// Response: ExpertQueryResponse (new query result)
```

**Flow:**
1. User submits follow-up query
2. MERL-T saves feedback linking original trace
3. MERL-T re-runs orchestrator with context from original query
4. New trace created with `refined_trace_id` linking to original
5. Returns new `ExpertQueryResponse`

---

### 2.2 Live Enrichment & Validation

#### GET /api/merlt/enrichment/check-article

**Check if article exists in knowledge graph**

```typescript
// VisuaLex → MERL-T
export const checkArticleInGraph = async (req: Request, res: Response) => {
  const { tipo_atto, articolo, numero_atto, data } = req.query;

  const params = new URLSearchParams({
    tipo_atto: tipo_atto as string,
    articolo: articolo as string,
  });

  const response = await axios.get(
    `${MERLT_API_URL}/api/enrichment/check-article?${params}`
  );

  res.json(response.data);
};

// Response
interface CheckArticleResponse {
  in_graph: boolean;
  node_count: number;
  has_entities: boolean;
  last_updated: string | null;
  article_urn: string | null;
  error?: string;
}
```

---

#### POST /api/merlt/enrichment/live

**Live enrichment for an article**

```typescript
interface LiveEnrichmentRequest {
  tipo_atto: string;          // "codice penale"
  articolo: string;           // "52"
  numero_atto?: string;
  data?: string;
  user_id: string;
  user_authority: number;
  include_brocardi?: boolean;
  extract_entities?: boolean;
  priority_types?: string[];  // ["concetto", "principio"]
}

interface LiveEnrichmentResponse {
  success: boolean;
  article_urn: string;
  pending_entities: PendingEntityData[];
  pending_relations: PendingRelationData[];
  execution_time_ms: number;
  message: string;
}

interface PendingEntityData {
  id: string;                 // "entity_abc123"
  nome: string;               // "Legittima difesa"
  tipo: EntityType;           // "principio"
  descrizione: string;
  articoli_correlati: string[];
  ambito: string;
  fonte: string;              // "brocardi" | "llm_extraction"
  llm_confidence: number;     // 0.0-1.0
  validation_status: 'pending' | 'approved' | 'rejected';
  approval_score: number;
  rejection_score: number;
  votes_count: number;
  contributed_by: string;
  contributor_authority: number;
}
```

**VisuaLex Handler:**
```typescript
export const liveEnrich = async (req: Request, res: Response) => {
  const response = await axios.post(`${MERLT_API_URL}/api/enrichment/live`, {
    ...data,
    user_id: req.user.merltUserId || req.user.id,
    user_authority: req.user.merltAuthority || 0.3,
  });

  res.json(response.data);
};
```

**MERL-T Handler:**
```python
@router.post("/live", response_model=LiveEnrichmentResponse)
async def live_enrich(request: LiveEnrichmentRequest):
    from merlt.pipeline.live_enrichment import LiveEnrichmentService

    service = LiveEnrichmentService()
    response = await service.enrich(request)

    # Save pending entities/relations to in-memory storage
    for entity in response.pending_entities:
        _pending_entities[entity.id] = entity
        _entity_votes[entity.id] = []

    for relation in response.pending_relations:
        _pending_relations[relation.id] = relation
        _relation_votes[relation.id] = []

    return response
```

---

#### POST /api/merlt/enrichment/validate-entity

**Vote to approve/reject/edit a pending entity**

```typescript
interface EntityValidationRequest {
  entity_id: string;
  vote: 'approve' | 'reject' | 'edit';
  suggested_edits?: {        // Only for 'edit' vote
    nome?: string;
    descrizione?: string;
    ambito?: string;
  };
  reason?: string;
  user_id: string;
  user_authority: number;    // 0.3-1.0 (RLCF authority weight)
}

interface EntityValidationResponse {
  success: boolean;
  entity_id: string;
  new_status: 'pending' | 'approved' | 'rejected';
  approval_score: number;    // Weighted sum of approve votes
  rejection_score: number;
  votes_count: number;
  message: string;
  graph_node_id?: string;    // If approved
}
```

**Validation Logic:**
```python
# merlt/api/enrichment_router.py
@router.post("/validate-entity")
async def validate_entity(request: EntityValidationRequest):
    entity = _pending_entities[entity_id]

    # Create feedback with authority weighting
    feedback = EntityValidationFeedback(
        entity_id=entity_id,
        entity_type=entity.tipo,
        vote=request.vote,
        suggested_edits=request.suggested_edits,
        reason=request.reason,
        user_id=request.user_id,
        user_authority=request.user_authority,  # RLCF weight
    )

    # Add to votes
    _entity_votes[entity_id].append(feedback)

    # Aggregate with RLCF authority weighting
    result = _entity_aggregator.aggregate(_entity_votes[entity_id])

    # Update entity status
    entity.approval_score = sum(f.weighted_vote for f in _entity_votes[entity_id] if f.weighted_vote > 0)
    entity.rejection_score = abs(sum(f.weighted_vote for f in _entity_votes[entity_id] if f.weighted_vote < 0))
    entity.validation_status = result.status  # 'approved' if score >= 2.0

    # Apply merged edits if approved
    if result.status == ValidationStatus.APPROVED and result.merged_edits:
        for key, value in result.merged_edits.items():
            setattr(entity, key, value)

    # Write to FalkorDB if approved
    if result.status == ValidationStatus.APPROVED:
        graph_node_id = f"node:{entity.tipo.value}:{entity.nome}"
        # TODO: Write to FalkorDB

    return EntityValidationResponse(...)
```

**Authority Weighting Formula:**
```python
# merlt/rlcf/entity_feedback.py
class EntityValidationFeedback:
    def __post_init__(self):
        # Weighted vote = user_authority * vote_direction
        vote_map = {"approve": 1.0, "reject": -1.0, "edit": 0.5}
        self.weighted_vote = self.user_authority * vote_map[self.vote]
```

**Aggregation Threshold:**
```python
# merlt/rlcf/entity_feedback.py
class EntityValidationAggregator:
    def __init__(self, approval_threshold: float = 2.0):
        self.approval_threshold = approval_threshold  # Σ(weighted_votes)

    def aggregate(self, feedbacks: List[EntityValidationFeedback]) -> ValidationResult:
        score = sum(f.weighted_vote for f in feedbacks)

        if score >= self.approval_threshold:
            status = ValidationStatus.APPROVED
        elif score <= -self.approval_threshold:
            status = ValidationStatus.REJECTED
        else:
            status = ValidationStatus.PENDING

        return ValidationResult(status=status, score=score, ...)
```

---

#### POST /api/merlt/enrichment/validate-relation

**Vote on a pending relation**

```typescript
interface RelationValidationRequest {
  relation_id: string;
  vote: 'approve' | 'reject' | 'edit';
  suggested_edits?: {
    relation_type?: string;
  };
  reason?: string;
  user_id: string;
  user_authority: number;
}
```

---

#### POST /api/merlt/enrichment/propose-entity

**User-contributed entity proposal**

```typescript
interface EntityProposalRequest {
  article_urn: string;
  nome: string;
  tipo: EntityType;          // "concetto" | "principio" | "definizione"
  descrizione?: string;
  articoli_correlati?: string[];
  ambito?: string;
  evidence?: string;         // Why this entity is relevant
  user_id: string;
  user_authority: number;
}

interface EntityProposalResponse {
  success: boolean;
  pending_entity: PendingEntityData;
  message: string;
}
```

---

#### POST /api/merlt/enrichment/pending

**Get pending queue for validation**

```typescript
interface PendingQueueRequest {
  user_id: string;
  include_own?: boolean;     // Include user's own proposals
  entity_types?: string[];   // Filter by type
  limit?: number;            // Default: 20
  offset?: number;
}

interface PendingQueueResponse {
  pending_entities: PendingEntityData[];
  pending_relations: PendingRelationData[];
  total_entities: number;
  total_relations: number;
  user_can_vote: number;     // Items user hasn't voted on yet
}
```

**VisuaLex Handler:**
```typescript
export const getPendingQueue = async (req: Request, res: Response) => {
  const response = await axios.post(`${MERLT_API_URL}/api/enrichment/pending`, {
    ...data,
    user_id: req.user.merltUserId || req.user.id,
  });

  res.json(response.data);
};
```

---

#### GET /api/merlt/enrichment/admin/stats

**Admin dashboard stats**

```typescript
interface AdminStatsResponse {
  summary: {
    total_entities: number;
    total_relations: number;
    total_votes: number;
    pending_validations: number;
    approval_rate: number;    // 0.0-1.0
    avg_time_to_approval_hours: number;
  };
  entities: {
    pending: number;
    approved: number;
    rejected: number;
    by_type: Record<string, number>;
  };
  relations: {
    pending: number;
    approved: number;
    rejected: number;
  };
  votes: {
    total: number;
    today: number;
    this_week: number;
    by_type: {
      approve: number;
      reject: number;
      edit: number;
    };
  };
  top_contributors: Array<{
    user_id: string;
    contributions: number;
  }>;
  pending_entities: Array<{
    id: string;
    nome: string;
    tipo: string;
    approval_score: number;
    rejection_score: number;
    votes_count: number;
    llm_confidence: number;
    contributed_by: string;
  }>;
  pending_relations: Array<...>;
}
```

**VisuaLex Handler:**
```typescript
export const getContributionStats = async (req: Request, res: Response) => {
  if (!req.user.isAdmin) {
    throw new AppError(403, 'Admin access required');
  }

  // Get MERL-T stats
  const merltResponse = await axios.get(`${MERLT_API_URL}/api/enrichment/admin/stats`);

  // Get local VisuaLex contribution stats
  const [totalMerltFeedback, userStats, topContributors] = await Promise.all([
    prisma.merltFeedback.count(),
    prisma.user.aggregate({
      _sum: { totalContributions: true },
      _avg: { merltAuthority: true },
    }),
    prisma.user.findMany({
      orderBy: { totalContributions: 'desc' },
      take: 10,
      select: {
        id: true,
        username: true,
        totalContributions: true,
        merltAuthority: true,
      },
    }),
  ]);

  res.json({
    ...merltResponse.data,
    local_stats: {
      total_merl_feedback: totalMerltFeedback,
      total_contributions: userStats._sum.totalContributions || 0,
      average_authority: userStats._avg.merltAuthority || 0.3,
    },
    top_contributors_detailed: topContributors,
  });
};
```

---

### 2.3 Profile & Authority

#### GET /api/merlt/profile/full

**Get full user profile with RLCF authority breakdown**

```typescript
interface FullProfileResponse {
  user_id: string;
  username: string;
  email: string;
  created_at: string;
  is_admin: boolean;
  is_verified: boolean;

  // RLCF Authority
  authority: number;         // 0.0-1.0
  authority_breakdown: {
    baseline: number;        // B_u: Based on qualification
    track_record: number;    // T_u: Total contributions
    level_authority: number; // P_u: Recent activity (30 days)
  };

  // Credentials
  qualification: string;     // "studente" | "avvocato" | "magistrato" | ...
  specializations: string[]; // ["civile", "penale"]
  years_experience: number;

  // Domain-specific authority
  domain_authority: {
    civile: number;
    penale: number;
    amministrativo: number;
    costituzionale: number;
    lavoro: number;
    commerciale: number;
    tributario: number;
    internazionale: number;
  };

  // Contribution stats
  contribution_stats: {
    entities_proposed: number;
    entities_approved: number;
    entities_rejected: number;
    relations_proposed: number;
    relations_approved: number;
    relations_rejected: number;
    votes_cast: number;
    votes_correct: number;
    accuracy_rate: number;  // 0.0-1.0
  };

  // Notification preferences
  notification_preferences: {
    email_on_validation: boolean;
    email_on_authority_change: boolean;
    email_weekly_summary: boolean;
  };
}
```

**Authority Calculation (VisuaLex):**
```typescript
// backend/src/controllers/merltController.ts
const calculateAuthorityBreakdown = (user: any, recentActivityCount: number) => {
  // B_u (Baseline) - based on qualification
  const qualificationMap: Record<string, number> = {
    studente: 0.2,
    laureando: 0.3,
    neolaureato: 0.4,
    praticante: 0.5,
    avvocato: 0.7,
    magistrato: 0.85,
    docente: 0.9,
    giudice_suprema: 1.0,
  };
  const baseline = user.qualification ? qualificationMap[user.qualification] || 0.3 : 0.3;

  // T_u (Track Record) - based on total contributions
  const totalActivity = user.totalContributions + user.totalFeedbackCount;
  const trackRecord = Math.min(totalActivity / 100, 1.0);  // Cap at 1.0

  // P_u (Performance) - based on recent activity (last 30 days)
  const performance = Math.min(recentActivityCount / 20, 1.0);

  // A_u(t) = 0.3*B_u + 0.5*T_u + 0.2*P_u
  const authority = 0.3 * baseline + 0.5 * trackRecord + 0.2 * performance;

  return {
    baseline,
    track_record: trackRecord,
    level_authority: performance,
    total: authority,
  };
};
```

**VisuaLex Handler:**
```typescript
export const getFullProfile = async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  // Get recent activity count (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentActivity = await prisma.merltFeedback.count({
    where: {
      userId: user.id,
      createdAt: { gte: thirtyDaysAgo },
    },
  });

  // Calculate authority breakdown
  const authorityBreakdown = calculateAuthorityBreakdown(user, recentActivity);

  // Update user authority if changed
  if (Math.abs((user.merltAuthority || 0.3) - authorityBreakdown.total) > 0.01) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        merltAuthority: authorityBreakdown.total,
        authorityUpdatedAt: new Date(),
      },
    });
  }

  res.json({
    user_id: user.id,
    authority: authorityBreakdown.total,
    authority_breakdown: {
      baseline: authorityBreakdown.baseline,
      track_record: authorityBreakdown.track_record,
      level_authority: authorityBreakdown.level_authority,
    },
    ...
  });
};
```

---

#### PATCH /api/merlt/profile/qualification

**Update qualification and recalculate authority**

```typescript
interface UpdateQualificationRequest {
  qualification?: string;
  specializations?: string[];
  years_experience?: number;
}
```

**VisuaLex Handler:**
```typescript
export const updateQualification = async (req: Request, res: Response) => {
  const data = updateProfileSchema.parse(req.body);

  // Update user
  const updatedUser = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      qualification: data.qualification,
      specializations: data.specializations,
      yearsExperience: data.years_experience,
    },
  });

  // Recalculate authority (baseline changed)
  const recentActivity = await prisma.merltFeedback.count({
    where: {
      userId: req.user.id,
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });

  const authorityBreakdown = calculateAuthorityBreakdown(updatedUser, recentActivity);

  // Update authority
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      merltAuthority: authorityBreakdown.total,
      authorityUpdatedAt: new Date(),
    },
  });

  res.json({
    authority: authorityBreakdown.total,
    authority_breakdown: { ... },
    ...
  });
};
```

---

### 2.4 Feedback & Auth (Legacy)

#### POST /api/auth/sync

**Sync user credentials to MERL-T**

```typescript
export const updateProfile = async (req: Request, res: Response) => {
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      qualification: data.qualification,
      specializations: data.specializations,
      yearsExperience: data.years_experience,
    },
  });

  // Sync to MERL-T (async, non-blocking)
  syncCredentialsToMerlt(updated).catch((err) => {
    console.error('Failed to sync credentials to MERL-T:', err.message);
  });

  res.json({ ... });
};

async function syncCredentialsToMerlt(user: any) {
  await axios.post(`${MERLT_API_URL}/api/auth/sync`, {
    visualex_user_id: user.id,
    merlt_user_id: user.merltUserId,
    qualification: user.qualification,
    specializations: user.specializations,
    years_experience: user.yearsExperience,
    total_feedback: user.totalFeedbackCount,
    total_contributions: user.totalContributions,
  });
}
```

---

#### GET /api/auth/authority/{user_id}

**Get user authority from MERL-T**

```typescript
export const getAuthority = async (req: Request, res: Response) => {
  try {
    const response = await axios.get(
      `${MERLT_API_URL}/api/auth/authority/${req.user.merltUserId || req.user.id}`
    );

    // Update local cache
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        merltAuthority: response.data.authority,
        authorityUpdatedAt: new Date(),
      },
    });

    res.json({
      authority: response.data.authority,
      breakdown: response.data.breakdown,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    // Return cached value if MERL-T unavailable
    res.json({
      authority: req.user.merltAuthority || 0.3,
      breakdown: null,
      updated_at: req.user.authorityUpdatedAt?.toISOString() || null,
      cached: true,
    });
  }
};
```

---

## 3. Data Flow for Key Features

### 3.1 Expert Q&A Query

```
┌─────────────┐
│ User clicks │
│ QA Button   │
└──────┬──────┘
       │
       │ 1. queryExperts(query)
       ▼
┌──────────────────┐
│ expertService.ts │
│ POST /api/merlt/ │
│   experts/query  │
└──────┬───────────┘
       │
       │ 2. Proxy to MERL-T
       ▼
┌────────────────────┐
│ merltController.ts │
│ - Add user_id      │
│ - Track in local DB│
└──────┬─────────────┘
       │
       │ 3. HTTP POST
       ▼
┌──────────────────────────────┐
│ MERL-T experts_router.py     │
│ - Run orchestrator.process() │
│ - Generate trace_id          │
│ - Save QATrace to PostgreSQL │
└──────┬───────────────────────┘
       │
       │ 4. Return ExpertQueryResponse
       ▼
┌────────────────┐
│ QAPanel.tsx    │
│ - Render       │
│   synthesis    │
│ - Show sources │
│ - Feedback UI  │
└────────────────┘
```

**Database Mutations:**

**VisuaLex PostgreSQL:**
```sql
-- Track Q&A interaction
INSERT INTO merlt_feedbacks (
  user_id,
  type,
  interaction_type,
  trace_id,
  query_text,
  metadata,
  synced_to_merlt,
  created_at
) VALUES (
  'user123',
  'implicit',
  'expert_query',
  'trace_abc123',
  'Cos\'è la legittima difesa?',
  '{"synthesis_mode": "convergent", "experts_used": ["literal", "systemic"]}',
  true,
  NOW()
);
```

**MERL-T PostgreSQL:**
```sql
-- Save QA trace
INSERT INTO qa_traces (
  trace_id,
  user_id,
  query,
  selected_experts,
  synthesis_mode,
  synthesis_text,
  sources,
  execution_time_ms,
  created_at
) VALUES (
  'trace_abc123',
  'user123',
  'Cos\'è la legittima difesa?',
  '["literal", "systemic"]',
  'convergent',
  'La legittima difesa è...',
  '[{"article_urn": "...", "expert": "literal", "relevance": 0.95}]',
  2450,
  NOW()
);
```

**State Updates:**

```typescript
// frontend/src/store/useAppStore.ts
export const addQAToTab = (tabId: string, query: string, response: any) => {
  set((state) => {
    const tab = state.workspaceTabs.find(t => t.id === tabId);
    if (!tab) return;

    const newQA: QABlock = {
      type: 'qa-session',
      id: uuidv4(),
      query,
      response,
      timestamp: new Date().toISOString(),
      isCollapsed: false,
      feedbackGiven: null  // Track feedback state
    };

    tab.content.push(newQA);
    tab.zIndex = ++state.highestZIndex;
  });
  return qaId;
};
```

---

### 3.2 Feedback Submission

```
┌──────────────┐
│ User clicks  │
│ thumbs up 👍 │
└──────┬───────┘
       │
       │ 1. handleFeedbackPositive()
       ▼
┌────────────────────┐
│ QAPanel.tsx        │
│ onSubmitFeedback(  │
│   trace_id, 5      │
│ )                  │
└──────┬─────────────┘
       │
       │ 2. submitInlineFeedback()
       ▼
┌──────────────────┐
│ expertService.ts │
│ POST /api/merlt/ │
│ experts/feedback/│
│ inline           │
└──────┬───────────┘
       │
       │ 3. Proxy to MERL-T
       ▼
┌────────────────────────┐
│ merltController.ts     │
│ - Add user_id,         │
│   user_authority       │
│ - Track in local DB    │
│ - Increment            │
│   totalContributions   │
└──────┬─────────────────┘
       │
       │ 4. HTTP POST
       ▼
┌───────────────────────────────┐
│ MERL-T experts_router.py      │
│ - Verify trace exists         │
│ - Create QAFeedback           │
│ - Save to PostgreSQL          │
└──────┬────────────────────────┘
       │
       │ 5. Return FeedbackResponse
       ▼
┌────────────────────────┐
│ QAPanel.tsx            │
│ - markQAFeedbackGiven()│
│ - Show confirmation    │
│   toast                │
└────────────────────────┘
```

**Database Mutations:**

**VisuaLex PostgreSQL:**
```sql
-- Track feedback submission
INSERT INTO merlt_feedbacks (
  user_id,
  type,
  interaction_type,
  trace_id,
  feedback_data,
  synced_to_merlt,
  created_at
) VALUES (
  'user123',
  'explicit',
  'expert_feedback_inline',
  'trace_abc123',
  '{"inline_rating": 5}',
  true,
  NOW()
);

-- Increment user contributions
UPDATE users
SET
  total_feedback_count = total_feedback_count + 1,
  total_contributions = total_contributions + 1
WHERE id = 'user123';
```

**MERL-T PostgreSQL:**
```sql
-- Save feedback with authority weighting
INSERT INTO qa_feedback (
  trace_id,
  user_id,
  inline_rating,
  user_authority,
  created_at
) VALUES (
  'trace_abc123',
  'user123',
  5,
  0.65,  -- user's RLCF authority
  NOW()
);
```

**State Updates:**

```typescript
// frontend/src/store/useAppStore.ts
export const markQAFeedbackGiven = (
  tabId: string,
  qaId: string,
  feedbackType: 'positive' | 'negative' | 'detailed'
) => {
  set((state) => {
    const tab = state.workspaceTabs.find(t => t.id === tabId);
    if (!tab) return;

    const qaBlock = tab.content.find(
      c => c.type === 'qa-session' && c.id === qaId
    ) as QABlock | undefined;

    if (qaBlock) {
      qaBlock.feedbackGiven = feedbackType;  // Disable feedback buttons
    }
  });
};
```

---

### 3.3 Authority Calculation

```
┌────────────────┐
│ User submits   │
│ feedback/vote  │
└───────┬────────┘
        │
        │ 1. Increment totalContributions
        ▼
┌────────────────────┐
│ VisuaLex           │
│ PostgreSQL         │
│ users table        │
└───────┬────────────┘
        │
        │ 2. Trigger recalculation
        ▼
┌─────────────────────────────┐
│ calculateAuthorityBreakdown │
│ - B_u (Baseline from        │
│   qualification)            │
│ - T_u (Total contributions) │
│ - P_u (Recent 30 days)      │
│ - A_u = 0.3B + 0.5T + 0.2P  │
└───────┬─────────────────────┘
        │
        │ 3. Update user
        ▼
┌────────────────────┐
│ UPDATE users       │
│ SET merlt_authority│
│   = 0.68,          │
│ authority_updated  │
│   _at = NOW()      │
│ WHERE id = 'u123'  │
└────────────────────┘
```

**Authority Formula:**

```
A_u(t) = 0.3 * B_u + 0.5 * T_u + 0.2 * P_u

Where:
- B_u = Baseline authority from qualification
  - studente: 0.2
  - avvocato: 0.7
  - magistrato: 0.85
  - docente: 0.9
  - giudice_suprema: 1.0

- T_u = Track record (total contributions / 100, capped at 1.0)

- P_u = Performance (recent 30-day activity / 20, capped at 1.0)
```

**Example Calculation:**

```
User: Giovanni (avvocato)
- Qualification: avvocato → B_u = 0.7
- Total contributions: 45 → T_u = 45/100 = 0.45
- Recent activity (30 days): 12 → P_u = 12/20 = 0.6

A_u = 0.3*0.7 + 0.5*0.45 + 0.2*0.6
    = 0.21 + 0.225 + 0.12
    = 0.555

Rounded: 0.56
```

**Database Updates:**

**After entity validation vote:**
```sql
-- Increment contributions
UPDATE users
SET
  total_contributions = total_contributions + 1,
  total_feedback_count = total_feedback_count + 1
WHERE id = 'user123';

-- Recalculate authority
WITH activity AS (
  SELECT COUNT(*) AS recent_count
  FROM merlt_feedbacks
  WHERE user_id = 'user123'
    AND created_at >= NOW() - INTERVAL '30 days'
)
UPDATE users
SET
  merlt_authority = 0.3 * 0.7 + 0.5 * (46/100.0) + 0.2 * ((SELECT recent_count FROM activity)/20.0),
  authority_updated_at = NOW()
WHERE id = 'user123';
```

---

### 3.4 Live Enrichment

```
┌───────────────┐
│ User clicks   │
│ "Arricchisci" │
│ button        │
└───────┬───────┘
        │
        │ 1. liveEnrich(tipo_atto, articolo)
        ▼
┌──────────────────────┐
│ VisuaLex Frontend    │
│ enrichmentService.ts │
└───────┬──────────────┘
        │
        │ 2. POST /api/merlt/enrichment/live
        ▼
┌────────────────────────┐
│ merltController.ts     │
│ - Add user_id,         │
│   user_authority       │
└───────┬────────────────┘
        │
        │ 3. HTTP POST
        ▼
┌──────────────────────────────────┐
│ MERL-T enrichment_router.py      │
│ - LiveEnrichmentService          │
│   .enrich()                      │
│ - Scrape Normattiva              │
│ - Fetch Brocardi                 │
│ - Extract entities with LLM      │
│ - Save pending to in-memory      │
└───────┬──────────────────────────┘
        │
        │ 4. Return LiveEnrichmentResponse
        ▼
┌────────────────────────┐
│ VisuaLex UI            │
│ - Show pending_entities│
│ - Show pending_        │
│   relations            │
│ - Render validation UI │
└────────────────────────┘
```

**In-Memory Storage (MERL-T):**

```python
# merlt/api/enrichment_router.py
_pending_entities: Dict[str, PendingEntityData] = {}
_pending_relations: Dict[str, PendingRelationData] = {}
_entity_votes: Dict[str, List[EntityValidationFeedback]] = {}
_relation_votes: Dict[str, List[RelationValidationFeedback]] = {}

# After live enrichment
for entity in response.pending_entities:
    _pending_entities[entity.id] = entity
    _entity_votes[entity.id] = []

for relation in response.pending_relations:
    _pending_relations[relation.id] = relation
    _relation_votes[relation.id] = []
```

**Response Example:**

```json
{
  "success": true,
  "article_urn": "urn:nir:stato:codice.penale:1930;art52",
  "pending_entities": [
    {
      "id": "entity_abc123",
      "nome": "Legittima difesa",
      "tipo": "principio",
      "descrizione": "Diritto di difendere se stessi o altri...",
      "articoli_correlati": ["art52", "art53"],
      "ambito": "penale",
      "fonte": "brocardi",
      "llm_confidence": 0.92,
      "validation_status": "pending",
      "approval_score": 0.0,
      "rejection_score": 0.0,
      "votes_count": 0,
      "contributed_by": "system",
      "contributor_authority": 1.0
    }
  ],
  "pending_relations": [
    {
      "id": "relation_xyz789",
      "source_urn": "urn:...:art52",
      "target_urn": "urn:...:art53",
      "relation_type": "relates_to",
      "fonte": "llm_extraction",
      "llm_confidence": 0.85,
      "evidence": "Art 53 specifica i casi di eccesso...",
      "validation_status": "pending",
      "approval_score": 0.0,
      "rejection_score": 0.0,
      "votes_count": 0
    }
  ],
  "execution_time_ms": 4820,
  "message": "Enrichment completato. 1 entità e 1 relazione in attesa di validazione."
}
```

---

## 4. Authentication & User Sync

### 4.1 User ID Mapping

**VisuaLex → MERL-T User ID Sync:**

```typescript
// VisuaLex PostgreSQL schema
model User {
  id          String    @id @default(uuid())  // Primary VisuaLex user ID
  email       String    @unique
  username    String    @unique

  // MERL-T Integration
  merltUserId        String?   @unique  // Linked MERL-T user ID
  merltAuthority     Float?    @default(0.3)
  authorityUpdatedAt DateTime?
}
```

**User Creation Flow:**

```
┌──────────────┐
│ User signs   │
│ up on        │
│ VisuaLex     │
└──────┬───────┘
       │
       │ 1. Create user in VisuaLex PostgreSQL
       ▼
┌────────────────────┐
│ VisuaLex user      │
│ id: "uuid-abc123"  │
│ merltUserId: null  │
│ merltAuthority: 0.3│
└────────────────────┘
       │
       │ 2. First interaction with MERL-T
       │    (e.g., Q&A query, enrichment)
       ▼
┌────────────────────┐
│ MERL-T receives    │
│ user_id in request │
│ → Creates user     │
│   if not exists    │
└────────────────────┘
```

**No explicit user creation endpoint** - Users are created lazily on first interaction.

**User ID passed in every request:**

```typescript
// Example: Expert query
const response = await axios.post(`${MERLT_API_URL}/api/experts/query`, {
  query: data.query,
  user_id: req.user.merltUserId || req.user.id,  // Use merltUserId if exists, fallback to VisuaLex ID
});

// Example: Entity validation
const response = await axios.post(`${MERLT_API_URL}/api/enrichment/validate-entity`, {
  entity_id: data.entity_id,
  vote: data.vote,
  user_id: req.user.merltUserId || req.user.id,
  user_authority: req.user.merltAuthority || 0.3,
});
```

---

### 4.2 Authority Sync

**VisuaLex calculates authority** (not MERL-T).

**Authority stored in VisuaLex PostgreSQL:**
```sql
-- users table
merlt_authority DOUBLE PRECISION DEFAULT 0.3
authority_updated_at TIMESTAMP
```

**Authority passed with every MERL-T request:**
```typescript
// Example: Validation vote
{
  entity_id: "entity_abc123",
  vote: "approve",
  user_id: "user123",
  user_authority: 0.68  // ← Calculated by VisuaLex
}
```

**MERL-T uses authority for weighting:**
```python
# merlt/rlcf/entity_feedback.py
class EntityValidationFeedback:
    def __post_init__(self):
        vote_map = {"approve": 1.0, "reject": -1.0, "edit": 0.5}
        self.weighted_vote = self.user_authority * vote_map[self.vote]
        # Example: 0.68 * 1.0 = 0.68 (weighted approve vote)
```

---

### 4.3 Token Flow

**No token exchange** between VisuaLex ↔ MERL-T.

**VisuaLex handles authentication:**
```typescript
// VisuaLex Express backend
// backend/src/middleware/auth.ts
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    throw new AppError(401, 'No token provided');
  }

  const decoded = jwt.verify(token, JWT_SECRET);
  req.user = await prisma.user.findUnique({ where: { id: decoded.userId } });

  next();
};

// All /api/merlt/* routes require authentication
router.use(authenticate);
```

**MERL-T trusts VisuaLex-provided user_id:**
```python
# merlt/api/experts_router.py
class ExpertQueryRequest(BaseModel):
    query: str
    user_id: str  # ← Trusted from VisuaLex (already authenticated)
```

**Security consideration:**
- MERL-T API should NOT be publicly exposed
- Only VisuaLex backend should have access to MERL-T
- Network isolation via Docker Compose networking or VPN

---

## 5. Database Integration

### 5.1 VisuaLex PostgreSQL Tables

```prisma
// backend/prisma/schema.prisma

model User {
  id          String    @id @default(uuid())
  email       String    @unique
  username    String    @unique

  // MERL-T Integration
  merltUserId        String?   @unique
  qualification      String?   // "studente", "avvocato", "magistrato"
  specializations    String[]  // ["civile", "penale"]
  yearsExperience    Int?
  merltAuthority     Float?    @default(0.3)
  authorityUpdatedAt DateTime?

  // MERL-T Tracking
  totalFeedbackCount  Int @default(0)
  totalContributions  Int @default(0)

  // Relationships
  merltFeedbacks MerltFeedback[]
}

enum MerltFeedbackType {
  implicit   // Automatic tracking (bookmark, highlight, click)
  explicit   // Explicit feedback (thumbs, stars, form)
}

model MerltFeedback {
  id        String            @id @default(uuid())
  userId    String
  type      MerltFeedbackType
  traceId   String?           // MERL-T execution trace ID

  // Interaction context
  interactionType String        // "expert_query", "expert_feedback_inline", "bookmark_add", etc.
  articleUrn      String?
  queryText       String?

  // Feedback data (JSON for flexibility)
  feedbackData Json?           // {"inline_rating": 5} or {"retrieval_score": 0.8, ...}

  // Metadata
  sessionId  String?
  metadata   Json?             // Additional context

  // Sync status
  syncedToMerlt Boolean        @default(false)
  syncedAt      DateTime?

  createdAt DateTime           @default(now())

  // Relationships
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([type])
  @@index([interactionType])
  @@index([traceId])
  @@index([syncedToMerlt])
  @@index([createdAt])
}
```

**Key Points:**
- **User.merltUserId**: Links to MERL-T user (if different from VisuaLex ID)
- **User.merltAuthority**: Cached authority score (recalculated locally)
- **User.totalContributions**: Used in authority formula (T_u component)
- **MerltFeedback**: Tracks ALL interactions (Q&A queries, feedback, validations)
- **MerltFeedback.syncedToMerlt**: Ensures resilience if MERL-T is offline

---

### 5.2 MERL-T PostgreSQL Tables

```python
# merlt/rlcf/database.py → PostgreSQL (port 5433)

class QATrace(Base):
    """
    Stores Expert Q&A query executions.
    """
    __tablename__ = "qa_traces"

    id = Column(Integer, primary_key=True)
    trace_id = Column(String, unique=True, nullable=False)  # "trace_abc123"
    user_id = Column(String, nullable=False)

    # Query
    query = Column(Text, nullable=False)

    # Execution
    selected_experts = Column(JSON)  # ["literal", "systemic"]
    synthesis_mode = Column(String)  # "convergent" | "divergent"
    synthesis_text = Column(Text)

    # Sources
    sources = Column(JSON)  # [{"article_urn": "...", "expert": "...", "relevance": 0.95}]

    # Metadata
    execution_time_ms = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    feedbacks = relationship("QAFeedback", back_populates="trace")


class QAFeedback(Base):
    """
    Stores multi-level feedback for Q&A queries.
    """
    __tablename__ = "qa_feedback"

    id = Column(Integer, primary_key=True)
    trace_id = Column(String, ForeignKey("qa_traces.trace_id"))
    user_id = Column(String)

    # Inline feedback (thumbs up/down)
    inline_rating = Column(Integer)  # 1-5

    # Detailed 3D feedback
    retrieval_score = Column(Float)   # 0-1
    reasoning_score = Column(Float)   # 0-1
    synthesis_score = Column(Float)   # 0-1
    detailed_comment = Column(Text)

    # Per-source feedback
    source_id = Column(String)        # article URN
    source_relevance = Column(Integer)  # 1-5 stars

    # Conversational refinement
    follow_up_query = Column(Text)
    refined_trace_id = Column(String)  # Links to new trace

    # Authority weighting
    user_authority = Column(Float)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    trace = relationship("QATrace", back_populates="feedbacks")
```

**Key Points:**
- **qa_traces**: Stores every Q&A query execution with full response
- **qa_feedback**: Stores feedback in normalized form (inline, detailed, source, refine)
- **user_authority**: Stored for RLCF weighting and analysis
- **refined_trace_id**: Links follow-up queries to original (conversation threading)

---

### 5.3 Data Ownership

| Data Type | Owner | Sync Direction | Purpose |
|-----------|-------|----------------|---------|
| **User credentials** | VisuaLex | VisuaLex → MERL-T | User authentication, profile |
| **Authority score** | VisuaLex | Calculated locally | Vote weighting, UI display |
| **Feedback tracking** | VisuaLex | VisuaLex → MERL-T | Resilience, analytics |
| **Q&A traces** | MERL-T | - | Expert execution logs |
| **Q&A feedback** | MERL-T | - | RLCF training data |
| **Pending entities** | MERL-T | In-memory (temp) | Validation queue |
| **Knowledge graph** | MERL-T | - | FalkorDB nodes/relations |
| **Embeddings** | MERL-T | - | Qdrant vectors |

---

### 5.4 Sync Mechanisms

**Optimistic Updates (VisuaLex):**

```typescript
// backend/src/controllers/merltController.ts

// 1. Update local DB immediately
await prisma.merltFeedback.create({
  data: {
    userId: req.user.id,
    type: 'explicit',
    interactionType: 'expert_feedback_inline',
    traceId: data.trace_id,
    feedbackData: { inline_rating: data.rating },
    syncedToMerlt: false,  // ← Mark as not synced yet
  },
});

// 2. Try to sync to MERL-T
try {
  await axios.post(`${MERLT_API_URL}/api/experts/feedback/inline`, {
    trace_id: data.trace_id,
    rating: data.rating,
    user_id: req.user.id,
    user_authority: req.user.merltAuthority,
  });

  // 3. Mark as synced
  await prisma.merltFeedback.update({
    where: { id: feedback.id },
    data: { syncedToMerlt: true, syncedAt: new Date() },
  });
} catch (error) {
  // 4. If MERL-T is down, feedback is still saved locally
  console.error('Failed to sync to MERL-T:', error);
  // Will retry later via batch sync
}
```

**Batch Sync Endpoint:**

```typescript
// POST /api/merlt/sync - Retry pending feedbacks
export const syncPending = async (req: Request, res: Response) => {
  const pending = await prisma.merltFeedback.findMany({
    where: {
      userId: req.user.id,
      syncedToMerlt: false,
    },
    take: 100,
    orderBy: { createdAt: 'asc' },
  });

  let synced = 0;
  let failed = 0;

  for (const feedback of pending) {
    try {
      if (feedback.type === 'explicit') {
        await axios.post(`${MERLT_API_URL}/api/experts/feedback/inline`, {
          trace_id: feedback.traceId,
          rating: feedback.feedbackData.inline_rating,
          user_id: req.user.id,
          user_authority: req.user.merltAuthority,
        });
      } else {
        // Handle implicit feedback
        await axios.post(`${MERLT_API_URL}/api/track`, {
          user_id: req.user.id,
          interaction_type: feedback.interactionType,
          article_urn: feedback.articleUrn,
          metadata: feedback.metadata,
          timestamp: feedback.createdAt.toISOString(),
        });
      }

      await prisma.merltFeedback.update({
        where: { id: feedback.id },
        data: { syncedToMerlt: true, syncedAt: new Date() },
      });

      synced++;
    } catch (error) {
      failed++;
    }
  }

  res.json({
    total_pending: pending.length,
    synced,
    failed,
  });
};
```

---

## 6. Environment Variables

### 6.1 VisuaLex Backend (.env)

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/visualex"

# JWT
JWT_SECRET="your-secret-key-here"

# MERL-T Integration
MERLT_API_URL="http://localhost:8000"  # MERL-T FastAPI URL

# CORS (if needed)
CORS_ORIGINS="http://localhost:5173,http://localhost:5174"
```

---

### 6.2 MERL-T (.env)

```bash
# OpenRouter (for LLM experts)
OPENROUTER_API_KEY="sk-or-v1-your-key-here"

# PostgreSQL (RLCF database)
RLCF_POSTGRES_URL="postgresql+asyncpg://postgres:postgres@localhost:5433/merl_t_rlcf"
RLCF_ASYNC_DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5433/merl_t_rlcf"

# FalkorDB (Knowledge Graph)
FALKORDB_HOST="localhost"
FALKORDB_PORT="6380"
FALKORDB_PASSWORD=""
FALKORDB_GRAPH_NAME="merl_t_dev"

# Qdrant (Vector Store)
QDRANT_URL="http://localhost:6333"
QDRANT_COLLECTION_NAME="merl_t_dev_chunks"

# Redis (Cache)
REDIS_URL="redis://localhost:6379/0"
```

---

### 6.3 Docker Compose (MERL-T)

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  falkordb:
    image: falkordb/falkordb:latest
    container_name: merl_t_falkordb_dev
    ports:
      - "6380:6379"
    volumes:
      - falkordb_dev_data:/data
    environment:
      - REDIS_ARGS=--save 60 1

  qdrant:
    image: qdrant/qdrant:latest
    container_name: merl_t_qdrant_dev
    ports:
      - "6333:6333"
    volumes:
      - qdrant_dev_data:/qdrant/storage

  postgres:
    image: postgres:15-alpine
    container_name: merl_t_postgres_dev
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: merl_t_rlcf
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: merl_t_redis_dev
    ports:
      - "6379:6379"
    volumes:
      - redis_dev_data:/data

volumes:
  falkordb_dev_data:
  qdrant_dev_data:
  postgres_dev_data:
  redis_dev_data:
```

**Start services:**
```bash
cd /Users/gpuzio/Desktop/CODE/MERL-T_alpha
docker-compose -f docker-compose.dev.yml up -d
```

---

## 7. Known Issues & Limitations

### 7.1 Performance Bottlenecks

**Issue:** Expert query can take 2-5 seconds (multiple LLM calls).

**Mitigation:**
- Parallel expert execution (`OrchestratorConfig.parallel_execution=True`)
- Streaming synthesis (not yet implemented)
- Client-side loading states

**TODO:**
- Add caching for common queries
- Implement streaming responses for real-time feedback

---

### 7.2 In-Memory Storage for Pending Entities

**Issue:** `_pending_entities` and `_pending_relations` are in-memory dicts.

**Impact:**
- Lost on server restart
- Not shared across multiple MERL-T instances (scaling issue)

**Mitigation (Production):**
- Move to Redis for persistence and shared state
- Or PostgreSQL with `validation_queue` table

**TODO:**
```python
# Replace in-memory storage with Redis
import redis
from typing import Dict

redis_client = redis.Redis(host='localhost', port=6379, decode_responses=False)

# Store pending entity
def save_pending_entity(entity: PendingEntityData):
    key = f"pending:entity:{entity.id}"
    redis_client.set(key, entity.json(), ex=86400)  # 24h TTL

# Retrieve pending entity
def get_pending_entity(entity_id: str) -> Optional[PendingEntityData]:
    key = f"pending:entity:{entity_id}"
    data = redis_client.get(key)
    if data:
        return PendingEntityData.parse_raw(data)
    return None
```

---

### 7.3 Race Conditions in Authority Calculation

**Issue:** Authority recalculation can race if multiple requests update `totalContributions` simultaneously.

**Example:**
```
Request 1: Read totalContributions=45 → Calculate authority → Update to 46
Request 2: Read totalContributions=45 → Calculate authority → Update to 46
Result: Lost update (should be 47)
```

**Mitigation:**
- Use atomic increments: `totalContributions: { increment: 1 }`
- Recalculate authority periodically (batch job) instead of on every request

**TODO:**
```typescript
// Safer implementation
await prisma.$transaction(async (tx) => {
  // Increment contributions atomically
  await tx.user.update({
    where: { id: req.user.id },
    data: { totalContributions: { increment: 1 } },
  });

  // Fetch updated user
  const updated = await tx.user.findUnique({ where: { id: req.user.id } });

  // Recalculate authority
  const authority = calculateAuthorityBreakdown(updated, recentActivity);

  // Update authority
  await tx.user.update({
    where: { id: req.user.id },
    data: { merltAuthority: authority.total },
  });
});
```

---

### 7.4 No Error Recovery for Failed Syncs

**Issue:** If MERL-T is down during feedback submission, feedback is saved locally but there's no automatic retry.

**Mitigation:**
- Manual retry via `POST /api/merlt/sync`
- User can see "pending sync" status in UI

**TODO:**
- Implement background job (cron) to retry pending feedbacks every hour
- Add Webhook/WebSocket notification when MERL-T comes back online

---

### 7.5 Source Citation Incomplete

**Issue:** `ExpertQueryResponse.sources` doesn't include actual article text excerpts.

**Impact:**
- Users can't preview source content without clicking through

**TODO:**
```python
# merlt/api/experts_router.py
for legal_source in result.combined_legal_basis:
    sources.append(SourceReference(
        article_urn=legal_source.source_id,
        expert="combined",
        relevance=0.9,
        excerpt=legal_source.excerpt[:200] if legal_source.excerpt else None  # ← Add excerpt
    ))
```

---

### 7.6 No Domain-Specific Authority

**Issue:** Authority is global, not domain-specific.

**Impact:**
- A penalista's vote on a civil law entity has same weight as a civilista

**TODO:**
```typescript
// VisuaLex: Calculate domain-specific authority
interface DomainAuthority {
  civile: number;
  penale: number;
  amministrativo: number;
  // ... other domains
}

// MERL-T: Weight votes by domain
class EntityValidationFeedback:
    def __post_init__(self):
        # Use domain-specific authority if available
        domain = self.entity_type.domain  # e.g., "penale"
        authority = self.user_domain_authority.get(domain, self.user_authority)
        self.weighted_vote = authority * vote_map[self.vote]
```

---

### 7.7 No Conversational Context in Follow-up Queries

**Issue:** `POST /api/experts/feedback/refine` doesn't preserve context from original query.

**Impact:**
- Follow-up query starts from scratch, doesn't leverage previous expert responses

**TODO:**
```python
# merlt/api/experts_router.py
@router.post("/feedback/refine")
async def submit_refine_feedback(...):
    # Fetch original trace
    original_trace = await session.execute(
        select(QATrace).where(QATrace.trace_id == request.trace_id)
    )

    # Re-run orchestrator with context from original query
    result = await orchestrator.process(
        query=request.follow_up_query,
        entities=original_trace.entities,  # ← Pass entities from original
        retrieved_chunks=original_trace.chunks,  # ← Pass chunks
        metadata={
            "user_id": request.user_id,
            "refine_from": request.trace_id,
            "original_query": original_trace.query,
            "previous_synthesis": original_trace.synthesis_text,  # ← Pass previous answer
        }
    )
```

---

## 8. Future Improvements

### 8.1 Real-Time Updates (WebSockets)

**Goal:** Push updates to VisuaLex when validation status changes.

**Implementation:**
```python
# MERL-T: Broadcast validation result
from fastapi import WebSocket

@router.websocket("/ws/validation")
async def validation_websocket(websocket: WebSocket):
    await websocket.accept()

    # Subscribe to validation events
    while True:
        # Wait for validation event
        event = await validation_event_queue.get()

        # Push to client
        await websocket.send_json({
            "type": "validation_result",
            "entity_id": event.entity_id,
            "new_status": event.status,
            "approval_score": event.approval_score,
        })
```

```typescript
// VisuaLex: Connect to WebSocket
const ws = new WebSocket('ws://localhost:8000/api/enrichment/ws/validation');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'validation_result') {
    // Update UI with new status
    updateEntityStatus(data.entity_id, data.new_status);

    // Show toast notification
    toast.success(`Entity "${data.entity_id}" ${data.new_status}!`);
  }
};
```

---

### 8.2 GraphQL API

**Goal:** Replace REST with GraphQL for more flexible queries.

**Example:**
```graphql
# Query with nested data
query GetExpertResponseWithFeedback($traceId: String!) {
  qaTrace(traceId: $traceId) {
    id
    query
    synthesis
    mode
    sources {
      articleUrn
      expert
      relevance
      excerpt
    }
    feedbacks {
      userId
      inlineRating
      retrievalScore
      reasoningScore
      synthesisScore
      createdAt
    }
  }
}
```

---

### 8.3 Batch Expert Queries

**Goal:** Allow users to submit multiple queries in one request.

**Use Case:** User wants to ask 5 related questions and see them all answered.

```typescript
interface BatchQueryRequest {
  queries: Array<{
    id: string;
    query: string;
  }>;
  user_id: string;
}

interface BatchQueryResponse {
  results: Array<{
    query_id: string;
    response: ExpertQueryResponse;
  }>;
  total_execution_time_ms: number;
}
```

---

### 8.4 Query Templates

**Goal:** Pre-defined query templates for common legal questions.

**Example:**
```typescript
const templates = [
  {
    id: 'difesa_legittima',
    label: 'Cos\'è la legittima difesa?',
    query: 'Spiega il concetto di legittima difesa nel diritto penale italiano, includendo i requisiti e i limiti.',
    category: 'penale',
  },
  {
    id: 'contratto_vendita',
    label: 'Quali sono gli elementi del contratto di vendita?',
    query: 'Quali sono gli elementi essenziali del contratto di vendita secondo il codice civile italiano?',
    category: 'civile',
  },
];
```

---

### 8.5 Authority Decay

**Goal:** Reduce authority over time if user becomes inactive.

**Formula:**
```
A_u(t) = 0.3 * B_u + 0.5 * T_u + 0.2 * P_u * D_u

Where D_u = Decay factor based on inactivity
- Last activity < 7 days: D_u = 1.0
- Last activity < 30 days: D_u = 0.9
- Last activity < 90 days: D_u = 0.7
- Last activity > 90 days: D_u = 0.5
```

---

## 9. Quick Reference

### 9.1 Endpoint Mapping

| Frontend Component | Backend Controller | MERL-T Router | Database |
|--------------------|--------------------|---------------|----------|
| `FloatingQAButton` → `queryExperts()` → `/api/merlt/experts/query` → `merltController.queryExperts()` → `POST /api/experts/query` → `experts_router.query_experts()` → `qa_traces` |
| `QAPanel` feedback → `submitInlineFeedback()` → `/api/merlt/experts/feedback/inline` → `merltController.submitInlineFeedback()` → `POST /api/experts/feedback/inline` → `experts_router.submit_inline_feedback()` → `qa_feedback` |
| Live Enrich UI → `liveEnrich()` → `/api/merlt/enrichment/live` → `merltController.liveEnrich()` → `POST /api/enrichment/live` → `enrichment_router.live_enrich()` → In-memory |
| Validation UI → `validateEntity()` → `/api/merlt/enrichment/validate-entity` → `merltController.validateEntity()` → `POST /api/enrichment/validate-entity` → `enrichment_router.validate_entity()` → In-memory |
| Profile Page → `getFullProfile()` → `/api/merlt/profile/full` → `merltController.getFullProfile()` → LOCAL (calculated in VisuaLex) | - |

---

### 9.2 Data Flow Summary

```
User Action → Frontend Component → expertService.ts → VisuaLex Backend → MERL-T API → Database
                                                          ↓
                                                    Update User Stats
                                                    Recalculate Authority
                                                    Track in merlt_feedbacks
```

---

### 9.3 File Locations

**VisuaLex:**
```
backend/
├── src/
│   ├── controllers/
│   │   └── merltController.ts         ← Main MERL-T proxy controller
│   ├── routes/
│   │   └── merlt.ts                   ← MERL-T routes definition
│   ├── services/
│   │   └── merltService.ts            ← (Not used - logic in controller)
│   └── middleware/
│       └── auth.ts                    ← Authentication middleware
├── prisma/
│   └── schema.prisma                  ← User, MerltFeedback models
│
frontend/
├── src/
│   ├── services/
│   │   └── expertService.ts           ← Expert Q&A API client
│   ├── components/features/qa/
│   │   ├── FloatingQAButton.tsx       ← Q&A trigger button
│   │   ├── QAPanel.tsx                ← Q&A result display
│   │   └── FeedbackToast.tsx          ← Feedback UI
│   ├── store/
│   │   └── useAppStore.ts             ← Global state (QABlock, WorkspaceTab)
│   └── types/
│       └── expert.ts                  ← TypeScript types for Expert API
```

**MERL-T:**
```
merlt/
├── api/
│   ├── __init__.py                    ← Router exports
│   ├── visualex_bridge.py             ← Main FastAPI app
│   ├── experts_router.py              ← Expert Q&A endpoints
│   ├── enrichment_router.py           ← Live enrichment endpoints
│   ├── profile_router.py              ← Profile & authority endpoints
│   ├── feedback_router.py             ← Legacy feedback endpoints
│   └── auth_router.py                 ← Auth sync endpoints
├── experts/
│   ├── orchestrator.py                ← MultiExpertOrchestrator
│   ├── synthesizer.py                 ← AdaptiveSynthesizer
│   ├── literal.py                     ← LiteralExpert
│   ├── systemic.py                    ← SystemicExpert
│   ├── principles.py                  ← PrinciplesExpert
│   └── precedent.py                   ← PrecedentExpert
├── rlcf/
│   ├── database.py                    ← QATrace, QAFeedback models
│   └── entity_feedback.py             ← EntityValidationFeedback, aggregation
└── pipeline/
    └── live_enrichment.py             ← LiveEnrichmentService
```

---

## 10. Conclusion

This document provides a complete reference for the MERL-T ↔ VisuaLex integration.

**Key Integration Points:**
1. **Expert Q&A System** - Multi-expert consultation with RLCF feedback
2. **Live Enrichment** - Crowd-sourced knowledge graph validation
3. **Authority System** - RLCF-weighted user contributions
4. **Profile Management** - User credentials and domain expertise

**Next Steps:**
- [ ] Migrate in-memory pending storage to Redis/PostgreSQL
- [ ] Implement WebSocket for real-time validation updates
- [ ] Add domain-specific authority calculations
- [ ] Implement conversational context in follow-up queries
- [ ] Add caching layer for common expert queries
- [ ] Implement authority decay for inactive users

**For Questions:**
- Expert System: `merlt/experts/` + `merlt/api/experts_router.py`
- Enrichment: `merlt/api/enrichment_router.py` + `merlt/pipeline/live_enrichment.py`
- Authority: `backend/src/controllers/merltController.ts` (VisuaLex calculates)
- Database Schema: `backend/prisma/schema.prisma` + `merlt/rlcf/database.py`

---

**Last Updated:** 4 Gennaio 2026
**Version:** 1.0
**Contributors:** Orchestrator Multi-Agente MERL-T
