-- =============================================================
-- 주보 자동 수집(sync) 관측 로그 + 실패 시 관리자 알림
--   - bulletin_sync_log: 매 sync 시도의 성공/건너뜀/실패를 기록
--   - log_bulletin_sync RPC: 로그 적재 + 실패 시 admin/office 알림(12시간 쓰로틀)
--   - service_role(서버 API)에서 호출
-- =============================================================

create table if not exists public.bulletin_sync_log (
  id uuid primary key default gen_random_uuid(),
  source text not null,                 -- 'jubo' | 'dept:초등1부' 등
  status text not null,                 -- 'success' | 'skipped' | 'error'
  detail text,                          -- 실패 사유 또는 저장 경로/사유
  item_no integer,
  issue_date date,
  created_at timestamptz not null default now()
);

create index if not exists bulletin_sync_log_source_created_idx
  on public.bulletin_sync_log (source, created_at desc);

alter table public.bulletin_sync_log enable row level security;

drop policy if exists "bulletin_sync_log_read_admin" on public.bulletin_sync_log;
create policy "bulletin_sync_log_read_admin"
  on public.bulletin_sync_log for select
  to authenticated
  using (public.get_user_role() in ('admin', 'office'));

-- 로그 적재 + 실패 알림. SECURITY DEFINER 로 notifications insert 정책 우회.
create or replace function public.log_bulletin_sync(
  p_source text,
  p_status text,
  p_detail text default null,
  p_item_no integer default null,
  p_issue_date date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bulletin_sync_log (source, status, detail, item_no, issue_date)
  values (p_source, p_status, p_detail, p_item_no, p_issue_date);

  -- 실패 시에만, 같은 source 로 최근 12시간 내 발송한 알림이 없을 때만 관리자 통지
  if p_status = 'error' then
    if not exists (
      select 1 from public.notifications
      where type = 'bulletin_sync_error'
        and metadata->>'source' = p_source
        and created_at > now() - interval '12 hours'
    ) then
      insert into public.notifications (user_id, type, title, body, link_url, metadata)
      select
        p.id,
        'bulletin_sync_error',
        '⚠️ 주보 자동 수집 실패',
        p_source || ' 주보 자동 다운로드가 실패했습니다: ' || left(coalesce(p_detail, '원인 미상'), 200),
        '/admin',
        jsonb_build_object('source', p_source, 'detail', p_detail)
      from public.profiles p
      where p.role in ('admin', 'office')
        and p.status = 'active';
    end if;
  end if;
end;
$$;

grant execute on function public.log_bulletin_sync(text, text, text, integer, date) to service_role;
