# MERL-T Architecture Map

> Mappa completa dell'architettura della libreria MERL-T
> **Versione**: 1.0 | **Data**: 2026-01-04

---

## Panoramica

MERL-T e' una libreria Python per l'informatica giuridica italiana che combina:
- **Knowledge Graph giuridico** (FalkorDB)
- **Ricerca semantica** (Qdrant + E5-large embeddings)
- **Sistema Multi-Expert** basato sui canoni ermeneutici delle Preleggi (Art. 12-14)
- **RLCF Framework** (Reinforcement Learning from Collective Feedback)

**Stack Tecnologico Core**:
- Python 3.11+ (async-first)
- FalkorDB (graph), Qdrant (vectors), PostgreSQL (bridge table), Redis (cache)
- sentence-transformers, OpenRouter, PyTorch

---

## 1. merlt/api/ - FastAPI Endpoints

### Scopo
Espone funzionalita' MERL-T tramite API REST per integrazione con sistemi esterni (es. VisuaLex).

### Componenti Chiave

| File | Componente | Descrizione |
|------|-----------|-------------|
| `ingestion_api.py` | `ingestion_router` | Endpoints per ingestion documenti da fonti esterne |
| `feedback_api.py` | `feedback_router` | Ricezione feedback RLCF da utenti |
| `auth_api.py` | `auth_router` | Sincronizzazione authority score utenti |
| `experts_router.py` | `experts_router` | Endpoints per query multi-expert system |
| `enrichment_router.py` | `enrichment_router` | Enrichment Brocardi (massime, spiegazioni) |
| `profile_router.py` | `profile_router` | Gestione profili utente |
| `visualex_bridge.py` | `VisuaLexBridge` | Proxy per integrazione VisuaLex frontend |

### Dipendenze
- `merlt.core.LegalKnowledgeGraph` - Orchestrazione principale
- `merlt.experts.MultiExpertOrchestrator` - Query handling
- `merlt.rlcf.external_feedback` - Feedback integration
- FastAPI, Pydantic (modelli request/response)

### Entry Points
```python
from fastapi import FastAPI
from merlt.api import ingestion_router, feedback_router, experts_router

app = FastAPI()
app.include_router(ingestion_router, prefix="/api/v1")
app.include_router(feedback_router, prefix="/api/v1")
app.include_router(experts_router, prefix="/api/v1")
```

---

## 2. merlt/core/ - Orchestrazione Centrale

### Scopo
Entry point principale della libreria. Coordina tutti i componenti per fornire API high-level.

### Componenti Chiave

| File | Classe | Descrizione |
|------|--------|-------------|
| `legal_knowledge_graph.py` | `LegalKnowledgeGraph` | **Orchestrator principale** - coordina storage, pipeline, experts |
| `legal_knowledge_graph.py` | `MerltConfig` | Configurazione centralizzata (DB URLs, model names, etc.) |
| `legal_knowledge_graph.py` | `InterpretationResult` | Risultato query multi-expert |

### Dipendenze
- `merlt.storage.*` - Accesso a graph, vectors, bridge table
- `merlt.pipeline.*` - Ingestion, parsing, chunking
- `merlt.sources.*` - Scrapers Normattiva/Brocardi
- `merlt.experts.MultiExpertOrchestrator` - Interpretazione multi-expert
- `merlt.rlcf.RLCFOrchestrator` - Feedback loop

### Entry Points
```python
from merlt import LegalKnowledgeGraph, MerltConfig

config = MerltConfig()
kg = LegalKnowledgeGraph(config)
await kg.connect()

# Ingestion
result = await kg.ingest("codice civile", "1453")

# Ricerca
results = await kg.search("contratto di vendita")

# Interpretazione multi-expert
interpretation = await kg.interpret("Cos'e' la legittima difesa?")
```

**Filosofia**: Ogni operazione comune deve richiedere MAX 3 righe di codice.

---

## 3. merlt/sources/ - Data Scrapers

### Scopo
Acquisizione testi giuridici da fonti ufficiali e dottrinali.

### Componenti Chiave

| File | Classe | Descrizione |
|------|--------|-------------|
| `base.py` | `BaseScraper` | Classe base per tutti gli scrapers |
| `normattiva.py` | `NormattivaScraper` | Testi ufficiali da Normattiva.it (fonte primaria) |
| `brocardi.py` | `BrocardiScraper` | Enrichment: massime, spiegazioni, ratio, casi pratici |
| `eurlex.py` | `EurlexScraper` | Normativa EU (WIP) |

**Utilities** (`sources/utils/`):
- `norma.py`: Parsing nomi atti ("codice civile" → metadata)
- `urn.py`: Generazione URN legali (urn:nir:stato:codice.civile:1942-03-16;262)
- `tree.py`: Navigazione struttura gerarchica (Libro → Titolo → Capo → Articolo)
- `text.py`: Cleaning testi HTML
- `http.py`: HTTP client con retry e rate limiting

### Dipendenze
- `aiohttp` - Async HTTP requests
- `BeautifulSoup4` - HTML parsing
- `merlt.sources.utils.retry` - Retry logic con exponential backoff

### Entry Points
```python
from merlt.sources import NormattivaScraper, BrocardiScraper

# Scraping Normattiva
scraper = NormattivaScraper()
text, url = await scraper.fetch_document({
    "tipo_atto": "codice civile",
    "numero_articolo": "1453"
})

# Enrichment Brocardi
brocardi = BrocardiScraper()
enrichment = await brocardi.fetch_enrichment("codice civile", "1453")
print(enrichment["massima"])
```

---

## 4. merlt/storage/ - Persistence Layer

### Scopo
Storage multi-database per graph, vectors, bridge table. Architettura ibrida per retrieval semantico + strutturale.

### Componenti Chiave

#### 4.1 storage/graph/
| File | Classe | Descrizione |
|------|--------|-------------|
| `client.py` | `FalkorDBClient` | Client per FalkorDB (Cypher queries) |
| `config.py` | `FalkorDBConfig` | Configurazione connessione FalkorDB |

**Schema Nodi**:
- `Atto`: Codice Civile, Codice Penale, etc.
- `Libro`, `Titolo`, `Capo`, `Sezione`: Struttura gerarchica
- `Articolo`: Articolo singolo
- `Comma`: Singolo comma con testo

**Relazioni**:
- `:PARTE_DI` - Gerarchia strutturale
- `:RICHIAMA` - Citation tra articoli
- `:DERIVED_FROM` - Multivigenza (modifiche)
- `:DEFINISCE` - Definizioni

#### 4.2 storage/vectors/
| File | Classe | Descrizione |
|------|--------|-------------|
| `embeddings.py` | `EmbeddingService` | Embeddings + Qdrant client |

**Modello**: `sentence-transformers/multilingual-e5-large-instruct` (1024 dim)
**Collections**:
- `merl_t_dev_chunks` - Development
- `merl_t_prod_chunks` - Production

#### 4.3 storage/bridge/
| File | Classe | Descrizione |
|------|--------|-------------|
| `bridge_table.py` | `BridgeTable` | Mapping chunk_id ↔ node_urn (PostgreSQL) |
| `bridge_builder.py` | `BridgeBuilder` | Costruzione mappings durante ingestion |
| `models.py` | `BridgeTableEntry` | Dataclass per mapping entry |

**Schema PostgreSQL**:
```sql
CREATE TABLE bridge_table (
    chunk_id UUID PRIMARY KEY,
    node_urn TEXT NOT NULL,
    chunk_text TEXT,
    metadata JSONB
);
```

#### 4.4 storage/retriever/
| File | Classe | Descrizione |
|------|--------|-------------|
| `hybrid.py` | `GraphAwareRetriever` | **Retrieval ibrido**: semantic (Qdrant) + graph score (FalkorDB) |
| `models.py` | `RetrievalResult` | Risultato con similarity + graph score |

**Formula Hybrid Score**:
```
final_score = alpha * similarity_score + (1-alpha) * graph_score
```

### Dipendenze
- FalkorDB, Qdrant, PostgreSQL, Redis
- `sentence-transformers` - Embeddings
- `asyncpg` - Async PostgreSQL driver

### Entry Points
```python
from merlt.storage import FalkorDBClient, EmbeddingService, BridgeTable, GraphAwareRetriever

# Graph client
graph = FalkorDBClient(host="localhost", port=6380, graph_name="merl_t_dev")
await graph.connect()
await graph.execute("MATCH (a:Articolo {numero: '1453'}) RETURN a")

# Embeddings
embeddings = EmbeddingService()
vector = await embeddings.embed("legittima difesa")
results = await embeddings.search(vector, top_k=5)

# Bridge table
bridge = BridgeTable(db_url="postgresql://...")
entry = await bridge.get_by_chunk_id(chunk_id)

# Hybrid retrieval
retriever = GraphAwareRetriever(graph, embeddings, bridge)
results = await retriever.retrieve("contratto", top_k=10, alpha=0.7)
```

---

## 5. merlt/pipeline/ - Processing Pipeline

### Scopo
Pipeline ETL per ingestion articoli: scraping → parsing → chunking → embedding → graph creation.

### Componenti Chiave

| File | Classe | Descrizione |
|------|--------|-------------|
| `ingestion.py` | `IngestionPipelineV2` | **Pipeline principale** - orchestrazione completa |
| `parsing.py` | `CommaParser` | Parser articoli in componenti strutturati (commi, lettere, numeri) |
| `chunking.py` | `StructuralChunker` | Chunking a livello comma (+ semantic fallback) |
| `multivigenza.py` | `MultivigenzaPipeline` | Gestione versioni e modifiche temporali |
| `batch_ingestion.py` | Batch processing | Ingestion massiva con checkpoint |

**Enrichment Pipeline** (`pipeline/enrichment/`):
- `pipeline.py`: `EnrichmentPipeline` - Arricchimento da Brocardi
- `extractors/`: Estrazione massime, definizioni, principi, concetti
- `linkers/`: Entity linking e normalizzazione
- `writers/`: Scrittura nodi enrichment in FalkorDB

**Semantic Chunking** (`pipeline/semantic_chunking/`):
- `semantic.py`: Chunking basato su similarita' semantica
- `late.py`: Late chunking (embeddings poi split)
- `proposition.py`: Proposition-based chunking
- `hybrid.py`: Hybrid semantic + structural

### Dipendenze
- `merlt.sources` - Scrapers
- `merlt.storage` - Graph, embeddings, bridge
- `merlt.models` - Data models

### Entry Points
```python
from merlt.pipeline import IngestionPipelineV2, CommaParser, StructuralChunker

# Pipeline completa
pipeline = IngestionPipelineV2(graph_client, bridge_table, embeddings)
results = await pipeline.ingest_article({
    "tipo_atto": "codice civile",
    "numero_articolo": "1453"
})

# Parser standalone
parser = CommaParser()
structure = parser.parse_article(article_text)
print(structure.commi)

# Chunker standalone
chunker = StructuralChunker()
chunks = chunker.chunk_article(article_structure)
```

---

## 6. merlt/experts/ - Multi-Expert System

### Scopo
Sistema di interpretazione giuridica basato sui 4 canoni ermeneutici delle Preleggi (Art. 12-14).

### Componenti Chiave

#### 6.1 Expert Implementations
| File | Classe | Canon Ermeneutico |
|------|--------|-------------------|
| `literal.py` | `LiteralExpert` | **Art. 12, I** - "significato proprio delle parole" |
| `systemic.py` | `SystemicExpert` | **Art. 12, I** - "connessione di esse" + **Art. 14** storico |
| `principles.py` | `PrinciplesExpert` | **Art. 12, II** - "intenzione del legislatore" |
| `precedent.py` | `PrecedentExpert` | Prassi giurisprudenziale applicativa |

#### 6.2 Orchestrazione
| File | Classe | Descrizione |
|------|--------|-------------|
| `base.py` | `BaseExpert`, `ExpertWithTools` | Classi base per tutti gli experts |
| `orchestrator.py` | `MultiExpertOrchestrator` | Coordina query multi-expert |
| `router.py` | `ExpertRouter` | Classifica query → seleziona experts rilevanti |
| `gating.py` | `GatingNetwork` | Aggrega risposte experts (weighted sum) |
| `synthesizer.py` | `AdaptiveSynthesizer` | Sintesi finale (consensus/majority/detailed) |

#### 6.3 Advanced Features
| File | Classe | Descrizione |
|------|--------|-------------|
| `react_mixin.py` | `ReActMixin` | ReAct pattern (Thought → Action → Observation) |
| `query_analyzer.py` | Query analysis | Estrazione entities, intent classification |
| `prompt_loader.py` | Prompt management | Caricamento prompt da YAML |
| `models.py` | Data models | `ExpertContext`, `ExpertResponse`, `LegalSource` |

**Neural Gating** (opzionale - PyTorch):
- `neural_gating.py`: `HybridExpertRouter`, `ExpertGatingMLP` - Neural routing con addestramento

### Dipendenze
- `merlt.tools` - Tool per search, hierarchy, definition, etc.
- `merlt.rlcf.ai_service` - OpenRouter per LLM calls
- `merlt.storage.retriever` - Hybrid retrieval

### Entry Points
```python
from merlt.experts import (
    MultiExpertOrchestrator,
    LiteralExpert,
    SystemicExpert,
    ExpertContext
)

# Setup orchestrator
orchestrator = MultiExpertOrchestrator(
    experts=[LiteralExpert(...), SystemicExpert(...)],
    router=ExpertRouter(...),
    gating=GatingNetwork(...),
    synthesizer=AdaptiveSynthesizer(...)
)

# Query multi-expert
context = ExpertContext(query_text="Cos'e' la risoluzione per inadempimento?")
result = await orchestrator.process(context)

print(result.synthesis)  # Risposta sintetizzata
print(result.expert_responses)  # Risposte individuali experts
print(result.confidence)  # Confidence score
```

---

## 7. merlt/tools/ - Expert Tools

### Scopo
Funzioni atomiche che gli Expert possono invocare per recuperare informazioni dal knowledge graph.

### Componenti Chiave

| File | Tool | Descrizione |
|------|------|-------------|
| `search.py` | `SemanticSearchTool` | Ricerca semantica (Qdrant) |
| `search.py` | `GraphSearchTool` | Ricerca strutturale (Cypher) |
| `search.py` | `ArticleFetchTool` | Recupero articolo completo |
| `definition.py` | `DefinitionLookupTool` | Lookup definizioni legali |
| `hierarchy.py` | `HierarchyNavigationTool` | Navigazione gerarchia normativa |
| `historical_evolution.py` | `HistoricalEvolutionTool` | Storia modifiche articolo |
| `principle_lookup.py` | `PrincipleLookupTool` | Lookup principi giuridici |
| `constitutional_basis.py` | `ConstitutionalBasisTool` | Fondamento costituzionale |
| `citation_chain.py` | `CitationChainTool` | Catena citazioni giurisprudenziali |
| `textual_reference.py` | `TextualReferenceTool` | Riferimenti normativi nel testo |
| `external_source.py` | `ExternalSourceTool` | Fonti esterne (dottrina, etc.) |
| `verification.py` | `VerificationTool` | Verifica fonti |

**Registry** (`registry.py`):
- `ToolRegistry`: Registro globale tools
- `get_tool_registry()`: Singleton registry
- `register_tool()`: Decorator per auto-registration

### Dipendenze
- `merlt.storage.retriever` - Hybrid retrieval
- `merlt.storage.graph` - Cypher queries

### Entry Points
```python
from merlt.tools import get_tool_registry, SemanticSearchTool, DefinitionLookupTool

# Registra tools
registry = get_tool_registry()
registry.register(SemanticSearchTool(retriever))
registry.register(DefinitionLookupTool(graph_client))

# Expert usa tool
tool = registry.get("semantic_search")
result = await tool(query="contratto", top_k=5)

# Schema JSON per LLM function calling
schema = tool.to_json_schema()
```

---

## 8. merlt/rlcf/ - RLCF Framework

### Scopo
Reinforcement Learning from Collective Feedback - Framework per miglioramento continuo tramite feedback utenti.

### Componenti Chiave

#### 8.1 Core Components
| File | Classe | Descrizione |
|------|--------|-------------|
| `orchestrator.py` | `RLCFOrchestrator` | Coordinatore principale RLCF loop |
| `authority.py` | `AuthorityModule` | Calcolo authority score fonti/utenti |
| `aggregation.py` | `AggregationEngine` | Aggregazione feedback con authority-weighting |
| `ai_service.py` | `OpenRouterService` | Client OpenRouter (multi-provider LLM) |
| `metrics.py` | `MetricsTracker` | Tracking costi LLM e performance |
| `database.py` | Database session | Async SQLAlchemy sessions |
| `models.py` | SQLAlchemy models | Task, Feedback, Authority, etc. |

#### 8.2 Policy Gradient (Neural Routing)
| File | Classe | Descrizione |
|------|--------|-------------|
| `execution_trace.py` | `ExecutionTrace`, `Action` | Tracciamento decisioni policy |
| `multilevel_feedback.py` | `MultilevelFeedback` | Feedback strutturato (quality, relevance, etc.) |
| `policy_gradient.py` | `GatingPolicy`, `TraversalPolicy` | Neural policies (PyTorch) |
| `policy_gradient.py` | `PolicyGradientTrainer` | REINFORCE trainer |
| `single_step_trainer.py` | `SingleStepTrainer` | Single-step routing trainer (REINFORCE ottimizzato) |
| `ppo_trainer.py` | `PPOTrainer` | Proximal Policy Optimization (legacy) |
| `react_ppo_trainer.py` | `ReActPPOTrainer` | PPO per Expert multi-step reasoning |
| `policy_manager.py` | `PolicyManager` | Gestione versioni policy |

#### 8.3 Advanced Training
| File | Classe | Descrizione |
|------|--------|-------------|
| `replay_buffer.py` | `ExperienceReplayBuffer` | Experience replay per off-policy learning |
| `curriculum_learning.py` | `CurriculumScheduler` | Curriculum learning (query difficulty progression) |
| `off_policy_eval.py` | `OPEEvaluator` | Off-Policy Evaluation (IS, PDIS, DR) |

#### 8.4 Safety & Quality
| File | Classe | Descrizione |
|------|--------|-------------|
| `bias_detection.py` | `BiasDetector` | Rilevamento bias 6-dimensionale |
| `devils_advocate.py` | `DevilsAdvocateAssigner` | Assignment critica per quality assurance |

#### 8.5 External Integration
| File | Classe | Descrizione |
|------|--------|-------------|
| `external_feedback.py` | `ExternalFeedbackAdapter` | Adapter feedback da VisuaLex |
| `authority_sync.py` | `AuthoritySyncService` | Sincronizzazione authority scores |

#### 8.6 Persistence
| File | Classe | Descrizione |
|------|--------|-------------|
| `persistence.py` | `RLCFPersistence` | Storage traces/feedback in PostgreSQL |
| `persistence.py` | `RLCFTrace`, `RLCFFeedback` | Models per persistence |

#### 8.7 Simulation Framework
| File | Classe | Descrizione |
|------|--------|-------------|
| `simulator/experiment.py` | `RLCFExperiment` | Framework simulazione RLCF loop |
| `simulator/llm_judge.py` | `LLMJudge` | LLM-as-judge per feedback sintetico |
| `simulator/objective_metrics.py` | Objective metrics | Metriche oggettive (latency, etc.) |
| `simulator/statistics.py` | Statistical analysis | Analisi statistica risultati |

### Dipendenze
- PyTorch (policy gradient)
- PostgreSQL (persistence)
- OpenRouter (LLM calls)

### Entry Points
```python
from merlt.rlcf import RLCFOrchestrator, get_async_session
from merlt.rlcf.policy_gradient import GatingPolicy, PolicyGradientTrainer
from merlt.rlcf.single_step_trainer import SingleStepTrainer

# RLCF Orchestrator
orchestrator = RLCFOrchestrator()
await orchestrator.record_feedback(task_id, user_id, feedback)

# Policy Gradient Training (REINFORCE)
policy = GatingPolicy(input_dim=768)
trainer = PolicyGradientTrainer(policy)
metrics = trainer.update_from_feedback(trace, feedback)

# Single-Step Routing Training
ss_trainer = SingleStepTrainer(policy)
metrics = ss_trainer.update(trace, feedback)

# Experience Replay
from merlt.rlcf.replay_buffer import PrioritizedReplayBuffer
buffer = PrioritizedReplayBuffer(capacity=10000)
buffer.add(trace, feedback, reward, td_error=0.5)
batch, indices, weights = buffer.sample_with_priority(32)
```

---

## 9. merlt/benchmark/ - RAG Benchmarking

### Scopo
Framework sistematico per benchmark retrieval su knowledge graph giuridici.

### Componenti Chiave

| File | Componente | Descrizione |
|------|-----------|-------------|
| `metrics.py` | Metriche IR | Recall@K, MRR, Hit Rate, NDCG, Latency |
| `gold_standard.py` | `GoldStandard` | Dataset query annotate con expected results |
| `rag_benchmark.py` | `RAGBenchmark` | Framework benchmark completo |

**Metriche Implementate**:
- Recall@K, Precision@K
- MRR (Mean Reciprocal Rank)
- Hit Rate
- NDCG (Normalized Discounted Cumulative Gain)
- Graded Relevance (multi-level relevance)
- Latency metrics (p50, p95, p99)

### Dipendenze
- `merlt.storage.retriever` - Retrieval testing
- JSON files - Gold standard datasets

### Entry Points
```python
from merlt.benchmark import RAGBenchmark, GoldStandard

# Carica gold standard
gs = GoldStandard.from_file("gold_standard.json")

# Esegui benchmark
benchmark = RAGBenchmark(kg, gs)
results = await benchmark.run_full_benchmark()

print(f"Recall@5: {results.recall_at_5}")
print(f"MRR: {results.mrr}")
```

---

## 10. merlt/disagreement/ - Disagreement Detection

### Scopo
Sistema neurale per rilevamento, classificazione e spiegazione divergenze interpretative tra Expert.

**Fondamento Teorico**: Art. 12-14 Preleggi (canoni ermeneutici)

### Componenti Chiave

| File | Classe | Descrizione |
|------|--------|-------------|
| `types.py` | `DisagreementType`, `DisagreementLevel` | Tassonomia divergenze |
| `detector.py` | `LegalDisagreementNet` | Modello neurale multi-task |
| `encoder.py` | `LegalBertEncoder` | Encoder BERT con LoRA adapters |
| `heads.py` | `PredictionHeads` | 6 prediction heads multi-task |
| `trainer.py` | `DisagreementTrainer` | Training loop con curriculum learning |
| `loss.py` | `DisagreementLoss` | Loss function multi-task |
| `explainer.py` | `ExplainabilityModule` | Spiegazioni (Integrated Gradients, Attention) |
| `active_learning.py` | `ActiveLearningManager` | Active learning per annotation |

**Prediction Heads**:
1. Binary classification (has_disagreement)
2. Type classification (literal vs principles, etc.)
3. Level prediction (low/medium/high)
4. Expert pair conflict detection
5. Synthesis mode selection
6. Confidence estimation

### Dipendenze
- PyTorch, Transformers
- `merlt.experts` - Expert responses

### Entry Points
```python
from merlt.disagreement import analyze_expert_disagreement, LegalDisagreementNet

# Analisi disagreement
analysis = await analyze_expert_disagreement(
    query="Il venditore puo' recedere?",
    expert_responses={"literal": "...", "principles": "..."}
)

if analysis.has_disagreement:
    print(f"Tipo: {analysis.disagreement_type.label}")
    print(f"Level: {analysis.disagreement_level}")
    print(f"Synthesis mode: {analysis.synthesis_mode}")
```

---

## 11. merlt/models/ - Data Models

### Scopo
Dataclasses condivisi tra moduli per evitare dipendenze circolari.

### Componenti Chiave

| File | Model | Descrizione |
|------|-------|-------------|
| `mappings.py` | `BridgeMapping` | Mapping chunk ↔ node per bridge table |

**Convenzione**: Dataclasses generiche qui, modelli specifici nei rispettivi moduli.

---

## 12. merlt/config/ - Configurazione

### Scopo
Gestione configurazione multi-environment (dev, test, prod).

### Componenti Chiave

| File | Componente | Descrizione |
|------|-----------|-------------|
| `environments.py` | `TEST_ENV`, `PROD_ENV` | Configurazioni environment-specific |

**Environment Variables**:
```bash
# Database
POSTGRES_URL=postgresql://dev:devpassword@localhost:5433/rlcf_dev
FALKORDB_HOST=localhost
FALKORDB_PORT=6380
QDRANT_URL=http://localhost:6333

# LLM
OPENROUTER_API_KEY=...
DEFAULT_MODEL=anthropic/claude-3-5-sonnet

# Environment
ENVIRONMENT=dev  # dev | test | prod
```

---

## Diagramma Architettura Complessiva

```
┌─────────────────────────────────────────────────────────────────┐
│                     merlt.api (FastAPI)                         │
│  ingestion | feedback | auth | experts | enrichment | visualex  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              merlt.core.LegalKnowledgeGraph                     │
│  Orchestrazione Centrale: connect | ingest | search | interpret │
└──┬────────────────┬─────────────────┬─────────────────┬─────────┘
   │                │                 │                 │
   ▼                ▼                 ▼                 ▼
┌──────────┐  ┌──────────┐    ┌─────────────┐  ┌──────────────┐
│ sources  │  │ pipeline │    │   experts   │  │     rlcf     │
│          │  │          │    │             │  │              │
│Normattiva│  │Ingestion │    │MultiExpert  │  │  Authority   │
│Brocardi  │  │Parsing   │    │Orchestrator │  │  Feedback    │
│          │  │Chunking  │    │4 Experts    │  │PolicyGradient│
└─────┬────┘  └────┬─────┘    └──────┬──────┘  └──────┬───────┘
      │            │                 │                 │
      ▼            ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        merlt.storage                            │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ FalkorDB │  │  Qdrant  │  │PostgreSQL  │  │    Redis     │ │
│  │  Graph   │  │ Vectors  │  │Bridge Table│  │   Cache      │ │
│  └──────────┘  └──────────┘  └────────────┘  └──────────────┘ │
│                                                                 │
│  GraphAwareRetriever: Hybrid Semantic + Graph Retrieval        │
└─────────────────────────────────────────────────────────────────┘
           ▲
           │
      ┌────┴─────┐
      │  tools   │  Semantic Search, Hierarchy, Definition, etc.
      └──────────┘
```

---

## Database Schema Overview

### FalkorDB (Graph)
```cypher
(:Atto)-[:PARTE_DI]->(:Libro)-[:PARTE_DI]->(:Titolo)-[:PARTE_DI]->(:Articolo)
                                                                        |
                                                                   [:COMPOSTO_DA]
                                                                        ▼
                                                                   (:Comma)

(:Articolo)-[:RICHIAMA]->(:Articolo)
(:Articolo)-[:DERIVED_FROM {data_modifica}]->(:Articolo)
(:Articolo)-[:DEFINISCE {termine}]->(:Definizione)
```

### PostgreSQL
```sql
-- Bridge Table
bridge_table (chunk_id, node_urn, chunk_text, metadata)

-- RLCF
tasks (task_id, query, model_output, created_at)
feedback (feedback_id, task_id, user_id, score, comment)
authority_scores (user_id, domain, score)
policy_checkpoints (checkpoint_id, policy_state, metrics)
```

### Qdrant
```
Collection: merl_t_dev_chunks
Vector: 1024-dim (E5-large)
Payload: {chunk_id, node_urn, text, metadata}
```

---

## Testing Strategy

### Test Coverage
- **Unit tests**: `tests/` - 311+ test passing
- **Integration tests**: `tests/integration/` - Database reali (NO mock)
- **Benchmark tests**: `tests/benchmark/` - Gold standard validation

### Key Test Suites
```bash
pytest tests/storage/        # Storage layer
pytest tests/experts/        # Expert system
pytest tests/rlcf/          # RLCF framework
pytest tests/pipeline/      # Pipeline ETL
pytest tests/sources/       # Scrapers
```

---

## Deployment Stack

### Development (docker-compose.dev.yml)
```yaml
services:
  - postgres:5433
  - falkordb:6380 (+ Browser UI :3000)
  - qdrant:6333
  - redis:6379
```

### Production
- TBD - Deployment strategy da definire

---

## Conclusioni

MERL-T e' strutturata come una libreria componibile dove:
1. **Ogni modulo funziona standalone** (composabilita')
2. **Zero duplicazioni** (codice condiviso in merlt/)
3. **Scripts sono solo entry points** (logica in merlt/)
4. **API high-level semplici** (max 3 righe per operazione comune)

**Principio Guida**: "Scrivi come se stessi creando `pandas` o `requests`"
