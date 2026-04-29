// ==UserScript==
// @name         chflow UMS 자동등록
// @namespace    https://chflow-app.vercel.app/
// @version      0.1.0
// @description  명성교회 사무실 게시판(samusil)에 chflow 폼 데이터로 자동 글등록
// @author       chflow
// @match        https://chflow-app.vercel.app/*
// @match        http://localhost:3000/*
// @grant        GM_xmlhttpRequest
// @connect      ums.or.kr
// @connect      www.ums.or.kr
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  const UMS = "http://www.ums.or.kr";

  // 사용자 페이지에 유저스크립트 설치 신호
  document.documentElement.setAttribute("data-chflow-userscript", "0.1.0");

  function gm(opts) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...opts,
        onload: (r) => resolve(r),
        onerror: (e) => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout")),
      });
    });
  }

  function abToBytes(ab) { return new Uint8Array(ab); }
  function bytesToAb(u8) { return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); }

  function decodeEucKr(bytes) {
    return new TextDecoder("euc-kr").decode(bytes);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ─── 1. write.php 에서 pl_date / pl_user 추출 ───
  async function step1_getWriteForm() {
    const r = await gm({
      method: "GET",
      url: `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`,
      headers: {
        "Referer": `${UMS}/bbs/zboard.php?id=samusil`,
      },
      responseType: "arraybuffer",
    });
    if (r.status >= 400) throw new Error(`write.php 응답 실패: ${r.status}`);
    const html = decodeEucKr(abToBytes(r.response));
    if (html.length < 5000 || html.includes("사용권한이 없습니다")) {
      throw new Error("UMS 로그인이 필요합니다. 새 탭에서 ums.or.kr 로그인 후 다시 시도");
    }
    const dateM = html.match(/name="pl_date"\s+value="(\d+)"/);
    const userM = html.match(/name="pl_user"\s+value="(umsorkr_[^"]+)"/);
    if (!dateM || !userM) {
      throw new Error("pl_date/pl_user 추출 실패. UMS 양식 변경 가능성");
    }
    return { plDate: dateM[1], plUser: userM[1] };
  }

  // ─── 2. PDF 업로드 multipart 빌드 + POST ───
  async function step2_uploadPdf(plUser, plDate, pdfBytes, filename) {
    const boundary = "----chflowUp" + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const parts = [
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${filename}\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="chunk"\r\n\r\n0\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="chunks"\r\n\r\n1\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdfBytes,
      enc.encode(`\r\n--${boundary}--\r\n`),
    ];
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const body = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { body.set(p, off); off += p.byteLength; }

    const url = `${UMS}/core/plupload/upload.php?pl_user=${encodeURIComponent(plUser)}&pl_zbid=samusil&pl_date=${plDate}`;
    const r = await gm({
      method: "POST",
      url,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Referer": `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`,
        "X-Requested-With": "XMLHttpRequest",
      },
      data: bytesToAb(body),
      binary: true,
      responseType: "text",
    });
    if (r.status >= 400 || !r.responseText.includes('"result"')) {
      throw new Error(`PDF 업로드 실패: ${r.status} body=${(r.responseText || "").slice(0, 200)}`);
    }
  }

  // ─── 3. write_ok body 빌드 (chflow API 가 CP949 인코딩) + POST ───
  async function step3_submitWriteOk(plUser, plDate, subject, memo) {
    const umsUserId = plUser.replace(/^umsorkr_/, "");

    // chflow API 호출 (same-origin, CP949 multipart body 받기)
    const apiResp = await fetch("/api/ums-bulletin/build-write-body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ums_user_id: umsUserId,
        pl_date: plDate,
        subject,
        memo,
        category: 2,
      }),
    });
    const apiJson = await apiResp.json();
    if (!apiJson.ok) throw new Error(`API 빌드 실패: ${apiJson.error}`);
    const bodyBytes = base64ToBytes(apiJson.body_base64);

    const r = await gm({
      method: "POST",
      url: `${UMS}/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/write_ok.php`,
      headers: {
        "Content-Type": apiJson.content_type,
        "Referer": `${UMS}/bbs/write.php?id=samusil&page=1&category=2&mode=write`,
        "Origin": UMS,
      },
      data: bytesToAb(bodyBytes),
      binary: true,
      responseType: "arraybuffer",
    });

    const html = decodeEucKr(abToBytes(r.response));
    const alertM = html.match(/alertElmBody[^>]*>([\s\S]+?)<\/div>/);
    if (alertM && !html.includes('http-equiv="refresh"')) {
      const msg = alertM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      throw new Error(`등록 실패: ${msg}`);
    }
    const refreshM = html.match(/<meta\s+http-equiv="refresh"[^>]*url=([^"'>\s]+)/i);
    const noM = refreshM && refreshM[1].match(/[?&]no=(\d+)/);
    if (!noM) throw new Error(`글번호 추출 실패. response sample: ${html.slice(0, 300)}`);

    return { postNo: parseInt(noM[1], 10), redirectUrl: refreshM[1] };
  }

  // ─── 메인 진입점 ───
  async function autoPost(formPayload) {
    const { subject, memo, pdfBase64, pdfFilename } = formPayload;
    if (!subject || !memo || !pdfBase64) throw new Error("subject/memo/pdf 필수");

    const pdfBytes = base64ToBytes(pdfBase64);

    const { plDate, plUser } = await step1_getWriteForm();
    await step2_uploadPdf(plUser, plDate, pdfBytes, pdfFilename || "bulletin.pdf");
    const result = await step3_submitWriteOk(plUser, plDate, subject, memo);
    return { ...result, plDate, plUser };
  }

  // chflow 페이지 → 유저스크립트: CustomEvent 'chflow:ums-post-request'
  // 유저스크립트 → chflow 페이지: CustomEvent `chflow:ums-post-response-${requestId}`
  document.addEventListener("chflow:ums-post-request", async (e) => {
    const { requestId, payload } = e.detail || {};
    if (!requestId) return;
    try {
      const result = await autoPost(payload);
      document.dispatchEvent(new CustomEvent(`chflow:ums-post-response-${requestId}`, {
        detail: { ok: true, ...result },
      }));
    } catch (err) {
      document.dispatchEvent(new CustomEvent(`chflow:ums-post-response-${requestId}`, {
        detail: { ok: false, error: err && err.message ? err.message : String(err) },
      }));
    }
  });

  console.log("[chflow] UMS 자동등록 유저스크립트 v0.1.0 로드됨");
})();
