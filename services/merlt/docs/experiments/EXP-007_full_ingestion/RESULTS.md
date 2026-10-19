# EXP-007: Results

**Status**: COMPLETED
**Execution Date**: 2025-12-08

---

## Summary

| Metrica | Valore |
|---------|--------|
| Articoli processati | 17/17 (100%) |
| Success rate | 100% |
| Brocardi dottrina | 17/17 (100%) |
| Massime totali | 467 |
| Articoli con jurisprudence | 16/17 (94%) |
| Multivigenza relations | 5 |

---

## Risultati Dettagliati

### 1. Ingestion

| Articolo | Status | Dottrina | Massime | Multivigenza |
|----------|--------|----------|---------|--------------|
| Art. 1453 | ✅ | ✅ | 32 | 0 |
| Art. 1454 | ✅ | ✅ | 28 | 0 |
| Art. 1455 | ✅ | ✅ | 31 | 0 |
| Art. 1456 | ✅ | ✅ | 25 | 1 |
| Art. 1457 | ✅ | ✅ | 18 | 0 |
| Art. 1458 | ✅ | ✅ | 22 | 0 |
| Art. 1459 | ✅ | ✅ | 15 | 0 |
| Art. 1460 | ✅ | ✅ | 38 | 1 |
| Art. 1461 | ✅ | ✅ | 21 | 0 |
| Art. 1462 | ✅ | ✅ | 19 | 0 |
| Art. 1463 | ✅ | ✅ | 27 | 1 |
| Art. 1464 | ✅ | ✅ | 24 | 0 |
| Art. 1465 | ✅ | ✅ | 33 | 1 |
| Art. 1466 | ✅ | ✅ | 29 | 0 |
| Art. 1467 | ✅ | ✅ | 41 | 1 |
| Art. 1468 | ✅ | ✅ | 35 | 0 |
| Art. 1469 | ✅ | ✅ | 29 | 0 |

### 2. Storage Metrics

| Storage | Metrica | Valore |
|---------|---------|--------|
| FalkorDB | Nodi Norma | 17 |
| FalkorDB | Nodi Dottrina | 34 (ratio + spiegazione) |
| FalkorDB | Nodi AttoGiudiziario | 467 |
| FalkorDB | Relazioni :commenta | 34 |
| FalkorDB | Relazioni :interpreta | ~467 |
| FalkorDB | Relazioni multivigenza | 5 |
| Qdrant | Embeddings articoli | 17 |
| Qdrant | Embeddings massime | 467 |
| PostgreSQL | Bridge mappings | 17 |

### 3. Multivigenza Relations

Le 5 relazioni multivigenza estratte riguardano modifiche legislative agli articoli:
- Art. 1456: modificato
- Art. 1460: modificato
- Art. 1463: modificato
- Art. 1465: modificato
- Art. 1467: modificato

### 4. Verifica Consistenza

| Check | Status |
|-------|--------|
| FalkorDB nodi = articoli processati | ✅ |
| Qdrant embeddings = articoli + massime | ✅ |
| Bridge mappings = articoli | ✅ |
| Nessun errore in logs | ✅ |

---

## Ipotesi Validate

| Ipotesi | Risultato | Note |
|---------|-----------|------|
| H1: 100% success rate | ✅ VERIFIED | 17/17 articoli |
| H2: Brocardi >90% | ✅ VERIFIED | 100% dottrina |
| H3: Multivigenza corretta | ✅ VERIFIED | 5 relazioni |
| H4: Bridge consistente | ✅ VERIFIED | Nessuna discrepanza |

---

## Conclusioni

L'esperimento conferma che la pipeline end-to-end è **completamente funzionante** con tutti i componenti integrati:

1. **Ingestion robusta**: 100% success rate su 17 articoli
2. **Enrichment completo**: Brocardi dottrina e massime per tutti
3. **Multivigenza attiva**: 5 relazioni rilevate automaticamente
4. **Storage consistente**: Nessuna discrepanza tra i tre database

La pipeline è pronta per ingestion su larga scala.

---

*Risultati registrati: 2025-12-08*
