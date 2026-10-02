"""
External Source Tool - Recupero fonti esterne con strategia cascata.

Strategia:
1. Grafo locale (FalkorDB) - veloce, già indicizzato
2. Normattiva (NormattivaScraper) - norme italiane ufficiali
3. Brocardi (BrocardiScraper) - spiegazioni, massime, commenti

Esempio:
    >>> from merlt.tools import ExternalSourceTool
    >>>
    >>> tool = ExternalSourceTool(graph_db=falkordb)
    >>> result = await tool(
    ...     query="art. 1453 c.c.",
    ...     source_priority=["graph", "normattiva", "brocardi"]
    ... )
    >>> print(result.data["source"])  # "graph" o "normattiva" o "brocardi"
"""

import re
import structlog
from typing import Any, Dict, List, Optional

from merlt.storage.graph.schema import canonical_urn
from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType
from merlt.utils.urngenerator import generate_urn

log = structlog.get_logger()

_NORMATTIVA_PREFIX = "https://www.normattiva.it/uri-res/N2Ls?"
_ARTICLE = re.compile(
    r"\bart(?:\.|icolo)?\s*(\d+(?:\s*-?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)\b)?)"
)


def _abbreviation(*letters: str) -> str:
    """"c.p.c." however it is written: every dot and space optional, and not the tail of a
    word or of a longer abbreviation ("c.p." in "c.p.c."; "c.p. c" in "c.p. c.c.")."""
    return r"(?<![a-z.])" + r"\.?\s?".join(letters) + r"(?![a-z])(?!\.[a-z])"


# Longer abbreviations first: at one position "c.p.c." must be tried before "c.p.".
_CODES = re.compile("|".join((
    rf"(?P<cpc>{_abbreviation('c', 'p', 'c')}|codice\s+di\s+procedura\s+civile)",
    rf"(?P<cpp>{_abbreviation('c', 'p', 'p')}|codice\s+di\s+procedura\s+penale)",
    rf"(?P<cc>{_abbreviation('c', 'c')}|codice\s+civile)",
    rf"(?P<cp>{_abbreviation('c', 'p')}|codice\s+penale)",
    r"(?P<cost>(?<![a-z])cost\b\.?|costituzione)",
)))
_ACTS = {
    "cpc": "codice di procedura civile",
    "cpp": "codice di procedura penale",
    "cc": "codice civile",
    "cp": "codice penale",
    "cost": "costituzione",
}
# "art. 52 disp. att. c.c." cites the implementing provisions, not the code.
_IMPLEMENTING = re.compile(r"\bdisp(?:\.|osizioni)?\s*(?:att|trans)")
# Another article, or another act, between an article and a code: the code is not the article's.
_ANOTHER_ARTICLE = re.compile(r"\bartt?(?:\.|icoli?)?(?![a-z])")
# A closed list, and so never complete: the acts whose articles a code abbreviation must not
# claim. An act it does not name ("art. 5 del d.m. 55/2014") can still be mistaken for the code's.
_ANOTHER_ACT = re.compile(
    r"\b(?:legge|decreto|d\.?\s?lgs|dlgs|d\.?\s?p\.?\s?r|dpr|regolamento|direttiva|testo\s+unico"
    r"|t\.\s?u|tuf|tub|gdpr|codice\s+della\s+strada|codice\s+del\s+consumo)\b"
    r"|(?<![a-z.])l\.|\d+\s*/\s*\d+"
)
# What may stand between a code written first and its article: "c.c. art. 1", "codice civile, art. 1".
_BETWEEN_CODE_AND_ARTICLE = re.compile(r"[\s,:;.\-\u2013]*")


def _cited_article(text: str) -> Optional[Dict[str, str]]:
    """The act and the article a citation names, or None.

    An article takes the first code that follows it ("art. 1453 c.c. e c.p.c." is the civil
    code's), as long as no other article and no other act stands between them ("art. 2 della
    legge 241/1990, art. 3 c.c." is art. 3 of the code). With no such code, it takes the one
    written right before it ("c.c. art. 1453", "codice civile, art. 1453"), unless the text after
    the article turns to another act ("c.c. art. 5 del d.lgs. 196/2003"). The implementing
    provisions are never the code, whichever side it stands ("art. 5 disp. att. c.c.",
    "c.c. disp. att. art. 5"). An article that pairs with nothing gives way to the next."""
    lower = text.lower()
    articles = list(_ARTICLE.finditer(lower))
    for at, article in enumerate(articles):
        code = _CODES.search(lower, article.end())
        if code:
            between = lower[article.end():code.start()]
            if _IMPLEMENTING.search(between):
                continue  # the article is of the implementing provisions: no code is its own
            if not (_ANOTHER_ARTICLE.search(between) or _ANOTHER_ACT.search(between)):
                return _citation(article, code)
        # What follows the article, up to the next one, must not turn to another act.
        rest = lower[article.end():articles[at + 1].start() if at + 1 < len(articles) else len(lower)]
        if _IMPLEMENTING.search(rest) or _ANOTHER_ACT.search(rest):
            continue
        code = _last_code_before(lower, article)
        if code:
            return _citation(article, code)
    return None


def _last_code_before(lower: str, article: "re.Match[str]") -> Optional["re.Match[str]"]:
    """The code written right before the article, with nothing but punctuation between."""
    codes = list(_CODES.finditer(lower, 0, article.start()))
    if codes and _BETWEEN_CODE_AND_ARTICLE.fullmatch(lower, codes[-1].end(), article.start()):
        return codes[-1]
    return None


def _citation(article: "re.Match[str]", code: "re.Match[str]") -> Dict[str, str]:
    return {
        "tipo_atto": _ACTS[code.lastgroup],
        # "2-bis", "2 bis" and "2 - bis" are all "2bis", the form the lazy path writes
        "articolo": re.sub(r"[\s-]", "", article.group(1)),
    }


class ExternalSourceTool(BaseTool):
    """
    Tool unificato per recupero fonti esterne con strategia cascata.

    Cerca in ordine:
    1. Grafo locale (FalkorDB) - veloce, già indicizzato
    2. Normattiva (NormattivaScraper) - norme italiane ufficiali
    3. Brocardi (BrocardiScraper) - spiegazioni, massime, commenti

    Particolarmente utile per:
    - Expert che hanno bisogno di testo normativo non presente nel grafo
    - Fallback quando la ricerca nel grafo non restituisce risultati
    - Recupero di spiegazioni e massime da Brocardi

    Esempio:
        >>> tool = ExternalSourceTool(graph_db=falkordb, normattiva=scraper)
        >>> result = await tool(
        ...     query="art. 1453 c.c.",
        ...     require_official=True  # Solo Normattiva
        ... )
        >>> print(f"Fonte: {result.data['source']}")
    """

    name = "external_source"
    description = (
        "Recupera il testo di una fonte normativa da sorgenti esterne. "
        "Supporta ricerca a cascata su grafo locale, Normattiva e Brocardi. "
        "Usa questo tool quando hai bisogno del testo completo di una norma "
        "che potrebbe non essere nel database locale."
    )

    def __init__(
        self,
        graph_db: Any = None,
        normattiva_scraper: Any = None,
        brocardi_scraper: Any = None,
    ):
        """
        Inizializza ExternalSourceTool.

        Args:
            graph_db: FalkorDBClient per query al grafo locale
            normattiva_scraper: NormattivaScraper (lazy init se None)
            brocardi_scraper: BrocardiScraper (lazy init se None)
        """
        super().__init__()
        self.graph_db = graph_db
        self._normattiva_scraper = normattiva_scraper
        self._brocardi_scraper = brocardi_scraper

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="query",
                param_type=ParameterType.STRING,
                description=(
                    "Identificativo della norma. "
                    "Es: 'art. 1453 c.c.', 'codice penale art. 52', "
                    "'legittima difesa', 'urn:norma:cc:art1453'"
                )
            ),
            ToolParameter(
                name="source_priority",
                param_type=ParameterType.ARRAY,
                description=(
                    "Lista ordinata di sorgenti da consultare. "
                    "Valori: 'graph', 'normattiva', 'brocardi'. "
                    "Default: ['graph', 'normattiva', 'brocardi']"
                ),
                required=False
            ),
            ToolParameter(
                name="require_official",
                param_type=ParameterType.BOOLEAN,
                description=(
                    "Se True, usa solo fonti ufficiali (Normattiva). "
                    "Esclude Brocardi dalla cascata."
                ),
                required=False,
                default=False
            )
        ]

    async def execute(
        self,
        query: str,
        source_priority: Optional[List[str]] = None,
        require_official: bool = False,
    ) -> ToolResult:
        """
        Esegue la ricerca a cascata sulle fonti esterne.

        Args:
            query: Identificativo norma (es. "art. 1453 c.c.")
            source_priority: Ordine sorgenti ["graph", "normattiva", "brocardi"]
            require_official: Se True, solo Normattiva

        Returns:
            ToolResult con:
            - text: Testo della norma
            - urn: URN normalizzato
            - source: Sorgente usata ("graph" | "normattiva" | "brocardi")
            - fallback_used: True se non prima scelta
        """
        if source_priority is None:
            source_priority = ["graph", "normattiva", "brocardi"]

        if require_official:
            source_priority = [s for s in source_priority if s in ["graph", "normattiva"]]

        log.info(
            f"external_source - query='{query}', priority={source_priority}"
        )

        for idx, source in enumerate(source_priority):
            try:
                result = None

                if source == "graph":
                    result = await self._search_graph(query)
                elif source == "normattiva":
                    result = await self._fetch_normattiva(query)
                elif source == "brocardi":
                    if not require_official:
                        result = await self._fetch_brocardi(query)
                else:
                    log.warning(f"Sorgente sconosciuta: {source}")
                    continue

                if result:
                    fallback_used = (idx > 0)
                    log.info(
                        f"external_source completed - "
                        f"query='{query}', source={source}, fallback={fallback_used}"
                    )

                    return ToolResult.ok(
                        data={
                            "text": result["text"],
                            "urn": result["urn"],
                            "source": source,
                            "fallback_used": fallback_used,
                            "metadata": result.get("metadata", {}),
                        },
                        tool_name=self.name,
                        query=query,
                        source=source
                    )

            except Exception as e:
                log.warning(f"Errore con sorgente {source}: {e}")
                continue

        log.error(f"external_source failed - query='{query}' non trovata")
        return ToolResult.fail(
            error=f"Fonte non trovata per query '{query}' in nessuna sorgente",
            tool_name=self.name
        )

    async def _search_graph(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Cerca nel grafo locale FalkorDB.

        Args:
            query: Identificativo norma

        Returns:
            Dict con text, urn, metadata oppure None
        """
        if self.graph_db is None:
            return None

        # Parse query per estrarre URN
        urn = self._parse_urn_from_query(query)

        # Se abbiamo un URN, cerca direttamente
        if urn:
            cypher = """
            MATCH (a:Norma {URN: $urn})
            RETURN coalesce(a.testo, a.testo_vigente) AS text, a.URN AS urn,
                   a.estremi AS estremi, a.numero_articolo AS numero
            """
            params = {"urn": urn}
        else:
            # Cerca per estremi o numero articolo
            cypher = """
            MATCH (a:Norma)
            WHERE a.estremi CONTAINS $query
               OR a.numero_articolo = $query
               OR toLower(coalesce(a.testo, a.testo_vigente, '')) CONTAINS toLower($query)
            RETURN coalesce(a.testo, a.testo_vigente) AS text, a.URN AS urn,
                   a.estremi AS estremi, a.numero_articolo AS numero
            LIMIT 1
            """
            params = {"query": query}

        # The query is the LLM's text: it only ever travels as a parameter, and the
        # read-only call is the second line of defence if that ever slips.
        try:
            result = await self.graph_db.ro_query(cypher, params)

            if result and len(result) > 0:
                row = result[0]
                return {
                    "text": row.get("text", ""),
                    "urn": row.get("urn", ""),
                    "metadata": {
                        "estremi": row.get("estremi"),
                        "numero": row.get("numero"),
                        "source": "graph"
                    },
                }
        except Exception as e:
            log.debug(f"Graph search failed: {e}")

        return None

    async def _fetch_normattiva(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Recupera da Normattiva.

        Args:
            query: Identificativo norma

        Returns:
            Dict con text, urn, metadata oppure None
        """
        # Lazy init scraper
        if self._normattiva_scraper is None:
            try:
                from merlt.clients import NormattivaScraper
                self._normattiva_scraper = NormattivaScraper()
            except ImportError:
                log.warning("NormattivaScraper non disponibile")
                return None

        # Parse query per estrarre tipo atto e articolo
        parsed = self._parse_normattiva_query(query)
        if not parsed:
            return None

        try:
            from merlt.clients import Norma, NormaVisitata

            norma = Norma(
                tipo_atto=parsed["tipo_atto"],
                data=parsed.get("data_atto"),
                numero_atto=parsed.get("numero_atto")
            )

            norma_visitata = NormaVisitata(
                norma=norma,
                numero_articolo=parsed["articolo"]
            )

            text, urn = await self._normattiva_scraper.get_document(norma_visitata)

            if text:
                return {
                    "text": text,
                    "urn": urn,
                    "metadata": {
                        "tipo_atto": parsed["tipo_atto"],
                        "articolo": parsed["articolo"],
                        "source": "normattiva"
                    },
                }

        except Exception as e:
            log.debug(f"Normattiva fetch failed: {e}")

        return None

    async def _fetch_brocardi(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Recupera da Brocardi.

        Args:
            query: Identificativo norma

        Returns:
            Dict con text, urn, metadata oppure None
        """
        # Lazy init scraper
        if self._brocardi_scraper is None:
            try:
                from merlt.clients import BrocardiScraper
                self._brocardi_scraper = BrocardiScraper()
            except ImportError:
                log.warning("BrocardiScraper non disponibile")
                return None

        try:
            result = await self._brocardi_scraper.search(query)

            if result and result.get("text"):
                return {
                    "text": result["text"],
                    "urn": result.get("urn", ""),
                    "metadata": {
                        "spiegazione": result.get("spiegazione", ""),
                        "massime": result.get("massime", []),
                        "source": "brocardi"
                    },
                }

        except Exception as e:
            log.debug(f"Brocardi fetch failed: {e}")

        return None

    def _parse_urn_from_query(self, query: str) -> Optional[str]:
        """The graph key of the article a query cites, or None."""
        text = query.strip()
        if text.startswith("urn:"):
            return canonical_urn(_NORMATTIVA_PREFIX + text)
        if text.startswith(_NORMATTIVA_PREFIX):
            return canonical_urn(text)
        cited = _cited_article(text)
        # the Costituzione is read by Normattiva's fetch only: its graph key is not pinned yet
        if not cited or cited["tipo_atto"] == "costituzione":
            return None
        return canonical_urn(generate_urn(cited["tipo_atto"], article=cited["articolo"]))

    def _parse_normattiva_query(self, query: str) -> Optional[Dict[str, str]]:
        """
        Parse query per Normattiva.

        Args:
            query: Query utente

        Returns:
            Dict con tipo_atto e articolo oppure None
        """
        return _cited_article(query)
