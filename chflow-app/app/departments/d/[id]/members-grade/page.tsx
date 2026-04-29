"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Member {
  user_id: string;
  name: string;
  grade: number;
  status: string;
  joined_at: string;
}

const GRADE_OPTIONS = [
  { value: 0, label: "0 — 전도사 / 교육사" },
  { value: 1, label: "1 — 부장" },
  { value: 2, label: "2 — 부부장 / 총무 / 서기" },
  { value: 3, label: "3 — 교사" },
  { value: 4, label: "4 — 학부모" },
];

const GRADE_BG: Record<number, string> = {
  0: "#ecfdf5",
  1: "#fef3c7",
  2: "#dbeafe",
  3: "#f1f5f9",
  4: "#fef2f2",
};

export default function MembersGradePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [myGrade, setMyGrade] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await load();
    })();
  }, []);

  async function load() {
    setLoading(true);
    const [gradeR, listR] = await Promise.all([
      supabase.rpc("get_user_grade", { p_dept_id: deptId }),
      supabase.rpc("list_dept_members_with_grade", { p_dept_id: deptId }),
    ]);
    if (gradeR.data !== null && gradeR.data !== undefined) {
      setMyGrade(typeof gradeR.data === "number" ? gradeR.data : Number(gradeR.data));
    }
    if (listR.error) {
      showToast("조회 실패: " + listR.error.message);
    } else {
      setMembers(listR.data || []);
    }
    setLoading(false);
  }

  async function handleGradeChange(member: Member, newGrade: number) {
    if (member.grade === newGrade) return;
    if (!confirm(`${member.name} 님의 등급을 ${member.grade} → ${newGrade} 로 변경하시겠습니까?`)) return;
    setSavingId(member.user_id);
    const { error } = await supabase.rpc("set_member_grade", {
      p_dept_id: deptId,
      p_member_user_id: member.user_id,
      p_grade: newGrade,
    });
    setSavingId(null);
    if (error) {
      showToast("저장 실패: " + error.message);
    } else {
      showToast(`${member.name} 등급 변경됨`);
      await load();
    }
  }

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  if (!authChecked || loading) return <div style={loadingStyle}>로딩 중...</div>;

  if (myGrade === null || myGrade > 1) {
    return (
      <div style={pageStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>
              접근 권한이 없습니다
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
              부서원 등급 관리는 등급 0~1 (전도사/교육사 또는 부장) 만 가능합니다.
            </div>
            <button onClick={() => router.push(`/departments/d/${deptId}`)} style={primaryBtnStyle}>
              부서홈으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      <div style={headerStyle}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>🎖️ 부서원 등급 관리</div>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7 }}>
            <b>등급 정책</b>:
            <br />• <b>0</b> 전도사·교육사 — 모든 메뉴
            <br />• <b>1</b> 부장 — 공지·학생·행정·부서
            <br />• <b>2</b> 부부장·총무·서기 — 공지·학생·행정
            <br />• <b>3</b> 교사 — 공지·학생
            <br />• <b>4</b> 학부모 — 공지(읽기/댓글)
          </div>
        </div>

        <div style={cardStyle}>
          <div style={sectionLabel}>부서원 ({members.length}명)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.map((m) => (
              <div
                key={m.user_id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                  padding: "10px 12px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  background: GRADE_BG[m.grade] || "#fff",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                    상태: {m.status} · 가입: {new Date(m.joined_at).toLocaleDateString("ko-KR")}
                  </div>
                </div>
                <select
                  value={m.grade}
                  onChange={(e) => handleGradeChange(m, parseInt(e.target.value, 10))}
                  disabled={savingId === m.user_id}
                  style={{
                    padding: "6px 10px",
                    fontSize: 12,
                    fontFamily: "inherit",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: 8,
                    background: "#fff",
                    cursor: savingId === m.user_id ? "not-allowed" : "pointer",
                    minWidth: 180,
                  }}
                >
                  {GRADE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}
            {members.length === 0 && (
              <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 12 }}>
                부서원이 없습니다
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};
const loadingStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif",
};
const headerStyle: React.CSSProperties = {
  background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px",
  display: "flex", alignItems: "center", justifyContent: "space-between",
};
const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, marginBottom: 12,
};
const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8,
  fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 20px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const toastStyle: React.CSSProperties = {
  position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)",
  background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999,
  fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap",
};
