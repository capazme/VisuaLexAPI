import structlog
import re
from typing import Tuple, Optional, Union, Dict, Any, List
from datetime import datetime

from bs4 import BeautifulSoup, NavigableString, Tag
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer

from merlt.sources.utils.norma import NormaVisitata, Modifica, TipoModifica, StoriaArticolo
from merlt.sources.base import BaseScraper
from merlt.sources.utils.urn import generate_urn
from merlt.sources.utils.text import normalize_act_type

# Configurazione del logger di modulo
log = structlog.get_logger()


# Thread-safe singleton per LLM service
import asyncio
from functools import lru_cache


@lru_cache(maxsize=1)
def _get_llm_service():
    """
    Singleton thread-safe per LLM service.

    Usa lru_cache per garantire che il service venga inizializzato una sola volta.
    """
    try:
        from merlt.rlcf.ai_service import OpenRouterService
        service = OpenRouterService()
        log.info("LLM service initialized for destinazione parsing")
        return service
    except (ImportError, Exception) as e:
        log.info(f"LLM service not available: {e.__class__.__name__}")
        return None


async def parse_destinazione_with_llm(
    content: str,
    use_llm: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Parse la destinazione di una modifica usando LLM come fallback.

    Estrae articolo, comma, lettera dalla stringa di modifica quando
    i pattern regex non funzionano (es. formati complessi, EU, internazionali).

    Args:
        content: Testo completo della modifica (es. "ha disposto l'abrogazione del comma 2...")
        use_llm: Se usare LLM come fallback (default True)

    Returns:
        Dict con target_article, comma, lettera, destinazione normalizzata, o None
    """
    if not use_llm:
        return None

    # Thread-safe singleton
    llm_service = _get_llm_service()

    # If service is not available, return silently
    if llm_service is None:
        return None

    prompt = f"""Estrai la destinazione di questa modifica normativa italiana.

Testo: "{content}"

Devi identificare COSA viene modificato/abrogato/inserito (non da chi).

Esempi:
- "l'abrogazione del comma 2 dell'art. 3-bis" -> articolo="3-bis", comma="2"
- "la modifica dell'art. 1, comma 1, lettera a)" -> articolo="1", comma="1", lettera="a"
- "l'abrogazione dell'art. 5" -> articolo="5"

Se non riesci a identificare, usa null."""

    # JSON Schema per structured output
    json_schema = {
        "type": "object",
        "properties": {
            "articolo": {
                "type": ["string", "null"],
                "description": "Numero articolo (es. '2', '2-bis') o null"
            },
            "comma": {
                "type": ["string", "null"],
                "description": "Numero comma (es. '1', '1-bis') o null"
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

        # Usa generate_json_completion con structured output
        result = await llm_service.generate_json_completion(
            prompt=prompt,
            json_schema=json_schema,
            system_prompt="Sei un parser di testi normativi italiani. Converti ordinali in numeri (primo=1, secondo=2).",
            model=model,
            temperature=0.0,
            max_tokens=150,
        )

        # Build normalized destinazione string
        if not result.get("articolo"):
            return None

        destinazione = f"art. {result['articolo']}"
        if result.get("comma"):
            destinazione += f", comma {result['comma']}"
        if result.get("lettera"):
            destinazione += f", lettera {result['lettera']}"
        if result.get("numero"):
            destinazione += f", numero {result['numero']}"

        return {
            "target_article": result["articolo"],
            "comma": result.get("comma"),
            "lettera": result.get("lettera"),
            "numero": result.get("numero"),
            "destinazione": destinazione,
        }

    except Exception as e:
        log.warning(f"LLM parsing failed: {e}")
        return None


async def parse_destinazioni_batch_with_llm(
    contents: List[str],
    use_llm: bool = True,
) -> List[Optional[Dict[str, Any]]]:
    """
    Parse multiple destinazioni in un'unica chiamata LLM (batch).

    Molto più efficiente di chiamare parse_destinazione_with_llm N volte.
    Invia tutti i testi in un singolo prompt e riceve un array di risultati.

    Args:
        contents: Lista di testi da parsare
        use_llm: Se usare LLM (default True)

    Returns:
        Lista di Dict (stesso ordine dell'input), None per entries non parsabili
    """
    if not use_llm or not contents:
        return [None] * len(contents)

    llm_service = _get_llm_service()
    if llm_service is None:
        return [None] * len(contents)

    # Costruisci prompt batch con tutti i testi numerati
    numbered_entries = "\n".join(
        f"{i+1}. \"{content}\""
        for i, content in enumerate(contents)
    )

    prompt = f"""Estrai le destinazioni da queste {len(contents)} modifiche normative italiane.

{numbered_entries}

Per ogni entry, identifica COSA viene modificato/abrogato/inserito.
Se non riesci a identificare l'articolo, usa null per quel campo.

FORMATO RISPOSTA OBBLIGATORIO:
{{"results": [{{"articolo": "...", "comma": "...", "lettera": null, "numero": null}}, ...]}}

Deve contenere esattamente {len(contents)} oggetti nell'array "results", uno per ogni entry."""

    # Schema per array di risultati
    json_schema = {
        "type": "object",
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "articolo": {"type": ["string", "null"]},
                        "comma": {"type": ["string", "null"]},
                        "lettera": {"type": ["string", "null"]},
                        "numero": {"type": ["string", "null"]}
                    }
                }
            }
        }
    }

    try:
        import os
        model = os.getenv("LLM_PARSING_MODEL", "openai/gpt-4o-mini")

        result = await llm_service.generate_json_completion(
            prompt=prompt,
            json_schema=json_schema,
            system_prompt="Sei un parser di testi normativi italiani. Converti ordinali in numeri.",
            model=model,
            temperature=0.0,
            max_tokens=2000,  # Più tokens per batch
            timeout=60  # Timeout più lungo per batch
        )

        results_array = result.get("results", [])

        # Normalizza risultati
        parsed_results = []
        for i, content in enumerate(contents):
            if i < len(results_array):
                r = results_array[i]
                if r and r.get("articolo"):
                    destinazione = f"art. {r['articolo']}"
                    if r.get("comma"):
                        destinazione += f", comma {r['comma']}"
                    if r.get("lettera"):
                        destinazione += f", lettera {r['lettera']}"
                    if r.get("numero"):
                        destinazione += f", numero {r['numero']}"

                    parsed_results.append({
                        "target_article": r["articolo"],
                        "comma": r.get("comma"),
                        "lettera": r.get("lettera"),
                        "numero": r.get("numero"),
                        "destinazione": destinazione,
                    })
                else:
                    parsed_results.append(None)
            else:
                parsed_results.append(None)

        log.info(f"Batch LLM parsed {sum(1 for r in parsed_results if r)} of {len(contents)} entries")
        return parsed_results

    except Exception as e:
        log.warning(f"Batch LLM parsing failed: {e}")
        return [None] * len(contents)


class NormattivaScraper(BaseScraper):
    """
    Scraper per Normattiva.it - testi ufficiali delle leggi italiane.

    Fornisce accesso a:
    - Testo vigente degli articoli
    - Storia delle modifiche (multivigenza)
    - Versioni storiche (a una data specifica)

    Example:
        >>> from merlt.sources import NormattivaScraper
        >>> from merlt.sources.utils.norma import Norma, NormaVisitata
        >>>
        >>> scraper = NormattivaScraper()
        >>> norma = Norma(tipo_atto="codice civile")
        >>> nv = NormaVisitata(norma=norma, numero_articolo="1")
        >>> text, urn = await scraper.get_document(nv)
    """

    def __init__(self, config: Optional["ScraperConfig"] = None) -> None:
        """
        Inizializza NormattivaScraper.

        Args:
            config: Configurazione opzionale (timeout, retry, etc.)
        """
        # Import locale per evitare import circolari
        from merlt.sources.base import ScraperConfig
        super().__init__(config or ScraperConfig())

        self.base_url: str = "https://www.normattiva.it/"
        log.info("NormattivaScraper initialized", timeout=self.config.timeout)

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def get_document(self, normavisitata: NormaVisitata) -> Tuple[str, str]:
        log.info(f"Fetching Normattiva document for: {normavisitata}")
        urn: str = normavisitata.urn
        log.info(f"Requesting URL: {urn}")

        html_content: str = await self.request_document(urn)
        if not html_content:
            log.error("Document not found or malformed")
            raise ValueError("Document not found or malformed")

        if normavisitata.numero_articolo:
            document_text = await self.estrai_da_html(html_content)
            return document_text, urn
        else:
            log.info("Returning full document text")
            return html_content, urn

    async def estrai_da_html(
        self, atto: str, comma: Optional[str] = None, get_link_dict: bool = False
    ) -> Union[str, Dict[str, Any]]:
        try:
            soup: BeautifulSoup = self.parse_document(atto)
            corpo: Optional[Tag] = soup.find('div', class_='bodyTesto')
            if corpo is None:
                log.warning("Body of the document not found")
                return "Body of the document not found"

            if corpo.find(class_='art-comma-div-akn'):
                # SCENARIO 1: Formattazione AKN Dettagliata
                return self._estrai_testo_akn_dettagliato(corpo, link=get_link_dict)
            elif corpo.find(class_='art-just-text-akn'):
                # SCENARIO 2: Formattazione Semplice con `akn-just-text`
                return self._estrai_testo_akn_semplice(corpo, link=get_link_dict)
            elif corpo.find(class_='attachment-just-text'):
                # SCENARIO 3: Allegato o Testo senza Formattazione AKN
                return self._estrai_testo_allegato(corpo, link=get_link_dict)
            else:
                log.warning("Unknown formatting structure")
                return "Unknown formatting structure"
        except Exception as e:
            log.error(f"Generic error: {e}", exc_info=True)
            return f"Generic error: {e}"

    def extract_text_recursive(
        self, element: Tag, link: bool = False, link_dict: Optional[Dict[str, str]] = None
    ) -> Tuple[str, Dict[str, str]]:
        if link_dict is None:
            link_dict = {}
        text_parts = []

        for child in element.children:
            if isinstance(child, NavigableString):
                text_parts.append(str(child))
            elif isinstance(child, Tag):
                if child.name == 'br':
                    text_parts.append('\n')
                elif child.name == 'p':
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(inner_text + '\n')
                elif child.name == 'li':
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(' - ' + inner_text + '\n')
                elif child.name == 'a':
                    link_text = ''.join(child.stripped_strings)
                    link_url = child.get('href', '').strip()
                    if link:
                        link_dict[link_text] = link_url
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(inner_text)
                else:
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(inner_text)
        return ''.join(text_parts), link_dict

    def _estrai_testo_akn_dettagliato(self, corpo: Tag, link: bool = False) -> Union[str, Dict[str, Any]]:
        try:
            link_dict: Dict[str, str] = {}

            # Estrazione del numero e del titolo dell'articolo
            article_number_tag = corpo.find('h2', class_='article-num-akn')
            article_title_tag = corpo.find('div', class_='article-heading-akn')
            article_number = article_number_tag.get_text(strip=True) if article_number_tag else "Articolo non trovato"
            article_title = article_title_tag.get_text(strip=True) if article_title_tag else ""

            # Composizione del testo iniziale
            final_text = f"{article_number}\n{article_title}\n\n"

            # Estrazione dei commi
            commi = corpo.find_all('div', class_='art-comma-div-akn')
            for comma_div in commi:
                comma_text, _ = self.extract_text_recursive(comma_div, link=link, link_dict=link_dict)
                final_text += comma_text.strip() + '\n\n'

            # Pulizia finale del testo
            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text
        except Exception as e:
            log.error(f"Error in _estrai_testo_akn_dettagliato: {e}", exc_info=True)
            return f"Error in _estrai_testo_akn_dettagliato: {e}"

    def _estrai_testo_akn_semplice(self, corpo: Tag, link: bool = False) -> Union[str, Dict[str, Any]]:
        try:
            link_dict: Dict[str, str] = {}

            # Estrazione del numero e del titolo dell'articolo
            article_number_tag = corpo.find('h2', class_='article-num-akn')
            article_title_tag = corpo.find('div', class_='article-heading-akn')
            article_number = article_number_tag.get_text(strip=True) if article_number_tag else ""
            article_title = article_title_tag.get_text(strip=True) if article_title_tag else ""

            final_text = f"{article_number}\n{article_title}\n\n"

            # Estrazione del contenuto del testo semplice
            just_text = corpo.find('span', class_='art-just-text-akn')
            if just_text:
                content_text, _ = self.extract_text_recursive(just_text, link=link, link_dict=link_dict)
                final_text += content_text.strip()

            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text
        except Exception as e:
            log.error(f"Error in _estrai_testo_akn_semplice: {e}", exc_info=True)
            return f"Error in _estrai_testo_akn_semplice: {e}"

    def _estrai_testo_allegato(self, corpo: Tag, link: bool = False) -> Union[str, Dict[str, Any]]:
        try:
            link_dict: Dict[str, str] = {}

            # Estrazione del contenuto dell'allegato
            attachment_text = corpo.find('span', class_='attachment-just-text')
            final_text = ""
            if attachment_text:
                content_text, _ = self.extract_text_recursive(attachment_text, link=link, link_dict=link_dict)
                final_text += content_text.strip()

            # Estrazione degli aggiornamenti (se presenti)
            aggiornamenti = corpo.find_all('div', class_='art_aggiornamento-akn')
            for aggiornamento in aggiornamenti:
                agg_text, _ = self.extract_text_recursive(aggiornamento, link=link, link_dict=link_dict)
                final_text += '\n\n' + agg_text.strip()

            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text
        except Exception as e:
            log.error(f"Error in _estrai_testo_allegato: {e}", exc_info=True)
            return f"Error in _estrai_testo_allegato: {e}"

    def parse_document(self, atto: str) -> BeautifulSoup:
        return BeautifulSoup(atto, 'html.parser')

    async def get_amendment_history(
        self, normavisitata: NormaVisitata, filter_article: bool = True
    ) -> List[Modifica]:
        """
        Recupera la storia delle modifiche di un atto/articolo da Normattiva.

        Chiama l'endpoint /do/atto/vediAggiornamentiAllAtto per ottenere
        tutte le modifiche legislative all'atto, poi filtra per articolo
        se richiesto.

        Args:
            normavisitata: NormaVisitata con riferimento all'articolo
            filter_article: Se True, filtra solo modifiche all'articolo specifico

        Returns:
            Lista di oggetti Modifica in ordine cronologico

        Example:
            scraper = NormattivaScraper()
            nv = NormaVisitata.from_dict({
                'tipo_atto': 'legge',
                'data': '1990-08-07',
                'numero_atto': '241',
                'numero_articolo': '2'
            })
            modifiche = await scraper.get_amendment_history(nv)
        """
        log.info(f"Fetching amendment history for: {normavisitata}")

        # 1. Prima carico la pagina articolo per stabilire sessione e estrarre parametri
        from .utils.http import http_client
        session = await http_client.get_session()

        try:
            urn = normavisitata.urn
            async with session.get(urn, timeout=30) as resp:
                html = await resp.text()

            soup = self.parse_document(html)

            # Estrai parametri dal pulsante aggiornamenti
            btn = soup.find(id='aggiornamenti_atto_button')
            if not btn:
                log.warning("Pulsante aggiornamenti_atto_button non trovato")
                return []

            data_href = btn.get('data-href', '')
            if not data_href:
                log.warning("data-href non trovato nel pulsante")
                return []

            # 2. Chiamo endpoint modifiche
            modifiche_url = self.base_url.rstrip('/') + data_href
            log.debug(f"Fetching amendments from: {modifiche_url}")

            async with session.get(modifiche_url, timeout=30) as resp:
                html_mod = await resp.text()

            if 'Sessione Scaduta' in html_mod:
                log.error("Sessione Normattiva scaduta")
                return []

            # 3. Parsa la tabella modifiche (prima con regex)
            modifiche, failed_contents = self._parse_amendments_table_with_failures(
                html_mod, normavisitata, filter_article
            )

            # 4. Se ci sono fallimenti e use_llm=True, prova con LLM (batch per efficienza)
            if failed_contents:
                log.info(f"Regex failed for {len(failed_contents)} entries, trying LLM batch fallback")
                try:
                    # Estrai tutti i contenuti per batch processing
                    contents_to_parse = [f["content"] for f in failed_contents]

                    # Una singola chiamata LLM per tutti i contenuti
                    llm_results = await parse_destinazioni_batch_with_llm(
                        contents_to_parse, use_llm=True
                    )

                    # Processa i risultati
                    for failed, llm_result in zip(failed_contents, llm_results):
                        if llm_result and llm_result.get("target_article"):
                            mod = Modifica(
                                tipo_modifica=failed["tipo"],
                                atto_modificante_urn=failed["act_info"].get("urn", "") if failed["act_info"] else "",
                                atto_modificante_estremi=failed["act_info"].get("estremi", "") if failed["act_info"] else "",
                                disposizione=failed.get("disposizione"),
                                destinazione=llm_result["destinazione"],
                                data_efficacia=failed["date"] or "",
                                data_pubblicazione_gu=failed["date"],
                            )

                            # Applica filtro articolo se necessario
                            if filter_article and normavisitata.numero_articolo:
                                target_art = llm_result["target_article"].lower()
                                nv_art = normavisitata.numero_articolo.lower()
                                nv_base = re.match(r'^(\d+)', nv_art)
                                target_base = re.match(r'^(\d+)', target_art)
                                if nv_base and target_base and nv_base.group(1) == target_base.group(1):
                                    if '-' not in nv_art or nv_art == target_art:
                                        modifiche.append(mod)
                            else:
                                modifiche.append(mod)
                except Exception as e:
                    log.warning(f"LLM batch fallback failed: {e}")

            # Riordina per data
            modifiche.sort(key=lambda m: m.data_efficacia)

            log.info(f"Found {len(modifiche)} amendments for {normavisitata}")
            return modifiche

        except Exception as e:
            log.error(f"Error fetching amendment history: {e}", exc_info=True)
            return []

    def _parse_amendments_table_with_failures(
        self, html: str, normavisitata: NormaVisitata, filter_article: bool
    ) -> Tuple[List[Modifica], List[Dict]]:
        """
        Parsa la tabella HTML e restituisce sia successi che fallimenti per LLM retry.
        """
        soup = self.parse_document(html)
        table = soup.find('table')

        if not table:
            log.warning("Tabella modifiche non trovata")
            return [], []

        rows = table.find_all('tr')
        modifiche: List[Modifica] = []
        failed: List[Dict] = []

        current_act_info = None
        current_date = None

        for row in rows[1:]:
            cols = row.find_all('td')
            if len(cols) < 3:
                continue

            prog = cols[0].get_text(strip=True)
            date_str = cols[1].get_text(strip=True)
            content = cols[2].get_text(strip=True)

            if prog:
                current_act_info = self._extract_act_info(cols[2])
                current_date = self._parse_date_gg_mm_yyyy(date_str)

            if 'ha disposto' in content.lower():
                mod = self._parse_modification_detail(
                    content, current_act_info, current_date, normavisitata, filter_article
                )
                if mod:
                    modifiche.append(mod)
                else:
                    # Salva per retry con LLM
                    tipo_pattern = r"(la modifica|l'abrogazione|l'introduzione|la sostituzione)"
                    tipo_match = re.search(tipo_pattern, content.lower())
                    if tipo_match:
                        tipo_map = {
                            'la modifica': TipoModifica.MODIFICA,
                            "l'abrogazione": TipoModifica.ABROGA,
                            "l'introduzione": TipoModifica.INSERISCE,
                            'la sostituzione': TipoModifica.SOSTITUISCE,
                        }
                        failed.append({
                            "content": content,
                            "act_info": current_act_info,
                            "date": current_date,
                            "tipo": tipo_map.get(tipo_match.group(1), TipoModifica.MODIFICA),
                            "disposizione": None,
                        })

        modifiche.sort(key=lambda m: m.data_efficacia)
        return modifiche, failed

    def _parse_amendments_table(
        self, html: str, normavisitata: NormaVisitata, filter_article: bool
    ) -> List[Modifica]:
        """
        Parsa la tabella HTML delle modifiche da Normattiva.

        Struttura tabella:
        - Righe con numero progressivo (Col 0 non vuoto) = atto modificante
        - Righe senza numero (Col 0 vuoto) = dettaglio modifica

        Args:
            html: HTML della pagina modifiche
            normavisitata: Riferimento articolo per filtraggio
            filter_article: Se filtrare per articolo specifico

        Returns:
            Lista Modifica ordinata cronologicamente
        """
        soup = self.parse_document(html)
        table = soup.find('table')

        if not table:
            log.warning("Tabella modifiche non trovata")
            return []

        rows = table.find_all('tr')
        modifiche: List[Modifica] = []

        # Stato corrente durante parsing
        current_act_info = None  # Info atto modificante corrente
        current_date = None  # Data GU corrente

        for row in rows[1:]:  # Skip header
            cols = row.find_all('td')
            if len(cols) < 3:
                continue

            prog = cols[0].get_text(strip=True)
            date_str = cols[1].get_text(strip=True)
            content = cols[2].get_text(strip=True)

            # Se c'è numero progressivo, è una nuova entry (atto modificante)
            if prog:
                current_act_info = self._extract_act_info(cols[2])
                current_date = self._parse_date_gg_mm_yyyy(date_str)

            # Estrai dettagli modifica dal contenuto
            if 'ha disposto' in content.lower():
                mod = self._parse_modification_detail(
                    content, current_act_info, current_date, normavisitata, filter_article
                )
                if mod:
                    modifiche.append(mod)

        # Ordina per data efficacia
        modifiche.sort(key=lambda m: m.data_efficacia)
        return modifiche

    def _extract_act_info(self, cell: Tag) -> Optional[Dict[str, str]]:
        """
        Estrae informazioni sull'atto modificante dalla cella.

        Returns:
            Dict con 'estremi', 'urn', 'link' oppure None
        """
        try:
            # Trova il link all'atto
            link = cell.find('a')
            href = link.get('href', '') if link else ''

            # Estrai testo completo
            text = cell.get_text(strip=True)

            # Pattern per estrarre estremi: "La LEGGE 15 maggio 1997, n. 127"
            # o "Il DECRETO DEL PRESIDENTE DELLA REPUBBLICA 26 aprile 1992, n. 300"
            pattern = r'(?:La|Il|Lo)\s+([A-Z\s\-]+)\s+(\d{1,2}\s+\w+\s+\d{4}),?\s+n\.\s*(\d+)'
            match = re.search(pattern, text)

            if match:
                tipo_atto = match.group(1).strip()
                data_atto = match.group(2).strip()
                numero = match.group(3).strip()

                # Genera URN
                try:
                    tipo_urn = normalize_act_type(tipo_atto)
                    data_parsed = self._parse_date_italiano(data_atto)
                    urn = generate_urn(
                        act_type=tipo_urn,
                        date=data_parsed,
                        act_number=numero
                    )
                except Exception as e:
                    log.debug(f"Could not generate URN for {tipo_atto} {data_atto} n.{numero}: {e}")
                    urn = None

                return {
                    'estremi': f"{tipo_atto} {data_atto}, n. {numero}",
                    'urn': urn,
                    'link': href,
                    'tipo_atto': tipo_atto,
                    'data': data_parsed if 'data_parsed' in dir() else None,
                    'numero': numero,
                }

            return None

        except Exception as e:
            log.debug(f"Error extracting act info: {e}")
            return None

    def _parse_modification_detail(
        self,
        content: str,
        act_info: Optional[Dict],
        date: Optional[str],
        normavisitata: NormaVisitata,
        filter_article: bool
    ) -> Optional[Modifica]:
        """
        Parsa il dettaglio di una singola modifica.

        Pattern riconosciuti:
        - "ha disposto (con l'art. X, comma Y) la modifica dell'art. Z"
        - "ha disposto (con l'art. X) l'abrogazione dell'art. Z"
        - "ha disposto (con l'art. X) l'introduzione dell'art. Z-bis"
        - "ha disposto (con l'art. X) la sostituzione dell'art. Z"

        Args:
            content: Testo della modifica
            act_info: Info atto modificante
            date: Data pubblicazione GU
            normavisitata: Riferimento articolo target
            filter_article: Se filtrare per articolo

        Returns:
            Modifica se parsata correttamente, None altrimenti
        """
        if not act_info:
            return None

        # Pattern per tipo modifica
        tipo_pattern = r"(la modifica|l'abrogazione|l'introduzione|la sostituzione)"
        tipo_match = re.search(tipo_pattern, content.lower())

        if not tipo_match:
            return None

        tipo_str = tipo_match.group(1)
        tipo_map = {
            'la modifica': TipoModifica.MODIFICA,
            "l'abrogazione": TipoModifica.ABROGA,
            "l'introduzione": TipoModifica.INSERISCE,
            'la sostituzione': TipoModifica.SOSTITUISCE,
        }
        tipo = tipo_map.get(tipo_str, TipoModifica.MODIFICA)

        # Pattern per articolo target - supporta due formati:
        # 1. "dell'art. 2, comma 1" (articolo prima)
        # 2. "del comma 1 dell'art. 2" (comma prima)
        content_lower = content.lower()

        # Prima estrai l'articolo
        art_pattern = r"dell'art\.\s*(\d+(?:-\w+)?)"
        art_match = re.search(art_pattern, content_lower)

        if not art_match:
            return None

        target_article = art_match.group(1)

        # Poi cerca comma/lettera nei due formati possibili
        comma_num = None
        lettera = None

        # Formato 1: "dell'art. X, comma Y" o "dell'art. X, comma Y, lettera Z"
        comma_after = re.search(r"dell'art\.\s*\d+(?:-\w+)?\s*,\s*comma\s*(\d+(?:-\w+)?)", content_lower)
        if comma_after:
            comma_num = comma_after.group(1)
            # Cerca lettera dopo
            lettera_match = re.search(r"comma\s*\d+(?:-\w+)?\s*,\s*lettera\s*(\w+)", content_lower)
            if lettera_match:
                lettera = lettera_match.group(1)

        # Formato 2: "del comma Y dell'art. X" o "della lettera Z del comma Y dell'art. X"
        if not comma_num:
            comma_before = re.search(r"del\s+comma\s*(\d+(?:-\w+)?)\s+dell'art", content_lower)
            if comma_before:
                comma_num = comma_before.group(1)

        if not lettera:
            lettera_before = re.search(r"della\s+lettera\s*(\w+)\s+del\s+comma", content_lower)
            if lettera_before:
                lettera = lettera_before.group(1)

        # Costruisci la destinazione normalizzata: "art. X, comma Y, lettera Z"
        destinazione = f"art. {target_article}"
        if comma_num:
            destinazione += f", comma {comma_num}"
        if lettera:
            destinazione += f", lettera {lettera}"

        # Filtro per articolo se richiesto
        if filter_article and normavisitata.numero_articolo:
            nv_art = normavisitata.numero_articolo.lower()
            target_art = target_article.lower()

            # Estrai la parte numerica base (es. "14" da "14-quater", "2" da "2-bis")
            nv_base_match = re.match(r'^(\d+)', nv_art)
            target_base_match = re.match(r'^(\d+)', target_art)

            if not nv_base_match or not target_base_match:
                return None

            nv_base = nv_base_match.group(1)
            target_base = target_base_match.group(1)

            # I numeri base devono essere uguali
            if nv_base != target_base:
                return None

            # Se l'articolo richiesto è base (es. "1"), accetta anche i bis/ter/etc
            # Se l'articolo richiesto è specifico (es. "1-bis"), deve matchare esattamente
            if '-' in nv_art:
                # Richiesto articolo specifico (es. 2-bis): deve matchare esatto
                if nv_art != target_art:
                    return None

        # Estrai disposizione (art. e comma dell'atto modificante)
        disp_pattern = r"\(con l'art\.\s*([^)]+)\)"
        disp_match = re.search(disp_pattern, content)
        disposizione = f"art. {disp_match.group(1)}" if disp_match else None

        return Modifica(
            tipo_modifica=tipo,
            atto_modificante_urn=act_info.get('urn', ''),
            atto_modificante_estremi=act_info.get('estremi', ''),
            disposizione=disposizione,
            destinazione=destinazione,  # Cosa viene modificato (art. X o art. X, comma Y)
            data_efficacia=date or '',
            data_pubblicazione_gu=date,
            note=None,
        )

    def _parse_date_gg_mm_yyyy(self, date_str: str) -> Optional[str]:
        """
        Converte data da formato GG/MM/YYYY a YYYY-MM-DD.

        Args:
            date_str: Data in formato "27/05/1992"

        Returns:
            Data in formato "1992-05-27" o None
        """
        try:
            parts = date_str.strip().split('/')
            if len(parts) == 3:
                return f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
        except Exception:
            pass
        return None

    def _parse_date_italiano(self, date_str: str) -> Optional[str]:
        """
        Converte data da formato italiano a YYYY-MM-DD.

        Args:
            date_str: Data in formato "15 maggio 1997"

        Returns:
            Data in formato "1997-05-15" o None
        """
        mesi = {
            'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04',
            'maggio': '05', 'giugno': '06', 'luglio': '07', 'agosto': '08',
            'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12'
        }

        try:
            parts = date_str.lower().strip().split()
            if len(parts) >= 3:
                giorno = parts[0].zfill(2)
                mese = mesi.get(parts[1], '01')
                anno = parts[2]
                return f"{anno}-{mese}-{giorno}"
        except Exception:
            pass
        return None

    async def get_version_at_date(
        self, normavisitata: NormaVisitata, version_date: str
    ) -> Tuple[str, str]:
        """
        Recupera il testo di un articolo come era vigente a una data specifica.

        Usa il parametro !vig=YYYY-MM-DD dell'URN Normattiva per ottenere
        versioni storiche del testo.

        Args:
            normavisitata: NormaVisitata base
            version_date: Data in formato YYYY-MM-DD

        Returns:
            Tuple (testo_articolo, urn_versione)

        Example:
            scraper = NormattivaScraper()
            nv = NormaVisitata.from_dict({...})
            testo, urn = await scraper.get_version_at_date(nv, "2005-01-01")
        """
        log.info(f"Fetching version at {version_date} for: {normavisitata}")

        # Genera URN con parametro versione
        # Formato: urn:nir:stato:legge:1990-08-07;241~art2!vig=2005-01-01
        base_urn = normavisitata.urn

        # Rimuovi eventuali parametri esistenti
        if '!' in base_urn:
            base_urn = base_urn.split('!')[0]

        versioned_urn = f"{base_urn}!vig={version_date}"

        log.debug(f"Versioned URN: {versioned_urn}")

        try:
            html_content = await self.request_document(versioned_urn)

            if not html_content:
                log.error(f"Document not found for version {version_date}")
                raise ValueError(f"Version at {version_date} not found")

            # Estrai testo
            document_text = await self.estrai_da_html(html_content)
            return document_text, versioned_urn

        except Exception as e:
            log.error(f"Error fetching version at {version_date}: {e}", exc_info=True)
            raise

    async def get_original_version(self, normavisitata: NormaVisitata) -> Tuple[str, str]:
        """
        Recupera il testo originale di un articolo (come pubblicato in GU).

        Usa il parametro @originale dell'URN Normattiva.

        Args:
            normavisitata: NormaVisitata

        Returns:
            Tuple (testo_originale, urn_originale)
        """
        log.info(f"Fetching original version for: {normavisitata}")

        base_urn = normavisitata.urn
        if '!' in base_urn or '@' in base_urn:
            base_urn = re.split(r'[!@]', base_urn)[0]

        original_urn = f"{base_urn}@originale"

        log.debug(f"Original URN: {original_urn}")

        try:
            html_content = await self.request_document(original_urn)

            if not html_content:
                log.error("Original version not found")
                raise ValueError("Original version not found")

            document_text = await self.estrai_da_html(html_content)
            return document_text, original_urn

        except Exception as e:
            log.error(f"Error fetching original version: {e}", exc_info=True)
            raise
