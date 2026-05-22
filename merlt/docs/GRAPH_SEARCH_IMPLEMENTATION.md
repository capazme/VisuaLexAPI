# Graph Search Endpoint Implementation

> **Date**: 2026-01-07
> **Status**: Implemented
> **Location**: `merlt/api/graph_router.py:1078-1424`

---

## Overview

Implementato endpoint `POST /api/v1/graph/search` per ricerca semantica nel knowledge graph, come specificato in `docs/INTEGRATION_ANALYSIS_ACADEMIC.md` (Section 9).

---

## Endpoint Details

### Request

```http
POST /api/v1/graph/search
Content-Type: application/json

{
  "query": "responsabilità del debitore",
  "filters": {
    "entity_types": ["principio", "concetto"],
    "relation_types": ["DISCIPLINA", "ESPRIME_PRINCIPIO"]
  },
  "limit": 10
}
```

### Response

```json
{
  "subgraph": {
    "nodes": [
      {
        "id": "urn:nir:stato:codice.civile:1942;art1218",
        "urn": "urn:nir:stato:codice.civile:1942;art1218",
        "type": "Article",
        "label": "Art. 1218 - Responsabilità del debitore",
        "properties": {...},
        "metadata": {...}
      },
      ...
    ],
    "edges": [
      {
        "id": "urn:...-DISCIPLINA-principio:abc123",
        "source": "urn:...",
        "target": "principio:abc123",
        "type": "DISCIPLINA",
        "properties": {}
      },
      ...
    ],
    "metadata": {
      "total_nodes": 5,
      "total_edges": 8,
      "depth_reached": 1,
      "root_node_id": "urn:...",
      "query_time_ms": 125.45
    }
  },
  "relevance_scores": {
    "urn:nir:stato:codice.civile:1942;art1218": 0.92,
    "principio:abc123": 0.87,
    ...
  },
  "query_time_ms": 125.45
}
```

---

## Architecture

### Flow

```
1. Encode Query
   ├─ EmbeddingService.encode_query_async()
   └─ Produce query vector (1024 dims)

2. Vector Search (Qdrant)
   ├─ Search in "merl_t_dev_chunks" collection
   ├─ Over-retrieve (limit * 3) for better coverage
   ├─ Apply entity_type filter if specified
   └─ Return top chunks with similarity scores

3. Map Chunks → Graph Nodes
   ├─ BridgeTable.get_nodes_for_chunks()
   ├─ Compute relevance = similarity * mapping_confidence
   └─ Aggregate max relevance per node URN

4. Fetch Subgraph (FalkorDB)
   ├─ MATCH nodes by URN list
   ├─ OPTIONAL MATCH connected nodes and relations
   ├─ Apply relation_type filter if specified
   └─ Parse nodes and edges

5. Re-rank and Filter
   ├─ Sort nodes by relevance DESC
   ├─ Take top N nodes (request.limit)
   ├─ Keep only edges where both endpoints are in top N
   └─ Return subgraph + relevance scores
```

### Components Used

| Component | Purpose | File |
|-----------|---------|------|
| `EmbeddingService` | Query encoding (E5-large) | `merlt/storage/vectors/embeddings.py` |
| `QdrantClient` | Vector similarity search | External (qdrant-client) |
| `BridgeTable` | Chunk → Node mapping | `merlt/storage/bridge/bridge_table.py` |
| `FalkorDBClient` | Graph traversal | `merlt/storage/graph/client.py` |
| `SubgraphResponse` | Response model | `merlt/api/graph_router.py:772-777` |

---

## Features

### 1. Semantic Search

- Usa embeddings E5-large per similarity search
- Over-retrieve (3x) per coverage, poi re-rank
- Combina similarity score con mapping confidence

### 2. Filters

#### Entity Type Filter

```json
{
  "filters": {
    "entity_types": ["principio", "concetto", "definizione"]
  }
}
```

- Filtra nodi per tipo di entità
- `Norma` e `Article` sempre inclusi (root nodes)

#### Relation Type Filter

```json
{
  "filters": {
    "relation_types": ["DISCIPLINA", "ESPRIME_PRINCIPIO", "CITES"]
  }
}
```

- Filtra relazioni per tipo
- Esclude edge non richiesti dal subgraph

#### Date Range (Reserved)

```json
{
  "filters": {
    "date_range": {
      "start": "2020-01-01",
      "end": "2025-12-31"
    }
  }
}
```

- Campo riservato per future implementazioni
- Non ancora utilizzato nel Cypher query

### 3. Relevance Scoring

```python
relevance = similarity_score * mapping_confidence
```

- `similarity_score`: da Qdrant vector search (0.0-1.0)
- `mapping_confidence`: da Bridge Table (es. 1.0 per PRIMARY, 0.9 per HIERARCHIC)
- Max relevance per node (chunks multipli → stesso node)

### 4. Subgraph Construction

- Ritorna top N nodi per relevance
- Include solo edge tra nodi nel top N
- Metadata: nodes count, edges count, query time

---

## Configuration

### Environment Variables

```bash
# Qdrant
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=merl_t_dev_chunks

# Embedding Model
EMBEDDING_MODEL=intfloat/multilingual-e5-large
EMBEDDING_DEVICE=cuda  # or cpu

# Database
DATABASE_URL=postgresql://...  # For BridgeTable
FALKORDB_HOST=localhost
FALKORDB_PORT=6380
```

### Defaults

- `limit`: 1-50 (default 10)
- `over_retrieve_factor`: 3x
- `max_results` (Cypher): `limit * 10`

---

## Error Handling

### Empty Results

```json
{
  "subgraph": {
    "nodes": [],
    "edges": [],
    "metadata": {
      "total_nodes": 0,
      "total_edges": 0,
      "depth_reached": 0,
      "root_node_id": "",
      "query_time_ms": 45.23
    }
  },
  "relevance_scores": {},
  "query_time_ms": 45.23
}
```

Ritorna response vuota se:
- Nessun risultato da Qdrant
- Nessun mapping in Bridge Table
- Nessun node in FalkorDB

### Exceptions

```python
try:
    # ... search logic
except Exception as e:
    log.error(f"Graph search failed: {e}", query=request.query, exc_info=True)
    raise HTTPException(status_code=500, detail=f"Graph search failed: {str(e)}")
```

- Log errori con `structlog`
- HTTPException 500 con messaggio
- Client disconnection automatica (finally blocks)

---

## Testing

### Test Script

```bash
python scripts/test_graph_search.py
```

Testa:
1. Basic search (no filters)
2. Entity type filtering
3. Relation type filtering
4. Complex query con multiple filters
5. Empty results handling

### Manual Test

```bash
curl -X POST http://localhost:8000/api/v1/graph/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "responsabilità del debitore",
    "limit": 5
  }'
```

---

## Integration with VisuaLex

### Frontend Usage

```typescript
// VisuaLex GraphViewer integration
import { useGraphSearch } from '@/hooks/useGraphSearch';

const { data, loading, error } = useGraphSearch({
  query: "responsabilità contrattuale",
  filters: {
    entity_types: ["principio", "concetto"]
  },
  limit: 10
});

// Render with GraphViewer
<GraphViewer
  nodes={data.subgraph.nodes}
  edges={data.subgraph.edges}
  relevanceScores={data.relevance_scores}
/>
```

### Expected Frontend Implementation

1. **Search Input**: Natural language query box
2. **Filter Panel**: Checkboxes per entity_types, relation_types
3. **Graph Canvas**: React-force-graph-2d con subgraph
4. **Relevance Heatmap**: Color nodes by relevance score
5. **Detail Panel**: Click node → properties + metadata

---

## Performance Considerations

### Current Metrics (Estimated)

- **Query encoding**: ~50ms (CPU) / ~10ms (GPU)
- **Qdrant search**: ~30-100ms (depends on collection size)
- **Bridge lookup**: ~20-50ms (PostgreSQL)
- **FalkorDB traversal**: ~50-150ms (depends on subgraph size)
- **Total**: ~150-350ms per search

### Optimization Opportunities

1. **Cache embeddings**: Frequent queries → Redis cache
2. **Connection pooling**: BridgeTable + FalkorDB
3. **Batch processing**: Multiple queries in parallel
4. **Index optimization**: Qdrant HNSW params, FalkorDB indexes

---

## Future Enhancements

### 1. Date Range Filter Implementation

```python
# Add to Cypher query
if request.filters and request.filters.date_range:
    date_filter = f"""
    AND n.data_pubblicazione >= '{request.filters.date_range["start"]}'
    AND n.data_pubblicazione <= '{request.filters.date_range["end"]}'
    """
```

### 2. Multi-hop Traversal

```python
# Depth > 1 support
if depth > 1:
    cypher = f"""
    MATCH (n)-[*1..{depth}]-(connected)
    WHERE n.URN IN $urns
    RETURN ...
    """
```

### 3. Hybrid Scoring

```python
# Combine vector + graph scores (à la GraphAwareRetriever)
hybrid_score = alpha * similarity + (1 - alpha) * graph_score
```

### 4. Query Expansion

```python
# Expand query con sinonimi giuridici
expanded_query = expand_legal_terms(request.query)
query_vector = embedding_service.encode_query_async(expanded_query)
```

---

## Related Files

### Implementation

- `merlt/api/graph_router.py:1053-1424` - Main endpoint
- `merlt/api/graph_router.py:1057-1061` - GraphSearchFilters model
- `merlt/api/graph_router.py:1064-1068` - GraphSearchRequest model
- `merlt/api/graph_router.py:1071-1075` - GraphSearchResponse model

### Dependencies

- `merlt/storage/vectors/embeddings.py` - EmbeddingService
- `merlt/storage/bridge/bridge_table.py` - BridgeTable
- `merlt/storage/graph/client.py` - FalkorDBClient
- `merlt/api/graph_router.py:772-777` - SubgraphResponse (reused)

### Tests

- `scripts/test_graph_search.py` - Integration test script

### Documentation

- `docs/INTEGRATION_ANALYSIS_ACADEMIC.md:68-87` - Original requirements
- `docs/GRAPH_SEARCH_IMPLEMENTATION.md` - This document

---

## Changelog

### 2026-01-07 - Initial Implementation

- ✅ POST /graph/search endpoint
- ✅ Semantic search con EmbeddingService
- ✅ Entity type filtering
- ✅ Relation type filtering
- ✅ Relevance scoring (similarity * mapping_confidence)
- ✅ Subgraph construction con top N nodes
- ✅ Error handling graceful
- ✅ Test script completo
- ✅ Documentation completa

### Future TODOs

- [ ] Date range filter implementation
- [ ] Multi-hop traversal (depth > 1)
- [ ] Hybrid scoring (vector + graph)
- [ ] Query expansion con sinonimi
- [ ] Frontend integration (VisuaLex)
- [ ] Performance benchmarks
- [ ] Caching layer (Redis)
- [ ] Connection pooling

---

*Implementazione completata secondo specifiche INTEGRATION_ANALYSIS_ACADEMIC.md Section 9.*
