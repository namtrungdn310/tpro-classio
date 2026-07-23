# TPRO Classio

Thiết lập đầy đủ OTP email, Google identity/avatar, Google Authenticator, RLS,
SMTP và checklist triển khai nằm tại [AUTH_SETUP.md](AUTH_SETUP.md).

docker compose up -d --build
docker compose down
docker compose logs -f (coi log)
docker compose ps (check container)

Docker sẽ chỉ khởi động frontend sau khi backend vượt qua readiness check có
kiểm tra kết nối database. Trạng thái mong đợi của cả hai service là `healthy`.

->  http://localhost:3000
    http://localhost:8000/docs

## Cổng kiểm định phase 0–3

Trước khi bắt đầu chỉnh giao diện hoặc phát hành bản mới, phải đạt đủ các lệnh
sau:

```powershell
docker compose up -d --build
docker compose ps                    # backend/frontend đều phải healthy
docker compose config -q
```

Backend cần vượt qua `GET /health/ready` (kiểm tra database thật). Frontend cần
trả `200` tại `/login`. CI đồng thời chạy pytest, Ruff, frontend type-check,
ESLint, frontend regression tests, production build, dependency audit và chạy
toàn bộ Supabase migrations trên PostgreSQL staging rỗng.

## Quy trình staging/production

Không tự động chạy migration từ container ứng dụng. Trước production cần tạo
backup và kiểm tra restore trên database riêng, sau đó chạy từng file trong
`backend/supabase/migrations` với `ON_ERROR_STOP=1`, rồi chạy
`backend/tests/sql/verify_security.sql`. Nếu kiểm tra thất bại, dừng phát hành
và restore backup; không sửa trực tiếp dữ liệu production để làm test.

Các migration kiểm soát học phí sẽ dừng và rollback nếu trạng thái học phí cũ
không khớp sổ thanh toán hoặc thiếu snapshot bắt buộc. Phải đối soát trên bản
sao staging, lập script sửa dữ liệu có kiểm duyệt rồi chạy lại; không bỏ qua
`VALIDATE CONSTRAINT` và không xoá bút toán thanh toán để ép migration chạy.

Migration `028_fee_refund_ledger.sql` phải được chạy trước phiên bản backend có
chức năng hoàn phí. Hoàn phí và sửa hoàn phí đều là bút toán mới trong bảng
`payments`; không cập nhật trực tiếp `fee_records.refunded_amount`, không sửa
hoặc xoá lịch sử giao dịch. Cổng CI chạy cả đường nâng cấp từ ledger cũ, retry
idempotent, hoàn một phần/toàn phần, bút toán sửa sai và phép đối soát projection
với sổ cái trước khi cho phép phát hành.

Migration `029_harden_staff_lifecycle.sql` thiết lập các ràng buộc vòng đời và
khóa đồng thời cho phân công giáo viên. Migration
`030_staff_contact_without_account_link.sql` tiếp tục chuyển thông tin liên hệ
Nhân sự sang cặp tên Zalo/SĐT hoàn chỉnh, đồng thời loại bỏ email và liên kết
tài khoản không còn thuộc phạm vi nghiệp vụ. Dữ liệu SĐT cũ được giữ lại và tên
Zalo ban đầu được lấy từ tên nhân sự để người quản lý rà soát, chỉnh lại sau khi
nâng cấp. Chuỗi migration sẽ rollback nếu tên/SĐT/phân công lớp cũ không hợp lệ.
Phải chạy thử trên bản sao staging, xử lý từng bản ghi sai có kiểm duyệt rồi mới
phát hành backend; không triển khai code mới trước migration tương ứng.

Migration `031_allow_direct_fee_payment.sql` phải được chạy trước phiên bản
backend cho phép ghi nhận học phí trực tiếp từ trạng thái chưa báo. Migration
chỉ nới ràng buộc thanh toán; các trường thông báo vẫn phải cùng rỗng hoặc cùng
đầy đủ, vì hệ thống không được tạo giả thời điểm hay nội dung đã báo phụ huynh.
Khi hoàn tác một khoản nộp trực tiếp, trạng thái hợp lệ duy nhất là chưa báo.

Migration `033_account_access_lifecycle.sql` là bước chuyển đổi dữ liệu legacy:
Admin hiện hữu được giữ `active`, còn Viewer được tạo bởi luồng cũ được chuyển
sang `pending` để Dev rà soát vì profile trước đây có thể tồn tại trước khi OTP
được xác thực. Quy tắc `pending` này chỉ áp dụng cho dữ liệu backfill của
migration 033; không phải contract đăng ký mới sau migration 035. Migration
`035_enforce_google_totp_onboarding.sql` thay thế luồng đăng ký: thành viên phải
có lời mời hợp lệ, hoàn tất OTP email một lần, liên kết đúng Google identity,
đăng ký Google Authenticator và xác nhận đã lưu recovery codes. Chỉ sau toàn bộ
chuỗi này hệ thống mới cấp phiên AAL2 và kích hoạt tài khoản với role `viewer`;
không có bước chờ Dev phê duyệt. Dev vẫn có thể đổi role hoặc vô hiệu hoá tài
khoản sau đó; các thao tác này thu hồi phiên liên quan và được giữ trong audit
append-only `account_security_events`.

Đây là thay đổi cần maintenance window: tạm dừng đăng ký/đăng nhập, chạy migration
và release gate, triển khai đồng thời backend/frontend mới rồi mới mở lại lưu
lượng. Không chạy code mới với schema cũ và không để backend cũ phục vụ trong lúc
các Viewer legacy đang được chuyển sang trạng thái chờ rà soát.

Migration `034_account_deletion_sync.sql` cho phép xoá vĩnh viễn tài khoản
Supabase mà không làm mất lịch sử audit: email/tên tại thời điểm thao tác được
chụp bất biến, còn các khóa ngoại được giải phóng an toàn khi profile bị xoá.
Migration dùng trigger chụp snapshot ở database nên tương thích với cả backend
cũ lẫn mới trong lúc rolling deployment. Sau khi chạy migration, phải kiểm tra
tài khoản đã xoá biến mất khỏi bảng phân quyền và email đó có thể nhận lời mời,
đăng ký lại thành một user id mới rồi hoàn tất đầy đủ onboarding 035 để trở thành
Viewer hoạt động.

Production phải dùng secret riêng, database role tối thiểu quyền, HTTPS ở
reverse proxy, SMTP đã cấu hình và chỉ bật HSTS trên virtual host HTTPS. CAPTCHA
là release gate chưa được phép khai báo là hoàn tất chỉ bằng việc bật trong
Supabase Dashboard: frontend phải lấy token, Next proxy phải chuyển tiếp và
backend phải xác minh/chuyển tiếp token cho đúng endpoint signup/reset. Không bật
CAPTCHA trên staging/production trước khi cả ba tầng đã được tích hợp và smoke
test; không phát hành production khi release gate này còn thiếu. Chi tiết nằm ở
[AUTH_SETUP.md](AUTH_SETUP.md#captcha-và-chống-bot).
Vì schema dùng `FORCE RLS` không có browser policy, `DATABASE_URL` phải dùng role
backend-only `tpro_backend` có `BYPASSRLS` và explicit grants theo
[AUTH_SETUP.md](AUTH_SETUP.md#database-role-dùng-bởi-fastapi); một role SQL thông
thường sẽ bị RLS chặn. Role này không được đưa vào trình duyệt.
`OWNER_ADMIN_EMAIL` là cấu hình bắt buộc cho từng môi trường; không dùng giá trị
mặc định trong mã nguồn. Có thể sao chép `backend/.env.example` để tạo cấu hình
local, nhưng tuyệt đối không commit file `backend/.env` chứa secret thật.

TPRO Classio không dùng Supabase Data API cho dữ liệu nghiệp vụ: frontend luôn
đi qua Next proxy và FastAPI; Supabase chỉ cung cấp các endpoint `/auth/v1` cho
đăng nhập, OTP và đặt lại mật khẩu. Vì vậy mọi bảng do dự án sở hữu trong schema
`public` phải bật và ép buộc RLS, không cấp quyền bảng/cột/RPC cho `anon` hoặc
`authenticated`. Migration `025_lock_down_public_data_api.sql` và
`verify_security.sql` là release gate cho quy tắc này. Nếu sau này chủ động dùng
REST/GraphQL/RPC của Supabase, phải thiết kế policy và migration được review
riêng trước khi cấp lại bất kỳ quyền nào.

Dữ liệu mẫu không thuộc chuỗi migration. Không chạy file trong
`backend/supabase/seeds` trên staging/production. Khi cần làm mới dữ liệu ở một
database phát triển biệt lập, chủ động chạy
`backend/supabase/seeds/realistic_fee_test_seed.sql` sau khi đã chạy migrations;
file này có chủ đích xóa dữ liệu nghiệp vụ hiện có.

## Nếu Port 3000 Bị Chiếm
- Xem process đang giữ port:
    netstat -ano | Select-String ':3000'
- Dừng process đó, thay `PID` bằng số ở cột cuối:
    Stop-Process -Id PID -Force

## Chạy Tạm Port Khác
$env:FRONTEND_PORT=3017
-> docker compose up -d --build
-> http://localhost:3017
