# Ngày ghi danh và lịch thu độc lập — triển khai có kiểm soát

## Trạng thái

**Rollout hoãn 13/09 đã hoàn tất:** backup mới restore khớp đầy đủ 91 bảng;
migration 128–131 và sửa metadata thiếu của buổi 6C1 đã áp dụng theo phê duyệt,
giữ trạng thái chờ bù và tài chính. Preflight nguồn ready, hai container mới healthy,
readiness/login/trang gốc HTTP 200. Còn admin nghiệm thu sau đăng nhập.
Các trạng thái chưa deploy bên dưới là lịch sử. Xem [chi tiết](SUSPENSION_IMPLEMENTATION.md).

**Đợt hoãn 13/09/2026:** phần kết nối hoãn lớp/hoãn riêng với mốc thu, miễn thu,
QR, rời lớp và báo cáo đã hoàn tất trong source; backend 1.041 ca, frontend 675 unit
và 26 browser ca đạt, production build đạt. Migration 128–131 mới áp dụng trên DB
biệt lập, **chưa rollout bản hoãn lên localhost/dữ liệu vận hành**. Bằng chứng,
giới hạn nghiệp vụ và checklist triển khai ở [bàn giao hoãn](SUSPENSION_IMPLEMENTATION.md).

**Đợt khắc phục rủi ro COURSE tiếp nối — đã hoàn tất kiểm thử tự động, chưa cập nhật localhost:** đã sửa giá kỳ cuối lịch giữ lại, xác nhận thay phần miễn thu tương lai khi sửa mốc nhập nhầm, mô tả chu kỳ theo tuần và khóa/nạp lại dữ liệu khi đổi thời lượng gói. Backend tổng hợp trên PostgreSQL biệt lập: **1.000 đạt, 1 skip browser opt-in, 12 benchmark bị loại**; browser opt-in đã chạy riêng và đạt **5/5** kịch bản. Frontend **662 unit, 46 Chromium/Firefox** đạt, build/TypeScript đạt. Các ca sửa mốc nhiều lần và thanh toán đồng thời đổi thời lượng đã kiểm chứng. Chưa deploy đợt này, không migration hay sửa dữ liệu vận hành. Chi tiết và bước cập nhật localhost/nghiệm thu thủ công ở đầu [bàn giao](BILLING_SCHEDULE_HARDENING.md). Các kết quả healthy dưới đây là lịch sử đợt trước, không áp dụng cho bản COURSE mới này.

**Rollout 12/09 — đã hoàn tất:** sau khi người dùng đồng ý, đã gỡ FK hỏng của bảng backup migration 051 và giữ nguyên 13 snapshot; backup mới khôi phục thành công public/auth/ops, checksum 91 bảng khớp. Migration 127 đã áp dụng, backend/frontend mới đã recreate và healthy, readiness/login HTTP 200. Không sửa các dòng dữ liệu nghiệp vụ. Chi tiết, giới hạn kiểm tra và SHA256 backup lưu trong [bàn giao](BILLING_SCHEDULE_HARDENING.md).

**Bản nâng cấp đổi mốc thu 12/09/2026:** mã nguồn và kiểm thử đã hoàn tất trong working tree, chưa commit/push. Backend tổng hợp 893 đạt/9 bỏ qua; frontend 662 unit, 44 UI, 5 browser/API/database thật đạt trên môi trường biệt lập. **Migration 127 và bản ứng dụng mới đã triển khai lên database/localhost đang sử dụng**; 154 file Python đang chạy khớp workspace, tính năng đã bật. Chạy lại 42 regression tests trong lượt rollout đều đạt. Các mục 09/09 bên dưới là lịch sử đợt trước, không phải kết quả kiểm thử bổ sung của lượt này.

**Cập nhật 09/09/2026:** đã hoàn tất phần triển khai và nghiệm thu tự động của kế hoạch tiếp nối; feedback và checklist được lưu ở mục cuối tài liệu. Migration 126 đã áp dụng trên database test sau backup; dữ liệu khoản thu và billing revisions giữ nguyên. Backend/frontend đã build và recreate lên localhost, cả hai Healthy; `/health/ready` trả ready và `/login` HTTP 200. Giới hạn kiểm tra trực tiếp dashboard được ghi rõ ở phần bàn giao.

Đã triển khai backend/frontend trên localhost và bật tính năng trên database test ngày 07/09/2026.
`INDEPENDENT_BILLING_DATES_ENABLED` mặc định mã nguồn vẫn là `false`; môi trường local đặt `true`.
Backend readiness đạt, frontend `/login` HTTP 200, hai container Healthy. Chưa xác minh tương tác giao diện bằng browser trong phiên triển khai này.

### Kiểm tra triển khai ngày 07/09/2026

- PostgreSQL biệt lập: 763 tests passed, 8 skipped; toàn bộ kịch bản migration/reapply thành công.
- Người dùng cung cấp kết nối quản trị riêng trong file Git-ignored `.env.maintenance`; runtime vẫn dùng tài khoản hạn chế quyền.
- Backup hợp lệ: `backups/pre-independent-dates-20260906T192303Z/database.dump`, 940178 bytes; kiểm tra danh mục và giải mã toàn bộ archive thành công (chưa thử phục hồi archive này vào database khác).
- SHA256: `c0cfa42747d64f10233935f4f9f32f4fada09eef75149a6677028c564ce4c915`.
- Migration 123 đã có; đã chạy 124–125 thành công. Fingerprint toàn bộ fee records (trừ cột mới) và billing revisions không đổi sau migration.
- Preflight bằng cả runtime và tài khoản quản trị: không có ngày ghi danh sai ranh giới, thiếu baseline, kỳ thu thiếu coverage hoặc command đang pending.
- Backend/frontend được build và recreate thành công; tính năng độc lập đã bật. Các archive của lần sao lưu thất bại trước đó không được dùng phục hồi.

## Hợp đồng nghiệp vụ

- `classes.start_date`: mốc hoạt động học thuật của lớp.
- `enrollments.enrollment_date`: ngày ghi danh của lượt học; có `admission_version` chống ghi đè.
- `billing_anchor_revisions.anchor_date`: mốc chu kỳ tài chính độc lập. Không tính lại từ ngày ghi danh sau khi đã có revision.
- `fee_records.adjusted_due_date`: hạn thanh toán thực tế của một khoản. Đổi hạn riêng lưu chênh lệch tại `collection_due_offset_days`; không đổi `base_due_date`, khoảng kỳ học hoặc kỳ sau.
- Khoảng kỳ học là `[coverage_start, coverage_end)`; giao diện hiển thị “trước ngày …” cho đầu cuối loại trừ.

Đổi ngày ghi danh dùng membership contract 4. Đổi ngày lớp dùng contract 2.
Ngày lớp mới không được đi qua lịch sử học thuật đã kết thúc. Chỉ các ghi danh trước ngày lớp mới cần xác nhận ngày thay thế; không tự dời các học viên khác.
Các thao tác học thuật không tạo, huỷ, đổi hạn hoặc sửa khoản thu. Nếu mốc mới mâu thuẫn với kỳ đã tính tiền, yêu cầu đối chiếu trước.
Mức học phí được lưu riêng với thay đổi ngày ghi danh/ngày lớp.

## Lịch thu

GET `/api/enrollments/{id}/billing-schedule` cung cấp revision, khoản hiện có và lịch sử gần nhất.
POST cùng đường dẫn `/preview`, `/apply` dùng đúng một bộ tính kế hoạch.

- `KEEP_CURRENT`: giữ kỳ hiện tại và các khoản được bảo vệ, chọn ranh giới mới phía sau.
- `REPLACE_CURRENT`: thay thế khoản chưa thu/chưa báo trong phạm vi; không bỏ nợ cũ ngoài phạm vi.
- `FROM_CYCLE`: chọn rõ kỳ hiện tại/tương lai. Kỳ quá khứ chỉ tạo khi admin chọn riêng.
- Phần thời gian chuyển tiếp phải được xác nhận thu theo ngày hoặc không thu. Không im lặng bỏ sót khoảng thời gian.
- Thu theo ngày: phân bổ theo từng chu kỳ tháng thực tế hoặc số ngày gói tuần, làm tròn VND một lần mỗi khoảng.
- Kỳ đã huỷ không được sinh lại bởi worker hoặc luồng ngừng lớp.
- Khoản đã thông báo, thanh toán một phần/toàn bộ, hoàn tiền hoặc có sổ giao dịch được giữ nguyên. QR nhóm bảo vệ tất cả khoản thành phần.
- Không tự gửi Zalo, thông báo ngoài hệ thống hoặc yêu cầu thanh toán.

Đổi hạn một khoản dùng `/api/fees/{id}/due-date/preview` và `/apply`. Chỉ khoản chưa có giao dịch tiền được đổi hạn; khoản đã thông báo hiện nhắc báo lại phụ huynh. Audit `due_date_change` hiển thị trong báo cáo.

Apply có `request_id` ổn định và fingerprint SHA-256. Tính lại dưới khoá; fingerprint khác phải xem lại. Timeout giữ nguyên ý định, không tự tạo ID khác. Kế hoạch và các tác động lưu cùng transaction.

## Thứ tự triển khai

1. Xác nhận database test hay production, đúng workspace và người chịu trách nhiệm.
2. Sao lưu database và xác minh có thể đọc/khôi phục bản sao; giữ riêng thông tin bí mật, không commit backup.
3. Bảo đảm các migration trước đó, gồm 123, đã có. Chạy 124, 125 rồi 126 trước khi chạy backend mới. Database đã có 124–125 chỉ cần chạy 126. Không sửa ngược các migration cũ.
4. Chạy `backend/scripts/check_independent_dates_readiness.py` bằng môi trường và role phù hợp. Script dùng transaction read-only, chỉ in số lượng và schema thiếu. Nếu role bị RLS giới hạn, kết quả không đại diện tất cả workspace.
5. Xử lý dữ liệu mâu thuẫn qua đối chiếu riêng: không tự đoán mốc tài chính cho bản ghi cũ, không backfill học phí hàng loạt. Chạy lại preflight.
6. Build và deploy backend + frontend, giữ feature flag tắt; kiểm tra readiness và hồi quy luồng cũ.
7. Bật flag ở môi trường test, kiểm tra trực quan và API theo checklist dưới. Chỉ bật production sau nghiệm thu; không bật tự động theo tên môi trường.
8. Theo dõi lỗi 409/422/500, request treo, khoản bị tạo trùng, chu kỳ chồng lấn và thời gian phản hồi.

Không rollback database bằng DROP cột/bảng hoặc xoá audit. Sau khi có giao dịch theo lịch độc lập, không quay về backend cũ có thể tự lấy ngày ghi danh để tính tiền. Khi có sự cố: chặn thao tác chỉnh ngày/lịch thu, giữ backend tương thích và sửa tiến; không chỉ tắt flag rồi cho phép writer cũ hoạt động.

## Kiểm tra nghiệm thu còn cần trên môi trường triển khai

- Học viên: đổi ngày sớm/muộn, tháng cuối năm, 29/02, ngày cuối tháng; không đổi phí, revision, thông báo hoặc thanh toán.
- Lớp: không học viên; nhiều học viên bị ảnh hưởng; lịch đã thay đổi; có lịch sử chặn. Apply không lưu một phần.
- Phí tháng/gói: chưa tới hạn, đang tới hạn, đã thu, đã báo, thanh toán một phần, QR nhóm, kỳ đã huỷ, nợ cũ, nhiều kỳ trả trước.
- Bản xem trước trở nên cũ khi người khác sửa hoặc có thanh toán mới; phải chặn và giữ dữ liệu.
- Retry sau timeout phải dùng cùng payload/ID; không tạo thêm revision/khoản thu/audit.
- Hoãn lớp sau khi đổi hạn riêng: giữ phần gia hạn riêng, cộng đúng tín dụng hoãn, không dùng số thứ tự toàn cục làm số thứ tự của anchor mới.
- Báo cáo thu tiền không đổi doanh thu chỉ vì đổi ngày; lịch sử hiển thị đủ lý do và hạn trước/sau.
- UI máy tính/mobile: bàn phím, focus, scroll dài, lỗi sát trường, loading, đóng khung khi có draft, xác nhận tác động trước lưu.

## Kiểm thử tự động

### Đợt nghiệm thu bổ sung 07/09/2026

- 708 unit tests backend đạt; frontend 652 tests đạt.
- Pipeline PostgreSQL biệt lập: 783 tests đạt, 8 skipped; toàn bộ migration/reapply đạt (log `artifacts/independent-dates-acceptance-db.log`). Số 783 đã bao gồm unit tests, không cộng dồn với 708.
- Test mới bắt lỗi `has_settlement=True` nhưng `protected=False`: bộ tính kế hoạch nay chặn thay thế khoản có giao dịch ngay cả khi cờ bảo vệ bị lệch.
- Bổ sung 16 tổ hợp hợp đồng cũ/mới và feature flag; bổ sung kiểm tra cuối tháng, năm nhuận, chuyển năm. Test hợp đồng cũ đặt cấu hình rõ ràng, không phụ thuộc `.env` local.
- Sau khi người dùng cho phép Playwright riêng: 16 browser tests Chromium đạt (6 ca mới về hạn thu/lịch thu và 10 ca hồi quy biểu mẫu). Chạy bằng `npx.cmd playwright test form-dialog.spec.ts class-form-billing.spec.ts billing-dates.spec.ts --project=chromium`.
- Các ca mới render component thật, dùng API giả lập: xem trước bắt buộc, sửa draft làm mất xác nhận, retry timeout giữ nguyên payload/request ID, stale preview, viewport mobile, khoảng chuyển tiếp phải có quyết định cho tháng/gói. Không ghi vào database app.
- Đã bổ sung `test_billing_browser_acceptance.py`: runner khởi động FastAPI thật trên cổng 8019, dùng role runtime PostgreSQL và session aal2 được ký/provision riêng trong database tạm, không override dependency xác thực. Request không token bị kiểm tra trả 401.
- 5 ca Chromium/API thật đạt: đổi hạn và đọc audit; mất phản hồi sau COMMIT rồi retry; đổi mốc thu/miễn khoảng chuyển tiếp; đổi ngày lớp; đổi ghi danh v4 và retry. Ca ghi danh dùng browser request client, không thao tác form học viên. Bốn ca đầu dùng component thật trong harness. Chuỗi cuối đã đi qua Next standalone production proxy với cookie phiên test → FastAPI xác thực → PostgreSQL runtime role. Không mock response nghiệp vụ. Toàn bộ trang dashboard và Google/TOTP login vẫn ngoài phạm vi chuỗi này.
- Đối chiếu SQL: 2 ý định đổi hạn tạo đúng 2 command dù có 3 lượt apply; mốc thu có revision mới, revision cũ nguyên vẹn; khoản cũ SUPERSEDED đúng, số tiền/coverage không bị viết lại; ngày ghi danh chỉ đổi bởi command v4 riêng.
- Phát hiện và sửa lỗi thật ở `class_admission_date_service`: rebuild preview phải `exclude_unset=True`, nếu không `class_patch={}` bị bung thành các giá trị null và chặn lưu ngày lớp. Có unit regression và browser regression.
- Hồi quy sau sửa: 785 tests đạt, 8 skipped trên database tạm; test browser integration mới nhất đạt và bắt buộc đủ 5 browser scenarios. Frontend type-check/lint được chạy lại.
- Bản vá backend đã build/deploy lên localhost và container Healthy; test data chỉ tồn tại trong container PostgreSQL tạm.
- Chạy lại end-to-end trên Windows: đặt `$env:RUN_BILLING_BROWSER_E2E='1'` rồi chạy `python scripts/run_disposable_db.py --skip-perf` từ backend. Cần Chromium Playwright và frontend production build sẵn. Không đặt DATABASE_URL Supabase vào runner; runner tự tạo PostgreSQL biệt lập.

- Backend: `python -m pytest tests --ignore=tests/integration --ignore=tests/performance -q`.
- Database biệt lập: `python backend/scripts/run_disposable_db.py --skip-perf` (container `tpro-r4-ci`, không dùng database app).
- Frontend: `npm.cmd test`, `npm.cmd run type-check`, `npm.cmd run lint`, `npm.cmd run build`.
- Preflight môi trường: `python scripts/check_independent_dates_readiness.py` từ thư mục backend. Đây không phải lệnh chạy migration.

### Giao diện hai ô ngày — 2026-09-07

- Bổ sung sau phản hồi: student response trả `billing_anchor_date` từ current billing revision (eager-load theo batch) và version. Ô ngày thu dùng snapshot này ngay khi mở hồ sơ, không chờ API lịch thu riêng và không dùng ngày ghi danh làm ngày thu giả. Nút Chi tiết chỉ chuyển sang LoadingLabel khi sửa ngày hợp lệ. Nút xử lý trong panel cũng dùng LoadingLabel chung. Backend 710 tests đạt; Chromium 9 tests đạt, có ca API lịch thu lỗi nhưng ngày hiện tại và Chi tiết vẫn hiển thị ngay. Build/deploy backend/frontend healthy, không migration.

- Hồ sơ học viên (independent dates): tách Ngày ghi danh và Ngày thu học phí. Ô ngày thu dùng mốc lịch thu hiện tại; không phải thao tác đổi hạn riêng một khoản phí.
- Ngày thu hợp lệ được preview sau debounce 350ms, dùng LoadingLabel chung; hủy request cũ khi đổi ngày. Chi tiết mở khung phải với bản xem trước đúng draft/version. Chưa nhập lý do và xác nhận thì không apply.
- Ngày thu còn chờ xác nhận được tính là thay đổi chưa lưu; nút lưu hồ sơ yêu cầu hoàn tất Chi tiết hoặc trả về ngày cũ, tránh bỏ sót thay đổi tài chính.
- FormDialogShell có placement right tùy chọn; các dialog khác giữ mặc định center. Reuse motion helper, focus trap, scroll body và footer của hệ thống.
- Xác minh: 654 frontend tests đạt; TypeScript và lint các file sửa đạt; 8 Chromium tests (component thật/API giả lập) đạt, gồm response cũ, retry lỗi, ngày trống, mobile 375px, bảo vệ apply tháng/gói. Không chạy lại integration DB trong thay đổi UI này.
- Docker frontend production build và restart thành công; backend/frontend đều healthy. Không đổi backend, migration hay dữ liệu.

## Feedback khung lịch thu — kế hoạch tiếp nối và nghiệm thu 09/09/2026

Đây là bản tổng hợp feedback và quyết định triển khai còn giữ được từ phiên trước, không phải bản chép nguyên văn cuộc trò chuyện.

### Phạm vi đã xử lý

- [x] Một `FormDialogShell` tồn tại xuyên suốt loading/error/nội dung; không remount để chạy lại chuyển động. Focus lúc mở/đóng dùng `preventScroll` để tránh làm lệch khung đang trượt.
- [x] Tiêu đề các cột nằm ngoài viewport cuộn; chỉ các hàng khoản thu cuộn. Cùng cấu hình cột/gutter giữ thẳng hàng. Bảng có nhãn và vai trò truy cập, cuộn bằng bàn phím.
- [x] Trạng thái dùng `StatusPill` chung, gồm đã thu/chưa thu/đã thay thế/đã hủy/hoàn tiền. Khoản được bảo vệ có nhãn riêng, không chỉ phân biệt bằng màu. API trả cả khoản đã thay thế/hủy và số đã thu/hoàn.
- [x] Ngày thu chỉ nhập ở ô ngoài. Khung xem không có nút “Đổi mốc thu”; khung điều chỉnh trình bày ngày cũ → mới, các phương án và kết quả xem trước. Nút Chi tiết dùng màu và LoadingLabel chung, không đổi kích thước khi kiểm tra.
- [x] Xem lịch hiện tại trong khung điều chỉnh không làm mất lựa chọn. Đóng khung giữ ngày ngoài; dirty tracking bao gồm phương án, kỳ đầu, khoảng chuyển tiếp, kỳ quá khứ và lý do.
- [x] Hủy request cũ khi đổi draft. Tái sử dụng phân tích đúng ngày/version thay vì gọi lại khi mở khung. Phân trang lịch sử kiểm tra context token và hủy response khi chuyển phương án; không chọn sẵn kỳ truy thu. Kỳ đầu không hợp lệ bị chặn.
- [x] Apply chỉ dùng preview khớp draft. Timeout khóa lựa chọn và thử lại đúng payload/request ID/fingerprint. Lỗi stale yêu cầu “Kiểm tra lại”, tải lại schedule/version và phân tích trước khi cho xác nhận; không tự gửi lại apply.
- [x] Sửa schema frontend khớp API thật: classification là object; cycle_info có thể null; financial_state dùng đúng trường backend. Chuẩn hóa snapshot tài chính và đọc mới ORM để tránh context token lệch giả giữa preview/apply.
- [x] Giữ các nguyên tắc nghiệp vụ: ngày ghi danh độc lập; khoản được bảo vệ nguyên vẹn; xử lý rõ khoảng chuyển tiếp; chỉ truy thu kỳ đã chọn; lưu đúng một lần; worker sinh đúng kỳ kế tiếp.

### Bằng chứng kiểm thử

- Frontend: 657 unit tests đạt; TypeScript và ESLint đạt; production build đạt.
- PostgreSQL disposable: **824 passed, 8 skipped**, toàn bộ pipeline migration/security/reapply đạt. Số này gồm unit và integration, không cộng dồn với các số đợt cũ. Bỏ qua bộ benchmark hiệu năng (`--skip-perf`).
- Ma trận DB mới: 24 tổ hợp MONTHLY/COURSE × UNPAID/PAID/NOTIFIED × ngày quá khứ gần/xa, tương lai gần/xa. Đi qua options → preview cho từng phương án cho phép → apply → retry cùng command → sinh kỳ tiếp theo. Read-only options/preview không thay dữ liệu; khoản được bảo vệ giữ nguyên từng trường.
- 5 ca Chromium với FastAPI/xác thực/PostgreSQL thật đạt, có mất response sau commit rồi retry và đối chiếu SQL. Test này dùng Next standalone proxy và component harness; không giả lập response nghiệp vụ, không ghi dữ liệu thử vào Supabase.
- Hồi quy UI cuối cùng: **50/50 đạt trên Chromium/Firefox**, gồm phân trang/kỳ đầu không hợp lệ. Có normal motion và reduced motion, mobile 375px, dirty-close, timeout, stale, response cũ. Lệnh: `npx.cmd playwright test form-dialog.spec.ts class-form-billing.spec.ts billing-dates.spec.ts billing-date-field.spec.ts billing-schedule-panel.spec.ts --project=chromium --project=firefox --timeout=30000`.
- Ảnh desktop/mobile được xuất bởi `billing-schedule-panel.spec.ts` dưới `frontend/test-results/`; đã rà trực quan và chỉnh cột hạn thu để không bẻ đôi năm trên mobile.

### Migration 126 và an toàn dữ liệu

- Nguyên nhân: constraint từ migration 058 bắt `SUPERSEDED` phải có `voided_at`, trong khi lệnh thay lịch mới chỉ ghi `superseded_at`. PostgreSQL integration phát hiện thao tác lưu thất bại.
- Migration 126 cho phép replacement có `superseded_at`, đồng thời tương thích audit cũ chỉ có `voided_at`; trạng thái VOID vẫn bắt buộc `voided_at`. Không UPDATE các khoản thu, không viết lại lịch sử.
- Người dùng đã cho phép hoàn tất và chạy migration trên Supabase test. Tài khoản quản trị được xác minh khớp database runtime; không in thông tin kết nối.
- Backup: `backups/pre-independent-dates-20260909T083121Z/database.dump`, **944098 bytes**; SHA256 `ccc607456d58df2e95604f79d0fbc58a569d1338738ff7d581478ff08f2b1c2a`. Đã đọc danh mục và giải mã toàn bộ archive; chưa thử restore archive này vào database khác.
- Chạy `apply_independent_dates_migrations.py --only-126 --backup <path> --sha256 <digest>` thành công. Fingerprint toàn bộ fee records, gồm các cột mới, và billing revisions không đổi trước/sau.
- Preflight runtime: invalid admission boundaries = 0; missing billing baselines = 0; unknown fee coverage = 0; pending commands = 0; ready = true. Kết quả giới hạn theo quyền nhìn thấy của runtime role, không phải nghiệm thu production toàn bộ workspace.

### Ranh giới bàn giao

- Localhost đã cập nhật bằng `docker compose build backend frontend` (frontend rebuild sau chỉnh mobile), rồi `docker compose up -d --wait --wait-timeout 120 backend frontend`. Hai container Healthy; API ready và frontend login HTTP 200. PostgreSQL disposable đã được runner dọn sạch sau kiểm thử.
- Không triển khai production, không gửi Zalo/QR/thông báo, không tạo khoản thu mẫu trên Supabase.
- Google/TOTP login và toàn bộ dashboard thao tác tay không thuộc chuỗi E2E harness đã chạy. Không tuyên bố đã kiểm tra chúng.
- Skill UI/UX Pro Max được dùng để rà lại focus, spatial continuity, loading, nhãn trạng thái và bố cục mobile theo component chung. Skill Browser đã được kiểm tra nhưng không có browser khả dụng; kiểm thử tương tác dựa trên Playwright của dự án, không phải phiên đăng nhập trình duyệt của người dùng.
- Code và tài liệu còn ở working tree; chưa commit/push. Giữ nguyên các thay đổi khác của người dùng trong repository.

## Điều chỉnh trọng tâm mốc thu và chuyển tra cứu sang Báo cáo — 09/09/2026

Quyết định mới của người dùng thay thế hướng đưa danh sách nhiều năm vào khung mốc thu: khu vực này chỉ xử lý khi người dùng đổi ngày. Lịch sử vẫn được ghi đầy đủ, nhưng việc xem/tra cứu thuộc Báo cáo.

### Phạm vi triển khai

- [x] Chưa đổi ngày: chỉ hiển thị mốc hiện tại, không còn nút Chi tiết hoặc chế độ VIEW. Khi đổi ngày mới có “Xử lý thay đổi”; nhập sai/trống không được phân tích hoặc xác nhận và vẫn được tính là thay đổi chưa lưu.
- [x] Khung “Xử lý đổi mốc thu học phí”: lớp/lượt học, ngày cũ → mới, tác động chính, phương án, lựa chọn chuyển tiếp/truy thu khi cần, lý do và xem trước. Không có danh sách khoản thu, lịch sử, bộ lọc năm hay “Xem lịch hiện tại”.
- [x] Xem trước hiển thị khoản dự kiến tạo, số giữ nguyên/thay thế và chi tiết kỳ/số tiền của khoản sẽ thay thế từ snapshot backend. Phần bổ sung chỉ để hiển thị; fingerprint và financial plan không đổi. Truy thu vẫn không chọn sẵn, có giới hạn tải thêm.
- [x] Giữ preview/apply, context/version guard, khoản được bảo vệ, retry cùng command sau timeout, dirty-close và ngày ghi danh độc lập. Thành công đóng khung/cập nhật ngày; không tự mở báo cáo.
- [x] API `/enrollments/{id}/billing-schedule/summary` chỉ trả trạng thái mốc, phiên bản và chu kỳ; không đọc hoặc trả danh sách phí/lịch sử. Phân tích tài chính vẫn dùng đầy đủ context riêng, không dùng dữ liệu phân trang.
- [x] Báo cáo có mục “Khoản thu & mốc thu” (`/report?view=billing`): tìm học viên/lớp, chọn đúng lượt học (gồm lượt đã kết thúc), xem khoản thu và lịch sử đổi mốc. Danh sách lượt học, khoản thu và lịch sử đều phân trang 20.
- [x] Khoản thu sắp theo đầu kỳ → cuối kỳ → hạn thực tế → ID, mới nhất trước mặc định; thiếu đầu kỳ dùng hạn thu, thiếu ngày xếp cuối. Lọc năm hiện tại/tất cả năm, trạng thái, hiện khoản đã hủy/thay thế; nhắc khoản chưa thu các năm trước. Năm này là năm của kỳ, không phải năm thanh toán.
- [x] Lịch sử đổi mốc lọc theo năm thực hiện ở Asia/Ho_Chi_Minh; hiện người thực hiện (hoặc thông báo khi tài khoản không còn thông tin), thời điểm, mốc cũ/mới, lý do, kết quả và mã lệnh. Chỉ hiển thị command BILLING_SCHEDULE_CHANGE đã hoàn tất; không trộn với đổi hạn từng khoản. Sổ thu/nhật ký/đối soát hiện có giữ nguyên.
- [x] API báo cáo nằm dưới `/reports/billing/enrollments`, `/{id}/fees`, `/{id}/history`; dùng quyền quản lý và workspace boundary. Không tạo báo cáo tổng thể nhân sự/học viên/lớp mới ngoài phạm vi đã chốt.

### Rà soát ghost code/file

- Xóa `ScheduleViewMode`, nhánh VIEW, icon/import lịch sử, state mở lịch hiện tại và prop preview đầu vào không còn nơi sử dụng. Đổi callback `onDetails` thành `onReview`.
- Di chuyển `billing-fees-browser.tsx` và `billing-fees-table.tsx` từ students sang reports, không giữ bản sao. Schema/API tra cứu được chuyển sang `billing-reports.ts`, tách khỏi `billing-dates.ts`.
- Xóa endpoint phân trang mới đặt dưới billing-schedule/fees; endpoint có trách nhiệm tương ứng nằm ở reports. Cập nhật test/harness và thêm test kiến trúc để ngăn tái đưa bảng tra cứu vào khung xử lý.
- Giữ GET billing-schedule cũ vì vẫn được dùng trong kiểm thử/API tương thích. Không xóa migration, audit, dữ liệu nghiệp vụ, backup hay các thay đổi ngoài phạm vi chỉ vì chúng chưa commit.
- Không thêm dependency hoặc migration. Chưa commit/push.

### Nghiệm thu đợt này

- Frontend: 660 unit tests đạt; production build/TypeScript đạt. Đã rà ảnh mobile của khung xử lý và mục báo cáo theo skill UI/UX Pro Max (phân tách nhiệm vụ, thông tin xác nhận, focus/loading, bố cục).
- Hồi quy UI cuối sau cleanup: **56/56 Chromium/Firefox đạt**, gồm form dialog/lớp, đổi mốc, danh sách trong Báo cáo, lọc năm lịch sử độc lập, đổi bộ lọc nhanh, retry, khung chỉ xử lý và không gọi API báo cáo, mobile và chuyển động thật. Lệnh: `npx.cmd playwright test form-dialog.spec.ts class-form-billing.spec.ts billing-date-field.spec.ts billing-dates.spec.ts billing-schedule-panel.spec.ts billing-fees-browser.spec.ts billing-report.spec.ts --project=chromium --project=firefox --timeout=30000`.
- PostgreSQL disposable: **827 passed, 8 skipped**, pipeline migration/runtime/security/reapply đạt (`RUN_BILLING_BROWSER_E2E=1`, `run_disposable_db.py --skip-perf --keep`). Bao gồm 5 kịch bản browser/API/xác thực thật; đã kiểm tra API báo cáo từ chối request không đăng nhập và đọc được lịch sử đổi mốc vừa áp dụng. Test dữ liệu 10 năm kiểm tra phân trang/thứ tự/bộ lọc; test 25 điều chỉnh kiểm tra mốc giao năm giờ Việt Nam, workspace isolation và snapshot tài chính không đổi khi đọc. Ma trận đổi mốc kiểm tra chi tiết khoản thay thế khớp chính xác plan.
- TypeScript/production build, ESLint, Ruff các file backend sửa và `git diff --check` đạt. Không chạy bộ benchmark hiệu năng đầy đủ.
- Localhost đã build và cập nhật bằng Docker Compose; backend/frontend Healthy, `/health/ready` trả ready và trang login HTTP 200. Container PostgreSQL disposable đã được xóa sau kiểm thử. Không migration hay ghi dữ liệu thử lên Supabase.
- Kiểm thử tương tác dùng component harness của dự án và Next standalone proxy; không tuyên bố đã thao tác Google/TOTP hoặc toàn bộ dashboard bằng phiên đăng nhập của người dùng. Các thay đổi vẫn ở working tree, chưa commit/push.

### Sửa gợi ý ngày và cảnh báo sớm khi nhập mốc thu — 09/09/2026

- Nguyên nhân `yy` thừa: gợi ý dùng độ dài toàn chuỗi để cắt `dd/mm/yyyy`, nên xóa ngày/tháng ở giữa vẫn nối phần năm vào cuối. Chỉ nối gợi ý khi chuỗi là phần đầu đúng cấu trúc ngày; `/08/2026` và `01//2026` không còn ký tự gợi ý thừa. Ô trống vẫn gợi ý đầy đủ định dạng.
- Bỏ dòng đỏ “Nhập mốc thu hợp lệ hoặc trả về ngày hiện tại” trong lúc xóa/nhập dở. Chỉ hiện hướng dẫn xác nhận khi ngày mới đã hợp lệ; giữ thông báo lỗi phân tích thực tế từ server. Ngày chưa hợp lệ vẫn chặn xử lý, không gọi phân tích và vẫn được theo dõi là thay đổi chưa lưu.
- Theo rà soát UI/UX, phản hồi không coi thao tác nhập dở là lỗi. Không đổi quy tắc tính phí, backend hoặc dữ liệu.
- Xác minh: 661 unit tests, 14 ca Chromium/Firefox (bao gồm xóa riêng ngày/tháng, xóa toàn bộ, nhập lại, kiểm tra không có `yy` thừa/cảnh báo sớm), TypeScript/build và ESLint các file sửa đều đạt. Frontend Docker đã build/cập nhật; trang login HTTP 200. Không chạy lại bộ kiểm thử backend vì không sửa backend.
