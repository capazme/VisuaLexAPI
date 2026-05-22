"""
Proposition-based Chunking
==========================

Estrae proposizioni giuridiche atomiche da testi legali usando LLM.

Una proposizione giuridica e' un'unita' semantica autonoma che esprime:
- Un singolo fatto giuridico
- Una singola regola o principio
- Una singola definizione
- Una singola condizione o requisito

Vantaggi per RAG legale:
- +25% recall rispetto a chunking tradizionale
- Massima densita' informativa per chunk
- Retrieval preciso di singole regole

Reference:
- Dense X Retrieval (Chen et al., 2023)
- Propositionizer (Flan-T5 fine-tuned)

Esempio:
    chunker = PropositionChunker(llm_service)
    propositions = await chunker.extract(comma_text, article_context)
"""

import logging
import json
import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from uuid import uuid4, UUID
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class LegalProposition:
    """
    Proposizione giuridica atomica estratta da un testo legale.

    Attributes:
        id: UUID univoco
        text: Testo della proposizione (autonomo, comprensibile isolato)
        proposition_type: Tipo (regola, definizione, condizione, effetto, eccezione)
        source_comma: Numero del comma di origine
        source_urn: URN del comma di origine
        confidence: Score di confidenza LLM [0-1]
        entities: Entita' giuridiche menzionate
        relations: Relazioni con altre proposizioni
    """
    id: UUID
    text: str
    proposition_type: str
    source_comma: int
    source_urn: str
    confidence: float = 1.0
    entities: List[str] = field(default_factory=list)
    relations: List[Dict[str, str]] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Serializza per storage."""
        return {
            "id": str(self.id),
            "text": self.text,
            "proposition_type": self.proposition_type,
            "source_comma": self.source_comma,
            "source_urn": self.source_urn,
            "confidence": self.confidence,
            "entities": self.entities,
            "relations": self.relations,
            "created_at": self.created_at.isoformat(),
        }


# Prompt per estrazione proposizioni (esternalizzabile in YAML)
PROPOSITION_EXTRACTION_PROMPT = """Sei un esperto di diritto italiano. Estrai le proposizioni giuridiche atomiche dal seguente testo legale.

DEFINIZIONE DI PROPOSIZIONE GIURIDICA:
Una proposizione giuridica e' un'affermazione autonoma e completa che esprime UN SOLO concetto giuridico. Deve essere comprensibile isolatamente, senza bisogno del contesto originale.

TIPI DI PROPOSIZIONI:
- regola: Norma che prescrive un comportamento o stabilisce un effetto
- definizione: Definisce un concetto o istituto giuridico
- condizione: Requisito o presupposto per l'applicazione di una regola
- effetto: Conseguenza giuridica di un fatto o atto
- eccezione: Deroga a una regola generale
- procedura: Modalita' o termine per compiere un atto

REGOLE DI ESTRAZIONE:
1. Ogni proposizione deve essere AUTONOMA (comprensibile da sola)
2. Sostituisci pronomi e riferimenti con i termini espliciti
3. Includi il soggetto della norma se implicito
4. Separa condizioni ed effetti in proposizioni distinte
5. Mantieni la terminologia giuridica originale

CONTESTO ARTICOLO:
{article_context}

TESTO DA ANALIZZARE (Comma {comma_number}):
{text}

Rispondi SOLO con un array JSON di proposizioni. Formato:
[
  {{
    "text": "proposizione completa e autonoma",
    "type": "regola|definizione|condizione|effetto|eccezione|procedura",
    "entities": ["entita1", "entita2"],
    "confidence": 0.95
  }}
]

Se il testo contiene una sola proposizione, restituisci un array con un elemento.
Se il testo e' troppo breve o non contiene proposizioni giuridiche, restituisci [].
"""


class PropositionChunker:
    """
    Chunker che estrae proposizioni giuridiche atomiche usando LLM.

    Utilizza un modello LLM per identificare e isolare le singole
    unita' semantiche all'interno di un testo legale, producendo
    chunk ad alta densita' informativa per RAG.

    Attributes:
        llm: Servizio LLM per estrazione
        max_propositions_per_comma: Limite proposizioni per comma
        min_confidence: Soglia minima di confidenza

    Example:
        >>> chunker = PropositionChunker(llm_service)
        >>> props = await chunker.extract(
        ...     text="Il debitore che non esegue...",
        ...     comma_number=1,
        ...     source_urn="urn:...~art1218-com1",
        ...     article_context="Art. 1218 - Responsabilita' del debitore"
        ... )
    """

    def __init__(
        self,
        llm_service,
        max_propositions_per_comma: int = 10,
        min_confidence: float = 0.7,
    ):
        """
        Inizializza il chunker.

        Args:
            llm_service: Servizio LLM (OpenRouterService o compatibile)
            max_propositions_per_comma: Limite proposizioni per comma
            min_confidence: Soglia minima confidenza per accettare proposizione
        """
        self.llm = llm_service
        self.max_propositions = max_propositions_per_comma
        self.min_confidence = min_confidence

    async def extract(
        self,
        text: str,
        comma_number: int,
        source_urn: str,
        article_context: str = "",
    ) -> List[LegalProposition]:
        """
        Estrae proposizioni giuridiche atomiche da un comma.

        Args:
            text: Testo del comma da analizzare
            comma_number: Numero del comma nell'articolo
            source_urn: URN completo del comma (es. ~art1218-com1)
            article_context: Contesto articolo (rubrica, numero)

        Returns:
            Lista di LegalProposition estratte
        """
        if not text or len(text.strip()) < 20:
            logger.debug(f"Testo troppo breve per estrazione: {len(text)} chars")
            return []

        # Prepara prompt
        prompt = PROPOSITION_EXTRACTION_PROMPT.format(
            article_context=article_context or "Non disponibile",
            comma_number=comma_number,
            text=text,
        )

        try:
            # Chiama LLM
            response = await self.llm.generate(
                prompt=prompt,
                temperature=0.1,  # Bassa per output deterministico
                max_tokens=2000,
            )

            # Parse JSON response
            propositions = self._parse_response(response, comma_number, source_urn)

            logger.info(
                f"Estratte {len(propositions)} proposizioni da comma {comma_number}"
            )
            return propositions

        except Exception as e:
            logger.error(f"Errore estrazione proposizioni: {e}")
            # Fallback: restituisci il testo originale come singola proposizione
            return [self._fallback_proposition(text, comma_number, source_urn)]

    async def extract_from_article(
        self,
        commas: List[Dict[str, Any]],
        article_urn: str,
        article_context: str = "",
    ) -> List[LegalProposition]:
        """
        Estrae proposizioni da tutti i commi di un articolo.

        Args:
            commas: Lista di dict con 'numero' e 'testo'
            article_urn: URN base dell'articolo
            article_context: Contesto (rubrica, posizione)

        Returns:
            Lista aggregata di proposizioni
        """
        all_propositions = []

        for comma in commas:
            comma_urn = f"{article_urn}-com{comma['numero']}"
            props = await self.extract(
                text=comma["testo"],
                comma_number=comma["numero"],
                source_urn=comma_urn,
                article_context=article_context,
            )
            all_propositions.extend(props)

        return all_propositions

    def _parse_response(
        self,
        response: str,
        comma_number: int,
        source_urn: str,
    ) -> List[LegalProposition]:
        """
        Parsa la risposta JSON del LLM.

        Args:
            response: Risposta raw del LLM
            comma_number: Numero comma di origine
            source_urn: URN comma di origine

        Returns:
            Lista di LegalProposition parsate
        """
        propositions = []

        # Estrai JSON dalla risposta (potrebbe avere testo extra)
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if not json_match:
            logger.warning("Nessun JSON trovato nella risposta LLM")
            return propositions

        try:
            data = json.loads(json_match.group())
        except json.JSONDecodeError as e:
            logger.error(f"Errore parsing JSON: {e}")
            return propositions

        for i, item in enumerate(data[:self.max_propositions]):
            # Valida confidenza
            confidence = item.get("confidence", 0.8)
            if confidence < self.min_confidence:
                continue

            # Crea proposizione
            prop = LegalProposition(
                id=uuid4(),
                text=item.get("text", "").strip(),
                proposition_type=item.get("type", "regola"),
                source_comma=comma_number,
                source_urn=source_urn,
                confidence=confidence,
                entities=item.get("entities", []),
            )

            if prop.text:  # Solo se ha testo
                propositions.append(prop)

        return propositions

    def _fallback_proposition(
        self,
        text: str,
        comma_number: int,
        source_urn: str,
    ) -> LegalProposition:
        """
        Crea proposizione fallback quando LLM fallisce.

        Usa il testo originale come singola proposizione.
        """
        return LegalProposition(
            id=uuid4(),
            text=text.strip(),
            proposition_type="regola",  # Default
            source_comma=comma_number,
            source_urn=source_urn,
            confidence=0.5,  # Bassa perche' non validata
            entities=[],
        )


# Exports
__all__ = [
    "PropositionChunker",
    "LegalProposition",
    "PROPOSITION_EXTRACTION_PROMPT",
]
