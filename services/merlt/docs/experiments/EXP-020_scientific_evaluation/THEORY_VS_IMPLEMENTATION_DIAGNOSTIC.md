# DIAGNOSTIC: Theory vs Implementation Gap Analysis

**Data**: 21 Dicembre 2025
**Trace Analizzato**: `trace_20251221_135427.json`

---

## Executive Summary

L'analisi del trace ha rivelato **tre bug critici** che impediscono al sistema di funzionare come da teoria:

| Bug | Severità | Impatto |
|-----|----------|---------|
| **Bridge Table ID Mismatch** | 🔴 CRITICO | `linked_nodes: []` sempre vuoto |
| **Graph Search Non Chiamato** | 🔴 CRITICO | 8 semantic_search, 0 graph_search |
| **Nessuna Esplorazione Iterativa** | 🟠 ALTO | Experts fanno 1-2 call, poi stop |

---

## 1. DATABASE STATUS (Verificato)

### 1.1 Qdrant (Vector DB)
```
Collection: merl_t_dev_chunks
Points: 5,926
Vector Size: 1024 (E5-large-v2)
ID Format: INTEGER (auto-generated)

Payload Keys:
- article_urn (es: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453")
- tipo_atto
- numero_articolo
- source_type (norma, massima, spiegazione, ratio)
- text

Source Type Distribution (sample 100):
- massima: 53
- spiegazione: 20
- norma: 15
- ratio: 12
```

### 1.2 FalkorDB (Graph DB)
```
Host: localhost:6380 (non 6379!)
Graph: merl_t_dev

Node Counts:
- AttoGiudiziario: 9,917
- Dottrina: 2,609
- ConcettoGiuridico: 2,571
- Comma: 1,798
- ModalitaGiuridica: 1,610
- Norma: 1,538
- EffettoGiuridico: 1,204
- Caso: 1,163
- FattoGiuridico: 1,142
- SoggettoGiuridico: 860
...

Relationship Counts (top 10):
- DISCIPLINA: 17,227
- interpreta: 11,343
- APPLICA_A: 3,888
- contiene: 2,846
- IMPONE: 2,818
- commenta: 2,609
- ESPRIME_PRINCIPIO: 740
- ATTRIBUISCE_RESPONSABILITA: 644
- PREVEDE: 569
- DEFINISCE: 498
```

### 1.3 PostgreSQL Bridge Table
```
Table: bridge_table
Total Mappings: 27,114

By Node Type:
- ConcettoGiuridico: 19,021
- Norma: 8,093

Unique chunk_ids: 2,313
Unique graph_node_urns: 12,869
```

---

## 2. BUG #1: Bridge Table ID Mismatch (CRITICO)

### Problema
Il retriever non trova MAI linked_nodes perché gli ID non matchano.

### Evidenza dal Trace
```json
{
  "similarity_score": 0.753,
  "graph_score": 0.5,          // ← SEMPRE 0.5 (default)
  "linked_nodes": [],          // ← SEMPRE VUOTO
}
```

### Root Cause Analysis

**Qdrant** usa ID interi:
```python
Point ID: 1613580867210727  # Integer!
```

**Bridge Table** usa UUID:
```sql
chunk_id: 89fbbca9-6996-441f-a380-6afc39d4d00a  # UUID string!
```

**Il Retriever** crea UUID finti con MD5:
```python
# retriever.py, linee 239-252
if isinstance(r.id, int):
    id_hash = hashlib.md5(str(r.id).encode()).hexdigest()
    chunk_id = UUID(id_hash[:8] + '-' + ...)  # MD5-derived UUID
```

**Risultato**:
```
Qdrant ID: 1613580867210727
MD5 UUID:  4793537a-be05-ff38-5b8e-d0bb8b4a1cb0  ← Mai in bridge_table!
Bridge ID: 89fbbca9-6996-441f-a380-6afc39d4d00a  ← ID originale
```

### Soluzione

**Opzione A (Consigliata)**: Usare `article_urn` invece di `chunk_id`

Qdrant payload contiene `article_urn` che matcha con `graph_node_urn` nella bridge_table:

```python
# Qdrant payload
article_urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"

# Bridge table
SELECT * FROM bridge_table WHERE graph_node_urn = $article_urn
```

**Verifica**: 10/10 URN da Qdrant esistono in bridge_table ✅

**Modifica richiesta** in `retriever.py`:
```python
# PRIMA (broken)
linked_nodes = await self.bridge.get_nodes_for_chunk(vr.chunk_id)

# DOPO (fix)
article_urn = vr.metadata.get("article_urn", "")
linked_nodes = await self.bridge.get_chunks_for_node(article_urn)
```

---

## 3. BUG #2: Graph Search Non Chiamato (CRITICO)

### Problema
Gli experts chiamano SOLO `semantic_search`, mai `graph_search`.

### Evidenza dal Trace
```json
{
  "tool_calls": [
    {"tool": "semantic_search", "expert": "literal"},
    {"tool": "semantic_search", "expert": "systemic"},
    {"tool": "semantic_search", "expert": "principles"},
    {"tool": "semantic_search", "expert": "precedent"},
    {"tool": "semantic_search", "expert": "literal"},
    {"tool": "semantic_search", "expert": "systemic"},
    {"tool": "semantic_search", "expert": "principles"},
    {"tool": "semantic_search", "expert": "precedent"}
  ]
}
// 8 semantic_search, 0 graph_search!
```

### Root Cause

In `literal.py` (e altri experts):
```python
async def _retrieve_sources(self, context: ExpertContext) -> List[Dict[str, Any]]:
    # SOLO semantic_search
    semantic_tool = self._tool_registry.get("semantic_search")
    if semantic_tool:
        result = await semantic_tool(...)

    # graph_search: presente nel codice ma MAI eseguito!
    graph_tool = self._tool_registry.get("graph_search")
    if graph_tool and context.norm_references:  # ← norm_references è VUOTO
        # Questo blocco non viene mai eseguito
```

`context.norm_references` è sempre vuoto perché il NER/parsing non estrae URN dalla query.

### Teoria (da expert-tools-rlcf-plan.md)

Ogni expert dovrebbe avere tools specializzati:

| Expert | Tools Teorici | Tools Attuali |
|--------|---------------|---------------|
| LiteralExpert | GetExactText, ParseCommi, FollowRinvii | semantic_search |
| SystemicExpert | GetSystemContext, GetLegislativeHistory | semantic_search |
| PrinciplesExpert | GetRatioLegis, GetDottrina | semantic_search |
| PrecedentExpert | SearchMassime, GetCitationChain | semantic_search |

### Soluzione

1. **Implementare estrazione URN dalla query**:
   ```python
   def extract_norm_references(query: str) -> List[str]:
       # "Art. 1453 c.c." → ["urn:nir:stato:codice.civile:art1453"]
   ```

2. **Chiamare graph_search incondizionatamente**:
   ```python
   # Cerca sempre nodi correlati dopo semantic_search
   if graph_tool:
       for source in semantic_results:
           urn = source.get("article_urn")
           graph_result = await graph_tool(start_node=urn, ...)
   ```

---

## 4. BUG #3: Nessuna Esplorazione Iterativa (ALTO)

### Problema
Gli experts fanno 1-2 chiamate e poi generano risposta, senza esplorare.

### Evidenza dal Trace

Per ogni expert:
1. 1x semantic_search
2. 1x LLM call
3. Fine

Totale: 8 tool calls, 4 LLM calls per 4 experts.

### Teoria (da PLANNING)

Ogni expert dovrebbe:
1. Fare semantic_search iniziale
2. Esaminare risultati
3. **Seguire riferimenti** (rinvii normativi, citazioni)
4. **Espandere** verso nodi correlati nel grafo
5. **Iterare** fino a convergenza o limite
6. Solo poi generare interpretazione

### Soluzione

Implementare loop di esplorazione:
```python
async def explore_iteratively(self, context, max_iterations=3):
    explored_urns = set()
    all_sources = []

    for iteration in range(max_iterations):
        # 1. Semantic search
        new_sources = await self.semantic_search(...)
        all_sources.extend(new_sources)

        # 2. Estrai URN non ancora esplorati
        urns_to_explore = [s['article_urn'] for s in new_sources
                          if s['article_urn'] not in explored_urns]

        if not urns_to_explore:
            break  # Convergenza

        # 3. Graph expansion
        for urn in urns_to_explore[:5]:
            explored_urns.add(urn)
            graph_result = await self.graph_search(start_node=urn, ...)
            all_sources.extend(graph_result['nodes'])

    return all_sources
```

---

## 5. Flusso Teorico vs Attuale

### Flusso Teorico (da Documentazione)

```
Query → NER (estrai articoli citati)
     → Routing (seleziona experts)
     → Per ogni Expert:
        → semantic_search (top-k chunks)
        → bridge_table (chunk → graph nodes)
        → graph_search (espandi nodi)
        → iterative exploration
        → LLM interpretation
     → Aggregation (combina interpretazioni)
     → Response
```

### Flusso Attuale (da Trace)

```
Query → Routing (mock, tutti gli experts)
     → Per ogni Expert:
        → semantic_search (1 call)
        → bridge_table (FALLISCE - ID mismatch)
        → graph_search (MAI chiamato)
        → LLM interpretation (fonti incomplete)
     → Aggregation
     → Response
```

---

## 6. Piano di Fix

### Priorità 1: Fix Graph Enrichment ✅ COMPLETATO (21 Dic 2025)
- [x] Aggiunto metodo `get_related_nodes_for_article(urn)` a FalkorDBClient
- [x] Modificato `retriever.py` per usare FalkorDB invece di bridge_table
- [x] Modificato `hybrid.py` con lo stesso fix
- [x] Testato: Art.1453 → 20 nodi correlati, Art.1350 → 20 nodi correlati

**File modificati:**
- `merlt/storage/graph/client.py` - Nuovo metodo `get_related_nodes_for_article()`
- `merlt/storage/retriever/retriever.py` - Usa graph_db per linked_nodes
- `merlt/storage/retriever/hybrid.py` - Stesso fix

### Priorità 2: Fix Graph Search ✅ COMPLETATO (21 Dic 2025)
- [x] Implementato `query_analyzer.py` per estrazione URN/entità da query
- [x] Integrato query_analyzer in `orchestrator.py` (Step 1 del pipeline)
- [x] Modificato tutti gli expert per estrarre URN da semantic_search results
- [x] graph_search chiamato usando URN estratti (non solo da context.norm_references)

**File modificati:**
- `merlt/experts/query_analyzer.py` - Nuovo modulo per NER
- `merlt/experts/orchestrator.py` - Integrazione query_analyzer
- `merlt/experts/literal.py` - Estrazione URN + graph expansion
- `merlt/experts/systemic.py` - Estrazione URN + graph expansion
- `merlt/experts/principles.py` - Estrazione URN + graph expansion
- `merlt/experts/precedent.py` - Estrazione URN + graph expansion

### Priorità 3: Esplorazione Iterativa ✅ COMPLETATO (21 Dic 2025)
- [x] Implementato `explore_iteratively()` in BaseExpert
- [x] Convergenza automatica quando nessuna nuova fonte trovata
- [x] Max iterations configurabile (default: 3)
- [x] Logging dettagliato per ogni iterazione
- [x] Metriche esplorazione per RLCF feedback

**Nuovo metodo in `merlt/experts/base.py`:**
```python
async def explore_iteratively(
    self,
    context: ExpertContext,
    max_iterations: int = 3,
    source_types: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
```

### Priorità 4: RLCF Feedback Hooks ✅ COMPLETATO (21 Dic 2025)
- [x] Implementato `record_feedback()` in BaseExpert
- [x] Calcolo automatico suggerimenti aggiornamento pesi
- [x] `apply_weight_updates()` per applicare apprendimento
- [x] `get_feedback_summary()` per dashboard RLCF

**Nuovi metodi in `merlt/experts/base.py`:**
- `record_feedback(response, user_rating, feedback_type)` - Registra feedback
- `_compute_weight_updates()` - Calcola delta pesi
- `apply_weight_updates(updates)` - Applica aggiornamenti
- `get_feedback_summary()` - Riepilogo feedback

### Priorità 5: Tools Specializzati (Future)
- [ ] LiteralExpert: GetDefinitions, FollowReferences
- [ ] SystemicExpert: GetHierarchy, GetModifications
- [ ] PrinciplesExpert: GetRatioLegis
- [ ] PrecedentExpert: GetCitationChain

---

## 7. Metriche Target

| Metrica | Attuale | Target |
|---------|---------|--------|
| linked_nodes popolati | 0% | 90%+ |
| graph_score != 0.5 | 0% | 80%+ |
| graph_search calls | 0 | 2-4 per expert |
| Iterazioni per expert | 1 | 2-3 |
| Source grounding rate | ~50% | 95%+ |

---

## Appendice: Query di Verifica

### Verificare Bridge Table Fix
```python
# Dopo il fix, questo deve tornare risultati
article_urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"
linked = await bridge.get_chunks_for_node(article_urn)
print(f"Linked concepts: {len(linked)}")  # Deve essere > 0
```

### Verificare Graph Search
```python
# Dopo il fix, questo deve apparire nel trace
tool_calls = [t for t in trace['tool_calls'] if t['tool'] == 'graph_search']
print(f"Graph search calls: {len(tool_calls)}")  # Deve essere > 0
```
