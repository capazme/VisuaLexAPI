"""Ordered flow registry with lazy imports.

Modules are resolved via importlib only when the runner asks for them, so a
broken flow file surfaces as a per-flow FAIL instead of killing the package
import (and `python -m e2e.preflight` keeps working regardless).
"""
from __future__ import annotations

import importlib
from typing import Any, Callable

# Execution order is load-bearing (blueprint §3): auth provisions the
# identities, consent sets the level every MERL-T flow relies on, search
# captures the URNs, contrib feeds validate, ops runs last.
FLOW_REGISTRY: list[tuple[str, str]] = [
    ("auth", "flow_auth"),
    ("consent", "flow_consent"),
    ("search", "flow_search"),
    ("dossier", "flow_dossier"),
    ("forum", "flow_forum"),
    ("tracking", "flow_tracking"),
    ("graph", "flow_graph"),
    ("ner", "flow_ner"),
    ("qa", "flow_qa"),
    ("contrib", "flow_contrib"),
    ("validate", "flow_validate"),
    ("ops", "flow_ops"),
]

_BY_NAME = dict(FLOW_REGISTRY)


def get_flow(name: str) -> tuple[Callable[..., Any], frozenset[str]]:
    """Lazily import a flow module; returns (run coroutine fn, TAGS)."""
    try:
        module_name = _BY_NAME[name]
    except KeyError:
        raise KeyError(
            f"unknown flow '{name}' (known: {', '.join(_BY_NAME)})"
        ) from None
    module = importlib.import_module(f"e2e.flows.{module_name}")
    return module.run, module.TAGS
