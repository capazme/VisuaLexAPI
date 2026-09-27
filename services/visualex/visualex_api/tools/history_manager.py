"""
History Manager per la persistenza della cronologia delle ricerche.
Gestisce salvataggio/caricamento su file JSON con deduplicazione.
"""
import json
import os
import asyncio
import threading
from datetime import datetime
from collections import deque
from typing import Optional

from visualex_api.tools.config import HISTORY_LIMIT, HISTORY_FILE


class HistoryManager:
    """Gestisce la history delle ricerche con persistenza su file JSON."""

    def __init__(self):
        self._history: deque = deque(maxlen=HISTORY_LIMIT)
        self._lock = asyncio.Lock()
        self._mutex = threading.Lock()
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

    def _write_file(self):
        """Scrittura atomica: serializza sotto lock, scrive su .tmp e poi os.replace."""
        with self._mutex:
            payload = json.dumps(list(self._history), ensure_ascii=False, indent=2)
        HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = str(HISTORY_FILE) + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as f:
            f.write(payload)
        os.replace(tmp_path, HISTORY_FILE)

    async def _save_to_file(self):
        """Salva la history su file JSON."""
        async with self._lock:
            try:
                self._write_file()
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
        with self._mutex:
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
            self._write_file()
        except Exception as e:
            print(f"Warning: Could not save history: {e}")

    def get_all(self) -> list:
        """Restituisce tutta la history come lista."""
        return list(self._history)

    def clear(self) -> None:
        """Svuota la history."""
        with self._mutex:
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
        removed = False
        with self._mutex:
            for i, item in enumerate(self._history):
                if item.get('timestamp') == timestamp:
                    del self._history[i]
                    removed = True
                    break
        if removed:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._save_to_file())
            except RuntimeError:
                self._save_sync()
            return True
        return False


# Singleton instance
history_manager = HistoryManager()
