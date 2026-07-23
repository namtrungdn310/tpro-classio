# 🏫 TPRO Classio

[![CI Pipeline Status](https://img.shields.io/github/actions/workflow/status/namtrungdn310/tpro-classio/ci.yml?branch=main&label=CI%20Pipeline&logo=github)](https://github.com/namtrungdn310/tpro-classio/actions)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2016-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%2016-4169E1?logo=postgresql)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/DevOps-Docker%20Compose-2496ED?logo=docker)](https://www.docker.com/)

**TPRO Classio** là hệ thống quản lý học vụ, điều phối lớp học và đối soát học phí tự động dành cho các trung tâm giáo dục hiện đại. Hệ thống được thiết kế với cơ chế bảo mật nghiêm ngặt (AAL2 MFA), kiến trúc phân lớp rõ ràng và khả năng chịu tải tốt thông qua sự kết hợp của Next.js, FastAPI và PostgreSQL.

---

## 🚀 Các Tính Năng Cốt Lõi

* **Quản Lý Học Viên & Tuyển Sinh**: Luồng mời học viên tham gia lớp thông qua mã QR/link, quản lý lịch sử học vụ và hồ sơ cá nhân bảo mật.
* **Ghi Nhận & Đối Soát Học Phí**: Ghi nhận nộp học phí trực tiếp hoặc hàng tháng, cơ chế xử lý hoàn phí (`Refund Ledger`) bất biến và gửi tin nhắn Zalo thông báo học phí tự động thông qua các mẫu tin nhắn (`Zalo Templates`).
* **Sắp Xếp Lịch Học & Nhân Sự**: Xếp lịch biểu động hỗ trợ các khóa học theo tuần hoặc theo tháng, phân công nhiều giáo viên/trợ giảng trong cùng một lớp học.
* **Bảo Mật Cấp Độ Cao (Enterprise-Grade Security)**: 
  * Xác thực đa yếu tố bắt buộc (MFA - AAL2) thông qua Google Authenticator và mã OTP Email.
  * Hạn chế tối đa đặc quyền truy cập cơ sở dữ liệu nhờ cơ chế Row Level Security (RLS) cưỡng chế trên PostgreSQL.
  * Nhật ký sự kiện bảo mật bất biến (`Append-only audit logs`).
* **Báo Cáo Tài Chính Lớp Học**: Trực quan hóa dòng tiền doanh thu thực tế, dự phóng dòng tiền học phí và theo dõi công nợ học viên theo thời gian thực.

---

## 🛠️ Công Nghệ Sử Dụng

### Frontend
- **Framework**: Next.js 16 (App Router, React 19)
- **Styling**: Tailwind CSS & Base UI
- **State Management**: TanStack React Query (v5)
- **Validation**: Zod & React Hook Form

### Backend
- **Framework**: FastAPI (Python 3.12)
- **ORM**: SQLAlchemy 2.0 (Async/Bất đồng bộ với `asyncpg`)
- **Database**: PostgreSQL 16 & Supabase Auth
- **Linter/Formatter**: Ruff

### DevOps & Testing
- **Local Dev**: Docker Compose (Multi-container setup)
- **CI/CD**: GitHub Actions (Ruff checks, Pytest, NPM audit, Next.js production build, Supabase migration verification)

---

## 📂 Cấu Trúc Thư Mục

```bash
tpro-classio/
├── .github/workflows/    # Cấu hình GitHub Actions CI/CD
├── backend/              # Mã nguồn Backend (FastAPI, Python)
│   ├── app/              # Logic cốt lõi (models, schemas, services, api)
│   ├── supabase/         # Các tệp PostgreSQL migration của Supabase
│   └── tests/            # Bộ kiểm thử Pytest (unit & integration tests)
├── frontend/             # Mã nguồn Frontend (Next.js, TypeScript)
│   ├── src/              # Các trang, thành phần UI và hàm tiện ích
│   └── tests/            # Bộ kiểm thử Node.js / tsx runner
└── README.md             # Tài liệu dự án
```

---

## 💻 Khởi Động Nhanh (Quick Start)

### 1. Yêu Cầu Hệ Thống
* Đã cài đặt **Docker** và **Docker Compose**.
* Đã cấu hình tệp môi trường `backend/.env` (tham khảo `backend/.env.example`).

### 2. Triển Khai Dưới Local
Khởi động toàn bộ các dịch vụ (frontend, backend, database) bằng Docker Compose:
```bash
docker compose up -d --build
```

Kiểm tra trạng thái hoạt động của các container:
```bash
docker compose ps
```
> Trạng thái mong đợi của cả hai dịch vụ `frontend` và `backend` là **healthy**.

* **Địa chỉ Frontend**: [http://localhost:3000](http://localhost:3000)
* **Tài liệu Swagger API (Backend docs)**: [http://localhost:8000/docs](http://localhost:8000/docs)

Dừng hệ thống:
```bash
docker compose down
```

---

## 🧪 Quy Trình Kiểm Định Chất Lượng (Quality Gates)

Trước khi gửi pull request hoặc phát hành phiên bản mới, mã nguồn cần vượt qua các bài kiểm thử nghiêm ngặt tại local và CI:

### Kiểm thử Backend
```bash
cd backend
# Chạy linting bằng Ruff
uv run ruff check app tests
# Kiểm tra định dạng mã nguồn
uv run ruff format --check app tests
# Chạy bộ unit tests
uv run pytest -q
```

### Kiểm thử Frontend
```bash
cd frontend
# Chạy type-check
npm run type-check
# Chạy linting
npm run lint
# Chạy bộ unit tests
npm test
```

---

## 🔒 Quy Trình Bảo Mật & Quy Định Migration (Quan Trọng)

### 1. Triển Khai Migrations Cẩn Trọng
* **Không** tự động chạy migration từ container ứng dụng trên môi trường production.
* Trước khi nâng cấp production, phải tạo bản sao lưu dữ liệu (`backup`) và kiểm tra khôi phục trên môi trường staging trước.
* Tiến hành chạy tuần tự từng file migration trong `backend/supabase/migrations` kèm cờ `ON_ERROR_STOP=1`, sau đó chạy script xác minh [verify_security.sql](file:///d:/Projects/tpro-classio/backend/tests/sql/verify_security.sql) để đảm bảo an toàn phân quyền.

### 2. Kiểm Soát Sổ Cái Học Phí (Fee Refund & Payment)
* Mọi bút toán hoàn phí, sửa lỗi hay thanh toán đều được lưu trữ vĩnh viễn dưới dạng sự kiện append-only trong bảng `payments`. 
* **Tuyệt đối không** cập nhật trực tiếp cột `refunded_amount` của bảng `fee_records`, và không được thay đổi/xóa lịch sử giao dịch. 

### 3. Quy Tắc Phân Quyền Row Level Security (RLS)
* Hệ thống **không** sử dụng Supabase Data API cho dữ liệu nghiệp vụ của bảng `public`. Tất cả các truy vấn từ client bắt buộc phải đi qua Next proxy đến FastAPI.
* Mọi bảng do dự án tạo lập trong schema `public` phải kích hoạt RLS và cấm mọi quyền truy cập đối với các vai trò `anon` hoặc `authenticated` của Supabase.
* Đường kết nối database của backend (`DATABASE_URL`) sử dụng tài khoản chuyên dụng `tpro_backend` có quyền `BYPASSRLS` và phân quyền chi tiết.

Để biết thêm thông tin chi tiết về cơ chế cấu hình SMTP, xác thực hai lớp (Google Identity, TOTP) và chống bot/CAPTCHA, vui lòng tham khảo tài liệu hướng dẫn **[AUTH_SETUP.md](AUTH_SETUP.md)**.
