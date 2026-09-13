"""Read-only diagnosis of legacy backup FKs; never print row identifiers."""
import os
from pathlib import Path
import subprocess
import sys
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings


def main():
    values = dotenv_values(Path(__file__).resolve().parents[1] / ".env.maintenance")
    env = dict(os.environ)
    env.update({k: values[k] for k in ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE")})
    env.update(PGSSLMODE=settings.database_ssl_mode, PGCONNECT_TIMEOUT="20")
    if settings.database_ssl_root_cert_path:
        env["PGSSLROOTCERT"] = settings.database_ssl_root_cert_path
    sql = """
    BEGIN READ ONLY;
    SET LOCAL statement_timeout = '15s';
    SELECT json_build_object(
      'classes', (select count(*) from public.classes),
      'legacy_backup_rows', (select count(*) from public._migration_051_class_schedule_backup),
      'legacy_backup_orphans', (select count(*) from public._migration_051_class_schedule_backup b
        where not exists (select 1 from public.classes c where c.id=b.class_id)),
      'constraint_validated', (select convalidated from pg_constraint where conname='_migration_051_class_schedule_backup_class_id_fkey'),
      'role_bypasses_rls', (select rolbypassrls from pg_roles where rolname=current_user)
    );
    ROLLBACK;
    """
    result = subprocess.run(["C:/Program Files/PostgreSQL/17/bin/psql.exe", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                            env=env, capture_output=True, text=True, timeout=40)
    if result.returncode:
        print("Read-only backup diagnosis failed; no data modified.")
        raise SystemExit(1)
    print(result.stdout.strip())


if __name__ == "__main__":
    main()
