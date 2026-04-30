-- ────────────────────────────────────────────────────────────
-- yearly 표어 시스템 확장: 1페이지 표어 (긴 본문 구절) 추가
-- 기존: theme (짧은 슬로건), scripture_ref (출처)
-- 신규: page_one_verse (1페이지 사진 밑 긴 본문 표어)
-- 1년에 1번 등록 → 매주 자동 채움
-- ────────────────────────────────────────────────────────────

alter table dept_yearly_themes
  add column if not exists page_one_verse text;

-- 기존 RPC drop (return type 변경 위해 필요)
drop function if exists bulletin_get_yearly_theme(uuid, int);
drop function if exists bulletin_set_yearly_theme(uuid, int, text, text);

-- ────────────────────────────────────────────────────────────
-- RPC: 연도 표어 조회 (page_one_verse 포함)
-- ────────────────────────────────────────────────────────────
create or replace function bulletin_get_yearly_theme(
  p_dept_id uuid,
  p_year    int
)
returns table (
  theme           text,
  scripture_ref   text,
  page_one_verse  text,
  updated_at      timestamptz,
  updated_by      uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_edu_member_or_admin(p_dept_id) then
    raise exception 'permission denied (not a member of this department)';
  end if;
  return query
    select t.theme, t.scripture_ref, t.page_one_verse, t.updated_at, t.updated_by
    from dept_yearly_themes t
    where t.department_id = p_dept_id and t.year = p_year;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- RPC: 연도 표어 저장 — page_one_verse 추가
-- ────────────────────────────────────────────────────────────
create or replace function bulletin_set_yearly_theme(
  p_dept_id        uuid,
  p_year           int,
  p_theme          text,
  p_scripture_ref  text default null,
  p_page_one_verse text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
begin
  if not is_edu_member_or_admin(p_dept_id) then
    raise exception 'permission denied';
  end if;

  insert into dept_yearly_themes (department_id, year, theme, scripture_ref, page_one_verse, updated_by, updated_at)
  values (p_dept_id, p_year, p_theme, p_scripture_ref, p_page_one_verse, auth.uid(), now())
  on conflict (department_id, year) do update
    set theme           = excluded.theme,
        scripture_ref   = excluded.scripture_ref,
        page_one_verse  = excluded.page_one_verse,
        updated_by      = excluded.updated_by,
        updated_at      = excluded.updated_at
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function bulletin_get_yearly_theme(uuid, int)                              to authenticated;
grant execute on function bulletin_set_yearly_theme(uuid, int, text, text, text)            to authenticated;
