# iOS App Store update automation

The native shell checks `https://chflow-app.vercel.app/api/app-config` at cold
start and whenever the app returns to the foreground. Checks are throttled for
one minute and time out after five seconds. Network errors, timeouts, and
invalid version values fail open so the WebView remains usable.

## Version policy

- `LATEST_IOS_VERSION` is the version currently visible in the KR App Store.
  The automation is allowed to update only this value. An installed version
  below it sees a dismissible update banner.
- `MIN_IOS_VERSION` is the oldest version allowed to use the app. It is never
  read or changed by the automation. An administrator changes it manually only
  for a confirmed security, outage, or compatibility requirement. An installed
  version below it sees a blocking update screen.
- The app compares `Application.nativeApplicationVersion`
  (`CFBundleShortVersionString`), not the iOS build number. Numeric components
  are compared, so `1.1.9 < 1.1.10` and `1.2 == 1.2.0`.

The update button first opens
`itms-apps://apps.apple.com/app/id6795782758` and falls back to
`https://apps.apple.com/kr/app/id6795782758`.

## Release detection

`.github/workflows/ios-app-store-sync.yml` runs every 15 minutes. GitHub cron
expressions use UTC; this particular expression runs every 15 minutes in all
timezones. The job reads App Store ID `6795782758` from the KR storefront and
verifies bundle ID `com.smartmyungsung.app`. It does not use App Store Connect
state or credentials, so `LATEST_IOS_VERSION` changes only after the version is
actually returned by the public KR App Store.

When the detected version differs, the script updates the Production-scoped
`LATEST_IOS_VERSION`, invokes the existing Git Integration Deploy Hook, and
retries the public app-config check for at most five minutes. A matching version
is an idempotent no-op with no deployment. `MIN_IOS_VERSION` is never queried or
changed.

Required GitHub Actions secrets:

- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID` only when the project belongs to a Vercel team
- `VERCEL_DEPLOY_HOOK_URL`, configured for the `main` Git Integration branch

Required Vercel Production variables:

- `LATEST_IOS_VERSION` (initially `1.1.12`)
- `MIN_IOS_VERSION` (initially `1.1.12`; administrator-controlled thereafter)

No workflow or script performs a direct Vercel Production deployment, promote,
rollback, or alias operation. The Deploy Hook requests a normal Git Integration
deployment after this change has been merged to `main`.

## Operation and rehearsal

From GitHub, open **Actions → Sync released iOS version to Vercel → Run
workflow**. Select `dry_run` for a read-only rehearsal. A normal manual run uses
the same path as the schedule. The Step Summary records the detected store
version, prior server and Vercel values, whether the variable changed, whether
the Deploy Hook ran, and whether the public API was verified.

Before raising `MIN_IOS_VERSION`:

1. Confirm the target version is visible in the KR App Store on a non-developer
   Apple account.
2. Run the sync workflow and confirm the public `latest_ios_version` matches.
3. Install/update that version on a physical iPhone and verify login and the
   affected critical flow.
4. Change `MIN_IOS_VERSION` manually, trigger the Git Integration Deploy Hook,
   and verify `/api/app-config` before monitoring older clients.

If Store lookup, Vercel, or app-config verification fails, the workflow exits
non-zero. If the app itself cannot read valid configuration, it allows normal
use rather than blocking the user.

## First-release limitation

Version `1.1.12` does not contain the iOS update-check code. If this feature is
first shipped in `1.1.13`, users still on `1.1.12` cannot receive an in-app
prompt for `1.1.13`; they must update through the App Store. Once `1.1.13` is
installed, those users can receive the automated prompt for `1.1.14` and later.
