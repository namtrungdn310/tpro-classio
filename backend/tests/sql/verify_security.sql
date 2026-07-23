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
        ('class_teachers'),
        ('classes'),
        ('enrollments'),
        ('fee_records'),
        ('fee_message_templates'),
        ('fee_operation_items'),
        ('fee_operations'),
        ('password_reset_sessions'),
        ('payments'),
        ('profiles'),
        ('staff_members'),
        ('students'),
        ('user_device_sessions')
    ) as required_table(table_name)
    where to_regclass(
      'public.' || quote_ident(required_table.table_name)
    ) is null
  ) then
    raise exception 'one or more required public tables are missing';
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
    from pg_trigger trigger_
    where trigger_.tgrelid = 'public.account_security_events'::regclass
      and trigger_.tgname = 'account_security_events_snapshot_insert'
      and not trigger_.tgisinternal
      and trigger_.tgenabled <> 'D'
  ) then
    raise exception 'account security events must capture immutable identity snapshots on insert';
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

    insert into public.profiles (id, username, full_name)
    values (
      account_delete_user_id,
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

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'staff_members'
      and column_name in ('auth_user_id', 'email')
  ) then
    raise exception 'obsolete staff account-link columns must be removed';
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
        'fee_message_templates_singleton_check',
        'fee_message_templates_version_check',
        'fee_message_templates_reminder_length_check',
        'fee_message_templates_received_length_check'
      )
      and contype = 'c'
      and convalidated
  ) <> 4 then
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
    where tgrelid = 'public.fee_operation_items'::regclass
      and tgname = 'trg_fee_operation_items_append_only'
      and not tgisinternal
  ) then
    raise exception 'fee operation ledger append-only triggers are missing';
  end if;
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
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'ux_fee_records_enrollment_period'
  ) then
    raise exception 'fee records must be unique per enrollment and period';
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
        enrollment_id, period, base_amount, discount_amount, status
      ) values (
        sample_enrollment_id, '2099-13', 100000, 0, 'UNPAID'
      );
      raise exception 'fee period constraint accepted an invalid month';
    exception
      when check_violation then null;
    end;

    begin
      insert into public.fee_records (
        enrollment_id, period, base_amount, discount_amount, status
      ) values (
        sample_enrollment_id, '9999-11', -1, 0, 'UNPAID'
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
        paid_date
      ) values (
        sample_enrollment_id,
        '9999-10',
        100000,
        0,
        'PAID',
        100000,
        current_date
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
        notification_channel
      ) values (
        sample_enrollment_id,
        '9999-09',
        100000,
        0,
        'UNPAID',
        now(),
        'zalo_manual'
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

end $$;
