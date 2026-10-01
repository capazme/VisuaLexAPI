# EXP-013: Enrichment Pipeline - Estrazione Entità da Dottrina

> **Status**: COMPLETED
> **Data inizio**: 2025-12-13
> **Data fine**: 2025-12-13
> **Git commit**: f8c7a80 (enrichment pipeline implementation)

---

## Executive Summary

Questo esperimento valida la pipeline di enrichment MERL-T per l'estrazione automatica di entità giuridiche strutturate da testi dottrinali. Utilizziamo il manuale Torrente-Schlesinger (Libro IV - Obbligazioni) come corpus di test, estraendo Concetti, Principi e Definizioni tramite LLM e integrandoli nel Knowledge Graph con triple linkage: FalkorDB (grafo) + Qdrant (embeddings) + Bridge Table (mappings).

**Innovazione chiave**: Prima validazione del pattern "dottrina → entità strutturate → grafo normativo" che abilita Graph-Aware RAG su contenuti dottrinali.

---

## 1. Overview

### 1.1 Obiettivo

Validare la pipeline di enrichment end-to-end estraendo entità giuridiche strutturate da testo dottrinale e integrandole nel Knowledge Graph esistente, verificando:

1. **Estrazione LLM**: Capacità di Gemini 2.5 Flash di estrarre entità strutturate da prosa giuridica
2. **Linking normativo**: Correttezza del collegamento entità → articoli citati (Norma)
3. **Deduplicazione**: Efficacia della normalizzazione per evitare duplicati semantici
4. **Triple storage**: Consistenza tra FalkorDB, Qdrant e Bridge Table

### 1.2 Research Questions

- [x] **RQ1**: Un LLM può estrarre entità giuridiche strutturate da testo dottrinale con precisione accettabile?
  - Metrica: % entità valide (nome non vuoto, descrizione presente)

- [x] **RQ2**: Le entità estratte possono essere collegate automaticamente al backbone normativo?
  - Metrica: % entità con almeno una relazione :DISCIPLINA verso Norma

- [ ] **RQ3**: La deduplicazione per nome_normalizzato previene duplicati semantici?
  - Metrica: Ratio entità uniche / entità totali estratte

- [ ] **RQ4**: Il triple storage (Graph + Vector + Bridge) mantiene consistenza?
  - Metrica: |chunk_ids in Qdrant| = |bridge entries| = |entità in grafo|

### 1.3 Ipotesi

| ID | Ipotesi | Razionale |
|----|---------|-----------|
| H1 | Gemini 2.5 Flash estrae 2-5 entità/chunk con >80% validità | Prompt strutturato + JSON schema |
| H2 | >70% delle entità avranno collegamento a Norma citata | Torrente cita articoli frequentemente |
| H3 | La deduplicazione ridurrà le entità del 30-50% | Concetti ripetuti tra chunk |
| H4 | Bridge Table avrà 1:N mapping (1 chunk → N entità) | Estrazione multi-entity per chunk |

### 1.4 Success Criteria

| Criterio | Threshold | Priorità |
|----------|-----------|----------|
| Chunks processati | 327/327 (100%) | MUST |
| Error rate | < 5% | MUST |
| Entità estratte totali | > 500 | MUST |
| Entità con :DISCIPLINA | > 300 | SHOULD |
| Bridge entries | > 500 | SHOULD |
| Tempo totale | < 60 minuti | NICE |
| Costo LLM | < $3.00 | NICE |

---

## 2. Metodologia

### 2.1 Setup

```bash
# Ambiente
Python: 3.12.x
OS: macOS Darwin 25.0.0
Git commit: f8c7a80

# Dipendenze chiave
falkordb-py: 1.x
qdrant-client: 1.x
asyncpg: 0.29.x
PyMuPDF (fitz): 1.24.x
sentence-transformers: 2.x

# Docker containers
- FalkorDB: localhost:6380, graph=merl_t_dev
- PostgreSQL: localhost:5433, database=rlcf_dev, table=bridge_table
- Qdrant: localhost:6333, collection=merl_t_dev_chunks

# LLM
- Model: google/gemini-2.5-flash via OpenRouter
- Temperature: 0.0
- Max tokens: 2000
```

### 2.2 Dataset

| Parametro | Valore |
|-----------|--------|
| **Fonte** | Torrente-Schlesinger, Manuale di Diritto Privato |
| **Sezione** | Libro IV - Delle Obbligazioni |
| **File** | `data/Torrente-libroiv.pdf` |
| **Dimensione** | 1.8 MB |
| **Chunks** | 327 (~4000 chars/chunk, 200 overlap) |
| **Articoli coperti** | Art. 1173-2059 c.c. (range obbligazioni) |

#### Struttura Contenuto

Il manuale Torrente copre sistematicamente il Libro IV del Codice Civile:
- Fonti delle obbligazioni (artt. 1173-1320)
- Contratti in generale (artt. 1321-1469)
- Singoli contratti (artt. 1470-1986)
- Responsabilità extracontrattuale (artt. 2043-2059)

### 2.3 Procedura

#### Fase 1: Preparazione (5 min)
1. Verificare stato database (FalkorDB, PostgreSQL, Qdrant)
2. Pulire dati test precedenti (entità schema_version=2.1)
3. Verificare PDF source esiste
4. Caricare environment variables (LLM_ENRICHMENT_MODEL)

#### Fase 2: Enrichment (stimato 30-45 min)
1. **PDF Parsing**: PyMuPDF estrae testo pagina per pagina
2. **Chunking**: Divide in chunk ~4000 chars con 200 overlap
3. Per ogni chunk:
   - Embed con E5-large → Qdrant (payload: source_type=enrichment)
   - Extract entità con 3 estrattori paralleli (Concept, Principle, Definition)
   - Link & Dedup con EntityLinker
   - Write nel grafo con EnrichmentGraphWriter
   - Create bridge entries con BridgeBuilder
4. Checkpoint ogni chunk processato

#### Fase 3: Validazione (10 min)
1. Count entità per tipo (ConcettoGiuridico, PrincipioGiuridico, DefinizioneLegale)
2. Count relazioni :DISCIPLINA, :ESPRIME, :DEFINISCE
3. Verifica bridge entries consistency
4. Sample check 10 entità random

#### Fase 4: Analisi (15 min)
1. Export metriche finali
2. Confronto con ipotesi
3. Identificazione pattern e anomalie

### 2.4 Variabili

| Tipo | Nome | Valore/Range |
|------|------|--------------|
| **Indipendente** | chunk_size | 4000 chars |
| **Indipendente** | overlap | 200 chars |
| **Indipendente** | llm_model | google/gemini-2.5-flash |
| **Indipendente** | entity_types | 17 tipi (full extraction) |
| **Dipendente** | chunks_processed | Misurato |
| **Dipendente** | entities_extracted | Misurato |
| **Dipendente** | entities_unique | Misurato |
| **Dipendente** | relations_created | Misurato |
| **Dipendente** | bridge_entries | Misurato |
| **Dipendente** | error_rate | Misurato |
| **Controllo** | dedup_threshold | 0.85 (nome_normalizzato) |
| **Controllo** | schema_version | 2.1 |

---

## 3. Architettura Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       ENRICHMENT PIPELINE v1.0                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐                                                        │
│  │    PDF      │                                                        │
│  │ (Torrente)  │                                                        │
│  └──────┬──────┘                                                        │
│         │                                                                │
│         ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              ManualEnrichmentSource (PyMuPDF)                    │   │
│  │  - Page-by-page text extraction                                  │   │
│  │  - Intelligent chunking (section boundaries)                     │   │
│  │  - Article reference detection (regex: art. \d+)                 │   │
│  │  Output: 327 EnrichmentContent chunks                            │   │
│  └──────────────────────────┬──────────────────────────────────────┘   │
│                             │                                           │
│         ┌───────────────────┼───────────────────┐                      │
│         ▼                   ▼                   ▼                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │  Embedding  │    │   Entity    │    │   Entity    │                 │
│  │  (E5-large) │    │  Extraction │    │   Linking   │                 │
│  │    1024d    │    │  (Gemini)   │    │  (Dedup)    │                 │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                 │
│         │                  │                  │                         │
│         ▼                  ▼                  ▼                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    EnrichmentGraphWriter                         │   │
│  │                                                                  │   │
│  │  MERGE (c:ConcettoGiuridico {nome_normalizzato: $nome})         │   │
│  │  MERGE (p:PrincipioGiuridico {nome_normalizzato: $nome})        │   │
│  │  MERGE (d:DefinizioneLegale {nome_normalizzato: $nome})         │   │
│  │                                                                  │   │
│  │  MATCH (n:Norma {URN: $urn})                                    │   │
│  │  MERGE (n)-[:DISCIPLINA]->(c)                                   │   │
│  │  MERGE (n)-[:ESPRIME]->(p)                                      │   │
│  │  MERGE (n)-[:DEFINISCE]->(d)                                    │   │
│  └──────────────────────────┬──────────────────────────────────────┘   │
│                             │                                           │
│    ┌────────────────────────┼────────────────────────┐                 │
│    ▼                        ▼                        ▼                  │
│  ┌──────────┐        ┌──────────┐        ┌────────────────┐            │
│  │ FalkorDB │        │  Qdrant  │        │ Bridge Table   │            │
│  │  (Graph) │        │ (Vectors)│        │  (PostgreSQL)  │            │
│  │          │        │          │        │                │            │
│  │ Entities │        │ Chunk    │        │ chunk_id ↔     │            │
│  │ + NORMA  │        │ Embeddings│       │ entity_node_id │            │
│  │ relations│        │ 1024d    │        │                │            │
│  └──────────┘        └──────────┘        └────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Stub Pattern per Norma Mancanti

Quando l'enrichment estrae un riferimento ad un articolo non ancora presente nel grafo,
la pipeline crea un **stub Norma** con proprietà minime:

```cypher
MERGE (n:Norma {URN: $urn})
ON CREATE SET
  n.is_stub = true,
  n.stub_source = 'enrichment_pipeline',
  n.created_at = timestamp()
```

**Flow:**
1. **Enrichment**: Crea stub Norma con `is_stub=true` + relazione :DISCIPLINA
2. **Backbone ingestion**: `ON MATCH SET` riempie lo stub con dati completi
3. **Post-ingestion**: Stub → Norma completa, relazioni preservate

**Query per verificare stub:**
```cypher
MATCH (n:Norma) WHERE n.is_stub = true
RETURN n.URN, count(*) as stub_count
```

### Entity Types Estratti

| Tipo | Label FalkorDB | Relazione verso Norma |
|------|----------------|----------------------|
| Concetto | ConcettoGiuridico | :DISCIPLINA |
| Principio | PrincipioGiuridico | :ESPRIME |
| Definizione | DefinizioneLegale | :DEFINISCE |
| Soggetto | SoggettoGiuridico | :DISCIPLINA |
| Ruolo | RuoloGiuridico | :DISCIPLINA |
| Modalità | ModalitaGiuridica | :DISCIPLINA |
| Fatto | FattoGiuridico | :DISCIPLINA |
| Atto | AttoGiuridico | :DISCIPLINA |
| Procedura | ProceduraGiuridica | :DISCIPLINA |
| Termine | TermineGiuridico | :DISCIPLINA |
| Effetto | EffettoGiuridico | :DISCIPLINA |
| Responsabilità | ResponsabilitaGiuridica | :DISCIPLINA |
| Rimedio | RimedioGiuridico | :DISCIPLINA |
| Sanzione | SanzioneGiuridica | :DISCIPLINA |
| Caso | CasoGiuridico | :DISCIPLINA |
| Eccezione | EccezioneGiuridica | :DISCIPLINA |
| Clausola | ClausolaGiuridica | :DISCIPLINA |

---

## 4. Query di Validazione

### 4.1 Conteggio Entità per Tipo

```cypher
// Entità enrichment (schema 2.1)
MATCH (n)
WHERE n.schema_version = '2.1'
RETURN labels(n)[0] as tipo, count(n) as count
ORDER BY count DESC
```

### 4.2 Relazioni Norma → Entità

```cypher
// Relazioni DISCIPLINA create
MATCH (n:Norma)-[r:DISCIPLINA]->(c:ConcettoGiuridico)
WHERE c.schema_version = '2.1'
RETURN count(r) as relazioni,
       count(DISTINCT n) as norme_coinvolte,
       count(DISTINCT c) as concetti_collegati
```

### 4.3 Top Concetti Più Collegati

```cypher
// Concetti più referenziati
MATCH (c:ConcettoGiuridico)<-[r:DISCIPLINA]-(n:Norma)
WHERE c.schema_version = '2.1'
RETURN c.nome, c.descrizione, count(r) as collegamenti
ORDER BY collegamenti DESC
LIMIT 10
```

### 4.4 Bridge Table Stats

```sql
-- Entries enrichment per tipo
SELECT
    mapping_type,
    COUNT(*) as entries,
    AVG(confidence) as avg_confidence
FROM bridge_table
WHERE metadata->>'extraction_source' = 'enrichment_pipeline'
GROUP BY mapping_type;
```

### 4.5 Qdrant Chunks

```python
# Count chunks enrichment
from qdrant_client import QdrantClient
client = QdrantClient(host="localhost", port=6333)
result = client.scroll(
    collection_name="merl_t_dev_chunks",
    scroll_filter={"must": [{"key": "source_type", "match": {"value": "enrichment"}}]},
    limit=1000
)
print(f"Chunks enrichment: {len(result[0])}")
```

---

## 5. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|-------------|---------|-------------|
| Rate limiting OpenRouter | Bassa | Alto | Retry logic con backoff esponenziale |
| LLM restituisce JSON malformato | Media | Basso | Fallback a [] per entities null |
| Articoli non trovati in grafo | Media | Basso | Skip relazione, log warning |
| Memoria insufficiente (E5-large) | Bassa | Alto | CPU mode, batch embedding |
| Duplicati semantici non rilevati | Media | Medio | Post-processing manuale sample |
| Timeout FalkorDB | Bassa | Medio | Connection pool, query ottimizzate |

---

## 6. Riferimenti

### 6.1 Documentazione Interna

- `docs/architecture/storage-layer.md` - Architettura triple storage
- `docs/architecture/expert-tools-rlcf-plan.md` - Piano RLCF e enrichment

### 6.2 Codice Sorgente

- `merlt/pipeline/enrichment/pipeline.py` - Pipeline orchestrator
- `merlt/pipeline/enrichment/sources/manual.py` - PDF source
- `merlt/pipeline/enrichment/extractors/` - Entity extractors (LLM-based)
- `merlt/pipeline/enrichment/linkers/` - Entity linking & dedup
- `merlt/pipeline/enrichment/writers/` - Graph writers
- `scripts/test_enrichment_sample.py` - Test runner

### 6.3 Configurazione

- `merlt/pipeline/enrichment/config/extractors.yaml` - Prompt e schema LLM
- `merlt/pipeline/enrichment/config/writers.yaml` - Query Cypher

---

## Appendice A: Checklist Pre-Esecuzione

- [x] Docker containers running (FalkorDB, PostgreSQL, Qdrant)
- [x] `.env` configurato con `LLM_ENRICHMENT_MODEL=google/gemini-2.5-flash`
- [x] PDF source presente: `data/Torrente-libroiv.pdf`
- [x] Database puliti da test precedenti
- [x] Git commit salvato
- [x] Spazio disco > 5GB

## Appendice B: Comandi Esecuzione

```bash
# Avvia esperimento completo (327 chunks)
python scripts/test_enrichment_sample.py --test 3 --verbose

# Monitor progress (in altra shell)
tail -f /tmp/claude/tasks/b441d58.output

# Valida risultati
python scripts/test_enrichment_sample.py --validate

# Query manuale FalkorDB
docker exec -it falkordb redis-cli -p 6380
GRAPH.QUERY merl_t_dev "MATCH (n) WHERE n.schema_version = '2.1' RETURN labels(n)[0], count(n)"
```

---

*Documento creato: 2025-12-13*
*Ultima modifica: 2025-12-13*
