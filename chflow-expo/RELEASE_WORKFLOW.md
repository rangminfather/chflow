# Android release workflow

Choose the release level before building:

- `patch`: bug fixes, stability, performance, and internal maintenance.
- `minor`: user-visible features or meaningful workflow improvements.
- `major`: compatibility-breaking or substantially redesigned releases.

Preview the next release without modifying files:

```bash
npm run release:preview -- patch --note "메시지 안정성을 개선했습니다."
```

Prepare a release after approving the displayed name and notes:

```bash
npm run release:patch -- --note "메시지 안정성을 개선했습니다." --note "앱 성능과 메모리 사용을 최적화했습니다."
```

The command synchronizes `package.json` and `app.json`, and records the exact Play release name and notes in `release-notes/vX.Y.Z.md`. Review and commit those files, then build the AAB:

```bash
npm run release:android
```

After the build succeeds, submit the latest build explicitly to the Play production track:

```bash
npm run release:android:submit
```

The submit command checks that no internal submit profile exists and that the Android track is explicitly `production`. Play Console publication remains a separate manual step.

EAS continues to automatically increment Android `versionCode` for every build. The user-facing version only changes when one of the release commands is deliberately run.
