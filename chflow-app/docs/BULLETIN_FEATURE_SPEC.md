# 주보 보기 기능정의서

## 1. 목적

`주보 보기`는 SmartMS 인증 사용자가 최신 명성교회 주보 PDF를 앱 안에서 바로 확인하고, 필요하면 이전 주보 목록에서 선택해 볼 수 있게 하는 메뉴다.

현재 구조는 저장된 PDF가 있는 경우 Supabase Storage의 비공개 PDF를 signed URL로 보여주고, 저장 PDF가 없으면 UMS 주보 게시판 목록을 읽어 원문 링크로 대체한다.

## 2. 메뉴 정의

| 항목 | 정의 |
|---|---|
| 메뉴명 | 주보 보기 |
| 홈 진입점 | `/home`의 공통 메뉴 `주보 보기` |
| 라우트 | `/bulletin` |
| 사용자 범위 | 로그인 완료 및 활성 상태인 SmartMS 사용자 |
| 주 기능 | 최신 주보 표시, PDF 인앱 렌더링, 이전 주보 목록 선택, 새로고침, 원문/PDF 새 탭 열기 |
| 데이터 우선순위 | 1. Supabase `bulletins` 테이블 + `bulletins` Storage PDF, 2. UMS `jubo` 게시판 목록 |

## 3. 기능 목록

| 연번 | 내용 | 해당파일 | 동작원리 | 기능상세설명 |
|---:|---|---|---|---|
| 1 | 홈 메뉴 노출 | `app/home/page.tsx` | `COMMON_MENUS` 배열에 `bulletin` 메뉴가 정의되어 있고 `href: "/bulletin"`로 이동한다. | 모든 사용자 공통 메뉴로 `주보 보기`를 표시한다. 사용자가 클릭하면 주보 보기 화면으로 이동한다. |
| 2 | 주보 보기 페이지 진입 | `app/bulletin/page.tsx` | 클라이언트 컴포넌트가 Supabase 세션을 확인한다. 세션이 없으면 `/login`으로 이동한다. | 로그인한 사용자만 접근 가능하다. 인증 확인 전에는 로딩 화면을 표시한다. |
| 3 | 주보 목록 조회 API 호출 | `app/bulletin/page.tsx` | 현재 세션의 access token을 `Authorization: Bearer` 헤더에 넣어 `/api/bulletin/latest`를 호출한다. | 화면은 API 응답의 `latest`를 기본 선택 주보로 사용하고, `items`를 목록 팝업 데이터로 저장한다. |
| 4 | API 인증 검사 | `app/api/bulletin/latest/route.ts` | 요청 헤더의 Bearer token을 Supabase anon client의 `auth.getUser()`로 검증한다. | 토큰이 없거나 유효하지 않으면 `401 Unauthenticated`를 반환한다. 주보 PDF는 인증 회원에게만 제공한다. |
| 5 | 저장 PDF 주보 우선 조회 | `app/api/bulletin/latest/route.ts` | service role client로 `bulletins` 테이블에서 `pdf_url is not null`인 행을 `sunday_date desc`, `created_at desc` 순으로 10건 조회한다. | 저장 PDF가 있으면 이 데이터를 우선 사용한다. UMS 게시판을 매번 긁지 않아도 되므로 안정성과 속도가 좋아진다. |
| 6 | Storage signed URL 발급 | `app/api/bulletin/latest/route.ts` | `pdf_url`이 외부 URL이 아닌 Storage path이면 `storage.from("bulletins").createSignedUrl(path, 10분)`을 호출한다. | 비공개 버킷의 PDF를 인증된 요청에 한해 임시 URL로 제공한다. 응답의 `pdf_url`은 브라우저에서 바로 열 수 있는 signed URL이다. |
| 7 | 표시할 기본 주보 선택 | `app/api/bulletin/latest/route.ts` | KST 기준 현재 주일과 다음 주일 날짜를 계산한 뒤, 다음 주일 주보를 먼저 찾고 없으면 현재 주일, 그것도 없으면 첫 번째 항목을 선택한다. | 토요일/주중에 다음 주 주보가 미리 올라온 경우 다음 주 주보를 기본으로 보여줄 수 있다. |
| 8 | UMS 목록 fallback | `app/api/bulletin/latest/route.ts` | 저장 PDF가 하나도 없으면 `ums-fetch` Supabase Edge Function 또는 직접 UMS URL에서 EUC-KR HTML을 읽고 정규식으로 목록을 파싱한다. | `명성교회 주보` 제목만 필터링하고, 게시글 번호, 제목, 권호, 발행일, 등록일, 작성자, 원문 URL을 구성한다. 이 경우 PDF가 없으므로 원문 링크로 대체된다. |
| 9 | UMS 목록 캐시 | `app/api/bulletin/latest/route.ts` | UMS fallback 결과는 서버 메모리 변수 `publicListCache`에 5분간 저장한다. | 저장 PDF가 없는 상황에서 UMS 게시판을 과도하게 호출하지 않도록 한다. 서버리스 인스턴스 단위 캐시라 영구 캐시는 아니다. |
| 10 | PDF 인앱 렌더링 | `components/PdfCanvasViewer.tsx` | `pdfjs-dist`를 동적 import하고 `/pdf.worker.min.mjs` 워커로 PDF 각 페이지를 canvas에 렌더링한다. | 모바일 WebView나 Android 브라우저에서 iframe PDF 표시가 깨지는 문제를 피한다. 모든 페이지를 canvas로 그려 앱 안에서 바로 볼 수 있게 한다. |
| 11 | PDF 렌더 실패 대체 | `components/PdfCanvasViewer.tsx`, `app/bulletin/page.tsx` | 렌더링 실패 시 에러 오버레이를 띄우고 `fallbackUrl`을 새 탭 링크로 제공한다. | signed URL 만료, PDF 파일 손상, pdf.js 오류가 있어도 사용자는 원문/PDF를 새 탭으로 열어볼 수 있다. |
| 12 | 주보 목록 팝업 | `app/bulletin/page.tsx` | API 응답 `items` 중 최대 10건을 오버레이 목록으로 표시하고 선택 시 `selected` 상태를 바꾼다. | 최신 주보 외 이전 주보를 빠르게 선택해 확인할 수 있다. 선택된 항목은 `선택됨`으로 표시한다. |
| 13 | 새로고침 | `app/bulletin/page.tsx` | 새로고침 버튼 클릭 시 Supabase 세션을 다시 확인하고 `/api/bulletin/latest`를 재호출한다. | 사용자가 최신 주보 반영 여부를 직접 다시 확인할 수 있다. |
| 14 | 주보 PDF 자동 수집 | `app/api/bulletin/sync/route.ts` | cron secret 또는 개발환경 요청만 허용한다. UMS `jubo` 목록에서 최신 게시글을 찾고 UMS 로그인 후 PDF 파일을 찾아 Storage에 업로드한다. | 메인 교회 홈페이지 주보 PDF를 앱 내부에서 보기 위해 Supabase `bulletins` 테이블과 `bulletins` Storage 버킷에 캐시한다. |
| 15 | PDF 수집 인증 정보 | `app/api/bulletin/sync/route.ts` | 환경변수 `UMS_JUBO_USER_ID`/`UMS_JUBO_PASSWORD`, fallback으로 `UMS_BULLETIN_*` 또는 `UMS_USER_ID`/`UMS_PASSWORD`를 사용한다. | UMS 주보 게시글의 PDF 접근 권한이 필요하다. 환경변수가 누락되면 sync API는 실패한다. |
| 16 | PDF Storage 버킷 생성 보장 | `app/api/bulletin/sync/route.ts`, `20260604010000_bulletin_cached_pdf.sql` | sync 시 버킷이 없으면 생성하고, 마이그레이션에서도 `bulletins` 비공개 버킷과 정책을 정의한다. | PDF 파일은 `bulletins` 버킷에 저장되며, 기본 경로는 `jubo/{issue_date}_{no}.pdf`다. |
| 17 | 주보 DB 스키마 | `20260410000000_init_chflow.sql`, `20260604010000_bulletin_cached_pdf.sql` | `bulletins` 테이블은 제목, 내용, 주일 날짜, PDF 경로/URL, 생성일을 저장한다. 이후 `source_board`, `source_no`, `pdf_path`, `fetched_at` 컬럼과 source unique index가 추가되었다. | 조회 API는 현재 `pdf_url` 컬럼을 기준으로 저장 PDF를 찾는다. 마이그레이션에는 `pdf_path`도 있으므로 향후 컬럼 사용을 통일할 필요가 있다. |
| 18 | 주보 DB 권한 | `20260410000000_init_chflow.sql`, `20260604010000_bulletin_cached_pdf.sql` | `bulletins` 테이블 select는 인증 사용자에게 허용, insert/update/delete는 admin/office에 허용한다. Storage read는 인증 사용자, write는 admin/office에 허용한다. | 화면 API는 service role로 signed URL을 발급하지만, DB/Storage 정책도 인증 사용자 기준으로 보호되어 있다. |
| 19 | 부서 주보 만들기 | `app/departments/d/[id]/weekly-bulletin/page.tsx` | 부서별 작성 화면에서 draft를 불러오고 저장하며, 브라우저에서 PDF를 생성하거나 사용자가 첨부한 PDF를 UMS 자동등록에 사용한다. | `/bulletin`의 메인 교회 주보 보기와 직접 같은 목록을 쓰지는 않지만, 주보 도메인의 작성/등록 기능이다. |
| 20 | 부서 주보 draft | `app/departments/d/[id]/weekly-bulletin/page.tsx`, `20260429000000_bulletin_drafts.sql` | `bulletin_get_draft`, `bulletin_save_draft`, `bulletin_list_drafts`, `bulletin_delete_draft` RPC로 작성 중인 주보 데이터를 저장/조회한다. | 부서 주보 작성 상태를 날짜별로 유지한다. 메인 주보 보기의 `bulletins` 테이블과는 별도 데이터다. |
| 21 | 부서 주보 PDF 생성 | `app/departments/d/[id]/weekly-bulletin/page.tsx`, `lib/bulletin/pdf-browser.ts`, `lib/bulletin/pdf-generator.ts` | 브라우저 또는 서버에서 `pdf-lib`와 한글 폰트를 사용해 PDF를 만든다. | 사용자가 별도 PDF를 첨부하지 않으면 입력 폼 데이터를 기반으로 자동 생성한 PDF를 UMS 등록 또는 다운로드에 사용한다. |
| 22 | UMS 자동등록 v2 | `app/api/ums-bulletin/post-v2/route.ts`, `supabase/functions/ums-post-bulletin/index.ts` | 사용자별 UMS 자격증명을 DB에서 읽고 복호화한 뒤 Supabase Edge Function에 등록 요청을 위임한다. | 부서 주보를 UMS `samusil` 게시판에 자동 등록한다. 등록 전 30분 쿨다운을 확인하고 성공/실패 로그를 남긴다. |
| 23 | UMS 자격증명 관리 | `app/api/ums-credentials/mine/route.ts`, `lib/bulletin/creds-crypto.ts` | 사용자가 자신의 UMS ID/비밀번호를 등록하면 비밀번호는 암호화되어 `user_ums_credentials`에 저장된다. | UMS 자동등록 v2는 서버 공용 계정이 아니라 사용자별 계정으로 동작한다. |
| 24 | 구형 UMS 자동등록 API | `app/api/ums-bulletin-post/route.ts`, `lib/bulletin/ums-via-cf.ts` | 서버 공용 UMS 계정으로 PDF를 생성하고 Edge Function에 위임한다. | 현재 v2가 사용자별 자격증명 기반 주 경로이며, 구형 API는 호환/이전 흐름으로 남아 있다. |

## 4. 주요 처리 흐름

### 4.1 주보 보기 화면

1. 사용자가 `/home`에서 `주보 보기`를 선택한다.
2. `/bulletin` 페이지가 Supabase 세션을 확인한다.
3. 세션이 있으면 `/api/bulletin/latest`를 Bearer token과 함께 호출한다.
4. API는 토큰을 검증한 뒤 Supabase `bulletins` 저장 PDF를 먼저 조회한다.
5. 저장 PDF가 있으면 Storage signed URL을 만들어 반환한다.
6. 저장 PDF가 없으면 UMS `jubo` 게시판 목록을 파싱해 원문 URL 목록을 반환한다.
7. 화면은 `latest`를 기본으로 선택하고, `pdf_url`이 있으면 `PdfCanvasViewer`로 canvas 렌더링한다.
8. `pdf_url`이 없거나 렌더링 실패 시 원문/PDF 새 탭 열기를 제공한다.

### 4.2 메인 교회 주보 PDF 수집

1. `/api/bulletin/sync`가 cron 또는 수동 호출로 실행된다.
2. UMS `jubo` 목록에서 최신 `명성교회 주보` 게시글을 찾는다.
3. 동일 주보가 이미 `bulletins`에 있고 `pdf_url`이 있으면 중복 수집을 건너뛴다.
4. UMS 계정으로 로그인한 뒤 게시글 HTML에서 PDF 후보 경로를 찾는다.
5. PDF 바이너리가 맞는 경로를 찾으면 `bulletins` Storage에 업로드한다.
6. `bulletins` 테이블에 제목, 날짜, UMS 게시글 번호, Storage path를 저장한다.
7. 이후 `/bulletin` 조회 API가 이 PDF를 우선 제공한다.

## 5. 데이터 구조

| 데이터 | 위치 | 주요 필드 | 설명 |
|---|---|---|---|
| 메인 주보 | `public.bulletins` | `title`, `content`, `sunday_date`, `pdf_url`, `created_at` | `/bulletin`에서 우선 조회하는 주보 메타데이터 |
| 메인 주보 수집 확장 | `public.bulletins` | `source_board`, `source_no`, `pdf_path`, `fetched_at` | UMS 원본 게시판/게시글 번호 및 수집 시각 관리용 확장 컬럼 |
| 메인 주보 PDF | Supabase Storage `bulletins` bucket | `jubo/{date}_{no}.pdf` | 비공개 PDF 파일 저장소 |
| 부서 주보 임시저장 | `public.bulletin_drafts` | `department_id`, `issue_date`, `form_data`, `issue_number` | 부서 주보 만들기 화면의 작성 중 데이터 |
| UMS 계정 | `public.user_ums_credentials` | `user_id`, `ums_user_id`, `ums_password_encrypted` | 사용자별 UMS 자동등록 자격증명 |
| UMS 등록 로그 | RPC `ums_log_post` 대상 테이블 | `ums_user_id`, `status`, `post_no`, `subject` 등 | 자동등록 성공/실패 및 쿨다운 관리 |

## 6. 운영/유지보수 체크포인트

| 점검 항목 | 확인 위치 | 기준 |
|---|---|---|
| 최신 주보가 앱에 안 보임 | `/api/bulletin/latest` 응답 | `source`가 `storage`인지, `latest.pdf_url`이 있는지 확인 |
| PDF 대신 원문 보기만 나옴 | `public.bulletins`, Storage `bulletins` | 저장된 `pdf_url` 또는 Storage path가 없는 상태 |
| PDF가 만료/실패함 | `createSignedUrl` 결과, 브라우저 콘솔 | signed URL은 10분 만료다. 새로고침 시 새 URL이 발급되어야 한다. |
| UMS fallback 실패 | `/api/bulletin/latest`, UMS HTML 구조 | UMS 게시판 HTML 구조가 바뀌면 정규식 파서 수정 필요 |
| 자동 수집 실패 | `/api/bulletin/sync` 응답 | UMS 환경변수, UMS 로그인 권한, PDF 후보 경로, Storage 권한 확인 |
| Storage 업로드 실패 | Supabase Storage 정책 | `bulletins` 버킷 존재 여부와 admin/office write 정책 확인 |
| 모바일 PDF 미표시 | `components/PdfCanvasViewer.tsx` | pdf.js worker `/pdf.worker.min.mjs`가 public에 있고 정상 로드되는지 확인 |
| 부서 주보 자동등록 실패 | `/api/ums-bulletin/post-v2` 응답 | 사용자 UMS 자격증명, 30분 쿨다운, Supabase Edge Function 응답 확인 |

## 7. 개선 권장사항

| 연번 | 개선 내용 | 이유 |
|---:|---|---|
| 1 | `bulletins.pdf_url`과 `bulletins.pdf_path` 사용 기준 통일 | 마이그레이션에는 `pdf_path`가 추가되어 있지만 현재 조회/수집 코드는 주로 `pdf_url`을 사용한다. 유지보수 혼선을 줄이려면 하나로 정리해야 한다. |
| 2 | `/api/bulletin/latest`의 UMS HTML 파싱 로직을 공용 함수로 분리 | `latest`와 `sync` API에 유사한 EUC-KR fetch/HTML parse 로직이 있다. UMS 구조 변경 시 한 곳만 고치게 하는 편이 좋다. |
| 3 | 수집 성공 시 `source_board`, `source_no`, `fetched_at`도 명시 저장 | 중복 방지와 장애 추적이 쉬워진다. 현재 unique index와 확장 컬럼의 의도를 코드가 충분히 활용하지 않는다. |
| 4 | 관리자용 주보 수집 상태 화면 추가 | 최신 수집 일자, 원본 게시글 번호, PDF 경로, 마지막 실패 사유를 UI에서 확인하면 운영 부담이 줄어든다. |
| 5 | E2E 점검 시나리오 문서화 | 로그인 → 주보 보기 → 목록 열기 → PDF 렌더 → 새로고침 → 원문 열기까지 고정 점검하면 배포 전 회귀를 줄일 수 있다. |

## 8. 결론

기능정의서를 메뉴별로 작성하는 것은 좋은 운영 방식이다. 특히 이 기능은 프론트 화면, Next API, Supabase DB/Storage, UMS 외부 사이트, PDF 렌더러가 모두 연결되어 있어 코드만 보면 전체 흐름을 놓치기 쉽다.

앞으로 메뉴마다 같은 형식의 기능정의서를 만들면 신규 개발자는 진입점을 빠르게 찾고, 운영자는 장애가 났을 때 어느 API/테이블/환경변수를 먼저 봐야 하는지 판단할 수 있다.
