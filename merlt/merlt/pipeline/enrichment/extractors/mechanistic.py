"""
Mechanistic Extractor
=====================

Estrae entità e relazioni SENZA LLM, usando parsing deterministico
di dati strutturati da Brocardi.

Vantaggi:
- Zero costi API
- Velocità istantanea
- 100% riproducibile
- Qualità garantita (dati strutturati)

Entità estratte:
- SENTENZA: Da massime giurisprudenziali strutturate
- BROCARDO: Massime latine
- FONTE_STORICA: Relazioni del Guardasigilli

Relazioni estratte:
- INTERPRETA: Sentenza → Articolo
- APPLICA: Brocardo → Articolo
- CITA: Articolo → Articolo (cross-references)
"""

import re
import structlog
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from merlt.pipeline.enrichment.models import (
    EnrichmentContent,
    ExtractedEntity,
    ExtractedRelation,
    EntityType,
    RelationType,
)

log = structlog.get_logger()


# Regex per riferimenti ad altri articoli nel testo
ARTICLE_REF_PATTERNS = [
    # "Art. 1337 c.c.", "art. 2043 cod. civ."
    r'[Aa]rt\.?\s*(\d+(?:\s*-?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies))?)\s*(?:c\.c\.|cod\.?\s*civ\.)',
    # "Art. 52 c.p.", "art. 575 cod. pen."
    r'[Aa]rt\.?\s*(\d+(?:\s*-?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies))?)\s*(?:c\.p\.|cod\.?\s*pen\.)',
    # "Art. 1 Cost.", "art. 3 Costituzione"
    r'[Aa]rt\.?\s*(\d+(?:\s*-?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies))?)\s*(?:Cost\.|Costituzione)',
    # "artt. 1337 e 1338 c.c." - plurale
    r'[Aa]rtt\.?\s*(\d+)\s*e\s*(\d+)\s*(?:c\.c\.|c\.p\.|Cost\.)',
]


@dataclass
class MechanisticExtractionResult:
    """Risultato estrazione meccanicistica."""
    entities: List[ExtractedEntity]
    relations: List[ExtractedRelation]
    source: str  # "brocardi_massime", "brocardi_brocardo", etc.


class MechanisticExtractor:
    """
    Estrattore deterministico per dati strutturati Brocardi.

    Non usa LLM - parsing puro basato su struttura dati.

    Example:
        >>> extractor = MechanisticExtractor()
        >>> result = extractor.extract_from_brocardi_info(brocardi_info, article_urn)
        >>> print(f"Estratte {len(result.entities)} entità meccanicamente")
    """

    def extract_all(
        self,
        brocardi_info: Dict[str, Any],
        article_urn: str,
        article_text: str = "",
    ) -> MechanisticExtractionResult:
        """
        Estrae tutte le entità e relazioni meccanicistiche.

        Args:
            brocardi_info: Dict con Massime, Brocardi, Relazioni, etc.
            article_urn: URN dell'articolo corrente
            article_text: Testo dell'articolo (per cross-references)

        Returns:
            MechanisticExtractionResult con entities e relations
        """
        all_entities: List[ExtractedEntity] = []
        all_relations: List[ExtractedRelation] = []

        # 1. Estrai SENTENZE da Massime
        if brocardi_info.get("Massime"):
            sentenze, interp_rels = self._extract_sentenze(
                brocardi_info["Massime"],
                article_urn,
            )
            all_entities.extend(sentenze)
            all_relations.extend(interp_rels)

        # 2. Estrai BROCARDO da brocardi latini
        if brocardi_info.get("Brocardi"):
            brocardi_data = brocardi_info["Brocardi"]
            # Può essere lista di stringhe o singola stringa
            if isinstance(brocardi_data, list):
                brocardi_text = "\n".join(str(b) for b in brocardi_data)
            else:
                brocardi_text = str(brocardi_data)

            brocardi, applica_rels = self._extract_brocardi(
                brocardi_text,
                article_urn,
            )
            all_entities.extend(brocardi)
            all_relations.extend(applica_rels)

        # 3. Estrai cross-references dal testo
        if article_text:
            riferisce_rels = self._extract_article_references(
                article_text,
                article_urn,
            )
            all_relations.extend(riferisce_rels)

        # 4. Estrai riferimenti dalle spiegazioni Brocardi
        for field in ["Spiegazione", "Ratio"]:
            field_data = brocardi_info.get(field)
            if field_data:
                # Può essere lista o stringa
                if isinstance(field_data, list):
                    text = "\n".join(str(item) for item in field_data)
                else:
                    text = str(field_data)

                refs = self._extract_article_references(
                    text,
                    article_urn,
                )
                all_relations.extend(refs)

        log.info(
            f"Mechanistic extraction: {len(all_entities)} entities, {len(all_relations)} relations",
            entities=len(all_entities),
            relations=len(all_relations),
        )

        return MechanisticExtractionResult(
            entities=all_entities,
            relations=all_relations,
            source="mechanistic",
        )

    def _extract_sentenze(
        self,
        massime: List[Dict[str, Any]],
        article_urn: str,
    ) -> Tuple[List[ExtractedEntity], List[ExtractedRelation]]:
        """
        Estrae entità SENTENZA da massime strutturate.

        Ogni massima diventa:
        - 1 entità SENTENZA
        - 1 relazione INTERPRETA verso l'articolo
        """
        entities = []
        relations = []

        for massima in massime:
            autorita = massima.get("autorita", "")
            numero = massima.get("numero", "")
            anno = massima.get("anno", "")
            testo = massima.get("massima", "")

            if not (autorita and numero and anno):
                continue

            # Genera ID univoco per sentenza
            sentenza_id = f"sentenza:{autorita.lower().replace(' ', '_').replace('.', '')}:{numero}:{anno}"

            # Crea entità ATTO_GIUDIZIARIO per le massime/sentenze
            entity = ExtractedEntity(
                nome=f"{autorita} n. {numero}/{anno}",
                tipo=EntityType.ATTO_GIUDIZIARIO,
                descrizione=testo[:500] if testo else "",
                articoli_correlati=[article_urn],
                ambito="giurisprudenza",
                fonte="brocardi_massime",
                confidence=1.0,  # Meccanicistico = 100% confidence
                raw_context=testo,
            )
            entities.append(entity)

            # Crea relazione INTERPRETA
            relation = ExtractedRelation(
                source_id=sentenza_id,
                target_id=article_urn,
                relation_type=RelationType.INTERPRETA,
                fonte="brocardi_massime",
                confidence=1.0,
            )
            relations.append(relation)

        return entities, relations

    def _extract_brocardi(
        self,
        brocardi_text: str,
        article_urn: str,
    ) -> Tuple[List[ExtractedEntity], List[ExtractedRelation]]:
        """
        Estrae entità BROCARDO da testo massime latine.

        Brocardi sono tipicamente frasi latine come:
        - "Pacta sunt servanda"
        - "Nemo plus iuris transferre potest quam ipse habet"
        """
        entities = []
        relations = []

        if not brocardi_text:
            return entities, relations

        # Brocardi sono spesso separati da newline o ";"
        # Estraiamo frasi che sembrano latine (contengono parole latine comuni)
        latin_indicators = [
            'sunt', 'est', 'non', 'nemo', 'omnia', 'lex', 'iuris', 'nulla',
            'quod', 'qui', 'quae', 'cum', 'sine', 'ubi', 'res', 'actio',
        ]

        # Split per linee o punto e virgola
        candidates = re.split(r'[;\n]', brocardi_text)

        for candidate in candidates:
            candidate = candidate.strip()
            if not candidate or len(candidate) < 10:
                continue

            # Check se contiene indicatori latini
            candidate_lower = candidate.lower()
            is_latin = any(ind in candidate_lower for ind in latin_indicators)

            if is_latin:
                brocardo_id = f"brocardo:{uuid4().hex[:8]}"

                entity = ExtractedEntity(
                    nome=candidate[:100],  # Troncato se troppo lungo
                    tipo=EntityType.BROCARDO,
                    descrizione=f"Brocardo latino applicato all'articolo",
                    articoli_correlati=[article_urn],
                    ambito="principi_generali",
                    fonte="brocardi",
                    confidence=1.0,
                    raw_context=brocardi_text[:200],
                )
                entities.append(entity)

                # Relazione APPLICA: Brocardo → Articolo
                relation = ExtractedRelation(
                    source_id=brocardo_id,
                    target_id=article_urn,
                    relation_type=RelationType.APPLICA,
                    fonte="brocardi",
                    confidence=1.0,
                )
                relations.append(relation)

        return entities, relations

    def _extract_article_references(
        self,
        text: str,
        source_article_urn: str,
    ) -> List[ExtractedRelation]:
        """
        Estrae riferimenti ad altri articoli dal testo.

        Pattern riconosciuti:
        - "Art. 1337 c.c."
        - "cfr. Art. 2043 cod. civ."
        - "artt. 1337 e 1338 c.c."
        """
        relations = []
        found_refs = set()  # Evita duplicati

        for pattern in ARTICLE_REF_PATTERNS:
            for match in re.finditer(pattern, text):
                # Estrai numeri articoli
                for group in match.groups():
                    if group and group not in found_refs:
                        found_refs.add(group)

                        # Determina tipo atto dal pattern
                        full_match = match.group(0).lower()
                        if 'c.c.' in full_match or 'cod. civ.' in full_match:
                            tipo_atto = "codice_civile"
                        elif 'c.p.' in full_match or 'cod. pen.' in full_match:
                            tipo_atto = "codice_penale"
                        elif 'cost' in full_match:
                            tipo_atto = "costituzione"
                        else:
                            tipo_atto = "sconosciuto"

                        # Costruisci URN target (semplificato)
                        target_urn = f"{tipo_atto}~art{group}"

                        # Crea relazione CITA solo se diverso dall'articolo corrente
                        if target_urn not in source_article_urn:
                            relation = ExtractedRelation(
                                source_id=source_article_urn,
                                target_id=target_urn,
                                relation_type=RelationType.CITA,
                                fonte="text_extraction",
                                confidence=0.95,  # Alta ma non 1.0 (potrebbe essere citazione generica)
                            )
                            relations.append(relation)

        return relations


# Factory function per uso in pipeline
def create_mechanistic_extractor() -> MechanisticExtractor:
    """Crea estrattore meccanicistico."""
    return MechanisticExtractor()


__all__ = [
    "MechanisticExtractor",
    "MechanisticExtractionResult",
    "create_mechanistic_extractor",
]
