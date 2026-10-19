# EXP-006: Ingestion Libro Primo Codice Penale

**Status**: COMPLETED
**Date**: 2025-12-07
**Research Questions**: RQ1-RQ4

---

## Obiettivo

Estendere l'ingestion a una nuova fonte normativa (Codice Penale) per:
1. Validare la generalizzazione della pipeline oltre il Codice Civile
2. Testare il RAG con query penalistiche
3. Confermare le Research Questions RQ1-RQ4 su dominio diverso

## Ipotesi

1. **H1**: La pipeline funziona senza modifiche per il Codice Penale
2. **H2**: Brocardi ha copertura comparabile per il Codice Penale
3. **H3**: Le metriche RAG sono comparabili con EXP-001/003

## Dataset

- **Fonte**: Codice Penale Italiano, Libro Primo
- **Articoli target**: 263 (Art. 1-240)
- **Scope**: Principi generali, Delitti in generale, Contravvenzioni

## Metodologia

### Step 1: Ingestion Batch
```python
for art in range(1, 241):
    result = await kg.ingest_norm(
        tipo_atto="codice penale",
        articolo=str(art),
        include_brocardi=True,
        include_embeddings=True,
        include_bridge=True,
    )
```

### Step 2: RAG Validation
Test con 12 query penalistiche:
- "Cos'è la legittima difesa?"
- "Quando si applica l'attenuante?"
- "Differenza tra dolo e colpa"
- etc.

## Metriche

| Metrica | Target | Risultato |
|---------|--------|-----------|
| Success rate | 100% | 100% ✅ |
| Brocardi coverage | >90% | 99.6% ✅ |
| RAG Precision@5 | >0.15 | 0.200 ✅ |
| RAG Recall | >0.40 | 0.528 ✅ |

## Dipendenze

- FalkorDB, Qdrant, PostgreSQL attivi
- Brocardi.it accessibile
- EXP-001 completato (per confronto)

---

*Documento creato: 2025-12-07*
