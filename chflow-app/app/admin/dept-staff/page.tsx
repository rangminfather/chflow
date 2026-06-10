"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DeptIcon from "@/components/DeptIcon";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Building2, Hourglass, Inbox, Folder, Info, Users, MousePointerClick, ChevronDown, User } from "lucide-react";

interface Dept {
  id: string;
  category: string;
  name: string;
  icon: string | null;
  member_count: number;
}

interface DeptMember {
  user_id: string;
  name: string;
  grade: number;
  status: string;
  joined_at: string;
}

interface DeptRow {
  id: string;
  category: string;
  name: string;
  icon: string | null;
}

interface DeptMemberCountRow {
  department_id: string;
  status: string;
}

const GRADES = [
  { v: 0, label: "전도사/교육사",    desc: "모든 메뉴",        color: "#6B4F8C", bg: "#EDE7F2" },
  { v: 1, label: "부장",             desc: "공지·학생·행정·부서", color: "var(--danger)",  bg: "var(--danger-soft)" },
  { v: 2, label: "부부장/총무/서기", desc: "공지·학생·행정",    color: "#B97B3D", bg: "#F4E8D7" },
  { v: 3, label: "교사",             desc: "공지·학생",         color: "var(--success)", bg: "var(--success-soft)" },
  { v: 4, label: "학부모",           desc: "공지 읽기/댓글",    color: "var(--ink-soft)", bg: "var(--bg-soft)" },
];

const STATUS = {
  pending:  { label: "신청중", color: "var(--warning)", bg: "var(--warning-soft)" },
  approved: { label: "승인",   color: "var(--success)", bg: "var(--success-soft)" },
  rejected: { label: "거절",   color: "var(--danger)",  bg: "var(--danger-soft)" },
};

export default function DeptStaffPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [selectedDept, setSelectedDept] = useState<Dept | null>(null);
  const [members, setMembers] = useState<DeptMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadDepts = useCallback(async () => {
    const { data: deptList } = await supabase
      .from("departments")
      .select("id, category, name, icon, order_no")
      .eq("is_active", true)
      .order("category")
      .order("order_no");
    if (!deptList) return;

    const { data: counts } = await supabase
      .from("department_members")
      .select("department_id, status");

    const countMap = new Map<string, number>();
    ((counts || []) as DeptMemberCountRow[]).forEach((c) => {
      if (c.status === "approved") countMap.set(c.department_id, (countMap.get(c.department_id) || 0) + 1);
    });

    setDepts((deptList as DeptRow[]).map((d) => ({
      id: d.id, category: d.category, name: d.name, icon: d.icon,
      member_count: countMap.get(d.id) || 0,
    })));
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/home"); return;
      }
      setAuthChecked(true);
      await loadDepts();
    })();
  }, [loadDepts, router]);

  const loadMembers = async (dept: Dept) => {
    setSelectedDept(dept);
    setSidebarOpen(false);
    setLoading(true);
    setMembers([]);
    const { data, error } = await supabase.rpc("list_dept_members_with_grade", { p_dept_id: dept.id });
    setLoading(false);
    if (error) { alert("부서원 조회 실패: " + error.message); return; }
    setMembers(data || []);
  };

  const changeGrade = async (m: DeptMember, newGrade: number) => {
    if (m.grade === newGrade) return;
    setBusy(m.user_id);
    const { error } = await supabase.rpc("set_member_grade", {
      p_dept_id: selectedDept!.id,
      p_member_user_id: m.user_id,
      p_grade: newGrade,
    });
    setBusy(null);
    if (error) { alert("등급 변경 실패: " + error.message); return; }
    setMembers(ms => ms.map(x => x.user_id === m.user_id ? { ...x, grade: newGrade } : x));
  };

  const approveOrReject = async (m: DeptMember, approve: boolean) => {
    setBusy(m.user_id);
    const { data: rows } = await supabase
      .from("department_members")
      .select("id")
      .eq("department_id", selectedDept!.id)
      .eq("user_id", m.user_id)
      .limit(1);
    const joinId = rows?.[0]?.id;
    if (!joinId) { setBusy(null); alert("신청 ID를 찾을 수 없습니다"); return; }
    const { error } = await supabase.rpc("admin_approve_dept_join", { p_join_id: joinId, p_approved: approve });
    setBusy(null);
    if (error) { alert("처리 실패: " + error.message); return; }
    await loadMembers(selectedDept!);
  };

  if (!authChecked) return <LoadingView full />;

  const grouped: Record<string, Dept[]> = {};
  depts.forEach(d => {
    if (!grouped[d.category]) grouped[d.category] = [];
    grouped[d.category].push(d);
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <style>{`
        .ds-layout { display: grid; grid-template-columns: 300px 1fr; gap: 16px; padding: 16px; max-width: 1200px; margin: 0 auto; }
        .ds-sidebar { display: block; }
        .ds-sidebar-toggle { display: none !important; }
        .ds-header { padding: 16px; }
        /* 회원 카드 스크롤 */
        .ds-member-list {
          display: flex;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
          gap: 12px;
          padding: 16px;
          scrollbar-width: none;
        }
        .ds-member-list::-webkit-scrollbar { display: none; }
        .ds-member-item {
          flex-shrink: 0;
          width: 80vw;
          max-width: 280px;
          scroll-snap-align: start;
        }
        @media (min-width: 769px) {
          .ds-member-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            overflow-x: visible;
            scroll-snap-type: none;
          }
          .ds-member-item { width: auto; max-width: none; }
        }
        @media (max-width: 768px) {
          .ds-layout { grid-template-columns: 1fr; padding: 12px; }
          .ds-sidebar { display: none !important; }
          .ds-sidebar-toggle { display: flex !important; }
          .ds-header { padding: 12px; }
        }
      `}</style>

      {/* 헤더 */}
      <div style={{ background: "var(--card)", borderBottom: "1px solid var(--hairline)" }}>
        <div className="ds-header" style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HeaderLogo />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
                <Building2 size={18} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 부서원 관리
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>등급 임명 · 부서원 현황</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={() => router.push("/admin/members")} style={btnGhost}>← 회원관리</button>
            <button onClick={() => router.push("/admin/pending")} style={{ ...btnGhost, background: "var(--warning-soft)", color: "var(--warning)" }}><Hourglass size={14} strokeWidth={1.8} /> 가입 대기자</button>
            <button onClick={() => router.push("/admin/dept-pending")} style={{ ...btnGhost, background: "var(--accent-soft)", color: "var(--accent-strong)" }}><Inbox size={14} strokeWidth={1.8} /> 부서가입 신청</button>
          </div>
        </div>
      </div>

      {/* 모바일: 부서 선택 토글 버튼 */}
      <div className="ds-sidebar-toggle" style={{ display: "none", padding: "10px 12px", background: "var(--card)", borderBottom: "1px solid var(--hairline)" }}>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "var(--ink)", cursor: "pointer", fontFamily: "inherit" }}
        >
          <Folder size={16} strokeWidth={1.8} style={{ color: "var(--accent)" }} />
          <span style={{ flex: 1, textAlign: "left" }}>{selectedDept ? `${selectedDept.category} / ${selectedDept.name}` : "부서 선택"}</span>
          <ChevronDown size={16} strokeWidth={1.8} style={{ color: "var(--ink-faint)", transform: sidebarOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>
      </div>

      {/* 모바일 부서 드롭다운 */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: 130, left: 12, right: 12, background: "var(--card)", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", maxHeight: "60vh", overflowY: "auto", padding: 12 }}>
            <DeptList grouped={grouped} selectedDept={selectedDept} onSelect={loadMembers} />
          </div>
        </div>
      )}

      <div className="ds-layout">
        {/* PC 사이드바 */}
        <div className="ds-sidebar" style={{ background: "var(--card)", borderRadius: 12, padding: 12, height: "fit-content" }}>
          <DeptList grouped={grouped} selectedDept={selectedDept} onSelect={loadMembers} />
        </div>

        {/* 메인 */}
        <div style={{ background: "var(--card)", borderRadius: 12, overflow: "hidden", minWidth: 0 }}>
          {!selectedDept ? (
            <EmptyState padding={60} icon={<MousePointerClick size={24} strokeWidth={1.6} />} message="부서를 선택하면 부서원이 표시됩니다" />
          ) : (
            <>
              {/* 부서 헤더 */}
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--hairline)", background: "linear-gradient(135deg, var(--accent-soft), #F2EDF6)" }}>
                <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>{selectedDept.category}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 7 }}>
                  <DeptIcon name={selectedDept.name} category={selectedDept.category} size={18} /> {selectedDept.name}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", marginLeft: 6 }}>부서원 {members.length}명</span>
                </div>
              </div>

              {/* 등급 안내 */}
              <details style={{ margin: "12px 16px 0", fontSize: 11, color: "var(--ink-mid)" }}>
                <summary style={{ cursor: "pointer", padding: "6px 10px", background: "var(--surface)", borderRadius: 6, fontWeight: 600, listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>
                  <Info size={13} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 등급 안내 (펼치기)
                </summary>
                <div style={{ padding: 10, background: "var(--surface)", borderRadius: 6, marginTop: 6, display: "grid", gap: 4 }}>
                  {GRADES.map(g => (
                    <div key={g.v} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ display: "inline-block", minWidth: 22, height: 18, lineHeight: "18px", textAlign: "center", borderRadius: 4, background: g.bg, color: g.color, fontWeight: 700, fontSize: 11, flexShrink: 0 }}>{g.v}</span>
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{g.label}</span>
                      <span style={{ color: "var(--ink-soft)" }}>· {g.desc}</span>
                    </div>
                  ))}
                </div>
              </details>

              {loading ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--ink-faint)" }}>조회 중...</div>
              ) : members.length === 0 ? (
                <EmptyState padding={40} icon={<Users size={24} strokeWidth={1.6} />} message="부서원이 없습니다" />
              ) : (
                <div className="ds-member-list">
                  {members.map(m => {
                    const g = GRADES.find(x => x.v === m.grade);
                    const s = (STATUS as Record<string, {label: string; color: string; bg: string}>)[m.status] || { label: m.status, color: "var(--ink-soft)", bg: "var(--bg-soft)" };
                    const isPending = m.status === "pending";
                    return (
                      <div key={m.user_id} className="ds-member-item" style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* 아바타 + 이름 */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--bg-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-faint)", flexShrink: 0 }}>
                            <User size={20} strokeWidth={1.8} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                            {m.joined_at && (
                              <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 1 }}>
                                {new Date(m.joined_at).toLocaleDateString("ko-KR")}
                              </div>
                            )}
                          </div>
                        </div>
                        {/* 상태 배지 */}
                        <span style={{ display: "inline-block", padding: "2px 8px", background: s.bg, color: s.color, borderRadius: 6, fontSize: 10, fontWeight: 700, alignSelf: "flex-start" }}>{s.label}</span>
                        {/* 현재 등급 */}
                        {g && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: g.bg, color: g.color }}>{g.v} · {g.label}</span>
                          </div>
                        )}
                        {/* 액션 */}
                        {isPending ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => approveOrReject(m, true)} disabled={busy === m.user_id} style={{ flex: 1, padding: "7px 0", background: "var(--success)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>승인</button>
                            <button onClick={() => approveOrReject(m, false)} disabled={busy === m.user_id} style={{ flex: 1, padding: "7px 0", background: "var(--danger-soft)", color: "var(--danger)", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>거절</button>
                          </div>
                        ) : (
                          <select
                            value={m.grade}
                            disabled={busy === m.user_id}
                            onChange={e => changeGrade(m, Number(e.target.value))}
                            style={{ width: "100%", padding: "7px 8px", fontSize: 12, border: "1.5px solid var(--hairline)", borderRadius: 8, fontFamily: "inherit", background: "var(--card)", cursor: "pointer" }}
                          >
                            {GRADES.map(opt => (
                              <option key={opt.v} value={opt.v}>{opt.v} · {opt.label}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DeptList({ grouped, selectedDept, onSelect }: { grouped: Record<string, Dept[]>; selectedDept: Dept | null; onSelect: (d: Dept) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-faint)", letterSpacing: 0.8, marginBottom: 8, paddingLeft: 8 }}>부서 목록</div>
      {Object.entries(grouped).map(([cat, list]) => (
        <div key={cat} style={{ marginBottom: 12 }}>
          <div style={{ padding: "4px 8px", fontSize: 10, fontWeight: 800, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
            <Folder size={11} strokeWidth={1.8} /> {cat}
          </div>
          {list.map(d => (
            <div
              key={d.id}
              onClick={() => onSelect(d)}
              style={{
                padding: "9px 12px", borderRadius: 8, marginBottom: 3, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: selectedDept?.id === d.id ? "var(--accent-soft)" : "transparent",
                border: `1.5px solid ${selectedDept?.id === d.id ? "var(--accent)" : "transparent"}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: selectedDept?.id === d.id ? 700 : 500, color: selectedDept?.id === d.id ? "var(--accent)" : "var(--ink-mid)", display: "flex", alignItems: "center", gap: 6 }}>
                <DeptIcon name={d.name} size={14} color="currentColor" /> {d.name}
              </div>
              <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>{d.member_count}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "8px 12px", background: "var(--bg-soft)", border: "none",
  borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
  whiteSpace: "nowrap",
};
