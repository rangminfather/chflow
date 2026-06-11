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
| `CRON_SECRET` | Vercel | Vercel Cron 보호용 토큰 |
| `PUSH_DISPATCH_SECRET` | Vercel, Supabase Vault | 모바일 푸시 dispatch API 보호 토큰 |

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
