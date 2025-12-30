import asyncio
import os
import logging
import sys
import json
import re
from collections import defaultdict
from time import time

from quart import Quart, request, jsonify, render_template, send_file, Response, g
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
from visualex_api.services.pdfextractor import extract_pdf, cleanup_browser_pool
from visualex_api.tools.urngenerator import complete_date_or_parse_async, urn_to_filename
from visualex_api.tools.treextractor import get_tree
from visualex_api.tools.text_op import format_date_to_extended, parse_article_input, normalize_act_type
from visualex_api.tools.map import NORMATTIVA_URN_CODICI, extract_codice_details

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
        self.app = cors(self.app, allow_origin="http://localhost:3001")
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
        normavisitate = await self.create_norma_visitata_from_data(data)
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
                                    'CrossReferences': brocardi_info[1].get('CrossReferences') if brocardi_info[1] and 'CrossReferences' in brocardi_info[1] else None
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
        self.app.add_url_rule('/fetch_article_text', view_func=self.fetch_article_text, methods=['POST'])
        self.app.add_url_rule('/stream_article_text', view_func=self.stream_article_text, methods=['POST'])
        self.app.add_url_rule('/fetch_brocardi_info', view_func=self.fetch_brocardi_info, methods=['POST'])
        self.app.add_url_rule('/fetch_all_data', view_func=self.fetch_all_data, methods=['POST'])
        self.app.add_url_rule('/fetch_tree', view_func=self.fetch_tree, methods=['POST'])
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
        return await render_template('index.html')

    async def create_norma_visitata_from_data(self, data):
        """
        Crea e restituisce una lista di istanze di NormaVisitata a partire dai dati della richiesta.
        """
        log.info("Creating NormaVisitata from data", data=data)
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
            log.info("Checking for default annex", act_type=act_type, normalized_type=normalized_type,
                     in_codici_map=normalized_type in NORMATTIVA_URN_CODICI)
            if normalized_type in NORMATTIVA_URN_CODICI:
                codice_urn = NORMATTIVA_URN_CODICI[normalized_type]
                log.info("Found codice URN", codice_urn=codice_urn)
                # Extract annex from URN pattern like "regio.decreto:1942-03-16;262:2"
                # The annex is after the last colon if there's a number;number:annex pattern
                annex_match = re.search(r';\d+:(\d+)$', codice_urn)
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
        for article in articles:
            cleaned_article = article.strip().replace(' ', '-') if ' ' in article.strip() else article.strip()
            log.info("Processing article", article=cleaned_article)
            norma_visitata_list.append(NormaVisitata(
                norma=norma,
                numero_articolo=cleaned_article,
                versione=data.get('version'),
                data_versione=data.get('version_date'),
                allegato=annex_value
            ))
            log.info("NormaVisitata instance created", norma_visitata=norma_visitata_list[-1])

        log.info("Created NormaVisitata instances", norma_visitata_list=[nv.to_dict() for nv in norma_visitata_list])
        return norma_visitata_list

    def get_scraper_for_norma(self, normavisitata):
        act_type_normalized = normavisitata.norma.tipo_atto.lower()
        log.debug("Determining scraper for norma", act_type=act_type_normalized)
        if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
            return eurlex_scraper
        else:
            return normattiva_scraper

    async def fetch_norma_data(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_norma_data", data=data)

            normavisitate = await self.create_norma_visitata_from_data(data)
            response = {'norma_data': [nv.to_dict() for nv in normavisitate]}
            log.debug("Norma data response", response=response)
            return jsonify(response)
        except Exception as e:
            log.error("Error in fetch_norma_data", error=str(e))
            return jsonify({'error': str(e)}), 500

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
            log.error("Error in fetch_article_text", error=str(e))
            return jsonify({'error': str(e)}), 500

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
                            'CrossReferences': brocardi_info[1].get('CrossReferences') if brocardi_info[1] and 'CrossReferences' in brocardi_info[1] else None
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
            log.error("Error in fetch_brocardi_info", error=str(e))
            return jsonify({'error': str(e)}), 500

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
                            if normalized_type in NORMATTIVA_URN_CODICI:
                                codice_urn = NORMATTIVA_URN_CODICI[normalized_type]
                                # Codes with allegati have patterns like ":1" or ":2" at the end
                                if re.search(r';\d+:\d+$', codice_urn):
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
                                    'CrossReferences': b_info[1].get('CrossReferences') if b_info[1] and 'CrossReferences' in b_info[1] else None
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
            log.error("Error in fetch_all_data", error=str(e))
            return jsonify({'error': str(e)}), 500

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
            urn = data.get('urn')
            if not urn:
                return jsonify({'error': 'URN mancante'}), 400

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
