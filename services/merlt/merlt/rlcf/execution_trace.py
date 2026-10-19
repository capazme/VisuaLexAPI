"""
Execution Trace
================

Tracciamento delle azioni durante l'esecuzione di un expert per policy gradient.

Ogni azione (es. "usa tool X", "attraversa relazione Y") viene tracciata
con il suo log probability per consentire l'aggiornamento policy via REINFORCE.

Fondamento teorico:
- REINFORCE: ∇J(θ) = E[∑ᵗ ∇log π(aₜ|sₜ) * R]
- Trace = sequenza di azioni con log_prob per calcolare gradiente

Esempio:
    >>> from merlt.rlcf.execution_trace import ExecutionTrace, Action
    >>>
    >>> trace = ExecutionTrace(query_id="q001")
    >>> trace.add_action(Action(
    ...     action_type="expert_selection",
    ...     parameters={"expert": "literal", "weight": 0.7},
    ...     log_prob=-0.357
    ... ))
    >>> trace.add_action(Action(
    ...     action_type="graph_traversal",
    ...     parameters={"relation": "RIFERIMENTO", "weight": 0.8},
    ...     log_prob=-0.223
    ... ))
    >>> print(f"Total log prob: {trace.total_log_prob}")
"""

import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from datetime import datetime

log = structlog.get_logger()


# =============================================================================
# DATACLASSES
# =============================================================================

@dataclass
class Action:
    """
    Singola azione eseguita durante l'interpretazione.

    Ogni azione tracciata ha:
    - Tipo (expert_selection, graph_traversal, tool_use)
    - Parametri (quali scelte sono state fatte)
    - Log probability (per REINFORCE gradient)

    Attributes:
        action_type: Tipo di azione ("expert_selection", "graph_traversal", "tool_use")
        parameters: Parametri dell'azione (es. {"expert": "literal", "weight": 0.7})
        log_prob: Log probability dell'azione data la policy
        timestamp: Quando è stata eseguita
        metadata: Metadati aggiuntivi (es. stato corrente, context)
    """
    action_type: str
    parameters: Dict[str, Any]
    log_prob: float
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "action_type": self.action_type,
            "parameters": self.parameters,
            "log_prob": self.log_prob,
            "timestamp": self.timestamp,
            "metadata": self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Action":
        """Deserializza da dizionario."""
        return cls(
            action_type=data["action_type"],
            parameters=data["parameters"],
            log_prob=data["log_prob"],
            timestamp=data.get("timestamp", datetime.now().isoformat()),
            metadata=data.get("metadata", {})
        )


@dataclass
class ExecutionTrace:
    """
    Trace completo di un'esecuzione per policy gradient.

    Raccoglie tutte le azioni eseguite durante l'interpretazione,
    insieme ai loro log probabilities. Usato per calcolare il gradient
    REINFORCE dopo aver ricevuto feedback (reward).

    Formula REINFORCE:
        ∇J(θ) = ∑ₜ ∇log π(aₜ|sₜ) * (R - baseline)

    Dove:
        - π(aₜ|sₜ) = policy che ha prodotto l'azione aₜ nello stato sₜ
        - R = reward totale (da feedback utente)
        - baseline = media mobile dei reward passati

    Attributes:
        query_id: ID della query originale
        actions: Lista di Action eseguite
        total_log_prob: Somma log probabilities (per quick reference)
        metadata: Metadati (expert_type, timestamp, etc.)
        reward: Reward ricevuto da feedback (impostato dopo)
    """
    query_id: str
    actions: List[Action] = field(default_factory=list)
    total_log_prob: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)
    reward: Optional[float] = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def add_action(
        self,
        action: Action
    ) -> None:
        """
        Aggiunge un'azione al trace.

        Aggiorna automaticamente total_log_prob.

        Args:
            action: Action da aggiungere
        """
        self.actions.append(action)
        self.total_log_prob += action.log_prob

        log.debug(
            "Action added to trace",
            query_id=self.query_id,
            action_type=action.action_type,
            log_prob=action.log_prob,
            total_actions=len(self.actions)
        )

    def add_expert_selection(
        self,
        expert_type: str,
        weight: float,
        log_prob: float,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Convenience method per tracciare selezione expert.

        Args:
            expert_type: Tipo di expert selezionato
            weight: Peso assegnato
            log_prob: Log probability della selezione
            metadata: Metadati aggiuntivi
        """
        action = Action(
            action_type="expert_selection",
            parameters={
                "expert_type": expert_type,
                "weight": weight
            },
            log_prob=log_prob,
            metadata=metadata or {}
        )
        self.add_action(action)

    def add_graph_traversal(
        self,
        relation_type: str,
        weight: float,
        log_prob: float,
        source_node: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Convenience method per tracciare traversal del grafo.

        Args:
            relation_type: Tipo di relazione attraversata
            weight: Peso della relazione
            log_prob: Log probability della scelta
            source_node: Nodo di partenza (opzionale)
            metadata: Metadati aggiuntivi
        """
        action = Action(
            action_type="graph_traversal",
            parameters={
                "relation_type": relation_type,
                "weight": weight,
                "source_node": source_node
            },
            log_prob=log_prob,
            metadata=metadata or {}
        )
        self.add_action(action)

    def add_tool_use(
        self,
        tool_name: str,
        parameters: Dict[str, Any],
        log_prob: float,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Convenience method per tracciare uso di un tool.

        Args:
            tool_name: Nome del tool usato
            parameters: Parametri passati al tool
            log_prob: Log probability della scelta
            metadata: Metadati aggiuntivi
        """
        action = Action(
            action_type="tool_use",
            parameters={
                "tool_name": tool_name,
                "tool_parameters": parameters
            },
            log_prob=log_prob,
            metadata=metadata or {}
        )
        self.add_action(action)

    def add_prompt_action(
        self,
        expert_type: str,
        prompt_version: str,
        log_prob: float,
        modulation_vector: Optional[List[float]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Traccia un'azione di prompt generation.

        Usato per il prompt tuning via REINFORCE - traccia quale prompt
        e' stato usato e con quale modulazione.

        Args:
            expert_type: Tipo di expert (literal, systemic, etc.)
            prompt_version: Versione del prompt usato (es. "1.0.0")
            log_prob: Log probability della modulazione applicata
            modulation_vector: Vettore di modulazione (se usato)
            metadata: Metadati aggiuntivi
        """
        action = Action(
            action_type="prompt_generation",
            parameters={
                "expert_type": expert_type,
                "prompt_version": prompt_version,
                "modulation_vector": modulation_vector,
            },
            log_prob=log_prob,
            metadata=metadata or {}
        )
        self.add_action(action)

    def set_reward(self, reward: float) -> None:
        """
        Imposta reward da feedback.

        Args:
            reward: Reward normalizzato [0-1] da feedback utente
        """
        self.reward = reward

        log.info(
            "Reward set for trace",
            query_id=self.query_id,
            reward=reward,
            num_actions=len(self.actions)
        )

    def get_actions_by_type(self, action_type: str) -> List[Action]:
        """
        Filtra azioni per tipo.

        Args:
            action_type: Tipo di azione da filtrare

        Returns:
            Lista di Action del tipo specificato
        """
        return [a for a in self.actions if a.action_type == action_type]

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario per storage."""
        return {
            "query_id": self.query_id,
            "actions": [a.to_dict() for a in self.actions],
            "total_log_prob": self.total_log_prob,
            "metadata": self.metadata,
            "reward": self.reward,
            "created_at": self.created_at
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionTrace":
        """Deserializza da dizionario."""
        actions = [Action.from_dict(a) for a in data.get("actions", [])]

        trace = cls(
            query_id=data["query_id"],
            actions=actions,
            total_log_prob=data.get("total_log_prob", 0.0),
            metadata=data.get("metadata", {}),
            reward=data.get("reward"),
            created_at=data.get("created_at", datetime.now().isoformat())
        )

        return trace

    @property
    def num_actions(self) -> int:
        """Numero di azioni nel trace."""
        return len(self.actions)

    @property
    def has_reward(self) -> bool:
        """True se reward è stato impostato."""
        return self.reward is not None

    @property
    def average_log_prob(self) -> float:
        """Log probability medio per azione."""
        if not self.actions:
            return 0.0
        return self.total_log_prob / len(self.actions)

    def summary(self) -> Dict[str, Any]:
        """
        Restituisce summary leggibile del trace.

        Returns:
            Dict con statistiche del trace
        """
        action_types = {}
        for action in self.actions:
            action_types[action.action_type] = action_types.get(action.action_type, 0) + 1

        return {
            "query_id": self.query_id,
            "num_actions": self.num_actions,
            "action_types": action_types,
            "total_log_prob": self.total_log_prob,
            "average_log_prob": self.average_log_prob,
            "has_reward": self.has_reward,
            "reward": self.reward,
            "created_at": self.created_at
        }


# =============================================================================
# UTILITIES
# =============================================================================

def merge_traces(traces: List[ExecutionTrace]) -> ExecutionTrace:
    """
    Merge multipli trace in uno solo.

    Utile per aggregare trace da expert paralleli.

    Args:
        traces: Lista di ExecutionTrace da unire

    Returns:
        ExecutionTrace unificato
    """
    if not traces:
        return ExecutionTrace(query_id="merged_empty")

    # Usa il primo query_id
    merged = ExecutionTrace(
        query_id=traces[0].query_id,
        metadata={"merged_from": len(traces)}
    )

    # Aggiungi tutte le azioni
    for trace in traces:
        for action in trace.actions:
            merged.add_action(action)

    # Se tutti hanno reward, fai media
    rewards = [t.reward for t in traces if t.reward is not None]
    if rewards:
        merged.reward = sum(rewards) / len(rewards)

    log.info(
        "Traces merged",
        num_traces=len(traces),
        total_actions=merged.num_actions,
        avg_reward=merged.reward
    )

    return merged


def compute_returns(
    traces: List[ExecutionTrace],
    gamma: float = 1.0
) -> List[float]:
    """
    Calcola returns discounted per ogni trace.

    Return = reward totale, eventualmente discounted se gamma < 1.
    Per single-step episodi (una query = un episodio), gamma=1 è standard.

    Args:
        traces: Lista di ExecutionTrace con reward
        gamma: Discount factor [0-1]

    Returns:
        Lista di returns, uno per trace
    """
    returns = []

    for trace in traces:
        if trace.reward is None:
            log.warning(f"Trace {trace.query_id} has no reward, using 0.0")
            returns.append(0.0)
        else:
            # Per episodi single-step, return = reward
            # Se in futuro aggiungiamo multi-step, gamma < 1
            returns.append(trace.reward * gamma)

    return returns


def compute_baseline(
    traces: List[ExecutionTrace],
    method: str = "mean"
) -> float:
    """
    Calcola baseline per variance reduction in REINFORCE.

    Baseline comune: media dei reward passati.

    Args:
        traces: Lista di ExecutionTrace con reward
        method: Metodo di calcolo ("mean", "median")

    Returns:
        Baseline value
    """
    rewards = [t.reward for t in traces if t.reward is not None]

    if not rewards:
        return 0.0

    if method == "mean":
        return sum(rewards) / len(rewards)
    elif method == "median":
        sorted_rewards = sorted(rewards)
        n = len(sorted_rewards)
        if n % 2 == 0:
            return (sorted_rewards[n // 2 - 1] + sorted_rewards[n // 2]) / 2
        else:
            return sorted_rewards[n // 2]
    else:
        log.warning(f"Unknown baseline method: {method}, using mean")
        return sum(rewards) / len(rewards)
