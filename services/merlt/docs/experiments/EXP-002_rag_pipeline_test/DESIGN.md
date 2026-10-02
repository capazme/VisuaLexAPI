# EXP-002: RAG Pipeline Test

> **Status**: PLANNED
> **Data creazione**: 2025-12-04

---

## Obiettivo

Validare il funzionamento end-to-end della pipeline RAG (Retrieval-Augmented Generation) che integra:
1. **Semantic Search** (Qdrant) - ricerca per similarità vettoriale
2. **Bridge Table** (PostgreSQL) - mapping chunk → graph node
3. **Graph Enrichment** (FalkorDB) - arricchimento con dottrina e giurisprudenza

---

## Research Questions

| RQ | Domanda | Metrica |
|----|---------|---------|
| RQ4 | La Bridge Table riduce latenza vs join runtime? | Latenza query (ms) |
| RQ5 | L'arricchimento grafo migliora la qualità del contesto? | Completezza risposta |
| RQ6 | Il sistema trova articoli pertinenti senza conoscerne il numero? | Precision@K, MRR |

---

## Ipotesi

1. **H1**: Una query in linguaggio naturale (es. "risoluzione del contratto") recupererà gli articoli pertinenti (Art. 1453-1458) con score > 0.7
2. **H2**: L'arricchimento grafo aggiungerà almeno 2 fonti aggiuntive (dottrina/giurisprudenza) per risultato
3. **H3**: Il tempo totale di retrieval sarà < 500ms per query

---

## Metodologia

### Fase 1: Setup Test Environment
- [x] Embedding model caricato (E5-large su MPS)
- [x] Qdrant con 2,546 vectors
- [x] Bridge Table con 2,546 mappings
- [x] FalkorDB con 3,462 nodi

### Fase 2: Test Queries
Query di test selezionate per coprire diversi scenari:

| # | Query | Articoli Attesi | Difficoltà |
|---|-------|-----------------|------------|
| 1 | "Cos'è la risoluzione del contratto per inadempimento?" | Art. 1453, 1454 | Facile |
| 2 | "Quando si può richiedere il risarcimento del danno?" | Art. 1218, 1223, 1226 | Media |
| 3 | "Cosa prevede la clausola risolutiva espressa?" | Art. 1456 | Facile |
| 4 | "Differenza tra mora e inadempimento" | Art. 1218, 1219, 1220 | Media |
| 5 | "Responsabilità del venditore per vizi della cosa" | Art. 1490-1497 | Complessa |
| 6 | "Obbligazioni solidali e divisibili" | Art. 1292-1313 | Complessa |
| 7 | "Come funziona la compensazione?" | Art. 1241-1252 | Media |
| 8 | "Cosa succede se il debitore non paga?" | Art. 1218, 1453, 1460 | Facile |
| 9 | "Contratto a favore di terzo" | Art. 1411-1413 | Media |
| 10 | "Nullità e annullabilità del contratto" | Art. 1418-1446 | Complessa |

### Fase 3: Metriche

Per ogni query misurare:

| Metrica | Descrizione | Target |
|---------|-------------|--------|
| **Latenza totale** | Tempo query end-to-end | < 500ms |
| **Latenza semantic** | Solo ricerca Qdrant | < 50ms |
| **Latenza bridge** | Solo lookup PostgreSQL | < 10ms |
| **Latenza graph** | Solo enrichment FalkorDB | < 100ms |
| **Precision@5** | Articoli pertinenti nei top-5 | > 0.6 |
| **MRR** | Mean Reciprocal Rank | > 0.5 |
| **Enrichment rate** | % risultati con dottrina/giuris. | > 70% |

### Fase 4: Analisi

1. **Quantitativa**: Tabella metriche per ogni query
2. **Qualitativa**: Valutazione manuale pertinenza risultati
3. **Errori**: Catalogazione query fallite e cause

---

## Script di Test

```bash
# Test singola query
python scripts/test_rag_pipeline.py "Cos'è la risoluzione del contratto?"

# Test interattivo
python scripts/test_rag_pipeline.py --interactive

# Test con più risultati
python scripts/test_rag_pipeline.py --top-k 10 "query"
```

---

## Dipendenze

### Prerequisiti
- [x] EXP-001 completato (dati in FalkorDB)
- [x] Embeddings generati (Qdrant popolato)
- [x] Bridge Table popolata

### Software
- Python 3.12
- sentence-transformers (E5-large)
- qdrant-client
- asyncpg
- falkordb

---

## Output Attesi

1. **EXECUTION.md**: Log di esecuzione con tempi e output
2. **RESULTS.md**: Tabella metriche per ogni query
3. **ANALYSIS.md**: Interpretazione risultati per tesi

---

## Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|-------------|---------|-------------|
| Query ambigue | Media | Basso | Test multiple reformulazioni |
| Embedding quality | Bassa | Alto | E5-large è state-of-the-art |
| Dati incompleti | Bassa | Medio | EXP-001 verificato al 100% |

---

## Timeline Stimata

| Fase | Durata |
|------|--------|
| Setup + prima query | 15 min |
| Test 10 queries | 30 min |
| Analisi risultati | 30 min |
| Documentazione | 15 min |
| **Totale** | **~1.5 ore** |

---

*Documento creato: 2025-12-04 20:00*
