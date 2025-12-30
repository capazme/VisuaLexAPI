"""
Main controller for the VisuaLex API.

This module defines the Quart application and its routes, handling all
HTTP requests and responses.
"""

import asyncio
import json
import time
from collections import defaultdict, deque
from typing import Dict, Any, List, Optional, Tuple, Union

from quart import Quart, request, jsonify, render_template, send_file, Response, g
from quart_cors import cors

from visualex_api.tools.config import Settings, HISTORY_LIMIT, RATE_LIMIT, RATE_LIMIT_WINDOW
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.logging_config import configure_logging, log_request
from visualex_api.tools.exceptions import (
    VisuaLexError, ValidationError, ResourceNotFoundError, 
    RateLimitExceededError, get_exception_for_status
)
from visualex_api.services.brocardi_scraper import BrocardiScraper
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.services.pdfextractor import PDFExtractor, cleanup_browser_pool
from visualex_api.tools.sys_op import WebDriverManager
from visualex_api.tools.urngenerator import complete_date_or_parse_async, urn_to_filename
from visualex_api.tools.treextractor import get_tree
from visualex_api.tools.text_op import format_date_to_extended, parse_article_input
from visualex_api.tools.cache_warmup import warmup_cache_background
from visualex_api.tools.cache_manager import get_cache_manager
from visualex_api.tools.map import extract_codice_details
import os
from visualex_api.tools.exceptions import ExtractionError
# Configure logging
logger = configure_logging()

# Initialize request storage
request_counts = defaultdict(lambda: {'count': 0, 'time': time.time()})
history = deque(maxlen=HISTORY_LIMIT)

# Settings
settings = Settings()

class NormaController:
    """
    Main controller for the VisuaLex API application.
    
    This class initializes the Quart application, sets up middleware,
    defines routes, and handles all HTTP requests.
    """
    
    def __init__(self):
        """Initialize the NormaController and set up the Quart application."""
        self.app = Quart(__name__)
        
        # Configure CORS
        allowed_origins = settings.get_list("allowed_origins", ["http://localhost:3001"])
        self.app = cors(self.app, allow_origin=allowed_origins)
        
        # Secret key for sessions
        self.app.secret_key = settings.get("secret_key", "development-key")
        
        # Initialize services
        self._init_services()
        
        # Set up middleware
        self._setup_middleware()
        
        # Define routes
        self._setup_routes()
        
        # Set up startup tasks (cache warmup)
        self._setup_startup_tasks()
        
        logger.info("NormaController initialized")
    
    def _init_services(self):
        """Initialize all required services."""
        logger.info("Initializing services")
        self.brocardi_scraper = BrocardiScraper()
        self.normattiva_scraper = NormattivaScraper()
        self.eurlex_scraper = EurlexScraper()
        self.driver_manager = WebDriverManager()
        self.pdf_extractor = PDFExtractor()
        logger.info("Services initialized")
    
    def _setup_middleware(self):
        """Set up middleware for request processing."""
        logger.info("Setting up middleware")
        # Record request start time
        self.app.before_request(self.record_start_time)
        # Apply rate limiting
        self.app.before_request(self.rate_limit_middleware)
        # Log request statistics after processing
        self.app.after_request(self.log_query_stats)
        # Global error handler
        self.app.errorhandler(Exception)(self.handle_error)
        logger.info("Middleware setup complete")
    
    def _setup_startup_tasks(self):
        """Set up tasks to run at application startup."""
        @self.app.before_serving
        async def on_startup():
            """Run warmup tasks when server starts."""
            logger.info("Starting cache warmup in background")
            asyncio.create_task(warmup_cache_background())

        @self.app.after_serving
        async def on_shutdown():
            """Cleanup tasks when server shuts down."""
            logger.info("Shutting down - cleaning up browser pool")
            await cleanup_browser_pool()
    
    def _setup_routes(self):
        """Set up all routes for the application."""
        logger.info("Setting up routes")
        # Basic routes
        self.app.add_url_rule('/', view_func=self.home)
        self.app.add_url_rule('/api/health', view_func=self.health_check)
        
        # Norm data routes
        self.app.add_url_rule('/api/fetch_norma_data', view_func=self.fetch_norma_data, methods=['POST'])
        self.app.add_url_rule('/api/fetch_article_text', view_func=self.fetch_article_text, methods=['POST'])
        self.app.add_url_rule('/api/stream_article_text', view_func=self.stream_article_text, methods=['POST'])
        self.app.add_url_rule('/api/fetch_brocardi_info', view_func=self.fetch_brocardi_info, methods=['POST'])
        self.app.add_url_rule('/api/fetch_all_data', view_func=self.fetch_all_data, methods=['POST'])
        self.app.add_url_rule('/api/fetch_tree', view_func=self.fetch_tree, methods=['POST'])
        
        # History and export routes
        self.app.add_url_rule('/api/history', view_func=self.get_history, methods=['GET'])
        self.app.add_url_rule('/api/export_pdf', view_func=self.export_pdf, methods=['POST'])
        
        # Swagger documentation
        self.app.add_url_rule('/api/docs', view_func=self.swagger_ui)
        self.app.add_url_rule('/api/openapi.json', view_func=self.openapi_spec)
        
        logger.info("Routes setup complete")
    
    # Middleware methods
    
    async def record_start_time(self):
        """Record the start time of a request for performance monitoring."""
        g.start_time = time.time()
    
    async def rate_limit_middleware(self):
        """
        Apply rate limiting to requests.
        
        This middleware checks if the client has exceeded their rate limit
        and returns a 429 error if they have.
        
        Raises:
            RateLimitExceededError: If the client has exceeded their rate limit
        """
        client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        current_time = time.time()
        logger.debug("Rate limit check", extra={"client_ip": client_ip, "current_time": current_time})

        request_info = request_counts[client_ip]
        if current_time - request_info['time'] < RATE_LIMIT_WINDOW:
            if request_info['count'] >= RATE_LIMIT:
                logger.warning("Rate limit exceeded", extra={"client_ip": client_ip})
                raise RateLimitExceededError("Rate limit exceeded. Try again later.")
            else:
                request_info['count'] += 1
        else:
            request_counts[client_ip] = {'count': 1, 'time': current_time}
    
    async def log_query_stats(self, response):
        """
        Log query statistics after processing a request.
        
        Args:
            response: The response object
            
        Returns:
            The response object
        """
        try:
            end_time = time.time()
            start_time = getattr(g, "start_time", end_time)
            duration = end_time - start_time

            tokens = None
            if response.content_type and "application/json" in response.content_type:
                text = await response.get_data(as_text=True)
                try:
                    data = json.loads(text)
                    tokens = self.count_tokens(data)
                except Exception:
                    tokens = "N/A"
            
            logger.info("Query statistics", extra={
                "path": request.path,
                "method": request.method,
                "duration": duration,
                "tokens": tokens,
                "status_code": response.status_code
            })
            
            # Log request-response
            await log_request(request, response)
            
        except Exception as e:
            logger.error("Error logging query statistics", extra={"error": str(e)})
        
        return response
    
    async def handle_error(self, error):
        """
        Global error handler for all exceptions.
        
        Args:
            error: The exception that was raised
            
        Returns:
            JSON response with error details
        """
        logger.error("Caught exception", extra={"error": str(error), "type": type(error).__name__})
        
        # Log request with error
        await log_request(request, error=error)
        
        # Handle known exceptions
        if isinstance(error, VisuaLexError):
            status_code = 400
            if isinstance(error, ResourceNotFoundError):
                status_code = 404
            elif isinstance(error, ValidationError):
                status_code = 400
            elif isinstance(error, RateLimitExceededError):
                status_code = 429
            
            return jsonify({'error': error.message}), status_code
        
        # Handle unknown exceptions
        return jsonify({'error': 'Internal server error'}), 500
    
    # Helper methods
    
    def count_tokens(self, data):
        """
        Count the number of tokens (words) in the data.
        
        Args:
            data: The data to count tokens in
            
        Returns:
            Number of tokens
        """
        if isinstance(data, str):
            return len(data.split())
        elif isinstance(data, dict):
            return sum(self.count_tokens(v) for v in data.values())
        elif isinstance(data, list):
            return sum(self.count_tokens(item) for item in data)
        else:
            return 0
    
    def get_scraper_for_norma(self, normavisitata):
        """
        Get the appropriate scraper for a given norm.
        
        Args:
            normavisitata: The norm to get a scraper for
            
        Returns:
            The appropriate scraper instance or None if not found
        """
        act_type_normalized = normavisitata.norma.tipo_atto.lower()
        logger.debug("Determining scraper for norma", extra={"act_type": act_type_normalized})
        
        if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
            return self.eurlex_scraper
        else:
            return self.normattiva_scraper
    
    async def create_norma_visitata_from_data(self, data):
        """
        Create NormaVisitata instances from request data.
        
        Args:
            data: The request data
            
        Returns:
            List of NormaVisitata instances
            
        Raises:
            ValidationError: If the request data is invalid
        """
        logger.info("Creating NormaVisitata from data", extra={"data": data})

        # Validate required fields
        if 'act_type' not in data:
            raise ValidationError("Missing required field: act_type")
        if 'article' not in data:
            raise ValidationError("Missing required field: article")

        allowed_types = ['legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'regio decreto']
        act_type = data.get('act_type')
        act_number = data.get('act_number')
        norma_date = data.get('date')

        # Check if this is a codice with extractable details (e.g., "codice civile" -> "regio decreto 262/1942")
        codice_details = extract_codice_details(act_type) if act_type else None
        tipo_atto_reale = None
        if codice_details and not norma_date and not act_number:
            logger.debug("Extracted codice details from URN map", extra={"codice_details": codice_details})
            norma_date = codice_details['data']
            act_number = codice_details['numero_atto']
            tipo_atto_reale = codice_details['tipo_atto_reale']
            # Note: we keep act_type as the alias (e.g., "codice civile") for display purposes

        # Process and complete date if needed
        if act_type in allowed_types:
            logger.debug("Act type is allowed", extra={"act_type": act_type})
            data_completa = await complete_date_or_parse_async(
                date=norma_date,
                act_type=act_type,
                act_number=act_number
            )
            logger.debug("Completed date parsed", extra={"data_completa": data_completa})
            data_completa_estesa = format_date_to_extended(data_completa)
            logger.debug("Extended date formatted", extra={"data_completa_estesa": data_completa_estesa})
        else:
            logger.debug("Act type is not in allowed types", extra={"act_type": act_type})
            data_completa_estesa = norma_date
            logger.debug("Using provided date", extra={"data_completa_estesa": data_completa_estesa})

        # Create Norma instance
        norma = Norma(
            tipo_atto=act_type,
            data=data_completa_estesa if data_completa_estesa else None,
            numero_atto=act_number,
            tipo_atto_reale=tipo_atto_reale
        )
        logger.debug("Norma instance created", extra={"norma": norma.to_dict()})

        # Parse and validate article numbers
        articles = await parse_article_input(str(data.get('article')), norma.url)
        logger.debug("Articles parsed", extra={"articles": articles})
        
        if isinstance(articles, dict) and 'error' in articles:
            raise ValidationError(articles['error'])

        # Validate and sanitize annex parameter
        annex_value = data.get('annex')
        if annex_value is not None:
            # Convert empty string or "null" string to None
            if isinstance(annex_value, str):
                annex_value = annex_value.strip()
                if annex_value == '' or annex_value.lower() == 'null' or annex_value.lower() == 'undefined':
                    annex_value = None
            # Convert to string if it's a number
            elif isinstance(annex_value, (int, float)):
                annex_value = str(int(annex_value))

        # If no annex specified, check if this is a codice with a default annex
        # e.g., "codice civile" maps to "regio.decreto:1942-03-16;262:2" where :2 is the annex
        if annex_value is None:
            from visualex_api.tools.map import NORMATTIVA_URN_CODICI
            from visualex_api.tools.text_op import normalize_act_type
            import re
            normalized_type = normalize_act_type(act_type)
            logger.info("Checking for default annex", extra={
                "act_type": act_type,
                "normalized_type": normalized_type,
                "in_codici_map": normalized_type in NORMATTIVA_URN_CODICI
            })
            if normalized_type in NORMATTIVA_URN_CODICI:
                codice_urn = NORMATTIVA_URN_CODICI[normalized_type]
                logger.info("Found codice URN", extra={"codice_urn": codice_urn})
                # Extract annex from URN pattern like "regio.decreto:1942-03-16;262:2"
                # The annex is after the last colon if there's a number;number:annex pattern
                annex_match = re.search(r';\d+:(\d+)$', codice_urn)
                logger.info("Annex regex match", extra={"match": str(annex_match)})
                if annex_match:
                    annex_value = annex_match.group(1)
                    logger.info("Using default annex from codice URN", extra={
                        "codice": normalized_type,
                        "default_annex": annex_value
                    })

        logger.debug("Validated annex value", extra={"annex": annex_value})

        # Create NormaVisitata instances for each article
        norma_visitata_list = []
        for article in articles:
            cleaned_article = article.strip().replace(' ', '-') if ' ' in article.strip() else article.strip()
            logger.debug("Processing article", extra={"article": cleaned_article})

            norma_visitata_list.append(NormaVisitata(
                norma=norma,
                numero_articolo=cleaned_article,
                versione=data.get('version'),
                data_versione=data.get('version_date'),
                allegato=annex_value
            ))
            logger.debug("NormaVisitata instance created", extra={
                "norma_visitata": norma_visitata_list[-1].to_dict()
            })

        logger.info("Created NormaVisitata instances", extra={
            "count": len(norma_visitata_list)
        })
        return norma_visitata_list
    
    # Route handlers
    
    async def home(self):
        """Render the home page."""
        return await render_template('index.html')
    
    async def health_check(self):
        """
        Health check endpoint for monitoring.
        
        Returns:
            JSON response with service status
        """
        cache_stats = get_cache_manager().get_stats()
        return jsonify({
            'status': 'ok',
            'timestamp': time.time(),
            'version': settings.get('version', '1.0.0'),
            'cache': cache_stats
        })
    
    async def swagger_ui(self):
        """Render the Swagger UI documentation page."""
        return await render_template('swagger_ui.html')
    
    async def openapi_spec(self):
        """Serve the OpenAPI specification."""
        with open('static/swagger.yaml', 'r') as file:
            return file.read(), 200, {'Content-Type': 'application/yaml'}
    
    async def fetch_norma_data(self):
        """
        Fetch norm data based on the request.
        
        Returns:
            JSON response with norm data
        """
        try:
            data = await request.get_json()
            logger.info("Received data for fetch_norma_data", extra={"data": data})

            normavisitate = await self.create_norma_visitata_from_data(data)
            response = {'norma_data': [nv.to_dict() for nv in normavisitate]}
            
            return jsonify(response)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            logger.error("Error in fetch_norma_data", extra={"error": str(e)})
            return jsonify({'error': str(e)}), 500
    
    async def fetch_article_text(self):
        """
        Fetch article text based on the request.
        
        Returns:
            JSON response with article text
        """
        try:
            data = await request.get_json()
            logger.info("Received data for fetch_article_text", extra={"data": data})

            normavisitate = await self.create_norma_visitata_from_data(data)

            async def fetch_text(nv):
                """Helper function to fetch text for a single norm."""
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    logger.warning("Unsupported act type for scraper", extra={"norma_data": nv.to_dict()})
                    return {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}

                try:
                    article_text, url = await scraper.get_document(nv)
                    logger.info("Document fetched successfully", extra={
                        "url": url,
                        "text_length": len(article_text) if article_text else 0
                    })
                    return {
                        'article_text': article_text,
                        'norma_data': nv.to_dict(),
                        'url': url
                    }
                except Exception as exc:
                    logger.error("Error fetching article text", extra={"error": str(exc)})
                    return {'error': str(exc), 'norma_data': nv.to_dict()}

            # Fetch all articles in parallel
            results = await asyncio.gather(*(fetch_text(nv) for nv in normavisitate), return_exceptions=True)
            
            # Process results
            processed_results = []
            for result in results:
                if isinstance(result, Exception):
                    logger.error("Exception during fetching article text", extra={"exception": str(result)})
                    processed_results.append({'error': str(result)})
                else:
                    processed_results.append(result)
            
            return jsonify(processed_results)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            logger.error("Error in fetch_article_text", extra={"error": str(e)})
            return jsonify({'error': str(e)}), 500
    
    async def stream_article_text(self):
        """
        Stream article text results as they become available.
        Now supports Brocardi info in parallel streaming!

        Returns:
            Streaming response with article text and optional Brocardi info
        """
        try:
            data = await request.get_json()
            logger.info("Received data for stream_article_text", extra={"data": data})

            normavisitate = await self.create_norma_visitata_from_data(data)
            show_brocardi = data.get('show_brocardi_info', False)

            async def result_generator():
                """Generator function for streaming results."""
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
                            tasks.append(self.brocardi_scraper.get_info(nv))

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

            return Response(
                result_generator(),
                mimetype='application/x-ndjson',
                headers={
                    'Cache-Control': 'no-cache',
                    'X-Accel-Buffering': 'no'  # Disable nginx buffering
                }
            )
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            logger.error("Error in stream_article_text", extra={"error": str(e)})
            return jsonify({'error': str(e)}), 500
    
    async def fetch_brocardi_info(self):
        """
        Fetch Brocardi information for norms.
        
        Returns:
            JSON response with Brocardi information
        """
        try:
            data = await request.get_json()
            logger.info("Received data for fetch_brocardi_info", extra={"data": data})

            normavisitate = await self.create_norma_visitata_from_data(data)

            async def fetch_info(nv):
                """Helper function to fetch Brocardi info for a single norm."""
                act_type_normalized = nv.norma.tipo_atto.lower()
                if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
                    return {'norma_data': nv.to_dict(), 'brocardi_info': None}

                try:
                    brocardi_info = await self.brocardi_scraper.get_info(nv)
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
                    logger.error("Error fetching Brocardi info", extra={"error": str(exc)})
                    return {'error': str(exc), 'norma_data': nv.to_dict()}

            # Fetch all Brocardi info in parallel
            results = await asyncio.gather(*(fetch_info(nv) for nv in normavisitate), return_exceptions=True)
            
            # Process results
            processed_results = []
            for result in results:
                if isinstance(result, Exception):
                    processed_results.append({'error': str(result)})
                else:
                    processed_results.append(result)
            
            return jsonify(processed_results)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            logger.error("Error in fetch_brocardi_info", extra={"error": str(e)})
            return jsonify({'error': str(e)}), 500
    
    async def fetch_all_data(self):
        """
        Fetch both article text and Brocardi information.
        
        Returns:
            JSON response with combined data
        """
        try:
            data = await request.get_json()
            logger.info("Received data for fetch_all_data", extra={"data": data})

            normavisitate = await self.create_norma_visitata_from_data(data)

            async def fetch_data(nv):
                """Helper function to fetch all data for a single norm."""
                scraper = self.get_scraper_for_norma(nv)
                if scraper is None:
                    logger.warning("Unsupported act type for scraper", extra={"norma_data": nv.to_dict()})
                    return {'error': 'Unsupported act type', 'norma_data': nv.to_dict()}

                try:
                    # Fetch article text
                    article_text, url = await scraper.get_document(nv)
                    
                    # Fetch Brocardi info if appropriate
                    brocardi_info = None
                    if scraper == self.normattiva_scraper:
                        try:
                            b_info = await self.brocardi_scraper.get_info(nv)
                            brocardi_info = {
                                'position': b_info[0] if b_info[0] else None,
                                'link': b_info[2],
                                'Brocardi': b_info[1].get('Brocardi') if b_info[1] and 'Brocardi' in b_info[1] else None,
                                'Ratio': b_info[1].get('Ratio') if b_info[1] and 'Ratio' in b_info[1] else None,
                                'Spiegazione': b_info[1].get('Spiegazione') if b_info[1] and 'Spiegazione' in b_info[1] else None,
                                'Massime': b_info[1].get('Massime') if b_info[1] and 'Massime' in b_info[1] else None
                            }
                        except Exception as exc:
                            logger.error("Error fetching Brocardi info", extra={"error": str(exc)})
                            brocardi_info = {'error': str(exc)}
                    
                    return {
                        'article_text': article_text,
                        'url': url,
                        'norma_data': nv.to_dict(),
                        'brocardi_info': brocardi_info
                    }
                except Exception as exc:
                    logger.error("Error fetching all data", extra={"error": str(exc)})
                    return {'error': str(exc), 'norma_data': nv.to_dict()}

            # Fetch all data in parallel
            results = await asyncio.gather(*(fetch_data(nv) for nv in normavisitate), return_exceptions=True)
            
            # Process results
            processed_results = []
            for result in results:
                if isinstance(result, Exception):
                    processed_results.append({'error': str(result)})
                    logger.error("Exception during fetching all data", extra={"exception": str(result)})
                else:
                    processed_results.append(result)
            
            return jsonify(processed_results)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            logger.error("Error in fetch_all_data", extra={"error": str(e)})
            return jsonify({'error': str(e)}), 500
    
    async def fetch_tree(self):
        """
        Fetch the tree structure of a norm.

        Returns:
            JSON response with tree structure and optional annex metadata
        """
        try:
            data = await request.get_json()
            logger.info("Received data for fetch_tree", extra={"data": data})

            urn = data.get('urn')
            if not urn:
                logger.error("Missing 'urn' in request data")
                raise ValidationError("Missing 'urn' in request data")

            link = data.get('link', False)
            details = data.get('details', False)
            return_metadata = data.get('return_metadata', True)  # Default to True for annex detection

            if not isinstance(link, bool):
                logger.error("'link' must be a boolean")
                raise ValidationError("'link' must be a boolean")

            if not isinstance(details, bool):
                logger.error("'details' must be a boolean")
                raise ValidationError("'details' must be a boolean")

            if not isinstance(return_metadata, bool):
                logger.error("'return_metadata' must be a boolean")
                raise ValidationError("'return_metadata' must be a boolean")

            logger.debug("Fetching tree", extra={"link": link, "details": details, "return_metadata": return_metadata})

            if return_metadata:
                articles, count, metadata = await get_tree(urn, link=link, details=details, return_metadata=True)
            else:
                articles, count = await get_tree(urn, link=link, details=details, return_metadata=False)
                metadata = {}

            if isinstance(articles, str):
                logger.error("Error fetching tree", extra={"error": articles})
                raise ResourceNotFoundError(articles)

            response = {'articles': articles, 'count': count}
            if return_metadata and metadata:
                response['metadata'] = metadata

            logger.info("Tree fetched successfully", extra={"count": count, "has_metadata": bool(metadata)})

            return jsonify(response)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        except ResourceNotFoundError as e:
            return jsonify({'error': str(e)}), 404
        except Exception as e:
            logger.error("Error in fetch_tree", extra={"error": str(e)})
            return jsonify({'error': str(e)}), 500
    
    async def get_history(self):
        """
        Get request history.
        
        Returns:
            JSON response with history
        """
        try:
            return jsonify({'history': list(history)})
        except Exception as e:
            logger.error("Error in get_history", extra={"error": str(e)})
            return jsonify({'error': str(e)}), 500
    
    async def export_pdf(self):
        """
        Export a norm as PDF.
        
        Returns:
            PDF file
        """
        try:
            data = await request.get_json()
            urn = data.get('urn')
            if not urn:
                raise ValidationError('URN missing')

            logger.info("Received data for export_pdf", extra={"urn": urn})
            pdf_path = urn_to_filename(urn)

            # Check if the PDF already exists
            file_exists = await asyncio.to_thread(os.path.exists, pdf_path)
            if file_exists:
                file_size = await asyncio.to_thread(os.path.getsize, pdf_path)
                if file_size > 0:
                    logger.info(f"Using cached PDF: {pdf_path}")
                    return await send_file(
                        pdf_path,
                        mimetype='application/pdf',
                        as_attachment=True,
                        attachment_filename=os.path.basename(pdf_path)
                    )
                else:
                    logger.info(f"PDF file exists but is empty: {pdf_path}. Regenerating.")
                    await asyncio.to_thread(os.remove, pdf_path)

            # Extract the PDF using Selenium
            driver = await asyncio.to_thread(self.driver_manager.setup_driver)
            try:
                pdf_extractor = PDFExtractor()
                extracted_pdf_path = await asyncio.to_thread(
                    pdf_extractor.extract_pdf, driver, urn
                )
                logger.info(f"PDF extracted: {extracted_pdf_path}")
            finally:
                await asyncio.to_thread(self.driver_manager.close_drivers)

            # Verify the extracted PDF
            exists_extracted = await asyncio.to_thread(os.path.exists, extracted_pdf_path)
            size_extracted = await asyncio.to_thread(os.path.getsize, extracted_pdf_path) if exists_extracted else 0
            
            if not exists_extracted or size_extracted == 0:
                raise ExtractionError("Extracted PDF is empty or does not exist")

            # Cache the PDF if needed
            if extracted_pdf_path != pdf_path:
                def copy_file(src, dst):
                    with open(src, 'rb') as fsrc, open(dst, 'wb') as fdst:
                        fdst.write(fsrc.read())
                await asyncio.to_thread(copy_file, extracted_pdf_path, pdf_path)
                logger.info(f"PDF cached: {pdf_path}")
            else:
                logger.info("Using extracted PDF as cache")

            # Send the PDF to the client
            return await send_file(
                pdf_path,
                mimetype='application/pdf',
                as_attachment=True,
                attachment_filename=os.path.basename(pdf_path)
            )
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        except ResourceNotFoundError as e:
            return jsonify({'error': str(e)}), 404
        except ExtractionError as e:
            return jsonify({'error': str(e)}), 500
        except Exception as e:
            logger.error("Error in export_pdf", extra={"error": str(e)})
            return jsonify({'error': str(e)}), 500
    
# Create the application instance
controller = NormaController()
app = controller.app  # This is the Quart application

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)