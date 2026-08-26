-- Group drafts introduced by 108 are now canonical. Remove the duplicated
-- per-fee-record columns only after proving every populated legacy group moved.
begin;

do $$
begin
  if exists (
    select 1
    from public.fee_records fee
    join public.enrollments enrollment on enrollment.id = fee.enrollment_id
    cross join lateral (
      values
        ('reminder'::text, fee.reminder_message_draft),
        ('received'::text, fee.received_message_draft)
    ) as legacy(kind, message)
    where legacy.message is not null
      and btrim(legacy.message) <> ''
      and not exists (
        select 1 from public.fee_message_drafts draft
        where draft.workspace_id = fee.workspace_id
          and draft.student_id = enrollment.student_id
          and draft.period = fee.period
          and draft.kind = legacy.kind
          and draft.message = legacy.message
      )
  ) then
    raise exception '109 blocked: a legacy Zalo draft was not migrated';
  end if;
end $$;

alter table public.fee_records
  drop column if exists reminder_message_draft,
  drop column if exists received_message_draft;

commit;
