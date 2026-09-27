# Storage Layer Architecture (v2)

**Version**: 2.0
**Status**: IN RIPROGETTAZIONE
**Last Updated**: Dicembre 2025

> **Nota**: Questo documento descrive l'architettura v2 con FalkorDB e Bridge Table.
> Per l'architettura v1 (Neo4j + storage separati), vedere `archive/v1-04-storage-layer.md`

---

## 1. Cambio di Paradigma: v1 vs v2

### Architettura v1 (Deprecata)

```
Storage Separati:
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  VectorDB   │  │   Neo4j     │  │ PostgreSQL  │
│  (Qdrant)   │  │   (Graph)   │  │  (RLCF)     │
└─────────────┘  └─────────────┘  └─────────────┘
      │                │                │
      └────── NO DEEP INTEGRATION ──────┘
```

**Problemi v1**:
- Vector e Graph non comunicano
- Retrieval "o semantico o strutturato", non entrambi
- Neo4j troppo lento per traversal complessi (496x vs FalkorDB)
- Nessun modo per "pesare" i risultati in base al grafo

### Architettura v2 (Nuova)

```
Storage Integrato con Bridge Table:
┌─────────────────────────────────────────────────────┐
│                    BRIDGE TABLE                      │
│      (Mappa chunk_id ↔ graph_node_id)               │
├─────────────────────────────────────────────────────┤
│                         │                            │
│      ┌──────────────────┼──────────────────┐        │
│      ▼                  │                  ▼        │
│ ┌─────────────┐         │         ┌─────────────┐  │
│ │  VectorDB   │◄────────┼────────►│  FalkorDB   │  │
│ │  (Qdrant)   │    Graph-Aware    │   (Graph)   │  │
│ │  Semantic   │    Similarity     │  Strutturato│  │
│ └─────────────┘                   └─────────────┘  │
│                         │                            │
│                         ▼                            │
│                  ┌─────────────┐                    │
│                  │ PostgreSQL  │                    │
│                  │ (RLCF, Auth)│                    │
│                  └─────────────┘                    │
└─────────────────────────────────────────────────────┘
```

**Vantaggi v2**:
- **FalkorDB**: 496x piu veloce di Neo4j per traversal
- **Bridge Table**: Integrazione profonda vector ↔ graph
- **Graph-Aware Similarity**: Ranking influenzato dalla struttura del grafo
- **Hybrid Retrieval**: Combina semantica + struttura in ogni query

---

## 2. FalkorDB: Knowledge Graph

### 2.1 Perche FalkorDB

| Aspetto | Neo4j | FalkorDB |
|---------|-------|----------|
| **Performance** | Baseline | 496x piu veloce |
| **Query Language** | Cypher | Cypher (compatibile) |
| **Memory Model** | Disk-based | In-memory + disk |
| **Licenza** | Enterprise (costosa) | Open Source |
| **Concorrenza** | Limitata | Redis-based (eccellente) |

**Benchmark** (da documentazione FalkorDB):
```
Query: 3-hop traversal su 1M nodi
- Neo4j: 496ms
- FalkorDB: 1ms

Query: Pattern matching complesso
- Neo4j: 2.3s
- FalkorDB: 4.7ms
```

### 2.2 Schema del Grafo (Hardcoded)

Lo schema del grafo e definito a priori basandosi su discussione accademica, **non generato da LLM**.

```
NODE TYPES (Principali)
================================================================

DOCUMENTI LEGALI:
- Norma (Costituzione, Legge, DL, D.Lgs, Regolamento)
- Versione (Temporal versions per multivigenza)
- Articolo, Comma, Lettera, Numero
- Sentenza (Cassazione, Corte Cost., TAR, etc.)
- Dottrina (Commentari, articoli)

ENTITA GIURIDICHE:
- Concetto (contratto, proprieta, responsabilita)
- Principio (buona fede, proporzionalita)
- Definizione (definizioni legali da norme)

RELAZIONI PROCESSUALI:
- Caso (fact pattern)
- Procedura (iter processuale)

RELAZIONE TYPES (65 tipologie, 11 categorie)
================================================================

GERARCHICHE:
- GERARCHIA_KELSENIANA (Costituzione → Legge → Regolamento)
- ABROGA, MODIFICA, SOSTITUISCE
- ATTUAZIONE, DELEGA

CITAZIONALI:
- CITA, RICHIAMA, RINVIA
- INTERPRETA, APPLICA

CONCETTUALI:
- DISCIPLINATO_DA (Concept → Norma)
- DEFINISCE, SPECIFICA
- RELAZIONE_CONCETTUALE (prerequisito, conseguenza, eccezione)

TEMPORALI:
- VALIDO_DA, VALIDO_FINO_A
- HA_VERSIONE

GIURISPRUDENZIALI:
- INTERPRETA (Sentenza → Norma)
- OVERRULES, DISTINGUISHES
- CONFERMA, RIBALTA
```

### 2.3 Cypher Queries Ottimizzate

```cypher
-- Pattern 1: Concept-to-Norm con versione corrente
MATCH (c:Concetto {id: $concept_id})-[:DISCIPLINATO_DA]->(n:Norma)
OPTIONAL MATCH (n)-[:HA_VERSIONE]->(v:Versione {is_current: true})
RETURN n, v
ORDER BY n.hierarchical_level DESC
LIMIT 10

-- Pattern 2: Traversal gerarchico
MATCH path = (parent:Norma)-[:GERARCHIA_KELSENIANA*1..3]->(child:Norma {id: $norm_id})
RETURN parent, length(path) AS distance
ORDER BY distance ASC

-- Pattern 3: Giurisprudenza interpretativa
MATCH (n:Norma {id: $norm_id})<-[:INTERPRETA]-(s:Sentenza)
WHERE s.court IN ['Cassazione', 'Corte Costituzionale']
RETURN s
ORDER BY s.date_published DESC
LIMIT 5

-- Pattern 4: Traversal pesato per expert (v2)
MATCH path = (start:Norma {id: $norm_id})-[r*1..3]-(related)
WHERE ALL(rel IN relationships(path) WHERE
    CASE type(rel)
        WHEN 'DEFINISCE' THEN $weight_definisce
        WHEN 'RINVIA' THEN $weight_rinvia
        WHEN 'INTERPRETA' THEN $weight_interpreta
        ELSE 0.5
    END > rand()  -- Probabilistic selection
)
RETURN related, reduce(s = 1.0, rel IN relationships(path) |
    s * CASE type(rel)
        WHEN 'DEFINISCE' THEN $weight_definisce
        WHEN 'RINVIA' THEN $weight_rinvia
        ELSE 0.5
    END
) AS path_score
ORDER BY path_score DESC
LIMIT 20
```

---

## 3. Bridge Table: Integrazione Vector-Graph

### 3.1 Concetto

La **Bridge Table** e il cuore dell'integrazione v2. Mappa ogni chunk vettoriale ai nodi del grafo corrispondenti.

```
┌─────────────────────────────────────────────────────────────┐
│                      BRIDGE TABLE                            │
├──────────────┬──────────────┬───────────────┬───────────────┤
│   chunk_id   │ graph_node_id│  relation_type │    weight    │
├──────────────┼──────────────┼───────────────┼───────────────┤
│  chunk_001   │  art_1453_cc │   PRIMARY      │    1.0       │
│  chunk_001   │  risoluzione │   CONCEPT      │    0.9       │
│  chunk_001   │  art_1454_cc │   REFERENCE    │    0.7       │
│  chunk_002   │  cass_2023_1 │   PRIMARY      │    1.0       │
│  chunk_002   │  art_1453_cc │   INTERPRETS   │    0.85      │
└──────────────┴──────────────┴───────────────┴───────────────┘
```

### 3.2 Schema SQL

```sql
CREATE TABLE bridge_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL,
    graph_node_id VARCHAR(200) NOT NULL,

    -- Tipo di relazione
    relation_type VARCHAR(50) NOT NULL,  -- PRIMARY, CONCEPT, REFERENCE, INTERPRETS

    -- Peso della relazione (apprendibile da RLCF)
    weight FLOAT DEFAULT 1.0,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Indici
    UNIQUE(chunk_id, graph_node_id, relation_type)
);

-- Indici per query veloci
CREATE INDEX idx_bridge_chunk ON bridge_table(chunk_id);
CREATE INDEX idx_bridge_node ON bridge_table(graph_node_id);
CREATE INDEX idx_bridge_relation ON bridge_table(relation_type);
CREATE INDEX idx_bridge_weight ON bridge_table(weight);

-- Funzione per aggiornare i pesi da RLCF
CREATE OR REPLACE FUNCTION update_bridge_weight(
    p_chunk_id UUID,
    p_node_id VARCHAR(200),
    p_delta FLOAT,
    p_authority FLOAT
) RETURNS VOID AS $$
BEGIN
    UPDATE bridge_table
    SET weight = GREATEST(0.0, LEAST(1.0, weight + p_delta * p_authority)),
        updated_at = NOW()
    WHERE chunk_id = p_chunk_id AND graph_node_id = p_node_id;
END;
$$ LANGUAGE plpgsql;
```

### 3.3 Costruzione della Bridge Table

```python
class BridgeTableBuilder:
    """
    Costruisce la Bridge Table durante l'ingestion.

    Per ogni chunk:
    1. Estrae entita (NER)
    2. Risolve entita a nodi nel grafo
    3. Calcola peso iniziale
    4. Inserisce in bridge_table
    """

    async def build_for_chunk(
        self,
        chunk: TextChunk,
        entities: List[Entity]
    ) -> List[BridgeEntry]:

        entries = []

        # PRIMARY: collegamento diretto al nodo sorgente
        if chunk.source_node_id:
            entries.append(BridgeEntry(
                chunk_id=chunk.id,
                graph_node_id=chunk.source_node_id,
                relation_type="PRIMARY",
                weight=1.0
            ))

        # CONCEPT: concetti estratti dal testo
        for entity in entities:
            if entity.type == "CONCEPT":
                node_id = await self.resolve_to_graph(entity)
                if node_id:
                    entries.append(BridgeEntry(
                        chunk_id=chunk.id,
                        graph_node_id=node_id,
                        relation_type="CONCEPT",
                        weight=entity.confidence
                    ))

        # REFERENCE: rinvii normativi
        for ref in chunk.norm_references:
            entries.append(BridgeEntry(
                chunk_id=chunk.id,
                graph_node_id=ref.target_urn,
                relation_type="REFERENCE",
                weight=0.7  # Default per riferimenti
            ))

        return entries
```

---

## 4. Graph-Aware Similarity Search

### 4.1 Concetto

Il **Graph-Aware Similarity Search** combina:
1. **Similarita Semantica**: cosine similarity tra embedding
2. **Prossimita nel Grafo**: distanza/connessione nel KG

```
Score_finale = α × Sim_semantica + (1-α) × Score_grafo
```

### 4.2 Implementazione

```python
class GraphAwareRetriever:
    """
    Retriever ibrido che combina vector similarity e graph structure.
    """

    def __init__(
        self,
        vector_db: Qdrant,
        graph_db: FalkorDB,
        bridge_table: BridgeTable,
        alpha: float = 0.7  # Peso semantico vs grafo
    ):
        self.vector_db = vector_db
        self.graph_db = graph_db
        self.bridge = bridge_table
        self.alpha = alpha

    async def retrieve(
        self,
        query_embedding: np.ndarray,
        context_nodes: List[str],  # Nodi di contesto (da NER query)
        top_k: int = 20,
        expert_type: str = None  # Per traversal weights
    ) -> List[RetrievalResult]:

        # STEP 1: Vector search (semantico)
        vector_results = await self.vector_db.search(
            query_embedding,
            top_k=top_k * 3  # Over-retrieve per re-ranking
        )

        # STEP 2: Graph enrichment (strutturale)
        enriched_results = []

        for vr in vector_results:
            # Trova nodi collegati al chunk
            linked_nodes = await self.bridge.get_nodes_for_chunk(vr.chunk_id)

            # Calcola graph score
            graph_score = await self._compute_graph_score(
                linked_nodes,
                context_nodes,
                expert_type
            )

            # Combina scores
            final_score = (
                self.alpha * vr.similarity_score +
                (1 - self.alpha) * graph_score
            )

            enriched_results.append(RetrievalResult(
                chunk_id=vr.chunk_id,
                text=vr.text,
                similarity_score=vr.similarity_score,
                graph_score=graph_score,
                final_score=final_score,
                linked_nodes=linked_nodes
            ))

        # STEP 3: Re-rank per final_score
        enriched_results.sort(key=lambda x: x.final_score, reverse=True)

        return enriched_results[:top_k]

    async def _compute_graph_score(
        self,
        chunk_nodes: List[str],
        context_nodes: List[str],
        expert_type: str = None
    ) -> float:
        """
        Calcola quanto il chunk e "vicino" al contesto nel grafo.
        """
        if not context_nodes:
            return 0.5  # Default se no context

        total_score = 0.0

        for chunk_node in chunk_nodes:
            for context_node in context_nodes:
                # Trova shortest path
                path = await self.graph_db.shortest_path(
                    chunk_node, context_node, max_hops=3
                )

                if path:
                    # Score basato su distanza + pesi relazioni
                    path_score = self._score_path(path, expert_type)
                    total_score = max(total_score, path_score)

        return total_score

    def _score_path(
        self,
        path: GraphPath,
        expert_type: str = None
    ) -> float:
        """
        Score di un path nel grafo.

        - Distanza: piu corto = meglio
        - Relazioni: alcune valgono di piu per certi expert
        """
        # Base: inverse distance
        distance_score = 1.0 / (len(path.edges) + 1)

        # Bonus per relazioni rilevanti
        relation_bonus = 1.0
        if expert_type:
            weights = EXPERT_TRAVERSAL_WEIGHTS.get(expert_type, {})
            for edge in path.edges:
                relation_bonus *= weights.get(edge.type, 0.5)

        return distance_score * relation_bonus
```

### 4.3 Esempio di Query Ibrida

```
Query: "Quali sono i termini per la risoluzione del contratto?"

STEP 1: Vector Search
───────────────────────────────────────────────────────
Top chunks per similarita semantica:
1. chunk_art1453 (Art. 1453 c.c.) - sim: 0.92
2. chunk_art1454 (Art. 1454 c.c.) - sim: 0.88
3. chunk_cass_2023 (Sentenza risoluzione) - sim: 0.85
4. chunk_art1455 (Art. 1455 c.c.) - sim: 0.83

STEP 2: Context Nodes (da NER)
───────────────────────────────────────────────────────
Entita estratte dalla query:
- "risoluzione" → Concetto: risoluzione_contratto
- "contratto" → Concetto: contratto
- "termini" → Concetto: termine_giuridico

STEP 3: Graph Score
───────────────────────────────────────────────────────
chunk_art1453:
  - Linked: art_1453_cc (PRIMARY)
  - Path a risoluzione_contratto: art_1453_cc -[DISCIPLINA]-> risoluzione_contratto
  - Path length: 1 → graph_score: 0.95

chunk_art1454:
  - Linked: art_1454_cc (PRIMARY)
  - Path a risoluzione_contratto: art_1454_cc -[SPECIFICA]-> art_1453_cc -[DISCIPLINA]-> risoluzione
  - Path length: 2 → graph_score: 0.80

chunk_cass_2023:
  - Linked: cass_2023_123 (PRIMARY)
  - Path a risoluzione_contratto: cass_2023_123 -[INTERPRETA]-> art_1453_cc -[DISCIPLINA]-> risoluzione
  - Path length: 2 → graph_score: 0.75

STEP 4: Final Score (α=0.7)
───────────────────────────────────────────────────────
1. chunk_art1453: 0.7×0.92 + 0.3×0.95 = 0.929
2. chunk_art1454: 0.7×0.88 + 0.3×0.80 = 0.856
3. chunk_cass_2023: 0.7×0.85 + 0.3×0.75 = 0.820
4. chunk_art1455: 0.7×0.83 + 0.3×0.65 = 0.776
```

---

## 5. Qdrant: Vector Database

### 5.1 Configurazione

```python
# Collection per legal chunks
LEGAL_CHUNKS_COLLECTION = {
    "name": "legal_chunks",
    "vectors_config": {
        "size": 1024,  # E5-large
        "distance": "Cosine"
    },
    "optimizers_config": {
        "memmap_threshold": 20000,  # Store on disk if > 20k vectors
        "indexing_threshold": 10000,  # Start indexing after 10k vectors
    },
    "hnsw_config": {
        "m": 16,  # Connections per layer
        "ef_construct": 128,  # Build quality
        "on_disk": False  # Keep index in RAM
    }
}
```

### 5.2 Metadata Schema

Ogni chunk in Qdrant ha metadata ricchi per filtering:

```python
class ChunkMetadata:
    """Metadata stored with each vector in Qdrant."""

    # Identificativi
    chunk_id: str
    document_id: str
    document_type: str  # norm, sentenza, dottrina

    # Temporali
    date_published: datetime
    date_effective: datetime
    is_current: bool

    # Classificazione
    legal_area: str  # civile, penale, amministrativo
    hierarchical_level: str  # Costituzione, Legge, Regolamento

    # Authority
    binding_force: float  # 0.0-1.0
    citation_count: int

    # Bridge links (per join veloce)
    primary_graph_node: str  # Nodo principale nel grafo
```

### 5.3 Query Patterns

```python
# Pattern 1: Search con filtri temporali
results = await qdrant.search(
    collection_name="legal_chunks",
    query_vector=query_embedding,
    query_filter=Filter(
        must=[
            FieldCondition(key="is_current", match=MatchValue(value=True)),
            FieldCondition(key="legal_area", match=MatchValue(value="civile"))
        ]
    ),
    limit=20
)

# Pattern 2: Search con range di date
results = await qdrant.search(
    collection_name="legal_chunks",
    query_vector=query_embedding,
    query_filter=Filter(
        must=[
            FieldCondition(
                key="date_effective",
                range=Range(gte="2020-01-01", lte="2024-12-31")
            )
        ]
    ),
    limit=20
)

# Pattern 3: Search per hierarchical level
results = await qdrant.search(
    collection_name="legal_chunks",
    query_vector=query_embedding,
    query_filter=Filter(
        must=[
            FieldCondition(
                key="hierarchical_level",
                match=MatchAny(any=["Costituzione", "Legge Costituzionale"])
            )
        ]
    ),
    limit=20
)
```

---

## 6. PostgreSQL: RLCF e Metadata

### 6.1 Schema per RLCF

```sql
-- Feedback multilivello (vedi 05-learning-layer.md)
CREATE TABLE multilevel_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id UUID REFERENCES queries(id),
    expert_user_id UUID REFERENCES users(id),
    domain VARCHAR(50),
    feedback_level VARCHAR(20),
    -- ... altri campi RLCF
);

-- Authority multilivello
CREATE TABLE user_authority_multilevel (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    authority_retrieval FLOAT DEFAULT 0.5,
    authority_reasoning FLOAT DEFAULT 0.5,
    authority_synthesis FLOAT DEFAULT 0.5,
    authority_domains JSONB DEFAULT '{}'
);

-- Pesi appresi (checkpoint)
CREATE TABLE learned_weights (
    id UUID PRIMARY KEY,
    checkpoint_name VARCHAR(100),
    traversal_weights JSONB,
    gating_weights BYTEA,
    reranker_weights BYTEA,
    validation_accuracy FLOAT,
    is_active BOOLEAN DEFAULT FALSE
);
```

### 6.2 Schema per Authentication

```sql
-- API Keys
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(64) NOT NULL,
    user_id UUID REFERENCES users(id),
    role VARCHAR(50) DEFAULT 'user',
    rate_limit_tier VARCHAR(20) DEFAULT 'standard',
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Usage tracking
CREATE TABLE api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES api_keys(id),
    endpoint VARCHAR(200),
    timestamp TIMESTAMP DEFAULT NOW(),
    response_time_ms INT,
    status_code INT
);
```

---

## 7. Data Ingestion Pipeline v2

### 7.1 Flow con Bridge Table

```
INGESTION FLOW v2
================================================================

1. DOCUMENTO INPUT (Normattiva, PDF, etc.)
   │
   ▼
2. PARSING
   │ Akoma Ntoso, PDF extraction
   │
   ▼
3. CHUNKING
   │ Semantic chunking per tipo documento
   │
   ▼
4. NER + ENTITY RESOLUTION
   │ Estrai entita, risolvi a nodi grafo
   │
   ▼
5. EMBEDDING GENERATION
   │ E5-large (1024 dims)
   │
   ▼
6. PARALLEL STORAGE
   │
   ├─► QDRANT: chunk + embedding + metadata
   │
   ├─► FALKORDB: nodi + relazioni (se nuovo)
   │
   └─► BRIDGE TABLE: chunk_id ↔ node_id mappings
```

### 7.2 Implementazione

```python
class IngestionPipelineV2:
    """
    Pipeline di ingestion con costruzione Bridge Table.
    """

    async def ingest_document(self, document: RawDocument) -> IngestionResult:
        # 1. Parse
        parsed = await self.parser.parse(document)

        # 2. Chunk
        chunks = await self.chunker.chunk(parsed)

        # 3. NER + Entity Resolution
        for chunk in chunks:
            entities = await self.ner.extract(chunk.text)
            resolved = await self.entity_resolver.resolve(entities)
            chunk.entities = resolved

        # 4. Generate embeddings (batch)
        embeddings = await self.embedder.embed_batch([c.text for c in chunks])

        # 5. Store in parallel
        await asyncio.gather(
            self._store_vectors(chunks, embeddings),
            self._store_graph_nodes(parsed, chunks),
            self._build_bridge_entries(chunks)
        )

        return IngestionResult(
            chunks_created=len(chunks),
            graph_nodes_created=self._count_new_nodes(),
            bridge_entries_created=self._count_bridge_entries()
        )

    async def _build_bridge_entries(self, chunks: List[Chunk]):
        """Costruisce le entry della Bridge Table."""
        entries = []

        for chunk in chunks:
            # PRIMARY link
            if chunk.source_urn:
                entries.append(BridgeEntry(
                    chunk_id=chunk.id,
                    graph_node_id=chunk.source_urn,
                    relation_type="PRIMARY",
                    weight=1.0
                ))

            # CONCEPT links
            for entity in chunk.entities:
                if entity.graph_node_id:
                    entries.append(BridgeEntry(
                        chunk_id=chunk.id,
                        graph_node_id=entity.graph_node_id,
                        relation_type="CONCEPT",
                        weight=entity.confidence
                    ))

            # REFERENCE links
            for ref in chunk.norm_references:
                entries.append(BridgeEntry(
                    chunk_id=chunk.id,
                    graph_node_id=ref.target_urn,
                    relation_type="REFERENCE",
                    weight=0.7
                ))

        await self.bridge_table.insert_batch(entries)
```

---

## 8. Aggiornamento Pesi da RLCF

### 8.1 Bridge Table Weights

I pesi nella Bridge Table sono **apprendibili** da RLCF:

```python
async def update_bridge_from_feedback(feedback: RetrievalFeedback):
    """
    Aggiorna i pesi della Bridge Table basandosi sul feedback.

    Se un chunk era rilevante per un certo nodo → aumenta peso
    Se un chunk era irrilevante → diminuisci peso
    """
    authority = feedback.expert_authority

    for chunk_id, relevance in feedback.chunk_relevance.items():
        for node_id in feedback.context_nodes:
            delta = 0.1 if relevance else -0.1

            await bridge_table.update_weight(
                chunk_id=chunk_id,
                node_id=node_id,
                delta=delta * authority
            )
```

### 8.2 Alpha Parameter Learning

Anche il parametro α (peso semantico vs grafo) e apprendibile:

```python
class AlphaLearner:
    """
    Apprende il parametro α ottimale per il retriever ibrido.

    Basato su feedback: se il graph score aiutava a trovare
    documenti rilevanti, aumenta (1-α).
    """

    def __init__(self, initial_alpha: float = 0.7):
        self.alpha = initial_alpha
        self.history = []

    def update(self, feedback: RetrievalFeedback):
        """
        Aggiorna α basandosi sul feedback.
        """
        # Se i chunk con alto graph_score erano rilevanti
        graph_helped = self._graph_correlation(feedback)

        if graph_helped > 0.5:
            # Aumenta peso grafo (diminuisci α)
            delta = -0.01 * feedback.expert_authority
        else:
            # Aumenta peso semantico (aumenta α)
            delta = 0.01 * feedback.expert_authority

        self.alpha = max(0.3, min(0.9, self.alpha + delta))
        self.history.append((self.alpha, graph_helped))
```

---

## 9. Docker Compose v2

```yaml
version: '3.8'

services:
  # FalkorDB (sostituisce Neo4j)
  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - "6379:6379"  # Redis protocol
    volumes:
      - falkordb_data:/data
    command: >
      --loadmodule /usr/lib/redis/modules/falkordb.so
    deploy:
      resources:
        limits:
          memory: 4G

  # Qdrant Vector DB
  qdrant:
    image: qdrant/qdrant:v1.7.0
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
    deploy:
      resources:
        limits:
          memory: 4G

  # PostgreSQL
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=merl_t
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=merl_t
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql

  # Redis (cache + rate limiting)
  redis:
    image: redis:7-alpine
    ports:
      - "6380:6379"  # Porta diversa da FalkorDB
    volumes:
      - redis_data:/data

volumes:
  falkordb_data:
  qdrant_data:
  postgres_data:
  redis_data:
```

---

## 10. Performance Target v2

| Operazione | Latenza Target | v1 | v2 |
|------------|---------------|----|----|
| Vector search (top-20) | < 100ms | 150ms | 80ms |
| Graph traversal (3-hop) | < 10ms | 496ms | 1ms |
| Hybrid retrieval | < 150ms | N/A | 120ms |
| Bridge lookup | < 5ms | N/A | 3ms |
| Full retrieval pipeline | < 200ms | 500ms | 150ms |

---

## 11. Roadmap Implementazione

### Fase 1: Setup FalkorDB (1 settimana)
- [ ] Deploy FalkorDB container
- [ ] Migrazione schema da Neo4j
- [ ] Test query Cypher

### Fase 2: Bridge Table (2 settimane)
- [ ] Schema PostgreSQL
- [ ] Builder durante ingestion
- [ ] Query functions

### Fase 3: Graph-Aware Retriever (2-3 settimane)
- [ ] `GraphAwareRetriever` class
- [ ] Integrazione con expert tools
- [ ] Alpha parameter learning

### Fase 4: RLCF Integration (1-2 settimane)
- [ ] Update pesi Bridge Table
- [ ] Feedback collection
- [ ] Metriche di validazione

---

**Changelog**:
- 2025-12-02: v2.0 - FalkorDB + Bridge Table + Hybrid Retrieval
- 2025-11-14: v1.0 - Neo4j + storage separati (ora in archive/)
