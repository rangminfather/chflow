# 배포 및 릴리스 상태

마지막 검증: 2026-07-27 (Asia/Seoul)

이 문서는 파일 경로만 보고 작업 상태를 추측하는 일을 막기 위한 공용 인수인계 기록입니다. 상태를 평가할 때는 반드시 실제 diff 및 서비스 조회 결과와 함께 확인합니다.

## 현재 상태

- 웹: Vercel 운영 배포 완료
  - 운영 URL: `https://chflow-app.vercel.app`
  - 배포 ID: `dpl_4jTzSd8vRTkHK5j6kP8crnGJCiw8`
- DB: Supabase 원격 마이그레이션 적용 확인
  - `20260718100000_absence_alert_summary_and_recognition.sql`
- Android 테스트 빌드:
  - versionCode: `15`
  - EAS build ID: `81b8d37d-4b7d-4c47-9997-b5bee4ee53fd`
  - 빌드 상태: `FINISHED`
  - Google Play 비공개 테스트 제출: 성공
- Android 정식 릴리스:
  - 다음 versionCode: `16`
  - 프로덕션 제출 설정: `releaseStatus: draft`
  - 상태: 아직 빌드/제출하지 않음

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

1. 커밋된 현재 소스에서 Android versionCode 16 프로덕션 빌드
2. Google Play 프로덕션 트랙에 `draft`로 자동 제출
3. Play Console에서 사용자가 최종 검토 후 수동 출시
