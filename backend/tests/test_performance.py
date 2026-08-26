import pytest

from app.core.performance import (
    MAX_SQL_PER_REQUEST,
    QUERY_SLOW_MS,
    REQUEST_SLOW_MS,
    RequestMetrics,
    _sanitize_sql_label,
    log_request_metrics_summary,
    log_timing,
    record_pool_wait,
    record_sql,
    request_metrics_breached,
    track_request_metrics,
)


def test_log_timing_never_swallows_fast_exceptions() -> None:
    with pytest.raises(RuntimeError, match="business failure"):
        with log_timing("test.fast_failure", threshold_ms=60_000):
            raise RuntimeError("business failure")


def test_track_request_metrics_isolates_context() -> None:
    with track_request_metrics() as metrics:
        assert metrics.sql_count == 0
        record_sql("select 1", 10.0)
        record_sql("select 2", 120.0)
        record_pool_wait(150.0)
        assert metrics.sql_count == 2
        assert metrics.db_total_ms == 130.0
        assert metrics.pool_wait_ms == 150.0
        assert [q.statement for q in metrics.slow_queries] == ["select 2"]

    # Outside the context there is no active metrics object.
    record_sql("select 3", 10.0)


def test_record_sql_only_keeps_slow_queries_below_capture_limit() -> None:
    with track_request_metrics() as metrics:
        for index in range(20):
            record_sql(f"select {index}", QUERY_SLOW_MS + 1)
        assert len(metrics.slow_queries) == 10
        assert metrics.sql_count == 20


def test_sanitize_sql_label_strips_literals_and_truncates() -> None:
    raw = "select name from students where full_name = 'Nguyen Van A'"
    sanitized = _sanitize_sql_label(raw)
    assert "Nguyen Van A" not in sanitized
    assert "?" in sanitized
    long_sql = "select " + " ".join(["x"] * 300)
    assert len(_sanitize_sql_label(long_sql)) <= 170


def test_request_metrics_breached_thresholds() -> None:
    slow_request = RequestMetrics()
    assert request_metrics_breached(slow_request, REQUEST_SLOW_MS + 1)

    many_queries = RequestMetrics(sql_count=MAX_SQL_PER_REQUEST + 1)
    assert request_metrics_breached(many_queries, 10)

    slow_query = RequestMetrics()
    slow_query.slow_queries = [MockQueryTiming("select 1", 120.0)]
    assert request_metrics_breached(slow_query, 10)

    quiet = RequestMetrics(sql_count=3)
    assert not request_metrics_breached(quiet, 50)

    assert request_metrics_breached(None, REQUEST_SLOW_MS + 1)
    assert not request_metrics_breached(None, 10)


def test_log_request_metrics_summary_warns_on_breach(caplog) -> None:
    with caplog.at_level("WARNING", logger="tpro_classio.performance"):
        metrics = RequestMetrics(sql_count=MAX_SQL_PER_REQUEST + 1)
        log_request_metrics_summary(
            method="GET",
            path="/classes",
            status=200,
            request_id="req-123",
            duration_ms=100,
            response_size=2048,
            metrics=metrics,
        )
    assert any("sql_count=21" in record.message for record in caplog.records)
    assert any(record.levelname == "WARNING" for record in caplog.records)


def test_log_request_metrics_summary_quiet_request_is_debug(caplog) -> None:
    with caplog.at_level("DEBUG", logger="tpro_classio.performance"):
        log_request_metrics_summary(
            method="GET",
            path="/classes",
            status=200,
            request_id="req-456",
            duration_ms=50,
            response_size=64,
            metrics=RequestMetrics(sql_count=2),
        )
    assert not any(record.levelname == "WARNING" for record in caplog.records)
    assert any(record.levelname == "DEBUG" for record in caplog.records)


class MockQueryTiming:
    def __init__(self, statement: str, duration_ms: float) -> None:
        self.statement = statement
        self.duration_ms = duration_ms
