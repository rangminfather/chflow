# 보안성 검토 및 조치 현황 (2026-06)

chflow 플랫폼(Next.js + Supabase) 보안 검토 결과와 조치 상태를 한곳에 정리한다.
검토 범위: chflow-app 전체 + MS_AX Supabase 마이그레이션. 검증 방식: 병렬 코드 감사 + 핵심 항목 직접 확인.

> ✅ **2026-06-14 적용 확인**: ②③ DB 마이그레이션이 운영 Supabase에 적용 완료됨.
> 진단 SQL(#1 CR-1 트리거·#5 백업 RLS·#7 CR-3 역할검증·#8 H-2 assert_staff 7개) 모두 참 확인.
> CR-1/CR-2/CR-3/H-2 방어막 가동 중.
>
> ✅ **2026-06-15 추가 해소**:
> - **M-err**: API 라우트 12개 에러 원문 전면 제거 (ums-bulletin/post-v2 스택트레이스 포함)
> - **H-5 (xlsx)**: exceljs 4.4.0으로 전면 교체 (MemberDataTools·rearrange·review-problems·bulletin-import 4파일)
> - **L — 버킷 signed URL**: member-photos·feedback-attachments 버킷 private 전환 + `/api/storage/` 프록시 라우트. members.photo_url 513건 마이그레이션 완료. commit df3c688
>
> 남은 미해결: find-id/password 계정 존재여부 노출(L), postcss moderate(next 내부, 16.3 릴리즈 시 해소)

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
| **CR-1** | Critical | 가입자가 자기 role=admin/status=active로 자가 승격 (가입만 하면 관리자) | ✅ **적용 확인**(2026-06-14, 진단 #1 트리거 존재) |
| **CR-2** | Critical | 백업·스테이징 테이블 RLS 누락 → 전 교인 PII 덤프 | ✅ **적용 확인**(2026-06-14, 진단 #5 RLS on) |
| **CR-3** | Critical | `remove_member_relation` 권한검증 없음 (IDOR) | ✅ **적용 확인**(2026-06-14, 진단 #7 역할검증 포함) |
| **H-2** | High | 관리자용 read RPC 7개 역할검증 누락 | ✅ **적용 확인**(2026-06-14, 진단 #8 assert_staff 7개) |
| **H-4** | High | 보안 헤더 전무 | ✅ **배포 완료**(운영 헤더 확인) |
| **H-1** | High | edu 출석·달란트·주간추가 RPC가 멤버십만 검사(등급·반 무관) → 위변조 | ✍️ 작성됨 `claude/sec-h1`(d790e1b) · **미머지/행동검증 대기** |
| **H-3** | High | anon 개인정보 열거(가입 매칭) | ⏳ 미착수 |
| **H-5** | High | xlsx 0.18.5 서버측 파싱(prototype pollution/ReDoS) | ✅ **해소**(2026-06-15, exceljs 4.4.0 전면 교체) |
| **M-err** | Medium | API 라우트 에러 원문 노출 (error.message 반환) | ✅ **해소**(2026-06-15, 12개 파일 29곳 한국어 일반 메시지로 교체) |
| **M-bucket** | Medium | member-photos·feedback-attachments 버킷 public → PII 사진 노출 | ✅ **해소**(2026-06-15, private 전환 + /api/storage/ 프록시, DB 마이그레이션 완료) |
| **M-others** | Medium | find-id/password 계정 존재여부 노출 등 | ⏳ 미착수 |
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

### H-1 — edu 권한 모델 구조 개선 ✍️ 작성됨 (브랜치 `claude/sec-h1`, d790e1b, 미머지)
출석·달란트·주간추가가 `is_edu_member_or_admin`(승인 멤버면 통과)만 검사 → 학부모(grade4)·타반 교사도 임의 학생 위변조 가능.
- **작성된 조치** (마이그레이션 `20260613120000_edu_class_grade_authz.sql`): 헬퍼 `edu_can_edit_student(dept,student)` 도입 — grade 0~2 부서 전체, 3(교사) 본인 반만(`edu_teachers→edu_students.teacher_id`, my-class-student 라우트와 동일 기준), 4(학부모)/99 불가. 출석/달란트/주간추가 3개 RPC 가드 교체.
- **적용·검증 절차 (머지·적용 전 필수)**:
  1. ⚠️ 적용 전 **행동 검증** — 정상교사: 내 반 출석/달란트 입력 OK / 타반 교사: 다른 반 학생 입력 시 거부 / 학부모: 입력 거부 / 부장·총무: 부서 전체 OK.
  2. 검증 후 `claude/sec-h1`를 main 머지 + 마이그레이션을 SQL Editor 적용.
- **후속(H-1b, 미작성)**: 교육일지 RPC grade 가드, `edu_talent_rules` RLS WITH CHECK 상향(=`talent/page.tsx:199` 직접 insert 우회 차단), 학생/교사/새친구 CRUD grade 가드.
- **주의**: AGENTS.md 보호대상(my-class-attendance, talent) 포함 → 동작 변경(교사=내 반만)이라 위 검증 필수.

### pastor 권한 구조 → **A안 채택, 핵심 구현 완료 (2026-06-14)**
'목사'는 가입으로 자가 선택 가능한데 동시에 권한 집합(`role IN ('admin','office','pastor')`)에 포함 → 자가 가입한 목사가 승인되면 pastor 권한(전 교인 조회 등) 자동 획득.
- **결정: A안 — 직분(표시)과 권한(authz) 분리.** 가입은 직분만 기록(sub_role), 권한은 관리자가 별도 부여.
- **핵심 발견 (구현을 단순·안전하게 만든 사실):**
  - myinfo는 본인 `sub_role`만 수정하고 `role`은 안 건드림 + CR-1 트리거가 authenticated의 role UPDATE 전면 차단 → 자가 권한부여 경로 없음.
  - 직분 **표시는 sub_role 기반**(`getRoleImageByLabel(sub_role)`), role 무관. 즉 직분↔권한은 이미 데이터상 분리돼 있고 **유일한 누수는 "가입이 clergy의 role을 pastor로 저장"** 하나뿐이었음.
  - 운영 `role IN ('pastor','office')` 프로필 status 무관 **0건** → backfill·잠김 없음.
- ✅ **구현(브랜치 `claude/sec-pastor-authz`):**
  - `/api/signup`: authz role(admin/office/pastor)을 저장 시 `'member'` 로 중립화(직분은 sub_role 유지). 코드 배포로 적용.
  - `20260614100000_pastor_authz_separation.sql`: CR-1 트리거 직접삽입 차단 집합에 `'pastor'` 추가(방어심화). ✅ **SQL Editor 적용 확인(2026-06-14)**.
  - 권한 집합 `IN ('admin','office','pastor')`은 ~60개 RLS/RPC에 그대로 두되, 'pastor' 가 role 에 들어가는 경로를 가입에서 제거 → **블라스트 반경 최소화**.
- ⏳ **남은 follow-up(UX 결정 필요, 보안 무관):** 관리자가 의도적으로 staff 권한을 부여하는 화면(승인/회원관리에 토글) — 현재는 service_role 경로로만 부여 가능. 버튼 위치·라벨·확인 플로우는 제품 결정 필요.
- 참고(미채택): B. authz에서 'pastor' 제거 / C. 승인 시 사람 검증만.

### 이후
- **H-3**: anon 조회 함수(`search_member_candidates`, `find_member_for_signup` 등) anon GRANT 회수 → 서버 경유 + rate-limit. (가입 매칭 플로우 재설계)
- ~~**H-5**: xlsx → exceljs 교체~~ → ✅ **해소(2026-06-15)**. **exceljs 4.4.0 전면 교체** — MemberDataTools·rearrange·review-problems·bulletin-import 4파일. PK 컬럼 스타일 코멘트→갈색 폰트, xlsx 패키지 제거.
- ~~**CSP**~~ → ✅ **enforce 전환 완료(2026-06-14)**. `next.config.ts`에서 `Content-Security-Policy-Report-Only` → `Content-Security-Policy`로 전환. Playwright로 공개·인증 화면 전체 CSP 위반 0건 확인. commit 2928dbb.
- ~~**M-err**: 에러원문 노출~~ → ✅ **해소(2026-06-15)**. API 라우트 12개 파일, 29곳 `error.message` → 한국어 일반 메시지. ums-bulletin/post-v2 스택트레이스 필드 제거.
- ~~**M-bucket**: 버킷 public~~ → ✅ **해소(2026-06-15)**. member-photos·feedback-attachments → `public=false`. `/api/storage/[bucket]/[...path]` 프록시 라우트 (인증 확인 → signed URL 302). members.photo_url 513건 → `/api/storage/...` 형태로 DB 마이그레이션 완료. commit df3c688.
- **남은 M/L**: find-id/password 계정 존재여부 노출(L, enumeration), `window.__chflowSupabase` 진단코드(L), postcss moderate(next 내부·16.3 릴리즈 자동해소).

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
