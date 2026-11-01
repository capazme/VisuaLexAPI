import asyncio
import os
import logging
import sys
import json
import re
from datetime import date as _date
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from time import time
from urllib.parse import urlparse

from quart import Quart, request, jsonify, send_file, Response, g
from quart_cors import cors
import structlog

from visualex_api.tools.client_ip import client_address
from visualex_api.tools.config import (
    RATE_LIMIT,
    RATE_LIMIT_WINDOW,
    TRUSTED_PROXIES,
    FETCH_QUEUE_WORKERS,
    FETCH_QUEUE_DELAY,
)
from visualex_api.tools.history_manager import history_manager
from visualex_api.tools.dossier_manager import dossier_manager
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.services import eurlex_fetch
from visualex_api.services.pdfextractor import extract_pdf, cleanup_browser_pool, is_allowed_pdf_urn, sweep_exported_pdfs
from visualex_api.services.akn_parser import comparable_article_key
from visualex_api.tools.article_suffixes import other_ordinal_spelling
from visualex_api.services import act_dates, massimario_portal
from visualex_api.services.massimario import routes as rassegne_routes
from visualex_api.services.normattiva_validity import (
    read_upcoming_request,
    read_validity,
    reject_future_version_date,
    reject_original_with_a_date,
    starts_after_today,
    today_in_rome,
    upcoming_change,
    versions_between,
)
from visualex_api.services.normattiva_notes import extract_update_notes, update_notes_fields
from visualex_api.services.normattiva_parts import (
    PART_KEY_MARK, article_page_key, extract_parts, normalize_comma, normalize_range, parts_fields,
    range_holding, ranges_in_words,
)
from types import SimpleNamespace

from visualex_api.services.akn_fetch import fetch_act_index
from visualex_api.services.akn_parser import presentable_title
from visualex_api.services.decisions.citation import read_decision_citation
from visualex_api.services.decisions.eu_case_law import search_eu_case_law as search_eu_case_law_route
from visualex_api.services.decisions.model import InvalidReference, parse_reference
from visualex_api.services.decisions.pdf_route import fetch_decision_pdf as fetch_decision_pdf_route
from visualex_api.services.decisions.search_route import search_decisions as search_decisions_route
from visualex_api.services.decisions.resolver import (
    DECISION_CACHE_SWEEP_SECONDS,
    SourceUnavailable,
    get_resolver,
    sweep_decision_caches,
)
from visualex_api.tools.urngenerator import URN_TOO_LONG, complete_request_date, export_url, read_request_date, export_version_date, pdf_cache_path
from visualex_api.tools.cache_manager import prune_normattiva_cache
from visualex_api.tools.treextractor import get_tree
from visualex_api.tools.text_op import article_input_error, parse_article_input, normalize_act_type
from visualex_api.tools.map import CODE_ROWS_OF_SEVERAL_CODES, act_default_annex, codice_urn, extract_codice_details
from visualex_api.tools.sources import cite_act, cite_article
from visualex_api.tools.act_identity import identifies_act
from visualex_api.tools.norm_query import act_names, read_norm_query
from visualex_api.tools.citation_linker import extract_citations as extract_citations_from_text
from visualex_api.tools.changelog import build_changelog, changelog_boundary, SCAN_LIMIT
from visualex_api.tools.exceptions import (
    IndexUnavailableError,
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

# /parse_query_batch's limits (design 2026-10-29-document-analysis §4.4). 200 strings of 200
# characters can pass 48 KB once accents and JSON escapes are counted: the caller cuts its
# chunks by count and by bytes.
PARSE_BATCH_MAX_QUERIES = 200
PARSE_BATCH_MAX_CHARS = 200
PARSE_BATCH_MAX_BYTES = 48 * 1024

# /fetch_norm_links's limits (design 2026-10-31-document-hyperlinks §3.1): the browser cuts its
# chunks by norms and by acts. The budget is the whole call's: a date lookup alone may take
# act_dates.LOOKUP_BUDGET (15 s), and what is not settled in time comes back
# `source_unavailable`, for the browser to ask again in a smaller chunk.
LINKS_BATCH_MAX_NORMS = 200
LINKS_BATCH_MAX_ACTS = 30
LINKS_BATCH_MAX_BYTES = 48 * 1024
LINKS_BATCH_BUDGET = 20.0
# Acts settled at once; the norms of one act in turn, so its date and index are read once.
LINKS_ACT_CONCURRENCY = 4
_LINK_FIELDS = ('act_type', 'act_number', 'date', 'article', 'annex')
_LINK_FIELD_MAX = {'act_type': 120}
_LINK_FIELD_DEFAULT_MAX = 40
# «1,2», «1 e 2», «4-6», «4 - 6»: more than one article. «1-bis» and «270-bis.1» are one.
_LINK_RANGE_OR_LIST = re.compile(r",|;|\s+e\s+|^\s*\d+\s*-\s*\d+")
# The two sources' own pages, as the web's `sourceAddress` (#385) checks them again.
_LINK_HOSTS = frozenset({'www.normattiva.it', 'normattiva.it', 'eur-lex.europa.eu'})
LINK_REASONS = ('ok', 'date_incomplete', 'article_missing', 'ambiguous_part',
                'source_unavailable', 'not_linkable')


def _link_norm(item):
    """One norm of a /fetch_norm_links body, as the address function reads it, or the
    message of the 400 it deserves. Only the five fields are kept; `annex` '' (the act's own
    text, chosen by the user) is kept as ''."""
    if not isinstance(item, dict):
        return "Each norm must be an object"
    norm = {}
    for key in _LINK_FIELDS:
        value = item.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            return f"{key} must be a string"
        value = str(value).strip()
        if len(value) > _LINK_FIELD_MAX.get(key, _LINK_FIELD_DEFAULT_MAX):
            return f"{key} at most {_LINK_FIELD_MAX.get(key, _LINK_FIELD_DEFAULT_MAX)} characters"
        if value or key == 'annex':
            norm[key] = value
    if not norm.get('act_type') or not norm.get('article'):
        return "Each norm needs act_type and article"
    return norm


def _link_refused_before_lookup(norm):
    """The reason a norm gets no link before any request, or None: a reading that names no
    act, and a range or a list (the browser sends the first article, §4.4; a range would
    read the act's index for nothing)."""
    if not identifies_act(norm) or _LINK_RANGE_OR_LIST.search(norm['article']):
        return 'not_linkable'
    return None


def _link_act_key(norm):
    """What counts as one act toward LINKS_BATCH_MAX_ACTS, before any lookup."""
    return (normalize_act_type(norm['act_type']).lower(), norm.get('act_number', ''), norm.get('date', ''))


def _link_pin_day(value):
    """`(day, None)`: the day the link's text is fixed to (`!vig=<day>`); or `(None, message)`
    for a 400. Absent, it is today in Rome: the link to the text in force always carries the
    day (G-395). A later day is refused: Normattiva answers it with the current text."""
    today = today_in_rome()
    if value is None:
        return today.isoformat(), None
    malformed = "pin_day must be an ISO day (YYYY-MM-DD)"
    if not isinstance(value, str) or not _ISO_DAY.match(value):
        return None, malformed
    try:
        day = _date.fromisoformat(value)
    except ValueError:
        return None, malformed
    if day > today:
        return None, "pin_day cannot be after today"
    return value, None


def _source_href(href):
    """`href` when it is an https address of Normattiva or EUR-Lex, else None."""
    if not isinstance(href, str):
        return None
    try:
        parsed = urlparse(href)
    except ValueError:
        return None
    return href if parsed.scheme == 'https' and parsed.hostname in _LINK_HOSTS else None


# The act types read from EUR-Lex (`get_scraper_for_norma`).
EU_ACT_TYPES = ('tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue')
_ISO_DAY = re.compile(r'^\d{4}-\d{2}-\d{2}$')


@dataclass
class NormAddress:
    """Where a request's articles are, and how sure that is (`resolve_norm_address`).

    `annex_basis` says where the part came from: 'asked' (the caller named the annex),
    'dispositivo' (the caller asked the act's own text, annex ''), 'table' (a code's annex, or
    the annex that is the act's text), 'lookup' (looked for in the act's index: `parts` lists,
    per article as asked, every part holding it, None for the act's text), 'unread' (the index
    answered nothing usable), 'not_looked_up' (the lookup failed, or the act has no address).
    `checked` is `[(article as the act spells it, exists)]`, `exists` True, False or None
    (unknown); `date_complete` whether the act's date is a full day after completion, and
    `date_unavailable` (strict only) whether the year stood because the lookup did not answer.
    """
    norma: Norma
    is_eu: bool = False
    date_complete: bool = False
    date_unavailable: bool = False
    articles: list = field(default_factory=list)
    annex: str | None = None
    explicit_dispositivo: bool = False
    asked_annex: str | None = None
    annex_basis: str | None = None
    parts: dict = field(default_factory=dict)
    checked: list = field(default_factory=list)


def _read_norm_queries(queries: list[str]) -> tuple[list[dict], int]:
    """Each string read as /parse_query reads one; one that makes the reading raise is
    unrecognised, and counted. Returns (results in order, failures)."""
    results, failed = [], 0
    for query in queries:
        try:
            params, source = read_norm_query(query)
        except Exception:
            params, source = None, None
            failed += 1
        results.append({
            "recognized": params is not None,
            "parsed": params,
            "source": source,
            "identifies_act": identifies_act(params),
        })
    return results, failed

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
normattiva_scraper = NormattivaScraper()
eurlex_scraper = EurlexScraper()

# /health/detailed probes three live sources on the shared throttled client and
# circuit breakers; the frontend banner polls it, so N open tabs multiply that
# load. One cached result is shared by every caller for HEALTH_DETAILED_TTL
# seconds, with a lock so concurrent cold callers trigger a single probe
# instead of one each. Module-level (like the scrapers above): there is one
# NormaController instance in the running process.
_health_detailed_cache: dict = {'response': None, 'status_code': None, 'expires_at': 0.0}
_health_detailed_lock = asyncio.Lock()


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


def _upcoming_of(data):
    """`(asked, until)`: whether the request asks for the text not in force yet (G-357)
    and the later day it names, if any (checked before, in create_norma_visitata_from_data)."""
    if data.get('upcoming') is not True:
        return False, None
    return True, read_upcoming_request(data.get('version'), data.get('version_date'))


def _asks_for_text_in_force(nv) -> bool:
    """A request with no date and not for the original: the text in force."""
    day = nv.data_versione
    version = nv.versione
    return (not (isinstance(day, str) and day.strip())
            and not (isinstance(version, str) and version.strip().lower() == 'originale'))


def _part_request(data):
    """`(parte, comma)` as the request names them, normalised; (None, None) when it names
    neither (G-387 (a)). A part is named by its range («701-800») or by a comma it holds
    («773»), never both."""
    def given(value):
        return value is not None and value != ''

    raw_part, raw_comma = data.get('parte'), data.get('comma')
    if given(raw_part) and given(raw_comma):
        raise ValidationError("Indicare la parte o il comma dell'articolo, non entrambi")
    if given(raw_part):
        part = normalize_range(raw_part)
        if part is None:
            raise ValidationError(f"Parte non valida: {str(raw_part)[:40]} (per esempio «701-800»)")
        return part, None
    if given(raw_comma):
        comma = normalize_comma(raw_comma)
        if comma is None:
            raise ValidationError(f"Comma non valido: {str(raw_comma)[:40]} (per esempio «773»)")
        return None, comma
    return None, None


def _read_page_extras(raw, article, tree_raw=None):
    """(update notes, parts) of one cached Normattiva page, each None when unreadable: one
    reader's failure never costs the other's answer. A part's page has no tree: its parts
    are read from the article's page (`tree_raw`)."""
    try:
        notes = extract_update_notes(raw, article=article)
    except Exception as exc:  # noqa: BLE001 - best effort by contract
        log.warning("Update notes could not be read", error=str(exc))
        notes = None
    try:
        parts = extract_parts(tree_raw or raw, article=article)
    except Exception as exc:  # noqa: BLE001 - best effort by contract
        log.warning("Article parts could not be read", error=str(exc))
        parts = None
    return notes, parts


class NormaController:
    def __init__(self):
        self.app = Quart(__name__)
        self.app = cors(self.app, allow_origin=ALLOWED_ORIGINS)
        self.fetch_queue = RateLimitedTaskQueue(FETCH_QUEUE_WORKERS, FETCH_QUEUE_DELAY)
        self._cache_sweep: asyncio.Task | None = None

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
        self._cache_sweep = asyncio.create_task(self._sweep_caches())
        log.info("Background services started")

    async def stop_background_services(self):
        await self.fetch_queue.stop()
        if self._cache_sweep is not None:
            self._cache_sweep.cancel()
            await asyncio.gather(self._cache_sweep, return_exceptions=True)
            self._cache_sweep = None
        await cleanup_browser_pool()
        log.info("Background services stopped and browser pool cleaned up")

    async def _sweep_caches(self):
        """Expired court-decision cache entries are deleted at start and then every
        DECISION_CACHE_SWEEP_SECONDS: the filesystem cache deletes one only when its key is
        read again. The Normattiva pages are pruned on the same beat (cache_manager's rule),
        and the exported PDFs older than two days are deleted (`sweep_exported_pdfs`).
        A failed sweep is logged and the next one runs on time."""
        while True:
            try:
                await sweep_decision_caches()
            except Exception:
                log.exception("Decision cache sweep failed")
            try:
                await prune_normattiva_cache()
            except Exception:
                log.exception("Normattiva cache prune failed")
            try:
                removed = await asyncio.to_thread(sweep_exported_pdfs, os.path.join(os.getcwd(), "download"))
                if removed:
                    log.info("Exported PDFs swept", removed=removed)
            except Exception:
                log.exception("Exported PDF sweep failed")
            await asyncio.sleep(DECISION_CACHE_SWEEP_SECONDS)


    async def stream_article_text(self):
        """
        Endpoint che invia in streaming i risultati della ricerca degli articoli.
        I risultati vengono inviati man mano che vengono trovati.
        Brocardi is no longer a source (D-078): a `show_brocardi_info` flag
        from an older client is ignored and no line carries Brocardi fields.
        """
        data = await request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400
        log.info("Received data for stream_article_text", data=data)
        add_to_history(data)
        # This is the endpoint the search box actually calls. Nothing caught the
        # exceptions raised while building the NormaVisitata list, so a rejected
        # article ("non presente in ...") or a missing act_type reached Quart's
        # default handler and became a 500 HTML page: no JSON, no message, and
        # not the NDJSON the frontend parses.
        try:
            normavisitate = await self.create_norma_visitata_from_data(data)
            upcoming_asked, until = _upcoming_of(data)
        except Exception as exc:
            return self._error_response(exc, 'stream_article_text')
        log.info("NormaVisitata instances created", normavisitate=[nv.to_dict() for nv in normavisitate])

        async def result_generator():
            for nv in normavisitate:
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    result = {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}
                    yield json.dumps(result) + "\n"
                    continue

                try:
                    article_text, url, validity, extra = await self._document_in_force(
                        scraper, nv, upcoming_asked, until)
                    result = {
                        'article_text': article_text,
                        'norma_data': nv.to_dict(),
                        'url': url
                    }
                    if validity:
                        result['validity'] = validity
                    result.update(extra)
                    result.update(await self._page_extras_for(scraper, nv, url, article_text))

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
        client_ip = client_address(
            request.headers.get('X-Forwarded-For'), request.remote_addr, TRUSTED_PROXIES
        )
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
        # Up to 200 strings read as /parse_query reads one, and no further: no URN, no request
        # out, no string in the logs. «Analizza documento» (design 2026-10-29-document-analysis
        # §4.4). Routed by the ingress's /parse_query* and Vite's '/parse_query' prefix; priced
        # by the scrape gate on its own path.
        self.app.add_url_rule('/parse_query_batch', view_func=self.parse_query_batch, methods=['POST'])
        # The addresses of up to 200 norms for the links of a filing, null with a reason instead
        # of any guess; counts only in the logs. «Analizza documento» puts the hyperlinks in
        # (design 2026-10-31-document-hyperlinks §3.1). Routed by the ingress's @legal and Vite's
        # proxy; priced 5 points by the scrape gate.
        self.app.add_url_rule('/fetch_norm_links', view_func=self.fetch_norm_links, methods=['POST'])
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
        self.app.add_url_rule('/fetch_recitals', view_func=self.fetch_recitals, methods=['POST'])
        self.app.add_url_rule('/fetch_act_fingerprints', view_func=self.fetch_act_fingerprints, methods=['POST'])
        self.app.add_url_rule('/fetch_decision', view_func=self.fetch_decision, methods=['POST'])
        self.app.add_url_rule('/fetch_decision_pdf', view_func=self.fetch_decision_pdf, methods=['POST'])
        self.app.add_url_rule('/search_decisions', view_func=self.search_decisions, methods=['POST'])
        self.app.add_url_rule('/search_eu_case_law', view_func=self.search_eu_case_law, methods=['POST'])
        self.app.add_url_rule('/fetch_alias_catalog', view_func=self.fetch_alias_catalog, methods=['GET'])
        # Internal: MERL-T's MassimarioAdapter only. Not routed by the ingress
        # (infra/ingress/Caddyfile routes an allowlist of prefixes) nor proxied by Vite.
        self.app.add_url_rule('/fetch_massimario', view_func=self.fetch_massimario, methods=['GET'])
        # Internal: MERL-T's MassimarioAdapter only (not routed by the ingress).
        self.app.add_url_rule('/resolve_act_dates', view_func=self.resolve_act_dates, methods=['POST'])
        # The Massimario's reviews citing a norm, from the core's store (design
        # 2026-10-30-rassegne-without-merlt, G-394): read by the article page. The web and the
        # ingress take it in the next PR (Vite proxy, the ingress's @legal list, behind the login).
        self.app.add_url_rule('/fetch_rassegne', view_func=self.fetch_rassegne, methods=['GET'])
        # Internal: a volume's paragraph records for MERL-T's ingestion. Not routed by the
        # ingress nor proxied by Vite, like /fetch_massimario.
        self.app.add_url_rule('/massimario/volume/<volume_id>/records', view_func=self.massimario_volume_records,
                              methods=['GET'])
        # Internal: the server's POST /api/dossiers/:id/decisions only (design 2026-10-12 §2.1).
        # Not routed by the ingress (/parse_query* does not cover it) nor proxied by Vite.
        self.app.add_url_rule('/parse_decision', view_func=self.parse_decision, methods=['POST'])
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
        part, comma = _part_request(data)

        # Normattiva answers a date after today with the current text and says
        # nothing. Refused here, before any network call, so that no door skips
        # it: every handler that reads an article starts from this method. A request
        # that asks explicitly for the text not in force yet (`upcoming: true`, G-357)
        # may name a later day; it is read undated, the latest version.
        upcoming_asked = data.get('upcoming') is True
        if upcoming_asked:
            read_upcoming_request(data.get('version'), data.get('version_date'))
        else:
            reject_original_with_a_date(data.get('version'), data.get('version_date'))
            reject_future_version_date(data.get('version_date'))

        address = await self.resolve_norm_address(data, one_article=bool(part or comma))
        norma, annex_value = address.norma, address.annex
        explicit_dispositivo, asked_annex = address.explicit_dispositivo, address.asked_annex

        norma_visitata_list = []
        missing_articles = []
        for cleaned_article, exists in address.checked:
            if exists is False:
                log.info("Requested article is not in the act",
                         article=cleaned_article, norma=str(norma))
                missing_articles.append(cleaned_article)
                continue

            norma_visitata_list.append(NormaVisitata(
                norma=norma,
                numero_articolo=cleaned_article,
                versione=data.get('version'),
                data_versione=None if upcoming_asked else data.get('version_date'),
                allegato=annex_value
            ))
            log.info("NormaVisitata instance created", norma_visitata=norma_visitata_list[-1])

        # A range like "1-50" on a 32-article act still returns the 32; only a
        # request where NOTHING exists is an error.
        if missing_articles and not norma_visitata_list:
            hint = ''
            named = '' if explicit_dispositivo else asked_annex
            if named is not None and len(missing_articles) == 1:
                hint = await self._where_else_in_tree(norma, missing_articles[0], named)
            # Named a part (an annex, or the dispositivo): the article may be elsewhere in the
            # act, so the refusal says which part it looked in, never "not in the act".
            if explicit_dispositivo:
                where = "nel testo di"
            else:
                where = f"nell'allegato {asked_annex} di" if asked_annex is not None else "in"
            raise ResourceNotFoundError(
                f"Articolo {', '.join(missing_articles)} non presente {where} {norma}{hint}"
            )

        if part or comma:
            await self._name_the_part(norma_visitata_list[0], part, comma)

        log.info("Created NormaVisitata instances", norma_visitata_list=[nv.to_dict() for nv in norma_visitata_list])
        return norma_visitata_list

    async def resolve_norm_address(self, data, one_article=False, strict=False):
        """Where a request's articles are: the act, its date, the part, the articles as the act
        spells them and whether the act holds them, with how sure each step is (`NormAddress`).

        The address half of `create_norma_visitata_from_data`, shared with `/fetch_norm_links`
        so that a fetch and a link cannot drift (design 2026-10-31-document-hyperlinks §3.1).
        The fetch keeps its guesses (the biggest annex, the body over an annex, the whole act
        when the index cannot be read); the link route reads `annex_basis`, `parts` and the
        existence answers and refuses every guess. `strict` (the link route) stops before any
        lookup when the date is not complete, never takes the AKN index's answer for a part it
        cannot locate, and checks no article whose part could not be read.

        Every line it logs that names the norm is at debug: the norms of a document the user
        may hold confidential pass here, and the logs keep counts only.
        """
        act_type = data.get('act_type')
        act_number = data.get('act_number')
        norma_date = data.get('date')

        # A consolidated EU version. Validated here so a Normattiva request
        # carrying the field fails loudly instead of being silently ignored.
        celex_consolidated = data.get('celex_consolidated') or None
        if celex_consolidated and normalize_act_type(act_type).lower() not in ('regolamento ue', 'direttiva ue'):
            raise ValidationError(
                "celex_consolidated vale solo per atti EUR-Lex (regolamento ue, direttiva ue)"
            )

        # Check if this is a codice with extractable details (e.g., "codice civile" -> "regio decreto 262/1942")
        codice_details = extract_codice_details(act_type) if act_type else None
        tipo_atto_reale = None
        if codice_details and not norma_date and not act_number:
            log.debug("Extracted codice details from URN map", codice_details=codice_details)
            norma_date = codice_details['data']
            act_number = codice_details['numero_atto']
            tipo_atto_reale = codice_details['tipo_atto_reale']
            # Note: we keep act_type as the alias (e.g., "codice civile") for display purposes

        date_unavailable = False
        if strict:
            # Whether a year stood only because Normattiva did not answer: «try again», not
            # «complete the date».
            norma_date, date_unavailable = await read_request_date(act_type, norma_date, act_number)
        else:
            norma_date = await complete_request_date(act_type, norma_date, act_number)
        log.debug("Using date", norma_date=norma_date)

        norma = Norma(
            tipo_atto=act_type,
            data=norma_date if norma_date else None,
            numero_atto=act_number,
            tipo_atto_reale=tipo_atto_reale,
            celex_consolidated=celex_consolidated
        )
        log.debug("Norma instance created", norma=norma)
        address = NormAddress(
            norma=norma,
            is_eu=norma.tipo_atto.lower() in EU_ACT_TYPES,
            date_complete=bool(norma.data and _ISO_DAY.match(norma.data)),
            date_unavailable=date_unavailable,
        )
        if strict and not address.is_eu and not address.date_complete:
            # The year stood: the address would carry «<year>-01-01», another act's day.
            return address

        articles = await parse_article_input(str(data.get('article') or ''), norma.url)
        log.debug("Articles parsed", articles=articles)

        # parse_article_input returns an error DICT rather than raising. Without
        # this guard the loop below iterates the dict's KEYS and builds one
        # NormaVisitata with numero_articolo='error', whose URN ends in ~arterror.
        if isinstance(articles, dict) and 'error' in articles:
            raise article_input_error(articles)
        if one_article and len(articles) != 1:
            raise ValidationError("La parte o il comma valgono per un solo articolo")
        address.articles = articles

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

        # The annex the caller named, before a code's default one is filled in: only
        # that one can be pointed elsewhere when the article is not in it.
        asked_annex = annex_value
        if explicit_dispositivo:
            address.annex_basis = 'dispositivo'
        elif annex_value is not None:
            address.annex_basis = 'asked'

        # If no annex specified (and not explicit dispositivo), check if this is a codice with a default annex
        # e.g., "codice civile" maps to "regio.decreto:1942-03-16;262:2" where :2 is the annex
        if annex_value is None and not explicit_dispositivo:
            normalized_type = normalize_act_type(act_type)
            # codice_urn() matches case-insensitively: six keys in the table
            # carry capitals ("codice del Terzo settore") while normalize_act_type
            # returns the table's own spelling, so a bare `in` test missed them
            # and those codici lost their default annex.
            codice_fragment = codice_urn(normalized_type)
            log.debug("Checking for default annex", act_type=act_type, normalized_type=normalized_type,
                      in_codici_map=bool(codice_fragment))
            if codice_fragment:
                log.debug("Found codice URN", codice_urn=codice_fragment)
                # Extract annex from URN pattern like "regio.decreto:1942-03-16;262:2"
                # The annex is after the last colon if there's a number;number:annex pattern
                annex_match = re.search(r';\d+:(\d+)$', codice_fragment)
                log.debug("Annex regex match", match=str(annex_match))
                if annex_match:
                    annex_value = annex_match.group(1)
                    address.annex_basis = 'table'
                    log.debug("Using default annex from codice URN", codice=normalized_type, default_annex=annex_value)
                    if normalized_type.lower() in CODE_ROWS_OF_SEVERAL_CODES:
                        # The row names two codes: the war code's article is not
                        # «non presente» in the codici penali militari, it is in annex 2.
                        asked_annex = annex_value
            else:
                # An act cited by type, date and number whose text is its annex (the TULPS,
                # annex 1 of r.d. 773/1931): keyed like a code, by the annex.
                annex_value = act_default_annex(norma.url)
                if annex_value:
                    address.annex_basis = 'table'
                    log.debug("Using the annex that is the act's text", act=norma.url, default_annex=annex_value)

        log.debug("Final annex value before smart lookup", annex=annex_value, explicit_dispositivo=explicit_dispositivo)

        # Smart article lookup: if no annex specified and not a hardcoded codice,
        # check if the article actually exists in the dispositivo or in an annex
        # SKIP smart lookup if user explicitly requested dispositivo (empty string)
        if annex_value is None and not explicit_dispositivo:
            address.annex_basis = 'not_looked_up'
        if annex_value is None and not explicit_dispositivo and norma.url:
            try:
                # Fetch tree with metadata to check article locations
                tree_result = await get_tree(norma.url, link=False, details=False, return_metadata=True)
                address.annex_basis = 'unread'
                if len(tree_result) == 3:
                    tree_data, tree_count, tree_metadata = tree_result
                    log.debug("Smart lookup: fetched tree", article_count=tree_count, has_metadata=bool(tree_metadata))

                    if tree_metadata and 'annexes' in tree_metadata and tree_count > 0:
                        address.annex_basis = 'lookup'
                        annexes = tree_metadata['annexes']
                        log.debug("Smart lookup: found annexes", annex_count=len(annexes))
                        # Each part's numbers as canonical keys, once: normalising them for
                        # every requested article cost ~0.6 s of blocking CPU on a range of
                        # 100 articles of a code.
                        part_keys = [
                            {comparable_article_key(art) for art in annex_info.get('article_numbers', [])}
                            for annex_info in annexes
                        ]

                        # For each requested article, check where it exists
                        for article in articles:
                            # Canonical keys on both sides, either spelling of the ordinal: the
                            # tree writes "21 nonies" and the request "21-nonies", and a raw
                            # comparison never found a suffixed article in its annex, so the
                            # request went to the dispositivo and Normattiva answered its art. 1.
                            wanted = comparable_article_key(article.strip())
                            wanted_keys = {wanted, other_ordinal_spelling(wanted)} - {None}
                            found_in_dispositivo = False
                            best_annex = None
                            best_annex_count = 0
                            # Every part that holds it: more than one is a guess below, which
                            # the link route refuses.
                            holding = address.parts.setdefault(article, [])

                            for annex_info, keys in zip(annexes, part_keys):
                                annex_num = annex_info.get('number')  # None for dispositivo
                                article_count = annex_info.get('article_count', 0)

                                # Check if article exists in this section
                                article_exists = not keys.isdisjoint(wanted_keys)

                                if article_exists:
                                    holding.append(annex_num)
                                    if annex_num is None:
                                        # Found in dispositivo
                                        found_in_dispositivo = True
                                        log.debug("Smart lookup: article found in dispositivo", article=article)
                                    else:
                                        # Found in an annex - track the one with most articles
                                        if article_count > best_annex_count:
                                            best_annex = annex_num
                                            best_annex_count = article_count
                                        log.debug("Smart lookup: article found in annex", article=article,
                                                  annex=annex_num, annex_article_count=article_count)

                            # If article NOT in dispositivo but found in annex, auto-redirect
                            if not found_in_dispositivo and best_annex is not None:
                                annex_value = best_annex
                                log.debug("Smart lookup: auto-redirecting to annex",
                                          article=article, target_annex=annex_value)
                                break  # Use same annex for all articles in this request

            except Exception as e:
                address.annex_basis = 'not_looked_up'
                # The type only at warning: the message may carry the act's address.
                log.warning("Smart lookup failed, proceeding without", error_type=type(e).__name__)
                log.debug("Smart lookup failure", error=str(e))

        log.debug("Final annex value after smart lookup", annex=annex_value)
        address.annex = annex_value
        address.explicit_dispositivo = explicit_dispositivo
        address.asked_annex = asked_annex

        # Where the existence check looks: the dispositivo alone ('') when the caller asked for
        # it explicitly, otherwise the annex settled above, or the whole act (None). Without
        # this an article that exists only in an annex passed the check, and Normattiva then
        # answered the dispositivo's request with its art. 1.
        scope = '' if explicit_dispositivo else annex_value
        # A part that could not be read is not a link: the article is not looked for.
        unlocated = strict and not address.is_eu and address.annex_basis in ('unread', 'not_looked_up')
        for article in articles:
            cleaned_article = article.strip().replace(' ', '-') if ' ' in article.strip() else article.strip()
            log.debug("Processing article", article=cleaned_article)
            if unlocated:
                address.checked.append((cleaned_article, None))
                continue
            cleaned_article, exists = await self._source_spelling(
                norma, cleaned_article, scope, akn_fallback=not strict)
            address.checked.append((cleaned_article, exists))
        return address

    async def _name_the_part(self, nv, part, comma):
        """Set `nv.parte` from the request's `parte` or `comma` (G-387 (a), G-389).

        The ranges come from the act's tree, which the existence check has just read (cached,
        no request). The first part has no `parte` (Q1): asked by its range or by one of its
        commas, it is the article as before, with the same keys. A comma of an article that is
        not split is in it: the article. A comma past the last range, a range the tree does not
        list, or a range of an article the tree lists whole, is a 404 in words. With a tree that
        cannot be read, a comma is a 503 in words (which part holds it cannot be told, and the
        first part must not be stored as if it did), and a range is left to the reader, which
        reads the article page itself; neither is ever «does not exist», and a request with
        neither fails open as before. EUR-Lex articles have no parts: a comma is in the article, a part is
        refused.
        """
        if self.get_scraper_for_norma(nv) is not normattiva_scraper:
            if part:
                raise ValidationError("Le parti di un articolo valgono solo per i testi di Normattiva")
            return
        ranges = await self._ranges_in_tree(nv)
        article = f"art. {nv.numero_articolo} di {nv.norma}"
        if comma:
            if ranges is None:
                # Which part holds the comma cannot be told: never the first part served as if it did.
                raise IndexUnavailableError(
                    f"Non riesco a leggere l'indice dell'{article} su Normattiva per trovare il comma {comma}: "
                    "riprova più tardi")
            if not ranges:
                return
            held = range_holding(ranges, comma)
            if held is None:
                first, last = ranges[0].split('-', 1)[0], ranges[-1].rsplit('-', 1)[-1]
                raise ResourceNotFoundError(f"Il comma {comma} non è nell'{article} (commi {first}-{last})")
            nv.parte = None if held == ranges[0] else held
            return
        if ranges == []:
            raise ResourceNotFoundError(f"L'{article} non è diviso in parti")
        if ranges and part == ranges[0]:
            return
        if ranges and part not in ranges:
            raise ResourceNotFoundError(
                f"L'{article} non ha la parte commi {part}: è diviso in {ranges_in_words(ranges)}")
        nv.parte = part

    async def _ranges_in_tree(self, nv):
        """The comma ranges of `nv`'s article in the act's tree, in order («1-100», …), `[]`
        when the tree lists it whole, None when the tree cannot be read."""
        try:
            tree_result = await get_tree(nv.norma.url, link=False, details=False, return_metadata=True)
        except Exception as exc:  # noqa: BLE001 - never fail the request on a tree error
            log.warning("Tree unavailable, parts not checked", error=str(exc))
            return None
        entries = tree_result[0] if isinstance(tree_result, (tuple, list)) and len(tree_result) == 3 else tree_result
        if isinstance(entries, str) or not entries:
            return None
        wanted = comparable_article_key(nv.numero_articolo)
        return [
            entry['commi'] for entry in entries
            if isinstance(entry, dict) and entry.get('commi')
            and str(entry.get('allegato') or '') == str(nv.allegato or '')
            and comparable_article_key(entry.get('numero', '')) == wanted
        ]

    async def _source_spelling(self, norma, article, annex, akn_fallback=True):
        """`article` as the act spells its ordinal, and whether the act holds it.

        Returns `(article, exists)`, `exists` as `_article_exists_in_tree` answers it.

        Two spellings circulate for 9, 15, 16, 18, 19 and 20 («novies» / «nonies», …) and
        Normattiva uses one per act: «391 novies» in the c.p.p., «21 nonies» in l.
        241/1990. Asked with the other one, the article was «non presente» (and its URN,
        `~art391nonies`, is not the act's). Only an article whose ordinal has another
        spelling is looked up, in the tree the existence check reads anyway; when the act
        holds the other spelling and not the one asked, the act's is used, so the URN and
        the stored norm are the act's. Anything else, the tree unreadable included, keeps
        what was asked. One existence check for any other article, at most two for one
        whose ordinal has two spellings (a tree that failed is not cached).
        `akn_fallback` as `_article_exists_in_tree` takes it.
        """
        exists = await self._article_exists_in_tree(norma, article, annex, akn_fallback)
        if exists is not False:
            return article, exists
        other = other_ordinal_spelling(comparable_article_key(article))
        if other is not None and await self._article_exists_in_tree(norma, other, annex, akn_fallback):
            log.debug("Article asked with the other spelling of its ordinal",
                      asked=article, act_spelling=other)
            return other, True
        return article, exists

    async def _article_exists_in_tree(self, norma, article, annex, akn_fallback=True):
        """Whether `article` is in the act's article tree.

        Returns True/False, or None when neither the tree nor the AKN index can
        be consulted — a Normattiva outage must not be reported to the user as
        "this article does not exist".

        `norma` is a Norma (the AKN cross-check needs the act, not just its URL);
        a bare act URL is also accepted, for the tree-only path.

        Article numbers are canonicalised on both sides with the AKN parser's
        `comparable_article_key` (`normalize_article_key`, with an ordinal split in
        two words joined: the tree's "135 sex decies" is the request's
        "135-sexdecies"): the tree API and the scraper disagree on the
        separator ("1-bis" vs "1 bis"). That normaliser reads the ordinal from
        the shared table in `tools/article_suffixes.py` and falls back to "any
        alphabetic tail" for anything the table does not list, which is
        load-bearing — Normattiva goes far past `decies` ("25 undecies",
        "25 quinquiesdecies", "25 duodevicies" in d.lgs. 231/2001,
        "669 terdecies" c.p.c., "2409 octiesdecies" c.c.) and a normaliser that
        stopped at its last entry would silently turn every article beyond it
        into "does not exist".

        `akn_fallback=False` (the link route) answers None for an unusable tree instead of
        asking the AKN index, which lists the act's articles without their part: the
        article may be in the act and not in the part asked.

        The lines it logs name no act: the address goes to debug.
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
            log.warning("Tree unavailable, skipping existence check", error_type=type(exc).__name__)
            log.debug("Tree unavailable", error=str(exc), url=str(act_url)[:100])
            return None

        # get_tree reports failures as a STRING in the articles slot.
        if isinstance(articles, str) or not articles:
            # The tree's message may quote the address: debug only.
            log.debug("Tree unusable", tree=str(articles)[:120], url=str(act_url)[:100])
            if not akn_fallback:
                return None
            index = await fetch_act_index(norma)
            if index is not None:
                log.info("Tree unusable, answered from the AKN index")
                wanted = comparable_article_key(article)
                return any(comparable_article_key(k) == wanted for k in index.keys)
            log.warning("Tree unusable and no AKN index, skipping existence check")
            return None

        wanted = comparable_article_key(article)
        for entry in articles:
            if not isinstance(entry, dict):
                continue  # section/annex labels are bare strings
            if annex is not None and str(entry.get('allegato') or '') != str(annex):
                continue
            if comparable_article_key(entry.get('numero', '')) == wanted:
                return True
        return False

    async def _where_else_in_tree(self, norma, article, annex):
        """Where else in the act the article is, as a sentence to append to the refusal,
        or '' when it is nowhere else or the tree cannot be read.

        Normattiva numbers an act's annexes by position, not by the act's own wording
        (the c.p.a. is «Allegato 1» of d.lgs. 104/2010 and annex 2 on Normattiva; the
        owner kept Normattiva's number as the identity, 11 October 2026), so a lawyer
        can name the annex the text names and miss. The tree is the one the existence
        check has just read (get_tree is cached): no new request.
        """
        try:
            tree_result = await get_tree(getattr(norma, 'url', None) or str(norma), link=False,
                                         details=False, return_metadata=True)
        except Exception:  # noqa: BLE001 - a hint never fails the refusal
            return ''
        articles = tree_result[0] if isinstance(tree_result, (tuple, list)) and len(tree_result) == 3 else tree_result
        if isinstance(articles, str) or not articles:
            return ''
        wanted = comparable_article_key(article)
        parts = []
        for entry in articles:
            if not isinstance(entry, dict) or comparable_article_key(entry.get('numero', '')) != wanted:
                continue
            part = str(entry.get('allegato') or '')
            if part != str(annex) and part not in parts:
                parts.append(part)
        if not parts:
            return ''
        annexes = [p for p in parts if p]
        places = []
        if '' in parts:
            places.append("nel testo dell'atto")
        if annexes:
            places.append(("nell'allegato " if len(annexes) == 1 else "negli allegati ") + ", ".join(annexes))
        return f": su Normattiva l'art. {article} si trova {' e '.join(places)}"

    def get_scraper_for_norma(self, normavisitata):
        act_type_normalized = normavisitata.norma.tipo_atto.lower()
        log.debug("Determining scraper for norma", act_type=act_type_normalized)
        if act_type_normalized in EU_ACT_TYPES:
            return eurlex_scraper
        else:
            return normattiva_scraper

    async def _document_in_force(self, scraper, nv, upcoming_asked=False, until=None):
        """The article's text and what goes with it: `(text, url, validity, extra)`, where
        `extra` holds the keys to add to the answer (`upcoming`, `not_in_force`, and for an
        explicit request a dated `norma_data`).

        A request with no date asks for the text in force, but Normattiva answers it
        with its latest version, also one not in force yet (art. 3 d.P.R. 131/1986 on
        21 October 2026: repealed from 1 January 2027). When the page's window starts
        after today (Europe/Rome), the text in force today is read instead (`!vig=` with
        today) and the later one is described in `upcoming` (owner, G-355). When nothing
        is in force today (an article inserted from a later day) the later text is served
        as before, marked `not_in_force` with `upcoming.change` "inserted" (G-358). A
        request for the later text (`upcoming_asked`, G-357) gets it, always marked
        `not_in_force` and with `norma_data` dated to the day it comes into force, so it
        reads as a text at a day and never as the text in force. A request with a date or
        for the original is served as asked (G-353). The norm keeps the request's
        identity otherwise, so its notes and highlights are keyed as before; if the second
        read fails the first page is served as it was, its validity saying when it starts.
        """
        article_text, url = await scraper.get_document(nv)
        if _asks_for_text_in_force(nv):
            validity = await self._validity_of_page(scraper, nv, url)
        else:
            validity = await self._validity_for(scraper, nv, url)
        later = bool(validity and _asks_for_text_in_force(nv) and starts_after_today(validity))
        if upcoming_asked:
            return await self._later_version(scraper, nv, article_text, url, validity, later, until)
        if not later:
            return article_text, url, validity, {}
        today = await self._text_today(scraper, nv)
        if today is None:
            return article_text, url, validity, {}
        text_today, url_today, validity_today = today
        if validity_today and validity_today.get('state') == 'not_yet':
            # Nothing is in force today: the article is inserted from the later day.
            log.info("Article inserted from a later day", url=str(url)[:120])
            return article_text, url, validity, {
                'upcoming': upcoming_change(validity, inserted=True), 'not_in_force': True,
            }
        if validity_today and starts_after_today(validity_today):
            # The source ignored the day: the first page stands, as before.
            return article_text, url, validity, {}
        log.info("Served the text in force today instead of a later version",
                 later_from=validity.get('valid_from'), url=str(url_today)[:120])
        return text_today, url_today, validity_today, {'upcoming': upcoming_change(validity, today=validity_today)}

    async def _text_today(self, scraper, nv):
        """`(text, url, validity)` of the article at today, its validity judged against an
        undated request; None when it cannot be read."""
        in_force = NormaVisitata(
            norma=nv.norma, allegato=nv.allegato, numero_articolo=nv.numero_articolo,
            versione='vigente', data_versione=today_in_rome().isoformat(),
            parte=getattr(nv, 'parte', None),
        )
        try:
            text_today, url_today = await scraper.get_document(in_force)
        except Exception as exc:  # noqa: BLE001 - the page already read still stands
            log.warning("Text in force today could not be read", error=str(exc))
            return None
        return text_today, url_today, await self._validity_of_page(scraper, nv, url_today, in_force)

    async def _validity_of_page(self, scraper, nv, url, page_nv=None):
        """`_validity_for`, reading the page once more when it has left the cache.

        The text comes from the scraper's memory (a day from when it was filled) and the
        page from the persistent cache (a day from when it was written): after a restart
        the page can expire first, and without it a later version would go out
        unrecognised, and today's text without its window. `page_nv` is the request that page
        answered, when it is not `nv` (today's text): a part's page is read again for it."""
        validity = await self._validity_for(scraper, nv, url)
        if (validity is None and isinstance(scraper, NormattivaScraper)
                and await self._page_left_the_cache(scraper, url, page_nv or nv)):
            validity = await self._validity_for(scraper, nv, url)
        return validity

    async def _later_version(self, scraper, nv, article_text, url, validity, later, until):
        """The text not in force yet, asked for explicitly (G-357), or the article's error
        saying there is none (or none in force on the day named), or that the page cannot be
        read: then nothing is known, and nothing is claimed."""
        if validity is None:
            raise ResourceNotFoundError(f"Non riesco a leggere la vigenza di {nv} su Normattiva")
        if not later:
            raise ResourceNotFoundError(f"Nessuna versione non ancora in vigore per {nv}")
        valid_from = validity['valid_from']
        today = await self._text_today(scraper, nv)
        inserted = bool(today and today[2] and today[2].get('state') == 'not_yet')
        if until and valid_from > until:
            between = 0 if inserted else versions_between(validity, today[2] if today else None)
            if between:
                # The day falls before the latest version, and other versions come first:
                # Normattiva shows only the latest, so the one of that day cannot be read.
                others = "ce n'è un'altra" if between == 1 else f"ce ne sono altre {between}"
                raise ResourceNotFoundError(
                    f"Non so dire quale versione di {nv} sia in vigore il {until}: prima di quella che "
                    f"entra in vigore il {valid_from} {others}, che Normattiva non mostra a parte")
            raise ResourceNotFoundError(
                f"La versione non ancora in vigore di {nv} entra in vigore il {valid_from}")
        upcoming = upcoming_change(validity, inserted=inserted, today=today[2] if today else None)
        if (today is None or today[2] is None) and upcoming['change'] == 'amended':
            # Today's page could not be read: an amendment cannot be told from an insertion.
            upcoming['change'] = None
        norma_data = dict(nv.to_dict(), versione='vigente', data_versione=valid_from)
        # The day the text is dated to is its own first day: the window holds it.
        served_validity = dict(validity, request_in_window=True)
        return article_text, url, served_validity, {
            'norma_data': norma_data,
            'upcoming': upcoming,
            'not_in_force': True,
        }

    @staticmethod
    async def _page_left_the_cache(scraper, url, nv=None):
        """True when the page for `url` was missing from the scraper's persistent cache
        and has been read again and stored; False when it was there, or cannot be read.
        A part's page is read again by the scraper, in the article page's session: its key
        is no address to request."""
        cache = getattr(scraper, 'cache', None)
        if cache is None or not url:
            return False
        try:
            if await cache.get(url):
                return False
            if PART_KEY_MARK in url:
                return bool(nv is not None and nv.parte and await scraper.read_part_page(nv))
            page = await scraper.request_document(url, source="normattiva")
            if not page:
                return False
            await cache.set(url, page)
            return True
        except Exception as exc:  # noqa: BLE001 - the text already read still stands
            log.warning("Page could not be read again for its validity", url=str(url)[:120], error=str(exc))
            return False

    @staticmethod
    async def _page_extras_for(scraper, nv, url, article_text):
        """What a Normattiva article page says beside its text, `{}` for any other source:
        its update notes (G-386) and the parts a split article is cut into (G-387).

        Read from the page `get_document` stored in the scraper's persistent cache under
        `url` (the served page, today's when a later version was set aside), once for both,
        so no request is made and `article_text` is never touched (gotcha 23). An undated
        request's page is already back if it had left the cache (`_validity_of_page`); a
        dated one is never read again for this, so after a restart its notes can come back
        unread, and say so. The AKN export's text, the last-resort fallback, opens with its
        markdown heading («### Art. …», which the HTML extractor never writes) and already
        holds its notes and the whole article.
        """
        if not isinstance(scraper, NormattivaScraper) or not nv.numero_articolo:
            return {}
        if isinstance(article_text, str) and article_text.startswith('###'):
            return {**update_notes_fields(None, akn_text=True), **parts_fields(None)}
        notes = parts = None
        try:
            cache = getattr(scraper, 'cache', None)
            raw = await cache.get(url) if cache is not None and url else None
            # A part's page (its key holds PART_KEY_MARK) has no tree: the article page has.
            tree_raw = await cache.get(article_page_key(url)) if raw and PART_KEY_MARK in url else None
            if isinstance(raw, str) and raw:
                notes, parts = await asyncio.to_thread(_read_page_extras, raw, nv.numero_articolo, tree_raw)
        except Exception as exc:  # noqa: BLE001 - best effort: the text already read stands
            log.warning("Page extras could not be read", error=str(exc), url=str(url)[:100])
        fields = {**update_notes_fields(notes), **parts_fields(parts)}
        if getattr(nv, 'parte', None):
            # A part is one part, also when the article page that lists them has left the cache.
            fields['testo_parziale'] = True
        return fields

    @staticmethod
    async def _validity_for(scraper, nv, url):
        """The window Normattiva's page states for this text, or None.

        Read from the page `get_document` has just stored in the scraper's own
        persistent cache (the key is the URN it returned), so it costs no request
        and never touches the text. Only Normattiva pages carry the statement;
        EUR-Lex answers None. Never raises.
        """
        if not isinstance(scraper, NormattivaScraper):
            return None
        return await read_validity(
            getattr(scraper, 'cache', None), url,
            article=nv.numero_articolo, requested_date=nv.data_versione,
        )

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
        elif isinstance(exc, IndexUnavailableError):
            # The act's index could not be read: the request may work later.
            status = 503
        else:
            status = 500
        log.error("Request failed", endpoint=endpoint, status=status,
                  error=str(exc), error_type=type(exc).__name__)
        return jsonify({'error': str(exc)}), status

    async def fetch_norma_data(self):
        try:
            data = await request.get_json()
            if not data:
                return jsonify({'error': 'Request body required'}), 400
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

            # 1-2. Preset alias first ("gdpr" → Regolamento UE 2016/679), then the NL
            # parser ("art 1453 cc", "art 3 cost"): the reading /parse_query_batch shares.
            parsed_params, source = read_norm_query(query)
            if parsed_params is None:
                return jsonify({"parsed": None, "recognized": False, "identifies_act": False})

            # 3. Best-effort URN: build a NormaVisitata with the same pipeline
            # `fetch_norma_data` uses, then pick its .urn. If the URN cannot be
            # generated (e.g. missing pieces, scraper hiccup) we still return
            # the parsed params so the FE can prompt for the missing field.
            urn = None
            display = None
            try:
                try:
                    normavisitate = await self.create_norma_visitata_from_data(parsed_params)
                except IndexUnavailableError:
                    # Which part holds the comma cannot be told now; the article's URN can (it names no part).
                    normavisitate = await self.create_norma_visitata_from_data(
                        {k: v for k, v in parsed_params.items() if k not in ('comma', 'parte')})
                if normavisitate:
                    nv = normavisitate[0]
                    urn = getattr(nv, "urn", None)
                    # The citation in the owner's style (source convention), from the norm
                    # as resolved: «art. 2, l. 7 agosto 1990, n. 241», never «Art. 2 — legge».
                    # A query with no article names the act alone (the URN's article 1
                    # is only the probe create_norma_visitata_from_data needs).
                    article = str(parsed_params.get("article") or "").strip()
                    if not article:
                        display = cite_act(nv.to_dict())
                    elif re.search(r",|^\d+\s*-\s*\d+$", article):
                        listed = ", ".join(part.strip() for part in article.split(","))
                        display = "artt." + cite_article({**nv.to_dict(), "numero_articolo": listed})[len("art."):]
                    else:
                        display = cite_article({**nv.to_dict(), "numero_articolo": article})
            except Exception as e:
                log.warning("parse_query URN build failed", error=str(e))

            return jsonify({
                "recognized": True,
                "parsed": parsed_params,
                # The convention's predicate (act_identity.py): «art. 2 d.m.» reads, and names no act.
                "identifies_act": identifies_act(parsed_params),
                "urn": urn,
                "display": display,
                "source": source,
            })
        except Exception as e:
            log.error("Error in parse_query", error=str(e))
            return jsonify({"error": str(e)}), 500

    async def parse_query_batch(self):
        """Read up to 200 norms, each as `/parse_query` reads one, and stop at the reading.

        Body `{"queries": [string, ...]}`: 1 to 200 strings, each non-empty and at most 200
        characters, the body at most 48 KB. Anything else is a 400 that names the limit.
        Answer `{"results": [{recognized, parsed, source, identifies_act}]}`, in the order
        asked. No URN, so no request leaves (the URN step asks Normattiva and logs the norm);
        the log line holds the count and the duration, never a string: the strings are the
        citations of a document the user may hold confidential (design
        2026-10-29-document-analysis §4.4, §6.2).
        """
        started = time()
        try:
            if (request.content_length or 0) > PARSE_BATCH_MAX_BYTES:
                return jsonify({"error": f"Body over {PARSE_BATCH_MAX_BYTES // 1024} KB"}), 400
            raw = await request.get_data()
            if len(raw) > PARSE_BATCH_MAX_BYTES:
                return jsonify({"error": f"Body over {PARSE_BATCH_MAX_BYTES // 1024} KB"}), 400
            try:
                data = json.loads(raw)
            except (ValueError, RecursionError):  # 48 KB of «[[[[…» passes the parser's depth
                return jsonify({"error": "Body must be JSON"}), 400
            queries = data.get("queries") if isinstance(data, dict) else None
            if not isinstance(queries, list) or not queries:
                return jsonify({"error": "queries must be a non-empty list"}), 400
            if len(queries) > PARSE_BATCH_MAX_QUERIES:
                return jsonify({"error": f"At most {PARSE_BATCH_MAX_QUERIES} queries"}), 400
            for query in queries:
                if not isinstance(query, str) or not query.strip():
                    return jsonify({"error": "Each query must be a non-empty string"}), 400
                if len(query) > PARSE_BATCH_MAX_CHARS:
                    return jsonify({"error": f"Each query at most {PARSE_BATCH_MAX_CHARS} characters"}), 400

            # Regexes and table lookups, a few ms for 200 strings: off the event loop all the same.
            results, failed = await asyncio.to_thread(_read_norm_queries, [q.strip() for q in queries])
            log.info("parse_query_batch", queries=len(queries), failed=failed,
                     duration_ms=round((time() - started) * 1000))
            return jsonify({"results": results})
        except Exception as e:
            # The type only: an exception's message may quote the string that raised it.
            log.error("Error in parse_query_batch", error_type=type(e).__name__)
            return jsonify({"error": "Internal error"}), 500

    async def fetch_norm_links(self):
        """The source's address of each norm, for the links of a filing, and no guess.

        Body `{"norms": [{act_type, act_number?, date?, article, annex?}, ...], "pin_day"?}`:
        1 to 200 norms of at most 30 distinct acts, one article each, the body at most 48 KB;
        anything else is a 400 that names the limit. Answer `{"results": [{href, reason}]}` in
        the order asked, `href` set only with reason `ok` (`LINK_REASONS`; design
        2026-10-31-document-hyperlinks §3.1). Each norm goes through `resolve_norm_address`, the
        fetch's own address function, strict: a year not completed is `date_incomplete`, an
        article in more than one part `ambiguous_part`, an index or a source that does not
        answer `source_unavailable` (never the act's text by default). The address is the text
        in force on `pin_day`, today in Rome when absent (G-395); an act of the Union links its
        EUR-Lex page, which has no address per article. The whole call has LINKS_BATCH_BUDGET
        seconds: what is not settled by then is `source_unavailable`. The log line holds the
        counts and the duration, never a norm: they are the citations of a document the user may
        hold confidential.
        """
        started = time()
        try:
            if (request.content_length or 0) > LINKS_BATCH_MAX_BYTES:
                return jsonify({"error": f"Body over {LINKS_BATCH_MAX_BYTES // 1024} KB"}), 400
            raw = await request.get_data()
            if len(raw) > LINKS_BATCH_MAX_BYTES:
                return jsonify({"error": f"Body over {LINKS_BATCH_MAX_BYTES // 1024} KB"}), 400
            try:
                data = json.loads(raw)
            except (ValueError, RecursionError):
                return jsonify({"error": "Body must be JSON"}), 400
            items = data.get("norms") if isinstance(data, dict) else None
            if not isinstance(items, list) or not items:
                return jsonify({"error": "norms must be a non-empty list"}), 400
            if len(items) > LINKS_BATCH_MAX_NORMS:
                return jsonify({"error": f"At most {LINKS_BATCH_MAX_NORMS} norms"}), 400
            norms = []
            for item in items:
                norm = _link_norm(item)
                if isinstance(norm, str):
                    return jsonify({"error": norm}), 400
                norms.append(norm)
            pin_day, refused = _link_pin_day(data.get("pin_day"))
            if refused:
                return jsonify({"error": refused}), 400

            # Each distinct norm once, grouped by act.
            acts, keys = {}, []
            for norm in norms:
                key = tuple(norm.get(field) for field in _LINK_FIELDS)
                keys.append(key)
                acts.setdefault(_link_act_key(norm), {})[key] = norm
            if len(acts) > LINKS_BATCH_MAX_ACTS:
                return jsonify({"error": f"At most {LINKS_BATCH_MAX_ACTS} distinct acts"}), 400

            budget = LINKS_BATCH_BUDGET - (time() - started)
            settled = await self._norm_links(acts.values(), pin_day, budget)
            results = []
            for key in keys:
                href, reason = settled.get(key, (None, 'source_unavailable'))
                results.append({"href": href, "reason": reason})
            log.info("fetch_norm_links", norms=len(norms), distinct=sum(len(n) for n in acts.values()),
                     acts=len(acts), reasons=dict(Counter(r["reason"] for r in results)),
                     duration_ms=round((time() - started) * 1000))
            return jsonify({"results": results})
        except Exception as e:
            # The type only: an exception's message may quote a norm.
            log.error("Error in fetch_norm_links", error_type=type(e).__name__)
            return jsonify({"error": "Internal error"}), 500

    async def _norm_links(self, acts, pin_day, budget):
        """`{norm key: (href, reason)}` for the norms settled within `budget` seconds: the acts
        LINKS_ACT_CONCURRENCY at a time, the norms of one act in turn (its date and index are
        read once, then cached; when either fails, the act's other norms take the same reason
        without asking again). A norm left out was not settled in time."""
        settled = {}
        gate = asyncio.Semaphore(LINKS_ACT_CONCURRENCY)

        async def one_act(norms):
            async with gate:
                act_failed = None
                for key, norm in norms.items():
                    refused = _link_refused_before_lookup(norm)
                    if refused:
                        settled[key] = (None, refused)
                        continue
                    if act_failed is not None:
                        # The act's date or index did not come: a failure is not cached, and
                        # asking again for each of its norms would hold the source's queue.
                        settled[key] = act_failed
                        continue
                    href, reason, act_wide = await self._norm_link(norm, pin_day)
                    settled[key] = (href, reason)
                    if act_wide:
                        act_failed = (None, reason)

        tasks = [asyncio.create_task(one_act(norms)) for norms in acts]
        _done, pending = await asyncio.wait(tasks, timeout=max(budget, 0))
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        return settled

    async def _norm_link(self, norm, pin_day):
        """`(href, reason, act_wide)` for one norm: `resolve_norm_address`, strict, and every
        guess of the fetch path refused (design 2026-10-31-document-hyperlinks §3.1).
        `act_wide` is true when the reason holds for every norm of the act: its date not
        completed, its index or its date lookup not answering."""
        refused = _link_refused_before_lookup(norm)
        if refused:
            return None, refused, False
        try:
            address = await self.resolve_norm_address(norm, strict=True)
        except (ValidationError, ValueError):
            # A type with no address, a date or an article that cannot be read.
            return None, 'not_linkable', False
        except ResourceNotFoundError:
            return None, 'article_missing', False
        except Exception as exc:  # noqa: BLE001 - the index, the rate limit, the network
            log.warning("fetch_norm_links: a norm not settled", error_type=type(exc).__name__)
            return None, 'source_unavailable', True
        if not address.is_eu and not address.date_complete:
            # The year stood: «<year>-01-01» is another act's day, never sent as an address.
            # Normattiva silent or slow is the source's fault, not the text's: «Riprova».
            return None, ('source_unavailable' if address.date_unavailable else 'date_incomplete'), True
        if len(address.checked) != 1:
            return None, 'not_linkable', False
        article, exists = address.checked[0]
        if not address.is_eu:
            if address.annex_basis in ('unread', 'not_looked_up'):
                return None, 'source_unavailable', True
            if address.annex_basis == 'lookup' and len(address.parts.get(address.articles[0], ())) > 1:
                # The body and an annex, or two annexes: the fetch's guess is never a link.
                return None, 'ambiguous_part', False
        if exists is None:
            # The index of the part did not answer (a code's annex, an EU act's page).
            return None, 'source_unavailable', True
        if exists is False:
            return None, 'article_missing', False
        if address.is_eu:
            href = address.norma.url
        else:
            href = NormaVisitata(norma=address.norma, numero_articolo=article, versione='vigente',
                                 data_versione=pin_day, allegato=address.annex).urn
        href = _source_href(href)
        return (href, 'ok', False) if href else (None, 'not_linkable', False)

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
            # A regex pass over up to 500 KB of text: off the event loop (CLAUDE.md async rule)
            citations = await asyncio.to_thread(
                extract_citations_from_text, text, context_act_type=context_act_type
            )
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
            if not data:
                return jsonify({'error': 'Request body required'}), 400
            log.info("Received data for fetch_article_text", data=data)
            add_to_history(data)

            normavisitate = await self.create_norma_visitata_from_data(data)
            upcoming_asked, until = _upcoming_of(data)
            log.info("NormaVisitata instances created", normavisitate=[nv.to_dict() for nv in normavisitate])

            async def fetch_text(nv):
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    log.warning("Unsupported act type for scraper", norma_data=nv.to_dict())
                    return {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}

                try:
                    article_text, url, validity, extra = await self._document_in_force(
                        scraper, nv, upcoming_asked, until)
                    log.info("Document fetched successfully", article_text=article_text, url=url)
                    result = {
                        'article_text': article_text,
                        'norma_data': nv.to_dict(),
                        'url': url
                    }
                    if validity:
                        result['validity'] = validity
                    result.update(extra)
                    result.update(await self._page_extras_for(scraper, nv, url, article_text))
                    return result
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
            if not data:
                return jsonify({'error': 'Request body required'}), 400
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
            # The act's title (its subject) comes from the same page.
            if 'eur-lex' in str(urn):
                try:
                    _, _, tree_metadata = await get_tree(
                        urn, link=False, details=True, return_metadata=True
                    )
                    rubriche = (tree_metadata or {}).get('rubriche') or {}
                    title = (tree_metadata or {}).get('title') or ''
                except Exception as exc:  # noqa: BLE001
                    log.warning("EUR-Lex rubriche unavailable",
                                urn=str(urn)[:100], error=str(exc))
                    rubriche, title = {}, ''
                log.info("Rubriche served (EUR-Lex)", urn=str(urn)[:100], count=len(rubriche))
                return jsonify({
                    'title': title,
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
                return jsonify({'title': '', 'rubriche': {}, 'abrogati': [], 'parts': [], 'count': 0})

            log.info("Rubriche served", urn=act_url[:100],
                     count=len(index.rubriche), parts=len(index.parts_detail))
            return jsonify({
                # The act's title as a heading: the dossier names each act with it.
                'title': presentable_title(index.title),
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
            return jsonify({'title': '', 'rubriche': {}, 'abrogati': [], 'parts': [], 'count': 0, 'error': str(e)})

    async def fetch_recitals(self):
        """All the considerando of an EU act, in one call.

        A separate endpoint rather than a flag on /stream_article_text: a
        recital is not an article — no URN, no annex, no Brocardi — and the
        archive that consumes this wants the whole preamble at once. The
        page is the one the tree and the articles already come from, cached
        for 24 h, so the call costs one parse and no network on a warm cache.
        Consolidated texts have no preamble; they answer an empty list.
        """
        try:
            data = await request.get_json() or {}
            act_type = data.get('act_type')
            if not act_type:
                raise ValidationError("Campo obbligatorio mancante: act_type")
            if normalize_act_type(act_type).lower() not in ('regolamento ue', 'direttiva ue'):
                raise ValidationError(
                    "fetch_recitals accetta solo atti EUR-Lex (regolamento ue, direttiva ue)"
                )
            # Validate before building the Norma: the EUR-Lex URL is built
            # from these two fields, and a missing or malformed one used to
            # send Playwright to ".../reg/None/None/oj/ita" (or raise a
            # ValueError out of Norma.__post_init__ into a 500) to discover
            # what a regex tells for free.
            # ASCII digits: `\d` alone accepts other scripts' digits, which
            # do not belong in a URL.
            act_number = str(data.get('act_number') or '').strip()
            if not re.fullmatch(r'\d+', act_number, re.ASCII):
                raise ValidationError(
                    "Campo act_number mancante o non valido: atteso il numero dell'atto (es. 679)"
                )
            date = str(data.get('date') or '').strip()
            if not re.fullmatch(r'\d{4}(-\d{2}-\d{2})?', date, re.ASCII):
                raise ValidationError(
                    "Campo date mancante o non valido: atteso l'anno (es. 2016) o una data AAAA-MM-GG"
                )
            norma = Norma(tipo_atto=act_type, data=date, numero_atto=act_number)
            recitals, url = await eurlex_scraper.get_recitals(norma)
            return jsonify({'recitals': recitals, 'count': len(recitals), 'url': url})
        except Exception as exc:
            return self._error_response(exc, 'fetch_recitals')

    async def search_decisions(self):
        """Decisions whose text mentions an article or a topic (design 2026-10-05 §5). JSON with
        `esito`: risultati and non_supportata 200, richiesta_non_valida 400,
        fonte_non_raggiungibile 503, errore_interno 500 (a bug: a fixed body).

        Answers this handler does not write are not JSON with `esito`: the per-IP rate limit
        (429 `{"error": …}`) and the login gate's 401 or 429, passed through by the ingress,
        come before it; the framework answers with its own pages a method other than POST or
        OPTIONS (405), a stalled body (408) and a body over 16 MB (413; 1 MB behind the
        ingress, whose own page answers)."""
        try:
            body = await request.get_json(silent=True)
        except (RecursionError, UnicodeDecodeError):
            body = None
        try:
            answer, status = await search_decisions_route(body)
        except Exception:
            log.exception("Decision search failed unexpectedly")
            return jsonify({'esito': 'errore_interno'}), 500
        return jsonify(answer), status

    async def search_eu_case_law(self):
        """The decisions of the Court of Justice and the General Court that cite an article of
        an act of the Union (design 2026-10-12 §D1): `{celex, articolo}`. JSON with `esito`:
        risultati and non_supportata (a CELEX that is not a regulation, a directive or a
        decision) 200, richiesta_non_valida 400, fonte_non_raggiungibile 503, errore_interno 500
        (a bug: a fixed body). A source that cannot be reached is never an empty list.

        Answers this handler does not write are not JSON with `esito`: the per-IP rate limit
        (429 `{"error": …}`) and the login gate's 401 or 429, passed through by the ingress,
        come before it; the framework answers with its own pages a method other than POST or
        OPTIONS (405), a stalled body (408) and a body over 16 MB (413; 1 MB behind the
        ingress, whose own page answers)."""
        try:
            body = await request.get_json(silent=True)
        except (RecursionError, UnicodeDecodeError):
            body = None
        if not isinstance(body, dict):
            return jsonify({'esito': 'richiesta_non_valida',
                            'errori': {'body': 'atteso un oggetto JSON'}}), 400
        try:
            answer, status = await search_eu_case_law_route(body.get('celex'), body.get('articolo'))
        except Exception:
            log.exception("EU case law search failed unexpectedly")
            return jsonify({'esito': 'errore_interno'}), 500
        return jsonify(answer), status

    async def fetch_decision_pdf(self):
        """The court's own PDF of a Cassazione decision (design 2026-10-05 §12.2): `200
        application/pdf` with `Content-Disposition: attachment`, or JSON with `esito`:
        non_disponibile 404 (no PDF named, a withheld text, an answer that is not the decision's
        PDF), richiesta_non_valida 400, fonte_non_raggiungibile 503, errore_interno 500 (a bug:
        a fixed body).

        Answers this handler does not write are not JSON with `esito`: the per-IP rate limit
        (429 `{"error": …}`) and the login gate's 401 or 429, passed through by the ingress,
        come before it; the framework answers with its own pages a method other than POST or
        OPTIONS (405), a stalled body (408) and a body over 16 MB (413; 1 MB behind the
        ingress, whose own page answers)."""
        try:
            body = await request.get_json(silent=True)
        except (RecursionError, UnicodeDecodeError):
            body = None
        try:
            answer, status, headers = await fetch_decision_pdf_route(body, _date.today().year)
        except Exception:
            log.exception("Decision PDF failed unexpectedly")
            return jsonify({'esito': 'errore_interno'}), 500
        if isinstance(answer, bytes):
            return Response(answer, status=status, headers=headers)
        return jsonify(answer), status

    async def fetch_decision(self):
        """One court decision by its reference (design 2026-10-01 §3). Every answer this
        handler writes is JSON with `esito`: trovata and ambigua 200, non_trovata 404,
        fonte_non_raggiungibile 503, richiesta_non_valida 400, errore_interno 500 (a bug: a
        fixed body). A source that cannot be reached is never "non trovata".

        Answers this handler does not write are not: the per-IP rate limit (429
        `{"error": …}`) and the login gate's 401 or 429, passed through by the ingress, come
        before it; the framework answers with its own pages a method other than POST or
        OPTIONS (405), a stalled body (408) and a body over 16 MB (413; 1 MB behind the
        ingress, whose own page answers)."""
        try:
            body = await request.get_json(silent=True)
        except (RecursionError, UnicodeDecodeError):
            # a nesting bomb or bytes that are not UTF-8: the caller's fault
            body = None
        try:
            reference = parse_reference(body)
        except InvalidReference as exc:
            return jsonify({'esito': 'richiesta_non_valida', 'errori': exc.errors}), 400
        try:
            outcome = await get_resolver().resolve(reference)
            payload = outcome.to_dict()
        except SourceUnavailable as exc:
            log.warning("Decision source unreachable", fonte=exc.fonte, error=str(exc))
            return jsonify({'esito': 'fonte_non_raggiungibile', 'fonte': exc.fonte}), 503
        except Exception:
            # a bug, never the caller's or the source's fault: a fixed body, the details in the log
            log.exception("Decision lookup failed", corte=reference.corte,
                          numero=reference.numero, anno=reference.anno)
            return jsonify({'esito': 'errore_interno'}), 500
        status = 404 if outcome.esito == 'non_trovata' else 200
        return jsonify(payload), status

    async def fetch_massimario(self):
        """One element of the Massimario portal, raw. Internal route (MERL-T only)."""
        try:
            kind = request.args.get('kind', '')
            element_id = request.args.get('id', '')
            data = await massimario_portal.fetch_element(kind, element_id)
            return jsonify({'kind': kind, 'id': element_id, 'data': data})
        except Exception as exc:
            return self._error_response(exc, 'fetch_massimario')

    async def fetch_rassegne(self):
        """The Massimario's review paragraphs citing a norm, by year, a page at a time
        (`rassegne_routes`): 200 (`total: 0` when no store is built), 400
        `richiesta_non_valida`, 503 `rassegne_non_disponibili` (a store that cannot be read or
        of an unknown schema). Reads a local file only."""
        try:
            answer, status = await rassegne_routes.fetch_rassegne(request.args)
        except Exception:
            log.exception("Rassegne lookup failed unexpectedly")
            return jsonify({'detail': 'errore_interno'}), 500
        return jsonify(answer), status

    async def massimario_volume_records(self, volume_id):
        """A volume's paragraph records and parse report from the store. Internal route
        (MERL-T): 200, 400, 404 `volume_non_presente`, 503 `rassegne_non_disponibili`."""
        try:
            answer, status = await rassegne_routes.volume_records(volume_id)
        except Exception:
            log.exception("Massimario volume records failed unexpectedly")
            return jsonify({'detail': 'errore_interno'}), 500
        return jsonify(answer), status

    async def parse_decision(self):
        """Decisions as a lawyer writes them → the references /fetch_decision takes (design
        2026-10-12 §2.1). Internal route (the server's decisions route). `{citazioni: [1-10
        strings of at most 300 characters]}` → `{risultati: [...]}`, one per string, in order:
        `{riferimento}`, `{corte_non_supportata}` or `{non_riconosciuta: true}`. No request
        leaves: it reads words only."""
        try:
            body = await request.get_json(silent=True)
        except (RecursionError, UnicodeDecodeError):
            body = None
        citazioni = body.get('citazioni') if isinstance(body, dict) else None
        if (not isinstance(citazioni, list) or not 1 <= len(citazioni) <= 10
                or not all(isinstance(c, str) and 0 < len(c) <= 300 for c in citazioni)):
            return jsonify({'esito': 'richiesta_non_valida',
                            'errori': {'citazioni': 'attese da 1 a 10 citazioni di al massimo 300 caratteri'}}), 400
        return jsonify({'risultati': [read_decision_citation(c).to_dict() for c in citazioni]})

    async def resolve_act_dates(self):
        """Full dates for acts cited by year only. Internal route (MERL-T only)."""
        try:
            data = await request.get_json() or {}
            return jsonify({'resolved': await act_dates.resolve_many(data.get('urns'))})
        except Exception as exc:
            return self._error_response(exc, 'resolve_act_dates')

    async def fetch_act_fingerprints(self):
        """Per-article change detectors for a Normattiva act.

        One download of the act's AKN export yields a hash of every article's
        text and, for the codici, the date each article's text came into
        force. A client that stored the hashes last time can tell which
        articles to refetch without touching the others — the archive's
        update run drops from hours to minutes on this.

        The AKN text itself is never served (it transliterates accents; see
        akn_parser.py). Two answers are deliberately different: no index
        (AKN disabled or unavailable) is `available: false` with empty maps
        and 200, so the caller falls back to a full fetch; a crash is a 500,
        so it is never read as "nothing changed". An index WITHOUT
        fingerprints gets the first answer too: one written to the persistent
        cache before this field existed rehydrates with an empty map, and a
        real index always carries at least one fingerprint — `available:
        true` over an empty map would read as "every article vanished".
        """
        try:
            data = await request.get_json() or {}
            urn = data.get('urn')
            if not urn:
                raise ValidationError("Missing 'urn' in request data")
            if 'eur-lex' in str(urn):
                raise ValidationError(
                    "fetch_act_fingerprints accetta solo atti Normattiva: EUR-Lex non ha un export AKN"
                )
            # The AKN index keys off the ACT, so an article suffix has to go:
            # ...;241~art2 -> ...;241 (same rule as fetch_rubriche).
            act_url = str(urn).split('~')[0]
            index = await fetch_act_index(SimpleNamespace(url=act_url))
            if index is None or not index.fingerprints:
                log.info("No AKN fingerprints available", urn=act_url[:100],
                         reason="no index" if index is None else "index without fingerprints")
                return jsonify({'available': False, 'fingerprints': {}, 'parts': [], 'count': 0})
            log.info("Fingerprints served", urn=act_url[:100], count=len(index.fingerprints))
            return jsonify({
                'available': True,
                'fingerprints': index.fingerprints,
                'parts': [
                    {'name': name, 'fingerprints': fingerprints}
                    for name, fingerprints in index.parts_fingerprints.items()
                ],
                'count': len(index.fingerprints),
            })
        except Exception as exc:
            return self._error_response(exc, 'fetch_act_fingerprints')

    async def fetch_alias_catalog(self):
        """Everything this server already recognises when naming an act.

        Two lists the alias manager needs side by side, so a user can see what
        exists before inventing a shortcut for it — which is how the settings
        screen came to suggest "es. gdpr" as a trigger to create, while `gdpr`
        had been a shipped preset all along.

        - `presets`: the aliases we ship (preset_aliases.yaml). Read-only here;
          a user overrides one by creating a CustomAlias with the same trigger,
          which wins because the client resolves its own aliases first.
        - `known_acts`: the act names the resolver understands on its own
          ("statuto dei lavoratori", "legge fornero", "TUSL"). Not aliases —
          these need no shortcut, and an alias for one is a duplicate.
        - `act_names`: the names of both lists that name an act on their own,
          without a number («codice civile», «gdpr»; never «legge» or «d.lgs.»):
          what «Analizza documento» looks for in a document, in the browser
          (design 2026-10-29-document-analysis §4.2).

        Named `/fetch_...` deliberately: nginx routes the Python API by that
        prefix, so this needs no server-config change to be reachable.
        """
        try:
            from visualex_api.tools.alias_resolver import get_all_presets
            from visualex_api.tools.act_resolver import known_act_names

            presets = get_all_presets()
            known = known_act_names()
            names = act_names()
            log.info("Alias catalog served", presets=len(presets), known_acts=len(known), act_names=len(names))
            return jsonify({'presets': presets, 'known_acts': known, 'act_names': names})
        except Exception as e:
            return self._error_response(e, 'fetch_alias_catalog')

    async def fetch_brocardi_info(self):
        # Brocardi is no longer a source (D-078). The route stays only to tell
        # an older client so, until the proxies drop it.
        return jsonify({'error': 'Le annotazioni di Brocardi non sono più disponibili.'}), 410

    async def fetch_all_data(self):
        try:
            data = await request.get_json()
            if not data:
                return jsonify({'error': 'Request body required'}), 400
            log.info("Received data for fetch_all_data", data=data)
            add_to_history(data)

            normavisitate = await self.create_norma_visitata_from_data(data)
            upcoming_asked, until = _upcoming_of(data)

            async def fetch_data(nv):
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    log.warning("Unsupported act type for scraper", norma_data=nv.to_dict())
                    return {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}

                try:
                    article_text, url, validity, extra = await self._document_in_force(
                        scraper, nv, upcoming_asked, until)
                    result = {
                        'article_text': article_text,
                        'url': url,
                        'norma_data': nv.to_dict(),
                    }
                    if validity:
                        result['validity'] = validity
                    result.update(extra)
                    result.update(await self._page_extras_for(scraper, nv, url, article_text))
                    return result
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
            if not data:
                return jsonify({'error': 'Request body required'}), 400
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
            if not data:
                return jsonify({'error': 'Request body required'}), 400
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
            if not data:
                return jsonify({'error': 'Request body required'}), 400
            dossier = dossier_manager.import_dossier(data)
            return jsonify(dossier), 201
        except Exception as e:
            log.error("Error in import_dossier", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def sync_dossiers(self):
        """Sincronizza tutti i dossier (sovrascrive dal frontend)."""
        try:
            data = await request.get_json()
            if not data:
                return jsonify({'error': 'Request body required'}), 400
            dossiers = data.get('dossiers', [])
            dossier_manager.sync_all(dossiers)
            return jsonify({'success': True, 'count': len(dossiers)})
        except Exception as e:
            log.error("Error in sync_dossiers", error=str(e))
            return jsonify({'error': str(e)}), 500

    # ==================== Health Endpoints ====================

    async def health(self):
        """Basic health check - returns 200 if app is running."""
        from datetime import datetime, timezone
        return jsonify({
            'status': 'ok',
            'timestamp': datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        })

    async def health_detailed(self):
        """Detailed health check - tests connectivity to external sources.

        Cached for HEALTH_DETAILED_TTL seconds (read at call time, like
        AKN_ENABLED) so the frontend's polling banner does not multiply the
        three live probes by every open tab. A failing probe is cached too,
        so a flapping source does not get hammered by repeated callers.
        """
        from datetime import datetime, timezone
        import time as time_module

        ttl = float(os.getenv('HEALTH_DETAILED_TTL', '120'))
        now = time_module.time()

        if _health_detailed_cache['response'] is not None and now < _health_detailed_cache['expires_at']:
            cached = dict(_health_detailed_cache['response'])
            cached['cached'] = True
            cached['cache_ttl_seconds'] = ttl
            return jsonify(cached), _health_detailed_cache['status_code']

        async with _health_detailed_lock:
            # Re-check: a concurrent caller may have already run the probe
            # while this one waited for the lock.
            now = time_module.time()
            if _health_detailed_cache['response'] is not None and now < _health_detailed_cache['expires_at']:
                cached = dict(_health_detailed_cache['response'])
                cached['cached'] = True
                cached['cache_ttl_seconds'] = ttl
                return jsonify(cached), _health_detailed_cache['status_code']

            results = {
                'status': 'ok',
                'timestamp': datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
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

            # The Union's acts: EUR-Lex's site and CELLAR, one request each, no browser. The
            # acts are read from CELLAR first and from the site second (eurlex_fetch), so the
            # source is down only when both are; each one's own state rides along ("challenge":
            # the site's firewall answered 202 with x-amzn-waf-action).
            start = time_module.time()
            eurlex_site = await eurlex_fetch.probe_eurlex()
            cellar = await eurlex_fetch.probe_cellar()
            latency = time_module.time() - start
            eu_ok = 'ok' in (eurlex_site, cellar)
            results['services']['eurlex'] = {
                'status': 'ok' if eu_ok else 'error',
                'latency_ms': round(latency * 1000, 2),
                'eurlex': eurlex_site,
                'cellar': cellar,
            }
            if not eu_ok:
                results['services']['eurlex']['error'] = f"EUR-Lex: {eurlex_site}; CELLAR: {cellar}"
                results['status'] = 'degraded'

            status_code = 200 if results['status'] == 'ok' else 503

            _health_detailed_cache['response'] = results
            _health_detailed_cache['status_code'] = status_code
            # From the end of the probe: measured from its start, a slow probe
            # (several seconds per source) ate into the TTL.
            _health_detailed_cache['expires_at'] = time_module.time() + max(ttl, 0)

            payload = dict(results)
            payload['cached'] = False
            payload['cache_ttl_seconds'] = ttl
            return jsonify(payload), status_code

    async def get_version(self):
        """Returns version info, latest git commit details, and changelog."""
        import subprocess
        from pathlib import Path

        # Get the project root directory (where app.py is located)
        project_root = Path(__file__).resolve().parent
        # version.txt is the product's version and lives at the repository root,
        # two levels above services/visualex/.
        repo_root = project_root.parents[1]

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
        version_file = repo_root / 'version.txt'
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

        # Changelog: what landed in this version, one merge at a time. The
        # first-parent log gives a line per branch that landed rather than per
        # development step; visualex_api/tools/changelog.py drops the rest.
        version_file_log = await asyncio.to_thread(
            run_git_command,
            ['log', '-n', '2', '--format=%h', '--', ':/version.txt']
        )
        changelog_raw = await asyncio.to_thread(
            run_git_command,
            ['log', '--first-parent', '--format=%h|%s|%ci|%an', '-n', str(SCAN_LIMIT)]
        )
        changelog = build_changelog(
            changelog_raw,
            boundary=changelog_boundary(version_file_log),
        )

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
            if not urn or not isinstance(urn, str):
                return jsonify({'error': 'URN mancante'}), 400
            if not is_allowed_pdf_urn(urn):
                return jsonify({'error': 'URN non valido: sono ammessi solo URL normattiva.it'}), 400
            # Normattiva's address rebuilt from the URN, an undated one at today (G-355); a day
            # after today is refused as for an article (Normattiva would export today's text
            # under it), and the cache name is built before anything else: a URN it cannot
            # name is a 400, never a 500 later.
            try:
                urn = export_url(urn.strip(), today_in_rome().isoformat())
                reject_future_version_date(export_version_date(urn))
                # The same folder extract_pdf downloads into: the cached copy is a file in it.
                pdf_path = pdf_cache_path(urn, os.path.join(os.getcwd(), "download"))
            except ValidationError as exc:
                return jsonify({'error': str(exc)}), 400
            except ValueError as exc:
                if str(exc) == URN_TOO_LONG:
                    return jsonify({'error': 'URN troppo lungo per l\'esportazione'}), 400
                return jsonify({'error': 'URN non valido: serve un indirizzo /uri-res/N2Ls?urn:nir:… di normattiva.it'}), 400

            log.info("Received data for export_pdf", data=data)

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

            # Move to the cache location if different: a copy left the download behind,
            # a second file of the same act under the name Normattiva suggested.
            if extracted_pdf_path != pdf_path:
                await asyncio.to_thread(os.replace, extracted_pdf_path, pdf_path)
                log.info(f"PDF spostato in cache: {pdf_path}")
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
