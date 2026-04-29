export default {
  async fetch(request) {
    const target = "http://www.ums.or.kr/bbs/zboard.php?id=samusil&page=1";
    let umsResult;
    try {
      const res = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "Referer": "http://www.ums.or.kr/",
        },
      });
      const buf = await res.arrayBuffer();
      umsResult = {
        status: res.status,
        body_size: buf.byteLength,
        is_blocked: buf.byteLength < 100,
        preview_hex: Array.from(new Uint8Array(buf.slice(0, 30)))
          .map(b => b.toString(16).padStart(2, "0")).join(" "),
      };
    } catch (e) {
      umsResult = { error: String(e) };
    }

    let ourIp = "unknown";
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json");
      const ipData = await ipRes.json();
      ourIp = ipData.ip;
    } catch {}

    const cf = request.cf || {};
    return Response.json({
      ums: umsResult,
      our_ip: ourIp,
      cf_colo: cf.colo,
      cf_country: cf.country,
    }, null, 2);
  },
};
