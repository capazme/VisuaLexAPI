import asyncio
from collections import defaultdict, deque
import os
from time import time
from quart import Quart, request, jsonify, render_template, send_file

import structlog
from functools import lru_cache
from tools.config import MAX_CACHE_SIZE, HISTORY_LIMIT, RATE_LIMIT, RATE_LIMIT_WINDOW
from tools.norma import Norma, NormaVisitata
from tools.brocardi_scraper import BrocardiScraper
from tools.normattiva_scraper import NormattivaScraper
from tools.eurlex_scraper import EurlexScraper
from tools.pdfextractor import extract_pdf
from tools.sys_op import WebDriverManager
from tools.urngenerator import complete_date_or_parse, urn_to_filename
from tools.text_op import format_date_to_extended, clean_text, parse_article_input

# Configure structured logging
structlog.configure(
    processors=[
        structlog.processors.JSONRenderer()
    ]
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
        self.app.add_url_rule('/fetch_normattiva_info', view_func=self.fetch_normattiva_info, methods=['POST'])
        self.app.add_url_rule('/fetch_all_data', view_func=self.fetch_all_data, methods=['POST'])
        self.app.add_url_rule('/history', view_func=self.get_history, methods=['GET'])
        self.app.add_url_rule('/export_pdf', view_func=self.export_pdf, methods=['POST'])

    async def home(self):
        return await render_template('index.html')

    async def fetch_norma_data(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_norma_data", data=data)

            normavisitate = self.create_norma_visitata_from_data(data)
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

            normavisitate = self.create_norma_visitata_from_data(data)

            async def fetch_text(normavisitata):
                scraper = self.get_scraper_for_norma(normavisitata)
                if scraper is None:
                    return {'error': 'Unsupported act type', 'norma_data': normavisitata.to_dict()}

                article_text, url = await asyncio.to_thread(scraper.get_document, normavisitata)
                article_text_cleaned = clean_text(article_text)
                return {
                    'article_text': article_text_cleaned,
                    'norma_data': normavisitata.to_dict()
                }

            results = await asyncio.gather(*(fetch_text(nv) for nv in normavisitate), return_exceptions=True)

            return jsonify(results)
        except Exception as e:
            log.error("Error in fetch_article_text", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def fetch_brocardi_info(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_brocardi_info", data=data)

            normavisitate = self.create_norma_visitata_from_data(data)

            async def fetch_info(normavisitata):
                act_type_normalized = normavisitata.norma.tipo_atto.lower()
                if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
                    return {'norma_data': normavisitata.to_dict(), 'brocardi_info': None}

                brocardi_info = await asyncio.to_thread(brocardi_scraper.get_info, normavisitata)
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

            results = await asyncio.gather(*(fetch_info(nv) for nv in normavisitate), return_exceptions=True)

            return jsonify(results)
        except Exception as e:
            log.error("Error in fetch_brocardi_info", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def fetch_normattiva_info(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_normattiva_info", data=data)

            normavisitate = self.create_norma_visitata_from_data(data)

            async def fetch_info(normavisitata):
                act_type_normalized = normavisitata.norma.tipo_atto.lower()
                if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
                    return {'norma_data': normavisitata.to_dict(), 'normattiva_info': None}

                normattiva_info = await asyncio.to_thread(normattiva_scraper.get_info, normavisitata)
                return {
                    'norma_data': normavisitata.to_dict(),
                    'normattiva_info': normattiva_info
                }

            results = await asyncio.gather(*(fetch_info(nv) for nv in normavisitate), return_exceptions=True)

            return jsonify(results)
        except Exception as e:
            log.error("Error in fetch_normattiva_info", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def fetch_all_data(self):
        try:
            data = await request.get_json()
            log.info("Received data for fetch_all_data", data=data)

            # Assicurati che create_norma_visitata_from_data gestisca le eccezioni correttamente
            normavisitate = self.create_norma_visitata_from_data(data)
            
            # Verifica se normavisitate è una lista valida
            if not isinstance(normavisitate, list):
                return jsonify({'error': 'Invalid data format for normavisitate'}), 400

            async def fetch_data(normavisitata):
                scraper = self.get_scraper_for_norma(normavisitata)
                if scraper is None:
                    return {'error': 'Unsupported act type', 'norma_data': normavisitata.to_dict()}

                try:
                    article_text, url = await asyncio.to_thread(scraper.get_document, normavisitata)
                    article_text_cleaned = clean_text(article_text)

                    brocardi_info = None
                    if scraper == normattiva_scraper:
                        brocardi_info = await asyncio.to_thread(brocardi_scraper.get_info, normavisitata)

                    response = {
                        'norma_data': normavisitata.to_dict(),
                        'article_text': article_text_cleaned,
                        'brocardi_info': {
                            'position': brocardi_info[0] if brocardi_info else None,
                            'link': brocardi_info[2] if brocardi_info else None,
                            'Brocardi': brocardi_info[1].get('Brocardi') if brocardi_info and brocardi_info[1] and 'Brocardi' in brocardi_info[1] else None,
                            'Ratio': brocardi_info[1].get('Ratio') if brocardi_info and brocardi_info[1] and 'Ratio' in brocardi_info[1] else None,
                            'Spiegazione': brocardi_info[1].get('Spiegazione') if brocardi_info and brocardi_info[1] and 'Spiegazione' in brocardi_info[1] else None,
                            'Massime': brocardi_info[1].get('Massime') if brocardi_info and brocardi_info[1] and 'Massime' in brocardi_info[1] else None
                        }
                    }

                    return response

                except Exception as e:
                    log.error(f"Error fetching data for {normavisitata}: {str(e)}")
                    return {'error': str(e)}  # Assicurati che il messaggio di errore sia serializzabile

            # Raccogli tutti i risultati delle chiamate
            results = await asyncio.gather(*(fetch_data(nv) for nv in normavisitate), return_exceptions=True)

            # Filtra i risultati per eventuali errori
            filtered_results = [result for result in results if isinstance(result, dict) and 'error' not in result]

            log.debug("All data response", response=filtered_results)
            return jsonify(filtered_results)

        except Exception as e:
            log.error("Error in fetch_all_data", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def get_history(self):
        try:
            log.info("Fetching history")
            history_list = [norma.to_dict() for norma in history]
            return jsonify(history_list)
        except Exception as e:
            log.error("Error in get_history", error=str(e))
            return jsonify({'error': str(e)}), 500

    async def export_pdf(self):
        try:
            data = await request.get_json()
            urn = data['urn']
            log.info("Received data for export_pdf", urn=urn)

            filename = urn_to_filename(urn)
            if not filename:
                raise ValueError("Invalid URN")

            pdf_path = os.path.join(os.getcwd(), "download", filename)
            log.info("PDF path", pdf_path=pdf_path)

            if os.path.exists(pdf_path):
                log.info("PDF already exists", pdf_path=pdf_path)
                return await send_file(pdf_path, as_attachment=True)

            driver = await asyncio.to_thread(driver_manager.setup_driver)
            pdf_path = await asyncio.to_thread(extract_pdf, driver, urn, 30)
            if not pdf_path:
                raise ValueError("Error generating PDF")

            os.rename(os.path.join(os.getcwd(), "download", pdf_path), pdf_path)
            log.info("PDF generated and saved", pdf_path=pdf_path)

            return await send_file(pdf_path, as_attachment=True)
        except Exception as e:
            log.error("Error in export_pdf", error=str(e))
            return jsonify({'error': str(e)})
        finally:
            await asyncio.to_thread(driver_manager.close_drivers)
            log.info("Driver closed")

    def create_norma_visitata_from_data(self, data):
        """
        Creates and returns a list of NormaVisitata instances from request data.
        """
        allowed_types = ['legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'regio decreto']
        
        if data['act_type'] in allowed_types:
            data_completa = complete_date_or_parse(date=data.get('date'), act_type=data['act_type'], act_number=data.get('act_number'))
            data_completa_estesa = format_date_to_extended(data_completa)
        else:
            data_completa_estesa = data.get('date')  # Assegna comunque la data se non è in allowed_types

        norma = Norma(
            tipo_atto=data['act_type'],
            data=data_completa_estesa,  # Assicurati che qui tu stia passando la data corretta
            numero_atto=data.get('act_number')
        )
        
        articles = parse_article_input(str(data['article']), norma.url)
        
        out = []

        for article in articles: 
            out.append(NormaVisitata(
                norma=norma,
                numero_articolo=article,
                versione=data.get('version'),
                data_versione=data.get('version_date'),
                allegato=data.get('annex')
            ))

        return out


    def get_scraper_for_norma(self, normavisitata):
        act_type_normalized = normavisitata.norma.tipo_atto.lower()
        log.debug("Determining scraper for norma", act_type=act_type_normalized)
        if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
            return eurlex_scraper
        else:
            return normattiva_scraper

    def run(self):
        log.info("Starting Quart app in async mode")
        self.app.run(debug=True, host='0.0.0.0', port=8000)

# Run the application
if __name__ == '__main__':
    norma_controller = NormaController()
    norma_controller.run()
