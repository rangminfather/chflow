"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { formatPhone, supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { MessageCircle, PhoneCall } from "lucide-react";

type UserInfo = {
  role: string;
  status: string;
};

type DirRow = {
  plain_name: string | null;
  plain_order: number | null;
  grassland_name: string | null;
  pasture_name: string | null;
};

type DirectoryPerson = {
  id: string;
  name: string;
  phone: string | null;
  home_phone: string | null;
  gender: string | null;
  family_church: string | null;
  sub_role: string | null;
  spouse_name: string | null;
  pasture_name: string | null;
  grassland_name: string | null;
  plain_name: string | null;
  is_child: boolean | null;
  photo_url: string | null;
};

type DirectoryMember = DirectoryPerson & {
  total_count: number;
};

type ProfileMember = DirectoryPerson & {
  address: string | null;
  household_home_phone?: string | null;
};

type RelatedMember = {
  id?: string;
  relative_id?: string;
  name: string;
  phone: string | null;
  home_phone?: string | null;
  family_church?: string | null;
  sub_role?: string | null;
  spouse_name?: string | null;
  is_child?: boolean | null;
  photo_url: string | null;
  gender?: string | null;
  kind?: string;
  role?: string | null;
  pasture_name?: string | null;
  grassland_name?: string | null;
  plain_name?: string | null;
  direction?: "ancestor" | "descendant";
};

type ProfileData = {
  member: ProfileMember;
  household_members: RelatedMember[];
  relations: RelatedMember[];
  descendants: RelatedMember[];
};

type QuickEditDraft = {
  name: string;
  phone: string;
  clearPhone: boolean;
  home_phone: string;
  clearHomePhone: boolean;
  family_church: string;
  clearFamilyChurch: boolean;
  sub_role: string;
  clearSubRole: boolean;
  spouse_name: string;
  clearSpouseName: boolean;
  gender: "" | "M" | "F";
  is_child: "" | "true" | "false";
};

type QuickEditChange = {
  key: keyof Pick<ProfileMember, "name" | "phone" | "home_phone" | "family_church" | "sub_role" | "spouse_name" | "gender" | "is_child">;
  label: string;
  before: string;
  after: string;
  nextValue: string | boolean;
};

const PAGE_SIZE = 30;

const emptyQuickEditDraft: QuickEditDraft = {
  name: "",
  phone: "",
  clearPhone: false,
  home_phone: "",
  clearHomePhone: false,
  family_church: "",
  clearFamilyChurch: false,
  sub_role: "",
  clearSubRole: false,
  spouse_name: "",
  clearSpouseName: false,
  gender: "",
  is_child: "",
};

function displayText(value: string | null | boolean | undefined, fallback = "없음") {
  if (typeof value === "boolean") return value ? "예" : "아니오";
  const text = String(value ?? "").trim();
  return text || fallback;
}

function genderText(value: string | null | undefined) {
  if (value === "M") return "남";
  if (value === "F") return "여";
  return "미정";
}

function childText(value: boolean | null | undefined) {
  return value ? "자녀" : "성인";
}

function addTextChange(
  changes: QuickEditChange[],
  member: ProfileMember,
  key: QuickEditChange["key"],
  label: string,
  input: string,
  clear: boolean,
) {
  const beforeValue = String(member[key] ?? "");
  const nextValue = clear ? "" : input.trim();
  if (!clear && !nextValue) return;
  if (nextValue === beforeValue) return;
  changes.push({
    key,
    label,
    before: displayText(beforeValue),
    after: displayText(nextValue),
    nextValue,
  });
}

function buildQuickEditChanges(member: ProfileMember, draft: QuickEditDraft) {
  const changes: QuickEditChange[] = [];

  addTextChange(changes, member, "name", "이름", draft.name, false);
  addTextChange(changes, member, "phone", "휴대폰", draft.phone, draft.clearPhone);
  addTextChange(changes, member, "home_phone", "집전화", draft.home_phone, draft.clearHomePhone);
  addTextChange(changes, member, "family_church", "가정교회", draft.family_church, draft.clearFamilyChurch);
  addTextChange(changes, member, "sub_role", "직분", draft.sub_role, draft.clearSubRole);
  addTextChange(changes, member, "spouse_name", "배우자", draft.spouse_name, draft.clearSpouseName);

  if (draft.gender && draft.gender !== (member.gender || "")) {
    changes.push({
      key: "gender",
      label: "성별",
      before: genderText(member.gender),
      after: genderText(draft.gender),
      nextValue: draft.gender,
    });
  }

  if (draft.is_child) {
    const nextValue = draft.is_child === "true";
    if (nextValue !== !!member.is_child) {
      changes.push({
        key: "is_child",
        label: "자녀 여부",
        before: childText(member.is_child),
        after: childText(nextValue),
        nextValue,
      });
    }
  }

  return changes;
}

export default function DirectoryPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [dirTree, setDirTree] = useState<DirRow[]>([]);
  const [query, setQuery] = useState("");
  const [plain, setPlain] = useState("");
  const [grassland, setGrassland] = useState("");
  const [pasture, setPasture] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 모달 열려있을 때 안드로이드 뒤로가기 → 모달만 닫기 (페이지 이탈 방지)
  const isProfileModalOpen = selectedId !== null;
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isProfileModalOpen) return;
    let poppedByBack = false;
    window.history.pushState({ chflowDirectoryModal: true }, "");
    const onPop = () => {
      poppedByBack = true;
      setSelectedId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // X/배경/이동 등 다른 경로로 닫혔다면 추가된 가드 entry 제거
      if (!poppedByBack) window.history.back();
    };
  }, [isProfileModalOpen]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      const { data } = await supabase.rpc("get_my_full_info");
      const profile = data?.[0] as UserInfo | undefined;
      if (!profile || profile.status !== "active") {
        router.replace("/login?notice=pending");
        return;
      }

      setUser(profile);
      setAuthChecked(true);

      const { data: tree } = await supabase.rpc("directory_tree");
      setDirTree((tree || []) as DirRow[]);
    })();
  }, [router]);

  const plainOptions = useMemo(() => {
    const seen = new Set<string>();
    const rows: { name: string; order: number }[] = [];
    for (const row of dirTree) {
      if (row.plain_name && !seen.has(row.plain_name)) {
        seen.add(row.plain_name);
        rows.push({ name: row.plain_name, order: row.plain_order ?? 99 });
      }
    }
    return rows.sort((a, b) => a.order - b.order);
  }, [dirTree]);

  const grasslandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of dirTree) {
      if ((!plain || row.plain_name === plain) && row.grassland_name) set.add(row.grassland_name);
    }
    return Array.from(set).sort();
  }, [dirTree, plain]);

  const pastureOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of dirTree) {
      if ((!plain || row.plain_name === plain)
        && (!grassland || row.grassland_name === grassland)
        && row.pasture_name) set.add(row.pasture_name);
    }
    return Array.from(set).sort();
  }, [dirTree, plain, grassland]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isAdmin = !!user && ["admin", "office", "pastor"].includes(user.role);

  function hasSearchCriteria(
    nextQuery = query,
    nextPlain = plain,
    nextGrassland = grassland,
    nextPasture = pasture,
  ) {
    return !!(nextQuery.trim() || nextPlain || nextGrassland || nextPasture);
  }

  async function searchMembers(
    nextPage = page,
    nextQuery = query,
    nextPlain = plain,
    nextGrassland = grassland,
    nextPasture = pasture,
  ) {
    if (!hasSearchCriteria(nextQuery, nextPlain, nextGrassland, nextPasture)) {
      setMembers([]);
      setTotal(0);
      setHasSearched(false);
      alert("검색어를 입력하거나 평원/초원/목장을 선택해 주세요.");
      return;
    }

    setHasSearched(true);
    setLoading(true);
    const { data, error } = await supabase.rpc("directory_search_members", {
      p_query: nextQuery.trim() || null,
      p_plain: nextPlain || null,
      p_grassland: nextGrassland || null,
      p_pasture: nextPasture || null,
      p_offset: (nextPage - 1) * PAGE_SIZE,
      p_limit: PAGE_SIZE,
    });

    if (error) {
      alert(`성도 검색 실패: ${error.message}`);
      setMembers([]);
      setTotal(0);
    } else {
      const rows = (data || []) as DirectoryMember[];
      setMembers(rows);
      setTotal(Number(rows[0]?.total_count || 0));
    }
    setLoading(false);
  }

  function runSearch() {
    setPage(1);
    searchMembers(1, query, plain, grassland, pasture);
  }

  function resetSearch() {
    setQuery("");
    setPlain("");
    setGrassland("");
    setPasture("");
    setPage(1);
    setMembers([]);
    setTotal(0);
    setHasSearched(false);
  }

  function goPage(nextPage: number) {
    setPage(nextPage);
    searchMembers(nextPage, query, plain, grassland, pasture);
  }

  if (!authChecked) {
    return <LoadingView full />;
  }

  return (
    <div style={pageStyle}>
      <style>{`
        @media (max-width: 760px) {
          .directory-header { align-items: flex-start !important; }
          .directory-search-row { grid-template-columns: 1fr !important; }
          .directory-grid { grid-template-columns: 1fr !important; }
          .directory-actions { width: 100% !important; }
          .directory-actions button { flex: 1 !important; }
          .directory-mobile-phone-actions { display: inline-flex !important; }
        }
      `}</style>

      <header className="directory-header" style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <HeaderLogo />
          <div style={{ minWidth: 0 }}>
            <h1 style={titleStyle}>성도 요람</h1>
            <div style={subtitleStyle}>이름, 전화번호, 배우자, 목장 기준으로 성도를 조회합니다</div>
          </div>
        </div>
        <div className="directory-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isAdmin && <button style={ghostButtonStyle} onClick={() => router.push("/admin/members")}>회원관리</button>}
          <button style={ghostButtonStyle} onClick={() => router.push("/home")}>홈</button>
        </div>
      </header>

      <section style={searchPanelStyle}>
        <div className="directory-search-row" style={searchGridStyle}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && runSearch()}
            placeholder="이름, 전화번호, 배우자 검색"
            style={inputStyle}
          />
          <select
            value={plain}
            onChange={(event) => {
              const next = event.target.value;
              setPlain(next);
              setGrassland("");
              setPasture("");
            }}
            style={selectStyle}
          >
            <option value="">전체 평원</option>
            {plainOptions.map((option) => (
              <option key={option.name} value={option.name}>{plainLabel(option.name)}</option>
            ))}
          </select>
          <select
            value={grassland}
            onChange={(event) => {
              setGrassland(event.target.value);
              setPasture("");
            }}
            style={selectStyle}
          >
            <option value="">전체 초원</option>
            {grasslandOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={pasture} onChange={(event) => setPasture(event.target.value)} style={selectStyle}>
            <option value="">전체 목장</option>
            {pastureOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <button style={buttonStyle} onClick={runSearch} disabled={loading}>{loading ? "조회 중" : "검색"}</button>
          <button style={ghostButtonStyle} onClick={resetSearch} disabled={loading}>초기화</button>
        </div>
      </section>

      <main style={contentStyle}>
        <div style={resultHeadStyle}>
          <strong>검색 결과</strong>
          <span>{hasSearched ? `총 ${total.toLocaleString()}명 · ${page}/${totalPages} 페이지` : "검색 전"}</span>
        </div>

        {hasSearched && (
          <div className="directory-grid" style={gridStyle}>
            {members.map((member) => (
              <button key={member.id} style={memberCardStyle} onClick={() => setSelectedId(member.id)}>
                <Avatar member={member} size={56} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={memberNameStyle}>
                    {member.name}
                    {member.is_child && <span style={tagStyle("var(--warning-soft)", "var(--warning)")}>자녀</span>}
                  </div>
                  <div style={memberMetaStyle}>{member.sub_role || "직분 미지정"} · {member.family_church || "목원"}</div>
                  <div style={memberMetaStyle}>{member.phone || member.home_phone || "연락처 없음"}</div>
                  <div style={memberPlaceStyle}>{locationText(member)}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {!hasSearched && !loading && (
          <div style={emptyStyle}>이름, 전화번호, 배우자 검색어를 입력하거나 소속 필터를 선택해 주세요</div>
        )}

        {hasSearched && members.length === 0 && !loading && (
          <div style={emptyStyle}>검색 결과가 없습니다</div>
        )}

        {hasSearched && total > 0 && (
          <div style={pagerStyle}>
            <button style={ghostButtonStyle} disabled={page <= 1 || loading} onClick={() => goPage(page - 1)}>이전</button>
            <span>{page} / {totalPages}</span>
            <button style={ghostButtonStyle} disabled={page >= totalPages || loading} onClick={() => goPage(page + 1)}>다음</button>
          </div>
        )}
      </main>

      {selectedId && (
        <DirectoryProfileModal
          memberId={selectedId}
          isAdmin={isAdmin}
          onClose={() => setSelectedId(null)}
          onNavigate={setSelectedId}
          onChanged={() => {
            if (hasSearched) searchMembers(page, query, plain, grassland, pasture);
          }}
        />
      )}
    </div>
  );
}

function DirectoryProfileModal({
  memberId,
  isAdmin,
  onClose,
  onNavigate,
  onChanged,
}: {
  memberId: string;
  isAdmin: boolean;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const [quickEditDraft, setQuickEditDraft] = useState<QuickEditDraft>(emptyQuickEditDraft);
  const [pendingChanges, setPendingChanges] = useState<QuickEditChange[] | null>(null);
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: profile, error } = await supabase.rpc("directory_member_profile", { p_member_id: memberId });
      if (error) {
        alert(`성도 상세 조회 실패: ${error.message}`);
        onClose();
      } else {
        setData(profile as ProfileData);
      }
      setLoading(false);
    })();
  }, [memberId, onClose]);

  const reloadProfile = useCallback(async () => {
    setLoading(true);
    const { data: profile, error } = await supabase.rpc("directory_member_profile", { p_member_id: memberId });
    if (error) {
      alert(`성도 상세 조회 실패: ${error.message}`);
      onClose();
    } else {
      setData(profile as ProfileData);
    }
    setLoading(false);
  }, [memberId, onClose]);

  if (loading || !data) {
    return (
      <ModalBackdrop onClose={onClose} style={modalBgStyle}>
        <div style={modalCardStyle}>로딩 중...</div>
      </ModalBackdrop>
    );
  }

  const member = data.member;
  const relations = [...(data.relations || []), ...(data.descendants || [])];

  function openQuickEdit() {
    setQuickEditDraft(emptyQuickEditDraft);
    setPendingChanges(null);
    setQuickEditOpen(true);
  }

  function handlePreviewQuickEdit() {
    const changes = buildQuickEditChanges(member, quickEditDraft);
    if (changes.length === 0) {
      alert("변경할 값이 없습니다. 비워둔 항목은 기존 값을 유지합니다.");
      return;
    }
    setPendingChanges(changes);
  }

  async function applyQuickEdit() {
    if (!pendingChanges || pendingChanges.length === 0) return;
    const next = new Map(pendingChanges.map((change) => [change.key, change.nextValue]));

    setSavingQuickEdit(true);
    const { error } = await supabase.rpc("admin_update_member", {
      p_member_id: member.id,
      p_name: next.has("name") ? next.get("name") : null,
      p_phone: next.has("phone") ? next.get("phone") : null,
      p_family_church: next.has("family_church") ? next.get("family_church") : null,
      p_sub_role: next.has("sub_role") ? next.get("sub_role") : null,
      p_spouse_name: next.has("spouse_name") ? next.get("spouse_name") : null,
      p_gender: next.has("gender") ? next.get("gender") : null,
      p_is_child: next.has("is_child") ? next.get("is_child") : null,
      p_household_id: null,
      p_split_pasture_id: null,
      p_clear_household: false,
      p_address: null,
      p_move_member_ids: null,
      p_home_phone: next.has("home_phone") ? next.get("home_phone") : null,
    });
    setSavingQuickEdit(false);

    if (error) {
      alert(`수정 실패: ${error.message}`);
      return;
    }

    setPendingChanges(null);
    setQuickEditOpen(false);
    setQuickEditDraft(emptyQuickEditDraft);
    await reloadProfile();
    onChanged();
  }

  return (
    <ModalBackdrop onClose={onClose} style={modalBgStyle}>
      <div onClick={(event) => event.stopPropagation()} style={modalCardStyle}>
        <div style={modalHeaderStyle}>
          <strong>성도 상세</strong>
          <button style={closeButtonStyle} onClick={onClose}>×</button>
        </div>

        <div style={profileTopStyle}>
          <Avatar member={member} size={112} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={profileNameStyle}>
              {member.name}
              {member.is_child && <span style={tagStyle("var(--warning-soft)", "var(--warning)")}>자녀</span>}
            </div>
            <div style={profileMetaStyle}>{member.sub_role || "직분 미지정"} · {member.family_church || "목원"}</div>
            <InfoLine
              label="연락처"
              value={member.phone || member.home_phone || member.household_home_phone || "없음"}
              phoneActions={member.phone || undefined}
            />
            <InfoLine label="배우자" value={member.spouse_name || "없음"} />
            <InfoLine label="소속" value={locationText(member)} />
            {member.address && <InfoLine label="주소" value={member.address} />}
          </div>
        </div>

        {isAdmin && (
          <div style={adminQuickEditWrapStyle}>
            <div style={adminQuickEditHeadStyle}>
              <div>
                <strong>관리자 빠른 수정</strong>
                <div style={adminQuickEditHintStyle}>공란은 기존 값을 유지합니다. 값을 지우려면 해당 항목의 `값 지우기`를 선택하세요.</div>
              </div>
              <button style={ghostButtonStyle} onClick={openQuickEdit}>
                {quickEditOpen ? "다시 입력" : "빠른 수정"}
              </button>
            </div>

            {quickEditOpen && (
              <div style={quickEditFormStyle}>
                <QuickEditTextField
                  label="이름"
                  placeholder={member.name}
                  value={quickEditDraft.name}
                  onChange={(value) => setQuickEditDraft((draft) => ({ ...draft, name: value }))}
                />
                <QuickEditTextField
                  label="휴대폰"
                  placeholder={member.phone || "010-0000-0000"}
                  value={quickEditDraft.phone}
                  onChange={(value) => setQuickEditDraft((draft) => ({ ...draft, phone: formatPhone(value), clearPhone: false }))}
                  clearable
                  clearChecked={quickEditDraft.clearPhone}
                  onClearChange={(checked) => setQuickEditDraft((draft) => ({ ...draft, clearPhone: checked, phone: checked ? "" : draft.phone }))}
                />
                <QuickEditTextField
                  label="집전화"
                  placeholder={member.home_phone || member.household_home_phone || "02-0000-0000"}
                  value={quickEditDraft.home_phone}
                  onChange={(value) => setQuickEditDraft((draft) => ({ ...draft, home_phone: formatPhone(value), clearHomePhone: false }))}
                  clearable
                  clearChecked={quickEditDraft.clearHomePhone}
                  onClearChange={(checked) => setQuickEditDraft((draft) => ({ ...draft, clearHomePhone: checked, home_phone: checked ? "" : draft.home_phone }))}
                />
                <QuickEditTextField
                  label="가정교회"
                  placeholder={member.family_church || "목자/목녀/목원"}
                  value={quickEditDraft.family_church}
                  onChange={(value) => setQuickEditDraft((draft) => ({ ...draft, family_church: value, clearFamilyChurch: false }))}
                  clearable
                  clearChecked={quickEditDraft.clearFamilyChurch}
                  onClearChange={(checked) => setQuickEditDraft((draft) => ({ ...draft, clearFamilyChurch: checked, family_church: checked ? "" : draft.family_church }))}
                />
                <QuickEditTextField
                  label="직분"
                  placeholder={member.sub_role || "직분"}
                  value={quickEditDraft.sub_role}
                  onChange={(value) => setQuickEditDraft((draft) => ({ ...draft, sub_role: value, clearSubRole: false }))}
                  clearable
                  clearChecked={quickEditDraft.clearSubRole}
                  onClearChange={(checked) => setQuickEditDraft((draft) => ({ ...draft, clearSubRole: checked, sub_role: checked ? "" : draft.sub_role }))}
                />
                <QuickEditTextField
                  label="배우자"
                  placeholder={member.spouse_name || "배우자 이름"}
                  value={quickEditDraft.spouse_name}
                  onChange={(value) => setQuickEditDraft((draft) => ({ ...draft, spouse_name: value, clearSpouseName: false }))}
                  clearable
                  clearChecked={quickEditDraft.clearSpouseName}
                  onClearChange={(checked) => setQuickEditDraft((draft) => ({ ...draft, clearSpouseName: checked, spouse_name: checked ? "" : draft.spouse_name }))}
                />
                <label style={quickEditFieldStyle}>
                  <span style={quickEditLabelStyle}>성별</span>
                  <select
                    value={quickEditDraft.gender}
                    onChange={(event) => setQuickEditDraft((draft) => ({ ...draft, gender: event.target.value as QuickEditDraft["gender"] }))}
                    style={quickEditInputStyle}
                  >
                    <option value="">동일</option>
                    <option value="M">남</option>
                    <option value="F">여</option>
                  </select>
                </label>
                <label style={quickEditFieldStyle}>
                  <span style={quickEditLabelStyle}>자녀 여부</span>
                  <select
                    value={quickEditDraft.is_child}
                    onChange={(event) => setQuickEditDraft((draft) => ({ ...draft, is_child: event.target.value as QuickEditDraft["is_child"] }))}
                    style={quickEditInputStyle}
                  >
                    <option value="">동일</option>
                    <option value="true">자녀</option>
                    <option value="false">성인</option>
                  </select>
                </label>
                <div style={quickEditReadOnlyStyle}>
                  주소는 현재 빠른 수정에서 읽기 전용입니다: {member.address || "없음"}
                </div>
                <div style={quickEditActionsStyle}>
                  <button style={ghostButtonStyle} onClick={() => { setQuickEditOpen(false); setPendingChanges(null); setQuickEditDraft(emptyQuickEditDraft); }}>
                    취소
                  </button>
                  <button style={buttonStyle} onClick={handlePreviewQuickEdit}>
                    변경하기
                  </button>
                </div>
              </div>
            )}
          <button
            style={{ ...ghostButtonStyle, width: "100%" }}
            onClick={() => {
              const params = new URLSearchParams({ q: member.name });
              if (member.plain_name) params.set("plain", member.plain_name);
              if (member.grassland_name) params.set("grassland", member.grassland_name);
              if (member.pasture_name) params.set("pasture", member.pasture_name);
              router.push(`/admin/members?${params.toString()}`);
              onClose();
            }}
          >
            관리자 수정 화면으로 이동
          </button>
          </div>
        )}

        <ProfileSection title={`같은 가족 ${data.household_members?.length || 0}`}>
          {(data.household_members || []).length > 0 ? (
            <div style={chipGridStyle}>
              {data.household_members.map((item) => (
                <RelatedChip key={item.id || item.name} item={item} onClick={() => item.id && onNavigate(item.id)} />
              ))}
            </div>
          ) : (
            <div style={sectionEmptyStyle}>등록된 같은 가족이 없습니다</div>
          )}
        </ProfileSection>

        <ProfileSection title={`가족 관계 ${relations.length}`}>
          {relations.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {relations.map((item, index) => (
                <RelatedRow
                  key={`${item.relative_id}-${index}`}
                  item={item}
                  onClick={() => item.relative_id && onNavigate(item.relative_id)}
                />
              ))}
            </div>
          ) : (
            <div style={sectionEmptyStyle}>등록된 부모·자녀 관계가 없습니다</div>
          )}
        </ProfileSection>

        {pendingChanges && (
          <div style={quickEditConfirmOverlayStyle} onClick={() => !savingQuickEdit && setPendingChanges(null)}>
            <div style={quickEditConfirmCardStyle} onClick={(event) => event.stopPropagation()}>
              <div style={modalHeaderStyle}>
                <strong>변경 내용 확인</strong>
                <button style={closeButtonStyle} onClick={() => !savingQuickEdit && setPendingChanges(null)}>×</button>
              </div>
              <div style={quickEditCompareGridStyle}>
                <MiniProfileCard title="기존 카드" member={member} />
                <MiniProfileCard title="변경될 카드" member={previewMember(member, pendingChanges)} changedKeys={pendingChanges.map((change) => change.key)} />
              </div>
              <div style={quickEditChangeListStyle}>
                {pendingChanges.map((change) => (
                  <div key={change.key} style={quickEditChangeRowStyle}>
                    <strong>{change.label}</strong>
                    <span>{change.before}</span>
                    <span>→</span>
                    <span>{change.after}</span>
                  </div>
                ))}
              </div>
              <div style={quickEditActionsStyle}>
                <button style={ghostButtonStyle} onClick={() => setPendingChanges(null)} disabled={savingQuickEdit}>
                  취소하고 다시 수정
                </button>
                <button style={buttonStyle} onClick={applyQuickEdit} disabled={savingQuickEdit}>
                  {savingQuickEdit ? "적용 중..." : "이대로 적용"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

function Avatar({ member, size }: { member: { name: string; photo_url: string | null; gender?: string | null }; size: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: 8,
      overflow: "hidden",
      background: "var(--hairline)",
      flexShrink: 0,
      display: "grid",
      placeItems: "center",
      color: "var(--ink-soft)",
      fontSize: Math.max(14, Math.floor(size / 3)),
      fontWeight: 800,
    }}>
      {member.photo_url ? (
        <img src={member.photo_url} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span>{member.name.slice(0, 1)}</span>
      )}
    </div>
  );
}

function InfoLine({ label, value, phoneActions }: { label: string; value: string; phoneActions?: string }) {
  const actionPhone = normalizeDialNumber(phoneActions);
  return (
    <div style={infoLineStyle}>
      <span>{label}</span>
      <strong style={infoValueStyle}>
        <span style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "keep-all" }}>{value}</span>
        {actionPhone && (
          <span className="directory-mobile-phone-actions" style={mobilePhoneActionsStyle}>
            <a href={`tel:${actionPhone}`} aria-label="전화걸기" title="전화걸기" style={mobilePhoneActionStyle}>
              <PhoneCall size={15} strokeWidth={1.9} />
            </a>
            <a href={`sms:${actionPhone}`} aria-label="메시지 보내기" title="메시지 보내기" style={mobilePhoneActionStyle}>
              <MessageCircle size={15} strokeWidth={1.9} />
            </a>
          </span>
        )}
      </strong>
    </div>
  );
}

function normalizeDialNumber(value?: string | null) {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : "";
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={profileSectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </section>
  );
}

function QuickEditTextField({
  label,
  placeholder,
  value,
  onChange,
  clearable = false,
  clearChecked = false,
  onClearChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  clearable?: boolean;
  clearChecked?: boolean;
  onClearChange?: (checked: boolean) => void;
}) {
  return (
    <label style={quickEditFieldStyle}>
      <span style={quickEditLabelStyle}>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={clearChecked}
        style={quickEditInputStyle}
      />
      {clearable && (
        <span style={quickEditClearStyle}>
          <input
            type="checkbox"
            checked={clearChecked}
            onChange={(event) => onClearChange?.(event.target.checked)}
          />
          값 지우기
        </span>
      )}
    </label>
  );
}

function previewMember(member: ProfileMember, changes: QuickEditChange[]): ProfileMember {
  const next = { ...member };
  for (const change of changes) {
    (next as Record<string, unknown>)[change.key] = change.nextValue;
  }
  return next;
}

function MiniProfileCard({
  title,
  member,
  changedKeys = [],
}: {
  title: string;
  member: ProfileMember;
  changedKeys?: QuickEditChange["key"][];
}) {
  const changed = new Set(changedKeys);
  const valueStyle = (key: QuickEditChange["key"]): CSSProperties => ({
    ...miniProfileValueStyle,
    ...(changed.has(key) ? miniProfileChangedValueStyle : null),
  });

  return (
    <div style={miniProfileCardStyle}>
      <div style={miniProfileTitleStyle}>{title}</div>
      <div style={miniProfileNameStyle}>{member.name}</div>
      <div style={valueStyle("phone")}>휴대폰: {displayText(member.phone)}</div>
      <div style={valueStyle("home_phone")}>집전화: {displayText(member.home_phone || member.household_home_phone)}</div>
      <div style={valueStyle("family_church")}>가정교회: {displayText(member.family_church)}</div>
      <div style={valueStyle("sub_role")}>직분: {displayText(member.sub_role)}</div>
      <div style={valueStyle("spouse_name")}>배우자: {displayText(member.spouse_name)}</div>
      <div style={valueStyle("gender")}>성별: {genderText(member.gender)}</div>
      <div style={valueStyle("is_child")}>구분: {childText(member.is_child)}</div>
    </div>
  );
}

function RelatedChip({ item, onClick }: { item: RelatedMember; onClick: () => void }) {
  return (
    <button style={chipStyle} onClick={onClick}>
      <Avatar member={{ name: item.name, photo_url: item.photo_url, gender: item.gender }} size={34} />
      <span style={{ minWidth: 0 }}>
        <strong style={chipNameStyle}>{item.name}</strong>
        <span style={chipSubStyle}>{item.is_child ? "자녀" : item.sub_role || item.family_church || "가족"}</span>
      </span>
    </button>
  );
}

function RelatedRow({ item, onClick }: { item: RelatedMember; onClick: () => void }) {
  return (
    <button style={relationRowStyle} onClick={onClick}>
      <Avatar member={{ name: item.name, photo_url: item.photo_url }} size={40} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={relationNameStyle}>{item.name}</strong>
        <span style={relationSubStyle}>{relationLabel(item)} · {item.phone || item.home_phone || "연락처 없음"}</span>
      </span>
    </button>
  );
}

function relationLabel(item: RelatedMember) {
  if (item.kind === "parent") return item.direction === "descendant" ? "자녀" : roleLabel(item.role) || "부모";
  if (item.kind === "grandparent") return item.direction === "descendant" ? "손주" : "조부모";
  if (item.kind === "great_grandparent") return item.direction === "descendant" ? "증손주" : "증조부모";
  if (item.kind === "spouse") return "배우자";
  return "관계";
}

function roleLabel(role?: string | null) {
  if (role === "father") return "아버지";
  if (role === "mother") return "어머니";
  if (role === "husband") return "남편";
  if (role === "wife") return "아내";
  return "";
}

function plainLabel(name: string) {
  if (name === "미정") return name;
  return name.endsWith("평원") ? name : `${name}평원`;
}

function locationText(member: { plain_name?: string | null; grassland_name?: string | null; pasture_name?: string | null }) {
  const parts = [
    member.plain_name ? plainLabel(member.plain_name) : "",
    member.grassland_name ? `${member.grassland_name}초원` : "",
    member.pasture_name ? `${member.pasture_name}목장` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "소속 없음";
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--surface)",
  color: "var(--ink)",
  fontFamily: "'Noto Sans KR', system-ui, sans-serif",
  padding: 16,
};


const headerStyle: CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto 14px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const titleStyle: CSSProperties = { margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: 0 };
const subtitleStyle: CSSProperties = { marginTop: 3, fontSize: 12, color: "var(--ink-soft)" };

const searchPanelStyle: CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto 14px",
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: 12,
};

const searchGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 1fr) 130px 130px 130px auto auto",
  gap: 8,
};

const inputStyle: CSSProperties = {
  height: 40,
  border: "1px solid var(--hairline-strong)",
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 14,
  fontFamily: "inherit",
  background: "var(--card)",
  minWidth: 0,
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  padding: "0 10px",
};

const buttonStyle: CSSProperties = {
  minHeight: 40,
  border: 0,
  borderRadius: 8,
  padding: "0 14px",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 800,
  fontFamily: "inherit",
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  minHeight: 40,
  border: "1px solid var(--hairline-strong)",
  borderRadius: 8,
  padding: "0 14px",
  background: "var(--card)",
  color: "var(--ink-mid)",
  fontSize: 13,
  fontWeight: 800,
  fontFamily: "inherit",
  cursor: "pointer",
};

const contentStyle: CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  overflow: "hidden",
};

const resultHeadStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 14px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 13,
  color: "var(--ink-mid)",
  flexWrap: "wrap",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: 10,
  padding: 12,
};

const memberCardStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  width: "100%",
  minHeight: 94,
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  background: "var(--card)",
  padding: 10,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

const memberNameStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 800, color: "var(--ink)" };
const memberMetaStyle: CSSProperties = { marginTop: 3, fontSize: 12, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const memberPlaceStyle: CSSProperties = { marginTop: 3, fontSize: 11, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const emptyStyle: CSSProperties = { padding: 40, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 };

const pagerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: 12,
  borderTop: "1px solid var(--hairline)",
  fontSize: 13,
  color: "var(--ink-mid)",
};

const modalBgStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  height: "100dvh",
  background: "rgba(43, 39, 34,0.58)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 100,
};

const modalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 620,
  maxHeight: "90dvh",
  overflowY: "auto",
  background: "var(--card)",
  borderRadius: 8,
  boxShadow: "0 20px 60px rgba(43, 39, 34,0.25)",
  padding: 18,
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 16,
  fontSize: 15,
};

const closeButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: 0,
  borderRadius: 8,
  background: "var(--bg-soft)",
  color: "var(--ink-mid)",
  fontSize: 22,
  cursor: "pointer",
};

const profileTopStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "flex-start",
  marginBottom: 16,
};

const profileNameStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 24, fontWeight: 800, color: "var(--ink)" };
const profileMetaStyle: CSSProperties = { marginTop: 3, marginBottom: 10, fontSize: 13, color: "var(--ink-soft)" };

const infoLineStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "58px minmax(0, 1fr)",
  gap: 8,
  marginTop: 5,
  fontSize: 12,
  color: "var(--ink-soft)",
};

const infoValueStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 7,
  minWidth: 0,
  color: "var(--ink)",
};

const mobilePhoneActionsStyle: CSSProperties = {
  display: "none",
  alignItems: "center",
  gap: 5,
  flexShrink: 0,
};

const mobilePhoneActionStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--accent-soft)",
  color: "var(--accent-strong)",
  textDecoration: "none",
  border: "1px solid var(--hairline)",
};

const profileSectionStyle: CSSProperties = {
  borderTop: "1px solid var(--hairline)",
  paddingTop: 14,
  marginTop: 14,
};

const sectionTitleStyle: CSSProperties = { marginBottom: 10, fontSize: 13, fontWeight: 800, color: "var(--ink-mid)" };
const sectionEmptyStyle: CSSProperties = { padding: "10px 0", color: "var(--ink-faint)", fontSize: 12 };

const adminQuickEditWrapStyle: CSSProperties = {
  border: "1px solid var(--accent-soft)",
  borderRadius: 8,
  background: "var(--surface)",
  padding: 12,
  marginBottom: 14,
};

const adminQuickEditHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 10,
};

const adminQuickEditHintStyle: CSSProperties = {
  marginTop: 3,
  fontSize: 11,
  lineHeight: 1.4,
  color: "var(--ink-soft)",
};

const quickEditFormStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
  padding: "10px 0 12px",
};

const quickEditFieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  minWidth: 0,
};

const quickEditLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: "var(--ink-mid)",
};

const quickEditInputStyle: CSSProperties = {
  height: 38,
  border: "1px solid var(--hairline-strong)",
  borderRadius: 8,
  padding: "0 10px",
  fontSize: 13,
  fontFamily: "inherit",
  color: "var(--ink)",
  background: "var(--card)",
  minWidth: 0,
};

const quickEditClearStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  color: "var(--ink-soft)",
};

const quickEditReadOnlyStyle: CSSProperties = {
  gridColumn: "1 / -1",
  border: "1px dashed var(--hairline-strong)",
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
  color: "var(--ink-soft)",
  background: "var(--card)",
};

const quickEditActionsStyle: CSSProperties = {
  gridColumn: "1 / -1",
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  flexWrap: "wrap",
};

const quickEditConfirmOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  height: "100dvh",
  zIndex: 120,
  background: "rgba(43, 39, 34, 0.62)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const quickEditConfirmCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 760,
  maxHeight: "90dvh",
  overflowY: "auto",
  borderRadius: 8,
  background: "var(--card)",
  padding: 16,
  boxShadow: "0 20px 60px rgba(43, 39, 34,0.28)",
};

const quickEditCompareGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
  marginBottom: 12,
};

const miniProfileCardStyle: CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: 12,
  background: "var(--surface)",
};

const miniProfileTitleStyle: CSSProperties = {
  marginBottom: 8,
  fontSize: 12,
  fontWeight: 800,
  color: "var(--accent)",
};

const miniProfileNameStyle: CSSProperties = {
  marginBottom: 8,
  fontSize: 18,
  fontWeight: 800,
  color: "var(--ink)",
};

const miniProfileValueStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "var(--ink-mid)",
};

const miniProfileChangedValueStyle: CSSProperties = {
  color: "var(--accent-strong)",
  fontWeight: 800,
  background: "var(--accent-soft)",
  borderRadius: 6,
  padding: "3px 6px",
};

const quickEditChangeListStyle: CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  overflow: "hidden",
  marginBottom: 12,
};

const quickEditChangeRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "90px minmax(0, 1fr) 24px minmax(0, 1fr)",
  gap: 8,
  padding: "9px 10px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 12,
  alignItems: "center",
};

const chipGridStyle: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const chipStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  background: "var(--card)",
  padding: 6,
  minWidth: 130,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};
const chipNameStyle: CSSProperties = { display: "block", fontSize: 12, color: "var(--ink)" };
const chipSubStyle: CSSProperties = { display: "block", fontSize: 10, color: "var(--ink-soft)" };

const relationRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  background: "var(--card)",
  padding: 8,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

const relationNameStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--ink)" };
const relationSubStyle: CSSProperties = { display: "block", marginTop: 2, fontSize: 11, color: "var(--ink-soft)" };

function tagStyle(bg: string, color: string): CSSProperties {
  return {
    padding: "2px 6px",
    borderRadius: 6,
    background: bg,
    color,
    fontSize: 10,
    fontWeight: 800,
  };
}
