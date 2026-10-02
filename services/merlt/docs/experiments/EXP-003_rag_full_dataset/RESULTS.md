# EXP-003: Results

> **Status**: COMPLETED
> **Data esecuzione**: 2025-12-05 01:02
> **Durata**: ~3 minuti

---

## Executive Summary

Il test della pipeline RAG con dataset completo (12,321 vectors) ha **superato tutte le ipotesi**:

- **Latenza media**: 161.7ms (target: < 500ms) ✅
- **Enrichment rate**: 100% (target: > 70%) ✅
- **Score medio**: 0.87 (target: > 0.75) ✅
- **Diversità tipologica**: 68% Massime / 32% Norme ✅

**Risultato chiave**: Le massime embeddate permettono ricerca semantica diretta sulla giurisprudenza. Query tipo "Sentenze sulla clausola risolutiva" restituiscono immediatamente case law pertinente.

---

## Metriche Aggregate

| Metrica | Valore | Target | Status |
|---------|--------|--------|--------|
| Queries eseguite | 10 | 10 | ✅ |
| Latenza media | **161.7ms** | < 500ms | ✅ Eccellente |
| Latenza max | 726ms | < 1000ms | ✅ |
| Enrichment rate | **100%** | > 70% | ✅ Eccellente |
| Score medio | **0.87** | > 0.75 | ✅ |

---

## Type Distribution

| Tipo | Count | % | Note |
|------|-------|---|------|
| AttoGiudiziario (Massime) | 68 | **68%** | Dominano il retrieval |
| Norma | 32 | 32% | |

**Interpretazione**: Il sistema privilegia le massime perché:
1. Sono 79.3% del dataset (9,775 / 12,321)
2. Il testo delle massime è più discorsivo e simile al linguaggio naturale delle query
3. Questo è un comportamento desiderato per query giurisprudenziali

---

## Verifica Ipotesi

### H1: Query giurisprudenziali trovano massime ✅ VERIFICATA

| Query | Top-1 Type | Score | Risultato |
|-------|------------|-------|-----------|
| "Sentenze sulla clausola risolutiva" | Massima | 0.9013 | ✅ Cass. 167/2005 |
| "Giurisprudenza sulla diffida ad adempiere" | Massima | 0.9085 | ✅ Cass. 3851/1978 |
| "Cosa dice la Cassazione sul risarcimento?" | Massima | 0.8670 | ✅ Cass. 2154/2001 |
| "Sentenze sulla caparra confirmatoria" | Massima | 0.8815 | ✅ Cass. 2870/1978 |

### H2: Query normative trovano sia norme che giurisprudenza ✅ VERIFICATA

| Query | Norme | Massime | Note |
|-------|-------|---------|------|
| "Obblighi del venditore nella compravendita" | 9 | 1 | Normativa → Norme |
| "Risoluzione di diritto del contratto" | 7 | 3 | Mista |
| "Eccezione di inadempimento nel contratto" | 3 | 7 | Mista con prevalenza case law |

### H3: Latenza < 500ms ✅ VERIFICATA

| Query | Latency (ms) | Note |
|-------|--------------|------|
| Min | 43.0 | Query 9 (caparra) |
| Max | 726.4 | Query 1 (prima query, model warm-up) |
| Media | **161.7** | Eccellente |
| Mediana | ~55 | Senza warm-up |

### H4: Graph enrichment arricchisce con dottrina ✅ VERIFICATA

- **100%** dei risultati ha enrichment
- Norme: +Dottrina +Massime correlate
- Massime: +Norme interpretate

---

## Dettaglio per Query

### Query 1: "Cos'è la risoluzione del contratto per inadempimento?"

| Rank | Tipo | Identificatore | Score |
|------|------|----------------|-------|
| 1 | Massima | Cass. 3539/1976 | 0.8925 |
| 2 | Massima | Cass. 15070/2016 | 0.8900 |
| 3 | Norma | Art. 1453 | 0.8836 |

**Nota**: Top-1 è una massima che spiega esattamente la risoluzione. L'articolo 1453 è al 3° posto ma con score quasi identico.

### Query 2: "Sentenze sulla clausola risolutiva espressa"

| Rank | Tipo | Identificatore | Score |
|------|------|----------------|-------|
| 1 | Massima | Cass. 167/2005 | 0.9013 |
| 2 | Massima | Cass. 2553/2007 | 0.8936 |
| 3 | Massima | Cass. 4369/1997 | 0.8927 |

**Nota**: 100% massime nei top-5, tutte su Art. 1456. Comportamento perfetto per query giurisprudenziale.

### Query 3: "Responsabilità del medico per danni al paziente"

| Rank | Tipo | Identificatore | Score |
|------|------|----------------|-------|
| 1 | Massima | Cass. 15993/2011 | 0.8774 |
| 2 | Massima | Cass. 18497/2015 | 0.8764 |
| 3 | Massima | Cass. 15081/2025 | 0.8707 |

**Nota**: Trova giurisprudenza recente (2025!) su Art. 1218. Il sistema trova case law specifico anche per query su temi non presenti direttamente nel Libro IV.

---

## Issues Identificati

### 1. Duplicati da Chunking Comma-Level ⚠️

- Art. 1453 appare 4 volte nei risultati (stesso score)
- **Causa**: Ogni comma è un chunk separato
- **Impatto**: Medio - riduce diversità risultati
- **Fix suggerito**: Deduplicazione per URN articolo post-retrieval

### 2. Warm-up Latency

- Prima query: 726ms
- Query successive: ~50-150ms
- **Causa**: Model/cache warm-up
- **Impatto**: Basso - solo prima query

---

## Conclusioni

### Ipotesi Verificate

| Ipotesi | Status | Evidenza |
|---------|--------|----------|
| H1: Query giurisprudenziali → massime | ✅ | Score 0.86-0.91 |
| H2: Query normative → mix | ✅ | 32% norme, 68% massime |
| H3: Latenza < 500ms | ✅ | Media 161.7ms |
| H4: Enrichment con dottrina | ✅ | 100% rate |

### Contributi Chiave

1. **Massime embeddate funzionano**: Ricerca semantica diretta su giurisprudenza
2. **Graph enrichment efficace**: Ogni risultato ha contesto completo
3. **Prestazioni eccellenti**: < 200ms per query completa (search + enrichment)
4. **Type-awareness**: Il sistema distingue query normative vs giurisprudenziali

### Limiti

1. Duplicati da chunking (fix: deduplicazione)
2. Bias verso massime (79% dataset) - potrebbe servire bilanciamento
3. Bridge Table non usata per massime (solo graph direct)

### Prossimi Passi

1. **Deduplicazione post-retrieval** per consolidare chunks stesso articolo
2. **Hybrid ranking** con graph score per bilanciare norme/massime
3. **Benchmark formale** con ground truth per calcolo MRR/P@K precisi

---

## Artifacts

- `exp003_results_010240.json` - Raw results
- `scripts/test_rag_exp003.py` - Test script

---

*Documento creato: 2025-12-05 01:10*
