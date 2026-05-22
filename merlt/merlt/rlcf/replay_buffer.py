"""
Experience Replay Buffer
=========================

Buffer per memorizzare e campionare esperienze passate nel training RLCF.

Vantaggi dell'Experience Replay:
1. Rompe la correlazione tra sample consecutivi
2. Riutilizza esperienze per training più efficiente
3. Supporta prioritized sampling basato su reward/TD-error

Struttura Experience:
    (trace, feedback, reward, priority)

Esempio:
    >>> from merlt.rlcf.replay_buffer import ExperienceReplayBuffer
    >>> from merlt.rlcf.execution_trace import ExecutionTrace
    >>> from merlt.rlcf.multilevel_feedback import MultilevelFeedback
    >>>
    >>> buffer = ExperienceReplayBuffer(capacity=10000)
    >>>
    >>> # Aggiungi esperienze
    >>> buffer.add(trace, feedback, reward=0.8)
    >>>
    >>> # Campiona batch per training
    >>> batch = buffer.sample(batch_size=32)
    >>> for trace, feedback, reward in batch:
    ...     loss = trainer.update_from_feedback(trace, feedback)
    >>>
    >>> # Prioritized sampling
    >>> buffer_prio = PrioritizedReplayBuffer(capacity=10000, alpha=0.6)
    >>> batch, indices, weights = buffer_prio.sample_with_priority(32, beta=0.4)

Note:
    - Capacity gestita con deque (FIFO quando pieno)
    - Supporta serializzazione per persistenza
    - Thread-safe per uso concorrente
"""

import random
import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple, Generic, TypeVar
from datetime import datetime, UTC
from collections import deque
import threading
import json
import math

log = structlog.get_logger()

# Type variable per generic
T = TypeVar('T')


# =============================================================================
# DATACLASSES
# =============================================================================

@dataclass
class Experience:
    """
    Singola esperienza nel buffer.

    Attributes:
        experience_id: ID univoco
        trace_data: Dati della trace (serializzati)
        feedback_data: Dati del feedback (serializzati)
        reward: Reward ottenuto
        priority: Priorità per sampling (default 1.0)
        timestamp: Quando è stata aggiunta
        metadata: Dati aggiuntivi
    """
    experience_id: str
    trace_data: Dict[str, Any]
    feedback_data: Dict[str, Any]
    reward: float
    priority: float = 1.0
    timestamp: str = field(default_factory=lambda: datetime.now(UTC).replace(tzinfo=None).isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "experience_id": self.experience_id,
            "trace_data": self.trace_data,
            "feedback_data": self.feedback_data,
            "reward": self.reward,
            "priority": self.priority,
            "timestamp": self.timestamp,
            "metadata": self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Experience":
        """Deserializza da dizionario."""
        return cls(
            experience_id=data["experience_id"],
            trace_data=data["trace_data"],
            feedback_data=data["feedback_data"],
            reward=data["reward"],
            priority=data.get("priority", 1.0),
            timestamp=data.get("timestamp", datetime.now(UTC).replace(tzinfo=None).isoformat()),
            metadata=data.get("metadata", {})
        )


@dataclass
class BufferStats:
    """
    Statistiche del buffer.

    Attributes:
        size: Numero corrente di esperienze
        capacity: Capacità massima
        total_added: Totale esperienze aggiunte (incluse rimosse)
        total_sampled: Totale campionamenti effettuati
        avg_reward: Reward medio nel buffer
        avg_priority: Priorità media nel buffer
    """
    size: int = 0
    capacity: int = 0
    total_added: int = 0
    total_sampled: int = 0
    avg_reward: float = 0.0
    avg_priority: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "size": self.size,
            "capacity": self.capacity,
            "total_added": self.total_added,
            "total_sampled": self.total_sampled,
            "avg_reward": round(self.avg_reward, 4),
            "avg_priority": round(self.avg_priority, 4),
            "fill_ratio": round(self.size / self.capacity, 4) if self.capacity > 0 else 0
        }


# =============================================================================
# EXPERIENCE REPLAY BUFFER
# =============================================================================

class ExperienceReplayBuffer:
    """
    Buffer di replay standard con sampling uniforme.

    Usa deque per gestione FIFO automatica quando raggiunge capacità.

    Attributes:
        capacity: Capacità massima del buffer
        buffer: Deque di Experience
        stats: Statistiche del buffer
    """

    def __init__(self, capacity: int = 10000):
        """
        Inizializza ExperienceReplayBuffer.

        Args:
            capacity: Capacità massima (default 10000)
        """
        self.capacity = capacity
        self.buffer: deque = deque(maxlen=capacity)
        self._lock = threading.Lock()
        self._total_added = 0
        self._total_sampled = 0

        log.info("ExperienceReplayBuffer initialized", capacity=capacity)

    def add(
        self,
        trace: Any,
        feedback: Any,
        reward: float,
        priority: float = 1.0,
        metadata: Dict[str, Any] = None
    ) -> str:
        """
        Aggiunge esperienza al buffer.

        Args:
            trace: ExecutionTrace (sarà serializzato)
            feedback: MultilevelFeedback (sarà serializzato)
            reward: Reward ottenuto
            priority: Priorità per sampling
            metadata: Dati aggiuntivi

        Returns:
            ID dell'esperienza aggiunta
        """
        # Serializza trace e feedback
        trace_data = trace.to_dict() if hasattr(trace, 'to_dict') else trace
        feedback_data = feedback.to_dict() if hasattr(feedback, 'to_dict') else feedback

        experience_id = f"exp_{self._total_added}_{datetime.now(UTC).replace(tzinfo=None).strftime('%Y%m%d%H%M%S')}"

        experience = Experience(
            experience_id=experience_id,
            trace_data=trace_data,
            feedback_data=feedback_data,
            reward=reward,
            priority=priority,
            metadata=metadata or {}
        )

        with self._lock:
            self.buffer.append(experience)
            self._total_added += 1

        return experience_id

    def sample(self, batch_size: int = 32) -> List[Experience]:
        """
        Campiona batch di esperienze uniformemente.

        Args:
            batch_size: Dimensione del batch

        Returns:
            Lista di Experience
        """
        with self._lock:
            if len(self.buffer) == 0:
                return []

            # Non campionare più elementi di quanti disponibili
            actual_size = min(batch_size, len(self.buffer))

            sampled = random.sample(list(self.buffer), actual_size)
            self._total_sampled += actual_size

        return sampled

    def sample_recent(self, batch_size: int = 32) -> List[Experience]:
        """
        Campiona le esperienze più recenti.

        Args:
            batch_size: Dimensione del batch

        Returns:
            Lista di Experience (più recenti)
        """
        with self._lock:
            actual_size = min(batch_size, len(self.buffer))
            return list(self.buffer)[-actual_size:]

    def get_all(self) -> List[Experience]:
        """
        Restituisce tutte le esperienze.

        Returns:
            Lista completa di Experience
        """
        with self._lock:
            return list(self.buffer)

    def clear(self) -> None:
        """Svuota il buffer."""
        with self._lock:
            self.buffer.clear()
        log.info("Buffer cleared")

    def __len__(self) -> int:
        """Numero di esperienze nel buffer."""
        return len(self.buffer)

    def is_full(self) -> bool:
        """True se il buffer è pieno."""
        return len(self.buffer) >= self.capacity

    def oldest_timestamp(self) -> Optional[datetime]:
        """Return timestamp of the oldest experience in the buffer."""
        with self._lock:
            if not self.buffer:
                return None
            return min(
                datetime.fromisoformat(e.timestamp) for e in self.buffer
            )

    def get_stats(self) -> BufferStats:
        """
        Calcola statistiche del buffer.

        Returns:
            BufferStats con statistiche correnti
        """
        with self._lock:
            if len(self.buffer) == 0:
                return BufferStats(
                    size=0,
                    capacity=self.capacity,
                    total_added=self._total_added,
                    total_sampled=self._total_sampled
                )

            rewards = [exp.reward for exp in self.buffer]
            priorities = [exp.priority for exp in self.buffer]

            return BufferStats(
                size=len(self.buffer),
                capacity=self.capacity,
                total_added=self._total_added,
                total_sampled=self._total_sampled,
                avg_reward=sum(rewards) / len(rewards),
                avg_priority=sum(priorities) / len(priorities)
            )

    def save(self, path: str) -> None:
        """
        Salva buffer su file.

        Args:
            path: Path del file
        """
        with self._lock:
            data = {
                "capacity": self.capacity,
                "total_added": self._total_added,
                "total_sampled": self._total_sampled,
                "experiences": [exp.to_dict() for exp in self.buffer]
            }

        with open(path, "w") as f:
            json.dump(data, f, indent=2)

        log.info(f"Buffer saved to {path}", size=len(self.buffer))

    def load(self, path: str) -> None:
        """
        Carica buffer da file.

        Args:
            path: Path del file
        """
        with open(path, "r") as f:
            data = json.load(f)

        with self._lock:
            self.capacity = data.get("capacity", self.capacity)
            self._total_added = data.get("total_added", 0)
            self._total_sampled = data.get("total_sampled", 0)

            self.buffer = deque(maxlen=self.capacity)
            for exp_data in data.get("experiences", []):
                self.buffer.append(Experience.from_dict(exp_data))

        log.info(f"Buffer loaded from {path}", size=len(self.buffer))


# =============================================================================
# PRIORITIZED EXPERIENCE REPLAY BUFFER
# =============================================================================

class SumTree:
    """
    Struttura dati per Prioritized Experience Replay.

    Albero binario dove ogni nodo è la somma dei figli.
    Permette sampling proporzionale alle priorità in O(log n).
    """

    def __init__(self, capacity: int):
        """
        Inizializza SumTree.

        Args:
            capacity: Capacità massima
        """
        self.capacity = capacity
        self.tree = [0.0] * (2 * capacity - 1)
        self.data = [None] * capacity
        self.n_entries = 0
        self.write_index = 0

    def _propagate(self, idx: int, change: float) -> None:
        """Propaga cambio priorità verso la radice."""
        parent = (idx - 1) // 2
        self.tree[parent] += change
        if parent != 0:
            self._propagate(parent, change)

    def _retrieve(self, idx: int, s: float) -> int:
        """Recupera indice foglia per valore s."""
        left = 2 * idx + 1
        right = left + 1

        if left >= len(self.tree):
            return idx

        if s <= self.tree[left]:
            return self._retrieve(left, s)
        else:
            return self._retrieve(right, s - self.tree[left])

    def total(self) -> float:
        """Somma totale delle priorità."""
        return self.tree[0]

    def add(self, priority: float, data: Any) -> None:
        """Aggiunge elemento con priorità."""
        idx = self.write_index + self.capacity - 1

        self.data[self.write_index] = data
        self.update(idx, priority)

        self.write_index = (self.write_index + 1) % self.capacity
        if self.n_entries < self.capacity:
            self.n_entries += 1

    def update(self, idx: int, priority: float) -> None:
        """Aggiorna priorità di un elemento."""
        change = priority - self.tree[idx]
        self.tree[idx] = priority
        self._propagate(idx, change)

    def get(self, s: float) -> Tuple[int, float, Any]:
        """
        Recupera elemento per valore campionato.

        Args:
            s: Valore campionato [0, total)

        Returns:
            Tuple (tree_idx, priority, data)
        """
        idx = self._retrieve(0, s)
        data_idx = idx - self.capacity + 1
        return idx, self.tree[idx], self.data[data_idx]


class PrioritizedReplayBuffer:
    """
    Buffer con Prioritized Experience Replay (PER).

    Implementa sampling proporzionale alle priorità usando SumTree.
    Esperienze con reward alto (o TD-error alto) hanno maggiore
    probabilità di essere campionate.

    Formula priorità: p_i = (|TD_error_i| + ε)^α

    Importance Sampling weights: w_i = (N * P(i))^(-β) / max(w)

    Attributes:
        capacity: Capacità massima
        alpha: Esponente per prioritizzazione (0=uniform, 1=full priority)
        epsilon: Costante per evitare priorità zero
        tree: SumTree per sampling efficiente
    """

    def __init__(
        self,
        capacity: int = 10000,
        alpha: float = 0.6,
        epsilon: float = 0.01
    ):
        """
        Inizializza PrioritizedReplayBuffer.

        Args:
            capacity: Capacità massima
            alpha: Esponente priorità (default 0.6)
            epsilon: Costante per evitare zero (default 0.01)
        """
        self.capacity = capacity
        self.alpha = alpha
        self.epsilon = epsilon
        self.tree = SumTree(capacity)
        self._lock = threading.Lock()
        self._total_added = 0
        self._total_sampled = 0
        self._max_priority = 1.0
        self._oldest_ts: Optional[datetime] = None

        log.info(
            "PrioritizedReplayBuffer initialized",
            capacity=capacity,
            alpha=alpha,
            epsilon=epsilon
        )

    def add(
        self,
        trace: Any,
        feedback: Any,
        reward: float,
        td_error: Optional[float] = None,
        metadata: Dict[str, Any] = None
    ) -> str:
        """
        Aggiunge esperienza con priorità.

        Args:
            trace: ExecutionTrace
            feedback: MultilevelFeedback
            reward: Reward ottenuto
            td_error: TD-error per priorità (se None, usa max_priority)
            metadata: Dati aggiuntivi

        Returns:
            ID dell'esperienza
        """
        # Calcola priorità
        if td_error is not None:
            priority = (abs(td_error) + self.epsilon) ** self.alpha
        else:
            # Nuove esperienze hanno priorità massima
            priority = self._max_priority

        # Serializza
        trace_data = trace.to_dict() if hasattr(trace, 'to_dict') else trace
        feedback_data = feedback.to_dict() if hasattr(feedback, 'to_dict') else feedback

        experience_id = f"exp_{self._total_added}_{datetime.now(UTC).replace(tzinfo=None).strftime('%Y%m%d%H%M%S')}"

        experience = Experience(
            experience_id=experience_id,
            trace_data=trace_data,
            feedback_data=feedback_data,
            reward=reward,
            priority=priority,
            metadata=metadata or {}
        )

        with self._lock:
            self.tree.add(priority, experience)
            self._total_added += 1
            self._max_priority = max(self._max_priority, priority)

            # Track oldest timestamp in O(1)
            exp_ts = datetime.fromisoformat(experience.timestamp)
            if self._oldest_ts is None or exp_ts < self._oldest_ts:
                self._oldest_ts = exp_ts

        return experience_id

    def sample(self, batch_size: int = 32) -> List[Experience]:
        """
        Campiona batch (senza importance weights).

        Args:
            batch_size: Dimensione batch

        Returns:
            Lista di Experience
        """
        batch, _, _ = self.sample_with_priority(batch_size)
        return batch

    def sample_with_priority(
        self,
        batch_size: int = 32,
        beta: float = 0.4
    ) -> Tuple[List[Experience], List[int], List[float]]:
        """
        Campiona batch con importance sampling weights.

        Args:
            batch_size: Dimensione batch
            beta: Esponente per IS weights (0=no correction, 1=full)

        Returns:
            Tuple (experiences, tree_indices, is_weights)
        """
        with self._lock:
            n = self.tree.n_entries
            if n == 0:
                return [], [], []

            batch = []
            indices = []
            priorities = []

            # Segment-based sampling
            segment = self.tree.total() / batch_size

            for i in range(batch_size):
                a = segment * i
                b = segment * (i + 1)
                s = random.uniform(a, b)

                idx, priority, experience = self.tree.get(s)

                if experience is not None:
                    batch.append(experience)
                    indices.append(idx)
                    priorities.append(priority)

            self._total_sampled += len(batch)

        # Calcola importance sampling weights
        if len(priorities) == 0:
            return batch, indices, []

        total = self.tree.total()
        min_prob = min(priorities) / total
        max_weight = (n * min_prob) ** (-beta)

        weights = []
        for priority in priorities:
            prob = priority / total
            weight = (n * prob) ** (-beta) / max_weight
            weights.append(weight)

        return batch, indices, weights

    def oldest_timestamp(self) -> Optional[datetime]:
        """Return timestamp of the oldest experience in the buffer (O(1))."""
        with self._lock:
            if self.tree.n_entries == 0:
                return None
            return self._oldest_ts

    def update_priorities(
        self,
        indices: List[int],
        td_errors: List[float]
    ) -> None:
        """
        Aggiorna priorità dopo training.

        Args:
            indices: Indici nel tree
            td_errors: Nuovi TD-error
        """
        with self._lock:
            for idx, td_error in zip(indices, td_errors):
                priority = (abs(td_error) + self.epsilon) ** self.alpha
                self.tree.update(idx, priority)
                self._max_priority = max(self._max_priority, priority)

    def __len__(self) -> int:
        """Numero di esperienze."""
        return self.tree.n_entries

    def save(self, path: str) -> None:
        """
        Salva buffer su file.

        Serializza le esperienze (non il SumTree). Il tree viene
        ricostruito al load tramite re-add con priorità preservate.

        Args:
            path: Path del file JSON
        """
        with self._lock:
            experiences = [
                self.tree.data[i]
                for i in range(self.tree.n_entries)
                if self.tree.data[i] is not None
            ]
            data = {
                "buffer_type": "prioritized",
                "capacity": self.capacity,
                "alpha": self.alpha,
                "epsilon": self.epsilon,
                "total_added": self._total_added,
                "total_sampled": self._total_sampled,
                "experiences": [exp.to_dict() for exp in experiences],
            }
            serialized = json.dumps(data, indent=2)

        with open(path, "w") as f:
            f.write(serialized)

        log.info(f"PrioritizedReplayBuffer saved to {path}", size=len(experiences))

    def load(self, path: str) -> None:
        """
        Carica buffer da file e ricostruisce il SumTree.

        Args:
            path: Path del file JSON

        Raises:
            ValueError: If buffer_type in the file is not 'prioritized'
        """
        with open(path, "r") as f:
            data = json.load(f)

        buf_type = data.get("buffer_type")
        if buf_type and buf_type != "prioritized":
            raise ValueError(
                f"Expected buffer_type='prioritized', got '{buf_type}'"
            )

        with self._lock:
            self.capacity = data.get("capacity", self.capacity)
            self.alpha = data.get("alpha", self.alpha)
            self.epsilon = data.get("epsilon", self.epsilon)
            self._total_added = data.get("total_added", 0)
            self._total_sampled = data.get("total_sampled", 0)

            # Rebuild SumTree from scratch
            self.tree = SumTree(self.capacity)
            self._max_priority = 1.0
            self._oldest_ts = None

            for exp_data in data.get("experiences", []):
                exp = Experience.from_dict(exp_data)
                # Use the saved priority (computed from td_error at add time)
                priority = exp.priority
                self.tree.add(priority, exp)
                self._max_priority = max(self._max_priority, priority)

                exp_ts = datetime.fromisoformat(exp.timestamp)
                if self._oldest_ts is None or exp_ts < self._oldest_ts:
                    self._oldest_ts = exp_ts

        log.info(
            f"PrioritizedReplayBuffer loaded from {path}",
            size=self.tree.n_entries,
        )

    def get_stats(self) -> BufferStats:
        """Calcola statistiche."""
        with self._lock:
            if self.tree.n_entries == 0:
                return BufferStats(
                    size=0,
                    capacity=self.capacity,
                    total_added=self._total_added,
                    total_sampled=self._total_sampled
                )

            # Calcola medie (approssimato)
            experiences = [
                self.tree.data[i]
                for i in range(self.tree.n_entries)
                if self.tree.data[i] is not None
            ]

            rewards = [exp.reward for exp in experiences]
            priorities = [exp.priority for exp in experiences]

            return BufferStats(
                size=self.tree.n_entries,
                capacity=self.capacity,
                total_added=self._total_added,
                total_sampled=self._total_sampled,
                avg_reward=sum(rewards) / len(rewards) if rewards else 0.0,
                avg_priority=sum(priorities) / len(priorities) if priorities else 1.0
            )


# =============================================================================
# FACTORY FUNCTIONS
# =============================================================================

def create_replay_buffer(
    capacity: int = 10000,
    prioritized: bool = False,
    alpha: float = 0.6,
    epsilon: float = 0.01
) -> ExperienceReplayBuffer:
    """
    Factory per creare replay buffer.

    Args:
        capacity: Capacità massima
        prioritized: Se usare prioritized replay
        alpha: Esponente priorità (solo se prioritized)
        epsilon: Costante epsilon (solo se prioritized)

    Returns:
        ExperienceReplayBuffer o PrioritizedReplayBuffer
    """
    if prioritized:
        return PrioritizedReplayBuffer(
            capacity=capacity,
            alpha=alpha,
            epsilon=epsilon
        )
    else:
        return ExperienceReplayBuffer(capacity=capacity)
