"""
Query Analyzer
==============

Analizza query giuridiche per estrarre:
- Riferimenti normativi (Art. 1453 c.c.)
- Concetti giuridici (risoluzione, inadempimento)
- Tipo di query (definitorio, interpretativo, applicativo)

Popola ExpertContext con informazioni per il routing e il retrieval.
"""

import re
import structlog
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass

log = structlog.get_logger()


@dataclass
class QueryAnalysis:
    """Risultato dell'analisi della query."""
    query_text: str
    norm_references: List[str]  # URN delle norme citate
    article_numbers: List[str]  # Numeri articoli citati
    legal_concepts: List[str]  # Concetti giuridici
    query_type: str  # definitorio, interpretativo, applicativo, procedurale
    confidence: float


# Pattern per estrarre riferimenti normativi
ARTICLE_PATTERNS = [
    # Art. 1453 c.c. / art. 1453 cod. civ.
    r"[Aa]rt(?:icolo|\.)\s*(\d+(?:\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)\s*(?:c\.c\.|cod\.?\s*civ\.?|codice\s*civile)",
    # Art. 1453 / artt. 1453-1460
    r"[Aa]rt(?:icolo|\.)\s*(\d+(?:\s*(?:bis|ter|quater|quinquies))?)",
    # articoli 1453 e 1454
    r"articol[io]\s+(\d+)",
]

# Pattern per concetti giuridici comuni
LEGAL_CONCEPTS = {
    # Libro IV - Obbligazioni
    "obbligazione": ["obbligazione", "obbligazioni", "debitore", "creditore"],
    "contratto": ["contratto", "contratti", "contraente", "contraenti", "contrattuale"],
    "inadempimento": ["inadempimento", "inadempiente", "inadempiere", "adempimento"],
    "risoluzione": ["risoluzione", "risolvere", "risolto", "risolutorio"],
    "recesso": ["recesso", "recedere", "recesso unilaterale"],
    "rescissione": ["rescissione", "rescindere", "rescindibile"],
    "nullità": ["nullità", "nullo", "nulla", "annullamento", "annullabile"],
    "responsabilità": ["responsabilità", "responsabile", "danno", "danni", "risarcimento"],
    "garanzia": ["garanzia", "garanzie", "fideiussione", "fideiussore"],
    "mora": ["mora", "costituzione in mora", "messa in mora"],
    "termine": ["termine", "termini", "scadenza", "prescrizione"],
    "forma": ["forma", "forma scritta", "atto pubblico", "scrittura privata"],
    "causa": ["causa", "causa del contratto", "illiceità"],
    "oggetto": ["oggetto", "oggetto del contratto", "prestazione"],
    "consenso": ["consenso", "volontà", "dichiarazione", "manifestazione"],
    "capacità": ["capacità", "incapacità", "capacità di agire"],
    "rappresentanza": ["rappresentanza", "rappresentante", "procura", "mandato"],
    "simulazione": ["simulazione", "simulato", "dissimulazione"],
    "errore": ["errore", "errore essenziale", "errore ostativo"],
    "dolo": ["dolo", "raggiro", "artificio"],
    "violenza": ["violenza", "minaccia", "coazione"],
    "condizione": ["condizione", "condizione sospensiva", "condizione risolutiva"],
    "cessione": ["cessione", "cedere", "cessionario", "cedente"],
    "compensazione": ["compensazione", "compensare", "crediti reciproci"],
    "novazione": ["novazione", "novare", "animus novandi"],
    "delegazione": ["delegazione", "delegante", "delegato", "delegatario"],
    "espromissione": ["espromissione", "espromittente"],
    "accollo": ["accollo", "accollante", "accollatario"],
    "surrogazione": ["surrogazione", "surroga"],
    "confusione": ["confusione", "consolidazione"],
    "remissione": ["remissione", "remissione del debito"],
    "impossibilità": ["impossibilità", "impossibilità sopravvenuta"],
    "caparra": ["caparra", "caparra confirmatoria", "caparra penitenziale"],
    "clausola penale": ["clausola penale", "penale"],
    "solidarietà": ["solidarietà", "solidale", "obbligazione solidale"],
    "divisibilità": ["divisibilità", "indivisibilità", "divisibile"],
    "interesse": ["interesse", "interessi", "interessi legali", "interessi moratori"],
    "pegno": ["pegno", "pegno irregolare"],
    "ipoteca": ["ipoteca", "iscrizione ipotecaria"],
    "privilegio": ["privilegio", "privilegio generale", "privilegio speciale"],
}

# Tipi di query
QUERY_TYPE_PATTERNS = {
    "definitorio": [
        r"cos[\'']?[eè]",
        r"che\s+cos[\'']?[eè]",
        r"cosa\s+(?:si\s+intende|significa)",
        r"defini(?:zione|sci|re)",
        r"nozione\s+di",
        r"qual[ie]\s+(?:sono|è)\s+(?:la\s+)?(?:definizione|nozione)",
    ],
    "interpretativo": [
        r"come\s+(?:si\s+)?interpreta",
        r"significato",
        r"portata",
        r"ambito\s+di\s+applicazione",
        r"ratio",
        r"intenzione\s+del\s+legislatore",
        r"orientamento",
    ],
    "applicativo": [
        r"quando\s+(?:si\s+)?applica",
        r"in\s+(?:quali|che)\s+casi",
        r"requisiti",
        r"presupposti",
        r"condizioni",
        r"modalit[àa]",
        r"come\s+(?:si\s+)?esercita",
        r"procedura",
    ],
    "procedurale": [
        r"come\s+(?:si\s+)?fa",
        r"procedura",
        r"iter",
        r"adempimenti",
        r"termini\s+per",
        r"forma\s+(?:per|di)",
    ],
    "giurisprudenziale": [
        r"giurisprudenza",
        r"cassazione",
        r"orientamento\s+(?:della\s+)?(?:corte|cassazione)",
        r"sentenz[ae]",
        r"massim[ae]",
        r"precedent[ei]",
    ],
}


def extract_article_numbers(query: str) -> List[str]:
    """Estrae numeri di articolo dalla query."""
    articles = []
    for pattern in ARTICLE_PATTERNS:
        matches = re.findall(pattern, query, re.IGNORECASE)
        articles.extend(matches)
    # Rimuovi duplicati preservando ordine
    seen = set()
    unique = []
    for art in articles:
        art_clean = art.strip()
        if art_clean not in seen:
            seen.add(art_clean)
            unique.append(art_clean)
    return unique


def extract_legal_concepts(query: str) -> List[str]:
    """Estrae concetti giuridici dalla query."""
    query_lower = query.lower()
    found_concepts = []

    for concept, keywords in LEGAL_CONCEPTS.items():
        for keyword in keywords:
            if keyword.lower() in query_lower:
                if concept not in found_concepts:
                    found_concepts.append(concept)
                break

    return found_concepts


def determine_query_type(query: str) -> Tuple[str, float]:
    """Determina il tipo di query e la confidence."""
    query_lower = query.lower()
    scores = {}

    for query_type, patterns in QUERY_TYPE_PATTERNS.items():
        score = 0
        for pattern in patterns:
            if re.search(pattern, query_lower):
                score += 1
        if score > 0:
            scores[query_type] = score

    if not scores:
        return "interpretativo", 0.5  # Default

    best_type = max(scores, key=scores.get)
    max_score = scores[best_type]
    confidence = min(1.0, max_score / 2)  # 2+ matches = high confidence

    return best_type, confidence


def build_article_urn(article_number: str, code: str = "codice_civile") -> str:
    """Costruisce URN per un articolo del codice civile."""
    # Formato: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art{numero}
    art_num = article_number.replace(" ", "").replace("bis", "bis").replace("ter", "ter")
    return f"https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art{art_num}"


def analyze_query(query: str) -> QueryAnalysis:
    """
    Analizza una query giuridica.

    Args:
        query: Testo della query

    Returns:
        QueryAnalysis con riferimenti normativi, concetti, tipo query
    """
    # Estrai articoli
    article_numbers = extract_article_numbers(query)

    # Costruisci URN per gli articoli
    norm_references = [build_article_urn(art) for art in article_numbers]

    # Estrai concetti giuridici
    legal_concepts = extract_legal_concepts(query)

    # Determina tipo query
    query_type, confidence = determine_query_type(query)

    analysis = QueryAnalysis(
        query_text=query,
        norm_references=norm_references,
        article_numbers=article_numbers,
        legal_concepts=legal_concepts,
        query_type=query_type,
        confidence=confidence
    )

    log.info(
        "Query analyzed",
        articles=article_numbers,
        concepts=legal_concepts[:5],
        query_type=query_type,
        confidence=confidence
    )

    return analysis


def enrich_context(context: "ExpertContext", analysis: QueryAnalysis) -> "ExpertContext":
    """
    Arricchisce ExpertContext con risultati dell'analisi.

    Args:
        context: ExpertContext esistente
        analysis: Risultato analisi query

    Returns:
        ExpertContext arricchito
    """
    # Aggiorna context con riferimenti e concetti
    context.norm_references = analysis.norm_references
    context.legal_concepts = analysis.legal_concepts

    # Aggiungi metadata
    if not context.metadata:
        context.metadata = {}

    context.metadata["query_analysis"] = {
        "article_numbers": analysis.article_numbers,
        "query_type": analysis.query_type,
        "analysis_confidence": analysis.confidence
    }

    return context
