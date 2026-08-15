"""API-level tests for the make-up contract (auth, error codes, projection).

Runs against the disposable DB via httpx ASGITransport with overridden auth
and rate-limit dependencies. Deterministic fixtures; no production data.
"""

import os
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import text

from app.core.business_time import BUSINESS_TIMEZONE, business_today
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.database import AsyncSessionLocal, get_db as get_db_dependency
from app.core.dependencies import Principal, get_current_user, require_management
from app.core.rate_limit import enforce_rate_limit as rate_limit_dependency
from app.main import app

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _override_db():
    async with AsyncSessionLocal() as session:
        yield session


async def _override_current_user():
    # R6-D14: viewer bị retire — mọi route quản trị deny-by-default.
    from fastapi import HTTPException

    raise HTTPException(
        status_code=403, detail="Tài khoản không có quyền truy cập hệ thống"
    )


async def _override_admin():
    return Principal(
        user_id=TEST_PROFILE_ID,
        email="api-admin@example.com",
        persistent_role="admin",
        effective_role="admin",
        is_owner=False,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="browser",
        session_nonce="integration-test",
    )


TEST_PROFILE_ID = "90000000-0000-0000-0000-000000000001"


async def _ensure_test_profile() -> None:
    """Tạo auth.users + profiles bằng admin DSN (tpro_runtime không có quyền
    ghi auth.users — đúng thiết kế)."""
    admin_dsn = os.environ.get("DB_TEST_ADMIN_DSN", "")
    engine = create_async_engine(
        admin_dsn.replace("postgresql://", "postgresql+asyncpg://")
    )
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                text(
                    "insert into public.profiles (id, username, full_name, role) "
                    "values (cast(:id as uuid), 'api-makeup-test', 'API Makeup Test', 'admin') "
                    "on conflict (id) do nothing"
                ),
                {"id": TEST_PROFILE_ID},
            )
            await db.commit()
    except Exception:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "insert into auth.users (id, email, raw_user_meta_data) "
                    "values (cast(:id as uuid), 'api-makeup-test@example.com', "
                    '\'{"username":"api-makeup-test"}\') on conflict (id) do nothing'
                ),
                {"id": TEST_PROFILE_ID},
            )
            await connection.execute(
                text(
                    "insert into public.profiles (id, username, full_name, role) "
                    "values (cast(:id as uuid), 'api-makeup-test', 'API Makeup Test', 'admin') "
                    "on conflict (id) do nothing"
                ),
                {"id": TEST_PROFILE_ID},
            )
    finally:
        await engine.dispose()


async def _override_no_rate_limit(*args, **kwargs):
    return None


def _client(role: str = "admin") -> httpx.AsyncClient:
    app.dependency_overrides.clear()
    app.dependency_overrides[get_db_dependency] = _override_db
    app.dependency_overrides[rate_limit_dependency] = _override_no_rate_limit
    if role == "admin":
        app.dependency_overrides[require_management] = _override_admin
        app.dependency_overrides[get_current_user] = _override_admin
    else:
        app.dependency_overrides[require_management] = _override_current_user
        app.dependency_overrides[get_current_user] = _override_current_user
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
    )


async def _create_fixture_class() -> dict:
    teacher = str(uuid4())
    class_id = str(uuid4())
    monday = business_today() + timedelta(
        days=(7 - business_today().weekday()) % 7 or 7
    )
    async with AsyncSessionLocal() as db:
        await db.execute(
            text(
                "insert into public.staff_members "
                "(id, full_name, staff_type, zalo_name, phone, is_active) "
                "values (cast(:i as uuid), 'API Teacher', 'TEACHER', 'api', '0900111222', true)"
            ),
            {"i": teacher},
        )
        await db.execute(
            text(
                """
                insert into public.classes (
                  id, name, type, base_fee, billing_cycle_months, teacher_id,
                  identity_scheme, class_category, grade_mode, grade_level,
                  education_level, academic_year_start, start_date, end_date,
                  is_active, schedule
                ) values (
                  cast(:id as uuid), :n, 'MONTHLY', 750000, 1, cast(:t as uuid),
                  'ACADEMIC_YEAR', 'GENERAL', 'GRADE', 6, 'MIDDLE', 2026,
                  :sd, :ed, true, :s
                )
                """
            ),
            {
                "id": class_id,
                "n": f"API {class_id[:8]}",
                "t": teacher,
                "sd": monday,
                "ed": monday + timedelta(days=90),
                "s": (
                    '{"text": "Thứ 2 (18:00-19:30)", "slots": ['
                    '{"day": "Thứ 2", "start": "18:00", "end": "19:30", '
                    '"teacher_ids": ["' + teacher + '"], "assistant_ids": []}]}'
                ),
            },
        )
        await db.execute(
            text(
                "insert into public.class_teachers (class_id, teacher_id) "
                "values (cast(:c as uuid), cast(:t as uuid))"
            ),
            {"c": class_id, "t": teacher},
        )
        await db.commit()
    return {"class": class_id, "teacher": teacher, "monday": monday}


def _original_start(monday: date) -> str:
    local = datetime.combine(
        monday, datetime.min.time().replace(hour=18), tzinfo=BUSINESS_TIMEZONE
    )
    return local.astimezone(timezone.utc).isoformat()


def _parse_api_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@pytest.mark.asyncio
async def test_viewer_cannot_mutate_but_can_read() -> None:
    await _ensure_test_profile()
    fixture = await _create_fixture_class()
    async with _client(role="viewer") as client:
        response = await client.get(
            f"/classes/{fixture['class']}/occurrences",
            params={
                "from": fixture["monday"].isoformat(),
                "to": (fixture["monday"] + timedelta(days=6)).isoformat(),
            },
        )
        # R6-D14: viewer đã bị retire — deny-by-default cho mọi route quản trị.
        assert response.status_code == 403

        response = await client.post(
            f"/classes/{fixture['class']}/schedule-adjustments",
            json={
                "original_start_at": [_original_start(fixture["monday"])],
                "reason_code": "OTHER",
                "reason_note": None,
                "schedule_now": False,
                "request_id": str(uuid4()),
            },
        )
        assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_admin_mutation_flow_and_error_contract() -> None:
    await _ensure_test_profile()
    fixture = await _create_fixture_class()
    original = _original_start(fixture["monday"])
    request_id = str(uuid4())

    async with _client(role="admin") as client:
        # Preview trước (read-only).
        preview = await client.post(
            f"/classes/{fixture['class']}/schedule-adjustments/preview",
            json={
                "from_date": fixture["monday"].isoformat(),
                "to_date": (fixture["monday"] + timedelta(days=6)).isoformat(),
            },
        )
        assert preview.status_code == 200
        options = preview.json()["occurrences"]
        assert any(
            _parse_api_datetime(item["original_start_at"])
            == datetime.fromisoformat(original)
            for item in options
        )
        assert preview.json()["billing_impact"] == "NONE"

        # Postpone.
        created = await client.post(
            f"/classes/{fixture['class']}/schedule-adjustments",
            json={
                "original_start_at": [original],
                "reason_code": "TEACHER_UNAVAILABLE",
                "reason_note": "Lý do API test",
                "schedule_now": False,
                "request_id": request_id,
            },
        )
        assert created.status_code == 200, created.text
        body = created.json()
        assert body["billing_impact"] == "NONE"
        exception = body["exceptions"][0]
        assert exception["status"] == "MAKEUP_PENDING"
        assert exception["display_status"] == "MAKEUP_PENDING"
        assert exception["billing_impact"] == "NONE"
        assert "student_phone" not in created.text
        assert "notes" not in created.text

        # Idempotent replay.
        replayed = await client.post(
            f"/classes/{fixture['class']}/schedule-adjustments",
            json={
                "original_start_at": [original],
                "reason_code": "TEACHER_UNAVAILABLE",
                "reason_note": "Lý do API test",
                "schedule_now": False,
                "request_id": request_id,
            },
        )
        assert replayed.status_code == 200
        assert replayed.json()["exceptions"][0]["id"] == exception["id"]

        # Error contract: không lộ SQL/stack.
        bad = await client.post(
            f"/classes/{fixture['class']}/schedule-adjustments",
            json={
                "original_start_at": [original],
                "reason_code": "OTHER",
                "reason_note": None,
                "schedule_now": False,
                "request_id": str(uuid4()),
            },
        )
        assert bad.status_code == 409
        error_body = bad.json()["detail"]
        assert error_body["code"] == "OCCURRENCE_ALREADY_ADJUSTED"
        assert "sql" not in bad.text.lower()
        assert "traceback" not in bad.text.lower()
        assert "class_session_exceptions" not in bad.text

        # Schedule preview với conflict-free slot.
        replacement = datetime.fromisoformat(original) + timedelta(days=3)
        preview_schedule = await client.post(
            f"/class-session-exceptions/{exception['id']}/makeup/preview",
            json={"replacement_start_at": replacement.isoformat()},
        )
        assert preview_schedule.status_code == 200
        assert preview_schedule.json()["can_schedule"] is True
        assert preview_schedule.json()["duration_minutes"] == 90
        assert len(preview_schedule.json()["staff"]) == 1
        assert preview_schedule.json()["billing_impact"] == "NONE"

        # Schedule.
        scheduled = await client.post(
            f"/class-session-exceptions/{exception['id']}/makeup/schedule",
            json={
                "replacement_start_at": replacement.isoformat(),
                "request_id": str(uuid4()),
                "expected_version": exception["version"],
            },
        )
        assert scheduled.status_code == 200, scheduled.text
        assert scheduled.json()["exception"]["status"] == "MAKEUP_SCHEDULED"
        assert scheduled.json()["billing_impact"] == "NONE"

        # Complete trước khi kết thúc -> 409 MAKEUP_NOT_FINISHED.
        completed = await client.post(
            f"/class-session-exceptions/{exception['id']}/makeup/complete",
            json={
                "request_id": str(uuid4()),
                "expected_version": exception["version"] + 1,
            },
        )
        assert completed.status_code == 409
        assert completed.json()["detail"]["code"] in (
            "MAKEUP_NOT_FINISHED",
            "CLASS_VERSION_CONFLICT",
        )

        # List adjustments.
        adjustments = await client.get(
            f"/classes/{fixture['class']}/schedule-adjustments"
        )
        assert adjustments.status_code == 200
        assert len(adjustments.json()["adjustments"]) >= 1

        # Detail exception.
        detail = await client.get(f"/class-session-exceptions/{exception['id']}")
        assert detail.status_code == 200
        assert detail.json()["billing_impact"] == "NONE"


@pytest.mark.asyncio
async def test_unauthenticated_denied() -> None:
    app.dependency_overrides.clear()
    app.dependency_overrides[get_db_dependency] = _override_db
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
    ) as client:
        response = await client.get("/classes/summary")
        assert response.status_code == 401
        response = await client.post(
            "/classes/00000000-0000-0000-0000-000000000000/schedule-adjustments",
            json={
                "original_start_at": ["2026-10-05T11:00:00+00:00"],
                "reason_code": "OTHER",
                "reason_note": None,
                "schedule_now": False,
                "request_id": str(uuid4()),
            },
        )
        assert response.status_code == 401
