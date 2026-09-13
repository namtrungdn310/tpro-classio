# Hoàn thiện đổi mốc thu học phí — 12/09/2026

## Đợt khắc phục COURSE tiếp nối — đã hoàn tất kiểm thử tự động

**Trạng thái mới nhất:** đã hoàn tất khắc phục và kiểm thử tự động trên mã hiện tại, gồm PostgreSQL thật biệt lập và browser/API có xác thực. Các kết quả rollout bên dưới thuộc đợt trước. Đợt COURSE này chưa deploy/recreate backend hoặc frontend, không chạy migration, không sửa dữ liệu vận hành. Nghiệm thu thủ công của người dùng và cập nhật bản localhost là bước riêng tiếp theo.

### Các thay đổi trong working tree

1. **Kỳ cuối thuộc lịch cũ được giữ lại:** tính giá phần kỳ đã thỏa thuận trước khi cắt coverage theo ngày dừng; không tự giảm giá gói chỉ vì dừng lớp. Khoảng lẻ đã thỏa thuận vẫn tính theo khoảng lẻ, không biến thành gói đủ. Áp dụng nhất quán ở planner và bộ sinh đoạn lịch cũ.
2. **Sửa mốc tương lai nhập nhầm:** thêm `replace_future_waivers`, mặc định false. Chỉ cho thay khoảng miễn thu có ngày bắt đầu sau hôm nay và thuộc lịch có generation floor chưa tới. Khoảng miễn đã bắt đầu, quyết định VOID, khoản có tiền và lịch sử revision không bị xóa. Khi không còn khoảng đủ điều kiện, yêu cầu kiểm tra lại.
3. **Preview/audit:** plan version 3 lưu riêng khoảng miễn được giữ và bị thay. Revision mới lưu tập miễn thu hiệu lực; command lưu `effective_waived_intervals` để đọc lịch sử cũ không khôi phục nhầm phần miễn đã thay. Không sửa revision lịch sử. UI liệt kê khoảng bị tác động, bỏ preview cũ khi đổi lựa chọn, khóa lựa chọn khi chưa biết kết quả lưu và retry cùng command.
4. **Mô tả COURSE:** hiển thị số tuần/số ngày, không diễn đạt “cùng ngày hàng tháng”. Chọn ngày áp dụng vẫn tiến tới biên kỳ phù hợp; gói 4 tuần giữ đúng bước 28 ngày qua tháng/năm nhuận.
5. **Đổi thời lượng gói:** khóa theo lớp → học viên → lượt học → khoản phí → yêu cầu thanh toán; nạp lại khoản phí và payments sau khi chờ khóa. Giữ eager-loaded relationships của lượt học để tránh lazy-load trong async. Fingerprint bao gồm trạng thái, số tiền, coverage, hạn thu và phiên bản khoản, không chỉ ID. Khoản có lịch sử payment được bảo vệ. SUPERSEDED chỉ có superseded_at, không ghi nhầm voided_at.

### Bằng chứng nghiệm thu (không cộng các lượt chạy trùng nhau)

- Backend cục bộ: **811 passed, 202 deselected, 1 warning** với `pytest -m 'not db_integration and not performance' -q --tb=short`. Các ca PostgreSQL/performance bị loại, không tính là đạt. Warning là deprecation Starlette/httpx có sẵn.
- **Lượt tổng hợp cuối: 1.000 passed, 1 skipped, 12 deselected, 1 warning trong 327,12 giây**, lệnh `pytest -m 'not performance' -q --tb=short` với `RUN_DB_INTEGRATION=1` và runtime/owner fixture ở `127.0.0.1:54329/tpro_r3`. Gồm 811 unit và 189 integration đạt; không cộng thêm 21 ca trọng tâm đã chạy riêng. Một skip là browser acceptance opt-in, đã chạy riêng bên dưới. 12 ca performance bị loại có chủ đích; không tuyên bố đã benchmark tải lớn trong đợt này.
- Frontend: **662/662 unit đạt**; build production bao gồm TypeScript đạt; ESLint ba file UI/API/E2E thuộc đợt này đạt.
- **46/46 Chromium + Firefox đạt** trong 1,7 phút: `playwright test billing-date-field.spec.ts billing-dates.spec.ts billing-schedule-panel.spec.ts billing-fees-browser.spec.ts billing-report.spec.ts --project=chromium --project=firefox --reporter=line`. Bao gồm xác nhận thay miễn thu, đổi lựa chọn hủy preview, timeout/retry cùng command, ngày áp dụng riêng, hai hình thức thu và tra cứu báo cáo. Đã xem ảnh Chromium 375px ở lượt kiểm tra UI trước: không tràn ngang. Đây là harness/mock API, không phải phiên đăng nhập vận hành của người dùng.
- **Browser → Next proxy → API xác thực → PostgreSQL: 5/5 kịch bản đạt**, do `tests/integration/test_billing_browser_acceptance.py` chạy và kiểm tra đủ số ca; pytest ngoài báo **1 passed trong 40,60 giây**. Dùng `RUN_BILLING_BROWSER_E2E=1`, tài khoản fixture và API riêng cổng 8019. Không override auth dependency, không kiểm thử đăng nhập Google/TOTP qua UI.
- Lượt PostgreSQL chẩn đoán trước từng dừng ở **101 passed, 1 failed** vì test COURSE còn kỳ vọng cùng ngày trong tháng. Test được sửa thành biên 28 ngày; lượt tổng hợp cuối đã đi qua toàn bộ nhóm này không lỗi. Kiểm thử thời lượng gói sau chỉnh khóa/nạp dữ liệu cũng đạt, không còn lấy kết quả lượt cũ làm blocker.
- **21/21 ca tích hợp trọng tâm đạt** trước lượt tổng hợp: đổi liên tiếp xa → gần → xa → quá khứ → gần, giữ lịch sử/không hồi sinh miễn thu khi mở session mới, worker không tạo trùng, giá kỳ cuối, hoãn lớp, đổi thời lượng sau duyệt và khóa thực bằng `pg_blocking_pids` khi thanh toán đồng thời đổi thời lượng gói. Sau thanh toán, command dùng preview cũ bị từ chối, khoản PAID giữ nguyên và thời lượng lớp chưa đổi.
- Ruff các file backend thuộc đợt sửa đạt. Đã bỏ import dư `uncovered_intervals`. `git diff --check` còn dòng trống EOF có sẵn ở `backend/tests/test_fee_state_machine.py:983`, ngoài phạm vi nên giữ nguyên. Không xóa thay đổi chưa rõ nguồn gốc, không commit/push.

### Checklist và bước tiếp theo

- [x] Chạy lại `tests/integration/test_billing_schedule_decisions.py`, `test_billing_cycles.py`, `test_course_schedule_corrections.py` trên PostgreSQL biệt lập sau sửa khóa/nạp dữ liệu; toàn bộ đạt. Ma trận kiểm tra từng phương án hợp lệ; phương án bị chặn được kiểm tra là bị chặn, không coi là đã apply.
- [x] Chạy hồi quy thanh toán, hoãn lớp, báo cáo, membership và các test Pay2S trong bộ tổng hợp. Các ca Pay2S dùng provider giả/mocks; không gọi nhà cung cấp thật. Kiểm tra khoản có tiền được giữ, ngày bù không phân bổ hai lần.
- [x] Chốt kiểm thử tự động: backend tổng hợp, browser harness và browser/API/database thật đều đạt. Giữ các test cũ (KEEP), mở rộng ma trận/đổi kỳ vọng cùng ngày tháng sang đúng bước tuần cho COURSE (REWRITE); không xóa test để che lỗi.
- [ ] Cập nhật bản ứng dụng localhost khi được yêu cầu và chạy smoke sau build. Không lấy trạng thái healthy của đợt rollout trước làm bằng chứng cho mã hiện tại. Không cần migration mới cho đợt COURSE này; dùng schema 127 hiện có.
- [ ] Người dùng nghiệm thu trên dữ liệu phù hợp sau cập nhật localhost; kiểm thử tự động không thay thế xác nhận nghiệp vụ và không chứng minh không thể có lỗi trong mọi hoàn cảnh.

**Vướng môi trường trước đây đã được giải quyết:** sau khi người dùng đồng ý chạy tiếp, bộ duyệt quyền cho phép chạy PostgreSQL fixture và các lượt trên hoàn tất. Không né cơ chế duyệt quyền, không chuyển sang dữ liệu trung tâm. Container fixture giữ lại để có thể tái kiểm thử; không khởi động lại hoặc cập nhật các container ứng dụng trong lượt nghiệm thu này.

---

Phạm vi: dev/admin đổi mốc của một lượt học; giữ giao diện hiện có. Không triển khai hoãn riêng học viên. Sau khi người dùng đồng ý rollout và sửa FK backup cũ, đã áp dụng migration 127 và cập nhật ứng dụng đang chạy; không sửa các dòng dữ liệu nghiệp vụ. Chi tiết nghiệm thu rollout nằm cuối tài liệu.

## Hợp đồng

- Mốc mới sau ngày bắt đầu lớp; độc lập ngày ghi danh. Không tự tạo nợ trước ngày tham gia.
- Mốc lịch, kỳ áp dụng và hạn thu thực tế là ba thông tin riêng.
- Giữ nguyên khoản có giao dịch tiền; KEEP_CURRENT giữ nguyên cả khoản hiện tại chưa thu.
- Thay thế khoản chưa có tiền phải có preview/audit và thu hồi yêu cầu thanh toán liên quan.
- Truy thu chỉ các kỳ được chọn; khoảng chuyển tiếp theo chính sách WAIVE hiện hành.
- Hoãn lớp có phạm vi hiệu lực; điều chỉnh hạn riêng không lan sang các kỳ sau.
- Options/preview/apply phải thống nhất, retry cùng mã yêu cầu không thực hiện lần hai.

## Tiến độ (chỉ đánh dấu khi đã kiểm tra)

- [x] Bảo vệ khoản giữ lại; ràng buộc ngày; regression tests.
- [x] Chọn kỳ linh hoạt, thống nhất ngày options/preview; hợp đồng API và UI.
- [x] Lịch tương lai/bộ sinh phí; ngày hoãn và hạn riêng; các trang đọc lịch.
- [x] Hai admin đồng thời; QR/Pay2S nhận lại trạng thái sau khóa, callback lặp/đến muộn.
- [x] Báo cáo, trạng thái chờ, audit, cập nhật cache.
- [x] Integration DB biệt lập, E2E, script kiểm tra chỉ đọc, dọn mã dư trong phạm vi thay đổi.
- [x] Backup, khôi phục thử, preflight dữ liệu vận hành, migration 127 và cập nhật bản đang chạy (12/09/2026).

Không coi unit tests hoặc build thành công là nghiệm thu toàn bộ nghiệp vụ. Ghi rõ các phần chưa kiểm chứng tại bàn giao.

## Chi tiết đã triển khai

### 1. Lựa chọn ngày và bảo vệ học phí

- Mốc lịch mới phải sau ngày bắt đầu lớp. Mốc trước ngày ghi danh vẫn là tham chiếu lịch, không tự tạo khoản trước thời gian tham gia.
- Giữ kỳ hiện tại không cắt ngắn coverage và không thay cả khoản chưa thu đang thuộc kỳ hiện tại. Khoản có tiền/giao dịch/hoàn tiền luôn giữ lại.
- Bổ sung ngày áp dụng riêng: chọn kỳ có ngày bắt đầu **vào hoặc sau** ngày nhập. Không hiểu ngày này là hạn riêng của một khoản. Người dùng xem ngày/kỳ/số tiền chính xác rồi mới lưu.
- Cho phép chọn lại kỳ của phương án tiếp tục lịch cũ; gợi ý cho lượt chưa bắt đầu dựa trên ngày tham gia, không mặc định kỳ 0 của một mốc quá khứ.
- Các kỳ truy thu không chọn sẵn. Chỉ API chính sách WAIVE được nhận trong luồng hiện tại; không nhận số tiền chuyển tiếp tùy ý qua API.

### 2. Lịch xa, đổi liên tiếp và ngày bù

- Mốc xa lưu đoạn lịch cũ trong `scheduled_segments`; khi xác nhận chỉ tạo khoản đầu của lịch mới. Worker sinh dần các khoản lịch cũ theo cửa sổ cần xử lý.
- Đổi tiếp trước ngày áp dụng kế thừa đoạn lịch và mức phí đã chấp nhận, không tạo trùng coverage. Khoảng đã miễn được mang theo; kế hoạch cũ trước migration được đọc từ lịch sử command, không sửa lịch sử.
- Khi dừng lớp trước mốc mới, giữ/sinh kỳ cuối của đoạn lịch cũ thay vì bỏ sót vì anchor mới còn ở tương lai.
- Đổi thời lượng gói của lớp kế thừa các đoạn lịch cũ và khoảng miễn thu; không lùi trước ngày bắt đầu áp dụng đã xác nhận. Sau khi duyệt gói mới, đoạn lịch cũ vẫn sinh theo thời lượng cũ cho đến điểm chuyển tiếp.
- Hoãn lớp chọn kỳ theo ngày coverage, không theo số thứ tự tạo. Một khoản tạo trước cho tương lai xa không được hút ngày bù đáng lẽ thuộc kỳ gần.
- Ngày bù có phạm vi hiệu lực theo kỳ; đổi hạn riêng một khoản không kéo các kỳ sau đi theo.
- Ngày bù chưa phân bổ được tính trong preview. Sau xác nhận/worker, phân bổ một lần vào khoản mới đủ điều kiện, không sửa allocation cũ hoặc khoản được giữ. Nếu chưa có khoản mới đủ điều kiện, số dư vẫn nằm trong ledger.
- Migration 127 kiểm tra số dư **gồm dòng allocation sắp thêm**, khóa event để chống phân bổ vượt số dư và kiểm tra cùng lượt học.

### 3. Ghi nhận tiền, dữ liệu chờ và trang liên quan

- Thứ tự khóa thống nhất phí → yêu cầu thanh toán ở các nhánh Pay2S; sau chờ khóa phải đọc lại trạng thái. Đổi mốc còn khóa lớp → học viên → lượt học trước các khoản phí.
- QR của khoản bị thay thế hoặc đổi hạn được thu hồi. Callback đến muộn/khác số tiền/khoản đã thay thế đưa vào đối soát, không tự ghi tiền vào khoản sai.
- Sửa lỗi `resultCode=0` dạng số bị coi là thất bại. Kiểm tra tổng số tiền thực tế của các khoản khớp callback, bên cạnh snapshot trên yêu cầu.
- Callback lặp cùng giao dịch trả lại kết quả đã nhận. Không tạo command/phiếu thu thứ hai vì thử lại.
- Lịch đang chờ được xử lý cùng đổi mốc với version/context và ID đợt chờ. Sửa tải quan hệ sau lưu để tránh lỗi async khi dựng response.
- Danh sách học viên, lớp, tóm tắt mốc thu dùng kỳ thực tế và ngày bù; bỏ SUPERSEDED khỏi dự báo lịch mới. Sau lưu làm mới cache các trang liên quan.
- Báo cáo vẫn là nơi tra cứu khoản/lịch sử. Khung đổi mốc không thêm bảng lịch sử dài hạn.

## Bằng chứng kiểm thử

- Lượt tổng hợp cuối trên PostgreSQL biệt lập: **893 passed, 9 skipped, 1 warning** trong 271,16 giây. Đây là bộ backend unit + integration trên mã đã chốt, gồm cả dừng lớp và đổi thời lượng gói sau đổi mốc; không cộng với số unit hoặc các lượt kiểm thử trước.
- Backend unit: **780 passed**; có các ca callback thành công dạng số/chuỗi, lặp, đến muộn, Partner feed đổi trạng thái khi chờ khóa.
- Frontend unit: **662 passed**. Production build và TypeScript thành công.
- Trong lượt tổng hợp cuối có **113 ca integration đạt**, gồm 31 ca trong bộ ma trận đổi mốc và liên thông. Các skip là nhóm opt-in, không coi là đã kiểm chứng trong lượt này; browser acceptance được chạy riêng bên dưới.
- Pipeline database đã chạy qua tạo schema sạch, runtime role/deny, owner và reapply; không chạy benchmark tải lớn (`--skip-perf`). Sau đó migration 127 bản hoàn chỉnh đã được reapply trên database biệt lập.
- UI: **44/44 Chromium + Firefox**, gồm mobile, nhập/xóa ngày, stale response, timeout, trạng thái chờ, lựa chọn ngày áp dụng riêng. Đã xem ảnh mobile của panel.
- Browser → Next proxy → API xác thực → PostgreSQL: **5/5**, gồm mất response sau commit, đổi hạn khoản, đổi mốc, ngày lớp và ngày ghi danh độc lập. Test này không kiểm tra đăng nhập Google/TOTP qua giao diện.
- Script preflight chỉ đọc chạy được trên database fixture: QR cũ mở = 0, phân bổ vượt số dư = 0, sai lượt học = 0. `ready=false` vì fixture cố ý chứa 47 lượt không có baseline và 1 khoản thiếu coverage; đây **không phải kết quả dữ liệu trung tâm**.
- Lint frontend không có lỗi; còn warning `formatShortDate` chưa dùng trong trang học viên thuộc thay đổi có sẵn. `git diff --check` còn một dòng trống EOF trong test có sẵn ngoài phạm vi; không xóa/chỉnh các thay đổi chưa rõ nguồn gốc.

## Giới hạn và bước đưa vào sử dụng

1. Đã chạy migration `127_billing_schedule_segments.sql` trước khi khởi động backend mới ngày 12/09/2026; không sửa các dòng dữ liệu nghiệp vụ.
2. Trước rollout: backup và xác minh restore, kiểm tra dữ liệu với `check_independent_dates_readiness.py` bằng đúng role/phạm vi cần dùng. Xử lý riêng bất thường được phát hiện; script không tự sửa số tiền.
3. Công cụ migration có `--only-127 --backup <path> --sha256 <digest>` và kiểm tra đúng database/fingerprint. Không chạy công cụ này nếu chưa được phép cập nhật database đó.
4. Chạy migration, backend/frontend build và smoke test có kiểm soát sau khi được phép. Không hạ schema để rollback; có thể quay về bản ứng dụng cũ nhưng giữ cột/ledger bổ sung.
5. Chưa thử giao dịch ngân hàng thật hoặc gửi QR/Zalo; kiểm thử Pay2S ở mức hợp đồng và mô phỏng callback. Không tuyên bố bảo đảm mọi lỗi vận hành đã được loại bỏ.
6. Không triển khai hoãn riêng học viên, không đổi hệ thống thành multi-center, không xóa file khác trong working tree chỉ vì đang untracked.

Môi trường test hiện dùng container `tpro-r4-ci`, database `tpro_r3`, cổng **54329**. Cổng cũ 55437 nằm trong vùng Windows dành riêng sau khởi động lại; không thay cấu hình mạng máy hoặc container ứng dụng để khắc phục. Container test được giữ để tái kiểm tra.

## Điểm tiếp tục sau bàn giao

Mã nguồn và kiểm thử nằm trong working tree, chưa commit/push. Không cần triển khai lại từ đầu. Rollout đã hoàn tất sau khi người dùng đồng ý xử lý riêng FK backup cũ; đoạn dừng bên dưới được giữ làm lịch sử chẩn đoán. Không dùng kết quả `ready` của database fixture để quyết định rollout dữ liệu trung tâm.

## Rollout được cho phép — dừng an toàn trước migration (12/09/2026)

- Xác minh cấu hình database của backend Docker đang chạy khớp cấu hình dùng backup; tài khoản maintenance khớp database runtime.
- Preflight `--before-127` đạt các kiểm tra dữ liệu hiện có, chỉ thiếu đúng hai cột migration 127. Cờ này không bỏ qua các bất thường dữ liệu và không thay đổi tiêu chí readiness sau triển khai.
- Backup: `backups/pre-independent-dates-20260912T012706Z/database.dump`, **947728 bytes**, SHA256 `58f268a92ec24c4fef5c4b2898253ecf7bda33843477c827baa29d1436f33c27`. Đã đọc danh mục và giải mã đầy đủ.
- Đã build hai image backend/frontend thành công, **chưa recreate** dịch vụ. Container ứng dụng cũ vẫn chạy.
- Thử restore thực tế `public`, `auth`, `ops` vào PostgreSQL 17 riêng, không mạng/không mở cổng, `--single-transaction --no-owner --no-privileges`. Không coi đây là restore đầy đủ dịch vụ Supabase (storage/realtime/vault không thuộc thử nghiệm này).
- Restore thất bại tại FK `_migration_051_class_schedule_backup_class_id_fkey`. Giao dịch restore rollback, không sửa backup.
- Chẩn đoán chỉ đọc trên nguồn bằng role bypass RLS: **21 lớp, 13 dòng bảng backup migration 051, cả 13 dòng không còn lớp tham chiếu**, dù FK báo validated. Đây là bất thường tồn tại trong database nguồn, không phải lỗi phân trang/RLS của runtime hay migration 127.
- **Chưa chạy migration 127 trên database nguồn, chưa khởi động bản mới, chưa xóa/sửa 13 dòng lịch sử.** Cần quyết định cách bảo tồn bảng backup lịch sử và xử lý FK trước khi có thể khẳng định bản sao lưu khôi phục được.
- Script `check_backup_restore_integrity.py` chỉ đọc, chỉ xuất số lượng/trạng thái. Bước kế tiếp: thống nhất phương án sửa FK/lưu trữ lịch sử, tạo backup mới, thử restore lại; sau khi đạt mới tiếp tục migration 127 và recreate ứng dụng.

## Rollout hoàn tất sau khi được duyệt sửa FK — 12/09/2026

### Sửa đúng phạm vi và bảo tồn lịch sử

- Người dùng đồng ý gỡ duy nhất FK `_migration_051_class_schedule_backup_class_id_fkey`, giữ toàn bộ 13 snapshot. Không chạy script acceptance/finalization 051, không xóa bảng, không tạo lại lớp đã mất, không thay đổi migration 051 gốc.
- SQL thao tác riêng: `backend/supabase/scripts/051_preserve_orphaned_backup.sql`; không đưa vào chuỗi migration tự động. Kiểm tra đúng loại/bảng/cột của FK, yêu cầu có snapshot mồ côi, khóa trong giao dịch có timeout, kiểm tra checksum snapshot trước/sau. Không đổi ACL/RLS.
- `apply_independent_dates_migrations.py --repair-legacy-051` kiểm tra backup SHA256, danh tính database runtime/maintenance và fingerprint khoản thu/revision. Đã áp dụng thành công; dữ liệu cũ giữ nguyên.
- Kiểm thử SQL trên PostgreSQL biệt lập: tạo lại trạng thái FK validated nhưng 13 dòng mồ côi, chạy sửa và chạy lại; 13 snapshot và RLS không đổi (`tests/sql/verify_051_orphan_backup_repair.sql`).
- 13 dòng vẫn không có lớp tham chiếu, đây là **snapshot lịch sử được bảo tồn**, không phải khôi phục lại 13 lớp hay làm cho rollback 051 tự động trở lại hợp lệ. Script rollback/acceptance 051 cũ vẫn có kiểm tra lớp bị thiếu và sẽ từ chối trường hợp này.

### Backup và khôi phục thử

- Trước sửa FK: `backups/pre-independent-dates-20260912T030831Z/database.dump`, 947728 bytes, SHA256 `9ecab9e3bc0b96714f68053be877044555bfc9775fe532d612c8da77a44ac461`.
- **Backup dùng triển khai**, sau sửa FK và trước migration 127: `backups/pre-independent-dates-20260912T031013Z/database.dump`, 947148 bytes, SHA256 `be3a2d2591968ecc22388a18e2ba302a0a34469b2535f93f37760fe0cbbd3dbf`.
- Đã khôi phục thành công `public`, `auth`, `ops` bằng `pg_restore --single-transaction --no-owner --no-privileges` vào PostgreSQL 17, container không mạng/không mở cổng. Không bỏ qua FK khác hay bỏ bảng backup cũ.
- `verify_rollout_restore.py` đối chiếu số dòng và checksum toàn bộ nội dung **91 bảng** giữa nguồn và bản khôi phục: khớp trước migration, sau chạy/chạy lại 127 trên bản khôi phục, và sau áp dụng 127 trên nguồn. Chỉ loại hai cột revision mới khỏi phép so sánh để kiểm chứng dữ liệu cũ.
- Giới hạn: đây là thử phục hồi dữ liệu ứng dụng/auth/ops, không phải nghiệm thu phục hồi toàn bộ nền tảng Supabase. Owner/ACL và dịch vụ storage/realtime/vault không được tái tạo trong phép thử cục bộ này. Backup đầy đủ vẫn được lưu, không upload/chia sẻ.
- Có thêm `backend-pre127-rootfs.tar` và `frontend-pre127-rootfs.tar` cùng thư mục backup vì Docker không còn image cũ riêng để gắn nhãn. Đây là filesystem xuất từ container trước recreate, **không phải image rollback hoàn chỉnh đã kiểm thử**; cần dựng lại metadata CMD/ENTRYPOINT/ENV/USER và cấu hình Compose khi phục hồi. Không hạ schema 127 để rollback ứng dụng.

### Kích hoạt và kiểm tra cuối

- Migration 127 áp dụng thành công trên nguồn; các khoản thu và revision cũ không đổi.
- Preflight sau migration và sau recreate: `ready=true`, tất cả 7 nhóm bất thường = 0; role bypass RLS nên kiểm tra toàn bộ dữ liệu, không chỉ một phần hiển thị.
- `docker compose build backend frontend` thành công; `docker compose up -d --no-build --wait --wait-timeout 180 backend frontend` thành công, **cả hai healthy**.
- Backend chạy image `c80a84e06a4bb8abf0cf1912d8453f77b9b47d4a1a5ddc5498b36bb8d1bf3153`, frontend `30714f985fb6d261a96f1c77455b0989ccb13c6e7fd67e5f2e5a28fce174db90`.
- Đối chiếu **154 file Python** của backend đang chạy với workspace: khớp SHA256; `independent_billing_dates_enabled=True`.
- `/health/ready` và `http://localhost:3000/login`: HTTP 200. Chạy lại 42 regression tests về đổi mốc, Pay2S và ranh giới hợp đồng: **42 passed**. Các bộ rộng hơn đã được ghi ở phần bằng chứng kiểm thử, không tuyên bố chạy lại tất cả trong lượt rollout.
- Không thử thu tiền thật/gửi QR/Zalo, không thực hiện lệnh đổi mốc vào học viên thật để smoke test. Nghiệm thu tương tác nghiệp vụ dựa trên bộ biệt lập/E2E ở trên; lượt này xác nhận triển khai, schema, dữ liệu và HTTP.
- Đã xóa container khôi phục tạm `tpro-restore127-approved` và volume của nó sau nghiệm thu để không giữ thêm bản sao dữ liệu nhạy cảm; giữ các archive backup trong workspace và không đụng container fixture cũ.
