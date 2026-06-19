import { randomBytes } from "crypto";
import { NextRequest } from "next/server";

export const SIGNUP_IDENTITY_PROVIDERS = ["naver", "kakao"] as const;
export type SignupIdentityProvider = (typeof SIGNUP_IDENTITY_PROVIDERS)[number];

export type ProviderProfile = {
  provider: SignupIdentityProvider;
  subject: string;
  name: string;
  phone: string;
};

type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

export const PROVIDER_LABELS: Record<SignupIdentityProvider, string> = {
  naver: "네이버",
  kakao: "카카오",
};

export function isSignupIdentityProvider(value: string | null | undefined): value is SignupIdentityProvider {
  return !!value && SIGNUP_IDENTITY_PROVIDERS.includes(value as SignupIdentityProvider);
}

export function createOauthState() {
  return randomBytes(24).toString("base64url");
}

export function getStateCookieName(provider: SignupIdentityProvider) {
  return `signup_identity_${provider}_state`;
}

export function normalizeProviderPhone(phone: string | null | undefined) {
  const raw = (phone || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+82")) {
    const local = raw.replace(/^\+82\s*/, "").replace(/[^0-9]/g, "");
    return local.startsWith("0") ? local : `0${local}`;
  }
  return raw.replace(/[^0-9]/g, "");
}

export function getProviderConfig(provider: SignupIdentityProvider, req: NextRequest): ProviderConfig | null {
  const upper = provider.toUpperCase();
  const fallbackClientId =
    provider === "kakao" ? process.env.KAKAO_REST_API_KEY || process.env.KAKAO_CLIENT_ID : process.env.NAVER_CLIENT_ID;
  const clientId = process.env[`SIGNUP_IDENTITY_${upper}_CLIENT_ID`] || fallbackClientId || "";
  const clientSecret =
    process.env[`SIGNUP_IDENTITY_${upper}_CLIENT_SECRET`] ||
    process.env[`${upper}_CLIENT_SECRET`] ||
    "";
  const redirectUri =
    process.env[`SIGNUP_IDENTITY_${upper}_REDIRECT_URI`] ||
    `${getPublicBaseUrl(req)}/api/signup/identity/${provider}/callback`;

  if (!clientId) return null;
  if (provider === "naver" && !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

export function buildAuthorizeUrl(provider: SignupIdentityProvider, config: ProviderConfig, state: string) {
  if (provider === "naver") {
    const url = new URL("https://nid.naver.com/oauth2.0/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);
    return url;
  }

  if (provider === "kakao") {
    const url = new URL("https://kauth.kakao.com/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "name phone_number");
    return url;
  }

  throw new Error("지원하지 않는 본인인증 공급자입니다.");
}

export async function fetchProviderProfile(
  provider: SignupIdentityProvider,
  code: string,
  req: NextRequest
): Promise<ProviderProfile> {
  const config = getProviderConfig(provider, req);
  if (!config) throw new Error(`${PROVIDER_LABELS[provider]} 본인인증 설정이 없습니다.`);

  const token = await exchangeCodeForToken(provider, config, code);
  if (!token.access_token) {
    throw new Error(token.error_description || token.error || "접근 토큰을 받을 수 없습니다.");
  }

  if (provider === "naver") {
    try {
      return await fetchNaverProfile(token.access_token);
    } finally {
      await revokeNaverAccessToken(token.access_token, config);
    }
  }
  return fetchKakaoProfile(token.access_token);
}

async function revokeNaverAccessToken(accessToken: string, config: ProviderConfig) {
  const body = new URLSearchParams();
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  body.set("token", accessToken);
  body.set("token_type_hint", "access_token");
  const res = await fetch("https://nid.naver.com/oauth2.0/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error("네이버 인증 토큰을 안전하게 폐기하지 못했습니다. 다시 시도해 주세요.");
  }
}

async function exchangeCodeForToken(
  provider: SignupIdentityProvider,
  config: ProviderConfig,
  code: string
): Promise<TokenResponse> {
  if (provider === "naver") {
    const url = new URL("https://nid.naver.com/oauth2.0/token");
    url.searchParams.set("grant_type", "authorization_code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("client_secret", config.clientSecret);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("code", code);
    const res = await fetch(url);
    return res.json();
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", config.clientId);
  body.set("redirect_uri", config.redirectUri);
  body.set("code", code);
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const res = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  });
  return res.json();
}

async function fetchNaverProfile(accessToken: string): Promise<ProviderProfile> {
  const res = await fetch("https://openapi.naver.com/v1/nid/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  const profile = data?.response || {};
  const name = typeof profile.name === "string" ? profile.name.trim() : "";
  const phone = normalizeProviderPhone(profile.mobile);
  if (!profile.id || !name || !phone) throw new Error("네이버에서 이름과 휴대폰 번호를 확인할 수 없습니다.");
  return { provider: "naver", subject: String(profile.id), name, phone };
}

async function fetchKakaoProfile(accessToken: string): Promise<ProviderProfile> {
  const res = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  const account = data?.kakao_account || {};
  const name = typeof account.name === "string" ? account.name.trim() : "";
  const phone = normalizeProviderPhone(account.phone_number);
  if (!data?.id || !name || !phone) throw new Error("카카오에서 이름과 휴대폰 번호를 확인할 수 없습니다.");
  return { provider: "kakao", subject: String(data.id), name, phone };
}

function getPublicBaseUrl(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return req.nextUrl.origin;
}
