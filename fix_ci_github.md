# Nhật Ký Khắc Phục Lỗi Hệ Thống CI GitHub (TPRO Classio)

Tài liệu này tổng hợp toàn bộ các lỗi phát hiện và các giải pháp đã được thực hiện để khắc phục hoàn toàn hệ thống tích hợp liên tục (CI) trên GitHub Actions cho dự án TPRO Classio (nhánh `main`). Hệ thống CI hiện tại đã đạt trạng thái **100% Green (Success)** cho cả Frontend và Backend.

---

## Danh Sách Lỗi & Giải Pháp Chi Tiết

### 1. Lỗi Múi Giờ Trong Kiểm Thử Frontend (Timezone Offset)
* **Triệu chứng**: Chạy kiểm thử tự động tại local (múi giờ GMT+7) thì thành công, nhưng lên máy chủ CI của GitHub (múi giờ UTC) thì thất bại ở bước `compact dashboard update time includes dd/mm/yy and time` trong file `frontend/tests/format.test.ts`.
  * **Lỗi cụ thể**: Giá trị mong đợi là `13/07/26 · 08:05` nhưng thực tế trên CI lại ra `13/07/26 · 15:05` (lệch đúng 7 tiếng).
* **Nguyên nhân**: Do sử dụng `new Date(2026, 6, 13, 8, 5).getTime()` tạo timestamp dựa trên múi giờ cục bộ của môi trường chạy. Hàm format lại dùng cấu hình múi giờ cố định `Asia/Ho_Chi_Minh`.
* **Giải pháp**: Thay đổi cách khởi tạo timestamp mẫu bằng `Date.UTC(2026, 6, 13, 1, 5)`. Múi giờ UTC 01:05 sẽ luôn được định dạng chính xác thành 08:05 theo múi giờ GMT+7 bất kể môi trường chạy ở đâu.
* **Tệp chỉnh sửa**: [frontend/tests/format.test.ts](file:///d:/Projects/tpro-classio/frontend/tests/format.test.ts)

### 2. Lỗi Vòng Lặp Sự Kiện Đã Đóng Trong Kiểm Thử Backend (Event Loop Closed)
* **Triệu chứng**: Các bài kiểm tra tích hợp database (`pytest -q -m db_integration`) báo lỗi `RuntimeError: Event loop is closed` hoặc `AttributeError: 'NoneType' object has no attribute 'send'`.
* **Nguyên nhân**: Thư viện `pytest-asyncio` tạo một vòng lặp sự kiện mới cho từng hàm kiểm thử độc lập. Tuy nhiên, `AsyncEngine` của SQLAlchemy trong ứng dụng lại được khởi tạo tĩnh khi nạp module (`import-time`). Do đó các kiểm thử tiếp theo cố gắng sử dụng lại một engine/connection pool gắn liền với event loop cũ đã bị đóng.
* **Giải pháp**: 
  * Gọi `await engine.dispose()` tại đầu mỗi hàm kiểm thử bất đồng bộ để xóa bỏ connection pool cũ và buộc SQLAlchemy tạo vòng lặp kết nối mới tương thích với event loop của test hiện tại.
  * Chuẩn hóa decorator của các hàm kiểm thử thành `@pytest.mark.asyncio` (không kèm tham số `loop_scope` cũ).
* **Tệp chỉnh sửa**:
  * [backend/tests/integration/test_fee_transactions.py](file:///d:/Projects/tpro-classio/backend/tests/integration/test_fee_transactions.py)
  * [backend/tests/integration/test_staff_integrity.py](file:///d:/Projects/tpro-classio/backend/tests/integration/test_staff_integrity.py)

### 3. Lỗi Nạp Thuộc Tính Trễ Của SQLAlchemy (MissingGreenlet / Lazy Loading)
* **Triệu chứng**: Gặp lỗi `sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called; can't call await_only() here`.
* **Nguyên nhân**: Thuộc tính `final_amount` là một cột tính toán tự động (`Computed`) của bảng `fee_records` trong PostgreSQL. Khi truy cập `record.final_amount` trong hàm `snapshot_fee_record()` sau khi phiên làm việc (`db.commit()`) đã hoàn tất, SQLAlchemy cố gắng truy vấn cơ sở dữ liệu để tải lại thuộc tính này một cách đồng bộ nhưng ngoài môi trường greenlet của SQLAlchemy Async.
* **Giải pháp**: Sửa đổi logic để tính toán giá trị `final_amount` cục bộ dựa trên các thuộc tính đã tải sẵn là `base_amount` và `discount_amount` nếu thuộc tính `final_amount` chưa được nạp vào session.
* **Tệp chỉnh sửa**: [backend/app/services/fee_operation_service.py](file:///d:/Projects/tpro-classio/backend/app/services/fee_operation_service.py)

### 4. Lỗi Trùng Lặp Dữ Liệu Ràng Buộc (Unique Constraint Violation)
* **Triệu chứng**: Bài test `test_staff_lifecycle_triggers_preserve_class_assignments` thỉnh thoảng thất bại do vi phạm ràng buộc duy nhất trên cột `phone` và `zalo_name` của bảng `staff_members`.
* **Nguyên nhân**: Do các giá trị số điện thoại và tên Zalo được mã hóa cứng (`0912345678`, `CI Teacher`). Khi chạy các bài test song song hoặc liên tiếp, dữ liệu cũ chưa kịp dọn dẹp gây trùng lặp.
* **Giải pháp**: Chuyển các trường dữ liệu nhạy cảm và yêu cầu duy nhất sang sinh ngẫu nhiên theo định dạng bằng UUID ngắn.
* **Tệp chỉnh sửa**: [backend/tests/integration/test_staff_integrity.py](file:///d:/Projects/tpro-classio/backend/tests/integration/test_staff_integrity.py)

### 5. Lỗi Ruff Import Linting (E402)
* **Triệu chứng**: Ruff báo lỗi `E402 Module level import not at top of file` đối với thư viện `engine` trong các file kiểm thử tích hợp.
* **Nguyên nhân**: Đặt câu lệnh import `engine` ở giữa tệp để tránh import trước khi thiết lập môi trường.
* **Giải pháp**: Di chuyển import lên đầu trang cùng với `AsyncSessionLocal` và sắp xếp theo đúng quy chuẩn PEP8.
* **Tệp chỉnh sửa**:
  * [backend/tests/integration/test_fee_transactions.py](file:///d:/Projects/tpro-classio/backend/tests/integration/test_fee_transactions.py)
  * [backend/tests/integration/test_staff_integrity.py](file:///d:/Projects/tpro-classio/backend/tests/integration/test_staff_integrity.py)

### 6. Lỗi Kết Nối PostgreSQL Của Container Trên CI
* **Triệu chứng**: `Verify fee transactions against PostgreSQL` không thể kết nối tới cơ sở dữ liệu CI.
* **Nguyên nhân**: Địa chỉ kết nối cơ sở dữ liệu `DATABASE_URL` dùng `localhost`. Trên các runner Linux của GitHub, `localhost` ưu tiên phân giải thành IPv6 `::1` thay vì IPv4 `127.0.0.1`, dẫn đến từ chối kết nối do Docker PostgreSQL chỉ lắng nghe IPv4.
* **Giải pháp**: Khai báo rõ ràng tham số `DATABASE_URL` trong bước chạy kiểm thử của workflow CI với máy chủ là `127.0.0.1` thay vì `localhost`.
* **Tệp chỉnh sửa**: [.github/workflows/ci.yml](file:///d:/Projects/tpro-classio/.github/workflows/ci.yml)

### 7. Lỗi Glob Khớp Tệp Trên Shell Linux
* **Triệu chứng**: Lệnh `npm test` lỗi do shell Linux không hỗ trợ đệ quy thư mục theo dạng `tests/**/*.test.ts` hoặc không tự phân giải nếu không được cài đặt tương ứng.
* **Giải pháp**: Chuẩn hóa cấu hình script test trong `package.json` thành `tsx --test tests/*.test.ts` (kiểm thử nằm trực tiếp trong thư mục `tests`).
* **Tệp chỉnh sửa**: [frontend/package.json](file:///d:/Projects/tpro-classio/frontend/package.json)

### 8. Lỗi RLS & Triggers Anonymization
* **Triệu chứng**: Cơ chế RLS và trigger tự động từ chối cập nhật cột nhạy cảm khi thực hiện xóa người dùng liên kết.
* **Giải pháp**: 
  * Cập nhật `036_fee_operation_audit_ledger.sql` để cho phép thao tác `UPDATE` chỉ dành cho trường hợp ẩn danh hóa thông tin (`actor_user_id` chuyển về `NULL`) khi tài khoản người dùng tương ứng bị xóa (`ON DELETE SET NULL`).
  * Tách biệt các trigger xử lý dòng (`FOR EACH ROW`) và trigger xử lý bảng (`FOR EACH STATEMENT`) do PostgreSQL không hỗ trợ hành vi `TRUNCATE` trong các trigger xử lý dòng.
* **Tệp chỉnh sửa**: [backend/supabase/migrations/036_fee_operation_audit_ledger.sql](file:///d:/Projects/tpro-classio/backend/supabase/migrations/036_fee_operation_audit_ledger.sql)

### 9. Lỗi Môi Trường Docker Pydantic Settings
* **Triệu chứng**: ValidationError xảy ra khi nạp các biến môi trường cấu hình do các biến phụ thêm từ container Docker hoặc GitHub Action runner.
* **Giải pháp**: Thêm thuộc tính cấu hình `extra="ignore"` vào `SettingsConfigDict` để bỏ qua các biến môi trường không được định nghĩa trước.
* **Tệp chỉnh sửa**: [backend/app/core/config.py](file:///d:/Projects/tpro-classio/backend/app/core/config.py)

---

## Trạng Thái Hiện Tại
* Toàn bộ mã nguồn đã sạch và đồng bộ với GitHub.
* Mọi hành động kiểm thử đều vượt qua và đường ống CI đã chạy thành công hoàn toàn.
