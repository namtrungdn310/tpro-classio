"""Back up the configured database without exposing connection credentials."""

import hashlib
import asyncio
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone

from sqlalchemy.engine import make_url
from sqlalchemy import text
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings  # noqa: E402
from app.core.database import engine  # noqa: E402

IDENTITY_SQL = "SELECT current_database() || ':' || coalesce((SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM public.classes),'empty') || ':' || coalesce((SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM public.students),'empty')"

async def runtime_identity():
    try:
        async with engine.connect() as connection:
            return await connection.scalar(text(IDENTITY_SQL))
    finally:
        await engine.dispose()


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    destination = root / "backups" / datetime.now(timezone.utc).strftime("pre-independent-dates-%Y%m%dT%H%M%SZ")
    destination.mkdir(parents=True, exist_ok=False)
    url = make_url(settings.database_url)
    env = dict(os.environ)
    env.update(PGHOST=url.host or "localhost", PGPORT=str(url.port or 5432),
               PGUSER=url.username or "postgres", PGPASSWORD=url.password or "",
               PGDATABASE=url.database or "postgres", PGSSLMODE=settings.database_ssl_mode,
               PGCONNECT_TIMEOUT="20")
    if settings.database_ssl_root_cert_path:
        env["PGSSLROOTCERT"] = settings.database_ssl_root_cert_path
    maintenance = dotenv_values(root / "backend" / ".env.maintenance")
    required = ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD")
    if any(not maintenance.get(key) for key in required):
        raise RuntimeError("Maintenance file is missing required connection fields")
    env.update({key: maintenance[key] for key in required})
    psql = shutil.which("psql") or "C:/Program Files/PostgreSQL/17/bin/psql.exe"
    identity = subprocess.run([psql, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", IDENTITY_SQL],
                              env=env, capture_output=True, text=True, timeout=40)
    if identity.returncode:
        diagnostic = identity.stderr
        for secret in maintenance.values():
            if secret:
                diagnostic = diagnostic.replace(secret, "[redacted]")
        print(diagnostic[:1200])
        raise RuntimeError("Maintenance connection failed; credentials not displayed; no changes made")
    if identity.stdout.strip() != asyncio.run(runtime_identity()):
        raise RuntimeError("Maintenance database does not match runtime database; stopped")
    print("Maintenance connection verified against runtime database.", flush=True)
    dump = destination / "database.dump"
    for name, args in (
        ("pg_dump", ["--format=custom", "--file", str(dump)]),
        ("pg_restore", ["--list", str(dump)]),
        ("pg_restore", ["--file", os.devnull, str(dump)]),
    ):
        executable = shutil.which(name) or str(Path("C:/Program Files/PostgreSQL/17/bin") / f"{name}.exe")
        result = subprocess.run([executable, *args], env=env, capture_output=True, timeout=600)
        if result.returncode:
            message = result.stderr.decode("utf-8", errors="replace")
            for secret in (*maintenance.values(), url.password, url.host, url.username, url.database):
                if secret:
                    message = message.replace(secret, "[redacted]")
            print(message[:2000])
            raise RuntimeError(f"{name} failed (exit {result.returncode}); no migration executed")
    with dump.open("rb") as archive:
        digest = hashlib.file_digest(archive, "sha256").hexdigest()
    print(f"Backup verified (archive list and full decode): {dump}")
    print(f"Bytes: {dump.stat().st_size}; SHA256: {digest}")


if __name__ == "__main__":
    main()
