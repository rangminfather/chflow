import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface SignupBody {
  username: string;
  password: string;
  name: string;
  phone: string;
  systemRole: string;
  subRole: string;
  matchedMemberId?: string | null;
  noPhone?: boolean;
}

function usernameToEmail(username: string): string {
  return `${username.toLowerCase()}@smartms.app`;
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

export async function POST(req: NextRequest) {
  try {
    const body: SignupBody = await req.json();
    const { username, password, name, phone, systemRole, subRole, matchedMemberId, noPhone } = body;

    // Validation (phone은 noPhone 체크 시 선택)
    if (!username || !password || !name) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다" }, { status: 400 });
    }
    if (!noPhone && !phone) {
      return NextResponse.json({ error: "전화번호를 입력하세요" }, { status: 400 });
    }
    const v = validateUsername(username);
    if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 });
    if (password.length < 8) {
      return NextResponse.json({ error: "비밀번호는 최소 8자 이상이어야 합니다" }, { status: 400 });
    }

    const lower = username.toLowerCase().trim();
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Check username availability
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", lower)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "이미 사용 중인 아이디입니다" }, { status: 409 });
    }

    // 2. Create user via admin API (no rate limit, no email confirmation)
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: usernameToEmail(lower),
      password,
      email_confirm: true,
      user_metadata: { username: lower, name },
    });
    if (createError || !created.user) {
      return NextResponse.json(
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
      role: systemRole,
      sub_role: subRole,
      status: "pending",
    });
    if (profileError) {
      // Rollback: delete user
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: `프로필 생성 실패: ${profileError.message}` },
        { status: 500 }
      );
    }

    // 4. Link to matched member if any
    if (matchedMemberId) {
      await admin.from("members").update({
        app_user_id: userId,
        guard_status: "회원",
      }).eq("id", matchedMemberId);
    }

    return NextResponse.json({ success: true, userId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "서버 오류" }, { status: 500 });
  }
}
