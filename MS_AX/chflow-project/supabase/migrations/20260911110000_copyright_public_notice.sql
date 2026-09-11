-- =============================================================
-- 저작권 등록대장 — 성도 공개용 안내 페이지 연결
--
--   copyright_items.slug   : 코드에서 특정 항목을 안정적으로 가리키기 위한 값
--                             (예: 'nkrv-bskorea' = 개역개정 승인 건). uuid는 재생성될 수
--                             있어 코드에 하드코딩하기 부적절하므로 별도 slug를 둔다.
--   bible_versions.copyright_slug : 이 역본이 어느 copyright_items 건에 대응하는지.
--                             null이면(=KRV처럼 저작권 걱정 없는 역본) 화면에 안내를 붙이지 않는다.
--   get_public_copyright_notices : 로그인한 성도 누구나 호출 가능(관리자 제한 없음) —
--                             승인(approved)·라이선스 구매(licensed) 상태 건만 노출한다.
--                             검토중·미확인 상태는 아직 정리 중인 내부 사안이라 공개하지 않는다.
--
--   이 마이그레이션 이후 새 저작권 항목을 등록할 때 slug를 채우고, 그 항목이 특정 성경
--   역본에 해당하면 bible_versions.copyright_slug도 같이 채우면, 코드 수정 없이
--   해당 역본이 쓰이는 모든 화면에 안내·링크가 자동으로 붙는다.
-- =============================================================

alter table public.copyright_items add column if not exists slug text;
create unique index if not exists copyright_items_slug_key on public.copyright_items (slug) where slug is not null;

update public.copyright_items
set slug = 'nkrv-bskorea'
where asset_name = '개역개정 (NKRV, New Korean Revised Version)' and slug is null;

alter table public.bible_versions add column if not exists copyright_slug text;

update public.bible_versions
set copyright_slug = 'nkrv-bskorea'
where code = 'NKRV';

-- ───────────────────────── list_bible_versions() 에 copyright_slug 추가 ─────────────────────────
-- returns table 의 컬럼 구성을 바꾸므로 create or replace 로는 안 되고 drop 후 재생성해야 한다.
drop function if exists public.list_bible_versions();

create or replace function public.list_bible_versions()
returns table (
  code text,
  name_ko text,
  name_en text,
  language_code text,
  copyright_note text,
  is_public_domain boolean,
  copyright_slug text
)
language sql stable security definer set search_path = public
as $$
  select v.code, v.name_ko, v.name_en, v.language_code, v.copyright_note, v.is_public_domain, v.copyright_slug
  from public.bible_versions v
  where v.is_active = true
  order by v.code;
$$;
grant execute on function public.list_bible_versions() to authenticated;

-- ───────────────────────── 성도 공개용 조회 (관리자 제한 없음) ─────────────────────────
create or replace function public.get_public_copyright_notices(p_slug text default null)
returns table (
  id                  uuid,
  slug                text,
  category            text,
  asset_name          text,
  rights_holder       text,
  status              text,
  scope               text,
  approval_method     text,
  approval_date       date,
  required_notice     text,
  evidence_image_path text,
  evidence_caption    text,
  sort_order          int
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  return query
    select c.id, c.slug, c.category, c.asset_name, c.rights_holder, c.status, c.scope,
           c.approval_method, c.approval_date, c.required_notice, c.evidence_image_path,
           c.evidence_caption, c.sort_order
    from public.copyright_items c
    where c.status in ('approved', 'licensed')
      and (p_slug is null or c.slug = p_slug)
    order by c.sort_order asc, c.created_at desc;
end;
$$;
grant execute on function public.get_public_copyright_notices(text) to authenticated;

-- ───────────────────────── upsert_copyright_item 에 slug 추가 ─────────────────────────
-- 기존 14개 파라미터 시그니처를 명시적으로 drop — 남겨두면 slug 없는 옛 버전이 계속 호출 가능해진다.
drop function if exists public.upsert_copyright_item(
  uuid, text, text, text, text, text, text, date, text, text, text, text, int, text
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
  p_admin_pin           text default null,
  p_slug                text default null
)
returns public.copyright_items
language plpgsql security definer set search_path = public
as $$
declare
  v_row   public.copyright_items;
  v_old   public.copyright_items;
  v_email text;
  v_slug  text;
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

  v_slug := nullif(trim(coalesce(p_slug, '')), '');
  select email into v_email from auth.users where id = auth.uid();

  if p_id is null then
    insert into public.copyright_items (
      category, asset_name, rights_holder, status, scope, approval_method,
      approval_date, required_notice, notes, evidence_image_path, evidence_caption,
      sort_order, created_by, slug
    ) values (
      trim(p_category), trim(p_asset_name), trim(p_rights_holder), p_status,
      nullif(trim(coalesce(p_scope, '')), ''),
      nullif(trim(coalesce(p_approval_method, '')), ''),
      p_approval_date,
      nullif(trim(coalesce(p_required_notice, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      nullif(trim(coalesce(p_evidence_image_path, '')), ''),
      nullif(trim(coalesce(p_evidence_caption, '')), ''),
      coalesce(p_sort_order, 0), auth.uid(), v_slug
    )
    returning * into v_row;

    insert into public.copyright_audit_log (item_id, asset_name, action, actor_id, actor_email, before, after)
    values (v_row.id, v_row.asset_name, 'create', auth.uid(), v_email, null, to_jsonb(v_row));
  else
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
      slug = v_slug,
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
  uuid, text, text, text, text, text, text, date, text, text, text, text, int, text, text
) to authenticated;
