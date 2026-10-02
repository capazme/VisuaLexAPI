# EXP-007: Full Pipeline End-to-End Validation

**Status**: COMPLETED
**Date**: 2025-12-08
**Research Questions**: RQ1-RQ4

---

## Obiettivo

Validare l'intera pipeline di ingestion end-to-end con tutti i componenti attivi:
- Brocardi enrichment (dottrina + massime)
- Bridge Table mappings
- Multivigenza relations
- Embedding generation

## Ipotesi

1. **H1**: La pipeline completa processa articoli con 100% success rate
2. **H2**: L'enrichment Brocardi funziona per tutti gli articoli con dati disponibili
3. **H3**: Le relazioni multivigenza vengono estratte correttamente
4. **H4**: I bridge mappings sono consistenti tra grafo e embeddings

## Dataset

- **Fonte**: Codice Civile Italiano, Art. 1453-1469
- **Articoli target**: 17 (Risoluzione del contratto)
- **Selezione**: Articoli con storia modificativa nota per validare multivigenza

## Metodologia

### Step 1: Ingestion
```python
from merlt import LegalKnowledgeGraph

kg = LegalKnowledgeGraph()
await kg.connect()

for art in range(1453, 1470):
    result = await kg.ingest_norm(
        tipo_atto="codice civile",
        articolo=str(art),
        include_brocardi=True,
        include_embeddings=True,
        include_bridge=True,
        include_multivigenza=True,
    )
```

### Step 2: Validazione
- Query FalkorDB per conteggio nodi e relazioni
- Query Qdrant per verificare embeddings
- Query PostgreSQL per bridge mappings
- Verifica relazioni multivigenza

## Metriche

| Metrica | Target | Risultato |
|---------|--------|-----------|
| Success rate | 100% | 100% ✅ |
| Brocardi enrichment | >90% | 100% ✅ |
| Jurisprudence coverage | >80% | 94% ✅ |
| Multivigenza detection | >0 | 5 relazioni ✅ |

## Dipendenze

- FalkorDB container attivo
- Qdrant container attivo
- PostgreSQL container attivo
- Brocardi.it accessibile

---

*Documento creato: 2025-12-08*
