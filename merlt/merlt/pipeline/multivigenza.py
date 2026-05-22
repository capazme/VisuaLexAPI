"""
Multivigenza Pipeline
=====================

Extended pipeline for temporal versioning (multivigenza) of Italian legal norms.

This module:
1. Tracks all amendments to articles over time
2. Creates graph relations for modifications (:abroga, :sostituisce, :modifica, :inserisce)
3. Creates COMPLETE Norma nodes for modifying acts (conformi a knowledge-graph.md)
4. Stores version history with temporal properties

Integration:
    This pipeline extends IngestionPipelineV2 with multivigenza support.
    Use it for norms that have amendments (most Italian laws).

Schema Compliance:
    All nodes created by this pipeline conform to docs/02-methodology/knowledge-graph.md.
    Each Norma node includes all required properties for the MERL-T knowledge graph.

Usage:
    from merlt.pipeline import MultivigenzaPipeline
    from merlt.config import get_environment_config, TEST_ENV

    config = get_environment_config(TEST_ENV)
    pipeline = MultivigenzaPipeline(falkordb_client, config)

    result = await pipeline.ingest_with_history(norma_visitata)
"""

import structlog
import re
from datetime import datetime, timezone
from functools import lru_cache
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field

from merlt.clients import (
    NormaVisitata,
    Norma,
    Modifica,
    TipoModifica,
    StoriaArticolo,
    NormattivaScraper,
)

log = structlog.get_logger()


# Graph relation types for modifications
RELATION_TYPES = {
    TipoModifica.ABROGA: "abroga",
    TipoModifica.SOSTITUISCE: "sostituisce",
    TipoModifica.MODIFICA: "modifica",
    TipoModifica.INSERISCE: "inserisce",
}

# Mapping tipo atto da estremi a tipo_documento standardizzato
TIPO_ATTO_MAPPING = {
    "legge": "legge",
    "decreto-legge": "decreto-legge",
    "decreto legge": "decreto-legge",
    "d.l.": "decreto-legge",
    "decreto legislativo": "decreto legislativo",
    "d.lgs.": "decreto legislativo",
    "d.lgs": "decreto legislativo",
    "decreto del presidente della repubblica": "decreto del presidente della repubblica",
    "d.p.r.": "decreto del presidente della repubblica",
    "dpr": "decreto del presidente della repubblica",
    "decreto ministeriale": "decreto ministeriale",
    "d.m.": "decreto ministeriale",
    "legge costituzionale": "legge costituzionale",
    "regolamento": "regolamento",
    "direttiva": "direttiva",
    "regolamento ue": "regolamento ue",
    "direttiva ue": "direttiva ue",
}

# Mapping tipo atto -> autorità emanante
AUTORITA_EMANANTE_MAPPING = {
    "legge": "Parlamento",
    "legge costituzionale": "Parlamento",
    "decreto-legge": "Governo",
    "decreto legislativo": "Governo",
    "decreto del presidente della repubblica": "Presidente della Repubblica",
    "decreto ministeriale": "Ministero",
    "regolamento": "Governo",
    "direttiva": "Unione Europea",
    "regolamento ue": "Unione Europea",
    "direttiva ue": "Unione Europea",
    "costituzione": "Assemblea Costituente",
    "regio decreto": "Re d'Italia",
}


def _build_normattiva_url(urn: str) -> str:
    """
    Costruisce URL Normattiva da URN.

    Args:
        urn: URN nel formato urn:nir:...

    Returns:
        URL completo per Normattiva
    """
    return f"https://www.normattiva.it/uri-res/N2Ls?{urn}"


def _derive_autorita_emanante(tipo_documento: str) -> str:
    """
    Deriva autorità emanante dal tipo documento.

    Args:
        tipo_documento: Tipo di atto normativo

    Returns:
        Autorità emanante (default: "Stato")
    """
    if not tipo_documento:
        return "Stato"
    return AUTORITA_EMANANTE_MAPPING.get(tipo_documento.lower(), "Stato")


@lru_cache(maxsize=1)
def _get_llm_service():
    """Get cached LLM service instance."""
    from merlt.rlcf.ai_service import OpenRouterService
    return OpenRouterService()


def parse_estremi(estremi: str) -> Dict[str, Optional[str]]:
    """
    Parse gli estremi di un atto normativo per estrarre le componenti.

    Args:
        estremi: Es. "LEGGE 7 agosto 1990, n. 241" o "D.L. 31 maggio 2021, n. 77"

    Returns:
        Dict con tipo_atto, data, numero, titolo
    """
    result = {
        "tipo_atto": None,
        "tipo_documento": None,
        "data": None,
        "numero": None,
        "titolo": None,
    }

    if not estremi:
        return result

    estremi_lower = estremi.lower().strip()

    # Pattern per estrarre tipo atto
    # Es: "LEGGE 7 agosto 1990, n. 241"
    # Es: "D.L. 31 maggio 2021, n. 77"
    # Es: "DECRETO LEGISLATIVO 30 giugno 2003, n. 196"

    # Trova il tipo di atto (prima parte fino alla data o al numero)
    tipo_patterns = [
        r"^(legge costituzionale)",
        r"^(decreto[- ]legge|d\.l\.)",
        r"^(decreto legislativo|d\.lgs\.?)",
        r"^(decreto del presidente della repubblica|d\.p\.r\.?|dpr)",
        r"^(decreto ministeriale|d\.m\.)",
        r"^(regolamento ue)",
        r"^(direttiva ue)",
        r"^(regolamento)",
        r"^(direttiva)",
        r"^(legge)",
    ]

    for pattern in tipo_patterns:
        match = re.match(pattern, estremi_lower)
        if match:
            tipo_raw = match.group(1)
            result["tipo_atto"] = tipo_raw
            result["tipo_documento"] = TIPO_ATTO_MAPPING.get(tipo_raw, tipo_raw)
            break

    # Estrai numero (pattern: "n. 241" o "n.241" o ", n. 241")
    numero_match = re.search(r"n\.?\s*(\d+)", estremi_lower)
    if numero_match:
        result["numero"] = numero_match.group(1)

    # Estrai data (pattern: "7 agosto 1990" o "1990-08-07")
    # Mesi italiani
    mesi = {
        "gennaio": "01", "febbraio": "02", "marzo": "03", "aprile": "04",
        "maggio": "05", "giugno": "06", "luglio": "07", "agosto": "08",
        "settembre": "09", "ottobre": "10", "novembre": "11", "dicembre": "12"
    }

    data_match = re.search(r"(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})", estremi_lower)
    if data_match:
        giorno = data_match.group(1).zfill(2)
        mese = mesi[data_match.group(2)]
        anno = data_match.group(3)
        result["data"] = f"{anno}-{mese}-{giorno}"

    # Genera titolo standard
    if result["tipo_documento"] and result["numero"]:
        data_str = ""
        if result["data"]:
            # Converti data in formato leggibile
            try:
                dt = datetime.strptime(result["data"], "%Y-%m-%d")
                data_str = f" del {dt.strftime('%d/%m/%Y')}"
            except ValueError:
                data_str = ""
        result["titolo"] = f"{result['tipo_documento'].title()} n. {result['numero']}{data_str}"

    return result


def parse_disposizione(disposizione: str) -> Dict[str, Any]:
    """
    Parse la disposizione per estrarre articolo, comma, lettera, numero dell'atto modificante.

    La disposizione indica QUALE parte dell'atto modificante contiene la norma
    che opera la modifica.

    Gerarchia normativa italiana:
        Articolo -> Comma -> Lettera -> Numero

    Args:
        disposizione: Es. "art. 12, comma 1, lettera b, numero 3"

    Returns:
        Dict con numero_articolo, commi, lettere, numeri (tutte liste)

    Examples:
        "art. 4, comma 2" -> {art: "4", commi: ["2"], lettere: [], numeri: []}
        "art. 22, comma 1, lettera b" -> {art: "22", commi: ["1"], lettere: ["b"], numeri: []}
    """
    result = {
        "numero_articolo": None,
        "commi": [],
        "lettere": [],
        "numeri": [],
    }

    if not disposizione:
        return result

    disp_lower = disposizione.lower().strip()

    # Estrai numero articolo: "art. 12" o "art.12" o "art. 12-bis"
    art_match = re.search(r"art\.?\s*(\d+(?:-\w+)?)", disp_lower)
    if art_match:
        result["numero_articolo"] = art_match.group(1)

    # Estrai commi: "comma 1" o "commi 1, 3 e 4"
    comma_match = re.search(r"comm[ai]\s+([\d,\s]+(?:e\s+\d+)?)", disp_lower)
    if comma_match:
        comma_str = comma_match.group(1)
        commi = re.findall(r"\d+", comma_str)
        result["commi"] = commi

    # Estrai lettere: "lettera b" o "lettere a, b e c"
    lettera_match = re.search(r"letter[ae]\s+([a-z,\s]+(?:e\s+[a-z])?)", disp_lower)
    if lettera_match:
        lettera_str = lettera_match.group(1)
        lettere = re.findall(r"[a-z]", lettera_str)
        result["lettere"] = lettere

    # Estrai numeri: "numero 1" o "numeri 1, 2 e 3"
    numero_match = re.search(r"numer[oi]\s+([\d,\s]+(?:e\s+\d+)?)", disp_lower)
    if numero_match:
        numero_str = numero_match.group(1)
        numeri = re.findall(r"\d+", numero_str)
        result["numeri"] = numeri

    return result


def _format_destinazione(parsed: Dict[str, Optional[str]]) -> str:
    """
    Formatta i componenti della destinazione in stringa leggibile.

    Args:
        parsed: Dict con articolo, comma, lettera, numero

    Returns:
        Stringa formattata es. "art. 10, comma 1, lettera a"
    """
    parts = []
    if parsed.get("articolo"):
        parts.append(f"art. {parsed['articolo']}")
    if parsed.get("comma"):
        parts.append(f"comma {parsed['comma']}")
    if parsed.get("lettera"):
        parts.append(f"lettera {parsed['lettera']}")
    if parsed.get("numero"):
        parts.append(f"numero {parsed['numero']}")
    return ", ".join(parts)


def parse_destinazione(destinazione_text: str) -> Dict[str, Optional[str]]:
    """
    Parse la destinazione con regex per estrarre articolo, comma, lettera, numero.

    La destinazione indica QUALE parte della norma TARGET viene modificata.
    Usa gli stessi pattern della disposizione ma restituisce valori singolari.

    Args:
        destinazione_text: Es. "art. 5, comma 2" o "comma 3 dell'art. 10"

    Returns:
        Dict con target_article, comma, lettera, numero, destinazione (stringa formattata)
    """
    result = {
        "target_article": None,
        "comma": None,
        "lettera": None,
        "numero": None,
        "destinazione": None,
    }

    if not destinazione_text:
        return result

    text_lower = destinazione_text.lower().strip()

    # Estrai numero articolo: "art. 12" o "art.12" o "art. 12-bis"
    art_match = re.search(r"art\.?\s*(\d+(?:-\w+)?)", text_lower)
    if art_match:
        result["target_article"] = art_match.group(1)

    # Estrai comma (primo match, singolare)
    comma_match = re.search(r"comm[ai]\s+(\d+)", text_lower)
    if comma_match:
        result["comma"] = comma_match.group(1)

    # Estrai lettera (primo match, singolare)
    lettera_match = re.search(r"letter[ae]\s+([a-z])", text_lower)
    if lettera_match:
        result["lettera"] = lettera_match.group(1)

    # Estrai numero (primo match, singolare)
    numero_match = re.search(r"numer[oi]\s+(\d+)", text_lower)
    if numero_match:
        result["numero"] = numero_match.group(1)

    # Costruisci stringa formattata
    parsed_for_format = {
        "articolo": result["target_article"],
        "comma": result["comma"],
        "lettera": result["lettera"],
        "numero": result["numero"],
    }
    formatted = _format_destinazione(parsed_for_format)
    result["destinazione"] = formatted if formatted else None

    return result


async def parse_destinazione_with_llm(
    destinazione_text: str,
    llm_service=None,
) -> Dict[str, Optional[str]]:
    """
    Parse la destinazione usando LLM per casi complessi.

    Pattern: regex-first, LLM fallback.
    La destinazione indica quale parte della norma target viene modificata.

    Args:
        destinazione_text: Testo della destinazione
        llm_service: Optional LLM service (default: usa _get_llm_service())

    Returns:
        Dict con target_article, comma, lettera, numero, destinazione
    """
    # Prima prova con regex (veloce, economico)
    result = parse_destinazione(destinazione_text)

    # Se regex ha trovato almeno l'articolo, usa quello
    if result["target_article"]:
        return result

    # Altrimenti usa LLM
    if not llm_service:
        try:
            llm_service = _get_llm_service()
        except ImportError:
            log.warning("LLM service not available, using regex only")
            return result

    prompt = f"""Estrai le componenti strutturali dalla seguente destinazione normativa italiana.

Destinazione: "{destinazione_text}"

La destinazione indica quale parte della norma viene modificata.
Gerarchia: Articolo -> Comma -> Lettera -> Numero

Esempi:
- "del comma 2 dell'art. 5" -> articolo="5", comma="2"
- "all'articolo 10, comma 1, lettera a)" -> articolo="10", comma="1", lettera="a"
- "primo comma dell'articolo 48" -> articolo="48", comma="1"
- "la norma di cui al capo III" -> articolo=null, comma=null"""

    json_schema = {
        "type": "object",
        "properties": {
            "articolo": {
                "type": ["string", "null"],
                "description": "Numero articolo (es. '5', '12-bis') o null"
            },
            "comma": {
                "type": ["string", "null"],
                "description": "Numero comma (es. '2') o null"
            },
            "lettera": {
                "type": ["string", "null"],
                "description": "Lettera (es. 'a', 'b') o null"
            },
            "numero": {
                "type": ["string", "null"],
                "description": "Numero (es. '1', '2') o null"
            }
        },
        "required": ["articolo", "comma", "lettera", "numero"],
        "additionalProperties": False
    }

    try:
        import os
        model = os.getenv("LLM_PARSING_MODEL", "mistralai/mistral-7b-instruct")

        parsed = await llm_service.generate_json_completion(
            prompt=prompt,
            json_schema=json_schema,
            system_prompt="Sei un parser di testi normativi italiani. Converti ordinali in numeri (primo=1, secondo=2).",
            model=model,
            temperature=0.0,
            max_tokens=200,
        )

        formatted = _format_destinazione(parsed)
        return {
            "target_article": parsed.get("articolo"),
            "comma": parsed.get("comma"),
            "lettera": parsed.get("lettera"),
            "numero": parsed.get("numero"),
            "destinazione": formatted if formatted else None,
        }

    except Exception as e:
        log.warning(f"LLM parsing failed for destinazione: {e}, using regex result")

    return result


async def parse_disposizione_with_llm(
    disposizione: str,
    estremi_atto: str,
    llm_service=None,
) -> Dict[str, Optional[str]]:
    """
    Parse la disposizione usando LLM per casi complessi.

    Usa LLM per estrarre in modo robusto articolo, comma, lettera da qualsiasi
    formato di disposizione normativa (italiano, EU, internazionale).

    Args:
        disposizione: Testo della disposizione
        estremi_atto: Estremi dell'atto per contesto
        llm_service: Optional LLM service (default: usa OpenRouterService)

    Returns:
        Dict con numero_articolo, commi, lettere
    """
    # Prima prova con regex (veloce, economico)
    result = parse_disposizione(disposizione)

    # Se regex ha trovato almeno l'articolo, usa quello
    if result["numero_articolo"]:
        return result

    # Altrimenti usa LLM
    if not llm_service:
        try:
            llm_service = _get_llm_service()
        except ImportError:
            log.warning("LLM service not available, using regex only")
            return result

    prompt = f"""Estrai le componenti strutturali dalla seguente disposizione normativa italiana.

Disposizione: "{disposizione}"
Atto: {estremi_atto}

Gerarchia: Articolo -> Comma -> Lettera -> Numero

Esempi:
- "art. 117, comma 2, lettera b)" -> numero_articolo="117", commi=["2"], lettere=["b"]
- "articolo 5-bis, commi 1 e 3" -> numero_articolo="5-bis", commi=["1", "3"]
- "l'articolo 48, primo comma" -> numero_articolo="48", commi=["1"]"""

    # JSON Schema per structured output
    json_schema = {
        "type": "object",
        "properties": {
            "numero_articolo": {
                "type": ["string", "null"],
                "description": "Numero articolo (es. '12', '12-bis') o null"
            },
            "commi": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Lista dei commi (es. ['1', '3'])"
            },
            "lettere": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Lista delle lettere (es. ['a', 'b'])"
            },
            "numeri": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Lista dei numeri (es. ['1', '2'])"
            }
        },
        "required": ["numero_articolo", "commi", "lettere", "numeri"],
        "additionalProperties": False
    }

    try:
        import os
        model = os.getenv("LLM_PARSING_MODEL", "mistralai/mistral-7b-instruct")

        # Usa generate_json_completion con structured output
        parsed = await llm_service.generate_json_completion(
            prompt=prompt,
            json_schema=json_schema,
            system_prompt="Sei un parser di testi normativi italiani. Converti ordinali in numeri (primo=1, secondo=2).",
            model=model,
            temperature=0.0,
            max_tokens=200,
        )

        return {
            "numero_articolo": parsed.get("numero_articolo"),
            "commi": parsed.get("commi", []),
            "lettere": parsed.get("lettere", []),
            "numeri": parsed.get("numeri", []),
        }

    except Exception as e:
        log.warning(f"LLM parsing failed: {e}, using regex result")

    return result


def build_disposizione_urn(base_urn: str, disposizione_parsed: Dict) -> str:
    """
    Costruisce l'URN per l'elemento più specifico della disposizione.

    Gerarchia URN: ~artN-comN-letX-numN

    Args:
        base_urn: URN dell'atto base (es. urn:nir:stato:legge:2021-05-31;77)
        disposizione_parsed: Risultato di parse_disposizione

    Returns:
        URN dell'elemento più specifico (numero > lettera > comma > articolo)
    """
    urn = base_urn

    if disposizione_parsed["numero_articolo"]:
        # Aggiungi articolo: ~art12 o ~art12bis
        art_num = disposizione_parsed["numero_articolo"].replace("-", "")
        urn = f"{urn}~art{art_num}"

        if disposizione_parsed["commi"]:
            # Aggiungi primo comma: ~art12-com1
            comma = disposizione_parsed["commi"][0]
            urn = f"{urn}-com{comma}"

            if disposizione_parsed["lettere"]:
                # Aggiungi prima lettera: ~art12-com1-leta
                lettera = disposizione_parsed["lettere"][0]
                urn = f"{urn}-let{lettera}"

                if disposizione_parsed.get("numeri"):
                    # Aggiungi primo numero: ~art12-com1-leta-num1
                    numero = disposizione_parsed["numeri"][0]
                    urn = f"{urn}-num{numero}"

    return urn


@dataclass
class MultivigenzaResult:
    """
    Result of ingesting an article with multivigenza.

    Attributes:
        article_urn: URN of the ingested article
        storia: Complete amendment history
        atti_modificanti_creati: List of modifying act URNs created
        relazioni_create: List of modification relations created
        versioni_salvate: Number of historical versions saved
        errors: Any errors encountered
    """
    article_urn: str
    storia: Optional[StoriaArticolo] = None
    atti_modificanti_creati: List[str] = field(default_factory=list)
    relazioni_create: List[str] = field(default_factory=list)
    versioni_salvate: int = 0
    errors: List[str] = field(default_factory=list)

    def summary(self) -> Dict[str, Any]:
        """Return summary for logging."""
        return {
            "article_urn": self.article_urn,
            "modifiche": len(self.storia.modifiche) if self.storia else 0,
            "atti_modificanti": len(self.atti_modificanti_creati),
            "relazioni": len(self.relazioni_create),
            "versioni": self.versioni_salvate,
            "errors": len(self.errors),
        }


class MultivigenzaPipeline:
    """
    Pipeline for ingesting legal articles with temporal versioning.

    This pipeline:
    1. Fetches amendment history from Normattiva
    2. Creates Norma nodes for modifying acts
    3. Creates modification relations (:abroga, :modifica, etc.)
    4. Optionally fetches and stores historical versions

    Graph Schema Extensions:
        Norma node properties:
            - data_inizio_vigenza: Date when this version became effective
            - data_fine_vigenza: Date when this version was superseded (NULL if current)
            - versione: Version identifier ("originale", "1", "2", ...)
            - is_versione_vigente: Boolean, True if current version
            - abrogato: Boolean, True if article was abrogated

        New relations:
            - :abroga {disposizione, data_efficacia, data_gu, certezza}
            - :sostituisce {disposizione, data_efficacia, data_gu, certezza}
            - :modifica {disposizione, data_efficacia, data_gu, certezza}
            - :inserisce {disposizione, data_efficacia, data_gu, certezza}

    Usage:
        pipeline = MultivigenzaPipeline(falkordb_client)

        # Simple: just add amendment relations
        result = await pipeline.ingest_with_history(norma_visitata)

        # Full: also fetch all historical versions
        result = await pipeline.ingest_with_history(
            norma_visitata,
            fetch_all_versions=True
        )
    """

    def __init__(
        self,
        falkordb_client=None,
        scraper: Optional[NormattivaScraper] = None,
        dry_run: bool = False
    ):
        """
        Initialize pipeline.

        Args:
            falkordb_client: FalkorDB client for graph operations
            scraper: Optional NormattivaScraper (default: creates new one)
            dry_run: Se True, non scrive nel grafo (solo logging)

        Example:
            # Dry-run per test
            pipeline = MultivigenzaPipeline(dry_run=True)
            result = await pipeline.ingest_with_history(nv)
            print(f"Would create {len(result.storia.modifiche)} modifiche")
        """
        self.falkordb = falkordb_client
        self.scraper = scraper or NormattivaScraper()
        self.dry_run = dry_run
        self._timestamp = None

        log.info("MultivigenzaPipeline initialized", dry_run=dry_run)

    async def ingest_with_history(
        self,
        normavisitata: NormaVisitata,
        fetch_all_versions: bool = False,
        create_modifying_acts: bool = True,
    ) -> MultivigenzaResult:
        """
        Ingest an article with its amendment history.

        Args:
            normavisitata: NormaVisitata reference to the article
            fetch_all_versions: If True, fetch and store all historical versions
            create_modifying_acts: If True, create Norma nodes for modifying acts

        Returns:
            MultivigenzaResult with created nodes and relations
        """
        self._timestamp = datetime.now(timezone.utc).isoformat()
        article_urn = normavisitata.urn

        log.info(f"Ingesting with history: {article_urn}")

        result = MultivigenzaResult(article_urn=article_urn)

        try:
            # 1. Fetch amendment history
            modifiche = await self.scraper.get_amendment_history(
                normavisitata, filter_article=True
            )

            if not modifiche:
                log.info(f"No amendments found for {article_urn}")
                return result

            # Create StoriaArticolo
            # L'articolo è abrogato SOLO se esiste una abrogazione dell'intero articolo,
            # non solo di un comma o lettera specifica
            # Passa il numero articolo per verificare che l'abrogazione sia per questo articolo specifico
            numero_articolo = normavisitata.numero_articolo
            is_abrogato = any(
                m.is_article_level_abrogation(for_article=numero_articolo)
                for m in modifiche
            )

            result.storia = StoriaArticolo(
                articolo_urn=article_urn,
                versione_originale=normavisitata.norma.data,  # Original publication date
                modifiche=modifiche,
                is_abrogato=is_abrogato,
            )

            log.info(f"Found {len(modifiche)} amendments for {article_urn}")

            # Dry-run: skip graph operations
            if self.dry_run:
                log.info(
                    "[DRY-RUN] Would process article",
                    article_urn=article_urn,
                    modifiche=len(modifiche),
                    is_abrogato=is_abrogato
                )
                return result

            # 2. Update article node with multivigenza properties
            await self._update_article_properties(normavisitata, result)

            # 3. Create modifying act nodes and relations
            if create_modifying_acts and self.falkordb:
                for modifica in modifiche:
                    await self._create_modification(normavisitata, modifica, result)

            # 4. Optionally fetch all historical versions
            if fetch_all_versions:
                result.versioni_salvate = await self._fetch_all_versions(
                    normavisitata, modifiche, result
                )

            log.info(f"Ingestion complete: {result.summary()}")

        except Exception as e:
            error_msg = f"Error ingesting {article_urn}: {e}"
            log.error(error_msg, exc_info=True)
            result.errors.append(error_msg)

        return result

    async def _update_article_properties(
        self,
        normavisitata: NormaVisitata,
        result: MultivigenzaResult,
    ) -> None:
        """
        Update article Norma node with multivigenza properties.
        """
        if not self.falkordb:
            return

        article_urn = normavisitata.urn
        storia = result.storia

        await self.falkordb.query(
            """
            MATCH (art:Norma {URN: $urn})
            SET art.data_inizio_vigenza = $data_orig,
                art.is_versione_vigente = true,
                art.versione = 'vigente',
                art.abrogato = $abrogato,
                art.n_modifiche = $n_mod,
                art.ultima_modifica = $ultima_mod,
                art.multivigenza_enabled = true
            """,
            {
                "urn": article_urn,
                "data_orig": storia.versione_originale if storia else None,
                "abrogato": storia.is_abrogato if storia else False,
                "n_mod": len(storia.modifiche) if storia else 0,
                "ultima_mod": storia.modifiche[-1].data_efficacia if storia and storia.modifiche else None,
            }
        )

        log.debug(f"Updated article properties: {article_urn}")

    async def _create_modification(
        self,
        normavisitata: NormaVisitata,
        modifica: Modifica,
        result: MultivigenzaResult,
    ) -> None:
        """
        Create COMPLETE hierarchical structure for modifying act and modification relation.

        Struttura creata (conforme a knowledge-graph.md):
            (Atto Modificante) -[:contiene]-> (Articolo) -[:contiene]-> (Comma)
                                                                            |
                                                                       [:modifica]
                                                                            v
                                                                    (Articolo Modificato)

        La relazione di modifica parte dal livello più specifico disponibile
        (comma > articolo > atto), come previsto dal diritto positivo.

        Creates:
        1. Nodo Norma per l'atto modificante (legge, decreto, etc.)
        2. Nodo Norma per l'articolo specifico della disposizione
        3. Nodo Comma se presente nella disposizione
        4. Relazioni :contiene per la gerarchia
        5. Relazione di modifica dal nodo più specifico
        """
        if not self.falkordb:
            return

        target_article_urn = normavisitata.urn
        atto_urn = modifica.atto_modificante_urn

        if not atto_urn:
            log.warning(f"Missing URN for modifying act: {modifica.atto_modificante_estremi}")
            return

        # Parse estremi per informazioni sull'atto
        parsed_estremi = parse_estremi(modifica.atto_modificante_estremi)

        # Parse disposizione per articolo/comma specifico
        parsed_disp = parse_disposizione(modifica.disposizione)

        # ========================================
        # 1. Create/merge ATTO MODIFICANTE (livello documento)
        # ========================================
        tipo_doc = parsed_estremi["tipo_documento"] or "atto normativo"
        autorita = _derive_autorita_emanante(tipo_doc)
        atto_url = _build_normattiva_url(atto_urn)

        await self.falkordb.query(
            """
            MERGE (atto:Norma {URN: $urn})
            ON CREATE SET
                atto.node_id = $urn,
                atto.url = $url,
                atto.estremi = $estremi,
                atto.tipo_documento = $tipo_documento,
                atto.titolo = $titolo,
                atto.stato = 'vigente',
                atto.vigenza = 'vigente',
                atto.efficacia = 'permanente',
                atto.data_pubblicazione = $data_gu,
                atto.data_entrata_vigore = $data_gu,
                atto.autorita_emanante = $autorita,
                atto.ambito_territoriale = 'nazionale',
                atto.fonte = 'Normattiva',
                atto.created_at = $timestamp,
                atto.updated_at = $timestamp
            """,
            {
                "urn": atto_urn,
                "url": atto_url,
                "estremi": modifica.atto_modificante_estremi,
                "tipo_documento": tipo_doc,
                "titolo": parsed_estremi["titolo"] or modifica.atto_modificante_estremi,
                "data_gu": modifica.data_pubblicazione_gu,
                "autorita": autorita,
                "timestamp": self._timestamp,
            }
        )

        if atto_urn not in result.atti_modificanti_creati:
            result.atti_modificanti_creati.append(atto_urn)

        # Determina il nodo sorgente per la relazione di modifica
        # (il livello più specifico disponibile)
        source_urn = atto_urn

        # ========================================
        # 2. Create ARTICOLO della disposizione (se presente)
        # ========================================
        if parsed_disp["numero_articolo"]:
            art_num = parsed_disp["numero_articolo"]
            art_num_normalized = art_num.replace("-", "")
            articolo_urn = f"{atto_urn}~art{art_num_normalized}"
            articolo_url = _build_normattiva_url(articolo_urn)

            # Costruisci estremi articolo
            articolo_estremi = f"Art. {art_num} {modifica.atto_modificante_estremi}"

            await self.falkordb.query(
                """
                MERGE (art:Norma {URN: $urn})
                ON CREATE SET
                    art.node_id = $urn,
                    art.url = $url,
                    art.tipo_documento = 'articolo',
                    art.numero_articolo = $numero,
                    art.estremi = $estremi,
                    art.stato = 'vigente',
                    art.vigenza = 'vigente',
                    art.autorita_emanante = $autorita,
                    art.data_pubblicazione = $data_gu,
                    art.data_entrata_vigore = $data_gu,
                    art.fonte = 'Normattiva',
                    art.created_at = $timestamp,
                    art.updated_at = $timestamp
                """,
                {
                    "urn": articolo_urn,
                    "url": articolo_url,
                    "numero": art_num,
                    "estremi": articolo_estremi,
                    "autorita": autorita,
                    "data_gu": modifica.data_pubblicazione_gu,
                    "timestamp": self._timestamp,
                }
            )

            # Relazione :contiene dall'atto all'articolo
            await self.falkordb.query(
                """
                MATCH (atto:Norma {URN: $atto_urn})
                MATCH (art:Norma {URN: $art_urn})
                MERGE (atto)-[r:contiene]->(art)
                ON CREATE SET r.certezza = 1.0
                """,
                {"atto_urn": atto_urn, "art_urn": articolo_urn}
            )

            source_urn = articolo_urn

            # ========================================
            # 3. Create COMMA/I (se presente/i)
            # ========================================
            if parsed_disp["commi"]:
                for comma_num in parsed_disp["commi"]:
                    comma_urn = f"{articolo_urn}-com{comma_num}"

                    # Costruisci estremi comma
                    comma_estremi = f"Art. {art_num}, comma {comma_num}, {modifica.atto_modificante_estremi}"

                    await self.falkordb.query(
                        """
                        MERGE (comma:Comma {URN: $urn})
                        ON CREATE SET
                            comma.node_id = $urn,
                            comma.tipo = 'comma',
                            comma.posizione = $posizione,
                            comma.estremi = $estremi,
                            comma.testo = $testo,
                            comma.fonte = 'Normattiva',
                            comma.created_at = $timestamp
                        """,
                        {
                            "urn": comma_urn,
                            "posizione": f"comma {comma_num}",
                            "estremi": comma_estremi,
                            "testo": modifica.disposizione,  # Il testo della disposizione
                            "timestamp": self._timestamp,
                        }
                    )

                    # Relazione :contiene dall'articolo al comma
                    await self.falkordb.query(
                        """
                        MATCH (art:Norma {URN: $art_urn})
                        MATCH (comma:Comma {URN: $comma_urn})
                        MERGE (art)-[r:contiene]->(comma)
                        ON CREATE SET r.certezza = 1.0, r.ordinamento = $ord
                        """,
                        {"art_urn": articolo_urn, "comma_urn": comma_urn, "ord": int(comma_num)}
                    )

                # Per la relazione di modifica, usa il primo comma
                first_comma_urn = f"{articolo_urn}-com{parsed_disp['commi'][0]}"
                source_urn = first_comma_urn

                # ========================================
                # 4. Create LETTERA/E (se presente/i)
                # ========================================
                if parsed_disp["lettere"]:
                    for lettera in parsed_disp["lettere"]:
                        lettera_urn = f"{first_comma_urn}-let{lettera}"

                        # Costruisci estremi lettera
                        lettera_estremi = f"Art. {art_num}, comma {parsed_disp['commi'][0]}, lettera {lettera}), {modifica.atto_modificante_estremi}"

                        await self.falkordb.query(
                            """
                            MERGE (let:Lettera {URN: $urn})
                            ON CREATE SET
                                let.node_id = $urn,
                                let.tipo = 'lettera',
                                let.posizione = $posizione,
                                let.estremi = $estremi,
                                let.fonte = 'Normattiva',
                                let.created_at = $timestamp
                            """,
                            {
                                "urn": lettera_urn,
                                "posizione": f"lettera {lettera})",
                                "estremi": lettera_estremi,
                                "timestamp": self._timestamp,
                            }
                        )

                        # Relazione :contiene dal comma alla lettera
                        await self.falkordb.query(
                            """
                            MATCH (comma:Comma {URN: $comma_urn})
                            MATCH (let:Lettera {URN: $let_urn})
                            MERGE (comma)-[r:contiene]->(let)
                            ON CREATE SET r.certezza = 1.0, r.ordinamento = $ord
                            """,
                            {"comma_urn": first_comma_urn, "let_urn": lettera_urn, "ord": ord(lettera) - ord('a') + 1}
                        )

                    # Usa la prima lettera come source
                    first_lettera_urn = f"{first_comma_urn}-let{parsed_disp['lettere'][0]}"
                    source_urn = first_lettera_urn

                    # ========================================
                    # 5. Create NUMERO/I (se presente/i)
                    # ========================================
                    if parsed_disp.get("numeri"):
                        for numero in parsed_disp["numeri"]:
                            numero_urn = f"{first_lettera_urn}-num{numero}"

                            # Costruisci estremi numero
                            numero_estremi = f"Art. {art_num}, comma {parsed_disp['commi'][0]}, lettera {parsed_disp['lettere'][0]}), numero {numero}), {modifica.atto_modificante_estremi}"

                            await self.falkordb.query(
                                """
                                MERGE (num:Numero {URN: $urn})
                                ON CREATE SET
                                    num.node_id = $urn,
                                    num.tipo = 'numero',
                                    num.posizione = $posizione,
                                    num.estremi = $estremi,
                                    num.fonte = 'Normattiva',
                                    num.created_at = $timestamp
                                """,
                                {
                                    "urn": numero_urn,
                                    "posizione": f"numero {numero})",
                                    "estremi": numero_estremi,
                                    "timestamp": self._timestamp,
                                }
                            )

                            # Relazione :contiene dalla lettera al numero
                            await self.falkordb.query(
                                """
                                MATCH (let:Lettera {URN: $let_urn})
                                MATCH (num:Numero {URN: $num_urn})
                                MERGE (let)-[r:contiene]->(num)
                                ON CREATE SET r.certezza = 1.0, r.ordinamento = $ord
                                """,
                                {"let_urn": first_lettera_urn, "num_urn": numero_urn, "ord": int(numero)}
                            )

                        # Usa il primo numero come source
                        source_urn = f"{first_lettera_urn}-num{parsed_disp['numeri'][0]}"

        # ========================================
        # 6. Create RELAZIONE DI MODIFICA
        # ========================================
        # La relazione parte dal nodo più specifico (numero > lettera > comma > articolo > atto)
        relation_type = RELATION_TYPES[modifica.tipo_modifica]

        # Determina il tipo di nodo sorgente per la query
        if "-num" in source_urn:
            source_label = "Numero"
        elif "-let" in source_urn:
            source_label = "Lettera"
        elif "-com" in source_urn:
            source_label = "Comma"
        else:
            source_label = "Norma"

        query = f"""
            MATCH (src:{source_label} {{URN: $src_urn}})
            MATCH (target:Norma {{URN: $target_urn}})
            MERGE (src)-[r:{relation_type}]->(target)
            ON CREATE SET
                r.disposizione = $disposizione,
                r.data_efficacia = $data_eff,
                r.data_pubblicazione_gu = $data_gu,
                r.certezza = 1.0,
                r.fonte = 'Normattiva',
                r.fonte_relazione = $estremi,
                r.data_decorrenza = $data_eff
        """

        await self.falkordb.query(
            query,
            {
                "src_urn": source_urn,
                "target_urn": target_article_urn,
                "disposizione": modifica.disposizione,
                "data_eff": modifica.data_efficacia,
                "data_gu": modifica.data_pubblicazione_gu,
                "estremi": modifica.atto_modificante_estremi,
            }
        )

        relation_desc = f"{relation_type}:{source_urn}->{target_article_urn}"
        result.relazioni_create.append(relation_desc)

        log.debug(f"Created hierarchical modification: {relation_desc}")

    async def _fetch_all_versions(
        self,
        normavisitata: NormaVisitata,
        modifiche: List[Modifica],
        result: MultivigenzaResult,
    ) -> int:
        """
        Fetch and store all historical versions of the article.

        For each modification, fetches the version as it was BEFORE
        that modification took effect.

        Returns:
            Number of versions saved
        """
        if not self.falkordb:
            return 0

        versions_saved = 0

        # Get unique dates when versions changed
        version_dates = sorted(set(m.data_efficacia for m in modifiche if m.data_efficacia))

        # Also get original version
        try:
            testo_orig, urn_orig = await self.scraper.get_original_version(normavisitata)
            await self._save_version(
                normavisitata,
                version_label="originale",
                version_date=normavisitata.norma.data,
                testo=testo_orig,
            )
            versions_saved += 1
        except Exception as e:
            result.errors.append(f"Could not fetch original version: {e}")

        # Fetch version before each modification date
        for i, date in enumerate(version_dates):
            try:
                # Get version as it was the day before this modification
                # (to capture the state before this change)
                version_label = f"v{i+1}"

                testo, urn = await self.scraper.get_version_at_date(normavisitata, date)
                await self._save_version(
                    normavisitata,
                    version_label=version_label,
                    version_date=date,
                    testo=testo,
                )
                versions_saved += 1

            except Exception as e:
                result.errors.append(f"Could not fetch version at {date}: {e}")

        return versions_saved

    async def _save_version(
        self,
        normavisitata: NormaVisitata,
        version_label: str,
        version_date: str,
        testo: str,
    ) -> None:
        """
        Save a historical version as a separate node.

        Creates a new Norma node with versioned URN and links to main article.
        """
        if not self.falkordb:
            return

        base_urn = normavisitata.urn
        versioned_urn = f"{base_urn}!vig={version_date}"

        await self.falkordb.query(
            """
            MERGE (ver:Norma {URN: $urn})
            ON CREATE SET
                ver.node_id = $urn,
                ver.tipo_documento = 'versione_storica',
                ver.versione = $label,
                ver.data_versione = $date,
                ver.testo_storico = $testo,
                ver.is_versione_vigente = false,
                ver.fonte = 'Normattiva',
                ver.created_at = $timestamp
            """,
            {
                "urn": versioned_urn,
                "label": version_label,
                "date": version_date,
                "testo": testo,
                "timestamp": self._timestamp,
            }
        )

        # Link to main article
        await self.falkordb.query(
            """
            MATCH (ver:Norma {URN: $ver_urn})
            MATCH (art:Norma {URN: $art_urn})
            MERGE (ver)-[r:versione_di]->(art)
            ON CREATE SET r.certezza = 1.0
            """,
            {"ver_urn": versioned_urn, "art_urn": base_urn}
        )

        log.debug(f"Saved version: {versioned_urn}")


async def get_article_storia(
    scraper: NormattivaScraper,
    normavisitata: NormaVisitata,
) -> StoriaArticolo:
    """
    Convenience function to get amendment history without ingestion.

    Args:
        scraper: NormattivaScraper instance
        normavisitata: Article reference

    Returns:
        StoriaArticolo with complete amendment history
    """
    modifiche = await scraper.get_amendment_history(normavisitata, filter_article=True)

    # L'articolo è abrogato SOLO se esiste una abrogazione dell'intero articolo
    numero_articolo = normavisitata.numero_articolo
    is_abrogato = any(
        m.is_article_level_abrogation(for_article=numero_articolo)
        for m in modifiche
    )

    return StoriaArticolo(
        articolo_urn=normavisitata.urn,
        versione_originale=normavisitata.norma.data,
        modifiche=modifiche,
        is_abrogato=is_abrogato,
    )
