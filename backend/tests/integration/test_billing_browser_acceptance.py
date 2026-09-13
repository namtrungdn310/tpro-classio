"""Real browser -> authenticated FastAPI -> disposable PostgreSQL.

No auth dependency overrides. The runner provisions a signed aal2 test session;
Google/TOTP login itself is intentionally outside this test's scope.
"""

import asyncio
from datetime import datetime, timezone, timedelta
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import asyncpg
import httpx
import pytest
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.device_sessions import hash_device_value
from app.core.security import create_access_token
from test_membership_transitions import (
    _make_independent_membership,
    _financial_snapshot,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_BILLING_BROWSER_E2E") != "1",
        reason="opt-in isolated browser acceptance",
    ),
]


async def test_browser_deadline_persists_with_real_auth_and_database(monkeypatch):
    from app.core.config import settings
    from sqlalchemy.engine import make_url

    url = make_url(settings.database_url)
    assert url.host == "127.0.0.1" and url.database == "tpro_r3"
    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    user_id, nonce = str(uuid4()), str(uuid4())
    email = f"browser-{user_id}@example.test"
    async with AsyncSessionLocal() as db:
        enrollment, class_id, student_id = await _make_independent_membership(db)
        baseline = await _financial_snapshot(db, enrollment.id)
        workspace = await db.scalar(
            text("select workspace_id from enrollments where id=cast(:id as uuid)"),
            {"id": str(enrollment.id)},
        )
    owner = await asyncpg.connect(os.environ["DB_TEST_ADMIN_DSN"])
    try:
        await owner.execute(
            "insert into auth.users(id,email) values($1::uuid,$2)", user_id, email
        )
        await owner.execute(
            "insert into profiles(id,role,account_status,workspace_id) values($1::uuid,'admin','active',$2::uuid) on conflict(id) do update set role='admin',account_status='active',workspace_id=excluded.workspace_id",
            user_id,
            str(workspace),
        )
        await owner.execute(
            "insert into user_device_sessions(user_id,device_type,device_id_hash,refresh_token_hash,session_nonce,aal,mfa_verified_at) values($1::uuid,'desktop',$2,$2,$3,'aal2',$4)",
            user_id,
            hash_device_value("isolated-browser-device-12345"),
            nonce,
            datetime.now(timezone.utc),
        )
    finally:
        await owner.close()
    token = create_access_token(
        {
            "sub": user_id,
            "email": email,
            "role": "admin",
            "aal": "aal2",
            "device_type": "desktop",
            "session_nonce": nonce,
        }
    )
    from app.core.business_time import business_today

    new_anchor = business_today() + timedelta(days=15)
    env = dict(
        os.environ,
        INDEPENDENT_BILLING_DATES_ENABLED="true",
        TPRO_E2E_REAL_API="http://127.0.0.1:8019",
        NEXT_INTERNAL_API_URL="http://127.0.0.1:8019",
        APP_ORIGIN="http://127.0.0.1:3100",
        TPRO_E2E_TOKEN=token,
        TPRO_E2E_FEE=baseline["fees"][0]["id"],
        TPRO_E2E_ENROLLMENT=str(enrollment.id),
        TPRO_E2E_ANCHOR_DISPLAY=new_anchor.strftime("%d/%m/%Y"),
        TPRO_E2E_CLASS=class_id,
        TPRO_E2E_CLASS_START=(business_today() - timedelta(days=100)).isoformat(),
        TPRO_E2E_STUDENT=student_id,
        TPRO_E2E_ADMISSION=(business_today() + timedelta(days=9)).isoformat(),
    )
    backend = Path(__file__).resolve().parents[2]
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8019",
        ],
        cwd=backend,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        async with httpx.AsyncClient() as client:
            for _ in range(60):
                if process.poll() is not None:
                    pytest.fail("Isolated API exited before readiness")
                try:
                    if (
                        await client.get("http://127.0.0.1:8019/health/ready")
                    ).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.25)
            assert (
                await client.get("http://127.0.0.1:8019/students/date-capabilities")
            ).status_code == 401
            for path in (
                "/reports/billing/enrollments",
                f"/reports/billing/enrollments/{enrollment.id}/history",
                f"/reports/billing/enrollments/{enrollment.id}/fees",
            ):
                assert (
                    await client.get("http://127.0.0.1:8019" + path)
                ).status_code == 401
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "npx.cmd" if os.name == "nt" else "npx",
                "playwright",
                "test",
                "billing-dates.real.spec.ts",
                "--project=chromium",
            ],
            cwd=backend.parent / "frontend",
            env=env,
            capture_output=True,
            text=True,
            timeout=240,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        assert "5 passed" in result.stdout, (
            "All five real browser scenarios must execute"
        )
        async with AsyncSessionLocal() as db:
            after = await _financial_snapshot(db, enrollment.id)
            assert len(after["revisions"]) == 2
            assert baseline["revisions"][0] in after["revisions"]
            original = next(
                f for f in after["fees"] if f["id"] == baseline["fees"][0]["id"]
            )
            assert original["status"] == "SUPERSEDED"
            for field in (
                "base_amount",
                "final_amount",
                "coverage_start",
                "coverage_end",
            ):
                assert original[field] == baseline["fees"][0][field]
            assert original["adjusted_due_date"] == "2026-09-01"
            admission = await db.scalar(
                text(
                    "select enrollment_date from enrollments where id=cast(:id as uuid)"
                ),
                {"id": str(enrollment.id)},
            )
            assert admission == business_today() + timedelta(days=9)
            assert any(
                r["anchor_date"] == new_anchor.isoformat() for r in after["revisions"]
            )
            count = await db.scalar(
                text(
                    "select count(*) from start_date_change_commands where actor_user_id=cast(:id as uuid) and operation_kind='FEE_DUE_DATE_CHANGE'"
                ),
                {"id": user_id},
            )
            assert count == 2  # two intentions, not three HTTP apply attempts
            class_start = await db.scalar(
                text("select start_date from classes where id=cast(:id as uuid)"),
                {"id": class_id},
            )
            assert class_start == business_today() - timedelta(days=100)
    finally:
        process.terminate()
        await asyncio.to_thread(process.wait, timeout=20)
