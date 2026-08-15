# TPRO Classio — Round 7 verification checklist

> Checklist này là nguồn sự thật cho kiểm thử Round 7. Không tick bằng tuyên bố trong báo cáo; chỉ tick bằng
> command/test/manual evidence trên đúng working tree và đúng môi trường.

## 1. Static, unit và supply-chain

- [x] `python -m ruff check .`
- [x] `python -m ruff format --check .`
- [x] Backend full disposable/unit/integration closeout — 528 passed.
- [x] `python -m bandit -q -r app` — 0 finding.
- [x] `python -m pip_audit -r requirements.txt` — 0 known vulnerability.
- [x] `npm run type-check`
- [x] `npm run lint`
- [x] `npm test` — 461 passed.
- [x] `npm audit --audit-level=high` — 0 vulnerability.
- [x] `npm run build`
- [x] `git diff --check`

## 2. Database, migration và security disposable

- [x] Full migration chain `001–073` chạy trên PostgreSQL disposable.
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
- [x] Occurrence makeup không dời kỳ thu hoặc class end date.
- [x] Student profile zero-enrollment, archive/restore, code và slot selections.
- [x] Copy class tạo zero copied enrollment/finance/history.
- [x] Attendance occurrence/rate/idempotency và BOLA protection.
- [x] Payroll rate, earning, settlement concurrency và settlement reversal.
- [x] Payment request/scaffold fail-closed và browser role không đọc được.
- [x] Export formula-injection protection và bounded sensitive responses.

## 4. Browser production-path

- [x] Chromium: 46/46 critical E2E passed.
- [x] Firefox: 45 critical E2E passed.
- [x] Firefox synthetic pointer-cancel skip được ghi rõ; cùng branch có Chromium proof.
- [x] Schedule endpoint/click/drag/reverse/availability/error/retry/save payload.
- [x] Class workspace, unsaved changes, modal Escape/backdrop/focus behavior.
- [x] Makeup workspace và production-path command payload.
- [x] Fee package helper, keyboard Tab/caret và inline feedback position.

## 5. Supabase thật — đã kiểm chứng ngày 15/08/2026

- [x] Xác nhận `backend/.env` có owner password riêng, không dùng runtime-role password.
- [x] Dừng backend/frontend trong maintenance window.
- [x] Tạo backup `pg_dump -Fc`; `pg_restore --list` đọc được 847 entry.
- [x] Read-only preflight xác nhận baseline; phát hiện 046 backfill chưa hoàn chỉnh và 053 còn thiếu.
- [x] Fail-fast ở 056 không làm mất dữ liệu; phục hồi theo migration lịch sử `046 → 053 → 054`, rồi chạy `055 → 073` với `ON_ERROR_STOP=1`.
- [x] Chạy `backend/tests/sql/verify_security.sql` thành công trên Supabase thật.
- [x] Acceptance/schema probe đạt: đủ 7 relation marker, 0 active viewer, 0 fee cycle thiếu `cycle_no`, browser role không đọc ledger mới.
- [x] Owner password/DSN/PII không được ghi vào migration, verify hoặc report version-controlled.

## 6. Docker và HTTP sau migration thật

- [x] `docker compose up -d --build backend frontend`
- [x] Cả hai service healthy.
- [x] `http://127.0.0.1:8000/health/ready` trả 200.
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
