import logging
import time
from contextlib import contextmanager
from typing import Iterator

PERFORMANCE_LOGGER = "tpro_classio.performance"


@contextmanager
def log_timing(
    label: str,
    *,
    threshold_ms: float = 50,
    logger_name: str = PERFORMANCE_LOGGER,
    **meta: str | int | float | bool | None,
) -> Iterator[None]:
    started_at = time.perf_counter()
    try:
        yield
    finally:
        duration_ms = (time.perf_counter() - started_at) * 1000
        if duration_ms >= threshold_ms:
            logger = logging.getLogger(logger_name)
            meta_text = " ".join(
                f"{key}={value}" for key, value in meta.items() if value is not None
            )
            message = f"{label} took {duration_ms:.1f}ms"
            if meta_text:
                message = f"{message} {meta_text}"

            if duration_ms >= threshold_ms * 3:
                logger.warning(message)
            else:
                logger.info(message)
