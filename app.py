import os
import asyncio
from collections import deque, defaultdict
from time import time
from quart import Quart, render_template, request, jsonify, send_file
from functools import lru_cache
from tools.norma import NormaVisitata, Norma
from tools.xlm_htmlextractor import extract_html_article
from tools.brocardi import BrocardiScraper
from tools.pdfextractor import extract_pdf
from tools.sys_op import WebDriverManager
from tools.urngenerator import complete_date_or_parse, urn_to_filename
from tools.text_op import format_date_to_extended
import structlog

# Configure structured logging
structlog.configure(
    processors=[
        structlog.processors.JSONRenderer()
    ]
)
log = structlog.get_logger()

# Constants
MAX_CACHE_SIZE = 1000
HISTORY_LIMIT = 50
RATE_LIMIT = 10  # Limit to 10 requests per minute
RATE_LIMIT_WINDOW = 60  # Window size in seconds

# Rate limiting storage
request_counts = defaultdict(lambda: {'count': 0, 'time': time()})

# Application setup
app = Quart(__name__)

history = deque(maxlen=HISTORY_LIMIT)
brocardi_scraper = BrocardiScraper()
driver_manager = WebDriverManager()

# Middleware for simple rate limiting
@app.before_request
async def rate_limit_middleware():
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    current_time = time()
    
    if client_ip in request_counts:
        request_info = request_counts[client_ip]
        if current_time - request_info['time'] < RATE_LIMIT_WINDOW:
            if request_info['count'] >= RATE_LIMIT:
                log.warning("Rate limit exceeded", client_ip=client_ip)
                return jsonify({'error': 'Rate limit exceeded. Try again later.'}), 429
            else:
                request_info['count'] += 1
        else:
            request_counts[client_ip] = {'count': 1, 'time': current_time}
    else:
        request_counts[client_ip] = {'count': 1, 'time': current_time}

# Utility function to process Norma data
@lru_cache(maxsize=MAX_CACHE_SIZE)
def create_norma_visitata_from_data(data):
    """
    Creates and returns a NormaVisitata instance from request data.
    This function centralizes the logic for creating Norma and NormaVisitata objects.
    """
    allowed_types = ['legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'Regolamento UE', 'Direttiva UE', 'regio decreto']
    if data['act_type'] in allowed_types:
        data_completa = complete_date_or_parse(date=data.get('date'), act_type=data['act_type'], act_number=data.get('act_number'))
        data_completa_estesa = format_date_to_extended(data_completa)
    else:
        data_completa_estesa = data.get('date')
        
    norma = Norma(
        tipo_atto=data['act_type'],
        data=data_completa_estesa,
        numero_atto=data.get('act_number')
    )
    return NormaVisitata(
        norma=norma,
        numero_articolo=data.get('article'),
        versione=data.get('version'),
        data_versione=data.get('version_date'),
        allegato = data.get('annex')
    )

@app.route('/')
async def home():
    """Renders the home page."""
    return await render_template('index.html')

@app.route('/fetch_norm', methods=['POST'])
async def fetch_data():
    """Endpoint to fetch the details of a legal norm, including Brocardi info."""
    try:
        # Extract data from request
        data = await request.get_json()
        log.info("Received data for fetch_norm", data=data)

        # Process data into NormaVisitata object
        normavisitata = create_norma_visitata_from_data(data)
        log.info("Created NormaVisitata", normavisitata=normavisitata.to_dict())

        # Fetch results
        result = await get_cached_brocardi_info(normavisitata)

        # Save to history
        history.append(normavisitata)
        log.info("Appended NormaVisitata to history", history_size=len(history))

        return jsonify(result)
    except Exception as e:
        log.error("Error in fetch_data", error=str(e))
        return jsonify({'error': str(e)}), 500

async_cache = {}

async def get_cached_brocardi_info(normavisitata):
    """Fetch and cache Brocardi information asynchronously."""
    # Create a unique key based on the attributes of `normavisitata`
    cache_key = (
        normavisitata.norma.tipo_atto_urn,
        normavisitata.numero_articolo,
        normavisitata.versione,
        normavisitata.norma.data,
        normavisitata.norma.numero_atto,
        normavisitata.data_versione,
        normavisitata.allegato
    )

    # If the result is cached, return it
    if cache_key in async_cache:
        return async_cache[cache_key]

    # Otherwise, perform the fetching logic
    try:
        # Extract article text asynchronously
        norma_art_text = await asyncio.to_thread(extract_html_article, normavisitata)
        log.info("Extracted article text", norma_art_text=norma_art_text)

        # Get Brocardi information asynchronously
        brocardi_info = await asyncio.to_thread(brocardi_scraper.get_info, normavisitata)
        position, info, norma_link = brocardi_info or ("Not Available", {}, "Not Available")

        # Build response
        response = {
            'result': norma_art_text,
            'urn': normavisitata.urn,
            'norma_data': normavisitata.to_dict(),
            'brocardi_info': {
                'position': position,
                'info': info,
                'link': norma_link
            }
        }

        # Cache the result
        async_cache[cache_key] = response

        return response
    except Exception as e:
        log.error(f"Error fetching Brocardi information: {e}", exc_info=True)
        return None

@app.route('/history', methods=['GET'])
async def get_history():
    """Endpoint to get the history of visited norms."""
    try:
        log.info("Fetching history")
        history_list = [norma.to_dict() for norma in history]
        return jsonify(history_list)
    except Exception as e:
        log.error("Error in get_history", error=str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/export_pdf', methods=['POST'])
async def export_pdf():
    """Endpoint to export the legal norm as a PDF."""
    try:
        # Extract data from request
        data = await request.get_json()
        urn = data['urn']
        log.info("Received data for export_pdf", urn=urn)

        # Generate filename and check if the PDF already exists
        filename = urn_to_filename(urn)
        if not filename:
            raise ValueError("Invalid URN")

        pdf_path = os.path.join(os.getcwd(), "download", filename)
        log.info("PDF path", pdf_path=pdf_path)

        # If PDF already exists, serve it
        if os.path.exists(pdf_path):
            log.info("PDF already exists", pdf_path=pdf_path)
            return await send_file(pdf_path, as_attachment=True)

        # Generate PDF if not present
        driver = await asyncio.to_thread(driver_manager.setup_driver)
        pdf_path = await asyncio.to_thread(extract_pdf, driver, urn, 30)
        if not pdf_path:
            raise ValueError("Error generating PDF")

        # Rename and save the PDF to the correct path
        os.rename(os.path.join(os.getcwd(), "download", pdf_path), pdf_path)
        log.info("PDF generated and saved", pdf_path=pdf_path)

        return await send_file(pdf_path, as_attachment=True)
    except Exception as e:
        log.error("Error in export_pdf", error=str(e))
        return jsonify({'error': str(e)})
    finally:
        await asyncio.to_thread(driver_manager.close_drivers)
        log.info("Driver closed")

if __name__ == '__main__':
    log.info("Starting Quart app in async mode")
    app.run(debug=True, host='0.0.0.0', port=8000)
