# 배포 및 릴리스 상태

마지막 검증: 2026-07-27 (Asia/Seoul)

이 문서는 파일 경로만 보고 작업 상태를 추측하는 일을 막기 위한 공용 인수인계 기록입니다. 상태를 평가할 때는 반드시 실제 diff 및 서비스 조회 결과와 함께 확인합니다.

## 현재 상태

- 웹: Vercel 운영 배포 완료
  - 운영 URL: `https://chflow-app.vercel.app`
  - 배포 ID: `dpl_E736xX8p5CUyQdCptptNkoCkqxhb`
  - Android 강제 업데이트 하한: `MIN_ANDROID_BUILD=5`
  - 전환용 최신 버전 설정: `LATEST_ANDROID_BUILD=16`
- DB: Supabase 원격 마이그레이션 적용 확인
  - `20260718100000_absence_alert_summary_and_recognition.sql`
- Android 테스트 빌드:
  - versionCode: `15`
  - EAS build ID: `81b8d37d-4b7d-4c47-9997-b5bee4ee53fd`
  - 빌드 상태: `FINISHED`
  - Google Play 비공개 테스트 제출: 성공
- Android 정식 릴리스:
  - versionCode: `16`
  - EAS build ID: `07b993de-98cc-4ad5-86e9-13a16d031b51`
  - EAS submission ID: `78106d37-87b3-4a94-b01a-075da1991e2c`
  - 빌드 상태: `FINISHED`
  - 프로덕션 제출 설정: `releaseStatus: draft`
  - Google Play 프로덕션 트랙 제출: 성공
  - 공개 상태: 정식 출시됨

## 완료되어 커밋된 변경

- `c12fae0` — 알림 중복 방지, 장기 미출석 알림 정리, 웹↔네이티브 배지 동기화
- `8ee1fe3` — 유아부 출결 통합화면을 목장 기준으로 정렬
- `97a82c5` — 주보 이미지 첨부를 PDF로 정상화
- `d7b8cff` — EAS 내부/프로덕션 제출 프로필 및 Expo 패치 버전 정리

위 변경은 미완성 타작업이 아니며, 기능별 검증 후 커밋된 완료 작업입니다.

## 범위에서 제외된 로컬 항목

- `depoly(android)/` — 로컬 AAB 보관 폴더
- `pastor-intro-site/` — 별도 중첩 Git 프로젝트

위 두 경로는 chflow 메인 릴리스에 포함하지 않습니다.

## 다음 릴리스 절차

1. `chflow-expo`에서 `npm run release:android`
   - EAS가 versionCode를 자동 증가
   - Android App Bundle 빌드
   - Google Play 프로덕션 트랙 초안으로 자동 제출
2. Play Console에서 초안을 최종 검토하고 수동 출시
3. Android 일반 업데이트는 앱이 Google Play의 실제 공개 버전을 직접 감지
   - 매 릴리스마다 Vercel `LATEST_ANDROID_BUILD`를 변경할 필요 없음
   - `MIN_ANDROID_BUILD`는 긴급 강제 업데이트가 필요할 때만 변경
