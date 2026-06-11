# Operations Manual

## 배포 절차

웹/PWA 배포:

```powershell
cd C:\csh\project\chflow
.\scripts\deploy-chflow-app.ps1
```

수동 배포:

```powershell
cd C:\csh\project\chflow
vercel --prod --yes
vercel inspect chflow-app.vercel.app
```

Android 검증 빌드:

```powershell
cd C:\csh\project\chflow\chflow-expo
eas build -p android --profile verify
```

## 알림/푸시 운영 설정

1. Vercel production 환경변수에 `PUSH_DISPATCH_SECRET`을 설정한다.
2. Supabase Vault에 `chflow_push_dispatch_url`, `chflow_push_dispatch_secret`을 설정한다.
3. `20260611300000_push_dispatch_webhook.sql` migration을 적용한다.
4. Android 검증 APK에서 로그인 후 `user_push_tokens` row 생성 여부를 확인한다.
5. 테스트 알림을 만들고 `notification_push_deliveries.status`가 `sent`로 바뀌는지 확인한다.

## 로그 위치

| 대상 | 확인 위치 |
|---|---|
| Next API | Vercel deployment logs |
| Vercel Cron | Vercel project logs |
| Supabase trigger/webhook | Supabase Postgres logs, `net._http_response` |
| Push delivery 결과 | `notification_push_deliveries` |
| Expo native runtime | `npx expo start`, Android logcat, EAS build logs |

pg_net 실패 확인:

```sql
select *
from net._http_response
where status_code >= 400 or error_msg is not null
order by created desc;
```

## 장애 대응 Runbook

### 웹 알림은 오지만 OS 푸시가 오지 않음

1. `user_push_tokens.enabled = true` row가 있는지 확인한다.
2. `notification_push_deliveries`에 queued row가 생기는지 확인한다.
3. Vercel `PUSH_DISPATCH_SECRET`과 Supabase Vault `chflow_push_dispatch_secret` 일치 여부를 확인한다.
4. `/api/mobile/push-dispatch`를 수동 호출해 `sent/failed` 결과를 확인한다.
5. Expo token이 무효면 해당 token을 비활성화한다.

### 알림 클릭 시 이동하지 않음

1. `notifications.link_url` 값이 앱 내부 경로인지 확인한다.
2. Expo push payload의 `data.linkUrl` 포함 여부를 확인한다.
3. Android 검증 APK에서 알림 클릭 로그를 확인한다.

### Realtime 지연

1. `notifications`가 `supabase_realtime` publication에 포함되어 있는지 확인한다.
2. 웹은 polling backup이 있으므로 목록 갱신 여부를 먼저 확인한다.

## 백업 및 복구

- Supabase 자동 백업 정책을 운영 기준으로 확인한다.
- migration 파일은 Git에 보관한다.
- 대량 작업 전 SQL export 또는 Supabase backup snapshot을 확보한다.
- 복구 후 `notifications`, `user_push_tokens`, `notification_push_deliveries` trigger/RLS를 재검증한다.
