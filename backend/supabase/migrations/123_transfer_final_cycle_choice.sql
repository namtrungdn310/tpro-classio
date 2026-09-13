-- Persist the administrator's source final-cycle choice for membership transfers.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.student_membership_commands
  add column if not exists collect_source_final_cycle boolean not null default true;

comment on column public.student_membership_commands.collect_source_final_cycle is
  'True keeps/materialises the source cycle containing the final active day; false waives only mutable unnotified source fees.';

commit;
