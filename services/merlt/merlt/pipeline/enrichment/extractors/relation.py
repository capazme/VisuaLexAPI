"""
Relation Extractor (loop-closure B1)
====================================

LLM extractor for SEMANTIC RELATIONS in free-text study notes.

The existing entity extractors (concept/principle/definition) only produce
nodes; the `MechanisticExtractor` only reads Brocardi-structured data. Neither
proposes relations from free text. This extractor closes that gap for the
"Apprendi dai miei appunti" staging flow: given a chunk of notes, it proposes
typed relations between the legal concepts mentioned, each with a verbatim
excerpt (for the copyright gate) and a confidence.

Mirrors `BaseEntityExtractor`'s LLM call shape
(`llm_service.generate_json_completion`) so it stays consistent with the rest
of the enrichment pipeline. Relations land ONLY in the ephemeral
`extraction_candidates` staging table; promotion to `pending_relations` happens
later from the user's reviewed/reformulated text.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    from merlt.rlcf.ai_service import OpenRouterService
    from merlt.pipeline.enrichment.models import EnrichmentContent

from merlt.pipeline.enrichment.models import RelationType

logger = logging.getLogger(__name__)

# Allowed relation types for free-text notes (a conservative, legal-domain set).
ALLOWED_RELATION_TYPES = {
    "RINVIA",
    "DEROGA",
    "MODIFICA",
    "DEFINISCE",
    "PRESUPPONE",
    "ESPRIME_PRINCIPIO",
    "IN_CONTRASTO_CON",
    "SI_APPLICA_A",
    "CORRELATO_A",
}
_DEFAULT_RELATION_TYPE = "CORRELATO_A"

# The 9 free-text relation types above are the extractor's own conservative
# vocabulary; they do NOT line up with `RelationType` (the 65-value canonical
# enum in merlt.pipeline.enrichment.models, validated by the propose-relation
# endpoint via pydantic — api/models/enrichment_models.py's
# `RelationProposalRequest.tipo_relazione: RelationType`). Only DEFINISCE,
# PRESUPPONE and ESPRIME_PRINCIPIO happen to match verbatim; every other
# extractor type 422s the promote call unless normalized first. This map is
# the single source of truth for that normalization; apply it where the
# candidate is CREATED (see `document_parser.py::_extract_relations_from_chunks`)
# so the value is already canonical by the time it reaches promote.
_EXTRACTOR_TO_CANONICAL_RELATION: Dict[str, str] = {
    "RINVIA": RelationType.CITA.value,  # explicit textual reference/renvoi
    "DEROGA": RelationType.DEROGA_A.value,
    "MODIFICA": RelationType.CORRELATO.value,  # no generic "modifica" member; the
    # enum's modification relations (SOSTITUISCE/INTEGRA/ABROGA_*/...) are more
    # specific than free-text notes can reliably disambiguate
    "DEFINISCE": RelationType.DEFINISCE.value,
    "PRESUPPONE": RelationType.PRESUPPONE.value,
    "ESPRIME_PRINCIPIO": RelationType.ESPRIME_PRINCIPIO.value,
    "IN_CONTRASTO_CON": RelationType.INCOMPATIBILE_CON.value,
    "SI_APPLICA_A": RelationType.APPLICA_A.value,
    "CORRELATO_A": RelationType.CORRELATO.value,
}


def canonical_relation_type(extractor_relation_type: str) -> str:
    """Normalize a `RelationExtractor` output type to the canonical `RelationType`
    enum value expected by the propose-relation endpoint.

    Falls back to `RelationType.CORRELATO.value` for anything outside
    `ALLOWED_RELATION_TYPES` (defensive; callers only ever pass one of those).
    """
    return _EXTRACTOR_TO_CANONICAL_RELATION.get(
        extractor_relation_type, RelationType.CORRELATO.value
    )


@dataclass
class ExtractedRelation:
    """A relation candidate proposed from free text (pre-validation)."""

    source: str
    target: str
    relation_type: str
    descrizione: str = ""
    confidence: float = 1.0
    raw_context: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "relations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "relation_type": {"type": "string"},
                    "descrizione": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["source", "target", "relation_type"],
            },
        }
    },
    "required": ["relations"],
}

_SYSTEM_PROMPT = (
    "Sei un esperto di diritto italiano. Individua RELAZIONI semantiche tra i "
    "concetti giuridici presenti nel testo. Rispondi SEMPRE in JSON valido."
)

_PROMPT_TEMPLATE = """Analizza il testo e individua le RELAZIONI semantiche tra i concetti giuridici citati.

Usa SOLO questi tipi di relazione: {relation_types}.

Per ogni relazione restituisci: source (concetto di partenza), target (concetto di arrivo),
relation_type (uno dei tipi ammessi), descrizione (breve), confidence (0..1).
NON inventare concetti non presenti nel testo.

TESTO:
{text}

Rispondi in JSON: {{"relations": [...]}}"""


class RelationExtractor:
    """LLM-based extractor of semantic relations from free text."""

    def __init__(self, llm_service: "OpenRouterService"):
        self.llm = llm_service

    def _build_prompt(self, content: "EnrichmentContent") -> str:
        return _PROMPT_TEMPLATE.format(
            relation_types=", ".join(sorted(ALLOWED_RELATION_TYPES)),
            text=content.text,
        )

    def _llm_config(self) -> Dict[str, Any]:
        return {
            "model": os.environ.get("LLM_ENRICHMENT_MODEL", "google/gemini-2.5-flash"),
            "temperature": 0.0,
            "max_tokens": 2000,
            "timeout": 60,
        }

    async def extract(self, content: "EnrichmentContent") -> List[ExtractedRelation]:
        """Extract relation candidates from the chunk. Returns [] on any LLM error."""
        try:
            cfg = self._llm_config()
            response = await self.llm.generate_json_completion(
                prompt=self._build_prompt(content),
                json_schema=_RESPONSE_SCHEMA,
                system_prompt=_SYSTEM_PROMPT,
                model=cfg["model"],
                temperature=cfg["temperature"],
                max_tokens=cfg["max_tokens"],
                timeout=cfg["timeout"],
            )
            return self._parse_response(response, content)
        except Exception as e:  # never fail the pipeline on an extractor error
            logger.error(f"Relation extraction error: {e}")
            return []

    def _parse_response(
        self, response: Dict[str, Any], content: "EnrichmentContent"
    ) -> List[ExtractedRelation]:
        relations: List[ExtractedRelation] = []
        raw_relations = (response or {}).get("relations") or []

        for raw in raw_relations:
            try:
                source = str(raw.get("source", "")).strip()
                target = str(raw.get("target", "")).strip()
                if not source or not target or source.lower() == target.lower():
                    continue  # need two distinct endpoints

                rel_type = str(raw.get("relation_type", "")).strip().upper()
                if rel_type not in ALLOWED_RELATION_TYPES:
                    rel_type = _DEFAULT_RELATION_TYPE

                confidence = raw.get("confidence", 1.0)
                try:
                    confidence = float(confidence)
                except (TypeError, ValueError):
                    confidence = 1.0
                confidence = max(0.0, min(1.0, confidence))

                relations.append(
                    ExtractedRelation(
                        source=source,
                        target=target,
                        relation_type=rel_type,
                        descrizione=str(raw.get("descrizione", "")).strip(),
                        confidence=confidence,
                        raw_context=content.text[:500],
                    )
                )
            except Exception as e:
                logger.warning(f"Errore parsing relazione: {e}")
                continue

        return relations
