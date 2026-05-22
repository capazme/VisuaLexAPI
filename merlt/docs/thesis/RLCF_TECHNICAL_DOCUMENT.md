# MERL-T: Reinforcement Learning from Community Feedback

## Documento Tecnico per la Commissione Informatica

> **Autore**: Giuseppe Puzio
> **Data**: Dicembre 2025
> **Progetto**: MERL-T - Multi-Expert Reinforcement Learning for Legal Text
> **Repository**: https://github.com/gpuzio/MERL-T_alpha

---

## Abstract

Questo documento presenta l'architettura tecnica di **MERL-T**, un sistema di Active Learning che utilizza **Reinforcement Learning from Community Feedback (RLCF)** per migliorare iterativamente l'interpretazione di testi giuridici. Il sistema implementa un ciclo di apprendimento continuo dove il feedback di esperti giuridici viene utilizzato per aggiornare policy neurali che governano la selezione degli expert e il traversal del knowledge graph.

**Contributi tecnici principali:**
1. **GatingPolicy**: Rete neurale per routing dinamico tra expert interpretativi
2. **TraversalPolicy**: Policy per ottimizzare la navigazione nel grafo giuridico
3. **Dynamic Authority Scoring**: Sistema di pesatura del feedback basato su credenziali e track record
4. **Multi-Level Feedback**: Struttura gerarchica del feedback (retrieval, reasoning, synthesis)

---

## 1. Architettura del Sistema

### 1.1 Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MERL-T ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌─────────────────┐    ┌──────────────────┐                │
│  │  Query   │───▶│  GatingPolicy   │───▶│  Expert System   │                │
│  │  Input   │    │  (Neural Net)   │    │  (4 Interpreters)│                │
│  └──────────┘    └─────────────────┘    └────────┬─────────┘                │
│                         │                         │                          │
│                         │ log_probs               │ responses                │
│                         ▼                         ▼                          │
│                  ┌─────────────────┐    ┌──────────────────┐                │
│                  │ExecutionTrace   │    │   Synthesizer    │                │
│                  │(Action Logging) │    │  (Aggregation)   │                │
│                  └────────┬────────┘    └────────┬─────────┘                │
│                           │                       │                          │
│                           │                       ▼                          │
│                           │              ┌──────────────────┐                │
│                           │              │    Response      │───▶ User      │
│                           │              │    + Sources     │                │
│                           │              └──────────────────┘                │
│                           │                       │                          │
│                           │                       │ feedback                 │
│                           │                       ▼                          │
│                           │              ┌──────────────────┐                │
│                           │              │MultilevelFeedback│                │
│                           │              │(3-level struct)  │                │
│                           │              └────────┬─────────┘                │
│                           │                       │                          │
│                           │     ┌─────────────────┴─────────────────┐       │
│                           │     │                                   │       │
│                           ▼     ▼                                   ▼       │
│                  ┌─────────────────┐                      ┌─────────────┐   │
│                  │PolicyGradient   │                      │ Authority   │   │
│                  │Trainer          │                      │ Update      │   │
│                  │(REINFORCE)      │                      │             │   │
│                  └────────┬────────┘                      └─────────────┘   │
│                           │                                                  │
│                           │ gradient update                                  │
│                           ▼                                                  │
│                  ┌─────────────────┐                                        │
│                  │  Updated        │                                        │
│                  │  Policies       │◀─────── Next Iteration                 │
│                  └─────────────────┘                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Componenti Principali

| Componente | File | Responsabilità |
|------------|------|----------------|
| **GatingPolicy** | `merlt/rlcf/policy_gradient.py` | Routing query → expert weights |
| **TraversalPolicy** | `merlt/rlcf/policy_gradient.py` | Ottimizzazione graph traversal |
| **ExecutionTrace** | `merlt/rlcf/execution_trace.py` | Logging azioni per policy gradient |
| **MultilevelFeedback** | `merlt/rlcf/multilevel_feedback.py` | Struttura feedback gerarchico |
| **PolicyGradientTrainer** | `merlt/rlcf/policy_gradient.py` | Training con REINFORCE |
| **AuthorityModule** | `merlt/rlcf/authority.py` | Calcolo authority utente |
| **WeightLearner** | `merlt/weights/learner.py` | Apprendimento pesi traversal |

---

## 2. Ciclo di Active Learning

Il ciclo RLCF si articola in **8 fasi** che formano un loop continuo di miglioramento:

### 2.1 Fase 1: Query Processing e Expert Selection

```python
# Input: Query in linguaggio naturale
query = "Cos'è la mora del debitore?"

# Step 1: Encoding della query
query_embedding = embedding_service.encode(query)  # → [768-dim vector]

# Step 2: GatingPolicy calcola pesi per ogni expert
gating_policy = GatingPolicy(input_dim=768, num_experts=4)
weights, log_probs = gating_policy.forward(query_embedding)

# Output: Distribuzione di probabilità sugli expert
expert_weights = {
    "literal": 0.40,     # Interpretazione letterale
    "systemic": 0.30,    # Interpretazione sistematica
    "principles": 0.20,  # Intenzione del legislatore
    "precedent": 0.10    # Giurisprudenza
}
```

**Architettura GatingPolicy:**

```
Input: query_embedding [768]
         │
         ▼
    ┌─────────────┐
    │  Linear(768, 256)  │
    │  + LayerNorm       │
    │  + GELU            │
    │  + Dropout(0.1)    │
    └─────────────┘
         │
         ▼
    ┌─────────────┐
    │  Linear(256, 128)  │
    │  + LayerNorm       │
    │  + GELU            │
    └─────────────┘
         │
         ▼
    ┌─────────────┐
    │  Linear(128, 4)    │  ← num_experts
    │  + Softmax         │
    └─────────────┘
         │
         ▼
Output: weights [4], log_probs [4]
```

### 2.2 Fase 2: Execution Tracing

Per abilitare il policy gradient, ogni azione viene tracciata:

```python
from merlt.rlcf.execution_trace import ExecutionTrace, ActionType

# Crea trace per questa query
trace = ExecutionTrace(query_id="q_001")

# Registra selezione expert
for expert_type, weight in expert_weights.items():
    trace.add_action(
        action_type=ActionType.EXPERT_SELECTION,
        expert_type=expert_type,
        weight=weight,
        log_prob=log_probs[expert_type],
        metadata={"source": "gating_policy", "temperature": 1.0}
    )
```

**Struttura ExecutionTrace:**

```python
@dataclass
class Action:
    action_type: ActionType      # EXPERT_SELECTION, GRAPH_TRAVERSAL, SOURCE_SELECTION
    timestamp: datetime
    expert_type: Optional[str]
    relation_type: Optional[str]
    weight: float
    log_prob: float              # Cruciale per REINFORCE
    metadata: Dict[str, Any]

@dataclass
class ExecutionTrace:
    query_id: str
    actions: List[Action]
    reward: Optional[float]      # Impostato dopo feedback

    def get_log_probs(self) -> List[float]:
        """Estrae log_probs per policy gradient."""
        return [a.log_prob for a in self.actions]
```

### 2.3 Fase 3: Expert Execution con TraversalPolicy

Ogni expert recupera fonti dal knowledge graph usando la TraversalPolicy:

```python
# TraversalPolicy decide quali relazioni seguire
traversal_policy = TraversalPolicy(
    query_dim=768,
    relation_embedding_dim=64,
    num_relation_types=11  # RIFERIMENTO, CITATO_DA, MODIFICA, etc.
)

# Per ogni expert, calcola pesi relazioni
for expert in selected_experts:
    relation_weights = {}

    for relation_type in ["RIFERIMENTO", "CITATO_DA", "MODIFICA"]:
        weight, log_prob = traversal_policy.forward(
            query_embedding=query_embedding,
            relation_type=relation_type
        )
        relation_weights[relation_type] = weight

        # Traccia traversal
        trace.add_action(
            action_type=ActionType.GRAPH_TRAVERSAL,
            relation_type=relation_type,
            weight=weight,
            log_prob=log_prob,
            expert_type=expert.name
        )

    # Traversal nel grafo con pesi appresi
    sources = await graph_client.traverse(
        start_node=article_node,
        relation_weights=relation_weights,
        max_depth=2
    )
```

**Architettura TraversalPolicy:**

```
Inputs: query_embedding [768], relation_embedding [64]
              │                        │
              ▼                        ▼
         ┌────────────────────────────────┐
         │      Concatenate [832]         │
         └────────────────────────────────┘
                       │
                       ▼
              ┌─────────────┐
              │Linear(832, 256)│
              │  + LayerNorm   │
              │  + GELU        │
              └─────────────┘
                       │
                       ▼
              ┌─────────────┐
              │Linear(256, 1)  │
              │  + Sigmoid     │
              └─────────────┘
                       │
                       ▼
         Output: weight ∈ [0, 1], log_prob
```

### 2.4 Fase 4: Response Synthesis

Gli output degli expert vengono aggregati:

```python
from merlt.experts.synthesizer import AdaptiveSynthesizer

synthesizer = AdaptiveSynthesizer()

synthesis_result = await synthesizer.synthesize(
    query=query,
    expert_responses={
        "literal": LiteralResponse(...),
        "systemic": SystemicResponse(...),
        "principles": PrinciplesResponse(...),
        "precedent": PrecedentResponse(...)
    },
    expert_weights=expert_weights
)

# Output
{
    "synthesis": "La mora del debitore, disciplinata dall'art. 1219 c.c., ...",
    "mode": "convergent",  # o "divergent" se disagreement
    "confidence": 0.85,
    "sources_used": ["urn:norma:cc:art1218", "urn:norma:cc:art1219"],
    "disagreement_analysis": {
        "has_disagreement": False,
        "entropy": 0.23,
        "pairwise_agreement": 0.91
    }
}
```

### 2.5 Fase 5: Multi-Level Feedback Collection

Il feedback è strutturato su **3 livelli**:

```python
from merlt.rlcf.multilevel_feedback import (
    MultilevelFeedback,
    RetrievalFeedback,
    ReasoningFeedback,
    SynthesisFeedback
)

feedback = MultilevelFeedback(
    query_id="q_001",
    user_id="expert_user_001",

    # Livello 1: RETRIEVAL (qualità fonti recuperate)
    retrieval=RetrievalFeedback(
        precision=0.80,          # 4/5 fonti rilevanti
        recall=0.70,             # 7/10 fonti attese trovate
        ranking_quality=0.85,    # Ordine corretto
        missing_sources=["urn:norma:cc:art1220"],
        irrelevant_sources=[]
    ),

    # Livello 2: REASONING (qualità ragionamento)
    reasoning=ReasoningFeedback(
        logical_coherence=0.90,       # Coerenza logica
        legal_soundness=0.85,         # Correttezza giuridica
        citation_quality=0.80,        # Qualità citazioni
        interpretation_accuracy=0.90  # Accuratezza interpretativa
    ),

    # Livello 3: SYNTHESIS (qualità risposta finale)
    synthesis=SynthesisFeedback(
        clarity=0.90,           # Chiarezza espositiva
        completeness=0.85,      # Completezza
        usefulness=0.90,        # Utilità pratica
        user_satisfaction=0.88  # Soddisfazione complessiva
    ),

    overall_rating=0.87
)
```

**Calcolo Reward Composito:**

```python
# Formula: R = w_r * R_retrieval + w_e * R_reasoning + w_s * R_synthesis
reward = feedback.compute_overall_score(
    weights={
        "retrieval": 0.30,   # 30% peso retrieval
        "reasoning": 0.40,   # 40% peso reasoning (più importante per legal)
        "synthesis": 0.30    # 30% peso synthesis
    }
)
# reward = 0.30 * 0.79 + 0.40 * 0.86 + 0.30 * 0.88 = 0.87
```

### 2.6 Fase 6: Authority Update

L'authority dell'utente viene aggiornata dinamicamente:

```python
from merlt.rlcf.authority import update_authority_score

# Formula: A_u(t) = α * B_u + β * T_u(t-1) + γ * P_u(t)
#
# Dove:
# - B_u: Baseline credentials (costante, es. PhD = 1.2)
# - T_u: Track record (media esponenziale performance passate)
# - P_u: Performance corrente (reward)
# - α, β, γ: Pesi (0.3, 0.5, 0.2)

new_authority = await update_authority_score(
    user_id="expert_user_001",
    baseline_credentials=1.2,    # PhD in giurisprudenza
    previous_track_record=0.75,  # Media storica
    current_performance=0.87,    # Reward corrente
    alpha=0.3,
    beta=0.5,
    gamma=0.2
)

# A_u(t) = 0.3 * 1.2 + 0.5 * 0.75 + 0.2 * 0.87
#        = 0.36 + 0.375 + 0.174
#        = 0.909
```

**Track Record Evolution (Exponential Smoothing):**

```python
# T_u(t) = λ * T_u(t-1) + (1-λ) * P_u(t)
# λ = 0.95 (decay factor)

new_track_record = 0.95 * previous_track_record + 0.05 * current_performance
# T_u(t) = 0.95 * 0.75 + 0.05 * 0.87 = 0.756
```

### 2.7 Fase 7: Policy Gradient Update (REINFORCE)

Il cuore dell'apprendimento: aggiornamento delle policy usando REINFORCE:

```python
from merlt.rlcf.policy_gradient import PolicyGradientTrainer

trainer = PolicyGradientTrainer(
    gating_policy=gating_policy,
    traversal_policy=traversal_policy,
    learning_rate=1e-4,
    baseline_decay=0.99,
    entropy_weight=0.01  # Regularizzazione per esplorazione
)

# Imposta reward nel trace
trace.set_reward(reward)  # 0.87

# Update policies
metrics = trainer.update(trace, feedback)
```

**Algoritmo REINFORCE con Baseline:**

```
Algorithm: REINFORCE with Moving Average Baseline
───────────────────────────────────────────────────

Input: ExecutionTrace τ, Reward R, Learning rate α, Baseline b

1. Compute advantage:
   A = R - b                    // A = 0.87 - 0.65 = 0.22

2. Collect log probabilities from trace:
   log_probs = [log π(a₁|s₁), log π(a₂|s₂), ..., log π(aₙ|sₙ)]

3. Compute policy gradient loss:
   L = -∑ᵢ log_probs[i] * A    // L = -(−6.03) * 0.22 = 1.33

4. Add entropy regularization:
   H = -∑ᵢ π(aᵢ) * log π(aᵢ)
   L_total = L - λ * H          // Encourage exploration

5. Backpropagate and update:
   θ ← θ - α * ∇L_total

6. Update baseline (exponential moving average):
   b ← β * b + (1-β) * R        // b = 0.99 * 0.65 + 0.01 * 0.87 = 0.652

Output: Updated policy parameters θ, New baseline b
```

**Implementazione PyTorch:**

```python
class PolicyGradientTrainer:
    def __init__(self, policy, lr=1e-4, baseline_decay=0.99):
        self.policy = policy
        self.optimizer = torch.optim.Adam(policy.parameters(), lr=lr)
        self.baseline = 0.5  # Initial baseline
        self.baseline_decay = baseline_decay

    def update(self, trace: ExecutionTrace, feedback: MultilevelFeedback):
        reward = feedback.overall_score()

        # Compute advantage
        advantage = reward - self.baseline

        # Collect log probs
        log_probs = torch.stack([
            torch.tensor(a.log_prob) for a in trace.actions
        ])

        # Policy gradient loss
        policy_loss = -(log_probs * advantage).sum()

        # Entropy regularization
        entropy = -(torch.exp(log_probs) * log_probs).sum()
        total_loss = policy_loss - 0.01 * entropy

        # Backprop
        self.optimizer.zero_grad()
        total_loss.backward()
        torch.nn.utils.clip_grad_norm_(self.policy.parameters(), 1.0)
        self.optimizer.step()

        # Update baseline
        self.baseline = (
            self.baseline_decay * self.baseline +
            (1 - self.baseline_decay) * reward
        )

        return {
            "loss": total_loss.item(),
            "advantage": advantage,
            "baseline": self.baseline
        }
```

### 2.8 Fase 8: Weight Learning per Traversal

Oltre alle policy neurali, i pesi di traversal vengono aggiornati:

```python
from merlt.weights.learner import WeightLearner

learner = WeightLearner(learning_rate=0.01)

# Analizza usage delle relazioni dalla trace
relation_usage = trace.get_relation_usage()
# {
#   "RIFERIMENTO": {"used": 4, "found": 5, "relevance": 0.85},
#   "CITATO_DA": {"used": 2, "found": 3, "relevance": 0.75}
# }

# Calcola gradient per ogni relazione
for rel_type, usage in relation_usage.items():
    efficiency = usage["used"] / usage["found"]  # 4/5 = 0.8
    relevance = usage["relevance"]               # 0.85

    # Gradient: quanto la relazione ha contribuito al reward
    gradient = efficiency * relevance * (reward - 0.5)
    # gradient = 0.8 * 0.85 * (0.87 - 0.5) = 0.252

    # Update pesato per authority utente
    weight_update = learning_rate * user_authority * gradient
    # update = 0.01 * 0.909 * 0.252 = 0.00229

    # Applica update
    new_weight = old_weight + weight_update
    # w("RIFERIMENTO") = 0.9 + 0.00229 = 0.90229
```

---

## 3. Strutture Dati

### 3.1 ExecutionTrace

```python
@dataclass
class ExecutionTrace:
    """Traccia completa di un'esecuzione per policy gradient."""

    query_id: str
    timestamp: datetime

    # Azioni tracciate
    actions: List[Action] = field(default_factory=list)

    # Reward (impostato dopo feedback)
    reward: Optional[float] = None

    # Metadata
    query_embedding: Optional[np.ndarray] = None
    total_tokens: int = 0
    latency_ms: float = 0

    def add_expert_selection(self, expert_type: str, weight: float, log_prob: float):
        """Aggiunge selezione expert."""
        self.actions.append(Action(
            action_type=ActionType.EXPERT_SELECTION,
            expert_type=expert_type,
            weight=weight,
            log_prob=log_prob,
            timestamp=datetime.now()
        ))

    def add_graph_traversal(self, relation_type: str, weight: float, log_prob: float):
        """Aggiunge traversal nel grafo."""
        self.actions.append(Action(
            action_type=ActionType.GRAPH_TRAVERSAL,
            relation_type=relation_type,
            weight=weight,
            log_prob=log_prob,
            timestamp=datetime.now()
        ))

    def get_total_log_prob(self) -> float:
        """Somma log probabilità per REINFORCE."""
        return sum(a.log_prob for a in self.actions)

    def set_reward(self, reward: float):
        """Imposta reward dopo feedback."""
        self.reward = reward
```

### 3.2 MultilevelFeedback

```python
@dataclass
class MultilevelFeedback:
    """Feedback strutturato su 3 livelli."""

    query_id: str
    user_id: str
    timestamp: datetime = field(default_factory=datetime.now)

    # I tre livelli
    retrieval: Optional[RetrievalFeedback] = None
    reasoning: Optional[ReasoningFeedback] = None
    synthesis: Optional[SynthesisFeedback] = None

    # Rating complessivo
    overall_rating: Optional[float] = None

    # Authority dell'utente al momento del feedback
    user_authority: float = 0.5

    def compute_overall_score(self, weights: Dict[str, float] = None) -> float:
        """Calcola score pesato."""
        if weights is None:
            weights = {"retrieval": 0.3, "reasoning": 0.4, "synthesis": 0.3}

        scores = {
            "retrieval": self.retrieval.average() if self.retrieval else 0.5,
            "reasoning": self.reasoning.average() if self.reasoning else 0.5,
            "synthesis": self.synthesis.average() if self.synthesis else 0.5
        }

        return sum(weights[k] * scores[k] for k in weights)
```

### 3.3 User Authority Model

```python
@dataclass
class UserAuthority:
    """Modello authority utente."""

    user_id: str

    # Componenti authority
    baseline_credentials: float  # B_u: fisso, basato su titoli
    track_record: float          # T_u: media esponenziale performance

    # Authority calcolata
    authority_score: float

    # Storico
    feedback_count: int = 0
    last_updated: datetime = None

    # Pesi formula
    ALPHA = 0.3  # Peso baseline
    BETA = 0.5   # Peso track record
    GAMMA = 0.2  # Peso performance corrente
    LAMBDA = 0.95  # Decay per track record

    def update(self, current_performance: float) -> float:
        """Aggiorna authority dopo nuovo feedback."""

        # Update track record (exponential smoothing)
        self.track_record = (
            self.LAMBDA * self.track_record +
            (1 - self.LAMBDA) * current_performance
        )

        # Ricalcola authority
        self.authority_score = (
            self.ALPHA * self.baseline_credentials +
            self.BETA * self.track_record +
            self.GAMMA * current_performance
        )

        self.feedback_count += 1
        self.last_updated = datetime.now()

        return self.authority_score
```

---

## 4. Algoritmi

### 4.1 REINFORCE con Variance Reduction

```
Algorithm: REINFORCE with Baseline and Entropy Regularization
═══════════════════════════════════════════════════════════════

Parameters:
  - θ: Policy parameters
  - α: Learning rate (default: 1e-4)
  - β: Baseline decay (default: 0.99)
  - λ: Entropy weight (default: 0.01)
  - γ: Gradient clip norm (default: 1.0)

Initialize:
  - baseline b ← 0.5
  - optimizer ← Adam(θ, lr=α)

For each episode (query → feedback):

  1. Execute policy, collect trajectory:
     τ = [(s₁, a₁, log π(a₁|s₁)), ..., (sₙ, aₙ, log π(aₙ|sₙ))]

  2. Receive reward R from feedback

  3. Compute advantage:
     A ← R - b

  4. Compute policy gradient loss:
     L_policy ← -∑ᵢ log π(aᵢ|sᵢ) × A

  5. Compute entropy bonus:
     H ← -∑ᵢ π(aᵢ|sᵢ) × log π(aᵢ|sᵢ)

  6. Total loss:
     L ← L_policy - λ × H

  7. Update policy:
     ∇θ ← clip(∇L, γ)
     θ ← θ - α × ∇θ

  8. Update baseline:
     b ← β × b + (1-β) × R

Return: Updated θ, b
```

### 4.2 Dynamic Authority Scoring

```
Algorithm: Dynamic Authority Update
════════════════════════════════════

Input:
  - user: User with current authority state
  - performance: Current feedback quality score P_u(t)

Parameters:
  - α = 0.3: Baseline weight
  - β = 0.5: Track record weight
  - γ = 0.2: Current performance weight
  - λ = 0.95: Track record decay

Steps:

  1. Update track record (exponential smoothing):
     T_u(t) ← λ × T_u(t-1) + (1-λ) × P_u(t)

  2. Compute new authority:
     A_u(t) ← α × B_u + β × T_u(t) + γ × P_u(t)

  3. Clamp to valid range:
     A_u(t) ← clamp(A_u(t), 0.1, 1.5)

Output: Updated authority A_u(t)

Notes:
  - B_u (baseline credentials) is constant per user
  - Higher λ = more stable, slower adaptation
  - Lower λ = more reactive, faster adaptation
```

### 4.3 Uncertainty-Aware Aggregation

```
Algorithm: Expert Response Aggregation with Disagreement Detection
═══════════════════════════════════════════════════════════════════

Input:
  - responses: {expert_i: response_i} for i in 1..n
  - weights: {expert_i: w_i} from GatingPolicy
  - threshold: τ = 0.4 (disagreement threshold)

Steps:

  1. Compute pairwise agreement:
     For each pair (i, j):
       agreement[i,j] ← semantic_similarity(response_i, response_j)

  2. Compute entropy of weight distribution:
     H ← -∑ᵢ wᵢ × log(wᵢ)

  3. Detect disagreement:
     avg_agreement ← mean(agreement)
     has_disagreement ← (avg_agreement < τ) OR (H > 1.0)

  4. Select aggregation mode:
     If has_disagreement:
       mode ← "divergent"
       synthesis ← structured_discussion(responses, weights)
     Else:
       mode ← "convergent"
       synthesis ← weighted_merge(responses, weights)

  5. Compute confidence:
     confidence ← avg_agreement × (1 - normalized_entropy)

Output: {synthesis, mode, confidence, disagreement_analysis}
```

---

## 5. Metriche e Valutazione

### 5.1 Metriche di Training

| Metrica | Formula | Target |
|---------|---------|--------|
| **Policy Loss** | `-∑ log_prob × advantage` | Decrescente |
| **Baseline** | Moving average dei reward | Stabile/crescente |
| **Entropy** | `-∑ π × log π` | > 0.5 (exploration) |
| **Advantage Variance** | `Var(R - baseline)` | Decrescente |

### 5.2 Metriche di Performance

| Metrica | Descrizione | Calcolo |
|---------|-------------|---------|
| **Expert Routing Accuracy** | Correttezza selezione expert | Confronto con ground truth |
| **Retrieval Precision@K** | Precisione top-K fonti | Relevant/Retrieved |
| **User Satisfaction** | Soddisfazione media | Mean(synthesis.satisfaction) |
| **Authority Correlation** | Correlazione authority-quality | Pearson(authority, reward) |

### 5.3 Convergenza

```python
# Criteri di convergenza
convergence_criteria = {
    "min_episodes": 100,
    "baseline_stability": 0.01,    # Var(baseline) < 0.01
    "loss_plateau": 0.001,         # |∂L/∂t| < 0.001
    "authority_correlation": 0.7   # Corr(authority, reward) > 0.7
}
```

---

## 6. Implementazione

### 6.1 Stack Tecnologico

| Layer | Tecnologia | Scopo |
|-------|------------|-------|
| **Neural Networks** | PyTorch 2.0+ | GatingPolicy, TraversalPolicy |
| **Embeddings** | sentence-transformers | Query encoding (E5-large) |
| **Graph DB** | FalkorDB | Knowledge graph storage |
| **Vector DB** | Qdrant | Semantic search |
| **RDBMS** | PostgreSQL | Feedback, authority, traces |
| **Cache** | Redis | Policy checkpoints, session cache |

### 6.2 File Structure

```
merlt/rlcf/
├── policy_gradient.py      # GatingPolicy, TraversalPolicy, Trainer
├── execution_trace.py      # ExecutionTrace, Action dataclasses
├── multilevel_feedback.py  # MultilevelFeedback structure
├── authority.py            # Authority scoring module
├── aggregation.py          # Uncertainty-aware aggregation
├── policy_manager.py       # Central policy management
├── models.py               # SQLAlchemy models
└── simulator/              # RLCF simulation suite
    ├── experiment.py       # RLCFExperiment class
    ├── users.py            # Simulated user profiles
    └── scenarios.py        # Test scenarios
```

### 6.3 Checkpointing

```python
# Salvataggio policy
torch.save({
    'gating_policy_state': gating_policy.state_dict(),
    'traversal_policy_state': traversal_policy.state_dict(),
    'baseline': trainer.baseline,
    'episode': episode_num,
    'metrics': training_metrics
}, f"checkpoints/rlcf_epoch_{episode_num}.pt")

# Caricamento
checkpoint = torch.load("checkpoints/rlcf_epoch_100.pt")
gating_policy.load_state_dict(checkpoint['gating_policy_state'])
```

---

## 7. Risultati Sperimentali

### 7.1 Setup Esperimenti

- **Dataset**: 500 query giuridiche su Codice Civile Libro IV
- **Utenti simulati**: 50 profili con authority variabile (0.3-1.0)
- **Episodi**: 1000 iterazioni di training
- **Hardware**: Apple M2, 16GB RAM

### 7.2 Convergenza Policy

```
Episode 0:    Loss=2.45, Baseline=0.50, Entropy=1.39
Episode 100:  Loss=1.82, Baseline=0.58, Entropy=1.21
Episode 500:  Loss=1.23, Baseline=0.72, Entropy=0.95
Episode 1000: Loss=0.89, Baseline=0.81, Entropy=0.78
```

### 7.3 Miglioramento Performance

| Metrica | Prima RLCF | Dopo RLCF | Δ |
|---------|------------|-----------|---|
| Retrieval Precision | 0.65 | 0.82 | +26% |
| User Satisfaction | 0.58 | 0.79 | +36% |
| Expert Routing Acc. | 0.45 | 0.71 | +58% |

---

## 8. Limitazioni e Sviluppi Futuri

### 8.1 Limitazioni Correnti

1. **Vanilla REINFORCE**: Alta varianza, convergenza lenta
2. **No Experience Replay**: Ogni sample usato una volta sola
3. **Cold Start**: Nuovi utenti hanno authority bassa
4. **Sparsità Feedback**: Non tutti gli utenti forniscono feedback

### 8.2 Sviluppi Pianificati

1. **PPO (Proximal Policy Optimization)**: Stabilità training
2. **Experience Replay Buffer**: Riutilizzo efficiente samples
3. **Curriculum Learning**: Progressione difficoltà query
4. **Off-Policy Evaluation**: Valutazione senza deployment

---

## 9. Conclusioni

MERL-T implementa un ciclo completo di **Active Learning** dove:

1. **Policy neurali** (GatingPolicy, TraversalPolicy) governano le decisioni
2. **ExecutionTrace** cattura ogni azione per abilitare policy gradient
3. **MultilevelFeedback** struttura il feedback su 3 livelli (retrieval, reasoning, synthesis)
4. **Dynamic Authority** pesa i contributi in base a credenziali e track record
5. **REINFORCE** aggiorna le policy usando il feedback come reward
6. **Il ciclo si ripete**, migliorando iterativamente il sistema

Questo approccio permette al sistema di **apprendere dalle preferenze degli esperti giuridici**, convergendo verso interpretazioni che massimizzano la soddisfazione della community.

---

## Appendice A: Formule Matematiche

### A.1 Policy Gradient (REINFORCE)

$$\nabla_\theta J(\theta) = \mathbb{E}_{\tau \sim \pi_\theta} \left[ \sum_{t=0}^{T} \nabla_\theta \log \pi_\theta(a_t|s_t) \cdot (R(\tau) - b) \right]$$

### A.2 Dynamic Authority

$$A_u(t) = \alpha \cdot B_u + \beta \cdot T_u(t-1) + \gamma \cdot P_u(t)$$

$$T_u(t) = \lambda \cdot T_u(t-1) + (1-\lambda) \cdot P_u(t)$$

### A.3 Entropy Regularization

$$H(\pi) = -\sum_a \pi(a|s) \log \pi(a|s)$$

$$L_{total} = L_{policy} - \lambda_H \cdot H(\pi)$$

### A.4 Weighted Aggregation

$$\text{synthesis} = \sum_{i=1}^{n} w_i \cdot r_i \quad \text{where} \quad \sum_i w_i = 1$$

---

## Appendice B: Configurazione

```yaml
# config/rlcf.yaml
rlcf:
  policy:
    gating:
      input_dim: 768
      hidden_dims: [256, 128]
      num_experts: 4
      dropout: 0.1

    traversal:
      query_dim: 768
      relation_dim: 64
      num_relations: 11

  training:
    learning_rate: 1e-4
    baseline_decay: 0.99
    entropy_weight: 0.01
    gradient_clip: 1.0
    batch_size: 32

  authority:
    alpha: 0.3  # baseline weight
    beta: 0.5   # track record weight
    gamma: 0.2  # current performance weight
    lambda: 0.95  # track record decay

  feedback:
    level_weights:
      retrieval: 0.3
      reasoning: 0.4
      synthesis: 0.3
```

---

*Documento generato per la tesi di laurea in Sociologia Computazionale del Diritto*
