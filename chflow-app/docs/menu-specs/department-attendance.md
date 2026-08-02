# 출결 통합 조회 기능정의서

## 1. 메뉴 정의

| 항목 | 정의 |
|---|---|
| 메뉴명 | 출결 통합 조회 |
| 대분류 | 부서 내부 메뉴 > 행정관리 |
| 간단 설명 | 전 반 한 달치 출결 체크(출석/결석/출석인정) + 달란트 체크 현황 + 학생별 출결 이력 모달. |
| 사용자/권한 | 초등1부 총무/서기 이상 |
| 라우트 | /departments/d/[id]/attendance |
| 구현상태 | 구현 |
| 기준일 | 2026-07-08 |

## 2. 관련 파일

- `app/departments/d/[id]/page.tsx`
- `app/departments/d/[id]/attendance/page.tsx`

## 3. 기능 목록

| 연번 | 내용 | 해당파일 | 동작원리 | 기능상세설명 |
|---:|---|---|---|---|
| 1 | 부서홈 메뉴 노출 | `app/departments/d/[id]/page.tsx` | MENU_CATEGORIES의 출결 통합 조회 항목으로 정의된다. | 사용자 부서 등급과 부서 조건이 맞으면 카드가 표시된다. |
| 2 | 출석체크 탭 | `app/departments/d/[id]/attendance/page.tsx` | 반별 그룹 × 해당 월 주일 그리드. 종이 출석부식 기호(/ 출석, · 결석, Ø 출석인정, 빈칸 미기록) + 상단 범례. 칸 탭 시 순환 (`edu_set_student_attendance`). | 전 반 학생을 한 화면에서 체크·수정한다. 월합계는 출석/결석/출석인정 카운트. |
| 3 | 달란트체크 탭 | `app/departments/d/[id]/attendance/page.tsx` | `get_dept_weekly_extra` + `list_talent_rules`. 체크 항목을 ①②③ 번호로 주별 표시, 상단 범례에 번호↔항목·점수 매핑. 주차 칸을 누르면 체크 항목과 기타 직접입력 사유·수량이 한 팝업에 즉시 표시된다. `toggle_weekly_extra`로 체크를 수정하고 `edu_save_talent`/`edu_delete_talent`로 직접입력을 저장한다(담임 달란트통장과 동일 저장 방식, 임원은 전 학생 수정 가능). | 주일별 칸에 직접입력 수량을 `직+N`으로 표시하고 월합계 체크 수·점수에 포함한다. |
| 4 | 학생 출결 이력 모달 | `app/departments/d/[id]/attendance/page.tsx` | 학생 이름 클릭 → `edu_get_student_history`로 기간별 이력 조회. | 기간 선택 + 전체 주일/출석/결석/출석인정 요약 + 날짜별 목록. (구 학생 출결 조회 메뉴를 흡수) |
| 5 | 등반 확정 | `app/departments/d/[id]/attendance/page.tsx` | `edu_promotion_board` / `edu_confirm_promotion`. | 4주 출석 새친구 등반 확정 보드 유지. |
| 6 | 권한 기준 | `app/departments/d/[id]/page.tsx` | 카테고리 maxGrade와 항목 maxGrade/onlyForDept 조건으로 노출을 제어한다. | 초등1부 총무/서기 이상 기준으로 접근 범위를 제한한다. |

※ 학생 추가/삭제는 이 화면에서 제거됨 → 학생정보관리 메뉴에서 수행.

## 4. 유지보수 포인트

- 메뉴명/설명 변경은 먼저 진입점 파일을 확인한다.
- 라우트가 있는 메뉴는 해당 page 파일과 연결 API/RPC를 함께 점검한다.
- 권한 문제가 발생하면 홈 메뉴 노출 조건, 페이지 인증 로직, Supabase RLS/RPC 권한을 순서대로 확인한다.
