# MERL-T ↔ VisuaLex: Task Mapping

> **Data**: 31 Dicembre 2025
> **Scopo**: Mappatura accurata delle task MERL-T e connessioni con VisuaLex

---

## OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ARCHITETTURA INTEGRATA                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  VisuaLex Frontend (React)          VisuaLex Backend (Express)         │
│  ═══════════════════════           ════════════════════════           │
│  ┌─────────────────────┐           ┌─────────────────────┐             │
│  │  SearchPanel        │───────────│  /api/search        │             │
│  │  ArticleTabContent  │───────────│  /api/merlt/*       │─────────┐   │
│  │  ContributePage     │           │  /api/auth          │         │   │
│  │  StudyMode          │           │  /api/feedback      │         │   │
│  │  MerltFeedbackPopup │           └─────────────────────┘         │   │
│  └─────────────────────┘                                           │   │
│           │                                                        │   │
│           │  Tracking                                              │   │
│           ▼                                                        ▼   │
│  ┌─────────────────────┐                              ┌──────────────┐ │
│  │  merltService.ts    │                              │  MERL-T API  │ │
│  │  ─────────────────  │                              │  (FastAPI)   │ │
│  │  trackInteraction() │◄─────────────────────────────│  /api/*      │ │
│  │  checkArticleInGraph│                              └──────────────┘ │
│  │  requestLiveEnrich  │                                      │        │
│  │  validateEntity     │                                      ▼        │
│  └─────────────────────┘                              ┌──────────────┐ │
│                                                       │  MERL-T Core │ │
│                                                       │  ────────────│ │
│                                                       │  LKG         │ │
│                                                       │  Experts     │ │
│                                                       │  RLCF        │ │
│                                                       │  Storage     │ │
│                                                       └──────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## SEZIONE 1: TASK MERL-T CORE

### 1.1 Expert System Tasks

| Task ID | Task MERL-T | Modulo | Stato | VisuaLex Feature Collegata |
|---------|-------------|--------|-------|---------------------------|
| EXP-001 | LiteralExpert interpretation | `experts/literal.py` | ✅ Completo | Doctrine Display in StudyMode |
| EXP-002 | SystemicExpert interpretation | `experts/systemic.py` | ✅ Completo | Cross-reference analysis |
| EXP-003 | PrinciplesExpert interpretation | `experts/principles.py` | ✅ Completo | Legislative intent display |
| EXP-004 | PrecedentExpert interpretation | `experts/precedent.py` | ✅ Completo | Case law citations |
| EXP-005 | MultiExpertOrchestrator | `experts/orchestrator.py` | ✅ Completo | Multi-expert synthesis panel |
| EXP-006 | ExpertRouter (regex) | `experts/router.py` | ✅ Completo | Query classification |
| EXP-007 | HybridExpertRouter (neural) | `experts/neural_gating/` | ✅ Completo | Adaptive routing |
| EXP-008 | AdaptiveSynthesizer | `experts/synthesizer.py` | ✅ Completo | Disagreement mode UI |
| EXP-009 | GatingNetwork | `experts/gating.py` | ✅ Completo | Expert weight visualization |
| EXP-010 | ReAct pattern integration | `experts/base.py` | ✅ Completo | Step-by-step reasoning display |

**Collegamento VisuaLex**:
- `BrocardiDisplay.tsx` → Può mostrare sintesi multi-expert
- `StudyModeBrocardiPanel.tsx` → Expert tabs per interpretazione
- Future: `ExpertSynthesisPanel.tsx` per visualizzazione interattiva

---

### 1.2 RLCF Framework Tasks

| Task ID | Task MERL-T | Modulo | Stato | VisuaLex Feature Collegata |
|---------|-------------|--------|-------|---------------------------|
| RLCF-001 | GatingPolicy training | `rlcf/policy_gradient.py` | ✅ Completo | Feedback popup signals |
| RLCF-002 | TraversalPolicy training | `rlcf/policy_gradient.py` | ✅ Completo | Graph navigation patterns |
| RLCF-003 | PolicyGradientTrainer | `rlcf/policy_gradient.py` | ✅ Completo | - |
| RLCF-004 | SingleStepTrainer | `rlcf/single_step_trainer.py` | ✅ Completo | - |
| RLCF-005 | ExternalFeedbackAdapter | `rlcf/external_feedback.py` | ✅ Completo | `MerltFeedbackPopup.tsx` |
| RLCF-006 | VisualexInteraction model | `rlcf/external_feedback.py` | ✅ Completo | `trackInteraction()` |
| RLCF-007 | FeedbackAccumulator | `rlcf/external_feedback.py` | ✅ Completo | Batch interactions |
| RLCF-008 | AuthoritySyncService | `rlcf/external_feedback.py` | ✅ Completo | `getAuthority()` API |
| RLCF-009 | BiasDetector | `rlcf/bias_detection.py` | ✅ Completo | Future: bias warnings |
| RLCF-010 | CurriculumScheduler | `rlcf/curriculum_learning.py` | ✅ Completo | - |
| RLCF-011 | RLCFPersistence | `rlcf/persistence.py` | ✅ Completo | - |

**Collegamento VisuaLex**:
- `MerltFeedbackPopup.tsx` → Invia feedback a RLCF
- `useFeedbackTrigger.ts` → Trigger intelligenti
- `trackInteraction()` → 13+ tipi di interazione tracciati

---

### 1.3 Storage & Retrieval Tasks

| Task ID | Task MERL-T | Modulo | Stato | VisuaLex Feature Collegata |
|---------|-------------|--------|-------|---------------------------|
| STR-001 | FalkorDBClient | `storage/graph/client.py` | ✅ Completo | Graph checks |
| STR-002 | EmbeddingService | `storage/vectors/embeddings.py` | ✅ Completo | Semantic search |
| STR-003 | GraphAwareRetriever | `storage/retriever/` | ✅ Completo | Search results |
| STR-004 | BridgeTable | `storage/bridge/` | ✅ Completo | Chunk ↔ node mapping |
| STR-005 | Validation storage | `storage/graph/validation.py` | ✅ Completo | Entity/relation validation |

**Collegamento VisuaLex**:
- `SearchPanel.tsx` → Usa retriever per risultati
- `checkArticleInGraph()` → Verifica esistenza nel grafo

---

### 1.4 Pipeline Tasks

| Task ID | Task MERL-T | Modulo | Stato | VisuaLex Feature Collegata |
|---------|-------------|--------|-------|---------------------------|
| PIP-001 | IngestionPipelineV2 | `pipeline/ingestion.py` | ✅ Completo | Live enrichment |
| PIP-002 | CommaParser | `pipeline/parsing.py` | ✅ Completo | Article structure display |
| PIP-003 | StructuralChunker | `pipeline/chunking.py` | ✅ Completo | - |
| PIP-004 | MultivigenzaPipeline | `pipeline/multivigenza.py` | ✅ Completo | Version history display |
| PIP-005 | EnrichmentPipeline | `pipeline/enrichment/` | ✅ Completo | Doctrine enrichment |
| PIP-006 | ExternalIngestionPipeline | `pipeline/external_ingestion.py` | ✅ Completo | VisuaLex contribution |
| PIP-007 | LiveEnrichmentService | `pipeline/live_enrichment.py` | ✅ Completo | `ContributePage.tsx` |

**Collegamento VisuaLex**:
- `ContributePage.tsx` → Usa live enrichment pipeline
- `IngestionPrompt.tsx` → Trigger per enrichment

---

### 1.5 API Router Tasks

| Task ID | Task MERL-T | Modulo | Stato | VisuaLex Feature Collegata |
|---------|-------------|--------|-------|---------------------------|
| API-001 | Ingestion Router | `api/ingestion_api.py` | ✅ Completo | `/api/merlt/enrichment/*` |
| API-002 | Feedback Router | `api/feedback_api.py` | ✅ Completo | `/api/merlt/feedback` |
| API-003 | Auth Router | `api/auth_api.py` | ✅ Completo | `/api/merlt/authority` |
| API-004 | Enrichment Router | `api/enrichment_router.py` | ✅ Completo | Live enrichment endpoints |

---

## SEZIONE 2: TASK VISUALEX INTEGRATION

### 2.1 Frontend Integration Tasks

| Task ID | Task VisuaLex | File | Stato | MERL-T Dependency |
|---------|---------------|------|-------|-------------------|
| VLX-001 | `merltService.ts` API client | `services/merltService.ts` | ✅ Completo | Tutti gli endpoint |
| VLX-002 | `MerltContext` provider | `contexts/MerltContext.tsx` | ✅ Completo | Authority, tracking |
| VLX-003 | `useInteractionTracker` hook | `hooks/useInteractionTracker.ts` | ✅ Completo | RLCF-006 |
| VLX-004 | `useFeedbackTrigger` hook | `hooks/useFeedbackTrigger.ts` | ✅ Completo | RLCF-005 |
| VLX-005 | `MerltFeedbackPopup` UI | `components/ui/MerltFeedbackPopup.tsx` | ✅ Completo | RLCF-005 |
| VLX-006 | `ContributionEffortToggle` | `components/ui/ContributionEffortToggle.tsx` | ✅ Completo | Authority gating |
| VLX-007 | `IngestionPrompt` | `components/ui/IngestionPrompt.tsx` | ✅ Completo | STR-001, API-004 |
| VLX-008 | `ArticleTabContent` integration | `components/features/search/ArticleTabContent.tsx` | ✅ Completo | checkArticleInGraph |
| VLX-009 | `ContributePage` | `pages/contribution/ContributePage.tsx` | ✅ Completo | API-004 |
| VLX-010 | `useLiveEnrichment` hook | `hooks/useLiveEnrichment.ts` | ✅ Completo | PIP-007 |

### 2.2 Backend Proxy Tasks (VisuaLex Express)

| Task ID | Task VisuaLex Backend | File | Stato | MERL-T Endpoint |
|---------|----------------------|------|-------|-----------------|
| BKD-001 | MERL-T routes | `routes/merlt.ts` | ✅ Completo | Tutti |
| BKD-002 | MERL-T controller | `controllers/merltController.ts` | ✅ Completo | Proxy a MERL-T |
| BKD-003 | CORS middleware fix | `index.ts` | ✅ Completo | - |

---

## SEZIONE 3: TASK DA IMPLEMENTARE

### 3.1 Task Priorità ALTA (Sprint 1)

| Task ID | Descrizione | MERL-T Module | VisuaLex Component | Effort |
|---------|-------------|---------------|-------------------|--------|
| **INT-001** | Completare `/enrichment/check-article` endpoint | `api/` | `checkArticleInGraph()` | S |
| **INT-002** | Completare `/enrichment/live` endpoint | `pipeline/live_enrichment.py` | `requestLiveEnrichment()` | M |
| **INT-003** | Entity validation queue UI | `storage/graph/validation.py` | `EntityValidator.tsx` | M |
| **INT-004** | Relation validation queue UI | `storage/graph/validation.py` | `RelationValidator.tsx` | M |
| **INT-005** | Graph preview visualization | - | `GraphViewer.tsx` | M |

### 3.2 Task Priorità MEDIA (Sprint 2)

| Task ID | Descrizione | MERL-T Module | VisuaLex Component | Effort |
|---------|-------------|---------------|-------------------|--------|
| **INT-006** | Multi-expert synthesis display | `experts/synthesizer.py` | `ExpertSynthesisPanel.tsx` | L |
| **INT-007** | Disagreement detection UI | `disagreement/` | `DisagreementBadge.tsx` | M |
| **INT-008** | Amendment timeline | `pipeline/multivigenza.py` | `AmendmentTimeline.tsx` | M |
| **INT-009** | Semantic search integration | `storage/retriever/` | `SearchPanel.tsx` | L |
| **INT-010** | Authority badge system | `rlcf/authority.py` | `AuthorityBadge.tsx` | S |

### 3.3 Task Priorità BASSA (Sprint 3+)

| Task ID | Descrizione | MERL-T Module | VisuaLex Component | Effort |
|---------|-------------|---------------|-------------------|--------|
| **INT-011** | Citation chain visualization | `tools/citation_chain.py` | `CitationChain.tsx` | L |
| **INT-012** | Document upload extraction | `pipeline/enrichment/` | `DocumentUpload.tsx` | L |
| **INT-013** | Contribution gamification | `rlcf/` | `ContributionStats.tsx` | M |
| **INT-014** | Offline-first sync | `rlcf/external_feedback.py` | Service Worker | L |
| **INT-015** | Real-time AI assistant | `experts/` | `AIAssistant.tsx` | XL |

---

## SEZIONE 4: FLUSSO DATI DETTAGLIATO

### 4.1 Flusso: Verifica Articolo nel Grafo

```
ArticleTabContent.tsx
        │
        ▼
useEffect (on article load)
        │
        ▼
checkArticleInGraph(tipoAtto, articolo)
        │
        ▼
merltService.ts → GET /api/merlt/enrichment/check-article
        │
        ▼
VisuaLex Backend → proxy → MERL-T API
        │
        ▼
MERL-T: FalkorDBClient.query("MATCH (n:Norma {urn: $urn}) RETURN n")
        │
        ▼
Response: { in_graph: bool, node_count: number, has_entities: bool }
        │
        ▼
if (!in_graph && contributionEnabled) → showIngestionPrompt = true
```

### 4.2 Flusso: Live Enrichment

```
IngestionPrompt (onAccept)
        │
        ▼
navigate("/contribute", { state: articleInfo })
        │
        ▼
ContributePage.tsx
        │
        ▼
requestLiveEnrichment({ tipo_atto, articolo, include_brocardi: true })
        │
        ▼
merltService.ts → POST /api/merlt/enrichment/live
        │
        ▼
MERL-T: LiveEnrichmentService.enrich()
        │
        ├── NormattivaScraper.fetch()  → Official text
        ├── BrocardiScraper.fetch()    → Doctrine
        └── LLMExtraction              → Entities + Relations
        │
        ▼
Response: {
    pending_entities: PendingEntity[],
    pending_relations: PendingRelation[],
    graph_preview: { nodes, links }
}
        │
        ▼
ContributePage renders:
  - EntityValidator cards (per ogni pending_entity)
  - RelationValidator cards (per ogni pending_relation)
  - GraphViewer (preview interattivo)
```

### 4.3 Flusso: Validazione Entity

```
EntityValidator.tsx (onApprove/onReject/onEdit)
        │
        ▼
validateEntity(entityId, vote, editedData?)
        │
        ▼
merltService.ts → POST /api/merlt/enrichment/validate-entity
        │
        ▼
MERL-T: ValidationService.add_vote(entity_id, user_id, vote, authority)
        │
        ├── Calcola weighted_vote = vote * user_authority
        └── Check threshold: if Σ(weighted_vote) ≥ 2.0 → approved
        │
        ▼
if approved → GraphWriter.create_node(entity)
        │
        ▼
Response: { status: "approved" | "pending" | "rejected" }
        │
        ▼
UI: Update entity card status, animate transition
```

### 4.4 Flusso: Interaction Tracking

```
User Action (highlight, bookmark, click, etc.)
        │
        ▼
useHighlights/useBookmarks/etc. hook
        │
        ▼
MerltContext.trackHighlight(articleUrn, true, selectedText)
        │
        ▼
useInteractionTracker.trackInteraction({
    interaction_type: "highlight_create",
    article_urn: articleUrn,
    metadata: { text, color, position }
})
        │
        ▼
if (useQueue) → interactionQueue.push(data)
else → POST /api/merlt/track
        │
        ▼
VisuaLex Backend → MERL-T: ExternalFeedbackAdapter.register_interaction()
        │
        ▼
FeedbackAccumulator.accumulate(interaction) → MultilevelFeedback
        │
        ▼
(Async) PolicyGradientTrainer.update() quando batch completo
```

### 4.5 Flusso: Feedback Explicito

```
MerltFeedbackPopup.tsx (thumbs up/down)
        │
        ▼
submitQuickFeedback(traceId, isPositive)
        │
        ▼
merltService.ts → POST /api/merlt/feedback
        │
        ▼
Body: {
    trace_id: traceId,
    feedback: { synthesis: { usefulness: 0.9 | 0.1 } }
}
        │
        ▼
MERL-T: ExternalFeedbackAdapter.register_explicit_feedback()
        │
        ▼
RLCFPersistence.save_feedback(trace_id, feedback, authority)
        │
        ▼
(Async) PolicyGradientTrainer.update_from_feedback(trace, feedback)
        │
        ▼
GatingPolicy weights updated via REINFORCE
```

---

## SEZIONE 5: MATRICE DIPENDENZE

### 5.1 Dipendenze MERL-T → VisuaLex

```
┌────────────────────────────────────────────────────────────────────┐
│  MERL-T Module              │  VisuaLex Component che lo usa      │
├────────────────────────────────────────────────────────────────────┤
│  FalkorDBClient             │  checkArticleInGraph()              │
│  LiveEnrichmentService      │  ContributePage, requestLiveEnrich  │
│  ValidationService          │  EntityValidator, RelationValidator │
│  ExternalFeedbackAdapter    │  MerltFeedbackPopup, trackInteraction│
│  AuthorityModule            │  getAuthority(), AuthorityBadge     │
│  GraphAwareRetriever        │  SearchPanel (future semantic)      │
│  MultiExpertOrchestrator    │  ExpertSynthesisPanel (future)      │
│  DisagreementNet            │  DisagreementBadge (future)         │
└────────────────────────────────────────────────────────────────────┘
```

### 5.2 Dipendenze VisuaLex → MERL-T API

```
┌────────────────────────────────────────────────────────────────────┐
│  VisuaLex Action            │  MERL-T Endpoint                    │
├────────────────────────────────────────────────────────────────────┤
│  Article load               │  GET /enrichment/check-article      │
│  Accept ingestion           │  POST /enrichment/live              │
│  Approve entity             │  POST /enrichment/validate-entity   │
│  Approve relation           │  POST /enrichment/validate-relation │
│  Propose entity             │  POST /enrichment/propose-entity    │
│  Propose relation           │  POST /enrichment/propose-relation  │
│  Track interaction          │  POST /track                        │
│  Submit feedback            │  POST /feedback                     │
│  Get authority              │  GET /authority                     │
│  Update profile             │  PATCH /profile                     │
│  Get stats                  │  GET /stats                         │
│  Get pending queue          │  POST /enrichment/pending           │
└────────────────────────────────────────────────────────────────────┘
```

---

## SEZIONE 6: TIPI DI INTERAZIONE TRACCIATI

| Interaction Type | Trigger VisuaLex | MERL-T Processing |
|-----------------|------------------|-------------------|
| `bookmark_add` | useBookmarks.addBookmark() | Implicit positive signal |
| `bookmark_remove` | useBookmarks.removeBookmark() | Implicit negative signal |
| `highlight_create` | useHighlights.addHighlight() | Implicit engagement |
| `highlight_remove` | useHighlights.removeHighlight() | - |
| `annotation_create` | useAnnotations.addNote() | High engagement signal |
| `annotation_question` | useAnnotations.addQuestion() | Query intent signal |
| `search_result_click` | SearchResultCard.onClick() | Relevance signal |
| `first_result_click` | First result click | Strong relevance |
| `skip_results` | Scroll past results | Negative relevance |
| `cross_ref_click` | CrossRefLink.onClick() | Relation validation |
| `cross_ref_found` | Cross-ref resolution success | Relation discovery |
| `doctrine_read` | StudyMode > 30s on Brocardi | Doctrine quality |
| `long_read` | Article read > 2min | Content quality |
| `quick_close` | Article close < 10s | Negative signal |
| `quicknorm_save` | QuickNorm.save() | Bookmarking intent |
| `dossier_add` | Dossier.addArticle() | Collection curation |
| `search_after_ai` | Search after AI response | AI quality signal |

---

## SEZIONE 7: CHECKLIST IMPLEMENTAZIONE

### Sprint 1: Core Enrichment Flow
- [ ] **INT-001**: `/enrichment/check-article` endpoint funzionante
- [ ] **INT-002**: `/enrichment/live` con estrazione LLM
- [ ] **INT-003**: EntityValidator con 3 azioni (approve/reject/edit)
- [ ] **INT-004**: RelationValidator con 3 azioni
- [ ] **INT-005**: GraphViewer con react-force-graph

### Sprint 2: Enhanced Features
- [ ] **INT-006**: ExpertSynthesisPanel con tabs per expert
- [ ] **INT-007**: DisagreementBadge quando experts divergono
- [ ] **INT-008**: AmendmentTimeline con multivigenza
- [ ] **INT-009**: Semantic search in SearchPanel
- [ ] **INT-010**: AuthorityBadge con breakdown

### Sprint 3: Polish & Advanced
- [ ] **INT-011**: CitationChain visualization
- [ ] **INT-012**: DocumentUpload per appunti
- [ ] **INT-013**: ContributionStats gamification
- [ ] **INT-014**: Offline sync con Service Worker
- [ ] **INT-015**: AIAssistant in StudyMode

---

## SEZIONE 8: ENDPOINT REFERENCE

### MERL-T API (FastAPI)

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/enrichment/check-article` | GET | `tipo_atto, articolo, numero_atto?, data?` | `CheckArticleResponse` |
| `/api/enrichment/live` | POST | `LiveEnrichmentRequest` | `LiveEnrichmentResponse` |
| `/api/enrichment/validate-entity` | POST | `entity_id, vote, edited_data?` | `{status, new_status}` |
| `/api/enrichment/validate-relation` | POST | `relation_id, vote, edited_data?` | `{status, new_status}` |
| `/api/enrichment/propose-entity` | POST | `PendingEntity data` | `{entity_id}` |
| `/api/enrichment/propose-relation` | POST | `PendingRelation data` | `{relation_id}` |
| `/api/enrichment/pending` | POST | `user_id?, article_urn?` | `PendingQueue` |
| `/api/feedback/interaction` | POST | `InteractionModel` | `{id, synced}` |
| `/api/feedback/explicit` | POST | `ExplicitFeedbackModel` | `{id, synced}` |
| `/api/authority/user` | GET | - | `AuthorityResponse` |
| `/api/authority/profile` | PATCH | `ProfileUpdateRequest` | `ProfileUpdateResponse` |
| `/api/authority/stats` | GET | - | `UserStatsResponse` |

### VisuaLex Backend Proxy (Express)

| Endpoint | Proxies to |
|----------|-----------|
| `POST /api/merlt/track` | `/api/feedback/interaction` |
| `POST /api/merlt/feedback` | `/api/feedback/explicit` |
| `GET /api/merlt/authority` | `/api/authority/user` |
| `PATCH /api/merlt/profile` | `/api/authority/profile` |
| `GET /api/merlt/stats` | `/api/authority/stats` |
| `GET /api/merlt/enrichment/check-article` | `/api/enrichment/check-article` |
| `POST /api/merlt/enrichment/live` | `/api/enrichment/live` |
| `POST /api/merlt/enrichment/validate-*` | `/api/enrichment/validate-*` |
| `POST /api/merlt/enrichment/propose-*` | `/api/enrichment/propose-*` |
| `POST /api/merlt/enrichment/pending` | `/api/enrichment/pending` |

---

*Documento generato il 31 Dicembre 2025 per il progetto MERL-T + VisuaLex*
