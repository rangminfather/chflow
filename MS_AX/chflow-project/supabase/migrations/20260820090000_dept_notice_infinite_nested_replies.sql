-- =============================================================
-- 교육부서 공지게시판: 대댓글에도 계속 답글 허용 (깊이 제한 제거)
--   - add_dept_notice_comment: "대댓글에는 다시 답글을 달 수 없습니다" 제한 삭제
--   - delete_dept_notice_comment: 1단계 cascade → 하위 트리 전체 재귀 soft-delete
--   불편신고 게시판(add_feedback_comment)은 20260711160000에서 이미 제한 해제됨
-- =============================================================

create or replace function public.add_dept_notice_comment(
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
    -- 깊이 제한 없음: 대댓글에도 계속 답글 가능
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

create or replace function public.delete_dept_notice_comment(p_comment_id uuid, p_reason text default null)
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

  -- 하위 답글 트리 전체 soft-delete (무한 중첩 대응)
  with recursive sub as (
    select id from public.dept_notice_comments where id = p_comment_id
    union all
    select c.id
    from public.dept_notice_comments c
    join sub on c.parent_comment_id = sub.id
  )
  update public.dept_notice_comments dc
  set deleted_at = now(), deleted_by = auth.uid(),
      deletion_reason = case when dc.id = p_comment_id
                             then nullif(trim(coalesce(p_reason, '')), '')
                             else '상위 댓글 삭제' end
  where dc.id in (select id from sub) and dc.deleted_at is null;

  update public.dept_notices set updated_at = now() where id = v_comment.notice_id;
end;
$$;
grant execute on function public.delete_dept_notice_comment(uuid, text) to authenticated;
