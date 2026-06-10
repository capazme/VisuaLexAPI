"""
Dossier Manager per la persistenza dei dossier.
Gestisce salvataggio/caricamento su file JSON con CRUD completo.
"""
import json
import os
import asyncio
import threading
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any

from visualex_api.tools.config import DOSSIER_FILE, DOSSIER_LIMIT


class DossierManager:
    """Gestisce i dossier con persistenza su file JSON."""

    def __init__(self):
        self._dossiers: List[Dict[str, Any]] = []
        self._lock = asyncio.Lock()
        self._mutex = threading.Lock()
        self._load_from_file()

    def _load_from_file(self):
        """Carica i dossier dal file JSON all'avvio."""
        try:
            if DOSSIER_FILE.exists():
                with open(DOSSIER_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._dossiers = data[-DOSSIER_LIMIT:]
        except Exception as e:
            print(f"Warning: Could not load dossiers: {e}")

    def _write_file(self):
        """Scrittura atomica: serializza sotto lock, scrive su .tmp e poi os.replace."""
        with self._mutex:
            payload = json.dumps(self._dossiers, ensure_ascii=False, indent=2)
        DOSSIER_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = str(DOSSIER_FILE) + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as f:
            f.write(payload)
        os.replace(tmp_path, DOSSIER_FILE)

    async def _save_to_file(self):
        """Salva i dossier su file JSON."""
        async with self._lock:
            try:
                self._write_file()
            except Exception as e:
                print(f"Warning: Could not save dossiers: {e}")

    def _save_sync(self):
        """Salvataggio sincrono per contesti senza event loop."""
        try:
            self._write_file()
        except Exception as e:
            print(f"Warning: Could not save dossiers: {e}")

    def _trigger_save(self):
        """Trigger salvataggio asincrono o sincrono."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._save_to_file())
        except RuntimeError:
            self._save_sync()

    def get_all(self) -> List[Dict[str, Any]]:
        """Restituisce tutti i dossier come lista."""
        return self._dossiers.copy()

    def get_by_id(self, dossier_id: str) -> Optional[Dict[str, Any]]:
        """Restituisce un dossier specifico per ID."""
        for dossier in self._dossiers:
            if dossier.get('id') == dossier_id:
                return dossier.copy()
        return None

    def create(self, title: str, description: str = '') -> Dict[str, Any]:
        """
        Crea un nuovo dossier.

        Returns:
            Il dossier creato con il suo ID
        """
        new_dossier = {
            'id': str(uuid.uuid4()),
            'title': title,
            'description': description,
            'createdAt': datetime.utcnow().isoformat() + 'Z',
            'items': [],
            'tags': [],
            'isPinned': False
        }
        with self._mutex:
            self._dossiers.append(new_dossier)
        self._trigger_save()
        return new_dossier

    def update(self, dossier_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Aggiorna un dossier esistente.

        Args:
            dossier_id: ID del dossier da aggiornare
            updates: Dict con i campi da aggiornare (title, description, tags, isPinned)

        Returns:
            Il dossier aggiornato o None se non trovato
        """
        updated = None
        with self._mutex:
            for dossier in self._dossiers:
                if dossier.get('id') == dossier_id:
                    if 'title' in updates:
                        dossier['title'] = updates['title']
                    if 'description' in updates:
                        dossier['description'] = updates['description']
                    if 'tags' in updates:
                        dossier['tags'] = updates['tags']
                    if 'isPinned' in updates:
                        dossier['isPinned'] = updates['isPinned']
                    updated = dossier.copy()
                    break
        if updated is not None:
            self._trigger_save()
            return updated
        return None

    def delete(self, dossier_id: str) -> bool:
        """
        Elimina un dossier.

        Returns:
            True se eliminato, False se non trovato
        """
        deleted = False
        with self._mutex:
            for i, dossier in enumerate(self._dossiers):
                if dossier.get('id') == dossier_id:
                    del self._dossiers[i]
                    deleted = True
                    break
        if deleted:
            self._trigger_save()
            return True
        return False

    def add_item(self, dossier_id: str, item_data: Dict[str, Any], item_type: str = 'norma') -> Optional[Dict[str, Any]]:
        """
        Aggiunge un item a un dossier.

        Args:
            dossier_id: ID del dossier
            item_data: Dati dell'item (norma o nota)
            item_type: Tipo di item ('norma' o 'note')

        Returns:
            L'item creato o None se dossier non trovato
        """
        created = None
        with self._mutex:
            for dossier in self._dossiers:
                if dossier.get('id') == dossier_id:
                    new_item = {
                        'id': str(uuid.uuid4()),
                        'type': item_type,
                        'data': item_data,
                        'addedAt': datetime.utcnow().isoformat() + 'Z',
                        'status': 'unread'
                    }
                    dossier['items'].append(new_item)
                    created = new_item
                    break
        if created is not None:
            self._trigger_save()
            return created
        return None

    def remove_item(self, dossier_id: str, item_id: str) -> bool:
        """
        Rimuove un item da un dossier.

        Returns:
            True se rimosso, False se non trovato
        """
        removed = False
        with self._mutex:
            for dossier in self._dossiers:
                if dossier.get('id') == dossier_id:
                    for i, item in enumerate(dossier['items']):
                        if item.get('id') == item_id:
                            del dossier['items'][i]
                            removed = True
                            break
                    break
        if removed:
            self._trigger_save()
            return True
        return False

    def update_item_status(self, dossier_id: str, item_id: str, status: str) -> bool:
        """
        Aggiorna lo status di un item.

        Args:
            status: 'unread', 'reading', 'important', 'done'

        Returns:
            True se aggiornato, False se non trovato
        """
        updated = False
        with self._mutex:
            for dossier in self._dossiers:
                if dossier.get('id') == dossier_id:
                    for item in dossier['items']:
                        if item.get('id') == item_id:
                            item['status'] = status
                            updated = True
                            break
                    break
        if updated:
            self._trigger_save()
            return True
        return False

    def import_dossier(self, dossier_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Importa un dossier (da share link).
        Genera nuovi ID per evitare conflitti.

        Returns:
            Il dossier importato con nuovi ID
        """
        new_dossier = {
            'id': str(uuid.uuid4()),
            'title': dossier_data.get('title', 'Dossier Importato'),
            'description': dossier_data.get('description', ''),
            'createdAt': datetime.utcnow().isoformat() + 'Z',
            'items': [],
            'tags': dossier_data.get('tags', []),
            'isPinned': False
        }

        # Rigenera ID per tutti gli items
        for item in dossier_data.get('items', []):
            new_item = {
                'id': str(uuid.uuid4()),
                'type': item.get('type', 'norma'),
                'data': item.get('data'),
                'addedAt': item.get('addedAt', datetime.utcnow().isoformat() + 'Z'),
                'status': item.get('status', 'unread')
            }
            new_dossier['items'].append(new_item)

        with self._mutex:
            self._dossiers.append(new_dossier)
        self._trigger_save()
        return new_dossier

    def sync_all(self, dossiers: List[Dict[str, Any]]) -> None:
        """
        Sincronizza tutti i dossier (sostituisce l'intera lista).
        Usato per sync completo da frontend.
        """
        with self._mutex:
            self._dossiers = dossiers[-DOSSIER_LIMIT:]
        self._trigger_save()


# Singleton instance
dossier_manager = DossierManager()
