-- =============================================================
-- 부서 공지게시판: 고유 게시번호(notice_no) + 목록 반환에 번호 추가
--   notice_no: 부서별 등록순 영구 번호 (1,2,3...). 삭제돼도 번호 재사용 안 함.
--   create_dept_notice: 새 글마다 해당 부서 max+1 부여 (advisory lock으로 동시작성 충돌 방지)
--   list_dept_notices(4-arg, p_year): notice_no 반환 추가
--   get_dept_notice: 상세에서도 #번호 표시 가능하도록 반환 추가
-- =============================================================

-- ───────────────────────── 컬럼 + 백필 + 유니크 ─────────────────────────
alter table public.dept_notices add column if not exists notice_no int;

-- 백필: 부서별 created_at(동률은 id) 순으로 1부터. soft-deleted 행도 번호 보존(max 일관성).
with ranked as (
  select id, row_number() over (
    partition by department_id order by created_at, id
  ) as rn
  from public.dept_notices
)
update public.dept_notices d
set notice_no = ranked.rn
from ranked
where d.id = ranked.id and d.notice_no is null;

create unique index if not exists ux_dept_notices_no
  on public.dept_notices (department_id, notice_no);

-- ───────────────────────── RPC: 글 작성 (notice_no 부여) ─────────────────────────
create or replace function public.create_dept_notice(
  p_department_id uuid,
  p_title text,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
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

  insert into public.dept_notices (department_id, author_id, title, body, notice_no)
  values (p_department_id, auth.uid(), p_title, coalesce(p_body, ''), v_no)
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

  -- 부서 멤버 전원에게 알림 (작성자 제외)
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
    and dm.user_id <> auth.uid();

  return v_notice_id;
end;
$$;
grant execute on function public.create_dept_notice(uuid, text, text, jsonb) to authenticated;

-- ───────────────────────── RPC: 목록 (notice_no 반환) ─────────────────────────
drop function if exists public.list_dept_notices(uuid, int, int, int);
create or replace function public.list_dept_notices(
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
begin
  if public.get_user_grade(p_department_id) > 4 then
    raise exception '이 부서 공지에 접근할 권한이 없습니다';
  end if;

  return query
  select
    n.id,
    n.notice_no,
    n.title,
    n.is_pinned,
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
    and (p_year is null or extract(year from n.created_at) = p_year)
  order by n.is_pinned desc, n.created_at desc
  limit p_limit offset p_offset;
end;
$$;
grant execute on function public.list_dept_notices(uuid, int, int, int) to authenticated;

-- ───────────────────────── RPC: 상세 (notice_no 반환 추가) ─────────────────────────
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

  select jsonb_build_object(
    'id', v_notice.id,
    'notice_no', v_notice.notice_no,
    'department_id', v_notice.department_id,
    'title', v_notice.title,
    'body', v_notice.body,
    'is_pinned', v_notice.is_pinned,
    'is_mine', v_notice.author_id = auth.uid(),
    'my_grade', v_grade,
    'can_manage', (v_grade <= 2 or v_notice.author_id = auth.uid()),
    'can_reply', (v_grade <= 4),
    'created_at', v_notice.created_at,
    'updated_at', v_notice.updated_at,
    'author', (
      select jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role)
      from public.profiles pr where pr.id = v_notice.author_id
    ),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
        'mime_type', a.mime_type, 'size_bytes', a.size_bytes
      ) order by a.position)
      from public.dept_notice_attachments a where a.notice_id = v_notice.id
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'is_mine', c.author_id = auth.uid(),
        'created_at', c.created_at,
        'author', jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role),
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
            'mime_type', a.mime_type, 'size_bytes', a.size_bytes
          ) order by a.position)
          from public.dept_notice_attachments a where a.comment_id = c.id
        ), '[]'::jsonb)
      ) order by c.created_at)
      from public.dept_notice_comments c
      left join public.profiles pr on pr.id = c.author_id
      where c.notice_id = v_notice.id and c.deleted_at is null
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function public.get_dept_notice(uuid) to authenticated;
