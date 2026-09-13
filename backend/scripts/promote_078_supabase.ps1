# R8 Phase 10 — promote migration 078 lên Supabase thật (RUNBOOK, chỉ chạy thủ công bởi operator)
#
# Chỉ thực thi khi TOÀN BỘ disposable gate xanh (runner 001..078 + scale + EXPLAIN
# before/after + verify 078 + idempotency + verify_security + Phase 9 perf gate).
#
# KHÔNG chạy bằng runtime role; cần SUPABASE_DB_OWNER_PASSWORD trong backend/.env
# (file đã gitignore). KHÔNG in password/DSN/token vào log hay artifact.
#
# Các bước dưới đây là runbook; không tự động hoá chạy Supabase thật.

param(
  [Parameter(Mandatory = $false)]
  [string]$RunId = "r8-perf-" + (Get-Date -Format "yyyyMMdd-HHmmss"),
  [Parameter(Mandatory = $false)]
  [string]$PsqlPath = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
)

$ErrorActionPreference = "Stop"
$Root = "D:\Projects\tpro-classio"
$ArtifactDir = Join-Path $Root "artifacts\perf\$RunId"
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ArtifactDir "explain-before") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ArtifactDir "explain-after") | Out-Null

Write-Host "==== R8 Phase 10 RUNBOOK (manual) ====" -ForegroundColor Cyan
Write-Host "Run ID: $RunId"
Write-Host "Artifacts: $ArtifactDir"

# --- Phase 0: đóng băng bằng chứng ---
Write-Host "`n[0] Đóng băng bằng chứng"
$gitCommit = (git -C $Root rev-parse HEAD)
$hash078 = (Get-FileHash (Join-Path $Root "backend\supabase\migrations\078_class_and_fee_projection_indexes.sql") -Algorithm SHA256).Hash
$pgVersion = & $PsqlPath --version
@{
  run_id = $RunId
  git_commit = $gitCommit
  migration_078_sha256 = $hash078
  postgresql_version = ($pgVersion -join " ")
  started_at = (Get-Date -Format "o")
  migrations = "001..078"
  dataset = "perf_scale 1000 classes / 5000 students / 50000+ fee records"
} | ConvertTo-Json | Set-Content (Join-Path $ArtifactDir "manifest.json") -Encoding UTF8
Write-Host "  git commit: $gitCommit"
Write-Host "  migration 078 sha256: $hash078"

Write-Host "`n[1] Preflight: backup + table size + locks + owner"
Write-Host "  - Dừng backend/frontend HOẶC bật maintenance mode."
Write-Host "  - Tạo backup: pg_dump -Fc -U postgres -d <db> > $ArtifactDir\backup-before-078.dump"
Write-Host "  - Kiểm tra: pg_restore --list $ArtifactDir\backup-before-078.dump"
Write-Host "  - Kiểm tra kích thước bảng (bên dưới là lệnh mẫu):"
Write-Host @"
    select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid))
      from pg_stat_user_tables
     where relname in ('classes','fee_records');
"@
Write-Host "  - Kiểm tra active sessions/locks: select * from pg_locks where not granted;"
Write-Host "  - Xác nhận database owner; KHÔNG dùng runtime role."

Write-Host "`n[2] Chạy migration 078 (CREATE INDEX CONCURRENTLY — ngoài transaction)"
Write-Host "  - Đặt lock_timeout/statement_timeout phù hợp."
Write-Host "  - Theo dõi pg_locks + pg_stat_progress_create_index."
$mig = Join-Path $Root "backend\supabase\migrations\078_class_and_fee_projection_indexes.sql"
Write-Host "  - psql -U <owner> -d <db> -v ON_ERROR_STOP=1 -f `"$mig`""
Write-Host "  - Nếu lỗi concurrent index: dừng, kiểm tra pg_index.indisvalid, drop index invalid, không chạy lại mù quáng."

Write-Host "`n[3] Verify sau khi chạy"
$verify = Join-Path $Root "backend\tests\sql\verify_migration_078.sql"
Write-Host "  - psql -U <owner> -d <db> -v ON_ERROR_STOP=1 -f `"$verify`""
$sec = Join-Path $Root "backend\tests\sql\verify_security.sql"
Write-Host "  - psql -U <owner> -d <db> -v ON_ERROR_STOP=1 -f `"$sec`""

Write-Host "`n[4] Smoke production"
Write-Host "  - GET /health/ready -> 200 {'status':'ready'}"
Write-Host "  - GET /classes, /fees, /reports smoke."
Write-Host "  - Theo dõi log chậm 15-30 phút."

Write-Host "`n[5] Đối chiếu + artifact"
Write-Host "  - Đối chiếu row count + index size (pg_indexes / pg_relation_size)."
Write-Host "  - Ghi hash migration, thời gian chạy, kết quả vào $ArtifactDir\report.md"

Write-Host "`n==== RUNBOOK KẾT THÚC (không tự chạy Supabase) ====" -ForegroundColor Green
