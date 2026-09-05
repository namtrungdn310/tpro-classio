do $$
declare
  sample_enrollment_id uuid;
  has_refund_upgrade_fixture boolean;
  account_delete_audit_id uuid;
  account_delete_user_id uuid := gen_random_uuid();
  account_replacement_user_id uuid := gen_random_uuid();
  account_delete_probe_email text :=
    'security-delete-probe+' || gen_random_uuid()::text || '@invalid.example';
begin
  if exists (
    select 1
    from (
      values
        ('account_invitations'),
        ('auth_rate_limits'),
        ('auth_flow_sessions'),
        ('auth_google_identities'),
        ('auth_recovery_codes'),
        ('auth_totp_factors'),
        ('account_security_events'),
        ('class_lifecycle_events'),
        ('class_teacher_events'),
        ('class_teachers'),
        ('classes'),
        ('class_schedule_adjustments'),
        ('class_session_exceptions'),
        ('class_session_staff_snapshots'),
        ('class_session_student_snapshots'),
        ('class_schedule_adjustment_events'),
        ('enrollments'),
        ('fee_records'),
        ('fee_message_templates'),
        ('fee_message_drafts'),
        ('fee_operation_items'),
        ('fee_operations'),
        ('password_reset_sessions'),
        ('payments'),
        ('profiles'),
        ('staff_members'),
        ('student_lifecycle_events'),
        ('students'),
        ('user_device_sessions'),
        ('workspace_payment_accounts'),
        ('workspace_payment_providers'),
        ('workspace_payment_webhooks')
    ) as required_table(table_name)
    where to_regclass(
      'public.' || quote_ident(required_table.table_name)
    ) is null
  ) then
    raise exception 'one or more required public tables are missing';
  end if;

  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Supabase Storage tables are missing';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'avatars'
      and name = 'avatars'
      and public is false
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/webp']::text[]
  ) then
    raise exception 'avatar bucket is missing or not private/restricted';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'banking-qr'
      and name = 'banking-qr'
      and public is false
      and file_size_limit = 2097152
      and allowed_mime_types = array['image/webp']::text[]
  ) then
    raise exception 'banking QR bucket is missing or not private/restricted';
  end if;

  if exists (
    select 1
    from pg_class class_
    join pg_namespace namespace_ on namespace_.oid = class_.relnamespace
    where namespace_.nspname = 'storage'
      and class_.relname in ('buckets', 'objects')
      and not class_.relrowsecurity
  ) then
    raise exception 'avatar storage RLS must remain enabled';
  end if;
  if exists (
    with recursive browser_roles(role_oid) as (
      select role_.oid
      from pg_roles role_
      where role_.rolname in ('anon', 'authenticated')

      union

      select membership.roleid
      from pg_auth_members membership
      join browser_roles browser
        on browser.role_oid = membership.member
    )
    select 1
    from pg_policy policy_
    join pg_class class_ on class_.oid = policy_.polrelid
    join pg_namespace namespace_ on namespace_.oid = class_.relnamespace
    where namespace_.nspname = 'storage'
      and class_.relname in ('buckets', 'objects')
      and (
        0 = any(policy_.polroles)
        or policy_.polroles && array(
          select browser.role_oid from browser_roles browser
        )
      )
  ) then
    raise exception 'browser-accessible avatar storage policies must not exist';
  end if;

  if exists (
    select required_column.table_name, required_column.column_name
    from (
      values
        ('auth_flow_sessions', 'supabase_access_token_ciphertext'),
        ('auth_flow_sessions', 'supabase_refresh_token_ciphertext'),
        ('auth_flow_sessions', 'oauth_state_hash'),
        ('auth_flow_sessions', 'oauth_nonce_ciphertext'),
        ('auth_flow_sessions', 'oauth_pkce_verifier_ciphertext'),
        ('auth_google_identities', 'provider_refresh_token_ciphertext'),
        ('auth_totp_factors', 'provider_factor_id')
    ) as required_column(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns column_
      where column_.table_schema = 'public'
        and column_.table_name = required_column.table_name
        and column_.column_name = required_column.column_name
    )
  ) then
    raise exception 'one or more hardened auth columns are missing';
  end if;

  if exists (
    select forbidden_column.table_name, forbidden_column.column_name
    from (
      values
        ('auth_flow_sessions', 'supabase_access_token'),
        ('auth_flow_sessions', 'supabase_refresh_token'),
        ('auth_google_identities', 'provider_refresh_token'),
        ('auth_totp_factors', 'secret_encrypted')
    ) as forbidden_column(table_name, column_name)
    join information_schema.columns column_
      on column_.table_schema = 'public'
      and column_.table_name = forbidden_column.table_name
      and column_.column_name = forbidden_column.column_name
  ) then
    raise exception 'plaintext auth credential columns must not exist';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_
    where column_.table_schema = 'public'
      and column_.table_name = 'user_device_sessions'
      and column_.column_name = 'aal'
      and column_.is_nullable = 'NO'
      and replace(coalesce(column_.column_default, ''), ' ', '') in (
        '''aal1''::text',
        '''aal1'''
      )
  ) then
    raise exception 'existing device sessions must default to fail-closed aal1';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_
    where constraint_.conrelid = 'public.auth_flow_sessions'::regclass
      and constraint_.contype = 'u'
      and constraint_.conname = 'auth_flow_sessions_user_type_unique'
  ) then
    raise exception 'auth flow sessions must be unique per user and flow type';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_
    where constraint_.conrelid = 'public.account_invitations'::regclass
      and constraint_.contype = 'f'
      and constraint_.confrelid = 'auth.users'::regclass
      and constraint_.confdeltype = 'c'
      and pg_get_constraintdef(constraint_.oid) like
        'FOREIGN KEY (registered_user_id)%'
  ) then
    raise exception 'registered invitations must remain bound to the exact auth user';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_
    where constraint_.conrelid = 'public.auth_flow_sessions'::regclass
      and constraint_.contype = 'f'
      and constraint_.confrelid = 'public.account_invitations'::regclass
      and pg_get_constraintdef(constraint_.oid) like 'FOREIGN KEY (invitation_id)%'
  ) then
    raise exception 'onboarding flows must retain an invitation foreign key';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_
    where constraint_.conrelid = 'public.account_invitations'::regclass
      and constraint_.contype = 'c'
      and constraint_.conname = 'invitation_registration_pair'
  ) then
    raise exception 'invitation registration binding constraint is missing';
  end if;

  if exists (
    select required_column.column_name
    from (
      values
        ('account_status'),
        ('approved_at'),
        ('approved_by'),
        ('disabled_at'),
        ('disabled_by')
    ) as required_column(column_name)
    where not exists (
      select 1
      from information_schema.columns column_
      where column_.table_schema = 'public'
        and column_.table_name = 'profiles'
        and column_.column_name = required_column.column_name
    )
  ) then
    raise exception 'one or more profile account-lifecycle columns are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_
    where column_.table_schema = 'public'
      and column_.table_name = 'profiles'
      and column_.column_name = 'account_status'
      and column_.is_nullable = 'NO'
      and replace(coalesce(column_.column_default, ''), ' ', '') in (
        '''pending''::text',
        '''pending'''
      )
  ) then
    raise exception 'profiles.account_status must be required and default to pending';
  end if;

  if exists (
    select required_column.column_name
    from (
      values
        ('previous_username'),
        ('next_username'),
        ('actor_email_snapshot'),
        ('actor_username_snapshot'),
        ('target_email_snapshot'),
        ('target_username_snapshot')
    ) as required_column(column_name)
    where not exists (
      select 1
      from information_schema.columns column_
      where column_.table_schema = 'public'
        and column_.table_name = 'account_security_events'
        and column_.column_name = required_column.column_name
    )
  ) then
    raise exception 'account security username audit columns are missing';
  end if;

  if exists (
    select 1
    from public.profiles
    where account_status not in ('pending', 'active', 'disabled')
  ) then
    raise exception 'profiles contains an invalid account lifecycle status';
  end if;

  if exists (
    select required_constraint.constraint_name
    from (
      values
        ('profiles_account_status_check', 'profiles'),
        ('profiles_approved_by_fkey', 'profiles'),
        ('profiles_disabled_by_fkey', 'profiles'),
        ('account_security_events_actor_user_id_fkey', 'account_security_events'),
        ('account_security_events_target_user_id_fkey', 'account_security_events'),
        ('account_security_events_action_check', 'account_security_events'),
        ('account_security_events_previous_status_check', 'account_security_events'),
        ('account_security_events_next_status_check', 'account_security_events')
    ) as required_constraint(constraint_name, table_name)
    where not exists (
      select 1
      from pg_constraint constraint_
      where constraint_.conname = required_constraint.constraint_name
        and constraint_.conrelid = (
          'public.' || quote_ident(required_constraint.table_name)
        )::regclass
    )
  ) then
    raise exception 'one or more account lifecycle constraints are missing';
  end if;

  if exists (
    select required_fk.constraint_name
    from (
      values
        ('profiles_approved_by_fkey', 'profiles'),
        ('profiles_disabled_by_fkey', 'profiles'),
        ('account_security_events_actor_user_id_fkey', 'account_security_events'),
        ('account_security_events_target_user_id_fkey', 'account_security_events')
    ) as required_fk(constraint_name, table_name)
    where not exists (
      select 1
      from pg_constraint constraint_
      where constraint_.conname = required_fk.constraint_name
        and constraint_.conrelid = (
          'public.' || quote_ident(required_fk.table_name)
        )::regclass
        and constraint_.contype = 'f'
        and constraint_.confdeltype = 'n'
    )
  ) then
    raise exception 'account lifecycle references must release deleted identities with ON DELETE SET NULL';
  end if;

  if exists (
    select 1
    from information_schema.columns column_
    where column_.table_schema = 'public'
      and column_.table_name = 'account_security_events'
      and column_.column_name = 'target_user_id'
      and column_.is_nullable = 'NO'
  ) then
    raise exception 'account security events must allow the deleted target foreign key to be anonymized';
  end if;

  if exists (
    select required_index.index_name
    from (
      values
        ('idx_profiles_account_lifecycle'),
        ('idx_account_security_events_target_time')
    ) as required_index(index_name)
    where to_regclass('public.' || quote_ident(required_index.index_name)) is null
  ) then
    raise exception 'one or more account lifecycle indexes are missing';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_
    where trigger_.tgrelid = 'public.account_security_events'::regclass
      and trigger_.tgname = 'account_security_events_append_only'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) then
    raise exception 'account security events must have an enabled append-only trigger';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.student_lifecycle_events'::regclass
      and trigger_.tgname = 'trg_student_lifecycle_events_append_only'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.student_lifecycle_events'::regclass
      and trigger_.tgname = 'trg_student_lifecycle_events_truncate'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) then
    raise exception 'student lifecycle events must be append-only';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.class_lifecycle_events'::regclass
      and trigger_.tgname = 'class_lifecycle_events_block_update'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.class_lifecycle_events'::regclass
      and trigger_.tgname = 'class_lifecycle_events_block_truncate'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) then
    raise exception 'class lifecycle events must be append-only';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.class_teacher_events'::regclass
      and trigger_.tgname = 'trg_class_teacher_events_append_only'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.class_teacher_events'::regclass
      and trigger_.tgname = 'trg_class_teacher_events_truncate'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) then
    raise exception 'class teacher history must be append-only';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.classes'::regclass
      and trigger_.tgname = 'classes_enforce_lifecycle_integrity'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.classes'::regclass
      and trigger_.tgname = 'classes_block_hard_delete'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) then
    raise exception 'class lifecycle protection triggers are missing';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name in ('class_category', 'grade_mode')
  ) <> 2 then
    raise exception 'canonical class category columns are missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name in ('archived_at', 'archived_by', 'archive_reason', 'archived_by_name_snapshot')
  ) then
    raise exception 'class archive columns must be removed after migration 048';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'enrollments'
      and column_name in ('ended_at', 'end_reason')
  ) <> 2 then
    raise exception 'membership history columns are missing';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger_
    where trigger_.tgrelid = 'public.enrollments'::regclass
      and trigger_.tgname = 'enrollments_enforce_class_date_range'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) then
    raise exception 'enrollment date range protection trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_
    where constraint_.conrelid = 'public.classes'::regclass
      and constraint_.conname = 'classes_weekly_schedule_limit_check'
      and constraint_.contype = 'c'
  ) then
    raise exception 'class weekly schedule limit constraint is missing';
  end if;

  if exists (
    select required_index.index_name
    from (
      values
        ('classes_academic_identity_unique_idx'),
        ('classes_intake_identity_unique_idx'),
        ('classes_unclassified_academic_identity_unique_idx'),
        ('classes_unclassified_intake_identity_unique_idx'),
        ('classes_category_operational_idx'),
        ('enrollments_class_status_date_idx'),
        ('enrollments_one_active_period_idx')
    ) as required_index(index_name)
    where to_regclass('public.' || quote_ident(required_index.index_name)) is null
  ) then
    raise exception 'class category or enrollment date indexes are missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.enforce_enrollment_class_date_range()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.enforce_enrollment_class_date_range()',
    'execute'
  ) then
    raise exception 'class enrollment integrity trigger function is publicly executable';
  end if;

  if has_function_privilege(
    'anon',
    'public.enforce_class_lifecycle_integrity()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.enforce_class_lifecycle_integrity()',
    'execute'
  ) then
    raise exception 'class lifecycle integrity trigger function is publicly executable';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_
    where trigger_.tgrelid = 'public.account_security_events'::regclass
      and trigger_.tgname = 'account_security_events_snapshot_insert'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) then
    raise exception 'account security events must capture immutable identity snapshots on insert';
  end if;

  if position(
    'to_jsonb(new) - ''actor_user_id'''
    in pg_get_functiondef(
      'public.block_fee_operation_mutation()'::regprocedure
    )
  ) = 0 then
    raise exception 'migration 072 is required: fee ledger actor anonymization guard is stale';
  end if;

  -- Exercise the real cascade chain without leaving probe data behind. The
  -- inner block is a PostgreSQL subtransaction; the P9001 sentinel rolls back
  -- every fixture row after all assertions have passed.
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (
      account_delete_user_id,
      account_delete_probe_email,
      '{"username":"security-delete-probe"}'::jsonb
    );

    insert into public.profiles (id, role, username, full_name)
    values (
      account_delete_user_id,
      'admin',
      'security-delete-probe',
      'Security Delete Probe'
    );

    insert into public.account_security_events (
      actor_user_id,
      target_user_id,
      action,
      previous_username,
      next_username
    ) values (
      account_delete_user_id,
      account_delete_user_id,
      'username_changed',
      'security-delete-probe-old',
      'security-delete-probe'
    ) returning id into account_delete_audit_id;

    delete from auth.users
    where id = account_delete_user_id;

    if not exists (
      select 1
      from public.account_security_events
      where id = account_delete_audit_id
        and actor_user_id is null
        and target_user_id is null
        and actor_email_snapshot = account_delete_probe_email
        and target_email_snapshot = account_delete_probe_email
        and actor_username_snapshot = 'security-delete-probe'
        and target_username_snapshot = 'security-delete-probe'
    ) then
      raise exception 'deleting an auth user must preserve the anonymized audit event and identity snapshots';
    end if;

    insert into auth.users (id, email, raw_user_meta_data)
    values (
      account_replacement_user_id,
      account_delete_probe_email,
      '{"username":"security-delete-probe-new"}'::jsonb
    );

    if not exists (
      select 1
      from auth.users
      where id = account_replacement_user_id
        and email = account_delete_probe_email
    ) then
      raise exception 'a deleted email identity must be able to register as a new auth user';
    end if;

    raise exception 'rollback successful account deletion probe'
      using errcode = 'P9001';
  exception
    when sqlstate 'P9001' then null;
  end;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'staff_members'
      and column_name = 'zalo_name'
      and data_type = 'text'
  ) then
    raise exception 'staff_members.zalo_name is missing';
  end if;

  -- `email` is contact metadata (migration 079), not an auth/account link.
  -- Only the legacy auth_user_id link is forbidden; staff email remains
  -- intentionally nullable and must never be unique/indexed as an identity.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'staff_members'
      and column_name = 'auth_user_id'
  ) then
    raise exception 'obsolete staff auth account-link column must be removed';
  end if;

  if exists (
    select required_constraint.constraint_name
    from (
      values
        ('staff_members_contact_pair_check'),
        ('staff_members_full_name_length_check'),
        ('staff_members_phone_format_check'),
        ('staff_members_zalo_name_length_check')
    ) as required_constraint(constraint_name)
    where not exists (
      select 1
      from pg_constraint constraint_
      where constraint_.conrelid = 'public.staff_members'::regclass
        and constraint_.conname = required_constraint.constraint_name
    )
  ) then
    raise exception 'one or more staff integrity constraints are missing';
  end if;

  if exists (
    select required_index.index_name
    from (
      values
        ('idx_staff_members_active_roster')
    ) as required_index(index_name)
    where to_regclass('public.' || quote_ident(required_index.index_name)) is null
  ) then
    raise exception 'one or more staff indexes are missing';
  end if;

  if to_regclass('public.ux_staff_members_auth_user_id') is not null
    or to_regclass('public.ux_staff_members_email') is not null then
    raise exception 'obsolete staff account-link indexes must be removed';
  end if;

  if exists (
    select 1
    from public.staff_members
    where (zalo_name is null) <> (phone is null)
  ) then
    raise exception 'staff contact pairs must be complete or empty';
  end if;

  if exists (
    select required_trigger.trigger_name
    from (
      values
        ('classes_validate_legacy_teacher'),
        ('class_teachers_validate_staff'),
        ('staff_members_assignment_lifecycle')
    ) as required_trigger(trigger_name)
    where not exists (
      select 1
      from pg_trigger trigger_
      where trigger_.tgname = required_trigger.trigger_name
        and not trigger_.tgisinternal
        and trigger_.tgenabled <> 'D'
    )
  ) then
    raise exception 'one or more staff lifecycle triggers are missing';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
      )
  ) then
    raise exception 'every project-owned public table must enable and force RLS';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(
      coalesce(
        c.relacl,
        acldefault(
          case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end,
          c.relowner
        )
      )
    ) acl
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and (
        acl.grantee = 0
        or exists (
          select 1
          from pg_roles granted_role
          where granted_role.oid = acl.grantee
            and (
              granted_role.rolname in ('anon', 'authenticated')
              or pg_has_role('anon', granted_role.oid, 'USAGE')
              or pg_has_role('authenticated', granted_role.oid, 'USAGE')
            )
        )
      )
  ) then
    raise exception 'browser roles or PUBLIC must not have privileges on public relations';
  end if;

  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(
      coalesce(a.attacl, acldefault('c', c.relowner))
    ) acl
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.attnum > 0
      and not a.attisdropped
      and (
        acl.grantee = 0
        or exists (
          select 1
          from pg_roles granted_role
          where granted_role.oid = acl.grantee
            and (
              granted_role.rolname in ('anon', 'authenticated')
              or pg_has_role('anon', granted_role.oid, 'USAGE')
              or pg_has_role('authenticated', granted_role.oid, 'USAGE')
            )
        )
      )
  ) then
    raise exception 'browser roles or PUBLIC must not have column privileges on public relations';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
  ) then
    raise exception 'public tables must not expose browser RLS policies';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm', 'f')
  ) then
    raise exception 'views and foreign tables must live outside the exposed public schema';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception 'project-owned public functions must not be browser RPCs';
  end if;

  if to_regprocedure('public.is_admin()') is not null then
    raise exception 'obsolete public security-definer helper must be removed';
  end if;

  if exists (
    select 1
      from pg_roles runtime_role
     where runtime_role.rolname in ('tpro_backend', 'tpro_runtime')
       and (
         not has_function_privilege(
           runtime_role.rolname,
           'public.student_code_luhn_check(text)',
           'execute'
         )
         or not has_function_privilege(
           runtime_role.rolname,
           'public.student_code_from_serial(bigint)',
           'execute'
         )
         or not has_function_privilege(
           runtime_role.rolname,
           'public.student_code_valid(text)',
           'execute'
         )
       )
  ) then
    raise exception 'runtime student-code function privileges are incomplete';
  end if;

  if has_function_privilege(
    'anon',
    'public.student_code_from_serial(bigint)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.student_code_from_serial(bigint)',
    'execute'
  ) then
    raise exception 'student-code allocation must not be browser executable';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where replace(setting, ' ', '') = 'search_path=pg_catalog'
      )
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
      )
  ) then
    raise exception 'project-owned public functions must pin search_path to pg_catalog';
  end if;

  if has_schema_privilege('anon', 'public', 'CREATE')
    or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'browser roles must not create objects in public';
  end if;

  if exists (
    select 1
    from pg_roles browser_role
    where browser_role.rolname in ('anon', 'authenticated')
      and (
        browser_role.rolsuper
        or browser_role.rolbypassrls
        or exists (
          select 1
          from pg_roles elevated_role
          where elevated_role.rolname = 'service_role'
            and pg_has_role(browser_role.oid, elevated_role.oid, 'USAGE')
        )
      )
  ) then
    raise exception 'browser roles must never bypass RLS or inherit service_role';
  end if;

  if exists (
    select 1
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) acl
    where (d.defaclnamespace = 0 or n.nspname = 'public')
      and d.defaclrole = (select oid from pg_roles where rolname = current_user)
      and (
        acl.grantee = 0
        or exists (
          select 1
          from pg_roles inherited_role
          where inherited_role.oid = acl.grantee
            and (
              inherited_role.rolname in ('anon', 'authenticated')
              or pg_has_role('anon', inherited_role.oid, 'USAGE')
              or pg_has_role('authenticated', inherited_role.oid, 'USAGE')
            )
        )
      )
  ) then
    raise exception 'migration-owner default privileges must stay closed to browser roles';
  end if;

  -- A schema-scoped function REVOKE cannot override PostgreSQL's global
  -- PUBLIC EXECUTE default. Evaluate the effective global ACL explicitly,
  -- including the built-in default when no pg_default_acl row exists.
  if exists (
    select 1
    from aclexplode(
      coalesce(
        (
          select d.defaclacl
          from pg_default_acl d
          where d.defaclrole = (
            select oid from pg_roles where rolname = current_user
          )
            and d.defaclnamespace = 0
            and d.defaclobjtype = 'f'
        ),
        acldefault(
          'f',
          (select oid from pg_roles where rolname = current_user)
        )
      )
    ) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'new functions must not grant EXECUTE to PUBLIC by default';
  end if;

  if has_table_privilege('authenticated', 'public.user_device_sessions', 'select') then
    raise exception 'authenticated must not read user_device_sessions';
  end if;
  if has_table_privilege('authenticated', 'public.password_reset_sessions', 'select') then
    raise exception 'authenticated must not read password_reset_sessions';
  end if;
  if has_table_privilege('authenticated', 'public.auth_rate_limits', 'select') then
    raise exception 'authenticated must not read auth_rate_limits';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'role', 'update') then
    raise exception 'authenticated must not update profile roles';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'username', 'update')
    or has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update') then
    raise exception 'profile updates must go through the backend API';
  end if;

  if has_table_privilege('authenticated', 'public.students', 'select')
    or has_table_privilege('authenticated', 'public.enrollments', 'select')
    or has_table_privilege('authenticated', 'public.fee_records', 'select')
    or has_table_privilege('authenticated', 'public.fee_operations', 'select')
    or has_table_privilege('authenticated', 'public.fee_operation_items', 'select')
    or has_table_privilege('authenticated', 'public.payments', 'select') then
    raise exception 'browser roles must use the redacted backend API for business data';
  end if;

  if has_table_privilege('anon', 'public.fee_records', 'insert')
    or has_table_privilege('anon', 'public.fee_records', 'update')
    or has_table_privilege('anon', 'public.fee_records', 'delete')
    or has_table_privilege('anon', 'public.fee_records', 'truncate')
    or has_table_privilege('authenticated', 'public.fee_records', 'insert')
    or has_table_privilege('authenticated', 'public.fee_records', 'update')
    or has_table_privilege('authenticated', 'public.fee_records', 'delete')
    or has_table_privilege('authenticated', 'public.fee_records', 'truncate') then
    raise exception 'browser roles must not write or truncate fee records directly';
  end if;
  if has_table_privilege('anon', 'public.payments', 'insert')
    or has_table_privilege('anon', 'public.payments', 'update')
    or has_table_privilege('anon', 'public.payments', 'delete')
    or has_table_privilege('anon', 'public.payments', 'truncate')
    or has_table_privilege('authenticated', 'public.payments', 'insert')
    or has_table_privilege('authenticated', 'public.payments', 'update')
    or has_table_privilege('authenticated', 'public.payments', 'delete')
    or has_table_privilege('authenticated', 'public.payments', 'truncate') then
    raise exception 'browser roles must not write or truncate payment history directly';
  end if;
  if has_table_privilege('anon', 'public.fee_operations', 'select')
    or has_table_privilege('anon', 'public.fee_operation_items', 'select')
    or has_table_privilege('authenticated', 'public.fee_operations', 'insert')
    or has_table_privilege('authenticated', 'public.fee_operations', 'update')
    or has_table_privilege('authenticated', 'public.fee_operations', 'delete')
    or has_table_privilege('authenticated', 'public.fee_operations', 'truncate')
    or has_table_privilege('authenticated', 'public.fee_operation_items', 'insert')
    or has_table_privilege('authenticated', 'public.fee_operation_items', 'update')
    or has_table_privilege('authenticated', 'public.fee_operation_items', 'delete')
    or has_table_privilege('authenticated', 'public.fee_operation_items', 'truncate') then
    raise exception 'browser roles must not access the fee operation ledger';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('fee_records', 'payments', 'fee_operations', 'fee_operation_items')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'fee and payment browser write policies must be removed';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.fee_message_templates'::regclass
      and conname in (
        'fee_message_templates_version_check',
        'fee_message_templates_reminder_length_check',
        'fee_message_templates_received_length_check'
      )
      and contype = 'c'
      and convalidated
  ) <> 3 then
    raise exception 'fee message template constraints are missing or unvalidated';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fee_message_templates'::regclass
      and conname = 'fee_message_templates_updated_by_fkey'
      and contype = 'f'
      and confrelid = 'public.profiles'::regclass
      and confdeltype = 'n'
      and convalidated
  ) then
    raise exception 'fee message template updater foreign key is missing';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.fee_message_templates'::regclass
      and tgname = 'fee_message_templates_updated_at'
      and not tgisinternal
  ) then
    raise exception 'fee message template updated-at trigger is missing';
  end if;
  if (
    select count(*)
    from public.fee_message_templates
  ) <> 1 or not exists (
    select 1
    from public.fee_message_templates
    where id = 1
      and version >= 1
      and char_length(payment_reminder_template) between 20 and 1400
      and char_length(payment_received_template) between 20 and 1400
      and position('{{ngay_den_han}}' in payment_reminder_template) > 0
      and position('{{ngay_den_han}}' in payment_received_template) > 0
      and position('{{nhac_qua_han}}' in payment_reminder_template) = 0
      and updated_at is not null
  ) then
    raise exception 'fee message template singleton seed is missing or invalid';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fee_records'::regclass
      and conname = 'fee_records_period_format_check'
      and contype = 'c'
  ) then
    raise exception 'fee period format constraint is missing';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fee_records'::regclass
      and conname = 'fee_records_amounts_check'
      and contype = 'c'
  ) then
    raise exception 'fee amount constraint is missing';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fee_records'::regclass
      and conname = 'fee_records_payment_state_check'
      and contype = 'c'
  ) then
    raise exception 'fee payment-state constraint is missing';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fee_records'::regclass
      and conname = 'fee_records_notification_state_check'
      and contype = 'c'
  ) then
    raise exception 'fee notification-state constraint is missing';
  end if;
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fee_records'::regclass
      and conname in (
        'fee_records_period_format_check',
        'fee_records_amounts_check',
        'fee_records_payment_state_check',
        'fee_records_notification_state_check'
      )
      and not convalidated
  ) then
    raise exception 'fee integrity constraints must be validated before release';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fee_records'::regclass
      and conname = 'fee_records_protected_identity_snapshot_check'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'protected fee identity snapshots must be validated';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_fee_record_id_fkey'
      and confdeltype = 'r'
  ) then
    raise exception 'payment history must restrict fee-record deletion';
  end if;
  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.payments'::regclass
      and attname = 'payment_method'
      and attnotnull
  ) then
    raise exception 'payment method must be required';
  end if;
  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.fee_records'::regclass
      and attname = 'refunded_amount'
      and attnotnull
      and atthasdef
  ) then
    raise exception 'fee refund projection must be required and have a default';
  end if;
  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.payments'::regclass
      and attname = 'entry_type'
      and attnotnull
  ) or not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.payments'::regclass
      and attname = 'related_payment_id'
      and not attnotnull
  ) or not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.payments'::regclass
      and attname = 'idempotency_key'
      and not attnotnull
  ) then
    raise exception 'payment refund ledger columns are missing or malformed';
  end if;
  if (
    select array_agg(e.enumlabel::text order by e.enumsortorder)
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'payment_entry_type'
  ) is distinct from array[
    'payment', 'payment_reversal', 'refund', 'refund_reversal'
  ]::text[] then
    raise exception 'payment entry type enum is missing or malformed';
  end if;
  if (
    select count(*)
    from pg_constraint
    where conrelid in (
        'public.fee_records'::regclass,
        'public.payments'::regclass
      )
      and conname in (
        'fee_records_refund_state_check',
        'payments_entry_shape_check',
        'payments_related_payment_id_fkey'
      )
      and convalidated
  ) <> 3 then
    raise exception 'refund ledger constraints are missing or unvalidated';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.payments'::regclass
      and tgname = 'payments_append_only_row'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.payments'::regclass
      and tgname = 'payments_append_only_truncate'
      and not tgisinternal
  ) then
    raise exception 'payment ledger append-only triggers are missing';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.fee_operations'::regclass
      and tgname = 'trg_fee_operations_append_only'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.fee_operations'::regclass
      and tgname = 'trg_fee_operations_truncate_append_only'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.fee_operation_items'::regclass
      and tgname = 'trg_fee_operation_items_append_only'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.fee_operation_items'::regclass
      and tgname = 'trg_fee_operation_items_truncate_append_only'
      and not tgisinternal
  ) then
    raise exception 'fee operation ledger append-only triggers are missing';
  end if;

  -- Verify behavior as well as trigger names. Each expected error runs inside
  -- its own subtransaction, so these probes never change staging data.
  if exists (select 1 from public.fee_operations) then
    begin
      update public.fee_operations
      set total_amount = total_amount + 1
      where id = (select id from public.fee_operations limit 1);
      raise exception 'fee operation ledger accepted a mutation';
    exception
      when insufficient_privilege then null;
    end;

    begin
      delete from public.fee_operations
      where id = (select id from public.fee_operations limit 1);
      raise exception 'fee operation ledger accepted a deletion';
    exception
      when insufficient_privilege then null;
    end;
  end if;

  if exists (select 1 from public.fee_operation_items) then
    begin
      update public.fee_operation_items
      set amount_delta = amount_delta + 1
      where id = (select id from public.fee_operation_items limit 1);
      raise exception 'fee operation item ledger accepted a mutation';
    exception
      when insufficient_privilege then null;
    end;

    begin
      delete from public.fee_operation_items
      where id = (select id from public.fee_operation_items limit 1);
      raise exception 'fee operation item ledger accepted a deletion';
    exception
      when insufficient_privilege then null;
    end;
  end if;

  begin
    truncate table public.fee_operation_items;
    raise exception 'fee operation item ledger accepted truncation';
  exception
    when insufficient_privilege then null;
  end;

  begin
    -- CASCADE lets PostgreSQL reach the parent table trigger even though
    -- fee_operation_items holds a restrictive foreign key to this ledger.
    truncate table public.fee_operations cascade;
    raise exception 'fee operation ledger accepted truncation';
  exception
    when insufficient_privilege then null;
  end;
  if (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'ux_fee_operations_request_action',
        'ix_fee_operations_cursor',
        'ix_fee_operations_action_cursor',
        'ix_fee_operations_actor_cursor',
        'ix_fee_operations_period_cursor',
        'ix_fee_operation_items_operation',
        'ix_fee_operation_items_student',
        'ix_fee_operation_items_class',
        'ux_fee_operation_items_payment'
      )
  ) <> 9 then
    raise exception 'fee operation ledger indexes are missing';
  end if;
  if (
    select count(*)
    from pg_trigger
    where (
        (tgrelid = 'public.payments'::regclass and tgname in (
          'payments_validate_ledger_entry',
          'payments_apply_refund_projection'
        ))
        or (
          tgrelid = 'public.fee_records'::regclass
          and tgname = 'fee_records_protect_refund_projection'
        )
      )
      and not tgisinternal
  ) <> 3 then
    raise exception 'refund validation and projection triggers are missing';
  end if;
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_payments_fee_record_id'
  ) then
    raise exception 'payment lookup index is missing';
  end if;
  if (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'ux_payments_refund_request_record',
        'ux_payments_refund_reversal_related',
        'ux_payments_payment_reversal_related',
        'idx_payments_related_payment',
        'idx_payments_fee_entry_created',
        'idx_fee_records_period_refunded'
      )
  ) <> 6 then
    raise exception 'refund idempotency, relation or lookup indexes are missing';
  end if;
  -- R6-D19: contract đã drop period-unique; identity là (enrollment, cycle_no).
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'ux_fee_records_enrollment_cycle'
  ) then
    raise exception 'fee cycle identity index is missing';
  end if;
  if to_regclass('public.ix_fee_records_outstanding_due') is null then
    raise exception 'cross-period outstanding fee queue index is missing';
  end if;

  if exists (
    select 1
    from public.fee_records fee
    left join (
      select
        fee_record_id,
        coalesce(sum(
          case
            when entry_type = 'refund' then abs(amount)
            when entry_type = 'refund_reversal' then -amount
            else 0
          end
        ), 0) as refunded_amount
      from public.payments
      group by fee_record_id
    ) ledger on ledger.fee_record_id = fee.id
    where fee.refunded_amount is distinct from coalesce(ledger.refunded_amount, 0)
  ) then
    raise exception 'fee refund projection does not reconcile with payment history';
  end if;

  select
    exists (
      select 1
      from public.fee_records
      where id = '10000000-0000-0000-0000-000000000004'::uuid
    )
    and exists (
      select 1
      from public.profiles
      where id = '10000000-0000-0000-0000-000000000007'::uuid
    )
    and (
      select count(*)
      from public.payments
      where id in (
        '10000000-0000-0000-0000-000000000005'::uuid,
        '10000000-0000-0000-0000-000000000006'::uuid
      )
    ) = 2
  into has_refund_upgrade_fixture;

  -- These deterministic ledger rows are injected only by the CI upgrade
  -- fixture. Production databases must still pass this verifier when those
  -- test-only records are intentionally absent.
  if exists (
    select 1
    from public.payments
    where id in (
      '10000000-0000-0000-0000-000000000005'::uuid,
      '10000000-0000-0000-0000-000000000006'::uuid
    )
  ) and (
    select count(*)
    from public.payments
    where id in (
        '10000000-0000-0000-0000-000000000005'::uuid,
        '10000000-0000-0000-0000-000000000006'::uuid
      )
      and (
        (amount > 0 and entry_type = 'payment')
        or (amount < 0 and entry_type = 'payment_reversal')
      )
  ) <> 2 then
    raise exception 'migration 028 did not classify the legacy payment ledger';
  end if;

  -- Exercise the checks when the verification database has business fixtures.
  -- Every expected error rolls its subtransaction back, so this leaves no data.
  select id into sample_enrollment_id from public.enrollments limit 1;

  if sample_enrollment_id is not null then
    -- Direct payment before a reminder is a supported workflow since migration
    -- 031. Prove that the coherent PAID shape is accepted, then roll the probe
    -- back so this verifier remains side-effect free on staging.
    begin
      insert into public.fee_records (
        enrollment_id, period, base_amount, discount_amount, status,
        cycle_no, origin, coverage_start, coverage_end, base_due_date,
        adjusted_due_date
      ) values (
        sample_enrollment_id, '2099-13', 100000, 0, 'UNPAID',
        99, 'CYCLE_GENERATOR', '2099-01-01', '2099-02-01', '2099-01-01', '2099-01-01'
      );
      raise exception 'fee period constraint accepted an invalid month';
    exception
      when check_violation then null;
    end;

    begin
      insert into public.fee_records (
        enrollment_id, period, base_amount, discount_amount, status,
        cycle_no, origin, coverage_start, coverage_end, base_due_date,
        adjusted_due_date
      ) values (
        sample_enrollment_id, '9999-11', -1, 0, 'UNPAID',
        99, 'CYCLE_GENERATOR', '2099-01-01', '2099-02-01', '2099-01-01', '2099-01-01'
      );
      raise exception 'fee amount constraint accepted a negative base amount';
    exception
      when check_violation then null;
    end;

    begin
      insert into public.fee_records (
        enrollment_id,
        period,
        base_amount,
        discount_amount,
        status,
        paid_amount,
        paid_date,
        cycle_no,
        origin,
        coverage_start,
        coverage_end,
        base_due_date,
        adjusted_due_date
      ) values (
        sample_enrollment_id,
        '9999-10',
        100000,
        0,
        'PAID',
        100000,
        current_date,
        99,
        'CYCLE_GENERATOR',
        '2099-01-01',
        '2099-02-01',
        '2099-01-01',
        '2099-01-01'
      );
      raise exception 'rollback successful direct-payment probe'
        using errcode = 'P9002';
    exception
      when sqlstate 'P9002' then null;
    end;

    begin
      insert into public.fee_records (
        enrollment_id,
        period,
        base_amount,
        discount_amount,
        status,
        notified_at,
        notification_channel,
        cycle_no,
        origin,
        coverage_start,
        coverage_end,
        base_due_date,
        adjusted_due_date
      ) values (
        sample_enrollment_id,
        '9999-09',
        100000,
        0,
        'UNPAID',
        now(),
        'zalo_manual',
        99,
        'CYCLE_GENERATOR',
        '2099-01-01',
        '2099-02-01',
        '2099-01-01',
        '2099-01-01'
      );
      raise exception 'notification constraint accepted a missing message';
    exception
      when check_violation then null;
    end;
  end if;

  if has_refund_upgrade_fixture then
    begin
      insert into public.payments (
        fee_record_id,
        amount,
        payment_date,
        payment_method,
        entry_type,
        related_payment_id,
        idempotency_key,
        note,
        created_by
      ) values (
        '10000000-0000-0000-0000-000000000004',
        -1000,
        current_date,
        'bank_transfer',
        'refund',
        '10000000-0000-0000-0000-000000000005',
        gen_random_uuid(),
        null,
        '10000000-0000-0000-0000-000000000007'
      );
      raise exception 'refund ledger accepted a missing reason';
    exception
      when check_violation then null;
    end;

    begin
      update public.fee_records
      set refunded_amount = 1
      where id = '10000000-0000-0000-0000-000000000004';
      raise exception 'refund projection accepted a direct update';
    exception
      when sqlstate '55000' then null;
    end;

    -- Zero-value classes are a supported domain case. Verify that the expanded
    -- ledger still accepts an auditable zero payment and its exact reversal.
    begin
      insert into public.payments (
        id, fee_record_id, amount, payment_date, payment_method, entry_type, note
      ) values (
        '10000000-0000-0000-0000-000000000008',
        '10000000-0000-0000-0000-000000000004',
        0,
        current_date,
        'bank_transfer',
        'payment',
        'CI zero-value payment'
      );
      insert into public.payments (
        fee_record_id,
        amount,
        payment_date,
        payment_method,
        entry_type,
        related_payment_id,
        note
      ) values (
        '10000000-0000-0000-0000-000000000004',
        0,
        current_date,
        'bank_transfer',
        'payment_reversal',
        '10000000-0000-0000-0000-000000000008',
        'CI zero-value payment reversal'
      );
      raise exception 'rollback successful zero-value ledger probe';
    exception
      when raise_exception then null;
    end;
  end if;

  -- ---------------------------------------------------------------------
  -- Migration 051: canonical schedule invariant, backup ACL, index policy,
  -- and TEACHER/ASSISTANT link separation probes.
  -- ---------------------------------------------------------------------

  -- 051 canonical shape, relaxed by migration 122: an unassigned class may
  -- keep an empty teacher list. The legacy assistant_ids field is optional,
  -- but it must remain a JSON array whenever it is present.
  if exists (
    select 1
      from public.classes c,
           jsonb_array_elements(
             case
               when jsonb_typeof(c.schedule -> 'slots') = 'array'
               then c.schedule -> 'slots'
               else '[]'::jsonb
             end
           ) as slot
     where c.schedule is not null
       and (
         not (slot ? 'teacher_ids')
         or jsonb_typeof(slot -> 'teacher_ids') <> 'array'
         or (
           slot ? 'assistant_ids'
           and jsonb_typeof(slot -> 'assistant_ids') <> 'array'
         )
       )
  ) then
    raise exception 'class schedule staff fields are not canonical JSON arrays';
  end if;

  -- 051 backup table must exist, stay RLS-enabled (FORCE) and be unreadable/
  -- unwritable by browser/runtime roles, with drift markers present.
  if to_regclass('public._migration_051_class_schedule_backup') is null then
    raise exception 'migration 051 backup table is missing';
  end if;
  if not exists (
    select 1
      from pg_class
     where oid = 'public._migration_051_class_schedule_backup'::regclass
       and relrowsecurity
       and relforcerowsecurity
  ) then
    raise exception 'migration 051 backup table must keep RLS and FORCE RLS enabled';
  end if;
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = '_migration_051_class_schedule_backup'
       and column_name in ('schedule_before', 'version_before', 'updated_at_before',
                           'schedule_after', 'version_after', 'updated_at_after')
     group by table_name
    having count(*) = 6
  ) then
    raise exception 'migration 051 backup table must carry full drift markers';
  end if;
  if has_table_privilege('anon', 'public._migration_051_class_schedule_backup', 'SELECT')
     or has_table_privilege('authenticated', 'public._migration_051_class_schedule_backup', 'SELECT')
     or has_table_privilege('service_role', 'public._migration_051_class_schedule_backup', 'SELECT')
     or has_table_privilege('anon', 'public._migration_051_class_schedule_backup', 'INSERT')
     or has_table_privilege('authenticated', 'public._migration_051_class_schedule_backup', 'INSERT')
     or has_table_privilege('service_role', 'public._migration_051_class_schedule_backup', 'INSERT')
  then
    raise exception 'migration 051 backup must not be accessible to browser/runtime roles';
  end if;
  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = '_migration_051_class_schedule_backup'
       and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')
       and permissive = 'PERMISSIVE'
       and (roles = '{anon,authenticated,service_role}'::name[]
            or roles && array['anon'::name, 'authenticated'::name, 'service_role'::name])
  ) then
    raise exception 'migration 051 backup must not expose a permissive policy to browser roles';
  end if;

  -- Canonical assignment: explicit teacher/assistant ids của mọi slot phải là
  -- subset đúng role của junction. Chỉ fail khi DB có dữ liệu (fixture).
  if exists (
    select 1 from public.classes c where c.schedule is not null
  ) then
    if exists (
      select 1
        from public.classes c,
             jsonb_array_elements(c.schedule -> 'slots') as slot,
             jsonb_array_elements_text(
               coalesce(slot -> 'teacher_ids', '[]'::jsonb)
             ) as tid
       where c.schedule is not null
         and not exists (
           select 1
             from public.class_teachers ct
             join public.staff_members sm on sm.id = ct.teacher_id
            where ct.class_id = c.id
              and ct.teacher_id = tid::uuid
              and sm.staff_type = 'TEACHER'
         )
    ) then
      raise exception 'canonical teacher assignment is not a TEACHER junction subset';
    end if;
    if exists (
      select 1
        from public.classes c,
             jsonb_array_elements(c.schedule -> 'slots') as slot,
             jsonb_array_elements_text(
               coalesce(slot -> 'assistant_ids', '[]'::jsonb)
             ) as aid
       where c.schedule is not null
         and not exists (
           select 1
             from public.class_teachers ct
             join public.staff_members sm on sm.id = ct.teacher_id
            where ct.class_id = c.id
              and ct.teacher_id = aid::uuid
              and sm.staff_type = 'ASSISTANT'
         )
    ) then
      raise exception 'canonical assistant assignment is not an ASSISTANT junction subset';
    end if;
  end if;

  -- Index policy: classes_operational_dates_idx (042) phải tồn tại với cột
  -- date; index trùng của 051 không được giữ lại.
  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'classes'
       and indexname = 'classes_operational_dates_idx'
  ) then
    raise exception 'classes_operational_dates_idx must exist for date-range queries';
  end if;
  declare
    _operational_dates_idxdef text;
  begin
    select indexdef into _operational_dates_idxdef
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'classes'
       and indexname = 'classes_operational_dates_idx';
    if _operational_dates_idxdef is null
       or _operational_dates_idxdef not like '%cancelled_at%'
       or _operational_dates_idxdef not like '%end_date%'
    then
      raise exception 'classes_operational_dates_idx must cover cancelled_at and end_date';
    end if;
  end;
  if exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'classes'
       and indexname = 'idx_classes_lifecycle_date_range'
  ) then
    raise exception 'redundant migration 051 lifecycle index must not exist';
  end if;

  -- Probe TEACHER/ASSISTANT link separation: xóa teacher link không được xóa
  -- assistant link của cùng class. Chạy trong subtransaction để không để lại
  -- dữ liệu; chỉ chạy khi tìm được một class có đủ teacher + assistant.
  declare
    probe_class_id uuid;
    probe_teacher_id uuid;
    probe_assistant_id uuid;
    assistant_survived boolean := false;
  begin
    select c.id, l1.teacher_id, l2.teacher_id
      into probe_class_id, probe_teacher_id, probe_assistant_id
      from public.classes c
      join public.class_teachers l1
        on l1.class_id = c.id
       and l1.teacher_id in (
         select sm.id from public.staff_members sm where sm.staff_type = 'TEACHER'
       )
      join public.class_teachers l2
        on l2.class_id = c.id
       and l2.teacher_id in (
         select sm.id from public.staff_members sm where sm.staff_type = 'ASSISTANT'
       )
     limit 1;

    if probe_class_id is not null then
      delete from public.class_teachers
       where class_id = probe_class_id
         and teacher_id = probe_teacher_id;
      select exists (
        select 1
          from public.class_teachers
         where class_id = probe_class_id
           and teacher_id = probe_assistant_id
      ) into assistant_survived;
      if not assistant_survived then
        raise exception 'removing a teacher link removed the assistant link';
      end if;
      raise exception 'rollback successful teacher/assistant link probe'
        using errcode = 'P9003';
    end if;
  exception
    when sqlstate 'P9003' then null;
  end;

  -- ---------------------------------------------------------------------
  -- Migration 052: role snapshot + symmetric role-change guard probes.
  -- ---------------------------------------------------------------------

  -- staff_type_snapshot phải tồn tại, NOT NULL, check TEACHER|ASSISTANT.
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'class_teacher_events'
       and column_name = 'staff_type_snapshot'
       and is_nullable = 'NO'
  ) then
    raise exception 'class_teacher_events.staff_type_snapshot must exist and be NOT NULL';
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.class_teacher_events'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%TEACHER%'
       and pg_get_constraintdef(oid) like '%ASSISTANT%'
  ) then
    raise exception 'class_teacher_events.staff_type_snapshot must have a TEACHER|ASSISTANT check';
  end if;
  -- Không được còn event thiếu snapshot (backfill triệt để).
  if exists (
    select 1 from public.class_teacher_events
     where staff_type_snapshot is null
  ) then
    raise exception 'class_teacher_events contains rows without staff_type_snapshot';
  end if;

  -- Probe role-change đối xứng: staff đang có link class_teachers không đổi
  -- role theo bất kỳ chiều nào. Chạy trong subtransaction, cleanup bằng rollback.
  declare
    probe_staff_teacher uuid;
    probe_staff_assistant uuid;
    probe_link_class uuid;
    probe_role_changed boolean;
  begin
    -- Tìm một teacher và một assistant đang có ít nhất một link bất kỳ.
    select sm.id, link.class_id
      into probe_staff_teacher, probe_link_class
      from public.staff_members sm
      join public.class_teachers link on link.teacher_id = sm.id
     where sm.staff_type = 'TEACHER'
     limit 1;

    if probe_staff_teacher is not null then
      begin
        update public.staff_members
           set staff_type = 'ASSISTANT'
         where id = probe_staff_teacher;
        raise exception 'teacher with a class link changed role to ASSISTANT';
      exception
        when raise_exception then null;
      end;
    end if;

    select sm.id, link.class_id
      into probe_staff_assistant, probe_link_class
      from public.staff_members sm
      join public.class_teachers link on link.teacher_id = sm.id
     where sm.staff_type = 'ASSISTANT'
     limit 1;

    if probe_staff_assistant is not null then
      begin
        update public.staff_members
           set staff_type = 'TEACHER'
         where id = probe_staff_assistant;
        raise exception 'assistant with a class link changed role to TEACHER';
      exception
        when raise_exception then null;
      end;
    end if;

    raise exception 'rollback successful symmetric role-change probes'
      using errcode = 'P9004';
  exception
    when sqlstate 'P9004' then null;
  end;

  -- ---------------------------------------------------------------------
  -- Migration 053: schedule adjustments, session exceptions, snapshots and
  -- append-only events.
  -- ---------------------------------------------------------------------

  -- R6-D03/D19: operational_end_date đã bị contract-drop; lifecycle chỉ theo
  -- planned end (không FINALIZING, makeup không kéo dài class).
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'classes'
       and column_name = 'operational_end_date'
  ) then
    raise exception 'classes.operational_end_date must be dropped (R6 contract)';
  end if;

  -- Exception state machine constraints.
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.class_session_exceptions'::regclass
       and conname = 'class_session_exceptions_replacement_duration_check'
       and contype = 'c' and convalidated
  ) then
    raise exception 'make-up duration must equal original duration at DB level';
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.class_session_exceptions'::regclass
       and conname = 'class_session_exceptions_replacement_after_original_check'
       and contype = 'c' and convalidated
  ) then
    raise exception 'make-up must be scheduled after the original at DB level';
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.class_session_exceptions'::regclass
       and conname = 'class_session_exceptions_state_shape_check'
       and contype = 'c' and convalidated
  ) then
    raise exception 'exception state-specific nullability must be enforced';
  end if;

  -- Tối đa một active exception + completed fact unique.
  if to_regclass('public.ux_class_session_exceptions_active_original') is null then
    raise exception 'one active exception per original occurrence must be unique';
  end if;
  if to_regclass('public.ux_class_session_exceptions_completed_original') is null then
    raise exception 'completed make-up facts must be unique per original';
  end if;

  -- Replacement conflict lookup index + unresolved lookup index.
  if to_regclass('public.idx_class_session_exceptions_replacement') is null then
    raise exception 'replacement conflict lookup index is missing';
  end if;
  if to_regclass('public.idx_class_session_exceptions_unresolved_class') is null then
    raise exception 'unresolved make-up lookup index is missing';
  end if;

  -- Append-only events: triggers + runtime cannot update/delete/truncate.
  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.class_schedule_adjustment_events'::regclass
       and t.tgname = 'trg_class_schedule_adjustment_events_append_only'
       and not t.tgisinternal and t.tgenabled <> 'D'
  ) or not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.class_schedule_adjustment_events'::regclass
       and t.tgname = 'trg_class_schedule_adjustment_events_truncate'
       and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception 'class schedule adjustment events must be append-only';
  end if;
  if has_function_privilege(
    'anon', 'public.block_class_schedule_adjustment_event_mutation()', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.block_class_schedule_adjustment_event_mutation()', 'execute'
  ) then
    raise exception 'adjustment event guard function must not be browser executable';
  end if;

  if exists (select 1 from public.class_schedule_adjustment_events) then
    begin
      update public.class_schedule_adjustment_events
         set new_payload = '{}'::jsonb
       where id = (select id from public.class_schedule_adjustment_events limit 1);
      raise exception 'adjustment event ledger accepted a mutation';
    exception
      when insufficient_privilege then null;
    end;
    begin
      delete from public.class_schedule_adjustment_events
       where id = (select id from public.class_schedule_adjustment_events limit 1);
      raise exception 'adjustment event ledger accepted a deletion';
    exception
      when insufficient_privilege then null;
    end;
  end if;
  begin
    truncate table public.class_schedule_adjustment_events;
    raise exception 'adjustment event ledger accepted truncation';
  exception
    when insufficient_privilege then null;
  end;

  -- Browser roles: không đọc/ghi trực tiếp các bảng mới.
  if has_table_privilege('anon', 'public.class_schedule_adjustments', 'select')
     or has_table_privilege('anon', 'public.class_schedule_adjustments', 'insert')
     or has_table_privilege('authenticated', 'public.class_schedule_adjustments', 'select')
     or has_table_privilege('authenticated', 'public.class_schedule_adjustments', 'insert')
     or has_table_privilege('anon', 'public.class_session_exceptions', 'select')
     or has_table_privilege('authenticated', 'public.class_session_exceptions', 'select')
     or has_table_privilege('authenticated', 'public.class_session_exceptions', 'insert')
     or has_table_privilege('anon', 'public.class_session_staff_snapshots', 'select')
     or has_table_privilege('authenticated', 'public.class_session_staff_snapshots', 'select')
     or has_table_privilege('anon', 'public.class_session_student_snapshots', 'select')
     or has_table_privilege('authenticated', 'public.class_session_student_snapshots', 'select')
     or has_table_privilege('anon', 'public.class_schedule_adjustment_events', 'select')
     or has_table_privilege('authenticated', 'public.class_schedule_adjustment_events', 'select')
     or has_table_privilege('authenticated', 'public.class_schedule_adjustment_events', 'insert')
  then
    raise exception 'browser roles must not access schedule adjustment tables directly';
  end if;

  -- Snapshots chỉ chứa trường entitlement/display — không contact/private note.
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name in (
         'class_session_staff_snapshots', 'class_session_student_snapshots'
       )
       and column_name in (
         'phone', 'zalo_name', 'parent_phone', 'student_phone', 'notes'
       )
  ) then
    raise exception 'make-up snapshots must not store contact or private data';
  end if;

  -- ---------------------------------------------------------------------
  -- Migrations 070/071: retired viewer invitations and payroll integrity.
  -- ---------------------------------------------------------------------
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.account_invitations'::regclass
       and conname = 'account_invitations_role_staff_check'
       and contype = 'c' and convalidated
  ) then
    raise exception 'account invitation role/staff invariant must be validated';
  end if;
  if to_regclass('public.account_invitations_active_teacher_staff_uniq') is null then
    raise exception 'active teacher invitation reservation index is missing';
  end if;
  if exists (
    select 1 from public.account_invitations
     where role = 'viewer' and consumed_at is null and revoked_at is null
  ) then
    raise exception 'active viewer invitations are forbidden';
  end if;
  if has_table_privilege('anon', 'public.account_invitations', 'select')
     or has_table_privilege('authenticated', 'public.account_invitations', 'select')
  then
    raise exception 'browser roles must not access account invitations directly';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.staff_compensation_rates'::regclass
       and conname = 'staff_compensation_rates_range'
       and contype = 'c' and convalidated
  ) then
    raise exception 'staff compensation half-open range constraint is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.staff_compensation_rates'::regclass
       and tgname = 'trg_staff_compensation_rates_no_overlap'
       and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'staff compensation overlap trigger must be enabled';
  end if;
  if to_regclass('public.staff_earning_primary_uniq') is null
     or to_regclass('public.staff_earning_request_uniq') is null
     or to_regclass('public.staff_payroll_settlements_request_uniq') is null
     or to_regclass('public.staff_payroll_settlement_items_settlement_ledger_uniq') is null
  then
    raise exception 'payroll idempotency/exactly-once indexes are incomplete';
  end if;
  if has_table_privilege('anon', 'public.staff_earning_ledger', 'select')
     or has_table_privilege('authenticated', 'public.staff_earning_ledger', 'select')
     or has_table_privilege('anon', 'public.staff_payroll_settlements', 'select')
     or has_table_privilege('authenticated', 'public.staff_payroll_settlements', 'select')
     or has_table_privilege('anon', 'public.staff_payroll_settlement_reversals', 'select')
     or has_table_privilege('authenticated', 'public.staff_payroll_settlement_reversals', 'select')
  then
    raise exception 'browser roles must not access payroll ledgers directly';
  end if;

  -- Migration 077: each teacher earns their own immutable per-staff rate for
  -- a shared session. There is no class-level split/pro-rata amount.
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.staff_earning_ledger'::regclass
       and tgname = 'staff_earning_rate_snapshot_integrity'
       and not tgisinternal
       and tgenabled <> 'D'
  ) then
    raise exception 'staff earning rate-snapshot integrity trigger is missing';
  end if;
  if has_function_privilege(
    'anon', 'public.validate_staff_earning_rate_snapshot()', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.validate_staff_earning_rate_snapshot()', 'execute'
  ) then
    raise exception 'staff earning integrity function must not be browser executable';
  end if;
  if exists (
    select 1
      from public.staff_earning_ledger earning
      join public.staff_attendance_entries attendance
        on attendance.id = earning.attendance_entry_id
     where earning.entry_type = 'EARNING'
       and (
         earning.staff_id <> attendance.staff_id
         or earning.amount <> attendance.rate_amount
         or earning.amount <= 0
       )
  ) then
    raise exception 'staff earning ledger contains a split or mismatched amount';
  end if;

  if to_regclass('public.staff_payroll_settlement_reversals') is null
     or not (select relrowsecurity and relforcerowsecurity
             from pg_class where oid = 'public.staff_payroll_settlement_reversals'::regclass)
  then
    raise exception 'payroll settlement reversal ledger security is incomplete';
  end if;

  -- Migration 074: suspension windows are half-open, bounded and non-overlapping;
  -- enrollment cannot bypass the application guard while a class is suspended.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.class_schedule_adjustments'::regclass
       and conname = 'class_schedule_adjustments_max_window_check'
       and contype = 'c' and convalidated
  ) then
    raise exception 'suspension window max-duration constraint is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.class_schedule_adjustments'::regclass
       and tgname = 'trg_class_schedule_adjustments_no_overlap'
       and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'suspension overlap trigger must be enabled';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.enrollments'::regclass
       and tgname = 'trg_enrollments_no_open_suspension'
       and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'enrollment suspension guard trigger must be enabled';
  end if;
  if has_function_privilege(
    'anon', 'public.block_overlapping_open_suspension()', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.block_overlapping_open_suspension()', 'execute'
  ) or has_function_privilege(
    'anon', 'public.block_enrollment_during_open_suspension()', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.block_enrollment_during_open_suspension()', 'execute'
  ) then
    raise exception 'suspension guard functions must not be browser executable';
  end if;

  -- Migration 075: early-payment requests are auditable snapshots.  Browser
  -- roles may use the server API, never read or mutate the request/QR ledger
  -- directly; item constraints and payment provenance must be present.
  if to_regclass('public.payment_request_items') is null then
    raise exception 'early payment item snapshot table is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.payment_request_items'::regclass
       and conname = 'payment_request_items_code_check'
       and contype = 'c' and convalidated
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.payment_request_items'::regclass
       and conname = 'payment_request_items_dates_check'
       and contype = 'c' and convalidated
  ) then
    raise exception 'early payment item snapshot constraints are missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'payments'
       and column_name in ('payment_origin', 'payment_request_id')
     group by table_schema, table_name
     having count(*) = 2
  ) then
    raise exception 'payment provenance columns are missing';
  end if;
  if has_table_privilege('anon', 'public.payment_requests', 'select')
     or has_table_privilege('authenticated', 'public.payment_requests', 'select')
     or has_table_privilege('anon', 'public.payment_request_items', 'select')
     or has_table_privilege('authenticated', 'public.payment_request_items', 'select')
     or has_table_privilege('anon', 'public.payment_request_events', 'select')
     or has_table_privilege('authenticated', 'public.payment_request_events', 'select')
  then
    raise exception 'browser roles must not read early payment request ledgers';
  end if;
  if to_regclass('public.payment_requests_request_id_uniq') is null
     or to_regclass('public.payments_provider_transaction_uniq') is null then
    raise exception 'early payment idempotency indexes are missing';
  end if;

  -- Migration 076: per-slot teacher assignment is append-only and server-only.
  if to_regclass('public.class_schedule_slot_teacher_events') is null then
    raise exception 'per-slot teacher assignment history table is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.class_schedule_slot_teacher_events'::regclass
       and conname = 'class_schedule_slot_teacher_events_range_check'
       and contype = 'c' and convalidated
  ) then
    raise exception 'per-slot teacher assignment date constraint is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.class_schedule_slot_teacher_events'::regclass
       and tgname = 'class_schedule_slot_teacher_events_append_only'
       and not tgisinternal and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.class_schedule_slot_teacher_events'::regclass
       and tgname = 'class_schedule_slot_teacher_events_truncate'
       and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'per-slot teacher assignment history must be append-only';
  end if;
  if has_table_privilege('anon', 'public.class_schedule_slot_teacher_events', 'select')
     or has_table_privilege('authenticated', 'public.class_schedule_slot_teacher_events', 'select')
     or has_table_privilege('anon', 'public.class_schedule_slot_teacher_events', 'insert')
     or has_table_privilege('authenticated', 'public.class_schedule_slot_teacher_events', 'insert')
  then
    raise exception 'browser roles must not access per-slot teacher assignment history';
  end if;
  if has_function_privilege(
    'anon', 'public.block_class_schedule_slot_teacher_event_mutation()', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.block_class_schedule_slot_teacher_event_mutation()', 'execute'
  ) then
    raise exception 'per-slot teacher history guard must not be browser executable';
  end if;

  -- M082/M083: every business/audit row is owned by exactly one admin
  -- workspace.  The immutable registry and security audit are included too;
  -- omitting either would allow cross-admin metadata leakage.
  if to_regclass('public.workspaces') is null
     or not exists (
       select 1 from pg_constraint
        where conrelid = 'public.account_security_events'::regclass
          and conname = 'account_security_events_workspace_fkey'
          and contype = 'f'
     )
     or not exists (
       select 1 from pg_constraint
        where conrelid = 'public.student_code_registry'::regclass
          and conname = 'student_code_registry_workspace_fkey'
          and contype = 'f'
     )
  then
    raise exception 'workspace isolation migration is incomplete';
  end if;
  if exists (
    select 1
      from (
        values
          ('profiles'), ('account_invitations'), ('classes'),
          ('class_lifecycle_events'), ('class_schedule_slots'),
          ('class_schedule_slot_staff'), ('class_schedule_slot_teacher_events'),
          ('class_teachers'), ('class_teacher_events'), ('enrollments'),
          ('enrollment_slot_selections'), ('enrollment_service_credit_events'),
          ('service_credit_allocations'), ('fee_message_templates'),
          ('fee_records'), ('fee_operations'), ('fee_operation_items'),
          ('payments'), ('payment_requests'), ('payment_request_items'),
          ('payment_request_events'), ('payment_provider_deliveries'),
          ('payment_provider_attempts'), ('payment_posting_queue'),
          ('workspace_payment_accounts'), ('workspace_payment_providers'),
          ('workspace_payment_webhooks'),
          ('class_schedule_adjustments'), ('class_session_exceptions'),
          ('class_session_staff_snapshots'), ('class_session_student_snapshots'),
          ('class_schedule_adjustment_events'), ('staff_members'),
          ('staff_account_links'), ('staff_account_link_events'),
          ('staff_compensation_rates'), ('staff_compensation_rate_events'),
          ('staff_attendance_entries'), ('staff_earning_ledger'),
          ('staff_payroll_settlements'), ('staff_payroll_settlement_items'),
          ('staff_payroll_settlement_reversals'), ('students'),
          ('student_lifecycle_events'), ('account_security_events'),
          ('student_code_registry'), ('workspace_payment_accounts'),
          ('workspace_payment_providers')
      ) as required(table_name)
      left join information_schema.columns column_
        on column_.table_schema = 'public'
       and column_.table_name = required.table_name
       and column_.column_name = 'workspace_id'
     where column_.column_name is null
  ) then
    raise exception 'one or more tenant-owned relations lack workspace_id';
  end if;
  if exists (
    select 1
      from public.profiles p
     where p.workspace_id is null
  ) or exists (
    select 1
      from public.classes c
     where c.workspace_id is null
  ) or exists (
    select 1
      from public.students s
     where s.workspace_id is null
  ) then
    raise exception 'tenant-owned rows must never have a null workspace_id';
  end if;
  if has_table_privilege('anon', 'public.workspaces', 'select')
     or has_table_privilege('authenticated', 'public.workspaces', 'select')
     or has_table_privilege('anon', 'public.account_security_events', 'select')
     or has_table_privilege('authenticated', 'public.account_security_events', 'select')
     or has_table_privilege('anon', 'public.student_code_registry', 'select')
     or has_table_privilege('authenticated', 'public.student_code_registry', 'select')
  then
    raise exception 'browser roles must not read workspace metadata or audit registries';
  end if;
  -- Dev is an application-effective role derived from OWNER_USER_ID, not a
  -- persisted user_role enum value. Every database workspace owner must still
  -- belong to the workspace they own; this is the enforceable tenant boundary.
  if exists (
    select 1
      from public.workspaces workspace_
     where workspace_.owner_user_id is not null
       and not exists (
         select 1 from public.profiles profile_
          where profile_.id = workspace_.owner_user_id
            and profile_.workspace_id = workspace_.id
       )
  ) then
    raise exception 'workspace owners must belong to their owned workspace';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.account_security_events'::regclass
       and tgname = 'account_security_events_workspace_stamp'
       and not tgisinternal and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.student_code_registry'::regclass
       and tgname = 'student_code_registry_workspace_stamp'
       and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'workspace insert guards are missing for audit registries';
  end if;

  -- M084: creating a new admin invitation is the only permitted cross-
  -- workspace hand-off.  The trigger must validate an owner-less target and
  -- the inviter's current workspace; no generic cross-tenant write may pass.
  if position(
    'tg_table_name = ''account_invitations''' in
    pg_get_functiondef('public.stamp_workspace_id()'::regprocedure)
  ) = 0 then
    raise exception 'admin invitation workspace hand-off guard is missing';
  end if;
  -- Execute the hand-off once in a rollback-only subtransaction.  This catches
  -- the common regression where the ORM/trigger rejects a legitimate admin
  -- invitation because its reserved workspace differs from the inviter's.
  declare
    probe_owner_id uuid;
    probe_owner_workspace_id uuid;
    probe_workspace_id uuid;
  begin
    select p.id, p.workspace_id
      into probe_owner_id, probe_owner_workspace_id
      from public.profiles p
     where p.role = 'admin'
       and p.account_status <> 'disabled'
     order by p.created_at, p.id
     limit 1;
    if probe_owner_id is not null and probe_owner_workspace_id is not null then
      begin
        perform set_config(
          'app.workspace_id', probe_owner_workspace_id::text, false
        );
        insert into public.workspaces (owner_user_id, name)
        values (null, 'workspace hand-off probe')
        returning id into probe_workspace_id;
        insert into public.account_invitations (
          id, email, token_hash, role, invited_by, expires_at, workspace_id
        ) values (
          gen_random_uuid(),
          'workspace-handoff-probe+' || gen_random_uuid()::text || '@invalid.example',
          encode(gen_random_bytes(32), 'hex'),
          'admin',
          probe_owner_id,
          now() + interval '1 hour',
          probe_workspace_id
        );
        raise exception 'rollback successful workspace hand-off probe'
          using errcode = 'P9005';
      exception
        when sqlstate 'P9005' then null;
      end;
    end if;
  end;

  -- M088/M089/M090/M091: explicit Admin-to-parent sharing audit, Dev-only
  -- operations control plane, honest Pay2S plan label, and production runtime
  -- grants. These checks
  -- intentionally fail closed before the UI can advertise a half-migrated
  -- payment flow.
  if exists (
    select required_column.column_name
    from (
      values
        ('sent_channel'), ('send_count')
    ) as required_column(column_name)
    where not exists (
      select 1
      from information_schema.columns column_
      where column_.table_schema = 'public'
        and column_.table_name = 'payment_requests'
        and column_.column_name = required_column.column_name
    )
  ) or exists (
    select required_column.column_name
    from (
      values
        ('idempotency_key'), ('event_metadata')
    ) as required_column(column_name)
    where not exists (
      select 1
      from information_schema.columns column_
      where column_.table_schema = 'public'
        and column_.table_name = 'payment_request_events'
        and column_.column_name = required_column.column_name
    )
  ) then
    raise exception 'payment request sharing audit columns are missing';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_send_count_check'
      and contype = 'c'
      and convalidated
  ) or not exists (
    select 1
    from pg_index index_
    where index_.indrelid = 'public.payment_request_events'::regclass
      and index_.indexrelid = 'public.payment_request_events_idempotency_key_uniq'::regclass
  ) then
    raise exception 'payment request sharing idempotency safeguards are missing';
  end if;
  if to_regclass('ops.platform_actions') is null
     or to_regprocedure('ops.platform_overview()') is null
     or to_regprocedure('ops.disable_workspace_pay2s(uuid,uuid,text)') is null
  then
    raise exception 'Dev operations control plane migration is incomplete';
  end if;
  if not exists (
    select 1
    from pg_class relation_
    join pg_namespace namespace_ on namespace_.oid = relation_.relnamespace
    where namespace_.nspname = 'ops'
      and relation_.relname = 'platform_actions'
      and relation_.relrowsecurity
      and relation_.relforcerowsecurity
  ) then
    raise exception 'operations audit ledger must keep RLS and FORCE RLS enabled';
  end if;
  if to_regclass('ops.platform_pay2s_settings') is not null
     or to_regprocedure('ops.platform_pay2s_mode()') is not null
     or to_regprocedure('ops.platform_pay2s_setting()') is not null
     or to_regprocedure('ops.set_platform_pay2s_mode(text,uuid)') is not null
     or to_regprocedure('ops.platform_pay2s_credentials()') is not null
     or to_regprocedure(
       'ops.set_platform_pay2s_credentials(text,text,text,text,uuid)'
     ) is not null
  then
    raise exception 'shared Pay2S credential surface must be removed';
  end if;
  if exists (
    select 1
      from public.workspace_payment_providers
     where connection_mode <> 'byo'
  ) or not exists (
    select 1 from pg_constraint constraint_
     where constraint_.conrelid = 'public.workspace_payment_providers'::regclass
       and constraint_.conname = 'workspace_payment_providers_connection_mode_check'
       and constraint_.contype = 'c'
       and constraint_.convalidated
       and pg_get_constraintdef(constraint_.oid) like '%connection_mode = ''byo''%'
  ) then
    raise exception 'every workspace must own an independent Pay2S connection';
  end if;
  if has_schema_privilege('anon', 'ops', 'USAGE')
     or has_schema_privilege('authenticated', 'ops', 'USAGE')
     or has_function_privilege('anon', 'ops.platform_overview()', 'execute')
     or has_function_privilege('authenticated', 'ops.platform_overview()', 'execute')
     or has_function_privilege('anon', 'ops.disable_workspace_pay2s(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'ops.disable_workspace_pay2s(uuid,uuid,text)', 'execute')
  then
    raise exception 'browser roles must not access the Dev operations control plane';
  end if;
  if exists (select 1 from pg_roles where rolname = 'tpro_backend')
     and (
       not has_schema_privilege('tpro_backend', 'ops', 'USAGE')
       or not has_function_privilege(
         'tpro_backend', 'ops.platform_overview()', 'execute'
       )
       or not has_function_privilege(
         'tpro_backend',
         'ops.disable_workspace_pay2s(uuid,uuid,text)',
         'execute'
       )
     )
  then
    raise exception 'production runtime role must access the Dev operations control plane';
  end if;
  if not exists (
    select 1
    from information_schema.columns column_
    where column_.table_schema = 'public'
      and column_.table_name = 'workspace_payment_providers'
      and column_.column_name = 'plan'
      and replace(coalesce(column_.column_default, ''), ' ', '') in (
        '''unconfirmed''::text', '''unconfirmed'''
      )
  ) then
    raise exception 'Pay2S provider plan must not assume an undocumented free tier';
  end if;
  if to_regclass('public.payment_provider_deliveries_pay2s_transaction_uniq') is null then
    raise exception 'Pay2S Collection Link and transaction webhook deduplication index is missing';
  end if;
  -- Migration 093: every newly recorded bank transfer carries the selected
  -- receiving-account identity; legacy rows remain nullable for audit safety.
  if exists (
    select required.column_name
    from (
      values
        ('payments', 'settlement_account_id'),
        ('payments', 'settlement_bank_code_snapshot'),
        ('payments', 'settlement_bank_name_snapshot'),
        ('payments', 'settlement_account_number_snapshot'),
        ('payments', 'settlement_account_name_snapshot'),
        ('payment_requests', 'settlement_account_id')
    ) as required(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns column_
      where column_.table_schema = 'public'
        and column_.table_name = required.table_name
        and column_.column_name = required.column_name
    )
  ) then
    raise exception 'payment settlement account provenance columns are missing';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_settlement_snapshot_shape_check'
      and contype = 'c'
      and convalidated
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_cash_without_settlement_account_check'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'payment settlement account integrity constraints are missing';
  end if;
  if to_regclass('public.payments_settlement_account_idx') is null
     or to_regclass('public.payment_requests_settlement_account_idx') is null then
    raise exception 'payment settlement account lookup indexes are missing';
  end if;

  -- Migration 101: unmatched provider transactions remain workspace-scoped
  -- and explicitly reviewable without mutating the append-only delivery row.
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'payment_posting_queue'
       and column_name in (
         'transaction_snapshot', 'resolution', 'resolved_at', 'resolved_by'
       )
     group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'payment reconciliation queue columns are missing';
  end if;
  if to_regclass('public.payment_posting_queue_delivery_uniq') is null
     or to_regclass('public.payment_posting_queue_workspace_review_idx') is null
  then
    raise exception 'payment reconciliation indexes are missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.payment_posting_queue'::regclass
       and conname = 'payment_posting_queue_resolution_shape'
       and contype = 'c' and convalidated
  ) then
    raise exception 'payment reconciliation terminal-state constraint is missing';
  end if;

  -- Migration 111: immutable fee-operation rows retain the stable student
  -- code even when the current profile later changes lifecycle state.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'fee_operation_items'
       and column_name = 'student_code_snapshot'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.fee_operation_items'::regclass
       and conname = 'fee_operation_items_student_code_snapshot_check'
       and contype = 'c' and convalidated
  ) or to_regclass('public.ix_fee_operation_items_student_code') is null then
    raise exception 'fee operation student-code snapshot integrity is incomplete';
  end if;

  if to_regclass('public.ix_fee_records_outstanding_due') is null then
    raise exception 'outstanding fee queue index is missing';
  end if;

  -- Migrations 108/109: one canonical draft per student/period/kind; legacy
  -- per-record copies are removed after a lossless migration.
  if to_regclass('public.fee_message_drafts') is null
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.fee_message_drafts'::regclass
         and conname = 'fee_message_drafts_group_unique'
     )
     or not (select relrowsecurity and relforcerowsecurity
             from pg_class where oid = 'public.fee_message_drafts'::regclass)
  then
    raise exception 'canonical fee message draft storage is incomplete';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fee_records'
      and column_name in ('reminder_message_draft', 'received_message_draft')
  ) then
    raise exception 'legacy per-record fee message draft columns must be removed';
  end if;
  if exists (
    select 1
      from pg_roles role_
     where role_.rolname in ('tpro_backend', 'tpro_runtime')
       and not has_table_privilege(
         role_.rolname,
         'public.fee_message_drafts',
         'select,insert,update,delete'
       )
  ) then
    raise exception 'backend runtime must be able to manage grouped Zalo drafts';
  end if;

  -- Migration 103: bank-transfer payroll records retain payout-account evidence.
  if exists (
    select required.column_name
    from (
      values
        ('staff_payroll_settlements', 'settlement_account_id'),
        ('staff_payroll_settlements', 'settlement_bank_code_snapshot'),
        ('staff_payroll_settlements', 'settlement_bank_name_snapshot'),
        ('staff_payroll_settlements', 'settlement_account_number_snapshot'),
        ('staff_payroll_settlements', 'settlement_account_name_snapshot')
    ) as required(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns column_
      where column_.table_schema = 'public'
        and column_.table_name = required.table_name
        and column_.column_name = required.column_name
    )
  ) then
    raise exception 'payroll payout-account columns are missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff_payroll_settlements'::regclass
      and conname = 'staff_payroll_settlements_account_fkey'
      and contype = 'f'
  ) or to_regclass('public.staff_payroll_settlements_account_idx') is null
  then
    raise exception 'payroll payout-account safeguards are missing';
  end if;

  -- Migration 112: a renewed class is a new business record. The source
  -- remains immutable and request-level idempotency prevents duplicate classes.
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name in ('previous_class_id', 'continuation_request_id')
  ) <> 2 then
    raise exception 'class continuation lineage columns are missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.classes'::regclass
      and conname = 'classes_previous_class_workspace_fkey'
      and contype = 'f'
      and confdeltype = 'r'
  ) or to_regclass('public.ux_classes_continuation_request') is null then
    raise exception 'class continuation lineage or idempotency safeguards are missing';
  end if;

end $$;
