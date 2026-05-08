// chflow Vercel API 에서 ums.or.kr 으로 가는 모든 fetch 를 Cloudflare Worker proxy 거치게 함.
// Worker 가 IP 우회 역할만 담당, 모든 단계 로직과 인코딩은 여기 Vercel side 에서.
//
// 2026-05-08 단순화: ums 차단은 GET /bbs/zboard.php + GET /bbs/write.php 두 path 만.
// 다른 모든 path 는 클라우드 IP 에서 통과. 우리 흐름의 GET write.php (pl_date 추출) 가
// 사실 불필요했음 — pl_date 는 KST 14자리 timestamp 로 클라이언트가 직접 만들어도 ums 가 받아줌.
// → 4단계 (login + write_form GET + upload + write_ok) → 3단계 (login + upload + write_ok) 로 압축.
// 검증: post no=1468 (2026-05-08 AWS Seoul 클라우드 IP).

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

  const init: RequestInit = { method: opts.method || "GET", headers };
  if (opts.body) init.body = opts.body as BodyInit;

  const res = await fetch(url, init);
  const buf = Buffer.from(await res.arrayBuffer());

  const cookieB64 = res.headers.get("X-Forward-Set-Cookie-B64") || "";
  let setCookies: string[] = [];
  if (cookieB64) {
    try {
      const decoded = Buffer.from(cookieB64, "base64").toString("utf8");
      setCookies = decoded.split("\n").filter(Boolean);
    } catch {/* ignore */}
  }
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
    parts.push(typeof f.value === "string" ? Buffer.from(f.value, "utf8") : Buffer.from(f.value));
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(parts);
}

// ──────────────────────────────────────────────────
// UMS path
// ──────────────────────────────────────────────────
const UMS_LOGIN_PATH = "/bbs/login_check.php";
const UMS_UPLOAD_PATH = "/core/plupload/upload.php";
const UMS_WRITE_OK_PATH = "/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/write_ok.php";

// KST 현재시각 14자리 YYYYMMDDHHMMSS — pl_date 수동 생성용
function nowKstPlDate(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

// ──────────────────────────────────────────────────
// 자동등록 main flow
// ──────────────────────────────────────────────────
export interface UmsAutoPostInput {
  ums_user_id: string;
  ums_password: string;
  subject: string;
  memo: string;
  pdf_bytes: Buffer;
  pdf_filename: string;
  category?: number;
  // 진단 모드 — login 까지만 실행, upload/write_ok skip. cooldown 발동 X, 게시판 흔적 X.
  dryRun?: boolean;
}

export interface UmsAutoPostResult {
  ok: boolean;
  post_no?: number;
  redirect_url?: string;
  pl_date?: string;
  error?: string;
  debug?: DebugStep[];
  // legacy 응답 호환 — write_form GET 단계 제거됐으므로 항상 빈 배열.
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

export async function umsAutoPost(input: UmsAutoPostInput): Promise<UmsAutoPostResult> {
  const jar = new CookieJar();
  const debug: DebugStep[] = [];

  function pushDebug(step: string, body: Buffer, status: number, setCookies: string[], extra?: Record<string, string | number | undefined>) {
    const SAMPLE_LEN = step.startsWith("write_ok") ? 4000 : 600;
    const sample = (() => {
      try { return iconv.decode(body, "cp949").slice(0, SAMPLE_LEN); }
      catch { return body.toString("utf8").slice(0, SAMPLE_LEN); }
    })();
    debug.push({ step, status, body_len: body.length, body_sample: sample, set_cookies: setCookies, cookie_jar_after: jar.toHeader(), extra });
  }

  // ── 1. 로그인 (POST /bbs/login_check.php) ──
  // user_id 는 prefix 없이 raw 값으로. ums 가 내부에서 umsorkr_ prefix 붙여 검색.
  const cleanUserId = input.ums_user_id.replace(/^umsorkr_/, "");
  const loginBodyParams = new URLSearchParams();
  loginBodyParams.append("s_url", "/main/main.php");
  loginBodyParams.append("user_id", cleanUserId);
  loginBodyParams.append("password", input.ums_password);
  loginBodyParams.append("group_no", "1");
  const loginBodyBuf = Buffer.from(loginBodyParams.toString(), "utf8");

  const loginRes = await umsViaCf(UMS_LOGIN_PATH, {
    method: "POST",
    body: loginBodyBuf,
    contentType: "application/x-www-form-urlencoded",
    referer: "http://www.ums.or.kr/bbs/login.php?id=samusil",
  });
  jar.ingest(loginRes.setCookies);
  pushDebug("login", loginRes.body, loginRes.status, loginRes.setCookies, {
    worker_ip: loginRes.workerIp || "unknown",
    worker_country: loginRes.workerCountry || "unknown",
    worker_colo: loginRes.workerColo || "unknown",
  });

  const loginHtml = iconv.decode(loginRes.body, "cp949");
  const loginAlert = loginHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (loginAlert) {
    const msg = loginAlert[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return { ok: false, error: `로그인 실패: ${msg}`, debug, write_form_attempts: [] };
  }
  if (!jar.get("PHPSESSID") || !jar.get("login_1st")) {
    return { ok: false, error: `로그인 실패: 인증 쿠키 발급 안 됨 (PHPSESSID=${!!jar.get("PHPSESSID")}, login_1st=${!!jar.get("login_1st")})`, debug, write_form_attempts: [] };
  }

  // ── 2. pl_date 수동 생성 (GET write.php 차단되지만 어차피 검증 안 됨) ──
  const plDate = nowKstPlDate();
  const plUser = `umsorkr_${cleanUserId}`;
  pushDebug("manual_pl_date", Buffer.from(""), 200, [], { pl_date: plDate, pl_user: plUser });

  // dryRun → 여기까지 (login 통과 + 쿠키 발급 확인)
  if (input.dryRun) {
    return { ok: true, pl_date: plDate, debug, write_form_attempts: [] };
  }

  // ── 3. PDF 업로드 (1MB 청크) ──
  const CHUNK_SIZE = 1024 * 1024;
  const totalChunks = Math.max(1, Math.ceil(input.pdf_bytes.byteLength / CHUNK_SIZE));
  const uploadUrl = `${UMS_UPLOAD_PATH}?pl_user=${plUser}&pl_zbid=samusil&pl_date=${plDate}`;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, input.pdf_bytes.byteLength);
    const chunkBytes = input.pdf_bytes.subarray(start, end);
    const boundary = "----chflowUp" + Math.random().toString(36).slice(2);
    const upBody = buildMultipart(boundary, [
      { name: "name", value: input.pdf_filename },
      { name: "chunk", value: String(i) },
      { name: "chunks", value: String(totalChunks) },
      { name: "file", value: chunkBytes, filename: input.pdf_filename, contentType: "application/pdf" },
    ]);

    const upRes = await umsViaCf(uploadUrl, {
      method: "POST",
      body: upBody,
      contentType: `multipart/form-data; boundary=${boundary}`,
      cookie: jar.toHeader(),
      referer: "http://www.ums.or.kr/bbs/write.php?id=samusil&page=1&category=2&mode=write",
      xRequestedWith: "XMLHttpRequest",
    });
    jar.ingest(upRes.setCookies);
    const upText = upRes.body.toString("utf8");
    pushDebug(`upload_chunk_${i}`, upRes.body, upRes.status, upRes.setCookies, {
      chunk_index: i, chunks_total: totalChunks, chunk_bytes: chunkBytes.byteLength,
      response: upText.slice(0, 200),
    });

    // 정상: {"jsonrpc":"2.0","result":null,"id":"id"}
    if (upRes.status >= 400 || !upText.includes('"result"') || /"error"|"fault"/i.test(upText)) {
      return {
        ok: false,
        error: `PDF 업로드 실패 (chunk ${i + 1}/${totalChunks}, ${chunkBytes.byteLength}바이트): status ${upRes.status} body="${upText.slice(0, 300)}"`,
        debug, write_form_attempts: [],
      };
    }
  }

  // ── 4. write_ok.php POST (CP949) ──
  // 2026-05-09: 사용자 브라우저 form data 캡쳐 분석 결과 — 첨부파일 매핑은 form 의 view_mode_uploader+
  // uploader_count + uploader_N_name + uploader_N_status 필드로 ums 서버에 전달됨.
  // 옛 PoC 패턴이 4/28 에 동작했던 건 ums 가 그땐 pl_date 아래 파일 자동 매핑했기 때문.
  // 5/8 즈음 ums 가 이걸 끊고 form 필드 명시 의무화함 → 우리 첨부 누락의 진짜 원인.
  //
  // 스팸차단: ums 가 비-한국 residential IP (Cloudflare/AWS 포함) 에서는 w_key_spam 검증.
  // 폼 안내문: 명성교회 ("예" 김종혁목사) → 답변 "김종혁목사".
  // 사용자 가정 IP 에선 검증 안 함 → w_key_spam 무시되므로 항상 보내도 OK.
  // 답변 변경 가능성 대비 후보 loop (스팸 거부 alert 시 다음 후보 시도, 30초 cooldown 무관).
  const cp = (s: string) => iconv.encode(s, "cp949");
  const category = input.category ?? 2;
  const spamCandidates = (process.env.UMS_SPAM_ANSWERS || "김종혁목사,김종혁,명성교회,예 김종혁목사")
    .split(",").map((s) => s.trim()).filter(Boolean);

  let woHtml = "";
  let woRes!: Awaited<ReturnType<typeof umsViaCf>>;
  let lastSpamMsg = "";
  let writeOkPassed = false;

  for (let si = 0; si < spamCandidates.length; si++) {
    const spamAnswer = spamCandidates[si];
    const wokBoundary = "----chflowWo" + Math.random().toString(36).slice(2);
    // 2026-05-09 보수적 변경: 1469 만들었을 때 동작했던 OLD 필드 그대로 + 최소한만 추가.
    // (uploader_* 만 PDF 첨부에 필수, w_key_spam 은 cloud IP 스팸검증 통과용)
    const wokBody = buildMultipart(wokBoundary, [
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
      // 첨부파일 매핑 — 빠지면 PDF 안 붙음 (5/9 사용자 캡쳐로 확정)
      { name: "view_mode_uploader", value: cp("on") },
      { name: "uploader_0_name", value: cp(input.pdf_filename) },
      { name: "uploader_0_status", value: cp("done") },
      { name: "uploader_count", value: cp("1") },
    ]);

    woRes = await umsViaCf(UMS_WRITE_OK_PATH, {
      method: "POST",
      body: wokBody,
      contentType: `multipart/form-data; boundary=${wokBoundary}`,
      cookie: jar.toHeader(),
      referer: "http://www.ums.or.kr/bbs/write.php?id=samusil&page=1&category=2&mode=write",
      origin: "http://www.ums.or.kr",
    });
    jar.ingest(woRes.setCookies);
    woHtml = iconv.decode(woRes.body, "cp949");
    pushDebug(`write_ok_try_${si + 1}`, woRes.body, woRes.status, woRes.setCookies, {
      spam_answer: spamAnswer,
      response_size: woRes.body.length,
    });

    // redirect 감지 — ums 가 두 형식 사용:
    //  (a) 첨부 없을 때: <meta http-equiv="refresh" content="0; url=../../zboard.php?...&no=N">
    //  (b) 첨부 있을 때: <script>alert("등록 완료", "../../zboard.php?...&no=N&category=2");</script>
    // 둘 다 redirect URL 안에 [?&]no=N&category= 패턴 있으므로 그걸로 매칭.
    const redirectM = woHtml.match(/(\.\.\/\.\.\/zboard\.php\?[^"'>\s]*[?&]no=(\d+)&category=\d+)/);
    if (redirectM) {
      return {
        ok: true,
        post_no: parseInt(redirectM[2], 10),
        redirect_url: redirectM[1],
        pl_date: plDate,
        debug,
        write_form_attempts: [],
      };
    }

    // 거부 — alert 분석
    const alertM = woHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
    lastSpamMsg = alertM
      ? alertM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : "(no alert)";

    // 스팸차단 외 다른 거부 (cooldown, 권한 X 등) 면 더 시도 무의미
    if (!lastSpamMsg.includes("스팸")) break;
  }

  return {
    ok: false,
    error: `등록 실패: ${lastSpamMsg}`,
    pl_date: plDate, debug, write_form_attempts: [],
  };
}
