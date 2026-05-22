# GatingPolicy Integration

> **Versione**: 1.0
> **Data**: 28 Dicembre 2024
> **Componenti**: `merlt.rlcf.policy_gradient`, `merlt.experts.orchestrator`

---

## Overview

L'integrazione di **GatingPolicy** nel sistema multi-expert consente routing **neurale** invece del routing basato su regex.

### Vantaggi Neural Routing

| Aspetto | Regex Router | GatingPolicy |
|---------|--------------|--------------|
| **Decisioni** | Regole hardcoded | Apprese da feedback |
| **Adattamento** | Manuale | Automatico (REINFORCE) |
| **Contesto** | Pattern testuali | Embedding semantici |
| **Tracciabilità** | Limitata | Completa (ExecutionTrace) |
| **Performance** | Statica | Migliora nel tempo |

---

## Architettura

### Componenti

```
┌─────────────────────────────────────────────────┐
│         MultiExpertOrchestrator                 │
│                                                  │
│  ┌──────────────┐      ┌──────────────┐        │
│  │ Traditional  │      │   Neural     │        │
│  │   Router     │      │   Router     │        │
│  │  (Regex)     │      │ (GatingPolicy)│       │
│  └──────────────┘      └──────────────┘        │
│         │                      │                │
│         └──────────┬───────────┘                │
│                    │                            │
│              Expert Weights                     │
│                    │                            │
│  ┌─────────────────┴─────────────────┐         │
│  │  Execute Experts in Parallel      │         │
│  └───────────────────────────────────┘         │
│                    │                            │
│  ┌─────────────────┴─────────────────┐         │
│  │       GatingNetwork Aggregation   │         │
│  └───────────────────────────────────┘         │
│                    │                            │
│           AggregatedResponse                    │
│                    │                            │
│           ExecutionTrace (RLCF)                 │
└─────────────────────────────────────────────────┘
```

### Flow con GatingPolicy

```
1. Query Input
   ↓
2. EmbeddingService → query embedding [768-dim]
   ↓
3. GatingPolicy.forward(embedding) → expert_weights [4-dim] + log_probs
   ↓
4. ExecutionTrace registra azioni (expert_selection con log_prob)
   ↓
5. Execute Experts (literal, systemic, principles, precedent)
   ↓
6. GatingNetwork.aggregate() → AggregatedResponse
   ↓
7. Return (response, trace)
   ↓
8. Feedback → PolicyGradientTrainer.update_from_feedback()
   ↓
9. REINFORCE update dei pesi della policy
```

---

## API

### Setup Base

```python
from merlt.experts.orchestrator import MultiExpertOrchestrator
from merlt.rlcf.policy_gradient import GatingPolicy
from merlt.storage.vectors import EmbeddingService

# 1. Crea GatingPolicy
policy = GatingPolicy(
    input_dim=768,      # Dimensione embedding
    hidden_dim=256,     # Hidden layer size
    num_experts=4,      # literal, systemic, principles, precedent
    device="cpu"        # "cuda" se disponibile
)

# 2. Setup EmbeddingService
embedding_service = EmbeddingService()
await embedding_service.initialize()

# 3. Crea Orchestrator con policy
orchestrator = MultiExpertOrchestrator(
    gating_policy=policy,
    embedding_service=embedding_service
)
```

### Process con Neural Routing

```python
# Process query
response, trace = await orchestrator.process(
    query="Cos'è la legittima difesa?",
    return_trace=True  # ← Essenziale per RLCF
)

# Response
print(response.synthesis)
print(f"Confidence: {response.confidence}")

# Trace
print(f"Actions: {trace.num_actions}")
print(f"Total log prob: {trace.total_log_prob}")

# Expert selections
expert_selections = trace.get_actions_by_type("expert_selection")
for action in expert_selections:
    print(f"{action.parameters['expert_type']}: {action.parameters['weight']:.4f}")
```

### Update Policy da Feedback

```python
from merlt.rlcf.multilevel_feedback import MultilevelFeedback
from merlt.rlcf.policy_gradient import PolicyGradientTrainer

# 1. Raccogli feedback
feedback = MultilevelFeedback(
    query_id=trace.query_id,
    query_text=query,
    response_text=response.synthesis
)

feedback.add_rating("overall", rating=0.85)
feedback.add_rating("correctness", rating=0.9)

# 2. Setup trainer
trainer = PolicyGradientTrainer(policy)

# 3. Update policy
metrics = trainer.update_from_feedback(trace, feedback)

print(f"Loss: {metrics['loss']:.4f}")
print(f"Reward: {metrics['reward']:.4f}")

# 4. Save checkpoint
trainer.save_checkpoint("checkpoints/gating_policy_v1.pt")
```

---

## Backward Compatibility

L'orchestrator mantiene **backward compatibility** completa:

```python
# SENZA GatingPolicy → usa router tradizionale
orchestrator = MultiExpertOrchestrator()

# Process normale (senza trace)
response = await orchestrator.process(query)
```

Se `gating_policy=None`:
- Usa `ExpertRouter` (regex-based)
- NON genera `ExecutionTrace`
- Ritorna solo `AggregatedResponse`

---

## ExecutionTrace

### Struttura

```python
@dataclass
class ExecutionTrace:
    query_id: str
    actions: List[Action]  # Azioni eseguite
    total_log_prob: float  # Somma log_probs
    metadata: Dict
    reward: Optional[float]  # Da feedback
```

### Actions Tracciati

| Tipo | Quando | Parametri |
|------|--------|-----------|
| `expert_selection` | GatingPolicy routing | `expert_type`, `weight` |
| `graph_traversal` | TraversalPolicy (futuro) | `relation_type`, `weight` |
| `tool_use` | Tool invocation (futuro) | `tool_name`, `parameters` |

### Log Probabilities

Ogni action ha `log_prob` per REINFORCE:

```python
# GatingPolicy calcola log_probs automaticamente
weights, log_probs = policy.forward(query_embedding)

# Ogni expert selection viene tracciata
trace.add_expert_selection(
    expert_type="literal",
    weight=0.45,
    log_prob=-0.798  # log(0.45)
)
```

---

## Training Loop Completo

```python
async def rlcf_training_loop(
    orchestrator: MultiExpertOrchestrator,
    trainer: PolicyGradientTrainer,
    queries: List[str],
    num_epochs: int = 10
):
    """
    Training loop completo per GatingPolicy.
    """
    for epoch in range(num_epochs):
        traces = []
        feedbacks = []

        # 1. Raccogli traces
        for query in queries:
            response, trace = await orchestrator.process(
                query=query,
                return_trace=True
            )

            # 2. Simula feedback (in produzione: real users)
            feedback = simulate_feedback(query, response)

            traces.append(trace)
            feedbacks.append(feedback)

        # 3. Batch update
        metrics = trainer.update_from_batch(traces, feedbacks)

        print(f"Epoch {epoch}: loss={metrics['loss']:.4f}")

        # 4. Checkpoint
        if epoch % 5 == 0:
            trainer.save_checkpoint(f"checkpoints/epoch_{epoch}.pt")
```

---

## Testing

### Test Base

```bash
pytest tests/test_gating_policy_integration.py -v
```

### Test Coverage

- ✅ Orchestrator con GatingPolicy
- ✅ Neural routing vs traditional routing
- ✅ ExecutionTrace generation
- ✅ Expert selection con log_probs
- ✅ Backward compatibility
- ✅ Weight normalization (softmax)

---

## Device Handling

```python
# CPU (safe per test e produzione)
policy = GatingPolicy(device="cpu")

# CUDA (se GPU disponibile)
policy = GatingPolicy(device="cuda")

# MPS (Apple Silicon - evitare per ora)
# policy = GatingPolicy(device="mps")  # Può dare problemi
```

**Note**: Il codice usa forzatamente `device="cpu"` negli embedding tensors per evitare problemi MPS durante testing.

---

## Checkpoint Management

### Save

```python
trainer.save_checkpoint(
    "checkpoints/gating_policy_v1.pt",
    metadata={
        "epoch": 10,
        "avg_reward": 0.75,
        "description": "Post 100 feedback positivi"
    }
)
```

### Load

```python
policy = GatingPolicy(input_dim=768, hidden_dim=256)
trainer = PolicyGradientTrainer(policy)
metadata = trainer.load_checkpoint("checkpoints/gating_policy_v1.pt")

print(metadata["epoch"])  # 10
```

---

## Metriche Importanti

### Durante Inference

```python
trace.summary()
# {
#   "num_actions": 4,
#   "total_log_prob": -3.2,
#   "average_log_prob": -0.8,
#   "has_reward": True
# }
```

### Durante Training

```python
trainer.get_stats()
# {
#   "num_updates": 150,
#   "baseline": 0.72,
#   "learning_rate": 1e-4
# }
```

---

## Troubleshooting

### Issue: ImportError torch

```bash
# Soluzione: installa PyTorch
pip install torch
```

### Issue: Device MPS errors

```python
# Soluzione: usa CPU
policy = GatingPolicy(device="cpu")
```

### Issue: Embedding dimension mismatch

```python
# Verifica dimensione embedding
embedding = await embedding_service.encode_query_async(query)
print(len(embedding))  # Deve essere 768

# Policy deve avere input_dim matching
policy = GatingPolicy(input_dim=len(embedding))
```

---

## Roadmap

### Fase 1 (Completata)
- ✅ GatingPolicy integration
- ✅ ExecutionTrace generation
- ✅ Basic REINFORCE update

### Fase 2 (In sviluppo)
- 🔨 TraversalPolicy per graph navigation
- 🔨 Tool selection policy
- 🔨 Multi-policy coordination

### Fase 3 (Futuro)
- ⏳ PPO/A2C algorithms
- ⏳ Multi-agent RLCF
- ⏳ Online learning loop

---

## File Correlati

| File | Scopo |
|------|-------|
| `merlt/rlcf/policy_gradient.py` | GatingPolicy, TraversalPolicy, Trainer |
| `merlt/rlcf/execution_trace.py` | ExecutionTrace, Action |
| `merlt/experts/orchestrator.py` | Integration point |
| `examples/gating_policy_example.py` | End-to-end example |
| `tests/test_gating_policy_integration.py` | Integration tests |

---

## Conclusione

L'integrazione di **GatingPolicy** trasforma il sistema multi-expert da **rule-based** a **learning-based**, abilitando:

1. **Routing adattivo** che impara da feedback
2. **Tracciabilità completa** delle decisioni (ExecutionTrace)
3. **Miglioramento continuo** via REINFORCE
4. **Production-ready** con backward compatibility

Il sistema è ora pronto per il **loop RLCF completo** 🚀
