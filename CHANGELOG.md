# Changelog

이 프로젝트는 날짜 기반 변경 이력을 사용합니다. 커밋 메시지는 가능하면 Conventional Commits 형식을 따릅니다.

권장 커밋 예시:

- `feat(notification): dispatch mobile push from Supabase queue`
- `fix(profile): restrict position avatar update scope`
- `docs(api): document mobile push endpoints`
- `chore(db): add push dispatch webhook migration`

## 2026-06-11

### Fixed

- Vercel Preview 빌드에서 Supabase 환경변수가 없을 때 prerender 단계가 실패하던 문제를 방지.
- Supabase browser/admin client 생성을 모듈 import 시점이 아니라 실제 사용 시점으로 지연.

### Added

- Android Expo 알림 클릭 시 WebView를 `linkUrl`로 이동하는 처리 추가.
- Expo Push payload에 unread badge count 포함.
- `notification_push_deliveries` INSERT 후 Supabase DB에서 push dispatch API를 비동기 호출하는 migration 추가.
- 프로젝트 README, 환경 설정, 아키텍처, API, DB, 운영 문서 추가.

### Notes

- 실시간 웹 알림은 기존 Supabase Realtime 구독을 유지한다.
- 앱이 꺼진 상태의 OS 푸시는 `PUSH_DISPATCH_SECRET`과 Supabase Vault secret 설정 후 활성화된다.
