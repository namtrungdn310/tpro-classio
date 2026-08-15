# TPRO Classio — Round 7 closeout contract

> Cập nhật bằng kiểm chứng trực tiếp ngày 15/08/2026. Dấu `[x]` chỉ được dùng khi có bằng chứng chạy trên
> working tree hiện tại. Trạng thái chi tiết và lệnh kiểm chứng nằm trong `REPORT_DOMAIN_R7.md`.

## A. Code và nghiệp vụ đã hoàn tất

- [x] Toàn bộ route runtime dùng typed `Principal`; route quản trị deny-by-default cho teacher.
- [x] OpenAPI policy manifest phủ toàn bộ method/path và có regression test.
- [x] `/auth/me`, frontend session và navigation nhận `dev|admin|teacher`; viewer runtime bị fail-closed.
- [x] Invite teacher buộc liên kết một hồ sơ nhân sự active; link/consume invitation nằm trong transaction.
- [x] Teacher chỉ dùng attendance shell và không mount management shell.
- [x] Fee cycle dùng identity `(enrollment_id, cycle_no)`; nhiều kỳ trong cùng tháng được hỗ trợ.
- [x] Enrollment tạo cycle 0 ngay ngày vào lớp ở trạng thái chưa báo/chưa nộp.
- [x] Fee record không bị hard-delete trong các workflow nghiệp vụ; correction dùng projection/ledger có audit.
- [x] End-date preview/commit dùng chung domain classifier và class start bất biến.
- [x] Hồ sơ học viên có thể tồn tại không lớp; archive/restore là hành động tường minh.
- [x] ALL/SELECTED weekly slots, schedule remap và lịch sử selection có contract/test.
- [x] Whole-class suspension dời adjusted due; occurrence makeup không đổi học phí hoặc class end date.
- [x] Student code DB-generated, immutable, unique, Luhn-valid và được dùng trong search/export/reference.
- [x] Copy class chỉ sao chép cấu hình editable, không sao chép enrollment/tài chính/lịch sử.
- [x] Attendance tạo EARNING đúng occurrence/rate và idempotent.
- [x] Payroll rate half-open, settlement và settlement reversal là append-only, concurrency-safe.
- [x] Payment provider scaffold fail-closed, tắt mặc định và chưa có Pay2S ingress công khai.
- [x] Fee transaction/refund history được tải lazy, không chặn first usable render.
- [x] Readiness fail-closed nếu database kết nối được nhưng thiếu schema marker `054–073`.

## B. Gate tự động trên working tree hiện tại

- [x] Backend Ruff check và format-check: sạch.
- [x] Backend full disposable/unit/integration suite sau closeout: 528 passed, 0 failed.
- [x] Bandit: 0 issue sau khi readiness SQL chuyển sang bind parameter.
- [x] pip-audit: không có vulnerability đã biết.
- [x] Disposable PostgreSQL: migrations `001–073`, verify security, runtime grants, integration/concurrency và cleanup xanh.
- [x] Frontend type-check, ESLint và 461 unit tests: xanh.
- [x] npm audit high: 0 vulnerability.
- [x] Next.js production build: xanh.
- [x] Chromium production-path E2E: 46/46 passed.
- [x] Firefox production-path E2E: 45 passed; một synthetic `pointercancel` skip có chủ đích và có Chromium proof.
- [x] `git diff --check`: sạch.
- [x] Historical migrations được giữ; báo cáo Round 6 dư thừa và tài liệu role legacy đã được dọn.

## C. Blocker bắt buộc trước khi test localhost có ghi dữ liệu

- [x] Tạo `pg_dump -Fc` Supabase thật bằng database owner.
- [x] Kiểm tra backup bằng `pg_restore --list` và lưu manifest.
- [x] Chạy migration còn thiếu trong maintenance window; baseline drift được fail-fast và phục hồi an toàn theo thứ tự `046 → 053 → 054 → 055 → 056–073`.
- [x] Chạy `verify_security.sql` và acceptance/read-only schema probe trên Supabase thật.
- [x] Rebuild/start Docker; backend `/health/ready` và frontend trả HTTP 200.
- [ ] Chạy manual localhost smoke theo `test.md` và người dùng xác nhận nghiệp vụ chính.

Không được tick các mục trên bằng database runtime role. Cần `SUPABASE_DB_OWNER_PASSWORD` trong
`backend/.env` (file đã bị gitignore); không in password/DSN vào log hay report.

## D. Gate staging/production còn chủ đích để mở

- [ ] Cursor/bounded pagination production-grade cho classes, fees và payroll; student/report đã có contract.
- [ ] Load test staging với dataset mục tiêu và evidence p95/query-count/payload cho endpoints thông dụng.
- [ ] Visual/accessibility smoke ở các viewport quản trị và teacher mobile trên trình duyệt thật.
- [ ] Backup restore rehearsal, RTO/RPO và deployment rollback rehearsal trên staging.
- [ ] Chọn flow Pay2S (raw webhook hoặc Collection Link/IPN), sandbox và threat-model review trước khi bật.

Các mục D không ngăn kiểm thử localhost, nhưng bắt buộc trước production.

## E. Điều kiện bàn giao Round 7 localhost

Round 7 code, database thật và Docker đã hoàn tất. Bàn giao localhost chỉ còn manual smoke do người dùng
thực hiện ở mục C; các gate staging/production trong mục D vẫn chủ đích để mở. Không commit/push hoặc bật
dịch vụ third-party live trong bước closeout này.
