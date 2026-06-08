"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, mapToSystemRole, type Role } from "@/lib/roles";
import {
  supabase,
  validateUsername,
  validatePassword,
  normalizePhone,
  formatPhone,
} from "@/lib/supabase";
import ModalBackdrop from "@/components/ModalBackdrop";

type Step = "lookup" | "confirm" | "role" | "info" | "done";
type RoleGroupId = "clergy" | "coworkers" | "permanent" | "members" | "nextgen";

const displayGender = (value?: string | null) => {
  if (value === "M") return "남";
  if (value === "F") return "여";
  return value || "";
};

const normalizeGenderValue = (value?: string | null) => {
  if (value === "남") return "M";
  if (value === "여") return "F";
  return value || "";
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "알 수 없는 오류";
};

const cssUrl = (url: string) => `url(${JSON.stringify(url)})`;

interface DaumPostcodeData {
  roadAddress?: string;
  jibunAddress?: string;
  address?: string;
  zonecode?: string;
  buildingName?: string;
  apartment?: "Y" | "N";
}

interface DaumPostcode {
  open: () => void;
}

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: { oncomplete: (data: DaumPostcodeData) => void }) => DaumPostcode;
    };
  }
}

let daumPostcodePromise: Promise<void> | null = null;

function loadDaumPostcodeScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 주소 검색을 사용할 수 있습니다"));
  if (window.daum?.Postcode) return Promise.resolve();
  if (daumPostcodePromise) return daumPostcodePromise;

  daumPostcodePromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("daum-postcode-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("주소 검색 스크립트를 불러오지 못했습니다")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "daum-postcode-script";
    script.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("주소 검색 스크립트를 불러오지 못했습니다"));
    document.head.appendChild(script);
  });

  return daumPostcodePromise;
}

const ROLE_GROUPS: { id: RoleGroupId; label: string; roleIds: string[] }[] = [
  { id: "clergy", label: "\uAD50\uC5ED\uC790", roleIds: ["pastor", "missionary", "evangelist", "pastor_wife"] },
  { id: "coworkers", label: "\uB3D9\uC5ED\uC790", roleIds: ["educator", "coordinator"] },
  { id: "permanent", label: "\uD56D\uC874\uC9C1", roleIds: ["elder", "serving_deacon", "deaconess"] },
  { id: "members", label: "\uC131\uB3C4", roleIds: ["acting_deacon_male", "acting_deacon_female", "member_male", "member_female"] },
  { id: "nextgen", label: "\uB2E4\uC74C\uC138\uB300", roleIds: ["youth_male", "youth_female", "teen_male", "teen_female", "child_male", "child_female", "toddler_male", "toddler_female"] },
];

interface MatchedMember {
  id: string;
  name: string;
  phone: string;
  birth_date?: string | null;
  gender?: string | null;
  family_church: string;
  sub_role: string;
  spouse_name: string;
  household_id: string;
  pasture_id?: string | null;
  grassland_id?: string | null;
  plain_id?: string | null;
  pasture_name: string;
  grassland_name: string;
  plain_name: string;
  address: string;
  has_account: boolean;
  photo_url?: string | null;
  // 자녀 매칭 시 부모 정보
  parent_id?: string;
  parent_name?: string;
  parent_phone?: string;
  matched_as_child?: boolean;
}

interface ParentMatch {
  parent_id: string;
  parent_name: string;
  parent_phone: string;
  household_id: string;
  pasture_id: string | null;
  grassland_id: string | null;
  plain_id: string | null;
  pasture_name: string | null;
  grassland_name: string | null;
  plain_name: string | null;
  address: string | null;
}

interface PastureOption {
  pasture_id: string;
  pasture_name: string;
  grassland_id: string;
  grassland_name: string;
  plain_id: string;
  plain_name: string;
  label: string;
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
  const [roleGroup, setRoleGroup] = useState<RoleGroupId>("members");

  // 정보 입력
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [address, setAddress] = useState("");
  const [pastureId, setPastureId] = useState("");
  const [pastureSearch, setPastureSearch] = useState("");
  const [showPastureSuggestions, setShowPastureSuggestions] = useState(false);
  const [parentMatch, setParentMatch] = useState<ParentMatch | null>(null);
  const [pastureOptions, setPastureOptions] = useState<PastureOption[]>([]);

  // 약관 동의
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeGuardian, setAgreeGuardian] = useState(false);

  // 공통
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("list_signup_pastures");
      setPastureOptions((data as PastureOption[]) || []);
    })();
  }, []);

  useEffect(() => {
    if (!pastureId) return;
    const selected = pastureOptions.find((option) => option.pasture_id === pastureId);
    if (selected) setPastureSearch(selected.label);
  }, [pastureId, pastureOptions]);

  const filteredPastureOptions = useMemo(() => {
    const query = pastureSearch.trim().toLowerCase().replace(/\s+/g, "");
    const options = query
      ? pastureOptions.filter((option) => {
        const haystack = [
          option.label,
          option.pasture_name,
          option.grassland_name,
          option.plain_name,
        ].join(" ").toLowerCase().replace(/\s+/g, "");
        return haystack.includes(query);
      })
      : pastureOptions;
    return options.slice(0, 12);
  }, [pastureOptions, pastureSearch]);

  const fillMemberFields = (member: Partial<MatchedMember>) => {
    setName(member.name || "");
    setPhone(member.phone || "");
    setBirthDate(member.birth_date || "");
    setGender(normalizeGenderValue(member.gender));
    setAddress(member.address || "");
    setPastureId(member.pasture_id || "");
    if (!member.pasture_id) setPastureSearch("");
  };

  const fillParentFields = (parent: ParentMatch) => {
    setParentMatch(parent);
    setAddress(parent.address || "");
    setPastureId(parent.pasture_id || "");
    if (!parent.pasture_id) setPastureSearch("");
  };

  const clearPasture = () => {
    setPastureId("");
    setPastureSearch("");
    setShowPastureSuggestions(false);
  };

  const selectPasture = (option: PastureOption) => {
    setPastureId(option.pasture_id);
    setPastureSearch(option.label);
    setShowPastureSuggestions(false);
  };

  const openAddressSearch = async () => {
    setError("");
    try {
      await loadDaumPostcodeScript();
      if (!window.daum?.Postcode) throw new Error("주소 검색을 시작하지 못했습니다");
      new window.daum.Postcode({
        oncomplete: (data) => {
          const baseAddress = data.roadAddress || data.jibunAddress || data.address || "";
          const building = data.buildingName && data.apartment === "Y" ? ` (${data.buildingName})` : "";
          setAddress(`${baseAddress}${building}`.trim());
        },
      }).open();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  // 안드로이드/브라우저 뒤로가기 버튼 → 앱종료 대신 이전 step/모달 닫기
  // 마운트 시 가드 history entry 1개 추가, popstate 발생할 때마다 한 단계 되돌리고 가드 재충전
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ chflowSignupGuard: true }, "");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      if (showSubRoleModal) {
        setShowSubRoleModal(null);
      } else if (step === "info") {
        setStep("role");
      } else if (step === "role") {
        setStep(matched ? "confirm" : "lookup");
      } else if (step === "confirm") {
        setStep("lookup");
      } else if (step === "done") {
        router.push("/login?notice=signup");
        return;
      } else {
        // step === "lookup": 회원가입 진입 직전 화면(로그인)으로
        router.push("/login");
        return;
      }
      // 가드 entry 재충전 (다음 뒤로가기에서도 동일 처리)
      window.history.pushState({ chflowSignupGuard: true }, "");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [step, showSubRoleModal, matched, router]);

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
          fillMemberFields(member);
          setParentMatch({
            parent_id: member.parent_id || "",
            parent_name: member.parent_name || parentName.trim(),
            parent_phone: member.parent_phone || pFormatted,
            household_id: member.household_id,
            pasture_id: member.pasture_id || null,
            grassland_id: member.grassland_id || null,
            plain_id: member.plain_id || null,
            pasture_name: member.pasture_name || null,
            grassland_name: member.grassland_name || null,
            plain_name: member.plain_name || null,
            address: member.address || null,
          });
          setStep("confirm");
        } else {
          const { data: parentData } = await supabase.rpc("find_parent_for_child_signup", {
            p_parent_name: parentName.trim(),
            p_parent_phone: pFormatted,
          });
          const parent = parentData?.[0] as ParentMatch | undefined;
          if (parent) fillParentFields(parent);

          // 부모 매칭 실패 또는 해당 가족 내 자녀 이름 없음 → 신규 자녀 가입
          setMatched(null);
          setName(lookupName.trim());
          setPhone(""); // 자녀는 핸드폰 없음
          setBirthDate("");
          setGender("");
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
        fillMemberFields(member);
        setStep("confirm");
      } else {
        // 매칭 실패 → 신규 가입
        setMatched(null);
        setParentMatch(null);
        setName(lookupName.trim());
        setPhone(lookupPhone.trim());
        setBirthDate("");
        setGender("");
        setAddress("");
        setPastureId("");
        setPastureSearch("");
        setStep("role");
      }
    } catch (e: unknown) {
      setError(`오류: ${getErrorMessage(e)}`);
    }
    setLoading(false);
  };

  // ============ Step 2: 매칭 확인 ============
  const handleConfirmYes = () => {
    if (!matched) return;
    // 매칭된 정보로 자동 채움
    fillMemberFields(matched);
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
      fillMemberFields(matched);
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

  // ============ Step 3: 직분 선택 ============
  const visibleRoles = ROLES.filter((role) =>
    ROLE_GROUPS.find((group) => group.id === roleGroup)?.roleIds.includes(role.id)
  );

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
    if (!birthDate) return setError("생년월일을 입력하세요");
    if (!gender) return setError("성별을 선택하세요");
    if (!address.trim()) return setError("주소를 입력하세요");
    if (!selectedRole) return setError("직분을 선택하세요");
    if (!agreePrivacy) return setError("개인정보 수집·이용에 동의해주세요");
    if (noPhone && !agreeGuardian) return setError("법정대리인(보호자) 동의가 필요합니다");

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
          birthDate,
          gender,
          address: address.trim(),
          pastureId: pastureId || null,
          parentMemberId: matched?.parent_id || parentMatch?.parent_id || null,
          householdId: matched?.household_id || parentMatch?.household_id || null,
          guardianName: noPhone ? parentName.trim() : null,
          guardianPhone: noPhone ? normalizePhone(parentPhone) : null,
          isChild: noPhone,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "가입에 실패했습니다");
        setLoading(false);
        return;
      }
      setStep("done");
    } catch (e: unknown) {
      setError(`오류: ${getErrorMessage(e)}`);
    }
    setLoading(false);
  };

  // ============ Render ============

  // 가입 완료
  if (step === "done") {
    return (
      <div style={pageStyle}>
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
        <div style={cardStyle}>
          <BackBar onBack={() => router.push("/login")} title="회원가입" />

          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#1e293b", letterSpacing: -0.5 }}>
              스마트명성 <span style={{ color: "var(--ink-soft)", fontSize: 14, fontWeight: 600 }}>회원가입</span>
            </div>
            <div className="auth-copy" style={{ marginTop: 14 }}>
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
                onChange={(e) => setLookupPhone(formatPhone(e.target.value))}
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
                  style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
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
                    onChange={(e) => setParentPhone(formatPhone(e.target.value))}
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

          <div className="auth-muted-panel" style={{ marginTop: 20 }}>
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
        <div style={cardStyle}>
          <BackBar onBack={() => setStep("lookup")} title="본인 확인" />

          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>회원 정보 발견!</div>
            <div style={{ fontSize: 18, fontWeight: 850, color: "var(--ink)", marginTop: 8 }}>
              아래 분이 맞으십니까?
            </div>
          </div>

          <div style={{
            background: "#f3f7f1",
            border: "1px solid rgba(62, 90, 74, 0.16)",
            borderRadius: 8,
            padding: "20px 18px",
            marginBottom: 20,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              {matched.photo_url && (
                <div style={{
                  width: 64, height: 64, borderRadius: "50%",
                  background: "#dbeafe", overflow: "hidden",
                  border: "1px solid rgba(62, 90, 74, 0.16)",
                  flexShrink: 0,
                  backgroundImage: cssUrl(matched.photo_url),
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}>
                  <span style={visuallyHiddenStyle}>{matched.name}</span>
                </div>
              )}
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "#dbeafe", display: matched.photo_url ? "none" : "flex", alignItems: "center",
                justifyContent: "center", fontSize: 28,
              }}>👤</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 850, color: "var(--ink)" }}>
                  {matched.name} <span style={{ fontSize: 14, color: "var(--accent)", marginLeft: 6 }}>{matched.sub_role || matched.family_church}</span>
                </div>
                {matched.spouse_name && (
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
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
              {matched.birth_date && (
                <>
                  <div style={infoLabel}>생년월일</div>
                  <div style={infoValue}>{matched.birth_date}</div>
                </>
              )}
              {matched.gender && (
                <>
                  <div style={infoLabel}>성별</div>
                  <div style={infoValue}>{displayGender(matched.gender)}</div>
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

          <div style={{ marginTop: 16, fontSize: 11, color: "var(--ink-soft)", textAlign: "center", lineHeight: 1.6 }}>
            네 선택 시 정보가 자동으로 채워지며 직분 등은 본인이 수정 가능합니다.<br />
            아니오 선택 시 신규 가입으로 진행됩니다.
          </div>
        </div>
      </div>
    );
  }

  // ============ Step 3: 직분 선택 ============
  if (step === "role") {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, maxWidth: 720 }}>
          <BackBar onBack={() => setStep(matched ? "confirm" : "lookup")} title="직분 선택" />

          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--accent)", marginTop: 4, letterSpacing: 0 }}>
              † 직분을 선택하세요 †
            </div>
          </div>

          <div className="role-tabs" style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 14,
          }}>
            {ROLE_GROUPS.map((group) => {
              const active = group.id === roleGroup;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setRoleGroup(group.id)}
                  style={{
                    height: 38,
                    border: active ? "1px solid var(--accent)" : "1px solid rgba(43, 39, 34, 0.12)",
                    background: active ? "var(--accent-soft)" : "rgba(255,255,255,0.86)",
                    color: active ? "var(--accent)" : "var(--ink-soft)",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {group.label}
                </button>
              );
            })}
          </div>

          <div className="role-grid" style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 10,
            maxHeight: "none",
            overflowY: "visible",
            padding: "2px 2px 8px",
          }}>
            {visibleRoles.map((role) => (
              <RoleCard key={role.id} role={role} onClick={() => handleRoleSelect(role)} />
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
            <div style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: "#f8fafc",
              color: "#94a3b8",
              fontSize: 11,
              fontWeight: 700,
            }}>
              {`${visibleRoles.length}\uAC1C`}
            </div>
          </div>
        </div>

        {showSubRoleModal && (
          <SubRoleModal role={showSubRoleModal} onSelect={handleSubRoleSelect} onClose={() => setShowSubRoleModal(null)} />
        )}

        <style jsx global>{`
          @media (max-width: 560px) {
            .role-tabs { grid-template-columns: repeat(3, 1fr) !important; }
            .role-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; max-height: none !important; overflow: visible !important; }
          }
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
      <div style={{ ...cardStyle, maxWidth: 480 }}>
        <BackBar onBack={() => setStep("role")} title="가입 정보 입력" />

        {selectedRole ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: "var(--accent-soft)", borderRadius: 8, marginBottom: 16 }}>
            <div
              role="img"
              aria-label={selectedSubRole || selectedRole.label}
              style={{
                width: 56,
                height: 72,
                borderRadius: 8,
                backgroundImage: cssUrl(selectedSubRole && selectedRole.subRoles
                  ? selectedRole.subRoles.find(s => s.label === selectedSubRole)?.image || selectedRole.image
                  : selectedRole.image),
                backgroundSize: "contain",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 700 }}>선택한 직분</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
                {selectedSubRole || selectedRole.label}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStep("role")}
              style={{
                padding: "6px 12px",
                background: "#fff",
                border: "1px solid var(--accent)",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                color: "var(--accent)",
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
          <div style={{ padding: "10px 14px", background: "#f3f7f1", border: "1px solid rgba(62, 90, 74, 0.16)", borderRadius: 8, fontSize: 11, color: "var(--accent)", marginBottom: 14, fontWeight: 700 }}>
            ✓ 명성교회 등록 회원으로 확인되어 정보가 자동 입력되었습니다
          </div>
        )}

        {noPhone && (matched?.parent_name || parentMatch?.parent_name || parentName) && (
          <div style={{ padding: "10px 14px", background: "#f3f7f1", border: "1px solid rgba(62, 90, 74, 0.16)", borderRadius: 8, fontSize: 11, color: "var(--ink-soft)", marginBottom: 14, lineHeight: 1.5 }}>
            <strong style={{ color: "var(--accent)" }}>보호자 연결</strong><br />
            {(matched?.parent_name || parentMatch?.parent_name || parentName)} / {formatPhone(matched?.parent_phone || parentMatch?.parent_phone || parentPhone)}
          </div>
        )}

        <form onSubmit={handleSignup}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>이름 *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="실명" style={{ ...inputStyle, marginTop: 6 }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>전화번호 {noPhone ? "(선택)" : "*"}</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder={noPhone ? "휴대폰 없으시면 비워두셔도 됩니다" : "010-0000-0000"}
              style={{ ...inputStyle, marginTop: 6 }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>생년월일 *</label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                style={{ ...inputStyle, marginTop: 6 }}
              />
            </div>
            <div>
              <label style={labelStyle}>성별 *</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                style={{ ...inputStyle, marginTop: 6 }}
              >
                <option value="">선택</option>
                <option value="M">남</option>
                <option value="F">여</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>주소 *</label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="주소 검색 후 상세주소를 추가하세요"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={openAddressSearch}
                style={{
                  width: 76,
                  border: "1px solid rgba(62, 90, 74, 0.22)",
                  borderRadius: 8,
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  fontSize: 12,
                  fontWeight: 800,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                검색
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>목장</label>
            <div style={{ position: "relative", marginTop: 6 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={pastureSearch}
                  onChange={(e) => {
                    setPastureSearch(e.target.value);
                    setPastureId("");
                    setShowPastureSuggestions(true);
                  }}
                  onFocus={() => setShowPastureSuggestions(true)}
                  onBlur={() => window.setTimeout(() => setShowPastureSuggestions(false), 120)}
                  placeholder="목장명, 초원, 평원으로 검색"
                  autoComplete="off"
                  style={{ ...inputStyle, flex: 1 }}
                />
                {(pastureId || pastureSearch) && (
                  <button
                    type="button"
                    onClick={clearPasture}
                    style={{
                      width: 56,
                      border: "1px solid rgba(43, 39, 34, 0.14)",
                      borderRadius: 8,
                      background: "#fff",
                      color: "var(--ink-soft)",
                      fontSize: 12,
                      fontWeight: 800,
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    지움
                  </button>
                )}
              </div>
              {showPastureSuggestions && (
                <div style={pastureSuggestStyle}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearPasture();
                    }}
                    style={pastureOptionStyle}
                  >
                    <span style={{ fontWeight: 800, color: "var(--ink)" }}>모름 / 미정</span>
                  </button>
                  {filteredPastureOptions.map((option) => (
                    <button
                      key={option.pasture_id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectPasture(option);
                      }}
                      style={{
                        ...pastureOptionStyle,
                        background: option.pasture_id === pastureId ? "var(--accent-soft)" : "#fff",
                      }}
                    >
                      <span style={{ fontWeight: 800, color: "var(--ink)" }}>{option.pasture_name}</span>
                      <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                        {option.plain_name} / {option.grassland_name}
                      </span>
                    </button>
                  ))}
                  {filteredPastureOptions.length === 0 && (
                    <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--ink-soft)" }}>
                      일치하는 목장이 없습니다
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

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
                style={{ padding: "0 14px", background: usernameStatus === "available" ? "#3E5A4A" : "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
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
                placeholder="8자 이상 (문자, 숫자, 기호 조합 권장)" style={{ ...inputStyle, paddingRight: 44 }} />
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

          <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 12, color: "#334155", lineHeight: 1.5, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={agreePrivacy}
                onChange={(e) => setAgreePrivacy(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--accent)", marginTop: 2, flexShrink: 0 }}
              />
              <span>
                <span style={{ color: "#dc2626" }}>[필수]</span> 개인정보 수집·이용에 동의합니다{" "}
                <a
                  href="/privacy"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: "var(--accent)", textDecoration: "underline", fontWeight: 700 }}
                >
                  전문보기
                </a>
              </span>
            </label>
            {noPhone && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 12, color: "#334155", lineHeight: 1.5, fontWeight: 600, marginTop: 10, paddingTop: 10, borderTop: "1px dashed #cbd5e1" }}>
                <input
                  type="checkbox"
                  checked={agreeGuardian}
                  onChange={(e) => setAgreeGuardian(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "var(--accent)", marginTop: 2, flexShrink: 0 }}
                />
                <span>
                  <span style={{ color: "#dc2626" }}>[필수]</span> 만 14세 미만 가입에 대해 법정대리인(보호자)이 동의합니다
                </span>
              </label>
            )}
          </div>

          {error && <div style={errorStyle}>⚠️ {error}</div>}

          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? "가입 신청 중..." : "가입 신청"}
          </button>
        </form>

          <div style={{ fontSize: 10, color: "var(--ink-soft)", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
            가입 신청 후 관리자 승인이 필요합니다
          </div>
      </div>
    </div>
  );
}

// ============ Components ============
function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="auth-topbar" style={{ marginBottom: 20 }}>
      <button onClick={onBack} className="auth-back-button" aria-label="뒤로가기">←</button>
      <div className="auth-page-title">{title}</div>
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
    onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.transform = "translateY(-4px)"; }}
    onMouseOut={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.transform = "translateY(0)"; }}>
      <div
        role="img"
        aria-label={role.label}
        style={{
          width: "100%",
          height: "100%",
          backgroundImage: cssUrl(role.image),
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        }}
      />
      {role.subRoles && role.subRoles.length > 0 && (
        <div style={{ position: "absolute", top: 6, right: 6, padding: "2px 8px",
        background: "var(--accent)", color: "#fff", borderRadius: 8,
          fontSize: 9, fontWeight: 700 }}>▼</div>
      )}
    </div>
  );
}

function SubRoleModal({ role, onSelect, onClose }: { role: Role; onSelect: (label: string) => void; onClose: () => void }) {
  return (
    <ModalBackdrop onClose={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)",
      backdropFilter: "blur(6px)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 100, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "rgba(255, 253, 248, 0.96)", borderRadius: 8, padding: "24px 20px",
        width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div
            role="img"
            aria-label={role.label}
            style={{
              width: 56,
              height: 72,
              borderRadius: 8,
              backgroundImage: cssUrl(role.image),
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              flexShrink: 0,
            }}
          />
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
              <div
                role="img"
                aria-label={sub.label}
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundImage: cssUrl(sub.image),
                  backgroundSize: "contain",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "center",
                }}
              />
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{
          width: "100%", marginTop: 14, padding: "12px",
          background: "#f1f5f9", border: "none", borderRadius: 10,
          fontSize: 13, fontWeight: 600, color: "#64748b", cursor: "pointer", fontFamily: "inherit",
        }}>취소</button>
      </div>
    </ModalBackdrop>
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
  minHeight: "100svh",
  background: "linear-gradient(160deg, #f7f4ec 0%, #eef5f1 48%, #e8eff7 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "calc(24px + var(--safe-top)) 18px calc(24px + var(--safe-bottom))",
  fontFamily: "var(--app-sans)",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "rgba(255, 253, 248, 0.92)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: 8,
  padding: "30px",
  boxShadow: "0 24px 70px rgba(43, 39, 34, 0.12)",
  border: "1px solid rgba(43, 39, 34, 0.08)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 750,
  color: "var(--ink)",
  letterSpacing: 0,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 54,
  padding: "0 16px",
  fontSize: 15,
  background: "rgba(255, 255, 255, 0.86)",
  border: "1px solid rgba(43, 39, 34, 0.14)",
  borderRadius: 8,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  color: "var(--ink)",
  fontWeight: 650,
  WebkitTextFillColor: "var(--ink)",
  caretColor: "var(--accent)",
};

const pastureSuggestStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 20,
  top: "calc(100% + 6px)",
  left: 0,
  right: 0,
  maxHeight: 280,
  overflowY: "auto",
  background: "#fff",
  border: "1px solid rgba(43, 39, 34, 0.14)",
  borderRadius: 8,
  boxShadow: "0 14px 34px rgba(43, 39, 34, 0.14)",
  padding: 6,
};

const pastureOptionStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "9px 10px",
  border: "none",
  borderRadius: 7,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "left",
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  height: 56,
  padding: "0 16px",
  fontSize: 16,
  fontWeight: 800,
  color: "#fff",
  background: "var(--accent)",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  boxShadow: "0 16px 34px rgba(62, 90, 74, 0.24)",
  fontFamily: "inherit",
  letterSpacing: 0,
};

const secondaryBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: "var(--accent-soft)",
  color: "var(--accent)",
  boxShadow: "none",
};

const errorStyle: React.CSSProperties = {
  padding: "11px 12px",
  background: "#fff1ed",
  border: "1px solid #f2c9c1",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 650,
  color: "#8f2d2d",
  marginBottom: 12,
};

const infoLabel: React.CSSProperties = {
  fontSize: 11,
  color: "var(--ink-soft)",
  fontWeight: 600,
};

const infoValue: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink)",
  fontWeight: 500,
};

const visuallyHiddenStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};
