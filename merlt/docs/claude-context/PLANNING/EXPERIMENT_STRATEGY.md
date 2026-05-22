# Strategia Esperimenti e Produzione

> **Data**: 8 Dicembre 2025
> **Fase**: Consolidamento pre-produzione

---

## Principio Guida

**Ogni esperimento è isolato e riproducibile.**

Invece di un unico database che cresce incrementalmente (rischio di corruzione/inconsistenza), ogni corpus viene ingested separatamente e poi unito in produzione.

---

## Struttura Directory

```
data/
├── backups/
│   └── experiments/           # Backup JSON di ogni esperimento
│       ├── costituzione/
│       │   ├── metadata.json
│       │   ├── graph.json     # FalkorDB nodes + relationships
│       │   └── vectors.json   # Qdrant embeddings
│       ├── libro_iv_cc/
│       │   ├── metadata.json
│       │   ├── graph.json
│       │   └── vectors.json
│       ├── libro_primo_cp/
│       │   └── ...
│       └── ...
├── falkordb/                  # Docker volume FalkorDB
├── qdrant/                    # Docker volume Qdrant
└── postgres/                  # Docker volume PostgreSQL
```

---

## Convenzione Database

### FalkorDB Graphs

| Graph Name | Scopo | Contenuto |
|------------|-------|-----------|
| `merl_t_test` | Test automatici | Dati test, puliti ad ogni run |
| `merl_t_exp_costituzione` | Esperimento | Solo Costituzione |
| `merl_t_exp_libro_iv_cc` | Esperimento | Solo Libro IV CC |
| `merl_t_exp_libro_primo_cp` | Esperimento | Solo Libro I CP |
| `merl_t_prod` | **Produzione** | Merge di tutti gli esperimenti |

### Qdrant Collections

| Collection Name | Scopo | Contenuto |
|-----------------|-------|-----------|
| `merl_t_test` | Test automatici | Dati test |
| `exp_costituzione` | Esperimento | Embeddings Costituzione |
| `exp_libro_iv_cc` | Esperimento | Embeddings Libro IV CC |
| `exp_libro_primo_cp` | Esperimento | Embeddings Libro I CP |
| `merl_t_prod` | **Produzione** | Merge di tutti |

---

## Workflow Esperimento

### 1. Ingestion Isolata

```bash
# Ogni esperimento usa graph/collection dedicati
python scripts/ingest_costituzione.py \
    --graph merl_t_exp_costituzione \
    --collection exp_costituzione
```

### 2. Validazione

```bash
# Test RAG e metriche su esperimento isolato
python scripts/validate_experiment.py \
    --graph merl_t_exp_costituzione \
    --collection exp_costituzione
```

### 3. Export Backup

```bash
# Salva in JSON per riproducibilità
python scripts/export_experiment.py \
    --name costituzione \
    --graph merl_t_exp_costituzione \
    --collection exp_costituzione
```

### 4. Merge in Produzione (quando ready)

```bash
# Importa da backup in grafo produzione
python scripts/merge_to_production.py \
    --experiments costituzione,libro_iv_cc,libro_primo_cp \
    --target-graph merl_t_prod \
    --target-collection merl_t_prod
```

---

## Esperimenti Disponibili

| Nome | Stato | Nodi | Embeddings | Note |
|------|-------|------|------------|------|
| `costituzione` | ✅ Backup | 985 | 139 | EXP-011 (single-source) |
| `libro_iv_cc` | 🔄 Ready | ~60k | ~7000 | 887 articoli, multi-source |
| `libro_primo_cp` | ❌ Non fatto | - | - | 263 articoli |

### Stima Embeddings Multi-Source

Con multi-source embeddings (norma + spiegazione + ratio + massime):
- **Costituzione**: 139 → ~420 embeddings (3x)
- **Libro IV CC**: 887 → ~7000 embeddings (8 per articolo medio)
- **Libro I CP**: 263 → ~2100 embeddings

---

## Script Disponibili

| Script | Scopo |
|--------|-------|
| `scripts/export_experiment.py` | Export FalkorDB + Qdrant → JSON |
| `scripts/import_experiment.py` | Import JSON → FalkorDB + Qdrant (TODO) |
| `scripts/merge_to_production.py` | Merge multiple experiments (TODO) |
| `scripts/validate_experiment.py` | RAG validation (TODO) |

---

## Vantaggi di Questo Approccio

1. **Riproducibilità**: Ogni esperimento può essere ricreato da zero
2. **Isolamento**: Bug in un esperimento non corrompe altri dati
3. **Versionamento**: I backup JSON possono essere committati in git
4. **Rollback facile**: Se produzione ha problemi, reimporta da backup
5. **Parallelismo**: Diversi esperimenti possono girare in parallelo

---

## Prossimi Passi

1. [x] Backup Costituzione
2. [ ] Creare `import_experiment.py`
3. [ ] Ingestion Libro IV CC isolata
4. [ ] Validazione RAG
5. [ ] Merge in produzione
