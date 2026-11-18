"""uvicorn's access log without query strings.

The access log writes each request's path. A query string can carry what a person typed (the
server calls `GET /api/v1/graph/entities/search?q=...`), and MERL-T's logs carry lengths, never a
person's text (services/merlt/CLAUDE.md, Personal data). This filter keeps the method, the path
and the status, and drops everything after the `?`.

uvicorn logs `'%s - "%s %s HTTP/%s" %d'` with the arguments (client, method, path with query,
HTTP version, status); the filter rewrites the third. It sits on the `uvicorn.access` logger, so
it holds whatever handlers uvicorn's logging configuration installs.
"""

import logging

ACCESS_LOGGER = "uvicorn.access"


class NoQueryInAccessLog(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and "?" in args[2]:
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True


def install(logger_name: str = ACCESS_LOGGER) -> None:
    """Add the filter once."""
    logger = logging.getLogger(logger_name)
    if not any(isinstance(existing, NoQueryInAccessLog) for existing in logger.filters):
        logger.addFilter(NoQueryInAccessLog())
