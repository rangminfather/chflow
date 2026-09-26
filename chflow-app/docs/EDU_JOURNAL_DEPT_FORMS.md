# 교육일지 · 주보 불러오기 — 부서별 현황

교육사역국 6개 부서가 **같은 교육일지 화면**을 쓴다. 다른 건 두 가지뿐이다.
1. **어떤 입력란을 보여줄지** — DB(`edu_journal_field_settings`)가 정한다
2. **주보에서 값을 어떻게 긁어올지** — 파서 서식표(`DEPT_BULLETIN_PROFILES`)가 정한다

기준일 2026-09-26.

---

## 1. 부서별 현황

| 부서 | 일지 작성 | 주보 형식 | 주보 텍스트 추출 | 파서 서식 등록 |
|---|---|---|---|---|
| 유아부 | 5건 (실사용) | PDF | ❌ 본문이 전부 그림 (추출 30자) → **OCR 경로** | 미등록 (초등1부 폴백) |
| 초등1부 | 2건 | PDF | ✅ 정상 (1,700자+) | ✅ `초등1부` |
| 초등2부 | 0건 | HWPX | 미시도 | 미등록 |
| 유치부 | 0건 | PPTX | 미시도 | 미등록 |
| 청소년부 | 0건 | PPTX | 미시도 | 미등록 |
| 영아부 | 0건 | **게시 안 함** | — | 해당 없음 |

부서 형식 출처: 2026-08-29 실측. 작성 건수·추출 상태: 2026-09-24 production 조회.

---

## 2. 부서별 서식 (입력란 켜고 끄기)

- 테이블 `edu_journal_field_settings(department_id, field_key, is_visible)`
- RPC `edu_get_journal_fields(dept)` 조회 / `edu_set_journal_field(dept, key, visible)` 저장
- **행이 없으면 표시가 기본값** — 테이블이 비어도 화면은 종전 그대로
- 저장 권한: 부서 등급 0~2(임원진). 화면의 "서식 설정" 패널도 같은 기준으로 노출
- **끈 항목의 저장값은 지우지 않는다.** 화면에서만 빠지고, 저장할 때 읽어온 값을
  그대로 다시 보낸다 → 서식을 다시 켜면 예전 내용이 그대로 보인다

켜고 끌 수 있는 항목 15개 (날짜는 일지의 키라서 제외):
주제 / 본문(성경) / 인도자 / 설교자 / 설교제목 / 기도 / 찬양 / 합동 / 공과내용 /
행사 / 반별 출결표 / 주일통계 / 헌금 / 봉사 / 기도제목

현재 저장된 설정: **초등1부만** 합동·공과내용 off. 나머지 부서는 전부 표시.

> ⚠️ 2026-09-20 에 합동·공과내용 입력란을 코드에서 지웠는데 그건 초등1부 기준
> 판단이었다. 유아부는 `joint_activity`("유치유아부합동예배")를 실제로 쓰고 있어
> 그 부서엔 회귀였다. 2026-09-26 에 설정 기반으로 바꾸면서 복구했다.
> **"이 칸 필요없다"는 요청은 부서를 먼저 확인할 것.**

---

## 3. 주보 불러오기

### 불러오기 순서 (`journal/page.tsx`)
1. 주보 만들기 임시저장본 (`bulletin_get_draft`) — 초등1부만 해당
2. 공통 주보 추출 (`/api/dept-bulletin/extraction`) ← **전 부서 경로**
3. 구 경로 (`/api/journal-prefill`) — 초등1부 전용 폴백

②가 성공하면 ③은 실행되지 않는다. 그래서 ②에 없는 항목은 영영 안 채워진다
(2026-09-20 에 주제가 그래서 비어 있었다).

### 파서 서식표 — `lib/bulletin/dept-bulletin-fields.ts`
`DEPT_BULLETIN_PROFILES[부서명]` 에 라벨쌍을 등록한다. 값은 **라벨과 라벨 사이**를
잘라낸 것이다. 등록 안 된 부서는 초등1부 서식으로 폴백한다(빈 값이 나올 뿐 안 깨진다).

초등1부 실제 라벨 순서:
```
안내 / 찬양 / 예배인도 / 십계명 / 신앙고백 / 주제제창 / 찬양(헌금) /
기도 / 성경봉독 / 강론 / 주기도문 / 광고 / ✿2부행사 / ✿다음주기도
```
주제는 `주제제창` 칸이 우선, 없으면 머리글 `주제 : …`.

### 추출 방식 판정 — `lib/bulletin/content-extraction.ts`
- 이미지 파일(jpg/png/…) → 바로 OCR
- **PDF 인데 글자가 200자 미만 → OCR** (유아부처럼 본문이 그림인 경우)
- pptx·hwpx → OCR 로 읽을 방법이 없어 네이티브 추출 결과를 그대로 쓴다

PDF OCR 은 tesseract 가 PDF 를 못 읽어서 `client-extraction.ts` 가 pdf.js 로
앞 3쪽을 2배 캔버스에 그린 뒤 인식한다.

### 캐시
`dept_bulletin_extractions` 에 주보 1건당 1행. **원문(`extracted_text`)이 진짜이고
`fields` 는 파생값**이라, 읽을 때마다 원문에서 다시 뽑는다 → 파서를 고치면
이미 캐시된 주보도 자동으로 좋아진다. 캐시를 지울 필요 없다.

---

## 4. 남은 일

- [ ] **유치부·청소년부(PPTX), 초등2부(HWPX) 라벨표 채우기.**
      각 부서 교육일지에서 "주보 불러오기"를 한 번 누르면 `dept_bulletin_extractions`
      에 원문이 쌓인다. 그 텍스트를 보고 `DEPT_BULLETIN_PROFILES` 에 추가할 것.
      **실제 텍스트를 보기 전에 추측으로 라벨을 넣지 말 것.**
- [ ] 유아부 PDF OCR 실동작 확인 (본문이 그림이라 인식률이 관건 — 앞 3쪽/2배 배율이
      충분한지, 느리지 않은지)
- [ ] 반별 출결표 9컬럼(재적·출석·결석·인도·모범·요절·과제·성경·퀴즈)은 초등1부
      달란트 체계 기준이다. 유아부는 전부 0으로 두고 안 쓴다. 컬럼 자체를 부서별로
      바꾸려면 `edu_journal_class_rollup` 과 `class_stats` 스냅샷까지 건드려야 한다
- [ ] 반 명칭이 부서마다 다르다 (초등1부 `1-1`,`1-2` / 유아부 `1목장`)
- [ ] `docs/menu-specs/department-journal.md` 의 권한 기술이 "초등1부 총무/서기 이상"
      으로 돼 있으나 실제 코드는 교육사역국 전체 (`onlyForCategory: "교육사역국"`)

## 5. 함께 볼 곳
- `app/departments/d/[id]/journal/page.tsx` — 일지 화면 + 서식 설정 패널
- `lib/bulletin/dept-bulletin-fields.ts` — 부서별 라벨표
- `lib/bulletin/content-extraction.ts` — 파일형식별 텍스트 추출 · OCR 판정
- `lib/bulletin/client-extraction.ts` — 브라우저 OCR (pdf.js + tesseract)
- `app/api/dept-bulletin/extraction/route.ts` — 추출 API · 캐시
- `MS_AX/chflow-project/supabase/migrations/20260924120000_edu_journal_field_settings.sql`
