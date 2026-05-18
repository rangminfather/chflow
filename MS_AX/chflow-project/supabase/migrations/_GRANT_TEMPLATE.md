# 새 테이블 마이그레이션 작성 시 GRANT 필수

**배경**: Supabase 정책 변경 (2026-05-12 메일 공지)
- 기존 테이블: 영향 없음
- **2026-10-30 이후** 기존 프로젝트(이 프로젝트 포함)에서 만드는 **새 테이블**은
  명시적 `GRANT` 없으면 supabase-js / PostgREST 에서 안 보임 (42501)

## 새 테이블 추가 시 항상 같이 넣을 블록

```sql
-- 1) 테이블 생성
create table public.your_new_table (
  -- ...
);

-- 2) RLS + 정책
alter table public.your_new_table enable row level security;
create policy "..." on public.your_new_table for ... using (...);

-- 3) ✨ Data API 노출 GRANT (10/30 이후 필수)
grant select, insert, update, delete on public.your_new_table to authenticated;
grant select                          on public.your_new_table to anon;          -- 비로그인 노출 필요시만
grant all                             on public.your_new_table to service_role;
```

## 체크리스트
- [ ] RPC 함수는 기존대로 `grant execute on function ... to ...` 유지
- [ ] 기존 테이블에 소급 grant 추가 금지 (RLS와 꼬일 수 있음, 메일도 "기존 grant 유지" 명시)
- [ ] 10/30 직전(10/15~25) Security Advisor 한 번 확인
