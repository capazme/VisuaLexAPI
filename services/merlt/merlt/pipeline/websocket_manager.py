"""
WebSocket Manager per Pipeline Monitoring.

Gestisce connessioni WebSocket multiple per ciascuna pipeline run,
permettendo broadcast di aggiornamenti real-time a tutti i client connessi.
"""

from fastapi import WebSocket
from typing import Dict, Set
import structlog

log = structlog.get_logger()


class PipelineWebSocketManager:
    """
    Manager per connessioni WebSocket delle pipeline.

    Gestisce un set di connessioni per ogni run_id, permettendo:
    - Connessione/disconnessione di client multipli
    - Broadcast di messaggi a tutti i client di una run
    - Cleanup automatico di connessioni morte

    Attributes:
        _connections: Mapping run_id -> Set[WebSocket]

    Example:
        >>> manager = PipelineWebSocketManager()
        >>> await manager.connect("batch_123", websocket)
        >>> await manager.broadcast("batch_123", {"progress": 45.5})
        >>> await manager.disconnect("batch_123", websocket)
    """

    def __init__(self):
        """Inizializza il manager con dizionario vuoto di connessioni."""
        self._connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, run_id: str, websocket: WebSocket) -> None:
        """
        Connette un WebSocket ad una pipeline run.

        Args:
            run_id: ID della pipeline run
            websocket: WebSocket da connettere

        Example:
            >>> await manager.connect("batch_123", websocket)
            # Log: "WS connected run_id=batch_123 total=1"
        """
        await websocket.accept()

        if run_id not in self._connections:
            self._connections[run_id] = set()

        self._connections[run_id].add(websocket)
        log.info("WS connected", run_id=run_id, total=len(self._connections[run_id]))

    async def disconnect(self, run_id: str, websocket: WebSocket) -> None:
        """
        Disconnette un WebSocket da una pipeline run.

        Rimuove il WebSocket dal set e pulisce il run_id se non ci sono più connessioni.

        Args:
            run_id: ID della pipeline run
            websocket: WebSocket da disconnettere

        Example:
            >>> await manager.disconnect("batch_123", websocket)
            # Log: "WS disconnected run_id=batch_123"
        """
        if run_id in self._connections:
            self._connections[run_id].discard(websocket)

            # Cleanup run_id se non ci sono più connessioni
            if not self._connections[run_id]:
                del self._connections[run_id]

        log.info("WS disconnected", run_id=run_id)

    async def broadcast(self, run_id: str, message: Dict) -> None:
        """
        Invia un messaggio a tutti i client connessi ad una run.

        Gestisce errori di invio rimuovendo automaticamente connessioni morte.

        Args:
            run_id: ID della pipeline run
            message: Messaggio JSON da inviare

        Example:
            >>> await manager.broadcast("batch_123", {
            ...     "event": "progress_update",
            ...     "data": {"progress": 67.3}
            ... })
        """
        if run_id not in self._connections:
            return

        disconnected = set()

        for ws in self._connections[run_id]:
            try:
                await ws.send_json(message)
            except Exception as e:
                log.warning("WS send failed", error=str(e), run_id=run_id)
                disconnected.add(ws)

        # Rimuovi connessioni morte
        self._connections[run_id] -= disconnected

    def get_connected_count(self, run_id: str) -> int:
        """
        Restituisce il numero di client connessi ad una run.

        Args:
            run_id: ID della pipeline run

        Returns:
            Numero di WebSocket connessi

        Example:
            >>> count = manager.get_connected_count("batch_123")
            >>> print(f"Client connessi: {count}")
            Client connessi: 3
        """
        return len(self._connections.get(run_id, set()))


# Singleton globale per l'applicazione
ws_manager = PipelineWebSocketManager()
