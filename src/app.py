import asyncio
from collections import defaultdict, deque
import os
from time import time
from quart import Quart, request, jsonify, render_template, send_file
from quart_cors import cors
import structlog
from visualex_api.tools.config import HISTORY_LIMIT, RATE_LIMIT, RATE_LIMIT_WINDOW
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.services.brocardi_scraper import BrocardiScraper
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.services.pdfextractor import extract_pdf
from visualex_api.tools.sys_op import WebDriverManager
from visualex_api.tools.urngenerator import complete_date_or_parse, urn_to_filename
from visualex_api.tools.treextractor import get_tree
from visualex_api.tools.text_op import format_date_to_extended, parse_article_input
import logging
import sys

# Configurazione di logging
logging.basicConfig(
    level=logging.DEBUG,  # Imposta il livello di log su DEBUG
    format="%(message)s",
    stream=sys.stdout,
)

# Configurazione di structlog
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),   # Aggiunge un timestamp in formato ISO
        structlog.processors.StackInfoRenderer(),      # Aggiunge informazioni sullo stack se disponibile
        structlog.processors.format_exc_info,          # Formatta le eccezioni per renderle leggibili
        structlog.dev.ConsoleRenderer()                # Formattazione leggibile per debugging
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

log = structlog.get_logger()

# Rate limiting storage
request_counts = defaultdict(lambda: {'count': 0, 'time': time()})

# Initialize history, scrapers, and webdriver manager
history = deque(maxlen=HISTORY_LIMIT)
brocardi_scraper = BrocardiScraper()
normattiva_scraper = NormattivaScraper()
eurlex_scraper = EurlexScraper()
driver_manager = WebDriverManager()

class NormaController:
    def __init__(self):
        self.app = Quart(__name__)
        self.app = cors(self.app, allow_origin="http://localhost:3000")
        # Middleware for rate limiting
        self.app.before_request(self.rate_limit_middleware)

        # Define routes
        self.setup_routes()

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

    def setup_routes(self):
        self.app.add_url_rule('/', view_func=self.home)
        self.app.add_url_rule('/fetch_norma_data', view_func=self.fetch_norma_data, methods=['POST'])
        self.app.add_url_rule('/fetch_article_text', view_func=self.fetch_article_text, methods=['POST'])
        self.app.add_url_rule('/fetch_brocardi_info', view_func=self.fetch_brocardi_info, methods=['POST'])
        self.app.add_url_rule('/fetch_all_data', view_func=self.fetch_all_data, methods=['POST'])
        self.app.add_url_rule('/fetch_tree', view_func=self.fetch_tree, methods=['POST'])
        self.app.add_url_rule('/history', view_func=self.get_history, methods=['GET'])
        self.app.add_url_rule('/export_pdf', view_func=self.export_pdf, methods=['POST'])

    async def home(self):
        return await render_template('index.html')

    async def create_norma_visitata_from_data(self, data):
        """
        Creates and returns a list of NormaVisitata instances from request data.
        """
        log.info("Creating NormaVisitata from data", data=data)
        allowed_types = ['legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'regio decreto']
        
        if data['act_type'] in allowed_types:
            log.info("Act type is allowed", act_type=data['act_type'])
            data_completa = complete_date_or_parse(
                date=data.get('date'), 
                act_type=data['act_type'], 
                act_number=data.get('act_number')
            )
            log.info("Completed date parsed", data_completa=data_completa)
            data_completa_estesa = format_date_to_extended(data_completa)
            log.info("Extended date formatted", data_completa_estesa=data_completa_estesa)
        else:
            log.info("Act type is not in allowed types", act_type=data['act_type'])
            data_completa_estesa = data.get('date')  # Assegna comunque la data se non è in allowed_types
            log.info("Using provided date", data_completa_estesa=data_completa_estesa)

        norma = Norma(
            tipo_atto=data['act_type'],
            data=data_completa_estesa if data_completa_estesa else None,  # Assicurati che qui tu stia passando la data corretta
            numero_atto=data.get('act_number')
        )
        log.info("Norma instance created", norma=norma)
        
        articles = await parse_article_input(str(data['article']), norma.url)
        log.info("Articles parsed", articles=articles)
        
        out = []

        for article in articles:
            if ' ' in article.strip():
                article = article.replace(' ', '-') 
            log.info("Processing article", article=article)
            out.append(NormaVisitata(
                norma=norma,
                numero_articolo=article,
                versione=data.get('version'),
                data_versione=data.get('version_date'),
                allegato=data.get('annex')
            ))
            log.info("NormaVisitata instance created", norma_visitata=out[-1])

        log.info("Created NormaVisitata instances", norma_visitata_list=[nv.to_dict() for nv in out])
        return out

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
            response = {
                'norma_data': [nv.to_dict() for nv in normavisitate]
            }
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

            async def fetch_text(normavisitata):
                scraper = self.get_scraper_for_norma(normavisitata)
                if scraper is None:
                    log.warning("Unsupported act type for scraper", norma_data=normavisitata.to_dict())
                    return {'error': 'Unsupported act type', 'norma_data': normavisitata.to_dict()}

                try:
                    article_text, url = await scraper.get_document(normavisitata)
                    log.info("Document fetched successfully", article_text=article_text, url=url)
                    article_text_cleaned = article_text
                    log.info("Article text cleaned", cleaned_text=article_text_cleaned)
                    return {
                        'article_text': article_text_cleaned,
                        'norma_data': normavisitata.to_dict(),
                        'url': url
                    }
                except Exception as e:
                    log.error("Error fetching article text", error=str(e))
                    return {'error': str(e), 'norma_data': normavisitata.to_dict()}

            # Fetch all article texts concurrently
            results = await asyncio.gather(*(fetch_text(nv) for nv in normavisitate), return_exceptions=True)

            processed_results = []
            for result in results:
                if isinstance(result, Exception):
                    processed_results.append({'error': str(result)})
                    log.error("Exception during fetching article text", exception=str(result))
                else:
                    processed_results.append(result)
                    log.info("Fetched article result", result=result)

            return jsonify(processed_results)
        except Exception as e:
            log.error("Error in fetch_article_text", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def fetch_tree(self):
        try:
            # Ottenere i dati dalla richiesta JSON
            data = await request.get_json()
            log.info("Received data for fetch_tree", data=data)

            # Estrarre il parametro URN
            urn = data.get('urn')
            if not urn:
                log.error("Missing 'urn' in request data")
                return jsonify({'error': "Missing 'urn' in request data"}), 400

            # Estrarre le flag 'link' e 'details', impostandole a False se non fornite
            link = data.get('link', False)
            details = data.get('details', False)

            # Validazione delle flag
            if not isinstance(link, bool):
                log.error("'link' must be a boolean")
                return jsonify({'error': "'link' must be a boolean"}), 400

            if not isinstance(details, bool):
                log.error("'details' must be a boolean")
                return jsonify({'error': "'details' must be a boolean"}), 400

            log.debug(f"Flags received - link: {link}, details: {details}")

            # Chiamare la funzione `get_tree` con le flag appropriate
            articles, count = await get_tree(urn, link=link, details=details)

            # Controllare se ci sono errori
            if isinstance(articles, str):  # In caso di errore la funzione ritorna una stringa
                log.error("Error fetching tree", error=articles)
                return jsonify({'error': articles}), 500

            # Formattare la risposta
            response = {
                'articles': articles,
                'count': count
            }
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

            async def fetch_info(normavisitata):
                act_type_normalized = normavisitata.norma.tipo_atto.lower()
                if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
                    return {'norma_data': normavisitata.to_dict(), 'brocardi_info': None}

                try:
                    brocardi_info = await brocardi_scraper.get_info(normavisitata)
                    response = {
                        'norma_data': normavisitata.to_dict(),
                        'brocardi_info': {
                            'position': brocardi_info[0] if brocardi_info[0] else None,
                            'link': brocardi_info[2],
                            'Brocardi': brocardi_info[1].get('Brocardi') if brocardi_info[1] and 'Brocardi' in brocardi_info[1] else None,
                            'Ratio': brocardi_info[1].get('Ratio') if brocardi_info[1] and 'Ratio' in brocardi_info[1] else None,
                            'Spiegazione': brocardi_info[1].get('Spiegazione') if brocardi_info[1] and 'Spiegazione' in brocardi_info[1] else None,
                            'Massime': brocardi_info[1].get('Massime') if brocardi_info[1] and 'Massime' in brocardi_info[1] else None
                        }
                    }
                    return response
                except Exception as e:
                    log.error("Error fetching Brocardi info", error=str(e))
                    return {'error': str(e), 'norma_data': normavisitata.to_dict()}

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
            log.info("NormaVisitata instances created", normavisitate=[nv.to_dict() for nv in normavisitate])

            async def fetch_data(normavisitata):
                scraper = self.get_scraper_for_norma(normavisitata)
                if scraper is None:
                    log.warning("Unsupported act type for scraper", norma_data=normavisitata.to_dict())
                    return {'error': 'Unsupported act type', 'norma_data': normavisitata.to_dict()}

                try:
                    article_text, url = await scraper.get_document(normavisitata)
                    article_text_cleaned = article_text
                    brocardi_info = None
                    if scraper == normattiva_scraper:
                        try:
                            brocardi_info = await brocardi_scraper.get_info(normavisitata)
                            brocardi_info = {
                                'position': brocardi_info[0] if brocardi_info[0] else None,
                                'link': brocardi_info[2],
                                'Brocardi': brocardi_info[1].get('Brocardi') if brocardi_info[1] and 'Brocardi' in brocardi_info[1] else None,
                                'Ratio': brocardi_info[1].get('Ratio') if brocardi_info[1] and 'Ratio' in brocardi_info[1] else None,
                                'Spiegazione': brocardi_info[1].get('Spiegazione') if brocardi_info[1] and 'Spiegazione' in brocardi_info[1] else None,
                                'Massime': brocardi_info[1].get('Massime') if brocardi_info[1] and 'Massime' in brocardi_info[1] else None
                            }
                        except Exception as e:
                            log.error("Error fetching Brocardi info", error=str(e))
                            brocardi_info = {'error': str(e)}

                    return {
                        'article_text': article_text_cleaned,
                        'url': url,
                        'norma_data': normavisitata.to_dict(),
                        'brocardi_info': brocardi_info
                    }
                except Exception as e:
                    log.error("Error fetching all data", error=str(e))
                    return {'error': str(e), 'norma_data': normavisitata.to_dict()}

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
            history_data = list(history)
            return jsonify({'history': history_data})
        except Exception as e:
            log.error("Error in get_history", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def export_pdf(self):
        try:
            data = await request.get_json()
            log.info("Received data for export_pdf", data=data)

            pdf_content = extract_pdf(data)
            pdf_path = urn_to_filename(data.get('urn', 'exported')) 

            with open(pdf_path, 'wb') as f:
                f.write(pdf_content)

            return await send_file(pdf_path, mimetype='application/pdf', as_attachment=True, attachment_filename=os.path.basename(pdf_path))
        except Exception as e:
            log.error("Error in export_pdf", error=str(e))
            return jsonify({'error': str(e)}), 500

# Entry point to run the Quart app
def main():
    controller = NormaController()
    app = controller.app

    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5000))

    app.run(host=host, port=port)

if __name__ == '__main__':
    main()
