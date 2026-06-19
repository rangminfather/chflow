import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ROLES } from "@/lib/roles";
import {
  getClientIp,
  logSignupAttempt,
  normalizePhoneDigits,
  SIGNUP_IDENTITY_COOKIE_NAME,
  verifySignupIdentityToken,
} from "@/lib/server/signup-security";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// 가입으로 부여 가능한 권한(role)은 mapToSystemRole 의 출력값으로 한정한다.
// 'admin'/'office' 등 관리자 권한은 가입으로 절대 생성될 수 없어야 한다.
const ALLOWED_SIGNUP_SYSTEM_ROLES = new Set<string>(["pastor", "leader", "member"]);
const NEW_MEMBER_ROLE_IDS = new Set<string>(["member_male", "member_female"]);
const NEXTGEN_ROLE_IDS = new Set<string>([
  "youth_male",
  "youth_female",
  "teen_male",
  "teen_female",
  "child_male",
  "child_female",
  "toddler_male",
  "toddler_female",
]);
const NEW_MEMBER_SUB_ROLES = new Set(
  ROLES.filter((role) => NEW_MEMBER_ROLE_IDS.has(role.id)).map((role) => role.label)
);
const NEXTGEN_SUB_ROLES = new Set(
  ROLES.filter((role) => NEXTGEN_ROLE_IDS.has(role.id)).map((role) => role.label)
);

interface SignupBody {
  username: string;
  password: string;
  name: string;
  phone: string;
  systemRole: string;
  subRole: string;
  matchedMemberId?: string | null;
  noPhone?: boolean;
  birthDate?: string | null;
  gender?: string | null;
  address?: string | null;
  addressBase?: string | null;
  addressDetail?: string | null;
  addressZonecode?: string | null;
  pastureId?: string | null;
  parentMemberId?: string | null;
  householdId?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  isChild?: boolean;
  signupMethod?: "manual" | "verified";
}

function usernameToEmail(username: string): string {
  return `${username.toLowerCase()}@smartms.app`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "서버 오류";
}

function validateUsername(username: string): { valid: boolean; error?: string } {
  const lower = username.toLowerCase();
  if (lower.length < 4) return { valid: false, error: "아이디는 최소 4자 이상이어야 합니다" };
  if (lower.length > 20) return { valid: false, error: "아이디는 최대 20자까지 가능합니다" };
  if (!/^[a-z0-9._]+$/.test(lower)) {
    return { valid: false, error: "영문 소문자, 숫자, 마침표(.), 언더스코어(_)만 사용 가능합니다" };
  }
  return { valid: true };
}

function signupResponse(
  req: NextRequest,
  clearIdentity: boolean,
  body: unknown,
  init?: ResponseInit
) {
  const res = NextResponse.json(body, init);
  if (clearIdentity) {
    res.cookies.set(SIGNUP_IDENTITY_COOKIE_NAME, "", {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}

export async function POST(req: NextRequest) {
  let consumeIdentityCookie = false;
  try {
    const body: SignupBody = await req.json();
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent");
    const {
      username,
      password,
      name,
      phone,
      systemRole,
      subRole,
      matchedMemberId,
      noPhone,
      birthDate,
      gender,
      address,
      addressBase,
      addressDetail,
      addressZonecode,
      pastureId,
      parentMemberId,
      householdId,
      guardianName,
      guardianPhone,
      isChild,
      signupMethod = "manual",
    } = body;
    consumeIdentityCookie = signupMethod === "verified";

    // Validation (phone은 noPhone 체크 시 선택)
    if (!username || !password || !name) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다" }, { status: 400 });
    }
    if (!noPhone && !phone) {
      return NextResponse.json({ error: "전화번호를 입력하세요" }, { status: 400 });
    }
    const v = validateUsername(username);
    if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 });
    // 권한 주입 방지: UI 를 우회한 요청이 systemRole 에 admin/office 등을 넣지 못하게 한다.
    if (!ALLOWED_SIGNUP_SYSTEM_ROLES.has(systemRole)) {
      return NextResponse.json({ error: "허용되지 않은 가입 권한입니다" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "비밀번호는 최소 8자 이상이어야 합니다" }, { status: 400 });
    }
    if (!birthDate) {
      return NextResponse.json({ error: "생년월일을 입력하세요" }, { status: 400 });
    }
    if (!gender) {
      return NextResponse.json({ error: "성별을 선택하세요" }, { status: 400 });
    }
    if (!["M", "F"].includes(gender)) {
      return NextResponse.json({ error: "성별 값이 올바르지 않습니다" }, { status: 400 });
    }
    const cleanAddressBase = addressBase?.trim() || address?.trim() || "";
    const cleanAddressDetail = addressDetail?.trim() || "";
    const cleanAddress = address?.trim() || [cleanAddressBase, cleanAddressDetail].filter(Boolean).join(" ");

    if (!cleanAddressBase && !cleanAddress) {
      return NextResponse.json({ error: "주소를 입력하세요" }, { status: 400 });
    }
    if (isChild && (!guardianName?.trim() || !guardianPhone?.trim())) {
      return NextResponse.json({ error: "자녀 가입은 보호자 정보를 입력해야 합니다" }, { status: 400 });
    }

    // Keep signup restrictions enforceable even if a crafted request bypasses the role picker UI.
    if (isChild && !NEXTGEN_SUB_ROLES.has(subRole)) {
      return NextResponse.json({ error: "\uC790\uB140 \uD68C\uC6D0\uAC00\uC785\uC740 \uB2E4\uC74C\uC138\uB300 \uC9C1\uBD84\uB9CC \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4" }, { status: 400 });
    }
    if (!isChild && !matchedMemberId && !NEW_MEMBER_SUB_ROLES.has(subRole)) {
      return NextResponse.json({ error: "\uB4F1\uB85D\uB418\uC9C0 \uC54A\uC740 \uAD50\uC778\uC740 \uC131\uB3C4 (\uB0A8), \uC131\uB3C4 (\uC5EC)\uB9CC \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4" }, { status: 400 });
    }

    // A안(직분↔권한 분리): 'pastor'는 가입에서 고를 수 있는 직분이지만 권한(authz) role 은 아니다.
    // 권한 집합(admin/office/pastor)에 드는 값은 가입으로 저장하지 않고 권한 없는 'member' 로 둔다.
    // 직분 표시는 sub_role 로 보존되며(예: 담임목사), staff 권한은 관리자가 별도로 부여한다.
    const AUTHZ_ROLES = new Set<string>(["admin", "office", "pastor"]);
    const storedRole = AUTHZ_ROLES.has(systemRole) ? "member" : systemRole;

    const lower = username.toLowerCase().trim();
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const identity = verifySignupIdentityToken(
      req.cookies.get(SIGNUP_IDENTITY_COOKIE_NAME)?.value
    );
    const identityVerified = signupMethod === "verified" && !!identity;
    let autoApprove = false;

    if (signupMethod === "verified" && !identityVerified) {
      await logSignupAttempt(admin, {
        route: "verified",
        result: "invalid_request",
        riskLevel: "medium",
        reason: "missing or invalid identity verification token",
        name,
        phone,
        ip,
        userAgent,
      });
      return signupResponse(req, true, { error: "본인인증 정보가 확인되지 않았습니다. 다시 인증해 주세요." }, { status: 400 });
    }

    if (identityVerified && normalizePhoneDigits(phone) !== normalizePhoneDigits(identity.phone)) {
      await logSignupAttempt(admin, {
        route: "verified",
        result: "invalid_request",
        riskLevel: "high",
        reason: "identity phone differs from signup phone",
        name,
        phone,
        ip,
        userAgent,
      });
      return signupResponse(req, true, { error: "본인인증 정보와 가입 정보가 일치하지 않습니다." }, { status: 400 });
    }

    if (identityVerified && name.trim() !== identity.name.trim()) {
      await logSignupAttempt(admin, {
        route: "verified",
        result: "invalid_request",
        riskLevel: "high",
        reason: "identity name differs from signup name",
        name,
        phone,
        ip,
        userAgent,
      });
      return signupResponse(req, true, { error: "본인인증 정보와 가입 정보가 일치하지 않습니다." }, { status: 400 });
    }

    if (identityVerified && matchedMemberId) {
      const { data: member } = await admin
        .from("members")
        .select("id, name, phone, app_user_id")
        .eq("id", matchedMemberId)
        .maybeSingle();

      if (!member || member.app_user_id) {
        return signupResponse(req, true, { error: "이미 가입되었거나 확인할 수 없는 교인 정보입니다." }, { status: 409 });
      }

      autoApprove =
        member.name === identity.name.trim()
        && normalizePhoneDigits(member.phone || "") === normalizePhoneDigits(identity.phone);

      if (!autoApprove) {
        await logSignupAttempt(admin, {
          route: "verified",
          result: "invalid_request",
          riskLevel: "high",
          reason: "verified identity does not match selected member row",
          name,
          phone,
          ip,
          userAgent,
          metadata: { matchedMemberId },
        });
        return signupResponse(req, true, { error: "본인인증 정보와 교인 정보가 일치하지 않습니다." }, { status: 400 });
      }
    }

    // 1. Check username availability
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", lower)
      .maybeSingle();
    if (existing) {
      return signupResponse(req, consumeIdentityCookie, { error: "이미 사용 중인 아이디입니다" }, { status: 409 });
    }

    // 2. Create user via admin API (no rate limit, no email confirmation)
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: usernameToEmail(lower),
      password,
      email_confirm: true,
      user_metadata: { username: lower, name },
    });
    if (createError || !created.user) {
      return signupResponse(
        req,
        consumeIdentityCookie,
        { error: `가입 실패: ${createError?.message || "사용자 생성 실패"}` },
        { status: 500 }
      );
    }

    const userId = created.user.id;

    // 3. Create profile
    const { error: profileError } = await admin.from("profiles").upsert({
      id: userId,
      email: usernameToEmail(lower),
      username: lower,
      name: name.trim(),
      phone: phone.replace(/[^0-9]/g, ""),
      role: storedRole,
      sub_role: subRole,
      status: autoApprove ? "active" : "pending",
      member_id: matchedMemberId || null,
      approved_at: autoApprove ? new Date().toISOString() : null,
      approved_by: null,
      signup_method: signupMethod,
      signup_identity_verified: identityVerified,
      signup_identity_provider: identity?.provider || null,
      signup_identity_subject: identity?.subject || null,
      signup_risk_level: autoApprove ? "low" : "medium",
      signup_risk_reason: autoApprove ? null : "manual signup requires admin approval",
      signup_birth_date: birthDate,
      signup_gender: gender,
      signup_address: cleanAddress,
      signup_address_base: cleanAddressBase || cleanAddress,
      signup_address_detail: cleanAddressDetail || null,
      signup_address_zonecode: addressZonecode?.trim() || null,
      signup_pasture_id: pastureId || null,
      signup_parent_member_id: parentMemberId || null,
      signup_household_id: householdId || null,
      signup_guardian_name: guardianName?.trim() || null,
      signup_guardian_phone: guardianPhone ? guardianPhone.replace(/[^0-9]/g, "") : null,
      signup_is_child: !!isChild,
    });
    if (profileError) {
      // Rollback: delete user
      await admin.auth.admin.deleteUser(userId);
      return signupResponse(
        req,
        consumeIdentityCookie,
        { error: "프로필 생성 실패" },
        { status: 500 }
      );
    }

    // 4. Link to matched member if any
    if (matchedMemberId) {
      await admin.from("members").update({
        app_user_id: userId,
        guard_status: autoApprove ? "회원" : "가입대기",
      }).eq("id", matchedMemberId);
    }

    await logSignupAttempt(admin, {
      route: signupMethod === "verified" ? "verified" : isChild ? "child" : "manual",
      result: "signup_created",
      riskLevel: autoApprove ? "low" : "medium",
      reason: autoApprove ? "identity verified existing member auto approved" : "signup pending approval",
      name,
      phone,
      ip,
      userAgent,
      metadata: { userId, matchedMemberId, autoApprove },
    });

    return signupResponse(req, consumeIdentityCookie, { success: true, userId, status: autoApprove ? "active" : "pending" });
  } catch (e: unknown) {
    return signupResponse(req, consumeIdentityCookie, { error: getErrorMessage(e) }, { status: 500 });
  }
}
