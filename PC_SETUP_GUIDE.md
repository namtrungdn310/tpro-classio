# CẨM NANG THIẾT LẬP DỰ ÁN TPRO-CLASSIO TRÊN MÁY TÍNH PC

Tài liệu này hướng dẫn bạn từng bước đưa dự án từ nhánh `main` về máy tính PC mới một cách nhanh chóng, chính xác và đồng bộ 100% dữ liệu, cấu hình với máy Laptop.

---

## 1. Yêu cầu Hệ thống trên PC

Trước khi bắt đầu, hãy đảm bảo máy tính PC của bạn đã cài đặt các công cụ sau:
1. **Git**: [Tải tại git-scm.com](https://git-scm.com/)
2. **Docker Desktop** (khuyến nghị kích hoạt WSL 2 Backend): [Tải tại docker.com](https://www.docker.com/products/docker-desktop/)
3. **Node.js**: Phiên bản 22 LTS (khuyến nghị)
4. **Python**: Phiên bản 3.12 (nếu bạn muốn chạy trực tiếp backend ngoài Docker)

---

## 2. Các Bước Thực hiện trên PC

### Bước 1: Clone Repository từ Nhánh `main`
Mở Terminal / PowerShell trên PC tại thư mục bạn muốn lưu dự án (ví dụ: `D:\Projects`):
```bash
git clone -b main https://github.com/namtrungdn310/tpro-classio.git
cd tpro-classio
```

---

### Bước 2: Cấu hình Tệp Môi trường (`.env`)

Toàn bộ dữ liệu của hệ thống (học viên, lớp học, học phí, lịch học) được lưu trữ tập trung trên **Supabase Cloud PostgreSQL** và đã áp dụng đầy đủ toàn bộ 131 bản cập nhật cấu trúc database. Do đó, cả Laptop và PC cùng chia sẻ chung một cơ sở dữ liệu thực tế này.

Bạn chỉ cần tạo các file cấu hình môi trường như sau:

#### A. File `backend/.env`
Tạo file `backend/.env` với nội dung cấu hình chuẩn:
```env
APP_NAME=TPro Classio Backend
APP_ENVIRONMENT=development
DEBUG=True
API_V1_PREFIX=/api/v1
DOCS_URL=/docs
OPENAPI_URL=/openapi.json

# Cổng lắng nghe
HOST=0.0.0.0
PORT=8000

# CORS & Frontend Origins
BACKEND_CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
ALLOWED_HOSTS=["*"]

# Supabase Cloud Database (Đã hoàn tất 131 migration)
DATABASE_URL=postgresql+asyncpg://tpro_backend.cgeuylguumkgslxvbxba:wMhHGAYEHEO0buPwdrdbJu6SPMNNV_hF4nT2WcH9Jf9fxwm1PEmgWVYIFLKzx0WY@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=20
DATABASE_POOL_TIMEOUT=30
DATABASE_POOL_RECYCLE=1800
DATABASE_ECHO=False
DATABASE_SSL_MODE=require

# Supabase Platform Keys
SUPABASE_URL=https://cgeuylguumkgslxvbxba.supabase.co
SUPABASE_ANON_KEY=sb_publishable_ly5Wy6LEv1_-HV_FKM3o4A_5KU-ylPO
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZXV5bGd1dW1rZ3NseHZiZXhiYSIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc4MDkxMCwiZXhwIjoyMDk3MzU2OTEwfQ.AIXdjVbWNp9S9XxJqIUduJVN6W2wTDJGo473WatJc4o
SUPABASE_DB_OWNER_PASSWORD=Namtrung03102006@

# Bảo mật & Mã hoá Token
SECRET_KEY=b89e7c3e593a1f49673891d4e0e5614948a04b77f9801db9b827e7f53f93891d
AUTH_ENCRYPTION_KEY=d638971f1e9489b023e617d983401fa0491024385967401db923058102394819
ACCESS_TOKEN_EXPIRE_MINUTES=43200
REFRESH_TOKEN_EXPIRE_DAYS=30
ALGORITHM=HS256
AUTH_COOKIE_SECURE=False

# Google OAuth (Tùy chọn)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Quản trị viên
OWNER_ADMIN_EMAIL=admin@tproclassio.local
```

#### B. File `.env` (Tại Thư mục Gốc của Dự án)
Tạo file `.env` tại thư mục gốc `tpro-classio/` dùng cho Docker Compose:
```env
NEXT_INTERNAL_API_URL=http://backend:8000
APP_ORIGIN=http://localhost:3000
AUTH_COOKIE_SECURE=false
BACKEND_ENV_FILE=./backend/.env
```

---

## 3. Khởi động Toàn bộ Dự án bằng Docker (Khuyên Dùng)

Trên PC, chỉ cần mở Terminal tại thư mục gốc dự án và chạy:
```bash
docker compose up -d --build
```

Sau khoảng 1–2 phút, Docker sẽ tải image, build production Next.js và khởi động 2 container:
- `tpro-classio-backend-1` trên cổng `8000` (http://localhost:8000)
- `tpro-classio-frontend-1` trên cổng `3000` (http://localhost:3000)

### Kiểm tra Trạng thái:
```bash
docker ps
```
Cả 2 container sẽ hiển thị trạng thái `(healthy)`.
Bây giờ bạn có thể mở trình duyệt trên PC tại: **http://localhost:3000** để sử dụng ứng dụng ngay lập tức!

---

## 4. Khởi động ở Chế độ Lập trình (Hot-Reload Dev Mode - Tuỳ chọn)

Nếu bạn muốn chỉnh sửa mã nguồn và nhận phản hồi trực tiếp (hot-reload):

### Backend:
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate  # Trên Windows
pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend:
```bash
cd frontend
npm ci
npm run dev
```
Trang web sẽ chạy tại http://localhost:3000.

---

## 5. Danh mục Kiểm tra Xác nhận (Checklist)

- [x] Mã nguồn nhánh `main` mới nhất chứa đầy đủ 6 nhóm chức năng.
- [x] Cơ sở dữ liệu Supabase Cloud đã áp dụng đầy đủ 131 migration (dữ liệu học viên, lớp học hoàn toàn nguyên vẹn).
- [x] Lỗi Dirty State khi bấm học viên đã được sửa triệt để.
- [x] Docker Container chạy ổn định ở chế độ Healthy.
- [x] Toàn bộ 679 frontend test và 821 backend test đều đạt 100%.
