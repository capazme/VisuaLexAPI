# services/merlt/merlt/pipeline/massimario/adapter.py
"""MechanicalSourceAdapter for the Massimario's annual reviews (spec §6).

`source_ref` is `{"volume": <portal id>}`. The volume is fetched element by
element through VisuaLex (index, chapters, sections outside any chapter), acts
cited by year only are completed through VisuaLex, and the batch is assembled
by `build_volume`.
"""
from __future__ import annotations

import json
from typing import Any, Optional

import structlog

from .rv_bands import RvBands
from .volume import build_volume, walk_index, year_only_acts

log = structlog.get_logger()

RESOLVE_BATCH = 20  # VisuaLex's /resolve_act_dates limit


def parse_source_ref(source_ref: str) -> int:
    try:
        data = json.loads(source_ref)
    except ValueError as exc:
        raise ValueError('source_ref: atteso {"volume": <id>}') from exc
    volume = data.get("volume") if isinstance(data, dict) else None
    if not isinstance(volume, int) or isinstance(volume, bool) or volume <= 0:
        raise ValueError('source_ref: atteso {"volume": <id>}')
    return volume


class MassimarioAdapter:
    def __init__(self, client: Optional[Any] = None, bands: Optional[RvBands] = None) -> None:
        self._client = client
        self._bands = bands

    def _get_client(self):
        if self._client is None:
            from merlt.clients.visualex_client import get_visualex_client

            self._client = get_visualex_client()
        return self._client

    async def fetch_volume(self, volume_id: int) -> dict:
        client = self._get_client()
        index = await client.fetch_massimario("index", volume_id)
        tree = walk_index(index)
        capitoli = {}
        for chapter_id in tree.capitoli:
            capitoli[chapter_id] = await client.fetch_massimario("capitolo", chapter_id)
        sezioni = {}
        for section_id, chapter_id in tree.sezioni.items():
            if chapter_id is None:
                sezioni[section_id] = await client.fetch_massimario("sezione", section_id)
        return {"volume_id": volume_id, "index": index, "capitoli": capitoli, "sezioni": sezioni}

    async def parse(self, source_ref: str) -> dict[str, Any]:
        volume_id = parse_source_ref(source_ref)
        raw = await self.fetch_volume(volume_id)
        acts = sorted(year_only_acts(raw))
        resolved: dict[str, Optional[str]] = {}
        client = self._get_client()
        for i in range(0, len(acts), RESOLVE_BATCH):
            resolved.update(await client.resolve_act_dates(acts[i:i + RESOLVE_BATCH]))
        log.info("massimario.fetched", volume=volume_id, chapters=len(raw["capitoli"]),
                 loose_sections=len(raw["sezioni"]), year_only_acts=len(acts))
        return build_volume(raw, resolved=resolved, bands=self._bands or RvBands.load())
