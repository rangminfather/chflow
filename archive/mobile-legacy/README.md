# Mobile Legacy Archive

This folder is intentionally not part of the current Android release path.

Current mobile release path:

- Source: `../../chflow-expo`
- Verify build: `cd ../../chflow-expo && eas build -p android --profile verify`
- Play Store build: `cd ../../chflow-expo && eas build -p android --profile production`

Archived here:

- `chflow-twa/`: old Android TWA Gradle project. It shares the Android package id `com.smartmyungsung.app` with the Expo app, so installing its APK can replace the current Expo shell on a test device.
- `play-store-assets/`: old Play Store upload/test artifacts and listing assets retained for reference.

Use these files only for historical comparison or asset recovery. Do not build or upload from this archive unless the mobile architecture decision changes explicitly.
