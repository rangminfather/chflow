# shared/ — 웹과 공유하는 메신저 데이터 계약 (⚠️ 임시 이식 방식)

이 디렉터리는 **임시 방식**입니다.

- 원본: `chflow-app/lib/messenger.ts` (Next.js 웹앱)
- 현재는 그 RPC 계약(타입 + RPC 래퍼)을 **복제 이식**했습니다.
- **RPC 계약(함수명·파라미터·반환형)을 임의로 바꾸지 마세요.** 바꾸면 웹과 분기되어 깨집니다.
- 웹 `lib/messenger.ts`가 변경되면 여기도 **수동 동기화**가 필요합니다.

## 차이점 (의도적)
- 웹: 모듈 싱글톤 `supabase`를 import해서 사용.
- 데스크톱: 클라이언트를 **주입**받는 팩토리 `createMessengerApi(client)` 형태.
  (Supabase 클라이언트 생성 옵션이 웹/데스크톱에서 다르기 때문 — 데스크톱은 custom secure storage 어댑터 사용.)

## 후속 계획 (안정화 이후, 별도 단계)
1. 현재 Supabase 스키마에서 `supabase gen types`로 DB 타입 생성 → 수기 타입 대체 검토.
2. 웹/데스크톱이 함께 import하는 실제 공통 패키지(`packages/messenger-core`)로 추출.
   - 이때 웹 `lib/messenger.ts`도 그 패키지를 쓰도록 리팩터(별도 승인 필요).

## 드리프트 점검
RPC 함수명 집합이 웹과 동일한지 확인하는 스크립트는 후속 단계에서 추가 예정
(`scripts/check-shared-drift.mjs`).
