# EXP-003: RAG Pipeline con Dataset Completo

> **Status**: PLANNED
> **Data creazione**: 2025-12-05
> **Prerequisiti**: EXP-001 (completato), EXP-002 (completato)

---

## Obiettivo

Testare la pipeline RAG con il dataset completo (12,321 vectors) per valutare:
1. Impatto delle massime embeddate sulla qualità del retrieval
2. Capacità di rispondere a query giurisprudenziali dirette
3. Prestazioni con dataset 5x più grande

---

## Ipotesi

### H1: Query giurisprudenziali trovano massime pertinenti
- **Predizione**: Query tipo "sentenza su X" trova massime rilevanti con score > 0.75
- **Metrica**: Precision@5 per query giurisprudenziali

### H2: Query normative trovano sia norme che giurisprudenza
- **Predizione**: Query tipo "responsabilità medico" trova Art. 1218 + massime correlate
- **Metrica**: Diversità tipologica nei top-10 risultati

### H3: Latenza rimane accettabile
- **Predizione**: < 500ms anche con 12K vectors
- **Metrica**: Tempo medio risposta

### H4: Graph enrichment arricchisce con dottrina
- **Predizione**: Massime trovate → norme collegate → dottrina via :commenta
- **Metrica**: % risultati con contesto completo (norma + dottrina + giurisprudenza)

---

## Metodologia

### Dataset di Test

| Tipo Query | Esempi | Target |
|------------|--------|--------|
| **Giurisprudenziale** | "sentenza responsabilità medico" | Massime |
| **Normativa** | "risoluzione contratto inadempimento" | Norme + Massime |
| **Mista** | "clausola risolutiva espressa" | Art. 1456 + Massime correlate |
| **Concettuale** | "buona fede contrattuale" | Traversal + Enrichment |

### Query Set (10 query bilanciate)

1. "Cos'è la risoluzione del contratto per inadempimento?" (normativa)
2. "Sentenze sulla clausola risolutiva espressa" (giurisprudenziale)
3. "Responsabilità del medico per danni al paziente" (mista)
4. "Obblighi del venditore nella compravendita" (normativa)
5. "Giurisprudenza sulla diffida ad adempiere" (giurisprudenziale)
6. "Cosa dice la Cassazione sul risarcimento del danno?" (giurisprudenziale)
7. "Eccezione di inadempimento nel contratto" (normativa)
8. "Risoluzione di diritto del contratto" (normativa)
9. "Sentenze recenti sulla caparra confirmatoria" (giurisprudenziale)
10. "Impossibilità sopravvenuta della prestazione" (mista)

### Metriche

| Metrica | Definizione | Target |
|---------|-------------|--------|
| **MRR** | Mean Reciprocal Rank | > 0.5 |
| **P@5** | Precision at 5 | > 0.6 |
| **Diversity** | % tipi diversi in top-10 | > 30% (almeno 2 tipi) |
| **Latency** | Tempo medio query | < 500ms |
| **Enrichment** | % con dottrina aggiunta | > 70% |

---

## Procedura

### Setup
```bash
# Verifica storage
docker-compose -f docker-compose.dev.yml ps
python -c "from qdrant_client import QdrantClient; print(QdrantClient().get_collection('merl_t_chunks').points_count)"
```

### Esecuzione
```bash
python scripts/test_rag_pipeline.py --queries 10 --output docs/experiments/EXP-003_rag_full_dataset/
```

### Analisi
1. Calcolo metriche per ogni query
2. Breakdown per tipo query (normativa vs giurisprudenziale)
3. Analisi errori e mismatch

---

## Criteri di Successo

| Criterio | Soglia | Peso |
|----------|--------|------|
| C1: MRR | > 0.5 | 30% |
| C2: P@5 | > 0.6 | 30% |
| C3: Latency | < 500ms | 20% |
| C4: Enrichment | > 70% | 20% |

**Successo**: Score ponderato > 0.7

---

## Rischi e Mitigazioni

| Rischio | Probabilità | Mitigazione |
|---------|-------------|-------------|
| Massime dominano retrieval | Media | Bilanciamento con filtering per tipo |
| Query ambigue | Alta | Manual review per ground truth |
| Latenza aumentata | Bassa | HNSW index già configurato |

---

*Documento creato: 2025-12-05 00:55*
