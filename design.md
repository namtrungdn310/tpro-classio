# TPRO Classio Frontend Design Skill

File này là hướng dẫn bắt buộc khi thiết kế, sửa hoặc review giao diện frontend của TPRO Classio. Hãy xem nó như một `SKILL.md` nội bộ cho FE: trước khi làm UI phải đọc file này, trong lúc làm phải bám theo rules, và sau khi làm phải tự kiểm tra theo checklist.

## Khi Nào Phải Dùng File Này

Dùng file này cho mọi task có liên quan tới:

- Tạo hoặc sửa page trong `frontend/src/app`.
- Tạo hoặc sửa component trong `frontend/src/components`.
- Thay đổi layout, màu sắc, typography, table, dialog, form, toast, loading, empty state, responsive.
- Thay đổi flow UI của học viên, lớp học, học phí, báo cáo, dashboard, đăng nhập.
- Review UI hoặc sửa lỗi UI.

Nếu task chỉ sửa backend, database, CI, deploy hoặc tài liệu không ảnh hưởng giao diện thì không cần áp dụng file này, trừ khi thay đổi đó làm frontend phải đổi hành vi.

## Nguồn Sự Thật Cần Đọc Trước Khi Làm UI

Trước khi code UI, đọc theo thứ tự:

1. `doc/ro.docx`: hiểu yêu cầu nghiệp vụ, quyền Admin/Viewer, dữ liệu cần hiển thị.
2. `doc/devplan.docx`: hiểu stack, route, API dự kiến, deploy context.
3. `doc/testplan.docx`: hiểu tiêu chí kiểm thử người dùng sẽ làm.
4. `doc/database/erd.drawio`: hiểu tên bảng/entity nếu UI cần field dữ liệu.
5. File phase hiện tại, ví dụ `phase1.md`, `phase2.md`.
6. File code frontend hiện có để giữ cùng style.

Không tự nghĩ thêm tính năng ngoài tài liệu nếu user không yêu cầu.

## Tư Duy Thiết Kế

TPRO Classio là web app nội bộ cho trung tâm tiếng Anh. Đây là công cụ vận hành hằng ngày, không phải landing page, không phải portfolio, không phải dashboard trang trí.

Người dùng chính chỉ có:

- Admin: toàn quyền thêm, sửa, xóa mềm, thiết lập, xác nhận.
- Viewer: chỉ xem và xuất file nếu tài liệu cho phép.

Ưu tiên thiết kế:

- Nhanh để thao tác.
- Dễ quét dữ liệu.
- Ít trang trí.
- Ít thao tác thừa.
- Rõ quyền Admin/Viewer.
- Hoạt động tốt trên mobile từ 375px.
- Toàn bộ UI, validation, toast, empty state, lỗi phải là tiếng Việt.

## Quy Trình Khi Làm Một Task FE

### 1. Xác Định Phạm Vi

Trước khi sửa code, xác định:

- Route/page nào bị ảnh hưởng.
- User nào dùng màn hình đó: Admin, Viewer hoặc cả hai.
- Dữ liệu chính là gì: học viên, lớp, học phí, báo cáo.
- Có thao tác nguy hiểm không: xóa, deactivate, hủy xác nhận, ghi đè dữ liệu.
- Có cần cập nhật `design.md` không.

### 2. Chọn Pattern UI

Chọn pattern theo mục đích:

- Danh sách dữ liệu: dùng table trên desktop.
- Mobile nhiều dòng dữ liệu: có thể dùng card/list compact nếu table khó đọc.
- Form thêm/sửa: dùng Dialog.
- Xác nhận thao tác nguy hiểm: dùng AlertDialog.
- Bộ lọc: đặt trên table.
- Chế độ xem: dùng tabs hoặc segmented control.
- Trạng thái nhị phân: checkbox/toggle.
- Hành động icon: dùng lucide icon kèm accessible label hoặc tooltip.

Không tạo hero, banner marketing, card trang trí, gradient, orb/blob, ảnh stock.

### 3. Code Theo Existing Pattern

Ưu tiên dùng:

- Next.js App Router trong `frontend/src/app`.
- TypeScript strict.
- Tailwind CSS.
- shadcn/ui style `new-york`, theme neutral.
- lucide-react cho icon.
- TanStack Query cho API state khi có fetch/mutation.
- Axios client ở `frontend/src/lib/api/client.ts`.
- react-hook-form + zod cho form.

Không tạo abstraction mới nếu chưa có lý do rõ ràng.

### 4. Kiểm Tra Sau Khi Code

Sau khi sửa UI, luôn kiểm tra:

- `npm run type-check`
- `npm run lint`
- Nếu có app chạy được, kiểm tra nhanh desktop và mobile 375px.
- Nếu sửa flow quan trọng, kiểm tra cả optimistic state, rollback, toast, quyền Viewer.

## Visual Rules Bắt Buộc

### Màu Sắc

- Nền chính: trắng hoặc xám rất nhạt.
- Text chính: đen/xám đậm.
- Border/table/header: xám trung tính nhẹ.
- Accent chính: `#1F5C2E`.
- Chỉ dùng accent cho CTA chính, active tab, focus ring hoặc điểm nhấn nhỏ.
- Không dùng gradient.
- Không dùng màu tím/xanh tím làm dominant palette.
- Không tạo giao diện một màu; cần có hierarchy bằng neutral, border, text weight, status color.

Trạng thái:

- `PAID` / đã nộp: xanh tiết chế.
- `UNPAID` / chưa nộp: đỏ cảnh báo vừa đủ.
- inactive/muted row: xám nhẹ nhưng vẫn đọc được.

### Typography

- Font sans-serif mặc định hiện tại là đủ.
- Không scale font theo viewport width.
- Không dùng tracking âm.
- Heading trong app vận hành phải gọn, không quá lớn.
- Text trong button, badge, table cell không được tràn container.

Định dạng:

- Tiền: `1.200.000d`.
- Period tháng: dữ liệu `2025-06` hiển thị `Tháng 6/2025`.
- Ngôn ngữ UI: tiếng Việt có dấu.

### Layout

Sau đăng nhập:

- Top navbar bên trái: `TPRO Classio`.
- Bên phải: email user và nút đăng xuất.
- Desktop tab bar: `Tổng quan`, `Học viên`, `Lớp học`, `Học phí`, `Báo cáo`.
- Active tab dùng `text-[#1F5C2E] border-b-2 border-[#1F5C2E]`.

Mobile dưới 768px:

- Không overflow ngang vô lý.
- Touch target tối thiểu 44px.
- Ẩn cột không thiết yếu.
- Có thể dùng bottom tab bar ở phase polish/PWA.
- Fee table có thể stack thành card để tick/sửa inline dễ hơn.

## Component Rules

- Dùng shadcn/ui style `new-york`, theme neutral.
- Dùng lucide icon cho nút icon nếu có icon phù hợp.
- Nút icon phải có `aria-label` hoặc tooltip.
- CTA chính duy nhất trên một vùng có thể dùng background `#1F5C2E`.
- Nút phụ dùng variant nhẹ: outline/ghost/text.
- Không dùng shadow nặng; tối đa `shadow-sm`.
- Không lồng card trong card.
- Card chỉ dùng cho metric, item lặp lại, dialog/modal hoặc mobile card thay table.
- Dialog dùng cho thêm/sửa/ghi danh/thiết lập danh sách thu.
- AlertDialog dùng cho xóa/deactivate/hủy xác nhận/thao tác rủi ro.
- Toast ngắn, tiếng Việt, nói rõ kết quả.

Ví dụ toast tốt:

- `Đã lưu`
- `Đã tạo 12 phiếu học phí`
- `Không có quyền thực hiện thao tác này`
- `Mất kết nối, vui lòng thử lại`

Không hiện raw exception ra UI.

## Table Rules

Table là UI mặc định cho desktop.

Luôn có:

- Header rõ.
- Border mỏng.
- Row hover nhẹ nếu có action.
- Filter row phía trên table nếu có tìm kiếm/lọc.
- Empty state tiếng Việt.
- Loading skeleton gần giống layout thật.

Cột chuẩn:

Lớp học:

- `Tên lớp`
- `Loại`
- `Học phí gốc`
- `Số học viên`
- `Trạng thái`
- `Thao tác`

Học viên:

- `Họ tên`
- `Năm sinh`
- `Trường`
- `Lớp đang học`
- `Phụ huynh`
- `SDT`
- `Tên Zalo`
- `HP tháng này`
- `Thao tác`

Học phí:

- `Học viên`
- `Lớp`
- `HP gốc`
- `Giảm`
- `Lý do`
- `Thực thu`
- `Trạng thái`
- `Ngày nộp`
- `Xác nhận`

Viewer:

- Không thấy nút thêm/sửa/xóa/thiết lập/xác nhận/chỉnh giảm.
- Có thể thấy dữ liệu và nút xuất file nếu tài liệu cho phép.

## Flow Học Phí Phải Giữ Đúng

Thiết lập danh sách thu:

- Admin chọn period + lớp.
- Hiện preview trước khi tạo.
- Preview gồm số phiếu sẽ tạo và số phiếu bị bỏ qua.
- Confirm xong mới insert batch.
- Toast: `Đã thiết lập N phiếu học phí`.

Xác nhận đã nộp:

- Click checkbox/circle tick trên dòng `UNPAID`.
- Optimistic UI đổi sang `PAID`.
- `paid_date` là ngày hiện tại.
- Nếu API lỗi, rollback về `UNPAID` và toast lỗi.

Hủy xác nhận:

- Click tick trên dòng `PAID`.
- Hiện AlertDialog `Bỏ xác nhận thanh toán?`.
- Confirm xong đổi về `UNPAID`.
- Xóa `paid_date` và `paid_amount`.

## Dashboard Và Báo Cáo

Dashboard có 4 metric chính:

- `Tổng học viên`
- `Đã thu`
- `Còn thiếu`
- `Tỉ lệ thu`

Biểu đồ:

- Tối giản.
- Neutral/gray là chính.
- Không trang trí nặng.

Báo cáo chưa nộp:

- Dễ đọc để giáo viên nhắn Zalo.
- Phụ huynh nổi bật.
- Có học viên, lớp, Zalo, SDT, số tiền còn thiếu, lý do giảm nếu có.
- Số tiền chưa nộp dùng đỏ tiết chế.

Print/PDF:

- Ẩn nav, button, filter.
- Header in: `TPRO English - Danh sách chưa nộp học phí tháng X/Y`.

## Empty, Loading, Error

Mỗi route phải có:

- Loading skeleton phù hợp layout thật.
- Empty state tiếng Việt.
- Error state/toast tiếng Việt.

Session hết hạn:

- Redirect `/login`.
- Thông báo người dùng cần đăng nhập lại.

Backend restart/mất kết nối:

- UI bình tĩnh.
- Có loading/retry/reconnect state.
- Không hiện lỗi thô.

## Không Được Làm

- Không tạo landing page.
- Không dùng hero marketing.
- Không dùng gradient/orb/blob/background trang trí.
- Không dùng ảnh stock để làm app nội bộ trông “đẹp”.
- Không dùng emoji trong UI.
- Không để text tiếng Việt không dấu.
- Không để Viewer thấy action Admin.
- Không để table/form/button overflow trên mobile.
- Không làm card nested card.
- Không thêm feature ngoài tài liệu nếu user không yêu cầu.

## Checklist Trước Khi Kết Thúc Task UI

Trước khi báo xong, tự kiểm:

- UI tiếng Việt có dấu đầy đủ.
- Admin/Viewer đúng quyền.
- Table/filter/action khớp `doc/`.
- Không gradient, không shadow nặng, không trang trí thừa.
- Mobile 375px không overlap, không tràn chữ.
- Button/touch target đủ lớn.
- Loading/empty/error có mặt nếu route có data.
- Toast/confirm đúng ngữ cảnh.
- Flow học phí không sai optimistic/rollback/confirm.
- `npm run type-check` pass.
- `npm run lint` pass.
- Nếu thay đổi quy tắc thiết kế, đã cập nhật chính file `design.md`.

## Cách Cập Nhật File Này

Chỉ cập nhật `design.md` khi:

- User yêu cầu đổi nguyên tắc thiết kế.
- Trong lúc làm UI phát hiện rule hiện tại thiếu hoặc mâu thuẫn.
- Một pattern mới được dùng nhiều lần và nên trở thành chuẩn.

Không cập nhật `design.md` chỉ vì sửa nội dung nhỏ của một page.
