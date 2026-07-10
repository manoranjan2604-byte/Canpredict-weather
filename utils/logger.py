"""
Centralized logging configuration.

Render (and most PaaS platforms) collect whatever is written to stdout, so
logs are configured to stream there with a simple, greppable format.
"""
from __future__ import annotations

import logging
import sys

from config import config


def get_logger(name: str) -> logging.Logger:
    """Return a module-level logger configured to stream to stdout."""
    logger = logging.getLogger(name)

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(config.LOG_LEVEL)
        logger.propagate = False

    return logger
