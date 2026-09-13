-- Cleanup negative fixture 051 (chạy sau khi 051 đã abort; xóa class lỗi).
-- Trigger classes_block_hard_delete (042) chặn DELETE classes — tạm tháo rồi
-- tạo lại trong cùng transaction (chỉ áp dụng cho fixture disposable).
drop trigger if exists classes_block_hard_delete on public.classes;

delete from public.class_teachers
 where class_id::text like '30000000-0000-0000-0000-0000000000%';
delete from public.classes
 where id::text like '30000000-0000-0000-0000-0000000000%';

create trigger classes_block_hard_delete
before delete on public.classes
for each row execute function public.block_class_hard_delete();
