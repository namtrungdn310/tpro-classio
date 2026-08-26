# TPRO Classio — DEV ROUND 7: CLOSEOUT SAU AUDIT ĐỘC LẬP

> **Trạng thái được kiểm chứng lại ngày 17/08/2026:** kế hoạch đã được hiện thực đến migration `077` và đã
> qua unit, disposable DB, security verify, production-path E2E trên Chromium/Firefox, production build và
> Docker health. Các đoạn “hiện trạng/rủi ro” phía dưới là baseline lịch sử giải thích root cause, không phải
> defect còn mở. Bằng chứng authoritative nằm trong `REPORT_DOMAIN_R7.md`.
>
> **Blocker môi trường còn lại:** Supabase thật mà localhost đang dùng cần được kiểm tra/chạy migration `054–077`. Không
> được thao tác ghi trên UI trước chuỗi backup → migration tuần tự → `verify_security.sql`.

> Đây là hợp đồng triển khai cuối trước khi người dùng tự kiểm thử localhost và hoàn thiện để lên staging.
> Không được coi báo cáo Round 6 hay số lượng test xanh là bằng chứng hoàn thành. Audit độc lập đã tìm thấy
> lỗi runtime, phân quyền, tài chính và hiệu năng mà test cũ không đi qua.

## 0. Quy tắc thực thi bắt buộc

1. Đọc trọn `dev.md`, `test.md`, `goal.md`, `REPORT_DOMAIN_R7.md` trước khi sửa. Báo cáo Round 6 đã
   được hợp nhất và xóa để tránh hai nguồn sự thật mâu thuẫn.
2. Không chạy SQL trên Supabase thật; không gọi SMTP/Google/Pay2S thật; không commit/push.
3. Không sửa migration đã có `001–076`. Mọi thay đổi DB dùng migration forward-only từ số kế tiếp
   sau khi kiểm tra thư mục tại runtime (dự kiến `070+`).
4. Không xóa lịch sử migration, ledger, audit event, fixture hay test chỉ vì chúng khóa hành vi cũ.
   Mỗi test cũ phải được phân loại `KEEP`, `REWRITE` hoặc `DELETE_WITH_PROOF` trong report.
5. Không dùng UI để thay cho kiểm soát quyền backend. UI chỉ được render sau khi server xác nhận effective role.
6. Không dùng optimistic update cho tiền, tín dụng hoãn, chấm công, lương, role hoặc webhook.
7. Mọi command tài chính/ledger cần transaction, idempotency key, row/advisory lock phù hợp và response
   authoritative từ server.
8. Chỉ dùng skill `ui-ux-pro-max` cho phần UI/UX. Không dùng skill này để tự quyết định nghiệp vụ, DB,
   security hay API.
9. Giữ nguyên thay đổi ngoài phạm vi của người dùng. Trước khi sửa lưu `git status --short` và manifest
   file đã chạm; cuối vòng đối chiếu lại.
10. Không build Docker sau từng thay đổi. Chỉ build một lần sau khi unit/type/lint/integration/E2E xanh.
11. Không báo hoàn tất nếu còn bất kỳ mục bắt buộc nào trong `goal.md` chưa đạt.

## 1. Kết quả audit độc lập Round 6 — phải coi là blocker

### P0-01 — Principal mới làm hỏng route quản trị ở runtime

- `require_admin`, `require_owner`, `require_management` trả `Principal`.
- Nhiều route vẫn khai báo `current_user: dict` và dùng `current_user["id"]`, `.get(...)`:
  `classes.py`, `students.py`, `fees.py`, `class_makeup.py`, `suspensions.py`,
  `auth/users.py`, `auth/invitations.py`, `staff.py`.
- Test cũ override dependency bằng dict nên vẫn xanh, nhưng runtime có thể trả 500 `TypeError`.
- Phải migrate toàn bộ route/service sang typed `Principal`; không tạo thêm adapter dict thứ hai để che lỗi.

### P0-02 — Teacher đang có thể đọc dữ liệu quản trị

- `get_current_user` hiện chấp nhận `dev|admin|teacher`.
- Các GET nhạy cảm vẫn dùng generic dependency: classes, students, staff, contact suggestions, fees,
  fee transactions, reports, dashboard, makeup.
- Nếu chỉ ẩn sidebar, teacher vẫn gọi API trực tiếp và đọc PII/tài chính.
- Tất cả API quản trị phải dùng `require_management`; teacher chỉ được allowlist `/attendance/me/*`
  và các auth self endpoint tối thiểu.

### P0-03 — Auth/role đang tự mâu thuẫn

- Model/schema/invitation/FE vẫn hard-code `viewer`; migration 065 lại vô hiệu hóa viewer.
- `get_current_user` trả effective role `dev`, nhưng frontend Zod/token parser chỉ nhận `admin|viewer`.
- `Principal` đang đọc username/full_name/avatar nhưng không trả các trường đó qua compatibility dict;
  `/auth/me` có thể mất tên/avatar.
- Teacher chưa có page/shell riêng; invitation chưa atomically link teacher với staff.
- Kết quả: owner/dev có thể parse thất bại ở FE, teacher không đăng nhập dùng được, invite mới tạo account viewer bị khóa.

### P0-04 — ORM học phí vẫn giữ khóa cũ

- Migration 056/069 chuyển identity sang `(enrollment_id, cycle_no)` và bỏ unique theo `period`.
- `models/fee_record.py` vẫn khai báo unique `(enrollment_id, period)`.
- Điều này phá gói 1–3 tuần có nhiều kỳ trong cùng tháng và làm metadata/DB contract lệch nhau.

### P0-05 — Unnotify đang hard-delete lịch sử

- `fee_service.py` gọi `db.delete(record)` sau khi bỏ thông báo ở một số trường hợp.
- Khoản từng xuất hiện/được thông báo phải được giữ bằng projection `VOID/SUPERSEDED` và fee operation;
  không được delete. Correction phải là compensating event.

### P0-06 — Preview đổi ngày kết thúc không cùng predicate với commit

- Reconcile dùng `coverage_start >= class.end_date`.
- Preview/impact lại dùng `due_date > end_date`.
- Credit hoãn có thể đẩy adjusted due ra sau end_date dù coverage hợp lệ; preview hiện có thể báo sai,
  fingerprint TOCTOU không đại diện đúng mutation.

### P0-07 — Ghi danh lớp theo gói vẫn bị ép vào boundary của lớp

- `resolve_enrollment_date` bắt `(enrollment_date - class.start_date) % cycle_days == 0`.
- Nghiệp vụ đã khóa: học viên được vào bất kỳ ngày hợp lệ trong thời gian lớp; chu kỳ thu neo theo chính
  enrollment date, không theo boundary lớp.

### P0-08 — Pagination học viên lỗi contract

- Route dùng `response=Depends(lambda: None)` rồi ghi `response.headers`; khi có trang sau sẽ lỗi.
- FE `getStudents()` chỉ trả array, bỏ `X-Next-Cursor`; UI chỉ thấy tối đa 200 bản ghi và không biết còn trang.
- Classes/fees cũng chưa có cursor pagination production-grade.

### P0-09 — Payroll và teacher flow mới chỉ có schema/tables/check-in sơ bộ

- Chưa có API/UI quản trị rate effective-dated, correction, settle-all, reversal, report.
- Chưa có teacher mobile attendance page.
- Chưa có invitation + staff link atomic và session revocation khi link/archive thay đổi.
- Hai bất biến DB hiện chưa đủ an toàn để triển khai payroll:
  - Trigger rate dùng khoảng half-open nhưng service `_resolve_rate` lại coi `effective_to` là inclusive; tại
    ngày nối hai mức lương có thể đồng thời khớp hai rate và chọn theo thứ tự ngầm.
  - `staff_payroll_settlement_items` chỉ unique `(settlement_id, ledger_entry_id)`, nên cùng một earning
    vẫn có thể bị đưa vào hai settlement khác nhau và trả lương hai lần.
- `staff_payroll_settlements.request_id` chưa unique; unique `(attendance_entry_id, entry_type)` lại khóa
  mọi correction thứ hai cùng loại. Cần sửa bằng migration forward và test concurrency, không chỉ service guard.

### P0-10 — Student code và payment scaffold chưa nối đủ bề mặt

- Student code DB/search/list có một phần, nhưng chưa chứng minh nhất quán profile/fees/report/export/copy.
- `PaymentRequest` ORM thiếu FK dù migration có FK.
- Pay2S runtime chưa tồn tại. Đây không phải lỗi nếu feature flag OFF; tuyệt đối không tuyên bố đã tích hợp live.

### P1 — Hiệu năng/UI còn thiếu bằng chứng

- Fee page vẫn eager tải toàn bộ lịch sử transaction và chặn first usable state.
- Mutation invalidation còn quá rộng (`fees`, `reports`, `classes`, transaction histories).
- Student frontend không consume cursor; class/fee list chưa cursor hóa.
- Chưa có route×role manifest, BOLA matrix, realistic query-count/p95 và unauthorized-prefetch proof.
- Cổng tĩnh độc lập hiện chưa sạch hoàn toàn: `ruff check` đạt nhưng `ruff format --check` báo
  `backend/scripts/run_disposable_db.py` cần format. Round 7 phải sửa bằng formatter rồi chạy lại toàn bộ gate;
  không được giữ tuyên bố “format xanh” từ báo cáo Round 6.

## 2. Các quyết định nghiệp vụ khóa — không được tự suy đoán

### 2.1 Lớp và chu kỳ thu

- `class.start_date` cố định sau khi tạo.
- `class.end_date` độc lập với hình thức thu, chỉnh bằng preview + reason.
- Gợi ý nhanh trên form (không phải ràng buộc nghiệp vụ):
  - Theo tháng: `add_months_eom_clamped(class.start_date, số_tháng)`; ví dụ 16/08 + 12 tháng → 16/08 năm sau.
  - Theo gói N tuần: `class.start_date + N*7 ngày`; ví dụ 3 tuần từ 13/08 → 03/09.
  - Ngày kết thúc vẫn là giá trị độc lập và có thể chỉnh trực tiếp; tuyệt đối không cộng thêm một ngày
    theo quy tắc minimum-end cũ.
- End date là cap sinh kỳ, không phải business key của chu kỳ.
- Cycle tồn tại khi `coverage_start < class.end_date`; `coverage_end = min(next_anchor, class.end_date)`.
- Kỳ cuối bị cắt ngắn vẫn dùng học phí cấu hình của enrollment (không tự prorate). Nếu admin rút ngắn làm
  ảnh hưởng khoản đã báo/đã nộp, phải hiện impact preview và bắt đi qua VOID/refund review rõ ràng;
  không âm thầm sửa/xóa.
- Billing type/rate của enrollment không được đổi sau khi có nghĩa vụ tài chính đầu tiên; correction dùng
  explicit workflow/audit.

### 2.2 Ghi danh và kỳ đầu

- Hồ sơ học viên có thể tồn tại với 0 enrollment.
- Enrollment date có thể là bất kỳ ngày hợp lệ nằm trong class span, không cần trùng boundary của lớp.
- Trong cùng transaction tạo enrollment phải tạo cycle 0:
  - `due_date = enrollment_date`;
  - `status=UNPAID`, `notified_at=NULL`;
  - không giả vờ “đã báo” khi chưa thực sự copy/gửi/xác nhận thông báo.
- Chu kỳ tháng/gói tiếp theo neo theo enrollment date, không neo class start.
- Một học viên có thể chọn `ALL` hoặc `SELECTED` các slot tuần; lựa chọn này ảnh hưởng attendance/makeup,
  không tự giảm học phí. Học phí riêng là explicit override.

### 2.3 Identity kỳ thu

- Identity duy nhất là `(enrollment_id, cycle_no)`; cycle_no 0-based.
- `period=YYYY-MM` chỉ là reporting bucket từ adjusted due date, không unique.
- Lưu snapshot: class/student/enrollment date, billing cadence/rate, base due, adjusted due,
  coverage start/end.
- `SUM(payment ledger)` phải luôn khớp projection; không UPDATE/DELETE ledger.

### 2.4 Hoãn toàn lớp và bù buổi

- Phân biệt hai nghiệp vụ:
  1. **Hoãn dịch vụ toàn lớp theo khoảng ngày** `[suspended_from, resume_on)`: dời kỳ thu từng enrollment.
  2. **Hoãn/bù một occurrence riêng lẻ**: không dời kỳ thu; chỉ đổi occurrence và attendance eligibility.
- Số ngày hoãn là calendar-day overlap của membership với khoảng half-open.
- Cycle 0 không nhận credit. Credit nhắm kỳ renewal chưa protected gần nhất và dời kỳ đó cùng các kỳ sau.
- Học viên vào giữa khoảng chỉ nhận số ngày overlap; vào sau không nhận.
- NOTIFIED/PAID không bị rewrite; credit chuyển sang kỳ unprotected kế tiếp hoặc tạo review.
- Hủy hoãn tạo reversal âm liên kết event gốc; không delete/update event cũ.
- Xếp/hoàn tất bù không cộng credit lần hai và không đổi class end date.

### 2.5 Role

- Effective roles duy nhất: `dev`, `admin`, `teacher`.
- `dev` chỉ suy ra server-side từ immutable `OWNER_USER_ID`, không lưu/grant qua API.
- Persistent/grantable role: `admin|teacher`. `viewer` chỉ có thể còn trong lịch sử migration, không runtime.
- Dev/admin: toàn bộ quản trị lớp/học viên/nhân sự/học phí/báo cáo/payroll.
- Dev-only: invite account, đổi role/status, link/relink teacher account–staff.
- Teacher: một trang attendance riêng, chỉ dữ liệu chính họ và occurrence được phân công; không PII học viên,
  không tài chính, dashboard, classes management, settings hay reports.

### 2.6 Chấm công và lương

- Check-in gắn canonical occurrence + slot staff assignment + server timestamp + time window.
- Một `(staff_id, occurrence_id)` chỉ sinh tối đa một attendance và một EARNING.
- Rate effective-dated, không overlap; earning snapshot rate/version tại check-in.
- Balance = tổng ledger chưa allocation, không có cột balance mutable.
- Settle-all dùng cutoff/high-watermark + settlement items trong transaction; earning đồng thời sau cutoff
  không bị thanh toán nhầm.
- Correction/reversal/settlement reversal là compensating entries có actor/reason.
- Khoảng hiệu lực rate dùng duy nhất quy ước half-open `[effective_from,effective_to)`; `effective_to=NULL`
  nghĩa là vô hạn. Cả trigger DB, query service, schema/UI và test phải dùng cùng quy ước.
- Chỉ EARNING gốc unique theo attendance. ADJUSTMENT/REVERSAL có thể có nhiều entry liên kết gốc,
  mỗi command unique theo request_id và phải kiểm tra tổng correction không tạo trạng thái tài chính vô lý.
- Với nghiệp vụ settle-all, mỗi earning ledger chỉ được allocation vào tối đa một settlement còn hiệu lực.
  Settlement reversal tạo entry/record bù, không xóa item rồi cho tái sử dụng âm thầm.

### 2.7 Student code và payment reference

- Mã học viên là DB-generated immutable `TP` + 8 chữ số serial + Luhn digit; display `TP-0000-0001-8`.
- UUID vẫn là object key; student code không phải secret, auth proof hay idempotency key.
- Search nhận compact/formatted code, prefix bounded và dùng index.
- Payment reference không chỉ dùng student code; dùng `student_code + P + random Crockford suffix`, unique,
  khó đoán và map đúng một open obligation.
- Hiển thị code nhất quán list/profile/enrollment/fees/report/export; Excel phải chống formula injection.

### 2.8 Pay2S

- Round này chỉ hoàn thiện provider-neutral scaffold **disabled by default**.
- Không tạo webhook live khi chưa chốt raw bank webhook Bearer hay Collection Link/IPN HMAC, sandbox và secret.
- Không claim “production-ready auto payment”. Manual payment vẫn authoritative.

## 3. Thứ tự triển khai nguyên tử

### Phase A — Preflight và traceability

1. Lưu baseline: git status, version, current migration manifest, hashes 054–069, test counts.
2. Sinh bảng `OLD_TEST_MAP.md` tạm trong evidence/report (không cần giữ nếu report đã nhập): test nào KEEP,
   REWRITE, DELETE_WITH_PROOF; đặc biệt các test viewer, financial isolation, period uniqueness,
   enrollment boundary, fee delete.
3. Sinh inventory OpenAPI method/path → dependency hiện tại; đánh dấu public/self/teacher/management/dev/provider.
4. Không sửa migration 054–069. Chọn số migration tiếp theo sau khi xác nhận max hiện có.

### Phase B — Sửa typed Principal và RBAC trước mọi nghiệp vụ khác

1. Mở rộng `Principal` chứa đủ `username`, `full_name`, `avatar_url`; lấy từ cùng query profile.
2. Loại compatibility dict khỏi route nội bộ. Nếu cần giữ `get_current_user`, nó phải trả `Principal` typed.
3. Migrate từng route:
   - self auth: `resolve_principal`;
   - management reads/mutations: `require_management`;
   - dev-only account/invite/link: `require_dev`;
   - teacher: `require_teacher_self`.
4. Thay `current_user["id"]/.get` bằng `principal.user_id`, `.effective_role`, `.is_owner`.
5. Không còn so sánh `role == "admin"` để nhận diện management; dev phải có quyền tương đương admin.
6. Đổi classes/students/staff/fees/reports/dashboard/contact/makeup GET sang management.
7. Tạo generated policy manifest từ OpenAPI; CI fail nếu có route mới chưa phân loại.
8. Viết full runtime route matrix bằng token/session/profile thật trên disposable DB, không override dict.
9. Fix `/auth/me` trả đúng dev/admin/teacher + name/avatar; FE schema/token/session nhận đủ ba effective roles.
10. Khi role/status/staff link/staff archived thay đổi: revoke toàn bộ device sessions, clear/reload FE cache.

### Phase C — Hoàn tất role migration và invitation

1. Migration forward cập nhật DB defaults/checks có chủ đích; không auto-map viewer→teacher.
2. Update ORM `Profile.role` và invitation role thành admin|teacher; bỏ default viewer.
3. Invite payload bắt buộc `role`:
   - admin: không staff_id;
   - teacher: bắt buộc staff_id active chưa link/chưa reserve.
4. Thêm staff_id/role reservation vào invitation với partial unique cho invite teacher còn hiệu lực.
5. Khi onboarding Google+TOTP hoàn tất, trong một transaction:
   - lock invitation và staff;
   - set persistent role;
   - tạo staff_account_link + append-only LINK event;
   - activate profile;
   - consume invitation.
6. Failure giữa chừng rollback toàn bộ; retry idempotent.
7. Dev UI: mời admin hoặc teacher, teacher search staff, không hiển thị Viewer.
8. Teacher login redirect thẳng `/attendance`; management shell/nav/query-prefetch không mount.

### Phase D — Đồng bộ ORM/DB và bảo toàn lịch sử học phí

1. Migration forward kiểm tra 056/069 state; không drop dữ liệu mù quáng.
2. Sửa `FeeRecord.__table_args__` theo unique `(enrollment_id, cycle_no)`; period không unique.
3. Đồng bộ nullable/default/check/index ORM với DB, gồm FK của `PaymentRequest`.
4. Xóa mọi `db.delete(FeeRecord)` khỏi reconciliation/unnotify/end-date/enrollment flows.
5. Dùng `VOID` hoặc `SUPERSEDED` + `FeeOperation` với before/after snapshot, actor, reason, origin.
6. Unnotify chỉ cập nhật projection notification + append operation; record ID/history vẫn tồn tại.
7. Payment/refund/reversal ledger bất biến; mọi correction là entry bù.

### Phase E — Billing canonical và end-date impact

1. Bỏ alignment enrollment theo class cycle boundary; chỉ validate class span/status.
2. Tạo enrollment + cycle0 trong cùng transaction và advisory lock theo enrollment/student/class.
3. Tạo cycle canonical theo anchor enrollment date:
   - monthly `add_months_clamped(enrollment_date,n)`;
   - course `enrollment_date + n*weeks*7`.
4. Cho nhiều cycle cùng month; period derived từ adjusted due.
5. Viết một hàm domain duy nhất xác định fee affected bởi end-date dựa trên `coverage_start/coverage_end`.
6. Preview và commit gọi cùng hàm + cùng deterministic fingerprint; commit lock class/enrollments/records rồi
   recompute fingerprint để ngăn TOCTOU.
7. Extend end: sinh future unprotected lazily/idempotent.
8. Shorten end:
   - future unnotified → VOID/SUPERSEDED;
   - notified unpaid → explicit confirmation + VOID operation;
   - paid/refunded → refund/review list, không tự rewrite.
9. API/UI hiển thị base due, adjusted due và coverage; Zalo/report/export dùng adjusted due authoritative.

### Phase F — Hoãn toàn lớp/service credit

1. Giữ occurrence makeup riêng lẻ không ảnh hưởng tài chính, nhưng đổi copy/UI để phân biệt rõ với
   whole-class suspension.
2. Preview suspension tính overlap từng enrollment, target cycle, old/new adjusted due và protected outcome.
3. Confirm dùng request_id, lock class/event/enrollment/cycles; tạo event + allocation append-only exactly once.
4. Nhiều suspension cộng dồn theo event order nhưng due được tính từ base anchor + cumulative allocation,
   không chain adjusted date để tránh drift.
5. Hỗ trợ reversal trước khi bắt đầu và compensating reversal sau khi đã áp; protected/consumed credit vào review.
6. Make-up scheduling/completion không gọi credit service và không đổi end_date.
7. UI wizard progressive disclosure: phạm vi → impact preview → xác nhận. Chỉ một primary CTA; warning gần dữ liệu.

### Phase G — Student profile, selected sessions, code và copy class

1. Profile create/edit độc lập enrollment; archive chỉ explicit actor/reason, không auto-archive khi rời lớp cuối.
2. Derived lists `UNASSIGNED|CURRENT|FORMER`; no-class profile vẫn active.
3. `attendance_scope=ALL|SELECTED`; selection effective-dated theo stable slot ID.
4. Khi class schedule đổi: preview remap/close selection; không silently point vào slot cũ.
5. Student code:
   - normalize compact/formatted input;
   - indexed prefix/exact search;
   - list/profile/fees/report/export/payment request hiển thị nhất quán;
   - hidden/privacy rules không dùng code như PII secret.
6. Sửa student pagination thành response DTO `{items,next_cursor}` hoặc contract tương đương typed;
   FE dùng `useInfiniteQuery`, không đọc header bị bỏ qua.
7. Copy class:
   - GET copy-template chỉ trả projection cấu hình được phép sao chép;
   - mở create form editable;
   - POST create bình thường với optional source_class_id audit;
   - không copy IDs, lifecycle, enrollments, fee/payment/report/makeup/history;
   - dates reset, staff/schedule ở draft và phải revalidate conflict.

### Phase H — Teacher attendance và payroll hoàn chỉnh

1. Normalize occurrence assignment đủ để biết teacher nào được check-in slot nào; `teacher_ids` là danh sách
   tường minh của từng slot (một hoặc nhiều giáo viên), không fallback toàn bộ teacher pool vào mọi buổi.
   Hai GV cùng lớp chỉ cùng được chấm khi cả hai được assign vào đúng slot; trợ giảng vẫn là danh sách riêng.
2. Teacher `/attendance` mobile-first:
   - chỉ hôm nay/lịch chính họ;
   - class/time/role/check-in status;
   - CTA ≥44px, visible label, keyboard/focus rõ, no financial/PII card;
   - loading/error/offline retry, reduced-motion.
3. Admin/dev APIs/UI:
   - set effective-dated rate, no-overlap;
   - attendance review/correction bằng reversal + reason;
   - balance derived;
   - settle-all preview, cutoff/high-watermark, method/reference/reason;
   - settlement history/detail/reversal.
4. Chuẩn hóa rate thành half-open `[effective_from,effective_to)` ở DB/service/schema/UI; migration preflight
   phải abort nếu dữ liệu cũ tạo overlap/ambiguous boundary. Query rate dùng `effective_to > occurrence_date`,
   không dùng `>=`.
5. Sửa ledger constraints bằng migration forward:
   - partial unique chỉ cho một `EARNING` gốc trên mỗi attendance;
   - ADJUSTMENT/REVERSAL liên kết entry gốc và không bị unique theo `entry_type` chặn correction hợp lệ;
   - unique request_id cho earning command và settlement command;
   - global unique `ledger_entry_id` trong settlement items cho mô hình settle-all, hoặc nếu chủ đích cho
     partial allocation thì dùng row lock + constraint/trigger đảm bảo tổng allocation không vượt entry.
6. Check-in retry phải so khớp cùng staff/occurrence/payload; request_id trùng khác command trả 409, không trả
   dữ liệu của command cũ. Race insert phải bắt unique violation rồi đọc authoritative row trong transaction.
7. Settle-all lock staff ledger, chốt cutoff/high-watermark, chỉ lấy earning chưa allocation, insert settlement
   + items atomically. Retry cùng request/payload trả cùng settlement; khác payload trả 409. Earning sau cutoff
   không được lọt vào settlement cũ; hai settlement đồng thời không cùng allocate một ledger entry.
8. Settlement reversal là compensating settlement/ledger event có actor/reason/reference; không UPDATE/DELETE
   settlement/items cũ và không làm mất traceability của lần trả tiền.
9. Teacher chỉ xem own attendance/earning summary nếu nghiệp vụ cho phép; không thấy rate của người khác.
10. Quy tắc tính tiền bất biến: mỗi cặp `(staff_id, occurrence)` tạo tối đa một EARNING. Số tiền bằng đúng
    `StaffCompensationRate` hiệu lực của chính giáo viên đó tại ngày buổi học, được snapshot vào attendance;
    nếu hai giáo viên cùng dạy thì tạo hai EARNING độc lập, mỗi người nhận đủ mức riêng, tuyệt đối không chia
    tiền theo số giáo viên và không có rate theo lớp. Migration 077 có trigger DB chặn staff/amount mismatch.
11. Lịch sử thay đổi giáo viên theo buổi được ghi append-only ở migration 076 (`ASSIGNED|REMOVED|REPLACED`),
    có snapshot tên, actor, lý do và request id; projection hiện tại chỉ dùng để xác định quyền chấm công.

### Phase I — Payment request sớm, student reference và Pay2S scaffold

1. Đồng bộ PaymentRequest ORM FK/index/check với migration.
2. Tạo/revoke/expire payment request server-side, reference unique gắn đúng fee obligation và student code snapshot. Cho phép quản trị tạo mã tham chiếu trước hạn trong cửa sổ giới hạn; mã chỉ là payload provider-neutral, không tự gửi, không tự báo và không tự ghi sổ.
3. Ghi nhận tiền mặt sớm là command explicit hai bước, dùng cùng ledger/idempotency/row-lock với thanh toán thường; payment origin phải là `manual_early`; tạo tiền hoặc QR không được đánh dấu `notified_at`.
4. Feature flags mặc định `provider=disabled`, ingress=false, auto_post=false, QR=false; startup fail closed nếu cấu hình
   mâu thuẫn.
5. Chưa tạo route Pay2S live. Viết interface/adaptor contract và threat model cho hai flow Pay2S khác nhau,
   đánh dấu deferred.
6. Không log full account/transfer content/student contact; reference là opaque lookup token. Khi due-date bị đổi do hoãn hoặc khoản được ghi nhận tiền mặt, mọi mã OPEN liên quan phải chuyển REVOKED bằng event append-only; request hết hạn phải chuyển EXPIRED trước khi tạo mã mới.

### Phase J — Pagination, cache, near-real-time và UI polish

1. Cursor pagination + bounded search cho classes/students/fees/reports/payroll; không load all rồi filter Python.
2. Fee page render summary/list trước; transaction/refund history lazy theo dialog/row, lỗi history không chặn trang.
3. Thay broad invalidation bằng exact query key/cache patch từ server response; finance vẫn refetch authoritative row.
4. Không dùng process-local cache cho PII/domain state. Query DB indexed hoặc shared version cache có invalidation.
5. Không prefetch route teacher bị cấm; role change/logout clear cache ngay.
6. UI theo `ui-ux-pro-max` và design language hiện có:
   - dense desktop management, hierarchy rõ, không trang trí dư;
   - field labels luôn thấy, validation on blur rồi live khi sửa;
   - notice xanh cho info, lỗi field đỏ inline, blocking error có retry;
   - slide/modal 150–300ms, hỗ trợ `prefers-reduced-motion`;
   - không horizontal page scroll, không mất chữ/layout jump/skeleton sai;
   - touch target 44px ở teacher mobile và thao tác quan trọng.

### Phase K — Security, ops, cleanup

1. Threat model: role escalation, BOLA/IDOR, replay, double mutation, webhook spoof scaffold, export injection,
   stale cache after role change.
2. Route×role generated matrix phủ 100% OpenAPI; teacher guessed UUID tests trả 403/404 an toàn.
3. RLS/FORCE/revoke anon/authenticated cho bảng mới; runtime DB role có least privilege cần thiết.
   Test role BYPASSRLS không được dùng để chứng minh RLS browser.
4. Sửa disposable runner comment/role/grants mâu thuẫn; tránh `GRANT ALL` nếu chỉ cần SELECT/INSERT/UPDATE cụ thể.
5. Chuyển FastAPI deprecated `on_event` sang lifespan để dọn warning và lifecycle rõ.
6. Fix pytest cache permission; không chấp nhận warning môi trường che evidence.
7. Ghost cleanup chỉ sau `rg` + import graph + package/CI reference proof:
   - old viewer branches;
   - old fee period identity;
   - enrollment boundary helpers;
   - eager history loaders/broad invalidations;
   - probe scripts chỉ xóa nếu package/CI không gọi;
   - không xóa historical migrations.
8. Update `REPORT_DOMAIN_R7.md`, ADR/schema diagram, route matrix, migration hashes, perf evidence.

## 4. File impact tối thiểu phải audit

- Backend core: `principal.py`, `dependencies.py`, `billing*.py`, `class_dates.py`, `occurrence.py`.
- Models: user/invitation/staff link/attendance/enrollment/fee/payment request/service credit/schedule slot/student.
- Routers: toàn bộ `backend/app/routers/**`, không chỉ file mới.
- Services: enrollment, fee, reconciliation, class, suspension/credit, staff, attendance/payroll, invitation/auth.
- Schemas: auth, student, enrollment, fee/report, attendance/payroll, suspension.
- Migrations/tests SQL: `054–069` chỉ đọc; tạo forward migration mới + verify/disposable runner update.
- Frontend auth/session/shell/nav/settings; classes/students/fees/report/staff/teacher attendance/payroll.
- Query prefetch/query keys/cache invalidation/export.

## 5. Definition of implementation complete

Implementation chỉ xong khi:

1. Không còn P0-01…P0-10.
2. Tất cả nghiệp vụ §2 có test production-path.
3. Tất cả gate `test.md` xanh, không có skipped mandatory test.
4. `goal.md` không còn checkbox bắt buộc mở.
5. Report nêu rõ deferred duy nhất: kết nối Pay2S live/credential/sandbox và migration Supabase thật.
6. Docker build/health chỉ chạy ở gate cuối; sau đó mới mời người dùng vào localhost test.

## 6. Bổ sung R8 — bộ chọn lịch lớp tách khỏi phân công giáo viên

### 6.1 Hợp đồng nghiệp vụ và phạm vi

- Màn hình **Thiết lập lịch học tuần** trước hết chỉ chọn các khung giờ của **lớp đang tạo/chỉnh sửa**.
- Không dùng tab/phạm vi giáo viên để thay đổi hit-test của lưới và không yêu cầu người dùng chọn một giáo viên trước khi tô lịch.
- Giáo viên/trợ giảng được phân công riêng ở panel của từng buổi sau khi khung giờ đã được chọn. Không tự động đổi lịch lớp khi chuyển người phụ trách.
- Giữ nguyên toàn bộ quy tắc thao tác đã được nghiệm thu: click đơn chỉ tạo mốc chờ, đủ hai block liền kề mới tạo buổi tối thiểu 60 phút, kéo xuôi/ngược, xoá từ đầu/cuối, giới hạn tối đa 4 buổi, pointer capture, keyboard và confirm.

### 6.2 Trạng thái lớp khác trên lưới

- `occupiedSlots` là nguồn sự thật cho các lớp khác đã có lịch trong phạm vi ngày. Mỗi block 30 phút giao với một slot của lớp khác có trạng thái `busy`.
- Busy block phải có màu nền trung tính, nhãn lớp ngắn, `cursor-not-allowed`, `aria-disabled="true"`, tooltip/accessible label “Khung giờ đã có lớp khác”. Không cho pointerdown, click, keyboard Enter/Space hay drag bắt đầu/đi xuyên qua block này.
- Không dùng trạng thái “tất cả giáo viên phù hợp đều bận” để khoá lưới nữa; đó là logic của mô hình cũ và không được hiển thị trong bộ chọn lịch lớp.
- Các block đã thuộc lớp đang chỉnh sửa vẫn là vùng của draft, được phép thu/ngắn/xoá theo quy tắc cũ và không bị overlay lớp khác che mất.
- Ô trống và ô draft giữ đúng màu, caret/focus ring, endpoint marker và animation cũ; chỉ thay đổi affordance của block bận để người dùng nhận biết ngay trước khi rê/click.

### 6.3 Tách UI phân công theo buổi

- Giữ nguyên bố cục bảng lịch cũ: lưới ở bên trái và panel phải có tiêu đề **“Danh sách chi tiết”**. Không hiển thị tab Tổng quan/tên giáo viên hay màn hình điều hướng “Phân công buổi” trong class add/edit.
- Mỗi thẻ trong danh sách chi tiết hiển thị trực tiếp ngày/giờ, nút xoá và chip giáo viên của chính buổi đó. Chip giáo viên cho phép thêm/bỏ từng người; xung đột chỉ phản hồi trong thẻ tương ứng. Có thể có nhiều giáo viên cùng dạy một buổi.
- Trợ giảng chỉ hiển thị trong thẻ buổi theo dữ liệu đã chọn, không tạo thêm bước phân công mới. Không lặp chip tên trong từng ô lưới, không làm tăng chiều cao hàng hoặc tạo horizontal scroll.

### 6.4 Kỹ thuật và an toàn

- Hit-test UI dùng cùng block canonical `day/start/end` đã trả về; không suy đoán từ màu hoặc tên lớp. Backend vẫn tái kiểm tra xung đột khi lưu.
- Busy chỉ chặn thao tác chọn lịch, không sửa/xoá dữ liệu lớp khác và không ghi thêm dữ liệu khi hover.
- Giữ `pointer-events-none` cho overlay hiển thị để target thật là button bị khoá; nhờ đó cursor/aria/title của cell hoạt động nhất quán và keyboard focus có thể bỏ qua cell bận.
- Bảo toàn reduced-motion, focus-visible, nhãn aria và vùng tương tác tối thiểu 44px. API
  availability có scope tường minh `selected_staff|all_classes`; không thay đổi schema
  nghiệp vụ/lịch sử. Form lớp dùng `all_classes` để khóa mọi lớp khác kể cả khi chưa
  chọn pool nhân sự; route vẫn management-only và backend recheck khi lưu.

## 7. Bổ sung R8 — performance gate và migration 078

### 7.1 Runner disposable bắt buộc chạy 078

- Cả `run_disposable_db.py` và `run_disposable_db.ps1` chạy đúng thứ tự:
  `001..077 → perf_scale_dataset → perf_scale_assert → perf_scale_analyze → EXPLAIN before 078
  → 078 → EXPLAIN after 078 → verify_migration_078 → 078 idempotency (lần hai) →
  verify_security`.
- Không đánh dấu 078 thành công chỉ vì exit code 0: phải kiểm tra `pg_indexes` +
  `pg_index.indisvalid`/`indisready` (acceptance probe trong `verify_migration_078.sql`).

### 7.2 Scale fixture P3

- `perf_scale_dataset.sql` là fixture riêng (không thay `perf_dataset.sql`): 1.000 lớp
  (650 active / 100 scheduled / 150 completed / 100 cancelled), ≥70% canonical
  non-LEGACY, 5.000 học viên, 200 nhân sự, ≥50.000 fee_records với nhiều cycle cùng
  tháng và đủ trạng thái UNPAID/NOTIFIED/PAID/VOID/SUPERSEDED + payments ledger khớp.
- Không tắt trigger/RLS để ép dữ liệu. Lớp completed/cancelled dùng `LEGACY` vì trigger
  044 chặn backdate non-LEGACY khi INSERT; ghi rõ lý do này trong fixture và assert.
- `perf_scale_assert.sql` đếm theo prefix `PerfLop %`/`PerfHV %`/`PerfGV %` để cô lập
  khỏi fixture migration; `perf_scale_analyze.sql` chạy `ANALYZE` trước EXPLAIN.

### 7.3 Quy tắc EXPLAIN trước/sau

- `perf_explain_078.sql` dùng `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)`,
  query phải đủ điều kiện để partial index 078 áp dụng (identity_scheme <> 'LEGACY' +
  date range / status='UNPAID'). Mỗi query 3× warm-up, 30× warm, 5× cold; lưu p50/p95/p99,
  plan node, index dùng.
- Không ép planner bằng `enable_seqscan=off`. Nếu planner chọn Seq Scan trên bảng nhỏ,
  ghi rõ lý do.
- Gate: list/search ≤300ms p95, availability/preview ≤500ms p95, không tăng >20% so
  baseline, không N+1.

### 7.4 Migration 078 — quy tắc index concurrent

- 078 **đã** chuyển sang `CREATE INDEX CONCURRENTLY` (phải chạy ngoài transaction) vì
  Supabase production thật có bảng `fee_records` lớn và không nên dừng ghi để lấy
  maintenance lock. Mỗi index là statement top-level; DO block acceptance chỉ đọc
  metadata (pg_indexes + pg_index.indisvalid/indisready), không sửa dữ liệu.
- Idempotency: `create index concurrently if not exists` an toàn chạy lại; concurrent
  build lỗi để lại index `indisvalid=false` — runbook phải dò `pg_index` và drop index
  invalid trước khi retry, không chạy lại mù quáng.
- Không đổi tên index sau khi đã chạy trên bất kỳ môi trường nào.
- Runbook promote: `backend/scripts/promote_078_supabase.ps1` (chỉ chạy thủ công bởi
  operator; không tự động hoá Supabase thật; không in password/DSN).

### 7.5 Quyết định pagination trước virtualization

- Pagination/cursor là giải pháp chính; chỉ thêm `@tanstack/react-virtual` (không dùng
  react-window) khi vượt ngưỡng: viewport >200 dòng, DOM >2.000 node row, render >50ms,
  INP >200ms, hoặc báo cáo/lịch sử >500 dòng/1 view. Không virtualize lịch 31×7.
- Phase 8 Playwright perf gate: `npm run test:e2e:perf` (chromium) kiểm tra không request
  trùng cùng query key, pending button ≤100ms/không layout jump, first usable content
  prompt, mutation click trùng chỉ tạo 1 request.
- Phase 9 pytest perf gate: `pytest tests/integration -m performance` trên scale DB kiểm
  tra query-count (list ≤12, availability ≤8, occurrences/preview ≤12, detail/history ≤12,
  student ≤12, không vượt MAX_SQL_PER_REQUEST) + concurrency 10/20/50 không race/duplicate/
  pool timeout. Lưu ý: `Class` entity có 7 relationship `lazy="selectin"` gây eager-load
  cố định (không N+1) — list/detail/history đã suppress bằng `noload`; preview/history
  cần nhiều bảng nên gate được nới theo bằng chứng thực.

### 7.6 Preview hoãn — giữ hai request mặc định

- Mặc định giữ effective occurrences + suspension preview chạy song song (UX đã có một
  trạng thái loading chung). Chỉ gộp thành một endpoint khi benchmark chứng minh đồng
  thời: p95 wall giảm ≥20%, SQL count giảm ≥1, payload không tăng >15%, CPU không tăng
  >15%, vẫn retry độc lập, không tạo response lỗi khó hiểu hơn.

### 7.7 Artifact và rollback

- Mỗi vòng đo tạo run ID `r8-perf-YYYYMMDD-NNN`, lưu `manifest.json` (git commit,
  SHA-256 migration 078, PostgreSQL version, danh sách migration, dataset version —
  không ghi password/DSN/token), `schema-before/after`, `explain-before/after`,
  `endpoint-results.json`, `playwright-results.json`, `locks.csv`, `report.md`.
- Rollback 078 = `drop index if exists ix_fee_records_unpaid_enrollment; drop index if
  exists classes_scope_browse_idx;` — không ảnh hưởng dữ liệu.
- Không xóa `perf_dataset.sql`, `perf_explain.sql`, `perf_measure.py` hay migration lịch
  sử vì chúng vẫn là bằng chứng audit.
