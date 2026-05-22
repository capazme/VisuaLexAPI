# Learning Layer Architecture - RLCF Multilivello (v2)

**Version**: 2.0
**Status**: 🚧 IN RIPROGETTAZIONE
**Last Updated**: Dicembre 2025

> **Nota**: Questo documento descrive RLCF v2 (multilivello con pesi apprendibili).
> Per RLCF v1 (scalare), vedere `archive/v1-05-learning-layer.md`

---

## 1. Evoluzione: RLCF v1 → v2

### RLCF v1 (Originale)

```
Feedback → Authority scalare → Aggregazione → Fine
             A_u(t) = uno score
```

**Limitazioni v1**:
- Un esperto bravo in contratti ha stesso peso anche in penale
- Non distingue tra "bravo a trovare fonti" e "bravo a interpretare"
- Nessun apprendimento dei parametri del sistema

### RLCF v2 (Multilivello)

```
Feedback → Authority MULTILIVELLO → Aggiorna PESI del sistema → Migliora
              │
              ├─ A_retrieval: Quanto sei bravo a trovare fonti
              ├─ A_reasoning: Quanto sei bravo a interpretare
              ├─ A_synthesis: Quanto sei bravo a sintetizzare
              └─ A_domain[d]: Quanto sei bravo nel dominio d
```

---

## 2. I Tre Pilastri di RLCF v2

### Pilastro 1: Authority Multilivello

```python
class MultilevelAuthority:
    """
    Authority score multidimensionale per ogni esperto.

    Invece di un singolo score, ogni esperto ha un profilo
    di competenze che viene aggiornato in base al feedback.
    """

    def __init__(self, user_id: str):
        self.user_id = user_id

        # Authority per LIVELLO di competenza
        self.level_authority = {
            "retrieval": 0.5,   # Trova fonti rilevanti?
            "reasoning": 0.5,   # Interpreta correttamente?
            "synthesis": 0.5,   # Sintetizza bene il disaccordo?
        }

        # Authority per DOMINIO giuridico
        self.domain_authority = {
            "civile": 0.5,
            "penale": 0.5,
            "amministrativo": 0.5,
            "costituzionale": 0.5,
            "lavoro": 0.5,
            "commerciale": 0.5,
        }

        # Formula base (come v1, ma applicata per dimensione)
        # A_u(t) = α·B + β·T + γ·P
        self.alpha = 0.3  # Base (credentials)
        self.beta = 0.5   # Temporal (track record)
        self.gamma = 0.2  # Performance (recent)

    def get_authority(
        self,
        level: str = None,
        domain: str = None
    ) -> float:
        """
        Ritorna authority score.

        - level=None, domain=None: Media globale (backward compatible)
        - level="retrieval": Authority per retrieval
        - domain="civile": Authority per diritto civile
        - Entrambi: Authority specifica (livello + dominio)
        """
        if level is None and domain is None:
            # Backward compatible: media globale
            return np.mean(list(self.level_authority.values()))

        score = 1.0

        if level:
            score *= self.level_authority.get(level, 0.5)

        if domain:
            score *= self.domain_authority.get(domain, 0.5)

        return score

    def update_from_feedback(self, feedback: RLCFFeedback):
        """Aggiorna authority basandosi sul feedback."""

        # Aggiorna authority per livello
        if feedback.level:
            old = self.level_authority[feedback.level]
            reward = 1.0 if feedback.was_correct else -0.5
            new = old + self.gamma * reward * (1 - old)  # Bounded update
            self.level_authority[feedback.level] = np.clip(new, 0.0, 1.0)

        # Aggiorna authority per dominio
        if feedback.domain:
            old = self.domain_authority[feedback.domain]
            reward = 1.0 if feedback.was_correct else -0.5
            new = old + self.gamma * reward * (1 - old)
            self.domain_authority[feedback.domain] = np.clip(new, 0.0, 1.0)
```

### Pilastro 2: Pesi Apprendibili del Sistema

RLCF v2 aggiorna non solo l'authority degli esperti, ma anche i **parametri del sistema**:

```python
class LearnableSystemParameters:
    """
    Parametri del sistema che vengono aggiornati da RLCF.

    Il feedback degli esperti "cristallizza" conoscenza in questi pesi,
    migliorando il sistema per le future generazioni.
    """

    def __init__(self):
        # θ_traverse: Pesi per traversal nel grafo (per expert)
        self.traversal_weights = {
            "literal": nn.ParameterDict({...}),
            "systemic": nn.ParameterDict({...}),
            "principles": nn.ParameterDict({...}),
            "precedent": nn.ParameterDict({...}),
        }

        # θ_gating: Gating network per pesare gli expert
        self.gating_network = ExpertGatingNetwork(
            input_dim=1024,
            num_experts=4
        )

        # θ_rerank: Re-ranker per ordinare i risultati
        self.reranker = LearnedReranker(
            embedding_dim=1024,
            hidden_dim=256
        )

    def get_trainable_parameters(self) -> List[nn.Parameter]:
        """Ritorna tutti i parametri apprendibili."""
        params = []
        for expert_weights in self.traversal_weights.values():
            params.extend(expert_weights.parameters())
        params.extend(self.gating_network.parameters())
        params.extend(self.reranker.parameters())
        return params
```

### Pilastro 3: Feedback Multilivello

```python
class MultilevelFeedback:
    """
    Schema di feedback che cattura informazioni a ogni livello.
    """

    def __init__(self):
        # Metadata
        self.query_id: str
        self.expert_user_id: str
        self.timestamp: datetime
        self.domain: str  # civile, penale, etc.

        # LIVELLO 1: Feedback su Retrieval
        self.retrieval_feedback = {
            "sources_relevant": bool,        # Le fonti erano pertinenti?
            "sources_complete": bool,        # Mancava qualcosa?
            "sources_ranking": List[int],    # Ranking corretto? [1,2,3...]
            "relations_useful": Dict[str, bool],  # Per ogni relazione seguita
        }

        # LIVELLO 2: Feedback su Reasoning (per expert)
        self.reasoning_feedback = {
            "literal_correct": Optional[bool],
            "systemic_correct": Optional[bool],
            "principles_correct": Optional[bool],
            "precedent_correct": Optional[bool],
            "best_expert": Optional[str],  # Quale aveva più ragione?
        }

        # LIVELLO 3: Feedback su Synthesis
        self.synthesis_feedback = {
            "final_correct": bool,          # Risposta finale corretta?
            "disagreement_shown": bool,     # Il disaccordo era evidente?
            "confidence_appropriate": bool, # Il livello di certezza era giusto?
        }

        # Feedback testuale (per training futuro)
        self.correction_text: Optional[str]
        self.notes: Optional[str]
```

---

## 3. Policy Gradient per Apprendimento

### Formulazione Matematica

```
OBIETTIVO
══════════════════════════════════════════════════════════════════

Massimizzare il reward atteso, pesato per l'authority di chi dà feedback:

J(θ) = E_{q~Q, a~π_θ, f~RLCF} [ A(f) · R(f) ]

dove:
- θ = {θ_traverse, θ_gating, θ_rerank} parametri apprendibili
- q = query
- a = azioni del sistema (traversal, gating, ranking)
- f = feedback dell'esperto
- A(f) = authority dell'esperto (multilivello)
- R(f) = reward dal feedback


GRADIENT (REINFORCE)
══════════════════════════════════════════════════════════════════

∇_θ J(θ) = E [ A(f) · R(f) · ∇_θ log π_θ(a|q) ]

In pratica (con baseline per ridurre varianza):

∇_θ J(θ) ≈ (1/N) Σ_i [ A(f_i) · (R(f_i) - b) · ∇_θ log π_θ(a_i|q_i) ]

dove b = baseline (media mobile dei reward)


CREDIT ASSIGNMENT PER LIVELLO
══════════════════════════════════════════════════════════════════

Il reward totale viene decomposto per livello:

R_total = w_1 · R_retrieval + w_2 · R_reasoning + w_3 · R_synthesis

dove w_1 + w_2 + w_3 = 1 (pesi configurabili)

Ogni componente di θ riceve il gradient appropriato:
- θ_traverse ← gradient da R_retrieval
- θ_gating   ← gradient da R_reasoning
- θ_rerank   ← gradient da R_retrieval + R_reasoning
```

### Implementazione

```python
class RLCFPolicyGradient:
    """
    Training loop con policy gradient per RLCF.
    """

    def __init__(self, system_params: LearnableSystemParameters):
        self.params = system_params
        self.optimizer = torch.optim.Adam(
            self.params.get_trainable_parameters(),
            lr=1e-4
        )
        self.baseline = MovingAverage(window=100)

    def update(self, batch: List[FeedbackWithTrace]):
        """
        Aggiorna i parametri usando un batch di feedback.

        Ogni FeedbackWithTrace contiene:
        - Il feedback dell'esperto
        - La trace delle azioni prese dal sistema
        - I log-prob delle azioni
        """
        total_loss = 0.0

        for item in batch:
            feedback = item.feedback
            trace = item.execution_trace

            # Calcola authority dell'esperto (multilivello)
            authority = self._get_authority(
                expert_id=feedback.expert_user_id,
                level=feedback.feedback_level,
                domain=feedback.domain
            )

            # Calcola reward
            reward = self._compute_reward(feedback)

            # Advantage (reward - baseline)
            advantage = reward - self.baseline.get()
            self.baseline.update(reward)

            # Policy gradient loss
            # L = -A(f) · advantage · log_prob
            loss = -authority * advantage * trace.total_log_prob

            total_loss += loss

        # Backprop
        total_loss.backward()
        self.optimizer.step()
        self.optimizer.zero_grad()

    def _compute_reward(self, feedback: MultilevelFeedback) -> float:
        """Calcola reward totale dal feedback multilivello."""
        reward = 0.0

        # Retrieval reward
        if feedback.retrieval_feedback:
            r = feedback.retrieval_feedback
            retrieval_reward = (
                0.4 * float(r.get("sources_relevant", False)) +
                0.3 * float(r.get("sources_complete", False)) +
                0.3 * self._ranking_reward(r.get("sources_ranking", []))
            )
            reward += 0.3 * retrieval_reward

        # Reasoning reward
        if feedback.reasoning_feedback:
            r = feedback.reasoning_feedback
            correct_count = sum([
                r.get("literal_correct", False),
                r.get("systemic_correct", False),
                r.get("principles_correct", False),
                r.get("precedent_correct", False),
            ])
            reasoning_reward = correct_count / 4.0
            reward += 0.4 * reasoning_reward

        # Synthesis reward
        if feedback.synthesis_feedback:
            s = feedback.synthesis_feedback
            synthesis_reward = (
                0.5 * float(s.get("final_correct", False)) +
                0.25 * float(s.get("disagreement_shown", False)) +
                0.25 * float(s.get("confidence_appropriate", False))
            )
            reward += 0.3 * synthesis_reward

        return reward
```

---

## 4. Resilienza agli Aggiornamenti

### Problema: Obsolescenza dei Pesi

Quando la normativa cambia o una sentenza fa overruling, i pesi appresi potrebbero diventare obsoleti.

### Soluzione: Triple Layer di Resilienza

```python
class ResilientLearning:
    """
    Gestisce l'obsolescenza dei pesi appresi.
    """

    # ═══════════════════════════════════════════════════════════
    # MECCANISMO 1: TEMPORAL DECAY
    # ═══════════════════════════════════════════════════════════

    def apply_temporal_decay(self):
        """
        I pesi decadono verso il prior se non ricevono feedback recente.

        Intuizione: se nessuno valida un peso da mesi,
        la situazione potrebbe essere cambiata.
        """
        for expert, weights in self.traversal_weights.items():
            for relation, weight in weights.items():
                days_since_feedback = self._days_since_last_feedback(
                    expert, relation
                )

                decay_rate = 0.995  # ~50% in 6 mesi
                decay = decay_rate ** days_since_feedback

                prior = self.EXPERT_PRIORS[expert][relation]
                new_weight = decay * weight + (1 - decay) * prior

                weights[relation] = new_weight

    # ═══════════════════════════════════════════════════════════
    # MECCANISMO 2: GRAPH EVENT TRIGGERS
    # ═══════════════════════════════════════════════════════════

    def on_graph_event(self, event: GraphEvent):
        """
        Reagisce a modifiche nel grafo della conoscenza.
        """
        if event.type == "ABROGA":
            # Norma abrogata: depreca i pesi collegati
            self._deprecate_related_weights(event.target_node)

        elif event.type == "OVERRULES":
            # Sentenza superata: trasferisci credito
            self._transfer_weight_credit(
                from_node=event.old_node,
                to_node=event.new_node
            )

        elif event.type == "MODIFICA":
            # Norma modificata: schedule re-validation
            self._schedule_revalidation(event.target_node)

    # ═══════════════════════════════════════════════════════════
    # MECCANISMO 3: RECENCY-WEIGHTED FEEDBACK
    # ═══════════════════════════════════════════════════════════

    def compute_effective_weight(self, feedback: Feedback) -> float:
        """
        I feedback recenti pesano di più nel training.
        """
        # Authority base dell'esperto
        authority = self.get_authority(feedback.expert_id)

        # Recency decay (feedback di 1 anno fa pesa ~50%)
        days_old = (datetime.now() - feedback.created_at).days
        recency = 0.998 ** days_old

        # Stabilità del nodo (nodi modificati di recente sono instabili)
        stability = self._get_node_stability(feedback.related_nodes)

        return authority * recency * stability
```

---

## 5. Schema Database

```sql
-- ═══════════════════════════════════════════════════════════
-- AUTHORITY MULTILIVELLO
-- ═══════════════════════════════════════════════════════════

CREATE TABLE user_authority_multilevel (
    user_id UUID PRIMARY KEY REFERENCES users(id),

    -- Authority per LIVELLO
    authority_retrieval FLOAT DEFAULT 0.5,
    authority_reasoning FLOAT DEFAULT 0.5,
    authority_synthesis FLOAT DEFAULT 0.5,

    -- Authority per DOMINIO (JSONB per flessibilità)
    authority_domains JSONB DEFAULT '{
        "civile": 0.5,
        "penale": 0.5,
        "amministrativo": 0.5,
        "costituzionale": 0.5,
        "lavoro": 0.5,
        "commerciale": 0.5
    }',

    -- Metriche aggregate
    total_feedbacks INT DEFAULT 0,
    feedbacks_by_level JSONB DEFAULT '{}',
    feedbacks_by_domain JSONB DEFAULT '{}',

    updated_at TIMESTAMP DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════
-- FEEDBACK MULTILIVELLO
-- ═══════════════════════════════════════════════════════════

CREATE TABLE multilevel_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id UUID REFERENCES queries(id),
    expert_user_id UUID REFERENCES users(id),

    -- Metadata
    domain VARCHAR(50),
    feedback_level VARCHAR(20),  -- 'retrieval', 'reasoning', 'synthesis'
    created_at TIMESTAMP DEFAULT NOW(),

    -- Feedback Retrieval
    sources_relevant BOOLEAN,
    sources_complete BOOLEAN,
    sources_ranking JSONB,  -- [1, 3, 2, 4] ordinamento corretto
    relations_useful JSONB, -- {"INTERPRETA": true, "CITA": false}

    -- Feedback Reasoning (per expert)
    literal_correct BOOLEAN,
    systemic_correct BOOLEAN,
    principles_correct BOOLEAN,
    precedent_correct BOOLEAN,
    best_expert VARCHAR(20),

    -- Feedback Synthesis
    final_correct BOOLEAN,
    disagreement_shown BOOLEAN,
    confidence_appropriate BOOLEAN,

    -- Testo libero
    correction_text TEXT,
    notes TEXT
);


-- ═══════════════════════════════════════════════════════════
-- PESI APPRESI (CHECKPOINTING)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE learned_weights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),

    -- Pesi serializzati
    traversal_weights JSONB,  -- Per ogni expert
    gating_weights BYTEA,     -- Serialized PyTorch state_dict
    reranker_weights BYTEA,

    -- Metriche al momento del checkpoint
    validation_accuracy FLOAT,
    total_feedbacks_used INT,

    -- Flag
    is_active BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_active_weights ON learned_weights(is_active)
WHERE is_active = TRUE;
```

---

## 6. Interfaccia Feedback per Utenti

### UI per Raccolta Feedback (Wireframe)

```
┌─────────────────────────────────────────────────────────────────┐
│                    FEEDBACK SU QUESTA RISPOSTA                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📊 LIVELLO 1: Le fonti trovate                                │
│  ──────────────────────────────────────────────────────────    │
│  Le fonti erano pertinenti?     [Sì] [Parzialmente] [No]       │
│  Mancava qualcosa?              [Sì] [No]                       │
│  Se sì, cosa? [________________________]                        │
│                                                                 │
│  📊 LIVELLO 2: L'interpretazione                               │
│  ──────────────────────────────────────────────────────────    │
│  Quale interpretazione era più corretta?                        │
│  [ ] Letterale    [Corretta] [Parziale] [Sbagliata]           │
│  [ ] Sistematica  [Corretta] [Parziale] [Sbagliata]           │
│  [ ] Principi     [Corretta] [Parziale] [Sbagliata]           │
│  [ ] Precedenti   [Corretta] [Parziale] [Sbagliata]           │
│                                                                 │
│  📊 LIVELLO 3: La risposta finale                              │
│  ──────────────────────────────────────────────────────────    │
│  La risposta finale è corretta?  [Sì] [Parzialmente] [No]      │
│  Il disaccordo era visibile?     [Sì] [No] [N/A]               │
│                                                                 │
│  📝 Note aggiuntive (opzionale)                                │
│  [____________________________________________]                  │
│                                                                 │
│                                        [Invia Feedback]         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Metriche di Validazione per Tesi

### Esperimento 1: RLCF Scalare vs Multilivello

```python
# Setup sperimentale
experiment = {
    "gruppi": {
        "A": "RLCF scalare (authority unico)",
        "B": "RLCF multilivello (authority per competenza)"
    },
    "partecipanti": "20-30 esperti (colleghi/professori)",
    "task": "100 domande giuridiche con gold standard",
    "metriche": [
        "Accuratezza risposta finale",
        "Tempo di convergenza (quanti feedback per stabilizzare)",
        "Soddisfazione esperti (quanto è faticoso dare feedback)",
        "Correlazione authority-correttezza"
    ]
}
```

### Esperimento 2: Impatto dei Pesi Apprendibili

```python
# Confronto
comparison = {
    "baseline": "Pesi statici (hardcoded da domain expert)",
    "learned": "Pesi appresi da 1000 feedback RLCF",
    "metriche": [
        "Precision@10 nel retrieval",
        "Accuracy per tipo di expert",
        "Explainability (path nel grafo)",
    ]
}
```

### Esperimento 3: Resilienza

```python
# Test resilienza
resilience_test = {
    "scenario": "Simulare cambio normativo (nuova sentenza)",
    "misura": "Quanto tempo/feedback per ri-adattarsi",
    "confronto": [
        "Senza temporal decay",
        "Con temporal decay",
        "Con graph event triggers"
    ]
}
```

---

## 8. Requisiti Infrastrutturali

### Hardware Minimo (Development)

| Componente | Requisito | Note |
|------------|-----------|------|
| CPU | M1/M2/M4 o x86 8+ core | Training può essere CPU-only |
| RAM | 16GB | Per modelli piccoli |
| GPU | Opzionale | MPS su Mac, CUDA su Linux |
| Storage | 50GB SSD | Per embeddings e checkpoint |

### Hardware Raccomandato (Production)

| Componente | Requisito | Note |
|------------|-----------|------|
| CPU | 16+ core | Per parallelismo expert |
| RAM | 64GB | Server universitari |
| GPU | 16GB+ VRAM | Per training veloce |
| Storage | 500GB NVMe | Per corpus legale completo |

### Configurabilità API

```yaml
# config/rlcf_config.yaml

learning:
  # Utente può usare propria API key
  llm_provider: "openrouter"  # o "openai", "anthropic"
  llm_api_key: "${OPENROUTER_API_KEY}"  # Dalla propria .env

  # Training parameters (tunable)
  learning_rate: 0.0001
  batch_size: 32
  baseline_window: 100

  # Decay parameters
  temporal_decay_rate: 0.995
  recency_weight: 0.998

  # Authority weights (formula RLCF)
  alpha: 0.3  # Base
  beta: 0.5   # Temporal
  gamma: 0.2  # Performance

privacy:
  # Dati sensibili
  anonymize_feedback: true
  retention_days: 365
  export_format: "anonymized_json"
```

---

## 9. Roadmap Implementazione

### Fase 1: Core RLCF Multilivello (2-3 settimane)
- [ ] Schema database multilivello
- [ ] `MultilevelAuthority` class
- [ ] `MultilevelFeedback` schema
- [ ] API endpoint per feedback multilivello

### Fase 2: Pesi Apprendibili (3-4 settimane)
- [ ] `LearnableSystemParameters` con θ_traverse, θ_gating
- [ ] Policy gradient training loop
- [ ] Checkpointing pesi

### Fase 3: Resilienza (2 settimane)
- [ ] Temporal decay
- [ ] Graph event handlers
- [ ] Recency weighting

### Fase 4: Validazione Empirica (4-6 settimane)
- [ ] Setup esperimenti
- [ ] Raccolta feedback con colleghi/professori
- [ ] Analisi statistica
- [ ] Scrittura risultati per tesi

---

**Changelog**:
- 2025-12-02: v2.0 - RLCF Multilivello con pesi apprendibili
- 2025-11-14: v1.0 - RLCF scalare (ora in archive/)

