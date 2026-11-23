"""The root logger's handlers, shared by the modules that set up logging."""

import logging
import os


def log_handlers(default_file: str) -> list[logging.Handler]:
    """The root logger's handlers: the console, plus a file unless told otherwise.

    Development keeps writing ``default_file`` in the working directory. Setting
    ``VISUALEX_LOG_FILE`` names another file, and setting it EMPTY drops the file
    handler: a container with a read-only root filesystem cannot open one, and
    several modules used to try at import time, so the application never started.
    """
    path = os.getenv("VISUALEX_LOG_FILE", default_file)
    handlers: list[logging.Handler] = []
    if path:
        handlers.append(logging.FileHandler(path))
    handlers.append(logging.StreamHandler())
    return handlers
