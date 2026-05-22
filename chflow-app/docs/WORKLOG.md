# WORKLOG

## 2026-05-22 — 메인 화면 재정리 (사역 카드 버그 + 섹션 구분 강화)

### 변경 파일
- `app/home/page.tsx` (전면 수정)
- `docs/WORKLOG.md` (신규)

### 배경
직전 리팩터링 후 사용자 보고 두 가지:
1. 사역 카드에서 "초등1부", "교육사역국" 텍스트가 **세로로 한 글자씩 줄바꿈**되는 레이아웃 버그
2. 전체 화면이 흰 카드 + 회색 배경의 반복이라 상/중/하 구분이 약함

### 핵심 변경사항

#### 1. 사역 카드 세로 줄바꿈 버그 수정
- **원인**: `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))` 으로 카드 폭이 모바일에서 220px 까지 줄어들고, 안쪽에 `iconBox(48px) + gap(14px) + 텍스트 + gap(14px) + 배지(약 60px)` 가 들어가 텍스트 영역이 ~44px 까지 압축되어 한글이 자동 줄바꿈됨
- **수정**:
  - 그리드 → `display: flex; flex-direction: column` 세로 리스트로 변경 (카드 width 100% 보장)
  - 텍스트 영역에 `.ellipsis-1` 유틸 클래스(`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0`) 적용 — 줄바꿈 자체 차단, 너무 길면 `...` 처리
  - 아이콘과 배지에 `flexShrink: 0`, 텍스트 영역에 `flex: 1; min-width: 0`
  - 한국어 단어 단위 줄바꿈이 필요한 멘트는 `.kr-keep` (`word-break: keep-all`) 유틸로 별도 처리

#### 2. 섹션별 tinted 컨테이너 도입 (상/중/하 구분 강화)
- 각 섹션 전체를 `<SectionContainer bg={...}>` 컴포넌트로 감싸 **24px 라운드 + 연한 tinted 배경**
- 섹션별 색상 토큰
  | 섹션 | 배경 | 포인트 |
  |---|---|---|
  | 내 사역 · 부서 | `#EEF2FF` (indigo soft) | `#6366F1` |
  | 나의 목장     | `#ECFDF5` (green soft)  | `#10B981` |
  | 공통 메뉴     | `#F1F5F9` (slate soft)  | `#3B82F6` |
- 섹션 헤더에 작은 라운드 박스 + 포인트 컬러 아이콘, 그 옆에 굵은 제목, 한 줄 아래 보조 설명 (좌측 36px 들여쓰기로 통일)
- 섹션 간 `marginBottom: 24px`

#### 3. 카드 구조 정렬 통일
- 사역 카드 / 목장 카드 / 공통 메뉴 카드 모두 동일한 가로 레이아웃: `[아이콘 박스]  [제목·보조설명]  [배지 or CTA]`
- 모든 카드 `width: 100%`, padding 16~18px, border-radius 16px, 1px 테두리 + 거의 안 보이는 그림자(`0 1px 2px rgba(15,23,42,0.03)`)

#### 4. 공통 메뉴 그리드
- 모바일/PC 모두 **2열 고정** (`repeat(2, 1fr)`)
- 일반 성도 카드(주보/요람/내정보/불편신고) 아래에 **관리자 메뉴** 라벨을 두고 compact 버전으로 노출 — 공통 메뉴를 압도하지 않게

#### 5. 목장 섹션 상태 분기
- A. 미가입 (`user.pasture_name === null`): 가입 안내 + green CTA "목장 가입 신청"
- C. 소속: 평원·초원 보조 + `{목장명}목장` + "목장 보기" green 버튼
- D. 관리자 배정: C와 동일 UI (DB에 구분 정보 없음, 의도된 동작)
- B. 승인 대기: 코드에 자리 + `// TODO:` 주석만 유지 (백엔드 미구현)

#### 6. 사용자 요약 카드
- 프로필 사진(56) + 우하단 직분 아바타(26) 결합 → 한 줄 정렬, 수직 가운데
- 이름 18px/800, 직분·가정교회 13px/muted, 인사말 12px/muted (모두 ellipsis-1)
- 카드 padding 16px로 컴팩트하게

### 유지된 기능
- 인증/세션/로그아웃 (`supabase.auth`)
- 안드로이드 뒤로가기 가드 + 종료 모달/토스트
- 알림 종(`NotificationBell`)
- 데스크탑 사이드바 + 모바일 햄버거 메뉴
- 관리자 7종 핀 버튼 (`/admin/*`)
- 기존 RPC: `get_my_full_info` / `get_my_departments` / `get_my_photos`
- 기존 라우팅: `/departments`, `/departments/d/:id`, `/bulletin`, `/directory`, `/myinfo`, `/feedback`, `/admin/*`

### TODO
- 목장 가입 신청 백엔드 (`pasture_requests` 테이블 + RPC) 추가 후 `handleJoinRequest` 의 alert → `router.push("/pasture/request")` 로 교체
- 목장 상세 화면 (`/pasture/me` 또는 `/pasture/[id]`) 추가 후 `handleViewPasture` 교체
- 승인 대기(B) 상태 분기 자리 — `MyMokjangSection` 내부 TODO 주석 참고

### 검증
- `npx tsc --noEmit` 통과 (에러 없음)
- 사역 카드 세로 줄바꿈 재발 방지: `.ellipsis-1` 클래스로 줄바꿈 자체가 막혀 있어 좁은 화면에서 글자가 한 자씩 떨어질 수 없음
