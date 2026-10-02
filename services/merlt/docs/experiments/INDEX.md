# Experiments Index

> **Indice cronologico di tutti gli esperimenti MERL-T**
> Aggiornare questo file quando si crea un nuovo esperimento

---

## Esperimenti per Fase

### Fase 1: Data Ingestion
| ID | Nome | Status | Data | RQ | Descrizione |
|----|------|--------|------|-----|-------------|
| [EXP-001](./EXP-001_ingestion_libro_iv/) | ingestion_libro_iv | **COMPLETED** | 2025-12-03/05 | RQ1-4 | Ingestion completa 887 articoli Libro IV CC con Brocardi enrichment |
| [EXP-004](./EXP-004_ingestion_costituzione/) | ingestion_costituzione | **COMPLETED** | 2025-12-05 | RQ1-3 | Ingestion 139 articoli Costituzione Italiana |
| [EXP-006](./EXP-006_libro_primo_cp/) | libro_primo_cp | **COMPLETED** | 2025-12-07 | RQ1-4 | Ingestion 263 articoli Libro I Codice Penale + RAG validation |
| [EXP-007](./EXP-007_full_ingestion/) | full_ingestion | **COMPLETED** | 2025-12-08 | RQ1-4 | Pipeline end-to-end: Brocardi + Bridge + Multivigenza |
| [EXP-008](./EXP-008_costituzione_completa/) | costituzione_completa | **COMPLETED** | 2025-12-08 | RQ1-3 | Ingestion Costituzione 139 art: 545 nodi, 37 art. con modifiche |
| [EXP-009](./EXP-009_costituzione_full/) | costituzione_full | **COMPLETED** | 2025-12-08 | RQ1-3 | Costituzione con Comma/Lettera: 1201 nodi, 1062 relazioni |
| EXP-011 | costituzione_schema | **COMPLETED** | 2025-12-08 | RQ1-3 | Allineamento schema + numero_* properties |
| EXP-012 | multi_source_embeddings | **COMPLETED** | 2025-12-08 | RQ3-4 | Multi-source embeddings (norma + spiegazione + ratio + massime) |
| [EXP-013](./EXP-013_enrichment_torrente/) | enrichment_torrente | **COMPLETED** | 2025-12-13 | RQ3 | Enrichment LLM da manuale Torrente: 1909 entità, 1316 relazioni |
| [EXP-014](./EXP-014_full_ingestion/) | full_ingestion_v2 | **COMPLETED** | 2025-12-14/15 | RQ1-4 | Full ingestion Libro IV ottimizzato: 27,740 nodi, 43,935 relazioni |

> **Nota**: EXP-002 (Brocardi Enrichment) è stato integrato direttamente in EXP-001 durante il re-run del 4 dicembre 2025.

### Fase 2: Retrieval & Search
| ID | Nome | Status | Data | RQ | Descrizione |
|----|------|--------|------|-----|-------------|
| [EXP-002](./EXP-002_rag_pipeline_test/) | rag_pipeline_test | **COMPLETED** | 2025-12-04 | RQ4-5 | Test end-to-end RAG: semantic search + Bridge Table + graph enrichment |
| [EXP-003](./EXP-003_rag_full_dataset/) | rag_full_dataset | **COMPLETED** | 2025-12-05 | RQ4-5 | RAG con dataset completo (12K vectors): Norma + Massime |
| [EXP-005](./EXP-005_multivigenza_241/) | multivigenza_241 | **COMPLETED** | 2025-12-06 | RQ2-4 | Fix e validazione pipeline multivigenza |

### Fase 3: Expert Reasoning
| ID | Nome | Status | Data | RQ | Descrizione |
|----|------|--------|------|-----|-------------|
| EXP-018 | expert_comparison | PLANNED | - | RQ5 | Confronto 4 Expert con tools specializzati |

### Fase 4: RLCF Learning
| ID | Nome | Status | Data | RQ | Descrizione |
|----|------|--------|------|-----|-------------|
| EXP-010 | rlcf_convergence | PLANNED | - | RQ6 | Test convergenza RLCF multilivello |

### Fase 5: Benchmark & Validation
| ID | Nome | Status | Data | RQ | Descrizione |
|----|------|--------|------|-----|-------------|
| [EXP-015](./EXP-015_rag_validation_benchmark/) | rag_validation | **COMPLETED** | 2025-12-15 | RQ3-4,7 | RAG Benchmark 50 query: Recall@5=42%, MRR=0.594, latenza 93.5ms |
| [EXP-016](./EXP-016_semantic_benchmark/) | semantic_benchmark | **COMPLETED** | 2025-12-15 | RQ3,7 | Benchmark semantico corretto: NDCG@5=0.869, MRR=0.850, Hit Rate=96.7% |
| EXP-017 | bridge_benchmark | PLANNED | - | RQ4 | Benchmark formale Bridge Table vs join runtime |

---

## Statistiche

| Metrica | Valore |
|---------|--------|
| Esperimenti totali | **18** |
| Completati | **15** |
| In corso | 0 |
| Pianificati | **3** (EXP-010, EXP-017, EXP-018) |
| Falliti | 0 |

---

## Timeline

```
2025-12-03
├── EXP-001 design document creato
├── Pipeline v2 completata (CommaParser + StructuralChunker + IngestionPipelineV2)
├── EXP-001 Run 1 avviato (23:32)
└── EXP-001 Run 1 completato (00:14) - 890 nodi, 892 relazioni (solo Normattiva)

2025-12-04
├── BrocardiScraper ampliato (Relazioni Guardasigilli)
├── Data loss Docker → fix persistenza locale (./data/)
├── Bug fix pipeline (isinstance checks, massime conversion)
├── EXP-001 Run 2 avviato (02:17) - con Brocardi integrato
├── EXP-001 Run 2 completato (02:24) - 3,346 nodi, 25,574 relazioni
├── treextractor.py esteso con gerarchia completa
├── Integrazione treextractor fallback in pipeline
├── EXP-001 Run 3 avviato (19:05) - aggiornamento gerarchia
├── EXP-001 Run 3 completato (19:07) - 3,462 nodi, 26,577 relazioni
├── EXP-001 Run 4 (embedding) avviato (19:46)
├── EXP-001 Run 4 completato (19:55) - 2,546 embeddings in Qdrant
├── Script test_rag_pipeline.py creato
├── EXP-002 completato - RAG pipeline testing
├── Bug discovery: massime con "unknown_NNN" e dati sporchi
├── Fix BrocardiScraper: _parse_massima() con parsing strutturato
├── EXP-001 Run 5 avviato (21:42) - re-run sole massime
├── EXP-001 Run 5 completato (22:52) - 9,775 AttoGiudiziario (+1,082%)
└── GRAPH_EDA.md generato con analisi esplorativa completa

2025-12-05
├── Pulizia 4,832 duplicati Qdrant (causati da script paralleli)
├── Identificazione 3,183 massime mancanti
├── EXP-001 Run 6 avviato (00:29) - embedding massime mancanti
├── EXP-001 Run 6 completato (00:35) - 12,321 vectors totali
├── Documentazione aggiornata (RESULTS.md, INDEX.md)
├── EXP-003 design document creato (00:55)
├── EXP-003 esecuzione (01:02) - 10 query test
├── EXP-003 completato - tutte le ipotesi verificate
├── BUG: identificati 1,665 duplicati Norma (65%!)
├── EXP-001 Run 7 avviato (12:00) - cleanup + article-level
├── Pulizia Bridge Table: 2,546 → 887 righe
├── Pulizia Qdrant Norma: 2,546 → 887 punti
├── Re-embedding article-level: 887 vectors (testo completo)
├── EXP-001 Run 7 completato (12:50) - 10,662 vectors ottimizzati
├── EXP-004 design document creato (15:10)
├── EXP-004 ingestion Costituzione avviata (15:25)
└── EXP-004 completato (15:30) - 139 articoli, 152 embeddings

2025-12-06
├── EXP-005 design document creato
├── Bug fix multivigenza: filtering articolo, is_abrogato, parsing destinazione
├── Validazione ground truth vs Normattiva (5/5 articoli corretti)
└── EXP-005 completato - multivigenza pipeline validata

2025-12-07
├── EXP-006 design document creato
├── EXP-006 ingestion Codice Penale avviata
├── EXP-006 completato - 263 articoli, 6,195 massime
├── RAG testing: 12 query, Precision@5=0.200, Recall=0.528
└── Core Library creata (LegalKnowledgeGraph)

2025-12-08
├── EXP-007 eseguito - 17 articoli con pipeline end-to-end
├── 17/17 Brocardi dottrina (100%), 467 massime, 5 multivigenza
├── Fix RLCF module (config files, database.py, lazy imports)
├── Assessment documentazione completo
├── Roadmap RQ1-RQ6 definita
├── Code cleanup: fix duplicazioni (BaseScraper, FalkorDBConfig, RetrieverConfig)
├── Standardizzazione structlog in 12+ file
├── EXP-011 completato - schema allineamento costituzione
├── EXP-012 completato - multi-source embeddings implementati
├── RAG validation baseline: Recall@5=100%, MRR=0.850
└── Libro IV ingestion script pronto (887 articoli)

2025-12-13
├── EXP-013 creato - Enrichment LLM da manuale Torrente
├── Integrazione iusgraph → merlt/rlcf
├── Task handlers per RLCF implementati
├── EXP-013 completato - 1,909 entità, 1,316 relazioni estratte
└── Database cleanup (eliminati Dottrina generici)

2025-12-14
├── EXP-014 design document creato
├── Fix bug rubrica tra parentesi (parsing.py)
├── Backup baseline pre-ingestion
├── BatchIngestionPipeline implementata (parallelizzazione)
└── EXP-014 backbone ingestion avviata

2025-12-15
├── EXP-014 backbone completato - 887 articoli, 7.2s/articolo
├── EXP-014 enrichment LLM completato - 3,049 entità
├── EXP-014 completato - 27,740 nodi, 43,935 relazioni
├── EXP-015 creato - RAG Validation Benchmark
├── EXP-015 completato - Recall@5=42%, MRR=0.594
├── Lessons learned: metodologia errata per query normative
├── EXP-016 creato - Semantic Benchmark (metodologia corretta)
└── EXP-016 completato - NDCG@5=0.869, MRR=0.850, Hit Rate=96.7%
```

---

## Research Questions Coverage

| RQ | Descrizione | Esperimenti | Status |
|----|-------------|-------------|--------|
| RQ1 | Chunking comma-level preserva integrità semantica? | EXP-001, EXP-006, EXP-014 | ✅ **Verified** |
| RQ2 | Struttura gerarchica migliora navigabilità? | EXP-001, EXP-014 | ✅ **Verified** |
| RQ3 | Enrichment Brocardi aggiunge valore misurabile? | EXP-001, EXP-006, EXP-007, EXP-013, EXP-015, EXP-016 | ✅ **Verified** (norma > spiegazione) |
| RQ4 | Bridge Table riduce latenza vs join runtime? | EXP-002, EXP-003, EXP-015 | ✅ **Verified** (2.9ms mediana) |
| RQ5 | Expert specialization migliora qualità? | - | ❌ Planned (EXP-018) |
| RQ6 | RLCF converge a pesi ottimali? | - | ❌ Planned (EXP-010) |
| RQ7 | Multi-source embeddings migliorano Recall? | EXP-012, EXP-015, EXP-016 | ⚠️ **Nuance** (sì per MRR, no per Recall) |

---

## Risultati Chiave EXP-001

### Run 1 (3 dicembre 2025) - Solo Normattiva
| Metrica | Valore |
|---------|--------|
| Articoli | 887/887 (100%) |
| Nodi Norma | 890 |
| Relazioni | 892 |
| Dottrina | 0 |
| AttoGiudiziario | 0 |

### Run 2 (4 dicembre 2025) - Con Brocardi
| Metrica | Valore | Delta |
|---------|--------|-------|
| Articoli | 887/887 (100%) | - |
| Nodi totali | **3,346** | +274% |
| - Norma | 889 | - |
| - Dottrina | 1,630 | +∞ |
| - AttoGiudiziario | 827 | +∞ |
| Relazioni totali | **25,574** | +2,768% |
| - :interpreta | 23,056 | +∞ |
| - :commenta | 1,630 | +∞ |
| - :contiene | 888 | - |

### Run 3 (4 dicembre 2025, sera) - Gerarchia Completa
| Metrica | Valore | Delta |
|---------|--------|-------|
| **Nodi totali** | **3,462** | +116 |
| - Norma | **1,005** | +116 |
|   - codice | 1 | - |
|   - libro | 1 | - |
|   - titolo | 9 | +9 |
|   - capo | 51 | +51 |
|   - sezione | 56 | +56 |
|   - articolo | 887 | - |
| - Dottrina | 1,630 | - |
| - AttoGiudiziario | 827 | - |
| **Relazioni totali** | **26,577** | +1,003 |
| - :contiene | **1,891** | +1,003 |

### Run 4 (4 dicembre 2025, sera) - Embedding Generation
| Metrica | Valore |
|---------|--------|
| Modello | `intfloat/multilingual-e5-large` |
| Dimensione | 1024 |
| Device | MPS (Apple Silicon) |
| Chunks processati | **2,546** |
| Embeddings generati | **2,546** |
| Errori | **0** |
| Success rate | **100%** |
| Tempo | ~8 minuti |
| Collection Qdrant | `merl_t_chunks` |

### Run 5 (4 dicembre 2025, notte) - Massime Fix & Re-ingestion
| Metrica | Pre-Fix | Post-Fix | Delta |
|---------|---------|----------|-------|
| AttoGiudiziario | 827 | **9,775** | **+1,082%** |
| Con numero valido | 0 | 9,771 | +∞ |
| Con anno | 0 | 9,771 | +∞ |
| 'unknown' residui | 827 | **0** | -100% |
| :interpreta | 23,056 | 11,182 | -51% (dedup) |

**Note**: La riduzione delle relazioni :interpreta è dovuta alla corretta deduplicazione. Prima ogni massima con `unknown_NNN` era un nodo separato; ora le stesse sentenze citate da più articoli condividono un singolo nodo.

**Storage Completo dopo Run 6:**
| Storage | Contenuto |
|---------|-----------|
| FalkorDB | **12,410 nodi**, 14,703 relazioni |
| PostgreSQL | 2,546 bridge mappings |
| Qdrant | **12,321 vectors** (1024 dim) |

**Storage Completo dopo Run 7 (ATTUALE):**
| Storage | Prima | Dopo | Note |
|---------|-------|------|------|
| FalkorDB | 12,410 nodi | **12,410 nodi** | Invariato |
| PostgreSQL | 2,546 mappings | **887 mappings** | -65% duplicati |
| Qdrant | 12,321 vectors | **10,662 vectors** | Article-level |

**Breakdown Vectors Qdrant (ATTUALE):**
| Tipo | Count | % |
|------|-------|---|
| Norma (article-level) | **887** | 8.3% |
| Massime | 9,775 | 91.7% |

**Note Run 7:**
- Strategia cambiata: da comma-level (troncato) a article-level (testo completo)
- Art. 1284: da 500 chars (preview) a 7,523 chars (completo)
- 6 articoli mancanti aggiunti (art. 1633, 1650, 1651, 1653, 1837)
- Nessun duplicato nei risultati di ricerca

---

---

## Risultati Chiave EXP-006 (Codice Penale)

| Metrica | Valore |
|---------|--------|
| Articoli processati | 263/263 (100%) |
| Brocardi enrichment | 262/263 (99.6%) |
| Massime totali | 6,195 |
| RAG Precision@5 | 0.200 |
| RAG Recall | 0.528 |
| RAG MRR | 0.562 |

---

## Risultati Chiave EXP-007 (Full Pipeline)

| Metrica | Valore |
|---------|--------|
| Articoli processati | 17/17 (100%) |
| Brocardi dottrina | 17/17 (100%) |
| Massime totali | 467 |
| Jurisprudence coverage | 16/17 (94%) |
| Multivigenza relations | 5 |

---

## Risultati Chiave EXP-012 (Multi-Source Embeddings)

| Metrica | Valore |
|---------|--------|
| Articoli test | 5 (Art. 1173-1177 CC) |
| Embeddings totali | 40 |
| Embeddings per articolo | ~8 (norma + spiegazione + ratio + 5 massime) |
| Source types | `norma`, `spiegazione`, `ratio`, `massima` |

**RAG Validation Baseline (Costituzione):**
| Metrica | Valore |
|---------|--------|
| Query test | 12 |
| Recall@1 | 75% |
| Recall@5 | **100%** |
| Recall@10 | **100%** |
| MRR | **0.850** |

---

## Risultati Chiave EXP-013 (Enrichment Torrente)

| Metrica | Valore |
|---------|--------|
| Chunk processati | 595 |
| Entità create | 1,909 |
| Relazioni create | 1,316 |
| Token input | 1.2M |
| Durata | ~45 min |
| Modello | Gemini 2.5 Flash |

---

## Risultati Chiave EXP-014 (Full Ingestion Ottimizzato)

| Metrica | Valore | Note |
|---------|--------|------|
| Articoli processati | 887/887 | 100% copertura |
| Nodi grafo totali | 27,740 | +103% vs baseline |
| Relazioni totali | 43,935 | +1137% vs baseline |
| Embeddings multi-source | 5,926 | norma+spiegazione+ratio+massime |
| Entità estratte | 3,049 | +2,233 merge |
| Durata backbone | 1h 46m | 7.2s/articolo |

**Storage finale:**
| Storage | Contenuto |
|---------|-----------|
| FalkorDB | 27,740 nodi, 43,935 relazioni |
| Qdrant | 5,926 vectors (multi-source) |
| Bridge Table | 27,114 mappings |

---

## Risultati Chiave EXP-015 (RAG Validation Benchmark)

| Metrica | Valore | Target | Status |
|---------|--------|--------|--------|
| Recall@5 | 0.420 | ≥ 0.85 | ⚠️ Sotto target |
| MRR | 0.594 | ≥ 0.70 | ⚠️ Sotto target |
| Hit Rate@5 | 0.700 | - | - |
| Latenza full pipeline | 93.5ms | < 150ms | ✅ |
| Latenza Qdrant | 2.9ms | < 5ms | ✅ |

**Insight**: Query concettuali (Recall@5=61.1%) >> query normative (40%) >> query pratiche (24.2%)

**Finding principale**: `norma` (46.3%) > `spiegazione` (37.3%) per Recall

---

## Risultati Chiave EXP-016 (Semantic Benchmark)

| Metrica | Valore | Target | Status |
|---------|--------|--------|--------|
| NDCG@5 | 0.869 | ≥ 0.6 | ✅ |
| Queries with score=3 | 93.3% | ≥ 70% | ✅ |
| Queries with score≥2 | 96.7% | ≥ 90% | ✅ |
| MRR | 0.850 | - | Eccellente |
| Hit Rate@5 | 96.7% | - | - |

**Confronto EXP-015 vs EXP-016:**
| Metrica | EXP-015 | EXP-016 | Miglioramento |
|---------|---------|---------|---------------|
| MRR | 0.594 | 0.850 | +43% |
| Hit Rate@5 | 70% | 96.7% | +38% |

**Lesson**: Allineare test alle capacità effettive del sistema

---

*Ultimo aggiornamento: 2025-12-20*
