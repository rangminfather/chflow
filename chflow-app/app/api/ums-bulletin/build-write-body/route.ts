import { NextRequest, NextResponse } from "next/server";
import iconv from "iconv-lite";

export const runtime = "nodejs";

// 이 엔드포인트는 UMS 에 호출하지 않음.
// 단지 한국어 form 필드를 CP949 로 인코딩한 multipart body 만 만들어 줌.
// 실제 ums.or.kr 호출은 사용자 브라우저(Tampermonkey)에서 수행 → 사용자 IP 사용.

interface PostBody {
  ums_user_id: string;       // UMS 계정 아이디 (write.php 응답의 pl_user 에서 추출)
  pl_date: string;           // write.php 응답에서 받아온 값
  subject: string;
  memo: string;
  category?: number;
}

type MultipartField = { name: string; value: Buffer };

function buildMultipart(boundary: string, fields: MultipartField[]): Buffer {
  const parts: Buffer[] = [];
  for (const f of fields) {
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n`;
    parts.push(Buffer.from(header, "utf8"));
    parts.push(f.value);
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(parts);
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { ums_user_id, pl_date, subject, memo } = body;
  const category = body.category ?? 2;

  if (!ums_user_id || !pl_date || !subject || !memo) {
    return NextResponse.json(
      { ok: false, error: "ums_user_id, pl_date, subject, memo 필수" },
      { status: 400 },
    );
  }

  const cp = (s: string) => iconv.encode(s, "cp949");
  const boundary = "----chflowMultipart" + Math.random().toString(36).slice(2);

  const bodyBuf = buildMultipart(boundary, [
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
    { name: "pl_user", value: cp(`umsorkr_${ums_user_id}`) },
    { name: "pl_date", value: cp(pl_date) },
    { name: "reg_date_change", value: cp("") },
    { name: "NameCheck", value: cp("N") },
    { name: "subject", value: cp(subject) },
    { name: "memo", value: cp(memo) },
  ]);

  return NextResponse.json({
    ok: true,
    body_base64: bodyBuf.toString("base64"),
    content_type: `multipart/form-data; boundary=${boundary}`,
    size: bodyBuf.byteLength,
  });
}
