# TPRO Classio release readiness

Tài liệu này là cổng kiểm định từ local sang staging và production. Một mục
chưa được đánh dấu đồng nghĩa môi trường tương ứng chưa được phép phát hành.
Không ghi credential, dữ liệu học viên thật, URL chứa token hoặc nội dung backup
vào tài liệu này.

## 1. Trạng thái hiện tại

- Ứng dụng vẫn ở giai đoạn local/pre-staging.
- CI kiểm tra frontend, backend, migration trên PostgreSQL sạch và build image.
- Runtime image chạy bằng user không phải `root`; dependency trực tiếp được pin
  và base image được khóa digest trong repository.
- API nghiệp vụ chỉ đi qua Next.js BFF và FastAPI; browser không có service-role
  key hoặc database credential.
- Migration `037` và `038` sửa/reconcile ledger theo hướng tiến tới, còn
  migration `039` khóa bucket avatar riêng tư và quyền Storage trực tiếp.
  Các migration này không dựa vào việc chỉnh migration đã được database đánh
  dấu applied; `039` phải được kiểm tra trên staging clone của Supabase trước
  khi áp dụng production.

Các mục bên dưới vẫn là điều kiện chặn staging/production cho đến khi hoàn tất.

## 2. Blocker migration: trùng version `002`

Hai file legacy sau có cùng version theo cách Supabase CLI nhận diện:

- `002_add_class_billing_cycle.sql`
- `002_performance_indexes.sql`

Vòng lặp psql của CI chạy theo tên file nên vẫn chạy được cả hai. Supabase CLI
ghi lịch sử theo version và có thể từ chối hoặc nhận sai một trong hai file.
Không đổi tên tùy tiện trên database đã tồn tại.

### 2.1 Chuẩn bị an toàn

1. Dừng mọi thay đổi schema trong lúc baseline.
2. Tạo backup custom-format bằng `pg_dump`.
3. Khôi phục backup vào một PostgreSQL/Supabase test riêng và xác nhận mở được.
4. Lưu commit SHA đang phát hành và SHA-256 của toàn bộ file migration.
5. Trên từng database hiện hữu, chỉ đọc lịch sử:

   ```sql
   select version, name
   from supabase_migrations.schema_migrations
   order by version;
   ```

   Nếu bảng/schema không tồn tại, ghi nhận rằng database trước đây được migrate
   thủ công; không tự tạo hàng giả khi chưa đối chiếu schema.

6. Chạy `backend/tests/sql/verify_security.sql` trên bản khôi phục. Mọi lỗi đều
   phải được xử lý trước khi baseline.

### 2.2 Chuẩn hóa repository

Thực hiện trong một pull request riêng trên `dev`:

1. Gán version số duy nhất, tăng dần và đủ dài cho **toàn bộ** migration legacy,
   giữ nguyên đúng thứ tự đang được CI chạy.
2. Không thay đổi nội dung SQL trong cùng commit rename.
3. Khởi tạo `backend/supabase/config.toml` bằng Supabase CLI và thống nhất mọi
   lệnh dùng `--workdir backend`; không link nhầm project.
4. Thêm kiểm tra CI từ chối duplicate version và từ chối thứ tự không xác định.
5. Tạo database PostgreSQL 16 sạch, chạy chuỗi mới từ đầu rồi chạy security
   verifier và DB integration tests.
6. So sánh schema của database sạch với bản khôi phục từ môi trường hiện hữu.

### 2.3 Baseline database hiện hữu

1. Chỉ chạy trên staging clone trước; không thử lần đầu trên production.
2. Dùng `supabase migration list` để đối chiếu local/remote.
3. Với mỗi migration đã được chứng minh là có hiệu lực tương đương, dùng
   `supabase migration repair --status applied <version-moi>` theo đúng tài liệu
   CLI của phiên bản đang cài.
4. Sau khi **tất cả** version mới tương đương đã được đánh dấu và schema đã đối
   chiếu, xóa hàng version legacy bằng
   `supabase migration repair --status reverted <version-cu>`. Với version
   `002` bị trùng, phải chứng minh hiệu lực của cả hai file bằng schema/index
   inspection rồi mới đánh dấu cả hai version mới; hàng `002` cũ chỉ được gỡ
   sau cùng. Không để đồng thời version cũ và mới trong remote history.
5. Không đánh dấu `applied` chỉ vì tên file có vẻ giống nhau. Phải xác nhận bảng,
   cột, constraint, index, trigger, function, grant và RLS tương ứng.
6. Chạy migration còn thiếu bằng CLI, sau đó chạy security verifier.
7. `supabase migration list` phải cho local/remote khớp và
   `supabase db push --dry-run` không được định chạy lại migration legacy.
8. Chụp backup mới và thực hiện smoke test nghiệp vụ.
9. Chỉ lặp lại quy trình trên production sau khi staging và rollback rehearsal
   đều đạt.

## 3. Blocker onboarding: phát hành lại lời mời cho identity hiện hữu

Viewer legacy được migration `033` chuyển sang `pending`. Ngoài ra, một đăng ký
mới có thể đã tạo Supabase Auth identity nhưng chưa hoàn tất Google/TOTP trước
khi lời mời hết hạn hoặc bị thu hồi. Hiện tại email đã tồn tại không thể nhận
lời mời đăng ký mới, nên hai nhóm này có thể bị kẹt.

Không xóa Auth user hoặc sửa `account_status` trực tiếp để đi vòng qua MFA.
Trước staging cần triển khai một luồng owner-only, có audit và idempotent:

1. Khóa theo canonical email bằng advisory lock.
2. Đọc đúng identity từ Supabase Admin API và profile tương ứng.
3. Chỉ cho phát hành lại khi profile còn `pending`,
   `onboarding_completed_at is null` và chưa có phiên AAL2.
4. Thu hồi lời mời chưa hoàn tất cũ, tạo token ngẫu nhiên mới chỉ lưu hash và
   bind ngay với đúng `auth.users.id`; không đổi password/role.
5. Link hồi phục đưa user về login/resend-email-OTP phù hợp với trạng thái
   `email_confirmed`; không tiết lộ việc một email bất kỳ có tồn tại qua API
   công khai.
6. Ghi actor, target, thời điểm và action vào audit append-only.
7. Test hết hạn, revoke giữa luồng, hai yêu cầu đồng thời, retry cùng request,
   email không khớp, identity đã active/disabled và factor dở dang.

Preflight chỉ đọc trên staging clone:

```sql
select
  p.id,
  p.account_status,
  p.onboarding_completed_at,
  max(i.expires_at) filter (
    where i.consumed_at is null and i.revoked_at is null
  ) as latest_open_invitation
from public.profiles p
left join public.account_invitations i on i.registered_user_id = p.id
where p.account_status = 'pending'
group by p.id, p.account_status, p.onboarding_completed_at
order by p.id;
```

Không đưa staging cho người dùng thật cho tới khi danh sách trên có runbook xử
lý và luồng phát hành lại đã qua test.

### 3.1 Các biên giao dịch xác thực phải diễn tập

Code hiện tại đã khóa dòng khi hoàn tất MFA/đổi role/trạng thái và ghi Google
identity, avatar reference, audit event cùng bước hoàn tất OAuth trong một giao
dịch database. Trước staging vẫn phải fault-inject các điểm sau:

1. Supabase signup thành công nhưng database hoặc bind invitation thất bại.
   Không tự xóa identity nếu chưa chứng minh đó là identity vừa tạo; dùng luồng
   reissue/rebind owner-only ở mục 3 để phục hồi idempotent.
2. Upload avatar thành công nhưng transaction database rollback. Object path là
   deterministic nên retry sẽ upsert; thêm job kiểm kê/xóa object riêng tư
   không còn được identity tham chiếu.
3. Owner đổi role hoặc disable tài khoản trong lúc onboarding/refresh đang chạy.
   Database lock phải cho kết quả xác định và audit phải giữ đúng trạng thái cũ.
4. Revoke phiên local phải được kiểm tra cùng Supabase Admin global sign-out.
   Cho đến khi global revoke được triển khai và test, không cho browser truy cập
   trực tiếp Supabase Data API; chỉ BFF/FastAPI được phép đọc dữ liệu nghiệp vụ.
5. BFF refresh coordinator hiện chỉ đồng bộ trong một process. Chỉ chạy một
   frontend replica; trước khi scale ngang phải dùng shared lock/session store
   hoặc một cơ chế phối hợp đa replica đã qua race test.

## 4. Tách môi trường

Mỗi môi trường phải có tài nguyên độc lập:

| Tài nguyên | Local | Staging | Production |
| --- | --- | --- | --- |
| Supabase project/database | riêng | riêng | riêng |
| Google OAuth client | local callback | staging callback | production callback |
| SMTP/API key | dev/test | staging | production |
| `SECRET_KEY` | riêng | riêng | riêng |
| `AUTH_ENCRYPTION_KEY` | riêng | riêng | riêng |
| Storage bucket | riêng | riêng | riêng |

- Không sao chép dữ liệu học viên thật sang local/staging.
- Không dùng chung service-role key, database password hoặc OAuth secret.
- Secret được inject từ secret manager/file root-owned, không lưu trong Git,
  image, artifact hoặc command history.
- `APP_ENVIRONMENT=staging|production`, HTTPS, secure cookies, exact host
  allowlist và exact OAuth callback là bắt buộc.
- Database TLS phải dùng `verify-full` với CA do nhà cung cấp phát hành được
  mount chỉ đọc; không chỉ mã hóa kiểu `require` mà bỏ qua xác minh hostname.

## 5. Role database của ứng dụng

Migration chạy bằng database owner; ứng dụng tuyệt đối không dùng owner đó.
Provision role `tpro_backend` riêng sau migration với:

- `LOGIN`, mật khẩu ngẫu nhiên từ secret manager và `BYPASSRLS` vì migration
  `025` dùng `FORCE ROW LEVEL SECURITY` nhưng chủ đích không có browser policy;
- `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`;
- chỉ `CONNECT`, `USAGE` schema, CRUD trên các bảng nghiệp vụ cần thiết và
  usage/select trên sequence cần thiết;
- không có quyền tạo/alter/drop schema, table, function, role hoặc database.

Sau mỗi migration phải chạy smoke/integration bằng chính role này. CI tạo một
role tương đương trong PostgreSQL tạm và chạy DB integration bằng role đó để
phát hiện thiếu grant. Production vẫn phải review grant theo least privilege;
không sao chép password CI.

Script chuẩn nằm tại `backend/ops/provision_runtime_role.psql`. Ví dụ PowerShell
trên staging clone:

```powershell
$env:TPRO_RUNTIME_DB_PASSWORD = "<secret-ngẫu-nhiên-từ-secret-manager>"
$env:PGPASSWORD = "<mật-khẩu-database-owner>"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" `
  -h "<staging-db-host>" -p 5432 -U "<migration-owner>" -d postgres `
  -f "backend/ops/provision_runtime_role.psql"
Remove-Item Env:\TPRO_RUNTIME_DB_PASSWORD
Remove-Item Env:\PGPASSWORD
```

Không truyền password bằng `-v`, URL hoặc tham số lệnh vì có thể lọt vào shell
history/process list. Script tạo hoặc rotate role, grant lại các bảng/sequence
hiện có và tự kiểm tra thuộc tính đặc quyền. Chạy lần đầu và diễn tập rotate trên
staging. Vì PostgreSQL chỉ giữ một password cho role này, rotation bằng script
phải nằm trong maintenance window: drain instance, đổi password, cập nhật secret,
restart rồi xác nhận readiness. Nếu cần zero-downtime, dùng hai role versioned
với cùng grant trong một runbook riêng; không tự coi `ALTER ROLE` là rolling-safe.

## 6. Cổng staging

- [ ] Hoàn tất migration baseline ở mục 2 trên staging.
- [ ] Hoàn tất recovery/reissue onboarding ở mục 3 và xử lý viewer legacy.
- [ ] `verify_security.sql` và DB integration tests đạt.
- [ ] Restore rehearsal từ backup staging đạt và có thời gian RTO/RPO ghi nhận.
- [ ] Login, invite, email OTP, Google linking, TOTP, recovery code, refresh và
      logout được smoke-test trên HTTPS.
- [ ] Fault-injection các biên giao dịch auth ở mục 3.1 đạt; global revoke và
      topology một/nhiều frontend replica đã được quyết định rõ.
- [ ] Role owner/admin/viewer được thử bằng tài khoản độc lập.
- [ ] Học viên, nhiều lớp, giáo viên, học phí, hoàn phí và báo cáo được thử bằng
      dữ liệu tổng hợp, không phải dữ liệu thật.
- [ ] Log không chứa password, OTP, OAuth code/state, invitation token, cookie,
      authorization header, query string nhạy cảm hoặc PII không cần thiết.
- [ ] Dependency/SAST/secret scan đạt.
- [ ] Python transitive dependency lock có hash được tạo lại từ nguồn tin cậy,
      review và dùng nhất quán cho CI/image production.
- [ ] Image scanner đã được chọn, pin theo digest và không còn lỗ hổng
      fixable Critical/High chưa có ngoại lệ được phê duyệt.
- [ ] Artifact/image có SBOM, provenance và chữ ký; deployment xác minh đúng
      digest đã qua staging, không rebuild âm thầm trên production.
- [ ] Monitoring cho availability, 5xx, latency, auth abuse, DB saturation,
      backup failure và email failure hoạt động.
- [ ] Khi dữ liệu báo cáo đủ lớn, benchmark tìm kiếm chứa `%term%`; chỉ thêm
      `pg_trgm`/GIN index sau khi `EXPLAIN (ANALYZE, BUFFERS)` trên dữ liệu staging
      chứng minh scan hiện tại vượt ngân sách latency.
- [ ] Bổ sung constraint kiểm tra `avatar_object_path` khớp đúng
      `users/<user-id>/avatar.webp`, sau khi preflight xác nhận mọi hàng hiện hữu
      đều hợp lệ.
- [ ] Rollback ứng dụng và chiến lược forward-fix database đã được diễn tập.

### 6.1 Ngoại lệ tạm thời cho toolchain frontend

Ngày 24/07/2026, GitHub công bố `GHSA-mh99-v99m-4gvg` cho
`brace-expansion <= 5.0.7`. Runtime tree của frontend không chứa dependency này;
nó chỉ đi qua ESLint/plugin trong dev toolchain. Bản vá duy nhất hiện là 5.0.8,
nhưng `minimatch@3` của ESLint ecosystem dùng API CommonJS cũ và bị hỏng nếu ép
major override (`expand is not a function`).

Do đó CI:

- từ chối High/Critical trong production tree bằng
  `npm audit --omit=dev --audit-level=high`;
- từ chối Critical trong toàn bộ toolchain;
- vẫn giữ Dependabot và CodeQL để nhận bản nâng cấp upstream.

Không dùng `npm audit fix --force`, không hạ phiên bản Next.js và không patch
thư viện trong `node_modules`. Ngoại lệ này phải được review lại mỗi tuần và bị
gỡ ngay khi ESLint/minimatch phát hành chuỗi dependency tương thích với
`brace-expansion >= 5.0.8`. Nếu advisory lan vào runtime tree hoặc tăng Critical,
release bị chặn ngay.

## 7. Cổng production

- [ ] Tất cả cổng staging đạt trên đúng artifact/image sẽ promote.
- [ ] Domain, TLS, HSTS, trusted proxy CIDR và rate limit được kiểm tra từ ngoài.
- [ ] SMTP giao dịch dùng domain đã xác thực SPF, DKIM và DMARC; không phụ thuộc
      hộp thư cá nhân cho tải production.
- [ ] CAPTCHA/bot protection hoặc biện pháp tương đương được quyết định cho các
      endpoint email/auth công khai; rate limit được load-test.
- [ ] Chính sách lưu giữ/xóa dữ liệu, audit log, backup và quyền truy cập phù hợp
      với dữ liệu trẻ vị thành niên đã được phê duyệt.
- [ ] Recovery/rotation cho database, Supabase, OAuth, signing và encryption key
      được diễn tập.
- [ ] GitHub `main` được bảo vệ; chỉ nhận pull request đã qua required checks.
- [ ] Secret scanning, push protection, private vulnerability reporting và
      dependency alerts đã bật.
- [ ] Có người chịu trách nhiệm sự cố, kênh cảnh báo và checklist hậu kiểm.

## 8. Quy trình Git từ sau đợt hardening

1. `main` chỉ chứa revision đã qua staging.
2. Công việc thường ngày bắt đầu từ `dev` hoặc branch feature nhỏ tạo từ `dev`.
3. Kết thúc mỗi feature/module: chạy gate liên quan, commit nhỏ, push ngay và mở
   pull request; không dồn hàng trăm thay đổi không liên quan.
4. Pull request `dev` → `main` chỉ được merge khi CI, staging smoke và migration
   review đều đạt.
5. Không force-push hoặc xóa `main`; release được tag và có changelog/rollback.
