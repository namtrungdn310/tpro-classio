# Kế hoạch hoàn thiện trang Học viên trước staging / production

> Trạng thái: đã triển khai mô hình ba phạm vi; phần kiểm thử và migration được ghi ở cuối tài liệu.
>
> Ngày rà soát: 25/08/2026.
>
> Phạm vi: trang Học viên, hồ sơ học viên, ghi danh lớp, mã học viên, học phí, QR/Pay2S, báo cáo/Excel, audit, hiệu năng, bảo mật và dọn ghost code liên quan.

## 0. Kết luận điều hành

Hệ thống **đã có nền tảng đúng** cho hai yêu cầu chính:

- Mỗi học viên được database cấp một mã bất biến, ví dụ dạng lưu trữ `TP000000018`, dạng hiển thị `TP-0000-0001-8`.
- Backend và frontend dùng đúng ba phạm vi nghiệp vụ: `UNASSIGNED`, `CURRENT`, `STOPPED`. Lịch sử từng học không tạo thêm một tab riêng.
- Có thể tạo hồ sơ không gắn lớp ở backend; học viên rời lớp vẫn giữ hồ sơ, mã và lịch sử; hồ sơ lưu trữ có thể khôi phục.
- QR/Pay2S không dùng mã học viên đơn lẻ. Mỗi yêu cầu thanh toán tạo một nội dung duy nhất theo dạng `student_code + P + random suffix`, rồi đối soát chính xác nội dung, số tiền và tài khoản nhận.

Tuy nhiên, trang Học viên hiện tại vẫn là giao diện **class-first** và chưa đưa các khả năng này đến người dùng:

- Desktop chưa có cột mã học viên; Excel danh sách học viên cũng chưa xuất mã.
- Không thể tạo hồ sơ nếu chưa chọn lớp.
- Không có giao diện riêng cho hồ sơ chưa xếp lớp, đã rời lớp hoặc lưu trữ.
- Không có thao tác lưu trữ/khôi phục ở frontend.
- Một số hợp đồng frontend/backend và giao dịch liên miền chưa an toàn để đưa thẳng lên production.

Vì vậy, không nên chỉ thêm một cột hoặc vài tab. Cần hoàn thiện theo thứ tự: **sửa tính đúng nghiệp vụ và tính nguyên tử trước, sau đó mở UI vòng đời hồ sơ, rồi mới tối ưu tải và dọn code**.

## 1. Những gì đã xác minh từ code hiện tại

### 1.1. Mã học viên đã tồn tại và là hợp đồng chính thức

Nguồn sự thật:

- `backend/supabase/migrations/055_student_codes.sql`
- `backend/supabase/migrations/069_contract_cleanup.sql`
- `backend/supabase/migrations/083_workspace_audit_and_student_code.sql`
- `backend/app/core/student_code.py`
- `backend/tests/integration/test_student_code_integration.py`
- `backend/tests/integration/test_profile_lifecycle.py`
- `dev.md`, mục mã học viên và payment reference

Hợp đồng đã có:

- Định dạng lưu trữ: `TP` + 8 chữ số serial + 1 chữ số kiểm tra Luhn, tổng cộng 11 ký tự.
- Định dạng hiển thị: `TP-0000-0001-8`.
- Database tự cấp bằng sequence `NO CYCLE`; client không được tự gửi mã.
- `students.student_code` là `NOT NULL`, unique và bất biến.
- `student_code_registry` giữ quan hệ phát hành 1-1, append-only, có `workspace_id`, FORCE RLS và không mở cho browser role.
- UUID vẫn là khóa kỹ thuật. Mã học viên chỉ là mã nghiệp vụ dễ đọc, không phải secret, bằng chứng xác thực hay idempotency key.

Kết luận: **không tạo lại thuật toán mã học viên và không cho phép admin sửa mã**. Việc cần làm là đưa mã hiện có vào đúng mọi điểm đọc, tìm kiếm, đối soát và xuất dữ liệu.

### 1.2. Liên kết thật giữa mã học viên và QR/Pay2S

Nguồn sự thật:

- `backend/app/services/payment_scaffold_service.py`
- `backend/app/services/pay2s_service.py`
- `docs/PAY2S_DEPLOYMENT.md`

Luồng hiện tại:

1. Học viên có mã ổn định, ví dụ `TP000000018`.
2. Admin tạo yêu cầu thanh toán cho một hoặc nhiều khoản của **cùng một học viên**.
3. Backend sinh `payment_reference` riêng, ví dụ `TP000000018P7K4M2X9Q`.
4. Yêu cầu lưu snapshot mã học viên, tổng tiền kỳ vọng và tài khoản nhận.
5. Pay2S chỉ tự ghi nhận khi giao dịch vào khớp đồng thời:
   - nội dung chuyển khoản chuẩn hóa bằng đúng payment reference;
   - số tiền bằng đúng số tiền yêu cầu;
   - tài khoản nhận bằng đúng tài khoản đã gắn với QR;
   - request còn mở và provider transaction chưa được xử lý.
6. Giao dịch mơ hồ hoặc sai điều kiện đi vào luồng rà soát, không tự đoán.

Điểm cần giữ nguyên: **mã học viên là phần nhận diện ổn định nằm trong nội dung, nhưng mã học viên một mình không đủ đối soát**. Một học viên có thể có nhiều kỳ/khoản thu, nên suffix duy nhất theo request là bắt buộc.

### 1.3. Vòng đời hồ sơ đã có ở backend

Nguồn sự thật:

- `backend/app/schemas/student.py`
- `backend/app/services/student_service.py`
- `backend/app/services/enrollment_service.py`
- `backend/app/routers/students.py`
- `backend/tests/integration/test_profile_lifecycle.py`

Trạng thái danh sách chính thức:

| Trạng thái | Ý nghĩa nghiệp vụ | Điều kiện đích |
|---|---|---|
| `UNASSIGNED` | Hồ sơ đang hoạt động nhưng hiện chưa xếp lớp; có thể là hồ sơ mới hoặc học viên cũ quay lại | Active profile, không có active enrollment trong lớp vận hành |
| `CURRENT` | Đang học ít nhất một lớp vận hành | Có ít nhất một active enrollment trong lớp operational |
| `STOPPED` | Đã ngừng học tại trung tâm và được lưu để tra cứu lịch sử | `students.status = archived` |

Backend cho phép `class_id = null` khi tạo học viên. Trường hợp này vẫn được cấp mã ngay và không tạo enrollment hay học phí. Đây chính là “hồ sơ học viên chưa vào lớp”, không cần dựng một bảng học viên khác.

Khi học viên rời lớp cuối cùng, enrollment chuyển sang lịch sử nhưng row `students` vẫn tồn tại; khi thêm lại lớp sau này, tạo enrollment mới và giữ nguyên mã/hồ sơ cũ.

### 1.4. Giao diện hiện tại chưa phản ánh hợp đồng trên

Nguồn rà soát chính: `frontend/src/app/(dashboard)/students/page.tsx`.

- `openCreateForm()` chặn nếu chưa chọn lớp.
- Form tạo chỉ render khi có `selectedClass`.
- Danh sách desktop bắt đầu bằng cột `Họ tên`, chưa có `Mã học viên`.
- Mobile có hiển thị mã nhưng đang dùng dạng compact thô, chưa dùng format canonical.
- Excel bắt đầu bằng `Họ tên`, chưa có mã học viên.
- Search backend đã nhận exact/prefix code, nhưng placeholder và empty-state UI không nói cho admin biết.
- Frontend chưa có hàm archive/restore và chưa có UI tương ứng.
- Trang hiện chỉ tải các lớp còn enrollable, nên không phải nơi đầy đủ để xem hồ sơ cũ hoặc roster lịch sử.

## 2. Mô hình nghiệp vụ đích

### 2.1. Phân biệt ba khái niệm

1. **Hồ sơ học viên** (`students`): danh tính, liên hệ, mã học viên, ghi chú; tồn tại độc lập với lớp.
2. **Ghi danh lớp** (`enrollments`): một lần tham gia một lớp, có ngày bắt đầu, mức học phí áp dụng, slot đã chọn và trạng thái riêng.
3. **Khách hàng tiềm năng/đơn đăng ký thiếu dữ liệu**: chưa thuộc phạm vi hiện tại.

Chốt cho đợt này: “đăng ký hồ sơ nhưng chưa vào lớp” vẫn là **hồ sơ học viên hoàn chỉnh**, giữ bộ trường bắt buộc hiện tại để nhận diện trùng và liên hệ phụ huynh. Không làm các trường cốt lõi thành nullable chỉ để mô phỏng CRM lead. Nếu sau này cần lưu người quan tâm chỉ có tên/số điện thoại, phải thiết kế entity `leads/registrations` riêng và chỉ cấp mã học viên khi chuyển thành học viên thật.

### 2.2. Chuyển trạng thái hợp lệ

```text
Tạo hồ sơ chưa có lớp
        │
        ▼
   UNASSIGNED ── thêm vào lớp ──► CURRENT
        │                            │
        │ ngừng học                  │ rời/kết thúc/hủy lớp cuối
        ▼                            ▼
     STOPPED                    UNASSIGNED
        │
        └── tiếp nhận lại ──► UNASSIGNED ── thêm lớp ──► CURRENT
```

Quy tắc:

- Một học viên có thể học nhiều lớp cùng lúc; khi không còn active enrollment nào thì về `UNASSIGNED`, lịch sử lớp vẫn được giữ.
- “Rời lớp” chỉ kết thúc một enrollment, không xóa hay lưu trữ hồ sơ.
- “Ngừng học” là thao tác khác, luôn cần lý do và impact preview.
- Hồ sơ `STOPPED` không được ghi danh trực tiếp; phải tiếp nhận lại trước.
- Tiếp nhận lại không tự ghi danh lại lớp cũ.
- Kết thúc/hủy lớp giữ enrollment history và đưa học viên không còn lớp khác về `UNASSIGNED`.
- Mã học viên không đổi qua mọi chuyển trạng thái.

## 3. Kiến trúc thông tin và giao diện trang Học viên

### 3.1. Thanh phạm vi chính

Thiết kế theo cùng ngôn ngữ tab trạng thái của trang Lớp học, không tạo một phong cách riêng:

| Tab | Nội dung | Nút chính |
|---|---|---|
| **Học viên đang học** | Luồng class-first hiện tại | `Thêm học viên` |
| **Học viên chưa xếp lớp** | `UNASSIGNED` | `Thêm hồ sơ` |
| **Học viên ngừng học trung tâm** | `STOPPED` | Không có nút tạo |

Mỗi tab hiển thị count thật từ server. Không tải toàn bộ học viên chỉ để đếm.

Không thêm tab “Tất cả” vào thanh chính để tránh dư. Tìm toàn bộ hồ sơ được thực hiện qua ô tìm kiếm toàn cục và có thể hiển thị nhóm kết quả theo trạng thái; nếu đo lường thực tế cho thấy admin cần một roster hợp nhất thường xuyên mới bổ sung sau.

### 3.2. URL và điều hướng

State quan trọng phải nằm trong URL, ví dụ:

```text
/students?view=class&class_id=<uuid>&student_id=<uuid>
/students?view=unassigned&q=TP-0000
/students?view=stopped
```

Yêu cầu:

- Refresh không mất tab/lớp/hồ sơ đang mở.
- Back/Forward của trình duyệt hoạt động đúng.
- Link từ trang Lớp, Học phí, Báo cáo mở đúng học viên và đúng context.
- Persistent state chỉ dùng làm mặc định khi URL không chỉ định; URL luôn ưu tiên.

### 3.3. Bảng desktop

Thứ tự cột đích:

1. **Mã học viên** — cột đầu tiên, nhãn `Mã HV`, hiển thị `TP-0000-0001-8`, tabular numerals, không wrap.
2. **Họ tên**.
3. **Ngày sinh**.
4. **Trường**.
5. **Lớp / Trạng thái lớp** tùy tab.
6. **Thông tin học viên**.
7. **Thông tin phụ huynh**.
8. **Ghi chú** khi thực sự cần ở scope đó.

Điều chỉnh theo tab:

- `Học viên đang học`: giữ ngày bắt đầu và thông tin enrollment; không lặp tên lớp trong từng row khi lớp đã là context chung.
- `Học viên chưa xếp lớp`: thay ngày bắt đầu bằng ngày tạo hồ sơ; hiển thị trạng thái ngắn `Chưa xếp lớp` khi cần.
- `Học viên chưa xếp lớp`: có thể hiển thị lớp gần nhất và ngày rời/kết thúc gần nhất nếu có lịch sử.
- `Học viên ngừng học trung tâm`: hiển thị ngày ngừng và lý do; thông tin liên hệ vẫn theo quyền hiện hành.

Row click mở khung thao tác bên phải theo đúng pattern đã dùng ở các trang khác. Không thêm cột icon thao tác cố định.

### 3.4. Mobile/tablet

- Dòng đầu: họ tên.
- Dòng ngay dưới: mã đã format, dễ copy.
- Badge trạng thái chỉ xuất hiện khi cần phân biệt scope kết quả tìm kiếm.
- Thông tin liên hệ ưu tiên phụ huynh; dữ liệu phụ được thu gọn.
- Touch target tối thiểu 44 px, không phụ thuộc hover.

### 3.5. Tìm kiếm

Placeholder đề xuất: `Tìm tên, mã học viên, SĐT...`.

Hành vi:

- Chấp nhận `TP000000018`, `TP-0000-0001-8` và prefix đủ dài.
- Kết quả exact code đứng đầu.
- Tìm tên/điện thoại/Zalo/trường vẫn giữ.
- Scope hiện tại là filter mặc định; khi không thấy kết quả, cung cấp một action ngắn “Tìm trong tất cả hồ sơ”.
- Debounce 200–300 ms, hủy request cũ bằng AbortSignal.
- Không báo “không có học viên” trong lúc request mới đang chạy.

### 3.6. Empty, loading và error state

- Skeleton phải giữ đúng khung bảng/card để không nhảy layout.
- Loading ban đầu và background refresh phải khác nhau; refresh không xóa dữ liệu đang xem.
- Empty state theo đúng scope, một thông điệp và tối đa một hành động chính.
- Lỗi có nút `Thử lại`, không chuyển nhầm thành empty state.
- Nếu query vượt trang đầu, dùng “Tải thêm” hoặc infinite loading có kiểm soát; không khóa UI chờ quét hết database.

## 4. Các luồng thao tác đích

### 4.1. Tạo hồ sơ chưa xếp lớp

1. Admin mở `Học viên chưa xếp lớp` và bấm `Thêm hồ sơ`.
2. Form chỉ hiển thị thông tin hồ sơ; không hiển thị ngày bắt đầu, học phí hay slot lớp.
3. Backend kiểm tra trùng trước khi tạo.
4. Database cấp mã; response trả mã bắt buộc.
5. UI báo `Đã tạo hồ sơ TP-....` và mở hồ sơ vừa tạo.
6. Không tạo enrollment, fee record, QR hay payment request.

### 4.2. Thêm học viên từ một lớp

Nút `Thêm học viên` mở bước chọn rõ ràng, hai lựa chọn đồng kích thước:

- **Chọn hồ sơ có sẵn**: tìm theo mã/tên/SĐT trong `UNASSIGNED`, có thể cả `CURRENT` để học thêm lớp.
- **Tạo hồ sơ mới**: nhập hồ sơ rồi ghi danh vào lớp trong **một command nguyên tử**.

Sau khi chọn hồ sơ/tạo mới, bước enrollment mới hỏi:

- ngày bắt đầu;
- mức học phí override nếu có;
- slot/buổi học được chọn;
- impact học phí ban đầu.

Không dùng duplicate conflict làm trải nghiệm chính để tìm hồ sơ cũ; conflict chỉ là lớp bảo vệ cuối.

### 4.3. Thêm lớp cho hồ sơ cũ

- `UNASSIGNED`: action chính `Thêm vào lớp`.
- `CURRENT`: action `Học thêm lớp`.
- Chỉ hiển thị lớp có thể ghi danh.
- Nếu đã có active enrollment cùng lớp, không tạo trùng và thông báo rõ.
- Enrollment mới giữ nguyên student ID, mã, contact và history cũ.

### 4.4. Đổi lớp và học thêm

- **Đổi lớp**: preview lớp nguồn, lớp đích, ngày áp dụng, slot, khoản học phí chịu ảnh hưởng; commit toàn bộ trong một transaction.
- **Học thêm**: chỉ tạo enrollment đích; không động vào lớp hiện tại.
- Không thực hiện chuỗi `update profile -> update enrollments -> create targets -> drop source` bằng nhiều request độc lập như hiện tại.
- Command cần `request_id` để retry không tạo enrollment lặp và `expected_updated_at`/version để tránh ghi đè thao tác đồng thời.

### 4.5. Rời lớp

- Đổi nhãn từ ngữ mơ hồ thành `Rời lớp`.
- Hiển thị tác động trước khi xác nhận: ngày rời, học phí chưa báo, đã báo, đã nộp, QR đang mở.
- Dữ liệu protected không bị xóa/rewrite; dùng correction/compensating workflow hiện hành.
- QR/payment request không còn hợp lệ phải được revoke có audit trong cùng transaction.
- Nếu đây là active enrollment cuối, hồ sơ tự xuất hiện ở `Chưa xếp lớp`.

### 4.6. Ngừng học và tiếp nhận lại hồ sơ

- `Ngừng học` là action thứ cấp, không dùng thay `Rời lớp`.
- Bắt buộc lý do.
- Với học viên còn lớp, phải preview mọi enrollment và nghĩa vụ học phí/QR trước khi cho commit.
- Khuyến nghị an toàn: mặc định yêu cầu rời/xử lý hết lớp trước; chỉ cho “lưu trữ và kết thúc toàn bộ” khi backend có command nguyên tử đầy đủ.
- `Tiếp nhận lại` giữ nguyên mã và history, đưa hồ sơ về `UNASSIGNED`; không tự enroll.

### 4.7. Xử lý hồ sơ trùng

Candidate cần hiển thị:

- mã học viên đã format;
- tên, ngày sinh, trường;
- điện thoại đã mask;
- trạng thái hồ sơ;
- tối đa ba lớp gần nhất;
- đã có trong lớp đích hay chưa.

Các action:

- `Dùng hồ sơ này`;
- `Tiếp nhận lại rồi dùng` nếu hồ sơ đã ngừng học;
- `Vẫn tạo hồ sơ mới` chỉ sau khi candidate fingerprint/version vẫn còn đúng.

Không được để frontend parse lỗi khi backend trả candidate thuộc phạm vi `STOPPED`.

## 5. Liên kết với các phân hệ khác

| Phân hệ | Hợp đồng phải bảo đảm |
|---|---|
| Lớp học | Student profile độc lập; enrollment mới là membership; roster lịch sử vẫn đọc được khi lớp kết thúc/hủy |
| Lịch/slot | Create/update enrollment phải lưu `selected_slot_ids`; slot phải thuộc lớp, còn hiệu lực và không trùng |
| Học phí | Chỉ tạo nghĩa vụ khi có enrollment; profile-only không tạo phí; rời/đổi/archive phải reconcile theo chính sách hiện hành |
| QR/Pay2S | Reference gồm mã học viên + suffix riêng; request snapshot mã, khoản và tài khoản; stale request phải revoke |
| Thanh toán thủ công | Chọn đúng tài khoản nhận; ghi nhận theo fee record/enrollment, không match chỉ bằng mã học viên |
| Hoàn phí | Giữ snapshot mã/tên dù hồ sơ rời lớp hoặc lưu trữ; ledger không phụ thuộc tên hiện tại |
| Zalo học phí | Render từ fee records của cùng học viên/kỳ; mã có thể xuất hiện ở chi tiết nếu nghiệp vụ cần, nhưng không tự thêm nội dung dư vào mẫu |
| Báo cáo | Thêm `Mã học viên` ở các báo cáo theo học viên và drill-down; dùng cùng formatter |
| Excel | Cột đầu `Mã học viên`; giá trị dạng text để giữ nguyên; tiếp tục chống formula injection |
| Dashboard | `active_student_count` phải định nghĩa là `CURRENT`, không phải mọi profile `status=active` |
| Audit | Actor, workspace, lý do, before/after và request id cho create/reuse/enroll/drop/transfer/archive/restore |
| Workspace | Mọi query/count/candidate/code registry/payment request fail-closed theo workspace hiện hành |

## 6. Các lỗi và khoảng trống phải xử lý trước UI

### P0 — chặn staging

#### P0.1. Đồng nhất cách tính list state

Đã hợp nhất quy tắc đọc và SQL filter: mọi active profile không có lớp vận hành hiện tại đều là `UNASSIGNED`; lịch sử cancelled/dropped/completed chỉ là metadata.

Giải pháp:

- Tạo một định nghĩa dùng chung cho `active operational enrollment` và `has historical enrollment`.
- Dùng cùng định nghĩa trong list filter, summary count và response derivation.
- Test riêng trường hợp cancelled-only, legacy class và class đã kết thúc/hủy.

#### P0.2. Sửa lệch hợp đồng selected slot

- Frontend tạo student đang gửi `selected_slot_ids` vào `StudentCreateCommand`, trong khi schema create forbid field lạ.
- Backend create student có lớp không truyền selected slots vào `enroll_locked_student`.
- Backend `EnrollmentUpdate` khai báo selected slots nhưng service update hiện chưa áp dụng.
- Frontend types/schema enrollment chưa khai báo selected slots.

Giải pháp:

- Không nhồi selected slots vào generic profile create.
- Tạo command atomic `create profile + enroll`, hoặc mở rộng command schema có cấu trúc `enrollment` rõ ràng.
- Đồng bộ OpenAPI/Pydantic/Zod/TypeScript và contract tests.
- Update enrollment phải replace slot selections nguyên tử sau validation.

#### P0.3. Gộp thao tác nhiều bước thành transaction

Hiện edit/transfer có thể gọi nhiều API tuần tự, mỗi service commit riêng. Nếu request thứ ba lỗi, profile hoặc một phần enrollment đã thay đổi.

Giải pháp đích:

- Command endpoint cho `enroll`, `transfer`, `add_class`, `leave_class`.
- Lock theo thứ tự ổn định: workspace/student/classes/enrollments/fees/payment requests.
- Preview fingerprint + expiry cho thao tác có impact học phí.
- `request_id` unique/idempotent; retry trả lại cùng kết quả.
- Commit một lần; bất kỳ lỗi nào rollback toàn bộ.

#### P0.4. Đóng lỗ hổng archive với học phí/QR

`archive_student()` hiện đổi trực tiếp active enrollment thành dropped và commit, không đi qua cùng reconciliation/revocation như luồng rời lớp. Cần chứng minh và sửa trước khi mở nút archive ở UI.

Giải pháp:

- Tạo archive impact preview.
- Block archive nếu có protected fee/open payment request chưa có phương án rõ.
- Khi được phép, reconcile nghĩa vụ mutable, revoke request mở và ghi audit trong cùng transaction.
- Không sửa/xóa lịch sử đã báo, đã nộp, hoàn phí hoặc ledger.

#### P0.5. Khóa lifecycle mutation khỏi generic PATCH

`StudentUpdate` hiện cho nhận `status`, trong khi archive/restore đã có endpoint và audit riêng.

- Loại `status` khỏi generic update contract.
- Chỉ thay lifecycle qua command archive/restore/reactivate có actor, reason và audit.
- Audit dữ liệu `inactive` cũ trước khi quyết định migrate hoặc retire.

#### P0.6. Đồng bộ duplicate candidate contract

- Backend có thể trả hồ sơ đã ngừng học; frontend phải nhận đúng trạng thái database và ánh xạ sang `STOPPED`.
- Candidate chưa trả mã học viên/list state, gây khó phân biệt đúng hồ sơ.

Giữ schema hai phía đồng bộ và có contract test cho `UNASSIGNED`/`CURRENT`/`STOPPED`.

### P1 — hoàn thiện nghiệp vụ và UX

- API summary count theo bốn scope.
- API list trả envelope typed: `items`, `next_cursor`, `has_more`, `total/count by scope` nếu cần; không dựa vào custom header làm hợp đồng chính.
- UI tabs, profile-only create, reuse existing profile, archive/restore.
- Formatter mã dùng chung frontend; mọi nơi chỉ format ở presentation layer.
- Cột mã đầu tiên và Excel first column.
- History detail cho hồ sơ chưa xếp lớp/ngừng học; không dựa vào `active_enrollments` để hiển thị lớp cũ.
- Deep link và focus management cho side panel/dialog.

### P2 — hiệu năng, quan sát và dọn sạch

- Cursor/infinite query thật thay vì frontend lặp tối đa 100 trang x 500 để gom toàn bộ.
- Server sorting/filtering; virtualize danh sách khi row hiển thị lớn.
- Query plan và index cho code, list state, enrollment history, search name/phone.
- Telemetry p50/p95, query count, result count, scope, cancellation và error code; không log PII thô.
- Xóa component/helper/type cũ sau khi call site mới và test đã ổn.

## 7. API và dữ liệu đề xuất

### 7.1. Read APIs

```text
GET /students?list_state=CURRENT&class_id=&search=&cursor=&limit=
GET /students/summary
GET /students/{id}
GET /students/{id}/enrollments?scope=all
GET /students/{id}/activity
```

Response list nên là:

```json
{
  "items": [],
  "next_cursor": null,
  "has_more": false
}
```

`StudentResponse.student_code` chuyển thành required/non-null sau readiness check migration 069. Bổ sung `updated_at`/version cho optimistic concurrency.

### 7.2. Write commands

```text
POST /students                         # profile-only
POST /student-enrollment-commands      # create+enroll / enroll existing / transfer
POST /students/{id}/archive/preview
POST /students/{id}/archive
POST /students/{id}/restore
POST /enrollments/{id}/leave/preview
POST /enrollments/{id}/leave
```

Không cần giữ endpoint mới đúng chính xác tên trên nếu convention dự án khác; yêu cầu bắt buộc là command có schema rõ, idempotency và transaction boundary đúng.

### 7.3. Database/migration

- Không chỉnh migration cũ đã chạy; mọi thay đổi dùng forward migration mới.
- Không đổi format/version mã học viên v1 trong hạng mục này.
- Nếu cần tối ưu state filter, ưu tiên index enrollment theo `(workspace_id, student_id, status, class_id)` và query `EXISTS`; không materialize state nếu chưa có bằng chứng query cần.
- Thêm/kiểm tra index search code prefix. Với tên tiếng Việt, benchmark query hiện tại trước; nếu p95 không đạt mới thêm normalized search column/trigram/unaccent có migration rõ.
- Nếu mở rộng lifecycle event action, update check constraint, verifier và append-only acceptance cùng migration.
- Thêm invariant SQL: mọi student có code hợp lệ; registry parity; không có active enrollment của học viên đã ngừng; không có duplicate active enrollment cùng student/class.

## 8. Hiệu năng và tải dữ liệu

### 8.1. Vấn đề hiện tại

`getStudents()` frontend đi theo cursor nhưng gom đến 50.000 row trước khi trả cho page. Cách này làm mất lợi ích keyset pagination, tăng thời gian chờ, memory và khả năng lỗi khi dữ liệu tăng.

### 8.2. Thiết kế đích

- Page size 50–100 row.
- Render trang đầu ngay; tải thêm theo nhu cầu.
- Query key gồm workspace, scope, class, search và sort.
- `keepPreviousData` khi đổi page/filter tương thích để tránh chớp.
- Prefetch có giới hạn cho scope/class có khả năng được mở kế tiếp; không prefetch mọi lớp.
- Student detail/history tải khi mở panel; có thể prefetch lúc row focus/hover nhưng phải dedupe.
- Search request bị supersede phải abort.
- Không dùng process-local cache cho tenant data; cache client phải xóa đúng query key sau mutation.

Ngưỡng nghiệm thu đề xuất trên staging data lớn:

- Trang đầu list p95 API <= 400 ms tại 100.000 hồ sơ/workspace.
- Exact student code p95 <= 150 ms.
- Scope count p95 <= 250 ms.
- Mở detail đã cache <= 100 ms cảm nhận; chưa cache có skeleton, không block list.
- Không request list nào trả hơn page limit hoặc chứa field không dùng.

## 9. Bảo mật, riêng tư và audit

- Chỉ dev/admin có management access theo policy hiện hành; nếu sau này teacher được xem roster, tạo response DTO giới hạn thay vì dùng nhánh redaction khó kiểm soát.
- Workspace context bắt buộc cho list, count, duplicate candidate, history, enrollment command, code registry và fee impact.
- Không cho client gửi/đổi mã học viên.
- Không dùng student code làm authorization proof.
- Không log tên, SĐT, Zalo hoặc full payment reference trong telemetry thông thường.
- Excel tôn trọng hidden fields/quyền người xuất; giữ formula-injection guard.
- Archive/restore/transfer/leave/reuse/create-duplicate đều ghi append-only audit với actor, workspace, reason/request id và snapshot tối thiểu cần thiết.

## 10. Dọn ghost code và hợp đồng cũ

Chỉ xóa sau khi đã có test và chứng minh không còn call site:

- Luồng bắt buộc chọn lớp trong `openCreateForm` và conditional render form cũ.
- Hàm gom toàn bộ trang trong `getStudents` sau khi chuyển sang paged query.
- Kiểu `student_code?: string | null` sau DB readiness gate.
- `status` trong `StudentUpdate` generic.
- Nhánh candidate frontend chỉ nhận `active/inactive`.
- Selected-slot fields bị khai báo nhưng không xử lý, hoặc payload field gửi sai cấp.
- Chuỗi mutation transfer/edit nhiều API ở page component.
- Nhánh redaction không thể đạt tới nếu policy management tiếp tục chỉ dev/admin; xác minh authorization trước khi xóa.
- Field `parent_name`: hiện model/schema có nhưng UI không dùng. Audit dữ liệu production, API/report và nhu cầu nghiệp vụ trước khi chọn **bổ sung vào form** hoặc **retire bằng forward migration**; không xóa mù.
- Trạng thái legacy `inactive`: thống kê row, nguồn tạo và consumer trước khi migrate về active/stopped hoặc giữ compatibility.
- Helper formatter mã rời rạc: thay bằng một utility có unit test.

Không xóa các migration 055/069/083 hoặc lịch sử migration đã áp dụng. “Dọn ghost” chỉ áp dụng runtime code/contract không còn dùng; migration là bằng chứng lịch sử database.

## 11. Kế hoạch triển khai theo đợt

### Đợt A — khóa hợp đồng và regression tests

1. Viết characterization tests cho hành vi hiện tại.
2. Chốt state machine và payment-reference contract trong docs/OpenAPI.
3. Sửa list-state cancelled-only.
4. Sửa selected-slot contracts.
5. Bỏ lifecycle status khỏi generic PATCH.
6. Đồng bộ duplicate candidate đã ngừng học + student code.

Điều kiện qua đợt: backend contract tests, integration tests và frontend schema tests xanh.

### Đợt B — command nguyên tử và impact học phí/QR

1. Xây command create+enroll, enroll existing, add class, transfer, leave.
2. Xây preview/commit archive và leave.
3. Gắn reconciliation, payment-request revocation và lifecycle audit.
4. Thêm idempotency/concurrency tests.

Điều kiện qua đợt: fault injection ở mọi bước đều rollback toàn bộ; retry không tạo trùng.

### Đợt C — API list/summary hiệu năng

1. Typed list envelope và state summary.
2. Query/index benchmark.
3. Infinite/cursor query frontend có abort.
4. Deep-link URL state.

Điều kiện qua đợt: đạt ngưỡng p95 với fixture lớn và không còn full-dataset loop.

### Đợt D — giao diện vòng đời hồ sơ

1. Thêm ba tab phạm vi.
2. Cột `Mã HV` đầu tiên; formatter dùng chung.
3. Profile-only create.
4. Chọn hồ sơ có sẵn / tạo mới khi thêm từ lớp.
5. Ghi danh lại hồ sơ chưa xếp lớp, ngừng học/tiếp nhận lại và lịch sử chỉ đọc.
6. Mobile, keyboard, focus, loading/empty/error states.

Điều kiện qua đợt: E2E hoàn chỉnh cho mỗi state và không có overlay/panel che nhau.

### Đợt E — đồng bộ toàn hệ thống và cleanup

1. Học phí, QR, báo cáo, Excel, dashboard và Zalo dùng cùng code/identity contract.
2. Excel thêm mã ở cột đầu nơi đối tượng chính là học viên.
3. Xóa ghost runtime code/type/helper.
4. Chạy bundle analysis và accessibility audit.
5. Cập nhật release readiness/runbook.

## 12. Ma trận test bắt buộc

### Backend/unit/integration

- Profile-only create cấp mã, `UNASSIGNED`, không enrollment/fee/request.
- Exact/prefix compact/formatted code search.
- Code immutable, registry append-only, workspace isolated, parallel create unique.
- State filter/response thống nhất cho `UNASSIGNED`, `CURRENT`, `STOPPED`; lịch sử dropped/completed/cancelled không tạo trạng thái thứ tư.
- Hồ sơ chưa xếp lớp thêm lại lớp vẫn giữ mã/history.
- Học viên nhiều lớp rời một lớp vẫn `CURRENT`; rời lớp cuối thành `UNASSIGNED`.
- Hồ sơ đã ngừng không enroll trực tiếp; tiếp nhận lại không tự enroll.
- Duplicate candidate ở cả ba phạm vi parse đúng và có code.
- Selected slots create/update/transfer đúng; invalid slot rollback.
- Archive/leave với fee chưa báo, đã báo, đã nộp, refund và open QR theo đúng policy.
- Payment reference unique theo request; không auto-match bằng student code đơn lẻ.
- Cross-workspace ID/cursor/candidate/command đều bị từ chối.

### Frontend/component/E2E

- Cột đầu desktop là `Mã HV`; mobile hiển thị mã format dưới tên.
- Copy mã trả đúng giá trị quy ước; tìm compact/formatted đều được.
- Ba tab có count, URL, refresh/back/forward đúng.
- Tạo hồ sơ không lớp; chọn hồ sơ cũ; tạo mới + enroll; học thêm; đổi lớp; rời lớp; ngừng học; tiếp nhận lại.
- Refresh/background error không làm mất dữ liệu đang xem.
- Keyboard: tab order, Enter/Space, Escape, focus return; screen reader labels.
- Responsive 320/375/768/1024/1440 px; không horizontal overflow ngoài table container.
- Không có action menu đè dialog/sheet.
- Excel danh sách có cột mã đầu tiên và thông báo xuất file đúng ngữ nghĩa.

### Release/ops

- Fresh migration và upgrade migration đều pass.
- SQL verifier có invariant mới.
- Typecheck, lint, unit, integration, E2E và production build pass.
- EXPLAIN ANALYZE trên fixture lớn được lưu làm bằng chứng.
- Backup/restore drill và forward rollback plan cho migration mới.

## 13. Tiêu chí hoàn tất

Hạng mục chỉ được coi là hoàn thành khi:

- Admin nhìn thấy mã học viên ở cột đầu danh sách và dùng được mã để tìm/copy/export.
- Mã hiển thị đồng nhất, còn payment reference vẫn là mã + suffix riêng cho từng request.
- Admin tạo được hồ sơ không lớp, xem riêng hồ sơ chưa xếp lớp/ngừng học và lấy lại hồ sơ để ghi danh.
- Rời lớp không xóa hồ sơ; ngừng học/tiếp nhận lại không làm mất mã hoặc lịch sử.
- Mọi thao tác nhiều bước có transaction, idempotency, audit và impact học phí/QR rõ ràng.
- Không còn mismatch list state, selected slots hay candidate đã ngừng học.
- Danh sách không tải toàn bộ database trước khi render.
- UI đồng bộ typography, tab, table, side panel, button, loading và empty state với các trang hiện hành.
- Ghost runtime code đã xóa có bằng chứng không còn import/call site; migration history vẫn nguyên vẹn.
- Toàn bộ release gates ở mục 12 đều xanh trước staging.

## 14. Thứ tự ưu tiên khuyến nghị

1. **P0 contract/state/transaction/fee-QR safety**.
2. **P1 list API + profile lifecycle UI + mã học viên**.
3. **P1 đồng bộ reports/Excel/search/deep links**.
4. **P2 performance tuning dựa trên đo đạc và ghost cleanup**.

Không nên bắt đầu bằng việc vẽ lại toàn bộ trang rồi mới sửa backend. UI mới sẽ phụ thuộc trực tiếp vào state counts, history DTO và command nguyên tử; triển khai theo thứ tự trên giúp tránh phải sửa giao diện nhiều lần.

## 15. Nhật ký triển khai 25/08/2026

- Đã chốt và triển khai ba phạm vi `CURRENT`, `UNASSIGNED`, `STOPPED` ở backend, schema và frontend.
- Đã đưa mã học viên lên đầu danh sách, tìm kiếm, Excel, sổ thu và snapshot bất biến của nhật ký học phí.
- Đã giữ khoản nợ đã báo cùng QR đang mở khi học viên rời lớp; chỉ khoản chưa phát sinh nghĩa vụ mới chuyển `VOID` và bị thu hồi QR.
- Đã đồng bộ trang Học phí với trạng thái ngừng học và thiết kế lại trang Báo cáo theo bảng + khung chi tiết.
- Migration `111_fee_operation_student_code_snapshot.sql` là migration tiếp theo cần áp dụng trước khi chạy verifier/staging.
- Đã có unit/contract test cho ba trạng thái, QR khoản nợ cũ, schema và giao diện báo cáo. Các release gate thực tế vẫn phải được chạy lại trên database đã áp dụng migration 111.
