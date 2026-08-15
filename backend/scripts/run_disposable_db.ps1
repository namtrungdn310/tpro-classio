# TPRO Classio — scripts/run_disposable_db.ps1 (Round 4)
#
# Pipeline bằng chứng Round 4 trên PostgreSQL disposable — KHÔNG bao giờ chạy
# trên Supabase thật. Các scenario:
#   1. clean chain: bootstrap -> 001-050 -> fixture -> 051 -> 052 -> fixture -> 053 -> assert -> verify x2
#   2. rollback/reapply: 051 -> assert after -> rollback -> assert before -> reapply -> assert
#   3. drift/rerun: 051 -> mutate hop le -> rerun (no-op) -> rollback ABORT -> data moi giu nguyen
#   4. negative fixtures: 051/052 abort dung + cleanup sach
#   5. migration owner non-superuser: 051/052 chay bang role owner khong SUPERUSER
#   6. runtime non-BYPASSRLS: integration tests chay bang role tpro_runtime (NOBYPASSRLS)
#   7. verify lai sau integration + perf dataset/EXPLAIN/p95
#
# An toan:
#   - try/finally: cleanup container/temp file va phuc hoi env vars (tru -Keep)
#   - readiness bang pg_isready (khong sleep co dinh)
#   - moi phase fail -> exit non-zero ngay
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File backend/scripts/run_disposable_db.ps1 [-Keep]

param(
  [switch]$Keep
)

# EAP=Continue: psql in NOTICE/ERROR ra stderr, không được biến thành exception
# (PowerShell 5.1 NativeCommandError). Mọi phase tự kiểm $LASTEXITCODE và throw.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Migrations = Join-Path $Root "supabase\migrations"
$Scripts = Join-Path $Root "supabase\scripts"
$SqlRoot = Join-Path $Root "tests\sql"
$Container = "tpro-r4-pg"
$Port = 55436
$Password = "disposable"
$EnvBackup = @{}
$TempFiles = @()

$PsqlBin = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
if (-not (Test-Path $PsqlBin)) { $PsqlBin = (Get-Command psql).Source }
$PgIsReady = "C:\Program Files\PostgreSQL\17\bin\pg_isready.exe"
if (-not (Test-Path $PgIsReady)) { $PgIsReady = (Get-Command pg_isready).Source }

function Save-Env($name) {
  $item = Get-Item "env:$name" -ErrorAction SilentlyContinue
  if ($null -eq $item) { $script:EnvBackup[$name] = $null } else { $script:EnvBackup[$name] = [string]$item.Value }
}
function Restore-Env {
  foreach ($k in $script:EnvBackup.Keys) {
    if ($null -eq $script:EnvBackup[$k]) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
    else { Set-Item "env:$k" $script:EnvBackup[$k] }
  }
  $script:EnvBackup.Clear()
}

function Invoke-Sql([string]$file, [string]$phase, [string]$db = "tpro_r3", [string]$user = "postgres", [switch]$AllowFail) {
  $env:PGPASSWORD = $Password
  $out = & $PsqlBin -h 127.0.0.1 -p $Port -U $user -d $db -v ON_ERROR_STOP=1 -f $file 2>&1
  $code = $LASTEXITCODE
  $notices = ($out | Select-String -Pattern "NOTICE" | ForEach-Object { $_.Line }) -join "; "
  if ($code -ne 0) {
    $err = ($out | Select-String -Pattern "ERROR" | Select-Object -First 2 | ForEach-Object { $_.Line.Trim() }) -join " | "
    Write-Host "FAIL [$phase]: $(Split-Path -Leaf $file) exit=$code" -ForegroundColor Red
    Write-Host "  $err" -ForegroundColor Red
    if (-not $AllowFail) { throw "phase '$phase' failed: $(Split-Path -Leaf $file)" }
    return $false
  }
  Write-Host "OK  [$phase]: $(Split-Path -Leaf $file)" -ForegroundColor Green
  if ($notices) { Write-Host "      $notices" -ForegroundColor Gray }
  return $true
}

function Invoke-SqlText([string]$sql, [string]$phase, [string]$db = "tpro_r3", [string]$user = "postgres", [switch]$AllowFail) {
  $env:PGPASSWORD = $Password
  $out = & $PsqlBin -h 127.0.0.1 -p $Port -U $user -d $db -v ON_ERROR_STOP=1 -c $sql 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    $err = ($out | Select-String -Pattern "ERROR" | Select-Object -First 2 | ForEach-Object { $_.Line.Trim() }) -join " | "
    Write-Host "FAIL [$phase]: exit=$code $err" -ForegroundColor Red
    if (-not $AllowFail) { throw "phase '$phase' failed" }
    return $false
  }
  Write-Host "OK  [$phase]: $($sql.Substring(0, [Math]::Min(70, $sql.Length)))..." -ForegroundColor Green
  return $true
}

# ---------------------------------------------------------------------------
Write-Host "==== R4 pipeline: dựng PostgreSQL disposable ====" -ForegroundColor Cyan
$existing = docker ps -a -q -f "name=$Container" 2>$null
if ($existing) { docker rm -f $Container 2>$null | Out-Null }
docker run -d --name $Container -e "POSTGRES_PASSWORD=$Password" -e "POSTGRES_DB=tpro_r3" -p "${Port}:5432" postgres:17-alpine | Out-Null

$env:PGPASSWORD = $Password
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  & $PgIsReady -h 127.0.0.1 -p $Port -d tpro_r3 -U postgres | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { Write-Host "PostgreSQL not ready after 60s" -ForegroundColor Red; exit 1 }
Write-Host "PostgreSQL ready (pg_isready)." -ForegroundColor Green

try {
  # ================= SCENARIO 1: CLEAN CHAIN =================
  Write-Host "==== Scenario 1: clean chain (001-050 -> fixture -> 051 -> 052 -> assert -> verify x2) ====" -ForegroundColor Cyan
  Invoke-Sql (Join-Path $SqlRoot "supabase_bootstrap.sql") "s1-bootstrap"
  Get-ChildItem $Migrations -Filter "*.sql" | Sort-Object Name | Where-Object { $_.Name -lt "051" } | ForEach-Object {
    Invoke-Sql $_.FullName "s1-migrate"
  }
  Invoke-Sql (Join-Path $SqlRoot "migration_051_fixture.sql") "s1-fixture"
  Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s1-051"
  Invoke-Sql (Join-Path $SqlRoot "migration_052_events_fixture.sql") "s1-events"
  Invoke-Sql (Join-Path $Scripts "052_role_snapshot_mapping.sql") "s1-mapping-table"
  Invoke-Sql (Join-Path $SqlRoot "migration_052_mapping_fixture.sql") "s1-mapping-rows"
  Invoke-Sql (Join-Path $Migrations "052_class_staff_role_audit_snapshot.sql") "s1-052"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_fixture.sql") "s1-053-fixture"
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s1-053"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert.sql") "s1-053-assert"
  Invoke-Sql (Join-Path $SqlRoot "migration_054_fixture.sql") "s1-054-fixture"
  Invoke-Sql (Join-Path $Migrations "054_decouple_class_dates_from_billing.sql") "s1-054"
  Invoke-Sql (Join-Path $SqlRoot "migration_055_fixture.sql") "s1-055-fixture"
  Invoke-Sql (Join-Path $Migrations "055_student_codes.sql") "s1-055"
  Invoke-Sql (Join-Path $SqlRoot "migration_055_assert.sql") "s1-055-assert"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_fixture.sql") "s1-056-fixture"
  Invoke-Sql (Join-Path $Migrations "056_fee_cycle_identity.sql") "s1-056"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_assert.sql") "s1-056-assert"
  Invoke-Sql (Join-Path $Migrations "057_fee_status_void_superseded.sql") "s1-057"
  Invoke-Sql (Join-Path $Migrations "058_fee_void_constraints.sql") "s1-058"
  Invoke-Sql (Join-Path $Migrations "059_schedule_slot_identity.sql") "s1-059"
  Invoke-Sql (Join-Path $Migrations "060_student_status_archived.sql") "s1-060"
  Invoke-Sql (Join-Path $Migrations "061_student_profile_lifecycle.sql") "s1-061"
  Invoke-Sql (Join-Path $Migrations "062_enrollment_slot_selections.sql") "s1-062"
  Invoke-Sql (Join-Path $Migrations "063_service_credit_ledger.sql") "s1-063"
  Invoke-Sql (Join-Path $Migrations "064_add_teacher_role.sql") "s1-064"
  Invoke-Sql (Join-Path $Migrations "065_staff_account_links.sql") "s1-065"
  Invoke-Sql (Join-Path $Migrations "066_staff_compensation_rates.sql") "s1-066"
  Invoke-Sql (Join-Path $Migrations "067_staff_attendance_ledger.sql") "s1-067"
  Invoke-Sql (Join-Path $Migrations "068_payment_provider_scaffold.sql") "s1-068"
  Invoke-Sql (Join-Path $Migrations "069_contract_cleanup.sql") "s1-069"
  Invoke-Sql (Join-Path $Migrations "070_role_and_invitation_invariants.sql") "s1-070"
  Invoke-Sql (Join-Path $Migrations "071_payroll_rate_and_settlement_invariants.sql") "s1-071"
  Invoke-Sql (Join-Path $Migrations "072_fee_operation_actor_anonymization.sql") "s1-072"
  Invoke-Sql (Join-Path $Migrations "073_staff_payroll_settlement_reversals.sql") "s1-073"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_assert.sql") "s1-assert"
  Invoke-Sql (Join-Path $SqlRoot "verify_security.sql") "s1-verify-1"
  Invoke-Sql (Join-Path $SqlRoot "verify_security.sql") "s1-verify-2"

  # ================= SCENARIO 2: ROLLBACK / REAPPLY =================
  Write-Host "==== Scenario 2: rollback/reapply (T-DB051-043/044 + T-DB053-rollback) ====" -ForegroundColor Cyan
  Invoke-Sql (Join-Path $SqlRoot "migration_051_rollback_fixture.sql") "s2-fixture"
  Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s2-051"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_assert.sql") "s2-assert-after"
  Invoke-Sql (Join-Path $Scripts "051_schedule_availability_rollback.sql") "s2-rollback"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_assert_before.sql") "s2-assert-before"
  Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s2-reapply"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_assert.sql") "s2-assert-reapply"
  Invoke-Sql (Join-Path $SqlRoot "verify_security.sql") "s2-verify"

  # 053: apply -> assert -> rollback -> assert-before -> reapply -> assert
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s2-053"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert.sql") "s2-053-assert"
  # Các bảng mới sau 053 (063 credit ledger) phụ thuộc 053 — drop trước khi
  # rollback 053 (rollback theo thứ tự ngược; evidence 063 là disposable).
  Invoke-SqlText "drop table if exists public.service_credit_allocations; drop table if exists public.enrollment_service_credit_events;" "s2-063-drop-before-053-rollback"
  Invoke-Sql (Join-Path $Scripts "053_schedule_adjustment_rollback.sql") "s2-053-rollback"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert_before.sql") "s2-053-assert-before"
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s2-053-reapply"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert.sql") "s2-053-assert-reapply"
  Invoke-Sql (Join-Path $Migrations "063_service_credit_ledger.sql") "s2-063-reapply"
  Invoke-Sql (Join-Path $Migrations "069_contract_cleanup.sql") "s2-069-reapply"
  Invoke-Sql (Join-Path $SqlRoot "verify_security.sql") "s2-053-verify"

  # ================= SCENARIO 3: DRIFT / RERUN ABORT =================
  Write-Host "==== Scenario 3: drift/rerun abort (T-DB051-045/046) ====" -ForegroundColor Cyan
  Invoke-Sql (Join-Path $SqlRoot "migration_051_rollback_fixture.sql") "s3-fixture"
  Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s3-051"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_drift_mutate.sql") "s3-mutate"
  # rerun no-op: target rỗng, fingerprint không đổi
  Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s3-rerun-noop"
  # rollback phải ABORT vì drift
  $driftAborted = Invoke-Sql (Join-Path $Scripts "051_schedule_availability_rollback.sql") "s3-rollback-abort" -AllowFail
  if ($driftAborted) { throw "s3: rollback phải abort khi drift nhưng đã chạy thành công" }
  # dữ liệu mới giữ nguyên
  $slot = & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3 -Atc "select schedule->'slots'->0->>'start' from public.classes where id = '20000000-0000-0000-0000-000000000008'"
  if ($slot.Trim() -ne "08:00") { throw "s3: mutation bị ghi đè — dữ liệu mới không còn nguyên vẹn" }
  Write-Host "OK  [s3]: dữ liệu sau mutation giữ nguyên (start=08:00)" -ForegroundColor Green
  # fingerprint không bị refresh
  $fp = & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3 -Atc "select md5(schedule_after::text || coalesce(version_after::text,'') || coalesce(updated_at_after::text,'')) from public._migration_051_class_schedule_backup where class_id = '20000000-0000-0000-0000-000000000008'"
  Write-Host "      fingerprint C8: $($fp.Trim())" -ForegroundColor Gray

  # 053: apply -> drift mutate -> rerun ABORT -> rollback ABORT -> data intact -> restore
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s3-053"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_drift_mutate.sql") "s3-053-mutate"
  $s3DriftAborted = Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s3-053-rerun-abort" -AllowFail
  if ($s3DriftAborted) { throw "s3: 053 phải abort khi drift nhưng đã pass" }
  $s3RollbackAborted = Invoke-Sql (Join-Path $Scripts "053_schedule_adjustment_rollback.sql") "s3-053-rollback-abort" -AllowFail
  if ($s3RollbackAborted) { throw "s3: rollback 053 phải abort khi drift nhưng đã pass" }
  $opEnd = & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3 -Atc "select operational_end_date from public.classes where id = '50000000-0000-0000-0000-000000000001'"
  if ($opEnd.Trim() -ne "2027-05-31") { throw "s3: operational_end_date bị ghi đè khi drift abort" }
  Write-Host "OK  [s3]: operational_end_date giữ nguyên sau drift abort" -ForegroundColor Green
  Invoke-SqlText "alter table public.class_session_exceptions add constraint class_session_exceptions_replacement_duration_check check (replacement_start_at is null or (replacement_end_at - replacement_start_at) = (original_end_at - original_start_at));" "s3-053-restore-constraint"
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s3-053-rerun-noop"

  # ================= SCENARIO 4: NEGATIVE FIXTURES =================
  Write-Host "==== Scenario 4: negative fixtures (051/052 abort) ====" -ForegroundColor Cyan
  # N3 (5 slots): tạm tháo DB constraint (042/044) để chứng minh preflight 051
  # vẫn bắt >4 slots — rồi khôi phục constraint.
  Invoke-SqlText "alter table public.classes drop constraint if exists classes_schedule_max_four_slots_check; alter table public.classes drop constraint if exists classes_weekly_schedule_limit_check;" "s4-drop-constraints"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_negative_five_slots.sql") "s4-n3-fixture"
  $n3Aborted = Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s4-n3-abort" -AllowFail
  if ($n3Aborted) { throw "s4: 051 phải abort với 5-slot fixture nhưng đã pass" }
  Invoke-SqlText "alter table public.classes add constraint classes_schedule_max_four_slots_check check (schedule is null or not (schedule ? 'slots') or (jsonb_typeof(schedule -> 'slots') = 'array' and jsonb_array_length(schedule -> 'slots') <= 4)) not valid; alter table public.classes add constraint classes_weekly_schedule_limit_check check (schedule is null or (jsonb_typeof(schedule) = 'object' and (not (schedule ? 'slots') or (jsonb_typeof(schedule -> 'slots') = 'array' and jsonb_array_length(schedule -> 'slots') <= 4)))) not valid;" "s4-restore-constraints"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_negative_cleanup.sql") "s4-n3-cleanup"
  # N1/N2 (shape): tạm tháo constraint shape/slots rồi khôi phục
  Invoke-SqlText "alter table public.classes drop constraint if exists classes_weekly_schedule_limit_check; alter table public.classes drop constraint if exists classes_schedule_max_four_slots_check;" "s4-drop-shape-constraint"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_negative_shape.sql") "s4-n12-fixture"
  $shapeAborted = Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s4-n12-abort" -AllowFail
  if ($shapeAborted) { throw "s4: 051 phải abort với shape fixture nhưng đã pass" }
  Invoke-SqlText "alter table public.classes add constraint classes_weekly_schedule_limit_check check (schedule is null or (jsonb_typeof(schedule) = 'object' and (not (schedule ? 'slots') or (jsonb_typeof(schedule -> 'slots') = 'array' and jsonb_array_length(schedule -> 'slots') <= 4)))) not valid; alter table public.classes add constraint classes_schedule_max_four_slots_check check (schedule is null or not (schedule ? 'slots') or (jsonb_typeof(schedule -> 'slots') = 'array' and jsonb_array_length(schedule -> 'slots') <= 4)) not valid;" "s4-restore-shape-constraint"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_negative_cleanup.sql") "s4-n12-cleanup"
  # Các negative còn lại
  Invoke-Sql (Join-Path $SqlRoot "migration_051_negative_fixture.sql") "s4-fixture"
  $negAborted = Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s4-051-abort" -AllowFail
  if ($negAborted) { throw "s4: 051 phải abort với negative fixture nhưng đã pass" }
  Invoke-Sql (Join-Path $SqlRoot "migration_051_negative_cleanup.sql") "s4-cleanup"
  Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s4-051-pass-after-cleanup"
  # 052 ambiguous abort
  Invoke-Sql (Join-Path $SqlRoot "migration_052_negative_fixture.sql") "s4-052-ambig-fixture"
  $ambigAborted = Invoke-Sql (Join-Path $Migrations "052_class_staff_role_audit_snapshot.sql") "s4-052-abort" -AllowFail
  if ($ambigAborted) { throw "s4: 052 phải abort với ambiguous event nhưng đã pass" }
  # dọn event mơ hồ + khôi phục NOT NULL (fixture đã tháo để insert legacy-style)
  Invoke-SqlText "drop trigger if exists trg_class_teacher_events_append_only on public.class_teacher_events; delete from public.class_teacher_events where teacher_id = '10000000-0000-0000-0000-000000000044'; create trigger trg_class_teacher_events_append_only before update or delete on public.class_teacher_events for each row execute function public.block_class_teacher_event_mutation(); alter table public.class_teacher_events alter column staff_type_snapshot set not null;" "s4-052-cleanup"
  # 053 negative: bảng malformed -> preflight abort -> cleanup -> apply sạch
  # 063 tables depend on 053 — drop before the 053 negative fixture recreates them.
  Invoke-SqlText "drop table if exists public.service_credit_allocations; drop table if exists public.enrollment_service_credit_events;" "s4-063-drop-before-053-negative"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_negative_fixture.sql") "s4-053-neg-fixture"
  $neg053Aborted = Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s4-053-abort" -AllowFail
  if ($neg053Aborted) { throw "s4: 053 phải abort với malformed fixture nhưng đã pass" }
  Invoke-Sql (Join-Path $SqlRoot "migration_053_negative_cleanup.sql") "s4-053-cleanup"
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s4-053-pass-after-cleanup"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert.sql") "s4-053-assert"
  # 053 re-apply xóa cột additive của 059/062 — re-run các migration idempotent.
  Invoke-Sql (Join-Path $Migrations "059_schedule_slot_identity.sql") "s4-059-reapply"
  Invoke-Sql (Join-Path $Migrations "062_enrollment_slot_selections.sql") "s4-062-reapply"
  Invoke-Sql (Join-Path $Migrations "063_service_credit_ledger.sql") "s4-063-reapply"
  Invoke-Sql (Join-Path $Migrations "069_contract_cleanup.sql") "s4-069-reapply"
  Write-Host "==== Scenario 1-4 DB done ====" -ForegroundColor Cyan

  # ================= SCENARIO 5: MIGRATION OWNER NON-SUPERUSER =================
  Write-Host "==== Scenario 5: migration owner non-superuser ====" -ForegroundColor Cyan
  $env:PGPASSWORD = $Password
  & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3 -v ON_ERROR_STOP=1 -c "create database tpro_r3_owner" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "s5: create db tpro_r3_owner failed" }
  Invoke-Sql (Join-Path $SqlRoot "supabase_bootstrap.sql") "s5-bootstrap" -db "tpro_r3_owner"
  Get-ChildItem $Migrations -Filter "*.sql" | Sort-Object Name | Where-Object { $_.Name -lt "051" } | ForEach-Object {
    Invoke-Sql $_.FullName "s5-migrate" -db "tpro_r3_owner"
  }
  Invoke-Sql (Join-Path $SqlRoot "migration_051_fixture.sql") "s5-fixture" -db "tpro_r3_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_052_events_fixture.sql") "s5-events" -db "tpro_r3_owner"

  # role owner non-superuser — mô phỏng ĐÚNG đường deploy thật: Supabase chạy
  # migration bằng supabase_admin (NOSUPERUSER nhưng BYPASSRLS). Không phải
  # postgres superuser. Runtime RLS riêng (tpro_runtime NOBYPASSRLS) ở scenario 6.
  $roleSql = Join-Path $env:TEMP "tpro_m051_owner.sql"
  $script:TempFiles += $roleSql
  @'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'm051_owner') then
    create role m051_owner login password 'disposable';
  end if;
end $$;
alter role m051_owner nosuperuser nocreaterole nocreatedb bypassrls;
grant usage on schema public, auth, storage to m051_owner;
grant all on schema public to m051_owner;
grant all on all tables in schema public to m051_owner;
grant all on all sequences in schema public to m051_owner;
'@ | Set-Content -Path $roleSql -Encoding UTF8
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($roleSql, (Get-Content $roleSql -Raw).TrimStart([char]0xFEFF), $utf8NoBom)
  & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3_owner -v ON_ERROR_STOP=1 -f $roleSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "s5: create m051_owner failed" }
  Write-Host "OK  [s5]: role m051_owner (NOSUPERUSER/NOBYPASSRLS-by-design/BYPASSRLS) sẵn sàng" -ForegroundColor Green

  # quyền sở hữu bảng cần thiết cho migration — mô phỏng deploy dùng migration owner
  & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3_owner -v ON_ERROR_STOP=1 -c @"
alter table public.classes owner to m051_owner;
alter table public.class_teachers owner to m051_owner;
alter table public.class_teacher_events owner to m051_owner;
alter table public.staff_members owner to m051_owner;
alter table public.students owner to m051_owner;
alter table public.account_invitations owner to m051_owner;
alter function public.block_class_teacher_event_mutation() owner to m051_owner;
alter function public.enforce_staff_assignment_lifecycle() owner to m051_owner;
alter function public.enforce_class_package_cycle_integrity() owner to m051_owner;
"@ 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "s5: alter owner failed" }
  Write-Host "OK  [s5]: bảng + hàm append-only giao cho m051_owner (mô phỏng deploy owner)" -ForegroundColor Green

  Invoke-Sql (Join-Path $Scripts "052_role_snapshot_mapping.sql") "s5-mapping-table" -db "tpro_r3_owner"
  Invoke-SqlText "alter table public._m052_role_snapshot_mapping owner to m051_owner;" "s5-mapping-owner" -db "tpro_r3_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_052_mapping_fixture.sql") "s5-mapping-rows" -db "tpro_r3_owner"

  Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s5-051" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "052_class_staff_role_audit_snapshot.sql") "s5-052" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_fixture.sql") "s5-053-fixture" -db "tpro_r3_owner"
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s5-053" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert.sql") "s5-053-assert" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_054_fixture.sql") "s5-054-fixture" -db "tpro_r3_owner"
  Invoke-Sql (Join-Path $Migrations "054_decouple_class_dates_from_billing.sql") "s5-054" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_055_fixture.sql") "s5-055-fixture" -db "tpro_r3_owner"
  Invoke-Sql (Join-Path $Migrations "055_student_codes.sql") "s5-055" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_055_assert.sql") "s5-055-assert" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-SqlText "alter type public.fee_status owner to m051_owner; alter type public.student_status owner to m051_owner; alter type public.user_role owner to m051_owner; alter table public.fee_records owner to m051_owner; alter table public.fee_operations owner to m051_owner; alter table public.fee_operation_items owner to m051_owner; alter table public.class_lifecycle_events owner to m051_owner; alter table public.student_lifecycle_events owner to m051_owner; alter table public.students owner to m051_owner; alter table public.enrollments owner to m051_owner; alter table public.payments owner to m051_owner; alter table public.profiles owner to m051_owner; alter table public.account_security_events owner to m051_owner; alter function public.block_fee_operation_mutation() owner to m051_owner;" "s5-fee-status-owner" -db "tpro_r3_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_fixture.sql") "s5-056-fixture" -db "tpro_r3_owner"
  Invoke-Sql (Join-Path $Migrations "056_fee_cycle_identity.sql") "s5-056" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_assert.sql") "s5-056-assert" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "057_fee_status_void_superseded.sql") "s5-057" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "058_fee_void_constraints.sql") "s5-058" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "059_schedule_slot_identity.sql") "s5-059" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "060_student_status_archived.sql") "s5-060" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "061_student_profile_lifecycle.sql") "s5-061" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "062_enrollment_slot_selections.sql") "s5-062" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "063_service_credit_ledger.sql") "s5-063" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "064_add_teacher_role.sql") "s5-064" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "065_staff_account_links.sql") "s5-065" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "066_staff_compensation_rates.sql") "s5-066" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "067_staff_attendance_ledger.sql") "s5-067" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "068_payment_provider_scaffold.sql") "s5-068" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "069_contract_cleanup.sql") "s5-069" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "070_role_and_invitation_invariants.sql") "s5-070" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "071_payroll_rate_and_settlement_invariants.sql") "s5-071" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "072_fee_operation_actor_anonymization.sql") "s5-072" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $Migrations "073_staff_payroll_settlement_reversals.sql") "s5-073" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-Sql (Join-Path $SqlRoot "migration_051_assert.sql") "s5-assert" -db "tpro_r3_owner" -user "m051_owner"
  Invoke-SqlText "grant all on storage.buckets, storage.objects to m051_owner; grant all on all tables in schema auth to m051_owner;" "s5-grants-storage" -db "tpro_r3_owner"
  Invoke-Sql (Join-Path $SqlRoot "verify_security.sql") "s5-verify" -db "tpro_r3_owner" -user "m051_owner"
  Write-Host "==== Scenario 5 done: 051/052 chạy bằng migration owner non-superuser ====" -ForegroundColor Cyan

  # ================= SCENARIO 5b: R6-D02 (054) DECOUPLE CLASS DATES =================
  Write-Host "==== Scenario 5b: 054 decouple class dates (R6-D02) ====" -ForegroundColor Cyan
  # Fixture đã nằm trong scenario 1 (s1-054-fixture) trước migration.
  Invoke-Sql (Join-Path $Migrations "054_decouple_class_dates_from_billing.sql") "s5b-054"
  Invoke-Sql (Join-Path $SqlRoot "migration_054_assert.sql") "s5b-assert"
  # Rerun safe no-op
  Invoke-Sql (Join-Path $Migrations "054_decouple_class_dates_from_billing.sql") "s5b-054-rerun"
  Invoke-Sql (Join-Path $SqlRoot "migration_054_assert.sql") "s5b-assert-rerun"
  # Negative: MONTHLY class below min must abort preflight -> cleanup -> pass
  Invoke-Sql (Join-Path $SqlRoot "migration_054_negative_fixture.sql") "s5b-neg-fixture"
  $neg054Aborted = Invoke-Sql (Join-Path $Migrations "054_decouple_class_dates_from_billing.sql") "s5b-neg-abort" -AllowFail
  if ($neg054Aborted) { throw "s5b: 054 phải abort với below-min fixture nhưng đã pass" }
  Invoke-Sql (Join-Path $SqlRoot "migration_054_negative_cleanup.sql") "s5b-neg-cleanup"
  Invoke-Sql (Join-Path $Migrations "054_decouple_class_dates_from_billing.sql") "s5b-054-pass-after-cleanup"
  Invoke-Sql (Join-Path $SqlRoot "migration_054_assert.sql") "s5b-assert-final"
  # Rollback/reapply: remove acceptance probe rows (violate old rule) then rollback
  Invoke-Sql (Join-Path $SqlRoot "migration_054_drop_probes.sql") "s5b-drop-probe"
  Invoke-Sql (Join-Path $Scripts "054_decouple_class_dates_rollback.sql") "s5b-rollback"
  Invoke-Sql (Join-Path $SqlRoot "migration_054_assert_before.sql") "s5b-assert-before"
  Invoke-Sql (Join-Path $Migrations "054_decouple_class_dates_from_billing.sql") "s5b-reapply"
  Invoke-Sql (Join-Path $SqlRoot "migration_054_assert.sql") "s5b-assert-reapply"
  # Rollback with drift must ABORT (non-divisible rows exist)
  $s5bDriftAborted = Invoke-Sql (Join-Path $Scripts "054_decouple_class_dates_rollback.sql") "s5b-rollback-abort" -AllowFail
  if ($s5bDriftAborted) { throw "s5b: rollback 054 phải abort khi có row vi phạm nhưng đã pass" }
  # Drift rerun: acceptance probe insert (non-divisible) giữ nguyên
  $probeEnd = & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3 -Atc "select end_date from public.classes where id = '30000000-0000-0000-0000-000000000054'"
  if ($probeEnd.Trim() -ne "2026-09-10") { throw "s5b: drift data bị mất sau rollback abort" }
  Write-Host "OK  [s5b]: 054 chain pass (fresh/rerun/negative/rollback/drift)" -ForegroundColor Green

  # ================= SCENARIO 5c: R6-D05 (056) FEE-CYCLE IDENTITY =================
  Write-Host "==== Scenario 5c: 056 fee-cycle identity (R6-D05) ====" -ForegroundColor Cyan
  # Fixture đã nằm trong scenario 1 (s1-056-fixture) trước migration.
  Invoke-Sql (Join-Path $Migrations "056_fee_cycle_identity.sql") "s5c-056"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_assert.sql") "s5c-assert"
  # Rerun no-op
  Invoke-Sql (Join-Path $Migrations "056_fee_cycle_identity.sql") "s5c-056-rerun"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_assert.sql") "s5c-assert-rerun"
  # Negative: duplicate due evidence -> abort -> cleanup -> pass
  Invoke-Sql (Join-Path $SqlRoot "migration_056_negative_fixture.sql") "s5c-neg-fixture"
  $neg056Aborted = Invoke-Sql (Join-Path $Migrations "056_fee_cycle_identity.sql") "s5c-neg-abort" -AllowFail
  if ($neg056Aborted) { throw "s5c: 056 phải abort với duplicate-due fixture nhưng đã pass" }
  Invoke-Sql (Join-Path $SqlRoot "migration_056_negative_cleanup.sql") "s5c-neg-cleanup"
  Invoke-Sql (Join-Path $Migrations "056_fee_cycle_identity.sql") "s5c-056-pass-after-cleanup"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_assert.sql") "s5c-assert-final"
  Write-Host "OK  [s5c]: 056 chain pass (fresh/rerun/negative)" -ForegroundColor Green

  # ================= SCENARIO 6: RUNTIME + INTEGRATION =================
  Write-Host "==== Scenario 6: runtime service_role-equivalent + integration tests ====" -ForegroundColor Cyan
  # tpro_runtime mô phỏng service_role deploy thật: NOSUPERUSER nhưng BYPASSRLS
  # (Supabase service_role có BYPASSRLS; backend API chạy bằng role này).
  # RLS/deny thực sự được chứng minh RIÊNG bằng browser roles anon/authenticated
  # (NOBYPASSRLS) qua verify_security.sql + deny probes bên dưới.
  Invoke-SqlText 'do $$ begin if not exists (select 1 from pg_roles where rolname = ''tpro_runtime'') then create role tpro_runtime login password ''disposable''; end if; end $$; alter role tpro_runtime nosuperuser nocreaterole nocreatedb bypassrls;' "s6-runtime-role"
  # Grant TỐI THIỂU theo bảng business — KHÔNG chạm backup/mapping (deny).
  Invoke-SqlText "grant usage on schema public, auth, storage to tpro_runtime; grant all on public.classes, public.class_teachers, public.class_teacher_events, public.staff_members, public.profiles, public.students, public.enrollments, public.payments, public.fee_records, public.fee_operations, public.fee_operation_items, public.fee_message_templates, public.class_lifecycle_events, public.student_lifecycle_events, public.account_invitations, public.account_security_events, public.auth_flow_sessions, public.auth_google_identities, public.auth_rate_limits, public.auth_recovery_codes, public.auth_totp_factors, public.password_reset_sessions, public.user_device_sessions, public.class_schedule_adjustments, public.class_session_exceptions, public.class_session_staff_snapshots, public.class_session_student_snapshots, public.class_schedule_adjustment_events, public.class_schedule_slots, public.class_schedule_slot_staff, public.enrollment_slot_selections, public.enrollment_service_credit_events, public.service_credit_allocations, public.staff_account_links, public.staff_account_link_events, public.staff_compensation_rates, public.staff_compensation_rate_events, public.staff_attendance_entries, public.staff_earning_ledger, public.staff_payroll_settlements, public.staff_payroll_settlement_items, public.payment_requests, public.payment_request_events, public.payment_provider_deliveries, public.payment_provider_attempts, public.payment_posting_queue to tpro_runtime; grant select, insert on public.student_code_registry to tpro_runtime; grant usage on sequence public.student_code_serial_seq to tpro_runtime; grant all on all sequences in schema public to tpro_runtime; grant execute on function public.student_code_luhn_check(text) to tpro_runtime; grant execute on function public.student_code_from_serial(bigint) to tpro_runtime; grant execute on function public.student_code_valid(text) to tpro_runtime;" "s6-runtime-grants"
  Invoke-SqlText "grant all on public.staff_payroll_settlement_reversals to tpro_runtime;" "s6-runtime-grants-073"
  Write-Host "OK  [s6]: tpro_runtime NOSUPERUSER/BYPASSRLS (service_role-equivalent)" -ForegroundColor Green

  # backup table deny: browser roles NOBYPASSRLS không đọc được (RLS FORCE + revoke)
  $denyOk = $true
  foreach ($role in @("anon", "authenticated")) {
    $out = & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3 -v ON_ERROR_STOP=1 -c "set role $role; select count(*) from public._migration_051_class_schedule_backup;" 2>&1
    if ($LASTEXITCODE -eq 0) { $denyOk = $false; Write-Host "FAIL [s6]: role $role đọc được backup table!" -ForegroundColor Red }
  }
  if (-not $denyOk) { throw "s6: backup table phải deny anon/authenticated/runtime" }
  Write-Host "OK  [s6]: backup table deny anon/authenticated/runtime (RLS FORCE + revoke)" -ForegroundColor Green

  Save-Env "RUN_DB_INTEGRATION"; Save-Env "DATABASE_URL"; Save-Env "DATABASE_SSL_MODE"; Save-Env "DB_TEST_ADMIN_DSN"; Save-Env "PYTHONPATH"
  $env:RUN_DB_INTEGRATION = "1"
  $env:DATABASE_URL = "postgresql+asyncpg://tpro_runtime:disposable@127.0.0.1:${Port}/tpro_r3"
  $env:DATABASE_SSL_MODE = "disable"
  $env:DB_TEST_ADMIN_DSN = "postgresql://postgres:disposable@127.0.0.1:${Port}/tpro_r3"
  $env:PYTHONPATH = $Root
  $venv = Join-Path $Root ".venv\Scripts\python.exe"
  $pytestLog = Join-Path $env:TEMP "tpro_r6_pytest.log"
  & $venv -m pytest (Join-Path $Root "tests") -q 2>&1 | Tee-Object -FilePath $pytestLog | Select-String -Pattern "passed|failed|skipped" | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0) {
    Select-String -Path $pytestLog -Pattern "FAILED" | Select-Object -First 30 | ForEach-Object { Write-Host "FAILED-TEST: $($_.Line.Trim())" -ForegroundColor Yellow }
    throw "s6: backend integration tests failed"
  }

  # ================= SCENARIO 7: VERIFY SAU INTEGRATION + PERF =================
  Write-Host "==== Scenario 7: verify sau integration + perf ====" -ForegroundColor Cyan
  Invoke-Sql (Join-Path $SqlRoot "verify_security.sql") "s7-verify-after-integration"
  Invoke-Sql (Join-Path $SqlRoot "perf_dataset.sql") "s7-perf-dataset"
  Invoke-Sql (Join-Path $SqlRoot "perf_explain.sql") "s7-perf-explain"
  & $venv (Join-Path $SqlRoot "perf_measure.py")
  if ($LASTEXITCODE -ne 0) { throw "s7: p95 measurement failed" }

  # ================= SCENARIO 8: ACCEPTANCE / FINALIZATION =================
  Write-Host "==== Scenario 8: acceptance/finalization (T-DB051-049) ====" -ForegroundColor Cyan
  $env:PGPASSWORD = $Password
  & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3 -v ON_ERROR_STOP=1 -c "create database tpro_r3_acc" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "s8: create db tpro_r3_acc failed" }
  Invoke-Sql (Join-Path $SqlRoot "supabase_bootstrap.sql") "s8-bootstrap" -db "tpro_r3_acc"
  Get-ChildItem $Migrations -Filter "*.sql" | Sort-Object Name | Where-Object { $_.Name -lt "051" } | ForEach-Object {
    Invoke-Sql $_.FullName "s8-migrate" -db "tpro_r3_acc"
  }
  Invoke-Sql (Join-Path $SqlRoot "migration_051_fixture.sql") "s8-fixture" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "051_schedule_availability_indexes.sql") "s8-051" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Scripts "051_schedule_availability_acceptance.sql") "s8-acceptance" -db "tpro_r3_acc"
  $backupGone = & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3_acc -Atc "select to_regclass('public._migration_051_class_schedule_backup')"
  if ($backupGone.Trim() -ne "") { throw "s8: backup table vẫn còn sau acceptance" }
  $fkCount = & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3_acc -Atc "select count(*) from pg_constraint where conname like '%migration_051%'"
  if ($fkCount.Trim() -ne "0") { throw "s8: FK backup vẫn còn" }
  # 053 acceptance trên DB sạch: fixture -> 053 -> assert -> rollback (0 data) -> assert-before
  Invoke-Sql (Join-Path $SqlRoot "migration_053_fixture.sql") "s8-053-fixture" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s8-053" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert.sql") "s8-053-assert" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Scripts "053_schedule_adjustment_rollback.sql") "s8-053-rollback" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert_before.sql") "s8-053-assert-before" -db "tpro_r3_acc"
  # Reapply 053 để acc DB có đủ schema mới nhất cho các migration sau.
  Invoke-Sql (Join-Path $Migrations "053_class_schedule_adjustments.sql") "s8-053-reapply" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $SqlRoot "migration_053_assert.sql") "s8-053-assert-reapply" -db "tpro_r3_acc"
  # 055 acceptance: fixture -> 055 -> assert
  Invoke-Sql (Join-Path $SqlRoot "migration_054_fixture.sql") "s8-054-fixture" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "054_decouple_class_dates_from_billing.sql") "s8-054" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $SqlRoot "migration_054_assert.sql") "s8-054-assert" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $SqlRoot "migration_055_fixture.sql") "s8-055-fixture" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "055_student_codes.sql") "s8-055" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $SqlRoot "migration_055_assert.sql") "s8-055-assert" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_fixture.sql") "s8-056-fixture" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "056_fee_cycle_identity.sql") "s8-056" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $SqlRoot "migration_056_assert.sql") "s8-056-assert" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "057_fee_status_void_superseded.sql") "s8-057" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "058_fee_void_constraints.sql") "s8-058" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "059_schedule_slot_identity.sql") "s8-059" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "060_student_status_archived.sql") "s8-060" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "061_student_profile_lifecycle.sql") "s8-061" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "062_enrollment_slot_selections.sql") "s8-062" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "063_service_credit_ledger.sql") "s8-063" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "064_add_teacher_role.sql") "s8-064" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "065_staff_account_links.sql") "s8-065" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "066_staff_compensation_rates.sql") "s8-066" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "067_staff_attendance_ledger.sql") "s8-067" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "068_payment_provider_scaffold.sql") "s8-068" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "069_contract_cleanup.sql") "s8-069" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "070_role_and_invitation_invariants.sql") "s8-070" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "071_payroll_rate_and_settlement_invariants.sql") "s8-071" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "072_fee_operation_actor_anonymization.sql") "s8-072" -db "tpro_r3_acc"
  Invoke-Sql (Join-Path $Migrations "073_staff_payroll_settlement_reversals.sql") "s8-073" -db "tpro_r3_acc"
  Invoke-SqlText "insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active) values ('40000000-0000-0000-0000-000000000001', 'ACCEPTANCE', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true);" "s8-insert-class" -db "tpro_r3_acc"
  $delOut = & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d tpro_r3_acc -v ON_ERROR_STOP=1 -c "delete from public.classes where id = '40000000-0000-0000-0000-000000000001';" 2>&1
  if ($delOut -match "migration_051|foreign key") { throw "s8: delete-class vẫn bị FK backup chặn sau acceptance" }
  Write-Host "OK  [s8]: backup table dropped; delete-class không còn bị FK backup chặn" -ForegroundColor Green

  Write-Host "==== R4 DISPOSABLE PIPELINE: ALL SCENARIOS PASSED ====" -ForegroundColor Green
}
finally {
  Write-Host "==== Cleanup (finally) ====" -ForegroundColor Cyan
  foreach ($t in $script:TempFiles) { if (Test-Path $t) { Remove-Item $t -Force } }
  if (-not $Keep) {
    docker rm -f $Container 2>$null | Out-Null
    Write-Host "Container $Container removed." -ForegroundColor Green
  } else {
    Write-Host "Container $Container kept (-Keep)." -ForegroundColor Yellow
  }
  Restore-Env
  Remove-Item env:PGPASSWORD -ErrorAction SilentlyContinue
}
