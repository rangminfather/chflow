// Cloudflare Worker — 예배 생방송 자동 감지 폴러
//
// 왜 필요한가: Vercel Hobby 플랜은 Cron 을 "하루 1회"로 제한해서 방송 시작을
// 제때 감지할 수 없다. 그래서 Cloudflare Cron(1분 간격, 무료)이 chflow 의
// /api/live/poll 을 두드리고, 감지·알림은 Vercel 쪽에서 처리한다.
//
// ── 배포 방법 ────────────────────────────────────────────────
// 1) Cloudflare 대시보드 → Workers & Pages → Create → Worker
// 2) 이 파일 내용을 붙여넣고 Deploy
// 3) Settings → Variables and Secrets
//      LIVE_POLL_SECRET  (Secret)  ← Vercel 의 LIVE_POLL_SECRET 과 같은 값
//      TARGET_URL        (Text, 선택) 기본값 https://smartms.kr
// 4) Settings → Triggers → Cron Triggers → Add → "* * * * *" (1분마다)
//
// wrangler 를 쓴다면 wrangler.toml:
//   name = "chflow-live-poll"
//   main = "src/index.js"
//   compatibility_date = "2026-07-29"
//   [triggers]
//   crons = ["* * * * *"]
//
// ── 동작 ────────────────────────────────────────────────────
// 매분 GET {TARGET_URL}/api/live/poll  (Authorization: Bearer LIVE_POLL_SECRET)
// 응답 예: {"ok":true,"is_live":true,"notify":{"sent":true,"recipients":19}}
//
// 브라우저로 워커 URL 을 직접 열면 상태 확인용으로 같은 호출을 한 번 수행한다.

const DEFAULT_TARGET = "https://smartms.kr";

async function poll(env) {
  const base = (env.TARGET_URL || DEFAULT_TARGET).replace(/\/$/, "");
  const secret = env.LIVE_POLL_SECRET;

  if (!secret) {
    return { ok: false, error: "LIVE_POLL_SECRET 미설정" };
  }

  try {
    const res = await fetch(`${base}/api/live/poll`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      // 폴링 응답은 캐시하지 않는다
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

const worker = {
  // Cron 트리거
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      poll(env).then((result) => {
        // Cloudflare 대시보드 → Logs 에서 확인 가능
        console.log("live-poll", JSON.stringify(result));
      })
    );
  },

  // 수동 확인용
  async fetch(request, env) {
    const result = await poll(env);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
};

export default worker;
