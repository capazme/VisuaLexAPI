"""
Logging configuration for VisuaLexAPI.

Provides structured logging using structlog for consistent log formatting
across the application.
"""

import logging
import structlog
from typing import Any, Optional


def configure_logging(level: str = "INFO") -> structlog.BoundLogger:
    """
    Configure structured logging for the application.
    
    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        
    Returns:
        A configured structlog logger
    """
    # Configure standard library logging
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler("visualex_api.log"),
            logging.StreamHandler()
        ]
    )
    
    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.dev.ConsoleRenderer()
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    
    return structlog.get_logger()


async def log_request(request: Any, response: Any = None, error: Any = None) -> None:
    """
    Log request/response details for monitoring.
    
    Args:
        request: The request object
        response: The response object (optional)
        error: Any error that occurred (optional)
    """
    log = structlog.get_logger()
    
    log_data = {
        "method": request.method if hasattr(request, "method") else "UNKNOWN",
        "path": request.path if hasattr(request, "path") else "UNKNOWN",
    }
    
    if response:
        log_data["status_code"] = getattr(response, "status_code", None)
    
    if error:
        log_data["error"] = str(error)
        log_data["error_type"] = type(error).__name__
        log.error("Request failed", **log_data)
    else:
        log.info("Request processed", **log_data)
