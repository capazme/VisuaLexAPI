# EXP-019: End-to-End Pipeline Test

## Obiettivo

Validare il flusso completo `kg.interpret()` con tutti i componenti reali:
- FalkorDB (grafo)
- Qdrant (vettori)
- OpenRouter AI
- Multi-Expert System

## Design

### Scenari di Test

| Scenario | Descrizione | Verifica |
|----------|-------------|----------|
| Single Expert Dominance | Query che attiva principalmente 1 expert | Top expert > 0.5 weight |
| Multi-Expert Balance | Query che richiede più expert | >= 2 expert con weight > 0.2 |
| Graph Context Impact | Query con entità nel grafo | retrieved_chunks non vuoto |
| Timeout Handling | Query con timeout stretto | Graceful degradation |
| Error Recovery | Simula errori parziali | InterpretationResult con errors |

### Query Dataset

20 query rappresentative che coprono diversi scenari:

1. **Definitional** (4): Attivano LiteralExpert
2. **Constitutional** (4): Attivano PrinciplesExpert
3. **Jurisprudential** (4): Attivano PrecedentExpert
4. **Systemic** (4): Attivano SystemicExpert
5. **Complex** (4): Richiedono multi-expert

### Metriche

```python
metrics = {
    "pipeline_success_rate": "> 95%",
    "average_latency_ms": "< 5000ms",
    "expert_utilization": "All 4 experts used",
    "source_coverage": "> 80% with sources",
    "error_rate": "< 5%"
}
```

## Esecuzione

```bash
# Richiede:
# - Database running (docker-compose)
# - OPENROUTER_API_KEY

source .venv/bin/activate
docker-compose -f docker-compose.dev.yml up -d
python scripts/exp019_e2e_pipeline.py

# Output
# - docs/experiments/EXP-019_e2e_pipeline/results/responses.json
# - docs/experiments/EXP-019_e2e_pipeline/results/latency.json
# - docs/experiments/EXP-019_e2e_pipeline/results/quality_scores.md
```

## Risultati

TBD dopo esecuzione.

## Note

- Richiede database attivi (FalkorDB, Qdrant, PostgreSQL)
- Richiede `OPENROUTER_API_KEY` per AI
- Timeout default: 30s per expert
- Aggregation: weighted_average
