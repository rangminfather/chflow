# Deployment Notes

## Delivery Split

The current delivery decision is split by runtime:

- Web/PWA: deploy `chflow-app` to Vercel.
- Android mobile app: build and release the React Native Expo shell in `chflow-expo`.
- Do not treat `chflow-twa` as the current mobile release path unless that architecture decision is changed explicitly.
- `chflow-expo` and legacy `chflow-twa` currently use the same Android package id, so installing a TWA APK can replace the Expo shell on a test phone and bypass native Expo behaviors such as Android back handling.

Web deploy:

```powershell
cd C:\csh\project\chflow
.\scripts\deploy-chflow-app.ps1
```

Android app verification/build path:

```powershell
cd C:\csh\project\chflow\chflow-expo
eas build -p android --profile verify
```

Android production release path:

```powershell
cd C:\csh\project\chflow\chflow-expo
eas build -p android --profile production
```

Web deploys update the PWA/web content used by the mobile WebView, but they do not validate or replace native Expo behavior such as Android back handling, launcher assets, native permissions, or Play Store binaries.

운영 앱의 기준 Vercel 프로젝트는 `chflow-app`입니다.

- 운영 주소: `https://chflow-app.vercel.app`
- Vercel 프로젝트명: `chflow-app`
- Vercel projectId: `prj_y26PnlBpVtwQLD3mV4WR4ycyuHXv`
- 프로젝트 Root Directory 설정: `chflow-app`

주의할 점:

- 루트 `C:\csh\project\chflow`에서 배포해야 합니다.
- `C:\csh\project\chflow\chflow-app` 안에서 직접 `vercel --prod`를 실행하면 Vercel 설정의 `rootDirectory=chflow-app` 때문에 `chflow-app/chflow-app`를 찾다가 실패할 수 있습니다.
- `chflow`라는 별도 Vercel 프로젝트가 있으나 운영 앱 기준 프로젝트가 아닙니다. `chflow-sigma.vercel.app`, `chflow-rangminfathers-projects.vercel.app` 계열은 운영 확인 기준으로 쓰지 않습니다.
- `chflow-app.vercel.app` alias를 다른 프로젝트에 직접 붙이지 않습니다.

권장 배포 명령:

```powershell
.\scripts\deploy-chflow-app.ps1
```

수동 배포가 필요할 때:

```powershell
cd C:\csh\project\chflow
vercel --prod --yes
vercel inspect chflow-app.vercel.app
```

배포 후 확인 기준:

- `vercel inspect chflow-app.vercel.app`의 `name`이 `chflow-app`이어야 합니다.
- `https://chflow-app.vercel.app/login`이 `200 OK`를 반환해야 합니다.
