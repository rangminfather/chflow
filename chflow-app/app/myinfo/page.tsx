"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase, formatPhone, usernameToEmail } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import PhotoAvatar from "@/components/PhotoAvatar";

interface Profile {
  user_id: string;
  username: string;
  role: string;
  status: string;
  approved_at: string | null;
  must_change_password: boolean;
  member_id: string | null;
  name: string | null;
  phone: string | null;
  birth_date: string | null;
  gender: string | null;
  family_church: string | null;
  sub_role: string | null;
  spouse_name: string | null;
  is_child: boolean;
  photo_url: string | null;
  household_id: string | null;
  address: string | null;
  pasture_name: string | null;
  grassland_name: string | null;
  plain_name: string | null;
  review_status: "unreviewed" | "verified" | "needs_check" | null;
  review_note: string | null;
}

export default function MyInfoPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string>("");

  // 연락처 수정
  const [editPhone, setEditPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [editAddress, setEditAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  // 비밀번호 변경
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setEmail(session.user.email || "");
      await load();
      setAuthChecked(true);
    })();
  }, []);

  const load = async () => {
    const { data, error } = await supabase.rpc("get_my_profile_full");
    if (!error && data?.[0]) setProfile(data[0]);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const startEditPhone = () => {
    setPhoneDraft(profile?.phone || "");
    setEditPhone(true);
  };
  const startEditAddress = () => {
    setAddressDraft(profile?.address || "");
    setEditAddress(true);
  };

  const saveContact = async (kind: "phone" | "address") => {
    if (!profile) return;
    setSavingContact(true);
    const params: { p_phone?: string; p_address?: string } = {};
    if (kind === "phone") params.p_phone = phoneDraft;
    else params.p_address = addressDraft;

    const { error } = await supabase.rpc("update_my_contact", params);
    setSavingContact(false);
    if (error) { alert(`저장 실패: ${error.message}`); return; }
    if (kind === "phone") setEditPhone(false);
    if (kind === "address") setEditAddress(false);
    await load();
    showToast(kind === "phone" ? "핸드폰 번호가 저장되었습니다" : "주소가 저장되었습니다");
  };

  const changePassword = async () => {
    setPwMsg("");
    if (!curPw || !newPw || !newPw2) { setPwMsg("모든 항목을 입력하세요"); return; }
    if (newPw.length < 6) { setPwMsg("새 비밀번호는 6자 이상이어야 합니다"); return; }
    if (newPw !== newPw2) { setPwMsg("새 비밀번호가 서로 다릅니다"); return; }
    if (!profile?.username) { setPwMsg("프로필 로딩 실패"); return; }
    setPwSubmitting(true);

    // 1) 현재 비밀번호 검증 — username으로 다시 로그인 시도
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(profile.username),
      password: curPw,
    });
    if (signErr) {
      setPwMsg("현재 비밀번호가 일치하지 않습니다");
      setPwSubmitting(false);
      return;
    }

    // 2) 새 비밀번호 적용
    const { error: updErr } = await supabase.auth.updateUser({ password: newPw });
    if (updErr) { setPwSubmitting(false); setPwMsg(`변경 실패: ${updErr.message}`); return; }

    // 3) must_change_password 플래그 해제 (관리자 초기화 후 첫 변경)
    if (profile?.must_change_password) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
      }
    }
    setPwSubmitting(false);

    setCurPw(""); setNewPw(""); setNewPw2("");
    setPwOpen(false);
    showToast("비밀번호가 변경되었습니다");

    // force=password-change 모드였으면 home 으로
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("force") === "password-change") {
      setTimeout(() => { window.location.href = "/home"; }, 800);
    }
  };

  if (!authChecked || !profile) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>로딩 중...</div>;
  }

  const reviewBadge = profile.review_status === "verified"
    ? { label: "✅ 검수 확인", color: "#15803d", bg: "#dcfce7" }
    : profile.review_status === "needs_check"
    ? { label: "⚠️ 보류", color: "#b45309", bg: "#fef3c7" }
    : { label: "⏳ 미검수", color: "#475569", bg: "#f1f5f9" };

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif", paddingBottom: 40 }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "#fff", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HeaderLogo />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>내 정보</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>등록된 가입 정보 / 비밀번호 변경</div>
          </div>
        </div>
        <button onClick={() => router.push("/home")} style={btnGhost}>← 홈</button>
      </div>

      <div style={{ maxWidth: 720, margin: "20px auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* 1. 프로필 헤드 카드 */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <PhotoAvatar
              userId={profile.user_id}
              photoUrl={profile.photo_url}
              size={80}
              label="내 사진"
              onUpdate={(url) => setProfile({ ...profile, photo_url: url })}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1e293b" }}>{profile.name || "(이름 없음)"}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                @{profile.username} · {ROLE_LABEL[profile.role] || profile.role}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ ...badge, background: reviewBadge.bg, color: reviewBadge.color }}>{reviewBadge.label}</span>
                {profile.is_child && <span style={{ ...badge, background: "#dbeafe", color: "#1e40af" }}>👶 자녀 계정</span>}
              </div>
              {profile.review_note && (
                <div style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", padding: "4px 8px", borderRadius: 4, marginTop: 6 }}>
                  📝 {profile.review_note}
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10, textAlign: "right" }}>
            사진은 위 원형 이미지를 클릭해서 변경할 수 있습니다
          </div>
        </div>

        {/* 2. 가입정보 (잠금) */}
        <div style={card}>
          <SectionHeader title="등록 정보" hint="아래 항목 변경은 관리자 또는 사무실에 문의해주세요" />
          <FieldRow label="이름" value={profile.name} locked />
          <FieldRow label="아이디" value={profile.username} locked />
          <FieldRow label="이메일" value={email} locked hint="이메일 변경은 추후 지원 예정" />
          <FieldRow label="생년월일" value={profile.birth_date || "(미등록)"} locked />
          <FieldRow label="성별" value={profile.gender === "M" ? "남" : profile.gender === "F" ? "여" : "(미등록)"} locked />
          <FieldRow label="가정교회" value={profile.family_church || "-"} locked />
          <FieldRow label="직분" value={profile.sub_role || "-"} locked />
          <FieldRow label="배우자" value={profile.spouse_name || "-"} locked />
          <FieldRow label="평원" value={profile.plain_name || "-"} locked />
          <FieldRow label="초원" value={profile.grassland_name || "-"} locked />
          <FieldRow label="목장" value={profile.pasture_name || "-"} locked />
        </div>

        {/* 3. 연락처 (수정 가능) */}
        <div style={card}>
          <SectionHeader title="연락처" hint="본인이 직접 변경할 수 있습니다" />

          {/* 핸드폰 */}
          <div style={fieldWrap}>
            <div style={fieldLabel}>핸드폰</div>
            <div style={fieldValue}>
              {editPhone ? (
                <div style={{ display: "flex", gap: 6, flex: 1 }}>
                  <input
                    type="tel" inputMode="numeric"
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value.replace(/[^0-9-]/g, ""))}
                    placeholder="010-1234-5678"
                    style={inputStyle}
                  />
                  <button onClick={() => saveContact("phone")} disabled={savingContact} style={btnPrimary}>저장</button>
                  <button onClick={() => setEditPhone(false)} style={btnGhost}>취소</button>
                </div>
              ) : (
                <>
                  <span>{profile.phone ? formatPhone(profile.phone) : "(미등록)"}</span>
                  <button onClick={startEditPhone} style={btnSm}>변경</button>
                </>
              )}
            </div>
          </div>

          {/* 주소 */}
          <div style={fieldWrap}>
            <div style={fieldLabel}>주소</div>
            <div style={fieldValue}>
              {editAddress ? (
                <div style={{ display: "flex", gap: 6, flex: 1, flexDirection: "column" }}>
                  <textarea
                    value={addressDraft}
                    onChange={(e) => setAddressDraft(e.target.value)}
                    placeholder="도로명 주소"
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                  />
                  <div style={{ display: "flex", gap: 6, fontSize: 11, color: "#94a3b8" }}>
                    <span style={{ flex: 1 }}>※ 가구(같은 주소) 전체에 적용됩니다</span>
                    <button onClick={() => saveContact("address")} disabled={savingContact} style={btnPrimary}>저장</button>
                    <button onClick={() => setEditAddress(false)} style={btnGhost}>취소</button>
                  </div>
                </div>
              ) : (
                <>
                  <span style={{ color: profile.address ? "#475569" : "#94a3b8" }}>{profile.address || "(미등록)"}</span>
                  <button onClick={startEditAddress} disabled={!profile.household_id} title={!profile.household_id ? "가구 미배정 — 관리자에게 문의" : ""} style={btnSm}>변경</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 4. 비밀번호 변경 */}
        <div style={card}>
          <SectionHeader title="비밀번호 변경" hint="현재 비밀번호 확인 후 새 비밀번호로 변경합니다" />
          {pwOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="현재 비밀번호" style={inputStyle} autoFocus />
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="새 비밀번호 (6자 이상)" style={inputStyle} />
              <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="새 비밀번호 확인" style={inputStyle} />
              {pwMsg && <div style={{ fontSize: 12, color: "#dc2626" }}>{pwMsg}</div>}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button onClick={() => { setPwOpen(false); setCurPw(""); setNewPw(""); setNewPw2(""); setPwMsg(""); }} style={btnGhost}>취소</button>
                <button onClick={changePassword} disabled={pwSubmitting} style={btnPrimary}>
                  {pwSubmitting ? "변경 중..." : "변경"}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setPwOpen(true)} style={{ ...btnPrimary, width: "100%" }}>🔑 비밀번호 변경</button>
          )}
        </div>

        {/* 5. 위험 영역 */}
        <div style={{ ...card, borderColor: "#fecaca" }}>
          <SectionHeader title="계정 정리" hint="" />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 12, color: "#475569" }}>
              로그아웃 또는 회원 탈퇴 신청을 할 수 있습니다.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={async () => { await supabase.auth.signOut(); router.replace("/login?notice=logout"); }}
                style={{ ...btnGhost, color: "#475569" }}>🚪 로그아웃</button>
              <button onClick={() => router.push("/delete-account")}
                style={{ ...btnGhost, background: "#fef2f2", color: "#b91c1c", borderColor: "#fecaca" }}>탈퇴 신청</button>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1e293b", color: "#fff", padding: "10px 18px", borderRadius: 8,
          fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}>{toast}</div>
      )}
    </div>
  );
}

// ===== Subcomponents =====
function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function FieldRow({ label, value, locked, hint }: { label: string; value: string | null; locked?: boolean; hint?: string }) {
  return (
    <div style={fieldWrap}>
      <div style={fieldLabel}>
        {label} {locked && <span style={{ fontSize: 10, color: "#94a3b8" }}>🔒</span>}
      </div>
      <div style={{ ...fieldValue, color: value ? "#1e293b" : "#94a3b8" }}>
        <span>{value || "-"}</span>
        {hint && <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 8 }}>{hint}</span>}
      </div>
    </div>
  );
}

// ===== Constants =====
const ROLE_LABEL: Record<string, string> = {
  admin: "관리자", office: "사무실", pastor: "목회자",
  member: "성도", child: "자녀", guest: "게스트",
};

// ===== Styles =====
const card: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: 16,
  border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
};
const fieldWrap: React.CSSProperties = {
  display: "flex", borderBottom: "1px solid #f1f5f9", padding: "10px 0",
  alignItems: "flex-start", gap: 12,
};
const fieldLabel: React.CSSProperties = {
  width: 80, flexShrink: 0, fontSize: 12, color: "#64748b", fontWeight: 600, paddingTop: 4,
};
const fieldValue: React.CSSProperties = {
  flex: 1, fontSize: 13, color: "#1e293b", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minWidth: 0,
};
const badge: React.CSSProperties = {
  padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  flex: 1, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6,
  fontSize: 13, fontFamily: "inherit", background: "#fff", outline: "none",
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", border: 0, borderRadius: 6, background: "#6366f1", color: "#fff",
  fontSize: 12, fontWeight: 700, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff",
  color: "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const btnSm: React.CSSProperties = {
  padding: "4px 10px", border: "1px solid #cbd5e1", borderRadius: 4, background: "#f8fafc",
  color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer",
};
