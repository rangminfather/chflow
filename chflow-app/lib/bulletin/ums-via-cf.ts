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
}

export interface UmsAutoPostResult {
  ok: boolean;
  post_no?: number;
  redirect_url?: string;
  pl_date?: string;
  error?: string;
  debug?: DebugStep[];
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
  // 1. w_key_spam 주변 2000자 (날 텍스트)
  const idx = html.indexOf("w_key_spam");
  let hint = "(not found)";
  let fullContext = "(not found)";
  if (idx > 0) {
    const start = Math.max(0, idx - 1500);
    const end = Math.min(html.length, idx + 500);
    fullContext = html.slice(start, end);
    hint = fullContext.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  // 2. 모든 hidden input — 정답이 hidden 으로 박혀있을 가능성
  const hiddens: Record<string, string> = {};
  const hiddenRe = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  const hiddenMatches = html.match(hiddenRe) || [];
  for (const h of hiddenMatches) {
    const nameM = h.match(/name=["']([^"']+)["']/);
    const valM = h.match(/value=["']([^"']*)["']/);
    if (nameM && valM) hiddens[nameM[1]] = valM[1].slice(0, 100);
  }

  // 3. JS 변수 안에 spam/key/answer/check 관련 (옛 zeroboard 가끔 클라이언트 검증)
  const jsCandidates: string[] = [];
  const jsRe = /(?:var|let|const)\s+(\w*(?:[Ss]pam|[Kk]ey|[Aa]nswer)\w*)\s*=\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = jsRe.exec(html)) !== null) {
    jsCandidates.push(`${m[1]}="${m[2]}"`);
  }

  // 4. HTML 주석 — admin 메모 / 정답 힌트
  const comments: string[] = [];
  const cmtRe = /<!--([\s\S]*?)-->/g;
  while ((m = cmtRe.exec(html)) !== null) {
    const c = m[1].trim();
    if (c && c.length < 300 && !/^\s*\/\//.test(c)) {
      // spam/key/answer 키워드 있는 주석 우선
      if (/spam|key|answer|차단|로봇/i.test(c)) {
        comments.unshift(c.slice(0, 200));
      } else if (comments.length < 10) {
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

export async function umsAutoPost(input: UmsAutoPostInput): Promise<UmsAutoPostResult> {
  const jar = new CookieJar();
  const debug: DebugStep[] = [];

  function pushDebug(step: string, body: Buffer, status: number, setCookies: string[], extra?: Record<string, string | number | undefined>) {
    const sample = (() => {
      try {
        return iconv.decode(body, "cp949").slice(0, 400);
      } catch {
        return body.toString("utf8").slice(0, 400);
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

  // ── 1. 로그인 ──
  const loginBody = new URLSearchParams({
    user_id: input.ums_user_id,
    password: input.ums_password,
    s_url: "/bbs/zboard.php?id=samusil",
    group_no: "1",
  }).toString();

  const loginRes = await umsViaCf(UMS_LOGIN_PATH, {
    method: "POST",
    body: Buffer.from(loginBody, "utf8"),
    contentType: "application/x-www-form-urlencoded",
    referer: "http://www.ums.or.kr/bbs/login.php?id=samusil",
  });
  jar.ingest(loginRes.setCookies);
  pushDebug("login", loginRes.body, loginRes.status, loginRes.setCookies);

  const loginHtml = iconv.decode(loginRes.body, "cp949");
  const alertM = loginHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (alertM) {
    const msg = alertM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return { ok: false, error: `로그인 실패: ${msg}`, debug };
  }
  if (!jar.get("PHPSESSID")) {
    return { ok: false, error: "로그인 실패: PHPSESSID 쿠키 없음", debug };
  }

  // 사용자 PC F12 와 비교해서 발견한 인증/면제 cookie 들.
  // 핵심: ip_country=KR — UMS GeoIP cookie. 외국 IP 라도 KR 이면 스팸차단 면제.
  // 사용자는 평소 한국 IP 로 접속해서 이게 영구 저장됨 → 외국 VPN 켜도 KR 유지.
  // 우리 server-side fetch 는 매번 빈 cookie store 라 이게 없음 → 외국 IP 로 인식됨.
  jar.ingest([
    `login_1st=${makeLogin1stCookie()}`,
    `ip_country=KR`,
    `list_type_samusil=0`,
    `list_num_samusil=20`,
    `recent_cate_samusil=${encodeURIComponent('{"key2":"부서주보"}')}`,
  ]);

  // ── 1.5. 사람처럼 게시판 리스트 한 번 방문 (UMS 봇 감지 회피) ──
  const boardRes = await umsViaCf("/bbs/zboard.php?id=samusil&page=1", {
    method: "GET",
    cookie: jar.toHeader(),
    referer: "http://www.ums.or.kr/bbs/login_check.php",
  });
  jar.ingest(boardRes.setCookies);
  pushDebug("visit_board", boardRes.body, boardRes.status, boardRes.setCookies);

  // 1.5초 대기 (사람 패턴)
  await new Promise((r) => setTimeout(r, 1500));

  // ── 2. write.php → pl_date 추출 ──
  const wfRes = await umsViaCf(UMS_WRITE_FORM_PATH, {
    method: "GET",
    cookie: jar.toHeader(),
    referer: "http://www.ums.or.kr/bbs/zboard.php?id=samusil&page=1",
  });
  jar.ingest(wfRes.setCookies);

  const wfHtml = iconv.decode(wfRes.body, "cp949");
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
    // 응답 진단 — 정확히 뭐가 있고 뭐가 없는지
    const hasForm = /<form[^>]*name=["']?psm_form/i.test(wfHtml);
    const hasFormAny = /<form[^>]+>/i.test(wfHtml);
    const hasPlDateString = wfHtml.includes("pl_date");
    const hasMemo = /name=["']?memo["']?/i.test(wfHtml);
    const alertIdx = wfHtml.indexOf("alertElmBody");
    const wfAlert = wfHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
    const alertMsg = wfAlert ? wfAlert[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "(no alert)";
    const tail = wfHtml.slice(-500).replace(/\s+/g, " ");
    return {
      ok: false,
      error:
        `write.php 폼 못 받음 (응답 ${wfHtml.length}자) ` +
        `[form psm_form: ${hasForm}, form 임의: ${hasFormAny}, ` +
        `pl_date 문자열: ${hasPlDateString}, memo input: ${hasMemo}, ` +
        `alert위치: ${alertIdx}/${wfHtml.length}, alert: "${alertMsg}"] ` +
        `[login 응답 ${loginRes.body.length}자, login set-cookies: ${loginRes.setCookies.join("|")}] ` +
        `[visit_board 응답 ${boardRes.body.length}자, board set-cookies: ${boardRes.setCookies.join("|")}] ` +
        `[write_form set-cookies: ${wfRes.setCookies.join("|")}] ` +
        `[현재 jar: ${jar.toHeader()}] ` +
        `tail="${tail}"`,
      debug,
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

  // ── 3. PDF 업로드 ──
  const uploadBoundary = "----chflowUp" + Math.random().toString(36).slice(2);
  const uploadBody = buildMultipart(uploadBoundary, [
    { name: "name", value: input.pdf_filename },
    { name: "chunk", value: "0" },
    { name: "chunks", value: "1" },
    { name: "file", value: input.pdf_bytes, filename: input.pdf_filename, contentType: "application/pdf" },
  ]);
  const upRes = await umsViaCf(
    `${UMS_UPLOAD_PATH}?pl_user=${plUser}&pl_zbid=samusil&pl_date=${plDate}`,
    {
      method: "POST",
      body: uploadBody,
      contentType: `multipart/form-data; boundary=${uploadBoundary}`,
      cookie: jar.toHeader(),
      referer: "http://www.ums.or.kr/bbs/write.php?id=samusil&page=1&category=2&mode=write",
      xRequestedWith: "XMLHttpRequest",
    },
  );
  jar.ingest(upRes.setCookies);
  const upText = upRes.body.toString("utf8");
  pushDebug("upload", upRes.body, upRes.status, upRes.setCookies, { upload_text_sample: upText.slice(0, 200) });
  if (upRes.status >= 400 || !upText.includes('"result"')) {
    return { ok: false, error: `PDF 업로드 실패: ${upRes.status} ${upText.slice(0, 200)}`, debug };
  }

  // ── 4. write_ok.php — CP949 multipart ──
  // 외국 IP (Cloudflare LAX 등) 에서는 w_key_spam 답변 필요.
  // 정답이 폼 안내에 따라 달라지므로 환경변수 UMS_SPAM_ANSWER 로 override 가능.
  const cp = (s: string) => iconv.encode(s, "cp949");
  const category = input.category ?? 2;
  const spamAnswer = process.env.UMS_SPAM_ANSWER || "명성교회";
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
  const woRes = await umsViaCf(UMS_WRITE_OK_PATH, {
    method: "POST",
    body: writeOkBody,
    contentType: `multipart/form-data; boundary=${writeOkBoundary}`,
    cookie: jar.toHeader(),
    referer: "http://www.ums.or.kr/bbs/write.php?id=samusil&page=1&category=2&mode=write",
    origin: "http://www.ums.or.kr",
  });
  jar.ingest(woRes.setCookies);
  pushDebug("write_ok", woRes.body, woRes.status, woRes.setCookies, {
    cookie_sent: jar.toHeader().slice(0, 200),
  });

  const woHtml = iconv.decode(woRes.body, "cp949");
  const woAlert = woHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (woAlert && !woHtml.includes('http-equiv="refresh"')) {
    const msg = woAlert[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    // 스팸차단 거부 시 폼 응답 분석 단서 모두 노출
    let extra = "";
    if (msg.includes("스팸")) {
      const hiddenSummary = Object.entries(spamDebug.hiddens)
        .filter(([k]) => /spam|key|answer|check|w_/i.test(k))
        .map(([k, v]) => `${k}="${v}"`)
        .join(", ");
      const jsSummary = spamDebug.jsCandidates.slice(0, 5).join(" | ");
      const cmtSummary = spamDebug.comments.slice(0, 3).map((c) => `[${c}]`).join(" ");
      extra =
        `\n[보낸답] "${spamAnswer}"` +
        `\n[폼안내] ${spamDebug.hint.slice(0, 800)}` +
        (hiddenSummary ? `\n[hidden] ${hiddenSummary}` : "") +
        (jsSummary ? `\n[JS] ${jsSummary}` : "") +
        (cmtSummary ? `\n[주석] ${cmtSummary}` : "");
    }
    return { ok: false, error: `등록 실패: ${msg}${extra}`, pl_date: plDate, debug };
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
