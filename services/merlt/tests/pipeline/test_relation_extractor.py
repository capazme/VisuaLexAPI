"""Unit tests for the free-text RelationExtractor (loop-closure B1).

Covers the deterministic response-parsing (filtering self-loops / empty
endpoints, normalizing unknown relation types, clamping confidence) and the
LLM-call wrapper's error handling. No live LLM.

    docker exec -w /app visualex-merlt-api python -m pytest tests/pipeline/test_relation_extractor.py -q
"""

from __future__ import annotations

from types import SimpleNamespace

from merlt.pipeline.enrichment.extractors.relation import (
    RelationExtractor,
    ExtractedRelation,
)


def _content(text: str = "art 1 e art 2 sono correlati"):
    return SimpleNamespace(text=text)


def test_parse_response_builds_relations():
    ext = RelationExtractor(llm_service=object())
    resp = {
        "relations": [
            {
                "source": "Risoluzione",
                "target": "Inadempimento",
                "relation_type": "PRESUPPONE",
                "descrizione": "x",
                "confidence": 0.9,
            }
        ]
    }
    rels = ext._parse_response(resp, _content())
    assert len(rels) == 1
    r = rels[0]
    assert isinstance(r, ExtractedRelation)
    assert r.source == "Risoluzione"
    assert r.target == "Inadempimento"
    assert r.relation_type == "PRESUPPONE"
    assert r.confidence == 0.9


def test_parse_response_filters_and_normalizes():
    ext = RelationExtractor(llm_service=object())
    resp = {
        "relations": [
            {"source": "A", "target": "A", "relation_type": "RINVIA"},  # self-loop → dropped
            {"source": "", "target": "B", "relation_type": "RINVIA"},  # empty source → dropped
            {"source": "A", "target": "B", "relation_type": "bogus"},  # unknown → CORRELATO_A
            {"source": "C", "target": "D", "relation_type": "rinvia", "confidence": 5},  # upper + clamp
        ]
    }
    rels = ext._parse_response(resp, _content())
    assert len(rels) == 2
    by_pair = {(r.source, r.target): r for r in rels}
    assert by_pair[("A", "B")].relation_type == "CORRELATO_A"
    assert by_pair[("C", "D")].relation_type == "RINVIA"
    assert by_pair[("C", "D")].confidence == 1.0  # clamped to [0,1]


def test_parse_response_handles_null_relations():
    ext = RelationExtractor(llm_service=object())
    assert ext._parse_response({"relations": None}, _content()) == []
    assert ext._parse_response({}, _content()) == []


async def test_extract_uses_llm_and_parses():
    class FakeLLM:
        async def generate_json_completion(self, **kwargs):
            return {
                "relations": [
                    {"source": "A", "target": "B", "relation_type": "RINVIA", "confidence": 0.7}
                ]
            }

    rels = await RelationExtractor(FakeLLM()).extract(_content())
    assert len(rels) == 1
    assert rels[0].relation_type == "RINVIA"
    assert rels[0].confidence == 0.7


async def test_extract_returns_empty_on_llm_error():
    class BoomLLM:
        async def generate_json_completion(self, **kwargs):
            raise RuntimeError("boom")

    assert await RelationExtractor(BoomLLM()).extract(_content()) == []
