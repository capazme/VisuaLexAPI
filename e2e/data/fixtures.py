"""Canonical payload fixtures shared by flows and stress.

Data-only module (stdlib only, no aiohttp). URN shapes verified against
visualex_api/tools/map.py ("codice civile" -> "regio.decreto:1942-03-16;262:2"),
urngenerator.py (base_url + "!vig=" version suffix) and
backend/tests/integration/merlt/graph-routes.test.ts. The FalkorDB seed
(merlt/data/seeds/libro-iv-cc-graph.json) stores the same full-URL form
WITHOUT the "!vig=" marker — the BFF's normalizeGraphUrn strips it.
"""
from __future__ import annotations

import uuid
from typing import Callable

_NORMATTIVA_CC_BASE = (
    "https://www.normattiva.it/uri-res/N2Ls?"
    "urn:nir:stato:regio.decreto:1942-03-16;262:2"
)


def cc_urn(article: str, vig: bool = True) -> str:
    """Full Normattiva URN for a codice civile article (annex 2, r.d. 262/1942)."""
    return f"{_NORMATTIVA_CC_BASE}~art{article}" + ("!vig=" if vig else "")


# Libro IV article, present in the FalkorDB seed (graph reads resolve it).
FIXTURE_URN_2043 = cc_urn("2043")
# Libro I article, absent from the Libro IV-only seed: deterministic
# lazy-ingest target (empty subgraph = "not indexed" signal, never a 404).
FIXTURE_URN_ABSENT = cc_urn("5")

# Libro IV articles used both to warm the Python-API cache (stress setup)
# and as seeded graph-read targets (all inside the Libro IV seed range).
WARM_ARTICLES: tuple[str, ...] = ("2043", "1218", "1223", "1453", "1175")

# POST /fetch_article_text bodies — first hit fills the cache, later hits
# are served locally (safe for the low-rate cached-search stress action).
SEARCH_BODIES: list[dict] = [
    {"act_type": "codice civile", "article": art, "version": "vigente"}
    for art in WARM_ARTICLES
]

# Graph-read targets for stress: they exist in the seed, so reads never
# trigger lazy ingestion (no RQ jobs created under load).
SEEDED_GRAPH_URNS: list[str] = [cc_urn(art) for art in WARM_ARTICLES]


# ---- tracking event payload factories (Zod: backend/src/schemas/merlt/events.ts) ----

def article_viewed_payload(urn: str, run_id: str) -> dict:
    return {
        "articleUrn": urn,
        "dwellMs": 4500,
        "scrollMaxPct": 60,
        "sessionId": str(uuid.uuid4()),
    }


def highlight_annotation_payload(urn: str, run_id: str) -> dict:
    return {
        "kind": "annotation",
        "anchorText": "il risarcimento del danno",
        "startOffset": 42,
        "articleUrn": urn,
        "noteText": f"E2E note {run_id}",
    }


def dossier_bookmark_payload(urn: str, run_id: str) -> dict:
    return {
        "kind": "dossier",
        "articleUrn": urn,
        "dossierId": str(uuid.uuid4()),
        "tags": [f"e2e-{run_id}"],
    }


def citation_clicked_payload(urn: str, run_id: str) -> dict:
    return {
        "sourceArticleUrn": urn,
        "targetArticleUrn": None,  # nullable by contract
        "citationText": f"art. 1218 c.c. [e2e {run_id}]",
    }


def forum_signal_payload(urn: str, run_id: str) -> dict:
    return {
        "action": "like",
        "sharedEnvId": str(uuid.uuid4()),
        "originalAuthorId": None,
    }


EVENT_PAYLOADS: dict[str, Callable[[str, str], dict]] = {
    "article-viewed": article_viewed_payload,
    "highlight-annotation": highlight_annotation_payload,
    "dossier-bookmark": dossier_bookmark_payload,
    "citation-clicked": citation_clicked_payload,
    "forum-signal": forum_signal_payload,
}


# ---- forum ----
# Minimal valid `content` blob for POST /shared-environments
# (publishEnvironmentSchema requires the 4 arrays; customAliases optional).
FORUM_ENV_CONTENT: dict = {
    "dossiers": [],
    "quickNorms": [],
    "customAliases": [],
    "annotations": [],
    "highlights": [],
}


# ---- stress ----
# Rotating GET /graph/search terms (Libro IV vocabulary — matches seed content).
STRESS_SEARCH_TERMS: list[str] = [
    "risoluzione",
    "inadempimento",
    "obbligazione",
    "contratto",
    "danno",
    "buona fede",
    "diffida",
    "caparra",
    "transazione",
    "responsabilita",
]
