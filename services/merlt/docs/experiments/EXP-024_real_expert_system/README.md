# EXP-024: Real Expert System Integration

> **Data**: 29 Dicembre 2025
> **Prerequisito**: EXP-023 (Community Simulation)
> **Stato**: In Corso

---

## Obiettivo

Validare il sistema RLCF con componenti reali:
- **LegalKnowledgeGraph.interpret()**: Expert System completo
- **FalkorDB**: Graph database con 27,740 nodi
- **Qdrant**: Vector store con 5,926 chunks
- **Community simulata**: 20 utenti sintetici (da EXP-023)

---

## Differenze da EXP-023

| Aspetto | EXP-023 | EXP-024 |
|---------|---------|---------|
| Expert System | Simulato | **Reale** |
| Database | Mock | **FalkorDB + Qdrant** |
| Response | Template | **LLM Generated** |
| Graph Score | Random | **Path-based** |
| Latency | ~1ms | **100-500ms** |

---

## Architettura

```
                    Query (testo naturale)
                           │
                           ▼
              ┌────────────────────────┐
              │  LegalKnowledgeGraph   │
              │      .interpret()      │
              └────────────┬───────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   Qdrant    │ │  FalkorDB   │ │  Experts    │
    │  (vectors)  │ │   (graph)   │ │  (4 types)  │
    └─────────────┘ └─────────────┘ └─────────────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  InterpretationResult  │
              │  - synthesis           │
              │  - expert_contributions│
              │  - legal_basis         │
              │  - confidence          │
              └────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │    Community (20)      │
              │  - generate_feedback() │
              │  - update_authority()  │
              └────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   RLCF Loop Update     │
              │  - reward calculation  │
              │  - authority tracking  │
              └────────────────────────┘
```

---

## Query Set

Query specifiche per il contenuto del database (Libro IV - Obbligazioni):

```python
QUERIES = [
    "Cos'è la risoluzione del contratto secondo l'art. 1453 c.c.?",
    "Come funziona la diffida ad adempiere ex art. 1454?",
    "Quali sono gli effetti della risoluzione per inadempimento?",
    "Cos'è l'eccezione di inadempimento art. 1460?",
    "Come si calcola il risarcimento del danno contrattuale?",
    ...
]
```

---

## Metriche Raccolte

### Da InterpretationResult

| Metrica | Campo | Descrizione |
|---------|-------|-------------|
| Confidence | `result.confidence` | Confidence aggregata |
| Expert Count | `len(result.expert_contributions)` | Expert attivati |
| Legal Basis | `len(result.combined_legal_basis)` | Fonti citate |
| Execution Time | `result.execution_time_ms` | Latenza |

### Da Community

| Metrica | Descrizione |
|---------|-------------|
| Feedback Score | Rating utente [0-1] |
| Authority Evolution | Evoluzione authority per iterazione |
| Reward | feedback × authority × quality |

---

## Esecuzione

```bash
# Prerequisiti
docker-compose -f docker-compose.dev.yml up -d
source .venv/bin/activate

# Run esperimento
python scripts/exp024_real_expert.py

# Con API key per LLM
OPENROUTER_API_KEY=xxx python scripts/exp024_real_expert.py

# Dry run (senza LLM)
python scripts/exp024_real_expert.py --no-llm
```

---

## Output Attesi

```
results/
├── metrics.json              # Metriche per fase
├── interpretations/          # Risposte complete per query
│   ├── q_0001.json
│   ├── q_0002.json
│   └── ...
├── authority_evolution.json  # Authority community
├── latency_stats.json        # Statistiche latenza
└── comparison_exp023.json    # Confronto con simulazione
```

---

## Success Criteria

| Criterio | Target | Note |
|----------|--------|------|
| Queries processate | 100% | Nessun errore |
| Avg latency | < 2s | Per query |
| Confidence > 0.5 | > 80% | Query con contenuto in DB |
| Legal basis found | > 70% | Citazioni corrette |
