"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Building2, Hourglass, Inbox, Folder, Info, Users, MousePointerClick } from "lucide-react";

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
  { v: 0, label: "전도사/교육사",  desc: "모든 메뉴 (최고)",   color: "#6B4F8C", bg: "#EDE7F2" },
  { v: 1, label: "부장",           desc: "공지·학생·행정·부서", color: "var(--danger)", bg: "var(--danger-soft)" },
  { v: 2, label: "부부장/총무/서기", desc: "공지·학생·행정",      color: "#B97B3D", bg: "#F4E8D7" },
  { v: 3, label: "교사",           desc: "공지·학생",            color: "var(--success)", bg: "var(--success-soft)" },
  { v: 4, label: "학부모",         desc: "공지 읽기/댓글",       color: "var(--ink-soft)", bg: "var(--bg-soft)" },
];

const STATUS = {
  pending:  { label: "신청중",  color: "var(--warning)", bg: "var(--warning-soft)" },
  approved: { label: "승인",    color: "var(--success)", bg: "var(--success-soft)" },
  rejected: { label: "거절",    color: "var(--danger)", bg: "var(--danger-soft)" },
};

export default function DeptStaffPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [selectedDept, setSelectedDept] = useState<Dept | null>(null);
  const [members, setMembers] = useState<DeptMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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
      if (c.status === "approved") {
        countMap.set(c.department_id, (countMap.get(c.department_id) || 0) + 1);
      }
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
    setLoading(true);
    setMembers([]);
    const { data, error } = await supabase.rpc("list_dept_members_with_grade", { p_dept_id: dept.id });
    setLoading(false);
    if (error) {
      alert("부서원 조회 실패: " + error.message);
      return;
    }
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
    if (error) {
      alert("등급 변경 실패: " + error.message);
      return;
    }
    setMembers(ms => ms.map(x => x.user_id === m.user_id ? { ...x, grade: newGrade } : x));
  };

  const approveOrReject = async (m: DeptMember, approve: boolean) => {
    setBusy(m.user_id);
    // dept_members table — find join id then call admin_approve_dept_join
    const { data: rows } = await supabase
      .from("department_members")
      .select("id")
      .eq("department_id", selectedDept!.id)
      .eq("user_id", m.user_id)
      .limit(1);
    const joinId = rows?.[0]?.id;
    if (!joinId) {
      setBusy(null);
      alert("신청 ID를 찾을 수 없습니다");
      return;
    }
    const { error } = await supabase.rpc("admin_approve_dept_join", {
      p_join_id: joinId,
      p_approved: approve,
    });
    setBusy(null);
    if (error) {
      alert("처리 실패: " + error.message);
      return;
    }
    await loadMembers(selectedDept!);
  };

  if (!authChecked) {
    return <LoadingView full />;
  }

  // 카테고리별로 그룹화
  const grouped: Record<string, Dept[]> = {};
  depts.forEach(d => {
    if (!grouped[d.category]) grouped[d.category] = [];
    grouped[d.category].push(d);
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", padding: 16 }}>

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ background: "var(--card)", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}><Building2 size={20} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 부서원 관리</div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>부서별 인원과 등급 임명 (관리자 전용)</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => router.push("/admin/members")} style={btnGhost}>← 회원관리</button>
            <button onClick={() => router.push("/admin/pending")} style={{ ...btnGhost, background: "var(--warning-soft)", color: "var(--warning)" }}><Hourglass size={14} strokeWidth={1.8} /> 가입 대기자</button>
            <button onClick={() => router.push("/admin/dept-pending")} style={{ ...btnGhost, background: "var(--accent-soft)", color: "var(--accent-strong)" }}><Inbox size={14} strokeWidth={1.8} /> 부서가입 신청</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
          {/* Left: Department list */}
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mid)", padding: "4px 8px", marginBottom: 6 }}>
              부서 ({depts.length}개)
            </div>
            {Object.entries(grouped).map(([cat, list]) => (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--ink-faint)", padding: "4px 8px", textTransform: "uppercase" }}>
                  {cat}
                </div>
                {list.map(d => (
                  <div
                    key={d.id}
                    onClick={() => loadMembers(d)}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                      background: selectedDept?.id === d.id ? "var(--accent-soft)" : "transparent",
                      border: selectedDept?.id === d.id ? "1.5px solid var(--accent)" : "1.5px solid transparent",
                      marginBottom: 4,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
                      {d.icon ? <span>{d.icon}</span> : <Folder size={15} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} />} {d.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 600 }}>
                      {d.member_count}명
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {depts.length === 0 && (
              <EmptyState padding={20} message="부서가 없습니다" />
            )}
          </div>

          {/* Right: Members of selected dept */}
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 16 }}>
            {!selectedDept ? (
              <EmptyState padding={60} icon={<MousePointerClick size={24} strokeWidth={1.6} />} message="좌측에서 부서를 선택하세요" />
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--hairline)" }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
                      {selectedDept.icon ? <span>{selectedDept.icon}</span> : <Folder size={18} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} />} {selectedDept.category} / {selectedDept.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>
                      등록된 부서원 {members.length}명
                    </div>
                  </div>
                </div>

                {/* 등급 안내 */}
                <details style={{ marginBottom: 14, fontSize: 11, color: "var(--ink-mid)" }}>
                  <summary style={{ cursor: "pointer", padding: "6px 10px", background: "var(--surface)", borderRadius: 6, fontWeight: 600 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Info size={13} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 등급 안내 (펼치기)</span>
                  </summary>
                  <div style={{ padding: 10, background: "var(--surface)", borderRadius: 6, marginTop: 6 }}>
                    {GRADES.map(g => (
                      <div key={g.v} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                        <span style={{ display: "inline-block", minWidth: 22, height: 18, lineHeight: "18px", textAlign: "center", borderRadius: 4, background: g.bg, color: g.color, fontWeight: 700, fontSize: 11 }}>{g.v}</span>
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{g.label}</span>
                        <span style={{ color: "var(--ink-soft)" }}>· {g.desc}</span>
                      </div>
                    ))}
                  </div>
                </details>

                {loading ? (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--ink-faint)" }}>조회 중...</div>
                ) : members.length === 0 ? (
                  <EmptyState
                    padding={40}
                    icon={<Users size={24} strokeWidth={1.6} />}
                    message="부서원이 없습니다"
                    hint="사용자가 /departments 페이지에서 가입 신청을 해야 합니다."
                  />
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--hairline)" }}>
                        <th style={th}>이름</th>
                        <th style={th}>상태</th>
                        <th style={th}>현재 등급</th>
                        <th style={th}>등급 변경</th>
                        <th style={th}>가입일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(m => {
                        const g = GRADES.find(x => x.v === m.grade);
                        const s = (STATUS as any)[m.status] || { label: m.status, color: "var(--ink-soft)", bg: "var(--bg-soft)" };
                        const isPending = m.status === "pending";
                        return (
                          <tr key={m.user_id} style={{ borderBottom: "1px solid var(--bg-soft)" }}>
                            <td style={td}><b>{m.name}</b></td>
                            <td style={td}>
                              <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>{s.label}</span>
                            </td>
                            <td style={td}>
                              {g ? (
                                <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700, background: g.bg, color: g.color }}>
                                  {g.v} · {g.label}
                                </span>
                              ) : <span style={{ color: "var(--ink-faint)" }}>—</span>}
                            </td>
                            <td style={td}>
                              {isPending ? (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button onClick={() => approveOrReject(m, true)} disabled={busy === m.user_id}
                                    style={{ padding: "5px 10px", background: "var(--success)", color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                    승인
                                  </button>
                                  <button onClick={() => approveOrReject(m, false)} disabled={busy === m.user_id}
                                    style={{ padding: "5px 10px", background: "var(--danger-soft)", color: "var(--danger)", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                    거절
                                  </button>
                                </div>
                              ) : (
                                <select
                                  value={m.grade}
                                  disabled={busy === m.user_id}
                                  onChange={(e) => changeGrade(m, Number(e.target.value))}
                                  style={{
                                    padding: "5px 8px", fontSize: 12, border: "1.5px solid var(--hairline)",
                                    borderRadius: 6, fontFamily: "inherit", background: "var(--card)", cursor: "pointer",
                                  }}>
                                  {GRADES.map(opt => (
                                    <option key={opt.v} value={opt.v}>{opt.v} · {opt.label}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td style={{ ...td, color: "var(--ink-soft)", fontSize: 11 }}>
                              {m.joined_at ? new Date(m.joined_at).toLocaleDateString("ko-KR") : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 8px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "10px 8px", verticalAlign: "middle" };
const btnGhost: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "8px 14px", background: "var(--bg-soft)", border: "none",
  borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
};
