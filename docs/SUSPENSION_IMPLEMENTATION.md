# Hoãn lớp và hoãn riêng học viên — bàn giao triển khai

## Sửa giao diện tạm nghỉ theo phản hồi 13/09/2026

- Hồ sơ mở từ lớp nào chỉ thao tác enrollment của lớp đó; bỏ dropdown chọn
  lớp và fallback enrollment đầu tiên. Hồ sơ không có ngữ cảnh lớp không hiện
  tab tạm nghỉ. Tên hiển thị trong hồ sơ: **Tạm nghỉ học**.
- Dùng FormField, FormDialogBody/Footer, Button và PendingActionButton của TPRO:
  nút 32px, footer cố định, một vùng cuộn ẩn scrollbar, loading dots dùng chung.
  Tạo/Xác nhận là hành động xanh; Xem tác động là nút phụ. Nút tạo trước preview
  chỉ xem trước, không tự ghi dữ liệu. Đổi bản nháp đang nhập có xác nhận bỏ thay đổi.
- Không validation khi vừa focus/đang nhập. Báo lỗi ngày sau khi bấm thao tác;
  lý do chỉ bắt buộc khi xác nhận lưu. Textarea dùng padding dọc 8px; bộ lọc năm
  dùng `cn` để loại xung đột `w-full`/`w-24`.
- Tái hiện viền đỏ + vòng xanh bằng computed styles: Tailwind 3 không tạo màu
  alpha như mong muốn từ token màu CSS var với `/15`. Style form dùng chung
  chuyển sang `color-mix` cho focus/error, giữ nguyên màu thương hiệu và vòng 1px.
- Ô ngày trống dùng placeholder native; ô đang nhập dở vẫn dùng guide có kiểm
  tra prefix, không nối `yy` sau ngày bị xóa mất thành phần. Kiểm tra ảnh caret
  trống/có ngày và font/line-height/caretColor trên Chromium + Firefox.
- Preview API cho phép lý do rỗng; fingerprint chỉ loại lý do của bản nháp,
  vẫn kiểm tra trạng thái học phí/lịch nghỉ. Apply vẫn yêu cầu lý do, lưu audit;
  payload chống trùng vẫn bao gồm lý do: dùng lại request_id với lý do khác trả 409.
- Xác minh: 675 frontend unit pass; type-check + lint các file sửa pass;
  30 PostgreSQL integration pass trên DB biệt lập; 34 browser cases pass trên
  Chromium/Firefox (mock API), gồm hồ sơ thực với hai enrollment và mobile 375px.
  Không ghi dữ liệu học viên thật trong quá trình kiểm thử.
- Đã build và cập nhật backend/frontend localhost sau sửa: cả hai container
  healthy; `/health/ready` và `/login` HTTP 200; kiểm tra log startup không thấy
  ERROR/Traceback/500. Không chạy migration. Chưa thao tác lưu bằng tài khoản
  admin trên dữ liệu thật; các bài kiểm tra tương tác phía trên dùng mock API.

Thông tin rollout schema dưới đây là đợt triển khai trước phần sửa giao diện.

Cập nhật 13/09/2026 khoảng 16:11 giờ Việt Nam: **đã rollout schema 128–131
và backend/frontend lên localhost sau phê duyệt**. Hai container healthy,
readiness/login/trang gốc HTTP 200, không có dấu lỗi startup trong kiểm tra.
Preflight nguồn `ready=true`; toàn bộ số đếm bất thường và ngày chờ đều bằng 0.

Điểm chặn dữ liệu cũ 6C1 đã xử lý theo phê duyệt: bổ sung nguồn lịch thứ Hai
và hai snapshot từ liên kết nhân sự tồn tại trước lúc hoãn, có audit sửa metadata.
Giữ nguyên trạng thái chờ bù và ngày giờ; không sửa khoản thu hay lịch thu.
Nghiệm thu tương tác sau đăng nhập của admin vẫn là bước riêng, chưa tuyên bố đã chạy.

## Hợp đồng TPRO

- Hoãn dịch vụ bảo lưu ngày nghỉ và dời lịch thu; không thêm tùy chọn nghỉ vẫn thu như cũ.
- Hoãn riêng thuộc một lượt học trong một lớp (enrollment), không dừng các lớp khác của học viên.
- Khoảng nghỉ là `[ngày bắt đầu nghỉ, ngày học lại)`. Ngày học lại không tính nghỉ.
- Ngày nghỉ chung/riêng trùng nhau chỉ tính một lần; cắt theo thời gian ghi danh và trừ khoảng đã miễn thu.
- Không sửa kỳ 0, khoản đã báo thu/có giao dịch, hoặc lịch sử thu/hoàn tiền.
  QR đã gửi/đã thanh toán cũng bảo vệ khoản thu, kể cả khi `notified_at` chưa có.
- Dời một buổi/học bù không tự tạo thêm bảo lưu. Hoãn riêng không dừng lớp,
  chấm công giáo viên hay tự trừ tiền công.
- Xem trước chỉ đọc → xác nhận → khóa và kiểm tra lại → ghi nhận nguyên tử.
  Gửi lại cùng yêu cầu trả cùng kết quả; sửa/hủy tạo bút toán bù, không xóa lịch sử.
- Đây là nghiệp vụ riêng TPRO, không có bộ máy chính sách cho nhiều trung tâm.

## Trạng thái kế hoạch

- [x] A. Lịch hiệu lực dùng chung cho chấm công, học bù và hoãn; snapshot slot/nhân sự.
- [x] B. Tách hoãn dịch vụ/dời buổi; chuẩn hóa ngày và preview/confirm hoãn lớp.
- [x] C. Hợp khoảng nghỉ; sổ GRANT/REVERSAL và mốc áp dụng bù trừ.
- [x] D. Hoãn riêng: tạo, gia hạn, học lại sớm, hủy nhập nhầm, báo muộn có lý do.
- [x] E. Kết nối mốc thu, miễn thu, ngày ghi danh, rời/chuyển lớp, QR và báo cáo.
- [x] F. Giao diện, thử lại an toàn, giữ bản nháp và danh sách có lọc/phân trang.
- [x] G. Unit, PostgreSQL biệt lập, quyền, cạnh tranh, browser và production build.
- [x] H. Công cụ preflight chỉ đọc và hướng dẫn rollout/khôi phục.
- [x] Rollout schema và ứng dụng, preflight nguồn, Docker health và HTTP smoke.
- [ ] Admin nghiệm thu thao tác nghiệp vụ sau đăng nhập trên localhost.

## Những luồng đã kết nối

| Luồng | Xử lý hiện tại |
| --- | --- |
| Hoãn riêng | Thuộc đúng enrollment; báo muộn có cảnh báo/lý do; không sửa lại chấm công quá khứ. |
| Hoãn cả lớp | Xem buổi bị ảnh hưởng và ngày thu từng học viên; snapshot lịch/giáo viên/học viên tại lúc xác nhận. |
| Gia hạn/học lại sớm/hủy | Xem trước số buổi nghỉ/khôi phục, phần ngày tăng/giảm; kiểm tra lại lịch và chấm công dưới khóa. |
| Trùng hoãn lớp và riêng | Tính hợp ngày, không cộng hai lần; bỏ một nguồn vẫn giữ phần được nguồn kia bảo lưu. |
| Học phí MONTHLY/COURSE | Chọn kỳ gia hạn theo coverage/revision/segment thực tế; không suy ra từ số kỳ toàn cục. |
| Đổi mốc thu tạo/thay khoảng miễn thu | Xem trước phần bảo lưu tăng/giảm, ký vào fingerprint; ghi bù cùng giao dịch đổi mốc. |
| Ngày vào lớp thay đổi qua khoảng hoãn | Chặn rõ bằng `ADMISSION_SUSPENSION_REVIEW_REQUIRED`; không âm thầm đổi tiền trong thao tác học thuật. |
| Rời/chuyển lớp | Cắt quyền bảo lưu theo ngày rời; phần bù nằm ở lượt học cũ; gọi lại không bù hai lần. |
| QR chưa gửi | Thu hồi QR không còn phù hợp khi đổi hạn; thao tác cùng giao dịch cập nhật phí. |
| QR đã gửi/đã thanh toán | Giữ khoản cũ; chuyển bù sang kỳ còn chỉnh được hoặc ghi chờ xử lý. |
| Lịch thu đang chờ xác nhận | Vẫn ghi nhận bảo lưu; không tự tạo kỳ thu thay quyết định chưa được admin xác nhận. |
| Lịch nghỉ rất xa | Chấp nhận mốc hợp lệ, có thể ghi ngày chờ; không tạo hàng chục năm khoản thu chỉ để tìm kỳ đích. |
| Báo cáo | Đúng lượt học/workspace; tách kết quả tại lúc xác nhận với số ngày hiện tại, hiển thị lệch cần đối chiếu. |
| Chấm công và lịch bù | Dùng lịch slot hiệu lực theo ngày; nhận cả buổi bù có ngày gốc ngoài cửa sổ đang xem. |

### Các giới hạn có chủ đích

- Mỗi khoảng hoãn tối đa 120 ngày. Ngày học lại phải sau ngày bắt đầu và trong
  ranh giới hoạt động/ghi danh mà API kiểm tra. Hoãn lớp mới không nhận ngày bắt đầu quá khứ.
- Không tự khôi phục buổi đã qua/đã chấm công, đã xếp/học bù, hoặc có xung đột nhân sự.
  Preview nêu lý do; trường hợp này cần đối chiếu nghiệp vụ riêng, không lách bằng xóa lịch sử.
- Không quy ngày bảo lưu ra tiền hoàn, không tự mang ngày còn lại sang enrollment khác.
- Nếu không có kỳ hợp lệ để bù, giữ số ngày chờ (có thể âm khi cần giảm phần đã cấp).
  Bảng báo cáo ghi rõ; không sửa khoản protected để ép số chờ về 0.
- Dữ liệu hoãn cũ thiếu bằng chứng được đánh dấu `LEGACY_REVIEW`; không tự đoán rằng
  mọi lần dời buổi trước đây đều là hoãn toàn dịch vụ.
- Snapshot lịch/nhân sự được giữ cho các buổi đã hoãn; đây không phải nâng cấp
  toàn bộ mô hình thành hệ thống version hóa mọi lần sửa giờ của lịch lớp.

## Giao diện và thao tác

- Học viên → chọn đúng lớp/lượt học → **Hoãn riêng** → ngày nghỉ/ngày học lại/lý do
  → **Xem tác động** → xác nhận đã kiểm tra → **Xác nhận**.
- Lớp → **Hoãn lớp**: xem trước tự động khi ngày hợp lệ; phần ngày thu từng học viên
  được mở khi cần. **Điều chỉnh lần hoãn đã có** để gia hạn/học lại sớm/hủy.
- Danh sách quản lý 10 dòng/trang và lọc năm; ô năm cho xóa/nhập lại, không truy vấn
  năm mới khi người dùng mới nhập được một phần.
- Báo cáo học phí của lượt học có mục **Hoãn và bảo lưu ngày học**, 20 dòng/trang,
  lọc năm ghi nhận theo giờ Việt Nam hoặc tất cả năm, mới nhất trước.
- Thử lại sau mất mạng, HTTP 408/429/5xx hoặc mất phiên dùng nguyên mã yêu cầu.
  Mã lưu trong bộ nhớ phiên theo workspace + tài khoản + đối tượng; tải lại tab
  không tạo lệnh mới. Không rõ kết quả thì khóa bản nháp cho tới khi kiểm tra được.
- Dữ liệu phiên hỏng không cho tự gửi lệnh mới; cần đối chiếu báo cáo trước.
  Lỗi dọn bộ nhớ/cache sau khi API đã xác nhận không biến thành một giao dịch thất bại.
- Skill `ui-ux-pro-max` được dùng để kiểm tra nhãn, thông báo đúng thời điểm,
  xác nhận tác động, bước phục hồi lỗi và bảo vệ nội dung chưa lưu; giữ hệ giao diện TPRO.

## Bằng chứng kiểm thử ngày 13/09/2026

Các số sau là kết quả đã chạy, không phải ước tính:

- Backend tổng hợp: **1.041 passed, 1 skipped, 12 deselected**, 256,21 giây.
  Chạy với `-m 'not performance'`; 12 benchmark quy mô lớn không nằm trong lượt này,
  ca browser opt-in còn skip. Một cảnh báo Starlette/httpx hiện có, không phải lỗi test.
- PostgreSQL `tpro-r4-ci` / `tpro_r3`, cổng 54329; migration **128–131 chỉ áp dụng ở đây**.
  Runtime test NOSUPERUSER/BYPASSRLS: kiểm tra scope ORM và trigger ghi xuyên workspace;
  không tuyên bố role BYPASSRLS bị RLS chặn mọi câu SELECT thô. Role trình duyệt
  `anon`/`authenticated` không có quyền đọc/ghi hai bảng hoãn mới.
- Bao gồm race/replay/stale, MONTHLY/COURSE, trùng nguồn ở cả hai thứ tự,
  miễn thu sau hoãn, đóng enrollment, bảo vệ QR gửi/chưa gửi, chờ lịch thu,
  ngày rất xa, bất biến receipt, không đảo quá số đã cấp, không gán vào kỳ 0/lượt học khác.
- Báo cáo được kiểm tra với hai học viên cùng lớp: bút toán riêng do rời lớp
  chỉ xuất hiện ở đúng học viên, kể cả tổng dòng và phân trang.
- Query-count integration: preview lớp **18 truy vấn** ở cả 1 và 10 học viên;
  đọc lịch hiệu lực **4 truy vấn** ở cả 1 và 6 lớp. Đây là kiểm tra số truy vấn,
  không phải chứng nhận tải lớn hay cam kết thời gian đáp ứng production.
- Frontend: **675 unit passed**, TypeScript và ESLint các file trong phạm vi đạt.
- Playwright: **26/26 passed**, Chromium + Firefox, mock API biệt lập; có tải lại
  sau mất phản hồi cho cả tạo hoãn lớp/điều chỉnh lớp/hoãn riêng, kiểm tra mobile 375px,
  giữ bản nháp khi quay lại và retry sau HTTP 408/429. Không coi mock UI là E2E dữ liệu thật.
- `npm run build`: thành công, 23 trang. Đây là source production build,
  **không phải Docker rebuild/restart localhost**.

Bằng chứng cục bộ (gitignored): `artifacts/suspensions/backend-full.xml`,
`boundaries-final.xml`, `attendance-membership.xml`; ảnh browser ở
`frontend/test-results/`. Kết quả này thay thế các lượt lỗi fixture/thiếu browser trước đó.

### Điều chỉnh kiểm thử cũ

Không xóa test để đạt kết quả xanh. Fixture học bù được thêm slot chuẩn/selection,
giữ assertion tài chính/quyền/cạnh tranh. Probe cấp quá số ngày được chuyển khỏi
kỳ 0 để thực sự kiểm tra overflow (kỳ 0 nay bị guard chặn sớm, có test riêng).
Unit đóng enrollment mock ranh giới bảo lưu mới và kiểm tra dependency được gọi.
Assertion đóng workspace được mở rộng để bảo vệ cả bản nháp hoãn. Các sửa đổi
nghiệp vụ mốc thu có sẵn trong working tree được giữ, không xóa file untracked như ghost code.

## Hướng dẫn preflight và triển khai (lịch sử chuẩn bị)

`backend/scripts/check_suspension_readiness.py` chỉ đọc, không migration/repair,
không in thông tin cá nhân hoặc DSN. Chọn DB qua `DATABASE_URL` hoặc `--dsn`.
Script trả 0 khi đạt, 1 khi có mục cần rà soát, 2 khi không kiểm tra được.

Lần chạy cuối trên **DB fixture biệt lập**: đủ bảng/cột/trigger schema 131;
0 enrollment có tổng bảo lưu âm, 0 event bị cấp vượt. Gate trả `ready=false`
vì 12 hoãn legacy cần rà và 103 exception thiếu nguồn chuẩn trong dữ liệu fixture
cũ/đối kháng; 67 event còn phần chờ (chờ tự nó không làm fail gate).
Không sửa/xóa fixture để che kết quả. **Đây không phải kiểm tra dữ liệu vận hành.**

Trình tự sau khi có duyệt rollout:

1. Chốt bản nguồn và khoảng bảo trì; không cho ghi nghiệp vụ trong lúc thay schema.
   Xác nhận đúng database, schema hiện tại, role migration và role runtime;
   không in cấu hình kết nối/khóa bí mật vào nhật ký.
2. Sao lưu đầy đủ dữ liệu/schema/quyền cần khôi phục; lưu checksum và thử restore
   vào database biệt lập. Không coi chỉ tạo được file dump là đã kiểm tra phục hồi.
3. Trên bản restore, áp dụng theo thứ tự **128 → 129 → 130 → 131**, bằng role
   migration của môi trường đó. Script disposable Python đã có chuỗi đến 131;
   chưa lấy việc sửa danh sách migration làm bằng chứng role owner thật đã chạy đạt.
4. Chạy preflight; đối chiếu từng nguồn legacy/exception không đủ bằng chứng với
   admin trước khi rollout. Không tự sửa khoản đã báo/đã thu, không gán bừa teacher/slot.
5. Kiểm tra mẫu lớp tháng/khóa: tạo hoãn riêng, trùng hoãn lớp, sửa nhiều lần,
   đổi mốc sinh miễn thu, QR gửi/chưa gửi, chuyển/rời lớp, báo cáo và chấm công.
   Chụp đối chiếu ngày thu/sổ bảo lưu trước-sau. Giải quyết gate lỗi trước khi đi tiếp.
6. Chỉ sau khi các bước trên đạt mới áp dụng migration lên DB đích rồi build/recreate
   backend + frontend đồng bộ. Kiểm tra readiness, đăng nhập, route mới và smoke UI.
   Không khởi động source backend 131 trên DB 127.
7. Nghiệm thu với admin trên localhost; theo dõi xung đột 409, số ngày chờ,
   lệch báo cáo, QR và chấm công. Ghi thời điểm/bản build/backup vào tài liệu này.

Khôi phục: ưu tiên bản vá tiến và giữ sổ bất biến. Nếu phải restore backup,
dừng toàn bộ ghi trước, xác định giao dịch phát sinh sau backup để đối chiếu;
khôi phục cả DB lẫn phiên bản backend/frontend tương ứng. Không rollback bằng
cách xóa bảng, tắt trigger tài chính hoặc chạy lại source cũ trên schema không khớp.

### Diễn tập ban đầu sau phê duyệt 13/09/2026 (điểm dừng đã được giải quyết)

- Backend/frontend đang dừng từ trước lượt rollout; chưa khởi động lại.
- Backup `backups/pre-independent-dates-20260913T075440Z/database.dump`, 947882 bytes;
  SHA256 `c939b7aa44bccfbfdc1260d014ed3dd40235ac92b09adc826e4227acc59bdbd1`.
  Kết nối maintenance khớp runtime; archive list và giải mã toàn bộ đạt.
- Khôi phục `public/auth/ops` bằng `--single-transaction --no-owner --no-privileges`
  trên PostgreSQL 17, container `tpro-restore131-approved`, không mạng/không port.
  Chuẩn bị namespace và extension cục bộ; không bỏ qua lỗi/FK hay sửa dump.
  Đây không phải phục hồi đầy đủ dịch vụ Supabase/storage/realtime/vault hoặc role/ACL.
- `verify_rollout_restore.py`: số dòng và checksum 91 bảng khớp trước migration
  (phép kiểm tra hiện loại hai cột additive M127 như các lần diễn tập trước).
- Migration 128–131 chạy thành công trên bản restore dưới role
  `tpro_migration_rehearsal` NOSUPERUSER/BYPASSRLS. M128 phân loại 1 bản ghi OCCURRENCE.
- Preflight bản sao: 0 legacy pause chưa phân loại; 0 số bảo lưu tổng âm;
  0 event cấp vượt; 0 event chờ; **1 exception thiếu canonical source**.
- Bản ghi `aee80a5d-fbcd-4856-9735-e9f6a9f91cb6`, lớp 6C1,
  ngày 07/09/2026 17:00–18:30 giờ Việt Nam: `MAKEUP_PENDING`, chưa có ngày bù,
  `source_slot_id=NULL`, 0 staff snapshot. Audit chỉ có `batch-created`.
  Lớp còn hoạt động và có 2 slot trùng khung giờ; chưa dùng lịch hiện tại để đoán
  giáo viên lịch sử. Cần admin xác nhận thực tế trước mọi sửa dữ liệu nghiệp vụ.
- **Nguồn chưa áp dụng migration 128–131, không sửa khoản thu/chấm công/bản ghi hoãn.**
  Không bỏ gate này để build/restart cho xong. Khi tiếp tục, xác minh nguồn không
  thay đổi; nếu đã thay đổi thì tạo backup và diễn tập mới trước rollout.

### Hoàn tất rollout 13/09/2026

- Backup mới trước sửa nguồn: `backups/pre-independent-dates-20260913T083813Z/database.dump`,
  947882 bytes, SHA256 `54db4d12afdd72b30d12f9dbd7f52365ea9b7ce2f8dffe2daeac1ec9416906a0`.
- Restore backup mới vào baseline biệt lập; `verify_rollout_restore.py --strict-rows`
  xác nhận 91 bảng khớp, **không loại cột nào**. Phạm vi public/auth/ops,
  không phải phục hồi đầy đủ mọi dịch vụ Supabase hay toàn bộ role/ACL.
- Script `repair_6c1_exception_source.sql` được chạy thử hai lần trên bản sao:
  chỉ 2 staff snapshot và 1 audit `correction-recorded`; giữ `MAKEUP_PENDING`.
  Slot duy nhất theo thứ/ngày/giờ, version 1; liên kết staff có trước exception,
  revision hiệu lực xác nhận cùng nhân sự. Không suy đoán buổi đã học/hủy.
- Áp dụng 128–131 và repair trên nguồn bằng runner kiểm tra backup checksum/identity.
  Checksum trước/sau của fee records, billing revisions, payments, nội dung cũ của
  credit events/allocations không đổi. Các cột bổ sung không bị nhầm là thay tiền.
- Kiểm tra nguồn sau rollout: đủ bảng/cột/6 trigger; 0 legacy cần rà,
  0 thiếu canonical source, 0 số dư âm, 0 cấp vượt, 0 event chờ; `ready=true`.
- `docker compose up -d --build backend frontend` thành công. Hai service healthy;
  backend `/health/ready`, frontend `/login` và `/` HTTP 200. Kiểm tra log startup
  không thấy Traceback/ERROR/Exception/500. Không bật thêm provider bên ngoài.
- Container khôi phục tạm được dừng sau kiểm tra, không công bố cổng; giữ backup
  và bản sao để đối chiếu. Chưa commit/push. Không chạy ghi thử nghiệp vụ trên dữ liệu thật.
