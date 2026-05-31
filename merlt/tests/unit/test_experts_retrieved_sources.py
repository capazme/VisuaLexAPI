"""Loop β F.0 (Option A) — retrieved_sources panel + readable citation.

Verifies the M6 source-enrichment contract without touching the heavy pipeline:
  * cited LegalSource surfaces its readable `citation`
  * `_build_retrieved_sources` reads URNs from the retrieval trace, de-dupes,
    and enriches each with FalkorDB provenance/trust/node_id (mocked).
"""

import sys
from types import SimpleNamespace

import pytest

from merlt.api.experts_router import _build_retrieved_sources, _to_source_reference

# api/__init__.py binds `experts_router` to the APIRouter, shadowing the
# submodule name for attribute access — fetch the real module from sys.modules.
er = sys.modules[_build_retrieved_sources.__module__]


def test_cited_source_surfaces_readable_citation():
    ls = SimpleNamespace(
        source_type="norm",
        source_id="norm_1",
        citation="Art. 1453 c.c.",
        excerpt="La risoluzione...",
        relevance="",
        relevance_score=0.0,
    )
    ref = _to_source_reference(ls)
    assert ref.citation == "Art. 1453 c.c."


@pytest.mark.asyncio
async def test_retrieved_sources_enriched_from_trace(monkeypatch):
    async def fake_lookup(urns):
        return {
            "https://www.normattiva.it/...~art1453": {
                "provenance": "seed",
                "trust": 1.0,
                "node_id": "https://www.normattiva.it/...~art1453",
            },
            "live:abc123": {
                "provenance": "live_unconfirmed",
                "trust": 0.6,
                "node_id": "live:abc123",
            },
        }

    # NB: setattr on the module object, not the dotted string — api/__init__.py
    # binds `experts_router` to the APIRouter, shadowing the submodule name.
    monkeypatch.setattr(er, "_lookup_provenance_batch", fake_lookup)
    result = SimpleNamespace(
        metadata={
            "pipeline_trace": {
                "stages": {
                    "expert_executions": [
                        {
                            "retrieval_trace": {
                                "top_sources": [
                                    "https://www.normattiva.it/...~art1453",
                                    "live:abc123",
                                    "https://www.normattiva.it/...~art1453",
                                ]
                            }
                        },
                    ]
                }
            }
        }
    )
    out = await _build_retrieved_sources(result)
    urns = {s.urn for s in out}
    assert urns == {"https://www.normattiva.it/...~art1453", "live:abc123"}
    live = next(s for s in out if s.urn == "live:abc123")
    assert live.provenance == "live_unconfirmed"
    assert live.node_id == "live:abc123"
    assert live.trust == 0.6
