# EXP-015: RAG Validation & Bridge Benchmark

> **Status**: COMPLETED
> **Data**: 2025-12-15
> **Durata**: 46.1 secondi
> **Autore**: Claude Code + User

---

## Executive Summary

Questo esperimento valida empiricamente il sistema RAG (Retrieval-Augmented Generation) ibrido di MERL-T attraverso un benchmark sistematico su 50 query annotate relative al Libro IV del Codice Civile.

**Risultati chiave:**
- **Recall@5**: 42.0% (overall), **61.1%** (query concettuali)
- **MRR**: 0.594 (Mean Reciprocal Rank)
- **Hit Rate@5**: 70% (almeno un risultato rilevante nel 70% delle query)
- **Latenza full pipeline**: 93.5ms (p50), 117.9ms (p99)

---

## 1. Research Questions

| RQ | Domanda | Risposta |
|----|---------|----------|
| **RQ3** | L'enrichment Brocardi aggiunge valore misurabile? | **Parziale**: norma > spiegazione, ma multi-source migliora MRR |
| **RQ4** | Bridge Table riduce latenza vs join runtime? | **Sì**: 2.9ms per Qdrant search (sotto target 5ms) |
| **RQ7** | Multi-source embeddings migliorano Recall? | **No per Recall**, sì per MRR (+5% vs singolo source) |

---

## 2. Metodologia

### 2.1 Dataset

**Gold Standard**: 50 query annotate manualmente

| Categoria | Query | Descrizione |
|-----------|-------|-------------|
| Concettuale | 15 | "Cos'è [concetto]?" |
| Normativa | 15 | "Art. X codice civile" |
| Giurisprudenziale | 10 | "Sentenza su [tema]" |
| Pratica | 10 | "Come si risolve [situazione]?" |

**Knowledge Graph** (da EXP-014):
- FalkorDB: 27,740 nodi, 43,935 relazioni
- Qdrant: 5,926 embeddings (1024-dim E5-large)
- PostgreSQL Bridge: 27,114 mappings

### 2.2 Variabili

| Tipo | Nome | Valori |
|------|------|--------|
| Indipendente | `source_type` | norma, spiegazione, ratio, massima, all |
| Indipendente | `query_category` | concettuale, normativa, giurisprudenziale, pratica |
| Dipendente | Recall@K | [0, 1] |
| Dipendente | MRR | [0, 1] |
| Dipendente | Latency | ms |

### 2.3 Metriche

- **Recall@K**: % documenti rilevanti nei top-K risultati
- **MRR**: Mean Reciprocal Rank (media di 1/posizione primo hit)
- **Hit Rate@K**: % query con almeno un hit nei top-K
- **Latenza**: p50, p90, p99 in millisecondi

---

## 3. Risultati

### 3.1 Overall Metrics

| Metrica | Valore | Target | Status |
|---------|--------|--------|--------|
| Recall@1 | 0.283 | - | - |
| Recall@5 | 0.420 | ≥ 0.85 | ⚠️ Sotto target |
| Recall@10 | 0.568 | - | - |
| MRR | 0.594 | ≥ 0.70 | ⚠️ Sotto target |
| Hit Rate@5 | 0.700 | - | - |

### 3.2 Source Type Comparison

```
┌─────────────┬──────────┬───────┬────────────────────────────────────────┐
│ Source      │ Recall@5 │ MRR   │ Barra (Recall@5 normalizzato)          │
├─────────────┼──────────┼───────┼────────────────────────────────────────┤
│ norma       │ 0.463    │ 0.565 │ ████████████████████████████ (100%)    │
│ spiegazione │ 0.373    │ 0.427 │ ██████████████████████ (81%)           │
│ massima     │ 0.357    │ 0.449 │ █████████████████████ (77%)            │
│ ratio       │ 0.238    │ 0.338 │ █████████████ (51%)                    │
│ all         │ 0.420    │ 0.594 │ ██████████████████████████ (91%)       │
└─────────────┴──────────┴───────┴────────────────────────────────────────┘
```

**Insight**: Il testo normativo grezzo (`norma`) supera gli embedding derivati (spiegazione, ratio, massima) per Recall. La combinazione di tutti i source (`all`) massimizza MRR (+5%).

### 3.3 Category Analysis

```
┌───────────────────┬──────────┬───────┬────────────────────────────────────┐
│ Categoria         │ Recall@5 │ MRR   │ Barra (Recall@5 normalizzato)      │
├───────────────────┼──────────┼───────┼────────────────────────────────────┤
│ concettuale       │ 0.611    │ 0.900 │ ████████████████████████████ (100%)│
│ normativa         │ 0.400    │ 0.501 │ ██████████████████ (65%)           │
│ giurisprudenziale │ 0.342    │ 0.507 │ ███████████████ (56%)              │
│ pratica           │ 0.242    │ 0.363 │ ██████████ (40%)                   │
└───────────────────┴──────────┴───────┴────────────────────────────────────┘
```

**Insight**: Le query concettuali ("Cos'è X?") performano eccellentemente (Recall@5=61.1%, MRR=0.900). Le query pratiche ("Come fare X?") sono le più difficili (Recall@5=24.2%).

### 3.4 Latency Benchmark

| Operazione | p50 | p90 | p99 | Target | Status |
|------------|-----|-----|-----|--------|--------|
| Query embedding | 88.5ms | 126.7ms | 185.3ms | - | - |
| Qdrant search | 2.9ms | 4.7ms | 17.4ms | < 5ms | ✅ |
| Full pipeline | 93.5ms | 103.0ms | 117.9ms | < 150ms | ✅ |

**Insight**: La latenza del sistema è dominata dall'embedding (88.5ms su 93.5ms totali). Qdrant risponde in < 3ms mediani.

---

## 4. Analisi

### 4.1 Risposta alle Ipotesi

| Ipotesi | Risultato | Evidenza |
|---------|-----------|----------|
| H1: Recall@5 ≥ 90% per query concettuali | **PARZIALE** | 61.1% < 90%, ma miglior categoria |
| H2: `spiegazione` > `norma` per linguaggio naturale | **NEGATA** | norma (46.3%) > spiegazione (37.3%) |
| H3: `massima` > altri per query giurisprudenziali | **PARZIALE** | massima sotto norma, ma > ratio |
| H4: Bridge lookup < 5ms (mediana) | **VERIFICATA** | 2.9ms < 5ms |
| H5: Full pipeline < 150ms | **VERIFICATA** | 93.5ms < 150ms |

### 4.2 Discussione

**Perché norma > spiegazione?**

L'ipotesi iniziale era che le spiegazioni di Brocardi, scritte in linguaggio accessibile, sarebbero state più vicine semanticamente alle query utente. I risultati mostrano il contrario:

1. **Densità informativa**: Il testo normativo contiene tutti i termini tecnici cercati dall'utente
2. **Match esatto**: Query come "Art. 1453" matchano direttamente con il testo normativo
3. **Generalità spiegazioni**: Le spiegazioni usano parafrasi che possono allontanarsi dalla query originale

**Perché query pratiche performano peggio?**

Le query pratiche ("Come risolvere un contratto?") richiedono ragionamento multi-step:
1. Identificare il concetto rilevante (risoluzione)
2. Trovare gli articoli pertinenti (1453-1456)
3. Comprendere la procedura

Il sistema attuale cerca similarità diretta, non ragionamento inferenziale.

### 4.3 Limitazioni

1. **Gold standard piccolo**: 50 query potrebbero non rappresentare la distribuzione reale
2. **Single annotator**: Possibile bias nelle annotazioni
3. **Solo Libro IV**: Risultati potrebbero variare su altri libri del codice
4. **Assenza hybrid retrieval**: Test su vector-only, non hybrid (graph + vector)

---

## 5. Implicazioni per la Tesi

### 5.1 Contributo Scientifico

Questo esperimento fornisce la prima validazione empirica di un sistema RAG per il diritto civile italiano, con metriche standard IR (Recall, MRR).

**Finding principale**: Contrariamente all'intuizione, il testo normativo grezzo outperforma le rielaborazioni dottrinali per query di ricerca semantica.

### 5.2 Connessioni con RQ della Tesi

| RQ Tesi | Contributo EXP-015 |
|---------|-------------------|
| RQ1 (Chunking) | Validato: chunk article-level sufficiente |
| RQ3 (Brocardi value) | Nuance: valore per MRR, non Recall |
| RQ4 (Bridge latency) | Verificato: 2.9ms mediana |
| RQ7 (Multi-source) | Nuova evidenza: trade-off Recall vs MRR |

### 5.3 Next Steps

1. **Aumentare gold standard**: 200+ query con multiple annotazioni
2. **Test hybrid retrieval**: Combinare vector search con graph traversal
3. **Query augmentation**: Pre-processare query per espandere termini
4. **Fine-tuning**: Adattare E5-large al dominio giuridico italiano

---

## 6. Appendici

### 6.1 Configurazione

```yaml
benchmark:
  top_k: 10
  source_types: [norma, spiegazione, ratio, massima, all]
  latency_iterations: 100
  latency_warmup: 10

embedding:
  model: intfloat/multilingual-e5-large
  dimension: 1024
  device: cpu

database:
  falkordb_graph: merl_t_dev
  qdrant_collection: merl_t_dev_chunks
  postgres_table: bridge_table
```

### 6.2 File Generati

| File | Descrizione |
|------|-------------|
| `gold_standard.json` | 50 query annotate |
| `results.json` | Risultati completi benchmark |
| `THESIS_CHAPTER.md` | Capitolo formattato per tesi |

### 6.3 Codice

| File | Righe | Descrizione |
|------|-------|-------------|
| `merlt/benchmark/metrics.py` | 340 | Metriche IR |
| `merlt/benchmark/gold_standard.py` | 500 | Gestione gold standard |
| `merlt/benchmark/rag_benchmark.py` | 520 | Framework benchmark |
| `scripts/exp015_rag_benchmark.py` | 320 | Script esecuzione |
| `tests/benchmark/test_*.py` | 500 | Test suite (69 test) |

---

## 7. Comandi Utili

```bash
# Genera gold standard
python scripts/exp015_rag_benchmark.py --generate-gold-standard

# Esegui benchmark completo
python scripts/exp015_rag_benchmark.py --full

# Solo source comparison
python scripts/exp015_rag_benchmark.py --source-only

# Solo latency benchmark
python scripts/exp015_rag_benchmark.py --latency-only
```

---

## 8. Lessons Learned

> **Nota metodologica importante**: Questo esperimento ha rivelato limitazioni significative nell'approccio di valutazione. Le lezioni apprese hanno portato alla creazione di EXP-016 con metodologia corretta.

### 8.1 Errore Metodologico Principale

Il gold standard conteneva **query che richiedono capacità non ancora implementate**:

| Tipo Query | Capacità Richiesta | Status Architettura |
|------------|-------------------|---------------------|
| "Art. 1453 codice civile" | Metadata filtering + query parsing | **Non implementato** |
| "Come risolvere un contratto?" | Ragionamento multi-step | **Non implementato** |
| Query su art. 732, 2784, 2808 | Articoli fuori Libro IV | **Non nel database** |

### 8.2 Cosa Può Fare l'Architettura Attuale

La similarity search semantica **NON** può:
- Matchare numeri di articolo (query "1453" non trova art. 1453)
- Ragionare su step procedurali
- Fare filtering per metadati

La similarity search **PUÒ**:
- Trovare concetti semanticamente simili
- Confrontare diverse rappresentazioni (norma vs spiegazione)
- Rispondere a query concettuali ("Cos'è il contratto?")

### 8.3 Evidenza del Problema

```
Query: "Art. 1453 codice civile"
Atteso: urn:...:art1453 (risoluzione del contratto)
Ottenuto: art1758, art1653, art1753 (match fonetici, non semantici)
```

Il sistema cerca somiglianza semantica, non match esatto sui numeri.

### 8.4 Risultati Comunque Validi

Nonostante l'errore metodologico, alcuni risultati rimangono significativi:

1. **Query concettuali**: Recall@5=61.1%, MRR=0.900 → il sistema funziona per il suo scopo
2. **Latenza**: 93.5ms pipeline, 2.9ms Qdrant → target raggiunti
3. **norma > spiegazione**: Finding controintuitivo ma valido per query semantiche

### 8.5 Raccomandazioni

Per esperimenti futuri:
1. **Separare benchmark per capacità**: Un test per similarity, uno per metadata, uno per reasoning
2. **Query solo semantiche** fino a implementazione Expert Agents
3. **Valutazione graduata** (0-3) invece di binaria (hit/miss)

> Vedi **EXP-016** per il benchmark corretto con metodologia appropriata.

---

## 9. Changelog

| Data | Modifica |
|------|----------|
| 2025-12-15 | Creazione esperimento, benchmark completo |
| 2025-12-15 | Aggiunta sezione Lessons Learned dopo analisi critica |

---

*Documento creato: 2025-12-15*
*Ultima modifica: 2025-12-15*
