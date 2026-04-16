"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROLES, mapToSystemRole, type Role } from "@/lib/roles";
import {
  supabase,
  usernameToEmail,
  validateUsername,
  validatePassword,
  normalizePhone,
} from "@/lib/supabase";

type Step = "lookup" | "confirm" | "role" | "info" | "done";

interface MatchedMember {
  id: string;
  name: string;
  phone: string;
  family_church: string;
  sub_role: string;
  spouse_name: string;
  household_id: string;
  pasture_name: string;
  grassland_name: string;
  plain_name: string;
  address: string;
  has_account: boolean;
  // 자녀 매칭 시 부모 정보
  parent_id?: string;
  parent_name?: string;
  parent_phone?: string;
  matched_as_child?: boolean;
}

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("lookup");

  // === 입력 데이터 ===
  const [lookupName, setLookupName] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [noPhone, setNoPhone] = useState(false);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [matched, setMatched] = useState<MatchedMember | null>(null);

  // 직분
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [selectedSubRole, setSelectedSubRole] = useState<string | null>(null);
  const [showSubRoleModal, setShowSubRoleModal] = useState<Role | null>(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  // 정보 입력
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  // 공통
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ============ Step 1: 이름+휴대폰 lookup (+ 자녀 가입 분기) ============
  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!lookupName.trim()) return setError("이름을 입력하세요");
    if (!noPhone && !lookupPhone.trim()) return setError("휴대폰 번호를 입력하세요");
    if (noPhone && !parentName.trim()) return setError("부모님 이름을 입력하세요");
    if (noPhone && !parentPhone.trim()) return setError("부모님 휴대폰 번호를 입력하세요");

    setLoading(true);
    try {
      // === 자녀 분기: 부모 정보로 매칭 ===
      if (noPhone) {
        const pNorm = normalizePhone(parentPhone);
        const pFormatted = pNorm.length >= 10
          ? `${pNorm.slice(0, 3)}-${pNorm.slice(3, 7)}-${pNorm.slice(7, 11)}`
          : parentPhone;

        const { data, error: rpcError } = await supabase.rpc("find_child_for_signup", {
          p_child_name: lookupName.trim(),
          p_parent_name: parentName.trim(),
          p_parent_phone: pFormatted,
        });
        if (rpcError) {
          setError(`조회 오류: ${rpcError.message}`);
          setLoading(false);
          return;
        }
        if (data && data.length > 0) {
          const member = { ...(data[0] as MatchedMember), matched_as_child: true };
          if (member.has_account) {
            setError("이미 가입된 회원입니다. 로그인 또는 비밀번호 찾기를 이용하세요.");
            setLoading(false);
            return;
          }
          setMatched(member);
          setStep("confirm");
        } else {
          // 부모 매칭 실패 또는 해당 가족 내 자녀 이름 없음 → 신규 가입
          setMatched(null);
          setName(lookupName.trim());
          setPhone(""); // 자녀는 핸드폰 없음
          setStep("role");
        }
        setLoading(false);
        return;
      }

      // === 성인 분기 (기존 로직) ===
      const phoneNormalized = normalizePhone(lookupPhone);
      const phoneFormatted = phoneNormalized.length >= 10
        ? `${phoneNormalized.slice(0, 3)}-${phoneNormalized.slice(3, 7)}-${phoneNormalized.slice(7, 11)}`
        : lookupPhone;

      const { data, error: rpcError } = await supabase.rpc("find_member_for_signup", {
        p_name: lookupName.trim(),
        p_phone: phoneFormatted,
      });

      if (rpcError) {
        setError(`조회 오류: ${rpcError.message}`);
        setLoading(false);
        return;
      }

      if (data && data.length > 0) {
        const member = data[0] as MatchedMember;
        if (member.has_account) {
          setError("이미 가입된 회원입니다. 로그인 또는 비밀번호 찾기를 이용하세요.");
          setLoading(false);
          return;
        }
        setMatched(member);
        setStep("confirm");
      } else {
        // 매칭 실패 → 신규 가입
        setMatched(null);
        setName(lookupName.trim());
        setPhone(lookupPhone.trim());
        setStep("role");
      }
    } catch (e: any) {
      setError(`오류: ${e.message}`);
    }
    setLoading(false);
  };

  // ============ Step 2: 매칭 확인 ============
  const handleConfirmYes = () => {
    if (!matched) return;
    // 매칭된 정보로 자동 채움
    setName(matched.name);
    setPhone(matched.phone);
    // 직분 자동 매칭 시도
    let roleMatched = false;
    if (matched.sub_role) {
      const r = findRoleByLabel(matched.sub_role);
      if (r) {
        setSelectedRole(r.role);
        if (r.subRole) setSelectedSubRole(r.subRole);
        roleMatched = true;
      }
    }
    // 직분이 매칭됐으면 정보입력으로, 안 됐으면 직분 선택 화면으로
    if (roleMatched) {
      setStep("info");
    } else {
      setStep("role");
    }
  };

  const handleConfirmNo = () => {
    // 신규 가입이지만 매칭된 정보는 그대로 채워줌
    if (matched) {
      setName(matched.name);
      setPhone(matched.phone);
      if (matched.sub_role) {
        const r = findRoleByLabel(matched.sub_role);
        if (r) setSelectedRole(r.role);
        if (r?.subRole) setSelectedSubRole(r.subRole);
      }
    }
    setStep("role");
  };

  // 직분 라벨로 ROLES에서 찾기
  const findRoleByLabel = (label: string): { role: Role; subRole?: string } | null => {
    for (const role of ROLES) {
      if (role.label === label) return { role };
      if (role.subRoles) {
        for (const sub of role.subRoles) {
          if (sub.label === label) return { role, subRole: sub.label };
        }
      }
    }
    return null;
  };

  // ============ Step 3: 직분 선택 (캐러셀) ============
  const VISIBLE_COUNT = isMobile ? 2 : 4;
  const STEP_SIZE = isMobile ? 2 : 1;
  const maxIdx = Math.max(0, ROLES.length - VISIBLE_COUNT);
  const safeIdx = isMobile
    ? Math.min(carouselIdx, Math.floor((ROLES.length - 1) / STEP_SIZE) * STEP_SIZE)
    : Math.min(carouselIdx, maxIdx);
  const visibleRoles = ROLES.slice(safeIdx, safeIdx + VISIBLE_COUNT);
  const totalPages = isMobile ? Math.ceil(ROLES.length / STEP_SIZE) : maxIdx + 1;
  const currentPage = isMobile ? Math.floor(safeIdx / STEP_SIZE) : safeIdx;

  const handleRoleSelect = (role: Role) => {
    setSelectedRole(role);
    setSelectedSubRole(null);
    if (role.subRoles && role.subRoles.length > 0) {
      setShowSubRoleModal(role);
    } else {
      setStep("info");
    }
  };

  const handleSubRoleSelect = (subLabel: string) => {
    setSelectedSubRole(subLabel);
    setShowSubRoleModal(null);
    setStep("info");
  };

  // ============ Step 4: 정보 입력 (아이디/비밀번호) ============
  const checkUsername = async () => {
    const lower = username.toLowerCase().trim();
    const v = validateUsername(lower);
    if (!v.valid) {
      setError(v.error!);
      setUsernameStatus("idle");
      return;
    }
    setError("");
    setUsernameStatus("checking");
    const { data } = await supabase.rpc("check_username_available", { p_username: lower });
    setUsernameStatus(data ? "available" : "taken");
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const lower = username.toLowerCase().trim();
    const uv = validateUsername(lower);
    if (!uv.valid) return setError(uv.error!);
    const pv = validatePassword(password);
    if (!pv.valid) return setError(pv.error!);
    if (password !== passwordConfirm) return setError("비밀번호가 일치하지 않습니다");
    if (!name.trim()) return setError("이름을 입력하세요");
    if (!noPhone && !phone.trim()) return setError("전화번호를 입력하세요");
    if (!selectedRole) return setError("직분을 선택하세요");

    setLoading(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: lower,
          password,
          name: name.trim(),
          phone: phone ? normalizePhone(phone) : "",
          systemRole: mapToSystemRole(selectedRole.id),
          subRole: selectedSubRole || selectedRole.label,
          matchedMemberId: matched?.id || null,
          noPhone,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "가입에 실패했습니다");
        setLoading(false);
        return;
      }
      setStep("done");
    } catch (e: any) {
      setError(`오류: ${e.message}`);
    }
    setLoading(false);
  };

  // ============ Render ============

  // 가입 완료
  if (step === "done") {
    return (
      <div style={pageStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <div style={cardStyle}>
          <div style={{ fontSize: 64, marginBottom: 20, textAlign: "center" }}>🙏</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1e293b", marginBottom: 12, textAlign: "center" }}>
            가입 신청 완료!
          </div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, textAlign: "center", marginBottom: 28 }}>
            회원가입 신청이 완료되었습니다.<br />
            <strong>관리자 승인</strong> 후 로그인 하실 수 있습니다.
          </div>
          <button onClick={() => router.push("/login?notice=signup")} style={primaryBtnStyle}>
            로그인 화면으로
          </button>
        </div>
      </div>
    );
  }

  // ============ Step 1: lookup ============
  if (step === "lookup") {
    return (
      <div style={pageStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <div style={cardStyle}>
          <BackBar onBack={() => router.push("/login")} title="회원가입" />

          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#1e293b", letterSpacing: -0.5 }}>
              스마트명성 <span style={{ color: "#94a3b8", fontSize: 14, fontWeight: 500 }}>회원가입</span>
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 14, lineHeight: 1.6 }}>
              먼저 본인 확인을 위해<br />
              <strong>이름</strong>과 <strong>휴대폰 번호</strong>를 입력해주세요
            </div>
          </div>

          <form onSubmit={handleLookup}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>이름 *</label>
              <input
                type="text"
                value={lookupName}
                onChange={(e) => setLookupName(e.target.value)}
                placeholder="실명을 입력하세요"
                style={{ ...inputStyle, marginTop: 6 }}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>휴대폰 번호 {noPhone ? "" : "*"}</label>
              <input
                type="tel"
                value={lookupPhone}
                onChange={(e) => setLookupPhone(e.target.value)}
                placeholder="010-0000-0000"
                disabled={noPhone}
                style={{
                  ...inputStyle,
                  marginTop: 6,
                  background: noPhone ? "#f1f5f9" : "#fff",
                  color: noPhone ? "#94a3b8" : "#0f172a",
                }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={noPhone}
                  onChange={(e) => { setNoPhone(e.target.checked); if (e.target.checked) setLookupPhone(""); }}
                  style={{ width: 16, height: 16, accentColor: "#6366f1" }}
                />
                휴대폰 없음 (청소년/어린이)
              </label>
            </div>

            {noPhone && (
              <div style={{ padding: "14px", background: "#fefce8", border: "1.5px dashed #fde047", borderRadius: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#854d0e", marginBottom: 10 }}>
                  👨‍👩‍👧 부모님 정보 (본인 확인용)
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>부모님 이름 *</label>
                  <input
                    type="text"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    placeholder="부 또는 모 성함"
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>부모님 휴대폰 *</label>
                  <input
                    type="tel"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                </div>
                <div style={{ fontSize: 10, color: "#a16207", marginTop: 8, lineHeight: 1.5 }}>
                  할아버지/할머니/아버지/어머니 중 누구의 이름이든 가능합니다.
                </div>
              </div>
            )}

            {error && (
              <div style={errorStyle}>⚠️ {error}</div>
            )}

            <button type="submit" disabled={loading} style={primaryBtnStyle}>
              {loading ? "조회 중..." : "다음"}
            </button>
          </form>

          <div style={{ marginTop: 20, padding: "12px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, fontSize: 11, color: "#1e40af", lineHeight: 1.6 }}>
            💡 명성교회 성도이신 경우 등록된 정보를 자동으로 불러옵니다.<br />
            등록되어 있지 않으시면 신규 가입으로 진행됩니다.
          </div>
        </div>
      </div>
    );
  }

  // ============ Step 2: 매칭 확인 ============
  if (step === "confirm" && matched) {
    return (
      <div style={pageStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <div style={cardStyle}>
          <BackBar onBack={() => setStep("lookup")} title="본인 확인" />

          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#6366f1" }}>회원 정보 발견!</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginTop: 8 }}>
              아래 분이 맞으십니까?
            </div>
          </div>

          <div style={{
            background: "linear-gradient(135deg, #f0f9ff, #eff6ff)",
            border: "2px solid #3b82f6",
            borderRadius: 16,
            padding: "20px 18px",
            marginBottom: 20,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "#dbeafe", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 28,
              }}>👤</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#1e293b" }}>
                  {matched.name} <span style={{ fontSize: 14, color: "#6366f1", marginLeft: 6 }}>{matched.sub_role || matched.family_church}</span>
                </div>
                {matched.spouse_name && (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    배우자: {matched.spouse_name}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, fontSize: 12 }}>
              {matched.plain_name && (
                <>
                  <div style={infoLabel}>가정교회</div>
                  <div style={infoValue}>
                    {matched.plain_name}평원 · {matched.grassland_name}초원 · {matched.pasture_name}목장
                  </div>
                </>
              )}
              {matched.address && (
                <>
                  <div style={infoLabel}>주소</div>
                  <div style={infoValue}>{maskAddress(matched.address)}</div>
                </>
              )}
              <div style={infoLabel}>휴대폰</div>
              <div style={infoValue}>{maskPhone(matched.phone)}</div>
            </div>
          </div>

          {error && <div style={errorStyle}>⚠️ {error}</div>}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleConfirmNo} style={{ ...secondaryBtnStyle, flex: 1 }}>
              아니오
            </button>
            <button onClick={handleConfirmYes} style={{ ...primaryBtnStyle, flex: 1 }}>
              네, 맞습니다
            </button>
          </div>

          <div style={{ marginTop: 16, fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
            "네"를 선택하시면 정보가 자동으로 채워지며 직분 등은 본인이 수정 가능합니다.<br />
            "아니오"를 선택하시면 신규 가입으로 진행됩니다.
          </div>
        </div>
      </div>
    );
  }

  // ============ Step 3: 직분 선택 ============
  if (step === "role") {
    return (
      <div style={pageStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <div style={{ ...cardStyle, maxWidth: 720 }}>
          <BackBar onBack={() => setStep(matched ? "confirm" : "lookup")} title="직분 선택" />

          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#6366f1", marginTop: 4, letterSpacing: 1 }}>
              † 직분을 선택하세요 †
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <button
              onClick={() => setCarouselIdx(Math.max(0, safeIdx - STEP_SIZE))}
              disabled={safeIdx === 0}
              style={arrowBtnStyle(safeIdx === 0)}
            >◀</button>
            <div className="role-grid" style={{
              flex: 1, display: "grid",
              gridTemplateColumns: `repeat(${VISIBLE_COUNT}, 1fr)`, gap: 10,
            }}>
              {visibleRoles.map((role) => (
                <RoleCard key={role.id} role={role} onClick={() => handleRoleSelect(role)} />
              ))}
            </div>
            <button
              onClick={() => {
                const next = safeIdx + STEP_SIZE;
                if (next < ROLES.length) setCarouselIdx(Math.min(next, isMobile ? next : maxIdx));
              }}
              disabled={safeIdx + STEP_SIZE >= ROLES.length}
              style={arrowBtnStyle(safeIdx + STEP_SIZE >= ROLES.length)}
            >▶</button>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
            {Array.from({ length: totalPages }).map((_, i) => (
              <div key={i} onClick={() => setCarouselIdx(i * STEP_SIZE)} style={{
                width: i === currentPage ? 22 : 7, height: 7, borderRadius: 4,
                background: i === currentPage ? "#6366f1" : "#cbd5e1", cursor: "pointer",
              }} />
            ))}
          </div>
        </div>

        {showSubRoleModal && (
          <SubRoleModal role={showSubRoleModal} onSelect={handleSubRoleSelect} onClose={() => setShowSubRoleModal(null)} />
        )}

        <style jsx global>{`
          @media (max-width: 480px) {
            .subrole-grid { grid-template-columns: repeat(2, 1fr) !important; }
          }
        `}</style>
      </div>
    );
  }

  // ============ Step 4: 정보 입력 ============
  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ ...cardStyle, maxWidth: 480 }}>
        <BackBar onBack={() => setStep("role")} title="가입 정보 입력" />

        {selectedRole ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: "#f8fafc", borderRadius: 12, marginBottom: 16 }}>
            <img
              src={selectedSubRole && selectedRole.subRoles
                ? selectedRole.subRoles.find(s => s.label === selectedSubRole)?.image || selectedRole.image
                : selectedRole.image}
              alt={selectedSubRole || selectedRole.label}
              style={{ width: 56, height: "auto", borderRadius: 8 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>선택한 직분</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>
                {selectedSubRole || selectedRole.label}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStep("role")}
              style={{
                padding: "6px 12px",
                background: "#fff",
                border: "1.5px solid #6366f1",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                color: "#6366f1",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              변경
            </button>
          </div>
        ) : (
          <div
            onClick={() => setStep("role")}
            style={{
              padding: "16px",
              background: "#fef2f2",
              border: "2px dashed #fca5a5",
              borderRadius: 12,
              marginBottom: 16,
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>👆</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>
              직분을 선택해주세요 (필수)
            </div>
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>
              여기를 누르면 직분 선택 화면으로 이동합니다
            </div>
          </div>
        )}

        {matched && (
          <div style={{ padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, fontSize: 11, color: "#166534", marginBottom: 14 }}>
            ✓ 명성교회 등록 회원으로 확인되어 정보가 자동 입력되었습니다
          </div>
        )}

        <form onSubmit={handleSignup}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>아이디 *</label>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                type="text" value={username}
                onChange={(e) => { setUsername(e.target.value.toLowerCase()); setUsernameStatus("idle"); }}
                placeholder="영문 소문자, 숫자, . _ (4~20자)"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button type="button" onClick={checkUsername}
                disabled={!username || usernameStatus === "checking"}
                style={{ padding: "0 14px", background: usernameStatus === "available" ? "#10b981" : "#6366f1", color: "#fff", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
              >
                {usernameStatus === "checking" ? "확인중" : usernameStatus === "available" ? "✓ 가능" : "중복확인"}
              </button>
            </div>
            {usernameStatus === "available" && <div style={{ fontSize: 11, color: "#10b981", marginTop: 4 }}>✓ 사용 가능</div>}
            {usernameStatus === "taken" && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>✗ 이미 사용 중</div>}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>비밀번호 *</label>
            <div style={{ position: "relative", marginTop: 6 }}>
              <input type={showPassword ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8자 이상" style={{ ...inputStyle, paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 6 }}>
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>비밀번호 확인 *</label>
            <input type={showPassword ? "text" : "password"} value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호 다시 입력" style={{ ...inputStyle, marginTop: 6 }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>이름 *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="실명" style={{ ...inputStyle, marginTop: 6 }} />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>전화번호 {noPhone ? "(선택)" : "*"}</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder={noPhone ? "휴대폰 없으시면 비워두셔도 됩니다" : "010-0000-0000"}
              style={{ ...inputStyle, marginTop: 6 }} />
          </div>

          {error && <div style={errorStyle}>⚠️ {error}</div>}

          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? "가입 신청 중..." : "가입 신청"}
          </button>
        </form>

        <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
          가입 신청 후 관리자 승인이 필요합니다
        </div>
      </div>
    </div>
  );
}

// ============ Components ============
function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
      <button onClick={onBack} style={{
        width: 36, height: 36, borderRadius: 10, background: "#f1f5f9",
        border: "none", fontSize: 16, cursor: "pointer", color: "#475569",
      }}>←</button>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#475569" }}>{title}</div>
    </div>
  );
}

function RoleCard({ role, onClick }: { role: Role; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      cursor: "pointer", borderRadius: 14, overflow: "hidden",
      background: "#fafafa", border: "2px solid #e2e8f0",
      transition: "all 0.2s", boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      position: "relative", aspectRatio: "0.62",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 4,
    }}
    onMouseOver={(e) => { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.transform = "translateY(-4px)"; }}
    onMouseOut={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.transform = "translateY(0)"; }}>
      <img src={role.image} alt={role.label}
        style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block" }} />
      {role.subRoles && role.subRoles.length > 0 && (
        <div style={{ position: "absolute", top: 6, right: 6, padding: "2px 8px",
          background: "rgba(99, 102, 241, 0.95)", color: "#fff", borderRadius: 10,
          fontSize: 9, fontWeight: 700 }}>▼</div>
      )}
    </div>
  );
}

function SubRoleModal({ role, onSelect, onClose }: { role: Role; onSelect: (label: string) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)",
      backdropFilter: "blur(6px)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 100, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 24, padding: "24px 20px",
        width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <img src={role.image} alt={role.label} style={{ width: 56, height: "auto", borderRadius: 8 }} />
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>선택한 직분</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1e293b" }}>{role.label}</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "#475569", fontWeight: 600, marginBottom: 14 }}>
          세부 직분을 선택해주세요
        </div>
        <div className="subrole-grid" style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(role.subRoles!.length, 4)}, 1fr)`, gap: 10,
        }}>
          {role.subRoles!.map((sub) => (
            <div key={sub.label} onClick={() => onSelect(sub.label)} style={{
              cursor: "pointer", borderRadius: 14, overflow: "hidden",
              background: "#fafafa", border: "2px solid #e2e8f0",
              aspectRatio: "0.62", display: "flex",
              alignItems: "center", justifyContent: "center", padding: 4,
            }}>
              <img src={sub.image} alt={sub.label}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{
          width: "100%", marginTop: 14, padding: "12px",
          background: "#f1f5f9", border: "none", borderRadius: 10,
          fontSize: 13, fontWeight: 600, color: "#64748b", cursor: "pointer", fontFamily: "inherit",
        }}>취소</button>
      </div>
    </div>
  );
}

function maskPhone(phone: string): string {
  if (!phone) return "";
  // 010-1234-5678 → 010-****-5678
  const m = phone.match(/^(\d{2,3})-?(\d{3,4})-?(\d{4})$/);
  if (m) return `${m[1]}-****-${m[3]}`;
  return phone;
}

function maskAddress(addr: string): string {
  if (!addr) return "";
  // 울산광역시 동구 방어진순환로 995 (서부동, 서부아파트) 119동 1402호
  // → 울산광역시 동구 ***
  const parts = addr.split(/\s+/);
  if (parts.length <= 2) return addr;
  return parts.slice(0, 2).join(" ") + " ***";
}

// ============ Styles ============
const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, #f0f9ff 0%, #fef3c7 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px 16px",
  fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "rgba(255,255,255,0.9)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  borderRadius: 24,
  padding: "32px 28px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.1)",
  border: "1px solid rgba(255,255,255,0.6)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 14,
  background: "#fff",
  border: "1.5px solid #e2e8f0",
  borderRadius: 10,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  color: "#0f172a",
  fontWeight: 600,
  WebkitTextFillColor: "#0f172a",
  caretColor: "#6366f1",
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  fontSize: 15,
  fontWeight: 700,
  color: "#fff",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(99, 102, 241, 0.3)",
  fontFamily: "inherit",
};

const secondaryBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: "#f1f5f9",
  color: "#64748b",
  boxShadow: "none",
};

const errorStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 10,
  fontSize: 12,
  color: "#b91c1c",
  marginBottom: 12,
};

const arrowBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: disabled ? "#f1f5f9" : "#fff",
  border: "1.5px solid #e2e8f0",
  fontSize: 14,
  cursor: disabled ? "default" : "pointer",
  color: disabled ? "#cbd5e1" : "#475569",
  flexShrink: 0,
});

const infoLabel: React.CSSProperties = {
  fontSize: 11,
  color: "#64748b",
  fontWeight: 600,
};

const infoValue: React.CSSProperties = {
  fontSize: 12,
  color: "#1e293b",
  fontWeight: 500,
};
