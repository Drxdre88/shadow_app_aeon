"""Shared pytest fixtures."""

from collections.abc import Iterator

import pytest
from loguru import logger


@pytest.fixture
def log_lines() -> Iterator[list[str]]:
    """Capture every loguru message, including DEBUG."""
    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(str(message)), level="DEBUG")
    yield lines
    logger.remove(sink)
