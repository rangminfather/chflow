# chflow-app

스마트명성의 Next.js 웹/PWA 애플리케이션입니다. 운영 배포 기준 프로젝트는 Vercel `chflow-app`이며 운영 URL은 `https://chflow-app.vercel.app`입니다.

## 실행

```powershell
npm install
npm run dev
```

운영 빌드:

```powershell
npm run build
npm run start
```

## 주요 디렉터리

- `app/`: App Router 페이지와 API Route
- `components/`: 공용 컴포넌트
- `lib/`: Supabase client, 알림 유틸, 공용 로직
- `docs/`: 앱 기능별 기록
- `public/`: 정적 파일

## 환경변수

루트 `.env.example`과 `docs/ENVIRONMENT.md`를 기준으로 설정합니다. 로컬 개발은 `chflow-app/.env.local`을 사용하고, 운영은 Vercel Environment Variables를 사용합니다.

## 알림 관련 API

- `POST /api/mobile/push-token`: Expo push token 등록
- `GET|POST /api/mobile/push-dispatch`: queued push delivery 발송

상세 명세는 루트 `docs/API.md`를 참조합니다.
