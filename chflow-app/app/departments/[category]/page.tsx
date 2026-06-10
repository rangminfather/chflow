"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DeptIcon from "@/components/DeptIcon";
import HeaderLogo from "@/components/HeaderLogo";
import { T, PageShell, PageContent } from "@/components/Layout";
import { LoadingView } from "@/components/StatusViews";
import { User, Users, ChevronLeft, Search, CheckCircle2, Sparkles } from "lucide-react";

interface Department {
  id: string;
  category: string;
  name: string;
  description: string | null;
  icon: string | null;
  order_no: number;
  member_count: number;
  my_status: string | null;
}

interface ChildRow {
  id: string;
  student_no: number | null;
  name: string;
  grade: string | null;
  teacher_name: string | null;
}

const ROLE_SLOTS: { roles: string[]; key: string }[] = [
  { roles: ["leader", "교육사"], key: "대표" },
  { roles: ["부장"],             key: "부장" },
  { roles: ["총무"],             key: "총무" },
  { roles: ["teacher"],          key: "담임" },
];

interface SlotPhoto { photoUrl: string | null; name: string | null }
type DeptKeyMembers = Record<string, Record<string, SlotPhoto | null>>;
type ModalStep = "role" | "child" | "confirm";

function ChildItem({
  child,
  checked,
  onToggle,
  isAutoMatch,
}: {
  child: ChildRow;
  checked: boolean;
  onToggle: () => void;
  isAutoMatch?: boolean;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "11px 12px", marginBottom: 6, borderRadius: 10, cursor: "pointer",
        background: checked
          ? "color-mix(in srgb, var(--accent) 10%, transparent)"
          : "var(--bg-page)",
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--hairline)"}`,
        transition: "all 0.12s",
      }}
    >
      <div style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
        border: `2px solid ${checked ? "var(--accent)" : "var(--hairline-strong)"}`,
        background: checked ? "var(--accent)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {checked && <CheckCircle2 size={13} strokeWidth={2.5} style={{ color: "#fff" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {child.grade && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
              background: "var(--accent-soft)", color: "var(--accent-strong)", whiteSpace: "nowrap",
            }}>{child.grade}반</span>
          )}
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{child.name}</span>
          {child.student_no != null && (
            <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>{child.student_no}번</span>
          )}
          {isAutoMatch && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
              background: "var(--success-soft)", color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 2,
            }}>
              <Sparkles size={8} strokeWidth={2} /> 자동매칭
            </span>
          )}
        </div>
        {child.teacher_name && (
          <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>
            {child.teacher_name} 선생님 담임
          </div>
        )}
      </div>
    </div>
  );
}

export default function CategoryPage() {
  const router = useRouter();
  const params = useParams();
  const category = decodeURIComponent(params.category as string);

  const [authChecked, setAuthChecked] = useState(false);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDept, setConfirmDept] = useState<Department | null>(null);
  const [selectedRole, setSelectedRole] = useState<"teacher" | "학부모" | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [keyMembers, setKeyMembers] = useState<DeptKeyMembers>({});

  // 다단계 모달 상태
  const [modalStep, setModalStep] = useState<ModalStep>("role");
  const [childrenLoading, setChildrenLoading] = useState(false);
  const [autoMatched, setAutoMatched] = useState<ChildRow[]>([]);
  const [selectedChildren, setSelectedChildren] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChildRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadKeyMembers = useCallback(async (deptIds: string[]) => {
    if (!deptIds.length) return;
    const allRoles = ROLE_SLOTS.flatMap(s => s.roles);
    const { data: members } = await supabase
      .from("department_members")
      .select("department_id, member_role, grade, user_id")
      .in("department_id", deptIds)
      .eq("status", "approved")
      .in("member_role", allRoles)
      .order("grade", { ascending: true });
    if (!members?.length) return;
    const userIds = [...new Set(members.map(m => m.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, name, avatar_url, photo_url")
      .in("user_id", userIds);
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));
    const result: DeptKeyMembers = {};
    for (const m of members) {
      const slotDef = ROLE_SLOTS.find(s => s.roles.includes(m.member_role));
      if (!slotDef) continue;
      if (!result[m.department_id]) result[m.department_id] = { 대표: null, 부장: null, 총무: null, 담임: null };
      if (result[m.department_id][slotDef.key]) continue;
      const p = profileMap[m.user_id];
      result[m.department_id][slotDef.key] = { photoUrl: p?.avatar_url || p?.photo_url || null, name: p?.name ?? null };
    }
    setKeyMembers(result);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_departments_by_category", { p_category: category });
    if (!error && data) {
      setDepts(data);
      loadKeyMembers(data.map((d: Department) => d.id));
    }
    setLoading(false);
  }, [category, loadKeyMembers]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      load();
    })();
  }, [load, router]);

  const openModal = (dept: Department) => {
    setConfirmDept(dept);
    setModalStep("role");
    setSelectedRole(null);
    setSelectedChildren(new Set());
    setAutoMatched([]);
    setSearchQuery("");
    setSearchResults([]);
    setHasSearched(false);
  };

  const closeModal = () => { if (requesting) return; setConfirmDept(null); };

  const handleRoleClick = async (role: "teacher" | "학부모") => {
    setSelectedRole(role);
    if (role === "학부모") {
      setModalStep("child");
      setChildrenLoading(true);
      const { data } = await supabase.rpc("dept_match_children_for_parent", { p_dept_id: confirmDept!.id });
      const matched: ChildRow[] = data || [];
      setAutoMatched(matched);
      if (matched.length > 0) {
        setSelectedChildren(new Set(matched.map(c => c.id)));
      }
      setChildrenLoading(false);
      setTimeout(() => searchRef.current?.focus(), 120);
    } else {
      setModalStep("confirm");
    }
  };

  const doSearch = useCallback(async (query: string, deptId: string, autoMatchedIds: Set<string>) => {
    setSearching(true);
    const { data } = await supabase.rpc("dept_search_children", {
      p_dept_id: deptId,
      p_query: query,
    });
    setSearchResults((data || []).filter((c: ChildRow) => !autoMatchedIds.has(c.id)));
    setHasSearched(true);
    setSearching(false);
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    const autoMatchedIds = new Set(autoMatched.map(c => c.id));
    searchTimeout.current = setTimeout(() => {
      doSearch(value.trim(), confirmDept!.id, autoMatchedIds);
    }, 300);
  };

  const toggleChild = (id: string) => {
    setSelectedChildren(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBack = () => {
    if (modalStep === "child") { setModalStep("role"); setSelectedRole(null); setSelectedChildren(new Set()); }
    if (modalStep === "confirm") {
      if (selectedRole === "학부모") setModalStep("child");
      else { setModalStep("role"); setSelectedRole(null); }
    }
  };

  const handleRequest = async () => {
    if (!confirmDept || !selectedRole) return;
    if (selectedRole === "학부모" && selectedChildren.size === 0) return;
    setRequesting(true);
    const { error } = await supabase.rpc("request_department_join", {
      p_dept_id: confirmDept.id,
      p_role: selectedRole,
      p_child_student_ids: selectedRole === "학부모" ? Array.from(selectedChildren) : null,
    });
    setRequesting(false);
    if (error) { alert(`신청 실패: ${error.message}`); return; }
    setConfirmDept(null);
    alert("가입 신청이 완료되었습니다!\n담당 임원진 승인 후 이용하실 수 있습니다.");
    load();
  };

  const autoMatchedIds = new Set(autoMatched.map(c => c.id));
  const selectedChildRows = [
    ...autoMatched.filter(c => selectedChildren.has(c.id)),
    ...searchResults.filter(c => selectedChildren.has(c.id) && !autoMatchedIds.has(c.id)),
  ];

  const statusBadge = (status: string | null) => {
    if (status === "approved") return { label: "✓ 가입됨",  bg: "var(--success-soft)", color: "var(--success)" };
    if (status === "pending")  return { label: "승인 대기", bg: "var(--warning-soft)", color: "var(--warning)" };
    if (status === "rejected") return { label: "거절됨",    bg: "var(--danger-soft)",  color: "var(--danger)" };
    return null;
  };

  if (!authChecked) {
    return <PageShell style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><LoadingView /></PageShell>;
  }

  return (
    <PageShell>
      <div style={{
        background: T.bgCard, borderBottom: `1px solid ${T.border}`,
        padding: "10px clamp(12px, 4vw, 20px)",
        display: "flex", alignItems: "center", gap: 10,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <HeaderLogo />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{category}</div>
          <div style={{ fontSize: 10, color: T.textMuted }}>가입할 부서를 선택하세요</div>
        </div>
        <button onClick={() => router.push("/departments")} style={{
          padding: "7px 14px", background: T.bgPage, border: `1px solid ${T.border}`,
          borderRadius: 8, fontSize: 12, color: T.textMuted, cursor: "pointer",
          fontFamily: "inherit", whiteSpace: "nowrap",
        }}>← 뒤로</button>
      </div>

      <PageContent maxWidth={860}>
        {loading ? (
          <LoadingView padding={40} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 280px))", gap: 12 }}>
            {depts.map((d) => {
              const badge = statusBadge(d.my_status);
              const disabled = d.my_status === "approved" || d.my_status === "pending";
              const borderColor = d.my_status === "approved" ? "#4ade80" : d.my_status === "pending" ? "#E0C893" : T.border;
              const slots = keyMembers[d.id] ?? null;
              return (
                <div
                  key={d.id}
                  onClick={() => {
                    if (d.my_status === "approved") { router.push(`/departments/d/${d.id}`); return; }
                    if (!disabled) openModal(d);
                  }}
                  style={{
                    background: T.bgCard, border: `1.5px solid ${borderColor}`, borderRadius: 16,
                    padding: "18px 16px 14px", cursor: disabled && d.my_status !== "approved" ? "default" : "pointer",
                    position: "relative", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                    transition: "box-shadow 0.15s, transform 0.15s",
                    display: "flex", flexDirection: "column", gap: 10,
                  }}
                  onMouseOver={(e) => { if (disabled) return; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.1)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseOut={(e) => { if (disabled) return; e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"; e.currentTarget.style.transform = "translateY(0)"; }}
                >
                  {badge && (
                    <div style={{ position: "absolute", top: 12, right: 12, padding: "3px 10px", background: badge.bg, color: badge.color, borderRadius: 6, fontSize: 10, fontWeight: 700 }}>{badge.label}</div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: T.ministryBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <DeptIcon name={d.name} category={d.category} size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: T.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{d.name}</div>
                      {d.description && <div style={{ fontSize: 11, color: T.textMuted, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{d.description}</div>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {ROLE_SLOTS.map(({ key }) => {
                      const person = slots?.[key] ?? null;
                      return person?.photoUrl ? (
                        <img key={key} src={person.photoUrl} alt={person.name || ""} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", objectPosition: "top center", border: `1.5px solid ${T.border}` }} />
                      ) : (
                        <div key={key} style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--hairline)", display: "flex", alignItems: "center", justifyContent: "center", border: `1.5px solid ${T.border}` }}>
                          <User size={16} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: T.ministryPoint, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Users size={13} strokeWidth={1.8} /> {d.member_count}명 활동 중
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageContent>

      {/* ── 가입 모달 ── */}
      {confirmDept && (
        <div onClick={closeModal} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.bgCard, borderRadius: 20,
            maxWidth: modalStep === "child" ? 480 : 420, width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            fontFamily: "'Noto Sans KR', sans-serif",
            overflow: "hidden", maxHeight: "90vh",
            display: "flex", flexDirection: "column",
            position: "relative",
          }}>

            {/* 부서 헤더 */}
            <div style={{ padding: "24px 24px 16px", textAlign: "center", flexShrink: 0, position: "relative" }}>
              {modalStep !== "role" && (
                <button onClick={handleBack} disabled={requesting} style={{
                  position: "absolute", left: 12, top: 22,
                  background: "none", border: "none", cursor: "pointer",
                  color: T.textMuted, display: "flex", alignItems: "center", gap: 3, fontSize: 12, padding: "4px 8px",
                }}>
                  <ChevronLeft size={15} strokeWidth={2} /> 이전
                </button>
              )}
              <div style={{ width: 52, height: 52, borderRadius: 14, background: T.ministryBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                <DeptIcon name={confirmDept.name} category={confirmDept.category} size={26} />
              </div>
              <div style={{ fontSize: 11, color: T.ministryPoint, fontWeight: 700 }}>{confirmDept.category}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginTop: 2 }}>{confirmDept.name}</div>
            </div>

            {/* ── Step 1: 역할 카드 ── */}
            {modalStep === "role" && (
              <div style={{ padding: "0 24px 28px" }}>
                <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", marginBottom: 16, fontWeight: 600 }}>
                  본인 역할을 선택해 주세요
                </div>
                <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
                  {([
                    { role: "학부모" as const, img: "/dept-roles/parent.png" },
                    { role: "teacher" as const, img: "/dept-roles/teacher.png" },
                  ] as const).map(({ role, img }) => (
                    <button
                      key={role}
                      onClick={() => handleRoleClick(role)}
                      style={{
                        flex: 1, maxWidth: 165,
                        background: "none", border: "2.5px solid transparent",
                        borderRadius: 16, cursor: "pointer", padding: 0,
                        overflow: "hidden", transition: "all 0.18s",
                        boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
                      }}
                      onMouseOver={e => {
                        e.currentTarget.style.borderColor = T.ministryPoint;
                        e.currentTarget.style.transform = "translateY(-4px)";
                        e.currentTarget.style.boxShadow = "0 10px 28px rgba(62,90,74,0.2)";
                      }}
                      onMouseOut={e => {
                        e.currentTarget.style.borderColor = "transparent";
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.08)";
                      }}
                    >
                      <img src={img} alt={role === "teacher" ? "교사" : "학부모"} style={{ width: "100%", height: "auto", display: "block" }} />
                    </button>
                  ))}
                </div>
                <div style={{ textAlign: "center", fontSize: 11, color: T.textMuted, marginTop: 16, lineHeight: 1.5 }}>
                  신청 후 부서 임원진 승인이 필요합니다
                </div>
              </div>
            )}

            {/* ── Step 2: 자녀 선택 (학부모 전용) ── */}
            {modalStep === "child" && (
              <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
                <div style={{ padding: "0 20px 12px", flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12, textAlign: "center" }}>
                    자녀를 선택해 주세요
                    <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 6, fontWeight: 500 }}>(복수 선택 가능)</span>
                  </div>

                  {/* 검색창 */}
                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.textMuted, pointerEvents: "none" }} />
                    <input
                      ref={searchRef}
                      value={searchQuery}
                      onChange={e => handleSearchInput(e.target.value)}
                      placeholder="자녀 이름으로 검색 (2자 이상)"
                      style={{
                        width: "100%", padding: "9px 10px 9px 30px",
                        border: `1px solid ${T.border}`, borderRadius: 8,
                        fontSize: 13, fontFamily: "inherit", background: T.bgPage,
                        color: T.text, outline: "none", boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
                  {childrenLoading ? (
                    <LoadingView padding={24} />
                  ) : (
                    <>
                      {/* 자동 매칭 섹션 */}
                      {autoMatched.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--success)", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                            <Sparkles size={12} strokeWidth={2} /> DB 정보로 자동 매칭된 자녀
                          </div>
                          {autoMatched.map(child => (
                            <ChildItem key={child.id} child={child} checked={selectedChildren.has(child.id)} onToggle={() => toggleChild(child.id)} isAutoMatch />
                          ))}
                        </div>
                      )}

                      {/* 검색 안내 / 결과 */}
                      <div>
                        {autoMatched.length > 0 && (
                          <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, marginBottom: 8 }}>
                            추가 자녀 검색
                          </div>
                        )}

                        {searching && <LoadingView padding={16} />}

                        {!searching && !hasSearched && searchQuery.trim().length < 2 && (
                          <div style={{
                            textAlign: "center", padding: "16px 0",
                            color: T.textMuted, fontSize: 12, lineHeight: 1.7,
                          }}>
                            {autoMatched.length === 0
                              ? <>자녀 이름을 입력해 주세요<br /><span style={{ fontSize: 10 }}>2자 이상 입력하면 검색됩니다</span></>
                              : <span style={{ fontSize: 11 }}>다른 자녀가 있다면 이름으로 검색해 추가하세요</span>
                            }
                          </div>
                        )}

                        {!searching && hasSearched && searchResults.length === 0 && (
                          <div style={{ textAlign: "center", padding: "14px 0", color: T.textMuted, fontSize: 12 }}>
                            일치하는 학생이 없습니다
                          </div>
                        )}

                        {!searching && searchResults.map(child => (
                          <ChildItem key={child.id} child={child} checked={selectedChildren.has(child.id)} onToggle={() => toggleChild(child.id)} />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
                  <button
                    onClick={() => selectedChildren.size > 0 && setModalStep("confirm")}
                    disabled={selectedChildren.size === 0}
                    style={{
                      width: "100%", padding: "13px",
                      background: selectedChildren.size > 0 ? T.ministryPoint : "var(--hairline-strong)",
                      color: "#fff", border: "none", borderRadius: 10,
                      fontSize: 13, fontWeight: 700,
                      cursor: selectedChildren.size > 0 ? "pointer" : "not-allowed",
                      fontFamily: "inherit", transition: "all 0.15s",
                    }}
                  >
                    {selectedChildren.size > 0
                      ? `${selectedChildren.size}명 선택 완료 · 다음`
                      : "자녀를 1명 이상 선택해 주세요"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: 최종 확인 ── */}
            {modalStep === "confirm" && (
              <div style={{ padding: "0 24px 28px" }}>
                <div style={{ textAlign: "center", marginBottom: 16 }}>
                  <span style={{
                    display: "inline-block", padding: "5px 16px",
                    background: selectedRole === "학부모" ? "var(--warning-soft)" : "var(--accent-soft)",
                    color: selectedRole === "학부모" ? "var(--warning)" : "var(--accent-strong)",
                    borderRadius: 20, fontSize: 13, fontWeight: 800,
                  }}>
                    {selectedRole === "teacher" ? "교사" : "학부모"} 로 신청
                  </span>
                </div>

                {selectedRole === "학부모" && selectedChildRows.length > 0 && (
                  <div style={{
                    background: T.bgPage, borderRadius: 10, padding: "12px 14px",
                    marginBottom: 14, border: `1px solid ${T.border}`,
                  }}>
                    <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, marginBottom: 8 }}>선택한 자녀</div>
                    {selectedChildRows.map(c => (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                          {c.grade ? `${c.grade}반 ` : ""}{c.name}
                          {c.student_no != null ? ` (${c.student_no}번)` : ""}
                        </span>
                        {c.teacher_name && (
                          <span style={{ fontSize: 11, color: T.textMuted }}>· {c.teacher_name} 담임</span>
                        )}
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8, lineHeight: 1.6 }}>
                      자녀가 이 부서에서 모두 졸업하면 자동으로 탈퇴됩니다.
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", marginBottom: 20, lineHeight: 1.6 }}>
                  신청 후 부서 임원진 승인이 필요합니다.<br />승인되면 알림을 받으실 수 있습니다.
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={closeModal} disabled={requesting} style={{
                    flex: 1, padding: "12px", background: T.bgPage, color: T.textMuted,
                    border: `1px solid ${T.border}`, borderRadius: 10,
                    fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}>취소</button>
                  <button onClick={handleRequest} disabled={requesting} style={{
                    flex: 1, padding: "12px", background: T.ministryPoint, color: "#fff",
                    border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: requesting ? "not-allowed" : "pointer", fontFamily: "inherit",
                    boxShadow: "0 4px 12px rgba(62,90,74,0.3)", transition: "all 0.15s",
                  }}>
                    {requesting ? "신청 중..." : "가입 신청"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
