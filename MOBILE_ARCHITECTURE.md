# Mobile Architecture Direction

## Decision

Smart Myungsung has two delivery runtimes:

1. Web/PWA
   - Source: `chflow-app`
   - Runtime: browser/PWA
   - Deployment: Vercel
2. Mobile app
   - Source: `chflow-expo`
   - Runtime: React Native Expo app
   - Current shell: React Native `WebView` loading the deployed web app
   - Distribution: Android APK/AAB and Play Store release flow

`chflow-twa` is not the current mobile release path. Treat it as legacy/reference
unless the mobile architecture decision is changed explicitly.

## Product Direction

The mobile app is not postponed until the web app is finished and then converted
from PWA to React Native. The web app remains the shared service surface, while
the Expo app remains the official mobile runtime during development.

The current pragmatic path is:

1. Continue building most product screens and business flows in `chflow-app`.
2. Keep `chflow-expo` as the official Android mobile shell throughout
   development.
3. Add native mobile capabilities in Expo when they are required.
4. Move selected screens to native React Native screens only when the mobile
   workflow needs it.

Candidate screens for later native treatment are high-frequency or mobile-native
surfaces such as notification inbox, messaging/comment flows, or home surfaces.
This is a product decision per screen, not a requirement to rewrite every web
screen before mobile release.

## Native Mobile Responsibilities

Expo owns behavior that a web deploy alone cannot validate:

- Android hardware back handling and root-exit confirmation
- Push notification permission and device token registration
- OS notification delivery and notification tap handling
- Deep-link or WebView route handoff after notification taps
- Launcher icon, native splash, status bar, Android permissions, and Play Store
  build artifacts
- Device verification for uploads, keyboard behavior, and other native shell
  interactions

## Notification Direction

Push notifications are a first-class mobile requirement.

Required outcomes include:

- notifications while the app is backgrounded or not foregrounded
- Android status-bar and lock-screen notifications
- user-visible message/answer/notice alerts similar to common messaging apps
- opening the relevant app route when a notification is tapped

Recommended shared model:

1. The backend stores notification rows and unread/read state for web and mobile.
2. The Expo app requests notification permission and registers device push
   tokens for the signed-in user.
3. Server-side notification events send push messages to registered mobile
   devices.
4. The Expo shell handles notification taps and opens the matching route in the
   mobile app/WebView.
5. The PWA/web app still exposes notification inbox and read-state UI where
   needed.

Start with user-visible push notifications. Silent/background sync is a separate
feature with stricter OS constraints and should be designed only when a concrete
workflow requires it.

## Development Rules

- A Vercel deploy verifies `chflow-app` web/PWA behavior.
- A Vercel deploy does not verify Expo/native behavior.
- Changes involving back handling, notification delivery, notification taps,
  native permissions, launcher assets, or Play Store binaries require Expo
  device verification.
- Keep web routing compatible with the mobile WebView shell, especially entry
  history and notification target routes.
- Do not build or install `chflow-twa` as the normal Android test artifact.
  `chflow-twa` and `chflow-expo` currently share the Android package id, so a
  TWA APK can replace the Expo shell on a device and remove Expo-native behavior.

## Verification Cadence

During feature development:

- verify normal product flow in the web app
- periodically install an Expo verification APK on a real Android device
- run mobile checks immediately after changes to routing, login/session flow,
  back handling, uploads, notifications, or native assets

Before mobile release:

- build from `chflow-expo`
- verify real-device login/session flow
- verify root back handling and exit confirmation
- verify notification permission, delivery, status-bar display, tap routing, and
  unread/read state
- verify launcher icon, splash, uploads, and required permissions

