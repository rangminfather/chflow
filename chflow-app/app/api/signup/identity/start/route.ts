import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  createOauthState,
  getProviderConfig,
  getStateCookieName,
  isSignupIdentityProvider,
  PROVIDER_LABELS,
  SIGNUP_IDENTITY_PROVIDERS,
} from "@/lib/server/signup-identity-oauth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider");
  if (!isSignupIdentityProvider(provider)) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error: "지원하는 본인인증 공급자를 선택해 주세요.",
        supportedProviders: SIGNUP_IDENTITY_PROVIDERS,
      },
      { status: 400 }
    );
  }

  const config = getProviderConfig(provider, req);
  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        provider,
        error: `${PROVIDER_LABELS[provider]} 본인인증 설정이 아직 연결되지 않았습니다.`,
      },
      { status: 501 }
    );
  }

  const state = createOauthState();
  const res = NextResponse.redirect(buildAuthorizeUrl(provider, config, state));
  res.cookies.set(getStateCookieName(provider), state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
