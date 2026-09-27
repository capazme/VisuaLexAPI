# MERL-T Library Architecture

> **Visione**: Una libreria Python che i giuristi-programmatori useranno per costruire il codice civile digitale del futuro.

---

## Stato Attuale: Core Implementato

### Core Library (`merlt/core/`)
```python
from merlt import LegalKnowledgeGraph, MerltConfig

# Configurazione
config = MerltConfig(
    falkordb_host="localhost",
    falkordb_port=6380,
    graph_name="merl_t_test",
    qdrant_host="localhost",
    qdrant_port=6333,
    postgres_url="postgresql://...",  # optional
)

# Inizializzazione
kg = LegalKnowledgeGraph(config)
await kg.connect()

# Ingestion unificata (graph + embeddings + bridge + multivigenza)
result = await kg.ingest_norm(
    tipo_atto="codice penale",
    articolo="1",
    include_brocardi=True,
    include_embeddings=True,
    include_bridge=True,
    include_multivigenza=True,
)

# Search ibrida
results = await kg.search(
    "Cos'è la legittima difesa?",
    top_k=5,
    include_graph_context=True,
)

await kg.close()
```

---

## Architettura Componenti

```
merlt/
├── core/                          # 🆕 NUOVO: Orchestrazione
│   ├── __init__.py
│   └── legal_knowledge_graph.py   # LegalKnowledgeGraph, MerltConfig
│
├── storage/                       # Storage Layer
│   ├── falkordb/                  # ✅ FalkorDBClient
│   ├── bridge/                    # ✅ BridgeTable, BridgeBuilder
│   └── retriever/                 # ✅ GraphAwareRetriever
│
├── pipeline/                      # Processing Pipelines
│   ├── ingestion.py               # ✅ IngestionPipelineV2
│   ├── multivigenza.py            # ✅ MultivigenzaPipeline
│   ├── parsing.py                 # ✅ CommaParser
│   └── chunking.py                # ✅ StructuralChunker
│
├── orchestration/services/        # Services
│   └── embedding_service.py       # ✅ EmbeddingService (E5-large)
│
└── external_sources/visualex/     # Data Sources
    ├── scrapers/
    │   ├── normattiva_scraper.py  # ✅ Testi ufficiali
    │   └── brocardi_scraper.py    # ✅ Enrichment
    └── tools/
        ├── norma.py               # ✅ NormaVisitata, Modifica
        ├── urngenerator.py        # ✅ URN generation
        └── treextractor.py        # ✅ Gerarchia
```

---

## Flow di Ingestion Unificato

```
kg.ingest_norm()
    │
    ├─1─> NormattivaScraper.fetch_document()     # Testo ufficiale
    │
    ├─2─> BrocardiScraper.get_info()             # Enrichment (optional)
    │
    ├─3─> IngestionPipelineV2.ingest_article()   # Graph nodes + chunks
    │        │
    │        ├── CommaParser.parse()
    │        ├── StructuralChunker.chunk()
    │        └── FalkorDB.query() → Norma, Dottrina, AttoGiudiziario
    │
    ├─4─> BridgeBuilder.insert_mappings()        # Bridge table (optional)
    │
    ├─5─> EmbeddingService + Qdrant.upsert()     # Vectors (optional)
    │
    └─6─> MultivigenzaPipeline.ingest_with_history()  # Amendments (optional)
             │
             └── :modifica, :abroga, :sostituisce, :inserisce
```

---

## UnifiedIngestionResult

```python
@dataclass
class UnifiedIngestionResult:
    article_urn: str
    article_url: str

    # Graph
    nodes_created: List[str]
    relations_created: List[str]
    brocardi_enriched: bool

    # Embeddings
    chunks_created: int
    embeddings_upserted: int

    # Bridge
    bridge_mappings_inserted: int

    # Multivigenza
    modifiche_count: int
    atti_modificanti_created: List[str]
    multivigenza_relations: List[str]

    # Errors
    errors: List[str]
```

---

## Prossimi Passi

### Completati
- [x] Creare `merlt/core/legal_knowledge_graph.py`
- [x] Integrare Bridge Table nel flow
- [x] Integrare EmbeddingService nel flow
- [x] Integrare MultivigenzaPipeline nel flow

### Da Fare
1. **Test end-to-end** con Codice Penale
2. **Batch ingestion** - `kg.ingest_batch()` per libri interi
3. **Export per training** - `kg.export_training_data()`
4. **Package `merlt`** - pyproject.toml per distribuzione

---

## Utilizzo Consigliato

### Per scripts di ingestion
```python
# Invece di logica custom in scripts/
from merlt import LegalKnowledgeGraph, MerltConfig

async def main():
    kg = LegalKnowledgeGraph()
    await kg.connect()

    articles = ["1", "2", "3", "4"]
    for art in articles:
        result = await kg.ingest_norm(
            tipo_atto="codice penale",
            articolo=art,
        )
        print(f"Art. {art}: {result.summary()}")

    await kg.close()
```

### Per ricerca
```python
results = await kg.search("Quando si applica la legittima difesa?")
for r in results:
    print(f"{r['numero_articolo']}: {r['text'][:100]}...")
```

---

*Ultimo aggiornamento: 2025-12-08*
