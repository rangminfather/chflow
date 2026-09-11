-- =============================================================
-- 저작권·라이선스 대응 현황 등록대장
--   copyright_items : 외부 저작물(성경 번역본·폰트·이미지 등) 사용 승인 현황
--
--   등록 방식: 관리자가 한 건씩 등록 → 기본 상태 pending(검토중) →
--             관리자가 개별 확인 후 approved/licensed 등으로 전환.
--             여러 건을 한꺼번에 반영하지 않고 건별로 검토한다.
--
--   읽기/쓰기 모두: profiles.role = 'admin' 만 (성도 화면 노출 없음)
--   증빙 이미지 원본은 R2(copyright-evidence 버킷)에 저장하고,
--   이 테이블에는 R2 키(evidence_image_path)만 보관한다.
-- =============================================================

create table if not exists public.copyright_items (
  id                  uuid primary key default gen_random_uuid(),
  category            text not null,
  asset_name          text not null,
  rights_holder       text not null,
  status              text not null default 'pending'
                        check (status in ('approved', 'licensed', 'pending', 'unconfirmed')),
  scope               text,
  approval_method     text,
  approval_date       date,
  required_notice     text,
  notes               text,
  evidence_image_path text,  -- R2 키, 또는 레거시 public 경로("/"로 시작)
  evidence_caption    text,
  sort_order          int not null default 0,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.copyright_items enable row level security;
-- 직접 테이블 접근 없음 — 아래 security definer RPC 로만 read/write

create or replace function public._copyright_require_admin()
returns void
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception '저작권 관리 권한이 없습니다 (관리자만 가능)';
  end if;
end;
$$;

-- ───────────────────────── 읽기 ─────────────────────────
create or replace function public.get_copyright_items()
returns setof public.copyright_items
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._copyright_require_admin();
  return query
    select * from public.copyright_items
    order by sort_order asc, created_at desc;
end;
$$;
grant execute on function public.get_copyright_items() to authenticated;

-- ───────────────────────── 등록·수정 ─────────────────────────
-- p_id 가 null 이면 새 항목 등록, 있으면 해당 항목 수정
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
  p_sort_order          int default 0
)
returns public.copyright_items
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.copyright_items;
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
  else
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

    if not found then
      raise exception '수정할 항목을 찾을 수 없습니다';
    end if;
  end if;

  return v_row;
end;
$$;
grant execute on function public.upsert_copyright_item(
  uuid, text, text, text, text, text, text, date, text, text, text, text, int
) to authenticated;

-- ───────────────────────── 삭제 ─────────────────────────
create or replace function public.delete_copyright_item(p_id uuid)
returns public.copyright_items
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.copyright_items;
begin
  perform public._copyright_require_admin();

  delete from public.copyright_items where id = p_id
  returning * into v_row;

  if not found then
    raise exception '삭제할 항목을 찾을 수 없습니다';
  end if;

  return v_row;
end;
$$;
grant execute on function public.delete_copyright_item(uuid) to authenticated;

-- ───────────────────────── 기존 배열 항목 이관 ─────────────────────────
-- 기존 코드( app/admin/copyright/page.tsx )에 하드코딩되어 있던 NKRV 승인 건을 그대로 이관.
-- 증빙 이미지는 이미 public/copyright/ 에 커밋되어 있으므로 R2로 옮기지 않고 경로만 저장한다.
insert into public.copyright_items (
  category, asset_name, rights_holder, status, scope, approval_method,
  approval_date, required_notice, evidence_image_path, evidence_caption, notes, sort_order
)
select
  '성경 본문',
  '개역개정 (NKRV, New Korean Revised Version)',
  '(재)대한성서공회',
  'approved',
  '울산동구 명성교회 성도용 앱에 한해 무료 사용 허가 (불특정 다수 대상 배포·상업적 목적 아님을 전제)',
  '이메일 승인 — (재)대한성서공회 저작권부(kbscopyright@bskorea.or.kr)',
  '2026-09-09',
  '본문 표기를 정확히 하고, 성경전서 개역개정의 저작권이 (재)대한성서공회에 있음을 저작권 표시로 명시할 것',
  '/copyright/nkrv-bskorea-approval-redacted.png',
  '대한성서공회 저작권부 승인 이메일 (2026-09-09 · 수신자 개인 이메일 주소는 가림 처리)',
  '승인 범위가 ''교회 성도 특정 앱''으로 한정되어 있으므로, 추후 앱 공개 범위·배포 방식이 바뀌면 재확인이 필요하다.',
  0
where not exists (
  select 1 from public.copyright_items where asset_name = '개역개정 (NKRV, New Korean Revised Version)'
);
