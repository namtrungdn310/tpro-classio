# TODO thiết lập Auth hoàn chỉnh cho TPRO Classio

> Cập nhật theo giao diện Supabase và Google Cloud ngày 18/07/2026.
>
> **Không tạo Supabase project mới cho local.** Toàn bộ phần Local bên dưới dùng
> project TPRO Classio hiện tại và giữ nguyên dữ liệu/database hiện tại.
> Project riêng chỉ được tạo sau này cho Staging và Production.

---

## 0. Kết quả cuối cùng cần đạt

Luồng đăng ký mới:

```text
Dev/Owner tạo lời mời
→ người dùng mở link lời mời
→ nhập email + mật khẩu
→ nhận và nhập OTP email
→ liên kết đúng Google Account có cùng email
→ lấy avatar Google
→ quét QR bằng Google Authenticator
→ xác minh TOTP 6 số
→ lưu và xác nhận recovery codes
→ vào hệ thống với role Viewer và phiên AAL2
```

Những lần đăng nhập tiếp theo:

```text
Email + mật khẩu → Google Authenticator → vào hệ thống
```

Không role nào được bỏ qua Authenticator, kể cả Dev/Owner.

---

## 1. Quy tắc an toàn trước khi bắt đầu

- [X] Không xóa Supabase project hiện tại.
- [X] Không tạo database mới cho local.
- [X] Không sao chép `backend/.env.example` đè lên `backend/.env` hiện tại.
- [X] Không ghi secret thật vào file `todo.md` này.
- [X] Không gửi `service_role`, Google Client Secret hoặc database password qua chat.
- [X] Không đặt secret trong biến có tiền tố `NEXT_PUBLIC_`.
- [X] Không commit `backend/.env`, `.env` root hoặc `frontend/.env.local`.
- [X] Backup database trước khi chạy migration 035.

Tạo bản sao local của file môi trường trước khi sửa:

```powershell
Copy-Item backend\.env backend\.env.backup-local
```

Sau khi thiết lập xong, không commit file backup này. Xóa nó khi đã xác nhận
`backend/.env` hoạt động đúng.

---

## 2. Xác nhận đang đứng trong đúng Supabase project

### 2.1 Mở project hiện tại

1. Mở <https://supabase.com/dashboard>.
2. Chọn organization đang chứa `TPRO_Classio`.
3. Nhấn vào project TPRO Classio hiện tại.
4. Không nhấn `New project`.

### 2.2 Lấy Project Ref

Nhìn URL trình duyệt. URL có dạng:

```text
https://supabase.com/dashboard/project/abcdefghijklmnopqrst
```

Phần sau `/project/` là `PROJECT_REF`:

```text
abcdefghijklmnopqrst
```

Ghi Project Ref vào password manager hoặc ghi chú cá nhân, không cần thêm vào
repository.

Từ đây, các URL có chữ `<PROJECT_REF>` phải được thay bằng chuỗi thực tế và
**không giữ dấu `<` `>`**.

Ví dụ:

```text
Sai:  https://supabase.com/dashboard/project/<PROJECT_REF>/auth/providers
Đúng: https://supabase.com/dashboard/project/abcdefghijklmnopqrst/auth/providers
```

- [X] Đã mở đúng project.
- [X] Đã biết Project Ref.

---

## 3. Kiểm tra Project URL và API keys hiện có

### 3.1 Mở trang API Keys

Trong Dashboard:

```text
Project Settings (biểu tượng bánh răng ở gần cuối sidebar)
→ API Keys
```

Hoặc mở trực tiếp:

```text
https://supabase.com/dashboard/project/<PROJECT_REF>/settings/api-keys
```

Nếu trang hiện `Select a project to continue`, bạn nhập sai Project Ref hoặc
vẫn để ký tự `_`/`<PROJECT_REF>` trong URL.

### 3.2 Kiểm tra Project URL

Trong trang API Keys hoặc nút `Connect` phía trên Dashboard, tìm `Project URL`.
Giá trị thường có dạng:

```text
https://<PROJECT_REF>.supabase.co
```

Mở `backend/.env`, đối chiếu:

```env
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
```

Nếu giá trị hiện tại trùng, giữ nguyên. Nếu khác project hiện tại, dừng lại và
kiểm tra bạn có đang mở nhầm Supabase project hay không.

### 3.3 Kiểm tra anon key hiện tại

Trong trang API Keys:

1. Chọn tab `Legacy API Keys`.
2. Tìm key `anon`.
3. Key thường là JWT dài bắt đầu bằng `eyJ...`.
4. Đối chiếu với `SUPABASE_ANON_KEY` trong `backend/.env`.

```env
SUPABASE_ANON_KEY=eyJ...
```

Nếu hai giá trị trùng thì giữ nguyên.

### 3.4 Bổ sung service_role nếu còn thiếu

Vẫn tại `Legacy API Keys`:

1. Tìm `service_role`.
2. Nhấn `Reveal` nếu cần.
3. Nhấn `Copy`.
4. Dán vào `backend/.env`:

```env
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Không dán key này vào frontend hoặc `.env` root.

### 3.5 Không dùng nhầm key mới ở thời điểm hiện tại

Dashboard 2026 ưu tiên hiển thị:

```text
sb_publishable_...
sb_secret_...
```

Code hiện tại vẫn có một số Supabase Admin/Storage request gửi legacy
`service_role` trong `Authorization: Bearer`. Vì vậy, để local chạy ngay, dùng:

```env
SUPABASE_ANON_KEY=<legacy anon bắt đầu eyJ>
SUPABASE_SERVICE_ROLE_KEY=<legacy service_role bắt đầu eyJ>
```

Không dán `sb_secret_...` vào `SUPABASE_SERVICE_ROLE_KEY` lúc này vì có thể gây
`Invalid JWT`. Trước khi phát hành production cuối năm 2026 phải có task riêng
chuyển code sang publishable/secret key mới.

Tham khảo chính thức:

- <https://supabase.com/docs/guides/getting-started/api-keys>
- <https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys>

Checkpoint:

- [X] `SUPABASE_URL` trỏ đúng project hiện tại.
- [X] `SUPABASE_ANON_KEY` là legacy `anon` của cùng project.
- [X] Đã thêm `SUPABASE_SERVICE_ROLE_KEY` legacy của cùng project.
- [X] Không có key nào được đưa vào frontend.

---

## 4. Cấu hình Email provider trong giao diện Supabase mới

### 4.1 Mở đúng trang Providers

Trong sidebar:

```text
Authentication
→ Sign In / Providers
```

Đường dẫn trực tiếp:

```text
https://supabase.com/dashboard/project/<PROJECT_REF>/auth/providers
```

### 4.2 Nếu không nhìn thấy mục Email

Kiểm tra lần lượt:

1. URL phải chứa `/dashboard/project/<PROJECT_REF>/`, không phải organization home.
2. Mở trực tiếp URL `/auth/providers` ở trên.
3. Tìm khu vực `Native providers`, không chỉ nhìn danh sách Social Providers.
4. Tìm card có tên `Email` hoặc `Email / Password`.
5. Nhấn vào toàn bộ card Email để mở panel cấu hình.
6. Nếu vẫn không có, kiểm tra quyền tài khoản Supabase tại:

```text
Organization Settings → Members
```

Tài khoản cần quyền Owner hoặc Administrator phù hợp.

### 4.3 Thiết lập Email provider

Trong card/panel Email, tên nút có thể thay đổi nhẹ nhưng đặt theo ý nghĩa sau:

```text
Enable Email provider        = ON
Allow new users to sign up   = ON
Confirm email                = ON
Secure email change          = ON
Mailer autoconfirm           = OFF (nếu có)
```

Trong cấu hình chung, nếu có:

```text
Allow anonymous sign-ins = OFF
```

Nhấn `Save` và đợi thông báo lưu thành công.

Giải thích:

- Supabase vẫn cần cho phép signup để tạo `auth.users`.
- Backend TPRO chặn signup không có invitation token, nên bật Supabase signup
  không đồng nghĩa ai cũng vào được hệ thống.
- `Confirm email` phải bật để OTP email có ý nghĩa.
- Không bật auto-confirm.

Tài liệu chính thức:
<https://supabase.com/docs/guides/auth/general-configuration>

Checkpoint:

- [X] Email provider đang bật.
- [X] Signup đang bật.
- [X] Confirm email đang bật.
- [X] Anonymous sign-in đang tắt.

---

## 5. Cấu hình URL Authentication

Mở:

```text
Authentication → URL Configuration
```

Hoặc:

```text
https://supabase.com/dashboard/project/<PROJECT_REF>/auth/url-configuration
```

### 5.1 Site URL local

Điền chính xác:

```text
http://localhost:3000
```

Không dùng `127.0.0.1` ở ô này và không thêm dấu `/` cuối.

### 5.2 Redirect URLs local

Tại phần Redirect URLs:

1. Nhấn `Add URL`.
2. Nhập:

```text
http://localhost:3000/**
```

3. Nhấn `Save`.

Production sau này không dùng wildcard rộng; local mới dùng `/**`.

Tham khảo:
<https://supabase.com/docs/guides/auth/redirect-urls>

- [X] Site URL là `http://localhost:3000`.
- [X] Redirect allowlist có `http://localhost:3000/**`.

---

## 6. Cấu hình SMTP — làm trước khi sửa Email Templates

### 6.1 Vì sao cần SMTP riêng

Với Supabase Free/project mới năm 2026:

- SMTP mặc định chủ yếu chỉ gửi tới email thuộc team của Supabase organization.
- Giới hạn mặc định hiện rất thấp, khoảng 2 email/giờ.
- Project Free mới dùng SMTP mặc định có thể bị khóa chỉnh template.
- Muốn test nhiều email thật và dùng production phải cấu hình custom SMTP.

Tham khảo:

- <https://supabase.com/docs/guides/auth/auth-smtp>
- <https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier>

### 6.2 Chọn SMTP provider

Các lựa chọn phù hợp: Resend, Postmark, Amazon SES, SendGrid hoặc Brevo.

Bạn cần nhận từ provider 6 giá trị:

```text
SMTP host
SMTP port
SMTP username
SMTP password/API key
Sender email
Sender name
```

Khuyến nghị tách email Auth khỏi marketing, ví dụ:

```text
no-reply@auth.tenmiencuaban.vn
```

### 6.3 Cấu hình DNS tại nhà cung cấp tên miền

Trong SMTP provider, thêm domain gửi email rồi sao chép các DNS record được cấp
sang nơi quản lý DNS của tên miền:

```text
SPF
DKIM
DMARC
```

Đợi provider báo domain `Verified` trước khi tiếp tục.

Nếu chưa có tên miền, local có thể tạm dùng sender/domain test do SMTP provider
cho phép, nhưng production bắt buộc xác minh domain riêng.

### 6.4 Điền SMTP vào Supabase

Mở:

```text
Authentication → Custom SMTP
```

Hoặc:

```text
https://supabase.com/dashboard/project/<PROJECT_REF>/auth/smtp
```

1. Bật `Enable Custom SMTP`.
2. Điền Sender email.
3. Sender name: `TPRO Classio`.
4. Điền Host.
5. Điền Port theo provider, thường là 587 cho STARTTLS.
6. Điền Username.
7. Điền Password/API key.
8. Nhấn `Save`.

Không ghi SMTP password vào repository; giá trị này được lưu trực tiếp trong
Supabase Dashboard.

### 6.5 Rate Limits

Mở:

```text
Authentication → Rate Limits
```

Hoặc tìm `Rate Limits` trong submenu Authentication.

Local giai đoạn đầu nên giữ mặc định. Xác nhận resend interval tối thiểu khoảng
60 giây. Không tăng rate limit cao chỉ để né lỗi; kiểm tra SMTP và UI trước.

Tham khảo:
<https://supabase.com/docs/guides/auth/rate-limits>

Checkpoint:

- [X] SMTP provider đã xác minh sender/domain.
- [X] Custom SMTP đã bật trong Supabase.
- [X] Supabase lưu cấu hình thành công.
- [X] Không nâng rate limit thiếu kiểm soát.

---

## 7. Cấu hình nội dung OTP email

Mở:

```text
Authentication → Email Templates
```

Hoặc:

```text
https://supabase.com/dashboard/project/<PROJECT_REF>/auth/templates
```

Nếu template bị khóa/không có nút Save trên project Free mới, quay lại mục 6 và
cấu hình Custom SMTP trước.

### 7.1 Confirm signup

Chọn `Confirm signup`.

Subject:

```text
Mã xác thực đăng ký TPRO Classio
```

Body:

```html
<h2>Xác thực tài khoản TPRO Classio</h2>
<p>Mã xác thực của bạn là:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;">
  {{ .Token }}
</p>
<p>Mã có hiệu lực trong 10 phút.</p>
<p>Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</p>
```

Nhấn `Save`.

### 7.2 Reset password

Chọn `Reset password`.

Subject:

```text
Mã xác thực đặt lại mật khẩu TPRO Classio
```

Body:

```html
<h2>Đặt lại mật khẩu TPRO Classio</h2>
<p>Mã xác thực của bạn là:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;">
  {{ .Token }}
</p>
<p>Mã có hiệu lực trong 10 phút.</p>
<p>Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>
```

Nhấn `Save`.

Không dùng `{{ .ConfirmationURL }}` làm luồng chính của dự án. `{{ .Token }}`
là OTP 6 chữ số.

Tham khảo:
<https://supabase.com/docs/guides/auth/auth-email-templates>

### 7.3 Invitation template

Không cần chỉnh `Invite user` của Supabase cho luồng hiện tại. TPRO backend tự
tạo link `/register?token=...&email=...`, Dev/Owner sao chép link đó gửi cho
người được mời.

- [X] Confirm signup dùng `{{ .Token }}`.
- [X] Reset password dùng `{{ .Token }}`.
- [ ] Đã tắt email link tracking tại SMTP provider nếu provider bật mặc định. -> sử dụng SMTP mail cá nhân nên chưa cần chỉnh sửa

---

## 8. Cấu hình Supabase MFA/TOTP

Mở:

```text
Authentication → Multi-Factor
```

Hoặc:

```text
https://supabase.com/dashboard/project/<PROJECT_REF>/auth/mfa
```

Supabase hiện bật TOTP MFA API mặc định cho project. Nếu không thấy nút bật TOTP
thì có thể là trạng thái bình thường.

Nếu giao diện có lựa chọn:

```text
TOTP Enrollment   = Enabled
TOTP Verification = Enabled
```

Không bật Phone MFA cho dự án này.

Tham khảo:

- <https://supabase.com/docs/guides/auth/auth-mfa>
- <https://supabase.com/docs/guides/auth/auth-mfa/totp>

- [X] TOTP enrollment không bị Disabled.
- [X] TOTP verification không bị Disabled.

---

## 9. Tạo private bucket lưu avatar

Trong sidebar:

```text
Storage → Buckets
```

1. Nhấn `New bucket` hoặc `Create bucket`.
2. Bucket name: `avatars`.
3. `Public bucket`: OFF.
4. File size limit: `5 MB`.
5. Allowed MIME types: thêm `image/webp`.
6. Nhấn `Create bucket`.

Không tạo policy INSERT/UPDATE/DELETE cho `anon` hoặc browser `authenticated`.
Backend upload bằng service-role key và avatar được phục vụ qua endpoint đã xác
thực của TPRO.

Tham khảo:

- <https://supabase.com/docs/guides/storage/buckets/creating-buckets>
- <https://supabase.com/docs/guides/storage/buckets/fundamentals>
- <https://supabase.com/docs/guides/storage/security/access-control>

- [X] Bucket tên chính xác `avatars`.
- [X] Bucket đang Private.
- [X] MIME chỉ cho `image/webp`.
- [X] Giới hạn 5 MB.

---

## 10. Tạo Google OAuth client cho local

Google Cloud project khác Supabase project. Bạn cần tạo Google Cloud project nếu
chưa có OAuth client cho TPRO Classio.

### 10.1 Tạo/chọn Google Cloud project

1. Mở <https://console.cloud.google.com/>.
2. Nhấn project selector trên thanh trên cùng.
3. Nếu đã có project TPRO Classio, chọn nó.
4. Nếu chưa có, nhấn `New Project`.
5. Project name: `TPRO Classio Local`.
6. Nhấn `Create`, sau đó chọn project vừa tạo.

### 10.2 Mở Google Auth Platform

Trong menu hoặc thanh tìm kiếm Google Cloud, tìm:

```text
Google Auth Platform
```

Nếu hiện `Get started`, nhấn vào đó.

### 10.3 Branding

Mở `Branding` và điền:

```text
App name: TPRO Classio
User support email: email quản trị
Developer contact information: email quản trị
```

Local có thể bổ sung logo/homepage/privacy policy sau, nhưng production phải có
đầy đủ. Nhấn `Save`.

### 10.4 Audience

Mở `Audience`:

1. Chọn `External` nếu người dùng không nằm trong một Google Workspace nội bộ.
2. Giữ app ở trạng thái Testing cho local.
3. Trong `Test users`, thêm email Owner và các email sẽ dùng test.
4. Nhấn `Save`.

Nếu email không nằm trong Test users khi app còn Testing, Google có thể chặn
onboarding.

### 10.5 Data Access/Scopes

Mở `Data Access` hoặc phần scopes. Chỉ cần:

```text
openid
.../auth/userinfo.email
.../auth/userinfo.profile
```

Không xin Drive, Calendar, Gmail hoặc scope không liên quan.

### 10.6 Tạo Web client

Mở `Clients`:

1. Nhấn `Create Client`.
2. Application type: `Web application`.
3. Name: `TPRO Classio Local Web`.
4. Authorized JavaScript origins: có thể để trống vì callback xử lý server-side.
5. Authorized redirect URIs → `Add URI`.
6. Nhập chính xác:

```text
http://localhost:3000/auth/google/callback
```

7. Không dùng callback Supabase `/auth/v1/callback`.
8. Nhấn `Create`.
9. Sao chép Client ID.
10. Sao chép Client Secret ngay khi Google hiển thị.

Google yêu cầu redirect URI khớp tuyệt đối cả scheme, host, port, path và dấu
`/` cuối. Tham khảo:

- <https://developers.google.com/identity/openid-connect/openid-connect>
- <https://developers.google.com/identity/protocols/oauth2/web-server>

- [X] Google app đang Testing.
- [X] Owner/test emails đã nằm trong Test users.
- [X] Scope chỉ có openid/email/profile.
- [X] Redirect URI đúng `http://localhost:3000/auth/google/callback`.
- [X] Đã lưu Client ID và Client Secret an toàn.

---

## 11. Hoàn thiện `backend/.env` mà không ghi đè dữ liệu cũ

Mở file hiện có:

```text
backend/.env
```

Giữ nguyên các giá trị đang hoạt động:

```env
DATABASE_URL=...
SECRET_KEY=...
ALGORITHM=...
OWNER_ADMIN_EMAIL=...
ACCESS_TOKEN_EXPIRE_MINUTES=...
FRONTEND_URL=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

### 11.1 Tạo AUTH_ENCRYPTION_KEY mới

Chạy:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Sao chép kết quả vào:

```env
AUTH_ENCRYPTION_KEY=<chuỗi vừa tạo>
```

`AUTH_ENCRYPTION_KEY` phải khác `SECRET_KEY`.

### 11.2 Bổ sung các biến còn thiếu

`backend/.env` cuối cùng cần có đủ cấu trúc sau. Giữ giá trị thật đang có và chỉ
điền phần còn thiếu:

```env
APP_ENVIRONMENT=local

DATABASE_URL=<giữ URL database hiện tại ở giai đoạn này>

SECRET_KEY=<giữ secret hiện tại>
AUTH_ENCRYPTION_KEY=<secret mới độc lập>
ALGORITHM=HS256
INTERNAL_TOKEN_ISSUER=tpro-classio-api
INTERNAL_TOKEN_AUDIENCE=tpro-classio-web

ACCESS_TOKEN_EXPIRE_MINUTES=30
SESSION_ABSOLUTE_EXPIRE_DAYS=30
EMAIL_OTP_EXPIRE_SECONDS=600
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES=10

FRONTEND_URL=http://localhost:3000
ALLOWED_HOSTS=localhost,127.0.0.1,backend

SUPABASE_URL=<Project URL project hiện tại>
SUPABASE_ANON_KEY=<legacy anon project hiện tại>
SUPABASE_SERVICE_ROLE_KEY=<legacy service_role project hiện tại>

OWNER_ADMIN_EMAIL=<email Google chính xác của Owner>

GOOGLE_CLIENT_ID=<Google Web Client ID>
GOOGLE_CLIENT_SECRET=<Google Client Secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

TOTP_ISSUER=TPRO Classio
INVITATION_EXPIRE_HOURS=24
ONBOARDING_SESSION_MINUTES=15
LOGIN_MFA_SESSION_MINUTES=5

AUTH_COOKIE_SECURE=false

AVATAR_STORAGE_BUCKET=avatars
AVATAR_SYNC_HOURS=12
```

Không đặt dấu cách quanh `=`. Không bao key bằng dấu nháy nếu không cần. Mỗi
biến nằm trọn trên một dòng.

Checkpoint:

- [X] Đã giữ nguyên cấu hình cũ còn đúng.
- [X] Đã thêm service-role key.
- [X] Đã thêm encryption key độc lập.
- [X] Đã thêm Google client values.
- [X] Cookie Secure đang false cho HTTP localhost.

---

## 12. Hoàn thiện `.env` ở thư mục gốc cho Docker

File này nằm tại:

```text
D:\Projects\tpro-classio\.env
```

Nếu đã có, mở và bổ sung chứ không ghi đè tùy tiện. Nội dung local cần có:

```env
AUTH_COOKIE_SECURE=false
NEXT_INTERNAL_API_URL=http://backend:8000

FRONTEND_HOST=127.0.0.1
FRONTEND_PORT=3000

BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
```

Không đặt Supabase key hoặc Google secret trong `.env` root.

Nếu chạy Next trực tiếp bằng npm thay vì Docker, tạo `frontend/.env.local`:

```env
NEXT_INTERNAL_API_URL=http://localhost:8000
AUTH_COOKIE_SECURE=false
```

- [X] `.env` root chỉ chứa cấu hình runtime Compose.
- [X] Không có secret Supabase/Google trong frontend.

---

## 13. Backup database hiện tại

Đây là database đã có dữ liệu của dự án, vì vậy không chạy migration trước khi
có backup.

Trong Dashboard, xem khả năng backup tại Database/Backups theo plan. Ngoài ra có
thể dùng `pg_dump` với connection string lấy từ nút `Connect`.

Nút `Connect` nằm ở phần trên của Supabase project. Supabase cung cấp:

```text
Direct connection
Session pooler
Transaction pooler
```

Cho migration/`pg_dump`, ưu tiên Direct connection. Direct connection có thể
chỉ hỗ trợ IPv6. Nếu mạng/Docker host không đi IPv6 được, dùng Session pooler
port 5432. Không dùng Transaction pooler port 6543 cho migration hoặc backend
SQLAlchemy có prepared statement.

Tham khảo:
<https://supabase.com/docs/guides/database/connecting-to-postgres>

- [X] Đã có backup có thể restore.
- [X] Đã lưu database password trong password manager.

---

## 14. Áp dụng migration 035 lên chính database hiện tại

Database hiện tại đã có các migration cũ nhưng còn thiếu bảng
`auth_flow_sessions`. Không chạy lại toàn bộ 001–034. Chỉ chạy migration 035 rồi
chạy verifier.

### Cách A — Supabase SQL Editor (dễ nhất)

1. Mở file trong IDE:

```text
backend/supabase/migrations/035_enforce_google_totp_onboarding.sql
```

2. Chọn toàn bộ nội dung file và Copy.
3. Trong Supabase sidebar mở `SQL Editor`.
4. Nhấn `New query`.
5. Dán toàn bộ migration.
6. Kiểm tra đang chọn đúng project hiện tại.
7. Nhấn `Run` đúng một lần.
8. Chờ thông báo thành công.

Không bấm Run nhiều lần liên tiếp khi chưa đọc kết quả.

### Cách B — psql

Nhấn `Connect` trong Supabase, lấy Direct connection. Sau đó:

```powershell
$env:PGPASSWORD = "<database password>"

psql `
  -v ON_ERROR_STOP=1 `
  -h "db.<PROJECT_REF>.supabase.co" `
  -p 5432 `
  -U postgres `
  -d postgres `
  -f backend\supabase\migrations\035_enforce_google_totp_onboarding.sql
```

Nếu Direct connection lỗi do mạng IPv4-only, dùng Session pooler host/username
hiển thị trong cửa sổ `Connect`, port 5432.

### Kiểm tra migration

Trong Table Editor hoặc SQL Editor, kiểm tra các bảng đã tồn tại:

```sql
select to_regclass('public.auth_flow_sessions');
select to_regclass('public.account_invitations');
select to_regclass('public.google_identities');
select to_regclass('public.totp_factors');
select to_regclass('public.recovery_codes');
```

Mỗi dòng phải trả về tên bảng, không phải `null`.

- [X] Migration 035 chạy đúng một lần và thành công.
- [X] `auth_flow_sessions` đã tồn tại.

---

## 15. Chạy security verifier

### Qua SQL Editor

1. Mở file:

```text
backend/tests/sql/verify_security.sql
```

2. Copy toàn bộ.
3. Supabase → SQL Editor → New query.
4. Dán và nhấn `Run`.
5. Đọc toàn bộ kết quả; không bỏ qua lỗi RLS/grants.

### Qua psql

```powershell
$env:PGPASSWORD = "<database password>"

psql `
  -v ON_ERROR_STOP=1 `
  -h "db.<PROJECT_REF>.supabase.co" `
  -p 5432 `
  -U postgres `
  -d postgres `
  -f backend\tests\sql\verify_security.sql
```

- [X] Verifier kết thúc không lỗi.
- [X] Supabase Security Advisor không còn cảnh báo bảng public thiếu RLS.

---

## 16. Database role cho backend

`DATABASE_URL` hiện tại có thể đang dùng `postgres`. Local vẫn chạy nhưng quyền
quá cao. Sau khi migration và verifier thành công, nên chuyển sang role backend
riêng có `BYPASSRLS` nhưng không phải superuser.

### 16.1 Tạo password cho role

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Lưu vào password manager.

### 16.2 Tạo role bằng database owner

Chạy một lần bằng SQL Editor/database owner, thay placeholder password:

```sql
create role tpro_backend
  login password '<MAT_KHAU_NGAU_NHIEN>'
  nosuperuser nocreatedb nocreaterole noinherit bypassrls;

grant connect on database postgres to tpro_backend;
grant usage on schema public, auth to tpro_backend;

grant select, insert, update, delete
on all tables in schema public to tpro_backend;

grant usage, select
on all sequences in schema public to tpro_backend;

grant select (id, email, deleted_at, email_confirmed_at)
on auth.users to tpro_backend;

alter default privileges for role postgres in schema public
grant select, insert, update, delete on tables to tpro_backend;

alter default privileges for role postgres in schema public
grant usage, select on sequences to tpro_backend;
```

Nếu role đã tồn tại, không chạy lại `create role`; chạy lại các câu `grant` và
dùng `alter role tpro_backend password '...'` nếu cần xoay mật khẩu.

Không dùng cách paste password vào SQL Editor cho production; production dùng
secret manager/controlled admin process. Cách trên dành cho local hiện tại.

### 16.3 Đổi DATABASE_URL

Lấy Session pooler hoặc Direct connection host từ nút `Connect`, rồi đổi
`backend/.env`:

```env
DATABASE_URL=postgresql+asyncpg://tpro_backend:<PASSWORD>@<HOST>:5432/postgres
```

Nếu password chứa ký tự đặc biệt phải URL-encode. Để local đơn giản, tạo password
chỉ gồm ký tự URL-safe do `token_urlsafe` sinh ra.

- [X] Role `tpro_backend` tồn tại.
- [X] Role không phải superuser.
- [X] Role có `BYPASSRLS` và chỉ grant cần thiết.
- [X] `DATABASE_URL` đã chuyển sang `tpro_backend`.

---

## 17. Build và khởi động Docker

Tại thư mục gốc:

```powershell
docker compose config -q
docker compose up -d --build
docker compose ps
```

Kết quả cần thấy:

```text
backend  healthy
frontend healthy
```

Kiểm tra log:

```powershell
docker compose logs backend --tail 150
docker compose logs frontend --tail 150
```

Không được còn lỗi:

```text
relation "auth_flow_sessions" does not exist
Invalid JWT
redirect_uri_mismatch
```

Kiểm tra URL:

```text
http://localhost:3000/login
http://localhost:8000/health/ready
```

- [X] Hai container healthy.
- [X] Backend readiness trả 200.
- [X] Trang login mở được.
- [X] Log không còn lỗi migration/key.

---

## 18. Bootstrap Dev/Owner đầu tiên

### 18.1 Nếu Owner hiện tại đã tồn tại

Mở:

```text
Supabase → Authentication → Users
```

Tìm email trùng chính xác với:

```env
OWNER_ADMIN_EMAIL=...
```

Nếu user đã tồn tại, không tạo user thứ hai. Kiểm tra email đã confirmed.

### 18.2 Nếu Owner chưa tồn tại

1. Authentication → Users.
2. Nhấn `Add user`.
3. Chọn tạo user bằng email/password.
4. Email phải trùng chính xác `OWNER_ADMIN_EMAIL`.
5. Đặt mật khẩu mạnh.
6. Đánh dấu email confirmed nếu Dashboard có lựa chọn.
7. Lưu.

### 18.3 Hoàn tất onboarding Owner

1. Mở `http://localhost:3000/login`.
2. Nhập email/mật khẩu Owner.
3. Hệ thống phải chuyển vào onboarding, chưa cấp dashboard session ngay.
4. Nhấn liên kết Google.
5. Chọn Google Account đúng cùng email.
6. Nếu Google app còn Testing, email này phải nằm trong Test users.
7. Sau callback, avatar phải được đồng bộ hoặc hiển thị fallback hợp lệ.
8. Quét QR bằng Google Authenticator.
9. Nhập mã TOTP 6 chữ số.
10. Lưu toàn bộ recovery codes vào password manager/offline secure storage.
11. Xác nhận đã lưu recovery codes.
12. Hệ thống mới cho vào dashboard.
13. Logout.
14. Login lại bằng email/mật khẩu.
15. Xác nhận lần này bắt buộc nhập Google Authenticator.

Không chỉnh tay `totp_enrolled_at` và không tạo bypass cho Owner.

- [X] Owner liên kết đúng Google email.
- [X] Avatar hoạt động.
- [X] Owner đã enroll TOTP.
- [X] Recovery codes đã lưu.
- [X] Logout/login lại bắt buộc TOTP.

---

## 19. Mời và đăng ký Viewer đầu tiên

### 19.1 Owner tạo lời mời

1. Đăng nhập Owner.
2. Mở trang Cài đặt/phân quyền.
3. Nhấn `Mời thành viên`.
4. Nhập email Viewer.
5. Tạo lời mời.
6. Hệ thống trả về link có dạng:

```text
http://localhost:3000/register?token=...&email=...
```

7. Sao chép link và mở trong trình duyệt riêng/incognito để test.

### 19.2 Viewer đăng ký

1. Mở đúng invitation URL.
2. Kiểm tra email hiển thị đúng email được mời.
3. Nhập username.
4. Nhập mật khẩu hợp lệ.
5. Xác nhận mật khẩu.
6. Nhấn Đăng ký.
7. Mở email và lấy OTP 6 số.
8. Nhập OTP trước khi hết 10 phút.
9. Liên kết Google Account có đúng cùng email.
10. Quét QR Authenticator.
11. Nhập TOTP.
12. Lưu recovery codes.
13. Xác nhận đã lưu.
14. Vào dashboard với role Viewer.

- [ ] Viewer đăng ký chỉ khi có invite hợp lệ.
- [ ] OTP email gửi và xác minh thành công.
- [ ] Google khác email bị từ chối.
- [ ] Viewer bắt buộc TOTP.
- [ ] Viewer vào hệ thống với role Viewer.

---

## 20. Ma trận kiểm thử bắt buộc trên local

- [ ] Mở `/register` không có token → không đăng ký được.
- [ ] Invite hết hạn/bị thu hồi/đã dùng → bị từ chối.
- [ ] Email khác email trong invite → bị từ chối.
- [ ] OTP sai → báo lỗi đúng, không tạo session app.
- [ ] OTP hết hạn → yêu cầu gửi lại.
- [ ] Google email khác email OTP → bị từ chối.
- [ ] Không thể gọi TOTP trước khi hoàn tất Google.
- [ ] TOTP sai nhiều lần bị rate limit.
- [ ] Chưa xác nhận recovery codes → chưa vào dashboard.
- [ ] Recovery code chỉ sử dụng được một lần.
- [ ] Logout rồi login lại bắt buộc TOTP với mọi role.
- [ ] Access token hết hạn được refresh khi session còn hợp lệ.
- [ ] Hết absolute session → quay lại login + TOTP.
- [ ] Reset password không tự động login.
- [ ] Sau reset password, login vẫn bắt buộc TOTP.
- [ ] Avatar không mở được bằng public Storage URL.
- [ ] Xóa avatar Google nguồn → hệ thống fallback hợp lệ sau sync.
- [ ] User disabled trong onboarding không thể tự kích hoạt bằng recovery confirm.
- [ ] Xóa hard-delete user → email có thể được mời và đăng ký lại.
- [ ] Supabase Security Advisor không báo bảng public thiếu RLS.

---

## 21. Lỗi thường gặp và cách xác định

### Không thấy Email trong Sign In / Providers

- Đảm bảo đã mở project, không đứng ở organization home.
- Mở trực tiếp `/dashboard/project/<PROJECT_REF>/auth/providers`.
- Tìm `Native providers` và card `Email`/`Email / Password`.
- Kiểm tra quyền Owner/Admin của Supabase account.

### Không chỉnh được Email Template

- Project Free mới có thể bị khóa khi dùng SMTP mặc định.
- Cấu hình Custom SMTP trước.
- Kiểm tra template HTML và biến `{{ .Token }}`.

### Email address not authorized

- Bạn đang dùng SMTP mặc định Supabase.
- SMTP mặc định chỉ gửi tới email thuộc team organization.
- Cấu hình Custom SMTP hoặc thêm email test vào team trong giai đoạn tạm thời.

### Không nhận email

- Kiểm tra Authentication → Logs/Audit Logs.
- Kiểm tra SMTP provider log.
- Kiểm tra SPF/DKIM/DMARC.
- Kiểm tra spam folder.
- Kiểm tra rate limit và resend interval 60 giây.

### `Invalid JWT`

- Có thể đã dán `sb_secret_...` vào biến legacy.
- Local hiện tại phải dùng legacy `anon`/`service_role` bắt đầu `eyJ...`.

### `relation auth_flow_sessions does not exist`

- Migration 035 chưa được áp dụng trên đúng database mà `DATABASE_URL` đang trỏ tới.
- Chạy lại phần kiểm tra `to_regclass`, không bấm migration nhiều lần mù quáng.

### Google `redirect_uri_mismatch`

Hai bên phải trùng tuyệt đối:

```env
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

và Google Client Authorized redirect URI:

```text
http://localhost:3000/auth/google/callback
```

Không thêm dấu `/`, không dùng `127.0.0.1`, không dùng callback Supabase.

### Google báo app chưa được phép

- App đang Testing nhưng email chưa nằm trong `Audience → Test users`.
- Thêm email rồi thử lại.

### Avatar không hiện

- Google email phải trùng email OTP.
- Scope phải có `profile`.
- Bucket phải tên `avatars` và private.
- Service-role key phải đúng project.
- Kiểm tra backend log avatar sync.

### Cookie/session không giữ ở localhost

Hai nơi đều phải là false:

```env
backend/.env: AUTH_COOKIE_SECURE=false
.env root:    AUTH_COOKIE_SECURE=false
```

Sau khi đổi phải recreate container.

### Direct database connection timeout

- Direct endpoint Supabase thường cần IPv6.
- Nếu mạng hiện tại IPv4-only, lấy Session pooler trong nút Connect, port 5432.
- Không dùng Transaction pooler port 6543 cho migration/backend prepared statements.

---

## 22. Chỉ sau khi local đạt mới tạo Staging và Production

Không dùng chung project local cho production.

Sau khi toàn bộ checklist local đạt, tạo:

```text
Supabase project riêng cho Staging
Supabase project riêng cho Production
Google OAuth client riêng cho Staging
Google OAuth client riêng cho Production
SMTP credential riêng
Database role/password riêng
SECRET_KEY và AUTH_ENCRYPTION_KEY riêng
```

Staging:

```env
APP_ENVIRONMENT=staging
FRONTEND_URL=https://staging.tenmien.vn
ALLOWED_HOSTS=staging.tenmien.vn,backend,127.0.0.1
AUTH_COOKIE_SECURE=true
GOOGLE_REDIRECT_URI=https://staging.tenmien.vn/auth/google/callback
```

Production:

```env
APP_ENVIRONMENT=production
FRONTEND_URL=https://tenmien.vn
ALLOWED_HOSTS=tenmien.vn,backend,127.0.0.1
AUTH_COOKIE_SECURE=true
GOOGLE_REDIRECT_URI=https://tenmien.vn/auth/google/callback
```

Không đưa localhost vào CORS/redirect production. Production phải dùng HTTPS và
secret manager, không dùng `.env` chép tay như local.

---

## 23. Production gates chưa được phép bật vội

- [ ] Chưa bật CAPTCHA Supabase cho đến khi frontend/BFF/backend hỗ trợ truyền token.
- [ ] Chưa phát hành production với legacy API keys mà chưa có kế hoạch chuyển sang key mới.
- [ ] Chưa xóa user bằng workflow tự động nếu chưa dọn avatar Storage và audit snapshot.
- [ ] Chưa coi recovery-code login là bình thường; cần security notification/re-enrollment trong hardening sau.

---

## 24. Các lệnh kiểm tra code trước khi phát hành

Backend:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m ruff check app tests
.venv\Scripts\python.exe -m ruff format --check app tests
.venv\Scripts\python.exe -m pip_audit -r requirements.txt
```

Frontend:

```powershell
cd frontend
npm ci
npm audit --omit=dev --audit-level=high
npm run type-check
npm run lint
npm test
npm run build
```

Docker:

```powershell
cd ..
docker compose config -q
docker compose up -d --build
docker compose ps
```

---

## 25. Thứ tự thực hiện ngắn gọn

Không nhảy bước. Đánh dấu lần lượt:

- [ ] 1. Giữ project Supabase hiện tại và backup `.env`/database.
- [ ] 2. Xác định Project Ref.
- [ ] 3. Kiểm tra URL, anon và bổ sung service-role key.
- [ ] 4. Bật Email provider + Confirm email.
- [ ] 5. Cấu hình Site URL/Redirect URL.
- [ ] 6. Cấu hình SMTP.
- [ ] 7. Chỉnh Confirm signup/Reset password dùng `{{ .Token }}`.
- [ ] 8. Xác nhận TOTP không bị disabled.
- [ ] 9. Tạo private bucket `avatars`.
- [ ] 10. Tạo Google OAuth client local.
- [ ] 11. Bổ sung đầy đủ `backend/.env` và `.env` root.
- [ ] 12. Backup database.
- [ ] 13. Chạy migration 035.
- [ ] 14. Chạy security verifier.
- [ ] 15. Tạo/chuyển sang role `tpro_backend`.
- [ ] 16. Rebuild Docker và đọc log.
- [ ] 17. Bootstrap Owner + TOTP + recovery codes.
- [ ] 18. Mời và đăng ký Viewer đầu tiên.
- [ ] 19. Chạy toàn bộ ma trận kiểm thử local.
- [ ] 20. Chỉ khi local đạt mới bắt đầu Staging.
