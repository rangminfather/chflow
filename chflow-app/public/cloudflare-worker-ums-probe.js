// Cloudflare Worker — UMS 전용 프록시
// chflow Vercel API 가 ums.or.kr 호출 시 이 Worker 거침 → Cloudflare IP 사용 (UMS 차단 우회)
//
// 사용:
//   GET  https://worker.url/?path=/bbs/zboard.php?id=samusil
//        헤더: X-Forward-Cookie (옵션), X-Forward-Referer (옵션)
//
//   POST https://worker.url/?path=/bbs/login_check.php
//        body: 그대로 forward
//        헤더: X-Forward-Cookie, X-Forward-Referer, X-Forward-Content-Type
//
// 응답:
//   상태/바디: UMS 그대로
//   X-Forward-Set-Cookie: UMS Set-Cookie 들 (\\n 으로 구분)
//   X-Forward-Status: UMS HTTP status
//   X-Forward-Location: UMS Location 헤더 (있으면)

const ALLOWED_HOSTS = ["www.ums.or.kr", "ums.or.kr"];

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    const host = url.searchParams.get("host") || "www.ums.or.kr";

    if (!path) {
      return jsonError(400, "missing ?path=");
    }
    if (!ALLOWED_HOSTS.includes(host)) {
      return jsonError(403, `host '${host}' not allowed`);
    }

    const targetUrl = `http://${host}${path}`;

    const fwdHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      "Referer": request.headers.get("X-Forward-Referer") || "http://www.ums.or.kr/",
    };

    const cookie = request.headers.get("X-Forward-Cookie");
    if (cookie) fwdHeaders["Cookie"] = cookie;

    const ct = request.headers.get("X-Forward-Content-Type");
    if (ct) fwdHeaders["Content-Type"] = ct;

    const xrw = request.headers.get("X-Forward-X-Requested-With");
    if (xrw) fwdHeaders["X-Requested-With"] = xrw;

    const origin = request.headers.get("X-Forward-Origin");
    if (origin) fwdHeaders["Origin"] = origin;

    const init = {
      method: request.method,
      headers: fwdHeaders,
      redirect: "manual",
    };

    if (request.method === "POST") {
      init.body = await request.arrayBuffer();
    }

    let umsRes;
    try {
      umsRes = await fetch(targetUrl, init);
    } catch (e) {
      return jsonError(502, `fetch failed: ${e}`);
    }

    const buf = await umsRes.arrayBuffer();

    // 진단: Worker outbound IP + 그 IP 의 country (UMS 가 보는 우리 IP)
    // ipinfo.io 한 번 호출로 IP + country 동시에 — 한국 IP 우회 검증용.
    let workerIp = "unknown";
    let workerCountry = "unknown";
    try {
      const ipRes = await fetch("https://ipinfo.io/json", { cf: { cacheTtl: 0 } });
      const ipData = await ipRes.json();
      workerIp = ipData.ip || "unknown";
      workerCountry = ipData.country || "unknown";
    } catch {/* ignore */}
    // Worker 가 실행되는 Cloudflare colo (예: ICN, LAX, IAD)
    // request.cf.colo 는 incoming request 의 edge colo. Smart Placement 가 켜져 있으면
    // outbound fetch 는 다른 colo (Cf-Placement 헤더 참조) 에서 나갈 수 있음.
    const workerColo = (request.cf && request.cf.colo) || "unknown";

    const respHeaders = {
      ...corsHeaders(),
      "Content-Type": umsRes.headers.get("Content-Type") || "application/octet-stream",
      "X-Forward-Status": String(umsRes.status),
      "X-Worker-Outbound-IP": workerIp,
      "X-Worker-Outbound-Country": workerCountry,
      "X-Worker-Colo": workerColo,
    };

    // Set-Cookie 들 (다중) — HTTP 헤더 값에 \n 못 들어가므로 base64 인코딩
    const setCookies = umsRes.headers.getSetCookie ? umsRes.headers.getSetCookie() : [];
    if (setCookies.length > 0) {
      const joined = setCookies.join("\n");
      // btoa 는 ASCII 만 가능. 쿠키 값은 ASCII 범위라 OK.
      respHeaders["X-Forward-Set-Cookie-B64"] = btoa(joined);
    }

    const location = umsRes.headers.get("Location");
    if (location) respHeaders["X-Forward-Location"] = location;

    return new Response(buf, {
      status: umsRes.status,
      headers: respHeaders,
    });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "X-Forward-Cookie, X-Forward-Referer, X-Forward-Content-Type, X-Forward-X-Requested-With, X-Forward-Origin, Content-Type",
    "Access-Control-Expose-Headers": "X-Forward-Status, X-Forward-Set-Cookie-B64, X-Forward-Location, X-Worker-Outbound-IP, X-Worker-Outbound-Country, X-Worker-Colo",
  };
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
