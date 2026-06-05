# 비번초기화 기능정의서

## 1. 메뉴 정의

| 항목 | 정의 |
|---|---|
| 메뉴명 | 비번초기화 |
| 대분류 | 상단 관리자 빠른메뉴 |
| 간단 설명 | 사용자 비밀번호 초기화를 관리자 권한으로 수행한다. |
| 사용자/권한 | admin/office/pastor |
| 라우트 | /admin/password-reset |
| 구현상태 | 구현 |
| 기준일 | 2026-06-05 |

## 2. 관련 파일

- `app/home/page.tsx`
- `app/admin/password-reset/page.tsx`
- `app/api/admin/reset-password/route.ts`

## 3. 기능 목록

| 연번 | 내용 | 해당파일 | 동작원리 | 기능상세설명 |
|---:|---|---|---|---|
| 1 | 빠른 진입 | `app/home/page.tsx` | AdminPill 비번초기화가 /admin/password-reset으로 이동한다. | 관리자가 계정 복구 업무를 수행한다. |
| 2 | 초기화 실행 | `app/admin/password-reset/page.tsx` | 대상 사용자와 새 비밀번호를 입력해 API를 호출한다. | 관리자가 사용자 로그인 문제를 해결한다. |

## 4. 유지보수 포인트

- 메뉴명/설명 변경은 먼저 진입점 파일을 확인한다.
- 라우트가 있는 메뉴는 해당 page 파일과 연결 API/RPC를 함께 점검한다.
- 권한 문제가 발생하면 홈 메뉴 노출 조건, 페이지 인증 로직, Supabase RLS/RPC 권한을 순서대로 확인한다.
