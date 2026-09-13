# TPRO Classio — Round 7 closeout contract

> Cập nhật bằng kiểm chứng trực tiếp ngày 15/08/2026. Dấu `[x]` chỉ được dùng khi có bằng chứng chạy trên
> working tree hiện tại. Trạng thái chi tiết và lệnh kiểm chứng nằm trong `REPORT_DOMAIN_R7.md`.

> **Cập nhật closeout hiện tại:** migrations `075_early_payment_requests.sql`, `076_slot_teacher_assignment_history.sql`
> và `077_staff_earning_rate_integrity.sql` bổ sung snapshot/idempotency thanh toán sớm, lịch sử phân công
> giáo viên theo buổi và bất biến tiền công theo rate cá nhân; migration `074_suspension_window_invariants.sql` và guard
> hoãn ghi danh đã được kiểm chứng trên PostgreSQL disposable. Ngày 17/08/2026, backup Supabase thật,
> migrations 075–077 và `verify_security.sql` đã chạy thành công; manual smoke vẫn là gate riêng.

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
- [x] Cửa sổ hoãn là nửa mở, tối đa 120 ngày; không cho ghi danh trong cửa sổ OPEN và có trigger DB chống ghi trực tiếp.
- [x] Kỳ học phí tương lai bị ẩn trong danh sách thường; luồng thanh toán sớm riêng chỉ mở trong cửa sổ giới hạn, không tự báo/không tự ghi nhận QR và Pay2S vẫn tắt.
- [x] Student code DB-generated, immutable, unique, Luhn-valid và được dùng trong search/export/reference.
- [x] Copy class chỉ sao chép cấu hình editable, không sao chép enrollment/tài chính/lịch sử.
- [x] Attendance tạo EARNING đúng occurrence/rate và idempotent; nhiều giáo viên cùng một buổi tạo một
  EARNING riêng cho từng người với đủ rate cá nhân, không chia tiền và không phụ thuộc lớp.
- [x] Phân công giáo viên theo từng slot là explicit, lịch sử 076 append-only; trigger 077 đối chiếu staff và
  amount với rate snapshot của attendance.
- [x] Payroll rate half-open, settlement và settlement reversal là append-only, concurrency-safe.
- [x] Payment provider scaffold fail-closed, tắt mặc định và chưa có Pay2S ingress công khai.
- [x] Fee transaction/refund history được tải lazy, không chặn first usable render.
- [x] Readiness fail-closed nếu database kết nối được nhưng thiếu schema marker `054–077` hoặc thiếu trigger bảo vệ
  cửa sổ hoãn, phân công giáo viên theo buổi hoặc payroll rate snapshot.

## B. Gate tự động trên working tree hiện tại

- [x] Backend Ruff check và format-check: sạch.
- [x] Backend full unit suite 471 passed, 59 skipped; disposable integration/concurrency pipeline sau
  migration 077 đã chạy xanh và container cleanup thành công (không dùng số baseline cũ làm bằng chứng).
- [x] Bandit: 0 issue sau khi readiness SQL chuyển sang bind parameter.
- [x] pip-audit: không có vulnerability đã biết.
- [x] Disposable PostgreSQL: migrations `001–077`, verify security, runtime grants, integration/concurrency và cleanup xanh.
- [x] Frontend type-check, ESLint và 490 unit tests: xanh.
- [x] npm audit high: 0 vulnerability.
- [x] Next.js production build: xanh.
- [x] Chromium production-path E2E: 45/45 passed (current class-centric suite).
- [x] Firefox production-path E2E: 44 passed; một synthetic `pointercancel` skip có chủ đích và có Chromium proof.
- [x] `git diff --check`: sạch.
- [x] Historical migrations được giữ; báo cáo Round 6 dư thừa và tài liệu role legacy đã được dọn.

## C. Blocker bắt buộc trước khi test localhost có ghi dữ liệu

- [x] Tạo `pg_dump -Fc` Supabase thật bằng database owner trước khi chạy 075–077.
- [x] Kiểm tra backup bằng `pg_restore --list` (archive `tpro-classio-before-075-077-20260817-013445.dump`, 1.189 TOC entries).
- [x] Chạy migrations 075–077 trong maintenance window bằng database owner với `ON_ERROR_STOP=1`.
- [x] Chạy `verify_security.sql` và acceptance/read-only schema probe trên Supabase thật, bao gồm trigger chặn ghi danh trong cửa sổ hoãn.
- [x] Rebuild/start Docker sau thay đổi thanh toán sớm; backend `/health/ready` và frontend trả HTTP 200.
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

Code, disposable database, Supabase thật và Docker đã đạt gate. Manual localhost smoke vẫn là mục mở;
không đánh dấu nghiệp vụ hoàn tất chỉ dựa trên migration/security gate. Không commit/push hoặc bật dịch vụ
third-party live trong bước closeout này.

## F. R8 — tiêu chí bàn giao bộ chọn lịch lớp

- [x] Bộ chọn lịch giữ bố cục bảng cũ (lưới trái + “Danh sách chi tiết” bên phải), không tab/phạm vi giáo viên trong lưới và không khóa ô trống theo pool giáo viên.
- [x] Tất cả lớp khác đang có lịch là vùng busy không thể hover/click/drag/keyboard vào; draft lớp hiện tại vẫn chỉnh được.
- [x] Giáo viên được phân công riêng trực tiếp trong từng thẻ của “Danh sách chi tiết”, hỗ trợ nhiều giáo viên cùng một buổi và giữ kiểm tra xung đột tại buổi đó.
- [x] Các quy tắc paint/erase 60 phút, tối đa 4 buổi, focus, aria, loading, dirty-close và backend save contract hiện tại vẫn xanh.
- [x] Unit + E2E Chromium/Firefox chứng minh các invariant trên; không có migration schema
      hoặc thay đổi payload lưu lịch ngoài scope availability tường minh.
- [x] Availability contract có scope `all_classes` cho bộ chọn lớp và `selected_staff` cho
      tooling cũ; test chứng minh lớp khác luôn bị khóa kể cả khi chưa có teacher pool,
      không rò PII và không mở quyền cho browser role.

## G. R8 — performance gate (một phần đã chứng minh trên disposable, chưa promote)

Trạng thái: runner + scale fixture + 078 (concurrent) + EXPLAIN before/after + verify 078 +
Phase 8 Playwright + Phase 9 pytest đã chạy xanh trên **PostgreSQL disposable thật**.
Migration 078 **chưa** chạy trên Supabase thật — đó là gate còn mở cuối cùng.

- [x] Disposable runner (Python + PS1) chạy đủ `001..077 → scale dataset → EXPLAIN before → 078 → EXPLAIN after → verify 078 → idempotency → verify_security` (đã validate trên postgres:17-alpine).
- [x] Scale fixture `perf_scale_dataset.sql` đạt đúng quy mô (1.000 lớp / 5.000 học viên / 74.394 fee_records / 200 nhân sự) và `perf_scale_assert.sql` xanh (đếm theo prefix cô lập fixture).
- [x] `verify_migration_078.sql` xanh: hai index tồn tại, đúng column/order/predicate, `indisvalid`+`indisready` true, không index invalid sót, chuyển UNPAID→PAID cập nhật partial index.
- [x] EXPLAIN before/after 078 thu được: fee UNPAID projection 3.16ms → 2.17ms + Index Only Scan trên `ix_fee_records_unpaid_enrollment`; class scope đã có index 042 phục vụ (0.2ms) — ghi trung thực.
- [x] `verify_security.sql` xanh sau 078 (RLS/grants/default privileges không đổi).
- [x] Migration 078 idempotent (chạy lần hai no-op) + chuyển sang `CREATE INDEX CONCURRENTLY` (đã validate).
- [x] Phase 8 Playwright perf gate `npm run test:e2e:perf`: 5/5 xanh (không request trùng, pending button ≤100ms/không layout jump, first usable prompt, mutation click trùng 1 request).
- [x] Phase 9 pytest perf gate `pytest tests/integration -m performance`: 12/12 xanh trên scale (query-count + concurrency 10/20/50 không race/duplicate/pool timeout).
- [x] Backend N+1: `get_classes` 23→10 SQL, `get_class_response` 14→9, `get_class_history` 16→11 (suppress Class eager-load bằng `noload`).
- [ ] Quyết định virtualization rõ ràng trên dataset thật (chưa vượt ngưỡng → mặc định “không cần”; cần ghi artifact).
- [ ] Quyết định preview hoãn rõ ràng (“giữ song song” mặc định; chưa đo combined candidate).
- [ ] **078 promote Supabase thật** theo runbook `backend/scripts/promote_078_supabase.ps1` (backup → migration owner → verify → smoke → theo dõi log chậm) — chưa làm, cần operator + maintenance window.
- [ ] Không còn checkbox bắt buộc P2/P3 mở trong kế hoạch hiệu năng.
