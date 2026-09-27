"""
Modello NER Giuridico basato su spaCy
======================================

Wrapper per il modello spaCy custom che riconosce citazioni giuridiche italiane.

Supporta:
- Estrazione entità da testo legale
- Risoluzione referenze ambigue usando contesto norma
- Graceful fallback se modello non disponibile
- Logging strutturato con structlog
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import structlog

logger = structlog.get_logger()

# Etichette NER per citazioni giuridiche
NER_LABELS = [
    "ARTICOLO",  # "art. 5", "articoli 3 e 4"
    "LEGGE",  # "legge 241/1990", "D.Lgs. 50/2016"
    "CODICE",  # "codice civile", "c.p."
    "COMMA",  # "comma 1", "co. 3"
    "LETTERA",  # "lettera a)", "lett. b"
    "RIFERIMENTO",  # Link completo articolo+fonte
]


@dataclass
class CitationMatch:
    """
    Una citazione giuridica estratta dal testo.

    Attributes:
        text: Testo della citazione
        label: Tipo entità (uno dei NER_LABELS)
        start: Indice inizio carattere
        end: Indice fine carattere
        confidence: Confidenza modello (0-1)
        resolved_urn: URN risolto (se disponibile)
        metadata: Metadati aggiuntivi (es. numero articolo, tipo atto)
    """

    text: str
    label: str
    start: int
    end: int
    confidence: float = 1.0
    resolved_urn: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __repr__(self) -> str:
        urn_str = f", urn={self.resolved_urn}" if self.resolved_urn else ""
        return (
            f"CitationMatch('{self.text}', {self.label}, "
            f"[{self.start}:{self.end}]{urn_str})"
        )


class LegalNERModel:
    """
    Modello NER per citazioni giuridiche italiane.

    Usa spaCy con modello custom trainato su corpus giuridico italiano.
    Fallback graceful su it_core_news_lg se modello custom non disponibile.

    Example:
        >>> model = LegalNERModel()
        >>> citations = model.extract_citations(
        ...     "L'art. 1453 del codice civile regola la risoluzione."
        ... )
        >>> print(citations[0].text)
        "art. 1453"
    """

    def __init__(self, model_path: Optional[str] = None):
        """
        Inizializza il modello NER.

        Args:
            model_path: Path al modello custom. Se None, cerca in models/legal_ner_latest.
                       Se non trovato, usa it_core_news_lg base.
        """
        self.model_path = model_path
        self.nlp = None
        self.is_custom_model = False

        self._load_model()

    def _load_model(self) -> None:
        """
        Carica il modello spaCy.

        Priority:
        1. model_path specificato dall'utente
        2. models/legal_ner_latest (ultimo modello trainato)
        3. it_core_news_lg (base model)
        """
        try:
            import spacy
            from spacy.language import Language
        except ImportError as e:
            logger.error("spacy_not_installed", error=str(e))
            raise ImportError(
                "spaCy non installato. Esegui: pip install spacy>=3.5"
            ) from e

        # Prova a caricare modello custom
        model_loaded = False

        if self.model_path:
            # Path specificato dall'utente
            if Path(self.model_path).exists():
                try:
                    self.nlp = spacy.load(self.model_path)
                    self.is_custom_model = True
                    model_loaded = True
                    logger.info("custom_model_loaded", path=self.model_path)
                except Exception as e:
                    logger.warning(
                        "failed_to_load_custom_model",
                        path=self.model_path,
                        error=str(e),
                    )
        else:
            # Cerca modello latest
            latest_path = Path("models/legal_ner_latest")
            if latest_path.exists():
                try:
                    self.nlp = spacy.load(str(latest_path))
                    self.is_custom_model = True
                    model_loaded = True
                    logger.info("latest_model_loaded", path=str(latest_path))
                except Exception as e:
                    logger.warning(
                        "failed_to_load_latest_model",
                        path=str(latest_path),
                        error=str(e),
                    )

        # Fallback su base model
        if not model_loaded:
            try:
                self.nlp = spacy.load("it_core_news_lg")
                logger.info("base_model_loaded", model="it_core_news_lg")
            except OSError as e:
                logger.error("base_model_not_found", error=str(e))
                raise RuntimeError(
                    "Modello base it_core_news_lg non trovato. "
                    "Esegui: python -m spacy download it_core_news_lg"
                ) from e

        logger.info(
            "ner_model_initialized",
            custom=self.is_custom_model,
            labels=self.nlp.get_pipe("ner").labels if self.nlp else [],
        )

    def extract_citations(
        self, text: str, context_norma: Optional[Dict[str, Any]] = None
    ) -> List[CitationMatch]:
        """
        Estrae citazioni giuridiche dal testo.

        Args:
            text: Testo da analizzare
            context_norma: Contesto norma corrente (per risolvere riferimenti ambigui).
                          Esempio: {"tipo_atto": "codice civile", "estremi": "..."}

        Returns:
            Lista di CitationMatch estratti

        Example:
            >>> model = LegalNERModel()
            >>> text = "Art. 1453 e 1454 del codice civile"
            >>> citations = model.extract_citations(text)
            >>> len(citations)
            3
        """
        if not self.nlp:
            logger.error("model_not_loaded")
            return []

        doc = self.nlp(text)
        citations: List[CitationMatch] = []

        for ent in doc.ents:
            # Filtra solo label NER giuridici
            if ent.label_ in NER_LABELS:
                citation = CitationMatch(
                    text=ent.text,
                    label=ent.label_,
                    start=ent.start_char,
                    end=ent.end_char,
                    confidence=1.0,  # spaCy non restituisce confidence per default
                )
                citations.append(citation)

        # Risolvi riferimenti usando contesto
        if context_norma:
            citations = self._resolve_references(citations, text, context_norma)

        logger.debug("citations_extracted", count=len(citations), text_length=len(text))
        return citations

    def _resolve_references(
        self,
        citations: List[CitationMatch],
        full_text: str,
        context_norma: Dict[str, Any],
    ) -> List[CitationMatch]:
        """
        Risolve citazioni ambigue usando contesto norma.

        Esempi:
        - "art. 52" → cerca tipo atto nel contesto (es. codice penale)
        - "comma 3" → collega all'articolo menzionato precedentemente
        - "lett. a)" → collega al comma menzionato precedentemente

        Args:
            citations: Citazioni estratte
            full_text: Testo completo per cercare contesto
            context_norma: Contesto norma corrente

        Returns:
            Citazioni con URN risolti quando possibile
        """
        tipo_atto = context_norma.get("tipo_atto", "")
        estremi = context_norma.get("estremi", "")

        # Estrai tipo atto da estremi se presente
        # Es. "Codice civile - Regio Decreto 16 marzo 1942, n. 262"
        if not tipo_atto and estremi:
            tipo_atto = self._extract_act_type_from_estremi(estremi)

        for citation in citations:
            if citation.label == "ARTICOLO":
                # Estrai numero articolo
                numero_art = self._extract_article_number(citation.text)
                if numero_art and tipo_atto:
                    citation.metadata["numero_articolo"] = numero_art
                    citation.metadata["tipo_atto"] = tipo_atto
                    # TODO: generare URN usando merlt.sources.utils.urn.generate_urn
                    # citation.resolved_urn = generate_urn(tipo_atto, numero_art)

            elif citation.label == "LEGGE":
                # Estrai anno e numero
                match = re.search(r"(\d+)/(\d{4})", citation.text)
                if match:
                    numero, anno = match.groups()
                    citation.metadata["numero_legge"] = numero
                    citation.metadata["anno"] = anno

            elif citation.label == "CODICE":
                # Normalizza codice
                citation.metadata["tipo_atto"] = self._normalize_codice(citation.text)

        return citations

    def _extract_act_type_from_estremi(self, estremi: str) -> str:
        """
        Estrae tipo atto da estremi norma.

        Args:
            estremi: Es. "Codice civile - Regio Decreto 16 marzo 1942, n. 262"

        Returns:
            Tipo atto normalizzato (es. "codice civile")
        """
        estremi_lower = estremi.lower()
        if "codice civile" in estremi_lower:
            return "codice civile"
        elif "codice penale" in estremi_lower:
            return "codice penale"
        elif "costituzione" in estremi_lower:
            return "costituzione"
        # Aggiungi altri pattern...
        return ""

    def _extract_article_number(self, text: str) -> str:
        """
        Estrae numero articolo da testo.

        Args:
            text: Es. "art. 1453", "articolo 52-bis"

        Returns:
            Numero articolo (es. "1453", "52-bis")
        """
        # Pattern per articoli
        match = re.search(
            r"art(?:icolo)?\.?\s+(\d+(?:-bis|-ter|-quater)?)",
            text,
            re.IGNORECASE,
        )
        if match:
            return match.group(1)
        return ""

    def _normalize_codice(self, text: str) -> str:
        """
        Normalizza nome codice.

        Args:
            text: Es. "c.c.", "cod. civ.", "codice civile"

        Returns:
            Nome normalizzato (es. "codice civile")
        """
        text_lower = text.lower()
        if "c.c." in text_lower or "cod. civ" in text_lower or "civile" in text_lower:
            return "codice civile"
        elif "c.p." in text_lower or "pen" in text_lower:
            return "codice penale"
        return text_lower

    def is_ready(self) -> bool:
        """
        Verifica se il modello è pronto per essere usato.

        Returns:
            True se modello caricato correttamente
        """
        return self.nlp is not None
