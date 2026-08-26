# Kế hoạch cuối — Trình soạn thảo và luồng tin nhắn Zalo học phí

> Trạng thái: đã triển khai và kiểm chứng ngày 25/08/2026. Migration đích là 108–110; các migration 105–107 được giữ nguyên như lịch sử đã áp dụng, không còn là nguồn mặc định runtime.
>
> Tài liệu này là nguồn sự thật cho hạng mục. Không tiếp tục vá riêng `keydown`, gutter hoặc dữ liệu mặc định trên editor cũ.

## 0. Kết quả triển khai

- Hai nơi chỉnh mẫu chung và tin nhắn theo học viên dùng chung CodeMirror 6, đánh số logical line và chỉ soft-wrap khi thiếu chiều rộng.
- `Enter`/`Backspace` dùng hành vi document chuẩn của editor; nội dung lưu, mở lại và sao chép giữ nguyên LF.
- Backend là nguồn duy nhất của mẫu mặc định và renderer; frontend không còn default runtime thứ hai.
- Draft được lưu theo `workspace + student + period + kind`, có revision, fingerprint và cảnh báo khi nguồn học phí thay đổi.
- Luồng đánh dấu “Đã báo” chỉ nhận draft canonical đúng revision/fingerprint; không thể gửi một nội dung nhưng audit nội dung khác.
- Legacy draft columns được di trú rồi xóa bởi migration 109; custom template hiện hữu không bị ghi đè.
- Custom DOM editor, gutter và caret helpers cũ đã được xóa. Migration đã chạy được giữ lại để bảo toàn lịch sử database.
- Chuỗi migration sạch, upgrade/reapply, verifier bảo mật, backend tests và frontend tests/build đều là release gate bắt buộc.

## 1. Kết luận đã chốt

Hạng mục phải giải quyết đồng thời bốn lớp, không chỉ thay giao diện nhập văn bản:

1. Một editor dùng chung, phân biệt rõ xuống dòng thật và dòng tự bọc.
2. Một hợp đồng dữ liệu duy nhất từ editor đến clipboard, API và database.
3. Một luồng nghiệp vụ bảo đảm nội dung admin sao chép chính là nội dung hệ thống ghi nhận khi chuyển sang “Đã báo”.
4. Một mô hình bản nháp theo đúng nhóm học viên–kỳ học phí, không lưu lặp và ghép sai giữa nhiều khoản thu.

Các quyết định kiến trúc đã khóa:

- Dùng CodeMirror 6 tối giản, lazy-load; không tiếp tục custom DOM editor.
- Số dòng logic là tín hiệu phân biệt duy nhất. Không thêm ký hiệu `↵` gây rối hoặc làm thay đổi độ rộng dòng.
- Một lần nhấn `Enter` tạo đúng một LF (`\n`); `Backspace` ở đầu dòng sau xóa đúng LF đó.
- Soft wrap chỉ là hiển thị, không tạo dòng mới và không thay đổi trạng thái “đã chỉnh sửa”.
- Chỉ chuẩn hóa CRLF/CR thành LF; không tự trim hoặc collapse nội dung admin đã nhập.
- Backend là nguồn duy nhất cho mẫu mặc định và việc render token.
- Mẫu mặc định cuối cùng có 5 dòng logic khi `{{chi_tiet_hoc_phi}}` chỉ sinh một dòng. Việc tách tên học viên thành dòng riêng trong 105–107 là biện pháp bù cho UI cũ và sẽ không còn là mẫu đích.
- Bản nháp chuyển sang một row theo `workspace + student + period + kind`, có revision và fingerprint dữ liệu nguồn.
- Không bao giờ nối nhiều bản nháp hoàn chỉnh bằng `\n\n`.
- Migration đã chạy là lịch sử bất biến; dọn ghost code không đồng nghĩa xóa migration đã áp dụng.

## 2. Phạm vi nghiệp vụ

### 2.1. Người dùng

- Admin và Dev có quyền quản lý trong workspace hiện tại.
- Teacher, browser role hoặc người dùng workspace khác không được đọc/sửa mẫu hay bản nháp.
- Mọi thao tác phải fail-closed nếu request không có workspace context hợp lệ.

### 2.2. Ba loại nội dung cần phân biệt

1. **Mẫu hệ thống**: mặc định do backend cung cấp.
2. **Mẫu tùy chỉnh workspace**: admin/dev sửa nội dung chung của workspace.
3. **Tin nhắn riêng của nhóm học viên–kỳ**: nội dung đã render từ mẫu, có thể sửa tự do trước khi sao chép.

`notification_message` không phải bản nháp. Đây là snapshot bất biến của nội dung được dùng khi khoản thu chuyển sang “Đã báo”.

### 2.3. Nhóm khoản thu hợp lệ

Một tin nhắn chỉ được tạo cho một nhóm có cùng:

- `workspace_id`;
- `student_id`;
- `period`;
- loại tin nhắn (`reminder` hoặc `received`);
- trạng thái phù hợp với loại tin nhắn.

Quy tắc trạng thái:

- `reminder`: chỉ dùng với nhóm khoản thu `UNPAID` còn hiệu lực.
- `received`: chỉ dùng với nhóm khoản thu `PAID` còn hiệu lực.
- Không nhận `VOID`, `SUPERSEDED`, record khác kỳ hoặc record khác workspace.
- Nếu một lựa chọn chứa trạng thái lẫn lộn, backend từ chối thay vì đoán.

## 3. Vấn đề đã xác minh trong implementation hiện tại

- Template editor dùng `contentEditable`, `Range.getClientRects()`, `ResizeObserver`, placeholder `br` và serializer riêng.
- Tin nhắn học viên dùng một textarea/mirror/gutter khác, nên hai nơi có hành vi không đồng nhất.
- Template backend đang giữ layout gần như nguyên vẹn, còn draft/render frontend lại `.trim()` và collapse nhiều newline.
- Frontend chứa một bản hard-code của mẫu mặc định bên cạnh default backend.
- Draft đang được chép vào mọi `fee_record` trong nhóm; backend mới kiểm tra cùng học viên, chưa khóa cùng kỳ/trạng thái.
- Khi các record có draft khác nhau, frontend có thể nối nhiều tin nhắn hoàn chỉnh bằng `\n\n`.
- Draft có thể cũ sau thay đổi ngày hạn, số tiền, lớp, hoàn phí hoặc hoàn tác đã nộp.
- “Sao chép” hiện có thể copy nội dung chưa lưu; “Đánh dấu đã báo” lại dựng nội dung từ draft/template đã lưu, làm audit khác tin thực tế.
- Hoàn tác đã nộp về “Đã báo” có nhánh render bằng mẫu backend hard-code theo từng record, không theo mẫu workspace và nhóm nhiều lớp.
- Xử lý 409 hiện có thể tự đổi `baseVersion` trong khi giữ local text, tạo khả năng ghi đè thay đổi của phiên khác mà admin không biết.
- Global `UnifiedCaretProvider` đang nhắm mọi `[contenteditable=true]`; CodeMirror cũng dùng editable DOM nội bộ và cần opt-out rõ ràng.
- Security verifier vẫn kiểm tra một row template toàn database, trái mô hình nhiều workspace.
- Disposable database runner mới liệt kê migration đến 103.

## 4. Hợp đồng dữ liệu chuẩn

### 4.1. Chuỗi canonical

Áp dụng cho mẫu, preview, draft, snapshot và clipboard:

1. Chuyển `\r\n` và `\r` thành `\n`.
2. Giữ nguyên từng LF mà admin chủ động tạo, kể cả dòng trống ở đầu, giữa hoặc cuối.
3. Không tự bỏ khoảng trắng cuối dòng, không tự trim toàn chuỗi và không collapse nhiều newline.
4. Chỉ dùng phép kiểm tra whitespace để từ chối nội dung không có ký tự có nghĩa; phép kiểm tra đó không được sửa chuỗi.
5. Không lưu số dòng, token pill, gutter, HTML, ký hiệu trang trí hoặc ký tự zero-width.
6. Clipboard lấy trực tiếp từ document model canonical.
7. API trả lại chính chuỗi canonical đã lưu; editor rebase bằng chuỗi response đó.

Lý do giữ nguyên LF ở biên: admin phải có thể thêm/xóa xuống dòng bằng thao tác văn bản thông thường, và save → reopen → copy không được âm thầm đổi nội dung.

### 4.2. Giới hạn và cách đếm

- Template: 20–1400 Unicode code points và phải có đủ token bắt buộc.
- Tin nhắn render/draft/action: 1–2000 Unicode code points có nghĩa.
- TypeScript đếm bằng code point, không dùng trực tiếp `string.length` của UTF-16.
- Python, PostgreSQL và TypeScript phải dùng chung golden fixtures có tiếng Việt, emoji, CRLF và newline ở biên.
- Sau khi thay token, nếu tin nhắn vượt 2000 ký tự thì không cho lưu/copy/đánh dấu đã báo; báo rõ trường nào làm nội dung dài.

### 4.3. Dòng logic và dòng hiển thị

- Logical line count = số LF + 1.
- Dòng tự bọc không tăng logical line count.
- Resize modal, zoom hoặc đổi màn hình không được thay document, selection, undo history hoặc dirty state.
- `{{chi_tiet_hoc_phi}}` có thể render thành nhiều dòng thật; mỗi khoản học phí trong token tạo một logical line.

### 4.4. Không còn normalization ngầm

Phải xóa các bước đang:

- trim cuối từng dòng;
- `.trim()` draft khi đọc;
- collapse `\n{3,}`;
- lấy nội dung từ `innerText`/HTML;
- nối các draft khác nhau thành một chuỗi mới.

## 5. Mẫu mặc định cuối cùng

### 5.1. Thông báo đóng học phí

```text
TPRO English xin thông báo học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí cần thanh toán: {{tong_tien}}.
Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.
```

### 5.2. Thông báo đã nhận học phí

```text
TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
TPRO English cảm ơn phụ huynh.
```

Đây là thay đổi có chủ đích so với layout 6 dòng hiện tại:

- Tên học viên nằm cùng logical line đầu.
- Nếu câu dài, editor chỉ soft-wrap; clipboard vẫn giữ cùng một dòng.
- Không dùng newline dữ liệu để chữa hạn chế chiều rộng giao diện.
- Với nhiều lớp, `{{chi_tiet_hoc_phi}}` tạo nhiều dòng nên tổng số dòng render có thể lớn hơn 5.

## 6. Mô hình dữ liệu đích

### 6.1. Template theo workspace

- Không có row `fee_message_templates` của workspace: workspace kế thừa default backend.
- Có row: đó là bản tùy chỉnh của workspace.
- Backend constants là nguồn duy nhất của system default.
- Frontend không giữ bản sao runtime của default.
- Reset về mặc định xóa row tùy chỉnh bằng optimistic version, không ghi một bản sao default vào DB.
- Update và reset đều có audit event.

### 6.2. Draft theo nhóm

Thay hai cột draft lặp trên `fee_records` bằng bảng nhóm, tên dự kiến `fee_message_drafts`:

- `id`;
- `workspace_id`;
- `student_id`;
- `period`;
- `kind` (`reminder`/`received`);
- `message`;
- `source_fingerprint`;
- `template_hash` hoặc template version kèm hash;
- `revision`;
- `created_by`, `updated_by`, `created_at`, `updated_at`.

Ràng buộc duy nhất:

```text
(workspace_id, student_id, period, kind)
```

Lợi ích:

- Không nhân bản cùng draft trên nhiều record.
- Không thể ghép nhầm nhiều tin hoàn chỉnh.
- Có optimistic concurrency rõ ràng.
- Có thể phát hiện draft cũ khi nguồn render thay đổi.

### 6.3. Fingerprint dữ liệu nguồn

Backend tạo SHA-256 từ canonical JSON chứa toàn bộ đầu vào ảnh hưởng nội dung:

- workspace, student, period, kind;
- tên học viên;
- template content hash;
- danh sách record ID đã sort;
- class name snapshot;
- số tiền hiển thị;
- ngày đến hạn hiệu lực;
- trạng thái, refund/net amount và các dòng bổ sung liên quan.

Không dùng riêng `template_version`, vì default backend có thể đổi trong khi version kế thừa vẫn là 0.

Nếu fingerprint hiện tại khác fingerprint draft:

- Không tự dùng draft cũ để copy hoặc notify.
- Không xóa âm thầm nội dung admin đã viết.
- UI báo ngắn gọn “Dữ liệu khoản thu đã thay đổi”.
- Admin chọn “Tạo lại theo dữ liệu mới” hoặc mở nội dung cũ để rà soát rồi lưu lại trên fingerprint mới.

### 6.4. Snapshot đã báo

- `notification_message` là snapshot bất biến sau khi ghi nhận “Đã báo”.
- Snapshot phải đúng byte-for-byte với canonical message vừa được lưu và sao chép.
- Thay template/draft sau đó không sửa snapshot lịch sử.
- Không dùng draft receipt để thay thế reminder snapshot và ngược lại.

## 7. Renderer và API — backend là nguồn sự thật

### 7.1. Renderer dùng chung

Chuyển logic render nhóm sang một backend service dùng cho:

- preview trên UI;
- lưu draft;
- sao chép/notify validation;
- hoàn tác trạng thái;
- test nghiệp vụ.

Frontend chỉ hiển thị và chỉnh chuỗi API trả về; không tự dựng một phiên bản business message khác.

### 7.2. API template

`GET /fees/message-templates` trả cấu trúc rõ ràng:

```json
{
  "active": {
    "payment_reminder_template": "...",
    "payment_received_template": "..."
  },
  "defaults": {
    "payment_reminder_template": "...",
    "payment_received_template": "..."
  },
  "is_customized": false,
  "version": 0,
  "updated_at": null
}
```

- `PUT /fees/message-templates` nhận `expected_version` và tạo/cập nhật custom row.
- `POST /fees/message-templates/reset` nhận `expected_version`, xóa custom row và trả trạng thái kế thừa version 0.
- 409 trả state mới nhất để UI xử lý xung đột; không tự rebase rồi cho retry ngầm.

### 7.3. API preview/draft nhóm

Endpoint dự kiến:

- `POST /fees/messages/preview`;
- `PUT /fees/messages/draft`;
- `POST /fees/messages/draft/reset`.

Preview nhận `record_ids` và `kind`, sau đó backend:

1. kiểm tra workspace/student/period/status;
2. load active template;
3. render message và fingerprint;
4. load group draft nếu có;
5. trả `source`, `message`, `draft_revision`, `source_fingerprint` và trạng thái stale.

Lưu draft nhận:

- `record_ids`;
- `kind`;
- `message`;
- `expected_revision`;
- `source_fingerprint`.

Backend khóa nhóm, tính lại fingerprint và chỉ ghi khi revision/fingerprint còn hợp lệ. Nếu không, trả 409 và không mất local draft.

Reset xóa row group draft bằng revision guard. Sau reset, preview dùng active template mới nhất.

### 7.4. API ghi nhận “Đã báo”

Request phải mang `draft_revision` và `source_fingerprint` của nội dung đã copy.

Trong một transaction, backend:

- xác nhận draft còn là revision hiện tại và chưa stale;
- chuyển đúng các record sang `NOTIFIED_UNPAID`;
- ghi cùng canonical message vào `notification_message` của toàn nhóm;
- tạo audit operation/idempotency record.

Nếu draft thay đổi sau lần copy, UI yêu cầu copy lại; không ghi nhận một message khác với message đã chuẩn bị gửi.

## 8. Luồng UX cuối cùng

### 8.1. Chỉnh mẫu chung

1. Mở “Nội dung Zalo”.
2. API trả active/default/custom status.
3. Hai editor hiển thị mẫu đóng phí và đã nhận phí.
4. Admin chỉnh, Enter/Backspace theo hành vi văn bản chuẩn.
5. “Về mặc định” đưa nội dung default backend vào editor như một user edit có thể Undo; chỉ xóa custom row khi admin xác nhận lưu/reset.
6. “Lưu” dùng optimistic version.
7. Đóng/đổi tab khi dirty phải xác nhận.

Khi 409:

- giữ nguyên local content;
- hiển thị “Mẫu đã được cập nhật ở phiên khác”;
- cho chọn “Tải bản mới nhất” hoặc “Ghi đè bằng bản đang sửa” với xác nhận rõ;
- không tự thay `baseVersion` trong nền.

### 8.2. Tin nhắn của một học viên

Khi mở “Tin nhắn Zalo”:

- Server preview đúng nhóm hiện tại.
- UI hiển thị nhãn nhỏ: `Theo mẫu`, `Nội dung riêng` hoặc `Cần cập nhật`.
- Admin chỉnh tự do.
- “Lưu” chỉ bật khi canonical document khác baseline và hợp lệ.
- “Khôi phục theo mẫu” reset draft về `NULL`/xóa row nhóm, không chép default vào draft.
- Đóng, nhấn Escape, click backdrop hoặc đổi thao tác khi dirty đều phải xác nhận.

### 8.3. Sao chép và đánh dấu đã báo

Luồng reminder gồm hai bước đúng thực tế:

1. **Sao chép**
   - Nếu nội dung chưa lưu, lưu thành công trước.
   - Copy đúng response canonical vừa lưu.
   - Ghi nhớ revision/fingerprint đã copy trong state phiên làm việc.
   - Nếu save hoặc clipboard thất bại, không báo thành công và không đóng mất nội dung.

2. **Đã gửi — ghi nhận đã báo**
   - Chỉ bật với revision/fingerprint vừa copy và chưa bị sửa tiếp.
   - Backend snapshot đúng message của revision đó.
   - Sau reload, để tránh suy đoán clipboard, admin phải mở/copy lại trước khi ghi nhận nếu phiên không còn bằng chứng local.

Không gộp “copy” thành bằng chứng rằng phụ huynh đã nhận; admin vẫn xác nhận sau khi thực sự gửi qua Zalo.

### 8.4. Tin nhắn đã nhận học phí

- Có thể lưu/copy receipt riêng, không tự thay đổi trạng thái khoản thu.
- Refund/refund reversal làm fingerprint thay đổi; draft cũ được đánh dấu stale.
- Phần thông tin hoàn phí do renderer backend tạo và không bị một draft cũ che mất.

### 8.5. Hoàn tác đã nộp

- Nếu chuyển về `UNNOTIFIED`: không tạo notification message mới.
- Nếu chuyển về `NOTIFIED_UNPAID`: chỉ cho phép khi đã có snapshot reminder thực sự trước đó; giữ snapshot đó.
- Khoản thanh toán trực tiếp chưa từng báo không được giả lập thành “Đã báo”. Admin phải chuyển về “Chưa báo”, hoặc thực hiện đúng luồng soạn/copy/ghi nhận báo.
- Xóa nhánh render per-record bằng hard-coded backend default.

## 9. Thiết kế editor

### 9.1. Component dùng chung

Tạo `ZaloMessageEditor` với hai mode:

- `template`: token là pill decoration nhưng document lưu `{{token}}`.
- `message`: plain text đã render, chỉnh tự do.

Props chính:

- `value`, `onChange`;
- `mode`;
- `maxLength`;
- `ariaLabelledBy`, `ariaDescribedBy`;
- validation/read-only/loading state;
- API chèn token thông qua EditorState hiện tại.

### 9.2. Hiển thị tối giản

```text
Thông báo phụ huynh đóng học phí                         236/1400
┌────┬──────────────────────────────────────────────────────────┐
│ 1  │ TPRO English xin thông báo học phí... Nguyễn Minh Tuấn: │
│    │ phần tự bọc tiếp tục ở đây                               │
│ 2  │ IELTS 10: 4.500.000đ                                    │
│ 3  │ Ngày đến hạn: 01/08/2026.                               │
└────┴──────────────────────────────────────────────────────────┘
Số dòng chỉ tăng khi nhấn Enter · Backspace ở đầu dòng để nối dòng
```

- Dòng tự bọc không có số mới.
- Không thêm `↵`, đường chỉ dẫn hoặc badge lặp trên từng dòng.
- Helper chỉ xuất hiện một lần cho mỗi editor hoặc một lần chung trong dialog khi hai editor đặt cạnh nhau.

### 9.3. Phong cách TPRO

- Font nội dung 16 px, line-height khoảng 24 px.
- Gutter 36–40 px, nền trung tính rất nhẹ, `aria-hidden`.
- Chiều cao ban đầu 220–240 px; editor tự cuộn sau ngưỡng.
- Hai editor bằng chiều cao trên desktop, xếp một cột trên mobile.
- Dùng typography, radius, border, focus ring và Button size/variant hiện có.
- Token button compact trên desktop, vùng chạm tối thiểu 44 px trên thiết bị cảm ứng.
- Header/footer cố định theo `FormDialogShell`; chỉ body cuộn.
- Không tạo thêm nội dung giải thích dài hoặc control dư thừa.

## 10. Kiến trúc CodeMirror 6

### 10.1. Dependency tối thiểu

- `@codemirror/state`;
- `@codemirror/view`;
- `@codemirror/commands`.

Không dùng `basicSetup`, language package, search, minimap hay indent package.

Editor được dynamic import khi dialog mở hoặc thao tác Tin nhắn Zalo được chọn. Bundle CodeMirror không được tải cùng initial Fees route.

### 10.2. Keymap

- Bind `Enter` và `Shift+Enter` vào plain `insertNewline` ở precedence cao hơn `standardKeymap`.
- Không dùng `insertNewlineAndIndent` cho tin Zalo.
- Dùng command chuẩn cho Backspace/navigation.
- Thêm `history()` và `historyKeymap` cho Undo/Redo.
- Không bind `indentWithTab`; Tab/Shift+Tab phải chuyển focus ra/vào control khác.
- Chỉ viết command Backspace riêng nếu browser test chứng minh atomic token làm hành vi chuẩn sai.
- Không can thiệp phím khi IME đang composition.

### 10.3. React lifecycle

- Tạo `EditorView` đúng một lần mỗi mount.
- Không recreate editor khi controlled prop đổi.
- External update chỉ dispatch replace khi khác `view.state.doc.toString()`.
- Transaction external không được phát lại `onChange`, reset caret hoặc đi vào undo history.
- Reset do admin bấm là user transaction và có thể Undo.
- Dùng Compartment cho editable/read-only/content attributes.
- `destroy()` khi unmount.
- Save, Copy và token insertion luôn đọc EditorState hiện tại, không đọc DOM hoặc React state có thể stale.

### 10.4. Token

- Token pill là decoration/atomic range.
- Document vẫn là cú pháp `{{token}}`.
- Con trỏ không lọt giữa token.
- Chèn token không tự thêm space/newline.
- Enter/Backspace cạnh token phải giữ nguyên token.

### 10.5. Tương thích caret toàn hệ thống

CodeMirror dùng editable DOM nội bộ, vì vậy:

- thêm một generic data attribute để opt-out native caret khỏi `UnifiedCaretProvider`;
- provider bỏ qua editor có attribute đó;
- giữ selection policy dùng chung nếu cần;
- sau khi chuyển xong, xóa selector legacy `data-fee-template-editor-control` khỏi `ActionSelectionGuard` khi `rg` không còn caller.

## 11. Accessibility và responsive

- Gắn `aria-label`/`aria-labelledby`, `aria-describedby`, `aria-invalid`, `aria-multiline` trực tiếp vào content DOM của CodeMirror.
- Gutter chỉ là trang trí và không làm screen reader đọc số trước mỗi dòng.
- Label và lỗi có quan hệ programmatic với editor.
- Focus ring luôn nhìn thấy.
- Loading editor có status đọc được; token button bị disable đến khi engine sẵn sàng.
- Dynamic import không tự cướp focus ngoài hành động mở dialog của người dùng.
- Test keyboard-only, 200% zoom, mobile 320/375 px và ít nhất Chromium + Firefox.

## 12. Migration và dữ liệu

### 12.1. Nguyên tắc an toàn

- Không sửa migration đã được áp dụng.
- Không tin riêng `schema_migrations` vì 105/106 đã có thể chạy thủ công.
- Đối chiếu migration history, checksum, schema thực tế, dữ liệu và audit theo `RELEASE_READINESS.md`.
- Backup trước khi reconciliation.

### 12.2. Xử lý 103, 105, 106, 107

- Migration 103 phải giữ: ngoài draft Zalo còn chứa bằng chứng tài khoản dùng tất toán nhân sự.
- 105 và 106 đã được người dùng xác nhận chạy: giữ nguyên.
- Chưa được chạy 107 thêm ở môi trường nào trước preflight.
- Với 107:
  - nếu chứng minh chưa chạy ở mọi môi trường, có thể loại/đổi trước staging;
  - nếu đã chạy hoặc không chứng minh được, coi là lịch sử bất biến và thêm migration tiến tới;
  - không chỉnh nội dung file đã được áp dụng ở bất kỳ nơi nào.

### 12.3. Preflight phân loại template

Không dùng so sánh text đơn lẻ để kết luận “chưa từng chỉnh”. Báo cáo phải kết hợp:

- content thuộc danh sách system default đã biết;
- `updated_by is null`;
- không có audit `template_update` của workspace;
- version thuộc chuỗi migration-only đã biết;
- checksum/lịch sử môi trường.

Row mơ hồ được giữ nguyên và đưa vào báo cáo, không tự ghi đè/xóa.

### 12.4. Migration tiến tới cuối cùng

Migration tiếp theo chỉ thực hiện sau preflight và phải:

1. tạo bảng group draft, constraint, index, FORCE RLS và closed ACL;
2. backfill duy nhất các nhóm draft có giá trị đồng nhất;
3. đưa draft lệch/partial vào acceptance report, tuyệt đối không ghép `\n\n`;
4. chuyển các workspace default được chứng minh chưa tùy chỉnh sang trạng thái kế thừa;
5. giữ nguyên mọi template tùy chỉnh hoặc mơ hồ;
6. harden meaningful-content constraint bằng cách loại space/tab/CR/LF khi kiểm tra rỗng;
7. có acceptance checks và chạy lần hai là no-op;
8. chỉ drop hai cột draft cũ khi backfill và code mới đã được xác minh.

Vì hệ thống chưa production, contract-drop có thể làm trong maintenance deployment trước khi lên production. Nếu đã có rolling traffic, phải dùng expand → deploy → contract để không làm hỏng instance cũ; đây là một kế hoạch release, không phải vá lại kiến trúc.

### 12.5. Verifier và runner

- Sửa `verify_security.sql`: cho phép workspace không có row custom; mọi row phải có workspace hợp lệ, constraint/token/length hợp lệ; không yêu cầu một row toàn DB.
- Cập nhật cả Python và PowerShell disposable runners qua migration cuối.
- Test clean chain và upgrade chain.
- Test runtime role có đủ quyền server cần cho insert/update/delete custom template và group draft, nhưng anon/authenticated vẫn không có quyền trực tiếp.
- Loại fallback global `id = 1` khi thiếu workspace context.

## 13. Dọn ghost code và ghost file

Chỉ xóa sau khi component/API mới đã pass test và `rg` xác nhận zero caller.

Ứng viên frontend:

- `message-line-number-gutter.tsx`;
- `template-editor-dom.ts`;
- `editor-caret-boundary.ts` nếu không còn nơi dùng;
- implementation cũ trong `fee-template-editor.tsx`;
- `FeeLineNumberedTextarea`, mirror và visual-row measurement trong `fees-table.tsx`;
- `splitFeeMessageTemplateLines`;
- duplicate runtime defaults trong `message-templates.ts`;
- frontend group renderer business logic sau khi preview chuyển về backend;
- legacy selection selector chỉ phục vụ editor cũ.

Ứng viên test cũ:

- DOM/caret tests khóa implementation cũ;
- source-regex tests trong layout/table test đang xác nhận mirror, silent rebase hoặc selector cũ.

Các symbol cần loại:

- `Range.getClientRects()` cho editor;
- editor-specific `ResizeObserver`;
- placeholder `br`, block-per-line DOM;
- zero-width caret marker;
- manual gutter scroll sync;
- custom `contentEditable` serializer thuộc editor Zalo.

Không xóa:

- migration 103;
- migration đã áp dụng;
- utility `ResizeObserver`/caret/contentEditable của tính năng khác;
- fixture lịch sử cần cho upgrade test.

Lưu ý: CodeMirror có editable DOM nội bộ. Điều kiện bàn giao là không còn **custom project-owned contentEditable serializer**, không phải cấm hoàn toàn thuộc tính `contenteditable` trong dependency.

## 14. Trình tự triển khai một lần

### Gate 0 — Preflight bắt buộc

- Audit migrations 105–107 trên local/staging/production target.
- Backup và phân loại row template/draft.
- Chốt checksum 107 trước bất kỳ lần chạy mới nào.
- Lập danh sách caller/file/test bằng `rg`.

### Gate 1 — Contract và schema

- Viết golden normalization fixtures dùng chung Python/TypeScript.
- Chốt backend system defaults 5 dòng.
- Tạo group draft + fingerprint/revision model.
- Viết migration clean/upgrade/idempotency tests trước khi migrate dữ liệu thật.

### Gate 2 — Backend/API

- Xây renderer nhóm dùng chung.
- Mở rộng template active/default/reset API.
- Xây preview/save/reset draft API.
- Sửa notify/unpay theo snapshot contract.
- Thêm workspace, state, period và optimistic conflict validation.

### Gate 3 — Editor foundation

- Cài CodeMirror modules tối thiểu.
- Tạo `ZaloMessageEditor`, theme TPRO và native-caret opt-out.
- Hoàn tất unit transaction/token tests và Playwright editor harness.

### Gate 4 — Chuyển hai consumer

- Chuyển dialog mẫu.
- Chuyển Tin nhắn Zalo của học viên.
- Thêm source state, stale state, dirty-close và conflict UI.
- Nối Save → Copy → Đã báo theo revision/fingerprint.

### Gate 5 — Reconciliation và cleanup

- Chạy migration trên disposable clean DB và upgrade fixtures.
- Chạy trên staging clone.
- Chỉ sau acceptance mới dọn code/schema cũ.
- `rg` zero caller trước từng lần xóa.

### Gate 6 — Release QA

- Full backend/frontend/typecheck/lint.
- PostgreSQL verifier + restricted runtime.
- Playwright real-browser.
- Bundle check và accessibility smoke test.
- Rehearse rollback từ backup trước production.

Không đi sang gate kế tiếp nếu gate hiện tại chưa đạt. Trình tự này ngăn việc dựng UI trước rồi mới phát hiện data model sai.

## 15. Ma trận test bắt buộc

### 15.1. Document/editor

- CRLF/CR → LF; save/reopen/copy giống canonical string.
- Enter đầu/giữa/cuối tạo đúng một LF.
- Backspace đầu dòng xóa đúng một LF và đặt caret tại điểm nối.
- Backspace dòng đầu là no-op chuẩn.
- Backspace trên dòng trống chỉ xóa đúng newline cần thiết.
- Multi-line selection delete đúng.
- Shift+Enter có cùng semantics plain newline.
- Soft wrap ở nhiều độ rộng không đổi document/dirty/logical lines.
- Undo/Redo cho Enter, Backspace, reset và token insertion.
- Enter/Backspace sát token không phá token.
- Tab/Shift+Tab thoát editor.
- IME Telex/VNI không bị command chen vào.
- Không có zero-width, HTML, gutter hoặc decoration trong clipboard.
- Character count đúng với tiếng Việt, combining mark và emoji.

### 15.2. Template API

- Workspace không custom nhận active = defaults, version 0.
- PUT version 0 tạo custom row.
- Update đúng version tăng version.
- Reset đúng version xóa custom row.
- Reset/update workspace A không ảnh hưởng workspace B.
- 409 giữ local content và yêu cầu lựa chọn rõ.
- Teacher/browser bị 403; thiếu workspace context fail-closed.

### 15.3. Group draft/renderer

- Cùng student khác period bị từ chối.
- Khác workspace/status/kind bị từ chối.
- Multi-class render một tin nhóm với nhiều detail lines.
- Draft chỉ tồn tại một row/group.
- Revision conflict trả 409, không mất local text.
- Fingerprint thay đổi khi class/amount/due date/refund/template/name thay đổi.
- Draft stale không được tự dùng hoặc nối.
- Reset draft quay về active template.
- Biên 1400/2000 được kiểm tra sau render.

### 15.4. Copy/notify/audit

- Dirty content phải save thành công trước copy.
- Clipboard đúng response canonical vừa save.
- Edit sau copy làm mất quyền dùng copied revision để notify.
- Notify snapshot đúng byte-for-byte với copied draft revision.
- Idempotent retry không tạo hai operation.
- Snapshot không đổi khi template/draft về sau thay đổi.
- Refund/reversal không bị draft cũ che thông tin mới.
- Direct payment unpay không được giả thành đã báo khi chưa có snapshot.
- Unpay có snapshot giữ nguyên message lịch sử, không render hard-coded per-record.

### 15.5. Migration/security

- Clean database đến migration cuối.
- Upgrade fixtures gồm: untouched default, custom khác default, custom bằng text default cũ, workspace không có row, identical group draft, partial/mismatched draft.
- Chỉ row được chứng minh system-owned mới chuyển sang kế thừa.
- Migration chạy lại no-op.
- Security verifier không còn singleton toàn DB.
- Hai workspace không đọc/sửa/reset chéo.
- Runtime role đủ quyền server; anon/authenticated không có table/function access trực tiếp.

### 15.6. E2E/visual/accessibility

- Chrome/Edge và Firefox.
- Mobile 320/375 px, desktop, 200% zoom.
- Editor stack đúng; header/footer cố định; body cuộn.
- Dòng wrapped không có số mới; hard newline có số mới.
- Gutter không lệch khi cuộn.
- Focus visible, label/error/helper được screen reader liên kết.
- Escape/backdrop/rail switch không làm mất dirty content.
- CM chunk không tải ở initial Fees route; chỉ tải khi mở editor.

Node/jsdom không được dùng để kết luận soft-wrap hoặc caret geometry vì không có layout thật; các case đó phải ở Playwright.

## 16. Điều kiện bàn giao

Chỉ hoàn thành khi toàn bộ điều sau đúng:

- Admin nhìn số dòng là phân biệt được hard newline với soft wrap.
- Enter thêm và Backspace xóa newline đối xứng ở cả template lẫn tin học viên.
- Save/reopen/copy giữ đúng canonical document.
- Không còn hai default runtime frontend/backend.
- Không còn draft lặp trên từng fee record hoặc logic nối draft bằng `\n\n`.
- Nội dung đã copy và snapshot “Đã báo” không thể lệch nhau.
- Draft stale được phát hiện từ fingerprint, không gửi số tiền/ngày/lớp cũ.
- Template/draft/reset/notify đều workspace-isolated và audited.
- Hoàn tác đã nộp không dựng notification giả bằng hard-coded default.
- Custom DOM serializer, mirror, ghost gutter/caret code đã được xóa sau `rg` zero caller.
- Clean-chain, upgrade-chain, backend, frontend và real-browser tests đều pass.

## 17. Nguồn tham khảo chính thức

- [MDN: textarea](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea) — `wrap="soft"` chỉ bọc hiển thị, không thêm line break vào giá trị.
- [CodeMirror 6 reference](https://codemirror.net/docs/ref/) — document, selection, transactions, keymap, gutter, line wrapping và atomic ranges.
- [CodeMirror styling](https://codemirror.net/examples/styling/) — theme và wrapping.
- [WAI-ARIA](https://www.w3.org/TR/wai-aria/) — multiline textbox, tên truy cập và trạng thái.
- [WAI accessibility principles](https://www.w3.org/WAI/fundamentals/accessibility-principles/) — keyboard access, focus và thông báo lỗi.

## 18. Ghi chú cho phiên triển khai

- Đọc toàn bộ tài liệu này trước khi sửa file.
- Bắt đầu từ Gate 0, không bắt đầu từ component UI.
- Worktree có nhiều thay đổi của người dùng; chỉ sửa file thuộc phạm vi và không ghi đè thay đổi không liên quan.
- Nếu phát hiện dữ liệu/migration khác giả định, dừng ở preflight và cập nhật báo cáo; không tự đoán rồi chạy migration.
- Mọi thay đổi hành vi phải có test trước hoặc cùng commit.
