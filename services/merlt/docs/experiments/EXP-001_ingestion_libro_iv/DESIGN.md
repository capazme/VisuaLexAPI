# EXP-001: Ingestion Libro IV - Delle Obbligazioni

> **Status**: COMPLETED
> **Data inizio**: 2025-12-03
> **Data fine**: 2025-12-04
> **Git commits**: 48814f1 (Run 1), e435379 (Run 2 con Brocardi)

## Executive Summary

Questo esperimento ha validato la pipeline di ingestion MERL-T attraverso due esecuzioni:
- **Run 1** (3 dic): Solo Normattiva → 890 nodi, 892 relazioni
- **Run 2** (4 dic): Con Brocardi enrichment integrato → 3,346 nodi, 25,574 relazioni

Il Run 2 ha dimostrato un incremento del **+274%** nei nodi e **+2,768%** nelle relazioni grazie all'integrazione di dottrina e giurisprudenza da Brocardi.it.

---

## 1. Overview

### 1.1 Obiettivo
Validare la pipeline di ingestion MERL-T attraverso il popolamento completo del Knowledge Graph con il **Libro IV del Codice Civile Italiano** (Delle Obbligazioni, artt. 1173-2059), verificando:
- Correttezza del chunking comma-level
- Integrità della struttura gerarchica nel grafo
- Qualità dell'enrichment da Brocardi
- Performance e scalabilità della pipeline

### 1.2 Research Questions

- [x] **RQ1**: Il chunking comma-level preserva l'integrità semantica delle norme?
  - Metrica: % di commi correttamente identificati vs ground truth manuale (sample)

- [x] **RQ2**: La struttura gerarchica (Codice→Libro→Titolo→Capo→Articolo) migliora la navigabilità?
  - Metrica: Profondità media path, completezza relazioni `contiene`

- [x] **RQ3**: L'enrichment Brocardi aggiunge valore informativo misurabile?
  - Metrica: % articoli con Dottrina, % con AttoGiudiziario, coverage ratio

- [ ] **RQ4**: La Bridge Table riduce latenza rispetto a join runtime?
  - Metrica: Query time con/senza Bridge Table (esperimento successivo)

### 1.3 Ipotesi

| ID | Ipotesi | Razionale |
|----|---------|-----------|
| H1 | Il 95%+ dei commi sarà identificato correttamente | Struttura standardizzata Codice Civile |
| H2 | Ogni articolo avrà almeno 2 relazioni gerarchiche | Minimo: `part_of` Titolo, `contiene` Codice |
| H3 | Il 70%+ degli articoli avrà enrichment Brocardi | Libro IV ben documentato su Brocardi.it |
| H4 | L'ingestion completa richiederà < 60 minuti | 887 articoli, ~3s/articolo stimato |

### 1.4 Success Criteria

| Criterio | Threshold | Priorità |
|----------|-----------|----------|
| Articoli processati | 887/887 (100%) | MUST |
| Error rate | < 5% | MUST |
| Tempo totale | < 120 minuti | SHOULD |
| Nodi Norma creati | ≥ 900 | MUST |
| Bridge mappings | ≥ 2000 | SHOULD |
| Dottrina nodes | ≥ 500 | NICE |
| AttoGiudiziario nodes | ≥ 200 | NICE |

---

## 2. Metodologia

### 2.1 Setup

```bash
# Ambiente
Python: 3.12.x
OS: macOS Darwin 25.0.0
Git commit: [da inserire al momento dell'esecuzione]

# Dipendenze chiave
falkordb-py: 1.x
asyncpg: 0.29.x
tiktoken: 0.5.x
httpx: 0.27.x

# Docker containers
- FalkorDB: porta 6380
- PostgreSQL: porta 5433
- Qdrant: porta 6333 (non usato in questo esperimento)
```

### 2.2 Dataset

| Parametro | Valore |
|-----------|--------|
| **Fonte** | VisualexAPI → Normattiva.it + Brocardi.it |
| **Corpus** | Libro IV Codice Civile - "Delle Obbligazioni" |
| **Range articoli** | Art. 1173 - Art. 2059 |
| **Articoli totali** | 887 |
| **Stima chunks** | ~2500 (media 2.8 commi/articolo) |
| **Data normativa** | R.D. 16 marzo 1942, n. 262 (Allegato 2) |

#### Struttura Libro IV

| Titolo | Articoli | Descrizione |
|--------|----------|-------------|
| I | 1173-1320 | Delle obbligazioni in generale |
| II | 1321-1469 | Dei contratti in generale |
| III | 1470-1986 | Dei singoli contratti |
| IV | 1987-2027 | Delle promesse unilaterali |
| V | 2028-2042 | Dei titoli di credito |
| VI | 2043-2059 | Della responsabilità patrimoniale |

### 2.3 Procedura

#### Fase 1: Preparazione (10 min)
1. Verificare stato database (FalkorDB, PostgreSQL)
2. Backup database esistente (se presente)
3. Pulire tabelle di test precedenti
4. Verificare connettività VisualexAPI

#### Fase 2: Ingestion (stimato 60-90 min)
1. Fetch articoli da VisualexAPI (con retry logic)
2. Per ogni articolo:
   - Parse con CommaParser
   - Chunk con StructuralChunker
   - Create graph nodes con IngestionPipelineV2
   - Insert bridge mappings con BridgeBuilder
3. Log progressivo ogni 50 articoli

#### Fase 3: Validazione (20 min)
1. Count nodi per tipo
2. Verifica integrità relazioni
3. Sample check 10 articoli random
4. Query di consistenza

#### Fase 4: Metriche (10 min)
1. Export statistiche finali
2. Calcolo metriche RQ
3. Screenshot/export risultati

### 2.4 Variabili

| Tipo | Nome | Valore/Range |
|------|------|--------------|
| **Indipendente** | batch_size | 1 (sequenziale) |
| **Indipendente** | create_graph_nodes | True |
| **Indipendente** | brocardi_enrichment | True |
| **Dipendente** | tempo_totale | Misurato |
| **Dipendente** | articoli_processati | Misurato |
| **Dipendente** | error_count | Misurato |
| **Dipendente** | nodi_creati | Misurato |
| **Dipendente** | mappings_creati | Misurato |
| **Controllo** | chunking_strategy | comma-level (fisso) |
| **Controllo** | URN_format | Normattiva (fisso) |

---

## 3. Architettura Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         INGESTION PIPELINE v2                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐          │
│  │ VisualexAPI │───▶│ CommaParser  │───▶│ StructuralChunker │          │
│  │  (scraper)  │    │ (regex-only) │    │  (URN extension)  │          │
│  └─────────────┘    └──────────────┘    └─────────┬─────────┘          │
│                                                   │                     │
│                                                   ▼                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    IngestionPipelineV2                          │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐     │   │
│  │  │ Create Norma│  │Create Dottrina│  │Create AttoGiudiziario│    │   │
│  │  │   (21 props)│  │ (from Brocardi)│ │   (from massime)    │    │   │
│  │  └──────┬──────┘  └───────┬───────┘  └──────────┬──────────┘    │   │
│  │         │                 │                      │               │   │
│  │         ▼                 ▼                      ▼               │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │                    FalkorDB Graph                        │    │   │
│  │  │  Norma ──contiene──▶ Norma                              │    │   │
│  │  │  Norma ◀──commenta── Dottrina                           │    │   │
│  │  │  Norma ◀──interpreta── AttoGiudiziario                  │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  │                              │                                   │   │
│  │         ┌────────────────────┴────────────────────┐             │   │
│  │         ▼                                         ▼             │   │
│  │  ┌──────────────┐                         ┌──────────────┐      │   │
│  │  │BridgeMapping │                         │    Chunk     │      │   │
│  │  │ (preparation)│                         │  (for Qdrant)│      │   │
│  │  └──────┬───────┘                         └──────────────┘      │   │
│  │         │                                                        │   │
│  └─────────┼────────────────────────────────────────────────────────┘   │
│            │                                                            │
│            ▼                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      BridgeBuilder                                │  │
│  │  BridgeMapping ──────▶ PostgreSQL Bridge Table                   │  │
│  │  - PRIMARY (chunk → articolo)                                    │  │
│  │  - HIERARCHIC (chunk → libro/titolo)                            │  │
│  │  - DOCTRINE (chunk → dottrina)                                  │  │
│  │  - JURISPRUDENCE (chunk → atto_giudiziario)                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Query di Validazione

### 4.1 Count Nodi per Tipo
```cypher
MATCH (n:Norma) RETURN n.tipo_documento AS tipo, count(*) AS count
ORDER BY count DESC
```

### 4.2 Verifica Relazioni Gerarchiche
```cypher
MATCH (codice:Norma {tipo_documento: 'codice'})-[:contiene]->(libro:Norma {tipo_documento: 'libro'})
RETURN codice.denominazione, libro.denominazione
```

### 4.3 Articoli con Dottrina
```cypher
MATCH (a:Norma {tipo_documento: 'articolo'})<-[:commenta]-(d:Dottrina)
RETURN count(DISTINCT a) AS articoli_con_dottrina
```

### 4.4 Articoli con Giurisprudenza
```cypher
MATCH (a:Norma {tipo_documento: 'articolo'})<-[:interpreta]-(g:AttoGiudiziario)
RETURN count(DISTINCT a) AS articoli_con_giurisprudenza
```

### 4.5 Bridge Table Stats
```sql
SELECT
    node_type,
    relation_type,
    COUNT(*) as count,
    AVG(confidence) as avg_confidence
FROM bridge_table
WHERE source = 'ingestion_v2'
GROUP BY node_type, relation_type
ORDER BY count DESC;
```

---

## 5. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|-------------|---------|-------------|
| Rate limiting VisualexAPI | Media | Alto | Delay 1s tra richieste, retry logic |
| Timeout FalkorDB | Bassa | Medio | Batch più piccoli, connection pool |
| Memoria insufficiente | Bassa | Alto | Monitoraggio, gc.collect() periodico |
| Articoli malformati | Media | Basso | Try/catch per articolo, log errori |
| Brocardi non disponibile | Media | Basso | Graceful degradation, continua senza |

---

## 6. Riferimenti

### 6.1 Documentazione Interna
- `docs/08-iteration/SCHEMA_DEFINITIVO_API_GRAFO.md` - Schema nodi/relazioni
- `docs/08-iteration/INGESTION_METHODOLOGY.md` - Metodologia scientifica
- `docs/08-iteration/INGESTION_PLAN_LIBRO_IV.md` - Piano originale

### 6.2 Codice Sorgente
- `merlt/preprocessing/comma_parser.py` - Parser commi
- `merlt/preprocessing/structural_chunker.py` - Chunker strutturale
- `merlt/preprocessing/ingestion_pipeline_v2.py` - Pipeline principale
- `merlt/storage/bridge/bridge_builder.py` - Builder Bridge Table

### 6.3 Papers di Riferimento
- Semantic chunking: [da inserire]
- Legal knowledge graphs: [da inserire]

---

## Appendice A: Checklist Pre-Esecuzione

- [ ] Docker containers running (FalkorDB, PostgreSQL)
- [ ] `.env` configurato con API keys
- [ ] `pytest tests/preprocessing/ -v` passa
- [ ] `pytest tests/storage/test_bridge*.py -v` passa
- [ ] Spazio disco > 10GB
- [ ] Git commit salvato
- [ ] Backup database esistente

---

*Documento creato: 2025-12-03*
*Ultima modifica: 2025-12-03*
