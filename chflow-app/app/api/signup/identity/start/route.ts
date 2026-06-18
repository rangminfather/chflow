import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const identityUrl = process.env.SIGNUP_IDENTITY_START_URL;
  if (!identityUrl) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error: "본인인증 공급자 설정이 아직 연결되지 않았습니다.",
      },
      { status: 501 }
    );
  }

  return NextResponse.redirect(identityUrl);
}
