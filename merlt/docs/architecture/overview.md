# MERL-T System Architecture Map (v2)

> **Versione**: 2.1
> **Ultimo aggiornamento**: 8 Dicembre 2025
> **Stato**: Reference Document - ARCHITETTURA v2

---

## Overview v2

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              MERL-T ARCHITECTURE v2                              │
│                    Multi-Expert Legal Retrieval Transformer                      │
│            Expert Autonomi + RLCF Multilivello + Hybrid GraphRAG                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                         FRONTEND (React 19)                              │   │
│   │                         Status: 35%                                      │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼ REST API                                │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                      API GATEWAY (FastAPI)                               │   │
│   │   [Auth] [Rate Limit] [Logging] Status: 100%                            │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                           ┌────────────┼────────────┐                           │
│                           ▼            │            ▼                           │
│   ┌────────────────────────────┐      │      ┌────────────────────────────┐   │
│   │     PREPROCESSING          │      │      │      GATING NETWORK        │   │
│   │     NER + KG Enrich       │      │      │     theta_gating (v2)       │   │
│   │     Status: 100%          │      │      │     Status: 0%              │   │
│   └────────────────────────────┘      │      └────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                     EXPERT AUTONOMI CON TOOLS (v2)                       │   │
│   │                                                                          │   │
│   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │   │
│   │   │ LITERAL  │  │ SYSTEMIC │  │PRINCIPLES│  │PRECEDENT │               │   │
│   │   │  tools   │  │  tools   │  │  tools   │  │  tools   │               │   │
│   │   │theta_trav│  │theta_trav│  │theta_trav│  │theta_trav│               │   │
│   │   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘               │   │
│   │        │              │              │              │                    │   │
│   │        └──────────────┴──────────────┴──────────────┘                    │   │
│   │                                │                                          │   │
│   │                                ▼                                          │   │
│   │                    ┌──────────────────────┐                              │   │
│   │                    │    GRAPH-AWARE       │                              │   │
│   │                    │    RETRIEVER         │                              │   │
│   │                    │  (Hybrid GraphRAG)   │                              │   │
│   │                    └──────────┬───────────┘                              │   │
│   │                               │                                           │   │
│   │               ┌───────────────┼───────────────┐                          │   │
│   │               ▼               ▼               ▼                          │   │
│   │        ┌──────────┐   ┌──────────────┐  ┌──────────┐                    │   │
│   │        │  Qdrant  │◄──│ BRIDGE TABLE │──►│FalkorDB │                    │   │
│   │        │  Vector  │   │ chunk ↔ node │   │  Graph  │                    │   │
│   │        └──────────┘   └──────────────┘  └──────────┘                    │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                         SYNTHESIZER                                      │   │
│   │           Convergent | Divergent Modes                                   │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                    RLCF MULTILIVELLO (v2)                                │   │
│   │                                                                          │   │
│   │   Authority per LIVELLO:  retrieval | reasoning | synthesis             │   │
│   │   Authority per DOMINIO:  civile | penale | amministrativo | ...        │   │
│   │                                                                          │   │
│   │   Learnable Weights: theta_traverse | theta_gating | theta_rerank       │   │
│   │                                                                          │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Differenze Chiave v1 vs v2

| Aspetto | v1 (Deprecata) | v2 (Nuova) |
|---------|---------------|------------|
| **Expert** | Passivi (ricevono retrieval) | Autonomi con tools |
| **Retrieval** | Centralizzato | Per-expert specializzato |
| **Graph DB** | Neo4j (lento) | FalkorDB (496x piu veloce) |
| **Vector-Graph** | Separati | Bridge Table integrata |
| **RLCF** | Authority scalare | Authority multilivello |
| **Pesi** | Statici | Apprendibili (theta_*) |

---

## 2. Componenti per Layer

### 2.1 Preprocessing Layer (Invariato)

| Componente | File | LOC | Status |
|------------|------|-----|--------|
| Query Understanding | `preprocessing/query_understanding_module.py` | 877 | 100% |
| KG Enrichment | `preprocessing/kg_enrichment_service.py` | 704 | 100% |
| NER Feedback Loop | `preprocessing/ner_feedback_loop.py` | 542 | 100% |

### 2.2 Orchestration Layer v2

| Componente | File | Status | Note v2 |
|------------|------|--------|---------|
| Router | `orchestration/llm_router.py` | 100% | Decide quali expert attivare |
| **Gating Network** | `orchestration/gating/` | 0% | **NUOVO v2**: Pesa expert |
| LangGraph Workflow | `orchestration/langgraph_workflow.py` | Da aggiornare | Integrare expert autonomi |

### 2.3 Reasoning Layer v2 (Expert Autonomi)

| Expert | Tools Specifici | theta_traverse | Status |
|--------|----------------|----------------|--------|
| **Literal** | get_exact_text, get_definitions | DEFINISCE: 0.95, RINVIA: 0.90 | 0% |
| **Systemic** | get_legislative_history, get_system_context | MODIFICA: 0.90, ATTUA: 0.75 | 0% |
| **Principles** | get_constitutional_basis, find_principle_conflicts | BILANCIA: 0.95, DEROGA: 0.90 | 0% |
| **Precedent** | search_cases, get_citation_chain | INTERPRETA: 0.95, OVERRULES: 0.95 | 0% |

**Classi da implementare**:
- `ExpertWithTools`
- `ExpertTraversalWeights`
- `ExpertGatingNetwork`

### 2.4 Storage Layer v2

| Componente | Tecnologia | Status | Note v2 |
|------------|------------|--------|---------|
| **Graph DB** | FalkorDB | **100%** | ✅ Operativo, 15K+ nodi |
| Vector DB | Qdrant | **100%** | ✅ 17K+ embeddings |
| **Bridge Table** | PostgreSQL | **100%** | ✅ 1.5K+ mappings |
| Main DB | PostgreSQL | 100% | Invariato |
| Cache | Redis | 100% | Invariato |

**Schema Bridge Table**:
```sql
CREATE TABLE bridge_table (
    chunk_id UUID,
    graph_node_id VARCHAR(200),
    relation_type VARCHAR(50),  -- PRIMARY, CONCEPT, REFERENCE
    weight FLOAT DEFAULT 1.0    -- Apprendibile da RLCF
);
```

### 2.5 Learning Layer v2 (RLCF Multilivello)

| Componente | Descrizione | Status |
|------------|-------------|--------|
| **MultilevelAuthority** | Authority per livello + dominio | 0% |
| **LearnableSystemParameters** | theta_traverse, theta_gating, theta_rerank | 0% |
| **MultilevelFeedback** | Feedback su retrieval, reasoning, synthesis | 0% |
| **PolicyGradient** | REINFORCE per training pesi | 0% |
| **ResilientLearning** | Temporal decay, graph events | 0% |

---

## 3. Pesi Apprendibili (v2)

```
LEARNABLE PARAMETERS
================================================================

theta_gating:      Input: query embedding → Output: [w_literal, w_systemic, w_principles, w_precedent]
                   Training: RLCF feedback "quale expert aveva ragione"

theta_traverse_*:  Per ogni expert, pesi per tipo di relazione nel grafo
                   Es. theta_traverse_literal = {DEFINISCE: 0.95, RINVIA: 0.90, ...}
                   Training: RLCF feedback "le fonti trovate erano rilevanti"

theta_rerank:      Re-ranker neurale per ordinare risultati
                   Training: RLCF feedback "ranking corretto"

alpha:             Peso semantico vs grafo nel GraphAwareRetriever
                   Training: Correlazione graph_score ↔ relevance
```

---

## 4. Graph-Aware Retrieval Flow

```
HYBRID RETRIEVAL FLOW
================================================================

1. QUERY INPUT + NER
   │
   ▼
2. CONTEXT NODES (entita estratte → nodi nel grafo)
   │
   ▼
3. PARALLEL RETRIEVAL
   │
   ├─► QDRANT: Vector similarity search
   │   Output: chunks con similarity_score
   │
   └─► FALKORDB: Graph traversal (con theta_traverse)
       Output: nodi raggiungibili con path_score
   │
   ▼
4. BRIDGE TABLE JOIN
   │ Per ogni chunk: trova nodi collegati
   │
   ▼
5. GRAPH SCORE COMPUTATION
   │ Per ogni chunk: shortest path ai context_nodes
   │
   ▼
6. FINAL SCORE
   │ score = alpha * similarity + (1-alpha) * graph_score
   │
   ▼
7. RE-RANK + TOP-K
```

---

## 5. RLCF Multilivello Schema

```
AUTHORITY MULTILIVELLO
================================================================

Per ogni esperto (utente che da feedback):

level_authority = {
    "retrieval": 0.5,    # Bravo a valutare fonti?
    "reasoning": 0.5,    # Bravo a valutare interpretazioni?
    "synthesis": 0.5,    # Bravo a valutare risposte finali?
}

domain_authority = {
    "civile": 0.5,
    "penale": 0.5,
    "amministrativo": 0.5,
    "costituzionale": 0.5,
    "lavoro": 0.5,
    "commerciale": 0.5,
}

Formula base (come v1, ma per dimensione):
A_u(t) = alpha * B_u + beta * T_u(t-1) + gamma * P_u(t)

dove alpha=0.3, beta=0.5, gamma=0.2
```

---

## 6. Blocchi per Implementazione v2

| # | Blocco | Effort | Priorita |
|---|--------|--------|----------|
| 1 | Dati in FalkorDB | 2-3 giorni | ALTA |
| 2 | Dati in Qdrant | 1-2 giorni | ALTA |
| 3 | Bridge Table builder | 1-2 giorni | ALTA |
| 4 | ExpertWithTools class | 2-3 settimane | MEDIA |
| 5 | GatingNetwork | 1-2 settimane | MEDIA |
| 6 | GraphAwareRetriever | 2-3 settimane | MEDIA |
| 7 | RLCF multilivello DB | 1 settimana | MEDIA |
| 8 | Policy gradient training | 2-3 settimane | BASSA |

---

## 7. Documenti di Riferimento

| Layer | Documento v2 |
|-------|-------------|
| Orchestration | `docs/03-architecture/02-orchestration-layer.md` |
| Reasoning | `docs/03-architecture/03-reasoning-layer.md` |
| Storage | `docs/03-architecture/04-storage-layer.md` |
| Learning | `docs/03-architecture/05-learning-layer.md` |

**Archive v1**: `docs/03-architecture/archive/`

---

## Changelog

| Data | Versione | Modifiche |
|------|----------|-----------|
| 2025-12-08 | 2.1 | Aggiornato status Storage Layer (tutti 100%), 7 esperimenti completati |
| 2025-12-02 | 2.0 | Aggiornamento a architettura v2: Expert autonomi, FalkorDB, Bridge Table, RLCF multilivello |
| 2025-12-02 | 1.0 | Creazione documento iniziale |
