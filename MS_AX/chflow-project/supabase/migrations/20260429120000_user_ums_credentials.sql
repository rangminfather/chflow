-- 사용자별 UMS(명성교회 사무실 게시판) 자격증명 저장
--
-- 부서별이 아닌 사용자별. 이유:
-- - 부서원 누가 올릴지 모름 → 각자 본인 UMS 계정 사용
-- - UMS 글 작성자가 실제 사람 이름으로 표시됨 (책임 추적 명확)
-- - 30분 쿨다운도 본인 계정 단위로 적용
-- - 비번 공유 0
--
-- 비번은 AES-256-GCM 으로 암호화해서 저장 (서버 측 BULLETIN_CREDS_ENCRYPTION_KEY 로 복호화)

create table if not exists user_ums_credentials (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  ums_user_id            text not null,
  ums_password_encrypted text not null,             -- format: iv_base64:ciphertext_base64:authtag_base64
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ────────────────────────────────────────
-- RPC: 본인 자격증명 메타정보 조회 (등록 여부 + UMS 아이디만, 비번은 노출 X)
-- ────────────────────────────────────────
create or replace function user_ums_credentials_meta()
returns table (
  has_credentials boolean,
  ums_user_id     text,
  updated_at      timestamptz
)
language sql security definer set search_path = public as $$
  select
    exists(select 1 from user_ums_credentials where user_id = auth.uid()) as has_credentials,
    (select ums_user_id from user_ums_credentials where user_id = auth.uid()),
    (select updated_at from user_ums_credentials where user_id = auth.uid());
$$;

grant execute on function user_ums_credentials_meta() to authenticated;

-- ────────────────────────────────────────
-- RLS — 직접 SELECT 차단. RPC 와 service_role 만 접근.
-- ────────────────────────────────────────
alter table user_ums_credentials enable row level security;
-- 정책 안 만들면 default deny — service_role 만 접근 가능
