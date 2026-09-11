-- =============================================================
-- 저작권 등록대장 — 수정·삭제 2차 확인(관리자 비밀번호) + 변경 이력
--
--   copyright_admin_pin  : 수정/삭제 실행 시 추가로 입력받는 관리자 비밀번호(PIN)
--                          — 로그인 비밀번호와 별개. 초기값 '0000'.
--                          단일 행만 존재(id = true 고정)하도록 강제.
--   copyright_audit_log  : 등록/수정/삭제 이력 — 행위자·이전/이후 값 스냅샷.
--                          항목이 삭제돼도 로그 행은 남는다(FK 없음, 의도적).
--
--   PIN 검증은 upsert/delete RPC 내부에서 수행한다 — 수정(update 경로)과
--   삭제는 p_admin_pin 이 맞아야만 실행되고, 등록(insert 경로)은 요구하지 않는다.
-- =============================================================

create table if not exists public.copyright_admin_pin (
  id         boolean primary key default true,
  pin_hash   text not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint copyright_admin_pin_singleton check (id)
);

alter table public.copyright_admin_pin enable row level security;
-- 직접 테이블 접근 없음 — _copyright_verify_pin() 내부에서만 조회

insert into public.copyright_admin_pin (id, pin_hash)
select true, extensions.crypt('0000', extensions.gen_salt('bf'))
where not exists (select 1 from public.copyright_admin_pin);

create table if not exists public.copyright_audit_log (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid,        -- 삭제된 항목도 추적할 수 있도록 FK 미설정
  asset_name text not null,
  action     text not null check (action in ('create', 'update', 'delete')),
  actor_id   uuid,
  actor_email text,
  before     jsonb,       -- 등록 시 null
  after      jsonb,       -- 삭제 시 null
  created_at timestamptz not null default now()
);

alter table public.copyright_audit_log enable row level security;
-- 직접 테이블 접근 없음 — get_copyright_audit_log() 로만 read, 쓰기는 upsert/delete RPC 내부에서만

-- ───────────────────────── PIN 검증 (내부용) ─────────────────────────
create or replace function public._copyright_verify_pin(p_pin text)
returns boolean
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if p_pin is null or length(trim(p_pin)) = 0 then
    return false;
  end if;
  select pin_hash into v_hash from public.copyright_admin_pin where id = true;
  if v_hash is null then
    return false;
  end if;
  return extensions.crypt(p_pin, v_hash) = v_hash;
end;
$$;

-- ───────────────────────── 이력 조회 ─────────────────────────
create or replace function public.get_copyright_audit_log(p_item_id uuid default null)
returns setof public.copyright_audit_log
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._copyright_require_admin();
  return query
    select * from public.copyright_audit_log
    where p_item_id is null or item_id = p_item_id
    order by created_at desc
    limit 300;
end;
$$;
grant execute on function public.get_copyright_audit_log(uuid) to authenticated;

-- ───────────────────────── 등록·수정 (PIN + 이력 반영) ─────────────────────────
-- 기존 시그니처(파라미터 13개, PIN 없음)를 먼저 제거한다 — 그대로 두면 create or replace가
-- 새 시그니처(14개)를 "추가"만 하고 옛 함수가 그대로 남아, PIN 없이 수정할 수 있는
-- 우회 경로가 생긴다.
drop function if exists public.upsert_copyright_item(
  uuid, text, text, text, text, text, text, date, text, text, text, text, int
);

create or replace function public.upsert_copyright_item(
  p_id                  uuid,
  p_category            text,
  p_asset_name          text,
  p_rights_holder       text,
  p_status              text,
  p_scope               text,
  p_approval_method     text,
  p_approval_date       date,
  p_required_notice     text,
  p_notes               text,
  p_evidence_image_path text,
  p_evidence_caption    text,
  p_sort_order          int default 0,
  p_admin_pin           text default null
)
returns public.copyright_items
language plpgsql security definer set search_path = public
as $$
declare
  v_row   public.copyright_items;
  v_old   public.copyright_items;
  v_email text;
begin
  perform public._copyright_require_admin();

  if p_category is null or length(trim(p_category)) = 0 then
    raise exception '분류를 입력해 주세요';
  end if;
  if p_asset_name is null or length(trim(p_asset_name)) = 0 then
    raise exception '대상 자료명을 입력해 주세요';
  end if;
  if p_rights_holder is null or length(trim(p_rights_holder)) = 0 then
    raise exception '저작권자·공급자를 입력해 주세요';
  end if;
  if p_status not in ('approved', 'licensed', 'pending', 'unconfirmed') then
    raise exception '알 수 없는 상태입니다';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  if p_id is null then
    insert into public.copyright_items (
      category, asset_name, rights_holder, status, scope, approval_method,
      approval_date, required_notice, notes, evidence_image_path, evidence_caption,
      sort_order, created_by
    ) values (
      trim(p_category), trim(p_asset_name), trim(p_rights_holder), p_status,
      nullif(trim(coalesce(p_scope, '')), ''),
      nullif(trim(coalesce(p_approval_method, '')), ''),
      p_approval_date,
      nullif(trim(coalesce(p_required_notice, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      nullif(trim(coalesce(p_evidence_image_path, '')), ''),
      nullif(trim(coalesce(p_evidence_caption, '')), ''),
      coalesce(p_sort_order, 0), auth.uid()
    )
    returning * into v_row;

    insert into public.copyright_audit_log (item_id, asset_name, action, actor_id, actor_email, before, after)
    values (v_row.id, v_row.asset_name, 'create', auth.uid(), v_email, null, to_jsonb(v_row));
  else
    -- 수정은 관리자 비밀번호(PIN) 확인 없이는 실행되지 않는다
    if not public._copyright_verify_pin(p_admin_pin) then
      raise exception '관리자 비밀번호가 올바르지 않습니다';
    end if;

    select * into v_old from public.copyright_items where id = p_id;
    if not found then
      raise exception '수정할 항목을 찾을 수 없습니다';
    end if;

    update public.copyright_items set
      category = trim(p_category),
      asset_name = trim(p_asset_name),
      rights_holder = trim(p_rights_holder),
      status = p_status,
      scope = nullif(trim(coalesce(p_scope, '')), ''),
      approval_method = nullif(trim(coalesce(p_approval_method, '')), ''),
      approval_date = p_approval_date,
      required_notice = nullif(trim(coalesce(p_required_notice, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      evidence_image_path = nullif(trim(coalesce(p_evidence_image_path, '')), ''),
      evidence_caption = nullif(trim(coalesce(p_evidence_caption, '')), ''),
      sort_order = coalesce(p_sort_order, 0),
      updated_at = now()
    where id = p_id
    returning * into v_row;

    insert into public.copyright_audit_log (item_id, asset_name, action, actor_id, actor_email, before, after)
    values (v_row.id, v_row.asset_name, 'update', auth.uid(), v_email, to_jsonb(v_old), to_jsonb(v_row));
  end if;

  return v_row;
end;
$$;
grant execute on function public.upsert_copyright_item(
  uuid, text, text, text, text, text, text, date, text, text, text, text, int, text
) to authenticated;

-- ───────────────────────── 삭제 (PIN + 이력 반영) ─────────────────────────
-- 마찬가지로 옛 시그니처(파라미터 1개, PIN 없음)를 먼저 제거 — PIN 없이 삭제되는
-- 우회 경로 차단.
drop function if exists public.delete_copyright_item(uuid);

create or replace function public.delete_copyright_item(p_id uuid, p_admin_pin text)
returns public.copyright_items
language plpgsql security definer set search_path = public
as $$
declare
  v_row   public.copyright_items;
  v_email text;
begin
  perform public._copyright_require_admin();

  if not public._copyright_verify_pin(p_admin_pin) then
    raise exception '관리자 비밀번호가 올바르지 않습니다';
  end if;

  delete from public.copyright_items where id = p_id
  returning * into v_row;

  if not found then
    raise exception '삭제할 항목을 찾을 수 없습니다';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.copyright_audit_log (item_id, asset_name, action, actor_id, actor_email, before, after)
  values (v_row.id, v_row.asset_name, 'delete', auth.uid(), v_email, to_jsonb(v_row), null);

  return v_row;
end;
$$;
grant execute on function public.delete_copyright_item(uuid, text) to authenticated;
