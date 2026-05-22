"""
Checkpoint Manager
==================

Gestisce checkpoint e resume per la pipeline di enrichment.

Permette di:
- Salvare progresso durante elaborazione lunga
- Riprendere da dove si era interrotti
- Evitare ri-processamento di contenuti già elaborati

Esempio:
    checkpoint = CheckpointManager(Path("data/checkpoints/enrichment/"))

    # Durante elaborazione
    for content in contents:
        if checkpoint.is_processed(content.id):
            continue  # Skip già fatto
        # ... elabora ...
        checkpoint.mark_done(content.id)

    # Resume automatico alla prossima esecuzione
"""

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


@dataclass
class CheckpointError:
    """
    Errore tracciato nel checkpoint.

    Attributes:
        item_id: ID dell'item che ha causato l'errore
        phase: Fase in cui è avvenuto (fetch, extract, write, etc.)
        error_message: Messaggio di errore
        timestamp: Quando è avvenuto
        retryable: Se l'errore può essere ritentato
    """
    item_id: str
    phase: str
    error_message: str
    timestamp: str = ""
    retryable: bool = True

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now().isoformat()

    def to_dict(self) -> Dict[str, Any]:
        """Serializza per salvataggio."""
        return {
            "item_id": self.item_id,
            "phase": self.phase,
            "error_message": self.error_message,
            "timestamp": self.timestamp,
            "retryable": self.retryable,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CheckpointError":
        """Deserializza da dict."""
        return cls(
            item_id=data["item_id"],
            phase=data["phase"],
            error_message=data["error_message"],
            timestamp=data.get("timestamp", ""),
            retryable=data.get("retryable", True),
        )


@dataclass
class CheckpointState:
    """
    Stato del checkpoint.

    Attributes:
        run_id: ID univoco dell'esecuzione
        processed_ids: Set di content_id già processati
        started_at: Timestamp inizio
        last_updated: Timestamp ultimo aggiornamento
        config_hash: Hash della config per validazione
        stats: Statistiche parziali
        errors: Lista di errori tracciati per retry
    """
    run_id: str
    processed_ids: Set[str] = field(default_factory=set)
    started_at: str = ""
    last_updated: str = ""
    config_hash: str = ""
    stats: Dict[str, int] = field(default_factory=dict)
    errors: List["CheckpointError"] = field(default_factory=list)

    def __post_init__(self):
        if not self.started_at:
            self.started_at = datetime.now().isoformat()
        if not self.last_updated:
            self.last_updated = self.started_at
        if not self.stats:
            self.stats = {
                "concepts_created": 0,
                "principles_created": 0,
                "definitions_created": 0,
                "relations_created": 0,
                "errors": 0,
            }

    def to_dict(self) -> Dict[str, Any]:
        """Serializza per salvataggio."""
        return {
            "run_id": self.run_id,
            "processed_ids": list(self.processed_ids),
            "started_at": self.started_at,
            "last_updated": self.last_updated,
            "config_hash": self.config_hash,
            "stats": self.stats,
            "errors": [e.to_dict() for e in self.errors],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CheckpointState":
        """Deserializza da dict."""
        errors = [CheckpointError.from_dict(e) for e in data.get("errors", [])]
        return cls(
            run_id=data["run_id"],
            processed_ids=set(data.get("processed_ids", [])),
            started_at=data.get("started_at", ""),
            last_updated=data.get("last_updated", ""),
            config_hash=data.get("config_hash", ""),
            stats=data.get("stats", {}),
            errors=errors,
        )


class CheckpointManager:
    """
    Gestisce checkpoint per pipeline di enrichment.

    Salva lo stato su filesystem per permettere resume dopo
    interruzioni o errori.

    Attributes:
        checkpoint_dir: Directory per file checkpoint
        run_id: ID dell'esecuzione corrente
        state: Stato corrente del checkpoint

    Example:
        >>> checkpoint = CheckpointManager(Path("data/checkpoints/enrichment/"))
        >>> checkpoint.start_run("enrichment_libro_iv_2025")
        >>>
        >>> for content in contents:
        ...     if checkpoint.is_processed(content.id):
        ...         continue
        ...     # ... elabora content ...
        ...     checkpoint.mark_done(content.id)
        >>>
        >>> checkpoint.finalize()
    """

    def __init__(
        self,
        checkpoint_dir: Path,
        run_id: Optional[str] = None,
        auto_save_interval: int = 10,
    ):
        """
        Inizializza il checkpoint manager.

        Args:
            checkpoint_dir: Directory per file checkpoint
            run_id: ID esecuzione (genera se None)
            auto_save_interval: Ogni quanti item salvare automaticamente
        """
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        self.run_id = run_id or self._generate_run_id()
        self.auto_save_interval = auto_save_interval
        self._items_since_save = 0

        # Carica stato esistente o crea nuovo
        self.state = self._load_or_create_state()

    def _generate_run_id(self) -> str:
        """Genera un run_id univoco."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"enrichment_{timestamp}"

    def _checkpoint_path(self) -> Path:
        """Path del file checkpoint."""
        return self.checkpoint_dir / f"{self.run_id}.json"

    def _load_or_create_state(self) -> CheckpointState:
        """Carica stato esistente o crea nuovo."""
        path = self._checkpoint_path()
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                state = CheckpointState.from_dict(data)
                logger.info(
                    f"Checkpoint caricato: {len(state.processed_ids)} items già processati"
                )
                return state
            except Exception as e:
                logger.warning(f"Errore caricamento checkpoint: {e}. Creo nuovo.")

        return CheckpointState(run_id=self.run_id)

    def start_run(self, config_hash: str = "") -> None:
        """
        Inizia una nuova esecuzione o riprende esistente.

        Args:
            config_hash: Hash della config per validazione consistenza
        """
        self.state.config_hash = config_hash
        self.state.started_at = datetime.now().isoformat()
        self._save()
        logger.info(f"Run iniziato: {self.run_id}")

    def is_processed(self, content_id: str) -> bool:
        """
        Verifica se un content_id è già stato processato.

        Args:
            content_id: ID del contenuto da verificare

        Returns:
            True se già processato
        """
        return content_id in self.state.processed_ids

    def mark_done(
        self,
        content_id: str,
        stats_update: Optional[Dict[str, int]] = None
    ) -> None:
        """
        Marca un content_id come processato.

        Args:
            content_id: ID del contenuto completato
            stats_update: Aggiornamento statistiche opzionale
        """
        self.state.processed_ids.add(content_id)
        self.state.last_updated = datetime.now().isoformat()

        # Aggiorna statistiche
        if stats_update:
            for key, value in stats_update.items():
                self.state.stats[key] = self.state.stats.get(key, 0) + value

        # Auto-save periodico
        self._items_since_save += 1
        if self._items_since_save >= self.auto_save_interval:
            self._save()
            self._items_since_save = 0

    def mark_error(
        self,
        content_id: str,
        phase: str = "processing",
        error_message: str = "",
        retryable: bool = True,
    ) -> None:
        """
        Marca un errore per un content_id.

        Non marca come processato così può essere ritentato.
        Salva i dettagli dell'errore per il retry endpoint.

        Args:
            content_id: ID del contenuto con errore
            phase: Fase in cui è avvenuto (fetch, extract, write, etc.)
            error_message: Messaggio di errore descrittivo
            retryable: Se l'errore può essere ritentato (default True)
        """
        self.state.stats["errors"] = self.state.stats.get("errors", 0) + 1
        self.state.last_updated = datetime.now().isoformat()

        # Traccia errore per retry
        error = CheckpointError(
            item_id=content_id,
            phase=phase,
            error_message=error_message,
            retryable=retryable,
        )
        self.state.errors.append(error)

    def get_errors(self, retryable_only: bool = False) -> List[CheckpointError]:
        """
        Recupera lista errori.

        Args:
            retryable_only: Se True, restituisce solo errori ritentabili

        Returns:
            Lista di CheckpointError
        """
        if retryable_only:
            return [e for e in self.state.errors if e.retryable]
        return self.state.errors.copy()

    def clear_errors(self) -> int:
        """
        Pulisce tutti gli errori (dopo retry).

        Returns:
            Numero di errori rimossi
        """
        count = len(self.state.errors)
        self.state.errors.clear()
        self.state.stats["errors"] = 0
        self._save()
        return count

    def load(self) -> Set[str]:
        """
        Carica e restituisce gli ID già processati.

        Returns:
            Set di content_id processati
        """
        return self.state.processed_ids.copy()

    def _save(self) -> None:
        """Salva stato su disco."""
        path = self._checkpoint_path()
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self.state.to_dict(), f, indent=2, ensure_ascii=False)
            logger.debug(f"Checkpoint salvato: {len(self.state.processed_ids)} items")
        except Exception as e:
            logger.error(f"Errore salvataggio checkpoint: {e}")

    def finalize(self) -> Dict[str, Any]:
        """
        Finalizza l'esecuzione e salva stato finale.

        Returns:
            Statistiche finali
        """
        self.state.last_updated = datetime.now().isoformat()
        self._save()

        logger.info(
            f"Run completato: {len(self.state.processed_ids)} items processati"
        )
        return {
            "run_id": self.run_id,
            "processed_count": len(self.state.processed_ids),
            "stats": self.state.stats,
            "started_at": self.state.started_at,
            "completed_at": self.state.last_updated,
        }

    def reset(self) -> None:
        """
        Reset completo del checkpoint.

        ATTENZIONE: Elimina tutto il progresso salvato.
        """
        path = self._checkpoint_path()
        if path.exists():
            path.unlink()
        self.state = CheckpointState(run_id=self.run_id)
        logger.warning(f"Checkpoint resettato: {self.run_id}")

    @classmethod
    def list_checkpoints(cls, checkpoint_dir: Path) -> list:
        """
        Lista tutti i checkpoint esistenti.

        Args:
            checkpoint_dir: Directory checkpoint

        Returns:
            Lista di (run_id, processed_count, last_updated)
        """
        checkpoints = []
        checkpoint_dir = Path(checkpoint_dir)

        if not checkpoint_dir.exists():
            return checkpoints

        for path in checkpoint_dir.glob("*.json"):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                checkpoints.append({
                    "run_id": data.get("run_id", path.stem),
                    "processed_count": len(data.get("processed_ids", [])),
                    "last_updated": data.get("last_updated", ""),
                    "stats": data.get("stats", {}),
                })
            except Exception as e:
                logger.debug("checkpoint_parse_skipped: %s", str(e))
                continue

        return sorted(checkpoints, key=lambda x: x["last_updated"], reverse=True)
