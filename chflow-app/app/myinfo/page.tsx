"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, formatPhone, usernameToEmail } from "@/lib/supabase";
import { getRoleImageByLabel, ROLES, getLockedGroupLabels, type Role } from "@/lib/roles";
import HeaderLogo from "@/components/HeaderLogo";
import PhotoAvatar from "@/components/PhotoAvatar";
import { LoadingView } from "@/components/StatusViews";
import { BadgeCheck, MapPin } from "lucide-react";

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
  members_sub_role: string | null;
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
  const [subRoleParent, setSubRoleParent] = useState<Role | null>(null);
  const [savingSubRole, setSavingSubRole] = useState(false);

  // 이메일 등록
  const [editEmail, setEditEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailPasswordDraft, setEmailPasswordDraft] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  // 비밀번호 변경
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  const [toast, setToast] = useState("");
  const hasRegisteredEmail = !!email && !email.toLowerCase().endsWith("@smartms.app");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_profile_full");
    if (!error && data?.[0]) setProfile(data[0]);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: userData } = await supabase.auth.getUser();
      setEmail(userData.user?.email || session.user.email || "");
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
  const startEditEmail = () => {
    setEmailDraft(hasRegisteredEmail ? email : "");
    setEmailPasswordDraft("");
    setEditEmail(true);
  };
  const cancelEditEmail = () => {
    setEditEmail(false);
    setEmailDraft("");
    setEmailPasswordDraft("");
  };

  const saveSubRole = async () => {
    if (!profile) return;
    const lockedLabels = getLockedGroupLabels(profile.members_sub_role);
    if (lockedLabels && !lockedLabels.includes(subRoleDraft)) {
      showToast("직분 변경을 할 수 없습니다");
      return;
    }
    setSavingSubRole(true);
    const { error } = await supabase.from("profiles").update({ sub_role: subRoleDraft }).eq("id", profile.user_id);
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

  const saveEmail = async () => {
    const trimmed = emailDraft.trim();
    if (!trimmed.includes("@") || trimmed.split("@")[1]?.indexOf(".") === -1) {
      alert("올바른 이메일 주소를 입력해주세요"); return;
    }
    if (hasRegisteredEmail && !emailPasswordDraft) {
      alert("이메일을 변경하려면 현재 비밀번호를 입력해주세요"); return;
    }
    setSavingEmail(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSavingEmail(false);
      router.replace("/login");
      return;
    }
    const res = await fetch("/api/register-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: trimmed, password: emailPasswordDraft }),
    });
    const data = await res.json();
    setSavingEmail(false);
    if (!res.ok) { alert(`등록 실패: ${data.error || "오류가 발생했습니다"}`); return; }
    setEditEmail(false);
    setEmailDraft("");
    setEmailPasswordDraft("");
    setEmail(data.email || trimmed);
    await supabase.auth.refreshSession();
    showToast("이메일이 저장되었습니다");
  };

  const changePassword = async () => {
    setPwMsg("");
    if (!curPw || !newPw || !newPw2) { setPwMsg("모든 항목을 입력하세요"); return; }
    if (newPw.length < 6) { setPwMsg("새 비밀번호는 6자 이상이어야 합니다"); return; }
    if (newPw !== newPw2) { setPwMsg("새 비밀번호가 서로 다릅니다"); return; }
    if (!profile?.username) { setPwMsg("프로필 로딩 실패"); return; }
    setPwSubmitting(true);

    // 1) 현재 비밀번호 검증 - 현재 Auth 이메일로 다시 로그인 시도
    const { data: userData } = await supabase.auth.getUser();
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: userData.user?.email || usernameToEmail(profile.username),
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
    return <LoadingView full />;
  }


  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", paddingBottom: 48 }}>

      {/* Header */}
      <div style={{ background: "var(--card)", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HeaderLogo />
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)" }}>내 정보</div>
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
                hasCustomPhoto={!!profile.avatar_url}
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
                  background: "var(--bg-soft)", border: "2px solid var(--hairline)",
                  overflow: "hidden",
                }}>
                  <img
                    src={getRoleImageByLabel(editSubRole ? subRoleDraft : profile.sub_role)}
                    alt={subRoleDraft || profile.sub_role || "직분"}
                    style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 18%" }}
                  />
                </div>
                <button
                  onClick={() => { setSubRoleDraft(profile.sub_role || ""); setSubRoleParent(null); setEditSubRole(true); }}
                  style={{
                    position: "absolute", bottom: 0, right: 0,
                    width: 26, height: 26, borderRadius: "50%",
                    background: "var(--ink-mid)", border: "2px solid var(--card)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "#fff", fontSize: 13, lineHeight: 1,
                  }}
                  title="직분 변경"
                >↺</button>
              </div>
              <span style={avatarLabel}>{(editSubRole ? subRoleDraft : profile.sub_role) || "(직분 없음)"}</span>
            </div>
          </div>

          {/* 직분 편집 패널 */}
          {editSubRole && (
            <div style={{ marginTop: 16 }}>
              <RolePicker
                value={subRoleDraft}
                parentRole={subRoleParent}
                lockedLabels={getLockedGroupLabels(profile?.members_sub_role)}
                onSelect={(label, parent) => { setSubRoleDraft(label); setSubRoleParent(parent); }}
                onBlocked={() => showToast("직분 변경을 할 수 없습니다")}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button onClick={() => setEditSubRole(false)} style={btnGhost}>취소</button>
                <button onClick={saveSubRole} disabled={savingSubRole} style={btnPrimary}>{savingSubRole ? "저장 중..." : "저장"}</button>
              </div>
            </div>
          )}
        </div>

        {/* 2. 내 자동출석 */}
        <div style={card}>
          <CardHeader title="내 자동출석" sub="교회 위치 감지와 오늘 출석 상태 확인" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
              <MapPin size={20} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ color: "var(--ink-mid)", fontSize: 13, lineHeight: 1.55 }}>
                자동출석 설정과 현재 감지 상태를 확인할 수 있습니다.
              </span>
            </div>
            <button onClick={() => router.push("/attendance/my")} style={{ ...btnPrimary, flexShrink: 0 }}>
              확인하기
            </button>
          </div>
        </div>

        {/* 3. 모바일 교인증 */}
        <div style={card}>
          <CardHeader title="모바일 교인증" sub="교인 확인용 모바일 교인증" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
              <BadgeCheck size={20} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ color: "var(--ink-mid)", fontSize: 13, lineHeight: 1.55 }}>
                스마트폰에서 교인증을 확인할 수 있습니다.
              </span>
            </div>
            <button onClick={() => showToast("모바일 교인증은 구현 예정입니다.")} style={{ ...btnPrimary, flexShrink: 0 }}>
              확인하기
            </button>
          </div>
        </div>

        {/* 4. 등록 정보 */}
        <div style={card}>
          <CardHeader title="등록 정보" sub="변경은 관리자 또는 사무실에 문의" />
          <div style={infoGrid}>
            <InfoItem label="이름" value={profile.name} />
            <InfoItem label="아이디" value={profile.username} />
            {/* 이메일 */}
            {!hasRegisteredEmail ? (
              <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={infoLabel}>이메일</span>
                {editEmail ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      placeholder="실제 이메일 주소 입력"
                      style={inputStyle}
                      autoFocus
                    />
                    <button onClick={saveEmail} disabled={savingEmail} style={btnPrimary}>
                      {savingEmail ? "저장 중..." : "저장"}
                    </button>
                    <button onClick={cancelEditEmail} style={btnGhost}>취소</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ ...infoValue, color: "var(--danger)", fontWeight: 600 }}>(미등록)</span>
                    <button onClick={startEditEmail} style={btnSm}>이메일 등록하기</button>
                  </div>
                )}
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>이메일 등록 시 비밀번호 찾기에서 재설정 링크를 이메일로 받을 수 있습니다</span>
              </div>
            ) : (
              <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={infoLabel}>이메일</span>
                {editEmail ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      type="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      placeholder="새 이메일 주소"
                      style={inputStyle}
                      autoFocus
                    />
                    <input
                      type="password"
                      value={emailPasswordDraft}
                      onChange={(e) => setEmailPasswordDraft(e.target.value)}
                      placeholder="현재 비밀번호"
                      style={inputStyle}
                    />
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button onClick={saveEmail} disabled={savingEmail} style={btnPrimary}>
                        {savingEmail ? "저장 중..." : "저장"}
                      </button>
                      <button onClick={cancelEditEmail} style={btnGhost}>취소</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ ...infoValue, minWidth: 0, overflowWrap: "anywhere" }}>{email}</span>
                    <button onClick={startEditEmail} style={{ ...btnSm, flexShrink: 0 }}>변경</button>
                  </div>
                )}
              </div>
            )}
            <InfoItem label="생년월일" value={profile.birth_date} />
            <InfoItem label="성별" value={profile.gender === "M" ? "남" : profile.gender === "F" ? "여" : null} />
            <InfoItem label="가정교회" value={profile.family_church} />
            <InfoItem label="배우자" value={profile.spouse_name} />
            <InfoItem label="평원" value={profile.plain_name} />
            <InfoItem label="초원" value={profile.grassland_name} />
            <InfoItem label="목장" value={profile.pasture_name} />
          </div>
        </div>

        {/* 5. 연락처 */}
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
                    <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>가구(같은 주소) 전체에 적용됩니다</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditAddress(false)} style={btnGhost}>취소</button>
                      <button onClick={() => saveContact("address")} disabled={savingContact} style={btnPrimary}>저장</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ ...infoValue, color: profile.address ? "var(--ink)" : "var(--ink-faint)" }}>{profile.address || "(미등록)"}</span>
                  <button onClick={startEditAddress} disabled={!profile.household_id}
                    title={!profile.household_id ? "가구 미배정 — 관리자 문의" : ""} style={btnSm}>변경</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 6. 비밀번호 변경 */}
        <div style={card}>
          <CardHeader title="비밀번호" sub="" />
          {pwOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="현재 비밀번호" style={inputStyle} autoFocus />
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="새 비밀번호 (6자 이상)" style={inputStyle} />
              <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="새 비밀번호 확인" style={inputStyle} />
              {pwMsg && <div style={{ fontSize: 12, color: "var(--danger)" }}>{pwMsg}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setPwOpen(false); setCurPw(""); setNewPw(""); setNewPw2(""); setPwMsg(""); }} style={btnGhost}>취소</button>
                <button onClick={changePassword} disabled={pwSubmitting} style={btnPrimary}>{pwSubmitting ? "변경 중..." : "변경"}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setPwOpen(true)} style={{ ...btnOutline, width: "100%", justifyContent: "center" }}>비밀번호 변경</button>
          )}
        </div>

        {/* 7. 계정 */}
        <div style={{ ...card, borderColor: "var(--danger-soft)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>계정</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => { await supabase.auth.signOut(); router.replace("/login?notice=logout"); }}
                style={btnGhost}>로그아웃</button>
              <button onClick={() => router.push("/delete-account")}
                style={{ ...btnGhost, background: "transparent", color: "var(--danger)", borderColor: "var(--hairline)" }}>탈퇴 신청</button>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink)", color: "#fff", padding: "10px 20px", borderRadius: 999,
          fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          maxWidth: "calc(100vw - 32px)", textAlign: "center", lineHeight: 1.45,
          whiteSpace: "normal", overflowWrap: "break-word",
        }}>{toast}</div>
      )}
    </div>
  );
}

// ===== RolePicker =====
const ROLE_GROUPS = [
  { label: "교역자", roleIds: ["pastor", "missionary", "evangelist", "pastor_wife"] },
  { label: "동역자", roleIds: ["educator", "coordinator"] },
  { label: "항존직", roleIds: ["elder", "serving_deacon", "deaconess"] },
  { label: "성도",   roleIds: ["acting_deacon_male", "acting_deacon_female", "member_male", "member_female"] },
  { label: "다음세대", roleIds: ["youth_male", "youth_female", "teen_male", "teen_female", "child_male", "child_female", "toddler_male", "toddler_female"] },
];

function RolePicker({ value, parentRole, lockedLabels, onSelect, onBlocked }: {
  value: string;
  parentRole: Role | null;
  lockedLabels?: string[] | null;
  onSelect: (label: string, parent: Role | null) => void;
  onBlocked?: () => void;
}) {
  const [activeGroup, setActiveGroup] = useState(
    ROLE_GROUPS.find(g => g.roleIds.some(id => {
      const r = ROLES.find(r => r.id === id);
      return r && (r.label === value || r.subRoles?.some(s => s.label === value));
    }))?.label || "성도"
  );
  const [showSubPicker, setShowSubPicker] = useState<Role | null>(null);

  const visibleRoles = ROLES.filter(r =>
    ROLE_GROUPS.find(g => g.label === activeGroup)?.roleIds.includes(r.id)
  );

  const isRoleLocked = (role: Role): boolean => {
    if (!lockedLabels) return false;
    return !lockedLabels.includes(role.label) &&
      !role.subRoles?.some(s => lockedLabels.includes(s.label));
  };

  const handleRoleClick = (role: Role) => {
    if (isRoleLocked(role)) { onBlocked?.(); return; }
    if (role.subRoles && role.subRoles.length > 0) {
      setShowSubPicker(role);
    } else {
      onSelect(role.label, null);
    }
  };

  return (
    <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--hairline)", overflow: "hidden" }}>
      {/* 그룹 탭 */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--hairline)", background: "var(--card)" }}>
        {ROLE_GROUPS.map(g => (
          <button key={g.label} onClick={() => setActiveGroup(g.label)} style={{
            flex: 1, padding: "9px 4px", border: "none", background: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 700, fontFamily: "inherit",
            color: activeGroup === g.label ? "#3E5A4A" : "var(--ink-faint)",
            borderBottom: activeGroup === g.label ? "2px solid #3E5A4A" : "2px solid transparent",
          }}>{g.label}</button>
        ))}
      </div>
      {lockedLabels && (
        <div style={{ padding: "6px 12px", background: "var(--warning-soft)", fontSize: 11, color: "var(--warning)", fontWeight: 600 }}>
          🔒 직분은 동일 계열 내에서만 변경 가능합니다
        </div>
      )}
      {/* 이미지 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: 12 }}>
        {visibleRoles.map(role => {
          const isSelected = role.label === value || role.subRoles?.some(s => s.label === value);
          const locked = isRoleLocked(role);
          return (
            <div key={role.id} onClick={() => handleRoleClick(role)} style={{
              cursor: locked ? "not-allowed" : "pointer",
              borderRadius: 10, overflow: "hidden",
              background: "var(--card)",
              border: `2px solid ${isSelected ? "#3E5A4A" : "var(--hairline)"}`,
              aspectRatio: "0.65", position: "relative",
              opacity: 1,
            }}>
              <img src={role.image} alt={role.label} style={{
                width: "100%", height: "100%",
                objectFit: "contain", objectPosition: "top center",
              }} />
              {locked && (
                <div style={{
                  position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(0,0,0,0.08)",
                }}>
                  <span style={{ fontSize: 16 }}>🔒</span>
                </div>
              )}
              {!locked && role.subRoles && <span style={{ position: "absolute", top: 4, right: 4, fontSize: 8, background: "#3E5A4A", color: "#fff", borderRadius: 4, padding: "1px 4px" }}>▼</span>}
            </div>
          );
        })}
      </div>

      {/* 서브직분 모달 */}
      {showSubPicker && (
        <div onClick={() => setShowSubPicker(null)} style={{
          position: "fixed", inset: 0, background: "rgba(43, 39, 34,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 200, padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--card)", borderRadius: 16, padding: "20px 16px",
            width: "100%", maxWidth: 360,
          }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", marginBottom: 14, textAlign: "center" }}>
              {showSubPicker.label} 세부 직분
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {showSubPicker.subRoles!.map(sub => {
                const isSelected = sub.label === value;
                const subLocked = lockedLabels ? !lockedLabels.includes(sub.label) : false;
                return (
                  <div key={sub.label} onClick={() => {
                    if (subLocked) { onBlocked?.(); return; }
                    onSelect(sub.label, showSubPicker); setShowSubPicker(null);
                  }} style={{
                    cursor: subLocked ? "not-allowed" : "pointer",
                    borderRadius: 10, border: `2px solid ${isSelected ? "#3E5A4A" : "var(--hairline)"}`,
                    background: "#fafafa", aspectRatio: "0.65", overflow: "hidden", position: "relative",
                    opacity: 1,
                  }}>
                    <img src={sub.image} alt={sub.label} style={{
                      width: "100%", height: "100%",
                      objectFit: "contain", objectPosition: "top center",
                    }} />
                  </div>
                );
              })}
            </div>
            <button onClick={() => setShowSubPicker(null)} style={{ ...btnGhost, width: "100%", marginTop: 14, justifyContent: "center" }}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Subcomponents =====
function CardHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", letterSpacing: 0.2 }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={infoLabel}>{label}</span>
      <span style={{ ...infoValue, color: value ? "var(--ink)" : "var(--hairline-strong)" }}>{value || "—"}</span>
    </div>
  );
}

// ===== Styles =====
const card: React.CSSProperties = {
  background: "var(--card)", borderRadius: 16, padding: "20px 20px",
  border: "1px solid var(--hairline)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
};
const infoGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 20px",
};
const infoLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "var(--ink-faint)", letterSpacing: 0.3,
};
const infoValue: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: "var(--ink)",
};
const avatarLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "var(--ink-soft)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", border: "1px solid var(--hairline-strong)", borderRadius: 8,
  fontSize: 13, fontFamily: "inherit", background: "var(--card)", outline: "none", boxSizing: "border-box" as const,
};
const btnPrimary: React.CSSProperties = {
  padding: "9px 16px", border: 0, borderRadius: 8, background: "var(--accent)", color: "#fff",
  fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" as const,
};
const btnGhost: React.CSSProperties = {
  padding: "9px 14px", border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--card)",
  color: "var(--ink-mid)", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const,
};
const btnSm: React.CSSProperties = {
  padding: "5px 12px", border: "1px solid var(--hairline)", borderRadius: 6, background: "var(--surface)",
  color: "var(--ink-soft)", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const,
};
const btnOutline: React.CSSProperties = {
  padding: "9px 16px", border: "1px solid var(--hairline-strong)", borderRadius: 8, background: "var(--card)",
  color: "var(--ink)", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" as const,
};
