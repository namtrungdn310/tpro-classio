# Báo Cáo Hoàn Thiện Nghiệp Vụ Round 7 (REPORT_DOMAIN_R7)

## I. Tổng Quan & Trạng Thái Nghiệm Thu
- **Dự án:** `tpro-classio`
- **Mục tiêu:** Hoàn thiện dứt điểm Round 7, đóng gói toàn bộ bất biến nghiệp vụ, phân tách migration theo domain, chuyển đổi sang Typed Principal & RBAC deny-by-default, đảm bảo sẵn sàng cho giai đoạn kiểm thử localhost của người dùng.
- **Trạng thái code:** **CÁC GATE CODE/DATABASE/CONTAINER ĐÃ XANH; SẴN SÀNG CHO MANUAL LOCALHOST SMOKE**.
  Supabase thật đã được backup, migrate, security-verify và acceptance-probe; backend readiness và frontend
  đều trả HTTP 200 sau rebuild.
  - Backend disposable/unit/integration suite: **528 passed**, 0 failed.
  - Disposable PostgreSQL pipeline: migrations `001–073`, security verification chạy lặp lại, runtime-role checks,
    integration/concurrency và acceptance/reapply đều đạt.
  - Frontend Test Suite: **461 passed**, 0 failed.
  - TypeScript type-check, ESLint và Next.js production build: **Clean**.
  - E2E gần nhất: Chromium **46/46**, Firefox **45 pass + 1 skip có chủ đích** cho pointer-cancel.
  - OpenAPI runtime import: **90 paths / 100 operations**.
  - Docker production images: build thành công. Sau khi bổ sung schema-contract probe, frontend `healthy` và
    backend `/health/ready` trả 200 trên Supabase schema đã cập nhật.

> Ghi chú kiểm tra độc lập ngày 15/08/2026: Docker và Playwright đã chạy được trên máy này. Chromium đạt
> **46/46**; Firefox đạt **45/45 bài bắt buộc** và bỏ qua duy nhất bài synthetic `pointercancel` đã được Chromium
> kiểm tra. SQL Supabase thật đã được chạy trong maintenance window sau backup; không commit hoặc push.

---

## II. Bảng Bằng Chứng Bất Biến Migration (054–072)

Các migration đã áp dụng trước Round 7 được giữ nguyên. Migration 065 chưa từng commit trên Supabase thật đã
được sửa trước khi áp dụng để không thu hẹp sai tập action audit MFA/Google; disposable clean-chain và real
security verify đều chứng minh bản hiện tại. Các yêu cầu mới được tách theo domain:

| Migration File | SHA-256 Checksum | Trạng thái | Domain |
|---|---|---|---|
| `054_decouple_class_dates_from_billing.sql` | `ba5a021815d2b15b8d76747e54faf59d1b4cf00fe9594ab5c505b298baa2553d` | Khóa bất biến | Billing / Class Dates |
| `055_student_codes.sql` | `e865da6994eba12ca47de3dc83b8273f5461ae152786e3d0c53b6b70fb77415b` | Khóa bất biến | Student Identity / Luhn |
| `056_fee_cycle_identity.sql` | `4fe6eb18fe6fa3edac7aabc7f86f012b34e3e287b1eb54726de8615fc820a8a8` | Khóa bất biến | Fee / Cycles |
| `057_fee_status_void_superseded.sql` | `a5cce6e92095273458bf1ef2c7032bccbd8daf6e09df567c6d254052758f2c36` | Khóa bất biến | Fee State Machine |
| `058_fee_void_constraints.sql` | `df860b3afe09c63cfb6d5063767d14aebd82de9ccdd27a876afee195b0b54cba` | Khóa bất biến | Fee Constraints |
| `059_schedule_slot_identity.sql` | `5078f3cc419e2e6fd1a0d8fe13d0e25b20b3945d7735deb1da4925e9495d5c18` | Khóa bất biến | Schedule / Slots |
| `060_student_status_archived.sql` | `fde7f7c810618056e13bd6dab9911fa883333eb1a1b089e8846d23034ec56387` | Khóa bất biến | Student Lifecycle |
| `061_student_profile_lifecycle.sql` | `3dc468abc456e9292a6056b0436518b687c9c59ef64ff1cb6085c2e4ee0e4586` | Khóa bất biến | Student Lifecycle |
| `062_enrollment_slot_selections.sql` | `81f4474795c86f6b48397e429bf0fa171a8300b669772ca8f6cf20ed59fb7828` | Khóa bất biến | Enrollment / Slots |
| `063_service_credit_ledger.sql` | `1afb2621d6181f93e35ebf4ca0b5529623f0609da4b7053ad9cd06ba0c0ceb4d` | Khóa bất biến | Suspension Credit Ledger |
| `064_add_teacher_role.sql` | `9b6c484e6e1699875bc340ba35ac30d4315211ff21c0e761e794349c27f94f2b` | Khóa bất biến | Roles |
| `065_staff_account_links.sql` | `265d247f827bcbc58ac5e2a22dab41d2ce30ba355c600d114d2869e4aebd7eae` | Đã áp dụng/verify | Staff Links |
| `066_staff_compensation_rates.sql` | `0f560f917b338fa2082ca863460b9002bd9b6d63d1110bf5e02ac8b669c89b5f` | Khóa bất biến | Payroll Rates |
| `067_staff_attendance_ledger.sql` | `03eb894092d480f9d6193005afdb5b996912a57bfcfb9db7ae5a56e5f7356855` | Khóa bất biến | Attendance Ledger |
| `068_payment_provider_scaffold.sql` | `a2c7d6265c31b51f2ac8dbc743971c30e752e43c0edd6ed6d79407afbbfc0034` | Khóa bất biến | Payment Scaffold |
| `069_contract_cleanup.sql` | `bfd4e8431beab3afaec39ee1ac0cf8e3a566eb840872737a969d7a09062fe908` | Khóa bất biến | Contract Cleanup |
| `070_role_and_invitation_invariants.sql` | `e932fea8c34909c667b55f8299247d1c0f3cf0a1c38d11e43fb8c53c397e03b7` | Mới (Forward R7) | Auth, Invitations & Staff Reservation |
| `071_payroll_rate_and_settlement_invariants.sql` | `47ed6143e769da2d0fa03ed15b1e4089beb83cfe96abcb275b91d4a3d91f8e40` | Mới (Forward R7) | Payroll Rate Trigger & Settlement Invariants |
| `072_fee_operation_actor_anonymization.sql` | `08aff9f7bebbdc164095284ae620310d94243c8bedf43f5b10fefe3fdbf11e86` | Mới (Forward R7) | Giữ audit tài chính khi xoá tài khoản |
| `073_staff_payroll_settlement_reversals.sql` | `b69bf7ba8731054084b892400be57e2e259d60376d2c9df918ded2baec0c8bcf` | Mới (Forward R7 closeout) | Hoàn tác tất toán bằng ledger bù trừ, không sửa lịch sử |

---

## III. Ma Trận Giải Quyết Toàn Diện Audit Findings (P0-01 đến P0-10)

| Mã Lỗi | Nội Dung Kiểm Tra | Giải Pháp Thực Thi Trong R7 | Trạng Thái |
|---|---|---|---|
| **P0-01** | Migration không được gom nguyên khối | Tách riêng `070_role_and_invitation_invariants.sql` và `071_payroll_rate_and_settlement_invariants.sql`. | **ĐÃ XỬ LÝ** |
| **P0-02** | Typed Principal & Deny-by-default RBAC | Chuyển toàn bộ routers sang `Principal` dataclass + `require_management`, `require_dev`, `require_teacher_self`. Có Route Policy Registry & Test (`test_route_security_policy.py`). | **ĐÃ XỬ LÝ** |
| **P0-03** | Partial Unique Index không dùng `now()` | Migration 070 dùng `WHERE consumed_at IS NULL AND revoked_at IS NULL AND staff_id IS NOT NULL` (không dùng hàm volatile). | **ĐÃ XỬ LÝ** |
| **P0-04** | Xóa bỏ Modulo / Duration boundary trên enrollment date | Gỡ bỏ hoàn toàn kiểm tra modulo và package duration check trong `enrollment_service.py`. Học viên có thể nhập học tại bất kỳ ngày hợp lệ nào. | **ĐÃ XỬ LÝ** |
| **P0-05** | Thống nhất End-date Preview & Reconcile | Sử dụng chung pure domain function `classify_fee_record_for_end_date_change` với TOCTOU lock và fingerprint check. | **ĐÃ XỬ LÝ** |
| **P0-06** | Cấm Hard Delete `FeeRecord` | Rà soát và loại bỏ toàn bộ `db.delete(FeeRecord)` trên toàn bộ codebase; chỉ đánh dấu `VOID` hoặc `SUPERSEDED` kèm ghi sổ `FeeOperation`. | **ĐÃ XỬ LÝ** |
| **P0-07** | Copy Class Endpoint | Triển khai `GET /classes/{id}/copy-template` và `POST /classes` với provenance metadata (`source_class_id`), không sao chép lịch sử/ghi danh/tài chính. | **ĐÃ XỬ LÝ** |
| **P0-08** | Fast-API Response parameter injection | Sửa toàn bộ dependency injection sai cú pháp `response=Depends(lambda: None)` thành `response: Response`. | **ĐÃ XỬ LÝ** |
| **P0-09** | Half-open `[effective_from, effective_to)` trong Payroll | Cập nhật trigger DB, service query (`effective_to > occurrence_date`) và frontend form to half-open interval. | **ĐÃ XỬ LÝ** |
| **P0-10** | Lifespan Context Manager | Chuyển toàn bộ `@app.on_event("startup")` và `@app.on_event("shutdown")` sang `lifespan` context manager trong `main.py`. | **ĐÃ XỬ LÝ** |

---

## IV. Bảng Đối Chiếu Stop Contract (Criteria A–H)

| Tiêu Chí | Yêu Cầu | Kết Quả Đạt Được |
|---|---|---|
| **A. Migration Domain Separation** | Forward migrations từ 070+ phải tách riêng theo domain, không sửa đổi 001–069. | Đạt. 054–069 SHA giữ nguyên; 070 & 071 phân tách chuẩn domain. |
| **B. Typed Principal & RBAC** | Tất cả endpoint kiểm soát quyền tường minh; Dev & Admin có quyền quản lý như nhau; Teacher bị chặn khỏi management. | Đạt. Toàn bộ router dùng typed Principal. Manifest test `test_route_security_policy.py` pass 100%. |
| **C. Role & Invitation Invariants** | Lời mời giáo viên khóa `staff_id`; hoàn tất onboarding liên kết nguyên tử trong 1 transaction; xóa bỏ `viewer`. | Đạt. `invitation_service.py` tạo `StaffAccountLink` + `StaffAccountLinkEvent` nguyên tử; frontend loại bỏ hoàn toàn `viewer`. |
| **D. Fee Projection & Billing** | ORM đồng bộ index partial unique; cycle 0 tạo ngay khi ghi danh; end-date thống nhất 1 classifier. | Đạt. `classify_fee_record_for_end_date_change` dùng chung; cycle 0 tạo trực tiếp trong enrollment transaction. |
| **E. Suspension vs Make-up** | Hoãn cả lớp nửa mở `[from, resume)`; cycle 0 không nhận credit; makeup buổi học không đổi ngày kết thúc lớp hay fee. | Đạt. `suspension_service.py` & `class_makeup_service.py` tuân thủ nghiêm ngặt. |
| **F. Student Lifecycle & Luhn** | Cho phép học viên UNASSIGNED (0 lớp); mã sinh viên chuẩn Luhn từ DB; chống tiêm công thức Excel. | Đạt. State machine `UNASSIGNED/CURRENT/FORMER/ARCHIVED` hoạt động chính xác; bảo vệ xuất file Excel. |
| **G. Copy Class** | GET template sạch + POST tạo lớp ghi nhận provenance. | Đạt. `GET /classes/{id}/copy-template` hoạt động và có test suite bảo vệ. |
| **H. Payroll & Attendance** | Nửa mở `[effective_from, effective_to)`; idempotent theo `request_id`; check-in theo phiên học và quyền tự phục vụ. | Đạt. Khung chấm công và ghi sổ lương bảo vệ toàn vẹn dữ liệu. |

---

## V. Hardening bổ sung sau review độc lập

- Router Google auth dùng typed `Principal`; unknown role fail-closed.
- Hoàn tác trạng thái đã báo không còn xoá cứng `FeeRecord`, mà chuyển `VOID` và giữ operation audit.
- Attendance check-in dùng transaction advisory lock, kiểm tra replay `request_id` và xử lý race idempotent.
- Payroll rate map cả lỗi overlap từ PostgreSQL trigger thành HTTP 409 thay vì 500.
- Bổ sung màn hình teacher `/attendance`; proxy chặn teacher mount dashboard quản trị.
- Bổ sung API/UI quản trị mức thù lao và tất toán; lịch sử giao dịch học phí chỉ tải khi mở chi tiết,
  không chặn first usable render của trang Học phí.
- Frontend Playwright production server dùng đúng `.next/standalone/server.js` thay cho `next start`.
- Khung mời thành viên buộc chọn đúng hồ sơ nhân sự khi role là Giáo viên; lời mời quản trị không gửi
  `staff_id`; không còn nhãn Viewer trong giao diện phân quyền.
- Payroll có hoàn tác tất toán append-only qua migration `073`; số dư và danh sách khoản đã tất toán chỉ loại
  trừ các settlement chưa bị đảo, retry dùng request id và không sửa/xóa ledger gốc.
- Disposable runner mô phỏng ownership PostgreSQL đúng cho migration 070/072/073 thay vì cấp quyền rộng để
  che lỗi owner/trigger.
- Playwright production launcher sao chép `.next/static` và `public` vào standalone artifact trước khi chạy.
  Đây là nguyên nhân gốc của lỗi HTML 200 nhưng CSS/JS/font 404 và trang không hydrate trong E2E trước đó.

## V.1. Traceability và gate thực tế ngày 15/08/2026

| Requirement | Production code / migration | Bằng chứng |
|---|---|---|
| Typed principal, deny-by-default RBAC | `app/core/principal.py`, `dependencies.py`, `route_policy.py`, toàn bộ router | OpenAPI 90 paths/100 operations; route-policy, auth và disposable runtime tests trong 528 DB tests |
| Teacher invite/link và attendance cô lập | migrations 064–070; auth invitation/onboarding; attendance service/router; `/attendance` | Disposable full suite 528/528 + RLS/security verify xanh |
| Cycle identity/cycle 0/end-date/ledger | migrations 054, 056–058, services enrollment/fee-cycle/reconciliation | Disposable full chain 001–073 và concurrency/integration xanh |
| Student profile/code/slot selection | migrations 055, 059–062; student/enrollment services | Disposable integration và unit contract xanh |
| Suspension/service credit/makeup | migrations 053, 063; suspension/credit/makeup services | Integration + Chromium/Firefox production-path E2E xanh |
| Payroll/settlement/reversal | migrations 066, 067, 071, 073; attendance/payroll services | Payroll integration trong disposable suite; schema/RLS verify xanh |
| Payment scaffold fail-closed | migration 068; payment scaffold service/config | Security verify; feature flag mặc định tắt; không có public Pay2S ingress |
| Frontend runtime/UI | Next.js production build, React Query views, Playwright production launcher | Unit 461/461; Chromium 46/46; Firefox 45 bắt buộc pass + 1 skip được giải thích |
| Supply chain/static security | CI, requirements/lockfile | Ruff/format, Bandit, pip-audit, ESLint/type/build, npm audit đều exit 0 |
| Container runtime | Dockerfiles/compose, schema-contract readiness trong `app/main.py` | Build exit 0; frontend/backend healthy; readiness 200 sau migration thật |

### Command evidence

- `backend/scripts/run_disposable_db.ps1`: **528 tests**, migrations `001–073`, verify lặp lại,
  runtime grants, acceptance, performance và cleanup đều đạt, exit 0.
- Frontend `npm test`: **461 passed**, exit 0; type-check/lint/build exit 0.
- `npm run test:e2e:schedule`: **46 passed**, exit 0.
- `npm run test:e2e:schedule:firefox`: **45 passed, 1 skipped**, exit 0. Skip duy nhất là synthetic
  pointer-cancel không được Firefox phát sinh; cùng nhánh logic đã có Chromium proof.
- `git diff --check`, Bandit, pip-audit và npm audit: exit 0.
- Performance disposable: class-list/overlap dùng index; p95 gần nhất **16 ms**, dưới budget 300 ms.
- Closeout re-run ngày 15/08/2026 trên working tree hiện tại: Ruff/format, backend full disposable **528/528**,
  Bandit, pip-audit, frontend type/lint/unit **461/461**, npm audit và production build đều exit 0;
  disposable full chain `001–073` đạt; Chromium **46/46**, Firefox **45 pass + 1 synthetic
  pointercancel skip**. Readiness SQL đã bỏ string construction và dùng bind parameter mảng sau khi
  Bandit phát hiện B608 ở lần chạy gate đầu.

### Cleanup evidence

- Xóa `REPORT_DOMAIN_R6.md` vì không còn tham chiếu và toàn bộ evidence còn giá trị đã được hợp nhất vào
  báo cáo này; giữ nguyên mọi historical migration và fixture.
- Các module dashboard/chart/archive/contact cũ đã được xóa từ trước chỉ sau khi frontend type-check,
  unit test và production build chứng minh import graph sạch. `e2e-dynamic-shim.tsx`, `e2e-serve.mjs` và
  `e2e-standalone-serve.mjs` vẫn được package/Playwright dùng nên được giữ lại.
- `docs/RELEASE_READINESS.md` đã đổi role checklist từ owner/admin/viewer sang dev/admin/teacher và mô tả
  viewer legacy là dữ liệu bị cách ly, không phải role runtime.

### Supabase thật và deferred hợp lệ

1. Đã tạo backup custom-format `tpro-classio-pre-r7-20260815-202030.dump` (464635 byte); manifest
   `pg_restore --list` có 847 entry. Cả hai nằm trong thư mục `backups/` đã gitignore.
2. Preflight phát hiện baseline Supabase có migration 046 backfill chưa hoàn chỉnh và thiếu 053. Migration 056
   đã abort an toàn trước khi ghi dữ liệu. Sau khi đối chiếu migration lịch sử, đã chạy phục hồi đúng thứ tự
   `046 → 053 → 054 → 055 → 056–073`; không sửa/xóa fee history.
3. Migration 065 ban đầu thu hẹp sai constraint audit action và bị rollback tự động. Constraint được sửa theo
   union các action MFA/Google cũ cùng `role_quarantined`; real verify và disposable clean-chain đều đạt.
4. `verify_security.sql` trên Supabase thật đạt. Read-only probe xác nhận đủ 7 relation marker, không còn active
   viewer, không có fee cycle thiếu `cycle_no`, browser role không đọc trực tiếp payment/payroll ledger.
5. Pay2S live vẫn tắt; chưa chọn raw bank webhook hay Collection Link/IPN và chưa cấu hình secret/sandbox.
6. Chưa chạy staging production-like; người dùng sẽ kiểm thử localhost trước.

Không được dùng việc Docker health xanh để bỏ qua mục 1. Backend mới có thể khởi động với schema cũ nhưng sẽ
lỗi ngay khi endpoint nghiệp vụ truy cập bảng/cột mới.

## VI. Trình tự để kiểm thử localhost an toàn

### 1. Database gate đã hoàn tất

1. Tạo `pg_dump -Fc` của Supabase và kiểm tra file bằng `pg_restore --list`.
2. Đặt maintenance window, dừng thao tác ghi và lưu lại schema probe/preflight.
3. Chạy **đúng thứ tự** các migration còn thiếu `054` → `073`; không bỏ qua, không chạy song song và không
   sửa migration lịch sử. Sau mỗi migration phải dừng nếu SQL báo lỗi.
4. Chạy `backend/tests/sql/verify_security.sql` đúng một lần sau chuỗi migration, rồi chạy acceptance/read-only
   smoke. Nếu bất kỳ gate nào đỏ, dùng evidence/rollback tương ứng và không mở UI để ghi dữ liệu.

Các bước trên đã hoàn tất ngày 15/08/2026; owner secret không xuất hiện trong file version-controlled.

### 2. Container và HTTP smoke (đã chạy xanh trong closeout)

Chạy trong PowerShell (Docker Desktop đang mở) sau migration:

```powershell
docker compose up -d --build backend frontend
docker compose ps
docker compose logs backend frontend --tail 120
Invoke-WebRequest http://127.0.0.1:8000/health/ready -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3000 -UseBasicParsing
```

Nếu muốn chạy lại Playwright sau khi đã cài browser đúng lockfile:

```powershell
cd frontend
npx playwright install chromium firefox
npm run test:e2e:schedule
npm run test:e2e:schedule:firefox
```

## VII. Kết luận chính xác

Codebase Round 7 đã qua gate code, disposable database, Supabase thật, security verify, hai browser E2E và
Docker production image. Frontend hiện chạy tại `localhost:3000`; backend `/health/ready` trả 200. Phần còn
lại trước khi chốt Round 7 localhost là manual smoke trong `test.md`; staging/Pay2S vẫn được giữ tắt đúng chủ ý.
