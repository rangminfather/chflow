"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, mapToSystemRole, resolveRoleFromMemberSubRole, type Role } from "@/lib/roles";
import {
  supabase,
  validateUsername,
  validatePassword,
  normalizePhone,
  formatPhone,
} from "@/lib/supabase";
import ModalBackdrop from "@/components/ModalBackdrop";
import { CheckCircle2, Users, User, AlertTriangle, Lightbulb, MousePointerClick, Eye, EyeOff, ShieldCheck, ClipboardEdit, Send } from "lucide-react";

type Step = "entry" | "lookup" | "confirm" | "role" | "info" | "done";
type SignupMethod = "manual" | "verified";
type IdentityProvider = "naver" | "kakao";
type RoleGroupId = "clergy" | "coworkers" | "permanent" | "members" | "nextgen";

const IDENTITY_PROVIDERS: Array<{ id: IdentityProvider; label: string; tone: string }> = [
  { id: "naver", label: "네이버", tone: "#03c75a" },
];

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

const normalizeSearchText = (value: string) => (
  value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·/.,_-]/g, "")
    .replace(/목장/g, "")
);

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
  embed: (element: HTMLElement) => void;
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
const NEW_MEMBER_ROLE_IDS = ["member_male", "member_female"];
const NEXTGEN_ROLE_IDS = ["youth_male", "youth_female", "teen_male", "teen_female", "child_male", "child_female", "toddler_male", "toddler_female"];

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
  address_base?: string | null;
  address_detail?: string | null;
  address_zonecode?: string | null;
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
  address_base: string | null;
  address_detail: string | null;
  address_zonecode: string | null;
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
  const [step, setStep] = useState<Step>("entry");
  const [signupMethod, setSignupMethod] = useState<SignupMethod>("manual");
  const [identityVerificationToken, setIdentityVerificationToken] = useState<string | null>(null);

  // === 입력 데이터 ===
  const [lookupName, setLookupName] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [noPhone, setNoPhone] = useState(false);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [matched, setMatched] = useState<MatchedMember | null>(null);
  const [confirmedMatchedMember, setConfirmedMatchedMember] = useState(false);

  // 직분
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [selectedSubRole, setSelectedSubRole] = useState<string | null>(null);
  const [showSubRoleModal, setShowSubRoleModal] = useState<Role | null>(null);
  const [roleGroup, setRoleGroup] = useState<RoleGroupId>("members");
  const [isRoleLocked, setIsRoleLocked] = useState(false);

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
  const [addressDetail, setAddressDetail] = useState("");
  const [addressZonecode, setAddressZonecode] = useState("");
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [pastureId, setPastureId] = useState("");
  const [pastureSearch, setPastureSearch] = useState("");
  const [showPastureSuggestions, setShowPastureSuggestions] = useState(false);
  const [parentMatch, setParentMatch] = useState<ParentMatch | null>(null);
  const [pastureOptions, setPastureOptions] = useState<PastureOption[]>([]);
  const addressDetailRef = useRef<HTMLInputElement | null>(null);
  const addressSearchRef = useRef<HTMLDivElement | null>(null);

  // 약관 동의
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeGuardian, setAgreeGuardian] = useState(false);

  // 공통
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [supportTitle, setSupportTitle] = useState("");
  const [supportBody, setSupportBody] = useState("");
  const [supportSending, setSupportSending] = useState(false);
  const [supportDone, setSupportDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("list_signup_pastures");
      setPastureOptions((data as PastureOption[]) || []);
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const identityError = params.get("identity_error");
    if (identityError) {
      setError(identityError);
      setStep("entry");
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    const token = params.get("identity_token");
    const identityName = params.get("identity_name") || "";
    const identityPhone = params.get("identity_phone") || "";
    if (!token) return;

    setSignupMethod("verified");
    setIdentityVerificationToken(token);
    setLookupName(identityName);
    setLookupPhone(formatPhone(identityPhone));
    setName(identityName);
    setPhone(formatPhone(identityPhone));
    setNoPhone(false);
    setError("");
    setStep("lookup");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!pastureId) return;
    const selected = pastureOptions.find((option) => option.pasture_id === pastureId);
    if (selected) setPastureSearch(selected.pasture_name);
  }, [pastureId, pastureOptions]);

  const selectedPasture = useMemo(
    () => pastureOptions.find((option) => option.pasture_id === pastureId) || null,
    [pastureId, pastureOptions],
  );

  const roleSelectionMode = noPhone
    ? "nextgen"
    : confirmedMatchedMember && matched
      ? "all"
      : "newMember";

  const allowedRoleGroups = useMemo(() => {
    if (roleSelectionMode === "nextgen") return ROLE_GROUPS.filter((group) => group.id === "nextgen");
    if (roleSelectionMode === "newMember") return ROLE_GROUPS.filter((group) => group.id === "members");
    return ROLE_GROUPS;
  }, [roleSelectionMode]);

  useEffect(() => {
    if (step !== "role") return;
    if (!allowedRoleGroups.some((group) => group.id === roleGroup)) {
      setRoleGroup(allowedRoleGroups[0]?.id || "members");
    }
  }, [allowedRoleGroups, roleGroup, step]);

  const fullAddress = useMemo(
    () => [address.trim(), addressDetail.trim()].filter(Boolean).join(" "),
    [address, addressDetail],
  );

  useEffect(() => {
    if (!addressSearchOpen) return;
    let cancelled = false;

    (async () => {
      try {
        await loadDaumPostcodeScript();
        if (cancelled || !addressSearchRef.current) return;
        if (!window.daum?.Postcode) throw new Error("주소 검색을 시작하지 못했습니다");

        addressSearchRef.current.innerHTML = "";
        new window.daum.Postcode({
          oncomplete: (data) => {
            const baseAddress = data.roadAddress || data.jibunAddress || data.address || "";
            const building = data.buildingName && data.apartment === "Y" ? ` (${data.buildingName})` : "";
            setAddress(`${baseAddress}${building}`.trim());
            setAddressZonecode(data.zonecode || "");
            setAddressDetail("");
            setAddressSearchOpen(false);
            window.setTimeout(() => addressDetailRef.current?.focus(), 80);
          },
        }).embed(addressSearchRef.current);
      } catch (e: unknown) {
        setError(getErrorMessage(e));
        setAddressSearchOpen(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addressSearchOpen]);

  const filteredPastureOptions = useMemo(() => {
    const query = normalizeSearchText(pastureSearch);
    const options = query
      ? pastureOptions
        .filter((option) => {
          const pastureName = normalizeSearchText(option.pasture_name);
          const fullLabel = normalizeSearchText([
            option.label,
            option.grassland_name,
            option.plain_name,
          ].join(" "));
          return pastureName.includes(query) || fullLabel.includes(query);
        })
        .sort((a, b) => {
          const aName = normalizeSearchText(a.pasture_name);
          const bName = normalizeSearchText(b.pasture_name);
          const aStarts = aName.startsWith(query) ? 0 : 1;
          const bStarts = bName.startsWith(query) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return a.pasture_name.localeCompare(b.pasture_name, "ko");
        })
      : pastureOptions;
    return options.slice(0, 12);
  }, [pastureOptions, pastureSearch]);

  const fillMemberFields = (member: Partial<MatchedMember>) => {
    setName(member.name || "");
    setPhone(member.phone || "");
    setBirthDate(member.birth_date || "");
    setGender(normalizeGenderValue(member.gender));
    setAddress(member.address_base || member.address || "");
    setAddressDetail(member.address_detail || "");
    setAddressZonecode(member.address_zonecode || "");
    setPastureId(member.pasture_id || "");
    if (!member.pasture_id) setPastureSearch("");
  };

  const fillParentFields = (parent: ParentMatch) => {
    setParentMatch(parent);
    setAddress(parent.address_base || parent.address || "");
    setAddressDetail(parent.address_detail || "");
    setAddressZonecode(parent.address_zonecode || "");
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
    setPastureSearch(option.pasture_name);
    setShowPastureSuggestions(false);
  };

  const openAddressSearch = async () => {
    setError("");
    setAddressSearchOpen(true);
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
      } else if (step === "lookup") {
        setStep("entry");
      } else {
        // step === "entry": 회원가입 진입 직전 화면(로그인)으로
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
      setConfirmedMatchedMember(false);
      // === 자녀 분기: 부모 정보로 매칭 ===
      if (noPhone) {
        const pNorm = normalizePhone(parentPhone);
        const pFormatted = pNorm.length >= 10
          ? `${pNorm.slice(0, 3)}-${pNorm.slice(3, 7)}-${pNorm.slice(7, 11)}`
          : parentPhone;

        const childRes = await fetch("/api/signup/find-child", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childName: lookupName.trim(), parentName: parentName.trim(), parentPhone: pFormatted }),
        });
        const childJson = await childRes.json();
        if (!childRes.ok) {
          setError(`조회 오류: ${childJson.error ?? childRes.statusText}`);
          setLoading(false);
          return;
        }
        const data: MatchedMember[] = childJson.data ?? [];
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
            address_base: member.address_base || null,
            address_detail: member.address_detail || null,
            address_zonecode: member.address_zonecode || null,
          });
          setStep("confirm");
        } else {
          const parentRes = await fetch("/api/signup/find-parent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentName: parentName.trim(), parentPhone: pFormatted }),
          });
          const parentJson = parentRes.ok ? await parentRes.json() : { data: [] };
          const parent = (parentJson.data?.[0] ?? undefined) as ParentMatch | undefined;
          if (parent) fillParentFields(parent);

          // 부모 매칭 실패 또는 해당 가족 내 자녀 이름 없음 → 신규 자녀 가입
          setMatched(null);
          setSelectedRole(null);
          setSelectedSubRole(null);
          setName(lookupName.trim());
          setPhone(""); // 자녀는 핸드폰 없음
          setBirthDate("");
          setGender("");
          setRoleGroup("nextgen"); // 자녀 가입은 다음세대 탭부터
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

      const memberRes = await fetch("/api/signup/find-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: lookupName.trim(), phone: phoneFormatted }),
      });
      const memberJson = await memberRes.json();
      if (!memberRes.ok) {
        setError(`조회 오류: ${memberJson.error ?? memberRes.statusText}`);
        setLoading(false);
        return;
      }
      const data: MatchedMember[] = memberJson.data ?? [];

      if (data && data.length > 0) {
        const member = data[0] as MatchedMember;
        if (member.has_account) {
          setError("이미 가입된 회원입니다. 로그인 또는 비밀번호 찾기를 이용하세요.");
          setLoading(false);
          return;
        }
        setMatched(member);
        setConfirmedMatchedMember(false);
        fillMemberFields(member);
        setStep("confirm");
      } else {
        // 매칭 실패 → 신규 가입
        setMatched(null);
        setSelectedRole(null);
        setSelectedSubRole(null);
        setParentMatch(null);
        setName(lookupName.trim());
        setPhone(lookupPhone.trim());
        setBirthDate("");
        setGender("");
        setAddress("");
        setAddressDetail("");
        setAddressZonecode("");
        setPastureId("");
        setPastureSearch("");
        setRoleGroup("members");
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
    setConfirmedMatchedMember(true);
    setIsRoleLocked(false);
    // 요람 직분이 있으면 해당 직분이 속한 분류 탭으로 미리 이동 + 직분 미리 선택
    // (별칭 + 성별 보정: "은퇴권사"→은퇴시무권사, "성도"+여→성도(여))
    const r = resolveRoleFromMemberSubRole(matched.sub_role, matched.gender);
    if (r && (!noPhone || NEXTGEN_ROLE_IDS.includes(r.role.id))) {
      setSelectedRole(r.role);
      setSelectedSubRole(r.subRole || null);
      const group = ROLE_GROUPS.find((g) => g.roleIds.includes(r.role.id));
      if (group) setRoleGroup(group.id);
    } else {
      setSelectedRole(null);
      setSelectedSubRole(null);
      setRoleGroup(noPhone ? "nextgen" : "members");
    }
    setStep("role");
  };

  const handleConfirmNo = () => {
    setConfirmedMatchedMember(false);
    setIsRoleLocked(false);
    // 신규 가입이지만 매칭된 정보는 그대로 채워줌
    if (matched) {
      fillMemberFields(matched);
    }
    setSelectedRole(null);
    setSelectedSubRole(null);
    setRoleGroup(noPhone ? "nextgen" : "members");
    setStep("role");
  };

  const startManualSignup = () => {
    setSignupMethod("manual");
    setIdentityVerificationToken(null);
    setError("");
    setStep("lookup");
  };

  const startVerifiedSignup = async (provider: IdentityProvider) => {
    setError("");
    setLoading(true);
    window.location.href = `/api/signup/identity/start?provider=${provider}`;
  };

  const submitSignupSupport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSupportDone(false);
    if (!supportTitle.trim()) return setError("문의 제목을 입력해 주세요.");
    if (!supportBody.trim()) return setError("문의 내용을 입력해 주세요.");
    setSupportSending(true);
    try {
      const res = await fetch("/api/signup/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: supportTitle.trim(),
          body: supportBody.trim(),
          name: lookupName.trim() || name.trim(),
          phone: lookupPhone.trim() || phone.trim() || parentPhone.trim(),
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(result.error || "문의 접수에 실패했습니다.");
        return;
      }
      setSupportTitle("");
      setSupportBody("");
      setSupportDone(true);
    } catch (err: unknown) {
      setError(`문의 접수 오류: ${getErrorMessage(err)}`);
    } finally {
      setSupportSending(false);
    }
  };

  // ============ Render ============

  // 가입 완료
  if (step === "done") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ marginBottom: 20, textAlign: "center", color: "var(--success)" }}><CheckCircle2 size={44} strokeWidth={1.5} /></div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", marginBottom: 12, textAlign: "center" }}>
            가입 신청 완료!
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.6, textAlign: "center", marginBottom: 28 }}>
            가입 신청이 완료되었습니다.<br />
            <strong>관리자 승인</strong> 후 이용하실 수 있습니다.
          </div>
          <button onClick={() => router.push("/login?notice=signup")} style={primaryBtnStyle}>
            로그인 화면으로
          </button>
        </div>
      </div>
    );
  }

  if (step === "entry") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <BackBar onBack={() => router.push("/login")} title="회원가입" />

          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: 0 }}>
              스마트명성 <span style={{ color: "var(--ink-soft)", fontSize: 14, fontWeight: 600 }}>회원가입</span>
            </div>
            <div className="auth-copy" style={{ marginTop: 12 }}>
              가입 방법을 선택해 주세요.
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
            <div style={{ ...entryCardStyle, cursor: "default" }}>
              <span style={entryIconStyle}><ShieldCheck size={22} strokeWidth={1.8} /></span>
              <span style={{ flex: 1, textAlign: "left" }}>
                <strong style={entryTitleStyle}>본인인증으로 바로 가입</strong>
                <span style={entryDescStyle}>인증된 이름/전화번호가 교회 DB와 일치하면 관리자 승인 없이 가입됩니다.</span>
                <span style={providerRowStyle}>
                  {IDENTITY_PROVIDERS.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => startVerifiedSignup(provider.id)}
                      disabled={loading}
                      style={{ ...providerButtonStyle, borderColor: provider.tone }}
                    >
                      {provider.label}
                    </button>
                  ))}
                </span>
              </span>
            </div>

            <button type="button" onClick={startManualSignup} style={entryCardStyle}>
              <span style={entryIconStyle}><ClipboardEdit size={22} strokeWidth={1.8} /></span>
              <span style={{ flex: 1, textAlign: "left" }}>
                <strong style={entryTitleStyle}>정보입력으로 신청</strong>
                <span style={entryDescStyle}>이름/전화번호로 등록 교인을 확인하되, 가입 후 관리자 승인대기로 접수됩니다.</span>
              </span>
            </button>
          </div>

          {error && (
            <div style={{ ...errorStyle, display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}>
              <AlertTriangle size={14} strokeWidth={1.8} /> {error}
            </div>
          )}

          <SignupSupportBox
            title={supportTitle}
            body={supportBody}
            done={supportDone}
            sending={supportSending}
            onTitleChange={setSupportTitle}
            onBodyChange={setSupportBody}
            onSubmit={submitSignupSupport}
          />
        </div>
      </div>
    );
  }

  // ============ Step 1: 이름+휴대폰 lookup (+ 자녀 가입 분기) ============
  if (step === "lookup") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <BackBar onBack={() => setStep("entry")} title={signupMethod === "verified" ? "본인인증 가입" : "정보입력 신청"} />

          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: -0.5 }}>
              스마트명성 <span style={{ color: "var(--ink-soft)", fontSize: 14, fontWeight: 600 }}>회원가입</span>
            </div>
            <div className="auth-copy" style={{ marginTop: 14 }}>
              {signupMethod === "verified" ? "본인인증 결과로 등록 여부를 확인합니다" : "입력한 정보로 등록 여부를 확인합니다"}<br />
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
                placeholder="실명을 입력해주세요"
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
                  background: noPhone ? "var(--bg-soft)" : "#fff",
                  color: noPhone ? "var(--ink-faint)" : "var(--ink)",
                }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={noPhone}
                  onChange={(e) => { setNoPhone(e.target.checked); if (e.target.checked) setLookupPhone(""); }}
                  style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
                />
                휴대폰 없음 (어린이/유아)
              </label>
            </div>

            {noPhone && (
              <div style={{ padding: "14px", background: "var(--warning-soft)", border: "1.5px dashed #E0C893", borderRadius: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning)", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Users size={14} strokeWidth={1.8} /> 보호자 정보 (어린이 가입 시)
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>보호자 이름 *</label>
                  <input
                    type="text"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    placeholder="부 또는 모의 이름"
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>보호자 휴대폰 *</label>
                  <input
                    type="tel"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(formatPhone(e.target.value))}
                    placeholder="010-0000-0000"
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                </div>
                <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 8, lineHeight: 1.5 }}>
                  아버지/어머니/부모님/보호자 중 명성교회에 등록된 분의 이름을 입력하세요.
                </div>
              </div>
            )}

            {error && (
              <div style={{ ...errorStyle, display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>
            )}

            <button type="submit" disabled={loading} style={primaryBtnStyle}>
              {loading ? "확인 중..." : "확인"}
            </button>
          </form>

          <div className="auth-muted-panel" style={{ marginTop: 20 }}>
            <Lightbulb size={13} strokeWidth={1.8} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {signupMethod === "verified"
              ? "본인인증 정보가 교회 DB와 정확히 일치하면 바로 가입됩니다."
              : "정보입력 신청은 등록 교인으로 확인되어도 관리자 승인 후 이용할 수 있습니다."}<br />
            등록되지 않은 경우 신규회원 가입 절차로 이어집니다.
          </div>
          <SignupSupportBox
            title={supportTitle}
            body={supportBody}
            done={supportDone}
            sending={supportSending}
            onTitleChange={setSupportTitle}
            onBodyChange={setSupportBody}
            onSubmit={submitSignupSupport}
          />
        </div>
      </div>
    );
  }

  // ============ Step 2: 회원 확인 ============
  if (step === "confirm" && matched) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <BackBar onBack={() => setStep("lookup")} title="회원 확인" />

          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>등록 회원 확인!</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", marginTop: 8 }}>
              본인이 맞으신가요?
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
                  background: "var(--accent-soft)", overflow: "hidden",
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
                background: "var(--accent-soft)", display: matched.photo_url ? "none" : "flex", alignItems: "center",
                justifyContent: "center", color: "var(--ink-faint)",
              }}><User size={28} strokeWidth={1.8} /></div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)" }}>
                  {maskName(matched.name)} <span style={{ fontSize: 14, color: "var(--accent)", marginLeft: 6 }}>{matched.sub_role || matched.family_church}</span>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, fontSize: 12 }}>
              {matched.plain_name && (
                <>
                  <div style={infoLabel}>소속</div>
                  <div style={infoValue}>
                    {matched.plain_name}평 › {matched.grassland_name}목 › {matched.pasture_name}목장
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
                  <div style={infoValue}>{maskBirthDate(matched.birth_date)}</div>
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

          {error && <div style={{ ...errorStyle, display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleConfirmNo} style={{ ...secondaryBtnStyle, flex: 1 }}>
              아닙니다
            </button>
            <button onClick={handleConfirmYes} style={{ ...primaryBtnStyle, flex: 1 }}>
              네, 맞습니다
            </button>
          </div>

          <div style={{ marginTop: 16, fontSize: 11, color: "var(--ink-soft)", textAlign: "center", lineHeight: 1.6 }}>
            네 선택 시 등록된 정보가 자동으로 입력되며 직분 선택으로 이동합니다.<br />
            아닙니다 선택 시 처음부터 입력하실 수 있습니다.
          </div>
          <SignupSupportBox
            title={supportTitle}
            body={supportBody}
            done={supportDone}
            sending={supportSending}
            onTitleChange={setSupportTitle}
            onBodyChange={setSupportBody}
            onSubmit={submitSignupSupport}
          />
        </div>
      </div>
    );
  }

  // ============ Step 3: 직분 선택 ============
  const visibleRoles = ROLES.filter((role) =>
    ROLE_GROUPS.find((group) => group.id === roleGroup)?.roleIds.includes(role.id)
    && (roleSelectionMode === "all"
      || (roleSelectionMode === "nextgen" && NEXTGEN_ROLE_IDS.includes(role.id))
      || (roleSelectionMode === "newMember" && NEW_MEMBER_ROLE_IDS.includes(role.id)))
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
            {allowedRoleGroups.map((group) => {
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
              background: "var(--surface)",
              color: "var(--ink-faint)",
              fontSize: 11,
              fontWeight: 700,
            }}>
              {`${visibleRoles.length}개`}
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

  // ============ Step 4: 정보 입력 핸들러 ============
  const checkUsername = async () => {
    const lower = username.toLowerCase().trim();
    const v = validateUsername(lower);
    if (!v.valid) { setError(v.error!); setUsernameStatus("idle"); return; }
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
    if (!fullAddress) return setError("주소를 입력하세요");
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
          matchedMemberId: confirmedMatchedMember ? matched?.id || null : null,
          noPhone,
          birthDate,
          gender,
          address: fullAddress,
          addressBase: address.trim(),
          addressDetail: addressDetail.trim(),
          addressZonecode: addressZonecode || null,
          pastureId: pastureId || null,
          parentMemberId: matched?.parent_id || parentMatch?.parent_id || null,
          householdId: matched?.household_id || parentMatch?.household_id || null,
          guardianName: noPhone ? parentName.trim() : null,
          guardianPhone: noPhone ? normalizePhone(parentPhone) : null,
          isChild: noPhone,
          signupMethod,
          identityVerificationToken,
        }),
      });
      const result = await res.json();
      if (!res.ok) { setError(result.error || "가입 실패"); setLoading(false); return; }
      setStep("done");
    } catch (e: unknown) {
      setError(`오류: ${getErrorMessage(e)}`);
    }
    setLoading(false);
  };

  // ============ Step 4: 정보 입력 ============
  const identityLocked = signupMethod === "verified" && confirmedMatchedMember && !!matched;

  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, maxWidth: 480 }}>
        <BackBar onBack={() => setStep(isRoleLocked ? "confirm" : "role")} title="가입 정보 입력" />

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
              {isRoleLocked && (
                <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>
                  직분 변경은 관리자에게 문의해주세요
                </div>
              )}
            </div>
            {!isRoleLocked && (
              <button
                type="button"
                onClick={() => setStep("role")}
                style={{
                  padding: "6px 12px",
                  background: "var(--card)",
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
            )}
          </div>
        ) : (
          <div
            onClick={() => setStep("role")}
            style={{
              padding: "16px",
              background: "var(--danger-soft)",
              border: "2px dashed #E5B3AC",
              borderRadius: 12,
              marginBottom: 16,
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <div style={{ marginBottom: 6, color: "var(--danger)" }}><MousePointerClick size={24} strokeWidth={1.8} /></div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>
              직분을 선택해주세요 (필수)
            </div>
            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
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
              disabled={identityLocked}
              placeholder="실명" style={{ ...inputStyle, marginTop: 6, background: identityLocked ? "var(--bg-soft)" : inputStyle.background }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>전화번호 {noPhone ? "(선택)" : "*"}</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))}
              disabled={identityLocked}
              placeholder={noPhone ? "휴대폰 없으시면 비워두셔도 됩니다" : "010-0000-0000"}
              style={{ ...inputStyle, marginTop: 6, background: identityLocked ? "var(--bg-soft)" : inputStyle.background }} />
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
                placeholder="도로명 또는 지번 검색 주소"
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
            <input
              ref={addressDetailRef}
              type="text"
              value={addressDetail}
              onChange={(e) => setAddressDetail(e.target.value)}
              placeholder="상세주소 직접 입력/수정"
              style={{ ...inputStyle, marginTop: 8 }}
            />
            {addressZonecode && (
              <div style={{ marginTop: 5, fontSize: 11, color: "var(--ink-soft)" }}>
                우편번호 {addressZonecode}
              </div>
            )}
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
                  placeholder="목장 이름만 입력하세요"
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
                      background: "var(--card)",
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
                        자동 연결: {option.plain_name} / {option.grassland_name}
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
            {selectedPasture && (
              <div style={pastureSelectedStyle}>
                <span style={{ fontWeight: 800 }}>{selectedPasture.pasture_name}</span>
                <span>{selectedPasture.plain_name} / {selectedPasture.grassland_name} 자동 연결</span>
              </div>
            )}
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
            {usernameStatus === "available" && <div style={{ fontSize: 11, color: "var(--success)", marginTop: 4 }}>✓ 사용 가능</div>}
            {usernameStatus === "taken" && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>✗ 이미 사용 중</div>}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>비밀번호 *</label>
            <div style={{ position: "relative", marginTop: 6 }}>
              <input type={showPassword ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8자 이상 (문자, 숫자, 기호 조합 권장)" style={{ ...inputStyle, paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 6, display: "inline-flex", alignItems: "center", color: "var(--ink-soft)" }}>
                {showPassword ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>비밀번호 확인 *</label>
            <input type={showPassword ? "text" : "password"} value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호 다시 입력" style={{ ...inputStyle, marginTop: 6 }} />
          </div>

          <div style={{ padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 12, color: "var(--ink-mid)", lineHeight: 1.5, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={agreePrivacy}
                onChange={(e) => setAgreePrivacy(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--accent)", marginTop: 2, flexShrink: 0 }}
              />
              <span>
                <span style={{ color: "var(--danger)" }}>[필수]</span> 개인정보 수집·이용에 동의합니다{" "}
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
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 12, color: "var(--ink-mid)", lineHeight: 1.5, fontWeight: 600, marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--hairline-strong)" }}>
                <input
                  type="checkbox"
                  checked={agreeGuardian}
                  onChange={(e) => setAgreeGuardian(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "var(--accent)", marginTop: 2, flexShrink: 0 }}
                />
                <span>
                  <span style={{ color: "var(--danger)" }}>[필수]</span> 만 14세 미만 가입에 대해 법정대리인(보호자)이 동의합니다
                </span>
              </label>
            )}
          </div>

          {error && <div style={{ ...errorStyle, display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>}

          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? "가입 신청 중..." : "가입 신청"}
          </button>
        </form>

          <div style={{ fontSize: 10, color: "var(--ink-soft)", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
            가입 신청 후 관리자 승인이 필요합니다
          </div>
          <SignupSupportBox
            title={supportTitle}
            body={supportBody}
            done={supportDone}
            sending={supportSending}
            onTitleChange={setSupportTitle}
            onBodyChange={setSupportBody}
            onSubmit={submitSignupSupport}
          />
      </div>

      {addressSearchOpen && (
        <ModalBackdrop onClose={() => setAddressSearchOpen(false)} style={addressSearchBackdropStyle}>
          <div onClick={(e) => e.stopPropagation()} style={addressSearchPanelStyle}>
            <div style={addressSearchHeaderStyle}>
              <strong>주소 검색</strong>
              <button
                type="button"
                onClick={() => setAddressSearchOpen(false)}
                style={addressSearchCloseStyle}
              >
                닫기
              </button>
            </div>
            <div ref={addressSearchRef} style={addressSearchFrameStyle} />
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}

// ============ Components ============
function SignupSupportBox({
  title,
  body,
  done,
  sending,
  onTitleChange,
  onBodyChange,
  onSubmit,
}: {
  title: string;
  body: string;
  done: boolean;
  sending: boolean;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} style={supportBoxStyle}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", marginBottom: 4 }}>
        가입이 어렵거나 본인 정보가 다르게 표시되나요?
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 10 }}>
        관리자 연락처: 010-2527-2064<br />
        아래 문의는 불편사항 신고 게시판에 관리자용 비공개 글로 접수됩니다.
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="문의 제목"
        maxLength={80}
        style={{ ...inputStyle, height: 42, fontSize: 13, marginBottom: 8 }}
      />
      <textarea
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        placeholder="문의 내용을 적어주세요. 사진 첨부는 없습니다."
        rows={4}
        maxLength={2000}
        style={{ ...inputStyle, height: "auto", minHeight: 92, paddingTop: 12, resize: "vertical", fontSize: 13, lineHeight: 1.55 }}
      />
      {done && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--success)", fontWeight: 800 }}>
          문의가 접수되었습니다.
        </div>
      )}
      <button type="submit" disabled={sending} style={{ ...secondaryBtnStyle, height: 42, marginTop: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Send size={14} strokeWidth={1.9} /> {sending ? "접수 중..." : "관리자에게 문의 보내기"}
      </button>
    </form>
  );
}

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
      background: "#fafafa", border: "2px solid var(--hairline)",
      transition: "all 0.2s", boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      position: "relative", aspectRatio: "0.62",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 4,
    }}
    onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.transform = "translateY(-4px)"; }}
    onMouseOut={(e) => { e.currentTarget.style.borderColor = "var(--hairline)"; e.currentTarget.style.transform = "translateY(0)"; }}>
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
      position: "fixed", inset: 0, background: "rgba(43, 39, 34, 0.55)",
      backdropFilter: "blur(6px)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 100, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "color-mix(in srgb, var(--surface) 96%, transparent)", borderRadius: 8, padding: "24px 20px",
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
            <div style={{ fontSize: 11, color: "var(--ink-faint)", fontWeight: 600 }}>선택한 직분</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>{role.label}</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-mid)", fontWeight: 600, marginBottom: 14 }}>
          세부 직분을 선택해주세요
        </div>
        <div className="subrole-grid" style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(role.subRoles!.length, 4)}, 1fr)`, gap: 10,
        }}>
          {role.subRoles!.map((sub) => (
            <div key={sub.label} onClick={() => onSelect(sub.label)} style={{
              cursor: "pointer", borderRadius: 14, overflow: "hidden",
              background: "#fafafa", border: "2px solid var(--hairline)",
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
          background: "var(--bg-soft)", border: "none", borderRadius: 10,
          fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", cursor: "pointer", fontFamily: "inherit",
        }}>취소</button>
      </div>
    </ModalBackdrop>
  );
}

function maskName(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 1) return `${trimmed}*`;
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}*${trimmed.slice(-1)}`;
}

function maskBirthDate(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 2)}**-**-${digits.slice(6, 8)}`;
  if (digits.length >= 4) return `${digits.slice(0, 2)}**-**`;
  return "**";
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
  background: "linear-gradient(160deg, var(--bg) 0%, var(--accent-soft) 48%, var(--info-soft) 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "calc(24px + var(--safe-top)) 18px calc(24px + var(--safe-bottom))",
  fontFamily: "var(--app-sans)",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "color-mix(in srgb, var(--surface) 92%, transparent)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: 8,
  padding: "30px",
  boxShadow: "0 24px 70px rgba(43, 39, 34, 0.12)",
  border: "1px solid rgba(43, 39, 34, 0.08)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--ink)",
  letterSpacing: 0,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 54,
  padding: "0 16px",
  fontSize: 15,
  background: "color-mix(in srgb, var(--card) 86%, transparent)",
  border: "1px solid rgba(43, 39, 34, 0.14)",
  borderRadius: 8,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  color: "var(--ink)",
  fontWeight: 600,
  WebkitTextFillColor: "var(--ink)",
  caretColor: "var(--accent)",
};

const entryCardStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 92,
  padding: "16px 14px",
  border: "1px solid rgba(43, 39, 34, 0.12)",
  borderRadius: 8,
  background: "var(--card)",
  color: "var(--ink)",
  display: "flex",
  alignItems: "center",
  gap: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};

const entryIconStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 8,
  background: "var(--accent-soft)",
  color: "var(--accent)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const entryTitleStyle: React.CSSProperties = {
  display: "block",
  fontSize: 15,
  fontWeight: 900,
  color: "var(--ink)",
  marginBottom: 4,
};

const entryDescStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--ink-soft)",
  fontWeight: 600,
};

const providerRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
  marginTop: 12,
};

const providerButtonStyle: React.CSSProperties = {
  height: 36,
  border: "1px solid",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 12,
  fontWeight: 900,
  fontFamily: "inherit",
  cursor: "pointer",
};

const supportBoxStyle: React.CSSProperties = {
  marginTop: 18,
  padding: "14px",
  borderRadius: 8,
  border: "1px solid rgba(43, 39, 34, 0.1)",
  background: "color-mix(in srgb, var(--surface) 88%, transparent)",
};

const pastureSuggestStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 20,
  top: "calc(100% + 6px)",
  left: 0,
  right: 0,
  maxHeight: 280,
  overflowY: "auto",
  background: "var(--card)",
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
  background: "var(--card)",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "left",
};

const pastureSelectedStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "9px 11px",
  borderRadius: 8,
  background: "var(--accent-soft)",
  color: "var(--accent)",
  fontSize: 12,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const addressSearchBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
  background: "rgba(43, 39, 34, 0.48)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--safe-top) 4px var(--safe-bottom)",
};

const addressSearchPanelStyle: React.CSSProperties = {
  width: "min(640px, calc(100vw - 8px))",
  background: "var(--card)",
  borderRadius: 8,
  overflow: "visible",
  boxShadow: "0 22px 70px rgba(43, 39, 34, 0.3)",
};

const addressSearchHeaderStyle: React.CSSProperties = {
  height: 48,
  padding: "0 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderBottom: "1px solid var(--hairline)",
  color: "var(--ink)",
  fontSize: 14,
};

const addressSearchCloseStyle: React.CSSProperties = {
  border: "none",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12,
  fontWeight: 800,
  fontFamily: "inherit",
  cursor: "pointer",
};

const addressSearchFrameStyle: React.CSSProperties = {
  width: "100%",
  height: "min(560px, 78vh)",
  overflow: "hidden",
  boxSizing: "border-box",
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
  fontWeight: 600,
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
