# Policy Gradient - Guida all'uso

## Overview

Il modulo Policy Gradient fornisce training REINFORCE per le policy del sistema MERL-T:

1. **GatingPolicy**: Mappa query embedding → expert weights (softmax 4-dim)
2. **TraversalPolicy**: Mappa (query, relation_type) → relation weight
3. **PolicyGradientTrainer**: Trainer REINFORCE con baseline

## Moduli

### 1. ExecutionTrace

Traccia le azioni eseguite durante l'interpretazione con i loro log probabilities.

```python
from merlt.rlcf.execution_trace import ExecutionTrace, Action

# Crea trace
trace = ExecutionTrace(query_id="q001")

# Aggiungi azioni
trace.add_expert_selection(
    expert_type="literal",
    weight=0.7,
    log_prob=-0.357
)

trace.add_graph_traversal(
    relation_type="RIFERIMENTO",
    weight=0.8,
    log_prob=-0.223
)

# Summary
print(trace.summary())
# {
#   "query_id": "q001",
#   "num_actions": 2,
#   "action_types": {"expert_selection": 1, "graph_traversal": 1},
#   "total_log_prob": -0.58,
#   ...
# }
```

### 2. MultilevelFeedback

Feedback strutturato su 3 livelli: retrieval, reasoning, synthesis.

```python
from merlt.rlcf.multilevel_feedback import (
    MultilevelFeedback,
    RetrievalFeedback,
    ReasoningFeedback,
    SynthesisFeedback
)

# Feedback completo
feedback = MultilevelFeedback(
    query_id="q001",
    retrieval_feedback=RetrievalFeedback(
        precision=0.8,
        recall=0.7,
        sources_relevant=4,
        sources_total=5
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

# Overall score
score = feedback.overall_score()  # 0.82 (weighted average)

# Da singolo rating
simple_feedback = create_feedback_from_user_rating(
    query_id="q002",
    user_rating=0.75
)
```

### 3. Policy Gradient

Training REINFORCE per le policy.

#### GatingPolicy

```python
from merlt.rlcf.policy_gradient import GatingPolicy, PolicyGradientTrainer
import torch

# Crea policy
policy = GatingPolicy(input_dim=768, hidden_dim=256)

# Forward pass
query_emb = torch.randn(1, 768)  # Batch 1, embedding BERT
weights, log_probs = policy.forward(query_emb)

print(weights)
# tensor([[0.25, 0.30, 0.20, 0.25]])  # [literal, systemic, principles, precedent]

# Sample action (per inference)
weights, log_probs = policy.sample_action(query_emb, deterministic=True)
```

#### TraversalPolicy

```python
from merlt.rlcf.policy_gradient import TraversalPolicy

# Crea policy
policy = TraversalPolicy(input_dim=768, relation_dim=64, hidden_dim=128)

# Forward pass
query_emb = torch.randn(1, 768)
relation_idx = torch.tensor([0])  # RIFERIMENTO

weight, log_prob = policy.forward(query_emb, relation_idx)
print(weight)  # tensor([[0.73]])  # Weight per RIFERIMENTO
```

#### Training

```python
from merlt.rlcf.policy_gradient import PolicyGradientTrainer
from merlt.rlcf.execution_trace import ExecutionTrace
from merlt.rlcf.multilevel_feedback import MultilevelFeedback

# Setup
policy = GatingPolicy(input_dim=768)
trainer = PolicyGradientTrainer(policy, learning_rate=1e-4)

# Simula esecuzione
trace = ExecutionTrace(query_id="q001")
trace.add_expert_selection("literal", weight=0.7, log_prob=-0.357)
trace.add_expert_selection("systemic", weight=0.3, log_prob=-1.204)

# Feedback
feedback = MultilevelFeedback(
    query_id="q001",
    overall_rating=0.8
)

# Update
metrics = trainer.update_from_feedback(trace, feedback)
print(metrics)
# {
#   "loss": 0.234,
#   "reward": 0.8,
#   "baseline": 0.5,
#   "returns": 0.3,
#   "num_updates": 1
# }

# Batch update
traces = [trace1, trace2, trace3]
feedbacks = [fb1, fb2, fb3]
metrics = trainer.update_from_batch(traces, feedbacks)

# Save checkpoint
trainer.save_checkpoint("checkpoints/gating_policy_epoch10.pt")

# Load checkpoint
trainer.load_checkpoint("checkpoints/gating_policy_epoch10.pt")
```

## Pipeline Completa

### Scenario 1: Training Gating Policy

```python
# 1. Raccogli dati da RLCF
from merlt.rlcf.database import get_async_session
from merlt.rlcf.models import Feedback, Response
from merlt.rlcf.policy_gradient import create_gating_policy

# Setup
policy, trainer = create_gating_policy(
    input_dim=768,
    hidden_dim=256,
    checkpoint_path="checkpoints/latest.pt"  # Resume se esiste
)

# 2. Training loop
async with get_async_session() as db:
    # Fetch feedback recente
    feedbacks = await db.execute(
        select(Feedback)
        .where(Feedback.submitted_at >= cutoff)
        .limit(100)
    )

    for fb in feedbacks:
        # Ricostruisci trace dalla Response
        response = await db.get(Response, fb.response_id)
        trace = reconstruct_trace_from_response(response)

        # Converti feedback
        multilevel_fb = convert_rlcf_to_multilevel(fb)

        # Update policy
        metrics = trainer.update_from_feedback(trace, multilevel_fb)

        if metrics["num_updates"] % 100 == 0:
            # Save checkpoint
            trainer.save_checkpoint(
                f"checkpoints/gating_epoch{metrics['num_updates']}.pt"
            )
```

### Scenario 2: Inference con Policy Trainata

```python
from merlt.rlcf.policy_gradient import GatingPolicy

# Load trained policy
policy = GatingPolicy(input_dim=768)
trainer = PolicyGradientTrainer(policy)
trainer.load_checkpoint("checkpoints/best_policy.pt")

policy.eval()

# Inference
query_emb = encode_query("Cos'è la legittima difesa?")
weights, _ = policy.sample_action(query_emb, deterministic=True)

print(f"Expert weights: {weights}")
# tensor([[0.15, 0.25, 0.45, 0.15]])
#         ^literal ^systemic ^principles ^precedent

# Usa weights nel MultiExpertOrchestrator
from merlt.experts.orchestrator import MultiExpertOrchestrator

orchestrator = MultiExpertOrchestrator()
# Override router con policy weights
response = await orchestrator.process_with_weights(
    query="Cos'è la legittima difesa?",
    expert_weights={
        "literal": weights[0][0].item(),
        "systemic": weights[0][1].item(),
        "principles": weights[0][2].item(),
        "precedent": weights[0][3].item()
    }
)
```

### Scenario 3: A/B Testing Policy vs Router

```python
# Confronta router rule-based vs policy trainata

# A: Router rule-based
from merlt.experts.router import ExpertRouter
router = ExpertRouter()
routing_decision = await router.route(context)

# B: Policy trainata
policy_weights, _ = policy.sample_action(query_emb, deterministic=True)

# Esegui entrambi
response_router = await orchestrator.process_with_weights(
    query=query,
    expert_weights=routing_decision.expert_weights
)

response_policy = await orchestrator.process_with_weights(
    query=query,
    expert_weights={
        "literal": policy_weights[0][0].item(),
        "systemic": policy_weights[0][1].item(),
        "principles": policy_weights[0][2].item(),
        "precedent": policy_weights[0][3].item()
    }
)

# Raccogli feedback
feedback_router = get_user_feedback(response_router)
feedback_policy = get_user_feedback(response_policy)

print(f"Router score: {feedback_router.overall_score()}")
print(f"Policy score: {feedback_policy.overall_score()}")
```

## Best Practices

### 1. Baseline Moving Average

Il baseline riduce la varianza di REINFORCE. Default: decay=0.99 (moving average).

```python
config = TrainerConfig(baseline_decay=0.99)
trainer = PolicyGradientTrainer(policy, config=config)
```

### 2. Gradient Clipping

Previene exploding gradients. Default: clip_grad_norm=0.5.

```python
config = TrainerConfig(clip_grad_norm=0.5)
```

### 3. Checkpoint Periodici

Salva checkpoint ogni N updates per evitare perdita di training.

```python
if trainer.num_updates % 100 == 0:
    trainer.save_checkpoint(f"checkpoints/policy_{trainer.num_updates}.pt")
```

### 4. Warmup con Dati Sintetici

Se pochi dati reali, usa synthetic traces per warmup.

```python
# Genera trace sintetici con reward simulati
synthetic_traces = generate_synthetic_traces(num=1000)

for trace in synthetic_traces:
    # Simula reward casuale
    trace.set_reward(random.uniform(0.4, 0.9))
    trainer.update_from_feedback(trace, simulated_feedback)
```

## Metriche di Valutazione

### Training Metrics

```python
stats = trainer.get_stats()
print(stats)
# {
#   "num_updates": 500,
#   "baseline": 0.62,  # Baseline corrente
#   "learning_rate": 0.0001,
#   "gamma": 1.0
# }
```

### Policy Performance

```python
# Valuta policy su validation set
validation_traces = load_validation_data()
validation_feedbacks = load_validation_feedbacks()

total_reward = 0.0
for trace, feedback in zip(validation_traces, validation_feedbacks):
    reward = trainer.compute_reward(feedback)
    total_reward += reward

avg_reward = total_reward / len(validation_traces)
print(f"Validation avg reward: {avg_reward}")
```

## Integrazione con RLCF Orchestrator

```python
from merlt.rlcf.orchestrator import RLCFOrchestrator

# Setup orchestrator
orchestrator = RLCFOrchestrator(db_session, weight_store, weight_learner)

# Record feedback (come prima)
result = await orchestrator.record_expert_feedback(
    expert_type="literal",
    response=expert_response,
    user_rating=0.8
)

# Ora possiamo anche aggiungere policy gradient update
# Ricostruisci trace
trace = ExecutionTrace(query_id=result["task_id"])
# ... popola trace dalle azioni eseguite ...

# Converti feedback a MultilevelFeedback
multilevel_fb = MultilevelFeedback(
    query_id=result["task_id"],
    overall_rating=user_rating
)

# Update policy
policy_metrics = trainer.update_from_feedback(trace, multilevel_fb)

# Log
log.info(
    "Policy updated alongside weights",
    policy_loss=policy_metrics["loss"],
    policy_baseline=policy_metrics["baseline"]
)
```

## Roadmap

### Phase 1 (Corrente)
- ✅ ExecutionTrace per tracciamento azioni
- ✅ MultilevelFeedback per feedback strutturato
- ✅ GatingPolicy per expert selection
- ✅ TraversalPolicy per graph traversal
- ✅ PolicyGradientTrainer con REINFORCE

### Phase 2 (Prossimo)
- [ ] Integrazione in MultiExpertOrchestrator
- [ ] Collection automatica trace durante inference
- [ ] A/B testing policy vs router
- [ ] Dashboard per monitoring training

### Phase 3 (Futuro)
- [ ] PPO trainer (più sample-efficient di REINFORCE)
- [ ] Multi-task learning (gating + traversal insieme)
- [ ] Curriculum learning (easy → hard queries)
- [ ] Meta-learning per adattamento rapido

## Riferimenti

- **Paper**: "Simple Statistical Gradient-Following Algorithms for Connectionist Reinforcement Learning" (Williams, 1992) - REINFORCE
- **Baseline**: "High-Dimensional Continuous Control Using Generalized Advantage Estimation" (Schulman et al., 2015)
- **Codebase**: Pattern da `merlt/disagreement/` (lazy torch imports, production-ready)
