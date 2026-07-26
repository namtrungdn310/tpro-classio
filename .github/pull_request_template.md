## Phạm vi

Mô tả ngắn gọn thay đổi và lý do.

## Kiểm tra

- [ ] Thay đổi chỉ giải quyết một feature/module hoặc một nhóm sửa lỗi liên quan.
- [ ] Không có secret, file `.env`, dữ liệu thật, backup hay log nhạy cảm.
- [ ] Frontend: type-check, lint, test và build đã qua (nếu có thay đổi).
- [ ] Backend: Ruff và Pytest đã qua (nếu có thay đổi).
- [ ] Migration đã được thử trên database sạch và có phương án backup/rollback (nếu có).
- [ ] Docker image đã build thành công (nếu thay đổi runtime/dependency).
- [ ] README/env example đã được cập nhật khi hợp đồng cấu hình thay đổi.

## Rủi ro và rollback

Nêu ảnh hưởng tới dữ liệu, bảo mật, tương thích và cách quay lại phiên bản trước.
