import asyncio
import os
import logging
import sys
import json
import re
from collections import defaultdict
from time import time

from quart import Quart, request, jsonify, send_file, Response, g
from quart_cors import cors
import structlog

from visualex_api.tools.config import (
    RATE_LIMIT,
    RATE_LIMIT_WINDOW,
    FETCH_QUEUE_WORKERS,
    FETCH_QUEUE_DELAY,
)
from visualex_api.tools.history_manager import history_manager
from visualex_api.tools.dossier_manager import dossier_manager
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.services.brocardi_scraper import BrocardiScraper
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.services.pdfextractor import extract_pdf, cleanup_browser_pool, is_allowed_pdf_urn
from visualex_api.services.akn_parser import normalize_article_key
from types import SimpleNamespace

from visualex_api.services.akn_fetch import fetch_act_index
from visualex_api.tools.urngenerator import complete_date_or_parse_async, urn_to_filename
from visualex_api.tools.treextractor import get_tree
from visualex_api.tools.text_op import format_date_to_extended, parse_article_input, normalize_act_type
from visualex_api.tools.map import codice_urn, extract_codice_details
from visualex_api.tools.nl_parser import parse_nl_query
from visualex_api.tools.alias_resolver import resolve_alias
from visualex_api.tools.citation_linker import extract_citations as extract_citations_from_text
from visualex_api.tools.exceptions import (
    ValidationError,
    ResourceNotFoundError,
    RateLimitExceededError,
)

# Configurazione del logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(message)s",
    stream=sys.stdout,
)

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.dev.ConsoleRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)
log = structlog.get_logger()

# Funzione per il conteggio dei token (numero di parole) in modo ricorsivo
def count_tokens(data):
    if isinstance(data, str):
        return len(data.split())
    elif isinstance(data, dict):
        return sum(count_tokens(v) for v in data.values())
    elif isinstance(data, list):
        return sum(count_tokens(item) for item in data)
    else:
        return 0

# Storage per il rate limiting
request_counts = defaultdict(lambda: {'count': 0, 'time': time()})

# CORS allowed origins: comma-separated list via env var, falling back to the
# current dev defaults (Node BFF on :3001 + Vite frontend on :5173).
_default_allowed_origins = ["http://localhost:3001", "http://localhost:5173"]
_allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
if _allowed_origins_env:
    ALLOWED_ORIGINS = [origin.strip() for origin in _allowed_origins_env.split(",") if origin.strip()]
else:
    ALLOWED_ORIGINS = _default_allowed_origins


def add_to_history(data: dict):
    """Aggiunge ricerca alla history con persistenza."""
    if history_manager.add(data):
        log.debug("Added to history", data=data)


# Inizializzazione degli scraper
brocardi_scraper = BrocardiScraper()
normattiva_scraper = NormattivaScraper()
eurlex_scraper = EurlexScraper()


class RateLimitedTaskQueue:
    def __init__(self, workers: int, spacing: float) -> None:
        self.workers = workers
        self.spacing = spacing
        self._queue: asyncio.Queue = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []
        self._started = False

    async def start(self) -> None:
        if self._started:
            return
        self._started = True
        loop = asyncio.get_running_loop()
        for _ in range(self.workers):
            self._tasks.append(loop.create_task(self._worker()))

    async def stop(self) -> None:
        if not self._started:
            return
        for _ in self._tasks:
            await self._queue.put(None)
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        self._started = False

    async def submit(self, coro_func, *args, **kwargs):
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        position = self._queue.qsize()
        await self._queue.put((coro_func, args, kwargs, future))
        return position, future

    def size(self) -> int:
        return self._queue.qsize()

    async def _worker(self):
        while True:
            job = await self._queue.get()
            if job is None:
                self._queue.task_done()
                break
            coro_func, args, kwargs, future = job
            try:
                result = await coro_func(*args, **kwargs)
                if not future.done():
                    
                    future.set_result(result)
            except Exception as exc:
                if not future.done():
                    future.set_exception(exc)
            finally:
                self._queue.task_done()
                if self.spacing:
                    await asyncio.sleep(self.spacing)


class NormaController:
    def __init__(self):
        self.app = Quart(__name__)
        self.app = cors(self.app, allow_origin=ALLOWED_ORIGINS)
        self.fetch_queue = RateLimitedTaskQueue(FETCH_QUEUE_WORKERS, FETCH_QUEUE_DELAY)
        
        # Middleware per registrare il tempo di inizio della richiesta
        self.app.before_request(self.record_start_time)
        # Middleware per il rate limiting
        self.app.before_request(self.rate_limit_middleware)
        
        # Middleware per loggare statistiche (tempo e token) dopo ogni richiesta
        self.app.after_request(self.log_query_stats)

        # Servizi di background
        self.app.before_serving(self.start_background_services)
        self.app.after_serving(self.stop_background_services)

        # Definizione degli endpoint
        self.setup_routes()

    async def start_background_services(self):
        await self.fetch_queue.start()
        log.info("Background services started")

    async def stop_background_services(self):
        await self.fetch_queue.stop()
        await cleanup_browser_pool()
        log.info("Background services stopped and browser pool cleaned up")


    async def stream_article_text(self):
        """
        Endpoint che invia in streaming i risultati della ricerca degli articoli.
        I risultati vengono inviati man mano che vengono trovati.
        Supporta anche info Brocardi in parallelo.
        """
        data = await request.get_json()
        log.info("Received data for stream_article_text", data=data)
        add_to_history(data)
        # This is the endpoint the search box actually calls. Nothing caught the
        # exceptions raised while building the NormaVisitata list, so a rejected
        # article ("non presente in ...") or a missing act_type reached Quart's
        # default handler and became a 500 HTML page: no JSON, no message, and
        # not the NDJSON the frontend parses.
        try:
            normavisitate = await self.create_norma_visitata_from_data(data)
        except Exception as exc:
            return self._error_response(exc, 'stream_article_text')
        show_brocardi = data.get('show_brocardi_info', False)
        log.info("NormaVisitata instances created", normavisitate=[nv.to_dict() for nv in normavisitate])

        async def result_generator():
            for nv in normavisitate:
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    result = {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}
                    yield json.dumps(result) + "\n"
                    continue

                try:
                    # Fetch article text and Brocardi info in parallel if requested
                    tasks = [scraper.get_document(nv)]
                    if show_brocardi and isinstance(scraper, NormattivaScraper):
                        tasks.append(brocardi_scraper.get_info(nv))

                    results = await asyncio.gather(*tasks, return_exceptions=True)

                    # Process article text
                    if isinstance(results[0], Exception):
                        result = {'error': str(results[0]), 'norma_data': nv.to_dict()}
                    else:
                        article_text, url = results[0]
                        result = {
                            'article_text': article_text,
                            'norma_data': nv.to_dict(),
                            'url': url
                        }

                        # Add Brocardi info if available
                        if show_brocardi and len(results) > 1:
                            if isinstance(results[1], Exception):
                                result['brocardi_error'] = str(results[1])
                            else:
                                brocardi_info = results[1]
                                result['brocardi_info'] = {
                                    'position': brocardi_info[0] if brocardi_info[0] else None,
                                    'link': brocardi_info[2],
                                    'Brocardi': brocardi_info[1].get('Brocardi') if brocardi_info[1] and 'Brocardi' in brocardi_info[1] else None,
                                    'Ratio': brocardi_info[1].get('Ratio') if brocardi_info[1] and 'Ratio' in brocardi_info[1] else None,
                                    'Spiegazione': brocardi_info[1].get('Spiegazione') if brocardi_info[1] and 'Spiegazione' in brocardi_info[1] else None,
                                    'Massime': brocardi_info[1].get('Massime') if brocardi_info[1] and 'Massime' in brocardi_info[1] else None,
                                    'Relazioni': brocardi_info[1].get('Relazioni') if brocardi_info[1] and 'Relazioni' in brocardi_info[1] else None,
                                    'RelazioneCostituzione': brocardi_info[1].get('RelazioneCostituzione') if brocardi_info[1] and 'RelazioneCostituzione' in brocardi_info[1] else None,
                                    'Footnotes': brocardi_info[1].get('Footnotes') if brocardi_info[1] and 'Footnotes' in brocardi_info[1] else None,
                                    'RelatedArticles': brocardi_info[1].get('RelatedArticles') if brocardi_info[1] and 'RelatedArticles' in brocardi_info[1] else None,
                                    'CrossReferences': brocardi_info[1].get('CrossReferences') if brocardi_info[1] and 'CrossReferences' in brocardi_info[1] else None,
                                    'Glossario': brocardi_info[1].get('Glossario') if brocardi_info[1] and 'Glossario' in brocardi_info[1] else None
                                }

                except Exception as exc:
                    result = {'error': str(exc), 'norma_data': nv.to_dict()}

                # Send result immediately
                yield json.dumps(result) + "\n"

        # Return streaming response with proper headers
        return Response(
            result_generator(),
            mimetype='application/x-ndjson',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'  # Disable nginx buffering
            }
        )

    async def record_start_time(self):
        g.start_time = time()

    async def rate_limit_middleware(self):
        client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        current_time = time()
        log.debug("Rate limit check", client_ip=client_ip, current_time=current_time)

        request_info = request_counts[client_ip]
        if current_time - request_info['time'] < RATE_LIMIT_WINDOW:
            if request_info['count'] >= RATE_LIMIT:
                log.warning("Rate limit exceeded", client_ip=client_ip)
                return jsonify({'error': 'Rate limit exceeded. Try again later.'}), 429
            else:
                request_info['count'] += 1
        else:
            request_counts[client_ip] = {'count': 1, 'time': current_time}

    async def log_query_stats(self, response):
        try:
            end_time = time()
            start_time = getattr(g, "start_time", end_time)
            duration = end_time - start_time

            tokens = None
            if response.content_type and "application/json" in response.content_type:
                # Estrae il testo della risposta e lo decodifica in JSON
                text = await response.get_data(as_text=True)
                try:
                    data = json.loads(text)
                    tokens = count_tokens(data)
                except Exception:
                    tokens = "N/A"
            log.info("Query statistics", path=request.path, method=request.method, duration=duration, tokens=tokens)
        except Exception as e:
            log.error("Error logging query statistics", error=str(e))
        return response

    def setup_routes(self):
        self.app.add_url_rule('/', view_func=self.home)
        self.app.add_url_rule('/fetch_norma_data', view_func=self.fetch_norma_data, methods=['POST'])
        # NL → struct + URN canonical. Used by the "Norma di riferimento" picker
        # in the MERL-T contribution flow (FE side) so users can type
        # "art 1453 cc" instead of pasting a NIR URN by hand. Path lives at the
        # root (NOT under /api/) so the Vite proxy can route it to the Python
        # server alongside the other /fetch_*, /health, /version endpoints —
        # /api/* is reserved for the Node BFF.
        self.app.add_url_rule('/parse_query', view_func=self.parse_query, methods=['POST'])
        # Contextual citation linker — finds normative references embedded in free
        # text. Used by MERL-T's query NER (Loop β #2) to detect refs inside a
        # natural-language question. Mirrors /api/extract_citations on the prefixed
        # server so MERL-T (which targets :5000) can reach it without the /api prefix.
        self.app.add_url_rule('/extract_citations', view_func=self.extract_citations_endpoint, methods=['POST'])
        self.app.add_url_rule('/fetch_article_text', view_func=self.fetch_article_text, methods=['POST'])
        self.app.add_url_rule('/stream_article_text', view_func=self.stream_article_text, methods=['POST'])
        self.app.add_url_rule('/fetch_brocardi_info', view_func=self.fetch_brocardi_info, methods=['POST'])
        self.app.add_url_rule('/fetch_all_data', view_func=self.fetch_all_data, methods=['POST'])
        self.app.add_url_rule('/fetch_tree', view_func=self.fetch_tree, methods=['POST'])
        self.app.add_url_rule('/fetch_rubriche', view_func=self.fetch_rubriche, methods=['POST'])
        self.app.add_url_rule('/history', view_func=self.get_history, methods=['GET'])
        self.app.add_url_rule('/history', view_func=self.clear_history, methods=['DELETE'])
        self.app.add_url_rule('/history/<path:timestamp>', view_func=self.delete_history_item, methods=['DELETE'])
        # Dossier endpoints
        self.app.add_url_rule('/dossiers', view_func=self.get_dossiers, methods=['GET'])
        self.app.add_url_rule('/dossiers', view_func=self.create_dossier, methods=['POST'])
        self.app.add_url_rule('/dossiers/sync', view_func=self.sync_dossiers, methods=['PUT'])
        self.app.add_url_rule('/dossiers/<dossier_id>', view_func=self.get_dossier, methods=['GET'])
        self.app.add_url_rule('/dossiers/<dossier_id>', view_func=self.update_dossier, methods=['PUT'])
        self.app.add_url_rule('/dossiers/<dossier_id>', view_func=self.delete_dossier, methods=['DELETE'])
        self.app.add_url_rule('/dossiers/<dossier_id>/items', view_func=self.add_dossier_item, methods=['POST'])
        self.app.add_url_rule('/dossiers/<dossier_id>/items/<item_id>', view_func=self.remove_dossier_item, methods=['DELETE'])
        self.app.add_url_rule('/dossiers/<dossier_id>/items/<item_id>/status', view_func=self.update_item_status, methods=['PUT'])
        self.app.add_url_rule('/dossiers/import', view_func=self.import_dossier, methods=['POST'])
        self.app.add_url_rule('/export_pdf', view_func=self.export_pdf, methods=['POST'])
        self.app.add_url_rule('/health', view_func=self.health, methods=['GET'])
        self.app.add_url_rule('/health/detailed', view_func=self.health_detailed, methods=['GET'])
        self.app.add_url_rule('/version', view_func=self.get_version, methods=['GET'])


    async def home(self):
        return jsonify({
            "service": "VisuaLex API",
            "status": "running",
            "docs": None,  # Swagger is not implemented on this root app (see visualex_api/app.py for the prefixed variant)
            "frontend": "http://localhost:5173",
        })

    async def create_norma_visitata_from_data(self, data):
        """
        Crea e restituisce una lista di istanze di NormaVisitata a partire dai dati della richiesta.
        """
        log.info("Creating NormaVisitata from data", data=data)

        # The root controller never validated its input: a missing act_type
        # surfaced as a generic 500 instead of a 400. The /api twin already
        # does this (visualex_api/app.py:309-312).
        if 'act_type' not in data or not data.get('act_type'):
            raise ValidationError("Campo obbligatorio mancante: act_type")
        if 'article' not in data or data.get('article') in (None, ''):
            raise ValidationError("Campo obbligatorio mancante: article")

        allowed_types = ['legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'regio decreto']
        act_type = data.get('act_type')
        act_number = data.get('act_number')
        norma_date = data.get('date')

        # Check if this is a codice with extractable details (e.g., "codice civile" -> "regio decreto 262/1942")
        codice_details = extract_codice_details(act_type) if act_type else None
        tipo_atto_reale = None
        if codice_details and not norma_date and not act_number:
            log.info("Extracted codice details from URN map", codice_details=codice_details)
            norma_date = codice_details['data']
            act_number = codice_details['numero_atto']
            tipo_atto_reale = codice_details['tipo_atto_reale']
            # Note: we keep act_type as the alias (e.g., "codice civile") for display purposes

        if act_type in allowed_types:
            log.info("Act type is allowed", act_type=act_type)
            data_completa = await complete_date_or_parse_async(
                date=norma_date,
                act_type=act_type,
                act_number=act_number
            )
            log.info("Completed date parsed", data_completa=data_completa)
            # Keep YYYY-MM-DD format for Norma validation
            norma_date = data_completa
        else:
            log.info("Act type is not in allowed types", act_type=act_type)
            log.info("Using provided date", norma_date=norma_date)

        norma = Norma(
            tipo_atto=act_type,
            data=norma_date if norma_date else None,
            numero_atto=act_number,
            tipo_atto_reale=tipo_atto_reale
        )
        log.info("Norma instance created", norma=norma)

        articles = await parse_article_input(str(data.get('article')), norma.url)
        log.info("Articles parsed", articles=articles)

        # parse_article_input returns an error DICT rather than raising. Without
        # this guard the loop below iterates the dict's KEYS and builds one
        # NormaVisitata with numero_articolo='error', whose URN ends in ~arterror.
        if isinstance(articles, dict) and 'error' in articles:
            raise ValidationError(articles['error'])

        # Validate and sanitize annex parameter
        annex_value = data.get('annex')
        # Track if user explicitly requested dispositivo (empty string)
        # This is different from "no preference" (null/undefined)
        explicit_dispositivo = False

        if annex_value is not None:
            if isinstance(annex_value, str):
                annex_value = annex_value.strip()
                if annex_value == '':
                    # Empty string = user explicitly wants dispositivo (skip smart lookup)
                    explicit_dispositivo = True
                    annex_value = None
                elif annex_value.lower() == 'null' or annex_value.lower() == 'undefined':
                    # null/undefined string = no preference (smart lookup may apply)
                    annex_value = None
            # Convert to string if it's a number
            elif isinstance(annex_value, (int, float)):
                annex_value = str(int(annex_value))

        # If no annex specified (and not explicit dispositivo), check if this is a codice with a default annex
        # e.g., "codice civile" maps to "regio.decreto:1942-03-16;262:2" where :2 is the annex
        if annex_value is None and not explicit_dispositivo:
            import re
            normalized_type = normalize_act_type(act_type)
            # codice_urn() matches case-insensitively: six keys in the table
            # carry capitals ("codice del Terzo settore") while normalize_act_type
            # returns the table's own spelling, so a bare `in` test missed them
            # and those codici lost their default annex.
            codice_fragment = codice_urn(normalized_type)
            log.info("Checking for default annex", act_type=act_type, normalized_type=normalized_type,
                     in_codici_map=bool(codice_fragment))
            if codice_fragment:
                log.info("Found codice URN", codice_urn=codice_fragment)
                # Extract annex from URN pattern like "regio.decreto:1942-03-16;262:2"
                # The annex is after the last colon if there's a number;number:annex pattern
                annex_match = re.search(r';\d+:(\d+)$', codice_fragment)
                log.info("Annex regex match", match=str(annex_match))
                if annex_match:
                    annex_value = annex_match.group(1)
                    log.info("Using default annex from codice URN", codice=normalized_type, default_annex=annex_value)

        log.info("Final annex value before smart lookup", annex=annex_value, explicit_dispositivo=explicit_dispositivo)

        # Smart article lookup: if no annex specified and not a hardcoded codice,
        # check if the article actually exists in the dispositivo or in an annex
        # SKIP smart lookup if user explicitly requested dispositivo (empty string)
        if annex_value is None and not explicit_dispositivo and norma.url:
            try:
                # Fetch tree with metadata to check article locations
                tree_result = await get_tree(norma.url, link=False, details=False, return_metadata=True)
                if len(tree_result) == 3:
                    tree_data, tree_count, tree_metadata = tree_result
                    log.info("Smart lookup: fetched tree", article_count=tree_count, has_metadata=bool(tree_metadata))

                    if tree_metadata and 'annexes' in tree_metadata and tree_count > 0:
                        annexes = tree_metadata['annexes']
                        log.info("Smart lookup: found annexes", annex_count=len(annexes))

                        # For each requested article, check where it exists
                        for article in articles:
                            article_normalized = article.strip().lower()
                            found_in_dispositivo = False
                            found_in_annex = None
                            best_annex = None
                            best_annex_count = 0

                            for annex_info in annexes:
                                annex_num = annex_info.get('number')  # None for dispositivo
                                article_numbers = annex_info.get('article_numbers', [])
                                article_count = annex_info.get('article_count', 0)

                                # Check if article exists in this section
                                article_exists = any(
                                    art.strip().lower() == article_normalized
                                    for art in article_numbers
                                )

                                if article_exists:
                                    if annex_num is None:
                                        # Found in dispositivo
                                        found_in_dispositivo = True
                                        log.info("Smart lookup: article found in dispositivo", article=article)
                                    else:
                                        # Found in an annex - track the one with most articles
                                        if article_count > best_annex_count:
                                            best_annex = annex_num
                                            best_annex_count = article_count
                                        log.info("Smart lookup: article found in annex", article=article,
                                                 annex=annex_num, annex_article_count=article_count)

                            # If article NOT in dispositivo but found in annex, auto-redirect
                            if not found_in_dispositivo and best_annex is not None:
                                annex_value = best_annex
                                log.info("Smart lookup: auto-redirecting to annex",
                                         article=article, target_annex=annex_value)
                                break  # Use same annex for all articles in this request

            except Exception as e:
                log.warning("Smart lookup failed, proceeding without", error=str(e))

        log.info("Final annex value after smart lookup", annex=annex_value)

        norma_visitata_list = []
        missing_articles = []
        for article in articles:
            cleaned_article = article.strip().replace(' ', '-') if ' ' in article.strip() else article.strip()
            log.info("Processing article", article=cleaned_article)

            exists = await self._article_exists_in_tree(norma, cleaned_article, annex_value)
            if exists is False:
                log.info("Requested article is not in the act",
                         article=cleaned_article, norma=str(norma))
                missing_articles.append(cleaned_article)
                continue

            norma_visitata_list.append(NormaVisitata(
                norma=norma,
                numero_articolo=cleaned_article,
                versione=data.get('version'),
                data_versione=data.get('version_date'),
                allegato=annex_value
            ))
            log.info("NormaVisitata instance created", norma_visitata=norma_visitata_list[-1])

        # A range like "1-50" on a 32-article act still returns the 32; only a
        # request where NOTHING exists is an error.
        if missing_articles and not norma_visitata_list:
            raise ResourceNotFoundError(
                f"Articolo {', '.join(missing_articles)} non presente in {norma}"
            )

        log.info("Created NormaVisitata instances", norma_visitata_list=[nv.to_dict() for nv in norma_visitata_list])
        return norma_visitata_list

    async def _article_exists_in_tree(self, norma, article, annex):
        """Whether `article` is in the act's article tree.

        Returns True/False, or None when neither the tree nor the AKN index can
        be consulted — a Normattiva outage must not be reported to the user as
        "this article does not exist".

        `norma` is a Norma (the AKN cross-check needs the act, not just its URL);
        a bare act URL is also accepted, for the tree-only path.

        Article numbers are canonicalised on both sides with the AKN parser's
        `normalize_article_key`: the tree API and the scraper disagree on the
        separator ("1-bis" vs "1 bis"). That normaliser treats the suffix as
        "any alphabetic tail" rather than an enumerated ordinal list, which is
        load-bearing — Normattiva goes far past `decies` ("25 undecies",
        "25 quinquiesdecies", "25 duodevicies" in d.lgs. 231/2001,
        "669 terdecies" c.p.c., "2409 octiesdecies" c.c.) and an enumerated
        list would silently turn every article beyond its last entry into
        "does not exist".
        """
        act_url = getattr(norma, 'url', None) or str(norma)
        try:
            tree_result = await get_tree(act_url, link=False, details=False,
                                         return_metadata=True)
            # get_tree is wrapped in @cached(serializer=JsonSerializer()), which
            # round-trips its (articles, count, metadata) tuple through JSON: the
            # first call in a process returns a TUPLE, every cache hit afterwards
            # returns a LIST. Testing for `tuple` alone made the check read the
            # 3-element envelope as the article list and report every article of
            # every cached act as missing.
            if isinstance(tree_result, (tuple, list)) and len(tree_result) == 3:
                articles = tree_result[0]
            else:
                articles = tree_result
        except Exception as exc:  # noqa: BLE001 - never fail the request on a tree error
            log.warning("Tree unavailable, skipping existence check",
                        error=str(exc), url=str(act_url)[:100])
            return None

        # get_tree reports failures as a STRING in the articles slot.
        if isinstance(articles, str) or not articles:
            log_ctx = {"tree": str(articles)[:120], "url": str(act_url)[:100]}
            index = await fetch_act_index(norma)
            if index is not None:
                log.info("Tree unusable, answered from the AKN index", **log_ctx)
                wanted = normalize_article_key(article)
                return any(normalize_article_key(k) == wanted for k in index.keys)
            log.warning("Tree unusable and no AKN index, skipping existence check",
                        **log_ctx)
            return None

        wanted = normalize_article_key(article)
        for entry in articles:
            if not isinstance(entry, dict):
                continue  # section/annex labels are bare strings
            if annex is not None and str(entry.get('allegato') or '') != str(annex):
                continue
            if normalize_article_key(entry.get('numero', '')) == wanted:
                return True
        return False

    def get_scraper_for_norma(self, normavisitata):
        act_type_normalized = normavisitata.norma.tipo_atto.lower()
        log.debug("Determining scraper for norma", act_type=act_type_normalized)
        if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
            return eurlex_scraper
        else:
            return normattiva_scraper

    @staticmethod
    def _error_response(exc, endpoint):
        """Map an exception to the status its class documents.

        `exceptions.py` states ValidationError -> 400 and
        ResourceNotFoundError -> 404, and the /api twin honours that in
        `handle_error` (visualex_api/app.py:224). The root controller returned
        500 for every failure, so "act_type mancante" was indistinguishable
        from a Normattiva outage for any client that branches on the status.
        """
        if isinstance(exc, ResourceNotFoundError):
            status = 404
        elif isinstance(exc, ValidationError):
            status = 400
        elif isinstance(exc, RateLimitExceededError):
            status = 429
        else:
            status = 500
        log.error("Request failed", endpoint=endpoint, status=status,
                  error=str(exc), error_type=type(exc).__name__)
        return jsonify({'error': str(exc)}), status

    async def fetch_norma_data(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_norma_data", data=data)

            normavisitate = await self.create_norma_visitata_from_data(data)
            response = {'norma_data': [nv.to_dict() for nv in normavisitate]}
            log.debug("Norma data response", response=response)
            return jsonify(response)
        except Exception as e:
            return self._error_response(e, 'fetch_norma_data')

    async def parse_query(self):
        """Parse a natural language query into structured API params + URN.

        Used by the MERL-T contribution picker so the user can type
        "art 1453 cc" instead of a NIR URN. Mirrors the parser in
        `visualex_api/app.py` but additionally builds the canonical URN via the
        same pipeline as `fetch_norma_data`, so the FE gets a ready-to-paste
        URN string without a second round-trip.

        Returns:
            { recognized: bool, parsed?: {...api params}, urn?: str,
              display?: str, source?: 'alias' | 'nl_parser' }
        """
        try:
            data = await request.get_json() or {}
            query = (data.get("query") or data.get("q") or "").strip()
            if not query:
                return jsonify({"error": "Missing required field: query"}), 400

            # 1. Preset alias first ("gdpr" → Regolamento UE 2016/679, ecc.).
            parsed_params = resolve_alias(query)
            source = "alias" if parsed_params else None

            # 2. Fall back to the NL parser ("art 1453 cc", "art 3 cost", ...).
            if not parsed_params:
                parsed = parse_nl_query(query)
                if parsed is None:
                    return jsonify({"parsed": None, "recognized": False})
                parsed_params = parsed.to_api_params()
                source = "nl_parser"

            # 3. Best-effort URN: build a NormaVisitata with the same pipeline
            # `fetch_norma_data` uses, then pick its .urn. If the URN cannot be
            # generated (e.g. missing pieces, scraper hiccup) we still return
            # the parsed params so the FE can prompt for the missing field.
            urn = None
            display = None
            try:
                normavisitate = await self.create_norma_visitata_from_data(parsed_params)
                if normavisitate:
                    nv = normavisitate[0]
                    urn = getattr(nv, "urn", None)
                    article = parsed_params.get("article")
                    act = parsed_params.get("act_type")
                    display = (
                        f"Art. {article} — {act}" if article and act else act or query
                    )
            except Exception as e:
                log.warning("parse_query URN build failed", error=str(e))

            return jsonify({
                "recognized": True,
                "parsed": parsed_params,
                "urn": urn,
                "display": display,
                "source": source,
            })
        except Exception as e:
            log.error("Error in parse_query", error=str(e))
            return jsonify({"error": str(e)}), 500

    async def extract_citations_endpoint(self):
        """Detect normative citations embedded in free text (shared linker).

        Loop β #2: MERL-T's query NER calls this to find references inside a
        natural-language question (e.g. "Cosa prevede l'art. 1218 c.c.?") with
        char offsets. Mirrors the /api/extract_citations handler on the prefixed
        server so the root :5000 server (the one MERL-T targets) exposes it too.

        Returns: { citations: [{start, end, display_text, article, act_type,
                   act_number, date}], count }
        """
        try:
            data = await request.get_json()
            if not data or "text" not in data:
                return jsonify({"error": "Missing required field: text"}), 400
            text = data["text"]
            if not isinstance(text, str):
                return jsonify({"error": "text must be a string"}), 400
            if len(text) > 500_000:
                return jsonify({"error": "Text too large (max 500KB)"}), 413
            context_act_type = data.get("context_act_type")
            if context_act_type is not None and not isinstance(context_act_type, str):
                return jsonify({"error": "context_act_type must be a string"}), 400
            citations = extract_citations_from_text(text, context_act_type=context_act_type)
            return jsonify({
                "citations": [c.to_dict() for c in citations],
                "count": len(citations),
            })
        except Exception as e:
            log.error("Error in extract_citations", error=str(e))
            return jsonify({"error": str(e)}), 500

    async def fetch_article_text(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_article_text", data=data)
            add_to_history(data)

            normavisitate = await self.create_norma_visitata_from_data(data)
            log.info("NormaVisitata instances created", normavisitate=[nv.to_dict() for nv in normavisitate])

            async def fetch_text(nv):
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    log.warning("Unsupported act type for scraper", norma_data=nv.to_dict())
                    return {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}

                try:
                    article_text, url = await scraper.get_document(nv)
                    log.info("Document fetched successfully", article_text=article_text, url=url)
                    return {
                        'article_text': article_text,
                        'norma_data': nv.to_dict(),
                        'url': url
                    }
                except Exception as exc:
                    log.error("Error fetching article text", error=str(exc))
                    return {'error': str(exc), 'norma_data': nv.to_dict()}

            results = await asyncio.gather(*(fetch_text(nv) for nv in normavisitate), return_exceptions=True)
            processed_results = []
            for result in results:
                if isinstance(result, Exception):
                    log.error("Exception during fetching article text", exception=str(result))
                    processed_results.append({'error': str(result)})
                else:
                    processed_results.append(result)
                    log.info("Fetched article result", result=result)
            return jsonify(processed_results)
        except Exception as e:
            return self._error_response(e, 'fetch_article_text')

    async def fetch_tree(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_tree", data=data)

            urn = data.get('urn')
            if not urn:
                log.error("Missing 'urn' in request data")
                return jsonify({'error': "Missing 'urn' in request data"}), 400

            link = data.get('link', False)
            details = data.get('details', False)
            return_metadata = data.get('return_metadata', True)  # Default to True for annex detection

            if not isinstance(link, bool):
                log.error("'link' must be a boolean")
                return jsonify({'error': "'link' must be a boolean"}), 400
            if not isinstance(details, bool):
                log.error("'details' must be a boolean")
                return jsonify({'error': "'details' must be a boolean"}), 400
            if not isinstance(return_metadata, bool):
                log.error("'return_metadata' must be a boolean")
                return jsonify({'error': "'return_metadata' must be a boolean"}), 400

            log.debug("Flags received", link=link, details=details, return_metadata=return_metadata)

            if return_metadata:
                articles, count, metadata = await get_tree(urn, link=link, details=details, return_metadata=True)
            else:
                articles, count = await get_tree(urn, link=link, details=details, return_metadata=False)
                metadata = {}

            if isinstance(articles, str):
                log.error("Error fetching tree", error=articles)
                return jsonify({'error': articles}), 500

            response = {'articles': articles, 'count': count}
            if return_metadata and metadata:
                response['metadata'] = metadata

            log.info("Tree fetched successfully", count=count, has_metadata=bool(metadata))
            return jsonify(response)
        except Exception as e:
            log.error("Error in fetch_tree", error=str(e), exc_info=True)
            return jsonify({'error': str(e)}), 500

    async def fetch_rubriche(self):
        """Article titles for an act's index.

        Deliberately a separate call from /fetch_tree rather than a key on its
        response. The tree comes from one cached HTML page and is effectively
        instant; the AKN export behind the rubriche is 10.6 MB for the codice
        civile and takes seconds on a cold cache. Coupling them would make the
        index window slowest exactly for the acts whose indexes are longest —
        which is where the titles matter most. The client renders the numbers
        immediately and merges the titles in when they land.

        Always answers 200: an act with no rubriche and an act whose export
        could not be fetched are both "show numbers only" for the caller.
        """
        try:
            data = await request.get_json()
            urn = (data or {}).get('urn')
            if not urn:
                return jsonify({'error': "Missing 'urn' in request data"}), 400

            # EUR-Lex is the opposite case from Normattiva: its article titles
            # sit in the very page the tree is parsed from (`oj-ti-art` followed
            # by `oj-sti-art`), so they cost nothing extra — while a second
            # visit would mean launching another browser to get past the WAF.
            # get_tree is cached, so this reuses the fetch the index already
            # made rather than repeating it.
            if 'eur-lex' in str(urn):
                try:
                    _, _, tree_metadata = await get_tree(
                        urn, link=False, details=True, return_metadata=True
                    )
                    rubriche = (tree_metadata or {}).get('rubriche') or {}
                except Exception as exc:  # noqa: BLE001
                    log.warning("EUR-Lex rubriche unavailable",
                                urn=str(urn)[:100], error=str(exc))
                    rubriche = {}
                log.info("Rubriche served (EUR-Lex)", urn=str(urn)[:100], count=len(rubriche))
                return jsonify({
                    'rubriche': rubriche,
                    'abrogati': [],
                    'parts': [],
                    'count': len(rubriche),
                })

            # The AKN cache and the caricaAKN session both key off the ACT, so
            # the article suffix has to go: ...;262:2~art2043 -> ...;262:2
            act_url = str(urn).split('~')[0]

            index = await fetch_act_index(SimpleNamespace(url=act_url))
            if index is None:
                log.info("No AKN index available for rubriche", urn=act_url[:100])
                return jsonify({'rubriche': {}, 'abrogati': [], 'parts': [], 'count': 0})

            log.info("Rubriche served", urn=act_url[:100],
                     count=len(index.rubriche), parts=len(index.parts_detail))
            return jsonify({
                'rubriche': index.rubriche,
                'abrogati': index.abrogati,
                # Each annex has its own article 1 with its own rubrica; the
                # caller matches a part to an annex by article numbers.
                'parts': index.parts_detail,
                'count': len(index.rubriche),
            })
        except Exception as e:
            # Never fail the index over its decoration.
            log.warning("Error in fetch_rubriche", error=str(e), exc_info=True)
            return jsonify({'rubriche': {}, 'abrogati': [], 'parts': [], 'count': 0, 'error': str(e)})

    async def fetch_brocardi_info(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_brocardi_info", data=data)

            normavisitate = await self.create_norma_visitata_from_data(data)

            async def fetch_info(nv):
                act_type_normalized = nv.norma.tipo_atto.lower()
                if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
                    return {'norma_data': nv.to_dict(), 'brocardi_info': None}

                try:
                    brocardi_info = await brocardi_scraper.get_info(nv)
                    return {
                        'norma_data': nv.to_dict(),
                        'brocardi_info': {
                            'position': brocardi_info[0] if brocardi_info[0] else None,
                            'link': brocardi_info[2],
                            'Brocardi': brocardi_info[1].get('Brocardi') if brocardi_info[1] and 'Brocardi' in brocardi_info[1] else None,
                            'Ratio': brocardi_info[1].get('Ratio') if brocardi_info[1] and 'Ratio' in brocardi_info[1] else None,
                            'Spiegazione': brocardi_info[1].get('Spiegazione') if brocardi_info[1] and 'Spiegazione' in brocardi_info[1] else None,
                            'Massime': brocardi_info[1].get('Massime') if brocardi_info[1] and 'Massime' in brocardi_info[1] else None,
                            'Relazioni': brocardi_info[1].get('Relazioni') if brocardi_info[1] and 'Relazioni' in brocardi_info[1] else None,
                            'RelazioneCostituzione': brocardi_info[1].get('RelazioneCostituzione') if brocardi_info[1] and 'RelazioneCostituzione' in brocardi_info[1] else None,
                            'Footnotes': brocardi_info[1].get('Footnotes') if brocardi_info[1] and 'Footnotes' in brocardi_info[1] else None,
                            'RelatedArticles': brocardi_info[1].get('RelatedArticles') if brocardi_info[1] and 'RelatedArticles' in brocardi_info[1] else None,
                            'CrossReferences': brocardi_info[1].get('CrossReferences') if brocardi_info[1] and 'CrossReferences' in brocardi_info[1] else None,
                            'Glossario': brocardi_info[1].get('Glossario') if brocardi_info[1] and 'Glossario' in brocardi_info[1] else None
                        }
                    }
                except Exception as exc:
                    log.error("Error fetching Brocardi info", error=str(exc))
                    return {'error': str(exc), 'norma_data': nv.to_dict()}

            results = await asyncio.gather(*(fetch_info(nv) for nv in normavisitate), return_exceptions=True)
            processed_results = []
            for result in results:
                if isinstance(result, Exception):
                    processed_results.append({'error': str(result)})
                else:
                    processed_results.append(result)
            return jsonify(processed_results)
        except Exception as e:
            return self._error_response(e, 'fetch_brocardi_info')

    async def fetch_all_data(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_all_data", data=data)
            add_to_history(data)

            normavisitate = await self.create_norma_visitata_from_data(data)

            # Check if user explicitly requested dispositivo (annex='')
            # If so, skip Brocardi for codici with allegati since Brocardi content is for the allegato
            annex_value = data.get('annex')
            explicit_dispositivo = isinstance(annex_value, str) and annex_value.strip() == ''

            async def fetch_data(nv):
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    log.warning("Unsupported act type for scraper", norma_data=nv.to_dict())
                    return {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}

                try:
                    article_text, url = await scraper.get_document(nv)
                    brocardi_info = None
                    if scraper == normattiva_scraper:
                        # Skip Brocardi for dispositivo articles of codes that have their content in allegati
                        # Brocardi.it only has content for the actual code (allegato), not the dispositivo
                        should_fetch_brocardi = True
                        if explicit_dispositivo and nv.allegato is None:
                            # Check if this is a codice with a default allegato
                            normalized_type = normalize_act_type(nv.norma.tipo_atto)
                            codice_fragment = codice_urn(normalized_type)
                            if codice_fragment:
                                # Codes with allegati have patterns like ":1" or ":2" at the end
                                if re.search(r';\d+:\d+$', codice_fragment):
                                    should_fetch_brocardi = False
                                    log.info("Skipping Brocardi for dispositivo of codice with allegato",
                                             act_type=normalized_type, article=nv.numero_articolo)

                        if should_fetch_brocardi:
                            try:
                                b_info = await brocardi_scraper.get_info(nv)
                                brocardi_info = {
                                    'position': b_info[0] if b_info[0] else None,
                                    'link': b_info[2],
                                    'Brocardi': b_info[1].get('Brocardi') if b_info[1] and 'Brocardi' in b_info[1] else None,
                                    'Ratio': b_info[1].get('Ratio') if b_info[1] and 'Ratio' in b_info[1] else None,
                                    'Spiegazione': b_info[1].get('Spiegazione') if b_info[1] and 'Spiegazione' in b_info[1] else None,
                                    'Massime': b_info[1].get('Massime') if b_info[1] and 'Massime' in b_info[1] else None,
                                    'Relazioni': b_info[1].get('Relazioni') if b_info[1] and 'Relazioni' in b_info[1] else None,
                                    'RelazioneCostituzione': b_info[1].get('RelazioneCostituzione') if b_info[1] and 'RelazioneCostituzione' in b_info[1] else None,
                                    'Footnotes': b_info[1].get('Footnotes') if b_info[1] and 'Footnotes' in b_info[1] else None,
                                    'RelatedArticles': b_info[1].get('RelatedArticles') if b_info[1] and 'RelatedArticles' in b_info[1] else None,
                                    'CrossReferences': b_info[1].get('CrossReferences') if b_info[1] and 'CrossReferences' in b_info[1] else None,
                                    'Glossario': b_info[1].get('Glossario') if b_info[1] and 'Glossario' in b_info[1] else None
                                }
                            except Exception as exc:
                                log.error("Error fetching Brocardi info", error=str(exc))
                                brocardi_info = {'error': str(exc)}
                    return {
                        'article_text': article_text,
                        'url': url,
                        'norma_data': nv.to_dict(),
                        'brocardi_info': brocardi_info
                    }
                except Exception as exc:
                    log.error("Error fetching all data", error=str(exc))
                    return {'error': str(exc), 'norma_data': nv.to_dict()}

            processed_results = []
            queue_entries = []
            for nv in normavisitate:
                position, future = await self.fetch_queue.submit(fetch_data, nv)
                queue_entries.append((position, future))

            for position, future in queue_entries:
                try:
                    result = await future
                    payload = {'queue_position': position}
                    payload.update(result)
                    processed_results.append(payload)
                except Exception as exc:
                    log.error("Exception during fetching all data", exception=str(exc))
                    processed_results.append({'queue_position': position, 'error': str(exc)})
            return jsonify(processed_results)
        except Exception as e:
            return self._error_response(e, 'fetch_all_data')

    async def get_history(self):
        try:
            return jsonify({'history': history_manager.get_all()})
        except Exception as e:
            log.error("Error in get_history", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def clear_history(self):
        """Svuota tutta la history."""
        try:
            history_manager.clear()
            return jsonify({'success': True, 'message': 'History cleared'})
        except Exception as e:
            log.error("Error in clear_history", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def delete_history_item(self, timestamp):
        """Elimina un singolo item dalla history."""
        try:
            success = history_manager.remove(timestamp)
            if success:
                return jsonify({'success': True})
            return jsonify({'error': 'Item not found'}), 404
        except Exception as e:
            log.error("Error in delete_history_item", error=str(e))
            return jsonify({'error': str(e)}), 500

    # ==================== Dossier Endpoints ====================

    async def get_dossiers(self):
        """Restituisce tutti i dossier."""
        try:
            return jsonify({'dossiers': dossier_manager.get_all()})
        except Exception as e:
            log.error("Error in get_dossiers", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def get_dossier(self, dossier_id):
        """Restituisce un dossier specifico."""
        try:
            dossier = dossier_manager.get_by_id(dossier_id)
            if dossier:
                return jsonify(dossier)
            return jsonify({'error': 'Dossier not found'}), 404
        except Exception as e:
            log.error("Error in get_dossier", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def create_dossier(self):
        """Crea un nuovo dossier."""
        try:
            data = await request.get_json()
            title = data.get('title', 'Nuovo Dossier')
            description = data.get('description', '')
            dossier = dossier_manager.create(title, description)
            return jsonify(dossier), 201
        except Exception as e:
            log.error("Error in create_dossier", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def update_dossier(self, dossier_id):
        """Aggiorna un dossier."""
        try:
            data = await request.get_json()
            dossier = dossier_manager.update(dossier_id, data)
            if dossier:
                return jsonify(dossier)
            return jsonify({'error': 'Dossier not found'}), 404
        except Exception as e:
            log.error("Error in update_dossier", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def delete_dossier(self, dossier_id):
        """Elimina un dossier."""
        try:
            success = dossier_manager.delete(dossier_id)
            if success:
                return jsonify({'success': True})
            return jsonify({'error': 'Dossier not found'}), 404
        except Exception as e:
            log.error("Error in delete_dossier", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def add_dossier_item(self, dossier_id):
        """Aggiunge un item a un dossier."""
        try:
            data = await request.get_json()
            item_data = data.get('data')
            item_type = data.get('type', 'norma')
            item = dossier_manager.add_item(dossier_id, item_data, item_type)
            if item:
                return jsonify(item), 201
            return jsonify({'error': 'Dossier not found'}), 404
        except Exception as e:
            log.error("Error in add_dossier_item", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def remove_dossier_item(self, dossier_id, item_id):
        """Rimuove un item da un dossier."""
        try:
            success = dossier_manager.remove_item(dossier_id, item_id)
            if success:
                return jsonify({'success': True})
            return jsonify({'error': 'Item not found'}), 404
        except Exception as e:
            log.error("Error in remove_dossier_item", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def update_item_status(self, dossier_id, item_id):
        """Aggiorna lo status di un item."""
        try:
            data = await request.get_json()
            status = data.get('status', 'unread')
            success = dossier_manager.update_item_status(dossier_id, item_id, status)
            if success:
                return jsonify({'success': True})
            return jsonify({'error': 'Item not found'}), 404
        except Exception as e:
            log.error("Error in update_item_status", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def import_dossier(self):
        """Importa un dossier (da share link)."""
        try:
            data = await request.get_json()
            dossier = dossier_manager.import_dossier(data)
            return jsonify(dossier), 201
        except Exception as e:
            log.error("Error in import_dossier", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def sync_dossiers(self):
        """Sincronizza tutti i dossier (sovrascrive dal frontend)."""
        try:
            data = await request.get_json()
            dossiers = data.get('dossiers', [])
            dossier_manager.sync_all(dossiers)
            return jsonify({'success': True, 'count': len(dossiers)})
        except Exception as e:
            log.error("Error in sync_dossiers", error=str(e))
            return jsonify({'error': str(e)}), 500

    # ==================== Health Endpoints ====================

    async def health(self):
        """Basic health check - returns 200 if app is running."""
        from datetime import datetime
        return jsonify({
            'status': 'ok',
            'timestamp': datetime.utcnow().isoformat()
        })

    async def health_detailed(self):
        """Detailed health check - tests connectivity to external sources."""
        from datetime import datetime
        import time as time_module

        results = {
            'status': 'ok',
            'timestamp': datetime.utcnow().isoformat(),
            'services': {}
        }

        # Test Normattiva (fetch homepage with timeout)
        try:
            start = time_module.time()
            await normattiva_scraper.request_document("https://www.normattiva.it", source="health_check")
            latency = time_module.time() - start
            results['services']['normattiva'] = {
                'status': 'ok',
                'latency_ms': round(latency * 1000, 2)
            }
        except Exception as e:
            results['services']['normattiva'] = {
                'status': 'error',
                'error': str(e)
            }
            results['status'] = 'degraded'

        # Test EUR-Lex (fetch homepage with timeout)
        try:
            start = time_module.time()
            await eurlex_scraper.request_document("https://eur-lex.europa.eu", source="health_check")
            latency = time_module.time() - start
            results['services']['eurlex'] = {
                'status': 'ok',
                'latency_ms': round(latency * 1000, 2)
            }
        except Exception as e:
            results['services']['eurlex'] = {
                'status': 'error',
                'error': str(e)
            }
            results['status'] = 'degraded'

        # Test Brocardi (fetch homepage with timeout)
        try:
            start = time_module.time()
            await brocardi_scraper.request_document("https://www.brocardi.it", source="health_check")
            latency = time_module.time() - start
            results['services']['brocardi'] = {
                'status': 'ok',
                'latency_ms': round(latency * 1000, 2)
            }
        except Exception as e:
            results['services']['brocardi'] = {
                'status': 'error',
                'error': str(e)
            }
            results['status'] = 'degraded'

        status_code = 200 if results['status'] == 'ok' else 503
        return jsonify(results), status_code

    async def get_version(self):
        """Returns version info, latest git commit details, and changelog."""
        import subprocess
        from pathlib import Path

        # Get the project root directory (where app.py is located)
        project_root = Path(__file__).parent

        def run_git_command(args: list[str]) -> str:
            try:
                result = subprocess.run(
                    ['git'] + args,
                    capture_output=True,
                    text=True,
                    timeout=5,
                    cwd=str(project_root)  # Run git commands from project root
                )
                return result.stdout.strip() if result.returncode == 0 else ''
            except Exception:
                return ''

        # Read version from version.txt
        version = '1.0.0'
        version_file = project_root / 'version.txt'
        if version_file.exists():
            try:
                version = version_file.read_text().strip()
            except Exception:
                pass

        # Get git info in thread pool to not block
        commit_hash = await asyncio.to_thread(run_git_command, ['rev-parse', '--short', 'HEAD'])
        commit_hash_full = await asyncio.to_thread(run_git_command, ['rev-parse', 'HEAD'])
        commit_message = await asyncio.to_thread(run_git_command, ['log', '-1', '--format=%s'])
        commit_date = await asyncio.to_thread(run_git_command, ['log', '-1', '--format=%ci'])
        commit_author = await asyncio.to_thread(run_git_command, ['log', '-1', '--format=%an'])
        branch = await asyncio.to_thread(run_git_command, ['rev-parse', '--abbrev-ref', 'HEAD'])

        # Get changelog (last 10 commits)
        changelog_raw = await asyncio.to_thread(
            run_git_command,
            ['log', '-10', '--format=%h|%s|%ci|%an']
        )
        changelog = []
        if changelog_raw:
            for line in changelog_raw.split('\n'):
                if line and '|' in line:
                    parts = line.split('|', 3)
                    if len(parts) >= 4:
                        changelog.append({
                            'hash': parts[0],
                            'message': parts[1],
                            'date': parts[2],
                            'author': parts[3]
                        })

        return jsonify({
            'version': version,
            'git': {
                'branch': branch or 'unknown',
                'commit': {
                    'hash': commit_hash or 'unknown',
                    'hash_full': commit_hash_full or 'unknown',
                    'message': commit_message or 'unknown',
                    'date': commit_date or 'unknown',
                    'author': commit_author or 'unknown'
                }
            },
            'changelog': changelog
        })

    async def export_pdf(self):
        try:
            data = await request.get_json()
            if not data:
                return jsonify({'error': 'Request body required'}), 400
            urn = data.get('urn')
            if not urn:
                return jsonify({'error': 'URN mancante'}), 400
            if not is_allowed_pdf_urn(urn):
                return jsonify({'error': 'URN non valido: sono ammessi solo URL normattiva.it'}), 400
            urn = urn.strip()

            log.info("Received data for export_pdf", data=data)
            pdf_path = urn_to_filename(urn)

            # Check if PDF already exists in cache
            file_exists = await asyncio.to_thread(os.path.exists, pdf_path)
            if file_exists:
                file_size = await asyncio.to_thread(os.path.getsize, pdf_path)
                if file_size > 0:
                    log.info(f"File PDF già presente e valido: {pdf_path}. Serve file cache.")
                    return await send_file(
                        pdf_path,
                        mimetype='application/pdf',
                        as_attachment=True,
                        attachment_filename=os.path.basename(pdf_path)
                    )
                else:
                    log.info(f"File PDF presente ma vuoto: {pdf_path}. Rimuovo e rigenero.")
                    await asyncio.to_thread(os.remove, pdf_path)

            # Extract PDF using Playwright (async)
            extracted_pdf_path = await extract_pdf(urn)
            log.info(f"PDF estratto: {extracted_pdf_path}")

            exists_extracted = await asyncio.to_thread(os.path.exists, extracted_pdf_path)
            size_extracted = await asyncio.to_thread(os.path.getsize, extracted_pdf_path) if exists_extracted else 0
            if not exists_extracted or size_extracted == 0:
                raise Exception("Il PDF estratto risulta vuoto o non esistente.")

            # Copy to cache location if different
            if extracted_pdf_path != pdf_path:
                def copy_file(src, dst):
                    with open(src, 'rb') as fsrc, open(dst, 'wb') as fdst:
                        fdst.write(fsrc.read())
                await asyncio.to_thread(copy_file, extracted_pdf_path, pdf_path)
                log.info(f"PDF copiato in cache: {pdf_path}")
            else:
                log.info("PDF estratto usato come cache.")

            return await send_file(
                pdf_path,
                mimetype='application/pdf',
                as_attachment=True,
                attachment_filename=os.path.basename(pdf_path)
            )
        except Exception as e:
            log.error("Error in export_pdf", error=str(e))
            return jsonify({'error': str(e)}), 500


def main():
    controller = NormaController()
    app = controller.app
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5000))
    app.run(host=host, port=port)


if __name__ == '__main__':
    main()
