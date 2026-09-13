"""Compare restored application data to the configured source without exposing rows.

Only reads the source and an explicitly named, network-isolated Docker restore DB.
Compare public/auth/ops tables; Supabase-managed storage/realtime/vault are outside
this local restore rehearsal. Ignore ONLY M127's additive revision columns.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess

from dotenv import dotenv_values
from backup_configured_database import IDENTITY_SQL, runtime_identity, settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", required=True)
    parser.add_argument("--database", default="tpro_restore127")
    parser.add_argument("--strict-rows", action="store_true", help="Compare all columns, including M127 additions")
    args = parser.parse_args()
    info = json.loads(subprocess.check_output(
        ["docker", "inspect", args.container], text=True
    ))[0]
    if info["HostConfig"]["NetworkMode"] != "none" or info["HostConfig"].get("PortBindings"):
        raise RuntimeError("Restore database must have no network or published ports")
    env = dict(os.environ)
    values = dotenv_values(Path(__file__).resolve().parents[1] / ".env.maintenance")
    for key in ("PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD"):
        if not values.get(key):
            raise RuntimeError(f"Missing {key}")
        env[key] = values[key]
    env.update(PGSSLMODE=settings.database_ssl_mode, PGCONNECT_TIMEOUT="20")
    if settings.database_ssl_root_cert_path:
        env["PGSSLROOTCERT"] = settings.database_ssl_root_cert_path
    local_psql = shutil.which("psql") or "C:/Program Files/PostgreSQL/17/bin/psql.exe"

    def query(sql, *, restored=False):
        command = (["docker", "exec", "-i", args.container, "psql", "-U", "postgres",
                    "-d", args.database] if restored else [local_psql])
        command += ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"]
        wrapped = ("BEGIN READ ONLY; SET LOCAL statement_timeout='60s'; "
                   "SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; "
                   + sql + "; ROLLBACK;")
        result = subprocess.run(command, input=wrapped, env=env, capture_output=True,
                                text=True, timeout=90)
        if result.returncode:
            raise RuntimeError("Read-only comparison failed; database diagnostics suppressed")
        return result.stdout.strip()

    if query(IDENTITY_SQL) != asyncio.run(runtime_identity()):
        raise RuntimeError("Maintenance database does not match runtime")
    tables = json.loads(query("""
      select json_agg(json_build_array(n.nspname, c.relname) order by n.nspname, c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','ops') and c.relkind in ('r','p')
    """))
    queries = []
    for schema, table in tables:
        relation = '.'.join('"' + name.replace('"', '""') + '"' for name in (schema, table))
        row = "to_jsonb(t)"
        if not args.strict_rows and (schema, table) == ("public", "billing_anchor_revisions"):
            row += "-'scheduled_segments'-'waived_intervals'"
        queries.append(
            f"select {len(queries)} as ordinal, count(*) as rows, "
            f"md5(coalesce(string_agg(digest, '' order by digest), '')) as checksum "
            f"from (select md5(({row})::text) as digest from {relation} t) s"
        )
    sql = "select json_agg(x order by ordinal) from (" + " union all ".join(queries) + ") x"
    source = json.loads(query(sql))
    restored = json.loads(query(sql, restored=True))
    if source != restored:
        mismatches = sum(left != right for left, right in zip(source, restored))
        raise RuntimeError(f"Source/restore differ in {mismatches} tables; stop before activation")
    print(json.dumps({"match": True, "tables": len(tables),
                      "scope": "public/auth/ops; count and complete row checksums",
                      "ignored": "none" if args.strict_rows else "only M127 additive revision columns"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Never expose subprocess arguments, credentials or database row values.
        print(f"Restore comparison stopped ({type(exc).__name__}); no source changes made.")
        raise SystemExit(1) from None
