# API and Interface Reference

## 인증

대부분의 사용자 API는 Supabase session JWT를 사용합니다.

```http
Authorization: Bearer <supabase_access_token>
```

운영성 API는 별도 secret을 사용합니다.

```http
Authorization: Bearer <PUSH_DISPATCH_SECRET|CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY>
```

## POST `/api/mobile/push-token`

Expo 앱이 로그인 사용자의 push token을 등록합니다.

Request:

```json
{
  "expoPushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "android",
  "deviceId": "device-session-id",
  "appId": "smart-myungsung"
}
```

Response:

```json
{
  "ok": true,
  "token_id": "uuid",
  "last_seen_at": "2026-06-11T00:00:00.000Z"
}
```

Errors:

| HTTP | 코드/메시지 | 처리 |
|---|---|---|
| 401 | `Unauthenticated` | Expo WebView session token 재전송 |
| 400 | `Invalid Expo push token` | token 발급 로직 확인 |
| 400 | `Invalid platform` | `android`, `ios`, `web` 중 하나 사용 |
| 500 | Supabase error | 서버 로그와 DB 권한 확인 |

## GET/POST `/api/mobile/push-dispatch`

queued/failed delivery를 Expo Push API로 전송합니다. Supabase `pg_net` webhook 또는 운영자가 호출합니다.

Query:

| 이름 | 기본값 | 설명 |
|---|---:|---|
| `limit` | `100` | 한 번에 처리할 delivery 수, 최대 500 |

Response:

```json
{
  "ok": true,
  "picked": 3,
  "sent": 3,
  "failed": 0
}
```

Errors:

| HTTP | 메시지 | 처리 |
|---|---|---|
| 401 | `Unauthorized` | secret 또는 Vercel env 확인 |
| 500 | Supabase select/update error | service role key와 테이블 schema 확인 |

## Supabase Realtime Interface

클라이언트는 `public.notifications` INSERT 이벤트를 사용자별로 구독합니다.

```ts
supabase
  .channel(`notif:${userId}`)
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "notifications",
    filter: `user_id=eq.${userId}`,
  }, handleNewNotification)
  .subscribe();
```

Realtime이 지연될 경우를 대비해 웹 컴포넌트는 주기적 polling 백업도 유지합니다.
