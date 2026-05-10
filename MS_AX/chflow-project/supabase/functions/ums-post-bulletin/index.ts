// Supabase Edge Function: UMS 사무실 게시판 자동 글등록 (3단계 플로우)
//
// 2026-05-10 production-quality 재작성:
// - 5/8 path-specific 차단 발견 → GET write.php 단계 제거, 수동 pl_date 사용
// - 5/9 사용자 캡쳐 분석 → uploader_* 필드 추가 (PDF 매핑 필수)
// - 5/9 spam check → w_key_spam=김종혁목사 + fallback 후보 loop
// - 5/9 응답 형식 → meta refresh + script alert 둘 다 매칭
// - 5/10 Cloudflare Worker rate-limit 발견 → AWS Seoul edge 로 우회 (AS16509)
//
// 입력 (POST JSON):
//   {
//     ums_user_id: "clyawy",         // raw, prefix 없음
//     ums_password: "xxx",            // 평문 (caller 가 복호화 후 전달)
//     subject: "...",
//     memo: "...",
//     pdf_base64: "...",
//     pdf_filename: "...pdf",
//     category?: 2,                   // 기본 2
//     dryRun?: false,                 // true 면 login 까지만
//   }
//
// 출력 (JSON):
//   { ok: true, post_no: 1488, redirect_url: "...", pl_date: "...", outbound_ip: "...", debug?: [...] }
//   { ok: false, error: "...", pl_date?: "...", outbound_ip: "...", debug?: [...] }
//
// 보안: --no-verify-jwt 로 배포. caller (chflow Vercel API) 가 자격증명 책임.

import iconv from "npm:iconv-lite@0.6.3";

const UMS = "http://www.ums.or.kr";
const REFERER = `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate",
  "Cache-Control": "max-age=0",
  "Upgrade-Insecure-Requests": "1",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ──────────────────────────────────────────────────────────────────
class CookieJar {
  private store = new Map<string, string>();
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
  toHeader(): string { return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  get(name: string): string | undefined { return this.store.get(name); }
}

type MultipartField = { name: string; value: string | Uint8Array; filename?: string; contentType?: string };

function buildMultipart(boundary: string, fields: MultipartField[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  const CRLF = "\r\n";
  for (const f of fields) {
    let header = `--${boundary}${CRLF}Content-Disposition: form-data; name="${f.name}"`;
    if (f.filename) header += `; filename="${f.filename}"`;
    header += CRLF;
    if (f.contentType) header += `Content-Type: ${f.contentType}${CRLF}`;
    header += CRLF;
    parts.push(enc.encode(header));
    parts.push(typeof f.value === "string" ? enc.encode(f.value) : f.value);
    parts.push(enc.encode(CRLF));
  }
  parts.push(enc.encode(`--${boundary}--${CRLF}`));
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// KST 현재시각 14자리
function nowKstPlDate(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

// ──────────────────────────────────────────────────────────────────
interface PostBody {
  ums_user_id: string;
  ums_password: string;
  subject: string;
  memo: string;
  pdf_base64?: string;
  pdf_filename?: string;
  category?: number;
  dryRun?: boolean;
}

interface DebugStep {
  step: string;
  status?: number;
  body_size?: number;
  body_sample?: string;
  cookies_after?: string;
  extra?: Record<string, string | number>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  let body: PostBody;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const debug: DebugStep[] = [];

  // outbound IP 진단
  let outboundIp = "unknown";
  let outboundOrg = "unknown";
  try {
    const ipRes = await fetch("https://ipinfo.io/json");
    const ipData = await ipRes.json();
    outboundIp = ipData.ip;
    outboundOrg = ipData.org;
  } catch {/* ignore */}

  try {
    if (!body.ums_user_id || !body.ums_password || !body.subject || !body.memo) {
      throw new Error("ums_user_id/ums_password/subject/memo 필수");
    }
    if (!body.dryRun && (!body.pdf_base64 || !body.pdf_filename)) {
      throw new Error("pdf_base64/pdf_filename 필수 (dryRun 아니면)");
    }

    const cleanUserId = body.ums_user_id.replace(/^umsorkr_/, "");
    const plUser = `umsorkr_${cleanUserId}`;
    const category = body.category ?? 2;

    // ── 1. login ──
    const jar = new CookieJar();
    {
      const loginParams = new URLSearchParams({
        s_url: "/main/main.php",
        user_id: cleanUserId,
        password: body.ums_password,
        group_no: "1",
      });
      const res = await fetch(`${UMS}/bbs/login_check.php`, {
        method: "POST",
        headers: {
          ...BROWSER_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": `${UMS}/bbs/login.php?id=samusil`,
        },
        body: loginParams.toString(),
        redirect: "manual",
      });
      jar.ingest(res.headers);
      const buf = new Uint8Array(await res.arrayBuffer());
      const html = iconv.decode(buf, "cp949");
      debug.push({ step: "login", status: res.status, body_size: buf.byteLength, cookies_after: jar.toHeader() });

      const m = html.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
      if (m) {
        const msg = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        throw new Error(`로그인 실패: ${msg}`);
      }
      if (!jar.get("PHPSESSID") || !jar.get("login_1st")) {
        throw new Error(`로그인 실패: 인증 쿠키 발급 안 됨 (PHPSESSID=${!!jar.get("PHPSESSID")}, login_1st=${!!jar.get("login_1st")})`);
      }
    }

    // ── 2. pl_date 수동 (GET write.php 차단되지만 검증 안 함) ──
    const plDate = nowKstPlDate();
    debug.push({ step: "manual_pl_date", extra: { pl_date: plDate, pl_user: plUser } });

    if (body.dryRun) {
      return new Response(
        JSON.stringify({ ok: true, dryRun: true, pl_date: plDate, outbound_ip: outboundIp, outbound_org: outboundOrg, debug }),
        { headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    // ── 3. PDF 업로드 (1MB 청크) ──
    const pdfBytes = base64ToBytes(body.pdf_base64!);
    if (pdfBytes.byteLength < 100) throw new Error("PDF 너무 작음");
    const filename = body.pdf_filename!;

    const CHUNK_SIZE = 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(pdfBytes.byteLength / CHUNK_SIZE));
    const uploadUrl =
      `${UMS}/core/plupload/upload.php?pl_user=${plUser}&pl_zbid=samusil&pl_date=${plDate}`;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, pdfBytes.byteLength);
      const chunkBytes = pdfBytes.subarray(start, end);
      const boundary = "----chflowUp" + Math.random().toString(36).slice(2);
      const upBody = buildMultipart(boundary, [
        { name: "name", value: filename },
        { name: "chunk", value: String(i) },
        { name: "chunks", value: String(totalChunks) },
        { name: "file", value: chunkBytes, filename, contentType: "application/pdf" },
      ]);
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          ...BROWSER_HEADERS,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Cookie": jar.toHeader(),
          "Referer": REFERER,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: upBody,
      });
      jar.ingest(res.headers);
      const text = await res.text();
      debug.push({ step: `upload_chunk_${i}`, status: res.status, body_size: text.length, body_sample: text.slice(0, 200), extra: { chunk_index: i, chunks_total: totalChunks, chunk_bytes: chunkBytes.byteLength } });
      if (res.status >= 400 || !text.includes('"result"') || /"error"|"fault"/i.test(text)) {
        throw new Error(`PDF 업로드 실패 (chunk ${i + 1}/${totalChunks}): status ${res.status} body="${text.slice(0, 300)}"`);
      }
    }

    // ── 4. write_ok (CP949), w_key_spam fallback loop ──
    const cp = (s: string): Uint8Array => iconv.encode(s, "cp949");
    const spamCandidates = (Deno.env.get("UMS_SPAM_ANSWERS") || "김종혁목사,김종혁,명성교회,예 김종혁목사")
      .split(",").map((s) => s.trim()).filter(Boolean);

    let lastMsg = "";
    for (let si = 0; si < spamCandidates.length; si++) {
      const spamAnswer = spamCandidates[si];
      const wb = "----chflowWo" + Math.random().toString(36).slice(2);
      const wokBody = buildMultipart(wb, [
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
        { name: "subject", value: cp(body.subject) },
        { name: "memo", value: cp(body.memo) },
        { name: "view_mode_uploader", value: cp("on") },
        { name: "uploader_0_name", value: cp(filename) },
        { name: "uploader_0_status", value: cp("done") },
        { name: "uploader_count", value: cp("1") },
      ]);
      const res = await fetch(`${UMS}/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/write_ok.php`, {
        method: "POST",
        headers: {
          ...BROWSER_HEADERS,
          "Content-Type": `multipart/form-data; boundary=${wb}`,
          "Cookie": jar.toHeader(),
          "Referer": REFERER,
          "Origin": UMS,
        },
        body: wokBody,
        redirect: "manual",
      });
      jar.ingest(res.headers);
      const buf = new Uint8Array(await res.arrayBuffer());
      const html = iconv.decode(buf, "cp949");
      debug.push({ step: `write_ok_try_${si + 1}`, status: res.status, body_size: buf.byteLength, extra: { spam_answer: spamAnswer } });

      // 두 형식 redirect 매칭
      const redirectM = html.match(/(\.\.\/\.\.\/zboard\.php\?[^"'>\s]*[?&]no=(\d+)&category=\d+)/);
      if (redirectM) {
        return new Response(
          JSON.stringify({
            ok: true,
            post_no: parseInt(redirectM[2], 10),
            redirect_url: redirectM[1],
            pl_date: plDate,
            outbound_ip: outboundIp,
            outbound_org: outboundOrg,
            debug,
          }),
          { headers: { "Content-Type": "application/json", ...CORS } },
        );
      }

      const alertM = html.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
      lastMsg = alertM
        ? alertM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
        : `(no alert ${buf.byteLength}b)`;

      // 스팸 외 거부 (rate-limit, 권한 등) → loop 무의미
      if (!lastMsg.includes("스팸")) break;
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: `등록 실패: ${lastMsg}`,
        pl_date: plDate,
        outbound_ip: outboundIp,
        outbound_org: outboundOrg,
        debug,
      }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ ok: false, error: msg, outbound_ip: outboundIp, outbound_org: outboundOrg, debug }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
});
