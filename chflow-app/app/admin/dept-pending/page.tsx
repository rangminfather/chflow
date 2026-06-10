"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Hourglass, Users, MapPin, User, MousePointerClick, CheckCircle2, Medal, Folder, Menu } from "lucide-react";

interface PendingJoin {
  id: string;
  department_id: string;
  user_id: string;
  user_name: string;
  user_phone: string;
  user_role: string;
  user_sub_role: string;
  category: string;
  dept_name: string;
  dept_icon: string;
  requested_at: string;
}

interface DeptInfo {
  id: string;
  category: string;
  name: string;
  icon: string | null;
  member_count: number;
  pending_count: number;
}

interface DeptMember {
  id: string;
  user_id: string;
  user_name: string;
  user_phone: string;
  user_sub_role: string;
  user_avatar_url: string | null;
  member_role: string;
  status: string;
  joined_at: string;
}

const AVAILABLE_ROLES = [
  "부장", "부부장", "총무", "부총무", "서기", "부서기",
  "교사", "전도사", "교육사", "간사", "사모", "기타", "회원",
];

export default function AdminDeptPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // 데이터
  const [pending, setPending] = useState<PendingJoin[]>([]);
  const [allDepts, setAllDepts] = useState<DeptInfo[]>([]);
  const [members, setMembers] = useState<DeptMember[]>([]);

  // 선택 상태
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<DeptInfo | null>(null);

  // UI
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<DeptMember | null>(null);
  const [approvingJoin, setApprovingJoin] = useState<PendingJoin | null>(null);
  const [pickedGrade, setPickedGrade] = useState<number>(3);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: pendingData }, { data: deptData }] = await Promise.all([
      supabase.rpc("admin_list_dept_pending"),
      supabase.rpc("admin_list_all_departments"),
    ]);
    setPending(pendingData || []);
    setAllDepts(deptData || []);
    setLoading(false);
  }, []);

  const loadMembers = useCallback(async (deptId: string) => {
    const { data, error } = await supabase.rpc("admin_list_dept_members", { p_dept_id: deptId });
    if (!error) setMembers(data || []);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
      loadAll();
    })();
  }, [loadAll, router]);

  const handleDeptSelect = (dept: DeptInfo) => {
    setSelectedDeptId(dept.id);
    setSelectedDept(dept);
    loadMembers(dept.id);
    setSidebarOpen(false);
  };

  const handleApprove = (j: PendingJoin) => {
    setApprovingJoin(j);
    setPickedGrade(3);
  };

  const doApprove = async () => {
    if (!approvingJoin) return;
    setProcessing(approvingJoin.id);
    const { error } = await supabase.rpc("admin_approve_dept_join", {
      p_join_id: approvingJoin.id,
      p_approved: true,
      p_grade: pickedGrade,
    });
    setProcessing(null);
    if (error) { alert(`승인 실패: ${error.message}`); return; }
    const deptId = approvingJoin.department_id;
    setApprovingJoin(null);
    loadAll();
    if (selectedDeptId === deptId) loadMembers(selectedDeptId);
  };

  const handleReject = async (j: PendingJoin) => {
    if (!confirm(`${j.user_name}님의 ${j.category} / ${j.dept_name} 가입을 거절하시겠습니까?`)) return;
    setProcessing(j.id);
    const { error } = await supabase.rpc("admin_approve_dept_join", { p_join_id: j.id, p_approved: false });
    setProcessing(null);
    if (error) { alert(`거절 실패: ${error.message}`); return; }
    loadAll();
  };

  const handleRemoveMember = async (m: DeptMember) => {
    if (!confirm(`${m.user_name}님을 ${selectedDept?.name}에서 탈퇴 처리하시겠습니까?`)) return;
    const { error } = await supabase.rpc("admin_remove_dept_member", { p_join_id: m.id });
    if (error) { alert(`탈퇴 실패: ${error.message}`); return; }
    if (selectedDeptId) loadMembers(selectedDeptId);
    loadAll();
  };

  const handleAssignRole = async (m: DeptMember, newRole: string) => {
    const { error } = await supabase.rpc("admin_set_dept_member_role", { p_join_id: m.id, p_role: newRole });
    if (error) { alert(`임명 실패: ${error.message}`); return; }
    setEditingMember(null);
    if (selectedDeptId) loadMembers(selectedDeptId);
  };

  // 카테고리별 그룹핑
  const deptByCategory: Record<string, DeptInfo[]> = {};
  allDepts.forEach((d) => {
    if (!deptByCategory[d.category]) deptByCategory[d.category] = [];
    deptByCategory[d.category].push(d);
  });

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={pageStyle}>

      <style>{`
        @media (max-width: 768px) {
          .dept-sidebar-desktop { display: none !important; }
          .dept-sidebar-toggle { display: flex !important; }
          .dept-main { padding: 12px !important; }
        }
        @media (min-width: 769px) {
          .dept-sidebar-toggle { display: none !important; }
        }
      `}</style>

      {/* 헤더 */}
      <div style={{ background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="dept-sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ display: "none", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, background: "var(--bg-soft)", border: "none", cursor: "pointer", color: "var(--ink-mid)" }}
          ><Menu size={18} strokeWidth={1.8} /></button>
          <HeaderLogo />
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>사역 / 부서 관리</div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>가입 승인 + 회원 관리</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => router.push("/admin/pending")} style={subBtnStyle("var(--warning-soft)", "var(--warning)")}><Hourglass size={14} strokeWidth={1.8} /> 회원가입</button>
          <button onClick={() => router.push("/admin/members")} style={subBtnStyle("var(--accent-soft)", "var(--accent)")}><Users size={14} strokeWidth={1.8} /> 회원관리</button>
          <button onClick={() => router.push("/home")} style={subBtnStyle("var(--bg-soft)", "var(--ink-mid)")}>← 홈</button>
        </div>
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 64px)" }}>
        {/* === 사이드바 (PC) === */}
        <div className="dept-sidebar-desktop" style={sidebarStyle}>
          <Sidebar
            deptByCategory={deptByCategory}
            selectedDeptId={selectedDeptId}
            onSelect={handleDeptSelect}
            pendingTotal={pending.length}
          />
        </div>

        {/* === 사이드바 모바일 === */}
        {sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...sidebarStyle, position: "fixed", top: 0, left: 0, bottom: 0, boxShadow: "4px 0 20px rgba(0,0,0,0.15)" }}>
              <Sidebar
                deptByCategory={deptByCategory}
                selectedDeptId={selectedDeptId}
                onSelect={handleDeptSelect}
                pendingTotal={pending.length}
              />
            </div>
          </div>
        )}

        {/* === 메인 === */}
        <div className="dept-main" style={{ flex: 1, padding: 20, overflowX: "hidden" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            {/* === 가입 신청 영역 === */}
            <div style={{ background: "var(--card)", borderRadius: 12, marginBottom: 20, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--hairline)", background: "var(--warning-soft)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--warning)", display: "flex", alignItems: "center", gap: 6 }}>
                  <Hourglass size={16} strokeWidth={1.8} /> 가입 신청 대기 ({pending.length}건)
                </div>
              </div>
              {pending.length === 0 ? (
                <EmptyState padding={30} message="대기 중인 신청이 없습니다" />
              ) : (
                pending.map((j) => (
                  <div key={j.id} style={{ padding: "12px 20px", borderBottom: "1px solid var(--bg-soft)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, var(--accent-soft), #EDE7F2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                      {j.dept_icon ? <span>{j.dept_icon}</span> : <Folder size={20} strokeWidth={1.8} style={{ color: "var(--accent)" }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                        {j.user_name} <span style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 500 }}>({j.user_sub_role || "-"})</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-mid)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        <MapPin size={13} strokeWidth={1.8} /> {j.category} / <strong>{j.dept_name}</strong>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleReject(j)} disabled={processing === j.id} style={smallBtnStyle("var(--danger-soft)", "var(--danger)")}>거절</button>
                      <button onClick={() => handleApprove(j)} disabled={processing === j.id} style={smallBtnStyle("linear-gradient(135deg, var(--success), var(--success))", "#fff")}>✓ 승인</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* === 선택된 부서 회원 목록 === */}
            {selectedDept ? (
              <div style={{ background: "var(--card)", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--hairline)", background: "linear-gradient(135deg, var(--accent-soft), #F2EDF6)" }}>
                  <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>{selectedDept.category}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>
                    {selectedDept.icon} {selectedDept.name}
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", marginLeft: 8 }}>
                      회원 {members.length}명
                    </span>
                  </div>
                </div>
                {members.length === 0 ? (
                  <EmptyState padding={40} icon={<Users size={24} strokeWidth={1.6} />} message="이 부서에 가입된 회원이 없습니다" />
                ) : (
                  <div>
                    {members.map((m) => (
                      <div key={m.id} style={{ padding: "12px 20px", borderBottom: "1px solid var(--bg-soft)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        {/* 아바타 */}
                        {m.user_avatar_url ? (
                          <img src={m.user_avatar_url} alt={m.user_name} style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", objectPosition: "center top", flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--bg-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-faint)", flexShrink: 0 }}><User size={22} strokeWidth={1.8} /></div>
                        )}
                        {/* 이름/직책 */}
                        <div style={{ flex: 1, minWidth: 150 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{m.user_name}</div>
                            {m.member_role && m.member_role !== "member" && (
                              <span style={{ padding: "1px 8px", background: "var(--accent-soft)", color: "var(--accent)", borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
                                {m.member_role}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>
                            {m.user_sub_role || "-"} {m.user_phone && `· ${m.user_phone}`}
                          </div>
                        </div>
                        {/* 액션 */}
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setEditingMember(m)} style={smallBtnStyle("var(--accent-soft)", "var(--accent)")}>임명</button>
                          <button onClick={() => handleRemoveMember(m)} style={smallBtnStyle("var(--danger-soft)", "var(--danger)")}>탈퇴</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: "var(--card)", borderRadius: 12 }}>
                <EmptyState padding={40} icon={<MousePointerClick size={24} strokeWidth={1.6} />} message="좌측 사이드바에서 사역/부서를 선택하세요" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === 승인 + 등급 선택 모달 === */}
      {approvingJoin && (
        <div onClick={() => setApprovingJoin(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 20, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={20} strokeWidth={1.8} style={{ color: "var(--success)" }} /> 부서 가입 승인</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 16 }}>
              <strong>{approvingJoin.user_name}</strong>님을 <strong>{approvingJoin.dept_name}</strong>에 가입 승인합니다.
              <br />이 부서원의 등급(권한)을 선택하세요.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { g: 0, label: "전도사 · 교육사", desc: "모든 메뉴 (공지·학생·행정·부서)" },
                { g: 1, label: "부장", desc: "모든 메뉴 (공지·학생·행정·부서)" },
                { g: 2, label: "부부장 · 총무 · 서기", desc: "공지 · 학생 · 행정" },
                { g: 3, label: "교사", desc: "공지 · 학생 (출결 · 달란트 · 우리반)" },
                { g: 4, label: "학부모", desc: "공지 (읽기 · 댓글)" },
              ].map((row) => (
                <button
                  key={row.g}
                  onClick={() => setPickedGrade(row.g)}
                  style={{
                    padding: "12px 14px",
                    background: pickedGrade === row.g ? "linear-gradient(135deg, var(--accent), var(--accent-muted))" : "var(--surface)",
                    color: pickedGrade === row.g ? "#fff" : "var(--ink)",
                    border: pickedGrade === row.g ? "1px solid transparent" : "1px solid var(--hairline)",
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: pickedGrade === row.g ? "rgba(255,255,255,0.2)" : "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: pickedGrade === row.g ? "#fff" : "var(--accent)" }}>{row.g}</div>
                  <div>
                    <div>{row.label}</div>
                    <div style={{ fontSize: 10, fontWeight: 500, color: pickedGrade === row.g ? "rgba(255,255,255,0.8)" : "var(--ink-faint)", marginTop: 2 }}>{row.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button onClick={() => setApprovingJoin(null)} style={{ flex: 1, padding: 12, background: "var(--bg-soft)", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", cursor: "pointer", fontFamily: "inherit" }}>취소</button>
              <button onClick={doApprove} disabled={processing === approvingJoin.id} style={{ flex: 1, padding: 12, background: "linear-gradient(135deg, var(--success), var(--success))", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
                {processing === approvingJoin.id ? "처리 중..." : `등급 ${pickedGrade} 으로 승인`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === 임명 모달 === */}
      {editingMember && (
        <div onClick={() => setEditingMember(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 20, padding: 28, maxWidth: 400, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Medal size={20} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 직책 임명</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 20 }}>
              <strong>{editingMember.user_name}</strong>님의 직책을 선택하세요
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {AVAILABLE_ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => handleAssignRole(editingMember, role)}
                  style={{
                    padding: "12px 8px",
                    background: editingMember.member_role === role ? "linear-gradient(135deg, var(--accent), var(--accent-muted))" : "var(--bg-soft)",
                    color: editingMember.member_role === role ? "#fff" : "var(--ink-mid)",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {role}
                </button>
              ))}
            </div>
            <button onClick={() => setEditingMember(null)} style={{ width: "100%", marginTop: 16, padding: 12, background: "var(--bg-soft)", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", cursor: "pointer", fontFamily: "inherit" }}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================
function Sidebar({
  deptByCategory,
  selectedDeptId,
  onSelect,
  pendingTotal,
}: {
  deptByCategory: Record<string, DeptInfo[]>;
  selectedDeptId: string | null;
  onSelect: (d: DeptInfo) => void;
  pendingTotal: number;
}) {
  return (
    <div style={{ padding: "16px 12px" }}>
      <div style={{ padding: "8px 12px", marginBottom: 14, background: "linear-gradient(135deg, var(--warning-soft), #E0C893)", borderRadius: 8, fontSize: 11, fontWeight: 700, color: "var(--warning)", display: "flex", alignItems: "center", gap: 5 }}>
        <Hourglass size={13} strokeWidth={1.8} /> 신청 대기 {pendingTotal}건
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-faint)", letterSpacing: 1, marginBottom: 8, paddingLeft: 8 }}>
        사역 / 부서 목록
      </div>
      {Object.entries(deptByCategory).length === 0 && (
        <div style={{ padding: "20px 12px", fontSize: 11, color: "var(--hairline-strong)", textAlign: "center" }}>
          등록된 부서가 없습니다
        </div>
      )}
      {Object.entries(deptByCategory).map(([category, depts]) => (
        <div key={category} style={{ marginBottom: 12 }}>
          <div style={{ padding: "4px 12px", fontSize: 10, fontWeight: 700, color: "var(--accent)", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 4 }}>
            <Folder size={12} strokeWidth={1.8} /> {category}
          </div>
          {depts.map((d) => (
            <div
              key={d.id}
              onClick={() => onSelect(d)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                marginBottom: 3,
                fontSize: 12,
                fontWeight: selectedDeptId === d.id ? 700 : 500,
                color: selectedDeptId === d.id ? "var(--accent)" : "var(--ink-mid)",
                background: selectedDeptId === d.id ? "var(--accent-soft)" : "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 14, display: "inline-flex", alignItems: "center" }}>{d.icon ? d.icon : <Folder size={14} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} />}</span>
              <span style={{ flex: 1 }}>{d.name}</span>
              {d.member_count > 0 && (
                <span style={{ fontSize: 9, color: "var(--ink-faint)" }}>{d.member_count}</span>
              )}
              {d.pending_count > 0 && (
                <span style={{ padding: "1px 5px", background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>
                  +{d.pending_count}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// === 스타일 ===
const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
};


const sidebarStyle: React.CSSProperties = {
  width: 220,
  background: "var(--card)",
  borderRight: "1px solid var(--hairline)",
  flexShrink: 0,
  overflowY: "auto",
};

const subBtnStyle = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "8px 14px",
  background: bg,
  color: color,
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
});

const smallBtnStyle = (bg: string, color: string): React.CSSProperties => ({
  padding: "6px 12px",
  background: bg,
  color: color,
  border: "none",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
});
