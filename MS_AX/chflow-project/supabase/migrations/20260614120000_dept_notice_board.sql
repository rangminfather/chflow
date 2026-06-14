-- =============================================================
-- 부서 공지게시판 (dept notice board)
--   대중적 게시판: 글 + 답글(댓글) + 이미지/파일 첨부 + 실명 표시
--   권한(부서 내 등급 department_members.grade, get_user_grade 사용):
--     읽기   : 승인된 부서 멤버 (grade 0~4)
--     글작성 : grade 0~3 (전도사/부장/부부장/총무/서기 + 교사)
--     답글   : grade 0~4 (학부모 포함 부서 멤버 전원)
--     고정/타인글 삭제 : grade 0~2 (임원진)
--   실제 접근은 SECURITY DEFINER RPC로 수행, RLS는 직접쿼리 차단용.
-- =============================================================

-- ───────────────────────── 테이블 ─────────────────────────
create table if not exists public.dept_notices (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references public.departments(id) on delete cascade,
  author_id      uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  body           text not null default '',
  is_pinned      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_dept_notices_dept
  on public.dept_notices (department_id, is_pinned desc, created_at desc);

create table if not exists public.dept_notice_comments (
  id          uuid primary key default gen_random_uuid(),
  notice_id   uuid not null references public.dept_notices(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists idx_dept_notice_comments_notice
  on public.dept_notice_comments (notice_id, created_at);

create table if not exists public.dept_notice_attachments (
  id           uuid primary key default gen_random_uuid(),
  notice_id    uuid references public.dept_notices(id) on delete cascade,
  comment_id   uuid references public.dept_notice_comments(id) on delete cascade,
  file_path    text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  position     int not null default 0,
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz default now(),
  constraint dept_notice_attach_target check (
    (notice_id is not null and comment_id is null) or
    (notice_id is null and comment_id is not null)
  )
);
create index if not exists idx_dept_notice_attach_notice
  on public.dept_notice_attachments (notice_id, position);
create index if not exists idx_dept_notice_attach_comment
  on public.dept_notice_attachments (comment_id, position);

-- ───────────────────────── RLS (직접쿼리 차단) ─────────────────────────
alter table public.dept_notices            enable row level security;
alter table public.dept_notice_comments    enable row level security;
alter table public.dept_notice_attachments enable row level security;

drop policy if exists dept_notices_select_own on public.dept_notices;
create policy dept_notices_select_own on public.dept_notices for select to authenticated
  using (author_id = auth.uid());

drop policy if exists dept_notice_comments_select_own on public.dept_notice_comments;
create policy dept_notice_comments_select_own on public.dept_notice_comments for select to authenticated
  using (author_id = auth.uid());

drop policy if exists dept_notice_attach_select_own on public.dept_notice_attachments;
create policy dept_notice_attach_select_own on public.dept_notice_attachments for select to authenticated
  using (uploaded_by = auth.uid());

-- ───────────────────────── RPC: 글 작성 (grade 0~3) ─────────────────────────
drop function if exists public.create_dept_notice(uuid, text, text, jsonb);
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
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception '제목을 입력하세요'; end if;

  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 3 then
    raise exception '공지 작성 권한이 없습니다 (임원진·교사만 가능)';
  end if;

  insert into public.dept_notices (department_id, author_id, title, body)
  values (p_department_id, auth.uid(), p_title, coalesce(p_body, ''))
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

-- ───────────────────────── RPC: 답글 작성 (grade 0~4) ─────────────────────────
drop function if exists public.add_dept_notice_comment(uuid, text, jsonb);
create or replace function public.add_dept_notice_comment(
  p_notice_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_notice public.dept_notices;
  v_grade smallint;
  v_comment_id uuid;
  v_author_name text;
  v_idx int := 0;
  v_att jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception '내용을 입력하세요'; end if;

  select * into v_notice from public.dept_notices where id = p_notice_id and deleted_at is null;
  if not found then raise exception '공지를 찾을 수 없습니다'; end if;

  v_grade := public.get_user_grade(v_notice.department_id);
  if v_grade > 4 then
    raise exception '이 부서의 공지에 답글을 달 권한이 없습니다';
  end if;

  insert into public.dept_notice_comments (notice_id, author_id, body)
  values (p_notice_id, auth.uid(), p_body)
  returning id into v_comment_id;

  if jsonb_typeof(p_attachments) = 'array' then
    for v_att in select * from jsonb_array_elements(p_attachments)
    loop
      insert into public.dept_notice_attachments
        (comment_id, file_path, file_name, mime_type, size_bytes, position, uploaded_by)
      values (
        v_comment_id,
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

  update public.dept_notices set updated_at = now() where id = p_notice_id;

  -- 공지 작성자에게 알림 (본인 답글 제외)
  if v_notice.author_id <> auth.uid() then
    select name into v_author_name from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
    values (
      v_notice.author_id,
      'dept_notice_reply',
      '💬 공지에 새 답글',
      coalesce(v_author_name, '멤버') || ': ' || left(p_body, 60),
      '/departments/d/' || v_notice.department_id || '/notices/board/' || p_notice_id,
      auth.uid(),
      jsonb_build_object('notice_id', p_notice_id, 'comment_id', v_comment_id)
    );
  end if;

  return v_comment_id;
end;
$$;
grant execute on function public.add_dept_notice_comment(uuid, text, jsonb) to authenticated;

-- ───────────────────────── RPC: 목록 ─────────────────────────
drop function if exists public.list_dept_notices(uuid, int, int);
create or replace function public.list_dept_notices(
  p_department_id uuid,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  id uuid,
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
  order by n.is_pinned desc, n.created_at desc
  limit p_limit offset p_offset;
end;
$$;
grant execute on function public.list_dept_notices(uuid, int, int) to authenticated;

-- ───────────────────────── RPC: 상세 (notice + comments + attachments) ─────────────────────────
drop function if exists public.get_dept_notice(uuid);
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

-- ───────────────────────── RPC: 글 삭제 (작성자 또는 grade 0~2) ─────────────────────────
drop function if exists public.delete_dept_notice(uuid);
create or replace function public.delete_dept_notice(p_notice_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_notice public.dept_notices;
  v_grade smallint;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into v_notice from public.dept_notices where id = p_notice_id and deleted_at is null;
  if not found then raise exception '공지를 찾을 수 없습니다'; end if;

  v_grade := public.get_user_grade(v_notice.department_id);
  if v_notice.author_id <> auth.uid() and v_grade > 2 then
    raise exception '삭제 권한이 없습니다';
  end if;

  update public.dept_notices set deleted_at = now() where id = p_notice_id;
end;
$$;
grant execute on function public.delete_dept_notice(uuid) to authenticated;

-- ───────────────────────── RPC: 고정 토글 (grade 0~2) ─────────────────────────
drop function if exists public.toggle_dept_notice_pin(uuid, boolean);
create or replace function public.toggle_dept_notice_pin(p_notice_id uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_notice public.dept_notices;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into v_notice from public.dept_notices where id = p_notice_id and deleted_at is null;
  if not found then raise exception '공지를 찾을 수 없습니다'; end if;
  if public.get_user_grade(v_notice.department_id) > 2 then
    raise exception '고정 권한이 없습니다 (임원진만 가능)';
  end if;
  update public.dept_notices set is_pinned = coalesce(p_pinned, false), updated_at = now()
    where id = p_notice_id;
end;
$$;
grant execute on function public.toggle_dept_notice_pin(uuid, boolean) to authenticated;

-- ───────────────────────── Storage 버킷 (비공개) + 정책 ─────────────────────────
insert into storage.buckets (id, name, public)
values ('dept-notice-attachments', 'dept-notice-attachments', false)
on conflict (id) do update set public = false;

-- 업로드: 본인 폴더(user_id/...)에만
drop policy if exists dept_notice_attach_upload on storage.objects;
create policy dept_notice_attach_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dept-notice-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 열람: 인증 사용자 (경로는 uuid 비공개 + 서명URL로만 노출). anon 차단.
drop policy if exists dept_notice_attach_read on storage.objects;
create policy dept_notice_attach_read on storage.objects
  for select to authenticated
  using (bucket_id = 'dept-notice-attachments');

-- 삭제: 본인 폴더 또는 시스템 관리자
drop policy if exists dept_notice_attach_delete on storage.objects;
create policy dept_notice_attach_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'dept-notice-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.get_user_role() in ('admin','office','pastor')
    )
  );
