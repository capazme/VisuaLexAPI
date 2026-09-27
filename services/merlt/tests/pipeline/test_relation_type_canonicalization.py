"""Unit tests for the extractor -> canonical RelationType mapping (loop-closure
B1 gap-closure).

`RelationExtractor` emits a conservative 9-value free-text vocabulary that does
NOT line up with the 65-value `RelationType` enum validated by the
propose-relation endpoint. `canonical_relation_type()` closes that gap; these
tests pin the exact mapping and guarantee every extractor value resolves to a
real enum member (a promote-time 422 regression guard).
"""

from __future__ import annotations

import pytest

from merlt.pipeline.enrichment.extractors.relation import (
    ALLOWED_RELATION_TYPES,
    _EXTRACTOR_TO_CANONICAL_RELATION,
    canonical_relation_type,
)
from merlt.pipeline.enrichment.models import RelationType

_VALID_VALUES = {member.value for member in RelationType}


def test_every_allowed_relation_type_is_mapped():
    assert set(_EXTRACTOR_TO_CANONICAL_RELATION.keys()) == ALLOWED_RELATION_TYPES


@pytest.mark.parametrize("extractor_type", sorted(ALLOWED_RELATION_TYPES))
def test_mapping_resolves_to_a_real_enum_member(extractor_type: str):
    canonical = canonical_relation_type(extractor_type)
    assert canonical in _VALID_VALUES, (
        f"{extractor_type!r} maps to {canonical!r}, which is not a RelationType "
        "member -> would 422 at the propose-relation endpoint"
    )


def test_expected_mapping_values():
    assert canonical_relation_type("RINVIA") == RelationType.CITA.value
    assert canonical_relation_type("DEROGA") == RelationType.DEROGA_A.value
    assert canonical_relation_type("MODIFICA") == RelationType.CORRELATO.value
    assert canonical_relation_type("DEFINISCE") == RelationType.DEFINISCE.value
    assert canonical_relation_type("PRESUPPONE") == RelationType.PRESUPPONE.value
    assert (
        canonical_relation_type("ESPRIME_PRINCIPIO")
        == RelationType.ESPRIME_PRINCIPIO.value
    )
    assert (
        canonical_relation_type("IN_CONTRASTO_CON")
        == RelationType.INCOMPATIBILE_CON.value
    )
    assert canonical_relation_type("SI_APPLICA_A") == RelationType.APPLICA_A.value
    assert canonical_relation_type("CORRELATO_A") == RelationType.CORRELATO.value


def test_unknown_type_falls_back_to_correlato():
    assert canonical_relation_type("SOMETHING_UNMAPPED") == RelationType.CORRELATO.value
