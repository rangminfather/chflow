// ums.or.kr 사무실 게시판 자동 글등록 클라이언트.
//
// 4단계 플로우:
//   1) POST /bbs/login_check.php          → PHPSESSID 쿠키
//   2) GET  /bbs/write.php?...             → pl_date 추출
//   3) POST /core/plupload/upload.php      → 파일 업로드
//   4) POST /bbs/skin/.../write_ok.php     → 글 등록 (CP949)
//
// 로컬 PoC 로 검증 완료 (2026-04-28). 자세한 사양은 메모리 참조.

import iconv from "iconv-lite";

const UMS = "http://ums.or.kr";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

// ──────────────────────────────────────────────────────────────────
// 쿠키 관리 (Node fetch 는 자동 cookie jar 가 없어서 직접)
// ──────────────────────────────────────────────────────────────────
class CookieJar {
  private store = new Map<string, string>();

  ingest(setCookieHeader: string | null) {
    if (!setCookieHeader) return;
    // Node fetch 의 Headers.get('set-cookie') 는 ', ' 로 join 됨.
    // 'expires=Sun, 01 Jan' 같은 콤마가 들어가서 안전 분할이 어려운데,
    // 우리에게 필요한 PHPSESSID, login_1st 만 잡으면 됨.
    const cookies = splitSetCookie(setCookieHeader);
    for (const c of cookies) {
      const semi = c.indexOf(";");
      const kv = (semi > 0 ? c.slice(0, semi) : c).trim();
      const eq = kv.indexOf("=");
      if (eq < 0) continue;
      const key = kv.slice(0, eq).trim();
      const val = kv.slice(eq + 1).trim();
      if (val === "deleted") {
        this.store.delete(key);
      } else {
        this.store.set(key, val);
      }
    }
  }

  toHeader(): string {
    return Array.from(this.store.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  get(name: string): string | undefined {
    return this.store.get(name);
  }
}

// 'expires=Sun, 01 Jan 2026' 류 쉼표를 보존하면서 cookie 들 분리.
// 휴리스틱: 쉼표 직후가 ' DDD,' 같은 요일 아닌 경우에만 분할.
function splitSetCookie(header: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (c === ",") {
      // 다음 6자가 'DDD ' (요일 + 공백/숫자) 이면 안 자름
      const peek = header.slice(i + 1, i + 7).trim();
      const isWeekday = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(peek);
      if (isWeekday) { buf += c; continue; }
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

// ──────────────────────────────────────────────────────────────────
// 1) 로그인
// ──────────────────────────────────────────────────────────────────
export async function loginUms(userId: string, password: string): Promise<CookieJar> {
  const jar = new CookieJar();

  const body = new URLSearchParams({
    user_id: userId,
    password: password,
    s_url: "/bbs/zboard.php?id=samusil",
    group_no: "1",
  }).toString();

  const res = await fetch(`${UMS}/bbs/login_check.php`, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/login.php?id=samusil`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "manual",
  });

  jar.ingest(res.headers.get("set-cookie"));

  // 응답 분석: 알림창("alertElmBody") 들어가면 실패
  const buf = Buffer.from(await res.arrayBuffer());
  const html = iconv.decode(buf, "cp949");
  const m = html.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (m) {
    const msg = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    throw new Error(`로그인 실패: ${msg}`);
  }

  // PHPSESSID + login_1st 둘 다 있어야 진짜 로그인된 상태
  if (!jar.get("PHPSESSID")) {
    throw new Error("로그인 실패: PHPSESSID 쿠키를 받지 못함");
  }
  // login_1st 가 없으면 의심스럽지만 가끔 있어도 통과 — 일단 통과 처리

  return jar;
}

// ──────────────────────────────────────────────────────────────────
// 2) write.php 에서 pl_date 추출
// ──────────────────────────────────────────────────────────────────
export async function getPlDate(jar: CookieJar): Promise<string> {
  const res = await fetch(
    `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`,
    {
      headers: {
        ...BROWSER_HEADERS,
        "Referer": `${UMS}/bbs/zboard.php?id=samusil`,
        "Cookie": jar.toHeader(),
      },
    },
  );
  jar.ingest(res.headers.get("set-cookie"));

  const buf = Buffer.from(await res.arrayBuffer());
  const html = iconv.decode(buf, "cp949");

  if (html.includes("사용권한이 없습니다")) {
    throw new Error("write.php 접근 권한 없음 (세션 만료 가능)");
  }

  const m = html.match(/name="pl_date"\s+value="(\d+)"/);
  if (!m) {
    throw new Error(`pl_date 를 찾을 수 없음 (응답 ${html.length}자)`);
  }
  return m[1];
}

// ──────────────────────────────────────────────────────────────────
// 3) PDF 업로드 (Plupload single-chunk multipart)
// ──────────────────────────────────────────────────────────────────
export async function uploadPdf(
  jar: CookieJar,
  umsUserId: string,
  plDate: string,
  pdfBuffer: Uint8Array,
  filename: string,
): Promise<void> {
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
    { name: "file", value: pdfBuffer, filename, contentType: "application/pdf" },
  ]);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Referer": `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Cookie": jar.toHeader(),
      "Content-Length": String(body.byteLength),
    },
    body: body as unknown as BodyInit,
  });
  jar.ingest(res.headers.get("set-cookie"));

  const text = await res.text();
  if (!res.ok || !text.includes('"result"')) {
    throw new Error(`PDF 업로드 실패 status=${res.status} body=${text.slice(0, 200)}`);
  }
}

// ──────────────────────────────────────────────────────────────────
// 4) 글 등록 (write_ok.php) — CP949 인코딩
// ──────────────────────────────────────────────────────────────────
export interface WriteOkResult {
  postNo: number | null;
  redirectUrl: string | null;
}

export async function submitWriteOk(
  jar: CookieJar,
  umsUserId: string,
  plDate: string,
  fields: { subject: string; memo: string; category?: number },
): Promise<WriteOkResult> {
  const url = `${UMS}/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/write_ok.php`;
  const category = fields.category ?? 2;

  // 모든 텍스트 필드는 CP949 로 인코딩해서 multipart 에 넣음.
  const cp = (s: string) => iconv.encode(s, "cp949");

  const boundary = "----chflowMultipart" + Math.random().toString(36).slice(2);
  const body = buildMultipart(boundary, [
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
      "Content-Length": String(body.byteLength),
    },
    body: body as unknown as BodyInit,
    redirect: "manual",
  });
  jar.ingest(res.headers.get("set-cookie"));

  // 응답 본문에서 새 글 번호 추출 (meta-refresh url=...&no=NNNN)
  const buf = Buffer.from(await res.arrayBuffer());
  const html = iconv.decode(buf, "cp949");

  // 알림 메시지 (실패 시)
  const alertM = html.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
  if (alertM && !html.includes("meta http-equiv=\"refresh\"")) {
    const msg = alertM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    throw new Error(`글 등록 실패: ${msg}`);
  }

  // 성공: meta-refresh URL 에서 no 추출
  const refreshM = html.match(/<meta\s+http-equiv="refresh"[^>]*url=([^"'>\s]+)/i);
  const redirectUrl = refreshM ? refreshM[1] : null;
  let postNo: number | null = null;
  if (redirectUrl) {
    const noM = redirectUrl.match(/[?&]no=(\d+)/);
    if (noM) postNo = parseInt(noM[1], 10);
  }

  if (!postNo) {
    throw new Error(`글 등록 응답에서 글번호를 찾을 수 없음 (body sample: ${html.slice(0, 200)})`);
  }

  return { postNo, redirectUrl };
}

// ──────────────────────────────────────────────────────────────────
// multipart/form-data 직접 빌드 (CP949 인코딩 가능하게)
// ──────────────────────────────────────────────────────────────────
type MultipartField =
  | { name: string; value: string | Uint8Array | Buffer; filename?: string; contentType?: string };

function buildMultipart(boundary: string, fields: MultipartField[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) header += `; filename="${f.filename}"`;
    header += "\r\n";
    if (f.contentType) header += `Content-Type: ${f.contentType}\r\n`;
    header += "\r\n";
    parts.push(new TextEncoder().encode(header));

    if (typeof f.value === "string") {
      parts.push(new TextEncoder().encode(f.value));
    } else {
      parts.push(f.value);
    }
    parts.push(new TextEncoder().encode("\r\n"));
  }
  parts.push(new TextEncoder().encode(`--${boundary}--\r\n`));

  // Concat
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
