# chflow 프로젝트 — Claude 작업 규칙

## 작업 범위 (기본 스탠스 — 매번 말하지 않아도 항상 적용)
- **지시받은 것만 바꾼다.** 요청 범위 밖의 디자인·설계·코드는 건드리지 않는다.
- 다음은 요청이 없으면 **하지 않는다**:
  - 리팩터링, 파일·폴더 구조 변경, 함수/변수 이름 바꾸기
  - 요청과 무관한 스타일·레이아웃·문구 "개선"
  - 라이브러리 추가·교체·버전 올리기, 설정 파일 수정
  - 요청 밖 파일의 포맷팅·lint 자동수정 일괄 적용
  - "겸사겸사" 버그 수정 (발견하면 보고만, 고치지 말 것)
- 요청 범위가 애매하면 **좁게 해석**하고, 넓히는 건 사용자에게 물어본다.
- 요청을 수행하려면 범위 밖 변경이 꼭 필요한 경우 → 먼저 이유를 말하고 승인받은 뒤 진행.
- 개선 아이디어가 보이면 코드에 반영하지 말고 **보고서 마지막에 제안으로만** 적는다.

## 폴더 구조
- `chflow-app/` — 메인 웹앱 (Next.js + Supabase) → Vercel 자동배포, **일상 작업은 여기만**
- `chflow-expo/` — 안드로이드 셸 (Expo WebView) → eas build
- `MS_AX/` — DB 작업방 (Python ETL + SQL) → 배포 안 함

## 커밋 / 배포
- `chflow-app` 수정 후 반드시 **commit → push** 까지 완료 (로컬만 수정은 반영 안 됨)
- `git push origin main` → 25초 내 Vercel 자동배포
- 주 URL: `https://chflow-app.vercel.app`
- 커밋 메시지: `feat(범위): 설명` / `fix(범위): 설명` + `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

## Claude + Codex 협업 규칙

### 브랜치 기준
**main 직접 커밋 OK:**
- 텍스트/문구/스타일 1~2파일 수정
- 버그픽스 1파일 (로직 변경 없음)
- 사용자가 "main에 바로 push" 또는 "브랜치 없이 바로 반영" 이라고 명시

**브랜치 필수 (`claude/<task>`):**
- API route 수정
- DB 마이그레이션 / Supabase Auth·RLS·RPC·Storage 정책
- auth/signup/login 관련 파일
- 여러 파일 동시 수정 / 구조 변경

### 임시 파일
- 조사용 SQL·Python·로그는 **`_scratch/claude/<date>/`** 아래만
- 루트나 앱 폴더에 임시 파일 생성 금지

### 충돌 방지
- 공용 파일 편집 전 `git diff -- <file>` 확인
- 내가 만들지 않은 변경이 있으면 작업 중단 → 사용자에게 보고
- `git reset --hard`, `git clean -fd` 사용자 명시 승인 없이 금지

### 모르면 모른다
- DB 구조, Supabase Auth 동작, 마이그레이션 적용 여부, 다른 에이전트 변경 의도
- 위 항목은 추측으로 진행 금지 → "모르겠습니다, 확인 필요합니다"

### 완료 보고 (커밋 포함 작업 시)
브랜치 / 커밋 해시 / 푸시 여부 / 변경 파일 / 검증 결과 / 남은 임시파일

## 디자인 토큰 규칙
- Tailwind 팔레트 하드코딩 금지 → CSS 변수 사용 (`--ink-mid`, `--bg-soft` 등)
- **배경(background) 흰색 하드코딩 절대 금지** (`#fff`/`white`) → `var(--card)` 사용. 다크모드에서 흰 배경 + `var(--ink)` 글자 = 가독성 붕괴. ESLint `no-restricted-syntax`가 error로 강제함 (eslint.config.mjs)
  - 반투명 흰 배경 → `color-mix(in srgb, var(--card) X%, transparent)`
  - 다크모드에서도 진짜 흰 종이여야 하는 표면(PDF/캔버스 렌더링) → `var(--paper)`
  - 악센트(색상) 배경 위 흰 오버레이 칩(`rgba(255,255,255,0.2)` 등)은 예외 (양쪽 모드 동일하게 보임)
- 알파 이어붙이기 금지 → `color-mix(in srgb, var(--color) X%, transparent)` 사용
- 아이콘은 lucide (이모지 금지, 인쇄·게시 콘텐츠 제외)
- font-weight: 400/500/600/700/800만 허용
- 공용 컴포넌트: `components/StatusViews.tsx` (LoadingView, Spinner, EmptyState)
- 풀스크린 모달: 반드시 `components/ModalBackdrop.tsx` 사용

## 코드 규칙
- Create/Edit 짝 컴포넌트는 기능 항상 동기화 (한쪽만 추가 = 버그)
- `profile↔member` 매칭 방향: `members.app_user_id = profile.id` (profile.member_id 사용 안 함)
- PL/pgSQL RETURNS TABLE에서 ORDER BY: 반드시 alias 한정 (`merged.col_name`)
- 가족 관계 필터: `member_relations` + 목장 동일성 조건 (`is_child` 플래그 단독 사용 금지)
- **교육부서 학년/나이 체계·진급 체인: `chflow-app/docs/EDU_GRADE_SYSTEM.md` 필독** — `edu_students.grade_year`는 부서마다 의미가 다름(영아·유아·유치·청소년=세는나이, 초등=학년). 학생 등록·진급·출생연도 로직은 `lib/eduAge.ts` + DB `edu_grade_unit()` 기준, 부서 개편 시 문서의 "함께 고칠 곳" 체크

## 가입 플로우
- 성인: 이름 + 본인 핸드폰 필수
- 자녀: 이름 + (본인 핸드폰 OR "핸드폰없음" → 부모 이름·핸드폰 필수)

## 보안 이슈
- **전체 현황·런북: `chflow-app/docs/SECURITY_REVIEW_2026-06.md`** (보안 검토 결과·조치 상태·적용 절차·진단 SQL·로드맵)
- ✅ **2026-06-15 기준 주요 항목 모두 해소**: CR-1~3·H-1~5·H-1b·H-3·M-err·M-bucket·CSP enforce·pastor A안·M-rate
- 미해소(L): find-id/password 계정 열거, `window.__chflowSupabase` 진단코드
- postcss moderate → Next 16.2.10 + npm overrides(postcss 8.5.18)로 해소. 패키지 보안 점검은 `chflow-app/docs/SECURITY_REVIEW_2026-06.md` 기준.

## 사용자 원칙
- 사용자가 직접 등록한 데이터를 "시스템 자동"이라 표현 금지
- 사용자는 아무것도 설치하지 않고 써야 함 (Tampermonkey·exe 등 사용자 설치 금지)
- 타겟층·기능범위·정책 분기 임의 추천 금지 → 옵션과 트레이드오프만 제시
- 응답은 짧게, 선택지 있으면 요약해서 묻기
