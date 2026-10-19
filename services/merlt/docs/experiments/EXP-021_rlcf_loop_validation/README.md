# EXP-021: Validazione RLCF Loop End-to-End

> **Simulatore RLCF per validazione scientifica del loop di feedback**

## Panoramica

Questo esperimento valida il funzionamento del **RLCF (Reinforcement Learning from Corrective Feedback)** attraverso una simulazione controllata che non richiede una community reale di utenti.

### Cosa fa il simulatore

1. **Crea utenti sintetici** con profili realistici (esperti, studenti, specialisti)
2. **Esegue query legali** attraverso il sistema multi-expert reale
3. **Valuta le risposte** con metriche oggettive + LLM-as-Judge
4. **Genera feedback simulato** basato sui profili utente
5. **Aggiorna pesi e authority** attraverso il loop RLCF
6. **Produce output thesis-ready** (LaTeX, PDF, JSON)

### Quick Start

```bash
# Verifica che tutti i componenti siano disponibili
python scripts/run_rlcf_simulation.py --check-components

# Esecuzione con componenti reali (richiede ~10-20 min)
python scripts/run_rlcf_simulation.py --real --iterations 3

# Esecuzione veloce senza LLM Judge
python scripts/run_rlcf_simulation.py --real --no-llm-judge --iterations 2

# Dry run (mostra configurazione)
python scripts/run_rlcf_simulation.py --dry-run
```

## Documentazione Dettagliata

| Documento | Descrizione |
|-----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Architettura completa del simulatore |
| [METHODOLOGY.md](./METHODOLOGY.md) | Metodologia scientifica e protocollo |
| [STATISTICS.md](./STATISTICS.md) | Test statistici e correzioni |
| [CONFIGURATION.md](./CONFIGURATION.md) | Tutte le opzioni di configurazione |

---

## Obiettivo Scientifico

Validare il funzionamento completo del loop RLCF (Reinforcement Learning from Community Feedback):

1. User feedback viene registrato correttamente
2. Authority score si aggiorna in base alla qualità del feedback
3. Traversal weights vengono modificati dai feedback
4. Le modifiche ai pesi migliorano le risposte successive

## Ipotesi

**H1**: Il sistema registra correttamente i feedback utente (persistenza DB)

**H2**: L'authority score aumenta con feedback consistenti e di qualità

**H3**: I traversal weights convergono verso configurazioni ottimali dopo N feedback

**H4**: Le risposte migliorano (confidence + grounding rate) dopo l'applicazione dei weight updates

## Setup

### Prerequisiti

```bash
# Database PostgreSQL per RLCF
docker-compose -f docker-compose.dev.yml up -d

# Streamlit app
streamlit run apps/expert_debugger.py --server.port 8502
```

### Configurazione

```yaml
# Abilitare ReAct mode per tutti gli expert
use_react: true
react_max_iterations: 5

# Database RLCF
graph_name: merl_t_dev
```

## Protocollo

### Fase 1: Baseline (5 query)

1. Esegui 5 query diverse sul Libro IV c.c.
2. NON inviare feedback
3. Registra: confidence, grounding_rate, latency per ogni expert

### Fase 2: Feedback Training (10 query)

1. Esegui 10 query
2. Per ogni query, valuta tutti e 4 gli expert:
   - **accuracy**: correttezza giuridica
   - **utility**: utilità pratica
   - **transparency**: chiarezza fonti
3. Osserva:
   - Authority score evoluzione
   - Weight updates suggeriti
   - Feedback Analytics

### Fase 3: Post-Training (5 query)

1. Esegui le stesse 5 query della Fase 1
2. Confronta metriche prima/dopo

## Metriche

### 1. Feedback Persistence Rate

```
FPR = (feedback_persisted / feedback_submitted) * 100
```

Target: 100% (tutti i feedback salvati)

### 2. Authority Convergence

```
AC = authority_final / authority_initial
```

Target: AC > 1.2 (almeno 20% incremento)

### 3. Weight Delta Consistency

```
WDC = std(weight_deltas) / mean(weight_deltas)
```

Target: WDC < 0.5 (bassa variabilità = convergenza)

### 4. Response Improvement

```
RI = (confidence_post - confidence_pre) / confidence_pre
```

Target: RI > 0.1 (almeno 10% miglioramento)

## Query di Test

### Libro IV - Obbligazioni e Contratti

1. "Quali sono i requisiti essenziali del contratto?"
2. "Quando il debitore è in mora?"
3. "Come si determina il risarcimento del danno?"
4. "Quali sono le cause di risoluzione del contratto?"
5. "Quando è ammessa la compensazione tra debiti?"
6. "Quali sono gli effetti della nullità del contratto?"
7. "Come si perfeziona la cessione del credito?"
8. "Quali sono i limiti della responsabilità del debitore?"
9. "Quando opera la clausola risolutiva espressa?"
10. "Come si calcola la prescrizione delle obbligazioni?"

## Output Attesi

```
docs/experiments/EXP-021_rlcf_loop_validation/
├── results/
│   ├── baseline_metrics.json
│   ├── training_feedback.json
│   ├── post_training_metrics.json
│   ├── authority_evolution.png
│   ├── weight_convergence.png
│   └── improvement_comparison.png
└── analysis.md
```

## Criteri di Successo

| Metrica              | Target        | Critico   |
| -------------------- | ------------- | --------- |
| Feedback Persistence | 100%          | > 95%     |
| Authority Increase   | > 20%         | > 10%     |
| Weight Convergence   | WDC < 0.5     | WDC < 1.0 |
| Response Improvement | > 10%         | > 5%      |
| No Regression        | 0 regressioni | < 2       |

## Note Implementative

### RLCF Components Used

- `RLCFOrchestrator`: orchestrazione feedback → weights
- `AuthorityModule`: calcolo authority score
- `WeightLearner`: aggiornamento traversal weights
- `ExpertFeedback` model: persistenza DB

### Streamlit Features Tested

- Batch feedback form
- Authority score display
- Weight update suggestions
- Feedback Analytics charts
- Export feedback JSON

## Timeline

- **Giorno 1**: Fase 1 (Baseline) + Setup
- **Giorno 2**: Fase 2 (Training) - 5 query
- **Giorno 3**: Fase 2 (Training) - 5 query
- **Giorno 4**: Fase 3 (Post-Training) + Analisi

---

*Esperimento creato: 22/12/2025*
*Dipende da: EXP-020 (Expert System evaluation)*
