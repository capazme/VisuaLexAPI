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


def _ref_from_fields(act_type, article, act_number=None, date=None, urn=None, fallback_display=None):
    """Build one structured legal reference with a display tuned for the live
    citation tools (verified live): codici -> "art. 1453 codice civile";
    numbered acts -> "art. 5 legge 241/1990" (cite_law fails on numbered acts but
    fetch_law_article resolves them from the structured fields). None if unusable."""
    if not act_type and not article:
        return None
    if article and act_type:
        display = f"art. {article} {act_type}"
        if act_number:
            display += f" {act_number}"
            year = (date or "").split("-")[0] if date else ""
            if year:
                display += f"/{year}"
    else:
        display = fallback_display or act_type or article
    return {"display": display, "urn": urn, "act_type": act_type,
            "article": article, "act_number": act_number, "date": date}


def build_legal_references(parse_result):
    """Loop b #2 - map a VisuaLex /parse_query payload (single recognized ref +
    canonical URN) to a structured legal-reference list. Used together with
    legal_references_from_citations (see orchestrator)."""
    if not parse_result or not parse_result.get("recognized"):
        return []
    parsed = parse_result.get("parsed") or {}
    ref = _ref_from_fields(parsed.get("act_type"), parsed.get("article"),
                           act_number=parsed.get("act_number"), date=parsed.get("date"),
                           urn=parse_result.get("urn"), fallback_display=parse_result.get("display"))
    return [ref] if ref else []


def legal_references_from_citations(citations):
    """Map a VisuaLex /extract_citations payload (list of citation dicts) to the
    same structured shape. Citations carry no URN (grounding still works via
    fetch_law_article structured params). Order preserved."""
    if not citations:
        return []
    out = []
    for c in citations:
        if not isinstance(c, dict):
            continue
        ref = _ref_from_fields(c.get("act_type"), c.get("article"),
                               act_number=c.get("act_number"), date=c.get("date"),
                               urn=None, fallback_display=c.get("display_text"))
        if ref:
            out.append(ref)
    return out


def merge_legal_references(*lists):
    """Merge legal-reference lists, dedup by (act_type, article, act_number, date).
    First occurrence wins (pass parse_query refs first - they carry the URN);
    a later duplicate's URN back-fills a missing one."""
    by_key = {}
    order = []
    for lst in lists:
        for ref in lst or []:
            key = (ref.get("act_type"), ref.get("article"), ref.get("act_number"), ref.get("date"))
            if key not in by_key:
                by_key[key] = ref
                order.append(key)
            elif not by_key[key].get("urn") and ref.get("urn"):
                by_key[key]["urn"] = ref["urn"]
    return [by_key[k] for k in order]


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
