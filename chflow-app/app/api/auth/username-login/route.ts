import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function usernameToEmail(username: string): string {
  return `${username.toLowerCase()}@smartms.app`;
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    const lowerUsername = String(username || "").toLowerCase().trim();

    if (!lowerUsername || !password) {
      return NextResponse.json({ error: "아이디와 비밀번호를 입력하세요" }, { status: 400 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, username, status")
      .ilike("username", lowerUsername)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: "로그인 정보를 확인할 수 없습니다" }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: "아이디 또는 비밀번호가 일치하지 않습니다" }, { status: 401 });
    }

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(profile.id);
    const loginEmail = authData.user?.email || usernameToEmail(lowerUsername);

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: loginData, error: loginError } = await authClient.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (authError || loginError || !loginData.session) {
      return NextResponse.json({ error: "아이디 또는 비밀번호가 일치하지 않습니다" }, { status: 401 });
    }

    // 비밀번호가 맞더라도 활성(active) 상태가 아니면 토큰을 발급하지 않는다.
    // (승인 대기/거절/비활성 계정이 유효 세션을 획득하지 못하도록 서버에서 차단)
    if (profile.status !== "active") {
      return NextResponse.json(
        { error: "계정이 활성화되지 않았습니다", status: profile.status },
        { status: 403 }
      );
    }

    return NextResponse.json({
      session: {
        access_token: loginData.session.access_token,
        refresh_token: loginData.session.refresh_token,
      },
    });
  } catch {
    return NextResponse.json({ error: "로그인 중 오류가 발생했습니다" }, { status: 500 });
  }
}
