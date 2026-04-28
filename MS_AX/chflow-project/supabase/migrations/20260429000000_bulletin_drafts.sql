-- 주보 작성 협업용 — 연도 표어 + 임시저장 draft
--
-- 목적:
--   - 연도 표어(주제제창)는 1년에 한 번 등록해서 매주 자동 호출
--   - 주보 폼 작성은 부서원 여러 명이 분담 (서기/총무 등)
--     → 부서 + 발행일자 키로 DB 에 저장 → 다른 사람이 들어와도 이어서 작성

create table if not exists dept_yearly_themes (
  id              bigserial primary key,
  department_id   uuid not null references departments(id) on delete cascade,
  year            int  not null,
  theme           text not null,           -- 표어 (예: "하나님의 안경으로 세상을 바라보는 어린이")
  scripture_ref   text,                    -- 표어 근거 구절 (예: "히 11:3")
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  unique (department_id, year)
);

create table if not exists bulletin_drafts (
  id              bigserial primary key,
  department_id   uuid not null references departments(id) on delete cascade,
  issue_date      date not null,           -- 주보 발행 주일
  issue_number    text,                    -- "제26-18호" 등 (자동계산값을 그대로 저장하거나 사용자가 수정)
  form_data       jsonb not null default '{}',
  last_edited_by  uuid references auth.users(id) on delete set null,
  last_edited_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (department_id, issue_date)
);

create index if not exists bulletin_drafts_dept_date_idx
  on bulletin_drafts (department_id, issue_date desc);

-- ────────────────────────────────────────────────────────────
-- RPC: 연도 표어 조회
-- ────────────────────────────────────────────────────────────
create or replace function bulletin_get_yearly_theme(
  p_dept_id uuid,
  p_year    int
)
returns table (
  theme         text,
  scripture_ref text,
  updated_at    timestamptz,
  updated_by    uuid
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
    select t.theme, t.scripture_ref, t.updated_at, t.updated_by
    from dept_yearly_themes t
    where t.department_id = p_dept_id and t.year = p_year;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- RPC: 연도 표어 저장 (upsert)
-- ────────────────────────────────────────────────────────────
create or replace function bulletin_set_yearly_theme(
  p_dept_id       uuid,
  p_year          int,
  p_theme         text,
  p_scripture_ref text default null
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

  insert into dept_yearly_themes (department_id, year, theme, scripture_ref, updated_by, updated_at)
  values (p_dept_id, p_year, p_theme, p_scripture_ref, auth.uid(), now())
  on conflict (department_id, year) do update
    set theme         = excluded.theme,
        scripture_ref = excluded.scripture_ref,
        updated_by    = excluded.updated_by,
        updated_at    = excluded.updated_at
  returning id into new_id;

  return new_id;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- RPC: 주보 draft 조회 (없으면 빈 행)
-- ────────────────────────────────────────────────────────────
create or replace function bulletin_get_draft(
  p_dept_id    uuid,
  p_issue_date date
)
returns table (
  form_data       jsonb,
  issue_number    text,
  last_edited_by  uuid,
  last_edited_at  timestamptz,
  exists_         boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_edu_member_or_admin(p_dept_id) then
    raise exception 'permission denied';
  end if;

  return query
    select b.form_data, b.issue_number, b.last_edited_by, b.last_edited_at, true
    from bulletin_drafts b
    where b.department_id = p_dept_id and b.issue_date = p_issue_date
    union all
    select '{}'::jsonb, null::text, null::uuid, null::timestamptz, false
    where not exists (
      select 1 from bulletin_drafts
      where department_id = p_dept_id and issue_date = p_issue_date
    )
    limit 1;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- RPC: 주보 draft 저장 (upsert)
-- ────────────────────────────────────────────────────────────
create or replace function bulletin_save_draft(
  p_dept_id      uuid,
  p_issue_date   date,
  p_form_data    jsonb,
  p_issue_number text default null
)
returns table (
  last_edited_at timestamptz,
  last_edited_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_uid uuid := auth.uid();
begin
  if not is_edu_member_or_admin(p_dept_id) then
    raise exception 'permission denied';
  end if;

  insert into bulletin_drafts (department_id, issue_date, form_data, issue_number, last_edited_by, last_edited_at)
  values (p_dept_id, p_issue_date, p_form_data, p_issue_number, v_uid, v_now)
  on conflict (department_id, issue_date) do update
    set form_data      = excluded.form_data,
        issue_number   = excluded.issue_number,
        last_edited_by = excluded.last_edited_by,
        last_edited_at = excluded.last_edited_at;

  return query select v_now, v_uid;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 권한
-- ────────────────────────────────────────────────────────────
grant execute on function bulletin_get_yearly_theme(uuid, int)        to authenticated;
grant execute on function bulletin_set_yearly_theme(uuid, int, text, text) to authenticated;
grant execute on function bulletin_get_draft(uuid, date)              to authenticated;
grant execute on function bulletin_save_draft(uuid, date, jsonb, text) to authenticated;

-- 테이블 RLS — RPC 만 노출. 직접 SELECT 차단.
alter table dept_yearly_themes  enable row level security;
alter table bulletin_drafts     enable row level security;

-- service_role 외엔 직접 접근 불가 (RLS 정책 미작성 = deny by default)
