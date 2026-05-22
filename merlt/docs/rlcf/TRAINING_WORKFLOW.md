# RLCF Training Workflow

> **Versione**: 1.0 | **Data**: 30 Dicembre 2025

Guida completa per il training RLCF con persistence e checkpointing.

---

## Quick Start

```bash
# 1. Setup database (SQLite per dev, PostgreSQL per prod)
export RLCF_ASYNC_DATABASE_URL="sqlite+aiosqlite:///rlcf_dev.db"

# 2. Avvia training
python scripts/rlcf_training_batch.py --config config/rlcf_training.yaml
```

---

## Architettura del Loop RLCF

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RLCF TRAINING LOOP                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [1] USER QUERY                                                     │
│       │                                                             │
│       ▼                                                             │
│  [2] EXPERT SELECTION (GatingPolicy)                               │
│       │                                                             │
│       ▼                                                             │
│  [3] EXECUTION TRACE                                               │
│       │ ─── save_trace() ───▶ PostgreSQL/SQLite                    │
│       ▼                                                             │
│  [4] USER FEEDBACK                                                 │
│       │ ─── save_feedback() ─▶ PostgreSQL/SQLite                   │
│       ▼                                                             │
│  [5] TRAINING DATA RETRIEVAL                                       │
│       │ ◀── get_training_data()                                    │
│       ▼                                                             │
│  [6] POLICY UPDATE (REINFORCE)                                     │
│       │                                                             │
│       ▼                                                             │
│  [7] CHECKPOINT & VERSIONING                                       │
│       │ ─── save_policy_checkpoint() ─▶ PostgreSQL/SQLite          │
│       │ ─── activate_policy() ────────▶ Set active version         │
│       ▼                                                             │
│  [8] REPEAT                                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Componenti Principali

### 1. ExecutionTrace

Registra le azioni durante l'esecuzione di una query:

```python
from merlt.rlcf.execution_trace import ExecutionTrace

trace = ExecutionTrace(query_id="query_001")

# Registra selezione expert
trace.add_expert_selection(
    expert_type="literal",
    weight=0.7,
    log_prob=-0.357,
    metadata={
        "query_embedding": embedding.tolist(),
        "source": "gating_policy"
    }
)

# Registra traversal grafo
trace.add_graph_traversal(
    relation_type="RIFERIMENTO",
    weight=0.8,
    log_prob=-0.223,
    source_node="urn:norma:cc:art1337"
)
```

### 2. MultilevelFeedback

Feedback strutturato su 3 livelli:

```python
from merlt.rlcf.multilevel_feedback import (
    MultilevelFeedback,
    RetrievalFeedback,
    ReasoningFeedback,
    SynthesisFeedback,
)

feedback = MultilevelFeedback(
    query_id="query_001",
    retrieval_feedback=RetrievalFeedback(
        precision=0.8,
        recall=0.7,
        ranking_quality=0.85
    ),
    reasoning_feedback=ReasoningFeedback(
        logical_coherence=0.9,
        legal_soundness=0.85,
        citation_quality=0.8
    ),
    synthesis_feedback=SynthesisFeedback(
        clarity=0.9,
        completeness=0.85,
        usefulness=0.9
    )
)

# Score complessivo
reward = feedback.overall_score()  # 0.0 - 1.0
```

### 3. RLCFPersistence

Storage layer con PostgreSQL (prod) o SQLite (dev):

```python
from merlt.rlcf.persistence import create_persistence

# Crea persistence
persistence = await create_persistence(
    "postgresql+asyncpg://user:pass@localhost/rlcf"
)

# Salva trace
trace_id = await persistence.save_trace(
    trace=trace,
    policy_version="v1.0.0",
    query_text="Cos'è la legittima difesa?",
    expert_type="literal"
)

# Salva feedback
feedback_id = await persistence.save_feedback(
    trace_id=trace_id,
    feedback=feedback,
    user_id="user_001",
    user_authority=0.8
)

# Recupera dati per training
training_data = await persistence.get_training_data(
    policy_version="v1.0.0",
    limit=1000
)

# Salva checkpoint
await persistence.save_policy_checkpoint(
    version="v1.0.1",
    policy_type="gating",
    state_dict_path="/path/to/checkpoint.pt",
    config={"input_dim": 768, "hidden_dim": 256},
    training_metrics={"avg_reward": 0.75, "loss": 0.3}
)

# Attiva nuova policy
await persistence.activate_policy("v1.0.1", "gating")
```

### 4. SingleStepTrainer

Trainer REINFORCE ottimizzato per single-step:

```python
from merlt.rlcf.policy_gradient import GatingPolicy
from merlt.rlcf.single_step_trainer import SingleStepTrainer, SingleStepConfig

# Setup
policy = GatingPolicy(input_dim=768, hidden_dim=256, num_experts=4)
trainer = SingleStepTrainer(
    policy=policy,
    config=SingleStepConfig(
        learning_rate=0.001,
        entropy_coef=0.01,
        clip_grad_norm=1.0,
        baseline_decay=0.9
    )
)

# Training loop
for trace, feedback in training_data:
    metrics = trainer.update(trace, feedback)
    print(f"Loss: {metrics['loss']:.4f}, Reward: {metrics['reward']:.4f}")

# Statistiche
stats = trainer.get_stats()
print(f"Updates: {stats['num_updates']}, Baseline: {stats['baseline']:.4f}")
```

---

## Configurazione

### File: `config/rlcf_training.yaml`

```yaml
# Training generale
training:
  policy_type: gating     # gating, react
  min_feedback: 10        # Minimo feedback richiesto
  max_episodes: 1000      # Massimo episodi per sessione
  batch_size: 32
  learning_rate: 0.0001
  entropy_coef: 0.01      # Bonus esplorazione
  clip_grad_norm: 1.0     # Gradient clipping

# GatingPolicy configuration
gating_policy:
  input_dim: 768          # Dimensione embedding (E5-large)
  hidden_dim: 256         # Hidden layer size
  num_experts: 4          # literal, systemic, principles, precedent

# Checkpoint management
checkpoint:
  directory: models/policies
  save_frequency: 100     # Ogni N episodi
  keep_last_n: 5          # Mantieni ultimi N checkpoint

# Database
database:
  url: null               # Da env: RLCF_ASYNC_DATABASE_URL
  lookback_days: 30       # Considera feedback ultimi N giorni
```

---

## Environment Variables

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `RLCF_ASYNC_DATABASE_URL` | Connection string database | SQLite in-memory |
| `RLCF_CHECKPOINT_DIR` | Directory per checkpoint | `models/policies` |
| `RLCF_LOG_LEVEL` | Livello di logging | `INFO` |

### Esempi Connection String

```bash
# SQLite (development)
export RLCF_ASYNC_DATABASE_URL="sqlite+aiosqlite:///rlcf_dev.db"

# PostgreSQL (production)
export RLCF_ASYNC_DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/merl_t_rlcf"
```

---

## Script di Training

### Batch Training Completo

```bash
python scripts/rlcf_training_batch.py --config config/rlcf_training.yaml
```

Opzioni:
- `--config`: Path al file di configurazione
- `--policy-type`: Override tipo policy (gating/react)
- `--max-episodes`: Override max episodi
- `--dry-run`: Mostra configurazione senza eseguire

### Workflow Tipico

```bash
# 1. Verifica stato database
python -c "
from merlt.rlcf.persistence import create_persistence
import asyncio

async def check():
    p = await create_persistence()
    stats = await p.get_training_stats()
    print(f'Traces: {stats[\"total_traces\"]}')
    print(f'With feedback: {stats[\"traces_with_feedback\"]}')

asyncio.run(check())
"

# 2. Avvia training
python scripts/rlcf_training_batch.py --config config/rlcf_training.yaml

# 3. Verifica checkpoint
ls -la models/policies/
```

---

## Testing

### Test Persistence Layer

```bash
pytest tests/rlcf/test_persistence.py -v
```

### Test E2E Loop

```bash
pytest tests/rlcf/test_rlcf_loop_e2e.py -v
```

### Test Completo RLCF

```bash
pytest tests/rlcf/ -v
```

---

## Database Schema

### Tabelle Principali

| Tabella | Descrizione |
|---------|-------------|
| `rlcf_traces` | Execution traces con actions JSON |
| `rlcf_feedback` | Feedback multilevel denormalizzato |
| `policy_checkpoints` | Versioni policy con metadata |
| `training_sessions` | Tracking sessioni di training |

### Schema Semplificato

```sql
-- Traces
CREATE TABLE rlcf_traces (
    id UUID PRIMARY KEY,
    query_id VARCHAR(255) NOT NULL,
    policy_version VARCHAR(50),
    actions JSON NOT NULL,           -- ExecutionTrace serialized
    total_log_prob FLOAT,
    has_feedback BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP
);

-- Feedback
CREATE TABLE rlcf_feedback (
    id UUID PRIMARY KEY,
    trace_id UUID REFERENCES rlcf_traces(id),
    -- Denormalized fields for fast queries
    retrieval_precision FLOAT,
    retrieval_recall FLOAT,
    reasoning_coherence FLOAT,
    synthesis_clarity FLOAT,
    overall_score FLOAT,
    user_id VARCHAR(255),
    user_authority FLOAT,
    created_at TIMESTAMP
);

-- Policy Checkpoints
CREATE TABLE policy_checkpoints (
    id UUID PRIMARY KEY,
    version VARCHAR(50) NOT NULL,
    policy_type VARCHAR(50) NOT NULL,
    state_dict_path VARCHAR(500),
    config JSON,
    training_metrics JSON,
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP
);
```

---

## Troubleshooting

### Errore: "No traces with feedback found"

```bash
# Verifica che ci siano feedback nel database
python -c "
from merlt.rlcf.persistence import create_persistence
import asyncio

async def check():
    p = await create_persistence()
    stats = await p.get_training_stats()
    print(stats)

asyncio.run(check())
"
```

### Errore: "JSONB not supported"

Stai usando SQLite con JSONB. Passa a:
```bash
export RLCF_ASYNC_DATABASE_URL="sqlite+aiosqlite:///rlcf_dev.db"
```
Il sistema usa automaticamente JSON invece di JSONB per SQLite.

### Errore: "Policy checkpoint not found"

```bash
# Lista checkpoint disponibili
python -c "
from merlt.rlcf.persistence import create_persistence
import asyncio

async def check():
    p = await create_persistence()
    active = await p.get_active_policy('gating')
    print(f'Active: {active}')

asyncio.run(check())
"
```

---

## Best Practices

1. **Usa SQLite per development**, PostgreSQL per production
2. **Salva checkpoint frequentemente** (ogni 100 episodi)
3. **Monitora baseline**: dovrebbe stabilizzarsi attorno al reward medio
4. **Verifica traces prima del training**: devono avere `query_embedding` nei metadata
5. **Usa versioning semantico** per le policy (v1.0.0, v1.0.1, ...)

---

## Riferimenti

- [RLCF Overview](./RLCF.md)
- [Policy Gradient Implementation](./POLICY_GRADIENT_IMPLEMENTATION.md)
- [Policy Gradient Usage](./POLICY_GRADIENT_USAGE.md)
