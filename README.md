# 스마트명성 · chflow

명성교회 통합 관리 시스템 (Church Management System)

## 📋 개요

명성교회의 성도 관리, 회원 가입, 인증, 가정교회 구조 관리 등을 위한 통합 시스템입니다.

- **백엔드**: Supabase (PostgreSQL + Auth + Storage)
- **프론트엔드**: Next.js 16 (TypeScript + Tailwind CSS)
- **호스팅**: Vercel
- **모바일**: PWA + Android TWA (Trusted Web Activity)

## 🌐 라이브 데모

**https://chflow-app.vercel.app**

## 📂 프로젝트 구조

```
chflow/
├── chflow-app/                    # Next.js 웹 앱 (메인)
│   ├── app/                        # App Router 페이지
│   │   ├── page.tsx                # 스플래시
│   │   ├── login/                  # 로그인
│   │   ├── signup/                 # 회원가입 (매칭 흐름)
│   │   ├── find-id/                # 아이디 찾기
│   │   ├── find-password/          # 비밀번호 찾기 (담당자 문의)
│   │   ├── dashboard/              # 메인 대시보드
│   │   ├── admin/members/          # 관리자 회원관리
│   │   └── api/signup/             # 서버사이드 가입 API
│   ├── lib/                        # 공용 라이브러리
│   │   ├── supabase.ts             # Supabase 클라이언트
│   │   └── roles.ts                # 직분 정의 (21개 + 13 서브)
│   └── public/                     # 정적 파일
│
├── chflow-twa/                    # Android TWA 프로젝트
│   └── android/                    # Android 빌드 (Gradle)
│
└── MS_AX/                         # 데이터 처리 / 마이그레이션
    ├── chflow-project/
    │   └── supabase/migrations/    # DB 스키마 마이그레이션
    ├── extract_v3.py              # 요람 PDF 파서
    ├── merge_v3.py                # 데이터 머지 + 엑셀 출력
    └── import_to_supabase.py      # Supabase 일괄 import
```

## 🎯 주요 기능

### 1. 인증
- 명성교회 성도 정보 자동 매칭 (이름 + 휴대폰)
- 등록된 회원 → 자동 정보 채우기 + 본인 확인
- 신규 회원 → 직분 선택 + 정보 입력
- 관리자 승인 후 활성화

### 2. 직분 시스템 (21개 + 4 서브)
- 메인 직분: 목사, 선교사, 전도사, 사모, 장로, 교육사, 간사, 시무집사, 권사, 서리집사(남/여), 교인(남/여), 청년(남/여), 청소년(남/여), 어린이(남/여), 유아(남/여)
- 서브 직분 (드롭다운):
  - 목사: 담임목사, 부목사, 은퇴목사
  - 장로: 시무장로, 원로장로, 은퇴장로, 명예장로
  - 시무집사: 시무집사, 명예시무집사, 은퇴시무집사
  - 권사: 시무권사, 명예시무권사, 은퇴시무권사

### 3. 가정교회 구조 (4단계 계층)
- 평원 → 초원 → 목장 → 가족 → 회원
- 목자/목녀/목부/목원 분류

### 4. 관리자 기능
- 회원 검색/필터링 (평원/목장/이름/휴대폰)
- 회원 정보 수정 (가정교회/직분/주소/배우자)
- 회원가입 승인/거절

### 5. PWA + Android 앱
- 홈 화면 추가 가능
- TWA로 Google Play 배포 가능

## 🚀 개발 환경 설정

### chflow-app (Next.js)

```bash
cd chflow-app
npm install

# .env.local 생성
cat > .env.local << EOF
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
EOF

npm run dev
```

### Supabase 마이그레이션

```bash
cd MS_AX/chflow-project
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db query --linked -f supabase/migrations/20260411000000_auth_extension.sql
npx supabase db query --linked -f supabase/migrations/20260411100000_directory_schema.sql
```

### Android TWA 빌드

```bash
cd chflow-twa/android
./gradlew clean assembleRelease bundleRelease
```

## 🔐 보안

- 비밀번호: bcrypt 해시 (Supabase Auth)
- RLS (Row Level Security) 모든 테이블 적용
- 관리자/사무/목회자 권한 분리
- 합성 이메일 (`username@smartms.app`) - 실제 이메일 미사용

## 📱 직분 이미지 출처

PPT 슬라이드의 캐릭터 이미지를 사용합니다 (저작권 본인 보유).

## 📝 라이선스

명성교회 내부 프로젝트입니다.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
