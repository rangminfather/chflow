# CHFlow 데스크톱 메신저 (Tauri v2)

교역자·행정 담당자용 Windows 데스크톱 메신저. 기존 CHFlow Supabase 백엔드(테이블·RPC·RLS·Realtime)와 R2 첨부를 **공유**한다. 웹 메신저(`chflow-app`)와 독립 UI.

> 설계 문서: `_scratch/claude/2026-06-18/DESKTOP_MESSENGER_DESIGN.md`
> 현재 단계: **3단계(최소 실행 앱)**. 트레이/알림/SQLite 캐시/오프라인 자동재전송/자동업데이트/설치 패키징은 후속 단계.

## 개발 환경 전제
- Node.js 18+ / npm
- **Rust 툴체인(rustup, cargo)** — Tauri 빌드 필수. (https://rustup.rs)
- **Windows Build Tools** (MSVC) — Windows 빌드용
- Tauri 사전점검: `npm run tauri info`

## 환경변수
`.env.example` 복사 → `.env`:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (anon key만, service_role 금지)
- `VITE_API_BASE_URL` (예: `https://chflow-app.vercel.app`) — username 로그인/첨부 프록시

## 명령
| 명령 | 설명 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm run typecheck` | 프런트엔드 TS 타입 검사 (Rust 불요) |
| `npm run dev` | Vite 프런트만 (브라우저, 보안저장소는 메모리 폴백) |
| `npm run tauri:dev` | 데스크톱 앱 개발 실행 (**Rust 필요**) |
| `npm run tauri:build` | NSIS 설치파일 빌드 (**Rust + 아이콘 필요**) |

## 빌드 전 준비
1. 아이콘 생성: `npm run tauri icon path/to/logo.png` (→ `src-tauri/icons/`)
2. `.env` 설정

## 보안 메모
- **세션 저장(대안 2)**: Windows Credential Manager의 2560자 한도로 세션 직접저장이 불가함을 확인 → CM에는 **32바이트 마스터키만**, Supabase 세션 JSON은 **AES-256-GCM**으로 암호화해 `appLocalData/secure/<key>.bin`에 저장. 매 저장 새 nonce, `[version|nonce|ciphertext]` 포맷. (`src/services/secureStorage.ts` + `src-tauri/.../secure_store.rs`)
- **localStorage 미사용**(폴백 없음, Tauri 환경). 복호화 실패 시 손상파일 제거 후 재로그인 유도(무한재시도 금지). 평문 세션은 디스크/임시/로그 어디에도 안 남김.
- 키 수명주기: `secure_delete`=세션파일만 삭제(마스터키 유지), `secure_purge`=마스터키+세션 모두 삭제(완전 초기화).
- 자체 호스팅 API 호출은 **tauri-plugin-http**(네이티브, CORS 비적용)로 수행.
- service_role 키 절대 미포함. RLS/RPC가 최종 방어선.
- **dev/prod CSP·URL 분리**: 프로덕션 `csp`(base 설정)엔 localhost 없음. dev 전용 `devUrl`은 `src-tauri/tauri.dev.conf.json`에 분리 → `npm run tauri:dev`(`--config`)에서만 병합. release 바이너리에 localhost 미포함(검증됨).

## 3단계 검증 체크리스트
**환경/빌드 (검증 완료)**
- [x] Rust 1.96.0 / MSVC 14.44 / Windows SDK 10.0.26100 / WebView2 설치
- [x] cargo fmt --check / cargo check 통과
- [x] 프로덕션 빌드(무서명) + 클린 재빌드, release exe에 localhost 미포함 확인
- [x] 단일 인스턴스(2회 실행→1개), WebView2 로컬 번들 UI 로드 확인
- [x] 보안저장소 더미 1~8KB 저장·복원·삭제 통과(AES-GCM), CM 2560자 한도 회피, 잘못된 키→재로그인

**인증/세션 — 실제 자격증명 필요(미검증)**
- [ ] username 로그인 성공/실패 (실제 API 통합: CORS·Origin·preflight·Bearer 확인)
- [ ] 로그인 후 세션이 **AES-GCM 파일**에 저장(CM엔 마스터키만), **localStorage에 sb-* 없음**
- [ ] 앱 재시작 후 세션 복원 / 토큰 갱신 / 로그아웃 시 세션파일 삭제 / 계정 변경 시 갱신
- [ ] 실제 Supabase 세션 직렬화 크기(바이트만 보고)

**Realtime (Q-1 — 확정 아님, 검증 대상)**
- [ ] 계정 2개로 참여 대화방 이벤트만 수신, 미참여방 유출 없음
- [ ] 웹+데스크톱 동시 접속 중복 이벤트
- [ ] 재연결/React 재마운트 후 중복 구독 없음
- [ ] 채널 수 vs 실제 WebSocket 연결 수 측정
- [ ] 이벤트 폭주 시 목록 RPC debounce 동작

**메시지/전송 (Q-4)**
- [ ] 채팅방 목록 / 최근 메시지 / 커서 페이지네이션(이전 더보기)
- [ ] 메시지 전송, 전송 중 버튼 비활성(중복클릭 방지), 실패 표시 + 수동 재시도
- [ ] ⚠️ 위험: 서버 저장 성공 후 응답 유실 시 중복 메시지 가능(멱등키 없음 — 자동재전송 미구현)

**플랫폼**
- [ ] 단일 인스턴스(2번째 실행 시 기존 창 포커스)
- [ ] CSP 하에서 Supabase/API 통신 정상
