import os
import asyncio
from collections import deque, defaultdict
from time import time
from quart import Quart, render_template, request, jsonify, send_file
from tools.norma import NormaVisitata, Norma
from tools.xlm_htmlextractor import extract_html_article
from tools.brocardi import BrocardiScraper
from tools.pdfextractor import extract_pdf
from tools.sys_op import WebDriverManager
from tools.urngenerator import complete_date_or_parse, urn_to_filename
from tools.text_op import format_date_to_extended, clean_text, parse_article_input
import structlog
import redis.asyncio as redis
import json

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
RATE_LIMIT = 100  # Limit to 10 requests per minute
RATE_LIMIT_WINDOW = 60  # Window size in seconds

# Rate limiting storage
request_counts = defaultdict(lambda: {'count': 0, 'time': time()})

# Application setup
app = Quart(__name__)

# Redis setup for caching
redis_client = redis.from_url("redis://localhost")

async_cache = {}

# Initialize history, brocardi scraper, and webdriver manager
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
def create_norma_visitata_from_data(data):
    """
    Creates and returns a NormaVisitata instance from request data.
    """
    allowed_types = ['legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'regio decreto']
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
        allegato=data.get('annex')
    )

# Modular endpoints to retrieve different types of data
@app.route('/fetch_norma_data', methods=['POST'])
async def fetch_norma_data():
    try:
        data = await request.get_json()
        log.info("Received data for fetch_norma_data", data=data)

        normavisitata = create_norma_visitata_from_data(data)
        response = {
            'norma_data': normavisitata.to_dict()
        }
        return jsonify(response)
    except Exception as e:
        log.error("Error in fetch_norma_data", error=str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/fetch_article_text', methods=['POST'])
async def fetch_article_text():
    try:
        data = await request.get_json()
        log.info("Received data for fetch_article_text", data=data)

        normavisitata = create_norma_visitata_from_data(data)
        article_text = await asyncio.to_thread(extract_html_article, normavisitata)
        article_text_cleaned = clean_text(article_text)

        response = {
            'article_text': article_text_cleaned
        }
        return jsonify(response)
    except Exception as e:
        log.error("Error in fetch_article_text", error=str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/fetch_brocardi_info', methods=['POST'])
async def fetch_brocardi_info():
    try:
        data = await request.get_json()
        log.info("Received data for fetch_brocardi_info", data=data)

        normavisitata = create_norma_visitata_from_data(data)
        brocardi_info = await asyncio.to_thread(brocardi_scraper.get_info, normavisitata)
        position, info, norma_link = brocardi_info or ("Not Available", {}, "Not Available")

        response = {
            'brocardi_info': {
                'position': position,
                'info': info,
                'link': norma_link
            }
        }
        return jsonify(response)
    except Exception as e:
        log.error("Error in fetch_brocardi_info", error=str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/fetch_all_data', methods=['POST'])
async def fetch_all_data():
    try:
        data = await request.get_json()
        log.info("Received data for fetch_all_data", data=data)

        # Create NormaVisitata instance
        normavisitata = create_norma_visitata_from_data(data)

        # Parse articles, handling both single and multiple articles using normaurn
        articles = parse_article_input(data.get('article'), normavisitata.norma.url)
        log.info("Parsed articles", articles=articles)

        results = await asyncio.gather(*(get_all_data_for_article({**data, 'article': str(article)}) for article in articles))
        return jsonify(results)
    except Exception as e:
        log.error("Error in fetch_all_data", error=str(e))
        return jsonify({'error': str(e)}), 500

async def get_all_data_for_article(data):
    try:
        normavisitata = create_norma_visitata_from_data(data)
        cache_key = generate_cache_key(normavisitata)

        # Check Redis cache
        cached_result = await redis_client.get(cache_key)
        if cached_result:
            return json.loads(cached_result.decode('utf-8'))

        # Fetch article text and Brocardi info concurrently
        article_text, brocardi_info = await asyncio.gather(
            asyncio.to_thread(extract_html_article, normavisitata),
            asyncio.to_thread(brocardi_scraper.get_info, normavisitata)
        )
        article_text_cleaned = clean_text(article_text)
        position, info, norma_link = brocardi_info or ("Not Available", {}, "Not Available")

        response = {
            'norma_data': normavisitata.to_dict(),
            'article_text': article_text_cleaned,
            'brocardi_info': {
                'position': position,
                'info': info,
                'link': norma_link
            }
        }

        # Cache the result in Redis
        await redis_client.set(cache_key, json.dumps(response))
        return response
    except Exception as e:
        log.error("Error in get_all_data_for_article", error=str(e))
        return {'error': str(e)}

def generate_cache_key(normavisitata):
    return f"{normavisitata.norma.tipo_atto_urn}:{normavisitata.numero_articolo}:{normavisitata.versione}:{normavisitata.norma.data}:{normavisitata.norma.numero_atto}:{normavisitata.data_versione}:{normavisitata.allegato}"

@app.route('/fetch_norm', methods=['POST'])
async def fetch_data():
    """Endpoint to fetch the details of a legal norm, including Brocardi info."""
    try:
        # Extract data from request
        data = await request.get_json()
        log.info("Received data for fetch_norm", data=data)

        # Create NormaVisitata instance
        normavisitata = create_norma_visitata_from_data(data)

        # Parse articles, handling both single and multiple articles using normaurn
        articles = parse_article_input(data.get('article'), normavisitata.norma.url)
        log.info("Parsed articles", articles=articles)

        results = []
        for article in articles:
            # Update the article number in the data
            data['article'] = str(article)

            # Process data into NormaVisitata object
            normavisitata = create_norma_visitata_from_data(data)
            log.info("Created NormaVisitata", normavisitata=normavisitata.to_dict())

            # Fetch results for each article
            result = await get_cached_brocardi_info(normavisitata)

            # Append result to results list
            if result:
                results.append(result)
            else:
                log.error(f"Failed to fetch data for article {article}")

        # Save all to history
        for normavisitata in results:
            history.append(normavisitata)

        log.info("Appended NormaVisitata to history", history_size=len(history))

        return jsonify(results)  # Return the list of results
    except Exception as e:
        log.error("Error in fetch_norm", error=str(e))
        return jsonify({'error': str(e)}), 500

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
        norma_art_text_cleaned = clean_text(norma_art_text)
        log.info("Extracted article text", norma_art_text=norma_art_text)

        # Get Brocardi information asynchronously
        brocardi_info = await asyncio.to_thread(brocardi_scraper.get_info, normavisitata)
        position, info, norma_link = brocardi_info or ("Not Available", {}, "Not Available")

        # Build response
        response = {
            'result': norma_art_text_cleaned,
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

@app.route('/')
async def home():
    return await render_template('index.html')

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