"""
Metriche oggettive calcolabili automaticamente senza LLM.

Queste metriche sono deterministiche e verificabili:
- Source Grounding (SG): % fonti citate verificate nel database
- Hallucination Rate (HR): % fonti inventate
- Citation Accuracy: Correttezza formale delle citazioni
- Coverage Score: Copertura rispetto al gold standard
- Token Efficiency: Rapporto informazione/token

Tutte le metriche sono calcolate confrontando la risposta dell'expert
con il database di conoscenza (FalkorDB + Qdrant).
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Set
from datetime import datetime


@dataclass
class ObjectiveMetrics:
    """
    Contenitore per le metriche oggettive calcolate.

    Attributes:
        source_grounding: Percentuale fonti verificate (0.0-1.0)
        hallucination_rate: Percentuale fonti inventate (0.0-1.0)
        citation_accuracy: Correttezza formale citazioni (0.0-1.0)
        coverage_score: Copertura gold standard (0.0-1.0)
        response_latency_ms: Tempo di risposta in ms
        token_efficiency: Informazione per token (0.0-1.0)
        sources_cited: Numero totale fonti citate
        sources_verified: Numero fonti verificate nel DB
        sources_hallucinated: Numero fonti inventate
        calculated_at: Timestamp calcolo
    """

    source_grounding: float
    hallucination_rate: float
    citation_accuracy: float
    coverage_score: float
    response_latency_ms: float
    token_efficiency: float
    sources_cited: int = 0
    sources_verified: int = 0
    sources_hallucinated: int = 0
    gold_urns_found: List[str] = field(default_factory=list)
    gold_urns_missed: List[str] = field(default_factory=list)
    calculated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    @property
    def combined_score(self) -> float:
        """
        Punteggio combinato pesato.

        Formula: 0.4*SG + 0.3*(1-HR) + 0.2*CA + 0.1*COV
        """
        return (
            0.4 * self.source_grounding +
            0.3 * (1 - self.hallucination_rate) +
            0.2 * self.citation_accuracy +
            0.1 * self.coverage_score
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serializza le metriche in dizionario."""
        return {
            "source_grounding": self.source_grounding,
            "hallucination_rate": self.hallucination_rate,
            "citation_accuracy": self.citation_accuracy,
            "coverage_score": self.coverage_score,
            "response_latency_ms": self.response_latency_ms,
            "token_efficiency": self.token_efficiency,
            "sources_cited": self.sources_cited,
            "sources_verified": self.sources_verified,
            "sources_hallucinated": self.sources_hallucinated,
            "combined_score": self.combined_score,
            "calculated_at": self.calculated_at,
        }


class ObjectiveEvaluator:
    """
    Valutatore per metriche oggettive calcolabili automaticamente.

    Le metriche sono calcolate confrontando la risposta dell'expert
    con il contenuto del knowledge graph.

    Attributes:
        valid_urns: Set di URN validi presenti nel database
        libro_iv_range: Range articoli Libro IV (1173-2059)
    """

    # Range articoli Libro IV del Codice Civile
    LIBRO_IV_START = 1173
    LIBRO_IV_END = 2059

    # Pattern per estrarre citazioni di articoli
    ARTICLE_PATTERNS = [
        r"[Aa]rt(?:icolo)?\.?\s*(\d+)",                    # Art. 1453, articolo 1453
        r"[Aa]rtt?\.\s*(\d+)(?:\s*[-–]\s*(\d+))?",        # Artt. 1453-1460
        r"(\d+)\s*(?:c\.c\.|cod\.\s*civ\.)",              # 1453 c.c.
        r"[Aa]rticol[oi]\s+(\d+)",                         # articoli 1453
    ]

    def __init__(
        self,
        valid_urns: Optional[Set[str]] = None,
        libro_iv_only: bool = True
    ):
        """
        Inizializza l'evaluator.

        Args:
            valid_urns: Set di URN validi (se None, usa range Libro IV)
            libro_iv_only: Se True, considera validi solo art. 1173-2059
        """
        self.valid_urns = valid_urns or set()
        self.libro_iv_only = libro_iv_only

        # Se non forniti URN specifici, genera quelli del Libro IV
        if not self.valid_urns and libro_iv_only:
            self.valid_urns = self._generate_libro_iv_urns()

    def _generate_libro_iv_urns(self) -> Set[str]:
        """Genera URN per tutti gli articoli del Libro IV."""
        urns = set()
        for art_num in range(self.LIBRO_IV_START, self.LIBRO_IV_END + 1):
            # Formato URN standard Normattiva
            urn = f"urn:nir:stato:codice.civile:1942-03-16;262~art{art_num}"
            urns.add(urn)
            # Aggiungi anche formati alternativi
            urns.add(f"art_{art_num}")
            urns.add(f"Art. {art_num}")
            urns.add(str(art_num))
        return urns

    def evaluate(
        self,
        response: Any,  # ExpertResponse
        context: Dict[str, Any]
    ) -> ObjectiveMetrics:
        """
        Valuta una risposta expert calcolando metriche oggettive.

        Args:
            response: Risposta dell'expert (ExpertResponse)
            context: Contesto con chiavi:
                - valid_urns: URN validi nel DB (opzionale)
                - gold_urns: URN attesi per questa query (opzionale)
                - retrieved_chunks: Chunk recuperati (opzionale)

        Returns:
            ObjectiveMetrics con tutte le metriche calcolate
        """
        # Estrai URN citati dalla risposta
        cited_urns = self._extract_cited_urns(response)

        # URN validi per questa valutazione
        valid_urns = set(context.get("valid_urns", [])) or self.valid_urns

        # Calcola Source Grounding e Hallucination Rate
        sg, hr, verified, hallucinated = self._compute_grounding_metrics(
            cited_urns, valid_urns
        )

        # Calcola Citation Accuracy (formato corretto)
        citation_accuracy = self._compute_citation_accuracy(response)

        # Calcola Coverage rispetto al gold standard
        gold_urns = set(context.get("gold_urns", []))
        coverage, found, missed = self._compute_coverage(cited_urns, gold_urns)

        # Calcola Token Efficiency
        token_efficiency = self._compute_token_efficiency(response)

        # Latenza (già disponibile in response)
        latency = getattr(response, "execution_time_ms", 0.0)

        return ObjectiveMetrics(
            source_grounding=sg,
            hallucination_rate=hr,
            citation_accuracy=citation_accuracy,
            coverage_score=coverage,
            response_latency_ms=latency,
            token_efficiency=token_efficiency,
            sources_cited=len(cited_urns),
            sources_verified=verified,
            sources_hallucinated=hallucinated,
            gold_urns_found=list(found),
            gold_urns_missed=list(missed),
        )

    def _extract_cited_urns(self, response: Any) -> Set[str]:
        """
        Estrae tutti gli URN citati dalla risposta.

        Cerca in:
        - legal_basis (lista di LegalSource)
        - interpretation (testo libero)
        """
        cited = set()

        # Da legal_basis strutturato
        if hasattr(response, "legal_basis"):
            for source in response.legal_basis:
                if hasattr(source, "source_id") and source.source_id:
                    cited.add(source.source_id)
                if hasattr(source, "urn") and source.urn:
                    cited.add(source.urn)

        # Da testo interpretation
        if hasattr(response, "interpretation"):
            text_citations = self._extract_articles_from_text(response.interpretation)
            cited.update(text_citations)

        return cited

    def _extract_articles_from_text(self, text: str) -> Set[str]:
        """
        Estrae numeri di articolo dal testo usando regex.

        Returns:
            Set di identificatori articolo (es: "1453", "Art. 1453")
        """
        articles = set()

        for pattern in self.ARTICLE_PATTERNS:
            matches = re.finditer(pattern, text)
            for match in matches:
                art_num = match.group(1)
                if art_num:
                    articles.add(art_num)
                    articles.add(f"Art. {art_num}")
                    # Range
                    if match.lastindex and match.lastindex >= 2 and match.group(2):
                        end_num = match.group(2)
                        articles.add(end_num)
                        articles.add(f"Art. {end_num}")

        return articles

    def _compute_grounding_metrics(
        self,
        cited: Set[str],
        valid: Set[str]
    ) -> tuple[float, float, int, int]:
        """
        Calcola Source Grounding e Hallucination Rate.

        Args:
            cited: URN/articoli citati
            valid: URN/articoli validi nel DB

        Returns:
            (source_grounding, hallucination_rate, verified_count, hallucinated_count)
        """
        if not cited:
            return 1.0, 0.0, 0, 0  # Nessuna citazione = nessuna allucinazione

        verified = 0
        hallucinated = 0

        for citation in cited:
            if self._is_citation_valid(citation, valid):
                verified += 1
            else:
                hallucinated += 1

        total = len(cited)
        sg = verified / total
        hr = hallucinated / total

        return sg, hr, verified, hallucinated

    def _is_citation_valid(self, citation: str, valid_urns: Set[str]) -> bool:
        """
        Verifica se una citazione è valida.

        Controlla:
        1. Match esatto in valid_urns
        2. Numero articolo nel range Libro IV
        """
        # Match esatto
        if citation in valid_urns:
            return True

        # Estrai numero e verifica range
        art_num = self._extract_article_number(citation)
        if art_num is not None:
            # Controlla se nel range Libro IV
            if self.libro_iv_only:
                return self.LIBRO_IV_START <= art_num <= self.LIBRO_IV_END
            # Oppure se in valid_urns come numero
            return str(art_num) in valid_urns or f"Art. {art_num}" in valid_urns

        return False

    def _extract_article_number(self, citation: str) -> Optional[int]:
        """Estrae il numero di articolo da una citazione."""
        # Prova a estrarre numero direttamente
        match = re.search(r"(\d+)", citation)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                pass
        return None

    def _compute_citation_accuracy(self, response: Any) -> float:
        """
        Valuta la correttezza formale delle citazioni.

        Controlla:
        - Formato URN valido
        - Citazioni nel testo con formato standard
        - Coerenza tra legal_basis e testo
        """
        scores = []

        # Valuta legal_basis
        if hasattr(response, "legal_basis"):
            for source in response.legal_basis:
                score = self._score_citation_format(source)
                scores.append(score)

        # Valuta citazioni nel testo
        if hasattr(response, "interpretation"):
            text_score = self._score_text_citations(response.interpretation)
            scores.append(text_score)

        return sum(scores) / len(scores) if scores else 0.5

    def _score_citation_format(self, source: Any) -> float:
        """Punteggio formato citazione singola."""
        score = 0.0

        # Ha source_id?
        if hasattr(source, "source_id") and source.source_id:
            score += 0.3

        # Ha testo?
        if hasattr(source, "text") and source.text and len(source.text) > 10:
            score += 0.3

        # Ha relevance?
        if hasattr(source, "relevance") and source.relevance:
            score += 0.2

        # Formato URN valido?
        if hasattr(source, "source_id"):
            if source.source_id and ("urn:" in source.source_id or re.match(r"^\d+$", source.source_id)):
                score += 0.2

        return min(score, 1.0)

    def _score_text_citations(self, text: str) -> float:
        """Punteggio citazioni nel testo."""
        if not text:
            return 0.5

        # Conta citazioni ben formattate
        well_formatted = len(re.findall(r"[Aa]rt\.\s*\d+\s*(?:c\.c\.|cod\.\s*civ\.)?", text))
        # Conta citazioni mal formattate
        poorly_formatted = len(re.findall(r"(?<!\d)\d{4}(?!\d)", text))  # Numeri isolati a 4 cifre

        if well_formatted + poorly_formatted == 0:
            return 0.5

        return well_formatted / (well_formatted + poorly_formatted)

    def _compute_coverage(
        self,
        cited: Set[str],
        gold: Set[str]
    ) -> tuple[float, Set[str], Set[str]]:
        """
        Calcola copertura rispetto al gold standard.

        Args:
            cited: URN citati nella risposta
            gold: URN attesi (ground truth)

        Returns:
            (coverage_score, found_urns, missed_urns)
        """
        if not gold:
            return 1.0, set(), set()  # Nessun gold = coverage perfetta

        # Normalizza per confronto
        cited_normalized = {self._normalize_citation(c) for c in cited}
        gold_normalized = {self._normalize_citation(g) for g in gold}

        found = cited_normalized & gold_normalized
        missed = gold_normalized - cited_normalized

        coverage = len(found) / len(gold_normalized)

        return coverage, found, missed

    def _normalize_citation(self, citation: str) -> str:
        """Normalizza citazione per confronto."""
        # Estrai solo il numero
        art_num = self._extract_article_number(citation)
        if art_num:
            return str(art_num)
        return citation.lower().strip()

    def _compute_token_efficiency(self, response: Any) -> float:
        """
        Calcola efficienza token (informazione per token).

        Metriche considerate:
        - Numero fonti / tokens
        - Lunghezza ragionamento / tokens
        - Densità informativa
        """
        tokens_used = getattr(response, "tokens_used", 0) or 1

        # Conta elementi informativi
        info_elements = 0

        # Fonti citate
        if hasattr(response, "legal_basis"):
            info_elements += len(response.legal_basis) * 10

        # Passi di ragionamento
        if hasattr(response, "reasoning_steps"):
            info_elements += len(response.reasoning_steps) * 5

        # Lunghezza interpretation (normalizzata)
        if hasattr(response, "interpretation"):
            info_elements += len(response.interpretation) // 100

        # Efficienza = info_elements / tokens (normalizzato)
        efficiency = min(info_elements / tokens_used, 1.0)

        return efficiency


def compute_objective_metrics_batch(
    responses: List[Any],
    contexts: List[Dict[str, Any]],
    evaluator: Optional[ObjectiveEvaluator] = None
) -> List[ObjectiveMetrics]:
    """
    Calcola metriche per un batch di risposte.

    Args:
        responses: Lista di ExpertResponse
        contexts: Lista di contesti (uno per risposta)
        evaluator: ObjectiveEvaluator (creato se None)

    Returns:
        Lista di ObjectiveMetrics
    """
    if evaluator is None:
        evaluator = ObjectiveEvaluator()

    if len(responses) != len(contexts):
        raise ValueError("responses e contexts devono avere la stessa lunghezza")

    return [
        evaluator.evaluate(resp, ctx)
        for resp, ctx in zip(responses, contexts)
    ]
