-- One-level nested replies and auditable soft deletion for feedback/dept notice comments.

alter table public.feedback_comments
  add column if not exists parent_comment_id uuid references public.feedback_comments(id) on delete cascade,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deletion_reason text;

alter table public.dept_notice_comments
  add column if not exists parent_comment_id uuid references public.dept_notice_comments(id) on delete cascade,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deletion_reason text;

create index if not exists idx_feedback_comments_parent
  on public.feedback_comments (parent_comment_id, created_at);
create index if not exists idx_dept_notice_comments_parent
  on public.dept_notice_comments (parent_comment_id, created_at);

drop function if exists public.add_feedback_comment(uuid, text, jsonb);
drop function if exists public.add_feedback_comment(uuid, text, jsonb, uuid);
create function public.add_feedback_comment(
  p_post_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb,
  p_parent_comment_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_comment_id uuid;
  v_post public.feedback_posts;
  v_parent public.feedback_comments;
  v_role text;
  v_is_admin boolean;
  v_author_name text;
  v_idx int := 0;
  v_att jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception '내용을 입력하세요'; end if;

  select * into v_post from public.feedback_posts where id = p_post_id;
  if not found then raise exception '게시글을 찾을 수 없습니다'; end if;

  v_role := public.get_user_role();
  v_is_admin := v_role in ('admin','office','pastor');
  if auth.uid() <> v_post.author_id and not v_is_admin then
    raise exception '댓글 작성 권한이 없습니다';
  end if;

  if p_parent_comment_id is not null then
    select * into v_parent
    from public.feedback_comments
    where id = p_parent_comment_id and post_id = p_post_id and deleted_at is null;
    if not found then raise exception '답글을 달 댓글을 찾을 수 없습니다'; end if;
    if v_parent.parent_comment_id is not null then
      raise exception '대댓글에는 다시 답글을 달 수 없습니다';
    end if;
  end if;

  insert into public.feedback_comments
    (post_id, author_id, body, is_admin_reply, parent_comment_id)
  values (p_post_id, auth.uid(), trim(p_body), v_is_admin, p_parent_comment_id)
  returning id into v_comment_id;

  if jsonb_typeof(p_attachments) = 'array' then
    for v_att in select * from jsonb_array_elements(p_attachments) loop
      insert into public.feedback_attachments
        (comment_id, file_path, file_name, mime_type, size_bytes, position, uploaded_by)
      values (
        v_comment_id, v_att->>'file_path', coalesce(v_att->>'file_name', 'image'),
        v_att->>'mime_type', nullif(v_att->>'size_bytes','')::int, v_idx, auth.uid()
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  select name into v_author_name from public.profiles where id = auth.uid();

  if v_is_admin then
    if v_post.author_id is not null and v_post.author_id <> auth.uid() then
      insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
      values (
        v_post.author_id, 'feedback_reply',
        case when p_parent_comment_id is null then '💬 관리자 답변' else '💬 새 대댓글' end,
        coalesce(v_author_name, '관리자') || ': ' || left(p_body, 60),
        '/feedback/' || p_post_id, auth.uid(),
        jsonb_build_object('post_id', p_post_id, 'comment_id', v_comment_id, 'parent_comment_id', p_parent_comment_id)
      );
    end if;
  else
    insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
    select pr.id, 'feedback_reply',
      case when p_parent_comment_id is null then '💬 불편신고 추가 메시지' else '💬 새 대댓글' end,
      coalesce(v_author_name, '사용자') || ': ' || left(p_body, 60),
      '/feedback/' || p_post_id, auth.uid(),
      jsonb_build_object('post_id', p_post_id, 'comment_id', v_comment_id, 'parent_comment_id', p_parent_comment_id)
    from public.profiles pr
    where pr.role in ('admin','office','pastor') and pr.id <> auth.uid();
  end if;

  if p_parent_comment_id is not null
     and v_parent.author_id <> auth.uid()
     and v_parent.author_id is distinct from v_post.author_id
     and not exists (
       select 1 from public.profiles pr
       where pr.id = v_parent.author_id
         and not v_is_admin
         and pr.role in ('admin','office','pastor')
     ) then
    insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
    values (
      v_parent.author_id, 'feedback_reply', '💬 내 댓글에 새 대댓글',
      coalesce(v_author_name, '사용자') || ': ' || left(p_body, 60),
      '/feedback/' || p_post_id, auth.uid(),
      jsonb_build_object('post_id', p_post_id, 'comment_id', v_comment_id, 'parent_comment_id', p_parent_comment_id)
    );
  end if;

  update public.feedback_posts set updated_at = now() where id = p_post_id;
  return v_comment_id;
end;
$$;
grant execute on function public.add_feedback_comment(uuid, text, jsonb, uuid) to authenticated;

drop function if exists public.delete_feedback_comment(uuid, text);
create function public.delete_feedback_comment(p_comment_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_comment public.feedback_comments;
  v_is_admin boolean;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into v_comment from public.feedback_comments where id = p_comment_id and deleted_at is null;
  if not found then raise exception '댓글을 찾을 수 없습니다'; end if;
  v_is_admin := public.get_user_role() in ('admin','office','pastor');
  if v_comment.author_id <> auth.uid() and not v_is_admin then
    raise exception '댓글 삭제 권한이 없습니다';
  end if;

  update public.feedback_comments
  set deleted_at = now(), deleted_by = auth.uid(),
      deletion_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_comment_id;

  update public.feedback_comments
  set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = '상위 댓글 삭제'
  where parent_comment_id = p_comment_id and deleted_at is null;

  update public.feedback_posts set updated_at = now() where id = v_comment.post_id;
end;
$$;
grant execute on function public.delete_feedback_comment(uuid, text) to authenticated;

drop function if exists public.add_dept_notice_comment(uuid, text, jsonb);
drop function if exists public.add_dept_notice_comment(uuid, text, jsonb, uuid);
create function public.add_dept_notice_comment(
  p_notice_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb,
  p_parent_comment_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_notice public.dept_notices;
  v_parent public.dept_notice_comments;
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
  if v_grade > 4 then raise exception '이 부서의 공지에 답글을 달 권한이 없습니다'; end if;

  if p_parent_comment_id is not null then
    select * into v_parent
    from public.dept_notice_comments
    where id = p_parent_comment_id and notice_id = p_notice_id and deleted_at is null;
    if not found then raise exception '답글을 달 댓글을 찾을 수 없습니다'; end if;
    if v_parent.parent_comment_id is not null then
      raise exception '대댓글에는 다시 답글을 달 수 없습니다';
    end if;
  end if;

  insert into public.dept_notice_comments (notice_id, author_id, body, parent_comment_id)
  values (p_notice_id, auth.uid(), trim(p_body), p_parent_comment_id)
  returning id into v_comment_id;

  if jsonb_typeof(p_attachments) = 'array' then
    for v_att in select * from jsonb_array_elements(p_attachments) loop
      insert into public.dept_notice_attachments
        (comment_id, file_path, file_name, mime_type, size_bytes, position, uploaded_by)
      values (
        v_comment_id, v_att->>'file_path', coalesce(v_att->>'file_name', 'file'),
        v_att->>'mime_type', nullif(v_att->>'size_bytes','')::bigint, v_idx, auth.uid()
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  update public.dept_notices set updated_at = now() where id = p_notice_id;
  select name into v_author_name from public.profiles where id = auth.uid();

  if v_notice.author_id <> auth.uid() then
    insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
    values (
      v_notice.author_id, 'dept_notice_reply',
      case when p_parent_comment_id is null then '💬 공지에 새 답글' else '💬 공지에 새 대댓글' end,
      coalesce(v_author_name, '멤버') || ': ' || left(p_body, 60),
      '/departments/d/' || v_notice.department_id || '/notices/board/' || p_notice_id,
      auth.uid(), jsonb_build_object('notice_id', p_notice_id, 'comment_id', v_comment_id, 'parent_comment_id', p_parent_comment_id)
    );
  end if;

  if p_parent_comment_id is not null
     and v_parent.author_id <> auth.uid()
     and v_parent.author_id is distinct from v_notice.author_id then
    insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
    values (
      v_parent.author_id, 'dept_notice_reply', '💬 내 댓글에 새 대댓글',
      coalesce(v_author_name, '멤버') || ': ' || left(p_body, 60),
      '/departments/d/' || v_notice.department_id || '/notices/board/' || p_notice_id,
      auth.uid(), jsonb_build_object('notice_id', p_notice_id, 'comment_id', v_comment_id, 'parent_comment_id', p_parent_comment_id)
    );
  end if;
  return v_comment_id;
end;
$$;
grant execute on function public.add_dept_notice_comment(uuid, text, jsonb, uuid) to authenticated;

drop function if exists public.delete_dept_notice_comment(uuid, text);
create function public.delete_dept_notice_comment(p_comment_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_comment public.dept_notice_comments;
  v_notice public.dept_notices;
  v_grade smallint;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into v_comment from public.dept_notice_comments where id = p_comment_id and deleted_at is null;
  if not found then raise exception '댓글을 찾을 수 없습니다'; end if;
  select * into v_notice from public.dept_notices where id = v_comment.notice_id and deleted_at is null;
  if not found then raise exception '공지를 찾을 수 없습니다'; end if;
  v_grade := public.get_user_grade(v_notice.department_id);
  if v_comment.author_id <> auth.uid() and v_grade > 2 then
    raise exception '댓글 삭제 권한이 없습니다';
  end if;

  update public.dept_notice_comments
  set deleted_at = now(), deleted_by = auth.uid(),
      deletion_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_comment_id;

  update public.dept_notice_comments
  set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = '상위 댓글 삭제'
  where parent_comment_id = p_comment_id and deleted_at is null;

  update public.dept_notices set updated_at = now() where id = v_comment.notice_id;
end;
$$;
grant execute on function public.delete_dept_notice_comment(uuid, text) to authenticated;

-- Keep the current feedback detail response and expose hierarchy/delete permission.
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
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into v_post from public.feedback_posts where id = p_post_id;
  if not found then return null; end if;
  v_role := public.get_user_role();
  v_is_admin := v_role in ('admin','office','pastor');
  v_can_read := (v_post.author_id = auth.uid()) or v_is_admin or (not v_post.is_private);
  if not v_can_read then raise exception '비공개 글입니다'; end if;

  select jsonb_build_object(
    'id', v_post.id, 'seq', v_post.seq, 'title', v_post.title, 'body', v_post.body,
    'status', v_post.status, 'is_private', v_post.is_private,
    'is_mine', (v_post.author_id = auth.uid()), 'is_admin', v_is_admin,
    'created_at', v_post.created_at, 'updated_at', v_post.updated_at,
    'author', (select jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role)
               from public.profiles pr where pr.id = v_post.author_id),
    'guest', jsonb_build_object('name', v_post.guest_name, 'phone', v_post.guest_phone, 'source', v_post.source),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
        'mime_type', a.mime_type, 'size_bytes', a.size_bytes
      ) order by a.position)
      from public.feedback_attachments a where a.post_id = v_post.id
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'parent_comment_id', c.parent_comment_id, 'body', c.body,
        'is_admin_reply', c.is_admin_reply, 'is_mine', c.author_id = auth.uid(),
        'can_delete', (c.author_id = auth.uid() or v_is_admin), 'created_at', c.created_at,
        'author', jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role),
        'attachments', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
          'mime_type', a.mime_type, 'size_bytes', a.size_bytes
        ) order by a.position) from public.feedback_attachments a where a.comment_id = c.id), '[]'::jsonb)
      ) order by c.created_at)
      from public.feedback_comments c left join public.profiles pr on pr.id = c.author_id
      where c.post_id = v_post.id and c.deleted_at is null
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function public.get_feedback_post(uuid) to authenticated;

-- Preserve notice_no added by the latest notice migration.
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
    'id', v_notice.id, 'notice_no', v_notice.notice_no, 'department_id', v_notice.department_id,
    'title', v_notice.title, 'body', v_notice.body, 'is_pinned', v_notice.is_pinned,
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

-- Exclude deleted feedback comments from list counts without changing paging/visibility.
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
  where (p_status is null or p.status::text = p_status)
    and (p_scope <> 'mine' or p.author_id = auth.uid());

  with page as (
    select p.id, p.seq, p.title, p.status, p.is_private, p.author_id, p.source,
      p.guest_name, p.created_at, p.updated_at, pr.name author_name, pr.sub_role author_sub_role
    from public.feedback_posts p left join public.profiles pr on pr.id = p.author_id
    where (p_status is null or p.status::text = p_status)
      and (p_scope <> 'mine' or p.author_id = auth.uid())
    order by p.created_at desc limit p_limit offset p_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'seq', page.seq, 'title', page.title, 'status', page.status,
    'is_private', page.is_private,
    'is_locked', (page.is_private and coalesce(page.author_id <> auth.uid(), true) and not v_is_admin),
    'is_mine', (page.author_id = auth.uid()),
    'author_name', coalesce(page.author_name, page.guest_name,
      case when page.source = 'signup_support' then '회원가입 문의' else null end),
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
