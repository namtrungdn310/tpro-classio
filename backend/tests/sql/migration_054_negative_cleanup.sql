-- R6-D02 negative cleanup: remove rows created by negative fixtures.
-- classes_block_hard_delete (042) blocks DELETE — temporarily removed and
-- recreated in the same transaction (disposable fixture only).
\set ON_ERROR_STOP on

drop trigger if exists classes_block_hard_delete on public.classes;

delete from public.class_teachers
 where class_id in (
   '20000000-0000-0000-0000-000000000056',
   '30000000-0000-0000-0000-0000000000b1',
   '30000000-0000-0000-0000-0000000000b2',
   '30000000-0000-0000-0000-000000000054'
 );
delete from public.classes
 where id in (
   '20000000-0000-0000-0000-000000000056',
   '30000000-0000-0000-0000-0000000000b1',
   '30000000-0000-0000-0000-0000000000b2',
   '30000000-0000-0000-0000-000000000054'
 );

create trigger classes_block_hard_delete
before delete on public.classes
for each row execute function public.block_class_hard_delete();
