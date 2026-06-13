# 보안성 검토 및 조치 현황 (2026-06)

chflow 플랫폼(Next.js + Supabase) 보안 검토 결과와 조치 상태를 한곳에 정리한다.
검토 범위: chflow-app 전체 + MS_AX Supabase 마이그레이션. 검증 방식: 병렬 코드 감사 + 핵심 항목 직접 확인.

> ⚠️ **가장 중요한 미완 작업**: 아래 ②③ DB 마이그레이션을 운영 Supabase에 적용해야
> CR-1(권한 상승)·CR-2·CR-3·H-2의 **실제 방어막이 켜진다**. 코드(라우트/헤더)는 배포됐지만,
> 마이그레이션 적용 전까지는 직접 PostgREST 호출을 통한 권한 상승이 여전히 가능하다.

---

## 1. 적용 런북 (운영 Supabase SQL Editor에서 실행)

`supabase db push`는 **사용 금지** — 다른 에이전트의 미완성 마이그레이션(talk 등)까지 적용된다.
반드시 SQL Editor에 아래 순서대로 붙여 실행한다.

1. **(전) 진단** — 아래 §4 진단 SQL 실행. 특히 결과 3번 `role=admin/office 계정`에 **모르는 계정이 있으면 이미 악용된 것**이므로 즉시 보고/조치.
2. **1차 적용** — `MS_AX/chflow-project/supabase/migrations/20260612110000_security_critical_fixes.sql`
3. **2차 적용** — `MS_AX/chflow-project/supabase/migrations/20260612120000_security_admin_read_authz.sql`
4. **(후) 진단** — §4 재실행. 트리거/RLS/역할검증이 들어갔는지 확인.
5. **회귀 확인** — 관리자 페이지(가입 승인, 회원관리, 투표, 부서 가입 승인)와 교사 일반 동작(myinfo 직분/비번 변경, 출석 입력)이 정상인지 확인. (특히 2차는 read RPC 7개를 재정의했음)

모든 마이그레이션은 재적용 안전(idempotent: OR REPLACE / IF EXISTS).

---

## 2. 조치 상태 요약

| ID | 심각도 | 내용 | 상태 |
|----|--------|------|------|
| **CR-1** | Critical | 가입자가 자기 role=admin/status=active로 자가 승격 (가입만 하면 관리자) | 코드 배포됨 / **DB 적용 대기**(트리거가 핵심) |
| **CR-2** | Critical | 백업·스테이징 테이블 RLS 누락 → 전 교인 PII 덤프 | **DB 적용 대기** |
| **CR-3** | Critical | `remove_member_relation` 권한검증 없음 (IDOR) | **DB 적용 대기** |
| **H-2** | High | 관리자용 read RPC 7개 역할검증 누락 | **DB 적용 대기** |
| **H-4** | High | 보안 헤더 전무 | ✅ **배포 완료**(운영 헤더 확인) |
| **H-1** | High | edu 출석·달란트·일지 RPC가 멤버십만 검사(등급·반 무관) → 위변조 | ⏳ 미착수(구조 변경) |
| **H-3** | High | anon 개인정보 열거(가입 매칭) | ⏳ 미착수 |
| **H-5** | High | xlsx 0.18.5 서버측 파싱(prototype pollution/ReDoS) | ⏳ 미착수 |
| **M-1~6** | Medium | 요람 PII 광범위, 에러원문 노출, 버킷 public, 재설정 enumeration 등 | ⏳ 미착수 |
| **L-1~5** | Low | 진단코드 토큰노출, rate-limit 부재, document.write 등 | ⏳ 미착수 |

### 적용 완료/배포된 코드 (참고)
- `/api/signup`: `systemRole`을 pastor/leader/member 화이트리스트로 검증 (admin/office 주입 차단)
- `/api/auth/username-login`: status != active면 토큰 미발급(403) + 로그인 페이지 안내 처리
- `next.config.ts`: HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy

### 적용 대기 마이그레이션이 닫는 것
- `20260612110000`: profiles INSERT/UPDATE 트리거(role/status 자가변경·admin 가입 차단), 백업/스테이징 RLS, `remove_member_relation` 역할검증, 미사용 `create_profile_on_signup` EXECUTE 회수
- `20260612120000`: `assert_staff()` 가드 + read RPC 7개(admin_list_pending_signups, admin_list_dept_members, admin_members_relations, households_by_pasture, admin_list_dept_pending, admin_get_votes, admin_get_vote_results) 역할검증

---

## 3. 남은 작업 로드맵 (권장 순서)

### H-1 — edu 권한 모델 구조 개선 (다음 우선)
출석 `edu_set_student_attendance`, 달란트 `edu_save_talent`/`toggle_weekly_extra`, 일지 `edu_upsert_journal`/`edu_delete_journal`, 학생/교사/새친구 CRUD가 `is_edu_member_or_admin`(승인 멤버면 통과)만 검사 → 같은 부서면 학부모(grade4)·타반 교사도 임의 학생 위변조 가능.
- 조치: ① 쓰기 RPC에 `get_user_grade <= 3` 등급 가드 ② 출석/달란트는 `student.teacher_id = 호출자` 반 검증(=`api/edu/my-class-student` 패턴 재사용) ③ `talent/page.tsx:199` 직접 insert를 `save_talent_rule` RPC로 교체 ④ `edu_talent_rules` RLS WITH CHECK를 `can_appoint_in_dept`로 상향.
- **주의**: AGENTS.md 보호대상(my-class-attendance, talent) 포함 → 정상교사/학부모/타반 3시나리오 **앱 실행 수동검증** 후 머지.

### pastor 권한 구조 결정 (정책 — 사용자 판단 필요)
'목사'는 가입으로 자가 선택 가능한데 동시에 권한 집합(`get_user_role() IN ('admin','office','pastor')`)에 포함 → 자가 가입한 목사가 승인되면 pastor 권한(전 교인 조회 등) 자동 획득.
| 옵션 | 내용 | 트레이드오프 |
|---|---|---|
| A. 분리(권장) | 직분(표시)·권한(authz) 컬럼 분리, 권한은 승인 시 관리자가 부여 | 가장 안전. 마이그레이션+승인 UI 작업(중간) |
| B. pastor 강등 | authz에서 'pastor' 제거, admin/office만 | 작음. 진짜 목사 권한 재배치 필요 |
| C. 승인 검증만 | 구조 유지, 목사 승인 시 관리자 직분 확인 | 코드 최소, 사람 검증 의존(자동방어 아님) |

### 이후
- **H-3**: anon 조회 함수(`search_member_candidates`, `find_member_for_signup` 등) anon GRANT 회수 → 서버 경유 + rate-limit. (가입 매칭 플로우 재설계)
- **H-5**: xlsx → exceljs 교체. 서버 2개 라우트(`review-problems`, `monthly-plans/bulletin-import`) 우선.
- **CSP**: 보안 헤더 중 CSP만 별도. 다음 우편번호 iframe·PDF 뷰어·Supabase 연결 화이트리스트 테스트 후 도입.
- **M/L**: 에러원문 노출 일반화(일반 사용자 경로 우선), member-photos/feedback-attachments 버킷 private+signed URL, `window.__chflowSupabase` 진단코드 제거, find-id/password rate-limit.

---

## 4. 진단 SQL (읽기 전용 — 적용 전후 실행)

```sql
-- 1) CR-1 트리거 적용 여부 (패치 후 1행)
SELECT 'CR-1 trigger' AS check, tgname FROM pg_trigger
WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal
  AND tgname='trg_guard_profile_privileged';

-- 2) profiles UPDATE 정책 현황
SELECT 'profiles policies' AS check, polname,
       pg_get_expr(polqual,polrelid) AS using_expr,
       pg_get_expr(polwithcheck,polrelid) AS check_expr
FROM pg_policy WHERE polrelid='public.profiles'::regclass;

-- 3) ★ 권한 상승 흔적 — 가입으로 생길 수 없는 admin/office 계정
SELECT 'suspicious admin/office' AS check, id, username, role, status, created_at, approved_by
FROM public.profiles WHERE role IN ('admin','office') ORDER BY created_at DESC;

-- 4) 미사용 RPC create_profile_on_signup 의 authenticated 권한 잔존 여부
SELECT 'create_profile_on_signup grants' AS check, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema='public' AND routine_name='create_profile_on_signup';

-- 5) CR-2 백업/스테이징 RLS 상태
SELECT 'backup/staging RLS' AS check, c.relname,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('members_backup','households_backup','staging_members_mdb');

-- 6) PII 테이블의 anon/authenticated 직접 권한
SELECT 'broad table grants' AS check, table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('anon','authenticated')
  AND table_name IN ('members','members_backup','households','households_backup',
                     'staging_members_mdb','profiles','member_relations')
ORDER BY table_name, grantee;

-- 7) CR-3 remove_member_relation 역할검증 포함 여부
SELECT 'CR-3 role check' AS check,
       (pg_get_functiondef(p.oid) ILIKE '%get_user_role%' OR pg_get_functiondef(p.oid) ILIKE '%권한%') AS has_role_check
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='remove_member_relation';

-- 8) H-2 read RPC 가드(assert_staff) 적용 여부
SELECT 'H-2 assert_staff in RPC' AS check, p.proname,
       (pg_get_functiondef(p.oid) ILIKE '%assert_staff%') AS guarded
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
  ('admin_list_pending_signups','admin_list_dept_members','admin_members_relations',
   'households_by_pasture','admin_list_dept_pending','admin_get_votes','admin_get_vote_results');

-- 9) RLS 미적용 public 테이블 전체
SELECT 'RLS disabled tables' AS check, c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false
ORDER BY c.relname;
```

---

## 부록: 작업 이력
- `claude/sec-critical` (커밋 3c49457) → main 머지 4911258 : CR-1/2/3
- `claude/sec-2` (커밋 f768470) → main 머지 0efbf72 : H-2 / H-4
- 본 문서 검토 당시 워킹트리에 다른 에이전트의 미완성 "talk(메신저)+매뉴얼 편집기" 작업이 떠 있었음(빌드 미통과 상태). 본 보안 작업과 분리해 커밋했으며 해당 파일들은 건드리지 않음.
