# MERL-T Pipeline Analysis: Teoria vs Implementazione

> **Data**: 21 Dicembre 2025
> **Trace analizzato**: `trace_20251221_132519.json`
> **Query**: "Come funziona la risoluzione per inadempimento?"

---

## 1. ARCHITETTURA TEORICA (da docs/)

### 1.1 Multi-Expert System (Art. 12 Preleggi)

Ogni Expert dovrebbe avere:
- **Query specializzata** per il proprio canone ermeneutico
- **Source type filter** diverso
- **Traversal weights** (θ_traverse) specifici
- **Tools dedicati** per il proprio approccio

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ARCHITETTURA TEORICA                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LITERAL EXPERT                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│  Canone: "Significato proprio delle parole"                        │
│  Source filter: source_type = "norma"                               │
│  Tools: semantic_search(norma) + GetExactText + ParseCommi         │
│  Traversal: contiene (1.0), cita (0.9)                             │
│                                                                     │
│  SYSTEMIC EXPERT                                                    │
│  ─────────────────────────────────────────────────────────────────  │
│  Canone: "Connessione tra norme"                                   │
│  Source filter: source_type = "norma" + graph traversal            │
│  Tools: graph_search(modifica/abroga/contiene) + GetSystemContext  │
│  Traversal: modifica (0.9), abroga (1.0), parte_di (0.8)          │
│                                                                     │
│  PRINCIPLES EXPERT                                                  │
│  ─────────────────────────────────────────────────────────────────  │
│  Canone: "Principi generali"                                       │
│  Source filter: source_type IN ("spiegazione", "ratio")            │
│  Tools: semantic_search(ratio) + GetDottrina + GetRatioLegis       │
│  Traversal: commenta (1.0), bilancia (0.95)                        │
│                                                                     │
│  PRECEDENT EXPERT                                                   │
│  ─────────────────────────────────────────────────────────────────  │
│  Canone: "Diritto vivente"                                         │
│  Source filter: source_type = "massima"                             │
│  Tools: semantic_search(massima) + graph_search(interpreta)        │
│  Traversal: interpreta (1.0), precedente_di (1.0)                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Workflow Teorico End-to-End

```
Query
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: ROUTING (ExpertRouter)                                      │
├─────────────────────────────────────────────────────────────────────┤
│ Input: query_text, query_embedding                                  │
│ Output: expert_weights = {literal: 0.35, systemic: 0.25, ...}      │
│ Logica: Classifica query → Assegna pesi a expert                   │
└─────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: RETRIEVAL SPECIALIZZATO (per ogni expert)                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ LiteralExpert:                                                      │
│   └─ semantic_search(query, source_type="norma", top_k=5)          │
│                                                                     │
│ SystemicExpert:                                                     │
│   ├─ semantic_search(query, source_type="norma", top_k=3)          │
│   └─ graph_search(start_nodes, relations=["modifica","abroga"])    │
│                                                                     │
│ PrinciplesExpert:                                                   │
│   ├─ semantic_search(query, source_type=["ratio","spiegazione"])   │
│   └─ graph_search(relations=["commenta"])                          │
│                                                                     │
│ PrecedentExpert:                                                    │
│   ├─ semantic_search(query, source_type="massima", top_k=5)        │
│   └─ graph_search(relations=["interpreta"])                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: EXPERT REASONING (LLM per ogni expert)                     │
├─────────────────────────────────────────────────────────────────────┤
│ Input: retrieval_results (SOLO quelli recuperati)                  │
│ Constraint: SOURCE OF TRUTH - non inventare fonti                  │
│ Output: ExpertResponse con interpretation, sources, confidence     │
└─────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: AGGREGATION (GatingNetwork)                                │
├─────────────────────────────────────────────────────────────────────┤
│ Input: 4 ExpertResponse + expert_weights                           │
│ Logica: Pesatura, conflict detection, sintesi                      │
│ Output: AggregatedResponse con synthesis, confidence               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. STATO ATTUALE (da trace)

### 2.1 Database Info

| Componente | Valore | Status |
|------------|--------|--------|
| FalkorDB nodes | 27,740 | ✅ Popolato |
| FalkorDB relations | 43,935 | ✅ Popolato |
| Qdrant points | 5,926 | ✅ Popolato |
| Bridge mappings | 27,114 | ✅ Popolato |

### 2.2 Tool Calls Osservati

```
Expert       | Tool            | Results | Note
-------------|-----------------|---------|------------------
literal      | semantic_search | 5       | ❌ Nessun filtro source_type
systemic     | semantic_search | 5       | ❌ Nessun graph_search!
principles   | semantic_search | 5+3+3   | ⚠️ 3 chiamate ma stessi dati
precedent    | semantic_search | 5+3+3   | ❌ Nessun graph_search!
```

### 2.3 Problemi Critici Identificati

| Problema | Gravità | Dettaglio |
|----------|---------|-----------|
| **Stesso retrieval per tutti** | 🔴 CRITICO | Tutti gli expert ricevono gli stessi 5 chunk identici |
| **Nessun graph_search** | 🔴 CRITICO | 0 chiamate a GraphSearchTool (dovrebbero esserci per Systemic/Precedent) |
| **graph_score sempre 0.5** | 🟠 ALTO | linked_nodes sempre vuoto, bridge table non usata |
| **source_type non filtrato** | 🟠 ALTO | LiteralExpert riceve anche "ratio", PrecedentExpert riceve "norma" |
| **Grounding Rate 20%** | 🔴 CRITICO | 16/20 fonti citate sono HALLUCINATE |
| **Confidence troppo alta** | 🟠 ALTO | 0.90 per tutti nonostante hallucination |

### 2.4 Confronto Retrieval per Expert

**ATTESO (teorico):**
```
LiteralExpert:    [norma_1, norma_2, norma_3, norma_4, norma_5]
SystemicExpert:   [norma_A, norma_B] + graph_context[modifica_C, abroga_D]
PrinciplesExpert: [ratio_1, ratio_2, spiegazione_1, spiegazione_2]
PrecedentExpert:  [massima_1, massima_2, massima_3] + graph[interpreta_X]
```

**OSSERVATO (trace):**
```
LiteralExpert:    [art1976_norma, art1458_norma, art1517_norma, art1453_norma, ratio_1458]
SystemicExpert:   [art1976_norma, art1458_norma, art1517_norma, art1453_norma, ratio_1458]  # IDENTICO!
PrinciplesExpert: [art1976_norma, art1458_norma, art1517_norma, art1453_norma, ratio_1458]  # IDENTICO!
PrecedentExpert:  [art1976_norma, art1458_norma, art1517_norma, art1453_norma, ratio_1458]  # IDENTICO!
```

---

## 3. GAP ANALYSIS

### 3.1 Retrieval Layer

| Aspetto | Teoria | Implementazione | Gap |
|---------|--------|-----------------|-----|
| Source type filter | Per-expert | Nessuno | 🔴 |
| Graph traversal | θ_traverse per expert | Non usato | 🔴 |
| Bridge table | Arricchisce scoring | Non usato nel retrieval | 🟠 |
| Query specialization | Per-expert | Stessa query | 🟠 |

### 3.2 Tool System

| Tool | Atteso | Osservato | Gap |
|------|--------|-----------|-----|
| SemanticSearchTool | Con filtro source_type | Senza filtro | 🟠 |
| GraphSearchTool | Usato da Systemic/Precedent | Mai usato | 🔴 |
| GetExactTextTool | Per LiteralExpert | Non implementato | 🟠 |
| GetDottrinaTool | Per PrinciplesExpert | Non implementato | 🟠 |

### 3.3 Source Grounding

| Metrica | Atteso | Osservato | Gap |
|---------|--------|-----------|-----|
| Grounding rate | >90% | 20% | 🔴 CRITICO |
| Source validation | Pre-response | Post-response | 🟠 |
| Confidence adjustment | Proporzionale | Ignorato | 🟠 |

---

## 4. ROOT CAUSE ANALYSIS

### 4.1 Perché tutti gli expert ricevono gli stessi dati?

```python
# ATTUALE (expert_debugger.py e expert/*.py)
real_semantic_tool = SemanticSearchTool(retriever, embedding_service)

# Ogni expert riceve lo STESSO tool
for exp_type in selected_experts:
    tracing_semantic = TracingSemanticSearchTool(real_semantic_tool, exp_type)
    # ...
    expert = LiteralExpert(tools=[tracing_semantic, ...])
```

Il problema: `SemanticSearchTool` non ha parametro `source_type` e non filtra.

### 4.2 Perché graph_search non viene usato?

```python
# Gli expert hanno GraphSearchTool nei tools
tools = [tracing_semantic, tracing_graph]
expert = LiteralExpert(tools=tools, ...)

# MA: il prompt degli expert non istruisce l'LLM a chiamare graph_search
# L'LLM chiama solo semantic_search perché è più "ovvio"
```

Il problema: Il prompt non guida l'LLM a usare graph_search quando appropriato.

### 4.3 Perché le fonti sono hallucinate?

```python
# L'LLM genera source_id inventati tipo:
"source_id": "art1453_cc"  # Questo ID non esiste nel retrieval!

# Il retrieval ritorna chunk_id tipo:
"chunk_id": "41f044bf-d3f8-942c-b857-dee2b526ba32"

# Nessun match possibile!
```

Il problema: L'LLM inventa source_id invece di usare i chunk_id dal retrieval.

---

## 4.4 Bug nel GraphSearchTool

```python
# In merlt/tools/search.py linea 430:
result = await self.graph_db.execute_query(query, params)  # ❌ METODO NON ESISTE!

# FalkorDBClient ha solo:
await self.graph_db.query(query, params)  # ✅ CORRETTO
```

---

## 5. CORREZIONI PROPOSTE

### 5.1 Fase 1: Retrieval Specializzato

**File da modificare**: `merlt/tools/semantic_search.py`

```python
class SemanticSearchTool:
    async def __call__(
        self,
        query: str,
        source_type: Optional[str] = None,  # NUOVO: filtro per expert
        top_k: int = 5
    ) -> ToolResult:
        # Aggiungi filtro a Qdrant
        filter_conditions = {}
        if source_type:
            filter_conditions["source_type"] = source_type

        results = await self.retriever.search(
            query=query,
            top_k=top_k,
            filter=filter_conditions  # NUOVO
        )
```

### 5.2 Fase 2: Query Specializzate per Expert

**File da modificare**: `merlt/experts/literal.py` (e altri)

```python
class LiteralExpert(BaseExpert):
    async def _search_sources(self, context: ExpertContext) -> List[Dict]:
        # Cerca SOLO norme
        results = await self.semantic_tool(
            query=context.query_text,
            source_type="norma",  # FILTRO SPECIALIZZATO
            top_k=5
        )
        return results
```

### 5.3 Fase 3: Graph Search per Systemic/Precedent

**File da modificare**: `merlt/experts/systemic.py`

```python
class SystemicExpert(BaseExpert):
    async def _search_sources(self, context: ExpertContext) -> List[Dict]:
        # 1. Semantic search per norme base
        semantic_results = await self.semantic_tool(
            query=context.query_text,
            source_type="norma",
            top_k=3
        )

        # 2. Graph traversal per connessioni
        start_urns = [r['metadata']['article_urn'] for r in semantic_results]
        graph_results = await self.graph_tool(
            start_nodes=start_urns,
            relations=["modifica", "abroga", "deroga"],
            max_depth=2
        )

        return semantic_results + graph_results
```

### 5.4 Fase 4: Source ID Matching

**File da modificare**: `merlt/experts/base.py`

```python
# Nel prompt dell'expert:
PROMPT_TEMPLATE = """
...
FONTI RECUPERATE (usa SOLO questi source_id):
{% for source in sources %}
- source_id: "{{ source.chunk_id }}"  # USA chunk_id come source_id!
  text: {{ source.text[:500] }}
  metadata: {{ source.metadata }}
{% endfor %}

⚠️ IMPORTANTE: In legal_basis, usa ESATTAMENTE i source_id forniti sopra.
NON inventare source_id. Se un articolo non è nelle fonti, NON citarlo.
"""
```

### 5.5 Fase 5: Confidence Adjustment

```python
def _compute_confidence(self, grounding_rate: float, base_confidence: float) -> float:
    """Riduce confidence se fonti non groundate."""
    if grounding_rate < 0.5:
        return base_confidence * grounding_rate  # Penalizza fortemente
    return base_confidence * (0.5 + grounding_rate * 0.5)
```

---

## 6. METRICHE RLCF DA TRACCIARE

Per ogni query, il debugger Streamlit deve mostrare:

### 6.1 Retrieval Quality
- [ ] `source_type_distribution` per expert
- [ ] `graph_nodes_traversed` (se graph_search usato)
- [ ] `bridge_table_hits` (chunk→node matches)
- [ ] `similarity_score_avg` per source_type

### 6.2 Expert Specialization
- [ ] `unique_chunks_per_expert` (devono essere DIVERSI!)
- [ ] `tool_usage_pattern` (semantic vs graph)
- [ ] `source_type_alignment` (expert X usa source_type giusto?)

### 6.3 Source Grounding
- [ ] `grounding_rate` (validated / total sources)
- [ ] `hallucination_details` (quali fonti inventate)
- [ ] `chunk_id_match_rate` (source_id = chunk_id?)

### 6.4 Confidence Calibration
- [ ] `confidence_vs_grounding` (correlazione)
- [ ] `expert_agreement` (convergenza interpretazioni)
- [ ] `source_overlap` (quante fonti condivise tra expert)

---

## 7. NEXT STEPS

1. **Implementare source_type filter** in SemanticSearchTool
2. **Aggiungere graph_search** nel workflow di Systemic/Precedent
3. **Usare chunk_id come source_id** nel prompt degli expert
4. **Aggiornare Streamlit** per mostrare tutti i passaggi
5. **Validare grounding** prima di calcolare confidence finale
6. **Test con nuova query** e verificare miglioramento metriche

---

## APPENDICE: Trace Summary

```
Query: "Come funziona la risoluzione per inadempimento?"
Total Latency: 59s
Experts Used: literal, systemic, principles, precedent
Tool Calls: 8 (tutti semantic_search)
Grounding Rate: 20% (16 fonti hallucinate)
Final Confidence: 0.85 (troppo alta!)
```
