# EXP-006: Ingestion Libro Primo Codice Penale

## Stato: COMPLETATO

**Data completamento**: 2025-12-07

---

## Obiettivo

Ingestion completa del Libro Primo del Codice Penale italiano (Art. 1-240) con:
- Ground truth da Normattiva
- Enrichment da Brocardi (massime, spiegazione, ratio)
- Validazione RAG pipeline con 12 query di test

---

## Risultati Principali

### 1. Ingestion

| Metrica | Valore |
|---------|--------|
| **Articoli totali** | 263 |
| **Articoli processati** | 263 (100%) |
| **Articoli falliti** | 0 |
| **Tempo totale** | ~17 minuti |

### 2. Brocardi Enrichment

| Metrica | Valore |
|---------|--------|
| **Con Brocardi** | 262/263 (99.6%) |
| **Con spiegazione** | 254/263 (96.6%) |
| **Massime totali** | 6,195 |
| **Media per articolo** | 23.6 |

**Top 5 articoli per massime:**
1. Art. 81 (concorso formale): 281 massime
2. Art. 62 (attenuanti comuni): 278 massime
3. Art. 240 (confisca): 234 massime
4. Art. 40 (rapporto di causalità): 219 massime
5. Art. 61 (aggravanti comuni): 218 massime

### 3. RAG Pipeline Test

| Metrica | Valore |
|---------|--------|
| **Query testate** | 12 |
| **Precision@5** | 0.200 (20%) |
| **Recall** | 0.528 (52.8%) |
| **MRR** | 0.562 |
| **Verdict** | ACCEPTABLE |

**Risultati per query:**

| # | Topic | P@5 | Recall | Note |
|---|-------|-----|--------|------|
| 1 | Principio legalità | 0.20 | 0.50 | Art. 1 trovato |
| 2 | Ergastolo | 0.20 | 0.50 | Art. 22 trovato |
| 3 | Attenuanti | 0.00 | 0.00 | Art. 62 non trovato |
| 4 | Aggravanti | 0.00 | 0.00 | Art. 61 non trovato |
| 5 | Concorso reati | 0.20 | 0.33 | Art. 81 trovato |
| 6 | Legittima difesa | 0.20 | 0.50 | Art. 52 trovato |
| 7 | Stato di necessità | 0.20 | 1.00 | Art. 54 trovato |
| 8 | Sospensione cond. | 0.60 | 1.00 | **Tutti trovati** |
| 9 | Confisca | 0.20 | 1.00 | Art. 240 trovato |
| 10 | Estinzione reato | 0.00 | 0.00 | Nessuno trovato |
| 11 | Tentativo | 0.20 | 1.00 | Art. 56 trovato |
| 12 | Concorso persone | 0.40 | 0.50 | Art. 110, 112 trovati |

---

## Statistiche Grafo

```
Nodi totali: 264
├── Codice: 1
└── Articoli: 263

Relazioni:
└── :contiene: 263

Struttura (Titoli):
├── Titolo I (Della legge penale): 80 art.
├── Titolo II (Delle pene): 59 art.
├── Titolo III (Del reato): 57 art.
├── Titolo IV (Dell'imputabilità): 21 art.
└── Altri: 46 art.
```

---

## File Generati

| File | Descrizione |
|------|-------------|
| `ground_truth.json` | 263 articoli con posizioni gerarchiche |
| `GROUND_TRUTH.md` | Documentazione ground truth |
| `ingestion_metrics.json` | Metriche dettagliate ingestion |
| `rag_results.json` | Risultati test RAG (12 query) |

---

## Script Utilizzati

1. `scripts/generate_ground_truth_cp.py` - Genera ground truth da Normattiva
2. `scripts/test_components_cp.py` - Testa componenti pre-ingestion
3. `scripts/ingest_libro_primo_cp.py` - Ingestion principale
4. `scripts/test_codice_penale.py` - Test RAG pipeline

---

## Osservazioni

### Punti di forza
- **100% success rate** sull'ingestion
- **99.6% Brocardi coverage** - quasi tutti gli articoli enriched
- **6,195 massime** giurisprudenziali raccolte
- Query specifiche (sospensione condizionale, confisca, tentativo) funzionano bene

### Aree di miglioramento
- **Attenuanti/Aggravanti**: articoli non trovati nonostante alto numero di massime
- **Estinzione reato**: categoria non ben rappresentata semanticamente
- **Precision bassa**: molti articoli non rilevanti nei top-5

### Possibili ottimizzazioni
1. Hybrid search (semantic + keyword) per termini tecnici
2. Query expansion con sinonimi giuridici
3. Re-ranking con cross-encoder
4. Chunking più fine per articoli lunghi

---

## Conclusioni

L'esperimento ha dimostrato che la pipeline di ingestion è **robusta e affidabile** per il Codice Penale. 
Il RAG funziona a livello **accettabile** ma richiede ottimizzazioni per query su termini tecnici specifici.

Il dataset è pronto per essere usato come:
- Benchmark per ottimizzazioni RAG
- Base per training RLCF
- Corpus per test di retrieval giuridico
