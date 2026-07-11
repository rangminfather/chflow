-- =============================================================
-- 불편신고/건의 게시판: 대댓글에도 계속 답글 허용 (깊이 제한 제거)
--   - add_feedback_comment: "대댓글에는 다시 답글 불가" 제한 삭제
--   - delete_feedback_comment: 1단계 cascade → 하위 트리 전체 재귀 soft-delete
--   부서 공지 댓글(add_dept_notice_comment)은 종전 1단계 유지 (요청 범위 아님)
-- =============================================================

create or replace function public.add_feedback_comment(
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
    -- 깊이 제한 없음: 대댓글에도 계속 답글 가능
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

create or replace function public.delete_feedback_comment(p_comment_id uuid, p_reason text default null)
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

  -- 하위 답글 트리 전체 soft-delete (무한 중첩 대응)
  with recursive sub as (
    select id from public.feedback_comments where id = p_comment_id
    union all
    select c.id
    from public.feedback_comments c
    join sub on c.parent_comment_id = sub.id
  )
  update public.feedback_comments fc
  set deleted_at = now(), deleted_by = auth.uid(),
      deletion_reason = case when fc.id = p_comment_id
                             then nullif(trim(coalesce(p_reason, '')), '')
                             else '상위 댓글 삭제' end
  where fc.id in (select id from sub) and fc.deleted_at is null;

  update public.feedback_posts set updated_at = now() where id = v_comment.post_id;
end;
$$;
grant execute on function public.delete_feedback_comment(uuid, text) to authenticated;
