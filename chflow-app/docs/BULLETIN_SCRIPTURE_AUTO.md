# 주보 성경봉독 자동 판독 — 운영·자가 진단

## 흐름
`/api/bulletin/sync` cron(금·토 6회) → 주보 수집 → `processPendingScriptureExtractions`
(`lib/bulletin/scripture-auto.ts`)

- 대상: 주일 날짜가 최근 7일 안이고 판독 상태가 없거나 `retry` 인 주보만. `done`/`review`/`failed` 는 다시 호출하지 않는다.
- 1쪽 300dpi 렌더(pdfjs-dist + @napi-rs/canvas) → Gemini 두 모델 판독 → NKRV 구절 검증
  → 두 모델 일치 = 자동 게시, 불일치·검증 실패 = 검토 대기 + 관리자 알림.
- 과부하(503)·한도(429)·무응답은 대체 모델 → 다음 cron 재시도(주보당 최대 6회).
- 관리자가 직접 저장한 칸(`source='manual'`)은 AI 가 덮지 않는다.

## 시간 제한
- 함수 제한: `app/api/bulletin/sync/route.ts` 의 `maxDuration`(현재 60초). 판독 마감 = 시작 + (maxDuration − 5)초.
- 모델 호출 하나당 최대 25초, 처음 두 모델은 동시에. 마감까지 10초 미만이면 대체 모델을 부르지 않고,
  20초 미만이면 판독을 시작하지 않고 다음 cron 으로 미룬다(`deferred`).

## 자가 진단 (관리자 화면 `/admin/bulletin-scripture-readings` 상단)
실행마다 `bulletin_scripture_extraction_runs` 에 소요 시간·쓸 수 있던 시간·모델별 응답 시간과 상태를 남기고,
`lib/bulletin/scripture-health.ts` 가 최근 14일 기록으로 판정한다.

| 코드 | 수준 | 뜻 | 조치 |
|---|---|---|---|
| `time_limit` | 조치(알림) | cron 이 시간 부족으로 판독을 못 끝냈거나 미룸 | `maxDuration` 을 올린다(아래) |
| `near_limit` | 지켜보기 | cron 판독이 쓸 수 있던 시간의 80% 이상 사용 | 반복되면 `maxDuration` 상향 |
| `model_retired` | 조치(알림) | 설정된 모델이 404(단종) | Vercel env `GEMINI_SCRIPTURE_MODELS` 에서 교체 |
| `key_invalid` | 조치(알림) | 키 없음·거부 | Vercel env `GEMINI_API_KEY` 확인 후 Redeploy |
| `quota` | 지켜보기 | 429 가 2회 이상의 실행에서 | 유료 전환 또는 모델 순서 변경 검토 |
| `overload` | 지켜보기 | 503·무응답으로 미뤄진 실행 2회 이상 | Google 쪽 문제, 재시도로 처리됨 |

조치 신호는 종류별로 7일에 한 번 관리자(admin/office/pastor)에게 `ops_bulletin_sync_error` 알림으로 간다.

## maxDuration 올리는 법
Vercel 문서상 Hobby 도 Fluid compute 가 켜져 있으면 최대 300초. 켜져 있지 않으면 60초가 한계이고,
허용치를 넘는 값은 배포가 거부될 수 있다. 대시보드 Settings → Functions 에서 Fluid compute 확인 후
`app/api/bulletin/sync/route.ts` 의 `maxDuration` 을 올린다.

## 모델 순서
기본값(`lib/bulletin/scripture-ai.ts`): `gemini-3.1-flash-lite, gemini-3.8-flash, gemini-3.5-flash-lite, gemini-3.5-flash`.
Vercel env `GEMINI_SCRIPTURE_MODELS`(쉼표 구분)로 코드 수정 없이 바꿀 수 있다. 앞의 두 개를 먼저 동시에 부른다.
