# TPRO Classio — Round 7 verification checklist

> Checklist này là nguồn sự thật cho kiểm thử Round 7. Không tick bằng tuyên bố trong báo cáo; chỉ tick bằng
> command/test/manual evidence trên đúng working tree và đúng môi trường.

> **Current code gate:** disposable runner đã bao gồm migrations `075_early_payment_requests.sql`,
> `076_slot_teacher_assignment_history.sql` và `077_staff_earning_rate_integrity.sql`.
> Các mục Supabase thật bên dưới chỉ được tick sau khi chạy backup → 075 → 076 → 077 → verify trên đúng project.

## 1. Static, unit và supply-chain

- [x] `python -m ruff check .`
- [x] `python -m ruff format --check .`
- [x] Backend full unit suite — 471 passed, 59 skipped; disposable integration/concurrency pipeline
      sau 077: tất cả scenarios passed và container cleanup thành công.
- [x] `python -m bandit -q -r app` — 0 finding.
- [x] `python -m pip_audit -r requirements.txt` — 0 known vulnerability.
- [x] `npm run type-check`
- [x] `npm run lint`
- [x] `npm test` — 490 passed (serialized runner; avoids resource pressure on Windows).
- [x] `npm audit --audit-level=high` — 0 vulnerability.
- [x] `npm run build`
- [x] `git diff --check`

## 2. Database, migration và security disposable

- [x] Full migration chain `001–077` chạy trên PostgreSQL disposable.
- [x] Forward migration preflight/acceptance/negative scenarios đạt.
- [x] `verify_security.sql` rerunnable trong disposable pipeline.
- [x] RLS FORCE/revoke browser role và runtime grants được kiểm tra.
- [x] Integration/concurrency suite đạt trong disposable runner.
- [x] Readiness trả fail-closed khi thiếu schema và ready sau full schema.
- [x] Runner cleanup container kể cả khi kết thúc pipeline.

## 3. Domain regression đã được chứng minh tự động

- [x] Typed Principal, route-policy coverage và teacher deny management APIs.
- [x] Viewer legacy fail-closed; dev/admin/teacher auth contract.
- [x] Teacher invite/staff link/onboarding atomicity và session revocation.
- [x] Enrollment arbitrary date + atomic cycle 0.
- [x] Monthly EOM/leap và package 1/2/3 tuần có nhiều cycle cùng month.
- [x] Fee ledger/projection append-only; VOID/SUPERSEDED thay hard-delete.
- [x] Class end-date preview/commit classifier và stale fingerprint protection.
- [x] Suspension overlap, cumulative credit, reversal và protected-cycle behavior.
- [x] Suspension window tối đa 120 ngày, enrollment bị chặn ở service và trigger DB; readiness kiểm tra đủ trigger 074.
- [x] Fee list mặc định chỉ hiện khoản đã đến hạn (và các khoản đã thu sớm để audit); luồng early-payment riêng giới hạn cửa sổ, khóa thứ tự kỳ, idempotent và không tự đánh dấu đã báo.
- [x] Occurrence makeup không dời kỳ thu hoặc class end date.
- [x] Student profile zero-enrollment, archive/restore, code và slot selections.
- [x] Copy class tạo zero copied enrollment/finance/history.
- [x] Attendance occurrence/rate/idempotency và BOLA protection.
- [x] Một slot có nhiều giáo viên: mỗi giáo viên chấm công độc lập và nhận đủ rate cá nhân hiệu lực;
      không chia theo số người, không có rate theo lớp; trigger 077 chặn amount/staff snapshot sai.
- [x] Thay đổi giáo viên theo từng slot có lịch sử append-only 076 và không làm lẫn trợ giảng.
- [x] Payroll rate, earning, settlement concurrency và settlement reversal.
- [x] Payment request provider-neutral chỉ bật bằng feature flag; mã mở/thu hồi có audit, browser role không đọc được và chưa tự nhận tiền Pay2S.
- [x] Thanh toán sớm: request idempotent bằng `request_id`, mã tham chiếu không chứa PII, cửa sổ giới hạn, không bỏ qua kỳ cũ; tiền mặt sớm cần xác nhận và ghi `payment_origin=manual_early`.
- [x] Mã OPEN hết hạn được chuyển EXPIRED trước khi tạo request mới; request bị hoãn đổi hạn hoặc đã thu tiền được REVOKED, không xoá snapshot/event.
- [x] Export formula-injection protection và bounded sensitive responses.

## 4. Browser production-path

- [x] Chromium: 45/45 schedule production-path E2E passed.
- [x] Firefox: 44 passed, 1 synthetic `pointercancel` skip có chủ đích.
- [x] Firefox synthetic pointer-cancel skip được ghi rõ; cùng branch có Chromium proof.
- [x] Schedule endpoint/click/drag/reverse/availability/error/retry/save payload.
- [x] Class workspace, unsaved changes, modal Escape/backdrop/focus behavior.
- [x] Makeup workspace và production-path command payload.
- [x] Fee package helper, keyboard Tab/caret và inline feedback position.

## 5. Supabase thật — migrations 075–077 đã chạy và đã verify

Các mục dưới đây có bằng chứng thực tế trên project Supabase đang dùng tại ngày 17/08/2026.
Backup custom-format được tạo trước migration, sau đó chạy 075 → 076 → 077 bằng database owner
và chạy `verify_security.sql` với `ON_ERROR_STOP=1`.

- [x] Xác nhận `backend/.env` có owner password riêng, không dùng runtime-role password.
- [x] Dừng backend/frontend trong maintenance window.
- [x] Tạo backup `pg_dump -Fc`; `pg_restore --list` đọc được 847 entry.
- [x] Read-only preflight xác nhận baseline; phát hiện 046 backfill chưa hoàn chỉnh và 053 còn thiếu.
- [x] Fail-fast ở 056 không làm mất dữ liệu; phục hồi theo migration lịch sử `046 → 053 → 054`, rồi chạy `055 → 073` với `ON_ERROR_STOP=1`.
- [x] Chạy `backend/tests/sql/verify_security.sql` thành công trên Supabase thật.
- [x] Acceptance/schema probe đạt: đủ 7 relation marker, 0 active viewer, 0 fee cycle thiếu `cycle_no`, browser role không đọc ledger mới.
- [x] Owner password/DSN/PII không được ghi vào migration, verify hoặc report version-controlled.
- [x] Backup mới bao phủ schema trước 075 và kiểm tra `pg_restore --list`.
      Backup: `backups/tpro-classio-before-075-077-20260817-013445.dump`; archive có 1.189 TOC entries.
- [x] Chạy `075_early_payment_requests.sql`, `076_slot_teacher_assignment_history.sql` và
      `077_staff_earning_rate_integrity.sql` bằng database owner; không dùng runtime role.
- [x] Chạy `verify_security.sql`/acceptance sau 077: request item snapshot append-only, lịch sử phân công
      theo slot và trigger EARNING theo rate cá nhân; browser role bị từ chối, request_id/provider
      transaction unique và payment origin hợp lệ.

## 6. Docker và HTTP sau migrations 075–077

Các mục dưới đây phải chạy lại sau khi database local/Supabase đã có đủ marker đến 077;
log Docker cũ trước 077 không đủ làm bằng chứng cho vòng hiện tại.

- [x] `docker compose up -d --build backend frontend`
- [x] Cả hai service healthy.
- [x] `http://127.0.0.1:8000/health/ready` trả 200 (`{"status":"ready","app":"TPRO Classio API"}`).
- [x] `http://127.0.0.1:3000` trả 200.
- [x] Startup logs không có schema error, traceback, 500 loop hoặc secret/PII.

## 7. Manual localhost smoke — người dùng xác nhận

- [ ] Dev đăng nhập AAL2; tên/avatar/role đúng.
- [ ] Tạo profile không lớp; mã học viên hiện; search code compact/formatted hoạt động.
- [ ] Ghi danh ngày hợp lệ; cycle 0 xuất hiện ngay ở Chưa báo.
- [ ] Gói 1 tuần tạo nhiều kỳ trong cùng tháng không mất/duplicate.
- [ ] Hoãn toàn lớp 10 ngày dời adjusted due; bù một buổi không đổi due/end date.
- [ ] Sửa class end hiển thị impact đúng; paid record đi vào review.
- [ ] Copy class không sao chép học viên/tài chính/lịch sử.
- [ ] Invite teacher; teacher chỉ thấy `/attendance` và không thấy management data.
- [ ] Admin đặt rate, teacher check-in, admin settle/reversal; balance/history đúng.
- [ ] Logout/role change clear cache; không flash dữ liệu trái quyền.

## 8. Staging gates — thực hiện sau localhost

- [ ] Cursor pagination cho classes/fees/payroll và test dataset lớn.
- [ ] Staging load test + p95/query-count/payload evidence.
- [ ] Viewport/accessibility/keyboard/reduced-motion smoke trên browser thật.
- [ ] Backup restore và rollback rehearsal.
- [ ] HTTPS/auth/SMTP/Google/TOTP flow staging smoke.
- [ ] Pay2S giữ tắt đến khi flow/sandbox/secret rotation/webhook security được duyệt.

## 9. R8 — kiểm thử bộ chọn lịch lớp tách phân công

- [x] Mở thêm/chỉnh lớp giữ bố cục bảng cũ: lưới bên trái và panel phải tiêu đề “Danh sách chi tiết”, không có tab Tổng quan/tên giáo viên hay màn hình “Phân công buổi”.
- [x] Ô trống vẫn click/drag theo đúng contract 60 phút; click một ô chỉ tạo mốc chờ; kéo xuôi/ngược và xoá đầu/cuối không thay đổi.
- [x] Một slot của lớp khác phủ lên lưới: mọi cell 30 phút giao với slot có `data-schedule-state="busy"`, `aria-disabled="true"`, cursor không cho phép, title/aria-label nói rõ “Khung giờ đã có lớp khác”.
- [x] Pointerdown, click, Enter/Space và drag bắt đầu trên busy cell không tạo anchor, không đổi draft, không gọi `onSave`; keyboard navigation bỏ qua busy cell.
- [x] Draft của lớp đang chỉnh sửa vẫn có thể thu/ngắn/xoá; overlay draft không bị xem nhầm là lớp khác.
- [x] Có một hoặc nhiều giáo viên rảnh/bận không làm thay đổi khả năng tô ô trống; không xuất hiện thông báo “đang xếp cho giáo viên…” trong header lưới.
- [x] Mỗi thẻ trong “Danh sách chi tiết” cho phép chọn/bỏ từng giáo viên; xung đột chỉ hiển thị ở thẻ tương ứng và không làm khoá toàn bộ lưới.
- [x] Không có horizontal page scroll; focus-visible/reduced-motion/aria regression pass ở Chromium và Firefox.
- [x] API `scope=all_classes` cho phép payload không có staff ID, loại lớp đang chỉnh sửa/
      đã kết thúc/hủy và trả block của lớp khác; `scope=selected_staff` vẫn yêu cầu staff
      hợp lệ và giữ kết quả cũ. Browser không được gọi trực tiếp route này ngoài management.

## 10. R8 — performance gate (đã chứng minh trên disposable; promote Supabase còn mở)

- [x] Disposable runner chạy migration 078 (concurrent) sau 077 + acceptance probe + kiểm tra `indisvalid`/`indisready` true + chạy lại lần hai để kiểm tra idempotency.
- [x] `verify_security.sql` chạy sau 078; RLS/grants/default privileges không đổi.
- [x] Scale fixture `perf_scale_dataset.sql` đạt 1.000 lớp (650 active / 100 scheduled / 150 completed / 100 cancelled, ≥70% canonical non-LEGACY + LEGACY slice), 5.000 học viên, 200 nhân sự (150 GV / 50 trợ giảng), ≥50.000 fee_records (74.394, đủ trạng thái + payments ledger khớp); seed không tắt trigger/RLS.
- [x] `perf_explain_078.sql` chạy before/after: class scope + fee UNPAID projection (10/100/500/1.000 enrollment) + availability; ghi execution time + plan node + index dùng (fee: 3.16→2.17ms + Index Only Scan; class scope: index 042).
- [x] `verify_migration_078.sql` xanh (tồn tại, đúng column/order/predicate, indisvalid+indisready, không index invalid sót, RLS/grants không đổi, chuyển UNPAID→PAID cập nhật partial index).
- [x] Backend N+1 giảm: `get_classes` 23→10 SQL, `get_class_response` 14→9, `get_class_history` 16→11; `Class` eager-load (7 selectin rels) đã suppress bằng `noload`.
- [x] Backend p95/query-count gate (Phase 9) xanh trên scale: list ≤12, availability ≤8, occurrences/preview ≤12, detail/history ≤12, student ≤12, không vượt MAX_SQL_PER_REQUEST; concurrency 10/20/50 không race/duplicate/lock kéo dài/pool timeout/session leak/PII trong log (12/12 pass).
- [x] Playwright performance gate (Phase 8) `npm run test:e2e:perf`: 5/5 xanh (classes kịch bản, không request trùng, pending button ≤100ms/không layout jump, first usable content prompt, mutation click trùng chỉ 1 request).
- [ ] Quyết định virtualization: đo DOM node/render/INP trên dataset thật; mặc định “không cần” (pagination đủ), chỉ thêm `@tanstack/react-virtual` khi vượt ngưỡng.
- [ ] Quyết định preview hoãn: đo baseline hai request song song vs combined candidate; mặc định “giữ song song”, chỉ gộp nếu p95 ≥20% giảm + SQL ≥1 giảm + payload ≤15% tăng + không mất retry.
- [ ] Migration 078 promoted Supabase thật (runbook `promote_078_supabase.ps1`): backup `pg_dump -Fc` → `pg_restore --list` → kích thước bảng → lock_timeout/statement_timeout → chạy concurrent index owner đúng một lần → verify 078 → verify_security → smoke `/health/ready` + classes/fees/reports → theo dõi log chậm 15–30 phút.
