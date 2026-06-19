# TPRO Classio

## Chạy Docker

```powershell
cd D:\Projects\tpro-classio
docker compose up -d --build
```

Mở app:

```txt
http://localhost:3000
http://localhost:8000/docs
```

## Dừng Docker

```powershell
cd D:\Projects\tpro-classio
docker compose down
```

## Xem Log

```powershell
cd D:\Projects\tpro-classio
docker compose logs -f
```

## Kiểm Tra Container

```powershell
cd D:\Projects\tpro-classio
docker compose ps
```

## Nếu Port 3000 Bị Chiếm

Xem process đang giữ port:

```powershell
netstat -ano | Select-String ':3000'
```

Dừng process đó, thay `PID` bằng số ở cột cuối:

```powershell
Stop-Process -Id PID -Force
```

Chạy lại Docker:

```powershell
cd D:\Projects\tpro-classio
docker compose up -d --build
```

## Chạy Tạm Port Khác

```powershell
cd D:\Projects\tpro-classio
$env:FRONTEND_PORT=3017
docker compose up -d --build
```

Mở:

```txt
http://localhost:3017
```
