-- =============================================================
-- (1) 공지게시판 "선생님만 보기" 플래그
--     teachers_only=true → grade 0~3(선생님 이상)만 목록·상세 노출, 학부모(4) 차단
--     작성 권한은 종전대로 grade 0~3. 알림도 teachers_only면 grade<=3 에게만.
-- (2) 공통메뉴 설정 (dept_menu_settings)
--     임원진(grade<=2)이 공통메뉴 서브항목의 이름/주석/접근등급을 부서별로 수정.
--     접근등급은 monthly-plan / review-problems 만 변경 가능(3 선생님 / 4 학부모).
-- =============================================================

-- ───────────────────────── (1) teachers_only ─────────────────────────
alter table public.dept_notices
  add column if not exists teachers_only boolean not null default false;

-- 작성 RPC: p_teachers_only 추가 (기존 4-arg 폐기 후 5-arg 재정의)
drop function if exists public.create_dept_notice(uuid, text, text, jsonb);
drop function if exists public.create_dept_notice(uuid, text, text, jsonb, boolean);
create function public.create_dept_notice(
  p_department_id uuid,
  p_title text,
  p_body text,
  p_attachments jsonb default '[]'::jsonb,
  p_teachers_only boolean default false
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_notice_id uuid;
  v_author_name text;
  v_idx int := 0;
  v_att jsonb;
  v_no int;
  v_teachers_only boolean := coalesce(p_teachers_only, false);
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception '제목을 입력하세요'; end if;

  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 3 then
    raise exception '공지 작성 권한이 없습니다 (임원진·교사만 가능)';
  end if;

  -- 부서 단위 잠금으로 notice_no 동시발급 충돌 방지
  perform pg_advisory_xact_lock(hashtext('dept_notice:' || p_department_id::text));
  select coalesce(max(notice_no), 0) + 1 into v_no
  from public.dept_notices where department_id = p_department_id;

  insert into public.dept_notices (department_id, author_id, title, body, notice_no, teachers_only)
  values (p_department_id, auth.uid(), p_title, coalesce(p_body, ''), v_no, v_teachers_only)
  returning id into v_notice_id;

  if jsonb_typeof(p_attachments) = 'array' then
    for v_att in select * from jsonb_array_elements(p_attachments)
    loop
      insert into public.dept_notice_attachments
        (notice_id, file_path, file_name, mime_type, size_bytes, position, uploaded_by)
      values (
        v_notice_id,
        v_att->>'file_path',
        coalesce(v_att->>'file_name', 'file'),
        v_att->>'mime_type',
        nullif(v_att->>'size_bytes','')::bigint,
        v_idx,
        auth.uid()
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  select name into v_author_name from public.profiles where id = auth.uid();

  -- 부서 멤버에게 알림 (작성자 제외). teachers_only면 선생님 이상(grade<=3)에게만.
  insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  select
    dm.user_id,
    'dept_notice_new',
    '📢 새 공지',
    coalesce(v_author_name, '작성자') || ': ' || left(p_title, 40),
    '/departments/d/' || p_department_id || '/notices/board/' || v_notice_id,
    auth.uid(),
    jsonb_build_object('notice_id', v_notice_id, 'department_id', p_department_id)
  from public.department_members dm
  where dm.department_id = p_department_id
    and dm.status = 'approved'
    and dm.user_id <> auth.uid()
    and (v_teachers_only = false or dm.grade <= 3);

  return v_notice_id;
end;
$$;
grant execute on function public.create_dept_notice(uuid, text, text, jsonb, boolean) to authenticated;

-- 목록 RPC: teachers_only 반환 + 학부모(>3)에게는 teachers_only 글 숨김
drop function if exists public.list_dept_notices(uuid, int, int);
drop function if exists public.list_dept_notices(uuid, int, int, int);
create function public.list_dept_notices(
  p_department_id uuid,
  p_limit int default 30,
  p_offset int default 0,
  p_year int default null
)
returns table (
  id uuid,
  notice_no int,
  title text,
  is_pinned boolean,
  teachers_only boolean,
  is_mine boolean,
  author_name text,
  author_sub_role text,
  comment_count int,
  attachment_count int,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grade smallint;
begin
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 4 then
    raise exception '이 부서 공지에 접근할 권한이 없습니다';
  end if;

  return query
  select
    n.id,
    n.notice_no,
    n.title,
    n.is_pinned,
    n.teachers_only,
    (n.author_id = auth.uid()) as is_mine,
    pr.name as author_name,
    pr.sub_role as author_sub_role,
    (select count(*)::int from public.dept_notice_comments c
       where c.notice_id = n.id and c.deleted_at is null) as comment_count,
    (select count(*)::int from public.dept_notice_attachments a
       where a.notice_id = n.id) as attachment_count,
    n.created_at,
    n.updated_at
  from public.dept_notices n
  left join public.profiles pr on pr.id = n.author_id
  where n.department_id = p_department_id
    and n.deleted_at is null
    and (n.teachers_only = false or v_grade <= 3)
    and (p_year is null or extract(year from n.created_at) = p_year)
  order by n.is_pinned desc, n.created_at desc
  limit p_limit offset p_offset;
end;
$$;
grant execute on function public.list_dept_notices(uuid, int, int, int) to authenticated;

-- 상세 RPC: teachers_only 반환 + 학부모(>3) 차단 (notice_no·parent·can_delete 유지)
create or replace function public.get_dept_notice(p_notice_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_notice public.dept_notices;
  v_grade smallint;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into v_notice from public.dept_notices where id = p_notice_id and deleted_at is null;
  if not found then return null; end if;
  v_grade := public.get_user_grade(v_notice.department_id);
  if v_grade > 4 then raise exception '이 부서 공지에 접근할 권한이 없습니다'; end if;
  if v_notice.teachers_only and v_grade > 3 then
    raise exception '선생님 이상만 볼 수 있는 공지입니다';
  end if;

  select jsonb_build_object(
    'id', v_notice.id, 'notice_no', v_notice.notice_no, 'department_id', v_notice.department_id,
    'title', v_notice.title, 'body', v_notice.body, 'is_pinned', v_notice.is_pinned,
    'teachers_only', v_notice.teachers_only,
    'is_mine', v_notice.author_id = auth.uid(), 'my_grade', v_grade,
    'can_manage', (v_grade <= 2 or v_notice.author_id = auth.uid()), 'can_reply', (v_grade <= 4),
    'created_at', v_notice.created_at, 'updated_at', v_notice.updated_at,
    'author', (select jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role)
               from public.profiles pr where pr.id = v_notice.author_id),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
      'mime_type', a.mime_type, 'size_bytes', a.size_bytes
    ) order by a.position) from public.dept_notice_attachments a where a.notice_id = v_notice.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'parent_comment_id', c.parent_comment_id, 'body', c.body,
      'is_mine', c.author_id = auth.uid(), 'can_delete', (c.author_id = auth.uid() or v_grade <= 2),
      'created_at', c.created_at,
      'author', jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role),
      'attachments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
        'mime_type', a.mime_type, 'size_bytes', a.size_bytes
      ) order by a.position) from public.dept_notice_attachments a where a.comment_id = c.id), '[]'::jsonb)
    ) order by c.created_at)
    from public.dept_notice_comments c left join public.profiles pr on pr.id = c.author_id
    where c.notice_id = v_notice.id and c.deleted_at is null), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function public.get_dept_notice(uuid) to authenticated;

-- ───────────────────────── (2) dept_menu_settings ─────────────────────────
create table if not exists public.dept_menu_settings (
  department_id uuid not null references public.departments(id) on delete cascade,
  menu_key      text not null,
  label         text,
  description   text,
  max_grade     smallint,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  primary key (department_id, menu_key)
);
alter table public.dept_menu_settings enable row level security;
-- 직접쿼리 차단 (RPC로만 접근)

-- 조회: 부서 멤버(grade 0~4) — 모든 멤버가 라벨/접근설정을 반영해서 봐야 함
drop function if exists public.get_dept_menu_settings(uuid);
create function public.get_dept_menu_settings(p_department_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grade smallint;
  v jsonb;
begin
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 4 then raise exception '접근 권한이 없습니다'; end if;
  select coalesce(jsonb_object_agg(menu_key, jsonb_build_object(
           'label', label, 'description', description, 'max_grade', max_grade)), '{}'::jsonb)
    into v
  from public.dept_menu_settings
  where department_id = p_department_id;
  return v;
end;
$$;
grant execute on function public.get_dept_menu_settings(uuid) to authenticated;

-- 저장: 임원진(grade 0~2)만. 접근등급은 monthly-plan / review-problems 만 변경 가능(3 또는 4).
drop function if exists public.set_dept_menu_setting(uuid, text, text, text, smallint);
create function public.set_dept_menu_setting(
  p_department_id uuid,
  p_menu_key text,
  p_label text default null,
  p_description text default null,
  p_max_grade smallint default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_max smallint := p_max_grade;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 2 then raise exception '메뉴 설정 권한이 없습니다 (임원진만 가능)'; end if;

  if p_menu_key not in ('notices/board','bulletin','verse-memory','monthly-plan','review-problems') then
    raise exception '알 수 없는 메뉴입니다';
  end if;

  -- 접근등급 변경은 월간교육계획서·복습문제만. 그 외는 학부모 고정(null 저장).
  if p_menu_key not in ('monthly-plan','review-problems') then
    v_max := null;
  elsif v_max is not null and v_max not in (3, 4) then
    raise exception '접근 등급 값이 올바르지 않습니다 (3=선생님, 4=학부모)';
  end if;

  insert into public.dept_menu_settings
    (department_id, menu_key, label, description, max_grade, updated_by, updated_at)
  values (
    p_department_id, p_menu_key,
    nullif(trim(coalesce(p_label, '')), ''),
    nullif(trim(coalesce(p_description, '')), ''),
    v_max, auth.uid(), now()
  )
  on conflict (department_id, menu_key) do update
    set label = excluded.label,
        description = excluded.description,
        max_grade = excluded.max_grade,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
grant execute on function public.set_dept_menu_setting(uuid, text, text, text, smallint) to authenticated;
