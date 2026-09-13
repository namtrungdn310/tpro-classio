"""Read-only preflight for the Zalo fee-message editor migration.

The report intentionally prints hashes and aggregate counts only. It never
prints message bodies, student names, credentials, or other tenant data.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Mapping

from sqlalchemy import text

from app.core.database import engine
from app.core.fee_messages import (
    DEFAULT_FEE_RECEIPT_TEMPLATE,
    DEFAULT_FEE_REMINDER_TEMPLATE,
)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def _fetch_mapping(statement: str) -> list[Mapping[str, object]]:
    async with engine.connect() as connection:
        result = await connection.execute(text(statement))
        return list(result.mappings())


async def main() -> None:
    metadata = await _fetch_mapping(
        """
        select
          current_user as database_role,
          to_regclass('public.fee_message_templates') is not null as has_templates,
          to_regclass('public.fee_records') is not null as has_fee_records,
          to_regclass('public.fee_message_drafts') is not null as has_group_drafts,
          to_regclass('supabase_migrations.schema_migrations') is not null
            as has_migration_history
        """
    )
    print("DATABASE", dict(metadata[0]))

    migration_rows = await _fetch_mapping(
        """
        select version
          from supabase_migrations.schema_migrations
         where version in ('105', '106', '107')
         order by version
        """
        if metadata[0]["has_migration_history"]
        else "select null::text as version where false"
    )
    print("MIGRATION_HISTORY", [row["version"] for row in migration_rows])

    column_rows = await _fetch_mapping(
        """
        select column_name
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'fee_records'
           and column_name in (
             'reminder_message_draft', 'received_message_draft'
           )
         order by column_name
        """
    )
    print("LEGACY_DRAFT_COLUMNS", [row["column_name"] for row in column_rows])

    template_rows = await _fetch_mapping(
        """
        select
          template.workspace_id::text as workspace_id,
          template.version,
          template.updated_by is null as system_actor,
          template.payment_reminder_template,
          template.payment_received_template,
          count(operation.id) filter (
            where operation.action = 'template_update'
          ) as template_update_count
        from public.fee_message_templates template
        left join public.fee_operations operation
          on operation.workspace_id = template.workspace_id
         and operation.action = 'template_update'
        group by template.workspace_id, template.version, template.updated_by,
                 template.payment_reminder_template,
                 template.payment_received_template
        order by template.workspace_id
        """
    )
    current_default_hashes = {
        _digest(DEFAULT_FEE_REMINDER_TEMPLATE),
        _digest(DEFAULT_FEE_RECEIPT_TEMPLATE),
    }
    sanitized_templates = [
        {
            "workspace_id": row["workspace_id"],
            "version": row["version"],
            "system_actor": row["system_actor"],
            "template_update_count": row["template_update_count"],
            "reminder_sha256": _digest(str(row["payment_reminder_template"])),
            "receipt_sha256": _digest(str(row["payment_received_template"])),
            "matches_current_backend_default": {
                _digest(str(row["payment_reminder_template"])),
                _digest(str(row["payment_received_template"])),
            }
            == current_default_hashes,
        }
        for row in template_rows
    ]
    print("TEMPLATES", sanitized_templates)

    draft_rows = await _fetch_mapping(
        """
        with grouped as (
          select
            fee.workspace_id,
            enrollment.student_id,
            fee.period,
            fee.status,
            count(*) as record_count,
            count(distinct fee.reminder_message_draft)
              filter (where fee.reminder_message_draft is not null)
              as reminder_versions,
            count(*) filter (where fee.reminder_message_draft is not null)
              as reminder_rows,
            count(distinct fee.received_message_draft)
              filter (where fee.received_message_draft is not null)
              as received_versions,
            count(*) filter (where fee.received_message_draft is not null)
              as received_rows
          from public.fee_records fee
          join public.enrollments enrollment on enrollment.id = fee.enrollment_id
          where fee.status in ('UNPAID', 'PAID')
          group by fee.workspace_id, enrollment.student_id, fee.period, fee.status
        )
        select
          count(*) filter (
            where reminder_versions > 1 or received_versions > 1
          ) as mismatched_groups,
          count(*) filter (
            where (reminder_rows > 0 and reminder_rows < record_count)
               or (received_rows > 0 and received_rows < record_count)
          ) as partial_groups,
          count(*) filter (
            where reminder_rows > 0 or received_rows > 0
          ) as groups_with_drafts
        from grouped
        """
    )
    print("LEGACY_DRAFTS", dict(draft_rows[0]))

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
