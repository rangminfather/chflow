# WORKLOG

## 2026-05-22 — 전역 모바일 반응형 안전 규칙 + 재사용 Layout 컴포넌트

### 목적
"어떤 화면에서도 콘텐츠가 부모 컨테이너를 넘어 가로 스크롤이 생기지 않게" 한다.
단순 `overflow-x: hidden` 으로 가리는 게 아니라 실제 폭 계산을 안전하게 한다.

### 변경 파일
- `app/globals.css` — 전역 안전 규칙 + 유틸 클래스 추가
- `components/Layout.tsx` (신규) — 재사용 컴포넌트 모음
- `app/home/page.tsx` — 새 컴포넌트로 리팩토링 (모범 적용)
- `docs/WORKLOG.md` — 본 기록

### 적용한 오버플로우 방지 규칙

#### 1) 전역 (`globals.css`)
```css
*, *::before, *::after { box-sizing: border-box; }
html, body { width: 100%; max-width: 100vw; overflow-x: hidden; }
img, video, canvas, svg, iframe { max-width: 100%; }
button, a { max-width: 100%; }
.app-shell { width: 100%; max-width: 100vw; overflow-x: hidden; }
```

#### 2) 그리드 (사용자 명시 규칙)
2열 그리드는 항상 `grid-template-columns: repeat(2, minmax(0, 1fr))`.
이게 없으면 자식 콘텐츠가 1fr 트랙을 밀어내서 가로 스크롤이 발생.
유틸: `.safe-grid-2`, 컴포넌트: `<SafeGrid cols={2} />`.

#### 3) Flex 자식의 `min-width: 0` 강제
flex item은 기본 `min-width: auto` 라 콘텐츠 길이만큼 폭을 잡아 부모를 넘김.
모든 flex row에 `min-width: 0` 적용 + 텍스트 영역 자식에 `flex: 1; min-width: 0`.
컴포넌트: `<SafeRow>`, `<SafeGrow>`, `<SafeShrink>`.

#### 4) 카드는 고정 width 금지
모든 카드 `width: 100%; max-width: 100%; box-sizing: border-box; min-width: 0`.
컴포넌트: `<SafeCard>` — `onClick` 있으면 `<button>`, 없으면 `<div>`.

#### 5) 한국어 줄바꿈 처리 (`whitespace-nowrap` 남발 금지)
- `.kr-keep` (`word-break: keep-all; overflow-wrap: break-word`) — 단어 단위 자연스러운 줄바꿈
- `.kr-break` (`word-break: break-word; overflow-wrap: anywhere`) — "불편신고/건의"처럼 슬래시 포함된 긴 토큰 보호용
- `.line-clamp-1`, `.line-clamp-2` — 한/두 줄 잘림. nowrap 대신 사용해서 좁은 화면에서도 안전하게 줄임표 처리

#### 6) padding/gap 동적 조정
`padding: clamp(12px, 4vw, 24px)` 형태로 모바일에선 줄어들고 큰 화면에선 늘어나게.
PageContent, Section 등에 적용.

### 재사용 컴포넌트 (`components/Layout.tsx`)
| 컴포넌트 | 역할 |
|---|---|
| `PageShell` | 모든 페이지 최상위 — `width:100%; max-width:100vw; overflow-x:hidden` |
| `PageContent` | 가운데 정렬 + clamp() 좌우 padding + maxWidth 920 기본 |
| `Section` | tinted 컨테이너 (제목/설명/콘텐츠 묶음) |
| `SectionHeader` | 아이콘 박스 + 제목 + 보조설명 통일 헤더 |
| `SafeCard` | 100% 폭 카드, onClick 있으면 button |
| `SafeRow` / `SafeGrow` / `SafeShrink` | flex 안전 wrapper |
| `SafeGrid` | `repeat(N, minmax(0, 1fr))` 그리드 |
| `IconBox` | 정사각형 아이콘 영역 (flex-shrink: 0) |
| `Badge` | 상태 배지 (success/warn/info/neutral) |
| `SolidButton` / `OutlineButton` | 100% 폭 CTA |
| `T` | 디자인 토큰 export (bgPage, ministry/mokjang/common 톤 등) |

이 컴포넌트들은 다른 페이지를 손볼 때 그대로 가져다 쓰면 동일한 안전 규칙이 자동 적용됨.

### 홈 화면 적용 결과
- 모든 카드가 `SafeCard` + `SafeRow + IconBox + SafeGrow + Badge` 패턴
- 공통 메뉴 2열 그리드는 `<SafeGrid cols={2}>` (minmax(0,1fr))
- "불편신고/건의" 같이 슬래시 포함된 긴 메뉴명은 `kr-break` + `lineHeight: 1.25` 로 두 줄로 자연스럽게 떨어지게 처리 (강제 축소 X)
- 사이드바 아이템 텍스트도 `kr-keep` 적용, 컨테이너 `min-width: 0`
- 종료 모달 버튼들도 `flex: 1; min-width: 0` 적용

### 유지된 기능
인증/세션/로그아웃, 안드로이드 뒤로가기 가드, 종료 모달/토스트, 알림 종, 데스크탑 사이드바, 모바일 햄버거, 관리자 핀 버튼, 모든 RPC/라우팅 — 그대로.

### 검증
- `npx tsc --noEmit` 통과
- `npm run build` 성공 (모든 라우트 빌드)
- 정적 검증: `html, body { overflow-x: hidden }` + `*, *::before, *::after { box-sizing: border-box }` 로 가로 스크롤 자체가 발생 불가능한 구조
- 런타임 검증 (사용자 단말 권장):
  ```js
  // 브라우저 콘솔에서
  document.body.scrollWidth > window.innerWidth
  // 어떤 페이지에서도 false 여야 함
  ```

### 다른 페이지로 확장하는 방법
1. 페이지 최상위 wrapping: `<PageShell> ... </PageShell>`
2. 안쪽 가운데 정렬은 `<PageContent maxWidth={920}>` 또는 `<PageContent maxWidth={1100}>` 등
3. 섹션은 `<Section bg={T.ministryBg}>` 등 tinted 배경 사용
4. 가로 정렬 카드는 `<SafeCard onClick={...}><SafeRow>...<IconBox/><SafeGrow>...</SafeGrow><Badge.../></SafeRow></SafeCard>`
5. 2열 카드 그리드는 `<SafeGrid cols={2}>`
6. 한글 라벨에는 항상 `kr-keep` 또는 `kr-break` 클래스 + `lineHeight: 1.25~1.5`

### TODO
다음 페이지들도 같은 패턴으로 정리하면 좋음 (이번 작업은 home 만 우선 적용):
- `/feedback`, `/feedback/[id]`, `/feedback/new`
- `/directory`
- `/signup`
- `/login`, `/find-id`, `/find-password`
- `/myinfo`
- 관리자 페이지들

---

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
