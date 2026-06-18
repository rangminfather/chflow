import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createSignupIdentityToken } from "@/lib/server/signup-security";
import {
  fetchProviderProfile,
  getStateCookieName,
  isSignupIdentityProvider,
  PROVIDER_LABELS,
  type SignupIdentityProvider,
} from "@/lib/server/signup-identity-oauth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { provider: providerParam } = await params;
  const signupUrl = new URL("/signup", req.nextUrl.origin);

  if (!isSignupIdentityProvider(providerParam)) {
    signupUrl.searchParams.set("identity_error", "지원하지 않는 본인인증 공급자입니다.");
    return NextResponse.redirect(signupUrl);
  }

  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    signupUrl.searchParams.set("identity_error", req.nextUrl.searchParams.get("error_description") || "본인인증이 취소되었습니다.");
    return clearStateAndRedirect(providerParam, signupUrl);
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(getStateCookieName(providerParam))?.value || "";
  if (!code || !state || !expectedState || state !== expectedState) {
    signupUrl.searchParams.set("identity_error", "본인인증 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.");
    return clearStateAndRedirect(providerParam, signupUrl);
  }

  try {
    const profile = await fetchProviderProfile(providerParam, code, req);
    const identityToken = createSignupIdentityToken({
      provider: profile.provider,
      subject: profile.subject,
      name: profile.name,
      phone: profile.phone,
      verifiedAt: Date.now(),
    });
    signupUrl.searchParams.set("identity_token", identityToken);
    signupUrl.searchParams.set("identity_provider", providerParam);
    signupUrl.searchParams.set("identity_name", profile.name);
    signupUrl.searchParams.set("identity_phone", profile.phone);
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : `${PROVIDER_LABELS[providerParam]} 본인인증 처리 중 오류가 발생했습니다.`;
    signupUrl.searchParams.set("identity_error", message);
  }

  return clearStateAndRedirect(providerParam, signupUrl);
}

function clearStateAndRedirect(provider: SignupIdentityProvider, url: URL) {
  const res = NextResponse.redirect(url);
  res.cookies.set(getStateCookieName(provider), "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
