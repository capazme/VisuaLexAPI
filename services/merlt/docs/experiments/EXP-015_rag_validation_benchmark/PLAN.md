# EXP-015: RAG Validation & Bridge Benchmark

> **Status**: PLANNED
> **Data**: 2025-12-15
> **Autore**: Claude Code + User
> **Capitolo Tesi**: Validazione Empirica del Sistema RAG Ibrido

---

## 1. Overview

### 1.1 Obiettivo

Validare empiricamente la qualità del sistema RAG ibrido MERL-T attraverso:
1. **Benchmark semantico** su 887 articoli del Libro IV Codice Civile
2. **Confronto multi-source** embeddings (norma vs spiegazione vs ratio vs massime)
3. **Benchmark latenza** Bridge Table vs alternative tradizionali

### 1.2 Research Questions

- [x] **RQ3**: Enrichment Brocardi aggiunge valore misurabile? → Confronto embedding sources
- [ ] **RQ4**: Bridge Table riduce latenza vs join runtime? → Benchmark formale
- [ ] **RQ7** (nuovo): Multi-source embeddings migliorano Recall su query specializzate?

### 1.3 Ipotesi

| ID | Ipotesi | Rationale |
|----|---------|-----------|
| H1 | Recall@5 ≥ 90% per query concettuali | Il dataset è denso (887 articoli correlati) |
| H2 | `spiegazione` embeddings outperform `norma` per query in linguaggio naturale | Le spiegazioni Brocardi sono didattiche |
| H3 | `massime` embeddings outperform altri per query giurisprudenziali | Le massime contengono interpretazioni concrete |
| H4 | Bridge lookup < 5ms (mediana) | PostgreSQL B-tree index su UUID |
| H5 | Bridge + Qdrant < 150ms end-to-end | Target architettura v2 |

### 1.4 Success Criteria

| Criterio | Threshold | Misurazione |
|----------|-----------|-------------|
| Recall@5 (generale) | ≥ 85% | Hit rate sul gold standard |
| MRR (generale) | ≥ 0.70 | Mean Reciprocal Rank |
| Bridge lookup p50 | < 5ms | Latenza mediana |
| Bridge lookup p99 | < 20ms | Latenza 99° percentile |
| Full pipeline p50 | < 150ms | Query embedding → risultati |

---

## 2. Metodologia

### 2.1 Setup

```bash
# Versioni
Python: 3.12
Git commit: [hash EXP-014]
FalkorDB: latest (Docker)
Qdrant: 1.7+ (Docker)
PostgreSQL: 16 (Docker, port 5433)
```

### 2.2 Dataset

**Knowledge Graph (da EXP-014):**
| Componente | Contenuto |
|------------|-----------|
| FalkorDB | 27,740 nodi, 43,935 relazioni |
| Qdrant | 5,926 embeddings (1024-dim E5-large) |
| PostgreSQL | 27,114 bridge mappings |

**Gold Standard Query Set:**
| Categoria | N. Query | Descrizione |
|-----------|----------|-------------|
| Concettuali | 15 | "Cos'è [concetto]?" |
| Normative | 15 | "Art. X del codice civile" |
| Giurisprudenziali | 10 | "Sentenza su [tema]" |
| Casi pratici | 10 | "Come si risolve [situazione]?" |
| **Totale** | **50** | Query human-generated |

### 2.3 Architettura Test

```
┌─────────────────────────────────────────────────────────────┐
│                    BENCHMARK FRAMEWORK                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Query Gold  │───▶│  Embedding  │───▶│   Qdrant    │     │
│  │  Standard   │    │  (E5-large) │    │   Search    │     │
│  └─────────────┘    └─────────────┘    └──────┬──────┘     │
│                                               │            │
│                     ┌─────────────────────────┼──────┐     │
│                     │                         ▼      │     │
│                     │  VARIANT A         VARIANT B   │     │
│                     │  Solo Vector       Hybrid      │     │
│                     │                         │      │     │
│                     │                    ┌────▼────┐ │     │
│                     │                    │ Bridge  │ │     │
│                     │                    │ Table   │ │     │
│                     │                    └────┬────┘ │     │
│                     │                         │      │     │
│                     │                    ┌────▼────┐ │     │
│                     │                    │FalkorDB│ │     │
│                     │                    │ Graph  │ │     │
│                     │                    └────────┘ │     │
│                     └────────────────────────────────┘     │
│                                                             │
│  METRICHE RACCOLTE:                                        │
│  ├── Recall@1, @5, @10                                     │
│  ├── MRR (Mean Reciprocal Rank)                            │
│  ├── Latency (p50, p90, p99)                               │
│  ├── Source attribution (quale source ha trovato?)         │
│  └── Graph enrichment contribution                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Variabili

| Tipo | Nome | Valori |
|------|------|--------|
| **Indipendente** | source_type | `norma`, `spiegazione`, `ratio`, `massima`, `all` |
| **Indipendente** | retrieval_mode | `vector_only`, `hybrid` |
| **Indipendente** | query_category | `concettuale`, `normativa`, `giurisprudenziale`, `pratica` |
| **Dipendente** | Recall@K | [0, 1] |
| **Dipendente** | MRR | [0, 1] |
| **Dipendente** | Latency | ms |
| **Controllo** | top_k | 10 |
| **Controllo** | embedding_model | E5-large (1024-dim) |

---

## 3. Procedura

### 3.1 Fase 1: Creazione Gold Standard (1h)

1. **Generare 50 query** distribuite per categoria
2. **Annotare ground truth**: per ogni query, lista degli articoli rilevanti
3. **Validare con esperto di dominio** (l'utente stesso, studente di giurisprudenza)
4. **Salvare in** `gold_standard.json`

```json
{
  "queries": [
    {
      "id": "Q001",
      "text": "Cos'è l'obbligazione naturale?",
      "category": "concettuale",
      "expected_articles": ["urn:nir:...:art2034"],
      "relevant_urns": ["urn:nir:...:art2034", "urn:nir:...:art2035"],
      "source": "manual"
    }
  ]
}
```

### 3.2 Fase 2: RAG Benchmark (30min)

Per ogni query nel gold standard:

1. **Encode query** con E5-large
2. **Search Qdrant** con 5 varianti:
   - Solo `norma` embeddings
   - Solo `spiegazione` embeddings
   - Solo `ratio` embeddings
   - Solo `massima` embeddings
   - Tutti i source types
3. **Calcolare metriche** per ogni variante:
   - Hit@1, Hit@5, Hit@10
   - Reciprocal Rank
4. **Aggregare** per categoria e overall

### 3.3 Fase 3: Hybrid Retrieval Test (30min)

1. **Vector-only retrieval**: Qdrant search → risultati diretti
2. **Hybrid retrieval**: Qdrant → Bridge → Graph scoring
3. **Confrontare** Recall e MRR tra le due modalità
4. **Analizzare** quali query beneficiano del graph enrichment

### 3.4 Fase 4: Latency Benchmark (30min)

Per ogni operazione, misurare 1000 iterazioni:

| Operazione | Metodo |
|------------|--------|
| Query embedding | `embedding_service.encode_query_async()` |
| Qdrant search (top-20) | `qdrant.search()` |
| Bridge lookup (batch) | `bridge.get_nodes_for_chunk()` |
| Graph shortest path | `falkordb.shortest_path()` |
| Full pipeline | End-to-end |

Raccogliere: min, max, mean, median (p50), p90, p99

### 3.5 Fase 5: Analisi e Documentazione (2h)

1. **Generare tabelle comparative**
2. **Creare visualizzazioni** (heatmap Recall per category × source)
3. **Scrivere capitolo tesi** con formato accademico
4. **Aggiornare INDEX.md** e CURRENT_STATE.md

---

## 4. Deliverables

### 4.1 Codice

| File | Descrizione |
|------|-------------|
| `merlt/benchmark/rag_benchmark.py` | Framework di benchmark riutilizzabile |
| `merlt/benchmark/metrics.py` | Calcolo Recall@K, MRR, Hit Rate |
| `merlt/benchmark/gold_standard.py` | Loader e validator gold standard |
| `scripts/exp015_rag_benchmark.py` | Script esecuzione esperimento |
| `tests/benchmark/test_rag_benchmark.py` | Test del framework |

### 4.2 Dati

| File | Descrizione |
|------|-------------|
| `docs/experiments/EXP-015.../gold_standard.json` | 50 query annotate |
| `docs/experiments/EXP-015.../results.json` | Risultati completi |
| `docs/experiments/EXP-015.../latency_benchmark.json` | Misure latenza |

### 4.3 Documentazione

| File | Descrizione |
|------|-------------|
| `docs/experiments/EXP-015.../README.md` | Report completo |
| `docs/experiments/EXP-015.../THESIS_CHAPTER.md` | Capitolo tesi formattato |

---

## 5. Struttura Capitolo Tesi

```
CAPITOLO X: VALIDAZIONE EMPIRICA DEL SISTEMA RAG IBRIDO

X.1 Introduzione
    X.1.1 Obiettivi della validazione
    X.1.2 Research Questions

X.2 Metodologia
    X.2.1 Dataset e Gold Standard
    X.2.2 Metriche di valutazione (Recall, MRR, Latenza)
    X.2.3 Setup sperimentale

X.3 Esperimento 1: Multi-Source Embedding Comparison
    X.3.1 Design
    X.3.2 Risultati
    X.3.3 Discussione: Quale source per quale query?

X.4 Esperimento 2: Vector-Only vs Hybrid Retrieval
    X.4.1 Design
    X.4.2 Risultati
    X.4.3 Discussione: Quando il grafo aiuta?

X.5 Esperimento 3: Bridge Table Performance
    X.5.1 Design benchmark
    X.5.2 Risultati latenza
    X.5.3 Confronto con join tradizionali

X.6 Discussione Generale
    X.6.1 Risposte alle Research Questions
    X.6.2 Limitazioni
    X.6.3 Implicazioni per l'informatica giuridica

X.7 Conclusioni
```

---

## 6. Timeline Implementazione

| Step | Descrizione | Effort |
|------|-------------|--------|
| 1 | Creare `merlt/benchmark/` module | Implementation |
| 2 | Implementare `RAGBenchmark` class | Implementation |
| 3 | Implementare metriche (Recall, MRR) | Implementation |
| 4 | Creare gold standard (50 query) | Manual annotation |
| 5 | Eseguire benchmark RAG | Execution |
| 6 | Eseguire benchmark latency | Execution |
| 7 | Analizzare risultati | Analysis |
| 8 | Scrivere documentazione tesi | Documentation |

---

## 7. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|-------------|---------|-------------|
| Gold standard biased | Media | Alto | Review con tutor |
| Overfitting al dataset | Media | Medio | Cross-validation |
| Latency variabile | Alta | Basso | 1000 iterazioni + warm-up |

---

*Piano creato: 2025-12-15*
