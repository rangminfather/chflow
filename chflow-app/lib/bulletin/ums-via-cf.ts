// chflow Vercel API 에서 ums.or.kr 으로 가는 모든 fetch 를 Cloudflare Worker proxy 거치게 함.
// Worker 가 UMS 호출의 IP 우회 역할만 담당, 모든 4단계 로직과 인코딩은 여기 Vercel side 에서.

import iconv from "iconv-lite";

const WORKER_URL = process.env.UMS_PROXY_WORKER_URL || "https://ums-probe.rangminfather.workers.dev";

export interface ProxyResult {
  status: number;
  body: Buffer;
  setCookies: string[];
  location: string | null;
  contentType: string;
  workerIp?: string | null;
  workerColo?: string | null;
  workerCountry?: string | null;
  workerPlacement?: string | null;
}

export interface ProxyOptions {
  method?: "GET" | "POST";
  body?: Buffer | Uint8Array;
  cookie?: string;
  referer?: string;
  contentType?: string;
  xRequestedWith?: string;
  origin?: string;
}

// Cloudflare Worker 통한 UMS 호출
export async function umsViaCf(path: string, opts: ProxyOptions = {}): Promise<ProxyResult> {
  const url = `${WORKER_URL}/?path=${encodeURIComponent(path)}`;
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["X-Forward-Cookie"] = opts.cookie;
  if (opts.referer) headers["X-Forward-Referer"] = opts.referer;
  if (opts.contentType) headers["X-Forward-Content-Type"] = opts.contentType;
  if (opts.xRequestedWith) headers["X-Forward-X-Requested-With"] = opts.xRequestedWith;
  if (opts.origin) headers["X-Forward-Origin"] = opts.origin;

  const init: RequestInit = {
    method: opts.method || "GET",
    headers,
  };
  if (opts.body) {
    // Buffer/Uint8Array 그대로 보냄
    init.body = opts.body as BodyInit;
  }

  const res = await fetch(url, init);
  const buf = Buffer.from(await res.arrayBuffer());

  // Set-Cookie 들은 base64 인코딩되어 X-Forward-Set-Cookie-B64 로 옴
  const cookieB64 = res.headers.get("X-Forward-Set-Cookie-B64") || "";
  let setCookies: string[] = [];
  if (cookieB64) {
    try {
      const decoded = Buffer.from(cookieB64, "base64").toString("utf8");
      setCookies = decoded.split("\n").filter(Boolean);
    } catch {/* ignore */}
  }
  // 옛 포맷 호환 (Worker 미배포 시)
  if (setCookies.length === 0) {
    const legacy = res.headers.get("X-Forward-Set-Cookie") || "";
    if (legacy) setCookies = legacy.split("\n").filter(Boolean);
  }

  return {
    status: parseInt(res.headers.get("X-Forward-Status") || String(res.status), 10),
    body: buf,
    setCookies,
    location: res.headers.get("X-Forward-Location"),
    contentType: res.headers.get("Content-Type") || "application/octet-stream",
    workerIp: res.headers.get("X-Worker-Outbound-IP") || null,
    workerCountry: res.headers.get("X-Worker-Outbound-Country") || null,
    // CF-RAY 헤더 = Cloudflare 가 자동 박음. 형식: "<id>-<colo>" (예: "9f6e...-LAX")
    // edge colo (사용자 가까운 Cloudflare 노드). Smart Placement 가 켜져 있으면 Worker 자체는
    // X-Worker-Colo 에 적힌 다른 colo 에서 실행될 수 있음.
    workerColo: res.headers.get("X-Worker-Colo") || res.headers.get("CF-RAY")?.split("-")[1] || null,
    workerPlacement: res.headers.get("Cf-Placement") || null,
  };
}

// ──────────────────────────────────────────────────
// 쿠키 jar
// ──────────────────────────────────────────────────
export class CookieJar {
  private store = new Map<string, string>();

  ingest(setCookies: string[]) {
    for (const c of setCookies) {
      const semi = c.indexOf(";");
      const kv = (semi > 0 ? c.slice(0, semi) : c).trim();
      const eq = kv.indexOf("=");
      if (eq < 0) continue;
      const key = kv.slice(0, eq).trim();
      const val = kv.slice(eq + 1).trim();
      if (val === "deleted") this.store.delete(key);
      else this.store.set(key, val);
    }
  }

  toHeader(): string {
    return Array.from(this.store.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.store.get(name);
  }
}

// ──────────────────────────────────────────────────
// multipart 빌드 (CP949 인코딩 가능)
// ──────────────────────────────────────────────────
type MultipartField =
  | { name: string; value: string | Buffer | Uint8Array; filename?: string; contentType?: string };

export function buildMultipart(boundary: string, fields: MultipartField[]): Buffer {
  const parts: Buffer[] = [];
  for (const f of fields) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) header += `; filename="${f.filename}"`;
    header += "\r\n";
    if (f.contentType) header += `Content-Type: ${f.contentType}\r\n`;
    header += "\r\n";
    parts.push(Buffer.from(header, "utf8"));
    if (typeof f.value === "string") {
      parts.push(Buffer.from(f.value, "utf8"));
    } else {
      parts.push(Buffer.from(f.value));
    }
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(parts);
}

// ──────────────────────────────────────────────────
// 4단계 플로우 (Worker 통과)
// ──────────────────────────────────────────────────
const UMS_LOGIN_PATH = "/bbs/login_check.php";
const UMS_WRITE_FORM_PATH = "/bbs/write.php?id=samusil&page=1&category=2&mode=write";
const UMS_UPLOAD_PATH = "/core/plupload/upload.php";
const UMS_WRITE_OK_PATH = "/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/write_ok.php";

export interface UmsAutoPostInput {
  ums_user_id: string;
  ums_password: string;
  subject: string;
  memo: string;
  pdf_bytes: Buffer;
  pdf_filename: string;
  category?: number;
  // 🔬 진단 모드 — 1·2단계(login + write_form)까지만 실행하고 종료.
  // 3단계(upload), 4단계(write_ok) skip → cooldown 발동 X, 게시판 흔적 X.
  // 차단 본질 진단용.
  dryRun?: boolean;
}

export interface UmsAutoPostResult {
  ok: boolean;
  post_no?: number;
  redirect_url?: string;
  pl_date?: string;
  error?: string;
  debug?: DebugStep[];
  write_form_attempts?: WriteFormAttempt[];
}

export interface WriteFormAttempt {
  i: number;
  elapsed_ms: number;
  worker_ip: string;
  worker_country: string;
  worker_colo: string;
  worker_placement: string;
  phpsessid: string;
  size: number;
  passed: boolean;
}

interface DebugStep {
  step: string;
  status: number;
  body_len: number;
  body_sample: string;
  set_cookies: string[];
  cookie_jar_after: string;
  extra?: Record<string, string | number | undefined>;
}

// 스팸차단 정답 단서 추출 — write.php 응답에서
interface SpamDebug {
  hint: string;
  hiddens: Record<string, string>;
  jsCandidates: string[];
  comments: string[];
  fullContext: string;
}

function extractSpamDebug(html: string): SpamDebug {
  // 1. w_key_spam 주변 6000자 (앞 5000 + 뒤 1000) — 안내문 전체 + 주변 hidden 다 캡처
  const idx = html.indexOf("w_key_spam");
  let hint = "(not found)";
  let fullContext = "(not found)";
  if (idx > 0) {
    const start = Math.max(0, idx - 5000);
    const end = Math.min(html.length, idx + 1000);
    fullContext = html.slice(start, end);
    hint = fullContext.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  // 2. 모든 hidden input — 필터 X. 정답이 어떤 키에라도 박혀있을 수 있음
  const hiddens: Record<string, string> = {};
  const hiddenRe = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  const hiddenMatches = html.match(hiddenRe) || [];
  for (const h of hiddenMatches) {
    const nameM = h.match(/name=["']([^"']+)["']/);
    const valM = h.match(/value=["']([^"']*)["']/);
    if (nameM && valM) hiddens[nameM[1]] = valM[1].slice(0, 200);
  }

  // 3. 모든 JS 변수 (필터 X) — var/let/const 선언 다 추출
  const jsCandidates: string[] = [];
  const jsRe = /(?:var|let|const)\s+(\w+)\s*=\s*["']([^"']{1,200})["']/g;
  let m: RegExpExecArray | null;
  while ((m = jsRe.exec(html)) !== null) {
    jsCandidates.push(`${m[1]}="${m[2]}"`);
    if (jsCandidates.length >= 50) break;
  }

  // 4. 모든 HTML 주석 — 답 단서 가능성
  const comments: string[] = [];
  const cmtRe = /<!--([\s\S]*?)-->/g;
  while ((m = cmtRe.exec(html)) !== null) {
    const c = m[1].trim();
    if (c && c.length < 500) {
      if (/spam|key|answer|차단|로봇|명성|김종혁|목사/i.test(c)) {
        comments.unshift(c.slice(0, 400));
      } else if (comments.length < 30) {
        comments.push(c.slice(0, 200));
      }
    }
  }

  return { hint, hiddens, jsCandidates, comments, fullContext };
}

// UMS 회원 인증 마크 cookie — JS 가 클라이언트 측에서 set.
// 형식: YYYY-MM-DD+요일3자+AM/PM+HH.MM.SS (KST 기준)
// 이게 있어야 UMS 가 "정상 회원 로그인" 으로 인식 → 외국 IP 라도 스팸차단 면제.
function makeLogin1stCookie(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → KST
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = dayNames[now.getUTCDay()];
  const hour24 = now.getUTCHours();
  const ampm = hour24 < 12 ? "AM" : "PM";
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(hour24 % 12 || 12).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}+${day}+${ampm}+${hh}.${mi}.${ss}`;
}

// 외부 wrapper — login + write_form 묶음을 N회 재시도 (PHPSESSID 새로 받기 위해).
// 한 세션이 거부되면 그 안에서는 영원히 거부 (D 진단 결과). 새 login 으로 새 세션 받아야 통과.
// 통과율 ~65% 가정: 0.35^3 = 4.3% 실패 = 95.7% 통과.
// 6회 → 3회로 축소: 짧은 시간 내 반복 시도 시 ums 가 봇으로 분류해 일시적 권한 거부
// ("사용권한이 없습니다") 를 거는 사례 확인됨. 신뢰성보다 ums 측 차단 회피 우선.
// 실패해도 사용자가 5~10분 후 재시도하면 충분.
const SESSION_RETRIES = 3;

// 시도 간 간격 — 너무 빠르면 봇으로 분류. ums 측 정상 회원 글쓰기 흐름 흉내.
const SESSION_DELAY_BASE_MS = 4000;
const SESSION_DELAY_JITTER_MS = 2000;

export async function umsAutoPost(input: UmsAutoPostInput): Promise<UmsAutoPostResult> {
  const allAttempts: WriteFormAttempt[] = [];
  let lastResult: UmsAutoPostResult = { ok: false, error: "no attempts" };

  for (let k = 1; k <= SESSION_RETRIES; k++) {
    const result = await umsAutoPostOnce(input);
    if (result.write_form_attempts) {
      result.write_form_attempts.forEach((a) =>
        allAttempts.push({ ...a, i: allAttempts.length + 1 }),
      );
    }
    lastResult = result;
    if (result.ok) {
      return { ...result, write_form_attempts: allAttempts };
    }
    // 실패 → 다음 iteration 에서 새 login + 새 PHPSESSID
    // 단, 마지막 시도는 sleep 생략 (어차피 더 안 함).
    if (k < SESSION_RETRIES) {
      const delay = SESSION_DELAY_BASE_MS + Math.floor(Math.random() * SESSION_DELAY_JITTER_MS);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return {
    ...lastResult,
    error: `${SESSION_RETRIES}회 새 세션 시도 모두 거부. 마지막: ${lastResult.error}. 5~10분 후 재시도해주세요 (ums 측 일시 차단 가능성).`,
    write_form_attempts: allAttempts,
  };
}

async function umsAutoPostOnce(input: UmsAutoPostInput): Promise<UmsAutoPostResult> {
  const jar = new CookieJar();
  const debug: DebugStep[] = [];

  // 🧪 임시 검증용 — 환경변수 UMS_TEST_COOKIE 가 있으면 login_check 건너뛰고
  // 그 cookie 그대로 사용. PHPSESSID 발급 IP 가설 검증 후 환경변수 제거.
  const debugCookie = process.env.UMS_TEST_COOKIE;
  const skipLogin = !!debugCookie;

  // 진단: Vercel function 의 outbound IP 확인 (한국 / 외국 구분)
  let vercelIp = "unknown";
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    const ipData = await ipRes.json();
    vercelIp = ipData.ip;
  } catch {/* ignore */}
  // Cloudflare Worker outbound IP (Worker 가 X-Worker-Outbound-IP 응답 헤더로 보내줘야 함)
  // 현재 Worker 코드는 미지원이라 일단 unknown 으로.
  pushDebug("ip_diagnostic", Buffer.from(""), 200, [], {
    vercel_outbound_ip: vercelIp,
  });

  function pushDebug(step: string, body: Buffer, status: number, setCookies: string[], extra?: Record<string, string | number | undefined>) {
    // write_form 거부 페이지 진짜 사유 추적용 — sample 길이를 늘려서 alert 본문 + 주변 HTML 다 보이게.
    const SAMPLE_LEN = step === "write_form" ? 4000 : 600;
    const sample = (() => {
      try {
        return iconv.decode(body, "cp949").slice(0, SAMPLE_LEN);
      } catch {
        return body.toString("utf8").slice(0, SAMPLE_LEN);
      }
    })();
    debug.push({
      step,
      status,
      body_len: body.length,
      body_sample: sample,
      set_cookies: setCookies,
      cookie_jar_after: jar.toHeader(),
      extra,
    });
  }

  // ── 1. 로그인 (또는 UMS_TEST_COOKIE 우회) ──
  const loginRes = skipLogin
    ? { body: Buffer.from("[skipped — using UMS_TEST_COOKIE]"), status: 200, setCookies: [] as string[] }
    : await umsViaCf(UMS_LOGIN_PATH, {
        method: "POST",
        body: Buffer.from(new URLSearchParams({
          user_id: input.ums_user_id,
          password: input.ums_password,
          s_url: "/bbs/zboard.php?id=samusil",
          group_no: "1",
        }).toString(), "utf8"),
        contentType: "application/x-www-form-urlencoded",
        referer: "http://www.ums.or.kr/bbs/login.php?id=samusil",
      });

  if (skipLogin) {
    // 환경변수 cookie 통째로 jar 에 박음 — 줄바꿈/탭/공백 정리 (Vercel UI 자동 줄바꿈 대비)
    const cleaned = (debugCookie as string).replace(/[\r\n\t]+/g, " ").trim();
    const cookies = cleaned.split(/;\s*/).filter(Boolean);
    jar.ingest(cookies);
    pushDebug("login_skipped", Buffer.from("UMS_TEST_COOKIE used"), 200, [], {
      cookies_loaded: String(cookies.length),
      raw_len: String((debugCookie as string).length),
      cleaned_len: String(cleaned.length),
    });
  } else {
    jar.ingest(loginRes.setCookies);
    pushDebug("login", loginRes.body, loginRes.status, loginRes.setCookies);
  }

  const loginHtml = skipLogin ? "[skipped]" : iconv.decode(loginRes.body, "cp949");
  if (!skipLogin) {
    const alertM = loginHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
    if (alertM) {
      const msg = alertM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      return { ok: false, error: `로그인 실패: ${msg}`, debug };
    }
  }
  if (!jar.get("PHPSESSID")) {
    return { ok: false, error: "PHPSESSID 쿠키 없음", debug };
  }

  // 사용자 PC F12 와 비교해서 발견한 인증/면제 cookie 들.
  // 핵심: ip_country=KR — UMS GeoIP cookie. 외국 IP 라도 KR 이면 스팸차단 면제.
  // 사용자는 평소 한국 IP 로 접속해서 이게 영구 저장됨 → 외국 VPN 켜도 KR 유지.
  // 우리 server-side fetch 는 매번 빈 cookie store 라 이게 없음 → 외국 IP 로 인식됨.
  //
  // ⚠️ login_1st 는 login_check.php 응답에서 서버가 직접 set 함.
  // 우리가 추가로 만들어 jar 에 넣으면 서버 발급 값을 덮어쓰게 되어
  // 시간 약간 차이로 회원 인식 깨짐. 따라서 jar.get 으로 이미 있는지 확인 후
  // 없을 때만 fallback 으로 추가.
  const extraCookies: string[] = [
    `ip_country=KR`,
    `list_type_samusil=0`,
    `list_num_samusil=20`,
    `recent_cate_samusil=${encodeURIComponent('{"key2":"부서주보"}')}`,
  ];
  if (!jar.get("login_1st")) {
    extraCookies.unshift(`login_1st=${makeLogin1stCookie()}`);
  }
  jar.ingest(extraCookies);

  // ── 1.4. UMS 메인 페이지 방문 (bookletSessionID 등 cookie 받기) ──
  const mainRes = await umsViaCf("/", {
    method: "GET",
    cookie: jar.toHeader(),
    referer: "http://www.ums.or.kr/bbs/login_check.php",
  });
  jar.ingest(mainRes.setCookies);
  pushDebug("visit_main", mainRes.body, mainRes.status, mainRes.setCookies, {
    main_body_len: mainRes.body.length,
  });

  // ── 1.5. 사람처럼 게시판 리스트 한 번 방문 (UMS 봇 감지 회피) ──
  const boardRes = await umsViaCf("/bbs/zboard.php?id=samusil&page=1", {
    method: "GET",
    cookie: jar.toHeader(),
    referer: "http://www.ums.or.kr/",
  });
  jar.ingest(boardRes.setCookies);
  // 회원 인식 여부 — board 응답에 "로그아웃" 링크 있으면 회원, "로그인" 만 있으면 비회원
  const boardHtmlSample = iconv.decode(boardRes.body, "cp949");
  const hasLogoutLink = /로그아웃/.test(boardHtmlSample);
  const hasLoginLink = /\/bbs\/login\.php/.test(boardHtmlSample);
  pushDebug("visit_board", boardRes.body, boardRes.status, boardRes.setCookies, {
    member_recognized: hasLogoutLink ? "yes (로그아웃 링크 있음)" : (hasLoginLink ? "no (로그인 링크만)" : "unknown"),
  });

  // 1.5초 대기 (사람 패턴)
  await new Promise((r) => setTimeout(r, 1500));

  // ── 2. write.php → pl_date 추출 (5회 재시도 + 다변수 진단) ──
  // 매 시도마다 IP, PHPSESSID, 경과시간, 응답사이즈, 통과여부 수집해서 패턴 파악.
  let wfRes!: Awaited<ReturnType<typeof umsViaCf>>;
  let wfHtml = "";
  let writeFormAttempts = 0;
  // D 진단 (5/5) 결과: 같은 PHPSESSID 로 5번 재시도 = 5번 다 같은 결과. 1회만 시도하고
  // 거부면 외부 wrapper (umsAutoPost) 가 새 login 으로 새 PHPSESSID 받아 재시도.
  const WF_MAX_ATTEMPTS = 1;
  const wfStartTime = Date.now();
  const wfAttempts: WriteFormAttempt[] = [];
  for (let attempt = 1; attempt <= WF_MAX_ATTEMPTS; attempt++) {
    writeFormAttempts = attempt;
    const attemptStart = Date.now();
    wfRes = await umsViaCf(UMS_WRITE_FORM_PATH, {
      method: "GET",
      cookie: jar.toHeader(),
      referer: "http://www.ums.or.kr/bbs/zboard.php?id=samusil&page=1",
    });
    jar.ingest(wfRes.setCookies);
    wfHtml = iconv.decode(wfRes.body, "cp949");
    const passed = /name=["']?pl_date["']?\s*[^>]*value=["']?\d+/i.test(wfHtml);
    wfAttempts.push({
      i: attempt,
      elapsed_ms: attemptStart - wfStartTime,
      worker_ip: wfRes.workerIp || "unknown",
      worker_country: wfRes.workerCountry || "unknown",
      worker_colo: wfRes.workerColo || "unknown",
      worker_placement: wfRes.workerPlacement || "unknown",
      phpsessid: (jar.get("PHPSESSID") || "").slice(0, 8),
      size: wfRes.body.length,
      passed,
    });
    if (passed) break;
    if (attempt < WF_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  // pl_date 매칭 — 더 관대하게 (attribute 순서/quote 변형 대비)
  const dateM =
    wfHtml.match(/name="pl_date"\s+value="(\d+)"/) ||
    wfHtml.match(/name=['"]?pl_date['"]?[^>]*value=['"]?(\d+)/i) ||
    wfHtml.match(/value=['"]?(\d+)['"]?[^>]*name=['"]?pl_date/i);
  const userM =
    wfHtml.match(/name="pl_user"\s+value="(umsorkr_[^"]+)"/) ||
    wfHtml.match(/name=['"]?pl_user['"]?[^>]*value=['"]?(umsorkr_[^"'\s>]+)/i);
  if (!dateM || !userM) {
    pushDebug("write_form", wfRes.body, wfRes.status, wfRes.setCookies);
    const wfAlert = wfHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
    const alertMsg = wfAlert ? wfAlert[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "(no alert)";
    return {
      ok: false,
      error: `write.php 폼 못 받음 (${writeFormAttempts}회 시도). 마지막 alert: "${alertMsg}". 시도별 데이터는 write_form_attempts 참조.`,
      debug,
      write_form_attempts: wfAttempts,
    };
  }
  const plDate = dateM[1];
  const plUser = userM[1];

  // 스팸차단 단서 추출: 안내문구 + hidden input + JS 변수 + 주석
  const spamDebug = extractSpamDebug(wfHtml);
  pushDebug("write_form", wfRes.body, wfRes.status, wfRes.setCookies, {
    pl_date: plDate,
    pl_user: plUser,
    spam_hint: spamDebug.hint,
  });

  // 🔬 dryRun — 1·2단계 통과 확인하고 종료. 글 등록 X, cooldown X.
  // 답 정밀 분석을 위해 spamDebug 도 응답에 포함.
  if (input.dryRun) {
    pushDebug("spam_analysis", Buffer.from(""), 200, [], {
      hint: spamDebug.hint.slice(0, 2000),
      fullContext_len: String(spamDebug.fullContext.length),
      hiddens_json: JSON.stringify(spamDebug.hiddens).slice(0, 2000),
      jsCandidates_count: String(spamDebug.jsCandidates.length),
      jsCandidates_first10: spamDebug.jsCandidates.slice(0, 10).join(" | ").slice(0, 1500),
      comments_count: String(spamDebug.comments.length),
      comments_first10: spamDebug.comments.slice(0, 10).map((c) => `[${c}]`).join(" ").slice(0, 1500),
      cookie_jar: jar.toHeader().slice(0, 500),
    });
    return {
      ok: true,
      pl_date: plDate,
      debug,
      write_form_attempts: wfAttempts,
    };
  }

  // ── 3. PDF 업로드 (Plupload — 1MB 단위 청크 분할) ──
  // PoC 메모: 1MB 초과 시 청크 나눠서 chunk=0..N, chunks=N+1 로 반복.
  // 단일 청크로 보내면 잘려서 UMS 가 invalid 처리 → 글은 등록되지만 첨부 누락.
  const CHUNK_SIZE = 1024 * 1024; // 1MB
  const totalChunks = Math.max(1, Math.ceil(input.pdf_bytes.byteLength / CHUNK_SIZE));
  const uploadUrl = `${UMS_UPLOAD_PATH}?pl_user=${plUser}&pl_zbid=samusil&pl_date=${plDate}`;
  const uploadResponses: string[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, input.pdf_bytes.byteLength);
    const chunkBytes = input.pdf_bytes.subarray(start, end);

    const uploadBoundary = "----chflowUp" + Math.random().toString(36).slice(2);
    const uploadBody = buildMultipart(uploadBoundary, [
      { name: "name", value: input.pdf_filename },
      { name: "chunk", value: String(i) },
      { name: "chunks", value: String(totalChunks) },
      { name: "file", value: chunkBytes, filename: input.pdf_filename, contentType: "application/pdf" },
    ]);

    const upRes = await umsViaCf(uploadUrl, {
      method: "POST",
      body: uploadBody,
      contentType: `multipart/form-data; boundary=${uploadBoundary}`,
      cookie: jar.toHeader(),
      referer: "http://www.ums.or.kr/bbs/write.php?id=samusil&page=1&category=2&mode=write",
      xRequestedWith: "XMLHttpRequest",
    });
    jar.ingest(upRes.setCookies);
    const upText = upRes.body.toString("utf8");
    uploadResponses.push(upText.slice(0, 200));
    pushDebug(`upload_chunk_${i}`, upRes.body, upRes.status, upRes.setCookies, {
      chunk_index: i,
      chunks_total: totalChunks,
      chunk_bytes: chunkBytes.byteLength,
      upload_text: upText.slice(0, 200),
    });

    // 정상 응답: {"jsonrpc":"2.0","result":null,"id":"id"} 또는 유사한 형태
    // 거부 응답: error / fault 필드 또는 status >= 400
    const hasError = /"error"|"fault"/i.test(upText);
    const hasResult = upText.includes('"result"');
    if (upRes.status >= 400 || !hasResult || hasError) {
      return {
        ok: false,
        error: `PDF 업로드 실패 (chunk ${i + 1}/${totalChunks}, ${chunkBytes.byteLength}바이트): status ${upRes.status} body="${upText.slice(0, 300)}"`,
        debug,
      };
    }
  }
  pushDebug("upload_complete", Buffer.from(""), 200, [], {
    pdf_size: input.pdf_bytes.byteLength,
    total_chunks: totalChunks,
    all_responses: uploadResponses.join(" | "),
  });

  // ── 4. write_ok.php — CP949 multipart + 스팸차단 답 후보 다양화 ──
  // UMS 가 외국 IP 에선 w_key_spam 답변 검증. "명성교회" 거부 확인됨 (5/6 진단).
  // 폼 안내문: "명성교회 ('예' 김종혁목사) 을 적어주세요"
  // 후보 환경변수 UMS_SPAM_ANSWERS (CSV) 또는 default 4개 시도.
  const cp = (s: string) => iconv.encode(s, "cp949");
  const category = input.category ?? 2;
  const spamCandidatesRaw = process.env.UMS_SPAM_ANSWERS;
  const spamCandidates = spamCandidatesRaw
    ? spamCandidatesRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : ["김종혁목사", "명성교회", "김종혁", "예 김종혁목사"];

  let woRes!: Awaited<ReturnType<typeof umsViaCf>>;
  let woHtml = "";
  let lastSpamMsg = "";
  let writeOkPassed = false;
  for (let si = 0; si < spamCandidates.length; si++) {
    const spamAnswer = spamCandidates[si];
    const writeOkBoundary = "----chflowWo" + Math.random().toString(36).slice(2);
    const writeOkBody = buildMultipart(writeOkBoundary, [
      { name: "page", value: cp("1") },
      { name: "id", value: cp("samusil") },
      { name: "no", value: cp("") },
      { name: "select_arrange", value: cp("") },
      { name: "desc", value: cp("") },
      { name: "page_num", value: cp("") },
      { name: "keyword", value: cp("") },
      { name: "category", value: cp(String(category)) },
      { name: "sfl", value: cp("") },
      { name: "mode", value: cp("write") },
      { name: "pl_user", value: cp(plUser) },
      { name: "pl_date", value: cp(plDate) },
      { name: "reg_date_change", value: cp("") },
      { name: "NameCheck", value: cp("N") },
      { name: "w_key_spam", value: cp(spamAnswer) },
      { name: "subject", value: cp(input.subject) },
      { name: "memo", value: cp(input.memo) },
    ]);
    woRes = await umsViaCf(UMS_WRITE_OK_PATH, {
      method: "POST",
      body: writeOkBody,
      contentType: `multipart/form-data; boundary=${writeOkBoundary}`,
      cookie: jar.toHeader(),
      referer: "http://www.ums.or.kr/bbs/write.php?id=samusil&page=1&category=2&mode=write",
      origin: "http://www.ums.or.kr",
    });
    jar.ingest(woRes.setCookies);
    woHtml = iconv.decode(woRes.body, "cp949");
    pushDebug(`write_ok_try_${si + 1}`, woRes.body, woRes.status, woRes.setCookies, {
      spam_answer_tried: spamAnswer,
      response_size: woRes.body.length,
    });

    // 통과 = refresh meta 동봉
    if (woHtml.includes('http-equiv="refresh"')) {
      writeOkPassed = true;
      break;
    }

    // 거부 — alert 분석
    const woAlert = woHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
    lastSpamMsg = woAlert
      ? woAlert[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : "(no alert)";

    // 스팸차단 외 다른 거부 (예: cooldown, 권한 X) 면 더 시도해도 무의미 — break
    if (!lastSpamMsg.includes("스팸")) {
      break;
    }
  }

  if (!writeOkPassed) {
    let extra = "";
    if (lastSpamMsg.includes("스팸")) {
      const hiddenSummary = Object.entries(spamDebug.hiddens)
        .filter(([k]) => /spam|key|answer|check|w_/i.test(k))
        .map(([k, v]) => `${k}="${v}"`)
        .join(", ");
      const jsSummary = spamDebug.jsCandidates.slice(0, 5).join(" | ");
      const cmtSummary = spamDebug.comments.slice(0, 3).map((c) => `[${c}]`).join(" ");
      extra =
        `\n[시도한 답들] ${spamCandidates.map((c) => `"${c}"`).join(", ")}` +
        `\n[폼안내] ${spamDebug.hint.slice(0, 800)}` +
        (hiddenSummary ? `\n[hidden] ${hiddenSummary}` : "") +
        (jsSummary ? `\n[JS] ${jsSummary}` : "") +
        (cmtSummary ? `\n[주석] ${cmtSummary}` : "");
    }
    return { ok: false, error: `등록 실패: ${lastSpamMsg}${extra}`, pl_date: plDate, debug };
  }

  const refreshM = woHtml.match(/<meta\s+http-equiv="refresh"[^>]*url=([^"'>\s]+)/i);
  const noM = refreshM && refreshM[1].match(/[?&]no=(\d+)/);
  if (!noM) {
    return { ok: false, error: `글번호 추출 실패: ${woHtml.slice(0, 300)}`, pl_date: plDate, debug };
  }

  return {
    ok: true,
    post_no: parseInt(noM[1], 10),
    redirect_url: refreshM[1],
    pl_date: plDate,
    debug,
  };
}
