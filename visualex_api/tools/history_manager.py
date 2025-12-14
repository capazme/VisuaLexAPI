"""
History Manager per la persistenza della cronologia delle ricerche.
Gestisce salvataggio/caricamento su file JSON con deduplicazione.
"""
import json
import asyncio
from datetime import datetime
from collections import deque
from typing import Optional

from visualex_api.tools.config import HISTORY_LIMIT, HISTORY_FILE


class HistoryManager:
    """Gestisce la history delle ricerche con persistenza su file JSON."""

    def __init__(self):
        self._history: deque = deque(maxlen=HISTORY_LIMIT)
        self._lock = asyncio.Lock()
        self._load_from_file()

    def _load_from_file(self):
        """Carica la history dal file JSON all'avvio."""
        try:
            if HISTORY_FILE.exists():
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for item in data[-HISTORY_LIMIT:]:
                        self._history.append(item)
        except Exception as e:
            print(f"Warning: Could not load history: {e}")

    async def _save_to_file(self):
        """Salva la history su file JSON."""
        async with self._lock:
            try:
                HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
                with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                    json.dump(list(self._history), f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"Warning: Could not save history: {e}")

    def add(self, data: dict) -> bool:
        """
        Aggiunge una ricerca alla history.

        Returns:
            True se aggiunto, False se duplicato consecutivo
        """
        entry = {
            'act_type': data.get('act_type', ''),
            'act_number': data.get('act_number'),
            'article': str(data.get('article', '')),
            'date': data.get('date'),
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

        # Evita duplicati consecutivi
        if self._history:
            last = self._history[-1]
            if (last.get('act_type') == entry['act_type'] and
                last.get('act_number') == entry['act_number'] and
                last.get('article') == entry['article'] and
                last.get('date') == entry['date']):
                return False

        self._history.append(entry)
        # Salvataggio asincrono (fire and forget)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._save_to_file())
        except RuntimeError:
            # Se non c'è event loop, salva in modo sincrono
            self._save_sync()
        return True

    def _save_sync(self):
        """Salvataggio sincrono per contesti senza event loop."""
        try:
            HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                json.dump(list(self._history), f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Warning: Could not save history: {e}")

    def get_all(self) -> list:
        """Restituisce tutta la history come lista."""
        return list(self._history)

    def clear(self) -> None:
        """Svuota la history."""
        self._history.clear()
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._save_to_file())
        except RuntimeError:
            self._save_sync()

    def remove(self, timestamp: str) -> bool:
        """
        Rimuove un item specifico per timestamp.

        Returns:
            True se trovato e rimosso, False altrimenti
        """
        for i, item in enumerate(self._history):
            if item.get('timestamp') == timestamp:
                del self._history[i]
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(self._save_to_file())
                except RuntimeError:
                    self._save_sync()
                return True
        return False


# Singleton instance
history_manager = HistoryManager()
