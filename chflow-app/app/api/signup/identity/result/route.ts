import { NextRequest, NextResponse } from "next/server";
import {
  SIGNUP_IDENTITY_COOKIE_NAME,
  verifySignupIdentityToken,
} from "@/lib/server/signup-security";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SIGNUP_IDENTITY_COOKIE_NAME)?.value;
  const identity = verifySignupIdentityToken(token);

  if (!identity) {
    const res = NextResponse.json({ authenticated: false }, { status: 401 });
    res.cookies.set(SIGNUP_IDENTITY_COOKIE_NAME, "", {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    res.headers.set("Cache-Control", "no-store, private");
    return res;
  }

  const res = NextResponse.json({
    authenticated: true,
    provider: identity.provider,
    name: identity.name,
    phone: identity.phone,
  });
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
