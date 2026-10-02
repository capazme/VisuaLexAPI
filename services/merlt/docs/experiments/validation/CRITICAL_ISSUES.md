# RLCF Framework - Critical Issues Identified

> **Data Analisi**: 30 Dicembre 2025
> **Reviewer**: Architect Agent (Modalità Scettico Scientifico)
> **Status**: IN REVISIONE

---

## Executive Summary

L'audit ha identificato **53 problemi** di cui **15 critici** che richiedono azione immediata.

### Problemi Critici per Priorità

| # | Componente | Problema | Impatto | Azione |
|---|------------|----------|---------|--------|
| 1 | `policy_gradient.py` | ~~REINFORCE fittizio (gradient random)~~ | **✅ FIXED** | Backprop reale implementata |
| 2 | `policy_gradient.py` | ~~Log probs pre-calcolati (no backprop)~~ | **✅ FIXED** | query_embedding salvato nei metadata |
| 11 | `ppo_trainer.py` | PPO per single-step (overkill) | Complessità inutile | VALUTARE |
| 18 | `replay_buffer.py` | Incompatibile con on-policy | Viola assunzioni teoriche | RIMUOVERE/DOCUMENTARE |
| 23 | `curriculum_learning.py` | Soglie arbitrarie | Nessuna validazione | CALIBRARE |
| 30 | `off_policy_eval.py` | OPE con on-policy algorithm | Incompatibilità | LIMITARE USO |

---

## PROBLEMA #1: REINFORCE Implementation (✅ FIXED - 30 Dicembre 2025)

### Codice Originale (ERRATO)

```python
# merlt/rlcf/policy_gradient.py:554-560 (VECCHIA VERSIONE)
with torch.no_grad():
    scale = self.config.learning_rate * returns
    for param in self.policy.parameters():
        if param.grad is None:
            # ERRORE: Gradient RANDOM invece che calcolato!
            param.grad = torch.randn_like(param) * 0.01
        param.data.add_(param.grad * scale)
```

### Perché Era Sbagliato

1. **`torch.no_grad()`** disabilita il calcolo dei gradienti
2. **`param.grad = torch.randn_like(param)`** assegna un vettore CASUALE come gradient
3. **Non c'è backpropagation** - i gradienti non derivano dalla loss function

### FIX APPLICATO

Il fix implementa backpropagation REALE:
1. **`query_embedding`** viene salvato nei metadata delle Action (orchestrator.py)
2. Durante l'update, si ri-esegue il forward pass con gradient enabled
3. Si calcola la loss REINFORCE: `loss = -weighted_log_prob * returns`
4. Si chiama `loss.backward()` per backpropagation reale
5. Si chiama `optimizer.step()` per applicare i gradienti

### File Modificati
- `merlt/rlcf/policy_gradient.py:500-660` - Nuovo `update_from_feedback()` e `update_from_batch()`
- `merlt/experts/orchestrator.py:250-260` - Salva `query_embedding` nei metadata

### Validazione
- **42 test passati** (`tests/rlcf/test_policy_gradient.py`, `tests/test_gating_policy_integration.py`)
- **Esperimento EXP-VAL-002** conferma gradient flow corretto

### Cosa Dovrebbe Fare REINFORCE

REINFORCE (Williams, 1992) richiede:
1. Calcolare `log π_θ(a|s)` con gradient enabled
2. Loss = `-Σ log π_θ(a|s) * R`
3. `loss.backward()` per calcolare ∇_θ log π_θ(a|s)
4. `optimizer.step()` per applicare i gradienti

### Implementazione Corretta

```python
def update_from_feedback(self, trace, feedback) -> Dict[str, float]:
    """REINFORCE corretto con backpropagation reale."""

    reward = feedback.to_scalar_reward()
    returns = reward - self.baseline

    # 1. Ricomputa log_probs CON gradient enabled
    self.optimizer.zero_grad()

    log_probs_list = []
    for action in trace.actions:
        state_tensor = torch.tensor(
            action.state,
            dtype=torch.float32,
            device=self.policy.device,
            requires_grad=False  # State non ha grad
        )

        # Forward pass - questo crea il computational graph
        _, action_log_probs = self.policy.forward(state_tensor)

        # Seleziona log_prob dell'azione presa
        action_index = action.action_index  # Deve essere salvato nell'Action
        selected_log_prob = action_log_probs[action_index]
        log_probs_list.append(selected_log_prob)

    # 2. Calcola policy loss
    log_probs = torch.stack(log_probs_list)
    policy_loss = -(log_probs * returns).sum()

    # 3. Backpropagation REALE
    policy_loss.backward()

    # 4. Gradient clipping (opzionale ma raccomandato)
    if self.config.clip_grad_norm:
        torch.nn.utils.clip_grad_norm_(
            self.policy.parameters(),
            self.config.clip_grad_norm
        )

    # 5. Optimizer step
    self.optimizer.step()

    # Aggiorna baseline
    self.baseline = (
        self.config.baseline_decay * self.baseline +
        (1 - self.config.baseline_decay) * reward
    )

    return {
        "loss": policy_loss.item(),
        "reward": reward,
        "returns": returns,
    }
```

### Requisiti per il Fix

1. **Action deve salvare `action_index`**: l'indice dell'azione scelta nel vettore di output
2. **Forward pass deve essere ripetuto**: non puoi usare log_prob pre-calcolati
3. **Test di gradient flow**: verificare che i gradienti fluiscano correttamente

---

## PROBLEMA #11: PPO per Single-Step Episodes

### Analisi

PPO (Schulman et al., 2017) è progettato per:
- Trajectories multi-step
- Advantage estimation con GAE
- Clipping per stabilità

MERL-T ha episodi **single-step**:
- Query → Response → Feedback → Done
- Non c'è "futuro" da predire

### Domanda Critica

**PPO per single-step degenera a REINFORCE con value baseline?**

Per single-step:
- `next_value = 0` (sempre done)
- `advantage = reward - V(s)`
- GAE = advantage (nessun lookahead)

### Raccomandazione

1. **Se PPO ≈ REINFORCE+V per single-step**: usare REINFORCE più semplice
2. **Se PPO offre benefici**: documentare quali e perché

---

## PROBLEMA #18: Replay Buffer con On-Policy

### Conflitto Teorico

- **PPO è on-policy**: richiede samples dalla policy CORRENTE
- **Experience Replay è per off-policy**: riusa samples da policy VECCHIE

### Conseguenze

Usare replay buffer con PPO:
1. Viola l'assunzione di on-policy
2. Può destabilizzare il training
3. I importance weights non correggono completamente

### Opzioni

1. **Rimuovere replay buffer** per PPO
2. **Passare a off-policy** (SAC, TD3)
3. **Documentare che è "PPO modificato"** con referenze

---

## PROBLEMA #44-48: Authority Weights Arbitrari

### Formula Attuale

```
A_u(t) = 0.4 * B_u + 0.4 * T_u + 0.2 * P_u
```

### Problemi

| Parametro | Valore | Giustificazione |
|-----------|--------|-----------------|
| Weight Baseline | 0.4 | **NESSUNA** |
| Weight Track Record | 0.4 | **NESSUNA** |
| Weight Level Authority | 0.2 | **NESSUNA** |
| Studente score | 0.2 | **NESSUNA** |
| Avvocato score | 0.6 | **NESSUNA** |
| Years bonus | 0.01/anno | **NESSUNA** |

### Piano di Calibrazione

1. **Raccogliere dataset gold standard**:
   - N utenti con credenziali note
   - M feedback per utente con quality annotata da esperti

2. **Regression analysis**:
   - Y = feedback quality (annotata)
   - X = [baseline, track_record, level_authority, ...]
   - Fit: Y = w1*X1 + w2*X2 + ...

3. **Cross-validation**:
   - Leave-one-out per evitare overfitting
   - Confronto con baseline (pesi uniformi)

---

## Piano d'Azione

### Fase 1: Fix Critici (Settimana 1)

- [ ] Reimplementare REINFORCE con backprop reale
- [ ] Aggiungere test di gradient flow
- [ ] Documentare Action con action_index

### Fase 2: Valutazione PPO (Settimana 2)

- [ ] Confronto empirico PPO vs REINFORCE
- [ ] Documentare se PPO offre vantaggi per single-step
- [ ] Decidere se semplificare a REINFORCE

### Fase 3: Calibrazione Parametri (Settimane 3-4)

- [ ] Raccogliere/annotare dataset per authority
- [ ] Fit pesi con regression
- [ ] Validare su test set

### Fase 4: Documentazione (Settimana 5)

- [ ] Sezione "Limitations" completa
- [ ] Assunzioni esplicite per ogni componente
- [ ] Scope of applicability

---

## Riferimenti

- Williams, R.J. (1992). Simple statistical gradient-following algorithms for connectionist reinforcement learning.
- Schulman, J., et al. (2017). Proximal Policy Optimization Algorithms.
- Schaul, T., et al. (2015). Prioritized Experience Replay.
