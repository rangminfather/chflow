// Cloudflare Worker — 지난 말씀 영상 https 중계
//
// 왜 필요한가: UMS VOD 서버(pens02.psmvod.kr)가 http 만 지원한다. 우리 앱은 https 라서
// 브라우저가 http 영상을 mixed content 로 차단한다. 이 워커가 https 로 받아 http 로
// 대신 가져다 흘려보낸다.
//
// ── 배포 방법 ────────────────────────────────────────────────
// 1) Cloudflare 대시보드 → Workers & Pages → Create → Worker
// 2) 이름을 chflow-vod 로 지정 (앱 CSP 에 이 이름이 허용돼 있다)
// 3) 이 파일 내용을 붙여넣고 Deploy
// 4) Cron 트리거는 필요 없다 (요청이 올 때만 동작)
//
// ── 사용 ────────────────────────────────────────────────────
//   GET https://chflow-vod.<계정>.workers.dev/vod/2026/sermon_am/2026_0726_....mp4
//   GET https://chflow-vod.<계정>.workers.dev/thumb/2026/sermon_am/...jpg
//
// ── 설계 메모 ────────────────────────────────────────────────
//  - 응답 본문을 그대로 반환한다(버퍼링·가공 없음). 그래서 281MB 를 중계해도
//    Worker CPU 시간(무료 10ms)에 걸리지 않는다. 바이트가 JS 를 거치지 않는다.
//  - Range 헤더를 그대로 넘긴다 → 구간 이동·이어보기가 동작한다(206 응답).
//  - **캐시를 켠다.** UMS VOD 서버가 파일 뒷부분을 초당 30KB 수준으로 내주는 경우가 있어
//    (측정: 끝 1MB 에 30~72초) 캐시 없이는 재생이 시작되지 않는다. 이 mp4 들은 영상 목차
//    (moov)가 파일 끝에 있어서 플레이어가 재생 전에 뒷부분을 반드시 읽는다.
//    한 번 받아둔 구간은 이후 즉시 나온다. Cloudflare 캐시 최대 파일 크기(512MB)를
//    넘는 영상은 캐시되지 않으므로 그 파일은 여전히 느릴 수 있다.
//  - 열린 프록시가 되지 않도록 경로 접두사와 확장자를 검사한다.

const VOD_ORIGIN = "http://pens02.psmvod.kr/encoding/umsorkr/vod";
const ALLOWED_EXT = /\.(mp4|jpg|jpeg|png)$/i;
// /2026/sermon_am/2026_0726_sermon_am_<32자 hash>.mp4 형태만 통과
const SAFE_PATH = /^\/\d{4}\/[a-z0-9_]+\/[a-z0-9_]+\.(?:mp4|jpg|jpeg|png)$/i;

function deny(status, message) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

const worker = {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return deny(405, "GET/HEAD 만 허용합니다.");
    }

    const url = new URL(request.url);
    // /vod/... 또는 /thumb/... 뒤의 경로만 사용한다
    const m = url.pathname.match(/^\/(?:vod|thumb)(\/.+)$/);
    if (!m) return deny(404, "경로 형식이 올바르지 않습니다.");

    const path = decodeURIComponent(m[1]);
    if (!SAFE_PATH.test(path) || !ALLOWED_EXT.test(path) || path.includes("..")) {
      return deny(400, "허용되지 않는 경로입니다.");
    }

    const upstream = VOD_ORIGIN + path;
    const headers = new Headers();
    // 구간 요청을 그대로 전달해야 영상 탐색이 동작한다
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);
    headers.set("User-Agent", "Mozilla/5.0 (compatible; chflow-vod-proxy)");

    let res;
    try {
      res = await fetch(upstream, {
        method: request.method,
        headers,
        redirect: "follow",
        // 원본이 느리므로 엣지에 캐시해 둔다 (7일). 같은 구간 재요청은 즉시 응답된다.
        cf: { cacheTtl: 604800, cacheEverything: true },
      });
    } catch (err) {
      return deny(502, "영상 서버에 연결할 수 없습니다: " + String(err));
    }

    const out = new Headers();
    for (const key of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "last-modified",
      "etag",
    ]) {
      const v = res.headers.get(key);
      if (v) out.set(key, v);
    }
    if (!out.has("content-type")) {
      out.set("content-type", path.endsWith(".mp4") ? "video/mp4" : "image/jpeg");
    }
    // 앱에서만 쓰지만, 브라우저가 range 요청을 자유롭게 하도록 허용해 둔다
    out.set("Access-Control-Allow-Origin", "*");
    // 설교 영상은 한 번 올라오면 바뀌지 않는다. 브라우저에도 캐시를 허용해
    // 같은 영상을 다시 볼 때 원본을 또 때리지 않게 한다.
    out.set("Cache-Control", "public, max-age=604800, immutable");
    // 캐시 적중 여부를 확인할 수 있게 남긴다 (점검용)
    const cacheStatus = res.headers.get("cf-cache-status");
    if (cacheStatus) out.set("X-Vod-Cache", cacheStatus);

    return new Response(res.body, { status: res.status, headers: out });
  },
};

export default worker;
