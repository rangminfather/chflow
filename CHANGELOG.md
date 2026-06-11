# Changelog

이 프로젝트는 날짜 기반 변경 이력을 사용합니다. 커밋 메시지는 가능하면 Conventional Commits 형식을 따릅니다.

권장 커밋 예시:

- `feat(notification): dispatch mobile push from Supabase queue`
- `fix(profile): restrict position avatar update scope`
- `docs(api): document mobile push endpoints`
- `chore(db): add push dispatch webhook migration`

## 2026-06-11

### Fixed

- 내 정보에서 등록 이메일을 현재 비밀번호 확인 후 변경할 수 있게 하고, 긴 이메일 저장 토스트가 모바일 화면 밖으로 벗어나지 않도록 조정.
- 내 정보의 이메일 등록이 `@smartms.app` 가상 로그인 이메일과 충돌해 실패하던 문제를 수정하고, 사용자명 로그인과 비밀번호 찾기 메일 발송이 실제 등록 이메일과 함께 동작하도록 인증 흐름을 보정.
- 메인 화면과 내 정보의 직분 아바타 구도를 얼굴 중심에 가깝게 보이도록 미세 조정.
- 프로필 사진 업로드가 요람 원본 사진(`members.photo_url`)을 덮어쓰지 않도록 DB 함수와 보호 트리거를 보강하고, 최성헌 요람 사진을 원본 `profile.png`로 복구.
- 내사진 등록에서 사용자 사진(`avatar_url`) 상태를 기준으로 요람 사진 복귀 버튼이 표시되도록 수정.
- 학생관리 메뉴에 복습문제 보기 화면을 추가해 복습문제 관리에서 올린 PPTX 파일을 열람할 수 있도록 함.
- 전역 헤더 교회 아이콘이 아이콘 파일 변경 후에도 지정 영역을 최대 비율로 채우도록 크기 기준을 고정.
- DB에 등록되지 않은 일반 회원가입자는 성도 (남), 성도 (여)만 선택하고, 자녀 회원가입자는 다음세대 직분만 선택하도록 UI/API 제한 보강.

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
