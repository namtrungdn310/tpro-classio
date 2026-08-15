-- R6-D02 rollback-prep: remove acceptance probe rows (they violate the old
-- exact-division rule) so the compatibility rollback can run. Disposable-only.
\set ON_ERROR_STOP on

drop trigger if exists classes_block_hard_delete on public.classes;

delete from public.class_teachers
 where class_id in (
   '30000000-0000-0000-0000-000000000054',
   '30000000-0000-0000-0000-0000000000b2'
 );
delete from public.classes
 where id in (
   '30000000-0000-0000-0000-000000000054',
   '30000000-0000-0000-0000-0000000000b2'
 );

create trigger classes_block_hard_delete
before delete on public.classes
for each row execute function public.block_class_hard_delete();
