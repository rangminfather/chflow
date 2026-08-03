# 배포 및 릴리스 상태

마지막 검증: 2026-08-03 (Asia/Seoul)

이 문서는 파일 경로만 보고 작업 상태를 추측하는 일을 막기 위한 공용 인수인계 기록입니다. 상태를 평가할 때는 반드시 실제 diff 및 서비스 조회 결과와 함께 확인합니다.

## 현재 상태

- 웹: Vercel 운영 배포 완료
  - 운영 URL: `https://chflow-app.vercel.app`
  - 배포 ID: `dpl_2p1eWBGxciFjcuZb16o9uVwFtoj9`
  - Android 강제 업데이트 하한: `MIN_ANDROID_BUILD=5`
  - 운영 API 확인값: `MIN_ANDROID_BUILD=5`, `LATEST_ANDROID_BUILD=40`
  - v1.1.10 / versionCode 40의 Play 전체 출시 이후 값으로 확인됨
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
- Android 자동 업데이트 감지 전환 릴리스:
  - versionCode: `18` (`17`은 재시도 과정에서 번호만 선점되어 미사용)
  - 커밋: `9502640`
  - EAS build ID: `5849b464-7b2f-4411-a2e5-20e55f576b56`
  - EAS submission ID: `149d36b8-b578-4d41-a3fe-594af6f07f94`
  - 빌드 상태: `FINISHED`
  - Google Play 프로덕션 트랙 초안 제출: `FINISHED`
  - 공개 상태: Play Console에서 정식 게시 완료
- Google Play 스토어 이미지:
  - 기능 그래픽: `chflow-expo/assets/play-store-feature-graphic-v2.png`
  - 휴대전화·7인치·10인치 스크린샷: `chflow-expo/assets/play-store/`
  - GitHub 보존 완료 후 Play Console에서 재사용 가능

## 완료되어 커밋된 변경

- `c12fae0` — 알림 중복 방지, 장기 미출석 알림 정리, 웹↔네이티브 배지 동기화
  - 2026-07-28 확인 당시 Codex 브랜치에는 커밋됐지만 `main`에는 미반영이었음. 원격 DB 마이그레이션은 적용된 반쪽 상태였으며, 코드는 `main`에 `76d8129`로 반영함.
- `8ee1fe3` — 유아부 출결 통합화면을 목장 기준으로 정렬
- `97a82c5` — 주보 이미지 첨부를 PDF로 정상화
- `d7b8cff` — EAS 내부/프로덕션 제출 프로필 및 Expo 패치 버전 정리

위 변경은 미완성 타작업이 아니며, 기능별 검증 후 커밋된 완료 작업입니다.

## 범위에서 제외된 로컬 항목

- `depoly(android)/` — 로컬 AAB 보관 폴더
- `pastor-intro-site/` — 별도 중첩 Git 프로젝트

위 두 경로는 chflow 메인 릴리스에 포함하지 않습니다.

## 다음 릴리스 절차

1. 사람이 `chflow-expo`에서 버전과 릴리스 노트를 작성·커밋한다.
2. `android-release.yml`이 기준선 검증 후 EAS Android App Bundle을 빌드하고 Google Play 프로덕션 초안으로 자동 제출한다.
3. 사람은 Play Console에서 초안을 최종 검토하고 수동 출시한다.
4. `android-play-sync.yml`이 최대 3시간 이내에 100% 출시를 감지해 `LATEST_ANDROID_BUILD`만 갱신하고 Vercel Deploy Hook으로 재배포한다.
5. `MIN_ANDROID_BUILD`는 긴급 강제 업데이트가 필요할 때만 사람이 변경한다.

## 2026-07-27 production deployment record

- Production commit: `0d0dedf` (`refactor(quality): add checks and split messenger overlays`)
- Web build: completed successfully with Next.js 16.2.10 after compile, TypeScript, static generation, and route finalization.
- Production URL check: `https://chflow-app.vercel.app` returned HTTP 200 at 2026-07-27 20:34 Asia/Seoul.
- Scope: lint/test/typecheck quality gate; messenger overlay separation; no database migration or Android build.
## 2026-07-27 production deployment record

- Production commit: `a502fe6` (`refactor(messenger): extract read status presentation`)
- Web build: completed successfully with compile, TypeScript, static generation, and route finalization.
- Production URL check: `https://chflow-app.vercel.app` returned HTTP 200 at 2026-07-27 21:55 Asia/Seoul.
- Scope: messenger read-status presentation and shared avatar separation; no database migration or Android build.

## 2026-07-27 production deployment record

- Production commit: `f684966` (`refactor(quality): split composer and test signup directory logic`)
- Web build: completed successfully with compile, TypeScript, static generation, and route finalization.
- Production URL check: `https://chflow-app.vercel.app` returned HTTP 200 at 2026-07-27 22:37 Asia/Seoul.
- Scope: messenger composer separation; signup and directory domain-logic extraction with unit tests; no database migration or Android build.

## 2026-07-27 production deployment record

- Production commit: `e232350` (`fix(messenger): remove stale modal style`)
- Web build: completed successfully with compile, TypeScript, static generation, and route finalization.
- Production URL check: `https://chflow-app.vercel.app` returned HTTP 200 at 2026-07-27 23:09 Asia/Seoul.
- Scope: messenger group-management modal separation; no database migration or Android build.

## 2026-07-27 production deployment record

- Production commit: `9ff6e15` (`ci(web): verify quality gates before deployment`)
- Web build: completed successfully with compile, TypeScript, static generation, and route finalization before deployment.
- Production URL check: `https://chflow-app.vercel.app` returned HTTP 200 at 2026-07-27 23:56 Asia/Seoul.
- Scope: GitHub Actions web quality gate, documented Preview workflow, and Android R8/release resource optimization configuration; no database migration.

## 2026-07-28 Android R8 release build

- Source commit: `4329653` (`build(android): enable R8 release optimization`)
- EAS build ID: `3b985c91-c20e-4140-9b25-84d03d95f157`
- Android versionCode: `21`
- Build status: `FINISHED`
- Scope: R8 code shrinking and unused-resource shrinking enabled for release builds.
- Google Play production draft submission: Google Play API reported that versionCode `21` had already been submitted when a manual resubmission was attempted on 2026-07-28. Play Console processing or draft visibility may lag; verify the versionCode in Play Console before publishing.

## 2026-07-28 Android v1.0.1 update-prompt release

- Source commit: `b6fe4f2` (`release(android): prepare v1.0.1`)
- EAS build ID: `5e33534f-e392-48ec-9b60-50c1665b7e19`
- Android versionCode: `22`
- Build status: `FINISHED`
- Scope: optional-update prompt moved to the top safe area below the status bar/punch-hole; force-update blocking behavior unchanged.
- Submission: production profile uses automatic Play draft submission after a successful AAB build; Play Console publication remains manual.

## 2026-07-28 Android v1.0.2 notification reliability release

- Source commits: `76d8129` (`fix(notifications): deduplicate delivery and sync app badge`), `2f8b150` (`release(android): prepare v1.0.2`)
- EAS build ID: `52c68400-f273-4d04-b5d9-a67ef155f22b`
- Android versionCode: `23`
- Build status: `FINISHED`
- Scope: conditional claim before push delivery prevents duplicate sends; web notification state synchronizes the native launcher badge; absence-alert migration source is now aligned with the already-applied remote migration.
- Submission: Play Console production promotion confirmed by the user on 2026-07-28. VersionCode `23` is now the production release.

## 2026-07-29 location-based attendance foundation

- Main merge commit: `1e3ac2e` (`feat(attendance): add location-based attendance flow`)
- Follow-up migration fix/history commit: `ec2e95a`
- Scope: member geofence candidates, server-side dwell confirmation, leader overview, geofence settings, Android/iOS permission and background event wiring.
- Supabase migration: `20260729100000_member_geofence_attendance_foundation.sql` applied successfully to project `klsrjvvdwtofialqknng`.
- Supabase lint: existing unrelated errors remain in `admin_review_safe_auto_cleanup` and `admin_review_safe_auto_cleanup_v2`; no attendance migration error was reported.
- Web build: successful with placeholder build-time Supabase variables; Vercel production deployment follows the `main` push.

## 2026-07-29 v1.1.0 mobile build

- Release commit: `e120115` (`release(android-ios): prepare v1.1.0 automatic attendance`)
- Release name: `v1.1.0 — 기능 및 사용성 개선`
- Android EAS build ID: `f150c06e-374a-4da9-b899-3e9c5f5aacda`
- Android versionCode: `24`
- Android build status: `FINISHED` (artifact: `https://expo.dev/artifacts/eas/Kg7R3NGComhogBV2le5wWW_mHPbLl1kyXfZkvzrXwak.aab`)
- Android submission ID: `03d4969b-fbe6-49d1-a906-f3982dcb77a0`
- Android submission status: scheduled to Google Play production track with `releaseStatus: draft`; Play Console processing/visibility pending.
- iOS build: not submitted; EAS reported that the Apple distribution certificate is not set up for non-interactive builds. Interactive Apple credential setup is required before retrying.

## 2026-07-29 v1.1.1 disclosure patch

- Source commit: `c7bce4d` (`fix(android): disclose background location before permission`)
- Scope: shows an explicit in-app background-location disclosure before requesting native location permissions.
- Android EAS build ID: `ffe34617-f514-4326-a6ff-6af18ef0a6d4`
- Android versionCode: `25`
- Build status: `FINISHED`
- Artifact: `https://expo.dev/artifacts/eas/9FpXBrpk2voMTihdANfbzONhMyiP4nIlWBKWnTjkVtg.aab`
- Internal-test submission ID: `575326cd-9453-4ccf-b98f-9f60d037a877`
- Internal-test track submission: scheduled with `releaseStatus: completed`; Play processing and tester availability pending.
- Production submission: not started; record the Play policy demonstration video before requesting production review.

## 2026-07-29 iOS v1.1.1 builds

- EAS build ID: `fb9c1c94-0309-4eb8-ae96-cd5dbc04ef84` (build number `5`)
- EAS build ID: `bcc72211-65a8-4516-ba4f-877da6b09c25` (build number `6`, latest)
- Build status: `FINISHED`
- Latest artifact: `https://expo.dev/artifacts/eas/mV1NJtxSt9NDbRKZp3mXhKEqsl-S85lim-UEOZeByQU.ipa`
- Apple distribution certificate, provisioning profile, and push key configured successfully.
- TestFlight submission: not started.

## 2026-07-29 sermon fullscreen web fix

- Production commit: `6ccac83` (`fix(sermon): wire fullscreen button to video element`)
- Scope: connects the custom fullscreen button to the video element and removes the unsupported automatic fullscreen call on iOS.
- Verification: `chflow-app` TypeScript check passed; `https://smartms.kr` returned HTTP 200 after the main push.
- Mobile rebuild: not required; the WebView loads this web fix from the deployed site.

## 2026-08-03 Android release baseline reconciliation

- Google Play production active release: versionName `1.1.10`, versionCode `40`.
- Google Play release date: 2026-08-03; rollout: 100% complete.
- The published AAB was not produced by an EAS cloud build. It was built from the local Gradle project in `C:\csh\chflow-android-1.1.8` and copied to `C:\Users\최성헌\Desktop\build\스마트명성-Android-AAB-1.1.10\smartms-1.1.10-play.aab`.
- The AAB build inputs were `versionName "1.1.10"` and `versionCode 40`.
- `chflow-expo/.gitignore:54` excludes `/android`; the prebuild-generated native directory remains untracked and is not part of the managed workflow source.
- EAS Android remote versionCode was reset from `39` to `40` on 2026-08-03. The next production auto-increment build should therefore use versionCode `41`.

### Release baseline history v1.1.2-v1.1.10

- v1.1.2: release baseline commit `4938c2c`; EAS Android build `7559429c-063f-4891-8a52-d0bc50352151`, versionCode `32`, finished internal-test build.
- v1.1.3: release baseline commit `d33444d`; EAS Android build `582c5c12-9b49-4484-ae62-5cb1aabb3174`, versionCode `33`, finished internal-test build.
- v1.1.4: release baseline commit `1ab70d3`; no separate v1.1.4 EAS Android build record was found in `@rangminfather/chflow-expo`.
- v1.1.5: EAS Android build `c87d3bfc-127f-4ee2-a36a-53e99b6af3df`, versionCode `34`, finished build.
- v1.1.6: release commit `d584a92`; EAS Android build `ae2e0de6-01b9-4044-b727-fcf3bd4d5974`, versionCode `35`, finished build.
- v1.1.7-v1.1.10: local Gradle builds from the Android worktree, not EAS cloud builds; the local versionCode sequence was `37`, `38`, `39`, `40` respectively.
- v1.1.10: source commit `dcf42f7`; local AAB versionCode `40`; Google Play production rollout completed at 100%.

### Unresolved Android version counter history

- The EAS build list contains no cloud build records for versionCode `36` through `40`.
- The reason versionCode `36` was consumed, and the exact path by which the EAS remote counter reached `39`, could not be confirmed from the available EAS audit history. This remains unresolved.
- The local `android.versionCode` values used by the v1.1.7-v1.1.10 Gradle worktree are separate from the EAS remote version source.

## 2026-08-03 Android release automation

- Pipeline implementation is included in the Codex PR branch `codex/android-release-pipeline`; merge review is required before activation.
- Version names remain human-controlled. CI does not increment, edit, or commit version files or release notes.
- `.github/workflows/android-release.yml` validates the version baseline, builds the Android app bundle with EAS, and requests a Google Play production-track draft with `releaseStatus: draft`.
- `.github/workflows/android-play-sync.yml` polls every three hours, detects a 100% completed Play production release, updates only `LATEST_ANDROID_BUILD`, calls the Vercel Deploy Hook, and verifies `/api/app-config`.
- `MIN_ANDROID_BUILD` is intentionally never changed by the pipeline.
- The Play sync uses a temporary read-only Play API edit and deletes it; it never calls `edits.commit`.
- Required GitHub Actions secret names (values excluded): `EAS_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID`, and `VERCEL_DEPLOY_HOOK_URL`.
- EAS credentials inspection confirmed the existing Play submission account `eas-submit@smart-myungsung-play-submit.iam.gserviceaccount.com` and the current EAS Android keystore. The new Play polling account must remain separate and read-only.
- EAS Android keystore SHA-256 fingerprint: `CF:77:B7:45:CC:7D:04:28:9A:BC:0A:85:99:59:CC:FB:6B:A3:6A:EA:9F:CD:0A:CE:66:29:67:3A:06:0E:E8:E7`.
- Local 1.1.10 Gradle signing was verified to read `credentials/android/keystore.jks`; its SHA-256 fingerprint exactly matches the EAS fingerprint above. Because that AAB was accepted and released by Google Play as versionCode `40`, the Play upload key and the next EAS cloud-build key are aligned. Repeat the comparison if the Play upload key is rotated.
