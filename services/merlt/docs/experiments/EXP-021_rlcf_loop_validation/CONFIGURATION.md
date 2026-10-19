# Configurazione del Simulatore

> **Guida completa a tutte le opzioni di configurazione**

## Quick Reference

```bash
# Comando base
python scripts/run_rlcf_simulation.py [OPTIONS]

# Opzioni principali
--real              # Usa componenti reali (LegalKnowledgeGraph, etc.)
--iterations N      # Numero iterazioni training (default: 5)
--no-llm-judge      # Disabilita LLM-as-Judge (più veloce)
--config PATH       # File configurazione YAML custom
--output-dir PATH   # Directory output
--verbose           # Output dettagliato
--dry-run           # Mostra config senza eseguire
--check-components  # Verifica disponibilità componenti
```

---

## Opzioni CLI Complete

### Modalità di Esecuzione

| Flag | Descrizione | Default |
|------|-------------|---------|
| `--real` | Usa componenti reali di MERL-T | False (mock) |
| `--dry-run` | Mostra configurazione senza eseguire | False |
| `--check-components` | Verifica componenti e esce | False |

### Configurazione Esperimento

| Flag | Tipo | Default | Descrizione |
|------|------|---------|-------------|
| `--config PATH` | str | auto | File YAML configurazione |
| `--iterations N` | int | 5 | Numero iterazioni training |
| `--seed N` | int | 42 | Random seed per riproducibilità |
| `--output-dir PATH` | str | `docs/experiments/.../results` | Directory output |

### Valutazione

| Flag | Descrizione | Default |
|------|-------------|---------|
| `--no-llm-judge` | Disabilita valutazione LLM soggettiva | False |

### Connessione Database

| Flag | Tipo | Default | Descrizione |
|------|------|---------|-------------|
| `--graph-name NAME` | str | `merl_t_dev` | Nome grafo FalkorDB |
| `--falkordb-port N` | int | 6380 | Porta FalkorDB |

### Debug

| Flag | Descrizione |
|------|-------------|
| `--verbose` | Output dettagliato (DEBUG level) |

---

## File di Configurazione YAML

### Percorso Default

```
merlt/rlcf/simulator/config/simulation.yaml
```

### Struttura Completa

```yaml
# ===========================================
# RLCF Simulator Configuration
# ===========================================

# Identificazione esperimento
experiment:
  name: "EXP-021_RLCF_Simulation"
  random_seed: 42

# Configurazione delle 3 fasi
phases:
  baseline:
    queries: 10              # Query iniziali senza feedback
    collect_feedback: false

  training:
    iterations: 5            # Numero cicli di training
    queries_per_iteration: 20
    collect_feedback: true   # Feedback attivo → aggiorna pesi

  post_training:
    queries: 10              # Stesse query del baseline
    collect_feedback: false

# Pool di utenti sintetici
users:
  pool_size: 20
  distribution:
    strict_expert: 3       # 15% - Professori
    domain_specialist: 5   # 25% - Avvocati
    lenient_student: 8     # 40% - Studenti
    random_noise: 4        # 20% - Utenti casuali

# Configurazione valutazione
evaluation:
  llm_judge:
    model: "${RLCF_JUDGE_MODEL:-google/gemini-2.5-flash}"
    temperature: 0.1       # Bassa per consistenza
    enabled: true
    provider: "openrouter"

  # Pesi per combinazione metriche
  objective:
    weight: 0.4            # 40% metriche automatiche

  subjective:
    weight: 0.6            # 60% valutazione LLM

# Parametri statistici
statistics:
  confidence_level: 0.95   # 95% confidence intervals
  min_effect_size: 0.3     # Cohen's d minimo
  bootstrap_samples: 1000  # Campioni per bootstrap CI
  use_bonferroni: true     # Correzione per test multipli

# Output
outputs:
  output_dir: "docs/experiments/EXP-021_rlcf_loop_validation/results"
  formats:
    - json                 # Trace completo
    - csv                  # Per analisi esterna
    - pdf                  # Figure per tesi
    - tex                  # Tabelle LaTeX
    - md                   # Report markdown
  streamlit_dashboard: true
  save_intermediate: true

# Soglie per le ipotesi
hypotheses:
  h1_persistence:
    target: 1.0            # 100% feedback salvati
    critical: 0.95         # Soglia critica 95%

  h2_authority:
    target: 0.20           # +20% authority
    critical: 0.10         # Soglia critica +10%

  h3_convergence:
    target: 0.5            # WDC < 0.5
    critical: 1.0          # Soglia critica WDC < 1.0

  h4_improvement:
    target: 0.10           # +10% quality
    critical: 0.05         # Soglia critica +5%
```

---

## Variabili d'Ambiente

### Obbligatorie per `--real`

| Variabile | Descrizione |
|-----------|-------------|
| `OPENROUTER_API_KEY` | API key per OpenRouter (expert + judge) |

### Opzionali

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `RLCF_JUDGE_MODEL` | `google/gemini-2.5-flash` | Modello LLM per judge |

### File .env

```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-...
RLCF_JUDGE_MODEL=google/gemini-2.5-flash

# Opzionali
FALKORDB_HOST=localhost
FALKORDB_PORT=6380
QDRANT_HOST=localhost
QDRANT_PORT=6333
```

---

## Modelli LLM Supportati

Via OpenRouter, puoi usare qualsiasi modello:

| Modello | ID | Costo | Note |
|---------|----|----|------|
| Gemini 2.5 Flash | `google/gemini-2.5-flash` | $ | Default, economico |
| Gemini 2.5 Pro | `google/gemini-2.5-pro` | $$ | Più accurato |
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` | $$$ | Alta qualità |
| GPT-4o Mini | `openai/gpt-4o-mini` | $ | Alternativa economica |
| GPT-4o | `openai/gpt-4o` | $$$$ | Massima qualità |

**Configurazione via env**:
```bash
RLCF_JUDGE_MODEL=anthropic/claude-3.5-sonnet python scripts/run_rlcf_simulation.py --real
```

---

## Esempi di Utilizzo

### 1. Test Rapido (Mock)

```bash
# Solo mock, nessuna API call
python scripts/run_rlcf_simulation.py --iterations 2 --no-llm-judge
```

### 2. Test Componenti Reali

```bash
# Verifica disponibilità
python scripts/run_rlcf_simulation.py --check-components

# Output atteso:
# [✓] LegalKnowledgeGraph
# [✓] RLCFOrchestrator
# [✓] WeightStore
# [✓] FalkorDB
# [✓] Qdrant
```

### 3. Esperimento Completo

```bash
# 5 iterazioni con LLM Judge
python scripts/run_rlcf_simulation.py --real --iterations 5
```

### 4. Esperimento Veloce

```bash
# Senza LLM Judge (solo metriche oggettive)
python scripts/run_rlcf_simulation.py --real --no-llm-judge --iterations 3
```

### 5. Configurazione Custom

```bash
# Con file YAML personalizzato
python scripts/run_rlcf_simulation.py --config my_config.yaml --real
```

### 6. Debug Verboso

```bash
python scripts/run_rlcf_simulation.py --real --verbose --iterations 1
```

### 7. Output in Directory Specifica

```bash
python scripts/run_rlcf_simulation.py --real --output-dir ./my_results
```

---

## Configurazione Profili Utente

### Modifica Distribuzione

```yaml
users:
  pool_size: 30  # Aumenta pool
  distribution:
    strict_expert: 5       # 16.7%
    domain_specialist: 8   # 26.7%
    lenient_student: 12    # 40%
    random_noise: 5        # 16.7%
```

### Profili Custom

Per aggiungere un nuovo profilo, modifica `merlt/rlcf/simulator/users.py`:

```python
PROFILES = {
    # ... profili esistenti ...

    "my_custom_profile": {
        "baseline_authority": 0.60,
        "credentials": {"specialization": "diritto tributario"},
        "evaluation_bias": {"accuracy": -0.05, "clarity": 0.0, "utility": -0.10},
        "noise_level": 0.10,
        "feedback_probability": 0.75,
        "description": "Commercialista, preciso su fiscalità"
    }
}
```

---

## Configurazione Metriche

### Pesi Valutazione

```yaml
evaluation:
  objective:
    weight: 0.4  # 40% metriche automatiche

  subjective:
    weight: 0.6  # 60% LLM Judge
```

**Nota**: I pesi devono sommare a 1.0.

### Soglie Ipotesi

```yaml
hypotheses:
  h4_improvement:
    target: 0.10     # Obiettivo: +10%
    critical: 0.05   # Minimo accettabile: +5%
```

Per rendere i test meno stringenti:

```yaml
hypotheses:
  h2_authority:
    target: 0.10     # Abbassato da 0.20
    critical: 0.05   # Abbassato da 0.10

  h4_improvement:
    target: 0.05     # Abbassato da 0.10
    critical: 0.02   # Abbassato da 0.05
```

---

## Configurazione Statistica

### Disabilitare Bonferroni

```yaml
statistics:
  use_bonferroni: false  # Usa α = 0.05 invece di 0.0125
```

### Aumentare Campioni Bootstrap

```yaml
statistics:
  bootstrap_samples: 5000  # Default: 1000
```

### Cambiare Livello di Confidenza

```yaml
statistics:
  confidence_level: 0.99  # 99% invece di 95%
```

---

## Troubleshooting

### Errore: OpenRouter API key not provided

```bash
# Assicurati che .env sia caricato
cat .env | grep OPENROUTER

# Verifica caricamento
python -c "from dotenv import load_dotenv; load_dotenv(); import os; print(os.environ.get('OPENROUTER_API_KEY', 'NOT SET')[:20])"
```

### Errore: FalkorDB connection failed

```bash
# Verifica container Docker
docker ps | grep falkor

# FalkorDB usa porta 6380, non 6379!
python scripts/run_rlcf_simulation.py --real --falkordb-port 6380
```

### Errore: Insufficient data for statistics

Aumenta il numero di query o iterazioni:

```yaml
phases:
  baseline:
    queries: 20  # Aumentato da 10

  training:
    iterations: 10  # Aumentato da 5
    queries_per_iteration: 30  # Aumentato da 20
```

---

## Performance Tips

| Configurazione | Tempo Stimato | Note |
|---------------|---------------|------|
| Mock, 2 iter | ~5 sec | Solo test infrastruttura |
| Real, no-judge, 2 iter | ~2 min | Solo metriche oggettive |
| Real, 3 iter | ~15-20 min | Configurazione bilanciata |
| Real, 5 iter | ~30-40 min | Configurazione completa |

**Per ridurre i tempi**:
1. Usa `--no-llm-judge` per test iniziali
2. Riduci `queries_per_iteration`
3. Usa modello più veloce (`gpt-4o-mini`)

---

*Guida configurazione per EXP-021 - RLCF Simulator*
