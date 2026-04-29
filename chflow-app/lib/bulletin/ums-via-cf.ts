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
}

export async function umsAutoPost(input: UmsAutoPostInput): Promise<UmsAutoPostResult> {
  const jar = new CookieJar();

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

  const loginHtml = iconv.decode(loginRes.body, "cp949");
  const alertM = loginHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (alertM) {
    const msg = alertM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return { ok: false, error: `로그인 실패: ${msg}` };
  }
  if (!jar.get("PHPSESSID")) {
    return { ok: false, error: "로그인 실패: PHPSESSID 쿠키 없음" };
  }

  // ── 2. write.php → pl_date 추출 ──
  const wfRes = await umsViaCf(UMS_WRITE_FORM_PATH, {
    method: "GET",
    cookie: jar.toHeader(),
    referer: "http://www.ums.or.kr/bbs/zboard.php?id=samusil",
  });
  jar.ingest(wfRes.setCookies);

  const wfHtml = iconv.decode(wfRes.body, "cp949");
  if (wfHtml.length < 5000 || wfHtml.includes("사용권한이 없습니다")) {
    return { ok: false, error: `write.php 접근 실패 (응답 ${wfHtml.length}자)` };
  }
  const dateM = wfHtml.match(/name="pl_date"\s+value="(\d+)"/);
  const userM = wfHtml.match(/name="pl_user"\s+value="(umsorkr_[^"]+)"/);
  if (!dateM || !userM) {
    return { ok: false, error: "pl_date/pl_user 추출 실패" };
  }
  const plDate = dateM[1];
  const plUser = userM[1];

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
  if (upRes.status >= 400 || !upText.includes('"result"')) {
    return { ok: false, error: `PDF 업로드 실패: ${upRes.status} ${upText.slice(0, 200)}` };
  }

  // ── 4. write_ok.php — CP949 multipart ──
  const cp = (s: string) => iconv.encode(s, "cp949");
  const category = input.category ?? 2;
  // 스팸차단 답변 — UMS 가 외국 IP(Cloudflare LAX 등)에 대해 요구할 수 있음
  // 폼 안내: "명성교회 ('예' 김종혁목사) 을 적어주세요"
  // 환경변수로 override 가능
  const spamAnswer = process.env.UMS_SPAM_ANSWER || "김종혁목사";
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

  const woHtml = iconv.decode(woRes.body, "cp949");
  const woAlert = woHtml.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (woAlert && !woHtml.includes('http-equiv="refresh"')) {
    const msg = woAlert[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return { ok: false, error: `등록 실패: ${msg}`, pl_date: plDate };
  }

  const refreshM = woHtml.match(/<meta\s+http-equiv="refresh"[^>]*url=([^"'>\s]+)/i);
  const noM = refreshM && refreshM[1].match(/[?&]no=(\d+)/);
  if (!noM) {
    return { ok: false, error: `글번호 추출 실패: ${woHtml.slice(0, 300)}`, pl_date: plDate };
  }

  return {
    ok: true,
    post_no: parseInt(noM[1], 10),
    redirect_url: refreshM[1],
    pl_date: plDate,
  };
}
