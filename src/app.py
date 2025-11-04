import asyncio
import os
import logging
import sys
import json
from collections import defaultdict, deque
from time import time

from quart import Quart, request, jsonify, render_template, send_file, Response, g
from quart_cors import cors
import structlog

from visualex_api.tools.config import Settings, HISTORY_LIMIT, RATE_LIMIT, RATE_LIMIT_WINDOW

# Initialize settings
settings = Settings()
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.services.brocardi_scraper import BrocardiScraper
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.services.pdfextractor import extract_pdf
from visualex_api.tools.sys_op import WebDriverManager
from visualex_api.tools.urngenerator import complete_date_or_parse, urn_to_filename
from visualex_api.tools.treextractor import get_tree
from visualex_api.tools.text_op import format_date_to_extended, parse_article_input

# Configurazione del logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(message)s",
    stream=sys.stdout,
)

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.dev.ConsoleRenderer()
    ],
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

# Storage per il rate limiting e la history
request_counts = defaultdict(lambda: {'count': 0, 'time': time()})
history = deque(maxlen=HISTORY_LIMIT)

# Inizializzazione degli scraper e del driver manager
brocardi_scraper = BrocardiScraper()
normattiva_scraper = NormattivaScraper()
eurlex_scraper = EurlexScraper()
driver_manager = WebDriverManager()


class NormaController:
    def __init__(self):
        self.app = Quart(__name__)
        # Configure CORS from settings
        allowed_origins = settings.allowed_origins
        self.app = cors(self.app, allow_origin=allowed_origins if len(allowed_origins) == 1 else allowed_origins[0])
        # Secret key from settings
        self.app.secret_key = settings.secret_key
        
        # Middleware per registrare il tempo di inizio della richiesta
        self.app.before_request(self.record_start_time)
        # Middleware per il rate limiting
        self.app.before_request(self.rate_limit_middleware)
        
        # Middleware per loggare statistiche (tempo e token) dopo ogni richiesta
        self.app.after_request(self.log_query_stats)

        # Definizione degli endpoint
        self.setup_routes()

    async def stream_article_text(self):
        """
        Endpoint che invia in streaming i risultati della ricerca degli articoli.
        I risultati vengono inviati man mano che vengono trovati.
        """
        data = await request.get_json()
        log.info("Received data for stream_article_text", data=data)
        normavisitate = await self.create_norma_visitata_from_data(data)
        log.info("NormaVisitata instances created", normavisitate=[nv.to_dict() for nv in normavisitate])
        
        async def result_generator():
            for nv in normavisitate:
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    result = {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}
                    yield json.dumps(result) + "\n"
                    continue

                try:
                    article_text, url = await scraper.get_document(nv)
                    result = {
                        'article_text': article_text,
                        'norma_data': nv.to_dict(),
                        'url': url
                    }
                except Exception as exc:
                    result = {'error': str(exc), 'norma_data': nv.to_dict()}
                # Invia subito il risultato corrente
                yield json.dumps(result) + "\n"
                # Se vuoi dare una piccola pausa tra un risultato e l'altro:
                await asyncio.sleep(0.05)
        
        # Restituisce una Response in streaming
        return Response(result_generator(), mimetype="application/json")

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
                text = response.get_data(as_text=True)
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
        self.app.add_url_rule('/export_pdf', view_func=self.export_pdf, methods=['POST'])


    async def home(self):
        return await render_template('index.html')

    async def create_norma_visitata_from_data(self, data):
        """
        Crea e restituisce una lista di istanze di NormaVisitata a partire dai dati della richiesta.
        """
        log.info("Creating NormaVisitata from data", data=data)
        allowed_types = ['legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'regio decreto']
        act_type = data.get('act_type')
        if act_type in allowed_types:
            log.info("Act type is allowed", act_type=act_type)
            data_completa = complete_date_or_parse(
                date=data.get('date'),
                act_type=act_type,
                act_number=data.get('act_number')
            )
            log.info("Completed date parsed", data_completa=data_completa)
            data_completa_estesa = format_date_to_extended(data_completa)
            log.info("Extended date formatted", data_completa_estesa=data_completa_estesa)
        else:
            log.info("Act type is not in allowed types", act_type=act_type)
            data_completa_estesa = data.get('date')
            log.info("Using provided date", data_completa_estesa=data_completa_estesa)

        norma = Norma(
            tipo_atto=act_type,
            data=data_completa_estesa if data_completa_estesa else None,
            numero_atto=data.get('act_number')
        )
        log.info("Norma instance created", norma=norma)

        articles = await parse_article_input(str(data.get('article')), norma.url)
        log.info("Articles parsed", articles=articles)

        norma_visitata_list = []
        for article in articles:
            cleaned_article = article.strip().replace(' ', '-') if ' ' in article.strip() else article.strip()
            log.info("Processing article", article=cleaned_article)
            norma_visitata_list.append(NormaVisitata(
                norma=norma,
                numero_articolo=cleaned_article,
                versione=data.get('version'),
                data_versione=data.get('version_date'),
                allegato=data.get('annex')
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
            if not isinstance(link, bool):
                log.error("'link' must be a boolean")
                return jsonify({'error': "'link' must be a boolean"}), 400
            if not isinstance(details, bool):
                log.error("'details' must be a boolean")
                return jsonify({'error': "'details' must be a boolean"}), 400

            log.debug("Flags received", link=link, details=details)
            articles, count = await get_tree(urn, link=link, details=details)
            if isinstance(articles, str):
                log.error("Error fetching tree", error=articles)
                return jsonify({'error': articles}), 500

            response = {'articles': articles, 'count': count}
            log.info("Tree fetched successfully", response=response)
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
                            'Massime': brocardi_info[1].get('Massime') if brocardi_info[1] and 'Massime' in brocardi_info[1] else None
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

            normavisitate = await self.create_norma_visitata_from_data(data)

            async def fetch_data(nv):
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    log.warning("Unsupported act type for scraper", norma_data=nv.to_dict())
                    return {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}

                try:
                    article_text, url = await scraper.get_document(nv)
                    brocardi_info = None
                    if scraper == normattiva_scraper:
                        try:
                            b_info = await brocardi_scraper.get_info(nv)
                            brocardi_info = {
                                'position': b_info[0] if b_info[0] else None,
                                'link': b_info[2],
                                'Brocardi': b_info[1].get('Brocardi') if b_info[1] and 'Brocardi' in b_info[1] else None,
                                'Ratio': b_info[1].get('Ratio') if b_info[1] and 'Ratio' in b_info[1] else None,
                                'Spiegazione': b_info[1].get('Spiegazione') if b_info[1] and 'Spiegazione' in b_info[1] else None,
                                'Massime': b_info[1].get('Massime') if b_info[1] and 'Massime' in b_info[1] else None
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

            results = await asyncio.gather(*(fetch_data(nv) for nv in normavisitate), return_exceptions=True)
            processed_results = []
            for result in results:
                if isinstance(result, Exception):
                    processed_results.append({'error': str(result)})
                    log.error("Exception during fetching all data", exception=str(result))
                else:
                    processed_results.append(result)
            return jsonify(processed_results)
        except Exception as e:
            log.error("Error in fetch_all_data", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def get_history(self):
        try:
            return jsonify({'history': list(history)})
        except Exception as e:
            log.error("Error in get_history", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def export_pdf(self):
        try:
            data = await request.get_json()
            urn = data.get('urn')
            if not urn:
                return jsonify({'error': 'URN mancante'}), 400

            log.info("Received data for export_pdf", data=data)
            pdf_path = urn_to_filename(urn)

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

            driver = await asyncio.to_thread(driver_manager.setup_driver)
            try:
                extracted_pdf_path = await asyncio.to_thread(extract_pdf, driver, urn)
                log.info(f"PDF estratto: {extracted_pdf_path}")
            finally:
                await asyncio.to_thread(driver_manager.close_drivers)

            exists_extracted = await asyncio.to_thread(os.path.exists, extracted_pdf_path)
            size_extracted = await asyncio.to_thread(os.path.getsize, extracted_pdf_path) if exists_extracted else 0
            if not exists_extracted or size_extracted == 0:
                raise Exception("Il PDF estratto risulta vuoto o non esistente.")

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
    # Use settings for host and port
    host = settings.get('HOST', '0.0.0.0')
    port = settings.get_int('PORT', 5000)
    app.run(host=host, port=port)


if __name__ == '__main__':
    main()
