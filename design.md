# TPRO Classio - Hướng Dẫn Thiết Kế Frontend

Tài liệu này là nguồn tham chiếu khi thiết kế và sửa giao diện TPRO Classio. Mọi thay đổi UI trong các phase sau phải được đối chiếu với file này; nếu quy tắc giao diện thay đổi, cập nhật file này trong cùng lần sửa code.

## 1. Định Hướng Sản Phẩm

- TPRO Classio là web app nội bộ cho trung tâm tiếng Anh, ưu tiên quản lý học viên, lớp học, học phí và báo cáo doanh thu.
- Người dùng chính chỉ gồm Admin và Viewer; giao diện cần nhanh, rõ ràng, ít thao tác thừa.
- Đây là công cụ vận hành hằng ngày, không phải landing page. Màn hình đầu tiên sau đăng nhập phải là dashboard làm việc, không có hero marketing.
- Ngôn ngữ UI, validation, toast, empty state và lỗi phải là tiếng Việt.

## 2. Nguyên Tắc Tổng Thể

- Bảng dữ liệu là UI chính cho Lớp học, Học viên, Học phí và Báo cáo.
- Bố cục cần gọn, dễ quét, ưu tiên thao tác lặp lại: tìm kiếm, lọc, sửa inline, xác nhận, xuất file.
- Không dùng gradient, bóng đổ nặng, hiệu ứng trang trí, blob/orb, ảnh stock, card marketing.
- Không lồng card trong card. Card chỉ dùng cho metric, item lặp lại, dialog/modal hoặc mobile card thay bảng.
- Trang quản trị dùng spacing chặt vừa phải; không dùng heading quá lớn trong panel, table, dialog.
- Toàn bộ thao tác nguy hiểm hoặc đảo trạng thái quan trọng cần có confirm dialog đúng ngữ cảnh.

## 3. Màu Sắc Và Thương Hiệu

- Nền chính: trắng hoặc xám rất nhạt.
- Chữ chính: đen/xám đậm.
- Viền, đường kẻ, header table: xám trung tính nhẹ.
- Accent theo dev plan: `#1F5C2E`, dùng cho nút chính, active tab, focus ring hoặc điểm nhấn hạn chế.
- Logo sử dụng trong frontend là bản trắng đen trong `frontend/public/logo-bw.png` và bản crop cho UI tại `frontend/public/logo-mark-bw.png`; chỉ dùng ở vị trí nhận diện nhỏ như navbar, login, favicon/PWA icon sau này.
- Trạng thái:
  - Đã nộp / PAID: xanh rõ nhưng tiết chế.
  - Chưa nộp / UNPAID: đỏ cảnh báo để nhận diện nhanh.
  - Inactive / muted rows: xám nhẹ, giảm độ tương phản vừa đủ để đọc.
- Không tạo UI một màu; nếu một màn hình bị đơn sắc, thêm neutral surfaces, text hierarchy và status colors đúng mức.

## 4. Typography Và Định Dạng

- Font sans-serif mặc định của stack Next.js/Tailwind là đủ; ưu tiên dễ đọc trên mobile.
- Không scale font theo viewport width.
- Letter spacing giữ `0`, không dùng tracking âm.
- Tiền tệ hiển thị dạng `1.200.000d`.
- Kỳ học tháng hiển thị dạng `Tháng 6/2025` khi dữ liệu là `2025-06`.
- Text trong nút, badge, table cell không được tràn container; nếu dài thì xuống dòng hoặc truncate có tooltip khi cần.

## 5. Layout Ứng Dụng

- Sau đăng nhập có top navbar:
  - Bên trái: tên ứng dụng `TPRO Classio`.
  - Bên phải: email người dùng và nút đăng xuất.
- Có tab bar ngang cho desktop: `Tổng quan`, `Học viên`, `Lớp học`, `Học phí`, `Báo cáo`.
- Protected routes nằm trong dashboard layout; khi hết session hoặc 401 thì redirect `/login` kèm thông báo tiếng Việt.
- Mobile dưới 768px:
  - Ẩn cột không thiết yếu.
  - Ưu tiên bottom tab bar với icon cho các route chính.
  - Touch target tối thiểu 44px.
  - Fee table có thể stack thành card để thao tác tick/sửa inline dễ hơn.

## 6. Component Rules

- Dùng shadcn/ui style `new-york`, theme neutral.
- Dùng lucide icons trong nút icon khi có icon phù hợp.
- Nút icon phải có tooltip hoặc accessible label nếu ý nghĩa không hiển nhiên.
- Dùng segmented controls/tabs cho chế độ xem, dropdown/menu cho tập lựa chọn, checkbox/toggle cho trạng thái nhị phân, input/stepper cho số tiền.
- Dialog dùng cho thêm/sửa/ghi danh/thiết lập danh sách thu.
- AlertDialog dùng cho xóa/deactivate, hủy xác nhận thanh toán, và các thao tác có rủi ro.
- Toast ngắn gọn, tiếng Việt, báo rõ kết quả: đã lưu, đã tạo N phiếu, lỗi mạng, không có quyền.

## 7. Bảng Dữ Liệu

- Table là mặc định cho desktop.
- Header cần rõ, cột cần dùng tên Việt theo tài liệu:
  - Lớp học: `Tên lớp`, `Loại`, `Học phí gốc`, `Số học viên`, `Trạng thái`, `Thao tác`.
  - Học viên: `Họ tên`, `Năm sinh`, `Trường`, `Lớp đang học`, `Phụ huynh`, `SDT`, `Tên Zalo`, `HP tháng này`, `Thao tác`.
  - Học phí: `Học viên`, `Lớp`, `HP gốc`, `Giảm`, `Lý do`, `Thực thu`, `Trạng thái`, `Ngày nộp`, `Xác nhận`.
- Filter row nằm trên table: search, dropdown lớp/type/status, period selector nếu cần.
- Viewer không thấy nút thêm/sửa/xóa/thiết lập/xác nhận/chỉnh giảm; chỉ thấy dữ liệu và nút xuất file nếu tính năng cho phép.
- PAID rows trong bảng học phí có thể muted để quét nhanh, nhưng số tiền và trạng thái vẫn phải đọc được.
- Inline edit trong bảng học phí lưu khi Enter hoặc blur; hiện pending state nhẹ và toast kết quả.

## 8. Luồng Học Phí Cần Giữ Đúng

- Thiết lập danh sách thu:
  - Admin chọn period + lớp.
  - Hiện preview trước khi tạo, gồm số phiếu sẽ tạo và số phiếu bị bỏ qua.
  - Confirm xong mới insert batch.
  - Toast dạng `Đã thiết lập N phiếu học phí`.
- Xác nhận đã nộp:
  - Click checkbox/circle tick trên dòng UNPAID.
  - Optimistic UI đổi sang PAID, paid_date là ngày hiện tại.
  - Nếu API lỗi, rollback về UNPAID và toast lỗi.
- Hủy xác nhận:
  - Click tick trên dòng PAID.
  - Hiện AlertDialog `Bỏ xác nhận thanh toán?`.
  - Confirm xong đổi về UNPAID, xóa paid_date/paid_amount.

## 9. Empty, Loading, Error

- Mỗi route có loading skeleton phù hợp với bố cục thật.
- Empty state phải có câu tiếng Việt ngắn và action chính nếu Admin có quyền.
- Lỗi API phải hiện bằng toast tiếng Việt; không để raw exception hiện lên UI.
- Session hết hạn: redirect `/login`, thông báo người dùng cần đăng nhập lại.
- Nếu backend trên Droplet đang restart hoặc mất kết nối tạm thời, UI nên có loading/reconnect state bình tĩnh, không hiện lỗi thô.

## 10. Dashboard Và Báo Cáo

- Dashboard gồm 4 metric chính: `Tổng học viên`, `Đã thu`, `Còn thiếu`, `Tỉ lệ thu`.
- Biểu đồ doanh thu theo lớp dùng phong cách tối giản, màu xám/neutral, không trang trí nặng.
- Báo cáo chưa nộp phải dễ cho giáo viên đọc và nhắn Zalo:
  - Phụ huynh nổi bật.
  - Tên học viên, lớp, Zalo, SDT, số tiền còn thiếu, lý do giảm nếu có.
  - Số tiền chưa nộp dùng màu đỏ tiết chế.
- Print/PDF phải ẩn nav, nút, filter; header in là `TPRO English - Danh sách chưa nộp học phí tháng X/Y`.

## 11. Responsive Và PWA

- Hoạt động tốt từ 375px trở lên.
- Không overflow ngang trên mobile, trừ khi bảng dữ liệu có pattern scroll rõ ràng và cần thiết.
- Các thao tác hay dùng trên mobile phải nằm trong tầm chạm, không nhỏ hơn 44px.
- PWA dùng `name: TPRO Classio`, `short_name: TPRO`, `display: standalone`, `theme_color: #ffffff`, `start_url: /`.

## 12. Checklist Trước Khi Hoàn Thành UI

- UI tiếng Việt đầy đủ.
- Admin/Viewer hiện đúng quyền.
- Bảng/filter/action khớp yêu cầu trong `doc/`.
- Không gradient, không heavy shadow, không trang trí thừa.
- Mobile 375px không tràn chữ, không overlap, nút chạm đủ lớn.
- Loading, empty, error state có mặt.
- Toast/confirm đúng cho các luồng học phí quan trọng.
- Nếu thay đổi quy tắc giao diện, đã cập nhật file `design.md`.
