"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, formatPhone, usernameToEmail } from "@/lib/supabase";
import { getRoleImageByLabel, ROLES } from "@/lib/roles";
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
  avatar_url: string | null;
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

  // 직분 수정
  const [editSubRole, setEditSubRole] = useState(false);
  const [subRoleDraft, setSubRoleDraft] = useState("");
  const [savingSubRole, setSavingSubRole] = useState(false);

  // 비밀번호 변경
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_profile_full");
    if (!error && data?.[0]) setProfile(data[0]);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setEmail(session.user.email || "");
      await load();
      setAuthChecked(true);
    })();
  }, [load, router]);

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

  const saveSubRole = async () => {
    if (!profile) return;
    setSavingSubRole(true);
    const { error } = await supabase.from("profiles").update({ sub_role: subRoleDraft }).eq("user_id", profile.user_id);
    setSavingSubRole(false);
    if (error) { alert(`저장 실패: ${error.message}`); return; }
    setEditSubRole(false);
    await load();
    showToast("직분이 저장되었습니다");
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


  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif", paddingBottom: 48 }}>

      {/* Header */}
      <div style={{ background: "#fff", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HeaderLogo />
          <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>내 정보</div>
        </div>
        <button onClick={() => router.push("/home")} style={btnGhost}>← 홈</button>
      </div>

      <div style={{ maxWidth: 600, margin: "24px auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* 1. 프로필 헤드 카드 */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "center", gap: 40, padding: "8px 0 4px" }}>

            {/* 사진 */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <PhotoAvatar
                userId={profile.user_id}
                photoUrl={profile.avatar_url || profile.photo_url}
                fallbackUrl={profile.photo_url}
                size={80}
                label="내 사진"
                onUpdate={(url) => setProfile({ ...profile, avatar_url: url === profile.photo_url ? null : url })}
              />
              <span style={avatarLabel}>프로필 사진</span>
            </div>

            {/* 직분 아바타 */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ position: "relative" }}>
                <div style={{
                  width: 80, height: 80, borderRadius: "50%",
                  background: "#f1f5f9", border: "2px solid #e2e8f0",
                  overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <img
                    src={getRoleImageByLabel(profile.sub_role)}
                    alt={profile.sub_role || "직분"}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
                <button
                  onClick={() => { setSubRoleDraft(profile.sub_role || ""); setEditSubRole(true); }}
                  style={{
                    position: "absolute", bottom: 0, right: 0,
                    width: 26, height: 26, borderRadius: "50%",
                    background: "#6366f1", border: "2px solid #fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", fontSize: 12, lineHeight: 1,
                  }}
                  title="직분 변경"
                >✏️</button>
              </div>
              <span style={avatarLabel}>{profile.sub_role || "(직분 없음)"}</span>
            </div>
          </div>

          {/* 직분 편집 드롭다운 */}
          {editSubRole && (
            <div style={{ marginTop: 16, padding: "14px 16px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>직분 선택</div>
              <select
                value={subRoleDraft}
                onChange={(e) => setSubRoleDraft(e.target.value)}
                style={inputStyle}
              >
                {ROLES.map((r) =>
                  r.subRoles ? (
                    <optgroup key={r.id} label={r.label}>
                      {r.subRoles.map((s) => (
                        <option key={s.label} value={s.label}>{s.label}</option>
                      ))}
                    </optgroup>
                  ) : (
                    <option key={r.id} value={r.label}>{r.label}</option>
                  )
                )}
              </select>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setEditSubRole(false)} style={btnGhost}>취소</button>
                <button onClick={saveSubRole} disabled={savingSubRole} style={btnPrimary}>{savingSubRole ? "저장 중..." : "저장"}</button>
              </div>
            </div>
          )}
        </div>

        {/* 2. 등록 정보 */}
        <div style={card}>
          <CardHeader title="등록 정보" sub="변경은 관리자 또는 사무실에 문의" />
          <div style={infoGrid}>
            <InfoItem label="이름" value={profile.name} />
            <InfoItem label="아이디" value={profile.username} />
            <InfoItem label="이메일" value={email} />
            <InfoItem label="생년월일" value={profile.birth_date} />
            <InfoItem label="성별" value={profile.gender === "M" ? "남" : profile.gender === "F" ? "여" : null} />
            <InfoItem label="가정교회" value={profile.family_church} />
            <InfoItem label="배우자" value={profile.spouse_name} />
            <InfoItem label="평원" value={profile.plain_name} />
            <InfoItem label="초원" value={profile.grassland_name} />
            <InfoItem label="목장" value={profile.pasture_name} />
          </div>
        </div>

        {/* 3. 연락처 */}
        <div style={card}>
          <CardHeader title="연락처" sub="직접 변경 가능" />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            <div>
              <div style={infoLabel}>핸드폰</div>
              {editPhone ? (
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <input type="tel" inputMode="numeric" value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value.replace(/[^0-9-]/g, ""))}
                    placeholder="010-1234-5678" style={inputStyle} />
                  <button onClick={() => saveContact("phone")} disabled={savingContact} style={btnPrimary}>저장</button>
                  <button onClick={() => setEditPhone(false)} style={btnGhost}>취소</button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={infoValue}>{profile.phone ? formatPhone(profile.phone) : "(미등록)"}</span>
                  <button onClick={startEditPhone} style={btnSm}>변경</button>
                </div>
              )}
            </div>

            <div>
              <div style={infoLabel}>주소</div>
              {editAddress ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                  <textarea value={addressDraft} onChange={(e) => setAddressDraft(e.target.value)}
                    placeholder="도로명 주소" rows={2}
                    style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>가구(같은 주소) 전체에 적용됩니다</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditAddress(false)} style={btnGhost}>취소</button>
                      <button onClick={() => saveContact("address")} disabled={savingContact} style={btnPrimary}>저장</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ ...infoValue, color: profile.address ? "#1e293b" : "#94a3b8" }}>{profile.address || "(미등록)"}</span>
                  <button onClick={startEditAddress} disabled={!profile.household_id}
                    title={!profile.household_id ? "가구 미배정 — 관리자 문의" : ""} style={btnSm}>변경</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 4. 비밀번호 변경 */}
        <div style={card}>
          <CardHeader title="비밀번호" sub="" />
          {pwOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="현재 비밀번호" style={inputStyle} autoFocus />
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="새 비밀번호 (6자 이상)" style={inputStyle} />
              <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="새 비밀번호 확인" style={inputStyle} />
              {pwMsg && <div style={{ fontSize: 12, color: "#dc2626" }}>{pwMsg}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setPwOpen(false); setCurPw(""); setNewPw(""); setNewPw2(""); setPwMsg(""); }} style={btnGhost}>취소</button>
                <button onClick={changePassword} disabled={pwSubmitting} style={btnPrimary}>{pwSubmitting ? "변경 중..." : "변경"}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setPwOpen(true)} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>🔑 비밀번호 변경</button>
          )}
        </div>

        {/* 5. 계정 */}
        <div style={{ ...card, borderColor: "#fecaca" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>계정</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => { await supabase.auth.signOut(); router.replace("/login?notice=logout"); }}
                style={btnGhost}>로그아웃</button>
              <button onClick={() => router.push("/delete-account")}
                style={{ ...btnGhost, background: "#fef2f2", color: "#b91c1c", borderColor: "#fecaca" }}>탈퇴 신청</button>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1e293b", color: "#fff", padding: "10px 20px", borderRadius: 999,
          fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          whiteSpace: "nowrap",
        }}>{toast}</div>
      )}
    </div>
  );
}

// ===== Subcomponents =====
function CardHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#1e293b", letterSpacing: 0.2 }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={infoLabel}>{label}</span>
      <span style={{ ...infoValue, color: value ? "#1e293b" : "#cbd5e1" }}>{value || "—"}</span>
    </div>
  );
}

// ===== Styles =====
const card: React.CSSProperties = {
  background: "#fff", borderRadius: 16, padding: "20px 20px",
  border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
};
const infoGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 20px",
};
const infoLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.3,
};
const infoValue: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: "#1e293b",
};
const avatarLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#64748b",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8,
  fontSize: 13, fontFamily: "inherit", background: "#fff", outline: "none", boxSizing: "border-box" as const,
};
const btnPrimary: React.CSSProperties = {
  padding: "9px 16px", border: 0, borderRadius: 8, background: "#6366f1", color: "#fff",
  fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" as const,
};
const btnGhost: React.CSSProperties = {
  padding: "9px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff",
  color: "#475569", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const,
};
const btnSm: React.CSSProperties = {
  padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc",
  color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const,
};
