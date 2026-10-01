# EXP-022 Quick Start Guide

> **Quick reference per eseguire l'esperimento policy gradient**

---

## TL;DR

```bash
# Esegui simulazione completa (700 query totali)
python scripts/exp022_policy_simulation.py

# Risultati in: docs/experiments/EXP-022_policy_gradient_simulation/results/
```

---

## Cosa Fa Questo Esperimento

Simula il training di una **neural policy** (GatingPolicy) per routing multi-expert e confronta le performance con il **routing rule-based** tradizionale.

### 3 Fasi

1. **Baseline** (100 query)
   - Routing basato su regole deterministiche (ExpertRouter)
   - Nessun apprendimento
   - Metriche di riferimento

2. **Training** (500 query)
   - Neural policy con REINFORCE + baseline
   - Feedback sintetici (80% feedback rate)
   - Aggiornamento pesi ad ogni feedback

3. **Evaluation** (100 query)
   - Policy frozen (no updates)
   - Confronto con baseline
   - Metriche finali

---

## Output Atteso

### Console

```
================================================================================
EXP-022 Policy Gradient Simulation - 2024-12-28 18:15:00
================================================================================

[INFO] Initialized GatingPolicy: input_dim=768, hidden_dim=256, ...
[INFO] Policy and router initialized

================================================================================
PHASE 1: BASELINE (Rule-Based Routing)
================================================================================

[INFO] Baseline progress: 20/100 queries
[INFO] Baseline progress: 40/100 queries
...

Baseline Results:
  Avg Reward: 0.673
  Expert Usage: {'literal': 0.28, 'systemic': 0.25, 'principles': 0.21, 'precedent': 0.26}
  Load Balance: 0.912
  Entropy: 1.382

================================================================================
PHASE 2: TRAINING (Policy Gradient)
================================================================================

[INFO] Training progress: 50/500 queries | Recent Avg Reward: 0.682 | Baseline: 0.675
[INFO] Training progress: 100/500 queries | Recent Avg Reward: 0.698 | Baseline: 0.691
...

Training Results:
  Avg Reward: 0.742
  Expert Usage: {'literal': 0.24, 'systemic': 0.27, 'principles': 0.23, 'precedent': 0.26}
  Load Balance: 0.954
  Entropy: 1.386
  Final Baseline: 0.738

================================================================================
PHASE 3: EVALUATION (Policy Frozen)
================================================================================

[INFO] Evaluation progress: 20/100 queries
...

Evaluation Results:
  Avg Reward: 0.751
  Expert Usage: {'literal': 0.23, 'systemic': 0.28, 'principles': 0.24, 'precedent': 0.25}
  Load Balance: 0.962
  Entropy: 1.384

================================================================================
FINAL ANALYSIS
================================================================================

Reward Improvement:
  Baseline: 0.673
  Evaluation: 0.751
  Improvement: +11.6%

Load Balance:
  Baseline: 0.912
  Evaluation: 0.962

Policy Entropy:
  Baseline: 1.382
  Evaluation: 1.384

================================================================================
SUCCESS: All criteria met!
  ✓ reward_success: True
  ✓ load_balance_success: True
  ✓ entropy_success: True
================================================================================

[INFO] Exported metrics to .../results/metrics.json
[INFO] Exported reward trend to .../results/reward_trend.json
[INFO] Exported expert usage to .../results/expert_usage.json
[INFO] Exported routing decisions to .../results/routing_decisions_*.json
[INFO] Exported convergence analysis to .../results/convergence.json

Experiment completed!
```

### File Generati

```
docs/experiments/EXP-022_policy_gradient_simulation/results/
├── metrics.json                        # Metriche aggregate
├── reward_trend.json                   # Reward per iterazione
├── expert_usage.json                   # Distribuzione expert
├── convergence.json                    # Analisi convergenza
├── routing_decisions_baseline.json     # Decisioni baseline (100)
├── routing_decisions_training.json     # Decisioni training (500)
└── routing_decisions_evaluation.json   # Decisioni evaluation (100)
```

---

## Interpretare i Risultati

### Success Criteria

| Criterio | Target | Significato |
|----------|--------|-------------|
| **Reward Improvement** | ≥ +10% | Policy gradient migliora reward medio |
| **Load Balance Score** | ≥ 0.75 | Routing bilanciato tra expert |
| **Policy Entropy** | ≥ 1.0 | Policy non troppo deterministica |
| **Expert Usage** | 15-35% | Nessun expert sotto/sopra-utilizzato |

### Metriche Chiave

- **Avg Reward**: Qualità media del routing (higher is better)
- **Load Balance Score**: `LBS = 1 - std(usage)/mean(usage)` (0=sbilanciato, 1=perfetto)
- **Policy Entropy**: `H(p) = -Σ p_i log(p_i)` (diversità routing)
- **Expert Usage**: % query routate a ciascun expert

---

## Personalizzare la Simulazione

### Modificare Config

Edita `config.yaml`:

```yaml
experiment:
  phases:
    baseline:
      num_queries: 50  # Riduci per test rapidi
    training:
      num_queries: 200  # Riduci per test rapidi
      feedback_rate: 0.9  # Aumenta feedback rate

policy:
  learning_rate: 0.001  # Aumenta per convergenza più rapida
  baseline_decay: 0.95  # Baseline più reattivo

simulation:
  random_seed: 123  # Cambia seed per run diversi
  expert_quality:
    literal: 0.80  # Modifica quality base expert
```

### Run Custom

```bash
python scripts/exp022_policy_simulation.py --config my_custom_config.yaml
```

---

## Troubleshooting

### Error: "Config file not found"

```bash
# Verifica path config
ls docs/experiments/EXP-022_policy_gradient_simulation/config.yaml
```

### Error: "Module not found"

```bash
# Attiva virtualenv
source .venv/bin/activate

# Installa dependencies
pip install -r requirements.txt
```

### Warning: "Not enough data for convergence analysis"

- Aumenta `experiment.phases.training.num_queries` in config.yaml
- Minimo 100 query per analisi convergenza

---

## Prossimi Passi

1. **Analisi Risultati**: Visualizza trend reward, distribuzione expert
2. **EXP-023**: Validation con feedback umani reali
3. **EXP-024**: A/B testing in produzione

---

## FAQ

**Q: Quanto tempo richiede?**
A: ~2-3 minuti per 700 query (dipende da CPU)

**Q: Posso usare GPU?**
A: Sì, modifica `policy.device: "cuda"` in config (se PyTorch + CUDA installati)

**Q: Come interpreto convergence.json?**
A:
- `variance < 0.05`: Policy stabile
- `trend_slope ≈ 0`: Reward non cresce/decresce
- `entropy > 1.0`: Policy diversificata

**Q: Posso cambiare numero di expert?**
A: Sì, ma richiede modifiche al codice (currently hardcoded a 4 expert)

---

*Per dettagli completi, vedi `README.md`*
