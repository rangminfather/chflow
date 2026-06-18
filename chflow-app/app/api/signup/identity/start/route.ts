import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const SUPPORTED_PROVIDERS = ["naver", "kakao", "google"] as const;
type SignupIdentityProvider = (typeof SUPPORTED_PROVIDERS)[number];

const PROVIDER_LABELS: Record<SignupIdentityProvider, string> = {
  naver: "네이버",
  kakao: "카카오",
  google: "구글",
};

function isSignupIdentityProvider(value: string | null): value is SignupIdentityProvider {
  return !!value && SUPPORTED_PROVIDERS.includes(value as SignupIdentityProvider);
}

function getProviderStartUrl(provider: SignupIdentityProvider) {
  const envKey = `SIGNUP_IDENTITY_${provider.toUpperCase()}_START_URL`;
  return process.env[envKey] || process.env.SIGNUP_IDENTITY_START_URL || "";
}

export async function GET(req: NextRequest) {
  const providerParam = req.nextUrl.searchParams.get("provider");
  if (!isSignupIdentityProvider(providerParam)) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error: "지원하는 본인인증 공급자를 선택해 주세요.",
        supportedProviders: SUPPORTED_PROVIDERS,
      },
      { status: 400 }
    );
  }

  const identityUrl = getProviderStartUrl(providerParam);
  if (!identityUrl) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        provider: providerParam,
        error: `${PROVIDER_LABELS[providerParam]} 본인인증 설정이 아직 연결되지 않았습니다.`,
      },
      { status: 501 }
    );
  }

  const redirectUrl = new URL(identityUrl, req.nextUrl.origin);
  redirectUrl.searchParams.set("provider", providerParam);
  return NextResponse.redirect(redirectUrl);
}
