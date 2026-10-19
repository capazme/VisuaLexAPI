# EXP-022: Policy Gradient Simulation

> **Status**: 🟡 In Progress
> **Data Inizio**: 28 Dicembre 2024
> **Responsabile**: Sistema RLCF

---

## Obiettivo

Valutare l'efficacia del **GatingPolicy** (neural policy gradient) rispetto al routing rule-based tradizionale, misurando il miglioramento nella qualità del routing dopo training con feedback sintetici.

---

## Ipotesi

Il sistema di policy gradient migliora la qualità del routing di almeno il **10%** rispetto al baseline rule-based dopo **500 iterazioni** di feedback sintetici.

---

## Metodologia

### Fasi dell'Esperimento

#### 1. **Baseline Phase** (100 query)
- Routing basato su regole deterministiche
- Nessun apprendimento attivo
- Raccolta metriche di riferimento

#### 2. **Training Phase** (500 query)
- Attivazione policy gradient
- Feedback rate: 80%
- Aggiornamento pesi della policy ad ogni feedback
- Tracking convergenza e reward trend

#### 3. **Evaluation Phase** (100 query)
- Policy gradient freezata
- Confronto A/B con baseline
- Valutazione performance finale

### Feedback Sintetici

Il simulatore genera feedback realistici basati su:
- **Expert Quality Scores** (probabilità di successo per expert)
- **Query-Expert Match** (quanto la query è adatta a un expert)
- **Noise** (variabilità realistica)

Formula:
```
reward = base_quality(expert) * match_score(query, expert) + noise(σ=0.1)
```

---

## Metriche di Valutazione

### 1. **Expert Usage Distribution**
Distribuzione percentuale di routing verso ciascun expert:
- Literal Interpreter
- Systemic Interpreter
- Principles Interpreter
- Precedent Interpreter

**Target**: Bilanciamento ~25% per expert (con tolleranza 15-35%)

### 2. **Routing Accuracy**
Confronto routing decisions con gold standard (se disponibile)
- Precision per expert
- Recall per expert
- F1-Score complessivo

### 3. **Average Reward Trend**
Evoluzione del reward medio durante training:
- Moving average (window=50)
- Pendenza della curva
- Punto di convergenza

**Target**: Crescita +10% da baseline a evaluation

### 4. **Load Balance Score**
Indice di bilanciamento del carico tra expert:
```
LBS = 1 - std(expert_usage) / mean(expert_usage)
```
- 1.0 = perfetto bilanciamento
- 0.0 = tutto su un expert

**Target**: LBS > 0.75

### 5. **Policy Convergence**
Stabilità della policy nelle ultime 100 iterazioni:
- Variance delle routing decisions
- Entropy della distribuzione expert

**Target**: Variance < 0.05, Entropy > 1.0

---

## Configurazione

Vedi `config.yaml` per parametri completi.

### Parametri Chiave

| Parametro | Valore | Motivazione |
|-----------|--------|-------------|
| Input Dim | 768 | Embedding dimension standard |
| Hidden Dim | 256 | Sufficiente per 4 expert |
| Learning Rate | 0.0001 | Conservativo per stabilità |
| Baseline Decay | 0.99 | Lieve smoothing del baseline |
| Feedback Rate | 0.8 | Realistico (80% query con feedback) |

### Expert Quality (Baseline)

| Expert | Quality Score | Dominio Preferito |
|--------|---------------|-------------------|
| Literal | 0.75 | Interpretazione testuale, definizioni |
| Systemic | 0.70 | Relazioni tra norme, coerenza |
| Principles | 0.65 | Principi generali, ratio legis |
| Precedent | 0.80 | Giurisprudenza, casi simili |

---

## Risultati Attesi

### Success Criteria

1. **Reward Improvement**: +10% medio da baseline a evaluation
2. **Load Balance**: LBS > 0.75 in evaluation phase
3. **Convergence**: Policy stabile nelle ultime 100 iterazioni
4. **Expert Usage**: Nessun expert < 15% o > 35% in evaluation

### Output Files

- `results/metrics.json` - Metriche aggregate per fase
- `results/reward_trend.json` - Trend reward per iterazione
- `results/expert_usage.json` - Distribuzione routing decisions
- `results/convergence.json` - Analisi convergenza policy

---

## Limitazioni

1. **Feedback Sintetici**: Non rappresentano complessità reale del feedback umano
2. **Embedding Random**: Non catturano semantica delle query legali
3. **Expert Quality Statica**: In realtà varia per tipo di query
4. **Simulazione**: Non include latenza, errori network, ecc.

---

## Prossimi Passi

1. **EXP-023**: Validation con feedback umani reali
2. **EXP-024**: A/B testing in produzione (canary deployment)
3. **EXP-025**: Transfer learning da simulazione a produzione

---

## Log delle Esecuzioni

| Data | Risultato | Note |
|------|-----------|------|
| 2024-12-28 | - | Esperimento creato |

