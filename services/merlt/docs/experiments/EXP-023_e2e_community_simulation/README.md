# EXP-023: End-to-End Community Simulation

> **Data**: 29 Dicembre 2025
> **Versione**: 1.0
> **Stato**: In Corso

---

## Obiettivo

Validare il sistema RLCF completo con una simulazione realistica di community:
- **GatingPolicy**: Selezione neural degli expert
- **TraversalPolicy**: Pesi neurali per graph traversal
- **Community**: 20 utenti con profili diversificati
- **Feedback Loop**: Training REINFORCE con baseline

---

## Ipotesi da Validare

| ID | Ipotesi | Metrica | Target |
|----|---------|---------|--------|
| H1 | Il reward medio migliora dopo training | `avg_reward` | +15% vs baseline |
| H2 | La policy converge (entropia stabile) | `policy_entropy` | variance < 0.05 |
| H3 | Expert usage bilanciato | `load_balance_score` | > 0.75 |
| H4 | Authority utenti correla con accuratezza | `authority_correlation` | r > 0.6 |
| H5 | TraversalPolicy migliora graph score | `graph_score_improvement` | +10% |

---

## Design Sperimentale

### Community Profile (20 utenti)

| Profilo | N | Authority Base | Caratteristiche |
|---------|---|----------------|-----------------|
| `senior_magistrate` | 2 | 0.90 | Feedback accurato, conservativo |
| `strict_expert` | 4 | 0.85 | Professori, rigorosi |
| `domain_specialist` | 6 | 0.70 | Avvocati specializzati |
| `lenient_student` | 6 | 0.25 | Studenti, sovrastimano |
| `random_noise` | 2 | 0.10 | Noise per robustezza |

### Query Set (60 query)

Distribuzione per dominio:
- **Diritto Civile**: 30 query (Libro IV - Obbligazioni)
- **Diritto Penale**: 15 query (se dati disponibili)
- **Diritto Costituzionale**: 15 query (principi generali)

Distribuzione per tipo:
- **Definitional** (25%): "Cos'è X?"
- **Interpretive** (30%): "Come si interpreta Y?"
- **Procedural** (20%): "Quali sono i termini per Z?"
- **Jurisprudential** (25%): "Come è stata applicata la norma W?"

### Fasi Esperimento

```
┌─────────────────────────────────────────────────────────────┐
│ FASE 1: BASELINE (20 query)                                 │
│ - Policy frozen (pesi random iniziali)                      │
│ - Raccolta metriche di riferimento                          │
│ - Nessun feedback applicato                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ FASE 2: TRAINING (200 query, 10 iterazioni × 20 query)      │
│ - Policy gradient con REINFORCE                             │
│ - Feedback sintetico da community                           │
│ - Update GatingPolicy + TraversalPolicy                     │
│ - Tracking: reward, entropy, authority evolution            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ FASE 3: EVALUATION (20 query, stesse di baseline)           │
│ - Policy frozen (pesi appresi)                              │
│ - Confronto metriche vs baseline                            │
│ - Test statistici (t-test, Wilcoxon)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Metriche Raccolte

### Metriche Primarie

| Metrica | Descrizione | Calcolo |
|---------|-------------|---------|
| `avg_reward` | Reward medio per query | media(feedback × authority) |
| `policy_entropy` | Entropia distribuzione expert | -Σ p_i log(p_i) |
| `load_balance_score` | Bilanciamento expert | 1 - std(usage)/mean(usage) |
| `graph_score_avg` | Score medio graph traversal | media(graph_score per retrieval) |
| `confidence_avg` | Confidence media risposte | media(expert.confidence) |

### Metriche Secondarie

| Metrica | Descrizione |
|---------|-------------|
| `expert_usage_distribution` | % query per expert |
| `authority_evolution` | Authority utenti per iterazione |
| `weight_evolution` | Pesi policy per iterazione |
| `convergence_iteration` | Iterazione di convergenza |
| `training_time_seconds` | Tempo totale training |

### Metriche di Qualità (da Simulator)

| Metrica | Fonte | Range |
|---------|-------|-------|
| `source_grounding` | ObjectiveMetrics | [0, 1] |
| `hallucination_rate` | ObjectiveMetrics | [0, 1] |
| `accuracy` | LLM Judge | [1, 5] |
| `clarity` | LLM Judge | [1, 5] |

---

## Architettura Tecnica

```
                    ┌──────────────────┐
                    │  QueryGenerator  │
                    │   (60 query)     │
                    └────────┬─────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                     PolicyManager                               │
│  ┌─────────────────┐           ┌──────────────────┐            │
│  │  GatingPolicy   │           │ TraversalPolicy  │            │
│  │  (768→4 exp)    │           │ (768+64→weight)  │            │
│  │  + log_prob     │           │ + log_prob       │            │
│  └────────┬────────┘           └────────┬─────────┘            │
└───────────┼─────────────────────────────┼──────────────────────┘
            │                             │
            ▼                             ▼
┌───────────────────────┐    ┌───────────────────────────────────┐
│   Expert Selection    │    │    GraphAwareRetriever            │
│   (literal, systemic, │    │    (Qdrant + FalkorDB)            │
│    principles,        │    │    con neural weights             │
│    precedent)         │    │                                   │
└───────────┬───────────┘    └───────────────┬───────────────────┘
            │                                 │
            └─────────────┬───────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ ExecutionTrace  │
                 │ (actions +      │
                 │  log_probs)     │
                 └────────┬────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │     UserPool          │
              │  (20 synthetic users) │
              │                       │
              │  FeedbackSynthesizer  │
              │  (objective+LLM)      │
              └───────────┬───────────┘
                          │
                          ▼
            ┌──────────────────────────┐
            │ PolicyGradientTrainer    │
            │ - REINFORCE              │
            │ - Moving avg baseline    │
            │ - Update both policies   │
            └──────────────────────────┘
```

---

## Output Attesi

```
results/
├── metrics.json              # Metriche aggregate per fase
├── reward_evolution.json     # Trend reward per iterazione
├── expert_usage.json         # Distribuzione expert per fase
├── authority_evolution.json  # Authority utenti per iterazione
├── weight_evolution.json     # Pesi policy per iterazione
├── convergence_analysis.json # Analisi convergenza
├── statistical_tests.json    # t-test, Wilcoxon, effect size
├── query_results/            # Risultati dettagliati per query
│   ├── baseline/
│   ├── training/
│   └── evaluation/
└── figures/                  # Grafici per tesi
    ├── reward_trend.pdf
    ├── expert_distribution.pdf
    ├── authority_convergence.pdf
    └── policy_entropy.pdf
```

---

## Esecuzione

```bash
# Setup ambiente
source .venv/bin/activate

# Esecuzione standard
python scripts/exp023_e2e_community.py

# Con config custom
python scripts/exp023_e2e_community.py --config path/to/config.yaml

# Dry run (senza LLM)
python scripts/exp023_e2e_community.py --dry-run

# Solo baseline
python scripts/exp023_e2e_community.py --phase baseline
```

---

## Criteri di Successo

| Criterio | Threshold | Note |
|----------|-----------|------|
| H1 passed | p < 0.05 | t-test su avg_reward |
| H2 passed | variance < 0.05 | Ultime 3 iterazioni |
| H3 passed | LBS > 0.75 | Nessun expert < 15% |
| H4 passed | r > 0.6 | Pearson correlation |
| H5 passed | improvement > 10% | graph_score post vs pre |

---

## Note Metodologiche

1. **Seed fisso**: random_seed=42 per riproducibilità
2. **Feedback rate**: 80% query ricevono feedback
3. **LLM Judge**: Gemini 2.5 Flash per valutazione soggettiva
4. **Baseline moving average**: γ=0.99 per stabilità REINFORCE
5. **Early stopping**: Se reward non migliora per 3 iterazioni

---

## Riferimenti

- EXP-021: Validazione Loop RLCF
- EXP-022: Policy Gradient Simulation
- `merlt/rlcf/simulator/`: Componenti simulator
- `merlt/rlcf/policy_gradient.py`: Policy networks
- `merlt/rlcf/policy_manager.py`: PolicyManager hub
