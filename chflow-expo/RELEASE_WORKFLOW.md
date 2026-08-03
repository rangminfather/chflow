# Android release workflow

Version names are human-controlled. A release commit must update `package.json`,
`app.json`, and the matching non-empty `release-notes/vX.Y.Z.md` file. The CI
workflow never edits or commits version files.

Preview and prepare a release locally:

```bash
npm run release:preview -- patch --note "메시지 안정성을 개선했습니다."
npm run release:patch -- --note "메시지 안정성을 개선했습니다."
```

Review the generated files and commit the release. The commit on `main` starts
`.github/workflows/android-release.yml`, which performs the following checks:

- `package.json.version` and `expo.version` are valid and equal.
- `release-notes/vX.Y.Z.md` exists and is non-empty.
- `expo.android.versionCode` and `expo.ios.buildNumber` are absent.
- EAS uses remote app versioning, production auto-increment, and an Android app bundle.
- The new version is greater than the previous commit's version.
- `scripts/verify-production-submit.mjs` accepts the production submit configuration.

If the version is unchanged, the workflow succeeds without building. A manual
`workflow_dispatch` with `dry_run: true` runs the same checks and skips the
build.

For a new version, CI runs:

```bash
npx eas-cli@latest build --platform android --profile production \
  --auto-submit --non-interactive --no-wait
```

The EAS production submit profile targets the Google Play `production` track
with `releaseStatus: draft`. EAS completes the cloud build and draft upload;
the workflow does not wait for the build and never publishes the release.
Android `versionCode` is owned by EAS remote versioning. With the current
remote counter at `40`, the next production build receives `41`.

The only manual Play step is pressing the Play Console release button. The
separate `.github/workflows/android-play-sync.yml` runs every three hours (or
on demand), reads the production track, and detects a `completed` release with
no `userFraction`, which represents a 100% rollout. It then:

1. Reads the production `LATEST_ANDROID_BUILD` variable from Vercel.
2. Updates that variable only when the Play versionCode is greater.
3. Leaves `MIN_ANDROID_BUILD` untouched.
4. Calls the Vercel Deploy Hook so the new environment value is deployed.
5. Verifies `https://smartms.kr/api/app-config` for up to five minutes.

The Play sync creates and deletes a temporary Play API edit solely to read the
track. It must never call `edits.commit`.

## Required GitHub Actions secrets

Create these in the repository settings; values are intentionally not stored in
this repository:

- `EAS_TOKEN`: Expo access token for starting the EAS build.
- `PLAY_SERVICE_ACCOUNT_JSON`: a new read-only Play service account, separate
  from the EAS submission account. Start with app information read-only access;
  the first sync rehearsal must verify whether the temporary edit-session API
  calls are accepted for that role.
- `VERCEL_TOKEN`: token used by the sync job to read and update project env.
- `VERCEL_PROJECT_ID`: the `chflow-app` Vercel project ID.
- `VERCEL_TEAM_ID`: required only if the project belongs to a team.
- `VERCEL_DEPLOY_HOOK_URL`: a `main` Deploy Hook for `chflow-app`.

The EAS submission service account is already stored in EAS credentials, so no
service-account file is needed in `eas.json` for `--auto-submit`. The CI still
needs `EAS_TOKEN` for the EAS CLI invocation.

The CI pins EAS CLI `21.4.0` rather than using `@latest`. Update this pin only
as an intentional reviewed change; the existing local release scripts retain
their current `@latest` behavior for now.

The [official API reference](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/insert)
documents the broad `androidpublisher` OAuth scope for `edits.insert`,
`edits.tracks.get`, and `edits.delete`, but it does not establish that Play
Console's read-only app permission allows creating and deleting an edit
session. [Play Console defines read-only access](https://support.google.com/googleplay/android-developer/answer/10019561)
as not allowing changes. Therefore the first sync run must measure this; a 403
requires either a narrowly expanded Play role or reuse of the existing EAS
submission account, with the security trade-off recorded.

## Activation and rehearsal order

`workflow_dispatch` appears in the Actions UI only after this workflow exists
on the repository's default branch. Register the secrets before merging, then:

1. Merge the reviewed PR after registering all six GitHub Actions secrets.
2. Run `android-play-sync` once with `workflow_dispatch`. With Play versionCode
   `40` and the user-confirmed Vercel value `40`, expect a no-op summary stating
   that the public value is current. A 403 at this point confirms a Play-role
   issue and should be resolved before the first release.
3. Run `android-release` with `dry_run: true`; it must validate and skip EAS.

If `/api/app-config` cannot be read, the sync job fails without redeploying so
the next scheduled run can retry with an observable public state. If the
public value differs from Play, every later run retries the Deploy Hook even
when the Vercel environment variable already contains the Play version. If the
public value is ahead of Play during a staged rollout or manual update, sync
leaves the newer public value alone and does not attempt to roll it back.

## Preflight before the first EAS cloud release

The EAS Android build credential currently reports this SHA-256 certificate
fingerprint:

```text
CF:77:B7:45:CC:7D:04:28:9A:BC:0A:85:99:59:CC:FB:6B:A3:6A:EA:9F:CD:0A:CE:66:29:67:3A:06:0E:E8:E7
```

The local 1.1.10 Gradle project reads the same `credentials/android/keystore.jks`
through `credentials.json`, and its certificate fingerprint matches the EAS
fingerprint above. That AAB was accepted by Google Play as production
versionCode `40`, so the Play upload key and the next EAS cloud-build key are
aligned by the successful upload path. If the Play upload key is ever rotated,
repeat this comparison before the next cloud build.
