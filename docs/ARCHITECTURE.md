# Architecture

## 전체 구조

```mermaid
flowchart LR
  User[Web/PWA User] --> Web[chflow-app Next.js]
  Android[Android User] --> Expo[chflow-expo WebView]
  Expo --> Web
  Web --> Supabase[(Supabase PostgreSQL/Auth/Storage)]
  Supabase --> Realtime[Supabase Realtime]
  Realtime --> Web
  Supabase --> Queue[notification_push_deliveries]
  Queue --> PgNet[pg_net async webhook]
  PgNet --> Dispatch[/api/mobile/push-dispatch]
  Dispatch --> ExpoPush[Expo Push API]
  ExpoPush --> Android
```

## 데이터 흐름: 알림

1. 업무 RPC/API가 `public.notifications` row를 생성한다.
2. 웹/PWA는 Supabase Realtime `postgres_changes` 구독으로 즉시 반영한다.
3. DB trigger가 활성 push token 기준으로 `notification_push_deliveries` row를 만든다.
4. 새 delivery row가 생기면 Supabase `pg_net`이 Next API `/api/mobile/push-dispatch`를 비동기 호출한다.
5. Next API가 Expo Push API로 전송하고 delivery 상태를 `sent` 또는 `failed`로 갱신한다.
6. Android 사용자가 알림을 누르면 `chflow-expo`가 payload의 `linkUrl`을 WebView에 전달한다.

## 주요 컴포넌트

| 컴포넌트 | 역할 |
|---|---|
| `chflow-app/app` | 웹 화면과 API Route |
| `components/NotificationBell.tsx` | 웹 알림 목록, 토스트, unread count |
| `components/GlobalNotifications.tsx` | 전역 알림 dock mount |
| `app/api/mobile/push-token` | Expo push token 등록 |
| `app/api/mobile/push-dispatch` | queued delivery를 Expo Push API로 발송 |
| `chflow-expo/App.tsx` | WebView shell, push permission, token 등록, 알림 클릭 라우팅 |
| Supabase migrations | DB schema, RLS, RPC, trigger |

## 기술 스택 선택 이유

- Next.js: 기존 웹/PWA 화면과 서버 API를 한 프로젝트에서 유지.
- Supabase: Auth, PostgreSQL, Realtime, Storage, RLS를 같은 데이터 모델로 운영.
- Expo: WebView shell을 유지하면서 Android 알림/권한/배지 같은 native 기능을 추가.
- pg_net/Vault: DB 이벤트에서 안전하게 비동기 HTTP dispatch를 실행하고 secret을 코드 밖에 보관.
