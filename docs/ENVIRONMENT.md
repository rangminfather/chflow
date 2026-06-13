# Environment Setup

## 환경 구분

| 환경 | 용도 | 주요 차이 |
|---|---|---|
| 개발 | 로컬 Next/Expo 실행 | `chflow-app/.env.local` 사용 |
| 스테이징 | 운영 전 검증 | Vercel preview 환경변수, 테스트 Supabase 권장 |
| 운영 | 실제 서비스 | Vercel production, 운영 Supabase, Expo production build |

## 필수 환경변수

| 이름 | 위치 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel, `.env.local` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, `.env.local` | 브라우저/앱용 Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel | 서버 API에서 RLS를 우회해 운영 작업 수행 |
| `NEXT_PUBLIC_SITE_URL` | Vercel | 비밀번호 재설정 등 절대 URL 기준 |
| `CRON_SECRET` | Vercel | Vercel Cron 보호용 토큰. **미설정 시 production에서 모든 cron이 401로 거부됨** |
| `PUSH_DISPATCH_SECRET` | Vercel, Supabase Vault | 모바일 푸시 dispatch API 보호 토큰 |
| `UMS_JUBO_USER_ID` / `UMS_JUBO_PASSWORD` | Vercel | 메인 주보 자동 수집(`/api/bulletin/sync`)용 UMS 계정. fallback: `UMS_BULLETIN_*` 또는 `UMS_USER_ID`/`UMS_PASSWORD`. **로컬 `.env.local`뿐 아니라 Vercel production에도 반드시 설정** |

## 주보 자동 수집 cron 시간 (중요)

Vercel cron schedule은 **UTC 기준**입니다. `vercel.json`의 표기와 실제 실행되는 한국시간(KST)은 다음과 같이 9시간 차이가 납니다.

| vercel.json (UTC) | 실제 실행 (KST) |
|---|---|
| `0 6 * * 5` | 금 15:00 |
| `0 12 * * 5` | 금 21:00 |
| `0 23 * * 5` | 토 08:00 |
| `0 4 * * 6` | 토 13:00 |
| `0 10 * * 6` | 토 19:00 |
| `0 21 * * 6` | 일 06:00 |

이미 받은 주 분은 `already_fetched`로 즉시 건너뛰므로 자주 돌려도 부하는 거의 없습니다. cron이 한 번도 못 받은 경우에도 사용자가 `주보 보기`를 누르면 `/api/bulletin/latest`가 백그라운드로 1회 수집을 트리거합니다(self-heal). 수집 성공/실패는 `bulletin_sync_log` 테이블에 기록되고, 실패 시 admin/office에게 알림이 갑니다.

## Supabase Vault

DB에서 Vercel API를 직접 호출하려면 다음 Vault secret이 필요합니다.

```sql
select vault.create_secret(
  'https://chflow-app.vercel.app/api/mobile/push-dispatch',
  'chflow_push_dispatch_url'
);

select vault.create_secret(
  '<PUSH_DISPATCH_SECRET 값>',
  'chflow_push_dispatch_secret'
);
```

비밀값은 코드, README, SQL migration 파일에 직접 기록하지 않습니다.

## 외부 서비스

- Supabase: PostgreSQL, Auth, Storage, Realtime, Vault, pg_net
- Vercel: `chflow-app` 배포와 API Route 실행
- Expo/EAS: Android APK/AAB 빌드와 Expo Push Token 발급
- Expo Push API: `/api/mobile/push-dispatch`가 OS 푸시 발송에 사용

## 설정 파일

- 루트 `.env.example`: 필요한 값의 목록
- `chflow-app/.env.local`: 로컬 웹 개발용 실제 값
- Vercel Environment Variables: 운영/preview 서버 런타임 값
- Supabase Vault: DB trigger가 사용할 webhook URL/secret
