# TPRO Classio

[![CI](https://img.shields.io/github/actions/workflow/status/namtrungdn310/tpro-classio/ci.yml?branch=main&label=CI&logo=github)](https://github.com/namtrungdn310/tpro-classio/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python%203.12-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](https://www.postgresql.org/)

TPRO Classio là hệ thống nội bộ của TPRO English để quản lý học viên, lớp học,
nhân sự, lịch học, học phí và báo cáo vận hành.

> **Trạng thái:** dự án đang được hoàn thiện ở local và chuẩn bị cho staging.
> Chưa được xem là sẵn sàng production cho tới khi toàn bộ cổng kiểm định trong
> phần [Phát hành](#phát-hành) đã đạt trên một môi trường staging độc lập.

## Nghiệp vụ hiện có

- Quản lý học viên, nhiều lớp đang học và thông tin liên hệ học viên/phụ huynh.
- Quản lý lớp, nhiều giáo viên/trợ giảng, học phí và lịch học tuần.
- Theo dõi kỳ học phí, ghi nhận thanh toán, hoàn phí và lịch sử thao tác.
- Báo cáo chỉ đọc cho dữ liệu học phí và vận hành.
- Mời tài khoản hệ thống theo vai trò; đăng ký không phải luồng tuyển sinh học viên.
- Tạo nội dung Zalo để người vận hành kiểm tra và sao chép; hệ thống không tự gửi
  tin nhắn Zalo.

## Kiến trúc

```text
Browser
   │  HTTPS + HttpOnly cookies
   ▼
Nginx / load balancer
   ▼
Next.js 16 (React 18)
   │  server-side proxy
   ▼
FastAPI (Python 3.12)
   ├── PostgreSQL 16 / Supabase
   └── Supabase Auth, Storage và SMTP
```

Browser không truy cập trực tiếp dữ liệu nghiệp vụ trong schema `public`.
Frontend gọi Next.js proxy, sau đó proxy gọi FastAPI qua mạng nội bộ.

## Cấu trúc repository

```text
.
├── .github/                 # CI, Dependabot và mẫu pull request
├── backend/
│   ├── app/                 # FastAPI, model, service và router
│   ├── supabase/migrations/ # Migration PostgreSQL/Supabase
│   └── tests/               # Unit, integration và security verifier
├── frontend/
│   ├── src/                 # Next.js App Router và component
│   └── tests/               # Kiểm thử TypeScript
├── nginx/                   # Mẫu reverse proxy
├── systemd/                 # Mẫu chạy FastAPI trực tiếp trên Linux
└── docker-compose.yml       # Môi trường local
```

## Khởi động local bằng Docker

### Yêu cầu

- Docker Engine/Desktop có Docker Compose **>= 2.24.4** (deploy override dùng
  `!reset`/`!override`). Kiểm tra bằng `docker compose version` trước khi chạy.
- Một Supabase project dùng cho local/development.
- Google OAuth Web Client và SMTP đã cấu hình cho URL local.

### 1. Tạo file cấu hình

PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
```

macOS/Linux:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Điền giá trị thật vào `backend/.env`. Không đưa file này, database URL, service
role key, OAuth secret hoặc backup lên Git.

Những biến bắt buộc quan trọng:

| Nhóm | Biến |
| --- | --- |
| Database | `DATABASE_URL`, `DATABASE_SSL_MODE`, `DATABASE_SSL_ROOT_CERT` |
| Token nội bộ | `SECRET_KEY`, `AUTH_ENCRYPTION_KEY` |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Ứng dụng | `FRONTEND_URL`, `OWNER_ADMIN_EMAIL`, `ALLOWED_HOSTS` |

`SECRET_KEY` và `AUTH_ENCRYPTION_KEY` phải là hai giá trị ngẫu nhiên độc lập.
Mật khẩu nằm trong URL phải được percent-encode.
`APP_ENVIRONMENT` là bắt buộc và không có giá trị mặc định an toàn. Local dùng
`local`, CI dùng `test`; staging/production phải dùng đúng tên môi trường.
Staging/production bắt buộc `DATABASE_SSL_MODE=verify-full` và mount CA của nhà
cung cấp database vào đường dẫn chỉ đọc tại `DATABASE_SSL_ROOT_CERT`.
File `.env` ở root cấu hình Compose/BFF; `APP_ORIGIN` phải là origin trình duyệt
chính xác và dùng HTTPS ở staging/production. Biến này chỉ được đọc ở server
runtime để cùng một image có thể được promote giữa các môi trường.

Nếu local kết nối trực tiếp tới Supabase, không hạ TLS xuống `require`. Thực
hiện một lần trên máy phát triển:

1. Trong Supabase Dashboard của đúng project, mở **Connect** (hoặc
   **Database Settings → SSL Configuration**) và tải **Server root
   certificate** do Supabase cung cấp.
2. Lưu certificate thành `certs/prod-ca-2021.crt`. Thư mục `certs/` bị Git
   ignore nên certificate local không bị đưa vào commit.
3. Sao chép `docker-compose.supabase.example.yml` thành
   `docker-compose.override.yml`. File override cũng bị Git ignore và Docker
   Compose sẽ tự nạp.
4. Giữ
   `DATABASE_SSL_MODE=verify-full` và
   `DATABASE_SSL_ROOT_CERT=../certs/prod-ca-2021.crt` trong `backend/.env`.
   Đường dẫn tương đối được resolve từ thư mục chứa `backend/.env`, nên dùng
   được cả khi chạy pytest trên host và khi chạy backend trong container.
5. Chạy `docker compose config --quiet`, sau đó khởi động như mục dưới.

Không tải certificate từ nguồn không xác định và không dùng certificate tự
trích xuất từ kết nối mạng. Hướng dẫn chính thức:
<https://supabase.com/docs/guides/platform/ssl-enforcement>.

### 2. Kiểm tra và khởi động

```bash
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Kết quả mong đợi: `frontend` và `backend` đều chuyển sang trạng thái `healthy`.

- Ứng dụng: <http://localhost:3000>
- API local: <http://localhost:8000>
- Liveness: <http://localhost:8000/health/live>
- Readiness: <http://localhost:8000/health/ready>

```bash
docker compose logs --follow --tail 100
docker compose down
```

Staging/production dùng thêm override để mount database CA chỉ đọc và chọn đúng
backend env file. Hai môi trường này chỉ chạy image digest đã build, scan và ký;
không build lại source trên máy chủ. Ví dụ staging (chỉ sau khi đã tạo các file
local từ example và thay hai digest `BACKEND_IMAGE`/`FRONTEND_IMAGE`):

```bash
cp .env.staging.example .env.staging
cp backend/.env.staging.example backend/.env.staging
set -a
. ./.env.staging
set +a
python scripts/validate_deploy_env.py
docker compose \
  --env-file .env.staging \
  -f docker-compose.yml \
  -f docker-compose.deploy.yml \
  config --quiet
docker compose \
  --env-file .env.staging \
  -f docker-compose.yml \
  -f docker-compose.deploy.yml \
  pull
docker compose \
  --env-file .env.staging \
  -f docker-compose.yml \
  -f docker-compose.deploy.yml \
  up --no-build -d
```

`TPRO_IMAGE_REGISTRY_ALLOWLIST` mặc định chỉ cho `ghcr.io,docker.io`; đặt một
allowlist hẹp khác nếu tổ chức dùng private registry. Script preflight bắt buộc
hai image dùng digest SHA-256 thật, `APP_ORIGIN` là HTTPS và
`AUTH_COOKIE_SECURE=true`.

`DATABASE_CA_HOST_PATH` phải trỏ tới CA thật của database provider trên host.
Không đặt CA/key trong repository; target trong container luôn là
`/run/secrets/database-ca.crt` như backend env example. Preflight cùng Deploy
Compose sẽ dừng ngay nếu thiếu backend env file, image digest, public origin
hoặc secure-cookie policy; không dùng giá trị local mặc định cho
staging/production.

## Chạy kiểm định tại local

### Backend

```bash
cd backend
python -m pip install -r requirements-dev.txt
python -m ruff check app tests
python -m ruff format --check app tests
python -m bandit -q -r app -ll
python -m pytest -q
python -m pip_audit -r requirements-dev.txt
```

### Frontend

```bash
cd frontend
npm ci
npm run type-check
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

CI chạy lại các cổng trên, kiểm tra migration/security trên PostgreSQL 16 sạch
và build cả hai runtime image. Không merge khi bất kỳ job bắt buộc nào thất bại.

## Migration và toàn vẹn dữ liệu

- `backend/supabase/migrations` là nguồn schema duy nhất của dự án; không duy
  trì song song một Alembic history khác.
- Không tự động chạy migration từ application container ở staging/production.
- Backup trước migration và thử khôi phục backup trên staging.
- Chạy migration theo đúng thứ tự, dừng ngay tại lỗi đầu tiên.
- Sau migration, chạy
  [`backend/tests/sql/verify_security.sql`](backend/tests/sql/verify_security.sql).
- Migration `039_lock_private_avatar_storage.sql` còn khóa bucket `avatars`
  ở chế độ riêng tư và thu hồi quyền Storage trực tiếp; phải kiểm tra upload,
  proxy avatar và quyền trên staging clone của Supabase trước production.
- Không sửa migration đã áp dụng; tạo migration kế tiếp để hiệu chỉnh.
- Không cập nhật hoặc xóa trực tiếp ledger học phí. Các thao tác tài chính phải đi
  qua service/API để tạo `fee_operations` và các item append-only tương ứng.

## Bảo mật vận hành

- Registration là invite-only; onboarding kết hợp OTP email, liên kết Google và
  TOTP. Các lần đăng nhập sau yêu cầu MFA theo luồng hệ thống.
- Session dùng cookie HttpOnly. `AUTH_COOKIE_SECURE=false` chỉ được dùng cho HTTP
  localhost; staging/production bắt buộc HTTPS và giá trị `true`.
- Tất cả bảng nghiệp vụ trong `public` phải bật RLS và thu hồi quyền trực tiếp
  của `anon`/`authenticated`.
- FastAPI phải dùng role `tpro_backend` riêng, không phải `postgres`,
  `supabase_admin` hoặc database owner. Role này không được tạo role/database
  hay thay đổi schema; grant phải được kiểm tra sau mỗi migration.
- `SUPABASE_SERVICE_ROLE_KEY`, database password và OAuth client secret chỉ được
  cấp cho backend qua secret manager hoặc file root-owned ngoài repository.
- Không ghi query string của callback OAuth hoặc invitation URL vào access log.
- Không log OTP, token, cookie, authorization header hay thông tin nhạy cảm.
- Quét secret phải bao gồm toàn bộ Git history, không chỉ working tree hiện tại.

Xem quy trình báo cáo lỗ hổng và nguyên tắc xử lý secret tại
[`SECURITY.md`](SECURITY.md).

## Phát hành

Mỗi feature/module nên đi theo luồng:

1. Tạo branch nhỏ từ `dev`.
2. Hoàn thành một phạm vi có thể kiểm thử.
3. Chạy quality gates liên quan.
4. Commit nhỏ, rõ mục đích; push và mở pull request vào `dev`.
5. Chỉ merge khi CI xanh.
6. Phát hành từ pull request `dev` vào `main` sau khi staging đạt.

Repository owner cần tạo GitHub Ruleset cho `main`: chặn force-push/xóa branch,
bắt buộc pull request và bắt buộc các status check `frontend`, `backend`,
`security`, `containers` cùng hai check CodeQL theo tên hiển thị sau lần chạy
đầu tiên. Bật Dependency Graph, Dependabot alerts, secret scanning, push
protection và private vulnerability reporting trong phần Security của
repository. Các thiết lập này không thể được đảm bảo chỉ bằng file workflow.

Trước production phải hoàn thành tối thiểu:

- Tách biệt database, Supabase, OAuth client và secret giữa staging/production.
- HTTPS, secure cookie, host allowlist và reverse-proxy trusted IP đúng.
- Backup/restore rehearsal và migration rehearsal thành công.
- Kiểm tra phân quyền `dev`/`admin`/`viewer` và MFA end-to-end.
- Dependency, image, secret và SAST scan không còn lỗi Critical/High chưa xử lý.
- Smoke test login, học viên, lớp học, học phí, hoàn phí, báo cáo và logout.
- Monitoring, alert, log retention, rollback và quy trình ứng cứu sự cố đã sẵn sàng.

Checklist có điều kiện chặn và quy trình baseline migration nằm tại
[`docs/RELEASE_READINESS.md`](docs/RELEASE_READINESS.md).

Mẫu Nginx và systemd trong repository là điểm khởi đầu có hardening, không phải
cấu hình production dùng nguyên trạng. Domain, chứng chỉ, trusted proxy CIDR,
secret injection và giới hạn tài nguyên phải được cấu hình theo hạ tầng thực tế.
