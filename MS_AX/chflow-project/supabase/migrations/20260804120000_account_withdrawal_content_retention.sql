-- Account withdrawal with department cleanup and authored-content retention.

-- 1. Keep the church member row, but distinguish an app account withdrawal
--    from the existing operational active/inactive member status.
alter table public.members
  add column if not exists account_state text;

update public.members
set account_state = case when guard_status = '탈퇴' then 'withdrawn' else 'active' end
where account_state is null or account_state not in ('active', 'withdrawn');

alter table public.members
  alter column account_state set default 'active',
  alter column account_state set not null;

alter table public.members drop constraint if exists members_account_state_check;
alter table public.members
  add constraint members_account_state_check check (account_state in ('active', 'withdrawn'));

alter table public.members
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid,
  add column if not exists withdrawal_reason text;

create index if not exists idx_members_account_state
  on public.members (account_state, withdrawn_at desc);

-- This table deliberately has no FK to auth.users. It is the author/name bridge
-- that remains after the login identity is deleted.
create table if not exists public.account_withdrawals (
  user_id             uuid primary key,
  member_id           uuid,
  member_name         text,
  username            text,
  email               text,
  withdrawn_at        timestamptz not null default now(),
  account_deleted_at  timestamptz,
  reason              text,
  member_snapshot     jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_account_withdrawals_member
  on public.account_withdrawals (member_id, withdrawn_at desc);

-- admin_delete_member is the explicit hard-delete path. Remove the archived
-- identity snapshot together with that member row; ordinary withdrawal leaves
-- it untouched and therefore remains recoverable/visible to administrators.
create or replace function public.cleanup_account_withdrawal_on_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.account_withdrawals where member_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_account_withdrawal_on_member_delete on public.members;
create trigger trg_cleanup_account_withdrawal_on_member_delete
before delete on public.members
for each row execute function public.cleanup_account_withdrawal_on_member_delete();

alter table public.account_withdrawals enable row level security;
revoke all on table public.account_withdrawals from anon, authenticated;

-- 2. Authored/history fields must not prevent auth deletion or cascade-delete
--    their rows. Personal ownership fields keep their original cleanup rules.
--    members.app_user_id is explicitly changed to SET NULL as a safety net.
do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as table_schema,
      c.relname as table_name,
      con.conname,
      con.confdeltype,
      array_agg(a.attname order by k.ord) as columns
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
    group by n.nspname, c.relname, con.conname, con.confdeltype
  loop
    if r.table_schema <> 'public' then
      continue;
    end if;

    if r.table_name = 'members'
       and cardinality(r.columns) = 1
       and r.columns[1] = 'app_user_id' then
      execute format('alter table %I.%I drop constraint if exists %I',
        r.table_schema, r.table_name, r.conname);
      execute format('alter table %I.%I add constraint %I foreign key (app_user_id) references auth.users(id) on delete set null',
        r.table_schema, r.table_name, r.conname);
      continue;
    end if;

    -- These rows are owned by the account and keep their existing cascade or
    -- SET NULL behavior. Everything else below is historical attribution.
    if cardinality(r.columns) <> 1
       or r.columns[1] not in (
         'created_by', 'author_id', 'sender_id', 'uploaded_by',
         'status_updated_by', 'deleted_by', 'updated_by', 'approved_by',
         'verified_by', 'reviewed_by', 'requester_id', 'approver_id',
         'recorded_by', 'promoted_by', 'chflow_user_id', 'actor_id',
         'target_user_id', 'reported_user_id', 'resolved_by', 'last_edited_by'
       ) then
      continue;
    end if;

    -- Preserve the UUID as a historical author/actor value, without requiring
    -- the deleted auth.users row to continue existing.
    execute format('alter table %I.%I drop constraint if exists %I',
      r.table_schema, r.table_name, r.conname);
  end loop;
end $$;

-- Soft deletion is used for admin content management. Existing comment/notice
-- tables already have deleted_at; these additions make the audit explicit.
alter table public.feedback_posts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;

alter table public.dept_notices
  add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;

alter table public.dept_notice_comments
  add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;

alter table public.dept_verse_memories
  add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text;

-- 3. The member invokes this while authenticated. It removes every department
--    membership regardless of ministry role, but does not delete authored rows.
drop function if exists public.withdraw_my_account(text);
create or replace function public.withdraw_my_account(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_member_id uuid;
  v_member_name text;
  v_profile_name text;
  v_username text;
  v_email text;
  v_snapshot jsonb;
  v_member_count int;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다';
  end if;

  select p.name, p.username, p.email
    into v_profile_name, v_username, v_email
  from public.profiles p
  where p.id = v_user_id;

  select
    (array_agg(m.id order by m.created_at))[1],
    min(m.name),
    count(*)::int,
    coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
    into v_member_id, v_member_name, v_member_count, v_snapshot
  from public.members m
  where m.app_user_id = v_user_id;

  insert into public.account_withdrawals (
    user_id, member_id, member_name, username, email, withdrawn_at,
    reason, member_snapshot
  ) values (
    v_user_id, v_member_id, coalesce(v_member_name, v_profile_name, v_username), v_username,
    v_email, now(), nullif(trim(coalesce(p_reason, '')), ''), v_snapshot
  )
  on conflict (user_id) do update set
    member_id = excluded.member_id,
    member_name = coalesce(excluded.member_name, account_withdrawals.member_name),
    username = coalesce(excluded.username, account_withdrawals.username),
    email = coalesce(excluded.email, account_withdrawals.email),
    withdrawn_at = excluded.withdrawn_at,
    reason = excluded.reason,
    member_snapshot = excluded.member_snapshot;

  update public.members
  set app_user_id = null,
      guard_status = '탈퇴',
      account_state = 'withdrawn',
      status = 'inactive',
      withdrawn_at = coalesce(withdrawn_at, now()),
      withdrawn_by = v_user_id,
      withdrawal_reason = nullif(trim(coalesce(p_reason, '')), '')
  where app_user_id = v_user_id;

  -- Remove all department roles and family/parent links in one operation.
  delete from public.dept_parent_children where parent_user_id = v_user_id;
  delete from public.department_members where user_id = v_user_id;

  -- Teaching assignments are operational memberships and must not retain an
  -- active teacher after account withdrawal. Attendance/history rows remain.
  update public.edu_classes c
  set teacher_id = null
  where c.teacher_id in (select t.id from public.edu_teachers t where t.user_id = v_user_id);

  update public.edu_students s
  set teacher_id = null
  where s.teacher_id in (select t.id from public.edu_teachers t where t.user_id = v_user_id);

  update public.edu_teachers
  set is_active = false
  where user_id = v_user_id;

  return jsonb_build_object(
    'user_id', v_user_id,
    'member_count', coalesce(v_member_count, 0),
    'department_memberships_removed', true,
    'content_retained', true
  );
end;
$$;
revoke execute on function public.withdraw_my_account(text) from public;
grant execute on function public.withdraw_my_account(text) to authenticated;

-- 4. Admin member search: preserve the existing API and add account-state
--    filtering/output so the withdrawn register can be managed in the same page.
drop function if exists public.admin_search_members_paged(text, text, text, text, integer, integer, boolean, boolean, text);
create or replace function public.admin_search_members_paged(
  p_query         text default null,
  p_plain         text default null,
  p_grassland     text default null,
  p_pasture       text default null,
  p_offset        int default 0,
  p_limit         int default 50,
  p_show_children boolean default true,
  p_show_parents  boolean default true,
  p_member_status text default 'active',
  p_account_state text default 'active'
)
returns table (
  id uuid,
  name text,
  phone text,
  home_phone text,
  gender text,
  family_church text,
  sub_role text,
  spouse_name text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  guard_status text,
  status text,
  account_state text,
  withdrawn_at timestamptz,
  has_account boolean,
  is_child boolean,
  source_page int,
  photo_url text,
  household_id uuid,
  pasture_id uuid,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_regex text := public.hangul_search_regex(p_query);
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  return query
  with filtered as (
    select
      m.id, m.name, m.phone, m.home_phone, m.gender, m.family_church,
      m.sub_role, m.spouse_name, h.address, p.name as pasture_name,
      g.name as grassland_name, pl.name as plain_name, m.guard_status,
      m.status, m.account_state, m.withdrawn_at,
      (m.app_user_id is not null) as has_account, m.is_child, m.source_page,
      m.photo_url, m.household_id, h.pasture_id,
      pl.order_no as pl_order, g.order_no as g_order,
      p.order_no as p_order, h.order_no as h_order
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.directory_pastures p on p.id = h.pasture_id
    left join public.grasslands g on g.id = p.grassland_id
    left join public.plains pl on pl.id = g.plain_id
    where (p_member_status is null or p_member_status = 'all'
      or p_account_state = 'withdrawn' or m.status = p_member_status)
      and (coalesce(p_account_state, 'active') = 'all'
        or m.account_state = coalesce(p_account_state, 'active'))
      and (
        p_query is null
        or m.name ilike '%' || p_query || '%'
        or m.phone ilike '%' || p_query || '%'
        or m.home_phone ilike '%' || p_query || '%'
        or h.home_phone ilike '%' || p_query || '%'
        or (v_regex is not null and m.name ~* v_regex)
      )
      and (p_plain is null or pl.name = p_plain)
      and (p_grassland is null or g.name = p_grassland)
      and (p_pasture is null or p.name = p_pasture)
      and (
        p_show_children or not exists (
          select 1 from public.member_relations r
          join public.members rm on rm.id = r.relative_id
          join public.households rh on rh.id = rm.household_id
          where r.subject_id = m.id
            and r.kind in ('parent', 'grandparent', 'great_grandparent')
            and rh.pasture_id = h.pasture_id
        )
      )
      and (
        p_show_parents or not exists (
          select 1 from public.member_relations r
          join public.members sm on sm.id = r.subject_id
          join public.households sh on sh.id = sm.household_id
          where r.relative_id = m.id
            and r.kind in ('parent', 'grandparent', 'great_grandparent')
            and sh.pasture_id = h.pasture_id
        )
      )
  )
  select f.id, f.name, f.phone, f.home_phone, f.gender, f.family_church,
    f.sub_role, f.spouse_name, f.address, f.pasture_name, f.grassland_name,
    f.plain_name, f.guard_status, f.status, f.account_state, f.withdrawn_at,
    f.has_account, f.is_child, f.source_page, f.photo_url, f.household_id,
    f.pasture_id, (select count(*) from filtered)::bigint
  from filtered f
  order by f.pl_order nulls last, f.g_order nulls last, f.p_order nulls last,
    f.h_order nulls last, f.name
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;
grant execute on function public.admin_search_members_paged(text, text, text, text, integer, integer, boolean, boolean, text, text) to authenticated;

-- 5. Withdrawn-member register for the content-management page.
drop function if exists public.admin_list_withdrawn_members(text);
create or replace function public.admin_list_withdrawn_members(p_query text default null)
returns table (
  id uuid,
  name text,
  phone text,
  withdrawn_at timestamptz,
  account_deleted_at timestamptz,
  content_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  return query
  select m.id, m.name, m.phone, m.withdrawn_at, aw.account_deleted_at,
    (
      select count(*) from (
        select 1 from public.feedback_posts p where p.author_id = aw.user_id
        union all select 1 from public.feedback_comments c where c.author_id = aw.user_id
        union all select 1 from public.dept_notices n where n.author_id = aw.user_id
        union all select 1 from public.dept_notice_comments c where c.author_id = aw.user_id
        union all select 1 from public.dept_verse_memories vm where vm.author_id = aw.user_id
      ) content
    )::bigint
  from public.members m
  left join public.account_withdrawals aw on aw.member_id = m.id
  where m.account_state = 'withdrawn'
    and (p_query is null or m.name ilike '%' || p_query || '%' or m.phone ilike '%' || p_query || '%')
  order by m.withdrawn_at desc nulls last, m.name;
end;
$$;
revoke execute on function public.admin_list_withdrawn_members(text) from public;
grant execute on function public.admin_list_withdrawn_members(text) to authenticated;

-- 6. Unified admin content list. Rows are soft-deleted, never hard-deleted,
--    so derivative records can continue to resolve their source IDs.
drop function if exists public.admin_list_member_content(uuid, text, boolean, int);
create or replace function public.admin_list_member_content(
  p_member_id uuid default null,
  p_kind text default 'all',
  p_include_deleted boolean default false,
  p_limit int default 200
)
returns table (
  content_kind text,
  content_id uuid,
  parent_id uuid,
  author_id uuid,
  author_name text,
  member_id uuid,
  department_name text,
  title text,
  body text,
  created_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  return query
  with author_map as (
    select aw.user_id, aw.member_id,
      coalesce(aw.member_name, aw.username, '탈퇴한 회원') as author_name
    from public.account_withdrawals aw
    union all
    select p.id, coalesce(p.member_id, m.id), coalesce(p.name, p.username, '회원')
    from public.profiles p
    left join public.members m on m.app_user_id = p.id
    where not exists (
      select 1 from public.account_withdrawals aw2 where aw2.user_id = p.id
    )
  ), rows as (
    select 'feedback_post'::text as content_kind, p.id as content_id,
      null::uuid as parent_id, p.author_id, coalesce(am.author_name, '탈퇴한 회원'),
      am.member_id, null::text as department_name, p.title, p.body,
      p.created_at, p.deleted_at
    from public.feedback_posts p
    left join author_map am on am.user_id = p.author_id
    where (p_kind = 'all' or p_kind = 'feedback_post')
      and (p_member_id is null or am.member_id = p_member_id)
      and (p_include_deleted or p.deleted_at is null)

    union all
    select 'feedback_comment', c.id, c.post_id, c.author_id,
      coalesce(am.author_name, '탈퇴한 회원'), am.member_id, null::text,
      p.title, c.body, c.created_at, c.deleted_at
    from public.feedback_comments c
    join public.feedback_posts p on p.id = c.post_id
    left join author_map am on am.user_id = c.author_id
    where (p_kind = 'all' or p_kind = 'feedback_comment')
      and (p_member_id is null or am.member_id = p_member_id)
      and (p_include_deleted or c.deleted_at is null)

    union all
    select 'dept_notice'::text, n.id, null::uuid, n.author_id,
      coalesce(am.author_name, '탈퇴한 회원'), am.member_id, d.name,
      n.title, n.body, n.created_at, n.deleted_at
    from public.dept_notices n
    left join public.departments d on d.id = n.department_id
    left join author_map am on am.user_id = n.author_id
    where (p_kind = 'all' or p_kind = 'dept_notice')
      and (p_member_id is null or am.member_id = p_member_id)
      and (p_include_deleted or n.deleted_at is null)

    union all
    select 'dept_notice_comment'::text, c.id, c.notice_id, c.author_id,
      coalesce(am.author_name, '탈퇴한 회원'), am.member_id, d.name,
      n.title, c.body, c.created_at, c.deleted_at
    from public.dept_notice_comments c
    join public.dept_notices n on n.id = c.notice_id
    left join public.departments d on d.id = n.department_id
    left join author_map am on am.user_id = c.author_id
    where (p_kind = 'all' or p_kind = 'dept_notice_comment')
      and (p_member_id is null or am.member_id = p_member_id)
      and (p_include_deleted or c.deleted_at is null)

    union all
    select 'verse_memory'::text, vm.id, null::uuid, vm.author_id,
      coalesce(am.author_name, '탈퇴한 회원'), am.member_id, d.name,
      vm.title, vm.body, vm.created_at, vm.deleted_at
    from public.dept_verse_memories vm
    left join public.departments d on d.id = vm.department_id
    left join author_map am on am.user_id = vm.author_id
    where (p_kind = 'all' or p_kind = 'verse_memory')
      and (p_member_id is null or am.member_id = p_member_id)
      and (p_include_deleted or vm.deleted_at is null)
  )
  select * from rows
  order by created_at desc nulls last
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;
revoke execute on function public.admin_list_member_content(uuid, text, boolean, int) from public;
grant execute on function public.admin_list_member_content(uuid, text, boolean, int) to authenticated;

-- Checked/bulk deletion is intentionally a soft delete.
drop function if exists public.admin_delete_member_content(jsonb, text);
create or replace function public.admin_delete_member_content(
  p_items jsonb,
  p_reason text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_kind text;
  v_id uuid;
  v_count int := 0;
  v_rows_affected int;
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_kind := item->>'kind';
    v_id := (item->>'id')::uuid;

    if v_kind = 'feedback_post' then
      update public.feedback_posts
      set deleted_at = coalesce(deleted_at, now()), deleted_by = auth.uid(),
          deletion_reason = nullif(trim(coalesce(p_reason, '')), '')
      where id = v_id;
      get diagnostics v_rows_affected = row_count;
      v_count := v_count + greatest(v_rows_affected, 0);
    elsif v_kind = 'feedback_comment' then
      with recursive sub as (
        select id from public.feedback_comments where id = v_id
        union all
        select c.id from public.feedback_comments c join sub on c.parent_comment_id = sub.id
      )
      update public.feedback_comments c
      set deleted_at = coalesce(c.deleted_at, now()), deleted_by = auth.uid(),
          deletion_reason = nullif(trim(coalesce(p_reason, '')), '')
      where c.id in (select id from sub);
      get diagnostics v_rows_affected = row_count;
      v_count := v_count + greatest(v_rows_affected, 0);
    elsif v_kind = 'dept_notice' then
      update public.dept_notices
      set deleted_at = coalesce(deleted_at, now()), deleted_by = auth.uid(),
          deletion_reason = nullif(trim(coalesce(p_reason, '')), '')
      where id = v_id;
      get diagnostics v_rows_affected = row_count;
      v_count := v_count + greatest(v_rows_affected, 0);
    elsif v_kind = 'dept_notice_comment' then
      update public.dept_notice_comments
      set deleted_at = coalesce(deleted_at, now()), deleted_by = auth.uid(),
          deletion_reason = nullif(trim(coalesce(p_reason, '')), '')
      where id = v_id;
      get diagnostics v_rows_affected = row_count;
      v_count := v_count + greatest(v_rows_affected, 0);
    elsif v_kind = 'verse_memory' then
      update public.dept_verse_memories
      set deleted_at = coalesce(deleted_at, now()), deleted_by = auth.uid(),
          deletion_reason = nullif(trim(coalesce(p_reason, '')), '')
      where id = v_id;
      get diagnostics v_rows_affected = row_count;
      v_count := v_count + greatest(v_rows_affected, 0);
    else
      raise exception '지원하지 않는 콘텐츠 형식입니다: %', v_kind;
    end if;
  end loop;

  return v_count;
end;
$$;
revoke execute on function public.admin_delete_member_content(jsonb, text) from public;
grant execute on function public.admin_delete_member_content(jsonb, text) to authenticated;

-- Hide soft-deleted feedback posts from the existing member-facing list.
-- The function keeps its established JSON response shape.
create or replace function public.list_feedback_posts(
  p_limit int default 20, p_offset int default 0,
  p_status text default null, p_scope text default 'all'
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role text; v_is_admin boolean; v_total int; v_rows jsonb;
begin
  v_role := public.get_user_role();
  v_is_admin := v_role in ('admin','office','pastor');
  select count(*)::int into v_total from public.feedback_posts p
  where p.deleted_at is null
    and (p_status is null or p.status::text = p_status)
    and (p_scope <> 'mine' or p.author_id = auth.uid());

  with page as (
    select p.id, p.seq, p.title, p.status, p.is_private, p.author_id, p.source,
      p.guest_name, p.created_at, p.updated_at, pr.name author_name, pr.sub_role author_sub_role
    from public.feedback_posts p left join public.profiles pr on pr.id = p.author_id
    where p.deleted_at is null
      and (p_status is null or p.status::text = p_status)
      and (p_scope <> 'mine' or p.author_id = auth.uid())
    order by p.created_at desc limit p_limit offset p_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'seq', page.seq, 'title', page.title, 'status', page.status,
    'is_private', page.is_private,
    'is_locked', (page.is_private and coalesce(page.author_id <> auth.uid(), true) and not v_is_admin),
    'is_mine', (page.author_id = auth.uid()),
    'author_name', coalesce(page.author_name, page.guest_name,
      case when page.source = 'signup_support' then '회원가입 문의' else '탈퇴한 회원' end),
    'author_sub_role', page.author_sub_role,
    'comment_count', (select count(*)::int from public.feedback_comments c
                      where c.post_id = page.id and c.deleted_at is null),
    'attachment_count', (select count(*)::int from public.feedback_attachments a where a.post_id = page.id),
    'created_at', page.created_at, 'updated_at', page.updated_at
  ) order by page.created_at desc), '[]'::jsonb) into v_rows from page;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;
grant execute on function public.list_feedback_posts(int, int, text, text) to authenticated;

-- Do not expose a soft-deleted feedback post through a direct link either.
create or replace function public.get_feedback_post(p_post_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_post public.feedback_posts;
  v_role text;
  v_is_admin boolean;
  v_can_read boolean;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  select * into v_post from public.feedback_posts where id = p_post_id;
  if not found then return null; end if;

  v_role := public.get_user_role();
  v_is_admin := v_role in ('admin', 'office', 'pastor');
  if v_post.deleted_at is not null and not v_is_admin then
    return null;
  end if;

  v_can_read := (v_post.author_id = auth.uid()) or v_is_admin or (not v_post.is_private);
  if not v_can_read then
    raise exception '비공개 글입니다';
  end if;

  select jsonb_build_object(
    'id', v_post.id, 'seq', v_post.seq, 'title', v_post.title, 'body', v_post.body,
    'status', v_post.status, 'is_private', v_post.is_private,
    'is_mine', (v_post.author_id = auth.uid()), 'is_admin', v_is_admin,
    'created_at', v_post.created_at, 'updated_at', v_post.updated_at,
    'author', coalesce(
      (select jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role)
       from public.profiles pr where pr.id = v_post.author_id),
      (select jsonb_build_object('id', aw.user_id, 'name', coalesce(aw.member_name, '탈퇴한 회원'), 'sub_role', null)
       from public.account_withdrawals aw where aw.user_id = v_post.author_id),
      jsonb_build_object('id', v_post.author_id, 'name', '탈퇴한 회원', 'sub_role', null)
    ),
    'guest', jsonb_build_object('name', v_post.guest_name, 'phone', v_post.guest_phone, 'source', v_post.source),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
      'mime_type', a.mime_type, 'size_bytes', a.size_bytes
    ) order by a.position) from public.feedback_attachments a where a.post_id = v_post.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'parent_comment_id', c.parent_comment_id, 'body', c.body,
      'is_admin_reply', c.is_admin_reply, 'is_mine', c.author_id = auth.uid(),
      'can_delete', (c.author_id = auth.uid() or v_is_admin), 'created_at', c.created_at,
      'author', coalesce(
        (select jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role)
         from public.profiles pr where pr.id = c.author_id),
        (select jsonb_build_object('id', aw.user_id, 'name', coalesce(aw.member_name, '탈퇴한 회원'), 'sub_role', null)
         from public.account_withdrawals aw where aw.user_id = c.author_id),
        jsonb_build_object('id', c.author_id, 'name', '탈퇴한 회원', 'sub_role', null)
      ),
      'attachments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
        'mime_type', a.mime_type, 'size_bytes', a.size_bytes
      ) order by a.position) from public.feedback_attachments a where a.comment_id = c.id), '[]'::jsonb)
    ) order by c.created_at)
      from public.feedback_comments c
      where c.post_id = v_post.id and c.deleted_at is null
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function public.get_feedback_post(uuid) to authenticated;
