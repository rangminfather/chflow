// Supabase Edge Function: UMS 사무실 게시판 자동 글등록 (4단계 플로우 통째)
//
// Vercel 함수에서 직접 ums.or.kr 에 호출하면 일부 IP 가 차단되므로
// Cloudflare ICN 엣지 IP 를 가진 이 Edge Function 으로 우회.
//
// 입력 (POST JSON):
//   {
//     ums_user_id: "clyawy",
//     ums_password: "xxx",
//     subject: "...",
//     memo: "...",
//     pdf_base64: "...",
//     filename: "...pdf",
//     category: 2 (default)
//   }
//
// 출력 (JSON):
//   { ok: true, post_no: 1461, redirect_url: "..." }
//   { ok: false, error: "..." }
//
// 보안: --no-verify-jwt 로 배포. 자격증명을 caller 가 들고 와야 하므로
// caller 자체가 인증 책임을 짐 (chflow API 가 service_role 권한으로 호출).

// CP949 인코딩 (한국어). Deno 가 npm: 을 통해 iconv-lite 를 직접 import.
import iconv from "npm:iconv-lite@0.6.3";

const UMS = "http://ums.or.kr";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ──────────────────────────────────────────────────────────────────
// 쿠키 관리
// ──────────────────────────────────────────────────────────────────
class CookieJar {
  private store = new Map<string, string>();

  // Deno fetch Headers 의 getSetCookie() 는 array 반환 (web 표준).
  ingest(headers: Headers) {
    const cookies = headers.getSetCookie?.() ?? [];
    for (const c of cookies) {
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

// ──────────────────────────────────────────────────────────────────
// 짧은 응답에 대한 자동 재시도 (UMS 의 일시 차단 회피)
// ──────────────────────────────────────────────────────────────────
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { minBytes?: number; maxAttempts?: number } = {},
): Promise<{ res: Response; body: Uint8Array }> {
  const minBytes = opts.minBytes ?? 100;
  const maxAttempts = opts.maxAttempts ?? 5;

  let res!: Response;
  let body!: Uint8Array;

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 600 * i));
    res = await fetch(url, init);
    body = new Uint8Array(await res.clone().arrayBuffer());
    if (res.status < 400 && body.byteLength >= minBytes) break;
  }
  return { res, body };
}

// ──────────────────────────────────────────────────────────────────
// 4단계
// ──────────────────────────────────────────────────────────────────
async function login(jar: CookieJar, userId: string, password: string) {
  const formBody = new URLSearchParams({
    user_id: userId,
    password,
    s_url: "/bbs/zboard.php?id=samusil",
    group_no: "1",
  }).toString();

  const { res, body } = await fetchWithRetry(`${UMS}/bbs/login_check.php`, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/login.php?id=samusil`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody,
    redirect: "manual",
  }, { minBytes: 50 });

  jar.ingest(res.headers);

  const html = iconv.decode(body, "cp949");
  const m = html.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (m) {
    const msg = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    throw new Error(`로그인 실패: ${msg}`);
  }
  if (!jar.get("PHPSESSID")) {
    throw new Error("로그인 실패: PHPSESSID 쿠키를 받지 못함");
  }
}

async function getPlDate(jar: CookieJar): Promise<string> {
  const url = `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`;
  const { body } = await fetchWithRetry(url, {
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/zboard.php?id=samusil`,
      "Cookie": jar.toHeader(),
    },
  }, { minBytes: 50000 });  // 정상 응답은 100KB+, 14자 차단 응답은 짧음

  const html = iconv.decode(body, "cp949");
  if (html.includes("사용권한이 없습니다")) {
    throw new Error("write.php 접근 권한 없음 (세션 만료 가능)");
  }
  const m = html.match(/name="pl_date"\s+value="(\d+)"/);
  if (!m) {
    throw new Error(`pl_date 추출 실패 (응답 ${html.length}자)`);
  }
  return m[1];
}

async function uploadPdf(
  jar: CookieJar,
  umsUserId: string,
  plDate: string,
  pdfBytes: Uint8Array,
  filename: string,
) {
  const url =
    `${UMS}/core/plupload/upload.php` +
    `?pl_user=umsorkr_${umsUserId}` +
    `&pl_zbid=samusil` +
    `&pl_date=${plDate}`;

  const boundary = "----chflowMultipart" + Math.random().toString(36).slice(2);
  const body = buildMultipart(boundary, [
    { name: "name", value: filename },
    { name: "chunk", value: "0" },
    { name: "chunks", value: "1" },
    { name: "file", value: pdfBytes, filename, contentType: "application/pdf" },
  ]);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Cookie": jar.toHeader(),
    },
    body,
  });
  jar.ingest(res.headers);

  const text = await res.text();
  if (!res.ok || !text.includes('"result"')) {
    throw new Error(`PDF 업로드 실패 status=${res.status} body=${text.slice(0, 200)}`);
  }
}

async function submitWriteOk(
  jar: CookieJar,
  umsUserId: string,
  plDate: string,
  fields: { subject: string; memo: string; category: number },
): Promise<{ postNo: number; redirectUrl: string | null }> {
  const url = `${UMS}/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/write_ok.php`;
  const cp = (s: string): Uint8Array => iconv.encode(s, "cp949");

  const boundary = "----chflowMultipart" + Math.random().toString(36).slice(2);
  const body = buildMultipart(boundary, [
    { name: "page", value: cp("1") },
    { name: "id", value: cp("samusil") },
    { name: "no", value: cp("") },
    { name: "select_arrange", value: cp("") },
    { name: "desc", value: cp("") },
    { name: "page_num", value: cp("") },
    { name: "keyword", value: cp("") },
    { name: "category", value: cp(String(fields.category)) },
    { name: "sfl", value: cp("") },
    { name: "mode", value: cp("write") },
    { name: "pl_user", value: cp(`umsorkr_${umsUserId}`) },
    { name: "pl_date", value: cp(plDate) },
    { name: "reg_date_change", value: cp("") },
    { name: "NameCheck", value: cp("N") },
    { name: "subject", value: cp(fields.subject) },
    { name: "memo", value: cp(fields.memo) },
  ]);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`,
      "Origin": UMS,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Cookie": jar.toHeader(),
    },
    body,
    redirect: "manual",
  });
  jar.ingest(res.headers);

  const buf = new Uint8Array(await res.arrayBuffer());
  const html = iconv.decode(buf, "cp949");

  const alertM = html.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (alertM && !html.includes("meta http-equiv=\"refresh\"")) {
    const msg = alertM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    throw new Error(`글 등록 실패: ${msg}`);
  }

  const refreshM = html.match(/<meta\s+http-equiv="refresh"[^>]*url=([^"'>\s]+)/i);
  const redirectUrl = refreshM ? refreshM[1] : null;
  let postNo = 0;
  if (redirectUrl) {
    const noM = redirectUrl.match(/[?&]no=(\d+)/);
    if (noM) postNo = parseInt(noM[1], 10);
  }
  if (!postNo) {
    throw new Error(`글 등록 응답에서 글번호를 찾을 수 없음 (sample: ${html.slice(0, 200)})`);
  }
  return { postNo, redirectUrl };
}

// ──────────────────────────────────────────────────────────────────
// multipart/form-data 직접 빌드 (CP949 binary 섞기 위해)
// ──────────────────────────────────────────────────────────────────
type MultipartField = {
  name: string;
  value: string | Uint8Array;
  filename?: string;
  contentType?: string;
};

function buildMultipart(boundary: string, fields: MultipartField[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const f of fields) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) header += `; filename="${f.filename}"`;
    header += "\r\n";
    if (f.contentType) header += `Content-Type: ${f.contentType}\r\n`;
    header += "\r\n";
    parts.push(enc.encode(header));
    parts.push(typeof f.value === "string" ? enc.encode(f.value) : f.value);
    parts.push(enc.encode("\r\n"));
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));

  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ──────────────────────────────────────────────────────────────────
// HTTP 핸들러
// ──────────────────────────────────────────────────────────────────
interface PostBody {
  ums_user_id: string;
  ums_password: string;
  subject: string;
  memo: string;
  pdf_base64: string;
  filename: string;
  category?: number;
}

// 디버그용 진단 step 기록
interface DebugStep {
  name: string;
  status?: number;
  body_size?: number;
  body_sample?: string;
  cookies_after?: string;
  error?: string;
  attempt?: number;
}

async function debugLogin(jar: CookieJar, userId: string, password: string, debug: DebugStep[]): Promise<void> {
  const formBody = new URLSearchParams({
    user_id: userId,
    password,
    s_url: "/bbs/zboard.php?id=samusil",
    group_no: "1",
  }).toString();

  const { res, body } = await fetchWithRetry(`${UMS}/bbs/login_check.php`, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/login.php?id=samusil`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody,
    redirect: "manual",
  }, { minBytes: 50 });

  jar.ingest(res.headers);

  const html = iconv.decode(body, "cp949");
  debug.push({
    name: "login",
    status: res.status,
    body_size: body.byteLength,
    body_sample: html.slice(0, 300),
    cookies_after: jar.toHeader(),
  });

  const m = html.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (m) {
    const msg = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    throw new Error(`로그인 실패: ${msg}`);
  }
  if (!jar.get("PHPSESSID")) {
    throw new Error("로그인 실패: PHPSESSID 쿠키를 받지 못함");
  }
}

async function debugVisitBoardList(jar: CookieJar, debug: DebugStep[]): Promise<void> {
  // 실제 사용자 패턴 모방: 로그인 후 게시판 리스트로 한 번 들어감 (UMS 봇 감지 회피)
  const url = `${UMS}/bbs/zboard.php?id=samusil&page=1`;
  const { res, body } = await fetchWithRetry(url, {
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/login_check.php`,
      "Cookie": jar.toHeader(),
    },
  }, { minBytes: 5000 });

  jar.ingest(res.headers);
  const html = iconv.decode(body, "cp949");
  debug.push({
    name: "visit_board",
    status: res.status,
    body_size: body.byteLength,
    body_sample: html.slice(0, 200),
    cookies_after: jar.toHeader(),
  });
}

async function debugGetPlDate(jar: CookieJar, debug: DebugStep[]): Promise<string> {
  const url = `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`;
  const { res, body } = await fetchWithRetry(url, {
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/zboard.php?id=samusil&page=1`,
      "Cookie": jar.toHeader(),
    },
  }, { minBytes: 50000 });

  const html = iconv.decode(body, "cp949");
  debug.push({
    name: "get_write_form",
    status: res.status,
    body_size: body.byteLength,
    body_sample: html.slice(0, 300),
  });

  if (html.includes("사용권한이 없습니다")) {
    throw new Error("write.php 접근 권한 없음 (세션 만료 가능)");
  }
  const m = html.match(/name="pl_date"\s+value="(\d+)"/);
  if (!m) {
    throw new Error(`pl_date 추출 실패 (응답 ${html.length}자, sample: ${html.slice(0, 100)})`);
  }
  return m[1];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  let body: PostBody & { debug?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const required = ["ums_user_id", "ums_password", "subject", "memo", "pdf_base64", "filename"];
  for (const k of required) {
    if (!body[k as keyof PostBody]) {
      return new Response(JSON.stringify({ ok: false, error: `${k} is required` }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }
  }

  const debug: DebugStep[] = [];
  let outboundIp = "unknown";

  // 우리 outbound IP 확인 (UMS 차단 진단용)
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json");
    const ipData = await ipRes.json();
    outboundIp = ipData.ip;
  } catch {
    // 무시
  }

  try {
    const jar = new CookieJar();
    await debugLogin(jar, body.ums_user_id, body.ums_password, debug);
    await debugVisitBoardList(jar, debug);
    // 사람처럼 살짝 쉬기 (1.5초)
    await new Promise((r) => setTimeout(r, 1500));
    const plDate = await debugGetPlDate(jar, debug);
    const pdfBytes = base64ToBytes(body.pdf_base64);
    await uploadPdf(jar, body.ums_user_id, plDate, pdfBytes, body.filename);
    debug.push({ name: "upload_pdf_done" });
    const result = await submitWriteOk(jar, body.ums_user_id, plDate, {
      subject: body.subject,
      memo: body.memo,
      category: body.category ?? 2,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        post_no: result.postNo,
        redirect_url: result.redirectUrl,
        pl_date: plDate,
        outbound_ip: outboundIp,
        debug: body.debug ? debug : undefined,
      }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ ok: false, error: msg, outbound_ip: outboundIp, debug }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
});
