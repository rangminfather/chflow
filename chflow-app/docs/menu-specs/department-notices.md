# 공지 게시판 기능정의서

## 1. 메뉴 정의

| 항목 | 정의 |
|---|---|
| 메뉴명 | 공지 게시판 |
| 대분류 | 부서 내부 메뉴 > 공지사항 |
| 간단 설명 | 부서 공지와 알림을 게시하고 확인한다. |
| 사용자/권한 | 부서원 |
| 라우트 | /departments/d/[id]/notices |
| 구현상태 | 구현 |
| 기준일 | 2026-06-05 |

## 2. 관련 파일

- `app/departments/d/[id]/page.tsx`
- `app/departments/d/[id]/notices/page.tsx`

## 3. 기능 목록

| 연번 | 내용 | 해당파일 | 동작원리 | 기능상세설명 |
|---:|---|---|---|---|
| 1 | 부서홈 메뉴 노출 | `app/departments/d/[id]/page.tsx` | MENU_CATEGORIES의 공지 게시판 항목으로 정의된다. | 사용자 부서 등급과 부서 조건이 맞으면 카드가 표시된다. |
| 2 | 화면 이동 | `app/departments/d/[id]/notices/page.tsx` | 클릭 시 /departments/d/[id]/notices로 이동한다. | 부서 공지와 알림을 게시하고 확인한다. |
| 3 | 권한 기준 | `app/departments/d/[id]/page.tsx` | 카테고리 maxGrade와 항목 maxGrade/onlyForDept 조건으로 노출을 제어한다. | 부서원 기준으로 접근 범위를 제한한다. |

## 4. 유지보수 포인트

- 메뉴명/설명 변경은 먼저 진입점 파일을 확인한다.
- 라우트가 있는 메뉴는 해당 page 파일과 연결 API/RPC를 함께 점검한다.
- 권한 문제가 발생하면 홈 메뉴 노출 조건, 페이지 인증 로직, Supabase RLS/RPC 권한을 순서대로 확인한다.
