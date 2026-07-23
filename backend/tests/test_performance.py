import pytest

from app.core.performance import log_timing


def test_log_timing_never_swallows_fast_exceptions() -> None:
    with pytest.raises(RuntimeError, match="business failure"):
        with log_timing("test.fast_failure", threshold_ms=60_000):
            raise RuntimeError("business failure")
