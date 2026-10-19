# EXP-018: Expert Comparison

## Obiettivo

Confrontare i 4 Expert interpretativi su 50 query giuridiche per valutare:
1. Accuracy del routing (query_type detection)
2. Distribuzione confidence per expert
3. Source type distribution
4. Execution time

## Design

### Expert Sotto Test

| Expert | Canone Ermeneutico | Focus |
|--------|-------------------|-------|
| LiteralExpert | Art. 12, I | "significato proprio delle parole" |
| SystemicExpert | Art. 12, I + Art. 14 | "connessione" + storico |
| PrinciplesExpert | Art. 12, II | "intenzione del legislatore" |
| PrecedentExpert | Prassi | Giurisprudenza |

### Query Dataset

50 query distribuite in 5 categorie (10 ciascuna):

1. **Definitional** (10): "Cos'è il contratto?", "Definizione di legittima difesa"
2. **Interpretive** (10): "Come interpretare l'art. 2043?"
3. **Procedural** (10): "Termini per la risoluzione del contratto?"
4. **Constitutional** (10): "Art. 3 Cost. e principio di uguaglianza"
5. **Jurisprudential** (10): "Orientamento Cassazione sul danno biologico"

### Metriche

```python
metrics = {
    "routing_accuracy": {
        "description": "% query correttamente classificate",
        "target": "> 80%"
    },
    "confidence_distribution": {
        "description": "Media e std confidence per expert",
        "target": "literal > 0.5 per definitional"
    },
    "source_coverage": {
        "description": "% query con almeno 1 fonte",
        "target": "> 90%"
    },
    "execution_time": {
        "description": "Latenza media per expert",
        "target": "< 5s per expert"
    }
}
```

## Esecuzione

```bash
# Richiede OPENROUTER_API_KEY
source .venv/bin/activate
python scripts/exp018_expert_comparison.py

# Output
# - docs/experiments/EXP-018_expert_comparison/results/responses.json
# - docs/experiments/EXP-018_expert_comparison/results/metrics.json
```

## Risultati

TBD dopo esecuzione.

## Note

- Richiede `OPENROUTER_API_KEY` in environment
- Usa `google/gemini-2.5-flash` come default LLM
- Timeout: 30s per expert
