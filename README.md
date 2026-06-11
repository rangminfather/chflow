# 스마트명성 · chflow

명성교회 성도, 사역/부서, 교육부서, 알림, 주보, 피드백 업무를 통합 관리하는 내부 운영 시스템입니다.

## 프로젝트 개요

- 목적: 교회 행정과 성도 참여 흐름을 하나의 웹/PWA와 Android 앱으로 제공
- 웹/PWA: `chflow-app` Next.js 앱, Vercel 배포
- 모바일: `chflow-expo` Expo React Native WebView shell
- 백엔드: Supabase PostgreSQL, Auth, Storage, Realtime
- 현재 운영 URL: `https://chflow-app.vercel.app`

## 설치 방법

필수 도구:

- Node.js 20 계열
- npm
- Supabase CLI
- Vercel CLI
- Expo/EAS CLI, Android 검증 빌드가 필요할 때

의존성 설치:

```powershell
cd C:\csh\project\chflow\chflow-app
npm install

cd C:\csh\project\chflow\chflow-expo
npm install
```

환경변수는 루트 [.env.example](C:/csh/project/chflow/.env.example)을 기준으로 `chflow-app/.env.local`, Vercel 환경변수, Supabase Vault에 나누어 설정합니다.

## 실행 방법

웹 개발 서버:

```powershell
cd C:\csh\project\chflow\chflow-app
npm run dev
```

웹 운영 빌드:

```powershell
cd C:\csh\project\chflow\chflow-app
npm run build
npm run start
```

Android Expo 개발:

```powershell
cd C:\csh\project\chflow\chflow-expo
npx expo start --android
```

Android 검증 빌드:

```powershell
cd C:\csh\project\chflow\chflow-expo
eas build -p android --profile verify
```

## 폴더 구조

```text
chflow/
├── chflow-app/                    # Next.js 웹/PWA 앱
│   ├── app/                        # App Router 페이지와 API Route
│   ├── components/                 # 공용 UI/기능 컴포넌트
│   ├── docs/                       # 기능별 상세 기록
│   ├── lib/                        # Supabase, 알림, 공용 유틸
│   └── public/                     # 정적 자산
├── chflow-expo/                    # Android Expo WebView shell
├── MS_AX/chflow-project/supabase/  # Supabase 설정과 migrations
├── docs/                           # 프로젝트 운영/아키텍처/API/DB 문서
├── scripts/                        # 배포/운영 보조 스크립트
└── archive/mobile-legacy/          # 과거 TWA 자료, 현재 빌드 경로 아님
```

## 주요 기능

- 성도 인증, 가입 신청, 관리자 승인
- 성도/가정교회/목장/평원 관리
- 사역·부서 가입, 승인, 교육부서 권한/등급 관리
- 주보 조회, 주보 작성/자동 등록 보조
- 피드백/건의 게시판과 댓글 알림
- 전역 알림 센터, Supabase Realtime, Android Expo Push
- Android WebView shell에서 뒤로가기, 알림 권한, 알림 클릭 라우팅 처리

## 문서

- 환경 설정: [docs/ENVIRONMENT.md](C:/csh/project/chflow/docs/ENVIRONMENT.md)
- 아키텍처: [docs/ARCHITECTURE.md](C:/csh/project/chflow/docs/ARCHITECTURE.md)
- API 명세: [docs/API.md](C:/csh/project/chflow/docs/API.md)
- 데이터베이스: [docs/DATABASE.md](C:/csh/project/chflow/docs/DATABASE.md)
- 운영 매뉴얼: [docs/OPERATIONS.md](C:/csh/project/chflow/docs/OPERATIONS.md)
- 변경 이력: [CHANGELOG.md](C:/csh/project/chflow/CHANGELOG.md)
- 모바일 방향: [MOBILE_ARCHITECTURE.md](C:/csh/project/chflow/MOBILE_ARCHITECTURE.md)
- 배포 메모: [DEPLOYMENT.md](C:/csh/project/chflow/DEPLOYMENT.md)

## 변경 규칙

- UI 구조나 디자인 요소 변경은 별도 확인 후 진행합니다.
- 비밀값은 코드/문서에 직접 기록하지 않습니다.
- DB 변경은 Supabase migration으로 남깁니다.
- 변경 이력은 [CHANGELOG.md](C:/csh/project/chflow/CHANGELOG.md)에 기록합니다.
