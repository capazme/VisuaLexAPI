"""
Logging configuration for the VisuaLex API.

This module provides structured logging setup and request logging utilities.
"""

import logging
import sys
from datetime import datetime
from typing import Optional, Union
from quart import Request, Response


def configure_logging(
    level: int = logging.INFO,
    log_file: Optional[str] = "visualex_api.log",
    format_string: Optional[str] = None
) -> logging.Logger:
    """
    Configure and return a logger instance with structured logging.

    Args:
        level: Logging level (default: INFO)
        log_file: Path to log file (default: "visualex_api.log")
        format_string: Custom log format string (optional)

    Returns:
        Configured logger instance
    """
    if format_string is None:
        format_string = (
            "%(asctime)s | %(levelname)-8s | %(name)s | "
            "%(funcName)s:%(lineno)d | %(message)s"
        )

    # Create logger
    logger = logging.getLogger("visualex_api")
    logger.setLevel(level)

    # Remove existing handlers to avoid duplicates
    logger.handlers.clear()

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_formatter = logging.Formatter(format_string, datefmt="%Y-%m-%d %H:%M:%S")
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)

    # File handler (if log_file is specified)
    if log_file:
        try:
            file_handler = logging.FileHandler(log_file, encoding="utf-8")
            file_handler.setLevel(level)
            file_formatter = logging.Formatter(format_string, datefmt="%Y-%m-%d %H:%M:%S")
            file_handler.setFormatter(file_formatter)
            logger.addHandler(file_handler)
        except Exception as e:
            logger.warning(f"Could not create file handler for {log_file}: {e}")

    # Prevent propagation to root logger
    logger.propagate = False

    logger.info("Logging configured successfully")
    return logger


async def log_request(
    request: Request,
    response: Optional[Union[Response, Exception]] = None,
    error: Optional[Exception] = None
) -> None:
    """
    Log details about an HTTP request and its response.

    Args:
        request: The Quart request object
        response: The Quart response object (optional)
        error: Any exception that occurred (optional)
    """
    logger = logging.getLogger("visualex_api")

    # Extract request details
    method = request.method
    path = request.path
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    timestamp = datetime.utcnow().isoformat()

    # Build log context
    log_context = {
        "timestamp": timestamp,
        "method": method,
        "path": path,
        "client_ip": client_ip,
    }

    # Add query parameters if present
    if request.query_string:
        log_context["query_string"] = request.query_string.decode("utf-8")

    # Add response details
    if response is not None and not error:
        if isinstance(response, Response):
            log_context["status_code"] = response.status_code
            logger.info(
                f"{method} {path} - {response.status_code}",
                extra=log_context
            )
        else:
            logger.info(f"{method} {path}", extra=log_context)

    # Add error details if present
    if error:
        log_context["error"] = str(error)
        log_context["error_type"] = type(error).__name__

        if hasattr(error, "status_code"):
            log_context["status_code"] = error.status_code

        logger.error(
            f"{method} {path} - Error: {type(error).__name__}",
            extra=log_context,
            exc_info=True
        )


def get_logger(name: str = "visualex_api") -> logging.Logger:
    """
    Get a logger instance by name.

    Args:
        name: Logger name (default: "visualex_api")

    Returns:
        Logger instance
    """
    return logging.getLogger(name)
